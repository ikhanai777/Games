// Canvas renderer (§12). Purely cosmetic: nothing here feeds back into the simulation.
// Arena coordinates are polar (θ degrees CCW, r in arena units). The polygon shape only
// changes how r maps to the screen, so walls and player always line up with the sides.

import { R_PLAYER, R_CENTER, R_MAX_DRAW, VISUAL_HALF_DEG } from './config.js';
import { wallStart, shutterClosed, shutterPhase } from './walls.js';
import { css, mix } from './palette.js';

const RAD = Math.PI / 180;
const shapeCache = new Map();

// Polygon with a possibly fractional side count (for morphs): floor(s) equal sides plus
// one partial side that grows or shrinks.
export function polyShape(s) {
  const key = Math.round(s * 1000) / 1000;
  if (shapeCache.has(key)) return shapeCache.get(key);
  let n = Math.floor(key);
  let frac = key - n;
  if (frac < 1e-3) frac = 0;
  const w = 360 / key;
  const starts = [];
  const widths = [];
  for (let i = 0; i < n; i++) starts.push(i * w), widths.push(w);
  if (frac) starts.push(n * w), widths.push(360 - n * w), n++;
  const shape = { s: key, n, starts, widths, norm: 1 / Math.sqrt(Math.cos(Math.PI / Math.max(3, key))) };
  if (shapeCache.size > 512) shapeCache.clear();
  shapeCache.set(key, shape);
  return shape;
}

export function radiusFactor(theta, shape) {
  const a = ((theta % 360) + 360) % 360;
  let k = shape.n - 1;
  for (let i = 1; i < shape.n; i++) {
    if (a < shape.starts[i]) {
      k = i - 1;
      break;
    }
  }
  const half = shape.widths[k] / 2;
  const mid = shape.starts[k] + half;
  return (Math.cos(half * RAD) / Math.cos((a - mid) * RAD)) * shape.norm;
}

