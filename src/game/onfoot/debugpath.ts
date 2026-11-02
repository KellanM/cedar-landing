import * as THREE from 'three';
import type { FootWorld } from './footworld';
import { STEP_UP, WATER_Y } from './footworld';

/**
 * Debug/test helper: grid A* over walkable cells (same ground + wall tests as the controller),
 * so automated tests can walk real routes through the village instead of teleporting.
 */
export function findPath(world: FootWorld, from: { x: number; y: number; z: number }, to: { x: number; z: number }, cell = 0.25, margin = 8) {
  // Grid anchored to world coordinates, so results don't depend on exactly where you start.
  const x0 = Math.floor((Math.min(from.x, to.x) - margin) / cell) * cell;
  const z0 = Math.floor((Math.min(from.z, to.z) - margin) / cell) * cell;
  const W = Math.ceil((Math.max(from.x, to.x) + margin - x0) / cell) + 1;
  const H = Math.ceil((Math.max(from.z, to.z) + margin - z0) / cell) + 1;
  const N = W * H;
  const hy = new Float32Array(N).fill(NaN);
  const probed = new Uint8Array(N);
  const p = new THREE.Vector3();
  // Probe every cell against the same reference height (order-independent; the village is one
  // level of decks ± steps).
  const refY = from.y;
  const height = (i: number, _nearY: number) => {
    if (probed[i]) return hy[i];
    probed[i] = 1;
    const x = x0 + (i % W) * cell, z = z0 + Math.floor(i / W) * cell;
    const g = world.groundAt(x, z, refY, 0.8, 1.2);
    if (!g || g.y < WATER_Y) return NaN;
    // Keep the same lip the controller keeps from drops / water (FOOT.edgeLook + radius).
    for (const [ox, oz] of [[0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]) {
      const gn = world.groundAt(x + ox, z + oz, g.y, STEP_UP, 1.1);
      if (!gn || gn.y < WATER_Y) return NaN;
    }
    const push = world.pushOut(p.set(x, g.y, z), 0.26, 1.65);
    if (push > 0.12) return NaN;
    hy[i] = g.y;
    return g.y;
  };
  const idx = (x: number, z: number) => Math.round((z - z0) / cell) * W + Math.round((x - x0) / cell);
  const start = idx(from.x, from.z), goal = idx(to.x, to.z);
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const open: number[] = [start];
  g[start] = 0;
  hy[start] = from.y; probed[start] = 1;
  const hx = (i: number) => Math.hypot((i % W) - (goal % W), Math.floor(i / W) - Math.floor(goal / W));
  const f = new Float32Array(N).fill(Infinity);
  f[start] = hx(start);
  let best = start;
  let iters = 0;
  while (open.length && iters++ < 80000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (hx(cur) < hx(best)) best = cur;
    if (cur === goal) break;
    const cx = cur % W, cz = Math.floor(cur / W);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const ni = nz * W + nx;
      const y = height(ni, hy[cur]);
      if (Number.isNaN(y) || Math.abs(y - hy[cur]) > STEP_UP) continue;
      const ng = g[cur] + (dx && dz ? 1.414 : 1);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; f[ni] = ng + hx(ni); if (!open.includes(ni)) open.push(ni); }
    }
  }
  const out: { x: number; z: number }[] = [];
  for (let c = came[goal] >= 0 ? goal : best; c >= 0; c = came[c]) out.push({ x: x0 + (c % W) * cell, z: z0 + Math.floor(c / W) * cell });
  out.reverse();
  // thin: keep every 3rd point + the last
  return out.filter((_, i) => i % 2 === 0 || i === out.length - 1);
}
