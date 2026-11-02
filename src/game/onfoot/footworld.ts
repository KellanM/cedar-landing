import * as THREE from 'three';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';
import type { LoadedChunk } from '../../world/types';

/** Walkable surface: normal.y above this. */
export const WALKABLE_NY = 0.7;
/** Max step-up onto a higher surface (m). */
export const STEP_UP = 0.45;
/** Max drop we allow walking off (m). Anything deeper is a ledge you can't walk off. */
export const MAX_DROP = 1.1;
/** Ground below this is water / wet shoreline: not walkable. */
export const WATER_Y = 0.3;

interface Entry { chunk: LoadedChunk; bvh: MeshBVH | null; box: THREE.Box3 }

export interface GroundHit { y: number; ny: number }

const _ray = new THREE.Ray();
const _down = new THREE.Vector3(0, -1, 0);
const _seg = new THREE.Line3();
const _box = new THREE.Box3();
const _tp = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Bake every mesh in a chunk into one world-space, position-only geometry (for the BVH). */
function bakeChunk(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateWorldMatrix(true, true);
  const parts: { pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; idx: THREE.BufferAttribute | null; m: THREE.Matrix4 }[] = [];
  let nv = 0, ni = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const idx = mesh.geometry.index;
    parts.push({ pos, idx, m: mesh.matrixWorld });
    nv += pos.count;
    ni += idx ? idx.count : pos.count;
  });
  if (!nv) return null;
  const P = new Float32Array(nv * 3);
  const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3();
  let vo = 0, io = 0;
  for (const p of parts) {
    for (let i = 0; i < p.pos.count; i++) {
      v.fromBufferAttribute(p.pos, i).applyMatrix4(p.m);
      P[(vo + i) * 3] = v.x; P[(vo + i) * 3 + 1] = v.y; P[(vo + i) * 3 + 2] = v.z;
    }
    if (p.idx) for (let i = 0; i < p.idx.count; i++) I[io++] = vo + p.idx.getX(i);
    else for (let i = 0; i < p.pos.count; i++) I[io++] = vo + i;
    vo += p.pos.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  return g;
}

/**
 * Collision for walking, built from the already-loaded chunk meshes. One BVH per chunk,
 * built lazily the first time the player (or a step-ashore probe) needs that chunk.
 */
export class FootWorld {
  private entries: Entry[] = [];
  /** Extra round blockers (NPCs): x, z, radius. */
  circles: { x: number; z: number; r: number }[] = [];
  buildMs = 0;
  built = 0;

  setChunks(chunks: LoadedChunk[]) {
    for (const e of this.entries) e.bvh?.geometry.dispose();
    this.entries = chunks.map((c) => ({ chunk: c, bvh: null, box: c.bounds.clone() }));
    this.built = 0;
  }

  private build(e: Entry) {
    const t0 = performance.now();
    const g = bakeChunk(e.chunk.object);
    e.bvh = g ? new MeshBVH(g, { targetLeafSize: 12 }) : new MeshBVH(new THREE.BoxGeometry(0, 0, 0));
    this.buildMs += performance.now() - t0;
    this.built++;
  }

  private near(x: number, z: number, pad: number, out: MeshBVH[]) {
    out.length = 0;
    for (const e of this.entries) {
      const b = e.box;
      if (x < b.min.x - pad || x > b.max.x + pad || z < b.min.z - pad || z > b.max.z + pad) continue;
      if (!e.bvh) this.build(e);
      out.push(e.bvh!);
    }
    return out;
  }
  private tmpList: MeshBVH[] = [];

  /** Build at most one missing BVH near (x,z). Returns true if it did work. */
  prefetch(x: number, z: number, pad = 30) {
    for (const e of this.entries) {
      const b = e.box;
      if (e.bvh || x < b.min.x - pad || x > b.max.x + pad || z < b.min.z - pad || z > b.max.z + pad) continue;
      this.build(e);
      return true;
    }
    return false;
  }

