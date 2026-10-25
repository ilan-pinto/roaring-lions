import { FlowField } from './flowfield';
import { HASH_SEED, hashWord } from './hash';
import { MISSION_EVENT_KINDS, type MissionRuntime } from './mission';
import {
  RUNTIME_REF_RULES,
  RUNTIME_ROW_SETS,
  RUNTIME_SNAPSHOT_SCHEMA,
  type RefRule,
  type RowSetName,
  type RuntimeKind,
  type RuntimeLength,
  type RuntimeRow,
} from './runtime-snapshot-schema';
import type { Sim } from './sim';
import { SnapshotRefused, canonicalJson, internals, isTyped, type Typed } from './snapshot';
import { MAX_LINE_QUEUE, MAX_PATROL_WAYPOINTS } from './tuning';

// The runtime section of a snapshot (net sim snapshot, stage 2, Task 3): `encodeRuntimeSection`
// writes a `MissionRuntime` and everything it owns, and `planRuntime` + `apply` write it back onto
// the runtime of a freshly built world. `snapshot.ts` calls both and owns the header and the framing
// (`hasRuntime`, the runtime schema digest, a u32 length, the bytes).
//
// THE SECTION is canonical JSON (S1's `canonicalJson`: sorted keys, integers only), built by WALKING
// `RUNTIME_SNAPSHOT_SCHEMA` and the row sets it names, never by reflection over the object:
//   - only `state` rows are written. `config` rows are rebuilt by the target's own setup, `scratch`
//     rows are overwritten before any read, and the one `derived` row (`CorridorField.field`) is rebuilt;
//   - a record is an object of its state rows; a typed array is an integer array;
//   - a Map is an array of [key, value] pairs and a Set an array, both in INSERTION order, never
//     sorted (the runtime iterates them, so the order is state);
//   - a reference is written as `RUNTIME_REF_RULES` says and only the OWNER path holds the value:
//     `index` an index into the owner array (or null), `self` a boolean (is it the owner's value, or
//     null), `ctxIndex` an index into `ctx.ledger['roster.surviving_units']`, the array the context
//     really holds (an explicit accessor; the owner string is never split on '.');
//   - `worksList` / `worksOfferList` are written in their BUILT form. The dock builds them lazily from a
//     UI read (`worksOffers()`), so two peers can differ only by whether the dock was read; an unbuilt
//     list is written as the freshly built default, through the runtime's own builder
//     (`MissionRuntime.buildWorks`, a pure method), and the source is not touched.
//
// RESTORE is two steps. `planRuntime` decodes and validates the WHOLE section against the target, writing
// nothing (shapes, kinds, closed string sets, counts against what the target's setup built, typed-array
// lengths by their rule, entity ids within capacity, references in range, ledger indices within the
// ledger) and refuses with `SnapshotRefused`; `plan.apply()` then writes. The apply step replaces each
// container's CONTENTS and keeps its identity (a Map is cleared and refilled, a typed array of the same
// length is `set`, an array is resized in place, an in-place record has its state fields written), then
// re-links the references, then rebuilds `corridorFields` IN PLACE: `routeSource.fieldFor` closes over
// that Map object. Each entry is a fresh `FlowField`; one whose stamp equals the (restored) `terrainVersion` is
// computed with the same `compute` call `fieldFor` makes but over the runtime's restored MASK COPIES
// (`seenVehicle`, `seenElevation`), the inputs the source used, not the sim's masks as they stand now (see
// `restoreCorridorFields`); a stale entry stays uncomputed, as `fieldFor` recomputes it whole before it is read.

/** The longest runtime section the decoder will read (bytes). A fixed cap, independent of anything decoded. */
export const MAX_RUNTIME_BYTES = 4 * 1024 * 1024;
/** The longest string a runtime row holds (UTF-16 units): unit ids, tag and group names, zone ids. */
const MAX_STRING = 256;
const I32_MIN = -0x80000000;
const I32_MAX = 0x7fffffff;

type Props = Record<string, unknown>;
const props = (o: unknown): Props => o as Props;
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isI32 = (x: unknown): x is number => isInt(x) && x >= I32_MIN && x <= I32_MAX;
const isPlain = (x: unknown): x is Props => x !== null && typeof x === 'object' && !Array.isArray(x);

// ---- the schema, as the codec reads it ---------------------------------------------------

/** Records that already exist on the target (built by its setup) and are written field by field. */
const IN_PLACE: ReadonlySet<RowSetName> = new Set<RowSetName>([
  'ObjectiveState',
  'ZoneIncomeState',
  'ConvoyRoute',
  'CivilianFlight',
  'ProductionLine',
  'WorksEntry',
  'WorksOffer',
]);

const RULE_BY_PATH: ReadonlyMap<string, RefRule> = new Map(RUNTIME_REF_RULES.map((r) => [r.path, r]));

