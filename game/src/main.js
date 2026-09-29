// Game shell: state machine, frame loop, run lifecycle, death cam, milestones.

import {
  DT, MOVEMENTS, TIERS, MILESTONES, HITBOX_HALF_DEG, DEATH_FREEZE, AUTO_RETRY_AFTER, SCRUB_SECONDS,
} from './config.js';
import { Timeline } from './timeline.js';
import { Generator } from './generator.js';
import { createSim, step, isPulsing, isInverted, thetaAt } from './sim.js';
import { solvePath } from './validator.js';
import { createRng, hashString } from './rng.js';
import { AudioEngine } from './audio.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { paletteFor, lerpPalette, css } from './palette.js';
import * as store from './storage.js';
import { UI } from './ui.js';

const canvas = document.getElementById('game');
const data = store.load();
const S = () => data.settings;
const audio = new AudioEngine();
const input = new Input(S);
const renderer = new Renderer(canvas);
const timeline = new Timeline();

const app = {
  data,
  state: 'title', // title | menu | playing | dead | paused | results | calibrate
  run: null,
  menuMovement: 0,
  save: () => store.save(data),
  store,
  audio,
  timeline,
};

const ui = new UI(document.getElementById('overlay'), document.getElementById('hud'), app);

// ---- Clock & music ---------------------------------------------------------------------

const gameNow = () => audio.now() - S().calibration;

function ensureAudio() {
  if (!audio.ok && audio.init()) {
    audio.setTimeline(timeline);
    audio.setStemLevel(2);
    applyVolumes();
  }
  if (!timeline.segs.length) playSong(app.menuMovement, 1);
  if (audio.ctx && audio.ctx.state === 'suspended' && app.state !== 'paused') audio.resume();
}

function applyVolumes() {
  audio.setVolumes(S().musicVolume, S().sfxVolume);
}

// Switch the music to a Movement's song (instantly — used from menus and on run start).
function playSong(movementId, speed) {
  const m = MOVEMENTS[movementId];
  const t = audio.scheduleTime() + 0.03;
  const seg = timeline.segs.length ? timeline.segAtTime(t) : null;
  timeline.truncateAfter(t);
  if (seg && seg.song === movementId && Math.abs(seg.bpm - m.bpm * speed) < 1e-6 && timeline.segs[timeline.segs.length - 1] === seg) return;
  timeline.addSegment(t, m.bpm * speed, m.swing, movementId);
  audio.next16 = null;
}

app.previewSong = (movementId) => {
  app.menuMovement = movementId;
  if (audio.ok) playSong(movementId, 1);
};

// ---- Runs --------------------------------------------------------------------------------

// cfg: { mode: stage|endless|daily|gauntlet|practice, movement, tier, seed?, offset?, speed?, gym? }
function startRun(cfg) {
  ensureAudio();
  const practice = cfg.mode === 'practice';
  const speed = practice ? cfg.speed ?? 1 : S().speed;
  const m = MOVEMENTS[cfg.mode === 'gauntlet' ? 0 : cfg.movement];
  timeline.truncateAfter(audio.scheduleTime());
  playSong(m.id, speed);
  const T0 = gameNow();
  const walls = [];
  const seed = cfg.seed ?? ((Math.random() * 2 ** 32) >>> 0);
  const tier = cfg.mode === 'endless' ? 1 : cfg.tier;
  const gen = new Generator({
    timeline, T0, movement: m, tier, walls,
    rng: createRng(seed),
    mode: cfg.mode === 'gauntlet' ? 'gauntlet' : 'stage',
    endless: cfg.mode === 'endless',
    classic: S().classic,
    gymPattern: practice ? cfg.gym : null,
    elapsedOffset: practice ? cfg.offset || 0 : 0,
    speed,
  });
  gen.fillUntil(7);
  const sim = createSim({
    walls,
    omega: cfg.mode === 'endless' ? 540 : TIERS[tier].omega,
    classic: S().classic,
    beatSec: (t) => timeline.beatSecAt(T0 + t),
    distToBeat: (t) => timeline.distToBeat(T0 + t),
  });
  input.resetRun();
  const offset = practice ? cfg.offset || 0 : 0;
  const recordMode = cfg.mode === 'daily' ? `daily-${store.todayKey()}` : cfg.mode;
  app.run = {
    cfg, T0, gen, sim, walls, seed, tier, offset,
    bits: input.bits(),
    milestone: Math.floor(offset / 10),
    cleared: false,
    recordKey: practice ? null : store.recordKey(recordMode, m.id, tier, S()),
    ranked: cfg.mode !== 'daily' || cfg.ranked,
    cues: new Set(),
    escape: undefined,
  };
  audio.setStemLevel(Math.min(4, 1 + app.run.milestone));
  app.state = 'playing';
  ui.enterRun();
}

