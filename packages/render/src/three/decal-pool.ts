/**
 * Task 10 of `docs/superpowers/plans/2026-09-25-ground-plan-1.md`: the core
 * of the shared decal pool (spec §3.3, `docs/superpowers/specs/
 * 2026-09-25-ground-design.md`) -- a ring buffer, a grid of vertices that
 * conforms to the terrain surface underneath it, and a clock that reads sim
 * time rather than frame time. Task 11 added the kind shader: `decalAlpha`
 * (the pure mirror, one formula per kind, spec §5) and `createDecalMaterial`
 * (its GLSL transcription, with every constant interpolated from the same
 * TypeScript names, so the two cannot drift by a retyped literal). See
 * "The kind shader" below. `DecalPool` still takes its material from the
 * caller (see its own doc comment) -- one material, two pools.
 *
 * Shape follows `scorch-decals.ts`: a pure half with no `THREE.*` below,
 * exercised directly with plain numbers, then a GPU half.
 *
 * ## One pool class, two instances (R-10)
 *
 * `docs/superpowers/plans/2026-09-25-ground-plan-1.md` names the conflict
 * this module resolves: the design gives both "a 4x4-vertex grid (18 tris)"
 * and a "under 27k triangles" total budget, and 5,120 decals (1024
 * persistent + 4096 fading) at 18 tris each is 92,160 -- over three times
 * the budget. **R-10 (the controller's ruling): persistent decals keep the
 * 4x4 grid (`PERSISTENT_GRID`), fading decals (tread/tyre -- the ones that
 * age out and vastly outnumber the persistent ones) drop to a 2x2 grid
 * (`FADING_GRID`, 2 tris)**. `PERSISTENT_CAPACITY * 18 + FADING_CAPACITY * 2
 * = 1024*18 + 4096*2 = 18432 + 8192 = 26624`, under the 27k ceiling --
 * pinned in `decal-pool.test.ts` against the literal arithmetic, not a
 * `toBeLessThan`, so a future edit to either constant is caught by name.
 * `DecalPool` takes `grid` as a constructor option rather than hard-coding
 * either number, so the same class serves both pools.
 *
 * ## The sim-time clock (R-14)
 *
 * Every OTHER piece of frame-driven state in this backend (unit
 * interpolation, `project.ts`) reads `(tickCount, alpha)` and blends
 * between the previous and current tick's snapshot for smooth motion at 60
 * fps over a 20 Hz sim. A decal's fade must NOT do that: invariant 1 says
 * the sim ticks at a fixed rate, and the golden-baseline visual gate
 * (CLAUDE.md, "The visual gate is three-vs-three against a committed
 * baseline") repaints the identical frame twice with zero elapsed
 * presentation time to test a debug-layer toggle -- `frame(1, 0)`, no
 * ticks between the two captures. A decal aged by WALL-CLOCK or
 * requestAnimationFrame time would read two different ages on that second,
 * un-ticked repaint, which is exactly the kind of nondeterminism invariant
 * 3's "so the visual gate's captures stay repeatable" rules out. So the
 * clock this module hands the shader is derived from `tickCount` and
 * `alpha` alone, in milliseconds, and NOTHING else reads `Date.now()` or an
 * animation-frame timestamp:
 *
 * - `presentationSimMs(tickCount, alpha)` is the clock a FRAME reads:
 *   `(tickCount - 1 + alpha) * MS_PER_TICK`, clamped at 0 so a capture
 *   taken before the first tick (`tickCount = 0, alpha = 0`) never reads
 *   negative. `tickCount - 1` because `alpha` interpolates FROM the
 *   previous tick's snapshot TO the current one, the same convention
 *   `project.ts`'s own interpolation uses.
 * - `stampSimMs(tickCount)` is the clock a SNAPSHOT is dated at when it is
 *   taken (`Sim`'s own `snapshot()` call, outside this package): the tick
 *   it will be PRESENTED at, at `alpha = 1` -- i.e. `stampSimMs(tickCount)
 *   === presentationSimMs(tickCount, 1)`, which is `tickCount *
 *   MS_PER_TICK` exactly (the `- 1 + 1` cancels).
 *
 * A decal's age in seconds, at any frame, is therefore
 * `(presentationSimMs(tickCount, alpha) - stamp.simMs) / 1000` -- Task 11's
 * `decalAlpha` and `createDecalMaterial` are the only consumers, and they
 * take that division as an input rather than doing it, so this module
 * commits to nothing about how a caller stores or subtracts the two.
 *
 * `MS_PER_TICK` is `1000 / 20`, invariant 1's own 20 Hz tick, written as
 * the constant 50 rather than derived, matching `scorch-decals.ts`'s and
 * every other frame-adjacent constant's convention of naming a literal
 * rather than importing a sim constant this package must not depend on
 * (`@lions/render` importing from `@lions/sim` would invert the
 * `sim -> render` dependency direction CLAUDE.md's package layout forbids).
 *
 * **F-20.** The plan's own draft test for this clock,
 * `presentationSimMs(200, 1) === presentationSimMs(200, 1)`, is a
 * tautology -- calling a pure function twice with the same arguments and
 * comparing the results proves nothing about the function, only that it is
 * a function. `decal-pool.test.ts` replaces it with a value pinned against
 * an independent hand computation (`(200 - 1 + 1) * 50 = 10000`); the real
 * guard that presentation never advances without a tick is Task 12's own
 * "ages on sim clock only" test, which drives the pool through a captured
 * frame with no intervening `step()` and asserts nothing changed.
 *
 * ## The conforming grid
 *
 * A decal is not a flat quad laid over the terrain -- Tel Marum's boulder
 * corridor and every hillside map since have relief a flat quad would
 * either clip into or float above. `writeDecalGrid` samples the SAME ground
 * height function the terrain mesh itself is built from (the caller's own
 * `sampleY`, e.g. `smoothLevel` scaled to world units) at every one of the
 * grid's own vertices, so a crater or a tread mark drapes over a slope
 * exactly as the ground under it does, lifted by `MARK_EPSILON` -- the same
 * lift every other mark in this backend uses to avoid z-fighting the
 * terrain quad directly beneath it (`terrain/shared.ts`).
 *
 * **R-19: a terrace is not draped down.** `applyTerrain`'s `^`/building
 * terraces are vertical walls, not a slope a grid can follow -- sampling a
 * terrace's own height function at a vertex that has wandered past its
 * edge would climb the wall face rather than lying flat. So `writeDecalGrid`
 * takes a second predicate, `isTerrace(x, z)`, and where it is true for a
 * vertex, that vertex takes the height at the decal's own CENTRE
 * (`sampleY(cx, cz)`) instead of at its own position -- the plan's own
 * wording, "a decal whose centre tile is a terrace is not stamped [Task
 * 12's job]; a grid vertex that lands on a terrace takes the centre's
 * height, so no decal drapes down a wall". A decal is never centred ON a
 * terrace tile in practice (Task 12 filters that at the stamp call site),
 * so this only ever fires for a vertex that overhangs a terrace edge from a
 * centre on open ground -- and it is pinned here regardless, since nothing
 * in THIS module enforces that precondition.
 *
 * Indexing follows `ground.ts`'s own `pushSmoothTile` exactly: the fan
 * `(a, c, b, a, d, c)` per quad, corners walked `(i,j) -> (i+1,j) ->
 * (i+1,j+1) -> (i,j+1)`, which is what makes `writeGridIndices`'s winding
 * agree with the terrain mesh it sits on (both wind "up", `+Y`, at a flat
 * placement -- `decal-pool.test.ts` cross-checks this directly rather than
 * trusting the mirrored formula).
 *
 * ## The kind shader (Task 11)
 *
 * Every kind is procedural: a function of the fragment's own `(s, t)`
 * offset in `[-1, 1]^2` (`aOffset`), the stamp's `seed`, its age in SIM
 * seconds, and its `halfLength` -- no texture. `decalAlpha` is written
 * first and tested; `DECAL_FRAGMENT_SHADER` is the same arithmetic line for
 * line, and every number in it is interpolated from a named constant in
 * this file (`glslFloat`), never retyped. `decal-pool.test.ts` checks the
 * load-bearing constants appear in the compiled string.
 *
 * - **Age is sim time.** `uNowSec` is `presentationSimMs(tickCount, alpha)
 *   / 1000`, set by the renderer (Task 12); `aDecal.z` is the stamp's own
 *   `simMs / 1000`. A frame-clock age would make the gate's zero-elapsed
 *   repaint read two different fades (see "The sim-time clock" above).
 * - **Colour is eight palette uniforms**, `uColors[8]` in `DecalPalette`'s
 *   key order (bowl 0, lip 1, scorch 2, oil 3, rubble 4/5, tread 6, tyre 7),
 *   converted with `hexToLinear` -- the renderer's output colour space is
 *   pass-through linear (`palette-material.ts`), so an sRGB-unit colour
 *   here would draw darker than the palette entry it names. No colour is
 *   written in the GLSL.
 * - **An albedo ratio, multiplied onto the lit ground (F-22).** Blended
 *   unlit with an ordinary "over", a pale kind glowed inside a cast shadow
 *   -- Task 12 photographed a crater lip at 1.6x the shaded ground around
 *   it. The single output line now writes `decalMultiplier`: the kind's
 *   tone over the ground tone UNDER THAT DECAL (captured at the stamp, per
 *   decal -- fix round 2), mixed toward 1 by alpha, and the
 *   material multiplies it onto the ground AFTER lighting and shadow. The
 *   scene target is HalfFloat, so a ratio above 1 (a pale lip) survives.
 * - **Polygon offset (F-23).** At full-power scorch (radius 1.6) a 4x4
 *   cell spans about 1.07 tiles, and the linear chord between two grid
 *   vertices can sit below the bicubic crest by more than `MARK_EPSILON`.
 *   `polygonOffset` (factor -1, units -4) pulls the decal toward the
 *   camera in depth only -- the standard decal remedy, free.
 * - **`rlHash` is `tileHash` in `uint`.** JS's `| 0`, `>>>` and
 *   `Math.imul` are all mod-2^32 bit operations, which is exactly GLSL ES
 *   3.00 `uint` arithmetic; rubble's cell coordinates are offset by 64 (and
 *   the seed term is non-negative) so the `int -> uint` cast never sees a
 *   negative. The one inexactness is the final conversion: the GLSL keeps
 *   the TOP 24 bits (`h >> 8u`, exact in a float, and unlike a rounded
 *   `float(h)` never reaching 1.0), so it reads at most 2^-24 below
 *   `tileHash` -- a chip threshold at 0.55 can only disagree for a hash
 *   within that of it.
 */
