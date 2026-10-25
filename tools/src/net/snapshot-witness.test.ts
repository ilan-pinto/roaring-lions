import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_COVERAGE_EXEMPT,
  censusFailures,
  censusRowNames,
  censusVerdict,
  goldenEconomy,
  economyWorld,
  goldenBattle,
  goldenPlan,
  goldenWounded,
  mirrorWorld,
  problemsOf,
  queuedBoundaries,
  withQueuedCut,
  carryWorld,
  rebindOf,
  runSelfCheck,
  runWorld,
  selfChecks,
  type Plan,
  type SnapWorld,
  type SelfCheck,
  type WorldSpec,
} from './snapshot-witness';
import { carriedDiff, carryOnto, columnsReachableFrom } from './snapshot-driver-carry';
import { internals } from '../../../packages/sim/src/snapshot';
import { SIM_SNAPSHOT_SCHEMA } from '../../../packages/sim/src/snapshot-schema';
import { censusAt, checkRuntime, collectAliases, explainAliases, newCensus, props } from '../../../packages/sim/src/runtime-snapshot-schema.test-helper';

// The slice of the full witness (snapshot-witness.ts, `pnpm snapshot:witness`) that runs inside
// `pnpm test`: one mirror and one economy world at a few cuts, the census logic, the carry, and
// the three self-checks at short horizons. The full matrix is minutes of sim; this is seconds.

const SHORT: Plan = { Ts: [200, 500], horizon: 200, tailFrom: 100, end: 800 };
const mirror: WorldSpec = { id: 'mirror tel_marum 1000', plan: SHORT, build: () => mirrorWorld('tel_marum', 1000) };
const economy: WorldSpec = { id: 'economy tel_marum kdf/sarim 1000', plan: SHORT, build: () => economyWorld('tel_marum', ['kdf', 'sarim'], 1000) };
const wounded: WorldSpec = { id: 'golden wounded', plan: { Ts: [97, 200], horizon: 200, tailFrom: 100, end: 600 }, build: goldenWounded };

describe('the witness over real worlds (short plan)', () => {
  it('a versus mirror room forks clean at three cuts', () => {
    const run = runWorld(mirror);
    expect(run.problems).toEqual([]);
    expect(run.forks).toBe(3);
  }, 60_000);

  it('an economy room forks clean with its runtime restored natively (nothing carried), and the runtime encodings were compared', () => {
    const run = runWorld(economy);
    expect(run.problems).toEqual([]);
    expect(run.forks, 'three planned cuts and the queued-command cut').toBe(4);
    // The runtime rides the sim witness's native path: it is an anchor of the world, never something the driver carry moves.
    const w = economy.build();
    expect(w.runtime, 'the world has a runtime').not.toBeNull();
    expect(w.carried, 'an economy room with no stateful driver carries nothing').toEqual([]);
    expect(w.anchors, 'and the runtime is rebound, not copied').toContain(w.runtime);
    expect(run.moved.has('runtime.purse'), 'the census read the runtime\'s rows').toBe(true);
  }, 60_000);

  it('no world hands its runtime to the driver carry, and a stateful driver is still carried', () => {
    const golden = goldenEconomy();
    expect(golden.runtime).not.toBeNull();
    expect(golden.carried, 'the golden economy carries its run record and driver fields, not the runtime').toHaveLength(2);
    expect(golden.carried).not.toContain(golden.runtime);
    expect(golden.anchors).toContain(golden.runtime);
    const tunnels = economyWorld('tel_marum', ['kdf', 'sarim'], 1000, 'answer');
    expect(tunnels.carried, 'the tunnel plan is the only thing carried').toHaveLength(1);
    expect(tunnels.carried).not.toContain(tunnels.runtime);
  }, 60_000);
});

