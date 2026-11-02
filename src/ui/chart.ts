/**
 * The Log's chart (ui_design §4.6 Map): a pre-drawn chart texture made once from a top-down render
 * of the world (land = anything above the waterline), revealed by the canoe's sight radius through
 * a 128×128 bitmask stored in localStorage and drawn as a soft ink wash. Named places get Caveat
 * labels when *visited*; the canoe is a glyph with a dashed recent path. Tap a place → compass.
 */
import * as THREE from 'three';
import { ctx } from './ctx';
import { log, saveLog, loadMask, saveMask } from './prefs';
import type { LoadedWorld } from '../world/types';

const MASK = 128;
const CHART_MAX = 640; // px, longest side of the chart texture

export interface Place { key: string; name: string; x: number; z: number; kind: 'town' | 'island' | 'poi' | 'stone'; r: number }

const words = (s: string) => s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/s Key\b/, "'s Key").replace(/Keepers\b/, "Keeper's").trim();

class Chart {
  bounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
  places: Place[] = [];
  hotspots: { x: number; z: number }[] = [];
  mask = new Uint8Array(MASK * MASK);
  private sig = '';
  private dirty = false;
  private lastSave = 0;
  private texture: HTMLCanvasElement | null = null;
  private revealed: HTMLCanvasElement | null = null;
  private revealedFor = -1;
  private maskVersion = 0;
  private lastPath = { x: 1e9, z: 1e9 };
  /** first visit to a named place (HUD shows a title card / chart toast) */
  onVisit: ((p: Place) => void) | null = null;

