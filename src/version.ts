declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT__: string;

export const VERSION = { version: __APP_VERSION__, commit: __APP_COMMIT__, built: __APP_BUILT__ };
export const VERSION_LABEL = `v${VERSION.version} · ${VERSION.commit} · ${VERSION.built}`;

/** Small, unobtrusive build stamp (bottom-left, above the safe area). */
export function mountVersionStamp(): void {
  const el = document.createElement('div');
  el.id = 'version-stamp';
  el.textContent = VERSION_LABEL;
  el.style.cssText = [
    'position:fixed', 'left:calc(env(safe-area-inset-left) + 6px)', 'bottom:calc(env(safe-area-inset-bottom) + 4px)',
    'font:600 10px/1.2 system-ui,sans-serif', 'color:rgba(255,255,255,.85)', 'text-shadow:0 1px 2px rgba(0,0,0,.6)',
    'pointer-events:none', 'z-index:9999', 'letter-spacing:.02em',
  ].join(';');
  document.body.appendChild(el);
  console.info('[cedar-landing]', VERSION_LABEL);
}