describe('the schema covers the sim of a real match world, both ways', () => {
  // snapshot-schema.test.ts reflects over the sim-package worlds only: buildMatchWorld lives in
  // packages/app, which the sim may not import, so the match worlds are checked here.
  const named = new Set(SIM_SNAPSHOT_SCHEMA.map((r) => r.name));
  const complaints = (sim: object): string[] => {
    const own = Object.keys(sim);
    return [
      ...own.filter((k) => !named.has(k)).map((k) => `property "${k}" has no row`),
      ...[...named].filter((n) => !own.includes(n)).map((n) => `row "${n}" names no property`),
    ];
  };
  const worlds: [string, () => SnapWorld][] = [
    ['mirror room', () => mirrorWorld('tel_marum', 1000)],
    ['economy room', () => economyWorld('tel_marum', ['kdf', 'sarim'], 1000)],
  ];
  for (const [label, build] of worlds) {
    it(`${label}: no unlisted property and no row naming a missing one, at tick 0 and after 300 ticks`, () => {
      const w = build();
      expect(complaints(w.sim), `${label} @0`).toEqual([]);
      for (let t = 0; t < 300; t++) {
        w.driveAt(t);
        w.advanceOnce();
      }
      expect(complaints(w.sim), `${label} @300`).toEqual([]);
    });
  }

  it('the check can fail: a throwaway property, and a missing one, are both named', () => {
    const w = mirrorWorld('tel_marum', 1000);
    (w.sim as unknown as Record<string, unknown>).zzThrowaway = 1;
    expect(complaints(w.sim)).toEqual(['property "zzThrowaway" has no row']);
    delete (w.sim as unknown as Record<string, unknown>).zzThrowaway;
    delete (w.sim as unknown as Record<string, unknown>).fieldRef;
    expect(complaints(w.sim)).toEqual(['row "fieldRef" names no property']);
  });
});

describe('the runtime schema covers the runtime of a real economy room, both ways', () => {
  // runtime-snapshot-schema.test.ts reflects over the sim-package runtimes only: buildMatchWorld lives
  // in packages/app, which the sim may not import, so the versus room's runtime is checked here, with
  // the same reflection (`runtime-snapshot-schema.test-helper.ts`): every own property of the runtime
  // and of every record it owns has a row, every row names a property, the order is creation order, and
  // each live value has the shape its row's kind promises, references by identity included.
  const CHECKED = [0, 1, 100, 200, 300, 450, 600, 800];
  const runtimeOf = (w: SnapWorld): NonNullable<SnapWorld['runtime']> => {
    if (w.runtime === null) throw new Error('an economy room built no runtime');
    return w.runtime;
  };

  it('a KDF-v-Sarim room on tel_marum: no unlisted property, no row naming a missing one, at eight ticks of play', () => {
    const w = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const rt = runtimeOf(w);
    const seen = new Set<string>();
    const checked: number[] = [];
    for (let t = 0; t <= 800; t++) {
      if (CHECKED.includes(t)) {
        void rt.incomePerMin;
        expect(checkRuntime(`room@${t}`, rt, w.sim, seen), `room@${t}`).toEqual([]);
        checked.push(t);
      }
      if (t === 800) break;
      w.driveAt(t);
      w.advanceOnce();
    }
    expect(checked).toEqual(CHECKED);
    // The room's runtime really is the economy one: two sides' lines, held ground, and a populated purse row.
    expect(seen.has('MissionRuntime.lines')).toBe(true);
    expect(seen.has('ProductionLine.queue') || seen.has('ProductionLine.current')).toBe(true);
    expect(seen.has('ZoneIncomeState.state')).toBe(true);
  }, 120_000);

  it('the aliasing census on the room: every object its runtime reaches twice has a reference rule, and the closure probe holds', () => {
    // Task 2: the reference rules (`RUNTIME_REF_RULES`) are proved against the sim-package worlds in
    // runtime-snapshot-schema.test.ts, where every rule is also required to be USED. A match world is built
    // in packages/app, so this runs the same walk on a KDF-v-Sarim room: nothing unruled, at eight moments.
    const w = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const rt = runtimeOf(w);
    const acc = newCensus();
    let moments = 0;
    for (let t = 0; t <= 800; t++) {
      if (CHECKED.includes(t)) {
        void rt.incomePerMin;
        censusAt(`room@${t}`, rt, w.sim, acc, moments === 0);
        moments++;
      }
      if (t === 800) break;
      w.driveAt(t);
      w.advanceOnce();
    }
    expect(moments).toBe(CHECKED.length);
    expect(acc.failures).toEqual([]);
    // It found aliases to rule (a census that finds nothing would pass anything), among them a held-zone route.
    expect(acc.seen.size).toBeGreaterThan(10);
    expect(acc.used.has('ZoneIncomeState.route -> MissionRuntime.zoneRoutes')).toBe(true);
    expect(acc.used.has('RouteSource.fieldFor -> MissionRuntime.corridorFields')).toBe(true);
  }, 120_000);

  it('the census can fail on the room: an unruled alias between two state rows is named', () => {
    const w = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const rt = runtimeOf(w);
    expect(explainAliases(collectAliases(rt, w.sim)).unruled).toEqual([]);
    props(rt).seenBlocked = props(rt).seenVehicle;
    const found = explainAliases(collectAliases(rt, w.sim)).unruled;
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('MissionRuntime.seenBlocked');
    expect(found[0]).toContain('MissionRuntime.seenVehicle');
  });

  it('the check can fail on the room: a throwaway property and a deleted one are both named', () => {
    const w = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const rt = runtimeOf(w);
    expect(checkRuntime('room', rt, w.sim, new Set())).toEqual([]);
    props(rt).zzThrowaway = 1;
    expect(checkRuntime('room', rt, w.sim, new Set())).toEqual(['room: property "zzThrowaway" has no row']);
    delete props(rt).zzThrowaway;
    delete props(rt).fromTile;
    expect(checkRuntime('room', rt, w.sim, new Set())).toContain('room: row "fromTile" names no property');
  });
});

