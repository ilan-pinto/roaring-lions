/**
 * F-27: the pure half of the shared decal pool (`decal-pool.ts`, Tasks 10-11
 * of `docs/superpowers/plans/2026-09-25-ground-plan-1.md`) -- kinds, the
 * sim-time clock, the conforming-grid maths, the approved size curves, and
 * `decalAlpha` (the kind shader's pure mirror, one formula per kind, spec
 * §5). No `THREE.*` anywhere in this file -- exercised directly with plain
 * numbers, and pinned by `decal-maths.test.ts`'s import-boundary check. That
 * split is TIDINESS, not a requirement: `three` loads fine under node
 * (`decal-pool.test.ts` builds real meshes there, and tools resolves it
 * through `packages/render/node_modules`), so nothing breaks if it slips --
 * it keeps the pure maths readable apart from the GPU code (final review
 * M-5). `decal-pool.ts` re-exports everything here and adds the GPU
 * half on top: `DecalPool` (the ring-buffer `THREE.Mesh`) and
 * `createDecalMaterial` (`decalAlpha`'s GLSL transcription).
 *
 * ## One pool class, two instances (R-10)
 *
 * `docs/superpowers/plans/2026-09-25-ground-plan-1.md` names the conflict
 * this sizing resolves: the design gives both "a 4x4-vertex grid (18 tris)"
 * and a "under 27k triangles" total budget, and 5,120 decals (1024
 * persistent + 4096 fading) at 18 tris each is 92,160 -- over three times
 * the budget. **R-10 (the controller's ruling): persistent decals keep the
 * 4x4 grid (`PERSISTENT_GRID`), fading decals (tread/tyre -- the ones that
 * age out and vastly outnumber the persistent ones) drop to a 2x2 grid
 * (`FADING_GRID`, 2 tris)**. `PERSISTENT_CAPACITY * 18 + FADING_CAPACITY * 2
 * = 1024*18 + 4096*2 = 18432 + 8192 = 26624`, under the 27k ceiling --
 * pinned in `decal-pool.test.ts` against the literal arithmetic, not a
 * `toBeLessThan`, so a future edit to either constant is caught by name.
 * `DecalPool` (`decal-pool.ts`) takes `grid` as a constructor option rather
 * than hard-coding either number, so the same class serves both pools.
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
 * `(presentationSimMs(tickCount, alpha) - stamp.simMs) / 1000` -- `decalAlpha`
 * and `createDecalMaterial` (`decal-pool.ts`) are the only consumers, and
 * they take that division as an input rather than doing it, so this module
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
 * **R-19, and what a grid vertex over a terrace samples (fix wave I-4).**
 * A decal whose centre tile is a terrace is not stamped (`stampGroundDecal`
 * refuses it). A vertex that overhangs a terrace or the map edge from an
 * open centre used to take the CENTRE's height, and off the map the height
 * was 0: at a ridge foot the chord then cut under the rising apron by up to
 * 0.62 wu, and on `qarn_hadid`'s level-2 rim a mark dived by up to 0.38 wu.
 * The caller's `sampleY` is now the SMOOTH field everywhere
 * (`smoothWorldY`): on open ground that is the drawn surface exactly; under
 * a terrace it is the field `buildTerrainSurface` fills in from the open
 * ground around it, so the chord follows the apron to the foot of the wall
 * and runs on under the terrace, where the wall's own depth hides it; and
 * off the map it is the edge-clamped field (`fieldAt` replicates the rim),
 * so a rim mark stays on its level. The shader discards what hangs past the
 * map edge. On a flat map every one of these reads 0, so nothing moves.
 *
 * Indexing follows `ground.ts`'s own `pushSmoothTile` exactly: the fan
 * `(a, c, b, a, d, c)` per quad, corners walked `(i,j) -> (i+1,j) ->
 * (i+1,j+1) -> (i,j+1)`, which is what makes `writeGridIndices`'s winding
 * agree with the terrain mesh it sits on (both wind "up", `+Y`, at a flat
 * placement -- `decal-pool.test.ts` cross-checks this directly rather than
 * trusting the mirrored formula).
 *
 * ## decalAlpha, the kind shader's pure mirror (Task 11)
 *
 * Every kind is procedural: a function of the fragment's own `(s, t)`
 * offset in `[-1, 1]^2` (`aOffset`), the stamp's `seed`, its age in SIM
 * seconds, and its `halfLength` -- no texture. `decalAlpha` is written
 * first and tested; `decal-pool.ts`'s `DECAL_FRAGMENT_SHADER` is the same
 * arithmetic line for line, and every number in it is interpolated from a
 * named constant this module exports (`decal-pool.ts`'s `glslFloat`), never
 * retyped. `decal-pool.test.ts` checks the load-bearing constants appear in
 * the compiled string.
 *
 * - **Age is sim time.** `uNowSec` is `presentationSimMs(tickCount, alpha)
 *   / 1000`, set by the renderer (Task 12); `aDecal.z` is the stamp's own
 *   `simMs / 1000`. A frame-clock age would make the gate's zero-elapsed
 *   repaint read two different fades (see "The sim-time clock" above).
 * - **Colour is an index, not a value.** `decalAlpha` returns a position in
 *   `DECAL_PALETTE_ORDER` (bowl 0, lip 1, scorch 2, oil 3, rubble 4/5, tread
 *   6, tyre 7); resolving that index to a linear colour and writing it into
 *   the fragment is `decal-pool.ts`'s job (`createDecalMaterial`'s
 *   `uColors[8]`), not this module's.
 * - **An albedo ratio, multiplied onto the lit ground (F-22).** Blended
 *   unlit with an ordinary "over", a pale kind glowed inside a cast shadow
 *   -- Task 12 photographed a crater lip at 1.6x the shaded ground around
 *   it. `decalMultiplier` is the fix: the kind's tone over the ground tone
 *   UNDER THAT DECAL (captured at the stamp, per decal -- fix round 2),
 *   mixed toward 1 by alpha -- what `decal-pool.ts`'s material then
 *   multiplies onto the ground AFTER lighting and shadow. The scene target
 *   is HalfFloat, so a ratio above 1 (a pale lip) survives.
 * - **`TILE_HASH_MX`/`MY`/`MIX` and the two shifts are `tileHash`'s own
 *   constants**, exported by `packages/render/src/tile-hash.ts` (which
 *   `tileHash` itself now reads) and re-exported here, so `decal-pool.ts`'s
 *   GLSL `rlHash` is built from the same names rather than retyped literals
 *   that could drift. Pinned against `tileHash` in `decal-pool.test.ts`.
 */
