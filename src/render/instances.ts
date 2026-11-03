import * as THREE from 'three';
import { backdropMat, protoMaterial, treeMat } from './materials';
import type { Instances } from '../world/types';

const CELL = 120; // matches the export chunk grid
const FAR_CELL = 1500; // PTL* far-hill forests: big cells keep draw calls low
const isFar = (name: string) => name.startsWith('PTL');

interface Batch { mesh: THREE.InstancedMesh; center: THREE.Vector3; small: boolean; far: boolean; parent?: string; shrub?: boolean }

/**
 * Far-tree layer (docs/camera_study.md, horizon camera): with the horizon in frame every island's
 * forest is on screen, and one InstancedMesh per proto per 120 m cell cost ~100–180 draws. Beyond
 * NEAR_TREES the trees of a 240 m parent cell are drawn instead as ONE instanced impostor per shape
 * (conifer cone / broadleaf blob) with a per-instance canopy colour: 2 draws per parent cell.
 */
const PARENT = 240;
/** near: trees swap to impostors beyond this; shrubs: understory (FOL_*) is not drawn beyond this */
export const TREE_LOD = { near: 180, shrubs: 230 };
const TREEISH = /fir|hemlock|cedar|pine|spruce|yew|juniper|madrona|alder|oak|maple|arbutus|willow|cottonwood|birch|^PT_/i;
interface Parent { center: THREE.Vector3; imp: THREE.InstancedMesh[]; detail: Batch[] }

/**
 * One InstancedMesh per proto per 120 m cell, so frustum culling + distance culling work per cell.
 * "Small" protos (< 1 m tall, i.e. understory foliage) get a shorter draw distance and are
 * dropped entirely on low quality.
 */
export class InstanceField {
  group = new THREE.Group();
  batches: Batch[] = [];
  count = 0;
  parents = new Map<string, Parent>();

