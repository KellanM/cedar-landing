/**
 * Harmonic engine (pure, deterministic): a modal chord field walked with smooth voice-leading.
 * See docs/music_study.md §1–2, 5. Four upper voices + a bass. Each change moves at most
 * `maxMove` voices (by ≤ 4 semitones); held voices keep sounding (the score merges them into one
 * long note), which is the "evolving chord" — one or two inner voices stepping over a pedal.
 */
import type { Rng } from './dsp';

export const MODE_STEPS = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const;
export type ModeName = keyof typeof MODE_STEPS;

export type ChordKind = 'triad' | 'sus2' | 'sus4' | 'add9' | 'seventh' | 'five';
export interface Chord { deg: number; kind: ChordKind; pcs: number[]; name: string }
export interface Step { chord: Chord; upper: number[]; bass: number; pedal: boolean; dur: number; moved: number; bars: number }

const PC = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const KIND_DEGS: Record<ChordKind, number[]> = { triad: [0, 2, 4], sus2: [0, 1, 4], sus4: [0, 3, 4], add9: [0, 1, 2, 4], seventh: [0, 2, 4, 6], five: [0, 4] };
const KIND_SUFFIX: Record<ChordKind, (minor: boolean) => string> = {
  triad: (m) => (m ? 'm' : ''), sus2: () => 'sus2', sus4: () => 'sus4', add9: (m) => (m ? 'm(add9)' : 'add9'), seventh: (m) => (m ? 'm7' : 'maj7'), five: () => '5',
};

/** Characteristic chords per mode (scale degree → weight boost): the colour that names the mode. */
const COLOUR: Record<ModeName, Record<number, number>> = {
  ionian: { 3: 1.3, 5: 1.1 },
  lydian: { 1: 1.9, 4: 1.2 }, // II major (holds the ♯4)
  mixolydian: { 6: 1.9, 3: 1.2 }, // ♭VII
  dorian: { 3: 1.9, 6: 1.2 }, // IV major (holds the ♮6)
  aeolian: { 5: 1.7, 6: 1.5, 3: 1.1 }, // ♭VI, ♭VII
  phrygian: { 1: 1.8, 6: 1.2 }, // ♭II
};

export interface FieldOpts {
  tonic: number; // midi of the tonic (pc + octave, e.g. 50 = D3)
  mode: ModeName;
  /** centre of the upper voices (midi) */
  center: number;
  maxMove: number;
  /** min / max chord length in bars */
  barsMin: number;
  barsMax: number;
  barSec: number;
  /** allow semitone clusters between adjacent voices (storm) */
  clusters?: boolean;
  /** chance per change of a same-root colour move */
  colourBias?: number;
}

export class ChordField {
  readonly o: FieldOpts;
  private sc: readonly number[];
  private upper: number[] = [];
  private cur: Chord | null = null;
  private sinceTonic = 0;
  private pedalLeft = 0;
  private bassNow = 0;
  private n = 0;
  private sameRun = 0;
  constructor(o: FieldOpts, private r: Rng) {
    this.o = o;
    this.sc = MODE_STEPS[o.mode];
    this.bassNow = this.bassPitch(0);
  }

  pcOf(step: number) { return (this.o.tonic + this.sc[((step % 7) + 7) % 7]) % 12; }
  /** midi of a scale step (0 = tonic) relative to the tonic octave */
  pitch(step: number) { return this.o.tonic + this.sc[((step % 7) + 7) % 7] + 12 * Math.floor(step / 7); }

  chord(deg: number, kind: ChordKind): Chord | null {
    const steps = KIND_DEGS[kind].map((k) => deg + k);
    const rel = steps.map((s) => this.sc[((s % 7) + 7) % 7] + 12 * Math.floor(s / 7) - this.sc[deg % 7]);
    // perfect fifth required (no diminished / augmented); sus2 = M2, sus4 = P4
    if (rel[KIND_DEGS[kind].indexOf(4)] !== 7) return null;
    if (kind === 'sus2' && rel[1] !== 2) return null;
    if (kind === 'sus4' && rel[1] !== 5) return null;
    if (kind === 'add9' && rel[1] !== 2) return null;
    if (kind === 'seventh' && rel[3] !== 10 && rel[3] !== 11) return null;
    const minor = rel.includes(3);
    const pcs = steps.map((s) => this.pcOf(s));
    const suffix = kind === 'seventh' && !minor && rel[3] === 10 ? '7' : KIND_SUFFIX[kind](minor);
    return { deg, kind, pcs, name: PC[this.pcOf(deg)] + suffix };
  }

