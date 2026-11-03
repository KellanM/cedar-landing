/**
 * Sustained and bowed/blown music voices for the chord-field score (docs/music_study.md):
 *
 *   strings  — two detuned soft-saw oscillators per note, slow attack / long release
 *   lowstr   — the same, darker, for the pedal and bass walk (harmonics carry it on phones)
 *   choir    — glottal-ish source; the vowel ("ah") is a SHARED formant bank per section
 *   violin   — solo line: one bright saw + delayed vibrato through a shared body EQ
 *   fiddle   — the town's folk fiddle: brighter, quicker vibrato, a little bow scratch
 *   flute    — wooden flute (village): sine + soft 2nd + breath noise, scooped attack
 *   timp     — pre-rendered timpani roll swell (storm)
 *
 * CPU: every filter that shapes the timbre lives once per section (per destination node), not
 * per note; the vibrato / ensemble LFOs are one oscillator each per engine. A note costs 1–2
 * oscillators + a gain (+ a pan). Voices are counted in the engine's 'music' pool.
 */
import { modal, mtof, rng } from './dsp';
import type { AudioEngine } from './engine';

export type PadInst = 'strings' | 'lowstr' | 'choir' | 'violin' | 'fiddle' | 'flute' | 'timp';
export const PAD_INSTS: readonly PadInst[] = ['strings', 'lowstr', 'choir', 'violin', 'fiddle', 'flute', 'timp'];

export interface PadOpts { pan?: number; wet?: number; dest?: AudioNode; track?: (src: AudioScheduledSourceNode) => void }

/** Cost experiments (offline renders: scene:<name>!nolfo!nohall!nochorus!nochoir). */
export const PAD_EXP = { lfo: true, hall: true, chorus: true, formants: true, wet: true };

interface Shared { lfoSlow: OscillatorNode; lfoVib: OscillatorNode; waves: Record<string, PeriodicWave>; hall: GainNode }
const shared = new WeakMap<AudioEngine, Shared>();

function wave(c: BaseAudioContext, n: number, f: (k: number) => number) {
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = f(k);
  return c.createPeriodicWave(re, im, { disableNormalization: false });
}

/** Per-engine shared nodes: LFOs, wavetables and a cheap long "bloom" tail for the pads. */
function S(e: AudioEngine): Shared {
  let s = shared.get(e);
  if (s) return s;
  const c = e.ctx;
  const lfoSlow = c.createOscillator(); lfoSlow.frequency.value = 0.21; lfoSlow.start();
  const lfoVib = c.createOscillator(); lfoVib.frequency.value = 5.2; lfoVib.start();
  const waves = {
    // soft saw: 1/n^1.25 rolls the top off before the filter does
    str: wave(c, 40, (k) => 1 / Math.pow(k, 1.25)),
    // glottal pulse-ish source for the choir: steep roll-off, every partial present
    glot: wave(c, 48, (k) => 1 / Math.pow(k, 1.05) * (k === 1 ? 0.6 : 1)),
    // bowed solo: brighter saw with a slight odd emphasis
    bow: wave(c, 36, (k) => (k % 2 ? 1 : 0.8) / Math.pow(k, 1.05)),
    // flute: fundamental + weak 2nd/3rd
    flute: wave(c, 6, (k) => [0, 1, 0.22, 0.08, 0.03, 0.01][k] ?? 0),
  };
  // "bloom": two cross-fed delays with damping — a long, soft smear under the convolver send
  const hall = c.createGain(); hall.gain.value = 1;
  const d1 = c.createDelay(1), d2 = c.createDelay(1);
  d1.delayTime.value = 0.143; d2.delayTime.value = 0.211;
  const fb1 = c.createGain(), fb2 = c.createGain(); fb1.gain.value = 0.62; fb2.gain.value = 0.6;
  const damp = c.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2200;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 200;
  const out = c.createGain(); out.gain.value = 0.35;
  const pan1 = c.createStereoPanner(), pan2 = c.createStereoPanner(); pan1.pan.value = -0.6; pan2.pan.value = 0.6;
  hall.connect(hp).connect(damp);
  damp.connect(d1); damp.connect(d2);
  d1.connect(fb1).connect(d2); d2.connect(fb2).connect(d1);
  d1.connect(pan1).connect(out); d2.connect(pan2).connect(out);
  out.connect(e.buses.music);
  if (PAD_EXP.wet) out.connect(e.send);
  s = { lfoSlow, lfoVib, waves, hall };
  shared.set(e, s);
  return s;
}

