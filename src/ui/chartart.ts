/**
 * Chart art (docs/map_study.md): turns the top-down land render into an engraved-chart look.
 *  - coastline: marching squares on a lightly blurred land mask + Chaikin smoothing → crisp vector ink line
 *    (replaces the stair-stepped raster edge)
 *  - offset "ripple" lines: iso-lines of a Euclidean distance field in the water (Admiralty/Dredge style;
 *    replaces the Manhattan-distance diamond halos)
 *  - a cached raster for the soft things only: paper, shoal tint + stipple, land fill, a green watercolour
 *    band inside the coast (US Coast Survey 1857/1867), conifer tree marks for forest (Admiralty 2689)
 *  - rocks (tiny land specks) become chart rock marks; soundings are sparse numerals placed in deep water
 * Everything is built once per world and cached; the Map view only transforms and clips it.
 */

export interface ChartArt {
  /** raster size in px and px per metre */
  W: number; H: number; k: number;
  base: HTMLCanvasElement;
  coast: Path2D;
  ripples: Path2D[];
  rocks: [number, number][];
  soundings: { x: number; y: number; v: number }[];
  isLand(x: number, y: number): boolean;
  /** the most inland point of the biggest island within r (raster px) of (x,y) — where its name goes */
  islandAnchor(x: number, y: number, r: number): [number, number] | null;
}

const PAPER = '#F4EFE3';

// ------------------------------------------------------------------ field helpers
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Felzenszwalb–Huttenlocher squared Euclidean distance transform; returns distance (px) to nearest `on` pixel. */
function edt(on: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e12;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = on[i] ? 0 : INF;
  const pass = (n: number) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

/**
 * Marching squares → closed loops (the field is padded with "outside" so every loop closes).
 * Returns flat [x0,y0,x1,y1,…] arrays in field pixel-centre coordinates.
 */
export function contours(f: Float32Array, w: number, h: number, iso: number): Float32Array[] {
  const val = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? iso - 1 : f[y * w + x]);
  const P = w + 2;
  const hid = (x: number, y: number) => ((y + 1) * P + (x + 1)) * 2; // (x,y)→(x+1,y)
  const vid = (x: number, y: number) => ((y + 1) * P + (x + 1)) * 2 + 1; // (x,y)→(x,y+1)
  const nb = new Map<number, number[]>();
  const pos = new Map<number, [number, number]>();
  const link = (a: number, b: number) => {
    let la = nb.get(a); if (!la) nb.set(a, (la = [])); la.push(b);
    let lb = nb.get(b); if (!lb) nb.set(b, (lb = [])); lb.push(a);
  };
  const lerp = (a: number, b: number) => { const t = (iso - a) / (b - a); return t < 0 ? 0 : t > 1 ? 1 : t; };
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const tl = val(x, y), tr = val(x + 1, y), br = val(x + 1, y + 1), bl = val(x, y + 1);
      const c = (tl >= iso ? 8 : 0) | (tr >= iso ? 4 : 0) | (br >= iso ? 2 : 0) | (bl >= iso ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const T = hid(x, y), R = vid(x + 1, y), B = hid(x, y + 1), L = vid(x, y);
      const need = (id: number, px: number, py: number) => { if (!pos.has(id)) pos.set(id, [px, py]); };
      // edge points (only computed when used)
      const pT = () => need(T, x + lerp(tl, tr), y);
      const pR = () => need(R, x + 1, y + lerp(tr, br));
      const pB = () => need(B, x + lerp(bl, br), y + 1);
      const pL = () => need(L, x, y + lerp(tl, bl));
      const seg = (a: number, b: number) => link(a, b);
      const centre = (tl + tr + br + bl) / 4 >= iso;
      switch (c) {
        case 1: case 14: pL(); pB(); seg(L, B); break;
        case 2: case 13: pB(); pR(); seg(B, R); break;
        case 3: case 12: pL(); pR(); seg(L, R); break;
        case 4: case 11: pT(); pR(); seg(T, R); break;
        case 6: case 9: pT(); pB(); seg(T, B); break;
        case 7: case 8: pL(); pT(); seg(L, T); break;
        case 5: pT(); pR(); pB(); pL(); if (centre) { seg(L, T); seg(B, R); } else { seg(T, R); seg(L, B); } break;
        case 10: pT(); pR(); pB(); pL(); if (centre) { seg(T, R); seg(L, B); } else { seg(L, T); seg(B, R); } break;
      }
    }
  }
  const seen = new Set<number>();
  const loops: Float32Array[] = [];
  for (const start of nb.keys()) {
    if (seen.has(start)) continue;
    const pts: number[] = [];
    let prev = -1, cur = start;
    for (let guard = 0; guard < 1e6; guard++) {
      seen.add(cur);
      const p = pos.get(cur)!; pts.push(p[0], p[1]);
      const n = nb.get(cur)!;
      const next = n[0] === prev ? n[1] : n[0];
      if (next === undefined || seen.has(next)) break;
      prev = cur; cur = next;
    }
    if (pts.length >= 6) loops.push(new Float32Array(pts));
  }
  return loops;
}

