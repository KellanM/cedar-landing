import * as THREE from 'three';
import type { Boat } from './boat';
import type { CameraShot } from '../world/types';

const BACK = 8, UP = 4;
/** Portrait phones get a wider vertical FOV so the horizon still has room. */
const baseFov = (aspect: number) => (aspect < 1 ? 68 : 55);

/** Third-person chase that eases behind/above the boat, with drag-orbit and a scripted shot mode. */
export class ChaseCamera {
  yaw = 0;
  orbit = 0;
  pitch = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shot: { s: CameraShot; t: number; dur: number } | null = null;
  private tmp = new THREE.Vector3();

  constructor(public cam: THREE.PerspectiveCamera) {}

  snap(boat: Boat) {
    this.yaw = boat.yaw;
    this.orbit = 0;
    this.desired(boat, this.pos, this.look);
    this.apply();
  }

  get inShot() { return !!this.shot; }

  playShot(s: CameraShot, dur = 4.5) { this.shot = { s, t: 0, dur }; }
  skipShot() { this.shot = null; }

  private desired(boat: Boat, pos: THREE.Vector3, look: THREE.Vector3) {
    const a = this.yaw + this.orbit;
    const fx = -Math.sin(a), fz = -Math.cos(a);
    const up = UP + this.pitch * 4;
    pos.set(boat.pos.x - fx * BACK, up, boat.pos.z - fz * BACK);
    look.set(boat.pos.x + fx * 3, 0.9, boat.pos.z + fz * 3);
  }

  update(dt: number, boat: Boat, orbitDelta: { x: number; y: number }, lastOrbit: number) {
    // Ease yaw toward the boat heading (shortest arc). Slower when nearly stopped so the
    // camera doesn't swing while fishing.
    let d = boat.yaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const follow = 0.6 + 1.6 * Math.min(1, Math.abs(boat.speed) / 2);
    this.yaw += d * Math.min(1, dt * follow);

    this.orbit -= orbitDelta.x;
    this.pitch = Math.max(-0.5, Math.min(1.5, this.pitch + orbitDelta.y));
    // Drift orbit back behind the boat 2.5 s after the user lets go, if moving.
    if (performance.now() - lastOrbit > 2500 && Math.abs(boat.speed) > 0.3) {
      this.orbit = Math.atan2(Math.sin(this.orbit), Math.cos(this.orbit));
      this.orbit *= Math.exp(-dt * 0.8);
      this.pitch *= Math.exp(-dt * 0.8);
    }

    const dp = this.tmp;
    this.desired(boat, dp, this.look);
    this.pos.lerp(dp, 1 - Math.exp(-dt * 4));

    if (this.shot) {
      const sh = this.shot;
      sh.t += dt;
      const hold = sh.dur * 0.35;
      const k = sh.t < hold ? 0 : THREE.MathUtils.smoothstep((sh.t - hold) / (sh.dur - hold), 0, 1);
      const sp = new THREE.Vector3(...sh.s.pos), st = new THREE.Vector3(...sh.s.target);
      // slow push-in during the hold
      sp.lerp(st, Math.min(sh.t, hold) / hold * 0.08);
      this.cam.position.copy(sp).lerp(this.pos, k);
      const lk = st.clone().lerp(this.look, k);
      this.cam.fov = THREE.MathUtils.lerp(sh.s.fov ?? baseFov(this.cam.aspect), baseFov(this.cam.aspect), k);
      this.cam.updateProjectionMatrix();
      this.cam.lookAt(lk);
      if (sh.t >= sh.dur) this.shot = null;
      return;
    }
    this.apply();
  }

  private apply() {
    this.cam.position.copy(this.pos);
    const f = baseFov(this.cam.aspect);
    if (this.cam.fov !== f) { this.cam.fov = f; this.cam.updateProjectionMatrix(); }
    this.cam.lookAt(this.look);
  }
}
