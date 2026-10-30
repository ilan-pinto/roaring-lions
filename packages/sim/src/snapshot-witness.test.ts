import { describe, expect, it } from 'vitest';
import {
  FM_SEED,
  ORDERS_SEED,
  RELIEF_SEED,
  RUN_SEED,
  ordersDrive,
  formationDrive,
  formationSetup,
  ordersSetup,
  reliefDrive,
  reliefSetup,
  runDrive,
  runSetup,
} from './golden-worlds.test-helper';
import { HASH_SEED, hashWord } from './hash';
import { ECONOMY_WORLD, RELIEF_WORLD, type RuntimeWorld } from './snapshot-witness-worlds.test-helper';
import { rowsOf } from './snapshot-schema';
import { encodeSim, internals, type Typed } from './snapshot';
import { configDiff, forkWitness, forkWitnessSeries, stateRowsMoved, type ForkVerdict, type WitnessWorld } from './snapshot-witness';
import type { Sim } from './sim';

// The fork witness on the three runtime-free golden worlds (net sim snapshot S1,
// Task 5): restore a world at tick T onto a fresh one, drive both with the same
// inputs, and require the hash equal at every hash tick AND the canonical
// encodings byte-equal at the end. The routine is `snapshot-witness.ts`, a
// non-test module, so tools/ runs the same proof on the versus worlds.

const HORIZON = 200;
const HASH_EVERY = 20;

interface World extends WitnessWorld {
  readonly sim: Sim;
}

interface Golden {
  readonly name: string;
  readonly ticks: number;
  readonly build: () => World;
  readonly drive: (w: World, t: number) => void;
  /** Three snapshot ticks for the poison check. */
  readonly poisonAt: readonly number[];
  /** Whether the poison check must find an unkeyed pool slot to garble (only the battle has any). */
  readonly poisonsPool: boolean;
}

const GOLDEN: readonly Golden[] = [
  {
    name: 'the 1000-tick battle',
    ticks: 1000,
    build: () => runSetup(RUN_SEED),
    drive: (w, t) => runDrive(w.sim, t, (w as ReturnType<typeof runSetup>).ids),
    poisonAt: [300, 500, 700],
    poisonsPool: true,
  },
  {
    name: 'the relief replay (900 ticks)',
    ticks: 900,
    build: () => reliefSetup(RELIEF_SEED, true),
    drive: (w, t) => reliefDrive(w.sim, t, (w as ReturnType<typeof reliefSetup>).up),
    poisonAt: [100, 300, 600],
    poisonsPool: false,
  },
  {
    name: 'the orders replay (900 ticks)',
    ticks: 900,
    build: () => ordersSetup(ORDERS_SEED),
    drive: (w, t) => ordersDrive(w.sim, t, (w as ReturnType<typeof ordersSetup>).ids),
    poisonAt: [50, 300, 600],
    poisonsPool: false,
  },
];

function fork(g: Golden, T: number, extra: { poison?: boolean; afterRestore?: (b: World, a: World) => void; mutate?: (b: World, a: World) => void } = {}): ForkVerdict<World> {
  return forkWitness<World>({ build: g.build, drive: g.drive, T, horizon: HORIZON, hashEvery: HASH_EVERY, ...extra });
}

function expectClean(v: Omit<ForkVerdict<World>, 'a'>, label: string): void {
  expect(v.configDifference, `${label}: a config row differs after the restore`).toBeNull();
  expect(v.roundTripEqualAtT, `${label}: the restored world does not re-encode to its own bytes`).toBe(true);
  expect(v.hashDivergedAt, `${label}: hash diverged`).toBeNull();
  expect(v.encodingEqualAtEnd, `${label}: encodings differ at the end (${v.firstDifference ?? ''})`).toBe(true);
}

describe('fork witness: restore at T, step 200 ticks, hash and encoding equal', () => {
  for (const g of GOLDEN) {
    it(`${g.name}: every T = 0, 50, 100, ... up to its end - 200`, () => {
      let forks = 0;
      for (let T = 0; T + HORIZON <= g.ticks; T += 50) {
        expectClean(fork(g, T), `${g.name} T=${T}`);
        forks++;
      }
      expect(forks).toBeGreaterThan(10);
    }, 60_000);
  }
});

