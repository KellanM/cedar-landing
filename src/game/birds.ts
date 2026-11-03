import * as THREE from 'three';
import { WATER } from './tide';
import { waterHeight } from './swell';
import type { BirdSpawn, Hotspot } from '../world/types';
import { BIRD_PALETTES, birdGeometry, creatureMesh, type CreatureMesh } from '../render/creatures';
import type { SplashFX } from './splash';

// ---------------------------------------------------------------- tuning
const FULL_RATE_DIST = 250; // m: groups beyond this update at LOW_RATE_STEP
const LOW_RATE_STEP = 0.25; // s
const HIDE_DIST = 700; // m: groups beyond this freeze and hide
const FLUSH_DIST = 6; // m: birds on the water / perched take off when the boat is this close
const PERCH_FLUSH_DIST = 7;
const RING_LIFT = 1.2; // m: frenzy rises this much while the boat is inside the ring (kept small: stays in frame)
const FRENZY_H0 = 2.5, FRENZY_H1 = 7; // m: frenzy circling band (3/4 camera sees ~5-7 m up over the ring)
const EXCITE_TIME = 12; // s: how long a catch keeps the frenzy excited
const TAU = Math.PI * 2;

interface Species { scale: number; flapRate: number; glide: number; speed: number }
const SPECIES: Record<string, Species> = {
  gull: { scale: 1.5, flapRate: 17, glide: 0.5, speed: 6.5 },
  cormorant: { scale: 1.3, flapRate: 22, glide: 0.1, speed: 8 },
  eagle: { scale: 2.6, flapRate: 9, glide: 0.85, speed: 6 },
  heron: { scale: 2.1, flapRate: 8, glide: 0.4, speed: 5 },
};
function speciesKey(s?: string) {
  const k = (s ?? '').toLowerCase();
  if (k.includes('cormor') || k.includes('guillemot') || k.includes('murre') || k.includes('crow') || k.includes('raven') || k.includes('shag')) return 'cormorant';
  if (k.includes('eagle') || k.includes('osprey') || k.includes('hawk')) return 'eagle';
  if (k.includes('heron') || k.includes('egret')) return 'heron';
  return 'gull';
}

// bird states
const CIRCLE = 0, DIVE = 1, FLOAT = 2, TAKEOFF = 3, LAND = 4, PERCH = 5, RETURN_PERCH = 6;
const STATE_NAMES = ['circle', 'dive', 'float', 'takeoff', 'land', 'perch', 'returnPerch'];

type Kind = 'frenzy' | 'flock' | 'perch';

interface Group {
  kind: Kind;
  cx: number; cy: number; cz: number;
  radius: number;
  hs: Hotspot | null;
  excite: number;
  lift: number;
  acc: number;
  hidden: boolean;
  birds: Bird[];
}

