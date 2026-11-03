/**
 * Game-facing audio: created on the first user gesture (mobile autoplay rules), suspended while
 * the tab is hidden. main.ts calls frame() once per frame with a small state snapshot and a few
 * event methods (fishing beats, wildlife, footsteps, talk); src/ui/fx.ts routes UI sounds here.
 * Nothing touches Web Audio before the first gesture.
 */
import { AUDIO_TUNING, AudioEngine } from './engine';
import { Ambience, BoatAudio, type Spot, type Zones } from './ambience';
import { MusicDirector, compose, type Guise, type MusicContext, type Variant } from './music';
import { makeSfx, type Place, type Sfx } from './sfx';
import { measure } from './dsp';
import { makeFanfare, type Fanfare, type FanMods, type FanTier } from './fanfare';
import { PAD_EXP } from './pads';

export interface AudioFrame {
  cam: { x: number; z: number; yaw: number };
  boat: { x: number; z: number; speed: number; maxSpeed: number; throttle: number; moored: boolean; heavy: boolean };
  onFoot: boolean;
  feet?: { x: number; z: number };
  tod: string;
  /** clock hour 0..24 (music: dawn / day / dusk / night) */
  hour?: number;
  /** weather 0..1 (docs/rain_study.md) */
  rain?: number;
  storm?: number;
  fishing: { phase: string; tension: number; reelHeld: boolean; thrashing: boolean; distance: number; bobber: { x: number; z: number } };
}

