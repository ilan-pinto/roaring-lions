import { FlowField } from './flowfield';
import { HASH_SEED, hashWord } from './hash';
import type { MissionRuntime } from './mission';
import { FIXED_COUNT_PATHS, IN_PLACE, encodeRuntimeSection, parseRuntimeSection } from './runtime-snapshot';
import {
  RUNTIME_ROW_SETS,
  RUNTIME_SNAPSHOT_SCHEMA,
  runtimeRowsOf,
  type RuntimeKind,
  type RuntimeRow,
} from './runtime-snapshot-schema';
import { auxJsonOf, canonicalJson, encodeSim, internals, isTyped, restoreSim, type Typed } from './snapshot';
import { RNG_SNAPSHOT_SCHEMA, rowsOf, type SnapshotRow } from './snapshot-schema';
import type { Sim } from './sim';

// The fork witness (net sim snapshot, stage 1, Task 5): the core proof that a
// snapshot carries the whole match.
//
//   A runs the world uninterrupted. At tick T its state is encoded to bytes S.
//   B is a FRESH world from the same build, filled with garbage in every `state`
//   row (`poisonState`), restored from S alone, and both are then driven with the
//   same inputs for `horizon` ticks.
//
// The garbage goes in BEFORE the restore, always. A world built the same way as A
// already holds A's tick-0 value in every row written only at build (`stCx`,
// `stTiles`, `tnLength` ...), so a restore that skipped such a row would read as
// right: the two values coincide. With the row poisoned first, a skipped row keeps
// the garbage, and the encodings differ.

// The verdict needs two things. The hashes must agree at every hash tick, AND the
// canonical encodings of A and B must be byte-equal at the end. Hash equality is
// not enough: the reflection probe (spec 6.2) showed `fieldByGoal` emptied and
// `fieldLastIssued` reset leaving every hash equal while `fieldRef` and the pool
// diverged. The encoding covers every `state` row, hashed or not, so it sees what
// the hash does not.
//
// This is a NON-test module so tools/ runs the SAME proof on the versus and
// economy worlds (Task 7). It is generic over a world that exposes `.sim`.
//
// THE RUNTIME (snapshot S2, Task 4). A world that exposes a `runtime` (the `MissionRuntime` built over
// its sim) has it carried natively, through the runtime codec: A's snapshot is `encodeSim(sim, {}, runtime)`,
// B's runtime is poisoned like its sim (every `state` row before the restore, every `scratch` row and every
// stale `derived` field after it), restored by `restoreSim(sim, bytes, runtime)`, and held to the same
// verdict: the round trip at T, the config rows (`runtimeConfigDiff`), the hash (the sim's folded with
// `runtime.digest()`), and the two encodings, runtime section included, at the end.

/**
 * Anything that owns a `Sim`; a caller may add whatever else it drives (ids, a script). A `runtime`, when
 * present, is the `MissionRuntime` built over `sim` (and `start()`ed): it is encoded, restored, poisoned and
 * compared with the sim. `null` is the same as absent.
 */
export interface WitnessWorld {
  readonly sim: Sim;
  readonly runtime?: MissionRuntime | null;
}

const runtimeOf = (w: WitnessWorld): MissionRuntime | undefined => w.runtime ?? undefined;

/** The match hash a world gets by default: the sim's, folded with the runtime's digest when it has one. */
export function defaultWitnessHash(w: WitnessWorld): number {
  const rt = runtimeOf(w);
  if (rt === undefined) return w.sim.hash();
  return hashWord(hashWord(HASH_SEED, w.sim.hash() | 0), rt.digest() | 0) >>> 0;
}

/** The parts of a fork that do not depend on where it is cut: how to build, drive and compare worlds. */
export interface WitnessHooks<W extends WitnessWorld> {
  /** A fresh tick-0 world. Called once for A and once per fork for B. */
  build: () => W;
  /** Applies tick `t`'s inputs. Called on BOTH worlds identically: some drivers make direct sim calls. */
  drive: (world: W, t: number) => void;
  /** Steps one tick. Defaults to `world.sim.tick()`. */
  advance?: (world: W) => void;
  /** Hashes are compared at T and then every `hashEvery` ticks. */
  hashEvery: number;
  /** What the hash is. Defaults to `defaultWitnessHash`: the sim's hash, folded with `runtime.digest()` for a world with a runtime. */
  hash?: (world: W) => number;
  /**
   * Runs on B right after the restore, before anything is mutated (a caller carrying a runtime copies it here).
   * A is exactly at tick T when it runs, in a series too: A has not stepped past T.
   */
  afterRestore?: (b: W, a: W) => void;
  /**
   * Fills everything the restore promises not to write with garbage (see `poisonScratch`, and for a world with a
   * runtime `poisonRuntimeScratch` and `poisonStaleFields`), after `afterRestore` and before `mutate`. The verdict's
   * `garbledUnkeyedSlots`, `garbledRuntimeScratch` and `garbledStaleFields` say what that actually garbled. (The
   * runtime's `state` rows are poisoned before the restore whatever this says, as the sim's are.)
   */
  poison?: boolean;
  /** Runs on B after the restore, `afterRestore` and the poison: the mutation a self-check applies. A is at tick T. */
  mutate?: (b: W, a: W) => void;
}

export interface ForkWitnessOptions<W extends WitnessWorld> extends WitnessHooks<W> {
  /** The tick the snapshot is cut at. */
  T: number;
  /** How many ticks both worlds then run. */
  horizon: number;
}

export interface ForkSeriesOptions<W extends WitnessWorld> extends WitnessHooks<W> {
  /** The ticks the snapshot is cut at, ascending. */
  Ts: readonly number[];
  /** How many ticks each of those forks then runs. Every `T + horizon` must be at most `endTick`. */
  horizon: number;
  /** One more fork, cut at this tick, whose horizon runs to `endTick`. Its verdict is the last one. */
  tailFrom?: number;
  /** A is stepped to this tick and no further. */
  endTick: number;
}

