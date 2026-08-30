/**
 * Vehicle track marks: tread ruts and tyre marks left on the ground behind a
 * moving GROUND vehicle, persisting for minutes rather than the sub-second
 * lifetime every other effect in this backend uses. Three-only -- there is
 * no Pixi counterpart and none is owed (CLAUDE.md: "VFX are exempt from this
 * diff as of 2026-08-30... an effect that exists only in three is the
 * intended end state"). `data/vfx/vehicle_dust.json`'s puff is a DIFFERENT
 * effect (a cloud thrown up while driving, ~0.5s); this module is the mark
 * left BEHIND once the dust has settled. `./trail-mesh.ts` is a third,
 * unrelated thing again -- tunnel spoil/identified-route lines, ported from
 * `PixiRenderer.drawTrail`. All three coexist; none of this module reuses
 * their code, because none of their shapes fit: dust is a bursty particle
 * pool sized for a fraction-of-a-second lifetime (`PARTICLE_CAPACITY`
 * 2,048 total, `vehicle_dust` particles live 0.45-0.7s), and tunnel trail is
 * a full-map rebuild-from-`Sim`-state-every-5Hz-tick mesh with no memory of
 * its own between rebuilds -- neither shape survives a 180-second lifetime
 * or an INCREMENTAL "this vehicle drove another half tile" write pattern.
 *
 * ## Why a ring buffer, not a particle pool
 *
 * `mbt_lavi` moves at 1.1 tiles/s: 198 tiles in three minutes. Stamped every
 * half tile that is ~400 marks for ONE vehicle; ten moving vehicles is
 * ~4,000 LIVE marks at once if nothing ever recycled. That is roughly 400x
 * `vehicle_dust`'s own particle lifetime and would starve the shared
 * particle pool (2,048 total, every weapon and destruction effect on the
 * map draws from it) many times over. A bounded ring buffer sidesteps the
 * question instead of hoping vehicle counts stay low: `TRACK_POOL_CAPACITY`
 * (4,096 individual marks -- matching `TRACER_CAPACITY`'s own order of
 * magnitude, `units/fx.ts`) covers roughly five vehicles' worth of
 * continuous full-fidelity three-minute driving at this module's own
 * pair-stamping rate (198 tiles / 0.5 spacing * 2 treads = 792 marks per
 * vehicle), then starts recycling the OLDEST mark first, oldest-first,
 * forever -- the same "keep the newest N, drop the oldest" policy
 * `writeTracerInstances` already uses for the identical reason (a busy
 * battle should lose its stalest evidence, not blink everything at once).
 * "A tank that outlives the buffer should degrade gracefully, not blink" is
 * satisfied by construction: `VehicleTrackMesh.stamp` always writes the
 * NEXT ring slot in a strictly advancing cursor, so wraparound only ever
 * evicts the least-recently-stamped mark in the whole pool, one at a time.
 * Under LIGHT traffic a mark can easily outlive the nominal 180s (nothing
 * forces early recycling if the pool never fills); under HEAVY traffic
 * (several vehicles driving continuously for the whole persistence window)
 * a mark's REALISED lifetime shrinks below 180s as the pool comes under
 * pressure -- the explicitly accepted "graceful degradation" trade, not a
 * bug, and preferable to an unbounded array a battle-scale mission could
 * grow without limit.
 *
 * ## Palette exactness: opaque, one colour, never blended
 *
 * `units/fx.ts`'s own `additive`/`hotCore` doc comment is the worked
 * precedent this module follows, not `trail-mesh.ts`'s: ordinary
 * `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` blending between two already-on-palette
 * colours (what `TrailMesh`'s graduated alpha does) is accepted elsewhere in
 * this backend because it stays BOUNDED between two palette entries -- but
 * this task's own report has to sample live framebuffer pixels and prove
 * they are exactly one of the 65 palette hexes, and a partial-alpha blend
 * against whatever terrain happens to sit underneath produces a continuum,
 * not a fixed set of exact matches. So `createTrackMaterial` below pins
 * alpha to 1.0 unconditionally in the fragment shader -- the identical
 * mechanism `hotCore` particles use to stay on-palette by construction, not
 * a NormalBlending fade -- and the whole mesh draws from ONE material
 * uniform (`opts.terrainTones.rut`, resolved once at construction exactly
 * like `TrailMesh` resolves `terrainTones.spoil`). `rut` is not a new
 * colour choice: it is the SAME palette entry (`dust.5`, `#806032`)
 * CLAUDE.md's own "Known scaling debts" names as the STATIC rut tone
 * already painted into open ground (`renderer.ts`'s `rut` stroke,
 * `TerrainTones.rut`) -- this module is that same tone, drawn dynamically
 * instead of baked into the terrain art, so a driven-over tile and a
 * hand-painted rut tile read as the same material by design. Because every
 * mark is fully opaque (`transparent: false`, matching real ground
 * geometry's own recipe, `terrain/mesh.ts`), there is no fade curve at all:
 * a mark holds its one exact colour for its whole life and then is gone --
 * "persist flat then vanish" from this task's own menu of options, chosen
 * specifically because the alternative (a graduated fade) is the exact
 * failure mode the palette-exactness proof exists to catch.
 *
 * ## Fog: no separate visibility gate, because opaque ground geometry does not need one
 *
 * `FogMesh` (`./fog-mesh.ts`) already paints an unconditional, `depthTest:
 * false` quad over every tile not currently in sight -- opaque for
 * never-explored (fog level 0), 0.55-alpha dim for explored-but-unobserved
 * (level 1) -- regardless of what real geometry sits beneath it. That is the
 * SAME mechanism that already hides/dims a wreck or a building standing on
 * unexplored ground; a mark drawn as ordinary opaque, depth-tested ground
 * geometry (this module's own recipe, see below) gets that guarantee for
 * free, with no extra `Sim.sideSeesTile`-style query of its own. Concretely:
 * an enemy vehicle's track crossing ground the player has never explored is
 * invisible (fog level 0 draws a fully opaque cover quad); once explored,
 * the track becomes visible, dimmed to the same "remembered terrain" look
 * every other permanent ground feature gets, even after the player's own
 * sight has moved on. This leaks nothing the player has not earned -- it is
 * exactly the same information a building or a wreck standing on that tile
 * already leaks, and gating a track mark more strictly than terrain itself
 * would be an arbitrary inconsistency, not an extra safeguard. `TrailMesh`'s
 * OWN spoil rung is a deliberately stricter case for a different reason
 * (`Sim.sideSeesTile`, CURRENT sight only) -- that gates a LIVE mechanic
 * ("something is being dug right now nearby"), not a permanent decal, and
 * this module has no equivalent live signal to gate on nor a reason to
 * invent one. Because this is real, opaque (`transparent: false`) geometry,
 * it also draws in three.js's OPAQUE render queue, which is submitted
 * before the TRANSPARENT queue (where `FogMesh` lives) unconditionally --
 * fog covering a mark does not even depend on `renderOrder` agreeing, the
 * way it would for a transparent mesh sharing fog's own queue.
 *
 * ## Render order and depth recipe
 *
 * `TRAIL_RENDER_ORDER` (`units/render-order.ts`, an alias of
 * `HULL_RENDER_ORDER`) is reused verbatim, per that file's own closing
 * paragraphs: a mark is flat, depth-tested ground geometry, "belongs at or
 * below `HULL_RENDER_ORDER` -- never band 1" (the TURRET band, which sits
 * ABOVE every hull). `depthWrite: true`, `depthTest: true` -- UNLIKE
 * `TrailMesh`'s `depthWrite: false` (which exists there specifically
 * because that mesh's alpha is graduated and soft; see that file's own doc
 * comment). This module's marks are fully opaque, so the correct recipe is
 * the SAME one `terrain/mesh.ts`'s own ground quads use: real depth writes,
 * because there is nothing translucent stacking on top of another mark for
 * `depthWrite: false` to protect. Each mark sits `MARK_EPSILON` above its
 * own tile's true top (`terrain/shared.ts`'s constant, the same one every
 * scatter/grove/trail mark already uses) to avoid z-fighting the terrain
 * quad directly beneath it.
 *
 * ## Vehicles only, and why `isSoft` is the WRONG gate here
 *
 * `!type.isSoft` is this backend's established "is this a vehicle"
 * shorthand elsewhere (`ThreeRenderer.updateVehicleAmbientFx`'s own doc
 * comment) -- but it is armour-derived (`SOFT_ARMOR_LIMIT`, 30mm), and every
 * WHEELED unit in the current roster except `apc_eitan` carries less than
 * that: `jeep_shoded` (14mm), `technical` (15mm), `gun_truck` (12mm),
 * `rocket_battery` (10mm) and `moto_rpg` (0mm) are all `isSoft: true` --
 * identical to `inf_squad`'s own shape (a `hull`/`armor`/`crew` block with
 * no vehicle-vs-infantry field anywhere in the schema to tell them apart).
 * Reusing `!type.isSoft` here would silently exclude jeeps from tracks --
 * exactly the case the project lead named ("trail chain or wheel trail for
 * tanks AND JEEPS"). There is no schema field for "moves on wheels or
 * tracks" to fall back to either, and adding one is out of this task's
 * scope (a render-only module; extending `unit.schema.json` and every unit
 * JSON is a cross-cutting change this task was not asked to make). The
 * correct, honest answer is a SMALL, EXPLICIT, closed table below --
 * `VEHICLE_TRACK_KIND`, keyed by `UnitType.id` exactly like
 * `units/vehicle-mesh-role.ts`'s own `VEHICLE_ROLE_PALETTE` is -- built by
 * hand from every unit JSON in `data/units/` (checked directly, not
 * guessed): three tracked (`mbt_lavi`, `ifv_namer`, `dozer_d9`), five
 * 4-wheeled (`apc_eitan`, `jeep_shoded`, `technical`, `gun_truck`,
 * `rocket_battery`), and one 2-wheeled (`moto_rpg`, its own `'single'`
 * kind -- a motorcycle's front and rear wheel share one line, not a
 * left/right pair). Membership in this table IS the vehicle gate: an id
 * absent from it (every infantry squad, every crew-served weapon team)
 * leaves no marks, by construction, with no separate isSoft/isAir check
 * needed to exclude them. `type.isAir` is still checked explicitly at the
 * call site in `ThreeRenderer` (defence in depth, and the literal answer to
 * "check how isAir is exposed" -- `heli_peten` is an armoured, `isSoft:
 * false` aircraft, so `isSoft` alone would not have excluded it either) even
 * though no air unit is a member of this table today. Unlike
 * `rampForVehicleRole`'s deliberate throw for an unmapped role (a genuine
 * boot failure there -- nothing would render at all), `trackKindFor`
 * returns `null` for an unmapped id: a missing entry here is cosmetic, not
 * fatal, and a future vehicle added without a table entry should simply
 * leave no tracks rather than crash the renderer.
 *
 * ## Tracked vs wheeled vs single, and where the numbers come from
 *
 * `TRACK_FOOTPRINT`'s gauge/length/width numbers are AUTHORED for visual
 * distinctness, not sourced from any real vehicle's track gauge -- no unit
 * JSON declares one, the same "judgement call, not a sourced fact" honesty
 * `vehicle-mesh-role.ts`'s own top comment already uses for `mbt_lavi`'s
 * borrowed hull colour. `tracked` is widest and longest (a tank tread is a
 * substantial ground feature); `wheeled` narrower (a tyre print); `single`
 * narrowest of all and drawn as ONE mark per stamp, not a pair (a
 * motorcycle's two wheels ride the same line). Every mark's LENGTH axis is
 * baked in aligned with the vehicle's facing AT THE MOMENT OF THE STAMP
 * (world-space `cos`/`sin` of `facingNorm`, the identical convention
 * `units/vehicle-fx.ts`'s `vehicleFxAnchor` already uses and this module's
 * own tests check against its worked example) -- not re-evaluated later, so
 * a mark never "turns" after it is laid down, matching how a real tread
 * print does not move once the tread has passed.
 *
 * ## Determinism (invariant 4)
 *
 * Every read here is `Sim` state already exposed read-only elsewhere in
 * this backend (`curX`/`curY`, `state.facing`, `state.alive`,
 * `unitTypes[...].id`/`isAir`) -- this module writes nothing back to `Sim`,
 * and nothing it decides (which tile gets a mark, when one expires) can
 * ever be read BACK by the sim in a way that could change a combat outcome.
 * The one per-frame/per-tick clock this module needs (`nowMs`, for TTL
 * expiry) is threaded in by the caller from `ThreeRenderer`'s own
 * accumulated `dtMs` total -- never `Date.now()`/`performance.now()` --
 * matching `Renderer.frame`'s own documented contract ("a backend that
 * reads its own [clock] would make a frame depend on when it happened").
 */
