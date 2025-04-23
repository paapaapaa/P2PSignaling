// server.js
const express = require('express');
const app = express();
app.use(express.static(__dirname)); // serves index.html & script.js
const port = process.env.WEB_PORT || 8082;
app.listen(port, () => console.log(`Static files on http://localhost:${port}`));
