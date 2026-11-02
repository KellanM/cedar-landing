/**
 * ui.fx(name): the single place for UI sound + haptics (ui_design §3.7).
 * Sounds are tiny WebAudio syntheses (no asset downloads). Haptics use navigator.vibrate,
 * feature-detected (Android only in practice); the design never relies on them.
 */
import { prefs } from './prefs';

export type FxName = 'tap' | 'nibble' | 'bite' | 'strain' | 'slip' | 'catch' | 'stamp' | 'sell' | 'page' | 'reveal';

const HAPTIC: Partial<Record<FxName, number | number[]>> = {
  nibble: [12], bite: [40, 30, 40], strain: [8], slip: [80], stamp: [25], sell: [10, 20, 10],
};

export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!prefs.sound) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// Browsers only start audio after a gesture: unlock on the first pointer/key.
const unlock = () => { if (prefs.sound) audio(); };
window.addEventListener('pointerdown', unlock, { once: true, capture: true });
window.addEventListener('keydown', unlock, { once: true, capture: true });

function env(g: GainNode, t: number, a: number, peak: number, d: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak = 0.5) {
  const c = ctx!, o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  env(g, at, 0.005, peak, dur);
  o.connect(g).connect(master!);
  o.start(at); o.stop(at + dur + 0.05);
}
function noise(at: number, dur: number, filter: BiquadFilterType, f0: number, f1: number, peak = 0.5, q = 1) {
  const c = ctx!, src = c.createBufferSource(), bq = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf;
  bq.type = filter; bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, at);
  bq.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + dur);
  env(g, at, 0.004, peak, dur);
  src.connect(bq).connect(g).connect(master!);
  src.start(at); src.stop(at + dur + 0.05);
}

const SOUNDS: Record<FxName, (t: number, v: number) => void> = {
  tap: (t) => { noise(t, 0.04, 'bandpass', 1800, 1200, 0.5, 4); tone('triangle', 520, 380, t, 0.05, 0.15); },
  nibble: (t) => tone('sine', 1100, 520, t, 0.12, 0.35),
  bite: (t) => {
    noise(t, 0.35, 'lowpass', 3000, 300, 0.7);
    for (let i = 0; i < 6; i++) noise(t + 0.18 + i * 0.045, 0.02, 'bandpass', 3200, 3000, 0.4, 8);
  },
  strain: (t, v) => tone('sawtooth', 70 + v * 90, 60 + v * 110, t, 0.18, 0.08),
  slip: (t) => noise(t, 0.45, 'bandpass', 600, 4200, 0.5, 3),
  catch: (t) => { noise(t, 0.09, 'lowpass', 1600, 400, 0.8); },
  stamp: (t) => { tone('sine', 140, 60, t, 0.16, 0.8); noise(t, 0.05, 'lowpass', 900, 300, 0.5); },
  sell: (t) => { for (let i = 0; i < 5; i++) tone('triangle', 1800 + Math.random() * 900, 1500, t + i * 0.05 + Math.random() * 0.02, 0.05, 0.22); },
  page: (t) => noise(t, 0.22, 'highpass', 800, 3000, 0.25),
  reveal: (t) => { for (let i = 0; i < 4; i++) noise(t + i * 0.07, 0.06, 'bandpass', 2600, 1900, 0.18, 2); },
};

/** Fire a UI feedback event. `v` is an optional intensity 0..1 (used by strain). */
export function fx(name: FxName, v = 0) {
  if (prefs.vibration && canVibrate && HAPTIC[name]) {
    try { navigator.vibrate(HAPTIC[name]!); } catch { /* ignore */ }
  }
  const c = audio();
  if (!c || c.state !== 'running') return;
  try { SOUNDS[name](c.currentTime + 0.005, v); } catch { /* ignore */ }
}
