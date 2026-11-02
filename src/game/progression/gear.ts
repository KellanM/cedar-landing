/**
 * Period tackle ladder (docs/game_design_reference.md §6.4, revised 2026-11-02) and the live
 * `gear` stats the fishing minigame reads. Every tier opens something you can feel or reach:
 *   rod    → reel speed + slower tension build (holds bigger fish without slipping)
 *   line   → DEPTH: which species in a hotspot's pool can reach the hook at all
 *   reel   → slip resistance (the fish gains less line) + softer thrashes
 *   cooler → fish slots (save.coolerCap, plus the boat's hold)
 *   bait   → biases the bite toward a group of species / bigger sizes (never gates)
 * Nothing after ~1930: greenheart and split cane, cotton/silk/linen line, brass reels, iced boxes.
 */
import { lookupSpecies, RARITY_WEIGHT, SPECIES, type Species } from '../fishdata';
import type { Hotspot } from '../../world/types';
import type { SaveData } from '../save';
import { BOAT_TIERS, type BoatTierId } from './tiers';

export type Track = 'rod' | 'line' | 'reel' | 'cooler' | 'bait';

export interface GearItem {
  id: string;
  track: Track;
  tier: number;
  name: string;
  /** one-line period note in the shopkeeper's hand */
  note: string;
  /** plain-language effect (what changes in play) */
  effect: string;
  price: number;
  // stats (only the ones that matter for the track)
  reel?: number; tension?: number; thrash?: number; slip?: number; pull?: number;
  depth?: number; cap?: number;
  bias?: { ids?: string[]; behavior?: string[]; rarity?: Partial<Record<string, number>>; mul: number; size: number };
}

const I = (o: GearItem) => o;
export const GEAR: Record<Track, GearItem[]> = {
  rod: [
    I({ id: 'rod0', track: 'rod', tier: 0, name: "Gran's greenheart rod", note: 'Heavy, honest, older than the pier.', effect: 'Steady reel, strains quickly on a big fish.', price: 0, reel: 1, tension: 1, thrash: 1 }),
    I({ id: 'rod1', track: 'rod', tier: 1, name: 'Split-cane rod', note: 'Six strips of cane, glued and whipped by hand.', effect: 'Reels in a third faster; the line strains a little slower.', price: 140, reel: 1.33, tension: 0.85, thrash: 0.9 }),
    I({ id: 'rod2', track: 'rod', tier: 2, name: 'Built-cane salmon rod', note: 'Double-built butt, agate guides. A king-fish rod.', effect: 'Reels in fast and bends with a thrash instead of slipping.', price: 520, reel: 1.65, tension: 0.7, thrash: 0.72 }),
  ],
  line: [
    I({ id: 'line0', track: 'line', tier: 0, name: 'Cotton handline', note: 'Three fathoms on a cedar winder.', effect: 'Reaches the shallows: perch, sculpin, flatfish.', price: 0, depth: 3 }),
    I({ id: 'line1', track: 'line', tier: 1, name: 'Dressed silk line', note: 'Twelve fathoms, oiled so it sinks clean.', effect: 'Reaches the rocks and kelp: rockfish, cabezon, salmon.', price: 180, depth: 12 }),
    I({ id: 'line2', track: 'line', tier: 2, name: 'Tarred linen & cannonball', note: 'Thirty fathoms and a lead ball to take it down.', effect: 'Reaches the deep: halibut, lingcod, sablefish.', price: 650, depth: 30 }),
  ],
  reel: [
    I({ id: 'reel0', track: 'reel', tier: 0, name: 'Wooden spool', note: 'Turned from maple, clicks like a cricket.', effect: 'A slipped line gives the fish a long run.', price: 0, slip: 1, pull: 1 }),
    I({ id: 'reel1', track: 'reel', tier: 1, name: 'Brass Perfect-pattern reel', note: 'Ball-bearing brass. Sings when a salmon runs.', effect: 'Slips give up half the line; thrashes pull less.', price: 260, slip: 0.5, pull: 0.7 }),
  ],
  cooler: [
    I({ id: 'cool0', track: 'cooler', tier: 0, name: 'Cedar fish box', note: 'Two fish and a wet sack.', effect: 'Holds 2 fish.', price: 0, cap: 2 }),
    I({ id: 'cool1', track: 'cooler', tier: 1, name: 'Iced cedar box', note: 'Sawdust-packed ice from the ice house.', effect: 'Holds 4 fish: longer trips between sales.', price: 90, cap: 4 }),
    I({ id: 'cool2', track: 'cooler', tier: 2, name: 'Zinc-lined ice chest', note: 'Keeps a catch sweet till evening.', effect: 'Holds 6 fish.', price: 380, cap: 6 }),
  ],
  bait: [
    I({ id: 'clam', track: 'bait', tier: 0, name: 'Clam necks', note: 'Dug at low tide. Everything nibbles.', effect: 'No preference.', price: 0, bias: { mul: 1, size: 0 } }),
    I({ id: 'herring', track: 'bait', tier: 1, name: 'Herring strip', note: 'Cut on the bias so it spins.', effect: 'Salmon and trout bite three times as often.', price: 60, bias: { ids: ['coho_salmon', 'chinook_salmon', 'pink_salmon', 'sockeye_salmon', 'cutthroat_trout', 'pacific_herring'], mul: 3, size: 0.1 } }),
    I({ id: 'octopus', track: 'bait', tier: 1, name: 'Octopus strip', note: 'Tough. Bottom fish cannot resist it.', effect: 'Rockfish, lingcod, cabezon and halibut favour it.', price: 120, bias: { behavior: ['diver'], mul: 2.5, size: 0.08 } }),
    I({ id: 'spoon', track: 'bait', tier: 2, name: 'Brass trolling spoon', note: 'Hammered brass that flashes like a herring.', effect: 'Rare fish twice as likely; bigger fish overall.', price: 300, bias: { rarity: { rare: 2, uncommon: 1.4 }, mul: 1, size: 0.2 } }),
  ],
};
export const TRACKS: Track[] = ['rod', 'line', 'reel', 'cooler', 'bait'];
export const gearById = (id: string) => TRACKS.flatMap((t) => GEAR[t]).find((g) => g.id === id);

