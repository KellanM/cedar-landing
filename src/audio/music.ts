/**
 * Adaptive score: evolving chord fields (docs/music_study.md), in cues of ≈ 2–3 min separated by
 * long rests filled by ambience; a fishing-fight tension layer that follows the line; a resolving
 * cadence on the catch; a title swell timed to the sepia → colour bloom.
 *
 * A cue is composed whole (pure: same seed → same cue) by walking a modal chord field
 * (harmony.ts) with smooth voice-leading: ≤ 2 voices move per change, held voices are not
 * re-struck, a tonic pedal comes and goes, chords last 6–18 s by mood. Over it: sparse melodic
 * fragments with silence between, sometimes the Cedar Landing motif.
 *
 * Every cue carries all of its layers — bed (strings + low strings), choir, melody, harp, folk
 * (town: guitar, accordion, fiddle), wood (village: log taps on incommensurate cycles, wooden
 * flute), perc (storm timpani) — and the director crossfades layer gains from the live context
 * (place, weather, time), A Short Hike style: sailing into Cedar Landing blooms the folk layer in
 * without restarting anything; rain takes layers away rather than adding a piece.
 */
import { rng, type Rng } from './dsp';
import { AUDIO_TUNING, type AudioEngine } from './engine';
import { ChordField, MODE_STEPS, MOTIF, fragment, pcName, type ChordKind, type ModeName, type Step } from './harmony';
import { note, type Inst } from './instruments';
import { setBrightness } from './pads';

export type Variant = 'day' | 'night' | 'dusk' | 'town' | 'dawn' | 'village' | 'rain' | 'storm' | 'cove' | 'fog' | 'title';
export type MusicState = 'off' | 'rest' | 'piece' | 'fight' | 'resolve';
export type Layer = 'bed' | 'choir' | 'mel' | 'arp' | 'folk' | 'wood' | 'perc';
export type Guise = 'title' | 'landing' | 'firstfish' | 'gran' | 'sea';
const LAYERS: readonly Layer[] = ['bed', 'choir', 'mel', 'arp', 'folk', 'wood', 'perc'];

export interface Ev { t: number; inst: Inst; midi: number; dur: number; vel: number; pan?: number; wet?: number; layer?: Layer }
export interface Piece {
  variant: Variant; seed: number; tonic: number; mode: ModeName | 'major' | 'dorian' | 'mixolydian'; bpm: number; meter: 4 | 6 | 3; bars: number; length: number;
  events: Ev[]; lead: Inst; form: string; chart: string[]; motif: Guise | null;
}

interface Mood {
  modes: ModeName[]; bpm: [number, number]; bars: [number, number]; center: number; len: [number, number];
  frags: [number, number]; leads: Inst[]; choir: [number, number] | null; arpEvery: number; voices: 3 | 4;
  motif: number; storm?: boolean; folk: number; wood: number; colour?: number;
}
const MOODS: Record<Exclude<Variant, 'title'>, Mood> = {
  dawn: { modes: ['lydian'], bpm: [64, 70], bars: [3, 5], center: 64, len: [120, 160], frags: [2, 4], leads: ['flute', 'violin', 'harp'], choir: [0.3, 0.8], arpEvery: 2, voices: 4, motif: 0.25, folk: 1, wood: 1 },
  day: { modes: ['dorian', 'mixolydian', 'dorian', 'ionian'], bpm: [66, 74], bars: [3, 4], center: 62, len: [110, 160], frags: [3, 5], leads: ['violin', 'celesta', 'flute', 'harp'], choir: [0.35, 0.75], arpEvery: 3, voices: 4, motif: 0.25, folk: 1, wood: 1 },
  town: { modes: ['mixolydian', 'ionian', 'dorian'], bpm: [78, 86], bars: [3, 4], center: 62, len: [100, 140], frags: [2, 4], leads: ['fiddle', 'violin'], choir: [0.4, 0.6], arpEvery: 4, voices: 4, motif: 0.35, folk: 1, wood: 0.8 },
  village: { modes: ['dorian', 'mixolydian'], bpm: [68, 74], bars: [3, 4], center: 60, len: [110, 150], frags: [3, 5], leads: ['flute'], choir: null, arpEvery: 0, voices: 3, motif: 0.15, folk: 0.7, wood: 1 },
  cove: { modes: ['lydian', 'ionian'], bpm: [62, 68], bars: [3, 5], center: 62, len: [110, 150], frags: [2, 3], leads: ['harp', 'celesta', 'violin'], choir: [0.4, 0.7], arpEvery: 1, voices: 4, motif: 0.8, folk: 0.8, wood: 0.8 },
  dusk: { modes: ['aeolian', 'dorian', 'aeolian'], bpm: [60, 66], bars: [4, 5], center: 60, len: [120, 170], frags: [2, 4], leads: ['violin', 'harp', 'vibes'], choir: [0.2, 0.9], arpEvery: 3, voices: 4, motif: 0.2, folk: 0.8, wood: 0.8 },
  night: { modes: ['aeolian', 'dorian'], bpm: [56, 62], bars: [4, 6], center: 65, len: [120, 170], frags: [1, 3], leads: ['celesta', 'harp', 'vibes'], choir: [0.4, 0.7], arpEvery: 4, voices: 3, motif: 0.15, folk: 0.5, wood: 0.6, colour: 1.5 },
  fog: { modes: ['dorian', 'aeolian'], bpm: [56, 60], bars: [4, 6], center: 58, len: [100, 140], frags: [0, 1], leads: ['flute'], choir: [0.2, 0.6], arpEvery: 0, voices: 3, motif: 0, folk: 0.4, wood: 0.5, colour: 1.6 },
  rain: { modes: ['dorian', 'aeolian'], bpm: [58, 64], bars: [3, 5], center: 56, len: [110, 150], frags: [1, 2], leads: ['harp', 'celesta'], choir: null, arpEvery: 3, voices: 3, motif: 0.1, folk: 0.6, wood: 0.6, colour: 1.3 },
  storm: { modes: ['aeolian', 'phrygian'], bpm: [60, 66], bars: [4, 5], center: 54, len: [90, 130], frags: [0, 0], leads: ['violin'], choir: [0.3, 0.7], arpEvery: 0, voices: 4, motif: 0, storm: true, folk: 0, wood: 0 },
};
const RANGE: Partial<Record<Inst, [number, number]>> = { violin: [64, 81], flute: [67, 84], celesta: [72, 88], harp: [60, 79], fiddle: [64, 81], vibes: [62, 79] };

