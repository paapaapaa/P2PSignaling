const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8080 });

let users = {}; // Store connected users

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        let data = JSON.parse(message);

        switch (data.type) {
            case "join":
                users[data.username] = ws;
                break;
            case "offer":
                if (users[data.target]) {
                    users[data.target].send(JSON.stringify({ type: "offer", offer: data.offer, from: data.from }));
                }
                break;
            case "answer":
                if (users[data.target]) {
                    users[data.target].send(JSON.stringify({ type: "answer", answer: data.answer, from: data.from }));
                }
                break;
            case "ice-candidate":
                if (users[data.target]) {
                    users[data.target].send(JSON.stringify({ type: "ice-candidate", candidate: data.candidate }));
                }
                break;
        }
    });

    ws.on("close", () => {
        Object.keys(users).forEach((username) => {
            if (users[username] === ws) {
                delete users[username];
            }
        });
    });
});

console.log("Signaling server running on ws://localhost:8080");
