/**
 * The Map tab's chart view (docs/map_study.md). Draw order, back to front:
 *   unsurveyed paper (hatched) → [clip: seen area] chart raster, ripple lines, coastline, rocks, soundings,
 *   fish marks → pencilled survey limit → track + compass line → glyphs → labels (collision-placed, never
 *   clipped) → canoe → neatline border, rose, cartouche, scale.
 * All heavy work (land render, contours, raster) is cached in chart.ts/chartart.ts; this only transforms.
 */
import { ctx, reduceMotion } from './ctx';
import { chart, type Place } from './chart';
import { log, prefs } from './prefs';
import { drawGlyph, glyphFor, type Glyph } from './mapglyphs';
import { hash2 } from './chartart';

const INK = '#2B2622', INK_SOFT = '#6B5E52', PAPER = '#F4EFE3', PAPER2 = '#E9E1CF', OCHRE = '#9E3B2A', CEDAR = '#B5643C', GOLD = '#BFA46A';
const F_DISPLAY = '"Fraunces Logbook", Georgia, serif';
const F_HAND = '"Caveat Hand", cursive';
const F_UI = '"Nunito UI", sans-serif';

export interface MapItem { key: string; keys: string[]; name: string; x: number; z: number; glyph: Glyph; kind: Place['kind']; lx?: number; lz?: number }

const anchors = new Map<string, [number, number] | null>();
let anchorsFor: unknown = null;
/** island names sit on the island's most inland point, not on the dock/interact point */
function islandLabelAt(it: MapItem): [number, number] | null {
  const art = chart.art;
  if (!art) return null;
  if (anchorsFor !== art) { anchors.clear(); anchorsFor = art; }
  const id = it.keys.join('|');
  if (!anchors.has(id)) {
    const b = chart.bounds;
    const a = art.islandAnchor((it.x - b.minX) * art.k, (it.z - b.minZ) * art.k, 70 * art.k);
    anchors.set(id, a ? [a[0] / art.k + b.minX, a[1] / art.k + b.minZ] : null);
  }
  return anchors.get(id)!;
}

let rocksFor: unknown = null, rocksKept: [number, number][] = [];
/** chart rock marks, minus specks that are really our own buoys, pots and pilings */
function chartRocks(): [number, number][] {
  const art = chart.art!;
  if (rocksFor === art) return rocksKept;
  const b = chart.bounds;
  const busy = [...chart.hotspots.map((h) => [h.x, h.z]), ...chart.places.map((p) => [p.x, p.z])];
  rocksKept = art.rocks.filter(([x, y]) => {
    const wx = x / art.k + b.minX, wz = y / art.k + b.minZ;
    return !busy.some(([hx, hz]) => Math.hypot(hx - wx, hz - wz) < 14);
  });
  rocksFor = art;
  return rocksKept;
}

/** Visited places, merged when the same name appears twice close together (e.g. an island with two docks). */
export function mapItems(all = false): MapItem[] {
  const out: MapItem[] = [];
  for (const p of chart.places) {
    if (!all && !log.places.includes(p.key)) continue;
    const twin = out.find((q) => q.name === p.name && Math.hypot(q.x - p.x, q.z - p.z) < 220);
    if (twin) {
      const n = twin.keys.length;
      twin.x = (twin.x * n + p.x) / (n + 1); twin.z = (twin.z * n + p.z) / (n + 1);
      twin.keys.push(p.key);
      continue;
    }
    out.push({ key: p.key, keys: [p.key], name: p.name, x: p.x, z: p.z, glyph: glyphFor(p), kind: p.kind });
  }
  for (const it of out) if (it.glyph === 'island') { const a = islandLabelAt(it); if (a) { it.lx = a[0]; it.lz = a[1]; } }
  return out;
}

const onLand = (it: MapItem) => it.glyph === 'island' && it.lx !== undefined;
const PRIO: Record<Glyph, number> = { town: 0, island: 1, stone: 2, cairn: 2, beacon: 3, wreck: 4, rock: 4, kelp: 4, mark: 5, pots: 6, fish: 7 };

