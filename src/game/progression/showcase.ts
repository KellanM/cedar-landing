/**
 * Showcase camera: while the shipwright is open (and for a few seconds after a launch) the camera
 * slowly orbits the boat so paint previews land on the real model. Framing per part (flag looks
 * up the mast, roof from higher). On phones in portrait the boat is framed in the top of the
 * screen, above the 40% sheet. No allocations per frame.
 */
import * as THREE from 'three';

const FRAMING: Record<string, { h: number; r: number; side: number }> = {
  hull: { h: 0.35, r: 1.0, side: 1.1 }, stripe: { h: 0.4, r: 0.95, side: 1.1 }, trim: { h: 0.55, r: 0.9, side: 0.9 },
  cabin: { h: 0.6, r: 0.9, side: 0.8 }, roof: { h: 1.05, r: 1.0, side: 0.7 }, flag: { h: 1.6, r: 0.95, side: 0.9 },
  boat: { h: 0.6, r: 1.25, side: 0.9 },
};

export class Showcase {
  active = false;
  private until = 0;
  private part = 'boat';
  private ang = 0;
  private cur = new THREE.Vector3();
  private look = new THREE.Vector3();
  private want = new THREE.Vector3();
  private wantLook = new THREE.Vector3();
  private fresh = true;
  private base = 0;
  private needAngle = true;
  /** true if the camera may sit at (x, z) (open water / no buildings); set by the owner */
  clear: (x: number, z: number) => boolean = () => true;

  start(part = 'boat', seconds = Infinity) {
    if (!this.active) { this.fresh = true; this.ang = 0; this.needAngle = true; }
    this.active = true;
    this.part = part;
    this.until = seconds === Infinity ? Infinity : performance.now() + seconds * 1000;
  }
  focus(part: string) { if ((part === 'flag') !== (this.part === 'flag')) this.needAngle = true; this.part = part; }

  /** pick the orbit side with a clear view: camera spot and the sight line both off land / buildings */
  private pickAngle(px: number, pz: number, yaw: number, r: number) {
    // the flag is a cloth in the boat's centre plane: look at it broadside; otherwise a bow quarter
    const start = yaw + (this.part === 'flag' ? Math.PI / 2 : Math.PI * 0.25);
    let best = start, bestScore = -1;
    for (let k = 0; k < 24; k++) {
      const a = start + ((k % 2 ? -1 : 1) * Math.ceil(k / 2) * Math.PI * 2) / 24;
      let score = 0;
      for (const f of [1, 0.8, 0.6, 0.45, 0.3]) if (this.clear(px + Math.sin(a) * r * f, pz + Math.cos(a) * r * f)) score++; else break;
      if (score > bestScore) { bestScore = score; best = a; }
      if (score === 5) break;
    }
    this.base = best;
  }
  stop() { this.active = false; this.until = 0; }
  /** true while a timed launch orbit is running */
  get timed() { return this.active && this.until !== Infinity; }

  apply(camera: THREE.PerspectiveCamera, boatPos: THREE.Vector3, yaw: number, halfLen: number, dt: number, portrait: boolean) {
    if (!this.active) return;
    if (performance.now() > this.until) { this.active = false; return; }
    const f = FRAMING[this.part] ?? FRAMING.boat;
    this.ang += dt;
    const L = Math.max(3.3, halfLen);
    const r = L * 2.5 * f.r * (portrait ? 1.3 : 1.35);
    if (this.needAngle) { this.pickAngle(boatPos.x, boatPos.z, yaw, r); this.needAngle = false; }
    // a gentle sway around the clear side (a full orbit would swing behind the wharf buildings)
    const a = this.base + Math.sin(this.ang * 0.18) * (this.part === 'flag' ? 0.15 : 0.35);
    this.want.set(boatPos.x + Math.sin(a) * r, L * f.h * 1.5 + 3.2, boatPos.z + Math.cos(a) * r);
    this.wantLook.set(boatPos.x, L * f.h * 0.8 + 0.4, boatPos.z);
    const k = this.fresh ? 1 : Math.min(1, dt * 2.5);
    this.fresh = false;
    this.cur.lerp(this.want, k);
    this.look.lerp(this.wantLook, k);
    camera.position.copy(this.cur);
    camera.lookAt(this.look);
    // the sheet covers the bottom (portrait) or the right (landscape/desktop): aim past the boat
    // so it sits in the uncovered part of the screen
    if (portrait) camera.rotateX(-0.27); else camera.rotateY(-0.24);
  }
}