app.startRun = startRun;

app.retry = () => {
  if (!app.run) return;
  const cfg = { ...app.run.cfg };
  if (cfg.mode === 'daily') {
    cfg.ranked = data.daily.date === store.todayKey() ? data.daily.attempts < 3 : true;
  }
  startRun(cfg);
};

app.elapsed = () => (app.run ? app.run.sim.t + app.run.offset : 0);
app.bestFor = (key) => data.best[key] || 0;

function currentMovement() {
  return app.run ? app.run.gen.movementAt(app.run.sim.t) : MOVEMENTS[app.menuMovement];
}

function updateRun() {
  const run = app.run;
  const sim = run.sim;
  const target = gameNow() - run.T0;
  run.gen.fillUntil(target + 7, 4);
  const perfNow = performance.now();
  let steps = 0;
  while (sim.alive && sim.t + DT <= target && steps < 480) {
    const tickPerf = perfNow - (target - (sim.t + DT)) * 1000;
    for (const ev of input.drain(tickPerf)) run.bits = ev.bits;
    step(sim, run.bits);
    steps++;
  }
  handleSimEvents(run);
  if (!sim.alive) return onDeath();

  const elapsed = sim.t + run.offset;
  const ms = Math.floor(elapsed / 10);
  if (ms > run.milestone) {
    run.milestone = ms;
    const name = MILESTONES[Math.min(ms, MILESTONES.length) - 1];
    audio.setStemLevel(Math.min(4, 1 + ms));
    audio.sfx('milestone', { quantize: true });
    announce(name);
    ui.callout(name);
    run.zoomKick = 1;
  }
  const goal = currentMovement().goal;
  if (!run.cleared && ['stage', 'daily'].includes(run.cfg.mode) && elapsed >= goal) {
    run.cleared = true;
    if (run.cfg.mode === 'stage') {
      store.markCleared(data, run.cfg.movement, run.tier);
      app.save();
    }
    audio.sfx('clear', { quantize: true });
    ui.callout(run.cfg.movement === 5 && run.tier === 2 ? 'PULSEGON' : 'CLEAR', true);
    announce(run.cfg.movement === 5 && run.tier === 2 ? 'Pulsegon. You are the rhythm.' : 'Excellent');
  }
  if (run.cfg.mode === 'gauntlet' && !run.cleared && run.gen.gauntletIndex === MOVEMENTS.length - 1 && elapsed >= totalGauntlet()) {
    run.cleared = true;
    ui.callout('GAUNTLET CLEAR', true);
    audio.sfx('clear', { quantize: true });
  }
  if (S().wallCues) wallCues(run);
  run.gen.prune(sim.t);
}

const totalGauntlet = () => MOVEMENTS.reduce((a, m) => a + m.goal, 0);

function handleSimEvents(run) {
  for (const e of run.sim.events) {
    if (e.type === 'graze') audio.sfx('graze', { pitch: run.sim.grazes % 12 });
    else if (e.type === 'pulse') audio.sfx(e.perfect ? 'perfect' : 'pulse');
    else if (e.type === 'glass') audio.sfx('glass');
    else if (e.type === 'invert') {
      audio.sfx('invert');
      ui.callout('INVERTED');
    }
  }
  run.sim.events.length = 0;
}

