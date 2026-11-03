import * as THREE from 'three';
import { WATER } from './tide';
import { sampleField, type ShoreField } from '../render/shorefield';

/**
 * Swell, pass 2 (docs/ocean_study.md, "Pass 2"): a spectrum ocean in three tiling cascades, the way
 * Atlas / Acerola / Crest build theirs, sized for a phone and WebGL2.
 *
 *  - Sea state S (0 glassy … 3 normal … 5 storm … 7–10 dangerous) sets a significant wave height and
 *    a peak wavelength; a JONSWAP-shaped spectrum spreads that energy over ~100 lattice waves.
 *  - Three cascades (tiles of 256 m, 53.7 m and 11.3 m, incommensurate so they never line up), each
 *    a sparse inverse DFT: a fixed set of lattice wave vectors (so every tile is exactly periodic)
 *    whose amplitudes follow the spectrum and the wind every frame. src/render/oceangpu.ts renders
 *    each cascade into a 64² displacement + slope/Jacobian texture per frame, plus persistent foam.
 *  - Choppiness: horizontal displacement λ·D (Tessendorf §4.6) sharpens crests and widens troughs;
 *    the Jacobian of that map drives the foam (and spray), biased by the sea state (Rare, Atlas).
 *  - The CPU evaluates the same waves analytically (cascades 0–1; cascade 2 is normal detail only),
 *    inverting the horizontal displacement by fixed-point iteration (Atlas' GetWaterHeightAtPoint),
 *    so waterHeight(x, z) is what is drawn.
 * Off = 0 everywhere, so Classic is untouched.
 */

const G = 9.81;
/** a touch slower than real deep water (cozy), same for CPU and GPU */
const TIME_K = 0.9;
/** m: displacement is flat beyond this distance from the grid centre (the flat far ring takes over) */
export const SWELL_R = 140;
export const NC = 3;
export const NW = 40; // max waves per cascade (uniform array size)

export interface CascadeDef { L: number; lmin: number; lmax: number; n: number; disp: boolean }
/** tile size, wavelength band, wave count, displaced (else normals only) */
export const CASCADES: CascadeDef[] = [
  { L: 256, lmin: 24, lmax: 230, n: 36, disp: true },
  { L: 53.7, lmin: 4.6, lmax: 24, n: 40, disp: true },
  { L: 11.3, lmin: 0.8, lmax: 4.6, n: 32, disp: false },
];

/** Sea state table: S → significant wave height (m), peak wavelength (m). Interpolated. */
const SEA_TABLE: [number, number, number][] = [
  [0, 0.03, 3.5], [1, 0.14, 7], [2, 0.28, 10], [3, 0.48, 14], [4, 0.72, 19], [5, 1.05, 25],
  [6, 1.45, 33], [7, 2.0, 43], [8, 2.8, 55], [9, 3.8, 68], [10, 5.0, 85],
];
function seaParams(S: number) {
  const s = Math.min(10, Math.max(0, S)), i = Math.min(9, Math.floor(s)), f = s - i;
  const a = SEA_TABLE[i], b = SEA_TABLE[i + 1];
  return { hs: a[1] + (b[1] - a[1]) * f, lp: a[2] + (b[2] - a[2]) * f };
}

export const SWELL_TUNE = {
  chopCalm: 0.55, // horizontal displacement λ at S 0
  chopRough: 1.0, // … at S 9+
  foamDecay: 2.2, // s for persistent foam to fade to 1/e
  spread: 2, // directional spreading exponent: cos^spread
  ease: 12, // s to follow a weather change (auto)
  reduceMotion: 0.35, // amplitude under reduced motion
  autoMax: 6, // weather Auto never goes past this (dangerous only from the slider)
};

export const SWELL = {
  on: false,
  /** sea state 0..10 (eased) */
  state: 1.2,
  target: 1.2,
  /** pinned sea state (debug), null = mode */
  pinned: null as number | null,
  /** 'auto' follows the weather, a number is the Log > Dev slider */
  mode: 'auto' as 'auto' | number,
  /** look: 0 smooth (per-pixel normals), 1 faceted (flat geometry facets + detail normals) */
  facet: 0,
  t: 0,
  cx: 0, cz: 0,
  /** m: low-passed boat heave for the chase camera */
  camY: 0,
  /** 0..1 danger (S 6.5 → 9) */
  danger: 0,
  hs: 0, lp: 0, chop: 0.6, foamJ: 0,
  field: null as ShoreField | null,
  /** wave direction axis (rad), fixed at the first update from the wind */
  axis: NaN,
  quality: 'high' as 'high' | 'low',
  minJ: 1,
  /** CPU height queries last frame (debug) */
  queries: 0,
  qAcc: 0,
};

