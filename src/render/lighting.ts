import * as THREE from 'three';

/**
 * Stylized "sun-plane" shading for the unlit, flat vertex-coloured world.
 *
 * The export has no normals, so each fragment derives its flat face normal from screen-space
 * derivatives of its view-space position, rotates it to world space, and dots it with a fake
 * sun direction. The result goes through a hard 3-step ramp (lit / side / shadow), like a painter
 * splitting every form into light and shadow planes (Carlson's angle-to-value rule; The Trail's
 * two/three-value facets). It is a colour multiply on top of the baked overcast palette and the
 * global time-of-day tint, so there are no lights, no shadow maps and no extra passes.
 *
 * Tuning knobs:
 *  - PRESETS below: per time-of-day sun direction, step multipliers, tint colours, thresholds.
 *  - `lightStrength` per material (`setLightStrength`): 0 = untouched, 1 = full ramp.
 *  - `window.__light` in the browser for live tweaking (see bottom of file).
 */

// ---------------------------------------------------------------- presets

export interface LightPreset {
  /** [azimuth°, elevation°]. 0° = north = -Z, 90° = east = +X. */
  sun: [number, number];
  /** Brightness multiplier per step (lit, side, shadow). */
  steps: [number, number, number];
  /** Colour of the light on lit faces (multiplied with the step). */
  litTint: string;
  /** Colour of the shadow planes (multiplied with the step); side faces sit halfway. */
  shadowTint: string;
  /** dot(N, sun) above t[0] is lit, above t[1] is side, else shadow. */
  thresholds: [number, number];
  /** Extra brightness on up-facing faces (N.y > 0.75): flat ground is lighter than slopes. */
  sky: number;
  /** Lowest allowed multiplier, so nothing goes black. */
  ambient: number;
  /** Wind strength for tree sway / flag flutter (1 = a breezy sunbreak). */
  wind: number;
}

const P = (p: LightPreset) => p;

export const PRESETS: Record<string, LightPreset> = {
  // Soft, high, diffuse light: form is legible but the palette barely moves.
  overcast: P({ sun: [200, 62], steps: [1.03, 0.95, 0.87], litTint: '#ffffff', shadowTint: '#eef1f6', thresholds: [0.55, 0.12], sky: 0.03, ambient: 0.6, wind: 0.7 }),
  marine_layer: P({ sun: [200, 65], steps: [1.02, 0.96, 0.9], litTint: '#ffffff', shadowTint: '#f0f2f5', thresholds: [0.55, 0.12], sky: 0.03, ambient: 0.6, wind: 0.5 }),
  // Strong SW sun: warm lit planes, cool blue-ish shadow planes.
  sunbreak: P({ sun: [225, 40], steps: [1.08, 0.9, 0.74], litTint: '#fff4e2', shadowTint: '#c9d6ee', thresholds: [0.3, -0.05], sky: 0.03, ambient: 0.5, wind: 1.0 }),
  // Low NW sun: peach light on the faces turned to it, mauve everywhere else.
  dusk: P({ sun: [300, 8], steps: [1.1, 0.94, 0.82], litTint: '#ffd7b0', shadowTint: '#cdbfdc', thresholds: [0.32, -0.08], sky: 0.04, ambient: 0.5, wind: 0.9 }),
  dawn: P({ sun: [95, 10], steps: [1.1, 0.92, 0.8], litTint: '#ffe0c8', shadowTint: '#c8c0dc', thresholds: [0.32, -0.08], sky: 0.0, ambient: 0.5, wind: 0.45 }),
  // Fog: almost flat.
  fog: P({ sun: [200, 70], steps: [1.01, 0.97, 0.94], litTint: '#ffffff', shadowTint: '#f4f6f6', thresholds: [0.55, 0.12], sky: 0.02, ambient: 0.7, wind: 0.6 }),
  // Moon from the SSE: cool and low contrast.
  night: P({ sun: [150, 35], steps: [1.06, 0.93, 0.82], litTint: '#e4ecff', shadowTint: '#b8c4e8', thresholds: [0.3, -0.05], sky: 0.02, ambient: 0.5, wind: 0.5 }),
};