const pick = <T>(r: Rng, a: readonly T[]) => a[Math.floor(r() * a.length)];

/** Merges consecutive equal pitches per voice into one long note (common tones are held, not re-struck). */
class Holder {
  private open = new Map<string, { t0: number; midi: number; vel: number }>();
  constructor(private ev: Ev[], private inst: Inst, private layer: Layer, private pan: (k: string) => number = () => 0) {}
  set(k: string, midi: number | null, t: number, vel: number) {
    const o = this.open.get(k);
    if (o && o.midi === midi) return;
    if (o) { this.ev.push({ t: o.t0, inst: this.inst, midi: o.midi, dur: t - o.t0, vel: o.vel, layer: this.layer, pan: this.pan(k) }); this.open.delete(k); }
    if (midi !== null) this.open.set(k, { t0: t, midi, vel });
  }
  closeAll(t: number) { for (const k of [...this.open.keys()]) this.set(k, null, t, 0); }
}

/** Compose a whole cue as a timed event list (pure: same seed + opts → same cue). */
export function compose(variant: Variant, seed: number, opt: { tonic?: number; mode?: ModeName; motif?: Guise | null } = {}): Piece {
  if (variant === 'title') return composeTitle(seed);
  const r = rng(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ (seed << 13));
  for (let i = 0; i < 4; i++) r();
  const M = MOODS[variant];
  const mode = opt.mode ?? pick(r, M.modes);
  // tonic around middle C: D, A, C, F, G, E (Piece.tonic sits in the 57–65 octave like v0.9)
  const tonic = opt.tonic ?? 60 + pick(r, [2, -3, 0, 5, -5, 4]);
  const bpm = M.bpm[0] + r() * (M.bpm[1] - M.bpm[0]);
  const beat = 60 / bpm, barSec = 3 * beat;
  const field = new ChordField({ tonic: tonic - 12, mode, center: M.center, maxMove: 2, barsMin: M.bars[0], barsMax: M.bars[1], barSec, clusters: !!M.storm, colourBias: M.colour }, r);
  const target = M.len[0] + r() * (M.len[1] - M.len[0]);
  // ---- chord path
  type TS = Step & { t: number };
  const steps: TS[] = [];
  let t = 0.6;
  let s = field.start(pick(r, ['sus2', 'add9', 'five', 'sus2'] as ChordKind[]));
  for (let guard = 0; guard < 60; guard++) {
    steps.push({ ...s, t });
    t += s.dur;
    if (t > target - 22) break;
    const home = t > target * 0.72 ? (t - target * 0.72) / (target * 0.28) : 0;
    s = field.next(home);
    if (M.storm) s = { ...s, bass: steps[0].bass, pedal: true };
  }
  const last = field.close();
  steps.push({ ...last, t });
  const end = t + last.dur;
  const length = end + 6.5;
  const n = steps.length;
  const ev: Ev[] = [];
  // dynamic arc over the cue: pp → a swell past the middle → pp (Soule cues span ~15–20 dB p10–p90)
  const arc = (x: number) => 0.32 + 0.68 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, x * 0.95 + 0.02))), 1.3);
  const hum = (v: number) => Math.max(0.05, v * (0.92 + r() * 0.16));

  // ---- bed: strings (upper voices) + low strings (bass, + the fifth over a pedal)
  const strPan = (k: string) => [-0.35, -0.12, 0.12, 0.35][+k] ?? 0;
  const strings = new Holder(ev, 'strings', 'bed', strPan);
  const low = new Holder(ev, 'lowstr', 'bed', (k) => (k === 'b' ? 0 : 0.15));
  const choir = new Holder(ev, 'choir', 'choir', (k) => (k === '0' ? -0.25 : 0.25));
  const accordion = new Holder(ev, 'accordion', 'folk', () => 0.2);
  const diatonic = new Set([0, 1, 2, 3, 4, 5, 6].map((k) => field.pcOf(k)));
  let cells = 0;
  for (let i = 0; i < n; i++) {
    const st = steps[i], u = st.t / end;
    const v = arc(u) * (variant === 'night' || variant === 'fog' ? 0.75 : 1);
    const up = M.voices === 3 ? st.upper.slice(1) : st.upper;
    for (let k = 0; k < 4; k++) strings.set(String(k), k < up.length ? up[k] : null, st.t, hum(0.8 * v));
    low.set('b', st.bass, st.t, hum(0.85 * v));
    low.set('5', st.pedal && variant !== 'night' ? st.bass + 7 : null, st.t, hum(0.4 * v));
    // choir: the top two voices, in the middle of the cue
    const sing = M.choir && u >= M.choir[0] && u <= M.choir[1];
    choir.set('0', sing ? st.upper[st.upper.length - 2] : null, st.t, hum(0.75 * v));
    choir.set('1', sing ? st.upper[st.upper.length - 1] : null, st.t, hum(0.75 * v));
    // town: the accordion breathes the middle of the chord (quiet)
    if (M.folk) for (let k = 0; k < 3; k++) accordion.set(String(k), st.upper[k + 1] ?? null, st.t, hum(0.22 * M.folk));
    // inner cell: partway through a long chord one inner voice turns the colour (3↔4, 9↔8 / 3, 5↔6)
    // and usually turns back — the chord "breathes" without the root moving (docs/music_study.md §1)
    if (st.dur > 7 && i < n - 1 && r() < 0.8) {
      const rootPc = st.chord.pcs[0], fifthPc = (rootPc + 7) % 12;
      const js = [1, 2, 3].filter((j) => j < st.upper.length && st.upper[j] % 12 !== rootPc);
      const j = js.length ? pick(r, js) : -1;
      if (j >= 0) {
        const p0 = st.upper[j];
        const opts = [-2, -1, 1, 2].map((d) => p0 + d).filter((q) => diatonic.has(((q % 12) + 12) % 12) && q % 12 !== fifthPc && q % 12 !== rootPc
          && !st.upper.some((x, xi) => xi !== j && Math.abs(x - q) < 2) && (p0 % 12 !== fifthPc || Math.abs(q - p0) <= 2));
        if (opts.length) {
          const q = pick(r, opts);
          const t1 = st.t + Math.round((st.dur * (0.4 + 0.2 * r())) / barSec) * barSec;
          const back = r() < 0.6 && st.dur > 10;
          const t2 = st.t + Math.round((st.dur * 0.8) / barSec) * barSec;
          const sk = M.voices === 3 ? j - 1 : j;
          if (sk >= 0) { strings.set(String(sk), q, t1, hum(0.8 * v)); if (back && t2 > t1 + barSec) strings.set(String(sk), p0, t2, hum(0.8 * v)); }
          const ck = j === st.upper.length - 2 ? '0' : j === st.upper.length - 1 ? '1' : '';
          if (ck && sing) { choir.set(ck, q, t1, hum(0.75 * v)); if (back && t2 > t1 + barSec) choir.set(ck, p0, t2, hum(0.75 * v)); }
          cells++;
        }
      }
    }
  }
  strings.closeAll(end); low.closeAll(end); choir.closeAll(end); accordion.closeAll(end);

  // ---- harp: slow broken chords (dawn and cove often), a far bell at the end
  if (M.arpEvery) {
    for (let i = 0; i < n; i += M.arpEvery) {
      const st = steps[i];
      const notes = [st.bass + 12 < 45 ? st.bass + 24 : st.bass + 12, ...st.upper, st.upper[st.upper.length - 2] + 12];
      notes.forEach((m, k) => ev.push({ t: st.t + 0.3 + k * beat * 0.5, inst: 'harp', midi: m, dur: 3, vel: hum(0.42 - k * 0.02), pan: -0.3 + k * 0.1, layer: 'arp' }));
    }
  }
  if (!M.storm && r() < 0.4) ev.push({ t: steps[n - 1].t + 1, inst: 'bell', midi: tonic + 12, dur: 5, vel: 0.28, wet: 0.7, layer: 'arp' });

  // ---- melody fragments: not on adjacent chords, never the first or the last; silence between
  const lead = pick(r, M.leads);
  const nFr = M.frags[0] + Math.floor(r() * (M.frags[1] - M.frags[0] + 1));
  const slots: number[] = [];
  for (let tries = 0; slots.length < nFr && tries < 40; tries++) {
    const i = 1 + Math.floor(r() * Math.max(1, n - 2));
    if (i >= n - 1 || slots.some((x) => Math.abs(x - i) < 2)) continue;
    slots.push(i);
  }
  slots.sort((a, b) => a - b);
  const motif = opt.motif !== undefined ? opt.motif : r() < M.motif ? (variant === 'cove' ? 'gran' : variant === 'town' ? 'landing' : 'sea') : null;
  const writeLine = (inst: Inst, layer: Layer, t0: number, stepsL: number[], beats: number[], vel: number, stretch = 1) => {
    let tt = t0;
    stepsL.forEach((sp, k) => {
      const d = beats[k] * beat * stretch;
      ev.push({ t: tt, inst, midi: field.pitch(sp) + 12 * octFor(inst, field, stepsL), dur: d * (inst === 'violin' || inst === 'flute' || inst === 'fiddle' ? 1.03 : 1), vel: hum(vel * (k === stepsL.length - 1 ? 0.9 : 1)), pan: 0.18, layer });
      tt += d;
    });
    return tt;
  };
  let motifDone = false;
  slots.forEach((i) => {
    const st = steps[i];
    const inst = r() < 0.75 ? lead : pick(r, M.leads);
    const t0 = st.t + barSec * (0.5 + Math.floor(r() * 2) * 0.5);
    if (motif && !motifDone && motif !== 'landing') {
      motifDone = true;
      writeLine(motif === 'gran' ? 'harp' : inst, 'mel', t0, MOTIF.steps, MOTIF.beats, 0.75, motif === 'gran' ? 1.5 : 1.15);
      return;
    }
    const rg = RANGE[inst] ?? [62, 79];
    const fr = fragment(field, st.chord, rg[0] - 12, rg[1] - 12, r);
    writeLine(inst, 'mel', t0, fr.steps, fr.beats, inst === 'celesta' || inst === 'harp' ? 0.6 : 0.7, 1);
  });

  // ---- folk (town layer): fingerpicked guitar in 3/4, fiddle phrases; the landing guise opens it
  if (M.folk) {
    for (let i = 0; i < n; i++) {
      const st = steps[i];
      const bars = Math.max(1, Math.round(st.dur / barSec));
      const lowG = st.bass + 12 < 40 ? st.bass + 24 : st.bass + 12;
      const up = st.upper;
      for (let b = 0; b < bars; b++) {
        const tb = st.t + b * barSec;
        if (tb > end - 0.5) break;
        const night = variant === 'night' || variant === 'fog';
        ev.push({ t: tb, inst: 'guitar', midi: lowG, dur: beat * 2, vel: hum(0.5 * M.folk), pan: -0.3, layer: 'folk' });
        if (!night) ev.push({ t: tb + beat, inst: 'guitar', midi: up[1] < 52 ? up[1] + 12 : up[1], dur: beat, vel: hum(0.36 * M.folk), pan: -0.3, layer: 'folk' });
        ev.push({ t: tb + beat * 2, inst: 'guitar', midi: up[2] < 52 ? up[2] + 12 : up[2], dur: beat, vel: hum(0.34 * M.folk), pan: -0.3, layer: 'folk' });
        if (!night && b % 2 === 1) ev.push({ t: tb + beat * 2.5, inst: 'guitar', midi: up[3] < 52 ? up[3] + 12 : up[3], dur: beat, vel: hum(0.3 * M.folk), pan: -0.3, layer: 'folk' });
      }
    }
    // fiddle: the landing guise on chord 1, then short phrases on chords without a melody slot
    let fid = 0;
    for (let i = 1; i < n - 1; i++) {
      const st = steps[i];
      if (slots.includes(i) || slots.includes(i - 1)) continue;
      if (motif === 'landing' && fid === 0) { writeLine('fiddle', 'folk', st.t + barSec, MOTIF.steps.slice(0, 4), [1, 1, 2, 2], 0.7); fid++; continue; }
      if (r() > 0.5 || fid > 3) continue;
      const fr = fragment(field, st.chord, 52, 69, r);
      writeLine('fiddle', 'folk', st.t + barSec * (0.5 + 0.5 * Math.floor(r() * 2)), fr.steps, fr.beats.map((b) => Math.max(0.5, Math.round(b * 0.6 * 2) / 2)), 0.62);
      fid++;
    }
  }

  // ---- wood (village layer): log taps on 7 / 11 / 13-eighth cycles (never re-align), wooden flute
  if (M.wood) {
    const eighth = beat / 2;
    const cycles = [7, 11, 13];
    for (let i = 0; i < n; i++) {
      const st = steps[i];
      const k0 = Math.ceil(st.t / eighth), k1 = Math.floor(Math.min(end, st.t + st.dur) / eighth);
      const pcs = st.chord.pcs;
      const near = (lo: number, which: number) => { const pc = pcs[which % pcs.length]; let m = lo; while (((m % 12) + 12) % 12 !== pc) m++; return m; };
      for (let k = k0; k < k1; k++) {
        cycles.forEach((c, ci) => {
          if (k % c !== 0) return;
          ev.push({ t: k * eighth, inst: 'log', midi: near([50, 57, 62][ci], ci === 0 ? 0 : ci === 1 ? 2 : 1), dur: 0.5, vel: hum((0.42 - ci * 0.06) * M.wood), pan: [-0.4, 0.1, 0.45][ci], layer: 'wood' });
        });
      }
      if (variant === 'village' || i % 3 !== 1 || slots.includes(i)) continue;
      const fr = fragment(field, st.chord, 55, 72, r);
      writeLine('flute', 'wood', st.t + barSec, fr.steps, fr.beats, 0.55);
    }
  }

  // ---- storm: timpani rolls arriving on each chord change
  if (M.storm) {
    for (let i = 1; i < n; i++) {
      const roll = Math.min(4, steps[i - 1].dur * 0.6);
      let m = steps[0].bass + 12; while (m > 52) m -= 12; while (m < 43) m += 12;
      ev.push({ t: steps[i].t - roll, inst: 'timp', midi: m, dur: roll, vel: hum(0.55 + 0.3 * arc(steps[i].t / end)), layer: 'perc' });
    }
  }

  ev.sort((a, b) => a.t - b.t);
  const chart = steps.map((x) => `${x.chord.name}${x.pedal && x.chord.pcs[0] !== ((tonic % 12) + 12) % 12 ? '/' + pcName(tonic) : ''}`);
  return { variant, seed, tonic, mode, bpm: Math.round(bpm), meter: 3, bars: Math.round(end / barSec), length, events: ev, lead, form: chart.join(' '), chart, motif };
}