/** Shared uniforms (one object, referenced by every material that rides the swell). */
export const SWELL_U = {
  uSwOn: { value: 0 },
  uSwD0: { value: null as THREE.Texture | null },
  uSwD1: { value: null as THREE.Texture | null },
  uSwS0: { value: null as THREE.Texture | null },
  uSwS1: { value: null as THREE.Texture | null },
  uSwS2: { value: null as THREE.Texture | null },
  uSwF0: { value: null as THREE.Texture | null },
  uSwF1: { value: null as THREE.Texture | null },
  uSwL: { value: new THREE.Vector3(CASCADES[0].L, CASCADES[1].L, CASCADES[2].L) },
  uSwCenter: { value: new THREE.Vector2() },
  uSwField: { value: null as THREE.Texture | null },
  uSwRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uSwHasField: { value: 0 },
  uSwTideMix: { value: new THREE.Vector3(1, 0, 0) },
  uSwTideY: { value: 0 },
  uSwFoam: { value: 0 },
  uSwState: { value: 0 },
  uSwHs: { value: 0.1 },
  uSwDanger: { value: 0 },
  uSwFacet: { value: 0 },
  uSwDetail: { value: 1 },
};

/**
 * GLSL: swellDisp(xz) → displacement (dx, dy, dz) of the undisplaced point xz (cascades 0–1, shelter and
 * distance fades applied); swellEval(xz) → (height of the surface over xz, 0) for decals and sprites
 * (one fixed-point step inverts the horizontal displacement). 0 when off.
 */
export const SWELL_GLSL = /* glsl */ `
uniform float uSwOn;
uniform sampler2D uSwD0;
uniform sampler2D uSwD1;
uniform vec3 uSwL;
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
  // x: short chop (calm in the lee and the shallows), y: long swell (wraps in further)
  return vec2(smoothstep(2.0, 24.0, sd) * smoothstep(0.3, 3.0, depth), smoothstep(0.5, 14.0, sd) * smoothstep(0.2, 2.0, depth));
}
vec3 swellDispSh(vec2 xz, vec2 sh) {
  float d = length(xz - uSwCenter);
  if (d > ${SWELL_R.toFixed(1)}) return vec3(0.0);
  float g = 1.0 - smoothstep(${(SWELL_R * 0.55).toFixed(1)}, ${SWELL_R.toFixed(1)}, d);
  vec3 a = texture2D(uSwD0, xz / uSwL.x).xyz * (g * sh.y);
  vec3 b = texture2D(uSwD1, xz / uSwL.y).xyz * (g * sh.x * (1.0 - smoothstep(38.0, 75.0, d)));
  return a + b;
}
vec3 swellDisp(vec2 xz) {
  if (uSwOn < 0.5) return vec3(0.0);
  return swellDispSh(xz, swShelter(xz));
}
vec2 swellEval(vec2 xz) {
  if (uSwOn < 0.5) return vec2(0.0);
  vec2 sh = swShelter(xz);
  vec3 d = swellDispSh(xz, sh);
  return vec2(swellDispSh(xz - d.xz, sh).y, 0.0);
}
`;

