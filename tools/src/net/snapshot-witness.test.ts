import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_COVERAGE_EXEMPT,
  censusFailures,
  censusVerdict,
  economyWorld,
  goldenBattle,
  goldenPlan,
  goldenWounded,
  mirrorWorld,
  queuedBoundaries,
  withQueuedCut,
  carryWorld,
  rebindOf,
  runSelfCheck,
  runWorld,
  selfChecks,
  type Plan,
  type SelfCheck,
  type WorldSpec,
} from './snapshot-witness';
import { carriedDiff, carryOnto } from './snapshot-runtime-carry';
import { internals } from '../../../packages/sim/src/snapshot';

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
  });

  it('an economy room forks clean with its runtime carried, and the runtime comparison ran', () => {
    const run = runWorld(economy);
    expect(run.problems).toEqual([]);
    expect(run.forks, 'three planned cuts and the queued-command cut').toBe(4);
  });
});

describe('cuts with a command queued (the queues are snapshot state)', () => {
  it('an economy run cuts at a boundary with a queued command, clean, and not when the queued cut is withheld', () => {
    const run = runWorld(economy);
    expect(run.problems).toEqual([]);
    expect(run.queuedCuts.command, 'a fork was cut with a non-empty commandQueue').toBeGreaterThan(0);
    expect(runWorld(economy, { queuedCut: false }).queuedCuts.command).toBe(0);
  });

  it('withQueuedCut adds one cut, in order, off the tail and off the other cuts; none when nothing fits', () => {
    const plan: Plan = { Ts: [200, 500], horizon: 200, tailFrom: 100, end: 800 };
    expect(withQueuedCut(plan, [100, 200, 320, 400]).Ts).toEqual([200, 320, 500]);
    expect(withQueuedCut(plan, [700]).Ts, '700 + 200 runs past the end').toEqual([200, 500]);
    expect(queuedBoundaries(economy, 800).command).toContain(320);
  });
});

describe('the runtime comparison at a fork end', () => {
  it('sees a runtime field the hash does not fold (promotedValue) that the sim encoding cannot see', () => {
    const run = runWorld(economy, {
      mutate: (b) => {
        (b.runtime as unknown as { promotedValue: number }).promotedValue = 99;
      },
    });
    expect(run.problems.length).toBeGreaterThan(0);
    expect(run.problems.every((p) => p.includes('the runtime data differs at the end (carried[0].promotedValue)')), run.problems.join('; ')).toBe(true);
  });
});

describe('the match hash folds the runtime digest', () => {
  it('a purse the digest folds turns the HASH red, at the first hash tick', () => {
    const run = runWorld(economy, {
      mutate: (b) => {
        (b.runtime as unknown as { purse: number[] }).purse[0] += 2400 * 5; // five whole logistics: the digest folds whole units
      },
    });
    expect(run.problems.some((p) => p.includes('the hash diverged at tick')), run.problems.join('; ')).toBe(true);
  });
});

