import * as THREE from 'three';
import type { TimeOfDay } from '../world/types';

/** Gradient sky dome (vertex colours, horizon -> zenith). Excluded from fog. */
export class Sky {
  mesh: THREE.Mesh;
  private geom: THREE.SphereGeometry;
  constructor(radius = 14000) {
    this.geom = new THREE.SphereGeometry(radius, 32, 16);
    this.geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.geom.getAttribute('position').count * 3), 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.mesh = new THREE.Mesh(this.geom, mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }
  apply(t: TimeOfDay) {
    const z = new THREE.Color(t.zenith), h = new THREE.Color(t.horizon), haze = new THREE.Color(t.haze);
    const pos = this.geom.getAttribute('position'), col = this.geom.getAttribute('color');
    const r = this.geom.parameters.radius;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const e = pos.getY(i) / r; // -1..1
      if (e < 0) c.copy(haze); // below horizon: blend into haze so the sea edge has no seam
      else c.copy(h).lerp(z, Math.pow(Math.min(1, e / 0.55), 0.7));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }
  follow(p: THREE.Vector3) { this.mesh.position.set(p.x, 0, p.z); }
}

export { Sea } from './sea';
