/**
 * DialogueStrip (ui_layouts_indie §3.5): bottom strip with the speaker's name tab, typewriter at
 * 45 chars/s, tap completes the line, tap again advances. Choices (max 3, 56px) stack above on
 * the right, default nearest the thumb. Desktop: Space/E advance, 1–3 pick. HUD top strip hidden.
 * Paging (Kellan: "make the messages a lot shorter, or break them up between taps"): every line is
 * split into pages of about one idea (≤ PAGE_MAX chars, on sentence breaks); the ▸ shows while more
 * follows. First tap completes the page, the next advances. Skip (button, Esc, or a long press on the
 * strip) jumps to the next choice — or closes the note.
 */
import { $, ctx, h, setModal, T, reduceMotion } from './ctx';
import { fx } from './fx';
import { gameAudio } from '../audio';

export interface Line { who: string; text: string; choices?: { label: string; value: string }[] }

/** Longest page (characters). Sentences are kept whole where they fit. */
export const PAGE_MAX = 90;

/** Split text into tap-to-advance pages: whole sentences packed up to `max` chars; a longer sentence
 *  breaks at a comma / dash / semicolon, and failing that at a word. */
export function paginate(text: string, max = PAGE_MAX): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return [t];
  const sentences = t.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g)?.map((x) => x.trim()).filter(Boolean) ?? [t];
  const parts: string[] = [];
  for (const sn of sentences) {
    if (sn.length <= max) { parts.push(sn); continue; }
    let rest = sn;
    while (rest.length > max) {
      const win = rest.slice(0, max);
      let cut = Math.max(win.lastIndexOf(', '), win.lastIndexOf(' — '), win.lastIndexOf('; '));
      if (cut < max * 0.4) cut = win.lastIndexOf(' ');
      if (cut <= 0) cut = max;
      parts.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) parts.push(rest);
  }
  const pages: string[] = [];
  for (const p of parts) {
    const last = pages[pages.length - 1];
    if (last && last.length + 1 + p.length <= max) pages[pages.length - 1] = `${last} ${p}`;
    else pages.push(p);
  }
  return pages;
}

let el: HTMLElement | null = null;
let queue: Line[] = [];
let shown = 0;
let full = '';
let typing = 0;
let done: ((v: string | null) => void) | null = null;

function ensure() {
  if (el) return el;
  el = h('div', 'dialogue hidden');
  el.innerHTML = `<div class="choices" id="dlg-choices"></div>
    <div class="strip paper" role="dialog" aria-live="polite"><b class="name-tab" id="dlg-who"></b><p id="dlg-text"></p><i class="more" aria-hidden="true">▸</i>
      <button class="dlg-skip" id="dlg-skip" type="button" aria-label="Skip">Skip ▸▸</button></div>`;
  document.body.appendChild(el);
  if (!document.getElementById('dlg-paging-css')) {
    const st = document.createElement('style'); st.id = 'dlg-paging-css';
    st.textContent = `.dialogue .strip { position: relative; } .dialogue .dlg-skip { position: absolute; right: 10px; top: -16px; min-height: 32px; padding: 2px 12px; border: 2px solid var(--ink); border-radius: var(--r-tab, 8px); background: var(--paper); color: var(--ink-soft); font: 800 13px var(--f-ui); letter-spacing: .04em; box-shadow: var(--shadow); cursor: pointer; }
      .dialogue .dlg-skip[hidden] { display: none; } .dialogue .pg { margin-left: 8px; font: 800 11px var(--f-ui); color: var(--ink-soft); letter-spacing: .08em; }`;
    document.head.appendChild(st);
  }
  const strip = el.querySelector<HTMLElement>('.strip')!;
  let pressT = 0, longFired = false, pressTimer = 0;
  strip.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).id === 'dlg-skip') return;
    e.stopPropagation();
    pressT = performance.now(); longFired = false;
    clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => { longFired = true; skip(); }, 550); // long press = skip
  });
  const release = (e: PointerEvent) => {
    if ((e.target as HTMLElement).id === 'dlg-skip' || !pressT) return;
    clearTimeout(pressTimer); pressT = 0;
    if (!longFired) advance();
  };
  strip.addEventListener('pointerup', release);
  strip.addEventListener('pointercancel', () => { clearTimeout(pressTimer); pressT = 0; });
  $('dlg-skip').addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); skip(); });
  window.addEventListener('keydown', (e) => {
    if (ctx.modal !== 'dialogue') return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'e' || k === 'enter') { e.preventDefault(); e.stopPropagation(); advance(); }
    if (k === 'escape') { e.preventDefault(); e.stopPropagation(); skip(); }
    const n = Number(k);
    if (n >= 1 && n <= 3) el!.querySelectorAll<HTMLButtonElement>('.choices button')[n - 1]?.click();
  }, { capture: true });
  return el;
}