// ---------------------------------------------------------------- shared uniforms

const U = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uLit: { value: new THREE.Color(1, 1, 1) },
  uSide: { value: new THREE.Color(1, 1, 1) },
  uShadow: { value: new THREE.Color(1, 1, 1) },
  uThresh: { value: new THREE.Vector2(0.5, 0.1) },
  uSky: { value: 0 },
  uAmbient: { value: 0.6 },
  /** 0 = off, 1 = on; animated so the toggle and preset switches never pop. */
  uShadeOn: { value: 1 },
  // wind
  uWindTime: { value: 0 },
  /** Direction the wind blows TOWARD (world xz). Prevailing SW wind -> toward the NE. */
  uWindDir: { value: new THREE.Vector2(0.62, -0.78).normalize() },
  uWindAmp: { value: 0.7 },
  /** 0 = off, 1 = on (eased). */
  uWindOn: { value: 1 },
};

/** Shared lighting uniforms (read by the sea for the sun and wind direction). */
export const LIGHT_U = U;

/** Current (animated) and target state, kept in plain numbers so blending is trivial. */
interface State { dir: THREE.Vector3; lit: THREE.Color; side: THREE.Color; shadow: THREE.Color; t0: number; t1: number; sky: number; ambient: number; wind: number }
const mkState = (): State => ({ dir: new THREE.Vector3(0, 1, 0), lit: new THREE.Color(1, 1, 1), side: new THREE.Color(1, 1, 1), shadow: new THREE.Color(1, 1, 1), t0: 0.5, t1: 0.1, sky: 0, ambient: 0.6, wind: 0.7 });
const cur = mkState();
const target = mkState();
let first = true;
let enabled = true;
let presetKey = 'overcast';
type TodSun = { clouds?: { sun?: [number, number] | null } } | null | undefined;
let lastTod: TodSun = null;
const BLEND_TIME = 1.0; // s, preset cross-fade

const STORE_KEY = 'salish-sea-sunshade';
try { enabled = localStorage.getItem(STORE_KEY) !== 'off'; } catch { /* private mode */ }
U.uShadeOn.value = enabled ? 1 : 0;
const WIND_KEY = 'salish-sea-wind';
let windEnabled = true;
try { windEnabled = localStorage.getItem(WIND_KEY) !== 'off'; } catch { /* private mode */ }
U.uWindOn.value = windEnabled ? 1 : 0;

