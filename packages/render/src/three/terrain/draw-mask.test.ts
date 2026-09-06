import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { drawBlockedMask } from './draw-mask';

function world() {
  const sim = new Sim({ seed: 5, width: 16, height: 16, capacity: 8 });
  const fence = sim.addStructureType({ id: 't_fence', hp_per_tile: 60, per_tile: true, low_profile: true });
  const house = sim.addStructureType({ id: 't_house', hp_per_tile: 260 });
  const f = sim.addStructure(fence, [3 * 16 + 3]);
  const h = sim.addStructure(house, [8 * 16 + 8, 8 * 16 + 9, 9 * 16 + 8, 9 * 16 + 9]);
  return { sim, f, h };
}

describe('drawBlockedMask', () => {
  it('lets the ground continue under a live low-profile structure, and keeps a building pad', () => {
    const { sim } = world();
    expect(sim.blocked[3 * 16 + 3]).not.toBe(0); // the sim still blocks the fence tile
    const draw = drawBlockedMask(sim);
    expect(draw[3 * 16 + 3]).toBe(0); // the renderer draws ground under it
    expect(draw[8 * 16 + 8]).not.toBe(0); // the house keeps its pad
    expect(draw[9 * 16 + 9]).not.toBe(0);
  });

  it('never touches the sim\'s own mask', () => {
    const { sim } = world();
    const before = Uint8Array.from(sim.blocked);
    drawBlockedMask(sim);
    expect(Array.from(sim.blocked)).toEqual(Array.from(before));
  });

  it('gives a dead low-profile structure its pad back -- rubble sits on bare ground', () => {
    const { sim, f } = world();
    sim.structures.alive[f] = 0;
    const draw = drawBlockedMask(sim);
    expect(draw[3 * 16 + 3]).toBe(sim.blocked[3 * 16 + 3]);
  });
});