class Bird {
  st = CIRCLE;
  t = 0; // time in state
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  home = new THREE.Vector3(); // perch spot / floating spot
  yaw = Math.random() * TAU; pitch = 0; roll = 0;
  phase = Math.random() * TAU; rate = 0; amp = 0; ampT = 0; fold = 1; foldT = 1; head = 0; headT = 0;
  flapping = true; flapT = Math.random() * 2;
  omega = 0.5; r = 10; h = 8; ph = Math.random() * TAU;
  diveT = 0; restT = 0; floatT = 0; idleT = 0; actT = 0; act = 0;
  tx = 0; ty = 0; tz = 0; spd = 0;
  floater = false; // frenzy birds that mostly sit on the water
  constructor(public g: Group, public sp: Species, public cm: CreatureMesh, public idx: number, public scale: number) {}
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Live birds: feeding frenzies over fishing hotspots, circling flocks and perched birds.
 * One InstancedMesh per species; wings/head animate in the vertex shader from per-instance
 * (phase, amplitude, fold, headYaw). Behaviour is a small state machine per bird.
 */
export class BirdField {
  group = new THREE.Group();
  /** Audio hook: called when gulls squawk (dive, catch excitement, flushed). */
  onSquawk: ((x: number, y: number, z: number, intensity: number) => void) | null = null;
  private groups: Group[] = [];
  private birds: Bird[] = [];
  private meshes: CreatureMesh[] = [];
  private time = 0;
  // scratch
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private s = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(hotspots: Hotspot[], spawns: BirdSpawn[] | undefined, low: boolean, private splash: SplashFX) {
    type Plan = { g: Group; species: string; n: number; floaters: number; r0: number; r1: number; h0: number; h1: number; perch?: THREE.Vector3 };
    const plans: Plan[] = [];
    const mkGroup = (kind: Kind, c: number[], radius: number, hs: Hotspot | null): Group =>
      ({ kind, cx: c[0], cy: c[1] ?? 0, cz: c[2], radius, hs, excite: 0, lift: 0, acc: 0, hidden: false, birds: [] });
    const nearestHotspot = (x: number, z: number) => {
      let best: Hotspot | null = null, bd = 30;
      for (const h of hotspots) { const d = Math.hypot(h.pos[0] - x, h.pos[2] - z); if (d < bd) { bd = d; best = h; } }
      return best;
    };
    const lowN = (n: number, min: number) => (low ? Math.max(min, Math.round(n * 0.55)) : n);
    const floaters = (tier?: string) => (low ? 1 : tier === 'common' ? 2 : 3);
    // count 0 / missing = "designer didn't say": use tier defaults (4–5 common, 6–7 good, 8–9 rare)
    const tierCount = (tier?: string) =>
      tier === 'rare' ? 10 + Math.round(Math.random()) : tier === 'good' || tier === 'uncommon' ? 8 + Math.round(Math.random()) : 6 + Math.round(Math.random());
    // Export altitude band: `center` y is the middle of the old baked birds' bounds, `height` the top.
    const band = (b: BirdSpawn, def: number, min: number): [number, number] => {
      const top = b.height ?? def, mid = b.center?.[1] ?? top * 0.7;
      const h0 = Math.max(min, Math.min(mid, top) - Math.abs(top - mid));
      return [h0, Math.max(h0 + 3, Math.min(40, top))];
    };

    const frenzies = (spawns ?? []).filter((b) => b.kind === 'hotspot');
    if (frenzies.length) {
      for (const b of frenzies) {
        const c = b.pos ?? b.center; // pos = the hotspot ripple (dives aim here)
        if (!c) continue;
        const hs = nearestHotspot(c[0], c[2]);
        const radius = b.radius ?? 8;
        // Frenzies stay low (2.5–7 m): the 3/4 chase camera's top edge is only ~5–7 m up over the ring,
        // so the export's old baked heights (8–15 m) put every gull out of frame.
        const g = mkGroup('frenzy', [c[0], 0, c[2]], radius, hs);
        plans.push({ g, species: speciesKey(b.species), n: lowN(b.count || tierCount(hs?.tier), 3), floaters: floaters(hs?.tier),
          r0: Math.max(4, radius * 0.8), r1: radius * 1.4 + 2, h0: FRENZY_H0, h1: FRENZY_H1 });
      }
      // Hotspots the export gave no birds still get a small gull frenzy.
      for (const hs of hotspots) {
        if (frenzies.some((b) => { const c = b.pos ?? b.center; return c && Math.hypot(c[0] - hs.pos[0], c[2] - hs.pos[2]) < 15; })) continue;
        const tier = hs.tier ?? 'common';
        const g = mkGroup('frenzy', hs.pos, 9, hs);
        plans.push({ g, species: 'gull', n: lowN(tierCount(tier), 3), floaters: floaters(tier), r0: 5, r1: 13, h0: FRENZY_H0, h1: FRENZY_H1 });
      }
    } else {
      // Fallback (export without `birds`): a gull frenzy over every fishing hotspot.
      for (const hs of hotspots) {
        const tier = hs.tier ?? 'common';
        const n = tierCount(tier);
        const radius = tier === 'common' ? 9 : 11;
        const g = mkGroup('frenzy', hs.pos, radius, hs);
        plans.push({ g, species: 'gull', n: lowN(n, 3), floaters: floaters(tier), r0: 5, r1: radius + 4, h0: FRENZY_H0, h1: FRENZY_H1 });
      }
    }
    for (const b of spawns ?? []) {
      if (b.kind === 'flock') {
        const c = b.center ?? b.pos;
        if (!c) continue;
        const radius = Math.max(6, b.radius ?? 20);
        const [h0, h1] = band(b, 20, 6);
        const g = mkGroup('flock', [c[0], 0, c[2]], radius, null);
        plans.push({ g, species: speciesKey(b.species), n: lowN(b.count || 6, 2), floaters: 0,
          r0: radius * 0.7, r1: radius * 1.2, h0, h1 });
      } else if (b.kind === 'perched') {
        const p = b.pos ?? b.center;
        if (!p) continue;
        const sp = SPECIES[speciesKey(b.species)];
        // Tall bounds (eagle on a snag): perch at the top. Otherwise on the rock / water at pos.
        const y = b.height !== undefined && b.height > p[1] + 3 ? b.height - 0.25 * sp.scale : Math.max(p[1], 0) + (speciesKey(b.species) === 'heron' ? 0.36 * sp.scale : 0); // heron stands on its legs
        const g = mkGroup('perch', [p[0], y, p[2]], 7, null);
        plans.push({ g, species: speciesKey(b.species), n: low ? 1 : Math.max(1, b.count || 1), floaters: 0, r0: 6, r1: 9, h0: 4, h1: 7,
          perch: new THREE.Vector3(p[0], y, p[2]) });
      }
    }

    // One mesh per species, sized to the plan.
    const counts = new Map<string, number>();
    for (const p of plans) counts.set(p.species, (counts.get(p.species) ?? 0) + p.n + p.floaters);
    const meshBy = new Map<string, CreatureMesh>();
    for (const [sp, n] of counts) {
      const cm = creatureMesh(birdGeometry(BIRD_PALETTES[sp], sp === 'heron' ? 0.36 : 0), n);
      cm.mesh.name = `birds_${sp}`;
      meshBy.set(sp, cm);
      this.meshes.push(cm);
      this.group.add(cm.mesh);
    }
    const used = new Map<string, number>();
    for (const p of plans) {
      const cm = meshBy.get(p.species)!;
      const sp = SPECIES[p.species];
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < p.n + p.floaters; i++) {
        const idx = used.get(p.species) ?? 0;
        used.set(p.species, idx + 1);
        const b = new Bird(p.g, sp, cm, idx, sp.scale * rand(0.9, 1.1));
        b.r = rand(p.r0, p.r1);
        b.h = p.h0 + (p.h1 - p.h0) * Math.random() * Math.random(); // biased low (stays in the chase-cam frame)
        // flocks circle together; frenzy birds mix directions a little
        const sgn = p.g.kind === 'frenzy' && Math.random() < 0.3 ? -dir : dir;
        b.omega = sgn * rand(0.8, 1.15) * Math.min(sp.speed / b.r, 0.9);
        b.diveT = rand(2, 14);
        const a = Math.random() * TAU;
        if (p.perch) {
          b.home.set(p.perch.x + (i ? rand(-1.2, 1.2) : 0), p.perch.y, p.perch.z + (i ? rand(-1.2, 1.2) : 0));
          b.pos.copy(b.home);
          b.st = PERCH;
          b.idleT = rand(0.5, 3);
        } else if (i >= p.n) {
          b.floater = true;
          b.home.set(p.g.cx + Math.cos(a) * rand(2, 7), 0, p.g.cz + Math.sin(a) * rand(2, 7));
          b.pos.copy(b.home);
          b.st = FLOAT;
          b.restT = rand(20, 60);
        } else {
          b.pos.set(p.g.cx + Math.cos(a) * b.r, b.h, p.g.cz + Math.sin(a) * b.r);
          b.vel.set(-Math.sin(a) * sgn, 0, Math.cos(a) * sgn).multiplyScalar(Math.abs(b.omega) * b.r);
          b.yaw = Math.atan2(b.vel.x, b.vel.z);
          b.fold = b.foldT = 0;
          b.amp = b.ampT = 0.85;
        }
        p.g.birds.push(b);
        this.birds.push(b);
      }
      this.groups.push(p.g);
    }
  }