/**
 * Minimum line depth (fathoms) per species. Hotspots don't export a depth band yet, so depth is a
 * property of the fish (where it lives in the water column), which also reads naturally in the shop.
 */
const DEEP = ['lingcod', 'pacific_halibut', 'wolf_eel', 'yelloweye_rockfish', 'sablefish', 'spotted_ratfish', 'bluntnose_sixgill'];
const MID = ['copper_rockfish', 'quillback_rockfish', 'black_rockfish', 'cabezon', 'red_irish_lord', 'spiny_dogfish', 'chinook_salmon', 'sockeye_salmon'];
export function depthOf(sp: Species): number {
  if (DEEP.includes(sp.id)) return 30;
  if (MID.includes(sp.id)) return 12;
  if (SPECIES.some((s) => s.id === sp.id)) return 3;
  return sp.rarity === 'rare' || sp.rarity === 'legendary' ? 30 : sp.rarity === 'uncommon' ? 12 : 3;
}

/** Live stats (fishing.ts reads these each frame; mutated in place, never reallocated). */
export interface GearStats { reelMul: number; tensionMul: number; thrashMul: number; slipMul: number; pullMul: number; depth: number; bait: GearItem }
export const gear: GearStats = { reelMul: 1, tensionMul: 1, thrashMul: 1, slipMul: 1, pullMul: 1, depth: 3, bait: GEAR.bait[0] };