export function sunVector(azDeg: number, elDeg: number, out = new THREE.Vector3()) {
  const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

function lin(hex: string) { return new THREE.Color(hex); } // Color(hex) converts sRGB -> working (linear)

function fillState(s: State, p: LightPreset, sun: [number, number]) {
  sunVector(sun[0], sun[1], s.dir);
  const litC = lin(p.litTint), shC = lin(p.shadowTint);
  s.lit.copy(litC).multiplyScalar(p.steps[0]);
  s.shadow.copy(shC).multiplyScalar(p.steps[2]);
  s.side.copy(litC).lerp(shC, 0.5).multiplyScalar(p.steps[1]);
  s.t0 = p.thresholds[0];
  s.t1 = p.thresholds[1];
  s.sky = p.sky;
  s.ambient = p.ambient;
  s.wind = p.wind;
}

function presetFor(key: string): LightPreset {
  if (PRESETS[key]) return PRESETS[key];
  const k = key.toLowerCase();
  if (/night|moon/.test(k)) return PRESETS.night;
  if (/dusk|sunset|golden/.test(k)) return PRESETS.dusk;
  if (/dawn|sunrise/.test(k)) return PRESETS.dawn;
  if (/fog|mist/.test(k)) return PRESETS.fog;
  if (/sun|clear|break/.test(k)) return PRESETS.sunbreak;
  return PRESETS.overcast;
}

/**
 * Apply a time-of-day preset. `tod.clouds.sun` from gameplay.json ([az°, el°] or null) wins over
 * the table's sun direction when present; null keeps the table's soft high "sky" direction.
 */
export function setLightingTOD(key: string, tod?: TodSun, instant = false) {
  presetKey = key;
  lastTod = tod;
  const p = presetFor(key);
  const sun = (tod?.clouds?.sun && tod.clouds.sun.length === 2 ? tod.clouds.sun : p.sun) as [number, number];
  fillState(target, p, sun);
  if (first || instant) { copyState(cur, target); first = false; push(); }
}

const blendB = mkState();
/** Continuous clock: target = look `a` blended toward look `b` by `f` (0..1). */
export function setLightingBlend(a: string, todA: TodSun, b: string, todB: TodSun, f: number) {
  presetKey = f < 0.5 ? a : b;
  lastTod = f < 0.5 ? todA : todB;
  const sunOf = (k: string, t: TodSun) => (t?.clouds?.sun && t.clouds.sun.length === 2 ? t.clouds.sun : presetFor(k).sun) as [number, number];
  fillState(target, presetFor(a), sunOf(a, todA));
  if (f > 0 && b !== a) {
    fillState(blendB, presetFor(b), sunOf(b, todB));
    target.dir.lerp(blendB.dir, f).normalize();
    target.lit.lerp(blendB.lit, f);
    target.side.lerp(blendB.side, f);
    target.shadow.lerp(blendB.shadow, f);
    target.t0 += (blendB.t0 - target.t0) * f;
    target.t1 += (blendB.t1 - target.t1) * f;
    target.sky += (blendB.sky - target.sky) * f;
    target.ambient += (blendB.ambient - target.ambient) * f;
    target.wind += (blendB.wind - target.wind) * f;
  }
  if (first) { copyState(cur, target); first = false; push(); }
}

function copyState(a: State, b: State) {
  a.dir.copy(b.dir); a.lit.copy(b.lit); a.side.copy(b.side); a.shadow.copy(b.shadow);
  a.t0 = b.t0; a.t1 = b.t1; a.sky = b.sky; a.ambient = b.ambient; a.wind = b.wind;
}

function push() {
  U.uSunDir.value.copy(cur.dir).normalize();
  U.uLit.value.copy(cur.lit);
  U.uSide.value.copy(cur.side);
  U.uShadow.value.copy(cur.shadow);
  U.uThresh.value.set(cur.t0, cur.t1);
  U.uSky.value = cur.sky;
  U.uAmbient.value = cur.ambient;
  U.uWindAmp.value = cur.wind;
}

/** Per-frame: ease toward the target preset (~1 s) and the on/off toggle. */
export function updateLighting(dt: number) {
  const k = 1 - Math.exp((-dt * 4.6) / BLEND_TIME); // ~99% in BLEND_TIME
  cur.dir.lerp(target.dir, k);
  cur.lit.lerp(target.lit, k);
  cur.side.lerp(target.side, k);
  cur.shadow.lerp(target.shadow, k);
  cur.t0 += (target.t0 - cur.t0) * k;
  cur.t1 += (target.t1 - cur.t1) * k;
  cur.sky += (target.sky - cur.sky) * k;
  cur.ambient += (target.ambient - cur.ambient) * k;
  cur.wind += (target.wind - cur.wind) * k;
  U.uWindTime.value = (U.uWindTime.value + dt) % 3600;
  const won = windEnabled ? 1 : 0;
  U.uWindOn.value += (won - U.uWindOn.value) * (1 - Math.exp(-dt * 3));
  if (Math.abs(won - U.uWindOn.value) < 1e-3) U.uWindOn.value = won;
  const on = enabled ? 1 : 0;
  const ks = 1 - Math.exp((-dt * 4.6) / 0.35);
  U.uShadeOn.value += (on - U.uShadeOn.value) * ks;
  if (Math.abs(on - U.uShadeOn.value) < 1e-3) U.uShadeOn.value = on;
  push();
}

export function sunShadingEnabled() { return enabled; }
export function windOn() { return windEnabled; }
export function setWind(on: boolean, instant = false) {
  windEnabled = on;
  if (instant) U.uWindOn.value = on ? 1 : 0;
  try { localStorage.setItem(WIND_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
export function setSunShading(on: boolean, instant = false) {
  enabled = on;
  if (instant) U.uShadeOn.value = on ? 1 : 0;
  try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- shader patch

export type WindMode = 'none' | 'tree' | 'flutter';

/** Tree sway (InstancedMesh only): bend grows with height above the instance origin. */
const WIND_TREE_GLSL = /* glsl */ `
  #ifdef USE_INSTANCING
  {
    float sy = length(instanceMatrix[1].xyz);
    float h = max(transformed.y, 0.0) * sy;              // metres above the base
    vec3 ip = instanceMatrix[3].xyz;                     // instance origin (world)
    float ph = dot(ip.xz, vec2(0.173, 0.131));           // per-instance phase
    float t = uWindTime;
    // gusty, biased downwind so trees lean rather than wobble around upright
    float sway = 0.55 + 0.6 * sin(t * 1.05 + ph) + 0.25 * sin(t * 2.31 + ph * 1.7);
    float bend = h * (0.016 + 0.03 / (1.0 + h));         // shrubs move relatively more than tall firs
    vec2 off = uWindDir * (bend * sway);
    // leafy crowns: small, faster cross-wind flutter of the outer canopy
    float fl = sin(t * 4.3 + ph * 3.1 + transformed.y * 1.7 + transformed.x * 2.3);
    off += vec2(-uWindDir.y, uWindDir.x) * (fl * uLeaf * 0.035 * min(h, 3.0));
    vec3 woff = vec3(off.x, 0.0, off.y) * (uWindAmp * uWindOn * uWindScale);
    mvPosition.xyz += (viewMatrix * vec4(woff, 0.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
  #endif
`;

/**
 * Flutter (flags, pennants, bunting, laundry): a sine travelling along the cloth, away from the
 * attachment edge. Needs the per-vertex attributes baked by `prepareFlutter` (aFlut, aFlutDir).
 */
const WIND_FLUTTER_GLSL = /* glsl */ `
  {
    float w = aFlut.x;                                   // 0 at the attachment edge -> 1 at the free end
    float s = aFlut.y;                                   // metres along the cloth
    float ph = dot(modelMatrix[3].xz, vec2(0.21, 0.17));
    float t = uWindTime;
    float a = uWindAmp * uWindOn * uWindScale;
    float wave = sin(s * 3.2 - t * (5.0 + 2.0 * uWindAmp) + ph) + 0.35 * sin(s * 7.1 - t * 9.0 + ph * 1.3);
    transformed += aFlutDir * (wave * w * 0.16 * a);
  }
`;

/**
 * Patch a MeshBasicMaterial with the sun-plane ramp. `strength` 0..1 (stored on
 * `material.userData.lightStrength.value`, change it live with setLightStrength).
 * Any existing onBeforeCompile (e.g. the backdrop haze patch) runs first.
 * `wind`: 'tree' sways InstancedMesh protos, 'flutter' waves cloth meshes (see prepareFlutter);
 * `leaf` adds canopy flutter (broadleaf trees / shrubs); `windScale` scales the whole motion.
 */
export function addSunShading(m: THREE.MeshBasicMaterial, strength = 1, wind: WindMode = 'none', leaf = 0, windScale = 1) {
  const uStrength = { value: strength };
  const uLeaf = { value: leaf };
  const uWindScale = { value: windScale };
  m.userData.lightStrength = uStrength;
  m.userData.windScale = uWindScale;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, U, { uLightStrength: uStrength, uLeaf, uWindScale });
    const head = `varying vec3 vSunViewPos;
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindAmp;
uniform float uWindOn;
uniform float uWindScale;
uniform float uLeaf;
${wind === 'flutter' ? 'attribute vec2 aFlut;\nattribute vec3 aFlutDir;\n' : ''}void main() {`;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', head)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${wind === 'flutter' ? WIND_FLUTTER_GLSL : ''}`)
      // project_vertex has applied the instance matrix (USE_INSTANCING), so this works for InstancedMesh.
      // Wind is applied before the varying is written, so derived flat normals follow the motion.
      .replace('#include <project_vertex>', `#include <project_vertex>${wind === 'tree' ? WIND_TREE_GLSL : ''}
  vSunViewPos = mvPosition.xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vSunViewPos;
uniform vec3 uSunDir;
uniform vec3 uLit;
uniform vec3 uSide;
uniform vec3 uShadow;
uniform vec2 uThresh;
uniform float uSky;
uniform float uAmbient;
uniform float uShadeOn;
uniform float uLightStrength;
void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    // Flat face normal from derivatives (view space -> world space). Always faces the camera,
    // which is what we want for double-sided cards and the open canoe hull.
    vec3 nV = normalize(cross(dFdx(vSunViewPos), dFdy(vSunViewPos)));
    vec3 N = normalize((vec4(nV, 0.0) * viewMatrix).xyz);
    float d = dot(N, uSunDir);
    vec3 shade = d > uThresh.x ? uLit : (d > uThresh.y ? uSide : uShadow);
    shade += uSky * step(0.75, N.y);
    shade = max(shade, vec3(uAmbient));
    // Warm, bright, saturated vertex colours (lamp / window glow) are treated as emissive.
    #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
      vec3 vc = vColor.rgb; // raw vertex colour, before the time-of-day tint
    #else
      vec3 vc = vec3(0.0);
    #endif
    float glow = step(0.85, vc.r) * step(0.55, vc.g) * step(vc.b, 0.4);
    float k = uLightStrength * uShadeOn * (1.0 - glow);
    diffuseColor.rgb *= mix(vec3(1.0), shade, k);
  }`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey()}|sunshade|${wind}`;
  m.needsUpdate = true;
  return m;
}

export function setLightStrength(m: THREE.Material, s: number) {
  const u = m.userData.lightStrength as { value: number } | undefined;
  if (u) u.value = s;
}

// ---------------------------------------------------------------- settings row + debug

/** Adds a "Sun shading" On/Off row to the settings modal (above the time-of-day row). */
export function mountSunShadingSetting() {
  const todBtn = document.getElementById('set-tod');
  const anchor = todBtn?.closest('.row');
  if (!anchor || document.getElementById('set-sunshade')) return;
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<span>Sun shading</span><button class="btn small" id="set-sunshade"></button>';
  anchor.parentElement!.insertBefore(row, anchor);
  const btn = row.querySelector('button')!;
  const refresh = () => { btn.textContent = enabled ? 'On' : 'Off'; };
  btn.onclick = () => { setSunShading(!enabled); refresh(); };
  refresh();
}

/**
 * Bake flutter attributes onto every mesh under `root` whose glTF extras say `anim: "flutter"`
 * (or every mesh, with `all`), and give it `mat`. Attachment edge from extras `anchor`
 * ('-x' | '+x' | '-z' | '+z' | 'top'); default: the low end of the longest horizontal axis.
 * The cloth moves along its thinnest local axis (its "normal").
 */
export function prepareFlutter(root: THREE.Object3D, mat: THREE.Material, all = false): number {
  const bb = new THREE.Box3(), size = new THREE.Vector3();
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let anim: string | undefined, anchor: string | undefined;
    for (let p: THREE.Object3D | null = mesh; p; p = p.parent) {
      anim ??= p.userData?.anim as string | undefined;
      anchor ??= p.userData?.anchor as string | undefined;
    }
    if (!all && anim !== 'flutter') return;
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    g.computeBoundingBox();
    bb.copy(g.boundingBox!);
    bb.getSize(size);
    const axisIdx = anchor === 'top' ? 1 : anchor?.endsWith('z') ? 2 : anchor?.endsWith('x') ? 0 : size.x >= size.z ? 0 : 2;
    const fromMax = anchor === 'top' || !!anchor?.startsWith('+');
    const thin = size.x <= size.y && size.x <= size.z ? 0 : size.y <= size.z ? 1 : 2;
    const len = Math.max(1e-3, size.getComponent(axisIdx));
    const flut = new Float32Array(pos.count * 2), dir = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = pos.getComponent(i, axisIdx);
      const dist = fromMax ? bb.max.getComponent(axisIdx) - c : c - bb.min.getComponent(axisIdx);
      flut[i * 2] = Math.min(1, dist / len);
      flut[i * 2 + 1] = dist;
      dir[i * 3 + thin] = 1;
    }
    g.setAttribute('aFlut', new THREE.BufferAttribute(flut, 2));
    g.setAttribute('aFlutDir', new THREE.BufferAttribute(dir, 3));
    mesh.material = mat;
    n++;
  });
  return n;
}

/**
 * Debug (`?flagtest`): a pole with a pennant and a string of bunting near `at`, flutter-tagged the
 * same way dynamic.glb objects will be, to check the effect before the export ships them.
 */
export function makeTestFlag(mat: THREE.Material, at: [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  const colored = (geom: THREE.BufferGeometry, hex: number) => {
    const ng = geom.index ? geom.toNonIndexed() : geom;
    const c = new THREE.Color(hex), n = ng.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return ng;
  };
  const pole = new THREE.Mesh(colored(new THREE.CylinderGeometry(0.05, 0.07, 6, 5), 0x6b5a48), mat);
  pole.position.y = 3;
  const pc = pole.geometry.getAttribute('position').count; // shares flutterMat, so needs (zero) flutter attributes
  pole.geometry.setAttribute('aFlut', new THREE.BufferAttribute(new Float32Array(pc * 2), 2));
  pole.geometry.setAttribute('aFlutDir', new THREE.BufferAttribute(new Float32Array(pc * 3), 3));
  // pennant: 2.4 m long along +x from the pole, 1.2 m tall, subdivided so the wave can bend it
  const flag = new THREE.Mesh(colored(new THREE.PlaneGeometry(2.4, 1.2, 12, 3).translate(1.2, 0, 0), 0xc8402f), mat);
  flag.position.set(0.05, 5.3, 0);
  flag.userData = { anim: 'flutter', anchor: '-x' };
  // bunting: small triangles hanging from a line, attached at the top
  const bunt = new THREE.Group();
  bunt.userData = { anim: 'flutter', anchor: 'top' };
  const cols = [0xe2b04a, 0x3f7a8c, 0xf2efe6, 0xc8402f];
  for (let i = 0; i < 8; i++) {
    const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.25, 0, 0), new THREE.Vector3(0.25, 0, 0), new THREE.Vector3(0, -0.5, 0)]);
    const m = new THREE.Mesh(colored(tri, cols[i % 4]), mat);
    m.position.set(0.2 + i * 0.6, 4.2 - Math.sin((i / 7) * Math.PI) * 0.4, 0.3);
    bunt.add(m);
  }
  g.add(pole, flag, bunt);
  prepareFlutter(g, mat);
  g.position.set(at[0] - 3, Math.max(0, at[1]), at[2] - 6);
  g.rotation.y = 1.0;
  return g;
}

/** Adds a "Wind" On/Off row to the settings modal (above the time-of-day row). */
export function mountWindSetting() {
  const todBtn = document.getElementById('set-tod');
  const anchor = todBtn?.closest('.row');
  if (!anchor || document.getElementById('set-wind')) return;
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<span>Wind</span><button class="btn small" id="set-wind"></button>';
  anchor.parentElement!.insertBefore(row, anchor);
  const btn = row.querySelector('button')!;
  const refresh = () => { btn.textContent = windEnabled ? 'On' : 'Off'; };
  btn.onclick = () => { setWind(!windEnabled); refresh(); };
  refresh();
}

declare global { interface Window { __light: unknown } }
window.__light = {
  PRESETS,
  get state() { return { enabled, wind: windEnabled, windAmp: +U.uWindAmp.value.toFixed(2), preset: presetKey, shadeOn: U.uShadeOn.value, sun: cur.dir.toArray().map((v) => +v.toFixed(3)) }; },
  set: (on: boolean, instant = true) => setSunShading(on, instant),
  wind: (on: boolean, instant = true) => setWind(on, instant),
  /** Re-apply a (tweaked) preset instantly: __light.PRESETS.dusk.steps[2] = 0.7; __light.reapply() */
  reapply: () => setLightingTOD(presetKey, lastTod, true),
  setLightStrength,
  uniforms: U,
};
