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
  settings: { quality: 'high' | 'low'; autoReel: boolean; showFps: boolean; tod: string | null };
  boat?: { x: number; z: number; yaw: number; moored: boolean };
  /** which world the saved boat position belongs to */
  worldTag?: string;
  /** set while the player is on foot (boat tied up); position of the feet */
  onfoot?: { x: number; y: number; z: number; yaw: number } | null;
  /** gear tiers, boats, paint, flags (game/progression/gear.ts ensureUpg fills defaults) */
  upg?: UpgSave;
}

export function defaultSave(): SaveData {
  return {
    shells: 0,
    cooler: [],
    coolerCap: 2, // cedar canoe
    records: {},
    seenReveal: false,
    reachedLanding: false,
    settings: { quality: 'high', autoReel: false, showFps: false, tod: null },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw);
    const def = defaultSave();
    return { ...def, ...d, settings: { ...def.settings, ...(d.settings ?? {}) } };
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
