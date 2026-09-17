# The Lost Trailhead

A hiking journal for two friends, Scott & Alan, documenting Pacific Northwest trails —
trip reports, photos, GPX routes, and a 3D terrain flyover of each hike.

Live on Vercel. Repo: `ScottyBenedict/the-lost-trailhead`.

## Stack

- React 19 + React Router 7, built with Vite 8
- Supabase (Postgres, auth, storage) for hike data, photos, and GPX files
- Leaflet for 2D interactive route maps; self-hosted Cesium (Terrarium DEM via a
  custom Worker + `MartiniTerrainProvider`, no Cesium ion) for the 3D terrain
  flyover — see `docs/roadmap-3d-flyover.md` for how that choice was made and
  `docs/handoff-imac-2026-09-17.md` for the open camera-tracking work
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
- **3D flyover is scope-gated**: only hikes listed in
  `src/lib/terrain3dTestHikes.js` get the Cesium flyover; everything else uses the
  original 2D `gpxFlyover.js`. Add a hike to that list only after checking its
  camera behavior.
