/**
 * GH-330: a new campaign pays again, and guard G-A. Walked over the real
 * `world.json` and the real account functions -- no fixture world, so a guard
 * whose missions stopped existing cannot pass vacuously.
 */
import { describe, expect, it } from 'vitest';
import worldJson from '../../../data/campaign/world.json';
import type { LedgerData } from '@lions/sim';
import { emptyAccount, startCampaign, type BrigadeAccount } from './brigade-account';
import { missionOpen, parseWorld } from './campaign';
import { payScope, payVictory } from './campaign-pay';

const world = parseWorld(worldJson);
const done = (...ids: string[]): LedgerData => ({ 'campaign.completed_missions': ids });
const marj = ['beit_sahwan_breach', 'beit_sahwan_1_recon', 'beit_sahwan_2_foothold', 'beit_sahwan_3_clearance',
  'beit_sahwan_4_subterranean', 'khan_rafid_1_recon', 'khan_rafid_2_foothold', 'khan_rafid_3_clearance',
  'deir_amun_1_recon', 'deir_amun_2_foothold', 'deir_amun_3_subterranean'];

describe('missionOpen (G-A)', () => {
  it('opens each Marj town\'s first mission on a fresh campaign, and nothing after it', () => {
    expect(missionOpen(world, 'beit_sahwan_breach', {})).toBe(true);
    expect(missionOpen(world, 'khan_rafid_1_recon', {})).toBe(true);
    expect(missionOpen(world, 'deir_amun_1_recon', {})).toBe(true);
    expect(missionOpen(world, 'khan_rafid_2_foothold', {})).toBe(false);
    expect(missionOpen(world, 'khan_rafid_3_clearance', {})).toBe(false);
  });

  it('opens a town\'s next mission, and keeps a done mission open', () => {
    expect(missionOpen(world, 'khan_rafid_2_foothold', done('khan_rafid_1_recon'))).toBe(true);
    expect(missionOpen(world, 'khan_rafid_1_recon', done('khan_rafid_1_recon'))).toBe(true);
    expect(missionOpen(world, 'khan_rafid_3_clearance', done('khan_rafid_1_recon'))).toBe(false);
  });

  it('closes every mission of a locked region, even a town opener', () => {
    expect(missionOpen(world, 'tel_marum_1_recon', {})).toBe(false);
    expect(missionOpen(world, 'tel_marum_1_recon', done(...marj))).toBe(true);
  });

  it('is false for an id outside world.json (the tutorial)', () => {
    expect(missionOpen(world, 'beit_sahwan_0_tutorial', {})).toBe(false);
    expect(missionOpen(world, 'no_such_mission', done('no_such_mission'))).toBe(false);
  });
});

describe('payVictory: a new campaign pays again, and a locked mission by address does not repeat', () => {
  // The app's own sequence: the ledger read at boot decides the scope, the
  // victory then adds the mission to the ledger.
  const play = (acct: BrigadeAccount, ledger: LedgerData, id: string, value: number) => {
    const r = payVictory(acct, world, id, ledger, value, 1);
    const prev = (ledger['campaign.completed_missions'] as string[] | undefined) ?? [];
    return { ...r, ledger: { ...ledger, 'campaign.completed_missions': prev.includes(id) ? prev : [...prev, id] } };
  };

  it('walks: win, replay, new campaign, win again; a locked mission by address pays its lifetime improvement only', () => {
    let acct = emptyAccount();
    let ledger: LedgerData = {};
    let r = play(acct, ledger, 'khan_rafid_1_recon', 310);
    expect([r.scope, r.paid]).toEqual(['campaign', 310]);
    ({ account: acct, ledger } = r);
    r = play(acct, ledger, 'khan_rafid_1_recon', 310);
    expect(r.paid).toBe(0); // D2: replay inside one campaign is improvement only

    // "New campaign": ledger gone, campaign record cleared.
    acct = startCampaign(acct);
    ledger = {};
    r = play(acct, ledger, 'khan_rafid_1_recon', 310);
    expect([r.scope, r.paid]).toEqual(['campaign', 310]);
    ({ account: acct, ledger } = r);
    expect(acct.balance).toBe(620);

    // By address, out of order: scope is lifetime. First time ever pays.
    r = play(acct, {}, 'khan_rafid_3_clearance', 216);
    expect([r.scope, r.paid]).toEqual(['lifetime', 216]);
    acct = startCampaign(r.account);
    // ... and after another new campaign, by address again: nothing.
    r = play(acct, {}, 'khan_rafid_3_clearance', 216);
    expect([r.scope, r.paid]).toEqual(['lifetime', 0]);
    expect(r.account).toBe(acct);
  });

  it('scopes from the ledger at BOOT: the town\'s next mission is campaign-scoped before its own victory is written', () => {
    expect(payScope(world, 'khan_rafid_2_foothold', done('khan_rafid_1_recon'))).toBe('campaign');
    expect(payScope(world, 'tel_marum_1_recon', {})).toBe('lifetime');
  });
});
