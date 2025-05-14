require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3000;


const SECRET_KEY = process.env.JWT_SECRET;

if (!SECRET_KEY) {
    console.error("ERROR: JWT_SECRET is missing in .env file!");
    process.exit(1);
}

const Database = require('better-sqlite3');
const db = new Database('users.db');

// Auto-create the users table if it doesn’t exist:
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);



app.use(express.json());
app.use(cors());

// test users
const users = { Alice: "password123", Bob: "password123" };

app.post('/signup', async (req, res) => {
    const { username, password, pubkey } = req.body;
    if (!username || !password || !pubkey) {
      return res.status(400).json({ error: 'username, password and pubkey required' });
    }
  
    // Hash the password
    const hash = await bcrypt.hash(password, 12);
  
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash, pubkey) VALUES (?, ?, ?)');
      stmt.run(username, hash, pubkey);
      return res.status(201).json({ message: 'User created' });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Username already exists' });
      }
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
  });

// User Login Route
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get(username);
    if (!row) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  
    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
    return res.json({ token });
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

app.get('/users/:username/pubkey', (req, res) => {
    const row = db.prepare('SELECT pubkey FROM users WHERE username = ?').get(req.params.username);
    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ pubkey: row.pubkey });
  });
  

// Start Server
app.listen(PORT, () => console.log(`Auth server running on http://localhost:${PORT}`));