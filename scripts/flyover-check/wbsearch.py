"""Usage: python3 wbsearch.py <hike_id>
Finds the newest snow-free Esri Wayback capture along a route and reports its
source date and resolution against the current imagery's (Esri metadata).
Scott's rule: snow-free at the SAME or better detail, otherwise discuss first."""
import sys, re, json, http.client, urllib.request, urllib.parse, concurrent.futures as cf
from common import points, route_tiles, snow_fraction, cached, WAYBACK_TILE, WAYBACK_CONFIG
cfg = json.load(open(cached(WAYBACK_CONFIG, '.json')))
rels = sorted(((v['itemTitle'][-11:-1], int(k)) for k, v in cfg.items()), reverse=True)
def source(rid, x, y, z=15):
    c = http.client.HTTPSConnection('wayback.maptiles.arcgis.com', timeout=30)
    c.request('HEAD', urllib.parse.urlparse(WAYBACK_TILE.format(release=rid, z=z, y=y, x=x)).path); r = c.getresponse()
    m = re.search(r'/tile/(\d+)/', r.getheader('Location') or ''); c.close()
    return int(m.group(1)) if m else rid
def meta(rid, lat, lon):
    url = cfg[str(rid)]['metadataLayerUrl'] + '/4/query?' + urllib.parse.urlencode({'geometry': f'{lon},{lat}', 'geometryType': 'esriGeometryPoint', 'inSR': 4326, 'outFields': 'SRC_DATE,SRC_RES,SRC_DESC', 'returnGeometry': 'false', 'f': 'json'})
    f = json.load(urllib.request.urlopen(url, timeout=30)).get('features') or [{}]
    a = f[0].get('attributes', {}); return f"{a.get('SRC_DATE')} {a.get('SRC_DESC')} {a.get('SRC_RES')}m"
for hid in sys.argv[1:]:
    pts = points(hid); ts = route_tiles(pts); mid = pts[len(pts) // 2]
    jobs = [(rid, t) for _, rid in rels for t in ts]
    with cf.ThreadPoolExecutor(16) as ex: srcs = list(ex.map(lambda j: source(j[0], *j[1]), jobs))
    combos = {}
    for (rid, t), s in zip(jobs, srcs): combos.setdefault(rid, []).append(s)
    seen = {}
    for d, rid in rels:
        key = tuple(combos[rid])
        if key not in seen: seen[key] = (d, rid)
    print(f"== {hid}  current imagery at route midpoint: {meta(rels[0][1], mid['lat'], mid['lon'])}")
    for key, (d, rid) in list(seen.items())[:12]:
        s = [snow_fraction(cached(WAYBACK_TILE.format(release=sid, z=15, y=t[1], x=t[0]), '.jpg')) for sid, t in zip(key, ts)]
        ok = sum(s) / len(s) <= .005 and max(s) <= .02
        print(f"  {d} release {rid}: snow {100 * sum(s) / len(s):4.1f}% avg / {100 * max(s):4.1f}% worst" + (f"  SNOW-FREE, source {meta(rid, mid['lat'], mid['lon'])}" if ok else ''))
