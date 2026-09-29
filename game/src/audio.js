// Procedural, stem-based music engine plus sound effects (§8, §12.3).
// The AudioContext clock is the master clock: `now()` returns the context time that is
// currently reaching the speakers, and the Timeline maps it to beats.

import { MOVEMENTS } from './config.js';
import { hashString, createRng } from './rng.js';

const STEMS = ['drums', 'bass', 'arp', 'pad', 'lead'];
const STEM_GAIN = { drums: 0.9, bass: 0.55, arp: 0.28, pad: 0.16, lead: 0.2 };
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.timeline = null;
    this.stemLevel = 2;
    this.next16 = null;
    this.lastNow = 0;
    this.perfOrigin = performance.now();
    this.pausedAt = null;
    this.pausedTotal = 0;
    this.onStep = null; // (sixteenthIndex, time, song) — lets visuals follow the kick pattern
  }

  get ok() {
    return !!this.ctx;
  }

  init() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      this.ctx = null;
      return false;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.connect(this.master);
    this.master.connect(c.destination);

    this.musicVol = c.createGain();
    this.musicVol.connect(this.comp);
    this.duckFilter = c.createBiquadFilter();
    this.duckFilter.type = 'lowpass';
    this.duckFilter.frequency.value = 18000;
    this.duckFilter.connect(this.musicVol);
    this.sfxVol = c.createGain();
    this.sfxVol.connect(this.comp);

    this.stems = {};
    for (const s of STEMS) {
      const g = c.createGain();
      g.gain.value = 0;
      // Drums skip the duck filter so the beat carries on through a death (§8).
      g.connect(s === 'drums' ? this.musicVol : this.duckFilter);
      this.stems[s] = g;
    }
    // Echo send for the lead (Movement V's signature sound).
    this.delay = c.createDelay(1);
    this.delayFb = c.createGain();
    this.delayFb.gain.value = 0.38;
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.stems.lead);

    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.timer = setInterval(() => this.schedule(), 25);
    return true;
  }

  setVolumes(music, sfx) {
    if (!this.ctx) return;
    this.musicVol.gain.value = music * 0.9;
    this.sfxVol.gain.value = sfx;
  }

  // Heard time in context seconds (monotonic).
  now() {
    let t;
    if (this.ctx) {
      const c = this.ctx;
      const ts = c.getOutputTimestamp ? c.getOutputTimestamp() : null;
      if (c.state === 'running' && ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        t = Math.min(t, c.currentTime); // never run ahead of what has been rendered
      } else {
        t = c.currentTime - (c.outputLatency || c.baseLatency || 0);
      }
    } else {
      const p = this.pausedAt ?? performance.now();
      t = (p - this.perfOrigin - this.pausedTotal) / 1000;
    }
    if (t < this.lastNow) t = this.lastNow;
    this.lastNow = t;
    return t;
  }

  // Convert a performance.now() timestamp (input events) to heard time.
  perfToNow(perfMs) {
    return this.now() - (performance.now() - perfMs) / 1000;
  }

  // Time at which new sounds can still be scheduled.
  scheduleTime() {
    return this.ctx ? this.ctx.currentTime + 0.005 : this.now();
  }

  pause() {
    if (this.ctx) this.ctx.suspend();
    else if (this.pausedAt === null) this.pausedAt = performance.now();
  }

  resume() {
    if (this.ctx) return this.ctx.resume();
    if (this.pausedAt !== null) {
      this.pausedTotal += performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
    return Promise.resolve();
  }

  setTimeline(tl) {
    this.timeline = tl;
    this.next16 = null;
  }

  setStemLevel(level) {
    this.stemLevel = level;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    STEMS.forEach((s, i) => {
      const on = s === 'drums' || i <= level;
      this.stems[s].gain.setTargetAtTime(on ? STEM_GAIN[s] : 0, t, 0.15);
    });
  }

  // §8: non-drum stems duck on death; the music never stops.
  duck() {
    if (!this.ctx) return;
    const f = this.duckFilter.frequency;
    const t = this.ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(300, f.value), t);
    f.exponentialRampToValueAtTime(320, t + 0.08);
    f.setValueAtTime(320, t + 0.5);
    f.exponentialRampToValueAtTime(18000, t + 1.4);
  }

  // ---- Music scheduler ------------------------------------------------------------

  schedule() {
    const c = this.ctx;
    const tl = this.timeline;
    if (!c || !tl || c.state !== 'running' || !tl.segs.length) return;
    const horizon = c.currentTime + 0.12;
    if (this.next16 === null) this.next16 = Math.ceil(tl.beatAt(c.currentTime) * 4);
    let guard = 0;
    while (guard++ < 64) {
      const t = tl.timeAt(this.next16 / 4);
      if (t > horizon) break;
      if (t >= c.currentTime - 0.01) this.playStep(this.next16, Math.max(t, c.currentTime));
      this.next16++;
    }
  }

  playStep(n, t) {
    const seg = this.timeline.segAtBeat(n / 4);
    const song = MOVEMENTS[seg.song].song;
    const rel = n - seg.b0 * 4;
    const step = ((rel % 16) + 16) % 16;
    const bar = Math.floor(rel / 16);
    const sixteenth = (60 / seg.bpm) / 4;
    const chordDeg = song.prog[((bar % song.prog.length) + song.prog.length) % song.prog.length];
    const note = (deg, oct) => {
      const sc = song.scale;
      const d = ((deg % 7) + 7) % 7;
      return song.root + 12 * (oct + Math.floor(deg / 7)) + sc[d];
    };
    const L = this.stemLevel;
    if (this.onStep) this.onStep(n, t, seg.song);

    if (song.kick[step] === 'x') this.kick(t);
    if (song.snare[step] === 'x') this.snare(t);
    if (song.hat[step] === 'x') this.hat(t, !song.hat16 && step % 4 === 2);

    if (L >= 1 && song.bass[step] === 'x') {
      const up = step === 14 || step === 7 ? 12 : 0;
      this.bass(t, midiHz(note(chordDeg, 0) + up), sixteenth * 1.6, song.reese);
    }
    if (L >= 2 && step % 2 === 0) {
      const tones = [0, 2, 4, 7].map((x) => note(chordDeg + x, 2));
      let idx = step / 2;
      if (song.arp === 'updown') idx = [0, 1, 2, 3, 2, 1, 0, 1][idx];
      else if (song.arp === 'random') idx = hashString(`${bar % 4}:${step}`) % 4;
      this.arp(t, midiHz(tones[idx % 4]), song.arp === 'bell' ? 'bell' : 'square');
    }
    if (L >= 3 && song.pad && step === 0) {
      this.pad(t, [0, 2, 4].map((x) => midiHz(note(chordDeg + x, 1))), sixteenth * 16);
    }
    if (L >= 4 && step % 2 === 0) {
      const rng = createRng(hashString(`${seg.song}:${bar % 4}:${step}`));
      if (rng.chance(step % 8 === 0 ? 0.9 : 0.45)) {
        const deg = chordDeg + rng.pick([0, 2, 4, 4, 7, 1, 5]);
        this.lead(t, midiHz(note(deg, 3)), sixteenth * (rng.chance(0.3) ? 4 : 2), song.lead);
      }
    }
  }

  // ---- Instruments -------------------------------------------------------------------

  env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  osc(type, freq, t, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => o.disconnect();
    return o;
  }

  noiseSrc(t, dur, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
    s.onended = () => s.disconnect();
    return s;
  }

  gain(dest) {
    const g = this.ctx.createGain();
    g.connect(dest);
    return g;
  }

  filter(type, freq, dest, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  kick(t) {
    const g = this.gain(this.stems.drums);
    this.env(g, t, 1, 0.002, 0.32);
    const o = this.osc('sine', 150, t, 0.35, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  }

  snare(t) {
    const g = this.gain(this.stems.drums);
    this.env(g, t, 0.45, 0.002, 0.16);
    this.noiseSrc(t, 0.2, this.filter('highpass', 1400, g));
    const g2 = this.gain(this.stems.drums);
    this.env(g2, t, 0.3, 0.002, 0.08);
    this.osc('triangle', 190, t, 0.1, g2);
  }

  hat(t, open) {
    const g = this.gain(this.stems.drums);
    this.env(g, t, open ? 0.14 : 0.1, 0.001, open ? 0.14 : 0.035);
    this.noiseSrc(t, open ? 0.2 : 0.06, this.filter('highpass', 8000, g));
  }

  bass(t, f, dur, reese) {
    const g = this.gain(this.stems.bass);
    this.env(g, t, 0.5, 0.005, dur);
    const lp = this.filter('lowpass', 1100, g, 5);
    lp.frequency.setValueAtTime(1300, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    this.osc('sawtooth', f, t, dur, lp);
    if (reese) this.osc('sawtooth', f * 1.008, t, dur, lp);
  }

  arp(t, f, kind) {
    const g = this.gain(this.stems.arp);
    if (kind === 'bell') {
      this.env(g, t, 0.35, 0.002, 0.35);
      this.osc('sine', f, t, 0.4, g);
      const g2 = this.gain(this.stems.arp);
      this.env(g2, t, 0.12, 0.002, 0.15);
      this.osc('sine', f * 2.76, t, 0.2, g2);
    } else {
      this.env(g, t, 0.3, 0.003, 0.12);
      this.osc('square', f, t, 0.15, this.filter('lowpass', 2800, g));
    }
  }

  pad(t, freqs, dur) {
    const g = this.gain(this.stems.pad);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.4);
    g.gain.setValueAtTime(0.3, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    const lp = this.filter('lowpass', 1500, g);
    for (const f of freqs) {
      this.osc('sawtooth', f * 0.996, t, dur + 0.2, lp);
      this.osc('sawtooth', f * 1.004, t, dur + 0.2, lp);
    }
  }

  lead(t, f, dur, kind) {
    const dest = kind === 'echo' ? this.delay : this.stems.lead;
    const g = this.gain(dest);
    if (kind === 'echo') g.connect(this.stems.lead);
    this.env(g, t, 0.35, 0.01, dur);
    const type = kind === 'sine' || kind === 'echo' ? 'sine' : kind === 'square' ? 'square' : 'sawtooth';
    this.osc(type, f, t, dur, this.filter('lowpass', 3200, g));
    if (kind === 'echo') this.delay.delayTime.setValueAtTime((dur / 2) * 3, t);
  }

  // ---- Sound effects ------------------------------------------------------------------

  // Next 16th-note time, for quantized one-shots (§12.3).
  next16Time() {
    const tl = this.timeline;
    const t = this.scheduleTime();
    if (!tl || !tl.segs.length) return t;
    return Math.max(t, tl.timeAt(Math.ceil(tl.beatAt(t) * 4) / 4));
  }

  sfx(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = opts.at ?? (opts.quantize ? this.next16Time() : this.scheduleTime());
    const out = this.sfxVol;
    const panned = (p) => {
      if (!this.ctx.createStereoPanner) return out;
      const s = this.ctx.createStereoPanner();
      s.pan.value = Math.max(-1, Math.min(1, p));
      s.connect(out);
      return s;
    };
    switch (name) {
      case 'graze': {
        const g = this.gain(out);
        this.env(g, t, 0.18, 0.001, 0.05);
        this.noiseSrc(t, 0.08, this.filter('bandpass', 5000 + Math.random() * 3000, g, 3));
        const g2 = this.gain(out);
        this.env(g2, t, 0.06, 0.001, 0.05);
        this.osc('sine', 2400 + (opts.pitch || 0) * 90, t, 0.07, g2);
        break;
      }
      case 'pulse': {
        const g = this.gain(out);
        this.env(g, t, 0.35, 0.01, 0.25);
        const bp = this.filter('bandpass', 400, g, 2);
        bp.frequency.exponentialRampToValueAtTime(4500, t + 0.25);
        this.noiseSrc(t, 0.3, bp);
        break;
      }
      case 'perfect': {
        [0, 0.06].forEach((d, i) => {
          const g = this.gain(out);
          this.env(g, t + d, 0.2, 0.002, 0.3);
          this.osc('sine', i ? 1760 : 1318.5, t + d, 0.35, g);
        });
        break;
      }
      case 'glass': {
        const g = this.gain(out);
        this.env(g, t, 0.3, 0.001, 0.3);
        this.noiseSrc(t, 0.35, this.filter('highpass', 5000, g));
        for (let i = 0; i < 3; i++) {
          const g2 = this.gain(out);
          this.env(g2, t + i * 0.02, 0.07, 0.001, 0.25);
          this.osc('sine', 3000 + Math.random() * 3000, t + i * 0.02, 0.3, g2);
        }
        break;
      }
      case 'invert': {
        [0, 0.12, 0.24].forEach((d, i) => {
          const g = this.gain(out);
          this.env(g, t + d, 0.16, 0.003, 0.1);
          this.osc('square', i % 2 ? 660 : 880, t + d, 0.12, this.filter('lowpass', 3000, g));
        });
        break;
      }
      case 'death': {
        const g = this.gain(out);
        this.env(g, t, 0.45, 0.003, 0.4);
        const o = this.osc('sawtooth', 900, t, 0.42, this.filter('lowpass', 2600, g));
        o.frequency.exponentialRampToValueAtTime(60, t + 0.38);
        const g2 = this.gain(out);
        this.env(g2, t, 0.3, 0.002, 0.12);
        this.noiseSrc(t, 0.15, this.filter('bandpass', 1200, g2, 1.5));
        break;
      }
      case 'milestone': {
        [0, 4, 7, 12].forEach((iv, i) => {
          const g = this.gain(out);
          this.env(g, t + i * 0.04, 0.12, 0.005, 0.6);
          this.osc('triangle', midiHz(72 + iv), t + i * 0.04, 0.7, g);
        });
        break;
      }
      case 'clear': {
        [0, 4, 7, 11, 14, 19].forEach((iv, i) => {
          const g = this.gain(out);
          this.env(g, t + i * 0.07, 0.14, 0.005, 1.1);
          this.osc('triangle', midiHz(67 + iv), t + i * 0.07, 1.2, g);
        });
        break;
      }
      case 'cue': {
        const g = this.gain(panned(opts.pan || 0));
        this.env(g, t, 0.12, 0.001, 0.04);
        this.osc('square', 1200, t, 0.06, this.filter('lowpass', 2500, g));
        break;
      }
      case 'click': {
        const g = this.gain(out);
        this.env(g, t, 0.4, 0.001, 0.05);
        this.osc('square', opts.accent ? 1600 : 1000, t, 0.06, g);
        break;
      }
      case 'blip': {
        const g = this.gain(out);
        this.env(g, t, 0.1, 0.002, 0.06);
        this.osc('triangle', opts.high ? 1320 : 880, t, 0.08, g);
        break;
      }
      default:
        break;
    }
  }
}