/** Chaikin corner cutting on a closed loop, then drop points closer than `minD`. */
function smoothLoop(p: Float32Array, iters = 2, minD = 0.6): Float32Array {
  let a = Array.from(p);
  for (let it = 0; it < iters; it++) {
    const n = a.length / 2, o: number[] = [];
    for (let i = 0; i < n; i++) {
      const x0 = a[i * 2], y0 = a[i * 2 + 1], j = (i + 1) % n, x1 = a[j * 2], y1 = a[j * 2 + 1];
      o.push(x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25, x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75);
    }
    a = o;
  }
  const out: number[] = [a[0], a[1]];
  for (let i = 2; i < a.length; i += 2) {
    const dx = a[i] - out[out.length - 2], dy = a[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= minD * minD) out.push(a[i], a[i + 1]);
  }
  return new Float32Array(out);
}

function loopArea(p: Float32Array) {
  let s = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
  return Math.abs(s) / 2;
}

/** loops (field px) → Path2D in raster px */
export function toPath(loops: Float32Array[], scale: number, offset = 0.5, into = new Path2D()): Path2D {
  for (const l of loops) {
    into.moveTo((l[0] + offset) * scale, (l[1] + offset) * scale);
    for (let i = 2; i < l.length; i += 2) into.lineTo((l[i] + offset) * scale, (l[i + 1] + offset) * scale);
    into.closePath();
  }
  return into;
}

