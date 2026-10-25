import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_KEY,
  buyUnlock,
  buyUpgrade,
  emptyAccount,
  loadAccount,
  migrateAccount,
  payMission,
  resetAccount,
  saveAccount,
  startCampaign,
  type StorageLike,
} from './brigade-account';

/** Map-backed, the shape a browser hands over -- not a spy. */
const store = (): StorageLike & { box: Map<string, string> } => {
  const box = new Map<string, string>();
  return {
    box,
    getItem: (k) => box.get(k) ?? null,
    setItem: (k, v) => void box.set(k, v),
    removeItem: (k) => void box.delete(k),
  };
};

describe('brigade account', () => {
  it('starts empty and round-trips through storage under its own key', () => {
    const s = store();
    expect(loadAccount(s)).toEqual(emptyAccount());
    const paid = payMission(emptyAccount(), 'beit_sahwan_1_recon', 160, 1000);
    saveAccount(s, paid.account);
    expect(s.box.has(ACCOUNT_KEY)).toBe(true);
    expect(loadAccount(s)).toEqual(paid.account);
  });

  it('pays a first win in full and records it', () => {
    const { account, paid } = payMission(emptyAccount(), 'm1', 160, 1000);
    expect(paid).toBe(160);
    expect(account.balance).toBe(160);
    expect(account.earned_total).toBe(160);
    expect(account.paid.m1).toBe(160);
    expect(account.grants).toEqual([{ source: 'earned', amount: 160, missionId: 'm1', at: 1000 }]);
  });

  it('pays a replay only for improvement, and moves the record up', () => {
    const first = payMission(emptyAccount(), 'm1', 160, 1000).account;
    const worse = payMission(first, 'm1', 120, 2000);
    expect(worse.paid).toBe(0);
    expect(worse.account.balance).toBe(160);
    expect(worse.account.paid.m1).toBe(160);
    expect(worse.account.grants).toHaveLength(1);
    const better = payMission(worse.account, 'm1', 190, 3000);
    expect(better.paid).toBe(30);
    expect(better.account.balance).toBe(190);
    expect(better.account.earned_total).toBe(190);
    expect(better.account.paid.m1).toBe(190);
  });

  it('never mutates the account it is given', () => {
    const before = emptyAccount();
    const snapshot = JSON.stringify(before);
    payMission(before, 'm1', 160, 1000);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('migrates junk and partial saves to a valid account', () => {
    expect(migrateAccount(null)).toEqual(emptyAccount());
    expect(migrateAccount('not json shaped')).toEqual(emptyAccount());
    expect(migrateAccount({ version: 1, balance: 50 })).toEqual({ ...emptyAccount(), balance: 50 });
    // A negative or non-integer balance is corruption, not a debt.
    expect(migrateAccount({ version: 1, balance: -5 }).balance).toBe(0);
    expect(migrateAccount({ version: 1, balance: 2.5 }).balance).toBe(0);
  });

  it('keeps a granted entry and counts it in the bound, and no client path writes one', () => {
    // The paid path's shape (spec §4.6) is data this module carries but never creates:
    // `payMission` is the only constructor of a grant and only ever writes 'earned',
    // but a save can already carry a well-formed 'granted' one (ruling R6), and this
    // module does not destroy it.
    const raw = { ...emptyAccount(), balance: 900, grants: [{ source: 'granted', amount: 900, at: 1 }] };
    const migrated = migrateAccount(raw);
    expect(migrated.grants).toEqual([{ source: 'granted', amount: 900, at: 1 }]);
    expect(migrated.balance).toBe(900);
    const paid = payMission(emptyAccount(), 'm1', 10, 1).account;
    expect(paid.grants.every((g) => g.source === 'earned')).toBe(true);
  });

  it('keeps a legitimate balance below the earned sum as is, and bounds earned_total the same way', () => {
    const raw = {
      ...emptyAccount(),
      balance: 40,
      earned_total: 40,
      grants: [{ source: 'earned', amount: 100, missionId: 'm1', at: 1 }],
    };
    const migrated = migrateAccount(raw);
    // 40 is below the 100 the log accounts for -- a legitimate spend (step 2 "Buy"),
    // not corruption, so it is kept exactly, not raised to 100.
    expect(migrated.balance).toBe(40);
    // A save claiming 500 earned_total against a log that accounts for only 100 is
    // bounded down the same way balance is.
    expect(migrateAccount({ ...raw, earned_total: 500 }).earned_total).toBe(100);
  });

  it('treats a present but non-array grants field as present, and bounds the balance to 0', () => {
    // Hand-edited to something that is not a log at all: `'grants' in r` still reads
    // true, `migrateGrants` reads it as empty, and a balance no entry explains is
    // reduced to 0 rather than trusted.
    const migrated = migrateAccount({ ...emptyAccount(), balance: 900, grants: 'not a log' });
    expect(migrated.balance).toBe(0);
    expect(migrated.grants).toEqual([]);
  });

  it('loads a corrupt key as empty rather than throwing', () => {
    const s = store();
    s.setItem(ACCOUNT_KEY, '{not json');
    expect(loadAccount(s)).toEqual(emptyAccount());
  });

  it('resets to empty and removes the key', () => {
    const s = store();
    saveAccount(s, payMission(emptyAccount(), 'm1', 160, 1000).account);
    expect(resetAccount(s)).toEqual(emptyAccount());
    expect(s.box.has(ACCOUNT_KEY)).toBe(false);
  });

  it('buys an unlock: deducts the price and records the id, without a grant', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const { account, ok } = buyUnlock(funded, 'mbt_lavi', 600);
    expect(ok).toBe(true);
    expect(account.balance).toBe(400);
    expect(account.unlocks).toEqual(['mbt_lavi']);
    expect(account.earned_total).toBe(1000);
    expect(account.grants).toHaveLength(1);
    expect(funded.balance).toBe(1000); // input untouched
  });

  it('refuses when the balance is short, the id is already bought, or the price is not an integer', () => {
    const funded = payMission(emptyAccount(), 'm1', 500, 1).account;
    expect(buyUnlock(funded, 'mbt_lavi', 600)).toEqual({ account: funded, ok: false });
    const bought = buyUnlock(funded, 'mbt_lavi', 500).account;
    expect(buyUnlock(bought, 'mbt_lavi', 0)).toEqual({ account: bought, ok: false });
    expect(buyUnlock(funded, 'x', 2.5)).toEqual({ account: funded, ok: false });
    expect(buyUnlock(funded, 'x', -1)).toEqual({ account: funded, ok: false });
    expect(buyUnlock(funded, 'x', 0).ok).toBe(false); // schema minimum is 1; price 0 authors nothing
  });

  it('round-trips a bought unlock through storage', () => {
    const s = store();
    saveAccount(s, buyUnlock(payMission(emptyAccount(), 'm1', 700, 1).account, 'ifv_namer', 700).account);
    expect(loadAccount(s).unlocks).toEqual(['ifv_namer']);
    expect(loadAccount(s).balance).toBe(0);
  });

  it('buys tier 1 of a track: deducts the price, records the tier, without a grant', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const { account, ok } = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300);
    expect(ok).toBe(true);
    expect(account.balance).toBe(700);
    expect(account.upgrades.inf_squad?.armour).toBe(1);
    expect(account.earned_total).toBe(1000);
    expect(account.grants).toHaveLength(1);
    expect(funded.balance).toBe(1000); // input untouched
  });

  it('buys tier 2 after tier 1', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const tier1Result = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300);
    expect(tier1Result.ok).toBe(true);
    const tier2Result = buyUpgrade(tier1Result.account, 'inf_squad', 'armour', 2, 400);
    expect(tier2Result.ok).toBe(true);
    expect(tier2Result.account.balance).toBe(300);
    expect(tier2Result.account.upgrades.inf_squad?.armour).toBe(2);
  });

  it('refuses tier 2 when at 0 (not the next tier)', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const { account, ok } = buyUpgrade(funded, 'inf_squad', 'armour', 2, 400);
    expect(ok).toBe(false);
    expect(account).toBe(funded); // same object by identity
  });

  it('refuses tier 1 when already at tier 1 (not the next tier)', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const tier1 = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300).account;
    const { account, ok } = buyUpgrade(tier1, 'inf_squad', 'armour', 1, 300);
    expect(ok).toBe(false);
    expect(account).toBe(tier1); // same object by identity
  });

  it('refuses tier 0 (not the next tier)', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const { account, ok } = buyUpgrade(funded, 'inf_squad', 'armour', 0, 300);
    expect(ok).toBe(false);
    expect(account).toBe(funded);
  });

  it('refuses when the balance is short', () => {
    const funded = payMission(emptyAccount(), 'm1', 100, 1).account;
    const { account, ok } = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300);
    expect(ok).toBe(false);
    expect(account).toBe(funded); // same object by identity
  });

  it('refuses when the price is not a positive integer', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    expect(buyUpgrade(funded, 'inf_squad', 'armour', 1, 0).ok).toBe(false);
    expect(buyUpgrade(funded, 'inf_squad', 'armour', 1, 2.5).ok).toBe(false);
    expect(buyUpgrade(funded, 'inf_squad', 'armour', 1, -1).ok).toBe(false);
  });

  it('preserves other units and tracks when upgrading one', () => {
    const funded = payMission(emptyAccount(), 'm1', 2000, 1).account;
    const step1 = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300).account;
    const step2 = buyUpgrade(step1, 'mbt_lavi', 'firepower', 1, 400).account;
    expect(step2.upgrades.inf_squad?.armour).toBe(1);
    expect(step2.upgrades.mbt_lavi?.firepower).toBe(1);
  });

  it('round-trips an upgrade through storage', () => {
    const s = store();
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    saveAccount(s, buyUpgrade(funded, 'inf_squad', 'armour', 1, 300).account);
    const loaded = loadAccount(s);
    expect(loaded.upgrades.inf_squad?.armour).toBe(1);
    expect(loaded.balance).toBe(700);
  });

  it('resetAccount clears upgrades (existing behaviour)', () => {
    const s = store();
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const upgraded = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300).account;
    saveAccount(s, upgraded);
    expect(resetAccount(s).upgrades).toEqual({});
  });
});

