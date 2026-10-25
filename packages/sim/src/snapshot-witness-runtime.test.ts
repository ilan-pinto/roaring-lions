import { describe, expect, it } from 'vitest';
import { economySetup, ECONOMY_SEED, RELIEF_ECO_SEED, reliefEconomySetup } from './golden-worlds.test-helper';
import type { MissionRuntime } from './mission';
import { RUNTIME_ROW_SETS, RUNTIME_SNAPSHOT_SCHEMA, runtimeRowsOf, type RowSetName } from './runtime-snapshot-schema';
import { props } from './runtime-snapshot-schema.test-helper';
import {
  ECONOMY_WORLD,
  RELIEF_WORLD,
  SINK_WINDOW_WORLD,
  SINK_WORLD,
  type RuntimeWorld,
  type RuntimeWorldSpec,
} from './snapshot-witness-worlds.test-helper';
import {
  defaultWitnessHash,
  firstRuntimeDifference,
  forkWitness,
  poisonRuntimeScratch,
  poisonRuntimeState,
  poisonStaleFields,
  runtimeConfigDiff,
  stateRowsMoved,
  type ForkVerdict,
} from './snapshot-witness';

// The runtime half of the fork witness (net sim snapshot S2, Task 4): the config check, the poison of the
// runtime's `state`, `scratch` and `derived` rows, the self-checks (R-3: a witness that cannot fail proves
// nothing), and the decision about `corridorFields`. The golden economy replays themselves are forked in
// `snapshot-witness.test.ts`. The worlds are `snapshot-witness-worlds.test-helper.ts`.

const HORIZON = 200;

type Hooks = RuntimeWorldSpec['hooks'];

function fork(spec: RuntimeWorldSpec, T: number, extra: { poison?: boolean; horizon?: number; afterRestore?: (b: RuntimeWorld, a: RuntimeWorld) => void; mutate?: (b: RuntimeWorld, a: RuntimeWorld) => void } = {}): ForkVerdict<RuntimeWorld> {
  const { horizon, ...hooks } = extra;
  return forkWitness<RuntimeWorld>({ ...(spec.hooks as Hooks), T, horizon: horizon ?? HORIZON, ...hooks });
}

const fails = (v: ForkVerdict<RuntimeWorld>): boolean => v.hashDivergedAt !== null || !v.encodingEqualAtEnd || !v.roundTripEqualAtT;
const clean = (v: ForkVerdict<RuntimeWorld>): boolean => !fails(v) && v.configDifference === null;

/** A comparable image of a value: typed arrays as arrays, Maps and Sets in insertion order, ids as ids. */
function image(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (ArrayBuffer.isView(x) && !(x instanceof DataView)) return { typed: Array.from(x as unknown as ArrayLike<number>) };
    if (x instanceof Map) return { map: Array.from(x.entries()) };
    if (x instanceof Set) return { set: Array.from(x) };
    if (typeof x === 'function') return 'fn';
    return x;
  });
}

// ---- the config check reaches the runtime ----------------------------------------------------------

