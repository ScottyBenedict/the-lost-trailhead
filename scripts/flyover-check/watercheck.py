#!/usr/bin/env python3
"""Check src/data/water.json without opening a browser.

    python3 scripts/flyover-check/watercheck.py [--png]

Rasterizes the water the same way the map does — each polygon filled
even-odd, outline then holes — and reports wet/dry at a list of landmarks.
That catches the things that actually go wrong here (a source that files
glaciers as lakes, a clip that smears a polygon across the map, an island
that stops being a hole) for none of the cost of a GPU run and a screenshot.

--png also writes out/water-mask.png, flat, no relief under it.
"""

import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', '..', 'src', 'data', 'water.json')
OUT = os.path.join(HERE, 'out')

# The frame the data is clipped to, and a raster about as fine as the map's.
W, S, E, N = -130.0, 44.0, -112.0, 50.5
PX = 3000

# Places the map has to get right: the water Scott asked for by name, and
# the land that has been wrongly painted as water along the way. The narrow
# ones (Keechelus, Hood Canal, the Columbia) are a couple of pixels wide at
# this scale, so these are the features' own interior points, not eyeballed
# ones — round them off and the test walks onto the bank.
LANDMARKS = [
    ('Pacific, offshore',      -125.60, 47.20, True),
    ('Pacific, frame edge',    -129.50, 47.00, True),
    ('Strait of Georgia',      -123.50, 49.30, True),
    ('Strait of Juan de Fuca', -123.60, 48.22, True),
    ('Puget Sound, Seattle',   -122.44, 47.60, True),
    ('Hood Canal',             -123.00, 47.55, True),
    ('Grays Harbor',           -123.95, 46.93, True),
    ('Willapa Bay',            -123.95, 46.55, True),
    ('Lake Washington',        -122.25, 47.66, True),
    ('Lake Sammamish',         -122.08, 47.58, True),
    ('Keechelus Lake',         -121.373, 47.355, True),
    ('Kachess Lake',           -121.21, 47.28, True),
    ('Cle Elum Lake',          -121.09, 47.28, True),
    ('Lake Chelan',            -120.21, 47.92, True),
    ('Banks Lake',             -119.20, 47.80, True),
    ('Lake Roosevelt',         -118.25, 48.14, True),
    ('Ross Lake',              -121.06, 48.90, True),
    ('Columbia, Wanapum',      -119.97, 46.93, True),
    ('Columbia, the Gorge',    -121.24, 45.67, True),
    ('Snake, Ice Harbor',      -118.88, 46.25, True),
    ('Seattle, downtown',      -122.33, 47.61, False),
    ('Mount Rainier',          -121.76, 46.85, False),
    ('Mount Baker',            -121.81, 48.78, False),
    ('Glacier Peak',           -121.11, 48.11, False),
    ('Olympic interior',       -123.50, 47.80, False),
    ('Snoqualmie Pass',        -121.41, 47.43, False),
    ('Wenatchee hills',        -120.10, 47.30, False),
    ('Palouse farmland',       -117.60, 46.90, False),
    # The frame reaches well past Washington, so guard its far corners too.
    ('Flathead Lake, MT',      -114.10, 47.87, True),
    ('Lake Pend Oreille, ID',  -116.370, 48.139, True),
    ('Oregon high desert',     -120.00, 44.50, False),
    ('Bitterroots, MT',        -114.50, 46.20, False),
]


def main():
    data = json.load(open(DATA))
    py = int(PX * (N - S) / (E - W))
    img = Image.new('1', (PX, py), 0)
    draw = ImageDraw.Draw(img)

    def to_px(p):
        return ((p[0] - W) / (E - W) * PX, (N - p[1]) / (N - S) * py)

    # Same as the canvas: outline filled, then each hole punched back out.
    for poly in data['ocean'] + data['water']:
        draw.polygon([to_px(p) for p in poly[0]], fill=1)
        for hole in poly[1:]:
            draw.polygon([to_px(p) for p in hole], fill=0)

    pixels = img.load()
    bad = 0
    for name, lon, lat, want_wet in LANDMARKS:
        x, y = to_px((lon, lat))
        if not (0 <= x < PX and 0 <= y < py):
            print(f'  FAIL  {name:24} outside the frame — fix the landmark or BBOX')
            bad += 1
            continue
        wet = bool(pixels[int(x), int(y)])
        ok = wet == want_wet
        bad += not ok
        print(f'  {"ok  " if ok else "FAIL"}  {name:24} {"water" if wet else "land ":5}'
              f'{"" if ok else "   expected " + ("water" if want_wet else "land")}')

    wet_share = sum(img.convert('L').point(lambda v: 1 if v else 0).getdata()) / (PX * py)
    print(f'\n  {len(data["ocean"])} ocean + {len(data["water"])} water polygons, '
          f'{os.path.getsize(DATA) / 1024:.0f} KB, {wet_share * 100:.1f}% of the frame is water')

    if '--png' in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, 'water-mask.png')
        grey = img.convert('L')
        Image.merge('RGB', [grey.point(lambda v: 26 if v else 126),
                            grey.point(lambda v: 42 if v else 158),
                            grey.point(lambda v: 28 if v else 136)]).save(path)
        print(f'  wrote {os.path.relpath(path)}')

    print(f'\n{"all landmarks correct" if not bad else str(bad) + " WRONG"}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
