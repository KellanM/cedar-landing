import * as THREE from 'three';
import { applyWorldMaterial } from '../render/materials';
import type { Gameplay, Instances, LoadedChunk, LoadedWorld, TimeOfDay } from './types';

/**
 * Tiny built-in world used until the Blender export lands (game/public/world/READY).
 * Produces exactly the same LoadedWorld shape as the real loader, including a landgrid.
 */

// Palette roughly from salish_sea_bible / ref_locations (silver overcast).
const C = {
  seabed: new THREE.Color('#6F8A7E'),
  pebble: new THREE.Color('#A79E8C'),
  grass: new THREE.Color('#7D8B55'),
  bald: new THREE.Color('#B59A5C'),
  fir: new THREE.Color('#3E5A3F'),
  rock: new THREE.Color('#858A86'),
  plank: new THREE.Color('#7A5236'),
  plankDark: new THREE.Color('#5B3D2A'),
  cannery: new THREE.Color('#A8392E'),
  roof: new THREE.Color('#4B4F52'),
  white: new THREE.Color('#E9E6DC'),
  snow: new THREE.Color('#EEF1F4'),
  mtnRock: new THREE.Color('#8C9BAE'),
  hills: new THREE.Color('#5E7268'),
  cloud: new THREE.Color('#F2F3F2'),
  buoyR: new THREE.Color('#B23A32'),
  buoyG: new THREE.Color('#3C7A4A'),
};

interface Island { cx: number; cz: number; r: number; h: number; seed: number }
const ISLANDS: Island[] = [
  { cx: -70, cz: -30, r: 34, h: 16, seed: 1 }, // "Kiln Point"
  { cx: 55, cz: 70, r: 22, h: 9, seed: 2 }, // "Madrona Key"
  { cx: 100, cz: -150, r: 48, h: 26, seed: 3 }, // Cedar Landing island
  { cx: -15, cz: -95, r: 10, h: 4, seed: 4 }, // islet
  { cx: -120, cz: 80, r: 26, h: 12, seed: 5 },
];

function hash(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function radiusAt(isl: Island, ang: number) {
  let k = 1;
  for (let i = 1; i <= 3; i++) k += 0.12 / i * Math.sin(ang * (i + 1) + isl.seed * 3.7 * i);
  return isl.r * k;
}
function islandHeight(isl: Island, x: number, z: number) {
  const dx = x - isl.cx, dz = z - isl.cz;
  const d = Math.hypot(dx, dz) / radiusAt(isl, Math.atan2(dz, dx));
  const t = Math.max(0, 1 - d * d);
  return isl.h * Math.pow(t, 1.4) - 1.2 + 1.2 * Math.max(0, 1 - d);
}
export function heightAt(x: number, z: number) {
  let h = -6;
  for (const isl of ISLANDS) h = Math.max(h, islandHeight(isl, x, z));
  return h;
}

function colorFor(h: number, slope: number, rnd: number) {
  if (h < 0.1) return C.seabed;
  if (h < 1.0) return C.pebble;
  if (slope > 1.1) return C.rock;
  if (h < 3 && rnd > 0.5) return C.bald;
  if (h < 5) return C.grass;
  return rnd > 0.25 ? C.fir : C.grass;
}

/** Flat-shaded polar mesh with per-face colours (faces already split like the export). */
function islandGeometry(isl: Island) {
  const rings = 14, segs = 40;
  const pts: THREE.Vector3[][] = [];
  for (let i = 0; i <= rings; i++) {
    const row: THREE.Vector3[] = [];
    const f = (i / rings) * 1.25;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const r = radiusAt(isl, a) * f;
      const x = isl.cx + Math.cos(a) * r, z = isl.cz + Math.sin(a) * r;
      row.push(new THREE.Vector3(x, Math.max(-3, islandHeight(isl, x, z)), z));
    }
    pts.push(row);
  }
  const pos: number[] = [], col: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, salt: number) => {
    const h = (a.y + b.y + c.y) / 3;
    const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const slope = Math.sqrt(1 - n.y * n.y) / Math.max(0.05, Math.abs(n.y));
    const cc = colorFor(h, slope, hash(salt + isl.seed * 1000));
    const shade = 0.92 + 0.08 * hash(salt * 3.1);
    for (const v of [a, b, c]) {
      pos.push(v.x, v.y, v.z);
      col.push(cc.r * shade, cc.g * shade, cc.b * shade);
    }
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      if (i === 0) {
        tri(pts[0][0], pts[1][j2], pts[1][j], j);
        continue;
      }
      tri(pts[i][j], pts[i][j2], pts[i + 1][j], i * 100 + j);
      tri(pts[i][j2], pts[i + 1][j2], pts[i + 1][j], i * 100 + j + 50);
    }
  }
  return geomFrom(pos, col);
}

