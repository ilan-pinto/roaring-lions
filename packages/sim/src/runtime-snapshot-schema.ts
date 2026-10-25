import type { LengthRule, SnapshotClass, TypedCtor } from './snapshot-schema';

// The runtime snapshot schema (net sim snapshot, stage 2, Task 1): the ONE table that
// gives every own property of `MissionRuntime`, and of every object it owns, exactly one
// class and a shape. The runtime codec (Task 3) is walked off this table, and
// `runtime-snapshot-schema.test.ts` (with its tools twin for a versus economy room)
// reflects over live runtimes to prove it has no gap and no stale row.
//
// It is the stage-1 schema's sibling (`snapshot-schema.ts`, `SIM_SNAPSHOT_SCHEMA`): the
// same four classes, the same `typed`/`scalar` kinds, the same rule for a doubtful
// property. What a runtime adds is a graph: Maps and Sets of ids, arrays of records,
// records that point at each other, so the kind union grows `array`, `set`, `map`,
// `record`, `ref` and a few leaves. Nothing here encodes: this file only names.
//
// Order is the ENCODING order. It is APPEND-ONLY within a format version: it is the order
// the properties are created in `MissionRuntime` (constructor, then `start()`), as read off
// a live runtime of the golden economy replay (98 own properties, 2026-10-25).
//
// THE FOUR CLASSES (design 2026-10-25-net-sim-snapshot-design.md, 3.1), as they apply here:
//   state     changes during a match and is read later: encoded, written back.
//   config    what the constructor or `start()` derives from the mission, the context, the
//             map or the sim's own config, and NEVER writes after. `buildMatchWorld` (or
//             the replay's setup) rebuilds it, so the snapshot does not carry it.
//   derived   a pure function of state, too large to send: only the `FlowField` inside a
//             `corridorFields` entry. Rebuilt from its key and stamp.
//   scratch   overwritten, in full, before every read, in the same call. Each scratch row
//             carries its evidence in a comment, as `mission.ts` line numbers (the file at
//             this commit; `civilians.ts` for the one row that lives there).
//
// THE RULE FOR A DOUBTFUL PROPERTY IS `state`. A wrong `scratch` costs a desync; encoding
// a small array costs a few compressed bytes. So every CACHE the runtime keeps is `state`
// unless it is trivially overwritten before each read: the `seen*` mask copies,
// `terrainVersion`, `zoneRoutes`, the `rear*` words, `convoyRouteCache`, `corridorFields`,
// `corridorsDirty`, `zoneFrom*` and `ventXY` are all state, because a cache that is empty
// on one peer and warm on the other changes WHEN a route is recomputed (`recheck`), and
// `corridor` events fire on a cause that differs from the last one stored.
//
// A ROW'S CLASS applies to the field of an owned record wherever that record is reached
// through a `state` row. A record reached through a `config` row is not walked at all, so
// its row classes matter only where it is also reached through a `state` one (`LineItem`:
// `enemyMenu` is config, `queue` and `current` are state, so every `LineItem` row is state).
// A `config` row INSIDE a state record (`ProductionLine.anchor`, `ObjectiveState.def`) means
// the same thing as at the top: rebuilt by the world's own setup, compared by the witness,
// never written by the restore.
//
// ALIASING IS PART OF THE SHAPE. Several fields are not values but the same object another
// path holds (`ZoneIncomeState.route` IS an element of `zoneRoutes`; `cutSpan` IS the
// record's own `spanStore`; `HoldView.alive` IS a Sim column). Those are `ref` rows naming
// the target, and the test checks the identity on the live value. Task 2's census proves the
// list of refs is complete; this table is where each one is first written down.
// Two aliases this table does NOT model as refs, left to Task 2: `entityRoster`'s values and
// `rosterPool`'s elements are the objects of `ctx.ledger['roster.surviving_units']` (config),
// and the runtime never mutates them.

export type RuntimeClass = SnapshotClass;

/** How many elements a typed array or an array holds, as a function of the world it belongs to. */
export type RuntimeLength =
  | LengthRule
  /** `zoneCount * times` (the mission's income zones) */
  | { readonly zonesTimes: number }
  /** `riseCount * times` (the high-ground rises `start()` found) */
  | { readonly risesTimes: number }
  /** `ventsKnown * times` (the tunnel vents the runtime has copied) */
  | { readonly ventsTimes: number }
  /** `width * height` when the mission has income zones, else 0 (`zoneTiles`) */
  | 'zoneCells'
  /** `width * height` when the mission has income zones OR a live convoy, else 0 (`seen*`) */
  | 'heldCells';

