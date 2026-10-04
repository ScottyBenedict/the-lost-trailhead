"""Usage: python3 export.py <hike_id> ...   |   python3 export.py --all
       python3 export.py --publish   (after approval: staging -> public/gpx/)

Builds the downloadable GPX for a hike from its original recording, as a
separate, cleaned copy. The flyover keeps the raw recording (09-27 rule);
nothing here touches Supabase, the site or the originals.

  1. original   read-only, via flyover-check's cache (common.gpx_file)
  2. trim       exactly where the flyover trims (trimToTrailStart): only
                hikes in TRAIL_START are trimmed; the rest start and end
                where the recording does
  3. cuts       only ranges listed in cuts.json (meters along the trimmed
                track); side quests are detected and reported, never removed
  3b. route     the line the flyover flies: an out-and-back is its way up,
                with gaps filled from the return leg (fillOutboundGaps),
                then retraced back down; a loop is the whole recording
  4. strip      lat, lon, ele only
  5. simplify   Douglas-Peucker at 3 m; checked against the smoothed length
                (raw 1-point-per-second length is inflated by GPS jitter)
  6. write      GPX 1.1, one track, one segment, name/desc/link
  7. check      schema (xmllint), re-parse, table + staging/report.md

Output goes to staging/ (git-ignored): <hike>.gpx, <hike>.png, report.md.

--publish copies the approved staging files to
public/gpx/the-lost-trailhead-<hike>.gpx (minus publish.json's skip list),
removes published files that are no longer staged, and regenerates
src/data/gpxDownloads.js, the list the hike page's Download GPX button
reads. Downloads are snapshots: when a track changes, re-run the export,
review, --publish, and deploy."""
import sys, os, re, json, math, bisect, subprocess, urllib.request
from xml.sax.saxutils import escape, quoteattr
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'flyover-check'))
from common import ROOT, points, hav, smoothed, gpx_file, supa  # noqa: E402

