/**
 * The COLLAPSE SHROUD -- the dense, building-sized cloud of pulverised
 * masonry a structure throws at the instant it fails, which then thins to
 * reveal the ruin underneath.
 *
 * ## This is a mechanism, not decoration
 *
 * `ThreeRenderer.updateBuildingMeshes` swaps a building's standing mesh for
 * its wreck mesh the first frame `sim.structures.alive` reads 0. Photographed
 * on `beit_sahwan_outskirts` at zoom 1.6 (`.superpowers/queue/
 * collapse-smoke-report.md`), the mosque is intact on one frame and a flat
 * rubble pile 16.7 ms later, with nothing at all between them -- a hard cut
 * between two models. The authored dust particles and the
 * `units/smoke-plume.ts` column both spawn from the same event, but each has
 * a rise envelope that keeps it near-invisible for its own first fraction of
 * a second, which is exactly the window the cut happens in.
 *
 * So the shroud's job is structural: **cover the whole building at the moment
 * of collapse, let the swap happen hidden inside it, then thin.** That makes
 * the timing load-bearing rather than aesthetic -- see
 * `COLLAPSE_SHROUD_SWAP_DELAY_MS`, which is a fraction of the shroud's own
 * life chosen so the swap lands inside the dense plateau, and
 * `collapseShroudSwapProgress` / this module's own tests, which pin that
 * relationship as arithmetic rather than as a hope.
 *
 * ## It is NOT a reversal of the plume's translucency fix
 *
 * `76d3a4d` made `units/smoke-plume.ts` translucent, because it had been
 * drawn through `createVfxMeshMaterial`'s forced-opaque
 * `gl_FragColor = vec4(uColor, 1.0)` and was a cardboard cutout that hid the
 * building it rose from for its whole four-second life. **Do not read this
 * file as putting that back.** The two are deliberately different behaviours
 * and they coexist:
 *
 *   - The PLUME is ambient and long (4 s). It must stay see-through, because
 *     a player has to keep fighting around a wreck that is still smoking.
 *     Nothing here touches it.
 *   - The SHROUD is local and brief. It is dense for roughly
 *     `COLLAPSE_SHROUD_DURATION_MS * COLLAPSE_SHROUD_HOLD_FRACTION` -- under
 *     a second -- over one building's own footprint, and then spends the
 *     remaining ~1.6 s thinning to nothing. A future reader who "fixes" this
 *     back to translucent-throughout deletes the only thing hiding the mesh
 *     swap and restores the hard cut.
 *
 * The honest way to state the rule: *ambient smoke is see-through; the
 * instant of a collapse is not, for about half a second, over about one
 * building.*
 *
 * ## Coverage is derived from the building, never a constant
 *
 * Buildings are not one size, and the measured spread is wide. World-space
 * bounding boxes of the shipped building GLBs, read off the loaded templates
 * in the browser (`Box3` over `BuildingMeshTemplate.root`, which already
 * carries `MESH_SCALE`):
 *
 * | type | w | h | d |
 * |---|---|---|---|
 * | `apartment` | 4.917 | **7.745** | 4.885 |
 * | `house` | 4.264 | 4.237 | 3.712 |
 * | `mosque` | 3.600 | 3.317 | 2.767 |
 * | `warehouse` | 3.999 | 1.396 | 4.000 |
 * | `shanty` | 2.977 | 1.017 | 2.368 |
 * | `wall` | 1.080 | **0.583** | 1.080 |
 *
 * `apartment` is **13.3x** `wall`'s height. One puff sized for the apartment
 * would swallow a whole compound around a wall panel; one sized for the panel
 * leaves four storeys of apartment bare. So `collapseShroudLayout` takes the
 * building's actual world extents and returns a LATTICE of puffs sized and
 * counted from them -- 4x4x4 = 64 for the apartment, 4x4x3 = 48 for the
 * mosque, 2x2x2 = 8 for a wall panel, with the puff radius falling out of the
 * cell size rather than being chosen.
 *
 * The covering is a guarantee rather than an eyeballed fit, and it is an
 * OPTICAL one, which is the part that took a measurement to get right. Every
 * point of the shroud box lies in some lattice cell, and no point of a cell
 * is further from that cell's centre than half the cell's diagonal -- so a
 * puff whose DENSE CORE is `COLLAPSE_SHROUD_COVER` half-diagonals across
 * covers the box with margin. It has to be the core and not the sphere: a
 * point just inside a puff's surface is behind almost no alpha at all,
 * because that is exactly where the rim fade has faded it out. See
 * `COLLAPSE_SHROUD_RIM_CORE` for what a geometry-only cover measured, and
 * `COLLAPSE_SHROUD_AXIS_MIN` for why one puff can never be enough however
 * large it is. `collapse-shroud.test.ts` walks a dense sample grid over the
 * real shipped extents above and asserts it directly, including on the two
 * extremes named in the table.
 *
 * NOTE ON `structureTypes[...].heightPx`: it is NOT the height used here, and
 * must not be. It is the BILLBOARD's drawn wall height -- the mosque declares
 * 34, which through `WORLD_Y_PER_LIFT_PIXEL` is 0.867 world units against a
 * mesh that measures 3.317. Sizing a mesh-path effect from it would under-
 * cover by 3.8x. It stays the fallback for the billboard path alone
 * (`&nomesh`), where it is the correct number by construction.
 *
 * ## Why geometry rather than the particle pool
 *
 * `vfx/particles.ts` could draw a dust cloud and already draws part of this
 * one. It cannot do the covering job, for two reasons that are both about the
 * data rather than the look. A layer's size comes from its own authored
 * `size_px`, and the only per-spawn control `ParticleSystem.spawn` accepts is
 * one scalar `magnitude` -- but the shape a shroud must match is not one
 * scalar: a compound wall is one tile wide and knee-high, an apartment is
 * three tiles wide and eight units tall, and no single multiplier reaches
 * both. And a particle is a screen-facing disc with no world extent of its
 * own to reason about, so "does the union cover the building" has no answer
 * that survives the camera. An instanced world-space hull has both.
 */
