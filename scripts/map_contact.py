"""Before/after contact sheet for the Map tab: python scripts/map_contact.py [before_tag] [after_tag]
Rows: phone states then desktop states; 'before' only has fresh + revealed. → screenshots/map/contact_before_after.png"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
B = sys.argv[1] if len(sys.argv) > 1 else 'cur'
A = sys.argv[2] if len(sys.argv) > 2 else 'new'
D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'screenshots', 'map')
try:
    font = ImageFont.truetype('arial.ttf', 22)
except OSError:
    font = ImageFont.load_default()

def tile(path, w, h):
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert('RGB')
    im.thumbnail((w, h))
    return im

def sheet(vp, tw, th):
    states = ['fresh', 'partial', 'revealed', 'zoomed', 'dest'] + (['drawer'] if vp == 'phone' else [])
    cols = [(f'{B} fresh', f'{B}_{vp}_fresh'), (f'{B} revealed', f'{B}_{vp}_revealed')] + [(f'{A} {s}', f'{A}_{vp}_{s}') for s in states]
    out = Image.new('RGB', (tw * len(cols), th + 34), 'white')
    d = ImageDraw.Draw(out)
    for i, (label, name) in enumerate(cols):
        t = tile(os.path.join(D, name + '.png'), tw, th)
        if t:
            out.paste(t, (i * tw + (tw - t.width) // 2, 34))
        d.text((i * tw + 8, 6), label, fill=(158, 59, 42) if label.startswith(B + ' ') else (43, 38, 34), font=font)
    return out

p = sheet('phone', 300, 650)
dsk = sheet('desktop', 520, 325)
W = max(p.width, dsk.width)
full = Image.new('RGB', (W, p.height + dsk.height + 10), 'white')
full.paste(p, (0, 0)); full.paste(dsk, (0, p.height + 10))
dst = os.path.join(D, 'contact_before_after.png')
full.save(dst)
print(dst, full.size)