STAGING = os.path.join(HERE, 'staging'); CACHE = os.path.join(HERE, '.cache')
os.makedirs(STAGING, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
SITE = 'thelosttrailhead.com'
MI = 1609.34; FT = 3.281
DEFAULT_RADIUS_M = 60          # trimToTrailStart's default
TOLERANCE = 3                  # meters
TOLERANCES = (5, 4, 3, 2, 1)   # also measured, for the report
MAX_LENGTH_CHANGE = 0.02       # vs the smoothed length; flagged if exceeded
MARK_EVERY = 0.25 * MI


def hikes():
    """id -> {name, trailhead, distance} straight from src/data/hikes.js."""
    js = "import('./src/data/hikes.js').then(({hikes})=>console.log(JSON.stringify(hikes.map(h=>({id:h.id,name:h.name,trailhead:h.trailhead,distance:h.distance})))))"
    out = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return {h['id']: h for h in json.loads(out)}


def flyover_config():
    """TRAIL_START, FORCE_LOOP and TURN_AT_HIGH_POINT from gpxFlyover.js, so
    the export trims and classifies exactly as the site does."""
    src = open(os.path.join(ROOT, 'src/lib/gpxFlyover.js')).read()
    start = {m.group(1): {'lat': float(m.group(2)), 'lon': float(m.group(3)), 'radiusM': float(m.group(4)) if m.group(4) else None}
             for m in re.finditer(r"'([\w-]+)':\s*\{\s*lat:\s*([-\d.]+),\s*lon:\s*([-\d.]+)(?:,\s*radiusM:\s*([\d.]+))?\s*\}", src)}
    def ids(name):
        m = re.search(name + r"\s*=\s*new Set\(\[([^\]]*)\]\)", src)
        return set(re.findall(r"'([\w-]+)'", m.group(1))) if m else set()
    return start, ids('FORCE_LOOP'), ids('TURN_AT_HIGH_POINT')


def cumulative(pts):
    cum = [0.0]
    for i in range(1, len(pts)): cum.append(cum[-1] + hav(pts[i - 1], pts[i]))
    return cum


def trim(pts, pin, radius):
    """trimToTrailStart: first pass within radius in the first half, last pass
    in the second half; an end that never comes near the pin is kept."""
    half = len(pts) // 2; first, last = 0, len(pts) - 1
    for i in range(half):
        if hav(pts[i], pin) <= radius: first = i; break
    for i in range(len(pts) - 1, half - 1, -1):
        if hav(pts[i], pin) <= radius: last = i; break
    return first, last


def apex_index(pts, cum, hike_id, force_loop, high_point):
    """The out-and-back test from gpxcheck.py (retrace score <= 70 m), with
    the site's per-hike overrides. None for a loop."""
    if hike_id in force_loop: return None, None
    n = len(pts)
    def idx(d): return min(bisect.bisect_left(cum, d), n - 1)
    best = (1e9, None)
    for i in range(int(n * .15), int(n * .85), 3):
        if all(0 <= cum[i] - k and cum[i] + k <= cum[-1] for k in (50, 100, 200, 400)):
            sc = sum(hav(pts[idx(cum[i] - k)], pts[idx(cum[i] + k)]) for k in (50, 100, 200, 400)) / 4
            if sc < best[0]: best = (sc, i)
    if best[1] is None or best[0] > 70: return None, best[0]
    if hike_id in high_point:
        return max(range(n), key=lambda i: pts[i]['ele'] or -1e9), best[0]
    return best[1], best[0]


def resample(pts, cum, step=10.0):
    """A point every `step` m along the track, with its distance."""
    out, j = [], 0
    for k in range(int(cum[-1] // step) + 1):
        d = k * step
        while j < len(cum) - 2 and cum[j + 1] < d: j += 1
        f = (d - cum[j]) / max(cum[j + 1] - cum[j], 1e-9); f = min(max(f, 0), 1)
        a, b = pts[j], pts[j + 1]
        out.append({'lat': a['lat'] + (b['lat'] - a['lat']) * f, 'lon': a['lon'] + (b['lon'] - a['lon']) * f, 'd': d})
    return out


def side_quests(pts, cum, apex):
    """Candidate side trips: stretches that leave the line and come back to
    within 20 m of where they left, 150 m to 1.6 km long, reaching at least
    40 m away. The out-and-back turnaround itself is not one. Reported only."""
    rs = resample(pts, cum); n = len(rs); total = cum[-1]
    apex_d = cum[apex] if apex is not None else None
    found = []
    for i in range(n):
        far = 0
        for j in range(i + 1, n):
            path = rs[j]['d'] - rs[i]['d']
            if path > min(1600, 0.25 * total): break
            far = max(far, hav(rs[i], rs[j]))
            if path >= 150 and far >= 40 and hav(rs[i], rs[j]) <= 20:
                if apex_d is None or not (rs[i]['d'] < apex_d < rs[j]['d']):
                    found.append((rs[i]['d'], rs[j]['d'], far))
                break
    merged = []   # overlapping detections of one excursion -> its widest span
    for a, b, far in sorted(found):
        if merged and a <= merged[-1][1]:
            pa, pb, pf = merged[-1]; merged[-1] = (pa, max(pb, b), max(pf, far))
        else:
            merged.append((a, b, far))
    return merged


def leg_differences(pts, cum, apex, threshold=30, min_len=100):
    """Out-and-backs: stretches of one leg more than `threshold` m from
    anywhere on the other leg, at least `min_len` m long."""
    if apex is None: return []
    rs = resample(pts, cum); apex_d = cum[apex]
    up = [p for p in rs if p['d'] <= apex_d]; down = [p for p in rs if p['d'] > apex_d]
    out = []
    for leg, other, name in ((up, down, 'up'), (down, up, 'down')):
        run = None
        for p in leg:
            off = min(hav(p, q) for q in other) if other else 0
            if off > threshold:
                run = [p['d'], p['d'], off] if run is None else [run[0], p['d'], max(run[2], off)]
            else:
                if run and run[1] - run[0] >= min_len: out.append((name, *run))
                run = None
        if run and run[1] - run[0] >= min_len: out.append((name, *run))
    return out


GAP_FILL = {'minGapM': 150, 'maxMatchM': 40}   # terrainFlyover.js


def fill_outbound_gaps(outbound, return_leg):
    """fillOutboundGaps from terrainFlyover.js: a jump of 150 m+ on the way
    up is replaced by the stretch of the way down between its two ends."""
    def nearest(p):
        best, bd = -1, float('inf')
        for k, q in enumerate(return_leg):
            d = hav(p, q)
            if d < bd: bd, best = d, k
        return best if bd <= GAP_FILL['maxMatchM'] else -1
    out, filled = [outbound[0]], []
    for i in range(1, len(outbound)):
        a, b = outbound[i - 1], outbound[i]
        if hav(a, b) >= GAP_FILL['minGapM']:
            ib, ia = nearest(b), nearest(a)
            if ib >= 0 and ia > ib + 1:
                fill = list(reversed(return_leg[ib + 1:ia])); out += fill
                filled.append((hav(a, b), len(fill)))
        out.append(b)
    return out, filled


def douglas_peucker(pts, tol):
    """Indices kept, on a local flat projection (fine at hike scale)."""
    lat0 = math.radians(sum(p['lat'] for p in pts) / len(pts))
    xy = [(math.radians(p['lon']) * 6371000 * math.cos(lat0), math.radians(p['lat']) * 6371000) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop(); (x1, y1), (x2, y2) = xy[a], xy[b]
        dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy); worst, wi = -1, None
        for i in range(a + 1, b):
            x, y = xy[i]
            d = abs(dy * (x - x1) - dx * (y - y1)) / L if L else math.hypot(x - x1, y - y1)
            if d > worst: worst, wi = d, i
        if wi is not None and worst > tol:
            keep[wi] = True; stack += [(a, wi), (wi, b)]
    return [i for i, k in enumerate(keep) if k]


def write_gpx(path, hike, pts):
    url = f"https://{SITE}/hikes/{hike['id']}"
    name = escape(hike['name'])
    desc = escape(f"The Lost Trailhead, {SITE}/hikes/{hike['id']}. Conditions change. Use at your own risk.")
    rows = ''.join(f'<trkpt lat="{p["lat"]:.6f}" lon="{p["lon"]:.6f}">' + (f'<ele>{p["ele"]:.1f}</ele>' if p['ele'] is not None else '') + '</trkpt>\n' for p in pts)
    open(path, 'w', encoding='utf-8').write(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<gpx version="1.1" creator="The Lost Trailhead" xmlns="http://www.topografix.com/GPX/1/1" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n'
        f'<metadata><name>{name}</name><desc>{desc}</desc><link href={quoteattr(url)}><text>{name} on The Lost Trailhead</text></link></metadata>\n'
        f'<trk><name>{name}</name><link href={quoteattr(url)}><text>{name} on The Lost Trailhead</text></link><trkseg>\n{rows}</trkseg></trk>\n</gpx>\n')


def schema_check(path):
    xsd = os.path.join(CACHE, 'gpx.xsd')
    if not os.path.exists(xsd):
        open(xsd, 'wb').write(urllib.request.urlopen('https://www.topografix.com/GPX/1/1/gpx.xsd', timeout=30).read())
    r = subprocess.run(['xmllint', '--noout', '--schema', xsd, path], capture_output=True, text=True)
    return r.returncode == 0, (r.stderr or r.stdout).strip().splitlines()[-1].replace(STAGING + '/', '')


def export(hike_id, H, cfg, cuts):
    hike = H[hike_id]; start, force_loop, high_point = cfg
    src = gpx_file(hike_id); orig = points(hike_id); orig_cum = cumulative(orig)
    s = start.get(hike_id)
    pin = {'lat': s['lat'], 'lon': s['lon']} if s else {'lat': hike['trailhead'][0], 'lon': hike['trailhead'][1]}
    radius = (s or {}).get('radiusM') or DEFAULT_RADIUS_M
    first, last = trim(orig, pin, radius) if s else (0, len(orig) - 1)   # flyover only trims TRAIL_START hikes
    tr = orig[first:last + 1]; tr_cum = cumulative(tr)

    removed = []   # explicit cuts only, meters along the trimmed track
    keep = [True] * len(tr)
    for c in cuts.get(hike_id, []):
        removed.append((c['from_m'], c['to_m'], c.get('why', '')))
        for i, d in enumerate(tr_cum):
            if c['from_m'] < d < c['to_m']: keep[i] = False
    kept = [p for p, k in zip(tr, keep) if k]; kept_cum = cumulative(kept)

    apex_k, _ = apex_index(kept, kept_cum, hike_id, force_loop, high_point)
    gap_fills = []
    if apex_k is not None:   # out-and-back: the flyover's line, up then retraced
        kept, gap_fills = fill_outbound_gaps(kept[:apex_k + 1], kept[apex_k:])
        kept_cum = cumulative(kept)
    sm_kept = smoothed(kept); sm_kept_len = sum(hav(sm_kept[i - 1], sm_kept[i]) for i in range(1, len(sm_kept)))
    tried = []   # (tol, points, change vs raw trimmed length, change vs smoothed length)
    for t in TOLERANCES:
        i2 = douglas_peucker(kept, t); L2 = cumulative([kept[k] for k in i2])[-1]
        tried.append((t, len(i2), 1 - L2 / kept_cum[-1], 1 - L2 / sm_kept_len))
    simp = [kept[k] for k in douglas_peucker(kept, TOLERANCE)]
    tol, _, _, change = next(x for x in tried if x[0] == TOLERANCE)
    cap_met = abs(change) <= MAX_LENGTH_CHANGE
    if apex_k is not None:
        simp = simp + simp[-2::-1]   # same line back to the trailhead
    final = [{'lat': p['lat'], 'lon': p['lon'], 'ele': p['ele']} for p in simp]
    out = os.path.join(STAGING, f'{hike_id}.gpx'); write_gpx(out, hike, final)

    ok_schema, schema_msg = schema_check(out)
    back = points(out)
    reparse_ok = len(back) == len(final) and all(abs(a['lat'] - b['lat']) < 1e-6 and abs(a['lon'] - b['lon']) < 1e-6 for a, b in zip(back, final))
    one_seg = open(out).read().count('<trkseg>') == 1 and open(out).read().count('<trk>') == 1
    has_time = '<time>' in open(out).read() or '<extensions>' in open(out).read()

    apex, retrace = apex_index(tr, tr_cum, hike_id, force_loop, high_point)
    sm = smoothed(tr); sm_len = sum(hav(sm[i - 1], sm[i]) for i in range(1, len(sm)))
    page_mi = float(re.match(r'([\d.]+)', hike['distance']).group(1))
    final_len = cumulative(final)[-1]
    r = dict(
        hike=hike_id, name=hike['name'], page_mi=page_mi,
        orig_pts=len(orig), orig_mi=orig_cum[-1] / MI, orig_kb=os.path.getsize(src) / 1024,
        orig_start_to_pin=hav(orig[0], pin), orig_end_to_pin=hav(orig[-1], pin),
        trim_before_m=orig_cum[first], trim_after_m=orig_cum[-1] - orig_cum[last],
        pin_src='TRAIL_START (flyover trim)' if s else 'hikes.js trailhead (flyover does not trim this hike)', radius=radius,
        trim_pts=len(tr), trim_mi=tr_cum[-1] / MI, smooth_mi=sm_len / MI,
        start_to_pin=hav(final[0], pin), end_to_pin=hav(final[-1], pin),
        tol=tol, tried=tried, change=change, cap_met=cap_met,
        final_pts=len(final), final_mi=final_len / MI, final_kb=os.path.getsize(out) / 1024,
        shape='out-and-back' if apex is not None else 'loop', retrace=retrace,
        up_mi=(tr_cum[apex] / MI) if apex is not None else None,
        down_mi=((tr_cum[-1] - tr_cum[apex]) / MI) if apex is not None else None,
        side_quests=side_quests(tr, tr_cum, apex), legs=leg_differences(tr, tr_cum, apex),
        route='ascent, retraced' if apex_k is not None else 'whole recording', gap_fills=gap_fills,
        cuts=removed, schema=ok_schema, schema_msg=schema_msg, reparse=reparse_ok, one_seg=one_seg, no_time=not has_time)
    draw(hike, orig, first, last, tr, tr_cum, keep, final, pin, radius, r)
    return r


def draw(hike, orig, first, last, tr, tr_cum, keep, final, pin, radius, r):
    from PIL import Image, ImageDraw, ImageFont
    W, H_, M = 1600, 1600, 110
    allp = orig + [pin]
    lat0 = math.radians(sum(p['lat'] for p in allp) / len(allp))
    def xy(p): return (math.radians(p['lon']) * 6371000 * math.cos(lat0), math.radians(p['lat']) * 6371000)
    pts = [xy(p) for p in allp]; xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    span = max(max(xs) - min(xs), max(ys) - min(ys), 200); sc = (W - 2 * M) / span
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    def px(p): x, y = xy(p); return (W / 2 + (x - cx) * sc, H_ / 2 + 60 - (y - cy) * sc)
    img = Image.new('RGB', (W, H_ + 120), (250, 248, 243)); d = ImageDraw.Draw(img)
    f = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 22); fs = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18)
    fb = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 30)
    def line(seq, color, w):
        if len(seq) > 1: d.line([px(p) for p in seq], fill=color, width=w, joint='curve')
    # side-quest candidates and leg differences under everything
    for a, b, _ in r['side_quests']:
        line([p for p, c in zip(tr, tr_cum) if a <= c <= b], (236, 160, 220), 22)
    for leg, a, b, _ in r['legs']:
        line([p for p, c in zip(tr, tr_cum) if a <= c <= b], (160, 200, 245), 22)
    line(orig, (190, 190, 190), 9)                                   # original recording
    line(orig[:first + 1], (220, 60, 50), 9); line(orig[last:], (220, 60, 50), 9)  # trimmed off
    run = []
    for p, k in zip(tr, keep):                                      # explicit cuts
        if not k: run.append(p)
        elif run: line(run, (240, 140, 0), 9); run = []
    if run: line(run, (240, 140, 0), 9)
    line(final, (30, 90, 50), 3)                                    # cleaned download
    # radius ring + pin
    x, y = px(pin); rr = radius * sc
    if rr > 4: d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=(30, 90, 50), width=1)
    d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(255, 255, 255), outline=(0, 0, 0), width=3)
    d.text((x + 14, y - 30), 'pin', font=f, fill=(0, 0, 0))
    # distance markers along the trimmed track (the coordinate cuts.json uses)
    k = 1
    while k * MARK_EVERY < tr_cum[-1]:
        dist = k * MARK_EVERY; i = min(bisect.bisect_left(tr_cum, dist), len(tr) - 1)
        x, y = px(tr[i]); j = min(i + 5, len(tr) - 1); x2, y2 = px(tr[j])
        nx, ny = -(y2 - y), (x2 - x); L = math.hypot(nx, ny) or 1; ox, oy = nx / L * 26, ny / L * 26
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(30, 90, 50))
        lab = f'{dist / MI:.2f}'.rstrip('0').rstrip('.')
        tw = d.textlength(lab, font=fs); d.text((x + ox - tw / 2, y + oy - 10), lab, font=fs, fill=(30, 60, 40))
        k += 1
    for n_, (a, b, far) in enumerate(r['side_quests'], 1):
        i = min(bisect.bisect_left(tr_cum, (a + b) / 2), len(tr) - 1); x, y = px(tr[i])
        d.text((x + 16, y + 6), f'SQ{n_}', font=f, fill=(170, 30, 140))
    # scale bar (0.25 mi) and title/legend
    bar = MARK_EVERY * sc; d.line([(M, H_ + 60), (M + bar, H_ + 60)], fill=(0, 0, 0), width=4)
    d.text((M, H_ + 68), '0.25 mi', font=fs, fill=(0, 0, 0))
    d.text((M, 24), f"{hike['name']}  ·  original {r['orig_mi']:.2f} mi  >  download {r['final_mi']:.2f} mi  ·  page {r['page_mi']} mi", font=fb, fill=(0, 0, 0))
    leg = [((190, 190, 190), 'original recording'), ((220, 60, 50), 'trimmed off (before/after trailhead)'), ((240, 140, 0), 'cut (cuts.json)'),
           ((30, 90, 50), 'download (cleaned)'), ((236, 160, 220), 'side-quest candidate (not removed)'), ((160, 200, 245), 'up/down legs differ')]
    lx, ly = M, 82
    for color, text in leg:
        w = 42 + d.textlength(text, font=fs)
        if lx + w > W - 20: lx, ly = M, ly + 30
        d.line([(lx, ly), (lx + 34, ly)], fill=color, width=9); d.text((lx + 42, ly - 12), text, font=fs, fill=(0, 0, 0)); lx += w + 30
    d.text((M + bar + 40, H_ + 60), 'green dots: miles along the trimmed recording (the scale cuts.json uses, in meters)', font=fs, fill=(30, 60, 40))
    img.save(os.path.join(STAGING, f"{hike['id']}.png"))


