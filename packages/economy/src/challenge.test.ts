// GH-1395 slice 1 (checks C8, C13 of the design): the challenge coin is 10, paid once per account on the lifetime
// record, only for a mission in the challenge index; the claim pays it from a device WALLET only, once, and its OR never
// doubles or clears it; every earn.ts record write keeps the flag.
import { describe, expect, it } from 'vitest';
import type { LedgerData } from '@lions/sim';
import { CHALLENGE_LEDGER_KEY, challengeMissionIds } from '@lions/data';
import worldJson from '../../../data/campaign/world.json';
import { CHALLENGE_COINS, challengeDifference, payChallenge, withChallengeFlags } from './challenge-earn';
import { claimEvidence, maxRecord, raiseBy } from './claim';
import { EARN, earnDifference, evidenceFromLedger, roarBackfill, roarEarn } from './earn';
import { emptyRoar, migrateRoar, type EarnRecord, type RoarWallet } from './wallet';
import { parseWorld, worldMissionIds } from './world';

const world = parseWorld(worldJson);
const ids = worldMissionIds(world);
const PILOT = 'beit_sahwan_2_foothold';
const PLAIN = 'khan_rafid_1_recon';
const none: EarnRecord = { welcomed: true, campaignDone: false, backfilled: false, missions: {} };
/** A win the way the victory settle pays it: the table first, then the challenge. */
const winWith = (w: RoarWallet, missionId: string, stars: number, at: number) => {
  const r = roarEarn(w, { missionId, stars, ledger: {} }, world, at);
  const c = payChallenge(r.wallet, missionId, at);
  return { wallet: c.wallet, awards: c.award === null ? r.awards : [...r.awards, c.award] };
};

describe('the coin', () => {
  it('a challenge is worth 10 (lead ruling D1), a literal; the table is untouched', () => {
    expect(CHALLENGE_COINS).toBe(10);
    expect(EARN).toEqual({ welcome: 100, firstWin: 10, star: 5, campaign: 100 });
  });
  it('the pilot missions are world missions, so the index can pay', () => {
    for (const id of challengeMissionIds) expect(ids, id).toContain(id);
    expect(challengeMissionIds).not.toContain(PLAIN);
  });
});

describe('payChallenge: exactly 10, once per account', () => {
  const first = winWith(emptyRoar(), PILOT, 2, 1);
  it('the first beaten challenge pays 10 after the win\'s own awards, and sets the lifetime flag', () => {
    expect(first.awards.map((a) => a.source)).toEqual(['welcome', 'first_win', 'star', 'challenge']);
    expect(first.awards.at(-1)).toEqual({ source: 'challenge', coins: 10, missionId: PILOT });
    expect(first.wallet.coins.free).toBe(100 + 10 + 10 + 10);
    expect(first.wallet.earn.missions[PILOT]).toEqual({ won: true, stars: 2, challenge: true });
    const r = first.wallet.receipts.at(-1);
    expect(r?.kind === 'earn' && r.source).toBe('challenge');
  });
  it('a second challenge win pays 0, and the same wallet comes back', () => {
    const again = payChallenge(first.wallet, PILOT, 2);
    expect(again.award).toBeNull();
    expect(again.wallet).toBe(first.wallet);
  });
  it('a later star keeps the flag (roarEarn writes `...prev`), so it never reopens the coin', () => {
    const star = roarEarn(first.wallet, { missionId: PILOT, stars: 3, ledger: {} }, world, 3);
    expect(star.wallet.earn.missions[PILOT]).toEqual({ won: true, stars: 3, challenge: true });
    expect(payChallenge(star.wallet, PILOT, 4).award).toBeNull();
  });
  it('"New campaign" does not reopen it: the ledger starts over, the wallet record does not', () => {
    const replay = winWith(first.wallet, PILOT, 2, 5);
    expect(replay.awards).toEqual([]);
  });
  it('a mission with no challenge pays nothing for one', () => {
    const r = payChallenge(roarEarn(emptyRoar(), { missionId: PLAIN, stars: 1, ledger: {} }, world, 1).wallet, PLAIN, 1);
    expect(r.award).toBeNull();
    expect(r.wallet.earn.missions[PLAIN]).toEqual({ won: true, stars: 1 });
  });
  it('the flag survives the wallet reader, and only `true` is kept', () => {
    expect(migrateRoar(JSON.parse(JSON.stringify(first.wallet))).earn.missions[PILOT]).toEqual({ won: true, stars: 2, challenge: true });
    expect(migrateRoar({ earn: { missions: { [PILOT]: { won: true, stars: 2, challenge: 'yes' } } } }).earn.missions[PILOT]).toEqual({ won: true, stars: 2 });
    const kept = migrateRoar(JSON.parse(JSON.stringify(first.wallet))).receipts.at(-1);
    expect(kept?.kind === 'earn' && kept.source).toBe('challenge');
  });
});

