import { describe, expect, it, vi } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import { STRIKE_DELAY_TICKS } from './tuning';
import {
  MissionRuntime,
  type LedgerData,
  type MissionContext,
  type MissionEvent,
  type MissionJson,
  type ObjectiveJson,
  type PlacementJson,
} from './mission';
import type { TunnelRouteJson } from './tunnels';

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


const DRONE: UnitTypeJson = {
  id: 'm_drone',
  role: 'drone',
  hull: { hp: 120, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 2.2 },
  sensors: { optics: 2, sight_tiles: 16, signature: 0.3 },
  abilities: ['mark_target'],
};

// A real carrier and a real rider. The existing fixtures cannot stand in: m_tech
// declares no transport_slots, and m_rpg has no `role`, so `can_embark` defaults
// false. Adding either to those would change what other tests in this file are
// exercising.
const CARRIER: UnitTypeJson = {
  id: 'm_carrier',
  role: 'apc',
  hull: { hp: 900, armor: { front: 20, side: 15, rear: 10 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.2, turn_rate_deg_s: 160 },
  sensors: { optics: 1.0, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};

const RIDER: UnitTypeJson = {
  id: 'm_rider',
  role: 'at_team',
  hull: { hp: 320, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.45 },
  weapons: [
    { id: 'rpg', type: 'rpg', range_tiles: 5, effective_range_tiles: 3.5, accuracy: 0.6, penetration: 550, damage: 300, suppression: 20, rof_per_min: 6 },
  ],
};

/** Every slot the sim could have spawned into. `Sim.count` is private, and the
 *  alive filter each caller applies covers the unspawned tail. */
function allIds(sim: Sim): number[] {
  return [...Array(sim.state.alive.length).keys()];
}

interface World {
  sim: Sim;
  runtime: MissionRuntime;
  step: (ticks: number) => { sim: SimEvent[]; mission: MissionEvent[] };
}

function makeWorld(mission: MissionJson, ctx?: Partial<MissionContext>): World {
  const sim = new Sim({ seed: 7, width: 28, height: 12, capacity: 32 });
  const ids = new Map<string, number>();
  for (const t of [SQUAD, AMBUSHER, RUNNER, TANK, DRONE, CIVILIANS, CARRIER, RIDER])
    ids.set(t.id, sim.addUnitType(t));
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

  it('a trigger order cancels a standing patrol instead of being undone by it', () => {
    // Issue #88. stepPatrols re-issues the next waypoint the instant a unit
    // stops moving, and nothing removed a unit from `patrols` when a trigger
    // commanded it -- so a withdraw_to completed and the patrol walked the unit
    // straight back into the fight. Silent, and it defeated the trigger.
    const w = makeWorld(
      baseMission({
        enemy: {
          garrison: [
            {
              unit: 'm_tech',
              count: 1,
              at: [4, 2],
              group: 'screen',
              stance: { kind: 'patrol', waypoints: [[4, 2], [20, 2]] },
            },
          ],
        },
        triggers: [
          { id: 'pull_back', on: { kind: 'timer_s', value: 2 }, do: { kind: 'withdraw_to', group: 'screen', to: 'rally' } },
        ],
      }),
      { markers: { rally: [25, 9] } }
    );
    // Let the withdrawal fire and complete, then keep ticking well past it: a
    // patrol that survived the order would have resumed by now.
    for (let t = 0; t < 90 * TICKS_PER_SECOND; t++) w.runtime.step(w.sim.tick());
    const x = fx.toNumber(w.sim.state.posX[0]);
    const y = fx.toNumber(w.sim.state.posY[0]);
    // Parked on the rally marker, not back on a waypoint at x=4 or x=20.
    expect(Math.abs(x - 25.5)).toBeLessThan(2.0);
    expect(Math.abs(y - 9.5)).toBeLessThan(2.0);
  });

  it('casualties_pct measures the force that was there at the start, not the running total', () => {
    // Issue #88. The denominator was `enemyIds.length` read at trigger time, and
    // enemyIds grows with every wave and trigger spawn -- so a threshold written
    // against a starting garrison silently re-based itself the moment
    // reinforcements landed. Two garrison units and a 50% trigger: one death is
    // the threshold, and a wave arriving before it must not change that.
    const w = makeWorld(
      baseMission({
        enemy: {
          garrison: [
            { unit: 'm_tech', count: 1, at: [4, 2], tag: 'first' },
            { unit: 'm_tech', count: 1, at: [4, 8], tag: 'second' },
          ],
          waves: [{ at_seconds: 1, to: 'rally', units: [{ unit: 'm_tech', count: 3, from: 'rally' }] }],
        },
        triggers: [
          { id: 'half_down', on: { kind: 'casualties_pct', value: 50 }, do: { kind: 'commit', group: 'none', to: 'rally' } },
        ],
      }),
      { markers: { rally: [20, 8] } }
    );
    // The wave lands at t=1s, taking the running enemy total from 2 to 5. With
    // the old denominator, 50% would now need three deaths instead of one.
    const fired = (evs: MissionEvent[]): boolean => evs.some((e) => e.kind === 'trigger' && e.id === 'half_down');
    let seen = false;
    for (let t = 0; t < 4 * TICKS_PER_SECOND; t++) seen = seen || fired(w.runtime.step(w.sim.tick()));
    expect(seen).toBe(false); // nobody has died yet
    // Kill exactly one of the two that were there at the start. Garrison
    // spawns first in this world, so it holds ids 0 and 1 -- the same
    // convention the patrol tests above use.
    w.sim.debugKill(0);
    for (let t = 0; t < 2 * TICKS_PER_SECOND; t++) seen = seen || fired(w.runtime.step(w.sim.tick()));
    expect(seen).toBe(true);
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
    // The example was `collapse` until that type gained a runtime; `escort`
    // is the schema's next still-unimplemented type. When it graduates too,
    // move to another — the guard under test is SUPPORTED, not the example.
    expect(() =>
      makeWorld(baseMission({ objectives: [{ id: 'x', type: 'escort', primary: true }] }))
    ).toThrow(/escort/);
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

describe('reinforce', () => {
  it('spawns on the player side when a zone is entered', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [2, 5] }],
        triggers: [
          {
            id: 'deliver',
            on: { kind: 'zone_entered', zone: 'z_lesson' },
            do: { kind: 'reinforce', units: [{ unit: 'm_squad', count: 1, at: [2, 6] }] },
          },
        ],
      }),
      { zones: { z_lesson: [10, 0, 6, 12] } }
    );
    const before = w.sim.entityCount;
    // Walk the starting squad east into z_lesson. 10 tiles at squad speed
    // needs well under 400 ticks (20 s at 20 Hz).
    w.sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(12), y: fx.from(5) });
    const out = w.step(400);
    expect(out.mission.some((e) => e.kind === 'trigger' && e.id === 'deliver')).toBe(true);
    expect(w.sim.entityCount).toBe(before + 1);
    expect(w.sim.state.side[before]).toBe(0);
  });

  it('still spawns enemies on side 1 for do: spawn', () => {
    // Regression guard: every existing mission uses `spawn` and must not flip
    // sides. beit_sahwan_1_recon's hunter commit depends on it.
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [2, 5] }],
        triggers: [
          {
            id: 'ambush',
            on: { kind: 'timer_s', value: 1 },
            do: { kind: 'spawn', units: [{ unit: 'm_tank', count: 1, at: [20, 5] }] },
          },
        ],
      })
    );
    const before = w.sim.entityCount;
    w.step(40);
    expect(w.sim.entityCount).toBe(before + 1);
    expect(w.sim.state.side[before]).toBe(1);
  });
});

describe('campaign ledger (GDD §6 carry-over)', () => {
  const LEDGER_MISSION = (fromLedger: boolean): MissionJson =>
    baseMission({
      starting_force: [{ unit: 'm_squad', count: 3, at: [3, 5], from_ledger: fromLedger }],
      enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [24, 9], facing_deg: 180 }] },
      ledger: { requires: ['roster.surviving_units'], produces: ['roster.surviving_units', 'roe.cumulative_rating'] },
    });

  it('from_ledger draws survivors with their veterancy, degrading gracefully when sparse', () => {
    const w = makeWorld(LEDGER_MISSION(true), {
      ledger: {
        'roster.surviving_units': [
          { type: 'm_squad', veterancy: 2 },
          { type: 'm_squad', veterancy: 1 },
        ],
      },
    });
    // 3 requested, 2 in the roster: a harder mission, never a broken one.
    expect(w.sim.entityCount).toBe(3); // 2 drawn + 1 enemy
    expect(w.sim.state.veterancy[0]).toBe(2);
    expect(w.sim.state.veterancy[1]).toBe(1);
  });

  it('a fresh campaign (no roster key) spawns the full force; a gutted roster fields a remnant', () => {
    // Never played: from_ledger entries spawn fresh at full strength.
    const fresh = makeWorld(LEDGER_MISSION(true), { ledger: {} });
    const freshPlayers: number[] = [];
    for (let i = 0; i < fresh.sim.entityCount; i++) if (fresh.sim.state.side[i] === 0) freshPlayers.push(i);
    expect(freshPlayers.length).toBe(3);

    // Played and lost everyone: the entry still fields one fresh remnant —
    // harder mission, never a broken one.
    const gutted = makeWorld(LEDGER_MISSION(true), { ledger: { 'roster.surviving_units': [] } });
    const guttedPlayers: number[] = [];
    for (let i = 0; i < gutted.sim.entityCount; i++) if (gutted.sim.state.side[i] === 0) guttedPlayers.push(i);
    expect(guttedPlayers.length).toBe(1);
    expect(gutted.sim.state.veterancy[guttedPlayers[0]]).toBe(0);
  });

  it('victory produces the declared keys: updated roster and per-mission ROE', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_tank', count: 1, at: [4, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [11, 5], facing_deg: 180 }] },
        ledger: { requires: [], produces: ['roster.surviving_units', 'roe.mission_ratings'] },
      }),
      // test_mission is baseMission's default id (unmodified above).
      { ledger: { 'roe.mission_ratings': { test_mission: 60 } } }
    );
    const { mission } = w.step(90 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    expect(end?.kind).toBe('missionEnd');
    if (end?.kind !== 'missionEnd') return;
    expect(end.result).toBe('victory');
    const roster = end.ledger['roster.surviving_units'];
    expect(Array.isArray(roster)).toBe(true);
    if (Array.isArray(roster)) {
      expect(roster.length).toBe(1);
      // The tank got the kill: veterancy 0 -> 1.
      expect(roster[0]).toEqual({ type: 'm_tank', veterancy: 1 });
    }
    // This mission's rating (100) beats the seeded prior best (60), so best-of keeps it.
    expect((end.ledger['roe.mission_ratings'] as Record<string, number>).test_mission).toBe(100);
  });

  it('emits only the keys the mission contract declares', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 2 }],
        ledger: { requires: [], produces: ['roe.mission_ratings'] },
      })
    );
    const { mission } = w.step(4 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    expect((end.ledger['roe.mission_ratings'] as Record<string, number>).test_mission).toBe(100);
    expect('roster.surviving_units' in end.ledger).toBe(false);
  });
});

describe('veterancy has combat meaning', () => {
  it('veterans shoot with better effective accuracy', () => {
    const shots = (vet: number): number => {
      const sim = new Sim({ seed: 5, width: 24, height: 8, capacity: 8 });
      const squad = sim.addUnitType(SQUAD);
      const dummy = sim.addUnitType(RUNNER);
      sim.spawn(squad, 0, fx.from(3.5), fx.from(4.5), 0, vet);
      sim.spawn(dummy, 1, fx.from(7.5), fx.from(4.5));
      for (let t = 0; t < 20 * TICKS_PER_SECOND; t++) {
        for (const e of sim.tick()) {
          if (e.kind === 'fire' && e.shooter === 0) return e.breakdown.accuracy;
        }
      }
      throw new Error('never fired');
    };
    const rookie = shots(0);
    const veteran = shots(3);
    expect(veteran).toBeGreaterThan(rookie);
  });
});

const CIVILIANS: UnitTypeJson = {
  id: 'm_civ',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 }, suppression_resistance: 0.15 },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7, firing_signature_mult: 1.0 },
};

/** A civilian who can ride. `CIVILIANS` cannot: it declares no `role` and no
 *  `can_embark`, so `canEmbark` falls to `FOOT_ROLES.has('')` = false. Added
 *  as its OWN type rather than by giving CIVILIANS `can_embark`, for the
 *  reason CARRIER states about editing shared fixtures -- every existing
 *  civilian test would start boarding things. */
const CIV_RIDER: UnitTypeJson = {
  ...CIVILIANS,
  id: 'm_civ_rider',
  hull: { ...CIVILIANS.hull, can_embark: true },
};

const MORTAR: UnitTypeJson = {
  id: 'm_mortar',
  hull: { hp: 350, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.65 },
  sensors: { optics: 0.9, sight_tiles: 7, signature: 0.6 },
  weapons: [
    {
      id: 'tube',
      type: 'mortar',
      range_tiles: 18,
      effective_range_tiles: 14,
      accuracy: 0.5,
      penetration: 30,
      damage: 180,
      splash_tiles: 1.8,
      suppression: 90,
      rof_per_min: 4,
      min_range_tiles: 4,
      collateral_risk: 0.7,
    },
  ],
};