/** What a `ref` row's value IS: the object it must be identical to, or the family it belongs to. */
export type RefTarget =
  /** the world's `Sim` */
  | 'sim'
  /** the `MissionJson` */
  | 'mission'
  /** the `MissionContext` */
  | 'ctx'
  /** `ctx.roadMask`, or null when the map has no roads */
  | 'ctx.roadMask'
  /** a column of the Sim (`sim.state.*` or a `sim.tn*` array): an alias that must stay the target's OWN */
  | 'sim.column'
  /** a getter or closure that reads through to the Sim or the runtime: rebuilt by the constructor */
  | 'view'
  /** an element of `mission.objectives` (`ObjectiveState.def`) */
  | 'mission.objective'
  /** an element of the runtime's `zoneRoutes` (`ZoneIncomeState.route`) */
  | 'zoneRoutes'
  /** the runtime's `convoyRouteCache` (`ConvoyRoute.route`) */
  | 'convoyRouteCache'
  /** the runtime's `convoySpanStore` (`ConvoyRoute.cutSpan`) */
  | 'convoySpanStore'
  /** the same record's own `spanStore` (`ZoneIncomeState.cutSpan`) */
  | 'spanStore'
  /** an element of the runtime's `worksOfferList` (`WorksEntry.offer`) */
  | 'worksOfferList';

/** The row sets of the objects a `MissionRuntime` owns. */
export type RowSetName =
  | 'ObjectiveState'
  | 'PatrolState'
  | 'CivilianFlight'
  | 'ZoneIncomeState'
  | 'ConvoyRoute'
  | 'ConvoyEntry'
  | 'CorridorField'
  | 'HoldView'
  | 'RouteSource'
  | 'TileScratch'
  | 'IncomeRead'
  | 'WorksEntry'
  | 'WorksOffer'
  | 'WorksCharge'
  | 'WorksStructure'
  | 'ProductionLine'
  | 'LineItem'
  | 'Rally';

interface Nullable {
  /** The value may be null (the row is still present as a property). */
  readonly nullable?: true;
}

export type RuntimeKind =
  /** An integer typed array of the given constructor and length rule. */
  | ({ readonly t: 'typed'; readonly ctor: TypedCtor; readonly len: RuntimeLength } & Nullable)
  /** An integer or a boolean. */
  | { readonly t: 'scalar' }
  /** Any finite number: a DISPLAY value (`incomeRead`), never on a `state` row. */
  | { readonly t: 'number' }
  /** A string; `values`, when given, is the closed set it can take. */
  | ({ readonly t: 'string'; readonly values?: readonly string[] } & Nullable)
  /** An array; `len` is the exact length when it is promised. */
  | ({ readonly t: 'array'; readonly of: RuntimeKind; readonly len?: RuntimeLength } & Nullable)
  /** A Set, in insertion order (which the codec must keep). */
  | ({ readonly t: 'set'; readonly of: RuntimeKind } & Nullable)
  /** A Map, in insertion order (which the codec must keep). */
  | ({ readonly t: 'map'; readonly key: RuntimeKind; readonly value: RuntimeKind } & Nullable)
  /** A plain record or a class instance, with its own row set. */
  | ({ readonly t: 'record'; readonly rows: RowSetName } & Nullable)
  /** An identity, not a value: the object `to` names. */
  | ({ readonly t: 'ref'; readonly to: RefTarget } & Nullable)
  /** A `FlowField`; its own rows are stage 1's `FLOWFIELD_SNAPSHOT_SCHEMA` (all derived). */
  | { readonly t: 'flowfield' }
  /** An opaque JSON record carried through and never inspected (a ledger roster entry). */
  | { readonly t: 'json' }
  /** An array of plain records, encoded in the JSON tail (S1's `aux`). */
  | { readonly t: 'aux' };

export interface RuntimeRow {
  readonly name: string;
  readonly cls: RuntimeClass;
  readonly kind: RuntimeKind;
}

// --- kind builders ---------------------------------------------------------------------

