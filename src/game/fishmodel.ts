import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { register } from '../render/materials';

/**
 * Procedural low-poly fish (unit length along +X, nose at +0.5) for leaps, surface rolls and the
 * hold-up. Back = species colour, belly lerped toward paper cream, fins darker, ink eye. Flat facets
 * via baked per-face shading. Two draw calls (body, tail) so the tail can wag.
 */
const L = new THREE.Vector3(0.3, 0.9, 0.3).normalize();
const CREAM = new THREE.Color(0xf4efe3);
const INK = new THREE.Color(0x1d2326);

function shadeFaces(g: THREE.BufferGeometry, colorAt: (y: number, cx: number) => THREE.Color, dark = 0.2) {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv'); ng.deleteAttribute('normal');
  const p = ng.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(t.subVectors(a, b)).normalize();
    const cy = (a.y + b.y + c.y) / 3, cx = (a.x + b.x + c.x) / 3;
    const k = 1 - dark + dark * Math.abs(n.dot(L)) * 1.2;
    const cc = colorAt(cy, cx);
    for (let j = 0; j < 3; j++) { col[(i + j) * 3] = cc.r * k; col[(i + j) * 3 + 1] = cc.g * k; col[(i + j) * 3 + 2] = cc.b * k; }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

export class FishModel {
  group = new THREE.Group();
  private body: THREE.Mesh;
  private tail: THREE.Mesh;
  private tailPivot = new THREE.Group();
  private mat = register(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  private t = 0;
  /** tail wag amplitude (rad), decays toward `wagBase` */
  wag = 0.3;
  wagBase = 0.15;
  wagHz = 6;
  private color = '';

  constructor() {
    this.body = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.tail = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.tailPivot.position.x = -0.36;
    this.tailPivot.add(this.tail);
    this.group.add(this.body, this.tailPivot);
    this.group.visible = false;
    for (const m of [this.body, this.tail]) { m.frustumCulled = false; m.renderOrder = 4; }
  }

  /** Rebuild for a species colour and body depth (height/length). */
  setLook(colorHex: string, depth = 0.28) {
    const key = colorHex + depth;
    if (key === this.color) return;
    this.color = key;
    const back = new THREE.Color(colorHex), belly = back.clone().lerp(CREAM, 0.6), fin = back.clone().multiplyScalar(0.72);
    // body: an 8-sided spindle (nose +X) with a slightly humped back
    const body = new THREE.LatheGeometry([
      new THREE.Vector2(0, -0.5), new THREE.Vector2(0.55, -0.32), new THREE.Vector2(0.62, -0.05), new THREE.Vector2(0.5, 0.2), new THREE.Vector2(0.24, 0.4), new THREE.Vector2(0, 0.5),
    ], 8).rotateZ(-Math.PI / 2).scale(0.82, depth, depth * 0.55);
    const bodyG = shadeFaces(body, (y) => (y > 0.0 ? back : belly));
    const dorsal = shadeFaces(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.12, depth * 0.3, 0), new THREE.Vector3(-0.2, depth * 0.3, 0), new THREE.Vector3(-0.12, depth * 0.62, 0)]), () => fin, 0);
    const pect = shadeFaces(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.16, -depth * 0.05, depth * 0.15), new THREE.Vector3(0.02, -depth * 0.12, depth * 0.3), new THREE.Vector3(0.04, -depth * 0.02, depth * 0.15)]), () => fin, 0);
    const eye = shadeFaces(new THREE.OctahedronGeometry(0.035).translate(0.3, depth * 0.08, depth * 0.15), () => INK, 0);
    const eye2 = shadeFaces(new THREE.OctahedronGeometry(0.035).translate(0.3, depth * 0.08, -depth * 0.15), () => INK, 0);
    this.body.geometry.dispose();
    this.body.geometry = mergeGeometries([bodyG, dorsal, pect, eye, eye2])!;
    const tail = shadeFaces(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0.02, 0, 0), new THREE.Vector3(-0.2, depth * 0.55, 0), new THREE.Vector3(-0.14, 0, 0),
      new THREE.Vector3(0.02, 0, 0), new THREE.Vector3(-0.14, 0, 0), new THREE.Vector3(-0.2, -depth * 0.5, 0),
    ]), () => fin, 0);
    this.tail.geometry.dispose();
    this.tail.geometry = tail;
  }

  /** kick the tail (flop) */
  flop(a = 0.6) { this.wag = Math.max(this.wag, a); }

  update(dt: number) {
    this.t += dt;
    this.wag += (this.wagBase - this.wag) * Math.min(1, dt * 1.5);
    const w = Math.sin(this.t * Math.PI * 2 * this.wagHz) * this.wag;
    this.tailPivot.rotation.y = w;
    this.body.rotation.y = -w * 0.3;
  }
}
