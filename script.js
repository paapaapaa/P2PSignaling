// script.js

const SIGNALING_SERVER = "wss://localhost:8080";
const AUTH_SERVER = "http://localhost:3000";

// IndexedDB helpers for private key storage
function openKeyDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('p2papp-keys', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storePrivateKey(username, keyJwk) {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(keyJwk, username);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPrivateKey(username) {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readonly');
    const req = tx.objectStore('keys').get(username);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Global state
let ws;
let peerConnection;
let dataChannel;
let pendingCandidates = [];
let jwtToken;
let myPrivateKey;
let mySymmetricKey;
let username;

window.addEventListener('load', () => {
  document.getElementById('signup-btn').onclick = handleSignup;
  document.getElementById('login-btn').onclick = handleLogin;
  document.getElementById('connect-btn').onclick = connectSignaling;
  document.getElementById('start-call-btn').onclick = startCall;
  document.getElementById('send-btn').onclick = sendEncryptedMessage;
});

// Generate ECDH key pair
async function generateKeyPair() {
  return await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
}

// Handle user signup
async function handleSignup() {
  const user = document.getElementById('signup-username').value;
  const pass = document.getElementById('signup-password').value;
  if (!user || !pass) return alert('Username and password required');

  // Generate key pair
  const keyPair = await generateKeyPair();
  const pubJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const prvJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

  // Send to server
  const res = await fetch(`${AUTH_SERVER}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass, pubkey: JSON.stringify(pubJwk) })
  });
  if (!res.ok) {
    const err = await res.json();
    return alert('Signup failed: ' + err.error);
  }

  // Store private key locally
  await storePrivateKey(user, JSON.stringify(prvJwk));
  alert('Signup successful! Please log in.');
}

// Handle user login
async function handleLogin() {
  username = document.getElementById('username').value;
  const pass = document.getElementById('password').value;
  if (!username || !pass) return alert('Username and password required');

  const res = await fetch(`${AUTH_SERVER}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: pass })
  });
  if (!res.ok) return alert('Login failed');

  const data = await res.json();
  jwtToken = data.token;

  // Load private key
  const stored = await getPrivateKey(username);
  myPrivateKey = await window.crypto.subtle.importKey(
    'jwk',
    JSON.parse(stored),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );

  // Show connect UI
  document.getElementById('signup-section').style.display = 'none';
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('connect-section').style.display = '';
}

// Connect to signaling server
function connectSignaling() {
  ws = new WebSocket(`${SIGNALING_SERVER}?token=${jwtToken}`);
  ws.onopen = () => {
    console.log('Connected to signaling server');
    document.getElementById('connect-section').style.display = 'none';
    document.getElementById('call-section').style.display = '';
  };
  ws.onmessage = evt => handleSignalingMessage(JSON.parse(evt.data));
  ws.onclose = () => console.log('Signaling connection closed');
  ws.onerror = err => console.error('WS error', err);
}

// Start a call with a target
async function startCall() {
  const target = document.getElementById('target').value;
  if (!target) return alert('Enter peer username');

  // Fetch peer public key and derive symmetric key
  const peerPubKey = await fetchPeerPubKey(target);
  mySymmetricKey = await window.crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPubKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  // Create RTCPeerConnection
  peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peerConnection.onicecandidate = e => {
    if (e.candidate) {
      ws.send(JSON.stringify({ type: 'ice-candidate', target, candidate: e.candidate }));
    }
  };
  peerConnection.ondatachannel = e => {
    dataChannel = e.channel;
    setupDataChannel();
  };

  // Caller creates DataChannel
  dataChannel = peerConnection.createDataChannel('chat');
  setupDataChannel();

  // Create and send offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', target, offer, sender: username }));

  // Show chat UI
  document.getElementById('call-section').style.display = 'none';
  document.getElementById('chat-section').style.display = '';
}

// Handle incoming signaling messages
async function handleSignalingMessage(msg) {
  switch (msg.type) {
    case 'offer':

      // Derive symmetric key for callee
      try {
        const peerPub = await fetchPeerPubKey(msg.sender);
        mySymmetricKey = await window.crypto.subtle.deriveKey(
          { name: 'ECDH', public: peerPub },
          myPrivateKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      } catch (e) {
        console.error('Failed to derive symmetric key for incoming call', e);
        return;
      }
      // New incoming call
      peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peerConnection.onicecandidate = e => {
        if (e.candidate) {
          ws.send(JSON.stringify({ type: 'ice-candidate', target: msg.sender, candidate: e.candidate }));
        }
      };
      peerConnection.ondatachannel = e => {
        dataChannel = e.channel;
        setupDataChannel();
      };

      await peerConnection.setRemoteDescription(msg.offer);
      for (const c of pendingCandidates) {
        await peerConnection.addIceCandidate(c);
      }
      pendingCandidates = [];

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', target: msg.sender, answer, sender: username }));

      document.getElementById('call-section').style.display = 'none';
      document.getElementById('chat-section').style.display = '';
      break;

    case 'answer':
      await peerConnection.setRemoteDescription(msg.answer);
      for (const c of pendingCandidates) {
        await peerConnection.addIceCandidate(c);
      }
      pendingCandidates = [];
      document.getElementById('chat-section').style.display = '';
      break;

    case 'ice-candidate':
      const cand = new RTCIceCandidate(msg.candidate);
      if (peerConnection && peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(cand);
      } else {
        pendingCandidates.push(cand);
      }
      break;
  }
}

// Set up DataChannel event handlers
function setupDataChannel() {
  dataChannel.onopen = () => console.log('DataChannel open');
  dataChannel.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (m.type === 'encryptedMessage') {
      const txt = await decryptMessage(m);
      document.getElementById('chat').innerHTML += `<p>${m.sender}: ${txt}</p>`;
    }
  };
}

// Send encrypted chat message
async function sendEncryptedMessage() {
  const txt = document.getElementById('messageInput').value.trim();
  if (!txt) return;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    mySymmetricKey,
    new TextEncoder().encode(txt)
  );
  dataChannel.send(
    JSON.stringify({ type: 'encryptedMessage', iv: Array.from(iv), data: Array.from(new Uint8Array(encBuf)), sender: username })
  );
  document.getElementById('chat').innerHTML += `<p>You: ${txt}</p>`;
  document.getElementById('messageInput').value = '';
}

// Public-key helper: fetch peer's public key
async function fetchPeerPubKey(user) {
  const res = await fetch(`${AUTH_SERVER}/users/${user}/pubkey`, {
    headers: { 'Authorization': `Bearer ${jwtToken}` }
  });
  if (!res.ok) throw new Error('Failed to fetch peer public key');
  const { pubkey } = await res.json();
  return window.crypto.subtle.importKey(
    'jwk', JSON.parse(pubkey), { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
}

// Decrypt AES-GCM message
async function decryptMessage({ iv, data }) {
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    mySymmetricKey,
    new Uint8Array(data).buffer
  );
  return new TextDecoder().decode(decrypted);
}
