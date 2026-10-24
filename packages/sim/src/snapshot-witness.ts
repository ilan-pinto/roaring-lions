import { FlowField } from './flowfield';
import { encodeSim, internals, restoreSim } from './snapshot';
import { rowsOf, type SnapshotRow } from './snapshot-schema';
import type { Sim } from './sim';

// The fork witness (net sim snapshot, stage 1, Task 5): the core proof that a
// snapshot carries the whole match.
//
//   A runs the world uninterrupted. At tick T its state is encoded to bytes S.
//   B is a FRESH world from the same build, restored from S alone, and both are
//   then driven with the same inputs for `horizon` ticks.
//
// The verdict needs two things. The hashes must agree at every hash tick, AND the
// canonical encodings of A and B must be byte-equal at the end. Hash equality is
// not enough: the reflection probe (spec 6.2) showed `fieldByGoal` emptied and
// `fieldLastIssued` reset leaving every hash equal while `fieldRef` and the pool
// diverged. The encoding covers every `state` row, hashed or not, so it sees what
// the hash does not.
//
// This is a NON-test module so tools/ runs the SAME proof on the versus and
// economy worlds (Task 7). It is generic over a world that exposes `.sim`, so a
// caller can carry a runtime beside it.

/** Anything that owns a `Sim`; a caller may add whatever else it drives (a runtime, ids). */
export interface WitnessWorld {
  readonly sim: Sim;
}

export interface ForkWitnessOptions<W extends WitnessWorld> {
  /** A fresh tick-0 world. Called twice: once for A, once for B. */
  build: () => W;
  /** Applies tick `t`'s inputs. Called on BOTH worlds identically: some drivers make direct sim calls. */
  drive: (world: W, t: number) => void;
  /** Steps one tick. Defaults to `world.sim.tick()`. */
  advance?: (world: W) => void;
  /** The tick the snapshot is cut at. */
  T: number;
  /** How many ticks both worlds then run. */
  horizon: number;
  /** Hashes are compared at T and then every `hashEvery` ticks. */
  hashEvery: number;
  /** What the hash is. Defaults to `world.sim.hash()`. */
  hash?: (world: W) => number;
  /** Runs on B right after the restore, before anything is mutated (a caller carrying a runtime copies it here). */
  afterRestore?: (b: W, a: W) => void;
  /** Runs on B after the restore and `afterRestore`: the mutation a self-check applies, or `poisonScratch`. */
  mutate?: (b: W, a: W) => void;
}

export interface ForkVerdict<W extends WitnessWorld> {
  /** The first sim tick at which the two hashes differed, or null if they never did. */
  hashDivergedAt: number | null;
  /** Whether `encodeSim(A)` and `encodeSim(B)` are byte-equal after the horizon. */
  encodingEqualAtEnd: boolean;
  /** Where the divergence first shows: the first differing `state` row, or the hash tick. Absent when clean. */
  firstDifference?: string;
  /** `configDiff(A, B)` right after the restore, before any mutation: null when every `config` row agrees. */
  configDifference: string | null;
  /** The two worlds after the horizon, for a caller's own extra comparisons. */
  a: W;
  b: W;
}

type Typed = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array;

const isTyped = (v: unknown): v is Typed =>
  v instanceof Int8Array || v instanceof Uint8Array || v instanceof Int16Array || v instanceof Uint16Array || v instanceof Int32Array || v instanceof Uint32Array;

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
    } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
      return `${row.name}: differs by JSON`;
    }
  }
  return null;
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
export function poisonScratch(sim: Sim): void {
  const self = internals(sim);
  for (const row of rowsOf('scratch')) poisonRow(self, row, sim);
  const fields = self.fields as FlowField[];
  const goalKey = self.fieldGoalKey as number[];
  for (let i = 0; i < fields.length; i++) {
    if (goalKey[i] === -1) garble(fields[i], POISON_UNKEYED);
  }
}

function poisonRow(self: Record<string, unknown>, row: SnapshotRow, sim: Sim): void {
  const v = self[row.name];
  if (row.kind.t === 'typed') {
    if (!isTyped(v)) throw new Error(`poisonScratch: ${row.name} is not a typed array`);
    v.fill(POISON_BYTE);
  } else if (row.kind.t === 'scalar') {
    self[row.name] = typeof v === 'boolean' ? true : POISON_SCALAR;
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

/**
 * Runs one fork and returns the verdict. The worlds are stepped in lockstep from T, both
 * driven by the same `drive(t)`; the sim hashes are compared at T and every `hashEvery`
 * ticks after, and the encodings once at the end. It never throws on a divergence: the caller
 * decides what a verdict means (a clean fork must be clean, a self-check must be red).
 */
export function forkWitness<W extends WitnessWorld>(opts: ForkWitnessOptions<W>): ForkVerdict<W> {
  const advance = opts.advance ?? ((w: W): void => { w.sim.tick(); });
  const hashOf = opts.hash ?? ((w: W): number => w.sim.hash());

  const a = opts.build();
  for (let t = 0; t < opts.T; t++) {
    opts.drive(a, t);
    advance(a);
  }
  const bytes = encodeSim(a.sim);

  const b = opts.build();
  restoreSim(b.sim, bytes);
  opts.afterRestore?.(b, a);
  const configDifference = configDiff(a.sim, b.sim);
  opts.mutate?.(b, a);

  let hashDivergedAt: number | null = null;
  const compareHash = (): void => {
    if (hashDivergedAt === null && hashOf(a) !== hashOf(b)) hashDivergedAt = a.sim.tickCount;
  };
  compareHash();
  for (let k = 1; k <= opts.horizon; k++) {
    const t = opts.T + k - 1;
    opts.drive(a, t);
    advance(a);
    opts.drive(b, t);
    advance(b);
    if (k % opts.hashEvery === 0) compareHash();
  }

  const encodingEqualAtEnd = bytesEqual(encodeSim(a.sim), encodeSim(b.sim));
  const verdict: ForkVerdict<W> = { hashDivergedAt, encodingEqualAtEnd, configDifference, a, b };
  if (!encodingEqualAtEnd) {
    verdict.firstDifference = firstStateDifference(a.sim, b.sim) ?? 'the encodings differ outside the state columns (the tail: pool keys or an aux row)';
  } else if (hashDivergedAt !== null) {
    verdict.firstDifference = `hash differs at tick ${hashDivergedAt}`;
  }
  return verdict;
}
