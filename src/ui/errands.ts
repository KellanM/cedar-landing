/**
 * Today's errands (Log → Errands, errand chip, cover stamps). Each completed errand becomes a
 * rubber stamp on the logbook cover (ui_layouts_indie §4.1 #11).
 */
import { ctx } from './ctx';
import { log, saveLog } from './prefs';
import { ensureUpg } from '../game/progression/gear';
import { BOAT_TIERS } from '../game/progression/tiers';

export interface Errand { id: string; text: string; stamp: string; done: () => boolean }

const recs = () => ctx.save?.records ?? {};
/** the boat you sail, by name ("the Little Troller") */
const boatName = () => (ctx.save ? BOAT_TIERS[ensureUpg(ctx.save).boat]?.name : null) ?? 'your boat';

export const ERRANDS: Errand[] = [
  { id: 'landing', text: 'Paddle over to Cedar Landing', stamp: 'LANDED', done: () => !!ctx.save?.reachedLanding },
  { id: 'first', text: 'Catch a fish at the ripples', stamp: 'FIRST FISH', done: () => Object.keys(recs()).length > 0 },
  { id: 'sell', text: 'Sell your catch to Mae at the market', stamp: 'SOLD', done: () => log.sold > 0 },
  { id: 'tie', get text() { return `Tie ${boatName()} up at a dock`; }, stamp: 'TIED UP', done: () => log.tiedUp },
  { id: 'perfect', text: 'Land a perfect reel', stamp: 'PERFECT', done: () => Object.keys(log.perfect).length > 0 },
  { id: 'five', text: 'Log five kinds of fish', stamp: 'FIVE KINDS', done: () => Object.keys(recs()).length >= 5 },
  { id: 'page', text: 'Find one of Gran\'s pages at a sunstone', stamp: 'PAGE', done: () => log.pages.length > 0 },
];

export const openErrands = () => ERRANDS.filter((e) => !e.done());
export const stamps = () => ERRANDS.filter((e) => e.done());

/** Errands that just became done (not yet struck). Marks them struck. */
export function newlyDone(): Errand[] {
  const out = ERRANDS.filter((e) => e.done() && !log.struck.includes(e.id));
  if (out.length) { log.struck.push(...out.map((e) => e.id)); saveLog(); }
  return out;
}
