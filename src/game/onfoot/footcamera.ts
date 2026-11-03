import * as THREE from 'three';
import type { FootWorld } from './footworld';
import { CAMERA_COMFORT } from '../camera';

/**
 * On-foot camera (docs/camera_study.md F4/F7/F8, E4): a steep three-quarter follow (A Short Hike,
 * Sneaky Sasquatch, Animal Crossing sit at 50–60°) that keeps following the player's heading.
 * When something comes between the camera and the player it TILTS UP first (height clears eaves,
 * bollards and scrub), only then shortens the arm, never below `minArm`; whatever is still in the
 * way is dithered out by render/seethrough.ts. Two authored framings blend over the follow:
 *  - talk: an eased two-shot of the player and the NPC with the speech bubble readable (ACNH);
 *  - peek: looking down into a tide pool over the player's shoulder, the pool in the top half.
 */
export const FOOT_CAM = {
  dist: 10.5, // m along the arm
  pitch: THREE.MathUtils.degToRad(52),
  yawOffset: THREE.MathUtils.degToRad(20),
  pivotUp: 1.1, // look-at height above the feet
  follow: 0.9, // 1/s lazy heading follow while moving
  returnRate: 0.9, // 1/s
  pitchMin: THREE.MathUtils.degToRad(15),
  pitchMax: THREE.MathUtils.degToRad(78),
  minArm: 3,
  /** debug: skip the spring arm (top-down inspection shots) */
  noSpring: false,
  blend: 0.9, // s boat ↔ foot camera blend
  talkIn: 0.5, // s into / out of the conversation two-shot
  peekIn: 0.6, // s into / out of the tide-pool peek
  /** extra pitch on the tide flats (look down at the rocks): a framing hint, the heading stays free */
  flatsPitch: THREE.MathUtils.degToRad(6),
};

const baseFov = (aspect: number) => (aspect < 1 ? 62 : 50);
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

type Focus = { kind: 'talk' | 'peek'; a: THREE.Vector3; b: THREE.Vector3; r: number; hold: () => boolean; side: number };

export class FootCamera {
  /** heading the camera frames from (rad, same convention as boat yaw) */
  heading = 0;
  orbit = 0;
  pitchOfs = 0;
  /** 0..1 tide-flats framing hint (set by the owner) */
  flats = 0;
  private flatsK = 0;
  private arm = FOOT_CAM.dist;
  private pitchLift = 0;
  private sinceDrag = 1e9;
  private pivot = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private blendFrom: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;
  private blendT = 0;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();
  // focus (talk / peek)
  private focus: Focus | null = null;
  private focusK = 0;
  private focusDur = 0.5;
  private fPos = new THREE.Vector3();
  private fLook = new THREE.Vector3();
  private outPos = new THREE.Vector3();
  private outLook = new THREE.Vector3();
  private subj = new THREE.Vector3();
  private subjR = 1.2;
  private lastKind: 'talk' | 'peek' = 'talk';
  private q = new THREE.Quaternion();
  private qk = new THREE.Quaternion();

  constructor(public cam: THREE.PerspectiveCamera, private world: FootWorld) {}