const TOWN_KINDS = new Set(['sell_fish', 'moor_boat', 'buy_tackle', 'buy_bait', 'buy_food', 'buy_boat', 'buy_dive_gear', 'upgrade_bench', 'weigh_fish', 'trophy_wall', 'mailbox', 'request_board']);

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the piece's key, folded into the fanfare's comfortable register (C4..F#4) */
const fanTonic = (t: number) => 60 + (((t - 60) % 12) + 12) % 12 - ((((t - 60) % 12) + 12) % 12 > 6 ? 12 : 0);

class GameAudio {
  e: AudioEngine | null = null;
  sfx: Sfx | null = null;
  fan: Fanfare | null = null;
  music: MusicDirector | null = null;
  amb: Ambience | null = null;
  boat: BoatAudio | null = null;
  private ctx: AudioContext | null = null;
  private vol = { music: 0.7, sound: 1 };
  private town: { x: number; z: number }[] = [];
  /** music places: the village (its people) and Keeper's Cove (home mooring) */
  private village: { x: number; z: number }[] = [];
  private cove: { x: number; z: number }[] = [];
  /** music place weights, eased like the ambience zones */
  places = { village: 0, cove: 0 };
  private spots: Spot[] = [];
  private landNear: ((x: number, z: number, r: number) => boolean) | null = null;
  zones: Zones = { harbour: 0, shore: 0, open: 1, forest: 0 };
  private zoneT = 0;
  private lastPhase = 'idle';
  private clickAcc = 0;
  private lastDist = 0;
  private strain: { src: AudioBufferSourceNode; f: BiquadFilterNode; g: GainNode; o: OscillatorNode; og: GainNode } | null = null;
  private lastFrame: AudioFrame | null = null;
  private pendingUI: string[] = [];
  readonly status = { created: false, gesture: false, hiddenSuspends: 0, frames: 0 };

  /** Wire gesture + visibility listeners. Call once at boot. */
  attach() {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) { this.status.hiddenSuspends++; this.ctx.suspend().catch(() => {}); } else this.ctx.resume().catch(() => {});
    });
    window.addEventListener('pagehide', () => { this.ctx?.suspend().catch(() => {}); });
  }

  private unlock() {
    this.status.gesture = true;
    if (!this.ctx) {
      if (this.vol.music <= 0 && this.vol.sound <= 0) return; // fully muted: don't even start
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
      this.e = new AudioEngine(this.ctx);
      this.e.vol = { ...this.vol };
      this.e.applyLevels(true);
      this.sfx = makeSfx(this.e);
      this.fan = makeFanfare(this.e);
      this.amb = new Ambience(this.e, this.sfx);
      this.amb.spots = this.spots;
      this.boat = new BoatAudio(this.e);
      this.music = new MusicDirector(this.e);
      this.status.created = true;
      this.e.log('audio.start', `${this.ctx.sampleRate} Hz`);
    }
    if (this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {});
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Player volumes 0..1 (Log → Settings). */
  setVolumes(music: number, sound: number) {
    this.vol = { music, sound };
    if (this.e) { this.e.vol = { music, sound }; this.e.applyLevels(); }
  }

  /** World data: town (harbour) points, bird / haul-out spots, a land test for the shore zone. */
  setWorld(interacts: { kind: string; pos: number[]; name?: string }[], birds: { species?: string; kind?: string; pos?: number[]; center?: number[] }[], mammals: { species?: string; kind?: string; pos?: number[] }[], landNear: (x: number, z: number, r: number) => boolean, npcs?: { pos?: number[]; props?: Record<string, unknown> }[], spawn?: number[]) {
    this.town = interacts.filter((i) => TOWN_KINDS.has(i.kind)).map((i) => ({ x: i.pos[0], z: i.pos[2] }));
    // music places: the village = where its people are; Keeper's Cove = the home mooring
    this.village = (npcs ?? []).filter((n) => n.pos && n.props?.culture === 'village').map((n) => ({ x: n.pos![0], z: n.pos![2] }));
    if (!this.village.length) this.village = interacts.filter((i) => /village/i.test(i.name ?? '')).map((i) => ({ x: i.pos[0], z: i.pos[2] }));
    this.cove = interacts.filter((i) => /keeper/i.test(i.name ?? '')).map((i) => ({ x: i.pos[0], z: i.pos[2] }));
    if (spawn) this.cove.push({ x: spawn[0], z: spawn[2] });
    const sp: Spot[] = [];
    for (const b of birds) {
      const p = b.center ?? b.pos;
      if (!p || !b.species || b.kind === 'hotspot') continue; // hotspot frenzies speak through onSquawk
      sp.push({ x: p[0], z: p[2], kind: b.species });
    }
    for (const m of mammals) {
      if (!m.pos || !m.species) continue;
      if (m.species === 'sea_lion' || (m.species === 'harbor_seal' && m.kind === 'haulout')) sp.push({ x: m.pos[0], z: m.pos[2], kind: m.species });
    }
    this.spots.length = 0;
    this.spots.push(...sp);
    this.landNear = landNear;
  }

  private computeZones(f: AudioFrame) {
    const x = f.onFoot && f.feet ? f.feet.x : f.boat.x, z = f.onFoot && f.feet ? f.feet.z : f.boat.z;
    let dt = Infinity;
    for (const p of this.town) dt = Math.min(dt, Math.hypot(p.x - x, p.z - z));
    const harbour = 1 - smooth(45, 120, dt);
    let shore = 0;
    if (f.onFoot) shore = 1;
    else if (this.landNear) shore = this.landNear(x, z, 14) ? 1 : this.landNear(x, z, 35) ? 0.65 : this.landNear(x, z, 70) ? 0.3 : 0;
    const forest = Math.max(0, shore - harbour) * (f.onFoot ? 1 : 0.8);
    const open = Math.max(0, 1 - Math.max(harbour, shore));
    // ease toward the targets so crossfades take a few seconds
    const k = 0.35;
    const Z = this.zones;
    Z.harbour += (harbour - Z.harbour) * k; Z.shore += (shore - Z.shore) * k; Z.forest += (forest - Z.forest) * k; Z.open += (open - Z.open) * k;
    // music places: the village sits 25-45 m from the town's shops, so weigh nearness against the town
    const near = (pts: { x: number; z: number }[]) => { let d = Infinity; for (const p of pts) d = Math.min(d, Math.hypot(p.x - x, p.z - z)); return d; };
    const dv = near(this.village), dc = near(this.cove);
    const vil = (1 - smooth(18, 45, dv)) * smooth(-6, 10, dt - dv);
    const cove = 1 - smooth(30, 70, dc);
    const P = this.places;
    P.village += (vil - P.village) * k; P.cove += (cove - P.cove) * k;
  }

  frame(dt: number, f: AudioFrame) {
    this.lastFrame = f;
    const e = this.e;
    if (!e || !this.running) return;
    this.status.frames++;
    // flush UI sounds that arrived in the same gesture that created the context
    if (this.pendingUI.length) { const q = this.pendingUI; this.pendingUI = []; for (const n of q) this.ui(n); }
    e.listener.x = f.cam.x; e.listener.z = f.cam.z; e.listener.yaw = f.cam.yaw;
    this.zoneT -= dt;
    if (this.zoneT <= 0) { this.zoneT = 0.25; this.computeZones(f); }
    const speed = f.onFoot ? 0 : Math.min(1, Math.abs(f.boat.speed) / Math.max(1, f.boat.maxSpeed));
    const soundOn = this.vol.sound > 0;
    if (soundOn) {
      this.amb!.update(dt, { zones: this.zones, tod: f.tod, speed, onFoot: f.onFoot, moored: f.boat.moored, rain: f.rain ?? 0, storm: f.storm ?? 0 });
      this.boat!.update(dt, f.boat.throttle, speed, !f.onFoot && !f.boat.moored, f.boat.heavy);
      this.fishingFrame(dt, f);
    } else { this.stopStrain(); this.lastPhase = f.fishing.phase; }
    // rain softens the music a little (A Short Hike / Sasquatch keep playing; it just sits back)
    const duck = 1 - 0.28 * Math.min(1, f.rain ?? 0) - 0.12 * (f.storm ?? 0);
    if (Math.abs(duck - e.musicDuck) > 0.02) { e.musicDuck = duck; e.applyLevels(); }
    const fighting = f.fishing.phase === 'reeling';
    this.music!.update(this.musicCtx(f, fighting), this.vol.music > 0);
  }

  private musicCtx(f: AudioFrame, fighting: boolean): MusicContext {
    return {
      tod: f.tod, hour: f.hour, town: Math.max(0, this.zones.harbour - this.places.village - this.places.cove), village: this.places.village, cove: this.places.cove,
      rain: f.rain ?? 0, storm: f.storm ?? 0, fighting, tension: f.fishing.tension, thrashing: f.fishing.thrashing,
    };
  }

  private bobberPlace(f: AudioFrame): Place {
    return this.e!.spatial(f.fishing.bobber.x, f.fishing.bobber.z, 18, 120) ?? { gain: 0.5, pan: 0, lp: 8000 };
  }

  private fishingFrame(dt: number, f: AudioFrame) {
    const e = this.e!, S = this.sfx!, F = f.fishing, ph = F.phase;
    if (ph !== this.lastPhase) {
      const prev = this.lastPhase;
      this.lastPhase = ph;
      if (ph === 'casting') S.cast(e.now + 0.01);
      if (prev === 'casting' && ph === 'waiting') S.plop(e.now + 0.01, this.bobberPlace(f));
      if (ph === 'reeling') this.startStrain();
      if (prev === 'reeling') this.stopStrain();
      this.lastDist = F.distance;
    }
    if (ph === 'reeling') {
      // reel clicks: the ratchet rate follows the crank (held) or the fish taking line (drag)
      const dd = (F.distance - this.lastDist) / Math.max(1e-3, dt);
      this.lastDist = F.distance;
      const drag = !F.reelHeld && dd > 0.05;
      const rate = F.reelHeld ? 14 + 10 * F.tension : drag ? 8 + 10 * Math.min(1.2, dd) : 0;
      this.clickAcc += rate * dt;
      let n = 0;
      while (this.clickAcc >= 1 && n < 4) { this.clickAcc -= 1; S.click(e.now + 0.01 + n * (1 / Math.max(rate, 1)), drag); n++; }
      if (this.clickAcc > 1) this.clickAcc = 0;
      // line strain voice
      const s = this.strain;
      if (s) {
        const ten = Math.max(0, F.tension - 0.25) / 0.75;
        s.g.gain.setTargetAtTime(0.16 * ten * ten * (F.reelHeld ? 1 : 0.5), e.now, 0.06);
        s.f.frequency.setTargetAtTime(500 + 1500 * F.tension, e.now, 0.06);
        s.og.gain.setTargetAtTime(F.tension > 0.7 ? 0.02 * (F.tension - 0.7) / 0.3 : 0, e.now, 0.08);
        s.o.frequency.setTargetAtTime(900 + 900 * F.tension + (F.thrashing ? 60 * Math.sin(e.now * 40) : 0), e.now, 0.05);
      }
    }
  }

  private startStrain() {
    const e = this.e!, c = e.ctx;
    if (this.strain) return;
    const src = c.createBufferSource();
    src.buffer = e.noise('white');
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 9; f.frequency.value = 700;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(e.buses.sfx);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 1000;
    const og = c.createGain(); og.gain.value = 0;
    o.connect(og).connect(e.buses.sfx);
    src.start(); o.start();
    this.strain = { src, f, g, o, og };
    e.log('sfx.strainOn');
  }
  private stopStrain() {
    const s = this.strain;
    if (!s || !this.e) return;
    const now = this.e.now;
    s.g.gain.setTargetAtTime(0, now, 0.05); s.og.gain.setTargetAtTime(0, now, 0.05);
    s.src.stop(now + 0.4); s.o.stop(now + 0.4);
    this.strain = null;
    this.e.log('sfx.strainOff');
  }

  // -------------------------------------------------------------- events from main.ts
  private at() { return this.e!.now + 0.01; }
  /** A lightning strike now: thunder arrives after distM / 343 s. Returns the delay (s), or -1 if muted. */
  thunder(distM: number, near: boolean, x?: number, z?: number) {
    if (!this.ok()) return -1;
    let pan = 0;
    if (x !== undefined && z !== undefined) pan = this.e!.spatial(x, z, 1e6, 1e7)?.pan ?? 0;
    return this.amb!.thunder(distM, near, pan);
  }

  private ok() { return !!this.e && this.running && this.vol.sound > 0; }
  private place(x: number, z: number, ref = 18, max = 160): Place | null { return this.e!.spatial(x, z, ref, max); }

  nibble() { if (this.ok() && this.lastFrame) this.sfx!.nibble(this.at(), this.bobberPlace(this.lastFrame)); }
  bite() { if (this.ok() && this.lastFrame) this.sfx!.bite(this.at(), this.bobberPlace(this.lastFrame)); }
  strike(x: number, z: number, r: number) { if (this.ok()) this.sfx!.strike(this.at(), r, this.place(x, z) ?? undefined); }
  thrash(x: number, z: number, r: number) { if (this.ok()) this.sfx!.thrash(this.at(), r, this.place(x, z) ?? undefined); }
  leap(x: number, z: number, r: number) { if (this.ok()) this.sfx!.leap(this.at(), r, this.place(x, z) ?? undefined); }
  breach(x: number, z: number, r: number) { if (this.ok()) this.sfx!.breach(this.at(), r, this.place(x, z) ?? undefined); }
  slip() { if (this.ok()) this.sfx!.slip(this.at()); }
  /** fish in hand: slap + chime; music resolves. big = rare/legendary or first of its kind */
  landed(big: boolean) {
    if (!this.e || !this.running) return;
    const tonic = this.music?.lastTonic ?? 62;
    if (this.vol.sound > 0) { this.sfx!.slap(this.at()); this.sfx!.chime(this.at() + 0.05, tonic, big); }
    if (this.vol.music > 0) this.music?.resolve(big);
    this.music?.duck(big ? 4 : 2.5, 0.4); // whatever else plays sits under the catch sting
  }
  /** Catch victory (docs/catch_study.md F5): the fish leaves the water. lead = s until the reveal. */
  catchPullout(tier: FanTier, lead: number) {
    if (this.ok()) this.fan!.pullout(this.at(), fanTonic(this.music?.lastTonic ?? 62), tier, lead);
  }
  /** Fish in hand: slap + the tier's fanfare (SFX bus, so it plays with the music off); the music bed
   *  resolves under the small ones and just gets out of the way of the big fanfares. */
  catchReveal(tier: FanTier, mods: FanMods) {
    if (!this.e || !this.running) return;
    const tonic = fanTonic(this.music?.lastTonic ?? 62);
    if (this.vol.sound > 0) { this.sfx!.slap(this.at()); this.fan!.reveal(this.at() + 0.05, tonic, tier, mods); }
    if (this.vol.music > 0) this.music?.resolve(tier === 'common' || !!mods.first, tier === 'uncommon' || tier === 'rare' || tier === 'legendary');
  }
  keep() { if (this.ok()) this.sfx!.keep(this.at()); }
  release() { if (this.ok()) this.sfx!.release(this.at()); }

  private lastAt: Record<string, number> = {};
  /** at most one cue of a kind per `gap` seconds (frenzies squawk in bursts; pods blow in rows) */
  private limit(kind: string, gap: number) {
    const now = this.e!.now;
    if (now - (this.lastAt[kind] ?? -1e9) < gap) return false;
    this.lastAt[kind] = now;
    return true;
  }
  /** ocean pass 2: a wave crashing over the bow (gain 0..1) and a hull creak in heavy seas */
  seaCrash(gain: number) {
    if (!this.ok() || !this.limit('seacrash', 0.6)) return;
    const g = Math.min(1, Math.max(0.2, gain));
    this.sfx!.bigSplash(this.at(), g > 0.6 ? 'breach' : 'slap', { gain: g, pan: 0, lp: 9000 });
  }
  hullCreak() { if (this.ok() && this.limit('hullcreak', 2.5)) this.sfx!.creak(this.at(), { gain: 2.2, pan: (Math.random() - 0.5) * 0.6, lp: 4000 }); }
  squawk(x: number, z: number, intensity: number) {
    if (!this.ok() || !this.limit('gull', 1.4 - 0.6 * Math.min(1, intensity))) return;
    const p = this.place(x, z, 25, 180);
    if (p) this.sfx!.gull(this.at() + Math.random() * 0.2, { ...p, gain: Math.min(1, p.gain * (0.6 + intensity)) });
  }
  mammal(kind: 'blow' | 'breach' | 'slap' | 'seal', x: number, z: number, sp = '') {
    if (!this.ok()) return;
    if (kind === 'blow' && !this.limit(`blow:${sp}`, /humpback/.test(sp) ? 3 : 1.8)) return;
    const small = /dolphin|porpoise/.test(sp);
    const big = !small && (kind === 'breach' || /orca|humpback/.test(sp));
    const p = this.place(x, z, big ? 40 : 22, big ? 360 : 180);
    if (!p) return;
    if (kind === 'blow') this.sfx!.blow(this.at(), sp || 'orca', p);
    else if (kind === 'seal') this.sfx!.splash(this.at(), sp === 'lion' ? 1 : 0.7, p);
    else if (small) this.sfx!.splash(this.at(), 1.3, p);
    else this.sfx!.bigSplash(this.at(), kind, p);
  }
  step(surface: string, speed: number) { if (this.ok()) this.sfx!.step(this.at(), surface, speed); }
  /** NPC talk murmur: pitch from the name (stable per NPC), kids higher, cats meow */
  talk(name: string, text: string, role: string, x?: number, z?: number) {
    if (!this.ok()) return;
    if (role === 'cat') { this.meow(); return; }
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const base = /kid|child/i.test(role + name) ? 74 : (h % 2 ? 57 : 64);
    const pitch = base + (h % 7) - 3;
    const p = x !== undefined && z !== undefined ? this.place(x, z, 8, 60) ?? undefined : undefined;
    this.sfx!.murmur(this.at(), text, pitch, p ? { ...p, gain: Math.min(1, p.gain * 1.6) } : undefined, 2.2, 13 + (h % 4));
  }
  /** dialogue strip voice (one blip per typed chunk) */
  voice(who: string, text: string, secs = 1.5) {
    if (!this.ok()) return;
    let h = 0;
    for (const ch of who) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const pitch = /gran/i.test(who) ? 58 : 56 + (h % 10);
    this.sfx!.murmur(this.at(), text, pitch, undefined, secs, 14);
    this.music?.duck(secs + 2.5, 0.5); // the score steps back under dialogue
  }
  private meow() {
    const e = this.e!;
    const t = this.at();
    e.tone('sawtooth', 700, 520, t, 0.45, 0.05, { bus: 'sfx', lp: 1800, a: 0.06 })?.osc.frequency.linearRampToValueAtTime(900, t + 0.15);
    e.log('sfx.meow');
  }

  /** UI sound (from src/ui/fx.ts). Queued if the gesture that triggers it also creates the context. */
  ui(name: string) {
    if (!this.e) { if (this.status.gesture) this.pendingUI.push(name); return; }
    if (!this.running || this.vol.sound <= 0) { if (this.pendingUI.length < 4) this.pendingUI.push(name); return; }
    this.sfx!.ui(this.at(), name);
  }

  // -------------------------------------------------------------- debug / tests
  state() {
    const e = this.e;
    const m = this.music;
    return {
      ctx: this.ctx?.state ?? 'none', ...this.status, vol: this.vol,
      time: e ? +e.now.toFixed(2) : 0,
      voices: e ? { active: e.active, peak: e.peakActive, dropped: e.dropped, pools: e.poolCounts() } : null,
      music: m ? { state: m.state, piece: m.piece ? { variant: m.piece.variant, mode: m.piece.mode, bpm: m.piece.bpm, bars: m.piece.bars, form: m.piece.form, lead: m.piece.lead, motif: m.piece.motif, length: +m.piece.length.toFixed(1) } : null, nextIn: +(m.nextAt - (e?.now ?? 0)).toFixed(1), history: m.history, place: { ...this.places } } : null,
      buses: e ? Object.fromEntries(Object.entries(e.buses).map(([k, g]) => [k, +g.gain.value.toFixed(3)])) : null,
      zones: Object.fromEntries(Object.entries(this.zones).map(([k, v]) => [k, +v.toFixed(2)])),
      amb: this.amb?.levels ?? null,
      engine: this.boat ? { rate: this.boat.rate, level: this.boat.level } : null,
      spots: this.spots.length,
      events: e ? e.events.slice(-25) : [],
      counts: e ? { ...e.eventCount } : {},
    };
  }
  forceMusic(v: Variant) { this.music?.force(v); }
  /** Title swell: call on the tap that starts the sepia -> colour bloom (the same gesture unlocks audio). */
  title() { if (this.e && this.vol.music > 0) this.music?.title(); }
  /** The Cedar Landing motif in a guise (e.g. 'gran' when Gran's notes open). */
  motif(g: Guise) { if (this.e && this.running && this.vol.music > 0) this.music?.motif(g); }
  /** Duck the score for `secs` (catch stings, cutscenes); depth = gain while ducked. */
  duckMusic(secs = 2.5, depth = 0.45) { this.music?.duck(secs, depth); }
  setGap(min: number, max: number) { AUDIO_TUNING.gapMin = min; AUDIO_TUNING.gapMax = max; if (this.music && this.e) this.music.nextAt = Math.min(this.music.nextAt, this.e.now + max); }
}

