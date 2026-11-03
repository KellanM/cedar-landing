/**
 * Low-poly props for the opening, built in code in the world's flat vertex-colour style (unlit,
 * faked facet shade per face direction): Gran's porch table + logbook, the rod in the driftwood,
 * the rock pool with its crab and hook tin, the clam bucket, the drifting barrel, the Thursday
 * mail boat, the tide-rip foam line and the pick-up glints.
 */
import * as THREE from 'three';
import { applyWorldMaterial } from '../../render/materials';

const _c = new THREE.Color();
const SHADE = { top: 1, side: 0.84, end: 0.72, bottom: 0.6 };

/** Accumulates boxes / prisms / discs (non-indexed, per-face colour) into one geometry. */
class Builder {
  private pos: number[] = [];
  private col: number[] = [];
  private tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hex: string, shade: number) {
    _c.set(hex).multiplyScalar(shade);
    for (const p of [a, b, c]) { this.pos.push(p.x, p.y, p.z); this.col.push(_c.r, _c.g, _c.b); }
  }
  private quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hex: string, shade: number) {
    this.tri(a, b, c, hex, shade); this.tri(a, c, d, hex, shade);
  }
  /** box of size (w,h,d) centred at p, rotated by euler r */
  box(w: number, h: number, d: number, p: [number, number, number], hex: string, r: [number, number, number] = [0, 0, 0], taper = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1));
    const x = w / 2, y = h / 2, z = d / 2, t = taper;
    const v = [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], [-x * t, y, -z * t], [x * t, y, -z * t], [x * t, y, z * t], [-x * t, y, z * t]].map((q) => new THREE.Vector3(...q).applyMatrix4(m));
    this.quad(v[4], v[7], v[6], v[5], hex, SHADE.top);
    this.quad(v[0], v[1], v[2], v[3], hex, SHADE.bottom);
    this.quad(v[3], v[2], v[6], v[7], hex, SHADE.side);
    this.quad(v[1], v[0], v[4], v[5], hex, SHADE.side);
    this.quad(v[0], v[3], v[7], v[4], hex, SHADE.end);
    this.quad(v[2], v[1], v[5], v[6], hex, SHADE.end);
  }
  /** n-sided prism (cylinder) along local Y, radius r (bottom) r2 (top) */
  cyl(r: number, h: number, p: [number, number, number], hex: string, rot: [number, number, number] = [0, 0, 0], n = 7, r2 = r, capHex = hex) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
    const ring = (rr: number, yy: number) => Array.from({ length: n }, (_, i) => new THREE.Vector3(Math.cos((i / n) * Math.PI * 2) * rr, yy, Math.sin((i / n) * Math.PI * 2) * rr).applyMatrix4(m));
    const b = ring(r, -h / 2), t = ring(r2, h / 2);
    const cb = new THREE.Vector3(0, -h / 2, 0).applyMatrix4(m), ct = new THREE.Vector3(0, h / 2, 0).applyMatrix4(m);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(b[i], t[i], t[j], b[j], hex, i % 2 ? SHADE.side : SHADE.end);
      this.tri(ct, t[j], t[i], capHex, SHADE.top);
      this.tri(cb, b[i], b[j], hex, SHADE.bottom);
    }
  }
  /** flat disc at height y (water, holes, a page) */
  disc(r: number, p: [number, number, number], hex: string, n = 9, sx = 1, sz = 1) {
    const c = new THREE.Vector3(...p);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      this.tri(c, new THREE.Vector3(p[0] + Math.cos(a1) * r * sx, p[1], p[2] + Math.sin(a1) * r * sz), new THREE.Vector3(p[0] + Math.cos(a0) * r * sx, p[1], p[2] + Math.sin(a0) * r * sz), hex, 1);
    }
  }
  mesh(name: string) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g);
    m.name = name;
    applyWorldMaterial(m, 'dynamic');
    return m;
  }
}

