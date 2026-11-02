import * as THREE from 'three';
import type { Hotspot } from '../world/types';
import { blobGeometry } from './splash';
import { register } from '../render/materials';

/**
 * Procedural fishing-spot markers (docs/study/fishing_polish.md §hotspots). Replaces the baked
 * bullseye (dark disc + thick white rings + hex foam) with a living patch of water:
 *  - churn: a core cluster of two/three-tone foam blobs that breathe, drift and pop/respawn;
 *  - a broken tide-line arc of elongated scum dots (Wind Waker / A Short Hike contour foam);
 *  - Dredge-style broken-ring bubbles that pop up, wobble and burst;
 *  - a bait ball: a dark under-surface cloud with silver glints flickering above it (gold on rare);
 *  - circling fish shadows (Animal Crossing), with a dorsal fin + V-wake on good/rare spots;
 *  - two thin expanding ripple rings.
 * Everything except the rings is one InstancedMesh per layer shared by all spots (5 draws total);
 * far spots are collapsed to zero scale and skipped. No allocation per frame.
 */
export const HOTSPOT_FX = {
  churn: 1, // foam density multiplier
  clearR: 1.3, // m: foam/glints part around the float so it always reads
  drawDist: 260,
};

const SEA_Y = -0.06;
const TAU = Math.PI * 2;
const HALO = 4;

type Tier = 'common' | 'good' | 'rare';
const TIER = {
  common: { core: 7, arc: 12, bubbles: 5, glints: 16, fins: 0, shadows: 3, r: 1, bait: 2.0 },
  good: { core: 10, arc: 16, bubbles: 7, glints: 24, fins: 1, shadows: 3, r: 1.25, bait: 2.6 },
  rare: { core: 13, arc: 20, bubbles: 9, glints: 32, fins: 2, shadows: 2, r: 1.45, bait: 3.0 },
} as const;

/** Foam tones per biome family (cream/white base, a tinted scum). */
function palette(biome: string) {
  const b = biome.toLowerCase();
  const scum = /kelp|seagrass/.test(b) ? 0xcfdab4 : /sand|lagoon|flat/.test(b) ? 0xd6ece6 : /trench|drop|fog|wreck/.test(b) ? 0xd9e2e6 : 0xe9eee6;
  return [new THREE.Color(0xf6f7f2), new THREE.Color(0xdde9e8), new THREE.Color(scum)];
}

function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

interface Patch { x: number; z: number; sx: number; sz: number; rot: number; ph: number; w: number; cyc: number; t: number; arc: boolean; dark: boolean; grp?: number }
interface Bubble { x: number; z: number; s: number; t: number; life: number; delay: number }
interface Glint { a: number; r: number; s: number; ph: number; hz: number }
interface Shadow { r: number; w: number; a: number; s: number; fin: boolean }
interface Spot {
  hs: Hotspot; x: number; z: number; tier: Tier; rnd: () => number; near: boolean;
  p0: number; patches: Patch[]; b0: number; bubbles: Bubble[]; g0: number; glints: Glint[]; bx: number; bz: number;
  s0: number; shadows: Shadow[]; f0: number; rings: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
}

