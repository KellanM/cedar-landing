/**
 * The Log (ui_design §4.6 + ui_layouts_indie §3.7): the one diegetic hub. Opening it pauses the
 * game. Portrait: one page, ribbon tabs at the BOTTOM (thumb reach), details slide over.
 * Landscape / desktop: two-page spread (list left, detail right), ribbons on the right edge.
 * Tabs: Errands · Fish · Map · Pages · Settings.
 */
import { $, ctx, esc, h, setModal, reduceMotion, type DevWeather, type DevMist, type DevTide } from './ctx';
import { fx, canVibrate } from './fx';
import { ICONS, hydrateIcons } from './icons';
import { fishSketch, fishSilhouette, starsSvg } from './fishart';
import { prefs, savePrefs, log, saveLog, resetUIProgress, type Units } from './prefs';
import { chart } from './chart';
import { mapView, mapItems, chartDebug, type MapItem } from './mapview';
import { glyphSvg, type Glyph } from './mapglyphs';
import { ERRANDS, stamps } from './errands';
import { pinChip } from './chip';
import { SPECIES, type Species } from '../game/fishdata';
import { tideTableHtml, shoreNotesHtml, critterPlate } from './tidelog';

export type Tab = 'errands' | 'fish' | 'map' | 'pages' | 'settings' | 'dev';
type Filter = 'all' | 'caught' | 'missing' | 'here' | 'cooler';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'errands', label: 'Errands', icon: 'pencil' },
  { id: 'fish', label: 'Fish', icon: 'fish' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'pages', label: 'Pages', icon: 'page' },
  { id: 'settings', label: 'Settings', icon: 'wheel' },
  // temporary: weather / tide / clock / rendering controls while the game is in development
  { id: 'dev', label: 'Dev', icon: 'compass' },
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

chart.onArt = () => refreshLog();

export function closeLog() {
  if (root.classList.contains('hidden')) return;
  fx('close');
  chart.persist();
  root.classList.add('hidden');
  map.stop();
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
  if (t !== 'map') { map.stop(); root.classList.remove('places-open'); }
  head();
  switch (t) {
    case 'errands': errandsTab(L, R); break;
    case 'fish': fishTab(L, R); break;
    case 'map': mapTab(L, R); break;
    case 'pages': pagesTab(L, R); break;
    case 'settings': settingsTab(L, R); break;
    case 'dev': devTab(L, R); break;
  }
  L.scrollTop = sl;
  hydrateIcons(root);
  if (!keepScroll && !reduceMotion()) { L.classList.remove('flip'); void L.offsetWidth; L.classList.add('flip'); }
}

