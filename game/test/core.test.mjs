import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline, _swing } from '../src/timeline.js';
import { parsePGN, PATTERNS } from '../src/patterns.js';
import { createSim, step, BIT_L, BIT_R, BIT_P } from '../src/sim.js';
import { DT, HITBOX_HALF_DEG, R_PLAYER } from '../src/config.js';
import { advance, singleBin, countBins, components } from '../src/validator.js';

const wall = (o) => ({ id: 1, tHit: 0.1, len: 0.2, v: 1, a0: 100, span: 60, sides: 6, kind: 'solid', pend: null, shut: null, glass: false, inverter: 0, ...o });
const simWith = (walls, o = {}) =>
  createSim({ walls, omega: 480, beatSec: () => 0.5, distToBeat: () => 0.2, theta: 90, ...o });
const run = (s, bits, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) step(s, typeof bits === 'function' ? bits(i) : bits);
};

test('swing mapping round-trips', () => {
  for (const s of [0.5, 0.6, 0.66]) {
    for (let x = 0; x < 4; x += 0.07) {
      assert.ok(Math.abs(_swing.swingInverse(_swing.swingForward(x, s), s) - x) < 1e-9);
    }
  }
});

test('timeline keeps beats continuous across tempo changes', () => {
  const tl = new Timeline();
  tl.addSegment(0, 120, 0.5, 0);
  assert.equal(tl.beatAt(1), 2);
  tl.addSegment(1.2, 180, 0.5, 1);
  assert.equal(tl.segAtTime(1.3).bpm, 180);
  const b = tl.beatAt(1.2);
  assert.equal(b, 3); // ceil(2.4)
  assert.ok(Math.abs(tl.timeAt(tl.beatAt(2.5)) - 2.5) < 1e-9);
  assert.equal(tl.nextBar(5), 7); // bars counted from the segment start (beat 3)
});

test('PGN parses and rejects bad input', () => {
  const [p] = parsePGN(`pattern "t"\n diff 2\n sides 4\n 0 .###\n 1 #.## 0.5\nend`);
  assert.equal(p.name, 't');
  const ev = p.build({ th: 0.25, sp: 1 });
  assert.equal(ev.length, 6);
  assert.equal(ev.find((e) => e.beat === 1).len, 0.5);
  assert.throws(() => parsePGN(`pattern "x"\n sides 4\n 0 ####\nend`), /no gap/);
  assert.throws(() => parsePGN(`pattern "x"\n sides 4\n 0 .##\nend`), /mask width/);
  assert.throws(() => parsePGN(`pattern "x"\n 0 .#\n`), /missing end/);
  assert.ok(PATTERNS.length >= 25);
});

test('side contact blocks movement instead of killing', () => {
  const s = simWith([wall({ tHit: 0, len: 1 })]);
  run(s, BIT_L, 0.5); // rotate CCW into the wall starting at 100°
  assert.ok(s.alive);
  assert.ok(s.theta < 100 - HITBOX_HALF_DEG + 0.01 && s.theta > 95, `theta=${s.theta}`);
});

test('head-on contact kills', () => {
  const s = simWith([wall({ a0: 60, span: 60, tHit: 0.2 })]);
  run(s, 0, 0.5);
  assert.equal(s.alive, false);
  assert.equal(s.death.wall.a0, 60);
});

test('glass walls are passable only while pulsing', () => {
  const glass = () => wall({ a0: 60, span: 60, tHit: 0.1, len: 0.1, glass: true, kind: 'glass' });
  const dead = simWith([glass()]);
  run(dead, 0, 0.5);
  assert.equal(dead.alive, false);

  const s = simWith([glass()]);
  s.charges = 1;
  run(s, (i) => (i < 20 ? BIT_P : 0), 0.5);
  assert.ok(s.alive);
  assert.equal(s.charges, 0);
});

test('pressing both rotate buttons within 40 ms triggers Pulse', () => {
  const s = simWith([]);
  s.charges = 2;
  run(s, (i) => (i < 3 ? BIT_L : BIT_L | BIT_R), 0.1);
  assert.equal(s.pulses, 1);
  const slow = simWith([]);
  slow.charges = 2;
  run(slow, (i) => (i < 40 ? BIT_L : BIT_L | BIT_R), 0.3);
  assert.equal(slow.pulses, 0);
});

test('grazes fill the Pulse meter', () => {
  // A wall whose edge passes 2° past the player's hitbox.
  const s = simWith([wall({ a0: 90 + HITBOX_HALF_DEG + 1, span: 60, tHit: 0.05 })]);
  run(s, 0, 0.5);
  assert.ok(s.alive);
  assert.equal(s.grazes, 1);
  assert.equal(s.pips, 1);
});

test('validator: sealed ring is impossible, a gap is not', () => {
  const sealed = [wall({ a0: 0, span: 360, tHit: 0.5 })];
  assert.equal(countBins(advance(singleBin(90), sealed, 0, 1, 400, 3)), 0);
  const gapped = [wall({ a0: 120, span: 300, tHit: 0.5 })]; // gap 60..120
  assert.ok(countBins(advance(singleBin(90), gapped, 0, 1, 400, 3)) > 0);
  // Gap on the far side, not enough time to get there.
  const far = [wall({ a0: 300, span: 300, tHit: 0.1 })]; // gap 240..300
  assert.equal(countBins(advance(singleBin(90), far, 0, 0.2, 400, 3)), 0);
  assert.deepEqual(components(new Uint8Array(360).fill(1)), [{ start: 0, len: 360 }]);
});

test('config sanity', () => {
  assert.ok(HITBOX_HALF_DEG > 1.5 && HITBOX_HALF_DEG < 2.5);
  assert.equal(R_PLAYER, 0.2);
});

test('palettes keep ≥4.5:1 wall contrast, including mid-crossfade (§12.1)', async () => {
  const { paletteFor, lerpPalette, contrast, MIN_CONTRAST } = await import('../src/palette.js');
  const { MOVEMENTS } = await import('../src/config.js');
  for (const mode of ['vivid', 'mono', 'cb']) {
    for (const m of MOVEMENTS) {
      for (let i = 0; i < m.hues.length; i++) {
        const a = paletteFor(m, i, mode);
        for (const next of [paletteFor(m, i + 1, mode), paletteFor(MOVEMENTS[(m.id + 1) % 6], 0, mode)]) {
          for (let k = 0; k <= 1; k += 0.1) {
            const p = lerpPalette(a, next, k);
            for (const bg of [p.bgA, p.bgB]) {
              const c = contrast(p.wall, bg);
              assert.ok(c >= MIN_CONTRAST, `${mode} ${m.name} #${i} k=${k.toFixed(1)}: ${c.toFixed(2)}`);
            }
          }
        }
      }
    }
  }
});