import * as THREE from 'three';
import { hexToUnit, MARK_EPSILON } from './terrain/shared';
import { groundWorldY } from './ground-height';
import { tracerIndexBuffer } from './units/fx';
import { TRAIL_RENDER_ORDER } from './units/render-order';

// ---------------------------------------------------------------------------
// Pure: vehicle classification, stamp-distance bookkeeping, and mark
// geometry. No THREE.* below this line -- mirrors trail-mesh.ts's own split,
// exercised directly with plain numbers in vehicle-tracks.test.ts.
// ---------------------------------------------------------------------------

/** `'single'` is the motorcycle case -- one mark per stamp, not a pair. See
 *  this file's top comment for the full roster and reasoning. */
export type VehicleTrackKind = 'tracked' | 'wheeled' | 'single';

/**
 * Closed table, keyed by `UnitType.id` -- membership IS the "does this unit
 * leave tracks at all" gate. See this file's top comment, "Vehicles only,
 * and why `isSoft` is the WRONG gate here", for how each entry was checked
 * against its own unit JSON rather than guessed.
 */
export const VEHICLE_TRACK_KIND: Readonly<Record<string, VehicleTrackKind>> = {
  mbt_lavi: 'tracked',
  ifv_namer: 'tracked',
  dozer_d9: 'tracked',
  apc_eitan: 'wheeled',
  jeep_shoded: 'wheeled',
  technical: 'wheeled',
  gun_truck: 'wheeled',
  rocket_battery: 'wheeled',
  moto_rpg: 'single',
};

