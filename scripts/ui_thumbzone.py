"""Thumb-reach overlay (ui_design §5 hit #3) on a 390x844 portrait capture.

Model [prov]: one-handed grip after Hoober (49% of observed users held one-handed); thumb pivot just
off the bottom corner on the holding side. Zones by distance from the pivot, as fractions of the
screen width: natural (green) 0.33–0.90 W, stretch (yellow) < 0.33 W (cramped, thumb must fold) or
0.90–1.15 W, hard (red) beyond. Run: python scripts/ui_thumbzone.py <shot.png> <out.png> [left]
Prints the zone of each control centre passed in as JSON via the script's CONTROLS defaults.
"""
import math
import sys
from PIL import Image, ImageDraw

W, H, DPR = 390, 844, 2
src, out = sys.argv[1], sys.argv[2]
left = len(sys.argv) > 3 and sys.argv[3] == 'left'
pivot = (0 if left else W, H * 0.97)

# control centres in css px for the default (right-handed) portrait layout (see hud.css)
CONTROLS = {
    'Cast (88px)': (W - 16 - 44, H - 24 - 44),
    'Context (72px)': (W - 70 - 36, H - 24 - 82 - 36),
    'Strike (104px)': (W - 16 - 52, H - 24 - 52),
    'Catch slip Keep': (W - 12 - 50, H - 24 - 104 - 18 - 32),
    'Log button': (W - 10 - 47, 10 + 28),
    'Shells tab': (10 + 70, 10 + 24),
}

img = Image.open(src).convert('RGBA')
lay = Image.new('RGBA', img.size, (0, 0, 0, 0))
d = ImageDraw.Draw(lay)


def zone(px, py):
    r = math.hypot(px - pivot[0], py - pivot[1]) / W
    if 0.33 <= r <= 0.90:
        return 'natural'
    if r < 0.33 or r <= 1.15:
        return 'stretch'
    return 'hard'


COL = {'natural': (60, 170, 80, 70), 'stretch': (240, 200, 40, 70), 'hard': (210, 60, 40, 70)}
step = 6
for y in range(0, H, step):
    for x in range(0, W, step):
        d.rectangle([x * DPR, y * DPR, (x + step) * DPR, (y + step) * DPR], fill=COL[zone(x + step / 2, y + step / 2)])
img = Image.alpha_composite(img, lay)
d = ImageDraw.Draw(img)
for name, (x, y) in CONTROLS.items():
    if left:
        x = W - x
    z = zone(x, y)
    d.ellipse([(x - 6) * DPR, (y - 6) * DPR, (x + 6) * DPR, (y + 6) * DPR], outline='black', width=4)
    print(f'{name:<18} {z}')
img.convert('RGB').save(out)
