/**
 * The skipper's catch lines (docs/catch_study.md F4): first person, a pun on the name, in the
 * Animal Crossing register ("I caught a sea bass! No, wait—it's at least a C+!"). Rare and legendary
 * fish get a big-type headline first ("Thar she blows!"). Gran's notes stay on the card (fishdata.flavor).
 * `{n}` is replaced with the species name; the UI inks it in ochre red.
 */
export interface CatchLine { pun: string; head?: string }

export const CATCH_LINES: Record<string, CatchLine> = {
  shiner_perch: { pun: 'I caught a {n}! Small, but look at it shine!' },
  pile_perch: { pun: 'I caught a {n}! Add it to the pile!' },
  striped_seaperch: { pun: 'I caught a {n}! It sure earned its stripes!' },
  pacific_herring: { pun: 'I caught a {n}! Not a red herring. The real deal!' },
  pacific_sand_lance: { pun: 'I caught a {n}! Sir Lance-a-little!' },
  surf_smelt: { pun: 'I caught a {n}! Surf\'s up, smelt\'s out!' },
  kelp_greenling: { pun: 'I caught a {n}! Go on, be green with envy!' },
  starry_flounder: { pun: 'I caught a {n}! A real star of the sea floor!' },
  english_sole: { pun: 'I caught an {n}! Jolly good, old chap!' },
  pacific_sanddab: { pun: 'I caught a {n}! A little dab\'ll do ya!' },
  staghorn_sculpin: { pun: 'I caught a {n}! Sculpted by the sea itself!' },
  buffalo_sculpin: { pun: 'I caught a {n}! Not a buffalo. Still a beauty!' },
  sand_sole: { pun: 'I caught a {n}! What a sole-ful face!' },
  bay_pipefish: { pun: 'I caught a {n}! Pipe up if you\'ve seen a straighter fish!' },
  coho_smolt: { pun: 'I caught a {n}! Smol. So smol. Go grow, little one!' },
  spiny_dogfish: { pun: 'I caught a {n}! Who\'s a good fish? You are!' },
  copper_rockfish: { pun: 'I caught a {n}! Heads I win, tails... I also win!' },
  quillback_rockfish: { pun: 'I caught a {n}! Quick, somebody fetch me a quill!' },
  black_rockfish: { pun: 'I caught a {n}! It rocks. It rolls. It\'s mine!' },
  cabezon: { pun: 'I caught a {n}! All head, no regrets!' },
  red_irish_lord: { pun: 'I caught a {n}! Lord, what a face!' },
  spotted_ratfish: { pun: 'I caught a {n}! Big eyes, bigger personality!' },
  cutthroat_trout: { pun: 'I caught a {n}! Cutthroat competition, and I won!' },
  coho_salmon: { pun: 'I caught a {n}! Coho-ly moly!' },
  pink_salmon: { pun: 'I caught a {n}! Well, I\'m tickled pink!' },
  dungeness_crab: { pun: 'I caught a {n}! Don\'t get crabby, little buddy!' },
  sockeye_salmon: { pun: 'I caught a {n}! Sock it to me!' },
  sablefish: { pun: 'I caught a {n}! Butter-soft, and I\'m butter-fingers no more!' },
  lingcod: { head: 'Look at those teeth!', pun: 'I caught a {n}! Neither ling nor cod, all attitude!' },
  chinook_salmon: { head: 'Long live the king!', pun: 'I caught a {n}! King of the Sound, and now it\'s in my arms!' },
  wolf_eel: { head: 'What a mug!', pun: 'I caught a {n}! Its bark is worse than its bite. Probably.' },
  pacific_halibut: { head: 'It\'s a barn door!', pun: 'I caught a {n}! Hali-but-why is it so heavy?!' },
  yelloweye_rockfish: { head: 'An old soul!', pun: 'I caught a {n}! Older than Gran, and twice as wise!' },
  bluntnose_sixgill: { head: 'Up from the dark!', pun: 'I caught a {n}! Hello there, ancient one!' },
};

/** Headlines for rare+ fish without their own (and the tier escalation on records). */
export const TIER_HEAD = { rare: 'Yes! Got it!', legendary: 'Whoa... WHOA!' } as const;

const article = (name: string) => (/^[aeiou]/i.test(name) ? 'an' : 'a');

/** The pun line for a species (generic for names not in the book yet). */
export function punFor(id: string, name: string): string {
  const l = CATCH_LINES[id];
  if (l) return l.pun;
  return `I caught ${article(name)} {n}! Not in Gran's book... yet!`;
}

/** A short line for a repeat (no pun: the joke is spent; ACNH repeats are what wear players down). */
export function repeatLine(pb: boolean): string {
  return pb ? `A bigger {n}! That's a new record!` : `Another {n}! Into the book it goes.`;
}

export function headFor(id: string, tier: 'rare' | 'legendary'): string {
  return CATCH_LINES[id]?.head ?? TIER_HEAD[tier];
}
