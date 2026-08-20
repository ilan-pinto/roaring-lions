// The per-tile decision for the tunnel trace — extracted pure so the rung
// split is a stated, tested fact rather than a loop's accident (grind.ts's
// precedent: renderer logic that needs no Pixi surface to prove).
//
// Two rungs, two sets of eyes, mirroring what the sim itself senses:
//
// - SPOIL (trail density > 0): visible dirt. Anyone's eyes serve —
//   `seenByAnyone` is Sim.sideSeesTile, whose observer set is
//   trailStrengthFor's (any living surface unit of the side, no ability
//   filter) — because those are exactly the eyes that drive the contact
//   ladder up. This is the "there's disturbed earth over there, send the
//   drone" cue, and it must never be invisible while the sim is sensing
//   it: with no tunnelContact toast in the app, this tint is the only
//   place suspicion shows at all.
// - the IDENTIFIED LINE: only a detector serves — `seenByCarrier` is
//   Sim.markerSeesTile, mark_tunnel carriers only — because only a
//   detector tells you what the dirt MEANS: a tunnel, and where it runs.
//
// Anyone can see dirt; only a detector reads the route. That asymmetry is
// what makes the drone worth flying.

/** Alpha of the identified route line. */
const LINE_ALPHA = 0.18;
/** Alpha floor and density scale of visible spoil. */
const SPOIL_ALPHA_FLOOR = 0.14;
const SPOIL_ALPHA_SCALE = 0.5;
/** TRAIL_MAX's value, restated: @lions/render must not import sim internals
 *  beyond its public surface, and the density ceiling is a stable contract. */
const SPOIL_DENSITY_MAX = 255;

/**
 * Alpha for one trace tile; 0 means the tile does not draw. `level` is the
 * strongest contact rung of any route under the tile (0 unknown,
 * 1 suspected — including a collapsed route's residual spoil, which the
 * caller downgrades — 2 identified); `density` is the spoil stamped there.
 * The two sight flags come from the matching Sim reads; a carrier is also
 * "anyone", so callers pass seenByAnyone >= seenByCarrier.
 */
export function trailTileAlpha(
  level: 0 | 1 | 2,
  density: number,
  seenByAnyone: boolean,
  seenByCarrier: boolean
): number {
  let alpha = 0;
  if (level === 2 && seenByCarrier) alpha = LINE_ALPHA;
  if (level >= 1 && density > 0 && seenByAnyone) {
    const spoil = SPOIL_ALPHA_FLOOR + SPOIL_ALPHA_SCALE * (density / SPOIL_DENSITY_MAX);
    if (spoil > alpha) alpha = spoil;
  }
  return alpha;
}