const stateRowsCache = new Map<string, readonly RuntimeRow[]>();
function stateRows(rows: RowSetName | 'MissionRuntime'): readonly RuntimeRow[] {
  let out = stateRowsCache.get(rows);
  if (out === undefined) {
    out = (rows === 'MissionRuntime' ? RUNTIME_SNAPSHOT_SCHEMA : RUNTIME_ROW_SETS[rows]).filter((r) => r.cls === 'state');
    stateRowsCache.set(rows, out);
  }
  return out;
}

/** The one row restored IN PLACE and rebuilt rather than merged. */
const CORRIDOR_ROW = 'corridorFields';

/** Arrays whose COUNT is fixed by the target's own setup: the section must carry exactly that many. */
const FIXED_COUNT_PATHS: ReadonlySet<string> = new Set([
  'MissionRuntime.objectives',
  'MissionRuntime.incomeZoneList',
  'MissionRuntime.firedTriggers',
  'MissionRuntime.spawnedWaves',
  'MissionRuntime.worksList',
  'MissionRuntime.worksOfferList',
  'MissionRuntime.lines[]',
  'MissionRuntime.enemyLast',
]);

// ---- digest --------------------------------------------------------------------------------

function lengthString(len: RuntimeLength): string {
  return typeof len === 'string' ? len : JSON.stringify(len);
}

function kindString(kind: RuntimeKind): string {
  const nullable = 'nullable' in kind && kind.nullable === true ? '?' : '';
  switch (kind.t) {
    case 'typed':
      return `typed:${kind.ctor}:${lengthString(kind.len)}${nullable}`;
    case 'scalar':
      return kind.bool === true ? 'scalar:bool' : 'scalar';
    case 'string':
      return `string:${kind.values === undefined ? '*' : kind.values.join('|')}${nullable}`;
    case 'array':
      return `array<${kindString(kind.of)}>${kind.len === undefined ? '' : ':' + lengthString(kind.len)}${nullable}`;
    case 'set':
      return `set<${kindString(kind.of)}>${nullable}`;
    case 'map':
      return `map<${kindString(kind.key)},${kindString(kind.value)}>${nullable}`;
    case 'record':
      return `record:${kind.rows}${nullable}`;
    case 'ref':
      return `ref:${kind.to}${kind.column === undefined ? '' : ':' + kind.column}${nullable}`;
    default:
      return kind.t;
  }
}

let digestCache: number | null = null;

/**
 * The sim's own `hashWord` folded over every row of the runtime table (name, class, kind), every owned
 * record's rows and every reference rule, in table order. A build whose table differs in any of them, or
 * in their order, gets another number, and `restoreSim` refuses it. Lazy and cached: `snapshot.ts` and this
 * file import each other, so nothing here may run at module load.
 */
export function runtimeSchemaDigest(): number {
  if (digestCache !== null) return digestCache;
  let h = HASH_SEED;
  const fold = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = hashWord(h, s.charCodeAt(i));
  };
  for (const row of RUNTIME_SNAPSHOT_SCHEMA) fold(`MissionRuntime.${row.name}|${row.cls}|${kindString(row.kind)}\n`);
  for (const name of Object.keys(RUNTIME_ROW_SETS) as RowSetName[]) {
    for (const row of RUNTIME_ROW_SETS[name]) fold(`${name}.${row.name}|${row.cls}|${kindString(row.kind)}\n`);
  }
  for (const r of RUNTIME_REF_RULES) fold(`${r.path}|${r.owner}|${r.key}|${r.into ?? ''}|${r.identity ?? ''}\n`);
  digestCache = h >>> 0;
  return digestCache;
}

// ---- the world a section is read against ------------------------------------------------------

interface RuntimeFacts {
  readonly rt: Props;
  readonly sim: Sim;
  readonly capacity: number;
  readonly cells: number;
  /** `ctx.ledger['roster.surviving_units']`, the array the context actually holds (or empty). */
  readonly ledger: readonly unknown[];
}

function factsOf(rt: MissionRuntime, sim: Sim): RuntimeFacts {
  const r = props(rt);
  if (r.sim !== sim) throw new Error('runtime snapshot: the runtime does not belong to this sim');
  const ctx = props(r.ctx);
  const ledger = (ctx.ledger as Record<string, unknown> | undefined)?.['roster.surviving_units'];
  return { rt: r, sim, capacity: sim.capacity, cells: sim.width * sim.height, ledger: Array.isArray(ledger) ? (ledger as unknown[]) : [] };
}

/** The built (default) works lists: a pure function of the mission and the sim's structure types. */
function builtWorks(f: RuntimeFacts): { list: unknown[]; offers: Props[] } {
  return (f.rt as unknown as { buildWorks(): { list: unknown[]; offers: Props[] } }).buildWorks();
}

/** What the section holds for a top-level row: the live value, but the BUILT works lists when unbuilt. */
function rowValue(f: RuntimeFacts, name: string): unknown {
  if (name === 'worksList' || name === 'worksOfferList') {
    if (f.rt.worksList === null) {
      const b = builtWorks(f);
      return name === 'worksList' ? b.list : b.offers;
    }
  }
  return f.rt[name];
}