describe('runtime config check: every config row of A equals B right after the restore', () => {
  it('two runtimes of one setup agree, and a top-level or a nested config row of B is named', () => {
    const a = economySetup(ECONOMY_SEED).rt;
    expect(runtimeConfigDiff(a, economySetup(ECONOMY_SEED).rt)).toBeNull();
    const relief = reliefEconomySetup(RELIEF_ECO_SEED).rt;
    expect(runtimeConfigDiff(relief, reliefEconomySetup(RELIEF_ECO_SEED).rt)).toBeNull();

    const typed = economySetup(ECONOMY_SEED).rt;
    const cells = props(typed).zoneTiles as Uint32Array;
    expect(cells.length, 'the economy mission has income zones, so zoneTiles is populated').toBeGreaterThan(0);
    cells[7] ^= 1;
    expect(runtimeConfigDiff(a, typed)).toBe('runtime.zoneTiles[7]');

    const ids = economySetup(ECONOMY_SEED).rt;
    (props(ids).startingIds as number[]).push(99);
    expect(runtimeConfigDiff(a, ids)).toMatch(/^runtime\.startingIds: \d+ entries vs \d+$/);

    // A config row INSIDE a state record: an income zone's authored rate, a line's anchor.
    const nested = economySetup(ECONOMY_SEED).rt;
    const zone = (props(nested).incomeZoneList as { ratePerMin: number }[])[0];
    zone.ratePerMin += 1;
    expect(runtimeConfigDiff(a, nested)).toMatch(/^runtime\.incomeZoneList\[0\]\.ratePerMin: /);
    const line = economySetup(ECONOMY_SEED).rt;
    (props(line).lines as { anchor: number }[][])[0][0].anchor += 1;
    expect(runtimeConfigDiff(a, line)).toMatch(/^runtime\.lines\[0\]\[0\]\.anchor: /);

    // A Set of config (`onLoan` is empty here, so use the sink-less `razeExempt`): members, not the Set object.
    const set = economySetup(ECONOMY_SEED).rt;
    (props(set).razeExempt as Set<number>).add(12345);
    expect(runtimeConfigDiff(a, set)).toBe('runtime.razeExempt: the members differ');
  }, 60_000);

  it('is wired to B in a fork: a config row flipped after the restore is reported, and a clean fork reports none', () => {
    const v = fork(ECONOMY_WORLD, 700, {
      afterRestore: (b) => {
        (props(b.runtime).zoneTiles as Uint32Array)[7] ^= 1;
      },
    });
    expect(v.configDifference, 'the config check compared A with something other than B\'s runtime').toBe('runtime.zoneTiles[7]');
    expect(fork(ECONOMY_WORLD, 700).configDifference).toBeNull();
  }, 60_000);
});

// ---- the hash and the census see the runtime -----------------------------------------------------------

describe('the default hash folds the runtime digest, and the census names runtime rows', () => {
  it('a purse change moves the default hash of a world with a runtime and no hash of a world without one', () => {
    const w = ECONOMY_WORLD.hooks.build();
    const before = defaultWitnessHash(w);
    expect(before).not.toBe(w.sim.hash() >>> 0);
    (props(w.runtime).purse as Int32Array)[0] += 240_000;
    expect(defaultWitnessHash(w)).not.toBe(before);
    // Without a runtime it is the sim's own hash, exactly.
    const bare = { sim: w.sim };
    expect(defaultWitnessHash(bare)).toBe(w.sim.hash());
  }, 60_000);

  it('stateRowsMoved(…, runtimes) reports runtime rows prefixed `runtime.`, none for two tick-0 worlds, and is empty iff the sections are equal', () => {
    const base = ECONOMY_WORLD.hooks.build();
    expect(stateRowsMoved(base.sim, ECONOMY_WORLD.hooks.build().sim, { base: base.runtime, now: ECONOMY_WORLD.hooks.build().runtime }).size).toBe(0);
    const w = ECONOMY_WORLD.hooks.build();
    for (let t = 0; t < 800; t++) {
      ECONOMY_WORLD.hooks.drive(w, t);
      ECONOMY_WORLD.hooks.advance?.(w);
    }
    const moved = stateRowsMoved(base.sim, w.sim, { base: base.runtime, now: w.runtime });
    for (const name of ['runtime.purse', 'runtime.lines', 'runtime.terrainVersion', 'runtime.playerIds']) expect(moved.has(name), `${name} moved`).toBe(true);
    // The sim-only call is unchanged: no runtime row appears unless the runtimes are passed.
    expect([...stateRowsMoved(base.sim, w.sim)].some((n) => n.startsWith('runtime.'))).toBe(false);
    // Empty iff equal: the first differing row is named, and a world against itself has none.
    expect(firstRuntimeDifference(base.runtime, w.runtime)).not.toBeNull();
    expect(firstRuntimeDifference(w.runtime, w.runtime)).toBeNull();
    expect([...moved].filter((n) => n.startsWith('runtime.')).length, 'at least the rows the first difference names').toBeGreaterThan(3);
    for (const name of moved) if (name.startsWith('runtime.')) expect(runtimeRowsOf('state').some((r) => `runtime.${r.name}` === name), `${name} is a state row`).toBe(true);
  }, 60_000);
});

// ---- the poison -----------------------------------------------------------------------------------------

