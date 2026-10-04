# Handoff: GPX downloads (2026-10-03)

Hike pages offer a free "Download GPX" button next to Share, for every hike
with a recorded track (29 of 33; none for Camelback, Little Si, Sourdough
Ridge, or Garfield Ledges — Winter, which has no winter track). The files are
cleaned **copies**, served from our own site at
`public/gpx/the-lost-trailhead-<hike-id>.gpx`. The originals in Supabase, the
map, the flyover and the elevation profile are untouched and still read the
originals.

## What a download is

Built by `scripts/gpx-export/export.py`:

- **Same route as the flyover.** Trimmed where the flyover trims
  (`TRAIL_START` in `src/lib/gpxFlyover.js`). An out-and-back is the way up,
  with recording gaps filled from the way down (`fillOutboundGaps` rules),
  retraced to the trailhead. A loop is the whole trimmed recording.
- **Stripped** to lat, lon and elevation: no times, heart rate or device data.
- **Simplified** with Douglas-Peucker at 3 m. Length is checked against the
  smoothed track, because raw 1-point-per-second length is inflated by GPS jitter.
- **Labelled:** GPX 1.1, one track, one segment. The name is the hike's name,
  the description reads "The Lost Trailhead, thelosttrailhead.com/hikes/<id>.
  Conditions change. Use at your own risk.", and there's a link to the page.
- **No side trips removed** unless listed in `scripts/gpx-export/cuts.json`
  (meters along the trimmed track). The script reports candidates but never
  cuts on its own.

## Re-running when a track changes

Downloads are snapshots. A new or replaced track in Supabase does **not**
update its download until you re-run the export and deploy:

```
cd scripts/gpx-export
python3 export.py <hike-id>            # or --all; writes staging/ (git-ignored)
open staging/<hike-id>.png             # review overlay; numbers in staging/report.md
python3 export.py --publish            # staging -> public/gpx/ + src/data/gpxDownloads.js
```

`--publish` copies every staged file except those in `publish.json` → `skip`.
It removes published files that are no longer staged and regenerates
`src/data/gpxDownloads.js`, the list that decides which pages show the
button. So `staging/` should hold the full approved set when you publish:
after a single-hike re-run, staging still has the others from the last
`--all`. Then review on localhost and push as usual.

- **Flyover cache:** `export.py` reads originals through flyover-check's cache
  (`scripts/flyover-check/.cache/`). If a track was **replaced** in Supabase,
  delete its cached copy first, or the export will use the old one.
- **New hike:** add the track in admin as usual, then
  `python3 export.py --all`, review, `--publish`.
- **Remove a download:** add the hike to `publish.json` → `skip` with a reason,
  then run `--publish`.

## Provenance (settled)

26 of the 30 tracks were uploaded by Alan. He is fine with all of them being
downloadable (Scott, 2026-10-03). Settled; don't ask again.
