/**
 * Music instruments. Plucked and struck voices are pre-rendered per pitch (dsp.ts, cached);
 * reeds (harmonium, accordion/concertina) are live oscillator pairs with a reed-like spectrum.
 * Everything is voiced for small speakers: bass notes carry strong upper partials, melodies sit
 * in the 300 Hz – 3 kHz band, and the bright reeds are lowpassed below the harsh range.
 */
import { mtof } from './dsp';
import type { AudioEngine, Bus } from './engine';

export type Inst = 'guitar' | 'harp' | 'bass' | 'marimba' | 'celesta' | 'vibes' | 'bell' | 'harmonium' | 'accordion' | 'mute' | 'mandolin';

export interface NoteOpts { pan?: number; wet?: number; bus?: Bus; lp?: number; dest?: AudioNode }

let reedWave: PeriodicWave | null = null;
let reedCtx: BaseAudioContext | null = null;
function reed(e: AudioEngine) {
  if (reedWave && reedCtx === e.ctx) return reedWave;
  const N = 28, re = new Float32Array(N), im = new Float32Array(N);
  // free-reed spectrum: strong odd and even partials falling ~1/n^0.85, a slight dip at 2 (nasal)
  for (let n = 1; n < N; n++) im[n] = (n === 2 ? 0.55 : 1) / Math.pow(n, 0.85);
  reedWave = e.ctx.createPeriodicWave(re, im, { disableNormalization: false });
  reedCtx = e.ctx;
  return reedWave;
}

/** A sustained reed voice: two detuned oscillators → lowpass → amp envelope with a bellows swell. */
function reedNote(e: AudioEngine, at: number, midi: number, dur: number, vel: number, o: NoteOpts, kind: 'harmonium' | 'accordion') {
  if (!e.claim('music')) return;
  if (!e.claim('music')) { e.release('music'); return; }
  const c = e.ctx, f = mtof(midi);
  const g = c.createGain(), lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = kind === 'harmonium' ? Math.min(2200, f * 5 + 500) : Math.min(3000, f * 7 + 700);
  lp.Q.value = 0.4;
  const pan = c.createStereoPanner();
  pan.pan.value = o.pan ?? 0;
  lp.connect(g).connect(pan).connect(o.dest ?? e.buses[o.bus ?? 'music']);
  if (o.wet) { const w = c.createGain(); w.gain.value = o.wet; pan.connect(w).connect(e.send); }
  const det = kind === 'accordion' ? 5 : 2.5; // cents, mild "musette" beating
  const a = kind === 'harmonium' ? Math.min(0.35, dur * 0.3) : 0.035;
  const r = kind === 'harmonium' ? 0.35 : 0.09;
  const peak = vel * (kind === 'harmonium' ? 0.075 : 0.085);
  const end = at + dur;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + a);
  // bellows: a slow swell / ease through the note
  if (dur > a + 0.2) g.gain.linearRampToValueAtTime(peak * (kind === 'harmonium' ? 1.12 : 0.85), end);
  else g.gain.setValueAtTime(peak, Math.max(at + a, end));
  g.gain.linearRampToValueAtTime(0, Math.max(at + a, end) + r);
  for (const cents of [-det, det]) {
    const osc = c.createOscillator();
    osc.setPeriodicWave(reed(e));
    osc.frequency.value = f;
    osc.detune.value = cents;
    osc.connect(lp);
    osc.onended = () => { e.release('music'); try { osc.disconnect(); } catch { /* ignore */ } };
    osc.start(at);
    osc.stop(end + r + 0.05);
  }
  setTimeoutSafe(e, end + r + 0.1, () => { try { g.disconnect(); lp.disconnect(); pan.disconnect(); } catch { /* ignore */ } });
}
function setTimeoutSafe(e: AudioEngine, at: number, f: () => void) {
  if (typeof window === 'undefined' || !(e.ctx instanceof AudioContext)) return; // offline: GC handles it
  setTimeout(f, Math.max(0, (at - e.now) * 1000));
}

/** Play one note on an instrument. vel 0..1. */
export function note(e: AudioEngine, inst: Inst, at: number, midi: number, dur: number, vel: number, o: NoteOpts = {}) {
  const bus = o.bus ?? 'music';
  const pool = bus === 'music' ? 'music' : 'sfx';
  switch (inst) {
    case 'guitar': {
      const b = e.pluckBuf('gtr', midi, 3.2, { bright: 0.42, t60: 2.6, pos: 0.17, damp: 0.45, body: 0.55 });
      e.play(b, at, { bus, pool, dest: o.dest, gain: 0.55 * vel, pan: o.pan, wet: o.wet ?? 0.25, dur: Math.max(0.25, dur + 0.6) });
      break;
    }
    case 'mandolin': {
      const b = e.pluckBuf('mand', midi, 1.6, { bright: 0.7, t60: 1.2, pos: 0.12, damp: 0.2, body: 0.25 });
      e.play(b, at, { bus, pool, dest: o.dest, gain: 0.4 * vel, pan: o.pan, wet: o.wet ?? 0.22, dur: Math.max(0.2, dur + 0.3) });
      break;
    }
    case 'harp': {
      const b = e.pluckBuf('harp', midi, 4, { bright: 0.3, t60: 3.6, pos: 0.5, damp: 0.25, body: 0.15 });
      e.play(b, at, { bus, pool, dest: o.dest, gain: 0.55 * vel, pan: o.pan, wet: o.wet ?? 0.4 });
      break;
    }
    case 'mute': {
      // palm-muted guitar for the fight ostinato: short, dark
      const b = e.pluckBuf('mute', midi, 0.5, { bright: 0.35, t60: 0.28, pos: 0.2, damp: 0.85, body: 0.6 });
      e.play(b, at, { bus, pool, dest: o.dest, gain: 0.6 * vel, pan: o.pan, wet: o.wet ?? 0.1, lp: o.lp });
      break;
    }
    case 'bass': {
      // upright-ish pluck: KS is naturally rich in harmonics, so the line survives a phone speaker
      const b = e.pluckBuf('bass', midi, 2.4, { bright: 0.3, t60: 1.6, pos: 0.22, damp: 0.6, body: 0.2 });
      e.play(b, at, { bus, pool, dest: o.dest, gain: 0.75 * vel, pan: o.pan ?? 0, wet: o.wet ?? 0.05, dur: Math.max(0.3, dur + 0.15) });
      break;
    }
    case 'marimba': case 'celesta': case 'vibes': case 'bell': {
      const len = inst === 'bell' ? 6 : inst === 'vibes' ? 3.5 : inst === 'celesta' ? 2.6 : 1.4;
      const b = e.modalBuf(inst, midi, len, undefined, inst === 'marimba' ? 0.25 : 0.1);
      const g = inst === 'bell' ? 0.3 : inst === 'celesta' ? 0.32 : 0.42;
      e.play(b, at, { bus, pool, dest: o.dest, gain: g * vel, pan: o.pan, wet: o.wet ?? (inst === 'marimba' ? 0.25 : 0.4), lp: o.lp });
      break;
    }
    case 'harmonium': case 'accordion':
      reedNote(e, at, midi, dur, vel, o, inst);
      break;
  }
}
