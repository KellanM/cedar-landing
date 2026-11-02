import * as THREE from 'three';
import { register } from '../render/materials';

const SHARDS = 220;
const RINGS = 12;
const GRAVITY = 9.8;

/**
 * Pooled water splashes: flat white shards (one InstancedMesh) thrown up and falling back, plus
 * an expanding, fading ring. No allocation after construction.
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

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.09, 0, -0.06, -0.05, 0, 0.06, -0.05, 0], 3));
    const mat = register(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    this.shards = new THREE.InstancedMesh(g, mat, SHARDS);
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shards.frustumCulled = false;
    for (let i = 0; i < SHARDS; i++) this.shards.setMatrixAt(i, this.zero);
    this.group.add(this.shards);

    const rg = new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2);
    for (let i = 0; i < RINGS; i++) {
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

  ring(x: number, z: number, size = 1) {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % RINGS;
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
