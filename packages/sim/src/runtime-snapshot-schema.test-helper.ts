import { FlowField } from './flowfield';
import type { MissionRuntime } from './mission';
import {
  RUNTIME_ROW_SETS,
  RUNTIME_SNAPSHOT_SCHEMA,
  type RefTarget,
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

function refHolds(to: RefTarget, v: unknown, owner: Props, env: Env): boolean {
  const rt = props(env.rt);
  switch (to) {
    case 'sim':
      return v === env.sim;
    case 'mission':
      return v === rt.mission;
    case 'ctx':
      return v === rt.ctx;
    case 'ctx.roadMask':
      return v === (rt.ctx as { roadMask?: Uint8Array }).roadMask || (v === null && (rt.ctx as { roadMask?: Uint8Array }).roadMask === undefined);
    case 'sim.column':
      return ArrayBuffer.isView(v) && (Object.values(props(env.sim.state)).includes(v) || Object.values(props(env.sim)).includes(v));
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
      if (typeof v !== 'boolean' && !(typeof v === 'number' && Number.isInteger(v))) {
        out.push(`${at}: expected an integer or boolean, found ${show(v)}`);
      } else env.seen.add(key);
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
      if (!refHolds(kind.to, v, owner, env)) out.push(`${at}: expected a reference to ${kind.to}, found ${show(v)}`);
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
    case 'json':
      if (v === null || typeof v !== 'object' || Array.isArray(v)) out.push(`${at}: expected a JSON record, found ${show(v)}`);
      else if (JSON.stringify(v) === undefined) out.push(`${at}: not JSON-serialisable`);
      else env.seen.add(key);
      break;
    case 'aux':
      if (!Array.isArray(v)) out.push(`${at}: expected an array, found ${show(v)}`);
      else if (v.length > 0) env.seen.add(key);
      break;
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
