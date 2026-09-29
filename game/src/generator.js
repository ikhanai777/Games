// Sequencer (§7.3): places patterns on the beat grid, morphs the polygon on bar lines,
// and runs every candidate through the validator before committing it (§11.2).

import { VALIDATOR_HALF_DEG, START_THETA, TIERS, MOVEMENTS, wallSpeed, validatorOmega } from './config.js';
import { PATTERNS, patternByName, patternFits } from './patterns.js';
import { advance, components, countBins, singleBin, BINS } from './validator.js';

const MAX_REROLLS = 5;

let wallIds = 0;

export class Generator {
  // o: { timeline, T0, movement, tier, rng, walls, mode, classic, gymPattern, elapsedOffset, endless }
  constructor(o) {
    Object.assign(this, o);
    this.elapsedOffset = o.elapsedOffset || 0;
    this.morphs = [];
    this.switches = [{ t: -1e9, movement: o.movement.id }];
    this.sides = o.movement.sides[0];
    const b0 = this.timeline.beatAt(this.T0);
    const tierNow = this.tierParams(0);
    // First walls arrive after one full visible travel plus a beat, on the beat grid.
    this.cursorBeat = Math.ceil(b0 + tierNow.travelBeats + 1);
    this.nextMorphBeat = this.movement.morphBars ? this.timeline.nextBar(this.cursorBeat) + this.movement.morphBars * 4 : Infinity;
    this.frontier = singleBin(START_THETA);
    this.tF = 0;
    this.warm = true;
    this.lastPattern = null;
    this.rejects = 0;
    this.fallbacks = 0;
    this.gauntletIndex = 0;
    this.nextSwitchAt = this.mode === 'gauntlet' ? this.movement.goal : Infinity;
  }

  runTime(beat) {
    return this.timeline.timeAt(beat) - this.T0;
  }

  // Tier parameters, ramped over time in Endless (§9.2).
  tierParams(elapsed) {
    const base = TIERS[this.tier];
    if (!this.endless) return base;
    const k = Math.min(1, elapsed / 180);
    const lerp = (a, b) => a + (b - a) * k;
    return {
      ...base,
      omega: 540,
      travelBeats: lerp(2.25, 1.35),
      react: lerp(0.22, 0.13),
      gapBeats: lerp(1.5, 0.6),
      rowBeats: lerp(1, 0.5),
      thick: lerp(0.25, 0.2),
      grid: elapsed < 60 ? 0.5 : 0.25,
      maxDiff: 2 + Math.floor(k * 3),
    };
  }

  fillUntil(runT, maxSteps = 10000) {
    let guard = 0;
    while (this.runTime(this.cursorBeat) < runT && guard++ < maxSteps) this.appendNext();
  }

  movementAt(t) {
    let m = this.switches[0].movement;
    for (const s of this.switches) if (t >= s.t) m = s.movement;
    return MOVEMENTS[m];
  }

  sidesAt(t) {
    let s = this.movement.sides[0];
    for (const m of this.morphs) if (t >= m.t) s = m.to;
    return s;
  }

  appendNext() {
    const elapsed = this.runTime(this.cursorBeat) + this.elapsedOffset;

    if (elapsed >= this.nextSwitchAt && this.gauntletIndex < MOVEMENTS.length - 1) {
      this.switchMovement();
      return;
    }
    if (this.cursorBeat >= this.nextMorphBeat) {
      this.morph();
      return;
    }

    const tp = this.tierParams(elapsed);
    const bpm = this.timeline.bpmAtBeat(this.cursorBeat);
    const omegaV = validatorOmega(tp.omega, bpm, tp.travelBeats, tp.react);
    const ctx = { N: this.sides, rng: this.rng, sp: tp.rowBeats, th: tp.thick };

    for (let attempt = 0; attempt <= MAX_REROLLS; attempt++) {
      const pat = this.warm ? null : this.pickPattern(elapsed, tp);
      // Later rerolls get an extra beat of breathing room before the pattern starts.
      const cursor = this.cursorBeat + Math.max(0, attempt - 2);
      const startBeat = pat && pat.onBeat ? Math.ceil(cursor - 1e-6) : cursor;
      const events = pat ? pat.build(ctx) : warmupEvents(ctx);
      const walls = this.buildWalls(events, startBeat, tp, pat ? pat.name : 'warm-up', !this.warm);
      const tEnd = Math.max(...walls.map((w) => w.tHit + w.len));
      const next = this.check(walls, tEnd, omegaV);
      if (next) {
        this.commit(walls, next, tEnd, tp);
        this.warm = false;
        this.lastPattern = pat;
        return;
      }
      this.rejects++;
    }
    // Fallback (§11.2): a quiet bar is always survivable while the frontier is non-empty.
    this.fallbacks++;
    const quietEnd = this.timeline.nextBar(this.cursorBeat + 1);
    const tEnd = this.runTime(quietEnd);
    this.frontier = advance(this.frontier, [], this.tF, tEnd, omegaV, VALIDATOR_HALF_DEG);
    this.tF = tEnd;
    this.cursorBeat = quietEnd;
  }

