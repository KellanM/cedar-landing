/**
 * The opening quest chain (docs/opening_study.md §3, the trimmed ~9-minute version Kellan chose):
 * each quest is a small journey that hands the next one its tool. Pure data + a tiny state machine;
 * opening.ts decides when steps are done and keeps the save (save.opening) in step.
 */
export type QuestId = 'q0' | 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6' | 'q7' | 'q8' | 'q9';

export interface QuestStep { id: string; text: string }
export interface Quest { id: QuestId; title: string; stamp: string; steps: QuestStep[] }

export const QUESTS: Quest[] = [
  { id: 'q0', title: 'The Mail Boat', stamp: 'ARRIVED', steps: [{ id: 'walk', text: 'walk up to the cottage' }] },
  { id: 'q1', title: "Gran's Logbook", stamp: 'LOGBOOK', steps: [{ id: 'book', text: 'find my logbook on the porch' }] },
  {
    id: 'q2', title: 'Beachcombing', stamp: 'TACKLE', steps: [
      { id: 'rod', text: 'my old rod (by the pale log)' },
      { id: 'tin', text: 'my hook tin (in the rock pool)' },
      { id: 'clams', text: 'clam necks (the bubbling holes)' },
      { id: 'rig', text: 'rig it all at the campfire' },
    ],
  },
  { id: 'q3', title: "She'll Float", stamp: 'AFLOAT', steps: [{ id: 'chain', text: 'unlock her chain at the dock' }, { id: 'repair', text: 'bail her out and patch the seam' }] },
  { id: 'q4', title: 'Oars in the Water', stamp: 'UNDERWAY', steps: [{ id: 'gate', text: 'row out between the green and red buoys' }] },
  { id: 'q5', title: 'First Ripples', stamp: 'FIRST FISH', steps: [{ id: 'fish', text: 'catch supper at the ripples' }] },
  { id: 'q6', title: 'Two in the Box', stamp: 'FULL BOX', steps: [{ id: 'two', text: 'fill the fish box (two)' }] },
  { id: 'q7', title: 'The Way Across', stamp: 'TIED UP', steps: [{ id: 'map', text: 'mark Cedar Landing on the chart' }, { id: 'tie', text: 'tie up at Cedar Landing' }] },
  { id: 'q8', title: 'Fresh off the Water', stamp: 'SOLD', steps: [{ id: 'sell', text: 'sell my catch to Mae' }] },
  { id: 'q9', title: "Gran's Tab", stamp: 'OUTFITTED', steps: [{ id: 'tess', text: 'see Old Tess about my tab' }] },
];

/** Saved state (save.opening). `stage` is the Little Troller's repair stage: 0 as found … 3 = BOAT_T0. */
export interface OpeningSave {
  q: number;
  steps: string[];
  done: boolean;
  stage: 0 | 1 | 2 | 3;
  /** came in through "I know the way" (or migrated from an older save) */
  fast?: boolean;
  /** Gran's tab: which of her three lures (set at Q9) */
  lure?: 'red' | 'green' | 'blue';
  /** small one-shot flags (lines said, barrel taken …) */
  flags?: string[];
}

export function newOpening(): OpeningSave { return { q: 0, steps: [], done: false, stage: 0, flags: [] }; }

/** A save made before the opening existed: everything counts as done and the boat is the troller. */
export function migratedOpening(): OpeningSave { return { q: QUESTS.length, steps: [], done: true, stage: 3, fast: true, flags: [] }; }

/** "I know the way": skip to Q7 with the tackle rigged and the boat patched (stage 1). */
export function fastPathOpening(): OpeningSave { return { q: 7, steps: [], done: false, stage: 1, fast: true, flags: [] }; }

export const questAt = (o: OpeningSave): Quest | null => (o.done ? null : QUESTS[o.q] ?? null);
export const stepDone = (o: OpeningSave, id: string) => o.steps.includes(id);
export const hasFlag = (o: OpeningSave, f: string) => !!o.flags?.includes(f);
export function setFlag(o: OpeningSave, f: string) { if (!hasFlag(o, f)) (o.flags ??= []).push(f); }

/** Mark a step of the CURRENT quest done. Returns 'step' | 'quest' (all steps done → advanced) | null. */
export function completeStep(o: OpeningSave, id: string): 'step' | 'quest' | null {
  const q = questAt(o);
  if (!q || !q.steps.some((s) => s.id === id) || stepDone(o, id)) return null;
  o.steps.push(id);
  if (q.steps.every((s) => stepDone(o, s.id))) { advance(o); return 'quest'; }
  return 'step';
}

export function advance(o: OpeningSave) {
  o.q++;
  o.steps = [];
  if (o.q >= QUESTS.length) o.done = true;
}

/** Index of quest `id` (for "has the player reached / passed it"). */
export const qIndex = (id: QuestId) => QUESTS.findIndex((q) => q.id === id);
export const reached = (o: OpeningSave, id: QuestId) => o.done || o.q >= qIndex(id);
export const passed = (o: OpeningSave, id: QuestId) => o.done || o.q > qIndex(id);
