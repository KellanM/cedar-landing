import * as THREE from 'three';
import { WATER } from './tide';
import { sampleField, type ShoreField } from '../render/shorefield';

/**
 * Swell (docs/ocean_study.md): an experimental rolling sea behind the Log > Developer
 * "Ocean: Classic / Swell" toggle. One deterministic height field shared by the GPU (sea, crest
 * sprites, rain marks, hotspot marks, wake: SWELL_GLSL) and the CPU (boat, floaters, bobber, birds:
 * waterHeight()). Off = 0 everywhere, so Classic is untouched.
 *
 * Model: 6 directional waves with deep-water dispersion (ω² = gk): 4 short wind-sea chop
 * components around the wind and 2 longer swell components. Each is a sharpened sine
 * a·exp(s·(sin θ − 1)) + b (narrow crests, broad troughs, zero mean), so the height at (x, z) is
 * exact on the CPU (no Gerstner inverse). Amplitude and sharpness follow the weather; the shore
 * field (distance to shore + depth) calms sheltered water; short waves fade with distance from
 * the grid centre before the mesh gets too coarse to carry them.
 * Whitecaps: the crest's downward acceleration / g (the height-field analogue of Sea of Thieves'
 * Jacobian foam), compared against a threshold that drops in storms.
 */

const G = 9.81;
/** a touch slower than real deep water (cozy), same for CPU and GPU */
const TIME_K = 0.9;
/** m: everything is flat beyond this distance from the grid centre (the flat far ring takes over) */
export const SWELL_R = 135;
export const NW = 6;

interface WaveDef { lam: number; dir: number; kind: 0 | 1; w: number }
/** λ (m), direction (rad from downwind), kind (0 chop / 1 swell), weight */
const WAVES: WaveDef[] = [
  { lam: 8.3, dir: 0.3, kind: 0, w: 1 },
  { lam: 6.1, dir: -0.1, kind: 0, w: 0.9 },
  { lam: 4.4, dir: -0.56, kind: 0, w: 0.8 },
  { lam: 3.1, dir: 0.72, kind: 0, w: 0.7 },
  { lam: 34, dir: 0.42, kind: 1, w: 1 },
  { lam: 21, dir: 0.18, kind: 1, w: 0.5 },
];

export const SWELL_TUNE = {
  chopSlopeCalm: 0.035, // kA of the chop on a calm day
  chopSlopeStorm: 0.085,
  swellCalm: 0.05, // m amplitude of the long swell, calm
  swellStorm: 0.55,
  sharpCalm: 1.0, // crest sharpness (chop); swell is half
  sharpStorm: 2.2,
  foamCalm: 0.55, // whitecap threshold: crest down-acceleration / g
  foamStorm: 0.34,
  fadeK: 9, // a wave fades out by fadeK × its wavelength from the grid centre
  ease: 15, // s to follow a weather change
  reduceMotion: 0.35, // amplitude under reduced motion
};

export const SWELL = {
  on: false,
  /** 0 calm .. 1 storm (eased) */
  state: 0.12,
  target: 0.12,
  /** pinned sea state (debug), null = weather */
  pinned: null as number | null,
  t: 0,
  /** grid centre (m) the distance fades are measured from (the near sea patch) */
  cx: 0, cz: 0,
  /** m: low-passed, halved boat heave for the chase camera */
  camY: 0,
  foamThr: 0.5,
  field: null as ShoreField | null,
};

/** Shared uniforms (one object, referenced by every material that rides the swell). */
export const SWELL_U = {
  uSwOn: { value: 0 },
  uSwK: { value: Array.from({ length: NW }, () => new THREE.Vector4()) },
  uSwP: { value: Array.from({ length: NW }, () => new THREE.Vector4()) },
  uSwCenter: { value: new THREE.Vector2() },
  uSwField: { value: null as THREE.Texture | null },
  uSwRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uSwHasField: { value: 0 },
  uSwTideMix: { value: new THREE.Vector3(1, 0, 0) },
  uSwTideY: { value: 0 },
  uSwFoam: { value: 0.5 },
  uSwState: { value: 0 },
};