import * as THREE from 'three';
import { tileHash } from '../../tile-hash';
import {
  COLLAPSE_SHROUD_SHADES,
  collapseShroudPaletteKey,
  collapseShroudShadeForRow,
} from './collapse-shroud-role';
import { paletteColorNoConvert } from '../palette-material';
import { SMOKE_RENDER_ORDER } from './render-order';

// ---------------------------------------------------------------------------
// Pure: lattice layout and envelope maths. No three.js state is touched above
// the divider below, mirroring every other VFX-mesh module in this backend.
// ---------------------------------------------------------------------------

/**
 * Simultaneously-live shrouds. Smaller than `SMOKE_PLUME_CAPACITY` (16) on
 * purpose and for a reason that is arithmetic rather than taste: a plume
 * lives 4000 ms and has two trigger sites (a building AND every hard-target
 * vehicle death), so its concurrency window is wide. A shroud lives
 * `COLLAPSE_SHROUD_DURATION_MS` (2400 ms) and fires only for a STRUCTURE,
 * and no shipped mission stands more than a handful of buildings within
 * demolition range of each other. 6 covers a `demo_squad` walking a terrace
 * of houses down back to back with headroom.
 *
 * Unlike the other pooled VFX managers, one entry here is not one instance:
 * a shroud is a LATTICE of up to `COLLAPSE_SHROUD_PUFFS_MAX` puffs, so the
 * `InstancedMesh` is sized `COLLAPSE_SHROUD_CAPACITY *
 * COLLAPSE_SHROUD_PUFFS_MAX`. At 6 x 64 that is 384 matrices, 24 KB -- the
 * same order every other capacity constant in this backend already accepts
 * as immaterial.
 */
export const COLLAPSE_SHROUD_CAPACITY = 6;

/**
 * Smallest lattice count on any ONE axis -- so the very smallest structure in
 * the game still gets EIGHT puffs rather than one.
 *
 * Not tidiness, and measured. One puff is one blended layer, so its own
 * `COLLAPSE_SHROUD_DENSITY` is the hard ceiling on how much it can hide: a
 * `wall` panel (1.08 x 0.583 x 1.08 world units, the shortest thing in the
 * game) laid out on a 1x1x1 lattice hid **81.7%** of its own swap's
 * magnitude and could not do better at any radius, because radius does not
 * add layers when there is only one sphere. Everything the shroud does above
 * that ceiling comes from puffs OVERLAPPING -- transmittance through `k`
 * layers is `(1 - a)^k` -- and 2 per axis is the smallest number that
 * guarantees any.
 */
export const COLLAPSE_SHROUD_AXIS_MIN = 2;

/** Largest lattice count on any ONE axis. It binds only on `apartment` and
 *  `house`, whose unclamped counts would be 6 and 5; every other shipped
 *  building lands under it on `COLLAPSE_SHROUD_CELL_TILES` alone. Raising it
 *  to 5 was measured and is NOT an improvement -- it took the apartment's
 *  residual swap leak from 528 px to 725 px while nearly doubling the
 *  instance count, because what was leaking was never lattice resolution.
 *  The cost is cubic; the benefit was not there. */
export const COLLAPSE_SHROUD_AXIS_MAX = 4;

/** The pool's per-shroud instance budget -- the largest lattice
 *  `collapseShroudLayout` can return, by construction. */
export const COLLAPSE_SHROUD_PUFFS_MAX =
  COLLAPSE_SHROUD_AXIS_MAX * COLLAPSE_SHROUD_AXIS_MAX * COLLAPSE_SHROUD_AXIS_MAX;

/**
 * Target lattice cell edge, in world units (= tiles). Chosen at roughly one
 * tile because that is the granularity the rest of this renderer already
 * thinks in, and because it puts `mosque` on a 4x4x3 lattice and `shanty`
 * (2.977 x 1.017 x 2.368) on 4x2x3 -- a low shed gets a flat sheet of dust
 * and a domed mosque gets a mound of it, from the same rule with no per-type
 * table.
 */
export const COLLAPSE_SHROUD_CELL_TILES = 0.9;