/** Octave shift (in octaves) that puts a line's middle inside its instrument range. */
function octFor(inst: Inst, f: ChordField, steps: number[]) {
  const rg = RANGE[inst] ?? [62, 79];
  const mid = (Math.min(...steps.map((s) => f.pitch(s))) + Math.max(...steps.map((s) => f.pitch(s)))) / 2;
  const want = (rg[0] + rg[1]) / 2;
  return Math.round((want - mid) / 12);
}

/**
 * Title: the drawing is sepia, a suspended chord in the low strings; as the colour blooms (2.2 s)
 * it opens into the tonic add9 with choir and harp, the motif sings on solo violin, a Lydian II
 * passes over the pedal, and it settles. ≈ 24 s, D Lydian.
 */
function composeTitle(seed: number): Piece {
  const T = 50; // D3
  const ev: Ev[] = [];
  const beat = 0.78;
  const chords: { t: number; v: number[]; name: string }[] = [
    { t: 0, v: [7, 12, 17, 19], name: 'Dsus4' },
    { t: 2.4, v: [7, 14, 16, 19], name: 'Dadd9' },
    { t: 10.6, v: [8, 14, 18, 23], name: 'E/D' },
    { t: 14.2, v: [7, 14, 16, 21], name: 'Dadd9' },
  ];
  const end = 20.5;
  const strings = new Holder(ev, 'strings', 'bed', (k) => [-0.35, -0.12, 0.12, 0.35][+k]);
  chords.forEach((c, i) => c.v.forEach((x, k) => strings.set(String(k), T + x, c.t, i === 0 ? 0.55 : 0.9)));
  strings.closeAll(end);
  ev.push({ t: 0, inst: 'lowstr', midi: T - 12, dur: end, vel: 0.85, layer: 'bed' });
  ev.push({ t: 2.4, inst: 'lowstr', midi: T - 5, dur: end - 2.4, vel: 0.5, layer: 'bed' });
  const choir = new Holder(ev, 'choir', 'choir', (k) => (k === '0' ? -0.25 : 0.25));
  chords.slice(1).forEach((c) => { choir.set('0', T + c.v[2] + 12, c.t, 0.6); choir.set('1', T + c.v[3] + 12, c.t, 0.6); });
  choir.closeAll(end - 1);
  // harp blooms with the colour
  [T - 12 + 12, T + 7, T + 14, T + 16, T + 19, T + 26, T + 28].forEach((m, k) => ev.push({ t: 2.1 + k * 0.12, inst: 'harp', midi: m, dur: 3, vel: 0.5, pan: -0.35 + k * 0.1, layer: 'arp' }));
  // motif: solo violin (D Lydian from D4)
  const sc = MODE_STEPS.lydian;
  const p = (s: number) => 62 + sc[((s % 7) + 7) % 7] + 12 * Math.floor(s / 7);
  let t = 3.1;
  MOTIF.steps.forEach((s, k) => { const d = MOTIF.beats[k] * beat; ev.push({ t, inst: 'violin', midi: p(s), dur: d * 1.03, vel: k === 2 ? 0.85 : 0.72, pan: 0.15, layer: 'mel' }); t += d; });
  // harp echo of the high turn over the II chord, then a far bell
  [p(9), p(8), p(6)].forEach((m, k) => ev.push({ t: 11.0 + k * beat, inst: 'harp', midi: m, dur: 2.5, vel: 0.45, pan: 0.25, layer: 'arp' }));
  ev.push({ t: 14.4, inst: 'bell', midi: 74, dur: 5, vel: 0.22, wet: 0.7, layer: 'arp' });
  ev.sort((a, b) => a.t - b.t);
  return { variant: 'title', seed, tonic: 62, mode: 'lydian', bpm: Math.round(60 / beat), meter: 3, bars: 0, length: end + 6, events: ev, lead: 'violin', form: chords.map((c) => c.name).join(' '), chart: chords.map((c) => c.name), motif: 'title' };
}

