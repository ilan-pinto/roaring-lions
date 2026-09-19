/**
 * The scorch mark a vehicle kill or a mortar/rocket impact leaves on the
 * ground -- permanent for the mission, unlike every other blast layer in
 * this package (the fireball, the twenty-second smoke column: both fade,
 * this does not). R-N
 * (`docs/superpowers/specs/2026-09-19-art-blast-design.md`): a
 * `vehicle-tracks.ts`-SHAPED one-off at capacity 256, not Phase 2's shared
 * decal pool (GH-30, "craters, scorch, rubble, tyre marks and oil, capped
 * like the track pool" -- still Open; this module does not seed it, and
 * generalising it into a shared pool is explicitly out of this package's
 * scope). `./vehicle-tracks.ts` is the proven pattern on this backend for
 * exactly the two properties a scorch mark needs: depth-tested world
 * geometry (fog of war dims it for free through `FogOfWarPass`'s own depth
 * read -- no separate `Sim.sideSeesTile`-style visibility query, see that
 * file's own "Fog" section), and a flat palette-colour `ShaderMaterial` with
 * no texture, so a scorch mark never opens `validate:assets` or
 * `validate:meshes`.
 *
 * 256 matches `MAX_MESH_WRECKS` (`units/mesh-death.ts:164`) deliberately: a
 * scorch and a wreck are one-to-one on a vehicle kill, so a scorch that
 * outlived its wreck's own eviction would be a mark with nothing under it.
 *
 * ## What is simpler than the sibling, and why
 *
 * Three things `vehicle-tracks.ts` needs that this module does not.
 *
 * **No facing.** A tread print is elongated along the direction of travel;
 * a scorch mark radiates from a point and reads as round either way, so the
 * quad is axis-aligned in world X/Z rather than rotated per stamp -- one
 * fewer thing this module has to get right. `side: THREE.DoubleSide` costs
 * nothing to add for the identical reason the tracks carry it even without
 * a facing to get backwards: the material has no lighting term to depend on
 * winding either way.
 *
 * **No index buffer.** `VehicleTrackMesh` shares 4 vertices between two
 * triangles per quad through `tracerIndexBuffer`. This module writes 6
 * vertices per mark instead -- two independent triangles, no sharing -- so
 * the geometry carries no index at all; at this capacity (256 * 6 = 1,536
 * vertices total) the two vertices an index buffer would save per mark buy
 * nothing worth the extra bookkeeping.
 *
 * **No TTL.** A track fades after `TRACK_PERSIST_MS`; a scorch mark is
 * PERSISTENT for the whole mission -- so there is no `spawnMs`, no
 * `collapsed` array and no `update()` sweep. The only way a slot's content
 * ever changes is the ring buffer recycling it oldest-first once the pool
 * is full, the sibling's own "graceful degradation under heavy load" trade,
 * never a clock.
 *
 * ## Ground height is a parameter, not a sample
 *
 * `writeScorchVertices` takes an already-resolved `y`, unlike
 * `writeTrackMarkVertices`, which samples `groundWorldY` itself from an
 * `ElevationSource` plus the map's own width/height. `ScorchDecalMesh.stamp(x,
 * y, groundY, power)` mirrors that: the caller (Task 7, from `ThreeRenderer`,
 * which already holds `retained.elevation` and the map's own dimensions)
 * samples `groundWorldY(...)` once and hands the result in, rather than this
 * module re-deriving it from a second copy of the same lookup. `MARK_EPSILON`
 * -- the same lift every scatter/grove/trail mark in this backend uses to
 * avoid z-fighting the terrain quad directly beneath it -- is added by
 * `stamp()` before the pure function ever sees a height, so
 * `writeScorchVertices` itself writes exactly the `y` it is given, with
 * nothing added (pinned by "lies flat on the sampled ground height" in the
 * test file, which checks the epsilon-free value the pure function receives
 * directly).
 *
 * ## Radius scales by the square root of power
 *
 * A scorch mark is an AREA, not a length: a 0.3-power round that left 30% of
 * the full-power RADIUS would leave 9% of the full-power area and read as
 * nothing at all. `scorchRadiusTiles` therefore scales
 * `SCORCH_RADIUS_TILES_AT_FULL_POWER` by `sqrt(power)`, not `power` --
 * sublinear, so a weak round still leaves a mark a player can see, and zero
 * at zero power so a stamp with no power leaves no mark at all.
 *
 * ## Colour and render order
 *
 * Colour is a palette key resolved by the CALLER (Task 7 passes
 * `overlayColor('shadow.0', ...)`, per the design spec's own worked example)
 * -- this module only ever takes a resolved hex and linearises it
 * (`hexToLinear`, never `hexToUnit`: this is a live `ShaderMaterial` uniform,
 * and the composer's `OutputPass` encodes the whole frame to sRGB once at the
 * end, so an un-linearised hex would be encoded a second time and land
 * brighter than the palette entry authored -- `vehicle-tracks.ts`'s own
 * account). Render order is set explicitly to `WORLD_RENDER_ORDER`
 * (`units/render-order.ts`) rather than left at the default and rather than
 * `TRAIL_RENDER_ORDER` -- a scorch mark is world geometry, the same tier a
 * mesh building's opaque hull occupies, and NOT an FX band; setting it
 * explicitly here is what stops a later change from "fixing" it upward into
 * the FX tier, where it would paint over a unit standing on the ground it
 * scorched.
 *
 * ## Determinism (invariant 4)
 *
 * This module writes nothing back to `Sim` and reads no `Sim` state
 * directly -- every argument `stamp()` takes is a plain number the caller
 * already computed. Nothing it decides (which slot recycles, what a mark
 * looks like) can be read back by the sim in a way that could change a
 * combat outcome.
 */
