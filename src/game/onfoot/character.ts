import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { worldMat } from '../../render/materials';

/**
 * The skipper on foot. Loads `public/models/skipper.glb` (rigged, 15 bones) when
 * `public/models/models.json` says it exists, else builds a low-poly placeholder with the
 * same joint layout. Both are driven by the same procedural animation (no clips).
 *
 * Facing convention: the character root faces −Z at yaw 0, like the boat.
 */

/** The rigged glb faces −Y in Blender, which the glTF export maps to +Z, so turn it half-way. */
export const SKIPPER_MODEL_YAW = Math.PI;
export const SKIPPER_HEIGHT = 1.7;

type JointName = 'hips' | 'spine' | 'head' | 'armL' | 'armR' | 'foreL' | 'foreR' | 'legL' | 'legR' | 'shinL' | 'shinR';

interface Joint {
  obj: THREE.Object3D;
  rest: THREE.Quaternion;
  /** character right / up / forward axes expressed in the joint's local frame */
  right: THREE.Vector3;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
}

const BONE_PATTERNS: Record<JointName, RegExp[]> = {
  // exact names from art/rig/skipper.glb first, then loose fallbacks
  hips: [/^hips$/i, /hip|pelvis/i],
  spine: [/^spine$/i, /chest|spine|torso/i],
  head: [/^head$/i, /head/i, /neck/i],
  armL: [/^upper_arm[._]?L$/i, /upper.?arm.*l$/i],
  armR: [/^upper_arm[._]?R$/i, /upper.?arm.*r$/i],
  foreL: [/^forearm[._]?L$/i, /(fore|lower).?arm.*l$/i],
  foreR: [/^forearm[._]?R$/i, /(fore|lower).?arm.*r$/i],
  legL: [/^thigh[._]?L$/i, /(thigh|upper.?leg).*l$/i],
  legR: [/^thigh[._]?R$/i, /(thigh|upper.?leg).*r$/i],
  shinL: [/^shin[._]?L$/i, /(shin|calf|lower.?leg).*l$/i],
  shinR: [/^shin[._]?R$/i, /(shin|calf|lower.?leg).*r$/i],
};

/** Flat box with baked fake light per face (top bright, sides darker) so it reads as 3D unlit. */
function shadedBox(w: number, h: number, d: number, hex: number, y = 0, x = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const base = new THREE.Color(hex).convertSRGBToLinear();
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (6 verts each)
  const shade = [0.78, 0.7, 1.0, 0.5, 0.86, 0.92];
  const col = new Float32Array(g.getAttribute('position').count * 3);
  for (let f = 0; f < 6; f++) for (let v = 0; v < 6; v++) {
    const i = (f * 6 + v) * 3;
    col[i] = base.r * shade[f]; col[i + 1] = base.g * shade[f]; col[i + 2] = base.b * shade[f];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g.translate(x, y, z);
  const m = new THREE.Mesh(g, worldMat);
  m.castShadow = false;
  return m;
}

const C = {
  coat: 0xe6b03c, coatDark: 0xc98f2a, pants: 0x34424f, boot: 0x2e2a28,
  skin: 0xe0b08c, beanie: 0xa8392e, beard: 0x6b4a33, eye: 0x1f2326,
};

function buildPlaceholder(): { root: THREE.Object3D; joints: Partial<Record<JointName, THREE.Object3D>> } {
  const root = new THREE.Group();
  const j = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const o = new THREE.Group(); o.name = name; o.position.set(x, y, z); parent.add(o); return o;
  };
  const hips = j('hips', root, 0, 0.78);
  hips.add(shadedBox(0.42, 0.16, 0.26, C.pants, 0.02));
  const spine = j('spine', hips, 0, 0.08);
  spine.add(shadedBox(0.48, 0.56, 0.32, C.coat, 0.28));
  spine.add(shadedBox(0.5, 0.08, 0.34, C.coatDark, 0.02)); // coat hem
  spine.add(shadedBox(0.06, 0.4, 0.02, C.coatDark, 0.3, 0, -0.165)); // zip
  const head = j('head', spine, 0, 0.58);
  head.add(shadedBox(0.36, 0.34, 0.34, C.skin, 0.19));
  head.add(shadedBox(0.38, 0.14, 0.36, C.beanie, 0.4));
  head.add(shadedBox(0.2, 0.08, 0.2, C.beanie, 0.5));
  head.add(shadedBox(0.34, 0.14, 0.06, C.beard, 0.07, 0, -0.17));
  head.add(shadedBox(0.07, 0.07, 0.06, C.skin, 0.17, 0, -0.2)); // nose
  head.add(shadedBox(0.05, 0.05, 0.02, C.eye, 0.25, -0.08, -0.175));
  head.add(shadedBox(0.05, 0.05, 0.02, C.eye, 0.25, 0.08, -0.175));
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'L' : 'R';
    const arm = j(`arm${side}`, spine, 0.3 * s, 0.5);
    arm.add(shadedBox(0.15, 0.32, 0.16, C.coat, -0.14));
    const fore = j(`fore${side}`, arm, 0, -0.29);
    fore.add(shadedBox(0.14, 0.26, 0.15, C.coat, -0.12));
    fore.add(shadedBox(0.11, 0.1, 0.11, C.skin, -0.29));
    const leg = j(`leg${side}`, hips, 0.11 * s, -0.02);
    leg.add(shadedBox(0.17, 0.4, 0.2, C.pants, -0.2));
    const shin = j(`shin${side}`, leg, 0, -0.38);
    shin.add(shadedBox(0.16, 0.3, 0.18, C.pants, -0.15));
    shin.add(shadedBox(0.18, 0.11, 0.28, C.boot, -0.33, 0, -0.04));
  }
  const joints: Partial<Record<JointName, THREE.Object3D>> = {};
  root.traverse((o) => { if (o.name in BONE_PATTERNS) joints[o.name as JointName] = o; });
  return { root, joints };
}

