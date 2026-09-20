#!/usr/bin/env python3
"""Local pipeline: do the heavy lifting here, not on Supabase.

    pip3 install pillow
    python3 scripts/photopipe.py optimize public/photos [--dry-run]
    python3 scripts/photopipe.py prepare <src_dir> [-o out_dir]
    python3 scripts/photopipe.py gpx <file.gpx>... [--dry-run]
    python3 scripts/photopipe.py audit          # needs SUPABASE_SERVICE_ROLE_KEY

Photos reach the site two ways: committed under public/photos and served
by Vercel, or uploaded through the admin page into Supabase Storage. Both
were carrying full-size originals — 7-11 MB each — which is slow for
visitors, put .git at 250 MB, and on the Supabase side used the whole 5 GB
monthly CDN allowance and got the project restricted on 2026-09-19.

This tool is deliberately NOT the only thing standing between an original
and the site, because anyone with admin access can upload from the browser
and no local tool can gate that. There are three layers:

  1. src/lib/adminUtils.js resizes in the browser, so normal uploads are
     already small whoever makes them.
  2. The bucket's file_size_limit rejects anything oversized server-side,
     whatever client sent it. That is the actual gate.
  3. This, for the bulk work the browser should not be doing: the
     committed photos, a season's worth of new ones at once, and the GPX.

`prepare` produces files to hand to the admin page as usual, so the
multi-user path is unchanged — what goes into it is just already small.

COMMANDS

optimize  Re-encode images in place (public/photos and the like). Skips
          anything already small. Reports before/after.
prepare   Take a folder of originals — HEIC included — and write
          web-sized copies plus a manifest with each photo's SHA-256,
          capture time and GPS. EXIF is stripped from the output; the
          capture data is recorded in the manifest instead, so trailhead
          and home coordinates are not published inside the files.
gpx       Drop the trackpoint extensions the site never reads
          (course, hAcc, vAcc), keeping lon/lat/ele/time/speed exactly.
          About a third smaller, and nothing that feeds a distance or a
          flyover changes. Verifies that before writing.
audit     List anything already in Storage that is over budget.
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

# Matches src/lib/adminUtils.js — see the note there for why these sizes.
PHOTO_MAX_EDGE, PHOTO_QUALITY = 2048, 82
THUMB_MAX_EDGE, THUMB_QUALITY = 800, 78
# Re-encoding something already this small is not worth the quality loss.
SKIP_UNDER = 400 * 1024

IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'}
# The trackpoint children gpxFlyover.js never reads. <speed> is used
# (terrainFlyover.js) and stays.
GPX_DROP = ('course', 'hAcc', 'vAcc', 'hacc', 'vacc')

URL = 'https://ikjgtsvauctfmxpqwmyd.supabase.co'


def human(n):
    for unit in ('B', 'kB', 'MB', 'GB'):
        if abs(n) < 1024 or unit == 'GB':
            return f'{n:,.0f} {unit}' if unit == 'B' else f'{n:,.1f} {unit}'
        n /= 1024


def encode(img, max_edge, quality):
    """Downscale and encode, dropping EXIF (including GPS) on the way out."""
    img = ImageOps.exif_transpose(img).convert('RGB')
    if max(img.size) > max_edge:
        img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
    return buf.getvalue(), img.size


def read_capture(path):
    """DateTimeOriginal and GPS, read before the EXIF is discarded. The same
    pair PR #1 uses to match a photo against the library, since file_hash
    cannot: every upload is re-encoded, so its hash never matches the
    original's."""
    out = {}
    try:
        img = Image.open(path)
        exif = img.getexif()
        if not exif:
            return out
        out['captured_at'] = exif.get(36867) or exif.get(306)
        gps = exif.get_ifd(34853) if hasattr(exif, 'get_ifd') else None
        if gps:
            def deg(v, ref):
                d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
                return -d if ref in ('S', 'W') else d
            if 2 in gps and 4 in gps:
                out['lat'] = round(deg(gps[2], gps.get(1)), 6)
                out['lon'] = round(deg(gps[4], gps.get(3)), 6)
    except Exception:
        pass
    return {k: v for k, v in out.items() if v}


def images_under(root):
    if os.path.isfile(root):
        return [root]
    found = []
    for base, _, files in os.walk(root):
        for f in sorted(files):
            if os.path.splitext(f)[1].lower() in IMAGE_EXT:
                found.append(os.path.join(base, f))
    return found


def cmd_optimize(args):
    files = images_under(args.path)
    print(f'{len(files)} images under {args.path}{" (dry run)" if args.dry_run else ""}\n')
    before = after = 0
    changed = 0
    for path in files:
        size = os.path.getsize(path)
        before += size
        if size < SKIP_UNDER:
            after += size
            continue
        try:
            data, dims = encode(Image.open(path), PHOTO_MAX_EDGE, PHOTO_QUALITY)
        except OSError as e:
            print(f'  skip {path}: {e}')
            after += size
            continue
        if len(data) >= size:
            after += size
            continue
        after += len(data)
        changed += 1
        print(f'  {os.path.relpath(path):52} {human(size):>10} -> {human(len(data)):>9}  {dims[0]}x{dims[1]}')
        if not args.dry_run:
            # Same name: these are referenced by path from hikes.js.
            with open(path, 'wb') as f:
                f.write(data)
    print(f'\n  {changed} rewritten, {human(before)} -> {human(after)} '
          f'({100 - after * 100 // max(1, before)}% smaller)')
    if args.dry_run:
        print('  dry run — nothing was written')


