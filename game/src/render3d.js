// WebGL renderer: the same arena as render.js, extruded into 3D. Purely cosmetic — the
// simulation stays in 2D polar space, so collisions and fairness are identical in every view.
//
// Two cameras:
//   top-down     straight above the center; walls rise toward you and their inner faces show
//   perspective  tilted camera looking across the arena
// Either way, a post-projection fit guarantees the r = 1 disc (where walls must already be
// visible, §11.1) fills the viewport exactly like the flat view.

import { R_PLAYER, R_CENTER, R_MAX_DRAW, R_VISIBLE, VISUAL_HALF_DEG } from './config.js';
import { wallStart, shutterClosed, shutterPhase } from './walls.js';
import { polyShape, radiusFactor } from './render.js';

const RAD = Math.PI / 180;
const FLOATS = 11; // pos3 · rgba4 · rgb2 · style1

const VS = `
attribute vec3 aPos; attribute vec4 aCol; attribute vec3 aCol2; attribute float aStyle;
uniform mat4 uMVP; uniform vec3 uEye;
varying vec4 vCol; varying vec3 vCol2; varying float vStyle; varying float vDist;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vCol = aCol; vCol2 = aCol2; vStyle = aStyle; vDist = distance(aPos, uEye);
}`;

const FS = `
precision mediump float;
varying vec4 vCol; varying vec3 vCol2; varying float vStyle; varying float vDist;
uniform vec3 uFog; uniform vec2 uFogRange; uniform float uDpr;
void main() {
  vec4 c = vCol;
  float d = gl_FragCoord.x + gl_FragCoord.y;
  if (vStyle > 0.5 && vStyle < 1.5) {            // glass hatch
    if (mod(d, 9.0 * uDpr) < 1.5 * uDpr) c = vec4(vCol2, max(c.a, 0.85));
  } else if (vStyle > 1.5 && vStyle < 2.5) {     // inverter hazard stripes
    if (mod(d, 14.0 * uDpr) < 5.0 * uDpr) c.rgb = vCol2;
  }
  if (vStyle < 2.5) c.rgb = mix(c.rgb, uFog, smoothstep(uFogRange.x, uFogRange.y, vDist));
  gl_FragColor = c;
}`;

// ---- tiny mat4 helpers (column-major) ----------------------------------------------------

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

