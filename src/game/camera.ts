import * as THREE from 'three';
import { BOAT_TUNING, type Boat } from './boat';
import type { CameraShot } from '../world/types';
import type { LandCollision } from './collision';

/** Three-quarter cozy camera (Sneaky Sasquatch-like). Edited live by the ?tune overlay. */
export const CAMERA_TUNING = {
  distance: 14.5, // m from the boat at rest
  distSpeed: 2, // extra m at full speed
  pitchDeg: 41, // looking down at the boat
  sideDeg: 30, // offset from straight-behind, toward starboard (+) / port (−)
  frameAhead: 2, // m the aim point sits ahead of the boat → boat sits below frame centre
  followSlow: 0.3, // 1/s heading re-align when going straight (lazy)
  followTurn: 0.6, // 1/s re-align once turning persistently (≈ 1.7 s lag)
  turnPersist: 0.6, // s of continuous turning before the faster re-align kicks in
  idleReturn: 3, // s after a drag before easing back to the 3/4 default
  fovPortrait: 62,
  fovLandscape: 44,
  fishZoom: 0.8, // distance factor while fishing
  minDistance: 0.72, // occlusion push-in limit (fraction of the normal distance)
};

const D2R = Math.PI / 180;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Elevated three-quarter follow camera with lazy heading follow, drag-orbit that eases back,
 * speed-based pull-back / look-ahead / FOV boost, land push-in, and a scripted shot mode that
 * blends into the follow view.
 */
export class ChaseCamera {
  yaw = 0; // lazily follows the boat heading
  orbit = 0; // user drag (rad)
  pitch = 0; // user drag (rad, added to pitchDeg)
  /** While fishing: the bobber, so the frame holds boat + bobber. */
  focus: THREE.Vector3 | null = null;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shot: { s: CameraShot; t: number; dur: number } | null = null;
  private tmp = new THREE.Vector3();
  private tmpL = new THREE.Vector3();
  private sp = new THREE.Vector3();
  private st = new THREE.Vector3();
  private speedK = 0;
  private turnT = 0;
  private dist = CAMERA_TUNING.distance;
  private fishK = 0;

  constructor(public cam: THREE.PerspectiveCamera) {}

  private baseFov() { return this.cam.aspect < 1 ? CAMERA_TUNING.fovPortrait : CAMERA_TUNING.fovLandscape; }

  snap(boat: Boat) {
    this.yaw = boat.yaw;
    this.orbit = 0;
    this.pitch = 0;
    this.turnT = 0;
    this.dist = CAMERA_TUNING.distance * Math.max(1, boat.halfLen / 2.6);
    this.desired(boat, this.pos, this.look, null);
    this.apply();
  }

  get inShot() { return !!this.shot; }

  playShot(s: CameraShot, dur = 4.5) { this.shot = { s, t: 0, dur }; }
  skipShot() { this.shot = null; }

  private desired(boat: Boat, pos: THREE.Vector3, look: THREE.Vector3, land: LandCollision | null) {
    const C = CAMERA_TUNING, k = this.speedK;
    // aim point: ahead of the boat along its heading (look-ahead grows with speed), or between boat and bobber
    // frame bias along the (stable, lazy) camera heading + a speed look-ahead along the actual velocity
    const cfx = -Math.sin(this.yaw), cfz = -Math.cos(this.yaw);
    const la = BOAT_TUNING.camLookAhead * 0.5 / BOAT_TUNING.maxSpeed; // m per m/s
    look.set(boat.pos.x + cfx * C.frameAhead + boat.vel.x * la, 0.4, boat.pos.z + cfz * C.frameAhead + boat.vel.y * la);
    if (this.focus) look.lerp(this.tmpL.set(this.focus.x, 0.4, this.focus.z), 0.5 * this.fishK);
    const a = this.yaw + C.sideDeg * D2R + this.orbit;
    const pitch = Math.max(15 * D2R, Math.min(75 * D2R, C.pitchDeg * D2R + this.pitch));
    // bigger boats (the 6.4 m troller) get a proportionally wider frame; portrait screens a bit more
    const size = Math.max(1, boat.halfLen / 2.6) * (this.cam.aspect < 1 ? 1.08 : 1);
    let dist = (C.distance * size + k * C.distSpeed + k * BOAT_TUNING.camPullBack * 0.5) * (1 - (1 - C.fishZoom) * this.fishK);
    const hx = Math.sin(a), hz = Math.cos(a); // behind direction at azimuth a
    // gentle occlusion: if land sits under the low part of the sight line, push in
    if (land) {
      const h = Math.cos(pitch), v = Math.sin(pitch);
      // (cheap: land grid only, no raycast) — only the far, low part of the line matters, and
      // the push-in is gentle so shoreline spawns don't jam the camera into the boat
      for (let i = 3; i <= 6; i++) {
        const t = i / 6, d = dist * t;
        if (d * v > 9) break; // high enough to clear shore scrub
        if (land.blocked(look.x + hx * d * h, look.z + hz * d * h)) { dist = Math.max(C.minDistance * dist, d * 0.9); break; }
      }
    }
    this.dist += (dist - this.dist) * 0.15;
    const h = Math.cos(pitch) * this.dist, v = Math.sin(pitch) * this.dist;
    pos.set(look.x + hx * h, look.y + v, look.z + hz * h);
  }