// ------------------------------------------------------------------ director
export interface MusicContext {
  tod: string;
  /** 0..1 how much the listener is "in town" (harbour / docks) */
  town: number;
  fighting: boolean;
  tension: number;
  thrashing: boolean;
  /** clock hour 0..24 (dawn / day / dusk / night by the clock, not only the sky look) */
  hour?: number;
  /** 0..1 weights: the village, Keeper's Cove */
  village?: number;
  cove?: number;
  rain?: number;
  storm?: number;
}

interface Cue { piece: Piece; start: number; ptr: number; sub: GainNode; layers: Record<Layer, GainNode>; srcs: Set<AudioScheduledSourceNode> }

export class MusicDirector {
  state: MusicState = 'rest';
  piece: Piece | null = null;
  nextAt = 0;
  private cue: Cue | null = null;
  /** everything musical ends here */
  readonly out: GainNode;
  /** cues + the fight layer pass through here: ducked under dialogue and catch stings */
  private duckBus: GainNode;
  private fightBus: GainNode;
  private fight: { t0: number; nextBar: number; bar: number; tonic: number; mode: 'major' | 'dorian'; beat: number } | null = null;
  private seed = 1;
  lastVariant: Variant | null = null;
  history: string[] = [];
  private wasTown = 0;
  private resolveUntil = 0;
  lastTonic = 62;
  private lastMode: ModeName = 'dorian';
  private landing = false;
  private gains: Record<Layer, number> = { bed: 1, choir: 1, mel: 1, arp: 1, folk: 0, wood: 0, perc: 1 };
  private bright = 1;
  private duckUntil = 0;
  private ducked = false;
  /** last context seen (for debugging / state()) */
  ctx: MusicContext | null = null;