describe('the carry never writes a sim column (the runtime\'s holdView aliases them)', () => {
  it('B\'s garbled posX, alive and tnVentOpen are still garbled after carryWorld, and the views resolve to B\'s columns', () => {
    const a = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    for (let t = 0; t < 400; t++) {
      a.driveAt(t);
      a.advanceOnce();
    }
    const b = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    // Stand-in for a restore that skipped these rows: B's columns are junk, written in place as the restore writes them.
    b.sim.state.posX.fill(12345);
    b.sim.state.alive.fill(0);
    const vent = internals(b.sim).tnVentOpen as Uint8Array;
    vent.fill(7);
    carryWorld(b, a);
    expect(b.sim.state.posX.every((v) => v === 12345), 'posX repaired by the carry').toBe(true);
    expect(b.sim.state.alive.every((v) => v === 0), 'alive repaired by the carry').toBe(true);
    expect(vent.every((v) => v === 7), 'tnVentOpen repaired by the carry').toBe(true);
    const hold = (b.runtime as unknown as { holdView: { posX: unknown; alive: unknown } }).holdView;
    expect(hold.posX, 'the view is still B\'s own column').toBe(b.sim.state.posX);
    expect(a.sim.state.posX.some((v) => v !== 12345)).toBe(true);
  });

  it('carriedDiff calls a view that aliases A\'s column a wrong-world reference, and a key only B has a difference', () => {
    const colA = new Int32Array([1, 2]);
    const colB = new Int32Array([1, 2]);
    const rebind = new Map<object, object>([[colA, colB]]);
    expect(carriedDiff({ view: colA }, { view: colB }, 'r', rebind)).toBeNull();
    expect(carriedDiff({ view: colA }, { view: colA }, 'r', rebind)).toBe('r.view (a reference to the wrong world)');
    expect(carriedDiff({ x: 1 }, { x: 1, extra: 2 }, 'r', new Map())).toBe('r.extra (only on B)');
  });

  it('rebindOf maps the sim columns, the state views and the rng words', () => {
    const a = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const b = economyWorld('tel_marum', ['kdf', 'sarim'], 1000);
    const rebind = rebindOf(b, a);
    expect(rebind.get(a.sim.state.posX)).toBe(b.sim.state.posX);
    expect(rebind.get((internals(a.sim).rng as { state: Uint32Array }).state)).toBe((internals(b.sim).rng as { state: Uint32Array }).state);
    expect(rebind.get(internals(a.sim).tnVentOpen as object)).toBe(internals(b.sim).tnVentOpen);
  });
});

describe('the runtime carry', () => {
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
    expect(bad.badExemptions).toEqual(['noSuchRow (not a state row)', 'smoke (listed twice)', 'airWant (no reason)']);
  });

  it('every shipped exemption has a reason and names a state row', () => {
    const v = censusVerdict(new Set(), SNAPSHOT_COVERAGE_EXEMPT);
    expect(v.badExemptions).toEqual([]);
    expect(SNAPSHOT_COVERAGE_EXEMPT.every((e) => e.reason.includes('Covered'))).toBe(true);
  });
});

describe('the self-checks: each mutation must turn its world red, its clean control green', () => {
  const short = (check: SelfCheck, plan: Plan): SelfCheck => ({ ...check, plan });
  const [producesFor, fieldByGoal, trail] = selfChecks();

  it('stProducesFor reset, economy cell', () => {
    const r = runSelfCheck(short(producesFor, { Ts: [97], horizon: 200, tailFrom: 300, end: 600 }));
    expect(r.cleanProblems).toEqual([]);
    expect(r.effectiveCuts.length).toBeGreaterThan(0);
    expect(r.missed).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('fieldByGoal emptied, mirror cell', () => {
    const r = runSelfCheck(short(fieldByGoal, { Ts: [97], horizon: 200, tailFrom: 300, end: 600 }));
    expect(r.cleanProblems).toEqual([]);
    expect(r.effectiveCuts.length).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
  });

  it('trail zeroed, golden battle', () => {
    const r = runSelfCheck(short(trail, { Ts: [200], horizon: 100, tailFrom: 100, end: 400 }));
    expect(r.cleanProblems).toEqual([]);
    expect(r.effectiveCuts.length).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
  });

  it('a mutation that changes nothing is reported as a miss, not as a pass', () => {
    const idle: SelfCheck = { ...fieldByGoal, plan: { Ts: [97], horizon: 200, tailFrom: 300, end: 600 }, mutation: (effective) => (b) => void effective.add(b.sim.tickCount) };
    const r = runSelfCheck(idle);
    expect(r.missed.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });

  it('a mutation that is never effective fails the self-check (it tested nothing)', () => {
    const r = runSelfCheck({ ...fieldByGoal, plan: { Ts: [97], horizon: 200, tailFrom: 300, end: 600 }, mutation: () => () => undefined });
    expect(r.effectiveCuts).toEqual([]);
    expect(r.ok).toBe(false);
  });
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
  });
});