export class HotspotFX {
  group = new THREE.Group();
  private spots: Spot[] = [];
  private t = 0;
  private patchM: THREE.InstancedMesh;
  private bubbleM: THREE.InstancedMesh;
  private glintM: THREE.InstancedMesh;
  private shadowM: THREE.InstancedMesh;
  private finM: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(hotspots: Hotspot[]) {
    // count instances
    let nP = 0, nB = 0, nG = 0, nS = 0, nF = 0;
    const tiers = hotspots.map((h) => (h.tier === 'rare' ? 'rare' : h.tier === 'good' || h.tier === 'uncommon' ? 'good' : 'common') as Tier);
    tiers.forEach((t) => { const T = TIER[t]; nP += HALO + T.core * 3 + T.arc + T.fins * 2; nB += T.bubbles; nG += T.glints; nS += T.shadows + 3; nF += T.fins; });
    const foamMat = register(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.patchM = new THREE.InstancedMesh(blobGeometry(2), foamMat, Math.max(1, nP));
    const bubbleG = new THREE.RingGeometry(0.72, 1, 12, 1, 0.4, TAU * 0.78).rotateX(-Math.PI / 2);
    this.bubbleM = new THREE.InstancedMesh(bubbleG, register(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false })), Math.max(1, nB));
    const glintG = new THREE.BufferGeometry();
    glintG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1, 0.45, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, -1, -0.45, 0, 0], 3));
    this.glintM = new THREE.InstancedMesh(glintG, register(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })), Math.max(1, nG));
    this.shadowM = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12).scale(0.3, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0d1a1f, transparent: true, opacity: 0.24, depthWrite: false }), Math.max(1, nS));
    const finG = new THREE.BufferGeometry();
    finG.setAttribute('position', new THREE.Float32BufferAttribute([0.12, 0, 0, -0.16, 0, 0, -0.1, 1, 0], 3));
    this.finM = new THREE.InstancedMesh(finG, register(new THREE.MeshBasicMaterial({ color: 0x2a3438, side: THREE.DoubleSide })), Math.max(1, nF));
    for (const im of [this.patchM, this.bubbleM, this.glintM, this.shadowM, this.finM]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.zero);
    }
    this.shadowM.renderOrder = 0;
    this.patchM.renderOrder = 1;
    this.bubbleM.renderOrder = 2;
    this.glintM.renderOrder = 2;
    this.group.add(this.shadowM, this.patchM, this.bubbleM, this.glintM, this.finM);

    const ringG = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2);
    let pi = 0, bi = 0, gi = 0, si = 0, fi = 0;
    const silver = [new THREE.Color(0xf1f5f6), new THREE.Color(0xc9d6db), new THREE.Color(0xffffff)];
    const halo = new THREE.Color(0x6b8d95), gold = new THREE.Color(0xf2c94c), bubbleC = new THREE.Color(0xe6f1ef), bubbleGold = new THREE.Color(0xf6dc8c);
    hotspots.forEach((hs, k) => {
      const tier = tiers[k], T = TIER[tier], rnd = mulberry(hash(hs.name));
      const tones = palette(hs.biome ?? '');
      const sp: Spot = { hs, x: hs.pos[0], z: hs.pos[2], tier, rnd, near: false, p0: pi, patches: [], b0: bi, bubbles: [], g0: gi, glints: [], bx: 0, bz: 0, s0: si, shadows: [], f0: fi, rings: [] };
      // halo: big translucent aqua blobs riding the bait ball, under the churn (gives the spot mass from afar)
      for (let i = 0; i < HALO; i++) {
        const a = (i / HALO) * TAU + rnd(), d = 0.6 + rnd() * 1.2, s = (1.0 + rnd() * 0.7) * T.r;
        sp.patches.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, sx: s * 1.3, sz: s, rot: rnd() * TAU, ph: rnd() * TAU, w: 0.35 + rnd() * 0.3, cyc: 0, t: 0, arc: false, dark: true });
        this.patchM.setColorAt(pi++, halo);
      }
      // churn: clusters of one blob + two satellites (lumpy outlines instead of lone hexes)
      for (let i = 0; i < T.core; i++) {
        const core = i < 3; // the first clusters hug the middle: a bright boil that reads from afar
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * (core ? 1.2 : 3.2) * T.r, s = (core ? 0.5 + rnd() * 0.3 : 0.22 + rnd() * 0.36) * HOTSPOT_FX.churn;
        const cyc = 3 + rnd() * 3, t0 = rnd() * 5;
        for (let j = 0; j < 3; j++) {
          const o = j === 0 ? 0 : s * 0.9, oa = rnd() * TAU, sj = j === 0 ? 1 : 0.45 + rnd() * 0.25;
          sp.patches.push({ x: Math.cos(a) * d + Math.cos(oa) * o, z: Math.sin(a) * d + Math.sin(oa) * o, sx: s * sj * (1 + rnd() * 0.5), sz: s * sj, rot: rnd() * TAU, ph: rnd() * TAU, w: 0.6 + rnd() * 0.8, cyc, t: t0, arc: false, dark: false, grp: j === 0 ? 0 : -j });
          this.patchM.setColorAt(pi++, tones[j === 0 ? i % 2 : 0]);
        }
      }
      // tide-line: a broken arc of elongated scum dots
      const a0 = rnd() * TAU, span = (2.2 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1), R0 = (4.2 + rnd() * 0.6) * T.r;
      for (let i = 0; i < T.arc; i++) {
        const u = i / T.arc;
        if (rnd() < 0.15) { sp.patches.push({ x: 0, z: 0, sx: 0, sz: 0, rot: 0, ph: 0, w: 0, cyc: 0, t: 0, arc: true, dark: false }); this.patchM.setColorAt(pi++, tones[2]); continue; } // gap
        const a = a0 + span * u, r = R0 + u * 1.6 * T.r + (rnd() - 0.5) * 0.4;
        const s = (0.12 + rnd() * 0.22) * (1 - Math.abs(u - 0.5));
        sp.patches.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, sx: s * 2.4, sz: s, rot: -a - Math.PI / 2, ph: rnd() * TAU, w: 0.3 + rnd() * 0.3, cyc: 0, t: 0, arc: true, dark: false });
        this.patchM.setColorAt(pi++, tones[i % 3 === 0 ? 0 : 2]);
      }
      // fin wakes (2 patches per fin, positioned each frame)
      for (let i = 0; i < T.fins * 2; i++) { sp.patches.push({ x: 0, z: 0, sx: 0.2, sz: 0.1, rot: 0, ph: 0, w: 0, cyc: -1, t: 0, arc: false, dark: false }); this.patchM.setColorAt(pi++, tones[0]); }
      for (let i = 0; i < T.bubbles; i++) {
        sp.bubbles.push({ x: 0, z: 0, s: 0, t: 0, life: 0, delay: rnd() * 2 });
        this.bubbleM.setColorAt(bi++, tier === 'rare' && i % 3 === 0 ? bubbleGold : bubbleC);
      }
      for (let i = 0; i < T.glints; i++) {
        sp.glints.push({ a: rnd() * TAU, r: Math.sqrt(rnd()) * T.bait * 0.75, s: 0.1 + rnd() * 0.1, ph: rnd() * TAU, hz: 0.6 + rnd() * 1.4 });
        this.glintM.setColorAt(gi++, tier === 'rare' && i % 4 === 0 ? gold : silver[i % 3]);
      }
      si += 3; // bait-cloud ellipses live in front of the fish shadows
      for (let i = 0; i < T.shadows; i++) {
        sp.shadows.push({ r: 1.6 + rnd() * 3 * T.r, w: (0.25 + rnd() * 0.3) * (rnd() < 0.5 ? -1 : 1), a: rnd() * TAU, s: (0.5 + rnd() * 0.5) * (tier === 'good' ? 1.25 : tier === 'rare' ? 1.6 : 1), fin: i < T.fins });
        si++;
      }
      fi += T.fins;
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: tier === 'rare' && i === 1 ? 0xf3dc98 : i === 0 ? 0xf2f7f4 : 0xc6eaf0, transparent: true, opacity: 0, depthWrite: false }));
        m.position.set(sp.x, SEA_Y + 0.02, sp.z);
        m.renderOrder = 1;
        m.visible = false;
        this.group.add(m);
        sp.rings.push(m);
      }
      this.spots.push(sp);
    });
    for (const im of [this.patchM, this.bubbleM, this.glintM]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  private put(im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, rotX = 0, rotZ = 0) {
    this.e.set(rotX, rotY, rotZ, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.v, this.q, this.s);
    im.setMatrixAt(i, this.m);
  }

  /** @param clear the float position (foam parts around it), or null */
  update(dt: number, cam: THREE.Vector3, hideShadowsOf: Hotspot | null, clear: THREE.Vector3 | null = null) {
    this.t += dt;
    const t = this.t;
    const CR = HOTSPOT_FX.clearR;
    for (const sp of this.spots) {
      const near = Math.hypot(sp.x - cam.x, sp.z - cam.z) < HOTSPOT_FX.drawDist;
      if (!near) {
        if (sp.near) this.collapse(sp);
        sp.near = false;
        continue;
      }
      sp.near = true;
      const T = TIER[sp.tier];
      const clearHere = clear && Math.hypot(clear.x - sp.x, clear.z - sp.z) < 12 ? clear : null;
      const part = (x: number, z: number) => {
        if (!clearHere) return 1;
        const d = Math.hypot(x - clearHere.x, z - clearHere.z);
        return THREE.MathUtils.smoothstep(d, CR * 0.6, CR * 1.4);
      };
      // bait ball wanders on a slow Lissajous
      sp.bx = Math.sin(t * 0.13 + sp.p0) * 1.1 * T.r;
      sp.bz = Math.cos(t * 0.11 + sp.p0 * 1.7) * 0.9 * T.r;
      // bait cloud: three overlapping translucent ellipses (darker core where they overlap)
      for (let k = 0; k < 3; k++) {
        const bs = T.bait * (1.6 - k * 0.35) * (1 + Math.sin(t * (0.5 + k * 0.2) + k) * 0.07);
        const ox = Math.sin(t * 0.3 + k * 2.1) * 0.5, oz = Math.cos(t * 0.27 + k * 1.3) * 0.4;
        this.put(this.shadowM, sp.s0 + k, sp.x + sp.bx + ox, SEA_Y + 0.005 + k * 0.002, sp.z + sp.bz + oz, t * 0.05 + k, bs * 2.2, 1, bs * 0.75);
      }
      // patches
      let wakeI = 0;
      const fins: { x: number; z: number; yaw: number }[] = this.finScratch;
      fins.length = 0;
      sp.shadows.forEach((s, i) => {
        s.a += s.w * dt;
        const x = sp.x + Math.cos(s.a) * s.r, z = sp.z + Math.sin(s.a) * s.r;
        const yaw = -s.a + (s.w > 0 ? Math.PI : 0);
        const hide = sp.hs === hideShadowsOf;
        this.put(this.shadowM, sp.s0 + 3 + i, x, SEA_Y + 0.01, z, yaw, hide ? 0 : s.s, 1, hide ? 0 : s.s);
        if (s.fin) {
          const up = hide ? 0 : 0.28 * s.s * (0.75 + 0.25 * Math.sin(t * 0.7 + i));
          this.put(this.finM, sp.f0 + fins.length, x, SEA_Y, z, yaw + Math.PI / 2, up, up, up);
          fins.push({ x, z, yaw });
        }
      });
      sp.patches.forEach((p, i) => {
        const idx = sp.p0 + i;
        if (p.cyc === -1) {
          // V-wake behind a fin: two narrow foam strips angled back
          const f = fins[wakeI >> 1];
          const side = wakeI & 1 ? 1 : -1;
          wakeI++;
          if (!f) { this.patchM.setMatrixAt(idx, this.zero); return; }
          const bx = Math.sin(f.yaw + Math.PI / 2), bz = Math.cos(f.yaw + Math.PI / 2); // fin's forward
          const wx = f.x - bx * 0.45 + bz * side * 0.18, wz = f.z - bz * 0.45 - bx * side * 0.18;
          const fl = 0.9 + 0.1 * Math.sin(t * 6 + side);
          this.put(this.patchM, idx, wx, SEA_Y + 0.03, wz, f.yaw + Math.PI / 2 + side * 0.35, 0.42 * fl, 1, 0.07);
          return;
        }
        let x = p.x, z = p.z, sc = 1;
        if (p.dark) { x += sp.bx; z += sp.bz; sc = 1 + Math.sin(t * p.w + p.ph) * 0.08; }
        else if (p.cyc > 0) {
          // churn: grow → hold → shrink, respawn somewhere new in the core (seeded per spot)
          p.t += dt;
          if (p.t >= p.cyc) {
            p.t = 0;
            if (!p.grp) { const a = sp.rnd() * TAU, d = Math.sqrt(sp.rnd()) * (i < HALO + 9 ? 1.2 : 3.2) * T.r; p.x = Math.cos(a) * d + sp.bx * 0.5; p.z = Math.sin(a) * d + sp.bz * 0.5; p.rot = sp.rnd() * TAU; }
            else { const lead = sp.patches[i + p.grp]; const oa = sp.rnd() * TAU, o = lead.sx * 0.8; p.x = lead.x + Math.cos(oa) * o; p.z = lead.z + Math.sin(oa) * o; }
          }
          const k = p.t / p.cyc;
          sc = Math.min(1, k * 6) * (k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1) * (0.9 + 0.1 * Math.sin(t * 2 * p.w + p.ph));
          x += Math.sin(t * 0.3 + p.ph) * 0.3; z += Math.cos(t * 0.25 + p.ph) * 0.3;
        } else if (p.arc) {
          sc = 0.85 + 0.15 * Math.sin(t * p.w + p.ph);
          // the whole line drifts and slowly turns
          const a = t * 0.02, c = Math.cos(a), s = Math.sin(a);
          const rx = x * c - z * s, rz = x * s + z * c;
          x = rx; z = rz;
        }
        const wx = sp.x + x, wz = sp.z + z;
        sc *= p.dark ? 1 : part(wx, wz);
        this.put(this.patchM, idx, wx, SEA_Y + (p.dark ? 0.015 : 0.03), wz, p.rot + (p.arc ? t * 0.02 : t * 0.05 * p.w), p.sx * sc, 1, p.sz * sc);
      });
      // bubbles: pop up (ease-out-back), wobble, burst
      sp.bubbles.forEach((b, i) => {
        if (b.delay > 0) {
          b.delay -= dt;
          if (b.delay <= 0) {
            const a = sp.rnd() * TAU, d = Math.sqrt(sp.rnd()) * 2.8 * T.r;
            b.x = sp.x + Math.cos(a) * d + sp.bx * 0.6; b.z = sp.z + Math.sin(a) * d + sp.bz * 0.6;
            b.s = 0.16 + sp.rnd() * 0.3; b.t = 0; b.life = 1 + sp.rnd() * 1.4;
          } else { this.bubbleM.setMatrixAt(sp.b0 + i, this.zero); return; }
        }
        b.t += dt;
        const k = b.t / b.life;
        let sc: number;
        if (k < 0.18) { const u = k / 0.18; sc = 1 + 1.7 * Math.pow(u - 1, 3) + 0.7 * Math.pow(u - 1, 2); }
        else if (k < 0.9) sc = 1 + Math.sin(b.t * 9) * 0.05;
        else sc = 1 + (k - 0.9) * 6; // burst: flick wider…
        if (k >= 1) { b.delay = 0.3 + sp.rnd() * 1.2; this.bubbleM.setMatrixAt(sp.b0 + i, this.zero); return; }
        sc *= b.s * part(b.x, b.z) * (k >= 0.9 ? 1 - (k - 0.9) * 8 : 1);
        this.put(this.bubbleM, sp.b0 + i, b.x, SEA_Y + 0.04, b.z, b.t * 0.5, sc, 1, sc);
      });
      // glints: flat diamonds flicking on and off over the bait cloud (fish turning flank-up)
      sp.glints.forEach((g, i) => {
        const on = Math.sin(t * g.hz * TAU + g.ph);
        const vis = on > 0.55 ? (on - 0.55) / 0.45 : 0;
        const x = sp.x + sp.bx + Math.cos(g.a + t * 0.2) * g.r, z = sp.z + sp.bz + Math.sin(g.a + t * 0.2) * g.r * 0.8;
        const sc = g.s * vis * part(x, z);
        this.put(this.glintM, sp.g0 + i, x, SEA_Y + 0.05, z, g.a + t, sc, sc, sc * 1.4);
      });
      // ripple rings: thin, slow, staggered
      sp.rings.forEach((m, i) => {
        m.visible = Math.hypot(sp.x - cam.x, sp.z - cam.z) < 140;
        const k = (t * 0.2 + i / 3) % 1;
        m.scale.setScalar((1.6 + k * 6) * T.r);
        m.material.opacity = 0.7 * (1 - k) * Math.min(1, k * 5);
      });
    }
    for (const im of [this.patchM, this.bubbleM, this.glintM, this.shadowM, this.finM]) im.instanceMatrix.needsUpdate = true;
  }
  private finScratch: { x: number; z: number; yaw: number }[] = [];

  private collapse(sp: Spot) {
    for (let i = 0; i < sp.patches.length; i++) this.patchM.setMatrixAt(sp.p0 + i, this.zero);
    for (let i = 0; i < sp.bubbles.length; i++) this.bubbleM.setMatrixAt(sp.b0 + i, this.zero);
    for (let i = 0; i < sp.glints.length; i++) this.glintM.setMatrixAt(sp.g0 + i, this.zero);
    for (let i = 0; i < sp.shadows.length + 3; i++) this.shadowM.setMatrixAt(sp.s0 + i, this.zero);
    const nf = sp.shadows.filter((s) => s.fin).length;
    for (let i = 0; i < nf; i++) this.finM.setMatrixAt(sp.f0 + i, this.zero);
    for (const r of sp.rings) r.visible = false;
  }
}

