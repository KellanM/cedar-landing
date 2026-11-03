import * as THREE from 'three';
import { priceFor, SPECIES, type CaughtFish, type Species } from './fishdata';
import { gear, pickSpeciesFor, rollSizeFor } from './progression/gear'; // upgrades: tackle stats
import type { Hotspot } from '../world/types';
import { Bobber, LineRibbon } from './tackle';
import { SplashFX } from './splash';
import { FishModel, shownLength } from './fishmodel';

export type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'missed' | 'reeling' | 'landed';

/** Tunables (game_design_reference §6.1): forgiving, 5–20 s per catch, line slips instead of snapping. */
const T = {
  castTime: 0.8,
  approachMin: 1.4, // fishing_feel.md §2.1 wait budget (was 2.0–3.8)
  approachMax: 2.6,
  biteWindow: 0.75, // spec says 0.6 s; +0.15 for touch latency
  missedTime: 1.4,
  reelSpeed: 1.7, // m/s while holding
  basePull: 0.35, // m/s fish pull when slack
  thrashPull: 1.1,
  tensionBuild: 0.3, // /s while holding
  thrashBuild: 1.05, // /s while holding during thrash
  tensionDecay: 0.75, // /s while released
  slipGain: 2.5, // metres the fish gains when the line slips
  perfectMax: 0.75,
};

/** Fight VFX tuning (edited live by ?tune). Rarity scale R multiplies intensity, not length. */
export const FIGHT_FX = {
  thrashDisc: 0.16, // s between thrash foam/droplet puffs at the line entry
  shedRate: 0.08, // s between water drops shed off a taut line
  shedTension: 0.45, // line sheds water above this tension
  leapChance: 0.55, // darter/sprinter breach chance per thrash (× rarity)
  leapHeight: 0.9, // m (+0.35 per rarity step)
  landArc: 0.62, // s from the water to the skipper's hands
  // fish are drawn at their real rolled length (fishmodel.shownLength adds a gentle boost below 35 cm)
};

