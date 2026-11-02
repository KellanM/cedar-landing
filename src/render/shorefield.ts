import * as THREE from 'three';
import type { LandCollision } from '../game/collision';

/**
 * Shore field for the sea shader (docs/water_study.md §shore field): a top-down texture over the
 * world chunks with, per texel, the signed distance to the waterline (m, + over water, − under
 * land) and the water depth (m). Built once per world load from data already in public/world:
 *
 *  1. Height pass: the chunk meshes are drawn by an orthographic camera looking straight down from
 *     y = +0.4 with the far plane 30 m below, so only geometry under that slab is seen. Land above
 *     the slab is clipped (docks and roofs too, so the water under a pier still counts as water);
 *     the seabed and the beach toe are recorded as heights.
 *  2. Wire pass: the same meshes as lines in a thin slab just above the waterline. Lines rasterise
 *     even when edge-on, so pilings, posts and sea stacks mark themselves as land and get a foam
 *     collar (a filled pass would see their vertical faces as zero-area).
 *     `extras` (buoys, moored boats from dynamic.glb, at their rest pose) join the wire pass only,
 *     so they get a collar without their hulls tinting the water as shallows.
 *  3. Cleared texels are either land interior (clipped) or open water past the terrain. Each cleared
 *     region is classified by its rim (a shore slope reaching the surface → land) and by the coarse
 *     gameplay land grid.
 *  4. Two exact Euclidean distance transforms (Felzenszwalb–Huttenlocher) give the signed distance.
 *
 * Cost: two tiny draws + one readPixels + ~1–2 M texel passes on the CPU, once at load.
 */

export interface ShoreField {
  texture: THREE.DataTexture;
  /** world xz of texel (0,0)'s outer corner, and the world size covered */
  min: THREE.Vector2;
  size: THREE.Vector2;
  ms: number;
  res: [number, number];
}

const TOP = 0.4; // m: slab ceiling (camera height)
const FLOOR = 30; // m below the ceiling
const LAND_H = -0.04; // m: anything higher than this is above the water line
const DEEP = 30; // m: depth reported for open water past the terrain
const MAX_D = 60; // m: distance clamp