/** The worlds the poison checks run in, each with the ticks it is cut at. */
const POISON_CUTS: readonly { spec: RuntimeWorldSpec; Ts: readonly number[] }[] = [
  { spec: ECONOMY_WORLD, Ts: [100, 700, 1500] },
  { spec: RELIEF_WORLD, Ts: [100, 1700] },
  { spec: SINK_WORLD, Ts: [20, 250] },
  { spec: SINK_WINDOW_WORLD, Ts: [5] },
];

/** The value of a scratch unit (`MissionRuntime.<row>` or `RowSet.<row>` inside a state record) in a runtime. */
function unitValue(rt: MissionRuntime, unit: string): unknown {
  const [set, row] = unit.split('.');
  if (set === 'MissionRuntime') return props(rt)[row];
  if (set === 'CivilianFlight') return props(props(rt).civFlight)[row];
  throw new Error(`no reader for the scratch unit ${unit}`);
}

/** Every scratch unit the schema has, as `poisonRuntimeScratch(rt, only)` takes it. */
function scratchUnits(): string[] {
  const out = RUNTIME_SNAPSHOT_SCHEMA.filter((r) => r.cls === 'scratch').map((r) => `MissionRuntime.${r.name}`);
  // A scratch row inside a record a STATE row holds (not inside a scratch record: that is poisoned with its parent).
  const reached = new Set<RowSetName>();
  for (const row of RUNTIME_SNAPSHOT_SCHEMA) {
    if (row.cls !== 'state') continue;
    const stack = [row.kind];
    while (stack.length > 0) {
      const k = stack.pop();
      if (k === undefined) continue;
      if (k.t === 'array') stack.push(k.of);
      else if (k.t === 'map') stack.push(k.value);
      else if (k.t === 'record') reached.add(k.rows);
    }
  }
  for (const set of reached) for (const r of RUNTIME_ROW_SETS[set]) if (r.cls === 'scratch') out.push(`${set}.${r.name}`);
  return out;
}

// The oracle is written out, not derived: nine scratch units, eight at the top and one inside `CivilianFlight`.
const SCRATCH_UNITS = [
  'MissionRuntime.ventOut',
  'MissionRuntime.zoneStateOut',
  'MissionRuntime.cutSpan',
  'MissionRuntime.fromTile',
  'MissionRuntime.rearTile',
  'MissionRuntime.incomeRead',
  'MissionRuntime.refusedByPopulation',
  'MissionRuntime.riseHolder',
  'CivilianFlight.scratch',
];

describe('poison: every runtime scratch row, one at a time', () => {
  it('the schema has exactly the nine scratch units the test knows', () => {
    expect(scratchUnits().sort()).toEqual([...SCRATCH_UNITS].sort());
  }, 60_000);

  it('poisoning one row at a time after the restore leaves each fork green, and every row\'s poison changed something somewhere', () => {
    const bit = new Map<string, number>(SCRATCH_UNITS.map((u) => [u, 0]));
    let forks = 0;
    for (const { spec, Ts } of POISON_CUTS) {
      for (const T of Ts) {
        for (const unit of SCRATCH_UNITS) {
          let changed = false;
          const v = fork(spec, T, {
            horizon: 100,
            mutate: (b) => {
              const before = image(unitValue(b.runtime, unit));
              const poisoned = poisonRuntimeScratch(b.runtime, unit);
              expect(poisoned.length, `${unit}: the filter found its row`).toBeGreaterThan(0);
              changed = image(unitValue(b.runtime, unit)) !== before;
            },
          });
          forks++;
          expect(clean(v), `${spec.name} T=${T}: poisoning ${unit} alone diverged the fork (${v.firstDifference ?? v.configDifference ?? `hash at ${String(v.hashDivergedAt)}`})`).toBe(true);
          if (changed) bit.set(unit, (bit.get(unit) ?? 0) + 1);
        }
      }
    }
    expect(forks).toBeGreaterThan(60);
    // A row whose poison never changed the row proves nothing about it.
    for (const [unit, n] of bit) expect(n, `${unit}: forks where the poison changed the row`).toBeGreaterThan(0);
  }, 60_000);

  it('all of them together, through the witness\'s own `poison` flag: green, and it reports what it garbled', () => {
    const v = fork(SINK_WORLD, 100, { poison: true });
    expect(clean(v)).toBe(true);
    expect([...v.garbledRuntimeScratch].sort()).toEqual(
      [...SCRATCH_UNITS, 'TileScratch.x', 'TileScratch.y', 'IncomeRead.base', 'IncomeRead.zones', 'IncomeRead.halvedBy'].sort()
    );
  }, 60_000);
});