/** deterministic hash noise in [0,1) */
export function hash2(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** smooth value noise in [0,1) */
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ------------------------------------------------------------------ build
/**
 * @param px RGBA from readRenderTargetPixels (bottom-up rows), fw×fh field resolution
 * @param worldW metres across the field (x)
 * @param artMax longest side of the cached raster
 */
export function buildChartArt(px: Uint8Array, fw: number, fh: number, worldW: number, artMax = 2048): ChartArt {
  const N = fw * fh;
  const land = new Uint8Array(N), forest = new Uint8Array(N);
  for (let y = 0; y < fh; y++) {
    const sy = fh - 1 - y; // canvas row 0 = minZ (north)
    for (let x = 0; x < fw; x++) {
      const i = (sy * fw + x) * 4;
      if (px[i + 3] > 20) {
        land[y * fw + x] = 1;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (g > r * 1.02 && g > b * 1.05 && r + g + b < 420) forest[y * fw + x] = 1;
      }
    }
  }
  const fk = fw / worldW; // field px per metre

  // connected components (8-conn): specks → rock marks, not coastline
  const comp = new Int32Array(N).fill(-1);
  const rocks: [number, number][] = [];
  const speck = Math.max(3, Math.round(6 * fk * fk)); // < ~6 m² is a rock/piling, not an island
  const stack: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!land[i] || comp[i] >= 0) continue;
    const members: number[] = [];
    stack.push(i); comp[i] = i;
    while (stack.length) {
      const c = stack.pop()!; members.push(c);
      const cx = c % fw, cy = (c / fw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= fw || ny >= fh) continue;
        const n = ny * fw + nx;
        if (land[n] && comp[n] < 0) { comp[n] = i; stack.push(n); }
      }
    }
    if (members.length < speck) {
      let sx = 0, sy = 0;
      for (const m of members) { land[m] = 0; forest[m] = 0; sx += m % fw; sy += (m / fw) | 0; }
      // keep only one mark per ~8 m so pilings/buoys don't spray symbols
      const rx = sx / members.length, ry = sy / members.length;
      if (!rocks.some(([ax, ay]) => Math.hypot(ax - rx, ay - ry) < 8 * fk)) rocks.push([rx, ry]);
    }
  }

  // distance fields (px): water→land and land→water
  const water = new Uint8Array(N);
  for (let i = 0; i < N; i++) water[i] = land[i] ? 0 : 1;
  const dOut = edt(land, fw, fh);
  const dIn = edt(water, fw, fh);
  // per island: area and its most inland pixel (label anchor, like engraved names set across the land)
  const isl = new Map<number, { area: number; best: number; d: number }>();
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue;
    const c = comp[i];
    let e = isl.get(c);
    if (!e) isl.set(c, (e = { area: 0, best: i, d: -1 }));
    e.area++;
    if (dIn[i] > e.d) { e.d = dIn[i]; e.best = i; }
  }

  // coastline: blurred mask iso 0.5
  const lf = new Float32Array(N);
  for (let i = 0; i < N; i++) lf[i] = land[i];
  const smooth = boxBlur(lf, fw, fh, 1);
  const coastLoops = contours(smooth, fw, fh, 0.5).map((l) => smoothLoop(l, 2, 0.5)).filter((l) => loopArea(l) > 1.5);

  // ripple lines at fixed sea distances (metres) — real chart offsets merge between near islands
  const RIP_M = [3.2, 7, 12];
  const ripples = RIP_M.map((m) => contours(dOut, fw, fh, m * fk).map((l) => smoothLoop(l, 2, 0.8)).filter((l) => loopArea(l) > 4));

  // soundings: jittered grid in open water, value grows with distance from land (fathoms-ish, invented)
  const soundings: { x: number; y: number; v: number }[] = [];
  const sp = 38 * fk;
  for (let gy = sp / 2; gy < fh; gy += sp) for (let gx = sp / 2; gx < fw; gx += sp) {
    const jx = gx + (hash2(gx | 0, gy | 0) - 0.5) * sp * 0.7, jy = gy + (hash2(gy | 0, gx | 0) - 0.5) * sp * 0.7;
    const xi = Math.round(jx), yi = Math.round(jy);
    if (xi < 0 || yi < 0 || xi >= fw || yi >= fh) continue;
    const dm = dOut[yi * fw + xi] / fk;
    if (dm < 14) continue;
    const v = Math.round(Math.min(34 + hash2(yi, xi) * 14, 3 + dm * 0.16 + hash2(xi, yi) * 7));
    soundings.push({ x: jx, y: jy, v });
  }

  // ---------------------------------------------------------------- raster (soft layers only)
  const s = artMax / Math.max(fw, fh);
  const W = Math.round(fw * s), H = Math.round(fh * s);
  const k = W / worldW;
  // field-res washes drawn into an ImageData, then scaled up smoothly
  const wash = document.createElement('canvas');
  wash.width = fw; wash.height = fh;
  const wc = wash.getContext('2d')!;
  const img = wc.createImageData(fw, fh);
  const d = img.data;
  const shoal = 12 * fk, band = 9 * fk;
  for (let i = 0; i < N; i++) {
    let r = 0xF4, g = 0xEF, b = 0xE3, a = 255;
    if (land[i]) {
      // land: warm parchment, green watercolour band inside the coast fading inland
      const t = Math.min(1, dIn[i] / band);
      const gA = 0.62 * (1 - t) * (1 - t) + (forest[i] ? 0.18 : 0);
      r = 0xEA; g = 0xDF; b = 0xBF;
      r += (0x9C - r) * gA; g += (0xB2 - g) * gA; b += (0x78 - b) * gA;
    } else {
      // shoal tint hugging the shore (pale teal), gone by the outer ripple
      const t = Math.min(1, dOut[i] / shoal);
      const wA = 0.30 * (1 - t) * (1 - t);
      r += (0x8F - r) * wA; g += (0xB8 - g) * wA; b += (0xB5 - b) * wA;
    }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a;
  }
  wc.putImageData(img, 0, 0);

  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const bc = base.getContext('2d')!;
  bc.fillStyle = PAPER; bc.fillRect(0, 0, W, H);
  bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high';
  bc.drawImage(wash, 0, 0, W, H);

  // survey grid every 100 m (very faint; the sea shouldn't look like graph paper)
  bc.strokeStyle = 'rgba(46,94,99,.10)'; bc.lineWidth = Math.max(1, s * 0.5);
  bc.beginPath();
  for (let x = 0; x < W; x += 100 * k) { bc.moveTo(x, 0); bc.lineTo(x, H); }
  for (let y = 0; y < H; y += 100 * k) { bc.moveTo(0, y); bc.lineTo(W, y); }
  bc.stroke();

  // shoal stipple: dots inside the first ripple, sparser outward (Coast Survey sand/shoal convention)
  bc.fillStyle = 'rgba(46,94,99,.55)';
  const step = 2.2 * fk; // ~1 dot per 2.2 m cell
  const dotR = Math.max(0.7, 0.32 * k);
  for (let gy = 0; gy < fh; gy += step) for (let gx = 0; gx < fw; gx += step) {
    const jx = gx + hash2(gx * 7 | 0, gy * 3 | 0) * step, jy = gy + hash2(gy * 5 | 0, gx * 11 | 0) * step;
    const xi = jx | 0, yi = jy | 0;
    if (xi >= fw || yi >= fh) continue;
    const i = yi * fw + xi;
    if (land[i]) continue;
    const dm = dOut[i] / fk;
    if (dm > RIP_M[0] + 0.5) continue;
    if (hash2(xi * 13, yi * 17) > 0.85 - dm * 0.15) continue;
    bc.beginPath(); bc.arc(jx * s, jy * s, dotR, 0, Math.PI * 2); bc.fill();
  }

  // conifer marks on forest (Admiralty 2689 tree signs): a stem and two short arms
  const tstep = 5.5 * fk;
  bc.strokeStyle = 'rgba(54,80,52,.78)'; bc.lineWidth = Math.max(1, 0.38 * k); bc.lineCap = 'round';
  const th = 2.6 * k; // tree height px
  bc.beginPath();
  for (let gy = 0; gy < fh; gy += tstep) for (let gx = 0; gx < fw; gx += tstep) {
    const jx = gx + (hash2(gx | 0, gy * 3 | 0) - 0.5) * tstep * 0.8, jy = gy + (hash2(gy * 7 | 0, gx | 0) - 0.5) * tstep * 0.8;
    const xi = Math.round(jx), yi = Math.round(jy);
    if (xi < 0 || yi < 0 || xi >= fw || yi >= fh) continue;
    const i = yi * fw + xi;
    if (!forest[i] || dIn[i] < 1.6 * fk) continue;
    const X = jx * s, Y = jy * s, hh = th * (0.8 + hash2(xi, yi) * 0.4);
    bc.moveTo(X, Y); bc.lineTo(X, Y - hh);
    bc.moveTo(X - hh * 0.38, Y - hh * 0.32); bc.lineTo(X, Y - hh); bc.lineTo(X + hh * 0.38, Y - hh * 0.32);
  }
  bc.stroke();

  const coast = toPath(coastLoops, s);
  const rip = ripples.map((ls) => toPath(ls, s));
  return {
    W, H, k, base, coast, ripples: rip,
    rocks: rocks.map(([x, y]) => [(x + 0.5) * s, (y + 0.5) * s]),
    soundings: soundings.map((q) => ({ x: (q.x + 0.5) * s, y: (q.y + 0.5) * s, v: q.v })),
    islandAnchor: (x: number, y: number, r: number) => {
      const fx = x / s, fy = y / s, fr = r / s;
      // the island under (or nearest to) the point — not the biggest one nearby, which may be a neighbour
      let best: { area: number; best: number } | null = null, bd = Infinity;
      const st = Math.max(1, fr / 32);
      for (let dy = -fr; dy <= fr; dy += st) for (let dx = -fr; dx <= fr; dx += st) {
        const dd = dx * dx + dy * dy;
        if (dd > fr * fr || dd >= bd) continue;
        const xi = Math.round(fx + dx), yi = Math.round(fy + dy);
        if (xi < 0 || yi < 0 || xi >= fw || yi >= fh || !land[yi * fw + xi]) continue;
        const e = isl.get(comp[yi * fw + xi]);
        if (e) { best = e; bd = dd; }
      }
      return best ? [((best.best % fw) + 0.5) * s, (((best.best / fw) | 0) + 0.5) * s] : null;
    },
    isLand: (x: number, y: number) => {
      const xi = Math.floor(x / s), yi = Math.floor(y / s);
      return xi >= 0 && yi >= 0 && xi < fw && yi < fh && !!land[yi * fw + xi];
    },
  };
}

