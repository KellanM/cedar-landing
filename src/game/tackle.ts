import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { register } from '../render/materials';

/**
 * Bobber + fishing line, built for readability at phone size (docs/study/fishing_polish.md):
 *  - oversized float (≈3× real) with a red cap, cream belly, ink stick and a yellow tip, all with a
 *    dark inverted-hull outline so it separates from both slate water and white foam;
 *  - a flat cream waterline ring around it (Webfishing) plus a slow idle ripple;
 *  - a screen-size floor: the float scales up with camera distance so it never drops below ≈ 20 px;
 *  - the line is a camera-facing ribbon with sag (slack ↔ taut) and a "singing" jitter near the limit.
 * Unlit vertex colour with baked per-face shading, two tones per part, no textures.
 */

export const TACKLE_TUNING = {
  bobberScale: 1, // base multiplier on the float
  screenFloor: 13, // m of camera distance at which the float starts growing to hold its screen size
  lineWidth: 0.0024, // ribbon width per metre of camera distance (≈ 1.6 css px on phone)
};

const SEA_Y = -0.06;
const L = new THREE.Vector3(0.45, 0.8, 0.35).normalize();

/** Paint a geometry one colour with baked flat facet shading (toNonIndexed so every face is flat). */
function paint(g: THREE.BufferGeometry, hex: number, shade = 0.22): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  ng.deleteAttribute('normal');
  const pos = ng.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(hex);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); d.fromBufferAttribute(pos, i + 2);
    n.subVectors(d, b).cross(a.clone().sub(b)).normalize();
    const k = 1 - shade + shade * Math.max(0, -n.dot(L)) * 1.4;
    for (let j = 0; j < 3; j++) { col[(i + j) * 3] = c.r * k; col[(i + j) * 3 + 1] = c.g * k; col[(i + j) * 3 + 2] = c.b * k; }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}
const strip = (g: THREE.BufferGeometry) => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); ng.deleteAttribute('normal'); return ng; };

export class Bobber {
  group = new THREE.Group();
  /** float body (pivot at the waterline) */
  private body = new THREE.Group();
  private ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private ripple: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private rippleT = 0;
  /** world height of the line attachment (stick tip) */
  readonly top = new THREE.Vector3();
  private dipV = 0; // spring velocity
  private dipY = 0; // current offset (m, negative = under)
  private squash = 0;
  private tilt = new THREE.Vector2();
  /** extra screen-size scale applied this frame */
  screenK = 1;
  private t = 0;

  constructor() {
    const R = 0.17;
    // belly (cream, lower hemisphere stretched down a little) + cap (red) + white band + stick + tip
    const belly = paint(new THREE.SphereGeometry(R, 7, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 1.25, 1), 0xf3ecdc);
    const cap = paint(new THREE.SphereGeometry(R, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.05, 1), 0xd8432c);
    const band = paint(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.035, 7, 1, true).translate(0, 0.02, 0), 0xf8f4ea, 0.1);
    const stick = paint(new THREE.CylinderGeometry(0.018, 0.022, 0.3, 4).translate(0, R + 0.15, 0), 0x2a2a28, 0.05);
    const tip = paint(new THREE.OctahedronGeometry(0.065).scale(1, 1.4, 1).translate(0, R + 0.32, 0), 0xffcf33, 0.3);
    const bodyG = mergeGeometries([belly, cap, band, stick, tip])!;
    const mat = register(new THREE.MeshBasicMaterial({ vertexColors: true }));
    const mesh = new THREE.Mesh(bodyG, mat);
    // inverted-hull outline (one draw): body + tip
    const ob = strip(new THREE.SphereGeometry(R * 1.2, 7, 5).scale(1, 1.15, 1).translate(0, -0.015, 0));
    const ot = strip(new THREE.OctahedronGeometry(0.1).scale(1, 1.3, 1).translate(0, R + 0.32, 0));
    const os = strip(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 4).translate(0, R + 0.15, 0));
    const outline = new THREE.Mesh(mergeGeometries([ob, ot, os])!, new THREE.MeshBasicMaterial({ color: 0x182226, side: THREE.BackSide }));
    this.body.add(outline, mesh);
    this.group.add(this.body);

    // waterline ring + idle ripple (flat, cream; lie on the sea surface, not on the float)
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.34, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf6eedb, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf6eedb, transparent: true, opacity: 0, depthWrite: false }));
    this.ring.renderOrder = 3;
    this.ripple.renderOrder = 3;
    this.group.add(this.ring, this.ripple);
    for (const m of [mesh, outline]) m.renderOrder = 4;
  }

  /** Small dip (nibble) or a plunge (bite): an impulse into the damped spring. */
  kick(depth: number) { this.dipV -= depth * 18; this.rippleT = 0; }
  /** squash on plop */
  plop() { this.squash = 1; this.rippleT = 0; }

  /**
   * @param held  extra steady offset (m, negative = held under, e.g. during the bite)
   * @param lean  world-space xz direction the float leans toward (line pull), 0..1 strength in length
   */
  update(dt: number, x: number, z: number, camDist: number, held: number, leanX: number, leanZ: number, onWater: boolean, airY = 0) {
    this.t += dt;
    // damped spring for dips (k 140, c 14 → a quick plunk and a little bob back)
    const a = -140 * (this.dipY - held) - 14 * this.dipV;
    this.dipV += a * dt;
    this.dipY += this.dipV * dt;
    this.squash = Math.max(0, this.squash - dt * 6);
    this.screenK = Math.min(2.3, Math.max(1, camDist / TACKLE_TUNING.screenFloor)) * TACKLE_TUNING.bobberScale;
    const s = this.screenK;
    const bob = onWater ? Math.sin(this.t * 2.6) * 0.025 + Math.sin(this.t * 1.7 + 1) * 0.012 : 0;
    const y = onWater ? SEA_Y + 0.07 * s + (this.dipY + bob) * s : airY;
    this.group.position.set(x, 0, z);
    this.body.position.set(0, y, 0);
    const sq = Math.sin(this.squash * Math.PI) * 0.35;
    this.body.scale.set(s * (1 + sq * 0.6), s * (1 - sq), s * (1 + sq * 0.6));
    // lean toward the line + a little wobble
    this.tilt.x += (leanX * 0.5 + Math.sin(this.t * 2.1) * 0.06 - this.tilt.x) * Math.min(1, dt * 8);
    this.tilt.y += (leanZ * 0.5 + Math.cos(this.t * 1.8) * 0.06 - this.tilt.y) * Math.min(1, dt * 8);
    this.body.rotation.set(this.tilt.y, 0, -this.tilt.x);
    // rings sit on the water only when the float does
    this.ring.visible = onWater;
    this.ring.position.y = SEA_Y + 0.025;
    const under = Math.max(0, -this.dipY);
    this.ring.scale.setScalar(s * (1 + under * 1.2 + Math.sin(this.t * 2.6) * 0.04));
    this.ring.material.opacity = 0.9;
    this.rippleT += dt;
    const rk = (this.rippleT % 1.6) / 1.6;
    this.ripple.visible = onWater;
    this.ripple.position.y = SEA_Y + 0.02;
    this.ripple.scale.setScalar(s * (0.4 + rk * 0.9));
    this.ripple.material.opacity = 0.55 * (1 - rk);
    // stick tip in world (for the line)
    this.top.set(x, y + (0.17 + 0.25) * s, z);
  }
}