describe('what a verdict must satisfy to be clean', () => {
  const verdict = (over: Record<string, unknown>) =>
    ({ T: 100, horizon: 200, roundTripEqualAtT: true, configDifference: null, hashDivergedAt: null, encodingEqualAtEnd: true, garbledUnkeyedSlots: 0, b: { carried: [] }, ...over }) as unknown as Parameters<typeof problemsOf>[0];

  it('a restored world that does not re-encode to its own bytes is a problem, on its own', () => {
    expect(problemsOf(verdict({}))).toEqual([]);
    expect(problemsOf(verdict({ roundTripEqualAtT: false }))).toEqual(['T=100+200: the restored world does not re-encode to its own bytes']);
  });
});

describe('cuts with a command queued (the queues are snapshot state)', () => {
  it('an economy run cuts at a boundary with a queued command, clean, and not when the queued cut is withheld', () => {
    const run = runWorld(economy);
    expect(run.problems).toEqual([]);
    expect(run.queuedCuts.command, 'a fork was cut with a non-empty commandQueue').toBeGreaterThan(0);
    expect(runWorld(economy, { queuedCut: false }).queuedCuts.command).toBe(0);
  }, 60_000);

  it('withQueuedCut adds one cut, in order, off the tail and off the other cuts; none when nothing fits', () => {
    const plan: Plan = { Ts: [200, 500], horizon: 200, tailFrom: 100, end: 800 };
    expect(withQueuedCut(plan, [100, 200, 320, 400]).Ts).toEqual([200, 320, 500]);
    expect(withQueuedCut(plan, [700]).Ts, '700 + 200 runs past the end').toEqual([200, 500]);
    expect(queuedBoundaries(economy, 800).command).toContain(320);
  });
});

describe('the runtime comparison at a fork end', () => {
  it('sees a runtime field the hash does not fold (promotedValue), by the runtime codec\'s encoding alone', () => {
    const run = runWorld(economy, {
      mutate: (b) => {
        (b.runtime as unknown as { promotedValue: number }).promotedValue = 99;
      },
    });
    expect(run.problems.length).toBeGreaterThan(0);
    // The reflection diff that used to read the runtime is gone (snapshot S2 Task 5): the encodings are the only reader,
    // and they name the row. Nothing else is wrong, and no driver comparison is involved (this world has no driver).
    expect(run.problems.every((p) => p.includes('the encodings differ at the end (runtime.promotedValue)')), run.problems.join('; ')).toBe(true);
  }, 60_000);
});

