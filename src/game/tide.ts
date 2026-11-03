/**
 * Tides (docs/tide_study.md). A mixed semidiurnal tide like Seattle's: six harmonic constituents
 * with Puget Sound's amplitude ratios and their real speeds, run on the game clock (one game hour =
 * one tidal hour). So the day has two highs and two lows of unequal height, each tide comes ~50 min
 * later than the day before, and spring / neap ranges swell and shrink over about two weeks.
 *
 * Levels are world y of the water surface. The world was modelled with the water at y = 0, which is
 * treated as the higher high water: the tide only ever drops below the modelled shore (it never floods
 * the village), down to LOW at the lowest spring lows.
 *
 * Everything that sits on the water reads WATER.y (sea, boat, floaters, fishing, wake, wildlife).
 * Later layers (swell, currents) can add to WATER via `rate` (m per game hour, + rising) and the
 * same clock.
 */

/** [amplitude ft (NOAA Seattle 9447130, rounded), speed deg / hour, phase deg (tuned so day 0 has an early-afternoon low)] */
const CONST: [number, number, number][] = [
  [3.51, 28.984104, 0], // M2 principal lunar semidiurnal
  [0.86, 30.0, 0], // S2 principal solar semidiurnal
  [0.69, 28.43973, 0], // N2 larger lunar elliptic
  [2.76, 15.041069, 0], // K1 lunisolar diurnal
  [1.5, 13.943035, 0], // O1 principal lunar diurnal
  [0.85, 14.958931, 0], // P1 principal solar diurnal
];
/** Phases (deg), Greenwich-style lags picked so day 0 opens on a falling tide with a good low after lunch. */
const PHASE = [118, 146, 92, 345, 326, 342];
/** Game hours the tide clock runs behind the game clock (puts day 0's big low at ~15:30, under the afternoon sun). */
const T0 = -5;

/** World y of the highest high water / lowest low water over the cycle. */
export const TIDE_RANGE = { high: 0.04, low: -1.72 };

const D2R = Math.PI / 180;
function raw(t: number) {
  let s = 0;
  for (let i = 0; i < CONST.length; i++) s += CONST[i][0] * Math.cos((CONST[i][1] * t - PHASE[i]) * D2R);
  return s;
}
// normalise over a long run so the extremes land on TIDE_RANGE
let rmin = Infinity, rmax = -Infinity;
for (let t = 0; t < 24 * 120; t += 0.25) { const r = raw(t); if (r < rmin) rmin = r; if (r > rmax) rmax = r; }
const K = (TIDE_RANGE.high - TIDE_RANGE.low) / (rmax - rmin);

/** Water level (world y) at game hour `h` of game day `day`. */
export function tideAt(h: number, day = 0) {
  const t = day * 24 + h + T0;
  return TIDE_RANGE.low + (raw(t) - rmin) * K;
}
/** m per game hour (+ rising). */
export function tideRate(h: number, day = 0) { return (tideAt(h + 0.05, day) - tideAt(h - 0.05, day)) / 0.1; }

/** The shared water surface. `y` is read every frame by everything that floats. */
export const WATER = { y: 0, rate: 0, pinned: null as number | null };

export function updateTide(h: number, day: number) {
  WATER.rate = tideRate(h, day);
  WATER.y = WATER.pinned ?? tideAt(h, day);
}

export interface TideTurn { kind: 'high' | 'low'; hour: number; level: number }
/** Today's highs and lows (game hours 0..24), in order. */
export function tideTurns(day: number): TideTurn[] {
  const out: TideTurn[] = [];
  const step = 0.1;
  let prev = tideRate(-step, day);
  for (let h = 0; h < 24; h += step) {
    const r = tideRate(h, day);
    if (prev > 0 && r <= 0) out.push(refine(day, Math.max(0, h - step), h, "high"));
    else if (prev < 0 && r >= 0) out.push(refine(day, Math.max(0, h - step), h, "low"));
    prev = r;
  }
  return out;
}
function refine(day: number, a: number, b: number, kind: 'high' | 'low'): TideTurn {
  for (let i = 0; i < 20; i++) { const m = (a + b) / 2; if ((tideRate(m, day) > 0) === (kind === 'high')) a = m; else b = m; }
  const hour = (a + b) / 2;
  return { kind, hour, level: tideAt(hour, day) };
}

/**
 * Tide-table height: metres above chart datum (the lowest low, as on a real table), from world y.
 * World y 0 (the modelled waterline, higher high water) reads ~1.7–1.8 m.
 */
export const chartHeight = (y: number) => y - TIDE_RANGE.low;

/** Spring / neap: 0 = neap, 1 = spring, from today's range. */
export function springness(day: number) {
  const t = tideTurns(day);
  if (!t.length) return 0.5;
  const hi = Math.max(...t.map((x) => x.level)), lo = Math.min(...t.map((x) => x.level));
  return Math.min(1, Math.max(0, ((hi - lo) / (TIDE_RANGE.high - TIDE_RANGE.low) - 0.45) / 0.5));
}