/** Camera-facing ribbon line with a quadratic sag. One draw call, no allocation per frame. */
export class LineRibbon {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private N = 20;
  private pos: Float32Array;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private p = new THREE.Vector3();
  private q = new THREE.Vector3();
  private side = new THREE.Vector3();
  private toCam = new THREE.Vector3();
  private t = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((this.N + 1) * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < this.N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
    this.mesh.material.userData.lineColor = new THREE.Color(0xf7efd9);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** tension 0 (slack) … 1 (singing). sagK: extra sag multiplier (casting). */
  update(dt: number, from: THREE.Vector3, to: THREE.Vector3, cam: THREE.Vector3, tension: number, sagK = 1) {
    this.t += dt;
    const len = from.distanceTo(to);
    const sag = Math.pow(1 - Math.min(1, tension), 2) * 0.14 * len * sagK + 0.02;
    const jit = tension > 0.85 ? Math.sin(this.t * 190) * 0.03 * (tension - 0.85) / 0.15 : 0;
    this.a.copy(from); this.c.copy(to);
    this.b.copy(from).lerp(to, 0.5);
    this.b.y -= sag * 2; // control point: midpoint sags by `sag`
    const camD = cam.distanceTo(this.b);
    const w = Math.max(0.012, camD * TACKLE_TUNING.lineWidth) * 0.5;
    const N = this.N;
    for (let i = 0; i <= N; i++) {
      const u = i / N, v = 1 - u;
      this.p.set(v * v * this.a.x + 2 * v * u * this.b.x + u * u * this.c.x, v * v * this.a.y + 2 * v * u * this.b.y + u * u * this.c.y, v * v * this.a.z + 2 * v * u * this.b.z + u * u * this.c.z);
      // tangent B'(u) = 2v(b−a) + 2u(c−b)
      this.q.set(2 * v * (this.b.x - this.a.x) + 2 * u * (this.c.x - this.b.x), 2 * v * (this.b.y - this.a.y) + 2 * u * (this.c.y - this.b.y), 2 * v * (this.b.z - this.a.z) + 2 * u * (this.c.z - this.b.z));
      this.toCam.copy(cam).sub(this.p);
      this.side.crossVectors(this.q, this.toCam).normalize();
      const j = jit * Math.sin(u * Math.PI);
      const px = this.p.x + this.side.x * j, py = this.p.y + this.side.y * j, pz = this.p.z + this.side.z * j;
      const o = i * 6;
      this.pos[o] = px + this.side.x * w; this.pos[o + 1] = py + this.side.y * w; this.pos[o + 2] = pz + this.side.z * w;
      this.pos[o + 3] = px - this.side.x * w; this.pos[o + 4] = py - this.side.y * w; this.pos[o + 5] = pz - this.side.z * w;
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // taut line brightens a touch (diegetic tension cue)
    const lc = this.mesh.material.userData.lineColor as THREE.Color;
    this.mesh.material.color.copy(lc).multiplyScalar(0.9 + tension * 0.1);
  }
}
