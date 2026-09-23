/**
 * The authored numbers behind WP-A1.3's hull weight, and how they reach a
 * renderer that may not read them the obvious way.
 *
 * `mobility.weight` in the unit JSON (`data/schemas/unit.schema.json`) is
 * presentation only, and `packages/sim` never sees it -- `pnpm balance`,
 * `pnpm playtest`, `pnpm test:determinism` and the sim itself are untouched by
 * this file existing. Getting the numbers OUT of the JSON and into
 * `stepVehicleWeight` (Task 3, `./vehicle-weight.ts`) is the actual problem,
 * because the three obvious routes are all closed, each for a reason already
 * written down elsewhere: `@lions/render` may import `@lions/sim` only
 * (`eslint.config.mjs:138-147`), so a second `@lions/data` import here would
 * be a lint error, not a review comment; `RendererOptions` is assembled in
 * `main.ts`, which `packages/app` owns; and putting this on `UnitType` is a
 * `packages/sim` edit the design (R-H) forbids outright.
 *
 * What IS open, and already how two production files in this backend read
 * authored content, is importing the raw JSON by relative path --
 * `mesh-role.ts:44` and `../terrain/tones.ts:27` both do it with
 * `data/palette.json`, each saying why. This file does the same with the
 * vehicle unit JSONs: **nothing here is transcribed.** The numbers live in
 * the JSON and are read from it, not copied into a table a future edit to the
 * JSON could silently stop matching.
 *
 * What IS hand-kept is the import LIST below, and that list is pinned to
 * `art/meshes/vehicles/*.glb` by a test that reads the directory at test
 * time (`vehicle-weight-params.test.ts`), never an `import.meta.glob` -- a
 * glob would derive the list from the directory and make the pin vacuous
 * (the reason `packages/data`'s own `index.test.ts` gives for the same
 * choice). That pin is not decoration: `data/vfx/catastrophic_kill.json` was
 * left out of `packages/data/src/index.ts`'s `vfxEmitters` one sub-project
 * ago, three blast effects shipped inert behind a passing suite, and only a
 * capture run found it. Forgetting a vehicle's import here would look
 * identical -- a GLB that never leans, squats or settles, on a fully green
 * `pnpm test`.
 *
 * **Nothing on foot can reach this table.** `updateVehicleMeshes` gates on
 * `vehicleMeshTemplates.has(type.id)`, and only a type with a shipped
 * `art/meshes/vehicles/*.glb` ever gets an entry there -- which is also why
 * `manpad_team`, classed `wheeled` by the `FOOT_ROLES` default and genuinely
 * four men with a launcher, never gets a hull tilt: it has no GLB, so it
 * never reaches `vehicleWeightParamsFor` at all. Air is excluded the same
 * way, one layer up: `heli_peten` (`gunship`) and a ground drone both get a
 * role default here so the resolver never throws for them, but the caller
 * that walks `type.isAir` is expected to skip calling `stepVehicleWeight` for
 * an airborne type before this module is ever consulted -- a helicopter
 * conforming to the ground under it would be a bug with a straight face, not
 * a number this file could fix by being smaller.
 *
 * **The role table has eleven entries, not the nine `mbt`/`ifv`/`apc`/
 * `technical`/`recon`/`artillery`/`aa`/`gunship`/`drone` a first read of the
 * roster suggests.** Two more roles are declared by a shipped vehicle GLB and
 * are read straight off the schema's own `role` enum: `dozer_d9` is
 * `engineer` and `paramotor` is `support`. Both are exercised by
 * `vehicle-weight-params.test.ts`'s directory-driven test, which is the
 * reason to trust this list over the prose -- it is read off the shipped
 * roster, not copied from a design doc.
 */

import type { VehicleWeightParams } from './vehicle-weight';

// The import list R-I pins to `art/meshes/vehicles/*.glb` -- see this file's
// header. `vehicle-weight-params.test.ts` reads that directory at test time
// and fails loudly the moment one of these eleven stops matching it.
import apcEitan from '../../../../../data/units/kdf/apc_eitan.json';
import apcKipod from '../../../../../data/units/kdf/apc_kipod.json';
import dozerD9 from '../../../../../data/units/kdf/dozer_d9.json';
import heliPeten from '../../../../../data/units/kdf/heli_peten.json';
import ifvNamer from '../../../../../data/units/kdf/ifv_namer.json';
import jeepShoded from '../../../../../data/units/kdf/jeep_shoded.json';
import mbtLavi from '../../../../../data/units/kdf/mbt_lavi.json';
import scoutShachaf from '../../../../../data/units/kdf/scout_shachaf.json';
import paramotor from '../../../../../data/units/enemy/paramotor.json';
import rocketBattery from '../../../../../data/units/enemy/rocket_battery.json';
import technical from '../../../../../data/units/enemy/technical.json';

