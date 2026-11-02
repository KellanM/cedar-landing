import * as THREE from 'three';
import type { Hotspot } from '../world/types';
import { register } from '../render/materials';

/**
 * Fishing-spot markers, second pass (docs/hotspot_study.md; first pass docs/study/fishing_polish.md).
 * The spot is drawn the way the wave crests are (docs/crest_study.md): marks that are events with a
 * life, in one stroke language, on one instanced quad pool (one draw call):
 *  - slick: the standing patch where the bait is held up. A wobbling, slowly morphing outline with a
 *    darker bait-cloud core, "nervous water" (short chop dashes that jitter and flicker, drifting
 *    against the wind) and a broken drawn rim. It is what reads from afar and in fog.
 *  - boil: a fish takes bait from below. The water wells up as a disc, its glassy middle opens and the
 *    rim spreads, the rim breaks into fingers, and beads of foam drift out and pop one by one.
 *  - dimple: a small fish sips at the surface; a dot, a ring and a lagging inner ring that break into
 *    dashes as they spread. Scattered over the whole patch (they mark its extent, not a bullseye).
 *  - flick: bait skips out of the way in a fan, leaving a row of tiny splashes.
 *  - contour (`?spot=contour`, the alternative direction): A Short Hike style drawn loops that draw
 *    on, wobble, break into segments and fade, in place of boils.
 * Feeding comes in bursts (a slow per-spot intensity), so the patch is never the same twice. Fish
 * shadows, dorsal fins and silver glints (fish turning flank-up) stay from the first pass; a fin leaves
 * dimples behind it instead of a V of foam blobs.
 */
export const HOTSPOT_FX = {
  activity: 1, // event rate multiplier
  slick: 1, // slick radius multiplier
  fogK: 0.75, // fog depth scale for the spot (below 1 = the spot shows a little further into mist)
  clearR: 1.3, // m: marks part around the float so it always reads
  drawDist: 260, // m: slick drawn within this
  eventDist: 150, // m: boils/dimples/flicks spawn within this
};

export type SpotMode = 'boil' | 'contour';

const SEA_Y = -0.06;
const TAU = Math.PI * 2;
const SLICK = 0, BOIL = 1, DIMPLE = 2, FLICK = 3, CONTOUR = 4;

type Tier = 'common' | 'good' | 'rare';
const TIER = {
  common: { boil: 0.6, dimple: 2.4, flick: 0.28, contour: 0.22, glints: 12, fins: 0, shadows: 3, r: 1, bait: 2.0 },
  good: { boil: 0.72, dimple: 3.0, flick: 0.36, contour: 0.26, glints: 18, fins: 1, shadows: 3, r: 1.2, bait: 2.6 },
  rare: { boil: 0.85, dimple: 3.4, flick: 0.45, contour: 0.3, glints: 24, fins: 2, shadows: 2, r: 1.35, bait: 3.0 },
} as const;
const SLICK_R = 5.4; // m at tier r 1

const GLSL = /* glsl */ `
float hsH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hsN(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsH(i), hsH(i + vec2(1.0, 0.0)), f.x), mix(hsH(i + vec2(0.0, 1.0)), hsH(i + vec2(1.0, 1.0)), f.x), f.y);
}
// value noise around a loop: continuous in the angle, so outlines close without a seam
float loopN(float a, float freq, vec2 off) { return hsN(vec2(cos(a), sin(a)) * freq + off); }
float capsule(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
void over(inout vec4 acc, vec3 c, float a) { acc.rgb = c * a + acc.rgb * (1.0 - a); acc.a = a + acc.a * (1.0 - a); }
`;

