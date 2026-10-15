// The population census (GH-183 F3 Task 5) reads the RUNTIME, not the mission JSON. The fixture is a
// mission whose JSON says "2 infantry at the start" and whose timer trigger reinforces 3 more at t=1 s
// and spawns an enemy at the same moment: the starting figure must stay at what `start()` spawned while
// the peak climbs, and the build queue's reservation (side 0 only) must show in the peak too.
import { describe, expect, it } from 'vitest';
import { MissionRuntime, Sim, type MissionJson, type UnitTypeJson } from '@lions/sim';
import { PopulationCensus, censusViolations, populationLine } from './population-census';

const INF: UnitTypeJson = {
  id: 'cen_inf',
  role: 'infantry', // no role derives as wheeled: cannot board, never braces (#402's fixture trap)
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 25, suppression: 40, rof_per_min: 300 },
  ],
};
const HEAVY: UnitTypeJson = { ...INF, id: 'cen_heavy', cost: { population: 2 } };

function world(opts: { reinforce: boolean }): { sim: Sim; rt: MissionRuntime } {
  const sim = new Sim({ seed: 7, width: 28, height: 12, capacity: 64 });
  const ids = new Map<string, number>();
  for (const t of [INF, HEAVY]) ids.set(t.id, sim.addUnitType(t));
  const mission: MissionJson = {
    id: 'census_fixture',
    map: { file: 'none', player_start: [4, 6] },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    resources: { logistics_start: 1000 },
    starting_force: [{ unit: 'cen_inf', count: 2, at: [3, 5] }],
    enemy: { garrison: [{ unit: 'cen_inf', count: 1, at: [24, 5] }] },
    ...(opts.reinforce
      ? {
          triggers: [
            {
              id: 'arrive',
              label: 'Reinforcements',
              on: { kind: 'timer_s', value: 1 },
              do: { kind: 'reinforce', units: [{ unit: 'cen_heavy', count: 3, at: [2, 6] }] },
            },
          ],
        }
      : {}),
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: {},
    zones: {},
    ledger: {},
    unitInfo: (u) => (u === 'cen_inf' ? { logistics: 10, buildTimeS: 1, population: 1 } : null),
  });
  rt.start();
  return { sim, rt };
}

/** The same three calls `run()` makes, in the same places: begin after `start()`, sample after each step, finish at the end. */
function runCensus(w: { sim: Sim; rt: MissionRuntime }, ticks: number, each?: (tick: number) => void): PopulationCensus {
  const c = new PopulationCensus();
  c.begin(w.rt);
  for (let t = 0; t < ticks; t++) {
    each?.(t);
    w.rt.step(w.sim.tick());
    c.sample(w.rt);
  }
  c.finish(w.rt);
  return c;
}

describe('population census (GH-183 F3 Task 5)', () => {
  it('a mid-mission trigger spawn moves the peak and the end, and leaves the start where start() put it', () => {
    const c = runCensus(world({ reinforce: true }), 60);
    // The JSON lists 2 starters; three heavies (population 2 each) arrive at 1 s: 2 + 6 = 8.
    expect(c.side0.start).toBe(2);
    expect(c.side0.peak).toBe(8);
    expect(c.side0.end).toBe(8);
    expect(c.side1).toEqual({ start: 1, peak: 1, end: 1 });
  });

  it('with no trigger the three readings agree: the peak is not a constant above the start', () => {
    const c = runCensus(world({ reinforce: false }), 60);
    expect(c.side0).toEqual({ start: 2, peak: 2, end: 2 });
  });

  it('peak outlives end: a unit that dies after arriving is in the peak and not in the end', () => {
    const w = world({ reinforce: true });
    const c = runCensus(w, 60, (t) => {
      // Spawn order: starters 0-1, the enemy garrison 2, then the three reinforcements 3-5 (population 2 each).
      if (t === 40) w.sim.debugKill(3);
    });
    expect(c.side0.peak).toBe(8);
    expect(c.side0.end).toBe(6);
  });

  it("counts a queued build as side 0's reservation in the peak, side 1 never", () => {
    const w = world({ reinforce: false });
    const c = runCensus(w, 20, (t) => {
      if (t === 0) expect(w.rt.requestBuild('cen_inf')).toBe(true);
    });
    expect(c.side0.start).toBe(2);
    expect(c.side0.peak).toBe(3);
    expect(c.side1.peak).toBe(1);
  });

  it('formats one line per mission in the report-only house style', () => {
    const c = runCensus(world({ reinforce: true }), 60);
    expect(populationLine('census_fixture', c)).toBe(
      'population census_fixture: side 0 start 2, peak 8, end 8; side 1 start 1, peak 1, end 1 (report only)'
    );
  });
});

describe('censusViolations: peak >= max(start, end) and peak >= 0, per side (final review M1)', () => {
  const census = (a: [number, number, number], b: [number, number, number]): PopulationCensus => {
    const c = new PopulationCensus();
    [c.side0.start, c.side0.peak, c.side0.end] = a;
    [c.side1.start, c.side1.peak, c.side1.end] = b;
    return c;
  };

  it('a sound census, including peak == start == end and a falling side, reports nothing', () => {
    expect(censusViolations('m', census([8, 8, 7], [6, 6, 0]))).toEqual([]);
    expect(censusViolations('m', census([0, 0, 0], [3, 3, 3]))).toEqual([]);
  });

  it('names the side, the peak and the figure it fell below', () => {
    expect(censusViolations('m', census([8, 8, 11], [6, 6, 4]))).toEqual(['population census m: side 0 peak 8 below start 8 / end 11']);
    expect(censusViolations('m', census([8, 8, 8], [9, 6, 4]))).toEqual(['population census m: side 1 peak 6 below start 9 / end 4']);
  });

  it('a negative peak is a violation even when start and end are lower still', () => {
    expect(censusViolations('m', census([-2, -1, -3], [0, 0, 0]))).toHaveLength(1);
  });

  it('a census that was begun and finished but never sampled breaks it when the end rose', () => {
    const w = world({ reinforce: true });
    const rt = w.rt;
    rt.start();
    const c = new PopulationCensus();
    c.begin(rt);
    // No `sample` calls: the reinforcement lands, `finish` reads a larger end, the peak stays at the start.
    for (let i = 0; i < 3 * 20; i++) rt.step(w.sim.tick());
    c.finish(rt);
    expect(c.side0.end).toBeGreaterThan(c.side0.start);
    expect(censusViolations('fixture', c)).toHaveLength(1);
  });
});
