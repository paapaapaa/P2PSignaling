const fs = require("fs");
const https = require("https");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
require("dotenv").config();

const SECRET_KEY = process.env.JWT_SECRET; 
const HMAC_SECRET = process.env.HMAC_SECRET;
if (!HMAC_SECRET) {
    console.error("ERROR: Missing HMAC_SECRET in .env file!");
    process.exit(1);
}

// Load SSL certificate
const server = https.createServer({
    cert: fs.readFileSync(process.env.SSL_CERT),
    key: fs.readFileSync(process.env.SSL_KEY),
});

const wss = new WebSocket.Server({ server });

// Store connected users
let users = {};

wss.on("connection", (ws, req) => {
    console.log("New connection attempt");

    // extract token from url
    const urlParams = new URLSearchParams(req.url.substring(1));
    const token = urlParams.get("token");
    let username;
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        username = decoded.username;
        users[username] = ws;
        console.log(`${username} connected`);
    } catch (error) {
        console.error("Invalid token, closing connection.");
        ws.close();
        return;
    }

    ws.on("message", (message) => {
    let data;
    try {
        data = JSON.parse(message);
    } catch (e) {
        console.error("Invalid JSON format");
        return;
    }


    switch (data.type) {
        case "offer":
        case "answer":
        case "ice-candidate":
            if (users[data.target]) {
                users[data.target].send(JSON.stringify(data)); 
            }
            break;
    }
});


    ws.on("close", () => {
        console.log(`${username} disconnected`);
        delete users[username];
    });
});

server.listen(8080, () => {
    console.log("signaling server running on wss://localhost:8080");
});

// HMAC Signature function
function signMessage(data) {
    const messageCopy = { ...data }; 
    delete messageCopy.signature;

    const hmac = crypto.createHmac("sha256", HMAC_SECRET);
    hmac.update(JSON.stringify(messageCopy)); 
    return hmac.digest("hex");
}


function verifyMessageIntegrity(data) {
    if (!data.signature || !data.timestamp) return false;

    const timestampDiff = Date.now() - data.timestamp;
    if (timestampDiff > 30000) { // Reject messages older than 30s
        console.error("Message rejected due to timestamp expiration.");
        return false;
    }

    const originalSignature = data.signature;
    delete data.signature; 

    const valid = signMessage(data) === originalSignature;
    data.signature = originalSignature;
    return valid;
}