  constructor(private e: AudioEngine, firstDelay = 7) {
    this.out = e.ctx.createGain();
    this.out.connect(e.buses.music);
    this.duckBus = e.ctx.createGain();
    this.duckBus.connect(this.out);
    this.fightBus = e.ctx.createGain();
    this.fightBus.gain.value = 0;
    this.fightBus.connect(this.duckBus);
    this.nextAt = e.now + firstDelay;
    this.seed = (Date.now() % 100000) | 0;
  }

  /** Mood for the context: weather and the clock first, then place. */
  variantFor(c: MusicContext): Variant {
    const h = c.hour;
    if ((c.storm ?? 0) > 0.5) return 'storm';
    if (/fog/.test(c.tod)) return 'fog';
    const night = h !== undefined ? h >= 21.5 || h < 4.75 : /night/.test(c.tod);
    const dusk = h !== undefined ? h >= 18 && h < 21.5 : /dusk/.test(c.tod);
    const dawn = h !== undefined && h >= 4.75 && h < 8;
    if (night) return 'night';
    if (dusk) return 'dusk';
    if ((c.rain ?? 0) > 0.45) return 'rain';
    if (dawn) return 'dawn';
    if ((c.village ?? 0) > 0.55) return 'village';
    if (c.town > 0.55) return 'town';
    if ((c.cove ?? 0) > 0.55) return 'cove';
    return 'day';
  }

