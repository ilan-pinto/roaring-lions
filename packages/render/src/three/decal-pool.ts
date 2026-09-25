/**
 * Task 10 of `docs/superpowers/plans/2026-09-25-ground-plan-1.md`: the core
 * of the shared decal pool (spec §3.3, `docs/superpowers/specs/
 * 2026-09-25-ground-design.md`) -- a ring buffer, a grid of vertices that
 * conforms to the terrain surface underneath it, and a clock that reads sim
 * time rather than frame time. Task 11 added the kind shader:
 * `createDecalMaterial` is `decal-maths.ts`'s `decalAlpha` (the pure mirror,
 * one formula per kind, spec §5), transcribed to GLSL with every constant
 * interpolated from the same TypeScript names (`glslFloat`), so the two
 * cannot drift by a retyped literal -- see "The kind shader" below.
 * `DecalPool` still takes its material from the caller (see its own doc
 * comment) -- one material, two pools.
 *
 * F-27 split this file in two: `decal-maths.ts` holds everything pure --
 * kinds, the sim-time clock, the conforming-grid maths, the size curves and
 * `decalAlpha` itself, with no `THREE.*` import -- tidiness rather than a
 * requirement, since `three` loads under node anyway. This file re-exports all of
 * it (`export * from './decal-maths'`) and adds the GPU half: `DecalPool`
 * (the ring-buffer `THREE.Mesh`) and `createDecalMaterial` (the shader).
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
 * either number, so the same class serves both pools. See `decal-maths.ts`
 * for `gridTriangles`/`PERSISTENT_GRID`/`FADING_GRID` themselves.
 *
 * ## The sim-time clock (R-14)
 *
 * See `decal-maths.ts`'s own "The sim-time clock (R-14)" for the full
 * derivation of `presentationSimMs`/`stampSimMs`. A decal's age in seconds,
 * at any frame, is `(presentationSimMs(tickCount, alpha) - stamp.simMs) /
 * 1000` -- `decalAlpha` and `createDecalMaterial` below are the only
 * consumers, and they take that division as an input rather than doing it,
 * so neither module commits to how a caller stores or subtracts the two.
 *
 * ## The conforming grid
 *
 * See `decal-maths.ts`'s own "The conforming grid" for `writeDecalGrid`'s
 * full account, including R-19's terrace rule and the sag lift (F-23).
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
 * seconds, and its `halfLength` -- no texture. `decal-maths.ts`'s
 * `decalAlpha` is written first and tested there; `DECAL_FRAGMENT_SHADER`
 * below is the same arithmetic line for line, and every number in it is
 * interpolated from a named constant imported from that module (`glslFloat`),
 * never retyped. `decal-pool.test.ts` checks the load-bearing constants
 * appear in the compiled string.
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
 *   it. The single output line now writes `decalMultiplier` (`decal-maths
 *   .ts`): the kind's tone over the ground tone UNDER THAT DECAL (captured
 *   at the stamp, per decal -- fix round 2), mixed toward 1 by alpha, and
 *   the material multiplies it onto the ground AFTER lighting and shadow.
 *   The scene target is HalfFloat, so a ratio above 1 (a pale lip) survives.
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
import { hexToLinear } from './terrain/shared';
import { ROAD_DISTANCE_RANGE_TILES } from './terrain/control-map';
import { ROAD_EDGE_BEND, ROAD_EDGE_FALLOFF, ROAD_HALF_WIDTH, SHOULDER_ALPHA, SHOULDER_TILES } from './terrain/road-graph';
import { defaultControlB } from './terrain/mesh';
import {
  CRATER_BOWL_ALPHA,
  CRATER_BOWL_EDGE0,
  CRATER_BOWL_EDGE1,
  CRATER_LIP_ALPHA,
  CRATER_LIP_IN0,
  CRATER_LIP_IN1,
  CRATER_LIP_OUT0,
  CRATER_LIP_OUT1,
  CRATER_LOBES,
  CRATER_WOBBLE,
  COLOUR_CRATER_BOWL,
  COLOUR_CRATER_LIP,
  COLOUR_OIL,
  COLOUR_RUBBLE_A,
  COLOUR_RUBBLE_B,
  COLOUR_SCORCH,
  COLOUR_TREAD,
  COLOUR_TYRE,
  DECAL_GROUND_FLOOR,
  DECAL_KIND_INDEX,
  DECAL_PALETTE_ORDER,
  gridTriangles,
  OIL_ALPHA,
  OIL_EDGE_INNER,
  OIL_LOBES,
  OIL_WOBBLE,
  RUBBLE_ALPHA,
  RUBBLE_CELL_OFFSET,
  RUBBLE_CELL_TILES,
  RUBBLE_CHIP_R0,
  RUBBLE_CHIP_R1,
  RUBBLE_CHIP_SIZE_MIN,
  RUBBLE_DENSITY,
  RUBBLE_EDGE_INNER,
  RUBBLE_JITTER,
  RUBBLE_JITTER_SALT,
  RUBBLE_SEED_SCALE,
  RUBBLE_SIZE_SCALE,
  RUBBLE_TONE_SCALE,
  SCORCH_ALPHA,
  SCORCH_EDGE_INNER,
  TILE_HASH_MIX,
  TILE_HASH_MX,
  TILE_HASH_MY,
  TILE_HASH_SHIFT_A,
  TILE_HASH_SHIFT_B,
  TRACK_ALPHA,
  TRACK_FADE_SEC,
  TRACK_FEATHER_TILES,
  TRACK_SIDE_INNER,
  TREAD_PATTERN_BASE,
  TREAD_PATTERN_CLEAT,
  TREAD_PERIOD_TILES,
  writeDecalGrid,
  writeDecalOffsets,
  writeGridIndices,
  type DecalPalette,
  type DecalStamp,
} from './decal-maths';

export * from './decal-maths';

// ---------------------------------------------------------------------------
// GPU-facing: THREE.* construction. Constructed and inspected under
// `environment: 'node'` with no real `WebGLRenderer`, same as
// `scorch-decals.test.ts`'s own GPU half.
// ---------------------------------------------------------------------------

/**
 * A capacity-bounded ring buffer of conforming decal grids, one non-indexed
 * -- no, one INDEXED -- `THREE.Mesh`, one draw call per pool: a generic ring
 * buffer over an arbitrary `grid` size and a caller-supplied kind/seed/date
 * per stamp, instead of one fixed shape and one fixed material (the shape
 * the retired `scorch-decals.ts`/`vehicle-tracks.ts` meshes each shipped
 * their own one-off copy of, before this pool generalised both).
 *
 * The pure geometry helpers above (`writeGridIndices`, `writeDecalGrid`,
 * `writeDecalOffsets`) are called once per slot for the STATIC parts
 * (index, `aOffset`) at construction, and per stamp for the DYNAMIC parts
 * (`position`, `aDecal`) -- the same position/offset split those two retired
 * meshes already established, generalised to an `n x n` grid instead of two
 * fixed triangles.
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
/** Flags one ring slot's vertices of `attr` for upload -- see `stamp`. */
function markSlot(attr: THREE.BufferAttribute, slot: number, verticesPerSlot: number): void {
  attr.addUpdateRange(slot * verticesPerSlot * attr.itemSize, verticesPerSlot * attr.itemSize);
  attr.needsUpdate = true;
}

