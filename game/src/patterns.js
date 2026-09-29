// Pattern library (§7.2). A pattern builds lane events for any lane count N:
//   { beat, lane, len, kind, pend }   kind: solid | glass | shutter | inverter
// Beats are relative to the pattern start. Rotation and mirroring are applied later by the
// generator, so every pattern here assumes its gap starts at lane 0.
//
// Hand-authored, side-specific patterns are written in PGN (Pulsegon Notation), parsed below.

const mod = (a, n) => ((a % n) + n) % n;

function allBut(N, ...open) {
  const o = new Set(open.map((x) => mod(x, N)));
  const out = [];
  for (let i = 0; i < N; i++) if (!o.has(i)) out.push(i);
  return out;
}

function row(events, beat, lanes, len, kind = 'solid', extra = {}) {
  for (const lane of lanes) events.push({ beat, lane, len, kind, ...extra });
}

const P = [];
const def = (name, diff, opts, build) => P.push({ name, diff, ...opts, build });

// ---- Core patterns (any lane count) -------------------------------------------------

def('gate', 1, {}, ({ N, th }) => {
  const e = [];
  row(e, 0, allBut(N, 0), th);
  return e;
});

def('double gate', 1, { minSides: 4 }, ({ N, th }) => {
  const e = [];
  row(e, 0, allBut(N, 0, Math.floor(N / 2)), th);
  return e;
});

def('squeeze', 1, {}, ({ N, th, sp, rng }) => {
  const e = [];
  const dir = rng.chance(0.5) ? 1 : -1;
  for (let r = 0; r < 3; r++) row(e, r * sp, allBut(N, r * dir, r * dir + 1), th);
  return e;
});

def('corridor', 1, {}, ({ N, th, sp }) => {
  const e = [];
  for (let r = 0; r < 3; r++) row(e, (r * sp) / 2, allBut(N, 0), th);
  return e;
});

def('rain', 1, {}, ({ N, th, sp, rng }) => {
  const e = [];
  for (let r = 0; r < 6; r++) {
    const a = rng.int(N);
    const lanes = rng.chance(0.4) && N > 3 ? [a, a + 1] : [a];
    row(e, (r * sp) / 2, lanes.map((l) => mod(l, N)), th);
  }
  return e;
});

def('alternator', 2, {}, ({ N, th, sp }) => {
  const e = [];
  for (let r = 0; r < 4; r++) {
    const lanes = [];
    for (let i = 0; i < N; i++) if ((i + r) % 2 === 0 && !(N % 2 === 1 && i === N - 1)) lanes.push(i);
    row(e, r * sp, lanes, th);
  }
  return e;
});

def('ladder', 2, {}, ({ N, th, sp, rng }) => {
  const e = [];
  const dir = rng.chance(0.5) ? 1 : -1;
  const rows = Math.min(N, 5);
  for (let r = 0; r < rows; r++) row(e, r * sp * 0.75, allBut(N, r * dir), th);
  return e;
});

def('cage flip', 2, { minSides: 4 }, ({ N, th, sp }) => {
  const e = [];
  row(e, 0, allBut(N, 0), th);
  row(e, sp * 1.5, allBut(N, Math.floor(N / 2)), th);
  return e;
});

def('triple C', 2, { minSides: 5 }, ({ N, th, sp }) => {
  const e = [];
  for (let r = 0; r < 3; r++) row(e, r * sp * 1.25, allBut(N, r * 2), th);
  return e;
});

def('zigzag', 3, { minSides: 4 }, ({ N, th, sp }) => {
  const e = [];
  for (let r = 0; r < 4; r++) row(e, r * sp, allBut(N, (r % 2) * 2), th);
  return e;
});

def('spiral', 3, {}, ({ N, th, sp, rng }) => {
  const e = [];
  const dir = rng.chance(0.5) ? 1 : -1;
  const rows = N + 2;
  for (let r = 0; r < rows; r++) row(e, (r * sp) / 2, allBut(N, r * dir, r * dir + 1), th);
  return e;
});

def('tunnel', 3, { minSides: 4 }, ({ N, th, sp }) => {
  const e = [];
  const rows = 3;
  row(e, 0, [0], sp * 2 * (rows - 1) + th);
  for (let r = 0; r < rows; r++) {
    const open = r % 2 === 0 ? 1 : -1;
    row(e, r * sp * 2, allBut(N, 0, open), th);
  }
  return e;
});

