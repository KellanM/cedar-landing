/**
 * Live boat paint + flags.
 *
 * The exporter writes each player boat as a node BOAT_Tn (fixed parts) with child meshes
 * BOAT_Tn__paint_<group> (extras paint=<group>), see docs/web_export_contract.md. bakeBoat() merges
 * them into ONE vertex-coloured geometry (one draw call, same as before) plus a per-vertex `paint`
 * group id. Recolouring rewrites the colour attribute in place: new = swatch × (baked shade ratio),
 * so shaded faces (roof_sh, the funnel band) keep their value step under any colour.
 * The baked pennant is collapsed and replaced by a small cloth flag with an abstract motif
 * (circles, crescents, trigons — positive/negative space), drawn once to a canvas.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyWorldMaterial, register } from '../../render/materials';

export const PAINT_GROUPS = ['fixed', 'hull', 'stripe', 'trim', 'cabin', 'roof', 'flag'] as const;
export type PaintGroup = (typeof PAINT_GROUPS)[number];
export const PAINTABLE: { id: PaintGroup; label: string }[] = [
  { id: 'hull', label: 'Hull' }, { id: 'stripe', label: 'Stripe' }, { id: 'trim', label: 'Trim' }, { id: 'cabin', label: 'Cabin' }, { id: 'roof', label: 'Roof' },
];

/** Marine paints that sit with the village (village_art_direction §shop table, §1.7 cedar palette). */
export const PALETTE: { hex: string; name: string }[] = [
  { hex: '#EEE8DA', name: 'Sail white' }, { hex: '#E6D3A3', name: 'Tackle cream' }, { hex: '#E9D9A0', name: 'Butter yellow' },
  { hex: '#C8A24A', name: 'Gilt ochre' }, { hex: '#B5643C', name: 'Fresh cedar' }, { hex: '#D2603A', name: 'Salmon' },
  { hex: '#A23A2C', name: 'Lighthouse red' }, { hex: '#9B3328', name: 'Cannery red' }, { hex: '#6E4A33', name: 'Weathered timber' },
  { hex: '#2F4A3A', name: 'Net-loft green' }, { hex: '#4F6B4A', name: 'Kelp' }, { hex: '#7D8B6A', name: 'Sage' },
  { hex: '#3E7F86', name: 'Teal' }, { hex: '#3E5C7A', name: 'Marine blue' }, { hex: '#8A9AA3', name: 'Grey-blue' },
  { hex: '#4A4C50', name: 'Shingle' }, { hex: '#24221F', name: 'Tar black' },
];

/** Flags: abstract motifs only. `free` ones are in the locker from the start. */
export interface FlagDef { id: string; name: string; field: string; ink: string; motif: 'pennant' | 'crescent' | 'tide' | 'moon' | 'trigons' | 'eye' | 'split' | 'stars'; price: number; note: string }
export const FLAGS: FlagDef[] = [
  { id: 'pennant', name: "Gran's pennant", field: '#E3A43A', ink: '#E3A43A', motif: 'pennant', price: 0, note: 'Plain ochre, the way she flew it.' },
  { id: 'crescent', name: 'Crescent', field: '#2F4A3A', ink: '#EEE8DA', motif: 'crescent', price: 0, note: 'A crescent cut from a circle.' },
  { id: 'tide', name: 'Tide band', field: '#EEE8DA', ink: '#9B3328', motif: 'tide', price: 0, note: 'Trigons in a row, like a turning tide.' },
  { id: 'moon', name: 'Ringed moon', field: '#24221F', ink: '#E9D9A0', motif: 'moon', price: 40, note: 'Circle in a circle, crescent in the gap.' },
  { id: 'trigons', name: 'Three trigons', field: '#3E7F86', ink: '#EEE8DA', motif: 'trigons', price: 40, note: 'Three cut-out trigons around a dot.' },
  { id: 'eye', name: 'Split circle', field: '#A23A2C', ink: '#EEE8DA', motif: 'split', price: 60, note: 'A circle split by two crescents.' },
  { id: 'ovoid', name: 'Crescent pair', field: '#E6D3A3', ink: '#2F4A3A', motif: 'eye', price: 60, note: 'Two crescents holding a circle.' },
  { id: 'stars', name: 'Night grounds', field: '#3E5C7A', ink: '#E9D9A0', motif: 'stars', price: 90, note: 'Circles and a crescent for the night fishing.' },
];