/** GLSL: swellEval(xz) → (height offset from the water level, whitecap metric). 0 when off. */
export const SWELL_GLSL = /* glsl */ `
uniform float uSwOn;
uniform vec4 uSwK[${NW}]; // k.x, k.z, a, sharpness
uniform vec4 uSwP[${NW}]; // phase, b, fade radius, kind (0 chop, 1 swell)
uniform vec2 uSwCenter;
uniform sampler2D uSwField;
uniform vec4 uSwRect;
uniform float uSwHasField;
uniform vec3 uSwTideMix;
uniform float uSwTideY;
vec2 swShelter(vec2 xz) {
  if (uSwHasField < 0.5) return vec2(1.0);
  vec2 fuv = (xz - uSwRect.xy) * uSwRect.zw;
  if (any(lessThan(fuv, vec2(0.0))) || any(greaterThan(fuv, vec2(1.0)))) return vec2(1.0);
  vec4 f4 = texture2D(uSwField, fuv);
  float sd = dot(f4.rba, uSwTideMix);
  float depth = max((f4.g < 0.0 ? max(-f4.g - 1.0, 0.0) : f4.g) + uSwTideY, 0.0);
  return vec2(smoothstep(2.0, 24.0, sd) * smoothstep(0.3, 3.0, depth), smoothstep(0.5, 14.0, sd) * smoothstep(0.2, 2.0, depth));
}
vec2 swellEval(vec2 xz) {
  if (uSwOn < 0.5) return vec2(0.0);
  float d = length(xz - uSwCenter);
  if (d > ${SWELL_R.toFixed(1)}) return vec2(0.0);
  float g = 1.0 - smoothstep(${(SWELL_R * 0.55).toFixed(1)}, ${SWELL_R.toFixed(1)}, d);
  vec2 sh = swShelter(xz);
  float h = 0.0, f = 0.0;
  for (int i = 0; i < ${NW}; i++) {
    vec4 K = uSwK[i], P = uSwP[i];
    float w = g * (1.0 - smoothstep(0.45 * P.z, P.z, d)) * (P.w > 0.5 ? sh.y : sh.x);
    if (w <= 0.0) continue; // past this wave's fade radius (most of the outer grid) or sheltered
    float th = dot(K.xy, xz) - P.x;
    float sn = sin(th), cs = cos(th);
    float e = exp(K.w * (sn - 1.0));
    h += w * (K.z * e + P.y);
    f += w * (P.w > 0.5 ? 0.35 : 1.0) * length(K.xy) * K.z * e * (K.w * sn - K.w * K.w * cs * cs); // the long swell only lifts the chop toward breaking
  }
  return vec2(h, f);
}
`;

// ---------------------------------------------------------------- per-frame wave constants (CPU mirror)
const kx = new Float64Array(NW), kz = new Float64Array(NW), ka = new Float64Array(NW), ks = new Float64Array(NW);
const ph = new Float64Array(NW), pb = new Float64Array(NW), pr = new Float64Array(NW), pk = new Float64Array(NW), kk = new Float64Array(NW);
const phase = new Float64Array(NW);

function besselI0(x: number) {
  let s = 1, term = 1;
  for (let k = 1; k < 12; k++) { term *= (x / 2) * (x / 2) / (k * k); s += term; }
  return s;
}

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

let reduce = false;
const windDir = new THREE.Vector2(0.62, -0.78).normalize();

