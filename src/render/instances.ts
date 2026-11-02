import * as THREE from 'three';
import { backdropMat, protoMaterial } from './materials';
import type { Instances } from '../world/types';

const CELL = 120; // matches the export chunk grid
const FAR_CELL = 1500; // PTL* far-hill forests: big cells keep draw calls low
const isFar = (name: string) => name.startsWith('PTL');

interface Batch { mesh: THREE.InstancedMesh; center: THREE.Vector3; small: boolean; far: boolean }

/**
 * One InstancedMesh per proto per 120 m cell, so frustum culling + distance culling work per cell.
 * "Small" protos (< 1 m tall, i.e. understory foliage) get a shorter draw distance and are
 * dropped entirely on low quality.
 */
export class InstanceField {
  group = new THREE.Group();
  batches: Batch[] = [];
  count = 0;

  constructor(instances: Instances, protos: Map<string, THREE.BufferGeometry>, lowQuality: boolean) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const e = new THREE.Euler();
    for (const [name, list] of Object.entries(instances.protos)) {
      let geom = protos.get(name);
      if (!geom || !list.length) continue;
      const far = isFar(name);
      // PTL* far-forest protos are full-detail trees (150–580 tris × ~27k instances ≈ 6.5M tris).
      // At 2+ km they cover a few pixels, so swap in an 8–20 tri impostor with the same colours.
      if (far) geom = impostorFor(name, geom);
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
        this.batches.push({ mesh, center, small, far });
        this.count += items.length;
      }
    }
  }

  /** Distance cull by cell centre. */
  update(cam: THREE.Vector3, drawDist: number, smallDist: number) {
    for (const b of this.batches) {
      if (b.far) continue; // backdrop forests: always drawn (frustum culled only)
      const d = Math.hypot(b.center.x - cam.x, b.center.z - cam.z) - CELL * 0.75;
      b.mesh.visible = d < (b.small ? smallDist : drawDist);
    }
  }

  dispose() {
    for (const b of this.batches) b.mesh.dispose();
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