// ------------------------------------------------------------------ bake
interface PaintKit {
  orig: Float32Array;
  group: Uint8Array;
  /** per-vertex value ratio vs the brightest colour of its group */
  shade: Float32Array;
  flag: THREE.Mesh | null;
  flagBase: Float32Array | null;
  flagLen: number;
}

/** Merge a BOAT_Tn node (+ paint children) into one mesh with a `paint` group attribute. */
export function bakeBoat(node: THREE.Object3D): THREE.Mesh | null {
  node.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const geoms: THREE.BufferGeometry[] = [];
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
    const n = g.getAttribute('position').count;
    const c = g.getAttribute('color');
    const col = new Float32Array(n * 3).fill(0.6);
    if (c) for (let i = 0; i < n; i++) { col[i * 3] = c.getX(i); col[i * 3 + 1] = c.getY(i); col[i * 3 + 2] = c.getZ(i); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const tag = (typeof m.userData.paint === 'string' ? m.userData.paint : m.name.match(/__paint_([a-z]+)/)?.[1]) ?? 'fixed';
    const gi = Math.max(0, PAINT_GROUPS.indexOf(tag as PaintGroup));
    g.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(n).fill(gi), 1));
    geoms.push(g);
  });
  if (!geoms.length) return null;
  const geom = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false) ?? geoms[0];
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  const mesh = new THREE.Mesh(geom);
  mesh.name = node.name;
  mesh.userData = { ...node.userData, bow_axis: node.userData?.bow_axis ?? '+X' };
  applyWorldMaterial(mesh);
  mesh.matrixAutoUpdate = true;
  makeKit(mesh);
  return mesh;
}

function lum(r: number, g: number, b: number) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

function makeKit(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const pa = g.getAttribute('paint') as THREE.BufferAttribute;
  const n = col.count;
  const orig = new Float32Array(col.array as Float32Array);
  const group = new Uint8Array(n);
  for (let i = 0; i < n; i++) group[i] = pa.getX(i);
  const best = new Float32Array(PAINT_GROUPS.length);
  for (let i = 0; i < n; i++) best[group[i]] = Math.max(best[group[i]], lum(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]));
  const shade = new Float32Array(n);
  for (let i = 0; i < n; i++) shade[i] = best[group[i]] > 0 ? lum(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]) / best[group[i]] : 1;
  // collapse the baked pennant; remember where it hung
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const fi = PAINT_GROUPS.indexOf('flag');
  const fv: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) if (group[i] === fi) fv.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  const kit: PaintKit = { orig, group, shade, flag: null, flagBase: null, flagLen: 1 };
  if (fv.length >= 3) {
    // luff = the x two pennant corners share (the mast side)
    let luffX = fv[0].x;
    for (const a of fv) if (fv.filter((b) => Math.abs(b.x - a.x) < 0.02).length >= 2) { luffX = a.x; break; }
    const ys = fv.map((v) => v.y);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (let i = 0; i < n; i++) if (group[i] === fi) pos.setXYZ(i, luffX, y1, fv[0].z);
    pos.needsUpdate = true;
    const hgt = Math.max(0.55, (y1 - y0) * 1.4), len = hgt * 1.5;
    const fg = new THREE.PlaneGeometry(len, hgt, 8, 2);
    fg.translate(-len / 2, 0, 0); // luff at x = 0, streams aft (−X: the bow is +X)
    const uv = fg.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); // canvas luff (left) at the mast
    const fm = new THREE.Mesh(fg, flagMaterial());
    fm.position.set(luffX - 0.05, (y0 + y1) / 2 + 0.02, 0);
    fm.name = 'boat_flag';
    mesh.add(fm);
    kit.flag = fm;
    kit.flagBase = new Float32Array(fg.getAttribute('position').array as Float32Array);
    kit.flagLen = len;
  }
  mesh.userData.paintKit = kit;
}