describe('poison: the runtime\'s state rows, before the restore', () => {
  // Every state row the schema has, reached through a record somewhere (a `ref` is re-pointed, not poisoned).
  function expectedStatePaths(): string[] {
    const out = runtimeRowsOf('state').filter((r) => r.kind.t !== 'ref').map((r) => `MissionRuntime.${r.name}`);
    for (const [set, rows] of Object.entries(RUNTIME_ROW_SETS)) for (const r of rows) if (r.cls === 'state' && r.kind.t !== 'ref') out.push(`${set}.${r.name}`);
    return out;
  }

  it('visits every state row of every owned record held in an array or a field, over the worlds, and nothing that is not a state row', () => {
    const seen = new Set<string>();
    for (const [spec, T] of [
      [ECONOMY_WORLD, 0],
      [ECONOMY_WORLD, 1000],
      [RELIEF_WORLD, 800],
      [SINK_WORLD, 0],
      [SINK_WORLD, 100],
      [SINK_WINDOW_WORLD, 5],
    ] as const) {
      const w = spec.hooks.build();
      for (let t = 0; t < T; t++) {
        spec.hooks.drive(w, t);
        spec.hooks.advance?.(w);
      }
      for (const p of poisonRuntimeState(w.runtime)) seen.add(p);
    }
    const expected = expectedStatePaths();
    expect([...seen].filter((p) => !expected.includes(p)), 'visited paths that are not state rows').toEqual([]);
    // A record that is the VALUE of a Map (a corridor field, a works site's payment, a staked work) is not poisoned
    // field by field: the Map is cleared and given one junk entry whose every row is junk, and the restore must
    // clear it again. `WorksCharge` also lives in `worksPending`, which holds a charge for the span of one tick.
    expect(expected.filter((p) => !seen.has(p)).sort()).toEqual(
      [
        'CorridorField.stamp',
        'WorksCharge.intel',
        'WorksCharge.logistics',
        'WorksCharge.structType',
        'WorksCharge.typeId',
        'WorksCharge.x',
        'WorksCharge.y',
        'WorksStructure.done',
        'WorksStructure.site',
        'WorksStructure.typeId',
      ].sort()
    );
    expect(seen.size, 'state rows poisoned').toBe(95);
  }, 60_000);

  it('a mid-run runtime changes at every top-level state row that has a value, in some cut of some world', () => {
    const everChanged = new Set<string>();
    for (const { spec, Ts } of POISON_CUTS) {
      for (const T of Ts) {
        const w = spec.hooks.build();
        for (let t = 0; t < T; t++) {
          spec.hooks.drive(w, t);
          spec.hooks.advance?.(w);
        }
        const before = new Map(runtimeRowsOf('state').map((r) => [r.name, image(props(w.runtime)[r.name])]));
        poisonRuntimeState(w.runtime);
        for (const r of runtimeRowsOf('state')) if (image(props(w.runtime)[r.name]) !== before.get(r.name)) everChanged.add(r.name);
      }
    }
    // A row the poison never changed is one whose restore the witness cannot see. The only rows that can be like that are a
    // ref (re-pointed, not poisoned: none is top-level) and the mask copies, which these worlds do not all keep.
    const never = runtimeRowsOf('state').map((r) => r.name).filter((n) => !everChanged.has(n));
    expect(never, 'top-level state rows no cut of any world could poison').toEqual([]);
  }, 60_000);

  it('goes in BEFORE the restore: a row the world never changes sees the garbage, then the restored value', () => {
    // `firedTriggers` stays all-false in the sink world (its one trigger waits for tick 9999), so B's build value equals A's
    // value at every cut: a restore that skipped the row would read as right unless the garbage went in first. A proxy
    // on B's array logs every element write: the poison's negation, then the restore.
    const writes: boolean[] = [];
    let builds = 0;
    const spec: RuntimeWorldSpec = {
      ...SINK_WORLD,
      hooks: {
        ...SINK_WORLD.hooks,
        build: () => {
          const w = SINK_WORLD.hooks.build();
          if (builds++ > 0) {
            const rt = props(w.runtime);
            rt.firedTriggers = new Proxy(rt.firedTriggers as boolean[], {
              set(target, key, value) {
                if (key !== 'length') writes.push(value as boolean);
                (target as unknown as Record<string | symbol, unknown>)[key] = value;
                return true;
              },
            });
          }
          return w;
        },
      },
    };
    const v = fork(spec, 20, { horizon: 40 });
    expect(clean(v)).toBe(true);
    expect(writes, 'the garbage (the negation of false), then the restored value').toEqual([true, false]);
  }, 60_000);

  it('a null array is skipped only for the lazily built works list; any other null array is a thrown error', () => {
    const w = SINK_WORLD.hooks.build();
    const rt = props(w.runtime);
    rt.worksList = null;
    expect(() => poisonRuntimeState(w.runtime)).not.toThrow();
    rt.firedTriggers = null;
    expect(() => poisonRuntimeState(w.runtime)).toThrow(/MissionRuntime\.firedTriggers is not an array/);
  }, 60_000);

  it('a restore that wrote nothing is red: the poisoned runtime is left in place after the restore', () => {
    for (const spec of [ECONOMY_WORLD, SINK_WORLD]) {
      const v = fork(spec, spec === SINK_WORLD ? 100 : 700, {
        mutate: (b) => {
          poisonRuntimeState(b.runtime);
        },
      });
      expect(fails(v), `${spec.name}: poisoned runtime rows after the restore must turn the witness red`).toBe(true);
    }
  }, 60_000);
});

