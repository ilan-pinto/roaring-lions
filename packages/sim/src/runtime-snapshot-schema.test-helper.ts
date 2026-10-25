import { FlowField } from './flowfield';
import type { MissionRuntime } from './mission';
import {
  RUNTIME_REF_RULES,
  RUNTIME_ROW_SETS,
  RUNTIME_SNAPSHOT_SCHEMA,
  type RefRule,
  type RuntimeClass,
  type RuntimeKind,
  type RuntimeLength,
  type RuntimeRow,
} from './runtime-snapshot-schema';
import type { Sim } from './sim';
import { FLOWFIELD_SNAPSHOT_SCHEMA } from './snapshot-schema';

// The reflection behind `runtime-snapshot-schema.test.ts` and its tools twin
// (tools/src/net/snapshot-witness.test.ts): net sim snapshot S2, Task 1. It reflects over a live
// `MissionRuntime` and returns every complaint, naming the path, on an own property with no row, a
// row naming no property, an order that is not creation order, and any value whose shape is not the
// one its row's kind promises (typed array constructor and length rule, Map / Set / array contents,
// references by identity, closed string sets). The file name is not matched by vitest's `*.test.ts`
// glob on purpose, as `golden-worlds.test-helper.ts`: it holds no spec, so importing it from two
// test files runs nothing twice.

export type Props = Record<string, unknown>;
export const props = (o: unknown): Props => o as Props;

/** What the length rules read: facts of the world the value belongs to. */
export interface Env {
  readonly rt: MissionRuntime;
  readonly sim: Sim;
  /** Rows (as "RowSet.row" or "MissionRuntime.row") whose value was seen POPULATED at least once. */
  readonly seen: Set<string>;
}

const cellsOf = (sim: Sim): number => sim.width * sim.height;

export function lengthOf(rule: RuntimeLength, env: Env): number | null {
  const rt = props(env.rt);
  if (rule === 'any') return null;
  if (rule === 'capacity') return env.sim.capacity;
  if (rule === 'cells') return cellsOf(env.sim);
  if (rule === 'zoneCells') return (rt.incomeZoneList as unknown[]).length > 0 ? cellsOf(env.sim) : 0;
  if (rule === 'heldCells') return (rt.incomeZoneList as unknown[]).length > 0 || rt.convoy !== null ? cellsOf(env.sim) : 0;
  if ('capacityTimes' in rule) return env.sim.capacity * rule.capacityTimes;
  if ('fixed' in rule) return rule.fixed;
  if ('zonesTimes' in rule) return (rt.incomeZoneList as unknown[]).length * rule.zonesTimes;
  if ('risesTimes' in rule) return (rt.riseCount as number) * rule.risesTimes;
  return (rt.ventsKnown as number) * rule.ventsTimes;
}

function show(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (ArrayBuffer.isView(v)) return `${(v as object).constructor.name}[${(v as unknown as { length: number }).length}]`;
  if (Array.isArray(v)) return `Array[${v.length}]`;
  if (v instanceof Map) return `Map[${v.size}]`;
  if (v instanceof Set) return `Set[${v.size}]`;
  if (typeof v === 'function') return 'function';
  if (typeof v === 'object') return (v as object).constructor.name;
  return `${typeof v} ${String(v)}`;
}

/** `sim.<column>` for a dotted column name (`state.alive`, `tnAlive`, `blockedVehicle`), or undefined. */
export function simColumnOf(sim: Sim, column: string): unknown {
  let at: unknown = sim;
  for (const part of column.split('.')) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Props)[part];
  }
  return at;
}

function refHolds(kind: Extract<RuntimeKind, { t: 'ref' }>, v: unknown, owner: Props, env: Env): boolean {
  const rt = props(env.rt);
  switch (kind.to) {
    case 'sim':
      return v === env.sim;
    case 'mission':
      return v === rt.mission;
    case 'ctx':
      return v === rt.ctx;
    case 'ctx.roadMask':
      return v === (rt.ctx as { roadMask?: Uint8Array }).roadMask || (v === null && (rt.ctx as { roadMask?: Uint8Array }).roadMask === undefined);
    case 'sim.column': {
      // The EXACT column the row names, by identity: a view over the wrong one (or a copy) is not it.
      if (kind.column === undefined) return false;
      const col = simColumnOf(env.sim, kind.column);
      return ArrayBuffer.isView(col) && v === col;
    }
    case 'view':
      return typeof v === 'function' || typeof v === 'number';
    case 'mission.objective':
      return (props(rt.mission).objectives as unknown[]).includes(v);
    case 'zoneRoutes':
      return (rt.zoneRoutes as unknown[]).includes(v);
    case 'convoyRouteCache':
      return v === rt.convoyRouteCache;
    case 'convoySpanStore':
      return v === rt.convoySpanStore;
    case 'spanStore':
      return v === owner.spanStore;
    case 'worksOfferList':
      return (rt.worksOfferList as unknown[]).includes(v);
  }
}

