# python scripts/people_metrics.py <TAG> [device]  -> walk-cycle numbers from the studio side-view frames
# hat_y: top of the yellow sou'wester (px, down = lower); stride: horizontal extent of the boots;
# sole_y: lowest boot pixel (the camera follows the feet's ground height, so variation = feet leaving the deck).
import sys, glob
import numpy as np
from PIL import Image
tag = sys.argv[1]; dev = sys.argv[2] if len(sys.argv) > 2 else 'desktop'
tops, spr, soles = [], [], []
for f in sorted(glob.glob(f'screenshots/people/{tag}_{dev}_walk_side_*.png'))[:16]:
    a = np.asarray(Image.open(f).convert('RGB')).astype(int)[:, 400:900]
    yel = (a[:, :, 0] > 180) & (a[:, :, 1] > 140) & (a[:, :, 2] < 90)
    tops.append(np.where(yel.any(1))[0].min())
    d = a.sum(2) < 170
    bot = np.where(d.any(1))[0].max(); soles.append(bot)
    xs = np.where(d[bot - 60:bot].any(0))[0]; spr.append(xs.max() - xs.min())
tp, sp, so = map(np.array, (tops, spr, soles))
print(f'{tag}: bob range {tp.max()-tp.min()} px | corr(hat lower, stride wider) {np.corrcoef(tp, sp)[0,1]:+.2f} | sole range {so.max()-so.min()} px (0 = feet stay on the deck)')
print('  hat_y', list(map(int, tp))); print('  sole_y', list(map(int, so))); print('  stride', list(map(int, sp)))
