// The converge scene's order (GH-1360 S0): who it names, and how.
import { describe, expect, it, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { units } from '@lions/data';
import { orderConverge } from './sim-scaling';

describe('orderConverge', () => {
  it('names every living ground unit once, exact, counted by class; an aircraft is not ordered', () => {
    // mutation: the isAir skip dropped (the drone is named and counted a vehicle); `exact: true` dropped
    const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 16 });
    const typeOf = new Map<string, number>();
    for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as unknown as UnitTypeJson));
    const squad = typeOf.get('inf_squad') as number;
    const ids = [0, 1, 2].map((k) => sim.spawn(squad, 0, fx.from(3.5 + k), fx.from(3.5), 0));
    ids.push(sim.spawn(typeOf.get('mbt_lavi') as number, 0, fx.from(3.5), fx.from(8.5), 0));
    sim.spawn(typeOf.get('recon_drone') as number, 0, fx.from(3.5), fx.from(12.5), 0);
    const spy = vi.spyOn(sim, 'queueCommand');
    expect(orderConverge(sim)).toEqual({ foot: 3, vehicle: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const cmd = spy.mock.calls[0][0];
    expect(cmd).toMatchObject({ kind: 'move', ids, exact: true });
  });
});
