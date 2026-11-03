import * as THREE from 'three';

/**
 * Photo mode (docs/camera_study.md F13). ACNH and Alba make the camera a verb; Sea of Thieves lets the
 * world keep moving. Ours: the HUD hides, the world holds still by default (a "Live" toggle lets the
 * sea and clock run on), one finger orbits the subject (boat or skipper), a pinch / wheel zooms and
 * the zoom tilts the view toward the horizon (Tiny Glade's zoom↔pitch coupling). A few filters in the
 * Logbook's style, a frame, and a shutter that makes a PNG: the share sheet on phones (Web Share API)
 * or a download. Leaving puts the game camera back exactly where it was.
 */

export interface PhotoHost {
  camera: THREE.PerspectiveCamera;
  /** orbit centre (the boat or the skipper) */
  subject: (out: THREE.Vector3) => THREE.Vector3;
  canEnter: () => boolean;
  /** render one frame now and return the WebGL canvas (read it synchronously) */
  render: () => HTMLCanvasElement;
  waterY: () => number;
  /** caption for the postcard frame */
  place: () => string;
  /** distance along a ray to the first solid hit (on foot: walls / roofs), or `far` */
  clip?: (from: THREE.Vector3, dir: THREE.Vector3, far: number) => number;
  onToggle?: (on: boolean) => void;
}

type FilterId = 'none' | 'logbook' | 'mono' | 'warm' | 'dusk';
type FrameId = 'none' | 'postcard' | 'logbook';
const FILTERS: { id: FilterId; label: string; css: string }[] = [
  { id: 'none', label: 'Plain', css: '' },
  { id: 'logbook', label: 'Logbook', css: 'sepia(0.78) saturate(0.85) contrast(0.92) brightness(1.06)' },
  { id: 'mono', label: 'B&W', css: 'grayscale(1) contrast(1.12) brightness(1.03)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.22) saturate(1.18) hue-rotate(-6deg) brightness(1.04)' },
  { id: 'dusk', label: 'Dusk', css: 'saturate(0.9) hue-rotate(12deg) brightness(0.96) contrast(1.05)' },
];
const FRAMES: { id: FrameId; label: string }[] = [
  { id: 'none', label: 'No frame' }, { id: 'postcard', label: 'Postcard' }, { id: 'logbook', label: 'Logbook' },
];

const CAM_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#2B2622" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5a2 2 0 0 1 2-2h2.2l1.4-2h5.8l1.4 2h2.2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" fill="#B5643C"/><circle cx="12" cy="13" r="3.6" fill="#F4EFE3"/><path d="M17.5 9.5h.01"/></svg>`;

