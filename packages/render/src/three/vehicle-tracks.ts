/**
 * Vehicle track marks: tread ruts and tyre marks left on the ground behind a
 * moving GROUND vehicle. Drawing them is the shared decal pool's job now
 * (`decal-pool.ts`, D5) -- `DecalPool`'s `'tread'`/`'tyre'` kinds generalise
 * this module's own ring-buffer/conforming-grid shape to every decal, and
 * fade on the SIM clock rather than a frame-time accumulator (`decal-pool
 * .ts`'s own "The sim-time clock (R-14)"). What is left here is the maths
 * that decides WHICH vehicles leave a mark, of what shape, and where along
 * their path -- `ThreeRenderer` calls these functions and hands the results
 * to `DecalPool.stamp` as a `'tread'`/`'tyre'` `DecalStamp`.
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
 * and nothing it decides (which tile gets a mark, what shape it is) can
 * ever be read BACK by the sim in a way that could change a combat outcome.
 * The per-tick bookkeeping here (`stepTrackAccum`) is pure distance
 * arithmetic with no clock of its own; the one clock a stamped mark's FADE
 * needs is `decal-pool.ts`'s sim-time clock (R-14), not a frame-time
 * accumulator this module used to own.
 */

// ---------------------------------------------------------------------------
// Pure: vehicle classification and stamp-distance bookkeeping. Exercised
// directly with plain numbers in vehicle-tracks.test.ts.
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
 * speed scaling. 0.5 tiles is also `decal-pool.ts`'s own
 * `TRACK_STAMP_HALF_LENGTH` derivation input, so the two files' geometry
 * agrees by construction rather than by two authored numbers happening to
 * match.
 */
export const STAMP_SPACING_TILES = 0.5;

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