// ------------------------------------------------------------------ paint
const tmpC = new THREE.Color();
/** Apply colours (group → hex; missing = factory colour). Cheap: one pass over ~3k vertices. */
export function applyPaint(mesh: THREE.Object3D | null, paint: Record<string, string> | undefined) {
  const kit = mesh?.userData.paintKit as PaintKit | undefined;
  if (!mesh || !kit) return false;
  const geom = (mesh as THREE.Mesh).geometry;
  const col = geom.getAttribute('color') as THREE.BufferAttribute;
  const arr = col.array as Float32Array;
  const lin: (THREE.Color | null)[] = PAINT_GROUPS.map((g) => (paint?.[g] ? new THREE.Color(paint[g]) : null));
  for (let i = 0; i < kit.group.length; i++) {
    const c = lin[kit.group[i]];
    if (c) { const s = kit.shade[i]; arr[i * 3] = c.r * s; arr[i * 3 + 1] = c.g * s; arr[i * 3 + 2] = c.b * s; }
    else { arr[i * 3] = kit.orig[i * 3]; arr[i * 3 + 1] = kit.orig[i * 3 + 1]; arr[i * 3 + 2] = kit.orig[i * 3 + 2]; }
  }
  col.needsUpdate = true;
  return true;
}

export const isPaintable = (mesh: THREE.Object3D | null) => !!mesh?.userData.paintKit;

/** Factory colour of a group (for the "as built" swatch), as #hex. */
export function factoryHex(mesh: THREE.Object3D | null, group: PaintGroup) {
  const kit = mesh?.userData.paintKit as PaintKit | undefined;
  if (!kit) return '#cccccc';
  const gi = PAINT_GROUPS.indexOf(group);
  let bi = -1, bl = -1;
  for (let i = 0; i < kit.group.length; i++) if (kit.group[i] === gi) { const l = lum(kit.orig[i * 3], kit.orig[i * 3 + 1], kit.orig[i * 3 + 2]); if (l > bl) { bl = l; bi = i; } }
  if (bi < 0) return '#cccccc';
  return '#' + tmpC.setRGB(kit.orig[bi * 3], kit.orig[bi * 3 + 1], kit.orig[bi * 3 + 2], THREE.LinearSRGBColorSpace).getHexString();
}

// ------------------------------------------------------------------ flags
const flagTex = new Map<string, THREE.CanvasTexture>();
let sharedFlagMat: THREE.MeshBasicMaterial | null = null;
function flagMaterial() {
  if (!sharedFlagMat) {
    sharedFlagMat = register(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: false, alphaTest: 0.5 }));
    sharedFlagMat.map = flagTexture(FLAGS[0]);
  }
  // one material per boat so two boats can fly different flags
  const m = register(sharedFlagMat.clone());
  return m;
}

/** Draw a motif flag (128×80) — flat colours, positive/negative space. Cached per flag id. */
export function flagTexture(f: FlagDef): THREE.CanvasTexture {
  const hit = flagTex.get(f.id);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 80;
  drawFlag(cv.getContext('2d')!, f, 128, 80);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  flagTex.set(f.id, t);
  return t;
}