const DEG = Math.PI / 180;

/** `mobility.weight`, as authored -- see `data/schemas/unit.schema.json`. */
interface RawWeightBlock {
  mass_class?: 'light' | 'medium' | 'heavy';
  pitch_deg?: number;
  roll_deg?: number;
  lag_tiles?: number;
  settle_s?: number;
}

/** The one shape this module reads off a unit JSON. Everything else in the
 *  file (cost, hull, weapons, ...) is somebody else's concern. */
interface WeightSource {
  id: string;
  role: string;
  weight: RawWeightBlock | undefined;
}

function readWeightSource(json: unknown): WeightSource {
  const j = json as { id: string; role?: string; mobility?: { weight?: RawWeightBlock } };
  return { id: j.id, role: j.role ?? '', weight: j.mobility?.weight };
}

const VEHICLE_UNIT_JSON: readonly unknown[] = [
  apcEitan,
  apcKipod,
  dozerD9,
  heliPeten,
  ifvNamer,
  jeepShoded,
  mbtLavi,
  scoutShachaf,
  paramotor,
  rocketBattery,
  technical,
];

const BY_UNIT_ID: ReadonlyMap<string, WeightSource> = new Map(
  VEHICLE_UNIT_JSON.map(readWeightSource).map((source) => [source.id, source])
);

/**
 * The unit ids the import list above actually covers -- exported so a test
 * can assert this list is exactly the shipped `art/meshes/vehicles/*.glb`
 * roster, in BOTH directions. Without this, the pin only ever checked one
 * direction (every shipped id resolves to something usable), and the
 * role-default fallback that makes that direction possible also makes it
 * blind to a STALE entry: `sniper_team` (no vehicle GLB at all) added here
 * still resolves cleanly through its own role default, and a vehicle's
 * import dropped together with its array entry is equally invisible, since
 * nothing before this export ever compared the two lists against each other.
 */
export const VEHICLE_WEIGHT_IMPORTED_UNIT_IDS: readonly string[] = Array.from(BY_UNIT_ID.keys());

/**
 * Role defaults, keyed by `UnitType.role` -- a field the sim already parses
 * and the renderer already has, so this is not a second hand-kept id table of
 * the `VEHICLE_TRACK_KIND` kind. Every entry here stays under
 * `MESH_HULL_PITCH_RAD` (`ThreeRenderer.ts:440`, ~3.44 degrees): a weight lean
 * is meant to read as smaller than the gun's own recoil, never compete with
 * it, and `vehicle-weight-params.test.ts` pins that as a schema-independent
 * assertion (a JSON author could not reach it either -- `pitch_deg` maxes at
 * 6 in the schema, but nobody has authored a table entry anywhere near that).
 *
 * Every `lagTiles` here is far under `MAX_LAG_TILES` (0.09, R-K): a stop is
 * the one moment `stepVehicleWeight` forces the lag to exactly zero (R-C), so
 * what these numbers cost is the hop back to the true position on that frame
 * -- roughly `lagTiles * TILE_H * zoom` screen pixels at the isometric
 * projection's own scale (`project.ts`'s `TILE_H`, 32). At the heaviest entry
 * here (`mbt`, 0.06 tiles) that is ~4.8 px at 2.5x zoom, the same figure the
 * design doc gives for the identical number in Task 3's own `HEAVY` sweep
 * table; the lightest (`drone`, 0.01 tiles) is ~0.8 px.
 */