import * as THREE from 'three';
import { hexToLinear, MARK_EPSILON } from './terrain/shared';
import { WORLD_RENDER_ORDER } from './units/render-order';

// ---------------------------------------------------------------------------
// Pure: radius curve and vertex geometry. No THREE.* below this line --
// mirrors vehicle-tracks.ts's own split, exercised directly with plain
// numbers in scorch-decals.test.ts.
// ---------------------------------------------------------------------------

/** Individual marks, not "vehicles killed" -- one-to-one with a mesh wreck,
 *  see this file's top comment for why 256 matches `MAX_MESH_WRECKS`. */
export const SCORCH_CAPACITY = 256;

/** Fixed alpha every scorch mark draws at -- a single flat value, no
 *  graduated fade, matching `TRACK_OPACITY`'s own shape. */
export const SCORCH_OPACITY = 0.45;

/** `scorchRadiusTiles(1)`'s result -- the mark a full-power detonation (a
 *  burning hull, not a weak mortar round) leaves. */
export const SCORCH_RADIUS_TILES_AT_FULL_POWER = 1.6;

/**
 * Radius in tiles for a stamp at the given `power` (0..1, the same scaling
 * term `blastLightSpec`/`blastShake` use). Sublinear -- see this file's top
 * comment, "Radius scales by the square root of power" -- and zero at zero
 * or negative power, so a powerless stamp leaves no mark rather than a
 * full-size one.
 */
export function scorchRadiusTiles(power: number): number {
  return power <= 0 ? 0 : SCORCH_RADIUS_TILES_AT_FULL_POWER * Math.sqrt(power);
}

/**
 * Writes one mark's 6 vertices (two independent triangles, no shared index
 * -- see this file's top comment, "No index buffer") into `out` at ring
 * `slot` (`out[slot*18 .. slot*18+17]`): a flat, axis-aligned square in
 * world X/Z centred on `(cx, cy)`, `radius` tiles to each edge, lying at
 * world height `y` exactly as given -- see this file's top comment, "Ground
 * height is a parameter, not a sample", for why this function adds nothing
 * to it.
 */
export function writeScorchVertices(
  out: Float32Array,
  slot: number,
  cx: number,
  cy: number,
  y: number,
  radius: number
): void {
  const x0 = cx - radius;
  const x1 = cx + radius;
  const z0 = cy - radius;
  const z1 = cy + radius;
  const base = slot * 18;
  // Two triangles, corners (x0,z0) (x1,z0) (x1,z1) (x0,z1) -- (0,1,2) and
  // (0,2,3), the same winding `pushPolygon`'s own `flip: false` fan uses at
  // 4 points. The material never reads winding (DoubleSide), so this is a
  // convention, not a hazard, unlike `trackMarkCorners`'s facing-dependent
  // corners.
  out[base] = x0;
  out[base + 1] = y;
  out[base + 2] = z0;
  out[base + 3] = x1;
  out[base + 4] = y;
  out[base + 5] = z0;
  out[base + 6] = x1;
  out[base + 7] = y;
  out[base + 8] = z1;
  out[base + 9] = x0;
  out[base + 10] = y;
  out[base + 11] = z0;
  out[base + 12] = x1;
  out[base + 13] = y;
  out[base + 14] = z1;
  out[base + 15] = x0;
  out[base + 16] = y;
  out[base + 17] = z1;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction
// (BufferGeometry, Mesh, ShaderMaterial). Constructed and inspected under
// `environment: 'node'` exactly like `vehicle-tracks.test.ts`'s own GPU half
// -- three.js accepts these buffers with no real `WebGLRenderer`; using them
// end to end needs one, which is the browser capture harness's job
// (`tools/src/perf/blast-captures.ts`), not this suite's.
// ---------------------------------------------------------------------------

/** Shadow ramp's darkest-but-one tone (`data/palette.json`'s `shadow.0`,
 *  `#23241F`) -- the same tone Task 7 resolves through
 *  `overlayColor('shadow.0', ...)`, kept here only as the fallback a caller
 *  that does not supply one gets, so `new ScorchDecalMesh()` with no colour
 *  argument still draws something on-palette rather than nothing. */
const DEFAULT_COLOR = '#23241F';

/**
 * Flat-shaded, single-uniform-colour, translucent DECAL material --
 * structurally `createTrackMaterial` (`vehicle-tracks.ts`) with this
 * module's own opacity constant. `uColor` is LINEAR (`hexToLinear`, never
 * `hexToUnit`) for the identical reason that file gives -- see this file's
 * top comment, "Colour and render order".
 */
export function createScorchMaterial(color: string): THREE.ShaderMaterial {
  const [r, g, b] = hexToLinear(color);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(r, g, b) },
      uOpacity: { value: SCORCH_OPACITY },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    // DoubleSide -- see this file's top comment, "What is simpler than the
    // sibling, and why": an axis-aligned quad has one fixed winding, but the
    // material carries no lighting term to depend on it either way, so
    // removing the "did I get the corner order right" risk costs nothing
    // real, the same trade `createTrackMaterial` makes.
    side: THREE.DoubleSide,
  });
}