import * as THREE from 'three';
import { STAMP_SPACING_TILES } from './vehicle-tracks';
import { hexToLinear, MARK_EPSILON } from './terrain/shared';
import { tileHash } from '../tile-hash';

// ---------------------------------------------------------------------------
// Pure: kinds, the clock, grid geometry, and the approved size curves. No
// THREE.* above this line -- exercised directly with plain numbers.
// ---------------------------------------------------------------------------

/** Every mark this pool draws. Order fixes `DECAL_KIND_INDEX` -- see that
 *  constant's own doc comment for why the order itself is load-bearing. */
export type DecalKind = 'crater' | 'scorch' | 'oil' | 'rubble' | 'tread' | 'tyre';

/**
 * `DecalKind` as a small integer, written into the `aDecal` vertex
 * attribute's `x` component so Task 11's shader can branch on it with no
 * string comparison on the GPU. The ORDER here is the type union's own
 * declaration order (0..5) -- not alphabetical, not grouped by
 * persistent/fading -- because that is the one ordering a reader can check
 * against the type definition without cross-referencing this object, and
 * because Task 11's shader-side colour indices (bowl 0, lip 1, scorch 2,
 * oil 3, rubble 4/5, tread 6, tyre 7) are quoted against this same
 * declaration order in the design spec.
 */
export const DECAL_KIND_INDEX: Readonly<Record<DecalKind, number>> = {
  crater: 0,
  scorch: 1,
  oil: 2,
  rubble: 3,
  tread: 4,
  tyre: 5,
};

/** `tread`/`tyre` are the only kinds that age out (R-15's 180 s fade);
 *  crater/scorch/oil/rubble are permanent for the mission, matching
 *  `scorch-decals.ts`'s own "No TTL" for the mark it already ships. */
export function isFadingKind(k: DecalKind): boolean {
  return k === 'tread' || k === 'tyre';
}

/** See this file's top comment, "One pool class, two instances (R-10)". */
export const PERSISTENT_CAPACITY = 1024;
export const FADING_CAPACITY = 4096;
export const PERSISTENT_GRID = 4;
export const FADING_GRID = 2;

/** Invariant 1's fixed 20 Hz tick, `1000 / 20` -- written as a literal
 *  rather than imported so `@lions/render` never depends on `@lions/sim`
 *  (see this file's top comment, "The sim-time clock (R-14)"). */
export const MS_PER_TICK = 50;

/**
 * The clock a FRAME reads, in sim milliseconds -- see this file's top
 * comment, "The sim-time clock (R-14)", for the full derivation and why it
 * must never read `Date.now()` or a `requestAnimationFrame` timestamp.
 * Clamped at 0: a capture before the first tick must not read negative.
 */
export function presentationSimMs(tickCount: number, alpha: number): number {
  return Math.max(0, (tickCount - 1 + alpha) * MS_PER_TICK);
}

/**
 * The clock a SNAPSHOT is dated at when `Sim` takes it -- the tick it will
 * be presented at, at `alpha = 1`. See this file's top comment for why this
 * is definitionally `presentationSimMs(tickCount, 1)` rather than an
 * independent formula that could drift from it.
 */
export function stampSimMs(tickCount: number): number {
  return presentationSimMs(tickCount, 1);
}

/**
 * Triangle count for an `n`-per-side vertex grid: `(n-1)^2` quads, two
 * triangles each. See this file's top comment, "One pool class, two
 * instances (R-10)", for why the two grids this project ships
 * (`PERSISTENT_GRID` 4, `FADING_GRID` 2) both have to be checked against
 * the 27k budget through this same function rather than a hard-coded 18/2.
 */