function typed(ctor: TypedCtor, len: RuntimeLength, nullable?: true): RuntimeKind {
  return nullable ? { t: 'typed', ctor, len, nullable } : { t: 'typed', ctor, len };
}
const SCALAR: RuntimeKind = { t: 'scalar' };
const NUMBER: RuntimeKind = { t: 'number' };
const JSON_: RuntimeKind = { t: 'json' };
const AUX: RuntimeKind = { t: 'aux' };
const FLOWFIELD: RuntimeKind = { t: 'flowfield' };
function str(values?: readonly string[], nullable?: true): RuntimeKind {
  const k: { t: 'string'; values?: readonly string[]; nullable?: true } = { t: 'string' };
  if (values !== undefined) k.values = values;
  if (nullable) k.nullable = true;
  return k as RuntimeKind;
}
function array(of: RuntimeKind, len?: RuntimeLength, nullable?: true): RuntimeKind {
  const k: { t: 'array'; of: RuntimeKind; len?: RuntimeLength; nullable?: true } = { t: 'array', of };
  if (len !== undefined) k.len = len;
  if (nullable) k.nullable = true;
  return k as RuntimeKind;
}
function set(of: RuntimeKind): RuntimeKind {
  return { t: 'set', of };
}
function map(key: RuntimeKind, value: RuntimeKind): RuntimeKind {
  return { t: 'map', key, value };
}
function record(rows: RowSetName, nullable?: true): RuntimeKind {
  return nullable ? { t: 'record', rows, nullable } : { t: 'record', rows };
}
function ref(to: RefTarget, nullable?: true): RuntimeKind {
  return nullable ? { t: 'ref', to, nullable } : { t: 'ref', to };
}

const IDS: RuntimeKind = array(SCALAR);
const PAIR: RuntimeKind = array(SCALAR, { fixed: 2 });
const CUT_CAUSES = ['unreachable', 'interdicted', 'vent'] as const;
const OBJECTIVE_STATUSES = ['active', 'complete', 'failed'] as const;
const PAUSES = ['contested', 'unheld'] as const;
const RESULTS = ['ongoing', 'victory', 'defeat'] as const;

// --- the runtime ------------------------------------------------------------------------

