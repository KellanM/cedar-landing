"""Compose before/after sheets from screenshots/light_*.png -> screenshots/light_sheet_<vp>_<preset>.jpg
and screenshots/light_sheet_all.jpg. Usage: python scripts/light_sheet.py"""
import os
from PIL import Image, ImageDraw

D = os.path.join(os.path.dirname(__file__), '..', 'screenshots')
PRESETS = ['overcast', 'sunbreak', 'dusk', 'night']
VIEWS = ['start', 'kiln', 'cedar', 'forest']
SIZES = {'desktop': (640, 400), 'phone': (195, 422)}


def load(vp, p, v, s):
    f = os.path.join(D, f'light_{vp}_{p}_{v}_{s}.png')
    return Image.open(f).convert('RGB') if os.path.exists(f) else None


for vp, (w, h) in SIZES.items():
    tiles = []
    for p in PRESETS:
        rows = [(v, load(vp, p, v, 'off'), load(vp, p, v, 'on')) for v in VIEWS]
        rows = [r for r in rows if r[1] and r[2]]
        if not rows:
            continue
        if vp == 'desktop':  # rows = views, columns = off | on
            sheet = Image.new('RGB', (w * 2, h * len(rows) + 24), 'white')
            for i, (v, a, b) in enumerate(rows):
                sheet.paste(a.resize((w, h)), (0, 24 + i * h))
                sheet.paste(b.resize((w, h)), (w, 24 + i * h))
        else:  # columns = view off, view on
            sheet = Image.new('RGB', (w * 2 * len(rows), h + 24), 'white')
            for i, (v, a, b) in enumerate(rows):
                sheet.paste(a.resize((w, h)), (i * 2 * w, 24))
                sheet.paste(b.resize((w, h)), (i * 2 * w + w, 24))
        ImageDraw.Draw(sheet).text((6, 6), f'{vp} / {p}: left = sun shading OFF, right = ON', fill='black')
        sheet.save(os.path.join(D, f'light_sheet_{vp}_{p}.jpg'), quality=86)
        tiles.append(sheet)
    if tiles and vp == 'phone':
        tw = max(t.width for t in tiles)
        all_ = Image.new('RGB', (tw, sum(t.height for t in tiles)), 'white')
        y = 0
        for t in tiles:
            all_.paste(t, (0, y)); y += t.height
        all_.save(os.path.join(D, 'light_sheet_phone_all.jpg'), quality=84)
print('ok')