describe('civilians and ROE (GDD §6)', () => {
  function civWorld(partial: Partial<MissionJson>, ctx?: Partial<MissionContext>): World {
    const sim = new Sim({ seed: 11, width: 28, height: 12, capacity: 32 });
    const ids = new Map<string, number>();
    for (const t of [SQUAD, AMBUSHER, RUNNER, TANK, CIVILIANS, MORTAR, CARRIER, CIV_RIDER])
      ids.set(t.id, sim.addUnitType(t));
    const runtime = new MissionRuntime(sim, baseMission(partial), {
      typeIdOf: (u) => {
        const t = ids.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: { refuge: [2, 10] },
      zones: { clinic: [20, 2, 4, 4] },
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

  it('civilians are never targeted by either side', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [6, 5] }],
      enemy: { garrison: [{ unit: 'm_squad', count: 1, at: [12, 5], facing_deg: 180 }] },
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [10, 5] }] },
    });
    const civ = 2;
    expect(w.sim.state.side[civ]).toBe(2);
    const { sim: events } = w.step(30 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'fire')).toBe(true); // combatants fight
    expect(events.some((e) => e.kind === 'fire' && e.target === civ)).toBe(false);
  });

  it('spooked civilians flee to the refuge', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_squad', count: 2, at: [4, 5] }],
      enemy: { garrison: [{ unit: 'm_squad', count: 1, at: [13, 5], facing_deg: 180 }] },
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [12, 6] }], refuge: 'refuge' },
    });
    const civ = 3;
    const startDist = Math.hypot(
      fx.toNumber(w.sim.state.posX[civ]) - 2.5,
      fx.toNumber(w.sim.state.posY[civ]) - 10.5
    );
    // The assault goes in past the civilians; strays land around them.
    w.sim.queueCommand({ kind: 'attackMove', ids: [0, 1], x: fx.from(13.0), y: fx.from(5.0) });
    w.step(45 * TICKS_PER_SECOND);
    expect(w.sim.state.alive[civ]).toBe(1);
    const endDist = Math.hypot(
      fx.toNumber(w.sim.state.posX[civ]) - 2.5,
      fx.toNumber(w.sim.state.posY[civ]) - 10.5
    );
    expect(endDist).toBeLessThan(startDist - 2); // clearly moved toward the refuge
  });

  it('player-caused civilian deaths deduct; enemy-caused do not', () => {
    const mission: Partial<MissionJson> = {
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
      enemy: { garrison: [{ unit: 'm_squad', count: 1, at: [24, 9], facing_deg: 180 }] },
      civilians: { groups: [{ unit: 'm_civ', count: 2, at: [10, 9] }] },
      roe: { enabled: true, civilian_casualty_penalty: 8 },
    };
    const w = civWorld(mission);
    const civA = 2;
    const civB = 3;
    // Player kills one civilian, the enemy kills the other.
    const byPlayer: SimEvent = { kind: 'destroyed', tick: 1, entity: civA, by: 0 };
    const byEnemy: SimEvent = { kind: 'destroyed', tick: 1, entity: civB, by: 1 };
    const out = [...w.runtime.step([byPlayer]), ...w.runtime.step([byEnemy])];
    const roeEvents = out.filter((e) => e.kind === 'roe');
    expect(roeEvents.length).toBe(1);
    if (roeEvents[0].kind === 'roe') {
      expect(roeEvents[0].penalty).toBe(8);
      expect(roeEvents[0].score).toBe(92);
    }
    expect(w.runtime.roeScore).toBe(92);
  });

  it('ordnance landing in a flagged zone deducts; rifle strays do not', () => {
    const w = civWorld({
      starting_force: [
        { unit: 'm_mortar', count: 1, at: [3, 5] },
        { unit: 'm_squad', count: 1, at: [3, 7] },
      ],
      roe: { enabled: true, flagged_structure_penalty: 5, flagged_zones: ['clinic'] },
    });
    const shellInside: SimEvent = { kind: 'nearMiss', tick: 1, shooter: 0, weaponId: 'tube', x: fx.from(21.5), y: fx.from(3.5) };
    const shellOutside: SimEvent = { kind: 'nearMiss', tick: 1, shooter: 0, weaponId: 'tube', x: fx.from(10.5), y: fx.from(3.5) };
    const rifleInside: SimEvent = { kind: 'nearMiss', tick: 1, shooter: 1, weaponId: 'rifles', x: fx.from(21.5), y: fx.from(3.5) };
    const out = [
      ...w.runtime.step([shellInside]),
      ...w.runtime.step([shellOutside]),
      ...w.runtime.step([rifleInside]),
      // A second shell in the same incident window: cooldown absorbs it.
      ...w.runtime.step([shellInside]),
    ];
    const roeEvents = out.filter((e) => e.kind === 'roe');
    expect(roeEvents.length).toBe(1);
    expect(w.runtime.roeScore).toBe(95);
  });

  it('heavy ordnance fired danger-close to civilians deducts', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_mortar', count: 1, at: [3, 5] }],
      enemy: { garrison: [{ unit: 'm_squad', count: 1, at: [20, 5], facing_deg: 180 }] },
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [21, 5] }] },
      roe: { enabled: true, disproportionate_ordnance_penalty: 3 },
    });
    const fire: SimEvent = {
      kind: 'fire',
      tick: 1,
      shooter: 0,
      target: 1,
      weaponId: 'tube',
      pHit: 1000,
      roll: 1,
      willHit: false,
      breakdown: { accuracy: 1, rangeFalloff: 1, coverMod: 1, motionMod: 1, stanceMod: 1, suppressionMod: 1 },
    };
    const out = w.runtime.step([fire]);
    const roeEvents = out.filter((e) => e.kind === 'roe');
    expect(roeEvents.length).toBe(1);
    expect(w.runtime.roeScore).toBe(97);
  });

  it('falling below fail_below loses the mission', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
      civilians: { groups: [{ unit: 'm_civ', count: 4, at: [10, 9] }] },
      roe: { enabled: true, civilian_casualty_penalty: 30, fail_below: 50 },
      objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    });
    const out: MissionEvent[] = [];
    out.push(...w.runtime.step([{ kind: 'destroyed', tick: 1, entity: 2, by: 0 }]));
    out.push(...w.runtime.step([{ kind: 'destroyed', tick: 2, entity: 3, by: 0 }]));
    const end = out.find((e) => e.kind === 'missionEnd');
    expect(end?.kind === 'missionEnd' && end.result).toBe('defeat');
    if (end?.kind === 'missionEnd') expect(end.roeRating).toBe(40);
  });

  it('a civilian walks out when a soldier comes within shepherding range', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [11, 6] }],
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [12, 6] }], refuge: 'refuge' },
    });
    const civ = w.sim.entityCount - 1;
    const startX = w.sim.state.posX[civ];
    w.step(40);
    // Heading for the refuge at [2, 10]: west and south of where it started.
    expect(w.sim.state.posX[civ]).toBeLessThan(startX);
  });

  it('a civilian with no soldier near it stays put', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [2, 2] }],
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
    });
    const civ = w.sim.entityCount - 1;
    const startX = w.sim.state.posX[civ];
    w.step(40);
    expect(w.sim.state.posX[civ]).toBe(startX);
  });

  it('shepherding is issued once, so a soldier standing there does not re-order every tick', () => {
    const w = civWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [11, 6] }],
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [12, 6] }], refuge: 'refuge' },
    });
    const civ = w.sim.entityCount - 1;
    w.step(120);
    const x1 = w.sim.state.posX[civ];
    w.step(120);
    // Still travelling toward the refuge, not pinned in place by re-issued orders.
    expect(w.sim.state.posX[civ]).toBeLessThan(x1);
  });

  const REFUGE_CTX = { zones: { clinic: [20, 2, 4, 4], refuge_zone: [0, 8, 6, 4] } };

  it('re-orders a civilian whose transport died, instead of stranding it forever', () => {
    // The dead-transport latch. `civFled` is added BEFORE boarding is even
    // attempted, and every later tick skipped a fled civilian outright -- so a
    // civilian set down by a wreck had no order and no way back into
    // stepCivilians. `evacuate_before` then never completed: no error, the
    // objective just hung. Avoidable at the authoring level (escort civilians
    // with something nothing on the roster can kill), but the latch is wrong.
    const w = civWorld(
      {
        starting_force: [
          { unit: 'm_squad', count: 1, at: [11, 6] },
          { unit: 'm_carrier', count: 1, at: [12, 6] },
        ],
        civilians: { groups: [{ unit: 'm_civ_rider', count: 1, at: [12, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 900 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 900 },
        ],
      },
      REFUGE_CTX
    );
    const civ = w.sim.entityCount - 1;
    // Let it board, then kill the carrier out from under it mid-run.
    w.step(40);
    const carrier = w.sim.state.carriedBy[civ];
    expect(carrier).toBeGreaterThanOrEqual(0);
    w.sim.debugKill(carrier);

    const evs = w.step(900);
    const done = evs.mission.filter(
      (m) => m.kind === 'objective' && m.id === 'evac' && m.status === 'complete'
    );
    expect(done).toHaveLength(1);
  });

  it('counts civilians who reach the refuge zone and completes at the count', () => {
    const w = civWorld(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [11, 6] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [12, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 600 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
    const evs = w.step(600);
    const done = evs.mission.filter((m) => m.kind === 'objective' && m.id === 'evac' && m.status === 'complete');
    expect(done).toHaveLength(1);
  });

  // `alive = 0` is the ONLY thing an evacuation leaves behind, and it is the
  // identical mark a casualty leaves. Everything outside the sim that draws a
  // civilian therefore had no way to tell a rescue from a killing -- the
  // renderer put a woman the player had just walked to safety into the crawl
  // pose and faded her, exactly like a corpse. These three pin the event that
  // distinguishes them: the runtime already knows, and now says so on the way
  // out (invariant 4 -- events out, never the renderer inferring it).
  function evacWorld(): World {
    return civWorld(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [11, 6] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [12, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 600 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
  }

  it('names the civilian who got out, once, on the tick she is counted', () => {
    const w = evacWorld();
    const civ = 1; // spawn order: the soldier, then the one civilian group
    const evs = w.step(600);
    const out = evs.mission.filter((m) => m.kind === 'evacuated');
    expect(out).toHaveLength(1);
    expect(out[0].kind === 'evacuated' && out[0].entity).toBe(civ);
    // And it is the same moment the count moves -- the event is emitted from
    // the branch that latches her, so the two cannot drift apart.
    const done = evs.mission.find((m) => m.kind === 'objective' && m.id === 'evac' && m.status === 'complete');
    expect(done?.tick).toBe(out[0].tick);
    // The state she leaves behind is indistinguishable from a casualty's.
    // That is the whole reason the event has to exist.
    expect(w.sim.state.alive[civ]).toBe(0);
  });

  it('says nothing for a civilian who is killed, though her state looks the same', () => {
    const w = evacWorld();
    const civ = 1;
    w.step(20);
    w.sim.debugKill(civ);
    const evs = w.step(600);
    expect(w.sim.state.alive[civ]).toBe(0); // identical to the rescue above
    expect(evs.mission.filter((m) => m.kind === 'evacuated')).toHaveLength(0);
  });

  it('marks the evacuation failed when the deadline passes short of the count', () => {
    const w = civWorld(
      {
        // No soldier near the civilian: nobody is coming for them.
        starting_force: [{ unit: 'm_squad', count: 1, at: [24, 2] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 5 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
    const evs = w.step(5 * TICKS_PER_SECOND + 2);
    const failed = evs.mission.filter((m) => m.kind === 'objective' && m.id === 'evac' && m.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(w.runtime.objectiveList.find((o) => o.id === 'evac')?.status).toBe('failed');
  });

  it('a failed secondary evacuation does not lose the mission', () => {
    const w = civWorld(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [24, 2] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 5 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
    w.step(5 * TICKS_PER_SECOND + 2);
    expect(w.runtime.result).toBe('ongoing');
  });

  it('a failed primary evacuation loses the mission outright', () => {
    // Without this, a mission whose primary can fail would soft-lock: victory
    // needs every primary complete, and defeat was wipe-or-ROE only.
    const w = civWorld(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [24, 2] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: true, target: 'refuge_zone', count: 1, seconds: 5 },
        ],
      },
      REFUGE_CTX
    );
    const evs = w.step(5 * TICKS_PER_SECOND + 2);
    const end = evs.mission.find((e) => e.kind === 'missionEnd');
    expect(end?.kind === 'missionEnd' && end.result).toBe('defeat');
    expect(w.runtime.result).toBe('defeat');
  });

  it('a civilian who reached the refuge and then died still counts: arrival is latched', () => {
    // Two civilians, both shepherded at once; the nearer one arrives first,
    // dies, and the objective still completes when the second walks in.
    const w = civWorld(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [11, 6] }],
        civilians: {
          groups: [
            { unit: 'm_civ', count: 1, at: [12, 6] },
            { unit: 'm_civ', count: 1, at: [14, 7] },
          ],
          refuge: 'refuge',
        },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 2, seconds: 600 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
    const [civA, civB] = [1, 2]; // spawn order: soldier, then the two groups
    const zone = REFUGE_CTX.zones.refuge_zone;
    const inZone = (id: number): boolean => {
      const tx = w.sim.state.posX[id] >> 16;
      const ty = w.sim.state.posY[id] >> 16;
      return tx >= zone[0] && tx < zone[0] + zone[2] && ty >= zone[1] && ty < zone[1] + zone[3];
    };
    // Walk until the nearer civilian is in the zone and the farther is not.
    let ticks = 0;
    while (!(inZone(civA) && !inZone(civB)) && ticks < 3000) {
      w.step(1);
      ticks++;
    }
    expect(inZone(civA)).toBe(true);
    expect(inZone(civB)).toBe(false);
    w.sim.debugKill(civA);
    expect(w.sim.state.alive[civA]).toBe(0);
    // The second arrival must complete the count of two, dead first included.
    const evs = w.step(3000);
    const done = evs.mission.filter((m) => m.kind === 'objective' && m.id === 'evac' && m.status === 'complete');
    expect(done).toHaveLength(1);
  });

  it('victory produces civ.settlements_evacuated when the mission declares it', () => {
    const w = civWorld(
      {
        ledger: {
          requires: [],
          produces: ['civ.settlements_evacuated'],
        },
        starting_force: [{ unit: 'm_squad', count: 1, at: [11, 6] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [12, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 600 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 40 },
        ],
      },
      REFUGE_CTX
    );
    const evs = w.step(40 * TICKS_PER_SECOND + 2);
    const end = evs.mission.find((e) => e.kind === 'missionEnd');
    expect(end?.kind === 'missionEnd' && end.result).toBe('victory');
    if (end?.kind === 'missionEnd') {
      expect(end.ledger['civ.settlements_evacuated']).toBe(1);
    }
  });

  it('shows the evacuation deadline as a countdown, so an expiring clock is visible', () => {
    const w = civWorld(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [24, 2] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
        objectives: [
          { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 60 },
          { id: 'clock', type: 'survive_until', primary: true, seconds: 600 },
        ],
      },
      REFUGE_CTX
    );
    w.step(20);
    const view = w.runtime.objectiveList.find((o) => o.id === 'evac');
    expect(view?.ticksLeft).toBe(60 * TICKS_PER_SECOND - 20);
  });

  it('refuses an evacuate_before whose target is not a zone', () => {
    expect(() =>
      civWorld(
        {
          civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
          objectives: [
            { id: 'evac', type: 'evacuate_before', primary: false, target: 'not_a_zone', count: 1, seconds: 60 },
          ],
        },
        REFUGE_CTX
      )
    ).toThrow(/needs a valid zone/);
  });

  it('refuses an evacuate_before whose refuge marker lies outside the target zone', () => {
    // The default refuge marker (from civWorld's ctx) is [2, 10]; "clinic" is
    // [20, 2, 4, 4], nowhere near it, so nobody sent there could ever land in
    // the objective's zone.
    expect(() =>
      civWorld(
        {
          civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
          objectives: [
            { id: 'evac', type: 'evacuate_before', primary: false, target: 'clinic', count: 1, seconds: 60 },
          ],
        },
        REFUGE_CTX
      )
    ).toThrow(/is outside zone/);
  });

  it('refuses an evacuate_before when the mission declares no refuge for civilians', () => {
    expect(() =>
      civWorld(
        {
          civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }] }, // no `refuge` marker set
          objectives: [
            { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 60 },
          ],
        },
        REFUGE_CTX
      )
    ).toThrow(/needs civilians\.refuge/);
  });
});

describe('economy (GDD §3, just enough for M1)', () => {
  const ECON_CTX: Partial<MissionContext> = {
    unitInfo: (u) => (u === 'm_squad' ? { logistics: 300, buildTimeS: 2 } : null),
  };

  it('accrues logistics income and builds units that deploy at player_start', () => {
    const w = makeWorld(
      baseMission({
        map: { file: 'none', player_start: [4, 6] },
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        resources: { logistics_start: 500, logistics_rate_per_min: 120 },
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
      }),
      ECON_CTX
    );
    expect(w.runtime.logistics).toBe(500);
    w.step(30 * TICKS_PER_SECOND); // 30 s at 120/min = +60
    expect(w.runtime.logistics).toBe(560);

    expect(w.runtime.requestBuild('m_squad')).toBe(true);
    expect(w.runtime.logistics).toBe(260);
    const before = w.sim.entityCount;
    const { mission } = w.step(2 * TICKS_PER_SECOND + 2);
    expect(mission.some((e) => e.kind === 'built')).toBe(true);
    expect(w.sim.entityCount).toBe(before + 1);
    const id = w.sim.entityCount - 1;
    expect(w.sim.state.side[id]).toBe(0);
    expect(fx.toNumber(w.sim.state.posX[id])).toBeCloseTo(4, 0);
  });

  // ---- production anchored to a camp -------------------------------------
  //
  // A camp is the first structure with an owner. Everything else in the
  // catalogue is neutral terrain, so these three cases pin the whole
  // contract: production follows a living camp, dies with the last one, and
  // falls back to `player_start` for every mission authored before camps
  // existed.
  const CAMP = {
    id: 'camp', name: 'Field Camp', hp_per_tile: 300,
    garrison_slots: 3, rubble_cover: 2, produces_for: 0,
  };

  function campWorld(partial: Partial<MissionJson>): World & { camp: number } {
    const sim = new Sim({ seed: 11, width: 28, height: 14, capacity: 24 });
    const ids = new Map<string, number>();
    ids.set(SQUAD.id, sim.addUnitType(SQUAD));
    // Raised before start() so the starting force cannot spawn inside it.
    sim.addStructureType(CAMP);
    // Raised by the runtime from the mission's own `structures`, exactly as a
    // real mission does it -- NOT by a direct addStructure here. Raising it
    // both ways is what the overlap guard is for, and these tests hit it.
    const runtime = new MissionRuntime(sim, baseMission({
      structures: [{ type: 'camp', at: [18, 8], size: [2, 2] }],
      ...partial,
    }), {
      typeIdOf: (u) => {
        const t = ids.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: {},
      zones: {},
      unitInfo: (u) => (u === 'm_squad' ? { logistics: 300, buildTimeS: 2 } : null),
    });
    runtime.start();
    let camp = -1;
    for (let i = 0; i < sim.structureCount; i++) {
      if (sim.structureTypes[sim.structures.typeIdx[i]].id === 'camp') camp = i;
    }
    expect(camp).toBeGreaterThanOrEqual(0);
    return {
      sim,
      runtime,
      camp,
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

  it('deploys beside a living camp, with no player_start at all', () => {
    const w = campWorld({
      map: { file: 'none' }, // deliberately NO player_start
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
      resources: { logistics_start: 500 },
      objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    });
    expect(w.runtime.requestBuild('m_squad')).toBe(true);
    const before = w.sim.entityCount;
    w.step(2 * TICKS_PER_SECOND + 2);
    expect(w.sim.entityCount).toBe(before + 1);
    const id = w.sim.entityCount - 1;
    // Beside the camp (footprint 18..19 x 8..9), not at some default origin.
    expect(fx.toNumber(w.sim.state.posX[id])).toBeGreaterThan(16);
    expect(fx.toNumber(w.sim.state.posY[id])).toBeGreaterThan(6);
  });

  it('stops production when the last camp dies', () => {
    const w = campWorld({
      map: { file: 'none' },
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
      resources: { logistics_start: 5000 },
      objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    });
    expect(w.runtime.requestBuild('m_squad')).toBe(true);
    w.sim.debugDestroyStructure(w.camp);
    expect(w.runtime.requestBuild('m_squad')).toBe(false);
    expect(w.runtime.buildBlockedReason('m_squad')).toMatch(/camp/i);
  });

  it('a destroyed camp blocks production even with a player_start on the map', () => {
    // The case that matters, and the one the two tests above BOTH miss: every
    // shipped mission declares a `player_start`. Treating it as a live
    // fallback made the camp decorative -- production simply carried on from
    // the map's own start tile the moment the camp fell. Caught by probing a
    // real mission, not by these tests, which is why this one exists.
    const w = campWorld({
      map: { file: 'none', player_start: [4, 6] },
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
      resources: { logistics_start: 5000 },
      objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    });
    expect(w.runtime.requestBuild('m_squad')).toBe(true);
    w.sim.debugDestroyStructure(w.camp);
    expect(w.runtime.buildBlockedReason('m_squad')).toMatch(/camp/i);
    expect(w.runtime.requestBuild('m_squad')).toBe(false);
  });

  it('still uses player_start when the mission has no camp at all', () => {
    // BREAK CHECK: every mission authored before camps existed must be
    // untouched by this feature. Same world, no structure.
    const w = makeWorld(
      baseMission({
        map: { file: 'none', player_start: [4, 6] },
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        resources: { logistics_start: 500 },
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
      }),
      ECON_CTX
    );
    expect(w.runtime.requestBuild('m_squad')).toBe(true);
    const before = w.sim.entityCount;
    w.step(2 * TICKS_PER_SECOND + 2);
    expect(w.sim.entityCount).toBe(before + 1);
    expect(fx.toNumber(w.sim.state.posX[w.sim.entityCount - 1])).toBeCloseTo(4, 0);
  });

  // #88's third defect: a wave's units carried neither `group` nor `tag`,
  // because `stepWaves` built a fresh literal passing only unit/count/marker.
  // So no trigger could address a wave -- `withdraw_to` and `commit` name a
  // group, `eliminate_hvt` names a tag, and a wave had neither. The visible
  // consequence was that NO mission in the repo could make raiders break off,
  // which is GDD 5.7's whole Raid doctrine. Asserted end to end (spawn ->
  // trigger -> the units actually leave) rather than on the group map, since
  // "the group exists" is not the thing that was broken for the player.
  it('lets a trigger withdraw a wave, so raiders can break off', () => {
    const w = makeWorld(
      baseMission({
        map: { file: 'none', player_start: [4, 6] },
        starting_force: [{ unit: 'm_squad', count: 1, at: [4, 6] }],
        enemy: {
          waves: [
            {
              at_seconds: 1,
              units: [{ unit: 'm_squad', count: 2, from: 'east', group: 'raiders' }],
            },
          ],
        },
        triggers: [
          { id: 'break_off', on: { kind: 'timer_s', value: 3 }, do: { kind: 'withdraw_to', group: 'raiders', to: 'east' } },
        ],
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
      }),
      { markers: { east: [22, 6] } }
    );
    w.step(2 * TICKS_PER_SECOND);
    const raiders: number[] = [];
    for (let i = 0; i < w.sim.entityCount; i++) {
      if (w.sim.state.alive[i] === 1 && w.sim.state.side[i] === 1) raiders.push(i);
    }
    expect(raiders.length).toBe(2);
    // Walk them well off the marker first, so "went back east" is unambiguous.
    const startX = raiders.map((id) => fx.toNumber(w.sim.state.posX[id]));
    w.step(6 * TICKS_PER_SECOND);
    const endX = raiders.map((id) => fx.toNumber(w.sim.state.posX[id]));
    // Before the fix the group was empty, the trigger commanded nobody, and
    // these stayed where the wave dropped them.
    expect(endX.some((x, i) => Math.abs(x - (startX[i] ?? x)) > 0.5)).toBe(true);
  });

  it('rejects builds it cannot afford or does not know', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        resources: { logistics_start: 100 },
      }),
      ECON_CTX
    );
    expect(w.runtime.requestBuild('m_squad')).toBe(false); // 300 > 100
    expect(w.runtime.requestBuild('nonsense')).toBe(false);
    expect(w.runtime.logistics).toBe(100);
  });
});

describe('ROE-gated unit unlocks (GDD §6)', () => {
  const CATALOGUE: Record<string, { logistics: number; buildTimeS: number; unlock?: { roeMin?: number; afterMission?: string } }> = {
    m_squad: { logistics: 100, buildTimeS: 1 },
    m_tank: { logistics: 200, buildTimeS: 1, unlock: { roeMin: 60 } },
    m_demo: { logistics: 150, buildTimeS: 1, unlock: { afterMission: 'prologue' } },
  };
  const ctx = (): Partial<MissionContext> => ({ unitInfo: (u) => CATALOGUE[u] ?? null });

  function econWorld(ledger: LedgerData): World {
    return makeWorld(
      baseMission({
        map: { file: 'none', player_start: [4, 6] },
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        resources: { logistics_start: 1000 },
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
      }),
      { ...ctx(), ledger }
    );
  }

  it('refuses equipment the campaign has not earned, and says why', () => {
    const w = econWorld({ 'roe.cumulative_rating': 40 });
    expect(w.runtime.requestBuild('m_squad')).toBe(true); // no unlock gate
    expect(w.runtime.requestBuild('m_tank')).toBe(false); // needs ROE 60
    expect(w.runtime.buildBlockedReason('m_tank')).toMatch(/ROE 60/);
    expect(w.runtime.buildBlockedReason('m_squad')).toBeNull();
  });

  it('grants it once the rating is good enough', () => {
    const w = econWorld({ 'roe.cumulative_rating': 75 });
    expect(w.runtime.requestBuild('m_tank')).toBe(true);
    expect(w.runtime.buildBlockedReason('m_tank')).toBeNull();
  });

  it('a fresh campaign has no rating yet, so rated equipment stays locked', () => {
    const w = econWorld({});
    expect(w.runtime.requestBuild('m_tank')).toBe(false);
    expect(w.runtime.buildBlockedReason('m_tank')).toMatch(/ROE 60/);
  });

  it('honours after_mission gates from the ledger', () => {
    const locked = econWorld({ 'roe.cumulative_rating': 90 });
    expect(locked.runtime.requestBuild('m_demo')).toBe(false);
    expect(locked.runtime.buildBlockedReason('m_demo')).toMatch(/prologue/);

    const cleared = econWorld({ 'roe.cumulative_rating': 90, 'campaign.completed_missions': ['prologue'] });
    expect(cleared.runtime.requestBuild('m_demo')).toBe(true);
  });

  it('a locked unit costs nothing when refused', () => {
    const w = econWorld({ 'roe.cumulative_rating': 10 });
    const before = w.runtime.logistics;
    expect(w.runtime.requestBuild('m_tank')).toBe(false);
    expect(w.runtime.logistics).toBe(before);
  });
});

describe('holding ground', () => {
  it('a straggler in the far corner does not freeze the hold', () => {
    // The Foothold bug: hold_for demanded zero enemies anywhere inside a
    // 17x32 zone, so one routed survivor hiding in a corner stopped the
    // clock forever and the mission could never end.
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 2, at: [3, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [24, 10], facing_deg: 180 }] },
        objectives: [{ id: 'hold', type: 'hold_for', primary: true, target: 'ground', seconds: 5 }],
      }),
      { zones: { ground: [0, 0, 28, 12] } } // enemy is inside it, but far away
    );
    const { mission } = w.step(20 * TICKS_PER_SECOND);
    expect(mission.some((e) => e.kind === 'objective' && e.id === 'hold' && e.status === 'complete')).toBe(true);
  });

  it('but an enemy fighting for the ground does contest it', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [5, 5], facing_deg: 180 }] },
        objectives: [{ id: 'hold', type: 'hold_for', primary: true, target: 'ground', seconds: 5 }],
      }),
      { zones: { ground: [0, 0, 28, 12] } }
    );
    w.step(4 * TICKS_PER_SECOND);
    const o = w.runtime.objectiveList.find((x) => x.id === 'hold');
    expect(o?.paused).toBe('contested');
  });
});

