/**
 * Catch fanfares (docs/catch_study.md F5). Per tier, all synthesized, on the SFX bus (Sound volume):
 *   quick      2-note celesta chime (the old small chime)
 *   common     3-note rising chime + a bell (first of its kind / a record)
 *   uncommon   whoosh up → sparkle run down (ACNH's reveal sting) + a short marimba/celesta phrase
 *   rare       sting + a cornet "item-get" figure over a reed chord, timpani on the downbeats
 *   legendary  pre-swell from the pull-out (timpani roll, strings, cymbal swell) → a breath →
 *              a longer two-cornet fanfare, strings, timpani, bell
 * Modifiers: perfect reel adds a high glint; a record adds a "ta-da" marimba pair.
 * The cornet is a period brass-band voice (pre-1930 harbour town), two detuned saws through an opening
 * lowpass ("blat") with a late vibrato. Melodies are original (major-mode arpeggio figures), not quotes.
 */
import { mtof } from './dsp';
import type { AudioEngine } from './engine';
import { note, type Inst, type NoteOpts } from './instruments';

export type FanTier = 'quick' | 'common' | 'uncommon' | 'rare' | 'legendary';
export interface FanMods { first?: boolean; pb?: boolean; perfect?: boolean }

export function makeFanfare(e: AudioEngine) {
  let sub: GainNode | null = null;
  /** a sub-mix for the fanfare voices (one level knob, into the SFX bus) */
  const dest = () => {
    if (!sub || sub.context !== e.ctx) { sub = e.ctx.createGain(); sub.gain.value = 0.9; sub.connect(e.buses.sfx); }
    return sub;
  };

  const N = (inst: Inst, at: number, midi: number, dur: number, vel: number, o: NoteOpts = {}) => note(e, inst, at, midi, dur, vel, { bus: 'sfx', pool: 'fan', dest: dest(), ...o });

  /** cornet / brass voice */
  function cornet(at: number, midi: number, dur: number, vel: number, pan = 0) {
    if (!e.claim('fan')) return;
    const c = e.ctx, f = mtof(midi);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(f * 1.4, at);
    lp.frequency.linearRampToValueAtTime(Math.min(5200, f * 7.5), at + 0.045);
    lp.frequency.setTargetAtTime(Math.min(3400, f * 4.2), at + 0.05, 0.12);
    const g = c.createGain();
    const peak = 0.12 * vel, end = at + dur;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.028);
    g.gain.setTargetAtTime(peak * 0.72, at + 0.04, 0.09);
    g.gain.setValueAtTime(peak * 0.72, Math.max(at + 0.05, end - 0.02));
    g.gain.linearRampToValueAtTime(0, end + 0.11);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    lp.connect(g).connect(p).connect(dest());
    const w = c.createGain(); w.gain.value = 0.28; p.connect(w).connect(e.send);
    // late vibrato (only on held notes)
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 5.4;
    lg.gain.setValueAtTime(0, at);
    lg.gain.linearRampToValueAtTime(dur > 0.35 ? 9 : 0, at + Math.min(0.45, dur));
    lfo.connect(lg);
    const oscs: OscillatorNode[] = [];
    for (const cents of [-5, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = cents;
      lg.connect(o.detune);
      o.connect(lp);
      oscs.push(o);
    }
    // a soft square an octave down for body
    const sq = c.createOscillator(), sg = c.createGain();
    sq.type = 'square'; sq.frequency.value = f / 2; sg.gain.value = 0.18;
    sq.connect(sg).connect(lp);
    oscs.push(sq);
    const stop = end + 0.2;
    lfo.start(at); lfo.stop(stop);
    oscs.forEach((o) => { o.start(at); o.stop(stop); });
    oscs[0].onended = () => { e.release('fan'); try { [...oscs, lfo, lg, sg, lp, g, p, w].forEach((n) => n.disconnect()); } catch { /* ignore */ } };
  }

  /** string ensemble swell: three detuned saws, slow attack */
  function strings(at: number, midi: number, dur: number, vel: number, attack = 0.5, pan = 0) {
    if (!e.claim('fan')) return;
    const c = e.ctx, f = mtof(midi);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = Math.min(2600, f * 4 + 400);
    const g = c.createGain();
    const peak = 0.05 * vel, end = at + dur;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, Math.max(at + attack, end - 0.01));
    g.gain.linearRampToValueAtTime(0, end + 0.45);
    const p = c.createStereoPanner(); p.pan.value = pan;
    lp.connect(g).connect(p).connect(dest());
    const w = c.createGain(); w.gain.value = 0.5; p.connect(w).connect(e.send);
    const oscs = [-9, 0, 8].map((cents) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents; o.connect(lp); o.start(at); o.stop(end + 0.5); return o; });
    oscs[0].onended = () => { e.release('fan'); try { [...oscs, lp, g, p, w].forEach((n) => n.disconnect()); } catch { /* ignore */ } };
  }

  /** timpani: tuned membrane (pitch drop) + a felt thump */
  function timp(at: number, midi: number, vel: number) {
    const f = mtof(midi);
    e.tone('sine', f * 1.06, f, at, 1.1, 0.42 * vel, { bus: 'sfx', pool: 'fan', dest: dest(), wet: 0.25 });
    e.tone('sine', f * 1.52, f * 1.5, at, 0.45, 0.12 * vel, { bus: 'sfx', pool: 'fan' });
    e.burst(at, 0.09, 'lowpass', 420, 180, 0.22 * vel, { bus: 'sfx', pool: 'fan', kind: 'pink' });
  }
  /** a roll: light single-voice strokes (short membrane tones), one thump to finish */
  function roll(at: number, midi: number, dur: number, v0: number, v1: number) {
    const n = Math.floor(dur / 0.075), f = mtof(midi);
    for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1), v = (v0 + (v1 - v0) * k * k) * (i % 2 ? 0.85 : 1);
      e.tone('sine', f * 1.05, f, at + i * 0.075 + (i % 2) * 0.006, 0.24, 0.34 * v, { bus: 'sfx', pool: 'fan', dest: dest(), wet: 0.2 });
    }
  }
  /** the ACNH reveal sting: a fast rising glissando, then a sparkle run down the tonic chord */
  function sting(at: number, T: number, big: boolean) {
    e.burst(at, 0.2, 'bandpass', 380, 3600, 0.16, { bus: 'sfx', pool: 'fan', q: 2.4, a: 0.14, kind: 'pink' });
    e.tone('sine', mtof(T - 5), mtof(T + 19), at, 0.17, 0.07, { bus: 'sfx', pool: 'fan', dest: dest(), a: 0.12 });
    const run = big ? [28, 24, 19, 16, 12, 7] : [24, 19, 16, 12];
    run.forEach((iv, i) => N('celesta', at + 0.17 + i * 0.07, T + iv, 1.2, 0.62 - i * 0.04, { bus: 'sfx', pan: 0.3 - i * 0.12, wet: 0.45 }));
  }

  /** Pull-out: legendary swell (the suspense before the reveal); uncommon+ get a splash-side whoosh. */
  function pullout(at: number, T: number, tier: FanTier, lead = 1.0) {
    if (tier === 'legendary') {
      const len = Math.max(0.6, lead);
      roll(at, T - 24 + 7, len, 0.12, 0.85); // on the dominant
      [T - 5, T - 1, T + 2].forEach((m, i) => strings(at, m, len, 0.75, len * 0.85, -0.3 + i * 0.3)); // V chord swell
      e.burst(at, len + 0.05, 'highpass', 5200, 7400, 0.11, { bus: 'sfx', pool: 'fan', a: len * 0.95, kind: 'white', wet: 0.3 });
      e.log('sfx.fanfare', 'swell');
    } else if (tier === 'rare') {
      roll(at + 0.2, T - 24 + 7, 0.5, 0.1, 0.4);
    }
  }

  /** The reveal fanfare (fish in hand). T = tonic (MIDI). */
  function reveal(at: number, T: number, tier: FanTier, m: FanMods = {}) {
    const C = T + 12; // melody octave for chimes
    switch (tier) {
      case 'quick':
        [7, 12].forEach((iv, i) => N('celesta', at + i * 0.11, C + iv, 1.5, 0.6, { bus: 'sfx', pan: -0.1 + i * 0.2, wet: 0.4 }));
        break;
      case 'common':
        [0, 4, 7].forEach((iv, i) => N('celesta', at + i * 0.09, C + iv, 1.5, 0.66, { bus: 'sfx', pan: -0.2 + i * 0.2, wet: 0.4 }));
        N('bell', at + 0.3, C + 12, 3, 0.45, { bus: 'sfx', wet: 0.5 });
        break;
      case 'uncommon': {
        sting(at - 0.12, T, false);
        const ph = [[7, 0.0, 0.14], [9, 0.16, 0.14], [11, 0.32, 0.14], [12, 0.5, 0.7]] as const;
        ph.forEach(([iv, t, d]) => { N('marimba', at + 0.42 + t, T + iv, d, 0.8, { bus: 'sfx', wet: 0.3 }); N('celesta', at + 0.42 + t, C + iv, d + 0.6, 0.35, { bus: 'sfx', wet: 0.4 }); });
        [0, 4, 7].forEach((iv, i) => N('harp', at + 0.92 + i * 0.05, T + iv, 2.5, 0.6, { bus: 'sfx', pan: -0.2 + i * 0.2 }));
        N('bass', at + 0.92, T - 24, 1.5, 0.6, { bus: 'sfx' });
        break;
      }
      case 'rare': {
        sting(at - 0.12, T, true);
        const B = T; // cornet register around the tonic
        const t0 = at + 0.5;
        // pickup triplet on the dominant → the tonic held → a turn → the octave held
        [[-5, 0, 0.09], [-5, 0.1, 0.09], [-5, 0.2, 0.09], [0, 0.3, 0.42], [4, 0.76, 0.12], [2, 0.9, 0.12], [4, 1.04, 0.12], [7, 1.18, 0.75]].forEach(([iv, t, d]) => cornet(t0 + t, B + iv, d, 0.95, 0.1));
        // second cornet a third below on the held notes
        [[-8, 0.3, 0.42], [4, 1.18, 0.75]].forEach(([iv, t, d]) => cornet(t0 + t, B + iv, d, 0.6, -0.25));
        [0, 4, 7].forEach((iv, i) => N('harmonium', t0 + 0.3, T - 12 + iv, 1.65, 0.55, { bus: 'sfx', pan: -0.2 + i * 0.2 }));
        timp(t0 + 0.3, T - 24, 0.9); timp(t0 + 1.18, T - 24, 0.8); timp(t0 + 1.18 + 0.12, T - 17, 0.6);
        N('bell', t0 + 1.18, C + 7, 3.5, 0.4, { bus: 'sfx', wet: 0.5 });
        break;
      }
      case 'legendary': {
        sting(at - 0.1, T, true);
        const t0 = at + 0.55;
        // a broader tune: rising tonic triad in triplets, held octave, a falling answer, a big final chord
        const tune: [number, number, number][] = [[0, 0, 0.1], [4, 0.11, 0.1], [7, 0.22, 0.1], [12, 0.33, 0.55], [11, 0.92, 0.14], [9, 1.08, 0.14], [7, 1.24, 0.14], [9, 1.4, 0.42], [12, 1.86, 0.14], [14, 2.02, 0.14], [16, 2.18, 1.3]];
        tune.forEach(([iv, t, d]) => cornet(t0 + t, T + iv, d, 1, 0.12));
        const low = [-3, 0, 4, 7, 7, 5, 4, 5, 9, 11, 12]; // diatonic thirds (sixths) below
        tune.forEach(([, t, d], i) => { if (d > 0.3 || i === 0) cornet(t0 + t, T + low[i], d, 0.6, -0.28); }); // harmony on the held notes
        // strings: IV on the answer, I under the final chord
        [5, 9, 12].forEach((iv, i) => strings(t0 + 0.92, T - 12 + iv, 0.9, 0.7, 0.25, -0.3 + i * 0.3));
        [0, 4, 7, 12].forEach((iv, i) => strings(t0 + 2.18, T - 12 + iv, 1.3, 0.85, 0.08, -0.3 + i * 0.2));
        [0, 4, 7].forEach((iv, i) => N('harmonium', t0 + 0.33, T - 12 + iv, 0.55, 0.5, { bus: 'sfx', pan: -0.2 + i * 0.2 }));
        timp(t0 + 0.33, T - 24, 1); timp(t0 + 1.4, T - 17, 0.75);
        roll(t0 + 1.86, T - 24, 0.3, 0.4, 0.9);
        timp(t0 + 2.18, T - 24, 1.1);
        N('bell', t0 + 2.18, C, 5, 0.5, { bus: 'sfx', wet: 0.6 });
        N('bell', t0 + 2.18, C + 7, 5, 0.32, { bus: 'sfx', wet: 0.6 });
        [24, 19, 16, 12, 7, 4].forEach((iv, i) => N('celesta', t0 + 2.3 + i * 0.06, C + iv, 1.2, 0.4, { bus: 'sfx', pan: 0.4 - i * 0.15, wet: 0.5 }));
        e.burst(t0 + 2.18, 1.6, 'highpass', 6000, 4500, 0.07, { bus: 'sfx', pool: 'fan', kind: 'white', wet: 0.4 }); // cymbal
        break;
      }
    }
    const end = { quick: 0.3, common: 0.4, uncommon: 1.1, rare: 2.0, legendary: 3.0 }[tier];
    if (m.pb) [12, 19].forEach((iv, i) => N('marimba', at + end + i * 0.12, C + iv - 12, 0.6, 0.6, { bus: 'sfx', wet: 0.3 }));
    if (m.perfect) N('celesta', at + end * 0.6 + 0.25, C + 24, 1.6, 0.42, { bus: 'sfx', pan: 0.45, wet: 0.6 });
    // the audio test counts the catch chime by this event
    e.log('sfx.chime', tier);
    e.log('sfx.fanfare', tier);
  }

  return { pullout, reveal, cornet, strings, timp };
}
export type Fanfare = ReturnType<typeof makeFanfare>;
