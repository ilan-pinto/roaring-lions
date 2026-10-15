import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { validateConfig, type MatchConfig } from '@lions/net';
import { buildMatchWorld } from './match-world';
import { upgradePrepass } from '../upgrade-prepass';
import { roomKitTables, screenKit, sharedKitTiers } from './room-kit';

type Tiers = Record<string, Record<string, number>>;
/** A versus config, KDF against KDF, each SEAT's kit mode and tiers given. */
function room(tiers: [Tiers, Tiers], kit: 'matched' | 'brigade' = 'brigade'): MatchConfig {
  const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: 'kdf', kit, tiers: tiers[s], unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1234, map: 'tel_marum', mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}

const KDF_IDS = Object.values(units).filter((u) => u.faction === 'kdf').map((u) => u.id);
/** LITERAL: a mbt_lavi's armour tier 2 adds 450 hull hp -- a tier's patch is
 *  a cumulative delta over base (data/units/kdf/mbt_lavi.json) -- never read
 *  from the code under test. */
const LAVI_ARMOUR2_HP_KIT = 450;

describe('roomKitTables: a versus seat draws its own kit, from the world alone', () => {
  const kitted = buildMatchWorld(room([{}, { mbt_lavi: { armour: 2 } }]));
  /** Four of the Lavi's nine tiers: kit level 2. */
  const level2 = buildMatchWorld(room([{}, { mbt_lavi: { armour: 2, sensors: 2 } }]));

  it("side 1's seat reads side 1's kit", () => {
    // LITERALS: the kit LEVEL is thirds of the type's tiers owned
    // (`kitLevel`, @lions/data): the Lavi declares 3 + 3 + 3, so armour 2 is
    // 2 of 9 -> ceil(6/9) = 1, and armour 2 + sensors 2 is 4 of 9 ->
    // ceil(12/9) = 2. (The brief's fixture armour 2 reads level 1, not 2.)
    expect(roomKitTables(kitted, 1).unitKit.mbt_lavi).toBe(1);
    expect(roomKitTables(level2, 1).unitKit.mbt_lavi).toBe(2);
    expect(roomKitTables(kitted, 1).kitByType.get('mbt_lavi')?.hpKit).toBe(LAVI_ARMOUR2_HP_KIT);
  });

  it("side 0's seat reads side 0's kit, never side 1's", () => {
    expect(roomKitTables(kitted, 0).unitKit.mbt_lavi).toBe(0);
    expect(roomKitTables(level2, 0).unitKit.mbt_lavi).toBe(0);
    expect(roomKitTables(kitted, 0).kitByType.get('mbt_lavi')?.hpKit).toBe(0);
  });

  it('hands the renderer both sides, whoever is viewing', () => {
    for (const me of [0, 1] as const) {
      const bySide = roomKitTables(kitted, me).unitKitTiersBySide;
      expect(bySide[1].mbt_lavi).toEqual({ armour: 2 });
      expect(bySide[0].mbt_lavi).toEqual({});
    }
  });

  it('a matched world gives {} for every KDF id on both sides', () => {
    // Tiers in the config, `kit: 'matched'`: the claim is ignored.
    const matched = buildMatchWorld(room([{ mbt_lavi: { armour: 2 } }, { mbt_lavi: { armour: 2 } }], 'matched'));
    expect(KDF_IDS.length).toBeGreaterThan(0);
    for (const me of [0, 1] as const) {
      const t = roomKitTables(matched, me);
      for (const id of KDF_IDS) {
        expect(t.unitKitTiersBySide[0][id]).toEqual({});
        expect(t.unitKitTiersBySide[1][id]).toEqual({});
        expect(t.unitKit[id]).toBe(0);
      }
    }
  });
});

describe('sharedKitTiers: what a one-template renderer may draw in a room', () => {
  it('drops an id whose two sides differ, so neither side wears the other\'s kit', () => {
    const shared = sharedKitTiers([{ mbt_lavi: {}, ifv_namer: { armour: 1 } }, { mbt_lavi: { armour: 2 }, ifv_namer: { armour: 1 } }]);
    expect(shared.mbt_lavi).toEqual({});
    expect(shared.ifv_namer).toEqual({ armour: 1 });
    // Both sides kitted, differently: still neither side's.
    expect(sharedKitTiers([{ mbt_lavi: { armour: 1 } }, { mbt_lavi: { armour: 2 } }]).mbt_lavi).toEqual({});
  });

  it('keeps an id whose sides agree in a different key order', () => {
    const shared = sharedKitTiers([{ mbt_lavi: { armour: 1, sensors: 2 } }, { mbt_lavi: { sensors: 2, armour: 1 } }]);
    expect(shared.mbt_lavi).toEqual({ armour: 1, sensors: 2 });
  });

  it('a kitted world draws side 1\'s Lavi base until the renderer takes a template per side', () => {
    const w = buildMatchWorld(room([{}, { mbt_lavi: { armour: 2 } }]));
    expect(sharedKitTiers(roomKitTables(w, 1).unitKitTiersBySide).mbt_lavi).toEqual({});
  });
});

