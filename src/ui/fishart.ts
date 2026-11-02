/**
 * Fish art: the specimen plates in public/fish/ (copied from art/fish/, see its README).
 * <slug>.svg colour plate · silhouettes/<slug>.svg for uncaught entries · unknown-fish.svg fallback.
 * slug = Species.id with '_' → '-'. Plates are 512×256, facing left. Loaded as <img> so the
 * browser caches them and the JS bundle stays lean.
 */
const BASE = `${import.meta.env.BASE_URL}fish/`;
const slug = (id: string) => id.replace(/_/g, '-');
const fallback = (dir: string) => `this.onerror=null;this.src='${BASE}${dir}unknown-fish.svg'`;

function img(src: string, cls: string, alt: string, fb: string) {
  return `<img class="plate ${cls}" src="${src}" alt="${alt}" draggable="false" decoding="async" onerror="${fb}">`;
}

/** Full colour plate (catch card, journal detail, catch slip). */
export function fishSketch(id: string, _color?: string, _rarity?: string, alt = '') {
  return img(`${BASE}${slug(id)}.svg`, 'sketch-plate', alt, fallback(''));
}

/** Ink silhouette for uncaught journal entries. */
export function fishSilhouette(id: string) {
  return img(`${BASE}silhouettes/${slug(id)}.svg`, 'silhouette', '', fallback('silhouettes/'));
}

/** Small thumbnail (cooler slots, market rows). */
export function fishGlyph(id: string, _color?: string) {
  return img(`${BASE}${slug(id)}.svg`, 'thumb', '', fallback(''));
}

/** Rarity notch (shape, not colour): none · ◆ ★ */
export const rarityNotch = (r: string) => (r === 'uncommon' ? '·' : r === 'rare' ? '◆' : r === 'legendary' ? '★' : '');

/** Star row as SVG: filled = --star with ink outline; empty = dotted outline only. */
export function starsSvg(n: number, max = 3, size = 18) {
  const star = 'M12 2.6l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.9l-5.8 3.2 1.4-6.4-4.9-4.4 6.5-.7z';
  let out = '';
  for (let i = 0; i < max; i++) {
    out += i < n
      ? `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${star}" fill="#9A6A14" stroke="#2B2622" stroke-width="1.8" stroke-linejoin="round"/></svg>`
      : `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${star}" fill="none" stroke="#6B5E52" stroke-width="1.8" stroke-dasharray="1.6 2.2" stroke-linejoin="round"/></svg>`;
  }
  return `<span class="stars" role="img" aria-label="${n} of ${max} stars">${out}</span>`;
}
