// Tuning constants and content definitions. Section numbers refer to specs/pulsegon.md.

export const TICK_HZ = 240; // §14.1 fixed-step simulation rate
export const DT = 1 / TICK_HZ;

// Radii are in "arena units": 1.0 = half of the shorter screen dimension.
export const R_PLAYER = 0.2;
export const R_CENTER = 0.13;
export const R_VISIBLE = 1.0; // walls are guaranteed on screen from here inward
export const R_MAX_DRAW = 3.2; // far enough to cover ultrawide corners and tilt

const toDeg = (arcWidth) => (arcWidth / R_PLAYER) * (180 / Math.PI);
export const HITBOX_HALF_DEG = toDeg(0.014) / 2; // §6.2 hitbox arc (≈64% of visual)
export const VISUAL_HALF_DEG = toDeg(0.022) / 2;
export const GRAZE_DEG = toDeg(0.01); // §6.3
export const VALIDATOR_HALF_DEG = HITBOX_HALF_DEG * 1.5; // §11.2 clearance margin

export const PULSE_CHORD_TICKS = Math.round(0.04 * TICK_HZ); // §6.4 40 ms chord window
export const PIPS_PER_CHARGE = 12;
export const MAX_CHARGES = 3;
export const PERFECT_WINDOW = 0.03;

export const DEATH_FREEZE = 0.4; // §12.2
export const AUTO_RETRY_AFTER = 0.6; // §3
export const SCRUB_SECONDS = 2;

export const START_THETA = 90;

export const TIERS = [
  { id: 0, name: 'Normal', omega: 480, travelBeats: 2.25, react: 0.22, gapBeats: 1.5, rowBeats: 1, thick: 0.25, grid: 0.5, maxDiff: 2 },
  { id: 1, name: 'Hyper', omega: 540, travelBeats: 1.75, react: 0.17, gapBeats: 1.0, rowBeats: 0.75, thick: 0.22, grid: 0.25, maxDiff: 3 },
  { id: 2, name: 'Ultra', omega: 600, travelBeats: 1.5, react: 0.13, gapBeats: 0.75, rowBeats: 0.5, thick: 0.2, grid: 0.25, maxDiff: 4 },
];

// Wall speed for a given tempo and tier: the wall covers R_VISIBLE→R_PLAYER in `travelBeats`.
export function wallSpeed(bpm, travelBeats) {
  return (R_VISIBLE - R_PLAYER) / ((travelBeats * 60) / bpm);
}

// Effective player speed the validator assumes: reaction time eats into the travel window (§11.1).
export function validatorOmega(omega, bpm, travelBeats, react) {
  const travelSec = (travelBeats * 60) / bpm;
  return omega * Math.max(0.35, (travelSec - react) / travelSec);
}

export const MILESTONES = ['LINE', 'TRIANGLE', 'SQUARE', 'PENTAGON', 'HEXAGON', 'PULSEGON', 'HEPTAGON', 'OCTAGON', 'NONAGON'];

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};