  /** Best voicing of `pcs` from the current upper voices (min motion), or null if none obeys the rules. */
  private voice(pcs: number[], maxMove: number): { v: number[]; cost: number; moved: number } | null {
    const prev = this.upper;
    const opts = prev.map((p) => {
      const out: number[] = [];
      for (let d = -4; d <= 4; d++) if (pcs.includes((((p + d) % 12) + 12) % 12)) out.push(p + d);
      return out;
    });
    let best: { v: number[]; cost: number; moved: number } | null = null;
    const cur: number[] = [];
    const minGap = this.o.clusters ? 1 : 2;
    const rec = (i: number) => {
      if (i === prev.length) {
        let moved = 0, cost = 0;
        for (let k = 0; k < cur.length; k++) { const d = Math.abs(cur[k] - prev[k]); if (d) moved++; cost += d; }
        if (moved === 0 || moved > maxMove) return;
        for (let k = 1; k < cur.length; k++) { const g = cur[k] - cur[k - 1]; if (g < minGap || g > 12) return; }
        const cov = new Set(cur.map((x) => x % 12));
        const need = pcs.length >= 4 ? 3 : pcs.length;
        let have = 0;
        for (const pc of pcs) if (cov.has(pc)) have++;
        if (have < Math.min(need, cur.length)) return;
        // keep the colour tone (2nd / 4th / 7th) if the chord has one
        if (pcs.length >= 3 && !cov.has(pcs[1])) cost += 2;
        const mean = cur.reduce((a, b) => a + b, 0) / cur.length;
        cost += Math.abs(mean - this.o.center) * 0.35 + Math.max(0, moved - 1) * 0.8;
        if (!best || cost < best.cost) best = { v: cur.slice(), cost, moved };
        return;
      }
      for (const p of opts[i]) { cur.push(p); rec(i + 1); cur.pop(); }
    };
    rec(0);
    return best;
  }

  private bassPitch(deg: number) {
    // bass register: tonic around D2–A2 (38–45), walks stay within a 4th of it
    let b = this.o.tonic - 12;
    while (b > 45) b -= 12;
    while (b < 36) b += 12;
    let p = b + this.sc[((deg % 7) + 7) % 7];
    if (p > b + 6) p -= 12;
    return p;
  }

  /** First chord: tonic, open (sus2 or add9 or five), voiced close around the centre. */
  start(kind: ChordKind = 'sus2'): Step {
    const c = this.chord(0, kind) ?? this.chord(0, 'five')!;
    const pcs = c.pcs;
    const v: number[] = [];
    let p = this.o.center - 7;
    for (let i = 0; i < 4; i++) {
      const pc = pcs[[0, 1, 2, 0][i] % pcs.length];
      while (((p % 12) + 12) % 12 !== pc || (v.length && p - v[v.length - 1] < 2)) p++;
      v.push(p);
      p += 2;
    }
    this.upper = v;
    this.cur = c;
    this.pedalLeft = 2 + Math.floor(this.r() * 3);
    this.bassNow = this.bassPitch(0);
    return { chord: c, upper: v.slice(), bass: this.bassNow, pedal: true, dur: this.len(), moved: 4, bars: 0 };
  }

  private len() {
    const o = this.o;
    let bars = o.barsMin + Math.floor(this.r() * (o.barsMax - o.barsMin + 1));
    if (this.n % 5 === 4) bars = Math.round(bars * 1.4); // a breath every few chords
    return bars * o.barSec;
  }

  /** Next chord. `home` > 0 pulls toward the tonic (cue ending). */
  next(home = 0): Step {
    this.n++;
    const o = this.o, r = this.r;
    const kinds: ChordKind[] = ['triad', 'sus2', 'sus4', 'add9', 'seventh'];
    const cands: { c: Chord; w: number; v: number[]; moved: number }[] = [];
    const cur = this.cur!;
    for (let deg = 0; deg < 7; deg++) {
      const dr = ((deg - cur.deg) % 7 + 7) % 7;
      // root motion weights: same root (colour) > 4th/5th > step > 3rd
      // (a third colour change on one root in a row is rare: the field has to breathe out too)
      let wRoot = dr === 0 ? 1.15 * (o.colourBias ?? 1) * (this.sameRun >= 2 ? 0.2 : 1) : dr === 3 || dr === 4 ? 1.0 : dr === 1 || dr === 6 ? 0.85 : 0.7;
      wRoot *= COLOUR[o.mode][deg] ?? 1;
      if (deg === 0) wRoot *= (cur.deg === 0 ? 1 : 1 + 0.15 * this.sinceTonic) + 3 * home;
      else wRoot *= 1 / (1 + 2 * home);
      // the leading-tone chord and diminished stuff never appear (no V–I with a leading tone)
      for (const kind of kinds) {
        const c = this.chord(deg, kind);
        if (!c) continue;
        if (c.deg === cur.deg && c.kind === cur.kind) continue;
        // a major V in Ionian/Lydian has the leading tone; keep it rare and only as sus4
        if (deg === 4 && (o.mode === 'ionian' || o.mode === 'lydian') && kind !== 'sus4' && kind !== 'sus2') continue;
        const vv = this.voice(c.pcs, o.maxMove);
        if (!vv) continue;
        const wk = kind === 'triad' ? 1 : kind === 'sus2' || kind === 'add9' ? 1.15 : kind === 'sus4' ? 0.9 : 0.8;
        cands.push({ c, w: wRoot * wk * Math.exp(-vv.cost / 2.2), v: vv.v, moved: vv.moved });
      }
    }
    let pick = cands[0];
    if (cands.length) {
      const tot = cands.reduce((a, x) => a + x.w, 0);
      let u = r() * tot;
      for (const x of cands) { u -= x.w; if (u <= 0) { pick = x; break; } }
    }
    if (!pick) return this.start();
    this.sameRun = pick.c.deg === cur.deg ? this.sameRun + 1 : 0;
    this.upper = pick.v;
    this.cur = pick.c;
    this.sinceTonic = pick.c.deg === 0 ? 0 : this.sinceTonic + 1;
    // bass: hold the tonic pedal for a while, then walk to chord roots, come back
    let pedal = this.pedalLeft > 0;
    if (pedal) {
      this.pedalLeft--;
      // a ♭2 against the pedal is too sour outside the storm
      if (!o.clusters && pick.c.pcs.includes((o.tonic + 1) % 12)) pedal = false;
      this.bassNow = pedal ? this.bassPitch(0) : this.bassPitch(pick.c.deg);
    } else {
      this.bassNow = this.bassPitch(pick.c.deg);
      if (pick.c.deg === 0 && r() < 0.6) this.pedalLeft = 1 + Math.floor(r() * 3);
    }
    if (home > 0.5) { this.bassNow = this.bassPitch(0); pedal = true; }
    return { chord: pick.c, upper: pick.v.slice(), bass: this.bassNow, pedal, dur: this.len(), moved: pick.moved, bars: 0 };
  }

