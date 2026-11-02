/**
 * First-run pencilled hints (ui_design §4.7): Caveat notes with a hand-drawn arrow, shown in place,
 * one at a time, each once. They dismiss on first *use*, never on a timer. Stored in
 * localStorage.seenHints.
 * Layout study §3.11: placed beside the target on the side facing screen centre; suppressed during
 * bite / cards / dialogue / title cards and queued for the next idle moment (≥2 s); after 20 s
 * un-acted a hint shrinks to a pulsing dot on its target. Exception: "Ease off" is the ring's own
 * coaching caption, so it may show during the reel (it sits beside the ring, never over Strike).
 */
import { $, ctx } from './ctx';
import { seenHints, saveHints } from './prefs';
import type { FrameState } from './hud';

type HintId = 'paddle' | 'cast' | 'strike' | 'ease' | 'cooler';
const ORDER: HintId[] = ['paddle', 'cast', 'strike', 'ease', 'cooler'];

const touch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const TEXT: Record<HintId, () => string> = {
  paddle: () => (touch() ? 'Put your thumb down anywhere here and paddle' : 'W A S D to paddle. Drag to look about.'),
  cast: () => 'Stop by the ripples, then tap Cast',
  strike: () => 'Wait for the bob… then Strike!',
  ease: () => 'Ease off when it pulls',
  cooler: () => 'Fish go in the cooler. The market in Cedar Landing buys them',
};

// hand-drawn arrows (pencil): direction the arrow points
const ARROW: Record<string, string> = {
  down: '<svg viewBox="0 0 40 60" class="arrow"><path d="M18 4c-6 14 6 24 0 40" /><path d="M8 36l10 12 10-11"/></svg>',
  right: '<svg viewBox="0 0 70 40" class="arrow"><path d="M4 20c16-10 30 8 54 0"/><path d="M48 9l12 11-13 9"/></svg>',
  up: '<svg viewBox="0 0 40 60" class="arrow"><path d="M20 56c6-14-6-24 0-42"/><path d="M10 22l10-12 10 11"/></svg>',
};
const DIR: Record<HintId, string> = { paddle: 'down', cast: 'right', strike: 'down', ease: 'down', cooler: 'up' };

class Hints {
  private seen = seenHints();
  private current: HintId | null = null;
  private el: HTMLElement | null = null;
  private flags = new Set<string>();
  private forced: HintId | null = null;
  private calmSince = 0;
  private shownAt = 0;

  init() {
    this.el = document.createElement('div');
    this.el.className = 'hint hidden';
    this.el.setAttribute('role', 'note');
    $('hints').appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      if (this.current === 'cooler') { e.stopPropagation(); this.done('cooler'); }
    });
  }

  event(name: 'bite' | 'strain' | 'kept') { this.flags.add(name); }

  private want(s: FrameState): HintId | null {
    const ph = s.fishing.phase;
    for (const id of ORDER) {
      if (this.seen.has(id)) continue;
      switch (id) {
        case 'paddle': if (ph === 'idle' && !s.canCast) return id; break;
        case 'cast': if (ph === 'idle' && s.canCast && !s.coolerFull) return id; break;
        case 'strike': if (ph === 'casting' || ph === 'waiting' || ph === 'missed' || ph === 'bite') return id; break;
        case 'ease': if (ph === 'reeling' && this.flags.has('strain')) return id; break;
        case 'cooler': if (this.flags.has('kept')) return id; break;
      }
    }
    return null;
  }

  private satisfied(id: HintId, s: FrameState) {
    const ph = s.fishing.phase;
    switch (id) {
      case 'paddle': return Math.abs(s.throttle) > 0.3 || Math.abs(s.boat.speed) > 0.8;
      case 'cast': return ph !== 'idle';
      case 'strike': return ph === 'reeling' || ph === 'landed';
      case 'ease': return ph !== 'reeling' || (!s.fishing.reelHeld && s.fishing.tension < 0.5);
      case 'cooler': return ctx.modal === 'market';
    }
  }

  private done(id: HintId) {
    this.seen.add(id);
    saveHints(this.seen);
    if (this.forced === id) this.forced = null;
    if (this.current === id) this.hide();
  }

  private hide() {
    this.current = null;
    this.el?.classList.add('hidden');
  }

  private show(id: HintId) {
    if (!this.el) return;
    this.current = id;
    this.el.className = `hint h-${id} dir-${DIR[id]}`;
    this.el.innerHTML = `${id === 'paddle' && touch() ? '<div class="ghost-thumb"></div>' : ''}<p>${TEXT[id]()}</p>${ARROW[DIR[id]]}`;
  }

  update(s: FrameState) {
    if (!this.el) return;
    const now = performance.now();
    if (this.current && !this.forced && this.satisfied(this.current, s)) this.done(this.current);
    const ph = s.fishing.phase;
    const busy = s.inShot || !!ctx.modal || ctx.title || ctx.pausedSlip || ph === 'bite' || ph === 'landed';
    if (busy) this.calmSince = now;
    let want = this.forced ?? (busy ? null : this.want(s));
    // ease is the reel coach (allowed mid-reel); everything else needs ≥2 s of calm first
    const needsCalm = want && want !== 'ease' && want !== 'strike' && want !== this.current;
    if (!this.forced && needsCalm && now - this.calmSince < 2000) want = null;
    if (ph === 'reeling' && want !== 'ease' && !this.forced) want = null;
    if (want !== this.current) { if (want) { this.show(want); this.shownAt = now; } else this.hide(); }
    this.el.classList.toggle('dot', !!this.current && !this.forced && now - this.shownAt > 20000);
    this.el.classList.toggle('hidden', !this.current);
  }

  /** Screenshot/test helper: show a hint regardless of state. */
  force(id: string) { this.forced = (ORDER as string[]).includes(id) ? (id as HintId) : null; if (this.forced) this.show(this.forced); }
  clear() { this.forced = null; this.seen = new Set(ORDER); saveHints(this.seen); this.hide(); }
}

export const hints = new Hints();
