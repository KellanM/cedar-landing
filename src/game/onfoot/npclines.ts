import type { Npc } from '../../world/types';

/** Placeholder one-line greetings by role, until real dialogue lands. */
const LINES: Record<string, string[]> = {
  fishmonger: ['Fresh off the water? Bring it to the counter!', "Ice is cold, prices are fair. Mostly."],
  tackle_keeper: ['Rods, hooks, lures. Shop opens soon, dear.', 'Rockfish like the drop-offs at dusk.'],
  bosun: ['Mind the slipway. And my legs.', "She'll float. Probably."],
  dockhand: ['Tie her up tight, the tide turns fast here.', 'Welcome to Cedar Landing!'],
  net_loft: ['Every knot tells a story. Most are about snags.'],
  townsfolk: ['Lovely day for it.', 'Have you tried the chowder at the snack hatch?', 'The gulls are bold today.'],
  town_kid: ['Did you catch a shark?! Can I see?', 'I found a bottle with a note in it once!'],
  village_kid: ["Bet I can skip a stone further than you.", 'The crabs pinch. I know.'],
  villager: ['Welcome, traveller.', 'The herring are running early this year.'],
  basket_weaver: ['Cedar bark, split thin. Takes a whole spring.'],
  clam_gardener: ['The rock walls keep the beach soft. Good clams.', 'Low tide is gardening time.'],
  storyteller: ['Sit a while. The old stories keep better with company.', 'Ask me about the turtles sometime.'],
  canoe_carver: ['One log, one canoe. Patience does the rest.'],
  cook: ["Smell that? Alder smoke. Nothing better.", 'Hungry? Come back at supper.'],
  net_mender: ['A torn net catches only wind.'],
  cartographer: ['Bring me pages from the logbook and I will ink the coast.', 'The map is missing more than it shows.'],
  crier: ['Hear ye! Rain by evening, lanternfish after dark!', 'Hear ye! The market pays well for big lingcod!'],
  cat: ['Mrrp.', '...(it eyes your cooler)'],
};

export function npcRole(n: Npc): string {
  const p = n.props ?? {};
  return String(p.npc_role ?? n.role ?? p.role ?? 'townsfolk');
}

export function npcDisplayName(n: Npc): string {
  const raw = n.npc_name ?? (n.props?.npc_name as string | undefined) ?? n.name ?? '';
  if (raw && !/^NPC_/.test(raw)) return raw;
  return npcRole(n).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function npcLine(n: Npc, visit: number): string {
  const role = npcRole(n);
  const list = LINES[role] ?? LINES.townsfolk;
  return list[visit % list.length];
}