  /** Layer gains from the live context (crossfaded in update). */
  private targets(c: MusicContext, v: Variant): Record<Layer, number> {
    const rain = Math.min(1, c.rain ?? 0), town = Math.min(1, c.town), vil = Math.min(1, c.village ?? 0);
    const placeV = v === 'town' ? Math.max(town, 0.9) : v === 'village' ? 0 : town;
    const folk = Math.max(0, placeV - vil) * (1 - 0.4 * rain);
    const wood = v === 'village' ? 1 : vil;
    return {
      bed: 1 - 0.15 * rain,
      choir: (1 - 0.7 * folk - 0.5 * wood) * (1 - 0.8 * rain),
      mel: (1 - 0.45 * rain) * (1 - 0.5 * folk),
      arp: 1 - 0.3 * rain,
      folk,
      wood,
      perc: 1,
    };
  }

  private newCue(p: Piece, at: number): Cue {
    const c = this.e.ctx;
    const sub = c.createGain();
    // keep the bed's weight above ~100 Hz: phones can't play below it and the long tails turn to mud
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100; hp.Q.value = 0.6;
    sub.connect(hp).connect(this.duckBus);
    const layers = {} as Record<Layer, GainNode>;
    for (const l of LAYERS) { const g = c.createGain(); g.gain.value = this.gains[l]; g.connect(sub); layers[l] = g; }
    return { piece: p, start: at, ptr: 0, sub, layers, srcs: new Set() };
  }

  /** Start a piece now (also used by tests / debug). */
  startPiece(v: Variant, seed?: number, opt: { motif?: Guise | null } = {}) {
    const e = this.e;
    // key relation to the last cue: same tonic, a 4th / 5th away, or the relative
    const r = rng((seed ?? this.seed) * 977 + 3);
    const rel = this.history.length ? pick(r, [0, 0, 5, -5, 7, -7]) : undefined;
    let tonic = rel !== undefined ? this.lastTonic + rel : undefined;
    if (tonic !== undefined) { while (tonic > 65) tonic -= 12; while (tonic < 57) tonic += 12; }
    const motif = opt.motif !== undefined ? opt.motif : this.landing && v === 'town' ? 'landing' : undefined;
    this.landing = false;
    const p = compose(v, seed ?? this.seed++, { tonic, motif });
    if (this.cue) this.dropCue(0.3);
    this.cue = this.newCue(p, e.now + 0.15);
    if (this.ctx) this.applyGains(this.ctx, v, true);
    this.piece = p;
    this.state = 'piece';
    this.lastVariant = v;
    this.lastTonic = p.tonic;
    if (p.mode in MODE_STEPS) this.lastMode = p.mode as ModeName;
    this.history.push(`${v}:${p.mode}:${pcName(p.tonic)}:${p.chart.length}ch:${p.length.toFixed(0)}s:${p.lead}${p.motif ? ':motif-' + p.motif : ''}`);
    if (this.history.length > 10) this.history.shift();
    e.log('music.piece', `${v} ${pcName(p.tonic)} ${p.mode} ${p.length.toFixed(0)}s ${p.lead} | ${p.form}`);
  }

  private dropCue(fade: number) {
    const cue = this.cue, e = this.e;
    if (!cue) return;
    cue.sub.gain.cancelScheduledValues(e.now);
    cue.sub.gain.setValueAtTime(cue.sub.gain.value, e.now);
    cue.sub.gain.linearRampToValueAtTime(0, e.now + Math.max(0.05, fade));
    // long held pad notes would keep their voices (and CPU) until their own end: stop them after the fade
    const stopAt = e.now + Math.max(0.05, fade) + 0.05;
    for (const src of cue.srcs) { try { src.stop(stopAt); } catch { /* not started / already stopped */ } }
    if (e.ctx instanceof AudioContext) setTimeout(() => { try { cue.sub.disconnect(); } catch { /* ignore */ } }, (fade + 10) * 1000);
    this.cue = null;
  }

