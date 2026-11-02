/**
 * Pure-JS sample synthesis (no Web Audio): every instrument note, noise loop and the reverb
 * impulse is rendered here into Float32Arrays, then wrapped in AudioBuffers by the engine.
 * Deterministic for a given seed, so the offline test renders are reproducible.
 */

export type Rng = () => number;

/** mulberry32 */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** One-pole lowpass coefficient for a cutoff (Hz). */
const opc = (sr: number, fc: number) => 1 - Math.exp((-2 * Math.PI * fc) / sr);

// ------------------------------------------------------------------ plucked strings (Karplus–Strong)
export interface PluckOpts {
  /** 0..1 excitation brightness (pick hardness) */
  bright?: number;
  /** seconds for the note to fall 60 dB (approx, at the fundamental) */
  t60?: number;
  /** 0..0.5 pluck position along the string (comb notch) */
  pos?: number;
  /** 0..1 extra loss of highs per period (nylon / palm-muted feel) */
  damp?: number;
  /** body resonance amount (guitar box) 0..1 */
  body?: number;
}

/**
 * Extended Karplus–Strong: filtered-noise excitation with a pick-position comb, a loss filter
 * with frequency-independent decay set from t60, and a first-order allpass for fine tuning.
 */
export function pluck(sr: number, freq: number, dur: number, o: PluckOpts, r: Rng): Float32Array {
  const n = Math.max(1, Math.floor(sr * dur));
  const out = new Float32Array(n);
  const bright = o.bright ?? 0.5, t60 = o.t60 ?? 2.5, pos = o.pos ?? 0.18, damp = o.damp ?? 0.3, body = o.body ?? 0.4;
  // loss filter: y = g * ((1 - s) * x[n] + s * x[n-1]); s=0.5 is the classic averager (half-sample delay)
  const s = 0.5 * (0.35 + 0.65 * damp);
  const P = sr / freq - s; // total loop delay in samples, minus the loss filter's delay
  const N = Math.max(2, Math.floor(P - 0.1));
  const frac = P - N;
  const C = (1 - frac) / (1 + frac); // allpass for the fractional part
  // per-period gain for t60 (the averager also loses highs, which is what we want)
  const g = Math.pow(10, -3 / (t60 * freq));
  const buf = new Float32Array(N);
  // excitation: noise → one-pole lowpass (brightness) → pick-position comb
  const lp = opc(sr, 400 + bright * bright * 9000);
  let z = 0;
  const ex = new Float32Array(N);
  for (let i = 0; i < N; i++) { z += lp * ((r() * 2 - 1) - z); ex[i] = z; }
  const pd = Math.max(1, Math.round(pos * N));
  let mean = 0;
  for (let i = 0; i < N; i++) { buf[i] = ex[i] - (i >= pd ? ex[i - pd] : 0); mean += buf[i]; }
  mean /= N;
  let peak = 1e-6;
  for (let i = 0; i < N; i++) { buf[i] -= mean; peak = Math.max(peak, Math.abs(buf[i])); }
  for (let i = 0; i < N; i++) buf[i] /= peak;
  let idx = 0, prev = 0, apx = 0, apy = 0;
  for (let i = 0; i < n; i++) {
    const x = buf[idx];
    const lossy = g * ((1 - s) * x + s * prev);
    prev = x;
    // allpass: y[n] = C*x[n] + x[n-1] - C*y[n-1]
    const y = C * lossy + apx - C * apy;
    apx = lossy; apy = y;
    buf[idx] = y;
    out[i] = x;
    idx++; if (idx >= N) idx = 0;
  }
  // guitar-box body: two gentle resonances (~110 / ~240 Hz) mixed under the string
  if (body > 0) resonate(out, sr, [[105, 9, 0.35 * body], [235, 7, 0.25 * body]]);
  fadeIn(out, sr, 0.0015);
  fadeOut(out, sr, Math.min(0.08, dur * 0.2));
  return out;
}

/** Add parallel two-pole resonances [freq, Q, gain] to a buffer, in place. */
function resonate(x: Float32Array, sr: number, res: [number, number, number][]) {
  const add = new Float32Array(x.length);
  for (const [f, q, gain] of res) {
    const w = (2 * Math.PI * f) / sr, alpha = Math.sin(w) / (2 * q);
    const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w), a2 = 1 - alpha;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
      add[i] += y * gain * 4;
    }
  }
  for (let i = 0; i < x.length; i++) x[i] += add[i];
}

// ------------------------------------------------------------------ struck bars / bells (modal)
export interface Mode { ratio: number; amp: number; t60: number }

