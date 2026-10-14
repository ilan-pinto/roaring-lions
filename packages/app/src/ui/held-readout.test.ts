/**
 * "2 / 4 inside" and the minimap's held outline (lead ruling 2026-10-14),
 * against a REAL `Sim`: two houses, one held by each side, garrisoned by the
 * sim's own garrison order rather than by writing its arrays.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { heldHoverTarget, heldReadout } from './held-readout';
import { heldMarks } from './minimap';

const RIFLES: UnitTypeJson = {
  id: 'held_rifles',
  hull: { hp: 100, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1.0, sight_tiles: 4, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [],
};

/** A 24x24 map: house A (2,2)-(3,3) held by side 0 with two men, house B
 *  (18,18)-(19,19) held by side 1 with one, far outside side 0's sight. */
function world(): { sim: Sim; a: number; b: number; inside: number[] } {
  const sim = new Sim({ seed: 3, width: 24, height: 24, capacity: 8 });
  const house = sim.addStructureType({ id: 'held_house', name: 'Test House', hp_per_tile: 200, garrison_slots: 4 });
  const tiles = (x0: number, y0: number): number[] => [y0 * 24 + x0, y0 * 24 + x0 + 1, (y0 + 1) * 24 + x0, (y0 + 1) * 24 + x0 + 1];
  const a = sim.addStructure(house, tiles(2, 2));
  const b = sim.addStructure(house, tiles(18, 18));
  const rifles = sim.addUnitType(RIFLES);
  const own = [sim.spawn(rifles, 0, fx.from(4.5), fx.from(2.5)), sim.spawn(rifles, 0, fx.from(4.5), fx.from(3.5))];
  const theirs = sim.spawn(rifles, 1, fx.from(20.5), fx.from(18.5));
  sim.queueCommand({ kind: 'garrison', ids: own, structure: a });
  sim.queueCommand({ kind: 'garrison', ids: [theirs], structure: b });
  for (let t = 0; t < 200; t++) {
    sim.tick();
    if (own.every((i) => sim.state.garrisonedIn[i] === a) && sim.state.garrisonedIn[theirs] === b) break;
  }
  return { sim, a, b, inside: [...own, theirs] };
}

const nothingSeen = (): boolean => false;
const seenTile = (tx: number, ty: number) => (wx: number, wy: number) => Math.floor(wx) === tx && Math.floor(wy) === ty;

describe('heldReadout', () => {
  it('counts the men in the viewer\'s own building against its places', () => {
    const { sim, a } = world();
    expect(sim.structures.occupants[a]).toBe(2);
    expect(heldReadout(sim, a, sim.entityCount, 0, nothingSeen)).toEqual({ s: a, name: 'Test House', n: 2, cap: 4, own: true });
  });

  it('says nothing of another side\'s building out of sight, and counts it in sight', () => {
    const { sim, b } = world();
    expect(heldReadout(sim, b, sim.entityCount, 0, nothingSeen)).toBeNull();
    expect(heldReadout(sim, b, sim.entityCount, 0, seenTile(19, 18))).toEqual({ s: b, name: 'Test House', n: 1, cap: 4, own: false });
  });

  it('is the seat\'s: side 1 is told its own house and not side 0\'s', () => {
    const { sim, a, b } = world();
    expect(heldReadout(sim, b, sim.entityCount, 1, nothingSeen)?.own).toBe(true);
    expect(heldReadout(sim, a, sim.entityCount, 1, nothingSeen)).toBeNull();
  });

  it('an empty building gives no count', () => {
    const { sim } = world();
    const empty = sim.addStructure(0, [10 * 24 + 10]);
    expect(heldReadout(sim, empty, sim.entityCount, 0, () => true)).toBeNull();
  });
});

describe('heldHoverTarget', () => {
  it('prefers the building under the pointer, then the one a hovered unit is in', () => {
    const { sim, a, b, inside } = world();
    const g = sim.state.garrisonedIn;
    expect(heldHoverTarget(g, a, [inside[2], -1])).toBe(a);
    expect(heldHoverTarget(g, -1, [inside[2], -1])).toBe(b);
    expect(heldHoverTarget(g, -1, [-1, inside[0]])).toBe(a);
    expect(heldHoverTarget(g, -1, [-1, -1])).toBe(-1);
  });
});

describe('heldMarks (the minimap outline)', () => {
  it('outlines the viewer\'s own held building always, another\'s only in sight', () => {
    const { sim, a, b } = world();
    expect(heldMarks(sim, 0, nothingSeen)).toEqual([{ s: a, holder: 0, box: [2, 2, 3, 3] }]);
    expect(heldMarks(sim, 0, seenTile(18, 19)).map((m) => [m.s, m.holder])).toEqual([
      [a, 0],
      [b, 1],
    ]);
  });
});
