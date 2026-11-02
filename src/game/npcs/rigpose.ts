import * as THREE from 'three';

/**
 * Pose helpers for the shared 15-bone rig (art/rig/skipper.glb, world/npcs.glb), in npc_gen joint units
 * (degrees). TS port of art/rig/skipper_pose.js. Every bone's bind orientation is identity in Blender's axes,
 * so a bone's local quaternion IS the npc_gen joint rotation; below the root, bone-local axes are Blender's
 * (x = own left, y = back, z = up) and `hips` carries the Y-up fix. Positive pitch about local X bends a spine
 * forward; limbs use npcLimb (positive pitch swings the limb forward).
 */
export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R',
  'hand_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] as const;
export type BoneName = (typeof BONES)[number];

/** rig_rest_params (npc_rig.py npc_params): degrees; pz = hip-height delta in metres. */
export interface NpcParams {
  hip?: number[]; spine?: number[]; neck?: number[]; chest?: number[]; head?: number[];
  shL?: number[]; shR?: number[]; elL?: number[]; elR?: number[]; legL?: number[]; legR?: number[];
  knL?: number; knR?: number; pz?: number;
}

const D = Math.PI / 180;
const _e = new THREE.Euler();
const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/** npc_gen R(x,y,z) (Blender Euler XYZ, degrees) as a quaternion. */
export function npcEuler(x: number, y: number, z: number, q: THREE.Quaternion) {
  return q.setFromEuler(_e.set(x * D, y * D, z * D, 'ZYX'));
}
/** npc_gen limb frame R(-pitch,0,0) @ R(0,-side*out,0), side +1 = left. */
export function npcLimb(pitch: number, out: number, side: number, q: THREE.Quaternion) {
  _a.setFromAxisAngle(X, -pitch * D);
  _b.setFromAxisAngle(Y, -side * out * D);
  return q.copy(_a).multiply(_b);
}

/** Rotation offset in a bone's own frame, radians: pitch about X (forward), roll about Y, yaw about Z. */
export function addLocal(bone: THREE.Object3D, base: THREE.Quaternion, pitch: number, roll: number, yaw: number) {
  bone.quaternion.copy(base);
  if (pitch || roll || yaw) bone.quaternion.multiply(_a.setFromEuler(_e.set(pitch, roll, yaw, 'ZYX')));
}

/** Critically-damped / under-damped scalar spring (semi-implicit Euler, stable for dt <= 1/15 s). */
export class Spring {
  v = 0;
  constructor(public x = 0, public w = 10, public z = 0.8) {}
  step(target: number, dt: number) {
    const n = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-2 * this.z * this.w * this.v - this.w * this.w * (this.x - target)) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(v: number) { this.v += v; }
}

/** Smoothstep easing of p in [0,1]. */
export const ease = (p: number) => p * p * (3 - 2 * p);
/** Deterministic hash → [0,1) for per-NPC variation (no two NPCs breathe in sync). */
export function hash01(s: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
