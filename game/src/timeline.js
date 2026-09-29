// Maps audio-clock seconds <-> musical beats (§8). The music engine, the generator and
// the simulation all read the same Timeline, so walls land exactly on the beats you hear.
//
// A timeline is a list of tempo segments. Each segment starts on an integer beat, so beat
// numbers keep increasing across tempo/song changes (Gauntlet, menu song switches).

function swingForward(x, s) {
  // straight beat position -> swung time position (in beats). s = 0.5 is straight.
  const i = Math.floor(x);
  const u = x - i;
  return i + (u < 0.5 ? u * 2 * s : s + (u - 0.5) * 2 * (1 - s));
}

function swingInverse(y, s) {
  const i = Math.floor(y);
  const u = y - i;
  return i + (u < s ? u / (2 * s) : 0.5 + (u - s) / (2 * (1 - s)));
}

export class Timeline {
  constructor() {
    this.segs = [];
  }

  // Start a new tempo segment at audio time t0. Later segments are discarded.
  addSegment(t0, bpm, swing, song) {
    while (this.segs.length && this.segs[this.segs.length - 1].t0 >= t0 - 1e-9) this.segs.pop();
    const b0 = this.segs.length ? Math.ceil(this.beatAt(t0) - 1e-6) : 0;
    const seg = { t0, b0, bpm, swing, song };
    this.segs.push(seg);
    return seg;
  }

  // Drop every segment that starts after `t` (used when a run ends early).
  truncateAfter(t) {
    while (this.segs.length > 1 && this.segs[this.segs.length - 1].t0 > t) this.segs.pop();
  }

  segAtTime(t) {
    for (let i = this.segs.length - 1; i > 0; i--) if (t >= this.segs[i].t0) return this.segs[i];
    return this.segs[0];
  }

  segAtBeat(b) {
    for (let i = this.segs.length - 1; i > 0; i--) if (b >= this.segs[i].b0) return this.segs[i];
    return this.segs[0];
  }

  beatAt(t) {
    const s = this.segAtTime(t);
    const y = ((t - s.t0) * s.bpm) / 60;
    return s.b0 + (s.swing === 0.5 ? y : swingInverse(y, s.swing));
  }

  timeAt(b) {
    const s = this.segAtBeat(b);
    const x = b - s.b0;
    const y = s.swing === 0.5 ? x : swingForward(x, s.swing);
    return s.t0 + (y * 60) / s.bpm;
  }

  bpmAtBeat(b) {
    return this.segAtBeat(b).bpm;
  }

  beatSecAt(t) {
    return 60 / this.segAtTime(t).bpm;
  }

  // First bar line (every 4 beats from the segment start) at or after beat b.
  nextBar(b) {
    const s = this.segAtBeat(b);
    return s.b0 + Math.ceil((b - s.b0 - 1e-6) / 4) * 4;
  }

  // Seconds from t to the nearest beat.
  distToBeat(t) {
    const b = Math.round(this.beatAt(t));
    return Math.abs(this.timeAt(b) - t);
  }
}

export const _swing = { swingForward, swingInverse };
