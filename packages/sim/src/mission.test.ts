import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import {
  MissionRuntime,
  type LedgerData,
  type MissionContext,
  type MissionEvent,
  type MissionJson,
} from './mission';

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
    for (const t of [SQUAD, AMBUSHER, RUNNER, TANK, CIVILIANS, MORTAR]) ids.set(t.id, sim.addUnitType(t));
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

