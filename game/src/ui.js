// DOM menus and HUD (§9, §13, §16). Menus are keyboard-, gamepad- and touch-navigable
// lists; every screen is rebuilt from state on change.

import { MOVEMENTS, TIERS, MILESTONES, PIPS_PER_CHARGE, MAX_CHARGES, DEFAULT_SETTINGS } from './config.js';
import { PATTERNS, patternFits } from './patterns.js';
import { hashString } from './rng.js';

const fmt = (s) => (s || 0).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KEYNAME = (code) => code.replace(/^Key/, '').replace(/^Arrow/, '').replace(/^Digit/, '');
const pct = (v) => `${Math.round(v * 100)}%`;
const onOff = (v) => (v ? 'On' : 'Off');

export class UI {
  constructor(overlay, hud, app) {
    this.el = overlay;
    this.hud = hud;
    this.app = app;
    this.screen = null;
    this.focus = 0;
    this.stack = [];
    this.sel = { movement: 0, tier: 0, endless: 0, gauntletTier: 0, practice: { movement: 0, tier: 0, offset: 0, speed: 1, gym: 0 } };
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.buildHud();
    overlay.addEventListener('click', (e) => this.onClick(e));
  }

  get S() {
    return this.app.data.settings;
  }

  // ---- Screen plumbing --------------------------------------------------------------

  show(name, push = false) {
    if (push && this.screen) this.stack.push({ name: this.screen, focus: this.focus });
    else if (!push) this.stack = [];
    this.screen = name;
    this.focus = 0;
    this.confirm = null;
    this.hud.classList.toggle('in-run', false);
    if (name === 'movements') this.focus = this.sel.movement;
    this.render();
  }

  back() {
    if (this.screen === 'calibrate') this.app.calibration.stop();
    const prev = this.stack.pop();
    if (prev) {
      this.screen = prev.name;
      this.focus = prev.focus;
      this.render();
    } else if (this.screen === 'pause') this.app.resume();
    else if (this.screen === 'results') this.app.quitToMenu();
    else if (this.screen !== 'main' && this.screen !== 'title') this.show('main');
  }

  enterRun() {
    this.screen = null;
    this.el.innerHTML = '';
    this.el.className = '';
    this.hud.classList.add('in-run');
    this.hud.classList.remove('dead');
    this.last = {};
    this.updateHudStatic();
  }

  enterDeath() {
    this.hud.classList.add('dead');
    const run = this.app.run;
    const best = run.recordKey ? this.app.bestFor(run.recordKey) : 0;
    this.q('#death-time').textContent = fmt(run.finalTime);
    this.q('#death-best').textContent = run.recordKey ? (run.newBest ? 'NEW BEST' : `BEST ${fmt(best)}`) : 'PRACTICE';
    this.q('#death-best').classList.toggle('new', !!run.newBest);
    this.q('#death-pattern').textContent = `Hit by: ${run.sim.death.wall.pattern.toUpperCase()}`;
    this.q('#death-hint').textContent = this.touch
      ? 'Tap right: retry · Hold left: rewind'
      : `Hold ${KEYNAME(this.S.bindings.left[0])} to rewind · ${KEYNAME(this.S.bindings.right[0])} to retry · Esc for results`;
  }

  q(sel) {
    return this.hud.querySelector(sel);
  }

  callout(text, big = false) {
    const c = this.q('#callout');
    c.textContent = text;
    c.classList.toggle('big', big);
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
  }