export interface AnimInput {
  speed: number; // m/s actually moved
  runFrac: number; // 0 walk .. 1 run
  turn: number; // rad/s yaw rate (lean into turns)
  lookYaw: number; // rad, head turn relative to body (clamped by caller)
  airborne: number; // 0..1 hop
}

export class PlayerCharacter {
  /** Positioned at the feet; yaw applied here. */
  root = new THREE.Group();
  /** Bob / squash layer. */
  private body = new THREE.Group();
  private modelHolder = new THREE.Group();
  private joints: Partial<Record<JointName, Joint>> = {};
  private phase = 0;
  private t = 0;
  private lookYaw = 0;
  private moveBlend = 0;
  source: 'placeholder' | 'glb' = 'placeholder';
  /** Fires on each footfall (left/right), with the current speed. */
  onStep: ((speed: number) => void) | null = null;

  constructor() {
    this.root.add(this.body);
    this.body.add(this.modelHolder);
    const ph = buildPlaceholder();
    this.setModel(ph.root, ph.joints, 0);
    this.tryLoadGlb();
  }

  private setModel(model: THREE.Object3D, objs: Partial<Record<JointName, THREE.Object3D>>, yaw: number) {
    this.modelHolder.clear();
    this.modelHolder.rotation.y = yaw;
    this.modelHolder.add(model);
    this.root.updateMatrixWorld(true);
    // Character axes in root space: right +X, up +Y, forward −Z.
    const inv = new THREE.Quaternion();
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    this.joints = {};
    for (const [k, o] of Object.entries(objs) as [JointName, THREE.Object3D][]) {
      const wq = o.getWorldQuaternion(new THREE.Quaternion());
      inv.copy(rootQ).invert().multiply(wq).invert(); // root-space → joint-local
      this.joints[k] = {
        obj: o, rest: o.quaternion.clone(),
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(inv),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(inv),
        fwd: new THREE.Vector3(0, 0, -1).applyQuaternion(inv),
      };
    }
  }

