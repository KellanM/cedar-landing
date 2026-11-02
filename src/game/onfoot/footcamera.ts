import * as THREE from 'three';
import type { FootWorld } from './footworld';

/**
 * On-foot three-quarter camera, matching the boat camera's language at a closer distance:
 * elevated ~40° pitch, ~30° off straight-behind, lazy heading follow, eases back to its
 * default framing after a manual orbit. Spring-arm keeps it out of walls and roofs.
 */
export const FOOT_CAM = {
  dist: 8, // m along the arm
  pitch: THREE.MathUtils.degToRad(40),
  yawOffset: THREE.MathUtils.degToRad(30),
  pivotUp: 1.1, // look-at height above the feet
  follow: 0.9, // 1/s lazy heading follow while moving
  returnDelay: 2.2, // s after a manual orbit before easing back
  returnRate: 0.9, // 1/s
  pitchMin: THREE.MathUtils.degToRad(12),
  pitchMax: THREE.MathUtils.degToRad(70),
  minArm: 0.6,
  /** debug: skip the spring arm (top-down inspection shots) */
  noSpring: false,
  blend: 0.9, // s boat ↔ foot camera blend
};

const baseFov = (aspect: number) => (aspect < 1 ? 62 : 50);

export class FootCamera {
  /** heading the camera frames from (rad, same convention as boat yaw) */
  heading = 0;
  orbit = 0;
  pitchOfs = 0;
  private arm = FOOT_CAM.dist;
  private pitchDrop = 0;
  private lastOrbit = -1e9;
  private pivot = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private blendFrom: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;
  private blendT = 0;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(public cam: THREE.PerspectiveCamera, private world: FootWorld) {}

  /** Yaw the camera looks along (for camera-relative movement). */
  get viewYaw() { return this.heading + FOOT_CAM.yawOffset + this.orbit; }

  /** Start from wherever the camera is now and blend into the foot framing. */
  beginBlend(fromLook: THREE.Vector3) {
    this.blendFrom = { pos: this.cam.position.clone(), look: fromLook.clone(), fov: this.cam.fov };
    this.blendT = 0;
  }

  snap(feet: THREE.Vector3, heading: number) {
    this.heading = heading;
    this.orbit = 0;
    this.pitchOfs = 0;
    this.arm = FOOT_CAM.dist;
    this.pivot.copy(feet).setY(feet.y + FOOT_CAM.pivotUp);
  }

  /** Current look target (used to hand the blend back to the boat camera). */
  lookTarget(out: THREE.Vector3) { return out.copy(this.pivot); }

  update(dt: number, feet: THREE.Vector3, charYaw: number, speed: number, orbitDelta: { x: number; y: number }) {
    const C = FOOT_CAM;
    if (orbitDelta.x || orbitDelta.y) this.lastOrbit = performance.now();
    this.orbit -= orbitDelta.x;
    this.pitchOfs += orbitDelta.y * 0.6;
    // Lazy heading follow while walking.
    let d = charYaw - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * Math.min(1, dt * C.follow * Math.min(1, speed / 2));
    // Ease back to the default framing after a manual orbit.
    if (performance.now() - this.lastOrbit > C.returnDelay * 1000) {
      const k = Math.exp(-dt * C.returnRate);
      // fold the orbit into the heading so we return to "30° off behind" of where we now face
      this.orbit = Math.atan2(Math.sin(this.orbit), Math.cos(this.orbit)) * k;
      this.pitchOfs *= k;
    }
    const userPitch = THREE.MathUtils.clamp(C.pitch + this.pitchOfs, C.pitchMin, C.pitchMax);
    this.pitchOfs = userPitch - C.pitch;

    // Pivot follows the feet with a little vertical smoothing (steps).
    this.pivot.x = feet.x; this.pivot.z = feet.z;
    this.pivot.y += (feet.y + C.pivotUp - this.pivot.y) * Math.min(1, dt * 8);

    const a = this.viewYaw;
    const fx = -Math.sin(a), fz = -Math.cos(a);
    const armDir = (p: number, out: THREE.Vector3) => out.set(-fx * Math.cos(p), Math.sin(p), -fz * Math.cos(p)).normalize();
    // Under roofs / eaves: drop the pitch before shortening the arm (keeps the three-quarter read).
    let targetDrop = 0;
    let hit = C.dist + 0.3;
    if (!C.noSpring) {
      hit = this.world.raycast(this.pivot, armDir(userPitch, this.dir), C.dist + 0.3);
      if (hit < C.dist * 0.7) {
        let bestHit = hit;
        for (const drop of [0.25, 0.45]) {
          const p = Math.max(C.pitchMin, userPitch - drop);
          const h = this.world.raycast(this.pivot, armDir(p, this.tmp), C.dist + 0.3);
          if (h > bestHit + 0.5) { bestHit = h; targetDrop = userPitch - p; }
          if (h >= C.dist * 0.7) break;
        }
      }
    }
    this.pitchDrop += (targetDrop - this.pitchDrop) * Math.min(1, dt * (targetDrop > this.pitchDrop ? 6 : 1.5));
    const pitch = userPitch - this.pitchDrop;
    armDir(pitch, this.dir);
    // Spring arm: pull in fast on occlusion, ease out slowly.
    if (!C.noSpring) hit = this.world.raycast(this.pivot, this.dir, C.dist + 0.3);
    const want = C.noSpring ? C.dist : Math.max(C.minArm, Math.min(C.dist, hit - 0.35));
    this.arm = want < this.arm ? want : this.arm + (want - this.arm) * Math.min(1, dt * 2.5);
    this.pos.copy(this.pivot).addScaledVector(this.dir, this.arm);
    if (this.pos.y < 0.4) this.pos.y = 0.4;

    const fov = baseFov(this.cam.aspect);
    if (this.blendFrom) {
      this.blendT += dt / C.blend;
      const k = THREE.MathUtils.smoothstep(Math.min(1, this.blendT), 0, 1);
      this.cam.position.copy(this.blendFrom.pos).lerp(this.pos, k);
      this.tmp.copy(this.blendFrom.look).lerp(this.pivot, k);
      this.cam.fov = THREE.MathUtils.lerp(this.blendFrom.fov, fov, k);
      this.cam.updateProjectionMatrix();
      this.cam.lookAt(this.tmp);
      if (this.blendT >= 1) this.blendFrom = null;
      return;
    }
    this.cam.position.copy(this.pos);
    if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    this.cam.lookAt(this.pivot);
  }
}
