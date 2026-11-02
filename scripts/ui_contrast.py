"""Measure HUD / tension-ring contrast against the live scene (ui_design §5 hit #1, #2).

Run after `node scripts/ui_checks.mjs`:  python scripts/ui_contrast.py
Each check_tod_* frame is captured twice: with the HUD and with #hud hidden (`_bare`). For every
element we run scanlines across its edge (4 px outside → 8 px inside) and take, per scanline, the
strongest contrast between a HUD pixel and the scene pixel it covers (WCAG relative luminance) —
i.e. "is there a ≥3:1 boundary here", from ink outline or paper fill, whichever is stronger.
Reported: median and 10th percentile over all scanlines; pass = 10th percentile ≥ 3:1 (WCAG 1.4.11).
"""
import json
import math
import os
import statistics as st
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(os.path.dirname(HERE), 'screenshots')
DPR = 2


def lum(rgb):
    def ch(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2])


def ratio(a, b):
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def scan_max(img, bare, line):
    """Strongest element-vs-scene contrast along one scanline across an edge."""
    W, H = img.size
    best = 1.0
    for x, y in line:
        x, y = min(W - 1, max(0, int(x))), min(H - 1, max(0, int(y)))
        best = max(best, ratio(lum(img.getpixel((x, y))), lum(bare.getpixel((x, y)))))
    return best


def summary(img, bare, lines):
    vals = sorted(scan_max(img, bare, l) for l in lines)
    return round(st.median(vals), 2), round(vals[max(0, len(vals) // 10)], 2)  # median, 10th percentile


def rect_lines(r):
    """Scanlines from 4 css px outside to 8 px inside across the left, right and top edges."""
    x, y, w, h = (r[k] * DPR for k in ('x', 'y', 'w', 'h'))
    ts = [t * DPR for t in range(-4, 9)]
    lines = []
    for f in [k / 20 for k in range(4, 17)]:
        lines.append([(x + t, y + h * f) for t in ts])
        lines.append([(x + w - t, y + h * f) for t in ts])
        lines.append([(x + w * f, y + t) for t in ts])
    return lines


def circle_lines(cx, cy, rad):
    """Radial scanlines across a circular edge (rad in device px)."""
    lines = []
    for a in range(48):
        c, s_ = math.cos(a / 48 * math.tau), math.sin(a / 48 * math.tau)
        lines.append([(cx + c * (rad + t * DPR), cy + s_ * (rad + t * DPR)) for t in range(-10, 5)])
    return lines


def main():
    rep = json.load(open(os.path.join(SHOTS, 'checks.json')))
    print(f"{'time of day':<10} {'element':<14} {'edge median':>10} {'edge p10':>10}  separates (p10 >= 3:1)")
    worst = []
    for key, v in rep['contrast'].items():
        img = Image.open(os.path.join(SHOTS, v['file'])).convert('RGB')
        bare = Image.open(os.path.join(SHOTS, v['file'].replace('.png', '_bare.png'))).convert('RGB')
        tod = key.split('_', 1)[1]
        items = []
        if key.startswith('hud_'):
            for sel, r in v['rects'].items():
                if not r or r['w'] == 0:
                    continue
                if sel == '#btn-action':
                    lines = circle_lines((r['x'] + r['w'] / 2) * DPR, (r['y'] + r['h'] / 2) * DPR, r['w'] / 2 * DPR)
                else:
                    lines = rect_lines(r)
                items.append((sel, summary(img, bare, lines)))
        elif v.get('ring'):
            r = v['ring']
            # getBoundingClientRect of the SVG circle excludes its stroke: r=50 units; the ink outline's
            # outer edge is at 59.5 units and the paper halo at 62 units
            outer = r['w'] / 2 * DPR * 59.5 / 50
            items.append(('tension ring', summary(img, bare, circle_lines((r['x'] + r['w'] / 2) * DPR, (r['y'] + r['h'] / 2) * DPR, outer))))
        for sel, (med, p10) in items:
            worst.append((p10, tod, sel))
            print(f"{tod:<10} {sel:<14} {med:>10} {p10:>10}  {'yes' if p10 >= 3 else 'NO'}")
    worst.sort()
    print('weakest:', worst[:3])


if __name__ == '__main__':
    main()
