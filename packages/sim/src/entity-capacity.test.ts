// Every runtime spawn path refuses gracefully when the sim has no entity ids left (GH-761/GH-768).
// Wounded men use lifetime ids too, so a long mission can reach `capacity`. Start-time placements
// stay strict (a force that does not fit is an authoring error); waves, spawn/reinforce triggers and
// production deploys skip per placement (never half-placed), and identically for every peer.
import { describe, expect, it } from 'vitest';
import { Sim, type UnitTypeJson } from './sim';
import { MissionRuntime, type MissionEvent, type MissionJson } from './mission';

const SQUAD: UnitTypeJson = {
  id: 'cap_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
const CAMP = { id: 'camp', name: 'Field Camp', hp_per_tile: 300, garrison_slots: 3, rubble_cover: 2, produces_for: 0 };
const CAPACITY = 8;

function world(extra: Partial<MissionJson> = {}, capacity = CAPACITY) {
  const sim = new Sim({ seed: 5, width: 40, height: 12, capacity });
  const t = sim.addUnitType(SQUAD);
  sim.addStructureType(CAMP);
  const mission: MissionJson = {
    id: 'cap', map: { file: 'none', player_start: [3, 5] },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    starting_force: [{ unit: 'cap_squad', count: 1, at: [3, 8] }],
    structures: [{ type: 'camp', at: [10, 3], size: [2, 2] }],
    ...extra,
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: () => t, markers: { north: [30, 3] }, zones: {},
    economy: { logisticsStart: [1200, 1200], logisticsRatePerMin: [0, 0] },
    unitInfo: () => ({ logistics: 300, buildTimeS: 2, population: 1 }),
  });
  rt.start();
  const events: MissionEvent[] = [];
  const step = (n: number): void => { for (let i = 0; i < n; i++) events.push(...rt.step(sim.tick())); };
  /** Use up ids the way a long fight does: spawn bodies until `free` ids remain. */
  const leave = (free: number): void => { while (sim.entityCount < sim.capacity - free) sim.spawn(t, 0, 0, 0); };
  return { sim, rt, step, events, leave };
}

const WAVE = (count: number): Partial<MissionJson> => ({
  enemy: { waves: [{ at_seconds: 1, units: [{ unit: 'cap_squad', count, from: 'north' }], say: { speaker: 'idit', text: 'Here they come.' } }] },
});

describe('entity capacity: runtime spawns refuse instead of throwing', () => {
  it('a wave at capacity is skipped: no throw, no body, no event, no line', () => {
    const w = world(WAVE(2));
    w.leave(0);
    expect(() => w.step(40)).not.toThrow();
    expect(w.sim.entityCount).toBe(CAPACITY);
    expect(w.events.some((e) => e.kind === 'wave' || e.kind === 'say')).toBe(false);
  });

  it('a wave that does not fit whole is skipped whole, never half placed', () => {
    const w = world(WAVE(3));
    w.leave(2);
    w.step(40);
    expect(w.sim.entityCount).toBe(CAPACITY - 2);
  });

  it('a wave that fits still spawns', () => {
    const w = world(WAVE(2));
    w.leave(2);
    w.step(40);
    expect(w.sim.entityCount).toBe(CAPACITY);
    expect(w.events.some((e) => e.kind === 'wave')).toBe(true);
  });

  it('spawn and reinforce triggers at capacity do nothing', () => {
    const w = world({
      triggers: [
        { id: 'a', on: { kind: 'timer_s', seconds: 1 }, do: { kind: 'spawn', units: [{ unit: 'cap_squad', count: 1, at: [20, 5] }] }, label: 'a' },
        { id: 'b', on: { kind: 'timer_s', seconds: 1 }, do: { kind: 'reinforce', units: [{ unit: 'cap_squad', count: 1, at: [2, 6] }] }, label: 'b' },
      ] as unknown as MissionJson['triggers'],
    });
    w.leave(0);
    expect(() => w.step(40)).not.toThrow();
    expect(w.sim.entityCount).toBe(CAPACITY);
  });

  it('a carrier placement counts its passengers toward the room it needs', () => {
    const w = world({
      triggers: [
        { id: 'a', on: { kind: 'timer_s', seconds: 1 }, do: { kind: 'spawn', units: [{ unit: 'cap_squad', count: 1, at: [20, 5], passengers: [{ unit: 'cap_squad', count: 2 }] }] }, label: 'a' },
      ] as unknown as MissionJson['triggers'],
    });
    w.leave(2); // the carrier fits, its two riders after it do not
    expect(() => w.step(40)).not.toThrow();
    expect(w.sim.entityCount).toBe(CAPACITY - 2);
  });

  it('canBuild and buildBlockedReason refuse at capacity, with a reason', () => {
    const w = world();
    w.step(5);
    expect(w.rt.canBuild('cap_squad')).toBe(true);
    expect(w.rt.buildBlockedReason('cap_squad')).toBeNull();
    w.leave(0);
    expect(w.rt.canBuild('cap_squad')).toBe(false);
    expect(w.rt.requestBuild('cap_squad')).toBe(false);
    expect(w.rt.buildBlockedReason('cap_squad')).toMatch(/no room on the field/);
    expect(w.rt.popCapped('cap_squad')).toBe(false);
  });

  it('a build queued before the ids ran out is refunded at deploy, with no `built` event', () => {
    const w = world();
    w.step(5);
    expect(w.rt.requestBuild('cap_squad')).toBe(true);
    expect(w.rt.logisticsOf(0)).toBe(900);
    w.leave(0);
    expect(() => w.step(60)).not.toThrow();
    expect(w.events.some((e) => e.kind === 'built')).toBe(false);
    expect(w.sim.entityCount).toBe(CAPACITY);
    expect(w.rt.logisticsOf(0)).toBe(1200); // refunded in full
  });

  it('is deterministic: two peers refuse on the same tick with the same state', () => {
    const run = () => {
      const w = world(WAVE(2));
      w.step(5);
      w.rt.requestBuild('cap_squad');
      w.leave(1);
      w.step(80);
      return JSON.stringify([w.sim.entityCount, w.events.map((e) => [e.kind, e.tick]), w.rt.logisticsOf(0), w.rt.digest()]);
    };
    expect(run()).toBe(run());
  });

  it('start-time placements stay strict: a starting force that does not fit throws', () => {
    expect(() => world({ starting_force: [{ unit: 'cap_squad', count: 4, at: [3, 8] }] }, 3)).toThrow(/capacity/);
  });
});