/**
 * What the JSON tail can carry, checked by walking the value: null, a boolean, a string, a safe
 * integer, a plain object, an array. `undefined` (JSON drops it, so a restore would not equal its
 * source), a float, NaN, a function, a Map, a typed array or any class instance is a complaint.
 */
export function jsonComplaints(at: string, v: unknown): string[] {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return [];
  if (typeof v === 'number') return Number.isSafeInteger(v) ? [] : [`${at}: JSON carries only safe integers, found ${show(v)}`];
  if (Array.isArray(v)) return v.flatMap((el, i) => jsonComplaints(`${at}[${i}]`, el));
  if (typeof v === 'object') {
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return [`${at}: JSON carries plain objects, found ${show(v)}`];
    return Object.keys(v).flatMap((k) => jsonComplaints(`${at}.${k}`, (v as Props)[k]));
  }
  return [`${at}: JSON cannot carry ${show(v)}`];
}

/** Every complaint about one value against one kind. `at` is the path; `key` is the row it is read for. */
function checkKind(at: string, v: unknown, kind: RuntimeKind, owner: Props, env: Env, key: string): string[] {
  const out: string[] = [];
  const nullable = 'nullable' in kind && kind.nullable === true;
  if (v === null && nullable) return out;
  switch (kind.t) {
    case 'typed': {
      if (!ArrayBuffer.isView(v) || (v as object).constructor.name !== kind.ctor) {
        out.push(`${at}: expected ${kind.ctor}, found ${show(v)}`);
        break;
      }
      const want = lengthOf(kind.len, env);
      const got = (v as unknown as { length: number }).length;
      if (want !== null && got !== want) out.push(`${at}: length ${got}, rule says ${want}`);
      if (got > 0) env.seen.add(key);
      break;
    }
    case 'scalar':
      if (kind.bool === true) {
        if (typeof v !== 'boolean') out.push(`${at}: expected a boolean, found ${show(v)}`);
        else env.seen.add(key);
      } else if (typeof v !== 'number' || !Number.isInteger(v)) out.push(`${at}: expected an integer, found ${show(v)}`);
      else env.seen.add(key);
      break;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) out.push(`${at}: expected a finite number, found ${show(v)}`);
      else env.seen.add(key);
      break;
    case 'string':
      if (typeof v !== 'string') out.push(`${at}: expected a string, found ${show(v)}`);
      else if (kind.values !== undefined && !kind.values.includes(v)) out.push(`${at}: "${v}" is not one of ${kind.values.join('|')}`);
      else env.seen.add(key);
      break;
    case 'array': {
      if (!Array.isArray(v)) {
        out.push(`${at}: expected an array, found ${show(v)}`);
        break;
      }
      if (kind.len !== undefined) {
        const want = lengthOf(kind.len, env);
        if (want !== null && v.length !== want) out.push(`${at}: length ${v.length}, rule says ${want}`);
      }
      if (v.length > 0) env.seen.add(key);
      v.forEach((el, i) => out.push(...checkKind(`${at}[${i}]`, el, kind.of, owner, env, key)));
      break;
    }
    case 'set': {
      if (!(v instanceof Set)) {
        out.push(`${at}: expected a Set, found ${show(v)}`);
        break;
      }
      if (v.size > 0) env.seen.add(key);
      let i = 0;
      for (const el of v) out.push(...checkKind(`${at}{${i++}}`, el, kind.of, owner, env, key));
      break;
    }
    case 'map': {
      if (!(v instanceof Map)) {
        out.push(`${at}: expected a Map, found ${show(v)}`);
        break;
      }
      if (v.size > 0) env.seen.add(key);
      for (const [k, el] of v) {
        out.push(...checkKind(`${at}.key(${String(k)})`, k, kind.key, owner, env, key));
        out.push(...checkKind(`${at}.get(${String(k)})`, el, kind.value, owner, env, key));
      }
      break;
    }
    case 'record': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        out.push(`${at}: expected a record (${kind.rows}), found ${show(v)}`);
        break;
      }
      env.seen.add(key);
      out.push(...checkRows(at, v, RUNTIME_ROW_SETS[kind.rows], env, kind.rows));
      break;
    }
    case 'ref':
      if (!refHolds(kind, v, owner, env)) out.push(`${at}: expected a reference to ${kind.to}${kind.column === undefined ? '' : ` ${kind.column}`}, found ${show(v)}`);
      else env.seen.add(key);
      break;
    case 'flowfield':
      if (!(v instanceof FlowField)) {
        out.push(`${at}: expected a FlowField, found ${show(v)}`);
        break;
      }
      env.seen.add(key);
      out.push(...checkFlowField(at, v, env));
      break;
    case 'json': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        out.push(`${at}: expected a JSON record, found ${show(v)}`);
        break;
      }
      const bad = jsonComplaints(at, v);
      out.push(...bad);
      if (bad.length === 0) env.seen.add(key);
      break;
    }
    case 'aux': {
      if (!Array.isArray(v)) {
        out.push(`${at}: expected an array, found ${show(v)}`);
        break;
      }
      const bad = v.flatMap((el, i) => (el === null || typeof el !== 'object' || Array.isArray(el) ? [`${at}[${i}]: expected a JSON record, found ${show(el)}`] : jsonComplaints(`${at}[${i}]`, el)));
      out.push(...bad);
      if (bad.length === 0 && v.length > 0) env.seen.add(key);
      break;
    }
  }
  return out;
}