// ---------------------------------------------------------------- the waves (CPU mirror of the GPU)
interface Wave { kx: number; kz: number; k: number; w: number; ang: number; ph: number; a: number; area: number }
export const WAVES: Wave[][] = [];

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Pick each cascade's lattice waves once: stratified in log k, spread ±110° round the axis. */
function buildWaves(axis: number) {
  WAVES.length = 0;
  const r = rng(90210);
  CASCADES.forEach((c, ci) => {
    const kq = (2 * Math.PI) / c.L;
    const cand: { n: number; m: number; k: number; rel: number }[] = [];
    const nmax = Math.ceil(c.L / c.lmin);
    for (let n = -nmax; n <= nmax; n++) for (let m = -nmax; m <= nmax; m++) {
      const k = kq * Math.hypot(n, m);
      if (k === 0) continue;
      const lam = (2 * Math.PI) / k;
      if (lam < c.lmin || lam > c.lmax) continue;
      let rel = Math.atan2(m, n) - axis;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      if (Math.abs(rel) > 1.95) continue;
      cand.push({ n, m, k, rel });
    }
    const lk0 = Math.log((2 * Math.PI) / c.lmax), lk1 = Math.log((2 * Math.PI) / c.lmin);
    const bins = 6, per = Math.ceil(c.n / bins);
    const out: Wave[] = [];
    for (let b = 0; b < bins && out.length < c.n; b++) {
      const lo = lk0 + ((lk1 - lk0) * b) / bins, hi = lk0 + ((lk1 - lk0) * (b + 1)) / bins;
      const pool = cand.filter((x) => Math.log(x.k) >= lo && Math.log(x.k) < hi);
      for (let j = 0; j < per && pool.length && out.length < c.n; j++) {
        // favour directions near the axis (cos² weight), but keep some cross-sea
        let best = 0, bw = -1;
        for (let t = 0; t < 4; t++) { const i = Math.floor(r() * pool.length); const wgt = 0.25 + Math.cos(pool[i].rel / 2) ** 2 + r() * 0.3; if (wgt > bw) { bw = wgt; best = i; } }
        const p = pool.splice(best, 1)[0];
        const kx = kq * p.n, kz = kq * p.m;
        out.push({ kx, kz, k: p.k, w: Math.sqrt(G * p.k) * TIME_K, ang: Math.atan2(kz, kx), ph: r() * Math.PI * 2, a: 0, area: ((lk1 - lk0) / c.n) * p.k * p.k });
      }
    }
    WAVES[ci] = out;
  });
}

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let reduce = false;
const windDir = new THREE.Vector2(0.62, -0.78).normalize();

/** JONSWAP-shaped energy in wavenumber (deep water), × directional spreading round the wind. */
function amplitudes() {
  const { hs, lp } = seaParams(SWELL.state);
  SWELL.hs = hs; SWELL.lp = lp;
  const kp = (2 * Math.PI) / lp, wa = Math.atan2(windDir.y, windDir.x);
  const sp = SWELL_TUNE.spread;
  let sum = 0;
  for (const cw of WAVES) for (const w of cw) {
    const x = kp / w.k;
    const pm = Math.pow(w.k, -3) * Math.exp(-1.25 * x * x); // Pierson–Moskowitz in k
    const r = Math.sqrt(w.k / kp) - 1, sig = w.k > kp ? 0.09 : 0.07;
    const peak = Math.pow(3.3, Math.exp(-(r * r) / (2 * sig * sig))); // JONSWAP peak enhancement
    const c = Math.cos(w.ang - wa);
    const dir = Math.pow(Math.max(0, c), sp) * 0.85 + 0.15 * Math.max(0, c + 0.6) / 1.6; // a little cross-sea
    w.a = pm * peak * dir * w.area; // energy share (normalised below)
    sum += w.a;
  }
  // Hs = 4σ, σ² = Σ a²/2 → a_i = sqrt(2 σ² e_i / Σe)
  const sig2 = (hs / 4) ** 2 * (reduce ? SWELL_TUNE.reduceMotion ** 2 : 1);
  for (const cw of WAVES) for (const w of cw) w.a = sum > 0 ? Math.sqrt((2 * sig2 * w.a) / sum) : 0;
  // a floor of fine ripple (cat's paws) so even a glassy sea reads as water, not plastic
  for (const w of WAVES[2] ?? []) w.a = Math.max(w.a, 0.0025 * (1 - SWELL.state / 10) * Math.max(0, Math.cos(w.ang - wa)) );
}

// ---------------------------------------------------------------- per-frame update
export function seaLevelFromWeather(rain: number, storm: number) {
  return Math.min(SWELL_TUNE.autoMax, 1.2 + 2.0 * rain + 3.0 * storm);
}

