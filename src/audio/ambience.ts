/**
 * Ambience: looping noise beds (open-water wash, wind, trees, wake) crossfaded by place, plus
 * sparse one-shot events (laps, birds, creaks, foghorn, sea-lion barks…) whose rates depend on
 * place and time of day. Bird and mammal spots come from the world data (gameplay.json), so the
 * soundscape follows the same placement as the visuals without touching their code.
 */
import type { AudioEngine } from './engine';
import { AUDIO_TUNING } from './engine';
import type { Sfx, Place } from './sfx';

export interface Zones { harbour: number; shore: number; open: number; forest: number }
export interface Spot { x: number; z: number; kind: string }

export interface AmbFrame {
  zones: Zones;
  tod: string;
  /** 0..1 boat speed fraction (0 on foot) */
  speed: number;
  onFoot: boolean;
  moored: boolean;
  /** 0..1 rain (docs/rain_study.md) */
  rain?: number;
  /** 0..1 storm */
  storm?: number;
}

type Bed = ReturnType<AudioEngine['bed']>;

export class Ambience {
  private beds: Record<'sea' | 'wind' | 'trees' | 'wake' | 'wash' | 'hiss' | 'patter' | 'roar', Bed>;
  private acc: Record<string, number> = {};
  private t = 0;
  spots: Spot[] = [];
  levels: Record<string, number> = {};

  constructor(private e: AudioEngine, private sfx: Sfx) {
    this.beds = {
      sea: e.bed('pink', 'bandpass', 520, 0.55, 'amb', 'lowpass', 1500),
      wind: e.bed('pink', 'bandpass', 600, 1.4, 'amb'),
      trees: e.bed('pink', 'highpass', 1800, 0.5, 'amb', 'lowpass', 4800),
      wake: e.bed('white', 'bandpass', 2200, 0.7, 'sfx'),
      wash: e.bed('pink', 'lowpass', 520, 0.6, 'sfx'),
      // rain: a fine high hiss (drizzle), a mid patter (steady rain on water and wood), a low roar (downpour)
      hiss: e.bed('white', 'highpass', 3800, 0.5, 'amb', 'lowpass', 9500),
      patter: e.bed('pink', 'bandpass', 1500, 0.55, 'amb', 'lowpass', 5200),
      roar: e.bed('brown', 'lowpass', 700, 0.5, 'amb', 'highpass', 140),
    };
  }

  private set(b: Bed, v: number, tc = 0.6) { b.g.gain.setTargetAtTime(Math.max(0, v), this.e.now, tc); }