/** How far past the footprint the LATTICE is laid out, as a multiplier on
 *  the building's own world width/depth. Modest, because most of the spill a
 *  viewer actually sees comes from the puff radius: a sphere cover always
 *  overshoots the box it covers by roughly its own radius, which on the
 *  mosque is another 1.39 tiles on every side. This is margin ON TOP of that,
 *  so the building's own boundary is comfortably interior rather than sitting
 *  on the cloud's edge. */
export const COLLAPSE_SHROUD_SPILL_XZ = 1.1;

/** The same, vertically -- and 1.0, i.e. none. A falling building throws its
 *  dust OUTWARD far more than upward at the instant of failure; the rising
 *  half is `units/smoke-plume.ts`'s job and it is already spawned from the
 *  same event. The roofline is still cleared with room to spare, again by the
 *  puff radius: the apartment's top lattice row sits at 6.78 with a radius of
 *  2.29 over a building 7.745 tall. Kept as a named constant rather than
 *  dropped so that "the shroud does not stretch vertically" reads as a
 *  decision. */
export const COLLAPSE_SHROUD_SPILL_Y = 1.0;

/**
 * Puff CORE radius as a multiple of the lattice cell's own HALF-DIAGONAL --
 * see `COLLAPSE_SHROUD_RIM_CORE` for why the word "core" is load-bearing.
 *
 * Every point of the shroud box lies in some cell; no point of a cell is
 * further from the cell centre than half that cell's diagonal; so at exactly
 * 1.0 the union of the puff cores already covers the box, and anything above
 * covers it with margin.
 *
 * It must ALSO absorb `COLLAPSE_SHROUD_JITTER`, which displaces each puff
 * centre off its cell centre by up to that fraction of the cell on each axis
 * -- a displacement of at most `2 * JITTER` half-diagonals. Hence the
 * invariant `COLLAPSE_SHROUD_COVER >= 1 + 2 * COLLAPSE_SHROUD_JITTER`, which
 * `collapse-shroud.test.ts` asserts directly so that raising the jitter
 * without raising this goes red rather than quietly opening holes in the
 * cloud.
 */
export const COLLAPSE_SHROUD_COVER = 1.25;

/**
 * The fraction of a puff's radius inside which its rim fade still passes at
 * least 90% of `COLLAPSE_SHROUD_DENSITY` -- its DENSE CORE, as opposed to the
 * translucent shell around it.
 *
 * This exists because the first version of this file got the covering
 * argument right and the effect wrong, and the gap between the two was
 * measured rather than argued. A GEOMETRIC cover says every point of the
 * building's box is inside some sphere. An OPTICAL cover says every point is
 * behind enough alpha to hide what is behind it -- and a point just inside a
 * puff's SURFACE is behind almost nothing, because that is exactly where
 * `COLLAPSE_SHROUD_EDGE_SOFTNESS` has faded the fragment out. Measured on
 * `apartment` (the tallest shipped building) at the swap instant, a
 * geometric-only cover left **16464 px / 0.7366** of the swap visible against
 * an unshrouded control of 89013 px / 4.937, and the diff was a thin band
 * tracing the base of the footprint diamond -- the outer boundary of the box,
 * which is precisely where every covering sphere is at its own rim.
 *
 * The number is derived from the shader, not tuned. For a sphere,
 * `|N.V| = sqrt(1 - (d/r)^2)`. `smoothstep(0, E, f)` reaches 0.9 at
 * `f = t * E` where `3t^2 - 2t^3 = 0.9`, i.e. `t = 0.8047`; so with
 * `E = COLLAPSE_SHROUD_EDGE_SOFTNESS` (0.85) that is `f = 0.684`, and
 * `d/r = sqrt(1 - 0.684^2) = 0.730`. A cell must therefore be covered by the
 * inner 73% of a puff, and the puff itself is `COLLAPSE_SHROUD_COVER / 0.73`
 * half-diagonals across.
 *
 * `collapse-shroud.test.ts` re-derives it from `COLLAPSE_SHROUD_EDGE_SOFTNESS`
 * by bisection rather than trusting the arithmetic above -- which is not a
 * formality: the first version of this comment solved the smoothstep wrong
 * (0.787 for 0.8047) and the test is what caught it.
 */
export const COLLAPSE_SHROUD_RIM_CORE = 0.73;

/** Per-puff scatter off the exact lattice centre, as a fraction of the cell
 *  edge on each axis. Without it the cloud reads as what it is -- a grid --
 *  in exactly the way `smoke-mesh.ts`'s own laid screen did before
 *  `76d3a4d`. Bounded rather than free precisely so
 *  `COLLAPSE_SHROUD_COVER` can absorb it; see that constant. */
export const COLLAPSE_SHROUD_JITTER = 0.1;

/** Radius floor in world units, applied after the cell arithmetic, so a
 *  degenerate structure cannot produce a shroud of radius zero. It does NOT
 *  bind on anything shipped: the smallest real case is a `wall` panel, whose
 *  cells come out at 0.59 x 0.29 x 0.59 and whose radius is therefore 0.75.
 *  Kept because it can only ever ADD coverage -- the guarantee above is
 *  untouched by it -- and because `spawn(x, y, z, 0, 0, 0)` should draw
 *  something rather than nothing. */
export const COLLAPSE_SHROUD_MIN_RADIUS = 0.62;

