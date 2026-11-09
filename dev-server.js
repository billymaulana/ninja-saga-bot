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
const HISTORY_MAX_BYTES = 2e6;
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
const num = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/*
 * Only the extension's background may write: it sends a custom header (which forces a CORS
 * preflight this server never approves, so web pages cannot send it) from a chrome-extension://
 * origin with a JSON body.
 */
function fromExtension(req) {
  return (
    req.headers['x-ns-bot'] === '1' &&
    /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || '') &&
    /^application\/json/.test(req.headers['content-type'] || '')
  );
}

function saveTelemetry(body) {
  const data = JSON.parse(body);
  if (!data || typeof data !== 'object') throw new Error('bad body');
  fs.mkdirSync(STATUS_DIR, { recursive: true });
  const { image, ...rest } = data;
  const jpeg = typeof image === 'string' && image.startsWith('data:image/jpeg;base64,') ? Buffer.from(image.slice(23), 'base64') : null;
  if (jpeg && jpeg.length < 1.2e6 && jpeg[0] === 0xff && jpeg[1] === 0xd8) {
    fs.writeFileSync(path.join(STATUS_DIR, 'screen.jpg'), jpeg);
    rest.screenAt = clip(rest.at, 40);
  } else {
    try {
      rest.screenAt = JSON.parse(fs.readFileSync(path.join(STATUS_DIR, 'status.json'), 'utf8')).screenAt;
    } catch (e) {
      rest.screenAt = null;
    }
  }
  const shots = Array.isArray(rest.shots) ? rest.shots.slice(0, 3) : [];
  delete rest.shots;
  if (shots.length) {
    const shotDir = path.join(STATUS_DIR, 'shots');
    fs.mkdirSync(shotDir, { recursive: true });
    for (const u of shots) {
      const name = String(clip(u.at, 40) || '').replace(/[^0-9TZ]/g, '');
      const buf = typeof u.image === 'string' && u.image.startsWith('data:image/jpeg;base64,') ? Buffer.from(u.image.slice(23), 'base64') : null;
      if (!name || !buf || buf[0] !== 0xff || buf[1] !== 0xd8) continue;
      fs.writeFileSync(path.join(shotDir, `${name}.jpg`), buf);
      fs.writeFileSync(path.join(shotDir, `${name}.json`), JSON.stringify({ at: clip(u.at, 40), note: clip(u.note, 120), status: clip(u.status, 200) }));
    }
    const files = fs.readdirSync(shotDir).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 40))) fs.unlinkSync(path.join(shotDir, f));
  }
  fs.writeFileSync(path.join(STATUS_DIR, 'status.json'), JSON.stringify(rest, null, 2));
  const r = rest.report && typeof rest.report === 'object' ? rest.report : {};
  const bg = r.background && typeof r.background === 'object' ? r.background : {};
  const line = JSON.stringify({
    at: clip(rest.at, 40),
    browser: clip(rest.browser, 40),
    running: !!rest.running,
    status: clip(rest.status, 200),
    hidden: !!rest.hidden,
    fps: num(rest.fps),
    missions: num(rest.missions),
    turns: num(rest.turns),
    level: num(r.level),
    xp: r.xpNow ? num(r.xpNow.xp) : null,
    background: { hiddenNow: !!bg.hiddenNow, hiddenMin: num(bg.hiddenMin), loops: num(bg.loops), turns: num(bg.turns), missions: num(bg.missions), longestGapS: num(bg.longestGapS) },
  });
  const historyFile = path.join(STATUS_DIR, 'history.jsonl');
  fs.appendFileSync(historyFile, line + '\n');
  if (fs.statSync(historyFile).size > HISTORY_MAX_BYTES) {
    const keep = fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).slice(-2000).join('\n') + '\n';
    fs.writeFileSync(historyFile, keep.length > HISTORY_MAX_BYTES / 2 ? keep.slice(-HISTORY_MAX_BYTES / 2) : keep);
  }
}

function start() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/telemetry') {
      if (!fromExtension(req)) {
        res.writeHead(403);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2.5e6) req.destroy();
      });
      req.on('end', () => {
        try {
          saveTelemetry(body);
          res.writeHead(204);
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