describe('fork witness: scratch and unkeyed pool slots poisoned after the restore', () => {
  for (const g of GOLDEN) {
    it(`${g.name}: stays green at ${g.poisonAt.join(', ')}`, () => {
      let unkeyed = 0;
      for (const T of g.poisonAt) {
        const v = fork(g, T, { poison: true });
        unkeyed += v.garbledUnkeyedSlots;
        expectClean(v, `${g.name} poisoned T=${T}`);
      }
      // A poison check that garbles nothing proves nothing: say what it had to garble.
      if (g.poisonsPool) {
        expect(unkeyed, 'unkeyed pool slots garbled').toBeGreaterThan(0);
      }
    });
  }
});

// ---- the golden economy replays: the runtime is carried natively (snapshot S2, Task 4) --------
//
// The two replays that run a `MissionRuntime` for 2400 ticks, cut every 100 ticks (so at every moment their
// drivers act: builds, the rally, the raider's walk, the cancel, the order to the pass) and run 200 ticks
// after each, with everything the restore promises not to write poisoned, the runtime's `state` rows
// before the restore and its `scratch` rows after it. Their drivers make direct runtime calls
// (`requestBuild`, `setRally`, `cancelBuild`), so the witness drives BOTH worlds. The self-checks, the
// per-row poison checks and the corridor-field decision are in `snapshot-witness-runtime.test.ts`.

describe('fork witness: the golden economy replays carry their MissionRuntime', () => {
  for (const spec of [ECONOMY_WORLD, RELIEF_WORLD]) {
    it(`${spec.name}: T = 0, 100, ... 2200, 200 ticks each, runtime poisoned and restored`, () => {
      const Ts: number[] = [];
      for (let T = 0; T + HORIZON <= spec.ticks; T += 100) Ts.push(T);
      const verdicts = forkWitnessSeries<RuntimeWorld>({ ...spec.hooks, Ts, horizon: HORIZON, endTick: spec.ticks, poison: true });
      expect(verdicts.length).toBe(Ts.length);
      for (const v of verdicts) {
        expectClean(v, `${spec.name} T=${v.T}`);
        // A poison that garbled no runtime row proves nothing about the rows it names.
        expect(v.garbledRuntimeScratch.length, `${spec.name} T=${v.T}: runtime scratch rows garbled`).toBeGreaterThan(0);
        // The hash these forks compared is the one with the runtime folded in.
        expect(v.b.runtime, `${spec.name} T=${v.T}: the forked world has a runtime`).toBeDefined();
      }
    }, 60_000);
  }
});

// ---- the self-checks: a witness that cannot fail proves nothing -----------------------------
//
// Each applies ONE mutation to B right after the restore and requires the witness to FAIL
// (hash diverged, or encodings differ at the end). The mutations are the spec's 6.2 table; the
// reason they are permanent tests is CLAUDE.md's "every check gets an input that makes it fail".
// Each also prints whether the HASH alone noticed. That is information, never asserted: the
// hash's blindness depends on the world (spec 6.2 saw `fieldByGoal` leave every hash equal).

const RUN = GOLDEN[0];

function fails(v: ForkVerdict<World>): boolean {
  return v.hashDivergedAt !== null || !v.encodingEqualAtEnd || !v.roundTripEqualAtT;
}

function report(label: string, v: ForkVerdict<World>): void {
  console.log(
    `self-check ${label}: ${v.hashDivergedAt !== null ? `the hash noticed (tick ${v.hashDivergedAt})` : 'the hash was BLIND'}; ` +
      `${v.encodingEqualAtEnd ? 'encodings equal' : `encodings differ (${v.firstDifference ?? '?'})`}`
  );
}

