declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT__: string;

export const VERSION = { version: __APP_VERSION__, commit: __APP_COMMIT__, built: __APP_BUILT__ };
export const VERSION_LABEL = `v${VERSION.version} · ${VERSION.commit} · ${VERSION.built}`;

/**
 * Updates. A home-screen app is often resumed from memory or reopened from the browser cache, so
 * it can sit on an old build. Each build publishes `version.json`; we fetch it uncached:
 *  - at launch: if a newer build is out in the first few seconds, reload straight into it;
 *  - when the app comes back to the front: the stamp turns into "Update ready, tap";
 *  - tapping the stamp checks now and reloads into the new build (or says it's up to date).
 * The reload adds `?u=<commit>` so the page itself can't come from a stale cache.
 */
const BASE = import.meta.env.BASE_URL;
let el: HTMLElement;
let pending: { version: string; commit: string } | null = null;
let busy = false;
const loadedAt = performance.now();

async function latest(): Promise<{ version: string; commit: string; built: string } | null> {
  if (import.meta.env.DEV) return null;
  try {
    const r = await fetch(`${BASE}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const v = await r.json();
    return typeof v?.commit === 'string' ? v : null;
  } catch { return null; }
}

function reloadInto(commit: string) {
  try { sessionStorage.setItem('cl-update-tried', commit); } catch { /* private mode */ }
  const u = new URL(location.href);
  u.searchParams.set('u', commit);
  location.replace(u.toString());
}

function show(text: string, highlight = false) {
  el.textContent = text;
  el.style.color = highlight ? '#FFE6A8' : 'rgba(255,255,255,.85)';
  el.style.fontWeight = highlight ? '800' : '600';
}

/** The player has set out (title tapped): from here on nothing reloads without their say-so. */
const playing = () => document.body.classList.contains('playing');
type ReadyCb = (v: { version: string; commit: string }) => void;
const readyCbs: ReadyCb[] = [];
/** An update arrived while playing (hud_flow_study P6): the HUD asks politely. */
export function onUpdateReady(cb: ReadyCb) { readyCbs.push(cb); }
export const updatePending = () => pending;
/** Reload into the pending build (only ever called from a tap: the Log or the update notice). */
export function applyUpdate() { if (pending) { window.dispatchEvent(new Event('ui:beforeupdate')); reloadInto(pending.commit); } }

/** Manual check from the Log: never reloads by itself, it reports. */
export async function checkForUpdate(): Promise<'none' | 'ready' | 'offline'> {
  const v = await latest();
  if (!v) return 'offline';
  if (v.commit === VERSION.commit) { pending = null; return 'none'; }
  pending = v;
  return 'ready';
}

async function check(manual: boolean) {
  if (busy) return;
  busy = true;
  if (manual) show('Checking for updates…');
  const v = await latest();
  busy = false;
  if (!v) { if (manual) { show('Couldn’t check (offline?)'); setTimeout(() => show(pending ? `Update ready: v${pending.version}, tap` : VERSION_LABEL, !!pending), 2500); } return; }
  if (v.commit === VERSION.commit) {
    pending = null;
    if (manual) { show(`Up to date · ${VERSION_LABEL}`); setTimeout(() => show(VERSION_LABEL), 2500); }
    return;
  }
  const fresh = pending?.commit !== v.commit;
  pending = v;
  // mid-play (P6): never reload on our own; a small notice asks first
  if (playing() && !manual) { if (fresh) readyCbs.forEach((cb) => cb(v)); return; }
  // a just-launched game (loading / title, not yet playing) goes straight to the new build
  let tried = '';
  try { tried = sessionStorage.getItem('cl-update-tried') ?? ''; } catch { /* ignore */ }
  // never loop: if we already reloaded for this build and still got the old page, wait for a tap
  if (manual || (performance.now() - loadedAt < 8000 && tried !== v.commit)) { show(`Updating to v${v.version}…`, true); setTimeout(() => reloadInto(v.commit), manual ? 400 : 0); return; }
  show(`Update ready: v${v.version}, tap`, true);
}

/**
 * Build stamp (bottom-left, above the safe area), on the loading card and title only (P6): once
 * the player sets out it hides (CSS) and lives in Log > Settings > About. Tap it to check.
 */
export function mountVersionStamp(): void {
  el = document.createElement('button');
  el.id = 'version-stamp';
  el.setAttribute('aria-label', `Version ${VERSION.version}. Tap to check for updates`);
  el.style.cssText = [
    'position:fixed', 'left:calc(env(safe-area-inset-left) + 2px)', 'bottom:calc(env(safe-area-inset-bottom) + 0px)',
    'font:600 10px/1.2 system-ui,sans-serif', 'color:rgba(255,255,255,.85)', 'text-shadow:0 1px 2px rgba(0,0,0,.6)',
    'z-index:9999', 'letter-spacing:.02em', 'background:none', 'border:0', 'padding:6px 6px 4px', 'margin:0',
    'cursor:pointer', '-webkit-tap-highlight-color:transparent', 'touch-action:manipulation',
  ].join(';');
  show(VERSION_LABEL);
  const tap = (e: Event) => { e.stopPropagation(); e.preventDefault(); if (pending) reloadInto(pending.commit); else void check(true); };
  el.addEventListener('click', tap);
  for (const ev of ['pointerdown', 'touchstart', 'mousedown']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  document.body.appendChild(el);
  console.info('[cedar-landing]', VERSION_LABEL);
  // tidy the URL after an update reload (keep any other params, e.g. ?debug)
  const u = new URL(location.href);
  if (u.searchParams.has('u')) { u.searchParams.delete('u'); history.replaceState(null, '', u.toString()); }
  void check(false);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(false); });
}
