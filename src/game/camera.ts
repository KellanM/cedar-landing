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

/** Fishing camera (docs/study/fishing_polish.md). Edited live by ?tune. */
export const FISH_CAM = {
  frame: 0.36, // aim point: fraction of the way from the boat to the float / fish
  sideOn: 62, // deg (landscape): the camera views the line this far off its axis (side-on, from astern)
  sideOnPortrait: 40, // deg (portrait): reverse 3/4 — camera on the fish's side, float in the foreground,
  //                     skipper facing us; offset toward the stern so the cabin is never in between
  sideBlend: 0.85, // 0..1 how far it swings toward that view
  zoomFar: 0.95, // distance factor with the fish far out
  zoomNear: 0.8, // ... and with it under the rod tip (the frame tightens as you win)
  punch: 0.45, // m hook-set push toward the float
  fovPunch: 4, // deg FOV kick on the hook-set
  shake: 0.09, // m max shake offset (trauma^2 * noise, no roll)
  lean: 0.9, // m the aim leans toward the pull side during a thrash
  landDist: 5.6, // m hold-up shot: camera distance from the skipper
  landSide: 38, // deg off the skipper's facing
  landFov: 48,
  landIn: 0.75, // s blend into the hold-up shot
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
  private fishSide = 0; // +1 / -1 which side of the line the camera settles on
  // additive juice layers
  private trauma = 0;
  private kick = new THREE.Vector3();
  private kickV = new THREE.Vector3();
  private fovKick = 0;
  private leanT = new THREE.Vector3();
  private leanC = new THREE.Vector3();
  private noiseT = 0;
  /** world xz the fish is at (reeling); the frame tightens as it gets closer */
  fishAt: THREE.Vector3 | null = null;
  /** stable fishing axis point (the cast point): the camera angle comes from this, not the wobbling fish */
  fishAxis: THREE.Vector3 | null = null;
  // hold-up shot
  private land = { eye: new THREE.Vector3(), at: new THREE.Vector3(), k: 0, dir: 0 };
  /** set false to drop shake/punch (prefers-reduced-motion) */
  motion = true;

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
    let a = this.yaw + C.sideDeg * D2R + this.orbit;
    let zoom = 1 - (1 - C.fishZoom) * this.fishK;
    if (this.focus) {
      const F = FISH_CAM, f = this.fishK;
      // aim between the boat (not ahead of it) and the float/fish
      const ax = boat.pos.x + (this.focus.x - boat.pos.x) * F.frame, az = boat.pos.z + (this.focus.z - boat.pos.z) * F.frame;
      look.x += (ax - look.x) * f; look.z += (az - look.z) * f;
      // swing to see the line side-on (never end-on, where the float hides behind the boat)
      const ax0 = this.fishAxis ?? this.focus;
      const dx = ax0.x - boat.pos.x, dz = ax0.z - boat.pos.z;
      if (Math.hypot(dx, dz) > 0.5) {
        const portrait = this.cam.aspect < 1;
        // portrait: camera on the fish's side looking back at the boat; landscape: from behind, side-on
        const base = portrait ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz);
        const off = (portrait ? F.sideOnPortrait : F.sideOn) * D2R;
        // pick the side whose camera direction points more toward the stern (aft deck = skipper, no
        // cabin); re-checked as the boat swings, with hysteresis so it never flip-flops
        const sx = Math.sin(boat.yaw), sz = Math.cos(boat.yaw); // stern direction
        const d1 = Math.sin(base + off) * sx + Math.cos(base + off) * sz, d2 = Math.sin(base - off) * sx + Math.cos(base - off) * sz;
        if (!this.fishSide) this.fishSide = d1 >= d2 ? 1 : -1;
        else if (this.fishSide > 0 ? d2 > d1 + 0.6 : d1 > d2 + 0.6) this.fishSide = -this.fishSide;
        a += wrap(base + this.fishSide * off - a) * F.sideBlend * f;
      }
      const near = this.fishAt ? Math.min(1, Math.hypot(this.fishAt.x - boat.pos.x, this.fishAt.z - boat.pos.z) / 8) : 1;
      zoom = 1 + ((F.zoomNear + (F.zoomFar - F.zoomNear) * near) - 1) * f;
    } else if (this.fishK < 0.02) this.fishSide = 0;
    const pitch = Math.max(15 * D2R, Math.min(75 * D2R, C.pitchDeg * D2R + this.pitch));
    // bigger boats (the 6.4 m troller) get a proportionally wider frame; portrait screens a bit more
    const size = Math.max(1, boat.halfLen / 2.6) * (this.cam.aspect < 1 ? 1.08 : 1);
    let dist = (C.distance * size + k * C.distSpeed + k * BOAT_TUNING.camPullBack * 0.5) * zoom;
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

  /** Hook-set / leap punch: a quick push toward `at` (m) plus an FOV kick (deg). */
  punch(at: THREE.Vector3, m = FISH_CAM.punch, fov = FISH_CAM.fovPunch) {
    if (!this.motion) return;
    this.sp.copy(at).sub(this.cam.position).normalize();
    this.kickV.addScaledVector(this.sp, m * 9);
    this.fovKick = Math.max(this.fovKick, fov);
  }
  /** Add shake trauma (0..1); offset = max * trauma^2 * noise, decays 1.6/s, no roll. */
  shake(t: number) { if (this.motion) this.trauma = Math.min(1, this.trauma + t); }
  /** Aim lean toward a world direction (xz) - the thrash pull side. null = relax. */
  lean(x: number | null, z = 0, m = FISH_CAM.lean) {
    if (x === null) this.leanT.set(0, 0, 0);
    else { this.leanT.set(x, 0, z); const l = this.leanT.length(); if (l > 1e-4) this.leanT.multiplyScalar(m / l); }
  }
  /** Hold-up shot: a 3/4 front view of the skipper (`head`, facing `fwd`) and the fish in their hands. */
  landing(head: THREE.Vector3, fwd: THREE.Vector3, fish: THREE.Vector3) {
    const F = FISH_CAM, L = this.land;
    const portrait = this.cam.aspect < 1;
    // pick the side the camera is already on, so the swing is short
    const s0 = Math.atan2(fwd.x, fwd.z);
    const cur = Math.atan2(this.cam.position.x - head.x, this.cam.position.z - head.z);
    const side = wrap(cur - s0) >= 0 ? 1 : -1;
    const az = s0 + side * F.landSide * D2R;
    const d = F.landDist * (portrait ? 1.15 : 1);
    L.eye.set(head.x + Math.sin(az) * d, head.y + 1.0, head.z + Math.cos(az) * d); // looks down ~10°: mostly sea behind, not the whole horizon
    L.at.copy(head).lerp(fish, 0.5);
    // portrait: put the hold-up in the top third, clear of the catch card / slip below
    if (portrait) L.at.y -= d * 0.2;
    L.dir = 1;
  }
  endLanding() { if (this.land.k > 0 || this.land.dir > 0) this.land.dir = -1; }
  get landingK() { return this.land.k; }

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
    // juice layers: punch spring (k 120, c 16), lean, trauma decay
    this.kickV.addScaledVector(this.kick, -120 * dt).multiplyScalar(Math.exp(-16 * dt));
    this.kick.addScaledVector(this.kickV, dt);
    this.fovKick *= Math.exp(-dt * 5);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.noiseT += dt;
    this.leanC.lerp(this.leanT, 1 - Math.exp(-dt * 3));
    const L = this.land;
    if (L.dir) {
      L.k = Math.min(1, Math.max(0, L.k + (L.dir * dt) / (L.dir > 0 ? FISH_CAM.landIn : 0.8)));
      if (L.k <= 0 && L.dir < 0) L.dir = 0;
    }

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
    const L = this.land;
    const e = L.k < 0.5 ? 2 * L.k * L.k : 1 - Math.pow(-2 * L.k + 2, 2) / 2; // ease in-out
    this.cam.position.copy(this.pos).add(this.kick);
    this.st.copy(this.look).add(this.leanC);
    if (e > 0) { this.cam.position.lerp(L.eye, e); this.st.lerp(L.at, e); }
    if (this.trauma > 0) {
      const s = FISH_CAM.shake * this.trauma * this.trauma, t = this.noiseT * 23;
      this.cam.position.x += s * (Math.sin(t) * 0.6 + Math.sin(t * 2.3 + 1) * 0.4);
      this.cam.position.y += s * (Math.sin(t * 1.7 + 2) * 0.6 + Math.sin(t * 3.1) * 0.4);
      this.cam.position.z += s * (Math.sin(t * 1.3 + 4) * 0.6 + Math.sin(t * 2.9 + 3) * 0.4);
    }
    const f = THREE.MathUtils.lerp(this.targetFov(), FISH_CAM.landFov, e) - this.fovKick;
    if (Math.abs(this.cam.fov - f) > 0.01) { this.cam.fov = f; this.cam.updateProjectionMatrix(); }
    this.cam.lookAt(this.st);
  }
}
