#!/usr/bin/env python3
"""Rebuild src/data/stateBorders.json — the range map's state lines.

    pip3 install shapely            # once
    python3 scripts/flyover-check/fetchwater.py     # water.json first
    python3 scripts/flyover-check/fetchborders.py

Needs src/data/water.json, because what makes a state line worth drawing is
that it runs over land. A state polygon's boundary is mostly coastline — the
Pacific, the Strait, every inlet of the Sound — and tracing all of it would
draw a white outline around water that is already drawn as water. So each
stretch is probed PROBE_M to either side and dropped if it finds sea.

Only the sea: probing against every lake and river instead cut the 49th
parallel into six pieces, because Ross Lake and friends sit astride it, and
a border that goes dashed every time it crosses a lake is the exact thing
this map is trying to stop doing. The ocean polygon covers the Pacific, the
Strait, the Sound and Hood Canal, which is all the coast there is here.

The output is open lines, not rings, ready to be drawn straight onto the
map as polylines.
"""

import json
import math
import os
import urllib.parse
import urllib.request

from shapely.geometry import Point, box, shape
from shapely.ops import unary_union
from shapely.prepared import prep as prepare

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', '..', 'src', 'data')
OUT = os.path.join(DATA, 'stateBorders.json')
WATER = os.path.join(DATA, 'water.json')

BBOX = (-130.0, 44.0, -112.0, 50.5)
FRAME = box(*BBOX)
STATES = ['Washington', 'Oregon', 'Idaho', 'Montana']
TOL = 0.002
NDIGITS = 4

# How far to either side of a stretch of border to look for water.
PROBE_M = 2500
# Walk the boundary in steps roughly this long, so the probe is a fair test
# of the stretch rather than of one vertex.
STEP_M = 500
# The wet/dry calls are smoothed over this many steps before the line is cut,
# so one stray reading mid-river doesn't chop a continuous border into
# dashes — which is the very thing this map is trying to stop doing.
SMOOTH = 11
# Anything shorter than this is speckle, not a border worth drawing.
MIN_LINE_M = 15000

TIGERWEB = ('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb'
            '/State_County/MapServer/0/query')

M_PER_DEG_LAT = 111320.0


def fetch_states():
    names = ','.join(f"'{s}'" for s in STATES)
    url = TIGERWEB + '?' + urllib.parse.urlencode({
        'where': f'NAME IN ({names})',
        'outFields': 'NAME',
        'outSR': 4326,
        'returnGeometry': 'true',
        'f': 'geojson',
    })
    with urllib.request.urlopen(url, timeout=300) as r:
        d = json.load(r)
    out = {}
    for f in d['features']:
        g = shape(f['geometry'])
        if not g.is_valid:
            g = g.buffer(0)
        out[f['properties']['NAME']] = g
    missing = [s for s in STATES if s not in out]
    if missing:
        raise SystemExit(f'TIGERweb returned no geometry for {missing}')
    return out


def boundary_rings(geom):
    rings = []
    polys = [geom] if geom.geom_type == 'Polygon' else list(geom.geoms)
    for p in polys:
        if p.geom_type != 'Polygon':
            continue
        rings.append(list(p.exterior.coords))
        rings += [list(h.coords) for h in p.interiors]
    return rings


def walk(ring):
    """Points along a ring at roughly STEP_M, with the unit normal at each."""
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        mlon = M_PER_DEG_LAT * math.cos(math.radians((ay + by) / 2)) or 1.0
        dx = (bx - ax) * mlon
        dy = (by - ay) * M_PER_DEG_LAT
        length = math.hypot(dx, dy)
        if length == 0:
            continue
        nx, ny = -dy / length, dx / length          # unit normal, in meters
        for k in range(max(1, math.ceil(length / STEP_M))):
            steps = max(1, math.ceil(length / STEP_M))
            t0, t1 = k / steps, (k + 1) / steps
            yield ((ax + (bx - ax) * t0, ay + (by - ay) * t0),
                   (ax + (bx - ax) * t1, ay + (by - ay) * t1),
                   nx / mlon, ny / M_PER_DEG_LAT)


def main():
    if not os.path.exists(WATER):
        raise SystemExit('run fetchwater.py first — this needs src/data/water.json')
    w = json.load(open(WATER))
    from shapely.geometry import Polygon
    parts = []
    for poly in w['ocean']:
        g = Polygon(poly[0], poly[1:])
        parts.append(g if g.is_valid else g.buffer(0))
    sea = prepare(unary_union(parts))
    print(f'sea: {len(parts)} polygons')

    states = fetch_states()
    print('states:', ', '.join(f'{k} ({states[k].geom_type})' for k in states))

    lines = []
    for name, geom in states.items():
        for ring in boundary_rings(geom.intersection(FRAME.buffer(0.5))):
            steps = list(walk(ring))
            if not steps:
                continue
            wet = []
            for a, b, nx, ny in steps:
                mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                wet.append(sea.contains(Point(mx + nx * PROBE_M, my + ny * PROBE_M))
                           or sea.contains(Point(mx - nx * PROBE_M, my - ny * PROBE_M)))
            # Median filter: a stretch is coastline only if most of its
            # neighbourhood is.
            half = SMOOTH // 2
            smooth = [sum(wet[max(0, i - half):i + half + 1]) * 2 > len(wet[max(0, i - half):i + half + 1])
                      for i in range(len(wet))]
            current = []
            for (a, b, _, _), is_wet in zip(steps, smooth):
                if is_wet:
                    if len(current) > 1:
                        lines.append(current)
                    current = []
                else:
                    if not current:
                        current.append(a)
                    current.append(b)
            if len(current) > 1:
                lines.append(current)

    # Every shared border came back twice, once from each state, and the
    # runs above are still in ring-sized pieces. Union folds the duplicates
    # together; merge joins what is really one line end to end.
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import linemerge
    merged = linemerge(unary_union([LineString(p) for p in lines if len(p) > 1]))
    pieces = [merged] if merged.geom_type == 'LineString' else list(merged.geoms)
    print(f'{len(lines)} runs -> {len(pieces)} merged lines')

    out = []
    dropped = 0
    for piece in pieces:
        clipped = piece.intersection(FRAME)
        for part in ([clipped] if clipped.geom_type == 'LineString'
                     else [g for g in getattr(clipped, 'geoms', []) if g.geom_type == 'LineString']):
            # Degrees to meters, roughly, just to size the piece.
            if part.length * M_PER_DEG_LAT * 0.75 < MIN_LINE_M:
                dropped += 1
                continue
            ring = []
            for x, y in part.simplify(TOL, preserve_topology=False).coords:
                q = [round(x, NDIGITS), round(y, NDIGITS)]
                if not ring or q != ring[-1]:
                    ring.append(q)
            if len(ring) >= 2:
                out.append(ring)
    print(f'dropped {dropped} pieces under {MIN_LINE_M} m')

    data = {
        'source': (f'US Census TIGERweb States ({", ".join(STATES)}), clipped to '
                   f'{BBOX}, simplified to {TOL} deg. Stretches with water within '
                   f'{PROBE_M} m to either side are dropped, so the coast is not '
                   'outlined but the Columbia still is. Rebuild with '
                   'scripts/flyover-check/fetchborders.py'),
        'lines': out,
    }
    with open(OUT, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'wrote {os.path.relpath(OUT)}: {len(out)} lines, '
          f'{sum(len(l) for l in out)} points, {os.path.getsize(OUT) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