export const RUNTIME_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  // The three constructor arguments. Never reassigned (1028-1030).
  { name: 'sim', cls: 'config', kind: ref('sim') },
  { name: 'mission', cls: 'config', kind: ref('mission') },
  { name: 'ctx', cls: 'config', kind: ref('ctx') },

  // One record per authored objective, in authored order, built in the constructor (1040);
  // `status`, `holdTicks` and `paused` are written by `stepObjectives` and `completeObjective`.
  { name: 'objectives', cls: 'state', kind: array(record('ObjectiveState')) },
  // Placement `group` / `tag` -> entity ids. Grown by `spawnPlacement`, which a wave, a
  // spawn / reinforce trigger and a production deploy all call at runtime (3288, 3293).
  { name: 'groups', cls: 'state', kind: map(str(), IDS) },
  { name: 'tags', cls: 'state', kind: map(str(), IDS) },
  // Pushed by `spawnPlacement` (3346) and SPLICED by `stepTriggers` (3864): state.
  { name: 'patrols', cls: 'state', kind: array(record('PatrolState')) },
  { name: 'playerIds', cls: 'state', kind: IDS },
  // config: assigned once, at the end of `start()` (2488); read by `startingCount` / `startingHome`.
  { name: 'startingIds', cls: 'config', kind: IDS },
  { name: 'enemyIds', cls: 'state', kind: IDS },
  // config: `start()` pushes the garrison once (2382); `stepTriggers` only reads it (3817, 3825).
  { name: 'enemyAtStart', cls: 'config', kind: IDS },
  // config: the only `spawnPlacement` call with side 2 is the civilians loop of `start()`
  // (2379), and a trigger, a wave and a production line spawn side 0 or 1 only.
  { name: 'civIds', cls: 'config', kind: IDS },
  { name: 'civFlight', cls: 'state', kind: record('CivilianFlight') },
  { name: 'zoneDeductedAt', cls: 'state', kind: map(str(), SCALAR) },
  // config, the four below: written only inside `start()` (razeTargets 2446, razeExempt 2447,
  // onLoan 2376, collapseTargets 2481) from the mission, the ctx and the map, and read-only after.
  { name: 'razeTargets', cls: 'config', kind: map(str(), IDS) },
  { name: 'razeExempt', cls: 'config', kind: set(SCALAR) },
  { name: 'onLoan', cls: 'config', kind: set(SCALAR) },
  { name: 'collapseTargets', cls: 'config', kind: map(str(), IDS) },
  { name: 'roeScoreValue', cls: 'state', kind: SCALAR },
  { name: 'roeFailed', cls: 'state', kind: SCALAR },
  { name: 'roeGainTotal', cls: 'state', kind: SCALAR },
  { name: 'roeGainJudged', cls: 'state', kind: set(SCALAR) },
  { name: 'aimedAtWounded', cls: 'state', kind: set(SCALAR) },
  { name: 'promotedValue', cls: 'state', kind: SCALAR },
  { name: 'purse', cls: 'state', kind: typed('Int32Array', { fixed: 2 }) },
  { name: 'earnedUnits', cls: 'state', kind: typed('Int32Array', { fixed: 2 }) },
  { name: 'zoneEarnedUnits', cls: 'state', kind: typed('Int32Array', { fixed: 2 }) },

  // --- held ground (F2) ---
  // One record per income zone, in authored order, built in the constructor (1077).
  { name: 'incomeZoneList', cls: 'state', kind: array(record('ZoneIncomeState')) },
  // The record's own contents are state (route, cut, cutSpan); whether it exists is decided by
  // the mission (1099), which is why the row is nullable.
  { name: 'convoy', cls: 'state', kind: record('ConvoyRoute', true) },
  // The storage `ConvoyRoute.cutSpan` aliases (`spanOf(convoySpanStore)`, 2754).
  { name: 'convoySpanStore', cls: 'state', kind: PAIR },
  // config: assigned once in the constructor (1098) from `supply_entry`'s marker; never written after.
  { name: 'convoyEntry', cls: 'config', kind: record('ConvoyEntry', true) },
  { name: 'corridorsDirty', cls: 'state', kind: SCALAR },
  // Keyed by goal tile; the field is `derived` and the stamp is the terrain version it was computed
  // over (`fieldFor`, 1142-1154). A field whose stamp is stale is recomputed whole before it is read.
  { name: 'corridorFields', cls: 'state', kind: map(SCALAR, record('CorridorField')) },
  { name: 'terrainVersion', cls: 'state', kind: SCALAR },
  // Copies of the three masks the routes were computed over, compared byte for byte at every
  // recheck (`syncTerrain`, 2801): a cache, so state.
  { name: 'seenVehicle', cls: 'state', kind: typed('Uint8Array', 'heldCells') },
  { name: 'seenBlocked', cls: 'state', kind: typed('Uint8Array', 'heldCells') },
  { name: 'seenElevation', cls: 'state', kind: typed('Uint8Array', 'heldCells') },
  { name: 'rearX', cls: 'state', kind: typed('Int32Array', { fixed: 2 }) },
  { name: 'rearY', cls: 'state', kind: typed('Int32Array', { fixed: 2 }) },
  { name: 'rearOk', cls: 'state', kind: typed('Uint8Array', { fixed: 2 }) },
  { name: 'rearAnchor', cls: 'state', kind: typed('Int32Array', { fixed: 2 }) },
  { name: 'rearVersion', cls: 'state', kind: typed('Int32Array', { fixed: 2 }) },
  { name: 'zoneFrom', cls: 'state', kind: typed('Int32Array', { zonesTimes: 1 }) },
  { name: 'zoneFromVersion', cls: 'state', kind: typed('Int32Array', { zonesTimes: 1 }) },
  // Two per zone (index 2 * zone + holder side); each slot null or the cached route. A zone's
  // `route` ref points into this array.
  { name: 'zoneRoutes', cls: 'state', kind: array(typed('Int32Array', 'any', true), { zonesTimes: 2 }) },
  { name: 'zoneRouteKey', cls: 'state', kind: typed('Int32Array', { zonesTimes: 8 }) },
  // The convoy's cached route; `ConvoyRoute.route` is this very array.
  { name: 'convoyRouteCache', cls: 'state', kind: typed('Int32Array', 'any', true) },
  { name: 'convoyRouteKey', cls: 'state', kind: typed('Int32Array', { fixed: 3 }) },
  // Vents copied once per route: 2 words each, grown by `syncVents` (2819) to exactly 2 * ventsKnown.
  { name: 'ventXY', cls: 'state', kind: typed('Int32Array', { ventsTimes: 2 }) },
  { name: 'ventsKnown', cls: 'state', kind: SCALAR },
  // scratch: the reused return pair of `holdView.ventAt`. Both words are written (1127-1128) and
  // the array is returned (1129) in the same call, before any caller reads it.
  { name: 'ventOut', cls: 'scratch', kind: PAIR },
  // config: built in the constructor from the zone rects and the map's size (1084), never written after.
  { name: 'zoneTiles', cls: 'config', kind: typed('Uint32Array', 'zoneCells') },
  // config: the same `rect` arrays the zone records hold (1083), in authored order.
  { name: 'zoneRects', cls: 'config', kind: array(array(SCALAR, { fixed: 4 })) },
  // scratch: `zoneStates` assigns out[k] for EVERY k in 0..rects.length-1 (income.ts 139-144) and
  // `stepIncome` calls it (2667) before reading out[k] (2671), in the same call; the array has
  // exactly zoneCount slots (1085).
  { name: 'zoneStateOut', cls: 'scratch', kind: typed('Int32Array', { zonesTimes: 1 }) },
  // config: the constructor's read-only slice of the sim (1106): columns aliased from `sim.state`,
  // getters and closures. Every member is rebuilt by the constructor over the target's own sim.
  { name: 'holdView', cls: 'config', kind: record('HoldView') },
  // config: the constructor's `RouteSource` (1135); its `fieldFor` closes over `corridorFields`.
  { name: 'routeSource', cls: 'config', kind: record('RouteSource') },
  // scratch: `corridorCut` writes span[0] and span[1] unconditionally at its top (corridor.ts 288-290)
  // and `spanOf` reads them (2908-2910) immediately after, at both call sites (2726 then 2727,
  // 2753 then 2754).
  { name: 'cutSpan', cls: 'scratch', kind: typed('Int32Array', { fixed: 2 }) },
  // scratch, both: `zoneStart` writes fromTile before returning true (2938-2939), and its caller reads
  // it only on that branch (2771); `zoneRoute` writes both before `corridorRoute` reads them
  // (2783-2787), and the convoy branch writes rearTile before its call (2745-2747).
  { name: 'fromTile', cls: 'scratch', kind: record('TileScratch') },
  { name: 'rearTile', cls: 'scratch', kind: record('TileScratch') },
  // scratch: the `incomePerMin` getter assigns base, zones and halvedBy (1201-1207) and returns the
  // object in the same call. The numbers are display values and may end in .5.
  { name: 'incomeRead', cls: 'scratch', kind: record('IncomeRead') },
  { name: 'intelValue', cls: 'state', kind: SCALAR },

  // --- field works (#277) ---
  // Resolved lazily by `works()` (1764) the first time anything reads it: null until then. The
  // entries are config-shaped (see WorksEntry) and the one mutable bit lives in `worksOfferList`.
  { name: 'worksList', cls: 'state', kind: array(record('WorksEntry'), undefined, true) },
  { name: 'worksOfferList', cls: 'state', kind: array(record('WorksOffer')) },
  { name: 'worksPending', cls: 'state', kind: array(record('WorksCharge')) },
  { name: 'worksSites', cls: 'state', kind: map(SCALAR, record('WorksCharge')) },
  { name: 'worksStructures', cls: 'state', kind: map(SCALAR, record('WorksStructure')) },

  // --- production ---
  // [side 0's lines, side 1's lines]. The lines and their `side` / `anchor` are built by
  // `buildLines` in `start()` and never added to; queue, current, ticksLeft and rally are state.
  { name: 'lines', cls: 'state', kind: array(array(record('ProductionLine')), { fixed: 2 }) },
  // config: side 1's menu, priced once by `buildEnemyMenu` in `start()` (3065) and read-only after.
  { name: 'enemyMenu', cls: 'config', kind: array(record('LineItem')) },
  // state: pushed per side-1 line by `buildEnemyMenu` (3077) and MOVED by `stepEnemyBuy` (3105).
  { name: 'enemyLast', cls: 'state', kind: IDS },
  // config: the cheapest menu item, set once by `buildEnemyMenu` (3075) and read by `stepEnemyBuy` (3096).
  { name: 'enemyMinCost', cls: 'config', kind: SCALAR },
  // scratch: `firstRefusal` assigns false as its first statement (1427) and sets true at 1453; the only
  // reader (`popCapped`, 1489) calls `firstRefusal` first, in the same expression.
  { name: 'refusedByPopulation', cls: 'scratch', kind: SCALAR },
  { name: 'identified', cls: 'state', kind: set(SCALAR) },
  // config: copied from the incoming ledger in the constructor (1047); read at 3306 and 4205, never written.
  { name: 'marked', cls: 'config', kind: set(str()) },
  { name: 'markedThisMission', cls: 'state', kind: set(str()) },
  { name: 'kills', cls: 'state', kind: map(SCALAR, SCALAR) },
  { name: 'woundedIn', cls: 'state', kind: map(SCALAR, SCALAR) },
  { name: 'rescuedBack', cls: 'state', kind: map(SCALAR, SCALAR) },
  { name: 'woundParentOf', cls: 'state', kind: map(SCALAR, SCALAR) },
  { name: 'contributed', cls: 'state', kind: set(SCALAR) },
  { name: 'paidIdentified', cls: 'state', kind: set(SCALAR) },
  // `intelEarned` events owed to the HUD between steps (`completeObjective`, 2044), drained by `step`.
  { name: 'pendingIntelEvents', cls: 'state', kind: AUX },

  // --- high ground (F1) ---
  // config, the two: assigned once, at the end of `start()`'s structure raising (2361-2362), and
  // read-only after ("a rise never appears or disappears mid-mission").
  { name: 'riseOf', cls: 'config', kind: typed('Int16Array', 'cells') },
  { name: 'riseCount', cls: 'config', kind: SCALAR },
  { name: 'riseHold', cls: 'state', kind: typed('Int32Array', { risesTimes: 1 }) },
  { name: 'risePaid', cls: 'state', kind: typed('Uint8Array', { risesTimes: 1 }) },
  // scratch: `stepHighGround` fills it with 0 (3684) before the first read in the same call (3696 on),
  // and returns before touching it when there are no rises (3680).
  { name: 'riseHolder', cls: 'scratch', kind: typed('Int32Array', { risesTimes: 1 }) },
  { name: 'spawnRise', cls: 'state', kind: typed('Int16Array', 'capacity') },
  { name: 'identifiedBy', cls: 'state', kind: map(SCALAR, SCALAR) },
  { name: 'routeFoundBy', cls: 'state', kind: map(SCALAR, SCALAR) },
  // The ledger's roster entries are opaque to the sim (the app adds `slot` and `enlisted`), so they
  // are `json`. The pool is SPLICED by a `from_ledger` placement (3239), at start or at runtime.
  { name: 'rosterPool', cls: 'state', kind: array(JSON_) },
  { name: 'entityRoster', cls: 'state', kind: map(SCALAR, JSON_) },
  { name: 'firedTriggers', cls: 'state', kind: array(SCALAR) },
  { name: 'spawnedWaves', cls: 'state', kind: array(SCALAR) },
  { name: 'firstContact', cls: 'state', kind: SCALAR },
  { name: 'ended', cls: 'state', kind: SCALAR },
  { name: 'externallyCompleted', cls: 'state', kind: array(str()) },
  { name: 'resultValue', cls: 'state', kind: str(RESULTS) },
  { name: 'withdrawnValue', cls: 'state', kind: SCALAR },
];