describe('fork witness: self-checks that must stay red', () => {
  it('the config check is wired to B: one openGrid byte flipped after the restore is reported', () => {
    const v = fork(RUN, 250, {
      afterRestore: (b) => {
        (internals(b.sim).openGrid as Uint8Array)[7] ^= 1;
      },
    });
    expect(v.configDifference, 'configDiff compared A with something other than B').toBe('openGrid[7]');
  });

  it('fieldByGoal emptied: the encoding differs by the end (the hash stays equal)', () => {
    const v = fork(RUN, 250, {
      mutate: (b) => {
        for (const m of internals(b.sim).fieldByGoal as Map<number, number>[]) m.clear();
      },
    });
    report('fieldByGoal emptied', v);
    expect(fails(v)).toBe(true);
  });

  it('fieldLastIssued zeroed: the encoding differs by the end', () => {
    const v = fork(RUN, 250, {
      mutate: (b) => {
        (internals(b.sim).fieldLastIssued as number[]).fill(0);
      },
    });
    report('fieldLastIssued zeroed', v);
    expect(fails(v)).toBe(true);
  });

  it('rng.state reset to the fresh seed: the hash fails at the first hash tick', () => {
    const T = 300;
    const fresh = RUN.build();
    const v = fork(RUN, T, {
      mutate: (b) => {
        (internals(b.sim).rng as { state: Uint32Array }).state.set((internals(fresh.sim).rng as { state: Uint32Array }).state);
      },
    });
    report('rng.state reset', v);
    expect(fails(v)).toBe(true);
    expect(v.hashDivergedAt, 'the hash covers the RNG words, so it sees this at once').not.toBeNull();
    expect(v.hashDivergedAt as number).toBeLessThanOrEqual(T + HASH_EVERY);
  });

  it('trail zeroed at T = 300 of the 1000-tick world, which digs from tick 0', () => {
    const v = fork(RUN, 300, {
      mutate: (b) => {
        (internals(b.sim).trail as Uint8Array).fill(0);
      },
    });
    report('trail zeroed', v);
    expect(fails(v)).toBe(true);
  });
});

describe('config check: every config row of A equals B after the restore', () => {
  it('two worlds from one setup agree, and a change to a typed, scalar or table row is named', () => {
    const a = RUN.build().sim;
    expect(configDiff(a, RUN.build().sim)).toBeNull();

    const typed = RUN.build().sim;
    (internals(typed).openGrid as Uint8Array)[7] ^= 1;
    expect(configDiff(a, typed)).toBe('openGrid[7]');

    const scalar = RUN.build().sim;
    internals(scalar).seed = (internals(scalar).seed as number) + 1;
    expect(configDiff(a, scalar)).toMatch(/^seed: /);

    const table = RUN.build().sim;
    (internals(table).structureTypes as unknown[]).push({ id: 'extra' });
    expect(configDiff(a, table)).toBe('structureTypes: differs by JSON');

    // `tnTiles` is a Set<number>[]: JSON alone writes every Set as {}, so only the replacer sees this.
    const tiles = RUN.build().sim;
    const set = (internals(tiles).tnTiles as Set<number>[])[0];
    expect(set.size, 'the battle digs, so route 0 has tiles').toBeGreaterThan(0);
    const first = Array.from(set)[0];
    set.delete(first);
    set.add(first + 1_000_000);
    expect(configDiff(a, tiles)).toBe('tnTiles: differs by JSON');
  });
});

// ---- the series runner: one A, many forks ---------------------------------------------------

