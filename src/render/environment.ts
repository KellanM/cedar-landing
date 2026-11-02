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

/** Flat sea: a large far plane plus a near patch with a cheap vertex wave and crest shading. */
export class Sea {
  group = new THREE.Group();
  near: THREE.Mesh;
  far: THREE.Mesh;
  private time = { value: 0 };
  private mat: THREE.MeshBasicMaterial;
  private farMat: THREE.MeshBasicMaterial;
  wavesEnabled = true;
  constructor() {
    this.mat = new THREE.MeshBasicMaterial({ color: 0x4e6670, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    const uTime = this.time;
    this.mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = uTime;
      s.vertexShader = s.vertexShader
        .replace('void main() {', 'uniform float uTime;\nvarying float vWave;\nvoid main() {')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float w = sin(wp.x * 0.21 + uTime * 0.9) * 0.5 + sin(wp.z * 0.17 - uTime * 0.7) * 0.35 + sin((wp.x + wp.z) * 0.43 + uTime * 1.6) * 0.15;
          float fade = 1.0 - smoothstep(60.0, 140.0, length(wp.xz - cameraPosition.xz));
          transformed.z += w * 0.07 * fade;
          vWave = w * fade;`,
        );
      s.fragmentShader = s.fragmentShader
        .replace('void main() {', 'varying float vWave;\nvoid main() {')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 1.0 + vWave * 0.045;');
    };
    // XY plane; the mesh is rotated so local +z is world up (the wave displaces local z).
    const nearG = new THREE.PlaneGeometry(320, 320, 64, 64);
    this.near = new THREE.Mesh(nearG, this.mat);
    this.near.rotation.x = -Math.PI / 2;
    this.near.position.y = -0.06;
    this.near.renderOrder = -2;
    this.farMat = new THREE.MeshBasicMaterial({ color: 0x4e6670, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
    const farG = new THREE.RingGeometry(150, 30000, 48, 1);
    this.far = new THREE.Mesh(farG, this.farMat);
    this.far.rotation.x = -Math.PI / 2;
    this.far.position.y = -0.08;
    this.far.renderOrder = -3;
    this.near.frustumCulled = false;
    this.far.frustumCulled = false;
    this.group.add(this.near, this.far);
  }
  apply(t: TimeOfDay) {
    this.mat.color.set(t.sea);
    this.farMat.color.set(t.sea);
  }
  update(dt: number, focus: THREE.Vector3) {
    if (this.wavesEnabled) this.time.value += dt;
    // Snap to a 5 m grid so the wave pattern does not swim with the camera.
    const sx = Math.round(focus.x / 5) * 5, sz = Math.round(focus.z / 5) * 5;
    this.near.position.x = sx; this.near.position.z = sz;
    this.far.position.x = sx; this.far.position.z = sz;
  }
}