// --- the objects a runtime owns -------------------------------------------------------------

/** `ObjectiveState`: one per authored objective. */
export const OBJECTIVE_STATE_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  // config: the authored definition, an element of `mission.objectives` (1040).
  { name: 'def', cls: 'config', kind: ref('mission.objective') },
  { name: 'status', cls: 'state', kind: str(OBJECTIVE_STATUSES) },
  { name: 'holdTicks', cls: 'state', kind: SCALAR },
  { name: 'paused', cls: 'state', kind: str(PAUSES, true) },
];

/** `PatrolState`: a patrolling placement's beat. Created by `spawnPlacement`, spliced by a trigger. */
export const PATROL_STATE_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'id', cls: 'state', kind: SCALAR },
  { name: 'waypoints', cls: 'state', kind: array(array(SCALAR, { fixed: 2 })) },
  { name: 'idx', cls: 'state', kind: SCALAR },
];

/** `CivilianFlight` (civilians.ts): the two latches, the shepherd option, and the sort scratch. */
export const CIVILIAN_FLIGHT_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'fledSet', cls: 'state', kind: set(SCALAR) },
  { name: 'evacuatedSet', cls: 'state', kind: set(SCALAR) },
  // config: the constructor option, `missionShepherds(mission.objectives)` (mission.ts 1033), readonly.
  { name: 'shepherds', cls: 'config', kind: SCALAR },
  // scratch: `foldSet` grows it (civilians.ts 102-105) and writes a[0..n) in its insertion loop
  // (108-115) before it hashes a[0..n) (117-118); it never reads a slot it has not written in the call.
  { name: 'scratch', cls: 'scratch', kind: typed('Int32Array', 'any') },
];

