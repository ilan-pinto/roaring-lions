import { FlowField } from './flowfield';
import { canonicalJson, encodeSim, internals, isTyped, restoreSim, type Typed } from './snapshot';
import { RNG_SNAPSHOT_SCHEMA, rowsOf, type SnapshotRow } from './snapshot-schema';
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
  /** What the hash is. Defaults to `world.sim.hash()`. */
  hash?: (world: W) => number;
  /**
   * Runs on B right after the restore, before anything is mutated (a caller carrying a runtime copies it here).
   * A is exactly at tick T when it runs, in a series too: A has not stepped past T.
   */
  afterRestore?: (b: W, a: W) => void;
  /**
   * Fills everything the restore promises not to write with garbage (see `poisonScratch`), after
   * `afterRestore` and before `mutate`. The verdict's `garbledUnkeyedSlots` says how many pool
   * slots that actually garbled.
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
  /** Where the divergence first shows: the first differing `state` row, or the hash tick. Absent when clean. */
  firstDifference?: string;
  /** `configDiff(A, B)` right after the restore, before any mutation: null when every `config` row agrees. */
  configDifference: string | null;
  /** How many unkeyed pool slots `poison` garbled (0 when `poison` was off or the pool had none). */
  garbledUnkeyedSlots: number;
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

interface Fork<W extends WitnessWorld> {
  readonly T: number;
  readonly horizon: number;
  readonly b: W;
  readonly configDifference: string | null;
  readonly garbledUnkeyedSlots: number;
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
  const hashOf = opts.hash ?? ((w: W): number => w.sim.hash());

  const a = opts.build();
  const verdicts: (ForkVerdict<W> | undefined)[] = forks.map(() => undefined);
  const live = new Map<number, Fork<W>>();

  const cut = (index: number): void => {
    const spec = forks[index];
    const bytes = encodeSim(a.sim);
    const b = opts.build();
    restoreSim(b.sim, bytes);
    opts.afterRestore?.(b, a);
    const configDifference = configDiff(a.sim, b.sim);
    const garbledUnkeyedSlots = opts.poison === true ? poisonScratch(b.sim) : 0;
    opts.mutate?.(b, a);
    const fork: Fork<W> = { T: spec.T, horizon: spec.horizon, b, configDifference, garbledUnkeyedSlots, hashDivergedAt: null };
    compareHash(fork);
    live.set(index, fork);
  };
  const compareHash = (fork: Fork<W>): void => {
    if (fork.hashDivergedAt === null && hashOf(a) !== hashOf(fork.b)) fork.hashDivergedAt = a.sim.tickCount;
  };
  const judge = (index: number, fork: Fork<W>): void => {
    const encodingEqualAtEnd = bytesEqual(encodeSim(a.sim), encodeSim(fork.b.sim));
    const verdict: ForkVerdict<W> = {
      hashDivergedAt: fork.hashDivergedAt,
      encodingEqualAtEnd,
      configDifference: fork.configDifference,
      garbledUnkeyedSlots: fork.garbledUnkeyedSlots,
      a,
      b: fork.b,
    };
    if (!encodingEqualAtEnd) {
      verdict.firstDifference = firstStateDifference(a.sim, fork.b.sim) ?? 'the encodings differ outside the state columns (the tail: pool keys or an aux row)';
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
      configDifference: v.configDifference,
      garbledUnkeyedSlots: v.garbledUnkeyedSlots,
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
 * calling it unmoved.
 */
export function stateRowsMoved(base: Sim, now: Sim): Set<string> {
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
        if (canonicalJson(vb) !== canonicalJson(vn)) moved.add(row.name);
        break;
      case 'pool':
        if (poolRowJson(base, row.name) !== poolRowJson(now, row.name)) moved.add(row.name);
        break;
      default:
        throw new Error(`stateRowsMoved: state row ${row.name} has a kind it cannot read`);
    }
  }
  return moved;
}
