import * as THREE from 'three';
import { waterHeight } from '../game/swell';

/**
 * Hull splashes (ocean pass 3, docs/ocean_study.md "Pass 3"), after Wind Waker's King of Red Lions:
 * round white puffs that pop and shrink, two crescent "crown" sheets that stand up beside the hull
 * and sink, droplets on little arcs that leave ring dimples where they land, and a broken foam ring
 * that spreads on the water. Flat, drawn, opaque shapes in the sea's foam / bead colours (no soft
 * mist), one instanced draw call, CPU-simulated from a fixed pool.
 *
 * Kinds: 0 puff (billboard) · 1 droplet (billboard, stretched along its velocity) · 2 crown sheet
 * (vertical, world-fixed) · 3 dimple ring (flat) · 4 foam burst ring (flat, broken).
 */

const VERT = /* glsl */ `
attribute vec4 iP; // world xyz, size (m)
attribute vec4 iA; // kind, life t 0..1, yaw (sheets/rings), aspect (sheet width / height)
attribute vec4 iV; // velocity xyz (droplet stretch), seed
varying vec2 vUv;
varying vec3 vK; // kind, t, seed
#include <fog_pars_vertex>
void main() {
  vUv = position.xy;
  vK = vec3(iA.x, iA.y, iV.w);
  float kind = iA.x;
  vec4 mvPosition;
  if (kind < 1.5) {
    mvPosition = viewMatrix * vec4(iP.xyz, 1.0);
    vec2 off = position.xy * iP.w;
    if (kind > 0.5) {
      vec3 sv = (viewMatrix * vec4(iV.xyz, 0.0)).xyz;
      vec2 d = length(sv.xy) > 1e-4 ? normalize(sv.xy) : vec2(0.0, 1.0);
      float st = 1.0 + clamp(length(iV.xyz) * 0.18, 0.0, 1.6);
      off = d * position.y * iP.w * st + vec2(-d.y, d.x) * position.x * iP.w;
    }
    mvPosition.xy += off;
  } else if (kind < 2.5) {
    // crown sheet: a vertical quad standing on the water, its bottom edge at iP.y
    vec3 right = vec3(cos(iA.z), 0.0, sin(iA.z));
    vec3 wp = iP.xyz + right * position.x * iP.w * iA.w + vec3(0.0, (position.y * 0.5 + 0.5) * iP.w, 0.0);
    mvPosition = viewMatrix * vec4(wp, 1.0);
  } else {
    float c = cos(iA.z), s = sin(iA.z);
    vec2 r = mat2(c, -s, s, c) * position.xy;
    mvPosition = viewMatrix * vec4(iP.xyz + vec3(r.x, 0.0, r.y) * iP.w, 1.0);
  }
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uFoam;
uniform vec3 uBead;
varying vec2 vUv;
varying vec3 vK;
#include <fog_pars_fragment>
float hh(float n) { return fract(sin(n * 91.345) * 47453.5453); }
float aa(float d) { return clamp(0.5 - d / max(fwidth(d), 1e-4), 0.0, 1.0); } // fill where d < 0
void main() {
  float kind = vK.x, t = vK.y, seed = vK.z;
  vec3 col = uFoam;
  float a = 0.0;
  if (kind < 0.5) {
    // puff: a white disc with a faint blue-grey rim (the size anim is on the CPU)
    float r = length(vUv);
    a = aa(r - 0.86);
    col = mix(uFoam, uBead, aa(0.7 - r) * 0.5); // rim: r > 0.7
  } else if (kind < 1.5) {
    a = aa(length(vUv) - 0.8);
  } else if (kind < 2.5) {
    // crown: a crescent arch, open side down; it thins (erodes) as it sinks
    float x = vUv.x * 0.5 + 0.5, y = vUv.y * 0.5 + 0.5;
    float outer = sin(3.14159 * clamp(x, 0.0, 1.0));
    float th = mix(0.42, 0.08, smoothstep(0.35, 1.0, t)) * (0.6 + 0.4 * outer);
    float d = max(y - outer, (outer - th) - y);
    d = max(d, abs(vUv.x) - 1.0);
    a = aa(d * 0.6);
    col = mix(uFoam, uBead, smoothstep(0.55, 0.0, y) * 0.35); // a touch of water colour at its foot
  } else if (kind < 3.5) {
    // droplet dimple: a thin ring
    float r = length(vUv);
    a = aa(abs(r - 0.78) - mix(0.12, 0.03, t));
    col = mix(uFoam, uBead, 0.3);
  } else {
    // foam burst: a broken ring that thins as it spreads
    float r = length(vUv);
    float ang = atan(vUv.y, vUv.x);
    float seg = floor((ang + 3.14159) / 6.28318 * 11.0);
    float keep = step(0.28 + 0.4 * t, hh(seg + seed * 13.0));
    float w = mix(0.14, 0.03, t);
    a = aa(abs(r - 0.8) - w) * keep;
    col = mix(uFoam, uBead, 0.25 + 0.4 * t);
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

interface P {
  kind: number; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  s0: number; age: number; life: number; g: number; yaw: number; aspect: number; seed: number; alive: boolean;
}

export class HullSplash {
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private iP: THREE.InstancedBufferAttribute;
  private iA: THREE.InstancedBufferAttribute;
  private iV: THREE.InstancedBufferAttribute;
  private pool: P[] = [];
  readonly uniforms: Record<string, THREE.IUniform>;
  /** low quality: spawn counts are halved by the caller (see `scale`) */
  low = false;
  /** debug: emitted this session */
  spawned = 0;

  constructor(max = 256) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iP = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iV = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iP', this.iP); g.setAttribute('iA', this.iA); g.setAttribute('iV', this.iV);
    g.instanceCount = 0;
    this.geo = g;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uFoam: { value: new THREE.Color(0xf1f3ee) }, uBead: { value: new THREE.Color(0xb8c6c4) } }]);
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'hull_splash';
    for (let i = 0; i < max; i++) this.pool.push({ kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0.3, age: 0, life: 1, g: 0, yaw: 0, aspect: 1, seed: 0, alive: false });
  }

  /** count multiplier for the quality level */
  get scale() { return this.low ? 0.5 : 1; }
  get count() { return this.pool.reduce((n, p) => n + (p.alive ? 1 : 0), 0); }

  private take(): P | null {
    for (const p of this.pool) if (!p.alive) return p;
    return null;
  }

  /** Spawn one shape. y: puffs/droplets world y; sheets/rings ride the water (y ignored, re-read each frame). */
  emit(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, opts: { g?: number; yaw?: number; aspect?: number } = {}) {
    const p = this.take();
    if (!p) return;
    Object.assign(p, { kind, x, y, z, vx, vy, vz, s0: size, age: 0, life, g: opts.g ?? (kind === 1 ? 9.8 : kind === 0 ? 1.5 : 0), yaw: opts.yaw ?? 0, aspect: opts.aspect ?? 1, seed: Math.random(), alive: true });
    this.spawned++;
  }

  /** ms per frame on the CPU (EMA) */
  cost = 0;
  update(dt: number, foam?: THREE.Color, bead?: THREE.Color) {
    const t0 = performance.now();
    if (foam) (this.uniforms.uFoam.value as THREE.Color).copy(foam);
    if (bead) (this.uniforms.uBead.value as THREE.Color).copy(bead);
    let n = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { p.alive = false; continue; }
      let size = p.s0, y = p.y;
      if (p.kind === 0) {
        // pop in fast with a little overshoot, then shrink away
        const pop = t < 0.15 ? 0.45 + 0.75 * (t / 0.15) : 1.2 - 1.2 * ((t - 0.15) / 0.85) ** 1.4;
        size = p.s0 * Math.max(0, pop);
        p.vy -= p.g * dt; const dr = Math.exp(-3 * dt); p.vx *= dr; p.vz *= dr;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        y = p.y;
      } else if (p.kind === 1) {
        p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        y = p.y;
        size = p.s0 * (1 - 0.3 * t);
        if (p.vy < 0) {
          const w = waterHeight(p.x, p.z);
          if (p.y <= w) { p.alive = false; this.emit(3, p.x, w, p.z, 0, 0, 0, p.s0 * 2.4, 0.45); continue; }
        }
      } else if (p.kind === 2) {
        // crown: stands up in ~0.15 s, holds, then sinks into the water as it thins
        const rise = Math.min(1, t / 0.28);
        const sink = Math.max(0, (t - 0.45) / 0.55);
        size = p.s0 * (0.25 + 0.75 * (1 - (1 - rise) ** 2));
        y = waterHeight(p.x, p.z) - 0.05 - sink * size * 0.9;
      } else {
        // rings grow and ride the water
        size = p.s0 * (p.kind === 3 ? 0.35 + 0.65 * Math.sqrt(t) : 0.55 + 0.45 * Math.sqrt(t));
        y = waterHeight(p.x, p.z) + 0.04;
      }
      this.iP.setXYZW(n, p.x, y, p.z, size);
      this.iA.setXYZW(n, p.kind, t, p.yaw, p.aspect);
      this.iV.setXYZW(n, p.vx, p.vy, p.vz, p.seed);
      n++;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) { this.iP.needsUpdate = true; this.iA.needsUpdate = true; this.iV.needsUpdate = true; }
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }
}
