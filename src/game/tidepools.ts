import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShoreField } from '../render/shorefield';
import type { FootWorld } from './onfoot/footworld';
import type { Gameplay, LoadedChunk } from '../world/types';
import { WATER } from './tide';
import { worldMat, register } from '../render/materials';
import { chunkTideMat } from '../render/tidebands';
import * as art from '../render/tidepoolart';
import SITES from './tidepool_sites.json';

/**
 * Tide pools (docs/tide_study.md). Each site is a little stepped rock bench built out from a real
 * shoreline: flat terraces stepping down into the sea, each terrace holding one still pool ringed by
 * rocks. The benches sit below the high-water line, so the opaque sea hides them until the tide falls
 * past each terrace; the lowest pools only show on the big spring lows.
 *
 * Zones follow the real shore: high pools (just below high water) keep hermit and shore crabs and a
 * sculpin; mid pools ochre stars and green anemones; low pools urchins, giant green anemones and,
 * rarely, a sunflower star.
 *
 * Sites are baked once from the world (scripts/tidepool_bake.mjs → tidepool_sites.json): shoreline
 * points with walkable beach behind them and open water in front, away from docks and channels.
 */

export type CritterId = 'hermit' | 'shore_crab' | 'sculpin' | 'ochre_star' | 'anemone' | 'urchin' | 'sunflower';
export interface Critter { id: CritterId; name: string; zone: string; note: string }
export const CRITTERS: Critter[] = [
  { id: 'hermit', name: 'Hairy hermit crab', zone: 'high and middle pools', note: 'Lives in a borrowed snail shell and moves house when it outgrows it. Very sensible.' },
  { id: 'shore_crab', name: 'Purple shore crab', zone: 'high pools', note: 'Scuttles sideways under the nearest rock the moment your shadow falls on the pool.' },
  { id: 'sculpin', name: 'Tidepool sculpin', zone: 'high and middle pools', note: 'Sits so still on the gravel you only see it when it darts. Finds its way home to the same pool.' },
  { id: 'ochre_star', name: 'Ochre sea star', zone: 'middle and low pools', note: 'Purple or orange, the same star. Pries mussels open with nothing but patience.' },
  { id: 'anemone', name: 'Giant green anemone', zone: 'middle and low pools', note: 'Green from the tiny plants living inside it. Folds up tight when the water leaves.' },
  { id: 'urchin', name: 'Purple sea urchin', zone: 'low pools', note: 'A pincushion that grazes kelp. Where the stars are few, the urchins march.' },
  { id: 'sunflower', name: 'Sunflower star', zone: 'only the lowest pools, on the biggest tides', note: 'Twenty arms and faster than you would think. Rare now. Gran would have wanted to know.' },
];
export const critterById = (id: string) => CRITTERS.find((c) => c.id === id);

/** A baked site: shoreline point, outward (seaward) direction, beach height behind it, surface class. */
export interface Site { x: number; z: number; a: number; gy: number; s: string }
interface Pool { id: string; x: number; z: number; h: number; r: number; zone: 'high' | 'mid' | 'low'; critters: CritterId[]; orange: boolean }
interface Mover { kind: 'hermit' | 'shore_crab' | 'sculpin'; pool: Pool; x: number; z: number; yaw: number; tx: number; tz: number; wait: number; speed: number }
interface Shelf { site: Site; group: THREE.Group; pools: Pool[]; walk: LoadedChunk; movers: Mover[]; near: boolean }

const POOL_HEIGHTS = [-0.15, -0.55, -0.95, -1.32];
const STEP = 0.38; // m between terraces: under the walker's 0.45 m step-up
const SHOW = 170; // m: shelves further than this from the camera are hidden
const ANIM = 45; // m: critters move within this

const rnd = (seed: number) => { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

/** Pool water: still, a little clearer and greener than the sea (colours ride in the vertex colours: `register` owns .color for the time-of-day tint). */
const waterMat = register(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
const rimMat = register(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false }));

export class TidePools {
  group = new THREE.Group();
  shelves: Shelf[] = [];
  private movers: Record<'hermit' | 'shore_crab' | 'sculpin', THREE.InstancedMesh>;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s1 = new THREE.Vector3(1, 1, 1);
  private t = 0;
  stale = false;