  update(dt: number, f: AmbFrame) {
    const e = this.e, Z = f.zones, T = AUDIO_TUNING;
    this.t += dt;
    const t = this.t;
    const night = /night/.test(f.tod), dusk = /dusk/.test(f.tod), fog = /fog/.test(f.tod), day = !night && !dusk;
    // slow, irrational-ratio swells so the beds never sound like a loop
    const swell = (a: number, b: number) => 0.5 + 0.3 * Math.sin(t * a) + 0.2 * Math.sin(t * b + 1.3);
    const sea = (0.3 + 0.5 * Z.open + 0.15 * Z.shore) * (f.onFoot ? 0.55 : 1) * (0.75 + 0.5 * swell(0.21, 0.077));
    const gust = swell(0.13, 0.051);
    const wind = (0.1 + 0.3 * Z.open + 0.12 * Z.forest + (fog ? 0.08 : 0) + (night ? -0.03 : 0)) * (0.55 + 0.9 * gust) + 0.35 * f.speed * f.speed;
    const trees = Z.forest * (f.onFoot ? 0.9 : 0.4) * (0.5 + 0.8 * gust) * (night ? 0.6 : 1);
    this.set(this.beds.sea, sea * 0.5);
    this.set(this.beds.wind, wind * 0.32);
    this.beds.wind.f.frequency.setTargetAtTime(380 + 500 * gust + 400 * f.speed, e.now, 0.8);
    this.set(this.beds.trees, trees * 0.22);
    this.beds.trees.f.frequency.setTargetAtTime(1500 + 700 * gust, e.now, 0.8);
    // wake hiss + bow wash follow speed (on the sfx bus: it's our boat)
    const sp = f.onFoot ? 0 : f.speed;
    this.set(this.beds.wake, T.wake * 0.22 * Math.pow(sp, 1.6), 0.25);
    this.set(this.beds.wash, T.wake * 0.35 * Math.pow(sp, 1.1), 0.25);
    this.beds.wake.f.frequency.setTargetAtTime(1600 + 1400 * sp, e.now, 0.3);
    // ---- rain beds (drizzle = hiss, steady = patter, storm = roar) and the storm's wind
    const R = f.rain ?? 0, S = f.storm ?? 0;
    const hiss = Math.min(1, R / 0.35) * (0.6 + 0.4 * swell(0.31, 0.11)) * (1 - 0.35 * Math.max(0, R - 0.5));
    const patter = Math.max(0, (R - 0.28) / 0.6) * (0.8 + 0.3 * swell(0.17, 0.06));
    const roar = Math.max(0, (R - 0.6) / 0.4) * 0.5 + S * (0.6 + 0.5 * gust);
    this.set(this.beds.hiss, hiss * 0.09, 1.2);
    this.set(this.beds.patter, patter * 0.2, 1.2);
    this.set(this.beds.roar, roar * 0.22, 1.2);
    if (S > 0) this.set(this.beds.wind, (wind + S * (0.5 + 0.9 * gust * gust)) * 0.32);
    this.levels = { sea: +sea.toFixed(2), wind: +wind.toFixed(2), trees: +trees.toFixed(2), wake: +sp.toFixed(2), hiss: +hiss.toFixed(2), patter: +patter.toFixed(2), roar: +roar.toFixed(2) };

    // ---- one-shot events: rate per minute
    const still = !f.onFoot && f.speed < 0.15;
    const rates: Record<string, number> = {
      lap: (still ? 26 : f.onFoot ? 10 * (Z.harbour + Z.shore) : 6 * (1 - f.speed)) * (f.onFoot ? 1 : 1),
      gull: (5 * Z.harbour + 1.4 * Z.open + 0.6 * Z.shore) * (night ? 0.1 : fog ? 0.5 : 1),
      crow: day ? 1.2 * Math.max(Z.forest, Z.harbour * 0.6) : 0,
      songbird: day ? 4 * Z.forest * (f.onFoot ? 1 : 0.5) : 0,
      thrush: dusk ? 3 * Z.forest : day ? 0.4 * Z.forest : 0,
      owl: night ? 0.7 * Z.forest : 0,
      frog: night || dusk ? 14 * Math.max(Z.forest, Z.shore * 0.7) : 0,
      creak: 4 * Z.harbour + (f.moored && !f.onFoot ? 3 : 0),
      hammer: day ? 0.8 * Z.harbour : 0,
      buoy: (fog ? 2 : 0.6) * Z.open,
      foghorn: fog ? 1.5 : 0,
      // rain on the boat / the boardwalk roofs: ticks, and the odd fat drip off the rigging or eaves
      tick: R > 0.1 ? R * (still || f.onFoot ? 260 : 90) : 0,
      drip: R > 0.2 ? R * (still || f.onFoot ? 14 : 3) : 0,
    };
    if (R > 0.4) { rates.gull *= 0.4; rates.songbird *= 0.2; rates.crow *= 0.5; rates.hammer = 0; } // the birds keep their heads down
    for (const [k, r] of Object.entries(rates)) {
      if (r <= 0) continue;
      this.acc[k] = (this.acc[k] ?? Math.random()) - dt * r / 60;
      if (this.acc[k] > 0) continue;
      this.acc[k] = 0.4 + Math.random() * 1.2; // ≈ Poisson-ish: next event in 0.4–1.6 × mean gap
      this.fire(k, f);
    }
    // ---- data-driven spots (perched / flocking birds, haul-outs) within earshot
    for (const s of this.spots) {
      const p = e.spatial(s.x, s.z, 30, 260);
      if (!p) continue;
      const r = SPOT_RATE[s.kind]?.(night, fog) ?? 0;
      if (!r) continue;
      const key = `${s.kind}@${s.x | 0},${s.z | 0}`;
      this.acc[key] = (this.acc[key] ?? Math.random() * 2) - dt * r / 60;
      if (this.acc[key] > 0) continue;
      this.acc[key] = 0.5 + Math.random();
      this.fireSpot(s.kind, p);
    }
  }

  /**
   * Thunder (NWS: ~3 s per km; a crack means close, a rumble means miles off; it rolls because sound
   * arrives from ever farther parts of the channel). Scheduled `delay` s ahead (the flash is now).
   */
  thunder(distM: number, near: boolean, pan = 0) {
    const e = this.e, S = this.sfx;
    const at = e.now + 0.05 + distM / 343;
    S.thunder(at, distM, near, pan);
    return at - e.now;
  }

  /** a random point around the listener (for zone sounds) */
  private around(near: number, far: number): Place | null {
    const L = this.e.listener, a = Math.random() * Math.PI * 2, d = near + Math.random() * (far - near);
    return this.e.spatial(L.x + Math.cos(a) * d, L.z + Math.sin(a) * d, 25, 400);
  }