describe('poison: a stale corridor field (the derived row) is garbled and never read', () => {
  /** Adds, in A only (before the cut), a corridor field no route asks for and leaves it one terrain version behind. */
  const staleSpec = (): RuntimeWorldSpec => ({
    name: `${RELIEF_WORLD.name} + a stale field`,
    ticks: RELIEF_WORLD.ticks,
    hooks: {
      ...RELIEF_WORLD.hooks,
      drive: (w, t) => {
        RELIEF_WORLD.hooks.drive(w, t);
        if (t === 99) {
          const rt = props(w.runtime);
          (rt.routeSource as { fieldFor: (x: number, y: number) => unknown }).fieldFor(3, 3);
          const entry = (rt.corridorFields as Map<number, { stamp: number }>).get(3 * 48 + 3);
          if (entry === undefined) throw new Error('the stale-field fixture could not add its field');
          entry.stamp = (rt.terrainVersion as number) - 1;
        }
      },
    },
  });

  it('is green, and the witness garbled exactly that one field', () => {
    const v = fork(staleSpec(), 100, { poison: true });
    expect(clean(v)).toBe(true);
    expect(v.garbledStaleFields).toBe(1);
    // Without the stale entry there is nothing to garble: the current field is the restore's own recompute and is left alone.
    expect(fork(RELIEF_WORLD, 100, { poison: true }).garbledStaleFields).toBe(0);
  }, 60_000);

  it('poisonStaleFields touches only a stale entry, and garbles it', () => {
    const w = RELIEF_WORLD.hooks.build();
    for (let t = 0; t < 120; t++) {
      RELIEF_WORLD.hooks.drive(w, t);
      RELIEF_WORLD.hooks.advance?.(w);
    }
    const fields = props(w.runtime).corridorFields as Map<number, { field: { dirs: Uint8Array }; stamp: number }>;
    const current = [...fields.values()].map((e) => image(e.field.dirs));
    expect(current.length).toBeGreaterThan(0);
    expect(poisonStaleFields(w.runtime)).toBe(0);
    expect([...fields.values()].map((e) => image(e.field.dirs))).toEqual(current);
    const entry = [...fields.values()][0];
    entry.stamp -= 1;
    expect(poisonStaleFields(w.runtime)).toBe(1);
    expect(image(entry.field.dirs)).not.toBe(current[0]);
  }, 60_000);
});

// ---- the self-checks: a witness that cannot fail proves nothing --------------------------------------------
//
// Each applies ONE mutation to B right after the restore (and the poison) and requires the witness RED. A
// mutation that changes nothing in the chosen world is not evidence: each returns whether it changed the row it
// names, the check fails if it did not, and the cut is one where that row is populated. The clean control runs
// first, at the same T. Each prints whether the HASH alone noticed (information, never asserted: the hash is
// blind to a good part of the runtime, which is why the encodings are compared too).

