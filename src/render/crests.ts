import * as THREE from 'three';
import type { ShoreField } from './shorefield';

/**
 * Wave crests, second pass (docs/crest_study.md). Each crest is one mark with a life:
 *   rise  - a thin lip draws itself outward from the middle and thickens (half-sine swell, like
 *           Wind Waker's `usonami` marks, whose height rides sin(animCounter));
 *   curl  - one end hooks forward over itself (Hokusai's claw);
 *   break - the lip splits into fingers and thins away while the head runs on downwind;
 *   spill - it leaves two rows of foam beads where it passed, which pop out one by one
 *           (the residual-foam stage of a real whitecap outlives the active break 2-4x).
 * The head moves relative to its own foam, so a crest changes shape as it travels instead of
 * sliding as a sticker.
 *
 * CREST_GLSL is shared: the sprite pool below draws it on instanced quads (default), and the sea
 * shader can draw the same life cycle in jittered world cells (`?crests=cells`) for comparison.
 */
export const CREST_GLSL = /* glsl */ `
float crestHash(float n) { return fract(sin(n) * 43758.5453); }
// p: crest-local, in units of the crest's half length; x across the wind (s = +-1 is the curl end),
// y downwind. t: life 0..1. Returns signed distances (head, foam), negative inside.
vec2 crestShape(vec2 p, float t, float s, float seed) {
  const float TRAVEL = 1.15;
  float hy = TRAVEL * (1.0 - pow(1.0 - clamp(t / 0.8, 0.0, 1.0), 2.0)); // head runs on, slowing
  float L = mix(0.25, 1.0, smoothstep(0.0, 0.3, t));                    // rise: draws outward
  float x = p.x / L;
  float xc = clamp(x, -1.0, 1.0);
  float bow = 0.16 + 0.1 * smoothstep(0.1, 0.5, t);
  float y = p.y - hy - bow * (1.0 - xc * xc);
  float body = sqrt(max(1.0 - xc * xc, 0.0));
  // swell of the lip: rises, holds, then thins away; fattest toward the curl end
  float th = 0.16 * smoothstep(0.0, 0.28, t) * (1.0 - smoothstep(0.55, 0.82, t)) * body * (0.72 + 0.4 * xc * s);
  // break: the lip splits into fingers (gaps open from the far end toward the curl)
  float brk = smoothstep(0.4, 0.66, t + 0.08 * xc * s);
  float fingers = 0.5 + 0.5 * cos((xc * 2.6 + seed * 5.0) * 3.14159);
  th *= 1.0 - brk * smoothstep(0.3, 0.7, fingers);
  th -= 0.012; // so a spent lip vanishes instead of leaving an anti-aliased hairline
  float dHead = max(abs(y) - th, (abs(x) - 1.0) * L);
  // curl: an arc hooked forward and back over the lip at the s end, growing then breaking
  float curl = smoothstep(0.12, 0.4, t) * (1.0 - smoothstep(0.52, 0.7, t));
  if (curl > 0.01) {
    float rc = 0.2;
    vec2 q = vec2((p.x - s * (L - rc)) * s, p.y - hy);
    float a = atan(q.y, q.x);                       // 0 at the lip end, pi/2 ahead of it
    float arc = max(-a, a - 2.7 * curl);
    float ring = max(abs(length(q) - rc) - (0.07 * curl - 0.012), arc * rc);
    dHead = min(dHead, ring);
  }
  // spill: beads left behind where the head passed; each pops out on its own clock
  float dFoam = 1e3;
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float ry = TRAVEL * (0.35 + 0.38 * fk);
    float sp = 0.34 - 0.06 * fk;
    float ox = seed * 0.7 + fk * 0.5 * sp;
    float i = floor((p.x - ox) / sp + 0.5);
    float h = crestHash(i * 12.99 + fk * 78.2 + seed * 437.0);
    vec2 c = vec2(i * sp + ox + (h - 0.5) * 0.14, ry + 0.22 * (1.0 - min(1.0, (i * sp + ox) * (i * sp + ox))) + (h - 0.5) * 0.16);
    float born = smoothstep(0.0, 0.2, hy - ry + 0.05) * smoothstep(0.3, 0.42, t);
    c.y -= 0.12 * smoothstep(0.4, 1.0, t) * (fk + 0.5); // the foam spreads back as it lingers
    float die = 1.0 - smoothstep(0.0, 0.1, t - (0.58 + 0.3 * h - 0.08 * fk));
    float r = (0.085 - 0.02 * fk) * (0.45 + 0.9 * h * h) * born * die * step(abs(c.x), 0.92) * step(0.4, h);
    vec2 e = (p - c) * vec2(0.6, 1.0); // lace: beads drawn out along the crest
    dFoam = min(dFoam, length(e) - r * 0.85);
  }
  return vec2(dHead, dFoam);
}
`;

