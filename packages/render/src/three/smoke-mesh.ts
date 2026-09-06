/**
 * Phase D readiness fix: smoke on screen. `sim.smoke` is a real, working
 * mechanic -- a player-driven ability (`canSmoke`, the `f` key), a genuine
 * line-of-sight block (`raySmoke`/`losRay`, `@lions/sim/sim.ts`) -- and until
 * this file existed, three.js drew nothing for it at all: `grep -rn smoke
 * packages/render/src/three/` returned zero hits. A player who pops smoke
 * paid the ability, got the LOS block, and saw no change on screen
 * whatsoever -- "the worst failure class available: a working mechanic
 * rendered invisible" (Phase D readiness audit, blocker #2). This module is
 * the fix: it draws what `sim.smoke` already computes, the same way
 * `fog-mesh.ts` draws `Sim`'s own fog array -- that file is this one's
 * direct structural template (per-tile `Uint8Array`, `groundWorldY`-lifted
 * instanced geometry, pure write function separated from GPU construction).
 *
 * ## Ported from `renderer.ts:2576-2591`, not redesigned -- history
 *
 * Pixi's smoke loop drew a screen-space diamond per tile: `d = smoke[t]; if
 * (d === 0) continue; g.poly([...]).fill({ color: '#C9CBC4', alpha: (d /
 * 255) * 0.72 })`. That formula and that one-quad-per-tile shape were ported
 * verbatim through GH #144 (bob/drift/noise/grow-in, see that section
 * below, kept for history). This task (the lead's queue item, "improve
 * smoke animation", 2026-09-06) replaces BOTH halves and is deliberately
 * NOT a Pixi port any more -- see the next two sections for why, and
 * CLAUDE.md's "VFX are exempt from this diff as of 2026-08-30" for the
 * standing licence to do it: "an effect that exists only in three is the
 * intended end state, not a divergence to be reconciled."
 *
 * ## Defect #1 (shape): photographed as a tarpaulin, not smoke
 *
 * One flat, screen-aligned quad per smoked tile, alpha the only channel, is
 * a HARD-EDGED shape with a visible seam at every tile boundary. Screenshot
 * evidence (Tel Marum II, an `apc_eitan` smoke order, 29 tiles, density
 * 224/255): "a hard-edged MOSAIC of pale, tile-shaped translucent quads with
 * every tile boundary visible -- it reads as a tarpaulin laid on the sand."
 * GH #144's bob/drift/noise animate the EXISTING quad without changing its
 * shape, so none of it touches this defect -- confirmed by hand, the same
 * way the scale-pulse regression two sections below was: an animated hard
 * edge is still a hard edge.
 *
 * The fix is `SMOKE_PUFFS_PER_TILE` (3) small, round, SOFT-edged discs per
 * tile instead of one square one -- the same `1.0 -
 * smoothstep(SOFT_PARTICLE_CORE, 1.0, d)` feather `units/fx.ts`'s own
 * `smoke_puff` particles already use for exactly this reason (see that
 * file's own "`aSoft`: `smoke_puff` is feathered" section: "a stack of
 * concentric flat-filled circles does not read as N puffs, it reads as TWO
 * discs with a lighter rim" -- the fix there is the fix here, reused rather
 * than reinvented, down to importing `SOFT_PARTICLE_CORE` directly). Three
 * per tile, each 1.3-1.8 tiles across (`SMOKE_PUFF_RADIUS_MIN`/`_MAX`,
 * radius 0.65-0.9), offset from the tile's own centre by a small
 * deterministic amount (`SMOKE_PUFF_OFFSET_MAX`, 0.10 tiles) so the three
 * are visually distinguishable rather than stacked. Two placement facts are
 * load-bearing and both are proven in `smoke-mesh.test.ts`, not merely
 * argued here:
 *
 *  1. **Every puff crosses all four of its OWN tile's edges, in the worst
 *     case roll.** `SMOKE_PUFF_RADIUS_MIN - SMOKE_PUFF_OFFSET_MAX = 0.55`,
 *     strictly greater than a tile's own half-width (0.5) -- so even the
 *     smallest possible puff (radius 0.65), offset as far as it can roll
 *     AWAY from a given edge (0.10), still reaches 0.05 tiles PAST that
 *     edge into the neighbour. That holds independently for every one of a
 *     tile's four edges and for every puff regardless of its own hash roll
 *     -- it is an inequality between two CONSTANTS, not a statistical
 *     tendency, and `smoke-mesh.test.ts` checks both the inequality itself
 *     and that the placement function's real output never violates it.
 *     Every smoked tile's own three puffs therefore already spill into all
 *     four neighbours before neighbour puffs are even considered -- which
 *     is what erases the seam: the boundary line is never the edge of
 *     anything, on either side of it.
 *  2. **Rotation cannot violate guarantee 1, by construction, regardless of
 *     angle.** See "Rotation without breaking the reach guarantee" below.
 *
 * ## Defect #2 (legibility): `smokeDensityAlpha`, not `(d/255)*0.72`
 *
 * Screenshot evidence, the same report: at density 68/255 (150 ticks after
 * a lay) the OLD linear formula draws alpha `(68/255)*0.72 = 0.192` --
 * "has all but vanished on screen while `sim.smoke` still blocks line of
 * sight through every one of those tiles." The sim's own decay
 * (`SMOKE_DECAY` = 1 per tick, `sim.ts`) is LINEAR in ticks, so a linear
 * alpha-vs-density mapping spends most of a screen's visible life reading
 * as barely-there haze even though it is mechanically full-strength cover
 * for most of that time (`SMOKE_BLOCKS_AT` = 320... no such reading is ever
 * reached; the real gate is `raySmoke`'s continuous cover term, which does
 * not go to zero until `d` does).
 *
 * `smokeDensityAlpha` is a gamma curve, `SMOKE_ALPHA_CEIL * (1 - (1 -
 * d/255)^SMOKE_ALPHA_GAMMA)`, front-loaded (`SMOKE_ALPHA_GAMMA` = 1.5 > 1
 * bends the curve UP away from the diagonal at low `d`) so a thinning
 * screen stays visible much longer into its own decay. Solved against the
 * brief's two stated targets, `SMOKE_ALPHA_CEIL` fixed at 0.80 first (see
 * "Why 0.80, not 0.85" below):
 *
 *   smokeDensityAlpha(68)  = 0.2977  (target "~0.30" -- hit within 0.003)
 *   smokeDensityAlpha(224) = 0.7661  (target "~0.80" -- 0.034 short; see below)
 *   smokeDensityAlpha(255) = 0.80    (the ceiling itself; only at the
 *                                      instant a screen is laid, before any
 *                                      decay tick has run)
 *   smokeDensityAlpha(1)   = 0.0047  (a one-tick-old wisp: faint, never zero)
 *
 * Against the OLD linear formula, `smokeDensityAlpha(68) = 0.298` is 55%
 * MORE opaque than `(68/255)*0.72 = 0.192` -- the low end is where the
 * reported defect actually lived, and it is where this curve spends its own
 * shape.
 *
 * ### Why 0.80, not 0.85 (a real trade, not a rounding accident)
 *
 * A ceiling of 0.85 hits the 224-target almost exactly (0.8055, solved with
 * `SMOKE_ALPHA_GAMMA` = 1.4) -- but `units/collapse-shroud.ts`'s own
 * `COLLAPSE_SHROUD_DENSITY` (0.82, walked and screenshot-measured against a
 * live building swap, not a guess) is deliberately picked to sit ABOVE both
 * `SMOKE_PLUME_DENSITY` (0.62) and this file's own OLD ceiling (0.72) --
 * that file's own comment: "both of those are AMBIENT smoke that a player
 * has to keep fighting through... This is not that... if it is see-through
 * [the mesh swap] is visible and the effect has failed outright." Raising
 * THIS ceiling to 0.85 would put ordinary battlefield smoke ABOVE a
 * building's own death cloud's per-puff density, inverting that ordering
 * for a value this task was never asked to touch and that file's own report
 * measured against real screenshots. 0.80 keeps `SMOKE_ALPHA_CEIL <
 * COLLAPSE_SHROUD_DENSITY` true (0.80 < 0.82) while still comfortably
 * clearing the low-density defect that motivated this whole task -- the
 * 224-density undershoot (0.766 against a stated "~0.80") is the accepted
 * cost of not disturbing a different file's own measured constant.
 *
 * `smokeDensityAlpha` never returns more than `SMOKE_ALPHA_CEIL` (0.80,
 * comfortably under 1) for any `d`, satisfying Pixi's own rule this file has
 * always ported: "it obscures, it does not delete them" -- a rifleman
 * standing in even a freshly-laid, full-density screen still reads through
 * 20% alpha.
 *
 * ## `SMOKE_COLOR`: moved onto the palette, not merely re-justified
 *
 * The colour used to be `'#C9CBC4'`, Pixi's own literal, kept as a literal
 * because this file's own precedent (`FOG_COLOR`) is "port the hex Pixi
 * hardcodes, exactly, even where it happens not to equal a palette entry."
 * That precedent existed to hold this effect's SHAPE and FORMULA faithful
 * to Pixi's own while a cross-backend diff still measured them -- and this
 * task already breaks both (puffs, not a quad; a curve, not a line), so the
 * "port Pixi's literal" reasoning has nothing left to protect. `#C3C7C4` is
 * `gunmetal.0` exactly (`data/palette.json`'s `gunmetal` ramp, "weapons,
 * tracks, antennae, industrial") -- a Euclidean RGB distance of ~7 from the
 * old literal (201,203,196) vs (195,199,196), imperceptible on a translucent
 * overlay -- so this is a real, named palette entry now rather than a
 * near-miss hex nobody could point to a swatch for.
 *
 * ## Band: `SMOKE_RENDER_ORDER` (5), not `OVERLAY_RENDER_ORDER` (4)
 *
 * See `units/render-order.ts`'s own band-5 row for the full argument:
 * unchanged by this task. `depthTest: false` stays for the identical reason
 * -- an unconditional overlay, so a unit standing inside a puff still reads
 * through it rather than the puff losing the depth test to the unit's own
 * raised geometry.
 *
 * ## GH #144: animation added on top, still driven off the same clock
 *
 * The paragraphs above describe the ORIGINAL Pixi-faithful port. GH #144
 * added bob/drift/bounded-alpha-noise/grow-in on top of it, all driven by
 * real frame time (`clockMs`, an accumulated `dtMs` total the caller owns --
 * `ThreeRenderer.smokeClockMs` -- never `Date.now()`/`performance.now()`).
 * None of it can affect simulation outcomes: it only ever reads `sim.smoke`,
 * never writes it. This task's own puff placement and rotation (below) are
 * driven off the SAME `clockMs` parameter -- no second clock was added, per
 * this task's own brief.
 *
 * ## A smooth phase FIELD for animation; an UNCORRELATED hash for placement
 * -- these are deliberately different, and both are right
 *
 * `smokeTilePhase` (below, unchanged since GH #144) lays a slow plane wave
 * across the map so a tile's bob/alpha-breathing phase is close to its
 * neighbour's -- see that function's own doc comment for the full account
 * of why an uncorrelated hash there produced a chequerboard. `writeSmokePuffPlacement`
 * (new, this task) is the OPPOSITE requirement and deliberately uses an
 * uncorrelated integer hash (`smokeHash32`) instead: a tile's own three
 * puffs need to sit at visibly different offsets/sizes/angles from EACH
 * OTHER, and neighbouring tiles need to look like different arrangements of
 * puffs, or the whole field reads as one stamp repeated on a grid -- the
 * mosaic defect returning through a back door. Smoothness is right for a
 * value that must not jump between neighbours (a breathing phase); it is
 * wrong for a value whose whole job is to break up a repeating pattern
 * (a placement). Both live in this file because both are true at once.
 *
 * ## Rotation without breaking the reach guarantee
 *
 * Each puff spins slowly and independently (`baseAngle` + `spinRate *
 * clockMs`, both per-puff hash values, `SMOKE_PUFF_SPIN_MAX_RATE` capping
 * the fastest roll at one full turn per 40 s) -- but a puff's local shape is
 * NOT a plain circle: it is an ellipse, `scale.x = radius *
 * SMOKE_PUFF_ELONGATION` (1.3), `scale.z = radius` UNCHANGED. Rotating a
 * circle around its own centre is invisible (full rotational symmetry) --
 * an ellipse's spin reads as a slow, organic wobble in the combined
 * silhouette instead, which a perfectly round soft disc cannot show at all.
 *
 * The elongation is applied ONLY by lengthening the major axis, never by
 * shortening the minor one -- `scale.z` stays exactly `radius`, the same
 * value the reach guarantee above was derived from. An ellipse's distance
 * from its own centre to its own boundary is never LESS than its minor
 * semi-axis, at any angle -- so the worst-case reach in any single world
 * direction, at any rotation, is still >= `radius`, identical to the
 * plain-circle case the guarantee above proves. Elongating the OTHER axis
 * only ever ADDS reach on top of that floor; it can widen the margin, never
 * spend it. `SMOKE_PUFF_ELONGATION >= 1` is asserted directly in
 * `smoke-mesh.test.ts` as the one fact this argument depends on.
 *
 * ## Capacity: measured against a real multi-order scenario, not the map
 *
 * The pre-this-task `SmokeMesh` sized its one-quad-per-tile capacity to
 * `width * height` -- every tile smoked at once, matching `FogMesh`'s own
 * "the worst case is also the boot state" reasoning, which does not hold
 * for smoke (nothing lays a screen before the player does). This task's own
 * brief asks for a MEASURED number instead. Run through the real `Sim`
 * (`packages/sim/src/sim.ts`, five `k_demo`-type units each firing one
 * `smoke` command at t=0 on a 40x40 map, `SMOKE_RADIUS` = 3):
 *
 *   5 orders, spread apart (no overlap): peak 145 non-zero tiles (5 * 29,
 *     the exact discrete count of an integer-radius-3 disc -- confirms no
 *     tile is double-counted).
 *   6 orders, packed 3 tiles apart (worst-case overlap): peak 98 -- LOWER,
 *     because overlapping screens share tiles rather than adding to them.
 *
 * `SMOKE_TILE_CAPACITY` (512) sits ~3.5x over the higher, non-overlapping
 * measurement -- comfortable headroom for a genuinely chaotic multi-squad
 * engagement without paying for `width * height` (2304 on every shipped
 * map) tiles that are never simultaneously smoked in practice. Past
 * capacity, `writeSmokeInstances` silently stops writing (unchanged
 * contract, matching `OverlayBatch`/`ParticleInstancer`'s own "silently
 * dropped past capacity" precedent) -- a visual-only truncation of the
 * FARTHEST-scanned tiles, never a sim effect: `raySmoke` reads `sim.smoke`
 * directly and is untouched by anything in this file. Total puff capacity
 * is `SMOKE_TILE_CAPACITY * SMOKE_PUFFS_PER_TILE` = 1536, capped below that
 * by `width * height * SMOKE_PUFFS_PER_TILE` for a map or test fixture
 * smaller than 512 tiles (every shipped map is 48x48 = 2304, so 512 is the
 * operative number on all of them).
 */
