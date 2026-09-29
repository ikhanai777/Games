// Wall geometry shared by the simulation, the validator and the renderer.
//
// A wall is an annular sector described analytically, so its state at any time can be
// computed directly (this is what makes death-cam scrubbing and validation cheap):
//   tHit   run time (s) when the inner edge reaches R_PLAYER
//   len    seconds the wall spends covering R_PLAYER (its radial thickness in time)
//   v      radial speed (arena units / s)
//   a0     start angle (deg, CCW), span: angular width (deg)
//   glass  passable while pulsing (§6.4)
//   pend   { amp, period, lock } pendulum sway that locks 1 beat before impact (§7.1)
//   shut   { t0, period, from, to } shutter: closed while phase ∈ [from, to) (§7.1)
//   inverter  seconds of control inversion granted when the wall passes (§7.1)
//   echo   draw a ghost one bar early (§7.1)

export const mod360 = (a) => ((a % 360) + 360) % 360;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function wallOffset(w, t) {
  const p = w.pend;
  if (!p) return 0;
  const f = clamp01((w.tHit - t - p.lock) / p.lock);
  return p.amp * Math.sin((2 * Math.PI * (t - w.tHit)) / p.period) * f;
}

export function wallStart(w, t) {
  return w.a0 + wallOffset(w, t);
}

export function atRadius(w, t) {
  return t >= w.tHit && t <= w.tHit + w.len;
}

export function shutterPhase(w, t) {
  const s = w.shut;
  const x = (t - s.t0) / s.period;
  return x - Math.floor(x);
}

export function shutterClosed(w, t) {
  const ph = shutterPhase(w, t);
  return ph >= w.shut.from && ph < w.shut.to;
}

export function isSolidAt(w, t, pulsing) {
  if (w.shut && !shutterClosed(w, t)) return false;
  if (w.glass && pulsing) return false;
  return true;
}

// Angular gap between the player's arc [θ-h, θ+h] and the wall arc. Negative = overlap.
export function arcGap(theta, h, a0, span) {
  const d = mod360(theta - a0);
  if (d <= span) return -h - Math.min(d, span - d);
  return Math.min(d - span, 360 - d) - h;
}

export function innerRadius(w, t, rPlayer) {
  return rPlayer + w.v * (w.tHit - t);
}