  update(dt: number, boat: Boat, orbitDelta: { x: number; y: number }, lastOrbit: number, land: LandCollision | null = null) {
    const C = CAMERA_TUNING;
    const kT = Math.min(1, Math.max(0, boat.speed) / BOAT_TUNING.maxSpeed);
    this.speedK += (kT - this.speedK) * Math.min(1, dt * 2);
    this.fishK += ((this.focus ? 1 : 0) - this.fishK) * Math.min(1, dt * 2);

    // lazy heading follow: slow when going straight, faster only after persistent turning
    if (Math.abs(boat.turnRate) > 0.2 && Math.abs(boat.speed) > 0.3) this.turnT += dt; else this.turnT = Math.max(0, this.turnT - dt * 2);
    const turning = this.turnT > C.turnPersist;
    const moving = Math.abs(boat.speed) > 0.3;
    const rate = turning ? C.followTurn : moving ? C.followSlow : C.followSlow * 0.3;
    this.yaw += wrap(boat.yaw - this.yaw) * Math.min(1, dt * rate);

    // drag orbit; eases back to the 3/4 default after idleReturn seconds
    this.orbit -= orbitDelta.x;
    this.pitch = Math.max(-0.45, Math.min(0.6, this.pitch + orbitDelta.y * 0.5));
    if (performance.now() - lastOrbit > C.idleReturn * 1000) {
      this.orbit = wrap(this.orbit) * Math.exp(-dt * 1.2);
      this.pitch *= Math.exp(-dt * 1.2);
    }

    this.desired(boat, this.tmp, this.tmpL, land);
    this.pos.lerp(this.tmp, 1 - Math.exp(-dt * 5));
    this.look.lerp(this.tmpL, 1 - Math.exp(-dt * 5));

    if (this.shot) {
      const sh = this.shot;
      sh.t += dt;
      const hold = sh.dur * 0.35;
      const k = sh.t < hold ? 0 : THREE.MathUtils.smoothstep((sh.t - hold) / (sh.dur - hold), 0, 1);
      const sp = this.sp.set(...sh.s.pos), st = this.st.set(...sh.s.target);
      sp.lerp(st, (Math.min(sh.t, hold) / hold) * 0.08); // slow push-in during the hold
      this.cam.position.copy(sp).lerp(this.pos, k);
      st.lerp(this.look, k);
      this.cam.fov = THREE.MathUtils.lerp(sh.s.fov ?? this.baseFov(), this.targetFov(), k);
      this.cam.updateProjectionMatrix();
      this.cam.lookAt(st);
      if (sh.t >= sh.dur) this.shot = null;
      return;
    }
    this.apply();
  }

  private targetFov() { return this.baseFov() + this.speedK * BOAT_TUNING.camFovBoost; }

  private apply() {
    this.cam.position.copy(this.pos);
    const f = this.targetFov();
    if (Math.abs(this.cam.fov - f) > 0.01) { this.cam.fov = f; this.cam.updateProjectionMatrix(); }
    this.cam.lookAt(this.look);
  }
}
