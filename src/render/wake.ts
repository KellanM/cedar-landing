import * as THREE from 'three';
import { register } from './materials';
import type { Boat } from '../game/boat';
import type { SplashFX } from '../game/splash';

const N = 44; // history points per strip
const LIFE = 4.2; // s a wake point lives
const EMIT_DIST = 0.55; // m between history points
const STRIPS = 4; // 0 stern trail, 1 left bow arm, 2 right bow arm, 3 hull collar (closed ring)

/**
 * Stylized, speed-dependent boat wake: an opaque flat foam V from the bow (two thin arms that
 * spread outward) plus a churned foam trail behind the stern. Points are world-fixed once
 * emitted; strips narrow to nothing as they age (no transparency), so a stopped boat's wake
 * simply shrinks away. Bow spray and turn ripples go through the shared SplashFX pool.
 *
 * Water study (docs/water_study.md §wake): drawn in the sea's crest language. The bow arms break
 * into tapered brush-stroke dashes, the stern trail gets a scalloped edge, and a thin broken foam
 * collar breathes around the hull at the waterline. Shapes are cut in the fragment shader with
 * alpha-to-coverage (MSAA-smooth edges, still opaque and unsorted).
 */
export class BoatWake {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private aw: Float32Array;
  private t = 0;
  // ring buffer of history points (index 0 = newest)
  private hx = new Float32Array(N); private hz = new Float32Array(N); // stern centre
  private bx = new Float32Array(N); private bz = new Float32Array(N); // bow
  private px = new Float32Array(N); private pz = new Float32Array(N); // unit perpendicular (to the right)
  private age = new Float32Array(N);
  private str = new Float32Array(N); // strength (speed fraction) at emission
  private jit = new Float32Array(N);
  private head = 0;
  private count = 0;
  private lastX = NaN; private lastZ = NaN;
  private sprayAcc = 0;
  private ringAcc = 0;
  private foam = new THREE.Color(0xf3f6f4);
  private water = new THREE.Color(0x7d949b);
  private c = new THREE.Color();
  private f = new THREE.Vector3();

