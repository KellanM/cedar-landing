import * as THREE from 'three';

/**
 * Sea spray (ocean pass 2, docs/ocean_study.md): flecks thrown off breaking crests, spindrift
 * blown along the wind in dangerous seas, and bursts over the bow when it buries itself in a wave.
 * One instanced draw call, CPU-simulated (≤ 220 flecks), drawn as crisp off-white drops (our crest
 * colour, no soft particles). Off on low quality.
 */

const MAX = 220;

const VERT = /* glsl */ `
attribute vec4 iP; // world xyz, size (m)
attribute vec4 iQ; // stretch dir xyz (world, along the velocity), alpha
varying vec2 vP;
varying float vA;
#include <fog_pars_vertex>
void main() {
  vP = position.xy;
  vA = iQ.w;
  vec4 mv = viewMatrix * vec4(iP.xyz, 1.0);
  // camera-facing, stretched along the (view-space) velocity: drops read as flung water, not dots
  vec3 sv = (viewMatrix * vec4(iQ.xyz, 0.0)).xyz;
  vec2 d = length(sv.xy) > 1e-4 ? normalize(sv.xy) : vec2(0.0, 1.0);
  float st = 1.0 + clamp(length(iQ.xyz) * 0.25, 0.0, 2.2);
  vec2 off = d * position.y * iP.w * st + vec2(-d.y, d.x) * position.x * iP.w;
  mv.xy += off;
  vec4 mvPosition = mv;
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform vec3 uCol;
varying vec2 vP;
varying float vA;
#include <fog_pars_fragment>
void main() {
  float r = length(vP);
  float w = fwidth(r) + 1e-3;
  float a = (1.0 - smoothstep(0.85 - w, 0.85 + w, r)) * vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; age: number; life: number; g: number; alive: boolean }

export class SprayFX {
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private iP: THREE.InstancedBufferAttribute;
  private iQ: THREE.InstancedBufferAttribute;
  private pool: P[] = [];
  enabled = true;
  readonly uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCol: { value: new THREE.Color(0xf1f3ee) } }]);

  constructor() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iP = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iQ = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iP', this.iP); g.setAttribute('iQ', this.iQ);
    g.instanceCount = 0;
    this.geo = g;
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'sea_spray';
    for (let i = 0; i < MAX; i++) this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0.1, age: 0, life: 1, g: 9.8, alive: false });
  }

  get count() { return this.pool.reduce((n, p) => n + (p.alive ? 1 : 0), 0); }

  /** n flecks from (x, y, z) with a base velocity, a random spread (m/s), size (m), gravity scale. */
  burst(x: number, y: number, z: number, vx: number, vy: number, vz: number, n: number, spread: number, size = 0.12, grav = 1, life = 0.9) {
    if (!this.enabled) return;
    for (let k = 0; k < n; k++) {
      const p = this.pool.find((q) => !q.alive);
      if (!p) return;
      Object.assign(p, {
        x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4,
        vx: vx + (Math.random() - 0.5) * spread, vy: vy + Math.random() * spread * 0.7, vz: vz + (Math.random() - 0.5) * spread,
        s: size * (0.6 + Math.random() * 0.8), age: 0, life: life * (0.7 + Math.random() * 0.6), g: 9.8 * grav, alive: true,
      });
    }
  }

  update(dt: number, foam?: THREE.Color) {
    if (foam) (this.uniforms.uCol.value as THREE.Color).copy(foam);
    let n = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      p.vy -= p.g * dt;
      const drag = Math.exp(-0.8 * dt);
      p.vx *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.age / p.life;
      this.iP.setXYZW(n, p.x, p.y, p.z, p.s * (1 - 0.5 * t));
      this.iQ.setXYZW(n, p.vx, p.vy, p.vz, Math.min(1, (1 - t) * 1.6));
      n++;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) { this.iP.needsUpdate = true; this.iQ.needsUpdate = true; }
  }
}
