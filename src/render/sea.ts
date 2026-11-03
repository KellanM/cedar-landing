import * as THREE from 'three';
import type { TimeOfDay } from '../world/types';
import { levelMix, type ShoreField } from './shorefield';
import { WATER } from '../game/tide';
import { LIGHT_U } from './lighting';
import { WindLines } from './windlines';
import { CrestSprites, CREST_GLSL, CREST_TUNE } from './crests';
import { SWELL, SWELL_GLSL, SWELL_U, setSwellField } from '../game/swell';

/**
 * Stylised sea (docs/water_study.md). One unlit shader on two meshes (near patch + far ring), no
 * extra passes, no depth-texture reads. Layers, back to front:
 *  - shallow -> deep tint from the shore field (real seabed depth + distance to shore), in two
 *    hard-edged steps, colours derived from the time-of-day `sea` / `shallow`;
 *  - slow swell: a 3-tone banded brightness (a few %), downwind;
 *  - drawn wave crests (docs/crest_study.md): by default a pool of crest sprites with a life cycle
 *    (src/render/crests.ts, own draw call); `?crests=cells` draws the same life cycle in jittered
 *    world cells inside this shader, `?crests=old` the first-pass crescent layers;
 *  - shore foam: a broken waterline plus surf bands that roll in toward land;
 *  - sun / moon glints: hard-edged four-point flecks that twinkle inside the sun's reflection cone.
 * All edges are anti-aliased with fwidth, and detail fades both with distance and with the
 * on-screen size of the pattern, so nothing shimmers at phone resolution.
 */

export const WATER_TUNE = {
  crest: 1, // crest opacity (0 = off)
  crestDensity: 0.5, // 0..1 share of the sea that carries crests at any moment
  crestScale: 1, // crest size multiplier
  crestSpeed: 0.3, // m/s drift with the wind
  crestFar: 95, // m: crests gone by this distance
  shore: 1, // shore foam opacity
  surfPeriod: 5.5, // s per surf band cycle
  surfReach: 3.2, // m: how far out the surf bands start
  shallow: 1, // shallow tint strength
  shallowDepth: 4.5, // m: depth where the shallow tint ends
  glint: 1, // glint strength multiplier
  glintCone: 0.86, // cos of the reflection cone the glints live in
  swell: 0.025, // swell banding amplitude (brightness)
  windLines: 1, // wind swooshes in the air (0 = off)
};

/** Comparison variants for the study: ?sea=classic|flat|crests|full|field (default full). */
export type SeaVariant = 'classic' | 'flat' | 'crests' | 'full' | 'field';
/** Crest approaches (crest study): sprites (default), cells (same life cycle in shader cells), old (v0.7 crescents). */
export type CrestMode = 'sprites' | 'cells' | 'old';

