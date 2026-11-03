import type { ShoreField } from '../render/shorefield';
import { WATER } from './tide';

/** Below this water level the tide grid takes part in collision; above it the exported land grid alone decides (unchanged high-water behaviour). */
export const TIDE_GRID_FROM = -0.12;
/** Water the boat needs under it (m): a friendly draft, it skims the shallows and grounds on the flats. */
const CLEARANCE = 0.1;
const CELL = 2; // m

/**
 * Height-aware land for the tides: per 2 m cell, the highest surface seen by the shore field's height
 * pass (seabed, beach toe, intertidal rock; never piers or decks, which the pass clips). A cell is land
 * while that surface stands above the water. Built once per shore field, O(1) lookups.
 */
export class TideGrid {
  private h: Float32Array;
  private w: number;
  private hgt: number;
  private ox: number;
  private oz: number;

  constructor(f: ShoreField) {
    this.ox = f.min.x; this.oz = f.min.y;
    this.w = Math.ceil(f.size.x / CELL); this.hgt = Math.ceil(f.size.y / CELL);
    this.h = new Float32Array(this.w * this.hgt).fill(-99);
    const [W, H] = f.res, tx = f.size.x / W, tz = f.size.y / H;
    for (let j = 0; j < H; j++) {
      const r = Math.floor(((j + 0.5) * tz) / CELL);
      for (let i = 0; i < W; i++) {
        const y = f.heights[j * W + i];
        if (!(y === y)) continue;
        const k = r * this.w + Math.floor(((i + 0.5) * tx) / CELL);
        if (y > this.h[k]) this.h[k] = y;
      }
    }
  }

  /** Highest surface in the cell at (x,z) (−99 = none / deep). */
  ground(x: number, z: number) {
    const c = Math.floor((x - this.ox) / CELL), r = Math.floor((z - this.oz) / CELL);
    if (c < 0 || r < 0 || c >= this.w || r >= this.hgt) return -99;
    return this.h[r * this.w + c];
  }

  /** Dry (or too shallow for the boat) at the current water level. */
  readonly blocked = (x: number, z: number) => WATER.y < TIDE_GRID_FROM && this.ground(x, z) > WATER.y - CLEARANCE;
}