export const VEHICLE_WEIGHT_ROLE_DEFAULTS: Readonly<Record<string, VehicleWeightParams>> = {
  // The heaviest ground vehicle in the roster. These numbers ARE the issue's
  // own figure (R-M: "±2° pitch on acceleration") -- Task 3's `HEAVY` sweep
  // table is this entry, which is also why `mbt_lavi.json` needs no override
  // (see this package's report): the role default already draws the number
  // the spec named for exactly this tank.
  mbt: {
    maxPitchRad: 2 * DEG,
    maxRollRad: 1.5 * DEG,
    accelSeconds: 0.35,
    settleSeconds: 0.5,
    settleDamping: 0.6,
    lagTiles: 0.06,
  },
  // Heavier and slower to turn than an APC, lighter than a tank.
  ifv: {
    maxPitchRad: 1.6 * DEG,
    maxRollRad: 1.3 * DEG,
    accelSeconds: 0.3,
    settleSeconds: 0.45,
    settleDamping: 0.65,
    lagTiles: 0.05,
  },
  // `apc_eitan`, `apc_kipod` and the soft-skin `jeep_shoded` (role `apc` in
  // the shipped data despite being a jeep) all share this: lighter than an
  // IFV, quicker to settle.
  apc: {
    maxPitchRad: 1.2 * DEG,
    maxRollRad: 1.1 * DEG,
    accelSeconds: 0.22,
    settleSeconds: 0.35,
    settleDamping: 0.75,
    lagTiles: 0.045,
  },
  // A light, fast pickup on soft suspension: less pitch than an APC (nothing
  // heavy enough to squat hard) but MORE roll -- a technical leans into a
  // turn more visibly than an armoured car does, and settles fast.
  technical: {
    maxPitchRad: 1.0 * DEG,
    maxRollRad: 1.6 * DEG,
    accelSeconds: 0.15,
    settleSeconds: 0.3,
    settleDamping: 0.7,
    lagTiles: 0.045,
  },
  // `scout_shachaf`: light armoured car, built to move, not to carry weight.
  recon: {
    maxPitchRad: 0.8 * DEG,
    maxRollRad: 1.0 * DEG,
    accelSeconds: 0.15,
    settleSeconds: 0.3,
    settleDamping: 0.8,
    lagTiles: 0.04,
  },
  // `rocket_battery`: a Grad on a 6x6 truck (`mobility.wheeled: true`
  // overrides the `artillery` role default there -- a separate, already
  // authored field, unrelated to this one). Heavier than a technical, slower
  // to accelerate and settle, but the truck rarely turns hard so roll stays
  // modest.
  artillery: {
    maxPitchRad: 1.4 * DEG,
    maxRollRad: 1.0 * DEG,
    accelSeconds: 0.3,
    settleSeconds: 0.4,
    settleDamping: 0.7,
    lagTiles: 0.03,
  },
  // No shipped `aa` vehicle has a GLB yet (`gun_truck` and `manpad_team` are
  // both billboard-only today), but the role is in the schema's enum and a
  // wheeled AA truck is the obvious next vehicle to ship one -- close to a
  // technical/APC in build, so it gets a number now rather than a resolver
  // that throws the day someone adds `art/meshes/vehicles/gun_truck.glb`.
  aa: {
    maxPitchRad: 1.1 * DEG,
    maxRollRad: 1.2 * DEG,
    accelSeconds: 0.2,
    settleSeconds: 0.32,
    settleDamping: 0.75,
    lagTiles: 0.04,
  },
  // `heli_peten`. Excluded from the weight model entirely by `type.isAir`
  // upstream of this file (see the header) -- this entry exists only so the
  // resolver never throws if that gate is ever bypassed, so it is
  // deliberately near-inert rather than tuned for a hull that never conforms
  // to the ground under it.
  gunship: {
    maxPitchRad: 0.3 * DEG,
    maxRollRad: 0.4 * DEG,
    accelSeconds: 0.1,
    settleSeconds: 0.15,
    settleDamping: 1.0,
    lagTiles: 0.01,
  },
  // No shipped ground drone has a vehicle GLB today (`recon_drone` and
  // `attack_drone` are billboard-only); a flying drone is excluded the same
  // way `gunship` is. Kept near-inert for the same reason.
  drone: {
    maxPitchRad: 0.2 * DEG,
    maxRollRad: 0.3 * DEG,
    accelSeconds: 0.05,
    settleSeconds: 0.1,
    settleDamping: 1.0,
    lagTiles: 0.01,
  },
  // `dozer_d9`: the heaviest machine in the roster by intent (a D9 outweighs
  // a Lavi), moving at 0.6 tiles/s. The biggest squat and dive in the table,
  // and the slowest launch and settle -- a bulldozer starting or stopping
  // reads as the heaviest thing on screen. Its low top speed keeps the lag
  // budget modest despite the exaggerated pitch/roll.
  engineer: {
    maxPitchRad: 1.8 * DEG,
    maxRollRad: 1.4 * DEG,
    accelSeconds: 0.4,
    settleSeconds: 0.55,
    settleDamping: 0.6,
    lagTiles: 0.05,
  },
  // `paramotor`: `domain: "air"` in the shipped JSON, excluded by `type.isAir`
  // exactly like `gunship`/`drone` above. A ground `support` vehicle is
  // plausible (the role is not air-only in the schema), so this entry is
  // tuned as a light utility vehicle rather than left near-inert.
  support: {
    maxPitchRad: 0.7 * DEG,
    maxRollRad: 1.0 * DEG,
    accelSeconds: 0.15,
    settleSeconds: 0.25,
    settleDamping: 0.85,
    lagTiles: 0.035,
  },
};

