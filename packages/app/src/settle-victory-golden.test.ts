/**
 * settle_victory_is_one_write (GH-1075 A2, Task 2.9): `settleVictory` over the GUEST store writes exactly the bytes it
 * wrote before `recordVictory` existed. The literals below were captured from the code BEFORE the change (fixture:
 * first world mission, 2 stars, account balance 7, at 1234), not recomputed here.
 */
import { describe, expect, it } from 'vitest';
import worldJson from '../../../data/campaign/world.json';
import { ACCOUNT_KEY, emptyAccount } from './brigade-account';
import { parseWorld } from './campaign';
import { LEDGER_KEY } from './main-keys';
import { memoryLedgerStore, type LedgerStore } from './ledger-store';
import { settleVictory, worldMissionIds } from './roar-earn';
import { ROAR_KEY } from './roar-wallet';

const world = parseWorld(worldJson);
const first = worldMissionIds(world)[0] ?? '';
const ledger = { 'campaign.completed_missions': [first] };
const run = (store: LedgerStore) =>
  settleVictory(store, { ledger, account: { ...emptyAccount(), balance: 7 }, win: { missionId: first, stars: 2, ledger }, world, at: 1234, start: null });

const GOLDEN_BYTES: Record<string, string> = {
  "lions.brigade.account": "{\"version\":2,\"balance\":7,\"earned_total\":0,\"paid\":{},\"campaign_paid\":{},\"unlocks\":[],\"upgrades\":{},\"grants\":[],\"coupons\":[]}",
  "lions.campaign.ledger": "{\"campaign.completed_missions\":[\"beit_sahwan_breach\"]}",
  "lions.roar": "{\"version\":1,\"coins\":{\"free\":120,\"paid\":0},\"entitlements\":{\"units\":{},\"upgrades\":{}},\"earn\":{\"welcomed\":true,\"campaignDone\":false,\"backfilled\":false,\"missions\":{\"beit_sahwan_breach\":{\"won\":true,\"stars\":2}}},\"receipts\":[{\"kind\":\"earn\",\"id\":\"1234-1\",\"at\":1234,\"coins\":{\"free\":100,\"paid\":0},\"source\":\"welcome\"},{\"kind\":\"earn\",\"id\":\"1234-2\",\"at\":1234,\"coins\":{\"free\":10,\"paid\":0},\"source\":\"first_win\",\"missionId\":\"beit_sahwan_breach\"},{\"kind\":\"earn\",\"id\":\"1234-3\",\"at\":1234,\"coins\":{\"free\":10,\"paid\":0},\"source\":\"star\",\"missionId\":\"beit_sahwan_breach\"}]}"
};
const GOLDEN_SETTLE = "{\"write\":\"saved\",\"awards\":[{\"source\":\"welcome\",\"coins\":100},{\"source\":\"first_win\",\"coins\":10,\"missionId\":\"beit_sahwan_breach\"},{\"source\":\"star\",\"coins\":10,\"missionId\":\"beit_sahwan_breach\",\"stars\":2}],\"total\":120,\"balance\":120}";

describe('settle_victory_is_one_write', () => {
  it('writes the bytes it wrote before recordVictory, and answers the same', () => {
    const store = memoryLedgerStore();
    const settled = run(store);
    expect(Object.fromEntries([...store.map.entries()].sort())).toEqual(GOLDEN_BYTES);
    expect(JSON.stringify(settled)).toBe(GOLDEN_SETTLE);
  });

  it('a refused account write puts the ledger and the wallet back, exactly (all or none)', () => {
    const seed = { [LEDGER_KEY]: '{"campaign.completed_missions":[]}', [ROAR_KEY]: JSON.stringify({ version: 1, coins: { free: 3, paid: 0 }, entitlements: { units: {}, upgrades: {} }, earn: { welcomed: false, campaignDone: false, backfilled: true, missions: {} }, receipts: [] }) };
    const store = memoryLedgerStore(seed);
    const before = Object.fromEntries([...store.map.entries()].sort());
    const setItem = store.map.set.bind(store.map);
    // The account key is the one a browser at its quota refuses.
    store.map.set = (k: string, v: string) => {
      if (k === ACCOUNT_KEY) throw new Error('QuotaExceededError');
      return setItem(k, v);
    };
    const settled = run(store);
    expect(settled.write).toBe('refused');
    expect(settled.awards).toEqual([]);
    expect(Object.fromEntries([...store.map.entries()].sort())).toEqual(before);
  });
});
