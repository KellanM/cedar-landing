import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyWorldMaterial } from '../render/materials';
import { DEFAULT_TOD } from './placeholder';
import type { Gameplay, Instances, LoadedChunk, LoadedWorld, Manifest } from './types';
import { bakeBoat } from '../game/progression/boatpaint';

/** Player boat tiers in protos.glb (BOAT_T0 = Little Troller, BOAT_T1 = the Packer, ...). */
const BOAT_RE = /^BOAT_T\d+$/;
const BOAT_NAMES = ['BOAT_T0', 'BOAT_T1'];

const BASE = import.meta.env.BASE_URL;
const WORLD = `${BASE}world/`;

let gltfLoader: GLTFLoader | null = null;
function loader() {
  if (!gltfLoader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${BASE}draco/`);
    gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(draco);
  }
  return gltfLoader;
}

/** Returns the READY marker's content (used as a version/cache-buster), or null if no export yet. */
export async function checkReady(): Promise<string | null> {
  try {
    const r = await fetch(`${WORLD}READY?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    const txt = await r.text();
    // Vite's SPA fallback serves index.html for missing files; reject that.
    if (ct.includes('text/html') || txt.trimStart().startsWith('<')) return null;
    return txt.trim() || r.headers.get('last-modified') || 'ready';
  } catch {
    return null;
  }
}