  setWorld(w: LoadedWorld) {
    const b = new THREE.Box3();
    for (const c of w.chunks) b.union(c.bounds);
    const g = w.gameplay;
    const pts: number[][] = [...g.interacts.map((i) => i.pos), ...g.hotspots.map((h) => h.pos), g.spawn.pos];
    for (const p of pts) b.expandByPoint(new THREE.Vector3(p[0], 0, p[2]));
    const pad = 60;
    this.bounds = { minX: Math.floor(b.min.x - pad), maxX: Math.ceil(b.max.x + pad), minZ: Math.floor(b.min.z - pad), maxZ: Math.ceil(b.max.z + pad) };
    const sig = `${w.source}:${this.bounds.minX},${this.bounds.maxX},${this.bounds.minZ},${this.bounds.maxZ}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.mask.fill(0);
      const stored = loadMask();
      if (stored && stored.startsWith(sig + '|')) {
        try {
          const bin = atob(stored.slice(sig.length + 1));
          for (let i = 0; i < bin.length; i++) for (let k = 0; k < 8; k++) if (bin.charCodeAt(i) & (1 << k)) this.mask[i * 8 + k] = 1;
        } catch { /* corrupt → start blank */ }
      }
      this.maskVersion++;
    }
    this.texture = null;
    this.places = buildPlaces(w);
    this.hotspots = g.hotspots.map((h) => ({ x: h.pos[0], z: h.pos[2] }));
  }

  // ---------------------------------------------------------------- sight + visits
  sightRadius() {
    const t = ctx.tod;
    return t === 'fog' ? 45 : t === 'night' ? 60 : t === 'dusk' ? 80 : 95;
  }

  private cell(x: number, z: number) {
    const b = this.bounds;
    return [((x - b.minX) / (b.maxX - b.minX)) * MASK, ((z - b.minZ) / (b.maxZ - b.minZ)) * MASK];
  }

  reveal(x: number, z: number, r: number) {
    const b = this.bounds;
    const [cx, cz] = this.cell(x, z);
    const rx = (r / (b.maxX - b.minX)) * MASK, rz = (r / (b.maxZ - b.minZ)) * MASK;
    let changed = false;
    for (let j = Math.max(0, Math.floor(cz - rz)); j <= Math.min(MASK - 1, Math.ceil(cz + rz)); j++) {
      for (let i = Math.max(0, Math.floor(cx - rx)); i <= Math.min(MASK - 1, Math.ceil(cx + rx)); i++) {
        const dx = (i + 0.5 - cx) / rx, dz = (j + 0.5 - cz) / rz;
        if (dx * dx + dz * dz <= 1 && !this.mask[j * MASK + i]) { this.mask[j * MASK + i] = 1; changed = true; }
      }
    }
    if (changed) { this.dirty = true; this.maskVersion++; }
  }

  isSeen(x: number, z: number) {
    const [i, j] = this.cell(x, z).map(Math.floor);
    return i >= 0 && j >= 0 && i < MASK && j < MASK && !!this.mask[j * MASK + i];
  }

  track(x: number, z: number) {
    this.reveal(x, z, this.sightRadius());
    if (Math.hypot(x - this.lastPath.x, z - this.lastPath.z) > 12) {
      this.lastPath = { x, z };
      log.path.push(Math.round(x), Math.round(z));
      if (log.path.length > 160) log.path.splice(0, log.path.length - 160);
      this.dirty = true;
    }
    for (const p of this.places) {
      if (log.places.includes(p.key)) continue;
      if (Math.hypot(p.x - x, p.z - z) < p.r) {
        log.places.push(p.key);
        this.dirty = true;
        this.onVisit?.(p);
      }
    }
    const now = performance.now();
    if (this.dirty && now - this.lastSave > 3000) this.persist();
  }

  persist() {
    this.lastSave = performance.now();
    this.dirty = false;
    let bin = '';
    for (let i = 0; i < this.mask.length; i += 8) {
      let byte = 0;
      for (let k = 0; k < 8; k++) if (this.mask[i + k]) byte |= 1 << k;
      bin += String.fromCharCode(byte);
    }
    saveMask(`${this.sig}|${btoa(bin)}`);
    saveLog();
  }

  revealAll() { this.mask.fill(1); this.maskVersion++; this.dirty = true; this.persist(); }

  // ---------------------------------------------------------------- destination
  destination() {
    if (!log.dest) return null;
    const p = this.places.find((q) => q.key === log.dest);
    return p ? { key: p.key, name: p.name, x: p.x, z: p.z } : null;
  }
  setDestination(key: string | null) { log.dest = key; saveLog(); }
  clearDestination() { this.setDestination(null); }

  // ---------------------------------------------------------------- chart texture
  /** Render the world top-down once and ink it into a chart. Cheap enough to do when the Map opens. */
  ensureTexture(): HTMLCanvasElement | null {
    if (this.texture) return this.texture;
    const src = ctx.chart, w = ctx.world;
    if (!src || !w) return null;
    const b = this.bounds;
    const ww = b.maxX - b.minX, hh = b.maxZ - b.minZ;
    const s = CHART_MAX / Math.max(ww, hh);
    const W = Math.max(64, Math.round(ww * s)), H = Math.max(64, Math.round(hh * s));
    const r = src.renderer;
    const rt = new THREE.WebGLRenderTarget(W, H);
    const cam = new THREE.OrthographicCamera(-ww / 2, ww / 2, hh / 2, -hh / 2, 1, 1000 - 0.4);
    cam.up.set(0, 0, -1);
    cam.position.set((b.minX + b.maxX) / 2, 1000, (b.minZ + b.maxZ) / 2);
    cam.lookAt(cam.position.x, 0, cam.position.z);
    cam.updateMatrixWorld();
    const restore: [THREE.Object3D, boolean][] = [];
    for (const o of src.hide) { restore.push([o, o.visible]); o.visible = false; }
    for (const c of w.chunks) { restore.push([c.object, c.object.visible]); c.object.visible = true; }
    const prevRT = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const px = new Uint8Array(W * H * 4);
    try {
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(src.root, cam);
      r.readRenderTargetPixels(rt, 0, 0, W, H, px);
    } finally {
      r.setRenderTarget(prevRT);
      r.setClearColor(prevColor, prevAlpha);
      for (const [o, v] of restore) o.visible = v;
      rt.dispose();
    }
    this.texture = inkChart(px, W, H);
    this.revealedFor = -1;
    return this.texture;
  }

  /** Chart texture masked by what has been seen (soft ink-wash edge). */
  revealedTexture(): HTMLCanvasElement | null {
    const tex = this.ensureTexture();
    if (!tex) return null;
    if (this.revealed && this.revealedFor === this.maskVersion) return this.revealed;
    const m = document.createElement('canvas');
    m.width = MASK; m.height = MASK;
    const mc = m.getContext('2d')!;
    const img = mc.createImageData(MASK, MASK);
    for (let i = 0; i < this.mask.length; i++) img.data[i * 4 + 3] = this.mask[i] ? 255 : 0;
    mc.putImageData(img, 0, 0);
    const out = this.revealed ?? document.createElement('canvas');
    out.width = tex.width; out.height = tex.height;
    const oc = out.getContext('2d')!;
    oc.clearRect(0, 0, out.width, out.height);
    oc.drawImage(tex, 0, 0);
    oc.globalCompositeOperation = 'destination-in';
    oc.imageSmoothingEnabled = true;
    oc.filter = 'blur(3px)';
    oc.drawImage(m, 0, 0, out.width, out.height);
    oc.filter = 'none';
    oc.globalCompositeOperation = 'source-over';
    this.revealed = out;
    this.revealedFor = this.maskVersion;
    return out;
  }

  /** world → chart-texture pixel */
  toTex(x: number, z: number) {
    const b = this.bounds, t = this.texture;
    const W = t?.width ?? 512, H = t?.height ?? 512;
    return [((x - b.minX) / (b.maxX - b.minX)) * W, ((z - b.minZ) / (b.maxZ - b.minZ)) * H];
  }

  /** A torn-paper crop of the chart around a point (for found pages). */
  cropAround(x: number, z: number, metres = 160, px = 220): string | null {
    const tex = this.ensureTexture();
    if (!tex) return null;
    const c = document.createElement('canvas');
    c.width = px; c.height = px;
    const cc = c.getContext('2d')!;
    const [tx, tz] = this.toTex(x, z);
    const k = tex.width / (this.bounds.maxX - this.bounds.minX);
    const half = (metres / 2) * k;
    cc.drawImage(tex, tx - half, tz - half, half * 2, half * 2, 0, 0, px, px);
    // mark the stone
    cc.strokeStyle = '#9E3B2A'; cc.lineWidth = 3;
    cc.beginPath(); cc.moveTo(px / 2 - 9, px / 2 - 9); cc.lineTo(px / 2 + 9, px / 2 + 9); cc.moveTo(px / 2 + 9, px / 2 - 9); cc.lineTo(px / 2 - 9, px / 2 + 9); cc.stroke();
    return c.toDataURL('image/png');
  }
}

function buildPlaces(w: LoadedWorld): Place[] {
  const out = new Map<string, Place>();
  const add = (p: Place) => { if (!out.has(p.key)) out.set(p.key, p); };
  const g = w.gameplay;
  add({ key: 'keepers_cove', name: "Keeper's Cove", x: g.spawn.pos[0], z: g.spawn.pos[2], kind: 'town', r: 50 });
  for (const it of g.interacts) {
    const pr = (it.props ?? {}) as Record<string, unknown>;
    if (it.name === 'Interact_SellFish' || (it.kind === 'sell_fish' && !pr.poi)) add({ key: 'cedar_landing', name: 'Cedar Landing', x: it.pos[0], z: it.pos[2], kind: 'town', r: 60 });
    else if (typeof pr.island === 'string') add({ key: `isl:${pr.island_key ?? pr.island}`, name: String(pr.island).replace(/\s*\(.*\)$/, ''), x: it.pos[0], z: it.pos[2], kind: 'island', r: 70 });
    else if (typeof pr.poi === 'string') {
      const stone = String(pr.poi).startsWith('Sunstone_');
      add({ key: `poi:${pr.poi}`, name: stone ? `${words(String(pr.poi).slice(9))} stone` : words(String(pr.poi)), x: it.pos[0], z: it.pos[2], kind: stone ? 'stone' : 'poi', r: 45 });
    }
  }
  return [...out.values()];
}

/** Turn the raw top-down render into a sepia logbook chart. */
function inkChart(px: Uint8Array, W: number, H: number): HTMLCanvasElement {
  // readRenderTargetPixels rows are bottom-up; the camera's up is -Z so row 0 is +Z (south).
  const land = new Uint8Array(W * H);
  const forest = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = H - 1 - y; // flip so canvas row 0 = minZ (north)
    for (let x = 0; x < W; x++) {
      const i = (sy * W + x) * 4;
      if (px[i + 3] > 20) {
        land[y * W + x] = 1;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (g > r * 1.02 && g > b * 1.05 && r + g + b < 420) forest[y * W + x] = 1;
      }
    }
  }
  // distance-to-coast in water (for the shallow wash + contour rule), up to 12 px
  const dist = new Uint8Array(W * H).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < land.length; i++) if (land[i]) { dist[i] = 0; frontier.push(i); }
  for (let d = 1; d <= 12 && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % W, y = (i / W) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const n of nb) if (n >= 0 && dist[n] === 255) { dist[n] = d; next.push(n); }
    }
    frontier = next;
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d')!;
  const img = cx.createImageData(W, H);
  const d = img.data;
  const set = (i: number, r: number, g: number, b: number, a = 255) => { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (land[i]) {
      const coast = (x > 0 && !land[i - 1]) || (x < W - 1 && !land[i + 1]) || (y > 0 && !land[i - W]) || (y < H - 1 && !land[i + W]);
      if (coast) set(i, 0x2b, 0x26, 0x22);
      else if (forest[i]) {
        const stip = ((x * 7 + y * 13) % 9 === 0) || ((x * 3 + y * 5) % 11 === 0);
        if (stip) set(i, 0x4f, 0x6b, 0x4a); else set(i, 0xc9, 0xc6, 0xa4);
      } else set(i, 0xe2, 0xd2, 0xae);
    } else {
      const dd = dist[i];
      if (dd <= 12) {
        // shallow-water wash fading out, with one fine contour rule at 7 px
        const a = dd === 7 ? 150 : Math.max(0, 110 - dd * 9);
        set(i, 0x2e, 0x5e, 0x63, a);
      } else set(i, 0, 0, 0, 0);
    }
  }
  cx.putImageData(img, 0, 0);
  return c;
}

export const chart = new Chart();