// ------------------------------------------------------------------ fog of war
/**
 * The revealed area as a crisp, slightly ragged closed path (raster px). The 128² sight mask is upsampled,
 * softened, perturbed with value noise and contoured — a pencilled survey limit instead of a blur.
 */
export function fogPath(mask: Uint8Array, M: number, W: number, H: number, R = 384): Path2D {
  const f = new Float32Array(R * R);
  const sc = M / R;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    // bilinear sample of the mask at this fog cell's centre
    const mx = (x + 0.5) * sc - 0.5, my = (y + 0.5) * sc - 0.5;
    const x0 = Math.max(0, Math.floor(mx)), y0 = Math.max(0, Math.floor(my));
    const x1 = Math.min(M - 1, x0 + 1), y1 = Math.min(M - 1, y0 + 1);
    const tx = Math.min(1, Math.max(0, mx - x0)), ty = Math.min(1, Math.max(0, my - y0));
    const a = mask[y0 * M + x0], b = mask[y0 * M + x1], c = mask[y1 * M + x0], d = mask[y1 * M + x1];
    f[y * R + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
  const b = boxBlur(f, R, R, 2);
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    const n = (vnoise(x / 14, y / 14) - 0.5) * 0.34 + (vnoise(x / 4.5 + 31, y / 4.5 + 17) - 0.5) * 0.14;
    b[y * R + x] += n;
  }
  const loops = contours(b, R, R, 0.5).map((l) => smoothLoop(l, 1, 0.5));
  const p = new Path2D();
  const sx = W / R, sy = H / R;
  for (const l of loops) {
    p.moveTo((l[0] + 0.5) * sx, (l[1] + 0.5) * sy);
    for (let i = 2; i < l.length; i += 2) p.lineTo((l[i] + 0.5) * sx, (l[i + 1] + 0.5) * sy);
    p.closePath();
  }
  return p;
}