const WOOD = '#8A6A4A', WOOD_DK = '#5E4632', ROCK = '#6E7472', ROCK_DK = '#565C5B';
const RED = '#A23A2C', CREAM = '#E6D3A3', BLACK = '#24221F', WHITE = '#EEE8DA', BUFF = '#D9A441', WEED = '#55703F';

/** Gran's porch table with the logbook (its ribbon + the keys' brass ring peeking out of the spine). */
export function logbookTable() {
  const b = new Builder();
  b.box(1.1, 0.08, 0.7, [0, 0.78, 0], WOOD);
  for (const [x, z] of [[-0.48, -0.28], [0.48, -0.28], [-0.48, 0.28], [0.48, 0.28]]) b.box(0.08, 0.76, 0.08, [x, 0.38, z], WOOD_DK);
  const book = new Builder();
  book.box(0.42, 0.07, 0.3, [0, 0.86, 0], '#6B3A2A', [0, 0.25, 0]);
  book.box(0.4, 0.05, 0.28, [0.01, 0.86, 0], CREAM, [0, 0.25, 0]);
  book.box(0.04, 0.005, 0.2, [0.1, 0.9, 0.05], RED, [0, 0.25, 0]);
  book.cyl(0.05, 0.015, [-0.2, 0.86, 0.12], BUFF, [Math.PI / 2, 0, 0], 8); // the key ring
  b.cyl(0.08, 0.16, [0.36, 0.9, -0.18], '#3E5C7A'); // the kettle she left out
  const g = new THREE.Group();
  g.name = 'OPEN_Table';
  g.add(b.mesh('OPEN_TableWood'));
  const bk = book.mesh('OPEN_Logbook');
  g.add(bk);
  return { group: g, book: bk };
}

/** A pale, silvered driftwood log on open sand with Gran's old rod laid across it — readable at a glance
 *  from the porch steps: red-wrapped cork handle, brass reel, a yellow float on the line (a bit oversized). */
export function driftwoodRod() {
  const b = new Builder();
  b.cyl(0.36, 4.4, [0, 0.3, 0], '#D9D2C2', [0, 0, Math.PI / 2 - 0.05], 7, 0.27, '#B9AE9C');
  b.cyl(0.2, 1.4, [1.5, 0.36, 0.5], '#C9C0AE', [0.4, 0.6, Math.PI / 2], 6);
  const rod = new Builder();
  // blank lying across the log, butt on the sand
  rod.cyl(0.045, 3.0, [-0.2, 0.62, 0.42], '#5A3A26', [Math.PI / 2 - 0.12, 0, 0.35], 6, 0.022);
  rod.cyl(0.085, 0.5, [-0.55, 0.42, -0.42], '#D9A25E', [Math.PI / 2 - 0.12, 0, 0.35], 7, 0.08); // cork grip
  rod.cyl(0.09, 0.12, [-0.47, 0.44, -0.2], '#B23A2A', [Math.PI / 2 - 0.12, 0, 0.35], 7); // red whipping
  rod.cyl(0.16, 0.1, [-0.5, 0.58, -0.05], '#C8A04A', [0, 0, Math.PI / 2], 9); // brass reel
  rod.cyl(0.11, 0.24, [0.55, 0.12, 1.6], '#F2C230', [0.3, 0, 0], 7, 0.03, '#B23A2A'); // yellow float on the sand
  const g = new THREE.Group(); g.name = 'OPEN_Driftwood';
  g.add(b.mesh('OPEN_DriftLog'));
  const r = rod.mesh('OPEN_Rod'); g.add(r);
  g.scale.setScalar(1.25);
  return { group: g, item: r };
}

