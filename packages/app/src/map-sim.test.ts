import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, structures } from '@lions/data';
import { standMapStructures } from './map-sim';

const map = parseMap(maps.beit_sahwan_outskirts);
const fresh = (): Sim => new Sim({ seed: 1, width: map.width, height: map.height, capacity: 8 });

describe('standMapStructures', () => {
  it('registers every catalogue type and stands one structure per run the map declares', () => {
    const sim = fresh();
    const idx = standMapStructures(sim, map);
    expect([...idx.keys()].sort()).toEqual(Object.keys(structures).sort());
    expect(sim.structureCount).toBe(map.structures.length);
  });

  it('names an unknown structure type rather than standing nothing', () => {
    const first = map.structures[0];
    if (first === undefined) throw new Error('fixture: the map stands buildings');
    const bad: typeof map = { ...map, structures: [{ ...first, type: 'bunker_x' }] };
    expect(() => standMapStructures(fresh(), bad)).toThrow(/bunker_x/);
  });
});
