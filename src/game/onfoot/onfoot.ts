import * as THREE from 'three';
import type { Interact, LoadedWorld, Npc } from '../../world/types';
import type { Boat } from '../boat';
import type { Input } from '../input';
import { FootWorld, WATER_Y, type Surface } from './footworld';
import { PlayerCharacter } from './character';
import { FootCamera } from './footcamera';
import { DustPuffs, SpeechBubble, injectFootCss } from './fx';
import { npcDisplayName, npcLine } from './npclines';
import { findPath } from './debugpath';

/** On-foot tuning. */
export const FOOT = {
  walk: 1.9, // m/s
  run: 4.8,
  accel: 28, // m/s^2: snappy, no acceleration lag (design ref: on foot is snappy)
  turn: 13, // 1/s yaw smoothing
  radius: 0.28,
  height: 1.65,
  interactRange: 2.6, // m horizontal
  npcRange: 2.4,
  boardRange: 7.2, // from the boat's centre (matches the step-ashore reach)
  ashoreMin: 1.0, // m, step-ashore search ring around the boat
  ashoreMax: 7.0, // from the boat centre: hull half-length (~2.5 m) + ~3 m reach
  hopTime: 0.62,
  edgeLook: 0.22, // keep this far back from a drop-off / water edge
};

/** Slide directions tried when the straight step is blocked: [cos, sin] of ±25°, ±50°, ±75°. */
const SLIDE = [25, -25, 50, -50, 75, -75].map((d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)] as const);
/** Boardwalk magnet: probe this far either side; drift toward the open side at this speed (m/s). */
export const MAGNET = { reach: 0.62, speed: 0.9 };

/** Interacts that only make sense from the boat. */
/** Interact kinds that actually do something today (everything else toasts "not open yet"). */
export const OPEN_INTERACTS = new Set(['sell_fish', 'moor_boat', 'read_sunstone', 'read_message_bottle', 'read_warning', 'trade_rumours',
  'buy_tackle', 'buy_bait', 'upgrade_bench', 'buy_boat', 'weigh_fish', 'trophy_wall']); // upgrades: shops
const FOOT_IGNORED = new Set(['fish_here', 'moor_boat', 'dive_here', 'land_here', 'haul_crab_pots', 'reef_net_event']);
const ASHORE_HINT_KINDS = new Set(['moor_boat', 'land_here', 'sell_fish']);

export interface FootContext { name: string; label: string; prompt: string; run: () => void; /** world point (tags over the target) */ pos?: number[]; kind?: string }
export interface FootSaved { x: number; y: number; z: number; yaw: number }

export interface FootHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  input: Input;
  boat: () => Boat;
  labelFor: (it: Interact) => string;
  doInteract: (it: Interact) => void;
  toast: (msg: string, kind?: 'info' | 'good' | 'warn') => void;
  /** Called when stepping ashore (true) or after boarding (false). Persist with the boat tied. */
  setMode: (onFoot: boolean) => void;
  persist: (s: FootSaved | null) => void;
  /** cheap test: land (landgrid) within r of (x,z) */
  landNear: (x: number, z: number, r: number) => boolean;
}