function noiseTexture(size = 128) {
  // tileable value noise, 2 octaves, three independent channels (b is finer)
  const data = new Uint8Array(size * size * 4);
  const lat = (n: number, seed: number) => {
    const g = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
    return g;
  };
  const sample = (g: Float32Array, n: number, x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = g[(yi % n) * n + (xi % n)], b = g[(yi % n) * n + ((xi + 1) % n)];
    const c = g[((yi + 1) % n) * n + (xi % n)], d = g[((yi + 1) % n) * n + ((xi + 1) % n)];
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  };
  const chans: [Float32Array, number, Float32Array, number][] = [[lat(8, 11), 8, lat(16, 23), 16], [lat(8, 37), 8, lat(16, 41), 16], [lat(32, 53), 32, lat(64, 59), 64]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) {
      const [g1, n1, g2, n2] = chans[c];
      const v = sample(g1, n1, (x / size) * n1, (y / size) * n1) * 0.65 + sample(g2, n2, (x / size) * n2, (y / size) * n2) * 0.35;
      data[p + c] = Math.round(v * 255);
    }
    data[p + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uWave;
varying vec3 vWorld;
#ifdef SWELL
${SWELL_GLSL}
varying vec2 vUnd;
varying vec3 vSwI; // shelter (chop, swell), swell height
#endif
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
#ifdef SWELL
  // ocean pass 2 (src/game/swell.ts): the cascades displace the grid (choppy: x/z move too)
  vec2 und = wp.xz;
  vUnd = und;
  vec2 shv = uSwOn > 0.5 ? swShelter(und) : vec2(1.0);
  vec3 dd = uSwOn > 0.5 ? swellDispSh(und, shv) : vec3(0.0);
  wp.xyz += dd;
  vSwI = vec3(shv, dd.y);
#else
  float w = sin(wp.x * 0.21 + uTime * 0.9) * 0.5 + sin(wp.z * 0.17 - uTime * 0.7) * 0.35 + sin((wp.x + wp.z) * 0.43 + uTime * 1.6) * 0.15;
  float fade = 1.0 - smoothstep(60.0, 140.0, length(wp.xz - cameraPosition.xz));
  wp.y += w * 0.07 * fade * uWave;
#endif
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uCrestCol;
uniform vec3 uGlintCol;
uniform sampler2D uNoise;
uniform sampler2D uField;
uniform vec4 uFieldRect; // min.xy, 1/size.xy
uniform float uHasField;
uniform vec3 uTideMix; // tides: weights of the field's three waterline channels (r, b, a) for the current level
uniform float uTideY;  // tides: water level (world y); the field's depth is below y 0
uniform vec2 uWind; // unit, blows toward
uniform vec4 uScroll; // layer A offset (xy), layer B offset (zw), in cells
uniform vec3 uSunDir;
uniform float uGlint;
uniform float uGlintCone;
uniform float uCrest;
uniform float uCrestDensity;
uniform float uCrestScale;
uniform float uCrestFar;
uniform float uCrestMode; // 0 old crescents, 1 life-cycle cells, 2 sprites (drawn elsewhere)
uniform vec3 uBeadCol;
uniform float uCrestLife;
uniform float uCrestShelter;
uniform float uShore;
uniform float uSurfPeriod;
uniform float uSurfReach;
uniform float uShallowAmt;
uniform float uShallowDepth;
uniform float uSwell;
uniform float uMotion;
uniform float uLow;
uniform float uDebug;
varying vec3 vWorld;
#ifdef SWELL
varying vec2 vUnd;
varying vec3 vSwI;
uniform sampler2D uSwS0;
uniform sampler2D uSwS1;
uniform sampler2D uSwS2;
uniform sampler2D uSwF0;
uniform sampler2D uSwF1;
uniform vec3 uSwL;
uniform float uSwFoam;
uniform float uSwHs;
uniform float uSwDanger;
uniform float uSwFacet;
uniform float uSwDetail;
uniform vec3 uSkyCol;
uniform vec3 uScatterCol;
uniform vec3 uDangerCol;
#endif
#include <fog_pars_fragment>

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// anti-aliased fill of a signed distance (negative inside); w = one pixel in d units
float fill(float d, float w) { return clamp(0.5 - d / max(w, 1e-4), 0.0, 1.0); }

// One crest: a crescent curl (outer circle minus an offset inner circle) with a small hooked tip,
// facing downwind (+y in crest space). Erosion e > 0 thins it to nothing.
// A brush-stroke crest: a long sliver bowed downwind (+y), thickest just behind its leading end,
// tapering to points, with a small curl flicking back at the leading tip. r = half length.
// Erosion e (0..1) shortens and thins it to nothing, so crests die as strokes, not fades.
float crestSdf(vec2 p, float r, float e) {
  float L = r * (1.0 - 0.45 * e);
  float x = p.x / L;                       // -1..1 along the stroke
  float y = p.y - r * 0.28 * (1.0 - x * x); // bow: the middle leads, the tips trail
  float xc = clamp(x, -1.0, 1.0);
  float t = r * 0.11 * (1.0 - e) * sqrt(max(1.0 - xc * xc, 0.0)) * (0.75 + 0.35 * xc);
  float d = max(abs(y) - t, (abs(x) - 1.0) * L);
  // curl: a short hooked arc at the leading (+x) tip, curling back over the stroke
  float cr = r * 0.16;
  vec2 q = vec2(p.x - L * 0.97, p.y + cr * 0.95);
  float ring = abs(length(q) - cr) - t * 0.0 - r * 0.045 * (1.0 - e);
  ring = max(ring, -q.x - cr * 0.2); // keep the outer half of the ring
  ring = max(ring, q.y - cr * 0.2);  // and only below the tip
  return min(d, ring);
}

// One crest layer: a grid of cells in wind space, one crest per cell (kept inside its cell).
float crestLayer(vec2 wp, vec2 off, float cellSize, float lifeRate, float seed, float pxm, float keep) {
  vec2 uv = wp / cellSize + off;
  vec2 id = mod(floor(uv), 512.0);
  vec2 f = fract(uv) - 0.5;
  vec2 h = hash22(id + seed);
  if (h.y > keep) return 0.0; // empty cell (cells are big, so this branch is coherent)
  float h3 = hash12(id + seed + 17.0);
  float life = fract(uTime * lifeRate + h3 * 7.0);
  float grow = smoothstep(0.0, 0.25, life) * (1.0 - smoothstep(0.55, 1.0, life));
  if (grow < 0.02) return 0.0;
  float r = (0.24 + 0.1 * h3) * uCrestScale;
  vec2 c = (h - 0.5) * vec2(1.0 - 2.2 * r, 0.6);
  vec2 p = f - c;
  float a = (h.x - 0.5) * 0.35; // slight per-crest tilt
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  // life: grow, hold, erode; each crest on its own clock
  float d = crestSdf(p, r, 1.0 - grow);
  // AA width from the continuous pixel footprint (fwidth(d) jumps at cell seams and draws grid lines)
  float w = pxm / cellSize * 1.4;
  return fill(d, w);
}

${CREST_GLSL}
// Life-cycle crests in jittered wind-space cells (?crests=cells): one crest per occupied 10 m cell,
// each on its own clock with a rest between lives, gated by shelter at the cell centre.
vec2 crestCells(vec2 wp, vec2 wdir, float seed) {
  vec2 wper = vec2(-wdir.y, wdir.x);
  const float CELL = 10.0;
  vec2 uv = vec2(dot(wp, wper), dot(wp, wdir)) / CELL + vec2(0.0, uScroll.y * 0.7);
  vec2 id = mod(floor(uv), 512.0);
  vec2 h = hash22(id + seed);
  float h3 = hash12(id + seed + 17.0);
  if (h3 > 0.85) return vec2(1e3);
  float life = uCrestLife * (0.7 + 0.6 * h.x);
  float period = life * (1.3 + 0.6 * h.y);
  float t = fract(uTime / period + h3 * 5.0) * period / life;
  if (t >= 1.0) return vec2(1e3);
  float hl = (0.9 + 0.7 * h.x) * uCrestScale;
  vec2 c = (h - 0.5) * (CELL - 4.0 * hl) / CELL;
  vec2 p = (fract(uv) - 0.5 - c) * CELL;
  // shelter at the cell centre (so a crest is gated whole, never cut)
  if (uHasField > 0.5) {
    vec2 cw = (floor(uv) + 0.5 + c - vec2(0.0, uScroll.y * 0.7)) * CELL;
    vec2 cxz = wper * cw.x + wdir * cw.y;
    vec2 fuv = (cxz - uFieldRect.xy) * uFieldRect.zw;
    if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
      vec4 f4 = texture2D(uField, fuv);
      vec2 fs = vec2(dot(f4.rba, uTideMix), f4.g < 0.0 ? f4.g - uTideY : f4.g + uTideY);
      if (smoothstep(5.0, uCrestShelter, fs.r) * smoothstep(1.5, 5.0, fs.g) < hash12(id + 5.0)) return vec2(1e3);
    }
  }
  float a = (h.y - 0.5) * 0.6;
  p = mat2(cos(a), sin(a), -sin(a), cos(a)) * p;
  return crestShape(p / hl, t, h.x < 0.5 ? -1.0 : 1.0, h3) * hl;
}

// Four-point star glint
float glintSdf(vec2 p, float s) {
  p = abs(p);
  return min(p.x * 3.2 + p.y, p.x + p.y * 3.2) - s;
}

void main() {
  vec3 wp = vWorld;
  vec3 toCam = cameraPosition - wp;
  float dist = length(toCam.xz);
  float footprint = length(fwidth(wp.xz)); // metres per pixel here

  // ---- shore field
  float sd = 99.0, depth = 30.0, under = 0.0; // under: 1 beneath a pier deck
  if (uHasField > 0.5) {
    vec2 fuv = (wp.xz - uFieldRect.xy) * uFieldRect.zw;
    if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
      vec4 f4 = texture2D(uField, fuv);
      vec2 fs = vec2(dot(f4.rba, uTideMix), f4.g);
      sd = fs.r; depth = max((fs.g < 0.0 ? max(-fs.g - 1.0, 0.0) : fs.g) + uTideY, 0.0);
      under = clamp(-fs.g * 2.0, 0.0, 1.0);
    }
  }
  vec4 nz = texture2D(uNoise, wp.xz * 0.0045 + uWind * uTime * 0.0012);

  // ---- shallow / deep: two stepped bands with soft (anti-aliased) edges
  float sh = 1.0 - smoothstep(0.0, uShallowDepth, depth + (nz.b - 0.5) * 0.8);
  sh = max(sh, 1.0 - smoothstep(1.0, 9.0, sd)) * uShallowAmt;
  float sw = max(fwidth(sh), 1e-3);
  float b1 = smoothstep(0.30 - sw, 0.30 + sw, sh);
  float b2 = smoothstep(0.68 - sw, 0.68 + sw, sh);
  vec3 col = mix(uDeep, uMid, b1);
  col = mix(col, uShallow, b2);

  float nearK = 1.0 - smoothstep(uCrestFar * 0.6, uCrestFar * 1.6, dist);

  // ---- slow swell: 3 tones, banded (Classic only: the real swell replaces it)
#ifndef SWELL
  if (uSwell > 0.0 && nearK > 0.0) {
    vec2 perp = vec2(-uWind.y, uWind.x);
    float s = sin(dot(wp.xz, uWind) * 0.06 - uTime * 0.55) * 0.6 + sin(dot(wp.xz, perp) * 0.037 + uTime * 0.31 + nz.r * 3.0) * 0.4;
    float tw = fwidth(s) + 1e-3;
    float tone = smoothstep(0.35 - tw, 0.35 + tw, s) - smoothstep(0.35 - tw, 0.35 + tw, -s);
    col *= 1.0 + tone * uSwell * nearK;
  }
#endif

#ifdef SWELL
  // ---- ocean pass 2 (docs/ocean_study.md): per-pixel normals from the cascades' slope textures
  // (smooth geometry + detailed normals, as the PB oceans do), or flat facets + the fine cascade
  // ("faceted but detailed"); then unlit stylised PB terms: value toward the sun, Fresnel to the
  // sky, crest subsurface (Atlas' scatter term, muted), dark steep faces in dangerous seas.
  vec3 swN = vec3(0.0, 1.0, 0.0);
  float swFoam = 0.0;
  {
    vec2 u0 = vUnd / uSwL.x, u1 = vUnd / uSwL.y, u2 = vUnd / uSwL.z;
    vec4 s0 = texture2D(uSwS0, u0);
    vec4 s1 = texture2D(uSwS1, u1);
    // each band fades once a pixel covers a fair part of its shortest wave (no shimmer)
    float w1 = 1.0 - smoothstep(0.6, 2.6, footprint);
    float w2 = (1.0 - smoothstep(0.07, 0.3, footprint)) * uSwDetail * 0.55;
    vec4 s2 = w2 > 0.0 ? texture2D(uSwS2, u2) : vec4(0.0);
    vec2 sl = s0.xy * vSwI.y + s1.xy * vSwI.x * w1 + s2.xy * vSwI.x * w2;
    vec3 Ns = normalize(vec3(-sl.x, 1.0, -sl.y));
    vec3 fn = normalize(cross(dFdx(wp), dFdy(wp)));
    if (fn.y < 0.0) fn = -fn;
    vec3 Nf = normalize(fn + vec3(-s2.x, 0.0, -s2.y) * vSwI.x * w2 * 0.8);
    swN = normalize(mix(Ns, Nf, uSwFacet * (1.0 - smoothstep(60.0, 140.0, dist))));
    vec3 V = normalize(toCam);
    vec3 L = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.2), uSunDir.z));
    col *= 1.0 + clamp((dot(swN, L) - L.y) * 0.8, -0.14, 0.1);
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(swN, V), 0.0, 1.0), 5.0);
    col = mix(col, uSkyCol, clamp(fres, 0.0, 1.0) * 0.55);
    float H = clamp(vSwI.z / (uSwHs * 0.6), 0.0, 1.0);
    float toward = pow(clamp(dot(normalize(vec2(-V.x, -V.z) + 1e-4), normalize(L.xz + 1e-4)), 0.0, 1.0), 2.0);
    float sss = H * (0.35 + 0.65 * toward) * (0.6 + 0.4 * pow(clamp(dot(V, swN), 0.0, 1.0), 2.0));
    col = mix(col, uScatterCol, sss * 0.45);
    float steep = 1.0 - swN.y;
    col = mix(col, uDangerCol, smoothstep(0.06, 0.3, steep) * uSwDanger * 0.7);
    float f0 = 0.0, f1 = 0.0;
    if (dist < 160.0) { f0 = texture2D(uSwF0, u0).r * vSwI.y; f1 = texture2D(uSwF1, u1).r * vSwI.x * w1; }
    float jNow = clamp((uSwFoam - (s0.z + s1.z - 1.0)) * 5.0, 0.0, 1.0) * vSwI.x; // combined Jacobian (first order)
    swFoam = max(max(f0, f1), jNow) * (1.0 - smoothstep(90.0, 160.0, dist)) * smoothstep(2.0, 6.0, sd);
  }
