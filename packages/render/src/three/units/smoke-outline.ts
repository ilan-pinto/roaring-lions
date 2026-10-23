/**
 * The smoke outline (GH-705, the lead's ruling 23 Oct 2026): the viewer's OWN
 * units standing in smoke keep their team-colour occlusion outline, drawn
 * through the smoke. Enemies never get it -- smoke is cover, and an outline on
 * a hidden enemy would be a wallhack.
 *
 * Pure decisions live here so a spec can falsify them without a GL context;
 * `ThreeRenderer.stepSmokeOutlines` is the only caller and the only writer.
 */

/** Smoke density (0..255 on `sim.smoke`) at which an own unit's outline is
 *  drawn through the smoke. A fresh screen is 255 and decays 1 a tick; 48 is
 *  about a fifth, i.e. the plume is visibly there but not yet gone
 *  (`SMOKE_BLOCKS_AT` 320 is a SUM along a sight line, not a per-tile level). */
export const SMOKE_OUTLINE_MIN = 48;

/** Ring width on INFANTRY, in screen pixels, at `INFANTRY_RING_FULL_ZOOM` and
 *  above. Vehicles keep `SILHOUETTE_OUTLINE_PX`. */
export const INFANTRY_SMOKE_OUTLINE_PX = 1.5;
/** Below this zoom an infantry ring keeps the full width (the figure is
 *  already small and the ring is what carries it). */
export const INFANTRY_RING_FULL_ZOOM = 1;
/** At and above this zoom the infantry ring is at its thinnest. */
export const INFANTRY_RING_THIN_ZOOM = 2;

/** Infantry ring width in screen pixels at `zoom`: `fullPx` up to zoom 1,
 *  tapering linearly to `INFANTRY_SMOKE_OUTLINE_PX` at zoom 2 and above. */
export function infantrySmokeOutlinePx(zoom: number, fullPx: number): number {
  const t = Math.min(1, Math.max(0, (zoom - INFANTRY_RING_FULL_ZOOM) / (INFANTRY_RING_THIN_ZOOM - INFANTRY_RING_FULL_ZOOM)));
  return fullPx + (INFANTRY_SMOKE_OUTLINE_PX - fullPx) * t;
}

/** Whether one entity should wear the smoke outline this frame. */
export function wearsSmokeOutline(
  alive: number,
  side: number,
  viewer: number,
  smokeLevel: number,
  visible: boolean
): boolean {
  return alive === 1 && side === viewer && visible && smokeLevel >= SMOKE_OUTLINE_MIN;
}