/** Sum of exponentially decaying sines + an optional soft mallet thump. */
export function modal(sr: number, freq: number, dur: number, modes: Mode[], r: Rng, click = 0.15, attack = 0.002): Float32Array {
  const n = Math.max(1, Math.floor(sr * dur));
  const out = new Float32Array(n);
  for (const m of modes) {
    const f = freq * m.ratio;
    if (f > sr * 0.45) continue;
    const w = (2 * Math.PI * f) / sr;
    const k = Math.exp(Math.log(0.001) / (m.t60 * sr));
    // recursive sine oscillator × exponential decay (cheap)
    let a = m.amp;
    const c = 2 * Math.cos(w);
    let s1 = Math.sin(r() * 6.283), s2 = Math.sin(Math.asin(s1) - w);
    for (let i = 0; i < n; i++) {
      const s0 = c * s1 - s2;
      s2 = s1; s1 = s0;
      out[i] += s0 * a;
      a *= k;
      if (a < 1e-5) break;
    }
  }
  if (click > 0) {
    const cn = Math.floor(sr * 0.012);
    let z = 0;
    const lp = opc(sr, Math.min(6000, freq * 4));
    for (let i = 0; i < cn && i < n; i++) { z += lp * ((r() * 2 - 1) - z); out[i] += z * click * (1 - i / cn); }
  }
  fadeIn(out, sr, attack);
  fadeOut(out, sr, Math.min(0.1, dur * 0.2));
  normalize(out, 0.9);
  return out;
}

/** Instrument mode tables. */
export const MODES = {
  // soft rosewood marimba-ish: tuned 1 : 4 : ~10 (bars), short highs
  marimba: [{ ratio: 1, amp: 1, t60: 1.1 }, { ratio: 3.93, amp: 0.22, t60: 0.35 }, { ratio: 9.4, amp: 0.05, t60: 0.12 }],
  // celesta / music box: bright, longer, octave + 3rd harmonic-ish
  celesta: [{ ratio: 1, amp: 1, t60: 2.4 }, { ratio: 2, amp: 0.18, t60: 1.0 }, { ratio: 3.01, amp: 0.1, t60: 0.6 }, { ratio: 5.43, amp: 0.035, t60: 0.25 }],
  // vibraphone-like soft metal (no motor)
  vibes: [{ ratio: 1, amp: 1, t60: 3.2 }, { ratio: 3.98, amp: 0.12, t60: 0.8 }, { ratio: 10.2, amp: 0.03, t60: 0.2 }],
  // ship's / hand bell: hum, prime, minor-third tierce, quint, nominal (church-bell ratios)
  bell: [{ ratio: 0.5, amp: 0.45, t60: 6 }, { ratio: 1, amp: 0.8, t60: 4 }, { ratio: 1.19, amp: 0.45, t60: 3.2 }, { ratio: 1.5, amp: 0.25, t60: 2.6 },
    { ratio: 2, amp: 0.5, t60: 2.2 }, { ratio: 2.51, amp: 0.15, t60: 1.4 }, { ratio: 2.66, amp: 0.12, t60: 1.2 }, { ratio: 3.01, amp: 0.1, t60: 1 }],
  // small chime (catch / quest): bright, clean
  chime: [{ ratio: 1, amp: 1, t60: 2.2 }, { ratio: 2.76, amp: 0.3, t60: 0.9 }, { ratio: 5.4, amp: 0.12, t60: 0.4 }, { ratio: 8.93, amp: 0.05, t60: 0.2 }],
  // wood block / plank knock
  wood: [{ ratio: 1, amp: 1, t60: 0.09 }, { ratio: 2.3, amp: 0.5, t60: 0.05 }, { ratio: 3.9, amp: 0.25, t60: 0.03 }],
} satisfies Record<string, Mode[]>;

// ------------------------------------------------------------------ noise
/** Seamless looping noise. kind: white | pink (Kellet) | brown (integrated, leaky). */
export function noiseLoop(sr: number, secs: number, kind: 'white' | 'pink' | 'brown', r: Rng): Float32Array {
  const n = Math.floor(sr * secs), xf = Math.floor(sr * 0.25);
  const raw = new Float32Array(n + xf);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = r() * 2 - 1;
    if (kind === 'white') raw[i] = w;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { br = (br + 0.02 * w) * 0.998; raw[i] = br * 3.5; }
  }
  // crossfade the tail into the head so the loop point is inaudible
  const out = raw.subarray(0, n);
  for (let i = 0; i < xf; i++) { const k = i / xf; out[i] = out[i] * k + raw[n + i] * (1 - k); }
  normalize(out, 0.7);
  return out;
}

