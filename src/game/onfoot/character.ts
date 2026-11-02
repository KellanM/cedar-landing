import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { worldMat } from '../../render/materials';
import { Spring } from '../npcs/rigpose';

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
    // stride from the real hip height (rigs differ: placeholder 0.78 m, skipper.glb ~0.75 m)
    const hip = objs.legL ?? objs.hips;
    if (hip) {
      const hy = hip.getWorldPosition(new THREE.Vector3()).y - this.root.getWorldPosition(new THREE.Vector3()).y;
      if (hy > 0.3 && hy < 1.4) this.legLen = hy;
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

  // ---- gait state (docs/study/people_animation.md, experiment E2)
  private lastSpeed = 0;
  private accelS = new Spring(0, 9, 0.45); // start/stop lean: under-damped so a stop overshoots, then settles
  private headLag = new Spring(0, 16, 0.55); // head trails the body bob (overlap)
  private armLag = new Spring(0, 14, 0.7); // arm swing trails the legs (overlap)
  private bodyRoll = new Spring(0, 8, 0.8); // lean into turns
  private glance = { t: 3, yaw: 0 };
  private glanceS = new Spring(0, 6, 0.9);
  /** hip-joint height above the soles (m); sets the stride so feet don't skate */
  legLen = 0.8;

  update(dt: number, a: AnimInput) {
    this.t += dt;
    const moving = Math.min(1, a.speed / 0.9);
    this.moveBlend += (moving - this.moveBlend) * Math.min(1, dt * 9);
    const mb = this.moveBlend;
    const run = a.runFrac;
    // Two key poses (contact / passing) driven by distance travelled, not time (Rosen's stride wheel).
    // Leg swing amplitude A gives a foot excursion of ~2·L·sin(A) per step; a cycle is two steps.
    const legAmp = THREE.MathUtils.lerp(0.42, 0.72, run);
    const stride = 4 * this.legLen * Math.sin(legAmp) * 0.92; // metres per full cycle
    const prev = this.phase;
    this.phase += (a.speed * dt / stride) * Math.PI * 2;
    if (a.speed > 0.3 && Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) this.onStep?.(a.speed);
    const ph = this.phase;
    const s = Math.sin(ph); // +1 = left leg forward contact, 0 = passing
    const c = Math.cos(ph);
    // legs: stance knee softens just after contact; swing knee folds most at passing
    const swingKneeL = Math.max(0, Math.sin(ph + 1.75)), swingKneeR = Math.max(0, Math.sin(ph + 1.75 + Math.PI));
    const knee = THREE.MathUtils.lerp(0.75, 1.35, run) * mb;
    const absorb = 0.05 * mb;
    this.pose('legL', s * legAmp * mb);
    this.pose('legR', -s * legAmp * mb);
    this.pose('shinL', -knee * swingKneeL - absorb * Math.max(0, Math.sin(ph - 1.2)) - 0.04);
    this.pose('shinR', -knee * swingKneeR - absorb * Math.max(0, Math.sin(ph - 1.2 + Math.PI)) - 0.04);
    // arms counter-swing, lagging the legs (overlap); elbows bend more on the forward swing (follow-through)
    const armAmp = THREE.MathUtils.lerp(0.38, 0.75, run) * mb;
    const arm = this.armLag.step(s, dt);
    const breathe = Math.sin(this.t * (Math.PI * 2 / 3.8));
    const idle = 1 - mb;
    const shift = Math.sin(this.t * (Math.PI * 2 / 9.5)) + 0.3 * Math.sin(this.t * (Math.PI * 2 / 4.1) + 1.1); // weight shift
    this.pose('armL', -arm * armAmp + 0.035 * breathe * idle, 0.09 + 0.025 * breathe * idle);
    this.pose('armR', arm * armAmp + 0.035 * breathe * idle, -0.09 - 0.025 * breathe * idle);
    const elbowBase = 0.22 + THREE.MathUtils.lerp(0.1, 1.05, run) * mb;
    this.pose('foreL', elbowBase + Math.max(0, -arm) * 0.35 * mb);
    this.pose('foreR', elbowBase + Math.max(0, arm) * 0.35 * mb);
    // start/stop: lean into acceleration; on a sudden stop the torso carries forward then settles back
    const acc = dt > 0 ? (a.speed - this.lastSpeed) / dt : 0;
    this.lastSpeed = a.speed;
    const accLean = this.accelS.step(THREE.MathUtils.clamp(Math.abs(acc) * 0.018, 0, 0.16), dt);
    const lean = -(0.05 + 0.13 * run) * mb - accLean;
    // turning: bank the whole body into the turn (scaled by speed), spine adds a little
    const bank = this.bodyRoll.step(THREE.MathUtils.clamp(-a.turn * a.speed * 0.022, -0.16, 0.16), dt);
    // pelvis: yaw with the forward leg, drop on the swing side; chest counter-rotates
    this.pose('hips', 0, (c * 0.05 * mb) + shift * 0.035 * idle, s * 0.13 * mb);
    this.pose('spine', lean + 0.022 * breathe * idle, THREE.MathUtils.clamp(-a.turn * 0.05, -0.12, 0.12) - c * 0.04 * mb - shift * 0.025 * idle, -s * 0.17 * mb);
    // head: looks at targets, otherwise glances around when idle; stays level against the body lean
    this.glance.t -= dt;
    if (this.glance.t <= 0) {
      this.glance.t = 2.5 + Math.random() * 4.5;
      this.glance.yaw = Math.random() < 0.4 ? 0 : (Math.random() - 0.5) * 1.1;
    }
    const gl = this.glanceS.step(Math.abs(a.lookYaw) > 0.01 || mb > 0.3 ? 0 : this.glance.yaw, dt);
    this.lookYaw += (a.lookYaw - this.lookYaw) * Math.min(1, dt * 5);
    // body bob: lowest at contact (legs apart), highest at passing; flatter when running (Rosen: half the step
    // time, a quarter of the fall), with a short flight bump for the run
    const bobA = THREE.MathUtils.lerp(0.008, 0.03, run) * mb; // run: a little flight at passing
    // Ground contact without foot IK: the hip joint stays at the rig's height, so a leg swung by angle θ lifts its
    // sole by L·(1−cos θ). Dropping the body by that amount keeps the planted foot on the deck at every phase
    // (both feet at contact, the stance foot at passing) — which is also the natural low-at-contact bob.
    const legAng = Math.abs(s) * legAmp * mb;
    const plant = -this.legLen * (1 - Math.cos(legAng));
    const bob = plant + bobA * (0.5 + 0.5 * Math.cos(2 * ph)); // small extra lift at passing
    const hl = this.headLag.step(bob, dt); // head trails the bob
    this.pose('head', -lean * 0.65 + 0.03 * Math.sin(this.t * 0.8) * idle + (hl - bob) * 2.2, 0, this.lookYaw + gl);
    // squash at contact, a touch of stretch at passing; airborne stretch for hops
    const contact = Math.pow(Math.abs(s), 6) * mb;
    const squash = 1 - 0.035 * contact + 0.012 * (1 - Math.abs(s)) * mb + 0.008 * breathe * idle + a.airborne * 0.07;
    this.body.position.y = bob - 0.012 * idle * (1 - breathe) * 0.3;
    this.body.position.x = c * 0.022 * mb + shift * 0.01 * idle; // weight over the stance foot
    this.body.rotation.z = bank;
    this.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  }
}
