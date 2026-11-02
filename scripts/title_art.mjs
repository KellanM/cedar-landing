// Generates the opening (loading + title) illustration and writes it into index.html between
// <!-- opening:begin --> and <!-- opening:end -->. Pure inline SVG/HTML so it paints before any JS.
// Run: node scripts/title_art.mjs   (deterministic: seeded RNG, re-running gives the same markup)
// Study + rationale: docs/title_study.md
import fs from 'node:fs';
import path from 'node:path';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const r1 = (n) => Math.round(n * 10) / 10;

/** One fir: a narrow spire with 3–5 drooping tiers, apex at (x, top), base on y0. */
function fir(x, y0, h, w, maxTiers = 5) {
  const tiers = Math.min(maxTiers, 3 + Math.floor(rnd() * 3));
  const pts = [[x, y0 - h]];
  for (let i = 1; i <= tiers; i++) {
    const t = i / tiers, y = y0 - h + h * t * 0.92, half = w * (0.28 + 0.72 * t) * 0.5;
    pts.push([x + half, y], [x + half * 0.42, y - h * 0.035]);
  }
  const right = pts.slice(1);
  const left = right.map(([px, py]) => [2 * x - px, py]).reverse();
  // relative coords after the first point: shorter markup (this ships inline in index.html)
  const all = [[x - w * 0.06, y0], ...left, pts[0], ...right, [x + w * 0.06, y0]].map(([a, b]) => [Math.round(a), Math.round(b)]);
  return `M${all[0][0]} ${all[0][1]}l` + all.slice(1).map(([a, b], i) => `${a - all[i][0]} ${b - all[i][1]}`).join(' ').replace(/ -/g, '-') + 'z';
}

/** A forested ridge: a smooth hump outline from x0..x1 plus firs standing on it. */
function ridge({ x0, x1, base, crest, n, fh, fw, H, tiers = 3 }) {
  const top = (x) => {
    const u = (x - x0) / (x1 - x0);
    return base - crest * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.7);
  };
  let d = `M${x0} ${H}`;
  for (let x = x0; x <= x1; x += (x1 - x0) / 16) d += `L${Math.round(x)} ${Math.round(top(x) + 3)}`;
  d += `L${x1} ${H}Z`;
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * ((i + 0.5 + (rnd() - 0.5) * 0.8) / n);
    const edge = Math.min(x - x0, x1 - x) / (x1 - x0);
    const s = (0.55 + 0.45 * Math.min(1, edge * 4)) * (0.8 + rnd() * 0.4);
    d += fir(x, top(x) + 4, fh * s, fw * s, tiers);
  }
  return d;
}

/** A tall stand of firs at one screen edge (the near "frame" trees). mirror=true for the right side. */
function stand(W, H, count) {
  let d = '';
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    const x = 8 + u * (W - 40) + (rnd() - 0.5) * 14;
    const h = H * (0.98 - u * 0.55) * (0.85 + rnd() * 0.2);
    d += fir(x, H, h, h * (0.34 + rnd() * 0.06));
  }
  // rocky shore under the trees
  d += `M0 ${H}L0 ${H - 26}Q${W * 0.3} ${H - 34} ${W * 0.6} ${H - 18}Q${W * 0.85} ${H - 8} ${W} ${H - 4}L${W} ${H}Z`;
  return d;
}

// ---- far range (flat, atmospheric): one big snowy cone right of centre + a long ragged range
const farRange = 'M0 260V176L70 160L130 170L210 132L290 158L370 138L450 162L520 124L600 150L660 140L730 156L800 128L870 92L930 52L968 30L990 28L1012 34L1060 66L1120 104L1190 132L1260 118L1330 146L1410 128L1480 152L1550 140L1600 150V260Z';
const farSnow = 'M909 72L930 52L968 30L990 28L1012 34L1044 56L1032 60L1018 52L1004 66L992 54L976 70L962 58L946 74L930 66Z';
const farBack = 'M0 260V196L120 184L260 196L380 172L520 190L700 168L820 186L1000 160L1180 182L1320 166L1460 186L1600 174V260Z';

// ---- mid islands (two humps with fir texture)
seed = 11;
const mid = ridge({ x0: -40, x1: 760, base: 196, crest: 70, n: 30, fh: 34, fw: 15, H: 200 })
  + ridge({ x0: 1020, x1: 1660, base: 196, crest: 58, n: 24, fh: 32, fw: 14, H: 200 });
// lighthouse islet sits in the gap (drawn separately, ink-outlined)

