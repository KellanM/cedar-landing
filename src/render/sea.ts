import * as THREE from 'three';
import type { TimeOfDay } from '../world/types';
import type { ShoreField } from './shorefield';
import { LIGHT_U } from './lighting';

/**
 * Stylised sea (docs/water_study.md). One unlit shader on two meshes (near patch + far ring), no
 * extra passes, no depth-texture reads. Layers, back to front:
 *  - shallow -> deep tint from the shore field (real seabed depth + distance to shore), in two
 *    hard-edged steps, colours derived from the time-of-day `sea` / `shallow`;
 *  - slow swell: a 3-tone banded brightness (a few %), downwind;
 *  - drawn wave crests: two layers of procedural crescent "curl" marks drifting with the wind,
 *    masked by low-frequency noise so they appear and fade, eroded (not alpha-faded) as they live;
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
};

/** Comparison variants for the study: ?sea=classic|flat|crests|full|field (default full). */
export type SeaVariant = 'classic' | 'flat' | 'crests' | 'full' | 'field';

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
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float w = sin(wp.x * 0.21 + uTime * 0.9) * 0.5 + sin(wp.z * 0.17 - uTime * 0.7) * 0.35 + sin((wp.x + wp.z) * 0.43 + uTime * 1.6) * 0.15;
  float fade = 1.0 - smoothstep(60.0, 140.0, length(wp.xz - cameraPosition.xz));
  wp.y += w * 0.07 * fade * uWave;
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
uniform vec2 uWind; // unit, blows toward
uniform vec4 uScroll; // layer A offset (xy), layer B offset (zw), in cells
uniform vec3 uSunDir;
uniform float uGlint;
uniform float uGlintCone;
uniform float uCrest;
uniform float uCrestDensity;
uniform float uCrestScale;
uniform float uCrestFar;
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
  float sd = 99.0, depth = 30.0;
  if (uHasField > 0.5) {
    vec2 fuv = (wp.xz - uFieldRect.xy) * uFieldRect.zw;
    if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
      vec2 fs = texture2D(uField, fuv).rg;
      sd = fs.r; depth = fs.g;
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

  // ---- slow swell: 3 tones, banded
  if (uSwell > 0.0 && nearK > 0.0) {
    vec2 perp = vec2(-uWind.y, uWind.x);
    float s = sin(dot(wp.xz, uWind) * 0.06 - uTime * 0.55 * uMotion) * 0.6 + sin(dot(wp.xz, perp) * 0.037 + uTime * 0.31 * uMotion + nz.r * 3.0) * 0.4;
    float tw = fwidth(s) + 1e-3;
    float tone = smoothstep(0.35 - tw, 0.35 + tw, s) - smoothstep(0.35 - tw, 0.35 + tw, -s);
    col *= 1.0 + tone * uSwell * nearK;
  }

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
    crestK = m * px * fadeD * fadeS * uCrest;
  }
  if (crestK > 0.004) {
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

  // ---- shore foam: broken waterline + surf bands rolling in
  if (uShore > 0.0 && sd < uSurfReach + 2.0) {
    float sdw = max(fwidth(sd), 0.02);
    float edgeW = (0.3 + nz.g * 0.3) * mix(1.0, 0.55, smoothstep(1.5, 4.0, depth)) + 0.05 * sin(uTime * 1.3 * uMotion + nz.r * 9.0);
    float foam = fill(sd - edgeW, sdw);
    float surf = 0.0;
    for (int k = 0; k < 2; k++) {
      float ph = fract(uTime * uMotion / uSurfPeriod + float(k) * 0.5 + nz.r * 0.35);
      float c = mix(uSurfReach, edgeW + 0.15, ph);
      float bw = mix(0.2, 0.08, ph);
      float band = fill(abs(sd - c) - bw, sdw);
      float alive = sin(3.14159 * ph);
      float broken = smoothstep(0.35, 0.55, nz.g + 0.35 * sin(sd * 2.0 - ph * 6.0));
      surf = max(surf, band * alive * broken);
    }
    surf *= 1.0 - smoothstep(1.2, 3.0, depth);
    float shoreFoam = max(foam, surf * 0.75) * uShore * (1.0 - smoothstep(180.0, 320.0, dist));
    col = mix(col, uFoam, shoreFoam);
  }

  // ---- sun / moon glints
  if (uGlint > 0.0 && dist < (uLow > 0.5 ? 80.0 : 140.0)) {
    vec3 v = normalize(-toCam);
    vec3 r = vec3(v.x, -v.y, v.z);
    float cone = smoothstep(uGlintCone, uGlintCone + (1.0 - uGlintCone) * 0.55, dot(r, uSunDir));
    if (cone > 0.0) {
      vec2 g = wp.xz / 1.4 + uScroll.xy * 0.35;
      vec2 id = mod(floor(g), 512.0);
      vec2 f = fract(g) - 0.5;
      vec2 h = hash22(id + 91.0);
      float tw = fract(uTime * (0.35 + h.y * 0.5) * mix(0.3, 1.0, uMotion) + h.x * 13.0);
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
  private uniforms: Record<string, THREE.IUniform>;
  private glintAmt = 0;
  private low = false;
  private motion = 1;
  private field: ShoreField | null = null;

  constructor(variant: SeaVariant = 'full') {
    this.variant = variant;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uWave: { value: 1 },
      uDeep: { value: new THREE.Color(0x4e6670) }, uMid: { value: new THREE.Color(0x4e6670) }, uShallow: { value: new THREE.Color(0x6f8a7e) },
      uFoam: { value: new THREE.Color(0xeef1ec) }, uCrestCol: { value: new THREE.Color(0xe6ebe8) }, uGlintCol: { value: new THREE.Color(0xffffff) },
      uNoise: { value: null }, uField: { value: null }, uFieldRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uHasField: { value: 0 },
      uWind: { value: new THREE.Vector2(0.62, -0.78).normalize() }, uScroll: { value: new THREE.Vector4() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlint: { value: 0 }, uGlintCone: { value: 0.86 },
      uCrest: { value: 1 }, uCrestDensity: { value: 0.5 }, uCrestScale: { value: 1 }, uCrestFar: { value: 95 },
      uShore: { value: 1 }, uSurfPeriod: { value: 5.5 }, uSurfReach: { value: 3.2 },
      uShallowAmt: { value: 1 }, uShallowDepth: { value: 4.5 }, uSwell: { value: 0.025 }, uMotion: { value: 1 }, uLow: { value: 0 },
      uDebug: { value: variant === 'field' ? 1 : 0 },
    }]);
    this.uniforms.uNoise.value = noiseTexture();
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
    this.group.add(this.near, this.far);
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
  }

  setQuality(q: 'high' | 'low') { this.low = q === 'low'; this.applyVariant(); }

  setShoreField(f: ShoreField | null) {
    this.field?.texture.dispose();
    this.field = f;
    const u = this.uniforms;
    u.uField.value = f?.texture ?? null;
    u.uHasField.value = f ? 1 : 0;
    if (f) u.uFieldRect.value.set(f.min.x, f.min.y, 1 / f.size.x, 1 / f.size.y);
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
    (u.uCrestCol.value as THREE.Color).copy(sea).lerp(foam, night ? 0.35 : 0.5);
    // glints by key (overcast / fog have no sun)
    const k = key.toLowerCase();
    const g = /night|moon/.test(k) ? { amt: 0.7, col: 0xcfdcf4 } : /dusk|sunset|golden/.test(k) ? { amt: 1, col: 0xffd8a6 } : /dawn|sunrise/.test(k) ? { amt: 1, col: 0xffe2c4 }
      : /fog|mist|overcast|marine/.test(k) ? { amt: 0, col: 0xf4f6f4 } : { amt: 1, col: 0xfffaf0 };
    this.glintAmt = g.amt;
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
      const sd = fh(img.data[p * 2]), dp = fh(img.data[p * 2 + 1]);
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

  update(dt: number, focus: THREE.Vector3) {
    const u = this.uniforms;
    const target = this.reduceMotion ? 0.15 : 1;
    this.motion += (target - this.motion) * Math.min(1, dt * 2);
    u.uMotion.value = this.motion;
    if (this.wavesEnabled) this.time = (this.time + dt) % 3600;
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
    // Snap to a 5 m grid so the vertex ripple does not swim with the camera.
    const sx = Math.round(focus.x / 5) * 5, sz = Math.round(focus.z / 5) * 5;
    this.near.position.x = sx; this.near.position.z = sz;
    this.far.position.x = sx; this.far.position.z = sz;
  }
}