  private endPiece(fade: number, gapScale = 1) {
    const e = this.e;
    if (this.cue && fade > 0) this.dropCue(fade); else this.cue = null;
    this.piece = null;
    this.state = 'rest';
    const T = AUDIO_TUNING;
    this.nextAt = e.now + fade + (T.gapMin + Math.random() * (T.gapMax - T.gapMin)) * gapScale;
  }

  private applyGains(c: MusicContext, v: Variant, instant = false) {
    const tg = this.targets(c, v), e = this.e;
    for (const l of LAYERS) {
      if (!instant && Math.abs(tg[l] - this.gains[l]) < 0.02) continue;
      this.gains[l] = tg[l];
      if (this.cue) {
        const g = this.cue.layers[l].gain;
        g.cancelScheduledValues(e.now); g.setValueAtTime(instant ? tg[l] : g.value, e.now);
        if (!instant) g.linearRampToValueAtTime(tg[l], e.now + 4); // ramps end (setTarget automates forever)
      }
    }
    const b = 1 - 0.5 * Math.min(1, c.rain ?? 0) - 0.2 * Math.min(1, c.storm ?? 0) - (v === 'night' ? 0.15 : 0);
    if (this.cue && (instant || Math.abs(b - this.bright) > 0.03)) {
      this.bright = b;
      for (const l of LAYERS) setBrightness(e, this.cue.layers[l], b, e.now);
    }
  }

  /** Duck the score (dialogue, catch stings): depth = gain while ducked, for `hold` s. */
  duck(hold = 2.5, depth = 0.45) {
    const e = this.e, g = this.duckBus.gain;
    this.duckUntil = Math.max(this.duckUntil, e.now + hold);
    if (!this.ducked) { g.cancelScheduledValues(e.now); g.setValueAtTime(g.value, e.now); g.linearRampToValueAtTime(depth, e.now + 0.35); this.ducked = true; }
  }

  update(c: MusicContext, enabled: boolean, horizon = 0.5) {
    const e = this.e, now = e.now;
    this.ctx = c;
    if (this.ducked && now > this.duckUntil) { const g = this.duckBus.gain; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(1, now + 1.6); this.ducked = false; }
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
    if (this.state === 'resolve' && now > this.resolveUntil) this.state = 'rest';

    // arrival in town brings the next piece forward (the "welcome back" cue, with the landing motif)
    const inTown = c.town > 0.6 ? 1 : 0;
    if (inTown && !this.wasTown) {
      this.landing = true;
      if (this.state === 'rest' && this.nextAt - now > 12 && !/night|fog/.test(c.tod) && (c.storm ?? 0) < 0.5) this.nextAt = now + 4;
    }
    this.wasTown = inTown;

    if (this.state === 'piece' && this.cue) {
      const v = this.cue.piece.variant;
      // weather turns: a storm swaps the cue for the drone; a cleared storm lets it go
      const storm = c.storm ?? 0;
      if (v !== 'storm' && v !== 'title' && storm > 0.55) { this.endPiece(6, 0); this.nextAt = now + 7; return; }
      if (v === 'storm' && storm < 0.25) { this.endPiece(8, 0.6); return; }
      this.applyGains(c, v);
      const cue = this.cue, p = cue.piece, until = now + horizon - cue.start;
      while (cue.ptr < p.events.length && p.events[cue.ptr].t <= until) {
        const x = p.events[cue.ptr++];
        const t = cue.start + x.t;
        if (t < now - 0.05) continue; // fell behind (tab was hidden): skip, don't pile up
        const layer = x.layer ?? 'bed';
        if (this.gains[layer] < 0.03) continue; // silent layer: don't spend voices on it
        note(e, x.inst, Math.max(t, now), x.midi, x.dur, x.vel, { pan: x.pan, wet: x.wet, dest: cue.layers[layer], track: (src) => { cue.srcs.add(src); src.addEventListener('ended', () => cue.srcs.delete(src)); } });
      }
      if (now > cue.start + p.length) this.endPiece(0, v === 'night' ? 1.3 : v === 'title' ? 0.35 : 1);
    } else if (this.state === 'rest' && now >= this.nextAt && !c.fighting) {
      // fog: the weather is the score (foghorn, bell buoy); music only sometimes
      if (/fog/.test(c.tod) && Math.random() < 0.6) { this.nextAt = now + 60; return; }
      this.startPiece(this.variantFor(c));
    }
  }

  /** Title swell (call on the tap that starts the colour bloom). */
  title() {
    if (this.state === 'off') return;
    this.startPiece('title', 1);
  }

  /** Play the Cedar Landing motif in a guise now, over whatever is sounding (e.g. Gran's notes). */
  motif(guise: Guise, delay = 0, tonicAt?: number) {
    const e = this.e, t = e.now + 0.05 + delay;
    const dest = e.ctx.createGain();
    dest.connect(this.out);
    const tonic = tonicAt ?? this.cue?.piece.tonic ?? this.lastTonic;
    const mode: ModeName = guise === 'gran' ? 'lydian' : this.lastMode;
    const sc = MODE_STEPS[mode];
    const p = (s: number) => tonic + sc[((s % 7) + 7) % 7] + 12 * Math.floor(s / 7);
    const inst: Inst = guise === 'firstfish' ? 'celesta' : guise === 'landing' ? 'fiddle' : guise === 'gran' ? 'harp' : 'violin';
    const stretch = guise === 'gran' ? 0.95 : guise === 'firstfish' ? 0.32 : 0.7;
    const steps = guise === 'firstfish' ? [2, 4, 7] : MOTIF.steps;
    const beats = guise === 'firstfish' ? [1, 1, 3] : MOTIF.beats;
    let tt = t;
    steps.forEach((s, k) => { const d = beats[k] * stretch; note(e, inst, tt, p(s) + (inst === 'celesta' ? 12 : 0), d * 1.03, 0.7, { dest, pan: 0.15 }); tt += d; });
    e.log('music.motif', guise);
  }

