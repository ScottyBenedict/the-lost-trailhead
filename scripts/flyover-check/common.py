"""Shared helpers for the flyover check scripts (see README.md)."""
import os, re, json, math, hashlib, urllib.request, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CACHE = os.path.join(HERE, '.cache'); OUT = os.path.join(HERE, 'out')
os.makedirs(CACHE, exist_ok=True); os.makedirs(OUT, exist_ok=True)
SUPA = 'https://ikjgtsvauctfmxpqwmyd.supabase.co'
CURRENT_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
WAYBACK_TILE = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{release}/{z}/{y}/{x}'
WAYBACK_CONFIG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'

def anon_key():
    return re.search(r'eyJ[A-Za-z0-9_.-]+', open(os.path.join(ROOT, 'src/lib/supabase.js')).read()).group(0)

def supa(query):
    k = anon_key()
    req = urllib.request.Request(f'{SUPA}/rest/v1/{query}', headers={'apikey': k, 'Authorization': f'Bearer {k}'})
    return json.load(urllib.request.urlopen(req, timeout=30))

def cached(url, ext='.bin'):
    f = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest() + ext)
    if not os.path.exists(f):
        open(f, 'wb').write(urllib.request.urlopen(url, timeout=30).read())
    return f

def gpx_file(hike_or_path):
    if os.path.exists(hike_or_path): return hike_or_path
    rows = supa(f'hike_gpx?select=gpx_url&hike_id=eq.{hike_or_path}')
    if not rows: raise SystemExit(f'no GPX on file for {hike_or_path}')
    return cached(rows[0]['gpx_url'], '.gpx')

def points(hike_or_path):
    """[{lat, lon, ele, t (datetime|None), speed (m/s|None)}] in recorded order."""
    t = open(gpx_file(hike_or_path), encoding='utf-8', errors='ignore').read(); out = []
    for m in re.finditer(r'<trkpt([^>]*)>(.*?)</trkpt>', t, re.S):
        a, b = m.group(1), m.group(2)
        e = re.search(r'<ele>([-\d.]+)</ele>', b); tm = re.search(r'<time>([^<]+)</time>', b); sp = re.search(r'<speed>([-\d.]+)</speed>', b)
        out.append({'lat': float(re.search(r'lat="([-\d.]+)"', a).group(1)), 'lon': float(re.search(r'lon="([-\d.]+)"', a).group(1)),
                    'ele': float(e.group(1)) if e else None,
                    't': datetime.datetime.fromisoformat(tm.group(1).replace('Z', '+00:00')) if tm else None,
                    'speed': float(sp.group(1)) if sp else None})
    return out

def hav(p, q):
    R = 6371000; la1, lo1, la2, lo2 = map(math.radians, (p['lat'], p['lon'], q['lat'], q['lon']))
    return 2 * R * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))

def smoothed(pts, k=7):
    """15s moving average of position (the watch logs ~1 point/s): the distance
    method that matches published figures to ~2%. Raw sums read 4-27% long."""
    out = []
    for i in range(len(pts)):
        w = pts[max(0, i - k):i + k + 1]
        out.append({'lat': sum(p['lat'] for p in w) / len(w), 'lon': sum(p['lon'] for p in w) / len(w)})
    return out

def tile(lat, lon, z):
    n = 2 ** z; r = math.radians(lat)
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)

def route_tiles(pts, z=15, every=60):
    seen, out = set(), []
    for p in pts[::every]:
        xy = tile(p['lat'], p['lon'], z)
        if xy not in seen: seen.add(xy); out.append(xy)
    return out

def snow_fraction(img_path):
    """Share of bright, neutral-white pixels (snow). Granite and dry grass don't count."""
    from PIL import Image
    px = list(Image.open(img_path).convert('RGB').resize((128, 128)).getdata())
    return sum(1 for p in px if min(p) > 205 and max(p) - min(p) < 25) / len(px)
