import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

// Sim.setElevation is executed zero times across `pnpm test`, `pnpm balance`,
// `pnpm playtest` and every shipped mission: applyTerrain only calls it when
// elevation[t] !== 0, and every shipped map is flat. This file is the
// regression guard that closes that gap — see determinism.test.ts's pin
// comment for the full context.

const RIFLES: UnitTypeJson = {
  id: 'e_inf',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'rifle',
      type: 'small_arms',
      range_tiles: 8,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      suppression: 45,
      rof_per_min: 300,
    },
  ],
};

describe('elevation', () => {
  it('setElevation writes the tile it is told (non-square map, x != y)', () => {
    // 12 x 7: a transposed y*width+x -> x*width+y (or similar) index would
    // land in the wrong place on a non-square grid, and would not
    // coincidentally pass with x === y.
    const sim = new Sim({ seed: 1, width: 12, height: 7, capacity: 4 });
    sim.setElevation(3, 4, 2);
    expect(sim.elevation[4 * 12 + 3]).toBe(2);
    // The transposed slot, and everywhere else, must stay untouched.
    expect(sim.elevation[3 * 12 + 4]).toBe(0);
    for (let i = 0; i < sim.elevation.length; i++) {
      if (i === 4 * 12 + 3) continue;
      expect(sim.elevation[i], `tile ${i}`).toBe(0);
    }
  });

  it('reaches the hash: two otherwise-identical sims differ once elevation differs', () => {
    const a = new Sim({ seed: 9, width: 12, height: 7, capacity: 4 });
    const b = new Sim({ seed: 9, width: 12, height: 7, capacity: 4 });
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 12; x++) b.setElevation(x, y, 1);
    }
    expect(a.hash()).not.toBe(b.hash());
  });

  // The point of the file: elevation is drawn but not yet read by any sim
  // system (E2/E3 are the milestones that change this). A short, deterministic
  // firefight run twice from the same seed -- once flat, once with every tile
  // raised -- must be identical in every observable except the hash. If this
  // ever fails, something started reading elevation for behaviour.
  it('changes the hash and nothing else: same seed, flat vs. raised, identical outcome', () => {
    function scenario(raised: boolean): { sim: Sim; events: SimEvent[] } {
      const sim = new Sim({ seed: 42, width: 12, height: 7, capacity: 4 });
      if (raised) {
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 12; x++) sim.setElevation(x, y, 2);
        }
      }
      const inf = sim.addUnitType(RIFLES);
      const a = sim.spawn(inf, 0, fx.from(2.5), fx.from(3.5));
      const b = sim.spawn(inf, 1, fx.from(8.5), fx.from(3.5));
      sim.queueCommand({ kind: 'attackMove', ids: [a], x: fx.fromInt(10), y: fx.fromInt(3) });
      sim.queueCommand({ kind: 'attackMove', ids: [b], x: fx.fromInt(0), y: fx.fromInt(3) });
      const events: SimEvent[] = [];
      for (let t = 0; t < 5 * TICKS_PER_SECOND; t++) events.push(...sim.tick());
      return { sim, events };
    }

    const flat = scenario(false);
    const raised = scenario(true);

    // The hash DOES move -- elevation is genuinely part of state.
    expect(flat.sim.hash()).not.toBe(raised.sim.hash());

    // Everything else does not.
    expect(raised.sim.entityCount).toBe(flat.sim.entityCount);
    for (let i = 0; i < flat.sim.entityCount; i++) {
      expect(raised.sim.state.alive[i], `alive[${i}]`).toBe(flat.sim.state.alive[i]);
      expect(raised.sim.state.hp[i], `hp[${i}]`).toBe(flat.sim.state.hp[i]);
      expect(raised.sim.state.posX[i], `posX[${i}]`).toBe(flat.sim.state.posX[i]);
      expect(raised.sim.state.posY[i], `posY[${i}]`).toBe(flat.sim.state.posY[i]);
    }
    expect(raised.events).toEqual(flat.events);
  });
});