export class DecalPool {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly decalAttr: THREE.BufferAttribute;
  private readonly groundAttr: THREE.BufferAttribute;
  private readonly capacityValue: number;
  private readonly gridValue: number;
  private readonly trisPerDecal: number;
  private writeCursor = 0;
  /** `min(total stamps ever made, capacity)` -- the ring buffer's own "never
   *  grows past capacity" guarantee, read back. */
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
    // data does. 16-bit where every vertex index fits (M-1): both shipped
    // pools hold exactly 16,384 vertices, so neither needs 32.
    const indexCount = capacity * this.trisPerDecal * 3;
    const indices =
      capacity * verticesPerDecal <= 65536 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
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
    // so this mesh spans the whole map like every other whole-map mark in
    // this backend.
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
   * wraparound every ring-buffer mark in this backend uses.
   * `sampleY` is threaded straight through to `writeDecalGrid` (the smooth
   * field, fix wave I-4); this method adds nothing to the height it returns
   * beyond what that function already does. `ground` is the tile's own
   * linear palette tone at the decal's centre, with no road in it
   * (`terrain/decal-ground-tone.ts`, `decalBaseTone`): the shader mixes the
   * road and shoulder in per fragment (fix wave I-3).
   *
   * Uploads only this slot (M-1): each attribute gets an update RANGE over
   * the slot's own vertices, so a stamp moves `n * n` vertices' worth of
   * bytes rather than the whole pool's 0.4-0.5 MiB -- which the fading pool
   * used to do almost every frame while vehicles move.
   */
  stamp(s: DecalStamp, sampleY: (x: number, z: number) => number, ground: readonly [number, number, number]): void {
    const slot = this.writeCursor;
    this.writeCursor = (this.writeCursor + 1) % this.capacityValue;
    this.writtenCount = Math.min(this.writtenCount + 1, this.capacityValue);
    const n = this.gridValue;

    writeDecalGrid(
      this.positionAttr.array as Float32Array,
      slot,
      n,
      { cx: s.x, cz: s.z, halfLength: s.halfLength, halfWidth: s.halfWidth, facingRad: s.facingRad },
      sampleY
    );
    markSlot(this.positionAttr, slot, n * n);

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
    markSlot(this.decalAttr, slot, n * n);

    const groundArray = this.groundAttr.array as Float32Array;
    const gBase = slot * n * n * 3;
    for (let v = 0; v < n * n; v++) {
      groundArray[gBase + v * 3] = ground[0];
      groundArray[gBase + v * 3 + 1] = ground[1];
      groundArray[gBase + v * 3 + 2] = ground[2];
    }
    markSlot(this.groundAttr, slot, n * n);

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
  // Where this fragment sits on the map, in tiles: what control B and the
  // map-edge discard are indexed by (fix wave I-3, I-4).
  varying vec2 vWorldXZ;
  // flat: kind, seed, date and half-length are per-decal constants -- no
  // interpolation, so floor(1000 seed) and the kind branch see the exact
  // value the pool wrote.
  flat varying vec4 vDecal;
  // flat: the tile's own palette tone under the decal, one per decal, with
  // no road in it -- the road is mixed in per fragment (fix wave I-3).
  flat varying vec3 vGround;
  void main() {
    vOffset = aOffset;
    vDecal = aDecal;
    vGround = aGround;
    vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const f = glslFloat;

/** `decalAlpha`, transcribed. Keep the two in step line for line. */
const DECAL_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColors[${DECAL_PALETTE_ORDER.length}];
  uniform float uNowSec;
  // The ground's own road inputs, SHARED uniform objects (fix wave I-3):
  // control B, the map size, the two road tones and the roads toggle, so a
  // rebuilt control map or a hidden road reaches the decals too.
  uniform sampler2D uControlB;
  uniform vec2 uMapSize;
  uniform vec3 uRoadTone;
  uniform vec3 uShoulderTone;
  uniform float uRoadOn;
  varying vec2 vOffset;
  varying vec2 vWorldXZ;
  flat varying vec4 vDecal;
  flat varying vec3 vGround;

  // tileHash (packages/render/src/tile-hash.ts) in uint arithmetic -- see
  // decal-pool.ts's top comment. Inputs are non-negative by construction.
  float rlHash(int xi, int yi) {
    uint h = uint(xi) * ${TILE_HASH_MX}u + uint(yi) * ${TILE_HASH_MY}u;
    h = (h ^ (h >> ${TILE_HASH_SHIFT_A}u)) * ${TILE_HASH_MIX}u;
    h = h ^ (h >> ${TILE_HASH_SHIFT_B}u);
    // Top 24 bits: exact in a float, and never rounds up to 1.0.
    return float(h >> 8u) / 16777216.0;
  }

  float wobbledRadius(vec2 st, float seed, float amp, float lobes) {
    float r = length(st);
    float theta = r > 0.0 ? atan(st.y, st.x) : 0.0;
    return r * (1.0 + amp * sin(lobes * theta + ${f(2 * Math.PI)} * seed));
  }

  void main() {
    // Fetched before any discard, so its implicit gradient is taken in
    // uniform control flow -- the same LOD the ground's own tap picks.
    vec4 rlB = texture2D(uControlB, vWorldXZ / uMapSize);
    // Nothing hangs past the map edge over the skirt (fix wave I-4).
    if (vWorldXZ.x < 0.0 || vWorldXZ.y < 0.0 || vWorldXZ.x > uMapSize.x || vWorldXZ.y > uMapSize.y) discard;

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
      // Chips on a seed-turned lattice of RUBBLE_CELL_TILES cells (I-5).
      float th = ${f(2 * Math.PI)} * seed;
      vec2 p = vOffset * halfLength / ${f(RUBBLE_CELL_TILES)};
      vec2 q = vec2(cos(th) * p.x - sin(th) * p.y, sin(th) * p.x + cos(th) * p.y);
      vec2 cell = floor(q);
      int ix = int(cell.x) + ${RUBBLE_CELL_OFFSET};
      int iz = int(cell.y) + ${RUBBLE_CELL_OFFSET} + int(floor(${f(RUBBLE_SEED_SCALE)} * seed));
      float h = rlHash(ix, iz);
      vec2 jit = vec2(0.5) + ${f(RUBBLE_JITTER)} * (vec2(rlHash(ix + ${RUBBLE_JITTER_SALT}, iz), rlHash(ix, iz + ${RUBBLE_JITTER_SALT})) - 0.5);
      float rc = length(cell + jit) * ${f(RUBBLE_CELL_TILES)} / max(halfLength, 0.000001);
      float chip = 1.0 - step(${f(RUBBLE_DENSITY)} * (1.0 - smoothstep(${f(RUBBLE_EDGE_INNER)}, 1.0, rc)), h);
      float size = ${f(RUBBLE_CHIP_SIZE_MIN)} + ${f(1 - RUBBLE_CHIP_SIZE_MIN)} * fract(${f(RUBBLE_SIZE_SCALE)} * h);
      float disc = 1.0 - smoothstep(${f(RUBBLE_CHIP_R0)} * size, ${f(RUBBLE_CHIP_R1)} * size, length(q - cell - jit));
      a = ${f(RUBBLE_ALPHA)} * chip * disc;
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
    // The ground tone under THIS fragment (fix wave I-3): the decal's own
    // tile tone, with the road surface and its shoulder mixed in exactly as
    // GroundMaterial mixes them, from the same control B texel -- road-graph
    // roadProfile's surface and shoulder, transcribed (decalRoadMix is the
    // TypeScript mirror). A crater lip on a road's shoulder divides by the
    // shoulder, not by the road at the crater's centre.
    float rlRoadE = rlB.g * ${ROAD_DISTANCE_RANGE_TILES.toFixed(3)} + ${ROAD_EDGE_BEND.toFixed(3)} * (rlB.a * 2.0 - 1.0);
    float rlRoadH0 = (${ROAD_HALF_WIDTH.toFixed(3)} - 0.5 * ${ROAD_EDGE_FALLOFF.toFixed(3)});
    float rlRoadH1 = (${ROAD_HALF_WIDTH.toFixed(3)} + 0.5 * ${ROAD_EDGE_FALLOFF.toFixed(3)});
    float rlRoadEdge = smoothstep(rlRoadH0, rlRoadH1, rlRoadE);
    float rlRoadSurf = uRoadOn * (1.0 - rlRoadEdge);
    float rlShoulder = uRoadOn * ${SHOULDER_ALPHA.toFixed(3)} * rlRoadEdge
      * (1.0 - smoothstep(rlRoadH1, rlRoadH1 + ${SHOULDER_TILES.toFixed(3)}, rlRoadE));
    vec3 ground = mix(mix(vGround, uRoadTone, rlRoadSurf), uShoulderTone, rlShoulder);
    // F-22 (fix round 1): the ONE point where colour becomes output --
    // \`decalMultiplier\`, transcribed. An albedo ratio over that ground,
    // multiplied onto the LIT ground by the blend state, so a lip in shade
    // stays in shade. Alpha is unused by the blend.
    vec3 ratio = colour / max(ground, ${f(DECAL_GROUND_FLOOR)});
    gl_FragColor = vec4(1.0 + a * (ratio - 1.0), 1.0);
  }
`;

/**
 * The ground uniforms the decal shader reads the road from (fix wave I-3).
 * `ThreeRenderer` hands in `GroundMaterial`'s OWN uniform objects, not
 * copies, so a rebuilt control map (`uControlB.value`), the palette's road
 * tones and the `roads` debug toggle (`uRoadOn`) reach both materials with
 * one write. Omitted, the decals get the 1x1 "no road in range" control B
 * and draw every mark over its own tile tone.
 */
export interface DecalGroundUniforms {
  readonly uControlB: THREE.IUniform;
  readonly uMapSize: THREE.IUniform;
  readonly uRoadTone: THREE.IUniform;
  readonly uShoulderTone: THREE.IUniform;
  readonly uRoadOn: THREE.IUniform;
}

/**
 * The one material both decal pools share (see `DecalPool`'s top comment):
 * the kind shader above, `uColors[8]` from `palette` in
 * `DECAL_PALETTE_ORDER` (linear, via `hexToLinear`), and `uNowSec`, the
 * SIM clock in seconds, starting at 0 -- the renderer sets it every frame
 * from `presentationSimMs(tickCount, alpha) / 1000`, never from a frame
 * timestamp. The denominator of `decalMultiplier`'s albedo ratio is built
 * per fragment: each decal carries its own TILE tone (`aGround`, written by
 * `DecalPool.stamp`), and the road and shoulder are mixed in from the
 * ground's own control B through `ground`'s shared uniforms (fix wave I-3).
 * Multiply-blended onto the
 * lit ground (F-22, fix round 1), depth-tested, not depth-writing, with
 * F-23's polygon offset; `DoubleSide` for the same reason every other flat
 * decal material in this backend carries it -- no lighting term depends on
 * the winding, so the winding is not a risk worth carrying.
 */
export function createDecalMaterial(palette: DecalPalette, ground?: DecalGroundUniforms): THREE.ShaderMaterial {
  const colours = DECAL_PALETTE_ORDER.map((key) => {
    const [r, g, b] = hexToLinear(palette[key]);
    return new THREE.Vector3(r, g, b);
  });
  const road: DecalGroundUniforms = ground ?? {
    uControlB: { value: defaultControlB() },
    uMapSize: { value: new THREE.Vector2(1, 1) },
    uRoadTone: { value: new THREE.Vector3(1, 1, 1) },
    uShoulderTone: { value: new THREE.Vector3(1, 1, 1) },
    uRoadOn: { value: 1 },
  };
  return new THREE.ShaderMaterial({
    uniforms: {
      uColors: { value: colours },
      uNowSec: { value: 0 },
      uControlB: road.uControlB,
      uMapSize: road.uMapSize,
      uRoadTone: road.uRoadTone,
      uShoulderTone: road.uShoulderTone,
      uRoadOn: road.uRoadOn,
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
