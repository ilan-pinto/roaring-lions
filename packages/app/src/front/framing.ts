/**
 * The scene host's cover law: how a diorama's authored zoom scales to the
 * layer it is actually shown on.
 *
 * A diorama's `zoom_at_1080p` (spec §3.2, §10) is authored once, against a
 * 1920x1080 reference layer, the way a mission's camera is authored against
 * gameplay zoom. A player's host layer is rarely that size -- an ultrawide
 * monitor, a laptop panel, a window resize -- so `hostZoom` scales the
 * authored number the same way the host's own plate is drawn: CSS
 * `object-fit: cover`. Cover picks whichever axis is the TIGHTER fit (the
 * larger of the two ratios) and scales both axes by it, so the shorter axis
 * is fully framed and the longer one crops at the edges rather than
 * letterboxing. `Math.max` of the two axis ratios is exactly that rule in
 * one expression: on a wide layer the width ratio dominates and width
 * "binds" (the plate's full width shows, top/bottom crop); on a tall layer
 * the height ratio dominates and height binds instead. The
 * `Math.max(1, ...)` floor on each axis keeps a degenerate (zero-sized, not
 * yet laid out) layer from producing a zero or negative zoom -- it clamps to
 * the reference axis's own ratio of 1, which is finite and positive.
 */
export const REF_LAYER = { width: 1920, height: 1080 } as const;

/** The diorama's own authored zoom, scaled from the 1920x1080 reference to a
 *  `layerW`x`layerH` host layer by the cover law above. */
export function hostZoom(layerW: number, layerH: number, zoomAtRef: number): number {
  return (
    zoomAtRef *
    Math.max(Math.max(1, layerW) / REF_LAYER.width, Math.max(1, layerH) / REF_LAYER.height)
  );
}