function head() {
  const tod = ctx.tod;
  const base = TOD_HEAD[tod] ?? { ico: 'cloud', t: '12:00', w: tod };
  const info = { ...base, t: ctx.clock || base.t };
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
  ${tideTableHtml()}
  <p class="hand">${esc(weatherNote())}</p>`;
}
function weatherNote() {
  const night = ctx.tod === 'night';
  switch (ctx.weather) {
    case 'storm': return ctx.weatherTrend < 0
      ? 'The storm is moving off. Count the seconds after the flash: further each time.'
      : 'Thunder about. The rough outer grounds come alive in a blow, if your boat can take a chop. The Little Troller stays inside.';
    case 'rain': return ctx.weatherTrend < 0 ? 'Rain easing off. The fish will rise once it stops dimpling the water.' : night ? 'Rain on the roof all night. Good for sleeping, better for fishing at first light.' : "Steady rain. Oilskins on. The fish don't mind getting wet.";
    case 'drizzle': return ctx.weatherTrend > 0 ? 'Rain setting in. Gran always fished the first hour of it.' : 'Drizzle. Hardly counts as rain round here.';
  }
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

const FILTERS: [Filter, string][] = [['all', 'All'], ['caught', 'Caught'], ['missing', 'Missing'], ['here', 'Here now'], ['cooler', 'Cooler']];
function filterChips() {
  return `<div class="filters" role="radiogroup">${FILTERS.map(([k, l]) => `<button class="fchip${filter === k ? ' on' : ''}" data-f="${k}" role="radio" aria-checked="${filter === k}">${l}${k === 'cooler' ? ` <span class="num">${ctx.save?.cooler.length ?? 0}/${ctx.save?.coolerCap ?? 0}</span>` : ''}</button>`).join('')}</div>`;
}

/** Fish → Cooler: the inventory (every fish aboard with its size and value; empty slots dashed). */
function coolerView(L: HTMLElement) {
  const cooler = ctx.save?.cooler ?? [], cap = ctx.save?.coolerCap ?? 0;
  const worth = cooler.reduce((a, f) => a + (f.releaseOnly ? 0 : f.price), 0);
  const slots = Array.from({ length: Math.max(cap, cooler.length) }, (_, i) => {
    const f = cooler[i];
    if (!f) return '<div class="cslot empty" aria-label="Empty slot"></div>';
    return `<button class="cslot" data-sp="${f.speciesId}" aria-label="${esc(f.name)}, ${f.size.toFixed(1)} cm">
      <span class="art">${fishSketch(f.speciesId, f.color, f.rarity)}</span>
      <span class="nm">${esc(f.name)}</span>
      <span class="meta"><span class="num">${f.size.toFixed(1)} cm</span>${starsSvg(f.stars, 3, 13)}</span>
      <span class="pr">${f.releaseOnly ? '<i>release only</i>' : `<span class="ico">${ICONS.shell}</span><b class="num">${f.price}</b>`}</span>
    </button>`;
  }).join('');
  L.innerHTML = `<div class="page-title row"><h3>Cooler</h3><span class="count num">${cooler.length} / ${cap}</span></div>
    ${filterChips()}
    <div class="cooler-sum"><span>Worth</span><span class="ico">${ICONS.shell}</span><b class="num">${worth}</b><span class="hand">${cooler.length >= cap && cap ? 'Full! Sell at the Cedar Landing market.' : cooler.length ? 'Sell at the Cedar Landing market.' : 'Empty. Go catch something.'}</span></div>
    <div class="cooler-grid">${slots}</div>`;
  L.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f as Filter; show('fish', true); }));
  L.querySelectorAll<HTMLButtonElement>('[data-sp]').forEach((b) => (b.onclick = () => { selFish = b.dataset.sp!; fx('page'); show('fish', true); openDetail(); }));
}

function fishTab(L: HTMLElement, R: HTMLElement) {
  const recs = ctx.save?.records ?? {};
  const inCooler = new Set((ctx.save?.cooler ?? []).map((f) => f.speciesId));
  const all = SPECIES;
  const caught = all.filter((s) => recs[s.id]).length;
  if (filter === 'cooler') { coolerView(L); }
  else {
  const list = all.filter((s) => filter === 'all' || (filter === 'caught' ? !!recs[s.id] : filter === 'missing' ? !recs[s.id] : filter === 'cooler' ? inCooler.has(s.id) : hereNow(s)));
  L.innerHTML = `<div class="page-title row"><h3>Fish</h3><span class="count num">${caught} / ${all.length}</span></div>
    ${filterChips()}
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
  }
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
// Chart drawing lives in mapview.ts (docs/map_study.md). Portrait: the chart fills the page and Places is a
// pull-up drawer; landscape/desktop: Places is a grouped legend on the right page.
const map = mapView;
let placesOpen = false;
const GROUPS: [string, (g: Glyph) => boolean][] = [
  ['Towns', (g) => g === 'town'],
  ['Islands', (g) => g === 'island'],
  ['Stones & cairns', (g) => g === 'stone' || g === 'cairn'],
  ['Landmarks', (g) => !['town', 'island', 'stone', 'cairn', 'pots'].includes(g)],
];
function mapTab(L: HTMLElement, R: HTMLElement) {
  L.innerHTML = `<div class="chart-wrap"><canvas id="chart-canvas" aria-label="Chart of the islands"></canvas>
    <div class="map-ctl"><button data-z="1.4" aria-label="Zoom in">+</button><button data-z="0.7" aria-label="Zoom out">−</button><button data-c aria-label="Centre on the canoe">${ICONS.boat}</button></div>
    <p class="map-note hand" id="map-note"></p></div>`;
  const items = mapItems();
  const destItem = items.find((i) => i.keys.includes(log.dest ?? ''));
  const row = (it: MapItem, label = it.name) => `<li><button data-place="${it.key}" class="${it === destItem ? 'on' : ''}"><span class="gl">${glyphSvg(it.glyph)}</span><span class="nm">${esc(label)}</span></button></li>`;
  const pots = items.filter((i) => i.glyph === 'pots');
  const sections = GROUPS.map(([title, f]) => {
    const list = items.filter((i) => f(i.glyph));
    return list.length ? `<h4 class="pl-h">${title}</h4><ul class="places">${list.map((it) => row(it)).join('')}</ul>` : '';
  }).join('') + (pots.length ? `<details class="pots"${pots.includes(destItem!) ? ' open' : ''}><summary><span class="gl">${glyphSvg('pots')}</span>Crab pots <span class="cnt num">${pots.length}</span></summary><ul class="places">${pots.map((it) => row(it, it.name.replace(/^crab pots?\s*/i, '') || it.name)).join('')}</ul></details>` : '');
  R.innerHTML = `<div class="places-head"><button class="drawer-tab" id="places-tab" aria-expanded="${placesOpen}">
      <span class="grip" aria-hidden="true"></span><span class="pt">Places <span class="cnt num">${items.length}</span></span>
      <span class="dest-chip">${destItem ? `${glyphSvg(destItem.glyph)}<span>${esc(destItem.name)}</span>` : '<span class="hint">Tap a place to set the compass</span>'}</span></button>
      <h3 class="page-title">Places</h3><p class="hand small">Tap a place to set the compass.</p></div>
    <div class="places-body">${sections || '<p class="hand">Nowhere yet. Paddle out and look about.</p>'}</div>`;
  root.classList.toggle('places-open', placesOpen);
  $('places-tab').onclick = () => { placesOpen = !placesOpen; root.classList.toggle('places-open', placesOpen); $('places-tab').setAttribute('aria-expanded', String(placesOpen)); };
  R.querySelectorAll<HTMLButtonElement>('[data-place]').forEach((b) => (b.onclick = () => setDest(b.dataset.place!)));
  map.onPick = (key) => setDest(key);
  map.attach($('chart-canvas') as HTMLCanvasElement, L.querySelector('.map-ctl')!);
  if (!chart.ensureArt()) $('map-note').textContent = 'The chart is still being drawn…';
}

