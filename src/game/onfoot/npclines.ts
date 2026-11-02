import type { Npc } from '../../world/types';

/**
 * NPC small talk. Each role has its own pool; every NPC walks its pool in a personal shuffled order
 * (seeded by its name), so neighbours with the same role don't open with the same line, and some
 * visits swap in a line about the time of day. Village lines stay everyday and practical: no
 * ceremonies, songs, named beings or specific stories (salish_sea_bible.md, respect guardrails).
 */
const LINES: Record<string, string[]> = {
  fishmonger: [
    'Fresh off the water? Bring it to the counter!',
    'Ice is cold, prices are fair. Mostly.',
    "Lingcod's fetching a good price this week.",
    "Gut it quick and keep it shaded. That's the whole secret.",
    'The cannery boys are short-handed again. Their loss, my gain.',
    "A greenling that size? You've a good eye.",
    "Don't let Biscuit near the scales. I count every one.",
  ],
  tackle_keeper: [
    'Rods, hooks, lures. Take your time, dear.',
    'Rockfish like the drop-offs at dusk.',
    'Heavier line for the deep spots. Trust an old woman.',
    "I tied my first fly when this town was three sheds and a dog.",
    'If the gulls are diving, there are fish underneath. Simple as that.',
    'A good reel outlives its owner. Mine has outlived two.',
    "Keep your hooks dry and your knots wet. Never the other way round.",
  ],
  bosun: [
    'Mind the slipway. And my legs.',
    "She'll float. Probably.",
    "Caulking's half art, half swearing.",
    'Every hull has a mood. This one sulks in the cold.',
    'Bring me shells and I can find you something with a proper engine.',
    "Tide's on the turn. Hear how the pilings knock?",
  ],
  dockhand: [
    'Tie her up tight, the tide turns fast here.',
    'Welcome to Cedar Landing!',
    "Two half-hitches and you'll never lose a boat. Probably.",
    "Watch the third plank. It's been 'about to be fixed' since spring.",
    'Mail boat comes Thursdays. Unless it doesn\'t.',
    'Seen the seals off the point? Cheeky lot.',
    "Packed ice for the fish market all morning. My hands don't feel like hands.",
  ],
  net_loft: [
    'Every knot tells a story. Most are about snags.',
    'Hang a net in the sun and it lasts twice as long.',
    'Cedar floats, lead sinks, and the fish go where they please.',
    "I can mend a net in the dark. Can't find my spectacles in daylight.",
  ],
  townsfolk: [
    'Have you tried the chowder at the snack hatch?',
    'The gulls are bold today.',
    "My grandfather swore there's a ship's bell under the cove. Rings at low tide, he said.",
    "They say the old Marigold went down with something precious aboard.",
    "I came for one summer. That was eleven summers ago.",
    'Mind the boardwalk by the chandlery. It bounces.',
    "The Crier's been hoarse since Tuesday. Peace at last.",
    "Saw an orca blow past the point. Stopped me in my tracks.",
    'If you find a bottle with a note in it, Pip will want to hear about it.',
    "Bit of rain keeps the tourists away. Not that we get tourists.",
    "Old Tess sold me a lure in '09. Still catching with it.",
    "The village across the cove smokes the best fish on the coast. Don't tell Marlo I said so.",
  ],
  town_kid: [
    'Did you catch a shark?! Can I see?',
    'I found a bottle with a note in it once!',
    "I'm not allowed past the end of the dock. But I could be.",
    'Biscuit caught a crab and the crab caught Biscuit back.',
    'When I grow up I want a boat with TWO chimneys.',
    "I can hold my breath for a whole minute. Almost.",
    "Do whales sleep? Where do they put their heads?",
  ],
  village_kid: [
    'Bet I can skip a stone further than you.',
    'The crabs pinch. I know.',
    "I helped carry the cedar bark today. It's heavier than it looks.",
    "My uncle says the seals know everyone's names.",
    'I found a feather this big! Well, almost this big.',
    "We're racing canoes later. You can watch. You can't win.",
  ],
  villager: [
    'Good to see you on the water.',
    'The herring are running early this year.',
    'The kelp beds have come back thicker. The fish noticed first.',
    'Take only what you need and the sea keeps giving. My mother said it every morning.',
    "There's smoked salmon drying if you come by later.",
    'The tide was very low this morning. Good for the clam beds.',
    "The eagles are nesting on the point again. Two this year.",
    'Our canoes and the town boats share the cove. Mostly politely.',
  ],
  basket_weaver: [
    'Cedar bark, split thin. Takes a whole spring.',
    'You gather the bark in spring, when it lets go easily.',
    'A tight weave holds water. A loose one holds clams.',
    'My aunt taught me this pattern. Her hands were faster than mine still are.',
    'Never strip the whole tree. Leave it enough to keep growing.',
  ],
  clam_gardener: [
    'The rock walls keep the beach soft. Good clams.',
    'Low tide is gardening time.',
    'Turn the gravel, add the shell, and the beach does the rest.',
    'These walls were built long before anyone in that town was born.',
    'A tended beach feeds many more than a wild one.',
    "Come back at the low tide. I'll show you how deep they dig.",
  ],
  storyteller: [
    'Sit a while. The old stories keep better with company.',
    'The stones on the islands mark where things were changed, long ago. Find them and listen.',
    'Stories are for winter evenings, by the fire. Come back when the nights are long.',
    'The salmon give themselves to us. We keep our promise to them. That is the whole of it.',
    'Your grandmother sat right where you are standing. She asked better questions.',
    'Some stories are for everyone. Some belong to families. I will tell you the first kind.',
    'The sea remembers who treats it well.',
  ],
  canoe_carver: [
    'One log, one canoe. Patience does the rest.',
    'You listen to the grain. It tells you where the canoe already is.',
    'Steam and hot stones open her up wide. Slowly. Slowly.',
    'This one has been in the making since the first frost.',
    "A good canoe outlives its maker. That's the idea, anyway.",
  ],
  cook: [
    'Smell that? Alder smoke. Nothing better.',
    'Hungry? Come back at supper.',
    'Low and slow over the alder. Hurry it and you ruin it.',
    "There's always enough for one more at this fire.",
    'Fresh salmon, a bit of salt, and smoke. Everything else is decoration.',
  ],
  net_mender: [
    'A torn net catches only wind.',
    'Every hole is a fish that got away. I take it personally.',
    'Nettle fibre twine. Stronger than anything they sell in town.',
    'Mend it the day you tear it, or mend it twice.',
  ],
  cartographer: [
    'Bring me pages from the logbook and I will ink the coast.',
    'The map is missing more than it shows.',
    'Soundings, soundings. A chart without depths is just a pretty picture.',
    "There are islands to the south nobody has charted properly. 'Position doubtful', as we say.",
    'I copied the old survey charts by lamplight. Half of them are wrong. Charmingly wrong.',
    'If you pass the Race, count the whirlpools for me. I need it for the chart.',
  ],
  crier: [
    'Hear ye! Rain by evening, lanternfish after dark!',
    'Hear ye! The market pays well for big lingcod!',
    'Hear ye! Lost: one boot, left foot. Smells of herring.',
    'Hear ye! The chandlery has new line in. Strong enough for a whale! Do not try it on a whale!',
    'Hear ye! Fog expected at dawn. Ring your bells!',
    "Hear ye! Would whoever keeps feeding the gulls kindly STOP.",
  ],
  cat: ['Mrrp.', '...(it eyes your cooler)', '...(it purrs, then bites you gently)', 'Mrow?', '...(it rolls over, then thinks better of it)'],
};

