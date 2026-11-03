import type { CaughtFish } from './fishdata';
import type { UpgSave } from './progression/gear';

const KEY = 'salish-sea-save-v1';

export interface SaveData {
  shells: number;
  cooler: CaughtFish[];
  coolerCap: number;
  /** best size + stars per species id (journal records) */
  records: Record<string, { size: number; stars: number; count: number }>;
  seenReveal: boolean;
  reachedLanding: boolean;
  settings: {
    quality: 'high' | 'low'; autoReel: boolean; showFps: boolean; tod: string | null;
    /** player volumes 0..1 (0 = off): Music, and Sound (effects + ambience + UI) */
    music: number; sound: number;
  };
  boat?: { x: number; z: number; yaw: number; moored: boolean };
  /** which world the saved boat position belongs to */
  worldTag?: string;
  /** set while the player is on foot (boat tied up); position of the feet */
  onfoot?: { x: number; y: number; z: number; yaw: number } | null;
  /** gear tiers, boats, paint, flags (game/progression/gear.ts ensureUpg fills defaults) */
  upg?: UpgSave;
  /** flotsam picked up: id → game day collected (-1 = for good, e.g. read bottles) */
  flotsam?: Record<string, number>;
  /** tide pools: critter id → times seen (src/game/tidepools.ts) */
  tidepools?: Record<string, number>;
  /** days passed on the game clock (sets each day's sea mist) */
  day?: number;
  /** game clock, hours 0..24 (game/clock.ts) */
  clock?: number;
}

export function defaultSave(): SaveData {
  return {
    shells: 0,
    cooler: [],
    coolerCap: 2, // cedar canoe
    records: {},
    seenReveal: false,
    reachedLanding: false,
    settings: { quality: 'high', autoReel: false, showFps: false, tod: null, music: 0.7, sound: 1 },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw);
    const def = defaultSave();
    const settings = { ...def.settings, ...(d.settings ?? {}) };
    // migration (pre-audio saves): the old UI "Sound" switch lived in the UI prefs
    if (typeof d.settings?.sound !== 'number') settings.sound = legacySoundOff() ? 0 : def.settings.sound;
    if (typeof d.settings?.music !== 'number') settings.music = legacySoundOff() ? 0 : def.settings.music;
    settings.music = clamp01(settings.music); settings.sound = clamp01(settings.sound);
    return { ...def, ...d, settings };
  } catch {
    return defaultSave();
  }
}

export function writeSave(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const clamp01 = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);
function legacySoundOff() {
  try { return JSON.parse(localStorage.getItem('salish-sea-ui-v1') ?? '{}').sound === false; } catch { return false; }
}
