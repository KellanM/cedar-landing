import * as THREE from 'three';
import { WATER } from '../game/tide';
import { SWELL_GLSL, SWELL_U } from '../game/swell';

/**
 * Rain, rain marks on the sea, distant rain veils, lightning (docs/rain_study.md).
 * Every layer is one draw call and all motion is computed on the GPU from a clock, so the CPU cost
 * is a handful of uniforms per frame (the veils and bolts update a few instances / rebuild on a strike).
 *
 *  - streaks: a camera-anchored box of world-stable streaks (Wind Waker's camera-relative pool), all at
 *    one faint alpha, slanted along fall + wind, longer with distance so near ones never look like scratches;
 *  - marks: on the water near the view a drop pops (two or three dots, ACNH) then opens a small broken ring
 *    that thins away (real drops: 2-3 rings under a second); never on land or under decks (shore field);
 *  - veils: a few grey curtains hanging from the cloud base far out (real squall footage), fogged;
 *  - lightning: forked flat bolts that appear at once and fade with the flash, and a full-screen lift toward
 *    a pale blue-grey (WW: the whole frame flattens toward pale, it does not go white), soft attack, slow decay,
 *    at most one re-flare, at least RAIN_TUNE.flashGap s apart.
 */
export const RAIN_TUNE = {
  streaks: 760, // streaks at full rain (high quality; low quality halves)
  streakAlpha: 0.26,
  streakLen: 0.9, // m, mid-distance streak length at full rain
  fall: 8.5, // m/s at full rain (drizzle falls slower)
  slant: 0.22, // wind lean (× storm boost)
  marks: 300, // sea marks at full rain (high quality)
  markSize: 0.55, // m radius (a real ring is smaller; at 10-25 m a true-size one is sub-pixel)
  markLife: 0.75, // s
  markAlpha: 0.45,
  veils: 6,
  veilAlpha: 0.42,
  flashNear: 0.42, // full-screen lift at a near strike
  flashFar: 0.24, // sky-weighted lift at a far strike
  flashGap: 3.2, // s, minimum between flashes (photosensitivity: never more than ~1 per 3 s)
  strikesPerMin: 9, // at the height of a storm
};

const BOX = new THREE.Vector3(40, 17, 40);
const TILE = 52;

