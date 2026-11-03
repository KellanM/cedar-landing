/**
 * The Little Troller's repair stages (docs/opening_study.md §4, option C):
 *   S0 as found (tarp over the cabin, stack unshipped, oars) · S1 patched + bailed, raw-cedar roof ·
 *   S2 fresh paint + roof (no engine yet) · S3 = BOAT_T0 from the world export (engine, stack, pennant).
 * S0–S2 come from public/models/boat_t0_stages.glb (art/boats/_scripts/export_stages.py). Until the
 * engine runs she is rowed: slower, softer handling.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BOAT_TUNING, BOAT_T0, type BoatTuning } from '../boat';
import { bakeBoat } from '../progression/boatpaint';

export type Stage = 0 | 1 | 2 | 3;
export const STAGE_NAMES = ['as found', 'patched', 'painted', 'running'] as const;

/** Rowing: about 60 % of the engine's top speed, gentler acceleration, a little more turn at rest. */
export const OARS: Partial<BoatTuning> = { maxSpeed: 4.3, maxReverse: 1.8, accel: 3.8, coastDrag: 0.6, turnRate: 1.3, pivotTurn: 0.45, camLookAhead: 3.5, camPullBack: 1.5, camFovBoost: 2 };

let models: Partial<Record<0 | 1 | 2, THREE.Mesh>> | null = null;
let loading: Promise<void> | null = null;

export function loadStages(base = import.meta.env.BASE_URL): Promise<void> {
  if (models) return Promise.resolve();
  loading ??= new GLTFLoader().loadAsync(`${base}models/boat_t0_stages.glb`).then((g) => {
    const out: Partial<Record<0 | 1 | 2, THREE.Mesh>> = {};
    for (const s of [0, 1, 2] as const) {
      const node = g.scene.getObjectByName(`BOAT_T0_S${s}`);
      const m = node ? bakeBoat(node) : null;
      if (m) { m.userData.stage = s; out[s] = m; }
    }
    models = out;
  }).catch((e) => { console.warn('[opening] boat stages unavailable', e); models = {}; });
  return loading;
}

/** Model for a stage (S3 → null: the caller keeps the world's BOAT_T0 / upgrade tier). */
export function stageModel(s: Stage): THREE.Mesh | null {
  if (s >= 3 || !models) return null;
  return models[s as 0 | 1 | 2] ?? null;
}

/** Handling for the stage: oars before the engine runs, the troller's own after. */
export function applyStageTuning(s: Stage) {
  if (s < 3) Object.assign(BOAT_TUNING, BOAT_T0, OARS);
}