/**
 * Every stamped (and not-yet-recycled) mark, one non-indexed `THREE.Mesh`,
 * one draw call -- structurally `VehicleTrackMesh` with no TTL (see this
 * file's top comment, "No TTL"). A mark is written ONCE, at `stamp()`, and
 * never moves again until ring-buffer wraparound overwrites it;
 * `positionAttr.needsUpdate` is therefore only set on a stamp, never per
 * frame, and the ring buffer itself is preallocated at construction -- a
 * mission-length battle stamping hundreds of scorch marks allocates nothing
 * per stamp beyond what `stamp()`'s own local `radius` needs.
 */
export class ScorchDecalMesh {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly capacityValue: number;
  private writeCursor = 0;
  /** `min(total marks ever stamped, capacity)` -- the drawn prefix before
   *  the first wrap; `capacity` forever after (every slot has been written
   *  at least once). */
  private writtenCount = 0;

  constructor(capacity: number = SCORCH_CAPACITY, color: string = DEFAULT_COLOR) {
    // The falsification the plan names: a pool of zero must be a red test,
    // not a renderer that silently draws nothing -- so this is checked at
    // construction, before a single `Float32Array` is allocated, rather than
    // left to surface later as a `stamp()` that writes into a zero-length
    // buffer or a `% 0` cursor.
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`ScorchDecalMesh: capacity must be a positive integer, got ${capacity}`);
    }
    this.capacityValue = capacity;

    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(capacity * 6 * 3), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(geometry, createScorchMaterial(color));
    // See this file's top comment, "Colour and render order" -- explicit
    // world-tier ground geometry, never the default and never
    // TRAIL_RENDER_ORDER, so nobody later "fixes" it upward into the FX
    // tier where it would paint over a unit standing on the ground it
    // scorched.
    this.mesh.renderOrder = WORLD_RENDER_ORDER;
    // Marks can appear anywhere a vehicle has died or a round has landed,
    // exactly like the tracks span the whole map -- see
    // `VehicleTrackMesh`'s identical field and comment.
    this.mesh.frustumCulled = false;
  }

  get capacity(): number {
    return this.capacityValue;
  }

  /** How many marks are currently drawn -- `min(total stamps, capacity)`,
   *  never past it: this is the ring buffer's own "never grows" guarantee,
   *  read back. */
  get liveCount(): number {
    return this.writtenCount;
  }

  /**
   * Stamps one mark at world tile `(x, y)`, at ground height `groundY`
   * (already sampled by the caller -- see this file's top comment, "Ground
   * height is a parameter, not a sample") sized for `power` (0..1, via
   * `scorchRadiusTiles`). Writes the next ring slot and advances the cursor
   * unconditionally, overwriting the oldest content there once the pool is
   * full -- the same graceful-degradation wraparound `VehicleTrackMesh.stamp`
   * uses, and why this never grows past `capacity`.
   */
  stamp(x: number, y: number, groundY: number, power: number): void {
    const slot = this.writeCursor;
    this.writeCursor = (this.writeCursor + 1) % this.capacityValue;
    this.writtenCount = Math.min(this.writtenCount + 1, this.capacityValue);
    const radius = scorchRadiusTiles(power);
    writeScorchVertices(
      this.positionAttr.array as Float32Array,
      slot,
      x,
      y,
      groundY + MARK_EPSILON,
      radius
    );
    this.positionAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.writtenCount * 6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