  get count() { return this.birds.length; }

  stats() {
    const by: Record<string, number> = {};
    for (const b of this.birds) by[STATE_NAMES[b.st]] = (by[STATE_NAMES[b.st]] ?? 0) + 1;
    return { birds: this.birds.length, groups: this.groups.length, states: by };
  }

  /** A fish was landed near (x,z): nearby frenzies get excited (more dives, squawks). */
  excite(x: number, z: number) {
    for (const g of this.groups) {
      if (g.kind !== 'frenzy' || Math.hypot(g.cx - x, g.cz - z) > 35) continue;
      g.excite = 1;
      let n = 0;
      for (const b of g.birds) if (b.st === CIRCLE && !b.floater && n++ < 3) b.diveT = rand(0.2, 1.5);
      this.onSquawk?.(g.cx, 8, g.cz, 1);
    }
  }

  /** Debug: make every circling bird in the frenzy nearest (x,z) dive soon. */
  forceDives(x: number, z: number) {
    let best: Group | null = null, bd = Infinity;
    for (const g of this.groups) { const d = Math.hypot(g.cx - x, g.cz - z); if (g.kind === 'frenzy' && d < bd) { bd = d; best = g; } }
    if (!best) return 0;
    let n = 0;
    for (const b of best.birds) if (b.st === CIRCLE && !b.floater) { b.diveT = n * 0.35; n++; }
    return n;
  }