/** `null` means "not in the table" -- no tracks, no error. See this file's
 *  top comment for why an unmapped id is cosmetic-quiet here, unlike
 *  `rampForVehicleRole`'s deliberate throw for an unmapped mesh role. */
export function trackKindFor(unitId: string): VehicleTrackKind | null {
  return VEHICLE_TRACK_KIND[unitId] ?? null;
}

export interface TrackFootprint {
  /** Half the left/right offset between a pair's two marks, tiles. Zero for
   *  `'single'`, which stamps exactly one mark centred on the vehicle. */
  readonly gaugeTiles: number;
  /** Half the mark's length along the direction of travel, tiles. */
  readonly halfLengthTiles: number;
  /** Half the mark's width across the direction of travel, tiles. */
  readonly halfWidthTiles: number;
}

/** Authored, not sourced -- see this file's top comment, "Tracked vs
 *  wheeled vs single, and where the numbers come from". */
export const TRACK_FOOTPRINT: Readonly<Record<VehicleTrackKind, TrackFootprint>> = {
  tracked: { gaugeTiles: 0.22, halfLengthTiles: 0.28, halfWidthTiles: 0.06 },
  wheeled: { gaugeTiles: 0.16, halfLengthTiles: 0.22, halfWidthTiles: 0.035 },
  single: { gaugeTiles: 0, halfLengthTiles: 0.2, halfWidthTiles: 0.03 },
};

