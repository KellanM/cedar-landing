import * as THREE from 'three';

const NEAR = 260; // m: objects further than this from the camera hold still

interface Anim { bob: number; tilt: number; freq: number; yaw: number }
const ANIMS: Record<string, Anim> = {
  bob: { bob: 0.05, tilt: 0.035, freq: 1.2, yaw: 0.02 }, // moored boats, canoes, flotsam
  buoy: { bob: 0.08, tilt: 0.13, freq: 1.6, yaw: 0.05 }, // buoys rock harder
  kelp: { bob: 0.03, tilt: 0.07, freq: 0.5, yaw: 0.12 }, // bull-kelp heads sway slowly
};

interface Item { o: THREE.Object3D; base: THREE.Vector3; q0: THREE.Quaternion; a: Anim; ph: number; ph2: number }

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
      this.items.push({ o, base, q0: o.quaternion.clone(), a, ph, ph2: ph * 1.7 + 1 });
      this.group.add(o);
    }
  }

  get count() { return this.items.length; }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    const t = this.t;
    for (const it of this.items) {
      const b = it.base;
      if (Math.abs(b.x - cam.x) > NEAR || Math.abs(b.z - cam.z) > NEAR) continue;
      const a = it.a, w = a.freq;
      it.o.position.set(b.x, b.y + Math.sin(t * w * 1.3 + it.ph) * a.bob + Math.sin(t * w * 2.1 + it.ph2) * a.bob * 0.4, b.z);
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
