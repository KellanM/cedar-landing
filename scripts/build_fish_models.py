"""Build the 3D fish model data from the Logbook plate generator.

    python -I scripts/build_fish_models.py [--tools ../art/fish/_tools] [slug ...]

The colour plates (public/fish/<slug>.svg) are built by art/fish/_tools (fishlib.py + species*.py).
This script re-runs that generator with an instrumented Fish class, so the 3D model is derived
from the same numbers as the plate:

* body columns  - the plate's own top/bottom half-height profiles (or the crab's shell polygon),
                  sampled along the body; a per-body-plan width ratio turns them into elliptical
                  cross-sections (fusiform, compressed, depressed, flat, eel, shark, crab).
* median card   - one flat strip at z = 0 covering the dorsal/anal/tail fins; its texture is the
                  plate itself, alpha-tested, so the fin shapes are pixel-exact.
* parts         - the plate's paddle fins (pectoral / pelvic) and the crab's claws, moved to a
                  second atlas row and rebuilt as hinged cards that can splay, flap and wave.
* atlas         - one SVG (512 x 520 plate px): row 0 = the plate without paddle fins (body +
                  median fins), row 1 = the paddles alone, last 8 px = the blind-side colour.
                  The game rasterises it to a canvas texture at load (no PNGs shipped).

Output: public/fish/models/<slug>.json (one small file per species, lazy-loaded) and
public/fish/models/index.json (slug -> plan, bytes). Needs Python Playwright + Chromium to
rasterise the median layer for the card extents.
"""
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
TOOLS = os.path.join(os.path.dirname(ROOT), 'art', 'fish', '_tools')
if '--tools' in args:
    i = args.index('--tools')
    TOOLS = os.path.abspath(args[i + 1])
    del args[i:i + 2]
ONLY = [a for a in args if not a.startswith('--')]
sys.path.insert(0, TOOLS)

import fishlib  # noqa: E402
from fishlib import Fish, INK, PAPER  # noqa: E402
import species  # noqa: E402
import species2  # noqa: E402,F401

OUT = os.path.join(ROOT, 'public', 'fish', 'models')
W, H = 512, 256

# ------------------------------------------------------------------ body plans
# r = cross-section half-width / half-height at (head, mid, tail) knots t = (0.1, 0.45, 1.0).
# zneg = width factor of the -z side (flat plans: blind side / crab underside).
PLANS = {
    'fusiform':   dict(r=(0.62, 0.56, 0.34)),
    'slim':       dict(r=(0.55, 0.48, 0.32)),     # herring, smelt: laterally compressed silver
    'rockfish':   dict(r=(0.62, 0.5, 0.32)),
    'perch':      dict(r=(0.46, 0.38, 0.26)),     # surfperches: deep and thin
    'sculpin':    dict(r=(1.15, 0.72, 0.36)),     # broad, flat-topped head
    'lingcod':    dict(r=(0.85, 0.62, 0.36)),
    'shark':      dict(r=(1.05, 0.82, 0.5)),
    'ratfish':    dict(r=(0.8, 0.62, 0.45)),
    'eel':        dict(r=(0.95, 0.78, 0.5)),
    'pipe':       dict(r=(0.95, 0.92, 0.85)),
    'flat':       dict(r=(0.2, 0.17, 0.14), zneg=0.6, flat=True),
    'crab':       dict(r=(0.42, 0.42, 0.42), zneg=0.45, flat=True, crab=True),
}
PLAN_OF = {
    'shiner-perch': 'perch', 'pile-perch': 'perch', 'striped-seaperch': 'perch',
    'pacific-herring': 'slim', 'surf-smelt': 'slim', 'pacific-sand-lance': 'eel',
    'kelp-greenling': 'fusiform', 'lingcod': 'lingcod', 'sablefish': 'fusiform',
    'copper-rockfish': 'rockfish', 'quillback-rockfish': 'rockfish', 'black-rockfish': 'rockfish', 'yelloweye-rockfish': 'rockfish',
    'cabezon': 'sculpin', 'red-irish-lord': 'sculpin', 'staghorn-sculpin': 'sculpin', 'buffalo-sculpin': 'sculpin',
    'starry-flounder': 'flat', 'english-sole': 'flat', 'pacific-sanddab': 'flat', 'sand-sole': 'flat', 'pacific-halibut': 'flat',
    'coho-salmon': 'fusiform', 'chinook-salmon': 'fusiform', 'pink-salmon': 'fusiform', 'sockeye-salmon': 'fusiform',
    'chum-salmon': 'fusiform', 'cutthroat-trout': 'fusiform', 'coho-smolt': 'fusiform',
    'spiny-dogfish': 'shark', 'bluntnose-sixgill': 'shark', 'spotted-ratfish': 'ratfish',
    'wolf-eel': 'eel', 'bay-pipefish': 'pipe', 'oarfish': 'eel', 'dungeness-crab': 'crab', 'unknown-fish': 'fusiform',
}
# animation style per plan (the game picks the motion from this)
MOTION = {'flat': 'flap', 'crab': 'crab', 'eel': 'eel', 'pipe': 'eel'}
# blind side colours (flatfish: cream-white; crab: pale underside)
BLIND = {'flat': '#E9E3D0', 'crab': '#E6CDA0'}


