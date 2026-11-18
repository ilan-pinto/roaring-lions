/**
 * GH-1384: the branch switch FLIPPED (`vi.mock` of the one module that holds it), so this file shows exactly which pins move
 * when the lead opens it, and that nothing else does. `branch-switch.test.ts` holds the closed build to dev; the open rules
 * themselves are `branch-exclusive.test.ts`'s. Literals from data/units/kdf/mbt_lavi.json (firepower base 0.85 / 1300,
 * tier 2 +0.06 / +208, branch 1 accuracy +0.10, branch 2 penetration +325) and at_team.json (firepower is not branched).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../data/src/branches-open', () => ({ BRANCHES_OPEN: true }));

const { applyUpgrades, BRANCHES_OPEN, maxTiers, units } = await import('@lions/data');
const { shippedBranched } = await import('./branches');
const { ACCOUNT_VERSION, buyUpgradeRun, emptyAccount, migrateAccount } = await import('./brigade');
const { ROAR_VERSION, buyTierWithCoins, emptyRoar, migrateRoar } = await import('./wallet');

type Fire = { weapons: { accuracy: number; penetration: number }[] };
const lavi = units.mbt_lavi;

describe('the branch switch, flipped open: the pins that move', () => {
  it('opens every reader at once: the shipped table names the thirteen, and the stored versions move', () => {
    expect(BRANCHES_OPEN).toBe(true);
    expect(Object.keys(shippedBranched()).length).toBe(13);
    expect(ACCOUNT_VERSION).toBe(3);
    expect(ROAR_VERSION).toBe(2);
    expect(Object.keys(emptyAccount())).toContain('picks');
  });
  it('a branched tier reads its pick, and none reads the tier below (closed, all three read 0.95 / 1625)', () => {
    const at = (picks: Record<string, 1 | 2>) => (applyUpgrades(lavi, { firepower: 3 }, picks) as unknown as Fire).weapons[0];
    expect(at({ firepower: 1 }).penetration).toBe(1508);
    expect(at({ firepower: 1 }).accuracy).toBeCloseTo(0.95, 9);
    expect(at({ firepower: 2 }).penetration).toBe(1625);
    expect(at({ firepower: 2 }).accuracy).toBeCloseTo(0.91, 9);
    expect(at({}).penetration).toBe(1508);
    expect(at({}).accuracy).toBeCloseTo(0.91, 9);
  });
  it('an unbranched track is untouched by the flip', () => {
    const fp = applyUpgrades(units.at_team, { firepower: maxTiers(units.at_team).firepower }, {}) as unknown as Fire;
    const closedSame = applyUpgrades(units.at_team, { firepower: maxTiers(units.at_team).firepower }, {}, false) as unknown as Fire;
    expect(fp.weapons[0]).toEqual(closedSame.weapons[0]);
  });
  it('a pickless buy of a branched tier is refused, and an old tier 3 migrates to pick 1 with a marker', () => {
    const a = { ...emptyAccount(), balance: 2000, earned_total: 2000, upgrades: { mbt_lavi: { firepower: 2 } } };
    expect(buyUpgradeRun(a, 'mbt_lavi', 'firepower', 3, 3, [455, 680, 950]).ok).toBe(false);
    expect(buyTierWithCoins({ ...emptyRoar(), coins: { free: 500, paid: 0 } }, 'mbt_lavi', 'firepower', 3, 2, 95, 950, 7).ok).toBe(false);
    const m = migrateAccount({ version: 2, balance: 0, upgrades: { mbt_lavi: { firepower: 3 } } });
    expect([m.version, m.picks, m.legacy]).toEqual([3, { mbt_lavi: { firepower: 1 } }, { mbt_lavi: { firepower: true } }]);
    const w = migrateRoar({ entitlements: { units: {}, upgrades: { mbt_lavi: { firepower: { tier: 3, paidTiers: 0 } } } } });
    expect([w.version, w.entitlements.upgrades.mbt_lavi.firepower]).toEqual([2, { tier: 3, paidTiers: 0, branch: 1, legacy: true }]);
  });
});