  constructor(gp: Gameplay, worldTag: string, sites: Site[] = (SITES as { sites: Site[] }).sites) {
    this.group.name = 'tidepools';
    this.stale = (SITES as { world?: string }).world !== worldTag;
    void gp;
    const mk = (g: THREE.BufferGeometry, n: number) => { const m = new THREE.InstancedMesh(g, worldMat, n); m.count = 0; m.frustumCulled = false; this.group.add(m); return m; };
    this.movers = { hermit: mk(art.hermitCrab(), 64), shore_crab: mk(art.shoreCrab(), 32), sculpin: mk(art.sculpin(), 32) };
    sites.forEach((s, i) => this.shelves.push(this.buildShelf(s, i)));
    for (const r of (SITES as { reefs?: Reef[] }).reefs ?? []) this.reefs.push(buildReef(r));
    for (const r of this.reefs) this.group.add(r.object);
  }
  /** Low-tide reef rocks (the Teeth): only bared by the falling tide; they join the shore field and tide grid. */
  reefs: LoadedChunk[] = [];

  /** Pseudo-chunks (the terraces only) for the shore field, the tide grid and on-foot walking. */
  get walkChunks(): LoadedChunk[] { return this.shelves.map((s) => s.walk); }
  /** Everything that should shape the waterline (terraces + reef rocks). */
  get fieldChunks(): LoadedChunk[] { return [...this.walkChunks, ...this.reefs]; }
  /** Round blockers so you walk round a pool, not through it. */
  get circles() { return this.shelves.flatMap((s) => s.pools.map((p) => ({ x: p.x, z: p.z, r: p.r * 0.8 }))); }
  get pools() { return this.shelves.flatMap((s) => s.pools); }