// ---- encode -------------------------------------------------------------------------------------

function ownerValue(rule: RefRule, parent: Props | null, f: RuntimeFacts): unknown {
  const dot = rule.owner.indexOf('.');
  const head = rule.owner.slice(0, dot);
  const name = rule.owner.slice(dot + 1);
  if (head === 'MissionRuntime') return f.rt[name];
  if (parent === null) throw new Error(`runtime snapshot: rule ${rule.path} names the owner ${rule.owner} outside a record`);
  return parent[name];
}

function encRef(path: string, v: unknown, parent: Props, f: RuntimeFacts): unknown {
  const rule = RULE_BY_PATH.get(path);
  if (rule === undefined) throw new Error(`runtime snapshot: ${path} is a reference with no rule`);
  const owner = ownerValue(rule, parent, f);
  if (rule.key === 'self') {
    if (v === null) return false;
    if (v === owner) return true;
    throw new Error(`runtime snapshot: ${path} is neither null nor ${rule.owner}`);
  }
  if (rule.key === 'index') {
    if (v === null) return null;
    const i = Array.isArray(owner) ? (owner as unknown[]).indexOf(v) : -1;
    if (i < 0) throw new Error(`runtime snapshot: ${path} is not an element of ${rule.owner}`);
    return i;
  }
  throw new Error(`runtime snapshot: ${path} has a ${rule.key} rule, which is not a reference to write`);
}

function encode(v: unknown, kind: RuntimeKind, path: string, parent: Props | null, f: RuntimeFacts): unknown {
  const nullable = 'nullable' in kind && kind.nullable === true;
  if (v === null && nullable) return null;
  switch (kind.t) {
    case 'typed':
      if (!isTyped(v) || v.constructor.name !== kind.ctor) throw new Error(`runtime snapshot: ${path} is not a ${kind.ctor}`);
      return Array.from(v);
    case 'scalar':
      if (kind.bool === true) {
        if (typeof v !== 'boolean') throw new Error(`runtime snapshot: ${path} is not a boolean`);
      } else if (!isI32(v)) throw new Error(`runtime snapshot: ${path} is not an i32 (${String(v)})`);
      return v;
    case 'string':
      if (typeof v !== 'string') throw new Error(`runtime snapshot: ${path} is not a string`);
      return v;
    case 'array':
      if (!Array.isArray(v)) throw new Error(`runtime snapshot: ${path} is not an array`);
      return (v as unknown[]).map((el) => encode(el, kind.of, `${path}[]`, parent, f));
    case 'set':
      if (!(v instanceof Set)) throw new Error(`runtime snapshot: ${path} is not a Set`);
      return Array.from(v as Set<unknown>, (el) => encode(el, kind.of, `${path}{}`, parent, f));
    case 'map':
      if (!(v instanceof Map)) throw new Error(`runtime snapshot: ${path} is not a Map`);
      return Array.from(v as Map<unknown, unknown>, ([k, el]): unknown[] => [
        encode(k, kind.key, `${path}.key()`, parent, f),
        encode(el, kind.value, `${path}.get()`, parent, f),
      ]);
    case 'record': {
      if (typeof v !== 'object' || v === null) throw new Error(`runtime snapshot: ${path} is not a record`);
      const rec = v as Props;
      const out: Props = {};
      for (const row of stateRows(kind.rows)) {
        const child = rec[row.name];
        if (child === undefined) throw new Error(`runtime snapshot: ${kind.rows}.${row.name} is missing`);
        out[row.name] = row.kind.t === 'ref' ? encRef(`${kind.rows}.${row.name}`, child, rec, f) : encode(child, row.kind, `${kind.rows}.${row.name}`, rec, f);
      }
      return out;
    }
    case 'json': {
      const rule = RULE_BY_PATH.get(path);
      if (rule === undefined || rule.key !== 'ctxIndex') throw new Error(`runtime snapshot: ${path} is opaque JSON with no ctxIndex rule`);
      const i = f.ledger.indexOf(v);
      if (i < 0) throw new Error(`runtime snapshot: ${path} is not an element of the ledger roster`);
      return i;
    }
    case 'aux':
      if (!Array.isArray(v)) throw new Error(`runtime snapshot: ${path} is not an array`);
      return v;
    default:
      throw new Error(`runtime snapshot: ${path} has a ${kind.t} kind, which is never state`);
  }
}

/**
 * The canonical bytes of `rt`'s runtime section. Throws a PLAIN Error on a contract fault of its own (a
 * value the table does not allow, an alias with no rule, a section the decoder would refuse): a snapshot
 * that could not be restored is never written. The runtime is not touched.
 */
