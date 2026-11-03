import { bust } from '../assetver';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toonMat, worldMat } from '../render/materials';
import { FaceRig, type Expr } from './face';
import { WOBBLE } from './wobble';

/**
 * The skipper on deck (art/rig/skipper.glb, 15 bones, rigid skin). Stands at `socket_skipper`
 * (art/rig/boat_sockets.json, BOAT_T0 local, bow +X) and turns to face the line. The GLB's clips are
 * single-frame poses (stand, cast_windup, reel, hold_show, hold_hoist); we cross-fade between them
 * with an AnimationMixer and add procedural layers on top (reel crank, strain lean, breathing,
 * fish-flop echo). The rod lives in the right hand; `rodTip()` feeds the line.
 */
export type Pose = 'stand' | 'cast_windup' | 'reel' | 'hold_show' | 'hold_hoist';

const SOCKET = { pos: new THREE.Vector3(-2.5, 0.92, -0.15), yaw: Math.PI / 2 }; // faces bow +X
/** Per-model fixes over the exported socket_skipper. The Packer's exported socket (x -3.0) sits under
 *  the aft canopy roof (x -3.2..-1, ~2.4 m), hiding him from the chase and hold-up cameras; the open
 *  stern deck (y 1.1) runs x -4.5..-3.25. */
const SOCKET_FIX: Record<string, [number, number, number]> = { BOAT_T1: [-3.85, 1.1, -0.15] };

export class Skipper {
  root = new THREE.Group(); // placed at the socket in the boat model's space
  private turn = new THREE.Group(); // yaw toward the bobber
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<Pose, THREE.AnimationAction>();
  private current: Pose = 'stand';
  private bones: Record<string, THREE.Bone> = {};
  private tip: THREE.Object3D | null = null;
  private rod: THREE.Object3D | null = null;
  ready = false;
  private yaw = 0;
  private targetYaw = 0;
  private t = 0;
  /** 0..1 reel speed (crank), 0..1 strain (lean back) */
  crank = 0;
  strain = 0;
  /** hold_hoist: wanted distance between the wrists (m) so the fists meet the fish; null = the baked pose */
  gripSpread: number | null = null;
  private narrow = 0;
  /** world-space target the skipper faces (null = bow) */
  face: THREE.Vector3 | null = null;
  /** true: turn so the ROD points at `face` (the reel pose holds it out to the right); false: the chest */
  aimRod = false;
  /** catch victory (docs/catch_study.md F3): a hop + arch-back "ta-da" layered on any hold pose */
  private cheerT = -1;
  private cheerK = 0;
  /** debug: skip the procedural layers / yaw aim */
  dbgNoProc = false;
  dbgNoAim = false;
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private ax = new THREE.Vector3();
  /** 'rigid' = skipper.glb (direction A, rigid parts) · 'skinned' = skipper_skinned.glb (friendslop prototype) */
  variant: 'rigid' | 'skinned' = 'rigid';
  /** spring bones (skinned variant): hat + scarf tail lag behind the head / chest and overshoot */
  private springs: { bone: THREE.Bone; rest: THREE.Quaternion; x: number; z: number; vx: number; vz: number; w: number; zeta: number; gain: number; prev: THREE.Vector3 }[] = [];
  private sp = new THREE.Vector3();
  /** expression overlays (src/game/face.ts) */
  expr: FaceRig | null = null;
  setExpr(e: Expr) { this.expr?.set(e); }
  /** world point to glance at over the shoulder (the camera, on expressive beats) so the face reads;
   *  null = eyes front. The fishing camera sits behind him, so without this his face is never seen. */
  glance: THREE.Vector3 | null = null;
  private glanceYaw = 0;
  private glanceV = 0;
  private glanceTmp = new THREE.Vector3();
  /** landing squash (WOBBLE): kicked when a hop lands */
  private sq = 0; private sqV = 0; private lastHop = 0;
  private eul = new THREE.Euler();
  /** each bone's mixer pose before the procedural layers (see update) */
  private clean = new Map<THREE.Bone, THREE.Quaternion>();

  constructor() {
    this.root.position.copy(SOCKET.pos);
    this.root.rotation.y = SOCKET.yaw;
    this.root.add(this.turn);
    this.root.visible = false;
  }