// ---- near stands (left + right frame), viewBox 260×420 each
seed = 23;
const standL = stand(260, 420, 7);
seed = 41;
const standR = stand(260, 420, 6);

// ---- water crest rows (drawn ticks; tile 400 wide, element is 200% wide and drifts by -50%)
function crests(w, rows, len, curve, spread) {
  let d = '';
  for (const [y, n, off] of rows) {
    for (let i = 0; i < n; i++) {
      const x = ((i + off + (rnd() - 0.5) * spread) / n) * w;
      const l = len * (0.7 + rnd() * 0.6);
      d += `M${r1(x)} ${y}q${r1(l / 2)} ${-curve} ${r1(l)} 0`;
    }
  }
  // tile twice so translateX(-50%) loops seamlessly
  return d + d.replace(/M([\d.]+) /g, (_, x) => `M${r1(+x + w)} `);
}
seed = 5;
const crestFar = crests(400, [[6, 9, 0.2], [16, 11, 0.6]], 14, 1.2, 0.6);
const crestMid = crests(400, [[8, 7, 0.1], [24, 8, 0.55], [40, 6, 0.3]], 22, 2.4, 0.7);
const crestNear = crests(400, [[10, 5, 0.4], [34, 4, 0.05], [58, 5, 0.7]], 34, 4, 0.6);

const INK = '#2B2622';
const boat = `<svg class="ld-boat" viewBox="0 0 124 84" aria-hidden="true">
  <g stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M86 50V7" stroke="#8C6D3A" stroke-width="2.6"/>
    <path d="M87 7l19 4.5L87 17q4-5 0-10z" fill="#E8A93A" class="ld-flag"/>
    <path d="M14 42h12v8H14z" fill="#B07A4A"/>
    <path d="M28 29h38v21H28z" fill="#ECE5D3"/>
    <path d="M33 34h9v7h-9zM46 34h9v7h-9z" fill="#2E4650" stroke-width="1.6"/>
    <circle cx="61" cy="41" r="3.6" fill="none" stroke="#C8372B" stroke-width="2.4"/>
    <path d="M37 11h8v12h-8z" fill="${INK}"/>
    <path d="M37 15h8v3h-8z" fill="#B83A2A" stroke-width="1.2"/>
    <path d="M23 29h48l-3-7H27z" fill="#B83A2A"/>
    <path d="M6 49.5L116 45q-3 15-17 20.5L23 66q-12-4-17-16.5z" fill="#F1EDE3"/>
    <path d="M7.5 53.6L115 49.3l-1.4 4.4L9.6 58z" fill="#2F6E5C" stroke-width="1.4"/>
    <circle cx="32" cy="60" r="2.6" fill="${INK}" stroke-width="1"/><circle cx="52" cy="60" r="2.6" fill="${INK}" stroke-width="1"/><circle cx="72" cy="59.6" r="2.6" fill="${INK}" stroke-width="1"/><circle cx="92" cy="59" r="2.6" fill="${INK}" stroke-width="1"/>
  </g>
  <path d="M2 68q14-5 30 0t30 0 30 0 30 0" fill="none" stroke="#F4EFE3" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
</svg>`;

const lighthouse = `<svg class="ld-light" viewBox="0 0 60 92" aria-hidden="true">
  <path d="M0 92q6-16 20-17 6-8 16-6 14 1 24 23z" fill="#56706B"/>
  <g stroke="${INK}" stroke-width="1.8" stroke-linejoin="round">
    <path d="M23 76l3-48h10l3 48z" fill="#F4EFE3"/>
    <path d="M24.4 56h13.2l.7 9H23.7zM25.5 38h11l.5 7H25z" fill="#9E3B2A" stroke-width="1.2"/>
    <path d="M24 28h14v-3H24z" fill="${INK}"/>
    <path d="M26 25v-8h10v8" fill="#F2D27A"/>
    <path d="M24.5 17l6.5-7 6.5 7z" fill="#9E3B2A"/>
    <path d="M38 76h9v-9h-9z" fill="#E9E1CF"/><path d="M36.5 67.5l6-5 6 5z" fill="#9E3B2A"/>
  </g>
</svg>`;

const landing = `<svg class="ld-landing" viewBox="0 0 120 70" aria-hidden="true">
  <g stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M58 30h50v26H58z" fill="#B5643C"/>
    <path d="M70 38h8v8h-8zM90 38h8v8h-8z" fill="#2E4650" stroke-width="1.4"/>
    <path d="M52 31l31-17 31 17z" fill="#6B3A2A"/>
    <path d="M100 18v-8h6v12" fill="${INK}" stroke-width="1.4"/>
    <path d="M2 54h112v5H2z" fill="#8C6D3A"/>
    <path d="M8 59v11M30 59v11M52 59v11M74 59v11M96 59v11" stroke-width="2.6"/>
  </g>
</svg>`;

