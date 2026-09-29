// Palettes (§12.1) with the readability rule: walls keep ≥ 4.5:1 contrast against both
// background stripes, including mid-crossfade. Colorblind and mono sets for §13.

export const MIN_CONTRAST = 4.5;

export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function lin(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance([r, g, b]) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

export function lerpPalette(p, q, k) {
  return { bgA: mix(p.bgA, q.bgA, k), bgB: mix(p.bgB, q.bgB, k), wall: mix(p.wall, q.wall, k), player: mix(p.player, q.player, k) };
}

// Raise wall lightness until it clears the contrast bar against both stripes.
function vividPalette(h) {
  const bgA = hsl(h, 0.55, 0.06);
  const bgB = hsl(h, 0.5, 0.12);
  let l = 0.58;
  let wall = hsl(h, 1, l);
  while ((contrast(wall, bgA) < MIN_CONTRAST + 0.6 || contrast(wall, bgB) < MIN_CONTRAST + 0.6) && l < 0.95) {
    l += 0.02;
    wall = hsl(h, 1, l);
  }
  return { bgA, bgB, wall, player: hsl(h, 1, 0.9) };
}

const CB = [
  { bgA: [8, 14, 34], bgB: [18, 30, 62], wall: [255, 176, 46], player: [255, 255, 255] },
  { bgA: [22, 12, 4], bgB: [44, 26, 10], wall: [110, 200, 255], player: [255, 255, 255] },
];

const MONO = [{ bgA: [8, 8, 8], bgB: [26, 26, 26], wall: [240, 240, 240], player: [255, 255, 255] }];

export function paletteFor(movement, index, mode) {
  if (mode === 'mono') return MONO[0];
  if (mode === 'cb') return CB[index % CB.length];
  const hues = movement.hues;
  return vividPalette(hues[index % hues.length]);
}

export const _sets = { CB, MONO };

export const css = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