def('twin spiral', 3, { minSides: 6 }, ({ N, th, sp }) => {
  const e = [];
  const rows = Math.floor(N / 2) + 1;
  for (let r = 0; r < rows; r++) row(e, r * sp * 0.75, allBut(N, r, -r), th);
  return e;
});

def('burst', 3, {}, ({ N, th, sp, rng }) => {
  const e = [];
  let g = 0;
  for (let r = 0; r < 6; r++) {
    row(e, (r * sp) / 2, allBut(N, g), th);
    g += rng.chance(0.5) ? 1 : -1;
  }
  return e;
});

def('whirlpool', 4, { minSides: 5 }, ({ N, th, sp, rng }) => {
  const e = [];
  const dir = rng.chance(0.5) ? 1 : -1;
  const rows = N * 2;
  for (let r = 0; r < rows; r++) row(e, (r * sp) / 3, allBut(N, r * dir, r * dir + 1, r * dir + 2), th);
  return e;
});

// ---- Feature patterns ----------------------------------------------------------------

def('glass cage', 2, { needs: 'glass', minSides: 4 }, ({ N, th, sp }) => {
  const e = [];
  const far = Math.floor(N / 2);
  row(e, 0, allBut(N, 0), th);
  // Second row: the lanes near the first gap are glass — Pulse straight through, or run around.
  for (const lane of allBut(N, far)) {
    const nearFirstGap = Math.min(mod(lane, N), mod(-lane, N)) <= 1;
    row(e, sp * 1.5, [lane], th * 0.8, nearFirstGap ? 'glass' : 'solid');
  }
  return e;
});

def('glass ladder', 2, { needs: 'glass' }, ({ N, th, sp, rng }) => {
  const e = [];
  const dir = rng.chance(0.5) ? 1 : -1;
  for (let r = 0; r < 4; r++) {
    for (const lane of allBut(N, r * 2 * dir)) {
      const prevGap = mod((r - 1) * 2 * dir, N);
      row(e, r * sp, [lane], th * 0.8, r > 0 && lane === prevGap ? 'glass' : 'solid');
    }
  }
  return e;
});

def('pendulum gate', 2, { needs: 'pendulum' }, ({ N, th, sp }) => {
  const e = [];
  const amp = 360 / N;
  row(e, 0, allBut(N, 0), th, 'solid', { pend: amp });
  row(e, sp * 1.5, allBut(N, Math.floor(N / 2)), th, 'solid', { pend: -amp });
  return e;
});

def('pendulum ladder', 3, { needs: 'pendulum' }, ({ N, th, sp, rng }) => {
  const e = [];
  const dir = rng.chance(0.5) ? 1 : -1;
  const amp = (360 / N) * 0.75;
  for (let r = 0; r < 4; r++) row(e, r * sp, allBut(N, r * dir), th, 'solid', { pend: r % 2 ? amp : -amp });
  return e;
});

// Shutters close on the off-beat and open on the downbeat. Rows on the downbeat find
// them open; rows on the off-beat find them shut.
def('aperture', 2, { needs: 'shutter', onBeat: true }, ({ N, th, rng }) => {
  const e = [];
  let g = 0;
  for (let r = 0; r < 4; r++) {
    for (const lane of allBut(N, g)) {
      const adj = mod(lane - g, N) === 1 || mod(g - lane, N) === 1;
      row(e, r * 0.5, [lane], th, adj ? 'shutter' : 'solid');
    }
    g += rng.chance(0.5) ? 1 : -1;
  }
  return e;
});

def('shutter hall', 3, { needs: 'shutter', onBeat: true }, ({ N, rng }) => {
  const e = [];
  let g = 0;
  for (let r = 0; r < 3; r++) {
    row(e, r, allBut(N, g), 0.95, 'shutter');
    g += rng.pick([-2, -1, 1, 2]);
  }
  return e;
});

def('inverter', 4, { needs: 'inverter', minSides: 4 }, ({ N, th, sp }) => {
  const e = [];
  row(e, 0, allBut(N, 0, Math.floor(N / 2)), th, 'inverter');
  row(e, sp * 2, allBut(N, 1), th);
  row(e, sp * 3.5, allBut(N, -1), th);
  return e;
});

