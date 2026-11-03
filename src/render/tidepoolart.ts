import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-poly tide-pool art (docs/tide_study.md): flat-shaded vertex-coloured geometry in the world's
 * language. Colours are the stylised Logbook colours (docs/ref_flora_fauna.md §2), a little brighter
 * than the photos so they read at phone size against wet rock.
 */
export const CRITTER_COL = {
  starPurple: 0x6e3c86, starOrange: 0xe0782c, starDot: 0xf1e6d6,
  sunflower: 0xd9683c, sunflowerTip: 0xeea064,
  anemone: 0x3fa87a, anemoneDisc: 0x2a7656, anemoneColumn: 0x56704c,
  urchin: 0x5c2c7c, urchinTip: 0x8a5aa8,
  hermitShell: 0x7a6650, hermitShell2: 0xa48a62, hermitLeg: 0xc0562e,
  shoreCrab: 0x5e3b62, shoreCrabLeg: 0x7a5480,
  sculpin: 0x6f7a62, sculpinBand: 0xc9c7b0,
  lettuce: 0x7cc43c, mussel: 0x23263a, barnacle: 0xd7d0c0,
  rock: 0x8b857a, rockDark: 0x6c675e, floor: 0x46503f,
};

const _c = new THREE.Color();
/** Non-indexed copy with a flat vertex colour (optionally jittered per face for a hand-painted look). */
export function paint(g: THREE.BufferGeometry, hex: number, jitter = 0, seed = 1): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g.clone();
  ng.deleteAttribute('normal');
  ng.deleteAttribute('uv');
  const n = ng.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < n; i += 3) {
    s = (s * 9301 + 49297) % 233280;
    const k = 1 + (s / 233280 - 0.5) * jitter;
    _c.setHex(hex); // linear (ColorManagement converts the sRGB hex)
    for (let v = 0; v < 3 && i + v < n; v++) { col[(i + v) * 3] = _c.r * k; col[(i + v) * 3 + 1] = _c.g * k; col[(i + v) * 3 + 2] = _c.b * k; }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs, false)!;

function starShape(arms: number, r: number, inner: number) {
  const s = new THREE.Shape();
  for (let i = 0; i <= arms * 2; i++) {
    const a = (i / (arms * 2)) * Math.PI * 2;
    const rr = i % 2 ? inner : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return s;
}

/** Ochre sea star: thick 5-arm star, purple or orange, with a few pale dots. r = arm length (m). */
export function seaStar(orange: boolean, r = 0.15) {
  const body = new THREE.ExtrudeGeometry(starShape(5, r, r * 0.38), { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 }).rotateX(-Math.PI / 2);
  const parts = [paint(body, orange ? CRITTER_COL.starOrange : CRITTER_COL.starPurple, 0.12, orange ? 3 : 4)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(paint(new THREE.OctahedronGeometry(0.012, 0).translate(Math.cos(a) * r * 0.55, 0.05, -Math.sin(a) * r * 0.55), CRITTER_COL.starDot));
  }
  parts.push(paint(new THREE.OctahedronGeometry(0.014, 0).translate(0, 0.055, 0), CRITTER_COL.starDot));
  return merge(parts);
}

/** Sunflower star: big, soft, many-armed (the rare one, only in the lowest pools). */
export function sunflowerStar(r = 0.32) {
  const body = new THREE.ExtrudeGeometry(starShape(18, r, r * 0.62), { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }).rotateX(-Math.PI / 2);
  const disc = new THREE.CylinderGeometry(r * 0.42, r * 0.5, 0.03, 9).translate(0, 0.03, 0);
  return merge([paint(body, CRITTER_COL.sunflower, 0.15, 7), paint(disc, CRITTER_COL.sunflowerTip, 0.1, 8)]);
}

/** Giant green anemone: squat column, flat jade disc ringed with stubby tentacles. */
export function anemone(r = 0.11) {
  const parts = [
    paint(new THREE.CylinderGeometry(r * 0.75, r * 0.85, 0.06, 8).translate(0, 0.03, 0), CRITTER_COL.anemoneColumn, 0.1, 2),
    paint(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.012, 8).translate(0, 0.066, 0), CRITTER_COL.anemoneDisc, 0, 3),
  ];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, rr = r * (0.72 + (i % 2) * 0.12);
    const cone = new THREE.ConeGeometry(0.018, 0.05, 4).rotateZ(-0.7).rotateY(-a).translate(Math.cos(a) * rr, 0.08, Math.sin(a) * rr);
    parts.push(paint(cone, CRITTER_COL.anemone, 0.15, 10 + i));
  }
  return merge(parts);
}

