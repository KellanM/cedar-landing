import './tide.css';
import { ctx, esc } from './ctx';
import { ICONS } from './icons';
import { tideTurns, chartHeight, WATER, tideAt, springness } from '../game/tide';
import { CRITTERS } from '../game/tidepools';

/**
 * Tide UI (docs/tide_study.md): the Log's tide table (today's real highs and lows from the tide
 * model, in chart-datum metres like a printed table), the little rising / falling arrow on the HUD
 * clock, and Gran's shore notes (the tide-pool critters you have looked at).
 */
const hhmm = (h: number) => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/** Today's tide table (Log → Errands, "Wallet & weather"). */
export function tideTableHtml() {
  const day = ctx.save?.day ?? 0, now = ctx.save?.clock ?? 12;
  const turns = tideTurns(day);
  const next = turns.find((t) => t.hour > now);
  const rows = turns.map((t) => `<tr class="${t === next ? 'next' : t.hour < now ? 'past' : ''}"><td>${t.kind === 'high' ? ICONS.tide : ''}</td><td>${t.kind === 'high' ? 'High' : 'Low'}</td><td>${hhmm(t.hour)}</td><td>${chartHeight(t.level).toFixed(1)} m</td></tr>`).join('');
  return `<table class="tide num">${rows}</table><p class="hand small tide-note">${esc(tideWords(day, now))}</p>`;
}

function tideWords(day: number, now: number) {
  const turns = tideTurns(day);
  const lows = turns.filter((t) => t.kind === 'low');
  const big = lows.reduce<typeof lows[0] | null>((b, t) => (!b || t.level < b.level ? t : b), null);
  const sp = springness(day);
  const rising = WATER.rate > 0;
  const now0 = `Tide's ${rising ? 'making' : 'ebbing'} now, ${chartHeight(tideAt(now, day)).toFixed(1)} m.`;
  if (!big) return now0;
  const when = big.hour > now ? `Low water at ${hhmm(big.hour)}` : 'The big low has been and gone';
  const pools = chartHeight(big.level) < 0.45 ? ' Even the lowest pools will show.' : chartHeight(big.level) < 0.8 ? ' The pools will be out.' : ' A shy low; only the top pools.';
  return `${now0} ${when}.${big.hour > now ? pools : ''}${sp > 0.85 ? ' Spring tides this week.' : sp < 0.15 ? ' Neaps: lazy tides.' : ''}`;
}

/** HUD: a little arrow beside the clock, up while the tide makes, down while it ebbs. */
let chip: HTMLElement | null = null, lastDir = 0, lastLevel = '';
export function updateTideChip() {
  const clock = document.getElementById('clock');
  if (!clock) return;
  if (!chip) {
    chip = document.createElement('span');
    chip.className = 'tide-chip';
    chip.innerHTML = ICONS.tide;
    clock.appendChild(chip);
  }
  const dir = Math.abs(WATER.rate) < 0.03 ? 0 : WATER.rate > 0 ? 1 : -1;
  const level = chartHeight(WATER.y).toFixed(1);
  if (dir === lastDir && level === lastLevel) return;
  lastDir = dir; lastLevel = level;
  chip.dataset.dir = String(dir);
  const words = dir > 0 ? 'Tide rising' : dir < 0 ? 'Tide falling' : 'Slack water';
  chip.title = `${words}, ${level} m`;
  chip.setAttribute('aria-label', chip.title);
}

/** Critter plates (a studio render of the game's own model), supplied by the game. */
let plateFn: (id: string) => string | null = () => null;
export function setCritterPlates(f: (id: string) => string | null) { plateFn = f; }
export const critterPlate = (id: string) => plateFn(id);

/** Gran's shore notes: the tide-pool critters, seen or not (Log → Pages). */
export function shoreNotesHtml(plate: (id: string) => string | null) {
  const seen = ctx.save?.tidepools ?? {};
  const n = CRITTERS.filter((c) => seen[c.id]).length;
  return `<article class="gran-page shore-notes">
    <h3>Shore notes · tide pools</h3>
    <p class="hand small">${n} of ${CRITTERS.length} seen. Walk out on the rocks at low water and look in.</p>
    <ul class="critters">${CRITTERS.map((c) => {
      const k = seen[c.id];
      const img = k ? plate(c.id) : null;
      return `<li class="${k ? '' : 'unseen'}">${img ? `<img src="${img}" alt="">` : '<span class="blank" aria-hidden="true"></span>'}
        <div><b>${k ? esc(c.name) : '? ? ?'}</b><span class="small">${esc(k ? c.note : `Look in the ${c.zone}.`)}</span></div></li>`;
    }).join('')}</ul></article>`;
}