export function encodeRuntimeSection(rt: MissionRuntime, sim: Sim): Uint8Array {
  const f = factsOf(rt, sim);
  const section: Props = {};
  for (const row of stateRows('MissionRuntime')) {
    section[row.name] = encode(rowValue(f, row.name), row.kind, `MissionRuntime.${row.name}`, null, f);
  }
  const text = canonicalJson(section);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_RUNTIME_BYTES) throw new Error(`runtime snapshot: the section is ${bytes.length} bytes, the limit is ${MAX_RUNTIME_BYTES}`);
  try {
    planRuntime(rt, sim, JSON.parse(text) as unknown);
  } catch (e) {
    if (e instanceof SnapshotRefused) throw new Error(`runtime snapshot: the section would be refused on restore: ${e.reason}`, { cause: e });
    throw e;
  }
  return bytes;
}

// ---- decode and validate -----------------------------------------------------------------------

const refuse = (path: string, why: string): never => {
  throw new SnapshotRefused(`runtime ${path}: ${why}`);
};

/** `[lo, hi]` an integer typed array's elements may take, by constructor. */
const ELEMENT_RANGE: Readonly<Record<string, readonly [number, number]>> = {
  Int8Array: [-0x80, 0x7f],
  Uint8Array: [0, 0xff],
  Int16Array: [-0x8000, 0x7fff],
  Uint16Array: [0, 0xffff],
  Int32Array: [I32_MIN, I32_MAX],
  Uint32Array: [0, 0xffffffff],
};
const TYPED_CTORS: Readonly<Record<string, new (src: number[]) => Typed>> = {
  Int8Array,
  Uint8Array,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
};

/** Scalars (and Map keys) that are entity ids: each in `0..capacity-1`. */
const ENTITY_PATHS: ReadonlySet<string> = new Set([
  'MissionRuntime.groups.get()[]',
  'MissionRuntime.tags.get()[]',
  'MissionRuntime.playerIds[]',
  'MissionRuntime.enemyIds[]',
  'MissionRuntime.roeGainJudged{}',
  'MissionRuntime.aimedAtWounded{}',
  'MissionRuntime.identified{}',
  'MissionRuntime.contributed{}',
  'MissionRuntime.paidIdentified{}',
  'MissionRuntime.kills.key()',
  'MissionRuntime.woundedIn.key()',
  'MissionRuntime.rescuedBack.key()',
  'MissionRuntime.woundParentOf.key()',
  'MissionRuntime.woundParentOf.get()',
  'MissionRuntime.identifiedBy.key()',
  'MissionRuntime.identifiedBy.get()',
  'MissionRuntime.routeFoundBy.get()',
  'MissionRuntime.entityRoster.key()',
  'PatrolState.id',
  'CivilianFlight.fledSet{}',
  'CivilianFlight.evacuatedSet{}',
]);
/** Scalars that are never negative. */
const NONNEG_PATHS: ReadonlySet<string> = new Set([
  'MissionRuntime.kills.get()',
  'MissionRuntime.woundedIn.get()',
  'MissionRuntime.rescuedBack.get()',
  'MissionRuntime.zoneDeductedAt.get()',
  'MissionRuntime.promotedValue',
  'MissionRuntime.roeGainTotal',
  'MissionRuntime.terrainVersion',
  'MissionRuntime.ventsKnown',
  'ObjectiveState.holdTicks',
  'LineItem.logistics',
  'LineItem.intel',
  'LineItem.population',
  'LineItem.buildTicks',
  'ProductionLine.ticksLeft',
  'WorksCharge.logistics',
  'WorksCharge.intel',
]);
const FIXED_RANGE: Readonly<Record<string, readonly [number, number]>> = {
  'MissionRuntime.roeScoreValue': [0, 100],
  'ZoneIncomeState.state': [-2, 1],
  'ZoneIncomeState.holder': [-1, 1],
};
/** Arrays/sets/maps whose entries are bounded by the entity capacity. */
const ENTITY_CAPPED: ReadonlySet<string> = new Set([
  'MissionRuntime.playerIds',
  'MissionRuntime.enemyIds',
  'MissionRuntime.patrols',
  'MissionRuntime.groups.get()',
  'MissionRuntime.tags.get()',
  'MissionRuntime.entityRoster',
  'MissionRuntime.kills',
  'MissionRuntime.woundedIn',
  'MissionRuntime.rescuedBack',
  'MissionRuntime.woundParentOf',
  'MissionRuntime.identifiedBy',
  'MissionRuntime.identified',
  'MissionRuntime.contributed',
  'MissionRuntime.paidIdentified',
  'MissionRuntime.roeGainJudged',
  'MissionRuntime.aimedAtWounded',
  'CivilianFlight.fledSet',
  'CivilianFlight.evacuatedSet',
]);
/** The entries a runtime route holds are tile indices. */
const ROUTE_PATHS: ReadonlySet<string> = new Set(['MissionRuntime.zoneRoutes[]', 'MissionRuntime.convoyRouteCache']);
const MAX_PENDING_INTEL = 256;
const MAX_LOOSE = 1024;