interface Section { input: GainNode; filter?: BiquadFilterNode }
const sections = new WeakMap<AudioNode, Map<string, Section>>();

/** Section bus for (destination, kind): the shared timbre filters + chorus + sends. */
function section(e: AudioEngine, dest: AudioNode, kind: PadInst): Section {
  let m = sections.get(dest);
  if (!m) { m = new Map(); sections.set(dest, m); }
  let s = m.get(kind);
  if (s) return s;
  const c = e.ctx, sh = S(e);
  const input = c.createGain();
  let tail: AudioNode = input;
  let filter: BiquadFilterNode | undefined;
  const lp = (f: number, q = 0.5) => { const b = c.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; return b; };
  const peak = (f: number, g: number, q: number) => { const b = c.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.gain.value = g; b.Q.value = q; return b; };
  let wetAmt = 0.4, hallAmt = 0.25;
  if (kind === 'strings' || kind === 'lowstr') {
    filter = lp(kind === 'strings' ? 2000 : 750, 0.6);
    tail = tail.connect(filter);
    if (kind === 'lowstr') {
      // phones can't play the fundamental; thin it so the upper harmonics carry the line without mud
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120; hp.Q.value = 0.6;
      tail = tail.connect(hp);
    }
    if (kind === 'strings' && PAD_EXP.chorus) {
      // chorus: one modulated short delay mixed with the dry signal
      const dly = c.createDelay(0.05); dly.delayTime.value = 0.018;
      const depth = c.createGain(); depth.gain.value = 0.004;
      sh.lfoSlow.connect(depth).connect(dly.delayTime);
      const mix = c.createGain();
      const wetG = c.createGain(); wetG.gain.value = 0.5;
      tail.connect(mix); tail.connect(dly).connect(wetG).connect(mix);
      tail = mix;
      wetAmt = 0.55; hallAmt = 0.4;
    } else { wetAmt = 0.18; hallAmt = 0.12; }
  } else if (kind === 'choir' && PAD_EXP.formants) {
    // "ah": F1 ≈ 750, F2 ≈ 1150, F3 ≈ 2600 (soft, mixed choir) in parallel, plus a little body
    const mix = c.createGain();
    for (const [f, q, g] of [[750, 5, 1], [1150, 6, 0.65], [2600, 8, 0.3], [3300, 9, 0.12]] as const) {
      const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
      const gg = c.createGain(); gg.gain.value = g * 2.2;
      input.connect(b).connect(gg).connect(mix);
    }
    const body = lp(500); const bg = c.createGain(); bg.gain.value = 0.25;
    input.connect(body).connect(bg).connect(mix);
    filter = lp(3200, 0.4);
    tail = mix.connect(filter);
    wetAmt = 0.7; hallAmt = 0.45;
  } else if (kind === 'violin' || kind === 'fiddle') {
    // wooden body: resonances near 280, 450 Hz and a "bridge hill" ~2.5 kHz; tame the fizz
    filter = lp(kind === 'violin' ? 3600 : 4200, 0.5);
    tail = tail.connect(peak(280, 4, 2)).connect(peak(460, 3, 2.5)).connect(peak(2500, kind === 'fiddle' ? 5 : 3, 1.2)).connect(filter);
    wetAmt = kind === 'violin' ? 0.5 : 0.3; hallAmt = kind === 'violin' ? 0.3 : 0.12;
  } else if (kind === 'flute') {
    filter = lp(3800, 0.4);
    tail = tail.connect(filter);
    wetAmt = 0.5; hallAmt = 0.25;
  } else {
    filter = lp(1600, 0.4);
    tail = tail.connect(filter);
    wetAmt = 0.35; hallAmt = 0.2;
  }
  tail.connect(dest);
  if (PAD_EXP.wet) { const w = c.createGain(); w.gain.value = wetAmt; tail.connect(w).connect(e.send); }
  if (PAD_EXP.hall) { const h = c.createGain(); h.gain.value = hallAmt; tail.connect(h).connect(sh.hall); }
  s = { input, filter };
  m.set(kind, s);
  return s;
}

