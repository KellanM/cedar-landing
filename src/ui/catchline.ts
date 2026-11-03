/**
 * Catch line box (docs/catch_study.md F4): an Animal Crossing–style speech panel in Logbook paper,
 * low on the screen while the skipper holds the fish up. Optional big-type headline ("Look at those
 * teeth!") pops in first; then the pun types out with the fish's name inked in ochre red; a footer
 * carries the size and NEW / Record! / Perfect tags. Purely presentational: the timeline lives in
 * src/game/catchshow.ts, which also handles tap-to-skip.
 */
import { esc, h, reduceMotion } from './ctx';
import { fishGlyph } from './fishart';
import { gameAudio } from '../audio';

let el: HTMLElement | null = null;
let typing = 0;

function ensure() {
  if (el) return el;
  el = h('div', 'catchline hidden');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="cl-box paper"><p class="cl-head" id="cl-head"></p><p class="cl-text" id="cl-text"></p>
    <div class="cl-foot" id="cl-foot"></div><i class="cl-more" aria-hidden="true">▾</i></div>`;
  document.body.appendChild(el);
  return el;
}

export interface LineFoot { speciesId: string; size: number; tags: string[] }

/** Big-type headline (rare+). */
export function catchHead(text: string, tier: string) {
  const root = ensure();
  stopTyping();
  root.className = `catchline t-${tier} has-head`;
  const head = root.querySelector<HTMLElement>('#cl-head')!;
  head.textContent = text;
  head.classList.remove('pop'); void head.offsetWidth; head.classList.add('pop');
  root.querySelector('#cl-text')!.innerHTML = '';
  root.querySelector('#cl-foot')!.innerHTML = '';
  root.classList.remove('done');
  gameAudio.voice('skipper', text, 0.6);
}

/** Type the pun line; `{n}` → the inked fish name. Returns the typing time (s). */
export function catchLine(template: string, name: string, foot: LineFoot, tier: string, cps: number): number {
  const root = ensure();
  stopTyping();
  root.className = `catchline t-${tier}`;
  const parts = template.split('{n}');
  // characters revealed one by one, across plain text and the inked name
  const segs: { t: string; ink: boolean }[] = [];
  parts.forEach((p, i) => { if (p) segs.push({ t: p, ink: false }); if (i < parts.length - 1) segs.push({ t: spoken(name), ink: true }); });
  const total = segs.reduce((a, s) => a + s.t.length, 0);
  const text = root.querySelector<HTMLElement>('#cl-text')!;
  const render = (n: number) => {
    let left = n, html = '';
    for (const s of segs) {
      const take = s.t.slice(0, Math.max(0, left));
      left -= s.t.length;
      if (take) html += s.ink ? `<b class="ink">${esc(take)}</b>` : esc(take);
    }
    text.innerHTML = html;
  };
  const tags = foot.tags.map((t) => `<span class="tag tag-${t.toLowerCase().replace(/[^a-z]/g, '')}">${esc(t)}</span>`).join('');
  root.querySelector('#cl-foot')!.innerHTML = `<span class="glyph">${fishGlyph(foot.speciesId)}</span><span class="num">${foot.size.toFixed(1)} cm</span>${tags}`;
  root.classList.remove('done');
  const secs = reduceMotion() ? 0 : total / cps;
  if (!secs) { render(total); root.classList.add('done'); }
  else {
    const t0 = performance.now();
    const step = () => {
      const n = Math.min(total, Math.floor(((performance.now() - t0) / 1000) * cps) + 1);
      render(n);
      if (n < total) typing = requestAnimationFrame(step);
      else { typing = 0; root.classList.add('done'); }
    };
    step();
  }
  gameAudio.voice('skipper', template.replace('{n}', spoken(name)), Math.max(0.4, secs));
  return secs;
}

/** "Red Irish Lord" → "red Irish lord" (common names in running text; proper nouns keep capitals). */
export const spoken = (name: string) => name.toLowerCase().replace(/\b(pacific|english|irish|dungeness|chinook)\b/g, (m) => m[0].toUpperCase() + m.slice(1));

function stopTyping() { if (typing) cancelAnimationFrame(typing); typing = 0; }

export function hideCatchLine() {
  stopTyping();
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('out');
  const e = el;
  setTimeout(() => { e.classList.add('hidden'); e.classList.remove('out'); }, 180);
}

/** Paper-gold flash over the frame at the reveal (rare+; Settings → Screen flashes, reduced motion). */
let flashEl: HTMLElement | null = null;
export function catchFlash(strength: number) {
  if (!flashEl) { flashEl = h('div', 'catch-flash'); flashEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(flashEl); }
  flashEl.style.setProperty('--k', strength.toFixed(2));
  flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go');
}