interface Decoder {
  readonly f: RuntimeFacts;
  /** The decoded top-level rows, so a reference can be checked against its owner once everything is read. */
  readonly rows: Props;
  /** Runs once every row is decoded and before anything is written. */
  readonly checks: (() => void)[];
  /** Runs after the writes: re-points every reference at its (restored) owner. */
  readonly links: (() => void)[];
  /** `ventsKnown` and `terrainVersion`, decoded first: later length rules and stamps read them. */
  ventsKnown: number;
  terrainVersion: number;
}

function expectedLength(len: RuntimeLength, d: Decoder): number | null {
  const rt = d.f.rt;
  if (len === 'any') return null;
  if (len === 'capacity') return d.f.capacity;
  if (len === 'cells') return d.f.cells;
  const zones = (rt.incomeZoneList as unknown[]).length;
  if (len === 'zoneCells') return zones > 0 ? d.f.cells : 0;
  if (len === 'heldCells') return zones > 0 || rt.convoy !== null ? d.f.cells : 0;
  if ('capacityTimes' in len) return d.f.capacity * len.capacityTimes;
  if ('fixed' in len) return len.fixed;
  if ('zonesTimes' in len) return zones * len.zonesTimes;
  if ('risesTimes' in len) return (rt.riseCount as number) * len.risesTimes;
  return d.ventsKnown * len.ventsTimes;
}

function scalarRange(path: string, d: Decoder): readonly [number, number] {
  if (ENTITY_PATHS.has(path)) return [0, d.f.capacity - 1];
  if (path === 'MissionRuntime.routeFoundBy.key()') return [0, (internals(d.f.sim).tnAlive as Uint8Array).length - 1];
  if (path === 'MissionRuntime.enemyLast[]') return [-1, (d.f.rt.enemyMenu as unknown[]).length - 1];
  if (path === 'WorksCharge.structType') return [0, d.f.sim.structureTypes.length - 1];
  if (NONNEG_PATHS.has(path)) return [0, I32_MAX];
  return FIXED_RANGE[path] ?? [I32_MIN, I32_MAX];
}

function capFor(path: string, d: Decoder): number {
  if (path === 'MissionRuntime.rosterPool') return d.f.ledger.length;
  if (path === 'ProductionLine.queue') return MAX_LINE_QUEUE;
  if (path === 'MissionRuntime.corridorFields') return d.f.cells;
  if (path === 'MissionRuntime.pendingIntelEvents') return MAX_PENDING_INTEL;
  if (path === 'PatrolState.waypoints') return MAX_PATROL_WAYPOINTS;
  if (ENTITY_CAPPED.has(path)) return d.f.capacity;
  return d.f.capacity > MAX_LOOSE ? d.f.capacity : MAX_LOOSE;
}

function decodeRef(path: string, j: unknown, nullable: boolean, target: Props | undefined, name: string, d: Decoder): unknown {
  const rule = RULE_BY_PATH.get(path);
  if (rule === undefined || target === undefined) return refuse(path, 'a reference with no rule or no target');
  if (rule.key === 'self') {
    if (typeof j !== 'boolean') return refuse(path, 'expected a boolean');
    if (j && rule.owner.startsWith('MissionRuntime.')) {
      const owner = rule.owner.slice('MissionRuntime.'.length);
      d.checks.push(() => {
        if (d.rows[owner] === null) refuse(path, `points at ${rule.owner}, which is empty`);
      });
    }
    d.links.push(() => {
      target[name] = j ? ownerValue(rule, target, d.f) : null;
    });
    return j;
  }
  if (rule.key === 'index') {
    if (j !== null && !isInt(j)) return refuse(path, 'expected an index or null');
    if (j === null && !nullable) return refuse(path, 'null where an index belongs');
    const owner = rule.owner.slice('MissionRuntime.'.length);
    d.checks.push(() => {
      if (j === null) return;
      const arr = d.rows[owner] as unknown[];
      if ((j as number) < 0 || (j as number) >= arr.length || arr[j as number] === null) refuse(path, `index ${String(j)} is not an element of ${rule.owner}`);
    });
    d.links.push(() => {
      target[name] = j === null ? null : (d.f.rt[owner] as unknown[])[j as number];
    });
    return j;
  }
  return refuse(path, `a ${rule.key} rule is not a reference to read`);
}