const VERT = /* glsl */ `
attribute vec4 iA; // x, z, radius (m), rotation
attribute vec4 iB; // life 0..1, type (+10 = gold), seed, strength
uniform float uTime;
uniform float uWave;
uniform float uFogK;
varying vec2 vP;
varying vec4 vB;
varying float vR;
varying vec2 vW;
#include <fog_pars_vertex>
void main() {
  float c = cos(iA.w), s = sin(iA.w);
  vec2 lp = position.xy * (mod(iB.y, 10.0) < 0.5 ? 1.25 : 1.6); // slick outline stays inside 1.2; events' beads reach 1.5
  vP = lp; vB = iB; vR = iA.z;
  vec2 xz = iA.xy + vec2(c * lp.x - s * lp.y, s * lp.x + c * lp.y) * iA.z;
  vW = xz;
  // ride the sea's vertex ripple (same formula as sea.ts) a few cm above it
  float w = sin(xz.x * 0.21 + uTime * 0.9) * 0.5 + sin(xz.y * 0.17 - uTime * 0.7) * 0.35 + sin((xz.x + xz.y) * 0.43 + uTime * 1.6) * 0.15;
  float fade = 1.0 - smoothstep(60.0, 140.0, length(xz - cameraPosition.xz));
  vec4 wp = vec4(xz.x, w * 0.07 * fade * uWave + 0.035, xz.y, 1.0);
  if (iB.w <= 0.0) wp = vec4(0.0, -1e4, 0.0, 1.0);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
  #ifdef USE_FOG
  vFogDepth *= uFogK;
  #endif
}`;

