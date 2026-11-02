import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { worldMat } from '../render/materials';

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
  /** debug: skip the procedural layers / yaw aim */
  dbgNoProc = false;
  dbgNoAim = false;
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private ax = new THREE.Vector3();
  /** each bone's mixer pose before the procedural layers (see update) */
  private clean = new Map<THREE.Bone, THREE.Quaternion>();

  constructor() {
    this.root.position.copy(SOCKET.pos);
    this.root.rotation.y = SOCKET.yaw;
    this.root.add(this.turn);
    this.root.visible = false;
  }

  async load() {
    const base = import.meta.env.BASE_URL;
    try {
      const r = await fetch(`${base}models/models.json`, { cache: 'no-store' });
      if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return;
      const m = await r.json();
      if (!m?.skipper) return;
      const gltf = await new GLTFLoader().loadAsync(`${base}models/${m.skipper}`);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) { if (mesh.geometry.getAttribute('color')) mesh.material = worldMat; mesh.frustumCulled = false; }
        if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      });
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
    if (this.strain > 0.85 && b.hand_R) b.hand_R.quaternion.multiply(this.q.setFromAxisAngle(this.ax.set(1, 0, 0), Math.sin(this.t * 50) * 0.04));
  }
}
