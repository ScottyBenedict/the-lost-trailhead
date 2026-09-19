"""Usage: python3 snowcheck.py [--release N] <hike_id> ...
Snow share along each route in the flyover's satellite imagery (current Esri
World_Imagery, or a Wayback release). >2-3% avg or a >10% worst tile shows up."""
import sys
from common import points, route_tiles, snow_fraction, cached, CURRENT_IMAGERY, WAYBACK_TILE
args = sys.argv[1:]; release = None
if args[:1] == ['--release']: release, args = args[1], args[2:]
for hid in args:
    ts = route_tiles(points(hid))
    urls = [(WAYBACK_TILE.format(release=release, z=15, y=y, x=x) if release else CURRENT_IMAGERY.format(z=15, y=y, x=x)) for x, y in ts]
    s = [snow_fraction(cached(u, '.jpg')) for u in urls]
    print(f"{hid:28} snow {100 * sum(s) / len(s):5.1f}% avg, worst tile {100 * max(s):5.1f}%")