// ---- PGN (Pulsegon Notation) ------------------------------------------------------------
//
// pattern "name"
//   diff 2
//   sides 6          (or: any — then the mask must be exactly one char per lane anyway)
//   meter row        (row offsets scale with the tier's row spacing; `beat` = absolute)
//   <offset> <mask> [len]
// end
// Mask chars: # solid · . open · g glass · s shutter · i inverter

const KINDS = { '#': 'solid', g: 'glass', s: 'shutter', i: 'inverter' };

export function parsePGN(text) {
  const out = [];
  let cur = null;
  const lines = text.split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (!line || line.startsWith('#')) continue; // whole-line comments (rows start with a number)
    const words = line.split(/\s+/);
    if (words[0] === 'pattern') {
      const m = line.match(/^pattern\s+"([^"]+)"/);
      if (!m) throw new Error(`PGN line ${ln + 1}: expected pattern "name"`);
      cur = { name: m[1], diff: 1, sides: null, meter: 'row', rows: [] };
    } else if (!cur) {
      throw new Error(`PGN line ${ln + 1}: statement outside pattern`);
    } else if (words[0] === 'end') {
      if (!cur.rows.length) throw new Error(`PGN pattern "${cur.name}" has no rows`);
      out.push(cur);
      cur = null;
    } else if (words[0] === 'diff') cur.diff = Number(words[1]);
    else if (words[0] === 'sides') cur.sides = words[1] === 'any' ? null : Number(words[1]);
    else if (words[0] === 'meter') cur.meter = words[1];
    else if (words[0] === 'needs') cur.needs = words[1];
    else {
      const off = Number(words[0]);
      const mask = words[1];
      if (Number.isNaN(off) || !mask) throw new Error(`PGN line ${ln + 1}: expected "<offset> <mask> [len]"`);
      if (cur.sides && mask.length !== cur.sides) throw new Error(`PGN line ${ln + 1}: mask width ${mask.length} ≠ sides ${cur.sides}`);
      for (const ch of mask) if (ch !== '.' && !KINDS[ch]) throw new Error(`PGN line ${ln + 1}: unknown mask char "${ch}"`);
      if (!mask.includes('.') && !mask.includes('s')) throw new Error(`PGN line ${ln + 1}: row has no gap`);
      cur.rows.push({ off, mask, len: words[2] ? Number(words[2]) : null });
    }
  }
  if (cur) throw new Error(`PGN pattern "${cur.name}" missing end`);
  return out.map(pgnToPattern);
}

function pgnToPattern(p) {
  const width = p.rows[0].mask.length;
  return {
    name: p.name,
    diff: p.diff,
    sides: p.sides ? [p.sides] : [width],
    needs: p.needs,
    build: ({ th, sp }) => {
      const e = [];
      for (const r of p.rows) {
        const beat = p.meter === 'beat' ? r.off : r.off * sp;
        [...r.mask].forEach((ch, lane) => {
          if (KINDS[ch]) e.push({ beat, lane, len: r.len ?? th, kind: KINDS[ch] });
        });
      }
      return e;
    },
  };
}

export const PGN_LIBRARY = `
# Hexagon classics, hand-authored.
pattern "hex ladder"
  diff 2
  sides 6
  0    .#####
  0.75 #.####
  1.5  ##.###
  2.25 ###.##
end

pattern "hex bat"
  diff 2
  sides 6
  0    .##.##
  1    #.##.#
  2    ##.##.
end

pattern "hex hourglass"
  diff 3
  sides 6
  0    .#####
  0.5  .##.##
  1    ####.#
  1.5  ####.#
end

pattern "square box"
  diff 1
  sides 4
  0    .###
  1.5  ##.#
end

pattern "triangle flip"
  diff 2
  sides 3
  0    .##
  1.5  #.#
  3    ##.
end
`;

export const PATTERNS = [...P, ...parsePGN(PGN_LIBRARY)];

export function patternByName(name) {
  return PATTERNS.find((p) => p.name === name);
}

export function patternFits(p, N, features) {
  if (p.sides && !p.sides.includes(N)) return false;
  if (p.minSides && N < p.minSides) return false;
  if (p.needs && !features.includes(p.needs)) return false;
  return true;
}