/** How long a shroud lives, ms. Deliberately well under
 *  `SMOKE_PLUME_DEFAULT_DURATION_MS` (4000): the shroud is the INSTANT of
 *  failure and must be gone while the plume it hands over to is still
 *  climbing, or the two read as one four-second smudge instead of a blast
 *  followed by a fire. */
export const COLLAPSE_SHROUD_DURATION_MS = 2400;

/** Fraction of life spent blooming from the compact spawn ball to full
 *  coverage. 0.08 is 192 ms -- about eleven frames, fast enough to read as
 *  the building throwing its dust rather than a cloud sliding into place,
 *  and slow enough not to be a single-frame pop of its own. */
export const COLLAPSE_SHROUD_BLOOM_FRACTION = 0.08;

/** Fraction of life the shroud stays at full density before it starts to
 *  thin. `COLLAPSE_SHROUD_SWAP_DELAY_MS` must land inside this window -- see
 *  `collapseShroudSwapProgress`. 0.35 is 840 ms, which leaves 1560 ms of
 *  thinning: the reveal is the long half of the effect, on purpose, because
 *  a ruin that appears when the last puff clears has popped in rather than
 *  been revealed. */
export const COLLAPSE_SHROUD_HOLD_FRACTION = 0.35;

/** Scale of the whole lattice at the instant of spawn. Under 1 so the cloud
 *  starts gathered at the building and bursts outward; it reaches 1 (full
 *  coverage) at the end of the bloom. */
export const COLLAPSE_SHROUD_BLOOM_MIN = 0.5;

/** Scale of the whole lattice at end of life. Above 1 because dust
 *  DISPERSES: the one thing it certainly does not do is draw back in, which
 *  is the mistake `smokePlumeRiseEnvelope` used to make and
 *  `.superpowers/queue/smoke-animation-report.md` photographed. */
export const COLLAPSE_SHROUD_BLOOM_MAX = 1.45;

/** How much faster than the common bloom an individual puff may grow, at end
 *  of life. Per-puff and hash-derived, so the cloud churns instead of
 *  inflating as one rigid body. Only ever ADDS to a puff's own radius (the
 *  factor is `1 + spread * hash * progress`, never below 1), so the covering
 *  guarantee is strictly improved by it and never weakened. */
export const COLLAPSE_SHROUD_GROWTH_SPREAD = 0.45;

/** How much longer than `COLLAPSE_SHROUD_HOLD_FRACTION` an individual puff
 *  may hold before it begins to fade. Per-puff and hash-derived, and
 *  strictly non-negative, so every puff is still at FULL density for the
 *  whole nominal hold -- the swap guarantee is untouched -- while the cloud
 *  breaks up unevenly afterwards and the ruin comes through the gaps rather
 *  than through a uniform dimming. */
export const COLLAPSE_SHROUD_HOLD_STAGGER = 0.18;

/**
 * How long after the sim reports a structure destroyed the renderer holds the
 * standing mesh before swapping it for the wreck, ms.
 *
 * PURELY PRESENTATION. The sim has already destroyed the building; nothing
 * here is fed back into it, nothing reads it, and no command depends on it
 * (invariant 4). What it delays is one `scene.remove` / `scene.add` pair.
 *
 * 420 ms is not a taste value: `collapseShroudSwapProgress()` is
 * 420 / 2400 = 0.175, and the shroud is at full density from
 * `COLLAPSE_SHROUD_BLOOM_FRACTION` (0.08) to `COLLAPSE_SHROUD_HOLD_FRACTION`
 * (0.35). 0.175 sits inside that plateau with room either side -- past the
 * bloom, so coverage is complete, and well short of the fade, so nothing has
 * begun to thin. `collapse-shroud.test.ts` asserts both inequalities, so
 * moving any one of the four numbers without re-checking the others goes red.
 */
export const COLLAPSE_SHROUD_SWAP_DELAY_MS = 420;

/** Where in a shroud's own life the mesh swap lands. Split out as a function
 *  rather than left as an inline division so the relationship it has to
 *  `COLLAPSE_SHROUD_BLOOM_FRACTION` and `COLLAPSE_SHROUD_HOLD_FRACTION` is
 *  one expression a test can assert on. */
export function collapseShroudSwapProgress(): number {
  return COLLAPSE_SHROUD_SWAP_DELAY_MS / COLLAPSE_SHROUD_DURATION_MS;
}

/** One puff of a shroud's lattice, in the shroud's OWN space: `dx`/`dy`/`dz`
 *  are offsets from the building's footprint centre at ground level (so `dy`
 *  is always >= 0 and runs up), `radius` is world units, `shadeIndex` keys
 *  `COLLAPSE_SHROUD_SHADES`, and `growth`/`holdBonus` are the per-puff
 *  hash-derived variations documented on their own constants. */
export interface CollapseShroudPuff {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly radius: number;
  readonly shadeIndex: number;
  readonly growth: number;
  readonly holdBonus: number;
}