function rebuild() {
  const T = SWELL_TUNE, s = SWELL.state, amp = reduce ? T.reduceMotion : 1;
  const wa = Math.atan2(windDir.y, windDir.x);
  for (let i = 0; i < NW; i++) {
    const W = WAVES[i], k = (2 * Math.PI) / W.lam;
    const a0 = wa + W.dir;
    kx[i] = Math.cos(a0) * k; kz[i] = Math.sin(a0) * k; kk[i] = k;
    const A = (W.kind === 0
      ? (T.chopSlopeCalm + (T.chopSlopeStorm - T.chopSlopeCalm) * s) * W.w / k
      : (T.swellCalm + (T.swellStorm - T.swellCalm) * s * s) * W.w) * amp;
    const sh = (T.sharpCalm + (T.sharpStorm - T.sharpCalm) * s) * (W.kind === 0 ? 1 : 0.5);
    const lo = Math.exp(-2 * sh);
    const a = (2 * A) / (1 - lo);
    ka[i] = a; ks[i] = sh;
    pb[i] = -a * Math.exp(-sh) * besselI0(sh); // zero mean
    pr[i] = Math.min(SWELL_R, W.lam * T.fadeK);
    pk[i] = W.kind;
    ph[i] = phase[i];
  }
  SWELL.foamThr = T.foamCalm + (T.foamStorm - T.foamCalm) * Math.min(1, Math.max(0, (s - 0.35) / 0.65));
  const U = SWELL_U;
  for (let i = 0; i < NW; i++) {
    U.uSwK.value[i].set(kx[i], kz[i], ka[i], ks[i]);
    U.uSwP.value[i].set(ph[i], pb[i], pr[i], pk[i]);
  }
  U.uSwOn.value = SWELL.on ? 1 : 0;
  U.uSwCenter.value.set(SWELL.cx, SWELL.cz);
  U.uSwFoam.value = SWELL.foamThr;
  U.uSwState.value = SWELL.state;
}

/**
 * Per frame (before anything reads the water): ease the sea state toward the weather, advance the
 * wave phases (wrapped, so the GPU never sees a large time), push the uniforms.
 */
export function updateSwell(dt: number, weather: { rain: number; storm: number }, wind: THREE.Vector2, reduceMotion: boolean) {
  reduce = reduceMotion;
  windDir.copy(wind);
  SWELL.target = SWELL.pinned ?? Math.min(1, 0.12 + 0.35 * weather.rain + 0.6 * weather.storm);
  SWELL.state += (SWELL.target - SWELL.state) * Math.min(1, dt / SWELL_TUNE.ease);
  SWELL.t += dt;
  for (let i = 0; i < NW; i++) {
    const w = Math.sqrt(G * ((2 * Math.PI) / WAVES[i].lam)) * TIME_K;
    phase[i] = (phase[i] + w * dt) % (2 * Math.PI);
  }
  const u = SWELL_U;
  u.uSwTideY.value = WATER.y;
  rebuild();
}

/** Snap the sea state to its target (captures). */
export function snapSwell() { SWELL.state = SWELL.target; rebuild(); }

/** Sea field for sheltering (shared with the sea shader). */
export function setSwellField(f: ShoreField | null, mix: THREE.Vector3) {
  SWELL.field = f;
  const u = SWELL_U;
  u.uSwField.value = f?.texture ?? null;
  u.uSwHasField.value = f ? 1 : 0;
  if (f) u.uSwRect.value.set(f.min.x, f.min.y, 1 / f.size.x, 1 / f.size.y);
  u.uSwTideMix.value = mix; // the sea's live tide mix (same object)
}

function shelter(x: number, z: number, out: [number, number]) {
  out[0] = 1; out[1] = 1;
  const f = SWELL.field;
  if (!f) return out;
  const s = sampleField(f, x, z, WATER.y);
  if (!s) return out;
  const depth = Math.max(s.depth, 0);
  out[0] = ss(2, 24, s.sd) * ss(0.3, 3, depth);
  out[1] = ss(0.5, 14, s.sd) * ss(0.2, 2, depth);
  return out;
}
const shTmp: [number, number] = [1, 1];

/** Swell offset from the water level at (x, z), plus the whitecap metric. Mirrors swellEval(). */
export function swellEval(x: number, z: number, out = { h: 0, foam: 0 }) {
  out.h = 0; out.foam = 0;
  if (!SWELL.on) return out;
  const d = Math.hypot(x - SWELL.cx, z - SWELL.cz);
  if (d > SWELL_R) return out;
  const g = 1 - ss(SWELL_R * 0.55, SWELL_R, d);
  const sh = shelter(x, z, shTmp);
  for (let i = 0; i < NW; i++) {
    const w = g * (1 - ss(0.45 * pr[i], pr[i], d)) * (pk[i] > 0.5 ? sh[1] : sh[0]);
    if (w <= 0) continue;
    const th = kx[i] * x + kz[i] * z - ph[i];
    const sn = Math.sin(th), cs = Math.cos(th);
    const e = Math.exp(ks[i] * (sn - 1));
    out.h += w * (ka[i] * e + pb[i]);
    out.foam += w * (pk[i] > 0.5 ? 0.35 : 1) * kk[i] * ka[i] * e * (ks[i] * sn - ks[i] * ks[i] * cs * cs);
  }
  return out;
}
const evTmp = { h: 0, foam: 0 };