type Rect = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export class MapView {
  private cv!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  s = 1.2; // css px per metre
  cx = 0; cz = 0;
  private pts = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private raf = 0;
  private washT = 1;
  private centred = false;
  private sized = false;
  private hatch: CanvasPattern | null = null;
  private hatchDpr = 0;
  private reserved: Rect[] = [];
  /** labels/glyphs drawn last frame (css px) for tapping */
  private targets: { key: string; r: Rect; cx: number; cy: number }[] = [];
  onPick: (key: string) => void = () => {};
  lastDrawMs = 0;

  attach(cv: HTMLCanvasElement, ctl: HTMLElement) {
    this.cv = cv;
    this.g = cv.getContext('2d')!;
    if (!this.centred) { this.cx = ctx.boat.x; this.cz = ctx.boat.z; this.centred = true; }
    this.fit();
    if (!this.sized) { const r = cv.getBoundingClientRect(); this.s = Math.min(r.width, r.height) / 340; this.sized = true; }
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.moved = 0; };
    cv.onpointermove = (e) => {
      const p = this.pts.get(e.pointerId);
      if (!p) return;
      if (this.pts.size === 1) {
        this.cx -= (e.clientX - p.x) / this.s; this.cz -= (e.clientY - p.y) / this.s;
        this.moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
      } else {
        const [a, b] = [...this.pts.entries()];
        const other = a[0] === e.pointerId ? b[1] : a[1];
        const d0 = Math.hypot(p.x - other.x, p.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        // zoom about the pinch midpoint so the place under your fingers stays put
        if (d0 > 10) { const r = cv.getBoundingClientRect(); this.zoomAt(d1 / d0, (e.clientX + other.x) / 2 - r.left, (e.clientY + other.y) / 2 - r.top); }
        this.moved += 99;
      }
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.request();
    };
    cv.onpointerup = (e) => {
      this.pts.delete(e.pointerId);
      if (this.moved < 6) this.tap(e.clientX, e.clientY);
    };
    cv.onpointercancel = (e) => this.pts.delete(e.pointerId);
    cv.onwheel = (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); this.request(); };
    ctl.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) => (b.onclick = () => { this.zoom(Number(b.dataset.z)); this.request(); }));
    ctl.querySelector<HTMLButtonElement>('[data-c]')!.onclick = () => { this.cx = ctx.boat.x; this.cz = ctx.boat.z; this.request(); };
    // reserve the control buttons so labels never hide under them
    const cr = cv.getBoundingClientRect();
    this.reserved = [...ctl.children].map((b) => b.getBoundingClientRect()).map((r) => ({ x0: r.left - cr.left - 4, y0: r.top - cr.top - 4, x1: r.right - cr.left + 4, y1: r.bottom - cr.top + 4 }));
    // opening ink-wash (radial reveal from the canoe)
    this.washT = reduceMotion() ? 1 : 0;
    const t0 = performance.now();
    const step = () => {
      this.washT = Math.min(1, (performance.now() - t0) / 600);
      this.draw();
      if (this.washT < 1) this.raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(step);
  }
  stop() { cancelAnimationFrame(this.raf); }

  private fit() {
    const cv = this.cv;
    const r = cv.parentElement!.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.max(10, Math.round(r.height * dpr));
    cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`;
  }

  private pending = false;
  request() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.draw(); });
  }

  private zoom(k: number) { this.s = Math.min(8, Math.max(0.3, this.s * k)); }
  private zoomAt(k: number, x: number, y: number) {
    const r = this.cv.getBoundingClientRect();
    const wx = this.cx + (x - r.width / 2) / this.s, wz = this.cz + (y - r.height / 2) / this.s;
    this.zoom(k);
    this.cx = wx - (x - r.width / 2) / this.s; this.cz = wz - (y - r.height / 2) / this.s;
  }

  setView(x: number, z: number, s?: number) { this.cx = x; this.cz = z; if (s) this.s = s; this.sized = true; this.centred = true; if (this.cv) this.draw(); }

  /** world → css px within the canvas */
  private css(x: number, z: number, cw: number, ch: number): [number, number] {
    return [(x - this.cx) * this.s + cw / 2, (z - this.cz) * this.s + ch / 2];
  }

  private tap(clx: number, cly: number) {
    const r = this.cv.getBoundingClientRect();
    const x = clx - r.left, y = cly - r.top;
    let best: string | null = null, bd = 30;
    for (const t of this.targets) {
      if (x >= t.r.x0 && x <= t.r.x1 && y >= t.r.y0 && y <= t.r.y1) { best = t.key; break; }
      const d = Math.hypot(t.cx - x, t.cy - y);
      if (d < bd) { bd = d; best = t.key; }
    }
    if (best) this.onPick(best);
  }

  private hatchPattern(dpr: number) {
    if (this.hatch && this.hatchDpr === dpr) return this.hatch;
    const n = Math.round(9 * dpr);
    const c = document.createElement('canvas'); c.width = n; c.height = n;
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(133,126,114,.30)'; g.lineWidth = Math.max(1, 0.8 * dpr);
    g.beginPath(); g.moveTo(-1, n + 1); g.lineTo(n + 1, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(n - 1, n + 1); g.lineTo(n + 1, n - 1); g.stroke();
    this.hatch = this.g.createPattern(c, 'repeat'); this.hatchDpr = dpr;
    return this.hatch!;
  }

  draw() {
    const t0 = performance.now();
    const g = this.g, W = this.cv.width, H = this.cv.height;
    const rect = this.cv.getBoundingClientRect();
    const cw = rect.width || W, ch = rect.height || H;
    const dpr = W / cw;
    const ts = prefs.textScale;
    const b = chart.bounds;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    // unsurveyed: darker paper, faint pencil hatching anchored to the world so it doesn't swim when panning
    g.fillStyle = PAPER2; g.fillRect(0, 0, W, H);
    const pat = this.hatchPattern(dpr);
    const [hx, hy] = this.css(0, 0, cw, ch);
    pat.setTransform?.(new DOMMatrix().translateSelf((hx * dpr) % (9 * dpr), (hy * dpr) % (9 * dpr)));
    g.fillStyle = pat; g.fillRect(0, 0, W, H);

    const art = chart.ensureArt();
    const [bx, bz] = this.css(ctx.boat.x, ctx.boat.z, cw, ch);
    const items = mapItems();
    if (art) {
      const a = (this.s * dpr) / art.k; // raster px → device px
      const ox = (W / 2) - (this.cx - b.minX) * this.s * dpr, oy = (H / 2) - (this.cz - b.minZ) * this.s * dpr;
      const fog = chart.fogPath()!;
      g.save();
      if (this.washT < 1) {
        const t = this.washT, e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
        g.beginPath(); g.arc(bx * dpr, bz * dpr, Math.hypot(W, H) * e, 0, Math.PI * 2); g.clip();
      }
      g.setTransform(a, 0, 0, a, ox, oy);
      g.clip(fog, 'evenodd');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(art.base, 0, 0);
      g.lineJoin = 'round';
      const rip = [0.46, 0.3, 0.17];
      for (let i = 0; i < art.ripples.length; i++) {
        g.strokeStyle = `rgba(46,72,74,${rip[i]})`; g.lineWidth = (0.9 * dpr) / a; g.stroke(art.ripples[i]);
      }
      g.strokeStyle = INK; g.lineWidth = (1.7 * dpr) / a; g.stroke(art.coast);
      g.setTransform(1, 0, 0, 1, 0, 0);
      // rocks: a small chart cross, fixed screen size
      g.strokeStyle = 'rgba(43,38,34,.55)'; g.lineWidth = 1.1 * dpr; g.lineCap = 'round';
      g.beginPath();
      const rr = 2.2 * dpr * Math.min(1.4, Math.max(0.8, this.s));
      for (const [x, y] of chartRocks()) {
        const X = x * a + ox, Y = y * a + oy;
        if (X < -10 || Y < -10 || X > W + 10 || Y > H + 10) continue;
        g.moveTo(X - rr, Y); g.lineTo(X + rr, Y); g.moveTo(X, Y - rr); g.lineTo(X, Y + rr);
      }
      g.stroke();
      // fishing marks (seen hotspots): a small fish, quieter than places
      for (const hs of chart.hotspots) {
        if (!chart.isSeen(hs.x, hs.z)) continue;
        const [x, y] = this.css(hs.x, hs.z, cw, ch);
        if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
        drawGlyph(g, 'fish', x * dpr, y * dpr, 15 * dpr, 0.62);
      }
      g.restore();
      // survey limit: a pencil line along the ragged edge of what you've seen
      g.save();
      g.setTransform(a, 0, 0, a, ox, oy);
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(133,126,114,.22)'; g.lineWidth = (5 * dpr) / a; g.stroke(fog);
      g.strokeStyle = 'rgba(107,94,82,.85)'; g.lineWidth = (1.3 * dpr) / a; g.stroke(fog);
      g.restore();
    }

    // track (dashed, like the old survey triangulation lines)
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round';
    if (log.path.length >= 4) {
      g.strokeStyle = 'rgba(158,59,42,.55)'; g.lineWidth = 1.6; g.setLineDash([2, 5]);
      g.beginPath();
      for (let i = 0; i < log.path.length; i += 2) {
        const [x, y] = this.css(log.path[i], log.path[i + 1], cw, ch);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.lineTo(bx, bz);
      g.stroke(); g.setLineDash([]);
    }
    // compass line to the destination
    const dest = items.find((it) => it.keys.includes(log.dest ?? ''));
    if (dest) {
      const [dx, dy] = this.css(dest.x, dest.z, cw, ch);
      g.strokeStyle = PAPER; g.lineWidth = 4.5; g.beginPath(); g.moveTo(bx, bz); g.lineTo(dx, dy); g.stroke();
      g.strokeStyle = OCHRE; g.lineWidth = 2; g.setLineDash([9, 6]); g.beginPath(); g.moveTo(bx, bz); g.lineTo(dx, dy); g.stroke(); g.setLineDash([]);
      g.strokeStyle = PAPER; g.lineWidth = 5; g.beginPath(); g.arc(dx, dy, 15, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = OCHRE; g.lineWidth = 2.5; g.beginPath(); g.arc(dx, dy, 15, 0, Math.PI * 2); g.stroke();
    }

    // ---------------------------------------------------------------- furniture (reserved before labels)
    const placed: Rect[] = [...this.reserved];
    const pad = 9; // neatline band + breathing room
    this.drawNeatline(g, cw, ch);
    placed.push(this.drawRose(g, cw - 40, 46));
    placed.push(this.drawCartouche(g, pad + 4, pad + 4, cw));
    placed.push(this.drawScale(g, pad + 6, ch - pad - 8, cw));

    // ---------------------------------------------------------------- glyphs + labels
    this.targets = [];
    const sorted = items.slice().sort((p, q) => (p === dest ? -1 : q === dest ? 1 : PRIO[p.glyph] - PRIO[q.glyph]));
    const vis = sorted.map((it) => ({ it, p: it.lx !== undefined ? this.css(it.lx, it.lz!, cw, ch) : this.css(it.x, it.z, cw, ch) }))
      .filter(({ p: [x, y] }) => x > -40 && y > -40 && x < cw + 40 && y < ch + 40);
    // the canoe's halo is an obstacle for labels
    placed.push({ x0: bx - 18, y0: bz - 18, x1: bx + 18, y1: bz + 18 });
    const GS = 18; // glyph size, css
    for (const { it, p: [x, y] } of vis) {
      if (onLand(it)) continue;
      placed.push({ x0: x - GS / 2, y0: y - GS / 2, x1: x + GS / 2, y1: y + GS / 2 });
    }
    for (const { it, p: [x, y] } of vis) {
      if (onLand(it)) continue;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = 'rgba(244,239,227,.85)'; g.beginPath(); g.arc(x * dpr, y * dpr, (GS / 2 + 1) * dpr, 0, Math.PI * 2); g.fill();
      if (it.glyph === 'island') {
        // an island the chart has no outline for: a dashed "position doubtful" ring, as on old charts
        g.save(); g.strokeStyle = INK_SOFT; g.lineWidth = 1.6 * dpr; g.setLineDash([3 * dpr, 3 * dpr]);
        g.beginPath(); g.ellipse(x * dpr, y * dpr, 9 * dpr, 6.5 * dpr, 0, 0, Math.PI * 2); g.stroke(); g.restore();
      } else drawGlyph(g, it.glyph, x * dpr, y * dpr, GS * dpr);
      this.targets.push({ key: it.key, r: { x0: x - 12, y0: y - 12, x1: x + 12, y1: y + 12 }, cx: x, cy: y });
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const frame: Rect = { x0: pad, y0: pad, x1: cw - pad, y1: ch - pad };
    for (const { it, p: [x, y] } of vis) {
      const isDest = it === dest;
      if (it.glyph === 'pots' && !isDest && this.s < 2.4) continue;
      const style = labelStyle(it, isDest, ts);
      g.font = style.font;
      const text = style.text;
      const tw = spacedWidth(g, text, style.spacing);
      const th = style.size * 0.78;
      const off = onLand(it) ? 0 : GS / 2 + 3;
      const cands: [number, number][] = onLand(it)
        ? [[x - tw / 2, y + th / 2], [x - tw / 2, y - 8], [x - tw / 2, y + th + 8], [x - tw * 0.15, y + th / 2], [x - tw * 0.85, y + th / 2],
          [x - tw * 0.15, y - 8], [x - tw * 0.85, y - 8], [x - tw * 0.15, y + th + 8], [x - tw * 0.85, y + th + 8]]
        : [[x + off, y - 2], [x - off - tw, y - 2], [x + off, y + th + 2], [x - off - tw, y + th + 2],
          [x + off, y + th / 2], [x - off - tw, y + th / 2], [x - tw / 2, y - off - 1], [x - tw / 2, y + off + th + 1]];
      let at: [number, number] | null = null;
      for (const [lx, ly] of cands) {
        const r: Rect = { x0: lx - 2, y0: ly - th - 2, x1: lx + tw + 2, y1: ly + 3 };
        if (r.x0 < frame.x0 || r.y0 < frame.y0 || r.x1 > frame.x1 || r.y1 > frame.y1) continue;
        if (placed.some((q) => hit(q, r))) continue;
        at = [lx, ly]; break;
      }
      if (!at && (isDest || it.glyph === 'town')) {
        // must-show labels are pulled inside the frame instead of being dropped
        // must-show labels are pulled inside the frame instead of being dropped, avoiding the furniture if possible
        const clamp = ([lx, ly]: [number, number]): [number, number] => [Math.min(frame.x1 - tw - 2, Math.max(frame.x0 + 2, lx)), Math.min(frame.y1 - 3, Math.max(frame.y0 + th + 2, ly))];
        const fixed = this.reserved.concat(placed.slice(this.reserved.length, this.reserved.length + 3));
        at = ([...cands, [x - tw - 22, y + th / 2], [x - tw / 2, y - 24], [x - tw / 2, y + th + 26]] as [number, number][]).map(clamp).find(([lx, ly]) => !fixed.some((q) => hit(q, { x0: lx - 2, y0: ly - th - 2, x1: lx + tw + 2, y1: ly + 3 }))) ?? clamp(cands[0]);
      }
      if (!at) continue;
      const [lx, ly] = at;
      const r: Rect = { x0: lx - 2, y0: ly - th - 2, x1: lx + tw + 2, y1: ly + 3 };
      placed.push(r);
      this.targets.push({ key: it.key, r, cx: x, cy: y });
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      g.lineWidth = 4; g.strokeStyle = 'rgba(244,239,227,.92)';
      spacedText(g, text, lx, ly, style.spacing, true);
      g.fillStyle = style.color;
      spacedText(g, text, lx, ly, style.spacing, false);
      if (isDest) { g.strokeStyle = OCHRE; g.lineWidth = 1.6; g.beginPath(); g.moveTo(lx, ly + 3); g.lineTo(lx + tw, ly + 2); g.stroke(); }
    }

    // soundings last, clipped to the seen area and kept out of every label, glyph and piece of furniture
    if (art) {
      const a = (this.s * dpr) / art.k;
      const ox = (W / 2) - (this.cx - b.minX) * this.s * dpr, oy = (H / 2) - (this.cz - b.minZ) * this.s * dpr;
      const spacing = 38 * this.s; // css px between soundings; thinned when zoomed out so the sea stays calm
      const keep = spacing >= 46 ? 1 : spacing >= 30 ? 0.5 : spacing >= 18 ? 0.22 : 0;
      if (keep > 0) {
        g.save();
        g.setTransform(a, 0, 0, a, ox, oy); g.clip(chart.fogPath()!, 'evenodd'); g.setTransform(1, 0, 0, 1, 0, 0);
        g.font = `italic 600 ${Math.round(10.5 * dpr * ts)}px ${F_DISPLAY}`;
        g.fillStyle = 'rgba(85,98,96,.72)'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const fish = chart.hotspots.map((h) => this.css(h.x, h.z, cw, ch));
        for (const q of art.soundings) {
          if (keep < 1 && hash2(q.x | 0, q.y | 0) > keep) continue;
          const X = q.x * a + ox, Y = q.y * a + oy;
          if (X < -20 || Y < -20 || X > W + 20 || Y > H + 20) continue;
          const r: Rect = { x0: X / dpr - 9, y0: Y / dpr - 7, x1: X / dpr + 9, y1: Y / dpr + 7 };
          if (r.x0 < 9 || r.y0 < 9 || r.x1 > cw - 9 || r.y1 > ch - 9 || placed.some((p) => hit(p, r)) || fish.some(([fx, fy]) => Math.abs(fx - X / dpr) < 16 && Math.abs(fy - Y / dpr) < 10)) continue;
          g.fillText(String(q.v), X, Y);
        }
        g.restore();
      }
    }
    this.drawBoat(g, bx, bz, cw, ch, dpr);
    this.lastDrawMs = performance.now() - t0;
  }

  // ---------------------------------------------------------------- pieces
  private drawBoat(g: CanvasRenderingContext2D, bx: number, bz: number, cw: number, ch: number, dpr: number) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = 24;
    const inside = bx > m && bz > m && bx < cw - m && bz < ch - m;
    let x = bx, y = bz;
    if (!inside) {
      // off-chart: a pointer on the frame edge, toward the canoe
      const dx = bx - cw / 2, dy = bz - ch / 2;
      const k = Math.min((cw / 2 - m) / Math.abs(dx || 1e-6), (ch / 2 - m) / Math.abs(dy || 1e-6));
      x = cw / 2 + dx * k; y = ch / 2 + dy * k;
      const ang = Math.atan2(dy, dx);
      g.save(); g.translate(x, y); g.rotate(ang);
      g.fillStyle = OCHRE; g.strokeStyle = INK; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(24, 0); g.lineTo(14, -7); g.lineTo(14, 7); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    // halo + ring so the canoe pops off busy coastlines
    g.fillStyle = 'rgba(244,239,227,.9)'; g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.fill();
    g.strokeStyle = OCHRE; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.stroke();
    g.save();
    g.translate(x, y); g.rotate(-ctx.boat.yaw);
    // heading tick ahead of the bow
    g.fillStyle = OCHRE;
    g.beginPath(); g.moveTo(0, -25); g.lineTo(5, -18.5); g.lineTo(-5, -18.5); g.closePath(); g.fill();
    g.fillStyle = CEDAR; g.strokeStyle = INK; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(0, -13); g.quadraticCurveTo(7, -2, 0, 13); g.quadraticCurveTo(-7, -2, 0, -13); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(43,38,34,.7)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-3, -3); g.lineTo(3, -3); g.moveTo(-3, 4); g.lineTo(3, 4); g.stroke();
    g.restore();
  }

  /** Chart border: a thin rule and a band of alternating 100 m ink/paper ticks (doubles as a scale). */
  private drawNeatline(g: CanvasRenderingContext2D, cw: number, ch: number) {
    const o = 3, w = 4;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, cw, o + w); g.fillRect(0, ch - o - w, cw, o + w); g.fillRect(0, 0, o + w, ch); g.fillRect(cw - o - w, 0, o + w, ch);
    const step = 100 * this.s;
    g.fillStyle = INK;
    if (step >= 8) {
      const x0 = ((cw / 2 - this.cx * this.s) % (2 * step) + 2 * step) % (2 * step) - 2 * step;
      for (let x = x0; x < cw; x += 2 * step) {
        const a = Math.max(o, x), bb = Math.min(cw - o, x + step);
        if (bb > a) { g.fillRect(a, o, bb - a, w); g.fillRect(a, ch - o - w, bb - a, w); }
      }
      const y0 = ((ch / 2 - this.cz * this.s) % (2 * step) + 2 * step) % (2 * step) - 2 * step;
      for (let y = y0; y < ch; y += 2 * step) {
        const a = Math.max(o, y), bb = Math.min(ch - o, y + step);
        if (bb > a) { g.fillRect(o, a, w, bb - a); g.fillRect(cw - o - w, a, w, bb - a); }
      }
    }
    g.strokeStyle = INK; g.lineWidth = 1;
    g.strokeRect(o + 0.5, o + 0.5, cw - 2 * o - 1, ch - 2 * o - 1);
    g.strokeRect(o + w + 0.5, o + w + 0.5, cw - 2 * (o + w) - 1, ch - 2 * (o + w) - 1);
  }

  /** Abstract rose: four long two-tone trigons, four short ones, a ticked ring. Returns its rect. */
  private drawRose(g: CanvasRenderingContext2D, x: number, y: number): Rect {
    const R = 27;
    g.save(); g.translate(x, y);
    g.fillStyle = 'rgba(244,239,227,.8)'; g.beginPath(); g.arc(0, 0, R + 3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK_SOFT; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, R - 4, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2, l = i % 4 === 0 ? 4 : 2;
      g.moveTo(Math.cos(a) * R, Math.sin(a) * R); g.lineTo(Math.cos(a) * (R - l), Math.sin(a) * (R - l));
    }
    g.stroke();
    const trigon = (ang: number, len: number, wid: number, dark: string, light: string) => {
      g.save(); g.rotate(ang);
      g.fillStyle = dark; g.beginPath(); g.moveTo(0, -len); g.lineTo(wid, 0); g.lineTo(0, 0); g.closePath(); g.fill();
      g.fillStyle = light; g.beginPath(); g.moveTo(0, -len); g.lineTo(-wid, 0); g.lineTo(0, 0); g.closePath(); g.fill();
      g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -len); g.lineTo(wid, 0); g.lineTo(0, 0); g.lineTo(-wid, 0); g.closePath(); g.stroke();
      g.restore();
    };
    for (let i = 0; i < 4; i++) trigon(Math.PI / 4 + (i * Math.PI) / 2, R * 0.55, 3.5, GOLD, PAPER);
    for (let i = 1; i < 4; i++) trigon((i * Math.PI) / 2, R - 5, 5, INK, PAPER);
    trigon(0, R - 2, 5.5, OCHRE, PAPER);
    g.fillStyle = INK; g.beginPath(); g.arc(0, 0, 1.8, 0, Math.PI * 2); g.fill();
    g.font = `700 12px ${F_DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.lineWidth = 3; g.strokeStyle = PAPER; g.strokeText('N', 0, -R - 3); g.fillText('N', 0, -R - 3);
    g.restore();
    return { x0: x - R - 4, y0: y - R - 16, x1: x + R + 4, y1: y + R + 4 };
  }

  /** Hand-lettered title cartouche (top-left). */
  private drawCartouche(g: CanvasRenderingContext2D, x: number, y: number, cw: number): Rect {
    const small = cw < 440;
    const t1 = 'CEDAR LANDING', t2 = 'and the islands about';
    g.font = `700 ${small ? 11 : 13}px ${F_DISPLAY}`;
    const sp = small ? 1.6 : 2;
    const w1 = spacedWidth(g, t1, sp);
    g.font = `600 ${small ? 15 : 17}px ${F_HAND}`;
    const w2 = g.measureText(t2).width;
    const w = Math.max(w1, w2) + 18, h = small ? 40 : 46;
    g.fillStyle = 'rgba(244,239,227,.93)'; g.strokeStyle = INK; g.lineWidth = 1.2;
    roundRect(g, x, y, w, h, 3); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(43,38,34,.45)'; g.lineWidth = 0.8; roundRect(g, x + 2.5, y + 2.5, w - 5, h - 5, 2); g.stroke();
    g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `700 ${small ? 11 : 13}px ${F_DISPLAY}`;
    spacedText(g, t1, x + (w - w1) / 2, y + (small ? 17 : 20), sp, false);
    g.font = `600 ${small ? 15 : 17}px ${F_HAND}`; g.fillStyle = INK_SOFT;
    g.fillText(t2, x + (w - w2) / 2, y + (small ? 33 : 38));
    return { x0: x - 2, y0: y - 2, x1: x + w + 2, y1: y + h + 2 };
  }

  /** Scale bar in fathoms (or metres if that's the chosen unit): alternating ink/paper segments. */
  private drawScale(g: CanvasRenderingContext2D, x: number, yBase: number, cw: number): Rect {
    const metres = prefs.units === 'metres';
    const unit = metres ? 1 : 1.8288;
    const nice = metres ? [10, 20, 25, 50, 100, 200, 250, 500] : [5, 10, 25, 50, 100, 200, 250];
    const target = Math.min(cw * 0.1, 44); // css px per segment
    let seg = nice[nice.length - 1];
    for (const n of nice) if (n * unit * this.s >= target * 0.7) { seg = n; break; }
    const px = seg * unit * this.s;
    const n = 3;
    const y = yBase - 4;
    g.fillStyle = 'rgba(244,239,227,.85)';
    const label = metres ? 'metres' : 'fathoms';
    g.font = `700 10px ${F_UI}`;
    const lw = g.measureText(label).width;
    g.fillRect(x - 4, y - 18, px * n + lw + 18, 26);
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? PAPER : INK;
      g.fillRect(x + i * px, y, px, 4);
    }
    g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, px * n - 1, 4);
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (let i = 0; i <= n; i++) g.fillText(String(i * seg), x + i * px, y - 4);
    g.textAlign = 'left'; g.fillStyle = INK_SOFT; g.fillText(label, x + px * n + 8, y + 5);
    return { x0: x - 6, y0: y - 20, x1: x + px * n + lw + 16, y1: y + 10 };
  }
}

