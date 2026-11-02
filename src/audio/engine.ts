/**
 * Audio engine: buses, mix chain, sample cache, voice accounting and a cheap positional helper.
 * Works on any BaseAudioContext, so the same graph renders live (AudioContext) and offline
 * (OfflineAudioContext, for the headless level tests).
 *
 *   music ─┐                 ┌─ reverb send (generated impulse) ─┐
 *   sfx   ─┼─► mix ─► hp 35 Hz ─► glue compressor ─► limiter ─► master ─► out
 *   amb   ─┤                 └───────────────────────────────────┘
 *   ui    ─┘
 */
import { MODES, impulse, modal, mtof, noiseLoop, pluck, putt, rng, type Mode, type PluckOpts } from './dsp';

export type Bus = 'music' | 'sfx' | 'amb' | 'ui';

/** Live-tunable mix knobs (the ?tune overlay edits these). */
export const AUDIO_TUNING = {
  music: 0.55, // bus trims (× the player's Music / Sound settings)
  sfx: 0.8,
  amb: 0.5,
  ui: 0.55,
  reverb: 0.22, // global wet send
  engine: 0.7, // boat engine level within sfx
  wake: 0.6,
  gapMin: 75, // s of silence between music pieces
  gapMax: 210,
  blip: 1, // NPC talk blip level
};

export interface VoiceOpts {
  bus?: Bus;
  gain?: number;
  rate?: number;
  pan?: number;
  /** wet send 0..1 (× AUDIO_TUNING.reverb) */
  wet?: number;
  /** lowpass cutoff (Hz) for distance / muffling */
  lp?: number;
  /** stop after (s) with a short fade */
  dur?: number;
  /** voice pool name for capping */
  pool?: string;
  /** route into this node instead of the bus (music sub-mixes) */
  dest?: AudioNode;
}

const POOL_CAP: Record<string, number> = { music: 48, sfx: 24, amb: 14, ui: 10, engine: 8, blip: 36 };