type Mode = 'boat' | 'hopOut' | 'foot' | 'hopIn';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class OnFoot {
  mode: Mode = 'boat';
  world = new FootWorld();
  character = new PlayerCharacter();
  cam: FootCamera;
  dust = new DustPuffs();
  bubble = new SpeechBubble();
  feet = new THREE.Vector3();
  yaw = 0;
  private vel = new THREE.Vector3();
  private fallV = 0;
  private yawRate = 0;
  private gw: LoadedWorld | null = null;
  private npcs: Npc[] = [];
  private hop = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, arc: 0.8 };
  private ashore: { target: THREE.Vector3; at: THREE.Vector3; t: number } | null = null;
  private ctx: FootContext | null = null;
  /** runner-up in reach (hud_flow_study P2: offered as a second, smaller button) */
  private ctx2: FootContext | null = null;
  private lookAt: THREE.Vector3 | null = null;
  private saveTimer = 0;
  private talkCount = new Map<string, number>();
  private autoWalk: { x: number; z: number } | null = null;
  private autoPath: { x: number; z: number }[] = [];
  private autoGoal: { x: number; z: number } | null = null;
  private autoStall = 0;
  private returnBlend: { pos: THREE.Vector3; q: THREE.Quaternion; t: number } | null = null;
  lastSpeed = 0;
  steps = 0;
  /** Audio hooks: a footfall (speed 0..1, feet position, surface colour) and an NPC line spoken. */
  onFootstep: ((speed: number, feet: THREE.Vector3, surface: Surface | null) => void) | null = null;
  onSay: ((name: string, text: string, role: string, x: number, z: number) => void) | null = null;
  /** Fires when the player talks to an NPC (gameplay name): the NPC animator turns / nods / waves. */
  onTalk: ((name: string) => void) | null = null;

  constructor(private host: FootHost) {
    injectFootCss();
    this.cam = new FootCamera(host.camera, this.world);
    this.character.root.visible = false;
    host.scene.add(this.character.root, this.dust.group);
    this.character.onStep = (sp) => {
      this.steps++;
      _v.set(-Math.sin(this.yaw) * 0.1, 0, -Math.cos(this.yaw) * 0.1).add(this.feet);
      this.dust.puff(_v, Math.min(1, sp / FOOT.run));
      if (this.onFootstep) this.onFootstep(Math.min(1, sp / FOOT.run), this.feet, this.world.surfaceColor(this.feet.x, this.feet.z, this.feet.y));
    };
  }

  get active() { return this.mode !== 'boat'; }

  setWorld(w: LoadedWorld) {
    this.gw = w;
    this.world.setChunks(w.chunks);
    this.npcs = w.gameplay.npcs ?? [];
    this.world.circles = this.npcs.map((n) => {
      const role = String(n.props?.npc_role ?? n.props?.role ?? n.role ?? '');
      return { x: n.pos[0], z: n.pos[2], r: role === 'cat' ? 0.15 : 0.3 };
    });
    this.ashore = null;
    if (this.active) this.settle();
  }

  // ------------------------------------------------------------ boat mode
  /** Called every frame while sailing: lazy BVH prefetch near moorings + boat-camera return blend. */
  boatTick(boat: Boat) {
    if (!this.gw) return;
    if (Math.abs(boat.speed) < 1.6 && this.nearAshoreHint(boat.pos, 40)) this.world.prefetch(boat.pos.x, boat.pos.z, 10);
  }

  /** Blend from the last on-foot camera into the boat camera (call after the chase camera updated). */
  afterChase(dt: number) {
    const b = this.returnBlend;
    if (!b) return;
    b.t += dt / 0.9;
    const k = THREE.MathUtils.smoothstep(Math.min(1, b.t), 0, 1);
    const cam = this.host.camera;
    cam.position.lerpVectors(b.pos, _v.copy(cam.position), k);
    _q.copy(cam.quaternion);
    cam.quaternion.slerpQuaternions(b.q, _q, k);
    if (b.t >= 1) this.returnBlend = null;
  }

  private nearAshoreHint(p: THREE.Vector3, r: number) {
    for (const it of this.gw?.gameplay.interacts ?? []) {
      if (ASHORE_HINT_KINDS.has(it.kind) && Math.hypot(it.pos[0] - p.x, it.pos[2] - p.z) < r) return it;
    }
    return null;
  }

  /** Nearest walkable spot within reach of the stopped boat, or null. Cached while the boat sits still. */
  private findAshore(boat: Boat): THREE.Vector3 | null {
    const now = performance.now();
    const c = this.ashore;
    if (c && c.at.distanceTo(boat.pos) < 0.25 && now - c.t < 500) return c.target.x === Infinity ? null : c.target;
    const res = { target: new THREE.Vector3(Infinity, 0, 0), at: boat.pos.clone(), t: now };
    this.ashore = res;
    if (!this.nearAshoreHint(boat.pos, 25) && !this.host.landNear(boat.pos.x, boat.pos.z, FOOT.ashoreMax + 1) && !boat.moored) return null;
    let best = Infinity;
    const p = new THREE.Vector3();
    for (let r = FOOT.ashoreMin; r <= FOOT.ashoreMax + 1e-3; r += 0.5) {
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const x = boat.pos.x + Math.cos(a) * r, z = boat.pos.z + Math.sin(a) * r;
        const g = this.world.groundAt(x, z, 0.4, 2.4, 0.2);
        if (!g || g.y < WATER_Y) continue;
        p.set(x, g.y, z);
        const push = this.world.pushOut(p, FOOT.radius, FOOT.height);
        if (push > 0.2) continue;
        const g2 = this.world.groundAt(p.x, p.z, g.y);
        if (!g2 || g2.y < WATER_Y) continue;
        // Land on open deck/ground, not a beam or kerb: the 4 neighbours 0.5 m away must be level-ish.
        let open = 0;
        for (const [ox, oz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
          const gn = this.world.groundAt(p.x + ox, p.z + oz, g2.y, 0.25, 0.25);
          if (gn && gn.y >= WATER_Y) open++;
        }
        if (open < 3) continue;
        const score = r;
        if (score < best) { best = score; res.target.set(p.x, g2.y, p.z); }
      }
      if (best < Infinity) break;
    }
    return best < Infinity ? res.target : null;
  }

  /**
   * In boat mode: should the context button say "Step ashore"? `best` is the interact the boat
   * would otherwise offer. Selling straight from the boat still wins when you're parked at the
   * market rather than at a mooring (and you're not tied up).
   */
  boatContext(boat: Boat, best: Interact | null, sellFirst: boolean): FootContext | null {
    // A working boat-side interact (Sell, Tie up / Untie, a sign…) keeps the context button;
    // "Ashore" then moves to the idle Cast button instead of hijacking E.
    if (best && OPEN_INTERACTS.has(best.kind)) return null;
    if (sellFirst && best?.kind === 'sell_fish') return null;
    return this.ashoreContext(boat);
  }

  /** "Step ashore" if the stopped boat is within reach of walkable ground. */
  ashoreContext(boat: Boat): FootContext | null {
    if (!this.gw || Math.abs(boat.speed) > 0.6) return null;
    const t = this.findAshore(boat);
    if (!t) return null;
    return { name: 'step_ashore', label: 'Ashore', prompt: 'Step ashore', run: () => this.stepAshore(boat) };
  }

  stepAshore(boat: Boat) {
    const t = this.findAshore(boat);
    if (!t || this.mode !== 'boat') return false;
    boat.speed = 0;
    boat.moored = true;
    this.hop.from.set(boat.pos.x, boat.root.position.y + 0.55, boat.pos.z);
    this.hop.to.copy(t);
    this.hop.t = 0;
    this.hop.arc = 0.6 + Math.max(0, t.y - this.hop.from.y) * 0.6;
    this.yaw = Math.atan2(-(t.x - boat.pos.x), -(t.z - boat.pos.z));
    this.feet.copy(this.hop.from);
    this.vel.set(0, 0, 0);
    this.mode = 'hopOut';
    this.character.root.visible = true;
    this.returnBlend = null;
    // Blend from the current (boat) camera.
    _v.set(0, 0, -8).applyQuaternion(this.host.camera.quaternion).add(this.host.camera.position);
    this.cam.snap(t, this.yaw);
    this.cam.beginBlend(_v);
    this.host.setMode(true);
    return true;
  }

  board() {
    if (this.mode !== 'foot') return false;
    const boat = this.host.boat();
    this.hop.from.copy(this.feet);
    this.hop.to.set(boat.pos.x, boat.root.position.y + 0.55, boat.pos.z);
    this.hop.t = 0;
    this.hop.arc = 0.6;
    this.yaw = Math.atan2(-(boat.pos.x - this.feet.x), -(boat.pos.z - this.feet.z));
    this.mode = 'hopIn';
    this.bubble.hide();
    return true;
  }

  /** Put the player on foot at a saved spot (boat must already be placed + moored). */
  restore(s: FootSaved) {
    this.feet.set(s.x, s.y, s.z);
    this.yaw = s.yaw;
    this.mode = 'foot';
    this.character.root.visible = true;
    this.settle();
    this.cam.snap(this.feet, this.yaw);
    this.host.setMode(true);
  }

  /** Make sure the feet stand on something walkable (after load / world swap). */
  private settle() {
    const g = this.world.groundAt(this.feet.x, this.feet.z, this.feet.y, 1.5, 3);
    if (g && g.y >= WATER_Y) { this.feet.y = g.y; return; }
    for (let r = 0.5; r <= 12; r += 0.5) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = this.feet.x + Math.cos(a) * r, z = this.feet.z + Math.sin(a) * r;
        const g2 = this.world.groundAt(x, z, this.feet.y, 2, 3);
        if (g2 && g2.y >= WATER_Y) { this.feet.set(x, g2.y, z); return; }
      }
    }
  }

  // ------------------------------------------------------------ foot mode
  /** Context for the interact button while on foot (refreshed by update()). */
  context() { return this.active ? this.ctx : null; }
  context2() { return this.active ? this.ctx2 : null; }

  private computeContext() {
    if (this.mode !== 'foot' || !this.gw) { this.ctx = null; this.ctx2 = null; this.lookAt = null; return; }
    const f = this.feet;
    // Candidates by tier, then score (hud_flow_study P2): a counter/sign you stand at (tier 0) is
    // never taken by a passer-by (tier 1: people, the boat); "not open yet" things come last.
    // The best is the context button; the runner-up (tiers 0-1) becomes the second, smaller button.
    const cands: { c: FootContext; tier: number; s: number; look: THREE.Vector3 }[] = [];
    // Prefer what you're facing: x1.0 straight ahead ... x1.5 behind you.
    const face = (x: number, z: number) => {
      const a = Math.atan2(-(x - f.x), -(z - f.z)) - this.yaw;
      return 1.25 - 0.25 * Math.cos(a);
    };
    const boat = this.host.boat();
    const db = Math.hypot(boat.pos.x - f.x, boat.pos.z - f.z);
    if (boat.moored && db < FOOT.boardRange) {
      // score by the gap to the hull, not the boat's centre: the troller (~7 m) sits 6-7 m off the deck
      cands.push({ c: { name: 'board', label: 'Board', prompt: 'Board your boat', run: () => this.board(), pos: [boat.pos.x, 1, boat.pos.z], kind: 'board' },
        tier: 1, s: Math.max(0.2, db - 5.5) * face(boat.pos.x, boat.pos.z), look: boat.pos.clone().setY(1) });
    }
    for (const it of this.gw.gameplay.interacts) {
      if (FOOT_IGNORED.has(it.kind)) continue;
      const d = Math.hypot(it.pos[0] - f.x, it.pos[2] - f.z);
      if (d > FOOT.interactRange || Math.abs(it.pos[1] - (f.y + 1.1)) > 2.2) continue;
      const open = OPEN_INTERACTS.has(it.kind);
      // Sell wins at the counter
      const w = it.kind === 'sell_fish' ? 0.3 : 1;
      const lbl = this.host.labelFor(it);
      cands.push({ c: { name: it.name, label: lbl, prompt: lbl, run: () => this.host.doInteract(it), pos: [...it.pos], kind: it.kind },
        tier: open ? 0 : 2, s: Math.max(0.1, d * w) * face(it.pos[0], it.pos[2]), look: new THREE.Vector3(...it.pos) });
    }
    for (const n of this.npcs) {
      const d = Math.hypot(n.pos[0] - f.x, n.pos[2] - f.z);
      if (d > FOOT.npcRange || Math.abs(n.pos[1] - f.y) > 1.5) continue;
      const who = npcDisplayName(n);
      const role = String(n.props?.npc_role ?? n.role ?? '');
      cands.push({ c: { name: n.name ?? who, label: role === 'cat' ? 'Pet' : 'Talk', prompt: `${role === 'cat' ? 'Pet' : 'Talk to'} ${who}`, run: () => this.talk(n), pos: [n.pos[0], n.pos[1] + 1.2, n.pos[2]], kind: role === 'cat' ? 'pet' : 'talk' },
        tier: 1, s: (d + 0.4) * face(n.pos[0], n.pos[2]) * (role === 'cat' ? 1.6 : 1), look: new THREE.Vector3(n.pos[0], n.pos[1] + 1.5, n.pos[2]) });
    }
    cands.sort((a, b) => a.tier - b.tier || a.s - b.s);
    const best = cands[0];
    const second = cands.slice(1).find((x) => x.tier <= 1 && x.c.name !== best?.c.name);
    this.ctx = best?.c ?? null;
    this.ctx2 = best && second ? second.c : null;
    this.lookAt = best?.look ?? null;
  }

  private talk(n: Npc) {
    const key = n.name ?? npcDisplayName(n);
    const k = this.talkCount.get(key) ?? 0;
    this.talkCount.set(key, k + 1);
    if (n.name) this.onTalk?.(n.name);
    const role = String(n.props?.npc_role ?? n.role ?? '');
    const line = npcLine(n, k);
    this.bubble.say(npcDisplayName(n), line, new THREE.Vector3(n.pos[0], n.pos[1] + (role === 'cat' ? 0.6 : 2.05), n.pos[2]));
    // eased two-shot while the line is up (docs/camera_study.md F7); walking away ends it
    this.cam.talk(new THREE.Vector3(n.pos[0], n.pos[1] + (role === 'cat' ? 0.35 : 1.5), n.pos[2]), () => this.bubble.visible && this.lastSpeed < 0.8 && this.mode === 'foot');
    this.onSay?.(n.name ?? npcDisplayName(n), line, role, n.pos[0], n.pos[2]);
  }

  /** Debug/test: walk toward a world point through the normal controller (null to stop). */
  setAutoWalk(x: number | null, z = 0) { this.autoWalk = x === null ? null : { x, z }; this.autoPath = []; this.autoGoal = null; }
  /** Debug/test: A* a route over the walkable grid and follow it with the normal controller. */
  setAutoPath(x: number, z: number) {
    this.autoGoal = { x, z };
    this.autoStall = 0;
    const path = findPath(this.world, this.feet, { x, z });
    this.autoPath = path.slice(1);
    this.autoWalk = this.autoPath.shift() ?? null;
    return path.map((q) => [+q.x.toFixed(1), +q.z.toFixed(1)]);
  }

  private tryMove(nx: number, nz: number, dirx: number, dirz: number): { y: number } | null {
    // Test walls at the height we'd stand at (so stepping up onto a deck isn't blocked by its kerb).
    const g0 = this.world.walkable(nx, nz, this.feet.y);
    if (!g0) return null;
    const p = _v.set(nx, Math.max(this.feet.y, g0.y), nz);
    this.world.pushOut(p, FOOT.radius, FOOT.height);
    const g = this.world.walkable(p.x, p.z, this.feet.y);
    if (!g) return null;
    // Only step DOWN onto something with open footing all round (stairs, lower decks) — never onto
    // a narrow stringer / beam lip below a deck edge.
    if (g.y < this.feet.y - 0.2) {
      for (const [ox, oz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
        if (!this.world.walkable(p.x + ox, p.z + oz, g.y)) return null;
      }
    }
    // Keep a lip back from drop-offs / water so the body never hangs over the edge.
    const L = Math.hypot(dirx, dirz);
    if (L > 1e-4) {
      const ax = p.x + (dirx / L) * FOOT.edgeLook, az = p.z + (dirz / L) * FOOT.edgeLook;
      if (!this.world.walkable(ax, az, g.y)) return null;
    }
    this.feet.x = p.x; this.feet.z = p.z;
    return g;
  }

  /** Narrow-walkway centring: probe the boards either side of the walking line; if one side drops away
   *  within MAGNET.reach and the other doesn't, drift toward the open side (never off the deck). */
  private centreOnNarrow(wx: number, wz: number, dt: number) {
    const px = -wz, pz = wx; // perpendicular to the walking direction
    const y = this.feet.y, R = MAGNET.reach;
    const L = this.world.walkable(this.feet.x + px * R, this.feet.z + pz * R, y);
    const Rr = this.world.walkable(this.feet.x - px * R, this.feet.z - pz * R, y);
    if ((!!L) === (!!Rr)) return; // open (or a plank too narrow to matter) both sides: leave it
    const side = L ? 1 : -1;
    const step = MAGNET.speed * dt * side;
    const nx = this.feet.x + px * step, nz = this.feet.z + pz * step;
    const g = this.world.walkable(nx, nz, y);
    if (g && Math.abs(g.y - y) < 0.2) { this.feet.x = nx; this.feet.z = nz; }
  }

  update(dt: number, frozen: boolean) {
    const input = this.host.input;
    if (this.mode === 'hopOut' || this.mode === 'hopIn') {
      this.updateHop(dt);
      return;
    }
    if (this.mode !== 'foot') return;

    // ---- desired velocity (camera-relative)
    let mx = input.moveX, my = input.moveY, run = input.moveRun;
    if (this.autoWalk) {
      const dx = this.autoWalk.x - this.feet.x, dz = this.autoWalk.z - this.feet.z;
      const d = Math.hypot(dx, dz);
      if (d < (this.autoPath.length ? 0.3 : 0.35)) { this.autoWalk = this.autoPath.shift() ?? null; mx = 0; my = 0; } else {
        // convert world direction to camera-relative stick
        const a = this.cam.viewYaw;
        const fx = -Math.sin(a), fz = -Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
        my = (dx * fx + dz * fz) / d; mx = (dx * rx + dz * rz) / d; run = false;
      }
    }
    if (frozen) { mx = 0; my = 0; }
    const mag = Math.min(1, Math.hypot(mx, my));
    const a = this.cam.viewYaw;
    const fx = -Math.sin(a), fz = -Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
    let wx = fx * my + rx * mx, wz = fz * my + rz * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) { wx /= wl; wz /= wl; }
    const target = mag < 0.05 ? 0 : run ? FOOT.run : FOOT.walk * Math.min(1, mag / 0.85 + 0.25);
    const tvx = wx * target, tvz = wz * target;
    const dvx = tvx - this.vel.x, dvz = tvz - this.vel.z;
    const dl = Math.hypot(dvx, dvz), maxDv = FOOT.accel * dt;
    if (dl > maxDv) { this.vel.x += (dvx / dl) * maxDv; this.vel.z += (dvz / dl) * maxDv; } else { this.vel.x = tvx; this.vel.z = tvz; }

    // ---- move with sliding, in small substeps
    const sx = this.feet.x, sz = this.feet.z;
    const stepX = this.vel.x * dt, stepZ = this.vel.z * dt;
    const n = Math.max(1, Math.ceil(Math.hypot(stepX, stepZ) / 0.15));
    let groundY: number | null = null;
    for (let i = 0; i < n; i++) {
      const ox = this.feet.x, oz = this.feet.z;
      const ix = stepX / n, iz = stepZ / n;
      let g = this.tryMove(ox + ix, oz + iz, ix, iz);
      // Slide along whatever stopped us (a plank edge, a railing, a diagonal boardwalk): try the step
      // turned ±25°/±50°/±75° (shortened by the cosine) before the old axis-only fallback.
      for (let k = 0; !g && k < SLIDE.length; k++) {
        this.feet.x = ox; this.feet.z = oz;
        const c = SLIDE[k][0], sn = SLIDE[k][1];
        const rx = (ix * c - iz * sn) * c, rz = (ix * sn + iz * c) * c;
        g = this.tryMove(ox + rx, oz + rz, rx, rz);
      }
      if (!g) { this.feet.x = ox; this.feet.z = oz; g = this.tryMove(ox + ix, oz, ix, 0); }
      if (!g) { this.feet.x = ox; this.feet.z = oz; g = this.tryMove(ox, oz + iz, 0, iz); }
      if (!g) { this.feet.x = ox; this.feet.z = oz; break; }
      groundY = g.y;
    }
    // Boardwalk magnet: on a narrow deck / plank run, ease the walker toward the middle of the boards
    // (sideways to the stick), so a thumb that's a few degrees off doesn't walk you into the lip.
    if (mag > 0.2) this.centreOnNarrow(wx, wz, dt);
    if (groundY === null) {
      // standing still (or blocked): keep resolving overlaps + ground
      const p = _v.copy(this.feet);
      this.world.pushOut(p, FOOT.radius, FOOT.height);
      const g = this.world.walkable(p.x, p.z, this.feet.y);
      if (g) { this.feet.x = p.x; this.feet.z = p.z; groundY = g.y; }
    }
    const moved = Math.hypot(this.feet.x - sx, this.feet.z - sz);
    const speed = dt > 0 ? moved / dt : 0;
    if (moved < Math.hypot(stepX, stepZ) * 0.3) { this.vel.multiplyScalar(0.5); }
    // Test autopilot: re-plan from here if the walker stalls (e.g. against the edge lip).
    if (this.autoWalk && this.autoGoal) {
      this.autoStall = speed < 0.2 ? this.autoStall + dt : 0;
      if (this.autoStall > 0.6) { const g = this.autoGoal; this.setAutoPath(g.x, g.z); }
    }
    this.lastSpeed = speed;

    // ---- vertical: snap up steps, fall down small drops
    if (groundY !== null) {
      if (groundY >= this.feet.y) { this.feet.y += (groundY - this.feet.y) * Math.min(1, dt * 22); this.fallV = 0; if (groundY - this.feet.y < 0.01) this.feet.y = groundY; }
      else { this.fallV += 18 * dt; this.feet.y = Math.max(groundY, this.feet.y - this.fallV * dt); if (this.feet.y === groundY) this.fallV = 0; }
    }

    // ---- facing
    if (target > 0.05 && Math.hypot(this.vel.x, this.vel.z) > 0.2) {
      const ty = Math.atan2(-this.vel.x, -this.vel.z);
      let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const step = d * Math.min(1, dt * FOOT.turn);
      this.yaw += step;
      this.yawRate = dt > 0 ? step / dt : 0;
    } else this.yawRate *= 0.8;

    this.computeContext();
    let lookYaw = 0;
    if (this.lookAt) {
      const ang = Math.atan2(-(this.lookAt.x - this.feet.x), -(this.lookAt.z - this.feet.z));
      let d = ang - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 1.9) lookYaw = THREE.MathUtils.clamp(d, -1.0, 1.0);
    }
    this.place();
    this.character.update(dt, { speed, runFrac: THREE.MathUtils.clamp((speed - FOOT.walk) / (FOOT.run - FOOT.walk), 0, 1), turn: this.yawRate, lookYaw, airborne: 0 });
    this.cam.update(dt, this.feet, this.yaw, speed, frozen ? { x: 0, y: 0 } : input.takeOrbit());
    this.dust.update(dt);
    this.bubble.update(this.host.camera);

    this.saveTimer += dt;
    if (this.saveTimer > 2 && speed < 0.05) { this.saveTimer = 0; this.host.persist(this.saved()); }
  }

  private place() {
    this.character.root.position.copy(this.feet);
    this.character.root.rotation.set(0, this.yaw, 0);
  }

  private updateHop(dt: number) {
    const h = this.hop;
    h.t += dt / FOOT.hopTime;
    const k = Math.min(1, h.t);
    if (this.mode === 'hopIn') {
      const boat = this.host.boat();
      h.to.set(boat.pos.x, boat.root.position.y + 0.55, boat.pos.z);
    }
    this.feet.lerpVectors(h.from, h.to, k);
    this.feet.y += Math.sin(k * Math.PI) * h.arc;
    this.place();
    this.character.update(dt, { speed: 0, runFrac: 0, turn: 0, lookYaw: 0, airborne: Math.sin(k * Math.PI) });
    this.cam.update(dt, this.feet, this.yaw, 0, this.host.input.takeOrbit());
    this.dust.update(dt);
    if (k < 1) return;
    if (this.mode === 'hopOut') {
      this.feet.copy(h.to);
      this.mode = 'foot';
      this.dust.puff(this.feet, 0.8);
      this.host.persist(this.saved());
    } else {
      this.mode = 'boat';
      this.character.root.visible = false;
      this.returnBlend = { pos: this.host.camera.position.clone(), q: this.host.camera.quaternion.clone(), t: 0 };
      this.host.persist(null);
      this.host.setMode(false);
    }
  }

  saved(): FootSaved { return { x: +this.feet.x.toFixed(2), y: +this.feet.y.toFixed(2), z: +this.feet.z.toFixed(2), yaw: +this.yaw.toFixed(3) }; }

  get debugState() {
    return {
      mode: this.mode, feet: this.saved(), speed: +this.lastSpeed.toFixed(2), ctx: this.ctx?.prompt ?? null,
      bvhChunks: this.world.built, bvhMs: Math.round(this.world.buildMs), steps: this.steps,
      bubble: this.bubble.text, model: this.character.source, autoWalk: !!this.autoWalk, camYaw: +this.cam.viewYaw.toFixed(3),
    };
  }
}