  // -------------------------------------------------------------- fight
  private startFight() {
    const e = this.e;
    const tonic = this.piece?.tonic ?? this.lastTonic;
    const minor = ['dorian', 'aeolian', 'phrygian'].includes(String(this.piece?.mode ?? this.lastMode));
    if (this.state === 'piece') this.endPiece(1.6, 0.35); else this.nextAt = Math.max(this.nextAt, e.now + 20);
    this.state = 'fight';
    this.fight = { t0: e.now + 0.05, nextBar: e.now + 0.05, bar: 0, tonic, mode: minor ? 'dorian' : 'major', beat: 60 / 104 };
    this.fightBus.gain.cancelScheduledValues(e.now);
    this.fightBus.gain.setValueAtTime(0, e.now);
    this.fightBus.gain.linearRampToValueAtTime(1, e.now + 0.6);
    e.log('music.fight');
  }

  private tickFight(c: MusicContext, horizon: number) {
    const e = this.e, F = this.fight!;
    while (F.nextBar < e.now + horizon) {
      const sc = F.mode === 'dorian' ? MODE_STEPS.dorian : MODE_STEPS.ionian;
      const prog = [0, 0, 5, 3]; // i i ♭VI/vi IV … no leading tone; resolves on the catch
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
      // low strings swell with the strain: root + a suspended 4th that only resolves on the catch
      if (ten > 0.25 && F.bar % 2 === 0) for (const iv of [12, 17]) note(e, 'lowstr', F.nextBar, root + iv, 8 * F.beat, 0.4 + 0.6 * ten, { dest: this.fightBus });
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
    this.fightBus.connect(this.duckBus);
    if (e.ctx instanceof AudioContext) setTimeout(() => { try { old.disconnect(); } catch { /* ignore */ } }, 6000);
    this.fight = null;
    if (this.state === 'fight') { this.state = 'rest'; this.nextAt = Math.max(this.nextAt, e.now + 25); }
    e.log('music.fightEnd', resolved ? 'resolved' : 'faded');
  }

  /** The catch: the tension resolves into a cadence. big = rare species or a first catch. */
  resolve(big: boolean, quiet = false) {
    const e = this.e;
    const F = this.fight;
    const tonic = F?.tonic ?? this.lastTonic, mode = F?.mode ?? 'major';
    if (F) this.stopFight(true);
    if (quiet) {
      // a catch fanfare is playing (src/audio/fanfare.ts): the fight just stops, no cadence on top
      this.state = 'resolve';
      this.resolveUntil = e.now + 3;
      this.nextAt = Math.min(Math.max(this.nextAt, e.now + 25), e.now + 70);
      e.log('music.resolve', 'quiet');
      return;
    }
    const sc = mode === 'dorian' ? MODE_STEPS.dorian : MODE_STEPS.ionian;
    const t = e.now + 0.05;
    const dest = e.ctx.createGain(); // its own sub-mix: never revives tails of a faded piece
    dest.connect(this.out);
    const st = (d: number) => tonic + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    // IV(add9) → I(add9) — a plagal "amen", no leading tone — strings + low strings + harp
    for (const d of [3, 5, 7, 8]) note(e, 'strings', t, st(d) - 12, 0.5, 0.7, { dest });
    const I = [0, 2, 4, 1 + 7].map(st);
    for (const m of [I[0], I[3], I[1], I[2]]) note(e, 'strings', t + 0.42, m - 12, big ? 3.2 : 2, 0.8, { dest });
    note(e, 'lowstr', t + 0.42, tonic - 24, big ? 3.5 : 2.2, 0.8, { dest });
    const arp = big ? [I[0] - 12, I[1] - 12, I[2] - 12, I[0], I[1], I[2], I[0] + 12] : [I[0] - 12, I[1] - 12, I[2] - 12, I[0]];
    arp.forEach((m, i) => note(e, 'harp', t + 0.42 + i * 0.075, m, 2.5, 0.75, { dest, pan: -0.3 + i * 0.1 }));
    note(e, 'bass', t + 0.42, tonic - 24, 1.5, 0.6, { dest });
    // (the catch chime itself is an SFX — sfx.chime — so it still rings with the music off)
    if (big) this.motif('firstfish', 0.9, tonic);
    this.state = 'resolve';
    this.resolveUntil = e.now + (big ? 4 : 2.5);
    // after a catch, music may come back a little sooner
    this.nextAt = Math.min(Math.max(this.nextAt, e.now + 25), e.now + 70);
    e.log('music.resolve', big ? 'big' : 'small');
  }

  /** Debug: force the next piece now. */
  force(v: Variant) { if (this.state === 'piece') this.endPiece(0.3); this.startPiece(v); }
}