export const gameAudio = new GameAudio();

// ------------------------------------------------------------------ offline renders (tests)
/**
 * Render a representative scene through the real graph into PCM using an OfflineAudioContext.
 * `update` callbacks run every 0.1 s of render time via suspend(), like the live frame loop.
 * Returns 16-bit WAV (base64) + level stats.
 */
export async function renderOffline(kind: string, secs: number, seed = 7) {
  const gaps = { gapMin: AUDIO_TUNING.gapMin, gapMax: AUDIO_TUNING.gapMax }; // scenes may shorten them
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(sr * secs), sr);
  const e = new AudioEngine(ctx);
  const S = makeSfx(e);
  const step = 0.1;
  const hooks: ((t: number) => void)[] = [];
  let hookMs = 0; // main-thread JS time in the per-0.1 s hooks (composition, scheduling, sample synthesis)
  const at = (t: number, f: () => void) => hooks.push((now) => { if (now >= t && now < t + step) f(); });
  const every = (f: (t: number) => void) => hooks.push(f);
  const zones: Zones = { harbour: 0, shore: 0, open: 1, forest: 0 };
  if (kind.startsWith('music:')) {
    const v = kind.slice(6) as Variant;
    const m = new MusicDirector(e, 0.2);
    e.vol.sound = 0;
    let started = false;
    const c = sceneCtx(v);
    every(() => { if (!started) { m.startPiece(v, seed); started = true; } m.update(c, true); });
  } else if (kind.startsWith('scene:')) {
    const [nm, ...flags] = kind.slice(6).split('!');
    Object.assign(PAD_EXP, { lfo: !flags.includes('nolfo'), hall: !flags.includes('nohall'), chorus: !flags.includes('nochorus'), formants: !flags.includes('nochoir'), wet: !flags.includes('nowet') });
    sceneScript(nm, e, S, seed, every, at);
  } else if (kind === 'fight') {
    // a 3 s explore piece → hooked: 12 s fight with tension waves and thrashes → catch resolves
    const m = new MusicDirector(e, 0.2);
    let started = false;
    every((t) => {
      if (!started) { m.startPiece('day', seed); started = true; }
      const fighting = t > 3 && t < 15;
      const tension = fighting ? 0.35 + 0.35 * Math.sin((t - 3) * 0.9) + (t > 10 ? 0.25 : 0) : 0;
      m.update({ tod: 'overcast', town: 0, fighting, tension, thrashing: fighting && Math.sin(t * 1.7) > 0.7 }, true);
    });
    at(15, () => { m.resolve(true); S.chime(e.now + 0.05, m.lastTonic, true); });
  } else if (kind === 'fishing') {
    at(0.2, () => S.cast(e.now));
    at(1.0, () => S.plop(e.now));
    at(2.2, () => S.nibble(e.now));
    at(3.0, () => S.nibble(e.now));
    at(3.8, () => S.bite(e.now));
    at(4.2, () => S.strike(e.now, 1.5));
    let acc = 0;
    every((t) => { if (t > 4.3 && t < 9) { acc += step * 18; while (acc >= 1) { acc--; S.click(e.now + Math.random() * step, false); } } });
    at(5.5, () => S.thrash(e.now, 1.2));
    at(6.6, () => S.leap(e.now, 1.2));
    at(7.2, () => S.breach(e.now, 1.2));
    at(9.2, () => S.landSplash(e.now, 1.5));
    at(9.8, () => { S.slap(e.now); S.chime(e.now + 0.05, 62, false); });
    at(11.5, () => S.chime(e.now, 62, true));
    at(14, () => S.release(e.now));
    at(15.5, () => S.keep(e.now));
  } else if (kind.startsWith('catch:')) {
    // catch:<tier>[+pb][+perfect] — pull-out at 0.2 s, the reveal after the tier's arc
    const [tier, ...mods] = kind.slice(6).split('+') as [FanTier, ...string[]];
    const F = makeFanfare(e);
    const arc = { quick: 0.6, common: 0.66, uncommon: 0.78, rare: 0.95, legendary: 1.5 }[tier] ?? 0.8;
    at(0.2, () => { S.breach(e.now, 1.2); F.pullout(e.now, 62, tier, arc); });
    at(0.2 + arc, () => { S.slap(e.now); F.reveal(e.now + 0.05, 62, tier, { pb: mods.includes('pb'), perfect: mods.includes('perfect') }); });
  } else if (kind === 'boat') {
    const amb = new Ambience(e, S), boat = new BoatAudio(e);
    every((t) => {
      const thr = t < 2 ? 0 : t < 9 ? Math.min(1, (t - 2) / 3) : t < 12 ? 0.3 : 0;
      const sp = t < 2 ? 0 : t < 12 ? Math.min(1, (t - 2) / 5) * (t > 9 ? 0.5 : 1) : Math.max(0, 0.5 - (t - 12) * 0.2);
      boat.update(step, thr, sp, t > 0.5, false);
      amb.update(step, { zones, tod: 'overcast', speed: sp, onFoot: false, moored: false });
    });
  } else if (kind.startsWith('amb:')) {
    const place = kind.slice(4);
    const amb = new Ambience(e, S);
    const tod = place.includes('night') ? 'night' : place.includes('dusk') ? 'dusk' : place.includes('fog') ? 'fog' : 'overcast';
    if (place.startsWith('harbour')) Object.assign(zones, { harbour: 1, shore: 0.6, open: 0, forest: 0 });
    if (place.startsWith('forest')) Object.assign(zones, { harbour: 0, shore: 1, open: 0, forest: 1 });
    every(() => amb.update(step, { zones, tod, speed: 0, onFoot: place.startsWith('forest'), moored: place.startsWith('harbour') }));
  } else if (kind.startsWith('rain:')) {
    // rain:drizzle | rain:steady | rain:storm — the weather beds on open water, still boat, with thunder in a storm
    const v = kind.slice(5);
    const amb = new Ambience(e, S);
    const rain = v === 'drizzle' ? 0.35 : v === 'steady' ? 0.75 : 1, storm = v === 'storm' ? 1 : 0;
    every(() => amb.update(step, { zones, tod: 'overcast', speed: 0, onFoot: false, moored: false, rain, storm }));
    if (storm) { at(1.0, () => amb.thunder(2400, false)); at(7.0, () => amb.thunder(300, true, 0.4)); at(12.5, () => amb.thunder(1500, false, -0.5)); }
  } else if (kind === 'ui') {
    ['tap', 'page', 'open', 'close', 'buy', 'sell', 'stamp', 'upgrade', 'paint', 'discover', 'quest', 'refuse'].forEach((n, i) => at(0.2 + i * 0.9, () => S.ui(e.now, n)));
  } else if (kind === 'wildlife') {
    const P = { gain: 0.8, pan: 0.3, lp: 9000 };
    at(0.2, () => S.blow(e.now, 'humpback', P));
    at(2.0, () => S.blow(e.now, 'orca', P));
    at(3.4, () => S.blow(e.now, 'porpoise', P));
    at(4.2, () => S.bigSplash(e.now, 'breach', P));
    at(6.0, () => S.bigSplash(e.now, 'slap', P));
    at(7.2, () => S.bark(e.now, P, true));
    at(8.6, () => S.gull(e.now, P, 3));
    at(9.8, () => S.eagle(e.now, P));
    at(10.8, () => S.thrush(e.now, P));
    at(12.0, () => S.foghorn(e.now, { gain: 1, pan: -0.3, lp: 900 }));
  } else if (kind === 'foot') {
    ['wood', 'wood', 'wood', 'wood', 'gravel', 'gravel', 'gravel', 'gravel', 'grass', 'grass', 'grass', 'grass', 'sand', 'sand', 'sand', 'sand'].forEach((s, i) => at(0.2 + i * 0.45, () => S.step(e.now, s, 0.6)));
    at(8, () => S.murmur(e.now, 'Tie her up tight, the tide turns fast here.', 60));
    at(10.5, () => S.murmur(e.now, 'Welcome to Cedar Landing!', 74));
  }
  for (let t = step; t < secs - step; t += step) {
    const tt = +t.toFixed(3);
    ctx.suspend(tt).then(() => { const h0 = performance.now(); for (const h of hooks) h(tt); hookMs += performance.now() - h0; ctx.resume(); });
  }
  let buf: AudioBuffer;
  const w0 = performance.now();
  try { buf = await ctx.startRendering(); } finally { Object.assign(AUDIO_TUNING, gaps); Object.assign(PAD_EXP, { lfo: true, hall: true, chorus: true, formants: true, wet: true }); }
  const chs = [buf.getChannelData(0), buf.getChannelData(1)];
  const wallMs = performance.now() - w0;
  const stats = { ...measure(chs), peakVoices: e.peakActive, dropped: e.dropped, wallMs: Math.round(wallMs), hookMs: Math.round(hookMs), events: Object.keys(e.eventCount).length ? e.eventCount : undefined };
  const log = e.events.filter((x) => x.name.startsWith('music')).map((x) => `${x.t}s ${x.name} ${x.detail ?? ''}`);
  // 16-bit PCM WAV → base64
  const n = buf.length, data = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); data.setUint32(16, 16, true);
  data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, sr, true); data.setUint32(28, sr * 4, true);
  data.setUint16(32, 4, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) data.setInt16(44 + i * 4 + c * 2, Math.max(-32768, Math.min(32767, Math.round(chs[c][i] * 32767))), true);
  const bytes = new Uint8Array(data.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { stats, wav: btoa(bin), log };
}

