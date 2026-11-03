/**
 * Two-tone flat icon set (ui_design §3.5): 2px ink outline on a 24px grid + one accent fill,
 * chunky round joins. Inline SVG strings so they inherit layout and cost no requests.
 */
const INK = '#2B2622';
const PAPER = '#F4EFE3';
const CEDAR = '#B5643C';
const OCHRE = '#9E3B2A';
const TEAL = '#2E5E63';
const KELP = '#4F6B4A';
const GOLD = '#BFA46A';
const SHELL = '#E7B48C';

const s = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" aria-hidden="true" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  /** cockle shell — the currency */
  shell: s(`<path d="M12 3.2c-4.7 0-8.6 3.5-8.9 8.1-.1.9.4 1.6 1.2 1.8L12 20.8l7.7-7.7c.8-.2 1.3-.9 1.2-1.8C20.6 6.7 16.7 3.2 12 3.2z" fill="${SHELL}"/><path d="M12 4.5v15M8.2 5.6 10.3 19M15.8 5.6 13.7 19M5 8.6l5.6 10.5M19 8.6l-5.6 10.5" stroke-width="1.2"/>`),
  /** cedar cooler box with rope handles */
  cooler: s(`<rect x="3" y="8" width="18" height="12" rx="2" fill="${CEDAR}"/><path d="M3 12h18"/><path d="M8 8c0-2.5 1.6-4 4-4s4 1.5 4 4" stroke-width="1.8"/>`),
  /** the logbook */
  log: s(`<path d="M5 3.5h12.5a1.5 1.5 0 0 1 1.5 1.5v15a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 19.5z" fill="${OCHRE}"/><path d="M5 17.5h14"/><path d="M8.5 7.5h7M8.5 10.5h5" stroke="${PAPER}"/><path d="M15 3.5v6l1.5-1.2 1.5 1.2v-6" fill="${GOLD}" stroke-width="1.6"/>`),
  /** folded chart */
  map: s(`<path d="M3 6l6-2.5 6 2.5 6-2.5v14.5L15 20.5 9 18l-6 2.5z" fill="${PAPER}"/><path d="M9 3.5V18M15 6v14.5"/><path d="M11 10.5c1.2-1 2.4.8 3.6-.2" stroke="${TEAL}" stroke-width="1.6"/>`),
  /** brass compass rose (trigon points) */
  compass: s(`<circle cx="12" cy="12" r="9" fill="${GOLD}"/><path d="M12 4.5 14 12h-4z" fill="${OCHRE}"/><path d="M12 19.5 10 12h4z" fill="${PAPER}"/><circle cx="12" cy="12" r="1.2" fill="${INK}"/>`),
  rod: s(`<path d="M4 20 19 4" stroke-width="2.4"/><circle cx="7.5" cy="16.5" r="2.6" fill="${CEDAR}"/><path d="M19 4c1.6 4.5 1.4 8.6-.5 12" stroke-width="1.2"/><circle cx="18.5" cy="17" r="1.4" fill="${OCHRE}"/>`),
  hook: s(`<path d="M14 3v11a4.5 4.5 0 0 1-9 0v-2l2.5 2" stroke-width="2.2"/><circle cx="14" cy="3.5" r="1.4" fill="${GOLD}"/>`),
  paddle: s(`<path d="M5 19 15 9" stroke-width="2.4"/><path d="M14 10c-1-3 .5-6.5 3.5-7.5s4.5 1 3.5 3.5-4.5 5-7 4z" fill="${CEDAR}"/><path d="M3.5 20.5 6 18" stroke-width="3"/>`),
  /** cleat — tie up */
  cleat: s(`<path d="M3 13c0-1.7 2-2.5 4-2.5h10c2 0 4 .8 4 2.5" fill="${GOLD}"/><path d="M9 10.5V8M15 10.5V8"/><path d="M3 13h18v2H3z" fill="${CEDAR}"/><path d="M6 19c3-1.2 9-1.2 12 0" stroke="${TEAL}" stroke-dasharray="2 2"/>`),
  /** speech leaf — talk */
  talk: s(`<path d="M4 12c0-5 4-8 9-8 3.6 0 6.5 2.6 6.5 6.6 0 4.6-4 7.4-8.5 7.4-1.4 0-2.6-.2-3.6-.6L4 20l1.3-3.6C4.5 15.2 4 13.7 4 12z" fill="${KELP}"/><path d="M8 12c2.4-1.6 5-1.8 8-1" stroke="${PAPER}" stroke-width="1.6"/>`),
  /** ship's wheel — settings */
  wheel: s(`<circle cx="12" cy="12" r="6.2" fill="${CEDAR}"/><circle cx="12" cy="12" r="2.2" fill="${GOLD}"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>`),
  sun: s(`<circle cx="12" cy="12" r="4.5" fill="#E6B54A"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>`),
  sunbreak: s(`<circle cx="9" cy="9" r="4" fill="#E6B54A"/><path d="M9 2v1.6M2 9h1.6M4 4l1.1 1.1M14 4l-1.1 1.1"/><path d="M8 19.5h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.6A2.8 2.8 0 0 0 8 19.5z" fill="${PAPER}"/>`),
  cloud: s(`<path d="M6.5 18.5h11a4 4 0 0 0 .3-8 6 6 0 0 0-11.3 1.7 3.2 3.2 0 0 0 0 6.3z" fill="${PAPER}"/>`),
  fog: s(`<path d="M3 8h14M6 12h15M3 16h13M8 20h10" stroke-width="2.2"/>`),
  rain: s(`<path d="M6.5 14.5h11a4 4 0 0 0 .3-8 6 6 0 0 0-11.3 1.7 3.2 3.2 0 0 0 0 6.3z" fill="${PAPER}"/><path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3" stroke="${TEAL}"/>`),
  storm: s(`<path d="M6.5 13.5h11a4 4 0 0 0 .3-8 6 6 0 0 0-11.3 1.7 3.2 3.2 0 0 0 0 6.3z" fill="#B9C0C2"/><path d="M12.5 13.5 10 18h3l-2 4.5" stroke="#E6B54A" stroke-width="2"/>`),
  dusk: s(`<path d="M5 16a7 7 0 0 1 14 0z" fill="#E59A5C"/><path d="M2.5 16h19M5 20h14M12 4.5V7M5.5 8l1.4 1.4M18.5 8l-1.4 1.4"/>`),
  moon: s(`<path d="M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5z" fill="#E8DFC4"/><path d="M17 4.5v3M15.5 6h3" stroke-width="1.5"/>`),
  /** tide arrow */
  tide: s(`<path d="M3 15c2.2-1.6 3.8-1.6 6 0s3.8 1.6 6 0 3.8-1.6 6 0" stroke="${TEAL}"/><path d="M12 3v8M8.5 6.5 12 3l3.5 3.5"/>`),
  check: s(`<path d="M4.5 12.5l4.5 4.5 10.5-11" stroke="${KELP}" stroke-width="3"/>`),
  warn: s(`<path d="M12 3.5 21 19.5H3z" fill="#E6B54A"/><path d="M12 9.5v4.5M12 16.8v.2" stroke-width="2.4"/>`),
  pencil: s(`<path d="M4 20l1.2-4.6L16 4.6a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z" fill="${GOLD}"/><path d="M14 6.6l3.4 3.4M4 20l4.6-1.2"/>`),
  back: s(`<path d="M15 4.5 7.5 12l7.5 7.5" stroke-width="2.6"/>`),
  close: s(`<path d="M6 6l12 12M18 6 6 18" stroke-width="2.6"/>`),
  page: s(`<path d="M6 3h9l4 4v14H6z" fill="${PAPER}"/><path d="M15 3v4h4"/><path d="M9 11h7M9 14h7M9 17h4" stroke-width="1.5"/>`),
  fish: s(`<path d="M3 12c3-4.5 9.5-5.5 14-1.5l4-3v9l-4-3c-4.5 4-11 3-14-1.5z" fill="${TEAL}"/><circle cx="7.2" cy="11.2" r="1" fill="${INK}" stroke="none"/>`),
  boat: s(`<path d="M2.5 13.5h19c-1.6 3.5-4.6 5-9.5 5s-7.9-1.5-9.5-5z" fill="${CEDAR}"/><path d="M12 13.5V4l6 7.5h-6" fill="${PAPER}"/>`),
  basket: s(`<path d="M4 10h16l-2 10H6z" fill="${GOLD}"/><path d="M7 10c0-3.5 2.2-6 5-6s5 2.5 5 6M5 14h14"/>`),
  photo: s(`<rect x="3" y="7" width="18" height="13" rx="2" fill="${TEAL}"/><circle cx="12" cy="13.5" r="3.6" fill="${PAPER}"/><path d="M8 7l1.5-2.5h5L16 7"/>`),
  land: s(`<path d="M2.5 18c3-6 6-9 9.5-9s6.5 3 9.5 9z" fill="${KELP}"/><path d="M12 9V4l4 1.6L12 7"/>`),
  stone: s(`<path d="M5 20c-1-6 1.5-14 7-15.5 5 .8 7.5 8.8 7 15.5z" fill="${GOLD}"/><path d="M9.5 12a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0-5 0M12 7.5v1.5M12 15v1.5" stroke-width="1.5"/>`),
  dive: s(`<path d="M4 12a8 8 0 0 1 16 0z" fill="${OCHRE}"/><path d="M12 12v8M8.5 20h7"/>`),
  rest: s(`<path d="M5 19l14-5M5 14l14 5" stroke="${CEDAR}" stroke-width="2.6"/><path d="M12 4c2.5 2.5 3 4.5 1 7-1-1.5-2.4-1.6-3-3 0-1.6.8-2.6 2-4z" fill="#E59A5C"/>`),
  wave: s(`<path d="M3 12c2.2-2 3.8-2 6 0s3.8 2 6 0 3.8-2 6 0" stroke="${TEAL}" stroke-width="2.4"/><path d="M3 17c2.2-2 3.8-2 6 0s3.8 2 6 0 3.8-2 6 0" stroke="${TEAL}" stroke-width="1.6"/>`),
};

