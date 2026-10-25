// A STAND-IN for the DRIVERS (net sim snapshot, stage 1 Task 7b; cut to the driver half in stage 2
// Task 5). TEST-ONLY: imported by the snapshot witness (`snapshot-witness.ts`) and its test, by
// nothing else.
//
// Stage 2's runtime encoder moved the `MissionRuntime` across natively (`restoreSim(..., runtime)`),
// so this file no longer touches a runtime. What is left is the state a TEST DRIVER keeps beside the
// world: the tunnel plan (`TunnelPlan`) and the golden economy's run record (`EconomyRun`). No encoder
// will ever own a driver's private state, so this file STAYS until the drivers are stateless.
//
// It copies the source driver's data onto the fresh world's own driver objects by REFLECTION:
//
//   - typed arrays by `.set` when the length matches, otherwise a slice;
//   - primitives assigned; a Map, Set or Array rebuilt in place (a Map INSIDE an array too);
//   - class instances and plain objects recursed, in place when the destination holds one of the
//     same prototype, else rebuilt with the source's prototype;
//   - functions and accessor properties skipped (a closure belongs to the world that made it);
//   - the graph's own sharing is kept: a source object reached twice maps to ONE destination.
//   - the REBIND table names the objects that exist once per world (the sim, the runtime, the mission
//     JSON, the context): a reference to one of them in the source becomes a reference to the
//     destination's own, never a copy and never the source's.
//
// THE REBIND SAFETY. A driver must never write into a sim or runtime column: the restore (and the
// pre-restore poison) is what those rows are judged on, and a carry that repaired them would hide a
// restore defect. A reference to the sim, the runtime or a sim column rebinds to B's own object, and
// `carryOnto` takes a `protectedColumns` set (every typed array B's runtime and sim reach): it THROWS
// before writing into one, so a driver that came to hold an alias of a column is loud, not silent.
//
// Three traps the stage-1 probe fell into and this does not: an accessor property read as data, a Map
// held in an array dropped on the floor, and a skip-by-KEY-name that also skipped `Rng.state` (this
// file skips by identity, through the rebind table, and by nothing else).

type Obj = Record<string | symbol, unknown>;

/** Source object -> the destination world's own object. */
export type Rebind = ReadonlyMap<object, object>;

const isTyped = (v: unknown): v is Uint8Array => ArrayBuffer.isView(v) && !(v instanceof DataView);
const isObject = (v: unknown): v is object => typeof v === 'object' && v !== null;

function sameKind(d: unknown, s: object): d is object {
  if (!isObject(d)) return false;
  if (Array.isArray(s) !== Array.isArray(d)) return false;
  if (s instanceof Map !== d instanceof Map) return false;
  if (s instanceof Set !== d instanceof Set) return false;
  if (isTyped(s) !== isTyped(d)) return false;
  return Object.getPrototypeOf(d) === Object.getPrototypeOf(s);
}

/**
 * Copies `src`'s data onto `dst` (both the root of a carried object). `rebind` maps every
 * once-per-world source object (including `src` itself, which is always `dst`'s counterpart) to
 * the destination's own.
 */
export function carryOnto(dst: object, src: object, rebind: Rebind, protectedColumns: ReadonlySet<object> = new Set()): void {
  const mapped = new Map<object, object>([[src, dst]]);
  overwrite(dst as Obj, src as Obj, rebind, mapped, protectedColumns);
}

/**
 * Every typed array reachable from `root` (own data properties, Map keys and values, Set members, array
 * elements; functions and accessors skipped): the columns of a world that a driver must never write into.
 * Walked from B's runtime, which reaches its sim, so it holds the runtime's own columns and every sim column.
 */
export function columnsReachableFrom(root: object): Set<object> {
  const columns = new Set<object>();
  const seen = new Set<object>();
  const stack: object[] = [root];
  while (stack.length > 0) {
    const o = stack.pop() as object;
    if (seen.has(o)) continue;
    seen.add(o);
    if (isTyped(o)) {
      columns.add(o);
      continue;
    }
    if (o instanceof Map) {
      for (const [k, v] of o) for (const x of [k, v]) if (isObject(x)) stack.push(x);
    } else if (o instanceof Set || Array.isArray(o)) {
      for (const x of o as Iterable<unknown>) if (isObject(x)) stack.push(x);
    } else {
      for (const k of Reflect.ownKeys(o)) {
        const d = Object.getOwnPropertyDescriptor(o, k);
        if (d !== undefined && 'value' in d && isObject(d.value)) stack.push(d.value);
      }
    }
  }
  return columns;
}

