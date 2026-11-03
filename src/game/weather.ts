/**
 * Weather on top of the clock (docs/rain_study.md). Nothing is saved: every day's weather is rolled
 * from the day counter (save.day), like the mist, so it is the same on every reload.
 *
 * A day can have:
 *  - a main rain spell (more likely on misty days): drizzle or steady rain, in the morning, the
 *    evening or overnight, never across the clear sunbreak afternoon. It sets in over ~1 game hour,
 *    breathes a little, and clears over ~1 game hour;
 *  - a passing shower in the sunbreak afternoon (short, light);
 *  - rarely, a storm (afternoon / evening): steady rain builds, thunder and lightning for 1-2 game
 *    hours, then it clears. Never two storm days running; none on the first two days.
 * One game hour is one real minute, so a spell lasts a few real minutes and a storm about five.
 */
import { dayMist } from './clock';

export const WEATHER_TUNE = {
  rainChance: 0.3, // base chance of a main rain spell (+ mistiness × rainMist)
  rainMist: 0.45,
  showerChance: 0.25, // passing shower in the sunbreak afternoon
  stormChance: 0.2, // storm days (minus the day-after rule): ≈ 1 day in 6
  heavyShare: 0.4, // share of main spells that are steady rain rather than drizzle
};

export interface WeatherNow {
  /** 0..1 rain intensity: ~0.3 drizzle, ~0.7 steady rain, 1 storm */
  rain: number;
  /** 0..1 storm (lightning, gusts) */
  storm: number;
  /** +1 building, -1 clearing, 0 holding */
  trend: number;
  /** this spell is a passing shower */
  shower: boolean;
}

interface Spell { start: number; dur: number; peak: number; ramp: number; storm: boolean; shower: boolean }

const fr = (x: number) => x - Math.floor(x);
const rnd = (day: number, k: number) => fr(Math.sin(day * 127.1 + k * 311.7 + 74.7) * 43758.5453);
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const stormRoll = (d: number) => d >= 2 && rnd(d, 9) < WEATHER_TUNE.stormChance;
export const isStormDay = (d: number) => stormRoll(d) && !stormRoll(d - 1);

const cache = new Map<number, Spell[]>();
function spells(day: number): Spell[] {
  const d = Math.floor(day);
  const hit = cache.get(d);
  if (hit) return hit;
  const out: Spell[] = [];
  if (d >= 1) { // day 0 stays dry: the first impression is the harbour in the light
    const m = dayMist(d); // 0.05..0.95
    if (isStormDay(d)) {
      out.push({ start: 14 + rnd(d, 1) * 5.5, dur: 4.6 + rnd(d, 2) * 1.2, peak: 1, ramp: 1.1, storm: true, shower: false });
    } else if (rnd(d, 3) < WEATHER_TUNE.rainChance + WEATHER_TUNE.rainMist * m) {
      const w = rnd(d, 4);
      // morning (ends before the sunbreak), evening, or overnight (may run past midnight)
      const start = w < 0.45 ? 5.5 + rnd(d, 5) * 4.5 : w < 0.85 ? 17.6 + rnd(d, 5) * 4.4 : 0.5 + rnd(d, 5) * 3.5;
      let dur = 2 + rnd(d, 6) * 3;
      if (w < 0.45) dur = Math.min(dur, 13.2 - start);
      const heavy = rnd(d, 7) < WEATHER_TUNE.heavyShare + 0.3 * m;
      out.push({ start, dur, peak: heavy ? 0.62 + 0.2 * rnd(d, 8) : 0.3 + 0.14 * rnd(d, 8), ramp: Math.min(1.2, dur * 0.35), storm: false, shower: false });
    }
    if (rnd(d, 11) < WEATHER_TUNE.showerChance) {
      const dur = 0.6 + rnd(d, 12) * 0.6;
      out.push({ start: 13.4 + rnd(d, 13) * 3.4, dur, peak: 0.35 + 0.25 * rnd(d, 14), ramp: dur * 0.4, storm: false, shower: true });
    }
  }
  if (cache.size > 64) cache.clear();
  cache.set(d, out);
  return out;
}

function at(day: number, hour: number) {
  const T = day * 24 + hour;
  let rain = 0, storm = 0, shower = false;
  for (const d of [Math.floor(day) - 1, Math.floor(day)]) {
    for (const s of spells(d)) {
      const t = T - (d * 24 + s.start);
      if (t <= 0 || t >= s.dur) continue;
      const env = ss(0, s.ramp, t) * (1 - ss(s.dur - s.ramp, s.dur, t));
      const breathe = s.storm ? 1 : 0.88 + 0.12 * Math.sin(T * 2.3 + s.start);
      const r = s.peak * env * breathe;
      if (r > rain) { rain = r; shower = s.shower; }
      // storm: the rain sets in first, the storm builds over the next hour, peaks, eases before the rain clears
      if (s.storm) storm = Math.max(storm, ss(s.ramp * 0.8, s.ramp + 1, t) * (1 - ss(s.dur - 1.7, s.dur - 0.7, t)));
    }
  }
  return { rain, storm, shower };
}

export function weatherAt(hour: number, day: number): WeatherNow {
  const now = at(day, hour);
  const ahead = at(day, hour + 0.35);
  const dv = ahead.rain - now.rain + (ahead.storm - now.storm);
  return { ...now, trend: dv > 0.03 ? 1 : dv < -0.03 ? -1 : 0 };
}

/** HUD words for the weather, or null when it is dry enough to use the time-of-day words. */
export function weatherWords(w: WeatherNow): string | null {
  if (w.storm > 0.5) return w.trend < 0 ? 'Storm passing' : 'Thunderstorm';
  if (w.storm > 0.08) return w.trend < 0 ? 'Storm passing' : 'Storm brewing';
  if (w.rain < 0.08) return null;
  if (w.trend < 0 && w.rain < 0.45) return 'Clearing';
  if (w.trend > 0 && w.rain < 0.4) return w.shower ? 'A shower coming' : 'Rain setting in';
  if (w.shower) return 'Passing shower';
  return w.rain > 0.52 ? 'Steady rain' : 'Drizzle';
}

/** The HUD key (icon / NPC context) for the weather, or null. */
export function weatherKey(w: WeatherNow): 'storm' | 'rain' | 'drizzle' | null {
  if (w.storm > 0.3) return 'storm';
  if (w.rain > 0.52) return 'rain';
  if (w.rain > 0.15) return 'drizzle';
  return null;
}

/** Simulation for the report / tests: share of days with rain, storms, hours of rain per day. */
export function weatherStats(days = 400) {
  let rainDays = 0, stormDays = 0, showerDays = 0, wetHours = 0, sunbreakWet = 0, consecutiveStorms = 0;
  for (let d = 0; d < days; d++) {
    let wet = false;
    for (let h = 0; h < 24; h += 0.25) {
      const w = weatherAt(h, d);
      if (w.rain > 0.15) { wet = true; wetHours += 0.25; if (h >= 13.5 && h <= 17.5 && !w.shower) sunbreakWet += 0.25; }
    }
    if (wet) rainDays++;
    if (isStormDay(d)) { stormDays++; if (isStormDay(d - 1)) consecutiveStorms++; }
    if (spells(d).some((s) => s.shower)) showerDays++;
  }
  return { days, rainDays, stormDays, showerDays, wetHoursPerDay: +(wetHours / days).toFixed(2), sunbreakWet, consecutiveStorms };
}