// Measured (26 Oct): the "hands the hooks A" and "a mutation applied to one fork" tests take 0.44-0.55 s,
// alone or inside the file, at load average ~14. Both hit the default 5 s limit under a load average of
// ~100 (a full `pnpm test` beside other streams): >10x slower. 60 s is the limit the other tests in this
// file already use, ~120x the unloaded time. No assertion depends on it.
const SERIES_TIMEOUT_MS = 60_000;
describe('fork witness series: one run of A, a fork at every T', () => {
  const Ts = [0, 100, 200, 300, 400, 500, 600, 700, 800];
  const END = 1000;
  const series = (extra: { poison?: boolean; afterRestore?: (b: World, a: World) => void; mutate?: (b: World, a: World) => void } = {}) =>
    forkWitnessSeries<World>({ build: RUN.build, drive: RUN.drive, Ts, horizon: HORIZON, hashEvery: HASH_EVERY, tailFrom: 300, endTick: END, ...extra });

  it('gives the verdicts of separate forkWitness calls at the same T, the tail last', () => {
    const verdicts = series({ poison: true });
    expect(verdicts.map((v) => v.T)).toEqual([...Ts, 300]);
    expect(verdicts.map((v) => v.horizon)).toEqual([...Ts.map(() => HORIZON), END - 300]);
    for (const v of verdicts) {
      const one = forkWitness<World>({ build: RUN.build, drive: RUN.drive, T: v.T, horizon: v.horizon, hashEvery: HASH_EVERY, poison: true });
      expectClean(v, `series T=${v.T} horizon=${v.horizon}`);
      expect(v.hashDivergedAt, `T=${v.T} horizon=${v.horizon}`).toBe(one.hashDivergedAt);
      expect(v.encodingEqualAtEnd, `T=${v.T} horizon=${v.horizon}`).toBe(one.encodingEqualAtEnd);
      expect(v.configDifference).toBe(one.configDifference);
      expect(v.garbledUnkeyedSlots).toBe(one.garbledUnkeyedSlots);
    }
  }, 60_000);

  it('hands the hooks A at exactly tick T, and B restored to T', () => {
    const seen: string[] = [];
    series({
      afterRestore: (b, a) => {
        seen.push(`restore a=${a.sim.tickCount} b=${b.sim.tickCount}`);
      },
      mutate: (b, a) => {
        seen.push(`mutate a=${a.sim.tickCount} b=${b.sim.tickCount}`);
      },
    });
    const cuts = [...Ts, 300];
    // Forks cut at the same T run in the order given, so the pairs interleave only per fork.
    expect(seen.length).toBe(cuts.length * 2);
    for (const T of cuts) {
      expect(seen).toContain(`restore a=${T} b=${T}`);
      expect(seen).toContain(`mutate a=${T} b=${T}`);
    }
   }, SERIES_TIMEOUT_MS);

  it('a mutation applied to one fork turns that fork red and no other', () => {
    const verdicts = series({
      mutate: (b) => {
        if (b.sim.tickCount === 500) (internals(b.sim).trail as Uint8Array).fill(0);
      },
    });
    const red = verdicts.filter((v) => v.hashDivergedAt !== null || !v.encodingEqualAtEnd).map((v) => `${v.T}/${v.horizon}`);
    // T=500 at horizon 200, and nothing else: the tail fork starts at 300.
    expect(red).toEqual(['500/200']);
   }, SERIES_TIMEOUT_MS);

  it('refuses a plan that does not fit: descending Ts, or a fork running past endTick', () => {
    const base = { build: RUN.build, drive: RUN.drive, horizon: 10, hashEvery: 5 };
    expect(() => forkWitnessSeries<World>({ ...base, Ts: [20, 10], endTick: 100 })).toThrow(/ascending/);
    expect(() => forkWitnessSeries<World>({ ...base, Ts: [95], endTick: 100 })).toThrow(/does not fit/);
    expect(() => forkWitnessSeries<World>({ ...base, Ts: [], tailFrom: 101, endTick: 100 })).toThrow(/does not fit/);
  });
});

// ---- the row census -------------------------------------------------------------------------

