import { describe, expect, it } from 'vitest';
import { applyUpgrades, units } from '@lions/data';
import { kitSummary } from './ui/kit-sign';
import { upgradePrepass } from './upgrade-prepass';

// The final review's parked item (e). `bootBattlefield` used to read the
// account's `ownedTiers` in TWO loops: one built the HUD card's kit per type
// (behind an `as unknown as UpgradableUnit` cast), the other patched the unit
// types it registers with the sim. Two loops over one read can drift -- a
// filter added to one and not the other, a different default -- and then the
// card shows a kit the mission is not running. One pure function now feeds
// both from the same per-type read.
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
});