  private buildShelf(site: Site, idx: number): Shelf {
    const R = rnd(site.x * 31 + site.z * 17 + 7);
    const dx = Math.sin(site.a), dz = Math.cos(site.a); // seaward
    const px = dz, pz = -dx; // along the shore
    const rock: THREE.BufferGeometry[] = [], stat: THREE.BufferGeometry[] = [], water: THREE.BufferGeometry[] = [], rims: THREE.BufferGeometry[] = [];
    const walkGeo: THREE.BufferGeometry[] = [];
    const pools: Pool[] = [];
    // terrace heights: steps down from the beach until we reach the pool levels
    const hs: { h: number; pool: boolean }[] = [];
    let h = Math.min(site.gy - 0.3, 0.5);
    while (h > POOL_HEIGHTS[0] + 0.02 && hs.length < 3) { hs.push({ h, pool: false }); h -= STEP; }
    const nPools = 2 + (R() < 0.6 ? 1 : 0) + (R() < 0.3 ? 1 : 0);
    for (let k = 0; k < nPools; k++) hs.push({ h: POOL_HEIGHTS[k] + (R() - 0.5) * 0.06, pool: true });
    let along = -0.6; // start just inside the shoreline so the top step tucks under the beach
    let side = (R() - 0.5) * 1.2;
    hs.forEach((t, k) => {
      const depth = t.pool ? 2.7 + R() * 0.6 : 1.6;
      const width = t.pool ? 3.4 + R() * 1.0 : 3.0 + R() * 0.8;
      along += depth * (k === 0 ? 0.45 : 0.62);
      side += (R() - 0.5) * 1.3;
      const cx = site.x + dx * along + px * side, cz = site.z + dz * along + pz * side;
      const slab = terrace(cx, cz, t.h, width, depth, site.a, R);
      rock.push(slab); walkGeo.push(slab);
      if (!t.pool) return;
      const zone: Pool['zone'] = t.h > -0.35 ? 'high' : t.h > -0.8 ? 'mid' : 'low';
      const pr = 0.75 + R() * 0.3;
      const pxp = cx + dx * 0.15, pzp = cz + dz * 0.15;
      const pool: Pool = { id: `${idx}_${pools.length}`, x: pxp, z: pzp, h: t.h, r: pr, zone, critters: [], orange: R() < 0.45 };
      // rim rocks (+ barnacles / mussels), floor, still water, a pale meniscus line
      const nr = 10 + Math.floor(R() * 4);
      for (let i = 0; i < nr; i++) {
        const a = (i / nr) * Math.PI * 2 + R() * 0.3, rr = pr + 0.08;
        const s = 0.16 + R() * 0.12;
        rock.push(art.rimRock(idx * 100 + i, s).translate(pxp + Math.cos(a) * rr, t.h + s * 0.18, pzp + Math.sin(a) * rr));
        if (R() < 0.3) stat.push(art.mussels(i + idx).translate(pxp + Math.cos(a) * (rr + 0.1), t.h + 0.04, pzp + Math.sin(a) * (rr + 0.1)));
      }
      stat.push(art.paint(new THREE.CircleGeometry(pr + 0.04, 10).rotateX(-Math.PI / 2).translate(pxp, t.h + 0.008, pzp), art.CRITTER_COL.floor, 0.18, idx));
      water.push(art.paint(new THREE.CircleGeometry(pr + 0.04, 12).rotateX(-Math.PI / 2).translate(pxp, t.h + 0.075, pzp), 0x3d6a66));
      rims.push(art.paint(new THREE.RingGeometry(pr - 0.02, pr + 0.04, 14).rotateX(-Math.PI / 2).translate(pxp, t.h + 0.077, pzp), 0xd9e6e0));
      // loose boulders on the bench, mostly toward the sea edge
      for (let i = 0; i < 3; i++) {
        // off to the sides of the pool (never seaward, where the next pool sits)
        const a = site.a + (R() < 0.5 ? -1 : 1) * (Math.PI / 2 + (R() - 0.5) * 0.7), d = pr + 0.6 + R() * 0.7, s = 0.22 + R() * 0.22;
        rock.push(art.rimRock(idx * 100 + 50 + i + k * 7, s).translate(pxp + Math.sin(a) * d, t.h + s * 0.15, pzp + Math.cos(a) * d));
      }
      // inhabitants by zone
      const put = (g: THREE.BufferGeometry, rad: number, y = 0.012) => {
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * (pr - rad - 0.05);
        stat.push(g.rotateY(R() * Math.PI * 2).translate(pxp + Math.cos(a) * d, t.h + y, pzp + Math.sin(a) * d));
      };
      const C = pool.critters;
      if (R() < 0.8) put(art.seaLettuce(R() * 10), 0.1);
      if (zone === 'high') {
        C.push('hermit', 'shore_crab'); if (R() < 0.6) C.push('sculpin');
      } else if (zone === 'mid') {
        C.push('ochre_star', 'anemone'); if (R() < 0.6) C.push('hermit'); if (R() < 0.4) C.push('sculpin');
        put(art.seaStar(pool.orange, 0.13 + R() * 0.04), 0.18);
        if (R() < 0.5) put(art.seaStar(!pool.orange, 0.12), 0.16);
        put(art.anemone(0.09 + R() * 0.03), 0.12);
        if (R() < 0.6) put(art.anemone(0.08), 0.1);
      } else {
        C.push('urchin', 'anemone', 'ochre_star');
        const sun = (Math.abs(Math.sin(idx * 91.7 + pools.length * 13.1)) * 1000) % 1 < 0.35;
        if (sun) { C.push('sunflower'); put(art.sunflowerStar(0.26), 0.3); }
        for (let i = 0; i < 3; i++) put(art.urchin(0.05 + R() * 0.02), 0.08);
        put(art.anemone(0.13), 0.15);
        put(art.seaStar(true, 0.14), 0.17);
      }
      pools.push(pool);
    });
    const group = new THREE.Group();
    group.name = `tidepool_shelf_${idx}`;
    const rockMesh = new THREE.Mesh(mergeGeometries(rock, false)!, chunkTideMat);
    const statMesh = new THREE.Mesh(mergeGeometries(stat, false)!, worldMat);
    const waterMesh = new THREE.Mesh(mergeGeometries(water, false)!, waterMat);
    const rimMesh = new THREE.Mesh(mergeGeometries(rims, false)!, rimMat);
    waterMesh.renderOrder = 2; rimMesh.renderOrder = 3;
    group.add(rockMesh, statMesh, waterMesh, rimMesh);
    for (const m of group.children) { m.matrixAutoUpdate = false; m.updateMatrix(); }
    this.group.add(group);
    // the terraces alone, for collision / the shore field (rim rocks and water are decoration)
    const walkObj = new THREE.Mesh(mergeGeometries(walkGeo, false)!, chunkTideMat);
    walkObj.name = `tidepool_walk_${idx}`;
    walkObj.updateMatrixWorld(true);
    walkObj.geometry.computeBoundingBox();
    const bounds = walkObj.geometry.boundingBox!.clone();
    const walk: LoadedChunk = { object: walkObj, bounds, center: bounds.getCenter(new THREE.Vector3()) };
    // movers: hermit crabs, shore crabs and sculpins wander their own pool
    const movers: Mover[] = [];
    for (const p of pools) for (const c of p.critters) {
      if (c !== 'hermit' && c !== 'shore_crab' && c !== 'sculpin') continue;
      const n = c === 'hermit' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, d = R() * p.r * 0.5;
        movers.push({ kind: c, pool: p, x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, yaw: R() * 6.28, tx: p.x, tz: p.z, wait: R() * 3, speed: c === 'sculpin' ? 0.9 : c === 'shore_crab' ? 0.25 : 0.06 });
      }
    }
    return { site, group, pools, walk, movers, near: true };
  }

  /** Is this pool out of the water now? */
  static exposed(p: { h: number }, level = WATER.y) { return level < p.h - 0.03; }

  update(dt: number, cam: THREE.Vector3, reduceMotion = false) {
    this.t += dt;
    const counts = { hermit: 0, shore_crab: 0, sculpin: 0 };
    for (const sh of this.shelves) {
      const d = Math.hypot(sh.site.x - cam.x, sh.site.z - cam.z);
      // hidden when far, or when even the top terrace is under water (nothing to see)
      const topH = Math.max(...sh.pools.map((p) => p.h)) + 0.45;
      sh.group.visible = d < SHOW && WATER.y < topH + 0.5;
      sh.near = d < ANIM;
      if (!sh.group.visible || d > SHOW * 0.6) continue;
      for (const m of sh.movers) {
        const p = m.pool;
        if (!TidePools.exposed(p)) continue;
        if (sh.near && !reduceMotion) this.move(m, dt);
        const mesh = this.movers[m.kind];
        const i = counts[m.kind]++;
        if (i >= mesh.instanceMatrix.count) continue;
        this.e.set(0, m.yaw, 0);
        this.q.setFromEuler(this.e);
        this.m4.compose(this.v.set(m.x, p.h + (m.kind === 'sculpin' ? 0.02 : 0.012), m.z), this.q, this.s1);
        mesh.setMatrixAt(i, this.m4);
      }
    }
    for (const k of ['hermit', 'shore_crab', 'sculpin'] as const) {
      const mesh = this.movers[k];
      mesh.count = Math.min(counts[k], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private move(m: Mover, dt: number) {
    if (m.wait > 0) { m.wait -= dt; return; }
    const dx = m.tx - m.x, dz = m.tz - m.z, d = Math.hypot(dx, dz);
    if (d < 0.02) {
      // pick a new spot inside the pool; sculpins dart then sit a long while, crabs potter
      const p = m.pool, a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * p.r * 0.7;
      m.tx = p.x + Math.cos(a) * r; m.tz = p.z + Math.sin(a) * r;
      m.wait = m.kind === 'sculpin' ? 2 + Math.random() * 6 : 0.5 + Math.random() * 2.5;
      return;
    }
    const step = Math.min(d, m.speed * dt);
    const want = Math.atan2(dx, dz);
    // crabs walk sideways; everything turns a little as it goes
    const face = m.kind === 'shore_crab' ? want + Math.PI / 2 : want;
    m.yaw += Math.atan2(Math.sin(face - m.yaw), Math.cos(face - m.yaw)) * Math.min(1, dt * 6);
    m.x += (dx / d) * step; m.z += (dz / d) * step;
  }

  /** The pool the player can look into from (x, y, z): out of the water, within reach, on (or by) its terrace. */
  nearest(x: number, y: number, z: number, reach = 1.9) {
    let best: Pool | null = null, bd = Infinity;
    for (const sh of this.shelves) {
      if (Math.abs(sh.site.x - x) > 25 || Math.abs(sh.site.z - z) > 25) continue;
      for (const p of sh.pools) {
        const d = Math.hypot(p.x - x, p.z - z) - p.r;
        if (d < reach && d < bd && Math.abs(y - p.h) < 0.9 && TidePools.exposed(p)) { bd = d; best = p; }
      }
    }
    return best;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose(); });
    for (const s of this.shelves) (s.walk.object as THREE.Mesh).geometry.dispose();
  }
}

