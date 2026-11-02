# python scripts/strip.py "<glob>" out.png [x0 y0 x1 y1] [n] [cols]  -> filmstrip / grid of frames
import sys, glob
from PIL import Image, ImageDraw
fs = sorted(glob.glob(sys.argv[1])); out = sys.argv[2]
crop = tuple(map(int, sys.argv[3:7])) if len(sys.argv) > 6 else None
n = int(sys.argv[7]) if len(sys.argv) > 7 else len(fs); cols = int(sys.argv[8]) if len(sys.argv) > 8 else n
fs = fs[:n]; ims = [Image.open(f).convert('RGB') for f in fs]
if crop: ims = [i.crop(crop) for i in ims]
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (w * cols, h * rows), (30, 30, 30)); d = ImageDraw.Draw(S)
for k, i in enumerate(ims): S.paste(i, ((k % cols) * w, (k // cols) * h)); d.text(((k % cols) * w + 4, (k // cols) * h + 4), str(k), fill=(255, 255, 0))
S.save(out); print(out, S.size, len(ims))
