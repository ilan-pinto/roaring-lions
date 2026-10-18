import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { validateConfig, type MatchConfig } from '@lions/net';
import { buildMatchWorld } from './match-world';
import { upgradePrepass } from '../upgrade-prepass';
import { templateKey } from '@lions/render';
import { roomKitTables, screenKit } from './room-kit';

type Tiers = Record<string, Record<string, number>>;
type Faction = 'kdf' | 'sarim';
/** A versus config, KDF against KDF unless `factions` says otherwise, each
 *  SEAT's kit mode and tiers given. */
function room(tiers: [Tiers, Tiers], kit: 'matched' | 'brigade' = 'brigade', factions: [Faction, Faction] = ['kdf', 'kdf']): MatchConfig {
  const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: factions[s], kit, tiers: tiers[s], unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
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

describe("templateKey agrees with buildMatchWorld on which ids differ", () => {
  // The renderer gives a (type, side) its own vehicle template exactly when
  // side 1 runs its own sim type for that id: a template per side where
  // buildMatchWorld registered a side-1 copy (typeOfBySide differs), and the
  // ONE shared template everywhere else -- so a matched room, or a brigade
  // room whose seats agree, loads nothing new. `templateKey` lives in render,
  // which imports nothing from app, so this is what holds its rule to
  // the world's own split, whatever either turns into later.
  const fixtures: [Tiers, Tiers, [Faction, Faction]?][] = [
    [{}, {}],
    [{}, { mbt_lavi: { armour: 2 } }],
    [{ mbt_lavi: { armour: 1 } }, { mbt_lavi: { sensors: 1 } }], // same level, different kit
    [{ mbt_lavi: { armour: 1 }, ifv_namer: { armour: 1 } }, { mbt_lavi: { armour: 1 }, ifv_namer: { armour: 2 } }],
    [{ mbt_lavi: { armour: 0 } }, {}], // a zero tier fields nothing
    [{ mbt_lavi: { armour: 1, sensors: 0 } }, { mbt_lavi: { armour: 1 } }],
    [{ mbt_lavi: { armour: 1, sensors: 2 } }, { mbt_lavi: { sensors: 2, armour: 1 } }], // key order
    // A kitted KDF side 0 against a Sarim side 1: the world registers no
    // side-1 copy (side 1 fields no KDF type), so no `#s1` template either.
    [{ mbt_lavi: { armour: 2 } }, {}, ['kdf', 'sarim']],
  ];

  it('splits exactly the ids that have a side-1 copy, over every fixture', () => {
    let split = 0;
    let shared = 0;
    for (const [t0, t1, factions] of fixtures) {
      const tiers: [Tiers, Tiers] = [t0, t1];
      const w = buildMatchWorld(room(tiers, 'brigade', factions));
      const bySide = screenKit(upgradePrepass(Object.values(units), {}), w, 0).unitKitTiersBySide;
      for (const id of KDF_IDS) {
        const hasCopy = w.typeOfBySide[1].get(id) !== w.typeOfBySide[0].get(id);
        // Side 0 never splits; side 1 splits exactly where the sim did.
        expect(templateKey(id, 0, bySide)).toBe(id);
        const key = templateKey(id, 1, bySide);
        expect({ tiers, id, split: key !== id }).toEqual({ tiers, id, split: hasCopy });
        if (hasCopy) {
          split++;
          expect(key).toBe(`${id}#s1`);
        } else shared++;
      }
    }
    // Not vacuous: both outcomes are exercised.
    expect(split).toBe(3); // fixtures 2, 3 (Lavi) and 4 (Namer)
    expect(shared).toBeGreaterThan(0);
  });

  it("a Sarim side 0 against a kitted KDF side 1: one template per id, wearing side 1's kit", () => {
    // Side 0 fields no KDF type, so the id's one template is drawn by side 1
    // alone: it wears side 1's kit -- the kit side 1's sim copy runs -- and no
    // `#s1` copy is parsed beside a base template nobody draws.
    const w = buildMatchWorld(room([{}, { mbt_lavi: { armour: 2 } }], 'brigade', ['sarim', 'kdf']));
    expect(w.typeOfBySide[1].get('mbt_lavi')).not.toBe(w.typeOfBySide[0].get('mbt_lavi'));
    const bySide = screenKit(upgradePrepass(Object.values(units), {}), w, 1).unitKitTiersBySide;
    for (const id of KDF_IDS) expect(templateKey(id, 1, bySide)).toBe(id);
    // The table the renderer builds the `id` template from (`templateKitTiers`).
    expect(bySide?.[0].mbt_lavi).toEqual({ armour: 2 });
  });

  it('a matched room splits nothing, whatever the seats claimed', () => {
    const w = buildMatchWorld(room([{}, { mbt_lavi: { armour: 2 } }], 'matched'));
    const bySide = screenKit(upgradePrepass(Object.values(units), {}), w, 1).unitKitTiersBySide;
    for (const id of KDF_IDS) expect(templateKey(id, 1, bySide)).toBe(id);
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
    // The renderer's one table is side 0's on BOTH screens, and side 1's
    // differing Lavi draws from its own template (`templateKey`).
    expect(screenKit(prepass, w, 0).unitKitTiers.mbt_lavi).toEqual({});
    expect(screenKit(prepass, w, 1).unitKitTiers.mbt_lavi).toEqual({});
    expect(screenKit(prepass, w, 1).unitKitTiers).toBe(w.kitBySide[0].unitKitTiers);
    expect(templateKey('mbt_lavi', 1, screenKit(prepass, w, 0).unitKitTiersBySide)).toBe('mbt_lavi#s1');
  });
});