  update(dt: number, cam: THREE.Vector3, boat: THREE.Vector3) {
    this.time += dt;
    let dirty = false;
    for (const g of this.groups) {
      const d = Math.hypot(g.cx - cam.x, g.cz - cam.z);
      if (d > HIDE_DIST) {
        if (!g.hidden) {
          for (const b of g.birds) b.cm.mesh.setMatrixAt(b.idx, this.zero);
          g.hidden = true;
          dirty = true;
        }
        continue;
      }
      let gdt = dt;
      if (d > FULL_RATE_DIST) {
        g.acc += dt;
        if (g.acc < LOW_RATE_STEP && !g.hidden) continue;
        gdt = Math.min(g.acc, 0.5);
        g.acc = 0;
      }
      g.hidden = false;
      dirty = true;
      const inside = Math.hypot(g.cx - boat.x, g.cz - boat.z) < g.radius + 2;
      g.lift += ((inside && g.kind === 'frenzy' ? RING_LIFT : 0) - g.lift) * Math.min(1, gdt * 0.8);
      g.excite = Math.max(0, g.excite - gdt / EXCITE_TIME);
      for (const b of g.birds) {
        this.step(b, gdt, boat);
        this.write(b, gdt);
      }
    }
    if (dirty) {
      for (const cm of this.meshes) { cm.mesh.instanceMatrix.needsUpdate = true; cm.anim.needsUpdate = true; }
    }
  }

  // ---------------------------------------------------------------- behaviour
  private enter(b: Bird, st: number) { b.st = st; b.t = 0; }

  private seek(b: Bird, spd: number, turn: number, dt: number) {
    const dx = b.tx - b.pos.x, dy = b.ty - b.pos.y, dz = b.tz - b.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1e-4;
    const k = Math.min(1, turn * dt);
    b.vel.x += ((dx / d) * spd - b.vel.x) * k;
    b.vel.y += ((dy / d) * spd - b.vel.y) * k;
    b.vel.z += ((dz / d) * spd - b.vel.z) * k;
    b.pos.addScaledVector(b.vel, dt);
    return d;
  }