export function gridTriangles(n: number): number {
  return 2 * (n - 1) * (n - 1);
}

/**
 * Writes ring `slot`'s share of the STATIC index buffer for an `n`-per-side
 * grid: `gridTriangles(n) * 3` indices, written from `out[0]` -- the caller
 * hands in that slot's own `subarray` -- with VALUES offset so slot `k`'s vertices
 * (written by `writeDecalGrid`/`writeDecalOffsets` at the same `slot`) are
 * the only ones this call's indices ever reference. Every slot in a pool
 * shares this same INDEX shape (a decal's grid topology never changes,
 * only its vertex positions do), so `DecalPool` calls this once per slot at
 * construction and never again.
 *
 * Fan and winding match `ground.ts`'s own `pushSmoothTile` exactly: corners
 * walked `(i,j) -> (i+1,j) -> (i+1,j+1) -> (i,j+1)`, fanned `(a, c, b, a, d,
 * c)` -- see this file's top comment for why that agreement matters.
 */
export function writeGridIndices(out: Uint32Array, slot: number, n: number): void {
  const base = slot * n * n;
  const idx = (i: number, j: number): number => base + j * n + i;
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i + 1, j + 1);
      const d = idx(i, j + 1);
      out[p++] = a;
      out[p++] = c;
      out[p++] = b;
      out[p++] = a;
      out[p++] = d;
      out[p++] = c;
    }
  }
}

/** Where and how big a decal's grid sits in world X/Z, before any ground
 *  sampling. `halfLength` runs along `facingRad`, `halfWidth` across it --
 *  the same convention `vehicle-tracks.ts`'s `trackMarkCorners` uses for a
 *  tread print, generalised to every kind (a round mark like a crater or a
 *  scorch simply passes `halfLength === halfWidth`). */
export interface GridPlacement {
  readonly cx: number;
  readonly cz: number;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly facingRad: number;
}

/**
 * F-23 (fix round 1): how finely `writeDecalGrid` samples each cell when it
 * measures the chord's sag under the surface -- `DECAL_SAG_STEPS + 1` points
 * per cell edge, corners and edges included, so the shared edge between two
 * cells is measured by both. 4 puts a sample at every quarter of a cell.
 */
export const DECAL_SAG_STEPS = 4;

/** The most any vertex is lifted, world units (fix round 2) -- see
 *  `writeDecalGrid`'s doc comment, "The cap". */
export const DECAL_LIFT_CAP = 0.08;

/** Reused across calls (single-threaded; no re-entrancy), so the height
 *  and sag buffers are not reallocated per stamp. Grown on demand to `n * n`.
 *  (A stamp still allocates the few closures `writeDecalGrid` builds.) */
let sagScratch = new Float64Array(16);
let cellSagScratch = new Float64Array(9);

/**
 * Writes one decal's `n * n` vertex POSITIONS into `out` at ring `slot`
 * (`out[slot*n*n*3 .. ]`), conforming to the ground -- see this file's top
 * comment, "The conforming grid", for the full account including R-19's
 * terrace rule.
 *
 * Vertex `(i, j)` sits at `s = -1 + 2i/(n-1)`, `t = -1 + 2j/(n-1)` (both in
 * `[-1, 1]`) in the decal's own local frame, rotated by `facingRad` into
 * world X/Z:
 *
 * `x = cx + s*halfLength*cos(f) - t*halfWidth*sin(f)`
 * `z = cz + s*halfLength*sin(f) + t*halfWidth*cos(f)`
 * `h(x, z) = isTerrace(x, z) ? sampleY(cx, cz) : sampleY(x, z)`
 * `y = h(x, z) + min(lift(i, j), DECAL_LIFT_CAP) + MARK_EPSILON`
 *
 * **The lift (F-23, fix round 1).** Between vertices the grid is a pair of
 * flat triangles, and over a bicubic crest that chord passes UNDER the
 * ground -- measured 0.21-0.35 world units on tel_marum's shoulders for a
 * full-power scorch on this 4x4 grid, 20-35x `MARK_EPSILON`, which no
 * polygon offset covers. So each cell's sag is measured: the largest
 * `h - chord` over a `DECAL_SAG_STEPS` lattice of the cell, through the SAME
 * two triangles the index buffer draws (`writeGridIndices`' diagonal a-c).
 * Every vertex is then lifted by the largest sag of the cells that touch it,
 * never by less than 0. A cell whose four corners all rise by at least its
 * own sag has a chord at least that much higher everywhere, so the lattice
 * points of every cell end on or above the ground. On a plane the chord IS
 * the ground and the lift is 0 (to rounding), so a flat map and a straight
 * slope are unchanged; over a hollow the chord is already above the ground
 * and nothing moves either. Only a crest lifts, and there a decal may float
 * a little over the hollows beside it -- the trade the controller ruled
 * for, against a vertex-shader depth bias that would draw over unit feet.
 *
 * **The cap (fix round 2).** A lifted decal floats over whatever stands in
 * it, and since it multiplies, a unit's legs under the float darken.
 * Photographed on tel_marum's shoulder (a killed Lavi's full-power scorch, a
 * rifle squad and a Lavi standing in it, sun shadows off so the unit mask is
 * body only): against the same scene with no lift, the uncapped lift darkened
 * the squad's body pixels by p90 16 / max 50 grey levels; capped at 0.08, p90
 * 8. 0.08 is the smallest round cap that leaves NOTHING below the ground for
 * a crater (r <= 0.6) or a mortar scorch (r 0.876) at any of the three
 * steepest shoulder sites measured (the worst needs 0.072). What stays
 * clipped at the cap is the large scorch on the steepest ground only: Grad
 * (r 1.07) <= 0.026 wu, a wheeled kill (r 1.17) <= 0.043, a full-power kill
 * (r 1.6) <= 0.167 -- the last mostly under its own wreck.
 */
