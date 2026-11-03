import * as THREE from 'three';
import { CAMERA_COMFORT, type ChaseCamera } from './camera';
import type { OnFoot } from './onfoot/onfoot';
import type { Boat } from './boat';
import type { LoadedWorld } from '../world/types';
import type { Tides } from './tides';
import { prefs } from '../ui/prefs';

/**
 * Per-frame camera glue kept out of main.ts (docs/camera_study.md): comfort settings, the harbour
 * framing hint, the tide-flats hint and the see-through subject.
 */

const HARBOUR_KINDS = new Set(['moor_boat', 'sell_fish']);
const harbourV = new THREE.Vector3();
let harbours: THREE.Vector3[] = [];
let harbourWorld: LoadedWorld | null = null;

export interface CamFrameCtx { chase: ChaseCamera; foot: OnFoot; boat: Boat; world: LoadedWorld | null; tides: Tides; reduce: boolean }

export function cameraFrame(c: CamFrameCtx) {
  // Settings → Reduce motion / Camera re-centre (0 = off)
  CAMERA_COMFORT.reduced = c.reduce;
  const rc = prefs.recentre ?? 4;
  CAMERA_COMFORT.autoCentre = rc > 0;
  if (rc > 0) CAMERA_COMFORT.delay = rc;
  // harbour hint: the nearest mooring / market within 50 m (a cue the aim leans toward; the heading stays free)
  if (c.world !== harbourWorld) {
    harbourWorld = c.world;
    harbours = (c.world?.gameplay.interacts ?? []).filter((i) => HARBOUR_KINDS.has(i.kind)).map((i) => new THREE.Vector3(i.pos[0], 0, i.pos[2]));
  }
  let best: THREE.Vector3 | null = null, bd = 50;
  for (const h of harbours) {
    const d = Math.hypot(h.x - c.boat.pos.x, h.z - c.boat.pos.z);
    if (d < bd) { bd = d; best = h; }
  }
  c.chase.harbour = best ? harbourV.copy(best) : null;
  // tide flats: on foot near an exposed pool, look down at the rocks a little more
  if (c.foot.active) {
    const f = c.foot.feet;
    c.foot.cam.flats = c.tides.pools?.nearest(f.x, f.y, f.z, 7) ? 1 : 0;
  }
}

const subV = new THREE.Vector3();
/** Who the see-through cut-out keeps visible this frame (null = off). */
export function cameraSubject(c: { chase: ChaseCamera; foot: OnFoot; boat: Boat; titleOpen: boolean; debugCam: boolean }): { at: THREE.Vector3; r: number } | null {
  if (c.titleOpen || c.debugCam || c.chase.inShot || document.body.classList.contains('photo-mode')) return null;
  if (c.foot.active) { const r = c.foot.cam.subject(subV); return { at: subV, r }; }
  if (c.chase.landingK > 0.3) return null; // the hold-up shot frames the skipper on the deck
  subV.set(c.boat.pos.x, c.boat.root.position.y + 1.1, c.boat.pos.z);
  return { at: subV, r: Math.max(2.4, c.boat.halfLen * 1.05) };
}