export const CREST_TUNE = {
  count: 28, // crests in view at the default density 0.5 (high quality)
  life: 4.2, // s: mean life of a mid-size crest (bigger live longer)
  size: 1.0, // half length multiplier (base 0.9-1.6 m: a crest is 2-3 m, a third of the boat)
  near: 4, // m: no crests closer than this to the boat (the wake and hull collar own that water)
  shelter: 22, // m from shore where crests reach full density (sheltered water is calm)
};

interface Crest { x: number; z: number; ang: number; half: number; age: number; life: number; seed: number; side: number; alive: boolean }

const VERT = /* glsl */ `
attribute vec4 iA; // x, z, angle, half length
attribute vec4 iB; // t (life 0..1), seed, side, strength
uniform float uTime;
uniform vec2 uWind;
varying vec2 vP;
varying vec4 vB;
#include <fog_pars_vertex>
void main() {
  vP = position.xy;
  vB = iB;
  float c = cos(iA.z), s = sin(iA.z);
  vec2 down = vec2(c * uWind.x - s * uWind.y, s * uWind.x + c * uWind.y);
  vec2 across = vec2(-down.y, down.x);
  vec2 xz = iA.xy + (across * position.x + down * position.y) * iA.w;
  // ride the sea's vertex ripple (same formula as sea.ts) a few cm above it
  float w = sin(xz.x * 0.21 + uTime * 0.9) * 0.5 + sin(xz.y * 0.17 - uTime * 0.7) * 0.35 + sin((xz.x + xz.y) * 0.43 + uTime * 1.6) * 0.15;
  vec4 wp = vec4(xz.x, w * 0.07 + 0.03, xz.y, 1.0);
  if (iB.w <= 0.0) wp = vec4(0.0, -1e4, 0.0, 1.0);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uCrestCol;
uniform vec3 uFoamCol;
uniform float uOpacity;
varying vec2 vP;
varying vec4 vB;
#include <fog_pars_fragment>
${CREST_GLSL}
void main() {
  vec2 d = crestShape(vP, vB.x, vB.z, vB.y);
  float w = length(fwidth(vP)) * 0.75;
  float head = clamp(0.5 - d.x / w, 0.0, 1.0);
  float foam = clamp(0.5 - d.y / w, 0.0, 1.0);
  float a = max(head, foam * 0.85) * vB.w * uOpacity;
  if (a < 0.01) discard;
  vec3 col = mix(uFoamCol, uCrestCol, head);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const MAXN = 48;

/**
 * The sprite pool: one InstancedBufferGeometry quad per crest, one draw call, lying on the water.
 * Spawns are sampled uniformly over the screen's water (so the far field never thickens into a
 * band of commas), gated by moving wave groups and by shelter (shore field), kept apart from each
 * other and from the boat. Every crest lives once and is gone: nothing loops in place.
 */
export class CrestSprites {
  mesh: THREE.Mesh;
  enabled = true;
  /** 0..1 density (WATER_TUNE.crestDensity × variant) */
  density = 0.5;
  /** time-of-day sea state: calm sunny days carry fewer caps (Wind Waker shows none in fair weather) */
  todK = 1;
  far = 95;
  scale = 1;
  speed = 0.3;
  low = false;
  motion = 1;
  set opacity(v: number) { this.mat.uniforms.uOpacity.value = v; }
  private pool: Crest[] = [];
  private iA: THREE.InstancedBufferAttribute;
  private iB: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private acc = 0;
  private time = 0;
  private field: ShoreField | null = null;
  private fieldData: Uint16Array | null = null;
  private v = new THREE.Vector3();
  private ray = new THREE.Vector3();
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  inView = 0;
  /** studio captures: no automatic spawns */
  debugMode = false;

  constructor(uniforms: { uTime: THREE.IUniform; uWind: THREE.IUniform; uCrestCol: THREE.IUniform; uBeadCol: THREE.IUniform }) {
    const g = new THREE.InstancedBufferGeometry();
    // local quad: x across (-1.35..1.35), y downwind (-0.45..1.75), in half lengths
    const pos = new Float32Array([-1.35, -0.45, 0, 1.35, -0.45, 0, 1.35, 1.75, 0, -1.35, 1.75, 0]);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iA = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iB = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.iA);
    g.setAttribute('iB', this.iB);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 1 } }]),
      vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    // share the sea's live uniforms (colours follow the time of day, ripple follows the sea clock)
    Object.assign(this.mat.uniforms, { uTime: uniforms.uTime, uWind: uniforms.uWind, uCrestCol: uniforms.uCrestCol, uFoamCol: uniforms.uBeadCol });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'sea_crests';
    for (let i = 0; i < MAXN; i++) this.pool.push({ x: 0, z: 0, ang: 0, half: 1, age: 0, life: 1, seed: 0, side: 1, alive: false });
  }

  setField(f: ShoreField | null) {
    this.field = f;
    this.fieldData = f ? (f.texture.image as { data: Uint16Array }).data : null;
  }

  /** 0 in sheltered water and close in to shore, 1 in open water */
  private openness(x: number, z: number) {
    const f = this.field, data = this.fieldData;
    if (!f || !data) return 1;
    const [w, h] = f.res;
    const u = (x - f.min.x) / f.size.x, v = (z - f.min.y) / f.size.y;
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) return 1;
    const p = Math.floor(v * h) * w + Math.floor(u * w);
    const sd = THREE.DataUtils.fromHalfFloat(data[p * 2]);
    const dpRaw = THREE.DataUtils.fromHalfFloat(data[p * 2 + 1]);
    if (dpRaw < 0) return 0; // under a deck
    const ss = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
    return ss(5, CREST_TUNE.shelter, sd) * ss(1.5, 5, dpRaw);
  }

  /** moving wave groups: whitecaps come in sets that travel downwind */
  private group(x: number, z: number, wx: number, wz: number) {
    const a = x * wx + z * wz, b = -x * wz + z * wx;
    return 0.5 + 0.5 * Math.sin(a * 0.075 - this.time * 0.5 + 1.6 * Math.sin(b * 0.045 + 0.7) + 0.8 * Math.sin(b * 0.11 - a * 0.02));
  }

  private trySpawn(cam: THREE.PerspectiveCamera, focus: THREE.Vector3, wx: number, wz: number) {
    const c = this.pool.find((p) => !p.alive);
    if (!c) return;
    for (let tries = 0; tries < 6; tries++) {
      // a random point on screen, cast to the water plane
      this.v.set(Math.random() * 2.2 - 1.1, Math.random() * 2.2 - 1.1, 0.5).unproject(cam);
      this.ray.copy(this.v).sub(cam.position).normalize();
      if (this.ray.y > -0.02) continue;
      const k = -cam.position.y / this.ray.y;
      const x = cam.position.x + this.ray.x * k, z = cam.position.z + this.ray.z * k;
      const dist = Math.hypot(x - cam.position.x, z - cam.position.z);
      if (dist > this.far) continue;
      const db = Math.hypot(x - focus.x, z - focus.z);
      if (db < CREST_TUNE.near) continue;
      const nearK = Math.min(1, (db - CREST_TUNE.near) / 4);
      const fadeK = 1 - Math.max(0, (dist - this.far * 0.6) / (this.far * 0.4));
      const p = this.openness(x, z) * nearK * fadeK * (0.25 + 0.75 * Math.min(1, Math.max(0, (this.group(x, z, wx, wz) - 0.2) / 0.6)));
      if (Math.random() > p) continue;
      const r = Math.random();
      const half = (0.9 + 0.7 * r) * this.scale * CREST_TUNE.size;
      // keep them apart: no crest within ~3 crest lengths of another
      let clear = true;
      for (const o of this.pool) if (o.alive && Math.hypot(o.x - x, o.z - z) < (o.half + half) * 2.6) { clear = false; break; }
      if (!clear) continue;
      // too small on screen to read cleanly: skip (no sub-pixel shimmer)
      const px = (half * 2 / dist) * (window.innerHeight / 2) / Math.tan((cam.fov * Math.PI) / 360);
      if (px < 14) continue;
      Object.assign(c, {
        x, z, half, alive: true, age: 0,
        ang: (Math.random() - 0.5) * 0.6, // across the wind, give or take 17°
        life: CREST_TUNE.life * (0.7 + 0.6 * r) * (0.85 + Math.random() * 0.3), // big crests live longer
        seed: Math.random(), side: Math.random() < 0.5 ? -1 : 1,
      });
      return;
    }
  }

  update(dt: number, cam: THREE.Camera, focus: THREE.Vector3, wind: THREE.Vector2) {
    this.time += dt;
    const on = this.enabled && this.density > 0 && !this.debugMode;
    this.mesh.visible = on || this.pool.some((p) => p.alive);
    if (!this.mesh.visible) { this.geo.instanceCount = 0; return; }
    const pc = cam as THREE.PerspectiveCamera;
    pc.updateMatrixWorld();
    this.m4.multiplyMatrices(pc.projectionMatrix, pc.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    const wx = wind.x, wz = wind.y;
    // drift with the wind: faster while the crest is active (Wind Waker's 0.2 + 0.8 × alpha)
    let n = 0;
    this.inView = 0;
    for (const c of this.pool) {
      if (!c.alive) continue;
      c.age += dt * this.motion;
      const t = c.age / c.life;
      if (t >= 1) { c.alive = false; continue; }
      const active = Math.sin(Math.PI * Math.min(1, t / 0.78));
      const sp = this.speed * (0.3 + 0.7 * active) * this.motion * dt;
      c.x += wx * sp; c.z += wz * sp;
      this.v.set(c.x, 0, c.z);
      if (this.frustum.containsPoint(this.v)) this.inView++;
      // fade the whole crest only at the draw-distance edge (life itself erodes, it does not fade)
      const dist = Math.hypot(c.x - pc.position.x, c.z - pc.position.z);
      const db = Math.hypot(c.x - focus.x, c.z - focus.z);
      const str = Math.min(1, Math.max(0, (this.far - dist) / (this.far * 0.25))) * Math.min(1, Math.max(0, (db - 3) / 3));
      this.iA.setXYZW(n, c.x, c.z, c.ang, c.half);
      this.iB.setXYZW(n, t, c.seed, c.side, str);
      n++;
    }
    this.geo.instanceCount = n;
    this.iA.needsUpdate = true; this.iB.needsUpdate = true;
    if (on) {
      // per screen, not per world area; a bigger (desktop) screen shows a little more sea, so a few more
      const area = Math.min(2, Math.max(1, Math.sqrt((window.innerWidth * window.innerHeight) / (390 * 844))));
      const target = Math.round(CREST_TUNE.count * this.density * 2 * this.todK * area * (this.low ? 0.6 : 1));
      if (this.inView < target) {
        this.acc += (target / (CREST_TUNE.life * 0.5)) * dt * this.motion; // fill toward the target, roughly one life
        while (this.acc >= 1) { this.acc -= 1; this.trySpawn(pc, focus, wx, wz); }
      } else this.acc = 0;
    }
  }

  /** Studio (crest study captures): one crest at (x, z), life in s; others stop spawning while density is 0. */
  debugSpawn(x: number, z: number, half = 1, life = CREST_TUNE.life, side = 1, seed = 0.37) {
    const c = this.pool.find((p) => !p.alive);
    if (c) Object.assign(c, { x, z, half, life, side, seed, ang: 0, age: 0, alive: true });
  }

  stats() { return { alive: this.pool.filter((p) => p.alive).length, inView: this.inView }; }
}