  pickPattern(elapsed, tp) {
    if (this.gymPattern) {
      const p = patternByName(this.gymPattern);
      if (p && patternFits(p, this.sides, this.features())) return p;
    }
    const feats = this.features();
    const cap = elapsed < 15 ? Math.max(1, tp.maxDiff - 1) : tp.maxDiff;
    const pool = PATTERNS.filter((p) => p.diff <= cap && patternFits(p, this.sides, feats));
    return this.rng.weighted(pool, (p) => {
      let w = p.needs ? 2.5 : 1; // signature mechanics show up more often
      if (p.diff === cap) w *= 1.4;
      if (p === this.lastPattern) w *= 0.3;
      return w;
    });
  }

  features() {
    const m = this.mode === 'gauntlet' ? MOVEMENTS[this.gauntletIndex] : this.movement;
    let f = m.features;
    if (this.classic) f = f.filter((x) => x !== 'glass');
    if (!(this.tier === 2 || this.endless)) f = f.filter((x) => x !== 'inverter');
    return f;
  }

  buildWalls(events, startBeat, tp, patName, transform) {
    const N = this.sides;
    const rot = transform ? this.rng.int(N) : 0;
    const mirror = transform && this.rng.chance(0.5);
    const feats = this.features();
    const echo = feats.includes('echo') && this.rng.chance(0.5);
    const laneW = 360 / N;
    // Group lanes by (beat, len, kind, pend) and merge contiguous runs into single arcs.
    const groups = new Map();
    for (const e of events) {
      let lane = mirror ? N - 1 - e.lane : e.lane;
      lane = (((lane + rot) % N) + N) % N;
      const pend = e.pend ? (mirror ? -e.pend : e.pend) : 0;
      const beat = Math.round(e.beat * 4) / 4; // §8: every wall lands on a 16th note
      const key = `${beat}|${e.len}|${e.kind}|${pend}`;
      if (!groups.has(key)) groups.set(key, { e: { ...e, beat }, pend, lanes: new Set() });
      groups.get(key).lanes.add(lane);
    }
    const walls = [];
    for (const { e, pend, lanes } of groups.values()) {
      const absBeat = startBeat + e.beat;
      const bpm = this.timeline.bpmAtBeat(absBeat);
      const tHit = this.runTime(absBeat);
      const len = this.runTime(absBeat + e.len) - tHit;
      const v = wallSpeed(bpm, tp.travelBeats);
      const beatSec = 60 / bpm;
      for (const run of laneRuns(lanes, N)) {
        const w = {
          id: ++wallIds,
          tHit, len, v,
          a0: run.start * laneW,
          span: run.len * laneW,
          sides: N,
          kind: e.kind,
          glass: e.kind === 'glass',
          inverter: e.kind === 'inverter' ? beatSec * 4 : 0,
          echo,
          pend: pend ? { amp: pend, period: beatSec * 2, lock: beatSec } : null,
          shut: e.kind === 'shutter' ? { t0: this.runTime(Math.floor(absBeat)), period: beatSec, from: 0.5, to: 1 } : null,
          pattern: patName,
          grazed: false,
        };
        walls.push(w);
      }
    }
    walls.sort((a, b) => a.tHit - b.tHit);
    return walls;
  }

  // Returns the new frontier if the candidate is fair, else null.
  check(walls, tEnd, omegaV) {
    const hv = VALIDATOR_HALF_DEG;
    const next = advance(this.frontier, walls, this.tF, tEnd, omegaV, hv);
    if (countBins(next) === 0) return null;
    // Every place the player could be when the previous pattern ends must still have a way
    // through — so an earlier gap choice can't doom you (anti-cheap rule, §11.4).
    for (const c of components(this.frontier)) {
      if (c.len >= BINS) continue;
      const mid = (c.start + Math.floor(c.len / 2)) % BINS;
      if (countBins(advance(singleBin(mid), walls, this.tF, tEnd, omegaV, hv)) === 0) return null;
    }
    return next;
  }