/** Fill every `[data-icon]` placeholder under `root` with its SVG. */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const k = el.dataset.icon!;
    if (el.dataset.iconDone === k) return;
    el.innerHTML = ICONS[k] ?? '';
    el.dataset.iconDone = k;
  });
}

export const icon = (k: string, cls = 'ico') => `<span class="${cls}" aria-hidden="true">${ICONS[k] ?? ''}</span>`;

/** Interact kind → icon. */
export function iconForKind(kind: string) {
  if (kind === 'sell_fish' || kind === 'weigh_fish' || kind === 'smokehouse_trade') return 'shell';
  if (kind === 'moor_boat' || kind === 'hop_in') return 'cleat';
  if (kind === 'talk' || kind === 'trade_rumours' || kind === 'story_evening') return 'talk';
  if (kind.startsWith('buy_') || kind === 'canoe_maker' || kind === 'upgrade_bench') return 'basket';
  if (kind === 'photo' || kind === 'photograph' || kind === 'telescope' || kind === 'look_out' || kind === 'climb_lookout') return 'photo';
  if (kind === 'land_here') return 'land';
  if (kind === 'read_sunstone' || kind.startsWith('quest') || kind === 'read_message_bottle' || kind === 'read_warning') return 'stone';
  if (kind === 'dive_here') return 'dive';
  if (kind === 'rest' || kind === 'sit' || kind === 'nap' || kind === 'save_bed') return 'rest';
  if (kind === 'forage' || kind === 'forage_saltmarsh' || kind === 'clam_garden' || kind === 'collect_flotsam') return 'basket';
  return 'compass';
}