describe('the match hash folds the runtime digest', () => {
  it('a purse the digest folds turns the HASH red, at the first hash tick', () => {
    const run = runWorld(economy, {
      mutate: (b) => {
        (b.runtime as unknown as { purse: number[] }).purse[0] += 2400 * 5; // five whole logistics: the digest folds whole units
      },
    });
    expect(run.problems.some((p) => p.includes('the hash diverged at tick')), run.problems.join('; ')).toBe(true);
  }, 60_000);
});

describe('the driver carry never writes a sim or runtime column', () => {
  /** An economy world whose driver (here a bare record) holds an alias of a sim column, and optionally of a runtime column. */
  const withDriver = (runtimeAlias: boolean): SnapWorld => {
    const w = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const driver: Record<string, unknown> = { simPos: w.sim.state.posX, plain: new Int32Array(4), n: 0 };
    if (runtimeAlias) driver.rtPurse = (w.runtime as unknown as { purse: Int32Array }).purse;
    return { ...w, carried: [driver] };
  };
  const play = (w: SnapWorld, ticks: number): void => {
    for (let t = 0; t < ticks; t++) {
      w.driveAt(t);
      w.advanceOnce();
    }
  };

  it('a driver\'s alias of a sim column resolves to B\'s own column, which keeps B\'s junk; ordinary driver data crosses', () => {
    const a = withDriver(false);
    play(a, 400);
    const aDriver = a.carried[0] as { plain: Int32Array; n: number };
    aDriver.n = 7;
    aDriver.plain.fill(5);
    const b = withDriver(false);
    const bDriver = b.carried[0] as { simPos: Int32Array; plain: Int32Array; n: number };
    // Stand-in for a restore that skipped the row: B's column is junk, written in place as the restore writes it.
    b.sim.state.posX.fill(12345);
    carryWorld(b, a);
    expect(b.sim.state.posX.every((v) => v === 12345), 'posX repaired by the carry').toBe(true);
    expect(a.sim.state.posX.some((v) => v !== 12345)).toBe(true);
    expect(bDriver.simPos, 'the alias is still B\'s own column').toBe(b.sim.state.posX);
    expect(bDriver.n, 'the ordinary driver data did cross').toBe(7);
    expect(Array.from(bDriver.plain)).toEqual([5, 5, 5, 5]);
  }, 60_000);

  it('a driver that holds an alias of a RUNTIME column makes the carry throw before it writes', () => {
    const a = withDriver(true);
    play(a, 400);
    const b = withDriver(true);
    const bPurse = (b.runtime as unknown as { purse: Int32Array }).purse;
    bPurse.fill(777); // junk the restore is judged on
    expect(() => carryWorld(b, a)).toThrow(/a driver holds an alias of a sim or runtime column/);
    expect(bPurse.every((v) => v === 777), 'nothing was written into B\'s runtime column').toBe(true);
  }, 60_000);

  it('columnsReachableFrom finds the runtime\'s own columns and the sim\'s, and no plain array', () => {
    const w = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const cols = columnsReachableFrom(w.runtime as object);
    expect(cols.has((w.runtime as unknown as { purse: object }).purse)).toBe(true);
    expect(cols.has(w.sim.state.posX)).toBe(true);
    expect(cols.has(new Int32Array(1))).toBe(false);
    expect([...cols].every((c) => ArrayBuffer.isView(c))).toBe(true);
  }, 60_000);

  it('carriedDiff calls a view that aliases A\'s column a wrong-world reference, and a key only B has a difference', () => {
    const colA = new Int32Array([1, 2]);
    const colB = new Int32Array([1, 2]);
    const rebind = new Map<object, object>([[colA, colB]]);
    expect(carriedDiff({ view: colA }, { view: colB }, 'r', rebind)).toBeNull();
    expect(carriedDiff({ view: colA }, { view: colA }, 'r', rebind)).toBe('r.view (a reference to the wrong world)');
    expect(carriedDiff({ x: 1 }, { x: 1, extra: 2 }, 'r', new Map())).toBe('r.extra (only on B)');
  });

  it('rebindOf maps the sim columns, the state views, the rng words and the runtime', () => {
    const a = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const b = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const rebind = rebindOf(b, a);
    expect(rebind.get(a.sim.state.posX)).toBe(b.sim.state.posX);
    expect(rebind.get((internals(a.sim).rng as { state: Uint32Array }).state)).toBe((internals(b.sim).rng as { state: Uint32Array }).state);
    expect(rebind.get(internals(a.sim).tnVentOpen as object)).toBe(internals(b.sim).tnVentOpen);
    expect(rebind.get(a.runtime as object), 'a reference to the runtime becomes B\'s own').toBe(b.runtime);
  }, 60_000);
});