/**
 * The lattice of puffs that covers a building of world extents
 * `width` x `depth` (X/Z, tiles) and `height` (Y, world units), anchored at
 * its footprint centre on the ground.
 *
 * `seed` varies only the jitter, the per-puff growth rate and the per-puff
 * hold bonus -- never the counts, the cell sizes or the radii, so two
 * buildings of the same size get clouds of the same SHAPE and the same
 * guaranteed coverage while never being the identical arrangement of puffs.
 * Presentation-only, hashed, never sim-derived: the same rule every other
 * scatter effect in this renderer follows.
 */
export function collapseShroudLayout(
  width: number,
  depth: number,
  height: number,
  seed = 0
): readonly CollapseShroudPuff[] {
  const w = Math.max(width, 0) * COLLAPSE_SHROUD_SPILL_XZ;
  const d = Math.max(depth, 0) * COLLAPSE_SHROUD_SPILL_XZ;
  const h = Math.max(height, 0) * COLLAPSE_SHROUD_SPILL_Y;

  const nx = axisCount(w);
  const ny = axisCount(h);
  const nz = axisCount(d);
  const sx = w / nx;
  const sy = h / ny;
  const sz = d / nz;

  const halfDiagonal = 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
  // `/ RIM_CORE`: the cell has to be inside the puff's DENSE CORE, not merely
  // inside the sphere -- see `COLLAPSE_SHROUD_RIM_CORE` for the 16464-pixel
  // measurement that distinction is worth.
  const radius = Math.max(
    COLLAPSE_SHROUD_MIN_RADIUS,
    (COLLAPSE_SHROUD_COVER * halfDiagonal) / COLLAPSE_SHROUD_RIM_CORE
  );

  const puffs: CollapseShroudPuff[] = [];
  let n = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        // Two independent hash streams per puff, both keyed on the puff's own
        // lattice index and the caller's seed -- the same shape every scatter
        // in this renderer uses, never a running PRNG whose sequence would
        // depend on how many puffs were emitted before it.
        const a = tileHash(seed * 131 + n, n * 17 + 3);
        const b = tileHash(n * 29 + 7, seed * 71 + n);
        const shade = collapseShroudShadeForRow(j, ny);
        puffs.push({
          dx: -w / 2 + (i + 0.5) * sx + (a - 0.5) * 2 * COLLAPSE_SHROUD_JITTER * sx,
          dy: (j + 0.5) * sy + (b - 0.5) * 2 * COLLAPSE_SHROUD_JITTER * sy,
          dz: -d / 2 + (k + 0.5) * sz + (tileHash(n, seed) - 0.5) * 2 * COLLAPSE_SHROUD_JITTER * sz,
          radius,
          shadeIndex: COLLAPSE_SHROUD_SHADES.indexOf(shade),
          growth: COLLAPSE_SHROUD_GROWTH_SPREAD * a,
          holdBonus: COLLAPSE_SHROUD_HOLD_STAGGER * b,
        });
        n++;
      }
    }
  }
  return puffs;
}

function axisCount(extent: number): number {
  const n = Math.round(extent / COLLAPSE_SHROUD_CELL_TILES);
  if (n < COLLAPSE_SHROUD_AXIS_MIN) return COLLAPSE_SHROUD_AXIS_MIN;
  return n > COLLAPSE_SHROUD_AXIS_MAX ? COLLAPSE_SHROUD_AXIS_MAX : n;
}

/**
 * The whole lattice's scale at `progress` -- `COLLAPSE_SHROUD_BLOOM_MIN` at
 * spawn, exactly 1 at the end of the bloom, `COLLAPSE_SHROUD_BLOOM_MAX` at
 * death. Monotonically increasing across the WHOLE life, which is the
 * property that makes the covering guarantee hold for every instant at or
 * after the bloom: scaling both the offsets and the radii by the same factor
 * `s >= 1` covers the box scaled by `s`, and that contains the box itself.
 *
 * The same mistake `smokePlumeFootprintScale` used to make -- deriving the
 * footprint from the opacity envelope, so the shape ran backwards while it
 * faded -- is not available here: this takes `progress` directly and
 * `collapseShroudDensity` is a separate function of it.
 */
export function collapseShroudBloom(progress: number): number {
  const p = clamp01(progress);
  if (p < COLLAPSE_SHROUD_BLOOM_FRACTION) {
    return (
      COLLAPSE_SHROUD_BLOOM_MIN +
      (1 - COLLAPSE_SHROUD_BLOOM_MIN) * (p / COLLAPSE_SHROUD_BLOOM_FRACTION)
    );
  }
  return (
    1 +
    (COLLAPSE_SHROUD_BLOOM_MAX - 1) *
      ((p - COLLAPSE_SHROUD_BLOOM_FRACTION) / (1 - COLLAPSE_SHROUD_BLOOM_FRACTION))
  );
}

/**
 * A puff's own opacity multiplier at `progress`, `[0, 1]`: linear rise across
 * the bloom, flat 1 through the hold, then a smoothstepped dissolve to
 * exactly 0.
 *
 * `holdBonus` (>= 0, per puff) extends the flat section for that puff alone
 * and compresses its own fade into what is left. It can only ever DELAY a
 * puff's fade, never advance it, which is what keeps "every puff is fully
 * dense for the whole nominal hold" true -- and that sentence is the swap
 * guarantee. The visible effect is that the cloud breaks up raggedly and the
 * ruin appears through gaps, rather than the whole shroud dimming as one
 * sheet.
 */