export interface ForkVerdict<W extends WitnessWorld> {
  /** The first sim tick at which the two hashes differed, or null if they never did. */
  hashDivergedAt: number | null;
  /** Whether `encodeSim(A)` and `encodeSim(B)` are byte-equal after the horizon. */
  encodingEqualAtEnd: boolean;
  /**
   * Whether B, encoded again straight after `restoreSim` and before anything else touches it,
   * gives exactly the bytes it was restored from. This is the restore's own contract (spec 6.1:
   * the round trip at T) and it is checked at the cut, not only after a horizon in which a wrong
   * row might have been overwritten by the tick. A clean fork requires it.
   */
  roundTripEqualAtT: boolean;
  /** Where the divergence first shows: the first differing `state` row, or the hash tick. Absent when clean. */
  firstDifference?: string;
  /**
   * `configDiff(A, B)` (and, for a world with a runtime, `runtimeConfigDiff`) right after the restore, before
   * any mutation: null when every `config` row agrees.
   */
  configDifference: string | null;
  /** How many unkeyed pool slots `poison` garbled (0 when `poison` was off or the pool had none). */
  garbledUnkeyedSlots: number;
  /** The runtime's `scratch` rows `poison` garbled, as `RowSet.row` paths (empty when `poison` was off or there is no runtime). */
  garbledRuntimeScratch: string[];
  /** How many stale `derived` corridor fields `poison` garbled (0 when `poison` was off or there is no runtime). */
  garbledStaleFields: number;
  /** The two worlds after the horizon, for a caller's own extra comparisons. */
  a: W;
  b: W;
}

/** One fork of a series: B only, because A is shared and still moving when the fork is judged. */
export type SeriesForkVerdict<W extends WitnessWorld> = Omit<ForkVerdict<W>, 'a'> & {
  /** The tick this fork was cut at. */
  T: number;
  /** How many ticks it then ran. */
  horizon: number;
};

/**
 * B's encoding, or the error the encoder threw. The encoder refuses a world that breaks its contract (a runtime
 * entry that is no longer the ledger element the table says it is, an alias the rules do not know): for B that is a
 * RED verdict, never an exception out of the witness. A's encoding is taken with `encodeSim` directly: a throw there
 * is a broken world, not a finding.
 */
