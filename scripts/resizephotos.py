#!/usr/bin/env python3
"""One-off: re-encode everything already in Supabase Storage to web sizes.

    pip3 install pillow
    export SUPABASE_SERVICE_ROLE_KEY=...        # dashboard > Settings > API
    python3 scripts/resizephotos.py --dry-run   # report only, changes nothing
    python3 scripts/resizephotos.py

Why: photos were uploaded at whatever the phone shot — 133 of them averaging
4 MB, the largest 11 MB — and Alan's avatar is a 2.5 MB JPEG shown in a
180px circle. A hike page cost about 28 MB to load, so a couple of hundred
views (most of them ours, developing against localhost, which pulls from
the same CDN) used the whole 5 GB monthly allowance and Supabase restricted
the project on 2026-09-19.

New uploads are handled in src/lib/adminUtils.js and go up as WebP. These
stay JPEG under their existing names, because storage_path is recorded in
hike_photos and renaming them would break every row. Same dimensions:
  - photo:  long edge 2880, quality 85   (a 5K lightbox asks for 2880)
  - thumb:  long edge 800,  quality 78   (the gallery cell is ~350px)
  - avatar: long edge 512,  quality 82   (shown at 180px)

Each photo is replaced in place and a thumb_<name> written beside it, which
is where the gallery looks — no database column and no migration. Safe to
re-run: anything already small enough is skipped.

The originals are NOT backed up anywhere by this script. They are the
phone's exports and live in the photo library; Storage is only what the
site serves.
"""

import io
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

URL = 'https://ikjgtsvauctfmxpqwmyd.supabase.co'
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
DRY = '--dry-run' in sys.argv

PHOTO = (2880, 85)
THUMB = (800, 78)
AVATAR = (512, 82)
# Below this there is nothing worth doing.
SKIP_UNDER = 300 * 1024


def api(path, method='GET', body=None, headers=None, raw=False):
    req = urllib.request.Request(f'{URL}{path}', method=method)
    req.add_header('apikey', KEY)
    req.add_header('Authorization', f'Bearer {KEY}')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if body is not None and not raw:
        req.add_header('Content-Type', 'application/json')
        body = json.dumps(body).encode()
    with urllib.request.urlopen(req, body, timeout=300) as r:
        data = r.read()
    return data if raw else json.loads(data or b'null')


def download(bucket, path):
    return api(f'/storage/v1/object/{bucket}/{urllib.parse.quote(path)}', raw=True)


def upload(bucket, path, data):
    if DRY:
        return
    api(f'/storage/v1/object/{bucket}/{urllib.parse.quote(path)}', method='PUT',
        body=data, raw=True,
        headers={'Content-Type': 'image/jpeg', 'x-upsert': 'true',
                 'Cache-Control': 'public, max-age=31536000'})


def resize(data, max_edge, quality):
    img = Image.open(io.BytesIO(data))
    # Honour the EXIF orientation, then drop it: these are re-encoded upright,
    # and a leftover orientation tag would rotate them a second time.
    img = ImageOps.exif_transpose(img).convert('RGB')
    if max(img.size) > max_edge:
        img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, 'JPEG', quality=quality, optimize=True, progressive=True)
    return out.getvalue(), img.size


def thumb_path(path):
    cut = path.rfind('/') + 1
    return path[:cut] + 'thumb_' + path[cut:]


def kb(n):
    return f'{n / 1024:,.0f} kB'


def main():
    if not KEY:
        raise SystemExit('set SUPABASE_SERVICE_ROLE_KEY (dashboard > Settings > API)')

    rows = api('/rest/v1/hike_photos?select=storage_path&order=storage_path')
    paths = [r['storage_path'] for r in rows if not r['storage_path'].rsplit('/', 1)[-1].startswith('thumb_')]
    print(f'{len(paths)} photos{" (dry run)" if DRY else ""}\n')

    before = after = 0
    failed = []
    for i, path in enumerate(paths, 1):
        try:
            original = download('hike-photos', path)
            photo, size = resize(original, *PHOTO)
            thumb, _ = resize(original, *THUMB)
            before += len(original)
            after += len(photo) + len(thumb)
            # Only rewrite the photo if the new one is actually smaller; the
            # thumbnail is always written, since the gallery now expects it.
            if len(photo) < len(original) - SKIP_UNDER:
                upload('hike-photos', path, photo)
                note = f'{kb(len(original))} -> {kb(len(photo))} @ {size[0]}x{size[1]}'
            else:
                after += len(original) - len(photo)
                note = f'{kb(len(original))} kept (already small)'
            upload('hike-photos', thumb_path(path), thumb)
            print(f'  [{i:3}/{len(paths)}] {path.rsplit("/", 1)[-1]:24} {note}, thumb {kb(len(thumb))}')
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
            failed.append((path, e))
            print(f'  [{i:3}/{len(paths)}] {path} FAILED: {e}')

    avatars = api('/rest/v1/profiles?select=avatar_url&avatar_url=like.*supabase*')
    for row in avatars:
        path = row['avatar_url'].split('/avatars/', 1)[-1].split('?')[0]
        try:
            original = download('avatars', path)
            small, size = resize(original, *AVATAR)
            before += len(original)
            after += len(small)
            upload('avatars', path, small)
            print(f'\n  avatar {path}: {kb(len(original))} -> {kb(len(small))} @ {size[0]}x{size[1]}')
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
            failed.append((path, e))
            print(f'\n  avatar {path} FAILED: {e}')

    print(f'\n  {kb(before)} -> {kb(after)}  ({100 - after * 100 // max(1, before)}% smaller)')
    if failed:
        print(f'  {len(failed)} failed')
    if DRY:
        print('  dry run — nothing was written')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
