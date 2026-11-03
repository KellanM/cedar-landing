/**
 * Catch victory sequence (docs/catch_study.md). One plan per catch decides how big the moment is —
 * rarity sets the tier, firsts / personal bests / perfect reels add to it, and a repeat common gets
 * the short version — and one dt-driven timeline plays the beats:
 *
 *   pullout  the fish leaves the water (arc length/height by tier; legendary: swell + slow-mo)
 *   pose     arms go up to meet it (rare+: the two-hand hoist even for a small fish)
 *   reveal   in hand: fanfare, star burst, confetti, hop, camera push-in, haptics, flash
 *   head     rare+: a big-type headline ("Look at those teeth!")
 *   line     the pun, typed, with size + NEW / Record! / Perfect tags
 *   card     the specimen card (or the slip for a repeat common)
 *
 * Every beat after the reveal can be skipped with a tap (straight to the card). The timeline runs on
 * real frame time, so stepping the sim clock (captures) steps it too.
 */
import type { CaughtFish, Rarity, Species } from './fishdata';
import { headFor, punFor, repeatLine } from './catchlines';

export type Tier = 'quick' | 'common' | 'uncommon' | 'rare' | 'legendary';
export const TIERS: Tier[] = ['quick', 'common', 'uncommon', 'rare', 'legendary'];

export interface CatchMods { first: boolean; pb: boolean; perfect: boolean; count: number }

export interface CatchPlan {
  tier: Tier;
  level: number; // 0..4
  fish: CaughtFish;
  species: Species;
  mods: CatchMods;
  /** landing arc (actor time): seconds, metres of extra height */
  arc: { dur: number; h: number };
  /** legendary: slow-mo at the apex of the arc */
  slow: boolean;
  /** two-hand overhead hoist even for a small fish */
  hoist: boolean;
  head: string | null;
  line: string | null;
  /** typing speed of the line (chars/s) */
  cps: number;
  /** seconds after the reveal */
  at: { box: number; headDwell: number; after: number; card: number };
  sparks: number;
  twinkle: number;
  confetti: number;
  rays: boolean;
  flash: number; // 0 = none
  /** camera: 0 = the usual hold-up framing, 1 = the fish fills the frame */
  frame: number;
  /** skipper hop / arm-pump strength 0..1 */
  cheer: number;
  haptic: number[];
  /** card shows these extra stamps after the first */
  stamps: string[];
  mode: 'slip' | 'card';
}

const ARC: Record<Tier, { dur: number; h: number }> = {
  quick: { dur: 0.6, h: 1.4 }, common: { dur: 0.66, h: 1.6 }, uncommon: { dur: 0.78, h: 2.0 }, rare: { dur: 0.95, h: 2.6 }, legendary: { dur: 1.2, h: 3.4 },
};
const HAPTIC: Record<Tier, number[]> = {
  quick: [18], common: [22, 40, 22], uncommon: [30, 40, 30, 40, 50], rare: [40, 30, 40, 30, 90], legendary: [60, 40, 60, 40, 60, 60, 220],
};

export function planCatch(fish: CaughtFish, species: Species, mods: CatchMods): CatchPlan {
  const r: Rarity = fish.rarity;
  const tier: Tier = r === 'legendary' ? 'legendary' : r === 'rare' ? 'rare' : r === 'uncommon' ? 'uncommon' : mods.first || mods.pb ? 'common' : 'quick';
  const level = TIERS.indexOf(tier);
  const big = level >= 3;
  // repeats: the pun is spent after the first (rare+ keep it for a couple of catches — they ARE rare)
  const fresh = mods.first || (big && mods.count < 3);
  const line = tier === 'quick' ? null : fresh ? punFor(fish.speciesId, fish.name) : repeatLine(mods.pb);
  const head = big && (mods.first || mods.pb || mods.count < 3) ? headFor(fish.speciesId, tier as 'rare' | 'legendary') : null;
  const cps = [0, 62, 56, 50, 46][level];
  const after = [0, 0.5, 0.6, 0.75, 0.85][level];
  const box = [0, 0.3, 0.32, 0.38, 0.5][level];
  const headDwell = head ? (tier === 'legendary' ? 1.05 : 0.85) : 0;
  const len = line ? line.replace('{n}', fish.name).length : 0;
  const card = tier === 'quick' ? 0.55 : box + headDwell + len / cps + after;
  const stamps: string[] = [];
  if (mods.pb && !mods.first) stamps.push('RECORD');
  if (mods.perfect) stamps.push('PERFECT');
  return {
    tier, level, fish, species, mods,
    arc: ARC[tier], slow: tier === 'legendary', hoist: big,
    head, line, cps,
    at: { box, headDwell, after, card },
    sparks: [6, 12, 18, 28, 40][level] + (mods.perfect ? 4 : 0),
    twinkle: [0, 0, 3, 6, 9][level],
    confetti: big ? (tier === 'legendary' ? 110 : 56) : mods.first && level >= 2 ? 22 : 0,
    rays: tier === 'legendary',
    flash: big ? (tier === 'legendary' ? 1 : 0.7) : 0,
    frame: Math.min(1, [0, 0.25, 0.45, 0.8, 1][level] + (mods.pb ? 0.3 : 0)),
    cheer: [0.35, 0.55, 0.75, 1, 1][level],
    haptic: HAPTIC[tier],
    stamps,
    mode: tier === 'quick' ? 'slip' : 'card',
  };
}

