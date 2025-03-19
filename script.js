
const SIGNALING_SERVER = "wss://localhost:8080";
const AUTH_SERVER = "http://localhost:3000/login";



let ws, peerConnection, dataChannel;
let username, target;
let pendingCandidates = []; //pending ICE candidates.

// Function to get a JWT token
async function getToken(username) {
    try {
        const response = await fetch(AUTH_SERVER, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password: "password123" }),
        });
        const data = await response.json();
        return data.token;
    } catch (error) {
        console.error("Authentication failed:", error);
    }
}

// Function to connect to WebSocket signaling server
async function connect() {
    username = document.getElementById("username").value;
    target = document.getElementById("target").value;

    if (!username || !target) {
        alert("Enter both your username and target username!");
        return;
    }

    const token = await getToken(username);
    console.log("Token received:", token);

    ws = new WebSocket(`${SIGNALING_SERVER}?token=${token}`);
    
    ws.onopen = () => console.log("Connected to signaling server!");
    ws.onmessage = (event) => handleSignalingMessage(JSON.parse(event.data));
    ws.onclose = () => console.log("Disconnected from server");
}

// Handle incoming WebSocket messages
function handleSignalingMessage(data) {
    console.log(`Received ${data.type}`);
    switch (data.type) {
        case "offer":
            handleOffer(data);
            break;
        case "answer":
            handleAnswer(data);
            break;
        case "ice-candidate":
            handleICECandidate(data);
            break;
    }
}

// Create WebRTC Peer Connection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: "ice-candidate",
                target,
                candidate: event.candidate
            }));
        }
    };

    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel();
    };

    console.log("PeerConnection created");
}

// Initiate WebRTC Call
async function startCall() {
    createPeerConnection();

    dataChannel = peerConnection.createDataChannel("chat");
    setupDataChannel();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Include sender: username in the offer
    ws.send(JSON.stringify({ 
        type: "offer", 
        target, 
        sender: username, // Add this line
        offer 
    }));
}

// Handle Incoming Offer
async function handleOffer(data) {
    createPeerConnection();
    
    await peerConnection.setRemoteDescription(data.offer);
    console.log("Remote offer set successfully.");

    pendingCandidates.forEach(candidateData => {
        const candidate = new RTCIceCandidate(candidateData);
        peerConnection.addIceCandidate(candidate).catch(console.error);
    });
    pendingCandidates = [];

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Send the answer to the CALLER (data.sender), not data.target
    ws.send(JSON.stringify({ 
        type: "answer", 
        target: data.sender, // Fix: Use data.sender instead of data.target
        answer: peerConnection.localDescription 
    }));
}

async function handleAnswer(data) {
    if (!peerConnection.remoteDescription) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log("Remote answer set successfully.");
        
        // Apply stored ICE candidates
        while (pendingCandidates.length) {
            await peerConnection.addIceCandidate(pendingCandidates.shift());
            console.log("Applied pending ICE candidate.");
        }
    } else {
        console.log("Ignoring answer because connection is already stable.");
    }
}






// Handle ICE Candidate
async function handleICECandidate(data) {
    const candidateData = data.candidate; // Store the raw candidate object

    if (peerConnection.remoteDescription) {
        // If the remote description is set, add the ICE candidate directly
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidateData));
        console.log("Successfully added ICE candidate.");
    } else {
        // If the remote description is not set yet, store the raw candidate data
        console.log("No remote description yet, storing ICE candidate.");
        pendingCandidates.push(candidateData); // Store raw candidate data
    }
}



// Setup DataChannel for Messaging
function setupDataChannel() {
    dataChannel.onopen = () => console.log("Data channel open!");
    dataChannel.onmessage = (event) => {
        const chat = document.getElementById("chat");
        chat.innerHTML += `<p>${target}: ${event.data}</p>`;
    };
}

// Send Chat Message
function sendMessage() {
    const message = document.getElementById("messageInput").value;
    if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(message);
        document.getElementById("chat").innerHTML += `<p> You: ${message}</p>`;
    }
}
