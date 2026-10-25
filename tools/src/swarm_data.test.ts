// E6 (GH-274) N2: the shipped drone swarm carries the lead-approved hit_mult (0.08, "0.08 and build
// the rule"), and a rifle's projected shot at it is scaled by exactly that. Without the field the
// swarm would be as easy to hit as any soft unit and rifles would not be poor against it.
import { describe, expect, it } from 'vitest';
import { Sim, fx } from '@lions/sim';
import { units } from '@lions/data';

describe('drone_swarm data: hit_mult', () => {
  it('authors 0.08 and the sim applies it to a rifle shot', () => {
    expect((units.drone_swarm as unknown as { swarm: { hit_mult?: number } }).swarm.hit_mult).toBe(0.08);
    const sim = new Sim({ seed: 1, width: 24, height: 16, capacity: 4 });
    const sw = sim.addUnitType(units.drone_swarm);
    const rifle = sim.addUnitType(units.inf_squad);
    const s = sim.spawn(sw, 1, fx.from(12.5), fx.from(8.5));
    const g = sim.spawn(rifle, 0, fx.from(8.5), fx.from(8.5));
    sim.identifyTo(0, s);
    const p = sim.projectHit(g, s);
    if (p.kind !== 'shot') throw new Error('a rifle squad should have a shot at the swarm');
    expect(p.factors.sizeMod).toBe(fx.from(0.08));
  });
});
