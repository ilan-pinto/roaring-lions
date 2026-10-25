// The runtime's record of who is on loan (GH-183 F3 Task 6, D5). The runtime never sees a gate:
// `MissionContext.loaned` carries indices into the starting_force it was given, and `start()`
// records the ids those placements spawn, every body of a count-N placement included.
import { describe, expect, it } from 'vitest';
import { MissionRuntime } from './mission';
import { loanedReinforcements, type UnlockGate } from './unlock';
import type { LedgerRosterEntry, MissionEvent, MissionJson } from './mission';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';

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

// L-1 (GH-183 F3 Task 7): a loaned survivor goes back to the lender. `checkEnd` still counts it as
// a survivor and as home (the debrief and the credits), but it never joins `roster.surviving_units`.
describe('checkEnd returns a loaned survivor (L-1)', () => {
  function play(loaned: readonly number[], kill?: number): { events: MissionEvent[]; rt: MissionRuntime; sim: Sim } {
    const sim = new Sim({ seed: 3, width: 28, height: 12, capacity: 64 });
    const type = sim.addUnitType(INF);
    const mission: MissionJson = {
      id: 'loan_end',
      map: { file: 'none', player_start: [4, 6] },
      ledger: { requires: [], produces: ['roster.surviving_units'] },
      objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 2 }],
      resources: { logistics_start: 0 },
      starting_force: [
        { unit: 'loan_inf', count: 1, at: [3, 3] },
        { unit: 'loan_inf', count: 1, at: [3, 6] },
      ],
      enemy: { garrison: [{ unit: 'loan_inf', count: 1, at: [26, 10] }] },
    };
    const rt = new MissionRuntime(sim, mission, { typeIdOf: () => type, markers: {}, zones: {}, ledger: {}, loaned });
    rt.start();
    const events: MissionEvent[] = [];
    if (kill !== undefined) sim.debugKill(kill);
    for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) events.push(...rt.step(sim.tick()));
    return { events, rt, sim };
  }
  const endOf = (events: MissionEvent[]): Extract<MissionEvent, { kind: 'missionEnd' }> => {
    const end = events.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    return end;
  };

  it('the produced roster holds the open placement only; the loaned one is a survivor and at home', () => {
    const { events, rt } = play([0]);
    const end = endOf(events);
    expect(end.result).toBe('victory');
    const roster = end.ledger['roster.surviving_units'] as LedgerRosterEntry[];
    expect(roster.map((r) => r.type)).toEqual(['loan_inf']);
    expect(roster).toHaveLength(1);
    // Both bodies are still counted as survivors (the debrief) and at home (credits).
    expect(end.survivors).toEqual(['loan_inf', 'loan_inf']);
    expect(rt.startingHome).toBe(2);
    expect(rt.startingCount).toBe(2);
  });

  it('with nothing on loan both survivors join the roster (the control)', () => {
    const roster = endOf(play([]).events).ledger['roster.surviving_units'] as LedgerRosterEntry[];
    expect(roster).toHaveLength(2);
  });

  it('a loaned unit that earned a stripe loses it on return, and still counts as promoted', () => {
    const { events, rt } = play([0, 1]);
    const roster = endOf(events).ledger['roster.surviving_units'] as LedgerRosterEntry[];
    expect(roster).toEqual([]);
    expect(rt.promotedCount).toBe(2);
  });

  it('a loaned unit killed in the mission is a loss like any other, and the open one still returns', () => {
    const { events, rt } = play([0], 0);
    const lost = events.filter((e) => e.kind === 'unitLost');
    expect(lost.map((e) => (e.kind === 'unitLost' ? e.entity : -1))).toEqual([0]);
    const end = endOf(events);
    expect(end.survivors).toEqual(['loan_inf']);
    expect(rt.startingHome).toBe(1);
    expect(end.ledger['roster.surviving_units'] as LedgerRosterEntry[]).toHaveLength(1);
  });
});