export function updateSwell(dt: number, weather: { rain: number; storm: number }, wind: THREE.Vector2, reduceMotion: boolean) {
  reduce = reduceMotion;
  windDir.copy(wind);
  if (Number.isNaN(SWELL.axis)) { SWELL.axis = Math.atan2(wind.y, wind.x); buildWaves(SWELL.axis); }
  SWELL.target = SWELL.pinned ?? (SWELL.mode === 'auto' ? seaLevelFromWeather(weather.rain, weather.storm) : SWELL.mode);
  // the slider is a direct control (eases over ~1.5 s); the weather drifts slowly
  const ease = SWELL.mode === 'auto' && SWELL.pinned === null ? SWELL_TUNE.ease : 1.5;
  SWELL.state += (SWELL.target - SWELL.state) * Math.min(1, dt / ease);
  SWELL.t += dt;
  SWELL.queries = SWELL.qAcc; SWELL.qAcc = 0;
  for (const cw of WAVES) for (const w of cw) w.ph = (w.ph + w.w * dt) % (2 * Math.PI);
  rebuild();
}

/** Whitecap threshold on the Jacobian by sea state (tuned against its percentiles, docs/ocean_study.md):
 *  none on a calm day, scattered at 3, a few % at 5, ~10 % at 7–8, a quarter of the sea at 10. */
