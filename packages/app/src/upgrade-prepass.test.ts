import { describe, expect, it, vi } from 'vitest';
import { applyUpgrades, kitLevel, units } from '@lions/data';
import { kitSummary } from './ui/kit-sign';
import { upgradePrepass } from './upgrade-prepass';

// The final review's parked item (e). `bootBattlefield` used to read the
// account's `ownedTiers` in TWO loops: one built the HUD card's kit per type
// (behind an `as unknown as UpgradableUnit` cast), the other patched the unit
// types it registers with the sim. Two loops over one read can drift -- a
// filter added to one and not the other, a different default -- and then the
// card shows a kit the mission is not running. One pure function now feeds
// both from the same per-type read.

// `applyUpgrades`, called through but RECORDED, so a test can compare what the
// renderer is handed against the tiers the sim's types were actually patched
// with -- not against a second reading of the account, which would agree with
// a prepass that read it twice.
const seen = vi.hoisted(() => [] as { id: string; tiers: unknown }[]);
vi.mock('@lions/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lions/data')>();
  return {
    ...actual,
    applyUpgrades: ((u: { id: string }, tiers: unknown) => {
      seen.push({ id: u.id, tiers });
      return (actual.applyUpgrades as (a: unknown, b: unknown) => unknown)(u, tiers);
    }) as typeof actual.applyUpgrades,
  };
});

describe('upgradePrepass', () => {
  const roster = Object.values(units);
  const owned = { at_team: { firepower: 2 }, mbt_lavi: { armour: 3, sensors: 1 } };

  it('registers every unit, in roster order -- the sim numbers its types by it', () => {
    const { registered } = upgradePrepass(roster, owned);
    expect(registered.map((u) => u.id)).toEqual(roster.map((u) => u.id));
  });

  it('patches a KDF type with its owned tiers, and reports the same kit for its card', () => {
    const { registered, kitByType } = upgradePrepass(roster, owned);
    const at = registered.find((u) => u.id === 'at_team');
    expect(at).toEqual(applyUpgrades(units.at_team, owned.at_team));
    expect(kitByType.get('at_team')).toEqual(kitSummary(units.at_team, owned.at_team));
    expect(kitByType.get('at_team')?.pips.find((p) => p.track === 'firepower')?.owned).toBe(2);
  });

  it('gives every KDF type a kit, bought or not, and no other faction one', () => {
    const { kitByType } = upgradePrepass(roster, owned);
    const kdf = roster.filter((u) => u.faction === 'kdf').map((u) => u.id);
    expect([...kitByType.keys()].sort()).toEqual([...kdf].sort());
    expect(kitByType.get('inf_squad')?.level).toBe(0);
  });

  it('never patches an enemy type, whatever the account says about its id', () => {
    const enemy = roster.find((u) => u.faction !== 'kdf');
    if (enemy === undefined) throw new Error('fixture: the roster has no enemy unit');
    const { registered } = upgradePrepass(roster, { ...owned, [enemy.id]: { armour: 3 } });
    expect(registered.find((u) => u.id === enemy.id)).toBe(enemy);
  });

  it('hands the renderer the level the card shows, for every KDF type and no other', () => {
    const { kitByType, unitKit } = upgradePrepass(roster, owned);
    expect(Object.keys(unitKit).sort()).toEqual([...kitByType.keys()].sort());
    for (const [id, summary] of kitByType) expect(unitKit[id], id).toBe(summary.level);
    expect(unitKit.mbt_lavi).toBe(kitLevel(units.mbt_lavi, owned.mbt_lavi));
  });

  it('hands the renderer, per KDF type, exactly the tiers applyUpgrades patched it with (GH-238)', () => {
    seen.length = 0;
    const { unitKitTiers, unitKit } = upgradePrepass(roster, owned);
    const kdf = roster.filter((u) => u.faction === 'kdf').map((u) => u.id);
    expect(Object.keys(unitKitTiers).sort()).toEqual([...kdf].sort());
    expect(Object.keys(unitKitTiers).sort()).toEqual(Object.keys(unitKit).sort());
    // Every KDF type was patched (`kitSummary` patches too, through the same
    // function, so an id can appear twice -- every call must agree).
    expect([...new Set(seen.map((s) => s.id))].sort()).toEqual([...kdf].sort());
    for (const { id, tiers } of seen) expect(unitKitTiers[id], id).toEqual(tiers);
    expect(unitKitTiers.mbt_lavi).toEqual({ armour: 3, sensors: 1 });
    expect(unitKitTiers.ifv_namer).toEqual({});
    // A copy, frozen: the renderer cannot write the account through it.
    expect(unitKitTiers.mbt_lavi).not.toBe(owned.mbt_lavi);
    expect(Object.isFrozen(unitKitTiers.mbt_lavi)).toBe(true);
  });

  it('reads the audit seed as the spec did: Lavi 3, rifles 1, AT 1, and the sim runs that Lavi', () => {
    const seed = {
      inf_squad: { armour: 2, sensors: 1 },
      at_team: { firepower: 1 },
      mbt_lavi: { armour: 3, sensors: 3, firepower: 3 },
    };
    const { unitKit, registered } = upgradePrepass(roster, seed);
    expect([unitKit.mbt_lavi, unitKit.inf_squad, unitKit.at_team, unitKit.ifv_namer]).toEqual([3, 1, 1, 0]);
    // Spec §1 F2: 3000 -> 3750 on the maxed Lavi. The mark and the sim read one object.
    expect(registered.find((u) => u.id === 'mbt_lavi')?.hull.hp).toBe(3750);
  });
});
