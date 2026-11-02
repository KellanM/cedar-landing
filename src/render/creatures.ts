import * as THREE from 'three';
import { register } from './materials';

/**
 * Procedural low-poly wildlife: flat-coloured, unlit, non-indexed geometry (one colour per
 * face) drawn as InstancedMeshes with one shared animated material.
 *
 * Every creature geometry has an `aSeg` vertex attribute that says how the vertex shader
 * moves it, and every InstancedMesh has a per-instance `aAnim` vec4:
 *   aAnim = (phase, amplitude, fold, headYaw)
 *   aSeg 0 = rigid body
 *   aSeg 1 = inner wing, 2 = outer wing (flap = amp*sin(phase), fold tucks the wing back)
 *   aSeg 3 = head (yaws about the neck by headYaw)
 *   aSeg 4 = tail, side-to-side wag (fish, otter)
 *   aSeg 5 = tail, up-and-down beat (porpoise)
 * All creatures face +Z with +Y up, origin at the body centre (birds: on the waterline).
 */

// Bird rig constants (metres, unscaled): shoulder x, wing plane y, elbow x, neck z.
const SH = 0.05, WY = 0.04, EL = 0.32, NZ = 0.17;

export const creatureMat = register(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
creatureMat.onBeforeCompile = (s) => {
  s.vertexShader = s.vertexShader
    .replace('void main() {', 'attribute vec4 aAnim;\nattribute float aSeg;\nvoid main() {')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 p = transformed;
        if (aSeg > 0.5 && aSeg < 2.5) {
          float sd = p.x < 0.0 ? -1.0 : 1.0;
          float fold = aAnim.z;
          float d = abs(p.x) - ${SH.toFixed(3)};
          p.z -= d * fold * 0.5;
          float span = 1.0 - 0.85 * fold;
          vec2 q = vec2(d * span, p.y - ${WY.toFixed(3)});
          float a = aAnim.y * sin(aAnim.x) + 0.1 - 0.35 * fold;
          if (aSeg > 1.5) {
            float a2 = aAnim.y * 0.7 * sin(aAnim.x - 0.8);
            vec2 e = vec2(${(EL - SH).toFixed(3)} * span, 0.0);
            vec2 r = q - e;
            float c2 = cos(a2), s2 = sin(a2);
            q = e + vec2(r.x * c2 - r.y * s2, r.x * s2 + r.y * c2);
          }
          float c = cos(a), sn = sin(a);
          q = vec2(q.x * c - q.y * sn, q.x * sn + q.y * c);
          p.x = sd * (${SH.toFixed(3)} + q.x);
          p.y = ${WY.toFixed(3)} + q.y;
        } else if (aSeg > 2.5 && aSeg < 3.5) {
          vec2 h = vec2(p.x, p.z - ${NZ.toFixed(3)});
          float c = cos(aAnim.w), sn = sin(aAnim.w);
          p.x = h.x * c + h.y * sn;
          p.z = ${NZ.toFixed(3)} - h.x * sn + h.y * c;
        } else if (aSeg > 3.5 && aSeg < 4.5) {
          p.x += sin(aAnim.x) * aAnim.y * max(0.0, -p.z);
        } else if (aSeg > 4.5) {
          p.y += sin(aAnim.x) * aAnim.y * max(0.0, -p.z - 0.2);
        }
        transformed = p;
      }`,
    );
};
creatureMat.customProgramCacheKey = () => 'creature-v2';

type V = [number, number, number];

/** Collects flat-coloured triangles (non-indexed) with a per-vertex segment id. */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  seg: number[] = [];
  private c = new THREE.Color();
  tri(a: V, b: V, c: V, color: number, seg: number | ((v: V) => number) = 0) {
    this.c.setHex(color, THREE.SRGBColorSpace);
    for (const v of [a, b, c]) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.seg.push(typeof seg === 'number' ? seg : seg(v));
    }
  }
  quad(a: V, b: V, c: V, d: V, color: number, seg: number | ((v: V) => number) = 0) {
    this.tri(a, b, c, color, seg);
    this.tri(a, c, d, color, seg);
  }
  /** Loft between two 4-point rings (top, right, bottom, left); upper faces get `up`, lower `low`. */
  loft(ra: V[], rb: V[], up: number, low: number, seg = 0, sideUp = true) {
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      const upper = k === 0 || k === 3; // top-right and left-top faces
      this.quad(ra[k], ra[k2], rb[k2], rb[k], upper && sideUp ? up : low, seg);
    }
  }
  cap(r: V[], tip: V, up: number, low: number, seg = 0) {
    for (let k = 0; k < 4; k++) this.tri(r[k], r[(k + 1) % 4], tip, k === 0 || k === 3 ? up : low, seg);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSeg', new THREE.Float32BufferAttribute(this.seg, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const ring = (z: number, top: number, side: number, bottom: number, sy = 0): V[] => [
  [0, top, z], [-side, sy, z], [0, bottom, z], [side, sy, z],
];

export interface BirdPalette { body: number; back: number; wing: number; tip: number; head: number; bill: number; tail: number; eye: number }

export const BIRD_PALETTES: Record<string, BirdPalette> = {
  // glaucous-winged / herring gull: white body, grey mantle and wings, black tips, yellow bill
  gull: { body: 0xf3f3ee, back: 0xa7b3b9, wing: 0xb4bfc4, tip: 0x202326, head: 0xf7f7f3, bill: 0xe9c43f, tail: 0xecece6, eye: 0x1b1d1f },
  cormorant: { body: 0x23272b, back: 0x2f3539, wing: 0x2a2f33, tip: 0x17191b, head: 0x26292c, bill: 0xd9963a, tail: 0x1e2124, eye: 0x7fb38a },
  eagle: { body: 0x4b3527, back: 0x3e2c20, wing: 0x45311f, tip: 0x2a1e15, head: 0xf2f0ea, bill: 0xe7bf3c, tail: 0xf0eee6, eye: 0x1b1d1f },
  heron: { body: 0x9aa6af, back: 0x7f8c97, wing: 0x8a97a1, tip: 0x2e343a, head: 0xe4e7e5, bill: 0xd7ae48, tail: 0x8e9aa4, eye: 0x1b1d1f },
};

/** ~50-tri bird. Body length ~0.6 m, span ~1.3 m before instance scale. */
export function birdGeometry(p: BirdPalette, legs = 0) {
  const b = new Builder();
  if (legs > 0) {
    // wader legs (heron): two thin crossed quads per leg under the body
    const leg = 0x3a3d3b;
    for (const sx of [-0.025, 0.025]) {
      b.quad([sx - 0.008, -0.04, -0.03], [sx + 0.008, -0.04, -0.03], [sx + 0.006, -legs, -0.05], [sx - 0.006, -legs, -0.05], leg);
      b.quad([sx, -0.04, -0.038], [sx, -0.04, -0.022], [sx, -legs, -0.042], [sx, -legs, -0.058], leg);
    }
  }
  const s0 = ring(0.15, 0.06, 0.05, -0.045, 0.005);
  const s1 = ring(-0.02, 0.08, 0.075, -0.065, 0.01);
  const s2 = ring(-0.2, 0.035, 0.035, -0.015, 0.01);
  b.cap(s0, [0, 0.02, 0.2], p.body, p.body);
  // cap() winds r[k]→r[k+1]→tip; reverse rings for the faces pointing backwards
  b.loft(s0, s1, p.back, p.body);
  b.loft(s1, s2, p.back, p.body);
  b.cap(s2, [0, 0.015, -0.26], p.back, p.body);
  // tail fan
  b.quad([-0.035, 0.022, -0.19], [0.035, 0.022, -0.19], [0.065, 0.02, -0.35], [-0.065, 0.02, -0.35], p.tail);
  // head (seg 3): octahedron + bill + eyes
  const HT: V = [0, 0.152, 0.21], HB: V = [0, 0.03, 0.2], HL: V = [-0.043, 0.1, 0.215], HR: V = [0.043, 0.1, 0.215];
  const HF: V = [0, 0.1, 0.282], HK: V = [0, 0.07, 0.12];
  for (const [a, c] of [[HT, HR], [HR, HB], [HB, HL], [HL, HT]] as [V, V][]) {
    b.tri(a, c, HF, p.head, 3);
    b.tri(c, a, HK, p.head, 3);
  }
  const b1: V = [-0.015, 0.1, 0.272], b2: V = [0.015, 0.1, 0.272], b3: V = [0, 0.079, 0.268], bt: V = [0, 0.088, 0.355];
  b.tri(b1, b2, bt, p.bill, 3);
  b.tri(b2, b3, bt, p.bill, 3);
  b.tri(b3, b1, bt, p.bill, 3);
  for (const sx of [-1, 1]) {
    b.tri([sx * 0.04, 0.118, 0.245], [sx * 0.04, 0.104, 0.236], [sx * 0.037, 0.115, 0.23], p.eye, 3);
  }
  // wings (seg 1 inner, 2 outer, from |x|)
  const wseg = (v: V) => (Math.abs(v[0]) > EL + 0.01 ? 2 : 1);
  for (const s of [-1, 1]) {
    const shL: V = [s * SH, WY, 0.09], shT: V = [s * SH, WY, -0.1];
    const elL: V = [s * EL, WY, 0.1], elT: V = [s * EL, WY, -0.09];
    const mdL: V = [s * 0.47, WY, 0.075], mdT: V = [s * 0.47, WY, -0.06];
    const tip: V = [s * 0.65, WY, -0.03], tipT: V = [s * 0.58, WY, -0.075];
    b.quad(shL, elL, elT, shT, p.wing, wseg);
    b.quad(elL, mdL, mdT, elT, p.wing, wseg);
    b.tri(mdL, tip, tipT, p.tip, wseg);
    b.tri(mdL, tipT, mdT, p.tip, wseg);
  }
  return b.build();
}

/** Small forage fish (~0.3 m), seg 4 tail wag. */
export function fishGeometry() {
  const b = new Builder();
  const back = 0x5f7b86, belly = 0xdfe6e4, fin = 0x4b636c;
  const s = ring(0.03, 0.05, 0.026, -0.04);
  b.cap(s, [0, 0, 0.16], back, belly, 4);
  b.loft(s, ring(-0.09, 0.02, 0.012, -0.015), back, belly, 4);
  b.cap(ring(-0.09, 0.02, 0.012, -0.015), [0, 0, -0.11], back, belly, 4);
  b.tri([0, 0.002, -0.1], [0, 0.065, -0.18], [0, -0.06, -0.18], fin, 4);
  b.tri([0, 0.045, 0.04], [0, 0.085, -0.03], [0, 0.03, -0.05], fin, 4);
  return b.build();
}

/** Dall's porpoise (~1.9 m): black with white flank patch and white-tipped fin. seg 5 fluke beat. */
export function porpoiseGeometry() {
  const b = new Builder();
  const black = 0x1d2125, white = 0xe8ebe8, finTip = 0xc9cfcf;
  const s0 = ring(0.62, 0.17, 0.16, -0.15);
  const s1 = ring(0.0, 0.27, 0.25, -0.23);
  const s2 = ring(-0.55, 0.11, 0.1, -0.08);
  b.cap(s0, [0, 0, 0.92], black, black);
  b.loft(s0, s1, black, black);
  // flank patch: lower faces of the rear half are white
  b.loft(s1, s2, black, white, 5);
  b.cap(s2, [0, 0.01, -0.82], black, black, 5);
  b.tri([0, 0.0, -0.8], [-0.3, 0.0, -1.0], [0, 0, -0.92], black, 5);
  b.tri([0, 0.0, -0.8], [0, 0, -0.92], [0.3, 0.0, -1.0], black, 5);
  b.tri([0, 0.25, 0.14], [0, 0.23, -0.2], [0, 0.47, -0.13], black);
  b.tri([0, 0.4, -0.08], [0, 0.36, -0.17], [0, 0.47, -0.13], finTip);
  return b.build();
}

/** Harbour seal head poking out of the water (~0.5 m tall), dappled grey. */
export function sealGeometry() {
  const b = new Builder();
  const g1 = 0x6e706a, g2 = 0x585a53, snout = 0x60615a, nose = 0x1a1b1c;
  const n = 6;
  const rings: [number, number][] = [[-0.45, 0.17], [-0.05, 0.16], [0.12, 0.13], [0.22, 0.07]];
  const pt = (i: number, ry: [number, number]): V => {
    const a = (i / n) * Math.PI * 2;
    return [Math.sin(a) * ry[1], ry[0], Math.cos(a) * ry[1] * 1.05];
  };
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) b.quad(pt(i, rings[r]), pt(i + 1, rings[r]), pt(i + 1, rings[r + 1]), pt(i, rings[r + 1]), (i + r) % 2 ? g1 : g2);
  }
  for (let i = 0; i < n; i++) b.tri(pt(i, rings[3]), pt(i + 1, rings[3]), [0, 0.25, 0.0], (i % 2) ? g1 : g2);
  // snout
  const sL: V = [-0.06, 0.1, 0.12], sR: V = [0.06, 0.1, 0.12], sB: V = [0, 0.01, 0.13], sT: V = [0, 0.06, 0.25];
  b.tri(sL, sR, sT, snout);
  b.tri(sR, sB, sT, snout);
  b.tri(sB, sL, sT, snout);
  b.tri([-0.018, 0.075, 0.245], [0.018, 0.075, 0.245], [0, 0.05, 0.26], nose);
  for (const sx of [-1, 1]) b.tri([sx * 0.085, 0.14, 0.11], [sx * 0.105, 0.125, 0.09], [sx * 0.09, 0.155, 0.085], nose);
  return b.build();
}

/** River otter floating on its back (~1 m incl. tail), seg 4 tail wag. */
export function otterGeometry() {
  const b = new Builder();
  const fur = 0x5a4230, belly = 0x7a5e43, face = 0x9c8669, nose = 0x1a1b1c;
  const s0 = ring(0.22, 0.09, 0.11, -0.07);
  const s1 = ring(-0.12, 0.08, 0.1, -0.07);
  const s2 = ring(-0.3, 0.03, 0.04, -0.03);
  // head
  b.cap(ring(0.22, 0.09, 0.11, -0.07), [0, 0.04, 0.42], face, fur);
  b.loft(s0, s1, belly, fur);
  b.loft(s1, s2, belly, fur, 4);
  b.cap(s2, [0, 0, -0.62], fur, fur, 4);
  b.tri([-0.02, 0.06, 0.41], [0.02, 0.06, 0.41], [0, 0.03, 0.43], nose);
  // paws folded on the chest
  b.tri([-0.06, 0.1, 0.12], [0.06, 0.1, 0.12], [0, 0.12, 0.2], fur);
  return b.build();
}

export interface CreatureMesh {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  n: number;
}

/** One InstancedMesh for `n` creatures; all instances start hidden (zero scale). */
export function creatureMesh(geom: THREE.BufferGeometry, n: number): CreatureMesh {
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('aAnim', anim);
  const mesh = new THREE.InstancedMesh(geom, creatureMat, Math.max(1, n));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // instances span the whole map
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, zero);
  return { mesh, anim, n };
}
