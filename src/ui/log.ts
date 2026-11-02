/**
 * The Log (ui_design §4.6 + ui_layouts_indie §3.7): the one diegetic hub. Opening it pauses the
 * game. Portrait: one page, ribbon tabs at the BOTTOM (thumb reach), details slide over.
 * Landscape / desktop: two-page spread (list left, detail right), ribbons on the right edge.
 * Tabs: Errands · Fish · Map · Pages · Settings.
 */
import { $, ctx, esc, h, setModal, reduceMotion } from './ctx';
import { fx, canVibrate } from './fx';
import { ICONS, hydrateIcons } from './icons';
import { fishSketch, fishSilhouette, starsSvg } from './fishart';
import { prefs, savePrefs, log, saveLog, resetUIProgress, debugMode, type Units } from './prefs';
import { chart, type Place } from './chart';
import { ERRANDS, stamps } from './errands';
import { pinChip } from './chip';
import { SPECIES, type Species } from '../game/fishdata';

export type Tab = 'errands' | 'fish' | 'map' | 'pages' | 'settings';
type Filter = 'all' | 'caught' | 'missing' | 'here' | 'cooler';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'errands', label: 'Errands', icon: 'pencil' },
  { id: 'fish', label: 'Fish', icon: 'fish' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'pages', label: 'Pages', icon: 'page' },
  { id: 'settings', label: 'Settings', icon: 'wheel' },
];

let root: HTMLElement;
let tab: Tab = 'errands';
let filter: Filter = 'all';
let selFish: string | null = null;
let selPage = 0;
let applyPrefsCb: () => void = () => {};

export function setApplyPrefs(f: () => void) { applyPrefsCb = f; }

// ------------------------------------------------------------------ build / open / close
export function buildLog() {
  root = h('div', 'logbook hidden');
  root.id = 'logbook';
  root.innerHTML = `
  <div class="book" role="dialog" aria-modal="true" aria-label="Logbook">
    <header class="book-head">
      <button class="close-btn" id="log-close" aria-label="Close the Log"><span class="ico">${ICONS.back}</span><span>Close</span></button>
      <h2>Logbook</h2>
      <div class="head-info" id="log-head-info"></div>
    </header>
    <div class="spread">
      <section class="page page-l" id="log-l"></section>
      <section class="page page-r" id="log-r"><button class="back-btn" id="log-back"><span class="ico">${ICONS.back}</span>Back</button><div id="log-r-body"></div></section>
    </div>
    <nav class="ribbons" role="tablist">${TABS.map((t) => `<button role="tab" class="ribbon" data-tab="${t.id}" aria-label="${t.label}"><span class="ico">${ICONS[t.icon]}</span><span class="rl">${t.label}</span></button>`).join('')}</nav>
  </div>`;
  document.body.appendChild(root);
  $('log-close').onclick = () => closeLog();
  $('log-back').onclick = () => root.classList.remove('detail-open');
  root.querySelectorAll<HTMLButtonElement>('.ribbon').forEach((b) => (b.onclick = () => { if (tab !== b.dataset.tab) fx('page'); show(b.dataset.tab as Tab); }));
  // swipe-down on the header closes in portrait
  let y0 = -1;
  const head = root.querySelector<HTMLElement>('.book-head')!;
  head.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
  head.addEventListener('pointerup', (e) => { if (y0 >= 0 && e.clientY - y0 > 70 && ctx.layout === 'portrait') closeLog(); y0 = -1; });
}

export function openLog(t?: Tab, opts: { species?: string; filter?: Filter } = {}) {
  if (ctx.modal && ctx.modal !== 'log') return;
  if (opts.filter) filter = opts.filter;
  if (opts.species) selFish = opts.species;
  if (root.classList.contains('hidden')) fx('open');
  root.classList.remove('hidden', 'closing', 'detail-open');
  if (!reduceMotion()) { root.classList.remove('rise'); void root.offsetWidth; root.classList.add('rise'); }
  setModal('log');
  show(t ?? tab);
  if (opts.species && ctx.layout === 'portrait') root.classList.add('detail-open');
}