/** A steady music context for a mood (offline renders). */
function sceneCtx(v: string, extra: Partial<MusicContext> = {}): MusicContext {
  const hour = v === 'dawn' ? 6.2 : v === 'dusk' ? 19.2 : v === 'night' ? 23.5 : 12.5;
  return {
    tod: v === 'night' ? 'night' : v === 'dusk' ? 'dusk' : v === 'fog' ? 'fog' : 'overcast', hour,
    town: v === 'town' ? 1 : 0, village: v === 'village' ? 1 : 0, cove: v === 'cove' ? 1 : 0,
    rain: v === 'rain' ? 0.8 : v === 'storm' ? 1 : 0, storm: v === 'storm' ? 1 : 0,
    fighting: false, tension: 0, thrashing: false, ...extra,
  };
}

/**
 * Music scenes for the offline renders (scripts/music_render.mjs): the director runs as in game,
 * driven by a context timeline. Music only (the sound bus is muted except for the catch chime).
 */
function sceneScript(name: string, e: AudioEngine, S: Sfx, seed: number, every: (f: (t: number) => void) => void, at: (t: number, f: () => void) => void) {
  const m = new MusicDirector(e, 0.3);
  e.vol.sound = 0;
  if (name === 'silence') return; // the harness + master chain alone (CPU baseline)
  const steady: Record<string, string> = { dawn_sea: 'dawn', day_town: 'town', dusk: 'dusk', night: 'night', rain: 'rain', storm: 'storm', village: 'village', cove: 'cove', day_sea: 'day', fog: 'fog' };
  if (steady[name]) {
    const c = sceneCtx(steady[name]);
    let started = false;
    every(() => { if (!started) { m.startPiece(m.variantFor(c), seed); started = true; } m.update(c, true); });
    return;
  }
  if (name === 'title') {
    // title swell on the tap, then the first cue arrives after a (shortened) rest
    AUDIO_TUNING.gapMin = 6; AUDIO_TUNING.gapMax = 8;
    const c = sceneCtx('day', { hour: 9.5 });
    at(0.3, () => m.title());
    every(() => m.update(c, true));
    return;
  }
  if (name === 'fish_catch') {
    // open water by day: a cue plays; hooked at 34 s, a 15 s fight, a big catch at 49 s, the score returns
    AUDIO_TUNING.gapMin = 12; AUDIO_TUNING.gapMax = 14;
    let started = false;
    every((t) => {
      if (!started) { m.startPiece('day', seed); started = true; }
      const fighting = t > 34 && t < 49;
      const tension = fighting ? 0.35 + 0.3 * Math.sin((t - 34) * 0.9) + (t > 43 ? 0.3 : 0) : 0;
      m.update(sceneCtx('day', { fighting, tension, thrashing: fighting && Math.sin(t * 1.7) > 0.7 }), true);
    });
    at(49, () => { m.resolve(true); e.vol.sound = 1; e.applyLevels(true); S.chime(e.now + 0.05, m.lastTonic, true); m.duck(4, 0.4); });
    return;
  }
  if (name === 'sail_in') {
    // open water -> Cedar Landing (folk layer blooms in) -> the village (wood layer) -> back out; rain at the end
    let started = false;
    every((t) => {
      if (!started) { m.startPiece('day', seed); started = true; }
      const sm = (a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
      const town = sm(35, 45) * (1 - sm(75, 85));
      const village = sm(75, 85) * (1 - sm(110, 120));
      const rain = sm(125, 140) * 0.8;
      m.update(sceneCtx('day', { town, village, rain }), true);
    });
    return;
  }
  if (name === 'dialogue') {
    let started = false;
    every(() => { if (!started) { m.startPiece('day', seed); started = true; } m.update(sceneCtx('day'), true); });
    at(20, () => { m.duck(5, 0.5); e.vol.sound = 1; e.applyLevels(true); S.murmur(e.now, 'Gran always said the tide tells you where to look.', 58, undefined, 3, 14); });
  }
}

/** Compose without rendering (tests can inspect form / event counts). */
export const composePiece = compose;

/**
 * Footstep surface from the ground under the feet (the world is flat vertex-coloured):
 * anything with more geometry under it (piers, decks, boardwalks, stairs) → wood; otherwise by
 * colour in sRGB: green → grass, pale tan near the water → sand, grey → gravel / stone,
 * red-brown → wood. Calibrated on Cedar Landing samples (docs/audio_study.md).
 */
export function surfaceFromColor(s: { c: [number, number, number]; hollow: boolean; y?: number } | null, y: number): string {
  if (!s) return y < 1.2 ? 'sand' : 'grass';
  if (s.hollow) return 'wood';
  const [r, g, b] = s.c.map((v) => Math.pow(v / 255, 1 / 2.2)); // stored linear → sRGB
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
  if (g >= r && g > b && sat > 0.1) return 'grass';
  if (r > g && g > b && r - b > 0.12 && mx > 0.5 && (s.y ?? y) < 2.5) return 'sand';
  if (sat < 0.16) return 'gravel';
  if (r > g + 0.08) return 'wood';
  return 'grass';
}
