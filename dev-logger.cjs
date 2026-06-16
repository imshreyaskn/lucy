const http = require('http');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'agent-debug.log');

// Clear log file on startup
fs.writeFileSync(LOG_FILE, '');

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const entry = JSON.parse(body);
        const logLine = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.component}] ${entry.message} ${entry.data ? JSON.stringify(entry.data) : ''}\n`;
        fs.appendFileSync(LOG_FILE, logLine);
        res.writeHead(200);
        res.end('OK');
      } catch (e) {
        res.writeHead(400);
        res.end('Bad Request');
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = 18080;
server.listen(PORT, () => {
  console.log(`Agent Dev Logger listening on http://localhost:${PORT}`);
  console.log(`Logs will be written to ${LOG_FILE}`);
});