/**
 * Distance between successive stamps along a vehicle's path, tiles --
 * deliberately a fixed DISTANCE, not a fixed TIME. A time-based interval
 * would leave gaps at high speed and redundant clumps at low speed; a
 * distance-based one keeps mark DENSITY along the path constant regardless
 * of how fast the vehicle is moving, which is the physically correct
 * behaviour for a continuous tread/tyre print. Stamp RATE (marks per
 * second) still scales with speed as a consequence -- a fast vehicle
 * crosses 0.5 tile sooner and so stamps more often in wall-clock time --
 * but that is a side effect of the distance rule, not a second, independent
 * speed scaling. 0.5 tiles matches this task's own worked capacity example
 * (`mbt_lavi`, ~198 tiles / 3 min -> ~400 single-mark stamps), so
 * `TRACK_POOL_CAPACITY`'s own sizing note stays directly comparable to it.
 */
export const STAMP_SPACING_TILES = 0.5;

/** Individual marks, not stamp events (a `'tracked'`/`'wheeled'` stamp
 *  consumes two of these). See this file's top comment, "Why a ring buffer,
 *  not a particle pool", for the sizing derivation. */
export const TRACK_POOL_CAPACITY = 4096;

/** "At least 3 min" -- the project lead's literal ask -- under normal load;
 *  see this file's top comment for the pool-pressure case where a mark's
 *  realised lifetime can fall short, by deliberate design. */
