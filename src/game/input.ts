/**
 * Unified input: keyboard (WASD/arrows + E interact + Space cast/reel) and touch
 * (left-thumb floating joystick, right-side buttons, right-half drag = camera orbit).
 */
export class Input {
  /** -1..1 (forward = +1) */
  throttle = 0;
  /** -1..1 (right = +1) */
  steer = 0;
  /** true while the Cast/Reel action is held (keyboard Space or the touch button) */
  actionHeld = false;
  /** camera orbit delta accumulated since last frame (radians) */
  orbitDX = 0;
  orbitDY = 0;
  lastOrbitTime = 0;

  private keys = new Set<string>();
  private actionPresses = 0;
  private interactPresses = 0;
  private tapPresses = 0;
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  private orbitId: number | null = null;
  private orbitLast = { x: 0, y: 0 };
  private touchAction = false;
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;

  constructor(private canvas: HTMLElement, actionBtn: HTMLElement, interactBtn: HTMLElement) {
    this.joyBase = document.getElementById('joy-base')!;
    this.joyKnob = document.getElementById('joy-knob')!;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' ) { this.actionPresses++; e.preventDefault(); }
      if (k === 'e' || k === 'enter') this.interactPresses++;
      if (k === 'escape') this.tapPresses++;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.touchAction = false; });

    const press = (el: HTMLElement, down: () => void, up?: () => void) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('down'); down(); });
      const end = (e: PointerEvent) => { e.preventDefault(); el.classList.remove('down'); up?.(); };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    };
    press(actionBtn, () => { this.actionPresses++; this.touchAction = true; }, () => { this.touchAction = false; });
    press(interactBtn, () => { this.interactPresses++; });

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  private onDown(e: PointerEvent) {
    this.tapPresses++;
    const leftHalf = e.clientX < window.innerWidth * 0.5;
    if (e.pointerType !== 'mouse' && leftHalf && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyVec = { x: 0, y: 0 };
      this.joyBase.style.display = 'block';
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyKnob.style.transform = 'translate(-50%,-50%)';
    } else if (this.orbitId === null) {
      this.orbitId = e.pointerId;
      this.orbitLast = { x: e.clientX, y: e.clientY };
    }
    this.canvas.setPointerCapture(e.pointerId);
  }
  private onMove(e: PointerEvent) {
    if (e.pointerId === this.joyId) {
      const R = 55;
      let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
      const L = Math.hypot(dx, dy);
      if (L > R) { dx *= R / L; dy *= R / L; }
      this.joyVec = { x: dx / R, y: dy / R };
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (e.pointerId === this.orbitId) {
      this.orbitDX += (e.clientX - this.orbitLast.x) * 0.006;
      this.orbitDY += (e.clientY - this.orbitLast.y) * 0.004;
      this.orbitLast = { x: e.clientX, y: e.clientY };
      this.lastOrbitTime = performance.now();
    }
  }
  private onUp(e: PointerEvent) {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.joyVec = { x: 0, y: 0 };
      this.joyBase.style.display = 'none';
    }
    if (e.pointerId === this.orbitId) this.orbitId = null;
  }

  update() {
    const k = this.keys;
    let t = 0, s = 0;
    if (k.has('w') || k.has('arrowup')) t += 1;
    if (k.has('s') || k.has('arrowdown')) t -= 1;
    if (k.has('a') || k.has('arrowleft')) s -= 1;
    if (k.has('d') || k.has('arrowright')) s += 1;
    if (this.joyId !== null) {
      // Joystick: up = forward, sideways = steer. Dead zone keeps small wobbles still.
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      t = -dz(this.joyVec.y);
      s = dz(this.joyVec.x);
      // Pushing mostly sideways should still move a little so you can turn on the spot-ish.
      if (Math.abs(s) > 0.5 && t === 0) t = 0.25 * Math.abs(s);
    }
    this.throttle = Math.max(-1, Math.min(1, t));
    this.steer = Math.max(-1, Math.min(1, s));
    this.actionHeld = this.touchAction || k.has(' ');
  }

  consumeAction() { const n = this.actionPresses; this.actionPresses = 0; return n > 0; }
  consumeInteract() { const n = this.interactPresses; this.interactPresses = 0; return n > 0; }
  consumeTap() { const n = this.tapPresses; this.tapPresses = 0; return n > 0; }
  takeOrbit() { const d = { x: this.orbitDX, y: this.orbitDY }; this.orbitDX = 0; this.orbitDY = 0; return d; }
  /** Test hook: simulate held keys. */
  setKey(k: string, down: boolean) { if (down) this.keys.add(k); else this.keys.delete(k); }
}
