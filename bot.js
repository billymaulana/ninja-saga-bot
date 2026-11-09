(() => {
  const previous = window.__nsBot ? window.__nsBot.state : null;
  const previousChakra = window.__nsBot && window.__nsBot.chakra ? window.__nsBot.chakra : null;
  if (window.__nsBot) window.__nsBot.destroy();

  const BASE_W = 960;

  const POS = {
    missionRoom: [157, 289],
    nextPage: [875, 491],
    prevPage: [730, 491],
    listBack: [496, 488],
    panelClose: [906, 138],
    menuMissionRoom: [496, 254],
    neutral: [480, 160],
    attack: [460, 445],
    charge: [460, 500],
    dialog: [480, 400],
    characterCard: [438, 256],
    characterPlay: [821, 530],
  };

  const SKILL_Y = 482;
  const SLOT_X = [242, 295, 349, 402, 574, 627, 680, 733];

  const CFG = {
    hpLow: 0.35,
    maxChakra: 2320,
    idleBeforeClick: 600,
    stallReloadMs: 90000,
    defaultSpeed: 3,
  };

  const AUTORUN_KEY = 'nsBotAutorun';
  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (e) {
        return;
      }
    },
  };

  const GRADE_BUTTONS = { A: [677, 342], B: [677, 431], C: [677, 520] };
  const MISSION_ROW_Y = [240, 329, 418];
  const MISSION_ROW_X = 595;
  const MISSION_START_CHECK = [870, 493];

  const CONFIG_KEY = 'nsBotConfig';
  const DEFAULT_CONFIG = {
    grade: 'A',
    page: 2,
    row: 1,
    patchMemory: true,
    lockChakra: true,
    autoRecover: true,
    autoBestXp: true,
    characterSlot: 1,
    currentLevel: 0,
    stopLevels: '20,40,60,80,100',
    slotOrder: '1,8,7,3,6,5,4',
    healSlot: 2,
    mode: 'auto',
    attackCheat: true,
    attackStyle: 'basic',
    targetLevel: 0,
    turbo: true,
    battleBoost: false,
  };
  const config = (() => {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(storage.get(CONFIG_KEY) || '{}') };
    } catch (e) {
      return { ...DEFAULT_CONFIG };
    }
  })();
  const saveConfig = () => storage.set(CONFIG_KEY, JSON.stringify(config));

  /*
   * A target at or below the current level means "the next level": it is bumped to current + 1
   * when entered (or found on load) rather than being silently ignored.
   */
  function normalizeTarget() {
    const current = Number(config.currentLevel) || 0;
    const target = Number(config.targetLevel) || 0;
    if (target && current && target <= current) config.targetLevel = Math.min(100, current + 1);
  }
  normalizeTarget();

  const FALLBACK_TARGETS = [{ x: 744, y: 360 }, { x: 853, y: 273 }];

  /*
   * The bot keeps running while its tab is in the background: page timers are throttled there, so
   * waits are timed by a worker, whose timers are not.
   */
  const sleepWorker = (() => {
    try {
      const src = 'onmessage=(e)=>{setTimeout(()=>postMessage(e.data.id),e.data.ms);};';
      return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    } catch (e) {
      return null;
    }
  })();
  const sleepWaiters = new Map();
  let sleepSeq = 0;
  if (sleepWorker) {
    sleepWorker.onmessage = (e) => {
      const done = sleepWaiters.get(e.data);
      sleepWaiters.delete(e.data);
      if (done) done();
    };
  }
  const sleep = (ms) =>
    new Promise((r) => {
      if (!sleepWorker || !document.hidden) {
        setTimeout(r, ms);
        return;
      }
      const id = ++sleepSeq;
      sleepWaiters.set(id, r);
      sleepWorker.postMessage({ id, ms });
    });
  const near = (a, b, t = 30) =>
    Math.abs(a[0] - b[0]) < t && Math.abs(a[1] - b[1]) < t && Math.abs(a[2] - b[2]) < t;

  function stage() {
    const frame = document.querySelector('iframe.game-iframe');
    const doc = frame && frame.contentDocument;
    const player = doc && doc.querySelector('ruffle-player');
    const canvas = player && player.shadowRoot && player.shadowRoot.querySelector('canvas');
    if (!canvas || !canvas.width) return null;
    let md = null;
    try {
      md = player.metadata;
    } catch (e) {
      md = null;
    }
    const swfW = (md && md.width) || 960;
    const swfH = (md && md.height) || 720;
    return { canvas, doc, win: frame.contentWindow, swfW, swfH };
  }

  /*
   * Ruffle letterboxes the 960x720 SWF stage inside a canvas whose size follows the window, so
   * the stage rectangle is recomputed on every read and click. All coordinates in this file were
   * measured on a 960x839 canvas, where the stage sat CAL_OY px below the canvas top; they are
   * shifted by that amount to land in stage space.
   */
  const STAGE_W = 960;
  const STAGE_H = 720;
  const CAL_OY = (839 - 720) / 2;

  function fit(w, h, st) {
    const k = Math.min(w / st.swfW, h / st.swfH);
    return { k, ox: (w - st.swfW * k) / 2, oy: (h - st.swfH * k) / 2 };
  }

  let work = null;
  function snap() {
    const st = stage();
    if (!st) return null;
    if (!work) {
      const c = document.createElement('canvas');
      c.width = STAGE_W;
      c.height = STAGE_H;
      work = c.getContext('2d', { willReadFrequently: true });
    }
    const f = fit(st.canvas.width, st.canvas.height, st);
    work.drawImage(st.canvas, f.ox, f.oy, st.swfW * f.k, st.swfH * f.k, 0, 0, STAGE_W, STAGE_H);
    const data = work.getImageData(0, 0, STAGE_W, STAGE_H).data;
    const px = (x, y) => {
      const sx = Math.min(STAGE_W - 1, Math.max(0, Math.round(x)));
      const sy = Math.min(STAGE_H - 1, Math.max(0, Math.round(y - CAL_OY)));
      const i = (sy * STAGE_W + sx) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    return { px };
  }

  /*
   * Ruffle renders on this same thread, so copying the whole frame many times a second slows the
   * game down. Tight polling loops read only the small rectangle they test (grid coordinates).
   */
  const rectWork = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  function snapRect(x0, y0, x1, y1) {
    const st = stage();
    if (!st) return null;
    const f = fit(st.canvas.width, st.canvas.height, st);
    const sx = (st.swfW * f.k) / STAGE_W;
    const sy = (st.swfH * f.k) / STAGE_H;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const top = y0 - CAL_OY;
    if (rectWork.canvas.width !== w || rectWork.canvas.height !== h) {
      rectWork.canvas.width = w;
      rectWork.canvas.height = h;
    }
    rectWork.drawImage(st.canvas, f.ox + x0 * sx, f.oy + top * sy, w * sx, h * sy, 0, 0, w, h);
    const data = rectWork.getImageData(0, 0, w, h).data;
    const px = (x, y) => {
      const rx = Math.min(w - 1, Math.max(0, Math.round(x - x0)));
      const ry = Math.min(h - 1, Math.max(0, Math.round(y - y0)));
      const i = (ry * w + rx) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    return { px };
  }
  const snapBattle = () => snapRect(240, 440, 610, 540);

  async function click(x, y, legacy = false) {
    const st = stage();
    if (!st) return;
    const rect = st.canvas.getBoundingClientRect();
    const f = fit(rect.width, rect.height, st);
    const unit = f.k * (st.swfW / STAGE_W);
    const cx = rect.left + f.ox + x * unit;
    const cy = rect.top + f.oy + (y - CAL_OY) * unit;
    const base = {
      bubbles: true, cancelable: true, composed: true, view: st.win,
      clientX: cx, clientY: cy, screenX: cx, screenY: cy,
      button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true,
    };
    const up = { ...base, buttons: 0 };
    const PE = st.win.PointerEvent;
    const ME = st.win.MouseEvent;
    /*
     * Ruffle drops clicks while it believes the pointer has left the player, which is the case
     * whenever the real mouse rests outside the game (on this panel, another window...). Enter
     * events do not bubble, so they are sent to every element from the player down to the canvas
     * before each click; without them the bot's clicks were silently ignored at random.
     */
    const enter = { ...base, buttons: 0, bubbles: false };
    const chain = [];
    for (let el = st.canvas; el && el.nodeType === 1; el = el.parentNode && el.parentNode.host ? el.parentNode.host : el.parentElement) {
      chain.unshift(el);
      if (el.tagName === 'RUFFLE-PLAYER') break;
    }
    chain.forEach((el) => {
      el.dispatchEvent(new PE('pointerenter', enter));
      el.dispatchEvent(new ME('mouseenter', enter));
    });
    const fire = (list) => list.forEach((e) => st.canvas.dispatchEvent(e));
    if (legacy) {
      /*
       * The original single-burst sequence (move events carrying the pressed button). The list's
       * page arrows answered to it while the spaced sequence below went unnoticed.
       */
      fire([
        new PE('pointerover', base), new PE('pointermove', base), new ME('mousemove', base),
        new PE('pointerdown', base), new ME('mousedown', base),
        new PE('pointerup', up), new ME('mouseup', up), new ME('click', up),
      ]);
      return;
    }
    fire([
      new PE('pointerover', up), new ME('mouseover', up),
      new PE('pointermove', up), new ME('mousemove', up),
    ]);
    /*
     * Ruffle takes in the pointer position on its next frame; pressing in the same instant as the
     * move hits whatever the pointer was over before, so press and release are spaced by a frame.
     */
    await sleep(25);
    fire([new PE('pointerdown', base), new ME('mousedown', base)]);
    await sleep(25);
    fire([new PE('pointerup', up), new ME('mouseup', up), new ME('click', up)]);
  }

  const isMyTurn = (s) => near(s.px(516, 500), [0, 151, 204]) && near(s.px(516, 445), [145, 68, 12], 40);

  const inBattle = (s) => {
    const timeline = [250, 365, 500].every((x) => near(s.px(x, 533), [51, 0, 204], 35));
    const progress = [300, 450, 600].every((x) => {
      const [r, g, b] = s.px(x, 533);
      return r > 200 && g > 160 && b < 90;
    });
    return timeline || progress;
  };

  const isDialog = (s) => {
    const dark = (p) => p[0] < 25 && p[1] < 25 && p[2] < 25;
    return dark(s.px(480, 100)) && dark(s.px(480, 560)) && dark(s.px(120, 100)) && dark(s.px(840, 560));
  };

  const RANK_EMBLEM_POINTS = [[357, 102], [345, 128], [369, 128], [597, 116], [633, 116], [627, 128]];
  /*
   * Rank emblems change colour per rank (the Jounin ones are purple, a new Genin's are not), so the
   * rank progress bar between them is the primary marker: in the village every sampled pixel on it
   * is either the yellow fill or the brown empty track.
   */
  const RANK_BAR_FILL = [255, 255, 107];
  const RANK_BAR_TRACK = [171, 129, 100];
  const rankBarRow = (s, y) => {
    let onBar = 0;
    for (let x = 395; x <= 585; x += 10) {
      const p = s.px(x, y);
      if (near(p, RANK_BAR_FILL, 30) || near(p, RANK_BAR_TRACK, 30)) onBar++;
    }
    return onBar;
  };
  /*
   * Row 110 sits above the "N lv to go" caption that covers the middle of the bar at row 118.
   */
  const isVillage = (s) => {
    if (rankBarRow(s, 110) >= 17 || rankBarRow(s, 114) >= 17) return true;
    return RANK_EMBLEM_POINTS.every(([x, y]) => {
      const [r, g, b] = s.px(x, y);
      return r < 80 && g < 40 && b > 55 && b > r + 30;
    });
  };

  function bars(s) {
    let hp = 0;
    let chakra = 0;
    for (let x = 88; x <= 246; x++) {
      const h = s.px(x, 94);
      const c = s.px(x, 106);
      if (h[0] > 150 && h[1] < 120 && h[2] < 90) hp++;
      if (c[2] > 150 && c[0] < 60) chakra++;
    }
    return { hp: hp / 159, chakra: chakra / 159 };
  }

  function enemies(s) {
    const rows = [];
    for (let y = 150; y < 530; y++) {
      let run = 0;
      let start = -1;
      for (let x = y < 455 ? 540 : 780; x < 960; x++) {
        const [r, g, b] = s.px(x, y);
        if (r > 150 && g < 100 && b < 80) {
          if (!run) start = x;
          run++;
        } else {
          if (run >= 3) rows.push([y, start]);
          run = 0;
        }
      }
    }
    const groups = [];
    for (const [y, x0] of rows) {
      const g = groups.find((g) => Math.abs(g.last - y) <= 1 && Math.abs(g.x0 - x0) < 4);
      if (g) {
        g.last = y;
        g.n++;
      } else groups.push({ y, last: y, x0, n: 1 });
    }
    const darkish = (p) => p[0] + p[1] + p[2] < 260;
    return groups
      .filter((g) => g.n >= 3 && g.n <= 6)
      .filter((g) => darkish(s.px(g.x0 + 10, g.y - 2)) && darkish(s.px(g.x0 + 10, g.last + 3)) && darkish(s.px(g.x0 - 2, g.y + 1)))
      .map((g) => ({ x: g.x0 + 55, y: g.y - 80 }));
  }

  /*
   * Green mission titles share the checkmark's colour, so the button is located as the densest
   * 40px cell of pure-green pixels instead of the centroid of every green pixel on screen.
   */
  function findGreenCheck(s) {
    const pts = [];
    for (let y = 140; y < 600; y += 3) {
      for (let x = 0; x < BASE_W; x += 3) {
        const [r, g, b] = s.px(x, y);
        if (g > 100 && r < 40 && b < 40) pts.push([x, y]);
      }
    }
    const cells = new Map();
    for (const [x, y] of pts) {
      const key = `${Math.floor(x / 40)},${Math.floor(y / 40)}`;
      cells.set(key, (cells.get(key) || 0) + 1);
    }
    let bestKey = null;
    let bestCount = 0;
    for (const [key, count] of cells) {
      if (count > bestCount) {
        bestKey = key;
        bestCount = count;
      }
    }
    if (bestCount < 20) return null;
    const [cx, cy] = bestKey.split(',').map((v) => v * 40 + 20);
    const near50 = pts.filter(([x, y]) => Math.abs(x - cx) < 50 && Math.abs(y - cy) < 50);
    const hit = {
      x: Math.round(near50.reduce((a, p) => a + p[0], 0) / near50.length),
      y: Math.round(near50.reduce((a, p) => a + p[1], 0) / near50.length),
    };
    /*
     * A checkmark is a round ~50px button; the green "Grade B Mission" bar is ~360px wide and must
     * not be mistaken for one, so wide green runs through the centre are rejected.
     */
    const sideGreen = pts.filter(([x, y]) => Math.abs(y - hit.y) < 15 && Math.abs(x - hit.x) > 60 && Math.abs(x - hit.x) < 170).length;
    if (sideGreen > 20) return null;
    return hit;
  }

  /*
   * Tutorial popups ("Learn new Jutsu... Go to Academy") sit on dialog-style black bars, ignore
   * clicks on their body and only close via a small red X (~28px, white cross inside). Their green
   * button leaves the game for the Academy, so the X is the only safe way out.
   */
  /*
   * Some missions are a side-scrolling map: each area has an orange "Go!" arrow on the right.
   * Clicking it either walks into the next area or, if an enemy stands in the way, into that
   * enemy, which starts the battle; so it replaces sweeping the ground for enemies.
   */
  function findGoArrow(s, side = 'right') {
    const [x0, x1] = side === 'right' ? [820, 920] : [20, 130];
    let n = 0;
    let sy = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = 222; y <= 278; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        const [r, g, b] = s.px(x, y);
        if (r > 220 && g > 110 && g < 190 && b < 60) {
          n++;
          sy += y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (n < 40) return null;
    /*
     * Only the arrow icon reacts to clicks, not the "Go!" text, and the two blink separately. The
     * icon sits at the outer end (x ~870-912 on the right, ~20-60 on the left) and only its round
     * part, not the pointed tip, is clickable, so an arrow is reported only while that end is lit
     * and aimed at the circle; otherwise the next blink is awaited.
     */
    if (side === 'right') return maxX >= 890 ? { x: maxX - 18, y: Math.round(sy / n) } : null;
    return minX <= 50 ? { x: minX + 18, y: Math.round(sy / n) } : null;
  }

  /*
   * Map ground is a handful of flat colours (brown dirt or swamp green), so the colours covering
   * 90% of the ground band are taken as ground and everything else is foreground. Foreground cells
   * are grouped into blobs; character-sized blobs are candidates, largest first. The player cannot
   * be told apart by colour, so callers remember blobs that did not start a fight.
   */
  function findMapSprites(s) {
    const Y0 = 280;
    const Y1 = 505;
    const CELL = 16;
    const bin = ([r, g, b]) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const hist = new Map();
    for (let y = Y0; y <= Y1; y += 4) {
      for (let x = 20; x <= 940; x += 4) {
        const k = bin(s.px(x, y));
        hist.set(k, (hist.get(k) || 0) + 1);
      }
    }
    const total = [...hist.values()].reduce((t, n) => t + n, 0);
    const ground = new Set();
    let covered = 0;
    for (const [k, n] of [...hist].sort((a, b) => b[1] - a[1])) {
      if (covered / total > 0.9) break;
      ground.add(k);
      covered += n;
    }
    const cells = new Map();
    const cellBins = new Map();
    for (let y = Y0; y <= Y1; y += 4) {
      for (let x = 20; x <= 940; x += 4) {
        const k = bin(s.px(x, y));
        if (ground.has(k)) continue;
        const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
        cells.set(key, (cells.get(key) || 0) + 1);
        if (!cellBins.has(key)) cellBins.set(key, []);
        cellBins.get(key).push(k);
      }
    }
    const live = new Set([...cells].filter(([, n]) => n >= 6).map(([k]) => k));
    const blobs = [];
    for (const first of live) {
      const stack = [first];
      live.delete(first);
      const members = [];
      while (stack.length) {
        const [cx, cy] = stack.pop().split(',').map(Number);
        members.push([cx, cy]);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const k = `${cx + dx},${cy + dy}`;
            if (live.has(k)) {
              live.delete(k);
              stack.push(k);
            }
          }
        }
      }
      const xs = members.map((m) => m[0]);
      const ys = members.map((m) => m[1]);
      const x0 = Math.min(...xs) * CELL;
      const x1 = (Math.max(...xs) + 1) * CELL;
      const y0 = Math.min(...ys) * CELL;
      const y1 = (Math.max(...ys) + 1) * CELL;
      if (members.length < 10 || x1 - x0 > 260 || y1 - y0 < 48) continue;
      const colours = new Map();
      let count = 0;
      for (const [cx, cy] of members) {
        for (const k of cellBins.get(`${cx},${cy}`) || []) {
          colours.set(k, (colours.get(k) || 0) + 1);
          count++;
        }
      }
      for (const [k, n] of colours) colours.set(k, n / count);
      blobs.push({ x: Math.round((x0 + x1) / 2), y: Math.round(y0 + (y1 - y0) * 0.45), size: members.length, colours });
    }
    return blobs.sort((a, b) => b.size - a.size);
  }

  /*
   * Candidates in this area that were not clicked yet; a clicked blob that did not start a fight
   * (usually the player) is remembered until the area changes or a fight happens.
   */
  function colourSimilarity(a, b) {
    let shared = 0;
    for (const [k, v] of a) shared += Math.min(v, b.get(k) || 0);
    return shared;
  }

  /*
   * A clicked sprite that starts no fight is almost always the player, so its colour mix is kept
   * and look-alike sprites are skipped from then on instead of being clicked in every area.
   */
  function untriedSprites(s) {
    const tried = state.mapTried || [];
    return findMapSprites(s).filter(
      (b) =>
        !tried.some((t) => Math.abs(t.x - b.x) < 60 && Math.abs(t.y - b.y) < 70) &&
        !(state.playerColours && colourSimilarity(b.colours, state.playerColours) > 0.45),
    );
  }

  async function clickSprite(target) {
    state.mapTried = (state.mapTried || []).concat(target);
    const before = signature(snap(), FULL_REGION);
    await click(target.x, target.y);
    const fought = await waitForFightOrStop(before);
    if (!fought) {
      wasted('sprite');
      state.playerColours = target.colours;
      storage.set('nsPlayerColours', JSON.stringify([...target.colours]));
    }
    return fought;
  }

  async function waitForFightOrStop(before) {
    /*
     * Walking is judged from sprite positions, not raw pixels: idle animations change pixels
     * forever, while a character that arrived keeps its blob in place.
     */
    const start = Date.now();
    let prev = findMapSprites(snap());
    let stillChecks = 0;
    while (state.running && Date.now() - start < 8000) {
      await sleep(100);
      const shot = snap();
      if (changedShare(before, signature(shot, FULL_REGION)) >= 0.2) return true;
      if (shot && (isMyTurn(shot) || enemies(shot).length)) return true;
      const now = findMapSprites(shot);
      const moved = now.length !== prev.length || now.some((b) => !prev.some((p) => Math.abs(p.x - b.x) <= 10 && Math.abs(p.y - b.y) <= 10));
      stillChecks = moved ? 0 : stillChecks + 1;
      if (Date.now() - start > 600 && stillChecks >= 4) return false;
      prev = now;
    }
    return false;
  }

  /*
   * Building labels share the same translucent plate, so "Mission Room" is told apart by the
   * shape of its bright letters. The mask was taken from the village at origin (98, 283) on the
   * 960x839 grid as runs of bright pixels per row ("x0_x1" offsets). The bot clicks the building
   * only where this text is found, so a changed screen never receives a blind click.
   */
  const MISSION_ROOM_TEXT = [
    [0, '26_26 44_45'],
    [1, '13_14 21_23 26_27 44_45 70_75'],
    [2, '13_15 20_22 70_70 74_75'],
    [3, '13_15 20_22 26_27 30_34 37_41 44_45 49_52 57_57 59_62 70_70 75_76 80_83 89_92 97_97 99_101 104_106'],
    [4, '13_13 15_16 20_20 22_22 26_27 29_30 33_34 37_38 40_41 44_45 48_53 57_59 61_63 70_70 75_76 79_80 83_84 88_89 92_93 97_98 101_103 106_107'],
    [5, '13_13 15_16 19_20 22_23 26_27 29_30 37_37 44_45 47_48 53_54 57_58 62_63 70_75 78_79 84_84 88_88 93_93 97_97 101_102 106_107'],
    [6, '13_13 16_16 19_19 22_22 26_27 30_32 37_39 44_45 47_48 53_54 57_58 62_63 70_74 78_79 84_84 87_88 93_94 97_97 101_102 106_107'],
    [7, '13_13 16_17 19_19 22_22 26_27 31_34 38_41 44_45 47_48 53_54 57_57 62_63 70_70 73_74 78_79 84_84 87_88 93_94 97_97 101_102 106_107'],
    [8, '13_13 17_19 22_22 26_27 33_34 41_41 44_45 47_48 53_54 57_57 62_63 70_70 74_75 78_79 84_84 87_88 93_94 97_97 101_102 106_107'],
    [9, '13_13 17_18 22_22 26_27 33_34 41_41 44_45 48_49 52_53 57_57 62_63 70_70 75_75 79_79 83_84 88_89 92_93 97_97 102_102 106_107'],
    [10, '13_13 17_18 22_22 26_27 29_33 37_41 44_45 49_53 57_57 62_63 70_70 75_76 80_83 88_92 96_97 101_102 106_107'],
  ];
  const MISSION_ROOM_ORIGIN = [98, 283];
  const missionRoomMask = (() => {
    const on = [];
    for (const [dy, runs] of MISSION_ROOM_TEXT) {
      for (const run of runs.split(' ')) {
        const [a, b] = run.split('_').map(Number);
        for (let dx = a; dx <= b; dx++) on.push([dx, dy]);
      }
    }
    const onSet = new Set(on.map(([x, y]) => `${x},${y}`));
    const off = [];
    for (let dy = 0; dy <= 10; dy += 2) for (let dx = 10; dx <= 110; dx += 3) if (!onSet.has(`${dx},${dy}`)) off.push([dx, dy]);
    return { on, off };
  })();

  function missionRoomScoreAt(s, ox, oy) {
    const bright = (x, y) => {
      const [r, g, b] = s.px(x, y);
      return r + g + b > 705;
    };
    let hits = 0;
    for (const [dx, dy] of missionRoomMask.on) if (bright(ox + dx, oy + dy)) hits++;
    let stray = 0;
    for (const [dx, dy] of missionRoomMask.off) if (bright(ox + dx, oy + dy)) stray++;
    return hits / missionRoomMask.on.length - stray / missionRoomMask.off.length;
  }

  function findMissionRoomLabel(s) {
    const [x0, y0] = MISSION_ROOM_ORIGIN;
    const at = (ox, oy) => ({ x: ox + 57, y: oy + 5 });
    if (missionRoomScoreAt(s, x0, y0) >= 0.6) return at(x0, y0);
    let best = null;
    for (let oy = y0 - 40; oy <= y0 + 40; oy += 2) {
      for (let ox = x0 - 60; ox <= x0 + 60; ox += 2) {
        const score = missionRoomScoreAt(s, ox, oy);
        if (score >= 0.6 && (!best || score > best.score)) best = { score, ox, oy };
      }
    }
    return best ? at(best.ox, best.oy) : null;
  }

  /*
   * Map logic must only act on the walkable map. Battles (turn timeline or action buttons; red
   * clothing fooled the enemy HP-bar check), the white "VS" card and
   * the black star wipe between them otherwise drew ground clicks and "walk right" clicks that
   * cost time between turns and transitions.
   */
  function looksLikeMap(s) {
    if (inBattle(s) || isMyTurn(s)) return false;
    let bright = 0;
    let dark = 0;
    let total = 0;
    for (let y = 290; y <= 500; y += 10) {
      for (let x = 40; x <= 920; x += 20) {
        const [r, g, b] = s.px(x, y);
        total++;
        if (r > 200 && g > 190 && b > 170) bright++;
        else if (r + g + b < 60) dark++;
      }
    }
    return bright / total < 0.2 && dark / total < 0.4;
  }

  function findRedClose(s) {
    const pts = [];
    for (let y = 70; y < 600; y += 2) {
      for (let x = 0; x < BASE_W; x += 2) {
        const [r, g, b] = s.px(x, y);
        if (r > 180 && g < 70 && b < 70) pts.push([x, y]);
      }
    }
    const cells = new Map();
    for (const [x, y] of pts) {
      const key = `${Math.floor(x / 30)},${Math.floor(y / 30)}`;
      cells.set(key, (cells.get(key) || 0) + 1);
    }
    /*
     * Red clothing and the shop's red "Clear" button can out-count the X, so every dense cell is
     * tested against the X's shape (compact square with a white cross) rather than just the densest.
     */
    const candidates = [...cells].filter(([, count]) => count >= 15).sort((a, b) => b[1] - a[1]);
    for (const [key] of candidates) {
      const [cx, cy] = key.split(',').map((v) => v * 30 + 15);
      const blob = pts.filter(([x, y]) => Math.abs(x - cx) < 35 && Math.abs(y - cy) < 35);
      const xs = blob.map((p) => p[0]);
      const ys = blob.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      if (w < 16 || w > 44 || h < 16 || h > 44 || blob.length < 35) continue;
      const x = Math.round((Math.max(...xs) + Math.min(...xs)) / 2);
      const y = Math.round((Math.max(...ys) + Math.min(...ys)) / 2);
      /*
       * Village icons (the red bag) are red blobs with white art too; an X is told apart by its
       * cross: white centre and diagonals, red ring straight above, below and beside the centre.
       */
      const isWhite = (px, py) => {
        const [r, g, b] = s.px(px, py);
        return r > 200 && g > 180 && b > 180;
      };
      const isRed = (px, py) => {
        const [r, g, b] = s.px(px, py);
        return r > 180 && g < 70 && b < 70;
      };
      const ring = Math.round(Math.min(w, h) * 0.37);
      const centreWhite = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]].filter(([dx, dy]) => isWhite(x + dx, y + dy)).length >= 3;
      const diagonals = [[6, 6], [-6, 6], [6, -6], [-6, -6]].filter(([dx, dy]) => isWhite(x + dx, y + dy)).length;
      const ringSides = [[0, ring], [0, -ring], [ring, 0], [-ring, 0]].filter(([dx, dy]) => isRed(x + dx, y + dy)).length;
      if (centreWhite && diagonals >= 3 && ringSides >= 3) return { x, y };
    }
    return null;
  }

  const PATCH_FROM = [0xa2, 0x25, 0xe8, 0x07, 0xa3, 0xa2];
  const PATCH_TO = [0xa2, 0x25, 0xe8, 0x07, 0xa9, 0xa2];
  /*
   * BattleProcessor.setCharacterCommand already gives listed admin character ids a basic-attack
   * weapon damage of 400000: "if (adminArr.indexOf(id) >= 0) dmg = 400000", compiled as
   * pushbyte 0; ifnge +6; pushint 400000; convert_d; setlocal 8. Turning the jump into +0 makes
   * the assignment run for every character.
   */
  const ATTACK_FROM = [0x24, 0x00, 0x0f, 0x06, 0x00, 0x00, 0x2d, 0xa6, 0x01, 0x75, 0x63, 0x08];
  const ATTACK_TO = [0x24, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x2d, 0xa6, 0x01, 0x75, 0x63, 0x08];

  function findAll(u8, pattern) {
    const hits = [];
    let i = u8.indexOf(pattern[0]);
    while (i !== -1 && i <= u8.length - pattern.length) {
      let match = true;
      for (let k = 1; k < pattern.length; k++) {
        if (u8[i + k] !== pattern[k]) {
          match = false;
          break;
        }
      }
      if (match) hits.push(i);
      i = u8.indexOf(pattern[0], i + 1);
    }
    return hits;
  }

  /*
   * Each cheat is tracked on its own per game memory: switching one on after the other was
   * already applied must still patch it (the old single "memory patched" flag skipped it).
   */
  function patchMemory() {
    const frame = document.querySelector('iframe.game-iframe');
    const memories = frame && frame.contentWindow && frame.contentWindow.__nsMemories;
    if (!memories || !memories.length) return { ready: false, patched: 0, already: 0 };
    let patched = 0;
    let already = 0;
    const memory = memories[memories.length - 1];
    if (!state.patches || state.patches.memory !== memory) state.patches = { memory, jutsu: 0, attack: 0 };
    for (const mem of memories) {
      const u8 = new Uint8Array(mem.buffer);
      if (config.patchMemory) {
        const hits = findAll(u8, PATCH_FROM);
        hits.forEach((at) => u8.set(PATCH_TO, at));
        const total = findAll(u8, PATCH_TO).length;
        if (mem === memory) state.patches.jutsu = total;
        state.jutsuPatch = total > 0 ? `aktif (${total} pola)` : 'pola tidak ditemukan';
        patched += hits.length;
        already += total - hits.length;
      }
      if (config.attackCheat) {
        const hits = findAll(u8, ATTACK_FROM);
        hits.forEach((at) => u8.set(ATTACK_TO, at));
        const total = findAll(u8, ATTACK_TO).length;
        if (mem === memory) state.patches.attack = total;
        state.attackPatch = total > 0 ? 'aktif' : 'tidak ditemukan';
        patched += hits.length;
        already += total - hits.length;
      }
    }
    return { ready: true, patched, already };
  }

  function needsPatch() {
    const memory = currentMemory();
    if (!memory) return config.patchMemory || config.attackCheat;
    const p = state.patches && state.patches.memory === memory ? state.patches : null;
    return (config.patchMemory && !(p && p.jutsu)) || (config.attackCheat && !(p && p.attack));
  }

  async function ensurePatched() {
    for (let attempt = 1; attempt <= 20 && state.running; attempt++) {
      const r = patchMemory();
      if (!r.ready) {
        setStatus('Memori game belum tertangkap. Reload halaman setelah extension aktif.');
        return false;
      }
      if (r.patched + r.already > 0) {
        state.lastPatch = `${r.patched} diubah, ${r.already} sudah`;
        setStatus(`Patch memori OK (jurus: ${config.patchMemory ? state.jutsuPatch : 'mati'}; serangan biasa: ${config.attackCheat ? state.attackPatch : 'mati'})`);
        return true;
      }
      setStatus(`Scan memori kosong, coba lagi (${attempt}/20)...`);
      await sleep(1500);
    }
    return false;
  }

  /*
   * Ruffle stores each AS3 number slot as [key:i32][int:i32][double:f64]. The character's current
   * chakra sits between two slots holding 100, with current HP 32 bytes before and gold 32 bytes
   * after; the player's object is the match with the largest gold, pets and enemies carry ~300.
   */
  const chakra = { mem: null, at: -1, lockValue: 0, lastScan: 0 };

  function numberAt(i32, f64, w) {
    if (w < 0 || w + 3 >= i32.length || f64[(w + 2) / 2] !== i32[w + 1]) return null;
    return i32[w + 1];
  }

  function findChakraSlot(memory) {
    const i32 = new Int32Array(memory.buffer);
    const f64 = new Float64Array(memory.buffer);
    let best = -1;
    let bestGold = -1;
    for (let w = 8; w + 12 < i32.length; w += 2) {
      if (f64[(w + 2) / 2] !== i32[w + 1]) continue;
      const value = i32[w + 1];
      if (value < 0 || value > 100000) continue;
      if (numberAt(i32, f64, w - 4) !== 100 || numberAt(i32, f64, w + 4) !== 100) continue;
      const hp = numberAt(i32, f64, w - 8);
      const gold = numberAt(i32, f64, w + 8);
      if (hp === null || hp <= 0 || hp > 100000 || gold === null || gold < 0 || gold === 300) continue;
      if (gold <= bestGold) continue;
      best = w;
      bestGold = gold;
    }
    return best;
  }

  function chakraSlotValid(i32, f64, w) {
    return numberAt(i32, f64, w) !== null && numberAt(i32, f64, w - 4) === 100 && numberAt(i32, f64, w + 4) === 100;
  }

  function lockChakra(forceScan) {
    const memory = currentMemory();
    if (!memory) return false;
    let i32 = new Int32Array(memory.buffer);
    let f64 = new Float64Array(memory.buffer);
    const stale = chakra.mem !== memory || chakra.at < 0 || !chakraSlotValid(i32, f64, chakra.at);
    if (stale || forceScan) {
      if (!forceScan && Date.now() - chakra.lastScan < 5000) return false;
      chakra.lastScan = Date.now();
      chakra.mem = memory;
      chakra.at = findChakraSlot(memory);
      if (chakra.at < 0) return false;
      i32 = new Int32Array(memory.buffer);
      f64 = new Float64Array(memory.buffer);
    }
    const current = i32[chakra.at + 1];
    chakra.lockValue = Math.max(chakra.lockValue, current);
    if (current !== chakra.lockValue) {
      i32[chakra.at + 1] = chakra.lockValue;
      f64[(chakra.at + 2) / 2] = chakra.lockValue;
    }
    return true;
  }

  /*
   * Time lost per mission, by cause: a missed aim, a turn spent on Charge, an enemy click that
   * started no fight, a page arrow that needed a second press, a mission that would not start and
   * waiting on an unknown screen. Totals over all missions give per-mission averages.
   */
  const WASTE_KEY = 'nsBotWaste';
  const WASTE_LABELS = {
    miss: 'serangan meleset',
    charge: 'giliran Charge',
    sprite: 'klik musuh gagal',
    arrow: 'panah diklik ulang',
    startFail: 'misi gagal dibuka',
    unknownMs: 'menunggu layar asing (dtk)',
  };
  const waste = (() => {
    const blank = () => Object.fromEntries(Object.keys(WASTE_LABELS).map((k) => [k, 0]));
    try {
      const saved = JSON.parse(storage.get(WASTE_KEY) || 'null');
      if (saved && saved.total) return { now: blank(), ...saved, blank };
    } catch (e) {
      return { now: blank(), total: blank(), missions: 0, last: null, blank };
    }
    return { now: blank(), total: blank(), missions: 0, last: null, blank };
  })();
  const saveWaste = () => storage.set(WASTE_KEY, JSON.stringify({ now: waste.now, total: waste.total, missions: waste.missions, last: waste.last }));
  function wasted(kind, amount = 1) {
    waste.now[kind] = (waste.now[kind] || 0) + amount;
    saveWaste();
  }
  function closeWaste() {
    for (const k of Object.keys(WASTE_LABELS)) waste.total[k] = (waste.total[k] || 0) + (waste.now[k] || 0);
    waste.missions++;
    waste.last = waste.now;
    waste.now = waste.blank();
    saveWaste();
  }

  const state = {
    running: false,
    missions: 0,
    turns: 0,
    status: 'Idle',
    navigating: false,
    usedThisBattle: new Map(),
  };
  try {
    const saved = JSON.parse(storage.get('nsPlayerColours') || 'null');
    if (Array.isArray(saved)) state.playerColours = new Map(saved);
  } catch (e) {
    state.playerColours = null;
  }
  if (previous) {
    state.missions = previous.missions || 0;
    state.turns = previous.turns || 0;
    state.patchedMemory = previous.patchedMemory;
    state.inMission = previous.inMission;
    state.mapSeenAt = previous.mapSeenAt;
    state.lastPatch = previous.lastPatch;
  }
  if (previousChakra) Object.assign(chakra, previousChakra);

  async function turnPassed(maxMs = 900) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await sleep(30);
      const s = snapBattle();
      if (s && !isMyTurn(s)) return true;
    }
    return false;
  }

  /*
   * A jutsu on cooldown shows its remaining turns as a digit in the icon's bottom-right corner.
   * Icon art differs per jutsu, so each slot's corner is remembered from a turn in which that
   * jutsu fired (it was ready then); a corner that no longer matches is carrying a digit.
   */
  const readyCorners = new Map();
  function cornerPatch(s, slot) {
    const x = SLOT_X[slot - 1];
    const pts = [];
    for (let y = SKILL_Y + 3; y <= SKILL_Y + 21; y += 2) for (let dx = 6; dx <= 24; dx += 2) pts.push(s.px(x + dx, y));
    return pts;
  }

  function onCooldown(s, slot) {
    const ready = readyCorners.get(slot);
    return !!(s && ready && changedShare(ready, cornerPatch(s, slot)) > 0.12);
  }

  async function useSlot(slot, target, s) {
    const corner = s ? cornerPatch(s, slot) : null;
    await click(SLOT_X[slot - 1], SKILL_Y);
    await sleep(150);
    if (target) {
      await click(target.x, target.y);
      await sleep(80);
    }
    await click(...POS.neutral);
    const fired = await turnPassed();
    markSlot(slot, fired);
    if (fired && corner) readyCorners.set(slot, corner);
    return fired;
  }

  /*
   * Cooldowns differ per jutsu and long boss fights outlast them, so a slot is never written off
   * for the whole fight. A slot that fired is retried two turns later; one that did not fire
   * (cooldown or not enough chakra) backs off 2, 4, then 8 turns so failed clicks stay rare.
   */
  function markSlot(slot, fired) {
    const entry = state.usedThisBattle.get(slot) || { fails: 0, retryAt: 0 };
    if (fired) {
      entry.fails = 0;
      entry.retryAt = state.turns + 2;
    } else {
      entry.fails++;
      entry.retryAt = state.turns + Math.min(2 ** entry.fails, 8);
    }
    state.usedThisBattle.set(slot, entry);
  }

  function slotReady(slot, s) {
    if (readyCorners.has(slot)) return !onCooldown(s, slot);
    const entry = state.usedThisBattle.get(slot);
    return !entry || state.turns >= entry.retryAt;
  }

  /*
   * Skills are addressed by bar slot instead of by name, so re-ordering or equipping new jutsu only
   * needs the panel order; any slot missing from the order is still tried last so a newly equipped
   * jutsu gets used without configuration.
   */
  function attackSlots() {
    const heal = Number(config.healSlot) || 0;
    const listed = String(config.slotOrder || '')
      .split(/[^0-9]+/)
      .map(Number)
      .filter((n) => n >= 1 && n <= SLOT_X.length && n !== heal);
    const order = [...new Set(listed)];
    for (let n = 1; n <= SLOT_X.length; n++) if (n !== heal && !order.includes(n)) order.push(n);
    return order;
  }

  async function pressButton(pos, target) {
    await click(...pos);
    await sleep(150);
    if (target) {
      await click(target.x, target.y);
      await sleep(80);
    }
    await click(...POS.neutral);
    return turnPassed();
  }

  async function doTurn(s) {
    if (state.captureBars) {
      const st = stage();
      const f = st && fit(st.canvas.width, st.canvas.height, st);
      if (f) {
        const c = document.createElement('canvas');
        c.width = 560;
        c.height = 70;
        const unit = f.k * (st.swfW / STAGE_W);
        c.getContext('2d').drawImage(st.canvas, f.ox + 210 * unit, f.oy + (450 - CAL_OY) * unit, 560 * unit, 70 * unit, 0, 0, 560, 70);
        state.captureBars.push(c.toDataURL('image/png'));
        if (state.captureBars.length > 6) state.captureBars.shift();
      }
    }
    const b = bars(s);
    const foes = enemies(s);
    const target = foes[0];
    state.turns++;
    setStatus(`Giliran ${state.turns} | HP ${Math.round(b.hp * 100)}% | Chakra ${Math.round(b.chakra * 100)}% | Musuh ${foes.length}`);

    const heal = Number(config.healSlot) || 0;
    if (heal && b.hp < CFG.hpLow && slotReady(heal, s) && (await useSlot(heal, null, s))) return;

    /*
     * Basic-attack mode: with the attack cheat a plain hit already deals 400000, so trying jutsu
     * first (and waiting on each one that is cooling down) only slows the turn.
     */
    if (config.attackStyle !== 'jutsu') {
      /*
       * Attack, then the enemy, with only a frame's pause in between; a target that does not take
       * the hit within ~0.5s is followed straight away by the next detected enemy, then the usual
       * enemy spots, so a missed aim costs half a second instead of a full turn timeout.
       */
      for (const aim of [...foes, ...FALLBACK_TARGETS]) {
        if (!state.running) return;
        await click(...POS.attack);
        await sleep(60);
        await click(aim.x, aim.y);
        await sleep(30);
        await click(...POS.neutral);
        if (await turnPassed(500)) return;
        wasted('miss');
      }
      wasted('charge');
      await pressButton(POS.charge, null);
      return;
    }
    const order = attackSlots();
    if (!target) {
      /*
       * Enemy bars can be hidden (low on screen, behind effects); the first ready jutsu is aimed
       * at the usual enemy spots rather than always the first slot, which may be cooling down.
       */
      const first = order.find((slot) => slotReady(slot, s));
      if (first) {
        for (const guess of FALLBACK_TARGETS) {
          if (await useSlot(first, guess, s)) return;
        }
      }
      if (await pressButton(POS.attack, FALLBACK_TARGETS[0])) return;
      await pressButton(POS.charge, null);
      return;
    }

    for (const slot of order) {
      if (!state.running) return;
      if (!slotReady(slot, s)) continue;
      if (await useSlot(slot, target, s)) return;
    }

    /*
     * Chakra is locked full, so Charge gains nothing; a plain attack (400000 with the attack
     * cheat) is the fallback when every jutsu is cooling down.
     */
    if (await pressButton(POS.attack, target)) return;
    await pressButton(POS.charge, null);
  }

  function currentMemory() {
    const frame = document.querySelector('iframe.game-iframe');
    const memories = frame && frame.contentWindow && frame.contentWindow.__nsMemories;
    return memories && memories.length ? memories[memories.length - 1] : null;
  }

  const isGradePanel = (s) =>
    near(s.px(820, 342), [53, 152, 253], 40) && near(s.px(820, 431), [62, 251, 64], 40) && near(s.px(820, 520), [118, 37, 176], 40);

  async function waitFor(test, maxMs, every = 50) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const s = snap();
      if (s && test(s)) return true;
      await sleep(every);
    }
    return false;
  }

  /*
   * For some characters the Mission Room building first opens a small menu (Mission Room /
   * Challenge Friends / Live PvP) instead of the grade panel; its Mission Room button is clicked
   * until the grade panel's blue/green/purple bars are on screen.
   */
  async function openGradePanel() {
    const first = snap();
    const room = first && findMissionRoomLabel(first);
    if (!room) {
      /*
       * The label is usually hidden by a panel left open; one with a detected red X is closed
       * through it, anything else is left alone.
       */
      const closeX = first && findRedClose(first);
      if (closeX) {
        setStatus('Menutup panel yang menutupi desa...');
        await click(closeX.x, closeX.y);
      } else setStatus('Tulisan "Mission Room" tidak terlihat, tidak mengklik.');
      await sleep(800);
      return 'nolabel';
    }
    const beforeRoom = signature(first, FULL_REGION);
    await click(room.x, room.y);
    if (await waitFor(isGradePanel, 2500)) return true;
    /*
     * Some characters get a small menu (Mission Room / Challenge Friends / Live PvP) first. Its
     * button is pressed only when something did open over the village; if the village is still
     * plainly visible the building click simply missed and nothing else is clicked.
     */
    for (let i = 0; i < 2 && state.running; i++) {
      const now = snap();
      if (!now || changedShare(beforeRoom, signature(now, FULL_REGION)) < 0.08) return false;
      await click(...POS.menuMissionRoom);
      if (await waitFor(isGradePanel, 2500)) return true;
    }
    return false;
  }

  /*
   * A mission list is on screen when the first row's dark title bar is there and neither the
   * grade panel nor the bare village (its "Mission Room" label) is showing; the HUD rank bar stays
   * visible over panels, so it cannot tell. Rows, page arrows and the back button are clicked only
   * then.
   */
  function missionListVisible(s) {
    if (!s || isGradePanel(s) || findMissionRoomLabel(s)) return false;
    let dark = 0;
    for (let x = 480; x <= 700; x += 4) {
      const [r, g, b] = s.px(x, MISSION_ROW_Y[0] - 9);
      if (r + g + b < 520) dark++;
    }
    return dark >= 8;
  }

  const BEST_MISSION_KEY = 'nsBestMission';
  function readBestMission() {
    try {
      return JSON.parse(storage.get(BEST_MISSION_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  /*
   * Missions in a grade are listed by required level, so XP rises down the list and every row
   * after the first padlock is locked too. The best available mission is the last row before the
   * first padlock; a row whose title bar is blank parchment means the list has ended.
   */
  function rowState(s, row) {
    const y = MISSION_ROW_Y[row];
    let gold = 0;
    for (let yy = y - 32; yy <= y + 6; yy += 2) {
      for (let xx = 835; xx <= 895; xx += 2) {
        const [r, g, b] = s.px(xx, yy);
        if (r > 190 && g > 140 && b < 90 && r - b > 120) gold++;
      }
    }
    let dark = 0;
    for (let xx = 480; xx <= 700; xx += 4) {
      const [r, g, b] = s.px(xx, y - 9);
      if (r + g + b < 520) dark++;
    }
    state.scanLog.push(`r${row + 1}:gold${gold}/bar${dark}`);
    if (dark < 8) return 'empty';
    return gold >= 6 ? 'locked' : 'open';
  }

  /*
   * The mission list slides in; at low game speed the first frames still show the previous page or
   * half-drawn rows, which read as "locked" and cut the scan short. Rows are read only once two
   * samples 250ms apart match.
   */
  const MAX_MISSION_PAGES = 30;

  /*
   * The sparse region signature mostly lands on parchment and bar background that every page
   * shares, so a turned page could read as unchanged. Page identity is taken from the title bars
   * instead: every 2px of the three bars is marked bright (title text) or not.
   */
  const PAGE_FP_DIFF = 0.02;

  function listFingerprint(s) {
    if (!s) return null;
    const bits = [];
    for (const y of MISSION_ROW_Y) {
      for (let yy = y - 17; yy <= y - 1; yy += 2) {
        for (let xx = 480; xx <= 800; xx += 2) {
          const [r, g, b] = s.px(xx, yy);
          bits.push(r + g + b >= 520 || (g > 150 && g - r > 40) ? 1 : 0);
        }
      }
    }
    return bits;
  }

  function fpDiff(a, b) {
    if (!a || !b) return 1;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d / a.length;
  }

  async function waitListSettled() {
    let shot = snap();
    let prev = signature(shot, MISSION_LIST_REGION);
    let prevFp = listFingerprint(shot);
    for (let i = 0; i < 20 && state.running; i++) {
      await sleep(150);
      shot = snap();
      const next = signature(shot, MISSION_LIST_REGION);
      const nextFp = listFingerprint(shot);
      if (changedShare(prev, next) < 0.02 && fpDiff(prevFp, nextFp) < PAGE_FP_DIFF / 2) return;
      prev = next;
      prevFp = nextFp;
    }
  }

  /*
   * A turn is judged on the settled list, not on catching the slide: at high speed the slide can
   * fall between samples, and at low speed it can start late. Either way the second press is
   * sent only when the settled titles are still the ones from before the first press.
   */
  async function waitPageTurned(before, maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs && state.running) {
      await sleep(80);
      if (fpDiff(before, listFingerprint(snap())) > PAGE_FP_DIFF) break;
    }
    await waitListSettled();
    return fpDiff(before, listFingerprint(snap())) > PAGE_FP_DIFF;
  }

  /*
   * The Mission Room reopens a grade's list on the page that was viewed last, so "page 1" is not
   * fixed. The list is rewound to its real first page before any page counting, which keeps
   * page/row (and the mission name derived from it) the same on every run.
   */
  async function pressPageArrow(pos) {
    const shot = snap();
    if (!missionListVisible(shot)) return false;
    const before = listFingerprint(shot);
    for (const legacy of [false, true]) {
      if (!state.running) return false;
      if (legacy) wasted('arrow');
      await click(...pos, legacy);
      if (await waitPageTurned(before, 1500)) return true;
      if (!missionListVisible(snap())) return false;
    }
    return false;
  }

  async function rewindMissionList() {
    for (let i = 0; i < 15 && state.running; i++) {
      if (!(await pressPageArrow(POS.prevPage))) return missionListVisible(snap());
    }
    return false;
  }

  /*
   * The list reopens on the page viewed last, so its page is recognised from title fingerprints
   * learned per grade; only a page never seen before needs the rewind (pressing prev until it
   * stops), which is what kept pressing prev on page 1.
   */
  const PAGE_FP_KEY = 'nsPageFps';
  const pageFps = (() => {
    try {
      return JSON.parse(storage.get(PAGE_FP_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  })();

  const packFp = (bits) => {
    let out = '';
    for (let i = 0; i < bits.length; i += 4) out += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | (bits[i + 3] | 0)).toString(16);
    return out;
  };
  const unpackFp = (hex, n) => {
    const bits = [];
    for (const ch of hex) {
      const v = parseInt(ch, 16);
      bits.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
    }
    return bits.slice(0, n);
  };

  function learnPage(grade, page) {
    const fp = listFingerprint(snap());
    if (!fp || !fp.some((v) => v)) return;
    pageFps[grade] = pageFps[grade] || {};
    pageFps[grade][page] = packFp(fp);
    storage.set(PAGE_FP_KEY, JSON.stringify(pageFps));
  }

  function identifyPage(grade) {
    const fp = listFingerprint(snap());
    const known = pageFps[grade] || {};
    let page = 0;
    let best = 1;
    let second = 1;
    for (const [p, hex] of Object.entries(known)) {
      const d = fpDiff(fp, unpackFp(hex, fp ? fp.length : 0));
      if (d < best) {
        second = best;
        best = d;
        page = Number(p);
      } else if (d < second) second = d;
    }
    return best < PAGE_FP_DIFF / 2 && second > PAGE_FP_DIFF ? page : 0;
  }

  async function goToPage(grade, target) {
    await waitListSettled();
    if (!missionListVisible(snap())) return 0;
    let at = identifyPage(grade);
    if (!at) {
      if (!(await rewindMissionList())) return 0;
      at = 1;
    }
    learnPage(grade, at);
    while (at < target && state.running && (await pressPageArrow(POS.nextPage))) learnPage(grade, ++at);
    while (at > target && state.running && (await pressPageArrow(POS.prevPage))) learnPage(grade, --at);
    return at;
  }

  async function scanBestMission(grade) {
    const first = await goToPage(grade, 1);
    state.scanLog = [];
    if (first !== 1) {
      state.scanLog.push('hal1:tak-tercapai');
      return null;
    }
    let best = null;
    let page = 1;
    for (; page <= MAX_MISSION_PAGES && state.running; page++) {
      await waitListSettled();
      const s = snap();
      let stop = false;
      for (let r = 0; r < 3; r++) {
        const st = rowState(s, r);
        if (st === 'open') best = { page, row: r + 1 };
        else {
          stop = true;
          break;
        }
      }
      if (stop) break;
      if (!missionListVisible(snap())) {
        state.scanLog.push(`hal${page}:daftar-tak-terlihat`);
        break;
      }
      if (!(await pressPageArrow(POS.nextPage))) {
        state.scanLog.push(`hal${page}:panah-tak-berubah`);
        break;
      }
      learnPage(grade, page + 1);
    }
    return best;
  }

  async function navigateToMission(fromGradePanel = false) {
    if (needsPatch()) {
      if (!(await ensurePatched())) {
        stopWith('Pola memori tidak ditemukan, bot dihentikan.');
        return;
      }
      state.patchedMemory = currentMemory();
    }
    if (config.lockChakra) lockChakra(true);
    state.navigating = true;
    const stored = readBestMission();
    const slotKey = String(config.characterSlot || 1);
    const scanNow =
      config.autoBestXp &&
      (state.rescanBest || !stored || stored.baseGrade !== config.grade || stored.slot !== slotKey || stored.level !== Number(config.currentLevel || 0));
    const level = Number(config.currentLevel) || 0;
    const fromTable = scanNow && level > 0 && !state.tableMiss ? bestForLevel(level, config.grade) : null;
    const visualScan = scanNow && !fromTable;
    const target = fromTable || (config.autoBestXp && stored && !scanNow ? stored : { grade: config.grade, page: config.page, row: config.row });
    if (fromTable) {
      storage.set(BEST_MISSION_KEY, JSON.stringify({ ...fromTable, baseGrade: config.grade, slot: slotKey, level }));
      state.rescanBest = false;
      syncConfigInputs();
    }

    const clickAndWait = async (pos, region, max) => {
      const before = signature(snap(), region);
      await click(...pos);
      return waitForChange(before, region, max);
    };

    setStatus(visualScan ? 'Mencari misi XP tertinggi...' : `Membuka misi Grade ${target.grade}, hal. ${target.page}, baris ${target.row}...`);
    const opened = fromGradePanel || (await openGradePanel());
    if (opened === 'nolabel') {
      state.navigating = false;
      return;
    }
    if (!opened) {
      setStatus('Panel Grade tidak terbuka, menutup dan mencoba lagi...');
      const s = snap();
      const popupX = s && findRedClose(s);
      if (popupX) await click(popupX.x, popupX.y);
      await sleep(600);
      state.navigating = false;
      return;
    }

    if (visualScan && state.running) {
      /*
       * A low-level character has every mission of the chosen grade locked, so lower grades are
       * scanned in turn; the back button returns from a mission list to the grade buttons.
       */
      const grades = ['A', 'B', 'C'].slice(Math.max(0, ['A', 'B', 'C'].indexOf(config.grade)));
      let found = null;
      for (const grade of grades) {
        if (!state.running) break;
        setStatus(`Mencari misi XP tertinggi di Grade ${grade}...`);
        /*
         * A grade above the character's level only shows a "not enough level" banner and the
         * mission list never opens, so an unchanged panel means skip to the next grade.
         */
        if (!isGradePanel(snap())) break;
        await click(...GRADE_BUTTONS[grade]);
        const opened = await waitFor((s) => !isGradePanel(s), 3000);
        if (!opened) {
          state.scanLog = (state.scanLog || []).concat(`${grade}:terkunci`);
          continue;
        }
        const best = await scanBestMission(grade);
        if (best) {
          /*
           * Every row before the first padlock is open, but XP does not rise on every row, so the
           * highest-XP open mission may sit above the last open row.
           */
          const refined = bestXpUpTo(grade, tableIndex(best)) || { grade, ...best };
          const at = await goToPage(grade, refined.page);
          /*
           * If the list stops short, row 3 of a page between the two is still an open mission (it
           * lies before the last open row), so page, row and name stay consistent.
           */
          if (at === refined.page) found = refined;
          else if (at === best.page) found = { grade, ...best };
          else if (at > refined.page && at < best.page) found = { grade, page: at, row: 3 };
          else state.scanLog.push(`kembali-ke-hal${refined.page}:gagal`);
          break;
        }
        if (!missionListVisible(snap())) break;
        await click(...POS.listBack);
        await waitFor(isGradePanel, 3000);
      }
      state.rescanBest = false;
      if (found) {
        storage.set(BEST_MISSION_KEY, JSON.stringify({ ...found, baseGrade: config.grade, slot: slotKey, level: Number(config.currentLevel || 0) }));
        syncConfigInputs();
        setStatus(`Misi XP tertinggi: Grade ${found.grade}, hal. ${found.page}, baris ${found.row}`);
        await waitListSettled();
        if (state.running && missionListVisible(snap())) await clickAndWait([MISSION_ROW_X, MISSION_ROW_Y[found.row - 1]], MISSION_PANEL_REGION, 1500);
      } else {
        const manual = { grade: config.grade, page: config.page, row: config.row, baseGrade: config.grade, slot: slotKey, level: Number(config.currentLevel || 0) };
        storage.set(BEST_MISSION_KEY, JSON.stringify(manual));
        setStatus(`Pindai tidak menemukan misi terbuka (${state.scanLog.join(' ')}), pakai pengaturan manual`);
        await sleep(1500);
      }
    } else {
      if (state.running && isGradePanel(snap())) {
        await click(...(GRADE_BUTTONS[target.grade] || GRADE_BUTTONS.A));
        await waitFor((s) => !isGradePanel(s), 3000);
      }
      const at = await goToPage(target.grade, Number(target.page) || 1);
      if (at !== Number(target.page)) {
        state.scanLog = [`hal${at}/${target.page}:panah-tak-berubah`];
        setStatus(`Hanya sampai hal. ${at} dari ${target.page}, baris tidak diklik`);
      } else if (state.running && missionListVisible(snap())) {
        await clickAndWait([MISSION_ROW_X, MISSION_ROW_Y[target.row - 1] || MISSION_ROW_Y[0]], MISSION_PANEL_REGION, 1500);
      }
    }
    /*
     * Only the mission-detail checkmark may start a mission; anywhere else a green hit is a grade
     * button or similar. If no mission starts, the panels are closed so the next pass begins
     * from the village instead of clicking green buttons inside the Mission Room.
     */
    let g = null;
    for (let i = 0; i < 80 && state.running && !g; i++) {
      const s = snap();
      const hit = s && findGreenCheck(s);
      g = hit && Math.abs(hit.x - MISSION_START_CHECK[0]) < 45 && Math.abs(hit.y - MISSION_START_CHECK[1]) < 45 ? hit : null;
      if (!g) await sleep(50);
    }
    if (state.running && g) {
      await click(g.x, g.y);
      state.missions++;
      recordMissionStart();
      state.tableMiss = false;
      setStatus(`Misi #${state.missions} dimulai`);
      await sleep(150);
    } else if (state.running) {
      wasted('startFail');
      setStatus('Misi tidak bisa dimulai, menutup panel...');
      for (let i = 0; i < 3; i++) {
        const s = snap();
        if (!s || findMissionRoomLabel(s)) break;
        const closeX = findRedClose(s);
        if (!closeX) break;
        await click(closeX.x, closeX.y);
        await sleep(500);
      }
      state.rescanBest = true;
      /*
       * The level-based pick failed to start, so the level field is probably off; the next pass
       * reads the padlocks on screen instead.
       */
      if (fromTable) state.tableMiss = true;
    }
    state.navigating = false;
  }

  /*
   * Fixed sleeps between menu clicks waste most of the navigation time at high game speed, so each
   * click waits only until a sampled region of the screen visibly changes. The village map is
   * animated, so a step counts as done only when a large share of the sampled points differ.
   */
  const FULL_REGION = { x0: 60, y0: 140, x1: 900, y1: 600, share: 0.35 };
  const MISSION_PANEL_REGION = { x0: 470, y0: 160, x1: 900, y1: 560, share: 0.2 };
  const MISSION_LIST_REGION = { x0: 470, y0: 200, x1: 900, y1: 460, share: 0.15 };

  function signature(s, region) {
    if (!s) return null;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 8; j++) {
        const x = region.x0 + ((region.x1 - region.x0) * (i + 0.5)) / 10;
        const y = region.y0 + ((region.y1 - region.y0) * (j + 0.5)) / 8;
        pts.push(s.px(x, y));
      }
    }
    return pts;
  }

  function changedShare(a, b) {
    if (!a || !b) return 1;
    let changed = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i][0] - b[i][0]) + Math.abs(a[i][1] - b[i][1]) + Math.abs(a[i][2] - b[i][2]) > 60) changed++;
    }
    return changed / a.length;
  }

  async function waitForChange(before, region, maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await sleep(50);
      const now = signature(snap(), region);
      if (changedShare(before, now) >= region.share) {
        await sleep(80);
        return true;
      }
    }
    return false;
  }

  function rufflePanicked() {
    const st = stage();
    const frame = document.querySelector('iframe.game-iframe');
    const player = frame && frame.contentDocument && frame.contentDocument.querySelector('ruffle-player');
    const root = player && player.shadowRoot;
    if (!root) return false;
    const panic = root.querySelector('#panic');
    return !!(panic && panic.offsetParent !== null) || (!st && !!root.querySelector('#message_overlay:not([hidden])'));
  }

  const UNKNOWN_KEY = 'nsBotUnknownScreens';
  function captureUnknownScreen(note = 'layar tak dikenal') {
    const st = stage();
    if (!st) return;
    const f = fit(st.canvas.width, st.canvas.height, st);
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    c.getContext('2d').drawImage(st.canvas, f.ox, f.oy, st.swfW * f.k, st.swfH * f.k, 0, 0, 320, 240);
    let list = [];
    try {
      list = JSON.parse(storage.get(UNKNOWN_KEY) || '[]');
    } catch (e) {
      list = [];
    }
    list.push({ at: new Date().toISOString(), note, status: state.status, image: c.toDataURL('image/jpeg', 0.6) });
    storage.set(UNKNOWN_KEY, JSON.stringify(list.slice(-3)));
  }

  function recover(reason) {
    captureUnknownScreen(`reload: ${reason}`);
    if (!config.autoRecover) {
      storage.set(AUTORUN_KEY, null);
      stopWith(`${reason}. Pulih otomatis dimatikan, bot berhenti.`);
      return;
    }
    storage.set(AUTORUN_KEY, '1');
    state.running = false;
    setStatus(`${reason}, memuat ulang halaman...`);
    setTimeout(() => location.reload(), 800);
  }

  const CHARACTER_SELECT_POINTS = [
    [169, 147, [225, 214, 178]],
    [249, 129, [210, 193, 137]],
    [339, 157, [216, 201, 152]],
    [346, 272, [144, 68, 34]],
    [536, 222, [74, 32, 13]],
    [600, 150, [217, 178, 107]],
    [700, 150, [217, 178, 107]],
  ];
  /*
   * The Level Up screen shares the dialog's black bars with Mission Success; its HP heart and CP
   * icons at fixed spots are what tell it apart, and seeing it is how the bot counts levels.
   */
  function anyPixel(s, cx, cy, radius, test) {
    for (let y = cy - radius; y <= cy + radius; y += 2) {
      for (let x = cx - radius; x <= cx + radius; x += 2) if (test(s.px(x, y))) return true;
    }
    return false;
  }
  const isLevelUpScreen = (s) =>
    anyPixel(s, 490, 307, 10, ([r, g, b]) => r > 200 && g < 90 && b < 130) &&
    anyPixel(s, 492, 347, 10, ([r, g, b]) => b > 150 && r < 110);

  function stopLevelList() {
    return String(config.stopLevels || '')
      .split(/[^0-9]+/)
      .map(Number)
      .filter((n) => n > 0);
  }

  /*
   * Progress figures survive reloads in localStorage. Mission time is the median gap between
   * mission starts (long gaps such as pauses are ignored) and missions per level is the average
   * number of missions between recent level-ups, so the estimate adapts as levels get longer.
   */
  const STATS_KEY = 'nsBotStats';
  const stats = (() => {
    try {
      const saved = JSON.parse(storage.get(STATS_KEY) || 'null');
      if (saved && Array.isArray(saved.starts)) return saved;
    } catch (e) {
      return { since: Date.now(), missions: 0, starts: [], levelMarks: [] };
    }
    return { since: Date.now(), missions: 0, starts: [], levelMarks: [] };
  })();
  const saveStats = () => storage.set(STATS_KEY, JSON.stringify(stats));

  /*
   * MissionDetail.getData in data_library_en.swf, filtered the way the Mission Room lists it
   * (vendor missions, no specials) and sorted by level: button Grade A/B/C = internal grade C/D/E.
   * Entries are [name, level, base XP]; row r on page p is index (p - 1) * 3 + (r - 1).
   */
  const MISSION_TABLE = {
    A: [
      ["Concern of Norobi", 42, 4870],
      ["Request from the Rock Village", 44, 6880],
      ["The Antique Vase", 46, 7810],
      ["The Fire-Thunder Alliance", 48, 8890],
      ["The Mysterious Mist", 50, 10160],
      ["Blacksmith's Trouble", 52, 11630],
      ["The Assassins' Plot", 54, 13330],
      ["The Criminal Gathering", 56, 15320],
      ["Kinjutsu: Marionette Control", 58, 17620],
      ["Fierce Cats Gone Wild", 60, 18950],
      ["Hunt the Rebel", 62, 21470],
      ["The Dessert Ronins", 64, 24880],
      ["The Soil Intruders", 66, 29410],
      ["Fight back for the mining field!", 68, 34760],
      ["Save the temple!", 70, 40290],
      ["Return the valuables", 72, 46730],
      ["Return the wrong delivery", 74, 55180],
      ["Mystery Shadow", 76, 65130],
      ["The Legendary Weapon", 78, 76840],
    ],
    B: [
      ["Where are the Hooligans?", 20, 624],
      ["Night Rebellion", 21, 620],
      ["Canine Tooth Collection", 22, 710],
      ["Phantom Ninja", 23, 800],
      ["War with Samurai", 24, 900],
      ["The Ninja Assassinates", 25, 1020],
      ["Zuka's Request", 26, 1150],
      ["Toxic Crisis", 27, 1290],
      ["Medicine Research", 28, 1450],
      ["Crazy Marionette", 29, 1630],
      ["The Secret Package from Yuna", 30, 1820],
      ["Help the Snow Village", 31, 2040],
      ["The Skeletons", 32, 2280],
      ["Escaped Prisoner - Hanjiro", 33, 2540],
      ["Escort Kaiza", 34, 2840],
      ["Wind Village Defend", 35, 3160],
      ["Urgent Request from Michi", 36, 3520],
      ["Violent Hooligans", 37, 3910],
      ["Merchant Assassination", 38, 4350],
      ["Mountain Bandits", 39, 4600],
    ],
    C: [
      ["Hardworking Student", 1, 20],
      ["Blacksmith's Request", 2, 40],
      ["Weaver's Request", 3, 60],
      ["Confidential Document", 3, 60],
      ["Michi's Request", 4, 70],
      ["Conflicts with the Samurai", 4, 80],
      ["Yuna's Request", 5, 80],
      ["Grandmother's Gift", 6, 150],
      ["Find the Antidote", 6, 150],
      ["Fake Worshippers", 7, 260],
      ["Enemies for Interrogation", 7, 260],
      ["Attack from Ninja Pirates", 8, 300],
      ["The Mysterious Light", 8, 300],
      ["Protect Princess Takara", 9, 320],
      ["The Desert Bandits", 9, 320],
      ["Escort the Merchant", 10, 335],
      ["Kusuma's Request", 10, 335],
      ["Kage's Son", 11, 350],
      ["Explosive Mines", 11, 350],
      ["It's the Samurai Again", 12, 370],
      ["Catch the Insurrectionists", 12, 370],
      ["Escaped Criminals", 13, 400],
      ["Assassinate the Ninja Spy Leader", 13, 400],
      ["Undead Marionette", 14, 420],
      ["Arrest Desert Clawman", 14, 420],
      ["Kenta's Favor", 15, 450],
      ["Sea Robbers are Back", 15, 480],
      ["Trouble from Hooligans", 16, 450],
      ["Rescue Action", 17, 510],
      ["Clear Main Artery", 17, 540],
      ["Troublesome Water Ninja", 18, 570],
      ["Assassination of Shin", 18, 570],
      ["Threatening Soil Village", 19, 600],
    ],
  };

  /*
   * Page/row are counted from the list's real first page (the list is rewound before use), so
   * they index straight into the grade's table.
   */
  function missionInfo(m = currentTarget()) {
    const list = MISSION_TABLE[m.grade] || [];
    const entry = list[(Number(m.page) - 1) * 3 + (Number(m.row) - 1)];
    return entry ? { name: entry[0], level: entry[1], xp: entry[2], exact: true } : null;
  }

  const tableIndex = (m) => (Number(m.page) - 1) * 3 + (Number(m.row) - 1);
  const fromIndex = (grade, i) => ({ grade, page: Math.floor(i / 3) + 1, row: (i % 3) + 1 });

  function bestXpUpTo(grade, maxIndex) {
    const list = MISSION_TABLE[grade] || [];
    let best = -1;
    for (let i = 0; i <= Math.min(maxIndex, list.length - 1); i++) {
      if (best < 0 || list[i][2] >= list[best][2]) best = i;
    }
    return best < 0 ? null : fromIndex(grade, best);
  }

  /*
   * Highest base XP among missions whose required level is at most the character's, from the
   * chosen grade downwards; on equal XP the higher grade and the later (higher-level) row win.
   */
  function bestForLevel(level, baseGrade) {
    const grades = ['A', 'B', 'C'].slice(Math.max(0, ['A', 'B', 'C'].indexOf(baseGrade)));
    let pick = null;
    let xp = -1;
    for (const grade of grades) {
      (MISSION_TABLE[grade] || []).forEach(([, need, gain], i) => {
        if (need <= level && (gain > xp || (gain === xp && pick.grade === grade))) {
          xp = gain;
          pick = fromIndex(grade, i);
        }
      });
    }
    return pick;
  }

  function currentTarget() {
    const best = config.autoBestXp ? readBestMission() : null;
    return best || { grade: config.grade, page: config.page, row: config.row };
  }

  const missionKey = (m = currentTarget()) => `${m.grade}-${m.page}-${m.row}`;

  function missionStats(key = missionKey()) {
    stats.byMission = stats.byMission || {};
    if (!stats.byMission[key]) stats.byMission[key] = { starts: [], xpGains: [] };
    return stats.byMission[key];
  }

  /*
   * Jutsu order and heal slot are kept per mission (grade-page-row), so switching to another
   * mission restores the setup used there, and editing them only changes the current mission.
   */
  const PROFILE_FIELDS = ['slotOrder', 'healSlot'];

  function applyMissionProfile() {
    const key = missionKey();
    config.profiles = config.profiles || {};
    const profile = config.profiles[key];
    if (profile) PROFILE_FIELDS.forEach((f) => {
      if (profile[f] !== undefined) config[f] = profile[f];
    });
    else config.profiles[key] = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, config[f]]));
    saveConfig();
    syncConfigInputs();
  }

  function saveMissionProfile() {
    config.profiles = config.profiles || {};
    config.profiles[missionKey()] = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, config[f]]));
  }

  function recordMissionStart() {
    state.inMission = true;
    closeMissionSteps();
    applyMissionProfile();
    stats.missions++;
    if (stats.missions > 1) closeWaste();
    turboMissionDone();
    stats.starts = stats.starts.concat(Date.now()).slice(-40);
    const mine = missionStats();
    mine.starts = mine.starts.concat({ t: Date.now(), x: currentSpeed() }).slice(-60);
    saveStats();
  }

  function recordLevelUp() {
    stats.levelMarks = stats.levelMarks.concat(stats.missions).slice(-8);
    saveStats();
  }

  function resetStats() {
    waste.now = waste.blank();
    waste.total = waste.blank();
    waste.missions = 0;
    waste.last = null;
    saveWaste();
    stats.since = Date.now();
    stats.missions = 0;
    stats.starts = [];
    stats.byMission = {};
    stats.levelMarks = [];
    saveStats();
  }

  /*
   * Formula.getXpByLv in the game: going from level L to L+1 needs round(L * 130 * 50^(L/50)) XP
   * (L=51 gives 358478, as the HUD shows). The XP values themselves are obfuscated in memory, so
   * progress is read from the HUD XP bar, which runs from x=88 to x=251 at y=119 in the village.
   */
  const xpNeed = (level) => Math.round(level * 130 * Math.pow(50, level / 50));

  /*
   * The HUD prints "current / needed" XP in white over the bar. Glyph samples (an 8x12 whiteness
   * mask normalised against the local background, plus width/height ratio) were taken from two
   * HUD captures covering every digit over several bar colours; each glyph takes its nearest
   * sample and must beat every other character clearly. A reading is accepted only when the needed figure equals
   * xpNeed(L) for some level L, which also tells the level exactly.
   */
  const HUD_TPL = {"2":[[0.62,[0.2,0.8,1.3,1.4,1.3,1.2,0.4,-0.6,0.7,0.8,0.5,0.1,0.5,1.4,1.6,0.1,-0.4,-0.5,-0.9,-1.0,-0.7,0.6,1.7,0.7,-1.0,-1.0,-1.0,-1.0,-1.0,0.1,1.5,0.8,-1.0,-1.0,-1.0,-1.0,-0.8,0.5,1.5,0.4,-1.1,-1.1,-1.1,-1.1,-0.2,1.2,1.0,-0.5,-1.2,-1.2,-1.2,-0.8,1.0,0.2,-0.9,-1.2,-1.2,-1.2,-0.8,0.4,0.4,-0.9,-1.2,-1.2,-1.2,-0.8,0.4,1.2,-0.7,-1.2,-1.2,-1.2,0.4,1.3,0.6,-0.6,-1.1,-1.1,-1.1,-1.1,1.6,1.5,0.6,0.0,0.0,0.0,0.0,0.0,1.7,1.5,1.3,1.3,1.3,1.3,1.3,1.3]],[0.67,[1.5,1.4,0.8,0.5,0.9,1.3,1.3,0.2,0.6,0.2,-0.4,-0.6,-0.3,0.7,1.7,0.8,-0.5,-0.6,-0.6,-0.6,-0.6,0.1,1.4,0.9,-0.6,-0.6,-0.6,-0.6,-0.6,0.2,1.4,0.9,-0.8,-0.8,-0.8,-0.8,-0.4,1.0,1.4,0.0,-1.2,-1.2,-1.2,-1.2,0.5,1.3,0.3,-0.9,-1.3,-1.3,-1.3,-1.1,1.5,0.9,-0.6,-1.3,-1.3,-1.3,-1.1,-0.0,1.1,-0.3,-1.2,-1.3,-1.1,-0.0,1.3,1.1,-1.2,-1.3,-1.3,-1.3,-0.0,1.4,1.2,-0.2,-1.3,-1.3,-1.3,-1.3,1.4,1.8,0.7,-0.3,-0.5,-0.5,-0.5,-0.5,1.8,1.6,1.2,1.0,1.0,1.0,1.0,1.0]],[0.67,[0.7,0.8,0.5,0.1,0.7,1.3,0.6,-0.7,0.3,-0.3,-0.9,-1.2,-0.8,0.6,1.5,0.2,-1.1,-1.2,-1.3,-1.3,-1.3,-0.2,1.3,0.7,-1.3,-1.3,-1.3,-1.3,-1.3,-0.4,1.2,0.7,-1.3,-1.3,-1.3,-1.3,-0.8,0.7,1.5,-0.1,-1.3,-1.3,-1.3,-1.3,0.2,1.2,0.5,-0.8,-1.1,-1.1,-1.1,-0.9,1.2,0.9,-0.5,-1.1,-1.0,-0.9,-0.7,0.2,1.1,-0.0,-0.8,-1.0,-0.3,0.4,1.3,1.3,-0.4,-0.5,-0.5,-0.5,0.6,1.4,1.4,0.5,-0.2,-0.2,-0.2,-0.2,1.5,1.6,1.0,0.5,0.4,0.4,0.4,0.4,1.8,1.6,1.4,1.3,1.3,1.3,1.3,1.3]]],"1":[[0.33,[-0.4,-0.1,0.2,0.6,1.1,1.2,1.4,1.6,0.7,0.9,1.2,1.0,0.7,0.6,1.1,1.6,0.8,0.7,0.5,0.1,0.0,0.3,1.0,1.6,-0.3,-0.4,-0.6,-0.7,-0.2,0.3,1.0,1.6,-0.9,-0.9,-0.9,-0.9,-0.3,0.3,0.9,1.6,-1.1,-1.1,-1.1,-1.1,-0.4,0.2,0.9,1.6,-1.2,-1.2,-1.2,-1.2,-0.5,0.2,0.9,1.6,-1.2,-1.2,-1.2,-1.2,-0.5,0.2,0.9,1.6,-1.2,-1.2,-1.2,-1.2,-0.5,0.2,0.9,1.6,-1.2,-1.2,-1.2,-1.2,-0.5,0.2,0.9,1.6,-1.2,-1.2,-1.2,-1.2,-0.5,0.2,0.9,1.6,-1.2,-1.2,-1.2,-1.2,-0.5,0.1,0.8,1.4]],[0.4,[-1.5,-1.1,0.0,0.8,1.8,1.9,0.8,-0.3,-0.7,0.1,0.7,0.5,0.7,1.3,0.8,-0.3,0.8,0.7,-0.3,-1.0,-0.3,0.8,0.9,-0.3,0.0,-0.5,-1.3,-1.5,-0.3,0.9,0.9,-0.2,-1.5,-1.5,-1.5,-1.5,-0.1,0.9,0.9,-0.1,-1.5,-1.5,-1.5,-1.5,-0.0,1.0,1.0,-0.0,-1.5,-1.5,-1.5,-1.5,0.0,1.0,1.0,0.0,-1.5,-1.5,-1.5,-1.5,0.1,1.1,1.1,0.2,-1.0,-1.0,-1.0,-1.0,0.5,1.2,1.2,0.5,-0.6,-0.6,-0.6,-0.6,0.7,1.3,1.3,0.7,-0.2,-0.2,-0.2,-0.2,0.9,1.4,1.4,0.9,0.3,0.3,0.3,0.3,1.1,1.5,1.5,1.1]]],"8":[[0.62,[-0.9,0.3,1.0,1.2,1.0,0.9,-0.1,-1.2,0.5,1.1,0.3,-0.4,-0.4,0.5,1.1,0.1,1.4,0.7,-1.1,-1.8,-1.8,-0.7,1.1,0.9,1.0,0.7,-1.0,-1.7,-1.6,-0.7,0.9,0.6,-0.2,0.8,0.3,-0.7,-0.3,0.7,0.9,-0.4,-1.4,-0.1,1.1,1.0,1.1,0.6,-0.6,-1.4,0.0,1.0,0.4,-0.4,0.2,0.9,0.8,-0.5,1.3,0.5,-1.2,-1.8,-1.4,-0.3,1.2,0.6,1.5,-0.3,-1.8,-1.8,-1.8,-1.4,0.3,1.3,1.3,-0.4,-1.8,-1.8,-1.8,-1.6,0.0,1.2,1.1,0.8,-0.2,-0.9,-0.9,-0.3,1.0,0.6,-0.5,0.6,1.1,0.7,0.7,0.6,0.3,-0.8]],[0.67,[0.1,1.1,0.9,0.4,0.2,1.0,1.3,0.1,1.0,0.9,-0.4,-0.9,-1.1,-0.1,1.3,0.7,1.3,0.4,-1.1,-1.2,-1.2,-0.8,0.7,0.9,1.0,0.7,-0.8,-1.2,-1.2,-0.5,0.9,0.6,-0.7,0.6,1.1,0.7,0.7,0.8,-0.2,-1.2,-1.6,-0.6,1.0,1.6,1.7,0.8,-1.0,-1.7,-0.7,0.3,0.6,0.1,0.5,0.9,0.1,-1.1,0.8,0.9,-0.6,-1.5,-1.2,-0.1,0.9,0.2,1.0,-0.7,-1.7,-1.7,-1.7,-1.7,-0.2,1.5,1.3,-0.4,-1.7,-1.7,-1.7,-1.5,0.0,1.2,1.1,0.6,-0.9,-1.6,-1.3,-0.2,1.1,0.8,-0.1,1.0,0.6,0.0,0.3,1.1,1.0,-0.4]],[0.67,[-0.4,0.8,0.6,-0.1,-0.3,0.6,1.1,-0.5,0.7,0.5,-1.1,-1.6,-1.8,-0.7,1.0,0.3,1.1,-0.0,-1.8,-1.8,-1.8,-1.4,0.3,0.5,0.8,0.4,-1.4,-1.8,-1.8,-1.0,0.6,0.2,-1.0,0.4,0.9,0.1,0.4,0.6,-0.4,-1.5,-1.7,-0.7,0.9,1.3,1.6,0.7,-1.0,-1.8,-0.7,0.4,0.6,0.1,0.5,0.8,0.1,-1.1,0.8,1.1,-0.3,-1.4,-1.1,-0.1,0.9,0.2,1.1,-0.3,-1.3,-1.3,-1.3,-1.3,0.0,1.5,1.2,-0.0,-0.9,-0.9,-0.9,-0.7,0.4,1.5,1.3,0.8,0.0,-0.2,-0.2,0.3,1.1,1.4,1.0,1.3,1.1,0.9,0.9,1.2,1.3,0.9]]],"0":[[0.62,[-0.7,0.4,1.1,1.2,1.0,1.0,0.2,-0.7,0.2,1.1,0.7,-0.0,0.1,1.0,1.3,-0.0,1.0,0.9,-0.5,-1.1,-1.0,0.0,1.3,0.7,1.5,0.1,-1.1,-1.1,-1.1,-1.0,0.4,1.4,1.3,-0.1,-1.1,-1.1,-1.1,-1.1,0.3,1.7,1.3,-0.2,-1.2,-1.2,-1.2,-1.2,0.2,1.7,1.1,-0.4,-1.4,-1.4,-1.4,-1.4,-0.0,1.5,1.3,-0.2,-1.4,-1.4,-1.4,-1.4,0.1,1.7,1.4,-0.0,-1.4,-1.4,-1.4,-1.2,0.3,1.5,0.8,0.7,-0.7,-1.3,-1.3,-0.5,0.9,0.8,-0.0,0.8,0.4,-0.3,-0.1,0.8,0.9,-0.2,-1.1,-0.0,0.9,1.0,1.1,1.1,-0.0,-1.1]],[0.67,[0.3,1.3,1.2,0.5,0.5,1.0,0.7,-0.3,1.0,1.2,0.2,-0.6,-0.6,0.2,1.1,0.6,1.5,0.6,-0.6,-0.7,-0.7,-0.3,0.9,1.0,1.5,0.3,-0.7,-0.7,-0.7,-0.6,0.7,1.2,1.3,-0.1,-1.0,-1.0,-1.0,-1.0,0.3,1.7,1.3,-0.3,-1.3,-1.3,-1.3,-1.3,-0.0,1.5,1.3,-0.3,-1.5,-1.5,-1.5,-1.5,-0.1,1.5,1.3,-0.3,-1.5,-1.5,-1.5,-1.5,0.1,1.7,1.4,0.1,-1.5,-1.5,-1.5,-1.1,0.5,1.2,0.9,0.6,-1.0,-1.4,-1.4,-0.7,0.9,0.7,0.3,1.2,0.1,-0.8,-0.8,0.3,1.1,-0.1,-0.7,0.6,0.9,0.6,0.6,0.9,0.2,-1.0]],[0.67,[-0.4,0.9,0.9,0.2,0.4,0.9,0.1,-1.1,0.7,1.0,-0.3,-1.1,-1.0,-0.0,0.7,-0.0,1.1,0.2,-1.2,-1.5,-1.5,-0.9,0.6,0.7,1.1,-0.3,-1.5,-1.5,-1.5,-1.2,0.3,0.9,1.1,-0.4,-1.5,-1.5,-1.5,-1.5,-0.0,1.5,1.1,-0.4,-1.5,-1.5,-1.5,-1.5,-0.2,1.3,1.1,-0.3,-1.3,-1.3,-1.3,-1.3,-0.1,1.3,1.2,-0.2,-1.2,-1.2,-1.2,-1.2,0.2,1.5,1.3,0.3,-0.7,-0.7,-0.7,-0.5,0.6,1.2,1.2,0.8,-0.1,-0.4,-0.4,0.1,1.0,1.0,0.9,1.3,0.7,0.1,0.1,0.8,1.3,0.7,0.6,1.2,1.3,1.0,1.0,1.3,1.2,0.6]]],"/":[[0.47,[-0.5,-0.5,-0.5,-0.5,-0.3,1.0,2.0,1.9,-0.5,-0.5,-0.5,-0.5,0.2,1.7,1.6,0.8,-0.5,-0.5,-0.5,-0.5,0.6,2.0,1.0,-0.2,-0.5,-0.5,-0.5,-0.3,1.0,2.0,0.7,-0.5,-0.6,-0.6,-0.6,0.7,1.9,0.8,-0.5,-0.6,-0.8,-0.8,-0.6,1.0,1.7,0.1,-0.8,-0.8,-1.0,-0.9,-0.0,1.6,1.3,-0.4,-1.0,-1.0,-1.0,-0.7,0.8,1.9,0.6,-0.8,-1.0,-1.0,-0.9,0.1,1.8,0.9,-0.8,-1.0,-1.0,-1.0,-0.4,0.8,1.9,0.4,-1.0,-1.0,-1.0,-1.0,0.8,1.6,1.4,-0.2,-1.0,-1.0,-1.0,-1.0,1.8,1.8,0.6,-0.8,-1.0,-1.0,-1.0,-1.0]],[0.4,[-0.3,-0.3,-0.3,-0.3,-0.3,0.7,1.6,1.5,-0.3,-0.3,-0.3,-0.3,-0.1,1.0,1.3,0.6,-0.3,-0.3,-0.3,-0.3,0.8,1.4,1.0,-0.0,-0.3,-0.3,-0.2,-0.1,1.7,1.6,0.7,-0.2,-0.6,-0.6,0.4,1.4,2.0,0.8,-0.5,-0.6,-0.9,-0.7,0.6,1.7,1.5,0.3,-0.9,-0.9,-1.1,-0.3,1.3,2.0,0.2,-0.4,-1.1,-1.1,-1.0,0.3,1.6,1.5,-0.8,-0.9,-1.1,-1.1,0.5,1.3,0.9,-0.2,-1.1,-1.1,-1.1,-1.1,1.7,1.6,0.3,-0.8,-1.1,-1.1,-1.1,-1.1,2.1,1.1,-0.5,-1.1,-1.1,-1.1,-1.1,-1.1,1.9,0.5,-1.0,-1.1,-1.1,-1.1,-1.1,-1.1]],[0.4,[-0.7,-0.7,-0.7,-0.7,-0.7,0.5,1.7,1.6,-0.7,-0.7,-0.7,-0.7,-0.3,0.9,1.6,1.2,-0.7,-0.7,-0.7,-0.7,0.7,1.4,1.2,0.4,-0.7,-0.7,-0.5,-0.3,1.7,1.6,0.5,-0.5,-0.8,-0.8,0.1,1.0,2.0,0.7,-0.7,-0.8,-0.9,-0.6,0.6,1.7,1.5,0.3,-0.9,-0.9,-0.9,-0.1,1.3,2.0,0.3,-0.3,-0.9,-0.9,-0.9,0.4,1.6,1.6,-0.6,-0.8,-0.9,-0.9,0.6,1.3,1.2,0.3,-0.9,-0.9,-0.9,-0.9,1.7,1.6,0.4,-0.6,-0.9,-0.9,-0.9,-0.9,2.0,1.2,-0.3,-0.9,-0.9,-0.9,-0.9,-0.9,1.9,0.6,-0.8,-0.9,-0.9,-0.9,-0.9,-0.9]],[0.47,[-1.2,-1.2,-1.2,-1.2,-1.2,0.2,1.6,1.5,-1.2,-1.2,-1.2,-1.2,-1.0,0.6,1.5,1.0,-1.2,-1.2,-1.2,-1.2,-0.4,1.2,1.0,0.1,-1.2,-1.2,-1.2,-1.0,0.4,1.5,0.2,-0.9,-1.2,-1.2,-1.1,-0.1,1.4,0.6,-1.0,-1.2,-1.0,-1.0,-0.8,0.6,1.6,0.2,-1.0,-1.0,-0.9,-0.9,-0.1,1.3,1.2,-0.3,-0.9,-0.9,-0.7,-0.7,0.5,1.7,0.6,-0.6,-0.7,-0.7,-0.2,0.3,1.5,1.4,0.2,-0.3,-0.3,-0.3,0.3,1.0,1.7,1.0,0.1,0.0,0.0,0.0,0.8,1.4,1.6,0.8,0.3,0.3,0.3,0.3,1.4,1.7,1.5,0.8,0.7,0.7,0.7,0.7]]],"4":[[0.73,[-0.7,-0.7,-0.7,-0.6,-0.0,1.6,1.2,-0.1,-0.7,-0.7,-0.7,-0.1,1.0,1.6,1.2,-0.1,-0.7,-0.7,-0.5,0.7,1.3,1.1,1.2,-0.1,-0.7,-0.7,-0.1,1.3,0.6,0.7,1.2,-0.1,-0.9,-0.4,0.8,0.0,-0.8,0.5,1.2,-0.3,-1.1,0.3,0.6,-1.1,-1.3,0.3,1.1,-0.6,-0.6,1.1,-0.0,-1.5,-1.5,0.2,1.1,-0.7,0.6,1.1,-0.7,-1.3,-1.3,0.3,1.2,-0.6,1.3,1.3,1.3,1.3,1.3,1.6,2.0,1.6,-0.4,-0.4,-0.4,-0.4,-0.4,0.7,1.5,0.3,-1.5,-1.5,-1.5,-1.5,-1.5,0.2,1.1,-0.7,-1.5,-1.5,-1.5,-1.5,-1.5,0.1,0.9,-0.8]],[0.73,[-1.1,-1.1,-1.1,-1.0,-0.2,1.5,1.2,-0.3,-1.1,-1.1,-1.1,-0.6,0.7,1.6,1.2,-0.3,-1.1,-1.1,-0.9,0.4,1.2,1.0,1.2,-0.3,-1.1,-1.1,-0.3,1.2,0.5,0.6,1.2,-0.3,-1.1,-0.9,0.7,0.0,-1.0,0.4,1.2,-0.4,-1.0,0.1,0.6,-0.9,-1.2,0.4,1.2,-0.5,-0.3,1.2,0.3,-1.2,-1.2,0.4,1.2,-0.5,0.7,1.4,-0.2,-1.1,-1.1,0.5,1.3,-0.3,1.4,1.4,1.4,1.4,1.4,1.6,2.0,1.7,-0.2,-0.2,-0.2,-0.2,-0.2,0.8,1.6,0.4,-1.2,-1.2,-1.2,-1.2,-1.2,0.4,1.2,-0.5,-1.2,-1.2,-1.2,-1.2,-1.2,0.3,1.0,-0.5]],[0.8,[-1.4,-1.4,-1.4,-1.4,1.0,1.8,-0.7,-1.4,-1.4,-1.4,-1.4,-1.0,1.0,1.3,-0.7,-1.4,-1.4,-1.4,-1.2,0.1,0.2,0.7,-0.7,-1.4,-1.4,-1.4,-0.3,1.0,-0.5,0.8,-0.7,-1.4,-1.3,-1.1,1.1,-0.1,-0.6,1.0,-0.6,-1.4,-1.0,0.0,0.3,-0.9,-0.5,1.0,-0.5,-1.3,-0.3,1.1,-0.5,-1.1,-0.4,1.1,-0.4,-1.1,0.7,1.3,-0.6,-0.8,-0.1,1.2,-0.1,-0.8,1.4,1.4,1.4,1.4,1.4,1.6,1.6,1.1,0.5,0.5,0.5,0.5,0.8,1.4,0.9,0.4,0.1,0.1,0.1,0.1,0.6,1.4,0.6,0.1,0.5,0.5,0.5,0.5,0.9,1.5,0.9,0.5]]],"3":[[0.67,[1.5,1.4,0.8,0.4,1.0,1.5,1.3,0.0,0.4,-0.1,-0.6,-0.9,-0.4,0.5,1.6,0.9,-0.9,-1.1,-1.1,-1.1,-1.1,-0.3,1.2,1.2,-1.1,-1.1,-1.1,-1.1,-1.0,-0.0,1.5,0.9,-1.1,-0.6,-0.2,-0.2,1.0,1.1,0.4,-0.7,-1.2,-0.1,1.1,1.1,1.7,0.8,-0.5,-1.1,-1.3,-0.6,0.1,0.3,0.7,0.9,0.7,-0.3,-1.3,-1.3,-1.3,-1.1,-0.6,0.4,1.5,0.9,-1.3,-1.3,-1.3,-1.3,-1.3,-0.9,0.8,1.8,-1.2,-1.2,-1.2,-1.3,-1.2,-0.6,1.1,1.5,-0.3,-0.7,-0.9,-1.1,-0.5,0.5,1.6,1.0,1.1,0.7,0.6,0.4,1.0,1.5,1.3,-0.1]],[0.73,[-0.3,1.3,0.9,0.1,0.1,0.9,1.0,-0.4,-0.6,0.1,-0.7,-1.3,-1.3,-0.3,1.4,0.6,-1.3,-1.3,-1.4,-1.4,-1.4,-0.9,1.0,0.9,-1.4,-1.4,-1.4,-1.4,-1.4,-0.7,1.2,0.7,-1.4,-1.4,-0.8,-0.4,-0.0,0.8,0.2,-0.9,-1.4,-1.4,0.2,1.0,1.4,1.0,-0.6,-1.3,-1.2,-1.2,-0.3,0.3,0.5,0.7,0.6,-0.3,-1.0,-1.0,-1.0,-0.9,-0.7,0.1,1.5,0.9,-0.5,-0.5,-0.5,-0.5,-0.5,-0.3,1.0,1.7,-0.2,-0.2,-0.2,-0.2,-0.2,0.1,1.3,1.6,0.7,0.6,0.3,0.2,0.3,0.8,1.7,1.4,1.4,1.5,1.3,1.2,1.3,1.6,1.7,1.1]]],"5":[[0.67,[0.7,1.8,1.3,1.0,1.0,1.0,0.8,-0.2,0.8,1.4,0.1,-0.5,-0.5,-0.5,-0.5,-0.8,0.9,1.2,-0.4,-1.1,-1.1,-1.1,-1.1,-1.1,1.0,1.0,-0.6,-1.0,-1.1,-1.1,-1.1,-1.1,1.1,1.4,0.8,0.8,0.8,0.4,-0.4,-1.1,0.5,1.1,0.9,0.9,1.3,1.5,1.1,-0.3,-0.6,-0.5,-0.6,-0.6,-0.3,0.3,1.5,0.9,-1.3,-1.3,-1.3,-1.3,-1.3,-0.8,0.9,1.5,-1.3,-1.3,-1.3,-1.3,-1.3,-1.1,0.6,1.8,-1.2,-1.3,-1.3,-1.3,-1.2,-0.6,1.0,1.3,-0.3,-0.8,-0.9,-1.1,-0.5,0.5,1.5,0.6,1.0,0.7,0.6,0.4,0.9,1.2,0.9,-0.4]],[0.6,[1.9,1.2,0.8,0.8,0.8,0.8,0.6,-0.1,1.5,0.2,-0.4,-0.4,-0.4,-0.4,-0.4,-0.5,1.3,-0.1,-0.6,-0.6,-0.6,-0.6,-0.6,-0.6,1.2,-0.2,-0.6,-0.6,-0.6,-0.6,-0.6,-0.6,1.6,1.0,0.9,1.0,1.0,0.8,0.1,-0.6,0.9,0.7,0.5,0.7,1.2,1.6,1.4,-0.1,-0.7,-0.9,-1.1,-0.9,-0.5,0.3,1.6,0.9,-1.4,-1.4,-1.4,-1.4,-1.4,-0.9,0.9,1.5,-1.4,-1.4,-1.4,-1.4,-1.4,-1.2,0.6,1.9,-1.4,-1.4,-1.4,-1.4,-1.4,-0.5,1.3,1.3,-0.5,-0.9,-0.9,-0.7,-0.5,0.6,1.5,0.3,1.1,0.7,0.7,0.9,1.1,1.0,0.3,-0.9]]],"6":[[0.67,[-1.1,-0.1,0.9,0.9,0.2,-0.0,0.2,-0.5,-0.5,1.0,1.2,0.0,-1.2,-1.3,-1.2,-1.2,0.3,1.3,0.2,-1.0,-1.3,-1.3,-1.3,-1.3,1.1,0.9,-0.7,-1.3,-1.3,-1.3,-1.3,-1.3,1.6,0.5,-0.1,0.4,0.7,0.5,0.0,-0.9,1.6,1.1,0.8,0.4,0.2,0.9,1.3,0.3,1.8,1.0,-0.3,-1.0,-1.1,-0.4,1.0,1.4,1.5,0.1,-1.2,-1.3,-1.3,-1.2,0.1,1.5,1.5,0.0,-1.3,-1.3,-1.3,-1.3,-0.2,1.4,1.2,0.6,-0.9,-1.3,-1.3,-1.1,0.3,1.3,0.4,1.3,0.2,-0.9,-0.9,0.1,1.2,0.7,-0.6,0.6,0.9,0.5,0.5,1.2,1.1,-0.3]]],"7":[[0.67,[0.9,0.9,0.9,0.9,0.9,0.9,1.5,2.0,-0.7,-0.7,-0.7,-0.7,-0.7,-0.4,0.9,1.5,-1.3,-1.3,-1.3,-1.3,-1.3,-0.4,1.2,0.7,-1.3,-1.3,-1.3,-1.3,-1.0,0.4,1.5,0.1,-1.3,-1.3,-1.3,-1.3,0.5,1.6,0.3,-1.1,-1.2,-1.2,-1.2,-1.2,1.3,1.1,-0.5,-1.2,-1.1,-1.1,-1.1,-0.8,1.6,0.4,-0.9,-1.1,-0.9,-0.9,-0.9,-0.1,1.2,-0.2,-0.9,-0.9,-0.4,-0.4,0.3,1.5,0.3,-0.4,-0.4,-0.4,-0.1,-0.0,0.9,1.9,0.2,-0.1,-0.1,-0.1,0.3,0.5,1.4,1.9,0.3,0.3,0.3,0.3,0.7,1.2,1.9,1.7,0.7,0.7,0.7,0.7]]],"9":[[0.67,[-0.1,1.1,0.9,0.0,0.3,1.0,0.1,-1.3,0.9,0.7,-0.7,-1.5,-1.2,-0.2,0.6,-0.1,1.1,-0.3,-1.7,-1.7,-1.7,-1.4,0.3,0.7,1.2,-0.6,-1.7,-1.7,-1.7,-1.7,0.0,1.2,1.4,-0.2,-1.7,-1.7,-1.7,-1.3,0.4,1.7,1.1,0.6,-0.8,-1.4,-1.2,-0.1,1.2,1.7,-0.0,1.1,0.7,0.2,0.3,0.4,0.9,1.6,-1.1,-0.1,0.4,0.6,0.2,-0.5,0.4,1.4,-1.1,-1.1,-1.1,-1.1,-1.0,-0.3,1.0,0.9,-0.7,-0.7,-0.7,-0.7,-0.3,0.7,1.3,0.4,-0.3,-0.2,-0.2,-0.1,0.7,1.4,1.1,0.2,0.6,0.9,0.9,1.0,1.2,1.2,0.7,0.2]]]};
  const HUD_GLYPHS = Object.entries(HUD_TPL).flatMap(([ch, list]) => list.map(([ar, vec]) => ({ ch, ar, vec })));
  const HUD_MAX_DIST = 0.6;
  const HUD_MIN_MARGIN = 0.12;
  const hudWork = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

  function hudImage() {
    const st = stage();
    if (!st) return null;
    const f = fit(st.canvas.width, st.canvas.height, st);
    const sx = (st.swfW * f.k) / STAGE_W;
    const sy = (st.swfH * f.k) / STAGE_H;
    const [x0, y0, x1, y1] = [86, 25, 254, 80];
    const w = Math.max(1, Math.round((x1 - x0) * sx));
    const h = Math.max(1, Math.round((y1 - y0) * sy));
    if (hudWork.canvas.width !== w || hudWork.canvas.height !== h) {
      hudWork.canvas.width = w;
      hudWork.canvas.height = h;
    }
    hudWork.drawImage(st.canvas, f.ox + x0 * sx, f.oy + y0 * sy, w, h, 0, 0, w, h);
    return { w, h, data: hudWork.getImageData(0, 0, w, h).data };
  }

  const hudWhite = (d, i) => {
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    return mn > 215 && Math.max(d[i], d[i + 1], d[i + 2]) - mn < 40;
  };

  function hudGlyphVec(img, a, b, t, u) {
    const W = 8;
    const H = 12;
    const w = b - a + 1;
    const h = u - t + 1;
    const mins = [];
    for (let y = t; y <= u; y++) {
      for (let x = a; x <= b; x++) {
        const i = (y * img.w + x) * 4;
        mins.push(Math.min(img.data[i], img.data[i + 1], img.data[i + 2]));
      }
    }
    const bg = mins.slice().sort((p, q) => p - q)[Math.floor(mins.length / 5)];
    const mask = mins.map((m) => Math.max(0, Math.min(1, (m - bg) / Math.max(1, 255 - bg))));
    const out = [];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x0 = (i * w) / W;
        const x1 = ((i + 1) * w) / W;
        const y0 = (j * h) / H;
        const y1 = ((j + 1) * h) / H;
        let acc = 0;
        let n = 0;
        for (let yy = Math.floor(y0); yy < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); yy++) {
          for (let xx = Math.floor(x0); xx < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); xx++) {
            if (yy < h && xx < w) {
              acc += mask[yy * w + xx];
              n++;
            }
          }
        }
        out.push(acc / Math.max(1, n));
      }
    }
    const m = out.reduce((p, q) => p + q, 0) / out.length;
    const sd = Math.sqrt(out.reduce((p, q) => p + (q - m) ** 2, 0) / out.length) || 1;
    return { vec: out.map((v) => (v - m) / sd), ar: w / h };
  }

  function hudClassify(g) {
    let best = null;
    for (const t of HUD_GLYPHS) {
      let d = 0;
      for (let i = 0; i < t.vec.length; i++) d += (g.vec[i] - t.vec[i]) ** 2;
      d = d / t.vec.length + Math.abs(g.ar - t.ar) * 2;
      if (!best || d < best.d) best = { d, ch: t.ch, second: best && best.ch !== t.ch ? best.d : best ? best.second : Infinity };
      else if (t.ch !== best.ch && d < best.second) best.second = d;
    }
    return best;
  }

  function hudText(img) {
    const rowHas = [];
    for (let y = 0; y < img.h; y++) {
      let any;
      let count = 0;
      for (let x = 0; x < img.w; x++) if (hudWhite(img.data, (y * img.w + x) * 4)) count++;
      /*
       * A bar's bright rim can be a white row across most of its width; it is not text and would
       * otherwise merge every glyph of the line above it into one.
       */
      any = count > 0 && count < img.w * 0.4;
      rowHas.push(any);
    }
    const lines = [];
    for (let y = 0, start = -1; y <= img.h; y++) {
      if (y < img.h && rowHas[y]) {
        if (start < 0) start = y;
      } else if (start >= 0) {
        if (y - start >= 4) lines.push([start, y - 1]);
        start = -1;
      }
    }
    const line = lines[lines.length - 1];
    if (!line) return null;
    const [y0, y1] = line;
    let text = '';
    let worst = 0;
    for (let x = 0, start = -1; x <= img.w; x++) {
      let col = false;
      for (let y = y0; y <= y1 && x < img.w && !col; y++) col = hudWhite(img.data, (y * img.w + x) * 4);
      if (col) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        let t = y1;
        let u = y0;
        for (let y = y0; y <= y1; y++) {
          for (let xx = start; xx < x; xx++) {
            if (hudWhite(img.data, (y * img.w + xx) * 4)) {
              t = Math.min(t, y);
              u = Math.max(u, y);
            }
          }
        }
        const hit = hudClassify(hudGlyphVec(img, start, x - 1, t, u));
        text += hit.ch;
        worst = Math.max(worst, hit.d, hit.second - hit.d < HUD_MIN_MARGIN ? Infinity : 0);
        start = -1;
      }
    }
    return { text, worst };
  }

  function parseHudXp(read) {
    if (!read || read.worst > HUD_MAX_DIST) return null;
    const m = /^(\d+)\/(\d+)$/.exec(read.text);
    if (!m) return null;
    const xp = Number(m[1]);
    const need = Number(m[2]);
    for (let level = 1; level < 100; level++) {
      if (xpNeed(level) === need) return xp < need ? { xp, need, level } : null;
    }
    return null;
  }

  function readHudXp() {
    const img = hudImage();
    return img ? parseHudXp(hudText(img)) : null;
  }

  function xpFraction(s) {
    const hud = readHudXp();
    if (hud) applyHud(hud);
    const f = hud ? hud.xp / hud.need : readXpBar(s);
    state.lastXpFrac = f;
    return f;
  }

  /*
   * A validated HUD reading names the level exactly, so a missed Level Up screen (or a wrong
   * level typed in the panel) is corrected; one level up goes through onLevelUp so stop levels
   * and targets still trigger, and the Level Up screen seen right after is not counted twice.
   */
  function syncLevelFromHud(level) {
    const current = Number(config.currentLevel) || 0;
    if (level === current) return;
    if (current && level === current + 1) {
      state.lastLevelUpAt = Date.now();
      onLevelUp();
      return;
    }
    config.currentLevel = level;
    normalizeTarget();
    saveConfig();
    syncConfigInputs();
    state.rescanBest = true;
    state.tableMiss = false;
  }

  function applyHud(hud) {
    syncLevelFromHud(hud.level);
    rememberXpReading(hud.level, hud.xp / hud.need, hud.xp);
  }

  /*
   * The bar is only on screen in the village, so the last good reading is kept across reloads;
   * a lower reading within the same level is a covered bar and is ignored.
   */
  function rememberXpReading(level, frac, xp = null) {
    const prev = stats.xpNow;
    if (prev && prev.level === level && frac < prev.frac - 0.01) return;
    if (prev && prev.level === level && Math.abs(prev.frac - frac) < 1e-7) {
      prev.at = Date.now();
      saveStats();
      return;
    }
    stats.xpPrev = prev || stats.xpPrev;
    stats.xpNow = { level, frac, xp, at: Date.now() };
    saveStats();
  }

  function latestXp() {
    const current = Number(config.currentLevel) || 0;
    const now = stats.xpNow;
    if (now && now.level === current) return now.frac;
    return now && now.level < current ? 0 : null;
  }

  /*
   * Fallback when the HUD digits cannot be read (e.g. a low-resolution canvas): the white figures
   * sit across the middle of the bar, so the fill's right end is the right-most lime pixel over
   * all of the bar's rows rather than the first gap along one row.
   */
  function readXpBar(s) {
    const X0 = 88;
    const X1 = 251;
    let end = -1;
    for (let y = 113; y <= 131; y++) {
      for (let x = X1; x > end; x--) {
        const [r, g, b] = s.px(x, y);
        if (g > 140 && g > r && b < 110 && g - b > 70) {
          end = x;
          break;
        }
      }
    }
    return end < 0 ? 0 : Math.min(1, (end - X0 + 1) / (X1 - X0 + 1));
  }

  /*
   * One mission moves the 164px bar only ~3-8px, so a single reading is off by up to a third.
   * XP is measured from an anchor reading over every mission since, which keeps the error at one
   * pixel for the whole span; a segment closes on a level-up or a change of mission and is added
   * to that mission's totals. Failed missions count too, as the estimate is missions needed.
   */
  function segmentGain(anchor, level, frac) {
    if (level === anchor.level) return (frac - anchor.frac) * xpNeed(level);
    if (level === anchor.level + 1) return (1 - anchor.frac) * xpNeed(anchor.level) + frac * xpNeed(level);
    return null;
  }

  function plausible(key, gain, n) {
    const info = missionInfo(parseKey(key));
    return gain >= 0 && (!info || gain / n <= info.xp * 4);
  }

  const parseKey = (key) => {
    const [grade, page, row] = String(key).split('-');
    return { grade, page: Number(page), row: Number(row) };
  };

  function recordXp(s) {
    const frac = xpFraction(s);
    const level = Number(config.currentLevel) || 0;
    if (!level) return;
    rememberXpReading(level, frac);
    const key = missionKey();
    const anchor = stats.xp;
    const fresh = () => {
      stats.xp = { level, frac, missions: stats.missions, key };
      saveStats();
    };
    if (!anchor || !anchor.key) return fresh();
    const n = stats.missions - anchor.missions;
    const gain = segmentGain(anchor, level, frac);
    /*
     * The bar cannot shrink within a level; a lower reading means it was covered (popup, dialog),
     * so that reading is dropped and the anchor kept.
     */
    if (level === anchor.level && frac < anchor.frac - 0.01) {
      state.lastXpFrac = null;
      return;
    }
    if (gain === null) return fresh();
    if (level !== anchor.level || key !== anchor.key) {
      if (n > 0 && plausible(anchor.key, gain, n)) {
        const mine = missionStats(anchor.key);
        mine.xpSum = (mine.xpSum || 0) + gain;
        mine.xpN = (mine.xpN || 0) + n;
      }
      return fresh();
    }
  }

  function xpPerMission(key = missionKey()) {
    const mine = missionStats(key);
    let sum = mine.xpSum || 0;
    let n = mine.xpN || 0;
    const anchor = stats.xp;
    if (anchor && anchor.key === key && Number(config.currentLevel) === anchor.level) {
      const live = stats.missions - anchor.missions;
      const frac = latestXp();
      if (live > 0 && frac != null && frac >= anchor.frac) {
        const gain = (frac - anchor.frac) * xpNeed(anchor.level);
        if (plausible(key, gain, live)) {
          sum += gain;
          n += live;
        }
      }
    }
    return n ? sum / n : 0;
  }

  function currentSpeed() {
    const w = gameWindow();
    return (w && w.__nsGetSpeed && w.__nsGetSpeed()) || Number(storage.get('nsSpeed')) || 1;
  }

  /*
   * Each mission start is stored with the game speed; the gap to the next start counts for that
   * speed only when the speed did not change in between, so each speed gets its own median.
   */
  function missionGapsBySpeed() {
    const starts = missionStats().starts.map((e) => (typeof e === 'number' ? { t: e, x: 0 } : e));
    const bySpeed = {};
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i].t - starts[i - 1].t;
      if (gap <= 0 || gap > 15 * 60000 || starts[i].x !== starts[i - 1].x || !starts[i].x) continue;
      (bySpeed[starts[i - 1].x] = bySpeed[starts[i - 1].x] || []).push(gap);
    }
    const median = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
    return Object.fromEntries(Object.entries(bySpeed).map(([x, list]) => [x, { ms: median(list), n: list.length }]));
  }

  function missionMs() {
    const bySpeed = missionGapsBySpeed();
    const now = bySpeed[currentSpeed()];
    if (now) return now.ms;
    const any = Object.values(bySpeed).sort((a, b) => b.n - a.n)[0];
    return any ? any.ms : 0;
  }

  function missionsPerLevel() {
    const marks = stats.levelMarks;
    if (marks.length < 2) return 0;
    const recent = marks.slice(-4);
    return (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  }

  function targetLevel() {
    const current = Number(config.currentLevel) || 0;
    const chosen = Number(config.targetLevel) || 0;
    if (chosen > current) return chosen;
    return stopLevelList().find((l) => l > current) || 0;
  }

  const duration = (ms) => {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} mnt`;
    return `${Math.floor(minutes / 60)} j ${minutes % 60} mnt`;
  };

  function describeMission() {
    const m = currentTarget();
    const info = missionInfo(m);
    if (info) return `${info.name} (Lv ${info.level}, ${info.xp.toLocaleString('id-ID')} XP)${info.exact ? '' : ' (perkiraan)'}`;
    return `Grade ${m.grade} hal. ${m.page} baris ${m.row}`;
  }

  /*
   * Missions still needed: the rest of this level at the current mission's XP, then every later
   * level at the XP of the best mission it unlocks (the bot switches to it), scaled by how the
   * current mission's measured XP compares with its table value (bonuses, failed runs).
   */
  function missionsToTarget(current, target, frac) {
    const info = missionInfo();
    const measured = xpPerMission();
    const perMission = measured || (info ? info.xp : 0);
    if (!perMission) return null;
    const ratio = info && measured ? measured / info.xp : 1;
    let left = ((1 - frac) * xpNeed(current)) / perMission;
    for (let l = current + 1; l < target; l++) {
      const pick = config.autoBestXp ? bestForLevel(l, config.grade) : null;
      const entry = pick && missionInfo(pick);
      left += xpNeed(l) / (entry ? entry.xp * ratio : perMission);
    }
    return Math.max(0, Math.ceil(left));
  }

  /* XP from level a (bar fraction af) up to level b (fraction bf). */
  function xpBetween(a, af, b, bf) {
    let total = -af * xpNeed(a) + (b < 100 ? bf * xpNeed(b) : 0);
    for (let l = a; l < b; l++) total += xpNeed(l);
    return total;
  }

  /*
   * The goal bar runs from where the character stood when the current target was set to that
   * target, in XP rather than levels, since every level costs more than the one before.
   */
  function goalProgress() {
    const current = Number(config.currentLevel) || 0;
    const target = targetLevel();
    if (!current || !target || target <= current) return null;
    const frac = latestXp() ?? 0;
    const goal = stats.goal;
    if (!goal || goal.target !== target || goal.level > current) {
      stats.goal = { target, level: current, frac };
      saveStats();
    }
    const from = stats.goal;
    const total = xpBetween(from.level, from.frac, target, 0);
    const done = Math.max(0, xpBetween(from.level, from.frac, current, frac));
    const prev = stats.xpPrev;
    const lastGain = prev && stats.xpNow && prev.level <= current ? xpBetween(prev.level, prev.frac, stats.xpNow.level, stats.xpNow.frac) : 0;
    const left = missionsToTarget(current, target, frac);
    const each = missionMs();
    const perMission = xpPerMission() || ((missionInfo() || {}).xp || 0);
    const levelLeft = perMission ? Math.max(0, Math.ceil(((1 - frac) * xpNeed(current)) / perMission)) : null;
    return {
      levelLeft,
      from: from.level,
      current,
      target,
      pct: total > 0 ? Math.max(0, Math.min(1, done / total)) : 0,
      level: frac,
      lastPct: total > 0 && lastGain > 0 ? lastGain / total : 0,
      lastGain,
      readAt: stats.xpNow ? stats.xpNow.at : 0,
      xp: stats.xpNow && stats.xpNow.level === current && stats.xpNow.xp != null ? stats.xpNow.xp : null,
      need: xpNeed(current),
      left,
      eta: left != null && each ? left * each : 0,
    };
  }

  function renderGoal(el) {
    const g = config.mode === 'cheat' ? null : goalProgress();
    el.hidden = !g;
    if (!g) return;
    const ago = g.readAt ? Math.round((Date.now() - g.readAt) / 60000) : null;
    const xpText = g.xp != null ? `${g.xp.toLocaleString('id-ID')} / ${g.need.toLocaleString('id-ID')} XP (HUD)` : 'XP perkiraan bilah';
    el.querySelector('.gl').textContent = `Lv ${g.from} \u2192 ${g.target} \u00b7 Lv ${g.current} \u00b7 ${xpText}${ago ? ` \u00b7 ${ago} mnt lalu` : ''}`;
    el.querySelector('.gp').textContent = `${(g.pct * 100).toFixed(2)}%${g.lastPct ? ` (+${(g.lastPct * 100).toFixed(2)}%)` : ''}`;
    el.querySelector('.gf').style.width = `${g.pct * 100}%`;
    el.querySelector('.lf').style.width = `${g.level * 100}%`;
    el.querySelector('.gr').textContent =
      g.left == null ? 'Sisa misi diukur setelah 1 misi selesai' : `Ke target ~${g.left} misi${g.eta ? ` \u00b7 ~${duration(g.eta)}` : ''}${g.levelLeft != null ? ` \u00b7 naik level ~${g.levelLeft} misi` : ''}`;
    el.querySelector('.ll').textContent = `Lv ${g.current} \u2192 ${g.current + 1}: ${(g.level * 100).toFixed(1)}%${g.lastGain ? ` \u00b7 +${Math.round(g.lastGain).toLocaleString('id-ID')} XP` : ''}`;
  }

  function statsRows() {
    if (config.mode === 'cheat') return [['note', 'Mode cheat saja: bot tidak bermain.']];
    const current = Number(config.currentLevel) || 0;
    const target = targetLevel();
    const each = missionMs();
    const perLevel = missionsPerLevel();
    const rows = [
      ['Misi', describeMission()],
      ['Level', `${current || '?'} \u2192 target ${target || '-'}`],
      ['Dijalankan', `${stats.missions} misi \u00b7 ${duration(Date.now() - stats.since)}`],
    ];
    const speeds = Object.entries(missionGapsBySpeed()).sort((a, b) => a[0] - b[0]);
    rows.push([
      `Durasi/misi (${currentSpeed()}x aktif)`,
      speeds.length ? speeds.map(([x, v]) => `${x}x ${(v.ms / 60000).toFixed(1)} mnt`).join(' \u00b7 ') : 'diukur setelah 2 misi',
    ]);
    if (waste.missions) {
      const avg = Object.keys(WASTE_LABELS)
        .map((k) => [k, waste.total[k] / waste.missions])
        .filter(([, v]) => v >= 0.05)
        .map(([k, v]) => `${WASTE_LABELS[k]} ${v.toFixed(1)}`);
      rows.push(['Pemborosan/misi', avg.length ? avg.join(' \u00b7 ') : 'tidak ada']);
    }
    if (config.turbo) {
      const fails = Object.entries(turbo.failsAt.battle).concat(Object.entries(turbo.failsAt.other)).reduce((n, [, v]) => n + v, 0);
      rows.push(['Turbo', `battle ${turbo.speed.battle}x \u00b7 lainnya ${turbo.speed.other}x${fails ? ` \u00b7 ${fails} error` : ''}`]);
    }
    const info = missionInfo();
    const measured = xpPerMission();
    const perMission = measured || (info ? info.xp : 0);
    if (!current || !target) rows.push(['note', 'Isi "Level saat ini" untuk perkiraan.']);
    else if (perMission && stats.xp && stats.xp.level === current) {
      const frac = latestXp() ?? stats.xp.frac;
      let need = -frac * xpNeed(current);
      for (let l = current; l < target; l++) need += xpNeed(l);
      /*
       * Higher levels unlock higher-XP missions, which the bot switches to, so each later level is
       * costed with its best mission's table XP, scaled by how the current mission's measured XP
       * compares with its table value (bonuses, failed runs).
       */
      const left = missionsToTarget(current, target, frac);
      const levelXp = xpNeed(current);
      const levelTotal = Math.ceil(levelXp / perMission);
      const levelDone = Math.min(levelTotal, Math.floor((frac * levelXp) / perMission));
      const levelLeft = Math.max(0, Math.ceil(((1 - frac) * levelXp) / perMission));
      rows.push([measured ? 'XP/misi (terukur)' : 'XP/misi (dasar)', Math.round(perMission).toLocaleString('id-ID')]);
      rows.push([`Ke Lv ${current + 1}`, `${levelDone}/${levelTotal} misi \u00b7 sisa ${levelLeft}${each ? ` \u00b7 ~${duration(levelLeft * each)}` : ''}`]);
      rows.push([`Ke Lv ${target}`, `~${left} misi${each ? ` \u00b7 ~${duration(left * each)}` : ''}`]);
      rows.push(['Kurang XP', Math.round(need).toLocaleString('id-ID')]);
      if (!each) rows.push(['note', 'Waktu muncul setelah 2 misi di kecepatan ini.']);
    } else if (!perLevel) rows.push(['note', 'Mengukur XP per misi (perlu 1 misi selesai)...']);
    else {
      const sinceLast = stats.missions - stats.levelMarks[stats.levelMarks.length - 1];
      const left = Math.max(0, Math.round((target - current) * perLevel - sinceLast));
      rows.push(['Misi/level', `~${perLevel.toFixed(1)}`]);
      rows.push([`Ke Lv ${target}`, `~${left} misi${each ? ` \u00b7 ~${duration(left * each)}` : ''}`]);
    }
    return rows;
  }

  function renderStats(el) {
    el.textContent = '';
    for (const [k, v] of statsRows()) {
      if (k === 'note') {
        const n = document.createElement('div');
        n.className = 'note';
        n.textContent = v;
        el.appendChild(n);
        continue;
      }
      const a = document.createElement('div');
      a.className = 'k';
      a.textContent = k;
      const b = document.createElement('div');
      b.className = 'v';
      b.textContent = v;
      el.append(a, b);
    }
  }


  function onLevelUp() {
    recordLevelUp();
    if (!config.currentLevel) return;
    config.currentLevel = Number(config.currentLevel) + 1;
    saveConfig();
    syncConfigInputs();
    state.rescanBest = true;
    state.tableMiss = false;
    const chosen = Number(config.targetLevel) || 0;
    if (stopLevelList().includes(config.currentLevel) || (chosen && config.currentLevel === chosen)) {
      storage.set('nsStopAtVillage', String(config.currentLevel));
    }
  }

  const CHARACTER_SLOTS = [[438, 256], [736, 256], [438, 366], [736, 366], [438, 468], [736, 468]];
  const isCharacterSelect = (s) => CHARACTER_SELECT_POINTS.every(([x, y, rgb]) => near(s.px(x, y), rgb, 25));

  /*
   * Cheat-only mode: the player plays by hand while the damage patch is applied once per game
   * memory and chakra is kept locked; no clicks are sent to the game.
   */
  async function cheatLoop() {
    while (state.running) {
      const memory = currentMemory();
      if (memory && needsPatch()) {
        const r = patchMemory();
        if (r.patched + r.already > 0) {
          state.patchedMemory = memory;
          state.lastPatch = `${r.patched} diubah, ${r.already} sudah`;
        }
      }
      if (config.lockChakra) lockChakra();
      const jutsu = !config.patchMemory ? 'mati' : memory ? state.jutsuPatch || 'menunggu' : 'menunggu karakter dipilih';
      const attack = !config.attackCheat ? 'mati' : memory ? state.attackPatch || 'menunggu' : 'menunggu karakter dipilih';
      setStatus(`Cheat saja | Jurus: ${jutsu} | Serangan biasa: ${attack} | Chakra: ${config.lockChakra ? 'terkunci' : 'mati'}`);
      await sleep(400);
    }
    setStatus('Berhenti');
  }

  async function loop() {
    if (config.mode === 'cheat') {
      await cheatLoop();
      return;
    }
    let idleSince = Date.now();
    state.lastProgress = Date.now();
    const busy = () => {
      idleSince = Date.now();
      state.spriteTries = 0;
      state.capturedThisIdle = false;
    };
    const progressed = () => {
      busy();
      state.lastProgress = Date.now();
      state.goStreak = 0;
      state.mapTried = [];
    };
    while (state.running) {
      /*
       * Every branch below may finish without a real timer await; this floor keeps the loop from
       * spinning on microtasks, which starves the renderer and freezes the tab.
       */
      await sleep(40);

      if (rufflePanicked() || Date.now() - state.lastProgress > CFG.stallReloadMs) {
        recover(rufflePanicked() ? 'Ruffle error' : 'Game macet');
        return;
      }

      const s = snap();
      if (!s) {
        setStatus('Game belum termuat...');
        await sleep(1000);
        continue;
      }

      if (config.lockChakra) lockChakra(false);

      turboPhase(isMyTurn(s) || inBattle(s) ? 'battle' : 'other');

      if (isMyTurn(s)) {
        await doTurn(s);
        progressed();
        continue;
      }

      if (inBattle(s)) {
        busy();
        for (let i = 0; i < 60 && state.running; i++) {
          await sleep(35);
          const b = snapBattle();
          if (!b || isMyTurn(b) || !inBattle(b)) break;
        }
        continue;
      }

      if (isDialog(s)) {
        /*
         * Level Up and Mission Success share the dialog's black bars but only close via their
         * green checkmark; clicking the centre there loops forever.
         */
        const check = findGreenCheck(s);
        if (check && isLevelUpScreen(s) && Date.now() - (state.lastLevelUpAt || 0) > 8000) {
          state.lastLevelUpAt = Date.now();
          onLevelUp();
        }
        const closeX = check ? null : findRedClose(s);
        if (check) {
          setStatus('Klik checkmark (level up / hasil)...');
          await click(check.x, check.y);
          await waitFor((n) => !isDialog(n), 400, 40);
        } else if (closeX) {
          setStatus('Menutup popup tutorial...');
          await click(closeX.x, closeX.y);
          await waitFor((n) => !findRedClose(n), 400, 40);
        } else {
          setStatus('Melewati dialog...');
          await click(...POS.dialog);
        }
        state.usedThisBattle.clear();
        progressed();
        continue;
      }

      if (isGradePanel(s)) {
        await navigateToMission(true);
        progressed();
        continue;
      }

      /*
       * The character-select screen has green "Create" buttons that look like a checkmark to
       * findGreenCheck, so it must be recognised first or the bot would start a new character.
       */
      if (isCharacterSelect(s)) {
        setStatus('Memilih karakter...');
        await click(...(CHARACTER_SLOTS[(Number(config.characterSlot) || 1) - 1] || CHARACTER_SLOTS[0]));
        await sleep(800);
        await click(...POS.characterPlay);
        progressed();
        await sleep(3000);
        continue;
      }

      const g = findGreenCheck(s);
      if (g) {
        setStatus('Klik checkmark...');
        await click(g.x, g.y);
        state.usedThisBattle.clear();
        progressed();
        await waitFor((n) => !findGreenCheck(n), 400, 40);
        continue;
      }

      if (isVillage(s)) {
        state.inMission = false;
        /*
         * Page reloads are only allowed in the village (or for error recovery) so a mission in
         * progress is never thrown away; pending hook updates wait here.
         */
        if (storage.get('nsReloadAtVillage') === '1') {
          storage.set('nsReloadAtVillage', null);
          storage.set(AUTORUN_KEY, '1');
          setStatus('Di desa: reload untuk menerapkan pembaruan...');
          state.running = false;
          markCleanReload();
          setTimeout(() => location.reload(), 300);
          return;
        }
        const examLevel = storage.get('nsStopAtVillage');
        if (examLevel) {
          storage.set('nsStopAtVillage', null);
          storage.set(AUTORUN_KEY, null);
          const isExam = stopLevelList().includes(Number(examLevel));
          stopWith(`Level ${examLevel} tercapai${isExam ? ': waktunya ujian rank' : ' (target)'}. Bot berhenti.`);
          return;
        }
        if (storage.get('nsPauseAtVillage') === '1') {
          storage.set('nsPauseAtVillage', null);
          storage.set(AUTORUN_KEY, null);
          stopWith('Dijeda di desa');
          return;
        }
        recordXp(s);
        await navigateToMission();
        progressed();
        continue;
      }

      /*
       * Mission maps: an area is wider than the screen and the camera follows the walking player,
       * so enemies scroll into view mid-walk. On a map the screen is scanned on every pass and an
       * enemy is clicked the moment it shows; "Go!" (which blinks) is used only when none is
       * left. Within a few seconds of an arrow being seen nothing is swept, so the player never
       * wanders off on random ground clicks.
       */
      const onMapScreen = looksLikeMap(s);
      const goRight = onMapScreen && findGoArrow(s);
      const goLeft = onMapScreen && !goRight ? findGoArrow(s, 'left') : null;
      if (goRight || goLeft) state.mapSeenAt = Date.now();
      /*
       * A long fight can outlast the "arrow seen recently" window; while a mission is under way a
       * map-looking screen is still the map even before its arrow shows up again.
       */
      if (onMapScreen && (state.inMission || Date.now() - idleSince > 1500)) state.mapSeenAt = Date.now();
      if (!onMapScreen && Date.now() - (state.mapSeenAt || 0) < 15000) {
        setStatus('Transisi / pertarungan, menunggu...');
        await sleep(80);
        continue;
      }
      if (Date.now() - (state.mapSeenAt || 0) < 15000) {
        const enemy = untriedSprites(s)[0];
        if (enemy) {
          setStatus('Peta misi: mengklik musuh...');
          state.lastAim = { at: Date.now(), kind: 'map', enemy };
          await clickSprite(enemy);
          continue;
        }
        let arrow = goRight || goLeft;
        if (arrow && Date.now() >= (state.walkingUntil || 0)) {
          /*
           * The icon blinks; it is re-checked on a fresh frame right before the press so the click
           * lands while it is lit (and therefore hittable).
           */
          const fresh = snap();
          arrow = fresh && findGoArrow(fresh, goRight ? 'right' : 'left');
        }
        if (arrow && Date.now() >= (state.walkingUntil || 0)) {
          state.mapTried = [];
          setStatus(goRight ? 'Peta misi: maju (Go!)...' : 'Peta misi: pindah area (Go! kiri)...');
          await click(arrow.x, arrow.y);
          state.walkingUntil = Date.now() + 1200;
          await sleep(250);
          continue;
        }
        /*
         * Arrows only show once the camera settles at an area edge; with neither an arrow nor an
         * enemy in sight for a while, walking far right scrolls the camera to reveal one of them.
         */
        if (Date.now() >= (state.walkingUntil || 0) + 800) {
          setStatus('Peta misi: berjalan ke kanan...');
          await click(900, 430);
          state.walkingUntil = Date.now() + 2500;
          await sleep(250);
          continue;
        }
        setStatus('Peta misi: berjalan, mencari musuh...');
        await sleep(120);
        continue;
      }

      if (Date.now() - idleSince > CFG.idleBeforeClick) {
        const strayPanelX = findRedClose(s);
        if (strayPanelX) {
          setStatus('Menutup panel...');
          await click(strayPanelX.x, strayPanelX.y);
          await sleep(400);
          progressed();
          continue;
        }
        setStatus('Mencari musuh di cutscene...');
        if (Date.now() - idleSince > 3000 && !state.capturedThisIdle) {
          state.capturedThisIdle = true;
          captureUnknownScreen();
        }
        /*
         * Clicking bare ground makes the character wander, so the enemy itself is aimed at first:
         * up to three detected sprites (right-most first), each given a moment to start the fight.
         */
        if ((state.spriteTries || 0) < 3) {
          const aim = untriedSprites(s)[0];
          state.spriteTries = aim ? (state.spriteTries || 0) + 1 : 3;
          if (aim) {
            setStatus('Mengklik musuh...');
            state.lastAim = { at: Date.now(), kind: 'idle', enemy: aim };
            await clickSprite(aim);
            continue;
          }
        }
        /*
         * No blind clicks: random sweeps over an unknown screen once opened shops and other paid
         * panels. With no enemy to aim at the bot only waits; a screen that never changes is
         * handled by the stall recovery (reload) instead.
         */
        setStatus('Layar tidak dikenal, menunggu (tanpa klik)...');
        await sleep(300);
        wasted('unknownMs', 0.3);
        continue;
      }

      setStatus('Menunggu...');
      await sleep(150);
    }
    setStatus('Berhenti');
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host{all:initial}
      .p{font:13px/1.45 system-ui,-apple-system,sans-serif;background:#1c1c1e;color:#f2f2f7;border-radius:12px;width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;box-shadow:0 12px 32px rgba(0,0,0,.45);border:1px solid #2c2c2e;overflow:hidden}
      .hd{display:flex;align-items:center;gap:8px;padding:10px 12px 8px 14px}
      .t{font-weight:600;font-size:14px;flex:1}
      .dot{width:8px;height:8px;border-radius:50%;background:#636366}
      .dot.on{background:#30d158;box-shadow:0 0 6px #30d158}
      .ic{width:28px;height:28px;border:0;border-radius:7px;background:#2c2c2e;color:#f2f2f7;cursor:pointer;font-size:16px;line-height:1}
      .ic:hover{background:#3a3a3c}
      .s{padding:0 14px;color:#e5e5ea;min-height:20px;word-break:break-word}
      .c{padding:2px 14px 10px;color:#8e8e93;font-size:12px}
      .body{flex:1 1 auto;min-height:0;overflow:auto;border-top:1px solid #2c2c2e;columns:2;column-gap:0;column-rule:1px solid #2c2c2e}
      .hd,.s,.c,.sp,.ft,.foot{flex:0 0 auto}
      .sec{border-bottom:1px solid #2c2c2e;break-inside:avoid}
      .sec>summary{list-style:none;cursor:pointer;padding:9px 14px;font-size:12px;font-weight:600;color:#aeaeb2;text-transform:uppercase;letter-spacing:.04em;display:flex;justify-content:space-between}
      .sec>summary::-webkit-details-marker{display:none}
      .sec>summary::after{content:"+";color:#636366;font-weight:400}
      .sec[open]>summary::after{content:"\\2212"}
      .in{padding:0 14px 10px}
      .grid{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px}
      .grid .k{color:#8e8e93;white-space:nowrap}
      .grid .v{color:#f2f2f7;text-align:right;word-break:break-word}
      .grid .note{grid-column:1 / -1;color:#8e8e93;font-style:italic}
      .grid .v.slow{color:#ff6961;font-weight:600}
      .row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:6px 0;font-size:12px;color:#e5e5ea}
      .row select,.row input[type=number],.row input[type=text]{background:#2c2c2e;color:#f2f2f7;border:1px solid #3a3a3c;border-radius:7px;padding:4px 8px;font:12px system-ui,sans-serif;width:96px;box-sizing:border-box}
      .row input[type=text]{width:140px}
      .row select.w{width:140px}
      .row input[type=checkbox]{width:16px;height:16px;accent-color:#0a84ff;margin:0}
      .row select:disabled,.row input:disabled{opacity:.55;cursor:not-allowed}
      .hint{color:#8e8e93;font-size:11px;margin:-2px 0 6px}
      .sp{display:flex;gap:6px;padding:0 14px 12px}
      .sp button{flex:1;padding:6px 0;border:0;border-radius:7px;background:#2c2c2e;color:#f2f2f7;font-weight:500;cursor:pointer}
      .sp button.sel{background:#0a84ff;color:#fff}
      .ft{display:flex;align-items:center;gap:10px;padding:12px 14px}
      #b{flex:1;padding:9px;border:0;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;background:#30d158;color:#000}
      #b.on{background:#ff453a;color:#fff}
      .kbd{color:#636366;font-size:11px;white-space:nowrap}
      .rep{padding:9px 12px;border:0;border-radius:8px;background:#3a3a3c;color:#ffd60a;font-weight:600;font-size:12px;cursor:pointer;white-space:nowrap}
      .rep:hover{background:#48484a}
      .foot{padding:0 14px 10px;margin-top:-4px}
      .link{background:none;border:0;color:#0a84ff;padding:0;font-size:12px;cursor:pointer}
      .p.min .body,.p.min .sp,.p.min .c{display:none}
      .p.min .s{padding-bottom:4px}
      .p.min{width:300px;max-height:none}
      .grid .v{white-space:nowrap}
      .goal{padding:0 14px 12px}
      .goal[hidden]{display:none}
      .goal .top,.goal .sub{display:flex;justify-content:space-between;gap:8px;font-size:12px}
      .goal .gl{color:#e5e5ea}
      .goal .gp{color:#30d158;font-weight:600;font-variant-numeric:tabular-nums}
      .goal .bar{height:8px;border-radius:4px;background:#2c2c2e;overflow:hidden;margin:5px 0 4px}
      .goal .gf{height:100%;background:#30d158;border-radius:4px;transition:width .4s ease}
      .goal .lbar{height:5px;border-radius:3px;background:#2c2c2e;overflow:hidden;margin:4px 0 0}
      .goal .lf{height:100%;background:#0a84ff;transition:width .4s ease}
      .goal .sub{color:#8e8e93;font-size:11px;font-variant-numeric:tabular-nums}
    </style>
    <div class="p" id="p">
      <div class="hd"><span class="dot" id="dot"></span><span class="t">Ninja Saga Bot</span><button class="ic" id="mn" title="Perkecil / perbesar panel">\u2212</button></div>
      <div class="s" id="s">Idle</div>
      <div class="c" id="c">Misi: 0 | Giliran: 0</div>
      <div class="goal" id="goal" hidden>
        <div class="top"><span class="gl"></span><span class="gp"></span></div>
        <div class="bar"><div class="gf"></div></div>
        <div class="sub"><span class="gr"></span><span class="ll"></span></div>
        <div class="lbar"><div class="lf"></div></div>
      </div>
      <div class="sp" id="sp">
        <button data-v="1">1x</button><button data-v="2">2x</button><button data-v="3">3x</button><button data-v="4">4x</button><button data-v="5">5x</button>
      </div>
      <div class="body" id="cfg">
        <details class="sec" data-sec="progress" open>
          <summary>Progres</summary>
          <div class="in"><div class="grid" id="st"></div></div>
        </details>
        <details class="sec" data-sec="steps" open>
          <summary>Langkah</summary>
          <div class="in">
            <div class="grid" id="steps"></div>
          </div>
        </details>
        <details class="sec" data-sec="char">
          <summary>Karakter &amp; level</summary>
          <div class="in">
            <div class="row">Slot karakter (1-6)<input type="number" min="1" max="6" data-k="characterSlot"></div>
            <div class="row">Level saat ini<input type="number" min="0" max="100" data-k="currentLevel"></div>
            <div class="row">Target level (0 = otomatis)<input type="number" min="0" max="100" data-k="targetLevel"></div>
            <div class="row">Berhenti di level<input type="text" data-k="stopLevels"></div>
            <div class="hint">Level naik otomatis tiap Level Up. Bot berhenti di desa saat target atau level ujian tercapai. Target 0 = level ujian berikutnya.</div>
          </div>
        </details>
        <details class="sec" data-sec="mission">
          <summary>Misi</summary>
          <div class="in">
            <div class="row">Auto misi XP tertinggi<input type="checkbox" data-k="autoBestXp"></div>
            <div class="hint" id="autoinfo"></div>
            <div class="row">Grade<select data-k="grade"><option>A</option><option>B</option><option>C</option></select></div>
            <div class="row">Halaman<input type="number" min="1" max="20" data-k="page"></div>
            <div class="row">Baris<select data-k="row"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
          </div>
        </details>
        <details class="sec" data-sec="battle">
          <summary>Pertarungan</summary>
          <div class="in">
            <div class="row">Gaya serangan<select class="w" data-k="attackStyle"><option value="basic">Basic attack</option><option value="jutsu">Jurus</option></select></div>
            <div class="row">Urutan slot jurus<input type="text" data-k="slotOrder"></div>
            <div class="row">Slot heal (0 = tidak ada)<input type="number" min="0" max="8" data-k="healSlot"></div>
            <div class="hint">Slot 1-4 kiri, 5-8 kanan tombol Attack. Disimpan per misi.</div>
          </div>
        </details>
        <details class="sec" data-sec="cheat">
          <summary>Cheat</summary>
          <div class="in">
            <div class="row">Mode<select class="w" data-k="mode"><option value="auto">Bot otomatis</option><option value="cheat">Cheat saja</option></select></div>
            <div class="hint">Cheat saja: kamu bermain sendiri, bot hanya memasang cheat yang dicentang.</div>
            <div class="row">Damage jurus (AOB)<input type="checkbox" data-k="patchMemory"></div>
            <div class="row">Serangan biasa 400000<input type="checkbox" data-k="attackCheat"></div>
            <div class="row">Kunci chakra<input type="checkbox" data-k="lockChakra"></div>
            <div class="hint">Patch berlaku untuk battle setelah halaman dimuat ulang.</div>
          </div>
        </details>
        <details class="sec" data-sec="misc">
          <summary>Lainnya</summary>
          <div class="in">
            <div class="row">Suara game<input type="checkbox" id="snd"></div>
            <div class="row">Pulih otomatis (reload)<input type="checkbox" data-k="autoRecover"></div>
            <div class="row">Turbo stabil (speed otomatis)<input type="checkbox" data-k="turbo"></div>
            <div class="hint">Battle memakai speed tertinggi yang aman, lainnya satu tingkat di bawah; turun sendiri bila muncul error, naik lagi setelah 25 misi bersih.</div>
            <div class="row">Battle ekstrem (hingga 8x)<input type="checkbox" data-k="battleBoost"></div>
            <div class="hint">Eksperimen: battle naik 1 tingkat tiap 5 misi bersih sampai 8x, turun sendiri bila error. Butuh Turbo aktif; pertama kali, halaman di-reload saat di desa.</div>
            <div class="row"><button class="link" id="tr">Reset turbo</button></div>
            <div class="row"><button class="link" id="rs">Reset hitungan misi</button></div>
          </div>
        </details>
      </div>
      <div class="ft"><button id="b">Start</button><button class="rep" id="slow" title="Simpan langkah & layar saat ini untuk dianalisis">Laporkan lambat</button></div>
      <div class="kbd foot" id="slowok">Alt+S: Start/Stop</div>
    </div>`;
  document.body.appendChild(host);
  const $s = root.getElementById('s');
  const $c = root.getElementById('c');
  const $b = root.getElementById('b');
  const $sp = root.getElementById('sp');
  const $cfg = root.getElementById('cfg');
  const $st = root.getElementById('st');
  const $goal = root.getElementById('goal');
  const $dot = root.getElementById('dot');
  const $steps = root.getElementById('steps');
  root.getElementById('slow').addEventListener('click', () => {
    reportSlow();
    const note = root.getElementById('slowok');
    note.textContent = `Laporan tersimpan (${steps.name}). Beri tahu Claude untuk menganalisis.`;
    setTimeout(() => {
      note.textContent = 'Alt+S: Start/Stop';
    }, 4000);
  });
  const stepTimer = setInterval(() => renderSteps($steps), 1000);
  const $snd = root.getElementById('snd');
  $snd.checked = storage.get('nsSound') === '1';
  $snd.addEventListener('change', () => {
    const w = gameWindow();
    if (w && w.__nsSetSound) w.__nsSetSound($snd.checked);
    else storage.set('nsSound', $snd.checked ? '1' : '0');
  });
  root.getElementById('tr').addEventListener('click', () => {
    turbo.speed = { battle: TURBO_MAX, other: 4 };
    turbo.clean = { battle: 0, other: 0 };
    turbo.failsAt = { battle: {}, other: {} };
    turbo.log = [];
    saveTurbo();
    turboPhaseNow = null;
  });
  root.getElementById('rs').addEventListener('click', () => {
    resetStats();
    setStatus(state.status);
  });

  /*
   * The panel shrinks to status + Start/Stop, and every section remembers whether it was open,
   * so the overlay covers as little of the game as the player wants.
   */
  const $panel = root.getElementById('p');
  const $min = root.getElementById('mn');
  const applyMin = (min) => {
    $panel.classList.toggle('min', min);
    $min.textContent = min ? '+' : '\u2212';
    storage.set('nsPanelMin', min ? '1' : null);
  };
  applyMin(storage.get('nsPanelMin') === '1');
  $min.addEventListener('click', () => applyMin(!$panel.classList.contains('min')));
  let openSections = {};
  try {
    openSections = JSON.parse(storage.get('nsPanelSections') || '{}') || {};
  } catch (e) {
    openSections = {};
  }
  root.querySelectorAll('details.sec').forEach((d) => {
    if (openSections[d.dataset.sec] !== undefined) d.open = openSections[d.dataset.sec];
    d.addEventListener('toggle', () => {
      openSections[d.dataset.sec] = d.open;
      storage.set('nsPanelSections', JSON.stringify(openSections));
    });
  });

  /*
   * With "highest XP" on, grade/page/row are chosen by the scan, so those inputs show the scanned
   * mission and are locked; turning the option off restores the manual values for editing.
   */
  const AUTO_FIELDS = ['grade', 'page', 'row'];
  function syncConfigInputs() {
    const best = config.autoBestXp ? readBestMission() : null;
    $cfg.querySelectorAll('[data-k]').forEach((el) => {
      const key = el.dataset.k;
      const auto = config.autoBestXp && AUTO_FIELDS.includes(key);
      el.disabled = auto;
      el.title = auto ? 'Diatur otomatis oleh "Auto misi XP tertinggi"' : '';
      if (el.type === 'checkbox') el.checked = !!config[key];
      else if (document.activeElement !== host) el.value = String(auto && best ? best[key] : config[key]);
    });
    const $auto = root.getElementById('autoinfo');
    if ($auto) {
      const info = missionInfo();
      $auto.textContent = config.autoBestXp
        ? `Otomatis: ${info ? `${info.name} (Lv ${info.level}, ${info.xp.toLocaleString('id-ID')} XP)` : 'menunggu pindaian'}${best ? ` \u2014 Grade ${best.grade}, hal. ${best.page}, baris ${best.row}` : ''}`
        : 'Manual: bot memakai Grade, Halaman dan Baris di bawah.';
    }
  }

  $cfg.querySelectorAll('[data-k]').forEach((el) => {
    const key = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!config[key];
    else el.value = String(config[key]);
    el.addEventListener('change', () => {
      if (el.type === 'checkbox') config[key] = el.checked;
      else if (key === 'grade' || key === 'slotOrder' || key === 'stopLevels' || key === 'mode' || key === 'attackStyle') config[key] = el.value;
      else if (key === 'healSlot') config[key] = Math.max(0, Math.min(8, Number(el.value) || 0));
      else if (key === 'currentLevel' || key === 'targetLevel') config[key] = Math.max(0, Math.min(100, Number(el.value) || 0));
      else if (key === 'characterSlot') config[key] = Math.max(1, Math.min(6, Number(el.value) || 1));
      else config[key] = Math.max(1, Number(el.value) || DEFAULT_CONFIG[key]);
      if (key === 'targetLevel' || key === 'currentLevel') normalizeTarget();
      if (key === 'currentLevel') {
        state.rescanBest = true;
        state.tableMiss = false;
      }
      if (['targetLevel', 'currentLevel', 'autoBestXp'].includes(key)) syncConfigInputs();
      if (PROFILE_FIELDS.includes(key)) saveMissionProfile();
      if (key === 'battleBoost' && config.battleBoost && !config.turbo) {
        config.turbo = true;
        syncConfigInputs();
      }
      if (key === 'turbo' || key === 'battleBoost') {
        if (!config.turbo) turboStop();
        else turboPhaseNow = null;
      }
      saveConfig();
    });
  });
  syncConfigInputs();

  function gameWindow() {
    const frame = document.querySelector('iframe.game-iframe');
    return frame && frame.contentWindow;
  }

  function applySpeed(value) {
    const w = gameWindow();
    if (w && w.__nsSetSpeed) w.__nsSetSpeed(value);
    else storage.set('nsSpeed', String(value));
    $sp.querySelectorAll('button').forEach((btn) => btn.classList.toggle('sel', Number(btn.dataset.v) === value));
  }

  $sp.addEventListener('click', (e) => {
    const value = Number(e.target && e.target.dataset && e.target.dataset.v);
    if (value) applySpeed(value);
  });

  /*
   * Turbo: battles (enemy, pet and player animations) run at the highest speed and everything
   * else one step lower, then each phase learns its own safe speed. A page load the bot did not
   * ask for while it was running (lost connection, Ruffle crash, stall recovery) counts against
   * the phase that was active, which drops one step; after a long clean run a phase tries one step
   * higher again, unless that speed already failed twice.
   */
  const TURBO_KEY = 'nsTurbo';
  const TURBO_MAX = 5;
  /*
   * Outside battles the gain from speed is small and the game-server calls (mission start/end)
   * happen there, so that phase never goes above 4x.
   */
  const TURBO_CAP = { battle: TURBO_MAX, other: 4 };
  const BOOST_MAX = 8;
  const capOf = (phase) => (phase === 'battle' && config.battleBoost ? BOOST_MAX : TURBO_CAP[phase]);
  /*
   * Battle ekstrem climbs above 5x after only a few clean missions; a failure still drops the
   * speed straight away and two failures at a speed rule it out for good.
   */
  const probeAfter = (phase) => (phase === 'battle' && config.battleBoost ? 5 : TURBO_PROBE_AFTER);
  const TURBO_MIN = 3;
  const TURBO_PROBE_AFTER = 25;
  const turbo = (() => {
    const fresh = { speed: { battle: TURBO_MAX, other: 4 }, clean: { battle: 0, other: 0 }, failsAt: { battle: {}, other: {} }, log: [] };
    try {
      const saved = JSON.parse(storage.get(TURBO_KEY) || 'null');
      return saved && saved.speed ? { ...fresh, ...saved } : fresh;
    } catch (e) {
      return fresh;
    }
  })();
  const saveTurbo = () => storage.set(TURBO_KEY, JSON.stringify(turbo));
  let turboPhaseNow = null;

  function setRuntimeSpeed(value) {
    const w = gameWindow();
    if (!w) return;
    if (w.__nsSetRuntimeSpeed) {
      w.__nsSetRuntimeSpeed(value);
      return;
    }
    /*
     * A page loaded before the hook gained the runtime setter is capped at 5x; the update is
     * applied by a reload, which is only done in the village.
     */
    if (value > TURBO_MAX && storage.get('nsReloadAtVillage') !== '1') storage.set('nsReloadAtVillage', '1');
    if (!w.__nsSetSpeed) return;
    const chosen = storage.get('nsSpeed');
    w.__nsSetSpeed(value);
    storage.set('nsSpeed', chosen);
  }

  function turboPhase(phase) {
    if (!config.turbo || phase === turboPhaseNow) return;
    if (turbo.speed[phase] > capOf(phase)) turbo.speed[phase] = capOf(phase);
    turboPhaseNow = phase;
    storage.set('nsTurboPhase', phase);
    setRuntimeSpeed(turbo.speed[phase]);
  }

  function turboStop() {
    turboPhaseNow = null;
    storage.set('nsTurboPhase', null);
    applySpeed(Number(storage.get('nsSpeed')) || CFG.defaultSpeed);
  }

  const markCleanReload = () => storage.set('nsTurboClean', '1');

  function turboMissionDone() {
    if (!config.turbo) return;
    for (const phase of ['battle', 'other']) {
      turbo.clean[phase]++;
      const next = turbo.speed[phase] + 1;
      if (next <= capOf(phase) && turbo.clean[phase] >= probeAfter(phase) && (turbo.failsAt[phase][next] || 0) < 2) {
        turbo.speed[phase] = next;
        turbo.clean[phase] = 0;
        turbo.log = turbo.log.concat(`${new Date().toISOString().slice(5, 16)} ${phase} naik ke ${next}x`).slice(-10);
      }
    }
    saveTurbo();
  }

  if (!window.__nsTurboChecked) {
    window.__nsTurboChecked = true;
    const phase = storage.get('nsTurboPhase');
    const clean = storage.get('nsTurboClean') === '1';
    storage.set('nsTurboClean', null);
    if (config.turbo && phase && turbo.speed[phase] && !clean && storage.get(AUTORUN_KEY) === '1') {
      const was = turbo.speed[phase];
      turbo.failsAt[phase][was] = (turbo.failsAt[phase][was] || 0) + 1;
      turbo.speed[phase] = Math.max(TURBO_MIN, was - 1);
      turbo.clean[phase] = 0;
      turbo.log = turbo.log.concat(`${new Date().toISOString().slice(5, 16)} error saat ${phase} ${was}x, turun ke ${turbo.speed[phase]}x`).slice(-10);
      saveTurbo();
    }
  }
  applySpeed(Number(storage.get('nsSpeed')) || CFG.defaultSpeed);

  /*
   * Every status maps to a step; the time spent in each step is summed per mission so the panel
   * can show which part of a mission is slow, and "Laporkan lambat" saves the current step with a
   * screenshot for later analysis.
   */
  const STEPS = [
    ['Pertarungan', /Giliran/],
    ['Peta: Go!', /Go!|pindah area/],
    ['Peta: cari musuh', /mengklik musuh|Mengklik musuh|berjalan|Transisi/],
    ['Navigasi misi', /Mission Room|Grade|misi XP|Membuka misi|Misi #|panel|Patch/],
    ['Dialog / hasil', /dialog|checkmark|Level|tutorial/],
  ];
  const stepOf = (text) => (STEPS.find(([, re]) => re.test(text)) || ['Lainnya'])[0];
  const steps = { name: 'Lainnya', since: Date.now(), mission: {}, last: null };

  function trackStep(text) {
    const name = stepOf(text);
    if (name === steps.name) return;
    const now = Date.now();
    steps.mission[steps.name] = (steps.mission[steps.name] || 0) + (now - steps.since);
    steps.name = name;
    steps.since = now;
  }

  function closeMissionSteps() {
    trackStep('');
    steps.mission[steps.name] = (steps.mission[steps.name] || 0) + (Date.now() - steps.since);
    steps.since = Date.now();
    if (Object.keys(steps.mission).length) steps.last = steps.mission;
    steps.mission = {};
  }

  function renderSteps(el) {
    if (!el) return;
    el.textContent = '';
    const row = (k, v, slow) => {
      const a = document.createElement('div');
      a.className = 'k';
      a.textContent = k;
      const b = document.createElement('div');
      b.className = slow ? 'v slow' : 'v';
      b.textContent = v;
      el.append(a, b);
    };
    if (state.running) {
      const cur = (Date.now() - steps.since) / 1000;
      row('Sekarang', `${steps.name} \u00b7 ${cur.toFixed(1)} dtk`, cur > 10);
    } else row('Sekarang', 'bot berhenti', false);
    if (!steps.last) {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent = 'Rincian per langkah muncul setelah misi berikutnya dimulai.';
      el.appendChild(n);
      return;
    }
    const total = Object.values(steps.last).reduce((t, v) => t + v, 0) || 1;
    for (const [k, v] of Object.entries(steps.last).sort((a, b) => b[1] - a[1])) {
      const share = v / total;
      row(k, `${(v / 1000).toFixed(1)} dtk \u00b7 ${Math.round(share * 100)}%`, k.startsWith('Peta') && share > 0.35);
    }
  }

  function reportSlow() {
    const st = stage();
    let image = null;
    if (st) {
      const f = fit(st.canvas.width, st.canvas.height, st);
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 360;
      c.getContext('2d').drawImage(st.canvas, f.ox, f.oy, st.swfW * f.k, st.swfH * f.k, 0, 0, 480, 360);
      image = c.toDataURL('image/jpeg', 0.6);
    }
    let list = [];
    try {
      list = JSON.parse(storage.get('nsSlowReports') || '[]');
    } catch (e) {
      list = [];
    }
    list.push({ at: new Date().toISOString(), step: steps.name, status: state.status, secs: Math.round((Date.now() - steps.since) / 100) / 10, last: steps.last, image });
    storage.set('nsSlowReports', JSON.stringify(list.slice(-10)));
  }

  function setStatus(text) {
    trackStep(text);
    state.status = text;
    $s.textContent = text;
    const lock = chakra.at >= 0 ? ` | Chakra terkunci ${chakra.lockValue}` : '';
    $c.textContent = `Misi: ${state.missions} | Giliran: ${state.turns}${lock}`;
    renderStats($st);
    renderGoal($goal);
    renderSteps($steps);
    $dot.classList.toggle('on', state.running);
  }

  function renderButton() {
    $b.textContent = state.running ? 'Stop' : 'Start';
    $b.classList.toggle('on', state.running);
  }

  function stopWith(message) {
    state.running = false;
    turboStop();
    renderButton();
    setStatus(message);
  }

  function toggle() {
    state.running = !state.running;
    storage.set(AUTORUN_KEY, state.running ? '1' : null);
    window.postMessage({ source: 'nsBot', type: state.running ? 'start' : 'stop' }, '*');
    renderButton();
    if (!state.running) turboStop();
    if (state.running) {
      /*
       * The user may have switched to another character since the last run; a manual Start always
       * re-reads which missions this character has unlocked instead of trusting the cache.
       */
      state.rescanBest = true;
      state.tableMiss = false;
      /*
       * Time spent stopped is not part of any step, so the partial mission's step times restart
       * from the moment the bot is started.
       */
      steps.mission = {};
      steps.name = 'Lainnya';
      steps.since = Date.now();
      setStatus('Mulai...');
      loop();
    }
  }

  $b.addEventListener('click', toggle);
  const onKey = (e) => {
    if (e.altKey && e.code === 'KeyS') {
      e.preventDefault();
      toggle();
    }
  };
  window.addEventListener('keydown', onKey);

  /*
   * The site swaps its Play/Store/... sections in place (showPanel + pushState), and the game can
   * call showPanel through ExternalInterface when a stray click hits an in-game shop button. While
   * the bot runs, only real user clicks or a Play section may switch panels.
   */
  let allowPanelSwitch = false;
  window.__nsBlockedPanels = window.__nsBlockedPanels || [];
  if (typeof window.showPanel === 'function' && !window.showPanel.__nsGuarded) {
    const sitePanel = window.showPanel;
    const guarded = function (...args) {
      const running = !!(window.__nsBot && window.__nsBot.state.running);
      const userClick = !!(window.event && window.event.isTrusted);
      if (running && !userClick && !allowPanelSwitch && !args.some((a) => /play|game-container/i.test(String(a)))) {
        window.__nsBlockedPanels.push({ args: args.map(String), at: Date.now() });
        return undefined;
      }
      return sitePanel.apply(this, args);
    };
    guarded.__nsGuarded = true;
    window.showPanel = guarded;
  }

  /*
   * If the tab still drifts away from /play, the site's own PLAY link switches back in place,
   * keeping the running game; a full load to /play is the fallback when no such link exists.
   */
  const backToPlay = () => {
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent.trim().toLowerCase() === 'play');
    if (!link) {
      markCleanReload();
      location.href = '/play';
      return;
    }
    allowPanelSwitch = true;
    try {
      link.click();
    } finally {
      allowPanelSwitch = false;
    }
  };
  const playGuardTimer = setInterval(() => {
    if (/^\/play/.test(location.pathname)) return;
    if (state.running || storage.get(AUTORUN_KEY) === '1') backToPlay();
  }, 1500);

  const syncVisibility = () => {
    host.style.display = document.querySelector('iframe.game-iframe') ? '' : 'none';
  };
  syncVisibility();
  const visibilityTimer = setInterval(syncVisibility, 1000);
  const hudTimer = setInterval(() => {
    if (state.navigating) return;
    const hud = readHudXp();
    if (hud) {
      applyHud(hud);
      renderGoal($goal);
    }
  }, 5000);

  /*
   * recover() reloads the page with the autorun flag set; resume once the game iframe and its
   * Ruffle canvas exist again so patch, chakra lock and speed are re-applied on the fresh memory.
   */
  let resumeTimer = null;
  if (storage.get(AUTORUN_KEY) === '1') {
    setStatus('Menunggu game termuat untuk melanjutkan...');
    resumeTimer = setInterval(() => {
      if (state.running || !stage()) return;
      clearInterval(resumeTimer);
      applySpeed(Number(storage.get('nsSpeed')) || CFG.defaultSpeed);
      toggle();
    }, 1000);
  }

  window.__nsBot = {
    diagnose: () => {
      const s = snap();
      if (!s) return null;
      return { map: looksLikeMap(s), enemies: enemies(s), go: findGoArrow(s), turn: isMyTurn(s), battle: inBattle(s), dialog: isDialog(s), village: isVillage(s), inMission: state.inMission, mapAgo: Date.now() - (state.mapSeenAt || 0) };
    },
    report: () => {
      const per = (k) => (waste.missions ? +(waste.total[k] / waste.missions).toFixed(2) : 0);
      const slow = (() => {
        try {
          return JSON.parse(storage.get('nsSlowReports') || '[]').map((r) => ({ ...r, image: undefined }));
        } catch (e) {
          return [];
        }
      })();
      const unknown = (() => {
        try {
          return JSON.parse(storage.get(UNKNOWN_KEY) || '[]').map((r) => ({ at: r.at, note: r.note, status: r.status }));
        } catch (e) {
          return [];
        }
      })();
      return JSON.stringify({
        level: config.currentLevel,
        mission: describeMission(),
        speed: currentSpeed(),
        turbo: config.turbo ? { ...turbo.speed, log: turbo.log } : null,
        missionGaps: missionGapsBySpeed(),
        wastePerMission: Object.fromEntries(Object.keys(WASTE_LABELS).map((k) => [k, per(k)])),
        wasteMissions: waste.missions,
        xpNow: stats.xpNow,
        xpPrev: stats.xpPrev,
        goal: stats.goal,
        lastMissionSteps: steps.last,
        scanLog: state.scanLog,
        slow,
        unknown,
      });
    },
    pageFingerprint: () => {
      const fp = listFingerprint(snap());
      const prev = window.__nsLastFp;
      window.__nsLastFp = fp;
      return { bright: fp ? fp.reduce((n, v) => n + v, 0) : 0, total: fp ? fp.length : 0, diffFromLast: prev ? fpDiff(prev, fp) : null };
    },
    findMissionRoom: () => {
      const s = snap();
      return s && findMissionRoomLabel(s);
    },
    state,
    chakra,
    toggle,
    notice(text) {
      setStatus(text);
    },
    requestReloadAtVillage() {
      storage.set('nsReloadAtVillage', '1');
    },
    destroy() {
      state.running = false;
      clearInterval(visibilityTimer);
      clearInterval(hudTimer);
      clearInterval(playGuardTimer);
      clearInterval(stepTimer);
      if (resumeTimer) clearInterval(resumeTimer);
      window.removeEventListener('keydown', onKey);
      host.remove();
    },
  };
})();
