import { BOAT_T0, BOAT_TUNING, type BoatTuning } from '../game/boat';
import { CAMERA_TUNING, FISH_CAM } from '../game/camera';
import { FIGHT_FX } from '../game/fishing';
import { TACKLE_TUNING } from '../game/tackle';
import { HOTSPOT_FX } from '../game/hotspots';
import { WATER_TUNE } from '../render/sea';

// water study (docs/water_study.md): sea crests, shore foam, shallows, glints, swell, wind lines
const WATER_KEY = 'salish-water-tune-v1';
const WATER_DEFAULT = { ...WATER_TUNE };
const WATER_RANGES: Record<keyof typeof WATER_TUNE, [number, number, number]> = {
  crest: [0, 1, 0.05], crestDensity: [0, 1, 0.05], crestScale: [0.5, 1.6, 0.05], crestSpeed: [0, 1.5, 0.05], crestFar: [30, 200, 5],
  shore: [0, 1, 0.05], surfPeriod: [2, 12, 0.25], surfReach: [1, 8, 0.1], shallow: [0, 1, 0.05], shallowDepth: [1, 12, 0.25],
  glint: [0, 2, 0.05], glintCone: [0.6, 0.98, 0.01], swell: [0, 0.08, 0.005], windLines: [0, 1, 1],
};

// fishing polish (docs/study/fishing_polish.md): camera framing/juice, fight VFX, float, spot marker
const FISH_KEY = 'salish-fish-tune-v1';
const FISH_DEFAULT = { cam: { ...FISH_CAM }, fx: { ...FIGHT_FX }, tackle: { ...TACKLE_TUNING }, spot: { ...HOTSPOT_FX } };
const FISH_CAM_RANGES: Record<keyof typeof FISH_CAM, [number, number, number]> = {
  frame: [0, 1, 0.02], sideOn: [0, 90, 1], sideOnPortrait: [0, 90, 1], sideBlend: [0, 1, 0.05], zoomFar: [0.5, 1.3, 0.01], zoomNear: [0.4, 1.2, 0.01],
  punch: [0, 1.5, 0.05], fovPunch: [0, 10, 0.5], shake: [0, 0.3, 0.01], lean: [0, 3, 0.1], landDist: [2, 10, 0.1], landSide: [0, 80, 1], landFov: [30, 70, 1], landIn: [0.2, 2, 0.05],
};
const FIGHT_RANGES: Record<keyof typeof FIGHT_FX, [number, number, number]> = {
  thrashDisc: [0.05, 0.6, 0.01], shedRate: [0.02, 0.4, 0.01], shedTension: [0, 1, 0.05], leapChance: [0, 1, 0.05], leapHeight: [0.2, 2.5, 0.05], landArc: [0.2, 1.5, 0.02], fishScale: [0.5, 3, 0.05], minShow: [0.1, 0.8, 0.02],
};
const TACKLE_RANGES: Record<keyof typeof TACKLE_TUNING, [number, number, number]> = { bobberScale: [0.5, 3, 0.05], screenFloor: [5, 30, 0.5], lineWidth: [0.0005, 0.006, 0.0001] };
const SPOT_RANGES: Record<keyof typeof HOTSPOT_FX, [number, number, number]> = { churn: [0.3, 2, 0.05], clearR: [0, 3, 0.05], drawDist: [60, 500, 10] };

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
  try {
    const f = JSON.parse(localStorage.getItem(FISH_KEY) ?? '{}');
    Object.assign(FISH_CAM, f.cam ?? {}); Object.assign(FIGHT_FX, f.fx ?? {}); Object.assign(TACKLE_TUNING, f.tackle ?? {}); Object.assign(HOTSPOT_FX, f.spot ?? {});
  } catch { /* ignore */ }
  try { Object.assign(WATER_TUNE, JSON.parse(localStorage.getItem(WATER_KEY) ?? '{}')); } catch { /* ignore */ }
  const saveFish = () => localStorage.setItem(FISH_KEY, JSON.stringify({ cam: FISH_CAM, fx: FIGHT_FX, tackle: TACKLE_TUNING, spot: HOTSPOT_FX }));

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
  btn('reset', () => {
    Object.assign(BOAT_TUNING, BOAT_T0); Object.assign(CAMERA_TUNING, CAM_DEFAULT);
    Object.assign(FISH_CAM, FISH_DEFAULT.cam); Object.assign(FIGHT_FX, FISH_DEFAULT.fx); Object.assign(TACKLE_TUNING, FISH_DEFAULT.tackle); Object.assign(HOTSPOT_FX, FISH_DEFAULT.spot); Object.assign(WATER_TUNE, WATER_DEFAULT);
    localStorage.removeItem(WATER_KEY); localStorage.removeItem(KEY); localStorage.removeItem(CAM_KEY); localStorage.removeItem(FISH_KEY); render();
  });
  btn('copy', () => { navigator.clipboard?.writeText(JSON.stringify({ BOAT_TUNING, CAMERA_TUNING, FISH_CAM, FIGHT_FX, TACKLE_TUNING, HOTSPOT_FX, WATER_TUNE }, null, 2)).catch(() => {}); });
  panel.append(head, body);

  function section(title: string, obj: Record<string, number>, ranges: Record<string, [number, number, number]>, key: string | (() => void)) {
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
        if (typeof key === 'string') localStorage.setItem(key, JSON.stringify(obj)); else key();
      };
      row.append(document.createTextNode(k), val, input);
      body.appendChild(row);
    }
  }
  function render() {
    body.innerHTML = '';
    section('Boat', BOAT_TUNING as unknown as Record<string, number>, RANGES, KEY);
    section('Camera', CAMERA_TUNING as Record<string, number>, CAM_RANGES, CAM_KEY);
    section('Fishing camera', FISH_CAM as Record<string, number>, FISH_CAM_RANGES, saveFish);
    section('Fight FX', FIGHT_FX as Record<string, number>, FIGHT_RANGES, saveFish);
    section('Float + line', TACKLE_TUNING as Record<string, number>, TACKLE_RANGES, saveFish);
    section('Fishing spot', HOTSPOT_FX as Record<string, number>, SPOT_RANGES, saveFish);
    section('Water', WATER_TUNE as Record<string, number>, WATER_RANGES, WATER_KEY);
  }
  render();
  document.body.appendChild(panel);
}