export function buildShoreField(renderer: THREE.WebGLRenderer, chunks: { object: THREE.Object3D; bounds: THREE.Box3 }[], land: LandCollision | null, maxRes: number, extras: THREE.Object3D[] = []): ShoreField | null {
  const t0 = performance.now();
  const box = new THREE.Box3();
  for (const c of chunks) if (!c.bounds.isEmpty() && c.bounds.max.x - c.bounds.min.x > 1) box.union(c.bounds);
  if (box.isEmpty()) return null;
  const pad = 24;
  const minX = box.min.x - pad, minZ = box.min.z - pad, sx = box.max.x - box.min.x + pad * 2, sz = box.max.z - box.min.z + pad * 2;
  const cell = Math.max(sx, sz) / maxRes;
  const W = Math.ceil(sx / cell), H = Math.ceil(sz / cell);
  const sizeX = W * cell, sizeZ = H * cell;

  // ---- GPU passes into an 8-bit target: R,G = height (16-bit fixed point over the slab), B = coverage, A = wire flag
  const heightMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying float vY; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `varying float vY; uniform float uWire; void main() {
      float h = clamp((vY - ${(TOP - FLOOR).toFixed(2)}) / ${FLOOR.toFixed(2)}, 0.0, 1.0) * 255.0;
      gl_FragColor = vec4(floor(h) / 255.0, fract(h), 1.0, uWire); }`,
    uniforms: { uWire: { value: 0 } },
  });
  const wireMat = heightMat.clone();
  wireMat.wireframe = true;
  wireMat.uniforms.uWire.value = 1;
  const tmp = new THREE.Scene();
  for (const c of chunks) {
    c.object.updateMatrixWorld(true);
    c.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const a = new THREE.Mesh(m.geometry, heightMat);
      a.matrixAutoUpdate = false; a.matrix.copy(m.matrixWorld); a.frustumCulled = false;
      tmp.add(a);
    });
  }
  const wireOnly: THREE.Mesh[] = [];
  for (const root of extras) {
    if (/kelp/i.test(root.name)) continue;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const a = new THREE.Mesh(m.geometry, wireMat);
      a.matrixAutoUpdate = false; a.matrix.copy(m.matrixWorld); a.frustumCulled = false;
      wireOnly.push(a);
    });
  }
  const cam = new THREE.OrthographicCamera(-sizeX / 2, sizeX / 2, sizeZ / 2, -sizeZ / 2, 0, FLOOR);
  cam.up.set(0, 0, -1); // screen up = world −z
  cam.position.set(minX + sizeX / 2, TOP, minZ + sizeZ / 2);
  cam.lookAt(cam.position.x, -1, cam.position.z);
  cam.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
  const px = new Uint8Array(W * H * 4);
  const prevRT = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const fog = (tmp as THREE.Scene).fog;
  try {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    renderer.clear();
    renderer.render(tmp, cam);
    // wire pass: only the thin slab above the waterline, on top of everything
    tmp.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = wireMat; });
    if (wireOnly.length) tmp.add(...wireOnly);
    cam.far = TOP - LAND_H; cam.updateProjectionMatrix();
    renderer.clearDepth();
    renderer.render(tmp, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  } finally {
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAuto;
    rt.dispose(); heightMat.dispose(); wireMat.dispose();
    void fog;
  }

  // ---- decode into our own layout: row j = z (minZ + (j+0.5)·cell), col i = x. readPixels row 0 = screen bottom = +z.
  const N = W * H;
  const hgt = new Float32Array(N); // world y of the highest surface under the slab
  const state = new Uint8Array(N); // 0 cleared, 1 covered water, 2 land
  for (let j = 0; j < H; j++) {
    const src = (H - 1 - j) * W;
    for (let i = 0; i < W; i++) {
      const s = (src + i) * 4, d = j * W + i;
      if (px[s + 3] > 127) { state[d] = 2; hgt[d] = 0.2; continue; }
      if (px[s + 2] < 128) continue;
      const h = (px[s] + px[s + 1] / 255) / 255; // 0..1
      const y = TOP - FLOOR + h * FLOOR;
      hgt[d] = y;
      state[d] = y > LAND_H ? 2 : 1;
    }
  }

  // ---- classify cleared regions (flood fill): land if the rim reaches the surface or the land grid says so
  const comp = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const gb = land?.gridBox;
  for (let s0 = 0; s0 < N; s0++) {
    if (state[s0] !== 0 || comp[s0] !== -1) continue;
    let sp = 0, n = 0, rim = 0, rimShallow = 0, gridLand = 0, gridIn = 0;
    const members: number[] = [];
    stack[sp++] = s0; comp[s0] = s0;
    while (sp) {
      const p = stack[--sp];
      members.push(p); n++;
      const i = p % W, j = (p - i) / W;
      if (gb) {
        const x = minX + (i + 0.5) * cell, z = minZ + (j + 0.5) * cell;
        const c = Math.floor((x - gb.originX) / gb.cell), r = Math.floor((z - gb.originZ) / gb.cell);
        if (c >= 0 && r >= 0 && c < gb.w && r < gb.h) { gridIn++; if (land!.blocked(x, z)) gridLand++; }
      }
      const nb = [i > 0 ? p - 1 : -1, i < W - 1 ? p + 1 : -1, j > 0 ? p - W : -1, j < H - 1 ? p + W : -1];
      for (const q of nb) {
        if (q < 0) continue;
        if (state[q] === 0) { if (comp[q] === -1) { comp[q] = s0; stack[sp++] = q; } } else { rim++; if (state[q] === 2 || hgt[q] > -1.5) rimShallow++; }
      }
    }
    // grid majority wins where the grid covers the region; elsewhere the rim decides (a shore slope all round)
    const isLand = gridIn > n * 0.3 ? gridLand > gridIn * 0.5 : rim > 0 && rimShallow > rim * 0.6;
    for (const p of members) { state[p] = isLand ? 2 : 1; hgt[p] = isLand ? 0.2 : -DEEP; }
  }

  // ---- signed distance (m): + over water, − under land
  const INF = 1e20;
  const fWater = new Float32Array(N), fLand = new Float32Array(N);
  for (let p = 0; p < N; p++) { const l = state[p] === 2; fWater[p] = l ? 0 : INF; fLand[p] = l ? INF : 0; }
  edt2d(fWater, W, H); // squared px distance from each texel to the nearest land texel
  edt2d(fLand, W, H);
  const data = new Uint16Array(N * 2);
  const toHalf = THREE.DataUtils.toHalfFloat;
  // light blur of the depth so the shallow tint follows the seabed without terracing
  const depth = new Float32Array(N);
  for (let p = 0; p < N; p++) depth[p] = state[p] === 2 ? 0 : Math.min(DEEP, -hgt[p]);
  blur3(depth, W, H);
  for (let p = 0; p < N; p++) {
    // texel centres: half a texel bias puts the iso-line on the texel boundary
    const d = state[p] === 2 ? -(Math.sqrt(fLand[p]) - 0.5) * cell : (Math.sqrt(fWater[p]) - 0.5) * cell;
    data[p * 2] = toHalf(Math.max(-MAX_D, Math.min(MAX_D, d)));
    data[p * 2 + 1] = toHalf(depth[p]);
  }
  const texture = new THREE.DataTexture(data, W, H, THREE.RGFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  const ms = performance.now() - t0;
  return { texture, min: new THREE.Vector2(minX, minZ), size: new THREE.Vector2(sizeX, sizeZ), ms, res: [W, H] };
}

/** In-place 2D squared Euclidean distance transform (Felzenszwalb & Huttenlocher 2012). f: 0 at features, INF elsewhere. */
function edt2d(f: Float32Array, W: number, H: number) {
  const n = Math.max(W, H);
  const g = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) g[j] = f[j * W + i];
    edt1d(g, H, d, v, z);
    for (let j = 0; j < H; j++) f[j * W + i] = d[j];
  }
  for (let j = 0; j < H; j++) {
    const o = j * W;
    for (let i = 0; i < W; i++) g[i] = f[o + i];
    edt1d(g, W, d, v, z);
    for (let i = 0; i < W; i++) f[o + i] = d[i];
  }
}

function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

function blur3(a: Float32Array, W: number, H: number) {
  const t = new Float32Array(a.length);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i;
    t[p] = (a[p - (i > 0 ? 1 : 0)] + a[p] + a[p + (i < W - 1 ? 1 : 0)]) / 3;
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i;
    a[p] = (t[p - (j > 0 ? W : 0)] + t[p] + t[p + (j < H - 1 ? W : 0)]) / 3;
  }
}