const CSS = `
.photo-btn { min-width: 48px; min-height: 48px; padding: 6px 8px; display: inline-flex; align-items: center; justify-content: center; }
.photo-btn svg { width: 26px; height: 26px; }
body.photo-mode #hud, body.photo-mode .foot-bubble, body.photo-mode .bubbles, body.photo-mode #toasts, body.photo-mode .wbubble, body.photo-mode #version-stamp, body.photo-mode #fps { visibility: hidden !important; }
#photo { position: fixed; inset: 0; z-index: 40; display: none; touch-action: none; user-select: none; -webkit-user-select: none; }
body.photo-mode #photo { display: block; }
#photo .ph-vig { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity var(--t-quick, 160ms); background: radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 55%, rgba(74,52,30,.42) 100%); }
#photo.f-logbook .ph-vig { opacity: 1; }
#photo .ph-frame { position: absolute; inset: 0; pointer-events: none; box-sizing: border-box; border: 0 solid #F4EFE3; transition: border-width var(--t-quick, 160ms); }
#photo.fr-postcard .ph-frame { border-width: 14px 14px 46px; box-shadow: inset 0 0 0 2px rgba(43,38,34,.25); }
#photo.fr-logbook .ph-frame { border-width: 18px; border-color: #EDE3CC; box-shadow: inset 0 0 0 2px #2B2622, inset 0 0 0 6px #EDE3CC, inset 0 0 0 7px rgba(43,38,34,.4); }
#photo .ph-cap { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font: 700 22px var(--f-hand, cursive); color: #2B2622; display: none; pointer-events: none; }
#photo.fr-postcard .ph-cap { display: block; }
#photo .ph-top { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 10px); left: 10px; right: 10px; display: flex; justify-content: space-between; gap: 8px; pointer-events: none; }
#photo .ph-bot { position: absolute; left: 0; right: 0; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
#photo button { pointer-events: auto; font: 800 15px var(--f-ui, sans-serif); color: #2B2622; background: #F4EFE3; border: 2px solid #2B2622; border-radius: 10px; box-shadow: 0 3px 0 rgba(43,38,34,.35); padding: 8px 12px; min-height: 44px; cursor: pointer; }
#photo button.on { background: #2E5E63; color: #F4EFE3; }
#photo .ph-row { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; max-width: 96vw; }
#photo .ph-row button { padding: 6px 10px; min-height: 40px; font-size: 14px; }
#photo .ph-shutter { width: 76px; height: 76px; border-radius: 50%; padding: 0; background: #F4EFE3; display: grid; place-items: center; }
#photo .ph-shutter i { width: 54px; height: 54px; border-radius: 50%; background: #9E3B2A; border: 2px solid #2B2622; display: block; }
#photo .ph-hint { font: 700 17px var(--f-hand, cursive); color: #F4EFE3; text-shadow: 0 1px 2px rgba(0,0,0,.6); pointer-events: none; }
#photo .ph-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
#photo .ph-flash.go { animation: ph-flash 380ms ease-out; }
@keyframes ph-flash { 0% { opacity: .85; } 100% { opacity: 0; } }
#photo .ph-shot { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(-2deg); background: #F4EFE3; border: 2px solid #2B2622; border-radius: 12px; box-shadow: 0 6px 0 rgba(43,38,34,.35); padding: 10px; display: none; flex-direction: column; gap: 10px; align-items: center; width: min(78vw, 420px); pointer-events: auto; }
#photo .ph-shot.show { display: flex; }
#photo .ph-shot img { width: 100%; max-height: 52vh; object-fit: contain; border: 2px solid #2B2622; border-radius: 4px; background: transparent; }
#photo .ph-shot .ph-acts { display: flex; gap: 8px; }
body.reduce-motion #photo .ph-flash.go { animation-duration: 1ms; }
`;

const D2R = Math.PI / 180;

export class PhotoMode {
  active = false;
  /** world holds still (default) */
  still = true;
  filter: FilterId = 'none';
  frame: FrameId = 'none';
  private root: HTMLDivElement;
  private canvasEl: HTMLCanvasElement;
  private centre = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0.4;
  private dist = 14;
  private yawT = 0;
  private pitchT = 0.4;
  private distT = 14;
  private fov0 = 55;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch0 = 0;
  private last: { blob: Blob; url: string; name: string } | null = null;
  private btn: HTMLButtonElement | null = null;
  private dirV = new THREE.Vector3();