// §13 audio cues: a tick panned toward each wall one beat before it arrives.
function wallCues(run) {
  const t = run.sim.t;
  const beat = timeline.beatSecAt(run.T0 + t);
  for (const w of run.walls) {
    if (w.tHit < t) continue;
    if (w.tHit - t > beat) break;
    if (run.cues.has(w.id)) continue;
    run.cues.add(w.id);
    const mid = w.a0 + w.span / 2;
    const rel = (((mid - run.sim.theta + 540) % 360) - 180) * (Math.PI / 180);
    audio.sfx('cue', { pan: -Math.sin(rel) });
  }
}

function onDeath() {
  const run = app.run;
  const sim = run.sim;
  app.state = 'dead';
  run.deathPerf = performance.now();
  run.scrubT = sim.t;
  run.scrubbed = false;
  run.leftSinceDeath = false;
  audio.duck();
  audio.sfx('death');
  const time = sim.t + run.offset;
  run.finalTime = time;
  run.newBest = false;
  if (run.recordKey && run.ranked) {
    if (time > (data.best[run.recordKey] || 0)) {
      data.best[run.recordKey] = time;
      run.newBest = true;
    }
    if (sim.style > (data.style[run.recordKey] || 0)) data.style[run.recordKey] = sim.style;
  }
  if (run.cfg.mode === 'daily' && run.ranked) {
    const d = data.daily;
    if (d.date !== store.todayKey()) Object.assign(d, { date: store.todayKey(), attempts: 0, best: 0 });
    d.attempts++;
    d.best = Math.max(d.best, time);
  }
  app.save();
  ui.enterDeath();
}

function computeEscape(run) {
  if (run.escape !== undefined) return run.escape;
  const sim = run.sim;
  const tDeath = sim.death.t;
  run.escape = null;
  for (const back of [1, 1.5, 2]) {
    const t0 = Math.max(0, tDeath - back);
    const path = solvePath(run.walls, t0, thetaAt(sim, t0), tDeath + 0.5, sim.omega * 0.97, HITBOX_HALF_DEG + 0.5);
    if (path) {
      run.escape = path.map((p) => ({ t: p.t, theta: p.theta }));
      break;
    }
  }
  return run.escape;
}
app.computeEscape = () => app.run && computeEscape(app.run);

function updateDead(dt) {
  const run = app.run;
  const since = (performance.now() - run.deathPerf) / 1000;
  if (since > DEATH_FREEZE && run.leftSinceDeath && input.held('left')) {
    run.scrubbed = true;
    run.scrubT = Math.max(run.sim.death.t - SCRUB_SECONDS, run.scrubT - dt);
    computeEscape(run);
  }
  if (S().autoRetry && !run.leftSinceDeath && since > AUTO_RETRY_AFTER) app.retry();
}

// ---- Keys --------------------------------------------------------------------------------

input.onKey((k) => {
  if (k.type !== 'down') return;
  if (app.state === 'title') {
    app.leaveTitle();
    return;
  }
  if (app.state === 'playing') {
    if (k.code === 'Escape' || k.code === 'KeyP') pause();
    return;
  }
  if (app.state === 'dead') {
    const since = (performance.now() - app.run.deathPerf) / 1000;
    if (k.code === 'Escape') {
      app.state = 'results';
      ui.show('results');
      return;
    }
    if (k.action === 'left') {
      app.run.leftSinceDeath = true; // hold to rewind (§12.2); also cancels auto-retry
      return;
    }
    if (k.action === 'right' || k.action === 'pulse' || k.code === 'Enter') {
      if (since > 0.05) app.retry();
    }
    return;
  }
  ui.key(k);
});

function pause() {
  if (app.state !== 'playing') return;
  app.state = 'paused';
  audio.pause();
  ui.show('pause');
}

app.resume = () => {
  if (app.state !== 'paused') return;
  audio.resume().then(() => {
    app.state = 'playing';
    ui.enterRun();
  });
};

