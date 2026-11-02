import * as THREE from 'three';
import { register } from './materials';
import type { Vec3 } from '../world/types';

/** Shared wind (m/s, xz) for smoke drift and fog banks. */
export const WIND = new THREE.Vector2(0.75, 0.4);

export type SmokeKind = 'chimney' | 'stack' | 'smokehole' | 'burner' | 'steam' | 'boat';
export interface SmokeSpawn { pos: Vec3; size?: number; kind?: string }

interface KindSpec { rate: number; size: number; rise: number; life: number; color: number; spread: number; drift: number }
const KINDS: Record<SmokeKind, KindSpec> = {
  chimney: { rate: 1.3, size: 0.55, rise: 0.9, life: 5.5, color: 0xd5d8d6, spread: 0.15, drift: 1 },
  stack: { rate: 2.0, size: 0.8, rise: 1.2, life: 6.5, color: 0xa9adac, spread: 0.2, drift: 1 },
  smokehole: { rate: 0.9, size: 0.6, rise: 0.7, life: 5, color: 0xc4cbcd, spread: 0.3, drift: 0.8 },
  // wigwam burner: a tall dense column that only bends with height
  burner: { rate: 7, size: 1.4, rise: 2.4, life: 10, color: 0x7f8384, spread: 0.35, drift: 0.55 },
  steam: { rate: 2.2, size: 0.5, rise: 1.4, life: 2.6, color: 0xf3f5f4, spread: 0.12, drift: 1.2 },
  boat: { rate: 0.7, size: 0.18, rise: 1.3, life: 2.6, color: 0xc4c7c6, spread: 0.05, drift: 1.4 },
};
function kindOf(k?: string): SmokeKind {
  const s = (k ?? '').toLowerCase();
  return (s in KINDS ? s : s.includes('burn') ? 'burner' : s.includes('steam') ? 'steam' : s.includes('hole') ? 'smokehole' : s.includes('stack') ? 'stack' : 'chimney') as SmokeKind;
}

interface Emitter { x: number; y: number; z: number; size: number; spec: KindSpec; acc: number; color: THREE.Color }

/** Faceted icosahedron with the facet shading baked into vertex colours (reads 3D while unlit). */
function puffGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const L = new THREE.Vector3(0.4, 0.85, 0.35).normalize();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const shade = 0.74 + 0.26 * Math.max(0, n.dot(L));
    for (let k = 0; k < 3; k++) col.set([shade, shade, shade], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

/**
 * Pooled smoke puffs: flat-faceted opaque blobs that rise, drift with WIND, grow, then shrink
 * away (no transparency). One InstancedMesh; per-instance colour per emitter kind.
 */
export class SmokeFX {
  mesh: THREE.InstancedMesh;
  private cap: number;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vy: Float32Array; private age: Float32Array; private life: Float32Array; private sz: Float32Array;
  private drift: Float32Array; private spin: Float32Array;
  private alive: Uint8Array;
  private next = 0;
  private emitters: Emitter[] = [];
  private boatEm: Emitter;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(spawns: SmokeSpawn[] | undefined, low: boolean) {
    this.cap = low ? 220 : 440;
    const n = this.cap;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vy = new Float32Array(n); this.age = new Float32Array(n); this.life = new Float32Array(n); this.sz = new Float32Array(n);
    this.drift = new Float32Array(n); this.spin = new Float32Array(n); this.alive = new Uint8Array(n);
    this.mesh = new THREE.InstancedMesh(puffGeometry(), register(new THREE.MeshBasicMaterial({ vertexColors: true })), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'smoke';
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) { this.mesh.setMatrixAt(i, this.zero); this.mesh.setColorAt(i, white); }
    const mk = (p: Vec3, size: number, kind: SmokeKind): Emitter =>
      ({ x: p[0], y: p[1], z: p[2], size, spec: KINDS[kind], acc: Math.random(), color: new THREE.Color(KINDS[kind].color) });
    for (const sp of spawns ?? []) {
      const k = kindOf(sp.kind);
      // export `size` is the old static smoke mesh's extent (m): map it to a puff scale
      this.emitters.push(mk(sp.pos, Math.max(0.4, Math.min(3, (sp.size ?? 3) * 0.35)), k));
    }
    this.boatEm = mk([0, 0, 0], 1, 'boat');
  }

  /** Add an emitter at runtime (debug / scripted events). */
  addEmitter(pos: Vec3, size = 1, kind?: string) {
    const k = kindOf(kind);
    this.emitters.push({ x: pos[0], y: pos[1], z: pos[2], size, spec: KINDS[k], acc: 0, color: new THREE.Color(KINDS[k].color) });
  }

  get emitterCount() { return this.emitters.length; }

  private emit(em: Emitter, rateMul = 1) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const sp = em.spec;
    this.alive[i] = 1;
    this.px[i] = em.x + (Math.random() - 0.5) * sp.spread * em.size * 2;
    this.py[i] = em.y;
    this.pz[i] = em.z + (Math.random() - 0.5) * sp.spread * em.size * 2;
    this.vy[i] = sp.rise * (0.8 + Math.random() * 0.4) * (0.8 + rateMul * 0.2);
    this.age[i] = 0;
    this.life[i] = sp.life * (0.8 + Math.random() * 0.4);
    this.sz[i] = sp.size * em.size * (0.8 + Math.random() * 0.4);
    this.drift[i] = sp.drift;
    this.spin[i] = Math.random() * 6.28;
    this.mesh.setColorAt(i, em.color);
  }

  /** boatStack: world position of the boat's funnel (or null); throttle 0..1 raises the puff rate. */
  update(dt: number, cam: THREE.Vector3, boatStack: THREE.Vector3 | null, throttle: number) {
    let colors = false;
    for (const em of this.emitters) {
      if (Math.abs(em.x - cam.x) > 650 || Math.abs(em.z - cam.z) > 650) continue;
      em.acc += dt * em.spec.rate;
      while (em.acc >= 1) { em.acc -= 1; this.emit(em); colors = true; }
    }
    if (boatStack) {
      const b = this.boatEm;
      b.x = boatStack.x; b.y = boatStack.y; b.z = boatStack.z;
      const rate = 0.7 + throttle * 3.5;
      b.acc += dt * rate;
      while (b.acc >= 1) { b.acc -= 1; this.emit(b, 1 + throttle * 0.4); colors = true; }
    }
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      if (k >= 1) { this.alive[i] = 0; this.mesh.setMatrixAt(i, this.zero); continue; }
      this.vy[i] *= Math.exp(-dt * 0.25); // rising slows down
      this.py[i] += this.vy[i] * dt;
      const d = this.drift[i] * (0.4 + k * 1.2) * dt;
      this.px[i] += WIND.x * d;
      this.pz[i] += WIND.y * d;
      // grow, then shrink away over the last 30%
      const s = this.sz[i] * (0.45 + 1.4 * Math.sqrt(k)) * (k < 0.7 ? 1 : (1 - k) / 0.3);
      this.e.set(this.spin[i] + k * 1.2, this.spin[i] * 0.5, k * 0.8);
      this.q.setFromEuler(this.e);
      this.v.set(this.px[i], this.py[i], this.pz[i]);
      this.s.set(s, s * 0.85, s);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colors && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
