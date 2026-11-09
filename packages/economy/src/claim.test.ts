import { describe, expect, it } from 'vitest';
import type { LedgerData } from '@lions/sim';
import worldJson from '../../../data/campaign/world.json';
import { claimEvidence, couponGrant, maxRecord, raiseBy } from './claim';
import { emptyRoar } from './wallet';
import { parseWorld, worldMissionIds } from './world';

const world = parseWorld(worldJson);
const [m1, m2] = worldMissionIds(world);
const ledgerOf = (stars: Record<string, number>): LedgerData => ({
  'campaign.completed_missions': Object.keys(stars),
  'campaign.mission_results': Object.fromEntries(Object.entries(stars).map(([id, s]) => [id, { stars: s, roe: 100, ticks: 1, lost: 0 }])) as LedgerData['campaign.mission_results'],
});

describe('claimEvidence', () => {
  it('takes the best of every source', () => {
    const wallet = { ...emptyRoar(), earn: { welcomed: true, campaignDone: false, backfilled: false, missions: { [m1]: { won: true, stars: 1 } } } };
    const ev = claimEvidence({ wallet, ledgers: [ledgerOf({ [m1]: 3, [m2]: 0 }), ledgerOf({ [m2]: 2 }), ledgerOf({ [m1]: 2 })], world });
    expect(ev.missions[m1]).toEqual({ won: true, stars: 3 });
    expect(ev.missions[m2]).toEqual({ won: true, stars: 2 });
    expect(ev.campaignDone).toBe(false);
  });
  it('clamps a star of 7 to 3 and drops a mission off the world', () => {
    const ev = claimEvidence({ wallet: emptyRoar(), ledgers: [ledgerOf({ [m1]: 7, not_a_world_mission: 3 })], world });
    expect(ev.missions[m1].stars).toBe(3);
    expect(ev.missions['not_a_world_mission']).toBeUndefined();
  });
});

describe('maxRecord and raiseBy', () => {
  it('maxRecord takes per-mission maxima, ORs the flags and keeps a.backfilled', () => {
    const a = { welcomed: false, campaignDone: true, backfilled: true, missions: { [m1]: { won: true, stars: 1 } } };
    const b = { welcomed: true, campaignDone: false, backfilled: false, missions: { [m1]: { won: false, stars: 2 }, [m2]: { won: true, stars: 1 } } };
    expect(maxRecord(a, b)).toEqual({ welcomed: true, campaignDone: true, backfilled: true, missions: { [m1]: { won: true, stars: 2 }, [m2]: { won: true, stars: 1 } } });
  });
  it('raiseBy raises only by what was raised', () => {
    const rec = { welcomed: false, campaignDone: false, backfilled: false, missions: { [m1]: { won: true, stars: 2 } } };
    const r = raiseBy(rec, { missions: { [m2]: { won: true, stars: 1 } }, welcomed: true, campaignDone: false });
    expect(r).toEqual({ welcomed: true, campaignDone: false, backfilled: false, missions: { [m1]: { won: true, stars: 2 }, [m2]: { won: true, stars: 1 } } });
  });
});

describe('couponGrant', () => {
  it('grants a positive integer and nothing else', () => {
    expect(couponGrant({})).toBe(0);
    expect(couponGrant({ coins: 2.5 })).toBe(0);
    expect(couponGrant({ coins: -1 })).toBe(0);
    expect(couponGrant({ coins: 100000 })).toBe(100000);
  });
});
