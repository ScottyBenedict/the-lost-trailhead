# Flyover check scripts

Dev-only tools for checking a hike's GPX stats and 3D flyover before shipping.
Not part of the site build. See `docs/handoff-2026-09-19.md` for open work.

## Setup (once)

```
cd scripts/flyover-check && npm install      # playwright-core; uses your installed Chrome
pip3 install pillow shapely                  # if missing
npx playwright-core install webkit           # only for real-Safari checks
brew install ffmpeg                          # only for reel.mjs output
```

Chrome is enough for layout and logic. **iOS bugs need WebKit** — Chrome at a
phone viewport missed both of the ones that mattered (the map trapping the
page's scroll, and the tab dying under memory pressure), because a phone
sends touchmove rather than wheel and a desktop has memory a phone does not.
Some things only a real device shows: headless WebKit rendered the range map
fine while an iPhone could not keep it alive.

The browser checks need the dev server running (`npm run dev` at the repo root).
Output goes to `out/`; downloads are cached in `.cache/` (both gitignored).

The browser checks cache every Supabase, terrain and imagery response to
`.cache/http` (`httpcache.mjs`). Keep it: localhost pulls photos and GPX
from the Supabase CDN exactly like production, about 28 MB per hike page,
and a day of unchecked runs is what exhausted the 5 GB monthly allowance
and got the project restricted on 2026-09-19. Delete `.cache/http` when you
need a genuinely fresh fetch.

## Scripts

| Script | What it tells you |
|---|---|
| `python3 gpxcheck.py <hike_id>` | Distance (15s-smoothed — the number to use), recording gaps, gain (two methods), out-and-back vs loop, way-in gaps, flight pace |
| `python3 snowcheck.py [--release N] <hike_id>...` | Snow share along the route in the flyover's satellite imagery |
| `python3 wbsearch.py <hike_id>` | Newest snow-free Esri Wayback capture + its source date/resolution vs current |
| `node scan.mjs <hike_id>` then `python3 hikerscan.py <hike_id>` | Plays the flyover; reports any moment the hiker leaves the frame and the tightest edge margin |
| `node card.mjs <hike_id>...` | Screenshot of the hike page's map card |
| `python3 watercheck.py [--png]` | The range map's water, checked offline: wet/dry at 30 landmarks, no browser |
| `python3 fetchwater.py` | Rebuilds `src/data/water.json` from Natural Earth + USGS NHD (slow; only when the water changes) |
| `python3 fetchborders.py` | Rebuilds `src/data/stateBorders.json` from Census TIGERweb; needs `water.json` first, to tell coast from border |
| `node range.mjs [name]` | Screenshot of the About page's range map, plus a check that the page scrolls over it |
| `node reel.mjs <hike_id> [secs]` | Records the flyover as a vertical clip for social — no cursor, no chrome, steady frame rate. `--bare` strips everything but the map. Outputs webm to `out/reel/`; convert with ffmpeg |
| `node mobilecheck.mjs [baseUrl]` | Phone-width layout check: horizontal overflow, broken images, map/gallery sizing, console errors. Chrome at 390px, not real iOS Safari — catches layout and loading, not WebKit rendering |

## Adding the trailing camera to a hike (the checklist)

1. `gpxcheck.py <hike_id>`
   - **Distance**: use the smoothed number (raw GPS reads 4–27% long). Change the
     page (`src/data/hikes.js`) when it differs by >= 0.3 mi. "Trip we hiked" basis.
   - **Gain**: change only when clearly wrong (e.g. below the net rise, or well
     outside both methods). Scott declined small gain tweaks (Maple stays 2,020).
   - **Way-in gaps**: auto-filled by `fillOutboundGaps`; add the distance the gap
     missed (measure that stretch on the return leg).
   - **Flight pace over ~320 m/s**: flag to Scott; fix per hike with
     `FLIGHT_SECONDS` in `HikeMap.jsx` (Kendall precedent). Flights over 60s get
     Scott's OK first.
2. Region: must match WTA's land manager / location for the trail
   (wta.org/go-hiking/hikes/<slug>). Check where the GPX starts.
3. Add the hike to `TRAILING_CAMERA_TEST` in `src/components/HikeMap.jsx`:
   out-and-back `{ range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 }`,
   loop: same without `descentPitchDeg`.
4. `scan.mjs` + `hikerscan.py`: hiker must never be missing. If it strays close
   to an edge (<~60px), mention it to Scott; `maxAimOffset: 0.3` (Kendall-only
   precedent) keeps it in frame without jitter.
5. Scott reviews on localhost, then says push. Never change a shipped hike's
   behavior unless he asks.

## House rules

- One GPU-heavy run at a time, with a pause between (the iMac kernel-panicked
  under back-to-back runs).
- Reading screenshots is the expensive part of a session. Prefer the numeric
  checks above; ask Scott to eyeball localhost for visual calls.
