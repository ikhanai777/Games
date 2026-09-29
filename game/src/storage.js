// Local save data (§14.4): settings, records, unlocks, calibration. Every access is
// wrapped so the game still works when storage is blocked (private mode, previews).

import { DEFAULT_SETTINGS, MOVEMENTS } from './config.js';

const KEY = 'pulsegon.save.v1';

function fresh() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    best: {}, // recordKey -> seconds
    style: {}, // recordKey -> points
    cleared: {}, // "m:t" -> true
    unlocked: { '0:0': true },
    daily: { date: '', attempts: 0, best: 0 },
  };
}

export function load() {
  const base = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    return {
      ...base,
      ...data,
      settings: { ...base.settings, ...(data.settings || {}), bindings: { ...base.settings.bindings, ...(data.settings?.bindings || {}) } },
    };
  } catch {
    return base;
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

export function resetProgress(data) {
  const f = fresh();
  data.best = f.best;
  data.style = f.style;
  data.cleared = f.cleared;
  data.unlocked = f.unlocked;
  data.daily = f.daily;
}

export function unlockAll(data) {
  for (const m of MOVEMENTS) for (let t = 0; t < 3; t++) data.unlocked[`${m.id}:${t}`] = true;
}

// §13: comfort options keep eligibility; difficulty-changing ones get their own boards.
export function category(settings) {
  if (settings.classic) return 'classic';
  if (settings.oneButton) return 'onebutton';
  if (settings.speed < 1) return 'assisted';
  return 'standard';
}

export function recordKey(mode, movement, tier, settings) {
  return `${mode}:${movement}:${tier}:${category(settings)}`;
}

// §9.1: clearing a tier unlocks the next tier of that Movement and tier 1 of the next.
export function markCleared(data, movement, tier) {
  data.cleared[`${movement}:${tier}`] = true;
  if (tier < 2) data.unlocked[`${movement}:${tier + 1}`] = true;
  if (movement < MOVEMENTS.length - 1) data.unlocked[`${movement + 1}:0`] = true;
}

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