  commit(walls, frontier, tEnd, tp) {
    for (const w of walls) this.walls.push(w);
    this.frontier = frontier;
    this.tF = tEnd;
    const endBeat = this.timeline.beatAt(this.T0 + tEnd);
    const g = tp.grid;
    this.cursorBeat = Math.ceil((endBeat + tp.gapBeats) / g - 1e-6) * g;
  }

  // §5.2: morph only on a bar line, with ≥1 beat clear before and ≥2 beats after.
  morph() {
    const opts = this.movement.sides.filter((s) => s !== this.sides);
    const to = this.rng.pick(opts.length ? opts : this.movement.sides);
    this.startMorph(to);
    this.nextMorphBeat = this.cursorBeat - 2 + this.movement.morphBars * 4;
  }

  startMorph(to) {
    const lastEndBeat = this.timeline.beatAt(this.T0 + this.tF);
    const M = this.timeline.nextBar(Math.max(this.cursorBeat, lastEndBeat + 1));
    const t = this.runTime(M);
    this.morphs.push({ t, beat: M, from: this.sides, to, barSec: this.runTime(M) - this.runTime(M - 4), beatSec: this.runTime(M + 1) - t });
    this.sides = to;
    const tNext = this.runTime(M + 2);
    this.frontier = advance(this.frontier, [], this.tF, tNext, 360, VALIDATOR_HALF_DEG);
    this.tF = tNext;
    this.cursorBeat = M + 2;
  }

  // Gauntlet (§9.4): cross into the next Movement's song on a bar line.
  switchMovement() {
    this.gauntletIndex++;
    const m = MOVEMENTS[this.gauntletIndex];
    const lastEndBeat = this.timeline.beatAt(this.T0 + this.tF);
    const B = this.timeline.nextBar(Math.max(this.cursorBeat, lastEndBeat + 1));
    const tAudio = this.timeline.timeAt(B);
    const speed = this.speed || 1;
    this.timeline.addSegment(tAudio, m.bpm * speed, m.swing, m.id);
    this.switches.push({ t: tAudio - this.T0, movement: m.id });
    this.movement = m;
    this.nextSwitchAt += m.goal;
    this.cursorBeat = this.timeline.beatAt(tAudio);
    this.nextMorphBeat = m.morphBars ? this.cursorBeat + m.morphBars * 4 : Infinity;
    if (!m.sides.includes(this.sides) || m.sides.length === 1) this.startMorph(m.sides[0]);
    else {
      const tNext = this.runTime(this.cursorBeat + 2);
      this.frontier = advance(this.frontier, [], this.tF, tNext, 360, VALIDATOR_HALF_DEG);
      this.tF = tNext;
      this.cursorBeat += 2;
    }
  }

  prune(t) {
    // Keep the last few seconds for the death cam.
    const cutoff = t - 4;
    let i = 0;
    while (i < this.walls.length && this.walls[i].tHit + this.walls[i].len < cutoff) i++;
    if (i > 64) this.walls.splice(0, i);
  }
}

// §11.4 fixed warm-up: two easy gates with the gap over the start position.
function warmupEvents({ N, th, sp }) {
  const laneW = 360 / N;
  // Open every lane the resting player touches (the start angle can sit on a lane edge).
  const lo = Math.floor((START_THETA - 6) / laneW);
  const hi = Math.floor((START_THETA + 6) / laneW);
  const open1 = new Set([lo, hi].map((l) => (l + N) % N));
  const open2 = new Set([...open1, (hi + 1) % N]);
  const e = [];
  for (let i = 0; i < N; i++) if (!open1.has(i)) e.push({ beat: 0, lane: i, len: th, kind: 'solid' });
  for (let i = 0; i < N; i++) if (!open2.has(i)) e.push({ beat: sp * 1.5, lane: i, len: th, kind: 'solid' });
  return e;
}

function laneRuns(lanes, N) {
  if (lanes.size === N) return [{ start: 0, len: N }];
  let s = 0;
  while (lanes.has(s)) s = (s + 1) % N; // start from an open lane
  const runs = [];
  for (let i = 1; i <= N; i++) {
    const l = (s + i) % N;
    if (!lanes.has(l)) continue;
    const prev = (l + N - 1) % N;
    if (!lanes.has(prev) || runs.length === 0) runs.push({ start: l, len: 0 });
    runs[runs.length - 1].len++;
  }
  return runs;
}