describe('the claim: from a device wallet only, once, ORed', () => {
  const flagged = (missions: Record<string, { won: boolean; stars: number; challenge?: true }>): RoarWallet => ({ ...emptyRoar(), earn: { ...none, missions } });
  it('a flagged device wallet proves 10 per indexed mission beyond the lifetime record, once', () => {
    const device = flagged({ [PILOT]: { won: true, stars: 2, challenge: true }, [PLAIN]: { won: true, stars: 1, challenge: true } });
    const d = challengeDifference(none, device);
    expect(d).toMatchObject({ coins: 10, ids: [PILOT] });
    expect(d.record.missions[PILOT]).toEqual({ won: true, stars: 0, challenge: true });
    expect(challengeDifference(d.record, device).coins).toBe(0);
  });
  it('a forged flag on every world mission is worth 10 x the index, never 10 x 29', () => {
    const device = flagged(Object.fromEntries(ids.map((id) => [id, { won: true, stars: 3, challenge: true as const }])));
    expect(challengeDifference(none, device).coins).toBe(10 * challengeMissionIds.length);
    expect(challengeMissionIds.length).toBe(6);
  });
  it('withChallengeFlags keeps won and stars', () => {
    const r = withChallengeFlags({ ...none, missions: { [PILOT]: { won: true, stars: 3 } } }, [PILOT]);
    expect(r.missions[PILOT]).toEqual({ won: true, stars: 3, challenge: true });
    expect(withChallengeFlags(none, [])).toBe(none);
  });
  it('maxRecord and raiseBy OR the flag: the side without it never clears it', () => {
    const a = { ...none, missions: { [PILOT]: { won: true, stars: 1, challenge: true as const } } };
    const b = { ...none, missions: { [PILOT]: { won: true, stars: 3 } } };
    expect(maxRecord(a, b).missions[PILOT]).toEqual({ won: true, stars: 3, challenge: true });
    expect(maxRecord(b, a).missions[PILOT]).toEqual({ won: true, stars: 3, challenge: true });
    expect(raiseBy(a, { missions: b.missions, welcomed: false, campaignDone: false }).missions[PILOT]).toEqual({ won: true, stars: 3, challenge: true });
    expect(maxRecord(b, b).missions[PILOT]).toEqual({ won: true, stars: 3 });
  });
  it('claimEvidence ORs the flag across sources; earnDifference keeps it on the record it raises', () => {
    const device = flagged({ [PILOT]: { won: true, stars: 1, challenge: true } });
    expect(claimEvidence({ wallet: device, ledgers: [], world }).missions[PILOT]).toEqual({ won: true, stars: 1, challenge: true });
    const held = { ...none, missions: { [PILOT]: { won: true, stars: 1, challenge: true as const } } };
    const d = earnDifference(held, { missions: { [PILOT]: { won: true, stars: 3 } }, campaignDone: false }, world);
    expect(d.coins).toBe(10);
    expect(d.record.missions[PILOT]).toEqual({ won: true, stars: 3, challenge: true });
  });
});

describe('the ledger mark is never coin evidence', () => {
  const ledger: LedgerData = {
    'campaign.completed_missions': [PILOT],
    'campaign.mission_results': { [PILOT]: { stars: 2, roe: 90, ticks: 8000, lost: 0 } },
    [CHALLENGE_LEDGER_KEY]: { [PILOT]: { id: 'quiet_souk', roe: 90, ticks: 8000, lost: 0 } },
  };
  it('a hand-edited ledger or save slot proves no challenge coin: only the wallet flag does', () => {
    expect(evidenceFromLedger(ledger, world).missions[PILOT]).toEqual({ won: true, stars: 2 });
    expect(roarBackfill(emptyRoar(), ledger, world, 1).coins.free).toBe(roarBackfill(emptyRoar(), { ...ledger, [CHALLENGE_LEDGER_KEY]: {} }, world, 1).coins.free);
  });
});