// §9.1 Movements. `hues` drive the per-milestone palettes (§12.1).
export const MOVEMENTS = [
  {
    id: 0, numeral: 'I', name: 'Ignition', bpm: 128, swing: 0.5, goal: 60,
    sides: [6], morphBars: 0, features: [], signature: 'Solid walls, hexagon only',
    cam: { speed: 60, tilt: 0 }, hues: [18, 340, 280, 200, 110, 48],
    song: {
      root: 45, scale: SCALES.minor, prog: [0, 5, 2, 6],
      kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', hat16: false,
      bass: 'x.xxx.xxx.xxx.xx', arp: 'up', lead: 'saw', pad: true,
    },
  },
  {
    id: 1, numeral: 'II', name: 'Refraction', bpm: 138, swing: 0.5, goal: 60,
    sides: [4, 6], morphBars: 8, features: ['glass'], signature: 'Glass walls, square↔hex morphs',
    cam: { speed: 80, tilt: 0 }, hues: [190, 210, 170, 250, 300, 150],
    song: {
      root: 40, scale: SCALES.minor, prog: [0, 3, 5, 4],
      kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', hat16: true,
      bass: 'x..x..x...x..x..', arp: 'bell', lead: 'sine', pad: true,
    },
  },
  {
    id: 2, numeral: 'III', name: 'Swing', bpm: 112, swing: 0.64, goal: 60,
    sides: [3, 6], morphBars: 8, features: ['pendulum'], signature: 'Pendulums, triangles',
    cam: { speed: 50, tilt: 0.15 }, hues: [40, 20, 60, 330, 10, 90],
    song: {
      root: 50, scale: SCALES.dorian, prog: [0, 3, 0, 4],
      kick: 'x.....x.x.......', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.', hat16: false,
      bass: 'x...x.x.x...x.x.', arp: 'updown', lead: 'square', pad: true,
    },
  },
  {
    id: 3, numeral: 'IV', name: 'Aperture', bpm: 150, swing: 0.5, goal: 60,
    sides: [5, 6], morphBars: 8, features: ['shutter'], signature: 'Shutters, off-beat reading',
    cam: { speed: 100, tilt: 0 }, hues: [120, 160, 90, 60, 180, 30],
    song: {
      root: 49, scale: SCALES.phrygian, prog: [0, 1, 0, 6],
      kick: 'x..x..x...x..x..', snare: '....x..x....x...', hat: 'xxxxxxxxxxxxxxxx', hat16: true,
      bass: 'x..x..x.x..x..x.', arp: 'random', lead: 'saw', pad: false,
    },
  },
  {
    id: 4, numeral: 'V', name: 'Echo Chamber', bpm: 160, swing: 0.5, goal: 60,
    sides: [3, 4, 5, 6, 7, 8, 9], morphBars: 4, features: ['echo', 'glass'], signature: 'Echo walls, 3–9 side morphs',
    cam: { speed: 120, tilt: 0.3 }, hues: [265, 230, 295, 320, 200, 250],
    song: {
      root: 42, scale: SCALES.minor, prog: [0, 5, 3, 4],
      kick: 'x.......x.x.....', snare: '....x.......x...', hat: '..x...x...x...x.', hat16: true,
      bass: 'x.x.x.x.x.x.x.x.', arp: 'up', lead: 'echo', pad: true,
    },
  },
  {
    id: 5, numeral: 'VI', name: 'Pulsegon', bpm: 174, swing: 0.5, goal: 90,
    sides: [4, 5, 6, 7, 8], morphBars: 4, features: ['glass', 'pendulum', 'shutter', 'echo', 'inverter'],
    signature: 'Everything, plus Inverters on Ultra',
    cam: { speed: 150, tilt: 0.35 }, hues: [0, 330, 300, 30, 200, 160, 270, 50, 350],
    song: {
      root: 45, scale: SCALES.harmonic, prog: [0, 5, 3, 4],
      kick: 'x.........x.....', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', hat16: true,
      bass: 'x.....x...x...x.', arp: 'updown', lead: 'saw', pad: true, reese: true,
    },
  },
];

export const DEFAULT_SETTINGS = {
  rotation: 1, // §13 camera rotation intensity 0..1
  tilt: true,
  zoom: true,
  flashes: true,
  photosensitive: false,
  palette: 'vivid', // vivid | mono | cb
  outlines: false,
  wallCues: false,
  speed: 1, // game speed assist 0.7..1
  oneButton: false,
  classic: false,
  autoRetry: true,
  announcer: true,
  musicVolume: 0.8,
  sfxVolume: 0.8,
  calibration: 0, // seconds, added to the audio clock
  bindings: {
    left: ['ArrowLeft', 'KeyA', 'KeyZ'],
    right: ['ArrowRight', 'KeyD', 'KeyM'],
    pulse: ['Space'],
  },
};
