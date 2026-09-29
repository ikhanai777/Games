// Solvability validator (§11.2): reachability over (angle, time) at 1° × 1/120 s.
// A frontier is a Uint8Array(360) of angles the player could occupy. Walls block the bins
// they cover (dilated by the player's half-width), and the player can't move through them
// (side contact blocks). Glass is always treated as solid, so no sequence requires Pulse.

import { atRadius, isSolidAt, wallStart, mod360 } from './walls.js';

export const BINS = 360;
export const VHZ = 120;

function blockedAt(walls, t, hv, out) {
  out.fill(0);
  let any = false;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (!atRadius(w, t) || !isSolidAt(w, t, false)) continue;
    any = true;
    const s = wallStart(w, t) - hv;
    const e = s + w.span + 2 * hv;
    for (let a = Math.ceil(s); a <= Math.floor(e); a++) out[mod360(a)] = 1;
  }
  return any;
}

export function countBins(front) {
  let n = 0;
  for (let i = 0; i < BINS; i++) n += front[i];
  return n;
}

function relevant(walls, t0, t1) {
  return walls.filter((w) => w.tHit <= t1 && w.tHit + w.len >= t0);
}

// Advance a frontier from t0 to t1. If `trace` is an array, per-step frontiers and blocked
// masks are pushed to it (used to reconstruct a path).
// Steps are taken on an absolute 1/VHZ grid, so advancing A→B then B→C gives exactly
// the same result as A→C (the generator validates piece by piece).
export function advance(front, walls, t0, t1, omega, hv, trace = null) {
  const ws = relevant(walls, t0, t1);
  const i0 = Math.ceil(t0 * VHZ - 1e-9);
  const i1 = Math.max(i0, Math.ceil(t1 * VHZ - 1e-9));
  const move = omega / VHZ;
  let cur = front.slice();
  let tmp = new Uint8Array(BINS);
  const blk = new Uint8Array(BINS);
  let full = countBins(cur) === BINS;
  if (trace) trace.push({ t: i0 / VHZ, front: cur.slice(), k: 0 });
  for (let i = i0 + 1; i <= i1; i++) {
    const t = i / VHZ;
    const k = Math.floor(i * move + 1e-9) - Math.floor((i - 1) * move + 1e-9);
    const any = ws.length ? blockedAt(ws, t, hv, blk) : false;
    if (!any && full) {
      if (trace) trace.push({ t, front: cur.slice(), k, blk: null });
      continue;
    }
    if (any) for (let b = 0; b < BINS; b++) if (blk[b]) cur[b] = 0;
    for (let r = 0; r < k; r++) {
      tmp.set(cur);
      for (let b = 0; b < BINS; b++) {
        if (cur[b] || (any && blk[b])) continue;
        if (cur[(b + 359) % BINS] || cur[(b + 1) % BINS]) tmp[b] = 1;
      }
      [cur, tmp] = [tmp, cur];
    }
    const n = countBins(cur);
    full = n === BINS;
    if (trace) trace.push({ t, front: cur.slice(), k, blk: any ? blk.slice() : null });
    if (n === 0) return cur;
  }
  return cur;
}

export function singleBin(theta) {
  const f = new Uint8Array(BINS);
  f[mod360(Math.round(theta))] = 1;
  return f;
}

// Circular runs of set bins -> [{start, len}]
export function components(front) {
  const n = countBins(front);
  if (n === 0) return [];
  if (n === BINS) return [{ start: 0, len: BINS }];
  let s = 0;
  while (front[s]) s = (s + 1) % BINS; // find a gap, then walk from there
  const out = [];
  for (let i = 1; i <= BINS; i++) {
    const b = (s + i) % BINS;
    if (front[b] && !front[(b + 359) % BINS]) out.push({ start: b, len: 0 });
    if (front[b]) out[out.length - 1].len++;
  }
  return out;
}

// Find one surviving path from theta0 at t0 to t1. Returns [{t, theta}] or null.
export function solvePath(walls, t0, theta0, t1, omega, hv) {
  const trace = [];
  const end = advance(singleBin(theta0), walls, t0, t1, omega, hv, trace);
  if (countBins(end) === 0) return null;
  // Pick the end bin closest to the start angle for a calm-looking path.
  let best = -1;
  let bestD = 1e9;
  for (let b = 0; b < BINS; b++) {
    if (!end[b]) continue;
    const d = Math.abs(((b - theta0 + 540) % 360) - 180);
    if (d < bestD) (bestD = d), (best = b);
  }
  const path = new Array(trace.length);
  let cur = best;
  path[trace.length - 1] = { t: trace[trace.length - 1].t, theta: cur };
  for (let i = trace.length - 1; i > 0; i--) {
    const { k, blk } = trace[i];
    const prev = trace[i - 1].front;
    let pick = -1;
    // Walk outward in each direction through unblocked bins only (side contact blocks).
    let openUp = true;
    let openDown = true;
    for (let d = 0; d <= k && pick < 0; d++) {
      const up = (cur + d) % BINS;
      const down = (cur - d + BINS) % BINS;
      if (blk && blk[up]) openUp = false;
      if (blk && blk[down]) openDown = false;
      if (openUp && prev[up]) pick = up;
      else if (openDown && prev[down]) pick = down;
    }
    if (pick < 0) return null;
    cur = pick;
    path[i - 1] = { t: trace[i - 1].t, theta: cur };
  }
  return path;
}