function setDest(key: string) {
  chart.setDestination(log.dest === key ? null : key);
  fx('reveal');
  const p = chart.places.find((q) => q.key === key);
  if (ctx.layout === 'portrait') placesOpen = false;
  show('map', true); // re-renders the page, so write the note after
  $('map-note') && ($('map-note').textContent = log.dest && p ? `Compass set for ${p.name}` : 'Compass cleared');
}

export { chartDebug };

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
      <li><button data-pg="99" class="${selPage === 99 ? 'on' : ''}"><span class="ico">${ICONS.tide}</span>Shore notes · tide pools</button></li>
    </ul>
    <p class="hand small">${found.size} of ${TOTAL_PAGES} found. Each sunstone keeps one.</p>`;
  L.querySelectorAll<HTMLButtonElement>('[data-pg]').forEach((b) => (b.onclick = () => { selPage = Number(b.dataset.pg); fx('page'); show('pages', true); openDetail(); }));
  if (selPage === 99) {
    R.innerHTML = shoreNotesHtml(critterPlate);
  } else if (selPage === 0) {
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
    ${toggle('set-flash', ctx.h?.flashes() ?? true, 'Screen flashes')}
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
    <p class="hand">Kept by Gran, found by you.</p>`;

  const sw = (id: string, f: () => void) => { const b = document.getElementById(id); if (b) b.onclick = () => { f(); savePrefs(); applyPrefsCb(); show('settings', true); }; };
  const sg = (id: string, f: (v: string) => void) => document.getElementById(id)?.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { f(b.dataset.v!); savePrefs(); applyPrefsCb(); show('settings', true); }));
  sg('set-text', (v) => { prefs.textScale = Number(v) as 1 | 1.15 | 1.3; });
  sw('set-motion', () => { prefs.reduceMotion = !prefs.reduceMotion; });
  sw('set-flash', () => { ctx.h?.flashes(!(ctx.h?.flashes() ?? true)); });
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
  $('set-reset').onclick = () => {
    const b = $('set-reset');
    if (b.dataset.sure) { resetUIProgress(); ctx.h?.reset(); return; }
    b.dataset.sure = '1';
    b.textContent = 'Tap again to wipe';
  };
}

