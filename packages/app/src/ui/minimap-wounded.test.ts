import { describe, expect, it } from 'vitest';
import { fx, Sim, type UnitTypeJson } from '@lions/sim';
import { units } from '@lions/data';
import { dotShape, unitDots } from './minimap';

const W = 16;
function world(): { sim: Sim; own: number; foe: number; civ: number } {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 16 });
  const inf = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
  const own = sim.spawn(inf, 0, fx.from(4), fx.from(4));
  const foe = sim.spawn(inf, 1, fx.from(8), fx.from(8));
  const civ = sim.spawn(inf, 2, fx.from(10), fx.from(10));
  return { sim, own, foe, civ };
}
const mark = (sim: Sim, id: number, state: number): void => {
  (sim.state.woundState as Uint8Array)[id] = state;
};

describe('minimap wounded mark (GH-707 P2)', () => {
  it('a world with nobody down builds dots with no wounded key at all', () => {
    const { sim } = world();
    for (const d of unitDots(sim, () => true)) expect(Object.keys(d)).not.toContain('wounded');
  });

  it('DOWN and STABILISED men are marked, whoever they are, once seen', () => {
    const { sim, own, foe, civ } = world();
    mark(sim, own, 1);
    mark(sim, foe, 2);
    mark(sim, civ, 1);
    const dots = unitDots(sim, () => true);
    expect(dots.map((d) => d.wounded)).toEqual([true, true, true]);
  });

  it('only the man who is down is marked', () => {
    const { sim, own } = world();
    mark(sim, own, 1);
    expect(unitDots(sim, () => true).map((d) => d.wounded === true)).toEqual([true, false, false]);
  });

  it('a `wounded`-role body is marked by its type alone, before the sim has stamped any state', () => {
    const { sim, foe } = world();
    (sim.unitTypes[sim.state.typeIdx[foe]] as { isWounded: boolean }).isWounded = true;
    expect(unitDots(sim, () => true).map((d) => d.wounded === true)).toEqual([true, true, true]);
  });

  it('a down man out of sight is not drawn at all (the fog rule is unchanged)', () => {
    const { sim, foe } = world();
    mark(sim, foe, 1);
    expect(unitDots(sim, (x) => x < 5).map((d) => d.side)).toEqual([0]);
  });

  it('wears a distinct shape; a still-suspected hostile stays the hollow diamond', () => {
    expect(dotShape('own', false, true)).toBe('wounded');
    expect(dotShape('hostile', false, true)).toBe('wounded');
    expect(dotShape('neutral', false, true)).toBe('wounded');
    expect(dotShape('hostile', true, true)).toBe('hollow');
    expect(dotShape('own')).toBe('square');
  });
});
