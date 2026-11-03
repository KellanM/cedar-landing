"""Before/after and faceted/smooth sheets from scripts/npcs_capture.mjs output.
python scripts/npcs_compare.py  ->  screenshots/npcs_A_compare.png, screenshots/npcs_A_smooth_compare.png"""
import os
from PIL import Image, ImageDraw, ImageFont

S = os.path.join(os.path.dirname(__file__), '..', 'screenshots')
F = lambda n, s: ImageFont.truetype(os.path.join(r"C:\Windows\Fonts", n), s)
H1, LB = F('georgiab.ttf', 44), F('segoeuib.ttf', 26)
PAPER, INK = (236, 230, 216), (43, 39, 33)


def load(tag, dev, shot, crop=None, w=360):
    im = Image.open(os.path.join(S, f'npcs_A_{tag}_{dev}_{shot}.png')).convert('RGB')
    if crop: im = im.crop(tuple(int(c * s) for c, s in zip(crop, (im.width, im.height, im.width, im.height))))
    k = w / im.width
    return im.resize((w, int(im.height * k)), Image.LANCZOS)


def sheet(title, pairs, labels, out, cols=3, w=360):
    cells = []
    for (a, b), lab in zip(pairs, labels):
        h = max(a.height, b.height)
        c = Image.new('RGB', (2 * w + 30, h + 50), PAPER)
        d = ImageDraw.Draw(c)
        d.text((4, 6), lab, font=LB, fill=INK)
        c.paste(a, (0, 44)); c.paste(b, (w + 20, 44))
        cells.append(c)
    cw = max(c.width for c in cells); chh = max(c.height for c in cells)
    rows = (len(cells) + cols - 1) // cols
    W = Image.new('RGB', (cols * (cw + 30) + 30, rows * (chh + 20) + 110), PAPER)
    d = ImageDraw.Draw(W)
    d.text((30, 26), title, font=H1, fill=INK)
    for i, c in enumerate(cells):
        W.paste(c, (30 + (i % cols) * (cw + 30), 100 + (i // cols) * (chh + 20)))
    W.save(os.path.join(S, out), optimize=True)
    print('wrote', out, W.size)


shots = [('chase', 'chase camera, phone', None), ('street', 'on-foot game camera, phone', None), ('market', 'the market (Marlo, Old Tess)', None),
         ('village', 'the village (Story Keeper, cook)', None), ('village2', 'village kids', None), ('elder', 'Story Keeper (elder)', (0, 0.1, 1, 0.8)),
         ('village_elder2', 'village elder', (0, 0.1, 1, 0.8)), ('smokehouse', 'Smokehouse Keeper', (0, 0.1, 1, 0.8)), ('tess', 'Old Tess (tackle)', (0, 0.1, 1, 0.8)),
         ('juno', 'Dockhand Juno', (0, 0.1, 1, 0.8)), ('cook', 'Cook', (0, 0.1, 1, 0.8)), ('market_mae', "Mae's fish market (talk)", None)]
pairs = [(load('before', 'phone', s, c), load('after', 'phone', s, c)) for s, _, c in shots]
sheet('NPCs, direction A: before (left) | after (right), phone 390×844', pairs, [l for _, l, _ in shots], 'npcs_A_compare.png')
sm = [('elder', 'Story Keeper'), ('marlo', 'Marlo'), ('juno', 'Dockhand Juno')]
pairs = [(load('after', 'phone', f'{s}_faceted', (0, 0.12, 1, 0.72), 480), load('after', 'phone', f'{s}_smooth', (0, 0.12, 1, 0.72), 480)) for s, _ in sm]
sheet('Same A-style NPCs: faceted world material (left) | smooth character material (right)', pairs, [l for _, l in sm], 'npcs_A_smooth_compare.png', cols=3, w=480)
