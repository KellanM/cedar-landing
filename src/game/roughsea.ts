import * as THREE from 'three';
import { SWELL, swellEval, swellExposure, swellSlope, waterHeight } from './swell';
import type { Boat } from './boat';
import type { SprayFX } from '../render/spray';

/**
 * Rough seas (ocean pass 2, docs/ocean_study.md): what sea state 7–10 does to the player, cozy-safe
 * and fully reversible (nothing is lost; it all eases off with the sea or in shelter).
 *  - the waves shove the boat downslope and downwind, and slams kick her heading;
 *  - bow slams throw spray over the deck (+ a crash, a little camera shake if motion is allowed);
 *  - breaking crests throw spray, and spindrift streams off them in the dangerous band;
 *  - the hull creaks; the HUD warns "Rough seas — head for shelter"; casting waits for calmer water.
 * Shelter (the shore field: lee of islands, the harbour, shallows) takes the danger away.
 */

export interface RoughHost {
  boat: () => Boat;
  spray: SprayFX | null;
  camera: THREE.Camera;
  active: () => boolean; // at the helm (not on foot, not in a cut-scene, not moored)
  toast: (msg: string) => void;
  crash: (gain: number) => void;
  creak: () => void;
  shake: (t: number) => void;
  wind: () => THREE.Vector2;
}

const tmpS = new THREE.Vector2();
const ev = { h: 0, foam: 0 };

export class RoughSea {
  /** 0 sheltered … 1 open water, at the boat (eased) */
  exposure = 1;
  /** 0..1: SWELL.danger × exposure */
  danger = 0;
  private warnT = 0;
  private warned = false;
  private creakT = 3;
  private sprayAcc = 0;
  /** ms spent per frame (EMA) */
  cost = 0;

  constructor(private h: RoughHost) {}

  /** Casting waits for calmer water above this. */
  get tooRough() { return SWELL.on && this.danger > 0.3; }

  update(dt: number) {
    const t0 = performance.now();
    const h = this.h;
    if (!SWELL.on) { this.danger = 0; return; }
    const boat = h.boat();
    const ex = swellExposure(boat.pos.x, boat.pos.z);
    this.exposure += (ex - this.exposure) * Math.min(1, dt * 1.5);
    this.danger = SWELL.danger * this.exposure;
    const d = this.danger, active = h.active();

    if (active && d > 0.01) {
      // shove: down the local slope (the wave carries her) and downwind
      swellSlope(boat.pos.x, boat.pos.z, 1.2, tmpS);
      const w = h.wind();
      boat.push.x += (-tmpS.x * 9.8 * 0.5 + w.x * 0.8) * d * dt;
      boat.push.y += (-tmpS.y * 9.8 * 0.5 + w.y * 0.8) * d * dt;
      const pl = boat.push.length();
      if (pl > 3.5) boat.push.multiplyScalar(3.5 / pl);
    }

    // bow slams: spray over the deck, a crash, a kick to the heading
    const b = boat.buoyancy;
    if (active && b.slam > 0 && SWELL.state > 4) {
      const fx = -Math.sin(boat.yaw), fz = -Math.cos(boat.yaw);
      const L = boat.halfLen * 0.85, k = Math.min(1, b.slam / 0.8);
      const bx = boat.pos.x + fx * L, bz = boat.pos.z + fz * L, by = waterHeight(bx, bz) + 0.3;
      // the splash, its sound and the camera bump are the hull FX's (src/game/hullfx.ts, pass 3); here:
      // the flecks of green water over the deck in a dangerous sea, a crash, and the kick to the heading
      if (d > 0.4 && k > 0.5) h.spray?.burst(boat.pos.x, by + 1.2, boat.pos.z, -fx * 3, 1.5, -fz * 3, Math.round(16 * d), 2.5, 0.16, 1, 0.8); // green water over the deck
      if (d > 0.3) h.crash(0.35 + 0.65 * k * d);
      boat.yawKick += (Math.random() - 0.5) * 1.2 * d;
    }

    // breaking crests and spindrift, near the camera
    const sp = h.spray;
    if (sp?.enabled && SWELL.state > 3.5) {
      const w = h.wind();
      this.sprayAcc += dt * (10 + 90 * SWELL.danger + 10 * Math.min(1, (SWELL.state - 3.5) / 3)); // candidates; most miss the whitecaps
      const cx = boat.pos.x, cz = boat.pos.z;
      while (this.sprayAcc >= 1) {
        this.sprayAcc -= 1;
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 45;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        swellEval(x, z, ev);
        if (ev.foam < 0.05) continue;
        const y = waterHeight(x, z) + 0.15;
        sp.burst(x, y, z, w.x * 2.5, 2 + 2.5 * SWELL.danger, w.y * 2.5, 3 + Math.round(5 * SWELL.danger), 1.6, 0.13 + 0.06 * SWELL.danger, 1, 0.9);
        if (SWELL.danger > 0.2) sp.burst(x, y + 0.3, z, w.x * 9, 0.6, w.y * 9, 3, 1.5, 0.09, 0.12, 1.5); // spindrift
      }
    }

    // creaks, warnings
    if (active && d > 0.2) {
      this.creakT -= dt * (0.5 + d);
      if (this.creakT <= 0) { this.creakT = 3 + Math.random() * 4; h.creak(); }
    }
    this.warnT -= dt;
    if (active && d > 0.3 && this.warnT <= 0) { this.warnT = 25; this.warned = true; h.toast('Rough seas — head for shelter'); }
    else if (this.warned && d < 0.1 && SWELL.danger > 0.3 && active) { this.warned = false; this.warnT = 6; h.toast('Calmer water in the lee'); }
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }
}