// ------------------------------------------------------------------ reverb impulse
/** Stereo room/hall impulse: a few early reflections + exponentially decaying noise that darkens over time. */
export function impulse(sr: number, secs: number, r: Rng, damp = 0.6): [Float32Array, Float32Array] {
  const n = Math.floor(sr * secs);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const ch of [L, R]) {
    let z = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.pow(1 - i / n, 2.2) * Math.exp(-t * 2.2);
      const fc = 7000 * Math.exp(-t * (1.5 + damp * 3)) + 500; // highs die first
      z += opc(sr, fc) * ((r() * 2 - 1) - z);
      ch[i] = z * env;
    }
    // early reflections (small wooden room / harbour walls)
    for (const [ms, g] of [[11, 0.5], [19, 0.35], [29, 0.3], [41, 0.22], [57, 0.15]] as const) {
      const k = Math.floor((ms + r() * 4) * sr / 1000);
      if (k < n) ch[k] += g * (r() < 0.5 ? -1 : 1);
    }
    fadeIn(ch, sr, 0.004);
  }
  normalize(L, 0.5); normalize(R, 0.5);
  return [L, R];
}

// ------------------------------------------------------------------ boat engine
/**
 * One firing of a small single-cylinder gas engine ("putt"): a low pressure thump, a pipe-resonance
 * ring and a puff of exhaust noise. `heavy` = the Packer's bigger engine.
 */
export function putt(sr: number, r: Rng, heavy = false): Float32Array {
  const dur = heavy ? 0.16 : 0.12;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const f0 = heavy ? 52 : 68, f1 = heavy ? 34 : 44;
  let ph = 0, z = 0, z2 = 0;
  const lp = opc(sr, heavy ? 500 : 750), lp2 = opc(sr, 2400);
  const pipe = heavy ? 190 : 260;
  let p1 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, k = i / n;
    const f = f0 + (f1 - f0) * k;
    ph += (2 * Math.PI * f) / sr;
    const env = Math.exp(-t * (heavy ? 26 : 34)) * Math.min(1, t / 0.002);
    const w = r() * 2 - 1;
    z += lp * (w - z);
    z2 += lp2 * (w - z2);
    p1 += (2 * Math.PI * pipe) / sr;
    // thump: sine + its 2nd/3rd harmonics so a phone speaker still hears it
    const thump = Math.sin(ph) + 0.45 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph);
    out[i] = env * (0.75 * thump + 1.2 * z + 0.12 * z2 * Math.exp(-t * 60)) + 0.18 * Math.sin(p1) * Math.exp(-t * 45);
  }
  fadeOut(out, sr, 0.02);
  normalize(out, 0.9);
  return out;
}

// ------------------------------------------------------------------ helpers
export function normalize(x: Float32Array, to = 0.9) {
  let p = 1e-9;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  const k = to / p;
  for (let i = 0; i < x.length; i++) x[i] *= k;
}
export function fadeIn(x: Float32Array, sr: number, secs: number) {
  const n = Math.min(x.length, Math.floor(sr * secs));
  for (let i = 0; i < n; i++) x[i] *= i / n;
}
export function fadeOut(x: Float32Array, sr: number, secs: number) {
  const n = Math.min(x.length, Math.floor(sr * secs));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
}

/** Peak / RMS / clipped-sample stats (dBFS) for the offline renders. */
export function measure(chs: Float32Array[]) {
  let peak = 0, sum = 0, n = 0, clip = 0, silentBlocks = 0, blocks = 0;
  const blk = 2205;
  for (const c of chs) {
    for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; if (a >= 0.999) clip++; sum += c[i] * c[i]; n++; }
    for (let b = 0; b + blk <= c.length; b += blk) {
      let s = 0;
      for (let i = b; i < b + blk; i++) s += c[i] * c[i];
      blocks++;
      if (Math.sqrt(s / blk) < 0.0005) silentBlocks++; // below about -66 dBFS
    }
  }
  const db = (v: number) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -Infinity);
  // spectral balance (mono sum, one-pole splits at 44.1 kHz): share of energy below 200 Hz (lost on
  // phone speakers), 200 Hz–4 kHz (what a phone plays), and above 4 kHz (air / harshness)
  let lo = 0, hiE = 0, tot = 0, zl = 0, zh = 0;
  const a1 = 1 - Math.exp(-2 * Math.PI * 200 / 44100), a2 = 1 - Math.exp(-2 * Math.PI * 4000 / 44100);
  const m0 = chs[0], m1 = chs[1] ?? chs[0];
  for (let i = 0; i < m0.length; i++) {
    const x = 0.5 * (m0[i] + m1[i]);
    zl += a1 * (x - zl); zh += a2 * (x - zh);
    const h = x - zh;
    lo += zl * zl; hiE += h * h; tot += x * x;
  }
  const pct = (v: number) => (tot > 0 ? +(100 * v / tot).toFixed(1) : 0);
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / Math.max(1, n))), clipped: clip, silentPct: blocks ? +(100 * silentBlocks / blocks).toFixed(1) : 100,
    bandPct: { below200: pct(lo), mid: +(100 - pct(lo) - pct(hiE)).toFixed(1), above4k: pct(hiE) } };
}
