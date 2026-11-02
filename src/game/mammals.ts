import * as THREE from 'three';
import type { LoadedChunk, MammalSpawn } from '../world/types';
import type { LandCollision } from './collision';
import type { SplashFX } from './splash';
import {
  BlowFX, dallsGeometry, dolphinGeometry, humpbackGeometry, mammalMesh, orcaGeometry, otterGeometry, sealGeometry, type MammalMesh,
} from '../render/mammals';

/**
 * Live marine mammals from gameplay.json.mammals (see docs/study/marine_mammals.md):
 *  - orca pod: travels through open water; synchronized-ish surfacing sequences (blow as the head
 *    breaks, rolling arc of back + dorsal fin, 3–5 short breaths, then a long dive with a peduncle
 *    arch); calf in echelon beside its mother; occasional spyhop (turns to look at you), tail-lob,
 *    breach; keeps ~60–100 m from the boat without fleeing;
 *  - humpback: slow travel, tall bushy blows, fluke-up terminal dive;
 *  - Pacific white-sided dolphins (clean leaps) and Dall's porpoises (fast "rooster-tail" surfacings):
 *    roam near home and come to bow-ride a moving boat for a while;
 *  - harbour seals / Steller sea lions hauled out on their rocks: head lifts, banana pose, alert, flop
 *    into the water when the boat comes close, bottle and watch, haul back out once it has gone;
 *  - harbour seal heads: bottling, watching the boat, sinking silently, resurfacing nearby;
 *  - river otters: swim head-up in a little family group, periscope, porpoise-dive (not back-floating).
 * One InstancedMesh per species + one blow pool; no per-frame allocation.
 */

const FULL_RATE_DIST = 250; // m: groups further away update at LOW_RATE_STEP
const LOW_RATE_STEP = 0.25;
const HIDE_WHALE = 700; // m: whales/dolphins hidden beyond
const HIDE_SMALL = 320; // m: seals/otters hidden beyond
const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// cetacean acts
const SWIM = 0, ROLL = 1, SPYHOP = 2, TAILLOB = 3, BREACH = 4, LEAP = 5, FLUKE = 6;
const ACT_NAMES = ['swim', 'roll', 'spyhop', 'taillob', 'breach', 'leap', 'fluke'];

type Sp = 'orca' | 'humpback' | 'dolphin' | 'porpoise';
interface SpTune { speed: number; turn: number; roll: number; blowH: number; wander: number; keep: number }
const TUNE: Record<Sp, SpTune> = {
  // speed m/s, turn rad/s, roll s (one surfacing), blow height m, wander radius m, boat keep-away m
  orca: { speed: 2.3, turn: 0.13, roll: 2.7, blowH: 2.6, wander: 230, keep: 70 },
  humpback: { speed: 1.3, turn: 0.07, roll: 3.6, blowH: 4.2, wander: 140, keep: 80 },
  dolphin: { speed: 4.6, turn: 0.6, roll: 1.0, blowH: 0, wander: 70, keep: 0 },
  porpoise: { speed: 5.2, turn: 0.7, roll: 0.75, blowH: 0, wander: 70, keep: 0 },
};

interface Ceta {
  mm: MammalMesh; idx: number; len: number; finH: number; calf: boolean; mother: Ceta | null; side: number;
  ox: number; oz: number; lag: number;
  x: number; z: number; y: number; yaw: number; pitch: number; roll: number; arch: number; amp: number; phase: number; rate: number;
  act: number; t: number; dur: number; final: boolean; pend: number; pendFinal: boolean;
  blown: boolean; fx: number; vy: number; y0: number; gap: number; lookYaw: number;
  hidden: boolean;
}

interface Pod {
  name: string; sp: Sp; tune: SpTune; members: Ceta[];
  cx: number; cz: number; yaw: number; spd: number; ax: number; az: number; wx: number; wz: number;
  breaths: number; breathT: number; diving: boolean; specialT: number; queued: number;
  acc: number; hidden: boolean;
  bow: number; bowT: number; bowCool: number; bowSide: number;
  relocated: boolean;
}

// pinniped states
const REST = 0, ALERT = 1, FLOP = 2, WATER = 3, SUNK = 4, RETURN = 5;
const PIN_NAMES = ['rest', 'alert', 'flop', 'water', 'sunk', 'return'];

interface Pin {
  idx: number; len: number; lion: boolean; onRock: boolean; checked: boolean;
  hx: number; hy: number; hz: number; hyaw: number; // haul-out spot (rock) or home in the water
  ex: number; ez: number; wx: number; wz: number; // rock edge, water spot
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
  head: number; headT: number; arch: number; archT: number; rollT: number;
  st: number; t: number; dur: number; idleT: number; act: number; actT: number; away: number; ph: number;
}

interface SealGroup { name: string; kind: string; cx: number; cz: number; seals: Pin[]; acc: number; hidden: boolean }

// otters
const O_SWIM = 0, O_SCOPE = 1, O_DIVE = 2, O_UNDER = 3;
interface Otter {
  idx: number; len: number; x: number; z: number; yaw: number; y: number; pitch: number; roll: number; head: number;
  tx: number; tz: number; st: number; t: number; dur: number; ph: number; rollT: number;
}
interface OtterGroup { name: string; hx: number; hz: number; otters: Otter[]; acc: number; hidden: boolean }

function speciesOf(s: string): Sp | 'seal' | 'lion' | 'otter' | null {
  const k = s.toLowerCase();
  if (k.includes('orca') || k.includes('killer')) return 'orca';
  if (k.includes('humpback') || k.includes('whale')) return 'humpback';
  if (k.includes('dall') || k.includes('porpoise')) return 'porpoise';
  if (k.includes('dolphin')) return 'dolphin';
  if (k.includes('lion')) return 'lion';
  if (k.includes('seal')) return 'seal';
  if (k.includes('otter')) return 'otter';
  return null;
}

export class MammalField {
  group = new THREE.Group();
  blows = new BlowFX();
  /** Audio hooks (no sound assets yet): whale blow, big splash (breach / tail-lob), seal splash. */
  onSound: ((kind: 'blow' | 'breach' | 'slap' | 'seal', x: number, z: number) => void) | null = null;
  private pods: Pod[] = [];
  private seals: SealGroup[] = [];
  private otterGroups: OtterGroup[] = [];
  private meshes: MammalMesh[] = [];
  private mesh: Partial<Record<Sp | 'seal' | 'otter', MammalMesh>> = {};
  private time = 0;
  private boatPrevX = NaN; private boatPrevZ = NaN;
  private bvx = 0; private bvz = 0; private bspd = 0;
  private box = { x0: -1e9, x1: 1e9, z0: -1e9, z1: 1e9 };
  private focus: Ceta | null = null; // debug: the animal doing a forced action (captures frame it)
  // scratch
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private ray = new THREE.Raycaster();
  private hits: THREE.Intersection[] = [];