#endif

  // ---- drawn crests (two layers, wind space)
  float crest = 0.0;
  // mask + fades first: most sea pixels skip the crest maths entirely
  float crestK = 0.0;
  if (uCrest > 0.0 && dist < uCrestFar) {
    // regional mask: crests come and go in patches
    float m = smoothstep(1.0 - uCrestDensity - 0.12, 1.0 - uCrestDensity + 0.12, nz.r * 0.75 + nz.g * 0.5 - 0.1);
    // fade: distance, the pattern's on-screen size (no sub-pixel shimmer), and near the shore (surf takes over)
    float px = smoothstep(0.42, 0.12, footprint);
    float fadeD = 1.0 - smoothstep(uCrestFar * 0.55, uCrestFar, dist);
    float fadeS = smoothstep(2.5, 6.0, sd);
    if (uCrestMode > 0.5) { m = 1.0; px = smoothstep(0.5, 0.15, footprint); }
    crestK = m * px * fadeD * fadeS * uCrest;
  }
  if (crestK > 0.004 && uCrestMode > 0.5 && uCrestMode < 1.5) {
    vec2 cd = crestCells(wp.xz, uWind, 3.0);
    float cw = footprint * 0.9;
    col = mix(col, uBeadCol, fill(cd.y, cw) * 0.85 * crestK);
    col = mix(col, uCrestCol, fill(cd.x, cw) * crestK);
  }
  if (crestK > 0.004 && uCrestMode < 0.5) {
    vec2 wdir = uWind, wper = vec2(-wdir.y, wdir.x);
    float cA = crestLayer(vec2(dot(wp.xz, wper), dot(wp.xz, wdir)), uScroll.xy, 7.0, 0.11, 3.0, footprint, 0.5);
    float cB = 0.0;
    if (uLow < 0.5) {
      float ang = 0.6;
      vec2 d2 = vec2(cos(ang) * wdir.x - sin(ang) * wdir.y, sin(ang) * wdir.x + cos(ang) * wdir.y);
      cB = crestLayer(vec2(dot(wp.xz, vec2(-d2.y, d2.x)), dot(wp.xz, d2)), uScroll.zw, 5.3, 0.15, 41.0, footprint, 0.32) * 0.7;
    }
    crest = max(cA, cB) * crestK;
  }
  col = mix(col, uCrestCol, crest);

