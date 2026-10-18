// N2 Task 6 (R-5): `MissionRuntime.digest()` folds only runtime state with a
// twin here that isolates it. Each twin builds two runtimes on one fixture that
// differ in exactly one input, and asserts three things: the economy hash is
// EQUAL (so the difference is not economy, which `digest()` folds as its first
// word), the digests DIFFER, and the one public read that shows the difference.
//
// The trap (C-R5): a side-0 and a side-1 unit that see each other identify each
// other, and F1's first identification pays intel, which moves `economyHash` and
// breaks the isolation. Every twin with both sides on the map uses `D_EYE`
// (sight 1) at 4 tiles apart, or keeps them far apart.

import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import { MissionRuntime, type MissionContext, type MissionEvent, type MissionJson } from './mission';

/** Weaponless and near-blind: it can stand on ground and contest it, and sees
 *  nobody at 4 tiles, so no identification is ever paid. */
const D_EYE: UnitTypeJson = {
  id: 'd_eye',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 1, signature: 0.6 },
  weapons: [],
};

/** `mission.test.ts`'s `CIVILIANS` literal, copied. */
const CIV: UnitTypeJson = {
  id: 'm_civ',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 }, suppression_resistance: 0.15 },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7, firing_signature_mult: 1.0 },
};

interface World {
  sim: Sim;
  rt: MissionRuntime;
  /** Runs until the sim's tickCount is `tick`; returns every mission event on the way. */
  stepTo: (tick: number, before?: (tick: number) => void) => MissionEvent[];
}

function world(partial: Partial<MissionJson>, ctx: Partial<MissionContext> = {}): World {
  const sim = new Sim({ seed: 21, width: 28, height: 12, capacity: 16 });
  const ids = new Map<string, number>();
  for (const t of [D_EYE, CIV]) ids.set(t.id, sim.addUnitType(t));
  const mission: MissionJson = {
    id: 'digest_twin',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'clock', type: 'survive_until', primary: true, seconds: 600 }],
    ...partial,
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: { out: [20, 5] },
    zones: {},
    ...ctx,
  });
  rt.start();
  return {
    sim,
    rt,
    stepTo: (tick, before) => {
      const out: MissionEvent[] = [];
      while (sim.tickCount < tick) {
        before?.(sim.tickCount);
        const se: SimEvent[] = sim.tick();
        out.push(...rt.step(se));
      }
      return out;
    },
  };
}

/** The isolation and the difference, asserted the same way for every twin. */
function expectTwin(a: World, b: World): void {
  expect(a.rt.economyHash()).toBe(b.rt.economyHash());
  expect(a.rt.digest()).not.toBe(b.rt.digest());
}