  constructor(spawns: MammalSpawn[] | undefined, private land: LandCollision, low: boolean, private splash: SplashFX, private chunks: LoadedChunk[] = []) {
    this.group.name = 'mammals';
    if (!spawns?.length) return; // old export: the baked statics still show; nothing new
    const lg = land.gridBox;
    if (lg) this.box = { x0: lg.originX, x1: lg.originX + lg.w * lg.cell, z0: lg.originZ, z1: lg.originZ + lg.h * lg.cell };
    const M = 60; // the exported world reaches a little past the land grid
    const inWorld = (p: number[]) => p[0] > this.box.x0 - M && p[0] < this.box.x1 + M && p[2] > this.box.z0 - M && p[2] < this.box.z1 + M;

    type CPlan = { e: MammalSpawn; sp: Sp; relocated: boolean };
    const cplans: CPlan[] = [];
    const sealPlans: MammalSpawn[] = [];
    const otterPlans: MammalSpawn[] = [];
    for (const e of spawns) {
      const sp = speciesOf(e.species ?? e.name);
      if (!sp) continue;
      if (e.pos[1] < -8) continue; // deep dive-site animals (no diving in the game yet)
      if (sp === 'seal' || sp === 'lion') { if (inWorld(e.pos)) sealPlans.push(e); continue; }
      if (sp === 'otter') { if (inWorld(e.pos)) otterPlans.push(e); continue; }
      if (inWorld(e.pos)) cplans.push({ e, sp, relocated: false });
      else if (sp === 'orca' || sp === 'humpback') cplans.push({ e, sp, relocated: true }); // whales roam: bring them into the world
    }

    // meshes sized to the plan
    const nOf = (p: CPlan) => {
      const n = Math.max(1, p.e.count || p.e.parts?.length || 1);
      return low && (p.sp === 'dolphin' || p.sp === 'porpoise') ? Math.min(3, n) : n;
    };
    const tot: Record<Sp, number> = { orca: 0, humpback: 0, dolphin: 0, porpoise: 0 };
    for (const p of cplans) tot[p.sp] += nOf(p);
    const geo: Record<Sp, () => THREE.BufferGeometry> = { orca: orcaGeometry, humpback: humpbackGeometry, dolphin: dolphinGeometry, porpoise: dallsGeometry };
    for (const sp of Object.keys(tot) as Sp[]) {
      if (!tot[sp]) continue;
      const mm = mammalMesh(geo[sp](), tot[sp], `mammals_${sp}`);
      this.mesh[sp] = mm; this.meshes.push(mm); this.group.add(mm.mesh);
    }
    const used: Record<Sp, number> = { orca: 0, humpback: 0, dolphin: 0, porpoise: 0 };
    for (const p of cplans) this.pods.push(this.makePod(p.e, p.sp, nOf(p), p.relocated, used));

    let nSeal = 0;
    for (const e of sealPlans) nSeal += Math.max(1, e.count || e.parts?.length || 1);
    if (nSeal) {
      const mm = mammalMesh(sealGeometry(), nSeal, 'mammals_seal', true);
      this.mesh.seal = mm; this.meshes.push(mm); this.group.add(mm.mesh);
      let idx = 0;
      for (const e of sealPlans) idx = this.makeSeals(e, idx);
    }
    let nOt = 0;
    for (const e of otterPlans) nOt += Math.max(1, e.count || 1);
    if (nOt) {
      const mm = mammalMesh(otterGeometry(), nOt, 'mammals_otter');
      this.mesh.otter = mm; this.meshes.push(mm); this.group.add(mm.mesh);
      let idx = 0;
      for (const e of otterPlans) idx = this.makeOtters(e, idx);
    }
    if (this.pods.some((p) => p.tune.blowH > 0)) this.group.add(this.blows.mesh);
  }

  get count() {
    return this.pods.reduce((a, p) => a + p.members.length, 0) + this.seals.reduce((a, g) => a + g.seals.length, 0) + this.otterGroups.reduce((a, g) => a + g.otters.length, 0);
  }

  // ---------------------------------------------------------------- setup
  private inBox(x: number, z: number, m: number) { return x > this.box.x0 + m && x < this.box.x1 - m && z > this.box.z0 + m && z < this.box.z1 - m; }