describe('stateRowsMoved: which rows differ from the base now', () => {
  it('reports posX, trail and the pool moved by tick 500, and smoke and elevation not', () => {
    const base = RUN.build();
    const w = RUN.build();
    for (let t = 0; t < 500; t++) {
      RUN.drive(w, t);
      w.sim.tick();
    }
    const moved = stateRowsMoved(base.sim, w.sim);
    for (const name of ['posX', 'trail', 'tickCount', 'rng', 'fieldByGoal', 'pendingEvents']) {
      expect(moved.has(name), `${name} moved`).toBe(true);
    }
    // The golden battle lays no smoke and has flat ground.
    for (const name of ['smoke', 'elevation', 'patrolLegIds']) expect(moved.has(name), `${name} unmoved`).toBe(false);
    expect(stateRowsMoved(base.sim, RUN.build().sim).size, 'two tick-0 worlds of one setup agree on every row').toBe(0);
  });

  it('is empty if and only if the two encodings are byte-equal', () => {
    const bytesEqual = (x: Uint8Array, y: Uint8Array): boolean => x.length === y.length && x.every((v, i) => v === y[i]);
    const at = (ticks: number): Sim => {
      const w = RUN.build();
      for (let t = 0; t < ticks; t++) {
        RUN.drive(w, t);
        w.sim.tick();
      }
      return w.sim;
    };
    const zero = at(0);
    const later = at(500);
    const differ = stateRowsMoved(zero, later);
    expect(differ.size, 'tick 0 and tick 500 differ in some row').toBeGreaterThan(0);
    expect(bytesEqual(encodeSim(zero), encodeSim(later)), 'and in the bytes').toBe(false);
    const same = stateRowsMoved(zero, at(0));
    expect(same.size, 'tick 0 against tick 0 moves no row').toBe(0);
    expect(bytesEqual(encodeSim(zero), encodeSim(at(0))), 'and the bytes are equal').toBe(true);
  });

  it('names each typed state row on its own: one element changed is one row moved and different bytes', () => {
    const base = RUN.build().sim;
    const baseBytes = encodeSim(base);
    let checked = 0;
    for (const row of rowsOf('state')) {
      if (row.kind.t !== 'typed') continue;
      const w = RUN.build().sim;
      const col = internals(w)[row.name] as Typed;
      if (col.length === 0) continue;
      col[0] = col[0] + 1;
      const moved = stateRowsMoved(base, w);
      expect(moved.has(row.name), `${row.name} reported moved`).toBe(true);
      // `blockedVehicleMask` is `blocked` itself on a map with no boulders: both names move together.
      expect(moved.size, `${row.name}: rows moved ${Array.from(moved).join(',')}`).toBe(col === (internals(w).blocked as Typed) || col === (internals(w).blockedVehicleMask as Typed) ? 2 : 1);
      expect(encodeSim(w).some((v, i) => v !== baseBytes[i]), `${row.name}: bytes differ`).toBe(true);
      checked++;
    }
    expect(checked, 'typed state rows exercised').toBeGreaterThan(100);
  });
});

// ---- the format pin -------------------------------------------------------------------------

describe('snapshot format pin', () => {
  it('the bytes of the 1000-tick world at tick 500 are pinned', () => {
    const w = RUN.build();
    for (let t = 0; t < 500; t++) {
      RUN.drive(w, t);
      w.sim.tick();
    }
    const bytes = encodeSim(w.sim);
    let h = HASH_SEED;
    for (let i = 0; i < bytes.length; i++) h = hashWord(h, bytes[i]);
    // Pin. `hashWord` folded over every byte of `encodeSim` (one byte per word), unsigned. The
    // bytes are canonical (one state, one string, any engine), so this is the same number on every
    // machine. It moves ONLY in a commit that changes the format or the set of `state` rows on
    // purpose (a row added, removed, reordered or reclassed in snapshot-schema.ts, or a layout
    // change in snapshot.ts), and that commit says "Was <n>." and why. It also moves when sim
    // behaviour changes the state at tick 500. That is not the same trigger as the golden hash:
    // the bytes cover unhashed `state` rows too (the pool keys, fieldLastIssued), so a change to
    // those moves this pin and leaves the golden hash alone, and the other way round.
    // Was 923693936. The header gained hasRuntime (u8) and the runtime schema digest (u32) in its fixed block
    // (snapshot S2): this world has no runtime, so the only change is five zero bytes at offsets 39-43. Cutting
    // exactly those five bytes out of the new bytes reproduces 923693936.
    // Was 3686246844 (main, S2's header) and 1168014221 (GH-421's appended separation rows): both together,
    // read off a fresh run. With the separation rows taken out of the table it reads 3686246844 again.
    // Was 2452666963. GH-859 P1a (combat formations) appended nine `state` columns (fmGroup, restFacing,
    // fmArrive and the six per-row fg* columns, FORMATION_ROWS 32) and the `fmLive` scalar to the table; they
    // are encoded even when empty, and this world orders no formation. With those rows taken out of
    // snapshot-schema.ts the same run reads 2452666963 again, so the move is exactly the new rows and nothing
    // else (the GH-421 method). 3512584427 is read off a fresh run.
    // Was 3512584427. GH-859 P1b (Task 2) appended fourteen `state` columns (ten per-row fg* and four per-unit
    // fm*: fgLegs fgRelease fgDress fgQuiet fgAtCp fgAway fgCalled fgPace fgCallX fgCallY fmLeg fmDuty fmHomeX
    // fmHomeY), encoded even when empty; this world orders no formation. With those fourteen rows cut from
    // snapshot-schema.ts the same run reads 3512584427 again, so the move is exactly the new rows. 128788725 is
    // read off a fresh run.
    expect(h >>> 0).toBe(128788725);
  });
});

