// Persistent settings and best-run records. Storage failures are tolerated silently.
import type { Quality } from '../render/Renderer';

export interface Settings {
  sensitivity: number;
  fov: number;
  volume: number;
  quality: Quality;
  renderScale: number;
  reducedMotion: boolean;
  showFps: boolean;
}

export interface BestRun {
  time: number;
  kills: number;
  headshots: number;
  salvage: number;
}

const KEY = 'deadsignal.settings.v1';
const BEST = 'deadsignal.best.v1';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 78,
  volume: 0.8,
  quality: 'high',
  renderScale: 1,
  reducedMotion: false,
  showFps: false,
};

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable - ignore */
  }
}

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>(KEY) ?? {};
  const merged = { ...DEFAULT_SETTINGS, ...s };
  merged.sensitivity = clamp(Number(merged.sensitivity) || 1, 0.2, 3);
  merged.fov = clamp(Number(merged.fov) || 78, 60, 100);
  merged.volume = clamp(Number(merged.volume), 0, 1);
  merged.renderScale = clamp(Number(merged.renderScale) || 1, 0.5, 1);
  if (!['low', 'medium', 'high'].includes(merged.quality)) merged.quality = 'high';
  return merged;
}

export function saveSettings(s: Settings): void {
  write(KEY, s);
}

export function loadBest(): BestRun | null {
  return read<BestRun>(BEST);
}

/** Stores a successful run if it is the fastest so far. Returns true when it is a new record. */
export function recordBest(run: BestRun): boolean {
  const prev = loadBest();
  if (!prev || run.time < prev.time) {
    write(BEST, run);
    return true;
  }
  return false;
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, isFinite(v) ? v : a));
}
