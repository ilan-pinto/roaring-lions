/**
 * Task 10 of `docs/superpowers/plans/2026-09-25-ground-plan-1.md`: the core
 * of the shared decal pool (spec §3.3, `docs/superpowers/specs/
 * 2026-09-25-ground-design.md`) -- a ring buffer, a grid of vertices that
 * conforms to the terrain surface underneath it, and a clock that reads sim
 * time rather than frame time. The kind shader (crater/scorch/oil/rubble/
 * tread/tyre alpha and colour) is Task 11, deliberately not here -- this
 * module's material is whatever the caller hands it (see `DecalPool`'s own
 * doc comment), and `decalAlpha`/`createDecalMaterial` do not exist yet.
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
 */
import * as THREE from 'three';
import { STAMP_SPACING_TILES } from './vehicle-tracks';
import { MARK_EPSILON } from './terrain/shared';

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
 * grid: `gridTriangles(n) * 3` indices, offset so slot `k`'s vertices
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
 * `y = (isTerrace(x, z) ? sampleY(cx, cz) : sampleY(x, z)) + MARK_EPSILON`
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
  for (let j = 0; j < n; j++) {
    const t = -1 + (2 * j) / (n - 1);
    for (let i = 0; i < n; i++) {
      const s = -1 + (2 * i) / (n - 1);
      const x = p.cx + s * p.halfLength * cosF - t * p.halfWidth * sinF;
      const z = p.cz + s * p.halfLength * sinF + t * p.halfWidth * cosF;
      const y = (isTerrace(x, z) ? sampleY(p.cx, p.cz) : sampleY(x, z)) + MARK_EPSILON;
      const vBase = base + (j * n + i) * 3;
      out[vBase] = x;
      out[vBase + 1] = y;
      out[vBase + 2] = z;
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

    // STATIC index: a decal's grid topology never changes, only its vertex
    // data does.
    const indices = new Uint32Array(capacity * this.trisPerDecal * 3);
    for (let slot = 0; slot < capacity; slot++) {
      writeGridIndices(indices, slot, grid);
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
   * beyond what that function already does (`+ MARK_EPSILON`).
   */
  stamp(
    s: DecalStamp,
    sampleY: (x: number, z: number) => number,
    isTerrace: (x: number, z: number) => boolean
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

    this.mesh.geometry.setDrawRange(0, this.writtenCount * this.trisPerDecal * 3);
  }

  /** Geometry only -- the material is shared (Task 11's one `ShaderMaterial`
   *  for both pools) and owned by the caller, exactly as `DecalPool`'s own
   *  top comment says. */
  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