function tryEncode(sim: Sim, runtime: MissionRuntime | undefined): Uint8Array | Error {
  try {
    return encodeSim(sim, {}, runtime);
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The first index at which two columns differ, or -1. */
function firstTypedDifference(a: Typed, b: Typed): number {
  if (a.length !== b.length) return a.length < b.length ? a.length : b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/**
 * Names the first `state` row (schema order) on which A and B differ, as `name[index]` for a
 * column or `name` for a scalar, or null if every row agrees. Only used to say WHERE a failed
 * witness diverged; the verdict itself rests on the encodings.
 */
function firstStateDifference(a: Sim, b: Sim): string | null {
  const ia = internals(a);
  const ib = internals(b);
  for (const row of rowsOf('state')) {
    const va = ia[row.name];
    const vb = ib[row.name];
    if (isTyped(va) && isTyped(vb)) {
      const at = firstTypedDifference(va, vb);
      if (at >= 0) return `${row.name}[${at}]`;
    } else if (row.kind.t === 'scalar') {
      if (va !== vb) return row.name;
    }
  }
  const ra = ia.rng as { state: Uint32Array };
  const rb = ib.rng as { state: Uint32Array };
  const at = firstTypedDifference(ra.state, rb.state);
  if (at >= 0) return `rng.state[${at}]`;
  return null;
}

/**
 * JSON.stringify writes every Set and Map as `{}`, which would make a compare of `tnTiles`
 * (a `Set<number>[]`) vacuous. A Set becomes its members sorted, a Map its entries sorted by key.
 */
function contentReplacer(_key: string, v: unknown): unknown {
  const order = (x: unknown, y: unknown): number => ((x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0);
  if (v instanceof Set) return Array.from(v).sort(order);
  if (v instanceof Map) return Array.from(v.entries()).sort((x, y) => order(x[0], y[0]));
  return v;
}

/**
 * Compares every `config` row of two worlds: typed arrays by element, scalars by value, the
 * type tables by JSON. The read-only views (`state`, `structures`, `works`) are records over
 * `state` columns and are skipped. Returns a description of the first difference, or null.
 * Right after a restore every row must agree: that is what `config` MEANS (rebuilt, never sent).
 */
export function configDiff(a: Sim, b: Sim): string | null {
  const ia = internals(a);
  const ib = internals(b);
  for (const row of rowsOf('config')) {
    if (row.kind.t === 'object' && row.kind.shape === 'record') continue;
    const va = ia[row.name];
    const vb = ib[row.name];
    if (row.kind.t === 'typed') {
      if (!isTyped(va) || !isTyped(vb)) return `${row.name}: not a typed array in both worlds`;
      const at = firstTypedDifference(va, vb);
      if (at >= 0) return `${row.name}[${at}]`;
    } else if (row.kind.t === 'scalar') {
      if (va !== vb) return `${row.name}: ${String(va)} vs ${String(vb)}`;
    } else if (JSON.stringify(va, contentReplacer) !== JSON.stringify(vb, contentReplacer)) {
      return `${row.name}: differs by JSON`;
    }
  }
  return null;
}

/** The junk each `aux` row holds in B before the restore; a restore that skips the row leaves it there. */
const AUX_JUNK: Record<string, (value: unknown[]) => void> = {
  patrolLegIds: (v) => {
    v.fill(0x5a5a);
  },
  pendingStrikes: (v) => {
    v.push({ x: 1, y: 2, by: 3, readyTick: 4, profile: 5 });
  },
  pendingEvents: (v) => {
    v.push({ kind: 'spawn', tick: -7 });
  },
  commandQueue: (v) => {
    v.push({ kind: 'halt', ids: [0] });
  },
  runtimeQueue: (v) => {
    v.push({ kind: 'clearRally', side: 0, line: 0 });
  },
  stTiles: (v) => {
    v.push([0, 1, 2]);
  },
};

/**
 * Fills every `state` row of a fresh world with garbage, so that a restore that fails to write
 * a row leaves the garbage in it:
 *   - a typed column gets a non-constant odd pattern; the RNG words are garbled the same way;
 *   - a scalar becomes a different value (a boolean is negated);
 *   - an `aux` array gets one junk element (or, for `patrolLegIds`, junk in place);
 *   - the flow-field pool gets `POISON_POOL_SLOTS` junk slots (`poisonPool`): `restoreFieldPool`
 *     replaces the pool whole, and a restore that merged into it would keep them.
 * `config` is untouched (the restore never writes it, and `configDiff` checks it after).
 * Throws for an `aux` row it has no junk for, so a new row cannot go unpoisoned.
 */
export function poisonState(sim: Sim): void {
  const self = internals(sim);
  for (const row of rowsOf('state')) {
    const v = self[row.name];
    switch (row.kind.t) {
      case 'typed':
        if (!isTyped(v)) throw new Error(`poisonState: ${row.name} is not a typed array`);
        garbleColumn(v);
        break;
      case 'scalar':
        self[row.name] = typeof v === 'boolean' ? !v : ((v as number) ^ POISON_STATE_XOR) | 0;
        break;
      case 'rng': {
        // The generator's own typed rows, as the encoder walks them, not a hard-coded `.state`.
        const rng = v as Record<string, unknown>;
        for (const r of RNG_SNAPSHOT_SCHEMA) {
          const a = rng[r.name];
          if (r.kind.t !== 'typed' || !isTyped(a)) throw new Error(`poisonState: rng.${r.name} is not a typed array it can poison`);
          garbleColumn(a);
        }
        break;
      }
      case 'aux': {
        const junk = AUX_JUNK[row.name];
        if (junk === undefined || !Array.isArray(v)) throw new Error(`poisonState: aux row ${row.name} has no junk`);
        junk(v);
        break;
      }
      case 'pool':
        break; // the four bookkeeping rows are poisoned together below
      default:
        throw new Error(`poisonState: state row ${row.name} has a kind it cannot poison`);
    }
  }
  poisonPool(sim);
}

/** How many junk slots `poisonPool` adds. More than one, and across more than one domain. */
const POISON_POOL_SLOTS = 3;

/**
 * Gives a fresh world's flow-field pool junk: slots past whatever it holds, each with a bogus goal
 * key, a domain, a `lastIssued` and an entry in its domain's `fieldByGoal`, through direct writes
 * (no `fieldFor`, no `restoreFieldPool`). `restoreFieldPool` replaces the pool whole; a restore
 * that merged into it, or forgot to truncate or clear it, leaves these behind and the encodings
 * differ.
 */
function poisonPool(sim: Sim): void {
  const self = internals(sim);
  const fields = self.fields as FlowField[];
  const goalKey = self.fieldGoalKey as number[];
  const domain = self.fieldDomain as number[];
  const lastIssued = self.fieldLastIssued as number[];
  const byGoal = self.fieldByGoal as Map<number, number>[];
  for (let k = 0; k < POISON_POOL_SLOTS; k++) {
    const idx = fields.length;
    const f = new FlowField(sim.width, sim.height);
    garble(f, POISON_BYTE);
    fields.push(f);
    goalKey[idx] = 3 + k;
    domain[idx] = k % byGoal.length;
    lastIssued[idx] = POISON_SCALAR;
    byGoal[domain[idx]].set(goalKey[idx], idx);
  }
}

const POISON_STATE_XOR = 0x5a5a5a;

function garbleColumn(a: Typed): void {
  for (let i = 0; i < a.length; i++) a[i] = (i * 40503 + 0x5a5b) | 1;
}

const POISON_BYTE = 0x5a;
const POISON_SCALAR = 0x5a5a;
const POISON_UNKEYED = 0xee;

/**
 * Fills everything a restore promises NOT to write with garbage, so a snapshot that quietly
 * relied on it stale shows up as a divergence. Call it on B after the restore:
 *   - every `scratch` typed array is filled with 0x5a and every `scratch` scalar set to 0x5a5a;
 *   - `approachField` becomes a FlowField full of garbage;
 *   - every UNKEYED pool slot (a slot `recomputeFields` unkeyed: goal -1) is filled with 0xee.
 * Keyed slots are not touched: the restore rebuilt them from their keys, and `derived` means
 * exactly that those bytes are a function of state.
 */
function poisonScratch(sim: Sim): number {
  const self = internals(sim);
  for (const row of rowsOf('scratch')) poisonRow(self, row, sim);
  const fields = self.fields as FlowField[];
  const goalKey = self.fieldGoalKey as number[];
  let garbled = 0;
  for (let i = 0; i < fields.length; i++) {
    if (goalKey[i] === -1) {
      garble(fields[i], POISON_UNKEYED);
      garbled++;
    }
  }
  return garbled;
}

function poisonRow(self: Record<string, unknown>, row: SnapshotRow, sim: Sim): void {
  const v = self[row.name];
  if (row.kind.t === 'typed') {
    if (!isTyped(v)) throw new Error(`poisonScratch: ${row.name} is not a typed array`);
    v.fill(POISON_BYTE);
  } else if (row.kind.t === 'scalar') {
    self[row.name] = typeof v === 'boolean' ? !v : POISON_SCALAR;
  } else if (row.kind.t === 'object' && row.kind.shape === 'flowfield') {
    const f = new FlowField(sim.width, sim.height);
    garble(f, POISON_BYTE);
    self[row.name] = f;
  } else {
    throw new Error(`poisonScratch: scratch row ${row.name} has a kind it cannot poison`);
  }
}

function garble(f: FlowField, byte: number): void {
  f.dirs.fill(byte);
  (f as unknown as { cost: Int32Array }).cost.fill(byte);
  f.goalX = byte;
  f.goalY = byte;
}

// ---- the runtime ------------------------------------------------------------------------------
//
// The same discipline as the sim, walked off `RUNTIME_SNAPSHOT_SCHEMA` and the row sets it names:
//   - `poisonRuntimeState`, BEFORE the restore: every `state` row becomes garbage, so a restore that
//     skips a row leaves the garbage. Containers keep their identity (a Map or Set is cleared and given
//     junk, a typed array is garbled in place, an array keeps its length where the target's setup fixes
//     it and otherwise gains a junk element, a record is poisoned field by field) because the restore
//     writes INTO them and `routeSource.fieldFor` closes over `corridorFields`. What the decoder reads
//     from the target stays as the setup built it: the counts of the fixed arrays, which in-place
//     records exist (the convoy is never made from null), and every `config` row. A `ref` row is
//     skipped: the restore re-points it at its owner (and a restore that did not would leave an alias
//     the round trip and the continued hash expose).
//   - `poisonRuntimeScratch`, AFTER the restore (the codec promises not to write a `scratch` row): every
//     `scratch` row, at the top and inside a `state` record, is filled with garbage, so a row that was not
//     in fact overwritten before its read diverges the fork.
//   - `poisonStaleFields`, AFTER the restore: a `corridorFields` entry whose stamp is not the current
//     `terrainVersion` was left uncomputed by the restore, and `fieldFor` recomputes it whole before any
//     read; its field is garbled. A current entry is not touched: it was rebuilt, and `derived` means
//     exactly that those bytes are a function of state.
// Each throws on a row kind it cannot poison, so a new kind cannot go unpoisoned.

type Slot = Record<string | number, unknown>;

const JUNK_TYPED: Readonly<Record<string, new (n: number) => Typed>> = { Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array };

function otherString(v: unknown, values: readonly string[] | undefined): string {
  if (values !== undefined) return values.find((x) => x !== v) ?? values[0];
  return typeof v === 'string' ? `${v}~poison` : 'poison';
}

/** A value of `kind` made of garbage, for a container that gains an element. References are null. */
function junkOf(kind: RuntimeKind, sim: Sim): unknown {
  switch (kind.t) {
    case 'typed': {
      const a = new JUNK_TYPED[kind.ctor](2);
      garbleColumn(a);
      return a;
    }
    case 'scalar':
      return kind.bool === true ? true : POISON_SCALAR;
    case 'number':
      return POISON_SCALAR;
    case 'string':
      return otherString(null, kind.values);
    case 'array':
      return [junkOf(kind.of, sim)];
    case 'set':
      return new Set([junkOf(kind.of, sim)]);
    case 'map':
      return new Map([[junkOf(kind.key, sim), junkOf(kind.value, sim)]]);
    case 'record': {
      const out: Slot = {};
      for (const row of RUNTIME_ROW_SETS[kind.rows]) out[row.name] = row.kind.t === 'ref' ? null : junkOf(row.kind, sim);
      return out;
    }
    case 'ref':
      return null;
    case 'flowfield': {
      const f = new FlowField(sim.width, sim.height);
      garble(f, POISON_BYTE);
      return f;
    }
    case 'json':
      return { poison: true };
    case 'aux':
      return [{ kind: 'intelEarned', tick: -7 }];
    default:
      throw new Error(`poisonRuntime: a ${(kind as RuntimeKind).t} kind has no junk`);
  }
}

function poisonStateSlot(h: Slot, key: string | number, kind: RuntimeKind, path: string, sim: Sim, out: Set<string>): void {
  const v = h[key];
  if (!path.endsWith('[]')) out.add(path); // an array element is not a row of its own
  switch (kind.t) {
    case 'typed':
      if (v === null) h[key] = junkOf(kind, sim);
      else if (isTyped(v)) garbleColumn(v);
      else throw new Error(`poisonRuntimeState: ${path} is not a typed array`);
      return;
    case 'scalar':
      h[key] = typeof v === 'boolean' ? !v : ((v as number) ^ POISON_STATE_XOR) | 0;
      return;
    case 'string':
      h[key] = otherString(v, kind.values);
      return;
    case 'array': {
      // The lazily built works lists are null until something reads them: nothing there to garble.
      if (v === null) return;
      if (!Array.isArray(v)) throw new Error(`poisonRuntimeState: ${path} is not an array`);
      for (let i = 0; i < v.length; i++) poisonStateSlot(v as unknown as Slot, i, kind.of, `${path}[]`, sim, out);
      if (kind.len === undefined && !FIXED_COUNT_PATHS.has(path)) v.push(junkOf(kind.of, sim));
      return;
    }
    case 'set':
      if (!(v instanceof Set)) throw new Error(`poisonRuntimeState: ${path} is not a Set`);
      v.clear();
      v.add(junkOf(kind.of, sim));
      return;
    case 'map':
      if (!(v instanceof Map)) throw new Error(`poisonRuntimeState: ${path} is not a Map`);
      v.clear();
      v.set(junkOf(kind.key, sim), junkOf(kind.value, sim));
      return;
    case 'record': {
      if (v === null) {
        // A record the setup built (the supply convoy) is never absent from the snapshot: the decoder refuses it.
        if (!IN_PLACE.has(kind.rows)) h[key] = junkOf(kind, sim);
        return;
      }
      if (typeof v !== 'object') throw new Error(`poisonRuntimeState: ${path} is not a record`);
      for (const row of RUNTIME_ROW_SETS[kind.rows]) {
        if (row.cls !== 'state' || row.kind.t === 'ref') continue;
        poisonStateSlot(v as Slot, row.name, row.kind, `${kind.rows}.${row.name}`, sim, out);
      }
      return;
    }
    case 'json':
      h[key] = { poison: true };
      return;
    case 'aux':
      if (!Array.isArray(v)) throw new Error(`poisonRuntimeState: ${path} is not an array`);
      v.push({ kind: 'intelEarned', tick: -7 });
      return;
    default:
      throw new Error(`poisonRuntimeState: state row ${path} has a ${kind.t} kind it cannot poison`);
  }
}

/**
 * Fills every `state` row of a fresh world's runtime with garbage (see the section above). Returns the schema
 * paths it poisoned (`MissionRuntime.purse`, `LineItem.unit` ...), for a census.
 */
export function poisonRuntimeState(rt: MissionRuntime): string[] {
  const sim = (rt as unknown as { sim: Sim }).sim;
  const out = new Set<string>();
  for (const row of runtimeRowsOf('state')) {
    if (row.kind.t === 'ref') continue;
    poisonStateSlot(rt as unknown as Slot, row.name, row.kind, `MissionRuntime.${row.name}`, sim, out);
  }
  return Array.from(out);
}

function poisonScratchSlot(h: Slot, key: string | number, kind: RuntimeKind, path: string, out: Set<string>): void {
  const v = h[key];
  if (!path.endsWith('[]')) out.add(path); // an array element is not a row of its own
  switch (kind.t) {
    case 'typed':
      if (!isTyped(v)) throw new Error(`poisonRuntimeScratch: ${path} is not a typed array`);
      v.fill(POISON_BYTE);
      return;
    case 'scalar':
      h[key] = typeof v === 'boolean' ? !v : POISON_SCALAR;
      return;
    case 'number':
      h[key] = POISON_SCALAR;
      return;
    case 'string':
      h[key] = otherString(v, kind.values);
      return;
    case 'array': {
      // A reused pair (`ventOut`): the length is the setup's, the elements are the scratch.
      if (!Array.isArray(v)) throw new Error(`poisonRuntimeScratch: ${path} is not an array`);
      for (let i = 0; i < v.length; i++) poisonScratchSlot(v as unknown as Slot, i, kind.of, `${path}[]`, out);
      return;
    }
    case 'record': {
      if (typeof v !== 'object' || v === null) throw new Error(`poisonRuntimeScratch: ${path} is not a record`);
      for (const row of RUNTIME_ROW_SETS[kind.rows]) poisonScratchSlot(v as Slot, row.name, row.kind, `${kind.rows}.${row.name}`, out);
      return;
    }
    default:
      throw new Error(`poisonRuntimeScratch: scratch row ${path} has a ${kind.t} kind it cannot poison`);
  }
}

/** Finds the `scratch` rows that live inside a `state` row's records (`CivilianFlight.scratch`) and poisons them. */
function scratchWithin(v: unknown, kind: RuntimeKind, path: string, only: string | undefined, out: Set<string>): void {
  if (v === null || v === undefined) return;
  switch (kind.t) {
    case 'array':
      for (const el of v as unknown[]) scratchWithin(el, kind.of, `${path}[]`, only, out);
      return;
    case 'map':
      for (const el of (v as Map<unknown, unknown>).values()) scratchWithin(el, kind.value, `${path}.get()`, only, out);
      return;
    case 'record':
      for (const row of RUNTIME_ROW_SETS[kind.rows]) {
        const sub = `${kind.rows}.${row.name}`;
        if (row.cls === 'scratch') {
          if (only === undefined || only === sub) poisonScratchSlot(v as Slot, row.name, row.kind, sub, out);
        } else if (row.cls === 'state') scratchWithin((v as Slot)[row.name], row.kind, sub, only, out);
      }
      return;
    default:
      return;
  }
}

/**
 * Fills every `scratch` row of the runtime with garbage, the codec having promised not to write one. Returns the
 * paths it poisoned. With `only` (a unit: `MissionRuntime.<row>` for a top-level row, or `RowSet.<row>` for one
 * inside a `state` record, `CivilianFlight.scratch`), just that row and what it holds: a check that poisons one
 * row at a time says WHICH row a divergence belongs to.
 */
export function poisonRuntimeScratch(rt: MissionRuntime, only?: string): string[] {
  const out = new Set<string>();
  for (const row of RUNTIME_SNAPSHOT_SCHEMA) {
    const path = `MissionRuntime.${row.name}`;
    if (row.cls === 'scratch') {
      if (only === undefined || only === path) poisonScratchSlot(rt as unknown as Slot, row.name, row.kind, path, out);
    } else if (row.cls === 'state') scratchWithin((rt as unknown as Slot)[row.name], row.kind, path, only, out);
  }
  return Array.from(out);
}

/** Garbles the field of every `corridorFields` entry the restore left uncomputed (a stale stamp). Returns how many. */
export function poisonStaleFields(rt: MissionRuntime): number {
  const r = rt as unknown as { corridorFields: Map<number, { field: FlowField; stamp: number }>; terrainVersion: number };
  let garbled = 0;
  for (const entry of r.corridorFields.values()) {
    if (entry.stamp !== r.terrainVersion) {
      garble(entry.field, POISON_UNKEYED);
      garbled++;
    }
  }
  return garbled;
}

/** The runtime's section, parsed: one JSON value per top-level `state` row, exactly as the codec writes them. */
function runtimeSectionOf(rt: MissionRuntime): Record<string, unknown> {
  const sim = (rt as unknown as { sim: Sim }).sim;
  return parseRuntimeSection(encodeRuntimeSection(rt, sim)) as Record<string, unknown>;
}

/**
 * The first top-level `state` row (schema order) whose ENCODED value differs between two runtimes, as
 * `runtime.<row>`, or null. Rows are compared by the canonical JSON the codec writes for them.
 */
export function firstRuntimeDifference(a: MissionRuntime, b: MissionRuntime): string | null {
  const sa = runtimeSectionOf(a);
  const sb = runtimeSectionOf(b);
  for (const row of runtimeRowsOf('state')) {
    if (canonicalJson(sa[row.name]) !== canonicalJson(sb[row.name])) return `runtime.${row.name}`;
  }
  return null;
}

/** Every top-level `state` row of the runtime whose encoded value differs between two runtimes, as `runtime.<row>`. */
function runtimeRowsMoved(base: MissionRuntime, now: MissionRuntime): string[] {
  const sa = runtimeSectionOf(base);
  const sb = runtimeSectionOf(now);
  return runtimeRowsOf('state')
    .filter((row) => canonicalJson(sa[row.name]) !== canonicalJson(sb[row.name]))
    .map((row) => `runtime.${row.name}`);
}

// ---- the runtime's config rows -----------------------------------------------------------------

const sameMembers = (x: Set<unknown>, y: Set<unknown>): boolean => x.size === y.size && Array.from(x).every((m) => y.has(m));

/**
 * Walks two values of one kind. With `all`, every value found is compared (we are inside a `config` row);
 * without it, the walk only descends into `state` and `scratch` rows to find `config` rows nested in them
 * (`ObjectiveState.def`, `ProductionLine.anchor` ...). A `ref` is an identity, not a value: only its
 * nullness is compared (the target's own sim, mission and context are what it points at).
 */
function configWalk(va: unknown, vb: unknown, kind: RuntimeKind, path: string, all: boolean): string | null {
  if (va === null || vb === null || va === undefined || vb === undefined) {
    return all && va !== vb ? `${path}: ${va === null || va === undefined ? 'absent in A' : 'absent in B'}` : null;
  }
  switch (kind.t) {
    case 'typed': {
      if (!all) return null;
      if (!isTyped(va) || !isTyped(vb)) return `${path}: not a typed array in both worlds`;
      const at = firstTypedDifference(va, vb);
      return at >= 0 ? `${path}[${at}]` : null;
    }
    case 'scalar':
    case 'number':
    case 'string':
      return all && va !== vb ? `${path}: ${String(va)} vs ${String(vb)}` : null;
    case 'array': {
      const xa = va as unknown[];
      const xb = vb as unknown[];
      if (xa.length !== xb.length) return all ? `${path}: ${xa.length} entries vs ${xb.length}` : null;
      for (let i = 0; i < xa.length; i++) {
        const d = configWalk(xa[i], xb[i], kind.of, `${path}[${i}]`, all);
        if (d !== null) return d;
      }
      return null;
    }
    case 'set':
      return all && !sameMembers(va as Set<unknown>, vb as Set<unknown>) ? `${path}: the members differ` : null;
    case 'map': {
      if (!all) return null;
      const ma = va as Map<unknown, unknown>;
      const mb = vb as Map<unknown, unknown>;
      if (ma.size !== mb.size) return `${path}: ${ma.size} entries vs ${mb.size}`;
      for (const [k, x] of ma) {
        if (!mb.has(k)) return `${path}: key ${String(k)} only in A`;
        const d = configWalk(x, mb.get(k), kind.value, `${path}[${String(k)}]`, all);
        if (d !== null) return d;
      }
      return null;
    }
    case 'record': {
      for (const row of RUNTIME_ROW_SETS[kind.rows]) {
        const d = configWalk((va as Slot)[row.name], (vb as Slot)[row.name], row.kind, `${path}.${row.name}`, all || row.cls === 'config');
        if (d !== null) return d;
      }
      return null;
    }
    case 'json':
    case 'aux':
      return all && canonicalJson(va) !== canonicalJson(vb) ? `${path}: differs by JSON` : null;
    default:
      return null; // ref, flowfield: an identity or a derived field, not a config value
  }
}

/**
 * Compares every `config` row of two runtimes, at the top and inside the records a `state` row holds: typed
 * arrays by element, scalars by value, Sets by members, Maps and arrays entry by entry. Returns the first
 * difference as `runtime.<path>`, or null. Right after a restore every config row must agree: that is what
 * `config` MEANS (rebuilt by the world's own setup, never sent).
 */
export function runtimeConfigDiff(a: MissionRuntime, b: MissionRuntime): string | null {
  const ra = a as unknown as Slot;
  const rb = b as unknown as Slot;
  for (const row of RUNTIME_SNAPSHOT_SCHEMA as readonly RuntimeRow[]) {
    const d = configWalk(ra[row.name], rb[row.name], row.kind, `runtime.${row.name}`, row.cls === 'config');
    if (d !== null) return d;
  }
  return null;
}

interface Fork<W extends WitnessWorld> {
  readonly T: number;
  readonly horizon: number;
  readonly b: W;
  readonly configDifference: string | null;
  readonly garbledUnkeyedSlots: number;
  readonly garbledRuntimeScratch: string[];
  readonly garbledStaleFields: number;
  readonly roundTripEqualAtT: boolean;
  hashDivergedAt: number | null;
}

/**
 * The one code path under `forkWitness` and `forkWitnessSeries`. A is built once and stepped to
 * `endTick`. At each fork's T (before A steps past it) A is encoded, a fresh B is built and
 * restored, and the hooks run exactly as a single fork runs them; B is then stepped in lockstep
 * with A, so several forks are live at once. A fork is judged the tick A reaches `T + horizon`.
 * Verdicts come back in `forks` order.
 */
function runForks<W extends WitnessWorld>(
  opts: WitnessHooks<W>,
  forks: readonly { readonly T: number; readonly horizon: number }[],
  endTick: number
): { verdicts: ForkVerdict<W>[]; a: W } {
  if (!Number.isInteger(endTick) || endTick < 0) throw new Error(`forkWitness: endTick ${String(endTick)} is not a tick`);
  for (const f of forks) {
    if (!Number.isInteger(f.T) || !Number.isInteger(f.horizon) || f.T < 0 || f.horizon < 0 || f.T + f.horizon > endTick) {
      throw new Error(`forkWitness: fork T=${String(f.T)} horizon=${String(f.horizon)} does not fit in 0..${endTick}`);
    }
  }
  const advance = opts.advance ?? ((w: W): void => { w.sim.tick(); });
  const hashOf = opts.hash ?? defaultWitnessHash;

  const a = opts.build();
  const verdicts: (ForkVerdict<W> | undefined)[] = forks.map(() => undefined);
  const live = new Map<number, Fork<W>>();

  const cut = (index: number): void => {
    const spec = forks[index];
    const aRuntime = runtimeOf(a);
    const bytes = encodeSim(a.sim, {}, aRuntime);
    const b = opts.build();
    const bRuntime = runtimeOf(b);
    if ((aRuntime === undefined) !== (bRuntime === undefined)) throw new Error('forkWitness: A and B do not both have a runtime');
    poisonState(b.sim);
    if (bRuntime !== undefined) poisonRuntimeState(bRuntime);
    restoreSim(b.sim, bytes, bRuntime);
    // Before `afterRestore`, which may carry a runtime across or mutate B: the restore alone must re-encode to S.
    const again = tryEncode(b.sim, bRuntime);
    const roundTripEqualAtT = again instanceof Uint8Array && bytesEqual(again, bytes);
    opts.afterRestore?.(b, a);
    const configDifference = configDiff(a.sim, b.sim) ?? (aRuntime !== undefined && bRuntime !== undefined ? runtimeConfigDiff(aRuntime, bRuntime) : null);
    const garbledUnkeyedSlots = opts.poison === true ? poisonScratch(b.sim) : 0;
    const garbledRuntimeScratch = opts.poison === true && bRuntime !== undefined ? poisonRuntimeScratch(bRuntime) : [];
    const garbledStaleFields = opts.poison === true && bRuntime !== undefined ? poisonStaleFields(bRuntime) : 0;
    opts.mutate?.(b, a);
    const fork: Fork<W> = {
      T: spec.T,
      horizon: spec.horizon,
      b,
      configDifference,
      garbledUnkeyedSlots,
      garbledRuntimeScratch,
      garbledStaleFields,
      roundTripEqualAtT,
      hashDivergedAt: null,
    };
    compareHash(fork);
    live.set(index, fork);
  };
  const compareHash = (fork: Fork<W>): void => {
    if (fork.hashDivergedAt === null && hashOf(a) !== hashOf(fork.b)) fork.hashDivergedAt = a.sim.tickCount;
  };
  const judge = (index: number, fork: Fork<W>): void => {
    const aRuntime = runtimeOf(a);
    const bRuntime = runtimeOf(fork.b);
    const bEnd = tryEncode(fork.b.sim, bRuntime);
    const encodingEqualAtEnd = bEnd instanceof Uint8Array && bytesEqual(encodeSim(a.sim, {}, aRuntime), bEnd);
    const verdict: ForkVerdict<W> = {
      hashDivergedAt: fork.hashDivergedAt,
      encodingEqualAtEnd,
      roundTripEqualAtT: fork.roundTripEqualAtT,
      configDifference: fork.configDifference,
      garbledUnkeyedSlots: fork.garbledUnkeyedSlots,
      garbledRuntimeScratch: fork.garbledRuntimeScratch,
      garbledStaleFields: fork.garbledStaleFields,
      a,
      b: fork.b,
    };
    if (bEnd instanceof Error) {
      verdict.firstDifference = `B cannot be encoded: ${bEnd.message}`;
    } else if (!encodingEqualAtEnd) {
      verdict.firstDifference =
        firstStateDifference(a.sim, fork.b.sim) ??
        (aRuntime !== undefined && bRuntime !== undefined ? firstRuntimeDifference(aRuntime, bRuntime) : null) ??
        'the encodings differ outside the state columns (the tail: pool keys or an aux row)';
    } else if (!fork.roundTripEqualAtT) {
      verdict.firstDifference = `the restored world re-encodes differently at T=${fork.T}`;
    } else if (fork.hashDivergedAt !== null) {
      verdict.firstDifference = `hash differs at tick ${fork.hashDivergedAt}`;
    }
    verdicts[index] = verdict;
    live.delete(index);
  };

  for (let t = 0; ; t++) {
    // A is at tick t, before its inputs: the forks cut here see exactly that world.
    for (let i = 0; i < forks.length; i++) if (forks[i].T === t) cut(i);
    for (const [i, fork] of Array.from(live)) if (fork.horizon === 0) judge(i, fork);
    if (t === endTick) break;
    opts.drive(a, t);
    advance(a);
    for (const [i, fork] of Array.from(live)) {
      opts.drive(fork.b, t);
      advance(fork.b);
      const k = t - fork.T + 1;
      if (k % opts.hashEvery === 0) compareHash(fork);
      if (k === fork.horizon) judge(i, fork);
    }
  }
  const judged: ForkVerdict<W>[] = [];
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i];
    if (v === undefined) throw new Error(`forkWitness: fork ${i} (T=${forks[i].T}) was never judged`);
    judged.push(v);
  }
  return { verdicts: judged, a };
}

/**
 * Runs one fork and returns the verdict. The worlds are stepped in lockstep from T, both
 * driven by the same `drive(t)`; the sim hashes are compared at T and every `hashEvery`
 * ticks after, and the encodings once at the end. It never throws on a divergence: the caller
 * decides what a verdict means (a clean fork must be clean, a self-check must be red).
 */
export function forkWitness<W extends WitnessWorld>(opts: ForkWitnessOptions<W>): ForkVerdict<W> {
  return runForks(opts, [{ T: opts.T, horizon: opts.horizon }], opts.T + opts.horizon).verdicts[0];
}

/**
 * The same proof at many cut points over ONE run of A. A is built and stepped once to `endTick`
 * (`forkWitness` rebuilds it from tick 0 for every T); each `T` in `Ts` is a fork of `horizon`
 * ticks, and `tailFrom`, if given, is one more whose horizon runs to `endTick`. Forks overlap, so
 * several Bs step beside A at once. The verdicts come back in `Ts` order, the tail last, each
 * carrying its `T` and `horizon` and its B (A is shared, so it is not in the verdict).
 */
export function forkWitnessSeries<W extends WitnessWorld>(opts: ForkSeriesOptions<W>): SeriesForkVerdict<W>[] {
  for (let i = 1; i < opts.Ts.length; i++) {
    if (opts.Ts[i] < opts.Ts[i - 1]) throw new Error('forkWitnessSeries: Ts must be ascending');
  }
  const forks = opts.Ts.map((T) => ({ T, horizon: opts.horizon }));
  if (opts.tailFrom !== undefined) forks.push({ T: opts.tailFrom, horizon: opts.endTick - opts.tailFrom });
  const { verdicts } = runForks(opts, forks, opts.endTick);
  return verdicts.map((v, i) => {
    const out: SeriesForkVerdict<W> = {
      T: forks[i].T,
      horizon: forks[i].horizon,
      hashDivergedAt: v.hashDivergedAt,
      encodingEqualAtEnd: v.encodingEqualAtEnd,
      roundTripEqualAtT: v.roundTripEqualAtT,
      configDifference: v.configDifference,
      garbledUnkeyedSlots: v.garbledUnkeyedSlots,
      garbledRuntimeScratch: v.garbledRuntimeScratch,
      garbledStaleFields: v.garbledStaleFields,
      b: v.b,
    };
    if (v.firstDifference !== undefined) out.firstDifference = v.firstDifference;
    return out;
  });
}

// ---- the row census -------------------------------------------------------------------------

/**
 * The JSON of one pool row, read from the pool's keys (`Sim.fieldPoolKeys`): the same four rows
 * the encoder writes under its tail's `fieldPool` key, so "moved" means "the encoding of this row
 * differs".
 */
function poolRowJson(sim: Sim, name: string): string {
  const keys = sim.fieldPoolKeys();
  switch (name) {
    case 'fieldByGoal':
      return canonicalJson(keys.order);
    case 'fieldLastIssued':
      return canonicalJson(keys.slots.map((s) => s.lastIssued));
    case 'fieldGoalKey':
      return canonicalJson(keys.slots.map((s) => s.goal));
    case 'fieldDomain':
      return canonicalJson(keys.slots.map((s) => s.domain));
    default:
      throw new Error(`stateRowsMoved: pool row ${name} has no reader`);
  }
}

/** Whether any typed row of `Rng` (`RNG_SNAPSHOT_SCHEMA`, as the encoder walks it) differs between two generators. */
function rngMoved(a: unknown, b: unknown): boolean {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const row of RNG_SNAPSHOT_SCHEMA) {
    if (row.kind.t !== 'typed') continue;
    const va = ra[row.name];
    const vb = rb[row.name];
    if (!isTyped(va) || !isTyped(vb)) throw new Error(`stateRowsMoved: rng.${row.name} is not a typed array in both worlds`);
    if (firstTypedDifference(va, vb) >= 0) return true;
  }
  return false;
}

/**
 * The names of every `state` row whose ENCODED value differs between two worlds of one setup,
 * AT THIS MOMENT: a typed column by element (the codec writes each element exactly, so equal
 * elements are equal bytes), a scalar by value, the RNG words as `rng`, and an aux or pool row by
 * the canonical JSON the encoder writes for it. A row that moved and came back reads as unmoved,
 * so a census over a run must union the result across its cuts. Task 7b runs it with `base` = a
 * world's tick-0 world at each fork cut. It throws on a row kind it cannot read rather than
 * calling it unmoved. With `runtimes` (the two worlds' runtimes) it also names every top-level `state` row of
 * the runtime whose encoded value differs, as `runtime.<row>`.
 */
export function stateRowsMoved(base: Sim, now: Sim, runtimes?: { readonly base: MissionRuntime; readonly now: MissionRuntime }): Set<string> {
  const ib = internals(base);
  const inow = internals(now);
  const moved = new Set<string>();
  for (const row of rowsOf('state')) {
    const vb = ib[row.name];
    const vn = inow[row.name];
    switch (row.kind.t) {
      case 'typed':
        if (!isTyped(vb) || !isTyped(vn)) throw new Error(`stateRowsMoved: ${row.name} is not a typed array in both worlds`);
        if (firstTypedDifference(vb, vn) >= 0) moved.add(row.name);
        break;
      case 'scalar':
        if (vb !== vn) moved.add(row.name);
        break;
      case 'rng':
        if (rngMoved(vb, vn)) moved.add(row.name);
        break;
      case 'aux':
        if (auxJsonOf(base, row.name) !== auxJsonOf(now, row.name)) moved.add(row.name);
        break;
      case 'pool':
        if (poolRowJson(base, row.name) !== poolRowJson(now, row.name)) moved.add(row.name);
        break;
      default:
        throw new Error(`stateRowsMoved: state row ${row.name} has a kind it cannot read`);
    }
  }
  // The runtime's top-level `state` rows, by the section the codec writes, named `runtime.<row>`.
  if (runtimes !== undefined) for (const name of runtimeRowsMoved(runtimes.base, runtimes.now)) moved.add(name);
  return moved;
}