function geomFrom(pos: number[], col: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Non-indexed coloured box, faces lightly shaded so it reads without lighting. */
function box(w: number, h: number, d: number, c: THREE.Color, m: THREE.Matrix4) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.applyMatrix4(m);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const shades = [0.86, 0.86, 1.0, 0.7, 0.94, 0.78];
  for (let i = 0; i < n; i++) {
    const s = shades[Math.floor(i / 6)];
    col[i * 3] = c.r * s; col[i * 3 + 1] = c.g * s; col[i * 3 + 2] = c.b * s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}
function colorize(g: THREE.BufferGeometry, c: THREE.Color, shadeBy = true) {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const s = shadeBy ? 0.8 + 0.2 * hash(i * 0.37) : 1;
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = c.r * s; col[(i + k) * 3 + 1] = c.g * s; col[(i + k) * 3 + 2] = c.b * s;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const M = (x: number, y: number, z: number, ry = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));

// Cedar Landing village layout (on the SW shore of the big island, facing the spawn).
const PIER = { x0: 74, z0: -110, x1: 64, z1: -92, w: 3 };
const pierAng = Math.atan2(PIER.x1 - PIER.x0, PIER.z1 - PIER.z0);

function villageGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const len = Math.hypot(PIER.x1 - PIER.x0, PIER.z1 - PIER.z0);
  const mx = (PIER.x0 + PIER.x1) / 2, mz = (PIER.z0 + PIER.z1) / 2;
  parts.push(box(PIER.w, 0.3, len, C.plank, M(mx, 1.2, mz, pierAng)));
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = PIER.x0 + (PIER.x1 - PIER.x0) * t, z = PIER.z0 + (PIER.z1 - PIER.z0) * t;
    for (const s of [-1, 1]) {
      const ox = Math.cos(pierAng) * s * 1.3, oz = -Math.sin(pierAng) * s * 1.3;
      parts.push(box(0.35, 3, 0.35, C.plankDark, M(x + ox, -0.3, z + oz)));
    }
  }
  // Fish market (cannery red) + plank houses on stilts
  parts.push(box(7, 4, 6, C.cannery, M(80, 3.2, -113, pierAng)));
  parts.push(box(7.6, 0.6, 6.6, C.roof, M(80, 5.4, -113, pierAng)));
  parts.push(box(2.2, 1.4, 0.2, C.white, M(77.6, 3.6, -110.2, pierAng)));
  const houses = [[92, -108], [104, -112], [86, -122], [98, -124]];
  houses.forEach(([x, z], i) => {
    parts.push(box(6, 3.2, 5, i % 2 ? C.plank : C.plankDark, M(x, heightAt(x, z) + 1.6, z, 0.3 * i)));
    parts.push(box(6.6, 0.5, 5.6, C.roof, M(x, heightAt(x, z) + 3.4, z, 0.3 * i)));
  });
  // Lookout tower with pennant (landmark for the compass)
  parts.push(box(1.2, 18, 1.2, C.plankDark, M(112, heightAt(112, -150) + 9, -150)));
  parts.push(box(3, 2, 3, C.white, M(112, heightAt(112, -150) + 19, -150)));
  parts.push(box(0.1, 1, 2, C.cannery, M(112, heightAt(112, -150) + 21.5, -149)));
  return parts;
}