describe('the driver carry', () => {
  class Box {
    n = 1;
    get derived(): number {
      return this.n * 2;
    }
  }

  it('copies typed arrays in place, Maps held in arrays, class instances, and a key called state', () => {
    const view = new Uint8Array(4);
    const mk = (fill: number) => ({
      sim: { id: 'sim' },
      state: new Uint32Array([fill, fill]),
      view,
      list: [new Map([[1, { a: fill }]])],
      set: new Set([fill]),
      box: Object.assign(new Box(), { n: fill }),
      fn: () => fill,
    });
    const src = mk(7);
    const dst = mk(0);
    const srcSim = src.sim;
    const dstSim = dst.sim;
    const stateBefore = dst.state;
    carryOnto(dst, src, new Map([[srcSim, dstSim]]));
    expect(Array.from(dst.state)).toEqual([7, 7]);
    expect(dst.state, 'typed array set in place').toBe(stateBefore);
    expect(dst.list[0].get(1)).toEqual({ a: 7 });
    expect(dst.list[0], 'the Map in the array is a Map').toBeInstanceOf(Map);
    expect(Array.from(dst.set)).toEqual([7]);
    expect(dst.box.n).toBe(7);
    expect(dst.box.derived, 'an accessor reads through its own object').toBe(14);
    expect(dst.sim, 'a rebound reference stays the destination\'s own').toBe(dstSim);
    expect(dst.fn(), 'a closure stays the destination\'s').toBe(0);
    expect(carriedDiff(src, dst, 'x', new Map([[srcSim, dstSim]]))).toBeNull();
  });

  it('carriedDiff names a difference in a Map, a Set, a typed array and a wrong-world reference', () => {
    const rebind = new Map<object, object>();
    expect(carriedDiff({ m: new Map([[1, 2]]) }, { m: new Map([[1, 3]]) }, 'r', rebind)).toBe('r.m.get(1)');
    expect(carriedDiff({ s: new Set([1, 2]) }, { s: new Set([2, 1]) }, 'r', rebind), 'iteration order counts').toMatch(/^r\.s\.member/);
    expect(carriedDiff({ t: new Int32Array([1, 2]) }, { t: new Int32Array([1, 9]) }, 'r', rebind)).toBe('r.t[1]');
    const sa = {};
    const sb = {};
    expect(carriedDiff({ sim: sa }, { sim: sa }, 'r', new Map([[sa, sb]]))).toBe('r.sim (a reference to the wrong world)');
    // The root is in the table too (a reference back to it must resolve), and is still compared by content.
    const ra = { n: 1 };
    const rb = { n: 2 };
    expect(carriedDiff(ra, rb, 'r', new Map<object, object>([[ra, rb]]))).toBe('r.n');
    const ca: { n: number; self?: object } = { n: 1 };
    const cb: { n: number; self?: object } = { n: 1 };
    ca.self = ca;
    cb.self = cb;
    expect(carriedDiff(ca, cb, 'r', new Map<object, object>([[ca, cb]]))).toBeNull();
  });
});

