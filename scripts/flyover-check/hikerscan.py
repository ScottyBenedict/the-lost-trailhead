"""Usage: python3 hikerscan.py <hike_id>
Finds the orange hiker dot in each out/scan-<hike>-*.png frame. Reports frames
where it's missing (out of frame) and the closest it gets to an edge (px)."""
import sys, glob, os
from PIL import Image
from common import OUT
hike = sys.argv[1]; files = sorted(glob.glob(os.path.join(OUT, f'scan-{hike}-*.png')))
W, H = 700, 530; worst = (1e9, None, 0, 0); missing = []
for f in files:
    px = Image.open(f).convert('RGB').load(); xs, ys = [], []
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            r, g, b = px[x, y]
            if r > 230 and 140 < g < 190 and b < 60: xs.append(x); ys.append(y)
    t = int(f.rsplit('-', 1)[1][:5]) / 1000
    if len(xs) <= 3: missing.append(t); continue
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys); m = min(cx, W - cx, cy, H - cy)
    if m < worst[0]: worst = (m, t, cx, cy)
print(f"{hike}: {len(files)} frames; hiker missing at: {missing or 'never'}; closest to an edge: {worst[0]:.0f}px at t={worst[1]}s")
