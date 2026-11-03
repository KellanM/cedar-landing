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
 * A swap "pops" the overlay (a quick scale spring) and the googly eyes wobble a little while they are up.
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
  constructor(root: THREE.Object3D, seed = Math.random()) {
    root.traverse((o) => {
      const name = (o.userData?.face as string | undefined) ?? /_face_([a-z]+)(?:_\d+)?$/.exec(o.name)?.[1];
      if (!name || !(o as THREE.Mesh).isMesh && !o.children.some((c) => (c as THREE.Mesh).isMesh)) return;
      if (!this.sets.has(name as Expr)) { this.sets.set(name as Expr, o); o.visible = false; }
    });
    this.blinkT = 2 + seed * 3;
  }
  get has() { return this.sets.size > 0; }
  /** the expression the character should show (resolved to an available overlay) */
  set(e: Expr) { this.want = e; }
  get current() { return this.want; }
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
    }
    // pop spring + googly wobble, on the visible overlay only
    this.popV += (-2 * 0.35 * 16 * this.popV - 16 * 16 * this.pop) * Math.min(dt, 1 / 30);
    this.pop += this.popV * Math.min(dt, 1 / 30);
    const o = this.sets.get(this.shown);
    if (o) {
      const googly = this.shown !== 'blink' && this.shown !== 'happy' && this.shown !== 'laugh';
      const wob = googly && !MOTION.reduced ? Math.sin(this.t * 13) * 0.025 * WOBBLE.k : 0;
      const s = 1 + this.pop * 0.12;
      o.scale.set(s + wob, s - wob, s);
    }
  }
}
