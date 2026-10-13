// Lead ruling 2026-10-13: an anti-tank guided missile reaches at least as far as a
// tank gun, and here it reaches further.
//
// Before the ruling the Spike (`at_team`) reached 9 tiles and the Lavi's `gun_120`
// reached 12. A Spike team therefore never got a shot off before the tank's gun
// reached it. In the 24-match versus mirror the Spike fired at a Lavi twice.
//
// The real-world reference is kept as an ORDERING and not converted to metres. The
// weapon ranges here are an abstraction, and the walking scale of 3 m a tile would
// put a 120 mm gun at 36 m. The references are: tank gun, effective ~3 km; Spike LR
// ~4 km; Kornet ~5.5 km; Hellfire ~8 km. In range_tiles that becomes
// gun 12 < Spike 13 < Kornet 14 < Hellfire 15, one tile per rung.
//
// Only `range_tiles` moved. `effective_range_tiles` drives the accuracy falloff, and
// the §5.7 "ATGM Pk vs unprotected armour" target is the Spike at 5 tiles. Scaling
// the effective range with the range (Spike 10.4) measured 0.82 at max tier, outside
// the 0.60-0.80 band, so `pnpm balance` is what guards that half.
//
// Every weapon is looked up by id and the lookup throws when it misses. A renamed
// weapon fails loudly here instead of passing over an empty list.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';

interface Weapon {
  id: string;
  type: string;
  range_tiles: number;
}
const roster = units as unknown as Record<string, { weapons?: Weapon[] }>;

function weapon(unitId: string, weaponId: string): Weapon {
  const w = roster[unitId]?.weapons?.find((x) => x.id === weaponId);
  if (!w) throw new Error(`${unitId} carries no ${weaponId}`);
  return w;
}

/** Every kinetic tank gun in the shipped roster. It is read from the data so that a
 *  new or re-ranged gun cannot slip past the ruling unseen. It is also asserted
 *  non-empty and checked against the Lavi's literal, so the scan is not vacuous. */
function tankGuns(): Weapon[] {
  return Object.values(roster).flatMap((u) => (u.weapons ?? []).filter((w) => w.type === 'apfsds'));
}
const longestTankGun = (): number => Math.max(...tankGuns().map((w) => w.range_tiles));

describe('anti-tank missiles outrange tank guns (lead 2026-10-13)', () => {
  it('reads the tank gun it is measured against', () => {
    expect(tankGuns().length).toBeGreaterThan(0);
    expect(weapon('mbt_lavi', 'gun_120').range_tiles).toBe(12);
    expect(longestTankGun()).toBe(12);
  });

  it('the Spike reaches past every tank gun', () => {
    expect(weapon('at_team', 'spike_atgm').range_tiles).toBeGreaterThan(longestTankGun());
  });
});
