import * as THREE from 'three';

/** Tiny footstep dust puffs (pooled). */
export class DustPuffs {
  group = new THREE.Group();
  private pool: { m: THREE.Mesh; t: number; life: number; vx: number; vz: number }[] = [];
  private mat = new THREE.MeshBasicMaterial({ color: 0xd9ccb4, transparent: true, opacity: 0.7, depthWrite: false });
  private geo = new THREE.IcosahedronGeometry(0.07, 0);
  private next = 0;

  constructor(n = 14) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, this.mat.clone());
      m.visible = false;
      this.group.add(m);
      this.pool.push({ m, t: 0, life: 0, vx: 0, vz: 0 });
    }
  }

  puff(pos: THREE.Vector3, strength: number) {
    const count = strength > 0.6 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const p = this.pool[this.next++ % this.pool.length];
      p.m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.04, (Math.random() - 0.5) * 0.15));
      p.t = 0;
      p.life = 0.45 + Math.random() * 0.2;
      p.vx = (Math.random() - 0.5) * 0.5; p.vz = (Math.random() - 0.5) * 0.5;
      p.m.scale.setScalar(0.6 + strength * 0.6);
      p.m.visible = true;
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.m.visible) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { p.m.visible = false; continue; }
      p.m.position.x += p.vx * dt; p.m.position.z += p.vz * dt; p.m.position.y += 0.25 * dt;
      p.m.scale.multiplyScalar(1 + dt * 1.6);
      (p.m.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - k);
    }
  }
}

const CSS = `
.foot-bubble{position:fixed;left:0;top:0;z-index:6;max-width:220px;padding:8px 12px 9px;border-radius:14px;
  background:#fbf6ea;color:#2c3634;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 3px 0 rgba(44,54,52,.25);
  transform:translate(-50%,-100%);pointer-events:none;transition:opacity .25s;opacity:0}
.foot-bubble.show{opacity:1}
.foot-bubble b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#a8392e;margin-bottom:2px}
.foot-bubble:after{content:"";position:absolute;left:50%;bottom:-7px;margin-left:-7px;border:7px solid transparent;border-bottom:0;border-top-color:#fbf6ea}
body.onfoot #btn-action{opacity:0;pointer-events:none}
body.onfoot #tension,body.onfoot #bite,body.onfoot #move-hint{display:none}
`;
let cssDone = false;
export function injectFootCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** World-anchored speech bubble (one at a time). */
export class SpeechBubble {
  private el: HTMLDivElement;
  private anchor = new THREE.Vector3();
  private until = 0;
  private v = new THREE.Vector3();

  constructor() {
    injectFootCss();
    this.el = document.createElement('div');
    this.el.className = 'foot-bubble';
    document.body.appendChild(this.el);
  }

  say(who: string, text: string, at: THREE.Vector3, ms = 3800) {
    this.el.innerHTML = '';
    const b = document.createElement('b'); b.textContent = who;
    this.el.append(b, document.createTextNode(text));
    this.anchor.copy(at);
    this.until = performance.now() + ms;
    this.el.classList.add('show');
  }

  get visible() { return performance.now() < this.until; }
  get text() { return this.visible ? this.el.textContent : null; }

  hide() { this.until = 0; this.el.classList.remove('show'); }

  update(cam: THREE.Camera) {
    if (!this.visible) { this.el.classList.remove('show'); return; }
    this.v.copy(this.anchor).project(cam);
    if (this.v.z > 1) { this.el.style.opacity = '0'; return; }
    this.el.style.opacity = '';
    const w = window.innerWidth, h = window.innerHeight;
    const x = Math.min(w - 120, Math.max(120, (this.v.x * 0.5 + 0.5) * w));
    const y = Math.min(h - 40, Math.max(90, (-this.v.y * 0.5 + 0.5) * h));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}