/** `ZoneIncomeState` (mission.ts 461): one income zone, updated in place. */
export const ZONE_INCOME_STATE_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  // config, the three: the constructor's parameter properties (1077), readonly. They come FIRST in the
  // object: TypeScript assigns a parameter property before the field initialisers run.
  { name: 'zone', cls: 'config', kind: str() },
  { name: 'rect', cls: 'config', kind: array(SCALAR, { fixed: 4 }) },
  { name: 'ratePerMin', cls: 'config', kind: SCALAR },
  { name: 'state', cls: 'state', kind: SCALAR },
  { name: 'holder', cls: 'state', kind: SCALAR },
  { name: 'cut', cls: 'state', kind: str(CUT_CAUSES, true) },
  // An element of the runtime's `zoneRoutes`, or null: the same array, not a copy.
  { name: 'route', cls: 'state', kind: ref('zoneRoutes', true) },
  // This record's own `spanStore`, or null.
  { name: 'cutSpan', cls: 'state', kind: ref('spanStore', true) },
  { name: 'spanStore', cls: 'state', kind: PAIR },
];

/** `ConvoyRoute`: the supply convoy's line, `route` and `cutSpan` reused storage. */
export const CONVOY_ROUTE_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'route', cls: 'state', kind: ref('convoyRouteCache', true) },
  { name: 'cut', cls: 'state', kind: str(CUT_CAUSES, true) },
  { name: 'cutSpan', cls: 'state', kind: ref('convoySpanStore', true) },
];

