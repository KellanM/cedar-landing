/** Styles for the opening's overlays (repair, Gran's tab), in the Logbook paper skin (style.css tokens). */
let done = false;
export function injectOpeningCss() {
  if (done) return;
  done = true;
  const s = document.createElement('style');
  s.id = 'opening-css';
  s.textContent = `
.op-overlay { position: fixed; inset: 0; z-index: 60; display: grid; place-items: end center; background: rgba(30, 26, 22, .38); padding: 0 0 max(10px, env(safe-area-inset-bottom)); }
@media (orientation: landscape) { .op-overlay { place-items: center end; padding: 8px 8px 8px 0; } }
.op-card { width: min(100vw, 460px); max-height: 92vh; overflow: auto; background: var(--paper); border: 2.5px solid var(--ink); border-radius: 18px 18px 12px 12px; box-shadow: 0 -4px 0 rgba(43,38,34,.25);
  background-image: repeating-linear-gradient(transparent 0 27px, rgba(46,94,99,.09) 27px 28px); padding: 0 18px 16px; color: var(--ink); font-family: var(--f-ui); }
.op-band { height: 10px; margin: 0 -18px 12px; border-bottom: 2px solid var(--ink); background: var(--teal); border-radius: 15px 15px 0 0; }
.op-town { margin: 0; font: 800 12px var(--f-ui); letter-spacing: .24em; text-transform: uppercase; color: var(--ink-soft); }
.op-h { margin: 2px 0 4px; font: 750 30px/1.05 var(--f-display); }
.op-hand { margin: 6px 0 10px; font: 700 22px/1.15 var(--f-hand); }
.op-btn { min-height: 52px; width: 100%; display: grid; place-items: center; padding: 6px 12px; border: 2.5px solid var(--ink); border-radius: 12px; box-shadow: var(--shadow-btn);
  font: 900 18px var(--f-ui); background: var(--paper); color: var(--ink); cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.op-btn.go { background: var(--teal); color: var(--paper); }
.op-btn.big { min-height: 64px; font-size: 20px; margin-top: 10px; }
.op-btn.held { transform: translateY(3px); box-shadow: 0 1px 0 rgba(43,38,34,.45); background: #24494D; }
.op-btn.done { background: var(--ochre-red); }
.rp-hull { position: relative; height: 96px; border: 2.5px solid var(--ink); border-radius: 10px 10px 48px 48px; background: #B98A5A; overflow: hidden; }
.rp-hull::before { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 34px, rgba(43,38,34,.25) 34px 36px); }
.rp-water { position: absolute; left: 0; right: 0; bottom: 0; height: 100%; background: rgba(46, 94, 99, .82); transition: height .08s linear; }
.rp-lbl { position: absolute; left: 10px; top: 6px; font: 900 13px var(--f-ui); color: var(--paper); text-shadow: 0 1px 0 var(--ink); letter-spacing: .06em; text-transform: uppercase; }
.rp-bar { position: relative; height: 34px; margin-top: 12px; border: 2.5px solid var(--ink); border-radius: 8px; background: var(--paper-2); }
.rp-mark { position: absolute; left: 37%; width: 26%; top: 0; bottom: 0; background: rgba(158,59,42,.25); border-left: 2px dashed var(--ochre-red); border-right: 2px dashed var(--ochre-red); }
.rp-mallet { position: absolute; top: -8px; width: 14px; height: 46px; margin-left: -7px; background: var(--ink); border-radius: 4px; }
.rp-nails { display: flex; gap: 10px; justify-content: center; margin-top: 10px; }
.rp-nails span { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--ink); }
.rp-nails span.in { background: var(--ink); }
.op-hide { display: none !important; }
`;
  document.head.appendChild(s);
}