// GH-330: a new campaign pays again. Two improvement records -- the lifetime
// best (`paid`) and this campaign's best (`campaign_paid`) -- and `startCampaign`
// clears only the second.
describe('brigade account: a new campaign pays again (GH-330)', () => {
  it('measures a campaign-scoped payout against this campaign, and raises both records', () => {
    const a = payMission(emptyAccount(), 'm', 300, 1, 'campaign').account;
    expect(a.paid).toEqual({ m: 300 });
    expect(a.campaign_paid).toEqual({ m: 300 });
    const fresh = startCampaign(a);
    const second = payMission(fresh, 'm', 300, 2, 'campaign');
    expect(second.paid).toBe(300);
    expect(second.account.balance).toBe(600);
    expect(second.account.earned_total).toBe(600);
    expect(second.account.paid).toEqual({ m: 300 });
    expect(second.account.grants.map((g) => g.amount)).toEqual([300, 300]);
  });

  it('pays a replay inside one campaign only for improvement (D2)', () => {
    const a = payMission(emptyAccount(), 'm', 200, 1, 'campaign').account;
    expect(payMission(a, 'm', 200, 2, 'campaign').paid).toBe(0);
    expect(payMission(a, 'm', 150, 2, 'campaign').paid).toBe(0);
    const better = payMission(a, 'm', 260, 2, 'campaign');
    expect(better.paid).toBe(60);
    expect(better.account.campaign_paid).toEqual({ m: 260 });
  });

  it('keeps the lifetime best when a later campaign pays less', () => {
    const a = startCampaign(payMission(emptyAccount(), 'm', 300, 1, 'campaign').account);
    const b = payMission(a, 'm', 250, 2, 'campaign').account;
    expect(b.paid).toEqual({ m: 300 });
    expect(b.campaign_paid).toEqual({ m: 250 });
  });

  it('a lifetime-scoped payout is the rule as it stood: it ignores the campaign record', () => {
    const a = startCampaign(payMission(emptyAccount(), 'm', 300, 1).account);
    expect(a.campaign_paid).toEqual({});
    expect(payMission(a, 'm', 300, 2, 'lifetime').paid).toBe(0);
    expect(payMission(a, 'm', 300, 2).paid).toBe(0);
  });

  it('startCampaign clears only the campaign record', () => {
    const a = payMission(buyUnlock(payMission(emptyAccount(), 'm', 900, 1, 'campaign').account, 'u', 100).account, 'n', 50, 2, 'campaign').account;
    const b = startCampaign(a);
    expect(b.campaign_paid).toEqual({});
    expect({ ...b, campaign_paid: a.campaign_paid }).toEqual(a);
    expect(startCampaign(b)).toBe(b);
  });

  it('a campaign payout writes a grant, so the migration bound keeps the whole balance', () => {
    const a = payMission(startCampaign(payMission(emptyAccount(), 'm', 300, 1, 'campaign').account), 'm', 300, 2, 'campaign').account;
    expect(migrateAccount(JSON.parse(JSON.stringify(a))).balance).toBe(600);
  });

  it('migrates a version-1 save: the campaign record is paid restricted to this campaign (D4)', () => {
    const v1 = { version: 1, balance: 470, earned_total: 470, paid: { a: 310, b: 160 } };
    expect(migrateAccount(v1, new Set(['a'])).campaign_paid).toEqual({ a: 310 });
    expect(migrateAccount(v1, new Set()).campaign_paid).toEqual({});
    // No ledger to ask: conservative, nothing new is paid.
    expect(migrateAccount(v1).campaign_paid).toEqual({ a: 310, b: 160 });
  });

  it('a version-2 save keeps its campaign record, clamped to the lifetime best', () => {
    const v2 = { version: 2, balance: 0, paid: { a: 300, b: 100 }, campaign_paid: { a: 200, b: 999, c: 50 } };
    expect(migrateAccount(v2, new Set(['a', 'b', 'c'])).campaign_paid).toEqual({ a: 200, b: 100 });
  });
});