  key(k) {
    if (!this.screen) return;
    const code = k.code;
    if (this.screen === 'title') return;
    if (this.screen === 'rebind') {
      if (code === 'Escape') return this.back();
      this.finishRebind(code);
      return;
    }
    if (this.screen === 'calibrate' && (code === 'Space' || code === 'Touch')) {
      this.app.calibration.tap(k.ts);
      this.render();
      return;
    }
    const items = this.items();
    const it = items[this.focus];
    const up = code === 'ArrowUp' || code === 'KeyW';
    const down = code === 'ArrowDown' || code === 'KeyS';
    const left = code === 'ArrowLeft' || code === 'KeyA';
    const right = code === 'ArrowRight' || code === 'KeyD';
    if (up || down) {
      const n = items.length;
      let f = this.focus;
      for (let i = 0; i < n; i++) {
        f = (f + (up ? -1 : 1) + n) % n;
        if (!items[f].separator) break;
      }
      this.focus = f;
      this.onFocus(items[f]);
      this.app.audio.sfx('blip');
    } else if ((left || right) && it) {
      const fn = left ? it.left : it.right;
      if (fn) {
        fn();
        this.app.audio.sfx('blip', { high: right });
      }
    } else if ((code === 'Enter' || code === 'Space') && it) {
      if (it.enter && !it.disabled) {
        this.app.audio.sfx('blip', { high: true });
        it.enter();
      }
    } else if (code === 'Escape' || code === 'Backspace') {
      this.back();
      return;
    }
    if (this.screen) this.render();
  }