  constructor(instances: Instances, protos: Map<string, THREE.BufferGeometry>, lowQuality: boolean) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const e = new THREE.Euler();
    for (const [name, list] of Object.entries(instances.protos)) {
      let geom = protos.get(name);
      if (!geom || !list.length) continue;
      const far = isFar(name);
      // PTL* far-forest protos are full-detail trees (150–580 tris × ~27k instances ≈ 6.5M tris).
      // At 2+ km they cover a few pixels, so swap in an 8–20 tri impostor with the same colours.
      if (far) { this.collectFar(name, geom, list, true); continue; } // merged per 1500 m cell (far-tree layer below)
      const bb = geom.boundingBox ?? (geom.computeBoundingBox(), geom.boundingBox!);
      const small = bb.max.y - bb.min.y < 1.0;
      if (small && lowQuality) continue;
      const cell = far ? FAR_CELL : CELL;
      const cells = new Map<string, number[][]>();
      for (const it of list) {
        const key = `${Math.floor(it[0] / cell)},${Math.floor(it[2] / cell)}`;
        let arr = cells.get(key);
        if (!arr) cells.set(key, (arr = []));
        arr.push(it);
      }
      const treeish = !far && !small && TREEISH.test(name);
      if (treeish) this.collectFar(name, geom, list);
      for (const items of cells.values()) {
        const mesh = new THREE.InstancedMesh(geom, far ? backdropMat : protoMaterial(name), items.length);
        const center = new THREE.Vector3();
        items.forEach((it, i) => {
          p.set(it[0], it[1], it[2]);
          if (it.length >= 8) {
            // [x,y,z, qx,qy,qz,qw, s]
            q.set(it[3], it[4], it[5], it[6]);
            s.setScalar(it[7]);
          } else {
            // legacy [x,y,z, rotY, s, (rx, rz)]
            e.set(it[5] ?? 0, it[3] ?? 0, it[6] ?? 0, 'YXZ');
            q.setFromEuler(e);
            s.setScalar(it[4] ?? 1);
          }
          m.compose(p, q, s);
          mesh.setMatrixAt(i, m);
          center.add(p);
        });
        center.divideScalar(items.length);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.matrixAutoUpdate = false;
        mesh.name = name;
        this.group.add(mesh);
        const parent = treeish ? `${Math.floor(center.x / PARENT)},${Math.floor(center.z / PARENT)}` : undefined;
        const b: Batch = { mesh, center, small, far, parent, shrub: /^FOL_/i.test(name) };
        this.batches.push(b);
        if (parent) this.parentFor(parent).detail.push(b);
        this.count += items.length;
      }
    }
  }

  private farLists = new Map<string, { conifer: number[][]; leafy: number[][]; color: number[][] }>();
  private parentFor(key: string) {
    let p = this.parents.get(key);
    if (!p) { const [x, z] = key.split(',').map(Number); p = { center: new THREE.Vector3((x + 0.5) * PARENT, 0, (z + 0.5) * PARENT), imp: [], detail: [] }; this.parents.set(key, p); }
    return p;
  }
  /** Queue a tree proto's instances for the far layer (built in finishFar). */
  private collectFar(name: string, geom: THREE.BufferGeometry, list: number[][], backdrop = false) {
    const info = treeInfo(name, geom);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), e = new THREE.Euler();
    for (const it of list) {
      let s = 1;
      if (it.length >= 8) { q.set(it[3], it[4], it[5], it[6]); s = it[7]; } else { e.set(it[5] ?? 0, it[3] ?? 0, it[6] ?? 0, 'YXZ'); q.setFromEuler(e); s = it[4] ?? 1; }
      // keep only the yaw (impostors stand upright)
      e.setFromQuaternion(q, 'YXZ'); q.setFromEuler(e.set(0, e.y, 0));
      p.set(it[0], it[1] + info.minY * s, it[2]);
      sc.set(info.w * s, info.h * s, info.w * s);
      m.compose(p, q, sc);
      const key = backdrop ? `B${Math.floor(it[0] / FAR_CELL)},${Math.floor(it[2] / FAR_CELL)}` : `${Math.floor(it[0] / PARENT)},${Math.floor(it[2] / PARENT)}`;
      let L = this.farLists.get(key);
      if (!L) this.farLists.set(key, (L = { conifer: [], leafy: [], color: [] }));
      (info.conifer ? L.conifer : L.leafy).push([...m.elements, info.canopy.r, info.canopy.g, info.canopy.b]);
    }
  }
  /** Build the far impostor meshes (call once after the constructor loop). */
  private finishFar() {
    const c = new THREE.Color(), m = new THREE.Matrix4();
    for (const [key, L] of this.farLists) {
      const backdrop = key.startsWith('B');
      const P = backdrop ? null : this.parentFor(key);
      for (const [list, geom] of [[L.conifer, unitConifer()], [L.leafy, unitLeafy()]] as const) {
        if (!list.length) continue;
        const mesh = new THREE.InstancedMesh(geom, backdrop ? backdropMat : treeMat, list.length);
        list.forEach((r, i) => { m.fromArray(r, 0); mesh.setMatrixAt(i, m); mesh.setColorAt(i, c.setRGB(r[16], r[17], r[18])); });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.matrixAutoUpdate = false;
        mesh.name = `far_trees_${key}`;
        this.group.add(mesh);
        if (P) { mesh.visible = false; P.imp.push(mesh); }
        else { this.batches.push({ mesh, center: new THREE.Vector3(), small: false, far: true }); this.count += list.length; }
      }
    }
    this.farLists.clear();
  }

  /** Distance cull by cell centre; trees beyond TREE_LOD.near swap to the far impostor layer. */
  update(cam: THREE.Vector3, drawDist: number, smallDist: number) {
    if (this.farLists.size) this.finishFar();
    for (const b of this.batches) {
      if (b.far) continue; // backdrop forests: always drawn (frustum culled only)
      const d = Math.hypot(b.center.x - cam.x, b.center.z - cam.z) - CELL * 0.75;
      b.mesh.visible = d < (b.small ? smallDist : b.shrub ? Math.min(drawDist, TREE_LOD.shrubs) : drawDist);
    }
    for (const P of this.parents.values()) {
      const d = Math.hypot(P.center.x - cam.x, P.center.z - cam.z) - PARENT * 0.71;
      const near = d < TREE_LOD.near;
      if (!near) for (const b of P.detail) b.mesh.visible = false;
      for (const m of P.imp) m.visible = !near && d < drawDist;
    }
  }

  dispose() {
    for (const b of this.batches) b.mesh.dispose();
    for (const P of this.parents.values()) for (const m of P.imp) m.dispose();
    this.group.clear();
  }
}

const CONIFER = /fir|hemlock|cedar|pine|spruce/i;
const impostorCache = new Map<string, THREE.BufferGeometry>();

