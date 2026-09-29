// End-to-end fairness check: generate real stages, ask the validator for a path, and have
// a bot drive the actual simulation along it. If the validator and the sim ever disagree
// (or a sequence is unfair), the bot dies and this fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline } from '../src/timeline.js';
import { Generator } from '../src/generator.js';
import { createSim, step, isInverted, BIT_L, BIT_R } from '../src/sim.js';
import { createRng } from '../src/rng.js';
import { MOVEMENTS, TIERS, DT, VALIDATOR_HALF_DEG, START_THETA, validatorOmega } from '../src/config.js';
import { solvePath } from '../src/validator.js';

function setup({ movement, tier, seed, mode = 'stage', endless = false, T0 = 0.37 }) {
  const m = MOVEMENTS[movement];
  const tl = new Timeline();
  tl.addSegment(0, m.bpm, m.swing, m.id);
  const walls = [];
  const gen = new Generator({ timeline: tl, T0, movement: m, tier, rng: createRng(seed), walls, mode, endless });
  const sim = createSim({
    walls,
    omega: TIERS[tier].omega,
    beatSec: (t) => tl.beatSecAt(T0 + t),
    distToBeat: (t) => tl.distToBeat(T0 + t),
  });
  return { tl, gen, sim, walls, m };
}

function playWithBot(ctx, seconds) {
  const { gen, sim, walls, tl, m } = ctx;
  gen.fillUntil(seconds + 6);
  const tier = TIERS[gen.tier];
  const omegaV = validatorOmega(tier.omega, m.bpm, tier.travelBeats, tier.react);
  const path = solvePath(walls, 0, START_THETA, seconds, omegaV, VALIDATOR_HALF_DEG);
  assert.ok(path, 'validator found no path through its own output');
  let pi = 0;
  const stepDeg = tier.omega * DT;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const t = (i + 1) * DT;
    while (pi < path.length - 1 && path[pi + 1].t <= t) pi++;
    const target = path[Math.min(pi + 1, path.length - 1)].theta;
    const diff = ((target - sim.theta + 540) % 360) - 180;
    let bits = 0;
    if (Math.abs(diff) > stepDeg / 2) bits = diff > 0 ? BIT_L : BIT_R;
    if (bits && isInverted(sim)) bits ^= BIT_L | BIT_R; // a human reads the INVERTED warning too
    step(sim, bits);
    if (!sim.alive) {
      const d = sim.death;
      return { died: true, t: d.t, pattern: d.wall.pattern, tl };
    }
  }
  return { died: false };
}

for (const movement of [0, 1, 2, 3, 4, 5]) {
  for (const tier of [0, 1, 2]) {
    test(`Movement ${MOVEMENTS[movement].numeral} ${TIERS[tier].name}: bot survives the goal time`, () => {
      const ctx = setup({ movement, tier, seed: 1000 + movement * 10 + tier });
      const secs = MOVEMENTS[movement].goal + 5;
      const r = playWithBot(ctx, secs);
      assert.equal(r.died, false, `died at ${r.t?.toFixed(2)}s to "${r.pattern}"`);
      // Content sanity: the run actually had walls and rarely needed fallbacks.
      assert.ok(ctx.walls.length > 40);
      assert.ok(ctx.gen.fallbacks <= 6, `fallbacks=${ctx.gen.fallbacks}`);
    });
  }
}

test('seed sweep: 8 extra seeds per stage, all survivable', () => {
  const failures = [];
  let fallbacks = 0;
  for (let movement = 0; movement < 6; movement++) {
    for (let tier = 0; tier < 3; tier++) {
      for (let seed = 1; seed <= 8; seed++) {
        const ctx = setup({ movement, tier, seed: seed * 7919 + movement, T0: seed * 0.113 });
        const r = playWithBot(ctx, MOVEMENTS[movement].goal);
        if (r.died) failures.push(`${MOVEMENTS[movement].numeral}/${TIERS[tier].name}/seed ${seed}: ${r.pattern} @${r.t.toFixed(2)}`);
        fallbacks += ctx.gen.fallbacks;
      }
    }
  }
  assert.deepEqual(failures, []);
  assert.ok(fallbacks < 60, `fallbacks=${fallbacks}`);
});

test('Endless: bot survives 3 minutes of ramping difficulty', () => {
  const ctx = setup({ movement: 5, tier: 1, seed: 7, endless: true });
  const r = playWithBot(ctx, 180);
  assert.equal(r.died, false, `died at ${r.t?.toFixed(2)}s to "${r.pattern}"`);
});

test('generation is deterministic for a seed', () => {
  const a = setup({ movement: 4, tier: 1, seed: 42 });
  const b = setup({ movement: 4, tier: 1, seed: 42 });
  a.gen.fillUntil(40);
  b.gen.fillUntil(40);
  assert.deepEqual(
    a.walls.map((w) => [w.tHit, w.a0, w.span, w.kind]),
    b.walls.map((w) => [w.tHit, w.a0, w.span, w.kind]),
  );
  assert.deepEqual(a.gen.morphs, b.gen.morphs);
});

test('walls land exactly on beat subdivisions (§8)', () => {
  const { gen, walls, tl } = setup({ movement: 0, tier: 1, seed: 3 });
  gen.fillUntil(30);
  for (const w of walls) {
    const b = tl.beatAt(0.37 + w.tHit);
    assert.ok(Math.abs(b * 4 - Math.round(b * 4)) < 1e-6, `wall at beat ${b}`);
  }
});

test('morphs happen on bar lines with the arena clear', () => {
  const { gen, walls, tl } = setup({ movement: 4, tier: 2, seed: 9 });
  gen.fillUntil(60);
  assert.ok(gen.morphs.length >= 3);
  for (const m of gen.morphs) {
    assert.equal((m.beat - tl.segAtBeat(m.beat).b0) % 4, 0);
    for (const w of walls) {
      const beatSec = 60 / 160;
      const overlaps = w.tHit < m.t + 2 * beatSec - 1e-6 && w.tHit + w.len > m.t - beatSec + 1e-6;
      assert.ok(!overlaps, `wall at ${w.tHit} too close to morph at ${m.t}`);
    }
  }
});

test('Gauntlet switches songs on bar lines', () => {
  const ctx = setup({ movement: 0, tier: 0, seed: 5, mode: 'gauntlet' });
  ctx.gen.fillUntil(200);
  assert.ok(ctx.gen.switches.length >= 3);
  assert.equal(ctx.tl.segs[1].bpm, MOVEMENTS[1].bpm);
  const r = playWithBot(ctx, 190);
  assert.equal(r.died, false, `died at ${r.t?.toFixed(2)}s to "${r.pattern}"`);
});

test('an idle player survives the warm-up on every Movement (§11.4)', () => {
  for (const movement of [0, 1, 2, 3, 4, 5]) {
    const { gen, sim, walls } = setup({ movement, tier: 2, seed: 11 });
    gen.fillUntil(8);
    const warm = walls.filter((w) => w.pattern === 'warm-up');
    assert.ok(warm.length > 0);
    const end = Math.max(...warm.map((w) => w.tHit + w.len));
    for (let i = 0; i < Math.round(end / DT) + 1; i++) step(sim, 0);
    assert.ok(sim.alive, `Movement ${MOVEMENTS[movement].numeral}: idle player died at ${sim.death?.t.toFixed(2)}s`);
  }
});