/** Swell offset (m) from WATER.y at (x, z); 0 when the swell is off. */
export function swellAt(x: number, z: number) { return SWELL.on ? swellEval(x, z, evTmp).h : 0; }
/** The water surface (world y) at (x, z): the tide plus the swell. The one truth for anything afloat. */
export function waterHeight(x: number, z: number) { return WATER.y + swellAt(x, z); }
/** Surface slope (dh/dx, dh/dz) by central differences over `e` m. */
export function swellSlope(x: number, z: number, e = 0.4, out = new THREE.Vector2()) {
  if (!SWELL.on) return out.set(0, 0);
  return out.set((swellAt(x + e, z) - swellAt(x - e, z)) / (2 * e), (swellAt(x, z + e) - swellAt(x, z - e)) / (2 * e));
}

/**
 * Hull on the swell: samples the surface at bow, stern, port, starboard and the middle; heave is the
 * mean, pitch / roll the differences; each runs through a damped spring (a heavier hull = softer
 * springs and a wider span, so it averages the chop and rides steadier).
 */
export class Buoyancy {
  heave = 0; pitch = 0; roll = 0;
  private vh = 0; private vp = 0; private vr = 0;
  private init = false;

  reset() { this.init = false; }

  update(dt: number, x: number, z: number, yaw: number, halfLen: number, halfBeam: number, heavy: boolean) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const L = halfLen * (heavy ? 0.85 : 0.75), B = Math.max(0.6, halfBeam * (heavy ? 1.1 : 0.95));
    const hb = swellAt(x + fx * L, z + fz * L), hs = swellAt(x - fx * L, z - fz * L);
    const hp = swellAt(x - rx * B, z - rz * B), hr = swellAt(x + rx * B, z + rz * B);
    const hc = swellAt(x, z);
    // mean of the hull's points, settled a little deeper as the sea builds (the hull digs into each
    // wave rather than perching on it; the wake collar hides the waterline)
    const tH = (hb + hs + hp + hr + hc * 2) / 6 - (0.03 + 0.09 * SWELL.state) * (heavy ? 0.7 : 1);
    const lim = 0.28;
    const tP = Math.max(-lim, Math.min(lim, Math.atan2(hb - hs, 2 * L)));
    const tR = Math.max(-lim, Math.min(lim, Math.atan2(hr - hp, 2 * B)));
    if (!this.init) { this.heave = tH; this.pitch = tP; this.roll = tR; this.vh = this.vp = this.vr = 0; this.init = true; SWELL.camY = tH * 0.5; }
    const wH = heavy ? 4.2 : 6.5, wP = heavy ? 3 : 4.6, wR = heavy ? 2.6 : 3.8, z0 = 0.7;
    // semi-implicit Euler, sub-stepped so a long frame stays stable
    const n = Math.max(1, Math.ceil(dt / 0.016)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vh += (wH * wH * (tH - this.heave) - 2 * z0 * wH * this.vh) * h; this.heave += this.vh * h;
      this.vp += (wP * wP * (tP - this.pitch) - 2 * z0 * wP * this.vp) * h; this.pitch += this.vp * h;
      this.vr += (wR * wR * (tR - this.roll) - 2 * z0 * wR * this.vr) * h; this.roll += this.vr * h;
    }
    // the chase camera follows half the heave, low-passed (never the roll or pitch)
    SWELL.camY += (this.heave * 0.5 - SWELL.camY) * Math.min(1, dt / 1.4);
  }
}

/** Debug readout. */
export function swellStats() {
  return { on: SWELL.on, state: +SWELL.state.toFixed(3), target: +SWELL.target.toFixed(3), foamThr: +SWELL.foamThr.toFixed(3), amps: Array.from(ka, (a, i) => +(a * (1 - Math.exp(-2 * ks[i])) / 2).toFixed(3)), camY: +SWELL.camY.toFixed(3) };
}
