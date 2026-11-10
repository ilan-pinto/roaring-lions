import { describe, expect, it } from 'vitest';
import type { LedgerData } from '@lions/sim';
import worldJson from '../../../data/campaign/world.json';
import { earnDifference, roarBackfill } from './earn';
import { emptyRoar } from './wallet';
import { parseWorld, worldMissionIds } from './world';

const world = parseWorld(worldJson);
const ids = worldMissionIds(world);
const AT = 1_700_000_000_000;
const ledgerOf = (done: readonly string[], stars: Record<string, number>): LedgerData => ({
  'campaign.completed_missions': [...done],
  'campaign.mission_results': Object.fromEntries(Object.entries(stars).map(([id, s]) => [id, { stars: s, roe: 100, ticks: 1, lost: 0 }])) as LedgerData['campaign.mission_results'],
});
const a = ledgerOf([ids[0], ids[1]], { [ids[0]]: 1, [ids[1]]: 2 });
const c = ledgerOf(ids, Object.fromEntries(ids.map((i) => [i, 3])));
const held = { ...emptyRoar(), earn: { welcomed: true, campaignDone: false, backfilled: false, missions: { [ids[0]]: { won: true, stars: 1 } } } };
const dump = (w: ReturnType<typeof emptyRoar>, l: LedgerData) => JSON.stringify(roarBackfill(w, l, world, AT));

const GOLDEN_A =
  "{\"version\":1,\"coins\":{\"free\":135,\"paid\":0},\"entitlements\":{\"units\":{},\"upgrades\":{}},\"earn\":{\"welcomed\":true,\"campaignDone\":false,\"backfilled\":true,\"missions\":{\"beit_sahwan_breach\":{\"won\":true,\"stars\":1},\"beit_sahwan_1_recon\":{\"won\":true,\"stars\":2}}},\"receipts\":[{\"kind\":\"earn\",\"id\":\"1700000000000-1\",\"at\":1700000000000,\"coins\":{\"free\":135,\"paid\":0},\"source\":\"backfill\"}]}";
const GOLDEN_B =
  "{\"version\":1,\"coins\":{\"free\":20,\"paid\":0},\"entitlements\":{\"units\":{},\"upgrades\":{}},\"earn\":{\"welcomed\":true,\"campaignDone\":false,\"backfilled\":true,\"missions\":{\"beit_sahwan_breach\":{\"won\":true,\"stars\":1},\"beit_sahwan_1_recon\":{\"won\":true,\"stars\":2}}},\"receipts\":[{\"kind\":\"earn\",\"id\":\"1700000000000-1\",\"at\":1700000000000,\"coins\":{\"free\":20,\"paid\":0},\"source\":\"backfill\"}]}";