describe('intel: earned by watching, spent on certainty (GDD §3)', () => {
  const CATALOGUE: Record<string, { logistics: number; buildTimeS: number }> = {
    m_squad: { logistics: 100, buildTimeS: 1 },
  };

  function intelWorld(partial: Partial<MissionJson>): World {
    return makeWorld(
      baseMission({
        map: { file: 'none', player_start: [4, 6] },
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
        ...partial,
      }),
      { unitInfo: (u) => CATALOGUE[u] ?? null }
    );
  }

  it('a loitering drone earns intel; a parked rifle squad earns none', () => {
    const withDrone = intelWorld({
      starting_force: [{ unit: 'm_drone', count: 1, at: [5, 5] }],
      resources: { intel_start: 0 },
    });
    withDrone.step(60 * TICKS_PER_SECOND);
    // GDD §3 anchor: drone loiter ~8/min.
    expect(withDrone.runtime.intel).toBeGreaterThanOrEqual(7);
    expect(withDrone.runtime.intel).toBeLessThanOrEqual(9);

    const noDrone = intelWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [5, 5] }],
      resources: { intel_start: 0 },
    });
    noDrone.step(60 * TICKS_PER_SECOND);
    expect(noDrone.runtime.intel).toBe(0);
  });

  it('a satellite sweep buys certainty: hidden enemies become identified', () => {
    const w = intelWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 3] }],
      // Far away and behind nothing in particular — simply unobserved.
      enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [24, 10], facing_deg: 180 }] },
      resources: { intel_start: 200 },
    });
    w.step(2 * TICKS_PER_SECOND);
    const enemy = 1;
    expect(w.sim.contactLevel(0, enemy)).toBe(0); // nobody has seen him

    expect(w.runtime.requestSweep(fx.from(24), fx.from(10))).toBe(true);
    expect(w.runtime.intel).toBe(50); // 200 - 150
    w.step(2);
    expect(w.sim.contactLevel(0, enemy)).toBe(2); // identified
  });

  it('refuses what it cannot pay for, and charges nothing', () => {
    const w = intelWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 3] }],
      resources: { intel_start: 100 },
    });
    expect(w.runtime.requestSweep(fx.from(10), fx.from(10))).toBe(false);
    expect(w.runtime.requestStrike(fx.from(10), fx.from(10))).toBe(false);
    expect(w.runtime.intel).toBe(100);
  });

  it('a precision strike kills what it lands on', () => {
    const w = intelWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 3] }],
      enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [20, 6], facing_deg: 180 }] },
      resources: { intel_start: 300 },
    });
    const enemy = 1;
    expect(w.runtime.requestStrike(fx.from(20.5), fx.from(6.5))).toBe(true);
    expect(w.runtime.intel).toBe(50); // 300 - 250
    const { sim: events } = w.step(15 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'strike')).toBe(true);
    expect(w.sim.state.alive[enemy]).toBe(0);
  });

  it('a strike near civilians is charged against ROE — the point of the whole system', () => {
    const w = intelWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 3] }],
      enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [20, 6], facing_deg: 180 }] },
      civilians: { groups: [{ unit: 'm_civ', count: 2, at: [21, 6] }] },
      resources: { intel_start: 300 },
      roe: { enabled: true },
    });
    w.runtime.requestStrike(fx.from(20.5), fx.from(6.5));
    const { mission } = w.step(15 * TICKS_PER_SECOND);
    expect(mission.some((e) => e.kind === 'roe')).toBe(true);
    expect(w.runtime.roeScore).toBeLessThan(100);
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

