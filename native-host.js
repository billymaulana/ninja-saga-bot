#!/Users/billymaulana/.nvm/versions/node/v24.22.1/bin/node
const { start } = require('./dev-server.js');

const server = start();

function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

/*
 * Chrome closes stdin when the extension disconnects the native port (bot stopped, tab closed or
 * extension reloaded); exiting then guarantees no server is left running in the background.
 */
let pending = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const len = pending.readUInt32LE(0);
    if (pending.length < 4 + len) break;
    const message = JSON.parse(pending.slice(4, 4 + len).toString());
    pending = pending.slice(4 + len);
    if (message && message.type === 'ping') send({ type: 'pong' });
  }
});
process.stdin.on('end', () => {
  server.close();
  process.exit(0);
});

send({ type: 'ready' });