export const TRACK_PERSIST_MS = 180_000;

/**
 * A single-tick displacement above this (tiles) is treated as a teleport
 * (reinforcement spawn, garrison disembark, or any future repositioning),
 * not real driving -- resets the accumulator instead of drawing a phantom
 * straight-line track across the map from wherever the entity used to be.
 * The fastest roster ground vehicle in `VEHICLE_TRACK_KIND` is `moto_rpg`
 * at 3.4 tiles/s, 0.17 tile at the sim's 20 Hz tick -- 1.0 tile is
 * comfortably (~6x) above that, so this only ever trips on a genuine jump,
 * never on ordinary acceleration.
 */
export const MAX_PLAUSIBLE_TRACK_STEP_TILES = 1.0;

export interface TrackAccumResult {
  /** Carried remainder below `STAMP_SPACING_TILES`, tiles. */
  readonly accumTiles: number;
  /** How many stamps this tick's movement crossed -- 0 or 1 for every
   *  roster vehicle today; the caller loops this many times rather than
   *  assuming at most one, since a future faster vehicle could cross more
   *  than one spacing in a single tick. */
  readonly stamps: number;
}

/**
 * One sim tick's worth of accumulator bookkeeping -- pure, so it is testable
 * with plain numbers. `dx`/`dy` are this tick's position delta in tiles
 * (`ThreeRenderer.snapshot`'s own `curX[i] - prevX[i]`/`curY[i] - prevY[i]`,
 * already computed there for `entitySpeed`).
 */
export function stepTrackAccum(accumTiles: number, dx: number, dy: number): TrackAccumResult {
  const dist = Math.hypot(dx, dy);
  if (dist > MAX_PLAUSIBLE_TRACK_STEP_TILES) {
    return { accumTiles: 0, stamps: 0 };
  }
  let acc = accumTiles + dist;
  let stamps = 0;
  while (acc >= STAMP_SPACING_TILES) {
    acc -= STAMP_SPACING_TILES;
    stamps++;
  }
  return { accumTiles: acc, stamps };
}

export interface TrackMarkCenter {
  readonly x: number;
  readonly y: number;
}

