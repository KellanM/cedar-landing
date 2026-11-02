/**
 * Small v1 fish table (game_design_reference §6.2/6.3). Prices in Shells:
 * Common 5–15, Uncommon 30–60, Rare 150–400. Stars multiply ×1.0 / 1.25 / 1.5.
 * Hotspot fish_pool names are matched case-insensitively; unknown names get a generic entry
 * built from the hotspot's tier so new export data never breaks the game.
 */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type Behavior = 'calm' | 'darter' | 'diver' | 'sprinter';

export interface Species {
  id: string;
  name: string;
  rarity: Rarity;
  size: [number, number]; // cm min/max
  price: number; // base Shells
  behavior: Behavior;
  color: string; // card / shadow tint
  flavor: string;
  /** juvenile / protected: show the card, then it must go back */
  releaseOnly?: boolean;
}

const S = (name: string, rarity: Rarity, size: [number, number], price: number, behavior: Behavior, color: string, flavor: string): Species => ({
  id: name.toLowerCase().replace(/[^a-z]+/g, '_'), name: titleCase(name), rarity, size, price, behavior, color, flavor,
});

function titleCase(s: string) {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export const SPECIES: Species[] = [
  S('shiner perch', 'common', [8, 18], 6, 'darter', '#B9C2B8', 'Small, silver, and very sure of itself.'),
  S('pile perch', 'common', [20, 40], 10, 'calm', '#8F9A8A', 'Hangs around pilings like it pays rent.'),
  S('striped seaperch', 'common', [18, 36], 11, 'calm', '#C7835A', 'Wears its stripes with quiet pride.'),
  S('pacific herring', 'common', [15, 30], 7, 'darter', '#9FB3C0', 'Comes in crowds. Rarely alone.'),
  S('pacific sand lance', 'common', [10, 25], 5, 'darter', '#C8C9B8', 'Dives into sand when nervous. Relatable.'),
  S('surf smelt', 'common', [12, 22], 5, 'darter', '#C2CCC9', 'Smells faintly of cucumber, the keeper swears.'),
  S('kelp greenling', 'common', [25, 50], 14, 'calm', '#8C7A4E', 'Dressed for the kelp forest.'),
  S('starry flounder', 'common', [25, 60], 13, 'calm', '#6E6A52', 'Both eyes on one side. Sees you anyway.'),
  S('english sole', 'common', [20, 45], 11, 'calm', '#8A7F62', 'Flat, polite, and slightly sandy.'),
  S('pacific sanddab', 'common', [12, 30], 8, 'calm', '#9A8C6C', 'Fits in a frying pan perfectly.'),
  S('staghorn sculpin', 'common', [15, 35], 6, 'calm', '#6F7A6A', 'Grumpy face, gentle soul.'),
  S('buffalo sculpin', 'common', [15, 35], 7, 'calm', '#5E6450', 'Looks like a rock that learned to swim.'),
  S('spiny dogfish', 'uncommon', [60, 110], 34, 'sprinter', '#7E8790', 'A tiny shark with excellent posture.'),
  S('copper rockfish', 'uncommon', [25, 55], 38, 'diver', '#B8703E', 'Lives a long, careful life in the rocks.'),
  S('quillback rockfish', 'uncommon', [25, 60], 42, 'diver', '#9C6A3A', 'Prickly about personal space.'),
  S('black rockfish', 'uncommon', [30, 60], 36, 'diver', '#3E444A', 'Schools near the surface on calm days.'),
  S('cabezon', 'uncommon', [35, 80], 48, 'diver', '#7A6A3E', 'Mostly head. Proud of it.'),
  S('red irish lord', 'uncommon', [20, 50], 44, 'calm', '#A8473A', 'Dressed for a party nobody invited it to.'),
  S('spotted ratfish', 'uncommon', [40, 90], 40, 'calm', '#9A8FA4', 'Glows faintly green in the dark, they say.'),
  S('cutthroat trout', 'uncommon', [25, 55], 45, 'sprinter', '#B48A5A', 'Sea-run and a little bit wild.'),
  S('coho salmon', 'uncommon', [45, 80], 58, 'sprinter', '#A9B8C4', 'Silver bright, jumps for joy.'),
  S('pink salmon', 'uncommon', [40, 65], 52, 'sprinter', '#C4A0A4', 'Every other year, right on time.'),
  S('lingcod', 'rare', [60, 120], 180, 'diver', '#6E7A52', 'Neither a ling nor a cod. Nobody tells it.'),
  S('chinook salmon', 'rare', [70, 120], 260, 'sprinter', '#8C9AAA', 'The king. Fishes you as much as you fish it.'),
  S('wolf eel', 'rare', [100, 200], 300, 'diver', '#6C6A66', 'A face only a reef could love.'),
  S('pacific halibut', 'rare', [80, 180], 360, 'diver', '#5E5A4A', 'A barn door with opinions.'),
  S('sand sole', 'common', [20, 45], 12, 'calm', '#9C8C68', 'Freckled and flat, like a beach towel.'),
  S('bay pipefish', 'common', [10, 30], 9, 'darter', '#7E8A52', 'A seahorse cousin that forgot to curl.'),
  S('dungeness crab', 'uncommon', [14, 22], 45, 'calm', '#B0603E', 'Walks sideways out of every argument.'),
  S('sockeye salmon', 'uncommon', [45, 70], 60, 'sprinter', '#B8443A', 'Turns red with effort. Same.'),
  S('sablefish', 'uncommon', [40, 80], 55, 'diver', '#4A4E52', 'Butter-soft and very deep-thinking.'),
  S('yelloweye rockfish', 'rare', [40, 80], 220, 'diver', '#D07A2E', 'Can live past a hundred. Be gentle.'),
  S('coho smolt', 'common', [8, 15], 0, 'darter', '#B8C4C8', 'Too young to keep. Grow big, little one.'),
  S('bluntnose sixgill', 'legendary', [250, 400], 0, 'diver', '#5A5E66', 'An ancient shark from the dark. Just say hello.'),
];
SPECIES.find((s) => s.id === 'coho_smolt')!.releaseOnly = true;
SPECIES.find((s) => s.id === 'bluntnose_sixgill')!.releaseOnly = true;

const BY_NAME = new Map(SPECIES.map((s) => [s.name.toLowerCase(), s]));

export const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, uncommon: 28, rare: 10, legendary: 2 };
const GENERIC_PRICE: Record<Rarity, number> = { common: 9, uncommon: 40, rare: 200, legendary: 2000 };