export function collapseShroudDensity(progress: number, holdBonus = 0): number {
  const p = clamp01(progress);
  if (p < COLLAPSE_SHROUD_BLOOM_FRACTION) return p / COLLAPSE_SHROUD_BLOOM_FRACTION;
  const holdEnd = Math.min(
    COLLAPSE_SHROUD_HOLD_FRACTION + Math.max(holdBonus, 0),
    1 - MIN_FADE_FRACTION
  );
  if (p <= holdEnd) return 1;
  const t = (1 - p) / (1 - holdEnd);
  return t * t * (3 - 2 * t);
}

/** Floor on how much of a puff's life is left for its fade once
 *  `holdBonus` has been added, so the dissolve can never be compressed into
 *  a step. `COLLAPSE_SHROUD_HOLD_FRACTION + COLLAPSE_SHROUD_HOLD_STAGGER` is
 *  0.53, far from this, so today the clamp never binds -- it exists so that
 *  raising the stagger cannot silently reintroduce a hard cut, which is the
 *  exact failure this whole module exists to remove. */
const MIN_FADE_FRACTION = 0.25;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// GPU-facing.
// ---------------------------------------------------------------------------

/**
 * How much of the `|N.V|` range a puff's rim fade spends going from fully
 * transparent to fully dense -- the same geometric idea
 * `SMOKE_PLUME_EDGE_SOFTNESS` documents (a hull's outline is where you are
 * looking through the least of it), but the NUMBER is derived here rather
 * than tuned, because unlike that lumpy AI hull this geometry is an exact
 * sphere.
 *
 * For a sphere, a fragment at screen distance `d` from the puff's centre has
 * `|N.V| = sqrt(1 - (d/r)^2)`. So a threshold `E` feathers exactly the band
 * `d/r > sqrt(1 - E^2)`. At the plume's own 0.55 that is only the outer 16%
 * of the disc -- a hard ball with a fringe. At 0.85 it is the outer 47%,
 * which is a soft puff whose union with its neighbours has no rim at all;
 * that is the same reasoning `SOFT_PARTICLE_CORE` (0.15, `units/fx.ts`)
 * records for the particle discs, reached from the opposite direction.
 */
export const COLLAPSE_SHROUD_EDGE_SOFTNESS = 0.85;

/**
 * Peak alpha of the densest fragment of one puff -- the centre of one sphere
 * at the height of the hold phase.
 *
 * HIGH ON PURPOSE, and this is the constant a future reader is most likely to
 * "fix" back. `SMOKE_PLUME_DENSITY` is 0.62 and `SMOKE_ALPHA_MAX` is 0.72
 * because both of those are AMBIENT smoke that a player has to keep fighting
 * through; a plume that hid the building it rose from was the whole of the
 * defect `76d3a4d` fixed. This is not that. This is the half-second at which
 * a building fails, over that building alone, and if it is see-through then
 * the mesh swap it exists to hide is visible and the effect has failed
 * outright -- which is the state photographed before this file existed.
 *
 * Note what the number is NOT: it is not the alpha of the shroud. Puffs
 * overlap by construction, each contributing one blended layer, so the
 * union's own transmittance at a point covered by `k` puffs is `(1 - a)^k` --
 * 0.18 at k=1, 0.032 at k=2, 0.006 at k=3. The union goes effectively opaque
 * wherever the lattice doubles up, and the rim fade keeps the cloud's outer
 * boundary soft regardless, which is why the cloud photographs with terrain
 * showing through its edge while hiding the building at its centre.
 *
 * Walked rather than picked. Measured at the swap instant on `apartment`
 * (leak / unshrouded control, `meanAbsChannelDelta`): 0.42 -> 0.7366 / 4.937;
 * 0.55 -> 0.1372 / 4.921; 0.68 -> 0.0854 / 4.920; **0.82 -> 0.0343 / 4.987**,
 * and 0 differing pixels at pixelmatch's own threshold. On `mosque` and
 * `wall` it reads 0.0000 and 0.0001.
 */
export const COLLAPSE_SHROUD_DENSITY = 0.82;

/** Subdivision level of the icosphere one puff draws. 1 gives 80 triangles,
 *  and its 42-vertex silhouette is smooth enough because
 *  `COLLAPSE_SHROUD_EDGE_SOFTNESS` has already faded the outer 47% of every
 *  puff's disc to nothing -- there is no hard outline left for a facet to
 *  show up in. The cost is 80 x (up to 384) instanced triangles in ONE draw
 *  call. */
export const COLLAPSE_SHROUD_PUFF_DETAIL = 1;

/**
 * One puff's geometry: a unit icosphere.
 *
 * `THREE.IcosahedronGeometry` derives its normals from the normalised vertex
 * position, so they are exactly radial and exactly smooth -- which the rim
 * fade needs, since a faceted normal would make `|N.V|` jump at every face
 * boundary and photograph as a stained-glass ball rather than a puff.
 *
 * Procedural rather than a shipped GLB deliberately. Every other VFX mesh in
 * this backend loads an authored asset because its SHAPE is the effect (a
 * muzzle flash's star, a fireball's bloom, a plume's column). A puff's shape
 * is a sphere; there is nothing for an artist to author, the arrangement is
 * where all the character is, and an asset would add 34 GLB fetches' worth of
 * boot cost plus a Blender export path for a primitive three.js already
 * ships.
 */
