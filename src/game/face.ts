import * as THREE from 'three';
import { MOTION, WOBBLE } from './wobble';

/**
 * Expression overlays shared by the skipper and the NPCs (docs/character_study.md, Friendslop phase 2).
 *
 * The skinned body carries the baked Animal Crossing neutral face (bean eyes + catchlight, blush, small smile).
 * Every other expression is a small mesh bone-parented to `head` (exported by parts/scripts_people/faceset.py,
 * node name `<character>_face_<name>`, extras face=<name>): skin covers over the baked eyes/mouth + the new
 * features. At most one is visible, so neutral costs no draw call and an expression costs one.
 *   bean (AC):          neutral (baked), blink, happy
 *   googly (Peak/REPO): surprised, effort, worried, sad, joy
 * A swap "pops" the overlay (a quick, well-damped scale spring about the face centre) and googly eyes jiggle
 * for ~0.6 s after the change; then the face holds still.
 * Neutral blinks every 2.5–6 s.
 */
export type Expr = 'neutral' | 'blink' | 'happy' | 'laugh' | 'surprised' | 'effort' | 'worried' | 'sad' | 'joy' | 'grumpy';
const FALLBACK: Record<Expr, Expr[]> = {
  neutral: [], blink: [], happy: [], laugh: ['happy'], surprised: ['happy'], effort: ['surprised'], worried: ['surprised'], sad: ['surprised'], joy: ['happy'], grumpy: ['worried'],
};

export class FaceRig {
  private sets = new Map<Expr, THREE.Object3D>();
  private want: Expr = 'neutral';
  private shown: Expr = 'neutral';
  private blinkT: number;
  private blinkLeft = 0;
  private pop = 0; private popV = 0;
  private t = 0;
  /** seconds since the last expression change (the googly jiggle only lives just after a change) */
  private since = 99;
  /** each overlay's rest transform + the centre of its geometry (local): the pop / jiggle scale about the
   *  face itself, not the node origin (which sits at the armature origin, ~1.3 m away, so scaling about it
   *  slid the whole face up and down) */
  private rest = new Map<THREE.Object3D, { pos: THREE.Vector3; scale: THREE.Vector3; c: THREE.Vector3 }>();
  constructor(root: THREE.Object3D, seed = Math.random()) {
    root.traverse((o) => {
      const name = (o.userData?.face as string | undefined) ?? /_face_([a-z]+)(?:_\d+)?$/.exec(o.name)?.[1];
      if (!name || !(o as THREE.Mesh).isMesh && !o.children.some((c) => (c as THREE.Mesh).isMesh)) return;
      if (!this.sets.has(name as Expr)) { this.sets.set(name as Expr, o); o.visible = false; }
    });
    for (const o of this.sets.values()) {
      const box = new THREE.Box3();
      o.traverse((m) => { const g = (m as THREE.Mesh).geometry; if (!g) return; g.computeBoundingBox(); const bb = g.boundingBox!.clone(); if (m !== o) bb.applyMatrix4(m.matrix); box.union(bb); });
      this.rest.set(o, { pos: o.position.clone(), scale: o.scale.clone(), c: box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()) });
    }
    this.blinkT = 2 + seed * 3;
  }
  get has() { return this.sets.size > 0; }
  /** the expression the character should show (resolved to an available overlay) */
  set(e: Expr) { this.want = e; }
  get current() { return this.want; }
  /** test probe: the overlay on screen (null while the baked neutral face shows) */
  get shownName() { return this.shown; }
  shownObject() { return this.sets.get(this.shown) ?? null; }
  anyObject() { return this.sets.values().next().value ?? null; }
  private resolve(e: Expr): Expr {
    if (e === 'neutral' || this.sets.has(e)) return e;
    for (const f of FALLBACK[e]) if (this.sets.has(f)) return f;
    return 'neutral';
  }
  update(dt: number) {
    if (!this.sets.size) return;
    this.t += dt;
    let e = this.resolve(this.want);
    // AC blink while neutral / content
    if (e === 'neutral') {
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blinkLeft = 0.12; this.blinkT = 2.5 + Math.random() * 3.5; }
      if (this.blinkLeft > 0) { this.blinkLeft -= dt; if (this.sets.has('blink')) e = 'blink'; }
    }
    if (e !== this.shown) {
      const prev = this.sets.get(this.shown); if (prev) prev.visible = false;
      const next = this.sets.get(e); if (next) next.visible = true;
      if (e !== 'blink' && this.shown !== 'blink' && !MOTION.reduced) this.popV += 9 * WOBBLE.k; // the swap pops (not for blinks; not with Reduce motion)
      this.shown = e;
      if (e !== 'blink') this.since = 0;
    }
    this.since += dt;
    // pop spring + googly wobble, on the visible overlay only
    // (semi-implicit, sub-stepped so a long frame can't pump energy in; settles in ~0.4 s)
    for (let left = Math.min(dt, 0.1); left > 1e-6; left -= 1 / 60) {
      const h = Math.min(left, 1 / 60);
      this.popV += (-2 * 0.45 * 16 * this.popV - 16 * 16 * this.pop) * h;
      this.pop += this.popV * h;
    }
    if (Math.abs(this.pop) < 1e-4 && Math.abs(this.popV) < 1e-3) { this.pop = 0; this.popV = 0; }
    const o = this.sets.get(this.shown);
    if (o) {
      const googly = this.shown !== 'blink' && this.shown !== 'happy' && this.shown !== 'laugh';
      // googly jiggle: a short decaying shake right after the change (0.6 s), then still
      const env = this.since < 0.6 ? (1 - this.since / 0.6) ** 2 : 0;
      const wob = googly && !MOTION.reduced ? Math.sin(this.since * 26) * 0.03 * WOBBLE.k * env : 0;
      const s = 1 + this.pop * 0.12;
      const r = this.rest.get(o)!;
      o.scale.set(r.scale.x * (s + wob), r.scale.y * (s - wob), r.scale.z * s);
      // keep the face centre where it was: pos = rest + R·(S0·c − S·c)
      o.position.set(r.c.x * r.scale.x * (1 - (s + wob)), r.c.y * r.scale.y * (1 - (s - wob)), r.c.z * r.scale.z * (1 - s)).applyQuaternion(o.quaternion).add(r.pos);
    }
  }
}