/** Lines about the hour, by group, mixed into visits after the first. */
const TIME_LINES: Record<'town' | 'village' | 'kid', Record<string, string[]>> = {
  town: {
    morning: ['Early start? The fish are hungriest now.', "Fog'll burn off by ten. Usually.", 'First coffee of the day and already a gull has stolen my bun.'],
    day: ['Lovely day for it.', "Sun's out. Half the town has found a reason to stand on the dock.", 'Grand weather for drying nets.'],
    dusk: ['Lamps are going on along the boardwalk. My favourite hour.', 'The rockfish come up at dusk, they say.', "Supper soon. Can you smell the chowder?"],
    night: ["Out late? Mind your step, the boardwalk's slick.", "Lanternfish come up after dark. Pretty things.", "Can't sleep. The bell buoy's keeping time again."],
  },
  village: {
    morning: ['The tide is low this morning. Good for gathering.', 'Mist on the water. The canoes will wait for it to lift.'],
    day: ['A good drying day for the fish.', 'The children have been in the water since sunrise.'],
    dusk: ['The fires are lit. Come and sit if you like.', 'The light goes gold on the water about now.'],
    night: ['The stars are clear tonight.', 'Quiet nights are for listening to the sea.'],
  },
  kid: {
    morning: ["I'm not supposed to be up yet. Don't tell."],
    day: ["It's too sunny to do chores. Obviously."],
    dusk: ["I have to go in when the lamps are lit. That's soon. Too soon."],
    night: ["I snuck out to see the lanternfish. Shh!"],
  },
};

