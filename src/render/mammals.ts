import * as THREE from 'three';
import { register } from './materials';
import { WIND } from './smoke';

/**
 * Procedural low-poly marine mammals (orca, Pacific white-sided dolphin, Dall's porpoise, humpback,
 * harbour seal / sea lion, river otter) plus a pooled whale-blow puff. Same style as creatures.ts
 * (unlit, flat colour per face, one InstancedMesh per species) but with its own vertex shader so the
 * bird code path stays untouched.
 *
 * Geometry is built at UNIT body length (nose at z=+0.5, tail tip at z=-0.5, body centre at the
 * origin, +Y up); the instance scale is the animal's length in metres.
 *
 * Per-instance aAnim = (phase, amp, arch, w):
 *   - tail beat: every vertex behind the centre moves vertically by amp*sin(phase + 4z) (stronger
 *     toward the tail), a travelling wave from head to flukes;
 *   - arch: y -= arch * 4z² (positive = rolling back / peduncle arch, negative = seal "banana");
 *   - aSeg 1 (head, seals/otters): pitches about the neck by w (positive = nose up);
 *   - aSeg 6 (dorsal fin, cetaceans): height scale w (1 = tall straight bull fin, ~0.45 = curved
 *     female/calf fin: shorter and swept back).
 */
const FIN_BASE = 0.085;
const NECK_Z = 0.27, NECK_Y = 0.03;

