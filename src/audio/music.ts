/**
 * Adaptive score. Short composed-on-the-fly pieces (≈ 1–2 min) separated by long rests filled by
 * ambience; a fishing-fight tension layer that follows the line; a resolving cadence on the catch.
 *
 * Pieces are written by a small folk-idiom composer: diatonic progressions in major / Mixolydian /
 * Dorian, a 2-bar melodic motif that repeats (A A′ B A form), fingerpicked guitar or harp
 * arpeggios, a reed-organ pad, an upright-bass pluck, and a ritardando into the last chord.
 * The arrangement thins and thickens by section so it breathes. See docs/audio_study.md.
 */
import { rng, type Rng } from './dsp';
import { AUDIO_TUNING, type AudioEngine } from './engine';
import { note, type Inst } from './instruments';

export type Variant = 'day' | 'night' | 'dusk' | 'town';
export type MusicState = 'off' | 'rest' | 'piece' | 'fight' | 'resolve';

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
} as const;
type ModeName = keyof typeof SCALES;

/** 4-bar progressions as 0-based scale degrees (triads built diatonically). */
const PROGS: Record<ModeName, number[][]> = {
  major: [[0, 3, 0, 4], [0, 5, 3, 4], [0, 4, 5, 3], [3, 0, 4, 0], [0, 3, 4, 0], [5, 3, 0, 4], [0, 2, 3, 0], [0, 3, 1, 4]],
  mixolydian: [[0, 6, 3, 0], [0, 6, 0, 4], [0, 3, 6, 0], [6, 3, 0, 0]],
  dorian: [[0, 3, 0, 6], [0, 6, 3, 0], [0, 2, 3, 0], [0, 3, 6, 0]],
};
/** bridge (B) progressions: leave home, end on V or IV for the return */
const BRIDGE: Record<ModeName, number[][]> = {
  major: [[3, 4, 5, 4], [5, 3, 1, 4], [3, 0, 3, 4], [5, 2, 3, 4]],
  mixolydian: [[3, 6, 3, 4], [6, 6, 3, 3]],
  dorian: [[3, 6, 2, 3], [6, 3, 6, 4]],
};

export interface Ev { t: number; inst: Inst; midi: number; dur: number; vel: number; pan?: number; wet?: number }
export interface Piece { variant: Variant; seed: number; tonic: number; mode: ModeName; bpm: number; meter: 4 | 6 | 3; bars: number; length: number; events: Ev[]; lead: Inst; form: string }

const pick = <T>(r: Rng, a: readonly T[]) => a[Math.floor(r() * a.length)];

