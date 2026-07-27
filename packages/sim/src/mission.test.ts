import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import { MissionRuntime, type MissionContext, type MissionEvent, type MissionJson } from './mission';

// Mission runtime tests: the declarative vocabulary (GDD §6) interpreted
// deterministically. Small worlds, headless, seconds of sim time.

const SQUAD: UnitTypeJson = {
  id: 'm_squad',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 25, suppression: 40, rof_per_min: 300 },
  ],
};

const AMBUSHER: UnitTypeJson = {
  id: 'm_rpg',
  hull: { hp: 340, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.45 },
  weapons: [
    { id: 'rpg', type: 'rpg', range_tiles: 5, effective_range_tiles: 3.5, accuracy: 0.6, penetration: 550, damage: 300, suppression: 20, rof_per_min: 6 },
  ],
};

const RUNNER: UnitTypeJson = {
  id: 'm_tech',
  hull: { hp: 600, armor: { front: 15, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2.5, turn_rate_deg_s: 180 },
  sensors: { optics: 1.0, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};

const TANK: UnitTypeJson = {
  id: 'm_tank',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1.0, sight_tiles: 12, signature: 1.0 },
  weapons: [
    { id: 'gun', type: 'apfsds', range_tiles: 12, effective_range_tiles: 9.6, accuracy: 0.85, penetration: 1300, damage: 520, rof_per_min: 12 },
  ],
};

interface World {
  sim: Sim;
  runtime: MissionRuntime;
  step: (ticks: number) => { sim: SimEvent[]; mission: MissionEvent[] };
}

function makeWorld(mission: MissionJson, ctx?: Partial<MissionContext>): World {
  const sim = new Sim({ seed: 7, width: 28, height: 12, capacity: 32 });
  const ids = new Map<string, number>();
  for (const t of [SQUAD, AMBUSHER, RUNNER, TANK]) ids.set(t.id, sim.addUnitType(t));
  const runtime = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: {},
    zones: {},
    ...ctx,
  });
  runtime.start();
  return {
    sim,
    runtime,
    step: (ticks: number) => {
      const out: { sim: SimEvent[]; mission: MissionEvent[] } = { sim: [], mission: [] };
      for (let i = 0; i < ticks; i++) {
        const se = sim.tick();
        out.sim.push(...se);
        out.mission.push(...runtime.step(se));
      }
      return out;
    },
  };
}

function baseMission(partial: Partial<MissionJson>): MissionJson {
  return {
    id: 'test_mission',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
    ...partial,
  };
}

describe('spawning and stances', () => {
  it('spawns starting force and garrison with facing, groups, and tags', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 2, at: [3, 5] }],
        enemy: { garrison: [{ unit: 'm_tank', count: 1, at: [24, 5], facing_deg: 180, tag: 'hvt' }] },
      })
    );
    expect(w.sim.entityCount).toBe(3);
    expect(w.sim.state.side[0]).toBe(0);
    expect(w.sim.state.side[2]).toBe(1);
    // 180° = half turn.
    expect(w.sim.state.facing[2]).toBe(32768);
  });

  it('ambush holds fire and springs only when a target closes to range', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [2, 5] }],
        enemy: {
          garrison: [{ unit: 'm_rpg', count: 1, at: [20, 5], facing_deg: 180, stance: { kind: 'ambush', tiles: 3 } }],
        },
      })
    );
    const ambusher = 1;
    w.sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(19.0), y: fx.from(5.0) });

    let sprungTick = -1;
    let firstFire = -1;
    let distAtSpring = 99;
    for (let t = 0; t < 30 * TICKS_PER_SECOND; t++) {
      const se = w.sim.tick();
      w.runtime.step(se);
      for (const e of se) {
        if (e.kind === 'ambushSprung' && e.entity === ambusher && sprungTick < 0) {
          sprungTick = t;
          const dx = fx.toNumber(w.sim.state.posX[0]) - fx.toNumber(w.sim.state.posX[ambusher]);
          const dy = fx.toNumber(w.sim.state.posY[0]) - fx.toNumber(w.sim.state.posY[ambusher]);
          distAtSpring = Math.hypot(dx, dy);
        }
        if (e.kind === 'fire' && e.shooter === ambusher && firstFire < 0) firstFire = t;
      }
      if (firstFire >= 0) break;
    }
    expect(sprungTick).toBeGreaterThan(0);
    expect(distAtSpring).toBeLessThan(3.3); // held fire until inside 3 tiles despite a 5-tile weapon
    expect(firstFire).toBeGreaterThanOrEqual(sprungTick);
  });

  it('patrol cycles between waypoints', () => {
    const w = makeWorld(
      baseMission({
        enemy: {
          garrison: [
            { unit: 'm_tech', count: 1, at: [4, 2], stance: { kind: 'patrol', waypoints: [[4, 2], [20, 2]] } },
          ],
        },
      })
    );
    let reachedEast = false;
    let backWest = false;
    for (let t = 0; t < 60 * TICKS_PER_SECOND; t++) {
      w.runtime.step(w.sim.tick());
      const x = fx.toNumber(w.sim.state.posX[0]);
      if (x > 19) reachedEast = true;
      if (reachedEast && x < 6) backWest = true;
      if (backWest) break;
    }
    expect(reachedEast).toBe(true);
    expect(backWest).toBe(true);
  });
});

