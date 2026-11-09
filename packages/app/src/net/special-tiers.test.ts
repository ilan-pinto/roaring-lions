// GH-1077 (Store/Garage WP8): the nine bought-only units' NEW upgrade tracks reach a brigade room.
//
// PR 1110 (GH-1102) walks a seat's tiers over the walked roster (`seatKitTiers(seat, walked)`: the
// base roster plus the appended specials) and tests it on `demo_tzav`. The nine's tracks did not
// exist then; these two cases are what proves they travel, one for each way a special can sit in
// the walked roster:
//   - `inf_grenadier`, a special that is in the BASE roster (`versusRoster()` holds it);
//   - `mbt_lavi_camo`, an APPENDED special (`VERSUS_HELD_UNITS` holds it out).
// `seatKitTiers(seats[s])` with the default roster would clean the camo Lavi's claim away, so the
// second case is the one that goes red if `buildMatchWorld` forgets `walked`; the first stays green.
//
// The hp literals are Q16.16 and hand-computed, never read through `applyUpgrades` (an oracle takes
// literals): hp x 65536.
//   inf_grenadier   base 400 (data/units/kdf/inf_grenadier.json) + armour tier 2 +60 = 460 -> 30146560
//   mbt_lavi_camo   base 3000 (mbt_lavi_camo.json) + armour tier 2 +450 = 3450 -> 226099200
//                   (its tracks copy mbt_lavi's, so 450 is mbt_lavi's tier-2 hp delta too)
import { describe, expect, it } from 'vitest';
import { sidesOfFactions, validateConfig, type MatchConfig } from '@lions/net';
import { buildMatchWorld, type MatchWorld } from './match-world';

const GRENADIER_BASE = 26214400; // 400 x 65536
const GRENADIER_ARMOUR2 = 30146560; // 460 x 65536
const CAMO_BASE = 196608000; // 3000 x 65536
const CAMO_ARMOUR2 = 226099200; // 3450 x 65536

type Kit = 'matched' | 'brigade';
function room(kit: Kit, seat0: { unlocks?: string[]; tiers?: Record<string, Record<string, number>> }): MatchConfig {
  const factions: ['kdf', 'kdf'] = ['kdf', 'kdf'];
  const sides = sidesOfFactions(factions);
  const seat = (s: 0 | 1) => ({
    seat: s, side: sides[s], faction: factions[s], kit,
    tiers: s === 0 ? seat0.tiers ?? {} : {}, unlocks: s === 0 ? seat0.unlocks ?? [] : [],
    player: `p${s}`, callsign: `c${s}`, kind: 'human' as const,
  });
  const c = validateConfig({
    matchId: 'M', code: 'ABCDEF', seed: 1234, map: 'tel_marum', mode: 'versus', seats: [seat(0), seat(1)],
    pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
  });
  if (c === null) throw new Error('bad fixture');
  return c;
}
const idOf = (w: MatchWorld, i: number): string => w.sim.unitTypes[w.sim.state.typeIdx[i]].id;
const hpOf = (w: MatchWorld, id: string, side: 0 | 1): number[] =>
  w.bySide[side].filter((i) => idOf(w, i) === id).map((i) => w.sim.state.hp[i]);

describe('the nine\'s tracks travel with the tiers (GH-1077 on GH-1102)', () => {
  it('inf_grenadier, a special in the base roster, is fielded at armour tier 2', () => {
    const owned = buildMatchWorld(room('brigade', { unlocks: ['inf_grenadier'], tiers: { inf_grenadier: { armour: 2 } } }));
    expect(hpOf(owned, 'inf_grenadier', 0)).toEqual([GRENADIER_ARMOUR2]);
    // Side 1 claimed nothing: no grenadier at all.
    expect(hpOf(owned, 'inf_grenadier', 1)).toEqual([]);
    // The same ownership with no tiers is the base hp, so the 460 above is the tier and not the unit.
    const plain = buildMatchWorld(room('brigade', { unlocks: ['inf_grenadier'] }));
    expect(hpOf(plain, 'inf_grenadier', 0)).toEqual([GRENADIER_BASE]);
  });

  it('the same claim in a matched room fields no inf_grenadier (the type is registered, nothing spawns it)', () => {
    const m = buildMatchWorld(room('matched', { unlocks: ['inf_grenadier'], tiers: { inf_grenadier: { armour: 2 } } }));
    expect(m.typeOf.has('inf_grenadier')).toBe(true);
    expect(hpOf(m, 'inf_grenadier', 0)).toEqual([]);
    expect(hpOf(m, 'inf_grenadier', 1)).toEqual([]);
  });

  it('mbt_lavi_camo, an appended special, is fielded at armour tier 2', () => {
    const owned = buildMatchWorld(room('brigade', { unlocks: ['mbt_lavi_camo'], tiers: { mbt_lavi_camo: { armour: 2 } } }));
    expect(hpOf(owned, 'mbt_lavi_camo', 0)).toEqual([CAMO_ARMOUR2]);
    const plain = buildMatchWorld(room('brigade', { unlocks: ['mbt_lavi_camo'] }));
    expect(hpOf(plain, 'mbt_lavi_camo', 0)).toEqual([CAMO_BASE]);
  });
});