async function getJSON<T>(path: string, v: string): Promise<T> {
  const r = await fetch(`${WORLD}${path}?v=${encodeURIComponent(v)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

function loadGLB(path: string, v: string) {
  return loader().loadAsync(`${WORLD}${path}?v=${encodeURIComponent(v)}`);
}

/** Bake every mesh under `node` into one geometry in node-local space (position + color only). */
function bakeNode(node: THREE.Object3D): THREE.BufferGeometry | null {
  node.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const geoms: THREE.BufferGeometry[] = [];
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
    if (!g.getAttribute('color')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.6), 3));
    }
    // normalise colour attribute to float vec3 so merges always work
    const c = g.getAttribute('color');
    if (c.itemSize !== 3 || !(c.array instanceof Float32Array)) {
      const out = new Float32Array(c.count * 3);
      for (let i = 0; i < c.count; i++) { out[i * 3] = c.getX(i); out[i * 3 + 1] = c.getY(i); out[i * 3 + 2] = c.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(out, 3));
    }
    geoms.push(g);
  });
  if (!geoms.length) return null;
  const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
  if (!merged) return geoms[0];
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export type Progress = (msg: string, frac: number) => void;

export async function loadExportWorld(version: string, progress: Progress): Promise<LoadedWorld> {
  progress('Unrolling the chart…', 0);
  const [manifest, gameplayRaw] = await Promise.all([
    getJSON<Manifest>('manifest.json', version),
    getJSON<Gameplay>('gameplay.json', version),
  ]);
  const gameplay: Gameplay = {
    ...gameplayRaw,
    interacts: gameplayRaw.interacts ?? [],
    hotspots: gameplayRaw.hotspots ?? [],
    time_of_day: gameplayRaw.time_of_day && Object.keys(gameplayRaw.time_of_day).length ? gameplayRaw.time_of_day : DEFAULT_TOD,
  };
  let instances: Instances = { protos: {} };
  try { instances = await getJSON<Instances>('instances.json', version); } catch (e) { console.warn('[world] no instances.json', e); }

  const total = manifest.chunks.length + manifest.backdrops.length + (manifest.clouds ? 1 : 0) + (manifest.protos ? 1 : 0) + (manifest.dynamic ? 1 : 0);
  let done = 0;
  const tick = (what: string) => progress(what, ++done / Math.max(1, total));

  const chunks: LoadedChunk[] = [];
  const backdrops: THREE.Object3D[] = [];
  const clouds: THREE.Object3D[] = [];
  const dynamic: THREE.Object3D[] = [];

  // Load chunks with limited concurrency (phones choke on dozens of parallel Draco decodes).
  const queue = [...manifest.chunks];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const c = queue.shift()!;
      try {
        const gltf = await loadGLB(c.file, version);
        applyWorldMaterial(gltf.scene, 'chunk');
        const b = c.bounds;
        const bounds = b && b.length === 6
          ? new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]))
          : new THREE.Box3().setFromObject(gltf.scene);
        chunks.push({ object: gltf.scene, bounds, center: bounds.getCenter(new THREE.Vector3()) });
      } catch (e) { console.warn('[world] chunk failed', c.file, e); }
      tick('Charting the islands…');
    }
  });
  await Promise.all(workers);

  for (const f of manifest.backdrops) {
    try {
      const g = await loadGLB(f, version);
      applyWorldMaterial(g.scene, 'backdrop');
      backdrops.push(g.scene);
    } catch (e) { console.warn('[world] backdrop failed', f, e); }
    tick('Raising the mountains…');
  }
  if (manifest.clouds) {
    try {
      const g = await loadGLB(manifest.clouds, version);
      applyWorldMaterial(g.scene, 'clouds');
      clouds.push(g.scene);
    } catch (e) { console.warn('[world] clouds failed', e); }
    tick('Gathering clouds…');
  }
  if (manifest.dynamic) {
    try {
      const g = await loadGLB(manifest.dynamic, version);
      applyWorldMaterial(g.scene, 'dynamic');
      // top-level nodes animate individually in game/floaters.ts (unwrap a single root wrapper)
      let nodes = g.scene.children;
      if (nodes.length === 1 && !(nodes[0] as THREE.Mesh).isMesh && !nodes[0].userData.anim && nodes[0].children.length > 1) nodes = nodes[0].children;
      dynamic.push(...nodes);
    } catch (e) { console.warn('[world] dynamic failed', e); }
    tick('Setting the buoys…');
  }

  const protos = new Map<string, THREE.BufferGeometry>();
  let boat: THREE.Object3D | null = null;
  const boats: Record<string, THREE.Object3D> = {};
  if (manifest.protos) {
    try {
      const g = await loadGLB(manifest.protos, version);
      // A proto is a top-level node (or a mesh) whose name matches an instances key / BOAT_T0.
      const wanted = new Set([...Object.keys(instances.protos), ...BOAT_NAMES]);
      const seen = new Set<string>();
      g.scene.traverse((o) => {
        if (seen.has(o.name) || !wanted.has(o.name)) return;
        seen.add(o.name);
        if (BOAT_RE.test(o.name)) { const b = bakeBoat(o); if (b) boats[o.name] = b; return; }
        const geom = bakeNode(o);
        if (!geom) return;
        if (o.name === 'BOAT_T0') {
          const mesh = new THREE.Mesh(geom);
          mesh.name = 'BOAT_T0';
          mesh.userData.bow_axis = o.userData?.bow_axis ?? '+X';
          applyWorldMaterial(mesh);
          boat = mesh;
        } else protos.set(o.name, geom);
      });
      // Fallback: mesh names may carry a suffix (e.g. PT_fir_a.001 / glTF mesh names).
      for (const key of wanted) {
        if (seen.has(key)) continue;
        const o = g.scene.getObjectByName(key) ?? g.scene.children.find((c) => c.name.startsWith(key));
        if (!o) continue;
        if (BOAT_RE.test(key)) { const b = bakeBoat(o); if (b) { b.name = key; boats[key] = b; } continue; }
        const geom = bakeNode(o);
        if (!geom) continue;
        if (key === 'BOAT_T0') { const m = new THREE.Mesh(geom); m.name = 'BOAT_T0'; m.userData.bow_axis = o.userData?.bow_axis ?? '+X'; applyWorldMaterial(m); boat = m; } else protos.set(key, geom);
      }
      const missing = [...wanted].filter((k) => !BOAT_RE.test(k) && !protos.has(k));
      boat = boats.BOAT_T0 ?? null;
      if (missing.length) console.warn('[world] protos missing from protos.glb:', missing);
    } catch (e) { console.warn('[world] protos failed', e); }
    tick('Growing the forests…');
  }

  return { source: 'export', chunks, backdrops, clouds, dynamic, protos, instances, boat, boats, gameplay };
}