const FOAM_T: [number, number][] = [[0, 0.6], [2, 0.88], [3, 0.92], [5, 0.86], [7, 0.79], [8, 0.75], [10, 0.69]];
function foamThr(S: number) {
  for (let i = 1; i < FOAM_T.length; i++) if (S <= FOAM_T[i][0]) { const [a, va] = FOAM_T[i - 1], [b, vb] = FOAM_T[i]; return va + ((vb - va) * (S - a)) / (b - a); }
  return FOAM_T[FOAM_T.length - 1][1];
}
/** CPU queries use each displaced cascade's strongest waves only (≤ 14; the rest are centimetres). */
const CPU_K = 14;
const CPU_W: Wave[][] = [[], []];
function pickCpu() {
  for (let c = 0; c < 2; c++) {
    const top = [...WAVES[c]].sort((a, b) => b.a - a.a);
    const amax = top[0]?.a ?? 0;
    CPU_W[c] = top.slice(0, CPU_K).filter((w) => w.a > Math.max(0.003, amax * 0.12));
  }
}
function rebuild() {
  if (!WAVES.length) return;
  amplitudes();
  pickCpu();
  const T = SWELL_TUNE, S = SWELL.state;
  SWELL.chop = T.chopCalm + (T.chopRough - T.chopCalm) * ss(1, 9, S);
  SWELL.foamJ = foamThr(S);
  SWELL.danger = ss(6.5, 9, S);
  const u = SWELL_U;
  u.uSwOn.value = SWELL.on ? 1 : 0;
  u.uSwCenter.value.set(SWELL.cx, SWELL.cz);
  u.uSwTideY.value = WATER.y;
  u.uSwFoam.value = SWELL.foamJ;
  u.uSwState.value = S;
  u.uSwHs.value = Math.max(0.05, SWELL.hs);
  u.uSwDanger.value = SWELL.danger;
  u.uSwFacet.value = SWELL.facet;
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

// ---------------------------------------------------------------- CPU queries
const shTmp: [number, number] = [1, 1];
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

const D = { x: 0, y: 0, z: 0, j: 1 };
/** Displacement of the undisplaced point (x, z) (cascades 0–1), with the GPU's fades; j = Jacobian (if wantJ). */
function disp(x: number, z: number, sh: [number, number], wantJ: boolean) {
  D.x = 0; D.y = 0; D.z = 0; D.j = 1;
  const d = Math.sqrt((x - SWELL.cx) ** 2 + (z - SWELL.cz) ** 2);
  if (d > SWELL_R) return D;
  const g = 1 - ss(SWELL_R * 0.55, SWELL_R, d);
  const lam = SWELL.chop;
  let jxx = 0, jzz = 0, jxz = 0;
  for (let c = 0; c < 2; c++) {
    const wgt = c === 0 ? g * sh[1] : g * sh[0] * (1 - ss(38, 75, d));
    if (wgt <= 0) continue;
    for (const w of CPU_W[c]) {
      const th = w.kx * x + w.kz * z - w.ph;
      const cs = Math.cos(th), sn = Math.sin(th), a = w.a * wgt;
      D.y += a * cs;
      D.x -= lam * (w.kx / w.k) * a * sn;
      D.z -= lam * (w.kz / w.k) * a * sn;
      if (wantJ) { const ac = (a * cs) / w.k; jxx -= lam * w.kx * w.kx * ac; jzz -= lam * w.kz * w.kz * ac; jxz -= lam * w.kx * w.kz * ac; }
    }
  }
  if (wantJ) D.j = (1 + jxx) * (1 + jzz) - jxz * jxz;
  return D;
}

/** Swell offset from the water level over (x, z), plus the whitecap metric (how far the Jacobian is past the foam threshold). */
export function swellEval(x: number, z: number, out = { h: 0, foam: 0 }, wantFoam = true) {
  out.h = 0; out.foam = 0;
  if (!SWELL.on || !WAVES.length) return out;
  SWELL.qAcc++;
  const dx = x - SWELL.cx, dz = z - SWELL.cz;
  if (dx * dx + dz * dz > SWELL_R * SWELL_R) return out;
  const sh = shelter(x, z, shTmp);
  // invert the horizontal displacement: find p with p + D(p) = (x, z) (one fixed-point step is
  // within a few cm at these choppiness levels; two when the foam is wanted)
  let px = x, pz = z;
  for (let i = 0; i < (wantFoam ? 2 : 1); i++) { const d = disp(px, pz, sh, false); px = x - d.x; pz = z - d.z; }
  const d = disp(px, pz, sh, wantFoam);
  out.h = d.y;
  out.foam = wantFoam ? Math.max(0, SWELL.foamJ - d.j) : 0;
  return out;
}
const evTmp = { h: 0, foam: 0 };

/** Swell offset (m) from WATER.y at (x, z); 0 when the swell is off. */
export function swellAt(x: number, z: number) { return SWELL.on ? swellEval(x, z, evTmp, false).h : 0; }
/** The water surface (world y) at (x, z): the tide plus the swell. The one truth for anything afloat. */
export function waterHeight(x: number, z: number) { return WATER.y + swellAt(x, z); }
/** Surface slope (dh/dx, dh/dz) by central differences over `e` m. */
export function swellSlope(x: number, z: number, e = 0.6, out = new THREE.Vector2()) {
  if (!SWELL.on) return out.set(0, 0);
  return out.set((swellAt(x + e, z) - swellAt(x - e, z)) / (2 * e), (swellAt(x, z + e) - swellAt(x, z - e)) / (2 * e));
}

/**
 * Hull on the swell (Atlas: discrete samples → a fitted plane → a spring): bow, stern, port,
 * starboard and the middle; heave is the mean, pitch / roll the differences; each runs through a
 * damped spring (a heavier hull = softer springs and a wider span: it averages the chop). Reports
 * bow slams (the bow driving into a rising face) for spray, sound and the shove.
 */
export class Buoyancy {
  heave = 0; pitch = 0; roll = 0;
  /** m the bow is buried this frame (0 = riding); a slam when it jumps */
  bowDig = 0;
  slam = 0;
  /** ocean pass 3: m the hull floats clear of the water (> 0 = airborne), seconds in the air, and the
   *  hull's downward speed (m/s) on the frame it lands (0 otherwise) */
  air = 0;
  airT = 0;
  impact = 0;
  /** heave velocity (m/s) */
  get heaveV() { return this.vh; }
  private vh = 0; private vp = 0; private vr = 0;
  private init = false;

  reset() { this.init = false; }

  update(dt: number, x: number, z: number, yaw: number, halfLen: number, halfBeam: number, heavy: boolean, speed = 0) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const L = halfLen * (heavy ? 0.85 : 0.75), B = Math.max(0.6, halfBeam * (heavy ? 1.1 : 0.95));
    const hb = swellAt(x + fx * L, z + fz * L), hs = swellAt(x - fx * L, z - fz * L);
    const hp = swellAt(x - rx * B, z - rz * B), hr = swellAt(x + rx * B, z + rz * B);
    const hc = swellAt(x, z);
    const big = Math.min(1, SWELL.hs / 3);
    const tH = (hb + hs + hp + hr + hc * 2) / 6 - (0.03 + 0.08 * Math.min(1, SWELL.hs)) * (heavy ? 0.7 : 1);
    const lim = 0.28 + 0.17 * SWELL.danger;
    const tP = Math.max(-lim, Math.min(lim, Math.atan2(hb - hs, 2 * L)));
    const tR = Math.max(-lim, Math.min(lim, Math.atan2(hr - hp, 2 * B)));
    if (!this.init) { this.heave = tH; this.pitch = tP; this.roll = tR; this.vh = this.vp = this.vr = 0; this.init = true; SWELL.camY = tH * 0.5; }
    // big seas: a little softer (the hull carries momentum over the crests)
    const soft = 1 - 0.25 * big;
    const wH = (heavy ? 4.2 : 6.5) * soft, wP = (heavy ? 3 : 4.6) * soft, wR = (heavy ? 2.6 : 3.8) * soft, z0 = 0.7;
    const n = Math.max(1, Math.ceil(dt / 0.016)), h = dt / n;
    const wasAir = this.air > 0.04;
    // under way, the hull is carried up each face at speed × slope; over the crest it keeps that lift
    // and flies off the back (the hop and landing Wind Waker's boat makes at full sail)
    if (speed > 2 && this.air <= 0.03) {
      const lift = speed * Math.max(0, (hb - hs) / (2 * L)) * (heavy ? 0.6 : 0.85);
      if (lift > this.vh) this.vh += (lift - this.vh) * Math.min(1, dt * 12);
    }
    let peakDown = 0;
    for (let i = 0; i < n; i++) {
      // the water can push the hull up as hard as it likes, but never pull it down faster than
      // gravity: over a sharp crest at speed she leaves the water and flies (Wind Waker's hop)
      const aH = Math.max(-9.81, wH * wH * (tH - this.heave) - 2 * z0 * wH * this.vh);
      this.vh += aH * h; this.heave += this.vh * h;
      if (this.vh < peakDown) peakDown = this.vh;
      this.vp += (wP * wP * (tP - this.pitch) - 2 * z0 * wP * this.vp) * h; this.pitch += this.vp * h;
      this.vr += (wR * wR * (tR - this.roll) - 2 * z0 * wR * this.vr) * h; this.roll += this.vr * h;
    }
    this.air = this.heave - tH;
    this.airT = this.air > 0.05 ? this.airT + dt : 0;
    // touchdown: was clear of the water, now back in it, coming down
    this.impact = wasAir && this.air <= 0.02 && peakDown < -0.45 ? -peakDown : 0;
    // bow slam: how far the water at the bow stands above the (lagging) hull's bow
    const bowY = this.heave + Math.sin(this.pitch) * L;
    const dig = Math.max(0, hb - bowY - 0.15);
    this.slam = dig > 0.25 && this.bowDig <= 0.25 ? dig : 0;
    this.bowDig = dig;
    // the chase camera follows part of the heave, low-passed (never the roll or pitch)
    const follow = (0.5 + 0.25 * SWELL.danger) * (reduce ? 0.6 : 1);
    SWELL.camY += (this.heave * follow - SWELL.camY) * Math.min(1, dt / 1.4);
  }
}