def ratio(plan, t):
    a, b, c = PLANS[plan]['r']
    if t <= 0.1:
        return a
    if t <= 0.45:
        return a + (b - a) * (t - 0.1) / 0.35
    return b + (c - b) * (t - 0.45) / 0.55


class RecFish(Fish):
    """Fish that remembers where its body, paddles and claws came from."""

    def __init__(self, *a):
        super().__init__(*a)
        self.paddles = []
        self.shell = None

    def body_pts(self, pts, fill, smooth=True):
        self.shell = [(p[0], p[1]) for p in pts]
        return super().body_pts(pts, fill, smooth)

    def paddle(self, x, y, L, Wd, ang, fill, stage=5, pointed=False, rays=None, marks=None, sil=True):
        k0 = len(self.items)
        super().paddle(x, y, L, Wd, ang, fill, stage, pointed, rays, marks, sil)
        self.paddles.append(dict(x=x, y=y, L=L, W=Wd, ang=ang, stage=stage, pointed=pointed, items=list(range(k0, len(self.items)))))


def layer_svg(f, keep, dy=0):
    """The plate's own layering (fishlib.Fish.svg) restricted to items whose index passes keep()."""
    body_c = (f'<path id="{f.bid}" d="{f.body_d}"/><clipPath id="{f.cid}"><use href="#{f.bid}"/></clipPath>'
              f'<use href="#{f.bid}" fill="{f.body_fill}" stroke="none"/>'
              f'<g clip-path="url(#{f.cid})" stroke="none">{"".join(f.marks)}</g>'
              f'<use href="#{f.bid}" fill="none"/>')
    items = [(it[0], it[1], it[2]) for i, it in enumerate(f.items) if keep(i)]
    if keep(-1):
        items.append((1, 0, body_c))
    items.sort(key=lambda it: (it[0], it[1]))
    tr = f' transform="translate(0 {dy})"' if dy else ''
    return f'<g stroke="{INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"{tr}>' + ''.join(c for _, _, c in items) + '</g>'


def crab_parts(f):
    """Split the crab's claw arms + chelae out of the plate (they become waving cards)."""
    cx, cy = 256, 136
    claw_items = [i for i, it in enumerate(f.items) if 'stroke-width="20"' in it[2]]
    shape_claws = [i for i, it in enumerate(f.items) if '#EFE6D2' in it[2] and 'clipPath' in it[2]]
    base = '#A0604A'
    extra = ''
    for s in (-1, 1):
        arm = f'M{cx + s * 70} {cy - 20}L{cx + s * 136} {cy - 58}L{cx + s * 112} {cy - 92}'
        extra += f'<path fill="none" stroke-width="20" d="{arm}"/><path fill="none" stroke="{base}" stroke-width="14" d="{arm}"/>'
    parts = []
    for s in (-1, 1):
        x0, x1 = sorted((cx + s * 36, cx + s * 154))
        parts.append(dict(kind='claw', side=s, pivot=[cx + s * 70, cy - 20],
                          quad=[[x0, cy - 126], [x1, cy - 126], [x1, cy - 4], [x0, cy - 4]], mirror=False))
    return claw_items + shape_claws, extra, parts


def paddle_part(p, plan):
    L, Wd, a = p['L'], p['W'], math.radians(p['ang'])
    d = (math.cos(a), math.sin(a))
    nrm = (-d[1], d[0])
    u0, u1, vv = -0.14 * L - 3, 1.08 * L + 3, 0.62 * Wd + 3
    loc = [(u0, -vv), (u1, -vv), (u1, vv), (u0, vv)]
    quad = [[round(p['x'] + u * d[0] + v * nrm[0], 1), round(p['y'] + u * d[1] + v * nrm[1], 1)] for u, v in loc]
    front = p['stage'] >= 5
    return dict(kind='pec' if front else 'pel', pivot=[round(p['x'], 1), round(p['y'], 1)], dir=[round(d[0], 4), round(d[1], 4)],
                quad=quad, mirror=not PLANS[plan].get('flat'), splay=34 if front else 16)


def columns(f, plan, n):
    """[x, mid, top, bot] in plate px, cosine-spaced so the snout and tail ends are dense."""
    cols = []
    if f.shell:
        poly = f.shell
        xs = [p[0] for p in poly]
        x0, x1 = min(xs), max(xs)
        for i in range(n + 1):
            x = x0 + (x1 - x0) * (0.5 - 0.5 * math.cos(math.pi * i / n))
            ys = []
            for j in range(len(poly)):
                (ax, ay), (bx, by) = poly[j], poly[(j + 1) % len(poly)]
                if (ax - x) * (bx - x) <= 0 and ax != bx:
                    ys.append(ay + (by - ay) * (x - ax) / (bx - ax))
            if len(ys) < 2:
                ys = [sum(p[1] for p in poly) / len(poly)] * 2
            top, bot = min(ys), max(ys)
            mid = (top + bot) / 2
            cols.append([x, mid, mid - top, bot - mid])
        cols[0][2] = cols[0][3] = cols[-1][2] = cols[-1][3] = 0
        return cols
    for i in range(n + 1):
        t = 0.5 - 0.5 * math.cos(math.pi * i / n)
        cols.append([f.X(t), f.M(t), max(0.0, f.top_f(t)), max(0.0, f.bot_f(t))])
    return cols