function labelStyle(it: MapItem, dest: boolean, ts: number) {
  let size: number, font: string, color = INK, text = it.name, spacing = 0;
  switch (it.glyph) {
    case 'town': size = 16 * ts; font = `700 ${size}px ${F_DISPLAY}`; break;
    case 'island': size = 11 * ts; font = `700 ${size}px ${F_DISPLAY}`; text = it.name.toUpperCase(); spacing = 1.8 * ts; color = '#4A4038'; break;
    case 'stone': case 'cairn': size = 19 * ts; font = `700 ${size}px ${F_HAND}`; color = OCHRE; break;
    case 'pots': size = 16 * ts; font = `600 ${size}px ${F_HAND}`; color = INK_SOFT; text = dest ? it.name : 'crab pots'; break;
    default: size = 18 * ts; font = `600 ${size}px ${F_HAND}`;
  }
  if (dest) color = OCHRE;
  return { size, font, color, text, spacing };
}

function spacedWidth(g: CanvasRenderingContext2D, t: string, sp: number) {
  return g.measureText(t).width + (sp ? sp * (t.length - 1) : 0);
}
function spacedText(g: CanvasRenderingContext2D, t: string, x: number, y: number, sp: number, stroke: boolean) {
  if (!sp) { if (stroke) g.strokeText(t, x, y); else g.fillText(t, x, y); return; }
  let cx = x;
  for (const ch of t) {
    if (stroke) g.strokeText(ch, cx, y); else g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + sp;
  }
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export const mapView = new MapView();

/** window.__debug.ui.map — used by scripts/map_shots.mjs */
export const chartDebug = {
  info: () => ({
    bounds: chart.bounds, buildMs: chart.buildMs, mainMs: chart.mainMs, stages: chart.art?.t, ready: !!chart.art, drawMs: mapView.lastDrawMs,
    view: { x: mapView.cx, z: mapView.cz, s: mapView.s },
    items: mapItems(true).map((i) => ({ key: i.key, name: i.name, glyph: i.glyph, x: Math.round(i.x), z: Math.round(i.z), merged: i.keys.length, ...(i.lx !== undefined ? { lx: Math.round(i.lx), lz: Math.round(i.lz!) } : {}) })),
    rocks: chart.art?.rocks.length ?? 0, soundings: chart.art?.soundings.length ?? 0,
  }),
  revealOnly: (spots: [number, number, number][]) => chart.revealOnly(spots),
  view: (x: number, z: number, s?: number) => mapView.setView(x, z, s),
  setDest: (key: string | null) => chart.setDestination(key),
  resetPlaces: (keys: string[]) => { log.places.splice(0, log.places.length, ...keys); },
};
