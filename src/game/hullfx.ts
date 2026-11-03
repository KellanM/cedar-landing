import { SWELL, waterHeight } from './swell';
import type { Boat } from './boat';
import type { HullSplash } from '../render/hullsplash';

/**
 * Hull splash director (ocean pass 3, docs/ocean_study.md "Pass 3"): turns the hull's motion on the
 * swell into Wind Waker-style splashes.
 *  - landing: the boat really leaves the water over a sharp crest (swell.ts Buoyancy: the water
 *    can't pull her down faster than gravity); on touchdown, the downward speed sets the size of
 *    everything: puffs along both sides, two crown sheets, droplet arcs, a foam ring, a whoosh +
 *    thump, haptics, a camera bump (Reduce motion: none; never a roll);
 *  - bow slam: the bow buries itself in a rising face (Buoyancy.slam): a smaller forward burst;
 *  - at speed: puffs churn at the bow, more in a big sea; calm water keeps it small.
 * The Packer (T1) lands heavier: wider, lower crowns, slower droplets, a deeper thump.
 */

export interface HullFxHost {
  boat: () => Boat;
  fx: HullSplash;
  active: () => boolean;
  sound: (k: number, heavy: boolean) => void;
  haptic: (ms: number[]) => void;
  bump: (t: number) => void;
}

export class HullFX {
  /** debug: last landing (impact m/s, k) */
  last = { impact: 0, k: 0, kind: '' };
  landings = 0;
  slams = 0;
  private bowAcc = 0;
  /** ms per frame (EMA) */
  cost = 0;

  constructor(private h: HullFxHost) {}

  update(dt: number) {
    const t0 = performance.now();
    const boat = this.h.boat();
    if (!boat || !SWELL.on || !this.h.active()) { this.bowAcc = 0; return; }
    const b = boat.buoyancy;
    const heavy = boat.steady;
    // calm water keeps it small
    const sea = Math.min(1, Math.max(0.35, SWELL.state / 6));
    if (b.impact > 0) {
      const k = Math.min(1, Math.max(0, (b.impact - 0.45) / 3));
      this.landing(boat, k, sea, heavy);
      this.last = { impact: +b.impact.toFixed(2), k: +k.toFixed(2), kind: 'landing' };
      this.landings++;
    } else if (b.slam > 0) {
      const k = Math.min(1, b.slam / 0.9) * 0.7;
      this.bowSlam(boat, k, sea, heavy);
      this.last = { impact: +b.slam.toFixed(2), k: +k.toFixed(2), kind: 'slam' };
      this.slams++;
    }
    this.bowSpray(dt, boat, sea);
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }

  /** Touchdown after a hop: k 0..1 from the impact speed. */
  landing(boat: Boat, k: number, sea: number, heavy: boolean) {
    const fx = this.h.fx, q = fx.scale;
    const f = { x: -Math.sin(boat.yaw), z: -Math.cos(boat.yaw) }, r = { x: -f.z, z: f.x };
    const L = boat.halfLen, B = boat.halfBeam;
    const px = boat.pos.x, pz = boat.pos.z, wy = waterHeight(px, pz);
    const size = sea * (0.75 + 0.6 * k);
    const up = heavy ? 0.65 : 1, wide = heavy ? 1.35 : 1;
    // puffs along both sides at the waterline, flung out and back
    const nP = Math.round((6 + 18 * k) * q * (0.5 + 0.5 * sea));
    for (let i = 0; i < nP; i++) {
      const side = i % 2 ? 1 : -1, along = (Math.random() * 1.6 - 0.8) * L;
      const out = 1 + 2.4 * Math.random() * (0.5 + k) * wide;
      const x = px + f.x * along + r.x * side * (B + 0.1), z = pz + f.z * along + r.z * side * (B + 0.1);
      fx.emit(0, x, wy + 0.15 + Math.random() * 0.3, z, r.x * side * out - f.x * 0.6, (0.8 + 1.8 * Math.random()) * up * (0.5 + k), r.z * side * out - f.z * 0.6, (0.28 + 0.36 * Math.random()) * size, 0.32 + 0.3 * Math.random());
    }
    // two crown sheets, splayed out from the hull, left where the water was hit
    if (k > 0.08 || sea > 0.6) {
      for (const side of [-1, 1]) {
        const x = px + r.x * side * (B + 0.25 * wide), z = pz + r.z * side * (B + 0.25 * wide);
        const yaw = Math.atan2(f.z, f.x) + side * 0.35;
        fx.emit(2, x, wy, z, 0, 0, 0, (0.5 + 1.4 * k) * up * sea, 0.5 + 0.15 * k, { yaw, aspect: (0.9 + 0.5 * k) * wide * Math.max(0.8, L / 2.6) });
      }
    }
    // droplets on arcs (dimples where they land)
    const nD = Math.round((4 + 14 * k) * q * sea);
    for (let i = 0; i < nD; i++) {
      const side = Math.random() < 0.5 ? -1 : 1, along = (Math.random() * 1.4 - 0.7) * L;
      const sp = (1.5 + 2.5 * Math.random()) * (0.6 + 0.8 * k) * wide;
      fx.emit(1, px + f.x * along + r.x * side * B, wy + 0.3, pz + f.z * along + r.z * side * B, r.x * side * sp, (2.2 + 3 * Math.random()) * up * (0.6 + 0.7 * k), r.z * side * sp, 0.05 + 0.05 * Math.random(), 1.6);
    }
    // the foam ring spreading from the hull
    fx.emit(4, px, wy, pz, 0, 0, 0, L * (1.1 + 1.1 * k) * wide, 0.9 + 0.5 * k, { yaw: Math.random() * 6.28 });
    this.h.sound(k * sea + 0.1, heavy);
    this.h.haptic([Math.round((heavy ? 25 : 15) + 50 * k)]);
    this.h.bump(0.06 + 0.24 * k * sea);
  }