def report(rows):
    def m(x): return f'{x:,.0f} m'
    L = ['# GPX export: review\n', '| hike | original pts / mi / kB | download pts / mi / kB | start / end to pin | DP tol, change vs smoothed | page mi | vs page | legs up / down | checks |', '|---|---|---|---|---|---|---|---|---|']
    for r in rows:
        diff = (r['final_mi'] - r['page_mi']) / r['page_mi']
        legs = f"{r['up_mi']:.2f} / {r['down_mi']:.2f}" if r['up_mi'] is not None else 'loop'
        checks = ('schema ok' if r['schema'] else 'SCHEMA FAIL') + (', reparse ok' if r['reparse'] else ', REPARSE FAIL') + (', 1 trk/1 seg' if r['one_seg'] else ', SEG FAIL') + (', no time/ext' if r['no_time'] else ', HAS TIME')
        L.append(f"| {r['name']} | {r['orig_pts']:,} / {r['orig_mi']:.2f} / {r['orig_kb']:,.0f} | {r['final_pts']:,} / {r['final_mi']:.2f} / {r['final_kb']:,.0f} | {m(r['start_to_pin'])} / {m(r['end_to_pin'])} | {r['tol']} m, {r['change'] * 100:+.1f}%{'' if r['cap_met'] else ' **cap not met**'} | {r['page_mi']} | {diff * 100:+.0f}%{' **>10%**' if abs(diff) > .10 else ''} | {legs} | {checks} |")
    for r in rows:
        L += [f"\n## {r['name']}", f"- Pin: {r['pin_src']}" + (f", trim radius {r['radius']:.0f} m" if r['pin_src'].startswith('TRAIL_START') else '') + f". Recording starts {m(r['orig_start_to_pin'])} and ends {m(r['orig_end_to_pin'])} from the pin; trimmed off {m(r['trim_before_m'])} before and {m(r['trim_after_m'])} after.",
              f"- Shape: {r['shape']}" + (f" (retrace {r['retrace']:.0f} m)" if r['retrace'] else '') + f"; download = {r['route']}" + (''.join(f"; filled a {g:,.0f} m gap with {n} points from the way down" for g, n in r['gap_fills'])) + f". Trimmed track {r['trim_mi']:.2f} mi raw, {r['smooth_mi']:.2f} mi smoothed (the README's distance).",
              f"- Simplify (length change vs raw / vs smoothed): " + ', '.join(f"{t} m → {n:,} pts, {c * 100:+.1f}% / {cs * 100:+.1f}%" for t, n, c, cs in r['tried']) + '.',
              f"- Schema: {r['schema_msg']}"]
        if r['side_quests']:
            L.append('- Side-quest candidates (not removed): ' + '; '.join(f"SQ{i}: {a / MI:.2f}–{b / MI:.2f} mi ({a:,.0f}–{b:,.0f} m), {b - a:,.0f} m long, reaches {far:,.0f} m out" for i, (a, b, far) in enumerate(r['side_quests'], 1)))
        else:
            L.append('- Side-quest candidates: none found.')
        if r['legs']:
            L.append('- Up/down legs differ: ' + '; '.join(f"{leg} leg {a / MI:.2f}–{b / MI:.2f} mi ({a:,.0f}–{b:,.0f} m), up to {off:,.0f} m apart" for leg, a, b, off in r['legs']))
        if r['cuts']:
            L.append('- Cuts applied: ' + '; '.join(f"{a:,.0f}–{b:,.0f} m ({why})" for a, b, why in r['cuts']))
    open(os.path.join(STAGING, 'report.md'), 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L))