/** Era names for the unnamed townsfolk (village fillers keep their role titles). */
const KID_NAMES = ['Tilly', 'Bram', 'Nell', 'Otto', 'Lottie', 'Fitz'];
const TOWN_NAMES = ['Hattie', 'Walt', 'Agnes', 'Ned', 'Mags', 'Clem', 'Ida', 'Percy', 'Winnie', 'Ruben', 'Opal', 'Gus', 'Dot', 'Amos'];

let lineCtx: { tod: string; hour: number } = { tod: 'overcast', hour: 10.7 };
/** main.ts keeps this in sync with the game clock. */
export function setLineContext(tod: string, hour: number) { lineCtx = { tod, hour }; }

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}
const shuffled = <T>(a: T[], seed: number) => {
  const r = a.slice();
  let x = seed || 1;
  const rnd = () => { x = (x + 0x6d2b79f5) >>> 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
};

export function npcRole(n: Npc): string {
  const p = n.props ?? {};
  return String(p.npc_role ?? n.role ?? p.role ?? 'townsfolk');
}

const keyOf = (n: Npc) => `${n.name ?? ''}|${n.npc_name ?? ''}|${n.pos?.join(',') ?? ''}`;
const isFiller = (n: Npc) => /^NPC_/.test(n.npc_name ?? (n.props?.npc_name as string | undefined) ?? n.name ?? '') || !(n.npc_name ?? n.props?.npc_name);

/** Rank of each NPC within its role, and among the unnamed townsfolk (for names). Set from the world. */
const roleRank = new Map<string, { rank: number; count: number }>();
const nameRank = new Map<string, number>();
const kidRank = new Map<string, number>();
export function setNpcRoster(npcs: Npc[]) {
  roleRank.clear(); nameRank.clear(); kidRank.clear();
  const byRole = new Map<string, Npc[]>();
  for (const n of npcs) { const r = npcRole(n); if (!byRole.has(r)) byRole.set(r, []); byRole.get(r)!.push(n); }
  for (const list of byRole.values()) {
    list.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    list.forEach((n, i) => roleRank.set(keyOf(n), { rank: i, count: list.length }));
  }
  const unnamed = npcs.filter((n) => isFiller(n) && String(n.props?.culture ?? 'town') !== 'village' && !/kid|cat/.test(npcRole(n)));
  const order = shuffled(TOWN_NAMES.map((_, i) => i), 7);
  unnamed.sort((a, b) => keyOf(a).localeCompare(keyOf(b))).forEach((n, i) => nameRank.set(keyOf(n), order[i % order.length]));
  npcs.filter((n) => isFiller(n) && npcRole(n) === 'town_kid').sort((a, b) => keyOf(a).localeCompare(keyOf(b))).forEach((n, i) => kidRank.set(keyOf(n), i % KID_NAMES.length));
}

export function npcDisplayName(n: Npc): string {
  const raw = n.npc_name ?? (n.props?.npc_name as string | undefined) ?? n.name ?? '';
  if (raw && !/^NPC_/.test(raw)) return raw;
  const nr = nameRank.get(keyOf(n));
  if (nr !== undefined) return TOWN_NAMES[nr];
  const kr = kidRank.get(keyOf(n));
  if (kr !== undefined) return KID_NAMES[kr];
  return npcRole(n).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function timeSlot(): string {
  const { tod, hour } = lineCtx;
  if (tod === 'night' || hour >= 21.5 || hour < 5) return 'night';
  if (tod === 'dusk' || hour >= 18.5) return 'dusk';
  if (tod === 'fog' || hour < 10) return 'morning';
  return 'day';
}

/**
 * Line for the `visit`-th chat with `n`. NPCs of one role share a shuffled pool but start at
 * evenly spaced points in it, so no two open with the same line; every 4th chat (staggered per
 * NPC) is a line about the hour instead.
 */
export function npcLine(n: Npc, visit: number): string {
  const role = npcRole(n);
  const pool = LINES[role] ?? LINES.townsfolk;
  const list = shuffled(pool, hash(role));
  const rr = roleRank.get(keyOf(n)) ?? { rank: hash(keyOf(n)) % list.length, count: 1 };
  const step = Math.max(1, Math.floor(list.length / Math.max(1, rr.count)));
  if (role !== 'cat' && role !== 'crier' && visit > 0 && (visit + rr.rank) % 4 === 2) {
    const culture = String(n.props?.culture ?? '');
    const group = /kid/.test(role) ? 'kid' : culture === 'village' ? 'village' : 'town';
    const tl = TIME_LINES[group][timeSlot()];
    if (tl?.length) return tl[(rr.rank + Math.floor(visit / 4)) % tl.length];
  }
  return list[(rr.rank * step + visit) % list.length];
}
