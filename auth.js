require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();
const PORT = 3000;


const SECRET_KEY = process.env.JWT_SECRET;

if (!SECRET_KEY) {
    console.error("ERROR: JWT_SECRET is missing in .env file!");
    process.exit(1);
}

app.use(express.json());
app.use(cors());

// test users
const users = { Alice: "password123", Bob: "password123" };

// User Login Route
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (users[username] && users[username] === password) {
        const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "1h" });
        return res.json({ token });
    }

    return res.status(401).json({ error: "Invalid credentials" });
});

// Token Refresh Route
app.post("/refresh", (req, res) => {
    const { token } = req.body;
    try {
        const decoded = jwt.verify(token, SECRET_KEY, { ignoreExpiration: true });
        const newToken = jwt.sign({ username: decoded.username }, SECRET_KEY, { expiresIn: "1h" });
        return res.json({ token: newToken });
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
});

// Start Server
app.listen(PORT, () => console.log(`Auth server running on http://localhost:${PORT}`));