import { STAMP_SPACING_TILES } from './vehicle-tracks';
import { MARK_EPSILON } from './terrain/shared';
import { tileHashOps } from '../tile-hash';
import { NUMBER_INT_OPS, NUMBER_OPS, type IntOps, type Ops } from './fog-ops';
import { roadBands } from './terrain/ground-maths';

// ---------------------------------------------------------------------------
// Kinds, the clock, grid geometry, and the approved size curves.
// ---------------------------------------------------------------------------

/** Every mark this pool draws. Order fixes `DECAL_KIND_INDEX` -- see that
 *  constant's own doc comment for why the order itself is load-bearing. */
export type DecalKind = 'crater' | 'scorch' | 'oil' | 'rubble' | 'tread' | 'tyre' | 'churn' | 'scuff';

/**
 * `DecalKind` as a small integer, written into the `aDecal` vertex
 * attribute's `x` component so `decal-pool.ts`'s shader can branch on it
 * with no string comparison on the GPU. The ORDER here is the type union's
 * own declaration order (0..5) -- not alphabetical, not grouped by
 * persistent/fading -- because that is the one ordering a reader can check
 * against the type definition without cross-referencing this object, and
 * because the shader-side colour indices (bowl 0, lip 1, scorch 2, oil 3,
 * rubble 4/5, tread 6, tyre 7) are quoted against this same declaration
 * order in the design spec.
 */
export const DECAL_KIND_INDEX: Readonly<Record<DecalKind, number>> = {
  crater: 0,
  scorch: 1,
  oil: 2,
  rubble: 3,
  tread: 4,
  tyre: 5,
  // GH-984 N2: the earth a tracked hull churns on a pivot and a hard launch. Appended, so no index moved.
  churn: 6,
  // GH-1207: the single round scrape a tracked hull leaves where it pivots on the spot. Appended, so no index moved.
  scuff: 7,
};

/** `tread`/`tyre` (R-15's 180 s fade), `churn` (GH-984 N2, `CHURN_FADE_SEC`) and `scuff` (GH-1207,
 *  `SCUFF_FADE_SEC`) are the kinds that age out; crater/scorch/oil/rubble are permanent for the
 *  mission, matching `scorch-decals.ts`'s own "No TTL" for the mark it already ships. */
