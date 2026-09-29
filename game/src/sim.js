// Deterministic fixed-step simulation (§6, §14.1). step(sim, bits) is the only way the
// game state advances. bits: 1 = rotate CCW (left), 2 = rotate CW (right), 4 = Pulse key.

import {
  DT, HITBOX_HALF_DEG, GRAZE_DEG, PULSE_CHORD_TICKS, PIPS_PER_CHARGE, MAX_CHARGES, PERFECT_WINDOW, START_THETA,
} from './config.js';
import { atRadius, isSolidAt, wallStart, arcGap, mod360 } from './walls.js';

export const BIT_L = 1;
export const BIT_R = 2;
export const BIT_P = 4;

// o: { walls, omega, classic, beatSec(t), distToBeat(t), theta }
export function createSim(o) {
  const theta = o.theta ?? START_THETA;
  return {
    tick: 0,
    t: 0,
    theta,
    alive: true,
    walls: o.walls,
    omega: o.omega,
    classic: !!o.classic,
    beatSec: o.beatSec,
    distToBeat: o.distToBeat,
    charges: 0,
    pips: 0,
    pulseUntil: -1,
    invertUntil: -1,
    lastPulseT: 0,
    prevBits: 0,
    pressTick: [-1e9, -1e9],
    lastDir: 1,
    grazes: 0,
    perfects: 0,
    pulses: 0,
    style: 0,
    styleSec: 0,
    history: [theta],
    events: [],
    death: null,
  };
}

export const isPulsing = (s, t = s.t) => t < s.pulseUntil;
export const isInverted = (s, t = s.t) => t < s.invertUntil;
export const styleMult = (s) => 1 + Math.floor((s.t - s.lastPulseT) / 10);

function tryPulse(s) {
  if (s.classic || s.charges < 1 || isPulsing(s)) return;
  s.charges--;
  s.pulses++;
  const dur = s.beatSec(s.t) / 2; // one eighth note
  s.pulseUntil = s.t + dur;
  s.lastPulseT = s.t;
  let perfect = false;
  if (s.distToBeat(s.t) <= PERFECT_WINDOW) {
    perfect = true;
    s.perfects++;
    s.style += 50 * styleMult(s);
    s.pips += PIPS_PER_CHARGE / 2;
    normalizeCharges(s);
  }
  s.events.push({ type: 'pulse', perfect });
}

function normalizeCharges(s) {
  while (s.pips >= PIPS_PER_CHARGE && s.charges < MAX_CHARGES) {
    s.pips -= PIPS_PER_CHARGE;
    s.charges++;
  }
  if (s.charges >= MAX_CHARGES) s.pips = 0;
}

export function step(s, bits) {
  if (!s.alive) return;
  const tick = s.tick;
  const prev = s.prevBits;
  const pressedL = bits & BIT_L && !(prev & BIT_L);
  const pressedR = bits & BIT_R && !(prev & BIT_R);
  if (pressedL) (s.pressTick[0] = tick), (s.lastDir = 1);
  if (pressedR) (s.pressTick[1] = tick), (s.lastDir = -1);

  // §6.4 Pulse: a dedicated key, or both rotate inputs within the chord window.
  const chord =
    (pressedL && bits & BIT_R && tick - s.pressTick[1] <= PULSE_CHORD_TICKS) ||
    (pressedR && bits & BIT_L && tick - s.pressTick[0] <= PULSE_CHORD_TICKS);
  if (chord || (bits & BIT_P && !(prev & BIT_P))) tryPulse(s);
  s.prevBits = bits;

  // §4 opposing inputs: the most recent press wins.
  let dir = 0;
  if (bits & BIT_L && bits & BIT_R) dir = s.lastDir;
  else if (bits & BIT_L) dir = 1;
  else if (bits & BIT_R) dir = -1;
  if (isInverted(s)) dir = -dir;

  const tPrev = s.t;
  s.tick++;
  s.t = s.tick * DT;
  const t = s.t;
  const pulsing = isPulsing(s, t);
  const h = HITBOX_HALF_DEG;

  // Collect walls that currently cover the player's radius.
  const near = [];
  for (let i = 0; i < s.walls.length; i++) {
    const w = s.walls[i];
    if (w.tHit > t + 0.001) break; // walls are appended in tHit order per pattern
    if (atRadius(w, t)) near.push(w);
  }

  // Move, with side contact blocking (slide, don't die — §6.2).
  let delta = dir * s.omega * DT;
  if (delta !== 0) {
    for (const w of near) {
      if (!isSolidAt(w, t, pulsing)) continue;
      const a0 = wallStart(w, t);
      if (arcGap(s.theta, h, a0, w.span) < 0) continue; // already overlapping: resolved below
      if (delta > 0) {
        let dist = mod360(a0 - (s.theta + h));
        if (dist > 359.99) dist = 0;
        if (dist < delta) delta = Math.max(0, dist - 1e-3);
      } else {
        let dist = mod360(s.theta - h - (a0 + w.span));
        if (dist > 359.99) dist = 0;
        if (dist < -delta) delta = -Math.max(0, dist - 1e-3);
      }
    }
  }
  s.theta = mod360(s.theta + delta);

  // Head-on contact, grazes, glass passes, inverter gates.
  for (const w of near) {
    const a0 = wallStart(w, t);
    const gap = arcGap(s.theta, h, a0, w.span);
    const solid = isSolidAt(w, t, pulsing);
    if (gap < 0) {
      if (solid) {
        s.alive = false;
        s.death = { t, wall: w, theta: s.theta };
        s.events.push({ type: 'death', wall: w });
        break;
      }
      if (w.glass && !w.shattered) {
        w.shattered = true;
        s.events.push({ type: 'glass' });
      }
    } else if (!s.classic && solid && !w.grazed && gap < GRAZE_DEG) {
      w.grazed = true;
      s.grazes++;
      s.style += 10 * styleMult(s);
      if (s.charges < MAX_CHARGES) {
        s.pips++;
        normalizeCharges(s);
      }
      s.events.push({ type: 'graze', wall: w });
    }
  }
  if (s.alive) {
    for (const w of near) {
      if (w.inverter && w.tHit > tPrev && w.tHit <= t) {
        s.invertUntil = t + w.inverter;
        s.events.push({ type: 'invert' });
      }
    }
    if (Math.floor(t) > Math.floor(tPrev)) s.style += 5 * styleMult(s);
  }
  s.history.push(s.theta);
}

export function thetaAt(s, t) {
  const i = Math.max(0, Math.min(s.history.length - 1, Math.round(t / DT)));
  return s.history[i];
}