export class AudioEngine {
  readonly ctx: BaseAudioContext;
  readonly sr: number;
  readonly buses: Record<Bus, GainNode>;
  private wetIn: GainNode;
  private wetOut: GainNode;
  readonly master: GainNode;
  private comp: DynamicsCompressorNode;
  private limiter: DynamicsCompressorNode;
  /** player volume (0..1) for music and for sound (sfx + amb + ui) */
  vol = { music: 0.7, sound: 1 };
  private cache = new Map<string, AudioBuffer>();
  private pools = new Map<string, number>();
  active = 0;
  peakActive = 0;
  dropped = 0;
  private r = rng(1234);
  /** listener (camera) for positional one-shots: x, z, yaw (rad, three.js convention) */
  listener = { x: 0, z: 0, yaw: 0 };
  /** recent events (debug / tests) */
  readonly events: { t: number; name: string; detail?: string }[] = [];
  eventCount: Record<string, number> = {};

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    const mk = () => ctx.createGain();
    const mix = mk();
    this.buses = { music: mk(), sfx: mk(), amb: mk(), ui: mk() };
    for (const b of Object.values(this.buses)) b.connect(mix);
    // reverb
    const conv = ctx.createConvolver();
    const [L, R] = impulse(this.sr, 2.4, rng(77));
    const ir = ctx.createBuffer(2, L.length, this.sr);
    ir.getChannelData(0).set(L); ir.getChannelData(1).set(R);
    conv.buffer = ir;
    this.wetIn = mk();
    this.wetOut = mk();
    const wetHp = ctx.createBiquadFilter();
    wetHp.type = 'highpass'; wetHp.frequency.value = 180; // keep the tail out of the low end (mud on phones)
    this.wetIn.connect(wetHp).connect(conv).connect(this.wetOut).connect(mix);
    // mix chain
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 35; hp.Q.value = 0.7;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20; this.comp.knee.value = 12; this.comp.ratio.value = 2.5;
    this.comp.attack.value = 0.015; this.comp.release.value = 0.3;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
    this.master = mk();
    this.master.gain.value = 1.45; // ≈ +3 dB over unity into the limiter: phone speakers want level
    mix.connect(hp).connect(this.comp).connect(this.limiter).connect(this.master).connect(ctx.destination);
    this.applyLevels(true);
  }

  get now() { return this.ctx.currentTime; }

  /** Push bus levels (tuning × player volume). */
  applyLevels(instant = false) {
    const T = AUDIO_TUNING;
    const set = (g: AudioParam, v: number) => { if (instant) g.value = v; else g.setTargetAtTime(v, this.ctx.currentTime, 0.08); };
    set(this.buses.music.gain, T.music * this.vol.music * this.vol.music); // squared: a perceptual taper
    const s = this.vol.sound * this.vol.sound;
    set(this.buses.sfx.gain, T.sfx * s);
    set(this.buses.amb.gain, T.amb * s);
    set(this.buses.ui.gain, T.ui * s);
    set(this.wetOut.gain, T.reverb * 4);
  }

  log(name: string, detail?: string) {
    this.events.push({ t: +this.now.toFixed(2), name, detail });
    if (this.events.length > 60) this.events.shift();
    this.eventCount[name] = (this.eventCount[name] ?? 0) + 1;
  }

  // -------------------------------------------------------------- samples
  /** Cached AudioBuffer from a pure-JS render. */
  sample(key: string, make: () => Float32Array): AudioBuffer {
    let b = this.cache.get(key);
    if (!b) {
      const data = make();
      b = this.ctx.createBuffer(1, data.length, this.sr);
      b.getChannelData(0).set(data);
      if (this.cache.size > 260) { const first = this.cache.keys().next().value; if (first !== undefined) this.cache.delete(first); }
      this.cache.set(key, b);
    }
    return b;
  }
  pluckBuf(name: string, midi: number, dur: number, o: PluckOpts) {
    return this.sample(`p:${name}:${midi}`, () => pluck(this.sr, mtof(midi), dur, o, rng(midi * 31 + name.length)));
  }
  modalBuf(name: keyof typeof MODES | string, midi: number, dur: number, modes?: Mode[], click = 0.15) {
    return this.sample(`m:${name}:${midi}`, () => modal(this.sr, mtof(midi), dur, modes ?? MODES[name as keyof typeof MODES], rng(midi * 17 + 3), click));
  }
  noise(kind: 'white' | 'pink' | 'brown', secs = 4) {
    return this.sample(`n:${kind}:${secs}`, () => noiseLoop(this.sr, secs, kind, rng(kind.length * 97 + secs)));
  }
  puttBuf(heavy: boolean, v: number) {
    return this.sample(`putt:${heavy}:${v}`, () => putt(this.sr, rng(900 + v), heavy));
  }
  get rand() { return this.r; }

  // -------------------------------------------------------------- voices
  /** Reserve a voice slot in a pool; false = over the cap (drop the sound). */
  claim(pool: string) {
    const n = this.pools.get(pool) ?? 0;
    if (n >= (POOL_CAP[pool] ?? 12)) { this.dropped++; return false; }
    this.pools.set(pool, n + 1);
    this.active++;
    this.peakActive = Math.max(this.peakActive, this.active);
    return true;
  }
  release(pool: string) {
    this.pools.set(pool, Math.max(0, (this.pools.get(pool) ?? 1) - 1));
    this.active = Math.max(0, this.active - 1);
  }
  poolCounts() { return Object.fromEntries(this.pools); }

  /**
   * Route a source through gain → (lowpass) → panner → bus (+ reverb send). Returns the gain node
   * so callers can shape an envelope. The voice is released when `src` ends.
   */
  route(src: AudioScheduledSourceNode, at: number, o: VoiceOpts, stopAt: number): GainNode {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = o.gain ?? 1;
    let node: AudioNode = g;
    src.connect(g);
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.5;
      node.connect(f); node = f;
    }
    if (o.pan) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p); node = p;
    }
    node.connect(o.dest ?? this.buses[o.bus ?? 'sfx']);
    if (o.wet) {
      const w = c.createGain();
      w.gain.value = o.wet;
      node.connect(w).connect(this.wetIn);
    }
    const pool = o.pool ?? o.bus ?? 'sfx';
    src.onended = () => { this.release(pool); try { src.disconnect(); g.disconnect(); } catch { /* ignore */ } };
    src.start(at);
    src.stop(stopAt);
    return g;
  }

  /** Play a buffer. */
  play(buf: AudioBuffer, at: number, o: VoiceOpts = {}): GainNode | null {
    const pool = o.pool ?? o.bus ?? 'sfx';
    if (!this.claim(pool)) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    if (o.rate) s.playbackRate.value = o.rate;
    const len = buf.duration / (o.rate ?? 1);
    const end = at + Math.min(len, o.dur ?? len);
    const g = this.route(s, at, o, end + 0.02);
    if (o.dur && o.dur < len) {
      g.gain.setValueAtTime(o.gain ?? 1, end - 0.04);
      g.gain.linearRampToValueAtTime(0, end);
    }
    return g;
  }

  /** Oscillator with an AD(SR) envelope. f1 = glide target. */
  tone(type: OscillatorType | PeriodicWave, f0: number, f1: number, at: number, dur: number, peak: number, o: VoiceOpts & { a?: number } = {}) {
    const pool = o.pool ?? o.bus ?? 'sfx';
    if (!this.claim(pool)) return null;
    const c = this.ctx, osc = c.createOscillator();
    if (typeof type === 'string') osc.type = type as OscillatorType; else osc.setPeriodicWave(type);
    osc.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    const g = this.route(osc, at, { ...o, gain: 0 }, at + dur + 0.05);
    const a = o.a ?? 0.005;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(a + 0.01, dur));
    return { osc, g };
  }

  /** Filtered noise burst. */
  burst(at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, o: VoiceOpts & { q?: number; a?: number; kind?: 'white' | 'pink' | 'brown' } = {}) {
    const pool = o.pool ?? o.bus ?? 'sfx';
    if (!this.claim(pool)) return null;
    const c = this.ctx, s = c.createBufferSource();
    s.buffer = this.noise(o.kind ?? 'white');
    s.loop = true;
    s.loopStart = 0;
    const off = this.r() * 3;
    const bq = c.createBiquadFilter();
    bq.type = type; bq.Q.value = o.q ?? 1;
    bq.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + dur);
    s.connect(bq);
    // route() connects src→gain; re-point: we connect the filter instead
    const g = c.createGain();
    g.gain.value = 0;
    bq.connect(g);
    let node: AudioNode = g;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
    if (o.pan) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(p); node = p; }
    node.connect(this.buses[o.bus ?? 'sfx']);
    if (o.wet) { const w = c.createGain(); w.gain.value = o.wet; node.connect(w).connect(this.wetIn); }
    const a = o.a ?? 0.004;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(a + 0.01, dur));
    s.onended = () => { this.release(pool); try { s.disconnect(); bq.disconnect(); g.disconnect(); } catch { /* ignore */ } };
    s.start(at, off);
    s.stop(at + dur + 0.05);
    return { src: s, bq, g };
  }

  /** A long-lived looping bed (not counted against the pools). Returns its gain + filter for automation. */
  bed(kind: 'white' | 'pink' | 'brown', type: BiquadFilterType, freq: number, q: number, bus: Bus = 'amb', type2?: BiquadFilterType, freq2?: number) {
    const c = this.ctx, s = c.createBufferSource();
    s.buffer = this.noise(kind, 6);
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.value = 0;
    let n: AudioNode = s.connect(f);
    let f2: BiquadFilterNode | null = null;
    if (type2) { f2 = c.createBiquadFilter(); f2.type = type2; f2.frequency.value = freq2 ?? 1000; f2.Q.value = 0.6; n = n.connect(f2); }
    const p = c.createStereoPanner();
    n.connect(g).connect(p).connect(this.buses[bus]);
    s.start(this.now, this.r() * 5);
    return { src: s, f, f2, g, pan: p };
  }

  /** Reverb send node (for long-lived voices that manage their own routing). */
  get send() { return this.wetIn; }

  /**
   * Cheap positional cue for a world point: distance falloff (gain), stereo pan from the bearing
   * relative to the listener's facing, and a distance lowpass. null = out of earshot.
   */
  spatial(x: number, z: number, ref = 25, max = 220): { gain: number; pan: number; lp: number } | null {
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    if (d > max) return null;
    const gain = 1 / (1 + (d / ref) * (d / ref)) * (1 - Math.pow(d / max, 3));
    if (gain < 0.01) return null;
    // listener forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const pan = d > 0.5 ? ((dx * rx + dz * rz) / d) * 0.75 : 0;
    const lp = 18000 / (1 + d / 40);
    return { gain, pan, lp: Math.max(900, lp) };
  }
}