describe('the coverage census', () => {
  it('names a row that never moved, accepts an exemption for it, and refuses a stale or bad one', () => {
    // The wounded world lays no smoke: `smoke` is a row it never moves.
    const woundedRun = runWorld(wounded);
    expect(woundedRun.problems, 'the wounded world forks clean (its lazily resolved wound type is settled on B)').toEqual([]);
    const moved = woundedRun.moved;
    expect(moved.has('posX'), 'the world moves ordinary rows').toBe(true);
    expect(moved.has('smoke'), 'and leaves smoke alone').toBe(false);

    const none = censusVerdict(moved, []);
    expect(none.uncovered).toContain('smoke');
    expect(censusFailures(none).some((f) => f.includes('smoke never moved'))).toBe(true);

    const exemptAll = none.uncovered.map((name) => ({ name, reason: 'test' }));
    expect(censusFailures(censusVerdict(moved, exemptAll))).toEqual([]);

    const dropOne = exemptAll.filter((e) => e.name !== 'smoke');
    expect(censusFailures(censusVerdict(moved, dropOne))).toEqual(['census: smoke never moved in any witness world; cover it or exempt it with a reason']);

    const stale = censusVerdict(moved, [...exemptAll, { name: 'posX', reason: 'test' }]);
    expect(censusFailures(stale)).toEqual(['census: posX is exempt but DID move; delete this exemption']);

    const bad = censusVerdict(moved, [
      { name: 'noSuchRow', reason: 'test' },
      { name: 'smoke', reason: 'once' },
      { name: 'smoke', reason: 'twice' },
      { name: 'airWant', reason: ' ' },
    ]);
    expect(bad.badExemptions).toEqual(['noSuchRow (not a state row of the sim or the runtime)', 'smoke (listed twice)', 'airWant (no reason)']);
  }, 60_000);

  it('every shipped exemption has a reason and names a state row', () => {
    const v = censusVerdict(new Set(), SNAPSHOT_COVERAGE_EXEMPT);
    expect(v.badExemptions).toEqual([]);
    expect(SNAPSHOT_COVERAGE_EXEMPT.every((e) => e.reason.includes('Covered'))).toBe(true);
  });

  it('the census reads the runtime\'s top-level state rows too, as runtime.<row>', () => {
    const names = censusRowNames();
    expect(names.runtime.length, 'the runtime has state rows').toBeGreaterThan(50);
    expect(names.runtime.every((n) => n.startsWith('runtime.'))).toBe(true);
    expect(names.runtime).toContain('runtime.purse');
    expect(names.sim).not.toContain('runtime.purse');
    const v = censusVerdict(new Set(), []);
    expect(v.runtimeStateRows).toBe(names.runtime.length);
    expect(v.stateRows).toBe(names.sim.length + names.runtime.length);
    // A runtime row nobody moved is named, exempting it clears it, and an exemption for a row that DID move is stale.
    expect(v.uncovered).toContain('runtime.purse');
    expect(censusFailures(v)).toContain('census: runtime.purse never moved in any witness world; cover it or exempt it with a reason');
    const all = v.uncovered.map((name) => ({ name, reason: 'Covered by a test world' }));
    expect(censusFailures(censusVerdict(new Set(), all))).toEqual([]);
    expect(censusFailures(censusVerdict(new Set(), all.filter((e) => e.name !== 'runtime.purse')))).toEqual([
      'census: runtime.purse never moved in any witness world; cover it or exempt it with a reason',
    ]);
    expect(censusFailures(censusVerdict(new Set(['runtime.purse']), all))).toEqual(['census: runtime.purse is exempt but DID move; delete this exemption']);
    expect(censusVerdict(new Set(), [{ name: 'runtime.noSuchRow', reason: 'Covered' }]).badExemptions).toEqual(['runtime.noSuchRow (not a state row of the sim or the runtime)']);
  });

  it('a runtime world moves runtime rows in the census, and none of them is a shipped exemption', () => {
    const run = runWorld(economy);
    expect(run.problems).toEqual([]);
    const runtimeMoved = [...run.moved].filter((n) => n.startsWith('runtime.'));
    expect(runtimeMoved.length, 'a short economy run moves many runtime rows').toBeGreaterThan(10);
    for (const n of ['runtime.purse', 'runtime.lines', 'runtime.incomeZoneList']) expect(run.moved.has(n), n).toBe(true);
    expect(censusVerdict(run.moved).staleExemptions.filter((n) => n.startsWith('runtime.')), 'no shipped runtime exemption names a row this run moved').toEqual([]);
    // An exemption for a row this very run moved is stale, whatever the full matrix says about it.
    expect(censusVerdict(run.moved, [{ name: 'runtime.purse', reason: 'Covered' }]).staleExemptions).toEqual(['runtime.purse']);
  }, 60_000);
});

