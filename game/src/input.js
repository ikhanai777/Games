// Input (§4): keyboard, gamepad and touch, all reduced to the same three bits.
// Every change is queued with its timestamp so the sim can apply it on the exact tick.

import { BIT_L, BIT_R, BIT_P } from './sim.js';

export class Input {
  constructor(getSettings) {
    this.getSettings = getSettings;
    this.codes = new Set();
    this.touch = new Map(); // pointerId -> 'left' | 'right'
    this.pad = { left: false, right: false, pulse: false, start: false, a: false, b: false, up: false, down: false };
    this.queue = [];
    this.oneDir = BIT_L;
    this.listeners = [];
    this.lastBits = 0;
  }

  onKey(fn) {
    this.listeners.push(fn);
  }

  action(code) {
    const b = this.getSettings().bindings;
    if (b.left.includes(code)) return 'left';
    if (b.right.includes(code)) return 'right';
    if (b.pulse.includes(code)) return 'pulse';
    return null;
  }

  // target: receives keys (window); surface: the element that takes touches (the stage).
  attach(target, surface) {
    target.addEventListener('keydown', (e) => {
      const a = this.action(e.code);
      if (a || ['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) {
        if (!e.target.closest || !e.target.closest('input, select, textarea')) e.preventDefault();
      }
      if (!e.repeat) {
        this.codes.add(e.code);
        if (a) this.changed(e.timeStamp, a, true);
      }
      for (const fn of this.listeners) fn({ type: 'down', code: e.code, action: a, repeat: e.repeat, ts: e.timeStamp, event: e });
    });
    target.addEventListener('keyup', (e) => {
      this.codes.delete(e.code);
      const a = this.action(e.code);
      if (a) this.changed(e.timeStamp, a, false);
      for (const fn of this.listeners) fn({ type: 'up', code: e.code, action: a, ts: e.timeStamp, event: e });
    });
    window.addEventListener('blur', () => {
      this.codes.clear();
      this.touch.clear();
      this.changed(performance.now(), null, false);
    });

    const side = (e) => (e.clientX < window.innerWidth / 2 ? 'left' : 'right');
    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      const s = side(e);
      this.touch.set(e.pointerId, s);
      this.changed(e.timeStamp, s, true);
      for (const fn of this.listeners) fn({ type: 'down', code: 'Touch', action: s, ts: e.timeStamp, event: e });
    });
    const up = (e) => {
      if (!this.touch.has(e.pointerId)) return;
      const s = this.touch.get(e.pointerId);
      this.touch.delete(e.pointerId);
      this.changed(e.timeStamp, s, false);
      for (const fn of this.listeners) fn({ type: 'up', code: 'Touch', action: s, ts: e.timeStamp, event: e });
    };
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
  }

  held(action) {
    const b = this.getSettings().bindings[action];
    for (const c of b) if (this.codes.has(c)) return true;
    for (const s of this.touch.values()) if (s === action) return true;
    return !!this.pad[action];
  }

  changed(ts, action, down) {
    // One-button mode (§13): any rotate press reverses the constant rotation.
    if (down && this.getSettings().oneButton && (action === 'left' || action === 'right')) {
      this.oneDir = this.oneDir === BIT_L ? BIT_R : BIT_L;
    }
    const bits = this.bits();
    if (bits !== this.lastBits) {
      this.queue.push({ ts, bits });
      this.lastBits = bits;
    }
  }

  bits() {
    let b = 0;
    if (this.getSettings().oneButton) b = this.oneDir;
    else {
      if (this.held('left')) b |= BIT_L;
      if (this.held('right')) b |= BIT_R;
    }
    if (this.held('pulse')) b |= BIT_P;
    return b;
  }

  resetRun() {
    this.oneDir = BIT_L;
    this.queue.length = 0;
    this.lastBits = this.bits();
  }

  // Take all queued changes with timestamps <= ts (performance.now() ms).
  drain(ts) {
    let i = 0;
    while (i < this.queue.length && this.queue[i].ts <= ts) i++;
    return this.queue.splice(0, i);
  }

  // Gamepad polling, once per frame. Emits synthetic key events for menus.
  pollGamepad() {
    let pads = [];
    try {
      pads = navigator.getGamepads ? navigator.getGamepads() : [];
    } catch {
      return; // gamepads blocked by the embedding page's permissions policy
    }
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return;
    const btn = (i) => !!gp.buttons[i] && gp.buttons[i].pressed;
    const ax = gp.axes[0] || 0;
    const ay = gp.axes[1] || 0;
    const next = {
      left: btn(4) || btn(14) || ax < -0.5,
      right: btn(5) || btn(15) || ax > 0.5,
      pulse: btn(0),
      start: btn(9),
      a: btn(0),
      b: btn(1),
      up: btn(12) || ay < -0.5,
      down: btn(13) || ay > 0.5,
    };
    const now = performance.now();
    const map = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', a: 'Enter', b: 'Escape', start: 'Escape' };
    for (const k of Object.keys(next)) {
      if (next[k] === this.pad[k]) continue;
      this.pad[k] = next[k];
      if (k === 'left' || k === 'right' || k === 'pulse') this.changed(now, k, next[k]);
      if (map[k]) {
        const act = k === 'left' || k === 'right' ? k : null;
        for (const fn of this.listeners) fn({ type: next[k] ? 'down' : 'up', code: map[k], action: act, ts: now, pad: true });
      }
    }
  }
}
