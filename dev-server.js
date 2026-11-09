const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8777;
const DIR = __dirname;
const FILES = ['bot.js', 'hook.js', 'manifest.json', 'background.js', 'poller.js'];

function hashOf(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(DIR, file))).digest('hex').slice(0, 12);
  } catch (e) {
    return 'missing';
  }
}

/*
 * Logs go to stderr: when Chrome launches this file through native-host.js, stdout carries the
 * native messaging protocol and any stray text there would break the connection.
 */
function start() {
  const server = http.createServer((req, res) => {
    if (req.url !== '/version') {
      res.writeHead(404);
      res.end();
      return;
    }
    const version = Object.fromEntries(FILES.map((f) => [f, hashOf(f)]));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(version));
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`port ${PORT} sudah dipakai, server lain sudah jalan`);
    else console.error(e);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.error(`ninja-saga-bot dev server on http://127.0.0.1:${PORT}/version`);
  });
  return server;
}

if (require.main === module) start();

module.exports = { start };
