import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { footprintCentre } from './footprint';

describe('footprintCentre', () => {
  it('is (min + max + 1) / 2 on each axis -- max is an inclusive tile index', () => {
    const sim = new Sim({ seed: 1, width: 6, height: 6, capacity: 4 });
    const hallType = sim.addStructureType({ id: 'hall', hp_per_tile: 100, height_px: 34, color: 'limestone.4' });
    const shantyType = sim.addStructureType({ id: 'shanty', hp_per_tile: 50, height_px: 11, color: 'dust.1' });
    const w = 6;
    const hall = sim.addStructure(hallType, [1 + 1 * w, 2 + 1 * w, 1 + 2 * w, 2 + 2 * w]);
    const shanty = sim.addStructure(shantyType, [4 + 4 * w]);
    expect(footprintCentre(sim, hall)).toEqual({ fx: 2, fy: 2 }); // (1+2+1)/2
    expect(footprintCentre(sim, shanty)).toEqual({ fx: 4.5, fy: 4.5 }); // (4+4+1)/2
  });
});