  onClick(e) {
    if (this.screen === 'title') return this.app.leaveTitle();
    const chip = e.target.closest('[data-chip]');
    const row = e.target.closest('[data-i]');
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'back') return this.back();
    if (!row) return;
    const i = Number(row.dataset.i);
    const it = this.items()[i];
    this.focus = i;
    if (chip) {
      it.chip?.(Number(chip.dataset.chip));
    } else if (e.target.closest('[data-dir]')) {
      const d = e.target.closest('[data-dir]').dataset.dir;
      (d === 'l' ? it.left : it.right)?.();
    } else if (it.enter && !it.disabled) it.enter();
    else if (it.right) it.right();
    if (this.screen) this.render();
  }

  onFocus(it) {
    if (it && it.preview !== undefined) this.app.previewSong(it.preview);
  }

  items() {
    return this.defs()[this.screen]?.().items || [];
  }

  render() {
    if (!this.screen) return;
    const def = this.defs()[this.screen]();
    const items = def.items || [];
    if (this.focus >= items.length) this.focus = Math.max(0, items.length - 1);
    this.el.className = `screen screen-${this.screen}`;
    const rows = items
      .map((it, i) => {
        if (it.separator) return `<div class="sep">${esc(it.label || '')}</div>`;
        const cls = ['item', i === this.focus ? 'focus' : '', it.disabled ? 'disabled' : '', it.cls || ''].join(' ');
        if (it.html) return `<div class="${cls}" data-i="${i}">${it.html}</div>`;
        const val =
          it.value !== undefined
            ? `<span class="val">${it.left ? '<b data-dir="l">‹</b>' : ''}<span>${esc(it.value)}</span>${it.right ? '<b data-dir="r">›</b>' : ''}</span>`
            : '';
        const hint = it.hint ? `<small>${esc(it.hint)}</small>` : '';
        return `<div class="${cls}" data-i="${i}"><span class="lbl">${esc(it.label)}${hint}</span>${val}</div>`;
      })
      .join('');
    const backBtn = this.screen !== 'main' && this.screen !== 'title' ? '<button class="back" data-act="back" aria-label="Back">‹ Back</button>' : '';
    this.el.innerHTML = `
      <div class="panel">
        ${backBtn}
        ${def.head || ''}
        ${def.title ? `<h2>${esc(def.title)}</h2>` : ''}
        ${def.sub ? `<p class="sub">${def.sub}</p>` : ''}
        <div class="list">${rows}</div>
        ${def.foot ? `<p class="foot">${def.foot}</p>` : ''}
      </div>`;
    const f = this.el.querySelector('.focus');
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
  }

  // ---- HUD ------------------------------------------------------------------------------

  buildHud() {
    this.hud.innerHTML = `
      <div class="hud-tl"><div id="hud-stage"></div><div id="hud-best"></div></div>
      <div class="hud-tr"><div id="hud-time">0.00</div><div id="hud-next"></div></div>
      <div class="hud-bl"><div id="hud-charges"></div><div id="hud-pips"><i></i></div></div>
      <div class="hud-br"><div id="hud-style"></div></div>
      <div id="hud-invert">INVERTED</div>
      <div id="callout"></div>
      <button id="pause-btn" aria-label="Pause">II</button>
      <div id="death">
        <div id="death-time"></div>
        <div id="death-best"></div>
        <div id="death-pattern"></div>
        <div id="death-hint"></div>
      </div>`;
    this.q('#pause-btn').addEventListener('click', () => this.app.pause());
    this.last = {};
  }

  setText(sel, text) {
    if (this.last[sel] === text) return;
    this.last[sel] = text;
    this.q(sel).textContent = text;
  }

  updateHudStatic() {
    const run = this.app.run;
    const cfg = run.cfg;
    const modeName = { stage: '', endless: 'ENDLESS · ', daily: 'DAILY · ', gauntlet: 'GAUNTLET · ', practice: 'PRACTICE · ' }[cfg.mode];
    run.hudStageBase = modeName;
    this.q('#hud-charges').parentElement.style.display = this.S.classic ? 'none' : '';
    this.q('#hud-style').style.display = this.S.classic ? 'none' : '';
  }

  frame() {
    const app = this.app;
    const run = app.run;
    if (!run || !['playing', 'dead'].includes(app.state)) return;
    const sim = run.sim;
    const m = run.gen.movementAt(sim.t);
    const tierName = run.cfg.mode === 'endless' ? '' : ` · ${TIERS[run.tier].name.toUpperCase()}`;
    this.setText('#hud-stage', `${run.hudStageBase}${m.numeral} ${m.name.toUpperCase()}${tierName}`);
    const best = run.recordKey ? app.bestFor(run.recordKey) : 0;
    this.setText('#hud-best', run.recordKey ? `BEST ${fmt(best)}` : 'PRACTICE');
    const el = app.state === 'dead' ? run.finalTime : app.elapsed();
    this.setText('#hud-time', fmt(el));
    const next = (Math.floor(el / 10) + 1) * 10;
    const nextName = MILESTONES[Math.min(next / 10, MILESTONES.length) - 1];
    this.setText('#hud-next', `${nextName} ${next}`);
    this.setText('#hud-charges', '◆'.repeat(sim.charges) + '◇'.repeat(MAX_CHARGES - sim.charges));
    const pip = `${Math.round((sim.pips / PIPS_PER_CHARGE) * 100)}%`;
    if (this.last.pip !== pip) {
      this.last.pip = pip;
      this.q('#hud-pips i').style.width = pip;
    }
    this.setText('#hud-style', `STYLE ${Math.round(sim.style)}  ×${1 + Math.floor((sim.t - sim.lastPulseT) / 10)}`);
    const inv = sim.t < sim.invertUntil;
    if (this.last.inv !== inv) {
      this.last.inv = inv;
      this.q('#hud-invert').classList.toggle('show', inv);
    }
  }

  // ---- Rebinding --------------------------------------------------------------------------

  startRebind(action) {
    this.rebindAction = action;
    this.show('rebind', true);
  }

  finishRebind(code) {
    const b = this.S.bindings;
    for (const k of Object.keys(b)) b[k] = b[k].filter((c) => c !== code);
    b[this.rebindAction] = [code, ...b[this.rebindAction]].slice(0, 3);
    this.app.save();
    this.back();
  }

  // ---- Screens ----------------------------------------------------------------------------

  defs() {
    const app = this.app;
    const data = app.data;
    const S = this.S;
    const sel = this.sel;
    const unlocked = (m, t) => !!data.unlocked[`${m}:${t}`];
    const anyUnlocked = (m) => [0, 1, 2].some((t) => unlocked(m, t));
    const cycle = (arr, cur, d) => arr[(arr.indexOf(cur) + d + arr.length) % arr.length];
    const cat = app.store.category(S);
    const setS = (k, v) => {
      S[k] = v;
      app.save();
      if (k === 'musicVolume' || k === 'sfxVolume') app.applyVolumes();
    };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v * 100) / 100));

    return {
      title: () => ({
        head: `<div class="logo"><span>PULSE</span>GON</div>
          <p class="tag">Every wall is a note. Two buttons. Survive.</p>
          <p class="press">${this.touch ? 'Tap to start' : 'Press any key'}</p>
          <p class="warn">Headphones recommended · Contains flashing visuals and camera rotation — both can be reduced in Options.</p>`,
      }),

      main: () => ({
        head: '<div class="logo small"><span>PULSE</span>GON</div>',
        items: [
          { label: 'Movements', hint: 'The campaign: 6 songs × 3 tiers', enter: () => this.show('movements', true) },
          { label: 'Endless', hint: 'One song, forever, getting harder', enter: () => this.show('endless', true) },
          { label: 'Daily Seed', hint: 'Same run for everyone today · 3 ranked tries', enter: () => this.show('daily', true) },
          { label: 'Gauntlet', hint: 'All six Movements back to back, one life', enter: () => this.show('gauntlet', true) },
          { label: 'Practice', hint: 'Checkpoints, slow-mo and the pattern gym', enter: () => this.show('practice', true) },
          { label: 'Options', hint: 'Comfort, accessibility, audio, controls', enter: () => this.show('options', true) },
          { label: 'How to play', enter: () => this.show('help', true) },
        ],
        foot: `Category: <b>${cat}</b>`,
      }),

      movements: () => ({
        title: 'Movements',
        sub: `Survive the goal time to clear a tier. ${this.touch ? 'Tap a tier to play.' : '↑↓ song · ←→ tier · Enter to play'}`,
        items: MOVEMENTS.map((m) => {
          const tier = sel.tier;
          const chips = TIERS.map((t) => {
            const ok = unlocked(m.id, t.id);
            const cleared = data.cleared[`${m.id}:${t.id}`];
            const best = data.best[app.store.recordKey('stage', m.id, t.id, S)] || 0;
            const cls = ['chip', t.id === tier && this.focus === m.id ? 'on' : '', ok ? '' : 'locked', cleared ? 'cleared' : ''].join(' ');
            return `<span class="${cls}" data-chip="${t.id}"><b>${t.name}</b><i>${ok ? (best ? fmt(best) : '—') : '🔒'}</i></span>`;
          }).join('');
          return {
            html: `<span class="num">${m.numeral}</span><span class="mv"><b>${esc(m.name)}</b><small>${m.bpm} BPM · ${esc(m.signature)} · goal ${m.goal}s</small></span><span class="chips">${chips}</span>`,
            cls: 'movement',
            preview: m.id,
            left: () => (sel.tier = Math.max(0, sel.tier - 1)),
            right: () => (sel.tier = Math.min(2, sel.tier + 1)),
            chip: (t) => {
              sel.tier = t;
              sel.movement = m.id;
              if (unlocked(m.id, t)) app.startRun({ mode: 'stage', movement: m.id, tier: t });
            },
            enter: () => {
              sel.movement = m.id;
              if (unlocked(m.id, sel.tier)) app.startRun({ mode: 'stage', movement: m.id, tier: sel.tier });
            },
          };
        }),
        foot: 'Clearing a tier unlocks the next tier and the next Movement.',
      }),

      endless: () => {
        const opts = MOVEMENTS.filter((m) => anyUnlocked(m.id)).map((m) => m.id);
        if (!opts.includes(sel.endless)) sel.endless = opts[0];
        const m = MOVEMENTS[sel.endless];
        const best = data.best[app.store.recordKey('endless', m.id, 1, S)] || 0;
        const move = (d) => {
          sel.endless = cycle(opts, sel.endless, d);
          app.previewSong(sel.endless);
        };
        return {
          title: 'Endless',
          sub: 'The generator never stops. Speed, density and pattern difficulty ramp for three minutes, then stay brutal.',
          items: [
            { label: 'Song', value: `${m.numeral} ${m.name}`, left: () => move(-1), right: () => move(1), preview: m.id },
            { label: 'Start', hint: best ? `Best ${fmt(best)}` : 'No record yet', enter: () => app.startRun({ mode: 'endless', movement: m.id, tier: 1 }) },
          ],
        };
      },

      daily: () => {
        const date = app.store.todayKey();
        const dayIndex = Math.floor(Date.parse(date) / 86400000);
        const m = MOVEMENTS[dayIndex % MOVEMENTS.length];
        const d = data.daily.date === date ? data.daily : { attempts: 0, best: 0 };
        const left = Math.max(0, 3 - d.attempts);
        const seed = hashString(`daily:${date}`);
        const tier = 1;
        return {
          title: `Daily Seed · ${date}`,
          sub: `Today: <b>${m.numeral} ${esc(m.name)}</b>, Hyper. Everyone gets the same walls. Three attempts count; practice is unlimited.`,
          items: [
            {
              label: left ? `Ranked attempt (${left} left)` : 'No ranked attempts left today',
              hint: d.best ? `Today's best ${fmt(d.best)}` : '',
              disabled: !left,
              enter: () => app.startRun({ mode: 'daily', movement: m.id, tier, seed, ranked: true }),
            },
            { label: 'Practice attempt', hint: 'Does not count', enter: () => app.startRun({ mode: 'daily', movement: m.id, tier, seed, ranked: false }) },
          ],
        };
      },

      gauntlet: () => {
        const t = sel.gauntletTier;
        const ok = MOVEMENTS.every((m) => unlocked(m.id, t));
        const best = data.best[app.store.recordKey('gauntlet', 0, t, S)] || 0;
        return {
          title: 'Gauntlet',
          sub: 'All six Movements back to back with seamless song and shape transitions. One life.',
          items: [
            { label: 'Tier', value: TIERS[t].name, left: () => (sel.gauntletTier = Math.max(0, t - 1)), right: () => (sel.gauntletTier = Math.min(2, t + 1)) },
            {
              label: ok ? 'Start' : 'Locked',
              hint: ok ? (best ? `Best ${fmt(best)}` : 'No record yet') : `Unlock ${TIERS[t].name} on every Movement first`,
              disabled: !ok,
              enter: () => app.startRun({ mode: 'gauntlet', movement: 0, tier: t }),
            },
          ],
        };
      },

      practice: () => {
        const p = sel.practice;
        const mOpts = MOVEMENTS.filter((m) => anyUnlocked(m.id)).map((m) => m.id);
        if (!mOpts.includes(p.movement)) p.movement = mOpts[0];
        const tOpts = [0, 1, 2].filter((t) => unlocked(p.movement, t));
        if (!tOpts.includes(p.tier)) p.tier = tOpts[0];
        const m = MOVEMENTS[p.movement];
        let reached = 0;
        for (const c of ['standard', 'classic', 'assisted', 'onebutton']) reached = Math.max(reached, data.best[`stage:${m.id}:${p.tier}:${c}`] || 0);
        const oOpts = [];
        for (let s = 0; s <= Math.min(m.goal - 10, Math.floor(reached / 10) * 10); s += 10) oOpts.push(s);
        if (!oOpts.includes(p.offset)) p.offset = 0;
        const feats = m.features;
        const gyms = [null, ...PATTERNS.filter((pt) => m.sides.some((N) => patternFits(pt, N, feats))).map((pt) => pt.name)];
        if (p.gym >= gyms.length) p.gym = 0;
        return {
          title: 'Practice',
          sub: 'Practice runs never count toward records or unlocks.',
          items: [
            { label: 'Movement', value: `${m.numeral} ${m.name}`, left: () => (p.movement = cycle(mOpts, p.movement, -1)), right: () => (p.movement = cycle(mOpts, p.movement, 1)), preview: m.id },
            { label: 'Tier', value: TIERS[p.tier].name, left: () => (p.tier = cycle(tOpts, p.tier, -1)), right: () => (p.tier = cycle(tOpts, p.tier, 1)) },
            { label: 'Start at', hint: 'Checkpoints you have reached', value: `${p.offset}s`, left: () => (p.offset = cycle(oOpts, p.offset, -1)), right: () => (p.offset = cycle(oOpts, p.offset, 1)) },
            { label: 'Speed', value: pct(p.speed), left: () => (p.speed = clamp(p.speed - 0.05, 0.5, 1)), right: () => (p.speed = clamp(p.speed + 0.05, 0.5, 1)) },
            {
              label: 'Pattern gym',
              hint: 'Loop one pattern',
              value: gyms[p.gym] ? gyms[p.gym] : 'Off',
              left: () => (p.gym = (p.gym - 1 + gyms.length) % gyms.length),
              right: () => (p.gym = (p.gym + 1) % gyms.length),
            },
            {
              label: 'Start practice',
              enter: () => app.startRun({ mode: 'practice', movement: p.movement, tier: p.tier, offset: p.offset, speed: p.speed, gym: gyms[p.gym] }),
            },
          ],
        };
      },

      options: () => {
        const palettes = ['vivid', 'mono', 'cb'];
        const palName = { vivid: 'Vivid', mono: 'High-contrast mono', cb: 'Colorblind-safe' };
        const toggle = (k, label, hint) => ({ label, hint, value: onOff(S[k]), enter: () => setS(k, !S[k]), left: () => setS(k, !S[k]), right: () => setS(k, !S[k]) });
        const range = (k, label, lo, hi, stepV, hint) => ({
          label, hint, value: pct(S[k]),
          left: () => setS(k, clamp(S[k] - stepV, lo, hi)),
          right: () => setS(k, clamp(S[k] + stepV, lo, hi)),
        });
        const bind = (a, label) => ({ label, value: S.bindings[a].map(KEYNAME).join(' / '), enter: () => this.startRebind(a) });
        return {
          title: 'Options',
          items: [
            { separator: true, label: 'View' },
            {
              label: 'Camera view',
              hint: app.has3d() ? 'Press V anytime to switch' : 'WebGL is unavailable, so only the flat view works here',
              value: app.viewName(S.view),
              left: () => setS('view', cycle(['3d', 'perspective', 'flat'], S.view, -1)),
              right: () => setS('view', cycle(['3d', 'perspective', 'flat'], S.view, 1)),
              enter: () => setS('view', cycle(['3d', 'perspective', 'flat'], S.view, 1)),
            },
            { separator: true, label: 'Comfort' },
            {
              label: 'Motion-sickness preset', hint: 'Rotation 20%, no tilt, no zoom, no flashes, top-down view',
              enter: () => {
                Object.assign(S, { rotation: 0.2, tilt: false, zoom: false, flashes: false });
                if (S.view === 'perspective') S.view = '3d';
                app.save();
              },
            },
            range('rotation', 'Camera rotation', 0, 1, 0.1, '0% = static arena, same gameplay'),
            toggle('tilt', 'Tilt'),
            toggle('zoom', 'Zoom punch'),
            toggle('flashes', 'Flashes'),
            toggle('photosensitive', 'Photosensitivity mode', 'No brightness pulsing or flashing'),
            { separator: true, label: 'Visibility' },
            { label: 'Palette', value: palName[S.palette], left: () => setS('palette', cycle(palettes, S.palette, -1)), right: () => setS('palette', cycle(palettes, S.palette, 1)) },
            toggle('outlines', 'Wall outlines'),
            toggle('wallCues', 'Audio wall cues', 'Stereo tick toward each incoming wall'),
            { separator: true, label: 'Difficulty (separate records)' },
            range('speed', 'Game speed', 0.7, 1, 0.05, 'Below 100% counts as Assisted'),
            toggle('oneButton', 'One-button mode', 'Constant rotation, any key reverses'),
            toggle('classic', 'Classic mode', 'No Pulse, grazing or glass walls'),
            toggle('autoRetry', 'Auto-retry', 'Restart 0.6 s after dying'),
            { separator: true, label: 'Audio' },
            range('musicVolume', 'Music volume', 0, 1, 0.1),
            range('sfxVolume', 'Effects volume', 0, 1, 0.1),
            toggle('announcer', 'Announcer voice'),
            { label: 'Audio/visual offset', value: `${Math.round(S.calibration * 1000)} ms`, enter: () => this.show('calibrate', true), hint: 'Tap-to-the-beat calibration' },
            { separator: true, label: 'Controls' },
            bind('left', 'Rotate left'),
            bind('right', 'Rotate right'),
            bind('pulse', 'Pulse'),
            { label: 'Reset controls', enter: () => { S.bindings = structuredClone(DEFAULT_SETTINGS.bindings); app.save(); } },
            { separator: true, label: 'Progress' },
            { label: 'Unlock everything', enter: () => { app.store.unlockAll(data); app.save(); } },
            {
              label: this.confirm === 'reset' ? 'Press again to erase all records' : 'Reset progress',
              cls: this.confirm === 'reset' ? 'danger' : '',
              enter: () => {
                if (this.confirm === 'reset') {
                  app.store.resetProgress(data);
                  app.save();
                  this.confirm = null;
                } else this.confirm = 'reset';
              },
            },
          ],
        };
      },

      rebind: () => ({
        title: 'Press a key',
        sub: `New key for <b>${esc(this.rebindAction)}</b>. Esc cancels.`,
      }),

      calibrate: () => {
        const c = app.calibration;
        const r = c.result ? c.result() : null;
        return {
          title: 'Calibrate',
          sub: `Press <b>Start</b>, then hit <b>Space</b> on every click. Current offset: <b>${Math.round(S.calibration * 1000)} ms</b>.`,
          items: [
            { label: 'Start', hint: `${c.taps ? c.taps.length : 0} taps recorded`, enter: () => c.start() },
            {
              label: r === null ? 'Save (need 4+ taps)' : `Save ${Math.round(r * 1000)} ms`,
              disabled: r === null,
              enter: () => {
                S.calibration = Math.max(-0.25, Math.min(0.25, r));
                app.save();
                this.back();
              },
            },
            { label: 'Reset to 0 ms', enter: () => { S.calibration = 0; app.save(); } },
          ],
        };
      },

      help: () => ({
        title: 'How to play',
        sub: `
          <b>${KEYNAME(S.bindings.left[0])} / ${KEYNAME(S.bindings.right[0])}</b> rotate (touch: hold the left or right half of the screen). Walls fly in on the beat, so find the gap.<br><br>
          Touching the <b>side</b> of a wall just blocks you. Hitting it <b>head-on</b> ends the run.<br><br>
          <b>Graze</b> walls (pass very close) to charge Pulse. Press <b>both</b> rotate keys together, or <b>${KEYNAME(S.bindings.pulse[0])}</b>, to Pulse: for an eighth note you pass through <b>glass</b> (hatched) walls. Pulse on the beat for a PERFECT, which refunds half a charge. Pulse is never required.<br><br>
          <b>Pendulums</b> sway, then lock one beat before impact. <b>Shutters</b> (dashed) close on the off-beat. <b>Echoes</b> show a ghost one bar early. <b>Inverters</b> (striped) flip your controls for one bar.<br><br>
          After a death, <b>hold left</b> to rewind and see the escape path; press <b>right</b> to retry.<br><br>
          Press <b>V</b> to switch between the 3D, perspective and flat views. The view never changes the gameplay.`,
        items: [],
      }),

      pause: () => {
        const run = app.run;
        const passed = run.walls.filter((w) => w.tHit <= run.sim.t).pop();
        return {
          title: 'Paused',
          sub: `Time <b>${fmt(app.elapsed())}</b> · Best <b>${fmt(run.recordKey ? app.bestFor(run.recordKey) : 0)}</b>${passed ? ` · Last pattern: ${esc(passed.pattern)}` : ''}`,
          items: [
            { label: 'Resume', enter: () => app.resume() },
            { label: 'Restart', enter: () => { app.audio.resume(); app.retry(); } },
            { label: 'Quit to menu', enter: () => app.quitToMenu() },
          ],
        };
      },

      results: () => {
        const run = app.run;
        const sim = run.sim;
        const pattern = sim.death.wall.pattern;
        const esc2 = app.computeEscape();
        const gymOk = run.cfg.mode !== 'gauntlet' && PATTERNS.some((p) => p.name === pattern);
        return {
          title: run.newBest ? 'New best!' : 'Results',
          sub: `
            <span class="big">${fmt(run.finalTime)}</span><br>
            Best ${fmt(run.recordKey ? app.bestFor(run.recordKey) : 0)} · Style ${Math.round(sim.style)} · Grazes ${sim.grazes} · Perfect pulses ${sim.perfects}<br>
            You died to: <b>${esc(pattern.toUpperCase())}</b>${esc2 ? ' — the dotted line shows a way out.' : ' — no escape from 2 s back; the mistake was earlier.'}`,
          items: [
            { label: 'Retry', enter: () => app.retry() },
            ...(gymOk
              ? [{
                  label: `Practice “${pattern}”`,
                  hint: 'Pattern gym',
                  enter: () => app.startRun({ mode: 'practice', movement: run.gen.movementAt(sim.t).id, tier: run.tier, offset: 0, speed: 1, gym: pattern }),
                }]
              : []),
            { label: 'Menu', enter: () => app.quitToMenu() },
          ],
        };
      },
    };
  }
}