import * as THREE from 'three';
import { pushPolygon, hexToUnit } from './terrain/shared';
import { tileGroundWorldY, type ElevationSource } from './ground-height';
import { SOFT_PARTICLE_CORE } from './units/fx';
import { SMOKE_RENDER_ORDER } from './units/render-order';

// ---------------------------------------------------------------------------
// Pure: no THREE.* below this line yet -- mirrors fog-mesh.ts's own split.
// ---------------------------------------------------------------------------

/** `gunmetal.0` (`data/palette.json`), exactly -- see this file's own top
 *  comment, "`SMOKE_COLOR`: moved onto the palette, not merely
 *  re-justified", for why this is no longer Pixi's own `#C9CBC4` literal. */
export const SMOKE_COLOR = '#C3C7C4';

/** Alpha ceiling `smokeDensityAlpha` approaches as `d -> 255` -- see this
 *  file's own "Why 0.80, not 0.85" section for why this is fixed BELOW
 *  `units/collapse-shroud.ts`'s `COLLAPSE_SHROUD_DENSITY` (0.82) rather than
 *  solved purely against the brief's own "~0.80 at d=224" target. */
export const SMOKE_ALPHA_CEIL = 0.8;
/** Exponent bending `smokeDensityAlpha` up away from the linear diagonal at
 *  low density -- solved so `smokeDensityAlpha(68)` lands within 0.003 of
 *  the brief's stated "~0.30" target at `SMOKE_ALPHA_CEIL` = 0.8. Greater
 *  than 1: exactly 1 would reproduce the old linear formula's shape
 *  (scaled), and 1 is the value that under-served density 68 in the first
 *  place. */