function buoyGeometry(x: number, z: number, c: THREE.Color) {
  return [
    colorize(new THREE.CylinderGeometry(0.4, 0.5, 1.6, 8).translate(x, 0.5, z), c),
    colorize(new THREE.ConeGeometry(0.35, 0.7, 8).translate(x, 1.6, z), C.white),
  ];
}

function merge(parts: THREE.BufferGeometry[]) {
  let total = 0;
  for (const p of parts) total += p.getAttribute('position').count;
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    const pp = p.getAttribute('position'), cc = p.getAttribute('color');
    for (let i = 0; i < pp.count; i++) {
      pos[(o + i) * 3] = pp.getX(i); pos[(o + i) * 3 + 1] = pp.getY(i); pos[(o + i) * 3 + 2] = pp.getZ(i);
      col[(o + i) * 3] = cc.getX(i); col[(o + i) * 3 + 1] = cc.getY(i); col[(o + i) * 3 + 2] = cc.getZ(i);
    }
    o += pp.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function mountains() {
  const parts: THREE.BufferGeometry[] = [];
  const peaks = [
    { a: -2.4, d: 4700, h: 900, r: 1500 }, { a: -2.0, d: 4900, h: 760, r: 1300 }, { a: -2.7, d: 4800, h: 820, r: 1400 },
    { a: -0.9, d: 5400, h: 820, r: 1300 }, { a: 0.6, d: 6800, h: 1080, r: 2200 }, { a: 1.6, d: 7600, h: 600, r: 1800 },
  ];
  for (const p of peaks) {
    const x = Math.sin(p.a) * p.d, z = -Math.cos(p.a) * p.d;
    const g = new THREE.ConeGeometry(p.r, p.h, 9, 3).translate(x, p.h / 2 - 20, z).toNonIndexed();
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const c = y > p.h * 0.62 ? C.snow : C.mtnRock;
      const s = 0.85 + 0.15 * hash(i + p.a * 10);
      for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r * s; col[(i + k) * 3 + 1] = c.g * s; col[(i + k) * 3 + 2] = c.b * s; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    parts.push(g);
  }
  // Low hill ring at ~2 km
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, d = 2100 + 200 * hash(i);
    const h = 110 + 150 * hash(i + 9);
    parts.push(colorize(new THREE.ConeGeometry(500 + 200 * hash(i * 2), h, 7).translate(Math.sin(a) * d, h / 2 - 5, -Math.cos(a) * d), C.hills));
  }
  return merge(parts);
}

function clouds() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const a = hash(i * 7.1) * Math.PI * 2, d = 900 + 2500 * hash(i * 3.3);
    const g = new THREE.SphereGeometry(1, 7, 4).scale(220 + 200 * hash(i), 30, 120 + 90 * hash(i + 1));
    g.translate(Math.sin(a) * d, 520 + 200 * hash(i + 4), -Math.cos(a) * d);
    parts.push(colorize(g, C.cloud, false));
  }
  return merge(parts);
}

// Protos (origin at base)
function protoFir(scale: number, c: THREE.Color) {
  const parts = [colorize(new THREE.CylinderGeometry(0.25, 0.35, 2, 5).translate(0, 1, 0), C.plankDark)];
  for (let i = 0; i < 3; i++) parts.push(colorize(new THREE.ConeGeometry(2.4 - i * 0.6, 3.4, 6).translate(0, 2.6 + i * 2.1, 0), c));
  const g = merge(parts);
  g.scale(scale, scale, scale);
  g.computeBoundingBox();
  return g;
}
function protoBush() {
  return merge([colorize(new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.6, 1).translate(0, 0.3, 0), new THREE.Color('#4F7A3E'))]);
}