/** Debug: Jacobian percentiles (p1, p5, p50) over 600 points within 40 m of the centre. */
export function jacobianStats() {
  const js: number[] = [], hs: number[] = [];
  const r = rng(7);
  for (let i = 0; i < 600; i++) { const x = SWELL.cx + (r() - 0.5) * 80, z = SWELL.cz + (r() - 0.5) * 80; const d = disp(x, z, [1, 1], true); js.push(d.j); hs.push(d.y); }
  js.sort((a, b) => a - b); hs.sort((a, b) => a - b);
  return { j1: +js[6].toFixed(2), j5: +js[30].toFixed(2), j50: +js[300].toFixed(2), hMin: +hs[0].toFixed(2), hMax: +hs[599].toFixed(2) };
}
/** Debug readout. */
export function swellStats() {
  const top = (c: number) => (WAVES[c] ?? []).map((w) => w.a).sort((a, b) => b - a).slice(0, 3).map((a) => +a.toFixed(3));
  return {
    on: SWELL.on, mode: SWELL.mode, state: +SWELL.state.toFixed(2), target: +SWELL.target.toFixed(2), hs: +SWELL.hs.toFixed(2), lp: +SWELL.lp.toFixed(1),
    chop: +SWELL.chop.toFixed(2), foamJ: +SWELL.foamJ.toFixed(2), danger: +SWELL.danger.toFixed(2), facet: SWELL.facet, minJ: +SWELL.minJ.toFixed(2),
    waves: WAVES.map((c) => c.length), cpuWaves: CPU_W.map((c) => c.length), queries: SWELL.queries, topAmp: [top(0), top(1), top(2)], camY: +SWELL.camY.toFixed(3),
  };
}

/** How exposed (x, z) is to the chop: 0 in the lee / shallows, 1 in open water. */
export function swellExposure(x: number, z: number) { return shelter(x, z, [1, 1])[0]; }