const gull = `<svg viewBox="0 0 24 10" aria-hidden="true"><path d="M1 8q5-7 11-1 6-6 11 1" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const lockup = `<div class="ld-lockup" role="img" aria-label="Cedar Landing, a Salish Sea fishing tale">
  <svg class="ld-crest" viewBox="0 0 220 22" aria-hidden="true">
    <path d="M6 11h68M146 11h68" stroke="${INK}" stroke-width="1.4"/>
    <circle cx="80" cy="11" r="1.8" fill="${INK}"/><circle cx="140" cy="11" r="1.8" fill="${INK}"/>
    <path d="M90 11q9-8 22-6 7 1 11 6-4 5-11 6-13 2-22-6zM123 11l9-6v12z" fill="#9E3B2A" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <circle cx="100" cy="9.6" r="1.2" fill="#F4EFE3"/>
  </svg>
  <svg class="ld-name" viewBox="0 0 400 112" aria-hidden="true">
    <defs><path id="ld-arc" d="M10 100Q200 48 390 100"/></defs>
    <text class="ld-name-shadow"><textPath href="#ld-arc" startOffset="50%" text-anchor="middle">Cedar Landing</textPath></text>
    <text class="ld-name-face"><textPath href="#ld-arc" startOffset="50%" text-anchor="middle">Cedar Landing</textPath></text>
  </svg>
  <div class="ld-ribbon"><span>a Salish Sea fishing tale</span></div>
</div>`;

const svg = (cls, vb, par, body) => `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="${par}" aria-hidden="true">${body}</svg>`;

const html = `<!-- opening:begin (generated by scripts/title_art.mjs; edit there) -->
    <div id="loading" class="shown" aria-busy="true">
      <div class="ld-plate">
        <div class="ld-scene">
          <i class="ld-sun"></i>
          ${svg('ld-far', '0 0 1600 260', 'xMidYMax slice', `<path d="${farRange}" fill="#B4C1BE"/><path d="${farSnow}" fill="#F4EFE3"/><path d="${farBack}" fill="#9DB0AD"/>`)}
          <i class="ld-mist"></i>
          ${svg('ld-mid', '0 0 1600 200', 'xMidYMax slice', `<path d="${mid}" fill="#6F8C88"/>`)}
          ${lighthouse}
          <div class="ld-water">
            <div class="ld-crests far">${svg('', '0 0 800 22', 'none', `<path d="${crestFar}"/>`)}</div>
            <div class="ld-crests mid">${svg('', '0 0 800 48', 'none', `<path d="${crestMid}"/>`)}</div>
            <div class="ld-crests near">${svg('', '0 0 800 66', 'none', `<path d="${crestNear}"/>`)}</div>
          </div>
          ${svg('ld-stand l', '0 0 260 420', 'xMinYMax meet', `<path d="${standL}" fill="#2D4643"/>`)}
          ${svg('ld-stand r', '0 0 260 420', 'xMaxYMax meet', `<g transform="matrix(-1 0 0 1 260 0)"><path d="${standR}" fill="#2D4643"/></g>`)}
          ${landing}
          <div class="ld-gulls"><i class="g1">${gull}</i><i class="g2">${gull}</i><i class="g3">${gull}</i></div>
          <div class="ld-voyage"><i class="ld-wake"></i><div class="ld-boat-pos">${boat}</div></div>
        </div>
        ${lockup}
      </div>
      <div class="ld-foot">
        <div id="load-msg">Loading…</div>
        <p class="tip" id="load-tip">Fish bite best where the water wrinkles.</p>
        <button id="ld-go" class="ld-go" type="button" tabindex="-1">Tap to set out</button>
      </div>
      <div id="load-bar" hidden></div>
    </div>
    <!-- opening:end -->`;

const file = path.resolve('index.html');
const src = fs.readFileSync(file, 'utf8');
const a = src.indexOf('<!-- opening:begin'), b = src.indexOf('<!-- opening:end -->');
if (a < 0 || b < 0) throw new Error('markers not found in index.html');
fs.writeFileSync(file, src.slice(0, a) + html.trim() + src.slice(b + '<!-- opening:end -->'.length));
console.log('opening markup', html.length, 'bytes');
