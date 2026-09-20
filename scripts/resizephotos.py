#!/usr/bin/env python3
"""One-off: re-encode everything already in Supabase Storage to web sizes.

    pip3 install pillow
    # Put SUPABASE_SERVICE_ROLE_KEY=... in .env.local (gitignored) — the
    # service role key bypasses RLS, so it does not belong in a shell
    # history, a transcript, or anything committed.
    python3 scripts/resizephotos.py --backup ~/Desktop/tlt-storage-backup
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

The file list comes from Storage, not from the hike_photos table: this
project only ever granted table privileges to anon and authenticated, so
service_role gets "permission denied for table hike_photos". Storage has
its own authorization and the secret key is fine there, so walking the
bucket avoids needing a GRANT just to run a cleanup.

This rewrites the originals in place and they are not recoverable
afterwards — photos uploaded through the admin portal may exist nowhere
else. Run --backup first; it downloads every object in all three buckets,
keeping the exact storage paths so anything can be put back by hand.
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
DRY = '--dry-run' in sys.argv


def service_key():
    """From the environment, else .env.local (gitignored)."""
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if key:
        return key.strip()
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.local')
    try:
        for line in open(env):
            name, _, value = line.partition('=')
            if name.strip() == 'SUPABASE_SERVICE_ROLE_KEY':
                return value.strip().strip('\'"')
    except OSError:
        pass
    return None


KEY = service_key()

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


def walk(bucket, prefix=''):
    """Every file under a prefix. A folder comes back with null metadata."""
    files = []
    offset = 0
    while True:
        page = api(f'/storage/v1/object/list/{bucket}', method='POST',
                   body={'prefix': prefix, 'limit': 1000, 'offset': offset})
        if not page:
            break
        for entry in page:
            name = entry['name']
            if entry.get('metadata') is None:
                files += walk(bucket, f'{prefix}{name}/')
            else:
                files.append((f'{prefix}{name}', entry['metadata'].get('size', 0)))
        if len(page) < 1000:
            break
        offset += len(page)
    return files


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


def backup(root):
    root = os.path.abspath(os.path.expanduser(root))
    total = files = 0
    for bucket in ('hike-photos', 'gpx-files', 'avatars'):
        for path, size in walk(bucket):
            dest = os.path.join(root, bucket, path)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.exists(dest) and os.path.getsize(dest) == size:
                continue                       # already saved; safe to resume
            data = download(bucket, path)
            with open(dest, 'wb') as f:
                f.write(data)
            files += 1
            total += len(data)
            print(f'  {bucket}/{path}  {kb(len(data))}')
    print(f'\n  {files} files, {total / 1024 / 1024:.1f} MB -> {root}')
    return 0


def main():
    if not KEY:
        raise SystemExit('add SUPABASE_SERVICE_ROLE_KEY=... to .env.local '
                         '(Dashboard > Settings > API > service_role)')

    if '--backup' in sys.argv:
        return backup(sys.argv[sys.argv.index('--backup') + 1])

    everything = walk('hike-photos')
    paths = sorted(p for p, _ in everything if not p.rsplit('/', 1)[-1].startswith('thumb_'))
    known = dict(everything)
    print(f'{len(paths)} photos, {len(everything) - len(paths)} thumbnails already there'
          f'{" (dry run)" if DRY else ""}\n')

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

    for path, _ in walk('avatars'):
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
