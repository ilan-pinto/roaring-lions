// Who costs how much of the side's population, read off the SHIPPED roster
// (spec plan docs/superpowers/plans/2026-10-04-gf3-population-cap-on-loan.md, D1).
//
// The parse lives in `unitTypeFromJson` and is unit-tested there against
// fixtures (packages/sim/src/sim.test.ts, "unit population"). This pins what the
// real JSON gives, from literals, so a unit whose `cost.population` is edited
// changes this file and has to be looked at. The expected values are literals,
// not a re-read of the JSON under test.
//
// packages/sim imports nothing and packages/data is a leaf, so tools/ is the
// only place that may hold both ends of this.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { unitTypeFromJson, type UnitTypeJson } from '../../packages/sim/src/sim';

describe('population on the shipped roster', () => {
  const byId = new Map((Object.values(units) as UnitTypeJson[]).map((u) => [u.id, u]));
  const population = (id: string) => {
    const u = byId.get(id);
    if (u === undefined) throw new Error(`no unit ${id} on the roster`);
    return unitTypeFromJson(u).population;
  };

  it('recon_drone takes no population: it is a drone with no crew', () => {
    expect(population('recon_drone')).toBe(0);
  });

  it('a shipped tank declares its population in JSON, and it is read', () => {
    // mbt_lavi authors `cost.population: 3`; the parse must carry it, not the default.
    expect(population('mbt_lavi')).toBe(3);
  });
});
