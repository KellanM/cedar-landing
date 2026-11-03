/**
 * Sound-effect library: every one-shot is a few Web Audio nodes (filtered noise, short tones,
 * pre-rendered modal/pluck samples). `p` carries placement from engine.spatial() for world sounds.
 */
import { MODES, mtof, type Mode } from './dsp';
import type { AudioEngine, Bus } from './engine';
import { note } from './instruments';

export interface Place { gain: number; pan: number; lp: number }
const HERE: Place = { gain: 1, pan: 0, lp: 18000 };

const COIN: Mode[] = [{ ratio: 1, amp: 1, t60: 0.5 }, { ratio: 2.71, amp: 0.6, t60: 0.35 }, { ratio: 5.18, amp: 0.35, t60: 0.2 }, { ratio: 7.9, amp: 0.15, t60: 0.12 }];

const j = (e: AudioEngine, a: number) => 1 + (e.rand() - 0.5) * a; // jitter factor

export function makeSfx(e: AudioEngine) {
  const B = <const T extends object>(bus: Bus, p: Place, extra?: T) => ({ bus, pan: p.pan, lp: p.lp < 17000 ? p.lp : undefined, ...(extra ?? ({} as T)) });

  /** Generic water splash: body (lowpass noise) + droplets (short bright blips). size ≈ 0.3–3. */
  function splash(at: number, size: number, p: Place = HERE, bus: Bus = 'sfx') {
    const s = Math.max(0.2, size), g = p.gain;
    const dur = 0.18 + 0.22 * Math.min(3, s);
    e.burst(at, dur, 'lowpass', 2600 + 400 * s, 500, 0.55 * g * Math.min(1.4, 0.5 + 0.35 * s), B(bus, p, { a: 0.006, q: 0.6, kind: 'white', wet: 0.15 }));
    e.burst(at, dur * 0.7, 'bandpass', 900, 350, 0.35 * g * Math.min(1.3, 0.4 + 0.3 * s), B(bus, p, { a: 0.003, q: 1.2, kind: 'pink' }));
    if (s > 1.2) e.tone('sine', 90, 45, at, 0.25, 0.35 * g * Math.min(1, s / 3), B(bus, p, { pool: bus === 'sfx' ? 'sfx' : bus })); // weight
    const drops = Math.min(6, Math.round(2 + s * 1.5));
    for (let i = 0; i < drops; i++) {
      const t = at + 0.05 + e.rand() * dur * 1.3, f = 900 + e.rand() * 1400;
      e.tone('sine', f, f * (1.4 + e.rand() * 0.5), t, 0.035, 0.07 * g, B(bus, p));
    }
  }

  const sfx = {
    splash,

    // ------------------------------------------------------------ fishing
    cast(at: number) {
      // rod swish (a band sweeping up then down) + line paying out (fast fading clicks)
      e.burst(at, 0.42, 'bandpass', 500, 2600, 0.42, { bus: 'sfx', q: 2.2, a: 0.12, kind: 'pink' });
      e.burst(at + 0.1, 0.3, 'bandpass', 3200, 1400, 0.12, { bus: 'sfx', q: 3, a: 0.05 });
      for (let i = 0; i < 9; i++) e.tone('triangle', 3400, 3000, at + 0.12 + i * (0.035 + i * 0.006), 0.012, 0.05 * (1 - i / 10), { bus: 'sfx', pool: 'sfx' });
      e.log('sfx.cast');
    },
    plop(at: number, p: Place = HERE) {
      // the float lands: a hollow "bloop" and a little ring of drops
      e.tone('sine', 420 * j(e, 0.1), 170, at, 0.09, 0.45 * p.gain, B('sfx', p, { a: 0.003 }));
      e.tone('sine', 900, 1500, at + 0.035, 0.05, 0.12 * p.gain, B('sfx', p));
      e.burst(at, 0.12, 'bandpass', 1400, 600, 0.22 * p.gain, B('sfx', p, { q: 1.5 }));
      e.log('sfx.plop');
    },
    nibble(at: number, p: Place = HERE) {
      e.tone('sine', 1250 * j(e, 0.15), 650, at, 0.07, 0.22 * p.gain, B('sfx', p));
      e.burst(at, 0.05, 'bandpass', 2200, 1600, 0.08 * p.gain, B('sfx', p, { q: 3 }));
      e.log('sfx.nibble');
    },
    bite(at: number, p: Place = HERE) {
      // the float yanked under: a deep "gloop" + a bright attention ping (the call to act)
      e.tone('sine', 300, 85, at, 0.22, 0.6 * p.gain, B('sfx', p, { a: 0.004 }));
      e.burst(at, 0.25, 'lowpass', 1800, 300, 0.4 * p.gain, B('sfx', p, { kind: 'pink' }));
      note(e, 'celesta', at + 0.02, 88, 0.5, 0.75, { bus: 'sfx', pan: p.pan, wet: 0.25 });
      note(e, 'celesta', at + 0.09, 95, 0.5, 0.6, { bus: 'sfx', pan: p.pan, wet: 0.25 });
      e.log('sfx.bite');
    },
    strike(at: number, r: number, p: Place = HERE) {
      // hook-set: rod whip + thud + crown splash (bigger for rarer fish)
      e.burst(at, 0.14, 'bandpass', 1200, 4200, 0.4, { bus: 'sfx', q: 2.5, a: 0.02 });
      e.tone('sine', 120, 55, at, 0.18, 0.55, { bus: 'sfx' });
      splash(at + 0.03, 0.9 * r, p);
      e.log('sfx.strike', r.toFixed(1));
    },
    thrash(at: number, r: number, p: Place = HERE) { splash(at, 0.55 * r, p); e.log('sfx.thrash'); },
    leap(at: number, r: number, p: Place = HERE) { splash(at, 0.45 * r, p); e.log('sfx.leap'); },
    breach(at: number, r: number, p: Place = HERE) { splash(at, 0.85 * r + 0.3, p); e.log('sfx.breach'); },
    landSplash(at: number, r: number, p: Place = HERE) {
      splash(at, 1.1 * r, p);
      e.log('sfx.land');
    },
    /** fish arrives in the hands: a wet slap + flop */
    slap(at: number, gain = 1) {
      e.burst(at, 0.07, 'bandpass', 1500, 900, 0.5 * gain, { bus: 'sfx', q: 1.2, a: 0.002 });
      e.tone('sine', 160, 80, at, 0.08, 0.35 * gain, { bus: 'sfx' });
    },
    /** catch chime: 2 notes, or a 4-note rising figure + bell for rare / first-ever catches */
    chime(at: number, tonic: number, big: boolean) {
      const t = tonic + 12;
      const seq = big ? [0, 4, 7, 12, 16] : [7, 12];
      seq.forEach((iv, i) => note(e, 'celesta', at + i * (big ? 0.085 : 0.11), t + iv, 1.5, big ? 0.7 : 0.6, { bus: 'sfx', pan: -0.2 + i * 0.1, wet: 0.4 }));
      if (big) note(e, 'bell', at + seq.length * 0.085, t - 12, 4, 0.55, { bus: 'sfx', wet: 0.5 });
      e.log('sfx.chime', big ? 'big' : 'small');
    },
    release(at: number) {
      splash(at + 0.05, 0.6);
      e.burst(at + 0.15, 0.6, 'bandpass', 700, 300, 0.12, { bus: 'sfx', q: 1, a: 0.1, kind: 'pink' }); // swims off
      e.log('sfx.release');
    },
    keep(at: number) {
      // cooler lid: a wooden knock + latch
      e.play(e.modalBuf('wood', 50, 0.3), at, { bus: 'sfx', gain: 0.6, rate: j(e, 0.06) });
      e.play(e.modalBuf('wood', 62, 0.3), at + 0.09, { bus: 'sfx', gain: 0.35 });
      e.log('sfx.keep');
    },
    slip(at: number) {
      // line slips: a quick ratchet run + zing
      for (let i = 0; i < 10; i++) e.burst(at + i * 0.022, 0.012, 'bandpass', 4200, 4000, 0.18, { bus: 'sfx', q: 6, pool: 'sfx' });
      e.burst(at, 0.4, 'bandpass', 2000, 900, 0.15, { bus: 'sfx', q: 8, a: 0.01 });
      e.log('sfx.slip');
    },
    /** one reel click; `drag` = the fish taking line (brighter, thinner) */
    click(at: number, drag: boolean) {
      e.burst(at, 0.012, 'bandpass', drag ? 5200 : 3600, drag ? 5000 : 3400, drag ? 0.13 : 0.2, { bus: 'sfx', q: 5, pool: 'sfx', a: 0.001 });
      if (!drag) e.tone('square', 2400, 2300, at, 0.008, 0.025, { bus: 'sfx', pool: 'sfx', a: 0.001 });
    },

    // ------------------------------------------------------------ wildlife
    gull(at: number, p: Place, n = 1 + Math.floor(e.rand() * 3), kind: 'gull' | 'kittiwake' = 'gull') {
      // nasal "keow" calls: a buzzy tone with a rise-fall contour through a beak formant
      for (let i = 0; i < n; i++) {
        const t = at + i * (0.22 + e.rand() * 0.12), f = (kind === 'kittiwake' ? 1500 : 1050) * j(e, 0.2);
        const len = kind === 'kittiwake' ? (i === n - 1 ? 0.38 : 0.13) : 0.18 + e.rand() * 0.15;
        const v = e.tone('sawtooth', f, f * 0.72, t, len, 0.09 * p.gain, B('amb', p, { a: 0.03, pool: 'amb', wet: 0.25 }));
        if (v) {
          v.osc.frequency.cancelScheduledValues(t);
          v.osc.frequency.setValueAtTime(f * 0.8, t);
          v.osc.frequency.linearRampToValueAtTime(f * 1.25, t + len * 0.3);
          v.osc.frequency.linearRampToValueAtTime(f * 0.75, t + len);
        }
      }
      e.log('amb.gull', kind);
    },
    eagle(at: number, p: Place) {
      // bald eagle: thin, high, chittering whistle run
      const n = 5 + Math.floor(e.rand() * 4);
      for (let i = 0; i < n; i++) e.tone('sine', 3300 - i * 70, 2700 - i * 70, at + i * 0.075, 0.06, 0.06 * p.gain, B('amb', p, { pool: 'amb', wet: 0.3 }));
      e.log('amb.eagle');
    },
    heron(at: number, p: Place) {
      e.tone('sawtooth', 260, 180, at, 0.45, 0.07 * p.gain, B('amb', p, { pool: 'amb', a: 0.02, lp: Math.min(p.lp, 1600), wet: 0.3 }));
      e.burst(at, 0.4, 'bandpass', 500, 380, 0.05 * p.gain, B('amb', p, { pool: 'amb', q: 2 }));
      e.log('amb.heron');
    },
    guillemot(at: number, p: Place) {
      for (let i = 0; i < 3; i++) e.tone('sine', 4200, 3000, at + i * 0.16, 0.12, 0.035 * p.gain, B('amb', p, { pool: 'amb', a: 0.01, wet: 0.2 }));
      e.log('amb.guillemot');
    },
    crow(at: number, p: Place) {
      const n = 2 + Math.floor(e.rand() * 2);
      for (let i = 0; i < n; i++) e.tone('sawtooth', 720 * j(e, 0.1), 560, at + i * 0.38, 0.22, 0.06 * p.gain, B('amb', p, { pool: 'amb', a: 0.02, lp: 2400, wet: 0.25 }));
      e.log('amb.crow');
    },
    songbird(at: number, p: Place) {
      // small forest songbird: a few quick whistles then a trill
      let t = at;
      const base = 2600 + e.rand() * 1400;
      for (let i = 0; i < 3; i++) { e.tone('sine', base, base * 1.15, t, 0.08, 0.04 * p.gain, B('amb', p, { pool: 'amb', a: 0.01, wet: 0.3 })); t += 0.14; }
      for (let i = 0; i < 6; i++) { e.tone('sine', base * 1.3, base * 1.1, t, 0.03, 0.03 * p.gain, B('amb', p, { pool: 'amb', wet: 0.3 })); t += 0.04; }
      e.log('amb.songbird');
    },
    thrush(at: number, p: Place) {
      // Swainson's-thrush-like rising spiral of fluty notes (dusk, forest)
      const base = 1300 + e.rand() * 300;
      for (let i = 0; i < 6; i++) {
        const f = base * Math.pow(1.13, i);
        e.tone('sine', f, f * 1.04, at + i * 0.13, 0.11, 0.045 * p.gain * (1 - i * 0.06), B('amb', p, { pool: 'amb', a: 0.012, wet: 0.45 }));
      }
      e.log('amb.thrush');
    },
    owl(at: number, p: Place) {
      for (const [dt, len] of [[0, 0.35], [0.55, 0.18], [0.8, 0.5]] as const) e.tone('sine', 400, 370, at + dt, len, 0.08 * p.gain, B('amb', p, { pool: 'amb', a: 0.06, wet: 0.5 }));
      e.log('amb.owl');
    },
    frog(at: number, p: Place) {
      // Pacific chorus frog "rib-bit": two short buzzy pulses
      for (const dt of [0, 0.14]) {
        const v = e.tone('square', 1700 * j(e, 0.15), 1500, at + dt, 0.07, 0.025 * p.gain, B('amb', p, { pool: 'amb', lp: 3500, a: 0.01 }));
        void v;
      }
      e.log('amb.frog');
    },
    foghorn(at: number, p: Place) {
      // distant lighthouse diaphone: a long low "BEEE—ohh", heavily reverberant
      for (const [f0, f1, dt, len] of [[176, 172, 0, 1.6], [150, 140, 1.6, 1.4]] as const) {
        e.tone('sawtooth', f0, f1, at + dt, len, 0.09 * p.gain, B('amb', p, { pool: 'amb', a: 0.25, lp: 900, wet: 0.8 }));
      }
      e.log('amb.foghorn');
    },
    buoyBell(at: number, p: Place) {
      e.play(e.modalBuf('bell', 72 + Math.floor(e.rand() * 2) * 2, 5), at, B('amb', p, { pool: 'amb', gain: 0.18 * p.gain, wet: 0.6 }));
      e.log('amb.buoy');
    },
    creak(at: number, p: Place) {
      // a mooring line / plank creak: a slow buzzy glide through a wooden formant
      const f = 90 + e.rand() * 70;
      e.tone('sawtooth', f, f * (1.2 + e.rand() * 0.4), at, 0.45 + e.rand() * 0.4, 0.05 * p.gain, B('amb', p, { pool: 'amb', a: 0.1, lp: 1100 }));
      e.log('amb.creak');
    },
    hammer(at: number, p: Place) {
      // the shipwright at work, far off
      const n = 2 + Math.floor(e.rand() * 3);
      for (let i = 0; i < n; i++) e.play(e.modalBuf('wood', 57, 0.3), at + i * 0.42, B('amb', p, { pool: 'amb', gain: 0.25 * p.gain, wet: 0.5 }));
      e.log('amb.hammer');
    },
    thunder(at: number, distM: number, near: boolean, pan = 0) {
      // far: a low rolling rumble of a few irregular swells; near: a bright crack, a boom, then the roll
      const far = Math.min(1, distM / 3000);
      const g = 0.9 / (1 + distM / 1400);
      const len = 2.4 + 3.5 * far + e.rand() * 1.5;
      if (near) {
        e.burst(at, 0.22, 'bandpass', 3200, 900, 0.5 * g * 1.4, { bus: 'sfx', pool: 'thunder', q: 0.6, a: 0.003, kind: 'white', pan, wet: 0.35 });
        e.burst(at + 0.02, 0.5, 'bandpass', 1400, 500, 0.4 * g * 1.4, { bus: 'sfx', pool: 'thunder', q: 0.8, a: 0.004, kind: 'white', pan, wet: 0.4 });
        e.burst(at + 0.04, 1.4, 'lowpass', 300, 90, 0.8 * g * 1.4, { bus: 'sfx', pool: 'thunder', a: 0.01, kind: 'brown', pan, wet: 0.3 });
      }
      const n = 3 + Math.floor(e.rand() * 3);
      let t = near ? 0.35 : 0;
      for (let i = 0; i < n; i++) {
        const k = 1 - (i / n) * 0.6;
        const d = (len / n) * (0.9 + e.rand() * 0.9);
        const lp = (near ? 520 : 420 - 200 * far) * (0.8 + e.rand() * 0.4);
        // low body (felt) + a mid growl so phone speakers hear it too
        e.burst(at + t, d, 'lowpass', lp, lp * 0.4, 0.75 * g * k * (0.7 + e.rand() * 0.5), { bus: 'sfx', pool: 'thunder', a: 0.12 + e.rand() * 0.25, kind: 'brown', pan: pan * 0.6 + (e.rand() - 0.5) * 0.4, wet: 0.5 });
        e.burst(at + t + 0.05, d * 0.8, 'bandpass', 260 + e.rand() * 160, 160, 0.35 * g * k, { bus: 'sfx', pool: 'thunder', q: 0.9, a: 0.1 + e.rand() * 0.2, kind: 'pink', pan: pan * 0.5, wet: 0.5 });
        t += d * (0.45 + e.rand() * 0.4);
      }
      e.log('sfx.thunder', near ? 'near' : `far ${Math.round(distM)}m`);
    },
    lap(at: number, gain: number, pan: number, bright = 0) {
      // one wavelet against a hull or rocks
      const f = 450 + e.rand() * 300 + bright * 600;
      e.burst(at, 0.45 + e.rand() * 0.3, 'bandpass', f, f * 0.55, gain, { bus: 'amb', pool: 'amb', q: 0.9, a: 0.09 + e.rand() * 0.08, pan, kind: 'pink' });
      if (e.rand() < 0.4) e.tone('sine', 300 + e.rand() * 300, 160, at + 0.1, 0.07, gain * 0.25, { bus: 'amb', pool: 'amb', pan });
    },
    blow(at: number, kind: string, p: Place) {
      const big = kind === 'humpback' ? 1.6 : kind === 'orca' ? 1 : 0.45;
      e.burst(at, 0.5 + 0.6 * big, 'bandpass', 900 * (1.2 - 0.2 * big), 500, 0.5 * p.gain * Math.min(1.2, big), B('sfx', p, { q: 0.7, a: 0.03, kind: 'white', wet: 0.3 }));
      e.burst(at, 0.4 + 0.4 * big, 'lowpass', 380, 120, 0.3 * p.gain * big, B('sfx', p, { a: 0.04, kind: 'brown' }));
      e.log('sfx.blow', kind);
    },
    bigSplash(at: number, kind: 'breach' | 'slap', p: Place) {
      splash(at, kind === 'breach' ? 3 : 2, p);
      e.tone('sine', kind === 'breach' ? 70 : 120, 38, at, kind === 'breach' ? 0.6 : 0.25, 0.6 * p.gain, B('sfx', p, { a: 0.004 }));
      if (kind === 'slap') e.burst(at, 0.05, 'highpass', 2500, 2500, 0.4 * p.gain, B('sfx', p, { a: 0.001 }));
      e.log(`sfx.${kind}`);
    },
    bark(at: number, p: Place, lion = true) {
      // sea lion "arf"s / harbour-seal grunt
      const n = lion ? 2 + Math.floor(e.rand() * 3) : 1;
      for (let i = 0; i < n; i++) {
        const f = (lion ? 330 : 160) * j(e, 0.15);
        e.tone('sawtooth', f, f * 0.8, at + i * 0.32, lion ? 0.16 : 0.3, 0.09 * p.gain, B('amb', p, { pool: 'amb', a: 0.01, lp: Math.min(p.lp, lion ? 1800 : 900), wet: 0.3 }));
        e.burst(at + i * 0.32, 0.12, 'bandpass', 700, 500, 0.05 * p.gain, B('amb', p, { pool: 'amb', q: 2 }));
      }
      e.log(lion ? 'amb.sealion' : 'amb.seal');
    },

    // ------------------------------------------------------------ on foot
    step(at: number, surface: string, speed: number) {
      const k = 0.6 + 0.4 * speed;
      switch (surface) {
        case 'wood':
          e.play(e.modalBuf('wood', 53 + Math.floor(e.rand() * 4), 0.3), at, { bus: 'sfx', gain: 0.3 * k, rate: j(e, 0.08), pool: 'sfx' });
          e.burst(at, 0.035, 'bandpass', 2200, 1400, 0.09 * k, { bus: 'sfx', q: 1.5 });
          break;
        case 'gravel':
          for (let i = 0; i < 5; i++) e.burst(at + i * 0.012 + e.rand() * 0.02, 0.025, 'highpass', 2200 + e.rand() * 2000, 2000, 0.08 * k * (1 - i * 0.12), { bus: 'sfx', q: 0.8 });
          break;
        case 'sand':
          e.burst(at, 0.13, 'lowpass', 3200, 1400, 0.14 * k, { bus: 'sfx', a: 0.03, q: 0.5 });
          break;
        default: // grass / earth
          e.burst(at, 0.1, 'bandpass', 2400, 1500, 0.1 * k, { bus: 'sfx', a: 0.02, q: 0.7, kind: 'pink' });
          e.tone('sine', 220, 140, at, 0.05, 0.06 * k, { bus: 'sfx' });
      }
      e.log('sfx.step', surface);
      e.eventCount[`step.${surface}`] = (e.eventCount[`step.${surface}`] ?? 0) + 1;
    },

    // ------------------------------------------------------------ UI
    ui(at: number, name: string) {
      const U = { bus: 'ui' as Bus, pool: 'ui' };
      switch (name) {
        case 'tap': e.play(e.modalBuf('wood', 76, 0.25), at, { ...U, gain: 0.22, rate: j(e, 0.05) }); break;
        case 'refuse':
          e.play(e.modalBuf('wood', 55, 0.25), at, { ...U, gain: 0.25 });
          e.play(e.modalBuf('wood', 52, 0.25), at + 0.09, { ...U, gain: 0.22 });
          break;
        case 'page':
          e.burst(at, 0.2, 'bandpass', 2400, 4200, 0.16, { ...U, q: 0.8, a: 0.05, kind: 'white' });
          e.burst(at + 0.06, 0.12, 'highpass', 3000, 5000, 0.06, { ...U, a: 0.02 });
          break;
        case 'open':
          e.play(e.modalBuf('wood', 45, 0.3), at, { ...U, gain: 0.35 });
          for (let i = 0; i < 4; i++) e.burst(at + 0.06 + i * 0.045, 0.08, 'bandpass', 2600 + i * 300, 3800, 0.08, { ...U, q: 0.8, a: 0.01 });
          break;
        case 'close':
          e.burst(at, 0.12, 'bandpass', 3000, 1800, 0.08, { ...U, q: 0.8, a: 0.02 });
          e.play(e.modalBuf('wood', 43, 0.3), at + 0.08, { ...U, gain: 0.3 });
          break;
        case 'stamp':
          e.tone('sine', 150, 60, at, 0.14, 0.5, U);
          e.burst(at, 0.05, 'lowpass', 1000, 300, 0.35, U);
          break;
        case 'sell': case 'coin':
          for (let i = 0; i < (name === 'sell' ? 5 : 2); i++) {
            e.play(e.modalBuf(`coin${i % 3}`, 96 + (i % 3) * 3, 0.6, COIN, 0.05), at + i * 0.06 + e.rand() * 0.025, { ...U, gain: 0.2, rate: j(e, 0.04) });
          }
          break;
        case 'buy':
          e.play(e.modalBuf('coin0', 96, 0.6, COIN, 0.05), at, { ...U, gain: 0.2 });
          e.play(e.modalBuf('coin1', 99, 0.6, COIN, 0.05), at + 0.05, { ...U, gain: 0.18 });
          e.play(e.modalBuf('wood', 50, 0.3), at + 0.12, { ...U, gain: 0.3 });
          note(e, 'celesta', at + 0.2, 84, 1, 0.5, { bus: 'ui', wet: 0.3 });
          note(e, 'celesta', at + 0.29, 91, 1, 0.45, { bus: 'ui', wet: 0.3 });
          break;
        case 'upgrade':
          e.play(e.modalBuf('wood', 50, 0.3), at, { ...U, gain: 0.3 });
          [72, 76, 79, 84].forEach((m, i) => note(e, 'harp', at + 0.08 + i * 0.07, m, 1.5, 0.6, { bus: 'ui', wet: 0.35 }));
          break;
        case 'paint':
          e.burst(at, 0.35, 'bandpass', 900, 2600, 0.12, { ...U, q: 1.2, a: 0.08, kind: 'pink' });
          e.burst(at + 0.3, 0.3, 'bandpass', 2600, 900, 0.1, { ...U, q: 1.2, a: 0.08, kind: 'pink' });
          [79, 84].forEach((m, i) => note(e, 'celesta', at + 0.55 + i * 0.1, m, 1, 0.5, { bus: 'ui', wet: 0.35 }));
          break;
        case 'discover':
          [67, 71, 74, 79].forEach((m, i) => note(e, 'harp', at + i * 0.1, m, 2, 0.55, { bus: 'ui', wet: 0.45, pan: -0.2 + i * 0.12 }));
          note(e, 'celesta', at + 0.42, 86, 2, 0.45, { bus: 'ui', wet: 0.5 });
          break;
        case 'quest':
          note(e, 'celesta', at, 81, 1.4, 0.5, { bus: 'ui', wet: 0.4 });
          note(e, 'celesta', at + 0.14, 88, 1.6, 0.45, { bus: 'ui', wet: 0.4 });
          break;
        case 'reveal':
          note(e, 'celesta', at, 84, 1, 0.35, { bus: 'ui', wet: 0.4 });
          break;
        default: return;
      }
      e.log(`ui.${name}`);
    },

    /** Animal-Crossing-style murmur: one formant blip per syllable-ish letter, per-voice pitch. */
    murmur(at: number, text: string, pitch: number, p: Place = HERE, maxSecs = 2.2, rate = 13) {
      const VOW: Record<string, [number, number]> = { a: [750, 1200], e: [450, 1900], i: [320, 2300], o: [500, 900], u: [350, 800], y: [320, 2200] };
      let t = at, count = 0;
      const letters = text.toLowerCase().replace(/[^a-z ,.!?']/g, '');
      for (let i = 0; i < letters.length && t - at < maxSecs; i++) {
        const ch = letters[i];
        if (ch === ' ') { t += 0.5 / rate; continue; }
        if (/[,.!?]/.test(ch)) { t += 2.2 / rate; continue; }
        if (i % 2 === 1 && !VOW[ch]) continue; // fewer consonant blips: a syllable-ish rhythm
        const v = VOW[ch] ?? VOW['aeiou'[ch.charCodeAt(0) % 5]];
        const f0 = mtof(pitch + ((ch.charCodeAt(0) * 7) % 5) - 2 + (ch === '?' ? 3 : 0));
        const o = e.tone('triangle', f0, f0 * 0.94, t, 0.065, 0.11 * p.gain, { bus: 'sfx', pool: 'blip', pan: p.pan, lp: v[1] * 1.3, a: 0.006 });
        void o;
        count++;
        t += 1 / rate;
      }
      e.log('sfx.murmur', `${count} blips`);
      return t - at;
    },

    // modes table exported for the music module's bells
    MODES,
  };
  return sfx;
}
export type Sfx = ReturnType<typeof makeSfx>;