/** Darken / brighten a section on a destination (weather, night). 0 = dark, 1 = normal. */
export function setBrightness(e: AudioEngine, dest: AudioNode, b: number, at: number) {
  const m = sections.get(dest);
  if (!m) return;
  const base: Partial<Record<PadInst, number>> = { strings: 2000, lowstr: 750, choir: 3200, violin: 3600, fiddle: 4200, flute: 3800 };
  for (const [k, s] of m) {
    const f0 = base[k as PadInst];
    if (!f0 || !s.filter) continue;
    // linear ramps END (an automating biquad recomputes its coefficients every sample; setTarget never ends)
    const fq = s.filter.frequency;
    fq.cancelScheduledValues(at); fq.setValueAtTime(fq.value, at); fq.linearRampToValueAtTime(f0 * (0.45 + 0.55 * b), at + 3);
  }
}

/** engine.burst() routes to a bus; send it into a section instead (so cue fades / layers apply). */
function reroute(b: { g: GainNode } | null, to: AudioNode) {
  if (!b) return;
  try { b.g.disconnect(); b.g.connect(to); } catch { /* ignore */ }
}

function offline(e: AudioEngine) { return !(typeof window !== 'undefined' && e.ctx instanceof AudioContext); }
function later(e: AudioEngine, at: number, f: () => void) {
  if (offline(e)) return;
  setTimeout(f, Math.max(0, (at - e.now) * 1000));
}

/** A sustained note: `dur` is the held length; attack / release are added by the instrument. */
export function padNote(e: AudioEngine, inst: PadInst, at: number, midi: number, dur: number, vel: number, o: PadOpts) {
  const c = e.ctx, sh = S(e);
  const dest = o.dest ?? e.buses.music;
  if (inst === 'timp') { timpRoll(e, at, midi, dur, vel, dest, o.pan ?? 0); return; }
  const sec = section(e, dest, inst);
  const f = mtof(midi);
  const g = c.createGain();
  g.gain.value = 0;
  let out: AudioNode = g;
  if (o.pan) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); out = p; }
  out.connect(sec.input);
  // envelope
  const A = inst === 'strings' ? 2.6 : inst === 'lowstr' ? 3.2 : inst === 'choir' ? 3.4 : inst === 'violin' ? 0.35 : inst === 'fiddle' ? 0.06 : 0.09;
  const R = inst === 'strings' ? 4.5 : inst === 'lowstr' ? 5 : inst === 'choir' ? 5.5 : inst === 'violin' ? 1.4 : inst === 'fiddle' ? 0.25 : 0.4;
  const lvl = inst === 'strings' ? 0.046 : inst === 'lowstr' ? 0.032 : inst === 'choir' ? 0.06 : inst === 'violin' ? 0.07 : inst === 'fiddle' ? 0.06 : 0.12;
  const a = Math.min(A, Math.max(0.03, dur * 0.6));
  const peakV = lvl * vel;
  const end = at + Math.max(dur, a + 0.05);
  g.gain.setValueAtTime(0, at);
  if (inst === 'violin' || inst === 'fiddle' || inst === 'flute') {
    g.gain.linearRampToValueAtTime(peakV, at + a);
    // bowed / blown: a gentle swell through long notes
    if (dur > 1) g.gain.linearRampToValueAtTime(peakV * 1.15, at + Math.min(dur, 2.5));
    g.gain.setValueAtTime(peakV * (dur > 1 ? 1.15 : 1), end);
  } else {
    // pads: rise, a slight sag through the middle (bowing), held to the end — all ramps that end, so the
    // gain is a constant (cheap k-rate) for most of a long note's life
    g.gain.linearRampToValueAtTime(peakV, at + a);
    if (end > at + a + 1) g.gain.linearRampToValueAtTime(peakV * 0.88, at + a + Math.min(6, (end - at - a) / 2));
    g.gain.setValueAtTime(end > at + a + 1 ? peakV * 0.88 : peakV, end);
  }
  g.gain.linearRampToValueAtTime(0, end + R * 0.7);
  const stopAt = end + R * 0.7 + 0.05;
  const oscs: OscillatorNode[] = [];
  const mk = (w: PeriodicWave, det: number, lfo?: { src: OscillatorNode; depth: number; delay?: number }) => {
    if (!e.claim('music')) return;
    let lfoTap: (() => void) | null = null;
    const osc = c.createOscillator();
    osc.setPeriodicWave(w);
    osc.frequency.value = f;
    osc.detune.value = det;
    if (lfo && PAD_EXP.lfo) {
      const lg = c.createGain();
      if (lfo.delay) { lg.gain.setValueAtTime(0, at); lg.gain.linearRampToValueAtTime(lfo.depth, at + lfo.delay); } else lg.gain.value = lfo.depth;
      lfo.src.connect(lg).connect(osc.detune);
      lfoTap = () => { try { lfo.src.disconnect(lg); } catch { /* ignore */ } };
    }
    osc.connect(g);
    // the shared LFO keeps any connected gain alive: cut the tap when the voice ends (live and offline)
    const tap = lfoTap;
    osc.onended = () => { e.release('music'); tap?.(); try { osc.disconnect(); } catch { /* ignore */ } };
    osc.start(at);
    osc.stop(stopAt);
    oscs.push(osc);
    o.track?.(osc);
  };
  if (inst === 'strings' || inst === 'lowstr') {
    mk(sh.waves.str, -6, { src: sh.lfoSlow, depth: 5 });
    mk(sh.waves.str, 7);
  } else if (inst === 'choir') {
    mk(sh.waves.glot, -9, { src: sh.lfoVib, depth: 9, delay: 1.2 });
    mk(sh.waves.glot, 8, { src: sh.lfoSlow, depth: 6 });
  } else if (inst === 'violin' || inst === 'fiddle') {
    mk(sh.waves.bow, 0, { src: sh.lfoVib, depth: inst === 'violin' ? 16 : 11, delay: inst === 'violin' ? 0.45 : 0.2 });
    // bow scratch: a short noise breath at the onset
    if (inst === 'fiddle') reroute(e.burst(at, 0.09, 'bandpass', 2600, 1800, 0.012 * vel, { bus: 'music', pool: 'music', q: 1.2, a: 0.01 }), sec.input);
  } else if (inst === 'flute') {
    // scoop up 30 cents into the note, slow vibrato after a moment
    mk(sh.waves.flute, 0, { src: sh.lfoVib, depth: 9, delay: 0.6 });
    oscs[0]?.detune.setValueAtTime(-30, at);
    oscs[0]?.detune.linearRampToValueAtTime(0, at + 0.12);
    // breath: band-passed noise around the pitch, mostly at the start
    reroute(e.burst(at, Math.min(0.5, dur * 0.6), 'bandpass', f * 2, f * 2, 0.02 * vel, { bus: 'music', pool: 'music', q: 3, a: 0.04 }), sec.input);
  }
  if (!oscs.length) { try { g.disconnect(); } catch { /* ignore */ } return; }
  later(e, stopAt + 0.2, () => { try { g.disconnect(); out.disconnect(); } catch { /* ignore */ } });
}