  /**
   * Highest walkable surface at (x,z) within [feetY - down, feetY + up]. Picks the highest valid
   * hit, so stilt decks are walked on top, never underneath.
   */
  groundAt(x: number, z: number, feetY: number, up = STEP_UP, down = MAX_DROP): GroundHit | null {
    const list = this.near(x, z, 1, this.tmpList);
    _ray.origin.set(x, feetY + up + 0.02, z);
    _ray.direction.copy(_down);
    const far = up + down + 0.02;
    let best: GroundHit | null = null;
    for (const bvh of list) {
      const hits = bvh.raycast(_ray, THREE.DoubleSide, 0, far);
      for (const h of hits) {
        if (!h.face) continue;
        const ny = Math.abs(h.face.normal.y);
        if (ny < WALKABLE_NY) continue;
        if (!best || h.point.y > best.y) best = { y: h.point.y, ny };
      }
    }
    return best;
  }

  /** Is there a solid (any-angle) surface at (x,z) within the column? Used for "blocked edge" checks. */
  walkable(x: number, z: number, feetY: number): GroundHit | null {
    const g = this.groundAt(x, z, feetY);
    if (!g || g.y < WATER_Y) return null;
    return g;
  }

  /**
   * Push a vertical capsule out of walls (non-walkable triangles only), horizontally.
   * The capsule starts above STEP_UP so kerbs and steps never block. Returns the push length.
   */
  pushOut(feet: THREE.Vector3, radius: number, height: number): number {
    const list = this.near(feet.x, feet.z, radius + 1, this.tmpList);
    _seg.start.set(feet.x, feet.y + STEP_UP + radius, feet.z);
    _seg.end.set(feet.x, feet.y + Math.max(height - radius, STEP_UP + radius + 0.01), feet.z);
    const sx = _seg.start.x, sz = _seg.start.z;
    for (let iter = 0; iter < 2; iter++) {
      for (const bvh of list) {
        _box.makeEmpty();
        _box.expandByPoint(_seg.start).expandByPoint(_seg.end);
        _box.min.addScalar(-radius); _box.max.addScalar(radius);
        bvh.shapecast({
          intersectsBounds: (box) => box.intersectsBox(_box),
          intersectsTriangle: (tri: ExtendedTriangle) => {
            tri.getNormal(_n);
            if (Math.abs(_n.y) >= WALKABLE_NY) return false;
            const dist = tri.closestPointToSegment(_seg, _tp, _cp);
            if (dist >= radius) return false;
            _d.subVectors(_cp, _tp).setY(0);
            let L = _d.length();
            if (L < 1e-5) { _d.set(_n.x, 0, _n.z); L = _d.length(); if (L < 1e-5) return false; }
            _d.multiplyScalar(1 / L);
            const depth = radius - dist;
            _seg.start.addScaledVector(_d, depth);
            _seg.end.addScaledVector(_d, depth);
            return false;
          },
        });
      }
    }
    for (const c of this.circles) {
      const dx = _seg.start.x - c.x, dz = _seg.start.z - c.z;
      const L = Math.hypot(dx, dz), min = c.r + radius;
      if (L < min && L > 1e-4) {
        _seg.start.x = c.x + (dx / L) * min; _seg.start.z = c.z + (dz / L) * min;
      }
    }
    const px = _seg.start.x - sx, pz = _seg.start.z - sz;
    feet.x += px; feet.z += pz;
    return Math.hypot(px, pz);
  }

  /** Distance along a ray to the first hit (any side), or `far` if clear. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): number {
    const list = this.near(origin.x, origin.z, far + 2, this.tmpList);
    _ray.origin.copy(origin);
    _ray.direction.copy(dir);
    let best = far;
    for (const bvh of list) {
      const h = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, best);
      if (h && h.distance < best) best = h.distance;
    }
    return best;
  }
}