app.quitToMenu = () => {
  if (app.state === 'paused') audio.resume();
  app.state = 'menu';
  app.run = null;
  audio.setStemLevel(2);
  ui.show('main');
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// ---- Announcer (§3) ------------------------------------------------------------------------

function announce(text) {
  if (!S().announcer || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 0.55;
    u.volume = Math.min(1, S().sfxVolume + 0.1);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    /* no voice available */
  }
}

// ---- Calibration (§8) --------------------------------------------------------------------

app.calibration = {
  start() {
    ensureAudio();
    this.taps = [];
    this.clicks = [];
    if (!audio.ok) return;
    audio.musicVol.gain.value = 0;
    const t0 = audio.scheduleTime() + 0.6;
    for (let i = 0; i < 16; i++) {
      const at = t0 + i * 0.5;
      this.clicks.push(at);
      audio.sfx('click', { at, accent: i % 4 === 0 });
    }
  },
  tap(ts) {
    const heard = audio.perfToNow(ts);
    let best = null;
    for (const c of this.clicks) if (best === null || Math.abs(heard - c) < Math.abs(heard - best)) best = c;
    if (best !== null && Math.abs(heard - best) < 0.25) this.taps.push(heard - best);
  },
  result() {
    if (this.taps.length < 4) return null;
    const s = [...this.taps].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  },
  stop() {
    applyVolumes();
  },
};
app.applyVolumes = applyVolumes;

// ---- Frame -------------------------------------------------------------------------------

const camera = { angle: 0, vel: 0, dir: 1, phrase: -1 };
let palCur = null;
let lastFrame = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  input.pollGamepad();
  if (app.state === 'playing') updateRun();
  else if (app.state === 'dead') updateDead(dt);
  renderer.draw(buildView(dt));
  const accent = css(palCur.wall);
  if (accent !== lastAccent) {
    lastAccent = accent;
    document.documentElement.style.setProperty('--accent', accent);
  }
  ui.frame();
}
let lastAccent = '';

