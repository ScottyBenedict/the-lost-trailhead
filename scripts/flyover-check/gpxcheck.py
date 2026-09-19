"""Usage: python3 gpxcheck.py <hike_id | file.gpx> ...
Distance (smoothed), recording gaps, elevation, gain (two methods), out-and-back
vs loop (same test as findApexIndex, cutoff 70m), way-in gaps >=150m (auto-filled
by fillOutboundGaps), and the flight pace the 48s cap gives."""
import sys, bisect
from common import points, hav, smoothed
FT = 3.281
for arg in sys.argv[1:]:
    pts = points(arg); n = len(pts)
    sm = smoothed(pts); dist = sum(hav(sm[i - 1], sm[i]) for i in range(1, n))
    cum = [0]
    for i in range(1, n): cum.append(cum[-1] + hav(pts[i - 1], pts[i]))
    breaks = [(cum[i] / 1609.34, hav(pts[i - 1], pts[i]), (pts[i]['t'] - pts[i - 1]['t']).total_seconds() / 60 if pts[i]['t'] and pts[i - 1]['t'] else None)
              for i in range(1, n) if hav(pts[i - 1], pts[i]) > 60 or (pts[i]['t'] and pts[i - 1]['t'] and (pts[i]['t'] - pts[i - 1]['t']).total_seconds() > 60)]
    e = [p['ele'] or 0 for p in pts]
    g10 = 0; last = e[0]
    for v in e[1:]:
        if v - last >= 10: g10 += v - last; last = v
        elif last - v >= 10: last = v
    xs = [i * 10 for i in range(int(cum[-1] // 10) + 1)]; ev = []; j = 0
    for x in xs:
        while j < n - 2 and cum[j + 1] < x: j += 1
        f = (x - cum[j]) / max(cum[j + 1] - cum[j], 1e-9); ev.append(e[j] + (e[j + 1] - e[j]) * min(max(f, 0), 1))
    s100 = [sum(ev[max(0, i - 5):i + 6]) / len(ev[max(0, i - 5):i + 6]) for i in range(len(ev))]
    g100 = sum(max(0, s100[i] - s100[i - 1]) for i in range(1, len(s100)))
    def idx(d): return min(bisect.bisect_left(cum, d), n - 1)
    best = (1e9, None)
    for i in range(int(n * .15), int(n * .85), 3):
        if all(0 <= cum[i] - k and cum[i] + k <= cum[-1] for k in (50, 100, 200, 400)):
            sc = sum(hav(pts[idx(cum[i] - k)], pts[idx(cum[i] + k)]) for k in (50, 100, 200, 400)) / 4
            if sc < best[0]: best = (sc, i)
    sc, apex = best; oab = apex is not None and sc <= 70
    wayin = [(cum[i] / 1609.34, hav(pts[i - 1], pts[i])) for i in range(1, (apex or n - 1) + 1) if hav(pts[i - 1], pts[i]) >= 150] if oab else []
    path_km = dist / 1000 * (1 if not oab else 2 * (cum[apex] / cum[-1]))
    dur = 2 * min(24, 8 + 1.2 * path_km)
    print(f"== {arg}\n  starts {pts[0]['lat']:.4f},{pts[0]['lon']:.4f}  (check region vs WTA land manager)")
    print(f"  DISTANCE {dist / 1609.34:.2f} mi smoothed  [raw {cum[-1] / 1609.34:.2f}]; start-end gap {hav(pts[0], pts[-1]):.0f} m")
    print(f"  recording breaks: {len(breaks)}" + ''.join(f"\n    at {b[0]:.2f} mi: {b[1]:.0f} m jump" + (f" over {b[2]:.0f} min" if b[2] else '') for b in breaks[:6]))
    print(f"  elevation: start {e[0] * FT:,.0f} ft, high {max(e) * FT:,.0f} ft (net {(max(e) - e[0]) * FT:,.0f})  GAIN 100m-smoothed {g100 * FT:,.0f} ft, 10m hysteresis {g10 * FT:,.0f} ft")
    print(f"  shape: {'OUT-AND-BACK' if oab else 'LOOP'} (retrace {sc:.1f} m)" + (f"; turnaround {cum[apex] / 1609.34:.2f} mi raw" if oab else ''))
    if wayin: print('  WAY-IN GAPS (auto-filled from the return leg; add the missing distance): ' + ', '.join(f'{g[1]:.0f} m at {g[0]:.2f} mi' for g in wayin))
    print(f"  flight: ~{dur:.0f}s at ~{path_km * 1000 / dur:.0f} m/s" + ("  <- FAST: over ~320 m/s jitters; flag to Scott (FLIGHT_SECONDS)" if path_km * 1000 / dur > 320 else ''))