  async load(variant: 'rigid' | 'skinned' = this.variant) {
    const base = import.meta.env.BASE_URL;
    try {
      const r = await fetch(`${base}models/models.json`, { cache: 'no-store' });
      if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return;
      const m = await r.json();
      const file = (variant === 'skinned' ? m?.skipper_skinned : null) ?? m?.skipper;
      if (!file) return;
      const gltf = await new GLTFLoader().loadAsync(bust(`${base}models/${file}`));
      // swap: drop the previous model, keep attachment / yaw
      this.mixer?.stopAllAction();
      while (this.turn.children.length) this.turn.remove(this.turn.children[0]);
      this.bones = {}; this.actions.clear(); this.clean.clear(); this.springs = []; this.current = 'stand';
      this.variant = variant;
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          if (mesh.geometry.getAttribute('color')) mesh.material = mesh.geometry.getAttribute('normal') ? toonMat : worldMat;
          mesh.frustumCulled = false;
        }
        if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      });
      for (const [name, w, zeta, gain] of [['hat', 15, 0.32, 0.9], ['scarf', 8, 0.22, 1.6]] as const) {
        const bn = this.bones[name];
        if (bn) this.springs.push({ bone: bn, rest: bn.quaternion.clone(), x: 0, z: 0, vx: 0, vz: 0, w, zeta, gain, prev: new THREE.Vector3() });
      }
      this.tip = gltf.scene.getObjectByName('rod_tip') ?? null;
      this.rod = gltf.scene.getObjectByName('PLAYER_Skipper_Rod') ?? null;
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        const name = clip.name.replace(/^skipper_/, '') as Pose;
        const a = this.mixer.clipAction(clip);
        a.setLoop(THREE.LoopRepeat, Infinity);
        a.clampWhenFinished = true;
        this.actions.set(name, a);
      }
      this.actions.get('stand')?.play();
      this.turn.add(gltf.scene);
      this.expr = new FaceRig(gltf.scene, 0.3);
      this.ready = true;
    } catch (e) {
      console.warn('[skipper] skipper.glb unavailable — line leaves the cabin rail', e);
    }
  }

  /** Attach to the boat model (bow +X) at its skipper socket. Canoe/placeholder: hidden. */
  attachTo(model: THREE.Object3D | null) {
    this.root.removeFromParent();
    // the troller uses the rig's own socket; upgrade tiers carry socket_skipper in node extras
    const sock = model?.userData.socket_skipper as number[] | undefined;
    const ok = !!model && (model.name === 'BOAT_T0' || (Array.isArray(sock) && sock.length === 3));
    if (!model || !ok) { this.root.visible = false; return; }
    const at = SOCKET_FIX[model.name] ?? (model.name === 'BOAT_T0' || !sock ? null : sock);
    if (at) this.root.position.set(at[0], at[1], at[2]); else this.root.position.copy(SOCKET.pos);
    this.root.rotation.y = SOCKET.yaw; // every tier faces bow +X
    model.add(this.root);
    this.root.visible = this.ready;
  }

  get attached() { return this.ready && this.root.visible && !!this.root.parent; }

  pose(p: Pose, fade = 0.18) {
    if (!this.mixer || p === this.current) return;
    const from = this.actions.get(this.current), to = this.actions.get(p);
    if (!to) return;
    to.reset().setEffectiveWeight(1).play();
    if (from) from.crossFadeTo(to, fade, false);
    this.current = p;
  }

  get currentPose() { return this.current; }

  /** World position of the rod tip (falls back to null if the rig is missing). */
  rodTip(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.attached || !this.tip) return null;
    this.tip.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.tip.matrixWorld);
  }

  /** Between the hands (hold-up target). */
  hands(out: THREE.Vector3): THREE.Vector3 | null {
    const l = this.bones.hand_L, r = this.bones.hand_R;
    if (!this.attached || !l || !r) return null;
    l.updateWorldMatrix(true, false); r.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(l.matrixWorld);
    return out.add(this.tmp.setFromMatrixPosition(r.matrixWorld)).multiplyScalar(0.5);
  }

  /** One wrist (the one-hand hold uses the raised right hand of hold_show). */
  hand(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 | null {
    const h = side === 'L' ? this.bones.hand_L : this.bones.hand_R;
    if (!this.attached || !h) return null;
    h.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(h.matrixWorld);
  }

  head(out: THREE.Vector3): THREE.Vector3 | null {
    const h = this.bones.head;
    if (!this.attached || !h) return null;
    h.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(h.matrixWorld);
  }

  /** Facing direction in world space (xz). */
  forward(out: THREE.Vector3) {
    this.turn.updateWorldMatrix(true, false);
    return out.set(0, 0, 1).transformDirection(this.turn.matrixWorld).setY(0).normalize();
  }

  showRod(on: boolean) { if (this.rod) this.rod.visible = on; }

  /** Victory beat: k 0..1 (0.35 a little bounce … 1 two hops and a big arch). Rig-generic: it only
   *  moves the turn group (hop) and the chest / spine / head bones (arch back, chin up). */
  cheer(k: number) { this.cheerT = 0; this.cheerK = k; }
  get cheering() { return this.cheerT >= 0; }

  update(dt: number) {
    if (!this.ready || !this.mixer) return;
    this.t += dt;
    // turn toward the target (in the socket's local frame)
    if (this.face && this.root.parent) {
      this.root.updateWorldMatrix(true, false);
      this.tmp.copy(this.face);
      this.root.worldToLocal(this.tmp);
      this.targetYaw = Math.atan2(this.tmp.x, this.tmp.z);
      if (this.aimRod && this.tip && !this.dbgNoAim) {
        // rod bearing in the turn group's own frame (independent of the current yaw)
        this.tip.updateWorldMatrix(true, false);
        this.tmp.setFromMatrixPosition(this.tip.matrixWorld);
        this.turn.worldToLocal(this.tmp);
        if (Math.hypot(this.tmp.x, this.tmp.z) > 0.2) this.targetYaw -= Math.atan2(this.tmp.x, this.tmp.z) * 0.6;
      }
    } else this.targetYaw = 0;
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 6);
    this.turn.rotation.y = this.yaw;
    // AnimationMixer only rewrites a bone when the blended clip value changes; our clips are single-frame
    // poses, so once a cross-fade settles it stops writing and the procedural layers below would multiply
    // onto last frame's result and accumulate (chest folding over, head on its side). Restore the clean
    // pose first, let the mixer overwrite it if it wants, then remember the clean result.
    for (const [bone, q] of this.clean) bone.quaternion.copy(q);
    this.mixer.update(dt);
    for (const bone of Object.values(this.bones)) {
      const c = this.clean.get(bone);
      if (c) c.copy(bone.quaternion); else this.clean.set(bone, bone.quaternion.clone());
    }
    if (this.dbgNoProc) return;
    // procedural layers after the mixer (bone-local axes are Blender's: x = own left, z = up)
    const b = this.bones;
    const breathe = Math.sin(this.t * 1.6) * 0.02;
    if (b.chest) b.chest.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(1, 0, 0), breathe - this.strain * 0.22));
    if (b.spine) b.spine.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(1, 0, 0), -this.strain * 0.12));
    // glance at the camera: head 65 % / chest 35 % of the yaw (bone-local z = up), up to ~100° over the shoulder
    let gy = 0;
    if (this.glance) {
      this.turn.updateWorldMatrix(true, false);
      this.glanceTmp.copy(this.glance); this.turn.worldToLocal(this.glanceTmp);
      gy = THREE.MathUtils.clamp(Math.atan2(this.glanceTmp.x, this.glanceTmp.z), -1.75, 1.75);
    }
    // critically damped follow (no overshoot: the head turns and stays put)
    { const w = 9, h = Math.min(dt, 1 / 30); this.glanceV += (-2 * w * this.glanceV - w * w * (this.glanceYaw - gy)) * h; this.glanceYaw += this.glanceV * h; }
    if (Math.abs(this.glanceYaw) > 1e-3) {
      if (b.chest) b.chest.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(0, 0, 1), this.glanceYaw * 0.35));
      if (b.head) b.head.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(0, 0, 1), this.glanceYaw * 0.65));
    }
    if (this.crank > 0.01 && b.forearm_L) {
      const c = Math.sin(this.t * 14) * 0.35 * this.crank;
      b.forearm_L.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(1, 0, 0), c));
      if (b.upper_arm_L) b.upper_arm_L.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(0, 1, 0), Math.cos(this.t * 14) * 0.12 * this.crank));
    }
    // two-hand hold: swing the upper arms in (local Y; measured: 0.3 rad ≈ 0.156 m per hand) so a short
    // fish sits in the fists instead of floating between wide-apart hands
    const want = this.gripSpread == null || this.current !== 'hold_hoist' ? 0 : Math.min(0.36, Math.max(0, (0.64 - this.gripSpread) * 0.96));
    this.narrow += (want - this.narrow) * Math.min(1, dt * 6);
    if (this.narrow > 0.002 && b.upper_arm_L && b.upper_arm_R) {
      b.upper_arm_L.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(0, 1, 0), this.narrow));
      b.upper_arm_R.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(0, 1, 0), -this.narrow));
    }
    // victory hop: one quick hop (two for the big ones) with an arch back on the way up
    if (this.cheerT >= 0) {
      this.cheerT += dt;
      const k = this.cheerK, t = this.cheerT;
      const hop1 = t < 0.34 ? Math.sin((t / 0.34) * Math.PI) : 0;
      const hop2 = k > 0.8 && t > 0.42 && t < 0.7 ? Math.sin(((t - 0.42) / 0.28) * Math.PI) * 0.6 : 0;
      const h = hop1 + hop2;
      this.turn.position.y = h * 0.1 * k;
      if (this.lastHop > 0.02 && h <= 0.001) this.sqV -= 3.2 * k * WOBBLE.k; // touch-down: squash
      this.lastHop = h;
      const arch = (h + (t < 1.2 ? Math.max(0, 1 - Math.abs(t - 0.3) / 0.9) * 0.5 : 0)) * k;
      if (b.chest) b.chest.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(1, 0, 0), -0.16 * arch));
      if (b.head) b.head.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(1, 0, 0), -0.12 * arch));
      if (t > 1.3) { this.cheerT = -1; this.turn.position.y = 0; }
    }
    if (this.strain > 0.85 && b.hand_R) b.hand_R.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(1, 0, 0), Math.sin(this.t * 50) * 0.04));
    this.updateSprings(dt);
    // squash & stretch on landing (scale the turn group about the soles), spring back with a little overshoot
    this.sqV += (-2 * 0.32 * 18 * this.sqV - 18 * 18 * this.sq) * Math.min(dt, 1 / 30);
    this.sq += this.sqV * Math.min(dt, 1 / 30);
    const sq = THREE.MathUtils.clamp(this.sq, -0.25, 0.25);
    this.turn.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    this.expr?.update(dt);
  }

  /** Secondary motion (skinned variant): each spring bone is driven by its parent's world velocity
   *  (boat roll, turns, the victory hop, casting) and lags + overshoots like a soft brim / knitted scarf
   *  tail. Semi-implicit Euler; a handful of flops per bone per frame. */
  private updateSprings(dt: number) {
    if (!this.springs.length || dt <= 0) return;
    const h = Math.min(dt, 1 / 20);
    for (const s of this.springs) {
      const par = s.bone.parent!;
      par.updateWorldMatrix(true, false);
      this.sp.setFromMatrixPosition(par.matrixWorld);
      const vx = (this.sp.x - s.prev.x) / h, vy = (this.sp.y - s.prev.y) / h, vz = (this.sp.z - s.prev.z) / h;
      const first = s.prev.lengthSq() === 0;
      s.prev.copy(this.sp);
      if (first) continue;
      const g = s.gain * WOBBLE.k;
      const tgtX = THREE.MathUtils.clamp(-(vy * 0.10) + Math.hypot(vx, vz) * 0.06, -0.5, 0.5) * g;
      const tgtZ = THREE.MathUtils.clamp(vx * 0.05, -0.4, 0.4) * g;
      s.vx += (-2 * s.zeta * s.w * s.vx - s.w * s.w * (s.x - tgtX)) * h; s.x += s.vx * h;
      s.vz += (-2 * s.zeta * s.w * s.vz - s.w * s.w * (s.z - tgtZ)) * h; s.z += s.vz * h;
      s.bone.quaternion.copy(s.rest).multiply(this.q.setFromEuler(this.eul.set(s.x, 0, s.z)));
    }
  }
}