describe('sharedKitTiers agrees with buildMatchWorld on which ids differ', () => {
  // The renderer may draw one kit on an id only while the two sides run ONE
  // sim type for it. So an id must be dropped exactly when buildMatchWorld
  // registered side 1 its own copy (typeOfBySide differs) -- whatever either
  // side's predicate for "same kit" turns into later.
  const fixtures: [Tiers, Tiers][] = [
    [{}, {}],
    [{}, { mbt_lavi: { armour: 2 } }],
    [{ mbt_lavi: { armour: 1 } }, { mbt_lavi: { sensors: 1 } }], // same level, different kit
    [{ mbt_lavi: { armour: 1 }, ifv_namer: { armour: 1 } }, { mbt_lavi: { armour: 1 }, ifv_namer: { armour: 2 } }],
    [{ mbt_lavi: { armour: 0 } }, {}], // a zero tier fields nothing
    [{ mbt_lavi: { armour: 1, sensors: 0 } }, { mbt_lavi: { armour: 1 } }],
  ];

  it('drops exactly the ids that have a side-1 copy, over every fixture', () => {
    let copied = 0;
    let kept = 0;
    for (const tiers of fixtures) {
      const w = buildMatchWorld(room(tiers));
      const bySide = roomKitTables(w, 0).unitKitTiersBySide;
      const shared = sharedKitTiers(bySide);
      for (const id of KDF_IDS) {
        const hasCopy = w.typeOfBySide[1].get(id) !== w.typeOfBySide[0].get(id);
        // Kept is side 0's own table (by identity); dropped is a fresh `{}`.
        const isKept = shared[id] === bySide[0][id];
        expect({ tiers, id, dropped: !isKept }).toEqual({ tiers, id, dropped: hasCopy });
        if (hasCopy) {
          copied++;
          expect(shared[id]).toEqual({});
        } else kept++;
      }
    }
    // Not vacuous: both outcomes are exercised.
    expect(copied).toBe(3); // fixtures 2, 3 (Lavi) and 4 (Namer)
    expect(kept).toBeGreaterThan(0);
  });
});

describe("screenKit: bootBattlefield's one choice of kit source", () => {
  const roster = Object.values(units);

  it('no versus world: the boot prepass, table for table (single-player, sandbox, sandbox room)', () => {
    const prepass = upgradePrepass(roster, { mbt_lavi: { armour: 1 } });
    const k = screenKit(prepass, null, 0);
    expect(k.kitByType).toBe(prepass.kitByType);
    expect(k.unitKit).toBe(prepass.unitKit);
    expect(k.unitKitTiers).toBe(prepass.unitKitTiers);
    expect(k.unitKitTiersBySide).toBeUndefined();
  });

  it("a versus world: the viewer's side, never the boot prepass", () => {
    // A boot prepass holding a kit neither seat claimed: a room must not read it.
    const prepass = upgradePrepass(roster, { mbt_lavi: { armour: 3, sensors: 3, firepower: 3 } });
    const w = buildMatchWorld(room([{}, { mbt_lavi: { armour: 2, sensors: 2 } }]));
    expect(screenKit(prepass, w, 1).unitKit.mbt_lavi).toBe(2);
    expect(screenKit(prepass, w, 0).unitKit.mbt_lavi).toBe(0);
    expect(screenKit(prepass, w, 0).kitByType.get('mbt_lavi')?.level).toBe(0);
    expect(screenKit(prepass, w, 1).unitKitTiersBySide?.[1].mbt_lavi).toEqual({ armour: 2, sensors: 2 });
    // One renderer table for both sides draws the differing Lavi base, on both screens.
    expect(screenKit(prepass, w, 0).unitKitTiers.mbt_lavi).toEqual({});
    expect(screenKit(prepass, w, 1).unitKitTiers.mbt_lavi).toEqual({});
  });
});