export function placeholderBoat() {
  const hull = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.45, 0.42, 2.4).translate(0, 0.3, 0);
  const rim = new THREE.TorusGeometry(1, 0.05, 3, 16).rotateX(Math.PI / 2).scale(0.45, 1, 2.4).translate(0, 0.3, 0);
  const body = new THREE.CylinderGeometry(0.18, 0.24, 0.6, 6).translate(0, 0.55, 0.5);
  const head = new THREE.IcosahedronGeometry(0.16, 0).translate(0, 1.0, 0.5);
  const hat = new THREE.ConeGeometry(0.28, 0.16, 8).translate(0, 1.17, 0.5);
  const g = merge([
    colorize(hull, new THREE.Color('#8A4B2E')),
    colorize(rim, new THREE.Color('#5B2E1C'), false),
    colorize(body, new THREE.Color('#C7A24A')),
    colorize(head, new THREE.Color('#C99474')),
    colorize(hat, new THREE.Color('#6E5A3A')),
  ]);
  const mesh = new THREE.Mesh(g);
  mesh.name = 'BOAT_T0_placeholder';
  applyWorldMaterial(mesh);
  return mesh;
}

export const DEFAULT_TOD: Record<string, TimeOfDay> = {
  overcast: { zenith: '#B8C2CA', horizon: '#D9DEE0', sea: '#4E6670', shallow: '#6F8A7E', haze: '#C7CED1', tint: [1, 1, 1] },
  dawn: { zenith: '#6E7FA3', horizon: '#F2C6B4', sea: '#4C6078', shallow: '#7C8F96', haze: '#C9C2CC', tint: [1.05, 0.93, 0.9] },
  marine_layer: { zenith: '#C4CACE', horizon: '#E1E4E3', sea: '#56676C', shallow: '#7E8F86', haze: '#D3D8D8', tint: [1.02, 1.02, 1.02] },
  sunbreak: { zenith: '#4F86B8', horizon: '#BFD6E4', sea: '#2F5F78', shallow: '#4F8A80', haze: '#A9C0CF', tint: [1.1, 1.07, 1.0] },
  dusk: { zenith: '#3B4A72', horizon: '#F0A868', sea: '#3A4560', shallow: '#5A5E78', haze: '#8E7E98', tint: [1.0, 0.78, 0.72] },
  fog: { zenith: '#DADDDC', horizon: '#D5D9D8', sea: '#8D9A9A', shallow: '#9AA7A2', haze: '#D5D9D8', tint: [0.96, 0.98, 0.98] },
  night: { zenith: '#141C2E', horizon: '#26304A', sea: '#0E1620', shallow: '#1A2633', haze: '#1E2638', tint: [0.32, 0.38, 0.55] },
};

function buildLandgrid(extraBlocked: (x: number, z: number) => boolean) {
  const originX = -260, originZ = -320, cell = 2, w = 260, h = 260;
  const bytes = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const x = originX + (c + 0.5) * cell, z = originZ + (r + 0.5) * cell;
      bytes[r * w + c] = heightAt(x, z) > 0.3 || extraBlocked(x, z) ? 1 : 0;
    }
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { originX, originZ, cell, w, h, data: btoa(bin) };
}

function onPier(x: number, z: number) {
  const dx = PIER.x1 - PIER.x0, dz = PIER.z1 - PIER.z0;
  const L2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - PIER.x0) * dx + (z - PIER.z0) * dz) / L2));
  const px = PIER.x0 + dx * t, pz = PIER.z0 + dz * t;
  return Math.hypot(x - px, z - pz) < PIER.w / 2 + 0.6;
}