/**
 * World (x, y) centre(s) for one stamp event -- one for `'single'`, two
 * (left, right) straddling the vehicle's own position for `'tracked'`/
 * `'wheeled'`. `facingNorm` is 0..1 turns, the same convention
 * `vehicleFxAnchor` (`units/vehicle-fx.ts`) uses -- `facingNorm = 0` points
 * along world +x, `0.25` along world +y (that module's own test names this
 * "facing south"), and this function's own perpendicular is a 90-degree
 * rotation of that forward vector, so the two centres are always mirror
 * images either side of the vehicle's line of travel.
 */
export function trackStampCenters(
  cx: number,
  cy: number,
  facingNorm: number,
  kind: VehicleTrackKind
): readonly TrackMarkCenter[] {
  const footprint = TRACK_FOOTPRINT[kind];
  if (footprint.gaugeTiles === 0) return [{ x: cx, y: cy }];
  const facingRad = facingNorm * Math.PI * 2;
  const fwdX = Math.cos(facingRad);
  const fwdY = Math.sin(facingRad);
  const perpX = -fwdY;
  const perpY = fwdX;
  const g = footprint.gaugeTiles;
  return [
    { x: cx + perpX * g, y: cy + perpY * g },
    { x: cx - perpX * g, y: cy - perpY * g },
  ];
}

/**
 * Four world-space (x, z) corners of one mark's quad, long axis aligned with
 * `facingNorm` -- the length half-extent runs along the forward vector, the
 * width half-extent along its perpendicular, so at `facingNorm = 0` (forward
 * = world +x) the quad spans `x in [-halfLength, halfLength]`, `z in
 * [-halfWidth, halfWidth]` around `center`, exactly the "elongated along the
 * direction of travel" shape a real tread/tyre print has.
 */
export function trackMarkCorners(
  center: TrackMarkCenter,
  facingNorm: number,
  halfLength: number,
  halfWidth: number
): readonly [number, number][] {
  const facingRad = facingNorm * Math.PI * 2;
  const fwdX = Math.cos(facingRad) * halfLength;
  const fwdY = Math.sin(facingRad) * halfLength;
  const perpX = -Math.sin(facingRad) * halfWidth;
  const perpY = Math.cos(facingRad) * halfWidth;
  return [
    [center.x + fwdX + perpX, center.y + fwdY + perpY],
    [center.x + fwdX - perpX, center.y + fwdY - perpY],
    [center.x - fwdX - perpX, center.y - fwdY - perpY],
    [center.x - fwdX + perpX, center.y - fwdY + perpY],
  ];
}

/**
 * Writes one mark's 4 corner vertices (xyz, world space) into `out` at the
 * given ring `slot` (`out[slot*12 .. slot*12+11]`) -- the same "pure
 * function fills the caller's typed array" contract `writeTrailInstances`/
 * `writeFogInstances` already use. Sampled ONCE at the mark's own centre
 * tile (`groundWorldY`), not per corner -- a mark is small enough that
 * sub-tile elevation interpolation would not be visible, matching how
 * `FogMesh`/`TrailMesh` both sample per TILE, never per vertex.
 */
export function writeTrackMarkVertices(
  center: TrackMarkCenter,
  facingNorm: number,
  halfLength: number,
  halfWidth: number,
  elevation: Uint8Array | null,
  mapWidth: number,
  mapHeight: number,
  out: Float32Array,
  slot: number
): void {
  const corners = trackMarkCorners(center, facingNorm, halfLength, halfWidth);
  const y = groundWorldY(elevation, mapWidth, mapHeight, center.x, center.y) + MARK_EPSILON;
  const base = slot * 12;
  for (let i = 0; i < 4; i++) {
    out[base + i * 3] = corners[i][0];
    out[base + i * 3 + 1] = y;
    out[base + i * 3 + 2] = corners[i][1];
  }
}

/**
 * Collapses a slot's 4 vertices onto its OWN last-written centre (zero
 * area -- the two triangles degenerate to nothing, so the slot draws no
 * pixels) rather than the world origin: `(0, 0, 0)` is a real, potentially
 * on-screen map tile, and snapping an expired mark there would flash a
 * visible artefact at a location that has nothing to do with the mark that
 * just expired. Collapsing onto the mark's own position is invisible
 * regardless of where on the map it happened to be.
 */