/** Purple urchin: a spiky low-poly ball. */
export function urchin(r = 0.06) {
  const ball = new THREE.IcosahedronGeometry(r, 0).translate(0, r * 0.8, 0);
  const parts = [paint(ball, CRITTER_COL.urchin, 0.15, 5)];
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const p = ico.getAttribute('position');
  const seen = new Set<string>();
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    const key = d.toArray().map((v) => v.toFixed(2)).join();
    if (seen.has(key) || d.y < -0.6) continue;
    seen.add(key);
    q.setFromUnitVectors(up, d);
    const spike = new THREE.ConeGeometry(0.012, r * 1.3, 3).translate(0, r * 0.65 + r, 0).applyQuaternion(q).translate(0, r * 0.8, 0);
    parts.push(paint(spike, CRITTER_COL.urchinTip, 0.1, i));
  }
  return merge(parts);
}

/** Hermit crab: a borrowed snail shell with orange legs poking out the front (+z). */
export function hermitCrab() {
  const shell = new THREE.ConeGeometry(0.045, 0.1, 6).rotateX(Math.PI / 2 + 0.5).translate(0, 0.045, -0.02);
  const whorl = new THREE.ConeGeometry(0.028, 0.05, 5).rotateX(-0.6).translate(0, 0.08, -0.05);
  const parts = [paint(shell, CRITTER_COL.hermitShell, 0.2, 2), paint(whorl, CRITTER_COL.hermitShell2, 0.1, 3)];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) parts.push(paint(new THREE.BoxGeometry(0.06, 0.012, 0.012).rotateY(s * (0.4 + i * 0.5)).translate(s * 0.03, 0.015, 0.035 - i * 0.02), CRITTER_COL.hermitLeg));
    parts.push(paint(new THREE.BoxGeometry(0.022, 0.018, 0.03).translate(s * 0.018, 0.022, 0.06), CRITTER_COL.hermitLeg, 0.1, 9));
  }
  return merge(parts);
}

/** Purple shore crab: flat squarish body, legs out sideways. */
export function shoreCrab() {
  const parts = [paint(new THREE.CylinderGeometry(0.05, 0.055, 0.025, 6).translate(0, 0.03, 0), CRITTER_COL.shoreCrab, 0.12, 4)];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    parts.push(paint(new THREE.BoxGeometry(0.06, 0.01, 0.012).rotateZ(s * -0.5).translate(s * 0.07, 0.02, -0.025 + i * 0.025), CRITTER_COL.shoreCrabLeg));
  }
  parts.push(paint(new THREE.BoxGeometry(0.025, 0.02, 0.025).translate(-0.03, 0.035, 0.05), CRITTER_COL.shoreCrabLeg));
  parts.push(paint(new THREE.BoxGeometry(0.025, 0.02, 0.025).translate(0.03, 0.035, 0.05), CRITTER_COL.shoreCrabLeg));
  return merge(parts);
}

/** Tidepool sculpin: a small tapered fish, mottled, with a pale saddle; faces +z. */
export function sculpin() {
  const body = new THREE.ConeGeometry(0.03, 0.15, 5).rotateX(Math.PI / 2).scale(1, 0.7, 1).translate(0, 0.025, -0.01);
  const head = new THREE.OctahedronGeometry(0.035, 0).scale(1, 0.6, 1).translate(0, 0.025, 0.06);
  const band = new THREE.BoxGeometry(0.05, 0.012, 0.02).translate(0, 0.045, 0.005);
  const fin = new THREE.BoxGeometry(0.11, 0.005, 0.035).translate(0, 0.012, 0.03);
  return merge([paint(body, CRITTER_COL.sculpin, 0.25, 6), paint(head, CRITTER_COL.sculpin, 0.2, 7), paint(band, CRITTER_COL.sculpinBand), paint(fin, CRITTER_COL.sculpin, 0.1, 8)]);
}

/** A tuft of sea lettuce: a few bright flat blades. */
export function seaLettuce(seed: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = seed * 2.3 + i * 2.1;
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.05, 0.005, 0, 0.05, 0.005, 0, 0.0, 0.03, 0.16], 3));
    parts.push(paint(g.rotateY(a), i ? CRITTER_COL.lettuce : 0x68b032));
  }
  return merge(parts);
}

/** Mussel clump for a rim rock. */
export function mussels(seed: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = seed + i * 1.3;
    parts.push(paint(new THREE.OctahedronGeometry(0.035, 0).scale(0.6, 0.45, 1.4).rotateY(a).translate(Math.cos(a) * 0.05, 0.02, Math.sin(a) * 0.05), CRITTER_COL.mussel, 0.3, i));
  }
  return merge(parts);
}

/** Rim rock: a squashed faceted boulder. */
export function rimRock(seed: number, r: number) {
  const g = new THREE.DodecahedronGeometry(r, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    // a function of the vertex position (not its index) so shared corners move together: no cracks
    const h = Math.sin(p.getX(i) * 12.9898 + p.getZ(i) * 78.233 + seed * 3.17) * 43758.5453;
    p.setY(i, p.getY(i) * 0.55); p.setX(i, p.getX(i) * (0.88 + 0.24 * (h - Math.floor(h))));
  }
  return paint(g, (seed % 3) ? CRITTER_COL.rock : CRITTER_COL.rockDark, 0.16, seed);
}
