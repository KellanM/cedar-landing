import * as THREE from 'three';
import { WATER } from './tide';

const NEAR = 260; // m: objects further than this from the camera hold still

interface Anim { bob: number; tilt: number; freq: number; yaw: number }
const ANIMS: Record<string, Anim> = {
  bob: { bob: 0.05, tilt: 0.035, freq: 1.2, yaw: 0.02 }, // moored boats, canoes, flotsam
  buoy: { bob: 0.08, tilt: 0.13, freq: 1.6, yaw: 0.05 }, // buoys rock harder
  kelp: { bob: 0.03, tilt: 0.07, freq: 0.5, yaw: 0.12 }, // bull-kelp heads sway slowly
};

interface Item { o: THREE.Object3D; base: THREE.Vector3; q0: THREE.Quaternion; a: Anim; ph: number; ph2: number; s0: THREE.Vector3; gone: boolean; lift: number; floats: boolean; ground: number }

/**
 * Bobs / rocks the nodes from world/dynamic.glb by their extras.anim, each with its own phase.
 * Bell buoys: a child named *bell* (if present) could swing later; for now the whole buoy rocks.
 */
export class Floaters {
  group = new THREE.Group();
  private items: Item[] = [];
  private t = 0;
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();

  constructor(nodes: THREE.Object3D[]) {
    this.group.name = 'dynamic';
    for (const o of nodes) {
      const raw = String(o.userData.anim ?? o.children[0]?.userData.anim ?? (/kelp/i.test(o.name) ? 'kelp' : /buoy/i.test(o.name) ? 'buoy' : 'bob')).toLowerCase();
      const a = ANIMS[raw] ?? ANIMS.bob;
      const base = o.position.clone();
      // phase from position so the same object always moves the same way
      const ph = (Math.sin(base.x * 12.9898 + base.z * 78.233) * 43758.5453) % 6.283;
      this.items.push({ o, base, q0: o.quaternion.clone(), a, ph, ph2: ph * 1.7 + 1, s0: o.scale.clone(), gone: false, lift: -1, floats: base.y < 0.2, ground: NaN });
      this.group.add(o);
    }
  }

  get count() { return this.items.length; }

  /** the floater whose node name contains `key` (e.g. "LIFE_F04_Flotsam") */
  private find(key: string) { return this.items.find((it) => it.o.name.includes(key)); }
  /** full node name for a key ("LIFE_F04_Flotsam" → "LIFE_F04_Flotsam_bottle") */
  nameOf(key: string) { return this.find(key)?.o.name ?? null; }
  /** collected flotsam: hidden (or shown again when it drifts back) */
  setGone(key: string, gone: boolean) {
    const it = this.find(key);
    if (!it || it.gone === gone) return;
    it.gone = gone; it.lift = -1;
    it.o.visible = !gone;
    it.o.scale.copy(it.s0); it.o.updateMatrix();
  }
  /** hauled aboard: rises out of the water toward `to`, shrinks and is gone (~0.7 s) */
  collect(key: string, to?: THREE.Vector3) {
    const it = this.find(key);
    if (!it || it.gone) return;
    it.gone = true; it.lift = 0;
    if (to) this.liftTo.set(it.o.uuid, to.clone());
  }
  private liftTo = new Map<string, THREE.Vector3>();

  /** Tides: ground height under (x,z) (world y), so things afloat settle on the mud instead of sinking. */
  floor: ((x: number, z: number) => number) | null = null;
  /** Tides: how far a floating item sits from its exported height now (follows the water, never below the ground). */
  private tideDy(it: Item) {
    if (!it.floats) return 0;
    if (it.ground !== it.ground) it.ground = this.floor ? this.floor(it.base.x, it.base.z) : -99;
    return Math.max(WATER.y, Math.min(0, it.ground + 0.08 - it.base.y));
  }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    const t = this.t;
    for (const it of this.items) {
      const b = it.base;
      const ty = this.tideDy(it);
      if (it.gone) {
        if (it.lift < 0) continue;
        // lift: up out of the water, drift toward the boat, shrink away
        it.lift = Math.min(1, it.lift + dt / 0.7);
        const k = it.lift, to = this.liftTo.get(it.o.uuid);
        const x = to ? b.x + (to.x - b.x) * k * k : b.x, z = to ? b.z + (to.z - b.z) * k * k : b.z;
        it.o.position.set(x, b.y + ty + Math.sin(k * Math.PI) * 1.1 + k * 0.6, z);
        it.o.scale.copy(it.s0).multiplyScalar(Math.max(0.001, 1 - k * k));
        it.o.updateMatrix();
        if (k >= 1) { it.lift = -1; it.o.visible = false; this.liftTo.delete(it.o.uuid); }
        continue;
      }
      if (Math.abs(b.x - cam.x) > NEAR || Math.abs(b.z - cam.z) > NEAR) {
        // far: no bobbing, but still at the water level
        if (it.floats && Math.abs(it.o.position.y - (b.y + ty)) > 0.02) { it.o.position.y = b.y + ty; it.o.updateMatrix(); }
        continue;
      }
      const a = it.a, w = a.freq;
      it.o.position.set(b.x, b.y + ty + Math.sin(t * w * 1.3 + it.ph) * a.bob + Math.sin(t * w * 2.1 + it.ph2) * a.bob * 0.4, b.z);
      this.e.set(
        Math.sin(t * w + it.ph) * a.tilt,
        Math.sin(t * w * 0.3 + it.ph2) * a.yaw,
        Math.sin(t * w * 0.83 + it.ph2) * a.tilt * 0.8,
      );
      this.q.setFromEuler(this.e);
      it.o.quaternion.copy(it.q0).multiply(this.q);
      it.o.updateMatrix(); // world meshes have matrixAutoUpdate off
    }
  }
}