export function collapseShroudPuffGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, COLLAPSE_SHROUD_PUFF_DETAIL);
}

/**
 * The material every puff draws through.
 *
 * Two channels multiply into alpha and each answers a different question:
 *
 *   - `vFacing` (rim fade): how much of this puff is this pixel looking
 *     through? See `COLLAPSE_SHROUD_EDGE_SOFTNESS`.
 *   - `aOpacity` (life fade): how far through its own life is this puff, and
 *     how long was its hold? See `collapseShroudDensity`. Per INSTANCE, which
 *     is what lets one pooled `InstancedMesh` hold several shrouds of
 *     different ages AND stagger the puffs inside each one.
 *
 * Colour is per instance too, but from a THREE-ENTRY table of uniforms
 * selected by `aShade`, not an interpolated attribute: every fragment lands
 * exactly on one `data/palette.json` `ramps.dust` entry
 * (`collapse-shroud-role.ts`), never between two. The palette rule governs
 * where a colour comes from, not whether it may be composited -- the same
 * latitude `createSmokePlumeMaterial` and every `alpha_over_life` particle
 * already take.
 *
 * The instance normal transform is the plain `mat3(instanceMatrix) * normal`
 * rather than `createSmokePlumeMaterial`'s exact inverse-scale correction,
 * and that is safe here for a reason rather than by luck: `step()` below
 * composes a UNIFORM scale (a puff is a sphere and grows as one), and under a
 * uniform scale the normal transform and the vertex transform agree exactly.
 * The plume needed the correction because its height and footprint run on
 * different curves.
 */
