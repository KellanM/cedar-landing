/**
 * UI-owned persistence. Kept out of game/save.ts on purpose: UI preferences and logbook extras
 * (first-caught dates, perfect reels, found pages, visited places, the map's sight mask) live in
 * their own localStorage keys so the game save format does not change.
 */
export type Units = 'words' | 'fathoms' | 'metres';
export interface UIPrefs {
  textScale: 1 | 1.15 | 1.3;
  reduceMotion: boolean;
  vibration: boolean;
  sound: boolean;
  tensionHC: boolean;
  units: Units;
  leftHanded: boolean;
  /** camera re-centre after a drag, s (0 = off) */
  recentre: number;
}

export interface LogData {
  /** speciesId → ISO date of first catch */
  first: Record<string, string>;
  /** speciesId → landed with a perfect reel at least once */
  perfect: Record<string, boolean>;
  /** logbook page numbers found (sunstones) */
  pages: number[];
  /** visited named places (by key) */
  places: string[];
  sold: number;
  tiedUp: boolean;
  /** errands already shown as struck through */
  struck: string[];
  /** map compass destination (place key) */
  dest: string | null;
  /** recent canoe path (x,z pairs, metres) */
  path: number[];
  /** pinned errand id (stays as a chip while sailing) */
  pinned: string | null;
  /** what the player had seen at the last Log open (the Log button's "n new" badge) */
  seen: { opened: boolean; struck: number; pages: number; species: number };
}

const PREF_KEY = 'salish-sea-ui-v1';
const LOG_KEY = 'salish-sea-log-v1';
const MASK_KEY = 'salish-sea-map-v1';
const HINT_KEY = 'seenHints';

const defPrefs = (): UIPrefs => ({
  textScale: 1, reduceMotion: false, vibration: true, sound: true, tensionHC: false, units: 'words', leftHanded: false, recentre: 4,
});
const defLog = (): LogData => ({ first: {}, perfect: {}, pages: [], places: [], sold: 0, tiedUp: false, struck: [], dest: null, path: [], pinned: null, seen: { opened: false, struck: 0, pages: 0, species: 0 } });

function read<T>(k: string, def: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch { return def; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* private mode */ }
}

export const prefs: UIPrefs = read(PREF_KEY, defPrefs());
export const log: LogData = read(LOG_KEY, defLog());
export const savePrefs = () => write(PREF_KEY, prefs);
export const saveLog = () => write(LOG_KEY, log);

export function loadMask(): string | null {
  try { return localStorage.getItem(MASK_KEY); } catch { return null; }
}
export const saveMask = (b64: string) => write(MASK_KEY, b64);

export function seenHints(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HINT_KEY) || '[]')); } catch { return new Set(); }
}
export const saveHints = (s: Set<string>) => write(HINT_KEY, JSON.stringify([...s]));

/** Wipe UI-owned progress (Settings → Reset). Preferences survive. */
export function resetUIProgress() {
  try { [LOG_KEY, MASK_KEY, HINT_KEY].forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}

export const debugMode = new URLSearchParams(location.search).has('debug');