def cmd_prepare(args):
    files = images_under(args.src)
    out = args.out or os.path.join('build', 'ingest', os.path.basename(os.path.normpath(args.src)))
    os.makedirs(out, exist_ok=True)
    print(f'{len(files)} images -> {out}\n')
    manifest = []
    before = after = 0
    for i, path in enumerate(files, 1):
        raw = os.path.getsize(path)
        before += raw
        capture = read_capture(path)
        with open(path, 'rb') as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        try:
            img = Image.open(path)
            photo, dims = encode(img, PHOTO_MAX_EDGE, PHOTO_QUALITY)
            thumb, _ = encode(Image.open(path), THUMB_MAX_EDGE, THUMB_QUALITY)
        except OSError as e:
            print(f'  [{i:3}] {os.path.basename(path)}: FAILED ({e})')
            continue
        name = os.path.splitext(os.path.basename(path))[0] + '.jpg'
        with open(os.path.join(out, name), 'wb') as f:
            f.write(photo)
        with open(os.path.join(out, 'thumb_' + name), 'wb') as f:
            f.write(thumb)
        after += len(photo) + len(thumb)
        manifest.append({'source': os.path.basename(path), 'file': name,
                         'sha256_original': digest, 'width': dims[0], 'height': dims[1],
                         **capture})
        print(f'  [{i:3}/{len(files)}] {os.path.basename(path):30} {human(raw):>10} -> '
              f'{human(len(photo)):>9} + {human(len(thumb)):>8} thumb'
              + ('  [gps stripped]' if 'lat' in capture else ''))
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f'\n  {human(before)} -> {human(after)} '
          f'({100 - after * 100 // max(1, before)}% smaller)')
    print(f'  manifest: {os.path.join(out, "manifest.json")}')
    print('  Upload the .jpg files through the admin page as usual — they are '
          'already at final size, so the browser will leave them alone.')


def trim_gpx(text):
    trimmed = re.sub(r'<(%s)>[^<]*</\1>' % '|'.join(GPX_DROP), '', text)
    trimmed = re.sub(r'<extensions>\s*</extensions>', '', trimmed)
    return re.sub(r'>\s+<', '><', trimmed)


def gpx_fields(text):
    """Everything the site reads out of a track, for before/after comparison."""
    points = []
    for pt in re.finditer(r'<trkpt[^>]*lon="([^"]+)"[^>]*lat="([^"]+)"[^>]*>(.*?)</trkpt>', text, re.S):
        lon, lat, body = pt.group(1), pt.group(2), pt.group(3)
        def tag(name):
            m = re.search(r'<%s>([^<]*)</%s>' % (name, name), body)
            return m.group(1) if m else None
        points.append((lon, lat, tag('ele'), tag('time'), tag('speed')))
    return points


def cmd_gpx(args):
    total_before = total_after = 0
    for path in args.files:
        text = open(path, encoding='utf-8', errors='replace').read()
        trimmed = trim_gpx(text)
        before, after = len(text.encode()), len(trimmed.encode())
        total_before += before
        total_after += after
        same = gpx_fields(text) == gpx_fields(trimmed)
        status = 'identical' if same else 'CHANGED — not written'
        print(f'  {os.path.basename(path):40} {human(before):>10} -> {human(after):>9}  '
              f'lon/lat/ele/time/speed {status}')
        if same and not args.dry_run:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(trimmed)
    print(f'\n  {human(total_before)} -> {human(total_after)} '
          f'({100 - total_after * 100 // max(1, total_before)}% smaller)')
    if args.dry_run:
        print('  dry run — nothing was written')


def cmd_audit(args):
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not key:
        raise SystemExit('set SUPABASE_SERVICE_ROLE_KEY (dashboard > Settings > API)')
    # storage.objects is not exposed through PostgREST, so the sizes come
    # from a HEAD against each object the photos table knows about.
    budget = {'hike-photos': 3 * 1024 * 1024, 'avatars': 1024 * 1024, 'gpx-files': 8 * 1024 * 1024}
    q = urllib.parse.urlencode({'select': 'storage_path'})
    req = urllib.request.Request(f'{URL}/rest/v1/hike_photos?{q}')
    req.add_header('apikey', key)
    req.add_header('Authorization', f'Bearer {key}')
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.load(r)
    over = []
    for row in rows:
        url = f"{URL}/storage/v1/object/hike-photos/{urllib.parse.quote(row['storage_path'])}"
        head = urllib.request.Request(url, method='HEAD')
        head.add_header('apikey', key)
        head.add_header('Authorization', f'Bearer {key}')
        try:
            with urllib.request.urlopen(head, timeout=60) as r:
                size = int(r.headers.get('content-length', 0))
        except Exception as e:
            print(f'  {row["storage_path"]}: {e}')
            continue
        if size > budget['hike-photos']:
            over.append((row['storage_path'], size))
    over.sort(key=lambda x: -x[1])
    print(f'{len(over)} of {len(rows)} photos over {human(budget["hike-photos"])}')
    for path, size in over[:25]:
        print(f'  {human(size):>10}  {path}')
    if over:
        print('\n  run scripts/resizephotos.py to fix these')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)

    o = sub.add_parser('optimize', help='re-encode images in place')
    o.add_argument('path')
    o.add_argument('--dry-run', action='store_true')
    o.set_defaults(func=cmd_optimize)

    pr = sub.add_parser('prepare', help='web-size a folder of originals + manifest')
    pr.add_argument('src')
    pr.add_argument('-o', '--out')
    pr.set_defaults(func=cmd_prepare)

    g = sub.add_parser('gpx', help='drop unread trackpoint extensions')
    g.add_argument('files', nargs='+')
    g.add_argument('--dry-run', action='store_true')
    g.set_defaults(func=cmd_gpx)

    a = sub.add_parser('audit', help='find oversized objects already in Storage')
    a.set_defaults(func=cmd_audit)

    args = p.parse_args()
    return args.func(args) or 0


if __name__ == '__main__':
    sys.exit(main())
