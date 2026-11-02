/**
 * The Log's chart (ui_design §4.6 Map; redesign notes in docs/map_study.md): chart art is made once from a
 * top-down render of the world (land = anything above the waterline) — vector coastline + offset ripple
 * lines + a cached raster (chartart.ts) — and revealed by the canoe's sight radius through a 128×128 bitmask
 * stored in localStorage, drawn as a pencilled survey limit. Drawing lives in mapview.ts. Tap a place → compass.
 */
import * as THREE from 'three';
import { ctx } from './ctx';
import { log, saveLog, loadMask, saveMask } from './prefs';
import type { LoadedWorld } from '../world/types';
import { buildChartArt, fogPath, type ChartArt } from './chartart';

const MASK = 128;
const FIELD_MAX = 1024; // px, longest side of the top-down land render (vector coast is extracted from it)
const ART_MAX = 2048; // px, longest side of the cached chart raster

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
  art: ChartArt | null = null;
  private fog: Path2D | null = null;
  private fogFor = -1;
  /** ms spent building the chart art last time (perf note in docs/map_study.md) */
  buildMs = 0;
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
    this.texture = null; this.art = null;
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
  /** Render the world top-down once and ink it into a chart (vector coast + cached raster). */
  ensureTexture(): HTMLCanvasElement | null {
    return this.ensureArt()?.base ?? null;
  }

  ensureArt(): ChartArt | null {
    if (this.art) return this.art;
    const src = ctx.chart, w = ctx.world;
    if (!src || !w) return null;
    const t0 = performance.now();
    const b = this.bounds;
    const ww = b.maxX - b.minX, hh = b.maxZ - b.minZ;
    const s = FIELD_MAX / Math.max(ww, hh);
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
    for (const o of src.show?.() ?? []) { restore.push([o, o.visible]); o.visible = true; }
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
    this.art = buildChartArt(px, W, H, ww, ART_MAX);
    this.texture = this.art.base;
    this.fogFor = -1;
    this.buildMs = performance.now() - t0;
    return this.art;
  }

  /** The seen area as a ragged closed path in chart-raster px (rebuilt only when the mask changes). */
  fogPath(): Path2D | null {
    const art = this.ensureArt();
    if (!art) return null;
    if (this.fog && this.fogFor === this.maskVersion) return this.fog;
    this.fog = fogPath(this.mask, MASK, art.W, art.H);
    this.fogFor = this.maskVersion;
    return this.fog;
  }

  /** debug/captures: reveal only a set of circles (metres) */
  revealOnly(spots: [number, number, number][]) {
    this.mask.fill(0);
    for (const [x, z, r] of spots) this.reveal(x, z, r);
    this.maskVersion++; this.dirty = true; this.persist();
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
    const art = this.art!;
    const sc = px / (half * 2);
    cc.save(); cc.setTransform(sc, 0, 0, sc, -(tx - half) * sc, -(tz - half) * sc);
    cc.lineJoin = 'round';
    cc.strokeStyle = 'rgba(43,38,34,.35)'; cc.lineWidth = 1 / sc; cc.stroke(art.ripples[0]);
    cc.strokeStyle = '#2B2622'; cc.lineWidth = 1.8 / sc; cc.stroke(art.coast);
    cc.restore();
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

export const chart = new Chart();
