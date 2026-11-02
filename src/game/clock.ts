/**
 * The game clock. One game day passes in DAY_REAL_MIN real minutes; the five exported time-of-day
 * looks (fog, overcast, sunbreak, dusk, night) are keyframes on that day, and colours + lighting
 * blend between neighbours so the light drifts instead of switching. The weather of each slot is
 * fixed for now (misty dawn, grey morning, sun breaking through after noon).
 */
export const DAY_REAL_MIN = 24; // real minutes per game day (1 game hour ≈ 1 real minute)
export const START_HOUR = 10 + 40 / 60; // a new game starts at 10:40, as before

/** [hour, look] — consecutive equal looks hold; different looks cross-fade between them. */
const KEYS: [number, string][] = [
  [0, 'night'], [4.6, 'night'], [5.9, 'fog'], [7.6, 'fog'], [9.0, 'overcast'], [11.6, 'overcast'],
  [13.0, 'sunbreak'], [17.6, 'sunbreak'], [19.4, 'dusk'], [20.4, 'dusk'], [21.8, 'night'], [24, 'night'],
];
/** Where "jump to <look>" lands (debug cycle, old saves' fixed look). */
export const LOOK_HOUR: Record<string, number> = { fog: 6.67, overcast: 10.67, sunbreak: 13.33, dusk: 19.83, night: 23.17 };

const WORDS: Record<string, string> = { fog: 'Fog rolling in', overcast: 'Grey and still', sunbreak: 'Sun breaking through', dusk: 'Dusk coming on', night: 'A clear night' };

export interface ClockLook { a: string; b: string; f: number; /** the look that dominates (f < .5 → a) */ key: string }

export const wrapHour = (h: number) => ((h % 24) + 24) % 24;

/** Blend at `hour`, restricted to looks the world actually has (`have`). */
export function lookAt(hour: number, have: string[]): ClockLook {
  const h = wrapHour(hour);
  const ok = (k: string) => (have.includes(k) ? k : have.includes('overcast') ? 'overcast' : have[0]);
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [h0, k0] = KEYS[i], [h1, k1] = KEYS[i + 1];
    if (h >= h0 && h <= h1) {
      const a = ok(k0), b = ok(k1);
      const t = a === b ? 0 : (h - h0) / (h1 - h0);
      const f = t * t * (3 - 2 * t); // smoothstep
      return { a, b, f, key: f < 0.5 ? a : b };
    }
  }
  const k = ok('night');
  return { a: k, b: k, f: 0, key: k };
}

/** "HH:MM", in 10-minute steps so the HUD ticks calmly. */
export function clockText(hour: number) {
  const m = Math.floor((wrapHour(hour) * 60) / 10) * 10;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const lookWords = (key: string) => WORDS[key] ?? key;
