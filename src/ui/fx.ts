/**
 * ui.fx(name): the single place for UI sound + haptics (ui_design §3.7).
 * Sounds come from the game audio engine (src/audio, UI bus); haptics use navigator.vibrate,
 * feature-detected (Android only in practice); the design never relies on them.
 * Fishing beats (nibble / bite / strain / slip / catch) are voiced in the world by src/audio
 * from the fishing events, so here they are haptics only.
 */
import { prefs } from './prefs';
import { gameAudio } from '../audio';

export type FxName = 'tap' | 'nibble' | 'bite' | 'strain' | 'slip' | 'catch' | 'stamp' | 'sell' | 'page' | 'reveal'
  | 'open' | 'close' | 'buy' | 'upgrade' | 'paint' | 'discover' | 'quest' | 'refuse';

const HAPTIC: Partial<Record<FxName, number | number[]>> = {
  nibble: [12], bite: [40, 30, 40], strain: [8], slip: [80], stamp: [25], sell: [10, 20, 10], buy: [15], upgrade: [20, 30, 20],
};
/** world-voiced: no UI sound */
const WORLD: Partial<Record<FxName, true>> = { nibble: true, bite: true, strain: true, slip: true, catch: true };

export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/** Fire a UI feedback event. `v` is an optional intensity 0..1 (used by strain). */
export function fx(name: FxName, v = 0) {
  void v;
  if (prefs.vibration && canVibrate && HAPTIC[name]) {
    try { navigator.vibrate(HAPTIC[name]!); } catch { /* ignore */ }
  }
  if (WORLD[name]) return;
  try { gameAudio.ui(name); } catch { /* ignore */ }
}
