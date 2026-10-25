// A STAND-IN (net sim snapshot, stage 1, Task 7b). TEST-ONLY: imported by the snapshot
// witness (`snapshot-witness.ts`) and its test, by nothing else, and DELETED when stage 2's
// runtime encoder lands.
//
// Stage 1 snapshots the `Sim`. A `MissionRuntime` (an economy room's purses, lines and income
// routes) and a stateful driver (the tunnel plan) have no encoder yet, so a fork of such a world
// would restore the sim and leave the runtime at tick 0. This file closes that gap the
// way the measurement probe did (spec 2.3): it copies the source's data onto the fresh world's
// own objects by REFLECTION.
//
//   - typed arrays by `.set` when the length matches (so a read-only view that aliases a sim
//     column stays aliased), otherwise a slice;
//   - primitives assigned; a Map, Set or Array rebuilt in place (a Map INSIDE an array too);
//   - class instances and plain objects recursed, in place when the destination holds one of the
//     same prototype, else rebuilt with the source's prototype;
//   - functions and accessor properties skipped (a closure belongs to the world that made it);
//   - the graph's own sharing is kept: a source object reached twice maps to ONE destination.
//   - the REBIND table names the objects that exist once per world (the sim, the mission JSON,
//     the context): a reference to one of them in the source becomes a reference to the
//     destination's own, never a copy and never the source's.
//
// Three traps the probe fell into and this does not: an accessor property read as data, a Map
// held in an array dropped on the floor, and a skip-by-KEY-name that also skipped `Rng.state`
// (this file skips by identity, through the rebind table, and by nothing else).

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
export function carryOnto(dst: object, src: object, rebind: Rebind): void {
  const mapped = new Map<object, object>([[src, dst]]);
  overwrite(dst as Obj, src as Obj, rebind, mapped);
}

/** The value `dst[k]` should hold given the source value `s` and what is there now (`d`). */
function place(d: unknown, s: unknown, rebind: Rebind, mapped: Map<object, object>): unknown {
  if (!isObject(s)) return s;
  const bound = rebind.get(s);
  if (bound !== undefined) return bound;
  const seen = mapped.get(s);
  if (seen !== undefined) return seen;
  if (isTyped(s)) {
    if (isTyped(d) && d.constructor === s.constructor && d.length === s.length) {
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
    for (const [k, v] of s) m.set(place(undefined, k, rebind, mapped), place(isObject(k) ? undefined : before.get(k), v, rebind, mapped));
    return m;
  }
  if (s instanceof Set) {
    const m = d instanceof Set ? (d as Set<unknown>) : new Set<unknown>();
    mapped.set(s, m);
    m.clear();
    for (const v of s) m.add(place(undefined, v, rebind, mapped));
    return m;
  }
  if (Array.isArray(s)) {
    const a = Array.isArray(d) ? (d as unknown[]) : [];
    mapped.set(s, a);
    for (let i = 0; i < s.length; i++) a[i] = place(a[i], s[i], rebind, mapped);
    a.length = s.length;
    return a;
  }
  const o = sameKind(d, s) ? (d as Obj) : (Object.create(Object.getPrototypeOf(s) as object | null) as Obj);
  mapped.set(s, o);
  overwrite(o, s as Obj, rebind, mapped);
  return o;
}

function overwrite(dst: Obj, src: Obj, rebind: Rebind, mapped: Map<object, object>): void {
  for (const k of Reflect.ownKeys(src)) {
    const sd = Object.getOwnPropertyDescriptor(src, k);
    if (sd === undefined || !('value' in sd)) continue; // an accessor: read through its own closure
    const dd = Object.getOwnPropertyDescriptor(dst, k);
    if (dd !== undefined && !('value' in dd)) continue;
    const s = sd.value as unknown;
    if (typeof s === 'function') continue;
    dst[k] = place(dd?.value, s, rebind, mapped);
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