export function createCollapseShroudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDeep: { value: new THREE.Color(0, 0, 0) },
      uBody: { value: new THREE.Color(0, 0, 0) },
      uCrown: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: /* glsl */ `
      attribute float aOpacity;
      attribute float aShade;
      uniform vec3 uDeep;
      uniform vec3 uBody;
      uniform vec3 uCrown;
      varying float vFacing;
      varying float vOpacity;
      varying vec3 vColor;
      void main() {
        vec3 worldNormal = mat3(instanceMatrix) * normal;
        vec3 viewNormal = normalize(mat3(modelViewMatrix) * worldNormal);
        // Orthographic camera (camera.ts's dimetricCamera): the view direction
        // is a constant view-space +Z, so |N.V| is exactly abs(viewNormal.z).
        vFacing = abs(viewNormal.z);
        vOpacity = aOpacity;
        vColor = aShade < 0.5 ? uDeep : (aShade < 1.5 ? uBody : uCrown);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vFacing;
      varying float vOpacity;
      varying vec3 vColor;
      void main() {
        float rim = smoothstep(0.0, ${COLLAPSE_SHROUD_EDGE_SOFTNESS.toFixed(2)}, vFacing);
        float a = ${COLLAPSE_SHROUD_DENSITY.toFixed(2)} * vOpacity * rim;
        if (a <= 0.0) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    // Matches `smoke-mesh.ts`'s own laid screen exactly, and for the same
    // reason: smoke that the depth buffer can hide behind the very building
    // it is covering is not smoke. `SMOKE_RENDER_ORDER` (band 5) is where
    // `units/render-order.ts` already puts every smoke layer.
    depthTest: false,
    depthWrite: false,
    // BackSide, not FrontSide. A sphere is a CLOSED hull, unlike the plume's
    // open shells, so drawing its front faces alone would make the shroud's
    // near surface the only thing composited -- and the near surface of a
    // sphere lit by nothing is exactly where the rim fade is thinnest at the
    // centre. Drawing the BACK faces instead composites the far surface, so a
    // puff reads as something the eye is looking INTO rather than at, and two
    // overlapping puffs stack their far walls rather than their near ones.
    // Either is one layer per puff; this one is the one that reads as volume.
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
  });
}

/** One live shroud. `x`/`y`/`z` are real three.js WORLD coordinates of the
 *  building's footprint centre at ground level. `puffs` is its own lattice,
 *  computed once at spawn from that building's own extents -- never shared,
 *  never recomputed per frame. */
interface ActiveCollapseShroud {
  x: number;
  y: number;
  z: number;
  puffs: readonly CollapseShroudPuff[];
  ageMs: number;
  durationMs: number;
}

/**
 * Owns the single pooled `InstancedMesh` every puff of every live shroud
 * draws through.
 *
 * Mirrors `SmokePlumeManager` in SHAPE (bounded pool, oldest-evicted, one
 * `step()` a frame, `setColors` resolving palette keys into uniforms) with
 * two differences that are real rather than cosmetic:
 *
 *   - **One mesh, not three.** The plume's three `InstancedMesh`es exist
 *     because its GLB is split into three zones that need three colours and
 *     three shear offsets. A puff is one sphere; its shade is a per-instance
 *     attribute into a three-entry uniform table instead, so the whole pool
 *     is one draw call however many shrouds are live.
 *   - **One entry is many instances.** Every other pooled manager here is
 *     one-active-thing-to-one-instance. A shroud is a lattice, so `step()`
 *     walks two levels and the instance count is the running total.
 *
 * There is no `load()` and no `ready`: the geometry is procedural
 * (`collapseShroudPuffGeometry`), so this manager is usable from the frame it
 * is constructed and there is no window in which a collapse falls through to
 * a fallback. That is deliberate -- the whole point of this effect is to hide
 * a swap that happens on the first frame after death, and an effect that
 * arrives late would have nothing to hide.
 */
export class CollapseShroudManager {
  private readonly capacity: number;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  readonly mesh: THREE.InstancedMesh;
  private readonly opacityAttr: THREE.InstancedBufferAttribute;
  private readonly shadeAttr: THREE.InstancedBufferAttribute;
  private readonly active: ActiveCollapseShroud[] = [];
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();

  constructor(capacity = COLLAPSE_SHROUD_CAPACITY) {
    this.capacity = capacity;
    const slots = capacity * COLLAPSE_SHROUD_PUFFS_MAX;
    this.material = createCollapseShroudMaterial();
    this.geometry = collapseShroudPuffGeometry();
    this.opacityAttr = new THREE.InstancedBufferAttribute(new Float32Array(slots), 1);
    this.shadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(slots), 1);
    this.geometry.setAttribute('aOpacity', this.opacityAttr);
    this.geometry.setAttribute('aShade', this.shadeAttr);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, slots);
    this.mesh.count = 0;
    this.mesh.renderOrder = SMOKE_RENDER_ORDER;
    this.mesh.frustumCulled = false;
  }

  /** Resolves this manager's three fixed palette keys through `resolve` and
   *  copies the result into the shade uniforms, in place -- mirrors
   *  `SmokePlumeManager.setColors` exactly. */
  setColors(resolve: (key: string) => string): void {
    const uniforms = ['uDeep', 'uBody', 'uCrown'] as const;
    for (let i = 0; i < COLLAPSE_SHROUD_SHADES.length; i++) {
      const color = paletteColorNoConvert(resolve(collapseShroudPaletteKey(COLLAPSE_SHROUD_SHADES[i])));
      (this.material.uniforms[uniforms[i]].value as THREE.Color).copy(color);
    }
  }

  /**
   * Shrouds one building at world `(x, y, z)` -- its footprint centre at
   * ground level -- sized from that building's own world extents. `seed`
   * varies the scatter only (see `collapseShroudLayout`). A no-op below zero
   * duration or with no extent at all, matching every other manager's guard;
   * over capacity, drops the OLDEST shroud first, the same eviction rule
   * every pooled manager in this backend uses.
   */
  spawn(
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    seed = 0,
    durationMs = COLLAPSE_SHROUD_DURATION_MS
  ): void {
    if (durationMs <= 0) return;
    if (width <= 0 && depth <= 0 && height <= 0) return;
    if (this.active.length >= this.capacity) this.active.shift();
    this.active.push({
      x,
      y,
      z,
      puffs: collapseShroudLayout(width, depth, height, seed),
      ageMs: 0,
      durationMs,
    });
  }

  /**
   * Ages every live shroud by `dtMs`, retires any past its own `durationMs`,
   * and rewrites the pooled `InstancedMesh` from what remains.
   *
   * The scale composed per puff is `radius * bloom * (1 + growth * progress)`
   * on all three axes -- UNIFORM, which is what lets the material skip the
   * plume's inverse-scale normal correction. `bloom` also scales the puff's
   * own lattice offset, so the whole configuration expands about the
   * building's own footprint centre at ground level and the covering
   * guarantee rides along with it.
   */
  step(dtMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.ageMs += dtMs;
      if (s.ageMs >= s.durationMs) this.active.splice(i, 1);
    }
    const opacity = this.opacityAttr.array as Float32Array;
    const shade = this.shadeAttr.array as Float32Array;
    let n = 0;
    for (const s of this.active) {
      const progress = s.ageMs / s.durationMs;
      const bloom = collapseShroudBloom(progress);
      for (const puff of s.puffs) {
        if (n >= opacity.length) break;
        const scale = puff.radius * bloom * (1 + puff.growth * progress);
        this.scratchPos.set(s.x + puff.dx * bloom, s.y + puff.dy * bloom, s.z + puff.dz * bloom);
        this.scratchScale.set(scale, scale, scale);
        this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
        this.mesh.setMatrixAt(n, this.scratchMatrix);
        opacity[n] = collapseShroudDensity(progress, puff.holdBonus);
        shade[n] = puff.shadeIndex;
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacityAttr.needsUpdate = true;
    this.shadeAttr.needsUpdate = true;
  }

  /** Releases the shared geometry and material -- mirrors every other
   *  manager's own `dispose`. */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Test/debug hook: how many shrouds are currently alive. */
  get liveCount(): number {
    return this.active.length;
  }

  /** Test/debug hook: how many puff instances the last `step()` wrote. */
  get instanceCount(): number {
    return this.mesh.count;
  }
}