  private fire(k: string, f: AmbFrame) {
    const e = this.e, at = e.now + 0.05, S = this.sfx;
    switch (k) {
      case 'lap': {
        const still = !f.onFoot && f.speed < 0.15;
        S.lap(at, (still ? 0.16 : 0.1) * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * 0.9, still ? 0.2 : 0);
        return;
      }
      case 'tick': {
        // a raindrop on wood / canvas: a tiny filtered click, mostly overhead
        const fq = 1800 + e.rand() * 2600;
        e.burst(at, 0.025 + e.rand() * 0.02, 'bandpass', fq, fq * 0.8, (0.025 + e.rand() * 0.035) * (f.rain ?? 0.5), { bus: 'amb', pool: 'rain', q: 2.5, a: 0.002, pan: (e.rand() - 0.5) * 1.2 });
        return;
      }
      case 'drip': {
        // a fat drop: a short falling "plink"
        const f0 = 900 + e.rand() * 900;
        e.tone('sine', f0, f0 * 0.55, at, 0.05 + e.rand() * 0.03, 0.03 + e.rand() * 0.03, { bus: 'amb', pool: 'rain', pan: (e.rand() - 0.5) * 1.4, wet: 0.15 });
        return;
      }
      case 'foghorn': { const p = this.around(300, 380); if (p) S.foghorn(at, { ...p, gain: Math.max(0.5, p.gain * 6) }); return; }
      case 'buoy': { const p = this.around(80, 200); if (p) S.buoyBell(at, { ...p, gain: Math.min(1, p.gain * 3) }); return; }
      default: {
        const p = this.around(k === 'creak' ? 4 : 18, k === 'creak' ? 25 : 90);
        if (!p) return;
        const g = { ...p, gain: Math.min(1, p.gain * 2.5) };
        (S as unknown as Record<string, (at: number, p: Place) => void>)[k]?.(at, g);
      }
    }
  }

  private fireSpot(kind: string, p: Place) {
    const at = this.e.now + 0.05, S = this.sfx;
    switch (kind) {
      case 'bald_eagle': S.eagle(at, p); break;
      case 'great_blue_heron': S.heron(at, p); break;
      case 'pigeon_guillemot': S.guillemot(at, p); break;
      case 'kittiwake': S.gull(at, p, 3, 'kittiwake'); break;
      case 'gull': case 'herring_gull': S.gull(at, p); break;
      case 'sea_lion': S.bark(at, p, true); break;
      case 'harbor_seal': S.bark(at, p, false); break;
    }
  }
}

/** calls per minute for data-driven spots (null-safe on unknown kinds) */
const SPOT_RATE: Record<string, (night: boolean, fog: boolean) => number> = {
  bald_eagle: (n) => (n ? 0 : 0.8),
  great_blue_heron: (n) => (n ? 0.3 : 0.5),
  pigeon_guillemot: (n) => (n ? 0 : 1.5),
  kittiwake: (n) => (n ? 0 : 2),
  gull: (n) => (n ? 0.2 : 2.5),
  herring_gull: (n) => (n ? 0.2 : 2.5),
  sea_lion: (n) => (n ? 1 : 3),
  harbor_seal: () => 0.5,
};

// ------------------------------------------------------------------ the boat: engine putts
export class BoatAudio {
  private next = 0;
  private n = 0;
  private wasRunning = false;
  private crank = 0; // s remaining of the start-up cough
  rate = 0;
  level = 0;

  constructor(private e: AudioEngine) {}

  /** throttle −1..1, speed fraction 0..1, running = engine on (not tied up / ashore) */
  update(dt: number, throttle: number, speed: number, running: boolean, heavy: boolean) {
    const e = this.e, now = e.now, T = AUDIO_TUNING;
    if (running && !this.wasRunning) { this.crank = 0.9; e.log('sfx.engineStart'); }
    if (!running && this.wasRunning) e.log('sfx.engineStop');
    this.wasRunning = running;
    if (!running) { this.rate = 0; this.level = 0; this.next = 0; return; }
    const load = Math.min(1, Math.max(Math.abs(throttle) * 0.85, speed));
    // single cylinder: ~4.5 putts/s idle → 12/s flat out; the Packer's twin fires faster, lower
    const rate = heavy ? 6 + 11 * load : 4.4 + 8 * load;
    let gain = (0.12 + 0.42 * load) * T.engine;
    let r = rate;
    if (this.crank > 0) { r = 2.5 + (1 - this.crank) * 3; gain *= 1.1; this.crank -= dt; }
    this.rate = +r.toFixed(2); this.level = +gain.toFixed(3);
    if (this.next < now) this.next = now + 0.02;
    while (this.next < now + 0.15) {
      this.n++;
      const v = this.n % 4;
      const weak = !heavy && this.n % 2 === 0 ? 0.78 : 1; // uneven firing: the "putt-putt"
      const miss = this.crank > 0 && Math.random() < 0.25; // a cough while it catches
      if (!miss) e.play(e.puttBuf(heavy, v), this.next, { bus: 'sfx', pool: 'engine', gain: gain * weak * (0.9 + Math.random() * 0.2), rate: (heavy ? 0.85 : 1) * (0.92 + 0.22 * load) * (0.98 + Math.random() * 0.04), wet: 0.05 });
      this.next += (1 / r) * (0.96 + Math.random() * 0.08);
    }
  }
}
