# Handoff: 3D Flyover Camera Tracking — 2026-09-17

Written at the end of a long session (Claude Sonnet 5, Claude Code) that shipped a lot on
the 3D flyover today. This doc is specifically about the one thread left unresolved:
**camera smoothness through switchbacks.** Read this before touching `src/lib/terrainFlyover.js`.

## Where things stand right now (safe, live baseline)

Production is running **temporal smoothing only** — no separate camera track, no
look-ahead. In `applyFrame()`:

```js
if (this.smoothedTarget == null) {
  this.smoothedTarget = { lat: pos.lat, lon: pos.lon };
} else {
  this.smoothedTarget.lat += (pos.lat - this.smoothedTarget.lat) * TARGET_SMOOTHING;
  this.smoothedTarget.lon += (pos.lon - this.smoothedTarget.lon) * TARGET_SMOOTHING;
}
```

`TARGET_SMOOTHING = 0.03` (top of file). The camera's `lookAt` target exponentially eases
toward the hiker's exact real position every frame instead of snapping to it. This has
**no known failure mode** — it can only ever lag toward the real position, never diverge
from it, so the subject can never leave frame. Ship this if nothing else works out.

Scott's read on this version: "close, maybe needs a touch more smoothing" (feedback that
led to bumping 0.05 → 0.03). Hasn't been re-confirmed against the 0.03 value specifically
on a clean, non-throttled test — that's a reasonable first thing to check.

## What Scott actually wants

> "Almost like overlaying a camera track that follows the basic shape of the hike, while
> not being constrained by every little switchback or up and down in the terrain. As long
> as the camera is following this simple tracking sequence, we can smooth out the
> 'picture' the audience views."

In other words: decouple the camera's path from the marker's exact detailed path
entirely, not just lag behind a delayed copy of it. That's a materially different (and
better, if it can be made to work) idea than temporal smoothing — this session validated
the *concept* is right but didn't land a safe implementation in the time available.

## What was tried today, in order, and why each step didn't fully land

1. **Path-distance look-ahead** (aim N meters further down the path instead of at the
   exact current position). Made it *worse* — a raw, still-unsmoothed point further along
   an unsmoothed path swings through a switchback just as hard as the current position
   does, sometimes harder. Nothing was actually smoothed, only relocated. Reverted same
   session.

2. **Temporal smoothing** (current live version, above). Real improvement, confirmed by
   Scott as "close." Still fundamentally chasing a lagged copy of the marker's exact
   twisty path, so it can't fully deliver "not constrained by every switchback."

3. **Separate simplified camera track** — the idea Scott actually asked for. Built a
   second, far-coarser `buildFlowingPath` fit of the same route (`CAMERA_TRACK_WAYPOINTS`)
   specifically for the camera to follow, sampled at the same `frac` as the marker so the
   two stay paced together. This is conceptually correct and worth returning to.
   - At `CAMERA_TRACK_WAYPOINTS = 28`: confirmed directly against real playback that the
     marker left the visible frame entirely at a real hairpin switchback on Maple Pass
     Loop — the coarse track cut across the switchback by more than the camera's fixed
     750m range / 84° FOV could keep the subject in frame for.
   - Raised to `90`: same failure, different spot. Measured (via a standalone Node script
     against the real Maple Pass Loop GPX — reusable pattern, see below) that raw
     divergence between the marker's real position and the 90-waypoint coarse track peaks
     at **214m** across the whole route. That's evidently still enough to push the subject
     out of frame at least once.
   - Added a **divergence clamp**: within `MAX_TRACK_DIVERGENCE_M` (tried 200m), use the
     coarse track as-is; beyond it, blend back toward the real position to stay under the
     cap. Dropped `CAMERA_TRACK_WAYPOINTS` back to 35 for stronger smoothing elsewhere,
     since the clamp was supposed to be what guarantees frame-safety. **Still saw the
     marker missing during continuous playback around mile 5-6.5 on Maple Pass Loop, even
     with the clamp.**

4. **Reverted to temporal smoothing** (state described at the top) rather than keep
   iterating on an approach with a confirmed-real but not-yet-understood failure mode.

## The open technical question

Why did the 200m lateral (lat/lon-only) clamp still let the subject leave frame?
Working theory, **not yet verified**: the clamp only bounds horizontal (lat/lon)
divergence between the coarse track's aim point and the marker's real position. On
steep terrain, a modest *lateral* offset can produce a much larger *effective* vertical/
depth displacement in what the camera actually sees than the same offset would on flat
ground — pitch is -34° (looking down at an angle), so a point that's merely "200m to the
side" in map terms can be substantially more (or differently) displaced on-screen once
projected through that angle over real elevation change. A lat/lon-only clamp doesn't
account for this.

Two ways to actually test this theory, neither tried yet:
- Log the camera's real screen-space position of the marker each frame (project the
  marker's `Cartesian3` through `viewer.camera` to screen coordinates) and check whether
  it ever falls outside the canvas bounds — would directly confirm/deny the theory and
  pinpoint exactly where it happens, without guessing from visual inspection.
- Clamp divergence in true 3D distance (including elevation delta) instead of flat
  lat/lon distance — cheap to try, `haversineM` in `gpxFlyover.js` is 2D only, would need
  a 3D distance helper (or just also factor in `|ele_a - ele_b|`).

## A testing-environment trap worth knowing about

Late in this session, a browser tab that had been reused for many rapid test cycles
started rendering the flyover at **1 frame per 8 seconds** (confirmed via the
`[terrainFlyover] perf: ...` console log this file already emits once per `play()`).
That's Chrome's background/inactive-tab throttling, not a real bug — a person's own
foreground tab won't hit this. It's very possible some of the "marker missing" symptoms
observed late in this session were partly an artifact of that, not purely the divergence
issue. **Test in a fresh tab you're actively looking at, not one that's been driving many
rapid automated reload/play cycles**, and check that console log — healthy playback should
show several hundred frames per 8s, matching the historical baseline already recorded in
`docs/roadmap-3d-flyover.md` (476-482 frames/8s clean, vs. 14-24 frames/8s when something
is actually wrong).

## Reusable verification pattern

This session verified changes against the *real* Maple Pass Loop and Rattlesnake Ledge
GPX (fetched from Supabase storage) via small standalone Node scripts — porting the exact
same `buildFlowingPath`/`positionAt`/`haversineM`/`findApexIndex` functions from
`terrainFlyover.js` and running them against real data before ever touching a browser.
That's how the apex-detection threshold (40m) and the 214m divergence figure above were
established — worth doing again for whatever the next attempt is, before spending a
deploy+browser cycle on it. `verify_camera_track.mjs` (this session's version) is a decent
starting template if it's still around; otherwise it's quick to rebuild from the functions
in `terrainFlyover.js` directly.

## Everything else that shipped today (context, not blocking)

For reference, PRs #2-#15 today: AI-assisted admin hike-page suggestions (`suggest-hike`
Edge Function), Maple Pass Loop published, 3D flyover scope-gated to
`rattlesnake-ledge`/`maple-pass-loop` only (`terrain3dTestHikes.js`), loop-detection fix
for `findApexIndex` (out-and-back vs. genuine loop — this part is solid, not in question),
missing-map-card bug fix (zero-report hikes), A-Z/Recent sort race fix, lightbox scrollbar
hidden, and the loop start/finish pin fix (single two-tone pin instead of two overlapping
ones). None of that is related to the camera-tracking question above — just context if
something looks unfamiliar in the diff history.