// ---- the formation world (GH-859 P1a Task 4) -------------------------------------------------
//
// The 600-tick world that orders a Column, an Attack and an Ambush ring (golden-worlds.test-helper.ts,
// FORMATION_WORLD_PIN's replay), cut at the four moments the formation columns do something: while the
// ring is still walking, once every ring member has set its ambush stance and before the group has
// sprung, at the state after tick 444 (the group found by fire and MARKED, `fgPending` 1, the one column
// whose life crosses a tick boundary), and after it has sprung; and, since GH-859 P1b Task 3, in the middle
// of the march (the Column walking at the mortar's pace) and in the middle of a dress (a member waiting
// with the dress clock running). Measured on the scouting run below: the first ring member sets its
// stance at tick 196, the last at 344, and the group is marked at 445 (the side-1 riflemen find the ring
// by fire; it was 404 before the Column grew a slow member and the march began); the stances clear at the
// start of the following tick.
// Every formation column is `state` (none is `scratch`), so nothing here is poisoned that was not
// before; the proof is that each restored world agrees with the uninterrupted one at every hash tick
// of the next 200 and re-encodes to the same bytes.

interface FormationWorld extends World {
  readonly ids: ReturnType<typeof formationSetup>['ids'];
}
const FORMATION: Golden = {
  name: 'the formation world (600 ticks)',
  ticks: 600,
  build: () => formationSetup(FM_SEED),
  drive: (w, t) => formationDrive(w.sim, t, (w as FormationWorld).ids),
  poisonAt: [150, 350, 460],
  poisonsPool: false,
};