  private async tryLoadGlb() {
    const base = import.meta.env.BASE_URL;
    try {
      const r = await fetch(`${base}models/models.json`, { cache: 'no-store' });
      if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return;
      const m = await r.json();
      if (!m?.skipper) return;
      const gltf = await new GLTFLoader().loadAsync(`${base}models/${m.skipper}`);
      const scene = gltf.scene;
      const body: THREE.Object3D[] = [];
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          if (mesh.geometry.getAttribute('color')) mesh.material = worldMat;
          mesh.frustumCulled = false;
          if (/rod/i.test(mesh.name)) mesh.visible = false; // the rod stays on the boat
          else body.push(mesh);
        }
      });
      // The rig is authored with its origin at the soles; only rescale if it is way off.
      const box = () => { scene.updateMatrixWorld(true); const b = new THREE.Box3(); for (const o of body) b.expandByObject(o); return b; };
      const bb = box();
      const h = bb.max.y - bb.min.y;
      if (h > 0.01 && (h < 1.2 || h > 2.4)) scene.scale.multiplyScalar(SKIPPER_HEIGHT / h);
      if (Math.abs(box().min.y) > 0.15) scene.position.y -= box().min.y;
      const bones: THREE.Object3D[] = [];
      scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o); });
      const objs: Partial<Record<JointName, THREE.Object3D>> = {};
      const used = new Set<THREE.Object3D>();
      for (const k of Object.keys(BONE_PATTERNS) as JointName[]) {
        for (const re of BONE_PATTERNS[k]) {
          const b = bones.find((x) => !used.has(x) && re.test(x.name));
          if (b) { objs[k] = b; used.add(b); break; }
        }
      }
      console.info('[onfoot] skipper.glb bones', bones.map((b) => b.name).join(','), '→', Object.fromEntries(Object.entries(objs).map(([k, v]) => [k, v!.name])));
      this.setModel(scene, objs, SKIPPER_MODEL_YAW);
      this.source = 'glb';
    } catch (e) {
      console.warn('[onfoot] skipper.glb unavailable, using placeholder', e);
    }
  }

  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  /** Set a joint to rest * rot(right, a) * rot(fwd, roll) * rot(up, yaw). */
  private pose(name: JointName, pitch: number, roll = 0, yaw = 0) {
    const jn = this.joints[name];
    if (!jn) return;
    jn.obj.quaternion.copy(jn.rest);
    if (pitch) jn.obj.quaternion.multiply(this.q.setFromAxisAngle(jn.right, pitch));
    if (roll) jn.obj.quaternion.multiply(this.q2.setFromAxisAngle(jn.fwd, roll));
    if (yaw) jn.obj.quaternion.multiply(this.q.setFromAxisAngle(jn.up, yaw));
  }

  update(dt: number, a: AnimInput) {
    this.t += dt;
    const moving = Math.min(1, a.speed / 1.2);
    this.moveBlend += (moving - this.moveBlend) * Math.min(1, dt * 10);
    const mb = this.moveBlend;
    const stride = THREE.MathUtils.lerp(1.15, 1.9, a.runFrac); // metres per full cycle
    const prev = this.phase;
    this.phase += (a.speed * dt / stride) * Math.PI * 2;
    // footfall when sin(phase) crosses zero
    if (a.speed > 0.3 && Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) this.onStep?.(a.speed);
    const ph = this.phase;
    const s = Math.sin(ph);
    const legAmp = THREE.MathUtils.lerp(0.5, 0.85, a.runFrac) * mb;
    const knee = THREE.MathUtils.lerp(0.45, 1.0, a.runFrac) * mb;
    this.pose('legL', s * legAmp);
    this.pose('legR', -s * legAmp);
    this.pose('shinL', -knee * Math.max(0, Math.sin(ph + 1.9)) - 0.05);
    this.pose('shinR', -knee * Math.max(0, Math.sin(ph + 1.9 + Math.PI)) - 0.05);
    const armAmp = THREE.MathUtils.lerp(0.45, 0.8, a.runFrac) * mb;
    const breathe = Math.sin(this.t * 1.7) * (1 - mb);
    this.pose('armL', -s * armAmp + 0.04 * breathe, 0.1 + 0.03 * breathe);
    this.pose('armR', s * armAmp + 0.04 * breathe, -0.1 - 0.03 * breathe);
    const elbow = 0.2 + THREE.MathUtils.lerp(0.25, 1.1, a.runFrac) * mb;
    this.pose('foreL', elbow);
    this.pose('foreR', elbow);
    const lean = -(0.06 + 0.12 * a.runFrac) * mb;
    this.pose('spine', lean + 0.025 * breathe, THREE.MathUtils.clamp(-a.turn * 0.06, -0.15, 0.15), -s * 0.12 * mb);
    this.pose('hips', 0, 0, s * 0.1 * mb);
    // Head: look toward targets, counter the torso lean.
    this.lookYaw += (a.lookYaw - this.lookYaw) * Math.min(1, dt * 5);
    this.pose('head', -lean * 0.6 + 0.04 * Math.sin(this.t * 0.8) * (1 - mb), 0, this.lookYaw);

    // Sneaky-Sasquatch bounce: a hop on every step + squash on landing; airborne stretch.
    const bounce = Math.abs(s) * THREE.MathUtils.lerp(0.045, 0.1, a.runFrac) * mb;
    const squash = 1 + (Math.abs(Math.cos(ph)) - 0.5) * 0.09 * mb + 0.012 * breathe + a.airborne * 0.08;
    this.body.position.y = bounce;
    this.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  }
}