function decode(j: unknown, kind: RuntimeKind, path: string, target: unknown, d: Decoder): unknown {
  const nullable = 'nullable' in kind && kind.nullable === true;
  if (j === null) {
    if (!nullable) return refuse(path, 'null where a value belongs');
    // A record this world's setup built (the supply convoy) cannot be absent from the snapshot.
    if (kind.t === 'record' && IN_PLACE.has(kind.rows) && target !== null && target !== undefined) return refuse(path, 'this world has such a record');
    return null;
  }
  switch (kind.t) {
    case 'typed': {
      if (!Array.isArray(j)) return refuse(path, 'expected an integer array');
      const want = expectedLength(kind.len, d);
      const routeLike = ROUTE_PATHS.has(path);
      if (want !== null && j.length !== want) return refuse(path, `length ${j.length}, this world has ${want}`);
      if (want === null && j.length > 2 * d.f.cells) return refuse(path, `${j.length} entries, the limit is ${2 * d.f.cells}`);
      const [lo, hi] = routeLike ? [0, d.f.cells - 1] : ELEMENT_RANGE[kind.ctor];
      for (const el of j as unknown[]) {
        if (!isInt(el) || el < lo || el > hi) return refuse(path, `element ${String(el)} is outside ${lo}..${hi}`);
      }
      return new TYPED_CTORS[kind.ctor](j as number[]);
    }
    case 'scalar': {
      if (kind.bool === true) {
        if (typeof j !== 'boolean') return refuse(path, 'expected a boolean');
        return j;
      }
      if (!isI32(j)) return refuse(path, 'expected a 32-bit integer');
      const [lo, hi] = scalarRange(path, d);
      if (j < lo || j > hi) return refuse(path, `${j} is outside ${lo}..${hi}`);
      return j;
    }
    case 'string':
      if (typeof j !== 'string' || j.length > MAX_STRING) return refuse(path, 'expected a string');
      if (kind.values !== undefined && !kind.values.includes(j)) return refuse(path, `"${j}" is not one of ${kind.values.join('|')}`);
      return j;
    case 'array': {
      if (!Array.isArray(j)) return refuse(path, 'expected an array');
      const items = j as unknown[];
      const tgt = Array.isArray(target) ? (target as unknown[]) : undefined;
      let fixed: number | null = null;
      if (kind.len !== undefined) fixed = expectedLength(kind.len, d);
      else if (FIXED_COUNT_PATHS.has(path)) fixed = tgt === undefined ? -1 : tgt.length;
      if (fixed !== null && items.length !== fixed) return refuse(path, `${items.length} entries, this world has ${fixed}`);
      if (fixed === null && items.length > capFor(path, d)) return refuse(path, `${items.length} entries, the limit is ${capFor(path, d)}`);
      return items.map((el, i) => decode(el, kind.of, `${path}[]`, tgt?.[i], d));
    }
    case 'set': {
      if (!Array.isArray(j)) return refuse(path, 'expected an array');
      if (j.length > capFor(path, d)) return refuse(path, `${j.length} members, the limit is ${capFor(path, d)}`);
      const out = new Set<unknown>();
      for (const el of j as unknown[]) out.add(decode(el, kind.of, `${path}{}`, undefined, d));
      if (out.size !== j.length) return refuse(path, 'a repeated member');
      return out;
    }
    case 'map': {
      if (!Array.isArray(j)) return refuse(path, 'expected an array of pairs');
      if (j.length > capFor(path, d)) return refuse(path, `${j.length} entries, the limit is ${capFor(path, d)}`);
      const out = new Map<unknown, unknown>();
      for (const pair of j as unknown[]) {
        if (!Array.isArray(pair) || pair.length !== 2) return refuse(path, 'a pair is not [key, value]');
        const k = decode(pair[0], kind.key, `${path}.key()`, undefined, d);
        out.set(k, decode(pair[1], kind.value, `${path}.get()`, undefined, d));
      }
      if (out.size !== j.length) return refuse(path, 'a repeated key');
      return out;
    }
    case 'record': {
      if (!isPlain(j)) return refuse(path, 'expected a record');
      const rows = stateRows(kind.rows);
      if (Object.keys(j).sort().join(',') !== rows.map((r) => r.name).sort().join(',')) return refuse(path, `fields differ from ${kind.rows}`);
      const tgt = typeof target === 'object' && target !== null ? (target as Props) : undefined;
      if (IN_PLACE.has(kind.rows) && tgt === undefined) return refuse(path, 'this world has no such record');
      const out: Props = {};
      for (const row of rows) {
        const sub = `${kind.rows}.${row.name}`;
        out[row.name] =
          row.kind.t === 'ref'
            ? decodeRef(sub, j[row.name], 'nullable' in row.kind && row.kind.nullable === true, tgt, row.name, d)
            : decode(j[row.name], row.kind, sub, tgt?.[row.name], d);
      }
      checkRecord(kind.rows, out, path);
      return out;
    }
    case 'json': {
      const rule = RULE_BY_PATH.get(path);
      if (rule === undefined || rule.key !== 'ctxIndex') return refuse(path, 'opaque JSON with no ctxIndex rule');
      if (!isInt(j) || j < 0 || j >= d.f.ledger.length) return refuse(path, `index ${String(j)} is outside the ledger roster (${d.f.ledger.length})`);
      return d.f.ledger[j];
    }
    case 'aux': {
      if (!Array.isArray(j) || j.length > capFor(path, d)) return refuse(path, 'expected a short array of events');
      const kinds: readonly string[] = MISSION_EVENT_KINDS;
      for (const e of j as unknown[]) {
        if (!isPlain(e) || typeof e.kind !== 'string' || !kinds.includes(e.kind) || !isInt(e.tick)) return refuse(path, 'a bad event');
      }
      return j;
    }
    default:
      return refuse(path, `a ${kind.t} kind is never state`);
  }
}

