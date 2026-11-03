/**
 * Q3 "She'll Float": bail her out (HOLD) and drive one patch (TAP on the mark). The two thumbs
 * the fishing uses (Reel = hold, Strike = tap) are learned here first, where failing costs nothing
 * (docs/opening_study.md F9). Paper-skinned overlay; resolves when she floats.
 */
import { setModal } from './ctx';
import { fx } from './fx';
import { injectOpeningCss } from './openingcss';

export function repairBoat(opts: { reduceMotion?: boolean } = {}): Promise<void> {
  injectOpeningCss();
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'op-overlay';
    el.innerHTML = `<section class="op-card" role="dialog" aria-label="Repair the boat">
      <div class="op-band"></div>
      <p class="op-town">Keeper's Cove · the dock</p>
      <h2 class="op-h">She'll float?</h2>
      <p class="op-hand" id="rp-note">Bail till you see the boards. Hold the button.</p>
      <div class="rp-hull"><div class="rp-water" id="rp-water"></div><span class="rp-lbl" id="rp-lbl">water in her: 100%</span></div>
      <div class="rp-bar op-hide" id="rp-bar"><i class="rp-mark"></i><b class="rp-mallet" id="rp-mallet"></b></div>
      <div class="rp-nails op-hide" id="rp-nails"><span></span><span></span><span></span></div>
      <button class="op-btn go big" id="rp-btn">Hold to bail</button>
    </section>`;
    document.body.appendChild(el);
    setModal('opening');
    const $ = (id: string) => el.querySelector<HTMLElement>('#' + id)!;
    const btn = $('rp-btn');
    let phase: 'bail' | 'patch' | 'done' = 'bail';
    let water = 1, held = false, t = 0, nails = 0, last = performance.now(), raf = 0;
    const press = (on: boolean) => {
      if (phase === 'bail') { held = on; btn.classList.toggle('held', on); if (on) fx('tap'); }
      else if (phase === 'patch' && on) strike();
    };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); press(true); });
    btn.addEventListener('pointerup', () => press(false));
    btn.addEventListener('pointerleave', () => press(false));
    const key = (e: KeyboardEvent) => { if (e.code === 'Space' || e.key === 'e' || e.key === 'E' || e.key === 'Enter') { e.preventDefault(); press(e.type === 'keydown'); } };
    window.addEventListener('keydown', key); window.addEventListener('keyup', key);
    const spd = opts.reduceMotion ? 1.6 : 2.6;
    const markAt = () => 0.5 + 0.5 * Math.sin(t * spd); // mallet position 0..1
    function strike() {
      const p = markAt();
      const hit = Math.abs(p - 0.5) < 0.13;
      const n = el.querySelectorAll<HTMLElement>('#rp-nails span');
      if (hit) { n[nails]?.classList.add('in'); nails++; fx('sell'); $('rp-note').textContent = nails >= 3 ? 'Tight as a drum. She floats.' : ['Tap.', 'Tap, tap…', ''][nails - 1] ?? ''; }
      else { fx('slip'); $('rp-note').textContent = 'Glanced off. Wait for the mark, then tap.'; }
      if (nails >= 3) finish();
    }
    function finish() {
      phase = 'done';
      btn.textContent = 'She floats!';
      btn.classList.add('done');
      setTimeout(() => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); el.remove(); setModal(null); resolve(); }, 900);
    }
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      if (phase === 'bail') {
        water = Math.min(1, Math.max(0, water + (held ? -0.28 : 0.015) * dt));
        $('rp-water').style.height = `${Math.round(water * 100)}%`;
        $('rp-lbl').textContent = `water in her: ${Math.round(water * 100)}%`;
        if (water <= 0) {
          phase = 'patch'; held = false;
          btn.textContent = 'Tap on the mark';
          btn.classList.remove('held');
          $('rp-note').textContent = 'Now the seam by the stern. Tap when the mallet is over the mark. Three nails.';
          $('rp-bar').classList.remove('op-hide'); $('rp-nails').classList.remove('op-hide');
          $('rp-lbl').textContent = 'dry boards';
        }
      } else if (phase === 'patch') {
        $('rp-mallet').style.left = `${markAt() * 100}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}