/**
 * The export still bakes a flat bullseye marker (LIFE_Hotspots: rings, foam icos, life_bait disc at
 * z≈0.17–0.2 m) into the world chunks. It sits above the float and fights the procedural marker,
 * so collapse those triangles at load. Selection: every vertex 0.08–0.34 m above sea level and
 * within the marker radius of a hotspot centre (7.4 m common, 9.9 m good/rare). Skip with ?bakedmarkers.
 * Returns the number of triangles removed.
 */
export function hideBakedHotspotMarkers(chunks: THREE.Object3D[], hotspots: Hotspot[]): number {
  if (new URLSearchParams(location.search).has('bakedmarkers')) return 0;
  const spots = hotspots.map((h) => ({ x: h.pos[0], z: h.pos[2], r: h.tier === 'common' ? 7.4 : 9.9 }));
  const v = new THREE.Vector3();
  let removed = 0;
  for (const c of chunks) {
    c.updateMatrixWorld(true);
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry, pos = g.getAttribute('position') as THREE.BufferAttribute;
      if (!pos) return;
      const box = g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox!);
      const wb = box.clone().applyMatrix4(mesh.matrixWorld);
      if (!spots.some((s) => s.x > wb.min.x - s.r && s.x < wb.max.x + s.r && s.z > wb.min.z - s.r && s.z < wb.max.z + s.r)) return;
      // per-vertex flag
      const n = pos.count, ok = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.y < 0.08 || v.y > 0.34) continue;
        for (const s of spots) if (Math.hypot(v.x - s.x, v.z - s.z) < s.r) { ok[i] = 1; break; }
      }
      const idx = g.index;
      if (idx) {
        const a = idx.array as Uint16Array | Uint32Array;
        for (let f = 0; f < a.length; f += 3) {
          if (ok[a[f]] && ok[a[f + 1]] && ok[a[f + 2]]) { a[f + 1] = a[f]; a[f + 2] = a[f]; removed++; }
        }
        idx.needsUpdate = true;
      } else {
        for (let f = 0; f < n; f += 3) {
          if (ok[f] && ok[f + 1] && ok[f + 2]) { v.fromBufferAttribute(pos, f); pos.setXYZ(f + 1, v.x, v.y, v.z); pos.setXYZ(f + 2, v.x, v.y, v.z); removed++; }
        }
        pos.needsUpdate = true;
      }
    });
  }
  return removed;
}
