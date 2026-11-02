import { BOAT_T0, BOAT_TUNING, type BoatTuning } from '../game/boat';
import { CAMERA_TUNING } from '../game/camera';

const CAM_DEFAULT = { ...CAMERA_TUNING };
const CAM_KEY = 'salish-cam-tune-v1';
const CAM_RANGES: Record<keyof typeof CAMERA_TUNING, [number, number, number]> = {
  distance: [6, 30, 0.5], distSpeed: [0, 8, 0.25], pitchDeg: [15, 75, 1], sideDeg: [-60, 60, 1], frameAhead: [0, 10, 0.25],
  followSlow: [0, 2, 0.05], followTurn: [0.1, 3, 0.05], turnPersist: [0, 2, 0.05], idleReturn: [0.5, 8, 0.25],
  fovPortrait: [35, 80, 1], fovLandscape: [30, 70, 1], fishZoom: [0.5, 1, 0.02], minDistance: [0.3, 1, 0.02],
};

const KEY = 'salish-boat-tune-v1';
const RANGES: Record<keyof BoatTuning, [number, number, number]> = {
  maxSpeed: [1, 14, 0.1], maxReverse: [0.5, 6, 0.1], accel: [1, 20, 0.1], brake: [1, 30, 0.5],
  coastDrag: [0, 2, 0.01], turnRate: [0.3, 3, 0.05], pivotTurn: [0, 1, 0.05], turnResponse: [1, 20, 0.5],
  grip: [0.5, 20, 0.25], deadzone: [0, 0.4, 0.01], expo: [1, 3, 0.05],
  camLookAhead: [0, 12, 0.25], camPullBack: [0, 8, 0.25], camFovBoost: [0, 15, 0.5], radius: [0.5, 3, 0.05],
};

/**
 * `?tune` debug overlay: one slider per BOAT_TUNING constant, edited live. Values persist in
 * localStorage (only applied when ?tune is in the URL); "copy" puts the JSON on the clipboard.
 */
export function initTuneOverlay() {
  if (!new URLSearchParams(location.search).has('tune')) return;
  try { Object.assign(BOAT_TUNING, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* ignore */ }
  try { Object.assign(CAMERA_TUNING, JSON.parse(localStorage.getItem(CAM_KEY) ?? '{}')); } catch { /* ignore */ }

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:8px;top:120px;z-index:50;max-height:60vh;overflow:auto;background:rgba(20,28,32,.82);color:#eef;font:11px/1.2 system-ui,sans-serif;padding:6px 8px;border-radius:8px;width:210px;touch-action:pan-y;';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;';
  head.innerHTML = '<b style="flex:1">Boat + camera</b>';
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:11px system-ui;padding:2px 6px;border-radius:5px;border:0;background:#cdd6d9;';
    b.onclick = fn;
    head.appendChild(b);
    return b;
  };
  const body = document.createElement('div');
  btn('–', () => { body.style.display = body.style.display === 'none' ? '' : 'none'; });
  btn('reset', () => { Object.assign(BOAT_TUNING, BOAT_T0); Object.assign(CAMERA_TUNING, CAM_DEFAULT); localStorage.removeItem(KEY); localStorage.removeItem(CAM_KEY); render(); });
  btn('copy', () => { navigator.clipboard?.writeText(JSON.stringify({ BOAT_TUNING, CAMERA_TUNING }, null, 2)).catch(() => {}); });
  panel.append(head, body);

  function section(title: string, obj: Record<string, number>, ranges: Record<string, [number, number, number]>, key: string) {
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'margin:6px 0 2px;font-weight:600;opacity:.85;';
    body.appendChild(h);
    for (const k of Object.keys(ranges)) {
      const [min, max, step] = ranges[k];
      const row = document.createElement('label');
      row.style.cssText = 'display:block;margin:3px 0;';
      const val = document.createElement('span');
      val.style.cssText = 'float:right;opacity:.8';
      val.textContent = String(obj[k]);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(obj[k]);
      input.style.cssText = 'width:100%;margin:1px 0 0;';
      input.oninput = () => {
        obj[k] = Number(input.value);
        val.textContent = input.value;
        localStorage.setItem(key, JSON.stringify(obj));
      };
      row.append(document.createTextNode(k), val, input);
      body.appendChild(row);
    }
  }
  function render() {
    body.innerHTML = '';
    section('Boat', BOAT_TUNING as unknown as Record<string, number>, RANGES, KEY);
    section('Camera', CAMERA_TUNING as Record<string, number>, CAM_RANGES, CAM_KEY);
  }
  render();
  document.body.appendChild(panel);
}