export function writeDecalGrid(
  out: Float32Array,
  slot: number,
  n: number,
  p: GridPlacement,
  sampleY: (x: number, z: number) => number,
  isTerrace: (x: number, z: number) => boolean
): void {
  const base = slot * n * n * 3;
  const cosF = Math.cos(p.facingRad);
  const sinF = Math.sin(p.facingRad);
  const centreY = sampleY(p.cx, p.cz);
  // Grid-local (gi, gj) in [0, n-1], fractional inside a cell.
  const worldX = (gi: number, gj: number): number => {
    const s = -1 + (2 * gi) / (n - 1);
    const t = -1 + (2 * gj) / (n - 1);
    return p.cx + s * p.halfLength * cosF - t * p.halfWidth * sinF;
  };
  const worldZ = (gi: number, gj: number): number => {
    const s = -1 + (2 * gi) / (n - 1);
    const t = -1 + (2 * gj) / (n - 1);
    return p.cz + s * p.halfLength * sinF + t * p.halfWidth * cosF;
  };
  const h = (x: number, z: number): number => (isTerrace(x, z) ? centreY : sampleY(x, z));

  if (sagScratch.length < n * n) sagScratch = new Float64Array(n * n);
  const cells = (n - 1) * (n - 1);
  if (cellSagScratch.length < cells) cellSagScratch = new Float64Array(cells);
  const baseY = sagScratch;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) baseY[j * n + i] = h(worldX(i, j), worldZ(i, j));
  }

  // Each cell's sag, through the index buffer's own two triangles.
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const ya = baseY[j * n + i];
      const yb = baseY[j * n + i + 1];
      const yc = baseY[(j + 1) * n + i + 1];
      const yd = baseY[(j + 1) * n + i];
      let sag = 0;
      for (let sv = 0; sv <= DECAL_SAG_STEPS; sv++) {
        const v = sv / DECAL_SAG_STEPS;
        for (let su = 0; su <= DECAL_SAG_STEPS; su++) {
          const u = su / DECAL_SAG_STEPS;
          const chord = u >= v ? ya + u * (yb - ya) + v * (yc - yb) : ya + v * (yd - ya) + u * (yc - yd);
          const d = h(worldX(i + u, j + v), worldZ(i + u, j + v)) - chord;
          if (d > sag) sag = d;
        }
      }
      cellSagScratch[j * (n - 1) + i] = sag;
    }
  }

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let lift = 0;
      for (let cj = Math.max(0, j - 1); cj <= Math.min(n - 2, j); cj++) {
        for (let ci = Math.max(0, i - 1); ci <= Math.min(n - 2, i); ci++) {
          lift = Math.max(lift, cellSagScratch[cj * (n - 1) + ci]);
        }
      }
      const vBase = base + (j * n + i) * 3;
      out[vBase] = worldX(i, j);
      out[vBase + 1] = baseY[j * n + i] + Math.min(lift, DECAL_LIFT_CAP) + MARK_EPSILON;
      out[vBase + 2] = worldZ(i, j);
    }
  }
}

/**
 * Writes one decal's `n * n` vertex OFFSETS into `out` at ring `slot`
 * (`out[slot*n*n*2 .. ]`): the same `(s, t)` this decal's own
 * `writeDecalGrid` call used, in `[-1, 1]^2`, so Task 11's shader can
 * derive a radial or per-axis falloff without re-deriving the placement.
 * STATIC per slot -- `(s, t)` depends only on `(i, j, n)`, never on where or
 * how the decal is placed, so `DecalPool` writes this once per slot at
 * construction, exactly like `scorch-decals.ts`'s own `aOffset`.
 */
export function writeDecalOffsets(out: Float32Array, slot: number, n: number): void {
  const base = slot * n * n * 2;
  for (let j = 0; j < n; j++) {
    const t = -1 + (2 * j) / (n - 1);
    for (let i = 0; i < n; i++) {
      const s = -1 + (2 * i) / (n - 1);
      const vBase = base + (j * n + i) * 2;
      out[vBase] = s;
      out[vBase + 1] = t;
    }
  }
}

/** `craterRadiusTiles(power)`'s base at `power -> 0`, tiles -- see that
 *  function's own doc comment (R-13). */
const CRATER_RADIUS_BASE_TILES = 0.15;

/**
 * Crater radius in tiles for a stamp at the given `power` -- R-13's
 * ruling: `0.15 + power`, the affine fit through both approved values
 * (`docs/superpowers/plans/2026-09-25-ground-plan-1.md`'s spec §5: mortar
 * radius 0.45 at `impactPower` 0.3, Grad radius 0.6 at `impactPower` 0.45 --
 * the same `impactPower` `shellHasLanded` already threads through
 * `spawnCollapseFx`'s `mesh_burst`, CLAUDE.md's "An arcing round is
 * vfx.fire/vfx.ember"). Zero at zero or negative power, so a powerless
 * stamp leaves no mark rather than the 0.15-tile floor a naive affine
 * formula would otherwise give it -- the same "zero at zero" guard
 * `scorchRadiusTiles` uses for the identical reason.
 */
export function craterRadiusTiles(power: number): number {
  return power <= 0 ? 0 : CRATER_RADIUS_BASE_TILES + power;
}

/** Oil pool radius, tiles -- a fixed size (unlike a crater, an oil pool
 *  does not scale with anything the caller supplies), spec §5. */
export const OIL_RADIUS_TILES = 0.5;

/** A rubble spill's radius is `1.2x` its own footprint's half-diagonal,
 *  spec §5 -- see `rubbleRadiusTiles`'s own doc comment. */
const RUBBLE_SPILL_FACTOR = 1.2;

/**
 * Radius in tiles for a rubble spill around a destroyed structure's
 * footprint, given as inclusive tile bounds `[minX, maxX] x [minY, maxY]`
 * (so a single-tile building is `minX === maxX`, `minY === maxY`, a
 * footprint of `1 x 1`, never `0 x 0`). `1.2x` the footprint's own
 * half-diagonal -- a spill that stopped exactly at the building's edge
 * would look like the rubble teleported there rather than having fallen
 * outward from it.
 */
export function rubbleRadiusTiles(minX: number, minY: number, maxX: number, maxY: number): number {
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  return RUBBLE_SPILL_FACTOR * 0.5 * Math.hypot(width, height);
}

/** How far a tread/tyre stamp's feathered edge extends past its own half
 *  length, tiles -- R-15. */
export const TRACK_FEATHER_TILES = 0.08;

/**
 * A tread/tyre stamp's own half-length, tiles -- R-15: half of one stamp
 * SPACING (`STAMP_SPACING_TILES`, `vehicle-tracks.ts`, the fixed distance
 * between successive stamps along a vehicle's path) plus one feather
 * (`TRACK_FEATHER_TILES`), so two consecutive stamps overlap by EXACTLY the
 * feather width on each side, with complementary linear fade ramps meeting
 * in the middle -- Task 11's own falsification ("joins consecutive stamps
 * without a seam or a double") is what this geometry exists to make
 * possible: `(0.5 + 0.08) / 2 = 0.29`, so a stamp is `0.58` tiles long,
 * `0.08` tiles longer than the `0.5`-tile gap it has to bridge.
 */
export const TRACK_STAMP_HALF_LENGTH: number = (STAMP_SPACING_TILES + TRACK_FEATHER_TILES) / 2;

/**
 * One stamp's worth of everything `DecalPool.stamp` needs. `x`/`z` are
 * world tile coordinates (the decal's own centre); `halfLength`/`facingRad`
 * follow `GridPlacement`'s convention. `seed` is a per-stamp pseudo-random
 * value in `[0, 1)` Task 11's shader uses to vary a crater's rim or an oil
 * pool's edge stamp-to-stamp, so two decals of the same kind never look
 * identical. `simMs` is this stamp's own `stampSimMs(tickCount)` -- see
 * this file's top comment, "The sim-time clock (R-14)".
 */
export interface DecalStamp {
  readonly kind: DecalKind;
  readonly x: number;
  readonly z: number;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly facingRad: number;
  readonly seed: number;
  readonly simMs: number;
}

