import * as THREE from 'three';
import { pickSpecies, priceFor, rollSize, type CaughtFish, type Species } from './fishdata';
import type { Hotspot } from '../world/types';

export type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'missed' | 'reeling' | 'landed';

/** Tunables (game_design_reference §6.1): forgiving, 5–20 s per catch, line slips instead of snapping. */
const T = {
  castTime: 0.8,
  approachMin: 2.0,
  approachMax: 3.8,
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

const BEHAVIOR = {
  calm: { every: [2.6, 4.0], len: [0.7, 1.0] },
  darter: { every: [1.6, 2.6], len: [0.5, 0.8] },
  diver: { every: [2.0, 3.2], len: [1.0, 1.4] },
  sprinter: { every: [1.4, 2.4], len: [0.9, 1.3] },
} as const;
const START_DIST = { common: 7, uncommon: 10, rare: 13, legendary: 16 } as const;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export interface FishingEvents {
  toast(msg: string, kind?: 'info' | 'good' | 'warn'): void;
  landed(fish: CaughtFish, species: Species, perfect: boolean): void;
  bite(): void;
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

  private t = 0;
  private nibbles: number[] = [];
  private nextThrash = 0;
  private thrashEnd = 0;

  // visuals
  group = new THREE.Group();
  readonly bobber: THREE.Group;
  private line: THREE.Line;
  private shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private splash: THREE.Mesh;
  private splashT = 9;
  private castFrom = new THREE.Vector3();
  bobberPos = new THREE.Vector3();
  private shadowFrom = new THREE.Vector3();
  private shadowPos = new THREE.Vector3();
  private dip = 0;

  constructor(private ev: FishingEvents) {
    this.bobber = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc8402f }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2efe6 }));
    this.bobber.add(top, bot);
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xf4f1e8, transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 16).scale(0.35, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0d1a1f, transparent: true, opacity: 0.0, depthWrite: false }));
    this.shadow.position.y = 0.01;
    this.splash = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.group.add(this.bobber, this.line, this.shadow, this.splash);
    this.group.visible = false;
  }

  get active() { return this.phase !== 'idle'; }

  /** Start a cast toward the hotspot. */
  cast(hs: Hotspot, rodTip: THREE.Vector3, boatPos: THREE.Vector3) {
    this.hotspot = hs;
    this.phase = 'casting';
    this.t = 0;
    this.castFrom.copy(rodTip);
    // land the bobber between the boat and the hotspot centre, ≤ 7 m out
    const hp = new THREE.Vector3(hs.pos[0], 0, hs.pos[2]);
    const dir = hp.clone().sub(boatPos).setY(0);
    const d = Math.min(7, Math.max(3.5, dir.length()));
    dir.normalize().multiplyScalar(d);
    if (!isFinite(dir.x)) dir.set(0, 0, -4);
    this.bobberPos.copy(boatPos).add(dir).setY(0);
    this.group.visible = true;
    this.shadow.material.opacity = 0;
  }

  cancel() {
    this.phase = 'idle';
    this.group.visible = false;
    this.thrashing = false;
  }

  private startApproach() {
    this.phase = 'waiting';
    this.t = 0;
    this.species = pickSpecies(this.hotspot?.fish_pool ?? [], this.hotspot?.tier);
    const ang = Math.random() * Math.PI * 2;
    this.shadowFrom.set(this.bobberPos.x + Math.cos(ang) * 6, 0.01, this.bobberPos.z + Math.sin(ang) * 6);
    this.shadowPos.copy(this.shadowFrom);
    const approach = rand(T.approachMin, T.approachMax);
    // 0–3 nibbles after the shadow arrives, then the bite
    const n = Math.floor(Math.random() * 4);
    this.nibbles = [];
    let at = approach;
    for (let i = 0; i < n; i++) { at += rand(0.6, 1.2); this.nibbles.push(at); }
    this.biteAt = at + rand(0.7, 1.4);
    this.approachDur = approach;
    const big = this.species.rarity === 'common' ? 1 : this.species.rarity === 'uncommon' ? 1.4 : 1.9;
    this.shadow.scale.setScalar(0.8 * big);
  }
  private biteAt = 0;
  private approachDur = 2;

  /** Action button pressed (tap). Returns true if consumed. */
  press(): boolean {
    switch (this.phase) {
      case 'waiting':
        // Too early: the fish startles but stays around — try again, no bait loss.
        this.ev.toast('Too early! It swam off…', 'warn');
        this.phase = 'missed';
        this.t = 0;
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
  }

  private scheduleThrash(minDelay = 0) {
    const b = BEHAVIOR[this.species!.behavior];
    this.nextThrash = this.t + minDelay + rand(b.every[0], b.every[1]);
    this.thrashEnd = 0;
  }

  update(dt: number, held: boolean, rodTip: THREE.Vector3, boatPos: THREE.Vector3) {
    if (this.phase === 'idle') return;
    this.t += dt;
    this.splashT += dt;
    this.dip *= Math.exp(-dt * 6);

    switch (this.phase) {
      case 'casting': {
        const k = Math.min(1, this.t / T.castTime);
        const p = this.castFrom.clone().lerp(this.bobberPos, k);
        p.y = THREE.MathUtils.lerp(this.castFrom.y, 0, k) + Math.sin(k * Math.PI) * 2.2;
        this.bobber.position.copy(p);
        if (k >= 1) { this.doSplash(0.6); this.startApproach(); }
        break;
      }
      case 'waiting': {
        const k = Math.min(1, this.t / this.approachDur);
        const e = THREE.MathUtils.smoothstep(k, 0, 1);
        this.shadowPos.copy(this.shadowFrom).lerp(new THREE.Vector3(this.bobberPos.x, 0.01, this.bobberPos.z), e * 0.88);
        this.shadow.material.opacity = Math.min(0.45, this.t * 0.4);
        while (this.nibbles.length && this.t >= this.nibbles[0]) { this.nibbles.shift(); this.dip = 0.08; this.doSplash(0.25); }
        if (this.t >= this.biteAt) {
          this.phase = 'bite';
          this.t = 0;
          this.dip = 0.35;
          this.doSplash(1.4);
          this.ev.bite();
          if (this.autoReel) this.startReel(); // assist: auto-hook too
        }
        break;
      }
      case 'bite': {
        this.dip = Math.max(this.dip, 0.25);
        if (this.t > T.biteWindow) {
          this.ev.toast('Missed the bite — it\'s still nearby', 'warn');
          this.phase = 'missed';
          this.t = 0;
        }
        break;
      }
      case 'missed': {
        // shadow swims off a bit then comes back for another go
        const away = new THREE.Vector3(this.shadowPos.x - this.bobberPos.x, 0, this.shadowPos.z - this.bobberPos.z).normalize();
        this.shadowPos.addScaledVector(away, dt * 2.5);
        this.shadow.material.opacity = Math.max(0.15, 0.45 - this.t * 0.25);
        if (this.t > T.missedTime) {
          const cur = this.shadowPos.clone();
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
        if (!this.thrashing && this.t >= this.nextThrash) {
          const b = BEHAVIOR[this.species!.behavior];
          this.thrashing = true;
          this.thrashEnd = this.t + rand(b.len[0], b.len[1]);
        } else if (this.thrashing && this.t >= this.thrashEnd) {
          this.thrashing = false;
          this.scheduleThrash();
        }
        if (held) {
          this.distance -= T.reelSpeed * dt * (this.thrashing ? 0.45 : 1);
          this.tension += (this.thrashing ? T.thrashBuild : T.tensionBuild) * dt;
        } else {
          this.distance += (this.thrashing ? T.thrashPull : T.basePull) * dt;
          this.tension -= T.tensionDecay * dt;
        }
        this.distance = Math.min(this.distance, this.startDistance + 6);
        this.tension = Math.max(0, this.tension);
        this.maxTension = Math.max(this.maxTension, this.tension);
        if (this.tension >= 1) {
          // Normal fish never snap: the line slips and the fish gains a little distance.
          this.slips++;
          this.distance += T.slipGain;
          this.tension = 0.55;
          this.ev.toast('Line slipped! Ease off when it thrashes', 'warn');
        }
        // fish shadow tugs around at the line's end
        const dir = new THREE.Vector3(this.bobberPos.x - boatPos.x, 0, this.bobberPos.z - boatPos.z).normalize();
        const wob = Math.sin(this.t * (this.thrashing ? 9 : 3)) * (this.thrashing ? 0.9 : 0.3);
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        const d = Math.max(0.5, this.distance * 0.55);
        this.shadowPos.set(boatPos.x + dir.x * d + side.x * wob, 0.01, boatPos.z + dir.z * d + side.z * wob);
        this.shadow.material.opacity = 0.5;
        if (this.thrashing && Math.random() < dt * 6) this.doSplash(0.5, this.shadowPos);
        if (this.distance <= 0) this.land();
        break;
      }
      case 'landed':
        break;
    }

    // visuals
    if (this.phase !== 'casting') {
      const bp = this.phase === 'reeling' ? this.shadowPos : this.bobberPos;
      this.bobber.position.set(bp.x, -this.dip + Math.sin(performance.now() / 400) * 0.02, bp.z);
    }
    this.bobber.visible = this.phase !== 'landed';
    this.shadow.position.set(this.shadowPos.x, 0.01, this.shadowPos.z);
    this.shadow.visible = this.phase !== 'casting' && this.phase !== 'landed';
    this.shadow.lookAt(this.bobberPos.x, 0.01, this.bobberPos.z);
    const lp = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    lp.setXYZ(0, rodTip.x, rodTip.y, rodTip.z);
    lp.setXYZ(1, this.bobber.position.x, this.bobber.position.y + 0.1, this.bobber.position.z);
    lp.needsUpdate = true;
    this.line.visible = this.phase !== 'landed';
    const sm = this.splash.material as THREE.MeshBasicMaterial;
    sm.opacity = Math.max(0, 0.8 - this.splashT * 1.2);
    this.splash.scale.setScalar(this.splashSize * (0.5 + this.splashT * 1.6));
  }
  private splashSize = 1;

  private doSplash(size: number, at?: THREE.Vector3) {
    this.splashT = 0;
    this.splashSize = size;
    const p = at ?? this.bobberPos;
    this.splash.position.set(p.x, 0.03, p.z);
  }

  private land() {
    const sp = this.species!;
    const size = rollSize(sp);
    const perfect = this.maxTension <= T.perfectMax && this.slips === 0;
    const big = (size - sp.size[0]) / Math.max(1, sp.size[1] - sp.size[0]) >= 0.7;
    const stars = 1 + (big ? 1 : 0) + (perfect ? 1 : 0);
    this.phase = 'landed';
    this.thrashing = false;
    this.doSplash(1.0, this.shadowPos);
    const fish: CaughtFish = { speciesId: sp.id, name: sp.name, size, stars, price: priceFor(sp, size, stars), color: sp.color, rarity: sp.rarity, releaseOnly: sp.releaseOnly };
    this.ev.landed(fish, sp, perfect);
  }

  /** Called after the catch card closes. */
  finish() { this.cancel(); }

  /** Debug: jump straight to the bite. */
  debugForceBite() {
    if (this.phase === 'casting') { this.t = T.castTime; }
    if (this.phase === 'missed') this.startApproach();
    if (this.phase === 'waiting') { this.biteAt = this.t; this.nibbles = []; }
  }
}