const FRAG = /* glsl */ `
uniform vec3 uHead;
uniform vec3 uBead;
uniform vec3 uDark;
uniform vec3 uTint;
uniform vec3 uGold;
uniform float uT;
uniform vec2 uWind;
uniform vec4 uClear; // float x, z, radius, on
varying vec2 vP;
varying vec4 vB;
varying float vR;
varying vec2 vW;
#include <fog_pars_fragment>
${GLSL}
float fill(float d, float w) { return clamp(0.5 - d / w, 0.0, 1.0); }
void main() {
  float type = mod(vB.y, 10.0);
  float t = vB.x, seed = vB.z;
  vec3 head = vB.y >= 9.5 ? mix(uHead, uGold, 0.45) : uHead;
  vec2 p = vP;
  float r = length(p), a = atan(p.y, p.x);
  float w = length(fwidth(p)) * 0.75;
  float clear = 1.0;
  if (uClear.w > 0.5) clear = smoothstep(uClear.z * 0.6, uClear.z * 1.4, distance(vW, uClear.xy));
  vec4 acc = vec4(0.0);
  if (type < 0.5) {
    // ---- slick: bait cloud + nervous water + broken rim; the outline morphs slowly
    float edge = 0.8 + 0.26 * loopN(a, 1.4, vec2(seed * 17.0, uT * 0.07)) + 0.08 * loopN(a, 3.7, vec2(seed * 5.0, -uT * 0.15));
    float dS = r - edge;
    float core = r - (0.36 + 0.3 * loopN(a, 1.8, vec2(seed * 3.0 + 4.0, uT * 0.1)));
    over(acc, uDark, 0.13 * fill(dS, w) + 0.16 * fill(core, w));
    // nervous water: one short chop dash per 0.75 m world cell, jittering, flickering, clumped
    vec2 g = vW / 0.9 - uWind * uT * 0.3;
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = hsH(id + seed * 31.0), h2 = hsH(id.yx + 7.3);
    float ang = h * 6.2832 + sin(uT * (2.5 + 2.0 * h2) + h * 40.0) * 0.5;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 cc = (vec2(h2, h) - 0.5) * 0.3;
    float on = smoothstep(0.1, 0.7, sin(uT * (1.3 + 2.2 * h) + h2 * 30.0)) * smoothstep(0.4, 0.55, hsN(g * 0.35 + seed * 9.0 + uT * 0.15));
    float inside = 1.0 - smoothstep(-0.4, -0.05, dS);
    float L = 0.2 * on;
    float dD = capsule(f, cc - dir * L, cc + dir * L, 0.07 * on - 0.01) * 0.9 / vR;
    over(acc, uBead, fill(dD, w) * 0.7 * inside * clear);
    // rim: one drawn, broken line along the outline whose gaps travel round it
    float dR = abs(dS + 0.03) - 0.016;
    float rimOn = smoothstep(0.46, 0.54, loopN(a, 3.0, vec2(seed * 11.0, uT * 0.22)));
    over(acc, uBead, fill(dR, w) * rimOn * 0.8 * clear);
  } else if (type < 1.5) {
    // ---- boil: wells up, glassy middle opens, rim spreads and breaks, beads drift out and pop
    float wob = loopN(a, 1.8, vec2(seed * 9.0, 0.0)) + 0.4 * loopN(a, 4.0, vec2(seed * 3.0, t)) - 0.7;
    float grow = 1.0 - pow(1.0 - clamp(t / 0.62, 0.0, 1.0), 2.0);
    float R = mix(0.2, 1.0, grow) * (1.0 + 0.3 * wob);
    // the rim is a brush stroke: fat on the side the fish came up, thin elsewhere
    float th = 0.11 * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.4, 0.75, t)) * (0.35 + 1.1 * loopN(a, 1.2, vec2(seed * 21.0, 3.0)));
    float n = 4.0 + floor(seed * 4.0);
    float brk = smoothstep(0.2, 0.5, t + 0.12 * wob);
    float fingers = 0.5 + 0.5 * cos(a * n + seed * 20.0);
    th *= 1.0 - brk * smoothstep(0.3, 0.75, fingers);
    th -= 0.012;
    float dHead = abs(r - R) - th;
    // the dome: a glassy bulge (lighter sea, not foam) that wells up, then flattens as the rim spreads
    over(acc, uTint, fill(r - R, w) * 0.75 * smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.35, 0.8, t)));
    dHead = min(dHead, r - 0.35 * R * (1.0 - smoothstep(0.04, 0.2, t))); // a foam cap only as it first breaks
    float N = 11.0;
    float k = floor(a / 6.2832 * N + 0.5);
    float hk = hsH(vec2(k, seed * 13.0));
    float ak = (k + (hk - 0.5) * 0.5) / N * 6.2832;
    float rk = R + 0.05 + 0.3 * smoothstep(0.45, 1.0, t) * (0.5 + hk);
    vec2 ck = vec2(cos(ak), sin(ak)) * rk;
    float born = smoothstep(0.36, 0.5, t);
    float die = 1.0 - smoothstep(0.0, 0.06, t - (0.58 + 0.38 * hk));
    float br = 0.085 * (0.5 + hk) * born * die * step(0.25, hk);
    vec2 e = p - ck;
    vec2 rad = ck / max(rk, 1e-3), tn = vec2(-rad.y, rad.x);
    float dB = length(vec2(dot(e, tn) * 0.55, dot(e, rad))) - br;
    over(acc, uBead, fill(dB, w) * 0.9 * clear);
    over(acc, head, fill(dHead, w) * clear);
  } else if (type < 2.5) {
    // ---- dimple: dot, ring + lagging inner ring that break into dashes as they spread
    float wob = 1.0 + 0.12 * (loopN(a, 1.5, vec2(seed * 7.0, 0.0)) - 0.5);
    float R1 = (0.12 + 0.88 * (1.0 - pow(1.0 - t, 2.5))) * wob;
    float gap = smoothstep(0.3, 0.75, t) * smoothstep(0.25, 0.7, 0.5 + 0.5 * cos(a * 3.0 + seed * 17.0));
    float th1 = 0.1 * pow(1.0 - t, 1.2) * (1.0 - gap) - 0.012;
    float t2 = clamp((t - 0.22) / 0.78, 0.0, 1.0);
    float R2 = (0.06 + 0.55 * (1.0 - pow(1.0 - t2, 2.5))) * wob;
    float th2 = 0.075 * (1.0 - t2) * step(0.001, t2) * (1.0 - gap) - 0.012;
    float dDot = r - 0.16 * (1.0 - smoothstep(0.0, 0.2, t));
    over(acc, uBead, fill(abs(r - R2) - th2, w) * clear);
    over(acc, head, fill(min(abs(r - R1) - th1, dDot), w) * clear);
  } else if (type < 3.5) {
    // ---- flick: bait skips away in a fan (+y), each fish leaving a row of tiny splashes
    float dF = 1e3;
    for (int k = 0; k < 6; k++) {
      float fk = float(k);
      float hk = hsH(vec2(fk, seed * 7.0)), hk2 = hsH(vec2(seed * 3.0, fk));
      float ang = (hk - 0.5) * 1.6;
      vec2 dir = vec2(sin(ang), cos(ang));
      float L = 0.45 + 0.55 * hk2;
      for (int j = 0; j < 3; j++) {
        float fj = float(j);
        float age = (t - (0.04 + fj * 0.17 + hk * 0.14)) / 0.34;
        if (age < 0.0 || age > 1.0) continue;
        vec2 e = p - dir * L * (fj + 1.0) / 3.0;
        float rr = 0.08 * (1.0 - age * age) * (1.0 - fj * 0.22) - 0.01;
        dF = min(dF, length(vec2(dot(e, vec2(dir.y, -dir.x)), dot(e, dir) * 0.55)) - rr);
      }
    }
    over(acc, head, fill(dF, w) * clear);
  } else {
    // ---- contour: an A Short Hike loop that draws on, wobbles, breaks into segments and fades
    float R = (0.85 + 0.15 * t) * (0.82 + 0.3 * loopN(a, 1.6, vec2(seed * 13.0, uT * 0.08)));
    float da = fract((a - seed * 6.2832) / 6.2832);
    float drawn = step(da, smoothstep(0.0, 0.35, t));
    float seg = smoothstep(0.4, 0.5, loopN(a, 4.0, vec2(seed * 5.0, uT * 0.2)) + 0.6 - 1.1 * smoothstep(0.45, 1.0, t));
    float th = 0.022 * (1.0 - smoothstep(0.7, 1.0, t)) - 0.003;
    over(acc, uBead, fill(abs(r - R) - th, w) * drawn * seg * 0.85 * clear);
  }
  float alpha = acc.a * vB.w;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(acc.rgb / max(acc.a, 1e-4), alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

interface Ev { x: number; z: number; r: number; rot: number; age: number; life: number; type: number; seed: number; spot: number; alive: boolean }
interface Glint { a: number; r: number; s: number; ph: number; hz: number }
interface Shadow { r: number; w: number; a: number; s: number; fin: boolean; wakeT: number }
interface Spot {
  hs: Hotspot; x: number; z: number; tier: Tier; rnd: () => number; near: boolean; seed: number; R: number;
  acc: number[]; feedPh: number; bx: number; bz: number;
  g0: number; glints: Glint[]; s0: number; shadows: Shadow[]; f0: number;
}

const MAXN = 220;

export class HotspotFX {
  group = new THREE.Group();
  mode: SpotMode;
  private spots: Spot[] = [];
  private t = 0;
  private pool: Ev[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private iA: THREE.InstancedBufferAttribute;
  private iB: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private marks: THREE.Mesh;
  private glintM: THREE.InstancedMesh;
  private shadowM: THREE.InstancedMesh;
  private finM: THREE.InstancedMesh;
  private sea: Record<string, THREE.IUniform> | null = null;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c0 = new THREE.Color();
  private c1 = new THREE.Color();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private finScratch: { x: number; z: number; yaw: number; fx: number; fz: number }[] = [];
  /** events alive last frame (debug) */
  live = 0;

  constructor(hotspots: Hotspot[], mode: SpotMode = 'boil') {
    this.mode = mode;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iA = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iB = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.iA);
    g.setAttribute('iB', this.iB);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uWave: { value: 1 }, uFogK: { value: HOTSPOT_FX.fogK }, uT: { value: 0 },
        uHead: { value: new THREE.Color(0xeef1ec) }, uBead: { value: new THREE.Color(0xb8c6c4) }, uDark: { value: new THREE.Color(0x24363c) },
        uTint: { value: new THREE.Color(0x8aa0a2) }, uGold: { value: new THREE.Color(0xf2c94c) },
        uWind: { value: new THREE.Vector2(0.62, -0.78).normalize() }, uClear: { value: new THREE.Vector4() },
      }]),
      vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.marks = new THREE.Mesh(g, this.mat);
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    this.marks.name = 'hotspot_marks';
    for (let i = 0; i < MAXN; i++) this.pool.push({ x: 0, z: 0, r: 1, rot: 0, age: 0, life: 1, type: 0, seed: 0, spot: 0, alive: false });

    let nG = 0, nS = 0, nF = 0;
    const tiers = hotspots.map((h) => (h.tier === 'rare' ? 'rare' : h.tier === 'good' || h.tier === 'uncommon' ? 'good' : 'common') as Tier);
    tiers.forEach((t) => { const T = TIER[t]; nG += T.glints; nS += T.shadows; nF += T.fins; });
    const glintG = new THREE.BufferGeometry();
    glintG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1, 0.45, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, -1, -0.45, 0, 0], 3));
    this.glintM = new THREE.InstancedMesh(glintG, register(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })), Math.max(1, nG));
    this.shadowM = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12).scale(0.3, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0d1a1f, transparent: true, opacity: 0.24, depthWrite: false }), Math.max(1, nS));
    const finG = new THREE.BufferGeometry();
    finG.setAttribute('position', new THREE.Float32BufferAttribute([0.12, 0, 0, -0.16, 0, 0, -0.1, 1, 0], 3));
    this.finM = new THREE.InstancedMesh(finG, register(new THREE.MeshBasicMaterial({ color: 0x2a3438, side: THREE.DoubleSide })), Math.max(1, nF));
    for (const im of [this.glintM, this.shadowM, this.finM]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.zero);
    }
    this.shadowM.renderOrder = 0;
    this.glintM.renderOrder = 2;
    this.group.add(this.shadowM, this.marks, this.glintM, this.finM);

    let gi = 0, si = 0, fi = 0;
    const silver = [new THREE.Color(0xf1f5f6), new THREE.Color(0xc9d6db), new THREE.Color(0xffffff)];
    const gold = new THREE.Color(0xf2c94c);
    hotspots.forEach((hs, k) => {
      const tier = tiers[k], T = TIER[tier], rnd = mulberry(hash(hs.name));
      const sp: Spot = {
        hs, x: hs.pos[0], z: hs.pos[2], tier, rnd, near: false, seed: rnd(), R: SLICK_R * T.r,
        acc: [rnd(), rnd(), rnd(), rnd()], feedPh: rnd() * 100, bx: 0, bz: 0,
        g0: gi, glints: [], s0: si, shadows: [], f0: fi,
      };
      for (let i = 0; i < T.glints; i++) {
        sp.glints.push({ a: rnd() * TAU, r: Math.sqrt(rnd()) * T.bait * 0.75, s: 0.1 + rnd() * 0.1, ph: rnd() * TAU, hz: 0.6 + rnd() * 1.4 });
        this.glintM.setColorAt(gi++, tier === 'rare' && i % 4 === 0 ? gold : silver[i % 3]);
      }
      for (let i = 0; i < T.shadows; i++) {
        sp.shadows.push({ r: 1.6 + rnd() * 3 * T.r, w: (0.25 + rnd() * 0.3) * (rnd() < 0.5 ? -1 : 1), a: rnd() * TAU, s: (0.5 + rnd() * 0.5) * (tier === 'good' ? 1.25 : tier === 'rare' ? 1.6 : 1), fin: i < T.fins, wakeT: rnd() * 0.3 });
        si++;
      }
      fi += T.fins;
      this.spots.push(sp);
    });
    if (this.glintM.instanceColor) this.glintM.instanceColor.needsUpdate = true;
  }

  /** Share the sea's live uniforms: ripple clock, wave amount, wind, and the time-of-day colours. */
  useSea(u: Record<string, THREE.IUniform>) {
    this.sea = u;
    const mu = this.mat.uniforms;
    mu.uTime = u.uTime;
    if (u.uWave) mu.uWave = u.uWave;
    if (u.uWind) mu.uWind = u.uWind;
  }

  /** Colours from the sea's TOD palette: the spot sits above crests (gameplay) but at or below shore foam. */
  private colours() {
    const u = this.sea;
    if (!u) return;
    const sea = this.c0.copy(u.uDeep.value as THREE.Color).multiplyScalar(1 / 0.97);
    const foam = this.c1.copy(u.uFoam.value as THREE.Color);
    const lum = sea.r * 0.3 + sea.g * 0.55 + sea.b * 0.15;
    const night = lum < 0.02;
    const mu = this.mat.uniforms;
    // night: the sea's foam is dimmed to 0.55; the spot lifts it back so it still reads by moonlight
    (mu.uHead.value as THREE.Color).copy(sea).lerp(foam, night ? 1 : 0.94);
    if (night) (mu.uHead.value as THREE.Color).multiplyScalar(1.35);
    (mu.uBead.value as THREE.Color).copy(sea).lerp(foam, night ? 0.85 : 0.58);
    if (night) (mu.uBead.value as THREE.Color).multiplyScalar(1.35);
    // the bait cloud darkens the water by day; at night dark-on-dark vanishes, so the stirred patch
    // is lifted instead (moonlight on broken water, a hint of the sound's bioluminescence)
    if (night) (mu.uDark.value as THREE.Color).copy(sea).lerp(foam, 0.45);
    else (mu.uDark.value as THREE.Color).copy(sea).multiplyScalar(0.5);
    (mu.uTint.value as THREE.Color).copy(sea).lerp(foam, night ? 0.3 : 0.26);
  }

  private spawn(sp: Spot, si: number, type: number, x: number, z: number, r: number, life: number, rot = sp.rnd() * TAU) {
    const ev = this.pool.find((p) => !p.alive);
    if (!ev) return;
    Object.assign(ev, { x, z, r, rot, life, type, seed: sp.rnd(), spot: si, age: 0, alive: true });
  }

  private put(im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number) {
    this.e.set(0, rotY, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.v, this.q, this.s);
    im.setMatrixAt(i, this.m);
  }

  /** @param clear the float position (marks part around it), or null */
  update(dt: number, cam: THREE.Vector3, hideShadowsOf: Hotspot | null, clear: THREE.Vector3 | null = null) {
    this.t += dt;
    const t = this.t;
    const mu = this.mat.uniforms;
    mu.uT.value = t;
    mu.uFogK.value = HOTSPOT_FX.fogK;
    const cl = mu.uClear.value as THREE.Vector4;
    if (clear) cl.set(clear.x, clear.z, HOTSPOT_FX.clearR, 1); else cl.w = 0;
    this.colours();
    let n = 0;
    const A = this.iA, B = this.iB;
    const fins = this.finScratch;
    this.spots.forEach((sp, si) => {
      const dist = Math.hypot(sp.x - cam.x, sp.z - cam.z);
      if (dist > HOTSPOT_FX.drawDist) {
        if (sp.near) this.collapse(sp);
        sp.near = false;
        return;
      }
      sp.near = true;
      const T = TIER[sp.tier];
      const gold = sp.tier === 'rare' ? 10 : 0;
      const R = sp.R * HOTSPOT_FX.slick;
      // bait ball wanders on a slow Lissajous; the slick follows it at half the excursion
      sp.bx = Math.sin(t * 0.13 + sp.seed * 40) * 1.1 * T.r;
      sp.bz = Math.cos(t * 0.11 + sp.seed * 70) * 0.9 * T.r;
      const fade = Math.min(1, (HOTSPOT_FX.drawDist - dist) / 40);
      A.setXYZW(n, sp.x + sp.bx * 0.4, sp.z + sp.bz * 0.4, R, sp.seed * TAU);
      B.setXYZW(n, 0, SLICK + gold, sp.seed, fade);
      n++;
      // ---- events: feeding comes in bursts (slow intensity per spot)
      if (dist < HOTSPOT_FX.eventDist) {
        const f = 0.5 + 0.32 * Math.sin(t * 0.21 + sp.feedPh) + 0.18 * Math.sin(t * 0.53 + sp.feedPh * 1.7);
        const calm = sp.hs === hideShadowsOf ? 0.35 : 1;
        const k = (0.45 + 1.25 * f * f) * HOTSPOT_FX.activity * calm * dt;
        const rnd = sp.rnd;
        const cx = sp.x + sp.bx, cz = sp.z + sp.bz;
        const okAt = (x: number, z: number) => !clear || Math.hypot(x - clear.x, z - clear.z) > HOTSPOT_FX.clearR * 1.2;
        const rates = [this.mode === 'boil' ? T.boil : T.boil * 0.25, T.dimple, T.flick, this.mode === 'contour' ? T.contour : 0];
        for (let ty = 0; ty < 4; ty++) {
          sp.acc[ty] += rates[ty] * k;
          while (sp.acc[ty] >= 1) {
            sp.acc[ty] -= 1;
            const a = rnd() * TAU;
            if (ty === 0) {
              const d = Math.sqrt(rnd()) * R * 0.45, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
              const r = (0.9 + rnd() * 0.8) * T.r;
              // keep boils apart (crest lesson: overlapping marks stack into blobs)
              const apart = !this.pool.some((o) => o.alive && o.spot === si && o.type % 10 === BOIL && Math.hypot(o.x - x, o.z - z) < (o.r + r) * 1.1);
              if (okAt(x, z) && apart) this.spawn(sp, si, BOIL + gold, x, z, r, 2.6 + rnd() * 1.2);
            } else if (ty === 1) {
              const d = Math.sqrt(rnd()) * R * 1.12, x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d;
              if (okAt(x, z)) this.spawn(sp, si, DIMPLE, x, z, 0.32 + rnd() * 0.32, 1.0 + rnd() * 0.6);
            } else if (ty === 2) {
              const d = Math.sqrt(rnd()) * R * 0.7, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
              if (okAt(x, z)) this.spawn(sp, si, FLICK, x, z, 0.9 + rnd() * 0.5, 0.75);
            } else {
              this.spawn(sp, si, CONTOUR, sp.x + sp.bx * 0.5, sp.z + sp.bz * 0.5, R * (0.55 + rnd() * 0.6), 6.5 + rnd() * 2.5);
            }
          }
        }
      }
      // ---- fish shadows circle; fins leave dimples
      fins.length = 0;
      const hide = sp.hs === hideShadowsOf;
      sp.shadows.forEach((s, i) => {
        s.a += s.w * dt;
        const x = sp.x + Math.cos(s.a) * s.r, z = sp.z + Math.sin(s.a) * s.r;
        const yaw = -s.a + (s.w > 0 ? Math.PI : 0);
        this.put(this.shadowM, sp.s0 + i, x, SEA_Y + 0.01, z, yaw, hide ? 0 : s.s, 1, hide ? 0 : s.s);
        if (s.fin) {
          const up = hide ? 0 : 0.28 * s.s * (0.75 + 0.25 * Math.sin(t * 0.7 + i));
          this.put(this.finM, sp.f0 + fins.length, x, SEA_Y, z, yaw + Math.PI / 2, up, up, up);
          const fx = Math.sin(yaw + Math.PI / 2), fz = Math.cos(yaw + Math.PI / 2);
          fins.push({ x, z, yaw, fx, fz });
          s.wakeT -= dt;
          if (!hide && s.wakeT <= 0 && dist < HOTSPOT_FX.eventDist) {
            s.wakeT = 0.28 + sp.rnd() * 0.12;
            this.spawn(sp, si, DIMPLE, x - fx * 0.35 * s.s, z - fz * 0.35 * s.s, 0.3 * s.s + 0.12, 1.1);
          }
        }
      });
      // glints: flat diamonds flicking on and off over the bait cloud (fish turning flank-up)
      sp.glints.forEach((g, i) => {
        const on = Math.sin(t * g.hz * TAU + g.ph);
        const vis = on > 0.55 ? (on - 0.55) / 0.45 : 0;
        const x = sp.x + sp.bx + Math.cos(g.a + t * 0.2) * g.r, z = sp.z + sp.bz + Math.sin(g.a + t * 0.2) * g.r * 0.8;
        const cd = clear ? Math.hypot(x - clear.x, z - clear.z) : 99;
        const sc = g.s * vis * THREE.MathUtils.smoothstep(cd, HOTSPOT_FX.clearR * 0.6, HOTSPOT_FX.clearR * 1.4);
        this.put(this.glintM, sp.g0 + i, x, SEA_Y + 0.05, z, g.a + t, sc, sc, sc * 1.4);
      });
    });
    // live events after every slick (instance order = draw order: slicks underneath)
    let live = 0;
    for (const ev of this.pool) {
      if (!ev.alive) continue;
      ev.age += dt;
      const lt = ev.age / ev.life;
      const sp = this.spots[ev.spot];
      if (lt >= 1 || !sp.near || n >= MAXN) { ev.alive = false; continue; }
      const dist = Math.hypot(ev.x - cam.x, ev.z - cam.z);
      A.setXYZW(n, ev.x, ev.z, ev.r, ev.rot);
      B.setXYZW(n, lt, ev.type, ev.seed, Math.min(1, (HOTSPOT_FX.eventDist - dist) / 25));
      n++;
      live++;
    }
    this.live = live;
    this.geo.instanceCount = n;
    A.needsUpdate = true; B.needsUpdate = true;
    this.marks.visible = n > 0;
    for (const im of [this.glintM, this.shadowM, this.finM]) im.instanceMatrix.needsUpdate = true;
  }

  private collapse(sp: Spot) {
    for (let i = 0; i < sp.glints.length; i++) this.glintM.setMatrixAt(sp.g0 + i, this.zero);
    for (let i = 0; i < sp.shadows.length; i++) this.shadowM.setMatrixAt(sp.s0 + i, this.zero);
    const nf = sp.shadows.filter((s) => s.fin).length;
    for (let i = 0; i < nf; i++) this.finM.setMatrixAt(sp.f0 + i, this.zero);
  }

  stats() { return { live: this.live, near: this.spots.filter((s) => s.near).length, mode: this.mode }; }
}

/**
 * The export still bakes a flat bullseye marker (LIFE_Hotspots: rings, foam icos, life_bait disc at
 * z≈0.17–0.2 m) into the world chunks. It sits above the float and fights the procedural marker,
 * so collapse those triangles at load. Selection: every vertex 0.08–0.34 m above sea level and
 * within the marker radius of a hotspot centre (7.4 m common, 9.9 m good/rare). Skip with ?bakedmarkers.
 * Returns the number of triangles removed.
 */
export function hideBakedHotspotMarkers(chunks: THREE.Object3D[], hotspots: Hotspot[]): number {
  if (new URLSearchParams(location.search).has('bakedmarkers')) return 0;
  const spots = hotspots.map((h) => ({ x: h.pos[0], z: h.pos[2], r: h.tier === 'common' ? 7.4 : 9.9 }));
  const v = new THREE.Vector3();
  let removed = 0;
  for (const c of chunks) {
    c.updateMatrixWorld(true);
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry, pos = g.getAttribute('position') as THREE.BufferAttribute;
      if (!pos) return;
      const box = g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox!);
      const wb = box.clone().applyMatrix4(mesh.matrixWorld);
      if (!spots.some((s) => s.x > wb.min.x - s.r && s.x < wb.max.x + s.r && s.z > wb.min.z - s.r && s.z < wb.max.z + s.r)) return;
      // per-vertex flag
      const n = pos.count, ok = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.y < 0.08 || v.y > 0.34) continue;
        for (const s of spots) if (Math.hypot(v.x - s.x, v.z - s.z) < s.r) { ok[i] = 1; break; }
      }
      const idx = g.index;
      if (idx) {
        const a = idx.array as Uint16Array | Uint32Array;
        for (let f = 0; f < a.length; f += 3) {
          if (ok[a[f]] && ok[a[f + 1]] && ok[a[f + 2]]) { a[f + 1] = a[f]; a[f + 2] = a[f]; removed++; }
        }
        idx.needsUpdate = true;
      } else {
        for (let f = 0; f < n; f += 3) {
          if (ok[f] && ok[f + 1] && ok[f + 2]) { v.fromBufferAttribute(pos, f); pos.setXYZ(f + 1, v.x, v.y, v.z); pos.setXYZ(f + 2, v.x, v.y, v.z); removed++; }
        }
        pos.needsUpdate = true;
      }
    });
  }
  return removed;
}