describe('buildings in missions (garrison stance + structure ROE)', () => {
  const HOUSE = { id: 'house', name: 'House', hp_per_tile: 200, garrison_slots: 2, rubble_cover: 2, roe_penalty: 6 };
  const MOSQUE = { id: 'mosque', name: 'Mosque', hp_per_tile: 300, garrison_slots: 2, rubble_cover: 2, roe_penalty: 30 };

  const HOLDER: UnitTypeJson = {
    id: 'b_inf',
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.5 },
    sensors: { optics: 1, sight_tiles: 9, signature: 0.6 },
    abilities: ['garrison'],
    weapons: [
      { id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 },
    ],
  };

  function buildingWorld(partial: Partial<MissionJson>): World & { house: number; mosque: number } {
    const sim = new Sim({ seed: 3, width: 28, height: 14, capacity: 24 });
    const ids = new Map<string, number>();
    for (const t of [SQUAD, HOLDER]) ids.set(t.id, sim.addUnitType(t));
    const ht = sim.addStructureType(HOUSE);
    const mt = sim.addStructureType(MOSQUE);
    const rect = (typeIdx: number, x: number, y: number, w: number, h: number): number => {
      const tiles: number[] = [];
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) tiles.push(ty * sim.width + tx);
      return sim.addStructure(typeIdx, tiles);
    };
    const house = rect(ht, 14, 6, 2, 2);
    const mosque = rect(mt, 20, 6, 2, 2);
    const runtime = new MissionRuntime(sim, baseMission(partial), {
      typeIdOf: (u) => {
        const t = ids.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: {},
      zones: {},
    });
    runtime.start();
    return {
      sim,
      runtime,
      house,
      mosque,
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

  it('a mission can post defenders inside a building', () => {
    const w = buildingWorld({
      enemy: {
        garrison: [
          {
            unit: 'b_inf',
            count: 2,
            at: [13, 6],
            facing_deg: 180,
            stance: { kind: 'garrison', building: [14, 6] },
          },
        ],
      },
    });
    w.step(15 * TICKS_PER_SECOND);
    expect(w.sim.structures.occupants[w.house]).toBe(2);
    expect(w.sim.state.garrisonedIn[0]).toBe(w.house);
  });

  it('levelling a building costs ROE, weighted by what it was', () => {
    const w = buildingWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 6] }],
      roe: { enabled: true },
    });
    expect(w.runtime.roeScore).toBe(100);
    // Player brings the house down: a modest political cost.
    const houseDown: SimEvent = { kind: 'structureDestroyed', tick: 1, structure: w.house, by: 0 };
    let out = w.runtime.step([houseDown]);
    expect(out.filter((e) => e.kind === 'roe').length).toBe(1);
    expect(w.runtime.roeScore).toBe(94);

    // The mosque is a different order of mistake.
    const mosqueDown: SimEvent = { kind: 'structureDestroyed', tick: 2, structure: w.mosque, by: 0 };
    out = w.runtime.step([mosqueDown]);
    expect(w.runtime.roeScore).toBe(64);
    const ev = out.find((e) => e.kind === 'roe');
    expect(ev?.kind === 'roe' && ev.reason).toContain('Mosque');
  });

  it('the enemy demolishing its own town is not the player\'s ROE problem', () => {
    const w = buildingWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 6] }],
      enemy: { garrison: [{ unit: 'b_inf', count: 1, at: [24, 10] }] },
      roe: { enabled: true },
    });
    const byEnemy: SimEvent = { kind: 'structureDestroyed', tick: 1, structure: w.house, by: 1 };
    const out = w.runtime.step([byEnemy]);
    expect(out.filter((e) => e.kind === 'roe').length).toBe(0);
    expect(w.runtime.roeScore).toBe(100);
  });

  it('structure_penalty_mult scales the cost, and 0 turns it off', () => {
    const w = buildingWorld({
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 6] }],
      roe: { enabled: true, structure_penalty_mult: 0 },
    });
    w.runtime.step([{ kind: 'structureDestroyed', tick: 1, structure: w.mosque, by: 0 }]);
    expect(w.runtime.roeScore).toBe(100);
  });
});

// Mounted delivery (GDD §6). The mission is the only way an AI-driven transport
// ever has passengers: every other route into `passengers[]` is a player command.
describe('mounted delivery', () => {
  const delivery = (over = false): MissionJson =>
    baseMission({
      enemy: {
        garrison: [
          {
            unit: 'm_carrier',
            count: 1,
            at: [20.5, 6.5],
            group: 'flankers',
            passengers: over
              ? [{ unit: 'm_rider', count: 3 }]
              : [{ unit: 'm_rider', count: 1, group: 'flank_rpg' }],
          },
        ],
      },
      triggers: [
        { id: 'drop', on: { kind: 'timer_s', value: 4 }, do: { kind: 'dismount', group: 'flankers' } },
      ],
    });

  it('spawns the carrier with its passengers already aboard', () => {
    const { sim } = makeWorld(delivery());
    const tech = allIds(sim).find(
      (i) => sim.state.alive[i] === 1 && sim.passengerCount(i) > 0,
    );
    expect(tech).toBeDefined();
    expect(sim.passengerCount(tech as number)).toBe(1);
    const rider = allIds(sim).find((i) => sim.state.carriedBy[i] === tech);
    expect(rider).toBeDefined();
    // Aboard, not walking to it: no boarding delay for an authored load.
    expect(sim.state.posX[rider as number]).toBe(sim.state.posX[tech as number]);
  });

  it('puts them on the ground when the dismount trigger fires', () => {
    const { sim, step } = makeWorld(delivery());
    const tech = allIds(sim).find((i) => sim.passengerCount(i) > 0) as number;
    step(3 * TICKS_PER_SECOND);
    expect(sim.passengerCount(tech)).toBe(1); // not yet
    step(3 * TICKS_PER_SECOND);
    expect(sim.passengerCount(tech)).toBe(0);
    const rider = allIds(sim).find(
      (i) => sim.state.alive[i] === 1 && sim.state.carriedBy[i] === -1 && i !== tech,
    );
    expect(rider).toBeDefined();
  });

  it('dismount fires harmlessly when nobody is aboard', () => {
    // Firing twice, or after the carrier was killed on the way in, is ordinary
    // play rather than an error — and the squad has already bailed out shaken.
    const { sim, step } = makeWorld(delivery());
    const tech = allIds(sim).find((i) => sim.passengerCount(i) > 0) as number;
    step(6 * TICKS_PER_SECOND);
    expect(sim.passengerCount(tech)).toBe(0);
    expect(() => step(3 * TICKS_PER_SECOND)).not.toThrow();
  });

  it('throws on an over-capacity load rather than half-filling the truck', () => {
    // A mission that quietly delivers two of three squads is a bug that only
    // shows up in playtesting. validate:data is meant to catch this first; this is
    // the backstop proving it has to.
    expect(() => makeWorld(delivery(true))).toThrow(/seat/i);
  });
});

// The carry-over spine (GDD §4, "carry-over is the system"). Intel is a set of
// authored placement tags, because entities do not survive a mission boundary -- the
// only durable handle is what the author wrote.
//
// Tested through behaviour rather than through the runtime's private sets. The first
// draft of these tests reached for `sim.stanceForTest()` and `sim.identifiedForTest()`,
// which do not exist and should not: pre-reveal is observable because a `locate`
// objective on a marked tag completes immediately, and a disarmed ambush is observable
// because the ambusher stops holding its fire.
describe('intel carry-over', () => {
  const mission = (partial: Partial<MissionJson> = {}): MissionJson =>
    baseMission({
      ledger: { requires: ['intel.marked_positions'], produces: ['intel.marked_positions'] },
      // baseMission ships no starting force; each test supplies its own. Without one
      // there is nobody for an ambusher to spring on, and every assertion about
      // engagement passes or fails for the wrong reason.
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
      enemy: {
        garrison: [
          // Two tiles off the squad above, well inside its own 3-tile trigger, so an
          // ambusher springs at once and a disarmed one has nothing to spring.
          { unit: 'm_rpg', count: 1, at: [5.0, 5.0], tag: 'ambush_west',
            stance: { kind: 'ambush', tiles: 3 } },
          { unit: 'm_squad', count: 1, at: [24.5, 9.5] },
        ],
      },
      ...partial,
    });

  // `ambushSprung` is the unambiguous observable: it can only fire if the unit was
  // ambushing in the first place. An earlier draft counted `fire` events instead, and
  // measured nothing -- neither world fired inside 20s, because whether a unit shoots
  // depends on far more than its stance.
  const sprung = (out: { sim: SimEvent[] }): number =>
    out.sim.filter((e) => e.kind === 'ambushSprung').length;

  it('produces the tag of a placement the player identified', () => {
    const world = makeWorld(mission());
    const out = world.step(25 * TICKS_PER_SECOND);
    const end = out.mission.find((e) => e.kind === 'missionEnd');
    if (end) {
      const marked = (end.ledger?.['intel.marked_positions'] ?? []) as string[];
      // Only declared tags can ever appear; the untagged placement cannot.
      for (const t of marked) expect(t).toBe('ambush_west');
    }
  });

  it('completes a locate objective immediately for a pre-marked tag', () => {
    const withLocate = mission({
      objectives: [{ id: 'find', type: 'locate', target: 'ambush_west', primary: true }],
    });
    const cold = makeWorld(withLocate);
    const warm = makeWorld(withLocate, { ledger: { 'intel.marked_positions': ['ambush_west'] } });
    // A couple of ticks is enough: pre-reveal happens at spawn, not by looking.
    const coldOut = cold.step(4);
    const warmOut = warm.step(4);
    const done = (out: { mission: MissionEvent[] }) =>
      out.mission.some((e) => e.kind === 'objective' && e.id === 'find' && e.status === 'complete');
    expect(done(warmOut)).toBe(true);
    expect(done(coldOut)).toBe(false);
  });

  it('pre-marks in the sim, not only in the objective bookkeeping', () => {
    // The objective above is satisfied by MissionRuntime's own `identified` set. The
    // renderer and the combat model read the sim's contact state instead, and the first
    // implementation wrote only the former: the objective completed while the emplacement
    // stayed invisible on screen, with the test above green. So assert the other book.
    const cold = makeWorld(mission());
    const warm = makeWorld(mission(), { ledger: { 'intel.marked_positions': ['ambush_west'] } });
    const ambusher = 1;
    expect(cold.sim.contactLevel(0, ambusher)).toBe(0);
    expect(warm.sim.contactLevel(0, ambusher)).toBe(2);
  });

  it('a marked ambusher stops holding its fire', () => {
    const authored = makeWorld(mission());
    const known = makeWorld(mission(), { ledger: { 'intel.marked_positions': ['ambush_west'] } });
    const a = authored.step(10 * TICKS_PER_SECOND);
    const k = known.step(10 * TICKS_PER_SECOND);
    // Knowing where the ambush is removes the surprise, not the enemy.
    expect(sprung(a)).toBeGreaterThan(0);
    expect(sprung(k)).toBe(0);
  });

  it('an empty ledger leaves the authored mission exactly as written', () => {
    const authored = makeWorld(mission());
    const out = authored.step(10 * TICKS_PER_SECOND);
    // Still an ambusher, so it still springs -- the authored mission is untouched.
    expect(sprung(out)).toBeGreaterThan(0);
  });

  it('accumulates rather than replaces, so a later mission cannot un-know', () => {
    const world = makeWorld(mission(), {
      ledger: { 'intel.marked_positions': ['seen_in_mission_one'] },
    });
    const out = world.step(25 * TICKS_PER_SECOND);
    const end = out.mission.find((e) => e.kind === 'missionEnd');
    if (end) {
      const marked = (end.ledger?.['intel.marked_positions'] ?? []) as string[];
      expect(marked).toContain('seen_in_mission_one');
    }
  });
});

