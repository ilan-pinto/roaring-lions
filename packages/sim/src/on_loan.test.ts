// The runtime's record of who is on loan (GH-183 F3 Task 6, D5). The runtime never sees a gate:
// `MissionContext.loaned` carries indices into the starting_force it was given, and `start()`
// records the ids those placements spawn, every body of a count-N placement included.
import { describe, expect, it } from 'vitest';
import { MissionRuntime } from './mission';
import type { MissionJson } from './mission';
import { Sim, type UnitTypeJson } from './sim';

const INF: UnitTypeJson = {
  id: 'loan_inf',
  role: 'infantry', // no role derives as wheeled (#402's fixture trap)
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 25, suppression: 40, rof_per_min: 300 },
  ],
};

function start(loaned: readonly number[] | undefined): { rt: MissionRuntime; sim: Sim } {
  const sim = new Sim({ seed: 3, width: 28, height: 12, capacity: 64 });
  const type = sim.addUnitType(INF);
  const mission: MissionJson = {
    id: 'loan_fixture',
    map: { file: 'none', player_start: [4, 6] },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    resources: { logistics_start: 0 },
    starting_force: [
      { unit: 'loan_inf', count: 1, at: [3, 3] },
      { unit: 'loan_inf', count: 3, at: [3, 6] },
      { unit: 'loan_inf', count: 2, at: [3, 9] },
    ],
    enemy: { garrison: [{ unit: 'loan_inf', count: 1, at: [24, 5] }] },
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: () => type,
    markers: {},
    zones: {},
    ledger: {},
    ...(loaned === undefined ? {} : { loaned }),
  });
  rt.start();
  return { rt, sim };
}

describe('MissionRuntime.isOnLoan', () => {
  it('records every body of a loaned count-N placement, and no other body', () => {
    const { rt, sim } = start([1]);
    // spawn order: placement 0 -> id 0; placement 1 -> ids 1-3; placement 2 -> ids 4-5; garrison -> id 6
    expect(sim.entityCount).toBe(7);
    expect([0, 1, 2, 3, 4, 5, 6].map((id) => rt.isOnLoan(id))).toEqual([false, true, true, true, false, false, false]);
  });

  it('records nothing when the context carries no loaned indices', () => {
    const { rt } = start(undefined);
    expect([0, 1, 2, 3, 4, 5, 6].some((id) => rt.isOnLoan(id))).toBe(false);
  });

  it('never answers true for an enemy, whatever the indices say', () => {
    const { rt } = start([0, 1, 2, 3]);
    expect(rt.isOnLoan(6)).toBe(false);
  });
});
