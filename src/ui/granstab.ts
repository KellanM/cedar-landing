/**
 * Gran's tab (opening Q9): Old Tess sets Gran's dented tin on the counter; three of her hand-painted
 * lures, pick one (docs/starter_pick_study.md; mockups shots/study/starter/mock_*.png).
 * Look freely (tap lifts a lure and shows its card), commit once (Tess asks), no wrong pick.
 * Resolves with the lure and the counter-pick line (Pip takes the one that beats yours).
 */
import { setModal } from './ctx';
import { fx } from './fx';
import { injectOpeningCss } from './openingcss';

export type LureId = 'red' | 'green' | 'blue';
const ORDER: LureId[] = ['red', 'green', 'blue'];
const BASE = import.meta.env.BASE_URL;

export const LURES: Record<LureId, {
  name: string; kind: string; col: string; persona: string; tag: string; gran: string; effect: string;
  meters: [number, number, number]; fish: [string, string, boolean?][]; tess: string; gear: string;
}> = {
  red: { name: 'the Ember', kind: 'red spinner', col: '#B23A2A', persona: 'Quick · bold', tag: 'for the quick ones', gear: 'lure_red',
    gran: '"For when you can\'t sit still. Neither can a salmon."', effect: 'Bites come about twice as fast. Darting, schooling fish go for it: herring, smelt, trout and salmon.',
    meters: [3, 1, 1], fish: [['pacific-herring', 'Herring'], ['surf-smelt', 'Smelt'], ['coho-salmon', 'Coho', true]],
    tess: "The Ember, is it? Your gran's rainy-morning lure. She said it was too keen by half." },
  green: { name: 'the Mossback', kind: 'weed jig', col: '#4F7A3A', persona: 'Patient · steady', tag: 'for the deep rocks', gear: 'lure_green',
    gran: '"Goes down and stays down. Ask the rockfish."', effect: "Sinks to the rocks and kelp (12 fathoms): rockfish and cabezon you can't reach yet. Slower bites; skips surface fish.",
    meters: [1, 3, 1], fish: [['copper-rockfish', 'Copper rockfish', true], ['cabezon', 'Cabezon', true], ['kelp-greenling', 'Greenling']],
    tess: 'The Mossback. Heavy old thing. She fished the Hook Point rip with it every autumn.' },
  blue: { name: 'the Moonspoon', kind: 'pearl spoon', col: '#3B5F8F', persona: 'Dreamy · lucky', tag: 'for the big ones', gear: 'lure_blue',
    gran: '"Flashes like a herring at dusk. The big ones notice."', effect: 'Bigger fish and more three-star catches. Uncommon and rare fish turn up more often.',
    meters: [1, 1, 3], fish: [['starry-flounder', 'Big flounder'], ['dungeness-crab', 'Crab'], ['lingcod', 'Lingcod (later)', true]],
    tess: 'The Moonspoon. She swore by it at dusk. Never told me why, and I asked.' },
};
/** Pip (Mae's kid) always takes the lure that beats yours at the Saturday derby; Lark takes the last. */
export const BEATS: Record<LureId, LureId> = { red: 'green', green: 'blue', blue: 'red' };
const PIP_WHY: Record<LureId, string> = { red: 'Kinds beat speed, everyone knows that.', green: 'Biggest beats deepest!', blue: 'Fastest beats biggest!' };
const METERS = ['Quick bites', 'Fishes deep', 'Big & lucky'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function lureSVG(k: LureId) {
  const S = 'stroke="#2B2622"';
  if (k === 'red') return `<svg class="gt-lure" viewBox="0 0 80 220"><line x1="40" y1="6" x2="40" y2="150" ${S} stroke-width="3"/><circle cx="40" cy="10" r="6" fill="none" ${S} stroke-width="3"/>
    <ellipse cx="40" cy="58" rx="22" ry="34" fill="#C8A04A" ${S} stroke-width="3"/><ellipse cx="40" cy="58" rx="15" ry="26" fill="#B23A2A"/><circle cx="40" cy="50" r="5" fill="#F4EFE3"/>
    <rect x="34" y="96" width="12" height="10" rx="4" fill="#C8A04A" ${S} stroke-width="2.5"/><rect x="34" y="108" width="12" height="10" rx="4" fill="#B23A2A" ${S} stroke-width="2.5"/><rect x="34" y="120" width="12" height="10" rx="4" fill="#C8A04A" ${S} stroke-width="2.5"/>
    <path d="M40 132 C 22 150 18 180 28 196 M40 132 C 58 150 62 180 52 196 M40 132 C 40 160 40 185 40 200" stroke="#B23A2A" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M40 150 v52 a10 10 0 0 1 -18 2 M40 150 l14 50 a9 9 0 0 0 14 -6" ${S} stroke-width="3" fill="none"/></svg>`;
  if (k === 'green') return `<svg class="gt-lure" viewBox="0 0 80 220"><circle cx="40" cy="10" r="6" fill="none" ${S} stroke-width="3"/>
    <circle cx="40" cy="42" r="24" fill="#4F7A3A" ${S} stroke-width="3"/><circle cx="48" cy="36" r="7" fill="#E6D3A3" ${S} stroke-width="2"/><circle cx="49" cy="36" r="3" fill="#2B2622"/>
    <rect x="28" y="64" width="24" height="12" fill="#7A4E2E" ${S} stroke-width="2.5"/>
    <path d="M30 76 C 22 120 26 160 34 196 M36 76 C 32 120 34 160 38 200 M44 76 C 46 120 46 160 44 200 M50 76 C 58 120 54 160 48 194" stroke="#5E8C4A" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M34 80 C 30 120 30 150 32 180 M46 80 C 50 120 50 150 46 182" stroke="#6B4A2E" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M40 64 v130 a12 12 0 0 0 22 4 l-4 -10" ${S} stroke-width="3.5" fill="none"/></svg>`;
  return `<svg class="gt-lure" viewBox="0 0 80 220"><circle cx="40" cy="10" r="6" fill="none" ${S} stroke-width="3"/><circle cx="40" cy="22" r="6" fill="none" ${S} stroke-width="3"/>
    <path d="M40 28 C 66 50 66 130 40 168 C 14 130 14 50 40 28 Z" fill="#D9DCDD" ${S} stroke-width="3"/><path d="M40 40 C 56 60 56 120 40 150 C 24 120 24 60 40 40 Z" fill="#3B5F8F"/>
    <circle cx="40" cy="78" r="9" fill="#EAF0F2" ${S} stroke-width="2"/><circle cx="34" cy="108" r="3" fill="#C9D6E6"/><circle cx="46" cy="122" r="3" fill="#C9D6E6"/>
    <path d="M40 168 v34 a10 10 0 0 1 -18 0" ${S} stroke-width="3" fill="none"/><path d="M40 176 c-8 10 -10 18 -6 26 M40 176 c8 10 10 18 6 26" stroke="#E6D3A3" stroke-width="4" fill="none"/></svg>`;
}

const CSS = `
.gt-wrap { position: fixed; inset: 0; z-index: 60; background: rgba(30,26,22,.35); font-family: var(--f-ui); color: var(--ink); }
.gt-counter { position: absolute; left: 0; right: 0; top: 0; height: 58%; background: repeating-linear-gradient(0deg, #8a5a36 0 46px, #7a4e2e 46px 48px); box-shadow: inset 0 18px 0 rgba(0,0,0,.18); }
.gt-tin { position: absolute; left: 50%; top: 8%; width: min(82vw, 330px); transform: translateX(-50%); }
.gt-lid { height: 86px; margin: 0 8px; border: 3px solid var(--ink); border-radius: 16px 16px 6px 6px; background: linear-gradient(#c4c6c0, #a5a7a1); display: grid; place-items: center; font: 700 24px var(--f-hand); color: #4e4b45; }
.gt-body { border: 3px solid var(--ink); border-radius: 16px; background: linear-gradient(#a9aba6, #8e908b); box-shadow: 0 10px 0 rgba(30,24,20,.45); padding: 12px; }
.gt-felt { display: flex; gap: 8px; height: 168px; border-radius: 10px; background: #2f4a3a; border: 2px solid #1f2f26; box-shadow: inset 0 6px 12px rgba(0,0,0,.45); padding: 9px; }
.gt-slot { position: relative; flex: 1; border-radius: 8px; background: #243b2e; box-shadow: inset 0 4px 8px rgba(0,0,0,.5); display: grid; place-items: center; cursor: pointer; border: 0; padding: 0; }
.gt-slot .gt-lure { width: 66%; height: 88%; filter: drop-shadow(0 3px 0 rgba(0,0,0,.45)); transition: transform .25s ease; }
.gt-slot.dim { opacity: .45; }
.gt-slot.on::before { content: ''; position: absolute; inset: -5px; border-radius: 12px; border: 3px dashed var(--paper); }
.gt-slot.on .gt-lure { transform: translateY(-26px) scale(1.25); filter: drop-shadow(0 18px 6px rgba(0,0,0,.45)); }
.gt-tags { display: flex; justify-content: space-around; margin-top: 18px; }
.gt-tag { width: 30%; padding: 4px 6px; background: var(--paper); border: 2px solid var(--ink); border-radius: 4px 10px 4px 9px; box-shadow: var(--shadow); font: 700 18px/1 var(--f-hand); text-align: center; }
.gt-tag b { display: block; font: 800 10.5px var(--f-ui); letter-spacing: .06em; text-transform: uppercase; margin-bottom: 2px; }
.gt-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--ink); margin-right: 4px; vertical-align: -1px; }
.gt-sheet { position: absolute; left: 0; right: 0; bottom: 0; max-height: 58%; overflow: auto; background: var(--paper); border: 2.5px solid var(--ink); border-radius: 18px 18px 0 0; padding: 0 16px max(14px, env(safe-area-inset-bottom));
  background-image: repeating-linear-gradient(transparent 0 27px, rgba(46,94,99,.09) 27px 28px); }
.gt-band { height: 10px; margin: 0 -16px 10px; border-bottom: 2px solid var(--ink); }
.gt-town { font: 800 12px var(--f-ui); letter-spacing: .2em; text-transform: uppercase; color: var(--ink-soft); }
.gt-h { margin: 2px 0; font: 750 28px/1.05 var(--f-display); }
.gt-hand { margin: 4px 0; font: 700 21px/1.15 var(--f-hand); }
.gt-persona { padding: 2px 9px; border: 2px solid var(--ink); border-radius: var(--r-tab); font: 900 12px var(--f-ui); letter-spacing: .1em; text-transform: uppercase; color: var(--paper); white-space: nowrap; }
.gt-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 2px; }
.gt-meters { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; align-items: center; margin: 6px 0 4px; font: 800 14px var(--f-ui); }
.gt-pips { display: flex; gap: 5px; } .gt-pip { width: 22px; height: 12px; border: 2px solid var(--ink); border-radius: 3px 6px 3px 5px; } .gt-pip.on { background: var(--ink); }
.gt-eff { margin: 4px 0; font: 700 15px/1.3 var(--f-ui); }
.gt-fish { display: flex; gap: 10px; align-items: flex-end; } .gt-fish span { display: flex; flex-direction: column; align-items: center; width: 74px; font: 750 12px var(--f-ui); text-align: center; line-height: 1.05; }
.gt-fish img { width: 70px; height: 32px; object-fit: contain; } .gt-new { font: 900 10px var(--f-ui); color: var(--paper); background: var(--ochre-red); border-radius: 3px; padding: 0 4px; margin-top: 2px; }
.gt-btns { display: flex; gap: 10px; margin-top: 10px; } .gt-btns .op-btn { flex: 1; }
.gt-sw { display: flex; gap: 8px; margin: 8px 0; } .gt-sw button { flex: 1; padding: 8px 6px; border: 2px solid var(--ink); border-radius: var(--r-tab); background: var(--paper-2); font: 800 14px var(--f-ui); color: var(--ink); cursor: pointer; }
.gt-sw i { display: block; height: 8px; border-radius: 3px; margin: 0 6px 5px; border: 1.5px solid var(--ink); }
.gt-tess { margin: 8px 0; padding: 10px 14px; border: 2.5px solid var(--ink); border-radius: 12px; background: var(--paper); box-shadow: var(--shadow); font: 650 18px/1.3 var(--f-ui); }
.gt-tess b.who { display: block; font: 800 13px var(--f-ui); letter-spacing: .1em; text-transform: uppercase; color: var(--teal); }
@media (orientation: landscape) {
  .gt-counter { width: 52%; height: 100%; } .gt-tin { left: 26%; top: 10%; width: min(40vw, 330px); }
  .gt-sheet { left: auto; top: 8px; right: 8px; bottom: 8px; width: min(46vw, 420px); max-height: none; border-radius: 12px; }
}`;

export function gransTab(opts: { reduceMotion?: boolean } = {}): Promise<{ lure: LureId; pipName: string; pipLine: string; lark: LureId } | null> {
  injectOpeningCss();
  if (!document.getElementById('gt-css')) { const s = document.createElement('style'); s.id = 'gt-css'; s.textContent = CSS; document.head.appendChild(s); }
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'gt-wrap';
    el.innerHTML = `<div class="gt-counter"></div><div class="gt-tin"><div class="gt-lid">for the grandchild. — G.</div><div class="gt-body"><div class="gt-felt">${ORDER.map((k) => `<button class="gt-slot" data-k="${k}" aria-label="${LURES[k].name}">${lureSVG(k)}</button>`).join('')}</div></div>
      <div class="gt-tags">${ORDER.map((k) => `<div class="gt-tag"><b><span class="gt-dot" style="background:${LURES[k].col}"></span>${LURES[k].name}</b>${LURES[k].tag}</div>`).join('')}</div></div>
      <section class="gt-sheet" role="dialog" aria-label="Gran's tab"></section>`;
    document.body.appendChild(el);
    setModal('opening');
    const sheet = el.querySelector<HTMLElement>('.gt-sheet')!;
    let sel: LureId | null = null;
    const slots = [...el.querySelectorAll<HTMLButtonElement>('.gt-slot')];
    const lift = (k: LureId | null) => {
      sel = k;
      for (const s of slots) { s.classList.toggle('on', s.dataset.k === k); s.classList.toggle('dim', !!k && s.dataset.k !== k); }
      if (k) fx('page');
      render(k ? 'preview' : 'pick');
    };
    slots.forEach((s) => (s.onclick = () => lift(s.dataset.k as LureId)));
    const card = (k: LureId) => {
      const l = LURES[k];
      return `<div class="gt-band" style="background:${l.col}"></div>
        <div class="gt-row"><span class="gt-town">Gran's ${l.kind}</span><span class="gt-persona" style="background:${l.col}">${l.persona}</span></div>
        <h2 class="gt-h">${cap(l.name)}</h2><p class="gt-hand">${l.gran} <span style="color:var(--ink-soft)">— G.</span></p>
        <div class="gt-meters">${METERS.map((m, i) => `<span>${m}</span><span class="gt-pips">${[0, 1, 2].map((j) => `<i class="gt-pip${j < l.meters[i] ? ' on' : ''}" style="${j < l.meters[i] && l.meters[i] === 3 ? `background:${l.col}` : ''}"></i>`).join('')}</span>`).join('')}</div>
        <p class="gt-eff">${l.effect}</p><div class="gt-town">Likes</div>
        <div class="gt-fish">${l.fish.map(([f, n, nw]) => `<span><img alt="" src="${BASE}fish/${f}.svg">${n}${nw ? '<i class="gt-new">NEW</i>' : ''}</span>`).join('')}</div>`;
    };
    function render(view: 'pick' | 'preview' | 'confirm') {
      if (view === 'pick') {
        sheet.innerHTML = `<div class="gt-band" style="background:var(--teal)"></div><div class="gt-town">Gran's tab · one thing</div><h2 class="gt-h">Pick a lure</h2>
          <p class="gt-hand">Tap one to lift it out and read her tag.</p>
          <div class="gt-sw">${ORDER.map((k) => `<button data-k="${k}"><i style="background:${LURES[k].col}"></i>${LURES[k].persona}</button>`).join('')}</div>
          <p style="font:700 14px/1.3 var(--f-ui);color:var(--ink-soft);margin:4px 0">No wrong pick: each one fishes differently, and Tess can tie you the others later.</p>`;
        sheet.querySelectorAll<HTMLButtonElement>('.gt-sw button').forEach((b) => (b.onclick = () => lift(b.dataset.k as LureId)));
      } else if (view === 'preview' && sel) {
        const k = sel;
        sheet.innerHTML = `${card(k)}<div class="gt-btns"><button class="op-btn" id="gt-back">Put it back</button><button class="op-btn go" id="gt-take" style="background:${LURES[k].col}">Take ${LURES[k].name.replace('the ', '')}</button></div>`;
        sheet.querySelector<HTMLButtonElement>('#gt-back')!.onclick = () => lift(null);
        sheet.querySelector<HTMLButtonElement>('#gt-take')!.onclick = () => render('confirm');
      } else if (view === 'confirm' && sel) {
        const k = sel;
        sheet.innerHTML = `<div class="gt-band" style="background:${LURES[k].col}"></div><div class="gt-town"><span class="gt-dot" style="background:${LURES[k].col}"></span>${LURES[k].name} · ${LURES[k].persona}</div>
          <div class="gt-tess"><b class="who">Old Tess</b>${LURES[k].tess}<br><b>That one, then?</b></div>
          <div class="gt-btns"><button class="op-btn" id="gt-again">Let me look again</button><button class="op-btn go" id="gt-yes" style="background:${LURES[k].col}">Yes — tie it on</button></div>`;
        sheet.querySelector<HTMLButtonElement>('#gt-again')!.onclick = () => lift(null);
        sheet.querySelector<HTMLButtonElement>('#gt-yes')!.onclick = () => {
          fx('stamp');
          const pip = BEATS[k], lark = ORDER.find((x) => x !== k && x !== pip)!;
          el.remove(); setModal(null);
          resolve({ lure: k, lark, pipName: 'Pip, Mae\'s kid', pipLine: `Then I'm having ${LURES[pip].name}! ${PIP_WHY[k]} Saturday derby at the float — you'll see! (Lark from across the cove took ${LURES[lark].name}.)` });
        };
      }
    }
    render('pick');
    void opts;
  });
}