/** Low-poly stand-in that keeps the proto's height, canopy width and average canopy colour. */
export function impostorFor(name: string, src: THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = impostorCache.get(name);
  if (hit) return hit;
  const bb = src.boundingBox ?? (src.computeBoundingBox(), src.boundingBox!);
  const h = bb.max.y - bb.min.y;
  const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  // average canopy colour (upper 70%) and trunk colour (lowest 15%)
  const pos = src.getAttribute('position'), col = src.getAttribute('color');
  const canopy = new THREE.Color(0, 0, 0), trunk = new THREE.Color(0, 0, 0);
  let nc = 0, nt = 0;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / Math.max(0.01, h);
    if (!col) break;
    if (t > 0.3) { canopy.r += col.getX(i); canopy.g += col.getY(i); canopy.b += col.getZ(i); nc++; }
    else if (t < 0.15) { trunk.r += col.getX(i); trunk.g += col.getY(i); trunk.b += col.getZ(i); nt++; }
  }
  if (nc) canopy.multiplyScalar(1 / nc); else canopy.set(0x3e5a3f);
  if (nt) trunk.multiplyScalar(1 / nt); else trunk.copy(canopy).multiplyScalar(0.6);
  let g: THREE.BufferGeometry;
  if (CONIFER.test(name)) {
    g = new THREE.ConeGeometry(w * 0.42, h * 0.85, 5, 1, true).translate(0, bb.min.y + h * 0.15 + h * 0.425, 0);
  } else {
    g = new THREE.IcosahedronGeometry(0.5, 0).scale(w * 0.9, h * 0.62, w * 0.9).translate(0, bb.min.y + h * 0.62, 0);
  }
  const trunkG = new THREE.CylinderGeometry(w * 0.05, w * 0.07, h * 0.35, 3, 1, true).translate(0, bb.min.y + h * 0.175, 0);
  const parts = [g.toNonIndexed(), trunkG.toNonIndexed()];
  const colors = [canopy, trunk];
  const outPos: number[] = [], outCol: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  parts.forEach((pg, pi) => {
    const pp = pg.getAttribute('position');
    for (let i = 0; i < pp.count; i += 3) {
      a.fromBufferAttribute(pp, i); b.fromBufferAttribute(pp, i + 1); c.fromBufferAttribute(pp, i + 2);
      n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      // fake key light from the SE so faces read as facets, like the baked scenery
      const shade = 0.78 + 0.22 * Math.max(0, n.y * 0.6 + n.x * 0.3 + n.z * 0.4);
      for (const v of [a, b, c]) {
        outPos.push(v.x, v.y, v.z);
        outCol.push(colors[pi].r * shade, colors[pi].g * shade, colors[pi].b * shade);
      }
    }
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  impostorCache.set(name, out);
  return out;
}

/** Proto dimensions + average canopy colour for the far layer. */
function treeInfo(name: string, src: THREE.BufferGeometry) {
  const bb = src.boundingBox ?? (src.computeBoundingBox(), src.boundingBox!);
  const h = bb.max.y - bb.min.y;
  const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  const pos = src.getAttribute('position'), col = src.getAttribute('color');
  const canopy = new THREE.Color(0, 0, 0);
  let nc = 0;
  if (col) for (let i = 0; i < pos.count; i++) {
    if ((pos.getY(i) - bb.min.y) / Math.max(0.01, h) > 0.3) { canopy.r += col.getX(i); canopy.g += col.getY(i); canopy.b += col.getZ(i); nc++; }
  }
  if (nc) canopy.multiplyScalar(1 / nc); else canopy.set(0x3e5a3f);
  return { h, w, minY: bb.min.y, canopy, conifer: CONIFER.test(name) };
}

/** Unit impostors (1 m wide, 1 m tall, base at y 0); vertex colour = facet shade (canopy) / darker trunk. */
let _uc: THREE.BufferGeometry | null = null, _ul: THREE.BufferGeometry | null = null;
function unitConifer() { return (_uc ??= unitTree(new THREE.ConeGeometry(0.42, 0.85, 5, 1, true).translate(0, 0.575, 0))); }
function unitLeafy() { return (_ul ??= unitTree(new THREE.IcosahedronGeometry(0.5, 0).scale(0.9, 0.62, 0.9).translate(0, 0.62, 0))); }
function unitTree(canopy: THREE.BufferGeometry) {
  const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.35, 3, 1, true).translate(0, 0.175, 0);
  const outPos: number[] = [], outCol: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
  [canopy.toNonIndexed(), trunk.toNonIndexed()].forEach((pg, pi) => {
    const pp = pg.getAttribute('position');
    for (let i = 0; i < pp.count; i += 3) {
      a.fromBufferAttribute(pp, i); b.fromBufferAttribute(pp, i + 1); c.fromBufferAttribute(pp, i + 2);
      n.crossVectors(t.copy(b).sub(a), c.clone().sub(a)).normalize();
      const shade = (0.78 + 0.22 * Math.max(0, n.y * 0.6 + n.x * 0.3 + n.z * 0.4)) * (pi ? 0.55 : 1);
      for (const v of [a, b, c]) { outPos.push(v.x, v.y, v.z); outCol.push(shade, shade, shade); }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