const BEHAVIOR = {
  calm: { every: [2.6, 4.0], len: [0.7, 1.0] },
  darter: { every: [1.6, 2.6], len: [0.5, 0.8] },
  diver: { every: [2.0, 3.2], len: [1.0, 1.4] },
  sprinter: { every: [1.4, 2.4], len: [0.9, 1.3] },
} as const;
const START_DIST = { common: 7, uncommon: 10, rare: 13, legendary: 16 } as const;
const RSCALE = { common: 1, uncommon: 1.2, rare: 1.5, legendary: 2 } as const;
const SEA_Y = -0.06;
/** Hold-up layout (fish_models_study.md §scale). */
export const HOLD = {
  handMax: 0.34, // m drawn length: below this, one hand by the face (hold_show); above, two fists overhead (hold_hoist)
  fist: 0.09, // m from the wrist bone to the top of the closed fist (the belly rests here)
  grip: 0.03, // m above the wrist for a one-hand hold
  outset: 0.05, // m the one-hand fish is shifted out from the grip, so the nose sits at the cheek, not the mouth
  front: 0.1, // m toward the camera from the hand (in front of the face plane, never inside it)
  present: 0.82, // flatfish/crab held up: 0 = lying flat, 1 = eyed side square to the camera
  // direction-A skipper (big round head, short arms: raised fists only reach the hat brim): the two-hand
  // hoist lifts the fish a little and brings it toward the camera so the sou'wester and face stay readable
  hoistLift: 0.07, // m extra above the fists
  hoistFront: 0.14, // m toward the camera
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export interface FishingEvents {
  toast(msg: string, kind?: 'info' | 'good' | 'warn'): void;
  landed(fish: CaughtFish, species: Species, perfect: boolean): void;
  /** the fish leaves the water (before the arc): the catch show plans here and may set `landArc` / `forceHoist` */
  pullout?(fish: CaughtFish, species: Species, perfect: boolean): void;
  bite(): void;
  /** UI hooks (sound/haptics); optional */
  nibble?(): void;
  slip?(): void;
  /** juice hooks (camera, hit-stop); world positions */
  strike?(x: number, z: number, r: number): void;
  thrash?(x: number, z: number, pull: number, r: number): void;
  leap?(x: number, z: number, r: number): void;
  breach?(x: number, z: number, r: number): void;
}

export class Fishing {
  phase: Phase = 'idle';
  autoReel = false;
  hotspot: Hotspot | null = null;
  species: Species | null = null;

  // reel state (exposed for the UI)
  tension = 0;
  maxTension = 0;
  distance = 0;
  startDistance = 1;
  thrashing = false;
  slips = 0;
  reelHeld = false;
  /** which way the fish is pulling during a thrash (-1 left / +1 right), for the UI arrow */
  pull = 1;

  private t = 0;
  private nibbles: number[] = [];
  private nextThrash = 0;
  private thrashEnd = 0;

  // visuals
  group = new THREE.Group();
  /** Proxy whose position is the float (the HUD anchors the Strike! label and bubbles to it). */
  readonly bobber = new THREE.Object3D();
  readonly float = new Bobber();
  private line = new LineRibbon();
  readonly fx = new SplashFX(4);
  readonly fish = new FishModel();
  private shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private castFrom = new THREE.Vector3();
  bobberPos = new THREE.Vector3();
  private shadowFrom = new THREE.Vector3();
  private shadowPos = new THREE.Vector3();
  /** where the line meets the fish (reeling) — the camera frames this */
  readonly lineEnd = new THREE.Vector3();
  /** set by main each frame while landed: the grip point — both wrists (hoist) or the right wrist (hand); null → boat deck */
  handTarget: THREE.Vector3 | null = null;
  /** set by main with handTarget: the skipper's head (the one-hand hold keeps the fish beside the face) */
  headPos: THREE.Vector3 | null = null;
  /** landing arc for this catch (set by the catch show at pullout; docs/catch_study.md F1) */
  landArc = { dur: FIGHT_FX.landArc, h: 1.4 };
  /** rare+: two-hand overhead hoist even for a small fish (F3) */
  forceHoist = false;
  /** drawn length (m) of the fish on the line / in hand */
  shownLen = 0.3;
  private held = 0; // steady float submersion
  private puffT = 0;
  private shedT = 0;
  private fxCool = 0;
  private leap: { t: number; dur: number; h: number; from: THREE.Vector3; to: THREE.Vector3; kind: 'leap' | 'roll' } | null = null;
  private land_: { t: number; from: THREE.Vector3; done: boolean; fish: CaughtFish | null; perfect: boolean } | null = null;
  private flopT = 0;
  /** debug/captures: force the next species (id) and landed size (cm) */
  debugNext: { id: string; size?: number } | null = null;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private htLocal = new THREE.Vector3();

  constructor(private ev: FishingEvents) {
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 16).scale(0.35, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0d1a1f, transparent: true, opacity: 0.0, depthWrite: false }));
    this.shadow.position.y = 0.01;
    this.group.add(this.float.group, this.line.mesh, this.shadow, this.fish.group, this.fx.group, this.bobber);
    this.group.visible = false;
  }

  get active() { return this.phase !== 'idle'; }
  /** Hold-up layout: small fish (drawn < HOLD.handMax m) are shown in one hand by the face, the rest
   *  rest across both raised fists. */
  get holdMode(): 'hand' | 'hoist' { return this.forceHoist || this.shownLen >= HOLD.handMax ? 'hoist' : 'hand'; }
  get rarityScale() { return this.species ? RSCALE[this.species.rarity] : 1; }

  /** Start a cast toward the hotspot. */
  cast(hs: Hotspot, rodTip: THREE.Vector3, boatPos: THREE.Vector3) {
    this.hotspot = hs;
    this.phase = 'casting';
    this.t = 0;
    this.castFrom.copy(rodTip);
    this.castFrom.y -= this.group.position.y; // tide: the rig works in water space (group sits at the water level)
    // land the bobber between the boat and the hotspot centre, ≤ 7 m out
    const dir = this.v1.set(hs.pos[0] - boatPos.x, 0, hs.pos[2] - boatPos.z);
    const d = Math.min(7, Math.max(3.5, dir.length()));
    dir.normalize().multiplyScalar(d);
    if (!isFinite(dir.x)) dir.set(0, 0, -4);
    this.bobberPos.copy(boatPos).add(dir).setY(0);
    this.group.visible = true;
    this.shadow.material.opacity = 0;
    this.held = 0;
    this.leap = null;
    this.land_ = null;
    this.fish.group.visible = false;
  }

  cancel() {
    this.phase = 'idle';
    this.forceHoist = false;
    this.landArc = { dur: FIGHT_FX.landArc, h: 1.4 };
    this.group.visible = false;
    this.thrashing = false;
    this.leap = null;
    this.land_ = null;
    this.fish.group.visible = false;
  }

  /** debug: distance from the shadow's nose (the end facing the float) to the float */
  shadowNoseGap() {
    const half = this.shadow.scale.z;
    const dx = this.bobberPos.x - this.shadowPos.x, dz = this.bobberPos.z - this.shadowPos.z, d = Math.hypot(dx, dz);
    return { centre: +d.toFixed(2), half: +half.toFixed(2), gap: +(d - half).toFixed(2), phase: this.phase };
  }
  /** where the shadow's centre must sit for its nose to touch the float: half its length back along the approach */
  private mouthTarget(out: THREE.Vector3) {
    const half = this.shadow.scale.z * 0.92; // geometry radius 1 along z, scaled per fish size
    let dx = this.bobberPos.x - this.shadowFrom.x, dz = this.bobberPos.z - this.shadowFrom.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    return out.set(this.bobberPos.x - dx * half, 0.01, this.bobberPos.z - dz * half);
  }

  private startApproach() {
    this.phase = 'waiting';
    this.t = 0;
    this.held = 0;
    this.species = pickSpeciesFor(this.hotspot); // line depth gates, bait biases
    if (this.debugNext) this.species = SPECIES.find((s) => s.id === this.debugNext!.id) ?? this.species;
    const ang = Math.random() * Math.PI * 2;
    this.shadowFrom.set(this.bobberPos.x + Math.cos(ang) * 6, 0.01, this.bobberPos.z + Math.sin(ang) * 6);
    this.shadowPos.copy(this.shadowFrom);
    const approach = rand(T.approachMin, T.approachMax);
    // 0–2 nibbles after the shadow arrives (rare+ fish are decisive: 0–1), then the bite
    const n = Math.floor(Math.random() * (this.species.rarity === 'rare' || this.species.rarity === 'legendary' ? 2 : 3));
    this.nibbles = [];
    let at = approach;
    for (let i = 0; i < n; i++) { at += rand(0.5, 0.9); this.nibbles.push(at); }
    this.biteAt = at + rand(0.5, 1.0);
    this.approachDur = approach;
    const big = this.species.rarity === 'common' ? 1 : this.species.rarity === 'uncommon' ? 1.4 : 1.9;
    this.shadow.scale.setScalar(0.8 * big);
    const L = (this.species.size[0] + this.species.size[1]) / 200;
    void this.fish.setSpecies(this.species.id); // lazy: the plate-derived model loads while the float waits
    this.fish.setLength(L);
    this.shownLen = shownLength(L);
  }
  private biteAt = 0;
  private approachDur = 2;

  /** Action button pressed (tap). Returns true if consumed. */
  press(): boolean {
    switch (this.phase) {
      case 'waiting':
        // Too early: the fish startles but stays around — try again, no bait loss.
        this.ev.toast('Too soon! It swam off… it\'ll be back', 'warn');
        this.phase = 'missed';
        this.t = 0;
        this.held = 0;
        return true;
      case 'bite':
        this.startReel();
        return true;
      default:
        return this.phase !== 'idle';
    }
  }

  private startReel() {
    const sp = this.species!;
    this.phase = 'reeling';
    this.t = 0;
    this.tension = 0.15;
    this.maxTension = 0;
    this.slips = 0;
    this.distance = this.startDistance = START_DIST[sp.rarity] + rand(-1, 1.5);
    this.scheduleThrash(0.8);
    // hook-set: the float yanks up out of its plunge, a crown splash, and a camera/hit-stop cue
    const R = this.rarityScale;
    this.held = 0;
    this.float.kick(-0.25);
    this.fx.burst(this.bobberPos.x, this.bobberPos.z, 0.8 * R, Math.round(12 * R));
    this.ev.strike?.(this.bobberPos.x, this.bobberPos.z, R);
  }

  private scheduleThrash(minDelay = 0) {
    const b = BEHAVIOR[this.species!.behavior];
    this.nextThrash = this.t + minDelay + rand(b.every[0], b.every[1]);
    this.thrashEnd = 0;
  }

  private startThrash() {
    const sp = this.species!, b = BEHAVIOR[sp.behavior], R = this.rarityScale;
    this.thrashing = true;
    this.thrashEnd = this.t + rand(b.len[0], b.len[1]);
    this.pull = Math.random() < 0.5 ? -1 : 1;
    const p = this.shadowPos;
    if (this.fxCool <= 0) { this.fx.burst(p.x, p.z, 0.55 * R, Math.round(9 * R)); this.fxCool = 0.3; }
    this.ev.thrash?.(p.x, p.z, this.pull, R);
    // behaviour beat: leapers breach, calm fish roll at the surface, divers drag the float under
    if ((sp.behavior === 'darter' || sp.behavior === 'sprinter') && Math.random() < Math.min(0.9, FIGHT_FX.leapChance * R)) this.startLeap('leap');
    else if (sp.behavior === 'calm' && Math.random() < 0.7) this.startLeap('roll');
  }

  private startLeap(kind: 'leap' | 'roll') {
    const R = this.rarityScale;
    const from = this.shadowPos.clone();
    // travel sideways toward the pull side (so the UI arrow and the leap agree)
    const dx = this.bobberPos.x - from.x, dz = this.bobberPos.z - from.z;
    const l = Math.hypot(dx, dz) || 1;
    const to = from.clone().add(this.v1.set(-dz / l * this.pull, 0, dx / l * this.pull).multiplyScalar(kind === 'leap' ? 1.3 : 0.3));
    this.leap = { t: 0, dur: kind === 'leap' ? 0.55 + 0.1 * R : 0.55, h: kind === 'leap' ? FIGHT_FX.leapHeight + 0.35 * (R - 1) * 2 : 0.05, from, to, kind };
    this.fish.group.visible = true;
    this.fish.flop(0.8);
    if (kind === 'leap') { this.fx.burst(from.x, from.z, 0.5 * R, Math.round(10 * R)); this.ev.leap?.(from.x, from.z, R); } else this.fx.foam(from.x, from.z, 5, 0.5, 0.3, 1.0);
  }

  update(dt: number, held: boolean, rodTip: THREE.Vector3, boatPos: THREE.Vector3, cam?: THREE.Vector3) {
    if (cam) this.camPos.copy(cam).setY(cam.y - this.group.position.y);
    if (this.phase === 'idle') return;
    this.t += dt;
    this.fxCool -= dt;
    this.tip.copy(rodTip);
    this.tip.y -= this.group.position.y; // tide (see cast)
    let airY = 0, onWater = true;

    switch (this.phase) {
      case 'casting': {
        const k = Math.min(1, this.t / T.castTime);
        const p = this.v1.copy(this.castFrom).lerp(this.bobberPos, k);
        airY = THREE.MathUtils.lerp(this.castFrom.y, 0, k) + Math.sin(k * Math.PI) * 2.2;
        this.bobber.position.set(p.x, airY, p.z);
        onWater = false;
        if (k >= 1) {
          // plop: squash, a ring and a few drops (nothing big — it's just the float landing)
          this.float.plop();
          this.float.kick(0.08);
          this.fx.ring(this.bobberPos.x, this.bobberPos.z, 0.45);
          this.fx.throwAt(this.bobberPos.x, 0.05, this.bobberPos.z, 0, 1.6, 0, 6, 1.2, 0.6);
          this.startApproach();
        }
        break;
      }
      case 'waiting': {
        const k = Math.min(1, this.t / this.approachDur);
        const e = THREE.MathUtils.smoothstep(k, 0, 1);
        // swim in so the fish's NOSE (the end of the shadow facing the float) arrives at the float, not its middle
        this.shadowPos.copy(this.shadowFrom).lerp(this.mouthTarget(this.v1), e);
        this.shadow.material.opacity = Math.min(0.45, this.t * 0.4);
        while (this.nibbles.length && this.t >= this.nibbles[0]) {
          this.nibbles.shift();
          this.float.kick(0.14);
          this.fx.ring(this.bobberPos.x, this.bobberPos.z, 0.3);
          this.fx.throwAt(this.bobberPos.x, 0.05, this.bobberPos.z, 0, 1.2, 0, 3, 0.8, 0.5);
          this.ev.nibble?.();
        }
        if (this.t >= this.biteAt) {
          this.phase = 'bite';
          this.t = 0;
          // the plunge: float yanked under (the yellow tip stays just above the water) + a crown
          this.float.kick(0.35);
          this.held = -0.24;
          this.fx.burst(this.bobberPos.x, this.bobberPos.z, 0.65, 10);
          this.ev.bite();
          if (this.autoReel) this.startReel(); // assist: auto-hook too
        }
        break;
      }
      case 'bite': {
        if (this.t > T.biteWindow) {
          this.ev.toast('Missed it! Still nosing about', 'warn');
          this.phase = 'missed';
          this.t = 0;
          this.held = 0;
        }
        break;
      }
      case 'missed': {
        // shadow swims off a bit then comes back for another go
        const away = this.v1.set(this.shadowPos.x - this.bobberPos.x, 0, this.shadowPos.z - this.bobberPos.z).normalize();
        this.shadowPos.addScaledVector(away, dt * 2.5);
        this.shadow.material.opacity = Math.max(0.15, 0.45 - this.t * 0.25);
        if (this.t > T.missedTime) {
          const cur = this.v2.copy(this.shadowPos);
          const sp = this.species;
          this.startApproach();
          if (sp) this.species = sp; // same fish tries again
          this.shadowFrom.copy(cur);
          this.shadowPos.copy(cur);
        }
        break;
      }
      case 'reeling': {
        if (this.autoReel) held = this.tension < (this.thrashing ? 0.3 : 0.68);
        this.reelHeld = held;
        if (!this.thrashing && this.t >= this.nextThrash) this.startThrash();
        else if (this.thrashing && this.t >= this.thrashEnd) {
          this.thrashing = false;
          this.scheduleThrash();
        }
        if (held) {
          this.distance -= T.reelSpeed * gear.reelMul * dt * (this.thrashing ? 0.45 : 1);
          this.tension += (this.thrashing ? T.thrashBuild * gear.thrashMul : T.tensionBuild * gear.tensionMul) * dt;
        } else {
          this.distance += (this.thrashing ? T.thrashPull * gear.pullMul : T.basePull) * dt;
          this.tension -= T.tensionDecay * dt;
        }
        this.distance = Math.min(this.distance, this.startDistance + 6);
        this.tension = Math.max(0, this.tension);
        this.maxTension = Math.max(this.maxTension, this.tension);
        if (this.tension >= 1) {
          // Normal fish never snap: the line slips and the fish gains a little distance.
          this.slips++;
          this.distance += T.slipGain * gear.slipMul;
          this.tension = 0.55;
          this.ev.toast('Line slipped! Ease off when it pulls', 'warn');
          this.ev.slip?.();
          this.fx.burst(this.shadowPos.x, this.shadowPos.z, 0.5, 8);
        }
        // fish shadow tugs around at the line's end; it is reeled in toward the rod tip (over the
        // water off the quarter), never into the hull
        const ox = this.tip.x, oz = this.tip.z;
        const dir = this.v1.set(this.bobberPos.x - ox, 0, this.bobberPos.z - oz).normalize();
        // during a thrash the fish swings out to the `pull` side, so the UI arrow tells the truth
        const wob = (this.thrashing ? this.pull * (0.45 + 0.45 * Math.abs(Math.sin(this.t * 9))) : Math.sin(this.t * 3) * 0.3) * Math.min(1, 0.3 + this.distance / 4);
        const d = Math.max(0.5, this.distance * 0.55) + 0.6;
        this.shadowPos.set(ox + dir.x * d - dir.z * wob, 0.01, oz + dir.z * d + dir.x * wob);
        this.shadow.material.opacity = 0.5;
        this.held = this.species?.behavior === 'diver' && this.thrashing ? -0.3 : this.thrashing ? -0.12 : -0.04;
        this.fightFX(dt);
        if (this.distance <= 0) this.land();
        break;
      }
      case 'landed':
        break;
    }

    this.updateLeap(dt);
    this.updateLanding(dt);
    this.fish.update(dt);

    // float
    const fp = this.phase === 'reeling' ? this.shadowPos : this.bobberPos;
    if (this.phase !== 'casting') this.bobber.position.set(fp.x, 0, fp.z);
    const camD = this.camPos.distanceTo(this.bobber.position);
    const lx = this.tip.x - fp.x, lz = this.tip.z - fp.z, ll = Math.hypot(lx, lz) || 1;
    const lean = this.phase === 'reeling' ? 0.3 + this.tension * 0.6 : 0.08;
    this.float.update(dt, this.bobber.position.x, this.bobber.position.z, camD, this.held, (lx / ll) * lean, (lz / ll) * lean, onWater, airY);
    this.float.group.visible = this.phase !== 'landed';
    this.bobber.position.y = this.phase === 'casting' ? airY : 0.25;
    this.shadow.position.set(this.shadowPos.x, 0.01, this.shadowPos.z);
    this.shadow.visible = this.phase !== 'casting' && this.phase !== 'landed';
    // face the float; once nose-to-float keep the approach heading (lookAt at ~0 distance would spin)
    const fdx = this.bobberPos.x - this.shadowPos.x, fdz = this.bobberPos.z - this.shadowPos.z;
    if (fdx * fdx + fdz * fdz > 0.04) this.shadow.lookAt(this.bobberPos.x, 0.01, this.bobberPos.z);

    // line: rod tip → float tip (or the fish during the landing arc)
    const lineTo = this.land_ && !this.land_.done ? this.fish.group.position : this.float.top;
    this.lineEnd.copy(this.phase === 'reeling' ? this.shadowPos : this.bobberPos);
    const ten = this.phase === 'reeling' ? this.tension : this.phase === 'bite' ? 0.7 : this.phase === 'casting' ? 0.6 : 0.15;
    this.line.update(dt, this.tip, lineTo, this.camPos, ten, this.phase === 'casting' ? 0.4 : 1);
    this.line.mesh.visible = !(this.land_ && this.land_.done);
    this.fx.update(dt);
  }

  /** Continuous fight juice: Webfishing-style flat puffs where the line enters the water, and drops shed off a taut line. */
  private fightFX(dt: number) {
    const p = this.shadowPos, R = this.rarityScale;
    this.puffT -= dt;
    if (this.thrashing && this.puffT <= 0) {
      this.puffT = FIGHT_FX.thrashDisc;
      this.fx.foam(p.x, p.z, 2, 0.4 * R, 0.13 * R, 0.7);
      this.fx.throwAt(p.x, 0.05, p.z, 0, 1.8, 0, Math.round(2 * R), 1.6, 0.6);
    } else if (!this.thrashing && this.puffT <= 0) {
      this.puffT = 0.45;
      this.fx.foam(p.x, p.z, 1, 0.2, 0.1, 0.6); // a lazy wake bubble while it is being drawn in
    }
    this.shedT -= dt;
    if (this.reelHeld && this.tension > FIGHT_FX.shedTension && this.shedT <= 0) {
      this.shedT = FIGHT_FX.shedRate / (0.5 + this.tension);
      // a point on the line ~ 25–75 % toward the water; drops fall straight down off it
      const u = 0.35 + Math.random() * 0.5;
      const top = this.float.top;
      this.v3.copy(this.tip).lerp(top, u);
      this.v3.y -= Math.pow(1 - this.tension, 2) * 0.14 * this.tip.distanceTo(top) * 4 * u * (1 - u);
      this.fx.throwAt(this.v3.x, this.v3.y, this.v3.z, 0, -0.2, 0, 1, 0.3, 0.45);
    }
  }

  private updateLeap(dt: number) {
    const L = this.leap;
    if (!L) return;
    L.t += dt;
    const k = Math.min(1, L.t / L.dur);
    const g = this.fish.group;
    this.v2.copy(L.from).lerp(L.to, k);
    this.fish.leap = L.kind === 'leap' ? Math.sin(k * Math.PI) : 0.25;
    this.fish.present = 0;
    if (L.kind === 'leap') {
      const y = SEA_Y + Math.sin(k * Math.PI) * L.h;
      g.position.set(this.v2.x, y, this.v2.z);
      // face the travel direction, nose up then down
      g.rotation.set(0, Math.atan2(-(L.to.z - L.from.z), L.to.x - L.from.x), 0);
      g.rotateZ((0.5 - k) * 2.2);
      // drips off the fish at the top of the arc
      if (Math.random() < dt * 20) this.fx.throwAt(g.position.x, g.position.y, g.position.z, 0, 0, 0, 1, 0.4, 0.4);
    } else {
      // roll: flank breaks the surface, turns over, sinks
      g.position.set(this.v2.x, SEA_Y + Math.sin(k * Math.PI) * 0.06, this.v2.z);
      g.rotation.set(Math.PI / 2 * Math.sin(k * Math.PI), Math.atan2(-(this.bobberPos.z - this.v2.z), this.bobberPos.x - this.v2.x), 0);
    }
    if (k >= 1) {
      if (L.kind === 'leap') { this.fx.burst(L.to.x, L.to.z, 0.75 * this.rarityScale, Math.round(16 * this.rarityScale)); this.ev.breach?.(L.to.x, L.to.z, this.rarityScale); }
      else this.fx.ring(L.to.x, L.to.z, 0.5);
      this.leap = null;
      this.fish.leap = 0;
      if (!this.land_) this.fish.group.visible = false;
    }
  }

  private land() {
    const sp = this.species!;
    const size = this.debugNext?.size ?? rollSizeFor(sp);
    const perfect = this.maxTension <= T.perfectMax && this.slips === 0;
    const big = (size - sp.size[0]) / Math.max(1, sp.size[1] - sp.size[0]) >= 0.7;
    const stars = 1 + (big ? 1 : 0) + (perfect ? 1 : 0);
    this.phase = 'landed';
    this.thrashing = false;
    this.leap = null;
    const fish: CaughtFish = { speciesId: sp.id, name: sp.name, size, stars, price: priceFor(sp, size, stars), color: sp.color, rarity: sp.rarity, releaseOnly: sp.releaseOnly };
    // the fish breaches beside the hull and arcs up into the skipper's hands
    const R = this.rarityScale;
    this.fish.setLength(size / 100);
    this.shownLen = shownLength(size / 100);
    this.fish.group.visible = true;
    this.fish.flop(0.9);
    this.land_ = { t: 0, from: this.shadowPos.clone().setY(SEA_Y), done: false, fish, perfect };
    this.ev.pullout?.(fish, sp, perfect);
    // the pull-out (F1): a crown splash and a column of water thrown up after the fish, both scaled
    // by how high this catch is thrown (a perch pops out; the sixgill rockets out nose-first)
    const S = Math.max(1, this.landArc.h / 1.4);
    const p = this.shadowPos;
    this.fx.burst(p.x, p.z, Math.min(1.9, 0.9 * R * Math.sqrt(S) * 0.75), Math.min(30, Math.round(16 * R * Math.sqrt(S))));
    this.fx.throwAt(p.x, 0.05, p.z, 0, 2.6 + 1.1 * S, 0, Math.min(20, Math.round(6 * S * S)), 1.2 + 0.3 * S, 0.7);
    if (S > 1.5) this.fx.ring(p.x, p.z, 0.5 * S);
    this.ev.breach?.(p.x, p.z, R * Math.sqrt(S));
  }

  private updateLanding(dt: number) {
    const L = this.land_;
    if (!L) return;
    const g = this.fish.group;
    const target = this.handTarget ? this.htLocal.copy(this.handTarget).setY(this.handTarget.y - this.group.position.y) : this.v3.copy(this.tip).setY(1.4);
    if (!L.done) {
      L.t += dt;
      const k = Math.min(1, L.t / this.landArc.dur);
      const e = 1 - Math.pow(1 - k, 2);
      g.position.copy(L.from).lerp(target, e);
      g.position.y += Math.sin(k * Math.PI) * this.landArc.h;
      // leaves the water nose-up (near vertical for the big throws), levels off over the top
      const up = Math.min(1.45, 0.8 + 0.2 * (this.landArc.h - 1.4));
      g.rotation.set(0, Math.atan2(-(target.z - L.from.z), target.x - L.from.x), up * Math.pow(1 - k, 1.6) - 0.3 * Math.sin(k * Math.PI) * (k > 0.5 ? 1 : 0));
      this.fish.leap = Math.sin(k * Math.PI) * 0.8;
      this.fish.present = HOLD.present * k;
      if (Math.random() < dt * 30) this.fx.throwAt(g.position.x, g.position.y, g.position.z, 0, 0, 0, 1, 0.5, 0.45);
      if (k >= 1) {
        L.done = true;
        this.fish.flop(1);
        this.fx.throwAt(target.x, target.y, target.z, 0, 1.5, 0, Math.round(10 * this.rarityScale), 1.8, 0.5);
        this.flopT = 0.9;
        this.ev.landed(L.fish!, this.species!, L.perfect);
      }
    } else {
      // held up, broadside to the camera, flopping now and then
      this.placeHeld(g, target);
      this.flopT -= dt;
      if (this.flopT <= 0) {
        this.flopT = rand(0.8, 1.4);
        this.fish.flop(0.7);
        this.fx.throwAt(target.x, target.y, target.z, 0, 0.6, 0, 3, 0.8, 0.4);
      }
    }
  }

  /** World point a little above the held fish (catch bubble anchor). */
  fishTop(out: THREE.Vector3) {
    const b = this.fish.bounds, g = this.fish.group;
    return out.copy(g.position).setY(g.position.y + (b ? b.yMax : 0.2) * g.scale.x + 0.12 + this.group.position.y);
  }

  /** Rest the fish on the fists (hoist) or in the right hand beside the face (hand). */
  private placeHeld(g: THREE.Object3D, grip: THREE.Vector3) {
    const fm = this.fish, b = fm.bounds, s = g.scale.x;
    fm.leap = 0;
    fm.present = HOLD.present;
    const cx = this.camPos.x - grip.x, cz = this.camPos.z - grip.z;
    let yaw = Math.atan2(cx, cz); // local +Z (the plate side) toward the camera, nose to screen right
    const bottom = (b ? b.belly : 0.1) * s; // hold point → belly (fins hang in front of the fists)
    if (this.holdMode === 'hoist' || !this.headPos) {
      g.position.copy(grip);
      g.position.y += HOLD.fist + bottom * (fm.isFlat ? 0.85 : 0.9) + HOLD.hoistLift;
      const hl = Math.hypot(cx, cz) || 1;
      g.position.x += (cx / hl) * HOLD.hoistFront; g.position.z += (cz / hl) * HOLD.hoistFront;
      g.rotation.set(0, yaw, 0.08);
      return;
    }
    // one hand by the face (hold_show raises the right hand to the cheek): the fish is gripped behind
    // the gills with its nose turned to the skipper's face, the body sticking out away from the head,
    // a little in front of the face plane so it never sinks into the head
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // camera-right on the ground plane
    const h = this.headPos;
    const out = (grip.x - h.x) * rx + (grip.z - h.z) * rz >= 0 ? 1 : -1;
    const noseOut = fm.isFlat ? 1 : -out; // flatfish/crab keep the eyed side (and nose right) to the camera
    if (noseOut < 0) yaw += Math.PI;
    // hold point (42 % from the snout) sits 0.12 L tailward of the grip (30 %); flat/crab: centred out
    const along = (fm.isFlat ? 0.5 * s + 0.04 : 0.12 * s + HOLD.outset) * out;
    const camDx = this.camPos.x - grip.x, camDz = this.camPos.z - grip.z, cl = Math.hypot(camDx, camDz) || 1;
    g.position.set(grip.x + rx * along + (camDx / cl) * HOLD.front, grip.y + HOLD.grip, grip.z + rz * along + (camDz / cl) * HOLD.front);
    g.rotation.set(0, yaw, 0.12 * noseOut);
  }

  /** Called after the catch card closes. */
  finish() { this.cancel(); }

  /** Debug: jump straight to the bite. */
  debugForceBite() {
    if (this.phase === 'casting') { this.t = T.castTime; }
    if (this.phase === 'missed') this.startApproach();
    if (this.phase === 'waiting') { this.biteAt = this.t; this.nibbles = []; }
  }
  /** Debug: reel the fish straight in (captures). */
  debugLand() { if (this.phase === 'reeling') this.distance = -1; }
  /** Debug: force a thrash now (captures). */
  debugThrash() { if (this.phase === 'reeling' && !this.thrashing) this.nextThrash = this.t; }
}