export function closeLog() {
  if (root.classList.contains('hidden')) return;
  fx('close');
  chart.persist();
  root.classList.add('hidden');
  map?.stop();
  if (ctx.modal === 'log') setModal(null);
}

export function refreshLog() {
  if (root && !root.classList.contains('hidden')) show(tab, true);
}

function show(t: Tab, keepScroll = false) {
  const prevTab = tab;
  tab = t;
  root.dataset.tab = t;
  root.querySelectorAll<HTMLElement>('.ribbon').forEach((b) => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
  const L = $('log-l'), R = $('log-r-body');
  const sl = keepScroll ? L.scrollTop : 0;
  if (prevTab !== t) root.classList.remove('detail-open');
  if (t !== 'map') map?.stop();
  head();
  switch (t) {
    case 'errands': errandsTab(L, R); break;
    case 'fish': fishTab(L, R); break;
    case 'map': mapTab(L, R); break;
    case 'pages': pagesTab(L, R); break;
    case 'settings': settingsTab(L, R); break;
  }
  L.scrollTop = sl;
  hydrateIcons(root);
  if (!keepScroll && !reduceMotion()) { L.classList.remove('flip'); void L.offsetWidth; L.classList.add('flip'); }
}

function head() {
  const tod = ctx.tod;
  const info = TOD_HEAD[tod] ?? { ico: 'cloud', t: '12:00', w: tod };
  $('log-head-info').innerHTML = `<span class="ico">${ICONS[info.ico]}</span><span class="num">${info.t}</span><span class="w">${info.w}</span><span class="sh"><span class="ico">${ICONS.shell}</span><b class="num">${ctx.save?.shells ?? 0}</b></span>`;
}
const TOD_HEAD: Record<string, { ico: string; t: string; w: string }> = {
  overcast: { ico: 'cloud', t: '10:40', w: 'Grey and still' }, sunbreak: { ico: 'sunbreak', t: '13:20', w: 'Sun breaking through' },
  dusk: { ico: 'dusk', t: '19:50', w: 'Dusk' }, fog: { ico: 'fog', t: '06:40', w: 'Fog' }, night: { ico: 'moon', t: '23:10', w: 'Clear night' },
};

const openDetail = () => { if (ctx.layout === 'portrait') root.classList.add('detail-open'); };

// ------------------------------------------------------------------ Errands
function errandsTab(L: HTMLElement, R: HTMLElement) {
  const done = new Set(stamps().map((e) => e.id));
  L.innerHTML = `<h3 class="page-title">Today's errands</h3>
  <ul class="errands">${ERRANDS.map((e) => `<li class="${done.has(e.id) ? 'done' : ''}">
      <span class="box" aria-hidden="true">${done.has(e.id) ? ICONS.check : ''}</span>
      <span class="txt"><span>${esc(e.text)}</span></span>
      ${done.has(e.id) ? '' : `<button class="pin${log.pinned === e.id ? ' on' : ''}" data-pin="${e.id}" aria-label="${log.pinned === e.id ? 'Unpin' : 'Pin'} errand">${log.pinned === e.id ? 'Pinned' : 'Pin'}</button>`}
    </li>`).join('')}</ul>
  <p class="hand small">Pin one and it rides along under your Shells.</p>`;
  L.querySelectorAll<HTMLButtonElement>('[data-pin]').forEach((b) => (b.onclick = () => {
    log.pinned = log.pinned === b.dataset.pin ? null : b.dataset.pin!;
    saveLog();
    pinChip(log.pinned ? ERRANDS.find((e) => e.id === log.pinned)!.text : null);
    show('errands', true);
  }));
  const st = stamps();
  R.innerHTML = `<h3 class="page-title">Wallet & weather</h3>
  <div class="wallet"><span class="ico big">${ICONS.shell}</span><b class="num">${ctx.save?.shells ?? 0}</b><span>Shells</span></div>
  <h4>Cover stamps <span class="num">${st.length} / ${ERRANDS.length}</span></h4>
  <div class="cover-stamps">${ERRANDS.map((e) => done.has(e.id) ? `<span class="cstamp">${e.stamp}</span>` : '<span class="cstamp empty"></span>').join('')}</div>
  <h4>Tide table</h4>
  <table class="tide num"><tr><td>${ICONS.tide}</td><td>High</td><td>05:12</td><td>3.1 m</td></tr><tr><td></td><td>Low</td><td>11:40</td><td>0.6 m</td></tr><tr><td>${ICONS.tide}</td><td>High</td><td>17:55</td><td>2.8 m</td></tr><tr><td></td><td>Low</td><td>23:58</td><td>1.2 m</td></tr></table>
  <p class="hand">${esc(weatherNote())}</p>`;
}
function weatherNote() {
  switch (ctx.tod) {
    case 'fog': return 'Fog this morning. Keep the shore on your left and listen for the bell.';
    case 'night': return 'Calm night. The rockfish come up to look at the moon.';
    case 'dusk': return 'Dusk. Lingcod get bold at the rip off Hook Point.';
    case 'sunbreak': return 'Sun through the cloud. Perch will be up in the shallows.';
    default: return 'Grey and still. Good fishing weather, Gran always said.';
  }
}

// ------------------------------------------------------------------ Fish
const BIOME: Record<string, string> = {
  shallow_shelf: 'on the shallow shelf', seagrass: 'in the seagrass', reef_edge: 'by the reef edge', kelp_edge: 'near kelp',
  spires: 'round the spires', current_channel: 'in the current', sand_flats: 'over sand flats', wreck: 'by the wreck',
  trench: 'deep in the trench', lagoon: 'in the lagoon', fog_bank: 'in the fog bank', drop_off: 'at the drop-off',
};
const WHEN: Record<string, string> = { dawn: 'at dawn', dusk: 'at dusk', night: 'after dark', day: 'by day', any: '' };

function habitat(sp: Species) {
  const hs = (ctx.world?.gameplay.hotspots ?? []).filter((h) => h.fish_pool.some((p) => p.toLowerCase().replace(/\(.*\)/, '').trim() === sp.name.toLowerCase() || p.toLowerCase().includes(sp.name.toLowerCase())));
  if (!hs.length) return sp.rarity === 'legendary' ? 'only in old stories' : 'somewhere further out';
  const count = (k: (x: typeof hs[0]) => string | undefined) => { const m = new Map<string, number>(); hs.forEach((x) => { const v = k(x); if (v) m.set(v, (m.get(v) ?? 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const b = count((x) => x.biome), t = count((x) => x.time_of_day);
  return [b ? BIOME[b] ?? b.replace(/_/g, ' ') : '', t ? WHEN[t] ?? '' : ''].filter(Boolean).join(', ');
}

function hereNow(sp: Species) {
  return (ctx.world?.gameplay.hotspots ?? []).some((h) => Math.hypot(h.pos[0] - ctx.boat.x, h.pos[2] - ctx.boat.z) < 250 && h.fish_pool.some((p) => p.toLowerCase().includes(sp.name.toLowerCase())));
}

function fishTab(L: HTMLElement, R: HTMLElement) {
  const recs = ctx.save?.records ?? {};
  const inCooler = new Set((ctx.save?.cooler ?? []).map((f) => f.speciesId));
  const all = SPECIES;
  const caught = all.filter((s) => recs[s.id]).length;
  const list = all.filter((s) => filter === 'all' || (filter === 'caught' ? !!recs[s.id] : filter === 'missing' ? !recs[s.id] : filter === 'cooler' ? inCooler.has(s.id) : hereNow(s)));
  const FL: [Filter, string][] = [['all', 'All'], ['caught', 'Caught'], ['missing', 'Missing'], ['here', 'Here now'], ['cooler', 'In cooler']];
  L.innerHTML = `<div class="page-title row"><h3>Fish</h3><span class="count num">${caught} / ${all.length}</span></div>
    <div class="filters" role="radiogroup">${FL.map(([k, l]) => `<button class="fchip${filter === k ? ' on' : ''}" data-f="${k}" role="radio" aria-checked="${filter === k}">${l}</button>`).join('')}</div>
    <div class="fish-grid">${list.map((s) => {
      const r = recs[s.id];
      return `<button class="entry${r ? ' caught' : ''}${selFish === s.id ? ' sel' : ''}" data-sp="${s.id}" aria-label="${r ? s.name : 'Unknown fish'}">
        <span class="art">${r ? fishSketch(s.id, s.color, s.rarity) : fishSilhouette(s.id)}</span>
        ${r ? `<span class="nm">${esc(s.name)}</span>` : `<span class="q">?</span><span class="hab">${esc(habitat(s))}</span>`}
        ${r && log.perfect[s.id] ? '<span class="tick" aria-label="perfect reel">✓</span>' : ''}
      </button>`;
    }).join('') || '<p class="hand">Nothing here yet.</p>'}</div>`;
  L.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f as Filter; show('fish', true); }));
  L.querySelectorAll<HTMLButtonElement>('[data-sp]').forEach((b) => (b.onclick = () => { selFish = b.dataset.sp!; fx('page'); show('fish', true); openDetail(); }));
  const sp = all.find((s) => s.id === selFish) ?? all.find((s) => recs[s.id]) ?? all[0];
  const r = recs[sp.id];
  const first = log.first[sp.id] ? new Date(log.first[sp.id]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  R.innerHTML = r ? `<div class="fish-detail">
      <div class="big-art">${fishSketch(sp.id, sp.color, sp.rarity)}</div>
      <h3 class="fname">${esc(sp.name)}</h3>
      <p class="rar">${sp.rarity}${sp.releaseOnly ? ' · catch & release' : ''}</p>
      <dl class="stats num"><dt>Best size</dt><dd>${r.size.toFixed(1)} cm</dd><dt>Best</dt><dd>${starsSvg(r.stars, 3, 18)}</dd><dt>Caught</dt><dd>${r.count}×</dd>${first ? `<dt>First</dt><dd>${first}</dd>` : ''}<dt>Perfect reel</dt><dd>${log.perfect[sp.id] ? '✓' : '—'}</dd></dl>
      <p class="note">“${esc(sp.flavor)}” — G.</p>
      <p class="hand">Found ${esc(habitat(sp))}.</p>
      <div class="variants"><span class="var">albino</span><span class="var">golden</span></div>
    </div>` : `<div class="fish-detail unknown">
      <div class="big-art">${fishSilhouette(sp.id)}</div>
      <h3 class="fname">???</h3>
      <p class="hand">Gran's note: “Try ${esc(habitat(sp))}.”</p>
    </div>`;
}

// ------------------------------------------------------------------ Map
let map: MapView | null = null;
function mapTab(L: HTMLElement, R: HTMLElement) {
  L.innerHTML = `<div class="chart-wrap"><canvas id="chart-canvas" aria-label="Chart of the islands"></canvas>
    <div class="map-ctl"><button data-z="1.4" aria-label="Zoom in">+</button><button data-z="0.7" aria-label="Zoom out">−</button><button data-c aria-label="Centre on the canoe">${ICONS.boat}</button></div>
    <p class="map-note hand" id="map-note"></p></div>`;
  const visited = chart.places.filter((p) => log.places.includes(p.key));
  R.innerHTML = `<h3 class="page-title">Places</h3>
    <p class="hand small">Tap a place to set the compass.</p>
    <ul class="places">${visited.map((p) => `<li><button data-place="${p.key}" class="${log.dest === p.key ? 'on' : ''}"><span class="ico">${ICONS[p.kind === 'stone' ? 'stone' : p.kind === 'island' ? 'land' : 'compass']}</span>${esc(p.name)}</button></li>`).join('') || '<li class="hand">Nowhere yet. Paddle out and look about.</li>'}</ul>`;
  R.querySelectorAll<HTMLButtonElement>('[data-place]').forEach((b) => (b.onclick = () => setDest(b.dataset.place!)));
  if (!map) map = new MapView();
  map.attach($('chart-canvas') as HTMLCanvasElement, L.querySelector('.map-ctl')!);
}

function setDest(key: string) {
  chart.setDestination(log.dest === key ? null : key);
  fx('reveal');
  const p = chart.places.find((q) => q.key === key);
  show('map', true); // re-renders the page, so write the note after
  $('map-note') && ($('map-note').textContent = log.dest && p ? `Compass set for ${p.name}` : 'Compass cleared');
}

class MapView {
  private cv!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private s = 1.2; // px per metre
  private cx = 0; private cz = 0;
  private pts = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private raf = 0;
  private washT = 1;
  private centred = false;

  attach(cv: HTMLCanvasElement, ctl: HTMLElement) {
    this.cv = cv;
    this.g = cv.getContext('2d')!;
    if (!this.centred) { this.cx = ctx.boat.x; this.cz = ctx.boat.z; this.centred = true; }
    const fit = () => {
      const r = cv.parentElement!.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(10, r.width * dpr); cv.height = Math.max(10, r.height * dpr);
      cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`;
      if (!this.sized) { this.s = Math.min(r.width, r.height) / 380; this.sized = true; }
    };
    fit();
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
        if (d0 > 10) this.zoom(d1 / d0);
        this.moved += 99;
      }
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.draw();
    };
    cv.onpointerup = (e) => {
      this.pts.delete(e.pointerId);
      if (this.moved < 6) this.tap(e.clientX, e.clientY);
    };
    cv.onpointercancel = (e) => this.pts.delete(e.pointerId);
    cv.onwheel = (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); this.draw(); };
    ctl.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) => (b.onclick = () => { this.zoom(Number(b.dataset.z)); this.draw(); }));
    ctl.querySelector<HTMLButtonElement>('[data-c]')!.onclick = () => { this.cx = ctx.boat.x; this.cz = ctx.boat.z; this.draw(); };
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
    if (!chart.ensureTexture()) $('map-note').textContent = 'The chart is still being drawn…';
  }
  private sized = false;
  stop() { cancelAnimationFrame(this.raf); }

  private zoom(k: number) { this.s = Math.min(8, Math.max(0.25, this.s * k)); }

  private toScreen(x: number, z: number): [number, number] {
    const dpr = this.cv.width / this.cv.getBoundingClientRect().width || 1;
    return [((x - this.cx) * this.s + this.cv.width / dpr / 2) * dpr, ((z - this.cz) * this.s + this.cv.height / dpr / 2) * dpr];
  }

  private tap(clx: number, cly: number) {
    const r = this.cv.getBoundingClientRect();
    const x = clx - r.left, y = cly - r.top;
    let best: Place | null = null, bd = 34;
    for (const p of chart.places) {
      if (!log.places.includes(p.key)) continue;
      const [sx, sy] = this.toScreen(p.x, p.z).map((v) => v / (this.cv.width / r.width)) as [number, number];
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) setDest(best.key);
  }

  draw() {
    const g = this.g, W = this.cv.width, H = this.cv.height;
    const dpr = W / (this.cv.getBoundingClientRect().width || W);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#F4EFE3'; g.fillRect(0, 0, W, H);
    // faint survey grid every 50 m
    g.strokeStyle = 'rgba(133,126,114,.22)'; g.lineWidth = 1;
    const step = 50;
    const [ox, oz] = this.toScreen(Math.floor(this.cx / step) * step, Math.floor(this.cz / step) * step);
    const sp = step * this.s * dpr;
    g.beginPath();
    for (let x = ox % sp; x < W; x += sp) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = oz % sp; y < H; y += sp) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
    // revealed chart, with the opening ink-wash
    const tex = chart.revealedTexture();
    const b = chart.bounds;
    const [bx0, bz0] = this.toScreen(b.minX, b.minZ);
    const [bx1, bz1] = this.toScreen(b.maxX, b.maxZ);
    const [px, pz] = this.toScreen(ctx.boat.x, ctx.boat.z);
    if (tex) {
      g.save();
      if (this.washT < 1) {
        const e = this.washT < 0.5 ? 4 * this.washT ** 3 : 1 - (-2 * this.washT + 2) ** 3 / 2;
        g.beginPath(); g.arc(px, pz, Math.hypot(W, H) * e, 0, Math.PI * 2); g.clip();
      }
      g.imageSmoothingEnabled = true;
      g.drawImage(tex, bx0, bz0, bx1 - bx0, bz1 - bz0);
      g.restore();
    }
    // fishing marks seen
    g.strokeStyle = '#2E5E63'; g.lineWidth = 1.5 * dpr;
    for (const hs of chart.hotspots) {
      if (!chart.isSeen(hs.x, hs.z)) continue;
      const [x, y] = this.toScreen(hs.x, hs.z);
      for (const rr of [4, 8]) { g.beginPath(); g.arc(x, y, rr * dpr, 0, Math.PI * 2); g.stroke(); }
    }
    // recent path (dashed)
    if (log.path.length >= 4) {
      g.strokeStyle = 'rgba(158,59,42,.75)'; g.lineWidth = 2 * dpr; g.setLineDash([5 * dpr, 5 * dpr]);
      g.beginPath();
      for (let i = 0; i < log.path.length; i += 2) {
        const [x, y] = this.toScreen(log.path[i], log.path[i + 1]);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.lineTo(px, pz);
      g.stroke(); g.setLineDash([]);
    }
    // visited place labels (Caveat), destination ring
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (const p of chart.places) {
      if (!log.places.includes(p.key)) continue;
      const [x, y] = this.toScreen(p.x, p.z);
      if (x < -200 || y < -50 || x > W + 200 || y > H + 50) continue;
      const dest = log.dest === p.key;
      // zoomed out: towns, islands and stones only (POIs label once you zoom in)
      const showLabel = dest || p.kind !== 'poi' || this.s >= 1.6;
      g.fillStyle = dest ? '#9E3B2A' : '#2B2622';
      g.beginPath(); g.arc(x, y, (dest ? 6 : 3.5) * dpr, 0, Math.PI * 2); g.fill();
      if (dest) { g.strokeStyle = '#9E3B2A'; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(x, y, 12 * dpr, 0, Math.PI * 2); g.stroke(); }
      g.font = `${p.kind === 'town' ? 700 : 600} ${(p.kind === 'town' ? 22 : 18) * dpr * prefs.textScale}px "Caveat Hand", cursive`;
      if (!showLabel) continue;
      g.lineWidth = 4 * dpr; g.strokeStyle = 'rgba(244,239,227,.9)';
      g.strokeText(p.name, x, y - 6 * dpr);
      g.fillText(p.name, x, y - 6 * dpr);
    }
    // canoe glyph
    g.save();
    g.translate(px, pz); g.rotate(-ctx.boat.yaw); g.scale(dpr, dpr);
    g.fillStyle = '#B5643C'; g.strokeStyle = '#2B2622'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.quadraticCurveTo(6, -2, 0, 11); g.quadraticCurveTo(-6, -2, 0, -11); g.fill(); g.stroke();
    g.restore();
    // compass rose ornament (abstract trigons; TEMP_COMMISSION)
    g.save(); g.translate(W - 34 * dpr, 40 * dpr); g.scale(dpr, dpr);
    g.fillStyle = '#9E3B2A'; g.strokeStyle = '#2B2622'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -18); g.lineTo(6, 0); g.lineTo(-6, 0); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#F4EFE3'; g.beginPath(); g.moveTo(0, 18); g.lineTo(6, 0); g.lineTo(-6, 0); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#2B2622'; g.font = '700 13px "Nunito UI", sans-serif'; g.textAlign = 'center'; g.fillText('N', 0, -20);
    g.restore();
  }
}

// ------------------------------------------------------------------ Pages
const PAGE_TEXT: Record<number, { title: string; body: string }> = {
  1: { title: "Hermit's Key", body: 'The stone at Hermit\'s Key warms before anything else on the island. Sit with it a while. Then follow the sunstones south.' },
  2: { title: 'Gull Arch', body: 'Gulls tell you where the herring are. When they all face one way, paddle the other — that is where the big ones wait.' },
  3: { title: 'Pine Kelp', body: 'Kelp greenling dress for the forest. Drop the line on the light side of the kelp, never in the dark.' },
  4: { title: 'Gannet Spires', body: 'Rockfish live long and slow. Let the small ones go home; they will be here for your grandchildren.' },
  5: { title: 'Salvage Barge', body: 'The old barge holds more than rust. Lingcod guard it like a house.' },
  6: { title: 'Turtle Crescent', body: 'At low tide the crescent shows its teeth. Go round, not through.' },
  7: { title: 'Marigold Deep', body: 'Something very old lives below the Marigold. I have only ever seen its shadow.' },
};
const TOTAL_PAGES = 7;

function pagesTab(L: HTMLElement, R: HTMLElement) {
  const found = new Set(log.pages);
  L.innerHTML = `<h3 class="page-title">Gran's pages</h3>
    <ul class="page-list">
      <li><button data-pg="0" class="${selPage === 0 ? 'on' : ''}"><span class="ico">${ICONS.log}</span>Inside cover</button></li>
      ${Array.from({ length: TOTAL_PAGES }, (_, i) => i + 1).map((n) => `<li><button data-pg="${n}" class="${found.has(n) ? '' : 'torn'}${selPage === n ? ' on' : ''}"><span class="ico">${ICONS[found.has(n) ? 'page' : 'stone']}</span>${found.has(n) ? `Page ${n} · ${esc(PAGE_TEXT[n].title)}` : `Page ${n} · not found`}</button></li>`).join('')}
    </ul>
    <p class="hand small">${found.size} of ${TOTAL_PAGES} found. Each sunstone keeps one.</p>`;
  L.querySelectorAll<HTMLButtonElement>('[data-pg]').forEach((b) => (b.onclick = () => { selPage = Number(b.dataset.pg); fx('page'); show('pages', true); openDetail(); }));
  if (selPage === 0) {
    R.innerHTML = `<article class="gran-page">
      <h3>If you've found this, you've found my canoe.</h3>
      <p>Put your thumb down on the left and paddle. Look for the water wrinkling in rings — that's fish.</p>
      <p>Stop by the rings and cast. Wait for the bob, then <u>strike</u> quick.</p>
      <p>Hold to reel. When the ring goes stripy, <u>ease off</u> — let it tire. If you stay under my notch, that's a perfect reel.</p>
      <p>The cooler holds two. Mae at Cedar Landing pays fair.</p>
      <p class="sig">— G.</p></article>`;
  } else if (found.has(selPage)) {
    const stone = chart.places.find((p) => p.kind === 'stone' && p.name.toLowerCase().startsWith(PAGE_TEXT[selPage].title.toLowerCase().replace(/'/g, '').split(' ')[0]));
    const crop = stone ? chart.cropAround(stone.x, stone.z) : null;
    R.innerHTML = `<article class="gran-page" data-temp-commission="page-tale">
      <h3>Page ${selPage} · ${esc(PAGE_TEXT[selPage].title)}</h3>
      ${crop ? `<img class="map-piece" src="${crop}" alt="Torn map piece">` : ''}
      <p>${esc(PAGE_TEXT[selPage].body)}</p>
      <p class="sig">— G.</p></article>`;
  } else {
    R.innerHTML = `<article class="gran-page torn"><h3>Page ${selPage}</h3><p class="hand">Torn out. A sunstone somewhere keeps it.</p></article>`;
  }
}

// ------------------------------------------------------------------ Settings
function toggle(id: string, on: boolean, label: string) {
  return `<div class="set-row"><span>${label}</span><button class="switch${on ? ' on' : ''}" id="${id}" role="switch" aria-checked="${on}"><i></i><b>${on ? 'On' : 'Off'}</b></button></div>`;
}
function seg(id: string, opts: [string, string][], cur: string, label: string) {
  return `<div class="set-row"><span>${label}</span><div class="seg" id="${id}" role="radiogroup">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}" role="radio" aria-checked="${v === cur}">${l}</button>`).join('')}</div></div>`;
}

const VOL: [string, string][] = [['0', 'Off'], ['0.35', 'Low'], ['0.7', 'Mid'], ['1', 'High']];
/** nearest volume step for a saved level */
const volKey = (v: number) => VOL.reduce((b, x) => (Math.abs(Number(x[0]) - v) < Math.abs(Number(b[0]) - v) ? x : b))[0];

function settingsTab(L: HTMLElement, R: HTMLElement) {
  const s = ctx.save!.settings;
  L.innerHTML = `<h3 class="page-title">Settings</h3>
  <div class="settings">
    ${seg('set-text', [['1', '100%'], ['1.15', '115%'], ['1.3', '130%']], String(prefs.textScale), 'Text size')}
    ${toggle('set-motion', prefs.reduceMotion, 'Reduce motion')}
    ${seg('set-music', VOL, volKey(s.music), 'Music')}
    ${seg('set-sound', VOL, volKey(s.sound), 'Sound')}
    ${canVibrate ? toggle('set-vibe', prefs.vibration, 'Vibration') : ''}
    ${seg('set-tension', [['def', 'Default'], ['hc', 'High contrast']], prefs.tensionHC ? 'hc' : 'def', 'Tension colours')}
    ${toggle('set-autoreel', s.autoReel, 'Auto-reel')}
    ${seg('set-units', [['words', 'Words'], ['fathoms', 'Fathoms'], ['metres', 'Metres']], prefs.units, 'Distance')}
    ${seg('set-quality', [['high', 'High'], ['low', 'Low']], s.quality, 'Graphics')}
    ${document.fullscreenEnabled ? toggle('set-fs', !!document.fullscreenElement, 'Full screen') : ''}
    ${toggle('set-lefty', prefs.leftHanded, 'Left-handed')}
    <div class="set-row"><span>Reset progress</span><button class="btn ghost danger" id="set-reset">Reset…</button></div>
  </div>`;
  R.innerHTML = `<h3 class="page-title">About this logbook</h3>
    <p class="hand">Kept by Gran, found by you.</p>
    <p class="small">Type: Fraunces, Nunito and Caveat (SIL Open Font Licence). Ornaments are placeholders awaiting a commissioned artist.</p>
    ${debugMode ? `<h4>Debug</h4><div class="settings">
      <div class="set-row"><span>Time of day</span><button class="btn ghost" id="set-tod">${ctx.tod}</button></div>
      ${toggle('set-fps', s.showFps, 'Show FPS')}
      <div class="set-row"><span>World data</span><span class="small">${esc(ctx.worldInfo)}</span></div></div>` : ''}`;

  const sw = (id: string, f: () => void) => { const b = document.getElementById(id); if (b) b.onclick = () => { f(); savePrefs(); applyPrefsCb(); show('settings', true); }; };
  const sg = (id: string, f: (v: string) => void) => document.getElementById(id)?.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { f(b.dataset.v!); savePrefs(); applyPrefsCb(); show('settings', true); }));
  sg('set-text', (v) => { prefs.textScale = Number(v) as 1 | 1.15 | 1.3; });
  sw('set-motion', () => { prefs.reduceMotion = !prefs.reduceMotion; });
  sg('set-music', (v) => ctx.h?.volume('music', Number(v)));
  sg('set-sound', (v) => ctx.h?.volume('sound', Number(v)));
  sw('set-vibe', () => { prefs.vibration = !prefs.vibration; });
  sg('set-tension', (v) => { prefs.tensionHC = v === 'hc'; });
  sw('set-autoreel', () => ctx.h?.autoReel());
  sg('set-units', (v) => { prefs.units = v as Units; });
  sg('set-quality', (v) => { if (v !== ctx.save!.settings.quality) ctx.h?.quality(); });
  sw('set-fs', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  });
  sw('set-lefty', () => { prefs.leftHanded = !prefs.leftHanded; });
  sw('set-fps', () => ctx.h?.fps());
  const tod = document.getElementById('set-tod');
  if (tod) tod.onclick = () => { ctx.h?.tod(); show('settings', true); };
  $('set-reset').onclick = () => {
    const b = $('set-reset');
    if (b.dataset.sure) { resetUIProgress(); ctx.h?.reset(); return; }
    b.dataset.sure = '1';
    b.textContent = 'Tap again to wipe';
  };
}