function hatchPattern(ctx, color, bg, spacing, width) {
  const c = document.createElement('canvas');
  c.width = c.height = spacing;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, spacing, spacing);
  }
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(-1, spacing + 1);
  g.lineTo(spacing + 1, -1);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(spacing - 1, spacing + 1);
  g.lineTo(spacing + 1, spacing - 1);
  g.stroke();
  return ctx.createPattern(c, 'repeat');
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.patternKey = '';
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.w = w;
    this.h = h;
  }

  // v: see main.js buildView()
  draw(v) {
    const ctx = this.ctx;
    this.resize();
    const { w, h } = this;
    this.cx = w / 2;
    this.cy = h / 2 + (v.shiftY || 0) * h;
    this.unit = (Math.min(w, h) / 2) * v.zoom;
    this.cam = v.cam;
    this.tiltY = v.tiltY;
    const pal = v.palette;
    const arena = polyShape(v.sides);

    // Background stripes.
    ctx.fillStyle = css(pal.bgA);
    ctx.fillRect(0, 0, w, h);
    const far = R_MAX_DRAW * 1.6;
    const odd = arena.n % 2 === 1;
    for (let k = 0; k < arena.n; k++) {
      let c = k % 2 ? pal.bgB : pal.bgA;
      if (odd && k === arena.n - 1) c = mix(pal.bgA, pal.bgB, 0.5);
      if (v.bgBoost) c = mix(c, pal.wall, v.bgBoost);
      ctx.fillStyle = css(c);
      ctx.beginPath();
      ctx.moveTo(this.cx, this.cy);
      const a0 = arena.starts[k];
      this.lineToPolar(a0, far, arena);
      this.lineToPolar(a0 + arena.widths[k], far, arena);
      ctx.closePath();
      ctx.fill();
    }

    // Walls.
    if (this.patternKey !== pal.wall.join() + pal.player.join()) {
      this.patternKey = pal.wall.join() + pal.player.join();
      const d = this.dpr;
      this.glassPat = hatchPattern(ctx, css(pal.wall, 0.8), null, Math.round(9 * d), 1.5 * d);
      this.hazardPat = hatchPattern(ctx, css(pal.player), css(pal.wall), Math.round(14 * d), 5 * d);
    }
    const t = v.t;
    for (const wl of v.walls) {
      const rIn = R_PLAYER + wl.v * (wl.tHit - t);
      const rOut = rIn + wl.v * wl.len;
      if (rOut < R_CENTER || rIn > R_MAX_DRAW) continue;
      if (wl.glass && wl.shattered && rIn < R_PLAYER) continue;
      const shape = polyShape(wl.sides);
      const a0 = wallStart(wl, t);
      if (wl.echo && v.echoLead) {
        // §7.1 Echo: a faint ghost showing where the wall will be one bar from now.
        const gIn = rIn - wl.v * v.echoLead;
        if (gIn > R_PLAYER) {
          this.arcPath(wl.a0, wl.span, gIn, gIn + wl.v * wl.len, shape);
          ctx.strokeStyle = css(pal.wall, 0.35);
          ctx.lineWidth = 1.5 * this.dpr;
          ctx.stroke();
        }
      }
      this.arcPath(a0, wl.span, Math.max(R_CENTER, rIn), rOut, shape);
      if (wl.shut) {
        const closed = shutterClosed(wl, t);
        if (closed) {
          ctx.fillStyle = css(pal.wall);
          ctx.fill();
        } else {
          // Telegraph: fill in as the next close approaches.
          const ph = shutterPhase(wl, t);
          const toClose = ph < wl.shut.from ? (wl.shut.from - ph) : 1 - ph + wl.shut.from;
          const warn = Math.max(0, 1 - toClose / 0.35);
          ctx.fillStyle = css(pal.wall, 0.12 + warn * 0.45);
          ctx.fill();
          ctx.setLineDash([4 * this.dpr, 4 * this.dpr]);
          ctx.strokeStyle = css(pal.wall, 0.9);
          ctx.lineWidth = 2 * this.dpr;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (wl.glass) {
        ctx.fillStyle = css(pal.wall, 0.22);
        ctx.fill();
        ctx.fillStyle = this.glassPat;
        ctx.fill();
        ctx.strokeStyle = css(pal.wall);
        ctx.lineWidth = 1.5 * this.dpr;
        ctx.stroke();
      } else if (wl.inverter) {
        ctx.fillStyle = this.hazardPat;
        ctx.fill();
      } else {
        ctx.fillStyle = css(pal.wall);
        ctx.fill();
      }
      if (v.outlines) {
        ctx.strokeStyle = css(pal.player);
        ctx.lineWidth = 3 * this.dpr;
        ctx.stroke();
      }
      if (wl === v.deathWall) {
        ctx.strokeStyle = v.flash ? '#ff2a2a' : '#ff5a5a';
        ctx.lineWidth = (v.flash ? 5 : 3.5) * this.dpr;
        ctx.stroke();
      }
    }

    // Space-time overlays: past trail (inside the player radius) and the escape path.
    const vRef = v.pathSpeed || 1;
    if (v.trail && v.trail.length > 1) {
      ctx.beginPath();
      v.trail.forEach((p, i) => {
        const r = R_PLAYER + vRef * (p.t - t);
        if (r < R_CENTER) return;
        const [x, y] = this.toScreen(p.theta, r, arena);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = css(pal.player, 0.55);
      ctx.lineWidth = 2 * this.dpr;
      ctx.stroke();
    }
    if (v.escape) {
      ctx.beginPath();
      let started = false;
      for (const p of v.escape) {
        const r = R_PLAYER + vRef * (p.t - t);
        if (r < R_CENTER || r > R_MAX_DRAW) continue;
        const [x, y] = this.toScreen(p.theta, r, arena);
        if (!started) ctx.moveTo(x, y), (started = true);
        else ctx.lineTo(x, y);
      }
      ctx.setLineDash([3 * this.dpr, 5 * this.dpr]);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2.5 * this.dpr;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Center polygon, pulsing on the beat (§5.1).
    const center = polyShape(v.centerSides ?? v.sides);
    const rc = R_CENTER * (1 + 0.08 * v.pulse);
    ctx.beginPath();
    for (let k = 0; k <= center.n; k++) {
      const a = center.starts[k % center.n];
      const [x, y] = this.toScreen(a, rc, center);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = css(mix(pal.bgA, [0, 0, 0], 0.35));
    ctx.fill();
    ctx.strokeStyle = css(pal.wall);
    ctx.lineWidth = Math.max(2, this.unit * 0.014);
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Player.
    if (v.showPlayer) {
      const th = v.theta;
      const tip = this.toScreen(th, R_PLAYER + 0.034, arena);
      const b1 = this.toScreen(th - VISUAL_HALF_DEG, R_PLAYER, arena);
      const b2 = this.toScreen(th + VISUAL_HALF_DEG, R_PLAYER, arena);
      ctx.beginPath();
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(b1[0], b1[1]);
      ctx.lineTo(b2[0], b2[1]);
      ctx.closePath();
      if (v.pulsing) {
        ctx.shadowColor = css(pal.player);
        ctx.shadowBlur = 18 * this.dpr;
      }
      ctx.fillStyle = v.inverted ? '#ff3b6b' : css(pal.player);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (v.pulsing) {
        ctx.beginPath();
        const [px, py] = this.toScreen(th, R_PLAYER + 0.012, arena);
        ctx.arc(px, py, this.unit * 0.05, 0, Math.PI * 2);
        ctx.strokeStyle = css(pal.player, 0.7);
        ctx.lineWidth = 2 * this.dpr;
        ctx.stroke();
      }
    }

    if (v.vignette) {
      ctx.fillStyle = `rgba(0,0,0,${v.vignette})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  toScreen(theta, r, shape) {
    const rr = r * radiusFactor(theta, shape) * this.unit;
    const a = (theta + this.cam) * RAD;
    return [this.cx + Math.cos(a) * rr, this.cy - Math.sin(a) * rr * this.tiltY];
  }

  lineToPolar(theta, r, shape) {
    const [x, y] = this.toScreen(theta, r, shape);
    this.ctx.lineTo(x, y);
  }

  // Build a path for an annular sector following the polygon's straight edges.
  arcPath(a0, span, rIn, rOut, shape) {
    const ctx = this.ctx;
    const angles = [a0];
    const a1 = a0 + span;
    for (let m = -1; m <= 2; m++) {
      for (const s of shape.starts) {
        const a = s + m * 360;
        if (a > a0 + 1e-6 && a < a1 - 1e-6) angles.push(a);
      }
    }
    angles.push(a1);
    angles.sort((x, y) => x - y);
    ctx.beginPath();
    for (let i = 0; i < angles.length; i++) {
      const [x, y] = this.toScreen(angles[i], rOut, shape);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = angles.length - 1; i >= 0; i--) {
      const [x, y] = this.toScreen(angles[i], rIn, shape);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}
