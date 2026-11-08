// tools/src/ui-review/store-garage-seed.test.ts
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_KEY, migrateAccount } from '../../../packages/app/src/brigade-account';
import { ROAR_KEY, migrateRoar } from '../../../packages/app/src/roar-wallet';
import { creditAsk } from '../../../packages/app/src/upgrade-pay';
import { units } from '@lions/data';
import { STORE_SEED_ACCOUNT, STORE_SEED_WALLET, storeSeedScript } from './store-garage-seed';

describe('the Store/Garage look sheet seed (WP10)', () => {
  it('is a fixed point of the account migration', () => {
    expect(migrateAccount(JSON.parse(JSON.stringify(STORE_SEED_ACCOUNT)))).toEqual(STORE_SEED_ACCOUNT);
  });

  it('is a fixed point of the wallet migration', () => {
    expect(migrateRoar(JSON.parse(JSON.stringify(STORE_SEED_WALLET)))).toEqual(STORE_SEED_WALLET);
  });

  it('is the mixed track: howitzer bought, coin armour 2, earned 0, medic not bought', () => {
    expect(STORE_SEED_ACCOUNT.unlocks).toEqual(['spg_long_range']);
    expect(STORE_SEED_ACCOUNT.upgrades).toEqual({});
    expect(STORE_SEED_ACCOUNT.balance).toBe(800);
    expect(STORE_SEED_WALLET.entitlements.upgrades.spg_long_range.armour.tier).toBe(2);
  });

  it('prices the howitzer armour as a run over tiers 1-3 that pays for 1-2 again', () => {
    const prices = units.spg_long_range.upgrades?.armour?.tiers.map((x) => x.price) ?? [];
    // literals, not the seed's own numbers: 160 + 240 + 340 = 740
    expect(creditAsk(prices, 0, 2)).toEqual({ from: 1, to: 3, price: 740, again: 2 });
  });

  it('writes all three keys from a script a page can run', () => {
    const map = new Map<string, string>();
    runInNewContext(storeSeedScript(), { localStorage: { setItem: (k: string, v: string) => void map.set(k, v) } });
    expect(JSON.parse(map.get(ACCOUNT_KEY) ?? 'null')).toEqual(STORE_SEED_ACCOUNT);
    expect(JSON.parse(map.get(ROAR_KEY) ?? 'null')).toEqual(STORE_SEED_WALLET);
    expect(map.size).toBe(3);
  });
});