/** Compose a whole piece as a timed event list (pure: same seed → same piece). */
export function compose(variant: Variant, seed: number): Piece {
  const r = rng(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ (seed << 13)); // decorrelate nearby seeds
  for (let i = 0; i < 4; i++) r();
  const night = variant === 'night', dusk = variant === 'dusk', town = variant === 'town';
  const mode: ModeName = town ? 'major' : night ? pick(r, ['major', 'dorian', 'major'] as const) : dusk ? pick(r, ['major', 'dorian', 'mixolydian'] as const) : pick(r, ['major', 'major', 'mixolydian', 'dorian'] as const);
  // tonics chosen so the guitar/harp sit well (D, G, C, A, F, E)
  const tonic = 60 + pick(r, night ? [-3, 0, 2, -5] : [2, -5, 0, -3, 5, 4]);
  const meter: 4 | 6 | 3 = town ? 3 : night ? pick(r, [4, 6, 4] as const) : pick(r, [4, 4, 6] as const);
  // beat = quarter (4, 3) or dotted quarter (6/8)
  const bpm = town ? 104 + r() * 12 : night ? (meter === 6 ? 44 + r() * 6 : 60 + r() * 8) : dusk ? 66 + r() * 8 : meter === 6 ? 52 + r() * 8 : 78 + r() * 16;
  const lead: Inst = town ? pick(r, ['accordion', 'mandolin'] as const) : night ? pick(r, ['celesta', 'vibes', 'harp'] as const) : dusk ? pick(r, ['vibes', 'harp', 'accordion'] as const) : pick(r, ['marimba', 'accordion', 'mandolin', 'vibes'] as const);
  const sc = SCALES[mode];
  const ticksPerBar = meter === 4 ? 8 : 6; // eighth-note grid
  const beatsPerBar = meter === 6 ? 2 : meter;
  const ticksPerBeat = ticksPerBar / beatsPerBar;
  const tickSec = 60 / bpm / ticksPerBeat;
  const swing = meter === 4 && !night ? 0.06 : 0; // a touch of lilt on off-beat eighths

  // form
  const pA = pick(r, PROGS[mode]);
  let pB = pick(r, BRIDGE[mode]);
  if (night || town) pB = pick(r, BRIDGE[mode]);
  const cad = (p: number[]) => [...p.slice(0, 2), mode === 'dorian' ? 6 : 4, 0]; // cadence variant of a phrase
  type Sec = { name: string; prog: number[] };
  const secs: Sec[] = [];
  const short = night ? r() < 0.6 : town ? true : r() < 0.4;
  secs.push({ name: 'intro', prog: [pA[0], pA[0]] });
  secs.push({ name: 'A', prog: [...pA, ...cad(pA)] });
  if (!short) secs.push({ name: 'A2', prog: [...pA, ...cad(pA)] });
  secs.push({ name: 'B', prog: [...pB, ...pB.slice(0, 3), mode === 'dorian' ? 6 : 4] });
  secs.push({ name: 'A3', prog: [...pA, ...cad(pA)] });
  secs.push({ name: 'outro', prog: [0, 0] });
  const chords = secs.flatMap((s) => s.prog.map((d) => ({ d, sec: s.name })));
  const bars = chords.length;

  // tempo map with a ritardando over the last 3 bars
  const barStart: number[] = [0];
  for (let b = 0; b < bars; b++) {
    const rit = b >= bars - 3 ? 1 + 0.12 * (b - (bars - 4)) : 1;
    barStart.push(barStart[b] + ticksPerBar * tickSec * rit);
  }
  const at = (bar: number, tick: number) => {
    const len = barStart[bar + 1] - barStart[bar];
    const off = tick % 2 === 1 ? swing : 0;
    return barStart[bar] + ((tick + off) / ticksPerBar) * len + (r() - 0.5) * 0.012;
  };

  const triad = (deg: number) => [0, 2, 4].map((k) => {
    const i = deg + k;
    return sc[i % 7] + 12 * Math.floor(i / 7);
  });
  const ev: Ev[] = [];
  const hum = (v: number) => Math.max(0.05, v * (0.9 + r() * 0.2));

  // ---- pad (reed organ): voice-led close triads around middle C
  let prevVoicing: number[] = [];
  const voice = (deg: number) => {
    const t = triad(deg).map((x) => x + tonic - 12);
    const cands: number[][] = [];
    for (const inv of [0, 1, 2]) {
      const v = t.map((x, i) => (i < inv ? x + 12 : x)).sort((a, b) => a - b);
      for (const sh of [-12, 0, 12]) cands.push(v.map((x) => x + sh));
    }
    const center = 57; // around A3
    let best = cands[0], bs = Infinity;
    for (const c of cands) {
      const s = prevVoicing.length ? c.reduce((a, x, i) => a + Math.abs(x - prevVoicing[i]), 0) : 0;
      const sc2 = s + Math.abs(c[1] - center) * 0.6;
      if (sc2 < bs) { bs = sc2; best = c; }
    }
    prevVoicing = best;
    return best;
  };

  // ---- melody: motif-based, chord tones on strong beats, steps between
  const RH4 = night ? [[0], [0, 4], [0, 6], [0, 3, 4]] : [[0, 2, 4, 6], [0, 3, 4, 6], [0, 2, 3, 4], [0, 4], [0, 2, 4], [0, 4, 6], [0, 6]];
  const RH6 = night ? [[0], [0, 3], [0, 4]] : [[0, 2, 3, 5], [0, 3, 5], [0, 2, 3], [0, 3], [0, 1, 2, 3]];
  const RH3 = [[0, 2, 4], [0, 4], [0, 2, 3, 4], [0, 3, 4]];
  const RH = meter === 4 ? RH4 : meter === 6 ? RH6 : RH3;
  const lo = tonic + (lead === 'celesta' ? 12 : 0), hi = lo + 16;
  // degree index space (scale steps relative to tonic)
  const pitchOf = (step: number) => tonic + sc[((step % 7) + 7) % 7] + 12 * Math.floor(step / 7);
  const nearestChordStep = (deg: number, from: number) => {
    let best = from, bd = Infinity;
    for (let s = from - 5; s <= from + 5; s++) {
      if (![deg, deg + 2, deg + 4].some((d) => (((s - d) % 7) + 7) % 7 === 0)) continue;
      const p = pitchOf(s);
      if (p < lo || p > hi) continue;
      const d = Math.abs(s - from) + (r() < 0.25 ? r() * 2 : 0);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  type MNote = { bar: number; tick: number; step: number; len: number };
  const phrase = (prog: number[], startStep: number, motif: number[][] | null, home: boolean): { notes: MNote[]; motif: number[][] } => {
    const rh = motif ?? [pick(r, RH), pick(r, RH)];
    const notes: MNote[] = [];
    let step = startStep, dir = r() < 0.5 ? 1 : -1;
    for (let b = 0; b < prog.length; b++) {
      const pos = b % 4;
      const cells = pos === 3 ? (meter === 4 ? [0] : [0]) : rh[pos % 2];
      for (let i = 0; i < cells.length; i++) {
        const tick = cells[i];
        const next = i + 1 < cells.length ? cells[i + 1] : ticksPerBar;
        const strong = tick === 0 || tick === ticksPerBar / 2;
        if (pos === 3) step = nearestChordStep(home && b === prog.length - 1 ? 0 : prog[b], step);
        else if (strong) step = nearestChordStep(prog[b], step + dir);
        else {
          step += r() < 0.8 ? dir : -dir;
          if (r() < 0.12) step += dir; // occasional skip
        }
        if (pitchOf(step) > hi - 1) { dir = -1; step -= 2; }
        if (pitchOf(step) < lo + 1) { dir = 1; step += 2; }
        if (r() < 0.22) dir = -dir;
        notes.push({ bar: b, tick, step, len: next - tick });
      }
    }
    return { notes, motif: rh };
  };

  // ---- write the sections
  let bar = 0;
  let aMotif: number[][] | null = null;
  let aMel: MNote[] | null = null;
  const melOn = (name: string) => name !== 'intro' && name !== 'outro';
  for (const s of secs) {
    const n = s.prog.length;
    const thin = s.name === 'B' && !town; // B breathes: half-density accompaniment
    const full = s.name === 'A2' || s.name === 'A3';
    for (let b = 0; b < n; b++) {
      const deg = s.prog[b];
      const B = bar + b;
      const tri = triad(deg).map((x) => x + tonic);
      const root = tri[0] - 24 + (tri[0] - 24 < 40 ? 12 : 0);
      const fifth = root + 7;
      const barDur = barStart[B + 1] - barStart[B];
      // pad
      const padOn = !town && (s.name !== 'B' || night || dusk) && !(s.name === 'outro' && b === 1);
      if (padOn) for (const p of voice(deg)) ev.push({ t: at(B, 0), inst: 'harmonium', midi: p, dur: barDur * 0.98, vel: hum(night ? 0.55 : 0.7) });
      // accompaniment
      if (town) {
        // oom-pah-pah: bass on 1, accordion chord stabs on 2 and 3
        ev.push({ t: at(B, 0), inst: 'bass', midi: b % 2 ? fifth - 12 + 12 : root, dur: tickSec * 2, vel: hum(0.8) });
        const v = voice(deg);
        for (const tk of [2, 4]) for (const p of v) ev.push({ t: at(B, tk), inst: 'accordion', midi: p, dur: tickSec * 1.1, vel: hum(0.45), pan: 0.15 });
      } else {
        const arp: Inst = night || dusk ? 'harp' : 'guitar';
        const up = [tri[0] - 12, tri[1] - 12, tri[2] - 12, tri[0]].map((x) => (x < 52 ? x + 12 : x));
        const pat = meter === 4 ? [0, 2, 3, 1, 4, 2, 3, 1] : [0, 1, 2, 3, 2, 1];
        const lowNotes = [root + 12 < 50 ? root + 12 : root, ...up];
        for (let tk = 0; tk < ticksPerBar; tk++) {
          if (thin && tk % 2) continue;
          if (night && tk % 2 && meter === 4) continue;
          if (s.name === 'outro' && b === 1 && tk > 0) break;
          const idx = tk === 0 ? 0 : tk === ticksPerBar / 2 && meter === 4 ? -1 : pat[tk];
          const m = idx === -1 ? (lowNotes[0] + 7) : idx === 0 ? lowNotes[0] : up[(idx - 1 + up.length) % up.length];
          const last = s.name === 'outro' && b === 1;
          ev.push({ t: at(B, tk), inst: arp, midi: m, dur: last ? 3 : tickSec * 3, vel: hum((tk === 0 ? 0.8 : 0.55) * (night ? 0.75 : 1)), pan: -0.25 });
        }
        if (s.name === 'outro' && b === 1) for (const p of up.slice(1)) ev.push({ t: at(B, 0) + 0.04 + r() * 0.05, inst: arp, midi: p, dur: 3, vel: hum(0.5), pan: -0.2 });
        // bass: beats 1 (and 3) in fuller sections
        if ((full || s.name === 'B') && !(night && s.name !== 'A3')) {
          ev.push({ t: at(B, 0), inst: 'bass', midi: root, dur: barDur * 0.45, vel: hum(0.85) });
          if (meter === 4 && !night) ev.push({ t: at(B, 4), inst: 'bass', midi: r() < 0.5 ? root + 7 : root, dur: barDur * 0.4, vel: hum(0.65) });
          if (meter === 6) ev.push({ t: at(B, 3), inst: 'bass', midi: root + 7, dur: barDur * 0.4, vel: hum(0.6) });
        }
      }
    }
    // melody per 4-bar phrase
    if (melOn(s.name)) {
      const out: MNote[] = [];
      for (let p = 0; p < n; p += 4) {
        const prog = s.prog.slice(p, p + 4);
        const home = p + 4 >= n && s.name !== 'B';
        if (s.name.startsWith('A') && aMel && p === 0) {
          // A′ / A″: the same tune (that's the hook), only the cadence bar re-written
          const reused = aMel.filter((x) => x.bar < 3).map((x) => ({ ...x }));
          const tail = phrase(prog, reused.length ? reused[reused.length - 1].step : 2, aMotif, home).notes.filter((x) => x.bar === 3);
          out.push(...reused, ...tail);
        } else {
          const ph = phrase(prog, out.length ? out[out.length - 1].step : 2 + Math.floor(r() * 3), s.name === 'B' ? null : aMotif, home);
          if (s.name.startsWith('A') && !aMotif) aMotif = ph.motif;
          ph.notes.forEach((x) => (x.bar += p));
          out.push(...ph.notes);
          if (s.name === 'A' && p === 0) aMel = ph.notes.map((x) => ({ ...x }));
        }
      }
      const inst: Inst = s.name === 'B' && !town ? (lead === 'accordion' ? 'mandolin' : lead === 'vibes' ? 'harp' : lead === 'harp' ? 'celesta' : lead === 'celesta' ? 'harp' : lead === 'mandolin' ? 'accordion' : 'vibes') : lead;
      for (const x of out) {
        const B = bar + x.bar;
        const len = x.len * tickSec * (B >= bars - 3 ? 1.2 : 1);
        const t = at(B, x.tick);
        const v = hum(x.tick === 0 ? 0.85 : 0.7) * (s.name === 'A' ? 0.9 : 1);
        ev.push({ t, inst, midi: pitchOf(x.step), dur: len * (inst === 'accordion' ? 0.92 : 1), vel: v, pan: 0.2 });
        // mandolin melodies tremolo on long notes (folk idiom)
        if (inst === 'mandolin' && len > tickSec * 3.5) for (let k = 1; k * 0.11 < len - 0.1; k++) ev.push({ t: t + k * 0.11, inst, midi: pitchOf(x.step), dur: 0.15, vel: v * 0.55, pan: 0.2 });
      }
    }
    bar += n;
  }
  // a soft bell on the last chord of day/dusk pieces (the harbour bell, far away)
  if (!town && r() < 0.5) ev.push({ t: barStart[bars - 1] + 0.02, inst: night ? 'celesta' : 'bell', midi: tonic + (night ? 12 : 0), dur: 4, vel: 0.35, wet: 0.6 });
  ev.sort((a, b) => a.t - b.t);
  const length = barStart[bars] + 3.5;
  return { variant, seed, tonic, mode, bpm: Math.round(bpm), meter, bars, length, events: ev, lead, form: secs.map((s) => s.name).join(' ') };
}

// ------------------------------------------------------------------ director
export interface MusicContext {
  tod: string;
  /** 0..1 how much the listener is "in town" (harbour / docks) */
  town: number;
  fighting: boolean;
  tension: number;
  thrashing: boolean;
}

export class MusicDirector {
  state: MusicState = 'rest';
  piece: Piece | null = null;
  private start = 0;
  private ptr = 0;
  nextAt = 0;
  private sub: GainNode;
  private fightBus: GainNode;
  private fight: { t0: number; nextBar: number; bar: number; tonic: number; mode: ModeName; beat: number } | null = null;
  private seed = 1;
  lastVariant: Variant | null = null;
  history: string[] = [];
  private wasTown = 0;
  private resolveUntil = 0;
  lastTonic = 62;
  private lastMode: ModeName = 'major';

  constructor(private e: AudioEngine, firstDelay = 7) {
    this.sub = e.ctx.createGain();
    this.sub.connect(e.buses.music);
    this.fightBus = e.ctx.createGain();
    this.fightBus.gain.value = 0;
    this.fightBus.connect(e.buses.music);
    this.nextAt = e.now + firstDelay;
    this.seed = (Date.now() % 100000) | 0;
  }

  private variantFor(c: MusicContext): Variant {
    if (/night/.test(c.tod)) return 'night';
    if (/dusk/.test(c.tod)) return 'dusk';
    if (c.town > 0.55) return 'town';
    return 'day';
  }

  /** Start a piece now (also used by tests / debug). */
  startPiece(v: Variant, seed?: number) {
    const e = this.e;
    this.piece = compose(v, seed ?? this.seed++);
    this.start = e.now + 0.15;
    this.ptr = 0;
    this.state = 'piece';
    this.lastVariant = v;
    this.lastTonic = this.piece.tonic;
    this.lastMode = this.piece.mode;
    this.sub.gain.cancelScheduledValues(e.now);
    this.sub.gain.setValueAtTime(1, e.now);
    this.history.push(`${v}:${this.piece.mode}:${this.piece.bpm}bpm:${this.piece.bars}bars:${this.piece.lead}`);
    if (this.history.length > 10) this.history.shift();
    e.log('music.piece', `${v} ${this.piece.mode} ${this.piece.bpm}bpm ${this.piece.length.toFixed(0)}s ${this.piece.lead}`);
  }

  private endPiece(fade: number, gapScale = 1) {
    const e = this.e;
    if (this.piece && fade > 0) {
      this.sub.gain.cancelScheduledValues(e.now);
      this.sub.gain.setValueAtTime(this.sub.gain.value, e.now);
      this.sub.gain.linearRampToValueAtTime(0, e.now + fade);
    }
    this.piece = null;
    this.state = 'rest';
    const T = AUDIO_TUNING;
    this.nextAt = e.now + fade + (T.gapMin + Math.random() * (T.gapMax - T.gapMin)) * gapScale;
  }

  update(c: MusicContext, enabled: boolean, horizon = 0.5) {
    const e = this.e, now = e.now;
    if (!enabled) {
      if (this.state === 'piece') this.endPiece(0.8);
      if (this.fight) this.stopFight(false);
      this.state = 'off';
      return;
    }
    if (this.state === 'off') { this.state = 'rest'; this.nextAt = now + 4; }

    // fight layer takes over while the line is tight
    if (c.fighting && !this.fight) this.startFight();
    if (this.fight) {
      if (!c.fighting) this.stopFight(false);
      else this.tickFight(c, horizon);
    }
    if (this.state === 'resolve' && now > this.resolveUntil) {
      this.state = 'rest';
    }

    // arrival in town brings the next piece forward (the "welcome back" cue)
    const inTown = c.town > 0.6 ? 1 : 0;
    if (inTown && !this.wasTown && this.state === 'rest' && this.nextAt - now > 12 && !/night|fog/.test(c.tod)) this.nextAt = now + 4;
    this.wasTown = inTown;

    if (this.state === 'piece' && this.piece) {
      const p = this.piece, until = now + horizon - this.start;
      while (this.ptr < p.events.length && p.events[this.ptr].t <= until) {
        const x = p.events[this.ptr++];
        const t = this.start + x.t;
        if (t < now - 0.05) continue; // fell behind (tab was hidden): skip, don't pile up
        note(e, x.inst, Math.max(t, now), x.midi, x.dur, x.vel, { pan: x.pan, wet: x.wet, dest: this.sub });
      }
      if (now > this.start + p.length) this.endPiece(0, /night/.test(c.tod) ? 1.3 : 1);
    } else if (this.state === 'rest' && now >= this.nextAt && !c.fighting) {
      // fog: the weather is the score (foghorn, bell buoy); music only sometimes
      if (/fog/.test(c.tod) && Math.random() < 0.6) { this.nextAt = now + 60; return; }
      this.startPiece(this.variantFor(c));
    }
  }

  // -------------------------------------------------------------- fight
  private startFight() {
    const e = this.e;
    // the piece steps aside (fades), the tension layer comes in on its key
    const tonic = this.piece?.tonic ?? this.lastTonic, mode = this.piece?.mode ?? this.lastMode;
    if (this.state === 'piece') this.endPiece(1.6, 0.35); else this.nextAt = Math.max(this.nextAt, e.now + 20);
    this.state = 'fight';
    this.fight = { t0: e.now + 0.05, nextBar: e.now + 0.05, bar: 0, tonic, mode: mode === 'dorian' ? 'dorian' : 'major', beat: 60 / 104 };
    this.fightBus.gain.cancelScheduledValues(e.now);
    this.fightBus.gain.setValueAtTime(0, e.now);
    this.fightBus.gain.linearRampToValueAtTime(1, e.now + 0.6);
    e.log('music.fight');
  }

  private tickFight(c: MusicContext, horizon: number) {
    const e = this.e, F = this.fight!;
    while (F.nextBar < e.now + horizon) {
      const sc = SCALES[F.mode];
      const prog = [0, 0, 5, 4]; // I I vi V … resolves on the catch
      const deg = prog[F.bar % 4];
      const root = F.tonic - 24 + sc[deg % 7] + (deg >= 5 ? -12 : 0);
      const ten = Math.min(1, Math.max(0, c.tension));
      const eighth = F.beat / 2;
      const lp = 700 + 3800 * ten;
      // muted-guitar ostinato (8ths), accent shape 3+3+2
      const accents = [1, 0.55, 0.6, 1, 0.55, 0.6, 0.9, 0.6];
      const pat = [0, 0, 7, 0, 12, 0, 7, 12];
      for (let k = 0; k < 8; k++) {
        note(e, 'mute', F.nextBar + k * eighth, root + 12 + pat[k], eighth, (0.35 + 0.45 * ten) * accents[k] * (c.thrashing ? 1.15 : 1), { dest: this.fightBus, lp, pan: -0.15 });
      }
      // low pulse on beats 1 and 3
      note(e, 'bass', F.nextBar, root, F.beat, 0.6 + 0.3 * ten, { dest: this.fightBus });
      note(e, 'bass', F.nextBar + 2 * F.beat, root + 7, F.beat, 0.45 + 0.3 * ten, { dest: this.fightBus });
      // reed drone swells with the strain
      if (ten > 0.25) for (const iv of [12, 19]) note(e, 'harmonium', F.nextBar, root + iv, 4 * F.beat, 0.25 + 0.6 * ten, { dest: this.fightBus });
      // high tremolo once it really pulls
      if (ten > 0.6 || c.thrashing) for (let k = 0; k < 8; k++) note(e, 'mandolin', F.nextBar + k * eighth, F.tonic + 12 + sc[(deg + 4) % 7], 0.12, 0.25 + 0.3 * ten, { dest: this.fightBus, pan: 0.25 });
      F.nextBar += 4 * F.beat;
      F.bar++;
    }
  }

  private stopFight(resolved: boolean) {
    const e = this.e;
    this.fightBus.gain.cancelScheduledValues(e.now);
    this.fightBus.gain.setValueAtTime(this.fightBus.gain.value, e.now);
    this.fightBus.gain.linearRampToValueAtTime(0, e.now + (resolved ? 0.25 : 1.2));
    // a fresh bus for the next fight (notes already scheduled on this one die with the fade)
    const old = this.fightBus;
    this.fightBus = e.ctx.createGain();
    this.fightBus.gain.value = 0;
    this.fightBus.connect(e.buses.music);
    if (e.ctx instanceof AudioContext) setTimeout(() => { try { old.disconnect(); } catch { /* ignore */ } }, 3000);
    this.fight = null;
    if (this.state === 'fight') { this.state = 'rest'; this.nextAt = Math.max(this.nextAt, e.now + 25); }
    e.log('music.fightEnd', resolved ? 'resolved' : 'faded');
  }

  /** The catch: the tension resolves into a cadence. big = rare species or a first catch. */
  resolve(big: boolean) {
    const e = this.e;
    const F = this.fight;
    const tonic = F?.tonic ?? this.lastTonic, mode = F?.mode ?? 'major';
    if (F) this.stopFight(true);
    const sc = SCALES[mode];
    const t = e.now + 0.05;
    const dest = e.ctx.createGain(); // its own sub-mix: never revives tails of a faded piece
    dest.connect(e.buses.music);
    // V (or IV for a plagal "amen" on the big ones) → I
    const pre = big ? 3 : 4;
    const tri = (d: number) => [0, 2, 4].map((k) => tonic + sc[(d + k) % 7] + 12 * Math.floor((d + k) / 7));
    for (const m of tri(pre)) note(e, 'harmonium', t, m - 12, 0.45, 0.6, { dest });
    const I = tri(0);
    const arp = big ? [I[0] - 12, I[1] - 12, I[2] - 12, I[0], I[1], I[2], I[0] + 12] : [I[0] - 12, I[1] - 12, I[2] - 12, I[0]];
    arp.forEach((m, i) => note(e, 'harp', t + 0.42 + i * 0.075, m, 2.5, 0.75, { dest, pan: -0.3 + i * 0.1 }));
    for (const m of I) note(e, 'harmonium', t + 0.42, m - 12, big ? 2.6 : 1.6, 0.55, { dest });
    note(e, 'bass', t + 0.42, tonic - 24, 1.5, 0.7, { dest });
    // (the catch chime itself is an SFX — sfx.chime — so it still rings with the music off)
    this.state = 'resolve';
    this.resolveUntil = e.now + (big ? 4 : 2.5);
    // after a catch, music may come back a little sooner
    this.nextAt = Math.min(Math.max(this.nextAt, e.now + 25), e.now + 70);
    e.log('music.resolve', big ? 'big' : 'small');
  }

  /** Debug: force the next piece now. */
  force(v: Variant) { if (this.state === 'piece') this.endPiece(0.3); this.startPiece(v); }
}
