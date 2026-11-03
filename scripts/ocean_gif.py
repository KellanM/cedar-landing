"""Ocean experiment GIFs: python scripts/ocean_gif.py <framesDir> <outDir> [panelWidth]

framesDir holds one folder per case (from scripts/ocean_capture.mjs) with <ocean>_NN.jpg frames and
<ocean>_times.json. Writes one GIF per case: Classic | Swell, or old | new (pass 2), side by side (whichever exist), played at
the captured real-time pace (the mean frame interval).
"""
import json, os, sys
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 420
os.makedirs(out, exist_ok=True)
for case in sorted(os.listdir(src)):
    d = os.path.join(src, case)
    if not os.path.isdir(d):
        continue
    oceans = [o for o in ('classic', 'swell', 'old', 'new', 'before', 'after') if os.path.exists(os.path.join(d, f'{o}_times.json'))]
    if not oceans:
        continue
    seqs, times = {}, []
    for o in oceans:
        fs = sorted(f for f in os.listdir(d) if f.startswith(o + '_') and f.endswith('.jpg'))
        seqs[o] = fs
        t = json.load(open(os.path.join(d, f'{o}_times.json')))
        if len(t) > 1:
            times.append((t[-1] - t[0]) / (len(t) - 1))
    n = min(len(v) for v in seqs.values())
    frames = []
    for i in range(n):
        ims = []
        for o in oceans:
            im = Image.open(os.path.join(d, seqs[o][i])).convert('RGB')
            im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
            ims.append(im)
        h = ims[0].height
        f = Image.new('RGB', (W * len(ims) + 6 * (len(ims) - 1), h + 20), (233, 225, 207))
        dr = ImageDraw.Draw(f)
        for k, (o, im) in enumerate(zip(oceans, ims)):
            f.paste(im, (k * (W + 6), 20))
            name = {'old': 'Swell v0.10.1', 'new': 'Ocean pass 2', 'before': 'Before', 'after': 'Hull splashes'}.get(o, o.capitalize())
            dr.text((k * (W + 6) + 6, 4), f'{name} - {case}', fill=(40, 40, 40))
        frames.append(f.quantize(colors=200, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    dur = int(sum(times) / len(times)) if times else 120
    frames[0].save(os.path.join(out, f'{case}.gif'), save_all=True, append_images=frames[1:], duration=dur, loop=0, optimize=True)
    print(case, n, 'frames', dur, 'ms')
