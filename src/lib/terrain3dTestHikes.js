// Hikes currently allowed to use the 3D Cesium terrain flyover while camera
// behavior is still being tested against atypical route shapes (loops,
// lollipops) — see docs/roadmap-3d-flyover.md. Every other hike falls back
// to the shipped 2D flyover. Add an id here only after its camera behavior
// has actually been checked, not by default.
export const TERRAIN_3D_TEST_HIKE_IDS = new Set(['rattlesnake-ledge', 'maple-pass-loop'])
