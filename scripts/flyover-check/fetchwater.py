#!/usr/bin/env python3
"""Rebuild src/data/water.json — the range map's water, as vector polygons.

Run this only when the water needs to change; the map reads the committed
JSON, not these services. Same idea as src/data/stateBorders.json.

    pip3 install shapely            # once
    python3 scripts/flyover-check/fetchwater.py

Why vector: the obvious shortcut is to pull a rendered hydro basemap (Esri's
or USGS's) and pick the water out of it by pixel color. Every one of those
tiles has its place labels drawn into the image, the anti-aliased edges of
that text are the same blue as a lake outline, and no amount of color
tolerance or mask cleanup separates them — the labels come back as solid
blobs. So the water is fetched as geometry instead, once, here.

Sources:
  - Natural Earth 10m ocean (public domain) — the open Pacific. Coarse, but
    it is a straight edge out there and nothing else covers past the
    territorial limit.
  - USGS NHD "Area - Small Scale" (layer 7) — Puget Sound, the Strait, Hood
    Canal, Grays Harbor, Willapa, and the rivers drawn wide: the Columbia
    and its impoundments (Roosevelt, Banks, Wallula, Umatilla), the Snake.
  - USGS NHD "Waterbody - Small Scale" (layer 10), over 4 km^2 — the lakes:
    Chelan, Washington, Sammamish, Keechelus, Kachess, Cle Elum, Ross,
    Crescent, Wenatchee and the rest at that size.

NHD files a glacier as a waterbody ("Ice Mass"), so without the FTYPE filter
below the icecaps on Rainier, Baker, Adams, Glacier Peak and the Olympics all
come back as lakes — sixteen of them clear the 4 km^2 cut, and Rainier's
alone is 14 km across. Layer 7's "Inundation Area" is a flood zone rather
than water, and goes for the same reason.

Both NHD layers are the small-scale generalizations, which are already
drawn for roughly this zoom.

Shapely does the clipping. A hand-rolled Sutherland-Hodgman pass is not
enough here: Natural Earth's ocean is one ring wrapping the whole globe, so
it leaves and re-enters this frame several times, and Sutherland-Hodgman
joins those separate pieces with chords straight across the map (it can only
return one polygon). That drew a wedge of ocean over the Olympic Peninsula.
"""

import json
import math
import os
import urllib.parse
import urllib.request

from shapely.geometry import Polygon, box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'src', 'data', 'water.json')

# The camera fit is height-constrained on a card this wide, so the frame runs
# to about lon -127.3..-114.5 — much wider than Washington. This box clears
# that with room to spare; clip any tighter and the edge of the data shows up
# on screen as a slanted line (meridians tilt this far off-center at 47N).
BBOX = (-130.0, 44.0, -112.0, 50.5)
# One device pixel at the range map's scale is about 0.0033 deg, so this is
# sub-pixel; the ocean gets twice that, since it is one long smooth edge.
TOL = 0.003
# Coordinates are snapped to this many decimals. It has to stay well finer
# than TOL: at 3 decimals the grid was only a third of the simplify
# tolerance, which is coarse enough to shove two edges of a simplified ring
# across each other. An even-odd fill of a self-crossing ring cancels
# itself, and 260 of 801 polygons came out that way — drawing a hairline of
# bare relief through the ocean in the corner of the map.
NDIGITS = 4

NE_OCEAN = ('https://raw.githubusercontent.com/nvkelso/natural-earth-vector'
            '/master/geojson/ne_10m_ocean.geojson')
NHD = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/{}/query'

FRAME = box(*BBOX)


def fetch(url, params=None):
    if params:
        url = f'{url}?{urllib.parse.urlencode(params)}'
    with urllib.request.urlopen(url, timeout=300) as r:
        return json.load(r)


def nhd(layer, where):
    print(f'  NHD layer {layer}: {where}')
    d = fetch(NHD.format(layer), {
        'where': where,
        'geometry': ','.join(str(v) for v in BBOX),
        'geometryType': 'esriGeometryEnvelope',
        'inSR': 4326, 'outSR': 4326,
        'outFields': 'GNIS_NAME',
        'returnGeometry': 'true', 'f': 'geojson',
    })
    if d.get('exceededTransferLimit'):
        raise SystemExit(f'NHD layer {layer} hit its transfer limit; page the query')
    return [f['geometry'] for f in d['features']]


