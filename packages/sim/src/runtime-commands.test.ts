import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { MissionRuntime, type MissionJson } from './mission';

const SQUAD: UnitTypeJson = {
  id: 'n2_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [{ id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 1, suppression: 0, rof_per_min: 300 }],
};
/** One squad each side, far apart (no fight in 600 ticks); destroy_all keeps it ongoing. */
function world(logistics: number, intel: number) {
  const sim = new Sim({ seed: 11, width: 40, height: 12, capacity: 32 });
  const t = sim.addUnitType(SQUAD);
  const mission: MissionJson = {
    id: 'n2_cmds', map: { file: 'none', player_start: [3, 5] }, ledger: { requires: [], produces: [] },
    objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
    resources: { logistics_start: logistics, intel_start: intel },
    starting_force: [{ unit: 'n2_squad', count: 1, at: [3, 5] }],
    enemy: { garrison: [{ unit: 'n2_squad', count: 1, at: [36, 5] }] },
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: () => t, markers: {}, zones: {},
    unitInfo: (u) => (u === 'n2_squad' ? { logistics: 300, buildTimeS: 2, population: 1 } : null),
  });
  rt.start();
  const step = (n: number): void => { for (let i = 0; i < n; i++) rt.step(sim.tick()); };
  return { sim, rt, step };
}
const BUILD = { kind: 'build', side: 0, unit: 'n2_squad' } as const;

describe('build and support as commands (N2)', () => {
  it('the sim sets them aside: takeRuntimeCommands returns them in queue order, then empty', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const a = { kind: 'build', side: 0, unit: 'inf_squad' } as const;
    const b = { kind: 'support', side: 0, support: 'drone_sweep', x: fx.from(2), y: fx.from(2) } as const;
    sim.queueCommand(a);
    sim.queueCommand(b);
    expect(sim.takeRuntimeCommands()).toEqual([a, b]);
    expect(sim.takeRuntimeCommands()).toEqual([]);
  });
  it('a runtime command nobody took is discarded by the next tick, never run late (R-3)', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const before = sim.hash();
    sim.queueCommand({ kind: 'build', side: 0, unit: 'inf_squad' });
    sim.tick();
    expect(sim.takeRuntimeCommands()).toEqual([]);
    const twin = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    twin.tick();
    expect(sim.hash()).toBe(twin.hash());
    expect(before).toBe(new Sim({ seed: 1, width: 8, height: 8, capacity: 4 }).hash());
  });
  it('applyQueued builds what requestBuild would, at the same start tick', () => {
    const a = world(600, 0);
    const b = world(600, 0);
    a.step(10);
    b.step(10);
    expect(a.rt.requestBuild('n2_squad')).toBe(true);
    b.sim.queueCommand(BUILD);
    expect(b.rt.applyQueued()).toBe(1);
    expect(b.rt.production).toEqual(a.rt.production); // same unit; doneTicks 0, totalTicks 40, ticksLeft 40 (queued at tick 10, ready at 50)
    expect(b.rt.logistics).toBe(a.rt.logistics);
    a.step(100);
    b.step(100);
    expect(b.rt.economyHash()).toBe(a.rt.economyHash());
    expect(b.sim.hash()).toBe(a.sim.hash());
  });
  it('a build for side 1 is refused and spends nothing (C-R3)', () => {
    const w = world(600, 0);
    w.sim.queueCommand({ ...BUILD, side: 1 });
    expect(w.rt.applyQueued()).toBe(0);
    expect([w.rt.logistics, w.rt.production.length]).toEqual([600, 0]);
  });
  it('two builds in one frame where the purse covers one: the first queues, the second spends nothing', () => {
    const w = world(300, 0);
    w.sim.queueCommand(BUILD);
    w.sim.queueCommand(BUILD);
    expect(w.rt.applyQueued()).toBe(1);
    expect([w.rt.production.length, w.rt.logistics]).toEqual([1, 0]);
  });
  it('support: the command path and the direct call leave identical sims and purses', () => {
    for (const kind of ['drone_sweep', 'air_strike'] as const) {
      const a = world(0, 400);
      const b = world(0, 400);
      a.step(5);
      b.step(5);
      expect(a.rt.requestSupport(kind, fx.from(30), fx.from(5))).toBe(true);
      b.sim.queueCommand({ kind: 'support', side: 0, support: kind, x: fx.from(30), y: fx.from(5) });
      expect(b.rt.applyQueued()).toBe(1);
      a.step(200);
      b.step(200);
      expect([b.sim.hash(), b.rt.intel], kind).toEqual([a.sim.hash(), a.rt.intel]);
    }
  });
  it('canBuild and canSupport agree with what requestBuild and requestSupport then do', () => {
    const poor = world(299, 0);
    expect([poor.rt.canBuild('n2_squad'), poor.rt.requestBuild('n2_squad')]).toEqual([false, false]);
    expect([poor.rt.canBuild('no_such_unit'), poor.rt.requestBuild('no_such_unit')]).toEqual([false, false]);
    const rich = world(300, 0);
    expect([rich.rt.canBuild('n2_squad'), rich.rt.requestBuild('n2_squad')]).toEqual([true, true]);
    expect(rich.rt.canSupport('drone_sweep')).toBe(false); // intel 0
    // 500, not 400: after the first strike (250) the second is still affordable, so
    // the debugKill line below is refused by the caller clause alone, not by intel.
    const spy = world(0, 500);
    expect([spy.rt.canSupport('air_strike'), spy.rt.requestSupport('air_strike', fx.from(30), fx.from(5))]).toEqual([true, true]);
    spy.sim.debugKill(0); // the only side-0 unit: no surface caller left
    expect([spy.rt.canSupport('air_strike'), spy.rt.requestSupport('air_strike', fx.from(30), fx.from(5))]).toEqual([false, false]);
    expect(spy.rt.canSupport('drone_sweep')).toBe(true); // a sweep names no caller
  });
});
