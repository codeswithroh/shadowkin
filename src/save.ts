/**
 * Everything that survives between sessions, in localStorage: settings, which
 * kin you have met, today's shadow and your streak, and the creatures living
 * in your room (stored relative to the nest anchor so they come back in the
 * same real-world spot).
 */

import { SILHOUETTES } from './silhouettes.js';

const KEY = 'shadowkin.save.v1';

export interface SavedCreature {
  /** "xr" or "desktop": each mode keeps its own kin. */
  space: string;
  silhouette: number;
  size: number;
  phase: number;
  u: number;
  v: number;
  homeU: number;
  homeV: number;
  bounds: [number, number, number, number];
  /** Surface frame in nest-local coordinates. */
  origin: [number, number, number];
  axisU: [number, number, number];
  axisV: [number, number, number];
  normal: [number, number, number];
  daily: boolean;
  born: string;
}

export interface SaveData {
  version: 1;
  settings: { easy: boolean; sound: boolean };
  /** Kin born per silhouette id. */
  met: Record<string, number>;
  daily: { date: string; done: boolean };
  streak: { count: number; last: string };
  creatures: SavedCreature[];
  nestUuid: string | null;
  /** Lantern offset in nest-local coordinates. */
  lantern: [number, number, number] | null;
}

function fresh(): SaveData {
  return {
    version: 1,
    settings: { easy: false, sound: true },
    met: {},
    daily: { date: '', done: false },
    streak: { count: 0, last: '' },
    creatures: [],
    nestUuid: null,
    lantern: null,
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const data = { ...fresh(), ...(JSON.parse(raw) as Partial<SaveData>) };
    data.settings = { ...fresh().settings, ...data.settings };
    return data;
  } catch {
    return fresh();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private browsing or full storage: the session still plays, it just won't persist.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Local calendar date, YYYY-MM-DD. */
export function today(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * Today's shadow: the same shape for everyone on a given date, Wordle-style.
 * Cycles through every silhouette in a shuffled order so no two days in a row repeat.
 */
export function dailySilhouette(date: string): number {
  const n = SILHOUETTES.length;
  const day = dayNumber(date);
  const cycle = Math.floor(day / n);
  const order = [...Array(n).keys()];
  let seed = (cycle * 2654435761) >>> 0;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order[day % n];
}

/** Starts a new day if needed; returns true when today's shadow is still to do. */
export function rollDay(data: SaveData, date = today()): boolean {
  if (data.daily.date !== date) data.daily = { date, done: false };
  return !data.daily.done;
}

export function completeDaily(data: SaveData, date = today()): void {
  data.daily = { date, done: true };
  const gap = data.streak.last ? dayNumber(date) - dayNumber(data.streak.last) : 0;
  if (data.streak.last === date) return;
  data.streak = { count: gap === 1 ? data.streak.count + 1 : 1, last: date };
}

export function metCount(data: SaveData): number {
  return Object.keys(data.met).length;
}

/** Shapes you can be asked for: the ones you've met plus the next undiscovered one. */
export function unlockedCount(data: SaveData): number {
  let n = 0;
  while (n < SILHOUETTES.length && data.met[SILHOUETTES[n].id]) n++;
  return Math.min(SILHOUETTES.length, n + 1);
}
