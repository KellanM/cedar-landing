import * as THREE from 'three';
import type { Hotspot } from '../world/types';
import { register } from '../render/materials';

/**
 * Fishing-spot markers, second pass (docs/hotspot_study.md; first pass docs/study/fishing_polish.md).
 * The spot is drawn the way the wave crests are (docs/crest_study.md): marks that are events with a
 * life, in one stroke language, on one instanced quad pool (one draw call):
 *  - slick: the standing patch where the bait is held up. A wobbling, slowly morphing outline with a
 *    darker bait-cloud core and a broken drawn rim. It is what reads from afar and in fog.
 *  - boil: a fish takes bait from below. The water wells up as a disc, its glassy middle opens and the
 *    rim spreads, the rim breaks into fingers, and beads of foam drift out and pop one by one.
 *  - dimple: a small fish sips at the surface; a dot, a ring and a lagging inner ring that break into
 *    dashes as they spread. Scattered over the whole patch (they mark its extent, not a bullseye).
 *  - school (docs/bait_study.md): one tight school of small fish just under the surface, swimming as one.
 *    It holds a heading, then jinks; each fish follows at its own rate (front first), so a flash of
 *    silver flank runs through the school on every turn. Bodies sway; colours from the herring plate.
 *  - leapers: chased bait jumps out of the school edge in a fan of low arcs, twisting (flank flashes),
 *    with a splash in and out.
 *  - predators: two fish-shaped shadows below that dart and glide round the ball (fins on good/rare).
 *  - contour (`?spot=contour`, the alternative direction): A Short Hike style drawn loops that draw
 *    on, wobble, break into segments and fade, in place of boils.
 * Feeding comes in bursts (a slow per-spot intensity), so the patch is never the same twice. A fin
 * leaves dimples behind it. Everything but the fins is one draw call.
 */
export const HOTSPOT_FX = {
  activity: 1, // event rate multiplier
  slick: 1, // slick radius multiplier
  fogK: 0.75, // fog depth scale for the spot (below 1 = the spot shows a little further into mist)
  clearR: 1.3, // m: marks part around the float so it always reads
  drawDist: 260, // m: slick drawn within this
  eventDist: 150, // m: school, boils, dimples and leapers within this
};

export type SpotMode = 'boil' | 'contour';

const SEA_Y = -0.06;
const TAU = Math.PI * 2;
const SLICK = 0, BOIL = 1, DIMPLE = 2, CONTOUR = 4, SCHOOL = 5, PRED = 6, LEAP = 7;

