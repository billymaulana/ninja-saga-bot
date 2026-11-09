(() => {
  /*
   * WebGL canvases discard their drawing buffer after compositing, so drawImage() from the bot
   * returns a black frame. Forcing preserveDrawingBuffer keeps the last frame readable.
   */
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      attrs = { ...(attrs || {}), preserveDrawingBuffer: true };
    }
    return getContext.call(this, type, attrs);
  };

  const readFlag = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  };

  /*
   * The game waits for sound-complete events between battle steps; with no AudioContext those
   * never fire and the battle freezes, so removing audio is opt-in only and kept for diagnosis.
   */
  if (readFlag('nsNoAudio') === '1') {
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
  }

  /*
   * Keeps a copy of every SWF the game downloads. The browser's resource timeline drops old
   * entries, so SWFs loaded at startup (where pet logic lives) cannot be re-identified later.
   */
  /*
   * A stray bot click on an in-game shop/package button makes the game call navigateToURL, which
   * Ruffle turns into window.open and drags the whole tab to /store mid-mission. While the bot is
   * running those navigations are swallowed and logged instead.
   */
  window.__nsBlockedNav = [];
  const pageOpen = window.open.bind(window);
  window.open = (url, ...rest) => {
    if (readFlag('nsBotAutorun') === '1') {
      window.__nsBlockedNav.push({ url: String(url), at: Date.now() });
      return null;
    }
    return pageOpen(url, ...rest);
  };

  /*
   * "Lost connection" reloads the page, wiping in-memory state, so the last server calls are kept
   * in localStorage to tell a server-side rejection (HTTP error) from a client timeout.
   */
  function logServerCall(url, outcome, ms) {
    try {
      const log = JSON.parse(localStorage.getItem('nsServerLog') || '[]');
      let host = '';
      try {
        host = new URL(url, location.href).host;
      } catch (e) {
        host = '?';
      }
      log.push({ at: new Date().toISOString().slice(11, 23), host, outcome, ms, speed });
      localStorage.setItem('nsServerLog', JSON.stringify(log.slice(-40)));
    } catch (e) {
      return;
    }
  }

  /*
   * Stray bot clicks once spent account Tokens while nobody was watching. The bot never needs to
   * buy, train, revive or reset anything, so while it runs (autorun flag set) every AMF call whose
   * service name spends Tokens or currency is dropped before it reaches the server and logged.
   * With the bot stopped the player's own purchases go through untouched.
   */
  const SPENDING_CALL =
    /^(CharacterDAO\.(buyItem|buyPet|trainSkill|trainPetSkill|instantTrainByToken|resetAPbyToken|saveResetAP)|CharacterService\.reviveBattleCharacter)$|\.buy|purchase|bytoken/i;
  const SERVICE_NAME = /[A-Z][A-Za-z]+(?:DAO|Service)\.[A-Za-z]+/g;

  async function requestBodyBytes(args) {
    try {
      const init = args[1] || {};
      const body = init.body;
      if (body instanceof ArrayBuffer) return new Uint8Array(body);
      if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
      if (typeof body === 'string') return new TextEncoder().encode(body);
      if (args[0] instanceof Request) return new Uint8Array(await args[0].clone().arrayBuffer());
    } catch (e) {
      return null;
    }
    return null;
  }

  function serviceNames(bytes) {
    if (!bytes) return [];
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += bytes[i] >= 32 && bytes[i] < 127 ? String.fromCharCode(bytes[i]) : ' ';
    return [...new Set(text.match(SERVICE_NAME) || [])];
  }

  function remember(key, entry, keep) {
    try {
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.push(entry);
      localStorage.setItem(key, JSON.stringify(list.slice(-keep)));
    } catch (e) {
      return;
    }
  }

  window.__nsSwfLoads = [];
  const pageFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url;
    /*
     * The game server host depends on the chosen server (amf.ninjasaga.cc, or a b-cdn.net edge
     * for other server indexes), so server calls are recognised by being AMF POSTs; assets are GETs.
     */
    const method = String((args[1] && args[1].method) || (args[0] && args[0].method) || 'GET').toUpperCase();
    const isServerCall = !!url && (method === 'POST' || /amf\./i.test(url));
    if (isServerCall) {
      const names = serviceNames(await requestBodyBytes(args));
      const at = new Date().toISOString();
      if (names.length) remember('nsServiceLog', { at, names, bot: readFlag('nsBotAutorun') === '1' }, 80);
      const spending = names.filter((n) => SPENDING_CALL.test(n));
      if (spending.length && readFlag('nsBotAutorun') === '1') {
        remember('nsBlockedCalls', { at, names: spending }, 50);
        window.__nsBlockedCalls = (window.__nsBlockedCalls || []).concat({ at, names: spending });
        throw new TypeError('Blocked by bot safety: ' + spending.join(', '));
      }
    }
    if (isServerCall) beginServerCall();
    const startedAt = Date.now();
    let response;
    let outcome = 'error';
    try {
      response = await pageFetch(...args);
      outcome = response.status;
    } catch (e) {
      outcome = `throw:${e && e.message}`;
      throw e;
    } finally {
      if (isServerCall) {
        endServerCall();
        logServerCall(url, outcome, Date.now() - startedAt);
      }
    }
    try {
      if (url && /\.swf(\?|$)/i.test(url)) {
        response
          .clone()
          .arrayBuffer()
          .then((buf) => window.__nsSwfLoads.push({ url, buf }))
          .catch(() => {});
      }
    } catch (e) {
      return response;
    }
    return response;
  };

  const WA = window.WebAssembly;
  window.__nsMemories = [];
  const keep = (result) => {
    const instance = result && (result.instance || result);
    const exportsObj = instance && instance.exports;
    if (exportsObj) {
      for (const key of Object.keys(exportsObj)) {
        if (exportsObj[key] instanceof WA.Memory) window.__nsMemories.push(exportsObj[key]);
      }
    }
    return result;
  };
  const instantiate = WA.instantiate.bind(WA);
  WA.instantiate = (...args) => instantiate(...args).then(keep);
  if (WA.instantiateStreaming) {
    const instantiateStreaming = WA.instantiateStreaming.bind(WA);
    WA.instantiateStreaming = (...args) => instantiateStreaming(...args).then(keep);
  }

  /*
   * Ruffle advances frames from requestAnimationFrame timestamps and performance.now(); running
   * both on a scaled virtual clock speeds the whole game up. Rebasing on every speed change keeps
   * the clock monotonic so Ruffle never sees time jump backwards.
   */
  const perf = window.performance;
  const realNow = perf.now.bind(perf);
  const realRaf = window.requestAnimationFrame.bind(window);
  const MAX_SPEED = 5;
  /*
   * The speed buttons stop at 5x; only the bot's battle phase may go higher, through the runtime
   * setter, and it backs off by itself when the game errors.
   */
  const RUNTIME_MAX_SPEED = 8;
  let userSpeed = 1;
  try {
    userSpeed = Math.min(MAX_SPEED, Number(localStorage.getItem('nsSpeed')) || 1);
  } catch (e) {
    userSpeed = 1;
  }
  let speed = userSpeed;
  let realBase = realNow();
  let virtBase = realBase;
  const virtual = (real) => virtBase + (real - realBase) * speed;
  perf.now = () => virtual(realNow());

  /*
   * The game times out its server calls on the game clock, so at 5x a reply slower than ~2s real
   * looked like a dropped connection ("Sorry, you lost connection"). While any call to the game
   * server is pending, plus a short grace period, the clock runs at real time.
   */
  let pendingServerCalls = 0;
  const applyRate = () => {
    const next = pendingServerCalls > 0 ? 1 : userSpeed;
    if (next === speed) return;
    const r = realNow();
    virtBase = virtual(r);
    realBase = r;
    speed = next;
  };
  function beginServerCall() {
    pendingServerCalls++;
    applyRate();
  }
  function endServerCall() {
    setTimeout(() => {
      pendingServerCalls = Math.max(0, pendingServerCalls - 1);
      applyRate();
    }, 300);
  }

  /*
   * Ruffle runs at most about one SWF frame per animation tick, and requestAnimationFrame only
   * ticks at the display refresh rate. At high speeds ticks are driven by a ~4ms timer instead so
   * the extra game time can actually be turned into extra frames.
   */
  const fastQueue = [];
  let fastScheduled = false;
  const flushFast = () => {
    fastScheduled = false;
    const now = virtual(realNow());
    for (const cb of fastQueue.splice(0)) cb(now);
  };
  /*
   * Chained timeouts are clamped to 4ms (at most ~250 ticks/s), too few frames for more than ~5x;
   * above that a message-channel tick, which has no clamp, drives the frames instead.
   */
  const tickChannel = new MessageChannel();
  tickChannel.port1.onmessage = flushFast;
  /*
   * Hidden tabs get no animation frames and their timers are throttled to once a second (once a
   * minute after a while), which freezes Ruffle. Timers inside a worker are exempt, so while the
   * tab is hidden a worker tick (~60/s) drives the frames instead.
   */
  let hiddenTicker = null;
  try {
    const src = 'let id=null;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data);};';
    hiddenTicker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch (e) {
    hiddenTicker = null;
  }
  const hiddenQueue = [];
  let hiddenRunning = false;
  if (hiddenTicker) {
    hiddenTicker.onmessage = () => {
      const now = virtual(realNow());
      for (const cb of hiddenQueue.splice(0)) cb(now);
      if (!document.hidden && hiddenRunning) {
        hiddenRunning = false;
        hiddenTicker.postMessage(0);
      }
    };
  }

  /*
   * Ruffle always has one frame request outstanding. One made while the tab was visible sits in
   * the browser's rAF (which stops in hidden tabs) or a page timeout (throttled to once a minute),
   * so the game froze as soon as the tab was hidden. Every request is tracked and, on hiding,
   * moved to the worker tick; a request runs at most once, whichever path reaches it first.
   */
  const pendingFrames = new Set();
  function startHiddenTicker() {
    if (hiddenRunning || !hiddenTicker) return;
    hiddenRunning = true;
    hiddenTicker.postMessage(speed >= 5 ? 4 : 16);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !hiddenTicker || !pendingFrames.size) return;
    for (const run of pendingFrames) hiddenQueue.push(run);
    startHiddenTicker();
  });

  window.requestAnimationFrame = (cb) => {
    let done = false;
    const run = (ts) => {
      if (done) return;
      done = true;
      pendingFrames.delete(run);
      window.__nsFrameCount = (window.__nsFrameCount || 0) + 1;
      cb(ts);
    };
    pendingFrames.add(run);
    if (document.hidden && hiddenTicker) {
      hiddenQueue.push(run);
      startHiddenTicker();
      return hiddenQueue.length;
    }
    if (speed >= 5) {
      fastQueue.push(run);
      if (!fastScheduled) {
        fastScheduled = true;
        if (speed > 5) tickChannel.port2.postMessage(0);
        else setTimeout(flushFast, 4);
      }
      return fastQueue.length;
    }
    return realRaf((ts) => run(virtual(ts)));
  };
  window.__nsSetSpeed = (requested) => {
    userSpeed = Math.max(1, Math.min(MAX_SPEED, Number(requested) || 1));
    applyRate();
    try {
      localStorage.setItem('nsSpeed', String(userSpeed));
    } catch (e) {
      /* storage can be blocked; the speed still applies to this page */
    }
    return userSpeed;
  };
  window.__nsSetRuntimeSpeed = (requested) => {
    userSpeed = Math.max(1, Math.min(RUNTIME_MAX_SPEED, Number(requested) || 1));
    applyRate();
    return userSpeed;
  };
  window.__nsGetSpeed = () => userSpeed;
  window.__nsEffectiveSpeed = () => speed;
  window.__nsPendingServerCalls = () => pendingServerCalls;

  /*
   * Battle steps wait for sound-complete events, and Ruffle times its audio from
   * AudioContext.currentTime, which runs in real time. The audio clock is therefore scaled like
   * the game clock, and each scheduled buffer is mapped back to real time and played faster so
   * sounds finish in step with the accelerated game. Above 5x the game was observed to freeze.
   */
  const BAC = window.BaseAudioContext || window.AudioContext;
  const SourceNode = window.AudioBufferSourceNode;
  const timeDesc = BAC && Object.getOwnPropertyDescriptor(BAC.prototype, 'currentTime');
  if (timeDesc && timeDesc.get && SourceNode) {
    const audioClocks = new WeakMap();
    const realAudio = (ctx) => timeDesc.get.call(ctx);
    const clockOf = (ctx) => {
      const r = realAudio(ctx);
      let c = audioClocks.get(ctx);
      if (!c) {
        c = { realBase: r, virtBase: r, speed };
        audioClocks.set(ctx, c);
      }
      if (c.speed !== speed) {
        c.virtBase += (r - c.realBase) * c.speed;
        c.realBase = r;
        c.speed = speed;
      }
      return c;
    };
    const virtualAudio = (ctx) => {
      const c = clockOf(ctx);
      return c.virtBase + (realAudio(ctx) - c.realBase) * c.speed;
    };
    Object.defineProperty(BAC.prototype, 'currentTime', {
      configurable: true,
      get() {
        return virtualAudio(this);
      },
    });
    /*
     * Sound is off by default. Battle steps wait for sound-complete events, so the context must
     * keep playing; everything sent to the speakers goes through a gain node set to 0 instead.
     */
    const destinationDesc = Object.getOwnPropertyDescriptor(BAC.prototype, 'destination');
    const outputs = [];
    let soundOn = readFlag('nsSound') === '1';
    if (destinationDesc && destinationDesc.get) {
      const gains = new WeakMap();
      Object.defineProperty(BAC.prototype, 'destination', {
        configurable: true,
        get() {
          const real = destinationDesc.get.call(this);
          let gain = gains.get(this);
          if (!gain) {
            gain = this.createGain();
            gain.gain.value = soundOn ? 1 : 0;
            gain.connect(real);
            gains.set(this, gain);
            outputs.push(gain);
          }
          return gain;
        },
      });
    }
    window.__nsSetSound = (on) => {
      soundOn = !!on;
      outputs.forEach((g) => {
        g.gain.value = soundOn ? 1 : 0;
      });
      try {
        localStorage.setItem('nsSound', soundOn ? '1' : '0');
      } catch (e) {
        return soundOn;
      }
      return soundOn;
    };
    const sourceStart = SourceNode.prototype.start;
    SourceNode.prototype.start = function (when, ...rest) {
      const c = clockOf(this.context);
      let realWhen = when;
      if (typeof when === 'number' && when > 0) {
        realWhen = realAudio(this.context) + Math.max(0, when - virtualAudio(this.context)) / c.speed;
      }
      try {
        this.playbackRate.value = c.speed;
      } catch (e) {
        realWhen = when;
      }
      return sourceStart.call(this, realWhen, ...rest);
    };
  }
})();