/** The value `dst[k]` should hold given the source value `s` and what is there now (`d`). */
function place(d: unknown, s: unknown, rebind: Rebind, mapped: Map<object, object>, guard: ReadonlySet<object>): unknown {
  if (!isObject(s)) return s;
  const bound = rebind.get(s);
  if (bound !== undefined) return bound;
  const seen = mapped.get(s);
  if (seen !== undefined) return seen;
  if (isTyped(s)) {
    if (isTyped(d) && d.constructor === s.constructor && d.length === s.length) {
      if (guard.has(d)) throw new Error('snapshot driver carry: a driver holds an alias of a sim or runtime column, and the carry would write into it');
      (d as Uint8Array).set(s);
      mapped.set(s, d);
      return d;
    }
    const c = s.slice();
    mapped.set(s, c);
    return c;
  }
  if (s instanceof Map) {
    const m = d instanceof Map ? (d as Map<unknown, unknown>) : new Map<unknown, unknown>();
    mapped.set(s, m);
    const before = new Map(m);
    m.clear();
    for (const [k, v] of s) m.set(place(undefined, k, rebind, mapped, guard), place(isObject(k) ? undefined : before.get(k), v, rebind, mapped, guard));
    return m;
  }
  if (s instanceof Set) {
    const m = d instanceof Set ? (d as Set<unknown>) : new Set<unknown>();
    mapped.set(s, m);
    m.clear();
    for (const v of s) m.add(place(undefined, v, rebind, mapped, guard));
    return m;
  }
  if (Array.isArray(s)) {
    const a = Array.isArray(d) ? (d as unknown[]) : [];
    mapped.set(s, a);
    for (let i = 0; i < s.length; i++) a[i] = place(a[i], s[i], rebind, mapped, guard);
    a.length = s.length;
    return a;
  }
  const o = sameKind(d, s) ? (d as Obj) : (Object.create(Object.getPrototypeOf(s) as object | null) as Obj);
  mapped.set(s, o);
  overwrite(o, s as Obj, rebind, mapped, guard);
  return o;
}

function overwrite(dst: Obj, src: Obj, rebind: Rebind, mapped: Map<object, object>, guard: ReadonlySet<object>): void {
  for (const k of Reflect.ownKeys(src)) {
    const sd = Object.getOwnPropertyDescriptor(src, k);
    if (sd === undefined || !('value' in sd)) continue; // an accessor: read through its own closure
    const dd = Object.getOwnPropertyDescriptor(dst, k);
    if (dd !== undefined && !('value' in dd)) continue;
    const s = sd.value as unknown;
    if (typeof s === 'function') continue;
    dst[k] = place(dd?.value, s, rebind, mapped, guard);
  }
}

/**
 * The first path at which two carried graphs differ, or null. Data only: functions and accessors
 * are skipped, and a reference in `rebind` must meet its counterpart on the other side. Maps and
 * Sets are compared in iteration order, because an order that differs between two worlds is a
 * determinism hazard of its own.
 */
export function carriedDiff(a: unknown, b: unknown, path: string, rebind: Rebind, seen = new Set<object>(), root = true): string | null {
  // A once-per-world reference must meet its counterpart: asked BEFORE identity, because B
  // still pointing at A's own object is exactly the mistake this exists to find. The ROOT of
  // the comparison is itself in the table (a reference back to it from inside must resolve), and
  // is compared by content: asking the table first would call every root equal.
  const bound = !root && isObject(a) ? rebind.get(a) : undefined;
  if (bound !== undefined) return bound === b ? null : `${path} (a reference to the wrong world)`;
  if (a === b) return null;
  if (!isObject(a) || !isObject(b)) {
    if (typeof a === 'function' && typeof b === 'function') return null;
    return Number.isNaN(a) && Number.isNaN(b) ? null : path;
  }
  if (seen.has(a)) return null;
  seen.add(a);
  if (isTyped(a)) {
    if (!isTyped(b) || a.length !== b.length) return `${path} (length)`;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `${path}[${i}]`;
    return null;
  }
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return `${path} (size)`;
    const ka = Array.from(a.keys());
    const kb = Array.from(b.keys());
    for (let i = 0; i < ka.length; i++) {
      if (isObject(ka[i]) ? carriedDiff(ka[i], kb[i], `${path}.key(${i})`, rebind, seen, false) !== null : ka[i] !== kb[i]) return `${path} (key order at ${i})`;
      const r = carriedDiff(a.get(ka[i]), b.get(kb[i]), `${path}.get(${String(ka[i])})`, rebind, seen, false);
      if (r !== null) return r;
    }
    return null;
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return `${path} (size)`;
    const xa = Array.from(a);
    const xb = Array.from(b);
    for (let i = 0; i < xa.length; i++) {
      const r = carriedDiff(xa[i], xb[i], `${path}.member(${i})`, rebind, seen, false);
      if (r !== null) return r;
    }
    return null;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return `${path} (length)`;
    for (let i = 0; i < a.length; i++) {
      const r = carriedDiff(a[i], b[i], `${path}[${i}]`, rebind, seen, false);
      if (r !== null) return r;
    }
    return null;
  }
  for (const k of Reflect.ownKeys(a)) {
    const ad = Object.getOwnPropertyDescriptor(a, k);
    if (ad === undefined || !('value' in ad)) continue;
    const bd = Object.getOwnPropertyDescriptor(b, k);
    if (bd === undefined || !('value' in bd)) return `${path}.${String(k)} (missing)`;
    const r = carriedDiff(ad.value, bd.value, `${path}.${String(k)}`, rebind, seen, false);
    if (r !== null) return r;
  }
  for (const k of Reflect.ownKeys(b)) {
    const bd = Object.getOwnPropertyDescriptor(b, k);
    if (bd === undefined || !('value' in bd) || typeof bd.value === 'function') continue;
    const ad = Object.getOwnPropertyDescriptor(a, k);
    if (ad === undefined) return `${path}.${String(k)} (only on B)`;
  }
  return null;
}