  private takeoff(b: Bird, boat: THREE.Vector3) {
    let ax = b.pos.x - boat.x, az = b.pos.z - boat.z;
    const l = Math.hypot(ax, az);
    if (l < 0.5 || l > 15) { const a = Math.random() * TAU; ax = Math.cos(a); az = Math.sin(a); } else { ax /= l; az /= l; }
    b.tx = b.pos.x + ax * 9; b.ty = b.pos.y + rand(4, 6); b.tz = b.pos.z + az * 9;
    b.spd = 2.5;
    b.vel.set(ax, 1.2, az);
    if (b.pos.y < 0.3) this.splash.ring(b.pos.x, b.pos.z, 0.5);
    this.enter(b, TAKEOFF);
  }

  private step(b: Bird, dt: number, boat: THREE.Vector3) {
    const g = b.g, sp = b.sp;
    b.t += dt;
    const bdx = b.pos.x - boat.x, bdz = b.pos.z - boat.z;
    const boatD2 = bdx * bdx + bdz * bdz;
    switch (b.st) {
      case CIRCLE: {
        const cx = g.kind === 'perch' ? b.home.x : g.cx, cz = g.kind === 'perch' ? b.home.z : g.cz;
        const cy = g.kind === 'perch' ? b.home.y : g.cy;
        const r = b.r + Math.sin(this.time * 0.31 + b.ph) * 1.2;
        const a = Math.atan2(b.pos.z - cz, b.pos.x - cx) + 0.45 * Math.sign(b.omega);
        b.tx = cx + Math.cos(a) * r;
        b.tz = cz + Math.sin(a) * r;
        b.ty = cy + b.h + g.lift + Math.sin(this.time * 0.43 + b.ph * 1.7) * 0.9;
        const spd = Math.min(sp.speed * 1.3, Math.max(3.5, Math.abs(b.omega) * r * 1.1));
        this.seek(b, spd, 2.2, dt);
        if (b.pos.y < 0.5) b.pos.y = 0.5;
        // flap / glide rhythm
        b.flapT -= dt;
        if (b.flapT <= 0) {
          b.flapping = !b.flapping && Math.random() > sp.glide * 0.6;
          b.flapT = b.flapping ? rand(0.8, 2.2) : rand(1.5, 4.5);
        }
        const climbing = b.vel.y > 0.6 || b.t < 0.8;
        b.ampT = b.flapping || climbing ? 0.85 : 0.05;
        b.rate = b.flapping || climbing ? sp.flapRate : 2;
        b.foldT = 0;
        if (g.kind === 'frenzy') {
          if (b.floater) {
            b.restT -= dt;
            if (b.restT <= 0) this.startLand(b, boat);
          } else {
            b.diveT -= dt * (1 + g.excite * 3);
            if (b.diveT <= 0) this.startDive(b);
          }
        } else if (g.kind === 'perch') {
          b.restT -= dt;
          if (b.restT <= 0 && boatD2 > 81) {
            b.tx = b.home.x; b.ty = b.home.y; b.tz = b.home.z;
            this.enter(b, RETURN_PERCH);
          }
        }
        break;
      }
      case DIVE: {
        if (b.t < 0.3) { // short wing-up stall before tucking
          b.ampT = 0.5; b.rate = sp.flapRate * 0.6; b.foldT = 0;
          this.seek(b, 4, 2, dt);
          break;
        }
        b.spd = Math.min(19, b.spd + 16 * dt);
        b.ampT = 0; b.foldT = 0.8;
        this.seek(b, b.spd, 3.5, dt);
        if (b.pos.y <= WATER.y + 0.1 || b.t > 5) {
          b.pos.y = WATER.y;
          this.splash.splash(b.pos.x, b.pos.z, 1);
          b.vel.set(0, 0, 0);
          b.floatT = rand(1.8, 4.2);
          b.fold = 0.6;
          this.enter(b, FLOAT);
        }
        break;
      }
      case FLOAT: {
        b.pos.y = waterHeight(b.pos.x, b.pos.z) + Math.sin(this.time * 1.6 + b.ph) * 0.03 + 0.03; // tide (+ swell): float on the water
        b.yaw += Math.sin(this.time * 0.2 + b.ph) * 0.15 * dt;
        b.ampT = 0; b.foldT = 1; b.rate = 0;
        b.idleT -= dt;
        if (b.idleT <= 0) { b.headT = Math.random() < 0.5 ? 0 : rand(-0.9, 0.9); b.idleT = rand(1.5, 4); }
        if (boatD2 < FLUSH_DIST * FLUSH_DIST && b.t > 0.8) {
          this.takeoff(b, boat);
          if (Math.random() < 0.4) this.onSquawk?.(b.pos.x, b.pos.y, b.pos.z, 0.5);
        } else if (b.floater ? (b.restT -= dt) <= 0 : b.t > b.floatT) {
          this.takeoff(b, boat);
        }
        break;
      }
      case TAKEOFF: {
        b.spd = Math.min(sp.speed, b.spd + 4 * dt);
        b.ampT = 1.05; b.rate = sp.flapRate * 1.25; b.foldT = 0; b.headT = 0;
        this.seek(b, b.spd, 3, dt);
        if (b.pos.y < 0.2) b.pos.y = 0.2;
        if (b.t > 1.8) {
          b.diveT = rand(4, 12);
          b.restT = g.kind === 'perch' ? rand(6, 11) : rand(10, 25);
          this.enter(b, CIRCLE);
        }
        break;
      }
      case LAND: {
        const d = Math.hypot(b.tx - b.pos.x, b.tz - b.pos.z);
        this.seek(b, Math.min(6.5, Math.max(1.5, d * 0.9)), 2.5, dt);
        b.foldT = 0;
        b.ampT = d < 3 ? 0.9 : 0.08;
        b.rate = d < 3 ? sp.flapRate : 2;
        if ((d < 0.8 && b.pos.y < WATER.y + 0.4) || b.t > 14) {
          b.pos.y = WATER.y;
          b.vel.set(0, 0, 0);
          this.splash.ring(b.pos.x, b.pos.z, 0.4);
          b.restT = rand(20, 60);
          this.enter(b, FLOAT);
        }
        break;
      }
      case PERCH: {
        b.vel.set(0, 0, 0);
        b.foldT = 1; b.rate = 0;
        b.pos.copy(b.home);
        if (b.home.y < 0.2) b.pos.y = waterHeight(b.pos.x, b.pos.z) + 0.03 + Math.sin(this.time * 1.6 + b.ph) * 0.03; // sitting on the water (tide + swell)
        b.idleT -= dt;
        if (b.idleT <= 0) {
          const r = Math.random();
          b.act = r < 0.45 ? 0 : r < 0.7 ? 1 : r < 0.9 ? 2 : 3;
          b.actT = b.act === 1 ? 1.3 : b.act === 2 ? 0.4 : 0;
          if (b.act === 0) b.headT = Math.random() < 0.3 ? 0 : rand(-1, 1);
          if (b.act === 2) b.yaw += rand(-0.8, 0.8);
          b.idleT = rand(1.5, 4.5);
        }
        if (b.actT > 0) {
          b.actT -= dt;
          if (b.act === 1) { b.foldT = 0.15; b.ampT = 0.8; b.phase = Math.PI / 2; } // wing stretch
          else if (b.act === 2) b.pos.y += Math.sin((1 - b.actT / 0.4) * Math.PI) * 0.15; // hop
        } else b.ampT = 0;
        if (boatD2 < PERCH_FLUSH_DIST * PERCH_FLUSH_DIST) {
          this.takeoff(b, boat);
          this.onSquawk?.(b.pos.x, b.pos.y, b.pos.z, 0.4);
        }
        break;
      }
      case RETURN_PERCH: {
        const d = Math.hypot(b.tx - b.pos.x, b.ty - b.pos.y, b.tz - b.pos.z);
        this.seek(b, Math.min(sp.speed, Math.max(1.2, d * 0.9)), 3, dt);
        b.foldT = 0;
        b.ampT = d < 3 ? 0.9 : 0.1;
        b.rate = d < 3 ? sp.flapRate : 2;
        if (d < 0.3 || b.t > 15) {
          b.pos.copy(b.home);
          b.yaw += Math.PI; // turn to face out
          b.idleT = rand(1, 3);
          this.enter(b, PERCH);
        }
        break;
      }
    }
  }

