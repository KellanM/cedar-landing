import * as THREE from 'three';
import { addSunShading, INK_PASS } from './lighting';
import { backdropMat, flutterMat, leafyMat, shrubMat, treeMat, WIND } from './materials';

/**
 * Ink outlines (experiment, default off). Two techniques, picked with OUTLINE.mode:
 *
 * 0 "screen" — one fullscreen edge pass. The opaque scene is rendered into a render target with a
 *   depth texture; the pass finds depth silhouettes (1/z Laplacian: the pixel is clearly nearer
 *   than the plane through its neighbours) and strong creases (the angle between the one-sided
 *   depth slopes), and paints them in Logbook ink on the near side. Line width is constant in px,
 *   cost is independent of triangle count. Lines fade with distance + fog.
 *   Ink classes come from the alpha channel of the scene colour (see lighting.ts / sea.ts):
 *   0 = none (the sea), 0.5 = silhouette only, 1 = silhouette + creases.
 *   Things that must not be inked, or that must cover the ink (birds, smoke, clouds, wake, foam,
 *   fog banks, the fishing kit with its own outlines, every transparent FX), go on LATE_LAYER and
 *   are drawn after the edge pass, depth-tested against the depth it writes back.
 *
 * 1 "hull" — classic inverted hull on every world mesh (chunks, protos, boat, people): a back-face
 *   copy pushed out along smoothed normals by a constant px width in clip space.
 * 2 "hybrid" — hulls only on the boat, people and non-foliage props; no terrain, no trees.
 */
export const OUTLINE = {
  on: 0,
  /** 0 screen-space edges, 1 inverted hull (everything), 2 hull on boat/people/props only */
  mode: 0,
  /** line width, CSS px */
  width: 1.5,
  /** ink opacity */
  darkness: 0.85,
  /** metres: full ink up to fadeNear, gone by fadeFar (also multiplied by the scene fog) */
  fadeNear: 40,
  fadeFar: 220,
  /** crease threshold, degrees between neighbouring facets (screen mode) */
  crease: 38,
  /** silhouette threshold: how much further (fraction of depth) the background must be */
  silhouette: 0.04,
  /** ink class for trees / shrubs and for backdrops: 0 none, 0.5 silhouette, 1 full */
  foliage: 0.5,
  backdrop: 0.5,
  /** metres: creases on details smaller than this (lap siding, planks, shingles) are dropped */
  detail: 0.4,
  /** 1 = thin the line with distance */
  taper: 1,
};
export type OutlineTune = typeof OUTLINE;
export const OUTLINE_DEFAULT = { ...OUTLINE };
/** the Logbook ink (--ink #2B2622) */
export const INK_HEX = 0x2b2622;
/** objects drawn after the edge pass (no ink, and they cover it) */
export const LATE_LAYER = 1;

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FS_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uWidth;
uniform float uNear;
uniform float uFar;
uniform vec3 uInk;
uniform float uDark;
uniform vec2 uFade;
uniform vec2 uFog;
uniform float uCrease;
uniform float uSil;
uniform float uPixAng;
uniform float uTaper;
uniform float uDetail;
varying vec2 vUv;

float dist(float d) { return -perspectiveDepthToViewZ(d, uNear, uFar); }

