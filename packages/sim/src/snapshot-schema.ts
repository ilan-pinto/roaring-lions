import { MAX_EVAC_POINTS, MAX_PATROL_WAYPOINTS, MAX_SITES } from './tuning';

// The snapshot schema (net sim snapshot, stage 1, Task 2): the ONE table that
// gives every own property of `Sim` exactly one class and a shape. The encoder
// (Task 3) is walked off this table, and `snapshot-schema.test.ts` reflects
// over live worlds to prove it has no gap and no stale row.
//
// Order is the ENCODING order. It is APPEND-ONLY within a format version: a
// reorder or an insertion changes every snapshot already written. It is the
// order the properties are created in `Sim`, as measured at f946bb16 (239).
//
// The four classes (design 2026-10-25-net-sim-snapshot-design.md, 3.1):
//   state     changes during a match and is read later: encoded, written back.
//   config    fixed by the match config at boot: rebuilt by `buildMatchWorld`.
//   derived   a pure function of state, too large to send: the flow-field
//             pool's contents only, rebuilt by Task 4.
//   scratch   overwritten before any read, every use: left at the fresh value.
// The command and runtime queues are `state` (aux rows): `MissionRuntime.step`
// queues a rally order AFTER the tick, so some frame boundaries of a runtime
// world hold queued commands, and a snapshot cut there has to carry them.
//
// THE RULE FOR A DOUBTFUL PROPERTY IS `state`. A wrong `scratch` or `derived`
// costs a desync; encoding a small array costs a few compressed bytes. Two hash
// comments are known to mislead: `trail` ("derived from tnProgress") is read by
// `trailStrengthFor` and diverged within 20 ticks when poisoned, and
// `stProducesFor` is unhashed yet feeds the runtime's income routes.
//
// `blockedVehicleMask` is the SAME ARRAY as `blocked` while a map has no
// boulders (see its declaration in sim.ts). The encoder must not assume the two
// are distinct arrays.

export type SnapshotClass = 'state' | 'config' | 'derived' | 'scratch';

export type TypedCtor =
  | 'Int8Array'
  | 'Uint8Array'
  | 'Int16Array'
  | 'Uint16Array'
  | 'Int32Array'
  | 'Uint32Array';

/** How long a typed array is, as a function of the world it belongs to. */
export type LengthRule =
  /** `capacity` */
  | 'capacity'
  /** `capacityTimes: k` means `capacity * k` */
  | { readonly capacityTimes: number }
  /** `width * height` */
  | 'cells'
  /** a literal, independent of the world (a sim-internal MAX_* constant) */
  | { readonly fixed: number }
  /** resized at runtime (`fieldLive`, scratch): no length is promised */
  | 'any';

/** What an `object` row holds, so the test can tell a queue from a view. */
export type ObjectShape = 'array' | 'record' | 'flowfield';

export type SnapshotKind =
  /** An integer typed array of the given constructor and length rule. */
  | { readonly t: 'typed'; readonly ctor: TypedCtor; readonly len: LengthRule }
  /** A number (always an integer here) or a boolean. */
  | { readonly t: 'scalar' }
  /** The `Rng` object: its own rows are `RNG_SNAPSHOT_SCHEMA`. */
  | { readonly t: 'rng' }
  /** An array of plain records, encoded in the JSON tail by a per-kind encoder. */
  | { readonly t: 'aux' }
  /** The flow-field pool (Task 4): a parallel array/Map indexed by pool slot. */
  | { readonly t: 'pool' }
  /** Config, derived or scratch objects the snapshot never walks. */
  | { readonly t: 'object'; readonly shape: ObjectShape };

export interface SnapshotRow {
  readonly name: string;
  readonly cls: SnapshotClass;
  readonly kind: SnapshotKind;
}