  private startDive(b: Bird) {
    const g = b.g;
    const a = Math.random() * TAU, r = Math.random() * 3.5;
    b.tx = g.cx + Math.cos(a) * r; b.ty = -0.3; b.tz = g.cz + Math.sin(a) * r;
    b.spd = 4;
    this.enter(b, DIVE);
    if (Math.random() < 0.35) this.onSquawk?.(b.pos.x, b.pos.y, b.pos.z, 0.6);
  }

  private startLand(b: Bird, boat: THREE.Vector3) {
    const g = b.g;
    // pick a spot on the ring away from the boat
    let bx = 0, bz = 0, best = -1;
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * TAU, r = rand(2, 7);
      const x = g.cx + Math.cos(a) * r, z = g.cz + Math.sin(a) * r;
      const d = Math.hypot(x - boat.x, z - boat.z);
      if (d > best) { best = d; bx = x; bz = z; }
    }
    if (best < FLUSH_DIST + 2) { b.restT = rand(6, 12); return; } // boat sits on the ring: keep circling
    b.tx = bx; b.ty = 0; b.tz = bz;
    b.home.set(bx, 0, bz);
    this.enter(b, LAND);
  }

  // ---------------------------------------------------------------- pose → instance
  private write(b: Bird, dt: number) {
    const flying = b.st !== FLOAT && b.st !== PERCH;
    const k = Math.min(1, dt * 6);
    b.amp += (b.ampT - b.amp) * k;
    b.fold += (b.foldT - b.fold) * Math.min(1, dt * (b.st === DIVE ? 4 : 5));
    b.head += (b.headT - b.head) * Math.min(1, dt * 5);
    b.phase = (b.phase + b.rate * dt) % TAU;
    let pitchT = 0, rollT = 0;
    if (flying) {
      const hs = Math.hypot(b.vel.x, b.vel.z);
      let yawRate = 0;
      if (hs > 0.2) {
        const d = wrap(Math.atan2(b.vel.x, b.vel.z) - b.yaw);
        const step = d * Math.min(1, dt * 8);
        b.yaw += step;
        yawRate = dt > 0 ? step / dt : 0;
      }
      pitchT = Math.max(-0.9, Math.min(1.35, -Math.atan2(b.vel.y, Math.max(hs, 0.01))));
      rollT = Math.max(-0.85, Math.min(0.85, -yawRate * 0.45));
      b.headT = b.st === CIRCLE ? Math.max(-0.5, Math.min(0.5, -rollT * 0.4)) : 0; // look into the turn
    } else if (b.st === FLOAT) {
      rollT = Math.sin(this.time * 1.3 + b.ph) * 0.06;
      pitchT = Math.sin(this.time * 1.6 + b.ph + 1) * 0.05;
    }
    const kk = Math.min(1, dt * 5);
    b.pitch += (pitchT - b.pitch) * kk;
    b.roll += (rollT - b.roll) * kk;
    this.e.set(b.pitch, b.yaw, b.roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.s.setScalar(b.scale);
    this.m.compose(b.pos, this.q, this.s);
    b.cm.mesh.setMatrixAt(b.idx, this.m);
    b.cm.anim.setXYZW(b.idx, b.phase, b.amp, b.fold, b.head);
  }
}