// GH-801 (the lead, 25 Oct 2026): L-1 reaches a gated unit that arrives by a `reinforce` trigger.
// The fixture mirrors the shipped case, `wadi_halam_5_depot`'s second demo_squad (Conduct 77): one
// open starting body, one gated reinforcement on a 1 s timer, played to a victory. Conduct is the
// ledger's 'roe.mission_ratings' mean, so 60 is below the gate and 80 is above it.
describe('a gated reinforcement is on loan (GH-801)', () => {
  const GATE: Record<string, UnlockGate> = { loan_inf: { roeMin: 77 } };
  const gateOf = (id: string): UnlockGate | undefined => GATE[id];
  const MISSION: MissionJson = {
    id: 'reinforce_loan',
    map: { file: 'none', player_start: [4, 6] },
    ledger: { requires: [], produces: ['roster.surviving_units'] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 3 }],
    resources: { logistics_start: 0 },
    starting_force: [{ unit: 'loan_inf', count: 1, at: [3, 3], from_ledger: true }],
    triggers: [
      { id: 'second_team', on: { kind: 'timer_s', value: 1 }, do: { kind: 'reinforce', units: [{ unit: 'loan_inf', count: 1, at: [3, 8] }] } },
    ],
    enemy: { garrison: [{ unit: 'loan_inf', count: 1, at: [26, 10] }] },
  };

  function play(conduct: number): { rosterTypes: string[]; loanedIds: number[]; survivors: string[] } {
    const ledger = { 'roe.mission_ratings': { earlier: conduct } };
    const sim = new Sim({ seed: 3, width: 28, height: 12, capacity: 64 });
    const type = sim.addUnitType(INF);
    const rt = new MissionRuntime(sim, MISSION, {
      typeIdOf: () => type,
      markers: {},
      zones: {},
      ledger,
      loanedReinforce: loanedReinforcements(MISSION, ledger, gateOf),
    });
    rt.start();
    const events: MissionEvent[] = [];
    for (let i = 0; i < 5 * TICKS_PER_SECOND; i++) events.push(...rt.step(sim.tick()));
    const end = events.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    expect(end.result).toBe('victory');
    const loanedIds: number[] = [];
    for (let id = 0; id < sim.entityCount; id++) if (rt.isOnLoan(id)) loanedIds.push(id);
    return {
      rosterTypes: (end.ledger['roster.surviving_units'] as LedgerRosterEntry[]).map((r) => r.type),
      loanedIds,
      survivors: end.survivors,
    };
  }

  it('below the gate the reinforcement goes back to the lender: it is a survivor, not on the roster', () => {
    const got = play(60);
    // Spawn order: the starting body is id 0, the enemy garrison id 1, the reinforcement (at 1 s) id 2.
    expect(got.loanedIds).toEqual([2]);
    expect(got.survivors).toEqual(['loan_inf', 'loan_inf']);
    expect(got.rosterTypes).toEqual(['loan_inf']);
  });

  it('at or above the gate the reinforcement is the brigade\'s own and joins the roster', () => {
    for (const conduct of [77, 80]) {
      const got = play(conduct);
      expect(got.loanedIds).toEqual([]);
      expect(got.rosterTypes).toEqual(['loan_inf', 'loan_inf']);
    }
  });
});

describe('loanedReinforcements (GH-801)', () => {
  const g = (id: string): UnlockGate | undefined => (id === 'gated' ? { roeMin: 77 } : undefined);
  const mission = {
    id: 'm',
    starting_force: [{ unit: 'gated', count: 1, at: [1, 1] }],
    triggers: [
      { on: { kind: 'timer_s', value: 1 }, do: { kind: 'spawn', units: [{ unit: 'gated', count: 1, at: [1, 1] }] } },
      {
        on: { kind: 'timer_s', value: 2 },
        do: {
          kind: 'reinforce',
          units: [
            { unit: 'open', count: 1, at: [1, 1] },
            { unit: 'gated', count: 1, at: [1, 1] },
            { unit: 'gated', count: 1, at: [1, 1], from_ledger: true },
          ],
        },
      },
    ],
  } as unknown as MissionJson;

  it('names only a reinforce placement that is gated and not from the ledger', () => {
    expect([...loanedReinforcements(mission, {}, g)]).toEqual(['1:1']);
  });

  it('names nothing once the gate is open or bought', () => {
    expect(loanedReinforcements(mission, { 'roe.mission_ratings': { a: 80 } }, g).size).toBe(0);
    expect(loanedReinforcements(mission, {}, (id) => (id === 'gated' ? { roeMin: 77, bought: true } : undefined)).size).toBe(0);
  });
});