// ---------------------------------------------------------------------------
// Pure: the kind formulas (Task 11, spec §5). `decalAlpha` is the shader's
// mirror; `DECAL_FRAGMENT_SHADER` below is its transcription. Every number
// either side uses is one of the constants in this block.
// ---------------------------------------------------------------------------

/**
 * The eight palette colours the kinds draw in, as hex strings the caller
 * resolves from `data/palette.json` (never a literal at the call site). KEY
 * ORDER IS THE SHADER'S COLOUR INDEX: `DECAL_PALETTE_ORDER` below lists the
 * same keys in the same order, and `DecalSample.colour` indexes it.
 */
export interface DecalPalette {
  readonly craterBowl: string;
  readonly craterLip: string;
  readonly scorch: string;
  readonly oil: string;
  readonly rubbleA: string;
  readonly rubbleB: string;
  readonly tread: string;
  readonly tyre: string;
}

/** `DecalPalette`'s keys in colour-index order -- `uColors[i]` is
 *  `palette[DECAL_PALETTE_ORDER[i]]`. */
export const DECAL_PALETTE_ORDER: readonly (keyof DecalPalette)[] = [
  'craterBowl',
  'craterLip',
  'scorch',
  'oil',
  'rubbleA',
  'rubbleB',
  'tread',
  'tyre',
];

/** Spec §5's approved opacities, per kind (the lead's numbers -- do not
 *  tune here). */
export const CRATER_BOWL_ALPHA = 0.4;
export const CRATER_LIP_ALPHA = 0.25;
export const OIL_ALPHA = 0.55;
export const RUBBLE_ALPHA = 0.6;
export const TRACK_ALPHA = 0.35;
/** D6: a tread/tyre mark fades LINEARLY from `TRACK_ALPHA` to nothing over
 *  this many SIM seconds -- no hold. */
export const TRACK_FADE_SEC = 180;
/** A1.2's scorch as shipped (`scorch-decals.ts`'s `SCORCH_OPACITY` /
 *  `SCORCH_EDGE_INNER`), now owned here: solid to 0.55 r, `smoothstep` to
 *  nothing at the rim. */
export const SCORCH_ALPHA = 0.45;
export const SCORCH_EDGE_INNER = 0.55;

// Shape constants -- spec §5 formulas, in offset units (r = 1 at the rim).
/** Crater rim wobble: `r' = r(1 + A sin(3θ + 2π seed))`. */
const CRATER_WOBBLE = 0.04;
const CRATER_LOBES = 3;
const CRATER_BOWL_EDGE0 = 0.72;
const CRATER_BOWL_EDGE1 = 0.8;
const CRATER_LIP_IN0 = 0.76;
const CRATER_LIP_IN1 = 0.84;
const CRATER_LIP_OUT0 = 0.92;
const CRATER_LIP_OUT1 = 1.0;
/** Oil edge wobble: `r' = r(1 + A sin(2θ + 2π seed))`. */
const OIL_WOBBLE = 0.1;
const OIL_LOBES = 2;
const OIL_EDGE_INNER = 0.7;
/** Rubble cells are `1 / RUBBLE_CELLS_PER_UNIT` = 0.2 r across. */
const RUBBLE_CELLS_PER_UNIT = 5;
/** Keeps `floor(5s)` (>= -5) non-negative before `tileHash`, so the GLSL
 *  `uint` cast agrees with the JS integer hash. */
const RUBBLE_CELL_OFFSET = 64;
/** `floor(1000 seed)` -- one stamp's cells differ from the next's. */
const RUBBLE_SEED_SCALE = 1000;
const RUBBLE_CHIP_THRESHOLD = 0.55;
/** `fract(7h) < 0.5` picks the tone -- decorrelated from the chip test. */
const RUBBLE_TONE_SCALE = 7;
const RUBBLE_EDGE_INNER = 0.75;
/** Tread/tyre falls off across the print from `|t| = 0.7` to 1. */
const TRACK_SIDE_INNER = 0.7;
/** Tread cleat period along the print, tiles, and the cleat's two levels. */
const TREAD_PERIOD_TILES = 0.06;
const TREAD_PATTERN_BASE = 0.65;
const TREAD_PATTERN_CLEAT = 0.35;

/** `tileHash`'s three multipliers, interpolated into `rlHash` so the GLSL
 *  cannot drift from `packages/render/src/tile-hash.ts`. Pinned against
 *  `tileHash` itself in `decal-pool.test.ts`. */
export const TILE_HASH_MX = 374761393;
export const TILE_HASH_MY = 668265263;
export const TILE_HASH_MIX = 1274126177;

/** Colour indices -- positions in `DECAL_PALETTE_ORDER`. */
const COLOUR_CRATER_BOWL = 0;
const COLOUR_CRATER_LIP = 1;
const COLOUR_SCORCH = 2;
const COLOUR_OIL = 3;
const COLOUR_RUBBLE_A = 4;
const COLOUR_RUBBLE_B = 5;
const COLOUR_TREAD = 6;
const COLOUR_TYRE = 7;

/**
 * F-22 (fix round 1): what a decal fragment MULTIPLIES the lit ground by.
 *
 * The decal is drawn with multiply blending (`DstColor x SrcColor`) onto the
 * ground AFTER the ground is lit and shadowed, so it cannot glow in shade:
 * it scales whatever light is already on the pixel. What it writes is the
 * ALBEDO RATIO of the decal's tone to the ground's own base tone at that
 * decal (`terrain/decal-ground-tone.ts`: the tile's palette tone with the
 * road mixed in, before the albedo and macro ratio fields) -- the same
 * ratio-over-palette-tone model the ground itself uses -- mixed toward
 * 1 by its alpha: `1 + alpha * (decal / ground - 1)`, per channel, linear.
 * On ground whose albedo is its palette tone this is exactly the old "over"
 * blend lit like the ground: `ground * (1 - a) + decal * a`, so an approved
 * alpha still means "covers that fraction of the change from ground tone to
 * decal tone". A pale kind (crater lip, rubble, tyre) is a ratio above 1,
 * which the scene target carries: it is HalfFloat (`post-chain.ts`), so
 * nothing clamps before `OutputPass`. `ground` is floored at 1e-4 per channel
 * so a black palette tone could never divide by zero.
 */
export function decalMultiplier(
  decal: readonly [number, number, number],
  ground: readonly [number, number, number],
  alpha: number
): [number, number, number] {
  const m = (c: number): number => 1 + alpha * (decal[c] / Math.max(ground[c], DECAL_GROUND_FLOOR) - 1);
  return [m(0), m(1), m(2)];
}

/** `decalMultiplier`'s divide-by-zero floor -- see its doc comment. */
export const DECAL_GROUND_FLOOR = 1e-4;

/** One fragment's worth of `decalAlpha`: its opacity, and which palette
 *  entry (`DECAL_PALETTE_ORDER` index) it draws in. */