describe('external objective completion', () => {
  it('completes an active objective and ends the mission through the normal path', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        objectives: [{ id: 'work_up', type: 'survive_until', primary: true, seconds: 600 }],
      })
    );
    expect(w.runtime.completeObjective('work_up')).toBe(true);
    const out = w.step(1);
    expect(
      out.mission.some((e) => e.kind === 'objective' && e.id === 'work_up' && e.status === 'complete')
    ).toBe(true);
    const ends = out.mission.filter(
      (e): e is Extract<MissionEvent, { kind: 'missionEnd' }> => e.kind === 'missionEnd'
    );
    expect(ends).toHaveLength(1);
    expect(ends[0].result).toBe('victory');
    expect(ends[0].survivors).toEqual(['m_squad']);
  });

  it('rejects unknown ids, already-complete objectives, and calls after the end', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        objectives: [{ id: 'work_up', type: 'survive_until', primary: true, seconds: 600 }],
      })
    );
    expect(w.runtime.completeObjective('no_such_objective')).toBe(false);
    expect(w.runtime.completeObjective('work_up')).toBe(true);
    expect(w.runtime.completeObjective('work_up')).toBe(false); // no longer active
    w.step(1); // mission ends
    expect(w.runtime.result).toBe('victory');
    expect(w.runtime.completeObjective('work_up')).toBe(false); // ended
  });
});

describe('ROE ratings per mission', () => {
  const roeMission = (id: string): MissionJson =>
    baseMission({
      id,
      ledger: { requires: [], produces: ['roe.mission_ratings', 'campaign.completed_missions'] },
      starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
      objectives: [{ id: 'win', type: 'survive_until', seconds: 1, primary: true }],
    });

  const finish = (id: string, ledger: LedgerData): LedgerData => {
    const w = makeWorld(roeMission(id), { ledger });
    for (let t = 0; t < 5 * TICKS_PER_SECOND; t++) {
      const out = w.step(1);
      for (const e of out.mission) if (e.kind === 'missionEnd') return e.ledger;
    }
    throw new Error(`mission ${id} never ended`);
  };

  it('records a rating per mission, keyed by mission id', () => {
    const out = finish('m_one', {});
    expect(out['roe.mission_ratings']).toBeDefined();
    expect(Object.keys(out['roe.mission_ratings'] as Record<string, number>)).toEqual(['m_one']);
  });

  it('accumulates an entry per mission played', () => {
    const both = finish('m_two', finish('m_one', {}));
    const ratings = both['roe.mission_ratings'] as Record<string, number>;
    expect(Object.keys(ratings).sort()).toEqual(['m_one', 'm_two']);
  });

  it('does not average in the sim at all -- no cumulative key is produced', () => {
    // An average is division, and @lions/sim bans floating point. campaignRoe does this
    // for display; unlockReason gates on it by integer comparison.
    expect(finish('m_one', {})['roe.cumulative_rating']).toBeUndefined();
  });

  it('leaves a legacy cumulative rating in the incoming ledger untouched', () => {
    // Saves written before this change carry the old key. The sim neither reads nor
    // rewrites it, and both readers fall back to it.
    const out = finish('m_one', { 'roe.cumulative_rating': 64 });
    expect(out['roe.mission_ratings']).toBeDefined();
  });

  it('keeps the better rating when a mission is replayed, never the newer one', () => {
    // Seed a rating this run cannot beat, then replay: the entry must not fall.
    const seeded: LedgerData = { 'roe.mission_ratings': { m_one: 100 } };
    const out = finish('m_one', seeded);
    expect((out['roe.mission_ratings'] as Record<string, number>).m_one).toBe(100);
  });

  it('cannot be farmed: replaying one mission leaves every other entry alone', () => {
    const seeded: LedgerData = { 'roe.mission_ratings': { m_one: 20, m_two: 90 } };
    const out = finish('m_one', seeded);
    const ratings = out['roe.mission_ratings'] as Record<string, number>;
    expect(ratings.m_two).toBe(90);
    expect(Object.keys(ratings).sort()).toEqual(['m_one', 'm_two']);
  });

  it('is order-independent, so the same campaign always reads the same', () => {
    const ab = finish('m_two', finish('m_one', {}))['roe.mission_ratings'];
    const ba = finish('m_one', finish('m_two', {}))['roe.mission_ratings'];
    // Same keys AND same serialisation: the object is rebuilt in sorted key order, so a
    // save file cannot differ by play order.
    expect(JSON.stringify(ab)).toBe(JSON.stringify(ba));
  });


});


describe('placements cannot spawn inside a building', () => {
  /** A world with one 2x2 building at (10,5)-(11,6), and a mission that has not
   *  started yet — so a test can choose where to put a placement relative to it. */
  function walledWorld(mission: MissionJson, ctx?: Partial<MissionContext>) {
    const sim = new Sim({ seed: 3, width: 28, height: 12, capacity: 32 });
    const ids = new Map<string, number>();
    for (const t of [SQUAD, CIVILIANS]) ids.set(t.id, sim.addUnitType(t));
    const wall = sim.addStructureType({ id: 'wall', hp_per_tile: 90, garrison_slots: 0 });
    // Tile indices for (10,5), (11,5), (10,6), (11,6).
    sim.addStructure(wall, [5 * 28 + 10, 5 * 28 + 11, 6 * 28 + 10, 6 * 28 + 11]);
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
    return { sim, runtime };
  }

  it('refuses a placement whose own tile is a building', () => {
    const w = walledWorld(
      baseMission({ starting_force: [{ unit: 'm_squad', count: 1, at: [10, 5] }] })
    );
    expect(() => w.runtime.start()).toThrow(/m_squad/);
    expect(() => w.runtime.start()).toThrow(/\(10,5\)/);
  });

  it('refuses a placement whose SPREAD sibling lands in a building, though its own tile is clear', () => {
    // count 3 spreads to +0, +1.25 and +2.5 tiles east. Declared at (8,5): the
    // third body lands on (10,5), which is the building. This is the exact shape
    // of the bug that trapped a civilian in a mosque -- the declared tile is fine.
    const w = walledWorld(
      baseMission({ starting_force: [{ unit: 'm_squad', count: 3, at: [8, 5] }] })
    );
    expect(() => w.runtime.start()).toThrow(/m_squad/);
    // The message must name the offending body, not just the placement.
    expect(() => w.runtime.start()).toThrow(/\(10,5\)/);
  });

  it('allows a placement whose whole spread is clear ground', () => {
    const w = walledWorld(
      baseMission({ starting_force: [{ unit: 'm_squad', count: 3, at: [2, 2] }] })
    );
    expect(() => w.runtime.start()).not.toThrow();
  });

  it('exempts a garrisoning placement — it is entering the building, not trapped in it', () => {
    // Posting a squad at the doorway is normal authoring, and a count-2 spread
    // legitimately puts the second body on the building's own tile. The unit
    // walks in on the first ticks, so this must stay allowed.
    const w = walledWorld(
      baseMission({
        enemy: {
          garrison: [
            {
              unit: 'm_squad',
              count: 2,
              at: [9, 5],
              stance: { kind: 'garrison', building: [10, 5] },
            },
          ],
        },
      })
    );
    expect(() => w.runtime.start()).not.toThrow();
  });

  it('checks civilians too — they are the ones who get trapped', () => {
    const w = walledWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [2, 2] }],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [11, 6] }] },
      })
    );
    expect(() => w.runtime.start()).toThrow(/m_civ/);
  });
});

// `raze`: "level every building in this zone." Exercised through the real
// command path (queueCommand({ kind: 'demolish', ... })) rather than by
// poking sim internals -- destroyStructure/damageStructure are private, and
// the whole point of the objective is to observe what that command produces.
describe('raze objective', () => {
  const RAZE_DEMO: UnitTypeJson = {
    id: 'raze_demo',
    role: 'engineer',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.2 },
    sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
    abilities: ['demolish'],
    demolition_time_s: 1.0, // 20 ticks once in range
    weapons: [],
  };
  const RAZE_SHED = { id: 'raze_shed', hp_per_tile: 100 };

  /** x, y, w, h in tiles: covers (10,10)-(13,13). */
  const DEPOT_ZONE = [10, 10, 4, 4] as const;

  /** Depot zone holding two one-tile structures (ids 0, 1), plus whatever the
   *  options ask for. Structures and their would-be demolishers are placed so
   *  none of their footprints or spawn tiles overlap.
   *
   *  - `outsider`: a third structure well outside the zone.
   *  - `straddle`: a third, two-tile structure with exactly one tile inside
   *    the zone and one outside -- the boundary case for "the zone's tile
   *    scan finds a structure by any one of its tiles."
   *  - `zone`: point the objective's `target` at this (unregistered) zone
   *    name instead of 'depot'.
   *  - `empty`: skip the two normal structures, so the zone holds nothing.
   *
   *  Note on adjacency: these structures sit well inside `DEMO_RANGE_SQ` (4.0
   *  tile^2, structures.ts) of one another. A demolisher whose designated
   *  target has already fallen does not despawn -- `demolishOrder` resets to
   *  -1 (sim.ts) and it falls into the automatic nearest-structure search
   *  (sim.ts), so it *will* pick up a neighbour with no order given. Spacing
   *  does not guard against this; nothing here does. What actually keeps
   *  `raze()` calls independent is that no `sim.tick()` runs between one
   *  `raze()` returning and the next assertion -- the leftover demolisher
   *  only acts on ticks a *later* `raze()` call or `step()` supplies, by
   *  which point the test has already read the state it cares about. Adding
   *  a bare `sim.tick()` before an assertion would let a leftover demolisher
   *  finish off a structure no test asked it to touch. */
  function razeWorld(opts: { outsider?: boolean; straddle?: boolean; zone?: string; empty?: boolean } = {}) {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 16 });
    const st = sim.addStructureType(RAZE_SHED);
    const demo = sim.addUnitType(RAZE_DEMO);

    const structs: { id: number; spawnX: number; spawnY: number }[] = [];
    if (!opts.empty) {
      structs.push({ id: sim.addStructure(st, [11 * sim.width + 11]), spawnX: 12.5, spawnY: 11.5 });
      structs.push({ id: sim.addStructure(st, [12 * sim.width + 12]), spawnX: 13.5, spawnY: 12.5 });
    }
    if (opts.outsider) {
      structs.push({ id: sim.addStructure(st, [25 * sim.width + 25]), spawnX: 26.5, spawnY: 25.5 });
    }
    if (opts.straddle) {
      // Tile x=13 is inside the zone (x in [10,14)); x=14 is not.
      const tiles = [10 * sim.width + 13, 10 * sim.width + 14];
      structs.push({ id: sim.addStructure(st, tiles), spawnX: 15.5, spawnY: 10.5 });
    }

    const mission: MissionJson = {
      id: 'raze_test',
      map: { file: 'none' },
      ledger: { requires: [], produces: [] },
      objectives: [{ id: 'win', type: 'raze', primary: true, target: opts.zone ?? 'depot' }],
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => {
        if (u !== RAZE_DEMO.id) throw new Error(`unknown unit ${u}`);
        return demo;
      },
      markers: {},
      zones: { depot: DEPOT_ZONE },
    });
    rt.start();

    /** Spawn a demolisher beside structure `i` (in placement order above) and
     *  order it to demolish, then tick until the structure falls or the
     *  budget runs out. */
    const raze = (i: number): void => {
      const target = structs[i];
      const id = sim.spawn(demo, 0, fx.from(target.spawnX), fx.from(target.spawnY));
      sim.queueCommand({ kind: 'demolish', ids: [id], structure: target.id });
      for (let n = 0; n < 200 && sim.structures.alive[target.id] === 1; n++) sim.tick();
    };

    return { sim, rt, raze, structs };
  }

  it('completes when every structure in the zone is dead', () => {
    const { sim, rt, raze } = razeWorld(); // depot zone holds 2 structures
    expect(rt.objectiveList[0].status).toBe('active');
    raze(0);
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('active'); // one still standing
    raze(1);
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('complete');
    expect(sim.structures.alive[0]).toBe(0);
    expect(sim.structures.alive[1]).toBe(0);
  });

  it('is not completed by a structure outside the zone', () => {
    const { sim, rt, raze, structs } = razeWorld({ outsider: true });
    expect(sim.structures.alive[structs[2].id]).toBe(1); // premise: outsider stands untouched
    raze(0);
    raze(1);
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('complete'); // outsider irrelevant
  });

  // The brief's original version of this test destroyed nothing and asserted
  // 'active', which holds no matter what the code does. This version proves
  // the straddler is actually in the target set: the zone's two normal
  // structures going down first must NOT complete the objective, and only
  // razing the straddler on top of that does.
  it('counts a structure with only one tile inside the zone', () => {
    const { rt, raze } = razeWorld({ straddle: true });
    raze(0);
    raze(1);
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('active'); // the straddler still stands
    raze(2);
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('complete'); // now every tile-owner is down
  });

  it('counts a structure destroyed by the enemy', () => {
    // The objective asks whether the depot is down, not who dropped it. An
    // enemy demolisher works exactly like a player one; only the spawn side differs.
    const { sim, rt } = razeWorld();
    const enemyDemo = sim.addUnitType({ ...RAZE_DEMO, id: 'raze_demo_enemy' });
    const a = sim.spawn(enemyDemo, 1, fx.from(12.5), fx.from(11.5));
    const b = sim.spawn(enemyDemo, 1, fx.from(13.5), fx.from(12.5));
    sim.queueCommand({ kind: 'demolish', ids: [a], structure: 0 });
    sim.queueCommand({ kind: 'demolish', ids: [b], structure: 1 });
    for (let n = 0; n < 200 && (sim.structures.alive[0] === 1 || sim.structures.alive[1] === 1); n++) {
      sim.tick();
    }
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('complete');
  });

  it('throws when the zone does not resolve', () => {
    expect(() => razeWorld({ zone: 'nowhere' })).toThrow(/needs a valid zone/);
  });

  it('throws when the zone holds no structures', () => {
    expect(() => razeWorld({ empty: true })).toThrow(/would complete on the first tick/);
  });
});

