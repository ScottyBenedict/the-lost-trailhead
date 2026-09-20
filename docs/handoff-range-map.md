# Range map — superseded

This described the range map shelved on branch `range-map` (commit
`ecb9f54`, never merged). That work was rebuilt and shipped in **PR #41**;
see `docs/handoff-2026-09-19.md` section 1 for the current state.

Kept only for the two findings that cost the most to learn:

- **Do not read water out of a rendered hydro basemap.** Esri's and USGS's
  tiles both have their place labels drawn into the image, and an
  anti-aliased label edge is the same blue as a lake outline. No colour
  tolerance separates them, and closing the gaps in the text welds each
  label into a solid block. The water is vector now
  (`scripts/flyover-check/fetchwater.py`).
- **USGS NHD files glaciers as waterbodies** (`FTYPE='Ice Mass'`). Sixteen
  clear 4 km² in this frame, and Rainier's is 14 km across, so without the
  filter the map grows lakes on the volcanoes.

One more, learned after: rounding coordinates *after* simplifying pushes
edges across each other, and an even-odd fill of a self-crossing ring
cancels itself — that was the hairline in the corner of the map, not
lighting or terrain skirts. `fetchwater.py` now snaps inside the geometry,
repairs what the snap breaks, and refuses to write if any polygon is still
invalid.