def polygons(geom: BaseGeometry):
    """Every Polygon in a geometry, whatever it arrived as."""
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    if geom.geom_type in ('MultiPolygon', 'GeometryCollection'):
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def ring(coords, ndigits=None):
    out = []
    for x, y in coords:
        p = [round(x, ndigits or NDIGITS), round(y, ndigits or NDIGITS)]
        if not out or p != out[-1]:
            out.append(p)
    return out


def emit(poly):
    """Rings for one polygon, at the coarsest precision that still fills
    correctly. Repairing a snapped polygon can move a vertex off the grid,
    and rounding it back on undoes the repair — so those few keep a couple
    more decimals rather than going out broken."""
    for ndigits in (NDIGITS, NDIGITS + 2, NDIGITS + 4):
        rings = [ring(poly.exterior.coords, ndigits)]
        rings += [ring(h.coords, ndigits) for h in poly.interiors]
        rings = [r for r in rings if len(r) >= 4]
        if not rings:
            return None
        if Polygon(rings[0], rings[1:]).is_valid:
            return rings
    return None


def snap(geom):
    """Round every coordinate, then repair whatever the rounding broke."""
    snapped = transform(lambda x, y, z=None: (round(x, NDIGITS), round(y, NDIGITS)), geom)
    return snapped if snapped.is_valid else snapped.buffer(0)


def prep(geoms, tol):
    """Clip to the frame, simplify, and emit [exterior, hole, hole, ...] per
    polygon so the renderer can fill each one even-odd."""
    out = []
    for g in geoms:
        s = shape(g)
        if not s.is_valid:
            s = s.buffer(0)            # self-intersections in the source data
        clipped = s.intersection(FRAME)
        if clipped.is_empty:
            continue
        for poly in polygons(snap(clipped.simplify(tol, preserve_topology=True))):
            rings = emit(poly)
            if rings:
                out.append(rings)
    return out


def check(data):
    """Refuse to ship rings that fill wrong. A self-crossing ring is not a
    cosmetic problem here: even-odd treats the crossed-over part as outside
    and punches a line or a wedge straight through the water."""
    bad = []
    for key in ('ocean', 'water'):
        for i, poly in enumerate(data[key]):
            if not Polygon(poly[0], poly[1:]).is_valid:
                bad.append(f'{key}[{i}]')
    return bad


def main():
    print('Natural Earth ocean...')
    ocean = [f['geometry'] for f in fetch(NE_OCEAN)['features']]
    print('USGS NHD...')
    areas = nhd(7, "FTYPE NOT IN ('Inundation Area', 'DamWeir')")
    lakes = nhd(10, "AREASQKM>4 AND FTYPE<>'Ice Mass'")

    data = {
        'source': ('Natural Earth 10m ocean (public domain); USGS National '
                   'Hydrography Dataset small-scale Area (layer 7) and '
                   'Waterbody (layer 10, over 4 sq km, no ice). Clipped to '
                   f'{BBOX}, simplified at {TOL} deg. Rebuild with '
                   'scripts/flyover-check/fetchwater.py'),
        # Each entry is one polygon: [exterior, hole, hole, ...].
        'ocean': prep(ocean, TOL * 2),
        'water': prep(areas, TOL) + prep(lakes, TOL),
    }
    bad = check(data)
    if bad:
        raise SystemExit(f'{len(bad)} polygons are still self-intersecting '
                         f'({", ".join(bad[:5])}...) — not written')
    with open(OUT, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    pts = sum(len(r) for poly in data['ocean'] + data['water'] for r in poly)
    print(f'wrote {os.path.relpath(OUT)}: {len(data["ocean"])} ocean polygons, '
          f'{len(data["water"])} water polygons, {pts} points, '
          f'{os.path.getsize(OUT) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
