/**
 * Map glyphs by kind (docs/map_study.md §icons). One 24×24 path set drives both the canvas chart and the
 * Places list SVGs, so the list reads as a legend for the map. Shapes borrow chart conventions
 * (wreck = hull with masts, rock = cross, light = flare) and otherwise stay abstract.
 */
import type { Place } from './chart';

export type Glyph = 'town' | 'island' | 'stone' | 'cairn' | 'beacon' | 'wreck' | 'kelp' | 'rock' | 'pots' | 'mark' | 'fish';

const INK = '#2B2622', PAPER = '#F4EFE3', OCHRE = '#9E3B2A', CEDAR = '#B5643C', GOLD = '#BFA46A', TEAL = '#2E5E63', KELP = '#4F6B4A';

/** [path, fill, stroke, strokeWidth] */
type Part = [string, string | null, string | null, number];
export const GLYPHS: Record<Glyph, Part[]> = {
  town: [
    ['M2.5 21V12l5.5-4.5 5.5 4.5v9z', CEDAR, INK, 1.8],
    ['M11 21v-7.5l5.25-4.3 5.25 4.3V21z', PAPER, INK, 1.8],
    ['M6.5 21v-4h3v4', null, INK, 1.4],
  ],
  island: [['M2.5 18c3-6 6-9 9.5-9s6.5 3 9.5 9z', KELP, INK, 1.8]],
  stone: [
    ['M7.5 21.5c-1.4-6.5.3-13.5 4.5-17 4.2 3.5 5.9 10.5 4.5 17z', GOLD, INK, 1.8],
    ['M9.6 12.5h4.8M12 10v5', null, OCHRE, 1.8],
  ],
  cairn: [
    ['M5 20a7 2.6 0 1 0 14 0a7 2.6 0 1 0-14 0z', GOLD, INK, 1.6],
    ['M7.5 14.6a4.5 2.3 0 1 0 9 0a4.5 2.3 0 1 0-9 0z', GOLD, INK, 1.6],
    ['M9.7 9.6a2.3 1.9 0 1 0 4.6 0a2.3 1.9 0 1 0-4.6 0z', GOLD, INK, 1.6],
  ],
  beacon: [
    ['M12 15.5C9 12 8.6 6.6 12 2c3.4 4.6 3 10-0 13.5z', OCHRE, INK, 1.5],
    ['M9 22l1.2-5h3.6l1.2 5z', PAPER, INK, 1.6],
  ],
  wreck: [
    ['M2.5 14.5h19', null, INK, 2.4],
    ['M7.5 10v9M12 8.5v12M16.5 10v9', null, INK, 1.8],
  ],
  kelp: [['M7.5 21c-2.2-4 2.2-6.5 0-10.5S9 4.5 8 3M12 21c-2.2-5 2.4-7.5 0-12S14 4 13 2.5M16.5 21c-2.2-4 2.2-6.5 0-10s1-5 0-6.5', null, KELP, 2]],
  rock: [['M12 4.5v15M4.5 12h15M6.8 6.8l10.4 10.4M17.2 6.8 6.8 17.2', null, INK, 1.9]],
  pots: [
    ['M12 3v5', null, INK, 1.8],
    ['M7.5 8.5h9l-1.2 8.5H8.7z', CEDAR, INK, 1.7],
    ['M3.5 21c2.5-1.7 5-1.7 8.5 0s6 1.7 8.5 0', null, TEAL, 1.8],
  ],
  mark: [
    ['M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0z', PAPER, INK, 1.8],
    ['M10.6 12a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0z', INK, null, 0],
  ],
  fish: [
    ['M2.5 12c3-4.2 9.5-5.2 14-1.4l4.5-3.1v9l-4.5-3.1c-4.5 3.8-11 2.8-14-1.4z', TEAL, null, 0],
    ['M6.2 11.3a1 1 0 1 0 2 0a1 1 0 1 0-2 0z', PAPER, null, 0],
  ],
};

export function glyphFor(p: Pick<Place, 'kind' | 'name'>): Glyph {
  if (p.kind === 'town') return 'town';
  if (p.kind === 'island') return 'island';
  if (p.kind === 'stone') return 'stone';
  const n = p.name.toLowerCase();
  if (/crab pots?\b/.test(n)) return 'pots';
  if (/beacon|light/.test(n)) return 'beacon';
  if (/camp|shack|cabin|hut|house/.test(n)) return 'mark';
  if (/cairn/.test(n)) return 'cairn';
  if (/piling|cannery|barge|wreck|hulk|dock|wharf|mill/.test(n)) return 'wreck';
  if (/kelp|tangle|mangrove|weed|eelgrass/.test(n)) return 'kelp';
  if (/rock|ledge|knob|arch|bluff|spire|reef|bar\b|shoal|stack/.test(n)) return 'rock';
  return 'mark';
}

const cache = new Map<string, Path2D>();
const path = (d: string) => { let p = cache.get(d); if (!p) cache.set(d, (p = new Path2D(d))); return p; };

/** Draw a glyph centred at (x,y), `size` device px across. */
export function drawGlyph(g: CanvasRenderingContext2D, kind: Glyph, x: number, y: number, size: number, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x - size / 2, y - size / 2);
  g.scale(size / 24, size / 24);
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const [d, fill, stroke, w] of GLYPHS[kind]) {
    const p = path(d);
    if (fill) { g.fillStyle = fill; g.fill(p); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = w; g.stroke(p); }
  }
  g.restore();
}

export function glyphSvg(kind: Glyph) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[kind].map(([d, f, s, w]) => `<path d="${d}" fill="${f ?? 'none'}"${s ? ` stroke="${s}" stroke-width="${w}"` : ''}/>`).join('')}</svg>`;
}
