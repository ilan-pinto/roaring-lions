/**
 * The wide-zoom fade of the two optional post passes (`high` only).
 *
 * Measured on ANGLE/Metal, M3 Pro, `beit_sahwan_outskirts` z0.5 quiet at
 * DPR 2 (`_coord/high-z05/report.md`): the AO pre-pass costs ~1.7 ms (mostly
 * the G-buffer scene re-render) and the bloom ~1.3 ms, and at that distance
 * contact shadows are a few pixels and a quiet frame blooms nothing. So both
 * fade out as the camera pulls back through `ZOOM_FADE_FULL`..`ZOOM_FADE_OFF`.
 *
 * The fade scales the AO blend intensity and the bloom strength by the weight
 * below; a pass is skipped outright only at weight EXACTLY 0, so there is no
 * pop and the saving is real. `medium` and `low` build neither pass.
 * Presentation only: nothing here reads or writes the sim.
 */

/** At or above this zoom both passes run at full strength (the gated scenarios sit here or above). */
export const ZOOM_FADE_FULL = 0.9;
/** At or below this zoom both passes are skipped entirely. */
export const ZOOM_FADE_OFF = 0.7;

/** 0 at or below `ZOOM_FADE_OFF`, 1 at or above `ZOOM_FADE_FULL`, smoothstep between. */
export function zoomFadeWeight(zoom: number): number {
  const t = (zoom - ZOOM_FADE_OFF) / (ZOOM_FADE_FULL - ZOOM_FADE_OFF);
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}