#ifdef SWELL
  // ---- foam, drawn like the crests (a white stroke round each patch, a bead-tinted wash inside),
  // persistent: it lingers and drifts after the crest has passed (src/render/oceangpu.ts)
  if (swFoam > 0.02) {
    vec4 fz = texture2D(uNoise, vUnd * 0.09 + uWind * uTime * 0.01);
    float fm = swFoam + (fz.b - 0.5) * 0.5 + (fz.g - 0.5) * 0.25;
    float fw = max(fwidth(fm), 1e-3);
    float inside = smoothstep(0.42 - fw, 0.42 + fw, fm);
    float rim = inside * (1.0 - smoothstep(0.5 - fw, 0.5 + fw, fm));
    float core = smoothstep(0.78 - fw, 0.78 + fw, fm);
    col = mix(col, uBeadCol, inside * 0.6);
    col = mix(col, uCrestCol, max(rim, core));
  }
  // wind-streaked foam lines in dangerous seas: long thin streaks along the wind
  if (uSwDanger > 0.01 && dist < 160.0) {
    vec2 wpp = vec2(-uWind.y, uWind.x);
    vec2 q = vec2(dot(vUnd, wpp) * 0.3, dot(vUnd, uWind) * 0.02 - uTime * 0.02);
    float st = texture2D(uNoise, q).b;
    float sw2 = max(fwidth(st), 1e-3);
    float streak = smoothstep(0.69 - sw2, 0.69 + sw2, st) * uSwDanger * (0.45 + 0.55 * clamp(swFoam * 3.0, 0.0, 1.0)) * (1.0 - smoothstep(70.0, 160.0, dist)) * smoothstep(2.0, 8.0, sd);
    col = mix(col, uBeadCol, streak * 0.75);
  }
