import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { SPECIALS_MAX, VERSUS_REFUSED_SPECIALS } from '@lions/net';
import { STORE_SPECIALS } from './store-specials';

type Gate = { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number };

/** Every bought-only unit in `units` order, read from the data. The predicate is the sim's
 *  `isBoughtOnly` restated (the Worker does not depend on the sim): a price, and no earned field. */
function fromData(): { id: string; faction: string }[] {
  const out: { id: string; faction: string }[] = [];
  for (const u of Object.values(units) as { id: string; faction: string; unlock?: Gate }[]) {
    const g = u.unlock;
    if (g === undefined) continue;
    const earned = g.roe_rating_min !== undefined || g.stars_min !== undefined || g.after_mission !== undefined;
    if (!earned && g.price !== undefined) out.push({ id: u.id, faction: u.faction });
  }
  return out;
}

describe('the Store specials a seat may claim (GH-1102)', () => {
  it("are exactly @lions/data's bought-only units, in `units` order, both ways", () => {
    const data = fromData().map((u) => u.id);
    expect([...STORE_SPECIALS], `paste into store-specials.ts:\n${JSON.stringify(data, null, 2)}`).toEqual(data);
  });
  it('are all KDF: a Sarim seat has no store, so it can own none', () => {
    for (const u of fromData()) expect(u.faction, u.id).toBe('kdf');
  });
  it('fit inside the bound validateConfig puts on a seat\'s unlocks', () => {
    expect(STORE_SPECIALS.length).toBeLessThanOrEqual(SPECIALS_MAX);
  });
  it('the refused three are Store specials, so the lobby can name each one (literal list)', () => {
    expect(Object.keys(VERSUS_REFUSED_SPECIALS).sort()).toEqual(['air_medevac_heli', 'spg_cluster', 'veh_ambulance']);
    for (const id of Object.keys(VERSUS_REFUSED_SPECIALS)) expect(STORE_SPECIALS, id).toContain(id);
  });
});