/** The convoy's entry tile (config; assigned once in the constructor). */
export const CONVOY_ENTRY_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'x', cls: 'config', kind: SCALAR },
  { name: 'y', cls: 'config', kind: SCALAR },
];

/** An entry of `corridorFields`: the field (derived) and the terrain version it was computed over. */
export const CORRIDOR_FIELD_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'field', cls: 'derived', kind: FLOWFIELD },
  { name: 'stamp', cls: 'state', kind: SCALAR },
];

/**
 * The read-only slice of the sim that `zoneStates` and `corridorCut` read (mission.ts 1106-1133).
 * Every member is config: either a Sim column ALIASED from `sim.state` / `sim.tn*` (it must stay the
 * target's own, the S1 lesson) or a getter / closure over the Sim or the runtime.
 */
export const HOLD_VIEW_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'entityCount', cls: 'config', kind: ref('view') },
  { name: 'alive', cls: 'config', kind: ref('sim.column') },
  { name: 'side', cls: 'config', kind: ref('sim.column') },
  { name: 'posX', cls: 'config', kind: ref('sim.column') },
  { name: 'posY', cls: 'config', kind: ref('sim.column') },
  { name: 'tunnelIn', cls: 'config', kind: ref('sim.column') },
  { name: 'isAir', cls: 'config', kind: ref('view') },
  { name: 'isDown', cls: 'config', kind: ref('view') },
  { name: 'width', cls: 'config', kind: SCALAR },
  { name: 'tunnelCount', cls: 'config', kind: ref('view') },
  { name: 'tnAlive', cls: 'config', kind: ref('sim.column') },
  { name: 'tnVentOpen', cls: 'config', kind: ref('sim.column') },
  { name: 'tnDigger', cls: 'config', kind: ref('sim.column') },
  { name: 'ventAt', cls: 'config', kind: ref('view') },
];

/** The `RouteSource` the runtime hands `corridorRoute` (mission.ts 1135-1153). All config. */
export const ROUTE_SOURCE_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'width', cls: 'config', kind: SCALAR },
  { name: 'height', cls: 'config', kind: SCALAR },
  // A getter over `sim.blockedVehicle`, the Sim's own vehicle mask (the same array as `blocked` until a boulder lands).
  { name: 'vehicleMask', cls: 'config', kind: ref('sim.column') },
  { name: 'roadMask', cls: 'config', kind: ref('ctx.roadMask', true) },
  { name: 'fieldFor', cls: 'config', kind: ref('view') },
];

/** `fromTile` and `rearTile`: reused tile objects, written before every read (see the two rows). */
export const TILE_SCRATCH_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'x', cls: 'scratch', kind: SCALAR },
  { name: 'y', cls: 'scratch', kind: SCALAR },
];

/** `incomeRead`: refilled by the `incomePerMin` getter. */
export const INCOME_READ_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'base', cls: 'scratch', kind: NUMBER },
  { name: 'zones', cls: 'scratch', kind: NUMBER },
  { name: 'halvedBy', cls: 'scratch', kind: str(CUT_CAUSES, true) },
];

/**
 * `WorksEntry`: what the runtime holds for a listed field work. Built by `works()` the first time
 * anything reads it. `offer` is an element of `worksOfferList`; `structType` is resolved from the
 * mission and the sim's structure types, so the restore rebuilds both by calling `works()` and then
 * writes the offers' `left`.
 */
export const WORKS_ENTRY_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'offer', cls: 'config', kind: ref('worksOfferList') },
  { name: 'structType', cls: 'config', kind: SCALAR },
];