/** Saved upgrade state (save.upg). Missing / partial objects are normalised by ensureUpg. */
export interface UpgSave {
  rod: number; line: number; reel: number; cooler: number;
  baits: string[]; bait: string;
  boats: BoatTierId[]; boat: BoatTierId;
  /** per boat: paint group -> hex (absent = factory colour) */
  paint: Record<string, Record<string, string>>;
  flags: string[]; flag: string;
}
export function ensureUpg(save: SaveData): UpgSave {
  const d: UpgSave = { rod: 0, line: 0, reel: 0, cooler: 0, baits: ['clam'], bait: 'clam', boats: ['T0'], boat: 'T0', paint: {}, flags: ['pennant', 'crescent', 'tide'], flag: 'pennant' };
  const u = (save.upg ?? {}) as Partial<UpgSave>;
  const out: UpgSave = { ...d, ...u, paint: { ...(u.paint ?? {}) } };
  for (const k of ['rod', 'line', 'reel', 'cooler'] as const) out[k] = Math.max(0, Math.min(GEAR[k].length - 1, Number(out[k]) | 0));
  if (!out.baits.includes('clam')) out.baits = ['clam', ...out.baits];
  if (!out.baits.includes(out.bait)) out.bait = 'clam';
  if (!out.boats.includes('T0')) out.boats = ['T0', ...out.boats];
  if (!out.boats.includes(out.boat) || !BOAT_TIERS[out.boat]) out.boat = 'T0';
  for (const f of d.flags) if (!out.flags.includes(f)) out.flags.push(f);
  save.upg = out;
  return out;
}

/** Recompute `gear` + save.coolerCap from the saved tiers. Call after loading and after any purchase. */
export function applyGear(save: SaveData) {
  const u = ensureUpg(save);
  const rod = GEAR.rod[u.rod], line = GEAR.line[u.line], reel = GEAR.reel[u.reel], cool = GEAR.cooler[u.cooler];
  gear.reelMul = rod.reel ?? 1;
  gear.tensionMul = rod.tension ?? 1;
  gear.thrashMul = rod.thrash ?? 1;
  gear.slipMul = reel.slip ?? 1;
  gear.pullMul = reel.pull ?? 1;
  gear.depth = line.depth ?? 3;
  gear.bait = GEAR.bait.find((b) => b.id === u.bait) ?? GEAR.bait[0];
  save.coolerCap = (cool.cap ?? 2) + BOAT_TIERS[u.boat].hold;
}

/** Species in a hotspot's pool, split by whether the current line reaches them. */
export function poolReach(hs: Hotspot | null, depth = gear.depth) {
  const list = (hs?.fish_pool?.length ? hs.fish_pool : ['shiner perch']).map((p) => lookupSpecies(p, hs?.tier));
  return { reach: list.filter((s) => depthOf(s) <= depth), deep: list.filter((s) => depthOf(s) > depth) };
}

let onOutOfReach: ((sp: Species) => void) | null = null;
export function setOutOfReachHook(fn: (sp: Species) => void) { onOutOfReach = fn; }

function baitWeight(sp: Species, b: GearItem) {
  const bias = b.bias;
  let w = RARITY_WEIGHT[sp.rarity];
  if (!bias) return w;
  if (bias.ids?.includes(sp.id) || bias.behavior?.includes(sp.behavior)) w *= bias.mul;
  const r = bias.rarity?.[sp.rarity];
  if (r) w *= r;
  return w;
}

/** fishing.ts: species for the next bite, honouring line depth (gate) and bait (bias). */
export function pickSpeciesFor(hs: Hotspot | null, rnd = Math.random): Species {
  const { reach, deep } = poolReach(hs);
  // Something deeper sometimes takes a look and can't be reached: tell the player what the line misses.
  if (deep.length && onOutOfReach && rnd() < 0.3) onOutOfReach(deep[Math.floor(rnd() * deep.length)]);
  const list = reach.length ? reach : [lookupSpecies('shiner perch')];
  const total = list.reduce((a, s) => a + baitWeight(s, gear.bait), 0);
  let r = rnd() * total;
  for (const s of list) { r -= baitWeight(s, gear.bait); if (r <= 0) return s; }
  return list[list.length - 1];
}

/** fishing.ts: size roll with the bait's size bias (avg of 3 uniforms, pushed up by bias). */
export function rollSizeFor(s: Species, rnd = Math.random) {
  let u = (rnd() + rnd() + rnd()) / 3;
  const b = gear.bait.bias?.size ?? 0;
  if (b) u = Math.min(1, u + b * rnd());
  return Math.round((s.size[0] + (s.size[1] - s.size[0]) * u) * 10) / 10;
}

/** Species that a line tier newly reaches (for shop cards): depth in (prev, this]. */
export function speciesAtDepth(depth: number, prevDepth: number) {
  return SPECIES.filter((s) => !s.releaseOnly && depthOf(s) <= depth && depthOf(s) > prevDepth);
}