/** A reef line: rocks along x0,z0 → x1,z1, jittered `spread` m either side, tops between −0.2 and −1.2 m. */
interface Reef { name: string; x0: number; z0: number; x1: number; z1: number; n: number; spread: number }
function buildReef(r: Reef): LoadedChunk {
  const R = rnd(r.x0 * 7 + r.z0 * 13 + r.n);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < r.n; i++) {
    const t = (i + 0.5 + (R() - 0.5) * 0.6) / r.n;
    const side = (i % 2 ? 1 : -1) * (0.45 + R() * 0.55) * r.spread;
    const x = r.x0 + (r.x1 - r.x0) * t, z = r.z0 + (r.z1 - r.z0) * t + side;
    const top = -0.2 - R() * 1.0, s = 1.4 + R() * 1.1;
    const g = art.rimRock(500 + i, s);
    g.scale(1, 1.8, 1); // jagged and tall-ish, mostly hidden below
    g.computeBoundingBox();
    parts.push(g.translate(x, top - g.boundingBox!.max.y, z));
  }
  const m = new THREE.Mesh(mergeGeometries(parts, false)!, chunkTideMat);
  m.name = `tidepool_reef_${r.name}`;
  m.matrixAutoUpdate = false;
  m.updateMatrixWorld(true);
  m.geometry.computeBoundingBox();
  const bounds = m.geometry.boundingBox!.clone();
  return { object: m, bounds, center: bounds.getCenter(new THREE.Vector3()) };
}