export function collapseTrackMarkVertices(out: Float32Array, slot: number): void {
  const base = slot * 12;
  const x = out[base];
  const y = out[base + 1];
  const z = out[base + 2];
  for (let i = 0; i < 4; i++) {
    out[base + i * 3] = x;
    out[base + i * 3 + 1] = y;
    out[base + i * 3 + 2] = z;
  }
}

/**
 * Scans the WRITTEN prefix (`writtenCount`, which is `capacity` after the
 * first wrap and grows toward it before that -- `VehicleTrackMesh`'s own
 * bookkeeping) for slots whose TTL has elapsed and have not already been
 * marked `collapsed`. Mutates `collapsed` in place for each one found (so a
 * later call never re-reports it) and fills `outSlots` with their indices,
 * returning the count written -- the same "pure function mutates the
 * caller's own scratch buffers" contract every other write function in this
 * file uses, so a per-frame call allocates nothing.
 *
 * `writtenCount` is at most `TRACK_POOL_CAPACITY` (4,096) -- a flat scan of
 * that many `Float64Array`/`Uint8Array` entries once a frame is a constant,
 * small cost that cannot grow with map size or route count, unlike the
 * genuine O(width * height * routes) trail scan CLAUDE.md's own "Known
 * scaling debts" flags; there is nothing to stagger here.
 */
export function sweepExpiredTrackSlots(
  spawnMs: Float64Array,
  collapsed: Uint8Array,
  writtenCount: number,
  nowMs: number,
  persistMs: number,
  outSlots: Int32Array
): number {
  let n = 0;
  for (let i = 0; i < writtenCount; i++) {
    if (collapsed[i] === 1) continue;
    if (nowMs - spawnMs[i] < persistMs) continue;
    collapsed[i] = 1;
    if (n < outSlots.length) outSlots[n] = i;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction
// (BufferGeometry, Mesh, ShaderMaterial). Not exercised by
// vehicle-tracks.test.ts for the same reason trail-mesh.ts's own GPU half is
// not -- three.js accepts these buffers under `environment: 'node'`, but
// *using* them end to end needs a real WebGLRenderer. Covered by the browser
// verification in this task's own report instead.
// ---------------------------------------------------------------------------

/**
 * Flat-shaded, single-uniform-colour, fully OPAQUE material -- see this
 * file's top comment, "Palette exactness", for why alpha is pinned to 1.0
 * unconditionally rather than read from a per-instance/per-vertex
 * attribute: every fragment this material ever writes is exactly `color`,
 * with no blending step that could produce anything else.
 */
function createTrackMaterial(color: string): THREE.ShaderMaterial {
  const [r, g, b] = hexToUnit(color);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(r, g, b) },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    // DoubleSide, matching TracerBatch's own reasoning (`units/fx.ts`) even
    // though the specific hazard differs: a tracer's winding varies per shot
    // bearing and cannot be proven once, where this mesh's winding IS
    // constant across every `facingNorm` (an easy fact to get backwards by
    // hand, not one that varies at runtime) -- but the material carries no
    // lighting term to depend on face direction either way, so removing the
    // "did I get the corner order right" risk costs nothing real.
    side: THREE.DoubleSide,
  });
}

/**
 * Every live (and recently-expired-but-not-yet-collapsed) mark, one batched
 * (not instanced) `THREE.Mesh`, one draw call -- the same shape
 * `TracerBatch` (`units/fx.ts`) uses and for the identical reason: each
 * mark's quad varies in both position AND facing per stamp, so this writes
 * real per-vertex positions into one large `BufferGeometry` rather than
 * scaling a shared local quad through a per-instance `Matrix4`.
 *
 * UNLIKE `TracerBatch`, this is not rebuilt from a live list every frame --
 * a mark is written ONCE, at `stamp()`, and never moves again until it is
 * either recycled by ring-buffer wraparound or expires via `update()`'s TTL
 * sweep. `positionAttr.needsUpdate` is therefore only set when something
 * actually changed this call, not unconditionally every frame.
 */