describe('objectives and mission end', () => {
  it('capture: clear the zone, hold it, win', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 2, at: [3, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [21, 5], facing_deg: 180 }] },
        objectives: [{ id: 'take', type: 'capture', primary: true, target: 'obj', seconds: 3 }],
      }),
      { zones: { obj: [19, 3, 5, 5] } }
    );
    w.sim.queueCommand({ kind: 'attackMove', ids: [0, 1], x: fx.from(21.5), y: fx.from(5.5) });
    const { mission } = w.step(90 * TICKS_PER_SECOND);
    expect(mission.some((e) => e.kind === 'objective' && e.id === 'take' && e.status === 'complete')).toBe(true);
    const end = mission.find((e) => e.kind === 'missionEnd');
    expect(end).toBeDefined();
    if (end?.kind === 'missionEnd') {
      expect(end.result).toBe('victory');
      expect(end.survivors.length).toBeGreaterThan(0);
    }
  });

  it('locate completes on identification; eliminate_hvt on tagged kill', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_tank', count: 1, at: [4, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [12, 5], facing_deg: 180, tag: 'hvt' }] },
        objectives: [
          { id: 'find', type: 'locate', primary: false, count: 1 },
          { id: 'kill', type: 'eliminate_hvt', primary: true, target: 'hvt' },
        ],
      })
    );
    const { mission } = w.step(60 * TICKS_PER_SECOND);
    const findDone = mission.find((e) => e.kind === 'objective' && e.id === 'find' && e.status === 'complete');
    const killDone = mission.find((e) => e.kind === 'objective' && e.id === 'kill' && e.status === 'complete');
    expect(findDone).toBeDefined();
    expect(killDone).toBeDefined();
    expect(w.runtime.result).toBe('victory');
  });

  it('survive_until wins on the clock; a wiped force is defeat', () => {
    const calm = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 4 }],
      })
    );
    const calmEvents = calm.step(6 * TICKS_PER_SECOND).mission;
    const calmEnd = calmEvents.find((e) => e.kind === 'missionEnd');
    expect(calmEnd?.kind === 'missionEnd' && calmEnd.result).toBe('victory');

    const doomed = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [10, 5] }],
        enemy: { garrison: [{ unit: 'm_tank', count: 2, at: [16, 5], facing_deg: 180 }] },
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
      })
    );
    const doomedEvents = doomed.step(120 * TICKS_PER_SECOND).mission;
    const doomedEnd = doomedEvents.find((e) => e.kind === 'missionEnd');
    expect(doomedEnd?.kind === 'missionEnd' && doomedEnd.result).toBe('defeat');
  });

  it('rejects objective types the runtime does not support yet', () => {
    expect(() =>
      makeWorld(baseMission({ objectives: [{ id: 'x', type: 'collapse', primary: true }] }))
    ).toThrow(/collapse/);
  });
});

describe('triggers and waves', () => {
  it('timer trigger commits a group toward a marker', () => {
    const w = makeWorld(
      baseMission({
        enemy: { garrison: [{ unit: 'm_tech', count: 1, at: [24, 9], group: 'reserve' }] },
        triggers: [{ id: 'push', on: { kind: 'timer_s', value: 2 }, do: { kind: 'commit', group: 'reserve', to: 'rally' } }],
      }),
      { markers: { rally: [4, 2] } }
    );
    const { mission } = w.step(10 * TICKS_PER_SECOND);
    expect(mission.some((e) => e.kind === 'trigger' && e.id === 'push')).toBe(true);
    expect(fx.toNumber(w.sim.state.posX[0])).toBeLessThan(20); // moving toward the rally
  });

  it('zone_entered trigger spawns reinforcements', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        triggers: [
          {
            on: { kind: 'zone_entered', zone: 'gate' },
            do: { kind: 'spawn', units: [{ unit: 'm_rpg', count: 2, marker: 'north' }] },
          },
        ],
      }),
      { zones: { gate: [10, 3, 3, 5] }, markers: { north: [22, 2] } }
    );
    expect(w.sim.entityCount).toBe(1);
    w.sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(11.5), y: fx.from(5.5) });
    w.step(20 * TICKS_PER_SECOND);
    expect(w.sim.entityCount).toBe(3);
  });

  it('scheduled waves spawn and attack-move to their objective', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        enemy: {
          waves: [{ at_seconds: 2, to: 'push', units: [{ unit: 'm_rpg', count: 2, from: 'north' }] }],
        },
      }),
      { markers: { north: [24, 2], push: [4, 5] } }
    );
    expect(w.sim.entityCount).toBe(1);
    const { mission } = w.step(4 * TICKS_PER_SECOND);
    expect(mission.some((e) => e.kind === 'wave')).toBe(true);
    expect(w.sim.entityCount).toBe(3);
    expect(w.sim.state.moving[1]).toBe(1); // wave is advancing
  });
});

describe('determinism through the runtime', () => {
  it('two identical mission runs produce identical sim hashes', () => {
    const run = (): number => {
      const w = makeWorld(
        baseMission({
          starting_force: [{ unit: 'm_squad', count: 2, at: [3, 5] }],
          enemy: {
            garrison: [
              { unit: 'm_rpg', count: 1, at: [20, 5], facing_deg: 180, stance: { kind: 'ambush', tiles: 3 } },
              { unit: 'm_tech', count: 1, at: [24, 2], stance: { kind: 'patrol', waypoints: [[24, 2], [24, 9]] } },
            ],
            waves: [{ at_seconds: 3, to: 'push', units: [{ unit: 'm_rpg', count: 1, from: 'north' }] }],
          },
          triggers: [{ on: { kind: 'timer_s', value: 5 }, do: { kind: 'commit', group: 'none', to: 'push' } }],
        }),
        { markers: { north: [24, 9], push: [4, 5] } }
      );
      w.sim.queueCommand({ kind: 'attackMove', ids: [0, 1], x: fx.from(22.0), y: fx.from(5.0) });
      w.step(30 * TICKS_PER_SECOND);
      return w.sim.hash();
    };
    expect(run()).toBe(run());
  });
});
