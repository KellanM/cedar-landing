import * as THREE from 'three';
import { register } from '../render/materials';

const SHARDS = 220;
const FOAM = 64;
const CROWNS = 8;
const GRAVITY = 9.8;
const SEA_Y = -0.06;

/** Low-poly splash crown: an open, jagged ring of upright blades (cream outside, white rim). */
function crownGeometry() {
  const n = 9, pos: number[] = [], col: number[] = [];
  const outer = new THREE.Color(0xe9f1ef), rim = new THREE.Color(0xffffff), inner = new THREE.Color(0xb9cfd0);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const h = i % 2 ? 0.75 : 1; // alternating blade heights → jagged rim
    const x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
    const xt = Math.cos(am) * 1.25, zt = Math.sin(am) * 1.25; // blades flare outward
    pos.push(x0, 0, z0, x1, 0, z1, xt, h, zt);
    const c = i % 3 === 0 ? inner : outer;
    col.push(c.r, c.g, c.b, c.r, c.g, c.b, rim.r, rim.g, rim.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Flat irregular foam blob (7-gon) lying on the water. */
export function blobGeometry(seed = 0) {
  const n = 7, pos: number[] = [];
  const r = [1, 0.8, 0.95, 0.7, 1.05, 0.85, 0.9];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const r0 = r[(i + seed) % n], r1 = r[(i + 1 + seed) % n];
    pos.push(0, 0, 0, Math.cos(a1) * r1, 0, Math.sin(a1) * r1, Math.cos(a0) * r0, 0, Math.sin(a0) * r0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
const FOAM_TONES = [new THREE.Color(0xfbfcf8), new THREE.Color(0xe4efee), new THREE.Color(0xf3f6f1)];

/**
 * Pooled water splashes: flat white shards (one InstancedMesh) thrown up and falling back, plus
 * an expanding, fading ring. The fishing FX also uses splash crowns (low-poly jagged ring that
 * rises and slumps) and lingering two-tone foam discs. Pools are hidden while empty (no draw call).
 * No allocation after construction.
 */
export class SplashFX {
  group = new THREE.Group();
  private shards: THREE.InstancedMesh;
  private sp = new Float32Array(SHARDS * 3); // position
  private sv = new Float32Array(SHARDS * 3); // velocity
  private ss = new Float32Array(SHARDS * 2); // size, spin
  private sl = new Uint8Array(SHARDS); // alive
  private next = 0;
  private alive = 0;
  private rings: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; dur: number; size: number }[] = [];
  private nextRing = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private foamM: THREE.InstancedMesh;
  private fp = new Float32Array(FOAM * 4); // x, z, size, spin
  private ft = new Float32Array(FOAM * 2); // age, life
  private nextFoam = 0;
  private foamAlive = 0;
  private crownM: THREE.InstancedMesh;
  private cp = new Float32Array(CROWNS * 4); // x, z, size, progress (≥1 = dead)
  private crownAlive = 0;
  private nextCrown = 0;

  constructor(private RINGS = 12) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.09, 0, -0.06, -0.05, 0, 0.06, -0.05, 0], 3));
    const mat = register(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    this.shards = new THREE.InstancedMesh(g, mat, SHARDS);
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shards.frustumCulled = false;
    for (let i = 0; i < SHARDS; i++) this.shards.setMatrixAt(i, this.zero);
    this.group.add(this.shards);

    this.foamM = new THREE.InstancedMesh(blobGeometry(), register(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false })), FOAM);
    this.foamM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foamM.frustumCulled = false;
    this.foamM.renderOrder = 2;
    for (let i = 0; i < FOAM; i++) { this.foamM.setMatrixAt(i, this.zero); this.foamM.setColorAt(i, FOAM_TONES[i % 3]); }
    this.foamM.visible = false;
    this.crownM = new THREE.InstancedMesh(crownGeometry(), register(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })), CROWNS);
    this.crownM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.crownM.frustumCulled = false;
    for (let i = 0; i < CROWNS; i++) { this.crownM.setMatrixAt(i, this.zero); this.cp[i * 4 + 3] = 1; }
    this.crownM.visible = false;
    this.group.add(this.foamM, this.crownM);

    const rg = new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2);
    for (let i = 0; i < this.RINGS; i++) {
      const rm = new THREE.MeshBasicMaterial({ color: 0xf4f6f2, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(rg, rm);
      m.visible = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.rings.push({ m, mat: rm, t: 1, dur: 1, size: 1 });
    }
  }

  /** A splash at the water surface. size 1 ≈ diving gull, 0.4 ≈ small fish. */
  splash(x: number, z: number, size = 1) {
    const n = Math.round(6 + size * 8);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % SHARDS;
      if (!this.sl[i]) this.alive++;
      this.sl[i] = 1;
      const a = Math.random() * Math.PI * 2, out = (0.6 + Math.random() * 1.6) * Math.sqrt(size);
      this.sp[i * 3] = x + Math.cos(a) * 0.15 * size;
      this.sp[i * 3 + 1] = 0.05;
      this.sp[i * 3 + 2] = z + Math.sin(a) * 0.15 * size;
      this.sv[i * 3] = Math.cos(a) * out;
      this.sv[i * 3 + 1] = (2.2 + Math.random() * 2.6) * Math.sqrt(size);
      this.sv[i * 3 + 2] = Math.sin(a) * out;
      this.ss[i * 2] = (0.7 + Math.random() * 0.9) * (0.6 + size * 0.5);
      this.ss[i * 2 + 1] = (Math.random() - 0.5) * 18;
    }
    this.ring(x, z, size);
  }

  /** Bow spray: a few shards thrown sideways (vx,vz) and up. */
  spray(x: number, z: number, vx: number, vz: number, n = 2) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % SHARDS;
      if (!this.sl[i]) this.alive++;
      this.sl[i] = 1;
      const j = 0.7 + Math.random() * 0.6;
      this.sp[i * 3] = x; this.sp[i * 3 + 1] = 0.1; this.sp[i * 3 + 2] = z;
      this.sv[i * 3] = vx * j + (Math.random() - 0.5) * 0.4;
      this.sv[i * 3 + 1] = 1.4 + Math.random() * 1.4;
      this.sv[i * 3 + 2] = vz * j + (Math.random() - 0.5) * 0.4;
      this.ss[i * 2] = 0.5 + Math.random() * 0.5;
      this.ss[i * 2 + 1] = (Math.random() - 0.5) * 18;
    }
  }

  /** Droplets from a point in the air (line water-shed, a breaching fish): velocity + random cone. */
  throwAt(x: number, y: number, z: number, vx: number, vy: number, vz: number, n: number, spread = 1, size = 0.7) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % SHARDS;
      if (!this.sl[i]) this.alive++;
      this.sl[i] = 1;
      this.sp[i * 3] = x; this.sp[i * 3 + 1] = y; this.sp[i * 3 + 2] = z;
      this.sv[i * 3] = vx + (Math.random() - 0.5) * spread;
      this.sv[i * 3 + 1] = vy + Math.random() * spread;
      this.sv[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      this.ss[i * 2] = size * (0.6 + Math.random() * 0.7);
      this.ss[i * 2 + 1] = (Math.random() - 0.5) * 18;
    }
  }

  /** Flat foam discs scattered within `radius`, each ≈ `size` m across, lingering ≈ `life` s. */
  foam(x: number, z: number, n: number, radius: number, size: number, life = 1.2) {
    for (let k = 0; k < n; k++) {
      const i = this.nextFoam;
      this.nextFoam = (this.nextFoam + 1) % FOAM;
      if (this.ft[i * 2] >= this.ft[i * 2 + 1]) this.foamAlive++;
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius;
      this.fp[i * 4] = x + Math.cos(a) * d; this.fp[i * 4 + 1] = z + Math.sin(a) * d;
      this.fp[i * 4 + 2] = size * (0.45 + Math.random() * 0.75); this.fp[i * 4 + 3] = Math.random() * 6.28;
      this.ft[i * 2] = 0; this.ft[i * 2 + 1] = life * (0.7 + Math.random() * 0.6);
    }
    this.foamM.visible = true;
  }

  /** A low-poly splash crown: rises fast (≈ 120 ms), then slumps back into the water. */
  crown(x: number, z: number, size = 1) {
    const i = this.nextCrown;
    this.nextCrown = (this.nextCrown + 1) % CROWNS;
    if (this.cp[i * 4 + 3] >= 1) this.crownAlive++;
    this.cp[i * 4] = x; this.cp[i * 4 + 1] = z; this.cp[i * 4 + 2] = size; this.cp[i * 4 + 3] = 0;
    this.crownM.visible = true;
  }

  /** The full fishing splash: crown + droplets + lingering foam discs + ring. */
  burst(x: number, z: number, size = 1, drops = 12) {
    this.crown(x, z, size);
    this.ring(x, z, size);
    this.throwAt(x, 0.05, z, 0, 2.4 * Math.sqrt(size), 0, drops, 2.2 * Math.sqrt(size), 0.7 + size * 0.4);
    this.foam(x, z, Math.round(5 + size * 6), 0.35 + size * 0.6, 0.12 + size * 0.14, 0.9 + size * 0.6);
  }

  ring(x: number, z: number, size = 1) {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.RINGS;
    r.t = 0;
    r.dur = 0.9 + size * 0.5;
    r.size = size;
    r.m.position.set(x, 0.05, z);
    r.m.visible = true;
  }

  update(dt: number) {
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar((0.25 + Math.sqrt(k) * 2.2) * r.size);
      r.mat.opacity = 0.75 * (1 - k);
    }
    if (this.foamAlive) {
      for (let i = 0; i < FOAM; i++) {
        const life = this.ft[i * 2 + 1];
        if (this.ft[i * 2] >= life) continue;
        this.ft[i * 2] += dt;
        const k = this.ft[i * 2] / life;
        if (k >= 1) { this.foamAlive--; this.foamM.setMatrixAt(i, this.zero); continue; }
        // pop in fast, spread a little, then shrink away (no alpha fade: flat style)
        const sc = this.fp[i * 4 + 2] * Math.min(1, k * 8) * (1 + k * 0.5) * (1 - k * k);
        this.e.set(0, this.fp[i * 4 + 3] + k * 0.6, 0);
        this.q.setFromEuler(this.e);
        this.v.set(this.fp[i * 4], SEA_Y + 0.035, this.fp[i * 4 + 1]);
        this.s.set(sc, 1, sc);
        this.m.compose(this.v, this.q, this.s);
        this.foamM.setMatrixAt(i, this.m);
      }
      this.foamM.instanceMatrix.needsUpdate = true;
      if (!this.foamAlive) this.foamM.visible = false;
    }
    if (this.crownAlive) {
      for (let i = 0; i < CROWNS; i++) {
        if (this.cp[i * 4 + 3] >= 1) continue;
        const size = this.cp[i * 4 + 2];
        this.cp[i * 4 + 3] += dt / (0.45 + size * 0.15);
        const k = this.cp[i * 4 + 3];
        if (k >= 1) { this.crownAlive--; this.crownM.setMatrixAt(i, this.zero); continue; }
        // rise in the first 25 %, slump after; the radius keeps opening
        const up = k < 0.25 ? 1 - Math.pow(1 - k / 0.25, 3) : 1 - Math.pow((k - 0.25) / 0.75, 1.6);
        const r = (0.35 + Math.sqrt(k) * 0.55) * size;
        this.v.set(this.cp[i * 4], SEA_Y, this.cp[i * 4 + 1]);
        this.q.identity();
        this.s.set(r, Math.max(0.001, up * 0.7 * size), r);
        this.m.compose(this.v, this.q, this.s);
        this.crownM.setMatrixAt(i, this.m);
      }
      this.crownM.instanceMatrix.needsUpdate = true;
      if (!this.crownAlive) this.crownM.visible = false;
    }
    if (!this.alive) return;
    for (let i = 0; i < SHARDS; i++) {
      if (!this.sl[i]) continue;
      const o = i * 3;
      this.sv[o + 1] -= GRAVITY * dt;
      this.sp[o] += this.sv[o] * dt;
      this.sp[o + 1] += this.sv[o + 1] * dt;
      this.sp[o + 2] += this.sv[o + 2] * dt;
      if (this.sp[o + 1] < 0 && this.sv[o + 1] < 0) {
        this.sl[i] = 0;
        this.alive--;
        this.shards.setMatrixAt(i, this.zero);
        continue;
      }
      const spin = this.ss[i * 2 + 1] * this.sp[o + 1];
      this.e.set(spin, spin * 0.7, spin * 0.3);
      this.q.setFromEuler(this.e);
      this.v.set(this.sp[o], this.sp[o + 1], this.sp[o + 2]);
      this.s.setScalar(this.ss[i * 2]);
      this.m.compose(this.v, this.q, this.s);
      this.shards.setMatrixAt(i, this.m);
    }
    this.shards.instanceMatrix.needsUpdate = true;
  }
}