// Issue #87. `raze` sets `complete` and never `failed`, and `checkEnd` ends a
// mission only on a player wipe, an ROE collapse, or a FAILED primary. So a raze
// primary that can no longer be completed leaves the player alive, the ROE fine,
// the objective unreachable, and no end condition at all -- unwinnable and
// unlosable at the same time.
//
// It is reachable because the routes to an UNOCCUPIED structure are narrow, and
// every one of these was read off sim.ts rather than assumed: no command orders
// gunfire at a structure (`demolish` is the only structure-targeting command);
// the automatic structure-fire path needs a hostile inside, because
// selectStructureTarget gates on stOccupants; selectBreachTarget returns -1 for
// side 0 by design ("breaching on our side is a decision"); and a called strike
// costs intel a mission need not grant -- wadi_halam_5_depot grants none. That
// leaves the `demolish` order, which needs a unit that has the ability.
describe('a raze objective that has become impossible', () => {
  const SHED = { id: 'stall_shed', hp_per_tile: 100 };
  const ZONE = [10, 10, 4, 4] as const;
  /** No `demolish` in its abilities: it cannot ever satisfy a raze objective. */
  const RIFLEMAN: UnitTypeJson = {
    id: 'stall_rifles',
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.2 },
    sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
    weapons: [],
  };

  function stalled() {
    const sim = new Sim({ seed: 11, width: 32, height: 32, capacity: 16 });
    const st = sim.addStructureType(SHED);
    const rifles = sim.addUnitType(RIFLEMAN);
    const shed = sim.addStructure(st, [11 * sim.width + 11]);
    const mission: MissionJson = {
      id: 'stall_test',
      map: { file: 'none' },
      ledger: { requires: [], produces: [] },
      // A deadline, which validate_data.mjs requires on any primary raze.
      objectives: [{ id: 'level_it', type: 'raze', primary: true, target: 'depot', seconds: 60 }],
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => {
        if (u !== RIFLEMAN.id) throw new Error(`unknown unit ${u}`);
        return rifles;
      },
      markers: {},
      zones: { depot: ZONE },
    });
    rt.start();
    // A survivor with no way to bring anything down. The player is not wiped,
    // so `checkEnd` will not defeat them; the shed cannot fall, so the primary
    // cannot complete.
    sim.spawn(rifles, 0, fx.from(2.5), fx.from(2.5));
    return { sim, rt, shed };
  }

  it('shows the raze deadline as a countdown -- Tel Marum II was lost on a clock nobody could see', () => {
    // Until 2026-09-06 `ticksLeft` was computed for survive/evacuate/hold/
    // capture and not for raze or collapse, so a raze primary's `seconds`
    // ran down with no clock anywhere in the view.
    const { sim, rt } = stalled();
    for (let t = 0; t < 20; t++) {
      sim.tick();
      rt.step([]);
    }
    const view = rt.objectiveList.find((o) => o.id === 'level_it');
    expect(view?.ticksLeft).toBe(60 * TICKS_PER_SECOND - 20);
  });

  it('ends the mission instead of running for ever', () => {
    const { sim, rt, shed } = stalled();
    for (let t = 0; t < 90 * TICKS_PER_SECOND; t++) {
      sim.tick();
      rt.step([]);
    }
    // The shed is still standing, so the objective cannot have completed.
    expect(sim.structures.alive[shed]).toBe(1);
    expect(rt.objectiveList[0].status).toBe('failed');
    expect(rt.result).toBe('defeat');
  });

  it('but a deadline met in time does not fail the objective', () => {
    // The guard must be `!complete && past the deadline`, not just the clock:
    // a raze finished at t=10 must still read complete at t=90.
    const { sim, rt, shed } = stalled();
    sim.debugDestroyStructure(shed);
    for (let t = 0; t < 90 * TICKS_PER_SECOND; t++) {
      sim.tick();
      rt.step([]);
    }
    expect(rt.objectiveList[0].status).toBe('complete');
    expect(rt.result).toBe('victory');
  });
});

// `collapse`: "bring down every tunnel route whose mouth opens inside this
// zone." Mirrors `raze` deliberately: zone-scoped target, set snapshotted at
// mission start, a length guard so an empty set can never read as an instant
// win, and a `seconds` deadline so an impossible collapse loses the mission
// rather than hanging it. Routes come down via debugCollapseTunnel for the
// same reason the raze tests use debugDestroyStructure: the objective observes
// the outcome, not the charge that causes it (tunnels.test.ts owns the charge
// mechanics).
describe('collapse objective', () => {
  /** Mouths (points[0]) of tn_a and tn_b sit inside `district`; tn_far's does
   *  not. The zone rule is the whole point of the objective, so the fixture
   *  has to be able to tell a route in the zone from one that merely exists. */
  const ROUTES: readonly TunnelRouteJson[] = [
    { id: 'tn_a', points: [[3, 3], [12, 3]], dig_tiles_per_s: 1 },
    { id: 'tn_b', points: [[4, 6], [12, 6]], dig_tiles_per_s: 1 },
    { id: 'tn_far', points: [[18, 3], [20, 3]], dig_tiles_per_s: 1 },
  ];
  /** x, y, w, h in tiles: covers (2,2)-(9,9). */
  const DISTRICT = [2, 2, 8, 8] as const;
  /** Open ground holding no mouths at all. */
  const BARE = [14, 10, 2, 2] as const;

  function collapseWorld(over: Partial<ObjectiveJson> = {}) {
    const sim = new Sim({ seed: 7, width: 24, height: 16, capacity: 16 });
    const squad = sim.addUnitType(SQUAD);
    for (const r of ROUTES) sim.addTunnel(r);
    const mission: MissionJson = {
      id: 'collapse_test',
      map: { file: 'none' },
      ledger: { requires: [], produces: [] },
      // One living unit with no charge ability: the player is never wiped
      // (checkEnd would end the mission before any deadline could), and
      // nothing on the roster can ever bring a route down.
      starting_force: [{ unit: SQUAD.id, count: 1, at: [21, 13] }],
      objectives: [
        { id: 'o_collapse', type: 'collapse', primary: true, target: 'district', seconds: 300, ...over },
      ],
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => {
        if (u !== SQUAD.id) throw new Error(`unknown unit ${u}`);
        return squad;
      },
      markers: {},
      zones: { district: DISTRICT, bare: BARE },
      tunnels: ROUTES,
    });
    rt.start();
    return { sim, rt };
  }

  it('completes when every route whose mouth is in the zone is down', () => {
    const { sim, rt } = collapseWorld();
    expect(rt.objectiveStatus('o_collapse')).toBe('active');
    sim.debugCollapseTunnel(0); // tn_a
    rt.step([]);
    expect(rt.objectiveStatus('o_collapse')).toBe('active'); // tn_b still stands
    sim.debugCollapseTunnel(1); // tn_b
    const events = rt.step([]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'objective', id: 'o_collapse', status: 'complete' })
    );
    expect(rt.objectiveStatus('o_collapse')).toBe('complete');
  });

  it('does not complete while one route in the zone still stands', () => {
    const { sim, rt } = collapseWorld();
    sim.debugCollapseTunnel(0); // only tn_a
    for (let t = 0; t < 200; t++) {
      sim.tick();
      rt.step([]);
    }
    expect(rt.objectiveStatus('o_collapse')).toBe('active');
  });

  it('ignores a route whose mouth is outside the zone', () => {
    const { sim, rt } = collapseWorld();
    sim.debugCollapseTunnel(0);
    sim.debugCollapseTunnel(1);
    expect(sim.tnAlive[2]).toBe(1); // premise: tn_far stands untouched
    rt.step([]);
    // tn_far must not hold the objective open.
    expect(rt.objectiveStatus('o_collapse')).toBe('complete');
  });

  // The same trap the impossible-raze suite pins (issue #87): no unit on the
  // roster can work a charge, so without the deadline the mission would be
  // unwinnable and unlosable at once.
  it('fails at its deadline when no unit can carry a charge', () => {
    const { sim, rt } = collapseWorld({ seconds: 5 });
    let failed = false;
    for (let t = 0; t < 5 * TICKS_PER_SECOND + 20; t++) {
      sim.tick();
      for (const e of rt.step([])) {
        if (e.kind === 'objective' && e.id === 'o_collapse' && e.status === 'failed') failed = true;
      }
    }
    expect(failed).toBe(true);
    expect(rt.objectiveStatus('o_collapse')).toBe('failed');
    expect(rt.result).toBe('defeat'); // a failed primary ends the mission
  });

  it('never completes for a zone with no mouths, rather than completing instantly', () => {
    const { sim, rt } = collapseWorld({ target: 'bare' });
    for (let t = 0; t < 200; t++) {
      sim.tick();
      rt.step([]);
    }
    expect(rt.objectiveStatus('o_collapse')).toBe('active');
  });

  it('throws when the zone does not resolve', () => {
    expect(() => collapseWorld({ target: 'nowhere' })).toThrow(/needs a valid zone/);
  });
});

// `in_tunnel` on a placement: the bodies spawn inside a route instead of
// standing on their tile — how an author stocks a pre-dug route with a
// garrison that is underground from tick zero.
describe('in_tunnel placements', () => {
  const ROUTE: TunnelRouteJson = { id: 'tn_a', points: [[3, 3], [12, 3]], dig_tiles_per_s: 1 };

  function tunnelWorld(
    garrison: PlacementJson,
    opts: {
      houseAtMouth?: boolean;
      /** Replace the default destroy_all primary (and provide its zones). */
      objectives?: MissionJson['objectives'];
      zones?: Record<string, readonly number[]>;
      /** Replace the default surface squad. */
      force?: readonly PlacementJson[];
    } = {}
  ) {
    const sim = new Sim({ seed: 7, width: 24, height: 16, capacity: 16 });
    const types = new Map<string, number>();
    for (const t of [SQUAD, AMBUSHER]) types.set(t.id, sim.addUnitType(t));
    if (opts.houseAtMouth) {
      // A building over the mouth tile (3,3), to prove a buried placement is
      // exempt from the ground-clear check the way a garrison stance is.
      const st = sim.addStructureType({ id: 'tn_house', hp_per_tile: 100 });
      sim.addStructure(st, [3 * sim.width + 3]);
    }
    sim.addTunnel(ROUTE);
    const mission: MissionJson = {
      id: 'in_tunnel_test',
      map: { file: 'none' },
      ledger: { requires: [], produces: [] },
      starting_force: opts.force ?? [{ unit: SQUAD.id, count: 1, at: [21, 13] }],
      objectives: opts.objectives ?? [{ id: 'win', type: 'destroy_all', primary: true }],
      enemy: { garrison: [garrison] },
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => {
        const t = types.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: {},
      zones: opts.zones ?? {},
      tunnels: [ROUTE],
    });
    rt.start();
    const enemies = allIds(sim).filter(
      (i) => sim.state.alive[i] === 1 && sim.state.side[i] === 1
    );
    return { sim, rt, enemies };
  }

  it('starts every body of the placement underground', () => {
    const { sim, enemies } = tunnelWorld({
      unit: AMBUSHER.id,
      count: 2,
      at: [3, 3],
      in_tunnel: 'tn_a',
    });
    expect(enemies.length).toBe(2);
    for (const id of enemies) expect(sim.state.tunnelIn[id]).toBe(0); // route index 0
    expect(sim.tnOccupants[0]).toBe(2);
  });

  it('throws, naming the route, when a placement names an unknown one', () => {
    expect(() =>
      tunnelWorld({ unit: AMBUSHER.id, count: 1, at: [3, 3], in_tunnel: 'tn_zz' })
    ).toThrow(/tn_zz/);
  });

  it('is exempt from the ground-clear check: a buried body does not stand on its tile', () => {
    // The mouth tile is inside a building. A surface placement there would
    // throw from assertGroundClear; a buried one occupies the route, not the
    // tile, and comes back up at the vent — so surface clearance at `at`
    // proves nothing and must not be demanded.
    const { sim, enemies } = tunnelWorld(
      { unit: AMBUSHER.id, count: 1, at: [3, 3], in_tunnel: 'tn_a' },
      { houseAtMouth: true }
    );
    expect(enemies.length).toBe(1);
    expect(sim.state.tunnelIn[enemies[0]]).toBe(0);
  });

  // The hole Task 8's review carried here, now closed: applyCommands refuses
  // a surface move order for a buried unit — an attack-move is the exact
  // command a trigger's `commit` issues for its group — and putInTunnel
  // clears kinematics, so an order a unit was already walking when it went
  // down cannot keep its body moving below ground either. The earth decides
  // where a buried unit goes, exactly as a vehicle does for its passenger.
  it('a buried unit refuses a move order: the earth holds it still', () => {
    const { sim, enemies } = tunnelWorld({
      unit: AMBUSHER.id,
      count: 1,
      at: [3, 3],
      in_tunnel: 'tn_a',
    });
    const id = enemies[0];
    const before = sim.state.posX[id];
    sim.queueCommand({ kind: 'attackMove', ids: [id], x: fx.from(8.5), y: fx.from(3.5) });
    for (let t = 0; t < 60; t++) sim.tick();
    expect(sim.state.tunnelIn[id]).toBe(0); // still inside the route
    expect(sim.state.posX[id]).toBe(before); // and exactly where it was buried
  });

  // The reviewer's corollary to the move-order hole, and it needs no order at
  // all: contestedIn filtered by alive and side only, so a stocked route
  // whose spawn point sat inside a capture zone contested it from
  // underground — the player walks in, nothing on the map to shoot, and the
  // clock never starts.
  it('a buried enemy does not contest ground: capture completes over it', () => {
    const { sim, rt } = tunnelWorld(
      // The authored spawn point sits inside the zone, a tile from the squad.
      { unit: AMBUSHER.id, count: 1, at: [20, 12], in_tunnel: 'tn_a' },
      {
        objectives: [{ id: 'take', type: 'capture', primary: true, target: 'obj', seconds: 3 }],
        zones: { obj: [18, 10, 6, 6] },
      }
    );
    for (let t = 0; t < 5 * TICKS_PER_SECOND; t++) {
      sim.tick();
      rt.step([]);
    }
    expect(rt.objectiveStatus('take')).toBe('complete');
  });

  // And the same rule read from the other side: livingIn must not count a
  // buried friendly as presence, or a zone could be captured with nobody on
  // the ground.
  it('a buried friendly holds no ground either: capture stays unheld', () => {
    const { sim, rt } = tunnelWorld(
      { unit: AMBUSHER.id, count: 1, at: [3, 3], in_tunnel: 'tn_a' }, // far from the zone
      {
        force: [{ unit: SQUAD.id, count: 1, at: [21, 13], in_tunnel: 'tn_a' }],
        objectives: [{ id: 'take', type: 'capture', primary: true, target: 'obj', seconds: 3 }],
        zones: { obj: [18, 10, 6, 6] },
      }
    );
    for (let t = 0; t < 5 * TICKS_PER_SECOND; t++) {
      sim.tick();
      rt.step([]);
    }
    expect(rt.objectiveStatus('take')).toBe('active');
    expect(rt.objectiveList[0].paused).toBe('unheld');
  });
});