/** A rock pool: dark water, a rim of stones, weed, the hook tin, and a shore crab sitting on it. */
export function rockPool() {
  const b = new Builder();
  b.disc(1.25, [0, 0.06, 0], '#2E4A4E', 10, 1, 0.8);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.box(0.55 + (i % 3) * 0.15, 0.32 + (i % 2) * 0.12, 0.45, [Math.cos(a) * 1.35, 0.12, Math.sin(a) * 1.1], i % 2 ? ROCK : ROCK_DK, [0, a, 0], 0.7);
  }
  b.box(0.5, 0.05, 0.2, [-0.6, 0.08, 0.35], WEED, [0, 0.6, 0]);
  const tin = new Builder();
  tin.box(0.5, 0.14, 0.34, [0.15, 0.12, -0.05], '#D3D6D8', [0, 0.4, 0]); // bright tin, a matchbox of hooks
  tin.box(0.46, 0.014, 0.3, [0.15, 0.196, -0.05], '#C23A2A', [0, 0.4, 0]); // red label
  tin.box(0.2, 0.016, 0.1, [0.15, 0.2, -0.05], '#F2E6C4', [0, 0.4, 0]);
  const crab = new Builder();
  crab.box(0.26, 0.08, 0.2, [0, 0, 0], '#B0603E', [0, 0, 0], 0.8);
  for (const s of [-1, 1]) {
    crab.box(0.12, 0.05, 0.08, [0.14 * s, 0.02, 0.12], '#C8704A', [0, 0.5 * s, 0]);
    for (let k = 0; k < 3; k++) crab.box(0.03, 0.03, 0.14, [(-0.08 + k * 0.08), -0.02, -0.12 * s], '#8A4A30', [0.5 * s, 0, 0]);
  }
  const g = new THREE.Group(); g.name = 'OPEN_RockPool';
  g.add(b.mesh('OPEN_PoolRocks'));
  const t = tin.mesh('OPEN_Tin'); g.add(t);
  const c = crab.mesh('OPEN_Crab'); c.position.set(0.15, 0.2, -0.05); g.add(c);
  return { group: g, item: t, crab: c };
}

/** Clam holes in the gravel and Gran's clam bucket with a digging stick. */
export function clamBucket() {
  const b = new Builder();
  for (let i = 0; i < 6; i++) b.disc(0.06, [Math.cos(i * 2.3) * 0.9, 0.03, Math.sin(i * 1.7) * 0.7], '#3A3330', 6);
  const it = new Builder();
  it.cyl(0.26, 0.4, [0, 0.2, 0], '#3E7F86', [0, 0, 0], 8, 0.3, '#EDE3CC'); // teal pail of clam necks
  it.cyl(0.025, 1.0, [0.35, 0.4, 0.1], WOOD, [0.2, 0, 0.5], 5);
  const g = new THREE.Group(); g.name = 'OPEN_Clams';
  g.add(b.mesh('OPEN_ClamHoles'));
  const m = it.mesh('OPEN_ClamBucket'); g.add(m);
  return { group: g, item: m };
}

/** A barrel adrift (Q6), bobbing; tagged so a glint can follow it. */
export function barrel() {
  const b = new Builder();
  b.cyl(0.32, 0.8, [0, 0, 0], '#7A5A3A', [0, 0, Math.PI / 2], 8, 0.32, '#5E4632');
  b.cyl(0.335, 0.06, [0.22, 0, 0], BLACK, [0, 0, Math.PI / 2], 8);
  b.cyl(0.335, 0.06, [-0.22, 0, 0], BLACK, [0, 0, Math.PI / 2], 8);
  return b.mesh('OPEN_Barrel');
}