void main() {
  vec4 c = texture2D(tColor, vUv);
  float d0 = texture2D(tDepth, vUv).r;
  gl_FragDepth = d0;
  float ink = 0.0;
  if (d0 < 1.0 && c.a > 0.25) {
    float z0 = dist(d0);
    float fade = (1.0 - smoothstep(uFade.x, uFade.y, z0)) * (1.0 - smoothstep(uFog.x, uFog.y, z0));
    if (fade > 0.01) {
      float w = uWidth * mix(1.0, 0.5, uTaper * smoothstep(uFade.x * 0.5, uFade.y, z0));
      w = max(w, 1.0);
      bool creases = c.a > 0.75;
      float sil = 0.0, cr = 0.0, thin = 0.0;
      // creases are detail: they go at half the silhouette distance, so mid-distance rocks and
      // houses read as shapes, not scribbles
      float crFade = 1.0 - smoothstep(uFade.x * 0.5, uFade.y * 0.5, z0);
      #if AXES == 4
      vec2 dirs[4] = vec2[4](vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.7071, 0.7071), vec2(0.7071, -0.7071));
      #else
      vec2 dirs[2] = vec2[2](vec2(1.0, 0.0), vec2(0.0, 1.0));
      #endif
      for (int i = 0; i < AXES; i++) {
        vec2 o = dirs[i] * uTexel * w;
        float za = dist(texture2D(tDepth, vUv - o).r);
        float zb = dist(texture2D(tDepth, vUv + o).r);
        // 1/z is affine across a plane in screen space: L = 0 on a facet, < 0 when this pixel is
        // nearer than the line through its neighbours (we are on the front side of a silhouette)
        float L = z0 / za + z0 / zb - 2.0;
        sil = max(sil, smoothstep(uSil, uSil * 2.0, -L));
        // both neighbours far behind: a feature thinner than the line (mast, rope, rail)
        thin = max(thin, step(z0 * (1.0 + uSil * 2.0), min(za, zb)));
        if (creases && abs(L) < uSil) {
          float aa = texture2D(tColor, vUv - o).a, ab = texture2D(tColor, vUv + o).a;
          if (min(aa, ab) > 0.75) {
            // one-sided slopes as angles of the surface against the view plane
            float s = z0 * uPixAng * w * length(dirs[i]);
            float ta = atan((z0 - za) / s), tb = atan((zb - z0) / s);
            float k = smoothstep(uCrease, uCrease * 1.25, abs(tb - ta));
            if (k > 0.0) {
              // same test at a larger radius: a real corner bends there too, while lap siding, deck
              // planks and shingles are small steps on a surface that is flat at that scale
              // radius ~uDetail metres on the surface (at least 3 line widths, at most 48 px)
              float R = clamp(uDetail / (z0 * uPixAng * w), 3.0, 48.0 / w);
              float zA = dist(texture2D(tDepth, vUv - o * R).r), zB = dist(texture2D(tDepth, vUv + o * R).r);
              float TA = atan((z0 - zA) / (s * R)), TB = atan((zB - z0) / (s * R));
              k *= smoothstep(uCrease * 0.5, uCrease * 0.8, abs(TB - TA));
            }
            cr = max(cr, k);
          }
        }
      }
      ink = max(sil * (1.0 - 0.45 * thin), cr * crFade) * fade;
    }
  }
  gl_FragColor = vec4(mix(c.rgb, uInk, ink * uDark), 1.0);
  #include <colorspace_fragment>
}`;

const HULL_HEAD = /* glsl */ `
attribute vec3 aHullN;
uniform float uHullPx;
uniform vec2 uHullRes;
uniform vec2 uHullFade;
void main() {`;
const HULL_TAIL = /* glsl */ `
  {
    // push the back faces out along the smoothed normal, a constant number of pixels on screen
    vec3 hn = aHullN;
    #ifdef USE_INSTANCING
      hn = mat3(instanceMatrix) * hn;
    #endif
    hn = normalize(mat3(modelViewMatrix) * hn);
    vec2 cn = (projectionMatrix * vec4(hn, 0.0)).xy;
    float l = length(cn);
    if (l > 1e-5) {
      float k = 1.0 - smoothstep(uHullFade.x, uHullFade.y, gl_Position.w);
      gl_Position.xy += cn / l * (2.0 * uHullPx / uHullRes) * gl_Position.w * k;
    }
  }
  #include <fog_vertex>`;

type HullCat = 'chunk' | 'prop' | 'boat' | 'actor';

/** Smoothed normals per position (welded), so hull shells don't crack on flat-shaded geometry. */
const hullNormals = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();
function smoothNormals(g: THREE.BufferGeometry) {
  const hit = hullNormals.get(g);
  if (hit) return hit;
  const pos = g.getAttribute('position');
  const idx = g.index;
  const n = pos.count;
  const key = new Map<string, number>();
  const id = new Int32Array(n);
  let nk = 0;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
    let v = key.get(k);
    if (v === undefined) { v = nk++; key.set(k, v); }
    id[i] = v;
  }
  const acc = new Float32Array(nk * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  const tri = idx ? idx.count / 3 : n / 3;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    fn.subVectors(c, b).cross(a.sub(b)); // area weighted
    for (const i of [i0, i1, i2]) { acc[id[i] * 3] += fn.x; acc[id[i] * 3 + 1] += fn.y; acc[id[i] * 3 + 2] += fn.z; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    fn.set(acc[id[i] * 3], acc[id[i] * 3 + 1], acc[id[i] * 3 + 2]).normalize();
    out[i * 3] = fn.x; out[i * 3 + 1] = fn.y; out[i * 3 + 2] = fn.z;
  }
  const attr = new THREE.BufferAttribute(out, 3);
  g.setAttribute('aHullN', attr);
  hullNormals.set(g, attr);
  return attr;
}

export class Outline {
  private rt: THREE.WebGLRenderTarget | null = null;
  private fsMat: THREE.ShaderMaterial;
  private fsScene = new THREE.Scene();
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();
  private axes = 4;
  private low = false;
  private hullU = { uHullPx: { value: 1.5 }, uHullRes: { value: new THREE.Vector2(1, 1) }, uHullFade: { value: new THREE.Vector2(40, 220) } };
  private hullMats = new Map<string, THREE.MeshBasicMaterial>();
  private hulls: THREE.Mesh[] = [];
  private lateSet = new Set<THREE.Object3D>();
  private lateRoots: THREE.Object3D[] = [];
  private sweepT = 0;
  private hullTargets: { root: THREE.Object3D; cat: HullCat }[] = [];
  /** ms spent building hull normals (first hull switch) */
  hullBuildMs = 0;

  constructor() {
    this.fsMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: FS_FRAG,
      defines: { AXES: 4 },
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uWidth: { value: 1.5 },
        uNear: { value: 0.3 }, uFar: { value: 1000 }, uInk: { value: new THREE.Color(INK_HEX) }, uDark: { value: 0.8 },
        uFade: { value: new THREE.Vector2(40, 220) }, uFog: { value: new THREE.Vector2(1e5, 1e6) }, uCrease: { value: 0.6 },
        uSil: { value: 0.04 }, uPixAng: { value: 0.001 }, uTaper: { value: 1 }, uDetail: { value: 0.4 },
      },
      depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const q = new THREE.Mesh(tri, this.fsMat);
    q.frustumCulled = false;
    this.fsScene.add(q);
  }

  setQuality(q: 'high' | 'low') {
    this.low = q === 'low';
    const axes = this.low ? 2 : 4;
    if (axes !== this.axes) { this.axes = axes; this.fsMat.defines.AXES = axes; this.fsMat.needsUpdate = true; }
    this.rt?.dispose();
    this.rt = null;
  }

  /** Groups that never get ink and are drawn over it (re-swept every second for new children). */
  setLate(roots: (THREE.Object3D | null | undefined)[]) { this.lateRoots = roots.filter((r): r is THREE.Object3D => !!r); this.sweepT = 0; }
  /** Hull targets by category (hull modes). */
  setHullTargets(t: { root: THREE.Object3D | null | undefined; cat: HullCat }[]) {
    this.hullTargets = t.filter((x): x is { root: THREE.Object3D; cat: HullCat } => !!x.root);
    this.sweepT = 0;
  }

  get active() { return OUTLINE.on > 0.5; }
  get screenMode() { return this.active && Math.round(OUTLINE.mode) === 0; }

  /** Ink classes on the shared materials. */
  private applyClasses() {
    const f = OUTLINE.foliage, b = OUTLINE.backdrop;
    for (const m of [treeMat, leafyMat, shrubMat]) (m.userData.ink as { value: number }).value = f;
    (backdropMat.userData.ink as { value: number }).value = b;
  }

  /** Put the late (un-inked) objects on LATE_LAYER while screen mode is on; back to layer 0 otherwise. */
  private sweepLate(on: boolean) {
    const now = new Set<THREE.Object3D>();
    if (on) {
      for (const r of this.lateRoots) r.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) now.add(o); });
      // plus any transparent, non-depth-writing FX anywhere (splashes, rings, the line, foam)
      for (const r of this.sceneRoots) r.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m || Array.isArray(m)) return;
        if (m.transparent && !m.depthWrite) now.add(o);
      });
    }
    for (const o of this.lateSet) if (!now.has(o)) o.layers.set(0);
    for (const o of now) o.layers.set(LATE_LAYER);
    this.lateSet = now;
  }
  private sceneRoots: THREE.Object3D[] = [];

  private hullMat(_cat: HullCat, src: THREE.Material | THREE.Material[]) {
    const m0 = Array.isArray(src) ? src[0] : src;
    const wind = m0 === treeMat ? 'conifer' : m0 === leafyMat ? 'broadleaf' : m0 === shrubMat ? 'shrub' : 'none';
    const key = wind;
    let m = this.hullMats.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({ color: INK_HEX, side: THREE.BackSide });
    if (wind !== 'none') {
      const w = WIND[wind as 'conifer' | 'broadleaf' | 'shrub'];
      addSunShading(m, 0, 'tree', w.leaf, w.scale); // same sway as the tree, no shading
    }
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.bind(m);
    const U = this.hullU;
    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('void main() {', HULL_HEAD).replace('#include <fog_vertex>', HULL_TAIL);
    };
    m.customProgramCacheKey = () => `${prevKey()}|hull`;
    this.hullMats.set(key, m);
    return m;
  }

  private buildHulls() {
    const mode = Math.round(OUTLINE.mode);
    const t0 = performance.now();
    for (const { root, cat } of this.hullTargets) {
      if (mode === 2 && cat === 'chunk') continue;
      root.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh || src.userData.hull || src.userData.isHull || !src.geometry?.getAttribute('position')) return;
        const mat0 = Array.isArray(src.material) ? src.material[0] : src.material;
        if (cat === 'actor' && !(src as THREE.SkinnedMesh).isSkinnedMesh) return; // actors: rigged people only
        if (mat0 === backdropMat) return; // far forests / backdrops: never (they would be past the fade anyway)
        const fol = mat0 === treeMat || mat0 === leafyMat || mat0 === shrubMat;
        if (mode === 2 && fol) return;
        if (mat0 && (mat0.transparent || (mat0 as THREE.MeshBasicMaterial).side === THREE.BackSide)) return;
        // cards (flags, pennants, laundry) have no inside: a hull would cover them in ink
        if (mat0 && (mat0.alphaTest > 0 || mat0 === flutterMat)) return;
        smoothNormals(src.geometry);
        const mat = this.hullMat(cat, src.material);
        let h: THREE.Mesh;
        if ((src as THREE.SkinnedMesh).isSkinnedMesh) {
          const s = src as THREE.SkinnedMesh;
          const sk = new THREE.SkinnedMesh(s.geometry, mat);
          sk.bind(s.skeleton, s.bindMatrix);
          h = sk;
        } else if ((src as THREE.InstancedMesh).isInstancedMesh) {
          const s = src as THREE.InstancedMesh;
          const im = new THREE.InstancedMesh(s.geometry, mat, s.count);
          im.instanceMatrix = s.instanceMatrix;
          im.count = s.count;
          if (s.boundingSphere) im.boundingSphere = s.boundingSphere.clone();
          h = im;
        } else {
          h = new THREE.Mesh(src.geometry, mat);
        }
        h.userData.isHull = true;
        h.frustumCulled = src.frustumCulled;
        h.renderOrder = src.renderOrder;
        src.userData.hull = h;
        src.add(h);
        this.hulls.push(h);
      });
    }
    this.hullBuildMs += performance.now() - t0;
  }

  private clearHulls() {
    for (const h of this.hulls) {
      const p = h.parent;
      if (p) delete p.userData.hull;
      h.removeFromParent();
    }
    this.hulls = [];
  }

  private lastKey = '';
  /** Per frame: keeps layers / hulls in sync with the settings, then renders. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.sceneRoots = [scene];
    this.applyClasses();
    const mode = this.active ? Math.round(OUTLINE.mode) : -1;
    const key = `${mode}`;
    this.sweepT -= 1;
    if (key !== this.lastKey) {
      this.clearHulls();
      this.lastKey = key;
      this.sweepT = 0;
    }
    if (this.sweepT <= 0) {
      this.sweepT = 60;
      this.sweepLate(mode === 0);
      if (mode === 1 || mode === 2) this.buildHulls();
    }
    // camera sees everything unless we are splitting the frame
    camera.layers.enable(0); camera.layers.enable(LATE_LAYER);
    if (mode !== 0) {
      if (mode > 0) {
        renderer.getDrawingBufferSize(this.size);
        this.hullU.uHullPx.value = OUTLINE.width * renderer.getPixelRatio() * 0.75;
        this.hullU.uHullRes.value.copy(this.size);
        this.hullU.uHullFade.value.set(OUTLINE.fadeNear, Math.max(OUTLINE.fadeNear + 1, OUTLINE.fadeFar));
        for (const h of this.hulls) {
          const p = h.parent as THREE.InstancedMesh | null;
          if (p && (p as THREE.InstancedMesh).isInstancedMesh) (h as THREE.InstancedMesh).count = p.count;
        }
        for (const m of this.hullMats.values()) { m.color.setHex(INK_HEX); m.opacity = 1; }
      }
      renderer.render(scene, camera);
      return;
    }

    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      const dt = new THREE.DepthTexture(w, h);
      dt.type = THREE.UnsignedIntType;
      this.rt = new THREE.WebGLRenderTarget(w, h, { samples: this.low ? 0 : 4, depthTexture: dt, depthBuffer: true });
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    const u = this.fsMat.uniforms;
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.uTexel.value.set(1 / w, 1 / h);
    u.uWidth.value = OUTLINE.width * renderer.getPixelRatio();
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uDark.value = OUTLINE.darkness;
    u.uFade.value.set(OUTLINE.fadeNear, Math.max(OUTLINE.fadeNear + 1, OUTLINE.fadeFar));
    const fog = scene.fog as THREE.Fog | null;
    if (fog && fog.isFog) u.uFog.value.set(fog.near, Math.max(fog.near + 1, fog.far)); else u.uFog.value.set(1e5, 1e6);
    u.uCrease.value = THREE.MathUtils.degToRad(OUTLINE.crease);
    u.uSil.value = OUTLINE.silhouette;
    u.uPixAng.value = THREE.MathUtils.degToRad(camera.fov) / h;
    u.uTaper.value = OUTLINE.taper;
    u.uDetail.value = OUTLINE.detail;
    (u.uInk.value as THREE.Color).setHex(INK_HEX);

    const info = renderer.info;
    const autoReset = info.autoReset, autoClear = renderer.autoClear;
    info.autoReset = false;
    info.reset();
    // 1. opaque world (+ ink classes in alpha) into the target
    camera.layers.disable(LATE_LAYER);
    renderer.setRenderTarget(this.rt);
    INK_PASS.value = 1;
    renderer.render(scene, camera);
    INK_PASS.value = 0;
    // 2. edge pass to the canvas, writing the scene depth back
    renderer.setRenderTarget(null);
    renderer.render(this.fsScene, this.fsCam);
    // 3. the late layer on top, depth tested
    camera.layers.disable(0); camera.layers.enable(LATE_LAYER);
    const bg = scene.background;
    scene.background = null;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = autoClear;
    scene.background = bg;
    camera.layers.enable(0);
    info.autoReset = autoReset;
  }

  stats() {
    return { on: this.active, mode: Math.round(OUTLINE.mode), late: this.lateSet.size, hulls: this.hulls.length, hullBuildMs: +this.hullBuildMs.toFixed(1), rt: this.rt ? [this.rt.width, this.rt.height, this.rt.samples] : null };
  }

  dispose() { this.rt?.dispose(); this.rt = null; }
}

/** `?outline=1` (screen), `?outline=hull`, `?outline=hybrid` */
export function outlineFromUrl() {
  const v = new URLSearchParams(location.search).get('outline');
  if (v === null) return;
  if (v === '0' || v === 'off') { OUTLINE.on = 0; return; }
  OUTLINE.on = 1;
  OUTLINE.mode = v === 'hull' ? 1 : v === 'hybrid' ? 2 : 0;
}