  /** The bow buries itself in a rising face: a forward burst (no crown pair, a short bump). */
  bowSlam(boat: Boat, k: number, sea: number, heavy: boolean) {
    const fx = this.h.fx, q = fx.scale;
    const f = { x: -Math.sin(boat.yaw), z: -Math.cos(boat.yaw) }, r = { x: -f.z, z: f.x };
    const L = boat.halfLen * 0.85;
    const bx = boat.pos.x + f.x * L, bz = boat.pos.z + f.z * L, wy = waterHeight(bx, bz);
    const up = heavy ? 0.7 : 1;
    const n = Math.round((5 + 12 * k) * q);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, out = 0.8 + 2 * Math.random();
      fx.emit(0, bx + r.x * side * 0.4, wy + 0.2 + Math.random() * 0.4, bz + r.z * side * 0.4, r.x * side * out + f.x * 0.8, (1.2 + 2.2 * Math.random()) * up, r.z * side * out + f.z * 0.8, (0.2 + 0.3 * Math.random()) * sea * (0.8 + 0.5 * k), 0.3 + 0.25 * Math.random());
    }
    const nD = Math.round((3 + 8 * k) * q);
    for (let i = 0; i < nD; i++) {
      const side = Math.random() < 0.5 ? -1 : 1, sp = 1 + 2 * Math.random();
      fx.emit(1, bx, wy + 0.4, bz, r.x * side * sp + f.x * 1.5, (3 + 3 * Math.random()) * up, r.z * side * sp + f.z * 1.5, 0.05 + 0.04 * Math.random(), 1.4);
    }
    this.h.sound(0.25 + 0.5 * k, heavy);
    this.h.haptic([Math.round(12 + 30 * k)]);
    this.h.bump(0.05 + 0.15 * k);
  }

  /** At speed: puffs churn at the bow and down the sides (Wind Waker at full sail). */
  private bowSpray(dt: number, boat: Boat, sea: number) {
    const spd = Math.abs(boat.speed), max = 7;
    const v = Math.min(1, spd / max);
    if (v < 0.25 || boat.buoyancy.air > 0.05) return;
    this.bowAcc += dt * (v - 0.2) * (3 + 22 * sea * sea) * this.h.fx.scale;
    const fx = this.h.fx;
    const f = { x: -Math.sin(boat.yaw), z: -Math.cos(boat.yaw) }, r = { x: -f.z, z: f.x };
    const L = boat.halfLen * 0.8, B = boat.halfBeam;
    while (this.bowAcc >= 1) {
      this.bowAcc -= 1;
      const side = Math.random() < 0.5 ? -1 : 1, along = L * (0.4 + 0.6 * Math.random());
      const x = boat.pos.x + f.x * along + r.x * side * B * 0.8, z = boat.pos.z + f.z * along + r.z * side * B * 0.8;
      fx.emit(0, x, waterHeight(x, z) + 0.12, z, r.x * side * (0.8 + 1.2 * v) + boat.vel.x * 0.3, 0.6 + 0.8 * Math.random() * sea, r.z * side * (0.8 + 1.2 * v) + boat.vel.y * 0.3, (0.18 + 0.26 * Math.random()) * (0.5 + 0.7 * sea) * (0.6 + 0.4 * v), 0.3 + 0.25 * Math.random());
    }
  }
}