describe('MissionRuntime.digest() twins (N2 Task 6, R-5)', () => {
  it('objective status: a secondary that failed against one still active', () => {
    // The brief named `locate` with `seconds`, but `locate` has no deadline in
    // stepObjectives (only raze, collapse and evacuate_before can fail). An
    // `evacuate_before` with no civilians is the cheapest objective that fails
    // on a clock; a failure pays nothing.
    const mk = (seconds: number): World =>
      world(
        {
          civilians: { groups: [], refuge: 'out' },
          objectives: [
            { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
            { id: 'evac', type: 'evacuate_before', primary: false, target: 'safe', count: 1, seconds },
          ],
        },
        { zones: { safe: [18, 3, 4, 4] } },
      );
    const a = mk(1);
    const b = mk(1000);
    a.stepTo(40);
    b.stepTo(40);
    expect(a.rt.objectiveList.find((o) => o.id === 'evac')?.status).toBe('failed');
    expect(b.rt.objectiveList.find((o) => o.id === 'evac')?.status).toBe('active');
    expectTwin(a, b);
  });

  it('paused: an unheld hold against a contested one, holdTicks 0 in both', () => {
    // Both runs field the same two units (so population, an economy word, is
    // equal); only WHERE they stand differs. Sight 1 at 4 tiles: nobody is seen.
    const mk = (inside: boolean): World =>
      world(
        {
          starting_force: [{ unit: 'd_eye', count: 1, at: inside ? [9, 5] : [9, 10] }],
          enemy: { garrison: [{ unit: 'd_eye', count: 1, at: inside ? [13, 5] : [13, 10] }] },
          objectives: [
            { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
            { id: 'hold', type: 'hold_for', primary: false, target: 'z', seconds: 300 },
          ],
        },
        { zones: { z: [8, 2, 6, 6] } },
      );
    const a = mk(false);
    const b = mk(true);
    a.stepTo(10);
    b.stepTo(10);
    const ha = a.rt.objectiveList.find((o) => o.id === 'hold');
    const hb = b.rt.objectiveList.find((o) => o.id === 'hold');
    expect(ha?.paused).toBe('unheld');
    expect(hb?.paused).toBe('contested');
    // holdTicks 0 in both: the full clock is left.
    expect(ha?.ticksLeft).toBe(300 * TICKS_PER_SECOND);
    expect(hb?.ticksLeft).toBe(300 * TICKS_PER_SECOND);
    // Neither identified anything: the trap did not spring.
    expect(a.rt.intel).toBe(0);
    expect(b.rt.intel).toBe(0);
    expectTwin(a, b);
  });

  it('holdTicks: held from the start against held from a few ticks later, paused null in both', () => {
    // The brief's twin (empty against held) differs in `paused` too, so it
    // cannot isolate holdTicks. This one reads two HELD zones whose clocks
    // started on different ticks: same unit, B's starts one tile outside the
    // zone and walks in.
    const mk = (late: boolean): World =>
      world(
        {
          starting_force: [{ unit: 'd_eye', count: 1, at: late ? [7, 5] : [9, 5] }],
          objectives: [
            { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
            { id: 'hold', type: 'hold_for', primary: false, target: 'z', seconds: 300 },
          ],
        },
        { zones: { z: [8, 2, 6, 6] } },
      );
    const a = mk(false);
    const b = mk(true);
    b.sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(9.5), y: fx.from(5.5), exact: true });
    a.stepTo(40);
    b.stepTo(40);
    const ha = a.rt.objectiveList.find((o) => o.id === 'hold');
    const hb = b.rt.objectiveList.find((o) => o.id === 'hold');
    expect(ha?.paused).toBeUndefined();
    expect(hb?.paused).toBeUndefined();
    // holdTicks is read through `ticksLeft` (seconds * 20 - holdTicks).
    expect(ha?.ticksLeft).toBe(300 * TICKS_PER_SECOND - 40);
    expect(hb?.ticksLeft).toBeGreaterThan(300 * TICKS_PER_SECOND - 40);
    expectTwin(a, b);
  });

  it('trigger latch: a timer trigger that fired against one that has not', () => {
    const mk = (value: number): World =>
      world({ triggers: [{ on: { kind: 'timer_s', value }, do: { kind: 'withdraw_to', group: 'nobody', to: 'out' } }] });
    const a = mk(1);
    const b = mk(1000);
    const ea = a.stepTo(40);
    const eb = b.stepTo(40);
    expect(ea.some((e) => e.kind === 'trigger')).toBe(true);
    expect(eb.some((e) => e.kind === 'trigger')).toBe(false);
    expectTwin(a, b);
  });

  it('wave latch: an empty wave that spawned against one that has not', () => {
    const mk = (at: number): World => world({ enemy: { waves: [{ at_seconds: at, units: [] }] } });
    const a = mk(1);
    const b = mk(1000);
    const ea = a.stepTo(40);
    const eb = b.stepTo(40);
    expect(ea.some((e) => e.kind === 'wave')).toBe(true);
    expect(eb.some((e) => e.kind === 'wave')).toBe(false);
    expectTwin(a, b);
  });

  /** A caller at (2,2), a civilian at (10,5), an air strike through
   *  `requestSupport` at `at` on tick 0 (equal intel spent in both). */
  function strikeWorld(at: [number, number], roe: MissionJson['roe']): World {
    const w = world({
      starting_force: [{ unit: 'd_eye', count: 1, at: [2, 2] }],
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [10, 5] }] },
      resources: { intel_start: 250 },
      roe,
    });
    expect(w.rt.requestSupport('air_strike', fx.from(at[0] + 0.5), fx.from(at[1] + 0.5))).toBe(true);
    return w;
  }

  /** Steps both until either has raised its first `roe` event, then stops: that
   *  tick is the strike's impact (`strike` is raised when the round lands, not
   *  when it is called, so the brief's "before the first round's delay" read
   *  would see nothing; record in the task report). */
  function toFirstRoe(a: World, b: World): void {
    for (let t = 0; t < 10 * TICKS_PER_SECOND; t++) {
      const ea = a.stepTo(a.sim.tickCount + 1);
      const eb = b.stepTo(b.sim.tickCount + 1);
      if (ea.some((e) => e.kind === 'roe') || eb.some((e) => e.kind === 'roe')) return;
    }
    throw new Error('no roe event in 10 s');
  }

  it('ROE score: a danger-close strike against the same strike 10 tiles from any civilian', () => {
    const a = strikeWorld([10, 5], { enabled: true });
    const b = strikeWorld([20, 5], { enabled: true });
    toFirstRoe(a, b);
    expect(a.rt.roeScore).toBeLessThan(100);
    expect(b.rt.roeScore).toBe(100);
    expectTwin(a, b);
  });

  it('ROE failed latch: the same danger-close strike, fail_below 100 against none', () => {
    const a = strikeWorld([10, 5], { enabled: true, fail_below: 100 });
    const b = strikeWorld([10, 5], { enabled: true });
    toFirstRoe(a, b);
    expect(a.rt.roeScore).toBe(b.rt.roeScore);
    expect(a.rt.roeScore).toBeLessThan(100);
    // `result` is not folded (R-5); it is the public read of `roeFailed`.
    expect(a.rt.result).toBe('defeat');
    expect(b.rt.result).toBe('ongoing');
    expectTwin(a, b);
  });

  it('civilian latch: a civilian frightened into flight against one left alone', () => {
    const mk = (): World => world({ civilians: { groups: [{ unit: 'm_civ', count: 1, at: [10, 5] }], refuge: 'out' } });
    const civ = 0;
    const a = mk();
    const b = mk();
    expect(a.sim.state.side[civ]).toBe(2);
    a.stepTo(7);
    b.stepTo(7, (t) => {
      if (t === 5) b.sim.debugSuppress(civ, fx.from(1));
    });
    // The flight's order is the latch's visible half. The sims differ, by design.
    expect(b.sim.state.moving[civ]).toBe(1);
    expect(a.sim.state.moving[civ]).toBe(0);
    expectTwin(a, b);
  });

  it('civilian latch: a civilian counted out against one still on the map, nobody fled', () => {
    // The second civilian set. `count: 2` against one civilian keeps the
    // objective active in both (a completion would pay intel, an economy word).
    const mk = (at: [number, number]): World =>
      world(
        {
          civilians: { groups: [{ unit: 'm_civ', count: 1, at }], refuge: 'out' },
          objectives: [
            { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
            { id: 'evac', type: 'evacuate_before', primary: false, target: 'safe', count: 2, seconds: 1000 },
          ],
        },
        { zones: { safe: [18, 3, 4, 4] } },
      );
    const a = mk([20, 5]);
    const b = mk([10, 5]);
    const ea = a.stepTo(5);
    const eb = b.stepTo(5);
    expect(ea.some((e) => e.kind === 'evacuated')).toBe(true);
    expect(eb.some((e) => e.kind === 'evacuated')).toBe(false);
    // Nobody fled in either run: no fire, and no soldier to shepherd them.
    expect(a.sim.state.moving[0]).toBe(0);
    expect(b.sim.state.moving[0]).toBe(0);
    expect(a.rt.objectiveList.find((o) => o.id === 'evac')?.status).toBe('active');
    expectTwin(a, b);
  });
});