  /** Nearest point to (x,z) inside the land-grid box with `clear` m of open water around it. */
  private openWater(x: number, z: number, clear: number): [number, number] {
    const cx = Math.max(this.box.x0 + clear, Math.min(this.box.x1 - clear, x));
    const cz = Math.max(this.box.z0 + clear, Math.min(this.box.z1 - clear, z));
    for (let r = 0; r < 400; r += 8) {
      const n = Math.max(1, Math.round((r * TAU) / 10));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
        if (this.inBox(px, pz, 5) && this.clear(px, pz, clear)) return [px, pz];
      }
    }
    return [cx, cz];
  }

  private clear(x: number, z: number, r: number) {
    if (this.land.blocked(x, z)) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      if (this.land.blocked(x + Math.cos(a) * r, z + Math.sin(a) * r) || this.land.blocked(x + Math.cos(a) * r * 0.5, z + Math.sin(a) * r * 0.5)) return false;
    }
    return true;
  }

  private pathClear(x0: number, z0: number, x1: number, z1: number, r: number) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 8);
    for (let i = 1; i <= n; i++) if (!this.clear(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, r)) return false;
    return true;
  }

  private makePod(e: MammalSpawn, sp: Sp, n: number, relocated: boolean, used: Record<Sp, number>): Pod {
    const tune = TUNE[sp];
    const clearR = sp === 'orca' || sp === 'humpback' ? 18 : 8;
    const [ax, az] = relocated || !this.clear(e.pos[0], e.pos[2], clearR) ? this.openWater(e.pos[0], e.pos[2], clearR) : [e.pos[0], e.pos[2]];
    const parts = (e.parts ?? []).slice().sort((a, b) => b.length - a.length);
    const d0 = parts[0]?.dir ?? [Math.sin(e.rotY ?? 0), Math.cos(e.rotY ?? 0)];
    const pod: Pod = {
      name: e.name, sp, tune, members: [], cx: ax, cz: az, yaw: Math.atan2(d0[0], d0[1]), spd: tune.speed, ax, az, wx: ax, wz: az,
      breaths: randInt(2, 4), breathT: rand(1, 4), diving: false, specialT: rand(14, 28), queued: -1, acc: 0, hidden: true,
      bow: 0, bowT: 0, bowCool: rand(5, 15), bowSide: 1, relocated,
    };
    const mm = this.mesh[sp]!;
    const calves = sp === 'orca' ? Math.max(e.calf ?? 0, n >= 4 ? 1 : 0) : 0;
    // designer layout: offsets of each part from the group centre, in the group's heading frame
    let pcx = 0, pcz = 0;
    for (const p of parts) { pcx += p.pos[0]; pcz += p.pos[2]; }
    if (parts.length) { pcx /= parts.length; pcz /= parts.length; }
    const fx = Math.sin(pod.yaw), fz = Math.cos(pod.yaw);
    const adults: Ceta[] = [];
    for (let i = 0; i < n; i++) {
      const isCalf = i >= n - calves;
      const part = parts[i];
      let ox: number, oz: number;
      if (part && !isCalf) {
        const dx = part.pos[0] - pcx, dz = part.pos[2] - pcz;
        // spread the designer's tight sculpture out to a travelling formation (members 8-14 m apart)
        const spread = sp === 'orca' ? 1.6 : sp === 'humpback' ? 1 : 1.3;
        ox = (dx * fz - dz * fx) * spread; oz = (dx * fx + dz * fz) * spread;
      } else {
        const a = (i / Math.max(1, n)) * TAU;
        ox = Math.cos(a) * (sp === 'orca' ? 10 : 3); oz = Math.sin(a) * (sp === 'orca' ? 8 : 3);
      }
      let len: number;
      if (sp === 'orca') len = isCalf ? rand(2.6, 3.0) : i === 0 ? 8.2 : rand(6.0, 6.8); // the longest part is the bull
      else if (sp === 'humpback') len = Math.min(13, Math.max(10, part?.length ?? 12));
      else if (sp === 'dolphin') len = rand(2.1, 2.4);
      else len = rand(1.9, 2.15);
      const c: Ceta = {
        mm, idx: used[sp]++, len, finH: sp === 'orca' ? (isCalf ? 0.35 : i === 0 ? 1 : rand(0.4, 0.5)) : 1, calf: isCalf, mother: null, side: Math.random() < 0.5 ? -1 : 1,
        ox, oz, lag: sp === 'orca' ? rand(0, 1.6) : rand(0, 0.6),
        x: ax + ox, z: az + oz, y: -3, yaw: pod.yaw, pitch: 0, roll: 0, arch: 0, amp: 0, phase: Math.random() * TAU, rate: 2,
        act: SWIM, t: 0, dur: 1, final: false, pend: -1, pendFinal: false, blown: false, fx: 0, vy: 0, y0: 0, gap: rand(0.5, 3), lookYaw: 0,
        hidden: true,
      };
      if (isCalf) {
        // calf in echelon position beside a mother (not the bull)
        const moms = adults.filter((a) => a.finH < 0.9);
        c.mother = moms[Math.floor(Math.random() * moms.length)] ?? adults[adults.length - 1] ?? null;
        c.lag = (c.mother?.lag ?? 0) + 0.35;
      } else adults.push(c);
      pod.members.push(c);
    }
    return pod;
  }

  private makeSeals(e: MammalSpawn, idx: number) {
    const lion = speciesOf(e.species) === 'lion';
    const haul = e.kind === 'haulout';
    const n = Math.max(1, e.count || e.parts?.length || 1);
    const parts = (e.parts ?? []).slice().sort((a, b) => b.length - a.length).slice(0, n);
    let cx = 0, cz = 0;
    for (const p of parts) { cx += p.pos[0]; cz += p.pos[2]; }
    if (parts.length) { cx /= parts.length; cz /= parts.length; } else { cx = e.pos[0]; cz = e.pos[2]; }
    const g: SealGroup = { name: e.name, kind: haul ? 'haulout' : 'heads', cx, cz, seals: [], acc: 0, hidden: true };
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      const a = (i / n) * TAU;
      const hx = p?.pos[0] ?? e.pos[0] + Math.cos(a) * 3, hz = p?.pos[2] ?? e.pos[2] + Math.sin(a) * 3;
      const len = lion ? Math.min(3.2, Math.max(2.3, p?.length ?? 2.8)) : Math.min(1.8, Math.max(1.4, (p?.length ?? 1.6) * (haul ? 0.62 : 1)));
      const hyaw = p ? Math.atan2(p.dir[0], p.dir[1]) : Math.random() * TAU;
      const s: Pin = {
        idx: idx++, len, lion, onRock: haul && (p?.pos[1] ?? e.pos[1]) > -0.1, checked: !haul,
        hx, hy: p?.pos[1] ?? e.pos[1], hz, hyaw, ex: hx, ez: hz, wx: hx, wz: hz,
        x: hx, y: 0, z: hz, yaw: hyaw, pitch: 0, roll: 0, head: 0, headT: 0, arch: 0, archT: 0, rollT: 0,
        st: REST, t: 0, dur: 1, idleT: rand(1, 4), act: 0, actT: 0, away: 0, ph: Math.random() * TAU,
      };
      // water spot: out from the group centre through the seal, else sideways
      let ox = hx - cx, oz = hz - cz;
      const ol = Math.hypot(ox, oz);
      if (ol < 0.5) { ox = Math.cos(hyaw); oz = -Math.sin(hyaw); } else { ox /= ol; oz /= ol; }
      for (let k = 0; k < 8; k++) {
        const ang = Math.atan2(oz, ox) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.6;
        const wx = hx + Math.cos(ang) * 8, wz = hz + Math.sin(ang) * 8;
        if (!this.land.blocked(wx, wz)) { s.wx = wx; s.wz = wz; s.ex = hx + Math.cos(ang) * 1.6 * len; s.ez = hz + Math.sin(ang) * 1.6 * len; break; }
      }
      if (!haul) { s.st = WATER; s.dur = rand(6, 14); s.wx = hx; s.wz = hz; }
      if (lion) this.mesh.seal!.mesh.setColorAt(s.idx, new THREE.Color(1.55, 1.12, 0.72));
      g.seals.push(s);
    }
    this.seals.push(g);
    return idx;
  }

  private makeOtters(e: MammalSpawn, idx: number) {
    const n = Math.max(1, e.count || 1);
    const [hx, hz] = this.clear(e.pos[0], e.pos[2], 2) ? [e.pos[0], e.pos[2]] : this.openWater(e.pos[0], e.pos[2], 3);
    const g: OtterGroup = { name: e.name, hx, hz, otters: [], acc: 0, hidden: true };
    for (let i = 0; i < n; i++) {
      g.otters.push({
        idx: idx++, len: i === 0 ? 1.15 : rand(0.95, 1.1), x: hx + rand(-2, 2), z: hz + rand(-2, 2), yaw: Math.random() * TAU, y: 0, pitch: 0, roll: 0, head: 0.35,
        tx: hx, tz: hz, st: O_SWIM, t: 0, dur: rand(3, 6), ph: Math.random() * TAU, rollT: 0,
      });
    }
    this.otterGroups.push(g);
    return idx;
  }

  // ---------------------------------------------------------------- update
  update(dt: number, cam: THREE.Vector3, boat: THREE.Vector3) {
    if (!this.meshes.length) return;
    this.time += dt;
    // boat planar velocity from position deltas (teleports clamp out)
    if (dt > 0 && !Number.isNaN(this.boatPrevX)) {
      const vx = (boat.x - this.boatPrevX) / dt, vz = (boat.z - this.boatPrevZ) / dt;
      if (Math.hypot(vx, vz) < 20) { const k = Math.min(1, dt * 4); this.bvx += (vx - this.bvx) * k; this.bvz += (vz - this.bvz) * k; }
    }
    this.boatPrevX = boat.x; this.boatPrevZ = boat.z;
    this.bspd = Math.hypot(this.bvx, this.bvz);

    for (const pod of this.pods) {
      const d = Math.hypot(pod.cx - cam.x, pod.cz - cam.z);
      if (d > HIDE_WHALE) {
        if (!pod.hidden) { for (const c of pod.members) this.hide(c); pod.hidden = true; }
        // keep travelling cheaply so the pod is somewhere else when you come back
        this.navigate(pod, dt, boat);
        continue;
      }
      let gdt = dt;
      if (d > FULL_RATE_DIST) {
        pod.acc += dt;
        if (pod.acc < LOW_RATE_STEP && !pod.hidden) continue;
        gdt = Math.min(pod.acc, 0.5);
        pod.acc = 0;
      }
      pod.hidden = false;
      this.navigate(pod, gdt, boat);
      this.schedule(pod, gdt, boat);
      for (const c of pod.members) this.stepCeta(pod, c, gdt, boat);
    }
    for (const g of this.seals) {
      const d = Math.hypot(g.cx - cam.x, g.cz - cam.z);
      if (d > HIDE_SMALL) {
        if (!g.hidden) { for (const s of g.seals) this.mesh.seal!.mesh.setMatrixAt(s.idx, this.zero); g.hidden = true; }
        continue;
      }
      let gdt = dt;
      if (d > FULL_RATE_DIST * 0.6) {
        g.acc += dt;
        if (g.acc < LOW_RATE_STEP && !g.hidden) continue;
        gdt = Math.min(g.acc, 0.5); g.acc = 0;
      }
      g.hidden = false;
      for (const s of g.seals) this.stepSeal(s, gdt, boat);
    }
    for (const g of this.otterGroups) {
      const d = Math.hypot(g.hx - cam.x, g.hz - cam.z);
      if (d > HIDE_SMALL) {
        if (!g.hidden) { for (const o of g.otters) this.mesh.otter!.mesh.setMatrixAt(o.idx, this.zero); g.hidden = true; }
        continue;
      }
      let gdt = dt;
      if (d > FULL_RATE_DIST * 0.6) {
        g.acc += dt;
        if (g.acc < LOW_RATE_STEP && !g.hidden) continue;
        gdt = Math.min(g.acc, 0.5); g.acc = 0;
      }
      g.hidden = false;
      for (let i = 0; i < g.otters.length; i++) this.stepOtter(g, g.otters[i], i, gdt, boat);
    }
    for (const mm of this.meshes) { mm.mesh.instanceMatrix.needsUpdate = true; mm.anim.needsUpdate = true; }
    this.blows.update(dt);
  }

  // ---------------------------------------------------------------- pods: travel
  private pickWaypoint(pod: Pod) {
    const clearR = pod.sp === 'orca' || pod.sp === 'humpback' ? 16 : 6;
    for (let k = 0; k < 14; k++) {
      // prefer ahead-ish, a long leg for whales
      const a = pod.yaw + rand(-1.4, 1.4) + (k > 8 ? Math.PI : 0);
      const dist = pod.sp === 'orca' ? rand(70, 160) : pod.sp === 'humpback' ? rand(50, 110) : rand(25, 60);
      const x = pod.cx + Math.sin(a) * dist, z = pod.cz + Math.cos(a) * dist;
      if (Math.hypot(x - pod.ax, z - pod.az) > pod.tune.wander) continue;
      if (!this.inBox(x, z, 10)) continue;
      if (!this.pathClear(pod.cx, pod.cz, x, z, clearR)) continue;
      pod.wx = x; pod.wz = z;
      return;
    }
    pod.wx = pod.ax; pod.wz = pod.az; // head home
  }

  private navigate(pod: Pod, dt: number, boat: THREE.Vector3) {
    const t = pod.tune;
    let want: number;
    let spd = t.speed;
    const bdx = pod.cx - boat.x, bdz = pod.cz - boat.z, bd = Math.hypot(bdx, bdz);
    pod.bowCool -= dt;
    if (pod.sp === 'dolphin' || pod.sp === 'porpoise') {
      // bow-riding: a boat under way nearby draws the pod in for a while
      if (pod.bow === 0 && pod.bowCool <= 0 && this.bspd > 2.4 && bd < 55) { pod.bow = 1; pod.bowT = rand(18, 30); pod.bowSide = Math.random() < 0.5 ? -1 : 1; }
      if (pod.bow === 1) {
        pod.bowT -= dt;
        if (pod.bowT <= 0 || this.bspd < 1.0 || bd > 120) { pod.bow = 0; pod.bowCool = rand(25, 45); pod.wx = pod.ax; pod.wz = pod.az; }
      }
    }
    if (pod.bow === 1) {
      const fx = this.bvx / Math.max(0.1, this.bspd), fz = this.bvz / Math.max(0.1, this.bspd);
      const tx = boat.x + fx * 6.5 + fz * pod.bowSide * 1.2, tz = boat.z + fz * 6.5 - fx * pod.bowSide * 1.2;
      const dd = Math.hypot(tx - pod.cx, tz - pod.cz);
      want = Math.atan2(tx - pod.cx, tz - pod.cz);
      spd = Math.min(9, this.bspd + dd * 0.6);
      if (dd < 2) want = Math.atan2(fx, fz);
    } else {
      if (Math.hypot(pod.wx - pod.cx, pod.wz - pod.cz) < 15) this.pickWaypoint(pod);
      want = Math.atan2(pod.wx - pod.cx, pod.wz - pod.cz);
      // whales give the boat room: veer away (no fleeing), a little faster
      if (t.keep > 0 && bd < t.keep + 30) {
        const away = Math.atan2(bdx, bdz);
        const k = clamp01((t.keep + 30 - bd) / 40);
        want = want + wrap(away - want) * k;
        spd *= 1 + 0.35 * k;
        if (bd < t.keep && Math.hypot(pod.wx - pod.cx, pod.wz - pod.cz) > 15 && Math.cos(wrap(Math.atan2(pod.wx - boat.x, pod.wz - boat.z) - away)) < 0) this.pickWaypoint(pod);
      }
    }
    // look-ahead land avoidance
    const look = pod.sp === 'orca' || pod.sp === 'humpback' ? 30 : 10;
    if (!this.clear(pod.cx + Math.sin(pod.yaw) * look, pod.cz + Math.cos(pod.yaw) * look, look * 0.3)) {
      const l = this.clear(pod.cx + Math.sin(pod.yaw - 0.7) * look, pod.cz + Math.cos(pod.yaw - 0.7) * look, look * 0.3);
      want = pod.yaw + (l ? -1.2 : 1.2);
      spd *= 0.6;
      if (pod.bow === 0 && Math.random() < dt) this.pickWaypoint(pod);
    }
    const turn = t.turn * (pod.bow === 1 ? 4 : 1);
    pod.yaw += Math.max(-turn * dt, Math.min(turn * dt, wrap(want - pod.yaw)));
    pod.spd += (spd - pod.spd) * Math.min(1, dt * 0.8);
    const nx = pod.cx + Math.sin(pod.yaw) * pod.spd * dt, nz = pod.cz + Math.cos(pod.yaw) * pod.spd * dt;
    if (!this.land.blocked(nx, nz) || pod.bow === 1) { pod.cx = nx; pod.cz = nz; } else { pod.yaw += 0.8 * dt; }
  }

  // ---------------------------------------------------------------- pods: breathing + specials
  private schedule(pod: Pod, dt: number, boat: THREE.Vector3) {
    if (pod.sp === 'orca' || pod.sp === 'humpback') {
      pod.breathT -= dt;
      if (pod.breathT <= 0) {
        if (pod.diving) { pod.diving = false; pod.breaths = pod.sp === 'orca' ? randInt(3, 5) : randInt(2, 4); }
        const final = pod.breaths <= 1;
        for (const c of pod.members) { if (c.act === SWIM && c.pend < 0) { c.pend = c.lag; c.pendFinal = final; } }
        pod.breaths--;
        if (final) { pod.diving = true; pod.breathT = pod.sp === 'orca' ? rand(18, 30) : rand(24, 36); } else pod.breathT = pod.sp === 'orca' ? rand(5.5, 8) : rand(7, 10);
        // calves breathe more often: an extra half-cycle pop-up
        for (const c of pod.members) if (c.calf && !final && Math.random() < 0.5) c.gap = pod.breathT * 0.5;
      }
      for (const c of pod.members) {
        if (c.calf && c.gap > 0 && c.act === SWIM && c.pend < 0) { c.gap -= dt; if (c.gap <= 0) { c.pend = 0; c.pendFinal = false; } }
      }
      if (pod.sp === 'orca') {
        const bd = Math.hypot(pod.cx - boat.x, pod.cz - boat.z);
        const curious = bd > 50 && bd < 160 && this.bspd < 1.5; // a quiet boat nearby: more spyhops
        pod.specialT -= dt * (curious ? 1.8 : 1);
        if (pod.specialT <= 0) {
          pod.specialT = rand(22, 45);
          const r = Math.random();
          pod.queued = curious && r < 0.5 ? SPYHOP : r < 0.4 ? BREACH : r < 0.7 ? SPYHOP : TAILLOB;
        }
        if (pod.queued >= 0) {
          const c = this.performer(pod, pod.queued === BREACH);
          if (c) { this.startAct(pod, c, pod.queued, boat); pod.queued = -1; }
        }
      }
    } else {
      // dolphins / porpoises: each animal on its own short surfacing rhythm
      for (const c of pod.members) {
        if (c.act !== SWIM) continue;
        c.gap -= dt;
        if (c.gap <= 0) this.startAct(pod, c, pod.sp === 'dolphin' ? (Math.random() < 0.75 || pod.bow ? LEAP : ROLL) : ROLL, boat);
      }
    }
  }

  /** A member free to perform: nearest the pod centre (on camera in captures); calves may breach. */
  private performer(pod: Pod, calfOk: boolean) {
    let best: Ceta | null = null, bd = Infinity;
    for (const c of pod.members) {
      if (c.act !== SWIM || c.pend >= 0 || (c.calf && !calfOk)) continue;
      if (this.land.blocked(c.x, c.z)) continue;
      const d = Math.hypot(c.x - pod.cx, c.z - pod.cz);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  private startAct(pod: Pod, c: Ceta, act: number, boat: THREE.Vector3) {
    c.act = act; c.t = 0; c.blown = false; c.fx = 0;
    const k = Math.sqrt(c.len / (pod.sp === 'humpback' ? 12 : pod.sp === 'orca' ? 7 : 2.2));
    switch (act) {
      case ROLL: c.dur = pod.tune.roll * k * (c.final ? 1.3 : 1) * (c.calf ? 0.8 : 1); break;
      case SPYHOP: c.dur = rand(6, 7.5); c.lookYaw = Math.atan2(boat.x - c.x, boat.z - c.z); break;
      case TAILLOB: c.dur = 1.2 + randInt(2, 3) * 1.15 + 1.2; break;
      case BREACH: {
        const H = (c.calf ? 0.42 : 0.28) * c.len, y0 = -0.42 * c.len, g = 8;
        c.y0 = y0; c.vy = Math.sqrt(2 * g * (H - y0));
        c.dur = 0.5 + (c.vy + Math.sqrt(Math.max(0, c.vy * c.vy - 2 * g * (-0.12 * c.len - y0)))) / g + 1.6;
        break;
      }
      case LEAP: c.dur = rand(0.95, 1.15); break;
      case FLUKE: c.dur = 6.5; c.vy = 0; break;
    }
  }

  // ---------------------------------------------------------------- pods: one animal
  private stepCeta(pod: Pod, c: Ceta, dt: number, boat: THREE.Vector3) {
    // formation target
    const fx = Math.sin(pod.yaw), fz = Math.cos(pod.yaw);
    let tx: number, tz: number;
    if (c.mother) {
      const m = c.mother, mfx = Math.sin(m.yaw), mfz = Math.cos(m.yaw);
      tx = m.x + mfz * c.side * 0.3 * m.len - mfx * 0.12 * m.len;
      tz = m.z - mfx * c.side * 0.3 * m.len - mfz * 0.12 * m.len;
    } else {
      const bowTight = pod.bow === 1 ? 0.18 : 1;
      const wob = Math.sin(this.time * 0.13 + c.lag * 3) * 2;
      tx = pod.cx + fz * (c.ox * bowTight + wob) + fx * c.oz * bowTight;
      tz = pod.cz - fx * (c.ox * bowTight + wob) + fz * c.oz * bowTight;
    }
    const busy = c.act === SPYHOP || c.act === TAILLOB;
    if (!busy) {
      // swim along with the pod: forward at pod speed + correction toward the formation slot
      const k = Math.min(1, dt * 0.9);
      const adv = (c.act === BREACH ? 0.8 : 1) * pod.spd * dt;
      c.x += fx * adv + (tx - c.x - fx * adv) * k;
      c.z += fz * adv + (tz - c.z - fz * adv) * k;
      const wantYaw = pod.yaw + Math.sin(this.time * 0.21 + c.lag * 5) * 0.07;
      c.yaw += wrap(wantYaw - c.yaw) * Math.min(1, dt * 1.5);
    }
    if (c.pend >= 0) {
      c.pend -= dt;
      if (c.pend < 0 && c.act === SWIM) { c.final = c.pendFinal; this.startAct(pod, c, pod.sp === 'humpback' && c.final ? FLUKE : ROLL, boat); }
      else if (c.pend < 0) c.pend = -1;
    }
    c.t += dt;
    const L = c.len, ks = L / 7;
    const deep = -(0.36 * L + 0.4); // even a bull's fin tip stays under
    let y = deep, pitch = 0, roll = 0, arch = 0, amp = 0.012, rate = 2.2;
    const u = clamp01(c.t / c.dur);
    switch (c.act) {
      case SWIM: break;
      case ROLL: {
        if (pod.sp === 'porpoise') {
          // Dall's: fast, low, a V of spray thrown off the head ("rooster tail")
          const peak = -0.03 * L;
          y = deep + (peak - deep) * Math.sin(Math.PI * u);
          pitch = lerp(-0.45, 0.55, u); rate = 9; amp = 0.03;
          if (u > 0.15 && u < 0.6 && (c.fx += dt) > 0.04) {
            c.fx = 0;
            const hx = c.x + Math.sin(c.yaw) * 0.35 * L, hz = c.z + Math.cos(c.yaw) * 0.35 * L;
            this.splash.spray(hx, hz, -Math.sin(c.yaw) * 1.6 + Math.cos(c.yaw) * 1.4, -Math.cos(c.yaw) * 1.6 - Math.sin(c.yaw) * 1.4, 1);
            this.splash.spray(hx, hz, -Math.sin(c.yaw) * 1.6 - Math.cos(c.yaw) * 1.4, -Math.cos(c.yaw) * 1.6 + Math.sin(c.yaw) * 1.4, 1);
          }
          if (u > 0.85 && !c.blown) { c.blown = true; this.splash.ring(c.x, c.z, 0.5); }
          break;
        }
        const peak = (c.final ? -0.035 : -0.055) * L;
        y = deep + (peak - deep) * Math.pow(Math.sin(Math.PI * u), 0.7);
        pitch = c.final ? lerp(-0.3, 0.8, u) : lerp(-0.26, 0.45, u);
        arch = (c.final ? 0.1 : 0.04) * Math.sin(Math.PI * Math.min(1, u * 1.1));
        amp = 0.006; rate = 1.4;
        this.blowCheck(pod, c, y, pitch);
        if (u > 0.5 && c.fx === 0) { c.fx = 1; this.splash.foam(c.x, c.z, 3, 0.3 * L * 0.5, 0.35 * ks + 0.1, 1.4); }
        if (u > 0.9 && c.fx === 1) { c.fx = 2; this.splash.ring(c.x - Math.sin(c.yaw) * 0.3 * L, c.z - Math.cos(c.yaw) * 0.3 * L, 0.9 * ks + 0.3); }
        break;
      }
      case FLUKE: {
        // humpback terminal dive: rolling arch, then the flukes lift clear and slide straight down
        if (u < 0.4) {
          const v = u / 0.4;
          y = deep + (-0.04 * L - deep) * Math.pow(Math.sin(Math.PI * 0.5 * v), 0.7);
          pitch = lerp(-0.25, 0.55, v); arch = 0.12 * v;
          this.blowCheck(pod, c, y, pitch);
        } else {
          const v = (u - 0.4) / 0.6;
          const up = smooth(v * 1.8), down = smooth((v - 0.45) / 0.55);
          pitch = lerp(0.55, 1.42, up);
          y = lerp(-0.04 * L, -0.22 * L, up) + lerp(0, -0.55 * L, down);
          arch = lerp(0.12, -0.02, up);
          if (v > 0.3 && v < 0.85 && (c.fx += dt) > 0.07) {
            c.fx = 0;
            // water streaming off the trailing edge
            const d = 0.47 * L, ty = y + d * Math.sin(pitch);
            if (ty > 0.3) this.splash.throwAt(c.x - Math.sin(c.yaw) * d * Math.cos(pitch), ty, c.z - Math.cos(c.yaw) * d * Math.cos(pitch), 0, -0.5, 0, 2, 0.8, 0.9);
          }
          if (v > 0.95 && c.vy === 0) { c.vy = 1; this.splash.ring(c.x, c.z, 1.6); }
        }
        amp = 0.004; rate = 1;
        break;
      }
      case SPYHOP: {
        const rise = 1.3, sinkT = 1.7, hold = c.dur - rise - sinkT;
        const top = -0.2 * L, low = -0.62 * L;
        pitch = -1.42 + Math.sin(this.time * 0.9) * 0.04;
        if (c.t < rise) y = lerp(low, top, smooth(c.t / rise));
        else if (c.t < rise + hold) y = top + Math.sin((c.t - rise) * 1.6) * 0.03 * L;
        else y = lerp(top, low, smooth((c.t - rise - hold) / sinkT));
        // turn slowly to look at the boat
        c.lookYaw = Math.atan2(boat.x - c.x, boat.z - c.z);
        c.yaw += wrap(c.lookYaw - c.yaw) * Math.min(1, dt * 0.6);
        if (c.fx === 0 && c.t > rise * 0.35) { c.fx = 1; this.splash.ring(c.x, c.z, 0.8 * ks + 0.3); this.splash.foam(c.x, c.z, 4, 0.5 * ks, 0.3 * ks, 1.8); }
        if (c.fx === 1 && c.t > rise + hold + sinkT * 0.5) { c.fx = 2; this.splash.ring(c.x, c.z, 0.9 * ks + 0.3); }
        amp = 0; arch = -0.02;
        break;
      }
      case TAILLOB: {
        const nSlap = Math.round((c.dur - 2.4) / 1.15);
        const tIn = 1.2, tOut = 1.2;
        let r = 0;
        if (c.t < tIn) { const v = smooth(c.t / tIn); pitch = lerp(0.9, 1.15, v); y = lerp(-0.6 * L, -0.3 * L, v); }
        else if (c.t < tIn + nSlap * 1.15) {
          const ts = (c.t - tIn) % 1.15, slap = Math.floor((c.t - tIn) / 1.15);
          r = ts < 0.85 ? smooth(ts / 0.85) : 1 - Math.pow((ts - 0.85) / 0.3, 2);
          pitch = 0.82 + 0.5 * r; y = -0.3 * L + 0.08 * L * r;
          if (ts >= 0.85 && c.fx <= slap) c.fx = slap + 0.5;
          if (ts > 1.1 && c.fx === slap + 0.5) {
            c.fx = slap + 1;
            const d = 0.46 * L, tx2 = c.x - Math.sin(c.yaw) * d * 0.55, tz2 = c.z - Math.cos(c.yaw) * d * 0.55;
            this.splash.burst(tx2, tz2, 1.3 * ks + 0.3, 16);
            this.splash.splash(tx2, tz2, 1.2 * ks);
            this.onSound?.('slap', tx2, tz2);
          }
        } else { const v = smooth((c.t - tIn - nSlap * 1.15) / tOut); pitch = lerp(0.9, 1.1, v); y = lerp(-0.3 * L, -0.75 * L, v); }
        arch = -0.03 * r; amp = 0;
        break;
      }
      case BREACH: {
        const g = 8, tPre = 0.5;
        if (c.t < tPre) { y = lerp(deep, c.y0, c.t / tPre); pitch = -1.2 * smooth(c.t / tPre); rate = 5; amp = 0.03; break; }
        const tau = c.t - tPre;
        const yy = c.y0 + c.vy * tau - 0.5 * g * tau * tau;
        const tLand = (c.vy + Math.sqrt(Math.max(0, c.vy * c.vy - 2 * g * (-0.12 * L - c.y0)))) / g;
        if (tau < tLand) {
          const v = tau / tLand;
          y = yy; pitch = lerp(-1.25, 0.35, v); roll = c.side * 1.5 * smooth(v * 1.3);
          if (c.fx === 0 && y > -0.2 * L) { c.fx = 1; this.splash.splash(c.x + Math.sin(c.yaw) * 0.2 * L, c.z + Math.cos(c.yaw) * 0.2 * L, 1.1 * ks + 0.4); }
          amp = 0.02; rate = 3;
        } else {
          const v = clamp01((tau - tLand) / 1.4);
          if (c.fx === 1) {
            c.fx = 2;
            const sx = c.x + Math.cos(c.yaw) * c.side * 0.12 * L, sz = c.z - Math.sin(c.yaw) * c.side * 0.12 * L;
            this.splash.burst(sx, sz, 2.2 * ks + 0.4, 30);
            this.splash.splash(sx, sz, 2 * ks + 0.3);
            this.splash.splash(c.x - Math.sin(c.yaw) * 0.3 * L, c.z - Math.cos(c.yaw) * 0.3 * L, 1.3 * ks);
            this.splash.foam(c.x, c.z, 10, 0.45 * L, 0.5 * ks + 0.15, 2.4);
            this.onSound?.('breach', sx, sz);
          }
          y = lerp(-0.12 * L, deep, smooth(v)); pitch = lerp(0.35, 0.2, v); roll = c.side * 1.5 * (1 - smooth(v));
        }
        break;
      }
      case LEAP: {
        // dolphin: clean arc clear of the water, nose following the arc
        const peak = 0.75 + 0.15 * L, y0 = -0.32 * L;
        y = y0 + (peak - y0) * 4 * u * (1 - u);
        pitch = lerp(-0.75, 0.75, u); rate = 10; amp = 0.04;
        if (c.fx === 0 && u > 0.12) { c.fx = 1; this.splash.splash(c.x, c.z, 0.35); }
        if (c.fx === 1 && u > 0.88) { c.fx = 2; this.splash.splash(c.x + Math.sin(c.yaw) * 0.6, c.z + Math.cos(c.yaw) * 0.6, 0.5); }
        break;
      }
    }
    if (c.act !== SWIM && c.t >= c.dur) {
      c.act = SWIM; c.t = 0;
      c.gap = pod.sp === 'dolphin' ? (pod.bow ? rand(0.4, 1.4) : rand(0.8, 3)) : pod.sp === 'porpoise' ? rand(0.6, 2.5) : c.gap;
    }
    // ease the pose (keeps transitions soft)
    const kk = Math.min(1, dt * 8);
    c.y = c.act === SWIM ? lerp(c.y, deep, Math.min(1, dt * 2)) : y;
    c.pitch += (pitch - c.pitch) * (c.act === BREACH || c.act === LEAP ? 1 : kk);
    c.roll += (roll - c.roll) * (c.act === BREACH ? 1 : kk);
    c.arch += (arch - c.arch) * kk;
    c.amp += (amp - c.amp) * kk;
    c.rate = rate;
    c.phase = (c.phase + c.rate * dt) % TAU;
    // out of sight under the opaque sea, or over land: skip drawing
    const reach = (c.act === SPYHOP || c.act === TAILLOB || c.act === BREACH || c.act === FLUKE ? 0.6 : 0.36) * L;
    if (c.y + reach < -0.1 || this.land.blocked(c.x, c.z)) { this.hide(c); return; }
    c.hidden = false;
    this.e.set(c.pitch, c.yaw, c.roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(c.x, c.y, c.z);
    this.s.setScalar(L);
    this.m.compose(this.v, this.q, this.s);
    c.mm.mesh.setMatrixAt(c.idx, this.m);
    c.mm.anim.setXYZW(c.idx, c.phase, c.amp, c.arch, c.finH);
  }

  /** Blow + ring the moment the blowhole clears the surface. */
  private blowCheck(pod: Pod, c: Ceta, y: number, pitch: number) {
    if (c.blown || pod.tune.blowH <= 0) return;
    const d = 0.4 * c.len;
    const hy = y + 0.1 * c.len - d * Math.sin(pitch);
    if (hy < 0) return;
    c.blown = true;
    const hx = c.x + Math.sin(c.yaw) * d * Math.cos(pitch), hz = c.z + Math.cos(c.yaw) * d * Math.cos(pitch);
    this.blows.blow(hx, 0.15, hz, pod.tune.blowH * (c.calf ? 0.55 : Math.sqrt(c.len / (pod.sp === 'orca' ? 7 : 12))));
    this.splash.ring(hx, hz, 0.35 * c.len / 3);
    this.onSound?.('blow', hx, hz);
  }

  private hide(c: Ceta) {
    if (c.hidden) return;
    c.mm.mesh.setMatrixAt(c.idx, this.zero);
    c.hidden = true;
  }

  // ---------------------------------------------------------------- seals
  /** Is there ground (a rock) under a hauled-out seal? Ray down into the chunk under it (once). */
  private hasRock(s: Pin) {
    s.checked = true;
    if (!this.chunks.length) return true;
    this.v.set(s.hx, s.hy + 3, s.hz);
    this.ray.set(this.v, this.s.set(0, -1, 0));
    this.ray.far = 4;
    for (const c of this.chunks) {
      const b = c.bounds;
      if (s.hx < b.min.x || s.hx > b.max.x || s.hz < b.min.z || s.hz > b.max.z) continue;
      this.hits.length = 0;
      this.ray.intersectObject(c.object, true, this.hits);
      for (const h of this.hits) if (Math.abs(h.point.y - s.hy) < 0.7) { s.hy = Math.max(s.hy, h.point.y); return true; }
    }
    return false;
  }

  private stepSeal(s: Pin, dt: number, boat: THREE.Vector3) {
    if (!s.checked) {
      s.onRock = this.hasRock(s);
      if (!s.onRock) { s.st = WATER; s.wx = s.hx; s.wz = s.hz; s.dur = rand(6, 14); s.t = 0; }
    }
    s.t += dt;
    const bd = Math.hypot(s.x - boat.x, s.z - boat.z);
    const restY = s.hy + 0.105 * s.len;
    let x = s.x, y = s.y, z = s.z, pitch = 0, roll = 0;
    let yawT = s.hyaw;
    s.headT = s.lion ? 0.5 : 0.05;
    s.archT = s.lion ? -0.03 : 0;
    switch (s.st) {
      case REST: case ALERT: {
        x = s.hx; z = s.hz; y = restY;
        if (s.st === REST && bd < (s.lion ? 26 : 20)) { s.st = ALERT; s.t = 0; }
        if (s.st === ALERT) {
          s.headT = 0.85; s.archT = -0.035;
          const look = wrap(Math.atan2(boat.x - s.x, boat.z - s.z) - s.hyaw);
          yawT = s.hyaw + Math.max(-0.5, Math.min(0.5, look));
          if (bd > 28 && s.t > 2) { s.st = REST; s.t = 0; }
          if (bd < (s.lion ? 11 : 9) && s.t > 0.5 + (s.idx % 3) * 0.35) { s.st = FLOP; s.t = 0; s.dur = s.lion ? 1.9 : 1.5; }
        } else {
          // idle repertoire: look up, banana pose, roll to scratch, sea-lion bark (head toss)
          s.idleT -= dt;
          if (s.idleT <= 0 && s.actT <= 0) {
            const r = Math.random();
            s.act = r < 0.35 ? 1 : r < 0.6 ? 2 : r < 0.8 ? 3 : r < 0.9 && s.lion ? 4 : 0;
            s.actT = s.act === 2 ? rand(4, 7) : s.act === 3 ? 2.2 : s.act === 4 ? 1.2 : rand(1.5, 3);
            s.idleT = rand(2.5, 7);
          }
          if (s.actT > 0) {
            s.actT -= dt;
            if (s.act === 1) { s.headT = s.lion ? 0.8 : 0.55; yawT = s.hyaw + Math.sin(s.ph) * 0.25; }
            else if (s.act === 2) { s.headT = 0.5; s.archT = -0.07; }
            else if (s.act === 3) roll = Math.sin(clamp01(1 - s.actT / 2.2) * Math.PI) * 0.6;
            else if (s.act === 4) s.headT = 0.7 + Math.sin(s.actT * 18) * 0.25;
            if (s.actT <= 0) s.ph = Math.random() * TAU;
          }
          // seals go in on their own now and then
          if (Math.random() < dt / 240) { s.st = FLOP; s.t = 0; s.dur = 1.6; }
        }
        break;
      }
      case FLOP: {
        const u = clamp01(s.t / s.dur);
        const a = Math.atan2(s.wx - s.hx, s.wz - s.hz);
        yawT = a;
        x = lerp(s.hx, s.ex, smooth(u)); z = lerp(s.hz, s.ez, smooth(u));
        y = lerp(restY, -0.12 * s.len, u * u);
        pitch = 0.45 * smooth(u * 2);
        s.archT = Math.sin(s.t * 10) * 0.05; s.headT = 0.3;
        if (u >= 1) {
          this.splash.splash(x, z, s.lion ? 1 : 0.7);
          this.splash.foam(x, z, 5, 0.6, 0.3, 1.4);
          this.onSound?.('seal', x, z);
          s.st = WATER; s.t = 0; s.dur = rand(10, 18); s.away = 0;
          s.x = x; s.z = z;
        }
        break;
      }
      case WATER: {
        // bottling: upright, head out, turning to watch the boat
        const tx = s.wx + Math.sin(this.time * 0.1 + s.ph) * 1.5, tz = s.wz + Math.cos(this.time * 0.08 + s.ph) * 1.5;
        x = s.x + (tx - s.x) * Math.min(1, dt * 0.6); z = s.z + (tz - s.z) * Math.min(1, dt * 0.6);
        const rise = smooth(s.t / 1.2);
        pitch = -1.15;
        y = lerp(-0.5 * s.len, 0.24 - 0.47 * s.len, rise) + Math.sin(this.time * 1.5 + s.ph) * 0.03;
        s.headT = 0.25;
        yawT = bd < 45 ? Math.atan2(boat.x - x, boat.z - z) : s.yaw + Math.sin(this.time * 0.3 + s.ph) * 0.3;
        if (s.t < dt * 1.5) this.splash.ring(x, z, 0.35);
        if (s.onRock) {
          s.away = bd > 30 ? s.away + dt : 0;
          if (s.away > 9) { s.st = RETURN; s.t = 0; s.dur = s.lion ? 3 : 2.6; break; }
        }
        if (s.t > s.dur || (bd < 5 && s.t > 1.5)) { s.st = SUNK; s.t = 0; s.dur = rand(4, 9); }
        break;
      }
      case SUNK: {
        // harbour seals sink straight down, silently
        const u = clamp01(s.t / 1.4);
        pitch = -1.15; y = lerp(0.24 - 0.47 * s.len, -0.7 * s.len, smooth(u)); yawT = s.yaw;
        if (s.t > s.dur) {
          for (let k = 0; k < 6; k++) {
            const a = Math.random() * TAU, r = rand(1, 5);
            const nx = (s.onRock ? s.wx : s.hx) + Math.cos(a) * r, nz = (s.onRock ? s.wz : s.hz) + Math.sin(a) * r;
            if (!this.land.blocked(nx, nz) && Math.hypot(nx - boat.x, nz - boat.z) > 6) { s.x = nx; s.z = nz; break; }
          }
          x = s.x; z = s.z;
          s.st = WATER; s.t = 0; s.dur = rand(8, 16);
          if (!s.onRock) { s.wx = s.x; s.wz = s.z; }
        }
        break;
      }
      case RETURN: {
        // swim in and galumph back up onto the rock
        const u = clamp01(s.t / s.dur);
        x = lerp(s.x, s.hx, smooth(u)); z = lerp(s.z, s.hz, smooth(u));
        y = lerp(-0.1 * s.len, restY, smooth((u - 0.3) / 0.7));
        yawT = Math.atan2(s.hx - s.x, s.hz - s.z);
        pitch = -0.3 * (1 - u);
        s.archT = Math.sin(s.t * 9) * 0.06; s.headT = 0.4;
        if (u >= 1) { s.st = REST; s.t = 0; s.x = s.hx; s.z = s.hz; s.idleT = rand(2, 5); }
        else { this.writeSeal(s, x, y, z, pitch, roll, yawT, dt); return; }
        break;
      }
    }
    if (s.st !== RETURN) { s.x = x; s.z = z; }
    this.writeSeal(s, x, y, z, pitch, roll, yawT, dt);
  }

  private writeSeal(s: Pin, x: number, y: number, z: number, pitch: number, roll: number, yawT: number, dt: number) {
    const k = Math.min(1, dt * 4);
    s.y = y;
    s.yaw += wrap(yawT - s.yaw) * Math.min(1, dt * 1.8);
    s.pitch += (pitch - s.pitch) * k;
    s.rollT += (roll - s.rollT) * k; s.roll = s.rollT;
    s.head += (s.headT - s.head) * Math.min(1, dt * 5);
    s.arch += (s.archT - s.arch) * Math.min(1, dt * 6);
    const mm = this.mesh.seal!;
    if (s.st === SUNK && s.t > 1.4) { mm.mesh.setMatrixAt(s.idx, this.zero); return; }
    this.e.set(s.pitch, s.yaw, s.roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.setScalar(s.len);
    this.m.compose(this.v, this.q, this.s);
    mm.mesh.setMatrixAt(s.idx, this.m);
    mm.anim.setXYZW(s.idx, this.time * 2 + s.ph, s.st === WATER ? 0.01 : 0.004, s.arch, s.head);
  }

  // ---------------------------------------------------------------- otters
  private stepOtter(g: OtterGroup, o: Otter, i: number, dt: number, boat: THREE.Vector3) {
    o.t += dt;
    const bd = Math.hypot(o.x - boat.x, o.z - boat.z);
    let y = -0.02, pitch = -0.06, head = 0.35, amp = 0.03, rate = 7;
    switch (o.st) {
      case O_SWIM: {
        // follow the leader (i>0) or wander near home; head up, back awash, tail sculling
        if (i === 0) {
          if (Math.hypot(o.tx - o.x, o.tz - o.z) < 1.5) {
            for (let k = 0; k < 6; k++) {
              const a = Math.random() * TAU, r = rand(2, 11);
              const x = g.hx + Math.cos(a) * r, z = g.hz + Math.sin(a) * r;
              if (!this.land.blocked(x, z)) { o.tx = x; o.tz = z; break; }
            }
          }
        } else {
          const l = g.otters[0], side = i % 2 ? 1 : -1;
          o.tx = l.x - Math.sin(l.yaw) * 1.2 * i + Math.cos(l.yaw) * side * 0.7;
          o.tz = l.z - Math.cos(l.yaw) * 1.2 * i - Math.sin(l.yaw) * side * 0.7;
        }
        const d = Math.hypot(o.tx - o.x, o.tz - o.z);
        if (d > 0.3) {
          const want = Math.atan2(o.tx - o.x, o.tz - o.z);
          o.yaw += wrap(want - o.yaw) * Math.min(1, dt * 2.5);
          const sp = Math.min(0.9, d * 0.8);
          const nx = o.x + Math.sin(o.yaw) * sp * dt, nz = o.z + Math.cos(o.yaw) * sp * dt;
          if (!this.land.blocked(nx, nz)) { o.x = nx; o.z = nz; }
        } else amp = 0.01;
        if (o.t > o.dur) {
          o.t = 0;
          const r = Math.random();
          if (r < 0.3) { o.st = O_SCOPE; o.dur = rand(1.6, 3); }
          else if (r < 0.75) { o.st = O_DIVE; o.dur = 0.9; this.splash.ring(o.x, o.z, 0.3); }
          else { o.rollT = 1.1; o.dur = rand(3, 6); } // grooming roll
        }
        if (bd < 8 && o.st === O_SWIM) { o.st = O_DIVE; o.t = 0; o.dur = 0.8; this.splash.ring(o.x, o.z, 0.35); }
        break;
      }
      case O_SCOPE: {
        // periscope: rear up, look around (at the boat if it is near)
        const k = smooth(o.t / 0.4) * (1 - smooth((o.t - o.dur + 0.4) / 0.4));
        pitch = -0.8 * k; y = -0.02 + 0.12 * k; head = 0.35 - 0.3 * k; amp = 0.01;
        const want = bd < 30 ? Math.atan2(boat.x - o.x, boat.z - o.z) : o.yaw + Math.sin(this.time + o.ph) * 0.5;
        o.yaw += wrap(want - o.yaw) * Math.min(1, dt * 2);
        if (o.t > o.dur) { o.st = O_SWIM; o.t = 0; o.dur = rand(3, 7); }
        break;
      }
      case O_DIVE: {
        // porpoise roll down, tail last
        const u = clamp01(o.t / o.dur);
        pitch = lerp(0.1, 1.1, u); y = lerp(-0.02, -0.5, u); head = 0.1;
        o.x += Math.sin(o.yaw) * 0.8 * dt; o.z += Math.cos(o.yaw) * 0.8 * dt;
        if (u >= 1) { o.st = O_UNDER; o.t = 0; o.dur = rand(2, 5); }
        break;
      }
      case O_UNDER: {
        const nx = o.x + Math.sin(o.yaw) * 1.1 * dt, nz = o.z + Math.cos(o.yaw) * 1.1 * dt;
        if (!this.land.blocked(nx, nz) && Math.hypot(nx - g.hx, nz - g.hz) < 16) { o.x = nx; o.z = nz; } else o.yaw += dt * 2;
        if (o.t > o.dur) { o.st = O_SWIM; o.t = 0; o.dur = rand(3, 7); this.splash.ring(o.x, o.z, 0.3); }
        this.mesh.otter!.mesh.setMatrixAt(o.idx, this.zero);
        return;
      }
    }
    let roll = 0;
    if (o.rollT > 0) { o.rollT -= dt; roll = (1 - Math.max(0, o.rollT) / 1.1) * TAU; }
    const bob = Math.sin(this.time * 1.7 + o.ph) * 0.02;
    const k = Math.min(1, dt * 6);
    o.pitch += (pitch - o.pitch) * k; o.y += (y + bob - o.y) * k; o.head += (head - o.head) * k; o.roll = roll;
    this.e.set(o.pitch, o.yaw, o.roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(o.x, o.y, o.z);
    this.s.setScalar(o.len);
    this.m.compose(this.v, this.q, this.s);
    const mm = this.mesh.otter!;
    mm.mesh.setMatrixAt(o.idx, this.m);
    mm.anim.setXYZW(o.idx, this.time * rate + o.ph, amp, 0, o.head);
  }

  // ---------------------------------------------------------------- debug / tests
  stats() {
    const acts: Record<string, number> = {};
    for (const p of this.pods) for (const c of p.members) acts[ACT_NAMES[c.act]] = (acts[ACT_NAMES[c.act]] ?? 0) + 1;
    const pins: Record<string, number> = {};
    for (const g of this.seals) for (const s of g.seals) pins[PIN_NAMES[s.st]] = (pins[PIN_NAMES[s.st]] ?? 0) + 1;
    return {
      animals: this.count, blows: this.blows.count, acts, seals: pins,
      pods: this.pods.map((p) => ({ name: p.name, sp: p.sp, n: p.members.length, at: [Math.round(p.cx), Math.round(p.cz)], relocated: p.relocated, bow: p.bow, cool: +p.bowCool.toFixed(1) })), boatSpeed: +this.bspd.toFixed(2),
      sealGroups: this.seals.map((g) => ({ name: g.name, n: g.seals.length, at: [Math.round(g.cx), Math.round(g.cz)], onRock: g.seals.filter((s) => s.onRock).length })),
      otters: this.otterGroups.map((g) => ({ name: g.name, n: g.otters.length, at: [Math.round(g.hx), Math.round(g.hz)] })),
    };
  }

  private findPod(q: string) {
    const k = q.toLowerCase();
    const sp: Sp | null = k.includes('orca') ? 'orca' : k.includes('fluke') || k.includes('humpback') ? 'humpback' : k.includes('dolphin') ? 'dolphin' : k.includes('porpoise') || k.includes('dall') ? 'porpoise' : null;
    return this.pods.find((p) => (sp ? p.sp === sp : p.name.toLowerCase().includes(k))) ?? null;
  }
  private findSeals(q: string) {
    const k = q.toLowerCase();
    if (k.includes('lion')) return this.seals.find((g) => g.seals[0]?.lion) ?? null;
    if (k.includes('haul')) return this.seals.find((g) => g.kind === 'haulout' && !g.seals[0]?.lion && g.seals.some((s) => s.onRock || !s.checked)) ?? null;
    if (k.includes('head') || k.includes('seal')) return this.seals.find((g) => g.kind === 'heads' && this.inBox(g.cx, g.cz, 0) && this.clear(g.cx, g.cz, 12)) ?? this.seals.find((g) => g.kind === 'heads' && /head/i.test(g.name)) ?? this.seals.find((g) => g.kind === 'heads') ?? null;
    return this.seals.find((g) => g.name.toLowerCase().includes(k)) ?? null;
  }

  /** Where a group is now: centre, heading, speed (for scripted debug cameras). */
  locate(q: string): { x: number; z: number; yaw: number; spd: number; kind: string } | null {
    if (q.toLowerCase().includes('otter') && this.otterGroups.length) { const o = this.otterGroups[0].otters[0]; return { x: o.x, z: o.z, yaw: 0, spd: 0, kind: 'otter' }; }
    const p = this.findPod(q);
    const f = this.focus;
    if (p && f && f.act !== SWIM && p.members.includes(f)) return { x: f.x, z: f.z, yaw: p.yaw, spd: f.act === SPYHOP || f.act === TAILLOB ? 0 : p.spd, kind: p.sp };
    if (p) return { x: p.cx, z: p.cz, yaw: p.yaw, spd: p.spd, kind: p.sp };
    const g = this.findSeals(q);
    // seals: frame from the water side they flop toward
    if (g) {
      // frame one seal (a visible one in the water for heads) from the water side it flops toward
      const s0 = g.seals.find((s) => s.st !== SUNK) ?? g.seals[0];
      const haul = g.kind === 'haulout';
      return { x: haul ? s0.hx : s0.x, z: haul ? s0.hz : s0.z, yaw: haul ? Math.atan2(s0.wx - s0.hx, s0.wz - s0.hz) - Math.PI / 2 : 0, spd: 0, kind: 'seal' };
    }
    return null;
  }

  /** Debug: move a pod to (x,z) in open water (captures), so it is in front of the camera. */
  bring(q: string, x: number, z: number) {
    const p = this.findPod(q);
    if (!p) return false;
    const [ox, oz] = this.openWater(x, z, p.sp === 'orca' || p.sp === 'humpback' ? 18 : 6);
    p.cx = ox; p.cz = oz;
    for (const c of p.members) { c.x = ox + Math.cos(p.yaw) * c.ox + Math.sin(p.yaw) * c.oz; c.z = oz - Math.sin(p.yaw) * c.ox + Math.cos(p.yaw) * c.oz; c.act = SWIM; c.pend = -1; c.t = 0; }
    this.pickWaypoint(p);
    return true;
  }

  /** Debug: trigger an action now ('surface' | 'breach' | 'spyhop' | 'taillob' | 'fluke'). */
  force(q: string, action: string, boat: THREE.Vector3) {
    const p = this.findPod(q);
    if (!p) return false;
    if (action === 'bowride') { p.bowCool = 0; return true; }
    if (action === 'surface' || action === 'fluke') {
      p.diving = false; p.breaths = action === 'fluke' ? 1 : 4; p.breathT = 0;
      for (const c of p.members) { if (c.act !== SWIM) { c.act = SWIM; c.t = 0; } c.pend = -1; }
      this.schedule(p, 0, boat);
      return true;
    }
    const act = action === 'breach' ? BREACH : action === 'spyhop' ? SPYHOP : action === 'taillob' ? TAILLOB : -1;
    if (act < 0) return false;
    const c = this.performer(p, false) ?? p.members[0];
    for (const m of p.members) { m.pend = -1; if (m !== c && (m.act === SPYHOP || m.act === TAILLOB || m.act === BREACH)) { m.act = SWIM; m.t = 0; } }
    p.queued = -1; p.specialT = Math.max(p.specialT, 25);
    c.act = SWIM;
    this.startAct(p, c, act, boat);
    this.focus = c;
    p.breathT = Math.max(p.breathT, c.dur + 2);
    return true;
  }

  state(q: string) {
    if (q.includes('otter')) return { otters: this.otterGroups.map((og) => og.otters.map((o) => ['swim', 'scope', 'dive', 'under'][o.st])) };
    const p = this.findPod(q);
    if (p) return { pod: p.name, at: [+p.cx.toFixed(1), +p.cz.toFixed(1)], breaths: p.breaths, diving: p.diving, bow: p.bow, members: p.members.map((c) => `${ACT_NAMES[c.act]}${c.calf ? '(calf)' : ''} y${c.y.toFixed(1)}`) };
    const g = this.findSeals(q);
    if (g) return { seals: g.name, st: g.seals.map((s) => `${PIN_NAMES[s.st]}${s.onRock ? '' : '(water)'}`) };
    return null;
  }
}