/** The Thursday mail boat: a small Mosquito-Fleet steamer (white house, buff funnel with a black top). */
export function mailBoat() {
  const b = new Builder();
  b.box(13, 1.6, 3.6, [0, 0.3, 0], '#F0EDE6', [0, 0, 0], 0.92);
  b.box(13.2, 0.35, 3.7, [0, -0.45, 0], '#2E5A3C');
  b.box(2.2, 1.6, 2.0, [6.6, 0.4, 0], '#F0EDE6', [0, Math.PI / 4, 0], 0.6);
  b.box(8, 1.5, 2.9, [-0.6, 1.85, 0], WHITE);
  b.box(8.4, 0.18, 3.2, [-0.6, 2.7, 0], '#D6C49A');
  b.box(2.4, 1.2, 2.2, [3.0, 3.3, 0], WHITE);
  for (let i = 0; i < 6; i++) b.box(0.6, 0.5, 2.92, [-4 + i * 1.3, 2.0, 0], '#2B3A44');
  b.cyl(0.42, 2.4, [0.2, 3.9, 0], BUFF, [0, 0, 0], 8);
  b.cyl(0.44, 0.5, [0.2, 5.3, 0], BLACK, [0, 0, 0], 8);
  b.cyl(0.06, 4.5, [5.2, 4.4, 0], WOOD_DK);
  b.cyl(0.06, 3.5, [-5.6, 3.8, 0], WOOD_DK);
  const m = b.mesh('OPEN_MailBoat');
  m.userData.funnelTop = new THREE.Vector3(0.2, 5.6, 0);
  return m;
}

/** A ragged line of standing white water: the tide rip past the point (the soft fence, Q4–Q6). */
export function ripFoam(radius: number, from: number, to: number) {
  const b = new Builder();
  const n = 46;
  for (let i = 0; i < n; i++) {
    const a = from + ((to - from) * i) / n;
    const rr = radius + Math.sin(i * 2.7) * 2.2;
    b.box(2.4 + (i % 3), 0.06, 0.5, [Math.cos(a) * rr, 0.08, Math.sin(a) * rr], i % 3 ? '#F2F4EE' : '#C9D8D4', [0, -a + Math.PI / 2, 0]);
  }
  return b.mesh('OPEN_RipFoam');
}

/** Clam-show bubbles: little white domes that rise and pop over the holes (animated by the opening). */
export function clamBubbles() {
  const g = new THREE.Group(); g.name = 'OPEN_ClamBubbles';
  const mat = new THREE.MeshBasicMaterial({ color: '#F4F1E8' });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), mat);
    m.position.set(Math.cos(i * 2.3) * 0.9, 0.05, Math.sin(i * 1.7) * 0.7);
    m.userData.phase = i * 0.9;
    g.add(m);
  }
  return g;
}

/** The pick-up sparkle: a warm four-point star with a halo, drawn over foliage (no depth test), pulsing.
 *  ~0.8 m across so it reads from ~25 m on a phone. */
export function glint() {
  const g = new THREE.Group(); g.name = 'OPEN_Glint';
  const mat = new THREE.MeshBasicMaterial({ color: '#FFE9A8', transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const star = new THREE.Shape();
  const P = 4, ro = 0.42, ri = 0.1;
  for (let i = 0; i < P * 2; i++) { const a = (i / (P * 2)) * Math.PI * 2, r = i % 2 ? ri : ro; const x = Math.sin(a) * r, y = Math.cos(a) * r; if (i) star.lineTo(x, y); else star.moveTo(x, y); }
  const s = new THREE.Mesh(new THREE.ShapeGeometry(star), mat);
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 20), new THREE.MeshBasicMaterial({ color: '#FFF6DC', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  s.renderOrder = halo.renderOrder = 998;
  g.add(halo, s);
  g.userData.star = s; g.userData.halo = halo;
  return g;
}

/** The current-target marker: an ochre chevron bobbing over the next thing on Gran's list (within ~30 m). */
export function targetMarker() {
  const mat = new THREE.MeshBasicMaterial({ color: '#E3A43A', depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
  const edge = new THREE.MeshBasicMaterial({ color: '#2B2622', depthTest: false, depthWrite: false });
  const g = new THREE.Group(); g.name = 'OPEN_Marker';
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.6, 4), mat); c.rotation.x = Math.PI; c.renderOrder = 999;
  const o = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.72, 4), edge); o.rotation.x = Math.PI; o.renderOrder = 998;
  g.add(o, c);
  return g;
}