  constructor(private tuning: { maxSpeed: number }) {
    const verts = STRIPS * N * 2;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    this.aw = new Float32Array(verts * 3);
    const idx: number[] = [];
    for (let s = 0; s < STRIPS; s++) {
      const o = s * N * 2;
      for (let k = 0; k < N - 1; k++) {
        const a = o + k * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    // aW: x = point index along the strip, y = 0/1 across, z = strip id
    for (let s = 0; s < STRIPS; s++) for (let k = 0; k < N; k++) for (let e = 0; e < 2; e++) {
      const v = ((s * N + k) * 2 + e) * 3;
      this.aw[v] = k; this.aw[v + 1] = e; this.aw[v + 2] = s;
    }
    g.setAttribute('aW', new THREE.BufferAttribute(this.aw, 3));
    g.setIndex(idx);
    const mat = register(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, alphaToCoverage: true }));
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'attribute vec3 aW;\nvarying vec3 vW;\nvoid main() {\n  vW = aW;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec3 vW;\nvoid main() {').replace('#include <color_fragment>', `#include <color_fragment>
        float acr = abs(vW.y * 2.0 - 1.0);
        float t;
        if (vW.z > 2.5) { float s = fract(vW.x * 0.16); t = sin(3.14159 * clamp(s / 0.78, 0.0, 1.0)) * step(s, 0.78); }        // collar: broken ring
        else if (vW.z > 0.5) { float s = fract(vW.x * 0.21 + vW.z * 0.37); t = sin(3.14159 * clamp(s / 0.7, 0.0, 1.0)) * step(s, 0.7); } // bow arms: strokes
        else { float s = fract(vW.x * 0.19); t = (0.8 + 0.2 * sin(vW.x * 1.9)) * mix(1.0, sin(3.14159 * clamp(s / 0.75, 0.0, 1.0)) * step(s, 0.75), smoothstep(5.0, 14.0, vW.x)); } // stern: scallops, breaking into strokes as it ages
        diffuseColor.a *= clamp((t - acr) / max(fwidth(acr), 1e-3) + 0.5, 0.0, 1.0);`);
    };
    mat.customProgramCacheKey = () => 'wake-strokes';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.name = 'boat_wake';
  }

  /** Light water tint the foam fades into (from the time-of-day sea colour). */
  setSea(hex: string) {
    const sea = new THREE.Color(hex);
    this.water.copy(sea).lerp(new THREE.Color(0xffffff), 0.32);
    // the sea's foam tone: off-white pulled a touch toward the water, dimmer at night
    const night = sea.r * 0.3 + sea.g * 0.55 + sea.b * 0.15 < 0.02;
    this.foam.set(0xf1f3ee).lerp(sea, 0.1);
    if (night) { this.foam.multiplyScalar(0.55); this.water.copy(sea).lerp(new THREE.Color(0xffffff), 0.12); }
  }

  update(dt: number, boat: Boat, splash: SplashFX) {
    const spd = Math.abs(boat.speed);
    const strength = Math.min(1, spd / this.tuning.maxSpeed);
    boat.forward(this.f);
    const fx = this.f.x, fz = this.f.z, rx = -fz, rz = fx; // right-hand perpendicular
    const L = boat.halfLen, B = boat.halfBeam;
    const sx = boat.pos.x - fx * L * 0.9, sz = boat.pos.z - fz * L * 0.9;
    const bwx = boat.pos.x + fx * L * 0.8, bwz = boat.pos.z + fz * L * 0.8;

    for (let k = 0; k < this.count; k++) this.age[(this.head + k) % N] += dt;
    while (this.count && this.age[(this.head + this.count - 1) % N] > LIFE) this.count--;

    // emit a new history point every EMIT_DIST metres of travel
    const moved = Number.isNaN(this.lastX) ? Infinity : Math.hypot(boat.pos.x - this.lastX, boat.pos.z - this.lastZ);
    if (strength > 0.06 && moved > Math.max(EMIT_DIST, spd * 0.12)) { // spacing grows with speed so the trail keeps its length
      this.head = (this.head + N - 1) % N;
      const h = this.head;
      this.hx[h] = sx; this.hz[h] = sz; this.bx[h] = bwx; this.bz[h] = bwz;
      this.px[h] = rx; this.pz[h] = rz; this.age[h] = 0; this.str[h] = strength;
      this.jit[h] = (Math.random() - 0.5) * 0.35;
      this.count = Math.min(N - 1, this.count + 1);
      this.lastX = boat.pos.x; this.lastZ = boat.pos.z;
    } else if (strength <= 0.06) { this.lastX = NaN; }

    // build strips: point 0 is "live" at the boat, then history newest → oldest
    const spread = 0.38; // bow arm outward speed per m/s of boat speed (≈ 20° half-angle)
    let lastSx = sx, lastSz = sz, lastBx = bwx, lastBz = bwz, lastPx = rx, lastPz = rz;
    for (let k = 0; k < N; k++) {
      let cx: number, cz: number, ox: number, oz: number, ppx: number, ppz: number, a: number, st: number, j: number;
      if (k === 0) { cx = sx; cz = sz; ox = bwx; oz = bwz; ppx = rx; ppz = rz; a = 0; st = strength; j = 0; }
      else if (k <= this.count) {
        const i = (this.head + k - 1) % N;
        cx = this.hx[i]; cz = this.hz[i]; ox = this.bx[i]; oz = this.bz[i]; ppx = this.px[i]; ppz = this.pz[i];
        a = this.age[i]; st = this.str[i]; j = this.jit[i];
        lastSx = cx; lastSz = cz; lastBx = ox; lastBz = oz; lastPx = ppx; lastPz = ppz;
      } else { cx = lastSx; cz = lastSz; ox = lastBx; oz = lastBz; ppx = lastPx; ppz = lastPz; a = LIFE; st = 0; j = 0; }
      const life = 1 - Math.min(1, a / LIFE);
      const fade = life * life * (3 - 2 * life); // smooth shrink to zero
      // churned look: alternate bands fade to the water tint at different rates
      this.c.copy(this.foam).lerp(this.water, Math.min(1, (a / (LIFE * 0.5)) * (k & 1 ? 1.5 : 1) + (k & 2 ? 0.12 : 0)));
      // stern trail: churned, widening then narrowing
      const w = st * (B * 0.4 + a * 0.22) * fade * (1 + j) * (k & 1 ? 0.72 : 1); // scalloped, churned edge
      this.setV(0, k, cx - ppx * w, cz - ppz * w, cx + ppx * w, cz + ppz * w);
      // bow arms: world-fixed points pushed outward with age
      const off = B * 0.85 + a * spread * this.tuning.maxSpeed * st;
      const aw = (0.1 + a * 0.06) * fade * Math.min(1, st * 2.2);
      const lx = ox - ppx * off, lz = oz - ppz * off, qx = ox + ppx * off, qz = oz + ppz * off;
      this.setV(1, k, lx - ppx * aw, lz - ppz * aw, lx + ppx * aw, lz + ppz * aw);
      this.setV(2, k, qx - ppx * aw, qz - ppz * aw, qx + ppx * aw, qz + ppz * aw);
    }
    // hull collar: a thin broken ring that breathes around the waterline, thinning with speed
    this.t += dt;
    const breathe = 0.5 + 0.5 * Math.sin(this.t * 1.7);
    const cw = (0.07 + 0.06 * breathe) * (1 - 0.7 * strength);
    const ax = L * (1.0 + 0.05 * breathe), az = B * (1.35 + 0.12 * breathe);
    this.c.copy(this.foam).lerp(this.water, 0.25);
    for (let k = 0; k < N; k++) {
      const a = (k / (N - 1)) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const ox = fx * ca * ax + rx * sa * az, oz = fz * ca * ax + rz * sa * az;
      const nx = fx * ca * az + rx * sa * ax, nz = fz * ca * az + rz * sa * ax, nl = Math.hypot(nx, nz) || 1; // ellipse normal
      const cx = boat.pos.x + ox - fx * L * 0.05, cz = boat.pos.z + oz - fz * L * 0.05;
      this.setV(3, k, cx - (nx / nl) * cw, cz - (nz / nl) * cw, cx + (nx / nl) * cw, cz + (nz / nl) * cw);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;

    // bow spray at speed
    if (strength > 0.55) {
      this.sprayAcc += dt * (strength - 0.5) * 24;
      while (this.sprayAcc >= 1) {
        this.sprayAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1, v = 1 + spd * 0.35;
        splash.spray(bwx + rx * side * B * 0.6, bwz + rz * side * B * 0.6, rx * side * v - fx * 0.5, rz * side * v - fz * 0.5, 1);
      }
    }
    // ripple rings on the outside of hard turns
    const tr = boat.turnRate;
    if (Math.abs(tr) > 0.42 && spd > 0.7) {
      this.ringAcc += dt;
      if (this.ringAcc > 0.4) {
        this.ringAcc = 0;
        const side = tr > 0 ? 1 : -1; // turning left → outside is the right
        splash.ring(sx + rx * side * B, sz + rz * side * B, 0.55 + strength * 0.4);
      }
    } else this.ringAcc = 0.3;
  }

  private setV(strip: number, k: number, ax: number, az: number, bx: number, bz: number) {
    const v = (strip * N + k) * 2 * 3;
    const y = 0.035;
    this.pos[v] = ax; this.pos[v + 1] = y; this.pos[v + 2] = az;
    this.pos[v + 3] = bx; this.pos[v + 4] = y; this.pos[v + 5] = bz;
    this.col[v] = this.c.r; this.col[v + 1] = this.c.g; this.col[v + 2] = this.c.b;
    this.col[v + 3] = this.c.r; this.col[v + 4] = this.c.g; this.col[v + 5] = this.c.b;
  }
}