function typed(ctor: TypedCtor, len: LengthRule): SnapshotKind {
  return { t: 'typed', ctor, len };
}
function obj(shape: ObjectShape): SnapshotKind {
  return { t: 'object', shape };
}
const SCALAR: SnapshotKind = { t: 'scalar' };
const RNG: SnapshotKind = { t: 'rng' };
const AUX: SnapshotKind = { t: 'aux' };
const POOL: SnapshotKind = { t: 'pool' };

export const SIM_SNAPSHOT_SCHEMA: readonly SnapshotRow[] = [
  { name: 'width', cls: 'config', kind: SCALAR },
  { name: 'height', cls: 'config', kind: SCALAR },
  { name: 'capacity', cls: 'config', kind: SCALAR },
  { name: 'tickCount', cls: 'state', kind: SCALAR },
  { name: 'unitTypes', cls: 'config', kind: obj('array') },
  { name: 'rng', cls: 'state', kind: RNG },
  { name: 'blocked', cls: 'state', kind: typed('Uint8Array', 'cells') },
  { name: 'boulder', cls: 'config', kind: typed('Uint8Array', 'cells') },
  { name: 'blockedVehicleMask', cls: 'state', kind: typed('Uint8Array', 'cells') },
  { name: 'hasBoulders', cls: 'config', kind: SCALAR },
  { name: 'cover', cls: 'state', kind: typed('Uint8Array', 'cells') },
  { name: 'elevation', cls: 'state', kind: typed('Uint8Array', 'cells') },
  { name: 'smoke', cls: 'state', kind: typed('Uint8Array', 'cells') },
  { name: 'count', cls: 'state', kind: SCALAR },
  { name: 'alive', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'removed', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'side', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'typeIdx', cls: 'state', kind: typed('Uint16Array', 'capacity') },
  { name: 'posX', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'posY', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'facing', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'hp', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'suppression', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'suppFromX', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'suppFromY', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'suppFromSet', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'moving', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'attackMove', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'sweepOrder', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'goalX', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'goalY', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'fieldRef', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'cooldown', cls: 'state', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'beamTgt', cls: 'state', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'beamDwell', cls: 'state', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'beamHeat', cls: 'state', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'beamAt', cls: 'state', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'beamLock', cls: 'state', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'beamLive', cls: 'state', kind: SCALAR },
  { name: 'lastFired', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'engaging', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'curTarget', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'focusTarget', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'focusLost', cls: 'state', kind: typed('Uint16Array', 'capacity') },
  { name: 'airState', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'airTimer', cls: 'state', kind: typed('Uint16Array', 'capacity') },
  { name: 'airWant', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'airLive', cls: 'state', kind: SCALAR },
  { name: 'figuresUp', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'scars', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'woundParent', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'woundBy', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'woundState', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'bleedTicks', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'woundTimer', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'medState', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'medTarget', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'medTimer', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'speedMul', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'admittedAt', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'woundedAlive', cls: 'state', kind: typed('Int32Array', { fixed: 3 }) },
  { name: 'evacX', cls: 'state', kind: typed('Int32Array', { fixed: MAX_EVAC_POINTS }) },
  { name: 'evacY', cls: 'state', kind: typed('Int32Array', { fixed: MAX_EVAC_POINTS }) },
  { name: 'evacSide', cls: 'state', kind: typed('Int32Array', { fixed: MAX_EVAC_POINTS }) },
  { name: 'evacCount', cls: 'state', kind: SCALAR },
  { name: 'aidPosts', cls: 'state', kind: SCALAR },
  { name: 'deliverId', cls: 'state', kind: SCALAR },
  { name: 'deliverX', cls: 'state', kind: SCALAR },
  { name: 'deliverY', cls: 'state', kind: SCALAR },
  { name: 'woundLive', cls: 'state', kind: SCALAR },
  { name: 'curStructure', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'mobilityKilled', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'mobilityDamaged', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'fieldFixTicks', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'mobLive', cls: 'state', kind: SCALAR },
  { name: 'firepowerKilled', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'pinned', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'stance', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'ambushRadiusSq', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'garrisonedIn', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'garrisonGoal', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'displaced', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'aimTurned', cls: 'scratch', kind: typed('Uint8Array', 'capacity') },
  { name: 'aimDesired', cls: 'scratch', kind: typed('Int32Array', 'capacity') },
  { name: 'aimFrom', cls: 'scratch', kind: typed('Int32Array', 'capacity') },
  { name: 'brace', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'braceTicks', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'braceWant', cls: 'scratch', kind: typed('Uint8Array', 'capacity') },
  { name: 'braceClock', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'demoTicks', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'demoTarget', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'demolishOrder', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'chargeOrder', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'chargeTicks', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'smokeCooldown', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'wpX', cls: 'state', kind: typed('Int32Array', { capacityTimes: 8 }) },
  { name: 'wpY', cls: 'state', kind: typed('Int32Array', { capacityTimes: 8 }) },
  { name: 'wpAttack', cls: 'state', kind: typed('Uint8Array', { capacityTimes: 8 }) },
  { name: 'wpSweep', cls: 'state', kind: typed('Uint8Array', { capacityTimes: 8 }) },
  { name: 'wpCount', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'carriedBy', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'boardGoal', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'passengers', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'tunnelIn', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'surfaceTicks', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'volleyLeft', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'homeTunnel', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'tunnelGoal', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'tunnelEta', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'tnOrderLive', cls: 'state', kind: SCALAR },
  { name: 'patrolX', cls: 'state', kind: typed('Int32Array', { capacityTimes: MAX_PATROL_WAYPOINTS }) },
  { name: 'patrolY', cls: 'state', kind: typed('Int32Array', { capacityTimes: MAX_PATROL_WAYPOINTS }) },
  { name: 'patrolCount', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'patrolIdx', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'patrolLive', cls: 'state', kind: SCALAR },
  { name: 'patrolLegIds', cls: 'state', kind: AUX },
  { name: 'pendingStrikes', cls: 'state', kind: AUX },
  { name: 'structureCount_', cls: 'state', kind: SCALAR },
  { name: 'structureTypes', cls: 'config', kind: obj('array') },
  { name: 'stAlive', cls: 'state', kind: typed('Uint8Array', { fixed: 256 }) },
  { name: 'stHp', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'stMaxHp', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'stTypeIdx', cls: 'state', kind: typed('Uint16Array', { fixed: 256 }) },
  { name: 'stProducesFor', cls: 'state', kind: typed('Int8Array', { fixed: 256 }) },
  { name: 'stOccupants', cls: 'state', kind: typed('Uint8Array', { fixed: 256 }) },
  { name: 'stChargeTicks', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'stChargeBy', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'placedLive', cls: 'state', kind: SCALAR },
  { name: 'stOwner', cls: 'state', kind: typed('Int8Array', { fixed: 256 }) },
  { name: 'stKnown', cls: 'state', kind: typed('Uint8Array', { fixed: 512 }) },
  { name: 'stProgress', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'siteAlive', cls: 'state', kind: typed('Uint8Array', { fixed: MAX_SITES }) },
  { name: 'siteType', cls: 'state', kind: typed('Int16Array', { fixed: MAX_SITES }) },
  { name: 'siteX', cls: 'state', kind: typed('Int32Array', { fixed: MAX_SITES }) },
  { name: 'siteY', cls: 'state', kind: typed('Int32Array', { fixed: MAX_SITES }) },
  { name: 'siteSide', cls: 'state', kind: typed('Int8Array', { fixed: MAX_SITES }) },
  { name: 'siteStructure', cls: 'state', kind: typed('Int32Array', { fixed: MAX_SITES }) },
  { name: 'buildSite', cls: 'state', kind: typed('Int8Array', 'capacity') },
  { name: 'auraHealRate', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'auraHealCap', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'auraCompAt', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'auraRepairTicks', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'auraAccMult', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'fwLive', cls: 'state', kind: SCALAR },
  { name: 'unitAuraLive', cls: 'state', kind: SCALAR },
  { name: 'stRouteMask', cls: 'state', kind: typed('Uint16Array', { fixed: 256 }) },
  { name: 'constructedAt', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'sealQueue', cls: 'scratch', kind: typed('Int32Array', 'cells') },
  { name: 'sealStamp', cls: 'scratch', kind: typed('Int32Array', 'cells') },
  { name: 'sealGen', cls: 'state', kind: SCALAR },
  { name: 'stCx', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'stCy', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'stMinX', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'stMinY', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'stMaxX', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'stMaxY', cls: 'state', kind: typed('Int32Array', { fixed: 256 }) },
  { name: 'stTiles', cls: 'state', kind: AUX },
  { name: 'structureOfTile', cls: 'state', kind: typed('Int32Array', 'cells') },
  { name: 'pinnedTicks', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'routed', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'lastDamagedTick', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'veterancy', cls: 'state', kind: typed('Uint8Array', 'capacity') },
  { name: 'apsAmmo', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'apsReloadLeft', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'apsRecent', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'apsLastTick', cls: 'state', kind: typed('Int32Array', 'capacity') },
  { name: 'contact', cls: 'state', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'contactState', cls: 'state', kind: typed('Uint8Array', { capacityTimes: 2 }) },
  { name: 'seenThisTick', cls: 'scratch', kind: typed('Uint8Array', { capacityTimes: 2 }) },
  { name: 'bestObserver', cls: 'scratch', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'bestObserverP', cls: 'scratch', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'bestObserverStructure', cls: 'scratch', kind: typed('Int16Array', { capacityTimes: 2 }) },
  { name: 'detP', cls: 'scratch', kind: SCALAR },
  { name: 'detStrength', cls: 'scratch', kind: SCALAR },
  { name: 'detSig', cls: 'scratch', kind: SCALAR },
  { name: 'detOccl', cls: 'scratch', kind: SCALAR },
  { name: 'detDistSq', cls: 'scratch', kind: SCALAR },
  { name: 'lastSeenX', cls: 'state', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'lastSeenY', cls: 'state', kind: typed('Int32Array', { capacityTimes: 2 }) },
  { name: 'lastSeenValid', cls: 'state', kind: typed('Uint8Array', { capacityTimes: 2 }) },
  { name: 'tnAlive', cls: 'state', kind: typed('Uint8Array', { fixed: 16 }) },
  { name: 'tnProgress', cls: 'state', kind: typed('Int32Array', { fixed: 16 }) },
  { name: 'tnLength', cls: 'state', kind: typed('Int32Array', { fixed: 16 }) },
  { name: 'tnVentOpen', cls: 'state', kind: typed('Uint8Array', { fixed: 16 }) },
  { name: 'tnOccupants', cls: 'state', kind: typed('Int32Array', { fixed: 16 }) },
  { name: 'tnOwner', cls: 'state', kind: typed('Int8Array', { fixed: 16 }) },
  { name: 'tnCapacity', cls: 'state', kind: typed('Int32Array', { fixed: 16 }) },
  { name: 'tnTravelTicks', cls: 'state', kind: typed('Int32Array', { fixed: 16 }) },
  { name: 'tnDigRate', cls: 'state', kind: typed('Int32Array', { fixed: 16 }) },
  { name: 'tnDigger', cls: 'state', kind: typed('Int32Array', { fixed: 16 }) },
  { name: 'tnPoints', cls: 'config', kind: obj('array') },
  { name: 'tnVentX', cls: 'state', kind: typed('Int32Array', { fixed: 16 }) },
  { name: 'tnVentY', cls: 'state', kind: typed('Int32Array', { fixed: 16 }) },
  { name: 'tnTiles', cls: 'config', kind: obj('array') },
  { name: 'tnContact', cls: 'state', kind: typed('Int32Array', { fixed: 32 }) },
  { name: 'tnContactState', cls: 'state', kind: typed('Uint8Array', { fixed: 32 }) },
  { name: 'tunnelCount_', cls: 'state', kind: SCALAR },
  { name: 'trail', cls: 'state', kind: typed('Uint8Array', 'cells') },
  { name: 'prActive', cls: 'state', kind: typed('Uint8Array', { fixed: 1024 }) },
  { name: 'prShooter', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prTarget', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prStructure', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prCls', cls: 'state', kind: typed('Uint8Array', { fixed: 1024 }) },
  { name: 'prWillHit', cls: 'state', kind: typed('Uint8Array', { fixed: 1024 }) },
  { name: 'prTicksLeft', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prOriginX', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prOriginY', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prAimX', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prAimY', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prPen', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prDamage', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prSupp', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prSplash', cls: 'state', kind: typed('Int32Array', { fixed: 1024 }) },
  { name: 'prWeaponIdx', cls: 'state', kind: typed('Uint16Array', { fixed: 1024 }) },
  { name: 'state', cls: 'config', kind: obj('record') },
  { name: 'structures', cls: 'config', kind: obj('record') },
  { name: 'works', cls: 'config', kind: obj('record') },
  { name: 'seed', cls: 'config', kind: SCALAR },
  { name: 'commandQueue', cls: 'state', kind: AUX },
  { name: 'runtimeQueue', cls: 'state', kind: AUX },
  { name: 'pendingEvents', cls: 'state', kind: AUX },
  { name: 'fields', cls: 'derived', kind: POOL },
  { name: 'fieldByGoal', cls: 'state', kind: POOL },
  { name: 'openGrid', cls: 'config', kind: typed('Uint8Array', 'cells') },
  { name: 'fieldLastIssued', cls: 'state', kind: POOL },
  { name: 'fieldGoalKey', cls: 'state', kind: POOL },
  { name: 'fieldDomain', cls: 'state', kind: POOL },
  { name: 'fieldLive', cls: 'scratch', kind: typed('Uint8Array', 'any') },
  { name: 'humanHeldBySide', cls: 'config', kind: typed('Uint8Array', { fixed: 3 }) },
  { name: 'approachField', cls: 'scratch', kind: obj('flowfield') },
  { name: 'snapX', cls: 'scratch', kind: SCALAR },
  { name: 'snapY', cls: 'scratch', kind: SCALAR },
  { name: 'presentedArc', cls: 'scratch', kind: SCALAR },
  { name: 'engageDSq', cls: 'scratch', kind: SCALAR },
  { name: 'engageOX', cls: 'scratch', kind: SCALAR },
  { name: 'engageOY', cls: 'scratch', kind: SCALAR },
  { name: 'eyeX', cls: 'scratch', kind: SCALAR },
  { name: 'eyeY', cls: 'scratch', kind: SCALAR },
  { name: 'spreadTiles', cls: 'scratch', kind: typed('Int32Array', { fixed: 9 }) },
];

/** `Rng`'s only own property: one mulberry32 word per entity slot. */
export const RNG_SNAPSHOT_SCHEMA: readonly SnapshotRow[] = [
  { name: 'state', cls: 'state', kind: typed('Uint32Array', 'capacity') },
];

/**
 * A `FlowField` inside the pool, derived as a whole: rebuilt from the pool's
 * keys by `compute`, never encoded. `cost` is private; it is read by name.
 */
export const FLOWFIELD_SNAPSHOT_SCHEMA: readonly SnapshotRow[] = [
  { name: 'width', cls: 'derived', kind: SCALAR },
  { name: 'height', cls: 'derived', kind: SCALAR },
  { name: 'dirs', cls: 'derived', kind: typed('Uint8Array', 'cells') },
  { name: 'goalX', cls: 'derived', kind: SCALAR },
  { name: 'goalY', cls: 'derived', kind: SCALAR },
  { name: 'cost', cls: 'derived', kind: typed('Int32Array', 'cells') },
];

/** The rows of one class, in schema (encoding) order. */
export function rowsOf(cls: SnapshotClass, schema: readonly SnapshotRow[] = SIM_SNAPSHOT_SCHEMA): SnapshotRow[] {
  return schema.filter((r) => r.cls === cls);
}
