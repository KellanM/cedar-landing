/**
 * The Little Troller through the opening (Kellan 2026-11-03: "keep the dishevelled version; make the
 * one before it even worse"):
 *   stage 0  WRECK  — as found at her mooring: half-swamped, listing, holed, tarp torn, mast snapped
 *   stage 1  FIXED  — after Q3's bail + patch: the scruffy troller (tarp-lashed cabin, stack lying on the
 *                     foredeck, faded paint, weed line, a gull) — the look she KEEPS. Rowed (oars).
 *   stage 2  FIXED  — same look; Bosun Ade got the engine going (troller handling; smoke from the stack)
 *   stage 3  BOAT_T0 as exported (saves from before the opening keep the boat they had)
 * Both variants come from public/models/boat_t0_fixer.glb (art/boats/_scripts/export_stages.py) with
 * the T0 sockets in their extras; FIXED carries the troller's paint groups so the shipwright's paint works.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BOAT_TUNING, BOAT_T0, type BoatTuning } from '../boat';
import { bakeBoat } from '../progression/boatpaint';

export type Stage = 0 | 1 | 2 | 3;

/** Rowing: about 60 % of the engine's top speed, gentler acceleration, a little more turn at rest. */
export const OARS: Partial<BoatTuning> = { maxSpeed: 4.3, maxReverse: 1.8, accel: 3.8, coastDrag: 0.6, turnRate: 1.3, pivotTurn: 0.45, camLookAhead: 3.5, camPullBack: 1.5, camFovBoost: 2 };

let wreck: THREE.Mesh | null = null;
let fixed: THREE.Mesh | null = null;
let stackTop: number[] | undefined;
let loading: Promise<void> | null = null;

export function loadFixer(base = import.meta.env.BASE_URL): Promise<void> {
  loading ??= new GLTFLoader().loadAsync(`${base}models/boat_t0_fixer.glb`).then((g) => {
    const w = g.scene.getObjectByName('BOAT_T0_WRECK');
    const f = g.scene.getObjectByName('BOAT_T0_FIXED');
    wreck = w ? bakeBoat(w) : null;
    fixed = f ? bakeBoat(f) : null;
    stackTop = fixed?.userData.socket_stack_top as number[] | undefined;
  }).catch((e) => { console.warn('[opening] fixer-upper models unavailable', e); });
  return loading;
}
export const fixerReady = () => !!fixed;

export function wreckModel() { return wreck; }

/** The troller she is from Q3 on. The stack only smokes once the engine runs (stage 2). */
export function fixedModel(engine: boolean) {
  if (!fixed) return null;
  if (engine && stackTop) fixed.userData.socket_stack_top = stackTop; else delete fixed.userData.socket_stack_top;
  return fixed;
}

/** Oars until the engine runs. */
export function applyOars() { Object.assign(BOAT_TUNING, BOAT_T0, OARS); }