def publish():
    import shutil, filecmp
    skip = json.load(open(os.path.join(HERE, 'publish.json')))['skip']
    pub = os.path.join(ROOT, 'public', 'gpx'); os.makedirs(pub, exist_ok=True)
    staged = sorted(f[:-4] for f in os.listdir(STAGING) if f.endswith('.gpx'))
    ids = [h for h in staged if h not in skip]
    names = {f'the-lost-trailhead-{h}.gpx' for h in ids}
    for f in os.listdir(pub):
        if f.endswith('.gpx') and f not in names: os.remove(os.path.join(pub, f)); print('  removed', f)
    for h in ids:
        src, dst = os.path.join(STAGING, f'{h}.gpx'), os.path.join(pub, f'the-lost-trailhead-{h}.gpx')
        shutil.copyfile(src, dst); assert filecmp.cmp(src, dst, shallow=False)
    open(os.path.join(ROOT, 'src', 'data', 'gpxDownloads.js'), 'w').write(
        '// Generated by scripts/gpx-export/export.py --publish. Do not edit by hand.\n'
        '// Hikes with a cleaned GPX at public/gpx/the-lost-trailhead-<id>.gpx; the\n'
        '// hike page shows its Download GPX button only for these.\n'
        'export const GPX_DOWNLOADS = new Set([\n' + ''.join(f"  '{h}',\n" for h in ids) + '])\n')
    print(f'  published {len(ids)} files to public/gpx/; skipped: ' + (', '.join(f'{h} ({why})' for h, why in skip.items()) or 'none'))


if __name__ == '__main__':
    if len(sys.argv) < 2: raise SystemExit(__doc__)
    if sys.argv[1:] == ['--publish']: publish(); raise SystemExit
    H = hikes(); cfg = flyover_config()
    cuts = json.load(open(os.path.join(HERE, 'cuts.json')))
    ids = [r['hike_id'] for r in supa('hike_gpx?select=hike_id&order=hike_id')] if sys.argv[1:] == ['--all'] else sys.argv[1:]
    report([export(h, H, cfg, cuts) for h in ids])
