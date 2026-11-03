import type { Collider, Gameplay, LandGrid } from '../world/types';

/** Land collision: the exported land grid (primary), plus optional circle/poly colliders. */
export class LandCollision {
  private grid: (LandGrid & { bytes: Uint8Array }) | null = null;
  private colliders: Collider[];
  /** Tides (src/game/tidegrid.ts): extra land while the water is low. */
  extra: ((x: number, z: number) => boolean) | null = null;

  constructor(g: Gameplay) {
    if (g.landgrid) {
      const bin = atob(g.landgrid.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.grid = { ...g.landgrid, bytes };
    }
    this.colliders = g.colliders ?? [];
  }

  /** Land-grid extent (null without a grid). */
  get gridBox(): LandGrid | null { return this.grid; }

  /** Is the point (x,z) on land? */
  blocked(x: number, z: number): boolean {
    const gr = this.grid;
    if (gr) {
      const c = Math.floor((x - gr.originX) / gr.cell), r = Math.floor((z - gr.originZ) / gr.cell);
      if (c >= 0 && r >= 0 && c < gr.w && r < gr.h && gr.bytes[r * gr.w + c] === 1) return true;
    }
    if (this.extra?.(x, z)) return true;
    for (const col of this.colliders) {
      if (col.type === 'circle') {
        if (Math.hypot(x - col.pos[0], z - col.pos[2]) < col.r) return true;
      } else if (col.type === 'poly' && pointInPoly(x, z, col.pts)) return true;
    }
    return false;
  }

  /** Boat footprint test: centre + a ring of points at radius r. */
  hitsCircle(x: number, z: number, r: number): boolean {
    if (this.blocked(x, z)) return true;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (this.blocked(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true;
    }
    return false;
  }

  /**
   * Move from (x,z) by (dx,dz) and slide along land. Returns the resolved position and
   * whether we hit something (so the boat can lose speed).
   */
  move(x: number, z: number, dx: number, dz: number, r: number) {
    const nx = x + dx, nz = z + dz;
    if (!this.hitsCircle(nx, nz, r)) return { x: nx, z: nz, hit: false };
    // Slide: try each axis on its own.
    if (!this.hitsCircle(nx, z, r)) return { x: nx, z, hit: true };
    if (!this.hitsCircle(x, nz, r)) return { x, z: nz, hit: true };
    // Wedged (or started inside): nudge toward the nearest free direction.
    if (this.hitsCircle(x, z, r)) {
      for (let rad = 0.15; rad <= 6; rad += rad < 1 ? 0.15 : 0.5) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const tx = x + Math.cos(a) * rad, tz = z + Math.sin(a) * rad;
          if (!this.hitsCircle(tx, tz, r)) return { x: tx, z: tz, hit: true };
        }
      }
    }
    return { x, z, hit: true };
  }

  /** Find a free spot near (x,z) — used to validate spawn. */
  nearestFree(x: number, z: number, r: number) {
    if (!this.hitsCircle(x, z, r)) return { x, z };
    for (let rad = 1; rad <= 60; rad += 1) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const tx = x + Math.cos(a) * rad, tz = z + Math.sin(a) * rad;
        if (!this.hitsCircle(tx, tz, r)) return { x: tx, z: tz };
      }
    }
    return { x, z };
  }
}

function pointInPoly(x: number, z: number, pts: [number, number][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