  constructor(private host: PhotoHost, canvas: HTMLCanvasElement) {
    this.canvasEl = canvas;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root = document.createElement('div');
    this.root.id = 'photo';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Photo mode');
    this.root.innerHTML = `
      <div class="ph-vig"></div><div class="ph-frame"></div><div class="ph-cap"></div><div class="ph-flash"></div>
      <div class="ph-top"><button class="ph-close" aria-label="Leave photo mode">✕ Done</button><button class="ph-still on" aria-pressed="true">Still</button></div>
      <div class="ph-bot">
        <div class="ph-hint">Drag to look around · pinch to zoom</div>
        <div class="ph-row ph-filters">${FILTERS.map((f) => `<button data-f="${f.id}" class="${f.id === 'none' ? 'on' : ''}">${f.label}</button>`).join('')}</div>
        <div class="ph-row ph-frames">${FRAMES.map((f) => `<button data-fr="${f.id}" class="${f.id === 'none' ? 'on' : ''}">${f.label}</button>`).join('')}</div>
        <button class="ph-shutter" aria-label="Take photo"><i></i></button>
      </div>
      <div class="ph-shot"><img alt="Your photo"><div class="ph-acts"><button class="ph-share">Share</button><button class="ph-save">Save</button><button class="ph-again">Back</button></div></div>`;
    document.body.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    q('.ph-close').onclick = () => this.exit();
    q<HTMLButtonElement>('.ph-still').onclick = (e) => this.setStill(!this.still, e.currentTarget as HTMLButtonElement);
    this.root.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => (b.onclick = () => this.setFilter(b.dataset.f as FilterId)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-fr]').forEach((b) => (b.onclick = () => this.setFrame(b.dataset.fr as FrameId)));
    q('.ph-shutter').onclick = () => { void this.shoot(); };
    q('.ph-share').onclick = () => { void this.share(); };
    q('.ph-save').onclick = () => this.save();
    q('.ph-again').onclick = () => q('.ph-shot').classList.remove('show');
    // pointer orbit / pinch on the empty part of the overlay
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, .ph-shot')) return;
      this.root.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.pinch0 = this.spread();
    });
    this.root.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 1) {
        this.yawT -= (e.clientX - p.x) * 0.006;
        this.pitchT = THREE.MathUtils.clamp(this.pitchT + (e.clientY - p.y) * 0.005, -0.05, 1.45);
      }
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 2) {
        const s = this.spread();
        if (this.pinch0 > 0 && s > 0) this.zoomBy(this.pinch0 / s);
        this.pinch0 = s;
      }
    });
    const up = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.pinch0 = this.pointers.size === 2 ? this.spread() : 0; };
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', up);
    this.root.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'p' || e.key === 'P') { if (this.active) this.exit(); else this.enter(); }
      else if (this.active && e.key === 'Escape') this.exit();
    });
  }

  /** Put the camera button in the HUD's top-right row (before the Log). */
  mountButton() {
    const row = document.querySelector('.hud-top-right');
    if (!row || this.btn) return;
    const b = document.createElement('button');
    b.className = 'tab photo-btn';
    b.id = 'btn-photo';
    b.setAttribute('aria-label', 'Photo mode');
    b.innerHTML = CAM_SVG;
    b.onclick = () => this.enter();
    row.insertBefore(b, row.firstChild);
    this.btn = b;
  }

  private spread() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  /** zoom: closer also tilts toward the horizon (zoom↔pitch coupling) */
  private zoomBy(k: number) {
    const before = this.distT;
    this.distT = THREE.MathUtils.clamp(this.distT * k, 1.6, 45);
    const d = Math.log(this.distT / before);
    this.pitchT = THREE.MathUtils.clamp(this.pitchT + d * 0.18, -0.05, 1.45);
  }

  enter() {
    if (this.active || !this.host.canEnter()) return;
    this.active = true;
    const cam = this.host.camera;
    this.host.subject(this.centre);
    const off = cam.position.clone().sub(this.centre);
    this.dist = this.distT = THREE.MathUtils.clamp(off.length(), 2, 40);
    this.yaw = this.yawT = Math.atan2(off.x, off.z);
    this.pitch = this.pitchT = Math.asin(THREE.MathUtils.clamp(off.y / Math.max(0.01, off.length()), -0.05, 1.45));
    this.fov0 = cam.fov;
    document.body.classList.add('photo-mode');
    this.root.querySelector('.ph-cap')!.textContent = this.caption();
    this.root.querySelector('.ph-shot')!.classList.remove('show');
    this.host.onToggle?.(true);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('photo-mode');
    this.canvasEl.style.filter = '';
    const cam = this.host.camera;
    cam.fov = this.fov0; cam.updateProjectionMatrix();
    this.pointers.clear();
    this.host.onToggle?.(false);
  }

  private setStill(on: boolean, b?: HTMLButtonElement) {
    this.still = on;
    const btn = b ?? this.root.querySelector<HTMLButtonElement>('.ph-still')!;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Still' : 'Live';
  }
  setFilter(id: FilterId) {
    this.filter = id;
    this.root.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === id));
    this.root.classList.toggle('f-logbook', id === 'logbook');
    this.canvasEl.style.filter = this.active ? FILTERS.find((f) => f.id === id)!.css : '';
  }
  setFrame(id: FrameId) {
    this.frame = id;
    this.root.querySelectorAll<HTMLButtonElement>('[data-fr]').forEach((b) => b.classList.toggle('on', b.dataset.fr === id));
    this.root.classList.toggle('fr-postcard', id === 'postcard');
    this.root.classList.toggle('fr-logbook', id === 'logbook');
  }

  /** Test / debug: orbit by (yaw, pitch) radians and zoom by a factor. */
  nudge(dYaw: number, dPitch: number, zoom = 1) {
    this.yawT += dYaw;
    this.pitchT = THREE.MathUtils.clamp(this.pitchT + dPitch, -0.05, 1.45);
    if (zoom !== 1) this.zoomBy(zoom);
  }
  /** Per frame while active (real time, also when the world is still): drive the camera. */
  update(dt: number) {
    if (!this.active) return;
    const k = 1 - Math.exp(-dt * 10);
    this.yaw += (this.yawT - this.yaw) * k;
    this.pitch += (this.pitchT - this.pitch) * k;
    this.dist += (this.distT - this.dist) * k;
    const cam = this.host.camera;
    const c = Math.cos(this.pitch);
    cam.position.set(this.centre.x + Math.sin(this.yaw) * c * this.dist, this.centre.y + Math.sin(this.pitch) * this.dist, this.centre.z + Math.cos(this.yaw) * c * this.dist);
    // keep the camera out of walls and roofs (on foot): pull in to the first hit
    if (this.host.clip) {
      const dir = this.dirV.copy(cam.position).sub(this.centre);
      const l = dir.length();
      if (l > 0.01) {
        const hit = this.host.clip(this.centre, dir.multiplyScalar(1 / l), l);
        if (hit < l) cam.position.copy(this.centre).addScaledVector(dir, Math.max(0.8, hit - 0.3));
      }
    }
    const floor = this.host.waterY() + 0.35;
    if (cam.position.y < floor) cam.position.y = floor;
    // aim a little above the subject when low (horizon in frame), at it when high
    cam.lookAt(this.centre.x, this.centre.y + 0.6 * (1 - Math.min(1, this.pitch / 0.8)), this.centre.z);
    const fov = cam.aspect < 1 ? 60 : 48;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const css = FILTERS.find((f) => f.id === this.filter)!.css;
    if (this.canvasEl.style.filter !== css) this.canvasEl.style.filter = css;
  }

  private caption() {
    const d = new Date();
    return `${this.host.place()} · ${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`;
  }

  /** Render, filter, frame → PNG blob (also used by the debug hook). */
  async compose(): Promise<Blob> {
    const src = this.host.render();
    const W = src.width, H = src.height;
    const base = Math.min(W, H);
    const pad = this.frame === 'postcard' ? { l: base * 0.045, r: base * 0.045, t: base * 0.045, b: base * 0.15 }
      : this.frame === 'logbook' ? { l: base * 0.06, r: base * 0.06, t: base * 0.06, b: base * 0.06 } : { l: 0, r: 0, t: 0, b: 0 };
    const out = document.createElement('canvas');
    out.width = Math.round(W + pad.l + pad.r); out.height = Math.round(H + pad.t + pad.b);
    const g = out.getContext('2d')!;
    // the photo itself, filtered pixel by pixel (CSS filter matrices: same look as the live preview)
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const tg = tmp.getContext('2d', { willReadFrequently: true })!;
    tg.drawImage(src, 0, 0);
    const steps = FILTERS.find((f) => f.id === this.filter)!.css;
    if (steps) {
      const img = tg.getImageData(0, 0, W, H);
      applyCssFilter(img.data, steps);
      tg.putImageData(img, 0, 0);
    }
    if (this.filter === 'logbook') {
      const r = tg.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.35, W / 2, H * 0.46, Math.hypot(W, H) * 0.55);
      r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(74,52,30,0.42)');
      tg.fillStyle = r; tg.fillRect(0, 0, W, H);
    }
    // frame
    if (this.frame !== 'none') {
      g.fillStyle = this.frame === 'logbook' ? '#EDE3CC' : '#F4EFE3';
      g.fillRect(0, 0, out.width, out.height);
    }
    g.drawImage(tmp, pad.l, pad.t);
    if (this.frame === 'logbook') {
      g.strokeStyle = '#2B2622'; g.lineWidth = Math.max(2, base * 0.004);
      g.strokeRect(pad.l - base * 0.012, pad.t - base * 0.012, W + base * 0.024, H + base * 0.024);
      // deckled outer edge: a few soft bites out of the paper
      g.fillStyle = 'rgba(43,38,34,0.12)';
      for (let i = 0; i < 60; i++) { const t = i / 60; g.beginPath(); g.arc(t * out.width, (i % 2) * out.height, base * 0.006 * (1 + (i * 7) % 3), 0, Math.PI * 2); g.fill(); }
    }
    if (this.frame === 'postcard') {
      g.strokeStyle = 'rgba(43,38,34,0.25)'; g.lineWidth = Math.max(1, base * 0.002);
      g.strokeRect(pad.l, pad.t, W, H);
      const px = Math.round(base * 0.06);
      try { await document.fonts.load(`700 ${px}px "Caveat Hand"`); } catch { /* fallback font */ }
      g.fillStyle = '#2B2622';
      g.font = `700 ${px}px "Caveat Hand", Caveat, "Segoe Print", cursive`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(this.caption(), out.width / 2, pad.t + H + pad.b / 2);
    }
    return await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  }

  private async shoot() {
    const fl = this.root.querySelector('.ph-flash')!;
    fl.classList.remove('go'); void (fl as HTMLElement).offsetWidth; fl.classList.add('go');
    const blob = await this.compose();
    if (this.last) URL.revokeObjectURL(this.last.url);
    const d = new Date(), p2 = (n: number) => String(n).padStart(2, '0');
    this.last = { blob, url: URL.createObjectURL(blob), name: `cedar-landing-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png` };
    const shot = this.root.querySelector('.ph-shot')!;
    (shot.querySelector('img') as HTMLImageElement).src = this.last.url;
    const canShare = !!navigator.canShare?.({ files: [new File([blob], this.last.name, { type: 'image/png' })] });
    (shot.querySelector('.ph-share') as HTMLElement).style.display = canShare ? '' : 'none';
    shot.classList.add('show');
  }
  private async share() {
    if (!this.last) return;
    const file = new File([this.last.blob], this.last.name, { type: 'image/png' });
    try { await navigator.share({ files: [file], title: 'Cedar Landing' }); } catch { /* cancelled */ }
  }
  private save() {
    if (!this.last) return;
    const a = document.createElement('a');
    a.href = this.last.url; a.download = this.last.name;
    document.body.appendChild(a); a.click(); a.remove();
  }
}