describe('fork witness: the formation world, mid-march, mid-dress, before the ring arrives, after it arrives, after it springs', () => {
  it('scouting: the ring arms at tick 344 and is found at 445 (mark set); 100 is mid-pace, 170 mid-dress', () => {
    const w = FORMATION.build() as FormationWorld;
    const it = internals(w.sim);
    const column = (w.ids.col as number[]).slice(0, 5);
    let firstArmed = -1;
    let allArmed = -1;
    let sprung = -1;
    let pendingAtCut = -1;
    let paceAtCut: number[] = [];
    let dressAtCut: number[] = [];
    for (let t = 0; t < FORMATION.ticks; t++) {
      FORMATION.drive(w, t);
      for (const e of w.sim.tick()) if (e.kind === 'formationSprung') sprung = w.sim.tickCount;
      if (firstArmed < 0 && w.ids.amb.some((i) => w.sim.ambushRadiusSqOf(i) > 0)) firstArmed = w.sim.tickCount;
      if (allArmed < 0 && w.ids.amb.every((i) => w.sim.ambushRadiusSqOf(i) > 0)) allArmed = w.sim.tickCount;
      // `fgPending` has a one-tick life across a tick boundary: set while the hit tick runs, consumed at
      // the top of the next one. The state after the 445th tick holds it set.
      if (w.sim.tickCount === 445) pendingAtCut = (it.fgPending as Uint8Array).reduce((a, b) => a + b, 0);
      // Mid-pace: the Column walks capped (fgPace 2293), every member still on its way to checkpoint 1.
      if (w.sim.tickCount === 100) paceAtCut = [(it.fgPace as Int32Array)[0], (it.fgLegs as Uint8Array)[0], ...column.map((i) => (it.moving as Uint8Array)[i])];
      // Mid-dress: one member waiting (duty 1) with the dress clock running; the mortar still on its way.
      if (w.sim.tickCount === 170) {
        dressAtCut = [(it.fgAtCp as Uint16Array)[0], (it.fgDress as Uint16Array)[0], column.filter((i) => (it.fmDuty as Uint8Array)[i] === 1).length];
      }
    }
    expect([firstArmed, allArmed, sprung]).toEqual([196, 344, 445]);
    expect(pendingAtCut, 'T = 445 cuts while a group is marked and not yet sprung').toBe(1);
    expect(paceAtCut, 'T = 100 cuts mid-march: capped at 2293 raw, two checkpoints, all five moving').toEqual([2293, 2, 1, 1, 1, 1, 1]);
    expect(dressAtCut, 'T = 170 cuts mid-dress: one waiting, dressing for 27 ticks').toEqual([1, 27, 1]);
  });

  for (const [label, T] of [
    ['mid-pace, the Column capped at the mortar\'s step', 100],
    ['mid-approach', 150],
    ['mid-dress, a member waiting and the dress clock running', 170],
    ['after arrival, before the spring', 350],
    ['found, mark set and not yet consumed (fgPending 1)', 445],
    ['after the spring', 460],
  ] as const) {
    it(`${label} (T = ${T}): every hash tick of the next 200 agrees, and so do the bytes`, () => {
      expectClean(fork(FORMATION, T), `${FORMATION.name} T=${T}`);
      expectClean(fork(FORMATION, T, { poison: true }), `${FORMATION.name} poisoned T=${T}`);
    }, 60_000);
  }

  it('every T = 0, 50, ... 400', () => {
    let forks = 0;
    for (let T = 0; T <= 400; T += 50) {
      expectClean(fork(FORMATION, T), `${FORMATION.name} T=${T}`);
      forks++;
    }
    expect(forks).toBe(9);
  }, 60_000);

  // Self-checks: the witness must go red when a formation column is lost across the restore.
  it('a member lost from its group after the restore turns the fork red (T = 350)', () => {
    const v = fork(FORMATION, 350, {
      mutate: (b) => {
        const ring = (b as FormationWorld).ids.amb[0];
        (internals(b.sim).fmGroup as Int16Array)[ring] = -1;
      },
    });
    expect(fails(v)).toBe(true);
    expect(v.hashDivergedAt, 'the formation block is in the hash').not.toBeNull();
  });

  it('the one-tick mark lost after the restore turns the fork red (T = 445, fgPending 1)', () => {
    const v = fork(FORMATION, 445, {
      mutate: (b) => {
        (internals(b.sim).fgPending as Uint8Array).fill(0);
      },
    });
    expect(fails(v)).toBe(true);
  });

  // GH-859 P1b Task 3: one self-check per column the new cuts assert (the cut must see the column, else it is re-picked).
  for (const [label, T, column, set] of [
    ['the pace cap', 100, 'fgPace', 0],
    ['the checkpoint count', 100, 'fgLegs', 0],
    ['a member\'s leg', 100, 'fmLeg', 0],
    ['the dress clock', 170, 'fgDress', 0],
    ['the waiting count', 170, 'fgAtCp', 0],
    ['a member\'s waiting duty', 170, 'fmDuty', 0],
  ] as const) {
    it(`${label} lost after the restore turns the fork red (T = ${T}, ${column} zeroed)`, () => {
      const v = fork(FORMATION, T, {
        mutate: (b) => {
          const col = internals(b.sim)[column] as Uint8Array | Uint16Array | Int32Array;
          expect(col.some((x) => x !== 0), `${column} is non-zero at T = ${T}`).toBe(true);
          col.fill(set);
        },
      });
      expect(fails(v)).toBe(true);
    });
  }

  it('the group sprung early in B turns the fork red (T = 350)', () => {
    const v = fork(FORMATION, 350, {
      mutate: (b) => {
        (internals(b.sim).fgState as Uint8Array)[2] = 4;
      },
    });
    expect(fails(v)).toBe(true);
  });
});