  /** Force the last chord to the tonic (open: sus2 / add9 / five), minimal motion. */
  close(): Step {
    for (const kind of ['add9', 'sus2', 'triad', 'five'] as ChordKind[]) {
      const c = this.chord(0, kind);
      if (!c) continue;
      const vv = this.voice(c.pcs, 3) ?? this.voice(c.pcs, 4);
      if (!vv) continue;
      this.upper = vv.v; this.cur = c; this.bassNow = this.bassPitch(0);
      return { chord: c, upper: vv.v.slice(), bass: this.bassNow, pedal: true, dur: this.len() * 1.4, moved: vv.moved, bars: 0 };
    }
    return { chord: this.cur!, upper: this.upper.slice(), bass: this.bassPitch(0), pedal: true, dur: this.len() * 1.4, moved: 0, bars: 0 };
  }
}

/** The Cedar Landing motif: scale steps from the tonic and lengths in beats (original; docs/music_study.md). */
export const MOTIF = { steps: [2, 4, 8, 7, 5, 4], beats: [1, 1, 2.5, 0.5, 1.5, 3] };

/**
 * A short melodic fragment over a chord: 3–7 notes, long values, mostly stepwise with one leap,
 * starting on a chord tone and ending open (on a chord tone that isn't the root when possible).
 * Returns scale steps + beat lengths.
 */
export function fragment(f: ChordField, chord: Chord, lo: number, hi: number, r: Rng, startNear?: number): { steps: number[]; beats: number[] } {
  const n = 3 + Math.floor(r() * 5);
  const chordStep = (s: number) => chord.pcs.includes(f.pcOf(s));
  const inRange = (s: number) => { const p = f.pitch(s); return p >= lo && p <= hi; };
  let s = startNear ?? Math.round(((lo + hi) / 2 - f.o.tonic) / 12 * 7);
  for (let k = 0; k < 8 && !(chordStep(s) && inRange(s)); k++) s += k % 2 ? -k : k;
  const steps = [s];
  const dir0 = r() < 0.55 ? 1 : -1;
  let leapUsed = false;
  for (let i = 1; i < n; i++) {
    let d = (i < n / 2 ? dir0 : -dir0) * (r() < 0.75 ? 1 : 2);
    if (!leapUsed && r() < 0.25) { d = dir0 * 3 + (r() < 0.5 ? 0 : dir0); leapUsed = true; }
    let t = steps[i - 1] + d;
    if (!inRange(t)) t = steps[i - 1] - d;
    if (!inRange(t)) t = steps[i - 1];
    steps.push(t);
  }
  // open ending: nearest chord tone, prefer not the root
  let last = steps[n - 1];
  for (let k = 0; k < 6; k++) {
    const c = [last + k, last - k].find((x) => chordStep(x) && inRange(x) && f.pcOf(x) !== chord.pcs[0]);
    if (c !== undefined) { last = c; break; }
  }
  steps[n - 1] = last;
  const beatsPool = [1, 1.5, 2, 1, 0.5, 3];
  const beats = steps.map((_, i) => (i === n - 1 ? 3 + Math.floor(r() * 2) : beatsPool[Math.floor(r() * beatsPool.length)]));
  return { steps, beats };
}

export const pcName = (midi: number) => PC[((midi % 12) + 12) % 12];