  /** Yaw the camera looks along (for camera-relative movement). Stays on the follow rig during a focus. */
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
    this.pitchLift = 0;
    this.arm = FOOT_CAM.dist;
    this.focus = null; this.focusK = 0;
    this.pivot.copy(feet).setY(feet.y + FOOT_CAM.pivotUp);
  }

  /** Current look target (used to hand the blend back to the boat camera). */
  lookTarget(out: THREE.Vector3) { return out.copy(this.pivot); }

  /** Conversation two-shot with the NPC whose head is at `npcHead`, held while `hold()` is true. */
  talk(npcHead: THREE.Vector3, hold: () => boolean) {
    this.focus = { kind: 'talk', a: new THREE.Vector3(), b: npcHead.clone(), r: 0, hold, side: 0 };
    this.focusDur = CAMERA_COMFORT.reduced ? 0.25 : FOOT_CAM.talkIn;
  }
  /** Look down into a tide pool (centre + radius), held while `hold()` is true. */
  peek(pool: THREE.Vector3, r: number, hold: () => boolean) {
    this.focus = { kind: 'peek', a: new THREE.Vector3(), b: pool.clone(), r, hold, side: 0 };
    this.focusDur = CAMERA_COMFORT.reduced ? 0.25 : FOOT_CAM.peekIn;
  }
  get focusKind() { return this.focusK > 0.01 ? this.focus?.kind ?? 'out' : null; }

  /** The see-through subject (render/seethrough.ts): the player, or the pool while peeking. */
  subject(out: THREE.Vector3) { out.copy(this.subj); return this.subjR; }

  update(dt: number, feet: THREE.Vector3, charYaw: number, speed: number, orbitDelta: { x: number; y: number }) {
    const C = FOOT_CAM;
    if (orbitDelta.x || orbitDelta.y) this.sinceDrag = 0; else this.sinceDrag += dt;
    this.orbit -= orbitDelta.x;
    this.pitchOfs += orbitDelta.y * 0.6;
    // Lazy heading follow while walking.
    let d = charYaw - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * Math.min(1, dt * C.follow * Math.min(1, speed / 2));
    // Ease back to the default framing after a manual orbit (Settings: Camera re-centre).
    if (CAMERA_COMFORT.autoCentre && this.sinceDrag > CAMERA_COMFORT.delay * 0.55) {
      const k = Math.exp(-dt * C.returnRate);
      this.orbit = Math.atan2(Math.sin(this.orbit), Math.cos(this.orbit)) * k;
      this.pitchOfs *= k;
    }
    this.flatsK += (this.flats - this.flatsK) * Math.min(1, dt * 1.5);
    const userPitch = THREE.MathUtils.clamp(C.pitch + C.flatsPitch * this.flatsK + this.pitchOfs, C.pitchMin, C.pitchMax);
    this.pitchOfs = userPitch - C.pitch - C.flatsPitch * this.flatsK;

    // Pivot follows the feet with a little vertical smoothing (steps).
    this.pivot.x = feet.x; this.pivot.z = feet.z;
    this.pivot.y += (feet.y + C.pivotUp - this.pivot.y) * Math.min(1, dt * 8);

    const a = this.viewYaw;
    const fx = -Math.sin(a), fz = -Math.cos(a);
    const armDir = (p: number, out: THREE.Vector3) => out.set(-fx * Math.cos(p), Math.sin(p), -fz * Math.cos(p)).normalize();
    // Something in the way: tilt UP first (keeps the subject readable over eaves and posts), then
    // shorten the arm; the see-through cut-out handles whatever is left.
    let targetLift = 0;
    let hit = C.dist + 0.3;
    if (!C.noSpring) {
      hit = this.world.raycast(this.pivot, armDir(userPitch, this.dir), C.dist + 0.3);
      if (hit < C.dist * 0.8) {
        let bestHit = hit;
        for (const lift of [0.12, 0.24, 0.36]) {
          const p = Math.min(C.pitchMax, userPitch + lift);
          const h = this.world.raycast(this.pivot, armDir(p, this.tmp), C.dist + 0.3);
          if (h > bestHit + 0.5) { bestHit = h; targetLift = p - userPitch; }
          if (h >= C.dist * 0.8) break;
        }
      }
    }
    this.pitchLift += (targetLift - this.pitchLift) * Math.min(1, dt * (targetLift > this.pitchLift ? 5 : 1.2));
    const pitch = userPitch + this.pitchLift;
    armDir(pitch, this.dir);
    // Spring arm: pull in on occlusion (never closer than minArm), ease out slowly.
    if (!C.noSpring) hit = this.world.raycast(this.pivot, this.dir, C.dist + 0.3);
    const want = C.noSpring ? C.dist : Math.max(C.minArm, Math.min(C.dist, hit - 0.35));
    this.arm = want < this.arm ? this.arm + (want - this.arm) * Math.min(1, dt * 10) : this.arm + (want - this.arm) * Math.min(1, dt * 2);
    this.pos.copy(this.pivot).addScaledVector(this.dir, this.arm);
    if (this.pos.y < 0.4) this.pos.y = 0.4;
    this.subj.copy(this.pivot); this.subjR = 2;

    let fov = baseFov(this.cam.aspect);
    let look: THREE.Vector3 = this.pivot;
    // ---- focus framings (talk / peek), blended over the follow pose by orbiting the pivot
    const F = this.focus;
    if (F && !F.hold()) this.focus = null;
    this.focusK = Math.min(1, Math.max(0, this.focusK + (this.focus ? dt : -dt) / this.focusDur));
    if (F) this.lastKind = F.kind;
    if (F && this.focusK > 0) this.framing(F, feet);
    if (this.focusK > 0) {
      const k = smooth(this.focusK);
      // arc around the player's head (offsets slerped in direction, lerped in length): never
      // through the player or the NPC
      const piv = this.tmp.copy(feet).setY(feet.y + 1.4);
      this.outPos.copy(this.pos).sub(piv);
      const dPos = this.dir.copy(this.fPos).sub(piv);
      const l0 = this.outPos.length(), l1 = dPos.length();
      this.q.setFromUnitVectors(this.outPos.normalize(), dPos.normalize());
      this.qk.identity().slerp(this.q, k);
      this.outPos.applyQuaternion(this.qk).multiplyScalar(THREE.MathUtils.lerp(l0, l1, k)).add(piv);
      this.pos.copy(this.outPos);
      look = this.outLook.copy(this.pivot).lerp(this.fLook, k);
      if (this.lastKind === 'peek') { this.subj.copy(this.fLook); this.subjR = 1.8; }
      fov = THREE.MathUtils.lerp(fov, this.cam.aspect < 1 ? 58 : 46, k);
    }

    if (this.blendFrom) {
      this.blendT += dt / C.blend;
      const k = THREE.MathUtils.smoothstep(Math.min(1, this.blendT), 0, 1);
      this.cam.position.copy(this.blendFrom.pos).lerp(this.pos, k);
      this.outLook.copy(this.blendFrom.look).lerp(look, k);
      this.cam.fov = THREE.MathUtils.lerp(this.blendFrom.fov, fov, k);
      this.cam.updateProjectionMatrix();
      this.cam.lookAt(this.outLook);
      if (this.blendT >= 1) this.blendFrom = null;
      return;
    }
    this.cam.position.copy(this.pos);
    if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    this.cam.lookAt(look);
  }

  /** Target pose for a focus framing → fPos / fLook. */
  private framing(F: Focus, feet: THREE.Vector3) {
    const portrait = this.cam.aspect < 1;
    if (F.kind === 'talk') {
      // two-shot: from behind the player's shoulder, looking past them at the NPC; portrait stacks
      // them in depth (narrow frame), landscape opens the angle so both sit on the thirds
      const P = F.a.copy(feet).setY(feet.y + 1.45), N = F.b;
      const dx = N.x - P.x, dz = N.z - P.z, dl = Math.hypot(dx, dz) || 1;
      const ux = dx / dl, uz = dz / dl;
      const ang = THREE.MathUtils.degToRad(portrait ? 24 : 40);
      const R = 2.9 + 0.45 * dl, H = 1.35;
      const pose = (s: number, out: THREE.Vector3) => {
        const c = Math.cos(s * ang), sn = Math.sin(s * ang);
        const bx = ux * c - uz * sn, bz = ux * sn + uz * c; // rotated "toward the NPC"
        return out.set(P.x - bx * R, P.y + H, P.z - bz * R);
      };
      // pick the side with the clearer view (re-chosen only when entering)
      if (!F.side) {
        let best = -1, bs = 1;
        for (const s of [1, -1]) {
          pose(s, this.fPos);
          const dir = this.fPos.clone().sub(P), l = dir.length();
          const h = this.world.raycast(P, dir.normalize(), l);
          if (h > best + 0.3) { best = h; bs = s; }
        }
        F.side = bs;
      }
      pose(F.side, this.fPos);
      const dir = this.fPos.clone().sub(P), l = dir.length();
      const h = this.world.raycast(P, dir.normalize(), l);
      if (h < l) this.fPos.copy(P).addScaledVector(dir, Math.max(1.6, h - 0.3));
      // aim between them, nearer the NPC and a little up so the bubble above the NPC stays in frame
      this.fLook.copy(P).lerp(N, 0.62);
      this.fLook.y = THREE.MathUtils.lerp(P.y, N.y, 0.5) + (portrait ? 0.35 : 0.2);
    } else {
      // peek: steep (≈ 62°) from beside the player (never through their hat), the pool in the top
      // half above the note card; the side with the clearer view wins
      const C = F.b;
      const dx = C.x - feet.x, dz = C.z - feet.z, dl = Math.hypot(dx, dz) || 1;
      const lead = portrait ? 0.7 + F.r * 0.3 : 0.3;
      const dist = 3.6 + F.r * 0.9, pitch = THREE.MathUtils.degToRad(62);
      const hz = Math.cos(pitch) * dist, vt = Math.sin(pitch) * dist;
      const ang = THREE.MathUtils.degToRad(58);
      const pose = (s: number, outPos: THREE.Vector3, outLook: THREE.Vector3) => {
        const c = Math.cos(s * ang), sn = Math.sin(s * ang);
        const ux = (dx / dl) * c - (dz / dl) * sn, uz = (dx / dl) * sn + (dz / dl) * c; // view direction (toward the pool)
        outLook.set(C.x - ux * lead, C.y, C.z - uz * lead);
        outPos.set(outLook.x - ux * hz, outLook.y + vt, outLook.z - uz * hz);
      };
      if (!F.side) {
        let best = -1, bs = 1;
        for (const s of [1, -1]) {
          pose(s, this.fPos, this.fLook);
          const dir = this.fPos.clone().sub(this.fLook), l = dir.length();
          const h = this.world.raycast(this.fLook.clone().setY(this.fLook.y + 0.3), dir.normalize(), l);
          if (h > best + 0.3) { best = h; bs = s; }
        }
        F.side = bs;
      }
      pose(F.side, this.fPos, this.fLook);
    }
  }
}
