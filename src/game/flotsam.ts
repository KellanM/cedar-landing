/**
 * Flotsam pick-up: the 27 LIFE_Fnn pieces drifting on the sound (world/dynamic.glb, interact
 * `collect_flotsam`). Haul one aboard for a few Shells; message bottles carry a note, and the six
 * `logbook_hint` bottles point at a fishing spot worth a visit. Debris drifts back after
 * RESPAWN_DAYS game days; bottles are found once.
 */
import type { Interact } from '../world/types';

export const RESPAWN_DAYS = 2;

export interface FlotsamKind { noun: string; shells: number; once?: boolean }
const KINDS: [RegExp, FlotsamKind][] = [
  [/chest/i, { noun: 'a sea chest, swollen shut', shells: 30, once: true }],
  [/bottle/i, { noun: 'a corked bottle', shells: 2, once: true }],
  [/crates/i, { noun: 'a lashed pair of crates', shells: 8 }],
  [/barrel/i, { noun: 'a stray barrel', shells: 6 }],
  [/net/i, { noun: 'a tangle of old net', shells: 5 }],
  [/planks_ring/i, { noun: 'a ring of planks', shells: 5 }],
  [/planks/i, { noun: 'some good planks', shells: 3 }],
  [/pot_float/i, { noun: 'a lost pot float', shells: 4 }],
];

/** What the bottles say. Hint bottles name a real spot / time from gameplay.json's hotspots. */
const NOTES: Record<string, { from: string; text: string }> = {
  F04: { from: 'A bottle', text: 'When the lighthouse turns over the west shelf after dark, the perch come up to look at it. Fish the beam. — W.' },
  F07: { from: 'A bottle', text: 'Out past the arch the spires boil at first light. The big quillbacks lie under the bait. Bring a heavier boat than mine. — R.M.' },
  F10: { from: 'A bottle', text: 'Lingcod get bold at dusk on the east edge of the kelp, and in the rip off Hook Point. Mind your line on the stalks.' },
  F13: { from: 'A bottle', text: 'There is a hole among the spires where the yelloweye live, old as your grandfather. Rough water, any hour. Worth it.' },
  F16: { from: 'A bottle', text: 'Halibut on the Blue Line: the west end after dark, the east end at dawn. Long line, a patient hand, and a club.' },
  F20: { from: 'A bottle', text: 'Kings run in the fog bank off Marigold at dawn. Further on, past the stack, something enormous rises at night. I only saw its eye.' },
  F24: { from: 'A bottle', text: 'Dear Ada, the weather has turned and the boat leaks, but the fishing is fair. Keep the stove lit. Home by the new moon. — J.' },
};

export function flotsamId(it: Interact): string | null {
  const id = it.props?.flotsam_id;
  return typeof id === 'string' ? id : null;
}

export function kindOf(nodeName: string): FlotsamKind {
  for (const [re, k] of KINDS) if (re.test(nodeName)) return k;
  return { noun: 'some driftwood', shells: 2 };
}

export function noteFor(id: string) { return NOTES[id] ?? null; }

/** collected and not yet drifted back */
export function isGone(map: Record<string, number> | undefined, id: string, day: number) {
  const d = map?.[id];
  if (d === undefined) return false;
  return d < 0 || day - d < RESPAWN_DAYS;
}
