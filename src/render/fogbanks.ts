import * as THREE from 'three';
import { WIND } from './smoke';

const RING_MIN = 45, RING_MAX = 230; // m from the camera
const CLEAR_NEAR = 22, CLEAR_FAR = 70; // banks fade out inside this radius (the "clearing")

/** Flattened faceted billow with baked facet shading (unlit style). */
function billowGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const L = new THREE.Vector3(0.3, 0.9, 0.3).normalize();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(e.subVectors(a, b)).normalize();
    const shade = 0.86 + 0.14 * Math.max(0, n.dot(L));
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = shade; col[(i + k) * 3 + 1] = shade; col[(i + k) * 3 + 2] = shade; }
  }
  // flatten the bottom so banks sit on the water
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.2) pos.setY(i, -0.2);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

/**
 * Low-lying stylized fog banks: layered, slightly transparent faceted billows at water level
 * (2–15 m tall) on a ring around the camera, drifting with the wind and fading out near the
 * player so you sail inside a clearing. Off unless the time-of-day preset asks for it.
 */
export class FogBanks {
  mesh: THREE.InstancedMesh;
  private n: number;
  private x: Float32Array; private z: Float32Array;
  private sx: Float32Array; private sy: Float32Array; private sz: Float32Array; private ry: Float32Array; private y: Float32Array;
  private mat: THREE.MeshBasicMaterial;
  private uClear = { value: new THREE.Vector2(CLEAR_NEAR, CLEAR_FAR) };
  private active = 0; // instances in use
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private placed = false;

  constructor(low: boolean) {
    this.n = low ? 16 : 34;
    const n = this.n;
    this.x = new Float32Array(n); this.z = new Float32Array(n); this.y = new Float32Array(n);
    this.sx = new Float32Array(n); this.sy = new Float32Array(n); this.sz = new Float32Array(n); this.ry = new Float32Array(n);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });
    const uClear = this.uClear;
    this.mat.onBeforeCompile = (sh) => {
      sh.uniforms.uClear = uClear;
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'varying float vCamD;\nvoid main() {')
        .replace('#include <project_vertex>', '#include <project_vertex>\n vCamD = length(mvPosition.xyz);');
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform vec2 uClear;\nvarying float vCamD;\nvoid main() {')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.a *= smoothstep(uClear.x, uClear.y, vCamD);');
    };
    this.mat.customProgramCacheKey = () => 'fogbank-v1';
    this.mesh = new THREE.InstancedMesh(billowGeometry(), this.mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'fog_banks';
    this.mesh.visible = false;
  }

  /**
   * density 0 = off, ~0.35 = light morning wisps (overcast), 1 = full fog preset.
   * color = the haze colour; banks are drawn a little lighter than it.
   */
  set(density: number, haze: string) {
    this.active = Math.round(this.n * Math.min(1, density));
    this.mesh.visible = this.active > 0;
    this.mesh.count = this.active;
    this.mat.opacity = 0.32 + 0.33 * Math.min(1, density);
    this.mat.color.set(haze).lerp(new THREE.Color(0xffffff), 0.35);
    this.uClear.value.set(density >= 1 ? CLEAR_NEAR : CLEAR_NEAR + 15, density >= 1 ? CLEAR_FAR : CLEAR_FAR + 30);
  }

  private place(i: number, cx: number, cz: number, anywhere: boolean) {
    // anywhere: initial scatter on the ring; else respawn upwind
    let a: number;
    if (anywhere) a = Math.random() * Math.PI * 2;
    else a = Math.atan2(-WIND.y, -WIND.x) + (Math.random() - 0.5) * 2.2;
    const r = anywhere ? RING_MIN + Math.random() * (RING_MAX - RING_MIN) : RING_MAX * (0.85 + Math.random() * 0.15);
    this.x[i] = cx + Math.cos(a) * r;
    this.z[i] = cz + Math.sin(a) * r;
    this.sx[i] = 18 + Math.random() * 30;
    this.sz[i] = 10 + Math.random() * 16;
    this.sy[i] = 2 + Math.random() * 6; // with y offset: tops between ~2 and 15 m
    this.y[i] = Math.random() * 6;
    this.ry[i] = Math.random() * Math.PI;
  }

  update(dt: number, cam: THREE.Vector3) {
    if (!this.mesh.visible) return;
    if (!this.placed) { for (let i = 0; i < this.n; i++) this.place(i, cam.x, cam.z, true); this.placed = true; }
    const dx = WIND.x * 0.8 * dt, dz = WIND.y * 0.8 * dt;
    for (let i = 0; i < this.active; i++) {
      this.x[i] += dx; this.z[i] += dz;
      const ox = this.x[i] - cam.x, oz = this.z[i] - cam.z;
      const d2 = ox * ox + oz * oz;
      if (d2 > (RING_MAX + 40) ** 2) this.place(i, cam.x, cam.z, d2 > (RING_MAX * 2) ** 2); // teleported: rescatter
      this.e.set(0, this.ry[i], 0);
      this.q.setFromEuler(this.e);
      this.v.set(this.x[i], this.y[i] * 0.6, this.z[i]);
      this.s.set(this.sx[i], this.sy[i], this.sz[i]);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
