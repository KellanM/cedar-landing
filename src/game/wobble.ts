/**
 * Friendslop "goofiness" (docs/character_study.md, Friendslop): one global factor read by the spring bones
 * (hat, scarf), the landing / hop squash, the on-foot arm swing and the NPC idle sway.
 * 0 = rigid-ish, 1 = default gentle, 2 = full friendslop. Dev tab → Wobble.
 */
export const WOBBLE = { k: 1 };
const KEY = 'cedar-wobble';
try { const v = Number(localStorage.getItem(KEY)); if (Number.isFinite(v) && localStorage.getItem(KEY) !== null) WOBBLE.k = Math.max(0, Math.min(2, v)); } catch { /* ignore */ }
export function setWobble(k: number) {
  WOBBLE.k = Math.max(0, Math.min(2, k));
  try { localStorage.setItem(KEY, String(WOBBLE.k)); } catch { /* ignore */ }
}
