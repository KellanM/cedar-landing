import * as THREE from 'three';
import { WATER } from './tide';
import { SWELL, swellAt } from './swell';

const NEAR = 260; // m: objects further than this from the camera hold still

interface Anim { bob: number; tilt: number; freq: number; yaw: number }
const ANIMS: Record<string, Anim> = {
  bob: { bob: 0.05, tilt: 0.035, freq: 1.2, yaw: 0.02 }, // moored boats, canoes, flotsam
  buoy: { bob: 0.08, tilt: 0.13, freq: 1.6, yaw: 0.05 }, // buoys rock harder
  kelp: { bob: 0.03, tilt: 0.07, freq: 0.5, yaw: 0.12 }, // bull-kelp heads sway slowly
  // tides (exporter: parts/scripts_web/export_web.py): floating structures ride the water with a slow, heavy roll;
  // water-surface decals (shallows plates, surf pads, the Race's foam lines) sit on the water exactly; a gangway
  // hinges at its pier end (sheared so its float end follows the float)
  float: { bob: 0.012, tilt: 0.004, freq: 0.45, yaw: 0 },
  surface: { bob: 0, tilt: 0, freq: 0, yaw: 0 },
  gangway: { bob: 0, tilt: 0, freq: 0, yaw: 0 },
};

interface Item {
  o: THREE.Object3D; base: THREE.Vector3; q0: THREE.Quaternion; a: Anim; ph: number; ph2: number; s0: THREE.Vector3; gone: boolean; lift: number; floats: boolean; ground: number;
  kind: string; box: THREE.Box3; m0: THREE.Matrix4;
  /** gangway: hinge (pier end) xz, unit-length-scaled axis toward the float end, and the float it rests on */
  hinge?: { x: number; z: number; ux: number; uz: number; float: Item | null };
  /** the current tide offset (m) applied to this item */
  dy: number;
}

/**
 * Bobs / rocks the nodes from world/dynamic.glb by their extras.anim, each with its own phase.
 * Bell buoys: a child named *bell* (if present) could swing later; for now the whole buoy rocks.
 */
export class Floaters {
  group = new THREE.Group();
  private items: Item[] = [];
  private t = 0;
  private e = new THREE.Euler();
  private sh = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(nodes: THREE.Object3D[]) {
    this.group.name = 'dynamic';
    for (const o of nodes) {
      const raw = String(o.userData.anim ?? o.children[0]?.userData.anim ?? (/kelp/i.test(o.name) ? 'kelp' : /buoy/i.test(o.name) ? 'buoy' : 'bob')).toLowerCase();
      const a = ANIMS[raw] ?? ANIMS.bob;
      const base = o.position.clone();
      // phase from position so the same object always moves the same way
      const ph = (Math.sin(base.x * 12.9898 + base.z * 78.233) * 43758.5453) % 6.283;
      o.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(o);
      const tidal = raw === 'float' || raw === 'surface' || raw === 'gangway';
      this.items.push({ o, base, q0: o.quaternion.clone(), a, ph, ph2: ph * 1.7 + 1, s0: o.scale.clone(), gone: false, lift: -1, floats: tidal || base.y < 0.2, ground: NaN, kind: raw, box, m0: o.matrix.clone(), dy: 0 });
      this.group.add(o);
    }
    // gangways: the end nearest a float rides it, the other end (on the fixed pier) is the hinge
    for (const g of this.items) {
      if (g.kind !== 'gangway') continue;
      const c = g.box.getCenter(new THREE.Vector3()), sz = g.box.getSize(new THREE.Vector3());
      const alongX = sz.x >= sz.z;
      const e1 = alongX ? new THREE.Vector2(g.box.min.x, c.z) : new THREE.Vector2(c.x, g.box.min.z);
      const e2 = alongX ? new THREE.Vector2(g.box.max.x, c.z) : new THREE.Vector2(c.x, g.box.max.z);
      let best: Item | null = null, bd = Infinity, floatEnd = e2, hingeEnd = e1;
      for (const f of this.items) {
        if (f.kind !== 'float') continue;
        const fc = f.box.getCenter(new THREE.Vector3());
        for (const [a, b] of [[e1, e2], [e2, e1]] as const) {
          const d = Math.hypot(a.x - fc.x, a.y - fc.z);
          if (d < bd) { bd = d; best = f; floatEnd = a; hingeEnd = b; }
        }
      }
      if (bd > 25) best = null;
      const dx = floatEnd.x - hingeEnd.x, dz = floatEnd.y - hingeEnd.y, l2 = dx * dx + dz * dz || 1;
      g.hinge = { x: hingeEnd.x, z: hingeEnd.y, ux: dx / l2, uz: dz / l2, float: best };
    }
  }

