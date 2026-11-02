import * as THREE from 'three';
import type { Gameplay, Hotspot } from '../world/types';
import type { LandCollision } from './collision';
import { creatureMesh, fishGeometry, otterGeometry, porpoiseGeometry, sealGeometry, type CreatureMesh } from '../render/creatures';
import type { SplashFX } from './splash';

const NEAR = 250; // m: sea life further than this from the camera is hidden and not animated
const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Jump { active: boolean; t: number; dur: number; x0: number; z0: number; dx: number; dz: number; h: number; s: number; yaw: number }
interface Swimmer {
  otter: boolean; idx: number; hx: number; hz: number; x: number; z: number; yaw: number;
  st: 0 | 1 | 2 | 3; // 0 surfaced, 1 sinking, 2 under, 3 rising
  t: number; dur: number; ph: number; roll: number; rollT: number; hidden: boolean;
}
interface Porpoise { off: number; lag: number; t: number; dur: number; gap: number; idx: number; splashed: number }

/**
 * Cheap secondary wildlife: fish jumping at hotspots, harbour seals / river otters bobbing near
 * rocks and kelp, and a Dall's porpoise pod surfacing in arcs along the gameplay route.
 */
export class SeaLife {
  group = new THREE.Group();
  private fish: CreatureMesh;
  private jumps: Jump[] = [];
  private jumpT: Float32Array;
  private seals: CreatureMesh;
  private otters: CreatureMesh;
  private swimmers: Swimmer[] = [];
  private pods: CreatureMesh;
  private pod: Porpoise[] = [];
  private route: [number, number][] = [];
  private routeLen: number[] = [];
  private podS = 0;
  private podDir = 1;
  private podHidden = false;
  private time = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private hotspots: Hotspot[], gp: Gameplay, private land: LandCollision, low: boolean, private splash: SplashFX) {
    // jumping fish: a small pool shared by all hotspots
    const nFish = low ? 3 : 6;
    this.fish = creatureMesh(fishGeometry(), nFish);
    for (let i = 0; i < nFish; i++) this.jumps.push({ active: false, t: 0, dur: 1, x0: 0, z0: 0, dx: 0, dz: 0, h: 1, s: 1, yaw: 0 });
    this.jumpT = new Float32Array(hotspots.length).map(() => rand(1, 8));

    // seals near rocky hotspots, otters at kelp / seagrass
    const sealSpots: [number, number][] = [], otterSpots: [number, number][] = [];
    hotspots.forEach((hs, i) => {
      const b = (hs.biome ?? '').toLowerCase();
      if (low && i % 2) return;
      if (/kelp|seagrass|lagoon/.test(b)) {
        const p = this.nearShore(hs.pos[0], hs.pos[2]);
        otterSpots.push(p, [p[0] + rand(-3, 3), p[1] + rand(-3, 3)]);
      } else if (/reef|spire|wreck|drop|rock|stack/.test(b)) {
        sealSpots.push(this.nearShore(hs.pos[0], hs.pos[2]));
        if (/spire|stack/.test(b) && !low) sealSpots.push(this.nearShore(hs.pos[0], hs.pos[2]));
      }
    });
    this.seals = creatureMesh(sealGeometry(), sealSpots.length);
    this.otters = creatureMesh(otterGeometry(), otterSpots.length * 1);
    const mk = (otter: boolean, p: [number, number], idx: number): Swimmer =>
      ({ otter, idx, hx: p[0], hz: p[1], x: p[0], z: p[1], yaw: Math.random() * TAU, st: 0, t: rand(0, 4), dur: rand(5, 9), ph: Math.random() * TAU, roll: 0, rollT: 0, hidden: true });
    sealSpots.forEach((p, i) => this.swimmers.push(mk(false, p, i)));
    otterSpots.forEach((p, i) => this.swimmers.push(mk(true, p, i)));

    // porpoise pod along the route (fallback: a loop through the first hotspots)
    const route = gp.route && gp.route.length >= 2 ? gp.route : hotspots.slice(0, 5).map((h) => [h.pos[0], h.pos[2]] as [number, number]);
    this.route = route;
    let acc = 0;
    this.routeLen = route.map((p, i) => (i ? (acc += Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1])) : 0));
    const nPod = route.length >= 2 ? (low ? 2 : 3) : 0;
    this.pods = creatureMesh(porpoiseGeometry(), nPod);
    for (let i = 0; i < nPod; i++) this.pod.push({ off: (i - 1) * 2.2, lag: i * 3.5, t: rand(0, 2), dur: 1.4, gap: rand(2.5, 4), idx: i, splashed: 0 });
    this.podS = Math.random() * (this.routeLen[this.routeLen.length - 1] ?? 0);

    for (const c of [this.fish, this.seals, this.otters, this.pods]) this.group.add(c.mesh);
  }

  stats() {
    return {
      seals: this.swimmers.filter((s) => !s.otter).map((s) => [Math.round(s.hx), Math.round(s.hz)]),
      otters: this.swimmers.filter((s) => s.otter).map((s) => [Math.round(s.hx), Math.round(s.hz)]),
      pod: this.pod.length, podAt: [Math.round(this.v.x), Math.round(this.v.z)], jumping: this.jumps.filter((j) => j.active).length,
    };
  }

  /** A water point 10–30 m from (x,z) with land close by (rocks / shore), else the point itself offset. */
  private nearShore(x: number, z: number): [number, number] {
    for (const r of [12, 18, 24, 30]) {
      const a0 = Math.random() * TAU;
      for (let i = 0; i < 16; i++) {
        const a = a0 + (i / 16) * TAU;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (this.land.hitsCircle(px, pz, 2)) continue;
        for (let j = 0; j < 8; j++) {
          const b = (j / 8) * TAU;
          if (this.land.blocked(px + Math.cos(b) * 7, pz + Math.sin(b) * 7)) return [px, pz];
        }
      }
    }
    const a = Math.random() * TAU;
    return [x + Math.cos(a) * 14, z + Math.sin(a) * 14];
  }

  update(dt: number, cam: THREE.Vector3, boat: THREE.Vector3) {
    this.time += dt;
    this.updateFish(dt, cam);
    this.updateSwimmers(dt, cam, boat);
    this.updatePod(dt, cam);
  }

  private put(cm: CreatureMesh, idx: number, x: number, y: number, z: number, pitch: number, yaw: number, roll: number, s: number) {
    this.e.set(pitch, yaw, roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.sc.setScalar(s);
    this.m.compose(this.v, this.q, this.sc);
    cm.mesh.setMatrixAt(idx, this.m);
  }

  private updateFish(dt: number, cam: THREE.Vector3) {
    let dirty = false;
    for (let h = 0; h < this.hotspots.length; h++) {
      const hs = this.hotspots[h];
      if (Math.hypot(hs.pos[0] - cam.x, hs.pos[2] - cam.z) > 160) continue;
      this.jumpT[h] -= dt;
      if (this.jumpT[h] > 0) continue;
      this.jumpT[h] = rand(3, 9);
      const j = this.jumps.find((x) => !x.active);
      if (!j) continue;
      const a = Math.random() * TAU, r = Math.random() * 4.5, len = rand(1.0, 2.2);
      j.active = true; j.t = 0; j.dur = rand(0.65, 0.9);
      j.x0 = hs.pos[0] + Math.cos(a) * r; j.z0 = hs.pos[2] + Math.sin(a) * r;
      j.yaw = Math.random() * TAU;
      j.dx = Math.sin(j.yaw) * len; j.dz = Math.cos(j.yaw) * len;
      j.h = rand(0.45, 1.0); j.s = rand(0.9, 1.6);
      this.splash.splash(j.x0, j.z0, 0.35);
    }
    for (let i = 0; i < this.jumps.length; i++) {
      const j = this.jumps[i];
      if (!j.active) continue;
      dirty = true;
      j.t += dt;
      const u = j.t / j.dur;
      if (u >= 1) {
        j.active = false;
        this.splash.splash(j.x0 + j.dx, j.z0 + j.dz, 0.4);
        this.fish.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      const y = 4 * j.h * u * (1 - u) - 0.05;
      const pitch = -Math.atan2(4 * j.h * (1 - 2 * u), Math.hypot(j.dx, j.dz)); // nose follows the arc
      this.put(this.fish, i, j.x0 + j.dx * u, y, j.z0 + j.dz * u, pitch, j.yaw, 0, j.s);
      this.fish.anim.setXYZW(i, this.time * 28, 0.9, 0, 0);
    }
    if (dirty) { this.fish.mesh.instanceMatrix.needsUpdate = true; this.fish.anim.needsUpdate = true; }
  }

  private updateSwimmers(dt: number, cam: THREE.Vector3, boat: THREE.Vector3) {
    let dirty = false;
    for (const s of this.swimmers) {
      const cm = s.otter ? this.otters : this.seals;
      if (Math.hypot(s.hx - cam.x, s.hz - cam.z) > NEAR) {
        if (!s.hidden) { cm.mesh.setMatrixAt(s.idx, this.zero); s.hidden = true; dirty = true; }
        continue;
      }
      s.hidden = false;
      dirty = true;
      s.t += dt;
      const boatD = Math.hypot(s.x - boat.x, s.z - boat.z);
      if (s.st === 0 && boatD < 7 && s.t > 1.5 && Math.random() < dt * (s.otter ? 0.3 : 0.8)) s.t = s.dur; // shy: dive early
      if (s.t >= s.dur) {
        s.t = 0;
        s.st = ((s.st + 1) % 4) as Swimmer['st'];
        s.dur = s.st === 0 ? rand(5, 10) : s.st === 2 ? rand(3, 7) : 0.8;
        if (s.st === 1) this.splash.ring(s.x, s.z, 0.45);
        if (s.st === 3) {
          // resurface somewhere nearby
          for (let k = 0; k < 6; k++) {
            const a = Math.random() * TAU, r = rand(1, 5);
            const x = s.hx + Math.cos(a) * r, z = s.hz + Math.sin(a) * r;
            if (!this.land.hitsCircle(x, z, 0.8)) { s.x = x; s.z = z; break; }
          }
          s.yaw = Math.random() * TAU;
          this.splash.ring(s.x, s.z, 0.35);
        }
      }
      const u = Math.min(1, s.t / s.dur);
      const sink = s.st === 0 ? 0 : s.st === 1 ? u : s.st === 2 ? 1 : 1 - u;
      if (s.st === 2) { cm.mesh.setMatrixAt(s.idx, this.zero); continue; }
      const bob = Math.sin(this.time * 1.5 + s.ph) * 0.04;
      if (s.otter) {
        // on its back, slow spin, an occasional full roll
        s.yaw += Math.sin(this.time * 0.15 + s.ph) * 0.25 * dt;
        if (s.st === 0 && s.rollT <= 0 && Math.random() < dt * 0.08) s.rollT = 1.2;
        if (s.rollT > 0) { s.rollT -= dt; s.roll = (1 - Math.max(0, s.rollT) / 1.2) * TAU; } else s.roll = 0;
        this.put(cm, s.idx, s.x, 0.02 + bob - sink * 0.5, s.z, Math.sin(this.time * 1.1 + s.ph) * 0.06, s.yaw, s.roll, 1);
        cm.anim.setXYZW(s.idx, this.time * 3 + s.ph, 0.25, 0, 0);
      } else {
        // head turning slowly, looking around
        const look = Math.sin(this.time * 0.35 + s.ph) * 0.9 + Math.sin(this.time * 0.9 + s.ph * 2) * 0.25;
        this.put(cm, s.idx, s.x, -0.02 + bob - sink * 0.75, s.z, -0.15 + Math.sin(this.time * 0.6 + s.ph) * 0.08, s.yaw + look, 0, 1);
      }
    }
    if (dirty) {
      for (const cm of [this.seals, this.otters]) { cm.mesh.instanceMatrix.needsUpdate = true; cm.anim.needsUpdate = true; }
    }
  }

  /** Position on the route polyline at distance s (ping-pong handled by the caller). */
  private routeAt(s: number, out: THREE.Vector3) {
    const L = this.routeLen, R = this.route;
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const seg = L[i] - L[i - 1] || 1;
    const u = Math.max(0, Math.min(1, (s - L[i - 1]) / seg));
    out.set(R[i - 1][0] + (R[i][0] - R[i - 1][0]) * u, 0, R[i - 1][1] + (R[i][1] - R[i - 1][1]) * u);
    return Math.atan2(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]);
  }

  private updatePod(dt: number, cam: THREE.Vector3) {
    if (!this.pod.length) return;
    const total = this.routeLen[this.routeLen.length - 1];
    this.podS += this.podDir * 3.2 * dt;
    if (this.podS > total) { this.podS = total; this.podDir = -1; }
    if (this.podS < 0) { this.podS = 0; this.podDir = 1; }
    this.routeAt(this.podS, this.v);
    if (Math.hypot(this.v.x - cam.x, this.v.z - cam.z) > NEAR) {
      if (!this.podHidden) {
        for (const p of this.pod) this.pods.mesh.setMatrixAt(p.idx, this.zero);
        this.pods.mesh.instanceMatrix.needsUpdate = true;
        this.podHidden = true;
      }
      return;
    }
    this.podHidden = false;
    for (const p of this.pod) {
      const s = Math.max(0, Math.min(total, this.podS - this.podDir * p.lag));
      let yaw = this.routeAt(s, this.v);
      if (this.podDir < 0) yaw += Math.PI;
      const x = this.v.x + Math.cos(yaw) * p.off, z = this.v.z - Math.sin(yaw) * p.off;
      if (this.land.blocked(x, z)) { this.pods.mesh.setMatrixAt(p.idx, this.zero); continue; }
      p.t += dt;
      if (p.t > p.dur + p.gap) { p.t = 0; p.gap = rand(2.2, 4.5); p.splashed = 0; }
      if (p.t > p.dur) { this.pods.mesh.setMatrixAt(p.idx, this.zero); continue; }
      const u = p.t / p.dur;
      const y = -0.95 + Math.sin(Math.PI * u) * 1.15;
      if (p.splashed === 0 && u > 0.2) { this.splash.ring(x, z, 0.6); p.splashed = 1; }
      if (p.splashed === 1 && u > 0.8) { this.splash.splash(x, z, 0.3); p.splashed = 2; }
      this.put(this.pods, p.idx, x, y, z, -Math.cos(Math.PI * u) * 0.7, yaw, 0, 1);
      this.pods.anim.setXYZW(p.idx, this.time * 7 + p.idx, 0.35, 0, 0);
    }
    this.pods.mesh.instanceMatrix.needsUpdate = true;
    this.pods.anim.needsUpdate = true;
  }
}