export const SMOKE_ALPHA_GAMMA = 1.5;

/**
 * Density-to-alpha curve replacing Pixi's own `(d / 255) * 0.72` linear
 * mapping -- see this file's own "Defect #2 (legibility)" section for the
 * measured values at the brief's own two stated densities and why this
 * shape (front-loaded, not linear) is what the fix actually is. Monotonic
 * non-decreasing in `d`, and bounded strictly below 1 for every `d` in
 * [0, 255] (`SMOKE_ALPHA_CEIL` < 1) -- a rifleman standing in even the
 * freshest, thickest screen this function can describe still reads through
 * it, matching Pixi's own "it obscures, it does not delete them."
 */
export function smokeDensityAlpha(d: number): number {
  const t = d / 255;
  return SMOKE_ALPHA_CEIL * (1 - Math.pow(1 - t, SMOKE_ALPHA_GAMMA));
}

/** Per-instance GPU attribute arrays `writeSmokeInstances` fills, sized (by
 *  the caller) to the TILE capacity (`SmokeMesh`'s own `tileCapacity`, not
 *  the full puff count) -- one entry per smoked TILE, before that tile's
 *  `SMOKE_PUFFS_PER_TILE` puffs are derived from it in `SmokeMesh.update`. */
export interface SmokeInstanceBuffers {
  /** xyz triples, world space -- the tile's own `(x, groundWorldY, y)`. */
  positions: Float32Array;
  /** One alpha per instance: `smokeDensityAlpha(d)`. */
  alphas: Float32Array;
}

