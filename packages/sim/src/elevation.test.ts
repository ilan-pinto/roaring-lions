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

  // E2 made losRay read elevation, so this no longer proves elevation is
  // inert -- it proves a *uniform* raise is baseline-neutral. Every tile
  // shares the same height, so h0 === h1 === elevation[t] everywhere along
  // any ray: the cross-multiplied comparison degenerates to `e*total >
  // e*total`, always false, and the rule that lets high ground see over a
  // rise has nothing to bite on. A short, deterministic firefight run twice
  // from the same seed -- once flat, once with every tile raised by the same
  // amount -- must still be identical in every observable except the hash.
  // If this ever fails, either a uniform plateau stopped being degenerate, or
  // something started reading elevation off the uniform-raise path too.
  it('a uniform plateau changes the hash and nothing else: same seed, flat vs. raised, identical outcome', () => {
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

// Elevation E2: losRay reads height. Each case authors relief, because on
// flat ground the new comparison can never fire -- every elevation is 0, so
// `0 > 0` is false for open ground and the rule is untestable there.
//
// The pairing is the point. "Cannot see" alone passes for a broken spawn, a
// too-short sight range, or too few ticks; each case below is paired with the
// arrangement that SHOULD see, so the assertions discriminate.
describe('elevation and line of sight', () => {
  const SCOUT: UnitTypeJson = {
    id: 'e_scout',
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.0 },
    sensors: { optics: 1, sight_tiles: 16, signature: 0.6 },
  };

  /** Two scouts on opposing sides at the given tiles, after detection settles. */
  function watch(
    build: (sim: Sim) => void,
    ax: number,
    ay: number,
    bx: number,
    by: number
  ): { sim: Sim; a: number; b: number } {
    const sim = new Sim({ seed: 9, width: 24, height: 12, capacity: 8 });
    build(sim);
    const t = sim.addUnitType(SCOUT);
    const a = sim.spawn(t, 0, fx.from(ax + 0.5), fx.from(ay + 0.5));
    const b = sim.spawn(t, 1, fx.from(bx + 0.5), fx.from(by + 0.5));
    for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
    return { sim, a, b };
  }

  /** A wall of raised open ground down column 8, `h` levels high. */
  const ridge = (h: number) => (sim: Sim): void => {
    for (let y = 0; y < 12; y++) sim.setElevation(8, y, h);
  };

  it('a rise between two units on the valley floor blocks them', () => {
    const { sim, a, b } = watch(ridge(3), 4, 6, 14, 6);
    expect(sim.debugDetection(a, b)?.visible).toBe(false);
  });

  it('and the same ground flat does not — the control', () => {
    const { sim, a, b } = watch(() => {}, 4, 6, 14, 6);
    expect(sim.debugDetection(a, b)?.visible).toBe(true);
  });

  it('a low-profile structure on a blocking ridge does not make the ridge transparent', () => {
    // A fence is see-through, not the rise it stands on. Planting one along
    // the same blocking ridge as the first test must not reopen the sight
    // line -- an obstacle can add cover, never subtract terrain.
    const { sim, a, b } = watch(
      (sim) => {
        ridge(3)(sim);
        const fence = sim.addStructureType({
          id: 'fence',
          name: 'Fence',
          hp_per_tile: 200,
          garrison_slots: 0,
          rubble_cover: 1,
          low_profile: true,
          standing_cover: 2,
        });
        for (let y = 0; y < 12; y++) sim.addStructure(fence, [y * sim.width + 8]);
      },
      4,
      6,
      14,
      6
    );
    expect(sim.debugDetection(a, b)?.visible).toBe(false);
  });

  it('a unit on high ground sees over a lower rise', () => {
    // Observer level with the ridge top, target beyond it. The sight line
    // runs from 3 down to 0, passing above the ridge's own 3 at its start.
    const { sim, a, b } = watch(
      (sim) => {
        ridge(2)(sim);
        for (let y = 0; y < 12; y++) sim.setElevation(4, y, 4);
      },
      4,
      6,
      14,
      6
    );
    expect(sim.debugDetection(a, b)?.visible).toBe(true);
  });

  it('rock blocks two units standing at its own elevation', () => {
    // The case that falsified the first draft of the rule. With rock's sight
    // height being its bare elevation, `3 > 3` is false and a solid ridge
    // goes transparent. BLOCK_RISE is what makes this block.
    const { sim, a, b } = watch(
      (sim) => {
        for (let y = 0; y < 12; y++) {
          for (let x = 0; x < 24; x++) sim.setElevation(x, y, 3);
        }
        for (let y = 0; y < 12; y++) sim.setBlocked(8, y, true);
      },
      4,
      6,
      14,
      6
    );
    expect(sim.debugDetection(a, b)?.visible).toBe(false);
  });

  it('a plateau with no obstruction does not block, however high', () => {
    // Guards the opposite error: raising everything equally must change
    // nothing, or the rule is comparing against the wrong baseline.
    const { sim, a, b } = watch(
      (sim) => {
        for (let y = 0; y < 12; y++) {
          for (let x = 0; x < 24; x++) sim.setElevation(x, y, 5);
        }
      },
      4,
      6,
      14,
      6
    );
    expect(sim.debugDetection(a, b)?.visible).toBe(true);
  });
});