describe('the self-checks: each mutation must turn its world red, its clean control green', () => {
  const short = (check: SelfCheck, plan: Plan): SelfCheck => ({ ...check, plan });
  const [producesFor, fieldByGoal, trail, queue] = selfChecks();

  it('stProducesFor reset, economy cell', () => {
    const r = runSelfCheck(short(producesFor, { Ts: [97], horizon: 200, tailFrom: 300, end: 600 }));
    expect(r.cleanProblems).toEqual([]);
    expect(r.effectiveCuts.length).toBeGreaterThan(0);
    expect(r.missed).toEqual([]);
    expect(r.ok).toBe(true);
  }, 60_000);

  it('fieldByGoal emptied, mirror cell', () => {
    const r = runSelfCheck(short(fieldByGoal, { Ts: [97], horizon: 200, tailFrom: 300, end: 600 }));
    expect(r.cleanProblems).toEqual([]);
    expect(r.effectiveCuts.length).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
  }, 60_000);

  it('trail zeroed, golden battle', () => {
    const r = runSelfCheck(short(trail, { Ts: [200], horizon: 100, tailFrom: 100, end: 400 }));
    expect(r.cleanProblems).toEqual([]);
    expect(r.effectiveCuts.length).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
  }, 60_000);

  it('one production line\'s queue emptied, economy cell (the runtime\'s own restore)', () => {
    expect(queue.name).toMatch(/queue emptied/);
    const r = runSelfCheck(short(queue, { Ts: [97], horizon: 200, tailFrom: 300, end: 600 }));
    expect(r.cleanProblems).toEqual([]);
    expect(r.effectiveCuts, 'a queue was there to empty at the planned cut').toContain(97);
    expect(r.missed).toEqual([]);
    expect(r.ok).toBe(true);
  }, 60_000);

  it('a mutation that changes nothing is reported as a miss, not as a pass', () => {
    const idle: SelfCheck = { ...fieldByGoal, plan: { Ts: [97], horizon: 200, tailFrom: 300, end: 600 }, mutation: (effective) => (b) => void effective.add(b.sim.tickCount) };
    const r = runSelfCheck(idle);
    expect(r.missed.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  }, 60_000);

  it('a mutation that is never effective fails the self-check (it tested nothing)', () => {
    const r = runSelfCheck({ ...fieldByGoal, plan: { Ts: [97], horizon: 200, tailFrom: 300, end: 600 }, mutation: () => () => undefined });
    expect(r.effectiveCuts).toEqual([]);
    expect(r.ok).toBe(false);
  }, 60_000);
});

describe('the plans', () => {
  it('goldenPlan never cuts at its own tail and fits every fork inside the end', () => {
    for (const end of [600, 900, 1000, 2400]) {
      const p = goldenPlan(end);
      expect(p.Ts).not.toContain(p.tailFrom);
      expect(Math.max(...p.Ts) + p.horizon).toBeLessThanOrEqual(end);
      expect(p.Ts).toEqual([...p.Ts].sort((a, b) => a - b));
    }
    expect(goldenBattle().sim.tickCount).toBe(0);
  }, 60_000);
});