function perspectiveMatrix(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

function lookAt(eye, target, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

function transform(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

// ---- geometry batch ----------------------------------------------------------------------

class Batch {
  constructor() {
    this.data = new Float32Array(FLOATS * 30000);
    this.n = 0;
  }
  reset() {
    this.n = 0;
  }
  vert(p, c, a, c2, style) {
    if ((this.n + 1) * FLOATS > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    const d = this.data;
    let i = this.n * FLOATS;
    d[i++] = p[0]; d[i++] = p[1]; d[i++] = p[2];
    d[i++] = c[0]; d[i++] = c[1]; d[i++] = c[2]; d[i++] = a;
    d[i++] = c2[0]; d[i++] = c2[1]; d[i++] = c2[2];
    d[i] = style;
    this.n++;
  }
  tri(p0, p1, p2, c, a = 1, c2 = c, style = 0) {
    this.vert(p0, c, a, c2, style);
    this.vert(p1, c, a, c2, style);
    this.vert(p2, c, a, c2, style);
  }
  quad(p0, p1, p2, p3, c, a, c2, style) {
    this.tri(p0, p1, p2, c, a, c2, style);
    this.tri(p0, p2, p3, c, a, c2, style);
  }
}

const unit = (rgb) => [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
const scale = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
const LIGHT = (() => {
  const l = [0.45, 0.6, 0.66];
  const n = Math.hypot(...l);
  return l.map((x) => x / n);
})();

// Flat shading for side faces; top faces keep the exact palette color (contrast rule, §12.1).
function shadeOf(p0, p1, p2) {
  const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const d = Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / l);
  return 0.42 + 0.45 * d;
}

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { antialias: true, alpha: false, depth: true, premultipliedAlpha: false, preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    this.ok = !!gl;
    if (!gl) return;
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      this.prog = prog;
    } catch (e) {
      console.warn('3D renderer unavailable:', e);
      this.ok = false;
      return;
    }
    const p = this.prog;
    this.loc = {
      aPos: gl.getAttribLocation(p, 'aPos'),
      aCol: gl.getAttribLocation(p, 'aCol'),
      aCol2: gl.getAttribLocation(p, 'aCol2'),
      aStyle: gl.getAttribLocation(p, 'aStyle'),
      uMVP: gl.getUniformLocation(p, 'uMVP'),
      uEye: gl.getUniformLocation(p, 'uEye'),
      uFog: gl.getUniformLocation(p, 'uFog'),
      uFogRange: gl.getUniformLocation(p, 'uFogRange'),
      uDpr: gl.getUniformLocation(p, 'uDpr'),
    };
    this.buf = gl.createBuffer();
    this.opaque = new Batch();
    this.trans = new Batch();
    this.overlay = new Batch();
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

  // Arena point: polar (θ, r) on the polygon, rotated by the cosmetic camera angle.
  pt(theta, r, z, shape) {
    const R = r * radiusFactor(theta, shape);
    const a = (theta + this.cam) * RAD;
    return [Math.cos(a) * R, Math.sin(a) * R, z];
  }

  camera(v, perspective) {
    const aspect = this.w / this.h;
    const tilt = v.tiltAmt || 0;
    let elev;
    let dist;
    let fov;
    if (perspective) {
      elev = (56 - 10 * tilt) * RAD;
      dist = 4.2;
      fov = 36 * RAD;
    } else {
      elev = (90 - 28 * tilt) * RAD;
      dist = 1.55;
      fov = 64 * RAD;
    }
    const eye = [0, -Math.cos(elev) * dist, Math.sin(elev) * dist];
    const up = elev > 89.9 * RAD ? [0, 1, 0] : [0, 0, 1];
    const view = lookAt(eye, [0, 0, 0], up);
    const proj = perspectiveMatrix(fov, aspect, 0.05, 40);
    let vp = mul(proj, view);
    // Fit the r = R_VISIBLE disc to the viewport (same guarantee as the flat renderer).
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const c = transform(vp, Math.cos(a) * R_VISIBLE, Math.sin(a) * R_VISIBLE, 0);
      const x = c[0] / c[3];
      const y = c[1] / c[3];
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    }
    const s = Math.min(2 / (xmax - xmin), 2 / (ymax - ymin)) * v.zoom;
    const cx = (xmin + xmax) / 2;
    const cy = (ymin + ymax) / 2;
    const post = new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1, 0, -s * cx, -s * cy, 0, 1]);
    vp = mul(post, vp);
    return { vp, eye, dist };
  }

  // v: the same view object the flat renderer takes (see main.js buildView()).
  draw(v, perspective) {
    if (!this.ok) return;
    const gl = this.gl;
    this.resize();
    this.cam = v.cam;
    const pal = v.palette;
    const bgA = unit(pal.bgA);
    const bgB = unit(pal.bgB);
    const wallC = unit(pal.wall);
    const playerC = unit(pal.player);
    const boost = v.bgBoost || 0;
    const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const O = this.opaque;
    const T = this.trans;
    O.reset();
    T.reset();
    this.overlay.reset();

    const arena = polyShape(v.sides);
    const wallH = (perspective ? 0.1 : 0.13) * (1 + 0.12 * v.pulse);

    // Floor stripes.
    const far = R_MAX_DRAW * 3;
    const odd = arena.n % 2 === 1;
    for (let k = 0; k < arena.n; k++) {
      let c = k % 2 ? bgB : bgA;
      if (odd && k === arena.n - 1) c = mixc(bgA, bgB, 0.5);
      if (boost) c = mixc(c, wallC, boost);
      const a0 = arena.starts[k];
      O.tri([0, 0, 0], this.pt(a0, far, 0, arena), this.pt(a0 + arena.widths[k], far, 0, arena), c, 1, c, 0);
    }

    // Walls.
    const t = v.t;
    for (const wl of v.walls) {
      const rIn = R_PLAYER + wl.v * (wl.tHit - t);
      const rOut = rIn + wl.v * wl.len;
      if (rOut < R_CENTER || rIn > R_MAX_DRAW) continue;
      if (wl.glass && wl.shattered && rIn < R_PLAYER) continue;
      const shape = polyShape(wl.sides);
      const a0 = wallStart(wl, t);
      if (wl.echo && v.echoLead) {
        const gIn = rIn - wl.v * v.echoLead;
        if (gIn > R_PLAYER) this.prism(T, wl.a0, wl.span, gIn, gIn + wl.v * wl.len, wallH * 0.5, shape, wallC, 0.28, false);
      }
      const r0 = Math.max(R_CENTER, rIn);
      const dead = wl === v.deathWall;
      const col = dead ? (v.flash ? [1, 0.16, 0.16] : [0.9, 0.25, 0.25]) : wallC;
      if (wl.shut && !shutterClosed(wl, t)) {
        const ph = shutterPhase(wl, t);
        const toClose = ph < wl.shut.from ? wl.shut.from - ph : 1 - ph + wl.shut.from;
        const warn = Math.max(0, 1 - toClose / 0.35);
        this.prism(T, a0, wl.span, r0, rOut, wallH * (0.25 + 0.5 * warn), shape, col, 0.18 + warn * 0.45, false);
      } else if (wl.glass) {
        this.prism(T, a0, wl.span, r0, rOut, wallH, shape, col, 0.3, false, 1, wallC);
      } else if (wl.inverter) {
        this.prism(O, a0, wl.span, r0, rOut, wallH, shape, col, 1, true, 2, playerC);
      } else {
        this.prism(O, a0, wl.span, r0, rOut, wallH, shape, col, 1, true);
        if (v.outlines && !dead) {
          // Outline mode: a contrasting rim around each wall's top face.
          const inset = Math.min(1.2, wl.span / 6);
          const dr = Math.min(0.008, (rOut - r0) / 4);
          this.prism(O, a0 - inset, wl.span + 2 * inset, r0 - dr, rOut + dr, wallH - 0.002, shape, playerC, 1, true);
        }
      }
    }

    // Space-time overlays on the floor: past trail and escape path.
    const vRef = v.pathSpeed || 1;
    if (v.trail && v.trail.length > 1) {
      const pts = v.trail
        .map((p) => ({ theta: p.theta, r: R_PLAYER + vRef * (p.t - t) }))
        .filter((p) => p.r >= R_CENTER)
        .map((p) => this.pt(p.theta, p.r, 0.004, arena));
      this.ribbon(T, pts, 0.006, playerC, 0.6, false);
    }
    if (v.escape) {
      const pts = v.escape
        .map((p) => ({ theta: p.theta, r: R_PLAYER + vRef * (p.t - t) }))
        .filter((p) => p.r >= R_CENTER && p.r <= R_MAX_DRAW)
        .map((p) => this.pt(p.theta, p.r, 0.006, arena));
      this.ribbon(T, pts, 0.007, [1, 1, 1], 0.95, true);
    }

    // Center prism with a rim, pulsing on the beat.
    const center = polyShape(v.centerSides ?? v.sides);
    const rc = R_CENTER * (1 + 0.08 * v.pulse);
    const hc = wallH * 0.8;
    const capC = mixc(bgA, [0, 0, 0], 0.35);
    for (let k = 0; k < center.n; k++) {
      const s0 = center.starts[k];
      const s1 = s0 + center.widths[k];
      const b0 = this.pt(s0, rc, 0, center);
      const b1 = this.pt(s1, rc, 0, center);
      const t0 = this.pt(s0, rc, hc, center);
      const t1 = this.pt(s1, rc, hc, center);
      O.quad(b0, b1, t1, t0, scale(wallC, shadeOf(b0, b1, t1)), 1, wallC, 0);
      O.tri([0, 0, hc], t0, t1, capC, 1, capC, 0);
      const i0 = this.pt(s0, rc * 0.84, hc + 0.001, center);
      const i1 = this.pt(s1, rc * 0.84, hc + 0.001, center);
      O.quad(this.pt(s0, rc, hc + 0.001, center), this.pt(s1, rc, hc + 0.001, center), i1, i0, wallC, 1, wallC, 0);
    }

    // Player: a small pyramid hovering just above the floor.
    if (v.showPlayer) {
      const th = v.theta;
      const pc = v.inverted ? [1, 0.23, 0.42] : playerC;
      const z0 = 0.012;
      const tip = this.pt(th, R_PLAYER + 0.034, z0, arena);
      const b1 = this.pt(th - VISUAL_HALF_DEG, R_PLAYER, z0, arena);
      const b2 = this.pt(th + VISUAL_HALF_DEG, R_PLAYER, z0, arena);
      const apex = [(tip[0] + b1[0] + b2[0]) / 3, (tip[1] + b1[1] + b2[1]) / 3, z0 + (v.pulsing ? 0.06 : 0.04)];
      O.tri(b1, b2, tip, pc, 1, pc, 0);
      for (const [a, b] of [[b1, b2], [b2, tip], [tip, b1]]) {
        O.tri(a, b, apex, scale(pc, 0.55 + 0.5 * shadeOf(a, b, apex)), 1, pc, 0);
      }
      if (v.pulsing) {
        const ring = [];
        const c = this.pt(th, R_PLAYER + 0.012, 0.01, arena);
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          ring.push([c[0] + Math.cos(a) * 0.05, c[1] + Math.sin(a) * 0.05, 0.01]);
        }
        this.ribbon(T, ring, 0.004, pc, 0.7, false);
      }
    }

    if (v.vignette) {
      const q = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]];
      this.overlay.quad(q[0], q[1], q[2], q[3], [0, 0, 0], v.vignette, [0, 0, 0], 3);
    }

    // ---- draw ----
    const cam = this.camera(v, perspective);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(bgA[0], bgA[1], bgA[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform3fv(this.loc.uEye, cam.eye);
    gl.uniform3fv(this.loc.uFog, bgA);
    gl.uniform2f(this.loc.uFogRange, perspective ? cam.dist + 0.8 : 1e4, perspective ? cam.dist + 5 : 2e4);
    gl.uniform1f(this.loc.uDpr, this.dpr);
    gl.uniformMatrix4fv(this.loc.uMVP, false, cam.vp);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.flush(O);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.flush(T);
    if (this.overlay.n) {
      gl.disable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(this.loc.uMVP, false, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
      this.flush(this.overlay);
    }
    gl.depthMask(true);
  }

  flush(batch) {
    if (!batch.n) return;
    const gl = this.gl;
    const L = this.loc;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.n * FLOATS), gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    const attr = (loc, size, off) => {
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
    };
    attr(L.aPos, 3, 0);
    attr(L.aCol, 4, 3);
    attr(L.aCol2, 3, 7);
    attr(L.aStyle, 1, 10);
    gl.drawArrays(gl.TRIANGLES, 0, batch.n);
  }

  // Extruded annular sector following the polygon's straight edges.
  prism(B, a0, span, rIn, rOut, h, shape, col, alpha, shaded, style = 0, col2 = col) {
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
    const side = (p0, p1, p2, p3) => {
      const c = shaded ? scale(col, shadeOf(p0, p1, p2)) : col;
      B.quad(p0, p1, p2, p3, c, alpha, shaded ? scale(col2, shadeOf(p0, p1, p2)) : col2, style);
    };
    for (let i = 0; i < angles.length - 1; i++) {
      const s = angles[i];
      const e = angles[i + 1];
      const ib0 = this.pt(s, rIn, 0, shape);
      const ib1 = this.pt(e, rIn, 0, shape);
      const it0 = this.pt(s, rIn, h, shape);
      const it1 = this.pt(e, rIn, h, shape);
      const ot0 = this.pt(s, rOut, h, shape);
      const ot1 = this.pt(e, rOut, h, shape);
      B.quad(it0, it1, ot1, ot0, col, alpha, col2, style); // top keeps the exact palette color
      side(ib0, ib1, it1, it0); // inner face
      if (alpha >= 1) side(this.pt(s, rOut, 0, shape), this.pt(e, rOut, 0, shape), ot1, ot0);
    }
    const cap = (a) => side(this.pt(a, rIn, 0, shape), this.pt(a, rOut, 0, shape), this.pt(a, rOut, h, shape), this.pt(a, rIn, h, shape));
    cap(a0);
    cap(a1);
  }

  ribbon(B, pts, width, col, alpha, dashed) {
    for (let i = 0; i < pts.length - 1; i++) {
      if (dashed && i % 3 === 2) continue;
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      const nx = (-dy / l) * width;
      const ny = (dx / l) * width;
      B.quad([a[0] + nx, a[1] + ny, a[2]], [b[0] + nx, b[1] + ny, b[2]], [b[0] - nx, b[1] - ny, b[2]], [a[0] - nx, a[1] - ny, a[2]], col, alpha, col, 3);
    }
  }
}