/** A FlowField against stage 1's rows (all derived): its own names both ways, typed arrays by cells. */
function checkFlowField(at: string, f: FlowField, env: Env): string[] {
  const out: string[] = [];
  const o = props(f);
  const named = new Set(FLOWFIELD_SNAPSHOT_SCHEMA.map((r) => r.name));
  for (const k of Object.keys(o)) if (!named.has(k)) out.push(`${at}: FlowField property "${k}" has no row`);
  for (const r of FLOWFIELD_SNAPSHOT_SCHEMA) {
    if (!(r.name in o)) {
      out.push(`${at}: FlowField row "${r.name}" names no property`);
      continue;
    }
    const v = o[r.name];
    if (r.kind.t === 'typed') {
      if (!ArrayBuffer.isView(v) || (v as object).constructor.name !== r.kind.ctor) out.push(`${at}.${r.name}: expected ${r.kind.ctor}, found ${show(v)}`);
      else if (r.kind.len === 'cells' && (v as unknown as { length: number }).length !== cellsOf(env.sim)) out.push(`${at}.${r.name}: length is not width * height`);
    } else if (r.kind.t === 'scalar' && !(typeof v === 'number' && Number.isInteger(v))) {
      out.push(`${at}.${r.name}: expected an integer, found ${show(v)}`);
    }
  }
  return out;
}

/** Every complaint about one object against a row set. Empty means clean. `set` names the row set for the census. */
export function checkRows(label: string, owner: unknown, rows: readonly RuntimeRow[], env: Env, set: string): string[] {
  const complaints: string[] = [];
  const o = props(owner);
  const have = Object.keys(o);
  const named = new Set<string>();
  for (const row of rows) {
    if (named.has(row.name)) complaints.push(`${label}: duplicate row "${row.name}"`);
    named.add(row.name);
  }
  for (const k of have) if (!named.has(k)) complaints.push(`${label}: property "${k}" has no row`);
  for (const row of rows) if (!have.includes(row.name)) complaints.push(`${label}: row "${row.name}" names no property`);
  // Creation order: the table is the encoding order, so it must be the order the object was built in.
  const want = rows.filter((r) => have.includes(r.name)).map((r) => r.name);
  const known = have.filter((k) => named.has(k));
  if (want.join() !== known.join()) complaints.push(`${label}: rows are in a different order than the properties (${known.join()} vs ${want.join()})`);
  for (const row of rows) {
    if (!have.includes(row.name)) continue;
    complaints.push(...checkKind(`${label}.${row.name}`, o[row.name], row.kind, o, env, `${set}.${row.name}`));
  }
  return complaints;
}