const GOLDEN_C =
  "{\"version\":1,\"coins\":{\"free\":925,\"paid\":0},\"entitlements\":{\"units\":{},\"upgrades\":{}},\"earn\":{\"welcomed\":true,\"campaignDone\":true,\"backfilled\":true,\"missions\":{\"beit_sahwan_breach\":{\"won\":true,\"stars\":3},\"beit_sahwan_1_recon\":{\"won\":true,\"stars\":3},\"beit_sahwan_2_foothold\":{\"won\":true,\"stars\":3},\"beit_sahwan_3_clearance\":{\"won\":true,\"stars\":3},\"beit_sahwan_4_subterranean\":{\"won\":true,\"stars\":3},\"khan_rafid_1_recon\":{\"won\":true,\"stars\":3},\"khan_rafid_2_foothold\":{\"won\":true,\"stars\":3},\"khan_rafid_3_clearance\":{\"won\":true,\"stars\":3},\"deir_amun_1_recon\":{\"won\":true,\"stars\":3},\"deir_amun_2_foothold\":{\"won\":true,\"stars\":3},\"deir_amun_3_subterranean\":{\"won\":true,\"stars\":3},\"tel_marum_1_recon\":{\"won\":true,\"stars\":3},\"tel_marum_2_foothold\":{\"won\":true,\"stars\":3},\"tel_marum_3_clearance\":{\"won\":true,\"stars\":3},\"qarn_hadid_1_recon\":{\"won\":true,\"stars\":3},\"qarn_hadid_2_foothold\":{\"won\":true,\"stars\":3},\"qarn_hadid_3_clearance\":{\"won\":true,\"stars\":3},\"umm_zeitoun_1_recon\":{\"won\":true,\"stars\":3},\"umm_zeitoun_2_buildup\":{\"won\":true,\"stars\":3},\"umm_zeitoun_3_clearance\":{\"won\":true,\"stars\":3},\"umm_zeitoun_4_clearance\":{\"won\":true,\"stars\":3},\"ein_qasab_1_recon\":{\"won\":true,\"stars\":3},\"ein_qasab_2_foothold\":{\"won\":true,\"stars\":3},\"ein_qasab_3_buildup\":{\"won\":true,\"stars\":3},\"wadi_halam_1_fords\":{\"won\":true,\"stars\":3},\"wadi_halam_2_laager\":{\"won\":true,\"stars\":3},\"wadi_halam_3_counterraid\":{\"won\":true,\"stars\":3},\"wadi_halam_4_village\":{\"won\":true,\"stars\":3},\"wadi_halam_5_depot\":{\"won\":true,\"stars\":3}}},\"receipts\":[{\"kind\":\"earn\",\"id\":\"1700000000000-1\",\"at\":1700000000000,\"coins\":{\"free\":925,\"paid\":0},\"source\":\"backfill\"}]}";
describe('roarBackfill output is byte-identical', () => {
  it('(a) two missions on an empty wallet', () => {
    expect(dump(emptyRoar(), a)).toBe(GOLDEN_A);
  });
  it('(b) the same ledger on a welcomed wallet holding mission 1 at 1 star', () => {
    expect(dump(held, a)).toBe(GOLDEN_B);
  });
  it('(c) every world mission at 3 stars', () => {
    expect(dump(emptyRoar(), c)).toBe(GOLDEN_C);
  });
});

describe('earnDifference', () => {
  it('pays only above the held best', () => {
    const [m1, m2] = ids;
    const record = { welcomed: true, campaignDone: false, backfilled: false, missions: { [m1]: { won: true, stars: 1 } } };
    const evidence = { missions: { [m1]: { won: true, stars: 2 }, [m2]: { won: true, stars: 2 } }, campaignDone: false };
    const r = earnDifference(record, evidence, world);
    expect(r.coins).toBe(25); // 5 (m1's second star) + 10 + 10 (m2's win and two stars)
    expect(r.record.missions[m1].stars).toBe(2);
    expect(r.record.missions[m2]).toEqual({ won: true, stars: 2 });
    expect(r.raised).toEqual({ missions: { [m1]: { won: true, stars: 2 }, [m2]: { won: true, stars: 2 } }, welcomed: false, campaignDone: false });
  });
  it('an unpaid difference raises nothing', () => {
    const [m1, m2] = ids;
    const record = { welcomed: true, campaignDone: false, backfilled: false, missions: { [m1]: { won: true, stars: 3 }, [m2]: { won: true, stars: 3 } } };
    const evidence = { missions: { [m1]: { won: true, stars: 2 }, [m2]: { won: true, stars: 2 } }, campaignDone: false };
    const r = earnDifference(record, evidence, world);
    expect(r.coins).toBe(0);
    expect(r.raised).toEqual({ missions: {}, welcomed: false, campaignDone: false });
  });
  it('walks the world order, not the evidence key order', () => {
    const [m1, m2] = ids;
    const record = { welcomed: false, campaignDone: false, backfilled: false, missions: {} };
    const evidence = { missions: { [m2]: { won: true, stars: 1 }, [m1]: { won: true, stars: 1 } }, campaignDone: false };
    expect(JSON.stringify(earnDifference(record, evidence, world).record.missions)).toBe(
      '{"beit_sahwan_breach":{"won":true,"stars":1},"beit_sahwan_1_recon":{"won":true,"stars":1}}',
    );
  });
});