/**
 * The `mass_class` escape hatch (`data/schemas/unit.schema.json`'s
 * `mobility.weight.mass_class`): a cheap authoring surface for a unit whose
 * role default is wrong, without hand-writing all six numbers.
 * `vehicle-weight-params.test.ts` asserts the ordering a heavier class must
 * keep -- more pitch, slower to accelerate, slower to settle -- as an
 * ordering rather than as fixed numbers, so retuning this table cannot
 * silently invert the one property the whole package is about.
 */
export const VEHICLE_WEIGHT_MASS_CLASS: Readonly<Record<'light' | 'medium' | 'heavy', VehicleWeightParams>> = {
  light: {
    maxPitchRad: 0.8 * DEG,
    maxRollRad: 1.0 * DEG,
    accelSeconds: 0.12,
    settleSeconds: 0.22,
    settleDamping: 0.9,
    lagTiles: 0.03,
  },
  medium: {
    maxPitchRad: 1.5 * DEG,
    maxRollRad: 1.3 * DEG,
    accelSeconds: 0.25,
    settleSeconds: 0.4,
    settleDamping: 0.7,
    lagTiles: 0.05,
  },
  heavy: {
    maxPitchRad: 2.5 * DEG,
    maxRollRad: 1.8 * DEG,
    accelSeconds: 0.4,
    settleSeconds: 0.55,
    settleDamping: 0.55,
    lagTiles: 0.07,
  },
};

/** Used only when a role is not in `VEHICLE_WEIGHT_ROLE_DEFAULTS` at all --
 *  a role nobody has authored a vehicle for yet. Cosmetic: a vehicle with no
 *  table entry should draw a plausible hull, not stop the frame. Kept out of
 *  both exported tables so it is never swept by the schema-ceiling tests
 *  that check every AUTHORED table -- this one is a fallback, not a
 *  table anyone chose. */
const FALLBACK_PARAMS: VehicleWeightParams = {
  maxPitchRad: 1 * DEG,
  maxRollRad: 1 * DEG,
  accelSeconds: 0.25,
  settleSeconds: 0.35,
  settleDamping: 0.75,
  lagTiles: 0.04,
};

function resolveBase(massClass: RawWeightBlock['mass_class'], role: string): VehicleWeightParams {
  if (massClass !== undefined) return VEHICLE_WEIGHT_MASS_CLASS[massClass];
  return VEHICLE_WEIGHT_ROLE_DEFAULTS[role] ?? FALLBACK_PARAMS;
}

/**
 * Resolution order: an authored per-axis number on `unitId`'s own JSON wins;
 * failing that, its `mass_class` (if any); failing that, the role default for
 * `role`; failing that (a role nobody has authored a vehicle for), a safe,
 * throw-free fallback. `unitId` not being in the pinned import list at all is
 * exactly the same as it declaring no `weight` block.
 */
export function vehicleWeightParamsFor(unitId: string, role: string): VehicleWeightParams {
  const weight = BY_UNIT_ID.get(unitId)?.weight;
  const base = resolveBase(weight?.mass_class, role);
  if (weight === undefined) return base;

  return {
    maxPitchRad: weight.pitch_deg !== undefined ? weight.pitch_deg * DEG : base.maxPitchRad,
    maxRollRad: weight.roll_deg !== undefined ? weight.roll_deg * DEG : base.maxRollRad,
    accelSeconds: base.accelSeconds,
    settleSeconds: weight.settle_s !== undefined ? weight.settle_s : base.settleSeconds,
    settleDamping: base.settleDamping,
    lagTiles: weight.lag_tiles !== undefined ? weight.lag_tiles : base.lagTiles,
  };
}
