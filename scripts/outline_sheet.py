"""Side-by-side outline comparisons: python scripts/outline_sheet.py [tag=outline] [modes=off,screen]
Writes screenshots/<tag>_<scene>_<vp>.png (modes side by side) and screenshots/<tag>_compare.png (contact sheet)."""
import sys, os
from PIL import Image, ImageDraw, ImageFont
tag = sys.argv[1] if len(sys.argv) > 1 else 'outline'
modes = (sys.argv[2] if len(sys.argv) > 2 else 'off,screen').split(',')
D = 'screenshots'
scenes = ['harbour', 'town', 'village', 'underway', 'shore', 'rocks', 'island', 'holdup', 'dusk', 'night']
try: font = ImageFont.truetype('arial.ttf', 22)
except Exception: font = ImageFont.load_default()
pairs = {}
for vp in ['phone', 'desktop']:
    for sc in scenes:
        ims = [f'{D}/{tag}_{sc}_{vp}_{m}.png' for m in modes]
        if not all(os.path.exists(p) for p in ims): continue
        im = [Image.open(p).convert('RGB') for p in ims]
        w, h = im[0].size
        out = Image.new('RGB', (w * len(im) + 8 * (len(im) - 1), h + 34), (40, 38, 34))
        dr = ImageDraw.Draw(out)
        for i, (x, m) in enumerate(zip(im, modes)):
            out.paste(x, (i * (w + 8), 34)); dr.text((i * (w + 8) + 8, 5), f'{sc} · {vp} · {m}', fill=(240, 236, 228), font=font)
        out.save(f'{D}/{tag}_{sc}_{vp}.png'); pairs[(vp, sc)] = out
# contact sheet: phone pairs scaled to 900 px tall, desktop pairs to 1800 wide
rows = []
for vp, target in [('phone', ('h', 760)), ('desktop', ('w', 1800))]:
    for sc in scenes:
        p = pairs.get((vp, sc))
        if not p: continue
        k = target[1] / (p.height if target[0] == 'h' else p.width)
        rows.append(p.resize((int(p.width * k), int(p.height * k)), Image.LANCZOS))
# phone rows side by side in groups of 3
tiles = []
ph = [r for r in rows if r.height == 760]
dk = [r for r in rows if r.height != 760]
for i in range(0, len(ph), 3):
    g = ph[i:i + 3]; W = sum(x.width for x in g) + 10 * (len(g) - 1)
    t = Image.new('RGB', (W, 760), (40, 38, 34)); x = 0
    for r in g: t.paste(r, (x, 0)); x += r.width + 10
    tiles.append(t)
for i in range(0, len(dk), 2):
    g = dk[i:i + 2]; H = max(x.height for x in g)
    t = Image.new('RGB', (sum(x.width // 2 for x in g) + 10, H // 2), (40, 38, 34)); x = 0
    for r in g: r2 = r.resize((r.width // 2, r.height // 2), Image.LANCZOS); t.paste(r2, (x, 0)); x += r2.width + 10
    tiles.append(t)
W = max(t.width for t in tiles); H = sum(t.height for t in tiles) + 10 * len(tiles)
sheet = Image.new('RGB', (W, H), (40, 38, 34)); y = 0
for t in tiles: sheet.paste(t, (0, y)); y += t.height + 10
sheet.save(f'{D}/{tag}_compare.png'); print('sheet', sheet.size, len(pairs), 'pairs')