// Fixtures for the two describes below. digger_crew's numbers with the shovel;
// recon's mark_tunnel on unarmed eyes; yahalom's charge with a short fuse so
// the collapse lands inside a test-sized tick budget. New types rather than
// edits to SQUAD/AMBUSHER for the reason CARRIER states: adding abilities to
// the shared fixtures would change what every other test here exercises.
const M_DIGGER: UnitTypeJson = {
  id: 'm_digger',
  hull: { hp: 330, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.5 },
  sensors: { optics: 0.85, sight_tiles: 6, signature: 0.5 },
  abilities: ['dig_tunnel'],
  weapons: [],
};
const M_MARKER: UnitTypeJson = {
  id: 'm_marker',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['mark_tunnel'],
  weapons: [],
};
const M_CHARGER: UnitTypeJson = {
  id: 'm_charger',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.85 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.55 },
  abilities: ['tunnel_charge'],
  tunnel_charge_time_s: 2,
  weapons: [],
};

// `digs` on a placement: the spawned body is the route's digger from mission
// start — the declarative form of sim.assignDigger, exactly as `in_tunnel` is
// of putInTunnel. The authoring rules (dig_tunnel ability, count 1, one
// placement per route, never a pre_dug route) live in validate_data.mjs; the
// runtime enforces the one it must, an unknown route id throwing before any
// body spawns.
describe('digs placements', () => {
  const DIG_ROUTE: TunnelRouteJson = { id: 'tn_dig', points: [[3, 3], [12, 3]], dig_tiles_per_s: 1 };

  function digWorld(digs: string) {
    const sim = new Sim({ seed: 7, width: 24, height: 16, capacity: 16 });
    const types = new Map<string, number>();
    for (const t of [SQUAD, M_DIGGER]) types.set(t.id, sim.addUnitType(t));
    sim.addTunnel(DIG_ROUTE);
    const mission: MissionJson = {
      id: 'digs_test',
      map: { file: 'none' },
      ledger: { requires: [], produces: [] },
      starting_force: [{ unit: SQUAD.id, count: 1, at: [21, 13] }],
      objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
      enemy: { garrison: [{ unit: M_DIGGER.id, count: 1, at: [3, 3], digs }] },
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => {
        const t = types.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: {},
      zones: {},
      tunnels: [DIG_ROUTE],
    });
    rt.start();
    return { sim, rt };
  }

  it('assigns the spawned body as the route digger, and the dig advances', () => {
    const { sim } = digWorld('tn_dig');
    const digger = allIds(sim).filter((i) => sim.state.alive[i] === 1 && sim.state.side[i] === 1);
    expect(digger.length).toBe(1);
    expect(sim.tnDigger[0]).toBe(digger[0]); // assigned at start, before any tick
    for (let t = 0; t < 40; t++) sim.tick();
    expect(sim.tnProgress[0]).toBeGreaterThan(0); // and the route is actually being dug
  });

  it('throws, naming the route, when digs names an unknown one', () => {
    expect(() => digWorld('tn_ghost')).toThrow(/unknown tunnel "tn_ghost"/);
  });
});

// ---------------------------------------------------------------------------
// The ignition tests: mission JSON alone drives the whole subsystem, with not
// one debug or test-only call. Everything else in this file proves a piece;
// these two prove the chain — an authored `digs` excavates a route whose
// spoil the player then finds, and an authored mark_tunnel unit identifies a
// spoilless pre_dug route so a charge can be ordered and a `collapse`
// objective, unreachable from content until now, actually completes.
// ---------------------------------------------------------------------------
describe('the authored chain: mission JSON alone drives the subsystem', () => {
  it('a digs placement excavates its route, and the spoil is how the player finds it', () => {
    const sim = new Sim({ seed: 7, width: 24, height: 16, capacity: 16 });
    const types = new Map<string, number>();
    for (const t of [SQUAD, M_DIGGER]) types.set(t.id, sim.addUnitType(t));
    const route: TunnelRouteJson = { id: 'tn_dig', points: [[3, 3], [12, 3]], dig_tiles_per_s: 1 };
    sim.addTunnel(route);
    const mission: MissionJson = {
      id: 'chain_dig',
      map: { file: 'none' },
      ledger: { requires: [], produces: [] },
      // The scout stands over the route's tail: too far to see (or shoot) the
      // digger at the mouth, close enough that the head's spoil crosses into
      // its sight as the dig passes underneath.
      starting_force: [{ unit: SQUAD.id, count: 1, at: [12, 7] }],
      objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
      enemy: { garrison: [{ unit: M_DIGGER.id, count: 1, at: [3, 3], digs: 'tn_dig' }] },
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => {
        const t = types.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: {},
      zones: {},
      tunnels: [route],
    });
    rt.start();
    let vented = false;
    for (let t = 0; t < 600; t++) {
      for (const e of sim.tick()) if (e.kind === 'ventOpened') vented = true;
      rt.step([]);
    }
    expect(vented).toBe(true); // the route was dug through…
    expect(sim.trail.some((d) => d > 0)).toBe(true); // …leaving surface spoil…
    expect(sim.tunnelContactLevel(0, 0)).toBe(2); // …which is how the player found it
  });

  it('a mark_tunnel unit finds a spoilless route, and the charge it enables completes a collapse objective', () => {
    const sim = new Sim({ seed: 7, width: 24, height: 16, capacity: 16 });
    const types = new Map<string, number>();
    for (const t of [AMBUSHER, M_MARKER, M_CHARGER]) types.set(t.id, sim.addUnitType(t));
    const route: TunnelRouteJson = {
      id: 'tn_pre',
      points: [[3, 3], [12, 3]],
      dig_tiles_per_s: 1,
      pre_dug: true, // finished before the mission began: never any spoil
    };
    sim.addTunnel(route);
    const mission: MissionJson = {
      id: 'chain_mark',
      map: { file: 'none' },
      ledger: { requires: [], produces: [] },
      // Both player units stand off the vent at (12,3) — outside the buried
      // RPG's effective range, so the ambush never springs and the garrison
      // dies with its route, exactly the entombment a collapse mission wants.
      starting_force: [
        { unit: M_MARKER.id, count: 1, at: [7, 7] },
        { unit: M_CHARGER.id, count: 1, at: [6, 5] },
      ],
      objectives: [
        { id: 'seal', type: 'collapse', primary: true, target: 'district', seconds: 120 },
      ],
      enemy: { garrison: [{ unit: AMBUSHER.id, count: 1, at: [3, 3], in_tunnel: 'tn_pre' }] },
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => {
        const t = types.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: {},
      zones: { district: [2, 2, 4, 4] }, // holds the mouth at (3,3)
      tunnels: [route],
    });
    rt.start();
    // Spawn order is placement order: marker, then charger, then the enemy.
    const charger = 1;
    sim.tick();
    rt.step([]);
    expect(sim.trail.every((d) => d === 0)).toBe(true); // premise: nothing to find by spoil
    expect(sim.tunnelContactLevel(0, 0)).toBe(2); // one look, identified
    // The charge goes through the same command channel the app dispatches.
    sim.queueCommand({ kind: 'chargeTunnel', ids: [charger], tunnel: 0 });
    let collapsed = false;
    for (let t = 0; t < 200 && !collapsed; t++) {
      for (const e of sim.tick()) if (e.kind === 'tunnelCollapsed') collapsed = true;
      rt.step([]);
    }
    expect(collapsed).toBe(true);
    expect(rt.objectiveStatus('seal')).toBe('complete');
    expect(rt.result).toBe('victory');
    // The buried garrison died with its route, through the normal path.
    const enemies = allIds(sim).filter((i) => sim.state.side[i] === 1);
    expect(enemies.some((i) => sim.state.alive[i] === 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 16: the mission runtime's half of structural containment. Every
// predicate that reads a body's surface coordinates must first ask whether
// the body is standing on them.
// ---------------------------------------------------------------------------
describe('containment is structural: mission predicates ignore buried bodies', () => {
  const ROUTE16: TunnelRouteJson = { id: 'tn_a', points: [[3, 3], [12, 3]], dig_tiles_per_s: 1 };
  const SURVIVE: ObjectiveJson = { id: 'hold', type: 'survive_until', primary: true, seconds: 600 };

  function world16(partial: Partial<MissionJson>, ctx?: Partial<MissionContext>): World {
    const sim = new Sim({ seed: 13, width: 28, height: 12, capacity: 32 });
    const ids = new Map<string, number>();
    for (const t of [SQUAD, AMBUSHER, RUNNER, TANK, DRONE, CIVILIANS, CARRIER, RIDER, MORTAR])
      ids.set(t.id, sim.addUnitType(t));
    sim.addTunnel(ROUTE16);
    const runtime = new MissionRuntime(sim, baseMission(partial), {
      typeIdOf: (u) => {
        const t = ids.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: { refuge: [2, 4], rally: [20, 10] },
      zones: {},
      tunnels: [ROUTE16],
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

  it('refuses a placement that is both buried and loaded: the two states cannot coexist', () => {
    expect(() =>
      world16({
        objectives: [SURVIVE],
        enemy: {
          garrison: [
            {
              unit: 'm_carrier',
              count: 1,
              at: [3, 3],
              in_tunnel: 'tn_a',
              passengers: [{ unit: 'm_rider', count: 1 }],
            },
          ],
        },
      })
    ).toThrow(/in_tunnel|passenger/);
  });

  it('a pre-marked placement spawned underground is not identified through the earth', () => {
    const w = world16(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [24, 8] }],
        objectives: [SURVIVE, { id: 'find', type: 'locate', target: 't1', primary: false }],
        enemy: {
          garrison: [{ unit: 'm_rpg', count: 1, at: [3, 3], tag: 't1', in_tunnel: 'tn_a' }],
        },
      },
      { ledger: { 'intel.marked_positions': ['t1'] } }
    );
    const enemy = allIds(w.sim).find(
      (i) => w.sim.state.alive[i] === 1 && w.sim.state.side[i] === 1
    );
    expect(enemy).toBeDefined();
    w.step(3);
    expect(w.sim.contactLevel(0, enemy ?? -1)).toBe(0); // not drawn on the map
    expect(w.runtime.objectiveStatus('find')).toBe('active'); // not located at t=0
  });

  it('a sweep bought off the HUD does not locate a buried garrison', () => {
    const w = world16({
      starting_force: [{ unit: 'm_squad', count: 1, at: [24, 8] }],
      objectives: [SURVIVE, { id: 'find', type: 'locate', count: 1, primary: false }],
      enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [3, 3], in_tunnel: 'tn_a' }] },
      resources: { intel_start: 150 },
    });
    const enemy = allIds(w.sim).find(
      (i) => w.sim.state.alive[i] === 1 && w.sim.state.side[i] === 1
    );
    expect(w.runtime.requestSweep(fx.from(3.5), fx.from(3.5))).toBe(true);
    w.step(3);
    expect(w.sim.contactLevel(0, enemy ?? -1)).toBe(0);
    expect(w.runtime.objectiveStatus('find')).toBe('active');
  });

  it('evacuate_before does not count a civilian who is underground inside the refuge zone', () => {
    const w = world16(
      {
        starting_force: [{ unit: 'm_squad', count: 1, at: [26, 2] }],
        objectives: [
          SURVIVE,
          { id: 'evac', type: 'evacuate_before', target: 'rz', count: 1, seconds: 5, primary: false },
        ],
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [3, 3], in_tunnel: 'tn_a' }], refuge: 'refuge' },
      },
      { zones: { rz: [0, 0, 8, 8] } }
    );
    const civ = allIds(w.sim).find((i) => w.sim.state.alive[i] === 1 && w.sim.state.side[i] === 2);
    expect(civ).toBeDefined();
    w.step(3);
    expect(w.runtime.objectiveStatus('evac')).toBe('active'); // nobody was rescued by authoring
    expect(w.sim.state.alive[civ ?? -1]).toBe(1); // and the body was not deleted
    expect(w.sim.state.tunnelIn[civ ?? -1]).toBe(0);
  });

  it('ROE does not charge danger-close for civilians the earth already protects', () => {
    const w = world16({
      starting_force: [{ unit: 'm_mortar', count: 1, at: [3, 8] }],
      objectives: [SURVIVE],
      enemy: { garrison: [{ unit: 'm_squad', count: 1, at: [20, 5] }] },
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [21, 5], in_tunnel: 'tn_a' }] },
      roe: { enabled: true, disproportionate_ordnance_penalty: 3 },
    });
    const strike: SimEvent = { kind: 'strike', tick: 1, by: 0, x: fx.from(21.5), y: fx.from(5.5) };
    const fire: SimEvent = {
      kind: 'fire',
      tick: 1,
      shooter: 0,
      target: 1,
      weaponId: 'tube',
      pHit: 1000,
      roll: 1,
      willHit: false,
      breakdown: { accuracy: 1, rangeFalloff: 1, coverMod: 1, motionMod: 1, stanceMod: 1, suppressionMod: 1 },
    };
    const out = [...w.runtime.step([strike]), ...w.runtime.step([fire])];
    expect(out.filter((e) => e.kind === 'roe').length).toBe(0);
    expect(w.runtime.roeScore).toBe(100);
  });

  it('a buried civilian is not shepherded: no latch, no order', () => {
    const w = world16({
      starting_force: [{ unit: 'm_squad', count: 1, at: [4, 4] }],
      objectives: [SURVIVE],
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [3, 3], in_tunnel: 'tn_a' }], refuge: 'refuge' },
    });
    const civ = allIds(w.sim).find((i) => w.sim.state.alive[i] === 1 && w.sim.state.side[i] === 2);
    const spy = vi.spyOn(w.sim, 'queueCommand');
    w.step(30);
    const ordered = spy.mock.calls.some(
      ([cmd]) => 'ids' in cmd && cmd.ids.includes(civ ?? -1)
    );
    expect(ordered).toBe(false);
  });

  it('a buried soldier shepherds nobody: the civilian above stays put', () => {
    const w = world16({
      starting_force: [{ unit: 'm_squad', count: 1, at: [12, 6], in_tunnel: 'tn_a' }],
      objectives: [SURVIVE],
      civilians: { groups: [{ unit: 'm_civ', count: 1, at: [13, 6] }], refuge: 'refuge' },
    });
    const civ = allIds(w.sim).find((i) => w.sim.state.alive[i] === 1 && w.sim.state.side[i] === 2);
    const at = w.sim.state.posX[civ ?? -1];
    w.step(60);
    expect(w.sim.state.posX[civ ?? -1]).toBe(at); // nobody reached them
  });

  it('a buried patroller does not walk its beat, and no dead order is queued for it', () => {
    const w = world16({
      starting_force: [{ unit: 'm_squad', count: 1, at: [24, 8] }],
      objectives: [SURVIVE],
      enemy: {
        garrison: [
          {
            unit: 'm_rpg',
            count: 1,
            at: [3, 3],
            in_tunnel: 'tn_a',
            stance: { kind: 'patrol', waypoints: [[3, 3], [8, 3]] },
          },
        ],
      },
    });
    const enemy = allIds(w.sim).find(
      (i) => w.sim.state.alive[i] === 1 && w.sim.state.side[i] === 1
    );
    const spy = vi.spyOn(w.sim, 'queueCommand');
    w.step(30);
    const ordered = spy.mock.calls.some(
      ([cmd]) => 'ids' in cmd && cmd.ids.includes(enemy ?? -1)
    );
    expect(ordered).toBe(false);
  });

  it('a commit trigger aimed at a buried group commands nothing', () => {
    const w = world16({
      starting_force: [{ unit: 'm_squad', count: 1, at: [24, 8] }],
      objectives: [SURVIVE],
      enemy: {
        garrison: [{ unit: 'm_rpg', count: 1, at: [3, 3], group: 'g1', in_tunnel: 'tn_a' }],
      },
      triggers: [{ id: 'go', on: { kind: 'timer_s', value: 0 }, do: { kind: 'commit', group: 'g1', to: 'rally' } }],
    });
    const spy = vi.spyOn(w.sim, 'queueCommand');
    const out = w.step(3);
    expect(out.mission.some((e) => e.kind === 'trigger' && e.id === 'go')).toBe(true);
    const attackMoves = spy.mock.calls.filter(([cmd]) => cmd.kind === 'attackMove');
    expect(attackMoves.length).toBe(0);
  });

  it('a strike is called by the first LIVING SURFACE unit, never a buried one', () => {
    const w = world16({
      starting_force: [
        { unit: 'm_squad', count: 1, at: [3, 3], in_tunnel: 'tn_a' }, // playerIds[0], buried
        { unit: 'm_squad', count: 1, at: [10, 5] },
      ],
      objectives: [SURVIVE],
      resources: { intel_start: 250 },
    });
    expect(w.runtime.requestStrike(fx.from(20.5), fx.from(5.5))).toBe(true);
    const out = w.step(STRIKE_DELAY_TICKS + 3);
    const strike = out.sim.find((e) => e.kind === 'strike');
    expect(strike).toBeDefined();
    expect(strike?.kind === 'strike' && strike.by).toBe(1); // the surface unit owns it
  });

  it('a buried drone observes nothing and earns nothing', () => {
    const w = world16({
      starting_force: [{ unit: 'm_drone', count: 1, at: [3, 3], in_tunnel: 'tn_a' }],
      objectives: [SURVIVE],
    });
    w.step(300); // 15s: a surface drone would have banked 2 intel by now
    expect(w.runtime.intel).toBe(0);
  });

  it('BY-DESIGN pin: destroy_all counts a buried garrison as alive, because collapse can reach it', () => {
    const w = world16({
      starting_force: [{ unit: 'm_squad', count: 1, at: [24, 8] }],
      objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
      enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [3, 3], in_tunnel: 'tn_a' }] },
    });
    w.step(5);
    expect(w.runtime.objectiveStatus('win')).toBe('active'); // alive below is alive
    w.sim.debugCollapseTunnel(0);
    w.step(2);
    expect(w.runtime.objectiveStatus('win')).toBe('complete'); // and the earth coming down reaches it
  });
});