export function lookupSpecies(name: string, tierHint?: string): Species {
  const raw = name.toLowerCase().trim();
  // export names may carry notes: "wolf eel (release)", "chinook salmon (king)", "... (legendary sighting)"
  const note = (raw.match(/\(([^)]*)\)/)?.[1] ?? '').trim();
  const n = raw.replace(/\([^)]*\)/g, '').trim();
  const base = findSpecies(n, tierHint);
  if (note.includes('release') && !base.releaseOnly) return { ...base, releaseOnly: true };
  return base;
}

function findSpecies(n: string, tierHint?: string): Species {
  const hit = BY_NAME.get(n) ?? BY_NAME.get(n.replace(/^pacific /, '')) ?? [...BY_NAME.values()].find((s) => n.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(n));
  if (hit) return hit;
  const r: Rarity = tierHint === 'good' ? 'uncommon' : tierHint === 'uncommon' || tierHint === 'rare' || tierHint === 'legendary' ? tierHint : 'common';
  return S(n, r, [20, 50], GENERIC_PRICE[r], 'calm', '#8C948C', 'Not in the keeper\'s book yet.');
}

/** Weighted pick from a hotspot's pool by rarity. */
export function pickSpecies(pool: string[], tier?: string, rnd = Math.random): Species {
  const list = (pool.length ? pool : ['shiner perch']).map((p) => lookupSpecies(p, tier));
  const total = list.reduce((a, s) => a + RARITY_WEIGHT[s.rarity], 0);
  let r = rnd() * total;
  for (const s of list) { r -= RARITY_WEIGHT[s.rarity]; if (r <= 0) return s; }
  return list[list.length - 1];
}

/** Normal-ish size roll (avg of 3 uniforms), returns cm with one decimal. */
export function rollSize(s: Species, rnd = Math.random) {
  const u = (rnd() + rnd() + rnd()) / 3;
  return Math.round((s.size[0] + (s.size[1] - s.size[0]) * u) * 10) / 10;
}

export interface CaughtFish { speciesId: string; name: string; size: number; stars: number; price: number; color: string; rarity: Rarity; releaseOnly?: boolean }

export function priceFor(s: Species, size: number, stars: number) {
  const starMul = [1, 1, 1.25, 1.5][stars] ?? 1;
  const sizeMul = 0.8 + 0.4 * ((size - s.size[0]) / Math.max(1, s.size[1] - s.size[0]));
  return Math.max(1, Math.round(s.price * starMul * sizeMul));
}

export function speciesById(id: string) {
  return SPECIES.find((s) => s.id === id);
}
