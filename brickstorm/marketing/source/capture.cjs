// Captures real Brickstorm gameplay frame-by-frame with a virtual clock (30 fps).
const pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const OUT = __dirname + '/frames';
const GAME = 'file://' + require('path').resolve(__dirname, '../../index.html');

const initScript = () => {
  // virtual time
  let vt = 1000, q = [];
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  performance.now = () => vt;
  window.__step = ms => { vt += ms; const c = q; q = []; for (const f of c) f(vt); };
  // seeded Math.random
  let s = 12345;
  window.__seed = v => { s = v >>> 0; };
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  if (!localStorage.getItem('reel.init')) {
    const d = new Date(), today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    localStorage.setItem('brickstorm.profile', JSON.stringify({
      coins: 1240, best: 48210, bestLevel: 63, skin: 'neon', owned: ['classic', 'neon', 'ember', 'toxic'],
      upg: { balls: 2, luck: 1, crit: 0, coin: 1 }, muted: false, mTier: 4,
      missions: [{ type: 'level', n: 40, r: 110, prog: 31 }, { type: 'turn', n: 20, r: 105, prog: 14 }, { type: 'bombs', n: 25, r: 88, prog: 17 }],
      daily: { date: today, best: 21870, streak: 6, last: today }, stats: { kills: 9000, games: 40 }
    }));
    localStorage.setItem('reel.init', '1');
  }
};

// page-side helpers (top-level script bindings of the game are reachable by name)
const helpers = () => {
  window.__frame = 0; window.__ev = [];
  const INIT = JSON.stringify(profile);
  mprog = () => {}; // keep the profile/missions untouched while capturing
  for (const name of ['hit', 'brk', 'launch', 'pick', 'coin', 'boom', 'laser', 'zap', 'combo', 'clear', 'level', 'perk']) {
    const orig = Sfx[name];
    Sfx[name] = function (a) { window.__ev.push([window.__frame, name, a || 0]); return orig.apply(this, arguments); };
  }
  window.__craft = (L, layout, opts) => {
    __seed(opts.seed || 7);
    Object.assign(profile, JSON.parse(INIT));
    document.getElementById('toasts').innerHTML = '';
    hideAll(); store.del('run');
    newRun('classic');
    Object.assign(run, { level: L, balls: opts.balls, score: opts.score || 0, launchX: opts.x || W / 2, bricks: [], pickups: [], perks: opts.perks || {} });
    const map = { o: 'ball', $: 'coin', h: 'lh', v: 'lv', f: 'fire', s: 'split' };
    layout.forEach((row, r) => [...row].forEach((ch, c) => {
      const lo = opts.lo || 0.35, hi = opts.hi || 0.95;
      const hp = Math.max(1, Math.round(L * (lo + Math.random() * (hi - lo))));
      if (ch === 'n') addBrick(c, r, 1, 'n', hp);
      else if (ch === 'd') addBrick(c, r, 1, 'n', L * 2);
      else if (ch === 'b') addBrick(c, r, 1, 'bomb', hp);
      else if (ch === 'g') addBrick(c, r, 1, 'gold', hp);
      else if (ch === 'c') addBrick(c, r, 1, 'crystal', hp);
      else if (ch === 'T') { if (!run.bricks.some(b => b.type === 'titan')) addBrick(c, r, 3, 'titan', opts.titan); }
      else if (map[ch]) addPickup(c, r, map[ch]);
    }));
    rebuildGrid(); beginAim();
    fx.parts.length = fx.floats.length = fx.beams.length = fx.bolts.length = 0;
    profile.skin = opts.skin || 'neon';
    __seed(opts.seed2 || 99);
  };
  // run a shot without rendering, return bricks broken (for picking a spectacular angle)
  window.__trial = (a) => {
    setAimAngle(a); fire();
    let n = 0; while (state === 'fire' && n < 8000) { tick(); n++; }
    return run.kills;
  };
};