function selfCheck(label: string, spec: RuntimeWorldSpec, T: number, mutation: (b: RuntimeWorld, a: RuntimeWorld) => boolean): ForkVerdict<RuntimeWorld> {
  const control = fork(spec, T, { poison: true });
  expect(clean(control), `${label}: the clean control at T=${T} must be green (${control.firstDifference ?? ''})`).toBe(true);
  let effective = false;
  const v = fork(spec, T, {
    poison: true,
    mutate: (b, a) => {
      effective = mutation(b, a);
    },
  });
  expect(effective, `${label}: the mutation changed nothing at T=${T}, so it is not evidence`).toBe(true);
  console.log(
    `self-check ${label} (T=${T}, ${spec.name}): ${v.hashDivergedAt !== null ? `the hash noticed (tick ${v.hashDivergedAt})` : 'the hash was BLIND'}; ` +
      `${v.encodingEqualAtEnd ? 'encodings equal' : `encodings differ (${v.firstDifference ?? '?'})`}`
  );
  expect(fails(v), `${label}: the witness stayed green with the mutation applied`).toBe(true);
  return v;
}

describe('runtime self-checks that must stay red', () => {
  it('the purse reset (golden economy, where the purse is non-zero at T=700)', () => {
    const v = selfCheck('purse reset', ECONOMY_WORLD, 700, (b) => {
      const purse = props(b.runtime).purse as Int32Array;
      const before = image(purse);
      purse.fill(0);
      return image(purse) !== before;
    });
    // The purse feeds `economyHash`, so the runtime digest in the hash sees it.
    expect(v.hashDivergedAt, 'the purse is hashed').not.toBeNull();
  }, 60_000);

  it('one production line\'s queue emptied (sink world: three builds queued at tick 3)', () => {
    selfCheck('line queue emptied', SINK_WORLD, 20, (b) => {
      const queue = (props(b.runtime).lines as { queue: unknown[] }[][])[0][0].queue;
      const before = image(queue);
      queue.length = 0;
      return image(queue) !== before;
    });
  }, 60_000);

  it('entityRoster re-linked to copies, the ctx identity broken (sink world: one ledger draw)', () => {
    const v = selfCheck('entityRoster copies', SINK_WORLD, 20, (b) => {
      const roster = props(b.runtime).entityRoster as Map<number, unknown>;
      const before = [...roster.values()];
      for (const [id, entry] of roster) roster.set(id, JSON.parse(JSON.stringify(entry)) as unknown);
      return before.length > 0 && [...roster.values()].some((x, i) => x !== before[i]);
    });
    // The copy equals the ledger element in content, so no hash can see it; the encoder refuses it, which the witness reports.
    expect(v.firstDifference ?? '').toMatch(/B cannot be encoded: runtime snapshot: MissionRuntime\.entityRoster\.get\(\) is not an element of the ledger roster/);
  }, 60_000);

  it('the rosterPool re-linked to copies too (the pool is state: spliced by a from_ledger placement)', () => {
    const v = selfCheck('rosterPool copies', SINK_WORLD, 20, (b) => {
      const pool = props(b.runtime).rosterPool as unknown[];
      const before = [...pool];
      for (let i = 0; i < pool.length; i++) pool[i] = JSON.parse(JSON.stringify(pool[i])) as unknown;
      return before.length > 0 && pool.some((x, i) => x !== before[i]);
    });
    // Pin the REASON: any unrelated red (a mutation that breaks the encoding some other way) must not pass for this one.
    expect(v.firstDifference ?? '').toMatch(/rosterPool\[\] is not an element of the ledger roster/);
  }, 60_000);

  it('a civFlight latch cleared (sink world: both civilians have fled at tick 1)', () => {
    selfCheck('civFlight latch cleared', SINK_WORLD, 20, (b) => {
      const latch = props(props(b.runtime).civFlight).fledSet as Set<number>;
      const before = image(latch);
      latch.clear();
      return image(latch) !== before;
    });
  }, 60_000);

  it('corridorFields cleared (state, so the encoding sees it; see the next block for what the hash does)', () => {
    for (const [spec, T] of [
      [ECONOMY_WORLD, 700],
      [RELIEF_WORLD, 1100],
      [SINK_WORLD, 100],
      [SINK_WINDOW_WORLD, 5],
    ] as const) {
      selfCheck('corridorFields cleared', spec, T, (b) => {
        const fields = props(b.runtime).corridorFields as Map<number, unknown>;
        const before = [...fields.keys()].join(',');
        fields.clear();
        return before !== '';
      });
    }
  }, 60_000);

  it('a neutered mutation is caught as "not evidence", not counted as red', () => {
    // The mutation below changes nothing. `selfCheck` must fail on its own first assertion.
    expect(() => selfCheck('no-op', SINK_WORLD, 20, () => false)).toThrow(/changed nothing/);
  }, 60_000);
});