export function buildPlaceholderWorld(): LoadedWorld {
  const chunks: LoadedChunk[] = [];
  const addChunk = (g: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(g);
    applyWorldMaterial(mesh);
    const bounds = g.boundingBox!.clone();
    chunks.push({ object: mesh, bounds, center: bounds.getCenter(new THREE.Vector3()) });
  };
  for (const isl of ISLANDS) addChunk(islandGeometry(isl));
  addChunk(merge([...villageGeometry(), ...buoyGeometry(-40, -40, C.buoyG), ...buoyGeometry(20, -60, C.buoyR), ...buoyGeometry(30, -30, C.buoyG)]));

  const bd = new THREE.Mesh(mountains());
  applyWorldMaterial(bd, 'backdrop');
  const cl = new THREE.Mesh(clouds());
  applyWorldMaterial(cl, 'clouds');

  const protos = new Map<string, THREE.BufferGeometry>();
  protos.set('PT_fir_a', protoFir(1, C.fir));
  protos.set('PT_cedar_a', protoFir(0.8, new THREE.Color('#4A6B3E')));
  protos.set('FOL_salal_bush', protoBush());

  const inst: Instances = { protos: { PT_fir_a: [], PT_cedar_a: [], FOL_salal_bush: [] } };
  let seed = 11;
  const q = new THREE.Quaternion();
  for (const isl of ISLANDS) {
    const n = Math.round(isl.r * isl.r * 0.06);
    for (let i = 0; i < n; i++) {
      const a = hash(seed++) * Math.PI * 2, d = Math.sqrt(hash(seed++)) * isl.r;
      const x = isl.cx + Math.cos(a) * d, z = isl.cz + Math.sin(a) * d;
      const y = islandHeight(isl, x, z);
      if (y < 1.6) continue;
      if (Math.hypot(x - 85, z - 115 * -1) < 22) continue; // keep the village clear
      const s = 0.7 + 0.6 * hash(seed++);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(seed++) * 6.28);
      const key = y > 5 && hash(seed++) > 0.3 ? 'PT_fir_a' : hash(seed++) > 0.5 ? 'PT_cedar_a' : 'FOL_salal_bush';
      inst.protos[key].push([x, y - 0.2, z, q.x, q.y, q.z, q.w, key === 'FOL_salal_bush' ? s * 1.4 : s]);
    }
  }

  const gameplay: Gameplay = {
    spawn: { pos: [0, 0, 40], dir: [0, -1] },
    interacts: [
      { name: 'Interact_SellFish', kind: 'sell_fish', pos: [66, 1.3, -94], props: { prompt: 'Sell fish', label: 'Cedar Landing Fish Market' } },
      { name: 'Interact_MoorBoat', kind: 'moor_boat', pos: [60, 0.2, -97], props: { prompt: 'Moor troller' } },
      { name: 'Interact_BuyTackle', kind: 'buy_tackle', pos: [72, 1.3, -103], props: {} },
      { name: 'Interact_TreasureMap', kind: 'quest_lost_treasure', pos: [-50, 1, -8], props: {} },
    ],
    hotspots: [
      { name: 'LIFE_HS01_ChannelPerch', pos: [-15, 0, -15], biome: 'shallow_shelf', fish_pool: ['shiner perch', 'pile perch', 'kelp greenling'], time_of_day: 'day', act: 0, tier: 'common' },
      { name: 'LIFE_HS02_HerringBall', pos: [30, 0, 5], biome: 'open_channel', fish_pool: ['pacific herring', 'coho salmon', 'pacific sand lance'], time_of_day: 'day', act: 0, tier: 'common' },
      { name: 'LIFE_HS03_KilnKelp', pos: [-36, 0, 4], biome: 'kelp', fish_pool: ['copper rockfish', 'lingcod', 'cabezon', 'quillback rockfish'], time_of_day: 'any', act: 0, tier: 'uncommon' },
      { name: 'LIFE_HS04_LandingShoal', pos: [40, 0, -75], biome: 'shallow_shelf', fish_pool: ['starry flounder', 'english sole', 'staghorn sculpin'], time_of_day: 'any', act: 0, tier: 'common' },
    ],
    buoys: [
      { name: 'POI_ChBuoy_G1', pos: [-40, 0, -40], side: 'L' },
      { name: 'POI_ChBuoy_R1', pos: [20, 0, -60], side: 'R' },
    ],
    cameras: [{ name: 'Shot_VillageReveal', pos: [25, 9, -55], target: [88, 5, -118], fov: 45 }],
    time_of_day: DEFAULT_TOD,
    landgrid: buildLandgrid(onPier),
  };

  return { source: 'placeholder', chunks, backdrops: [bd], clouds: [cl], protos, instances: inst, boat: placeholderBoat(), gameplay };
}