(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
  await ctx.addInitScript(initScript);
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(GAME);
  await pg.evaluate(helpers);
  const step = n => pg.evaluate(n => { for (let i = 0; i < n; i++) { window.__frame++; __step(1000 / 30); } }, n);
  const shot = async (name) => pg.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 92 });
  const canvasRect = await pg.evaluate(() => { const r = cv.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  const meta = { canvasRect, scenes: {} };

  // ---------------- scenes with gameplay
  const SCENES = {
    A: { L: 21, layout: ['nnbnnhn', 'n.nnn.n', 'dn.v.nd', 'nbn.nbn', '..nfn..', 'n.o.$.n', '.n...n.'],
         opts: { balls: 60, score: 18420, skin: 'neon', lo: 0.2, hi: 0.6, seed: 7 }, aimFrames: 46, maxFrames: 190 },
    B: { L: 30, layout: ['nnnnnnn', 'nTTTnbn', 'nb.h.bn', 'n.nfn.n', '..n.n..', 'o.....$'],
         opts: { balls: 88, score: 39750, skin: 'prism', lo: 0.25, hi: 0.6, titan: 70, perks: { volt: 2, power: 2 }, seed: 11 }, aimFrames: 0, maxFrames: 160 }
  };
  for (const [key, sc] of Object.entries(SCENES)) {
    // pick the most spectacular angle by simulating each candidate
    let best = { a: -1.2, k: -1 };
    for (let a = -2.6; a <= -0.55; a += 0.05) {
      await pg.evaluate(([L, lay, o]) => __craft(L, lay, o), [sc.L, sc.layout, sc.opts]);
      const k = await pg.evaluate(a => __trial(a), a);
      if (k > best.k) best = { a, k };
    }
    console.log(key, 'best angle', best.a.toFixed(2), 'kills', best.k);
    await pg.evaluate(([L, lay, o]) => __craft(L, lay, o), [sc.L, sc.layout, sc.opts]);
    await pg.evaluate(() => { window.__frame = 0; window.__ev = []; });
    await step(3);
    const finger = [];
    let f = 0;
    // aim sweep with a finger, then release
    const a0 = best.a + (best.a < -Math.PI / 2 ? 0.9 : -0.9);
    for (let i = 0; i < sc.aimFrames; i++, f++) {
      const t = Math.min(1, i / (sc.aimFrames - 10)), e = 1 - Math.pow(1 - t, 3);
      const a = a0 + (best.a - a0) * e;
      const p = await pg.evaluate(a => { aim.on = true; setAimAngle(a); const d = 230; return { x: run.launchX + Math.cos(a) * d, y: FLOOR - BR + Math.sin(a) * d }; }, a);
      finger.push(p);
      await step(1); await shot(`${key}_${String(f).padStart(4, '0')}`);
    }
    await pg.evaluate(a => { setAimAngle(a); aim.on = false; fire(); }, best.a);
    let endAt = -1;
    for (; f < sc.aimFrames + sc.maxFrames; f++) {
      await step(1); await shot(`${key}_${String(f).padStart(4, '0')}`);
      const st = await pg.evaluate(() => state);
      if (st !== 'fire' && endAt < 0) endAt = f;
      if (endAt >= 0 && f - endAt > 18) { f++; break; }
    }
    const ev = await pg.evaluate(() => window.__ev);
    meta.scenes[key] = { frames: f, aimFrames: sc.aimFrames, finger, events: ev, kills: await pg.evaluate(() => run.kills) };
    console.log(key, 'frames', f, 'events', ev.length, 'kills', meta.scenes[key].kills);
  }

  // ---------------- stills
  // perk choice
  await pg.evaluate(() => { __craft(20, ['nnbnnhn', 'n.nnn.n', 'dn.v.nd', 'nbn.nbn', '..nfn..'], { balls: 38, score: 24310, seed: 3 }); run.level = 20; showPerks(); });
  await step(4); await pg.waitForTimeout(500); await shot('perk');
  // game over with a new best
  await pg.evaluate(() => { hideAll(); __craft(58, ['nnnnnnn', 'dnn.nnd', 'n.nnn.n', 'nn.n.nn', 'n.ndn.n', 'nnn.nnn', 'n.n.n.n', 'nnnnnnn', 'dn.n.nd', 'n.nnn.n', 'nnn.nnn'], { balls: 71, score: 52340, seed: 5 });
    run.level = 58; run.kills = 1873; run.coins = 212; endRun(); });
  await step(4); await pg.waitForTimeout(500); await shot('over');
  // menu + shop
  await pg.evaluate(() => { store.del('run'); openMenu(); });
  await step(4); await pg.waitForTimeout(500); await shot('menu');
  await pg.evaluate(() => { renderShop(); show('shop'); });
  await step(4); await pg.waitForTimeout(500); await shot('shop');

  fs.writeFileSync(__dirname + '/meta.json', JSON.stringify(meta));
  console.log('errors', errs);
  await b.close();
})();