/** One terrace: a faceted flat-topped slab (centre slightly dished) with steep tapered sides. a = seaward bearing. */
function terrace(cx: number, cz: number, h: number, width: number, depth: number, a: number, R: () => number) {
  const N = 11;
  const dx = Math.sin(a), dz = Math.cos(a), px = dz, pz = -dx;
  const top: THREE.Vector3[] = [], bot: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const k = 0.72 + R() * 0.5;
    const u = Math.cos(t) * width / 2 * k, w = Math.sin(t) * depth / 2 * k;
    const x = cx + px * u + dx * w, z = cz + pz * u + dz * w;
    top.push(new THREE.Vector3(x, h + (R() - 0.5) * 0.05, z));
    bot.push(new THREE.Vector3(cx + (x - cx) * 1.7, h - 1.9, cz + (z - cz) * 1.7));
  }
  const c = new THREE.Vector3(cx, h - 0.03, cz);
  const pos: number[] = [];
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    tri(c, top[j], top[i]);
    tri(top[i], top[j], bot[j]); tri(top[i], bot[j], bot[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return art.paint(g, art.CRITTER_COL.rock, 0.14, Math.floor(cx * 13 + cz));
}

// ---------------------------------------------------------------- bake (debug / scripts/tidepool_bake.mjs)
/**
 * Find good tide-pool sites from the loaded world: shoreline points (from the shore field at high
 * water) with walkable beach just inland, open water in front, away from docks, moorings, channel
 * buoys and fishing spots. Greedy by a rockiness score with a minimum spacing.
 */
export function bakeSites(f: ShoreField, fw: FootWorld, gp: Gameplay, opts: { spacing?: number; max?: number } = {}) {
  const spacing = opts.spacing ?? 70, max = opts.max ?? 18;
  const [W, H] = f.res;
  const data = (f.texture.image as { data: Uint16Array }).data;
  const fh = THREE.DataUtils.fromHalfFloat;
  const at = (x: number, z: number, ch: number) => {
    const u = (x - f.min.x) / f.size.x, v = (z - f.min.y) / f.size.y;
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) return ch === 1 ? 30 : 99;
    return fh(data[(Math.floor(v * H) * W + Math.floor(u * W)) * 4 + ch]);
  };
  const avoid: { x: number; z: number; r: number }[] = [];
  for (const it of gp.interacts) {
    if (/moor|sell|buy|upgrade|bell|dive|boat|sunstone|land_here/.test(it.kind)) avoid.push({ x: it.pos[0], z: it.pos[2], r: 40 });
  }
  avoid.push({ x: gp.spawn.pos[0], z: gp.spawn.pos[2], r: 50 });
  for (const b of gp.buoys ?? []) { const p = (b as { pos?: number[] }).pos; if (p) avoid.push({ x: p[0], z: p[2], r: 30 }); }
  for (const hs of gp.hotspots) avoid.push({ x: hs.pos[0], z: hs.pos[2], r: 14 });
  const cands: (Site & { score: number })[] = [];
  const classify = (c: [number, number, number]) => {
    const [r, g, b] = c.map((v) => Math.pow(v / 255, 1 / 2.2));
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    if (g >= r && g > b && sat > 0.1) return 'grass';
    if (r > g && g > b && r - b > 0.12 && mx > 0.5) return 'sand';
    if (sat < 0.16) return 'rock';
    return 'other';
  };
  for (let z = f.min.y + 4; z < f.min.y + f.size.y - 4; z += 5) {
    for (let x = f.min.x + 4; x < f.min.x + f.size.x - 4; x += 5) {
      const sd = at(x, z, 0);
      if (sd < 0.4 || sd > 2.6) continue;
      if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r)) continue;
      const gx = at(x + 1, z, 0) - at(x - 1, z, 0), gz = at(x, z + 1, 0) - at(x, z - 1, 0);
      const gl = Math.hypot(gx, gz);
      if (gl < 0.8) continue; // a clean edge, not a corner / thin spit
      const dx = gx / gl, dz = gz / gl;
      const sx = x - dx * sd, sz = z - dz * sd; // the shoreline
      const ix = sx - dx * 1.3, iz = sz - dz * 1.3;
      const g = fw.groundAt(ix, iz, 3, 1, 6);
      if (!g || g.y < -0.05 || g.y > 1.1 || g.ny < 0.85) continue;
      const g2 = fw.groundAt(sx - dx * 4, sz - dz * 4, g.y, 0.8, 0.8);
      if (!g2) continue;
      const surf = fw.surfaceColor(ix, iz, g.y);
      if (!surf || surf.hollow) continue;
      const s = classify(surf.c);
      if (s === 'other') continue;
      // open water ahead (no channel to block), deep enough that the bench is a reef, not a beach
      if (at(sx + dx * 6, sz + dz * 6, 1) < 0.9) continue;
      if (at(sx + dx * 16, sz + dz * 16, 0) < 9) continue;
      if (at(sx + px(dz) * 4 + dx * 6, sz + pz(dx) * 4 + dz * 6, 0) < 2 || at(sx - px(dz) * 4 + dx * 6, sz - pz(dx) * 4 + dz * 6, 0) < 2) continue;
      const score = (s === 'rock' ? 3 : s === 'sand' ? 1.5 : 0.5) - g.y * 0.6 + Math.min(1, (at(sx + dx * 16, sz + dz * 16, 0) - 9) / 10);
      cands.push({ x: +sx.toFixed(2), z: +sz.toFixed(2), a: +Math.atan2(dx, dz).toFixed(3), gy: +g.y.toFixed(2), s, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const out: Site[] = [];
  for (const c of cands) {
    if (out.length >= max) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < spacing)) continue;
    out.push({ x: c.x, z: c.z, a: c.a, gy: c.gy, s: c.s });
  }
  return { sites: out, candidates: cands.length };
}
const px = (dz: number) => dz;
const pz = (dx: number) => -dx;
