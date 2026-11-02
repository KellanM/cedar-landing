/**
 * Sheet (ui_layouts_indie §4.2): one panel for market, shops, errands and gear.
 *  P  bottom sheet with a grab handle, snap heights 40% / 70%, swipe down to close
 *  L  right panel, 40% width (min 380px)
 *  D  centred-right panel, 440px
 * Header slot (skin "label" = cannery label, "logbook" = paper), scrolling body, pinned footer.
 * Esc and a Done button close it everywhere.
 */
import { ctx, h, setModal, type Modal } from './ctx';
import { fx } from './fx';

export interface SheetOpts {
  id: string;
  skin: 'label' | 'logbook';
  modal?: Modal;
  /** called when the player closes it (Done / Esc / swipe / leaving the zone) */
  onClose: () => void;
  ariaLabel?: string;
}

export class Sheet {
  readonly el: HTMLElement;
  readonly panel: HTMLElement;
  readonly header: HTMLElement;
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
  private snap: 40 | 70 = 70;
  private drag: { id: number; y0: number; h0: number } | null = null;

  constructor(private o: SheetOpts) {
    this.el = h('div', `sheet-wrap skin-${o.skin} hidden`);
    this.el.id = o.id;
    this.el.innerHTML = `<section class="sheet" role="dialog" aria-modal="false"${o.ariaLabel ? ` aria-label="${o.ariaLabel}"` : ''}>
      <div class="grab" aria-hidden="true"><i></i></div>
      <header class="sheet-head"></header>
      <div class="sheet-body"></div>
      <footer class="sheet-foot"></footer>
    </section>`;
    document.body.appendChild(this.el);
    this.panel = this.el.querySelector('.sheet')!;
    this.header = this.el.querySelector('.sheet-head')!;
    this.body = this.el.querySelector('.sheet-body')!;
    this.foot = this.el.querySelector('.sheet-foot')!;

    const grab = this.el.querySelector<HTMLElement>('.grab')!;
    const start = (e: PointerEvent) => {
      if (ctx.layout !== 'portrait') return;
      this.drag = { id: e.pointerId, y0: e.clientY, h0: this.panel.getBoundingClientRect().height };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      this.panel.style.transition = 'none';
    };
    const move = (e: PointerEvent) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dy = e.clientY - this.drag.y0;
      this.panel.style.height = `${Math.max(80, this.drag.h0 - dy)}px`;
    };
    const end = (e: PointerEvent) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dy = e.clientY - this.drag.y0;
      const hNow = this.drag.h0 - dy;
      this.drag = null;
      this.panel.style.transition = '';
      this.panel.style.height = '';
      const frac = hNow / window.innerHeight;
      if (Math.abs(dy) < 6) this.setSnap(this.snap === 70 ? 40 : 70); // tap toggles
      else if (frac < 0.28) this.o.onClose();
      else this.setSnap(frac < 0.55 ? 40 : 70);
    };
    for (const t of [grab, this.header]) {
      t.addEventListener('pointerdown', start);
      t.addEventListener('pointermove', move);
      t.addEventListener('pointerup', end);
      t.addEventListener('pointercancel', end);
    }
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen && !e.defaultPrevented) { e.preventDefault(); this.o.onClose(); } });
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  setSnap(s: 40 | 70) {
    this.snap = s;
    this.el.classList.toggle('snap-40', s === 40);
    this.el.classList.toggle('snap-70', s === 70);
  }

  open() {
    if (this.isOpen) return;
    this.setSnap(70);
    this.el.classList.remove('hidden', 'in');
    void this.el.offsetWidth;
    this.el.classList.add('in');
    fx('page');
    setModal(this.o.modal ?? null);
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.add('hidden');
    if (ctx.modal === (this.o.modal ?? null)) setModal(null);
  }
}