/** Timpani roll swell: strokes every ~65 ms, crescendo then a final stroke (pre-rendered, cached). */
function timpRoll(e: AudioEngine, at: number, midi: number, dur: number, vel: number, dest: AudioNode, pan: number) {
  const secs = Math.max(2, Math.min(6, dur));
  const key = Math.round(secs * 2) / 2;
  const membrane = [{ ratio: 1, amp: 1, t60: 1.8 }, { ratio: 1.5, amp: 0.55, t60: 1.2 }, { ratio: 1.98, amp: 0.35, t60: 0.9 }, { ratio: 2.44, amp: 0.2, t60: 0.6 }, { ratio: 2.96, amp: 0.12, t60: 0.4 }];
  const buf = e.sample(`timp:${midi}:${key}`, () => {
    const sr = e.sr;
    const stroke = modal(sr, mtof(midi), 2, membrane, rng(midi), 0.25, 0.003);
    const n = Math.floor(sr * (key + 2));
    const out = new Float32Array(n);
    const r = rng(midi * 7 + 1);
    const strokes = Math.floor(key / 0.065);
    for (let i = 0; i <= strokes; i++) {
      const u = i / strokes;
      const amp = i === strokes ? 1 : 0.06 + 0.5 * u * u; // swell, then the arrival
      const off = Math.floor((i * 0.065 + (r() - 0.5) * 0.01) * sr);
      for (let k = 0; k < stroke.length && off + k < n; k++) out[off + k] += stroke[k] * amp * (i === strokes ? 1 : 0.5);
    }
    let p = 1e-9;
    for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(out[i]));
    for (let i = 0; i < n; i++) out[i] *= 0.9 / p;
    return out;
  });
  const sec = section(e, dest, 'timp');
  e.play(buf, at, { pool: 'music', dest: sec.input, gain: 0.5 * vel, pan, wet: 0 });
}