export function isFadingKind(k: DecalKind): boolean {
  return k === 'tread' || k === 'tyre' || k === 'churn' || k === 'scuff';
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
export function writeGridIndices(out: Uint16Array | Uint32Array, slot: number, n: number): void {
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
 *  With the placement held at module scope too (below), a stamp allocates
 *  nothing once the scratch has grown. */
let sagScratch = new Float64Array(16);
let cellSagScratch = new Float64Array(9);

/* The placement `writeDecalGrid` is currently writing, held at module scope
 * (single-threaded; no re-entrancy) so the two grid-to-world maps below are
 * plain functions rather than closures built per call: the selection ring
 * (`units/selection-ring.ts`, GH-186) calls `writeDecalGrid` for every
 * selected unit every frame, and a per-frame writer allocates nothing. */
let gpN = 2;
let gpCx = 0;
let gpCz = 0;
let gpHalfLength = 0;
let gpHalfWidth = 0;
let gpCos = 1;
let gpSin = 0;

/** Grid-local `(gi, gj)` in `[0, n-1]` (fractional inside a cell) to world X. */
function gridWorldX(gi: number, gj: number): number {
  const s = -1 + (2 * gi) / (gpN - 1);
  const t = -1 + (2 * gj) / (gpN - 1);
  return gpCx + s * gpHalfLength * gpCos - t * gpHalfWidth * gpSin;
}

/** Grid-local `(gi, gj)` to world Z -- see `gridWorldX`. */
function gridWorldZ(gi: number, gj: number): number {
  const s = -1 + (2 * gi) / (gpN - 1);
  const t = -1 + (2 * gj) / (gpN - 1);
  return gpCz + s * gpHalfLength * gpSin + t * gpHalfWidth * gpCos;
}

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
 * `y = sampleY(x, z) + min(lift(i, j), DECAL_LIFT_CAP) + MARK_EPSILON`
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
 *
 * `sagSteps` is the sag lattice's resolution and defaults to
 * `DECAL_SAG_STEPS`, which every decal uses. The selection ring
 * (`units/selection-ring.ts`, GH-186), rewritten per selected unit per frame,
 * passes its own coarser `RING_SAG_STEPS`; see that constant for the
 * measurement that says it loses nothing there.
 */
export function writeDecalGrid(
  out: Float32Array,
  slot: number,
  n: number,
  p: GridPlacement,
  sampleY: (x: number, z: number) => number,
  sagSteps: number = DECAL_SAG_STEPS
): void {
  const base = slot * n * n * 3;
  gpN = n;
  gpCx = p.cx;
  gpCz = p.cz;
  gpHalfLength = p.halfLength;
  gpHalfWidth = p.halfWidth;
  gpCos = Math.cos(p.facingRad);
  gpSin = Math.sin(p.facingRad);
  const worldX = gridWorldX;
  const worldZ = gridWorldZ;
  const h = sampleY;

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
      for (let sv = 0; sv <= sagSteps; sv++) {
        const v = sv / sagSteps;
        for (let su = 0; su <= sagSteps; su++) {
          const u = su / sagSteps;
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
 * `writeDecalGrid` call used, in `[-1, 1]^2`, so `decal-pool.ts`'s shader can
 * derive a radial or per-axis falloff without re-deriving the placement.
 * STATIC per slot -- `(s, t)` depends only on `(i, j, n)`, never on where or
 * how the decal is placed, so `DecalPool` writes this once per slot at
 * construction, exactly like `scorch-decals.ts`'s own retired `aOffset`.
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
 * in the middle -- the falsification `decal-pool.test.ts` runs ("joins
 * consecutive stamps without a seam or a double") is what this geometry
 * exists to make possible: `(0.5 + 0.08) / 2 = 0.29`, so a stamp is `0.58`
 * tiles long, `0.08` tiles longer than the `0.5`-tile gap it has to bridge.
 */
export const TRACK_STAMP_HALF_LENGTH: number = (STAMP_SPACING_TILES + TRACK_FEATHER_TILES) / 2;

/**
 * One stamp's worth of everything `DecalPool.stamp` needs. `x`/`z` are
 * world tile coordinates (the decal's own centre); `halfLength`/`facingRad`
 * follow `GridPlacement`'s convention. `seed` is a per-stamp pseudo-random
 * value in `[0, 1)` the shader uses to vary a crater's rim or an oil
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
// The kind formulas (Task 11, spec §5). `decalAlpha` is the shader's mirror;
// `decal-pool.ts`'s `DECAL_FRAGMENT_SHADER` is its transcription. Every
// number either side uses is one of the constants in this block.
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
/** A1.2's scorch as shipped (`scorch-decals.ts`'s retired `SCORCH_OPACITY` /
 *  `SCORCH_EDGE_INNER`), owned here now: solid to 0.55 r, `smoothstep` to
 *  nothing at the rim. */
export const SCORCH_ALPHA = 0.45;
export const SCORCH_EDGE_INNER = 0.55;

// Shape constants -- spec §5 formulas, in offset units (r = 1 at the rim).
/** Crater rim wobble: `r' = r(1 + A sin(3θ + 2π seed))`. */
export const CRATER_WOBBLE = 0.04;
export const CRATER_LOBES = 3;
export const CRATER_BOWL_EDGE0 = 0.72;
export const CRATER_BOWL_EDGE1 = 0.8;
export const CRATER_LIP_IN0 = 0.76;
export const CRATER_LIP_IN1 = 0.84;
export const CRATER_LIP_OUT0 = 0.92;
export const CRATER_LIP_OUT1 = 1.0;
/** Oil edge wobble: `r' = r(1 + A sin(2θ + 2π seed))`. */
export const OIL_WOBBLE = 0.1;
export const OIL_LOBES = 2;
export const OIL_EDGE_INNER = 0.7;
/**
 * Rubble is a scatter of small soft CHIPS, one at most per cell (fix wave
 * I-5). The first cut filled whole square cells a fifth of the radius across
 * -- 0.34 tile on a 2x2 footprint, 0.5 on a larger one, axis-aligned, hard
 * `step` edges, in two tones -- and on grass, where the ratio divides by the
 * grass tone, it drew a checkerboard of limestone tiles. Now:
 *
 * - cells are `RUBBLE_CELL_TILES` across in WORLD units, whatever the spill's
 *   radius, so a big collapse spills more chips rather than bigger squares;
 * - the lattice is turned by `2 pi seed`, so no two spills line up and none
 *   lines up with the tile grid;
 * - each cell holds at most one soft disc (`1 - smoothstep(R0, R1, d)`),
 *   jittered off the cell centre by up to `RUBBLE_JITTER / 2` and sized by
 *   `RUBBLE_CHIP_SIZE_MIN..1`. `R1 + JITTER / 2 < 0.5`, so a chip never
 *   reaches its cell's edge and is never cut by a neighbour's;
 * - a cell holds a chip when its hash is under `RUBBLE_DENSITY`, thinned to
 *   nothing between `RUBBLE_EDGE_INNER` and the rim by the chip CENTRE's own
 *   radius -- a spill thins out rather than stopping at a circle.
 */
export const RUBBLE_CELL_TILES = 0.1;
/** Keeps a cell index (>= -sqrt(2) r / RUBBLE_CELL_TILES, tens of cells for
 *  any shipped footprint) non-negative before `tileHash`, so the GLSL
 *  `uint` cast agrees with the JS integer hash. */
export const RUBBLE_CELL_OFFSET = 1024;
/** `floor(1000 seed)` -- one stamp's cells differ from the next's. */
export const RUBBLE_SEED_SCALE = 1000;
/** Offset added to one coordinate for each jitter hash, so the two jitter
 *  axes and the chip test read three unrelated hashes of the same cell. */
export const RUBBLE_JITTER_SALT = 4099;
export const RUBBLE_DENSITY = 0.7;
export const RUBBLE_JITTER = 0.2;
/** A chip's soft edge, in cell units, before its size scale. */
export const RUBBLE_CHIP_R0 = 0.2;
export const RUBBLE_CHIP_R1 = 0.38;
export const RUBBLE_CHIP_SIZE_MIN = 0.55;
/** `fract(13h)` sizes the chip -- decorrelated from the tone and the test. */
export const RUBBLE_SIZE_SCALE = 13;
/** `fract(7h) < 0.5` picks the tone -- decorrelated from the chip test. */
export const RUBBLE_TONE_SCALE = 7;
export const RUBBLE_EDGE_INNER = 0.55;
/** Tread/tyre falls off across the print from `|t| = 0.7` to 1. */
export const TRACK_SIDE_INNER = 0.7;
/** Tread cleat period along the print, tiles, and the cleat's two levels. */
export const TREAD_PERIOD_TILES = 0.06;
export const TREAD_PATTERN_BASE = 0.65;
export const TREAD_PATTERN_CLEAT = 0.35;

/**
 * Churn (GH-984 N2): a scuff of turned earth where a tracked hull pivots on the spot or a vehicle
 * digs in on a hard launch. An ellipse with a wobbled rim (a third of the oil's), raked by radial
 * spokes so it reads as torn ground and not as a stain; it takes `tread`'s colour (dust on a dry map,
 * mud under rain). Fades LINEARLY over `CHURN_FADE_SEC` sim seconds, a shorter life than a track's.
 */
export const CHURN_ALPHA = 0.5;
export const CHURN_FADE_SEC = 120;
export const CHURN_WOBBLE = 0.12;
export const CHURN_LOBES = 3;
export const CHURN_EDGE_INNER = 0.45;
/** Radial rakes per turn, the share of the body they leave (the rest is the scraped furrow), and the radius they fade in over. */
export const CHURN_SPOKES = 9;
export const CHURN_SPOKE_BASE = 0.6;
export const CHURN_SPOKE_CORE = 0.18;
/** The three sizes the showcase stamps (half extents, tiles): a pivot's scuff, a launch's, and a heavy dozer's dig-in. */
export const CHURN_SHOWCASE_RADII: readonly [number, number, number] = [0.3, 0.45, 0.6];

/**
 * Scuff (GH-1207): the single round scrape a tracked hull leaves where it PIVOTS on the spot --
 * one clean disc about a hull length across, laid through `stampGroundDecal` once per pivot (see
 * `units/ground-churn.ts`'s `stepPivotScuff`/`pivotScuffStamp`). Unlike `churn`'s two under-track
 * torn-earth discs it is a single smooth-edged circle (no wobble, no spokes): the footprint the
 * whole hull swept. It takes `tread`'s colour (dust on a dry map, mud under rain), like `churn`,
 * and fades LINEARLY over `SCUFF_FADE_SEC` -- a little longer than a churn, since the scrape is
 * deeper than the loose earth.
 */
export const SCUFF_ALPHA = 0.4;
export const SCUFF_EDGE_INNER = 0.55;
export const SCUFF_FADE_SEC = 180;

/** `tileHash`'s multipliers and shifts, owned by `../tile-hash.ts` and
 *  re-exported here for the shader -- see this file's top comment. */
export { TILE_HASH_MIX, TILE_HASH_MX, TILE_HASH_MY, TILE_HASH_SHIFT_A, TILE_HASH_SHIFT_B } from '../tile-hash';

/** Colour indices -- positions in `DECAL_PALETTE_ORDER`. */
export const COLOUR_CRATER_BOWL = 0;
export const COLOUR_CRATER_LIP = 1;
export const COLOUR_SCORCH = 2;
export const COLOUR_OIL = 3;
export const COLOUR_RUBBLE_A = 4;
export const COLOUR_RUBBLE_B = 5;
export const COLOUR_TREAD = 6;
export const COLOUR_TYRE = 7;

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
  const m = (c: 0 | 1 | 2): number => decalMultiplierOps(NUMBER_OPS, decal[c], ground[c], alpha);
  return [m(0), m(1), m(2)];
}

/** A three-vector of `Ops<T>` scalars (the GH-943 P3 T7 maths below works per channel: `Ops<T>` is scalar). */
export type V3<T> = readonly [T, T, T];

/**
 * GH-943 P3 (T7): `decalMultiplier`, written once against `Ops<T>`: `decalMultiplier` is it on numbers, channel by channel, and
 * the node twin (`decal-pool.node.ts`) builds it on whole vec3 nodes (every op here is per component, the scalar `alpha` and
 * literals broadcast). `1 + alpha * (decal / max(ground, DECAL_GROUND_FLOOR) - 1)`.
 */
export function decalMultiplierOps<T>(o: Ops<T>, decal: T, ground: T, alpha: T): T {
  return o.add(o.lit(1), o.mul(alpha, o.sub(o.div(decal, o.max(ground, o.lit(DECAL_GROUND_FLOOR))), o.lit(1))));
}

/**
 * GH-943 P3 (T7): the ground tone under one decal FRAGMENT, the divisor of `decalMultiplierOps` (fix wave I-3): the decal's own
 * tile tone `base` (`aGround`), with the road surface and its shoulder mixed in from control B's road distance `bG` and edge bend
 * `bA` (both [0, 1]) exactly as the ground mixes them (`roadBands`, `terrain/ground-maths.ts`), each gated by the roads toggle
 * `roadOn`. `rangeTiles` is `ROAD_DISTANCE_RANGE_TILES`. Per component (one channel on numbers, a whole vec3 on nodes: the bands
 * are scalars). The legacy material's GLSL is its transcription
 * (`mix(mix(vGround, uRoadTone, rlRoadSurf), uShoulderTone, rlShoulder)`); `decalRoadMix` (`terrain/decal-ground-tone.ts`) is
 * the same mix on an exact road distance.
 */
export function decalGroundToneOps<T>(o: Ops<T>, base: T, road: T, shoulder: T, bG: T, bA: T, roadOn: T, rangeTiles: number): T {
  const bands = roadBands(o, o.mul(bG, o.lit(rangeTiles)), o.sub(o.mul(bA, o.lit(2)), o.lit(1)), o.lit(0));
  const surf = o.mul(roadOn, bands.surface);
  const sh = o.mul(roadOn, bands.shoulder);
  return o.mix(o.mix(base, road, surf), shoulder, sh);
}

/** `decalMultiplier`'s divide-by-zero floor -- see its doc comment. */
export const DECAL_GROUND_FLOOR = 1e-4;

// ---------------------------------------------------------------------------
// The wet decals (GH-871 P4 T5): mud prints, and water in a crater's bowl.
// Rain only -- a shipped map's palette and program are today's.
// ---------------------------------------------------------------------------

/** The eight decal colours' palette keys on a map that does not rain. */
export const DECAL_PALETTE_KEYS: Readonly<Record<keyof DecalPalette, string>> = {
  craterBowl: 'shadow.0',
  craterLip: 'limestone.1',
  scorch: 'shadow.0',
  oil: 'shadow.1',
  rubbleA: 'limestone.5',
  rubbleB: 'limestone.7',
  tread: 'dust.5',
  tyre: 'limestone.6',
};

/** Under rain a track is a print in mud: `tread` and `tyre` both resolve to
 *  `mud.3`, and the other six keys are today's. */
export const WET_DECAL_PALETTE_KEYS: Readonly<Record<keyof DecalPalette, string>> = {
  ...DECAL_PALETTE_KEYS,
  tread: 'mud.3',
  tyre: 'mud.3',
};

/** Which key table a renderer built with `weather` resolves its palette from. */
export function decalPaletteKeysFor(weather: 'clear' | 'rain' | undefined): Readonly<Record<keyof DecalPalette, string>> {
  return weather === 'rain' ? WET_DECAL_PALETTE_KEYS : DECAL_PALETTE_KEYS;
}

/**
 * The crater's height field in units of its own radius (the shader's
 * `craterHeight`, transcribed): a parabolic bowl of depth `bowlDepth` inside
 * the lip and a raised rim of `rimHeight` that peaks where the lip albedo does.
 * `uRimShape` carries `(bowlDepth, rimHeight)` in the shader.
 */
export function craterHeight(s: number, t: number, seed: number, bowlDepth: number, rimHeight: number): number {
  return craterHeightOps(NUMBER_OPS, s, t, seed, bowlDepth, rimHeight);
}

/** GH-943 P3 (T7): `craterHeight`, written once against `Ops<T>` (`craterHeight` is it on numbers; the node twin, a graph). */
export function craterHeightOps<T>(o: Ops<T>, s: T, t: T, seed: T, bowlDepth: T, rimHeight: T): T {
  const rw = wobbledRadiusOps(o, s, t, seed, CRATER_WOBBLE, CRATER_LOBES);
  const x = o.div(rw, o.lit(CRATER_LIP_IN1));
  const bowl = o.mul(o.sub(o.lit(0), bowlDepth), o.max(o.sub(o.lit(1), o.mul(x, x)), o.lit(0)));
  const rimC = (CRATER_LIP_IN1 + CRATER_LIP_OUT0) / 2;
  const rim = o.mul(
    o.mul(rimHeight, o.smoothstep(o.lit(CRATER_BOWL_EDGE0 - 0.06), o.lit(rimC), rw)),
    o.sub(o.lit(1), o.smoothstep(o.lit(rimC), o.lit(1), rw))
  );
  return o.add(bowl, rim);
}

/** The crater rim's central-difference step, in offset units (the legacy material's `float e = 0.01;`, pinned by its test). */
export const CRATER_RIM_EPSILON = 0.01;

/**
 * GH-943 P3 (T7): the crater height's gradient over `(s, t)` by central differences of `craterHeightOps`, step
 * `CRATER_RIM_EPSILON`: `(h(st + e) - h(st - e)) / 2e` on each axis, as the legacy material takes it.
 */
export function craterGradOps<T>(o: Ops<T>, s: T, t: T, seed: T, bowlDepth: T, rimHeight: T): { readonly hs: T; readonly ht: T } {
  const e = o.lit(CRATER_RIM_EPSILON);
  const twoE = o.lit(2 * CRATER_RIM_EPSILON);
  const h = (a: T, b: T): T => craterHeightOps(o, a, b, seed, bowlDepth, rimHeight);
  return {
    hs: o.div(o.sub(h(o.add(s, e), t), h(o.sub(s, e), t)), twoE),
    ht: o.div(o.sub(h(s, o.add(t, e)), h(s, o.sub(t, e))), twoE),
  };
}

/**
 * GH-943 P3 (T7): the lights the crater rim is relit by, as the legacy material reads them (`ambientLightColor`,
 * `directionalLights[0]`, `hemisphereLights[0]`): every colour already times its light's intensity, every direction in VIEW space
 * and pointing TOWARD the light. An absent light is a zero colour, which is what the legacy `#if NUM_*_LIGHTS > 0` amounts to.
 */
export interface DecalRimLights<T> {
  readonly ambient: V3<T>;
  readonly sunColor: V3<T>;
  readonly sunDir: V3<T>;
  readonly hemiSky: V3<T>;
  readonly hemiGround: V3<T>;
  readonly hemiDir: V3<T>;
}

/**
 * The decal facet's own frame at one fragment, PASSED IN (a screen-space rate is graph-only, `Ops<T>` has no derivative): the screen
 * derivatives of the view-space position (`dpx`, `dpy`) and of the `(s, t)` offset (`dstx`, `dsty`).
 */
export interface DecalRimFacet<T> {
  readonly dpx: V3<T>;
  readonly dpy: V3<T>;
  readonly dstx: readonly [T, T];
  readonly dsty: readonly [T, T];
}

function dot3<T>(o: Ops<T>, a: V3<T>, b: V3<T>): T {
  return o.add(o.add(o.mul(a[0], b[0]), o.mul(a[1], b[1])), o.mul(a[2], b[2]));
}

function cross3<T>(o: Ops<T>, a: V3<T>, b: V3<T>): [T, T, T] {
  return [
    o.sub(o.mul(a[1], b[2]), o.mul(a[2], b[1])),
    o.sub(o.mul(a[2], b[0]), o.mul(a[0], b[2])),
    o.sub(o.mul(a[0], b[1]), o.mul(a[1], b[0])),
  ];
}

function normalize3<T>(o: Ops<T>, a: V3<T>): [T, T, T] {
  const len = o.sqrt(dot3(o, a, a));
  return [o.div(a[0], len), o.div(a[1], len), o.div(a[2], len)];
}

/**
 * GH-943 P3 (T7): the sun and sky irradiance on a view-space normal `n`, the legacy material's `rlIrradiance` (Lambert; the pi
 * cancels in the ratio): `ambient + sun * max(n . sunDir, 0) * shadow + mix(hemiGround, hemiSky, 0.5 n . hemiDir + 0.5)`.
 * `shadow` scales the sun only.
 */
export function decalIrradianceOps<T>(o: Ops<T>, n: V3<T>, lights: DecalRimLights<T>, shadow: T): [T, T, T] {
  const ndl = o.max(dot3(o, n, lights.sunDir), o.lit(0));
  const w = o.add(o.mul(o.lit(0.5), dot3(o, n, lights.hemiDir)), o.lit(0.5));
  const e = (c: 0 | 1 | 2): T =>
    o.add(o.add(lights.ambient[c], o.mul(o.mul(lights.sunColor[c], ndl), shadow)), o.mix(lights.hemiGround[c], lights.hemiSky[c], w));
  return [e(0), e(1), e(2)];
}

/** The rim ratio's divide-by-zero floor (the legacy `max(rlIrradiance(n0, rlShadow), 1e-4)`). */
export const CRATER_RIM_IRRADIANCE_FLOOR = 1e-4;

/**
 * GH-943 P3 (T7): the crater rim's light ratio, the legacy material's rim block: the height gradient `grad` (in crater radii per
 * offset unit) scaled to world units by `halfLength` and by the gain, bump-mapped onto the facet (surface-gradient form), and the
 * bumped normal's irradiance over the facet's, both under the SAME shadow, so a rim in a building's shadow catches nothing.
 */
export function decalRimRatioOps<T>(
  o: Ops<T>,
  grad: { readonly hs: T; readonly ht: T },
  halfLength: T,
  gain: T,
  facet: DecalRimFacet<T>,
  lights: DecalRimLights<T>,
  shadow: T
): [T, T, T] {
  const gs = o.mul(o.mul(grad.hs, halfLength), gain);
  const gt = o.mul(o.mul(grad.ht, halfLength), gain);
  const dhx = o.add(o.mul(gs, facet.dstx[0]), o.mul(gt, facet.dstx[1]));
  const dhy = o.add(o.mul(gs, facet.dsty[0]), o.mul(gt, facet.dsty[1]));
  const raw = normalize3(o, cross3(o, facet.dpx, facet.dpy));
  const flip = o.selectLt(raw[2], o.lit(0), o.lit(-1), o.lit(1));
  const n0: V3<T> = [o.mul(raw[0], flip), o.mul(raw[1], flip), o.mul(raw[2], flip)];
  const r1 = cross3(o, facet.dpy, n0);
  const r2 = cross3(o, n0, facet.dpx);
  const det = dot3(o, facet.dpx, r1);
  const sg = o.sign(det);
  const ad = o.abs(det);
  const bumped = (c: 0 | 1 | 2): T => o.sub(o.mul(ad, n0[c]), o.mul(sg, o.add(o.mul(dhx, r1[c]), o.mul(dhy, r2[c]))));
  const n1 = normalize3(o, [bumped(0), bumped(1), bumped(2)]);
  const i1 = decalIrradianceOps(o, n1, lights, shadow);
  const i0 = decalIrradianceOps(o, n0, lights, shadow);
  const floor = o.lit(CRATER_RIM_IRRADIANCE_FLOOR);
  return [o.div(i1[0], o.max(i0[0], floor)), o.div(i1[1], o.max(i0[1], floor)), o.div(i1[2], o.max(i0[2], floor))];
}

/**
 * GH-943 P3 (T7): the decal's output ratio, `base` (the albedo ratio) times the rim ratio `rim` on a crater whose rim gain is on,
 * `base` itself on every other fragment (the legacy `if (kind == crater && uRimGain > 0.0) outRatio *= ...`), as one select. Per
 * component, like `decalMultiplierOps` (the twin passes whole vec3 nodes, so the rim is evaluated once, on a rim fragment only).
 */
export function decalOutRatioOps<T>(o: Ops<T>, kind: T, gain: T, base: T, rim: T): T {
  const on = o.mul(kindIs(o, kind, DECAL_KIND_INDEX.crater), o.selectLt(o.lit(0), gain, o.lit(1), o.lit(0)));
  return o.selectLt(o.lit(0.5), on, o.mul(base, rim), base);
}

/** Water stands in a crater's bowl where the height is below this (radii). With
 *  the shipped bowl depth 0.25 that is the inner ~72% of the lip's inner radius. */
export const CRATER_WATER_LEVEL = -0.12;
/** Half the width of the shoreline's ramp, in height units. */
export const CRATER_WATER_EDGE = 0.02;
/** The water's opacity where it fully covers (the multiply ratio mixes toward it). */
export const CRATER_WATER_ALPHA = 0.9;

/** The share of a crater fragment the water covers, from its height. */
export function craterWaterCover(h: number): number {
  return 1 - smoothstep(CRATER_WATER_LEVEL - CRATER_WATER_EDGE, CRATER_WATER_LEVEL + CRATER_WATER_EDGE, h);
}

/**
 * A crater fragment's sample with the water laid over it (`DECAL_WET`): the
 * dry sample's colour and opacity mixed toward the water surface by the cover.
 * `ground` is the tone under the decal and `sky` is `uWetSky`; the surface is
 * the ground's own, `(1 - reflect) * WATER_ALBEDO * ground + reflect * sky` per
 * channel (`terrain/wet-shading.ts`'s `waterAlbedo`, which the oracle test
 * compares against), at the SAME reflectance the puddles use.
 */
export function craterWaterSample(
  dryAlpha: number,
  dryColour: readonly [number, number, number],
  cover: number,
  ground: readonly [number, number, number],
  reflect: number,
  sky: readonly [number, number, number],
  waterAlbedo: number
): { alpha: number; colour: [number, number, number] } {
  const w = (c: number): number => (1 - reflect) * waterAlbedo * ground[c] + reflect * sky[c];
  const m = (c: number): number => dryColour[c] + cover * (w(c) - dryColour[c]);
  return { alpha: dryAlpha + cover * (CRATER_WATER_ALPHA - dryAlpha), colour: [m(0), m(1), m(2)] };
}

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

/** `r(1 + amp sin(lobes θ + 2π seed))`, with θ taken as 0 at the centre --
 *  GLSL's `atan(0, 0)` is undefined, and `r = 0` there anyway. */
function wobbledRadiusOps<T>(o: Ops<T>, s: T, t: T, seed: T, amp: number, lobes: number): T {
  const r = o.length2(s, t);
  const theta = o.selectLt(o.lit(0), r, o.atan2(t, s), o.lit(0));
  return o.mul(r, o.add(o.lit(1), o.mul(o.lit(amp), o.sin(o.add(o.mul(o.lit(lobes), theta), o.mul(o.lit(2 * Math.PI), seed))))));
}

/** 1 where the decoded kind index `kind` is `index`, else 0 (the kind is an integer carried in a float). */
function kindIs<T>(o: Ops<T>, kind: T, index: number): T {
  return o.selectLt(o.abs(o.sub(kind, o.lit(index))), o.lit(0.5), o.lit(1), o.lit(0));
}

/** `flag` (0 or 1) ? `x` : `y`. */
function pick<T>(o: Ops<T>, flag: T, x: T, y: T): T {
  return o.selectLt(o.lit(0.5), flag, x, y);
}

/** The kind index carried in `aDecal.x`, decoded as the legacy material does (`int(vDecal.x + 0.5)`; the index is never negative). */
export function decalKindOps<T>(o: Ops<T>, raw: T): T {
  return o.floor(o.add(raw, o.lit(0.5)));
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
  const d = decalAlphaOps(NUMBER_OPS, NUMBER_INT_OPS, DECAL_KIND_INDEX[kind], s, t, seed, ageSec, halfLength);
  return { alpha: d.alpha, colour: d.colour };
}

/**
 * GH-943 P3 (T7): `decalAlpha`, written ONCE against `Ops<T>` and `IntOps<T>` (the rubble lattice hash is `tileHashOps`, read as
 * its top 24 bits, the legacy material's `rlHash`): `decalAlpha` is it on numbers, and the node twin builds it as a graph. `kind`
 * is the decoded `DECAL_KIND_INDEX` (`decalKindOps`). BRANCH-FREE: every kind's opacity and colour index is evaluated and the
 * kind's own is selected, so the twin's graph has no kind branch at all; a kind outside the table reads opacity 0 (the legacy
 * `a = 0.0`, then its discard).
 */
export function decalAlphaOps<T>(
  o: Ops<T>,
  io: IntOps<T>,
  kind: T,
  s: T,
  t: T,
  seed: T,
  ageSec: T,
  halfLength: T
): { readonly alpha: T; readonly colour: T } {
  const one = o.lit(1);
  const L = (n: number): T => o.lit(n);
  const inv = (x: T): T => o.sub(one, x);
  const age = o.max(ageSec, L(0));

  // crater
  const rwCrater = wobbledRadiusOps(o, s, t, seed, CRATER_WOBBLE, CRATER_LOBES);
  const bowl = o.mul(L(CRATER_BOWL_ALPHA), inv(o.smoothstep(L(CRATER_BOWL_EDGE0), L(CRATER_BOWL_EDGE1), rwCrater)));
  const lip = o.mul(
    o.mul(L(CRATER_LIP_ALPHA), o.smoothstep(L(CRATER_LIP_IN0), L(CRATER_LIP_IN1), rwCrater)),
    inv(o.smoothstep(L(CRATER_LIP_OUT0), L(CRATER_LIP_OUT1), rwCrater))
  );
  const craterA = o.selectLt(bowl, lip, lip, bowl);
  const craterC = o.selectLt(bowl, lip, L(COLOUR_CRATER_LIP), L(COLOUR_CRATER_BOWL));

  // scorch
  const scorchA = o.mul(L(SCORCH_ALPHA), inv(o.smoothstep(L(SCORCH_EDGE_INNER), one, o.length2(s, t))));

  // oil
  const rwOil = wobbledRadiusOps(o, s, t, seed, OIL_WOBBLE, OIL_LOBES);
  const oilA = o.mul(L(OIL_ALPHA), inv(o.smoothstep(L(OIL_EDGE_INNER), one, rwOil)));

  // rubble: tiles from the centre, turned by the seed, in cell units
  const th = o.mul(L(2 * Math.PI), seed);
  const px = o.div(o.mul(s, halfLength), L(RUBBLE_CELL_TILES));
  const pz = o.div(o.mul(t, halfLength), L(RUBBLE_CELL_TILES));
  const qx = o.sub(o.mul(o.cos(th), px), o.mul(o.sin(th), pz));
  const qz = o.add(o.mul(o.sin(th), px), o.mul(o.cos(th), pz));
  const cx = o.floor(qx);
  const cz = o.floor(qz);
  const ix = o.add(cx, L(RUBBLE_CELL_OFFSET));
  const iz = o.add(o.add(cz, L(RUBBLE_CELL_OFFSET)), o.floor(o.mul(L(RUBBLE_SEED_SCALE), seed)));
  const hash = (a: T, b: T): T => io.toFloat01(tileHashOps(io, a, b));
  const h = hash(ix, iz);
  const jx = o.add(L(0.5), o.mul(L(RUBBLE_JITTER), o.sub(hash(o.add(ix, L(RUBBLE_JITTER_SALT)), iz), L(0.5))));
  const jz = o.add(L(0.5), o.mul(L(RUBBLE_JITTER), o.sub(hash(ix, o.add(iz, L(RUBBLE_JITTER_SALT))), L(0.5))));
  const rc = o.div(o.mul(o.length2(o.add(cx, jx), o.add(cz, jz)), L(RUBBLE_CELL_TILES)), o.max(halfLength, L(1e-6)));
  const chip = o.selectLt(h, o.mul(L(RUBBLE_DENSITY), inv(o.smoothstep(L(RUBBLE_EDGE_INNER), one, rc))), one, L(0));
  const size = o.add(L(RUBBLE_CHIP_SIZE_MIN), o.mul(L(1 - RUBBLE_CHIP_SIZE_MIN), o.fract(o.mul(L(RUBBLE_SIZE_SCALE), h))));
  const disc = inv(
    o.smoothstep(
      o.mul(L(RUBBLE_CHIP_R0), size),
      o.mul(L(RUBBLE_CHIP_R1), size),
      o.length2(o.sub(o.sub(qx, cx), jx), o.sub(o.sub(qz, cz), jz))
    )
  );
  const rubbleA = o.mul(o.mul(L(RUBBLE_ALPHA), chip), disc);
  const rubbleC = o.selectLt(o.fract(o.mul(L(RUBBLE_TONE_SCALE), h)), L(0.5), L(COLOUR_RUBBLE_A), L(COLOUR_RUBBLE_B));

  // tread / tyre
  const isTread = kindIs(o, kind, DECAL_KIND_INDEX.tread);
  const u = o.mul(s, halfLength);
  const feather = o.clamp01(o.div(o.sub(halfLength, o.abs(u)), L(TRACK_FEATHER_TILES)));
  const side = inv(o.smoothstep(L(TRACK_SIDE_INNER), one, o.abs(t)));
  const trackFade = o.clamp01(o.sub(one, o.div(age, L(TRACK_FADE_SEC))));
  const cleat = o.add(L(TREAD_PATTERN_BASE), o.mul(L(TREAD_PATTERN_CLEAT), o.step(L(0.5), o.fract(o.div(u, L(TREAD_PERIOD_TILES))))));
  const pattern = pick(o, isTread, cleat, one);
  const trackA = o.mul(o.mul(o.mul(o.mul(L(TRACK_ALPHA), feather), side), trackFade), pattern);
  const trackC = pick(o, isTread, L(COLOUR_TREAD), L(COLOUR_TYRE));

  // churn
  const rwChurn = wobbledRadiusOps(o, s, t, seed, CHURN_WOBBLE, CHURN_LOBES);
  const body = inv(o.smoothstep(L(CHURN_EDGE_INNER), one, rwChurn));
  const r = o.length2(s, t);
  const theta = o.selectLt(L(0), r, o.atan2(t, s), L(0));
  const raked = o.step(L(0.5), o.fract(o.add(o.mul(o.div(theta, L(2 * Math.PI)), L(CHURN_SPOKES)), seed)));
  const spoke = o.add(L(CHURN_SPOKE_BASE), o.mul(L(1 - CHURN_SPOKE_BASE), raked));
  const core = o.smoothstep(L(0), L(CHURN_SPOKE_CORE), r);
  const churnFade = o.clamp01(o.sub(one, o.div(age, L(CHURN_FADE_SEC))));
  const churnA = o.mul(o.mul(o.mul(L(CHURN_ALPHA), body), o.add(one, o.mul(o.sub(spoke, one), core))), churnFade);

  // scuff (GH-1207): one clean fading disc, no wobble and no spokes.
  const scuffFade = o.clamp01(o.sub(one, o.div(age, L(SCUFF_FADE_SEC))));
  const scuffA = o.mul(o.mul(L(SCUFF_ALPHA), inv(o.smoothstep(L(SCUFF_EDGE_INNER), one, o.length2(s, t)))), scuffFade);

  // the kind's own
  const isTrack = o.add(isTread, kindIs(o, kind, DECAL_KIND_INDEX.tyre));
  const sel = (crater: T, scorch: T, oil: T, rubble: T, track: T, churn: T, scuff: T, none: T): T =>
    pick(o, kindIs(o, kind, DECAL_KIND_INDEX.crater), crater,
      pick(o, kindIs(o, kind, DECAL_KIND_INDEX.scorch), scorch,
        pick(o, kindIs(o, kind, DECAL_KIND_INDEX.oil), oil,
          pick(o, kindIs(o, kind, DECAL_KIND_INDEX.rubble), rubble,
            pick(o, isTrack, track,
              pick(o, kindIs(o, kind, DECAL_KIND_INDEX.churn), churn,
                pick(o, kindIs(o, kind, DECAL_KIND_INDEX.scuff), scuff, none)))))));
  return {
    alpha: sel(craterA, scorchA, oilA, rubbleA, trackA, churnA, scuffA, L(0)),
    colour: sel(craterC, L(COLOUR_SCORCH), L(COLOUR_OIL), rubbleC, trackC, L(COLOUR_TREAD), L(COLOUR_TREAD), L(0)),
  };
}