/** `WorksOffer`: the dock row. Only `left` changes (`requestConstruct`, `returnWorks`). */
export const WORKS_OFFER_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'typeId', cls: 'config', kind: str() },
  { name: 'name', cls: 'config', kind: str() },
  { name: 'max', cls: 'config', kind: SCALAR },
  { name: 'left', cls: 'state', kind: SCALAR },
  { name: 'logistics', cls: 'config', kind: SCALAR },
  { name: 'intel', cls: 'config', kind: SCALAR },
];

/** `WorksCharge`: a request charged and awaiting the sim's answer, or a site's payment. Created at runtime. */
export const WORKS_CHARGE_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'typeId', cls: 'state', kind: str() },
  { name: 'structType', cls: 'state', kind: SCALAR },
  { name: 'x', cls: 'state', kind: SCALAR },
  { name: 'y', cls: 'state', kind: SCALAR },
  { name: 'logistics', cls: 'state', kind: SCALAR },
  { name: 'intel', cls: 'state', kind: SCALAR },
];

/** A `worksStructures` value: a staked work, from the sim's `constructStaked`. */
export const WORKS_STRUCTURE_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'typeId', cls: 'state', kind: str() },
  { name: 'site', cls: 'state', kind: SCALAR },
  { name: 'done', cls: 'state', kind: SCALAR },
];

/** `ProductionLine` (production.ts): one camp's serial line. */
export const PRODUCTION_LINE_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  // config, the two: `buildLines` creates every line in `start()` (3119, 3129) with these, readonly.
  { name: 'side', cls: 'config', kind: SCALAR },
  { name: 'anchor', cls: 'config', kind: SCALAR },
  { name: 'queue', cls: 'state', kind: array(record('LineItem')) },
  { name: 'current', cls: 'state', kind: record('LineItem', true) },
  { name: 'ticksLeft', cls: 'state', kind: SCALAR },
  { name: 'rally', cls: 'state', kind: record('Rally', true) },
];

/** `LineItem`: a priced item on a line. Reached through `queue` and `current` (state), so all state. */
export const LINE_ITEM_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'unit', cls: 'state', kind: str() },
  { name: 'logistics', cls: 'state', kind: SCALAR },
  { name: 'intel', cls: 'state', kind: SCALAR },
  { name: 'population', cls: 'state', kind: SCALAR },
  { name: 'buildTicks', cls: 'state', kind: SCALAR },
];

/** A line's rally point, Q16.16. */
export const RALLY_SNAPSHOT_SCHEMA: readonly RuntimeRow[] = [
  { name: 'x', cls: 'state', kind: SCALAR },
  { name: 'y', cls: 'state', kind: SCALAR },
];

/** Every owned record's row set, by name. */
export const RUNTIME_ROW_SETS: Readonly<Record<RowSetName, readonly RuntimeRow[]>> = {
  ObjectiveState: OBJECTIVE_STATE_SNAPSHOT_SCHEMA,
  PatrolState: PATROL_STATE_SNAPSHOT_SCHEMA,
  CivilianFlight: CIVILIAN_FLIGHT_SNAPSHOT_SCHEMA,
  ZoneIncomeState: ZONE_INCOME_STATE_SNAPSHOT_SCHEMA,
  ConvoyRoute: CONVOY_ROUTE_SNAPSHOT_SCHEMA,
  ConvoyEntry: CONVOY_ENTRY_SNAPSHOT_SCHEMA,
  CorridorField: CORRIDOR_FIELD_SNAPSHOT_SCHEMA,
  HoldView: HOLD_VIEW_SNAPSHOT_SCHEMA,
  RouteSource: ROUTE_SOURCE_SNAPSHOT_SCHEMA,
  TileScratch: TILE_SCRATCH_SNAPSHOT_SCHEMA,
  IncomeRead: INCOME_READ_SNAPSHOT_SCHEMA,
  WorksEntry: WORKS_ENTRY_SNAPSHOT_SCHEMA,
  WorksOffer: WORKS_OFFER_SNAPSHOT_SCHEMA,
  WorksCharge: WORKS_CHARGE_SNAPSHOT_SCHEMA,
  WorksStructure: WORKS_STRUCTURE_SNAPSHOT_SCHEMA,
  ProductionLine: PRODUCTION_LINE_SNAPSHOT_SCHEMA,
  LineItem: LINE_ITEM_SNAPSHOT_SCHEMA,
  Rally: RALLY_SNAPSHOT_SCHEMA,
};

/** The rows of one class, in schema (encoding) order. */
export function runtimeRowsOf(cls: RuntimeClass, schema: readonly RuntimeRow[] = RUNTIME_SNAPSHOT_SCHEMA): RuntimeRow[] {
  return schema.filter((r) => r.cls === cls);
}
