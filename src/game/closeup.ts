import * as THREE from 'three';
import type { Skipper } from './skipper';
import type { ChaseCamera } from './camera';

/**
 * Strike / miss close-up (docs/camera_study.md, "authored beats are cuts"): on the hook-set and on
 * a fish that gets away, cut to the skipper's face for ~1 s (Animal Crossing's punch-in), then cut
 * back to the fishing view exactly where it was. The fishing camera sits behind him over the bow,
 * so without this the wheelhouse hides his googly "Strike!" face.
 *
 * Gameplay: the fight clock holds while the strike close-up is up (Fishing.grace): no tension, no
 * distance, no thrash timer; the reel button's held state carries straight through, so nothing the
 * player does is lost. A miss is a beat where input does not matter (the fish swims off anyway).
 *
 * Frequency ("never annoying"): Smart = the first strike of the session, every uncommon+ bite, the
 * first few commons, and misses (at most one every 15 s). Always / Off from Log → Developer.
 * Reduce motion: no cut (the over-the-shoulder glance still shows the face).
 */
export type CloseupMode = 'always' | 'smart' | 'off';
export const CLOSEUP = {
  strikeDur: 1.0, // s on the face (hook-set)
  missDur: 1.1, // s on the face (it got away)
  out: 0.15, // s ease back to the fishing view
  commons: 3, // Smart: common strikes that still get the cut
  missGap: 15, // Smart: s between miss close-ups
};
const KEY = 'salish-closeup';

export class StrikeCloseup {
  mode: CloseupMode = 'smart';
  active = false;
  kind: 'strike' | 'miss' = 'strike';
  /** stats for tests */
  shown = 0;
  private t = 0;
  private dur = 1;
  private clock = 0;
  private strikes = 0;
  private commons = 0;
  private lastMiss = -1e9;
  private side = 0;
  private eye = new THREE.Vector3();
  private at = new THREE.Vector3();
  private head = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private pose = { eye: new THREE.Vector3(), at: new THREE.Vector3(), fov: 40 };

  constructor() {
    try { const v = localStorage.getItem(KEY); if (v === 'always' || v === 'off' || v === 'smart') this.mode = v; } catch { /* private mode */ }
  }
  setMode(m: CloseupMode) { this.mode = m; try { localStorage.setItem(KEY, m); } catch { /* ignore */ } }

  /** Should this beat get the cut? (counts it either way) */
  decide(kind: 'strike' | 'miss', rarity: string | undefined, reduced: boolean): boolean {
    let go: boolean;
    if (kind === 'strike') {
      this.strikes++;
      const common = !rarity || rarity === 'common';
      if (common) this.commons++;
      go = this.mode === 'always' || (this.mode === 'smart' && (this.strikes === 1 || !common || this.commons <= CLOSEUP.commons));
    } else {
      go = this.mode === 'always' || (this.mode === 'smart' && this.clock - this.lastMiss > CLOSEUP.missGap);
      if (go) this.lastMiss = this.clock;
    }
    return go && !reduced && this.mode !== 'off';
  }

  start(kind: 'strike' | 'miss') {
    this.kind = kind;
    this.active = true;
    this.t = 0;
    this.side = 0;
    this.dur = kind === 'strike' ? CLOSEUP.strikeDur : CLOSEUP.missDur;
    this.shown++;
  }
  /** seconds the strike close-up keeps the fight clock held */
  get holdFor() { return this.dur + CLOSEUP.out; }

  stop(chase: ChaseCamera) {
    if (!this.active) return;
    this.active = false;
    chase.endCut(CLOSEUP.out);
  }

  /**
   * Per frame (real dt, after the chase camera updated). Frames head + chest + rod from a 3/4 front
   * angle a little below eye height; picks the side with a clear view (the wheelhouse and mast are
   * part of the boat, so a ray test against the hull model, not the see-through fade).
   */
  update(dt: number, skipper: Skipper, boatModel: THREE.Object3D | null, chase: ChaseCamera, aspect: number) {
    this.clock += dt;
    if (!this.active) return;
    this.t += dt;
    if (this.t >= this.dur || !skipper.head(this.head)) { this.stop(chase); return; }
    const portrait = aspect < 1;
    skipper.forward(this.fwd);
    // head + upper body in frame: ~1.0 m tall subject, a little more room in landscape for the rod
    const fov = portrait ? 46 : 36;
    const d = (portrait ? 1.05 : 0.95) / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / 0.62;
    const cand = this.side ? [this.side] : [38, -38, 58, -58, 20, -20, 80, -80];
    let chosen = cand[0];
    if (!this.side && boatModel) {
      for (const deg of cand) {
        this.place(deg, d);
        if (this.clear(boatModel, skipper)) { chosen = deg; break; }
      }
      this.side = chosen;
    }
    this.place(chosen, d);
    this.pose.eye.copy(this.eye); this.pose.at.copy(this.at); this.pose.fov = fov;
    chase.cut = this.pose;
  }

  /** eye at `deg` off his facing, slightly below head height, looking at face/chest */
  private place(deg: number, d: number) {
    const a = Math.atan2(this.fwd.x, this.fwd.z) + THREE.MathUtils.degToRad(deg);
    this.eye.set(this.head.x + Math.sin(a) * d, this.head.y - 0.22, this.head.z + Math.cos(a) * d);
    this.at.set(this.head.x, this.head.y - 0.32, this.head.z);
  }

  /** nothing of the boat between the eye and the head (his own meshes don't count) */
  private clear(boatModel: THREE.Object3D, skipper: Skipper) {
    const dir = this.tmp.copy(this.head).sub(this.eye);
    const len = dir.length();
    this.ray.set(this.eye, dir.normalize());
    this.ray.far = len - 0.25;
    const hits = this.ray.intersectObject(boatModel, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object, own = false;
      while (o) { if (o === skipper.root) { own = true; break; } o = o.parent; }
      if (!own && h.object.visible) return false;
    }
    return true;
  }
}
