// @vitest-environment jsdom
//
// The debug overlay's teardown. The instrument mounts on `document.body` in
// `main.ts`, not on the stage the router clears, so a battlefield that is left
// softly has to take it off itself -- and it puts TWO panes there, not one, so
// a teardown that remembered a single root would leave the roll feed behind.
//
// The sim here is empty on purpose, and carries no unit types: the constructor
// only stores it, and `@lions/render` may not import `@lions/data` to fetch a
// real one (the one-way dependency rule, CLAUDE.md).

import { describe, expect, it } from 'vitest';
import { Sim, type SimEvent, type UnitTypeJson } from '@lions/sim';
import { DebugOverlay, garrisonRangeTerm } from './overlay';

const emptySim = (): Sim => new Sim({ seed: 1, width: 8, height: 8, capacity: 8 });

describe('DebugOverlay.destroy', () => {
  it('removes both panes from the body, and can be called twice', () => {
    const before = document.body.children.length;
    const overlay = new DebugOverlay(document.body, emptySim(), () => [], '0.1');
    expect(document.body.children.length).toBe(before + 2);
    overlay.destroy();
    expect(document.body.children.length).toBe(before);
    // Idempotent: a stale battlefield mount resolving onto an already-aborted
    // route runs its disposer after the teardown that aborted it.
    overlay.destroy();
    expect(document.body.children.length).toBe(before);
  });

  it('stays gone after being opened first', () => {
    const before = document.body.children.length;
    const overlay = new DebugOverlay(document.body, emptySim(), () => [], '0.1');
    overlay.toggle();
    overlay.destroy();
    expect(document.body.children.length).toBe(before);
  });
});

describe('DebugOverlay roll feed: sizeMod (E6 N2)', () => {
  const fire = (breakdown: Record<string, number>) =>
    ({ kind: 'fire', tick: 1, shooter: 0, target: 1, weaponId: 'rifle', pHit: 0, roll: 0, willHit: false, breakdown }) as unknown as SimEvent;
  const base = { accuracy: 65536, rangeFalloff: 65536, coverMod: 65536, motionMod: 65536, stanceMod: 65536, suppressionMod: 65536 };
  const feedText = (e: SimEvent): string => {
    const host = document.createElement('div');
    const overlay = new DebugOverlay(host, emptySim(), () => [], '0.1');
    overlay.toggle();
    overlay.onTick([e]);
    return host.textContent ?? '';
  };

  it('prints the size factor when the event carries one, and not otherwise', () => {
    expect(feedText(fire({ ...base, sizeMod: 5243 }))).toMatch(/size 8%/);
    expect(feedText(fire(base))).not.toMatch(/size/);
  });
});

// GH-34 acceptance 2: the roll feed names what standing in a building adds to a shot's reach. Literal numbers, a real Sim (no
// `@lions/data`: the types are written here), and the oracle is the structure JSON's own `garrison_range_bonus`.
describe('DebugOverlay roll feed: the garrison term (GH-34)', () => {
  const W = { type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 };
  const SQUAD: UnitTypeJson = {
    id: 'o_squad', role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.6 },
    sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
    abilities: ['garrison'],
    weapons: [
      { id: 'rifles', ...W },
      { id: 'lobber', ...W, indirect: true },
      { id: 'sealed', ...W, fires_from_building: false },
    ],
  };
  const HOUSE = { id: 'o_house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 };
  const BLOCK = { id: 'o_block', name: 'Block', hp_per_tile: 400, garrison_slots: 4, rubble_cover: 2, garrison_range_bonus: 2 };
  const rect = (sim: Sim, type: number, x: number, y: number): number => sim.addStructure(type, [y * sim.width + x, y * sim.width + x + 1]);

  /** Unit 0 garrisoned in a house (the default one tile), unit 1 in a block that authors 2, unit 2 in the open. */
  function world(): Sim {
    const sim = new Sim({ seed: 3, width: 48, height: 32, capacity: 16 });
    const house = sim.addStructureType(HOUSE);
    const block = sim.addStructureType(BLOCK);
    const squad = sim.addUnitType(SQUAD);
    const inHouse = rect(sim, house, 20, 14);
    const inBlock = rect(sim, block, 30, 14);
    const a = sim.spawn(squad, 0, 19.5 * 65536, 14.5 * 65536);
    const b = sim.spawn(squad, 0, 29.5 * 65536, 14.5 * 65536);
    sim.spawn(squad, 0, 10.5 * 65536, 20.5 * 65536);
    sim.queueCommand({ kind: 'garrison', ids: [a], structure: inHouse });
    sim.queueCommand({ kind: 'garrison', ids: [b], structure: inBlock });
    for (let k = 0; k < 400 && (sim.state.garrisonedIn[a] < 0 || sim.state.garrisonedIn[b] < 0); k++) sim.tick();
    expect([sim.state.garrisonedIn[a] >= 0, sim.state.garrisonedIn[b] >= 0, sim.state.garrisonedIn[2]]).toEqual([true, true, -1]);
    return sim;
  }
  const tiles = (sim: Sim, shooter: number, weapon: string): number | null => {
    const v = garrisonRangeTerm(sim, shooter, weapon);
    return v === null ? null : v / 65536;
  };

  it('is the building\'s own bonus: one tile in a house, the two tiles a block authors', () => {
    const sim = world();
    expect(tiles(sim, 0, 'rifles')).toBe(1);
    expect(tiles(sim, 1, 'rifles')).toBe(2);
  });
  it('is nothing in the open, for a weapon that does not fire from a building, or for an unknown shooter or weapon', () => {
    const sim = world();
    expect(tiles(sim, 2, 'rifles')).toBeNull();
    expect(tiles(sim, 1, 'sealed')).toBeNull();
    expect(tiles(sim, 1, 'nope')).toBeNull();
    expect(tiles(sim, -1, 'rifles')).toBeNull();
    expect(tiles(sim, 99, 'rifles')).toBeNull();
  });

  it('adds the bonus to an indirect weapon too, as the sim does, unless it is marked fires_from_building: false', () => {
    const sim = world();
    expect(tiles(sim, 1, 'lobber')).toBe(2);
    expect(tiles(sim, 0, 'lobber')).toBe(1);
    expect(tiles(sim, 1, 'sealed')).toBeNull();
  });

  const fire = (shooter: number, weaponId: string): SimEvent =>
    ({ kind: 'fire', tick: 1, shooter, target: 2, weaponId, pHit: 0, roll: 0, willHit: false,
       breakdown: { accuracy: 65536, rangeFalloff: 65536, coverMod: 65536, motionMod: 65536, stanceMod: 65536, suppressionMod: 65536 } }) as unknown as SimEvent;
  const feedText = (sim: Sim, e: SimEvent): string => {
    const host = document.createElement('div');
    const overlay = new DebugOverlay(host, sim, () => [], '0.1');
    overlay.toggle();
    overlay.onTick([e]);
    return host.textContent ?? '';
  };

  it('prints "inside +N.N tiles" on the factor line of a shot from a building, and nothing for a shot from the open', () => {
    const sim = world();
    expect(feedText(sim, fire(0, 'rifles'))).toContain('supp 100% · inside +1.0 tiles');
    expect(feedText(sim, fire(1, 'rifles'))).toContain('supp 100% · inside +2.0 tiles');
    expect(feedText(sim, fire(2, 'rifles'))).not.toContain('inside');
    expect(feedText(sim, fire(1, 'lobber'))).toContain('inside +2.0 tiles');
    expect(feedText(sim, fire(1, 'sealed'))).not.toContain('inside');
  });
});
