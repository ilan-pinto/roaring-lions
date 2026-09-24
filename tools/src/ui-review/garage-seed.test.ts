// tools/src/ui-review/garage-seed.test.ts
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { kitLevel, units, type UpgradableUnit } from '@lions/data';
import { starsEarned } from '@lions/sim';
import { ACCOUNT_KEY, migrateAccount } from '../../../packages/app/src/brigade-account';
import { campaignRoe } from '../../../packages/app/src/campaign';
import { memoryLedgerStore } from '../../../packages/app/src/ledger-store';
import { LEDGER_KEY } from '../../../packages/app/src/main-keys';
import { GARAGE_SEED_ACCOUNT, GARAGE_SEED_LEDGER, garageSeedScript } from './garage-seed';

describe('the garage seed (spec §1, "Audit conditions")', () => {
  it('reads back through LedgerStore as the audit state', () => {
    const store = memoryLedgerStore({
      [LEDGER_KEY]: JSON.stringify(GARAGE_SEED_LEDGER),
      [ACCOUNT_KEY]: JSON.stringify(GARAGE_SEED_ACCOUNT),
    });
    const account = store.readAccount();
    expect(account.balance).toBe(2400);
    expect(account.unlocks).toEqual(['mbt_lavi']);
    expect(account.upgrades).toEqual({
      inf_squad: { armour: 2, sensors: 1 },
      at_team: { firepower: 1 },
      mbt_lavi: { armour: 3, sensors: 3, firepower: 3 },
    });
    const ledger = store.readLedger();
    expect(starsEarned(ledger)).toBe(11);
    expect(campaignRoe(ledger)?.mean).toBe(83);
  });

  it('is the seed the spec read its kit levels off: L1, L1, L3', () => {
    const lvl = (id: keyof typeof units): number =>
      kitLevel(units[id] as unknown as UpgradableUnit, GARAGE_SEED_ACCOUNT.upgrades[id] ?? {});
    expect([lvl('inf_squad'), lvl('at_team'), lvl('mbt_lavi')]).toEqual([1, 1, 3]);
  });

  it('is a fixed point of the account migration', () => {
    expect(migrateAccount(JSON.parse(JSON.stringify(GARAGE_SEED_ACCOUNT)))).toEqual(GARAGE_SEED_ACCOUNT);
  });

  it('writes both keys as JSON strings, from a script a page can run', () => {
    const map = new Map<string, string>();
    runInNewContext(garageSeedScript(), { localStorage: { setItem: (k: string, v: string) => void map.set(k, v) } });
    expect(JSON.parse(map.get(ACCOUNT_KEY) ?? 'null')).toEqual(GARAGE_SEED_ACCOUNT);
    expect(JSON.parse(map.get(LEDGER_KEY) ?? 'null')).toEqual(GARAGE_SEED_LEDGER);
  });
});