/** The cross-field checks of one decoded record. */
function checkRecord(rows: RowSetName, rec: Props, path: string): void {
  if (rows === 'PatrolState') {
    const w = rec.waypoints as unknown[];
    if (w.length < 2) refuse(path, 'a patrol has at least two waypoints');
    const idx = rec.idx as number;
    if (idx < 0 || idx >= w.length) refuse(path, `waypoint ${idx} is outside 0..${w.length - 1}`);
    for (const p of w as unknown[][]) if (p.length !== 2) refuse(path, 'a waypoint is not a pair');
  }
}

// ---- the plan ---------------------------------------------------------------------------------------

/** A decoded, validated section. `apply()` writes it onto the runtime it was planned against. */
export interface RuntimePlan {
  apply(): void;
}

/** Parses the section's bytes: strict UTF-8, JSON, and canonical (re-encoding gives the very text). */
export function parseRuntimeSection(bytes: Uint8Array): unknown {
  if (bytes.length > MAX_RUNTIME_BYTES) throw new SnapshotRefused(`runtime ${bytes.length} bytes, the limit is ${MAX_RUNTIME_BYTES}`);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const section: unknown = JSON.parse(text);
  if (!isPlain(section)) throw new SnapshotRefused('runtime section is not an object');
  // `canonicalJson` throws a plain Error on a fraction or a deeper nesting than it follows: either is not canonical.
  let again: string;
  try {
    again = canonicalJson(section);
  } catch {
    throw new SnapshotRefused('runtime section is not canonical JSON');
  }
  if (again !== text) throw new SnapshotRefused('runtime section is not canonical JSON');
  return section;
}

/**
 * Decodes and validates `section` against the runtime of a world freshly built by the same setup, writing
 * NOTHING; throws `SnapshotRefused` on the first problem. Call `.apply()` on the result to write.
 */
export function planRuntime(rt: MissionRuntime, sim: Sim, section: unknown): RuntimePlan {
  const f = factsOf(rt, sim);
  if (!isPlain(section)) throw new SnapshotRefused('runtime section is not an object');
  const top = stateRows('MissionRuntime');
  if (Object.keys(section).sort().join(',') !== top.map((r) => r.name).sort().join(',')) {
    throw new SnapshotRefused('runtime section rows differ from the table');
  }
  const d: Decoder = { f, rows: {}, checks: [], links: [], ventsKnown: 0, terrainVersion: 0 };

  // The two scalars later rows read, decoded first.
  const vents = section.ventsKnown;
  if (!isInt(vents) || vents < 0 || vents > sim.tunnelCount) refuse('MissionRuntime.ventsKnown', `${String(vents)} is outside 0..${sim.tunnelCount}`);
  d.ventsKnown = vents as number;
  const version = section.terrainVersion;
  if (!isI32(version) || version < 0) refuse('MissionRuntime.terrainVersion', 'expected a non-negative 32-bit integer');
  d.terrainVersion = version as number;

  // worksList / worksOfferList are planned against a throwaway `buildWorks()` result and merged into the target's
  // own lists, which is sound only while neither record has a reference row (a link would point into the throwaway).
  for (const rows of ['WorksEntry', 'WorksOffer'] as const) {
    if (RUNTIME_ROW_SETS[rows].some((r) => r.kind.t === 'ref' && r.cls === 'state')) {
      throw new Error(`runtime snapshot: ${rows} gained a state reference row; the works lists are planned against a throwaway build`);
    }
  }
  const built = builtWorks(f);
  for (const row of top) {
    const live = row.name === 'worksList' ? built.list : row.name === 'worksOfferList' ? built.offers : f.rt[row.name];
    d.rows[row.name] = decode(section[row.name], row.kind, `MissionRuntime.${row.name}`, live, d);
  }
  // The cross-row checks, once everything is decoded.
  for (const c of d.checks) c();
  const offers = d.rows.worksOfferList as Props[];
  for (let i = 0; i < offers.length; i++) {
    const left = offers[i].left as number;
    const max = built.offers[i].max as number;
    if (left < 0 || left > max) refuse('WorksOffer.left', `${left} is outside 0..${max}`);
  }
  const objectiveIds = new Set((props(f.rt.mission).objectives as { id: string }[]).map((o) => o.id));
  for (const id of d.rows.externallyCompleted as string[]) {
    if (!objectiveIds.has(id)) refuse('MissionRuntime.externallyCompleted', `"${id}" is not an objective of this mission`);
  }
  const unitInfo = props(f.rt.ctx).unitInfo;
  if (typeof unitInfo === 'function') {
    const known = (u: string): boolean => (unitInfo as (u: string) => unknown)(u) !== null;
    for (const side of d.rows.lines as Props[][]) {
      for (const line of side) {
        const items = [...(line.queue as Props[]), ...(line.current === null ? [] : [line.current as Props])];
        for (const it of items) if (!known(it.unit as string)) refuse('LineItem.unit', `"${String(it.unit)}" is not a unit this world can build`);
      }
    }
  }
  // Fields: keys are goal tiles, stamps are terrain versions that have existed. A field is only ever computed
  // over the runtime's mask copies, which a world with no income zone and no convoy does not keep.
  const cells = f.cells;
  if ((d.rows.corridorFields as Map<number, unknown>).size > 0 && (d.rows.seenVehicle as Uint8Array).length !== cells) {
    refuse('MissionRuntime.corridorFields', 'fields without the mask copies they are computed over');
  }
  for (const [key, entry] of d.rows.corridorFields as Map<number, Props>) {
    if (!isInt(key) || key < 0 || key >= cells) refuse('MissionRuntime.corridorFields', `goal tile ${String(key)} is outside the map`);
    const stamp = entry.stamp as number;
    if (stamp < -1 || stamp > d.terrainVersion) refuse('CorridorField.stamp', `${stamp} is outside -1..${d.terrainVersion}`);
  }

  return {
    apply(): void {
      applyPlan(f, d);
    },
  };
}

