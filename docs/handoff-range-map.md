# Handoff — Range map (About page), shelved 2026-09-19

Branch **`range-map`** in `~/Desktop/the-lost-trailhead`, one WIP commit, **not pushed,
not merged**. Scott stopped the session on purpose because the water rendering was
going in circles; this doc is so the next session (Opus) starts from facts, not
from my guesses. Read `docs/handoff-2026-09-19.md` section 0 first for the session
routine (pull, dev server on :5173 — it may already be running and it serves this
clone — review on localhost before any push).

## What Scott wants (his words, condensed)

A **2D top-down map of Washington** on the About page ("The Range" section, above the two
tag lists) that **matches the 2D trail map on the first card of each hike page**: same
forest-green recolored Esri shaded relief, same white dots outlined dark, same rounded
card and frosted caption band with the Esri "Data attribution" link inside it.

- One pin per hike page (hikes sharing a trailhead may share a pin — Scott approved).
  Hover shows the name, click opens `/hikes/<id>`. No pan or zoom. **The page must still
  scroll while the pointer is over the map.**
- Larger and wider than a hike card: full width of the section (he said the first
  version was too small and "the resolution sucks").
- The **whole state** in frame: he wants to see the state boundary, the Pacific, Puget
  Sound and the Strait.
- **Band title:** "Every Trail, So Far" (my pick; "Washington, So Far" was rejected because
  the two Arizona hikes aren't in Washington). The Arizona hikes get a "+ 2 in Arizona"
  note under the map, not pins.
- **Borders:** solid white, thin ("fairly discrete"); continue the state lines into
  Oregon, Idaho and BC/Canada for consistency.
- **Water color: exactly the About page header ("The People") color** = `--dark`
  `#1a2a1c`. Scott dislikes any blue ("nothing else on the site has it").
- **Water must include the lakes and the Columbia:** Lake Washington, Sammamish,
  Keechelus, Cle Elum, Chelan, Banks Lake, and the Columbia River snaking through
  eastern Washington. Scott said the earlier waterline looked "too shallow compared to
  real life".
- Don't invent UI beyond this (legends, extra labels). Ask first.

## State of the branch

**Works (verified by screenshot / test on localhost)**
- `trailhead: [lat, lon]` on all 33 hikes in `src/data/hikes.js` (GPX first points; Little
  Si and Sourdough Ridge from WTA; Camelback from the Cholla trailhead).
- `src/components/RangeMap.jsx` + `src/lib/rangeMap.js`: viewer set up like the card's,
  fit to the whole Washington bounding box (`WASHINGTON` in RangeMap.jsx), pins, hover
  tooltip, click navigation, "+ N in Arizona" note. CSS: `.range-map*` in `src/index.css`
  (height `min(78vh, 760px)`, full width).
- Wheel scrolling over the map: Cesium swallows wheel events over its canvas even with
  inputs off; `rangeMap.js` stops them in the capture phase on the container. Tested:
  scrollY moved 1870 → 2270 with the wheel over the map.
- Water tone `[26, 42, 28]` (`WATER_RGB` in RangeMap.jsx).
- Borders: `src/data/stateBorders.json` (Census TIGERweb polygons for WA, OR, ID, MT,
  simplified to 0.002°; source noted in the file). Drawn solid white by `drawBorders`
  in `terrainFlyover.js`, skipping any stretch with water within 2.5 km to either side
  (so coastlines aren't outlined but a border following the Columbia still is).
- Pacific, Puget Sound, the Strait, Hood Canal, Grays Harbor and Willapa read correctly
  from **Terrarium elevation ≤ ~3 m** (this part looked right in the earlier screenshots).
- `createReliefLayer` and `RELIEF_LUT` are exported from `terrainFlyover.js` with opt-in
  options `{ reproject, water, outline, maxTiles }`. The hike cards call it without
  options and are unchanged. `reproject` is needed: the stitched image is linear in Web
  Mercator y but Cesium places it linearly in latitude, which is kilometers of error at
  state scale.

**Broken / open**
1. **Lakes and rivers (the main problem).** `paintWater()` in `terrainFlyover.js` unions
   Terrarium low elevation with the USGS National Hydrography Dataset cached tiles:
   `https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}`
   (CORS `*`, US only). That tile is a transparent PNG: lake/river fill in
   `(203,230,255)` / `(213,235,255)`, outlines `(120,176,240)`, thin streams as lines —
   **and its labels ("Snake River", "Lake Chelan", "Franklin D. Roosevelt Lake") are baked
   in as dark-blue text.** Two states of the code:
   - Before the last edit: no label filtering, so the labels rendered as dark text-shaped
     blobs over the map (rivers, lakes and the Columbia did show, densely).
   - The WIP commit (last edit): color-filter the tile, then `closeMask(r=2)` /
     `openMask(r=1)` on the mask. The result is **large dark rectangles** at the label
     positions and along the Sound (Scott's screenshot). My first explanation to Scott
     (an indexing bug in `spread()`) was a guess and I now think it is wrong: the `spread`
     row/column indexing reads correct. The likelier cause, unverified: anti-aliased label
     pixels pass the color test (they're near the light fill color), and the r=2 closing
     fuses them into solid text-sized rectangles. Check that first (render the
     mask alone, or disable the closing).
   - Ideas: (a) a label-free hydro source, e.g. the NHD dynamic export
     (`https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export`) with only
     the waterbody/area/flowline layers shown and one bbox request instead of tiles;
     (b) erase every pixel within a few px of dark text pixels before the color test;
     (c) vector water polygons (Natural Earth, or NHD) drawn onto the canvas; (d) for
     the Columbia specifically, a river line is enough (it should be visible, not
     necessarily filled). Keep rivers/lakes discrete: Scott asked for the Columbia and
     the named lakes, not every stream.
2. **A one-pixel hairline in the top-left corner** of the map, in the open ocean at about
   49°N. Still present after every change. Ruled out (it survived removing them): the
   Esri street-map water source, and the border layer (it's thinner than the border and
   the border skips water). Untested hypothesis: a one-pixel seam in the Terrarium data
   across water; the `closeMask(low, r=1)` step in `paintWater` was meant to heal it but
   was never verified because of problem 1. Bisect by rendering each layer (hillshade,
   elevation mask, hydro mask, borders) on its own.
3. The `?water=` palette switch was removed (water is fixed at `#1a2a1c`).
4. Retina/perf: the map fetches roughly 250+ tiles (hillshade at level 9-10 up to 220
   tiles, plus Terrarium and hydro at one level coarser). Fine on localhost; Scott hasn't
   asked, but keep an eye on phone width (`.range-map` is 420px tall at ≤680px).

## How to check it

- `node scripts/flyover-check/range.mjs [name]` → `scripts/flyover-check/out/range-<name>.png`
  (1440px window, 2x, nav hidden), and it prints whether the page scrolls with the wheel
  over the map. One GPU-heavy run at a time with a pause (the iMac kernel-panicked under
  back-to-back runs). Prefer few screenshots; they're the expensive part.
- Compare against one hike card: `node scripts/flyover-check/card.mjs cascade-pass-sahale-arm`.
- Localhost: http://localhost:5173/about
- The node/chrome scripts need `cd scripts/flyover-check && npm install` once. The
  `package-lock.json` it creates was deliberately left out of the commit.

## Process notes

- Scott's rule for this project: he reviews on localhost, then says push. Then commit, PR,
  merge, and verify https://the-lost-trailhead.vercel.app.
- He was frustrated by rounds of "fix, screenshot, new problem". Suggest checking the
  mask on its own (numbers or one small crop) before whole-map screenshots, and say what
  you changed and what you're unsure of.