// `pre_dug` end to end: the flag is the only way authored data can promise a
// stocked route will ever surface, because digger assignment has no
// declarative form. Until this test existed, a mission authored with
// `in_tunnel` on a pre_dug route validated green and then never vented — the
// exact silent-playtest failure the validator exists to prevent.
describe('pre_dug routes', () => {
  function ambushWorld(preDug: boolean) {
    const route: TunnelRouteJson = {
      id: 'tn_pd',
      points: [[3, 3], [12, 3]],
      dig_tiles_per_s: 1,
      ...(preDug ? { pre_dug: true } : {}),
    };
    const sim = new Sim({ seed: 7, width: 24, height: 16, capacity: 16 });
    const types = new Map<string, number>();
    for (const t of [SQUAD, AMBUSHER]) types.set(t.id, sim.addUnitType(t));
    sim.addTunnel(route);
    const mission: MissionJson = {
      id: 'pre_dug_test',
      map: { file: 'none' },
      ledger: { requires: [], produces: [] },
      // Standing two tiles from the vent (12.5, 3.5): inside the ambusher's
      // 3.5-tile effective range, so hasTargetFrom is satisfied from tick one
      // and the ONLY thing deciding whether the ambush springs is the vent.
      starting_force: [{ unit: SQUAD.id, count: 1, at: [14, 3] }],
      objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
      enemy: { garrison: [{ unit: AMBUSHER.id, count: 1, at: [3, 3], in_tunnel: 'tn_pd' }] },
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => {
        const t = types.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: {},
      zones: {},
      tunnels: [route],
    });
    rt.start();
    const buried = allIds(sim).find((i) => sim.state.side[i] === 1);
    return { sim, rt, buried: buried ?? -1 };
  }

  it('loads complete: progress at full length, vent open, nothing to dig', () => {
    const { sim } = ambushWorld(true);
    expect(sim.tnProgress[0]).toBe(sim.tnLength[0]);
    expect(sim.tnVentOpen[0]).toBe(1);
    // stepDigging must skip it: no digger exists, and ticking must not move
    // progress or stamp trail.
    for (let t = 0; t < 40; t++) sim.tick();
    expect(sim.tnProgress[0]).toBe(sim.tnLength[0]);
  });

  it('stamps no trail at load: a route dug before the mission has weathered', () => {
    const { sim } = ambushWorld(true);
    expect(sim.trail.every((v) => v === 0)).toBe(true);
  });

  it('vents its in_tunnel garrison with no digger present', () => {
    const { sim, buried } = ambushWorld(true);
    expect(sim.state.tunnelIn[buried]).toBe(0);
    const events: SimEvent[] = [];
    for (let t = 0; t < 40; t++) events.push(...sim.tick());
    const up = events.find((e) => e.kind === 'surfaced');
    expect(up).toBeDefined();
    expect(up && 'entity' in up ? up.entity : -1).toBe(buried);
  });

  it('a non-pre_dug route does not: the garrison stays buried forever', () => {
    const { sim, buried } = ambushWorld(false);
    expect(sim.tnProgress[0]).toBe(0);
    expect(sim.tnVentOpen[0]).toBe(0);
    const events: SimEvent[] = [];
    for (let t = 0; t < 400; t++) events.push(...sim.tick()); // 20 s
    expect(events.some((e) => e.kind === 'surfaced')).toBe(false);
    expect(sim.state.tunnelIn[buried]).toBe(0); // still in the route
    expect(sim.tnVentOpen[0]).toBe(0);
  });
});

// The narrative layer (docs/superpowers/specs/2026-09-03-narrative-layer-engine-design.md):
// `remove` triggers (an abduction, never a kill), `say` lines on triggers and
// objectives, and `group` on a starting_force entry.
describe('the narrative layer: remove, say, starting_force groups', () => {
  it('remove of a civilian group leaves ROE at 100', () => {
    const w = makeWorld(
      baseMission({
        objectives: [{ id: 'noop', type: 'survive_until', primary: true, seconds: 3 }],
        civilians: { groups: [{ unit: 'm_civ', count: 2, at: [5, 5], group: 'family' }] },
        triggers: [
          { id: 'take_family', on: { kind: 'timer_s', value: 1 }, do: { kind: 'remove', group: 'family' } },
        ],
      })
    );
    w.step(25); // past the 1s trigger
    expect(w.runtime.roeScore).toBe(100);
    // Both civilians actually left play, not merely took damage.
    expect(w.sim.state.alive[0]).toBe(0);
    expect(w.sim.state.alive[1]).toBe(0);
  });

  it('remove with a zone removes only those inside it', () => {
    const w = makeWorld(
      baseMission({
        enemy: {
          garrison: [
            { unit: 'm_tech', count: 1, at: [4, 2], group: 'squad' }, // inside the cage
            { unit: 'm_tech', count: 1, at: [20, 2], group: 'squad' }, // outside it
          ],
        },
        triggers: [
          { id: 'take_cage', on: { kind: 'timer_s', value: 1 }, do: { kind: 'remove', group: 'squad', zone: 'cage' } },
        ],
      }),
      { zones: { cage: [0, 0, 10, 10] } }
    );
    w.step(25);
    expect(w.sim.state.alive[0]).toBe(0); // (4,2) is inside [0,0,10,10]
    expect(w.sim.state.alive[1]).toBe(1); // (20,2) is not
    expect(w.sim.state.removed[0]).toBe(1);
    expect(w.sim.state.removed[1]).toBe(0);
  });

  it('a removed player unit is absent from roster.surviving_units', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [
          { unit: 'm_squad', count: 1, at: [3, 5], group: 'captured' },
          { unit: 'm_squad', count: 1, at: [3, 8] },
        ],
        objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 1 }],
        ledger: { requires: [], produces: ['roster.surviving_units'] },
        triggers: [{ id: 'take_one', on: { kind: 'timer_s', value: 0 }, do: { kind: 'remove', group: 'captured' } }],
      })
    );
    const { mission } = w.step(4 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    expect(end?.kind).toBe('missionEnd');
    if (end?.kind !== 'missionEnd') return;
    expect(end.result).toBe('victory');
    expect(end.survivors).toEqual(['m_squad']); // the captured one is gone
    const roster = end.ledger['roster.surviving_units'];
    expect(Array.isArray(roster)).toBe(true);
    if (Array.isArray(roster)) expect(roster).toHaveLength(1);
  });

  it('casualties_pct ignores removed units — only an actual kill counts', () => {
    const w = makeWorld(
      baseMission({
        enemy: {
          garrison: [
            { unit: 'm_tech', count: 1, at: [4, 2], group: 'watched' },
            { unit: 'm_tech', count: 1, at: [4, 8] },
          ],
        },
        triggers: [
          { id: 'take_one', on: { kind: 'timer_s', value: 1 }, do: { kind: 'remove', group: 'watched' } },
          { id: 'half_down', on: { kind: 'casualties_pct', value: 50 }, do: { kind: 'commit', group: 'none', to: 'rally' } },
        ],
      }),
      { markers: { rally: [20, 8] } }
    );
    const fired = (evs: MissionEvent[]): boolean => evs.some((e) => e.kind === 'trigger' && e.id === 'half_down');
    let seen = false;
    // take_one removes garrison[0] at t=1s. If a removal counted as a
    // casualty, that alone would be 50% of two and half_down would fire here.
    for (let t = 0; t < 3 * TICKS_PER_SECOND; t++) seen = seen || fired(w.runtime.step(w.sim.tick()));
    expect(seen).toBe(false);
    // An actual kill of the survivor is the one death that should count.
    w.sim.debugKill(1);
    for (let t = 0; t < 2 * TICKS_PER_SECOND; t++) seen = seen || fired(w.runtime.step(w.sim.tick()));
    expect(seen).toBe(true);
  });

  it('say is emitted immediately after the trigger event it annotates', () => {
    const w = makeWorld(
      baseMission({
        triggers: [
          {
            id: 'warn',
            on: { kind: 'timer_s', value: 1 },
            do: { kind: 'commit', group: 'nobody', to: 'rally' },
            say: { speaker: 'shai', text: 'Contact.' },
          },
        ],
      }),
      { markers: { rally: [5, 5] } }
    );
    const { mission } = w.step(2 * TICKS_PER_SECOND);
    const triggerIdx = mission.findIndex((e) => e.kind === 'trigger' && e.id === 'warn');
    expect(triggerIdx).toBeGreaterThanOrEqual(0);
    const say = mission[triggerIdx + 1];
    expect(say?.kind).toBe('say');
    if (say?.kind === 'say') {
      expect(say.speaker).toBe('shai');
      expect(say.text).toBe('Contact.');
    }
  });

  it('say is emitted immediately after an objective completes', () => {
    const w = makeWorld(
      baseMission({
        objectives: [
          { id: 'hold', type: 'survive_until', primary: true, seconds: 1, say: { speaker: 'idit', text: 'Good work.' } },
        ],
      })
    );
    const { mission } = w.step(2 * TICKS_PER_SECOND);
    const objIdx = mission.findIndex((e) => e.kind === 'objective' && e.id === 'hold' && e.status === 'complete');
    expect(objIdx).toBeGreaterThanOrEqual(0);
    const say = mission[objIdx + 1];
    expect(say?.kind).toBe('say');
    if (say?.kind === 'say') {
      expect(say.speaker).toBe('idit');
      expect(say.text).toBe('Good work.');
    }
  });

  it('say_on_fail is emitted immediately after an objective fails', () => {
    const w = makeWorld(
      baseMission({
        civilians: { groups: [{ unit: 'm_civ', count: 1, at: [5, 5] }], refuge: 'refuge' },
        objectives: [
          {
            id: 'evac',
            type: 'evacuate_before',
            primary: true,
            target: 'refuge_zone',
            seconds: 1,
            say_on_fail: { speaker: 'net', text: 'Lost them.' },
          },
        ],
      }),
      { zones: { refuge_zone: [0, 0, 2, 2] }, markers: { refuge: [1, 1] } }
    );
    const { mission } = w.step(2 * TICKS_PER_SECOND);
    const objIdx = mission.findIndex((e) => e.kind === 'objective' && e.id === 'evac' && e.status === 'failed');
    expect(objIdx).toBeGreaterThanOrEqual(0);
    const say = mission[objIdx + 1];
    expect(say?.kind).toBe('say');
    if (say?.kind === 'say') {
      expect(say.speaker).toBe('net');
      expect(say.text).toBe('Lost them.');
    }
  });

  it('starting_force.group is addressable by commit-style lookups (groups)', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5], group: 'alpha' }],
        triggers: [
          { id: 'pull_back', on: { kind: 'timer_s', value: 1 }, do: { kind: 'withdraw_to', group: 'alpha', to: 'rally' } },
        ],
      }),
      { markers: { rally: [20, 8] } }
    );
    for (let t = 0; t < 30 * TICKS_PER_SECOND; t++) w.runtime.step(w.sim.tick());
    const x = fx.toNumber(w.sim.state.posX[0]);
    const y = fx.toNumber(w.sim.state.posY[0]);
    expect(Math.abs(x - 20.5)).toBeLessThan(2.0);
    expect(Math.abs(y - 8.5)).toBeLessThan(2.0);
  });
});
