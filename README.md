# The Lost Trailhead

A hiking journal for two friends, Scott & Alan, documenting Pacific Northwest trails —
trip reports, photos, GPX routes, and a 3D terrain flyover of each hike.

Live on Vercel. Repo: `ScottyBenedict/the-lost-trailhead`.

## Stack

- React 19 + React Router 7, built with Vite 8
- Supabase (Postgres, auth, storage) for hike data, photos, and GPX files
- Leaflet for 2D interactive route maps; self-hosted Cesium (Terrarium DEM via a
  custom Worker + `MartiniTerrainProvider`, no Cesium ion) for the 3D terrain
  flyover — see `docs/roadmap-3d-flyover.md` for how that choice was made
- `exifr` + `heic2any` for photo EXIF rotation and HEIC → JPG conversion

## Pages

| Route | Purpose |
|---|---|
| `/` | Hike card grid, A-Z / Recent sort, hover flyover preview on each card |
| `/hikes/:slug` | Hero photo, stats bar, photo gallery with trip reports interspersed |
| `/about` | Profiles for Alan & Scott |
| `/gear` | Gear list per person, grouped by category |
| `/admin` | Auth-gated CMS — log trips, publish new hike pages, manage gear/profile/GPX |

## Development

```bash
npm install
npm run dev      # runs scripts/check-rls.js first, warns if any public Supabase table has RLS disabled
npm run build
npm run lint
```

Requires a `.env.local` with:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

The anon key is also hardcoded in `src/lib/supabase.js` and tracked in
`.env.production` — deliberate, not a leak: it's public by design, and Vercel env
vars weren't baking reliably.

## Data model (Supabase)

`profiles`, `hike_reports`, `hike_photos`, `hike_gpx`, `hike_dates`, `hike_setup`,
`gear_items`, `merch_products` (scaffolded, unused). Hike IDs are lowercase
kebab-case (e.g. `snow-lake-winter`) and match `src/data/hikes.js` exactly across
every table.

New hikes are published through the admin "Needs a Page" tab (log a trip → pick
hero photo → "Suggest with AI" pre-fills region/distance/gain/difficulty/season from
a Supabase Edge Function → publish), not by hand-editing `hikes.js` in a coding
session.

## Notable implementation details

- **Photo dedup**: SHA-256 hash per upload, warns on duplicate.
- **Supabase keep-alive**: `.github/workflows/keep-alive.yml` pings the `profiles`
  table every 6 hours so the free-tier project doesn't auto-pause.
- **3D flyover is on every hike.** The old `terrain3dTestHikes.js` allowlist was
  removed on 2026-09-17. What is still per-hike is the trailing ("drone behind the
  hiker") camera, enabled through `TRAILING_CAMERA_TEST` in
  `src/components/HikeMap.jsx`. Add a hike there only after checking playback (hiker
  stays in frame, camera stays above terrain) and the GPX stats against the page —
  the checklist and tools are in `scripts/flyover-check/README.md`.

## Working conventions

Scott reviews every change on localhost before anything is pushed. Hike distances use
the smoothed-GPX number, regions follow WTA, and GPU-heavy checks run one at a time
(the iMac kernel-panicked under back-to-back runs). Full session setup is in
`docs/handoff-2026-09-19.md`.

## Docs

- `docs/handoff-2026-09-19.md` — current handoff and open work; start here
- `docs/roadmap-3d-flyover.md` — flyover status (top) plus historical spike notes
- `docs/handoff-range-map.md` — About-page range map: shelved on branch `range-map`, with state and open problems
- `docs/handoff-imac-2026-09-17.md` — resolved camera-tracking handoff, kept as history
- `scripts/flyover-check/README.md` — GPX / snow / flyover check scripts