/** The runtime against its own table. */
export function checkRuntime(label: string, rt: MissionRuntime, sim: Sim, seen: Set<string>): string[] {
  return checkRows(label, rt, RUNTIME_SNAPSHOT_SCHEMA, { rt, sim, seen }, 'MissionRuntime');
}

// --- the aliasing census (net sim snapshot S2, Task 2) ---------------------------------------------

export type ReachClass = RuntimeClass | 'foreign';

/** One way an object is reached: a normalised schema path (`RowSet.row`, `[]` an element, `{}` a Set
 *  member, `.get()` a Map value), the concrete path it was found at, and the class of the row it hangs
 *  from. `foreign` is the Sim, the mission JSON or the context: an object the runtime does not own. */
export interface Reach {
  readonly path: string;
  readonly concrete: string;
  readonly cls: ReachClass;
}

/** An object reached by two or more paths, at least one of them inside the runtime. */
export interface Alias {
  readonly reaches: readonly Reach[];
}

const FOREIGN_DEPTH = 14;

/** Every object reachable from the Sim, the mission and the context, with the first path it was found at. */
function foreignObjects(rt: MissionRuntime, sim: Sim): Map<object, string> {
  const out = new Map<object, string>();
  const rtp = props(rt);
  const visit = (v: unknown, path: string, depth: number): void => {
    if (v === null || typeof v !== 'object' || out.has(v) || depth > FOREIGN_DEPTH) return;
    out.set(v, path);
    if (ArrayBuffer.isView(v)) return;
    if (v instanceof Map) {
      for (const [k, el] of v) visit(el, `${path}.get(${String(k)})`, depth + 1);
    } else if (v instanceof Set) {
      let i = 0;
      for (const el of v) visit(el, `${path}{${i++}}`, depth + 1);
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const el: unknown = v[i];
        if (el !== null && typeof el === 'object') visit(el, `${path}[${i}]`, depth + 1);
      }
    } else {
      for (const k of Object.keys(v)) visit((v as Props)[k], `${path}.${k}`, depth + 1);
    }
  };
  visit(sim, 'sim', 0);
  visit(rtp.mission, 'mission', 0);
  visit(rtp.ctx, 'ctx', 0);
  return out;
}

/**
 * Walk the runtime along its schema (every class, so a `state` row that points into a `config` one is
 * seen from both sides) and return every object reached by two or more paths, the Sim, the mission and
 * the context counting as paths too. Functions are not objects here: a closure's captures are the
 * business of `probeClosures`.
 */
export function collectAliases(rt: MissionRuntime, sim: Sim): Alias[] {
  const foreign = foreignObjects(rt, sim);
  const reached = new Map<object, Reach[]>();
  const note = (v: object, path: string, concrete: string, cls: ReachClass): void => {
    let list = reached.get(v);
    if (list === undefined) reached.set(v, (list = []));
    list.push({ path, concrete, cls });
  };
  // An opaque JSON value: its top-level object and any object nested in it.
  const walkOpaque = (v: unknown, path: string, concrete: string, cls: ReachClass): void => {
    if (v === null || typeof v !== 'object') return;
    note(v, path, concrete, cls);
    if (Array.isArray(v)) v.forEach((el, i) => walkOpaque(el, `${path}[]`, `${concrete}[${i}]`, cls));
    else for (const k of Object.keys(v)) walkOpaque((v as Props)[k], `${path}.${k}`, `${concrete}.${k}`, cls);
  };
  const walk = (v: unknown, kind: RuntimeKind, path: string, concrete: string, cls: ReachClass): void => {
    if (v === null || typeof v !== 'object') return;
    switch (kind.t) {
      case 'array':
        note(v, path, concrete, cls);
        if (Array.isArray(v)) v.forEach((el, i) => walk(el, kind.of, `${path}[]`, `${concrete}[${i}]`, cls));
        return;
      case 'set': {
        note(v, path, concrete, cls);
        let i = 0;
        if (v instanceof Set) for (const el of v) walk(el, kind.of, `${path}{}`, `${concrete}{${i++}}`, cls);
        return;
      }
      case 'map':
        note(v, path, concrete, cls);
        if (v instanceof Map) for (const [k, el] of v) walk(el, kind.value, `${path}.get()`, `${concrete}.get(${String(k)})`, cls);
        return;
      case 'record':
        note(v, path, concrete, cls);
        for (const row of RUNTIME_ROW_SETS[kind.rows]) {
          walk((v as Props)[row.name], row.kind, `${kind.rows}.${row.name}`, `${concrete}.${row.name}`, row.cls);
        }
        return;
      case 'json':
      case 'aux':
        walkOpaque(v, path, concrete, cls);
        return;
      case 'flowfield':
        note(v, path, concrete, cls);
        for (const [name, el] of Object.entries(v as Props)) if (el !== null && typeof el === 'object') note(el, `${path}.${name}`, `${concrete}.${name}`, cls);
        return;
      default:
        note(v, path, concrete, cls);
    }
  };
  for (const row of RUNTIME_SNAPSHOT_SCHEMA) walk(props(rt)[row.name], row.kind, `MissionRuntime.${row.name}`, row.name, row.cls);
  const out: Alias[] = [];
  for (const [obj, list] of reached) {
    const reaches: Reach[] = [...list];
    const f = foreign.get(obj);
    if (f !== undefined) reaches.push({ path: `foreign:${f}`, concrete: f, cls: 'foreign' });
    if (reaches.length >= 2) out.push({ reaches });
  }
  return out;
}