const STREAK_VERT = /* glsl */ `
attribute vec4 iSeed;
uniform float uTime;
uniform vec3 uAnchor;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uLen;
uniform float uAlpha;
uniform float uW;
varying float vA;
varying vec2 vQ;
void main() {
  vec3 vel = uVel * (0.82 + 0.36 * iSeed.w);
  vec3 wp = iSeed.xyz * uBox + vel * uTime;
  wp = uAnchor + mod(wp - uAnchor + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 toCam = cameraPosition - wp;
  float dist = length(toCam);
  vec3 dir = normalize(vel);
  vec3 side = normalize(cross(dir, toCam));
  float len = uLen * mix(0.4, 1.7, smoothstep(3.0, 30.0, dist)) * (0.75 + 0.5 * iSeed.w);
  float w = (0.0035 + dist * 0.0015) * uW;
  vec3 v = wp - dir * len * position.y + side * w * position.x;
  float edge = length((wp - uAnchor).xz) / (0.5 * uBox.x);
  vA = uAlpha * smoothstep(1.2, 4.0, dist) * (1.0 - smoothstep(0.72, 1.0, edge)) * step(0.0, v.y);
  vQ = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(v, 1.0);
}`;
const STREAK_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform vec3 uRim;
uniform float uRimK;
varying float vA;
varying vec2 vQ;
void main() {
  // a pale core with a faint darker rim, so a streak still reads over pale planks and sand
  float x = abs(vQ.x);
  float core = 1.0 - smoothstep(0.45, 0.8, x);
  float a = vA * mix(1.0, 0.2, vQ.y) * max(core, uRimK * (1.0 - x)); // head brighter, tail trails off
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uRim, uCol, core), a);
  #include <colorspace_fragment>
}`;

const MARK_VERT = /* glsl */ `
attribute vec4 iSeed;
uniform float uTime;
uniform float uSeaTime;
uniform float uLife;
uniform vec3 uAnchor;
uniform float uTile;
uniform float uSize;
uniform float uAlpha;
varying vec2 vP;
varying vec2 vXZ;
varying vec3 vL; // life t, rand, alpha
#include <fog_pars_vertex>
// fract-only hash (no sin of large arguments: on some GPUs that collapses to a few values and the
// marks stack into bullseyes)
uniform float uWaterY; // the tide (game/tide.ts WATER.y)
${SWELL_GLSL}
float hh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  float cyc = uTime / (uLife * (0.8 + 0.4 * iSeed.w)) + iSeed.z;
  float k = mod(floor(cyc), 4096.0), t = fract(cyc);
  vec2 cell = vec2(hh(vec2(k, iSeed.x * 937.1)), hh(vec2(iSeed.y * 613.7, k + 17.0))) * uTile;
  vec2 xz = uAnchor.xz + mod(cell - uAnchor.xz + 0.5 * uTile, uTile) - 0.5 * uTile;
  float d = length(xz - uAnchor.xz);
  float size = uSize * (0.7 + 0.6 * hh(vec2(k + 3.0, iSeed.w * 91.7)));
  vec2 p = xz + position.xy * size;
  float w = sin(p.x * 0.21 + uSeaTime * 0.9) * 0.5 + sin(p.y * 0.17 - uSeaTime * 0.7) * 0.35 + sin((p.x + p.y) * 0.43 + uSeaTime * 1.6) * 0.15;
  vec4 wp = vec4(p.x, uWaterY + w * 0.07 + 0.035, p.y, 1.0);
  if (uSwOn > 0.5) wp.y += swellEval(p).x - w * 0.07 + 0.03; // ocean experiment: lie on the swell
  vP = position.xy;
  vXZ = p;
  // fade out close under the camera (a ring there would be a hoop across the screen) and toward the tile edge
  float cd = length(cameraPosition - wp.xyz);
  vL = vec3(t, hh(vec2(iSeed.z * 311.0, k * 1.7)), uAlpha * smoothstep(7.0, 11.0, cd) * (1.0 - smoothstep(0.32 * uTile, 0.48 * uTile, d)));
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const MARK_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform sampler2D uField;
uniform vec4 uFieldRect;
uniform float uHasField;
varying vec2 vP;
varying vec2 vXZ;
varying vec3 vL;
#include <fog_pars_fragment>
void main() {
  if (vL.z < 0.01) discard;
  if (uHasField > 0.5) {
    vec2 fuv = (vXZ - uFieldRect.xy) * uFieldRect.zw;
    if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
      vec2 fs = texture2D(uField, fuv).rg;
      if (fs.r < 0.6 || fs.g < 0.0) discard; // land, the surf line, under a deck
    }
  }
  float t = vL.x, r = vL.y;
  float aa = length(fwidth(vP)) * 0.8;
  // pop: two or three dots thrown up where the drop hit, gone in the first fifth
  float dots = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float an = r * 6.28 + fi * 2.2;
    vec2 c = vec2(cos(an), sin(an)) * (0.12 + 0.28 * t / 0.22) * (0.7 + 0.25 * fi);
    float rad = (0.15 - 0.03 * fi) * (1.0 - smoothstep(0.08, 0.22, t)) * step(fi, 1.0 + step(0.5, r));
    dots = max(dots, clamp(0.5 - (length(vP - c) - rad) / aa, 0.0, 1.0));
  }
  // ring: opens fast then slows, thins, breaks into two or three arcs, gone by the end
  float R = 0.12 + 0.82 * pow(t, 0.55);
  float th = mix(0.08, 0.022, t);
  float ring = clamp(0.5 - (abs(length(vP) - R) - th) / aa, 0.0, 1.0);
  float ang = atan(vP.y, vP.x) / 6.28318 + r;
  float arcs = step(0.5, r) + 2.0;
  ring *= smoothstep(0.1, 0.2, fract(ang * arcs)) * (1.0 - smoothstep(0.62 + 0.2 * r, 0.9, fract(ang * arcs)));
  ring *= smoothstep(0.05, 0.16, t) * (1.0 - smoothstep(0.55, 1.0, t));
  float a = max(dots, ring * 0.8) * vL.z;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const VEIL_VERT = /* glsl */ `
attribute vec4 iVeil; // x, z, half width, seed
uniform float uH;
varying vec2 vUV;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vec3 toCam = cameraPosition - vec3(iVeil.x, 0.0, iVeil.y);
  vec2 side = normalize(vec2(-toCam.z, toCam.x));
  vec3 wp = vec3(iVeil.x + side.x * position.x * iVeil.z, -2.0 + position.y * uH, iVeil.y + side.y * position.x * iVeil.z);
  vUV = position.xy;
  vSeed = iVeil.w;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const VEIL_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uAlpha;
uniform float uTime;
uniform float uSlant;
varying vec2 vUV;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  float x = vUV.x + vUV.y * uSlant;
  float streak = 0.62 + 0.2 * sin(x * 23.0 + vSeed * 17.0) + 0.12 * sin(x * 57.0 - vSeed * 5.0) + 0.06 * sin((x + uTime * 0.01) * 131.0);
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(x) + 0.25 * sin(vUV.y * 4.0 + vSeed * 9.0));
  float vert = smoothstep(0.0, 0.18, vUV.y) * (1.0 - smoothstep(0.62, 1.0, vUV.y)) * mix(0.75, 1.0, vUV.y);
  float a = uAlpha * streak * edge * vert;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const BOLT_VERT = /* glsl */ `