type Tier = 'common' | 'good' | 'rare';
const TIER = {
  common: { boil: 0.6, dimple: 2.4, leap: 0.3, contour: 0.22, school: 22, fins: 0, preds: 2, r: 1 },
  good: { boil: 0.72, dimple: 3.0, leap: 0.38, contour: 0.26, school: 28, fins: 1, preds: 2, r: 1.2 },
  rare: { boil: 0.85, dimple: 3.4, leap: 0.45, contour: 0.3, school: 34, fins: 2, preds: 2, r: 1.35 },
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
uniform float uTideY; // tides: the water level (the marks are placed in world space, not by the group)
varying vec2 vP;
varying vec4 vB;
varying float vR;
varying vec2 vW;
#include <fog_pars_vertex>
void main() {
  float c = cos(iA.w), s = sin(iA.w);
  float type = mod(iB.y, 10.0);
  // slick outline stays inside 1.2; events' beads reach 1.5; a fish (+sway) fits in 1.1
  vec2 lp = position.xy * (type < 0.5 ? 1.25 : type > 4.5 ? 1.1 : 1.6);
  vP = lp; vB = iB; vR = iA.z;
  vec2 xz = iA.xy + vec2(c * lp.x - s * lp.y, s * lp.x + c * lp.y) * iA.z;
  vW = xz;
  // ride the sea's vertex ripple (same formula as sea.ts) a few cm above it
  float w = sin(xz.x * 0.21 + uTime * 0.9) * 0.5 + sin(xz.y * 0.17 - uTime * 0.7) * 0.35 + sin((xz.x + xz.y) * 0.43 + uTime * 1.6) * 0.15;
  float fade = 1.0 - smoothstep(60.0, 140.0, length(xz - cameraPosition.xz));
  vec4 wp = vec4(xz.x, uTideY + w * 0.07 * fade * uWave + 0.035, xz.y, 1.0);
  // a leaping baitfish: a low arc, about three body lengths high at the top
  if (type > 6.5) wp.y += 4.0 * iB.x * (1.0 - iB.x) * 1.5 * iA.z;
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
uniform vec3 uBack;
uniform vec3 uSilver;
uniform vec3 uShade;
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
// a small fish from above, head toward +y, in half lengths: a lens body and a forked tail.
// sway bends the body (more at the tail), so it swims instead of skating.
float fishD(vec2 p, float wid, float sway) {
  float u = clamp((0.95 - p.y) / 1.95, 0.0, 1.0);
  p.x -= sway * u * u * 0.4;
  float body = (length(vec2(p.x / wid, (p.y - 0.12) / 0.78)) - 1.0) * wid;
  float tail = min(capsule(p, vec2(0.0, -0.62), vec2(0.17, -0.94), 0.065), capsule(p, vec2(0.0, -0.62), vec2(-0.17, -0.94), 0.065));
  return min(body, tail);
}
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
  } else if (type < 4.5) {
    // ---- contour: an A Short Hike loop that draws on, wobbles, breaks into segments and fades
    float R = (0.85 + 0.15 * t) * (0.82 + 0.3 * loopN(a, 1.6, vec2(seed * 13.0, uT * 0.08)));
    float da = fract((a - seed * 6.2832) / 6.2832);
    float drawn = step(da, smoothstep(0.0, 0.35, t));
    float seg = smoothstep(0.4, 0.5, loopN(a, 4.0, vec2(seed * 5.0, uT * 0.2)) + 0.6 - 1.1 * smoothstep(0.45, 1.0, t));
    float th = 0.022 * (1.0 - smoothstep(0.7, 1.0, t)) - 0.003;
    over(acc, uBead, fill(abs(r - R) - th, w) * drawn * seg * 0.85 * clear);
  } else if (type < 5.5) {
    // ---- school fish just under the surface: dark back; a silver flank shows as it turns (t = flash)
    float d = fishD(p, 0.2, sin(uT * 9.0 + seed * 40.0) * 0.55);
    vec3 fl = vB.y >= 9.5 && seed > 0.75 ? mix(uSilver, uGold, 0.6) : uSilver;
    over(acc, mix(uBack, fl, t), fill(d, w) * (0.62 + 0.35 * t) * clear);
  } else if (type < 6.5) {
    // ---- predator shadow: a bigger fish lower down, darting and gliding
    float d = fishD(p, 0.25, sin(uT * 4.0 + seed * 30.0) * (0.3 + 0.4 * t));
    over(acc, uShade, fill(d, w) * 0.34);
  } else {
    // ---- leaper: a baitfish out of the water in a low arc, twisting so its flank flashes
    float roll = t * 5.0 + seed * 6.0;
    float ws = 0.35 + 0.65 * abs(cos(roll));
    float d = fishD(vec2(p.x / ws, p.y), 0.2, sin(t * 20.0) * 0.4) * ws;
    float back = (1.0 - smoothstep(0.04, 0.08, abs(p.x) / ws)) * (1.0 - abs(cos(roll)) * 0.6) * step(-0.55, p.y);
    float a2 = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
    over(acc, mix(uSilver, uBack, back), fill(d, w) * a2);
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
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Ev { x: number; z: number; r: number; rot: number; age: number; life: number; type: number; seed: number; spot: number; alive: boolean; dx: number; dz: number }
interface Fish { x: number; z: number; h: number; flash: number; sl: number; sa: number; k: number; seed: number; half: number }
interface Pred { r: number; w: number; a: number; s: number; fin: boolean; wakeT: number; ph: number; seed: number }
interface Spot {
  hs: Hotspot; x: number; z: number; tier: Tier; rnd: () => number; near: boolean; seed: number; R: number;
  acc: number[]; feedPh: number; bx: number; bz: number;
  // the school: a centre that swims and turns, fish that follow it
  sx: number; sz: number; H: number; Hgoal: number; turnT: number; fish: Fish[]; schoolOn: boolean;
  preds: Pred[]; f0: number;
}

const MAXN = 420;

export class HotspotFX {
  group = new THREE.Group();
  mode: SpotMode;
  /** 0..1 storm (rough-water spots get busier) */
  storm = 0;
  private spots: Spot[] = [];
  private t = 0;
  private pool: Ev[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private iA: THREE.InstancedBufferAttribute;
  private iB: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private marks: THREE.Mesh;
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
  private herringBack = new THREE.Color(0x4e7489);
  private herringSilver = new THREE.Color(0xc9d3d6);
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
        uTime: { value: 0 }, uWave: { value: 1 }, uFogK: { value: HOTSPOT_FX.fogK }, uTideY: { value: 0 }, uT: { value: 0 },
        uHead: { value: new THREE.Color(0xeef1ec) }, uBead: { value: new THREE.Color(0xb8c6c4) }, uDark: { value: new THREE.Color(0x24363c) },
        uTint: { value: new THREE.Color(0x8aa0a2) }, uGold: { value: new THREE.Color(0xf2c94c) },
        uBack: { value: new THREE.Color(0x2c4450) }, uSilver: { value: new THREE.Color(0xc9d3d6) }, uShade: { value: new THREE.Color(0x0d1a1f) },
        uWind: { value: new THREE.Vector2(0.62, -0.78).normalize() }, uClear: { value: new THREE.Vector4() },
      }]),
      vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.marks = new THREE.Mesh(g, this.mat);
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    this.marks.name = 'hotspot_marks';
    for (let i = 0; i < MAXN; i++) this.pool.push({ x: 0, z: 0, r: 1, rot: 0, age: 0, life: 1, type: 0, seed: 0, spot: 0, alive: false, dx: 0, dz: 0 });

    let nF = 0;
    const tiers = hotspots.map((h) => (h.tier === 'rare' ? 'rare' : h.tier === 'good' || h.tier === 'uncommon' ? 'good' : 'common') as Tier);
    tiers.forEach((t) => { nF += TIER[t].fins; });
    const finG = new THREE.BufferGeometry();
    finG.setAttribute('position', new THREE.Float32BufferAttribute([0.12, 0, 0, -0.16, 0, 0, -0.1, 1, 0], 3));
    this.finM = new THREE.InstancedMesh(finG, register(new THREE.MeshBasicMaterial({ color: 0x2a3438, side: THREE.DoubleSide })), Math.max(1, nF));
    this.finM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.finM.frustumCulled = false;
    for (let i = 0; i < this.finM.count; i++) this.finM.setMatrixAt(i, this.zero);
    this.group.add(this.marks, this.finM);

    let fi = 0;
    hotspots.forEach((hs, k) => {
      const tier = tiers[k], T = TIER[tier], rnd = mulberry(hash(hs.name));
      const sp: Spot = {
        hs, x: hs.pos[0], z: hs.pos[2], tier, rnd, near: false, seed: rnd(), R: SLICK_R * T.r,
        acc: [rnd(), rnd(), rnd(), rnd()], feedPh: rnd() * 100, bx: 0, bz: 0,
        sx: hs.pos[0], sz: hs.pos[2], H: rnd() * TAU, Hgoal: 0, turnT: 0, fish: [], schoolOn: false,
        preds: [], f0: fi,
      };
      sp.Hgoal = sp.H;
      // formation slots in a tight lens, longer than wide; front fish react first
      for (let i = 0; i < T.school; i++) {
        const sl = rnd() * 2 - 1, sa = (rnd() * 2 - 1) * Math.sqrt(1 - sl * sl * 0.6);
        sp.fish.push({ x: sp.x, z: sp.z, h: sp.H, flash: 0, sl, sa, k: 3 + (sl + 1) * 3 + rnd() * 1.5, seed: rnd(), half: 0.17 + rnd() * 0.05 });
      }
      for (let i = 0; i < T.preds; i++) {
        sp.preds.push({ r: 1.8 + rnd() * 2.6 * T.r, w: (0.3 + rnd() * 0.25) * (rnd() < 0.5 ? -1 : 1), a: rnd() * TAU, s: (0.5 + rnd() * 0.5) * (tier === 'good' ? 1.25 : tier === 'rare' ? 1.5 : 1), fin: i < T.fins, wakeT: rnd() * 0.3, ph: rnd() * TAU, seed: rnd() });
      }
      fi += T.fins;
      this.spots.push(sp);
    });
  }

  /** Share the sea's live uniforms: ripple clock, wave amount, wind, and the time-of-day colours. */
  useSea(u: Record<string, THREE.IUniform>) {
    this.sea = u;
    const mu = this.mat.uniforms;
    mu.uTime = u.uTime;
    if (u.uWave) mu.uWave = u.uWave;
    if (u.uWind) mu.uWind = u.uWind;
    if (u.uTideY) mu.uTideY = u.uTideY;
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
    // baitfish (the Logbook herring plate: blue-grey back, silver flank), pulled into the sea's light
    (mu.uBack.value as THREE.Color).copy(sea).lerp(this.herringBack, night ? 0.1 : 0.3).multiplyScalar(night ? 0.6 : 0.62);
    (mu.uSilver.value as THREE.Color).copy(this.herringSilver).lerp(foam, 0.35);
    if (night) (mu.uSilver.value as THREE.Color).copy(foam).multiplyScalar(1.3);
    (mu.uShade.value as THREE.Color).copy(sea).multiplyScalar(0.3);
  }

  private spawn(sp: Spot, si: number, type: number, x: number, z: number, r: number, life: number, rot = sp.rnd() * TAU) {
    const ev = this.pool.find((p) => !p.alive);
    if (!ev) return null;
    Object.assign(ev, { x, z, r, rot, life, type, seed: sp.rnd(), spot: si, age: 0, alive: true, dx: 0, dz: 0 });
    return ev;
  }

  private put(im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number) {
    this.e.set(0, rotY, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.v, this.q, this.s);
    im.setMatrixAt(i, this.m);
  }

  /** The school swims as one: the centre holds a heading, then turns sharply (a flash runs through the fish as they follow). */
  private swim(sp: Spot, dt: number, burst: number) {
    const R = sp.R * HOTSPOT_FX.slick, rnd = sp.rnd;
    const ballX = sp.x + sp.bx, ballZ = sp.z + sp.bz;
    if (!sp.schoolOn) {
      sp.schoolOn = true;
      sp.sx = ballX; sp.sz = ballZ;
      const c = Math.cos(sp.H), s = Math.sin(sp.H);
      for (const f of sp.fish) { f.x = sp.sx + c * f.sl * 1.05 - s * f.sa * 0.65; f.z = sp.sz + s * f.sl * 1.05 + c * f.sa * 0.65; f.h = sp.H; }
    }
    sp.turnT -= dt * (0.6 + burst);
    const off = Math.hypot(sp.sx - ballX, sp.sz - ballZ);
    if (sp.turnT <= 0) {
      // straying from the bait ball: turn back toward it; otherwise a sharp jink either way
      sp.Hgoal = off > R * 0.35 ? Math.atan2(ballZ - sp.sz, ballX - sp.sx) + (rnd() - 0.5) * 0.8 : sp.H + (rnd() < 0.5 ? -1 : 1) * (0.9 + rnd() * 1.6);
      sp.turnT = 1.4 + rnd() * 2.6;
    }
    const dH = wrapA(sp.Hgoal - sp.H);
    sp.H += dH * Math.min(1, dt * 3);
    const speed = (0.55 + 0.5 * burst) * (1 + Math.min(1, Math.abs(dH)) * 0.8);
    sp.sx += Math.cos(sp.H) * speed * dt;
    sp.sz += Math.sin(sp.H) * speed * dt;
    const c = Math.cos(sp.H), s = Math.sin(sp.H);
    const L = 1.05 * (1 + 0.3 * Math.sin(this.t * 0.4 + sp.feedPh)), W = 0.65 * (1 - 0.2 * Math.sin(this.t * 0.4 + sp.feedPh)); // the ball breathes
    for (const f of sp.fish) {
      const tx = sp.sx + c * f.sl * L - s * f.sa * W, tz = sp.sz + s * f.sl * L + c * f.sa * W;
      const prev = f.h;
      // each fish turns to the school heading at its own rate (front first), then steers to its slot
      const toSlot = Math.atan2(tz - f.z, tx - f.x), dist = Math.hypot(tx - f.x, tz - f.z);
      const want = dist > 0.25 ? toSlot : sp.H;
      f.h += wrapA(want - f.h) * Math.min(1, dt * f.k);
      const v = speed * (0.85 + Math.min(1, dist) * 0.8);
      f.x += Math.cos(f.h) * v * dt;
      f.z += Math.sin(f.h) * v * dt;
      if (dist > 2) { f.x = tx; f.z = tz; } // never strand a fish
      // flank-up flash while turning, plus the odd single fish flicking over
      const turn = Math.abs(wrapA(f.h - prev)) / Math.max(dt, 1e-3);
      const spark = rnd() < dt * 0.06 ? 1 : 0;
      f.flash = Math.max(Math.min(1, Math.max(0, turn - 1.6) * 0.8), spark, f.flash - dt * 3);
    }
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
    this.spots.forEach((sp, si) => {
      const dist = Math.hypot(sp.x - cam.x, sp.z - cam.z);
      if (dist > HOTSPOT_FX.drawDist) {
        if (sp.near) this.collapse(sp);
        sp.near = false;
        sp.schoolOn = false;
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
      const hide = sp.hs === hideShadowsOf;
      const f = 0.5 + 0.32 * Math.sin(t * 0.21 + sp.feedPh) + 0.18 * Math.sin(t * 0.53 + sp.feedPh * 1.7);
      // ---- predators: fish-shaped shadows that dart and glide round the ball; fins leave dimples
      let fins = 0;
      sp.preds.forEach((p) => {
        const dart = 0.5 + 0.9 * Math.max(0, Math.sin(t * 0.8 + p.ph));
        p.a += p.w * dart * dt;
        const x = sp.x + sp.bx * 0.5 + Math.cos(p.a) * p.r, z = sp.z + sp.bz * 0.5 + Math.sin(p.a) * p.r;
        const head = p.a + (p.w > 0 ? Math.PI / 2 : -Math.PI / 2);
        const half = 0.32 + 0.3 * p.s;
        if (!hide && n < MAXN) {
          A.setXYZW(n, x, z, half, head - Math.PI / 2);
          B.setXYZW(n, Math.min(1, dart - 0.5), PRED, p.seed, Math.min(1, fade));
          n++;
        }
        if (p.fin) {
          const yaw = -head + Math.PI / 2;
          const up = hide ? 0 : 0.28 * p.s * (0.75 + 0.25 * Math.sin(t * 0.7 + p.ph));
          this.put(this.finM, sp.f0 + fins++, x, SEA_Y, z, yaw + Math.PI / 2, up, up, up);
          p.wakeT -= dt;
          if (!hide && p.wakeT <= 0 && dist < HOTSPOT_FX.eventDist) {
            p.wakeT = 0.28 + sp.rnd() * 0.12;
            this.spawn(sp, si, DIMPLE, x - Math.cos(head) * half * 0.8, z - Math.sin(head) * half * 0.8, 0.3 * p.s + 0.12, 1.1);
          }
        }
      });
      if (dist >= HOTSPOT_FX.eventDist) { sp.schoolOn = false; return; }
      // ---- the school
      this.swim(sp, dt, f);
      const str = Math.min(1, (HOTSPOT_FX.eventDist - dist) / 25);
      for (const fsh of sp.fish) {
        if (n >= MAXN) break;
        A.setXYZW(n, fsh.x, fsh.z, fsh.half, fsh.h - Math.PI / 2);
        B.setXYZW(n, fsh.flash, SCHOOL + gold, fsh.seed, str);
        n++;
      }
      // ---- events: feeding comes in bursts (slow intensity per spot)
      const calm = hide ? 0.35 : 1;
      // storms (docs/rain_study.md): the rough outer grounds boil in a blow
      const wx = sp.tier === 'rare' ? 1 + 1.6 * this.storm : 1;
      const k = (0.45 + 1.25 * f * f) * HOTSPOT_FX.activity * calm * wx * dt;
      const rnd = sp.rnd;
      const cx = sp.x + sp.bx, cz = sp.z + sp.bz;
      const okAt = (x: number, z: number) => !clear || Math.hypot(x - clear.x, z - clear.z) > HOTSPOT_FX.clearR * 1.2;
      const rates = [this.mode === 'boil' ? T.boil : T.boil * 0.25, T.dimple, T.leap, this.mode === 'contour' ? T.contour : 0];
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
            // half the sips are over the school (nervous water), half anywhere on the patch
            const near = rnd() < 0.5;
            const d = near ? Math.sqrt(rnd()) * 1.2 : Math.sqrt(rnd()) * R * 1.12;
            const x = (near ? sp.sx : sp.x) + Math.cos(a) * d, z = (near ? sp.sz : sp.z) + Math.sin(a) * d;
            if (okAt(x, z)) this.spawn(sp, si, DIMPLE, x, z, near ? 0.22 + rnd() * 0.18 : 0.32 + rnd() * 0.32, 0.9 + rnd() * 0.6);
          } else if (ty === 2) {
            // chased bait: 1-4 fish jump out of the school edge in a fan, each in a low arc
            const nL = 1 + Math.floor(rnd() * rnd() * 4);
            const ox = sp.sx + Math.cos(a) * 0.7, oz = sp.sz + Math.sin(a) * 0.7;
            if (!okAt(ox, oz)) continue;
            for (let j = 0; j < nL; j++) {
              const h = a + (rnd() - 0.5) * 1.0, len = 0.8 + rnd() * 0.8;
              const ev = this.spawn(sp, si, LEAP, ox, oz, 0.2 + rnd() * 0.05, 0.42 + len * 0.12, h - Math.PI / 2);
              if (ev) { ev.dx = Math.cos(h) * len; ev.dz = Math.sin(h) * len; ev.age = -j * (0.09 + rnd() * 0.08); }
            }
          } else {
            this.spawn(sp, si, CONTOUR, sp.x + sp.bx * 0.5, sp.z + sp.bz * 0.5, R * (0.55 + rnd() * 0.6), 6.5 + rnd() * 2.5);
          }
        }
      }
    });
    // live events after the slicks, predators and schools (instance order = draw order)
    let live = 0;
    for (const ev of this.pool) {
      if (!ev.alive) continue;
      const was = ev.age;
      ev.age += dt;
      const sp = this.spots[ev.spot];
      if (!sp.near) { ev.alive = false; continue; }
      if (ev.age < 0) continue; // a leaper waiting its turn
      const lt = ev.age / ev.life;
      if (ev.type === LEAP) {
        // splash in, splash out
        if (was <= 0) this.spawn(sp, ev.spot, DIMPLE, ev.x, ev.z, 0.18, 0.7);
        if (lt >= 1) { ev.alive = false; this.spawn(sp, ev.spot, DIMPLE, ev.x + ev.dx, ev.z + ev.dz, 0.26, 0.9); continue; }
      }
      if (lt >= 1 || n >= MAXN) { ev.alive = false; continue; }
      const k = ev.type === LEAP ? lt : 0;
      const x = ev.x + ev.dx * k, z = ev.z + ev.dz * k;
      const dist = Math.hypot(x - cam.x, z - cam.z);
      A.setXYZW(n, x, z, ev.r, ev.rot);
      B.setXYZW(n, lt, ev.type, ev.seed, Math.min(1, (HOTSPOT_FX.eventDist - dist) / 25));
      n++;
      live++;
    }
    this.live = live;
    this.geo.instanceCount = n;
    A.needsUpdate = true; B.needsUpdate = true;
    this.marks.visible = n > 0;
    this.finM.instanceMatrix.needsUpdate = true;
  }

  private collapse(sp: Spot) {
    const nf = sp.preds.filter((s) => s.fin).length;
    for (let i = 0; i < nf; i++) this.finM.setMatrixAt(sp.f0 + i, this.zero);
  }

  stats() { return { live: this.live, near: this.spots.filter((s) => s.near).length, mode: this.mode }; }
  /** captures: where a spot's school is now */
  school(name: string) { const sp = this.spots.find((x) => x.hs.name === name || x.hs.name.includes(name)); return sp ? { x: sp.sx, z: sp.sz, on: sp.schoolOn } : null; }
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