// ---------------------------------------------------------------- CSS filter functions as pixel ops
type M = number[]; // 3x3 row-major + offset per row → [r0..r2, o0, r3..]
function matFor(fn: string, v: number): { m: number[]; o: number } {
  const s = 1 - Math.min(1, v);
  switch (fn) {
    case 'grayscale': return { m: [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s, 0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s, 0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s], o: 0 };
    case 'sepia': return { m: [0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s], o: 0 };
    case 'saturate': return { m: [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v], o: 0 };
    case 'hue-rotate': {
      const a = v * D2R, c = Math.cos(a), n = Math.sin(a);
      return { m: [0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928,
        0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.14, 0.072 - c * 0.072 - n * 0.283,
        0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072], o: 0 };
    }
    case 'brightness': return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: 0 };
    case 'contrast': return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: 0.5 - 0.5 * v };
    default: return { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: 0 };
  }
}
function applyCssFilter(px: Uint8ClampedArray, css: string) {
  const steps: { m: M; o: number }[] = [];
  for (const m of css.matchAll(/([a-z-]+)\(([-\d.]+)(deg)?\)/g)) steps.push(matFor(m[1], parseFloat(m[2])));
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    for (const { m, o } of steps) {
      const nr = m[0] * r + m[1] * g + m[2] * b + o, ng = m[3] * r + m[4] * g + m[5] * b + o, nb = m[6] * r + m[7] * g + m[8] * b + o;
      r = Math.min(1, Math.max(0, nr)); g = Math.min(1, Math.max(0, ng)); b = Math.min(1, Math.max(0, nb));
    }
    px[i] = r * 255; px[i + 1] = g * 255; px[i + 2] = b * 255;
  }
}