/** Play lines; resolves with the chosen value (or null). */
export function dialogue(lines: Line[]): Promise<string | null> {
  ensure();
  // one Line per page; choices stay on the last page of their line
  queue = lines.flatMap((l) => {
    const pages = paginate(l.text);
    return pages.map((text, i) => ({ who: l.who, text, choices: i === pages.length - 1 ? l.choices : undefined, page: [i + 1, pages.length] as [number, number] }));
  });
  el!.classList.remove('hidden');
  setModal('dialogue');
  return new Promise((res) => { done = res; next(); });
}

function next() {
  const line = queue.shift();
  if (!line) return finish(null);
  const pg = (line as Line & { page?: [number, number] }).page;
  $('dlg-who').innerHTML = `${line.who.replace(/[&<>]/g, '')}${pg && pg[1] > 1 ? `<span class="pg">${pg[0]}/${pg[1]}</span>` : ''}`;
  $('dlg-skip').hidden = queue.length === 0 || !!line.choices?.length;
  el!.classList.toggle('last', queue.length === 0);
  full = line.text;
  shown = 0;
  el!.classList.remove('complete');
  const ch = $('dlg-choices');
  ch.innerHTML = '';
  clearInterval(typing);
  const tick = () => {
    shown = Math.min(full.length, shown + 1);
    $('dlg-text').textContent = full.slice(0, shown);
    if (shown >= full.length) complete(line);
  };
  gameAudio.voice(line.who, line.text, reduceMotion() ? 0.6 : Math.min(2.4, full.length / T.cps)); // non-verbal murmur while it types
  if (reduceMotion()) { shown = full.length - 1; tick(); } else typing = window.setInterval(tick, 1000 / T.cps);
}

function complete(line: Line) {
  clearInterval(typing);
  $('dlg-text').textContent = full;
  shown = full.length;
  el!.classList.add('complete');
  if (line.choices?.length) {
    const ch = $('dlg-choices');
    // default (first) choice nearest the thumb → render bottom-most
    for (const c of [...line.choices].slice(0, 3).reverse()) {
      const b = h('button', 'btn ghost', c.label) as HTMLButtonElement;
      b.onclick = (e) => { e.stopPropagation(); finish(c.value); };
      ch.appendChild(b);
    }
  }
}

function advance() {
  if (shown < full.length) { shown = full.length - 1; return; } // next tick completes
  if (el!.querySelector('.choices button')) return; // must choose
  fx('page');
  next();
}

/** Skip: jump to the next page that asks a question (so a choice is never skipped), else close. */
function skip() {
  if (el!.querySelector('.choices button')) return;
  clearInterval(typing);
  const i = queue.findIndex((l) => l.choices?.length);
  if (i < 0) { fx('page'); finish(null); return; }
  queue = queue.slice(i);
  fx('page');
  next();
}

function finish(v: string | null) {
  clearInterval(typing);
  el?.classList.add('hidden');
  if (ctx.modal === 'dialogue') setModal(null);
  const d = done; done = null;
  d?.(v);
}
