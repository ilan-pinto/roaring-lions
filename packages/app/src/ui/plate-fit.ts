// How far to zoom a unit plate so the unit is LARGE in the bay.
//
// `tools/src/perf/unit-plates.ts` photographs every KDF unit through the game's
// own camera at one fixed zoom, so the frame is identical for all seventeen and
// the unit inside it is not: a `sniper_team` occupies 154 of the plate's 1800
// pixels and an `ifv_namer` 823. Drawn `object-fit: contain` at the plate's own
// scale, that is a rifleman about eight per cent of the bay wide -- a speck on
// an empty beach, which is what the first cut of the garage shipped. The plate
// records each unit's measured footprint (`extent`) for exactly this reason.
//
// So: scale the plate image until the unit's footprint is about `fill` of the
// bay's width, and let `overflow: hidden` on the bay crop the sand that leaves
// the frame. The unit is centred in the plate by construction (the capture
// frames it), so a centred `transform: scale()` keeps it centred.
//
// Two bounds, and each one is there for a case that actually occurs:
//
//   * `MIN`/`MAX`. Below 1 there is nothing to gain -- the plate already fits
//     the bay and shrinking it only adds letterboxing -- and above 2.5 a
//     1800 px JPEG starts to show its own pixels at bay size. `sniper_team`
//     would ask for 7.0x and gets 2.5x.
//   * The MARGIN bound. A unit that already fills its plate must not be blown
//     up until its own edges are cropped: the footprint plus a tenth of itself
//     has to stay inside the frame on BOTH axes. It can lower a scale but never
//     below `MIN` -- a plate whose footprint is the whole frame is drawn at 1,
//     not shrunk. At the shipped `fill` only the HEIGHT half of it can ever
//     bind, and that is arithmetic rather than luck: filling 0.6 of the width
//     can never leave less than a tenth of the footprint's own width outside
//     the frame, since 0.6 < 1 / 1.1. Raise `PLATE_FILL` past 0.909 and the
//     width half starts to bind too (pinned in the tests).
//
// Pure, and separate from `brigade.ts`, so the numbers can be asserted without
// a DOM: the failure mode here is a scale that looks plausible and is wrong,
// which is invisible in a screenshot of one unit.

/** Never shrink, and never past where the JPEG shows its own pixels. */
export const PLATE_SCALE_MIN = 1;
export const PLATE_SCALE_MAX = 2.5;
/** The footprint, plus a tenth of itself, stays inside the frame. */
export const PLATE_MARGIN = 0.1;
/** How much of the bay's width the unit should occupy. */
export const PLATE_FILL = 0.6;

export interface PlateFit {
  /** The CSS `transform: scale()` factor for the plate image, two decimals. */
  scale: number;
}

/**
 * `extent` is the unit's measured footprint in plate pixels (the plates
 * manifest's own `extent`); `plate` is that plate's pixel size. Both come from
 * the same manifest entry, so they are always in the same units and a caller
 * cannot mix a footprint from one plate with the size of another.
 *
 * A degenerate footprint (a plate whose capture measured nothing) returns
 * `PLATE_SCALE_MIN` rather than dividing by zero -- an unzoomed plate is a
 * worse picture, never a broken one.
 */
export function plateFit(
  extent: readonly [number, number],
  plate: readonly [number, number],
  fill: number = PLATE_FILL
): PlateFit {
  const [ew, eh] = extent;
  const [pw, ph] = plate;
  if (!(ew > 0) || !(eh > 0) || !(pw > 0) || !(ph > 0)) return { scale: PLATE_SCALE_MIN };

  // Fill: the footprint is `ew / pw` of the drawn image's width, and the drawn
  // image spans the bay's width (plate and bay share the 3:2 frame), so the
  // scale that makes it `fill` of the bay is the ratio of the two.
  const wanted = (fill * pw) / ew;
  const clamped = Math.min(Math.max(wanted, PLATE_SCALE_MIN), PLATE_SCALE_MAX);

  // Margin: on each axis, the scaled footprint plus a tenth of itself must fit.
  const grown = 1 + PLATE_MARGIN;
  const marginMax = Math.min(pw / (ew * grown), ph / (eh * grown));

  const scale = Math.max(PLATE_SCALE_MIN, Math.min(clamped, marginMax));
  return { scale: Math.round(scale * 100) / 100 };
}