#endif

  // ---- shore foam: broken waterline + surf bands rolling in
  if (uShore > 0.0 && sd < uSurfReach + 2.0) {
    float sdw = max(fwidth(sd), 0.02);
    float edgeW = (0.3 + nz.g * 0.3) * mix(1.0, 0.55, smoothstep(1.5, 4.0, depth)) + 0.05 * sin(uTime * 1.3 + nz.r * 9.0);
    // a band, not a fill: wide "land" from the wire pass (low floats, dock decks) keeps water inside its outline
    float foam = fill(sd - edgeW, sdw) * fill(-sd - 0.7, sdw);
    float surf = 0.0;
    for (int k = 0; k < 2; k++) {
      float ph = fract(uTime / uSurfPeriod + float(k) * 0.5 + nz.r * 0.35);
      float c = mix(uSurfReach, edgeW + 0.15, ph);
      float bw = mix(0.2, 0.08, ph);
      float band = fill(abs(sd - c) - bw, sdw);
      float alive = sin(3.14159 * ph);
      float broken = smoothstep(0.35, 0.55, nz.g + 0.35 * sin(sd * 2.0 - ph * 6.0));
      surf = max(surf, band * alive * broken);
    }
    surf *= 1.0 - smoothstep(1.2, 3.0, depth);
    float shoreFoam = max(foam, surf * 0.75) * (1.0 - under) * uShore * (1.0 - smoothstep(180.0, 320.0, dist));
    col = mix(col, uFoam, shoreFoam);
  }

  col *= 1.0 - 0.07 * under; // shade under piers

  // ---- sun / moon glints
  if (uGlint > 0.0 && dist < (uLow > 0.5 ? 80.0 : 140.0)) {
    vec3 v = normalize(-toCam);
    vec3 r = vec3(v.x, -v.y, v.z);
#ifdef SWELL
    r = reflect(v, swN); // glints sparkle on the wave faces
#endif
    float cone = smoothstep(uGlintCone, uGlintCone + (1.0 - uGlintCone) * 0.55, dot(r, uSunDir));
    if (cone > 0.0) {
      vec2 g = wp.xz / 1.4 + uScroll.xy * 0.35;
      vec2 id = mod(floor(g), 512.0);
      vec2 f = fract(g) - 0.5;
      vec2 h = hash22(id + 91.0);
      float tw = fract(uTime * (0.35 + h.y * 0.5) + h.x * 13.0);
      float on = step(1.0 - cone * 0.55, hash12(id + 7.0));
      float size = sin(3.14159 * clamp(tw / 0.22, 0.0, 1.0)) * 0.13;
      float gd = glintSdf(f - (h - 0.5) * 0.5, size);
      float g1 = fill(gd, footprint / 1.4 * 2.5) * on * step(tw, 0.22);
      float px = smoothstep(0.3, 0.1, footprint);
      col = mix(col, uGlintCol, g1 * px * uGlint * cone);
    }
  }

  if (uDebug > 0.5) col = vec3(fract(max(sd, 0.0) / 4.0) * step(0.0, sd), 1.0 - depth / 12.0, sd < 0.0 ? 1.0 : 0.0);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Sea {
  group = new THREE.Group();
  near: THREE.Mesh;
  far: THREE.Mesh;
  wavesEnabled = true;
  /** reduce motion: crests stop drifting, surf and twinkle slow right down */
  reduceMotion = false;
  variant: SeaVariant;
  private time = 0;
  private scroll = new THREE.Vector4();
  private mat: THREE.ShaderMaterial;
  private farMat: THREE.ShaderMaterial;
  private classic: THREE.MeshBasicMaterial[] = [];
  readonly uniforms: Record<string, THREE.IUniform>;
  private glintAmt = 0;
  private glintInit = false;
  private low = false;
  private motion = 1;
  private field: ShoreField | null = null;
  readonly wind = new WindLines();
  readonly crests: CrestSprites;
  crestMode: CrestMode;

  constructor(variant: SeaVariant = 'full', crestMode: CrestMode = 'sprites') {
    this.variant = variant;
    this.crestMode = crestMode;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uWave: { value: 1 },
      uDeep: { value: new THREE.Color(0x4e6670) }, uMid: { value: new THREE.Color(0x4e6670) }, uShallow: { value: new THREE.Color(0x6f8a7e) },
      uFoam: { value: new THREE.Color(0xeef1ec) }, uCrestCol: { value: new THREE.Color(0xe6ebe8) }, uGlintCol: { value: new THREE.Color(0xffffff) },
      uNoise: { value: null }, uField: { value: null }, uFieldRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uHasField: { value: 0 }, uTideMix: { value: new THREE.Vector3(1, 0, 0) }, uTideY: { value: 0 },
      uWind: { value: new THREE.Vector2(0.62, -0.78).normalize() }, uScroll: { value: new THREE.Vector4() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlint: { value: 0 }, uGlintCone: { value: 0.86 },
      uCrest: { value: 1 }, uCrestDensity: { value: 0.5 }, uCrestScale: { value: 1 }, uCrestFar: { value: 95 },
      uCrestMode: { value: 2 }, uBeadCol: { value: new THREE.Color(0xb8c6c4) }, uCrestLife: { value: 4.2 }, uCrestShelter: { value: 30 },
      uShore: { value: 1 }, uSurfPeriod: { value: 5.5 }, uSurfReach: { value: 3.2 },
      uShallowAmt: { value: 1 }, uShallowDepth: { value: 4.5 }, uSwell: { value: 0.025 }, uMotion: { value: 1 }, uLow: { value: 0 },
      uDebug: { value: variant === 'field' ? 1 : 0 },
      uSkyCol: { value: new THREE.Color(0xb8c4c8) }, uScatterCol: { value: new THREE.Color(0x6f9a8c) }, uDangerCol: { value: new THREE.Color(0x2f423e) },
    }]);
    this.uniforms.uNoise.value = noiseTexture();
    Object.assign(this.uniforms, SWELL_U); // ocean experiment: shared by reference
    // both meshes share one uniform set
    const mk = (factor: number) => new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true,
      polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor,
    });
    this.mat = mk(2);
    this.farMat = mk(4);
    // geometry in the XZ plane so the shader works in world space directly
    const nearG = new THREE.PlaneGeometry(320, 320, 64, 64).rotateX(-Math.PI / 2);
    this.near = new THREE.Mesh(nearG, this.mat);
    this.near.position.y = -0.06;
    this.near.renderOrder = -2;
    const farG = new THREE.RingGeometry(150, 30000, 48, 1).rotateX(-Math.PI / 2);
    this.far = new THREE.Mesh(farG, this.farMat);
    this.far.position.y = -0.08;
    this.far.renderOrder = -3;
    this.near.frustumCulled = false;
    this.far.frustumCulled = false;
    this.crests = new CrestSprites(this.uniforms as never);
    this.group.add(this.near, this.far, this.wind.mesh, this.crests.mesh);
    if (variant === 'classic') this.useClassic();
    this.applyVariant();
  }

  /** The pre-study sea (flat colour + vertex ripple), kept for A/B captures (?sea=classic). */
  private useClassic() {
    const mk = (f: number) => {
      const m = new THREE.MeshBasicMaterial({ color: 0x4e6670, polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
      const uTime = this.uniforms.uTime;
      m.onBeforeCompile = (s) => {
        s.uniforms.uTime = uTime;
        s.vertexShader = s.vertexShader.replace('void main() {', 'uniform float uTime;\nvarying float vWave;\nvoid main() {').replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float w = sin(wp.x * 0.21 + uTime * 0.9) * 0.5 + sin(wp.z * 0.17 - uTime * 0.7) * 0.35 + sin((wp.x + wp.z) * 0.43 + uTime * 1.6) * 0.15;
          float fade = 1.0 - smoothstep(60.0, 140.0, length(wp.xz - cameraPosition.xz));
          transformed.y += w * 0.07 * fade; vWave = w * fade;`);
        s.fragmentShader = s.fragmentShader.replace('void main() {', 'varying float vWave;\nvoid main() {').replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 1.0 + vWave * 0.045;');
      };
      return m;
    };
    this.classic = [mk(2), mk(4)];
    this.near.material = this.classic[0];
    this.far.material = this.classic[1];
  }

  private applyVariant() {
    const u = this.uniforms, T = WATER_TUNE, v = this.variant;
    const on = (x: boolean) => (x ? 1 : 0);
    const full = v === 'full' || v === 'field';
    u.uCrest.value = T.crest * on(v !== 'flat');
    u.uShore.value = T.shore * on(full);
    u.uShallowAmt.value = T.shallow * on(full);
    u.uSwell.value = T.swell * on(full);
    u.uGlint.value = this.glintAmt * T.glint * on(full);
    u.uCrestDensity.value = T.crestDensity;
    u.uCrestScale.value = T.crestScale;
    u.uCrestFar.value = this.low ? T.crestFar * 0.7 : T.crestFar;
    u.uSurfPeriod.value = T.surfPeriod;
    u.uSurfReach.value = T.surfReach;
    u.uShallowDepth.value = T.shallowDepth;
    u.uGlintCone.value = T.glintCone;
    u.uLow.value = this.low ? 1 : 0;
    u.uCrestMode.value = this.crestMode === 'old' ? 0 : this.crestMode === 'cells' ? 1 : 2;
    u.uCrestLife.value = CREST_TUNE.life;
    u.uCrestShelter.value = CREST_TUNE.shelter;
    const cs = this.crests;
    cs.enabled = this.crestMode === 'sprites' && T.crest > 0 && v !== 'flat' && v !== 'classic';
    cs.density = T.crestDensity;
    cs.scale = T.crestScale;
    cs.speed = T.crestSpeed;
    cs.far = u.uCrestFar.value;
    cs.low = this.low;
    cs.opacity = T.crest;
  }

  // ---------------------------------------------------------------- ocean experiment (docs/ocean_study.md)
  ocean: 'classic' | 'swell' = 'classic';
  private classicGeo: THREE.BufferGeometry | null = null;
  private swellGeo: THREE.BufferGeometry | null = null;
  private swellCell = 1;
  /** Classic (the shipped sea) or Swell (rolling height field, src/game/swell.ts). */
  setOcean(mode: 'classic' | 'swell') {
    if (mode === this.ocean && (mode === 'classic' || this.swellGeo)) return;
    this.ocean = mode;
    SWELL.on = mode === 'swell';
    SWELL_U.uSwOn.value = SWELL.on ? 1 : 0;
    this.classicGeo ??= this.near.geometry;
    if (mode === 'swell') {
      const n = this.low ? 112 : 144;
      if (!this.swellGeo || this.swellGeo.userData.n !== n) { this.swellGeo?.dispose(); this.swellGeo = swellGrid(n); }
      this.swellCell = this.swellGeo.userData.cell;
      this.near.geometry = this.swellGeo;
    } else this.near.geometry = this.classicGeo;
    for (const m of [this.mat, this.farMat]) {
      if (mode === 'swell') m.defines.SWELL = ''; else delete m.defines.SWELL;
      m.needsUpdate = true;
    }
  }

  /** weather 0..1, read by apply() */
  rain = 0;
  storm = 0;
  setQuality(q: 'high' | 'low') {
    this.low = q === 'low';
    this.applyVariant();
    if (this.ocean === 'swell') { this.ocean = 'classic'; this.setOcean('swell'); } // grid density follows quality
  }

  setShoreField(f: ShoreField | null) {
    this.field?.texture.dispose();
    this.field = f;
    const u = this.uniforms;
    u.uField.value = f?.texture ?? null;
    u.uHasField.value = f ? 1 : 0;
    this.crests.setField(f);
    if (f) u.uFieldRect.value.set(f.min.x, f.min.y, 1 / f.size.x, 1 / f.size.y);
    setSwellField(f, u.uTideMix.value as THREE.Vector3);
  }

  /** Colours from the time of day: deep = the TOD sea, shallow = the TOD shallow (or a lighter, greener sea). */
  apply(t: TimeOfDay, key = '') {
    for (const m of this.classic) m.color.set(t.sea);
    const u = this.uniforms;
    const sea = new THREE.Color(t.sea), haze = new THREE.Color(t.haze);
    const shallow = t.shallow ? new THREE.Color(t.shallow) : sea.clone().lerp(new THREE.Color(0x8fa89a), 0.35);
    // muted: the shallow tint is pulled back toward the sea and desaturated (grey-green, never cyan)
    shallow.lerp(sea, 0.3);
    const l = shallow.r * 0.3 + shallow.g * 0.55 + shallow.b * 0.15;
    shallow.lerp(new THREE.Color(l, l, l), 0.3);
    (u.uDeep.value as THREE.Color).copy(sea).multiplyScalar(0.97);
    (u.uMid.value as THREE.Color).copy(sea).lerp(shallow, 0.5);
    (u.uShallow.value as THREE.Color).copy(shallow);
    // foam and crest whites: off-white pulled toward the haze so they sit in the palette (and dim at night)
    const lum = sea.r * 0.3 + sea.g * 0.55 + sea.b * 0.15; // linear
    const night = lum < 0.02;
    const foam = new THREE.Color(0xf1f3ee).lerp(haze, night ? 0.55 : 0.18);
    if (night) foam.multiplyScalar(0.55);
    (u.uFoam.value as THREE.Color).copy(foam);
    (u.uCrestCol.value as THREE.Color).copy(sea).lerp(foam, this.crestMode === 'old' ? (night ? 0.35 : 0.5) : night ? 0.42 : 0.66);
    (u.uBeadCol.value as THREE.Color).copy(sea).lerp(foam, night ? 0.24 : 0.36);
    // ocean pass 2: the sky the grazing faces mirror, the crest scatter tint, the dangerous-face tone
    (u.uSkyCol.value as THREE.Color).copy(haze).lerp(new THREE.Color(t.horizon), 0.5).lerp(sea, 0.25);
    (u.uScatterCol.value as THREE.Color).copy(shallow).lerp(new THREE.Color(0x7fb3a0), 0.35).multiplyScalar(night ? 0.5 : 1.08);
    (u.uDangerCol.value as THREE.Color).copy(sea).lerp(new THREE.Color(0x24372f), 0.6);
    // glints by key (overcast / fog have no sun)
    const k = key.toLowerCase();
    const g = /night|moon/.test(k) ? { amt: 0.7, col: 0xcfdcf4 } : /dusk|sunset|golden/.test(k) ? { amt: 1, col: 0xffd8a6 } : /dawn|sunrise/.test(k) ? { amt: 1, col: 0xffe2c4 }
      : /fog|mist|overcast|marine/.test(k) ? { amt: 0, col: 0xf4f6f4 } : { amt: 1, col: 0xfffaf0 };
    // eased: apply() runs every half second as the clock turns, so glints fade in over a few seconds
    // weather (docs/rain_study.md): rain puts the sun away; steady rain dimples and calms the small sea,
    // a storm whips it up (more caps, more wind lines)
    g.amt *= Math.max(0, 1 - this.rain * 1.6);
    this.glintAmt = this.glintInit ? this.glintAmt + (g.amt - this.glintAmt) * 0.15 : g.amt;
    this.glintInit = true;
    this.wind.setTOD(key, haze);
    this.crests.todK = /night/.test(k) ? 0.5 : /fog|mist/.test(k) ? 0.6 : /dusk|sunset|golden/.test(k) ? 0.75 : /overcast|marine/.test(k) ? 1 : 0.85;
    const calm = Math.max(0, this.rain - this.storm) * 0.55;
    this.crests.todK = Math.min(1.6, this.crests.todK * (1 - calm) + this.storm * 1.0);
    this.wind.amount = Math.min(1, this.wind.amount * (1 - calm * 0.7) + this.storm);
    this.wind.rate = 1 + this.storm * 2.2;
    (u.uGlintCol.value as THREE.Color).set(g.col);
    this.applyVariant();
  }

  /** Debug: the shore field as an image (R = distance bands, G = shallowness, B = land), row 0 = min z. */
  fieldImage(): string | null {
    const f = this.field;
    if (!f) return null;
    const img = f.texture.image as { data: Uint16Array; width: number; height: number };
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cx = c.getContext('2d')!;
    const out = cx.createImageData(img.width, img.height);
    const fh = THREE.DataUtils.fromHalfFloat;
    for (let p = 0; p < img.width * img.height; p++) {
      const sd = fh(img.data[p * 4]), dp = fh(img.data[p * 4 + 1]);
      out.data[p * 4] = sd > 0 ? ((sd / 4) % 1) * 160 : 0;
      out.data[p * 4 + 1] = Math.max(0, 1 - dp / 8) * 255;
      out.data[p * 4 + 2] = sd <= 0 ? 255 : 0;
      out.data[p * 4 + 3] = 255;
    }
    cx.putImageData(out, 0, 0);
    return c.toDataURL();
  }

  /** Live re-read of WATER_TUNE (tune overlay). */
  retune() { this.applyVariant(); }

  update(dt: number, focus: THREE.Vector3, cam?: THREE.Camera) {
    const u = this.uniforms;
    this.applyVariant(); // live WATER_TUNE (the ?tune overlay edits it in place)
    const target = this.reduceMotion ? 0.15 : 1;
    this.motion += (target - this.motion) * Math.min(1, dt * 2);
    u.uMotion.value = this.motion;
    // one clock for every animated layer, slowed (not jumped) under reduced motion
    if (this.wavesEnabled) this.time = (this.time + dt * this.motion) % 3600;
    u.uTime.value = this.time;
    u.uWave.value = this.reduceMotion ? 0.3 : 1;
    // wind + sun from the lighting module (eased there)
    (u.uWind.value as THREE.Vector2).copy(LIGHT_U.uWindDir.value);
    (u.uSunDir.value as THREE.Vector3).copy(LIGHT_U.uSunDir.value);
    // crest drift in cell units along each layer's downwind axis, wrapped on the 512-cell hash period
    const sp = WATER_TUNE.crestSpeed * (this.reduceMotion ? 0 : this.motion) * dt;
    this.scroll.y = (this.scroll.y - sp / 7.0) % 512;
    this.scroll.w = (this.scroll.w - (sp * 0.75) / 4.6) % 512;
    (u.uScroll.value as THREE.Vector4).copy(this.scroll);
    this.wind.enabled = !this.reduceMotion && WATER_TUNE.windLines > 0 && this.variant !== 'classic';
    if (cam) this.wind.update(dt, cam, u.uWind.value as THREE.Vector2);
    this.crests.motion = this.reduceMotion ? this.motion : 1;
    if (cam) this.crests.update(dt, cam, focus, u.uWind.value as THREE.Vector2);
    // Snap to a 5 m grid so the vertex ripple does not swim with the camera (swell: to the grid's
    // centre cell, so the vertices round the boat stay world-locked)
    const step = this.ocean === 'swell' ? this.swellCell : 5;
    const sx = Math.round(focus.x / step) * step, sz = Math.round(focus.z / step) * step;
    SWELL.cx = sx; SWELL.cz = sz; SWELL_U.uSwCenter.value.set(sx, sz);
    this.near.position.x = sx; this.near.position.z = sz;
    this.far.position.x = sx; this.far.position.z = sz;
    // ---- tides (src/game/tide.ts): the surface sits at the water level; the field blends its waterlines
    this.near.position.y = WATER.y - 0.06; this.far.position.y = WATER.y - 0.08;
    u.uTideY.value = WATER.y;
    if (this.field) (u.uTideMix.value as THREE.Vector3).fromArray(levelMix(this.field.levels, WATER.y));
  }
}

/**
 * Ocean experiment: the near patch as a warped grid, x = 160·(0.3u + 0.7u³) per axis, so cells are
 * ~0.67 m round the boat (144²; 112² on low) and ~5 m at the edge, where only the long swell is left.
 */
function swellGrid(n: number) {
  const g = new THREE.PlaneGeometry(2, 2, n, n).rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const warp = (u: number) => 160 * (0.3 * u + 0.7 * u * u * u);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, warp(p.getX(i)), 0, warp(p.getZ(i)));
  g.computeBoundingSphere();
  g.userData.n = n;
  g.userData.cell = 160 * 0.3 * (2 / n);
  return g;
}