/** The stage the show drives (main.ts wires camera, rig, FX, audio and UI). */
export interface ShowStage {
  pullout(p: CatchPlan): void;
  pose(p: CatchPlan): void;
  reveal(p: CatchPlan): void;
  head(p: CatchPlan, text: string): void;
  line(p: CatchPlan, text: string): void;
  result(p: CatchPlan, skipped: boolean): void;
}

export type Beat = 'idle' | 'arc' | 'reveal' | 'head' | 'line' | 'result';

export class CatchShow {
  plan: CatchPlan | null = null;
  beat: Beat = 'idle';
  /** seconds since the reveal (real time) */
  t = 0;
  private arcT = 0;
  private posed = false;
  private headShown = false;
  private lineShown = false;
  /** debug/captures: wall-clock ms of each beat since pullout */
  readonly log: { beat: Beat; ms: number }[] = [];
  private t0 = 0;

  constructor(private stage: ShowStage) {}

  get active() { return this.beat !== 'idle' && this.beat !== 'result'; }

  private mark(b: Beat) { this.beat = b; this.log.push({ beat: b, ms: Math.round(performance.now() - this.t0) }); }

  /** The fish leaves the water. */
  start(p: CatchPlan) {
    this.plan = p;
    this.t = 0; this.arcT = 0;
    this.posed = this.headShown = this.lineShown = false;
    this.log.length = 0;
    this.t0 = performance.now();
    this.mark('arc');
    this.stage.pullout(p);
  }

  /** The fish lands in the skipper's hands. */
  caught() {
    const p = this.plan;
    if (!p || this.beat !== 'arc') return;
    if (!this.posed) { this.posed = true; this.stage.pose(p); }
    this.t = 0;
    this.mark('reveal');
    this.stage.reveal(p);
  }

  /** Tap anywhere: straight to the card / slip. */
  skip() {
    const p = this.plan;
    if (!p || this.beat === 'arc' || !this.active) return false;
    this.finish(true);
    return true;
  }

  private finish(skipped: boolean) {
    const p = this.plan!;
    this.mark('result');
    this.stage.result(p, skipped);
  }

  /** dt: real frame time; adt: actor time (the arc runs on it, so slow-mo stretches it). */
  update(dt: number, adt: number) {
    const p = this.plan;
    if (!p || !this.active) return;
    if (this.beat === 'arc') {
      this.arcT += adt;
      // arms go up while the fish is still in the air, so the hands meet it (ACNH whale shark 15.6 s)
      if (!this.posed && this.arcT >= p.arc.dur * 0.4) { this.posed = true; this.stage.pose(p); }
      return;
    }
    this.t += dt;
    const A = p.at;
    if (p.head && !this.headShown && this.t >= A.box) { this.headShown = true; this.mark('head'); this.stage.head(p, p.head); }
    if (p.line && !this.lineShown && this.t >= A.box + A.headDwell) { this.lineShown = true; this.mark('line'); this.stage.line(p, p.line); }
    if (this.t >= A.card) this.finish(false);
  }

  reset() { this.plan = null; this.beat = 'idle'; }
}