export const mammalMat = register(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
mammalMat.onBeforeCompile = (s) => {
  s.vertexShader = s.vertexShader
    .replace('void main() {', 'attribute vec4 aAnim;\nattribute float aSeg;\nvoid main() {')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 p = transformed;
        if (aSeg > 0.5 && aSeg < 1.5) {
          vec2 h = vec2(p.z - ${NECK_Z.toFixed(3)}, p.y - ${NECK_Y.toFixed(3)});
          float c = cos(aAnim.w), sn = sin(aAnim.w);
          p.z = ${NECK_Z.toFixed(3)} + h.x * c - h.y * sn;
          p.y = ${NECK_Y.toFixed(3)} + h.x * sn + h.y * c;
        } else if (aSeg > 5.5 && aSeg < 6.5) {
          float up = max(0.0, p.y - ${FIN_BASE.toFixed(3)});
          p.z -= up * (1.0 - aAnim.w) * 1.1;
          p.y = ${FIN_BASE.toFixed(3)} + up * aAnim.w;
        }
        float tt = clamp(-p.z * 2.0, 0.0, 1.0);
        p.y += aAnim.y * sin(aAnim.x + p.z * 4.0) * tt * tt;
        p.y -= aAnim.z * p.z * p.z * 4.0;
        transformed = p;
      }`,
    );
};
mammalMat.customProgramCacheKey = () => 'mammal-v1';

type V = [number, number, number];
const L = new THREE.Vector3(0.35, 0.85, 0.4).normalize();

/** Flat-coloured triangles with baked facet shading (reads as 3D while unlit). */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  seg: number[] = [];
  private c = new THREE.Color();
  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private n = new THREE.Vector3();
  tri(p: V, q: V, r: V, color: number, seg = 0, shade = true) {
    this.c.setHex(color, THREE.SRGBColorSpace);
    let k = 1;
    if (shade) {
      this.a.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      this.b.set(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
      this.n.crossVectors(this.a, this.b).normalize();
      k = 0.8 + 0.2 * Math.abs(this.n.dot(L)); // double-sided: either facing reads lit
      if (this.n.y < -0.4) k *= 0.92; // undersides a touch darker
    }
    for (const v of [p, q, r]) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(this.c.r * k, this.c.g * k, this.c.b * k);
      this.seg.push(seg);
    }
  }
  quad(a: V, b: V, c: V, d: V, color: number, seg = 0) { this.tri(a, b, c, color, seg); this.tri(a, c, d, color, seg); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSeg', new THREE.Float32BufferAttribute(this.seg, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Elliptical ring of n points (k=0 on top, clockwise seen from the front, +x = right side). */
function ring(n: number, z: number, top: number, side: number, bottom: number, yc = 0): V[] {
  const out: V[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, c = Math.cos(a);
    out.push([Math.sin(a) * side, yc + (c > 0 ? c * top : c * -bottom), z]);
  }
  return out;
}

/** Face colour callback: k = face index around the ring (0 = top-right), n ring size, z = face mid z. */
type Paint = (k: number, n: number, z: number) => number;

/** Loft a body through rings with a nose point and a tail point; colour per face from `paint`. */
function body(b: Builder, rings: V[][], nose: V, tail: V, paint: Paint, seg: (z: number) => number = () => 0) {
  const n = rings[0].length;
  for (let k = 0; k < n; k++) {
    const r0 = rings[0];
    b.tri(r0[(k + 1) % n], r0[k], nose, paint(k, n, (r0[0][2] + nose[2]) / 2), seg(nose[2]));
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const ra = rings[i], rb = rings[i + 1], zm = (ra[0][2] + rb[0][2]) / 2;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      b.quad(ra[k], ra[k2], rb[k2], rb[k], paint(k, n, zm), seg(zm));
    }
  }
  const rl = rings[rings.length - 1];
  for (let k = 0; k < n; k++) b.tri(rl[k], rl[(k + 1) % n], tail, paint(k, n, (rl[0][2] + tail[2]) / 2), seg(tail[2]));
}

/** Which part of the ring a face is on: 'top' | 'upper' | 'lower' | 'belly' (mirrored left/right). */
function band(k: number, n: number) {
  const a = ((k + 0.5) / n) * 360; // face centre angle from top, clockwise
  const m = a > 180 ? 360 - a : a;
  return m < 50 ? 'top' : m < 95 ? 'upper' : m < 140 ? 'lower' : 'belly';
}

/** Flukes: two swept triangles each side, top face `top`, underside `under` (offset so both read). */
function flukes(b: Builder, z0: number, span: number, chord: number, top: number, under: number) {
  for (const s of [-1, 1]) {
    for (const [dy, c] of [[0.003, top], [-0.003, under]] as [number, number][]) {
      const root: V = [0, dy, z0], lead: V = [s * span * 0.55, dy, z0 - chord * 0.35];
      const tip: V = [s * span, dy, z0 - chord * 0.95], notch: V = [s * span * 0.12, dy, z0 - chord * 0.75];
      b.tri(root, lead, tip, c, 0, false);
      b.tri(root, tip, notch, c, 0, false);
    }
  }
}

/** Paddle pectoral flippers (slightly drooped), colour per side. */
function pecs(b: Builder, z: number, y: number, x0: number, len: number, width: number, color: number, under = color) {
  for (const s of [-1, 1]) {
    const a: V = [s * x0, y, z + width * 0.5], c: V = [s * x0, y, z - width * 0.5];
    const t: V = [s * (x0 + len), y - len * 0.45, z - width * 0.6];
    b.tri(a, c, t, color);
    b.tri(c, a, [t[0], t[1] - 0.004, t[2]], under);
  }
}

// ---------------------------------------------------------------- species
const ORCA = { black: 0x16191c, white: 0xf1f2ee, saddle: 0x8c9399 };

/** Orca (unit length). Black with white belly, eye patch and rear flank, grey saddle; dorsal fin seg 6. */
export function orcaGeometry() {
  const b = new Builder();
  const n = 8;
  const rings = [
    ring(n, 0.43, 0.045, 0.05, 0.045, -0.01),
    ring(n, 0.33, 0.08, 0.082, 0.075),
    ring(n, 0.17, 0.1, 0.098, 0.092),
    ring(n, 0.0, 0.1, 0.095, 0.094),
    ring(n, -0.16, 0.078, 0.07, 0.07),
    ring(n, -0.3, 0.05, 0.032, 0.045),
    ring(n, -0.4, 0.028, 0.016, 0.024),
  ];
  const paint: Paint = (k, nn, z) => {
    const bd = band(k, nn);
    if (bd === 'belly' && z > -0.24) return ORCA.white; // white chin + belly
    if (bd === 'lower' && z < -0.04 && z > -0.26) return ORCA.white; // flank patch sweeping up
    if (bd === 'upper' && z > 0.3 && z < 0.4) return ORCA.white; // eye patch
    if (bd === 'top' && z < -0.05 && z > -0.2) return ORCA.saddle; // saddle behind the fin
    return ORCA.black;
  };
  body(b, rings, [0, -0.005, 0.5], [0, 0, -0.43], paint);
  flukes(b, -0.4, 0.13, 0.13, ORCA.black, ORCA.white);
  pecs(b, 0.22, -0.06, 0.07, 0.11, 0.07, ORCA.black);
  // dorsal fin (seg 6): male-tall triangle, the shader shortens/sweeps it for females and calves
  const f0: V = [0, FIN_BASE, 0.09], f1: V = [0, FIN_BASE, -0.07], ft: V = [0, 0.33, -0.03];
  const fm: V = [0, FIN_BASE + 0.005, 0.01];
  for (const sx of [-0.008, 0.008]) {
    b.tri([sx, f0[1], f0[2]], [sx * 0.5, ft[1], ft[2]], [sx, fm[1], fm[2]], ORCA.black, 6);
    b.tri([sx, fm[1], fm[2]], [sx * 0.5, ft[1], ft[2]], [sx, f1[1], f1[2]], ORCA.black, 6);
  }
  return b.build();
}

/** Pacific white-sided dolphin (unit length): dark back, pale flank blaze, white belly, bicolour falcate fin. */
export function dolphinGeometry() {
  const b = new Builder();
  const dark = 0x2a3036, grey = 0xa3acb0, white = 0xeef0ec;
  const n = 8;
  const rings = [
    ring(n, 0.4, 0.035, 0.035, 0.032),
    ring(n, 0.3, 0.075, 0.07, 0.068),
    ring(n, 0.12, 0.09, 0.08, 0.082),
    ring(n, -0.05, 0.082, 0.07, 0.075),
    ring(n, -0.22, 0.05, 0.035, 0.045),
    ring(n, -0.38, 0.022, 0.012, 0.02),
  ];
  const paint: Paint = (k, nn, z) => {
    const bd = band(k, nn);
    if (bd === 'belly') return white;
    if (bd === 'lower') return z > 0.25 ? white : grey;
    if (bd === 'upper' && z < -0.02 && z > -0.3) return grey; // the "suspenders" blaze
    return dark;
  };
  body(b, rings, [0, -0.01, 0.5], [0, 0, -0.42], paint);
  flukes(b, -0.39, 0.12, 0.11, dark, grey);
  pecs(b, 0.22, -0.05, 0.06, 0.1, 0.06, dark);
  // tall hooked fin: dark leading half, pale trailing half
  const base0: V = [0, 0.08, 0.06], base1: V = [0, 0.08, -0.1], mid: V = [0, 0.09, -0.02], tip: V = [0, 0.22, -0.13];
  b.tri(base0, tip, mid, dark, 6);
  b.tri(mid, tip, base1, grey, 6);
  return b.build();
}

/** Dall's porpoise (unit length): stocky, small head, black with a big white flank patch, frosted fin tip. */
export function dallsGeometry() {
  const b = new Builder();
  const black = 0x15181b, white = 0xeef0ee, frost = 0xc9d0d1;
  const n = 8;
  const rings = [
    ring(n, 0.4, 0.05, 0.05, 0.045),
    ring(n, 0.25, 0.1, 0.1, 0.095),
    ring(n, 0.05, 0.125, 0.115, 0.12),
    ring(n, -0.15, 0.1, 0.085, 0.1),
    ring(n, -0.32, 0.06, 0.03, 0.07), // keeled tail stock
    ring(n, -0.41, 0.025, 0.015, 0.025),
  ];
  const paint: Paint = (k, nn, z) => {
    const bd = band(k, nn);
    if ((bd === 'lower' || bd === 'belly') && z < 0.15 && z > -0.3) return white;
    return black;
  };
  body(b, rings, [0, -0.005, 0.5], [0, 0, -0.44], paint);
  flukes(b, -0.4, 0.12, 0.1, black, black);
  pecs(b, 0.2, -0.06, 0.08, 0.07, 0.05, black);
  const base0: V = [0, 0.11, 0.07], base1: V = [0, 0.11, -0.07], tip: V = [0, 0.22, -0.03];
  const m0: V = [0, 0.175, 0.025], m1: V = [0, 0.175, -0.06];
  b.quad(base0, m0, m1, base1, black, 6);
  b.tri(m0, tip, m1, frost, 6);
  return b.build();
}

/** Humpback (unit length): knobbly dark back, small dorsal hump, long white pectorals, white-bellied flukes. */
export function humpbackGeometry() {
  const b = new Builder();
  const dark = 0x22272c, mid = 0x353b41, white = 0xe9ebe7, knob = 0x2c3238;
  const n = 8;
  const rings = [
    ring(n, 0.44, 0.04, 0.07, 0.05, -0.02),
    ring(n, 0.3, 0.08, 0.1, 0.1),
    ring(n, 0.12, 0.1, 0.11, 0.12),
    ring(n, -0.08, 0.085, 0.09, 0.095),
    ring(n, -0.25, 0.055, 0.04, 0.05),
    ring(n, -0.38, 0.03, 0.018, 0.026),
  ];
  const paint: Paint = (k, nn, z) => {
    const bd = band(k, nn);
    if (bd === 'belly' && z > 0.05) return mid; // throat pleats, a shade lighter
    if (bd === 'top' && z > 0.3) return knob;
    return dark;
  };
  body(b, rings, [0, -0.01, 0.5], [0, 0, -0.42], paint);
  // tubercles: little bumps on the head
  for (const [x, z] of [[0.02, 0.4], [-0.02, 0.4], [0.03, 0.35], [-0.03, 0.35]]) b.tri([x - 0.01, 0.06, z], [x + 0.01, 0.06, z], [x, 0.075, z - 0.005], knob);
  flukes(b, -0.39, 0.17, 0.12, dark, white);
  pecs(b, 0.26, -0.07, 0.09, 0.3, 0.06, white, white);
  // small dorsal hump far back (no seg 6: always full)
  b.tri([0, 0.07, -0.12], [0, 0.1, -0.16], [0, 0.065, -0.2], dark);
  return b.build();
}

/** Harbour seal (unit length, ~1.6 m): spindle body, round dog-like head (seg 1), dappled grey. */
export function sealGeometry() {
  const b = new Builder();
  const g1 = 0x7a7c74, g2 = 0x666861, belly = 0xa29f93, spot = 0x4c4e49, nose = 0x1a1b1c;
  const n = 8;
  const rings = [
    ring(n, 0.25, 0.1, 0.11, 0.1, 0.0),
    ring(n, 0.08, 0.13, 0.15, 0.12),
    ring(n, -0.12, 0.11, 0.13, 0.1),
    ring(n, -0.3, 0.06, 0.07, 0.06),
    ring(n, -0.4, 0.035, 0.04, 0.035),
  ];
  const paint: Paint = (k, nn, z) => {
    const bd = band(k, nn);
    if (bd === 'belly') return belly;
    if ((k * 7 + Math.round(z * 31)) % 5 === 0) return spot;
    return (k + Math.round(z * 12)) % 2 ? g1 : g2;
  };
  body(b, rings, [0, 0.0, 0.29], [0, 0, -0.43], paint, (z) => (z > 0.26 ? 1 : 0));
  // head (seg 1): short neck + round skull + snout
  const hr = [ring(n, 0.27, 0.085, 0.085, 0.08, 0.02), ring(n, 0.36, 0.09, 0.09, 0.075, 0.035), ring(n, 0.43, 0.06, 0.06, 0.05, 0.03)];
  body(b, hr, [0, 0.02, 0.5], [0, 0.02, 0.26], (k, nn) => (band(k, nn) === 'belly' ? belly : k % 2 ? g1 : g2), () => 1);
  b.tri([-0.015, 0.035, 0.495], [0.015, 0.035, 0.495], [0, 0.015, 0.505], nose, 1);
  for (const sx of [-1, 1]) {
    b.tri([sx * 0.066, 0.08, 0.41], [sx * 0.072, 0.06, 0.405], [sx * 0.07, 0.075, 0.385], nose, 1); // big dark eyes
  }
  // fore flippers + hind flipper fan
  for (const s of [-1, 1]) b.tri([s * 0.12, -0.08, 0.12], [s * 0.12, -0.08, 0.04], [s * 0.19, -0.12, 0.05], g2);
  for (const s of [-1, 1]) b.tri([0, 0, -0.4], [s * 0.09, 0.01, -0.52], [s * 0.02, 0.0, -0.53], g2);
  return b.build();
}

/** River otter (unit length incl. tail, ~1.1 m): slim brown body, thick tapering tail, pale throat; head seg 1. */
export function otterGeometry() {
  const b = new Builder();
  const fur = 0x5b4331, dark = 0x47331f, throat = 0xa38a6a, nose = 0x1a1b1c;
  const n = 6;
  const rings = [
    ring(n, 0.22, 0.05, 0.055, 0.045),
    ring(n, 0.05, 0.065, 0.07, 0.06),
    ring(n, -0.1, 0.06, 0.065, 0.055),
    ring(n, -0.2, 0.035, 0.035, 0.03),
    ring(n, -0.4, 0.012, 0.012, 0.012),
  ];
  body(b, rings, [0, 0.0, 0.27], [0, 0, -0.5], (k, nn, z) => (band(k, nn) === 'belly' && z > 0 ? throat : band(k, nn) === 'top' ? dark : fur));
  const hr = [ring(n, 0.27, 0.05, 0.05, 0.045, 0.02), ring(n, 0.36, 0.055, 0.055, 0.04, 0.03)];
  body(b, hr, [0, 0.03, 0.44], [0, 0.02, 0.26], (k, nn) => (band(k, nn) === 'belly' ? throat : fur), () => 1);
  b.tri([-0.012, 0.035, 0.437], [0.012, 0.035, 0.437], [0, 0.025, 0.445], nose, 1);
  for (const s of [-1, 1]) {
    b.tri([s * 0.04, 0.075, 0.33], [s * 0.05, 0.075, 0.31], [s * 0.045, 0.095, 0.315], dark, 1); // little ears
    b.tri([s * 0.045, 0.06, 0.39], [s * 0.05, 0.05, 0.385], [s * 0.048, 0.06, 0.375], nose, 1);
  }
  return b.build();
}

export interface MammalMesh {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  n: number;
}

/** One InstancedMesh for `n` animals; all instances start hidden (zero scale). */
export function mammalMesh(geom: THREE.BufferGeometry, n: number, name: string, tint = false): MammalMesh {
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('aAnim', anim);
  const mesh = new THREE.InstancedMesh(geom, mammalMat, Math.max(1, n));
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // instances span the map
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < mesh.count; i++) { mesh.setMatrixAt(i, zero); if (tint) mesh.setColorAt(i, white); }
  return { mesh, anim, n };
}

// ---------------------------------------------------------------- whale blows
const BLOW_N = 48;

/** Faceted icosahedron with the facet shading baked in (same look as the smoke puffs). */
function puffGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.sub(b)).normalize();
    const shade = 0.82 + 0.18 * Math.max(0, n.dot(L));
    for (let k = 0; k < 3; k++) col.set([shade * 0.96, shade, shade * 0.98], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

/**
 * Whale blow: a bushy column of faceted puffs shooting up fast from the blowhole, then spreading,
 * drifting downwind and shrinking away (~2 s). Opaque (flat style), one InstancedMesh, pooled.
 */
export class BlowFX {
  mesh: THREE.InstancedMesh;
  private p = new Float32Array(BLOW_N * 3);
  private v = new Float32Array(BLOW_N * 3);
  private s = new Float32Array(BLOW_N * 3); // size, age, life
  private next = 0;
  private alive = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private vp = new THREE.Vector3();
  private vs = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  /** Total blows emitted (debug/tests). */
  count = 0;

  constructor() {
    this.mesh = new THREE.InstancedMesh(puffGeometry(), register(new THREE.MeshBasicMaterial({ vertexColors: true })), BLOW_N);
    this.mesh.name = 'mammal_blows';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < BLOW_N; i++) { this.mesh.setMatrixAt(i, this.zero); this.s[i * 3 + 1] = 1; this.s[i * 3 + 2] = 1; }
    this.mesh.visible = false;
  }

  /** A blow at the blowhole (x,y,z). `height` ≈ column height in m (orca ~3, humpback ~4.5). */
  blow(x: number, y: number, z: number, height = 3) {
    this.count++;
    const n = 9;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % BLOW_N;
      if (this.s[i * 3 + 1] >= this.s[i * 3 + 2]) this.alive++;
      const f = k / (n - 1); // 0 = low/slow puff, 1 = the top of the column
      this.p[i * 3] = x + (Math.random() - 0.5) * 0.15; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z + (Math.random() - 0.5) * 0.15;
      const up = height * (1.5 + f * 2.6);
      this.v[i * 3] = (Math.random() - 0.5) * 0.7; this.v[i * 3 + 1] = up; this.v[i * 3 + 2] = (Math.random() - 0.5) * 0.7;
      this.s[i * 3] = height * (0.075 + 0.07 * f) * (0.8 + Math.random() * 0.4);
      this.s[i * 3 + 1] = 0;
      this.s[i * 3 + 2] = 0.9 + f * 0.7 + Math.random() * 0.3;
    }
    this.mesh.visible = true;
  }

  update(dt: number) {
    if (!this.alive) return;
    for (let i = 0; i < BLOW_N; i++) {
      const o = i * 3;
      if (this.s[o + 1] >= this.s[o + 2]) continue;
      this.s[o + 1] += dt;
      const k = this.s[o + 1] / this.s[o + 2];
      if (k >= 1) { this.alive--; this.mesh.setMatrixAt(i, this.zero); continue; }
      // fast shot upward, strong drag, then drift downwind and sag a little
      const drag = Math.exp(-dt * 4.5);
      this.v[o] = this.v[o] * drag + WIND.x * 0.9 * dt * 3;
      this.v[o + 1] = this.v[o + 1] * drag - 0.25 * dt;
      this.v[o + 2] = this.v[o + 2] * drag + WIND.y * 0.9 * dt * 3;
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
      // pop in, swell, shrink away (no alpha: flat style)
      const sc = this.s[o] * Math.min(1, k * 10) * (1 + k * 1.6) * (1 - k * k);
      this.e.set(k * 1.3 + i, i * 0.7, k);
      this.q.setFromEuler(this.e);
      this.vp.set(this.p[o], this.p[o + 1], this.p[o + 2]);
      this.vs.set(sc, sc * 1.25, sc);
      this.m.compose(this.vp, this.q, this.vs);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!this.alive) this.mesh.visible = false;
  }
}
