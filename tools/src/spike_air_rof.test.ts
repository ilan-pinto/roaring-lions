// GH-982: the Spike AT team (`at_team`) reloads in 12 s (5 a minute) and engages aircraft.
// Data only: `data/units/kdf/at_team.json` weapons[0]. Sarim's Kornet (`atgm_cell`) stays at 3.
//
// Falsification (see the commit message): with `can_target` back to ["ground"] the aircraft
// checks go red (0 shots at a hovering Peten); with `rof_per_min` back to 3 the cadence check
// goes red (3 shots in 50 s, not 5).
import { describe, expect, it } from 'vitest';
import { Sim, fx, TICKS_PER_SECOND } from '@lions/sim';
import { units } from '@lions/data';

type Json = Record<string, unknown> & { weapons: { rof_per_min: number; can_target: string[] }[] };
const spike = units.at_team as unknown as Json;

/** Count the Spike's shots at a cold, unarmed, effectively unkillable target, `seconds` long. */
function shotsAt(targetId: string, seconds: number, shooter: Json = spike): number {
  const sim = new Sim({ seed: 982, width: 40, height: 24, capacity: 8 });
  const base = (units as unknown as Record<string, { hull: object }>)[targetId];
  const tt = sim.addUnitType({ ...base, id: `${targetId}_dummy`, weapons: [], hull: { ...base.hull, hp: 1_000_000 } } as never);
  const target = sim.spawn(tt, 0, fx.from(20.5), fx.from(12.5), 32768);
  const st = sim.addUnitType(shooter as never);
  const sh = sim.spawn(st, 1, fx.from(14.5), fx.from(12.5), 0); // 6 tiles: inside the 7.2 effective range
  sim.identifyTo(1, target);
  let shots = 0;
  for (let k = 0; k < seconds * TICKS_PER_SECOND; k++) {
    for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === sh && e.target === target) shots++;
  }
  return shots;
}

describe('Spike AT team (GH-982)', () => {
  it('the shipped data: 5 a minute, ground and air', () => {
    expect(spike.weapons[0].rof_per_min).toBe(5);
    expect([...spike.weapons[0].can_target].sort()).toEqual(['air', 'ground']);
  });

  it('Sarim Kornet is untouched at 3 a minute, ground only', () => {
    const kornet = units.atgm_cell as unknown as Json;
    expect(kornet.weapons[0].rof_per_min).toBe(3);
    expect(kornet.weapons[0].can_target).toEqual(['ground']);
  });

  it('fires at a hovering Peten (it fired 0 shots before)', () => {
    expect(shotsAt('heli_peten', 50)).toBeGreaterThanOrEqual(4);
  });

  it('fires at a Lavi once every 12 s: 5 shots in 50 s, not 3', () => {
    const n = shotsAt('mbt_lavi', 50);
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(6);
  });
});
