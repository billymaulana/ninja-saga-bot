const DEV_URL = 'http://127.0.0.1:8777/version';
const GAME_TABS = ['https://ninjasaga.cc/play*', 'https://ninjasaga.cc/'];

async function gameTabs() {
  return chrome.tabs.query({ url: GAME_TABS });
}

async function injectBot(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['bot.js'], world: 'MAIN' });
}

async function injectPoller(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['poller.js'] });
}

async function notify(tabId, message) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (text) => window.__nsBot && window.__nsBot.notice && window.__nsBot.notice(text),
    args: [message],
  });
}

let checking = false;

async function devCheck(tabId) {
  if (checking) return;
  checking = true;
  try {
    const res = await fetch(DEV_URL, { cache: 'no-store' });
    const next = await res.json();
    const { devVersion: prev } = await chrome.storage.session.get('devVersion');
    await chrome.storage.session.set({ devVersion: next });

    /*
     * The manifest copy of bot.js is frozen at extension load, so a page reload would bring back a
     * stale bot. Each tab records which bot.js hash it got and is topped up whenever it lags.
     */
    if (tabId) {
      const key = `botHash_${tabId}`;
      const { [key]: tabHash } = await chrome.storage.session.get(key);
      if (tabHash !== next['bot.js']) {
        await injectBot(tabId);
        await chrome.storage.session.set({ [key]: next['bot.js'] });
      }
    }
    if (!prev) return;
    const changed = Object.keys(next).filter((k) => next[k] !== prev[k]);
    if (!changed.length) return;
    /*
     * Registered content scripts (hook.js included) are cached when the extension loads, so any
     * change to them needs an extension reload; onInstalled then re-injects bot.js into open tabs.
     */
    if (changed.some((k) => k === 'manifest.json' || k === 'background.js' || k === 'poller.js')) {
      chrome.runtime.reload();
      return;
    }
    if (changed.includes('hook.js')) {
      await chrome.storage.local.set({ hookPending: true });
      chrome.runtime.reload();
      return;
    }
    if (changed.includes('bot.js')) {
      for (const tab of await gameTabs()) await injectBot(tab.id);
    }
  } catch (e) {
    return;
  } finally {
    checking = false;
  }
}

/*
 * Chrome launches native-host.js (which runs the dev server) when this port opens and closes its
 * stdin when the port disconnects, so the server lives exactly as long as the bot is running.
 */
let nativePort = null;

function startDevServer() {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative('com.billy.nsbot');
    nativePort.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      nativePort = null;
    });
  } catch (e) {
    nativePort = null;
  }
}

function stopDevServer() {
  if (!nativePort) return;
  nativePort.disconnect();
  nativePort = null;
}

/*
 * Telemetry is relayed only from the game site's tabs, at most once a second, and rebuilt from a
 * fixed set of fields with bounded sizes rather than forwarded as received.
 */
let lastTelemetryAt = 0;
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
function relayTelemetry(data, sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab || !/^https:\/\/ninjasaga\.cc\//.test(sender.url || '')) return;
  if (!data || typeof data !== 'object' || Date.now() - lastTelemetryAt < 1000) return;
  lastTelemetryAt = Date.now();
  let report = null;
  try {
    report = JSON.stringify(data.report || null);
    report = report.length <= 200000 ? JSON.parse(report) : null;
  } catch (e) {
    report = null;
  }
  const image = clip(data.image, 1500000);
  const payload = {
    at: clip(data.at, 40),
    browser: clip(data.browser, 40),
    hidden: !!data.hidden,
    running: !!data.running,
    status: clip(data.status, 300),
    missions: Number(data.missions) || 0,
    turns: Number(data.turns) || 0,
    fps: Number.isFinite(Number(data.fps)) && data.fps !== null ? Number(data.fps) : null,
    tabId: sender.tab.id,
    report,
    image: image && image.startsWith('data:image/jpeg;base64,') ? image : null,
    shots: (Array.isArray(data.shots) ? data.shots : []).slice(0, 3).map((u) => ({
      at: clip(u && u.at, 40),
      note: clip(u && u.note, 120),
      status: clip(u && u.status, 200),
      image: typeof (u && u.image) === 'string' && u.image.startsWith('data:image/jpeg;base64,') ? u.image.slice(0, 300000) : null,
    })),
  };
  fetch('http://127.0.0.1:8777/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-NS-Bot': '1' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;
  if (msg.type === 'devCheck') {
    if (msg.fresh && sender.tab) chrome.storage.session.remove(`botHash_${sender.tab.id}`);
    devCheck(sender.tab && sender.tab.id);
  }
  else if (msg.type === 'telemetry') relayTelemetry(msg.data, sender);
  else if (msg.type === 'bot-start') startDevServer();
  else if (msg.type === 'bot-stop') stopDevServer();
});

/*
 * After the extension reloads, already-open game tabs keep their old bot but lose the poller, so
 * both are re-injected; bot.js replaces the old instance and carries its state over.
 */
chrome.runtime.onInstalled.addListener(async () => {
  const { hookPending } = await chrome.storage.local.get('hookPending');
  await chrome.storage.local.set({ hookPending: false });
  for (const tab of await gameTabs()) {
    try {
      await injectPoller(tab.id);
      await injectBot(tab.id);
      if (!hookPending) continue;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => window.__nsBot && window.__nsBot.requestReloadAtVillage && window.__nsBot.requestReloadAtVillage(),
      });
    } catch (e) {
      continue;
    }
  }
});