  /** Tidal items (floats, gangways, surface decals) for walking / NPCs: their rest box and current offset. */
  get tidalItems() { return this.items.filter((it) => it.kind === 'float' || it.kind === 'gangway'); }
  /** The vertical tide offset at (x,z) on a float or gangway (0 if none). For a gangway it varies along its length. */
  offsetOf(it: { kind: string; dy: number; hinge?: Item['hinge'] }, x: number, z: number) {
    if (it.kind !== 'gangway' || !it.hinge) return it.dy;
    const h = it.hinge, f = h.float ? h.float.dy : 0;
    const t = Math.min(1, Math.max(0, (x - h.x) * h.ux + (z - h.z) * h.uz));
    return f * t;
  }
  /** Something standing at (x,y,z) on a float deck: how far the tide has moved that float (0 when not on one). */
  floatDyAt(x: number, y: number, z: number) {
    for (const it of this.items) {
      if (it.kind !== 'float' && it.kind !== 'gangway') continue;
      const b = it.box;
      if (x < b.min.x - 0.3 || x > b.max.x + 0.3 || z < b.min.z - 0.3 || z > b.max.z + 0.3 || y < b.min.y - 0.5 || y > b.max.y + 0.5) continue;
      return this.offsetOf(it, x, z);
    }
    return 0;
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
    if (it.kind === 'surface') return WATER.y; // the water itself
    if (it.kind === 'gangway') return 0; // sheared in update()
    if (it.ground !== it.ground) {
      const c = it.box.getCenter(new THREE.Vector3());
      it.ground = this.floor ? this.floor(c.x, c.z) : -99;
    }
    if (it.kind === 'float') {
      // a float's draft: its hull bottom, ignoring anchor chains / guide posts that reach the seabed
      const bottom = Math.max(it.box.min.y, -1);
      return Math.max(WATER.y, Math.min(0, it.ground + 0.05 - bottom));
    }
    return Math.max(WATER.y, Math.min(0, it.ground + 0.08 - it.base.y));
  }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    const t = this.t;
    for (const it of this.items) {
      const b = it.base;
      const ty = this.tideDy(it);
      it.dy = ty;
      if (it.kind === 'gangway') {
        // shear y' = y + f·t(x,z): the float end follows its float, the pier end stays on the pier
        const h = it.hinge;
        if (!h) continue;
        const f = h.float ? h.float.dy : 0;
        if (Math.abs(f - (it.o.userData.tideF ?? 0)) < 0.002) continue;
        it.o.userData.tideF = f;
        this.sh.set(1, 0, 0, 0, f * h.ux, 1, f * h.uz, -f * (h.x * h.ux + h.z * h.uz), 0, 0, 1, 0, 0, 0, 0, 1);
        it.o.matrix.multiplyMatrices(this.sh, it.m0);
        it.o.matrixWorldNeedsUpdate = true;
        continue;
      }
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
      // ocean experiment (src/game/swell.ts): afloat items ride the swell and lean with its slope
      const sw = SWELL.on && it.floats && ty <= WATER.y + 1e-6 ? swellAt(b.x, b.z) : 0;
      let sx = 0, sz = 0;
      if (sw !== 0) { const e = 0.5; sx = (swellAt(b.x + e, b.z) - swellAt(b.x - e, b.z)) / (2 * e); sz = (swellAt(b.x, b.z + e) - swellAt(b.x, b.z - e)) / (2 * e); }
      it.o.position.set(b.x, b.y + ty + sw + Math.sin(t * w * 1.3 + it.ph) * a.bob + Math.sin(t * w * 2.1 + it.ph2) * a.bob * 0.4, b.z);
      this.e.set(
        Math.sin(t * w + it.ph) * a.tilt + Math.atan(sz) * 0.8,
        Math.sin(t * w * 0.3 + it.ph2) * a.yaw,
        Math.sin(t * w * 0.83 + it.ph2) * a.tilt * 0.8 - Math.atan(sx) * 0.8,
      );
      this.q.setFromEuler(this.e);
      it.o.quaternion.copy(it.q0).multiply(this.q);
      it.o.updateMatrix(); // world meshes have matrixAutoUpdate off
    }
  }
}