function buildView(dt) {
  const run = app.run;
  const st = S();
  const m = currentMovement();
  const tNow = gameNow();
  const hasTl = timeline.segs.length > 0;
  const beat = hasTl ? timeline.beatAt(tNow) : tNow * 2;
  const seg = hasTl ? timeline.segAtTime(tNow) : { b0: 0 };
  const rel = beat - seg.b0;
  const beatFrac = rel - Math.floor(rel);
  const barPos = ((rel % 4) + 4) % 4;
  const pulse = Math.exp(-beatFrac * 6);

  // Camera (§5.3): direction flips on phrase boundaries; everything scales with settings.
  const phrase = Math.floor(rel / 16);
  if (phrase !== camera.phrase) {
    camera.phrase = phrase;
    camera.dir = hashString(`${seg.song}:${phrase}`) % 2 ? 1 : -1;
  }
  const tier = run ? run.tier : 0;
  const intensity = 1 + 0.35 * tier + 0.08 * (run ? run.milestone : 0);
  let targetVel = m.cam.speed * intensity * camera.dir * st.rotation;
  if (app.state === 'dead') targetVel *= (performance.now() - run.deathPerf) / 1000 < DEATH_FREEZE ? 0 : 0.25;
  if (app.state === 'paused' || app.state === 'results') targetVel *= 0.15;
  if (!run) targetVel *= 0.5;
  camera.vel += (targetVel - camera.vel) * Math.min(1, dt * 8);
  if (app.state !== 'paused') camera.angle = (camera.angle + camera.vel * dt) % 360;

  // Palette crossfade on milestones (§12.1).
  let palIndex = 0;
  if (run) {
    const sw = run.gen.switches.filter((s) => run.sim.t >= s.t).pop();
    const since = sw.t < 0 ? run.sim.t + run.offset : run.sim.t - sw.t;
    palIndex = Math.max(0, Math.floor(since / 10));
  }
  const target = paletteFor(m, palIndex, st.palette);
  if (!palCur) palCur = target;
  palCur = lerpPalette(palCur, target, Math.min(1, dt * 2.5));

  const flashes = st.flashes && !st.photosensitive;
  const view = {
    t: 0,
    walls: [],
    palette: palCur,
    cam: camera.angle,
    zoom: 1 + (st.zoom && !st.photosensitive ? 0.04 * Math.exp(-barPos * 5) : 0),
    tiltY: 1,
    sides: m.sides[0],
    pulse: st.photosensitive ? 0.3 : pulse,
    bgBoost: flashes ? 0.05 * pulse : 0,
    showPlayer: false,
    outlines: st.outlines,
    echoLead: 0,
  };
  if (st.tilt && m.cam.tilt && !st.photosensitive) view.tiltY = 1 - m.cam.tilt * (0.5 + 0.5 * Math.sin((rel * Math.PI) / 8));

  if (run) {
    const sim = run.sim;
    const dead = app.state === 'dead' || app.state === 'results';
    const t = dead ? run.scrubT : sim.t;
    view.t = t;
    view.walls = run.walls;
    view.showPlayer = true;
    view.theta = dead ? thetaAt(sim, t) : sim.theta;
    view.pulsing = isPulsing(sim, t);
    view.inverted = isInverted(sim, t);
    view.echoLead = timeline.beatSecAt(run.T0 + t) * 4;
    if (run.zoomKick && st.zoom && !st.photosensitive) {
      view.zoom += 0.06 * run.zoomKick;
      run.zoomKick = Math.max(0, run.zoomKick - dt * 2);
    }
    // Morph telegraph and animation (§5.2).
    let sides = run.gen.movement.sides[0];
    if (run.gen.morphs.length) sides = run.gen.morphs[0].from;
    let centerSides = null;
    for (const mo of run.gen.morphs) {
      if (t >= mo.t + mo.beatSec) sides = mo.to;
      else if (t >= mo.t) sides = mo.from + (mo.to - mo.from) * ((t - mo.t) / mo.beatSec);
      else if (t >= mo.t - mo.barSec) centerSides = Math.floor((mo.t - t) / (mo.beatSec / 2)) % 2 ? mo.to : mo.from;
    }
    view.sides = sides;
    view.centerSides = centerSides;
    if (dead) {
      const since = (performance.now() - run.deathPerf) / 1000;
      view.deathWall = sim.death.wall;
      view.flash = flashes && since < DEATH_FREEZE && Math.floor(since * 10) % 2 === 0;
      view.pathSpeed = sim.death.wall.v;
      const trail = [];
      for (let tt = Math.max(0, t - 0.5); tt <= t; tt += DT * 4) trail.push({ t: tt, theta: thetaAt(sim, tt) });
      view.trail = trail;
      if (run.scrubbed || app.state === 'results') view.escape = computeEscape(run);
      if (app.state === 'results') view.vignette = 0.45;
    }
  } else if (m.sides.length > 1) {
    // Menus: gently cycle through the Movement's shapes.
    const idx = Math.floor(rel / 8) % m.sides.length;
    const frac = (rel % 8) / 8;
    const cur = m.sides[(idx + m.sides.length) % m.sides.length];
    const nxt = m.sides[(idx + 1) % m.sides.length];
    view.sides = frac > 0.9 ? cur + (nxt - cur) * ((frac - 0.9) / 0.1) : cur;
  }
  if (app.state === 'paused') view.vignette = 0.5;
  if (['menu', 'title', 'calibrate'].includes(app.state)) view.vignette = 0.25;
  return view;
}

window.addEventListener('resize', () => renderer.resize());
input.attach(window, canvas);
app.pause = pause;
app.ensureAudio = ensureAudio;
app.leaveTitle = () => {
  if (app.state !== 'title') return;
  ensureAudio();
  app.state = 'menu';
  ui.show('main');
};

ui.show('title');
requestAnimationFrame(frame);

// Test hook for automated smoke tests (read-only snapshot).
window.__pulsegon = { app, timeline, get state() { return app.state; } };