/** The key a rule is counted under. */
export const ruleKey = (r: Pick<RefRule, 'path' | 'owner'>): string => `${r.path} -> ${r.owner}`;

/** The path at which the OWNER of a rule is reached: its row, plus `[]` when the alias is one element. */
const ownerReachPath = (r: RefRule): string => (r.key === 'index' ? `${r.owner}[]` : r.owner);

/** Which constructor argument a foreign path belongs to: `foreign:sim.alive` is `sim`. */
const foreignRoot = (path: string): string => path.slice('foreign:'.length).split(/[.[{]/)[0];

export interface CensusResult {
  /** One line per alias no rule explains, naming every path it is reached by. */
  readonly unruled: string[];
  /** The rules that explained at least one alias (`ruleKey`). */
  readonly used: Set<string>;
}

/**
 * Explain every alias with the rules, or name it. An alias is explained when ONE owner covers it: every
 * other path that reaches the object has a rule naming that owner. Two kinds of owner:
 *   a runtime path (`MissionRuntime.zoneRoutes[]`): each other reach has a rule `{ path, owner }`;
 *   `config`: the object is also held by the Sim, the mission, the context or by a config row. Each
 *   non-config reach of the runtime has a `config` rule, and when ALL the reaches are config (a view of
 *   a Sim column) each runtime reach has one, naming the side it is on in `into`. An alias between a
 *   runtime path and a Sim column is therefore accepted only as `config`; anything else is unruled.
 */
export function explainAliases(aliases: readonly Alias[], rules: readonly RefRule[] = RUNTIME_REF_RULES): CensusResult {
  const unruled: string[] = [];
  const used = new Set<string>();
  const ruleFor = (path: string, owner: string): RefRule | undefined => rules.find((r) => r.path === path && r.owner === owner);
  for (const alias of aliases) {
    const runtime = alias.reaches.filter((r) => r.cls !== 'foreign');
    const foreign = alias.reaches.filter((r) => r.cls === 'foreign');
    const applied: RefRule[] = [];
    let explained = false;
    // (a) the other side is config: the Sim, the mission, the context, or a config row.
    const configSide = alias.reaches.some((r) => r.cls === 'config' || r.cls === 'foreign');
    if (configSide) {
      const into = foreign.length > 0 ? foreignRoot(foreign[0].path) : 'runtime';
      const need = runtime.filter((r) => (runtime.some((q) => q.cls !== 'config') ? r.cls !== 'config' : true));
      const got = need.map((r) => ruleFor(r.path, 'config'));
      if (need.length > 0 && got.every((r) => r !== undefined && r.into === into)) {
        applied.push(...(got as RefRule[]));
        explained = true;
      }
    }
    // (b) one of the runtime paths owns it.
    if (!explained) {
      for (const owner of new Set(runtime.map((r) => r.path))) {
        const owned = rules.filter((r) => r.owner !== 'config' && ownerReachPath(r) === owner);
        const rest = runtime.filter((r) => r.path !== owner || runtime.filter((q) => q.path === owner).length > 1);
        const covering = rest.map((r) => owned.find((o) => o.path === r.path));
        if (rest.length > 0 && foreign.length === 0 && covering.every((o) => o !== undefined)) {
          applied.push(...(covering as RefRule[]));
          explained = true;
          break;
        }
      }
    }
    if (explained) for (const r of applied) used.add(ruleKey(r));
    else unruled.push(`unruled alias: ${alias.reaches.map((r) => `${r.concrete} (${r.path})`).join(' == ')}`);
  }
  return { unruled, used };
}

/**
 * The closures the runtime builds capture containers by identity, which no object walk can see. This
 * calls each one and checks it reaches the live row: `routeSource.fieldFor` must file the field it
 * computes in the runtime's OWN `corridorFields` Map. It leaves the runtime as it found it (the entry
 * it adds is deleted again). Returns the rule keys it proved and any complaint. Task 3's restore calls
 * it on the restored runtime to prove the Map was filled in place.
 */
export function probeClosures(rt: MissionRuntime, sim: Sim): { used: string[]; complaints: string[] } {
  const complaints: string[] = [];
  const used: string[] = [];
  const fields = props(rt).corridorFields as Map<number, { field: unknown; stamp: number }>;
  const source = props(rt).routeSource as { fieldFor(gx: number, gy: number): unknown };
  let goal = -1;
  for (let k = 0; k < sim.width * sim.height && goal < 0; k++) if (!fields.has(k) && sim.blockedVehicle[k] === 0) goal = k;
  if (goal < 0) return { used, complaints: ['routeSource.fieldFor: no free goal tile to probe with'] };
  const before = fields.size;
  const x = goal % sim.width;
  const field = source.fieldFor(x, (goal - x) / sim.width);
  const entry = fields.get(goal);
  if (fields.size !== before + 1 || entry === undefined || entry.field !== field) {
    complaints.push('routeSource.fieldFor: the field it computed is not in the runtime\'s corridorFields (the closure holds a different Map)');
  } else {
    used.push(ruleKey({ path: 'RouteSource.fieldFor', owner: 'MissionRuntime.corridorFields' }));
  }
  fields.delete(goal);
  return { used, complaints };
}

/** One world, one moment: collect, explain, probe. The result is folded into `acc`. */
export interface CensusAccumulator {
  readonly used: Set<string>;
  readonly failures: string[];
  /** Every distinct alias shape seen, as "paths == paths", with the first world it was seen in. */
  readonly seen: Map<string, string>;
}
export const newCensus = (): CensusAccumulator => ({ used: new Set(), failures: [], seen: new Map() });

export function censusAt(label: string, rt: MissionRuntime, sim: Sim, acc: CensusAccumulator, probe: boolean): void {
  const aliases = collectAliases(rt, sim);
  const r = explainAliases(aliases);
  for (const u of r.unruled) acc.failures.push(`${label}: ${u}`);
  for (const k of r.used) acc.used.add(k);
  for (const a of aliases) {
    const shape = [...new Set(a.reaches.map((x) => x.path))].sort().join(' == ');
    if (!acc.seen.has(shape)) acc.seen.set(shape, label);
  }
  if (probe) {
    const p = probeClosures(rt, sim);
    for (const c of p.complaints) acc.failures.push(`${label}: ${c}`);
    for (const k of p.used) {
      acc.used.add(k);
      if (!acc.seen.has(k)) acc.seen.set(k, label);
    }
  }
}

/** Rules no alias used and no probe proved, as "unused rule: ...". */
export function unusedRules(used: ReadonlySet<string>, rules: readonly RefRule[] = RUNTIME_REF_RULES): string[] {
  return rules.filter((r) => !used.has(ruleKey(r))).map((r) => `unused rule: ${ruleKey(r)}`);
}

/** Every normalised path the schema can produce, with its class and kind: what a rule may name. */
export function schemaPaths(): Map<string, { cls: ReachClass; kind: RuntimeKind }> {
  const out = new Map<string, { cls: ReachClass; kind: RuntimeKind }>();
  const walk = (kind: RuntimeKind, path: string, cls: ReachClass): void => {
    out.set(path, { cls, kind });
    if (kind.t === 'array') walk(kind.of, `${path}[]`, cls);
    else if (kind.t === 'set') walk(kind.of, `${path}{}`, cls);
    else if (kind.t === 'map') walk(kind.value, `${path}.get()`, cls);
    else if (kind.t === 'record') for (const r of RUNTIME_ROW_SETS[kind.rows]) walk(r.kind, `${kind.rows}.${r.name}`, r.cls);
  };
  for (const r of RUNTIME_SNAPSHOT_SCHEMA) walk(r.kind, `MissionRuntime.${r.name}`, r.cls);
  return out;
}