// ------------------------------------------------------------------ Developer (temporary)
const CLOCK_PRESETS: [string, string][] = [['6.67', 'Dawn'], ['10.67', 'Morning'], ['13.33', 'Afternoon'], ['19.83', 'Dusk'], ['23.17', 'Night']];
const stack = (row: string) => row.replace('class="set-row"', 'class="set-row stack"');
function devTab(L: HTMLElement, R: HTMLElement) {
  const d = ctx.h?.dev;
  if (!d) { L.innerHTML = '<h3 class="page-title">Developer</h3><p class="hand">Not ready yet.</p>'; R.innerHTML = ''; return; }
  const st = d.state();
  L.innerHTML = `<h3 class="page-title">Developer</h3>
  <p class="small">Temporary controls while the game is being built. "Auto" lets the clock, weather and tide run on their own.</p>
  <div class="settings">
    <div class="set-row"><span>Now</span><span class="num">Day ${st.day + 1} · ${esc(st.clock)} · ${esc(st.weatherWords)}</span></div>
    ${stack(seg('dev-clock', CLOCK_PRESETS, '', 'Time of day'))}
    <div class="set-row"><span>Day</span><button class="btn ghost" id="dev-nextday">Next day →</button></div>
    ${stack(seg('dev-weather', [['auto', 'Auto'], ['clear', 'Clear'], ['drizzle', 'Drizzle'], ['rain', 'Rain'], ['storm', 'Storm']], st.weather, 'Weather'))}
    <div class="set-row"><span>Lightning</span><span class="row-btns"><button class="btn ghost" id="dev-bolt-far">Far</button> <button class="btn ghost" id="dev-bolt-near">Near</button></span></div>
    ${stack(seg('dev-mist', [['auto', 'Auto'], ['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']], st.mist, `Mist (now ${Math.round(st.mistNow * 100)}%)`))}
  </div>`;
  R.innerHTML = `<h3 class="page-title">Tide &amp; rendering</h3>
  <div class="settings">
    ${stack(seg('dev-tide', [['auto', 'Auto'], ['high', 'High'], ['mid', 'Mid'], ['low', 'Low'], ['lowest', 'Lowest']], st.tide, `Tide (${st.tideLevel.toFixed(2)} m, ${st.tideTrend})`))}
    ${toggle('dev-sun', st.sunShading, 'Sun shading')}
    ${toggle('dev-wind', st.wind, 'Wind in trees')}
    ${toggle('dev-fps', st.fps, 'Show FPS')}
    <div class="set-row"><span>Shells</span><button class="btn ghost" id="dev-shells">+100</button></div>
    <div class="set-row"><span>World data</span><span class="small">${esc(ctx.worldInfo)}</span></div>
  </div>`;
  const re = () => show('dev', true);
  const sg = (id: string, f: (v: string) => void) => document.getElementById(id)?.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { fx('tap'); f(b.dataset.v!); re(); }));
  const bt = (id: string, f: () => void) => { const b = document.getElementById(id); if (b) b.onclick = () => { fx('tap'); f(); re(); }; };
  sg('dev-clock', (v) => d.clock(Number(v)));
  sg('dev-weather', (v) => d.weather(v as DevWeather));
  sg('dev-mist', (v) => d.mist(v as DevMist));
  sg('dev-tide', (v) => d.tide(v as DevTide));
  bt('dev-nextday', () => d.nextDay());
  bt('dev-bolt-far', () => d.lightning(false));
  bt('dev-bolt-near', () => d.lightning(true));
  bt('dev-sun', () => d.sunShading(!st.sunShading));
  bt('dev-wind', () => d.wind(!st.wind));
  bt('dev-fps', () => ctx.h?.fps());
  bt('dev-shells', () => d.shells(100));
}