/** Shared by the 3D flag and the shipwright swatches (luff on the LEFT). */
export function drawFlag(c: CanvasRenderingContext2D, f: FlagDef, w: number, h: number) {
  c.clearRect(0, 0, w, h);
  const cy = h / 2;
  if (f.motif === 'pennant') {
    c.fillStyle = f.field;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(w, cy); c.lineTo(0, h); c.closePath(); c.fill();
    return;
  }
  c.fillStyle = f.field;
  c.fillRect(0, 0, w, h);
  const ink = f.ink, field = f.field;
  const circle = (x: number, y: number, r: number, col: string) => { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  const crescent = (x: number, y: number, r: number, dx: number, dy: number, col: string, bg: string) => { circle(x, y, r, col); circle(x + dx, y + dy, r * 0.86, bg); };
  /** Salish trigon: a triangle with concave sides */
  const trigon = (x: number, y: number, r: number, rot: number, col: string) => {
    const p = [0, 1, 2].map((k) => [x + r * Math.cos(rot + (k * 2 * Math.PI) / 3), y + r * Math.sin(rot + (k * 2 * Math.PI) / 3)]);
    c.fillStyle = col; c.beginPath(); c.moveTo(p[0][0], p[0][1]);
    for (let k = 0; k < 3; k++) { const a = p[k], b = p[(k + 1) % 3]; c.quadraticCurveTo((a[0] + b[0]) / 2 * 0.55 + x * 0.45, (a[1] + b[1]) / 2 * 0.55 + y * 0.45, b[0], b[1]); }
    c.closePath(); c.fill();
  };
  const cx = w * 0.45;
  switch (f.motif) {
    case 'crescent': crescent(cx, cy, h * 0.32, h * 0.13, -h * 0.06, ink, field); break;
    case 'tide':
      c.fillStyle = ink; c.fillRect(0, h * 0.68, w, h * 0.32);
      for (let i = 0; i < 6; i++) trigon(w * (0.1 + i * 0.17), h * 0.52, h * 0.17, Math.PI / 2, ink);
      break;
    case 'moon':
      circle(cx, cy, h * 0.36, ink); circle(cx, cy, h * 0.27, field); crescent(cx, cy, h * 0.2, h * 0.08, 0, ink, field); break;
    case 'trigons':
      for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3; trigon(cx + Math.cos(a) * h * 0.22, cy + Math.sin(a) * h * 0.22, h * 0.15, a, ink); }
      circle(cx, cy, h * 0.07, ink); break;
    case 'split':
      circle(cx, cy, h * 0.34, ink); crescent(cx - h * 0.05, cy, h * 0.24, -h * 0.12, 0, field, ink); circle(cx + h * 0.08, cy, h * 0.09, field); break;
    case 'eye':
      crescent(cx - h * 0.2, cy, h * 0.3, -h * 0.12, 0, ink, field); crescent(cx + h * 0.2, cy, h * 0.3, h * 0.12, 0, ink, field); circle(cx, cy, h * 0.12, ink); break;
    case 'stars':
      crescent(w * 0.3, cy, h * 0.28, h * 0.11, -h * 0.05, ink, field);
      for (const [x, y, r] of [[0.62, 0.3, 0.07], [0.78, 0.55, 0.05], [0.66, 0.74, 0.06], [0.88, 0.28, 0.04]]) circle(w * x, h * y, h * r, ink);
      break;
  }
  // hoist strip (rope sleeve) in the ink colour
  c.fillStyle = ink === field ? '#24221F' : ink; c.fillRect(0, 0, w * 0.04, h);
}

export function setFlag(mesh: THREE.Object3D | null, flagId: string) {
  const kit = mesh?.userData.paintKit as PaintKit | undefined;
  if (!kit?.flag) return;
  const f = FLAGS.find((x) => x.id === flagId) ?? FLAGS[0];
  const m = kit.flag.material as THREE.MeshBasicMaterial;
  m.map = flagTexture(f);
  m.needsUpdate = true;
}

let flutterT = 0;
/** Flag flutter: in-place sine wave along the fly, stronger with boat speed. No allocations. */
export function updateFlag(mesh: THREE.Object3D | null, dt: number, speed01: number) {
  const kit = mesh?.userData.paintKit as PaintKit | undefined;
  if (!kit?.flag || !kit.flagBase || !mesh!.visible) return;
  flutterT += dt;
  const pos = kit.flag.geometry.getAttribute('position') as THREE.BufferAttribute;
  const a = pos.array as Float32Array, b = kit.flagBase;
  const amp = 0.05 + 0.09 * speed01, freq = 6 + 6 * speed01;
  for (let i = 0; i < pos.count; i++) {
    const x = b[i * 3];
    const k = -x / kit.flagLen; // 0 at the luff → 1 at the fly
    a[i * 3 + 2] = b[i * 3 + 2] + Math.sin(flutterT * freq + x * 5) * amp * k;
    a[i * 3 + 1] = b[i * 3 + 1] - k * k * 0.06 * (1 - speed01);
  }
  pos.needsUpdate = true;
}