// --- coupons -----------------------------------------------------------------
// The fixture code below is NOT a shipped code; the shipped table holds hashes only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { redeemCoupon, type Coupon } from './brigade-account';
import { sha256Hex } from './sha256';

const hashOf = (s: string): string => createHash('sha256').update(s).digest('hex');
const FIXTURE: Coupon[] = [
  { id: 'fixture_a', sha256: hashOf('Fixture-Code-A'), credits: 500 },
  { id: 'fixture_b', sha256: hashOf('Fixture-Code-B'), credits: 70 },
  // Test-only codes with their own hashes: one entry that grants coins alone, and one
  // code with three entries under it (credits, coins, and a later credits top-up).
  { id: 'fixture_c', sha256: hashOf('Fixture-Code-C'), coins: 900 },
  { id: 'fixture_d_credits', sha256: hashOf('Fixture-Code-D'), credits: 40 },
  { id: 'fixture_d_coins', sha256: hashOf('Fixture-Code-D'), coins: 7000 },
  { id: 'fixture_d_more', sha256: hashOf('Fixture-Code-D'), credits: 2 },
];
const redeem = (a = emptyAccount(), code = 'Fixture-Code-A') => redeemCoupon(a, code, FIXTURE, sha256Hex, 1000);

describe('coupons', () => {
  it('matches by hash, trims, and is case-sensitive', () => {
    const r = redeem(emptyAccount(), '  Fixture-Code-A \n');
    expect(r.ok).toBe(true);
    expect(redeem(emptyAccount(), 'fixture-code-a').ok).toBe(false);
  });

  it('grants the credits and records the id, as a grant the balance bound can explain', () => {
    const r = redeem();
    if (!r.ok) throw new Error('refused');
    expect(r.credits).toBe(500);
    expect(r.coins).toBe(0);
    expect(r.account.balance).toBe(500);
    expect(r.account.earned_total).toBe(0);
    expect(r.account.coupons).toEqual(['fixture_a']);
    // Survives the migration that bounds balance by the grants log.
    expect(migrateAccount(JSON.parse(JSON.stringify(r.account)))).toEqual(r.account);
  });

  it('grants once per account, and a different coupon still works', () => {
    const first = redeem();
    if (!first.ok) throw new Error('refused');
    const again = redeem(first.account);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe('used');
    expect(again.account).toBe(first.account);
    const other = redeem(first.account, 'Fixture-Code-B');
    expect(other.ok && other.account.balance).toBe(570);
  });

  it('an entry with coins only moves no credit and writes no grant, but is recorded as redeemed', () => {
    const r = redeem(emptyAccount(), 'Fixture-Code-C');
    if (!r.ok) throw new Error('refused');
    expect(r.credits).toBe(0);
    expect(r.coins).toBe(900);
    expect(r.ids).toEqual(['fixture_c']);
    expect(r.account.balance).toBe(0);
    expect(r.account.grants).toEqual([]);
    expect(r.account.coupons).toEqual(['fixture_c']);
    expect(redeem(r.account, 'Fixture-Code-C')).toMatchObject({ ok: false, reason: 'used' });
  });

  it('one code with several entries: a first-time redeemer gets all of them', () => {
    const r = redeem(emptyAccount(), 'Fixture-Code-D');
    if (!r.ok) throw new Error('refused');
    expect(r.credits).toBe(42);
    expect(r.coins).toBe(7000);
    expect(r.ids).toEqual(['fixture_d_credits', 'fixture_d_coins', 'fixture_d_more']);
    expect(r.account.balance).toBe(42);
    expect(r.account.coupons).toEqual(['fixture_d_credits', 'fixture_d_coins', 'fixture_d_more']);
    expect(r.account.grants.map((g) => [g.source === 'granted' && g.couponId, g.amount])).toEqual([
      ['fixture_d_credits', 40],
      ['fixture_d_more', 2],
    ]);
    expect(migrateAccount(JSON.parse(JSON.stringify(r.account)))).toEqual(r.account);
  });

  it('one code with several entries: an earlier redeemer gets only what is new, then it is used', () => {
    // Redeemed the code back when only the credits entry existed.
    const before = { ...emptyAccount(), balance: 40, coupons: ['fixture_d_credits'] as string[] };
    const r = redeem(before, 'Fixture-Code-D');
    if (!r.ok) throw new Error('refused');
    expect(r.ids).toEqual(['fixture_d_coins', 'fixture_d_more']);
    expect(r.credits).toBe(2); // the credits entry is NOT paid again
    expect(r.coins).toBe(7000);
    expect(r.account.balance).toBe(42);
    expect(r.account.coupons).toEqual(['fixture_d_credits', 'fixture_d_coins', 'fixture_d_more']);
    const again = redeem(r.account, 'Fixture-Code-D');
    expect(again).toMatchObject({ ok: false, reason: 'used' });
    expect(again.account).toBe(r.account);
  });

  it('refuses an unknown or empty code and returns the account by identity', () => {
    const a = emptyAccount();
    for (const code of ['nope', '', '   ']) {
      const r = redeem(a, code);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('unknown');
        expect(r.account).toBe(a);
      }
    }
  });

  it('migrates a save with no coupons field to an empty list, keeps a stored one, drops junk', () => {
    expect(migrateAccount({ balance: 5 }).coupons).toEqual([]);
    expect(migrateAccount({ coupons: ['fixture_a', 7, null] }).coupons).toEqual(['fixture_a']);
  });

  it('a reset removes the redemptions, so the code works again', () => {
    const s = store();
    const first = redeem();
    if (!first.ok) throw new Error('refused');
    saveAccount(s, first.account);
    expect(loadAccount(s).coupons).toEqual(['fixture_a']);
    expect(redeem(resetAccount(s)).ok).toBe(true);
  });

  it('startCampaign (what ?fresh runs) leaves redemptions alone', () => {
    const first = redeem();
    if (!first.ok) throw new Error('refused');
    const withPay = payMission(first.account, 'm1', 50, 1).account;
    expect(startCampaign(withPay).coupons).toEqual(['fixture_a']);
  });

  it('data/coupons.json holds only well-formed hashes and no duplicate ids', () => {
    const file = JSON.parse(readFileSync(resolve(__dirname, '../../../data/coupons.json'), 'utf8')) as { coupons: Coupon[] };
    expect(file.coupons.length).toBeGreaterThan(0);
    for (const c of file.coupons) {
      expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect((c.credits ?? 0) + (c.coins ?? 0)).toBeGreaterThan(0);
    }
    expect(new Set(file.coupons.map((c) => c.id)).size).toBe(file.coupons.length);
  });

  // The lead's code carries two entries under one hash. `hash` is injected, so this reads the
  // shipped hash out of the table itself and never needs the code (which is not in the repo).
  describe('the shipped table: one code, credits and coins', () => {
    const shippedHash = (): string => {
      const first = JSON.parse(readFileSync(resolve(__dirname, '../../../data/coupons.json'), 'utf8')) as { coupons: Coupon[] };
      const h = first.coupons.find((c) => c.id === 'lead_special_units_10k')?.sha256;
      if (h === undefined) throw new Error('lead_special_units_10k missing');
      return h;
    };
    const table = JSON.parse(readFileSync(resolve(__dirname, '../../../data/coupons.json'), 'utf8')).coupons as Coupon[];
    const asLead = (a: ReturnType<typeof emptyAccount>) => redeemCoupon(a, 'any text', table, () => shippedHash(), 5);

    it('holds a credits entry and a coins entry under the same hash', () => {
      const credits = table.find((c) => c.id === 'lead_special_units_10k');
      const coins = table.find((c) => c.id === 'lead_roar_coins_100k');
      expect(credits).toMatchObject({ credits: 10000 });
      expect(coins).toMatchObject({ coins: 100000 });
      expect(coins?.credits).toBeUndefined();
      expect(coins?.sha256).toBe(credits?.sha256);
    });

    it('a first-time redeemer gets both', () => {
      const r = asLead(emptyAccount());
      if (!r.ok) throw new Error('refused');
      expect([r.credits, r.coins]).toEqual([10000, 100000]);
    });

    it('someone who redeemed before (the 10,000 only) gets the coins only, and then it is used', () => {
      const prior = { ...emptyAccount(), balance: 10000, coupons: ['lead_special_units_10k'] as string[] };
      const r = asLead(prior);
      if (!r.ok) throw new Error('refused');
      expect([r.credits, r.coins]).toEqual([0, 100000]);
      expect(r.account.balance).toBe(10000);
      expect(asLead(r.account)).toMatchObject({ ok: false, reason: 'used' });
    });
  });

  // The shipped code is never written in the repo. With COUPON_TEST_CODE set in the
  // environment the real table is checked against it; without, this is skipped.
  it.skipIf(!process.env.COUPON_TEST_CODE)('the shipped table grants 10,000 credits and 100,000 coins for the real code', async () => {
    const { coupons } = await import('@lions/data');
    const r = redeemCoupon(emptyAccount(), process.env.COUPON_TEST_CODE ?? '', coupons, sha256Hex, 1);
    expect(r.ok && [r.credits, r.coins]).toEqual([10000, 100000]);
  });
});