// ---- apply ---------------------------------------------------------------------------------------------

/**
 * Writes `value` over `cur` and returns what the property should hold: the same container where one exists
 * (identity kept), else the decoded one. References are skipped here and re-pointed by the links.
 */
function merge(cur: unknown, kind: RuntimeKind, value: unknown): unknown {
  switch (kind.t) {
    case 'typed':
      if (value !== null && isTyped(cur) && isTyped(value) && cur.length === value.length) {
        (cur as { set(a: ArrayLike<number>): void }).set(value);
        return cur;
      }
      return value;
    case 'set':
      if (cur instanceof Set && value instanceof Set) {
        cur.clear();
        for (const v of value) cur.add(v);
        return cur;
      }
      return value;
    case 'map':
      if (cur instanceof Map && value instanceof Map) {
        cur.clear();
        for (const [k, v] of value) cur.set(k, v);
        return cur;
      }
      return value;
    case 'array':
    case 'aux': {
      if (!Array.isArray(value) || !Array.isArray(cur)) return value;
      const of = kind.t === 'array' ? kind.of : null;
      cur.length = value.length;
      for (let i = 0; i < value.length; i++) cur[i] = of === null ? value[i] : merge(cur[i], of, value[i]);
      return cur;
    }
    case 'record': {
      if (value === null || !IN_PLACE.has(kind.rows) || cur === null || typeof cur !== 'object') return value;
      const rec = cur as Props;
      const src = value as Props;
      for (const row of stateRows(kind.rows)) {
        if (row.kind.t === 'ref') continue;
        rec[row.name] = merge(rec[row.name], row.kind, src[row.name]);
      }
      return rec;
    }
    default:
      return value;
  }
}

function applyPlan(f: RuntimeFacts, d: Decoder): void {
  const rt = f.rt;
  // The dock builds these lazily; the snapshot carries the built form, so build them first (the runtime's own call).
  (rt as unknown as { works(): unknown }).works();
  for (const row of stateRows('MissionRuntime')) {
    if (row.name === CORRIDOR_ROW) continue;
    rt[row.name] = merge(rt[row.name], row.kind, d.rows[row.name]);
  }
  for (const link of d.links) link();
  restoreCorridorFields(f, d);
}

/**
 * `corridorFields`, IN PLACE: `routeSource.fieldFor` closes over this Map object.
 *
 * A current entry is recomputed through the same `FlowField.compute` call `fieldFor` makes, but over the
 * runtime's own COPIES of the masks (`seenVehicle`, `seenElevation`, restored just before), not over the sim's
 * masks as they stand now: the source computed every field inside a recheck, right after `syncTerrain()` had
 * copied the masks, and a mask can change again inside the 20-tick window before the next sync (a works site
 * staked and cancelled) without bumping `terrainVersion`. The copies are exactly the inputs the source used.
 * `routeSource` reads nothing else for a field (width, height, `vehicleMask` for the route BFS only, `roadMask`
 * likewise). A stale entry stays uncomputed: `fieldFor` recomputes it whole before it is read.
 */
function restoreCorridorFields(f: RuntimeFacts, d: Decoder): void {
  const fields = f.rt[CORRIDOR_ROW] as Map<number, { field: FlowField; stamp: number }>;
  const sim = f.sim;
  const seenVehicle = f.rt.seenVehicle as Uint8Array;
  const seenElevation = f.rt.seenElevation as Uint8Array;
  fields.clear();
  for (const [key, entry] of d.rows[CORRIDOR_ROW] as Map<number, Props>) {
    const stamp = entry.stamp as number;
    const field = new FlowField(sim.width, sim.height);
    if (stamp === d.terrainVersion) {
      const x = key % sim.width;
      field.compute(seenVehicle, seenElevation, x, (key - x) / sim.width);
    }
    fields.set(key, { field, stamp });
  }
}
