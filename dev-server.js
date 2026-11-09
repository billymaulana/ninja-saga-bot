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
/*
 * Telemetry from the bot is written to .status/: status.json (latest report), screen.jpg (latest
 * screenshot) and history.jsonl (one compact line per report, trimmed to the last 2000).
 */
const STATUS_DIR = path.join(DIR, '.status');

function saveTelemetry(body) {
  const data = JSON.parse(body);
  fs.mkdirSync(STATUS_DIR, { recursive: true });
  const { image, ...rest } = data;
  if (image && image.startsWith('data:image/jpeg;base64,')) {
    fs.writeFileSync(path.join(STATUS_DIR, 'screen.jpg'), Buffer.from(image.slice(23), 'base64'));
    rest.screenAt = rest.at;
  } else {
    try {
      rest.screenAt = JSON.parse(fs.readFileSync(path.join(STATUS_DIR, 'status.json'), 'utf8')).screenAt;
    } catch (e) {
      rest.screenAt = null;
    }
  }
  fs.writeFileSync(path.join(STATUS_DIR, 'status.json'), JSON.stringify(rest, null, 2));
  const r = rest.report || {};
  const line = JSON.stringify({ at: rest.at, browser: rest.browser, running: rest.running, status: rest.status, missions: rest.missions, turns: rest.turns, level: r.level, xp: r.xpNow && r.xpNow.xp, background: r.background });
  const historyFile = path.join(STATUS_DIR, 'history.jsonl');
  let lines = [];
  try {
    lines = fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean);
  } catch (e) {
    lines = [];
  }
  fs.writeFileSync(historyFile, lines.concat(line).slice(-2000).join('\n') + '\n');
}

function start() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/telemetry') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 5e6) req.destroy();
      });
      req.on('end', () => {
        try {
          saveTelemetry(body);
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        } catch (e) {
          res.writeHead(400);
        }
        res.end();
      });
      return;
    }
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
    if (e.code === 'EADDRINUSE') console.error(`port ${PORT} is in use, another server is already running`);
    else console.error(e);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.error(`ninja-saga-bot dev server on http://127.0.0.1:${PORT}/version`);
  });
  return server;
}

if (require.main === module) start();

module.exports = { start };