export class VehicleTrackMesh {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly spawnMs: Float64Array;
  private readonly collapsed: Uint8Array;
  private readonly expiredScratch: Int32Array;
  private writeCursor = 0;
  /** `min(total marks ever stamped, capacity)` -- the drawn prefix before
   *  the first wrap; `capacity` forever after (every slot has been written
   *  at least once, whether still active or already collapsed). */
  private writtenCount = 0;

  constructor(capacity: number, color: string) {
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setIndex(new THREE.BufferAttribute(tracerIndexBuffer(capacity), 1));
    geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(geometry, createTrackMaterial(color));
    // See this file's top comment, "Render order and depth recipe" -- flat,
    // depth-tested ground geometry belongs at or below HULL_RENDER_ORDER,
    // the same band TrailMesh already draws in.
    this.mesh.renderOrder = TRAIL_RENDER_ORDER;
    // Marks can appear anywhere a vehicle has driven, exactly like fog/trail
    // span the whole map -- see UnitInstancer's identical field and comment.
    this.mesh.frustumCulled = false;

    this.spawnMs = new Float64Array(capacity);
    this.collapsed = new Uint8Array(capacity);
    this.expiredScratch = new Int32Array(capacity);
  }

  get capacity(): number {
    return this.spawnMs.length;
  }

  /**
   * Writes one stamp event's mark(s) -- one for `'single'`, two for
   * `'tracked'`/`'wheeled'` -- into the next ring slot(s), advancing the
   * cursor and overwriting the oldest content there unconditionally (the
   * graceful-degradation wraparound this file's top comment describes).
   * `nowMs` is the caller's own accumulated clock, never a direct
   * `Date.now()`/`performance.now()` read -- see this file's top comment,
   * "Determinism (invariant 4)".
   */
  stamp(
    cx: number,
    cy: number,
    facingNorm: number,
    kind: VehicleTrackKind,
    elevation: Uint8Array | null,
    mapWidth: number,
    mapHeight: number,
    nowMs: number
  ): void {
    const footprint = TRACK_FOOTPRINT[kind];
    const centers = trackStampCenters(cx, cy, facingNorm, kind);
    const positions = this.positionAttr.array as Float32Array;
    for (const center of centers) {
      const slot = this.writeCursor;
      this.writeCursor = (this.writeCursor + 1) % this.capacity;
      this.writtenCount = Math.min(this.writtenCount + 1, this.capacity);
      writeTrackMarkVertices(
        center,
        facingNorm,
        footprint.halfLengthTiles,
        footprint.halfWidthTiles,
        elevation,
        mapWidth,
        mapHeight,
        positions,
        slot
      );
      this.spawnMs[slot] = nowMs;
      this.collapsed[slot] = 0;
    }
    this.positionAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.writtenCount * 6);
  }

  /** TTL sweep -- called once a frame from `ThreeRenderer.frame()`, matching
   *  `smokeMesh.update()`'s own "no dirty gate, runs every frame()"
   *  precedent (this is cheap; see `sweepExpiredTrackSlots`'s own doc
   *  comment for the cost bound). `nowMs` is the same accumulated-`dtMs`
   *  clock `stamp()` uses. */
  update(nowMs: number): void {
    const n = sweepExpiredTrackSlots(
      this.spawnMs,
      this.collapsed,
      this.writtenCount,
      nowMs,
      TRACK_PERSIST_MS,
      this.expiredScratch
    );
    if (n === 0) return;
    const positions = this.positionAttr.array as Float32Array;
    for (let i = 0; i < n; i++) collapseTrackMarkVertices(positions, this.expiredScratch[i]);
    this.positionAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