// ---- corridorFields: state, and the evidence (snapshot S2, Task 4) --------------------------------------------
//
// The question: can `corridorFields` be `derived` (not sent, cleared on restore, recomputed on demand) instead of
// `state` (keys and stamps sent, fields recomputed over the runtime's mask copies on restore)?
//
// What the code says (mission.ts, read at this commit): every `corridorRoute` call is inside `recheckCorridors`, whose
// first statement is `syncTerrain()`; `fieldFor` recomputes any entry whose stamp is not `terrainVersion`, over the
// sim's masks, which at that moment ARE the runtime's copies. A current-stamped entry was computed at an earlier
// recheck over the copies of that time, and a terrain change since would have bumped the version. So at every read a
// current entry equals `compute(masks now)`, and clearing the Map is behaviourally neutral (the staking/cancel window
// included: the masks are back to the copies, the version never bumped, and a fresh compute equals the old field).
//
// What the witness says (the block below): clearing B's map leaves the hash and the runtime digest equal for
// the rest of the fork in every world, the window world included. It is red ONLY through the encodings, because the
// entries are `state` rows (keys and stamps). That is the whole case against `state`: a few bytes and one recompute
// per entry at restore. The case for keeping it: the Task 3 finding (leaving a current entry as a zero field,
// the "uncomputed" option, diverges), and that a restore which computes over the SIM's masks at the snapshot tick is
// wrong inside a staking window while the bytes cannot tell (`runtime-snapshot.test.ts`, the mask-copy spec). The
// default stays `state`: it costs nothing that matters, and `derived` could be adopted later on this evidence.

describe('corridorFields: clearing it is behaviourally neutral, and only the encodings see it', () => {
  it('hash and runtime digest stay equal for the rest of the fork in every world, including the staking window', () => {
    // `encodingsDiffer`: whether the end encodings differ. They do whenever no later terrain bump makes both runtimes
    // re-read the same fields in the same order (the entries are state: keys, stamps, insertion order). In the plain sink
    // world a cut at tick 5 sees the site's terrain bump at tick 20, which refills B's map exactly as A's.
    const cases = [
      { spec: ECONOMY_WORLD, T: 700, horizon: HORIZON, encodingsDiffer: true },
      { spec: RELIEF_WORLD, T: 1100, horizon: HORIZON, encodingsDiffer: true },
      { spec: SINK_WORLD, T: 100, horizon: 250, encodingsDiffer: true },
      { spec: SINK_WORLD, T: 5, horizon: 250, encodingsDiffer: false },
      { spec: SINK_WINDOW_WORLD, T: 5, horizon: 250, encodingsDiffer: true },
      { spec: SINK_WINDOW_WORLD, T: 9, horizon: 250, encodingsDiffer: true },
    ];
    for (const { spec, T, horizon, encodingsDiffer } of cases) {
      let cleared = 0;
      const v = fork(spec, T, {
        horizon,
        mutate: (b) => {
          const fields = props(b.runtime).corridorFields as Map<number, unknown>;
          cleared = fields.size;
          fields.clear();
        },
      });
      expect(cleared, `${spec.name} T=${T}: there were fields to clear`).toBeGreaterThan(0);
      expect(v.hashDivergedAt, `${spec.name} T=${T}: behaviour diverged after clearing the fields`).toBeNull();
      expect(v.encodingEqualAtEnd, `${spec.name} T=${T}: encodings differ at the end`).toBe(!encodingsDiffer);
      if (encodingsDiffer) expect(v.firstDifference).toBe('runtime.corridorFields');
    }
  }, 60_000);
});
