import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

const RIFLES: UnitTypeJson = {
  id: 'p_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.6, penetration: 8, damage: 15, suppression: 40, rof_per_min: 300 },
  ],
};

function world(): { sim: Sim; inf: number } {
  const sim = new Sim({ seed: 7, width: 48, height: 48, capacity: 16 });
  const inf = sim.addUnitType(RIFLES);
  return { sim, inf };
}

/** Run n ticks, returning every event produced. */
function run(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

describe('hitFactors extraction', () => {
  it('leaves the factors on the fire event unchanged', () => {
    // A pure extraction must not move a single number. Two stationary squads
    // in the open: the first fire event's factors are fully determined.
    const { sim, inf } = world();
    sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    const events = run(sim, 20 * TICKS_PER_SECOND);
    const fire = events.find((e) => e.kind === 'fire');
    expect(fire).toBeDefined();
    if (fire?.kind !== 'fire') throw new Error('no fire event');

    // accuracy 0.6, no veterancy, so accuracy is exactly 0.6.
    expect(fx.toNumber(fire.breakdown.accuracy)).toBeCloseTo(0.6, 3);
    // Neither unit moves and neither is suppressed at first contact.
    expect(fx.toNumber(fire.breakdown.motionMod)).toBe(1);
    expect(fx.toNumber(fire.breakdown.stanceMod)).toBe(1);
    // pHit is the product of all six factors.
    const b = fire.breakdown;
    const product =
      fx.toNumber(b.accuracy) *
      fx.toNumber(b.rangeFalloff) *
      fx.toNumber(b.coverMod) *
      fx.toNumber(b.motionMod) *
      fx.toNumber(b.stanceMod) *
      fx.toNumber(b.suppressionMod);
    expect(fx.toNumber(fire.pHit)).toBeCloseTo(product, 2);
  });
});