export interface DecalSample {
  readonly alpha: number;
  readonly colour: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** `r(1 + amp sin(lobes θ + 2π seed))`, with θ taken as 0 at the centre --
 *  GLSL's `atan(0, 0)` is undefined, and `r = 0` there anyway. */
function wobbledRadius(s: number, t: number, seed: number, amp: number, lobes: number): number {
  const r = Math.hypot(s, t);
  const theta = r > 0 ? Math.atan2(t, s) : 0;
  return r * (1 + amp * Math.sin(lobes * theta + 2 * Math.PI * seed));
}

/**
 * The kind shader's mirror (spec §5): opacity and palette index for one
 * fragment of a `kind` decal at offset `(s, t)` in `[-1, 1]^2`, with the
 * stamp's `seed` in `[0, 1)`, its age in SIM seconds (`uNowSec - aDecal.z`;
 * negative between a stamp's date and the frame that presents it, clamped),
 * and its `halfLength` in tiles (tread/tyre only: it turns `s` into tiles
 * along the print, so the feather and the cleat period are in tiles
 * whatever the stamp's length).
 *
 * The tread/tyre feather is `TRACK_FEATHER_TILES` -- the same constant
 * `TRACK_STAMP_HALF_LENGTH` is built from -- so two stamps
 * `STAMP_SPACING_TILES` apart overlap by exactly the feather, on
 * complementary linear ramps: their "over" composite never exceeds
 * `TRACK_ALPHA` (no double) and dips at most `TRACK_ALPHA^2 / 4` at the
 * midpoint (no seam) -- G7, R-15.
 */
export function decalAlpha(
  kind: DecalKind,
  s: number,
  t: number,
  seed: number,
  ageSec: number,
  halfLength: number
): DecalSample {
  switch (kind) {
    case 'crater': {
      const rw = wobbledRadius(s, t, seed, CRATER_WOBBLE, CRATER_LOBES);
      const bowl = CRATER_BOWL_ALPHA * (1 - smoothstep(CRATER_BOWL_EDGE0, CRATER_BOWL_EDGE1, rw));
      const lip =
        CRATER_LIP_ALPHA *
        smoothstep(CRATER_LIP_IN0, CRATER_LIP_IN1, rw) *
        (1 - smoothstep(CRATER_LIP_OUT0, CRATER_LIP_OUT1, rw));
      return lip > bowl ? { alpha: lip, colour: COLOUR_CRATER_LIP } : { alpha: bowl, colour: COLOUR_CRATER_BOWL };
    }
    case 'scorch': {
      const r = Math.hypot(s, t);
      return { alpha: SCORCH_ALPHA * (1 - smoothstep(SCORCH_EDGE_INNER, 1, r)), colour: COLOUR_SCORCH };
    }
    case 'oil': {
      const rw = wobbledRadius(s, t, seed, OIL_WOBBLE, OIL_LOBES);
      return { alpha: OIL_ALPHA * (1 - smoothstep(OIL_EDGE_INNER, 1, rw)), colour: COLOUR_OIL };
    }
    case 'rubble': {
      const r = Math.hypot(s, t);
      const h = tileHash(
        Math.floor(RUBBLE_CELLS_PER_UNIT * s) + RUBBLE_CELL_OFFSET,
        Math.floor(RUBBLE_CELLS_PER_UNIT * t) + RUBBLE_CELL_OFFSET + Math.floor(RUBBLE_SEED_SCALE * seed)
      );
      const chip = h >= RUBBLE_CHIP_THRESHOLD ? 1 : 0;
      const tone = RUBBLE_TONE_SCALE * h - Math.floor(RUBBLE_TONE_SCALE * h);
      return {
        alpha: RUBBLE_ALPHA * chip * (1 - smoothstep(RUBBLE_EDGE_INNER, 1, r)),
        colour: tone < 0.5 ? COLOUR_RUBBLE_A : COLOUR_RUBBLE_B,
      };
    }
    case 'tread':
    case 'tyre': {
      const u = s * halfLength;
      const feather = clamp01((halfLength - Math.abs(u)) / TRACK_FEATHER_TILES);
      const side = 1 - smoothstep(TRACK_SIDE_INNER, 1, Math.abs(t));
      const fade = clamp01(1 - Math.max(ageSec, 0) / TRACK_FADE_SEC);
      let pattern = 1;
      if (kind === 'tread') {
        const p = u / TREAD_PERIOD_TILES;
        pattern = TREAD_PATTERN_BASE + TREAD_PATTERN_CLEAT * (p - Math.floor(p) >= 0.5 ? 1 : 0);
      }
      return {
        alpha: TRACK_ALPHA * feather * side * fade * pattern,
        colour: kind === 'tread' ? COLOUR_TREAD : COLOUR_TYRE,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// GPU-facing: THREE.* construction. Constructed and inspected under
// `environment: 'node'` with no real `WebGLRenderer`, same as
// `scorch-decals.test.ts`'s own GPU half.
// ---------------------------------------------------------------------------

/**
 * A capacity-bounded ring buffer of conforming decal grids, one non-indexed
 * -- no, one INDEXED -- `THREE.Mesh`, one draw call per pool. Structurally
 * `ScorchDecalMesh` generalised to an arbitrary `grid` size and a caller-
 * supplied kind/seed/date per stamp, instead of one fixed shape and one
 * fixed material.
 *
 * The pure geometry helpers above (`writeGridIndices`, `writeDecalGrid`,
 * `writeDecalOffsets`) are called once per slot for the STATIC parts
 * (index, `aOffset`) at construction, and per stamp for the DYNAMIC parts
 * (`position`, `aDecal`) -- exactly the position/offset split
 * `ScorchDecalMesh` already establishes, generalised to an `n x n` grid
 * instead of two fixed triangles.
 *
 * `material` is supplied by the caller and NOT owned by this class --
 * Task 11's `createDecalMaterial` builds the one, palette-driven
 * `ShaderMaterial` both the persistent and the fading pool share (one
 * material, two meshes, two draw calls), so `dispose()` here only ever
 * disposes the geometry (see that method's own doc comment).
 *
 * Deliberately carries no `normal` attribute: `isAoOccluder` (`post-chain
 * .ts`) returns `false` for any `THREE.Mesh` with no `normal` attribute,
 * which is exactly the AO pre-pass exclusion spec §8 requires ("the AO
 * pre-pass and the shadow pass must never see a decal") -- achieved by
 * omission rather than by an explicit flag this class would otherwise have
 * to remember to set. `castShadow`/`receiveShadow` are set to `false`
 * explicitly regardless, since a decal is drawn `depthTest: true,
 * depthWrite: false` translucent geometry sitting exactly on top of the
 * terrain it already shadows correctly -- casting or receiving a shadow of
 * its own would double it.
 */
export class DecalPool {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly decalAttr: THREE.BufferAttribute;
  private readonly groundAttr: THREE.BufferAttribute;
  private readonly capacityValue: number;
  private readonly gridValue: number;
  private readonly trisPerDecal: number;
  private writeCursor = 0;
  /** `min(total stamps ever made, capacity)` -- see `ScorchDecalMesh
   *  .writtenCount`'s identical field for the ring-buffer "never grows past
   *  capacity" guarantee this mirrors. */
  private writtenCount = 0;

  constructor(opts: { capacity: number; grid: number; renderOrder: number; material: THREE.Material }) {
    const { capacity, grid, renderOrder, material } = opts;
    // The falsification the plan names for the sibling pool
    // (`scorch-decals.ts`): a pool of zero must be a red test at
    // construction, not a renderer that silently draws nothing.
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`DecalPool: capacity must be a positive integer, got ${capacity}`);
    }
    this.capacityValue = capacity;
    this.gridValue = grid;
    this.trisPerDecal = gridTriangles(grid);
    const verticesPerDecal = grid * grid;

    const geometry = new THREE.BufferGeometry();

    this.positionAttr = new THREE.BufferAttribute(new Float32Array(capacity * verticesPerDecal * 3), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);

    // STATIC: every slot's (s, t) grid is the same regardless of where or
    // how large the decal placed there is -- see `writeDecalOffsets`'s own
    // doc comment.
    const offsetAttr = new THREE.BufferAttribute(new Float32Array(capacity * verticesPerDecal * 2), 2);
    for (let slot = 0; slot < capacity; slot++) {
      writeDecalOffsets(offsetAttr.array as Float32Array, slot, grid);
    }
    geometry.setAttribute('aOffset', offsetAttr);

    // DYNAMIC: kind index, seed, simMs/1000, halfLength -- rewritten by
    // `stamp()` every time a slot recycles.
    this.decalAttr = new THREE.BufferAttribute(new Float32Array(capacity * verticesPerDecal * 4), 4);
    this.decalAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aDecal', this.decalAttr);

    // DYNAMIC: the ground's own linear albedo under this decal, captured at
    // the stamp -- `decalMultiplier`'s denominator (fix round 2). One vec3 a
    // decal, repeated on each of its vertices, like `aDecal`.
    this.groundAttr = new THREE.BufferAttribute(new Float32Array(capacity * verticesPerDecal * 3), 3);
    this.groundAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aGround', this.groundAttr);

    // STATIC index: a decal's grid topology never changes, only its vertex
    // data does.
    const indices = new Uint32Array(capacity * this.trisPerDecal * 3);
    const perSlot = this.trisPerDecal * 3;
    for (let slot = 0; slot < capacity; slot++) {
      // `writeGridIndices` writes from index 0 of the array it is handed (it
      // offsets the VALUES by the slot, not the write position), so each slot
      // gets its own share. Handing it the whole array stacked every slot's
      // indices on top of slot 0's: one draw call, no visible pixels.
      writeGridIndices(indices.subarray(slot * perSlot, (slot + 1) * perSlot), slot, grid);
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = renderOrder;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // A decal can appear anywhere a shell has landed or a vehicle has died,
    // exactly like `ScorchDecalMesh`'s and `VehicleTrackMesh`'s own
    // whole-map spans.
    this.mesh.frustumCulled = false;
  }

  get capacity(): number {
    return this.capacityValue;
  }

  /** How many decals are currently drawn -- `min(total stamps, capacity)`,
   *  never past it. */
  get liveCount(): number {
    return this.writtenCount;
  }

  /**
   * Stamps one decal into the next ring slot, overwriting the oldest
   * content there once the pool is full -- the same graceful-degradation
   * wraparound `ScorchDecalMesh.stamp`/`VehicleTrackMesh.stamp` use.
   * `sampleY`/`isTerrace` are threaded straight through to
   * `writeDecalGrid`; this method adds nothing to the height they return
   * beyond what that function already does (`+ MARK_EPSILON`). `ground` is
   * the ground's linear base albedo at the decal's centre
   * (`terrain/decal-ground-tone.ts`), the ratio's denominator.
   */
  stamp(
    s: DecalStamp,
    sampleY: (x: number, z: number) => number,
    isTerrace: (x: number, z: number) => boolean,
    ground: readonly [number, number, number]
  ): void {
    const slot = this.writeCursor;
    this.writeCursor = (this.writeCursor + 1) % this.capacityValue;
    this.writtenCount = Math.min(this.writtenCount + 1, this.capacityValue);
    const n = this.gridValue;

    writeDecalGrid(
      this.positionAttr.array as Float32Array,
      slot,
      n,
      { cx: s.x, cz: s.z, halfLength: s.halfLength, halfWidth: s.halfWidth, facingRad: s.facingRad },
      sampleY,
      isTerrace
    );
    this.positionAttr.needsUpdate = true;

    const kindIndex = DECAL_KIND_INDEX[s.kind];
    const ageBaseSec = s.simMs / 1000;
    const decalArray = this.decalAttr.array as Float32Array;
    const base = slot * n * n * 4;
    for (let v = 0; v < n * n; v++) {
      const vBase = base + v * 4;
      decalArray[vBase] = kindIndex;
      decalArray[vBase + 1] = s.seed;
      decalArray[vBase + 2] = ageBaseSec;
      decalArray[vBase + 3] = s.halfLength;
    }
    this.decalAttr.needsUpdate = true;

    const groundArray = this.groundAttr.array as Float32Array;
    const gBase = slot * n * n * 3;
    for (let v = 0; v < n * n; v++) {
      groundArray[gBase + v * 3] = ground[0];
      groundArray[gBase + v * 3 + 1] = ground[1];
      groundArray[gBase + v * 3 + 2] = ground[2];
    }
    this.groundAttr.needsUpdate = true;

    this.mesh.geometry.setDrawRange(0, this.writtenCount * this.trisPerDecal * 3);
  }

  /** Geometry only -- the material is shared (Task 11's one `ShaderMaterial`
   *  for both pools) and owned by the caller, exactly as `DecalPool`'s own
   *  top comment says. */
  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

/** F-23: pull the decal toward the camera in depth only, so the linear
 *  chord of a coarse grid cell never sinks under a bicubic crest. See this
 *  file's top comment, "The kind shader". */
export const DECAL_POLYGON_OFFSET_FACTOR = -1;
export const DECAL_POLYGON_OFFSET_UNITS = -4;

/** A number as a GLSL float literal -- always carries a decimal point, so
 *  `180` becomes `180.000000`, never the `int` literal `180`. */
function glslFloat(v: number): string {
  return v.toFixed(6);
}

const DECAL_VERTEX_SHADER = /* glsl */ `
  attribute vec2 aOffset;
  attribute vec4 aDecal;
  attribute vec3 aGround;
  varying vec2 vOffset;
  // flat: kind, seed, date and half-length are per-decal constants -- no
  // interpolation, so floor(1000 seed) and the kind branch see the exact
  // value the pool wrote.
  flat varying vec4 vDecal;
  // flat: the ground tone under the decal, one per decal (fix round 2).
  flat varying vec3 vGround;
  void main() {
    vOffset = aOffset;
    vDecal = aDecal;
    vGround = aGround;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const f = glslFloat;

/** `decalAlpha`, transcribed. Keep the two in step line for line. */
const DECAL_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColors[${DECAL_PALETTE_ORDER.length}];
  uniform float uNowSec;
  varying vec2 vOffset;
  flat varying vec4 vDecal;
  flat varying vec3 vGround;

  // tileHash (packages/render/src/tile-hash.ts) in uint arithmetic -- see
  // decal-pool.ts's top comment. Inputs are non-negative by construction.
  float rlHash(int xi, int yi) {
    uint h = uint(xi) * ${TILE_HASH_MX}u + uint(yi) * ${TILE_HASH_MY}u;
    h = (h ^ (h >> 13u)) * ${TILE_HASH_MIX}u;
    h = h ^ (h >> 16u);
    // Top 24 bits: exact in a float, and never rounds up to 1.0.
    return float(h >> 8u) / 16777216.0;
  }

  float wobbledRadius(vec2 st, float seed, float amp, float lobes) {
    float r = length(st);
    float theta = r > 0.0 ? atan(st.y, st.x) : 0.0;
    return r * (1.0 + amp * sin(lobes * theta + ${f(2 * Math.PI)} * seed));
  }

  void main() {
    int kind = int(vDecal.x + 0.5);
    float seed = vDecal.y;
    float ageSec = uNowSec - vDecal.z;
    float halfLength = vDecal.w;
    float s = vOffset.x;
    float t = vOffset.y;
    float a = 0.0;
    int ci = 0;

    if (kind == ${DECAL_KIND_INDEX.crater}) {
      float rw = wobbledRadius(vOffset, seed, ${f(CRATER_WOBBLE)}, ${f(CRATER_LOBES)});
      float bowl = ${f(CRATER_BOWL_ALPHA)} * (1.0 - smoothstep(${f(CRATER_BOWL_EDGE0)}, ${f(CRATER_BOWL_EDGE1)}, rw));
      float lip = ${f(CRATER_LIP_ALPHA)}
        * smoothstep(${f(CRATER_LIP_IN0)}, ${f(CRATER_LIP_IN1)}, rw)
        * (1.0 - smoothstep(${f(CRATER_LIP_OUT0)}, ${f(CRATER_LIP_OUT1)}, rw));
      if (lip > bowl) { a = lip; ci = ${COLOUR_CRATER_LIP}; } else { a = bowl; ci = ${COLOUR_CRATER_BOWL}; }
    } else if (kind == ${DECAL_KIND_INDEX.scorch}) {
      a = ${f(SCORCH_ALPHA)} * (1.0 - smoothstep(${f(SCORCH_EDGE_INNER)}, 1.0, length(vOffset)));
      ci = ${COLOUR_SCORCH};
    } else if (kind == ${DECAL_KIND_INDEX.oil}) {
      float rw = wobbledRadius(vOffset, seed, ${f(OIL_WOBBLE)}, ${f(OIL_LOBES)});
      a = ${f(OIL_ALPHA)} * (1.0 - smoothstep(${f(OIL_EDGE_INNER)}, 1.0, rw));
      ci = ${COLOUR_OIL};
    } else if (kind == ${DECAL_KIND_INDEX.rubble}) {
      float h = rlHash(
        int(floor(${f(RUBBLE_CELLS_PER_UNIT)} * s)) + ${RUBBLE_CELL_OFFSET},
        int(floor(${f(RUBBLE_CELLS_PER_UNIT)} * t)) + ${RUBBLE_CELL_OFFSET} + int(floor(${f(RUBBLE_SEED_SCALE)} * seed))
      );
      float chip = step(${f(RUBBLE_CHIP_THRESHOLD)}, h);
      a = ${f(RUBBLE_ALPHA)} * chip * (1.0 - smoothstep(${f(RUBBLE_EDGE_INNER)}, 1.0, length(vOffset)));
      ci = fract(${f(RUBBLE_TONE_SCALE)} * h) < 0.5 ? ${COLOUR_RUBBLE_A} : ${COLOUR_RUBBLE_B};
    } else if (kind == ${DECAL_KIND_INDEX.tread} || kind == ${DECAL_KIND_INDEX.tyre}) {
      float u = s * halfLength;
      float feather = clamp((halfLength - abs(u)) / ${f(TRACK_FEATHER_TILES)}, 0.0, 1.0);
      float side = 1.0 - smoothstep(${f(TRACK_SIDE_INNER)}, 1.0, abs(t));
      float fade = clamp(1.0 - max(ageSec, 0.0) / ${f(TRACK_FADE_SEC)}, 0.0, 1.0);
      float pattern = 1.0;
      if (kind == ${DECAL_KIND_INDEX.tread}) {
        pattern = ${f(TREAD_PATTERN_BASE)} + ${f(TREAD_PATTERN_CLEAT)} * step(0.5, fract(u / ${f(TREAD_PERIOD_TILES)}));
      }
      a = ${f(TRACK_ALPHA)} * feather * side * fade * pattern;
      ci = kind == ${DECAL_KIND_INDEX.tread} ? ${COLOUR_TREAD} : ${COLOUR_TYRE};
    }

    if (a <= 0.0) discard;
    vec3 colour = uColors[ci];
    // F-22 (fix round 1): the ONE point where colour becomes output --
    // \`decalMultiplier\`, transcribed. Written as an albedo ratio over the
    // ground's OWN tone under this decal (vGround, captured at the stamp --
    // fix round 2) and multiplied onto the LIT ground by the blend state, so
    // a lip in shade stays in shade and a lip on a green map's road is the
    // lip's colour, not a salmon one. Alpha is unused by the blend.
    vec3 ratio = colour / max(vGround, ${f(DECAL_GROUND_FLOOR)});
    gl_FragColor = vec4(1.0 + a * (ratio - 1.0), 1.0);
  }
`;

/**
 * The one material both decal pools share (see `DecalPool`'s top comment):
 * the kind shader above, `uColors[8]` from `palette` in
 * `DECAL_PALETTE_ORDER` (linear, via `hexToLinear`), and `uNowSec`, the
 * SIM clock in seconds, starting at 0 -- the renderer sets it every frame
 * from `presentationSimMs(tickCount, alpha) / 1000`, never from a frame
 * timestamp. The denominator of `decalMultiplier`'s albedo ratio is NOT a
 * uniform: each decal carries its own ground tone (`aGround`, written by
 * `DecalPool.stamp`). Multiply-blended onto the
 * lit ground (F-22, fix round 1), depth-tested, not depth-writing, with
 * F-23's polygon offset; `DoubleSide` for the same reason `createScorchMaterial`
 * gives -- no lighting term depends on the winding, so the winding is not a
 * risk worth carrying.
 */
export function createDecalMaterial(palette: DecalPalette): THREE.ShaderMaterial {
  const colours = DECAL_PALETTE_ORDER.map((key) => {
    const [r, g, b] = hexToLinear(palette[key]);
    return new THREE.Vector3(r, g, b);
  });
  return new THREE.ShaderMaterial({
    uniforms: {
      uColors: { value: colours },
      uNowSec: { value: 0 },
    },
    vertexShader: DECAL_VERTEX_SHADER,
    fragmentShader: DECAL_FRAGMENT_SHADER,
    transparent: true,
    // F-22 (fix round 1): multiply onto the lit ground -- see
    // `decalMultiplier`. dst.rgb = src.rgb * dst.rgb; dst.a kept.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: DECAL_POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: DECAL_POLYGON_OFFSET_UNITS,
    side: THREE.DoubleSide,
  });
}