/**
 * Visits every tile with `smoke[t] !== 0` and writes its world position and
 * TILE-level alpha (`smokeDensityAlpha`, not the old linear formula). Pure
 * aside from `groundWorldY` (itself pure) -- no `THREE.*`. This function's
 * own responsibility is UNCHANGED from before this task: deciding WHICH
 * tiles have smoke and what their base alpha is. Turning one tile-level
 * entry into `SMOKE_PUFFS_PER_TILE` drawn puffs is `SmokeMesh.update`'s job,
 * not this one's -- the same division of labour `writeFogInstances` and
 * `FogMesh` already keep.
 *
 * Returns the number of TILE instances written (not puffs), which the
 * caller multiplies by `SMOKE_PUFFS_PER_TILE` for the actual instance count
 * it sets `mesh.count` to.
 */
export function writeSmokeInstances(
  smoke: Uint8Array,
  width: number,
  height: number,
  elevation: ElevationSource,
  out: SmokeInstanceBuffers
): number {
  const capacity = out.alphas.length;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = smoke[y * width + x];
      if (d === 0) continue;
      if (count >= capacity) return count;
      out.positions[count * 3] = x;
      // The TILE's own height, sampled at its centre -- see
      // `tileGroundWorldY`.
      out.positions[count * 3 + 1] = tileGroundWorldY(elevation, width, height, x, y);
      out.positions[count * 3 + 2] = y;
      out.alphas[count] = smokeDensityAlpha(d);
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Presentation animation (GH #144) -- still pure, still no THREE.*.
//
// GH #144: SmokeMesh had zero visual animation -- a fixed flat quad,
// translation-only, alpha the only channel, redrawn verbatim from the sim's
// own byte every frame. The functions below add drift/billow/breathing on
// top of that unchanged baseline, driven by REAL frame time (`clockMs`, an
// accumulated `dtMs` total the caller owns -- see `ThreeRenderer.smokeClockMs`
// -- never `Date.now()`/`performance.now()`, matching `windClockMs`/
// `trackClockMs`'s identical existing pattern and `Renderer.frame`'s
// documented contract that a backend must not read its own clock). None of
// this is sim-tick-driven and none of it can affect simulation outcomes: it
// only ever reads `sim.smoke`, never writes it.
//
// ## The desync guarantee this design protects, explicitly
//
// `raySmoke` (`packages/sim/src/sim.ts`) blocks sight off `sim.smoke[tile]`
// directly, independent of anything below. Two invariants keep the visual
// truthful to that:
//
//   1. WHETHER a tile draws at all is untouched. `writeSmokeInstances` above
//      still writes no instance for `smoke[t] === 0` and exactly one TILE
//      entry (now expanded to `SMOKE_PUFFS_PER_TILE` puffs) for
//      `smoke[t] !== 0`, on the same `d !== 0` test `raySmoke` itself
//      effectively uses.
//   2. HOW VISIBLE a drawn tile is stays bounded away from zero for as long
//      as `d > 0`. `smokeAlphaNoise` (floor `SMOKE_ALPHA_NOISE_MIN`) and
//      `smokeGrowAlphaFactor` (floor `SMOKE_GROW_ALPHA_FLOOR`) both stay
//      strictly positive at every input, so their product against
//      `smokeDensityAlpha(d)` can dim a tile's puffs but never zero them
//      while `d > 0`.
//
// Position motion (`smokeBobOffset`, `smokeDriftX/Z`) is purely cosmetic
// wobble bounded to a small fraction of one tile
// (`SMOKE_BOB_AMPLITUDE`/`SMOKE_DRIFT_AMPLITUDE` are both well under half a
// tile) -- a puff never visually leaves the neighbourhood of the tile whose
// `sim.smoke` value it represents (this task's own placement offset,
// `SMOKE_PUFF_OFFSET_MAX`, is the same order of magnitude and is itself
// bounded, see this file's own top comment), so nothing here implies LOS
// coverage anywhere the sim doesn't also grant it.
//
// ## Geometry cannot carry a STEADY-STATE SCALE PULSE on a tile-bound quad
// -- puffs sidestep this, they do not repeal it
//
// THE OLD SCALE PULSE IS GONE, and the measurement that killed it is worth
// keeping (history, unaffected by this task's own puff redesign): a quad
// centred on and BOUNDED BY its own tile seams against its neighbour the
// moment its scale differs from exactly 1, uniformly, across the whole
// screen -- a GRID. This task's own puffs do NOT reintroduce a scale pulse
// (`smokeGrowScaleFactor` still only ever runs during the birth window and
// still only ever settles to exactly 1) and are not "bounded by their own
// tile" in the first place -- they overlap their neighbours by design (this
// file's own reach-guarantee section) -- so nothing here revisits that
// mistake; independent per-puff ROTATION is a different animation channel
// with a different failure mode, addressed in its own section above.
//
// ## A smooth phase FIELD, not a per-tile hash -- for ANIMATION only
//
// `smokeTilePhase` lays a slow plane wave across the map, so every tile has
// its own phase (no lockstep) and neighbouring tiles have NEARLY THE SAME
// one. See this file's own top comment, "A smooth phase FIELD for
// animation; an UNCORRELATED hash for placement", for why this function's
// smoothness requirement and `writeSmokePuffPlacement`'s deliberate
// UN-smoothness are both correct, for different jobs.
//
// ## Grow-in tracks the SPECIFIC 0->nonzero transition, not `d`'s magnitude
//
// The sim lays a screen at instant full density (`SMOKE_MAX`, one tick) and
// decays it uniformly (`SMOKE_DECAY` per tick) -- see `sim.ts`'s own smoke
// command handler and `stepFields`. `updateSmokeGrowStarts` below detects
// exactly that lay moment per tile (comparing this frame's `smoke` against
// the previous frame's) and stamps a start clock; `smokeGrowAlphaFactor`
// ramps up from its floor and `smokeGrowScaleFactor` settles DOWN from its
// overshoot to exactly 1, both over `SMOKE_GROW_DURATION_MS` from that
// stamp -- applied per TILE (all `SMOKE_PUFFS_PER_TILE` puffs of a newly-laid
// tile bloom together, on the tile's own single growth clock) rather than
// per puff, so a tile's three puffs burst as one cluster, not staggered.

const TWO_PI = Math.PI * 2;

/** Vertical bob amplitude, in tile units -- comfortably under half a tile,
 *  so a smoked tile's puffs never visually stray into a neighbour's
 *  footprint. */
export const SMOKE_BOB_AMPLITUDE = 0.08;
/** Full bob cycle length. A few seconds, not a fast flutter -- "billow", not
 *  a shiver. */
export const SMOKE_BOB_PERIOD_MS = 3200;

/** Horizontal drift amplitude, in tile units -- same "stays inside the
 *  tile" reasoning as the bob amplitude above. */
export const SMOKE_DRIFT_AMPLITUDE = 0.06;
/** Drift period, deliberately different from the bob period so the two
 *  motions don't lock into a single repeating Lissajous loop that would
 *  read as mechanical. */
export const SMOKE_DRIFT_PERIOD_MS = 5400;

/**
 * Period of the density breath `smokeAlphaNoise` runs -- SLOW, because it is
 * the only per-tile billow channel this effect has and a fast cycle reads
 * as a flicker rather than a swell.
 */
export const SMOKE_BREATH_PERIOD_MS = 3700;

/**
 * Spatial frequency of the phase field `smokeTilePhase` lays across the
 * map, in cycles per tile on X and on Y -- unchanged since GH #144. See
 * this file's own top comment for why this field is deliberately SMOOTH,
 * the opposite requirement from `writeSmokePuffPlacement`'s hash.
 *
 * 0.11 and 0.071: a full cycle every ~9 tiles on X and ~14 on Y.
 */
export const SMOKE_PHASE_FREQ_X = 0.11;
export const SMOKE_PHASE_FREQ_Y = 0.071;

/** Alpha-noise floor -- the multiplier this channel applies never drops
 *  below this, so it alone can never zero a tile's alpha. Ranges
 *  `[SMOKE_ALPHA_NOISE_MIN, 1]`. */
export const SMOKE_ALPHA_NOISE_MIN = 0.72;
export const SMOKE_ALPHA_NOISE_PERIOD_MS = SMOKE_BREATH_PERIOD_MS;

/** How long a freshly-laid tile takes to bloom from its grow floor to full
 *  presentation strength. Brief -- "a few hundred ms" -- not a slow fade a
 *  player would read as latency. */
export const SMOKE_GROW_DURATION_MS = 350;
/** Alpha-side grow floor. Combined with `SMOKE_ALPHA_NOISE_MIN` the worst
 *  case multiplier is `SMOKE_GROW_ALPHA_FLOOR * SMOKE_ALPHA_NOISE_MIN`
 *  (~0.25) -- dim, never zero, at the exact instant a tile is born. */
export const SMOKE_GROW_ALPHA_FLOOR = 0.35;
/**
 * Scale a freshly-laid tile's puffs OVERSHOOT to before settling back to
 * exactly 1 over `SMOKE_GROW_DURATION_MS` -- the screen bursts outward and
 * settles, rather than growing in from small. See GH #144's own account
 * (history, in this file's earlier revisions) for why overshooting reads
 * better than a floor-to-1 grow: every tile of one screen is born on the
 * same tick, so whatever the grow scale is, it is shared by all of them at
 * once, and undershoot opens a lattice of gaps while overshoot only ever
 * thickens an already-overlapping cloud.
 */
export const SMOKE_GROW_SCALE_OVERSHOOT = 1.18;

/** Deterministic per-tile phase, radians -- a smooth plane wave across the
 *  map rather than an uncorrelated hash, so neighbouring tiles animate
 *  ALMOST together and a screen billows instead of flickering. See this
 *  file's own top comment for the full account of what this is for and how
 *  it differs from `writeSmokePuffPlacement`'s hash. Still a pure function
 *  of `(x, y)`; still not `Math.random()`. */
export function smokeTilePhase(x: number, y: number): number {
  const cycles = x * SMOKE_PHASE_FREQ_X + y * SMOKE_PHASE_FREQ_Y;
  return (cycles - Math.floor(cycles)) * TWO_PI;
}

/** Small sine bob on world Y, phase-offset per tile so a whole screen does
 *  not bob in lockstep. */
export function smokeBobOffset(clockMs: number, phase: number): number {
  return SMOKE_BOB_AMPLITUDE * Math.sin((clockMs / SMOKE_BOB_PERIOD_MS) * TWO_PI + phase);
}

/**
 * Horizontal drift, X axis -- COHERENT, no per-tile phase. A breeze moves
 * the whole field together; per-puff drift would read as jitter and would
 * also (on the OLD single-quad geometry) open/close gaps between
 * neighbours. Takes NO phase parameter at all -- the missing parameter is
 * the point, see GH #144's own history for the measured mistake this
 * replaced.
 */
export function smokeDriftX(clockMs: number): number {
  return SMOKE_DRIFT_AMPLITUDE * Math.sin((clockMs / SMOKE_DRIFT_PERIOD_MS) * TWO_PI);
}

/** Horizontal drift, Z axis -- coherent, see `smokeDriftX`. `cos` against
 *  its `sin` so the whole field traces a slow ellipse rather than sliding
 *  back and forth along one line. */
export function smokeDriftZ(clockMs: number): number {
  return SMOKE_DRIFT_AMPLITUDE * Math.cos((clockMs / SMOKE_DRIFT_PERIOD_MS) * TWO_PI);
}

/** Bounded per-tile alpha texture, `[SMOKE_ALPHA_NOISE_MIN, 1]` -- a sine
 *  remapped into that range rather than a raw `[-1, 1]` oscillation, so the
 *  floor is reachable exactly and never crossed. */
export function smokeAlphaNoise(clockMs: number, phase: number): number {
  const s = Math.sin((clockMs / SMOKE_ALPHA_NOISE_PERIOD_MS) * TWO_PI + phase * 2.3);
  return SMOKE_ALPHA_NOISE_MIN + (1 - SMOKE_ALPHA_NOISE_MIN) * ((s + 1) / 2);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Smoothstep ease, `[0, 1]` -> `[0, 1]`, clamped outside its domain. */
function smoothstep01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** 0 at the instant a tile is born (`ageMs === 0`), 1 once
 *  `SMOKE_GROW_DURATION_MS` has elapsed, eased -- the shared ramp both grow
 *  factors below lerp into their own floor. */
export function smokeGrowEase(ageMs: number): number {
  return smoothstep01(ageMs / SMOKE_GROW_DURATION_MS);
}

/** Alpha-side grow multiplier, `[SMOKE_GROW_ALPHA_FLOOR, 1]`. */
export function smokeGrowAlphaFactor(ageMs: number): number {
  const t = smokeGrowEase(ageMs);
  return SMOKE_GROW_ALPHA_FLOOR + (1 - SMOKE_GROW_ALPHA_FLOOR) * t;
}

/** Scale-side grow multiplier, `[1, SMOKE_GROW_SCALE_OVERSHOOT]`, settling
 *  DOWN to exactly 1. Never below 1 -- see `SMOKE_GROW_SCALE_OVERSHOOT`'s
 *  own doc comment. */
export function smokeGrowScaleFactor(ageMs: number): number {
  const t = smokeGrowEase(ageMs);
  return SMOKE_GROW_SCALE_OVERSHOOT + (1 - SMOKE_GROW_SCALE_OVERSHOOT) * t;
}

/**
 * Stamps `growStart[tileIndex] = clockMs` for every tile that is nonzero
 * THIS call and was zero on the PREVIOUS call (`prevSmoke`), then copies
 * `smoke` into `prevSmoke` for the next call's diff. Mutates both `growStart`
 * and `prevSmoke` in place. Unchanged by this task.
 */
export function updateSmokeGrowStarts(
  smoke: Uint8Array,
  prevSmoke: Uint8Array,
  growStart: Float64Array,
  clockMs: number,
  width: number,
  height: number
): void {
  const count = width * height;
  for (let i = 0; i < count; i++) {
    if (smoke[i] !== 0 && prevSmoke[i] === 0) {
      growStart[i] = clockMs;
    }
  }
  prevSmoke.set(smoke);
}

// ---------------------------------------------------------------------------
// Puff placement (this task) -- still pure, still no THREE.*.
// ---------------------------------------------------------------------------

/** How many soft-edged puffs draw per smoked tile -- see this file's own
 *  top comment, "Defect #1 (shape)", for why 3 (not 1) is the fix. Fixed
 *  rather than randomised per tile: a constant count keeps capacity
 *  planning exact (`SMOKE_TILE_CAPACITY * SMOKE_PUFFS_PER_TILE` is the
 *  WHOLE mesh capacity, not a bound on an average) and the per-puff radius
 *  roll (`SMOKE_PUFF_RADIUS_MIN`..`_MAX`) already gives three puffs of one
 *  tile visibly different sizes, which is most of what a variable count
 *  would have bought. */
export const SMOKE_PUFFS_PER_TILE = 3;

/** Puff radius range, tiles -- 1.3 to 1.8 tiles ACROSS (diameter), per the
 *  brief. `SMOKE_PUFF_RADIUS_MIN` is also the one figure the reach
 *  guarantee below is solved against -- see this file's own top comment,
 *  "Defect #1 (shape)", point 1. */
export const SMOKE_PUFF_RADIUS_MIN = 0.65;
export const SMOKE_PUFF_RADIUS_MAX = 0.9;

/** Maximum per-axis offset of a puff's own centre from its tile's centre,
 *  tiles. Small relative to the puff's own radius on purpose -- the three
 *  puffs of one tile are meant to read as one slightly irregular cloud, not
 *  as three separated blobs -- and small enough that
 *  `SMOKE_PUFF_RADIUS_MIN - SMOKE_PUFF_OFFSET_MAX` (0.55) clears a tile's
 *  own half-width (0.5) with a real margin (0.05) in the worst-case roll.
 *  See this file's own top comment for the full inequality. */
export const SMOKE_PUFF_OFFSET_MAX = 0.1;

/**
 * Major/minor semi-axis ratio of a puff's ellipse -- see this file's own
 * "Rotation without breaking the reach guarantee" section. The MINOR axis
 * is left at exactly `radius` (unchanged from a plain circle); this only
 * lengthens the other one, so it can only ADD reach, never subtract from
 * the guarantee `SMOKE_PUFF_RADIUS_MIN`/`SMOKE_PUFF_OFFSET_MAX` establish.
 * 1.3: a visible elongation (so slow rotation actually reads as motion)
 * without reading as a lozenge rather than a puff.
 */
export const SMOKE_PUFF_ELONGATION = 1.3;

/** Fastest a single puff's independent spin can run -- one full turn every
 *  40 s. Most puffs roll much slower than this (the hash spans
 *  `[-SMOKE_PUFF_SPIN_MAX_RATE, SMOKE_PUFF_SPIN_MAX_RATE]`, including
 *  near-zero), and direction is independent per puff -- "slow", per the
 *  brief, not a pinwheel. */
export const SMOKE_PUFF_SPIN_PERIOD_MS = 40000;
export const SMOKE_PUFF_SPIN_MAX_RATE = TWO_PI / SMOKE_PUFF_SPIN_PERIOD_MS;

/**
 * Deterministic 32-bit integer hash (a standard Thomas-Wang-style
 * multiply/xor-shift mix) -- pure, no `Math.random()`, no external state.
 * Used ONLY for static per-puff PLACEMENT below, never for animation phase
 * -- see this file's own top comment, "A smooth phase FIELD for animation;
 * an UNCORRELATED hash for placement", for why the two need opposite
 * correlation properties and both are provided.
 */
function smokeHash32(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296; // [0, 1)
}

/** One deterministic `[0, 1)` sample for `(tileIndex, puffIndex, channel)`
 *  -- five independent channels per puff (offsetX, offsetZ, radius,
 *  baseAngle, spinRate), each its own slot in the hash so rolling a large
 *  radius does not correlate with rolling a particular offset or angle. */
function smokePuffSample(tileIndex: number, puffIndex: number, channel: number): number {
  return smokeHash32((tileIndex * SMOKE_PUFFS_PER_TILE + puffIndex) * 5 + channel);
}

/** One puff's static placement, local to its own tile's centre. Filled by
 *  `writeSmokePuffPlacement` into a caller-owned, reused object -- the same
 *  "pure function fills the caller's own scratch object" contract
 *  `writeSmokeInstances` already uses, so `SmokeMesh.update`'s per-puff loop
 *  allocates nothing per frame (this task's own "no per-frame allocation"
 *  requirement). */
export interface SmokePuffPlacement {
  /** Tiles, local to the tile's own centre. */
  offsetX: number;
  offsetZ: number;
  /** Tiles -- the ellipse's MINOR semi-axis (and a plain circle's radius
   *  before `SMOKE_PUFF_ELONGATION` stretches one axis). */
  radius: number;
  /** Radians, this puff's orientation at `clockMs === 0`. */
  baseAngle: number;
  /** Radians per ms, this puff's own constant spin rate (sign gives
   *  direction). */
  spinRate: number;
}

/**
 * Writes tile `tileIndex`'s puff number `puffIndex`'s placement into `out`.
 * Deterministic: the same `(tileIndex, puffIndex)` always yields the same
 * five values (`smoke-mesh.test.ts`'s own "puff placement determinism"
 * check), and different `puffIndex`/`tileIndex` values yield visibly
 * different ones (the whole point -- see this file's own top comment on why
 * an uncorrelated hash is right here).
 */
export function writeSmokePuffPlacement(tileIndex: number, puffIndex: number, out: SmokePuffPlacement): void {
  out.offsetX = (smokePuffSample(tileIndex, puffIndex, 0) * 2 - 1) * SMOKE_PUFF_OFFSET_MAX;
  out.offsetZ = (smokePuffSample(tileIndex, puffIndex, 1) * 2 - 1) * SMOKE_PUFF_OFFSET_MAX;
  out.radius =
    SMOKE_PUFF_RADIUS_MIN + smokePuffSample(tileIndex, puffIndex, 2) * (SMOKE_PUFF_RADIUS_MAX - SMOKE_PUFF_RADIUS_MIN);
  out.baseAngle = smokePuffSample(tileIndex, puffIndex, 3) * TWO_PI;
  out.spinRate = (smokePuffSample(tileIndex, puffIndex, 4) * 2 - 1) * SMOKE_PUFF_SPIN_MAX_RATE;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction.
// ---------------------------------------------------------------------------

/** How many map tiles' worth of smoke this backend draws puffs for,
 *  regardless of map size -- see this file's own top comment, "Capacity:
 *  measured against a real multi-order scenario, not the map", for the
 *  harness numbers (peak 145 / 98 across two multi-order scenarios) this is
 *  sized against. */
export const SMOKE_TILE_CAPACITY = 512;

/** Local -1..1 quad, lying flat on the ground plane (y=0), radius 1 in
 *  local space -- scaled/rotated per instance via `Matrix4.compose`. Reuses
 *  `fog-mesh.ts`'s `fogQuadGeometry` up-facing winding convention
 *  (`pushPolygon(..., flip: false)`) but CENTRED at the local origin
 *  instead of anchored at a tile's own corner: a puff has to grow and
 *  rotate about its own centre (this task), and a corner-anchored quad is
 *  what forced the old single-tile-quad code's awkward `centerAdjust`
 *  correction -- a centred quad needs none of it, since scaling or
 *  rotating it about the origin leaves it centred by construction. `d =
 *  length(position.xz) > 1.0` in the fragment shader below turns this
 *  square into the actual soft circle/ellipse the puff draws. */
export interface SmokePuffQuadGeometry {
  positions: Float32Array;
  indices: Uint32Array;
}

export function smokePuffQuadGeometry(): SmokePuffQuadGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  pushPolygon(
    positions,
    colors,
    indices,
    [
      [-1, 0, -1],
      [1, 0, -1],
      [1, 0, 1],
      [-1, 0, 1],
    ],
    [0, 0, 0],
    false
  );
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Soft-edged-disc material -- per-instance alpha (`aAlpha`, `writeSmokeInstances`'s
 * `smokeDensityAlpha(d)` further multiplied by the GH #144 breathing/grow
 * factors in `SmokeMesh.update`), a shared `uColor` uniform, and a radial
 * feather reusing `units/fx.ts`'s own `SOFT_PARTICLE_CORE` constant --
 * see that file's own "`aSoft`: `smoke_puff` is feathered" section for why
 * a hard circle reads as a rim-lit disc under overlap and a feathered one
 * does not. `depthTest`/`depthWrite: false` for the same "unconditional
 * overlay" reason `FogMesh`'s own material needs it -- a puff lying flat on
 * the ground would otherwise lose the depth test to a unit standing in it.
 */
function createSmokeMaterial(): THREE.ShaderMaterial {
  const [r, g, b] = hexToUnit(SMOKE_COLOR);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(r, g, b) },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying vec2 vLocal;
      varying float vAlpha;
      void main() {
        vLocal = position.xz;
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vLocal;
      varying float vAlpha;
      void main() {
        float d = length(vLocal);
        if (d > 1.0) discard;
        float feather = 1.0 - smoothstep(${SOFT_PARTICLE_CORE.toFixed(2)}, 1.0, d);
        gl_FragColor = vec4(uColor, vAlpha * feather);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

/**
 * Every smoked tile's `SMOKE_PUFFS_PER_TILE` puffs, one `THREE.InstancedMesh`,
 * one draw call -- capacity `SMOKE_TILE_CAPACITY * SMOKE_PUFFS_PER_TILE`
 * (capped below that for a map/fixture smaller than `SMOKE_TILE_CAPACITY`
 * tiles), not `width * height` -- see this file's own top comment,
 * "Capacity", for the measured scenario this is sized against.
 */
export class SmokeMesh {
  readonly mesh: THREE.InstancedMesh;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly tileCapacity: number;
  private readonly scratchTilePositions: Float32Array;
  private readonly scratchTileAlphas: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3();
  /** Reused every puff, every frame -- `writeSmokePuffPlacement`'s own
   *  "fills the caller's scratch object" contract is what keeps this
   *  class's hot per-frame loop free of per-puff allocation. */
  private readonly scratchPlacement: SmokePuffPlacement = {
    offsetX: 0,
    offsetZ: 0,
    radius: 0,
    baseAngle: 0,
    spinRate: 0,
  };
  /** GH #144: per-tile ms clock at which that tile last transitioned from
   *  smoke-free to smoked. Sized to the FULL grid (`width * height`), not
   *  `tileCapacity` -- `updateSmokeGrowStarts` scans every tile every call
   *  regardless of how many of them this mesh has room to draw. */
  private readonly growStart: Float64Array;
  /** GH #144: the previous call's `smoke` array, same full-grid sizing as
   *  `growStart` and for the identical reason. */
  private readonly prevSmoke: Uint8Array;

  constructor(width: number, height: number) {
    const gridTiles = Math.max(1, width * height);
    this.tileCapacity = Math.min(SMOKE_TILE_CAPACITY, gridTiles);
    const puffCapacity = this.tileCapacity * SMOKE_PUFFS_PER_TILE;

    const geo = smokePuffQuadGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));

    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(puffCapacity), 1);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geometry, createSmokeMaterial(), puffCapacity);
    this.mesh.count = 0;
    this.mesh.renderOrder = SMOKE_RENDER_ORDER;
    // Smoke can drift anywhere on the map, exactly like fog/units/particles
    // -- see UnitInstancer's identical field and comment.
    this.mesh.frustumCulled = false;

    this.scratchTilePositions = new Float32Array(this.tileCapacity * 3);
    this.scratchTileAlphas = new Float32Array(this.tileCapacity);
    this.growStart = new Float64Array(gridTiles);
    this.prevSmoke = new Uint8Array(gridTiles);
  }

  /**
   * Rebuilds every puff instance from the current `smoke` array. Called
   * once per `frame()`, matching Pixi's own per-frame smoke loop (no
   * `fogDirty`-style dirty flag).
   *
   * `clockMs` is GH #144's animation clock, unchanged contract: an
   * accumulated real `dtMs` total the caller owns, defaulting to 0 for a
   * caller that wants the frozen-clock baseline.
   */
  update(
    smoke: Uint8Array,
    elevation: ElevationSource,
    width: number,
    height: number,
    clockMs = 0
  ): void {
    updateSmokeGrowStarts(smoke, this.prevSmoke, this.growStart, clockMs, width, height);
    const tileCount = writeSmokeInstances(smoke, width, height, elevation, {
      positions: this.scratchTilePositions,
      alphas: this.scratchTileAlphas,
    });
    const alphas = this.alphaAttr.array as Float32Array;
    // Coherent field drift -- see this file's own top comment, "A smooth
    // phase FIELD for animation..."; computed once for the whole field,
    // not per tile or per puff, matching GH #144's own fix for the
    // "per-tile drift reads as jitter" mistake.
    const driftX = smokeDriftX(clockMs);
    const driftZ = smokeDriftZ(clockMs);
    let puffCount = 0;
    for (let i = 0; i < tileCount; i++) {
      const x = this.scratchTilePositions[i * 3];
      const groundY = this.scratchTilePositions[i * 3 + 1];
      const z = this.scratchTilePositions[i * 3 + 2];
      const tileIndex = z * width + x;
      const phase = smokeTilePhase(x, z);
      const ageMs = clockMs - this.growStart[tileIndex];
      const growScale = smokeGrowScaleFactor(ageMs);
      const bobY = smokeBobOffset(clockMs, phase);
      // Tile-level alpha (density curve x breathing x grow-in) -- shared by
      // all SMOKE_PUFFS_PER_TILE puffs of this tile, so they bloom/dim
      // together rather than staggered. See this file's own top comment,
      // "Grow-in tracks the SPECIFIC 0->nonzero transition...".
      const tileAlpha =
        this.scratchTileAlphas[i] * smokeAlphaNoise(clockMs, phase) * smokeGrowAlphaFactor(ageMs);

      for (let p = 0; p < SMOKE_PUFFS_PER_TILE; p++) {
        writeSmokePuffPlacement(tileIndex, p, this.scratchPlacement);
        const radius = this.scratchPlacement.radius * growScale;
        const angle = this.scratchPlacement.baseAngle + this.scratchPlacement.spinRate * clockMs;

        this.scratchPos.set(
          x + this.scratchPlacement.offsetX + driftX,
          groundY + bobY,
          z + this.scratchPlacement.offsetZ + driftZ
        );
        this.scratchQuat.setFromAxisAngle(Y_AXIS, angle);
        // Minor axis stays exactly `radius` (z); the major axis (x) is the
        // ONLY one `SMOKE_PUFF_ELONGATION` lengthens -- see this file's own
        // "Rotation without breaking the reach guarantee" section for why
        // this ordering, not the reverse, is what keeps the reach
        // guarantee true at every rotation angle.
        this.scratchScale.set(radius * SMOKE_PUFF_ELONGATION, 1, radius);
        this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
        this.mesh.setMatrixAt(puffCount, this.scratchMatrix);
        alphas[puffCount] = tileAlpha;
        puffCount++;
      }
    }
    this.mesh.count = puffCount;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