attribute vec3 aBolt; // delay, strength, core (1) / halo (0)
uniform float uAge;
uniform float uFlick;
varying vec2 vB;
void main() {
  float t = uAge - aBolt.x;
  float a = step(0.0, t) * (t < 0.07 ? 1.0 : exp(-(t - 0.07) * 2.4)) * uFlick;
  vB = vec2(a * aBolt.y, aBolt.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BOLT_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uHalo;
varying vec2 vB;
void main() {
  float a = vB.x * mix(0.22, 1.0, vB.y);
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uHalo, uCore, vB.y), a);
  #include <colorspace_fragment>
}`;

const FLASH_VERT = /* glsl */ `
varying float vY;
void main() { vY = position.y; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FLASH_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uNear;
uniform float uFar;
varying float vY;
void main() {
  float a = uNear + uFar * smoothstep(-0.7, 1.0, vY);
  gl_FragColor = vec4(uCol, clamp(a, 0.0, 0.8));
  #include <colorspace_fragment>
}`;

const MAX_BOLT_V = 2400;

export interface Strike { near: boolean; dist: number; x: number; z: number }

function quadInstanced(n: number, pos: number[]) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = 0;
  return g;
}

export class RainFX {
  group = new THREE.Group();
  /** settings: 'on' | 'soft' (reduced motion) | 'off' (no screen lift; bolts only) */
  flashMode: 'on' | 'soft' | 'off' = 'on';
  /** strike callback (thunder + camera) */
  onStrike: ((s: Strike) => void) | null = null;
  /** on foot the camera is close: a smaller, denser box nearer the lens so the rain reads around the walker */
  onFoot = false;
  /** debug: stop automatic strikes */
  autoStrikes = true;
  rain = 0; // eased
  storm = 0;
  private target = { rain: 0, storm: 0 };
  private low = false;
  private time = 0;
  private streaks: THREE.Mesh; private sGeo: THREE.InstancedBufferGeometry; private sMat: THREE.ShaderMaterial;
  private marks: THREE.Mesh; private mGeo: THREE.InstancedBufferGeometry; private mMat: THREE.ShaderMaterial;
  private veils: THREE.Mesh; private vGeo: THREE.InstancedBufferGeometry; private vMat: THREE.ShaderMaterial; private vAttr: THREE.InstancedBufferAttribute;
  private veilState: { x: number; z: number; w: number; s: number; live: boolean }[] = [];
  private bolts: THREE.Mesh; private bGeo: THREE.BufferGeometry; private bMat: THREE.ShaderMaterial;
  private flash: THREE.Mesh; private fMat: THREE.ShaderMaterial;
  private strikeT = 99; // s since the last strike
  private strikeNear = false;
  private strikeAmp = 0;
  private nextStrike = 6;
  private fogFar = 1000;
  private v = new THREE.Vector3(); private f = new THREE.Vector3(); private ray = new THREE.Vector3();
  cost = 0;

  constructor(seaUniforms: Record<string, THREE.IUniform>) {
    const n = RAIN_TUNE.streaks;
    this.sGeo = quadInstanced(n, [-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]);
    this.sMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uWaterY: { value: 0 }, uAnchor: { value: new THREE.Vector3() }, uBox: { value: BOX.clone() }, uVel: { value: new THREE.Vector3(0, -8, 0) }, uLen: { value: 1 }, uAlpha: { value: 0.2 }, uCol: { value: new THREE.Color(0xdfe5e6) }, uRim: { value: new THREE.Color(0x56605f) }, uRimK: { value: 0.35 }, uW: { value: 1 } },
      vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.streaks = new THREE.Mesh(this.sGeo, this.sMat);
    this.streaks.name = 'rain_streaks';

    this.mGeo = quadInstanced(RAIN_TUNE.marks, [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    this.mMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLife: { value: 0.75 }, uWaterY: { value: 0 }, uAnchor: { value: new THREE.Vector3() }, uTile: { value: TILE }, uSize: { value: 0.34 }, uAlpha: { value: 0.5 }, uCol: { value: new THREE.Color(0xdde3e2) } }]),
      vertexShader: MARK_VERT, fragmentShader: MARK_FRAG, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    Object.assign(this.mMat.uniforms, SWELL_U);
    Object.assign(this.mMat.uniforms, { uSeaTime: seaUniforms.uTime, uField: seaUniforms.uField, uFieldRect: seaUniforms.uFieldRect, uHasField: seaUniforms.uHasField });
    this.marks = new THREE.Mesh(this.mGeo, this.mMat);
    this.marks.name = 'rain_marks';
    this.marks.renderOrder = -1;

    const vg = new THREE.InstancedBufferGeometry();
    vg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
    vg.setIndex([0, 1, 2, 0, 2, 3]);
    this.vAttr = new THREE.InstancedBufferAttribute(new Float32Array(8 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    vg.setAttribute('iVeil', this.vAttr);
    vg.instanceCount = 0;
    this.vGeo = vg;
    this.vMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uH: { value: 150 }, uCol: { value: new THREE.Color(0x8a9496) }, uAlpha: { value: 0 }, uTime: { value: 0 }, uSlant: { value: 0.1 } }]),
      vertexShader: VEIL_VERT, fragmentShader: VEIL_FRAG, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.veils = new THREE.Mesh(vg, this.vMat);
    this.veils.name = 'rain_veils';
    this.veils.renderOrder = 4;
    for (let i = 0; i < 8; i++) this.veilState.push({ x: 0, z: 0, w: 0, s: Math.random(), live: false });

    this.bGeo = new THREE.BufferGeometry();
    this.bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_BOLT_V * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.bGeo.setAttribute('aBolt', new THREE.BufferAttribute(new Float32Array(MAX_BOLT_V * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.bGeo.setIndex(new THREE.BufferAttribute(new Uint16Array((MAX_BOLT_V / 4) * 6), 1).setUsage(THREE.DynamicDrawUsage));
    this.bGeo.setDrawRange(0, 0);
    this.bMat = new THREE.ShaderMaterial({
      uniforms: { uAge: { value: 99 }, uFlick: { value: 1 }, uCore: { value: new THREE.Color(0xfbfdff) }, uHalo: { value: new THREE.Color(0xc4d6ee) } },
      vertexShader: BOLT_VERT, fragmentShader: BOLT_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.bolts = new THREE.Mesh(this.bGeo, this.bMat);
    this.bolts.name = 'lightning';
    this.bolts.frustumCulled = false;
    this.bolts.renderOrder = 6;
    this.bolts.visible = false;

    this.fMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(0xdbe5ef) }, uNear: { value: 0 }, uFar: { value: 0 } },
      vertexShader: FLASH_VERT, fragmentShader: FLASH_FRAG, transparent: true, depthTest: false, depthWrite: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fMat);
    this.flash.name = 'lightning_flash';
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 1000;
    this.flash.visible = false;

    for (const m of [this.streaks, this.marks, this.veils]) { m.frustumCulled = false; m.visible = false; }
    this.group.add(this.veils, this.marks, this.streaks, this.bolts, this.flash);
    this.group.name = 'weather';
  }

  setQuality(q: 'high' | 'low') { this.low = q === 'low'; }

  /** Weather targets (eased per frame) + palette: haze colour for veils, night dims the white. */
  set(rain: number, storm: number, haze: string, night: number, fogFar: number) {
    this.target.rain = rain; this.target.storm = storm;
    this.fogFar = fogFar;
    const h = new THREE.Color(haze);
    // streaks: pale, pulled toward the haze so they sit in the palette; dimmer at night
    (this.sMat.uniforms.uCol.value as THREE.Color).set(0xeef2f2).lerp(h, 0.25 + 0.3 * night).multiplyScalar(1 - 0.35 * night);
    (this.sMat.uniforms.uRim.value as THREE.Color).copy(h).multiplyScalar(0.45);
    (this.mMat.uniforms.uCol.value as THREE.Color).set(0xe8eeec).lerp(h, 0.3 + 0.35 * night).multiplyScalar(1 - 0.4 * night);
    // veils: a little darker and greyer than the haze (a curtain is a shade under the cloud it hangs from)
    const l = h.r * 0.3 + h.g * 0.55 + h.b * 0.15;
    (this.vMat.uniforms.uCol.value as THREE.Color).copy(h).lerp(new THREE.Color(l, l, l), 0.4).multiplyScalar(0.72);
  }

  /** Force a strike now (debug / captures). */
  strike(near = Math.random() < 0.25, cam?: THREE.PerspectiveCamera) {
    if (cam) this.doStrike(cam, near, true);
    else this.pending = near ? 'near' : 'far';
  }
  private pending: 'near' | 'far' | null = null;

  update(dt: number, cam: THREE.PerspectiveCamera, reduceMotion: boolean) {
    const t0 = performance.now();
    this.time = (this.time + dt) % 10000;
    const k = 1 - Math.exp(-dt * 0.6);
    this.rain += (this.target.rain - this.rain) * k;
    this.storm += (this.target.storm - this.storm) * k;
    if (Math.abs(this.target.rain - this.rain) < 0.002) this.rain = this.target.rain;
    if (Math.abs(this.target.storm - this.storm) < 0.002) this.storm = this.target.storm;
    const R = this.rain, S = this.storm, T = RAIN_TUNE;
    const half = this.low ? 0.5 : 1;

    // ---- streaks
    const on = R > 0.02;
    this.streaks.visible = on;
    this.marks.visible = on;
    if (on) {
      cam.getWorldDirection(this.f);
      const su = this.sMat.uniforms;
      // anchor ahead of the camera along the view, half the box above the sea
      const a = su.uAnchor.value as THREE.Vector3;
      const box = su.uBox.value as THREE.Vector3;
      box.copy(BOX).multiplyScalar(this.onFoot ? 0.55 : 1);
      a.copy(cam.position).addScaledVector(this.f, this.onFoot ? 7 : 13);
      a.y = this.onFoot ? Math.max(box.y * 0.5, cam.position.y - box.y * 0.35) : box.y * 0.5;
      su.uTime.value = this.time * (reduceMotion ? 0.35 : 1);
      const fall = T.fall * (0.45 + 0.55 * Math.min(1, R / 0.7)) * (1 + 0.15 * S);
      const lean = T.slant * (1 + 2.2 * S) * fall;
      const wind = WIND_DIR;
      (su.uVel.value as THREE.Vector3).set(wind.x * lean, -fall, wind.y * lean);
      su.uW.value = this.onFoot ? 2.0 : 1.5;
      su.uLen.value = T.streakLen * (0.45 + 0.55 * Math.min(1, R / 0.7)) * (reduceMotion ? 0.6 : 1);
      su.uAlpha.value = T.streakAlpha * (0.72 + 0.28 * Math.min(1, R / 0.6)) * (1 + 0.25 * S) * (this.onFoot ? 1.6 : 1);
      // drizzle is sparse and fine; steady rain denser; storm full
      this.sGeo.instanceCount = Math.min((this.sGeo.attributes.iSeed as THREE.InstancedBufferAttribute).count, Math.round(T.streaks * half * Math.min(1, Math.pow(R, 1.25) * 1.05 + 0.04)));
      // ---- marks: centred where the view meets the water
      const mu = this.mMat.uniforms;
      const ma = mu.uAnchor.value as THREE.Vector3;
      if (this.f.y < -0.05) { const d = Math.min(30, -cam.position.y / this.f.y); ma.copy(cam.position).addScaledVector(this.f, d * 0.8); }
      else ma.copy(cam.position).addScaledVector(this.f, 14);
      mu.uTime.value = this.time * (reduceMotion ? 0.5 : 1);
      mu.uWaterY.value = WATER.y;
      mu.uLife.value = T.markLife;
      mu.uSize.value = T.markSize;
      mu.uAlpha.value = T.markAlpha * Math.min(1, 0.5 + R);
      this.mGeo.instanceCount = Math.min((this.mGeo.attributes.iSeed as THREE.InstancedBufferAttribute).count, Math.round(T.marks * half * Math.min(1, R * R * 1.3 + 0.05)));
    }

    // ---- veils: steady rain and storms show curtains hanging out on the water
    const veilK = Math.max(0, (R - 0.45) / 0.4) * (1 - 0.5 * (this.fogFar < 300 ? 1 : 0)) + S * 0.5;
    const nv = Math.round(Math.min(1, veilK) * T.veils * (this.low ? 0.5 : 1));
    this.vMat.uniforms.uAlpha.value = T.veilAlpha * Math.min(1, veilK);
    this.vMat.uniforms.uTime.value = this.time;
    this.vMat.uniforms.uSlant.value = 0.08 + 0.25 * S;
    this.veils.visible = nv > 0 && this.vMat.uniforms.uAlpha.value > 0.01;
    if (this.veils.visible) this.updateVeils(dt, cam, nv);

    // ---- lightning
    this.strikeT += dt;
    if (S > 0.15 && this.autoStrikes) {
      this.nextStrike -= dt * (0.3 + 0.7 * S);
      if (this.nextStrike <= 0) {
        this.nextStrike = (60 / T.strikesPerMin) * (0.5 + Math.random());
        if (this.strikeT > T.flashGap) this.doStrike(cam, Math.random() < 0.2 * S, false);
      }
    }
    if (this.pending) { const p = this.pending === 'near'; this.pending = null; this.doStrike(cam, p, true); }
    this.updateFlash(reduceMotion);
    this.cost = performance.now() - t0;
  }

  private updateVeils(dt: number, cam: THREE.PerspectiveCamera, n: number) {
    const far = Math.min(700, Math.max(160, this.fogFar * 0.75));
    for (let i = 0; i < this.veilState.length; i++) {
      const s = this.veilState[i];
      if (i >= n) { s.live = false; continue; }
      const dx = s.x - cam.position.x, dz = s.z - cam.position.z, d = Math.hypot(dx, dz);
      if (!s.live || d > far * 1.1 || d < far * 0.25) {
        const a = Math.random() * Math.PI * 2, r = far * (0.4 + Math.random() * 0.35);
        s.x = cam.position.x + Math.cos(a) * r; s.z = cam.position.z + Math.sin(a) * r;
        s.w = 40 + Math.random() * 70; s.s = Math.random(); s.live = true;
      }
      s.x += WIND_DIR.x * dt * 2.5; s.z += WIND_DIR.y * dt * 2.5;
      this.vAttr.setXYZW(i, s.x, s.z, s.w, s.s);
    }
    this.vGeo.instanceCount = n;
    this.vAttr.needsUpdate = true;
  }

  private doStrike(cam: THREE.PerspectiveCamera, near: boolean, forced: boolean) {
    if (!forced && this.strikeT < RAIN_TUNE.flashGap) return;
    if (forced && this.strikeT < 0.6) return; // never re-flash mid-flash
    // a point in view: a random screen x, high in the frame, cast to the sea (top-down chase cam rarely shows the horizon)
    let base: THREE.Vector3 | null = null;
    for (let i = 0; i < 6 && !base; i++) {
      const sx = (Math.random() * 1.5 - 0.75) * (near ? 0.9 : 1), sy = near ? 0.1 + Math.random() * 0.45 : 0.3 + Math.random() * 0.4;
      this.v.set(sx, sy, 0.5).unproject(cam);
      this.ray.copy(this.v).sub(cam.position).normalize();
      if (this.ray.y < -0.02) {
        const k = -cam.position.y / this.ray.y;
        if (k < (near ? 120 : 900)) base = new THREE.Vector3(cam.position.x + this.ray.x * k, WATER.y, cam.position.z + this.ray.z * k);
      }
      if (!base && i >= 3) {
        // horizon in view: put it out at distance along that bearing
        const h = Math.hypot(this.ray.x, this.ray.z) || 1, d = near ? 140 : 320 + Math.random() * 380;
        base = new THREE.Vector3(cam.position.x + (this.ray.x / h) * d, 0, cam.position.z + (this.ray.z / h) * d);
      }
    }
    if (!base) return;
    const dist = Math.hypot(base.x - cam.position.x, base.z - cam.position.z);
    this.buildBolts(cam, base, near, dist);
    this.strikeT = 0;
    this.strikeNear = near;
    this.strikeAmp = 0.85 + Math.random() * 0.3;
    // thunder distance: the frame is a few dozen metres of sea, the storm is kilometres away
    const tdist = near ? 250 + Math.random() * 350 : 1200 + Math.random() * 3300;
    this.onStrike?.({ near, dist: tdist, x: base.x, z: base.z });
  }

  private buildBolts(cam: THREE.PerspectiveCamera, base: THREE.Vector3, near: boolean, dist: number) {
    const pos = this.bGeo.attributes.position as THREE.BufferAttribute, att = this.bGeo.attributes.aBolt as THREE.BufferAttribute, idx = this.bGeo.index!;
    let nv = 0, ni = 0;
    const camPos = cam.position;
    const toCam = new THREE.Vector3(), side = new THREE.Vector3(), dir = new THREE.Vector3();
    const ribbon = (pts: THREE.Vector3[], width: number, delay: number, strength: number) => {
      for (const core of [0, 1]) {
        const w = core ? width : width * 4.5;
        for (let i = 0; i < pts.length - 1; i++) {
          if (nv + 4 > MAX_BOLT_V) return;
          const a = pts[i], b = pts[i + 1];
          dir.subVectors(b, a).normalize();
          toCam.subVectors(camPos, a);
          side.crossVectors(dir, toCam).normalize().multiplyScalar(w * (1 - 0.5 * (i / pts.length)));
          const wa = side.clone(), wb = side.clone().multiplyScalar(0.92);
          pos.setXYZ(nv, a.x - wa.x, a.y - wa.y, a.z - wa.z); pos.setXYZ(nv + 1, a.x + wa.x, a.y + wa.y, a.z + wa.z);
          pos.setXYZ(nv + 2, b.x + wb.x, b.y + wb.y, b.z + wb.z); pos.setXYZ(nv + 3, b.x - wb.x, b.y - wb.y, b.z - wb.z);
          for (let q = 0; q < 4; q++) att.setXYZ(nv + q, delay, strength, core);
          idx.setX(ni, nv); idx.setX(ni + 1, nv + 1); idx.setX(ni + 2, nv + 2); idx.setX(ni + 3, nv); idx.setX(ni + 4, nv + 2); idx.setX(ni + 5, nv + 3);
          nv += 4; ni += 6;
        }
      }
    };
    // A drawn bolt (WW: angular white zigzags standing up the frame). The chase camera looks down at
    // ~41°, so a world-vertical bolt would project as a long diagonal scratch; instead the bolt stands
    // in the camera's picture plane (camera up / right) on its sea point, like a flat sprite.
    cam.updateMatrixWorld();
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const rt = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const zig = (from: THREE.Vector3, len: number, segs: number, lean: number, swing: number) => {
      const pts = [from.clone()];
      const p = from.clone();
      let side = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < segs; i++) {
        const step = (len / segs) * (0.7 + Math.random() * 0.6);
        if (Math.random() < 0.75) side = -side; // mostly alternating: a zigzag, not a wobble
        p.addScaledVector(up, -step).addScaledVector(rt, (side * (0.25 + Math.random() * 0.45) * swing + lean) * step);
        pts.push(p.clone());
      }
      return pts;
    };
    const count = near ? 1 : 1 + Math.floor(Math.random() * 2.4);
    const H = dist * 1.25; // from the sea point to past the top of the frame
    for (let b = 0; b < count; b++) {
      const bx = base.clone();
      if (b > 0) bx.addScaledVector(rt, (Math.random() < 0.5 ? -1 : 1) * dist * (0.3 + Math.random() * 0.35));
      const lean = (Math.random() - 0.5) * 0.3;
      // build top-down so the zigzag ends exactly on the sea point
      const raw = zig(new THREE.Vector3(), H, 11 + Math.floor(Math.random() * 4), lean, 1);
      const end = raw[raw.length - 1];
      const pts = raw.map((q) => q.sub(end).add(bx));
      const width = Math.max(0.05, dist * 0.0042) * (near ? 1.4 : 1);
      const delay = b === 0 ? 0 : 0.05 + Math.random() * 0.25;
      const strength = (near ? 1 : 0.9) * (b === 0 ? 1 : 0.75);
      ribbon(pts, width, delay, strength);
      // forks: one to three thinner branches off the upper two thirds, angling out and down
      const forks = 1 + Math.floor(Math.random() * 3);
      for (let f = 0; f < forks; f++) {
        const i0 = 1 + Math.floor(Math.random() * Math.floor(pts.length * 0.6));
        const out = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
        ribbon(zig(pts[i0], H * (0.12 + Math.random() * 0.2), 4 + Math.floor(Math.random() * 3), out, 0.8), width * 0.55, delay + 0.03, strength * 0.7);
      }
    }
    idx.needsUpdate = true; pos.needsUpdate = true; att.needsUpdate = true;
    this.bGeo.setDrawRange(0, ni);
    this.bGeo.computeBoundingSphere();
  }

  /**
   * Flash envelope: soft attack (~0.08 s), slow decay (~0.8 s), one re-flare 0.2 s in (real flashes
   * pulse; WW fades slowly). Soft mode: half amplitude, no re-flare. Off: no screen lift.
   */
  private updateFlash(reduceMotion: boolean) {
    const t = this.strikeT;
    const pulse = (t0: number) => { const x = t - t0; return x < 0 ? 0 : x < 0.08 ? x / 0.08 : Math.exp(-(x - 0.08) / 0.3); };
    const soft = reduceMotion || this.flashMode === 'soft';
    let env = pulse(0);
    if (!soft) env = Math.max(env, 0.7 * pulse(0.2));
    const bolt = Math.min(1, t < 0.3 ? 1 : env * 1.2 + 0.25 * Math.exp(-(t - 0.3) * 2));
    this.bolts.visible = t < 1.8;
    this.bMat.uniforms.uAge.value = t;
    this.bMat.uniforms.uFlick.value = soft ? Math.min(1, 0.55 + 0.45 * bolt) : bolt;
    const amp = this.flashMode === 'off' ? 0 : (soft ? 0.5 : 1) * this.strikeAmp;
    const near = this.strikeNear ? RAIN_TUNE.flashNear * env * amp : 0;
    const far = RAIN_TUNE.flashFar * env * amp * (this.strikeNear ? 1.2 : 1);
    this.fMat.uniforms.uNear.value = near;
    this.fMat.uniforms.uFar.value = far;
    this.flash.visible = near + far > 0.004;
  }

  /** Current flash level 0..1 (for tests / audio / UI). */
  get flashLevel() { return +(this.fMat.uniforms.uNear.value + this.fMat.uniforms.uFar.value).toFixed(3); }
  stats() {
    return {
      rain: +this.rain.toFixed(2), storm: +this.storm.toFixed(2), streaks: this.streaks.visible ? this.sGeo.instanceCount : 0,
      marks: this.marks.visible ? this.mGeo.instanceCount : 0, veils: this.veils.visible ? this.vGeo.instanceCount : 0,
      flash: this.flashLevel, sinceStrike: +this.strikeT.toFixed(2), ms: +this.cost.toFixed(3),
    };
  }
}

/** Wind direction the rain leans with (main.ts copies the lighting wind into it). */
export const WIND_DIR = new THREE.Vector2(0.62, -0.78);