def median_extents(page, svg):
    """Per-pixel-column alpha extents of the median layer (body + fins, no paddles)."""
    return page.evaluate('''async (svg) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c = document.createElement('canvas'); c.width = 512; c.height = 256;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 512, 256);
      const d = g.getImageData(0, 0, 512, 256).data;
      const top = [], bot = [];
      for (let x = 0; x < 512; x++) {
        let a = -1, b = -1;
        for (let y = 0; y < 256; y++) if (d[(y * 512 + x) * 4 + 3] > 20) { if (a < 0) a = y; b = y; }
        top.push(a); bot.push(b);
      }
      return { top, bot };
    }''', svg)


def card_stations(ext, n):
    xs = [x for x in range(512) if ext['top'][x] >= 0]
    x0, x1 = xs[0] - 1, xs[-1] + 2
    st = []
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        lo, hi = int(x0 + (x1 - x0) * (i - 1) / n) - 1, int(x0 + (x1 - x0) * (i + 1) / n) + 2
        tops = [ext['top'][k] for k in range(max(0, lo), min(512, hi)) if ext['top'][k] >= 0]
        bots = [ext['bot'][k] for k in range(max(0, lo), min(512, hi)) if ext['bot'][k] >= 0]
        if not tops:
            tops, bots = [128], [128]
        st.append([round(x, 1), max(0, min(tops) - 2), min(256, max(bots) + 3)])
    return st


def build_one(e, page):
    slug = e['slug']
    plan = PLAN_OF.get(slug, 'fusiform')
    P = PLANS[plan]
    f = RecFish(slug, e['name'])
    e['fn'](f)
    move = set()
    parts = []
    extra_row1 = ''
    if P.get('crab'):
        idx, extra_row1, parts = crab_parts(f)
        move |= set(idx)
    else:
        for p in f.paddles:
            move |= set(p['items'])
            parts.append(paddle_part(p, plan))
    # row 1: moved items (claw arms are re-drawn per side in extra_row1, so drop the shared arms item)
    arm_items = {i for i, it in enumerate(f.items) if 'stroke-width="20"' in it[2]}
    row0 = layer_svg(f, lambda i: i == -1 or i not in move)
    row1 = layer_svg(f, lambda i: i != -1 and i in move and i not in arm_items, dy=256)
    if extra_row1:
        row1 = f'<g stroke="{INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" transform="translate(0 256)">{extra_row1}</g>' + row1
    blind = BLIND.get(plan, '#E9E3D0')
    atlas = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 520" width="512" height="520">'
             f'{row0}{row1}<rect x="0" y="512" width="512" height="8" fill="{blind}"/></svg>')
    atlas = re.sub(r'\s+', ' ', atlas)
    eel = plan in ('eel', 'pipe')
    cols = columns(f, plan, 40 if eel else (20 if P.get('crab') else 26))
    nx = len(cols) - 1
    widths = []
    for i, (x, mid, top, bot) in enumerate(cols):
        t = (x - cols[0][0]) / max(1e-6, cols[-1][0] - cols[0][0])
        h = (top + bot) / 2
        widths.append(round(h * ratio(plan, t), 2))
    ext = median_extents(page, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256" width="512" height="256">{row0}</svg>')
    stations = card_stations(ext, 44 if eel else 30)
    out = dict(
        v=1, slug=slug, name=e['name'], plan=plan, motion=MOTION.get(plan, 'swim'), flat=bool(P.get('flat')),
        zneg=P.get('zneg', 1.0),
        snout=round(cols[0][0], 1), tip=stations[-1][0],
        cols=[[round(c[0], 1), round(c[1], 1), round(c[2], 1), round(c[3], 1), widths[i]] for i, c in enumerate(cols)],
        card=stations, parts=parts, atlas=atlas,
    )
    if P.get('crab'):
        out['snout'], out['tip'] = round(cols[0][0], 1), round(cols[-1][0], 1)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    from playwright.sync_api import sync_playwright
    index = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page()
        page.set_content('<html><body></body></html>')
        for e in species.REG:
            if ONLY and e['slug'] not in ONLY:
                continue
            m = build_one(e, page)
            s = json.dumps(m, separators=(',', ':'))
            open(os.path.join(OUT, e['slug'] + '.json'), 'w', encoding='utf-8').write(s)
            index[e['slug']] = dict(plan=m['plan'], bytes=len(s), game_id=e['game_id'])
            print(f'{e["slug"]:24s} {m["plan"]:9s} {len(s) / 1024:5.1f} KB  cols {len(m["cols"])}  card {len(m["card"])}  parts {len(m["parts"])}')
        b.close()
    if not ONLY:
        json.dump(index, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), indent=1)


if __name__ == '__main__':
    main()
