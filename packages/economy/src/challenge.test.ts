// GH-1395 slice 1 (checks C8, C9, C13 of the design): the challenge coin is 10, paid once per account on the lifetime
// record, only for a mission in the challenge index, and ORed (never doubled, never cleared) across a claim.
import { describe, expect, it } from 'vitest';
import type { LedgerData } from '@lions/sim';
import { CHALLENGE_LEDGER_KEY, challengeMissionIds } from '@lions/data';
import worldJson from '../../../data/campaign/world.json';
import { claimEvidence, maxRecord, raiseBy } from './claim';
import { EARN, earnDifference, evidenceFromLedger, roarBackfill, roarEarn, type VictoryWin } from './earn';
import { sanitiseLedger } from './ledger-shape';
import { emptyRoar, migrateRoar, type RoarWallet } from './wallet';
import { parseWorld, worldMissionIds } from './world';

const world = parseWorld(worldJson);
const ids = worldMissionIds(world);
const PILOT = 'beit_sahwan_2_foothold';
const PLAIN = 'khan_rafid_1_recon';
const coins = (w: RoarWallet): number => w.coins.free;
const win = (missionId: string, stars: number, challenge?: boolean, ledger: LedgerData = {}): VictoryWin => ({
  missionId,
  stars,
  ledger,
  ...(challenge === undefined ? {} : { challenge }),
});
const mark = { id: 'quiet_souk', roe: 90, ticks: 8000, lost: 0 };

describe('the table', () => {
  it('a challenge is worth 10 (lead ruling D1), a literal', () => {
    expect(EARN.challenge).toBe(10);
  });
  it('the pilot missions are world missions, so the index can pay', () => {
    for (const id of challengeMissionIds) expect(ids, id).toContain(id);
    expect(ids).toContain(PLAIN);
    expect(challengeMissionIds).not.toContain(PLAIN);
  });
});

describe('roarEarn: exactly 10, once per account', () => {
  const first = roarEarn(emptyRoar(), win(PILOT, 2, true), world, 1);
  it('a first win with the challenge beaten pays welcome + first win + stars + 10', () => {
    expect(first.awards.map((a) => a.source)).toEqual(['welcome', 'first_win', 'star', 'challenge']);
    expect(first.awards.find((a) => a.source === 'challenge')).toEqual({ source: 'challenge', coins: 10, missionId: PILOT });
    expect(first.total).toBe(EARN.welcome + EARN.firstWin + 2 * EARN.star + 10);
    expect(first.wallet.earn.missions[PILOT]).toEqual({ won: true, stars: 2, challenge: true });
    const r = first.wallet.receipts.at(-1);
    expect(r?.kind === 'earn' && r.source).toBe('challenge');
  });
  it('a second challenge win of the same mission pays 0', () => {
    const again = roarEarn(first.wallet, win(PILOT, 2, true), world, 2);
    expect(again.total).toBe(0);
    expect(again.wallet).toBe(first.wallet);
  });
  it('a challenge that comes later than the first win still pays its 10, once', () => {
    const plain = roarEarn(emptyRoar(), win(PILOT, 2, false), world, 1).wallet;
    expect(plain.earn.missions[PILOT]).toEqual({ won: true, stars: 2 });
    const later = roarEarn(plain, win(PILOT, 2, true), world, 2);
    expect(later.awards).toEqual([{ source: 'challenge', coins: 10, missionId: PILOT }]);
    expect(roarEarn(later.wallet, win(PILOT, 3, true), world, 3).awards.map((a) => a.source)).toEqual(['star']);
  });
  it('"New campaign" does not reopen it: the ledger starts over, the wallet record does not', () => {
    // A new campaign is a new (empty) ledger; the wallet is the same lifetime wallet.
    const again = roarEarn(first.wallet, win(PILOT, 2, true, {}), world, 3);
    expect(again.awards.some((a) => a.source === 'challenge')).toBe(false);
  });
  it('a mission with no challenge pays nothing for one, whatever the client says', () => {
    const r = roarEarn(emptyRoar(), win(PLAIN, 1, true), world, 1);
    expect(r.awards.some((a) => a.source === 'challenge')).toBe(false);
    expect(r.wallet.earn.missions[PLAIN]).toEqual({ won: true, stars: 1 });
  });
  it('absent or false is no challenge', () => {
    expect(roarEarn(emptyRoar(), win(PILOT, 1), world, 1).awards.some((a) => a.source === 'challenge')).toBe(false);
    expect(roarEarn(emptyRoar(), win(PILOT, 1, false), world, 1).awards.some((a) => a.source === 'challenge')).toBe(false);
  });
  it('the flag survives a round trip through the wallet reader, and only `true` is kept', () => {
    expect(migrateRoar(JSON.parse(JSON.stringify(first.wallet))).earn.missions[PILOT]).toEqual({ won: true, stars: 2, challenge: true });
    const forged = migrateRoar({ earn: { missions: { [PILOT]: { won: true, stars: 2, challenge: 'yes' } } } });
    expect(forged.earn.missions[PILOT]).toEqual({ won: true, stars: 2 });
  });
});

describe('earnDifference and the claim: 10 once, ORed, never doubled', () => {
  const none = { welcomed: true, campaignDone: false, backfilled: false, missions: {} };
  it('evidence of a beaten challenge pays 10 over the lifetime record, and only once', () => {
    const ev = { missions: { [PILOT]: { won: true, stars: 1, challenge: true as const } }, campaignDone: false };
    const r = earnDifference(none, ev, world);
    expect(r.coins).toBe(EARN.firstWin + EARN.star + 10);
    expect(r.record.missions[PILOT]).toEqual({ won: true, stars: 1, challenge: true });
    expect(r.raised.missions[PILOT]).toEqual({ won: true, stars: 1, challenge: true });
    expect(earnDifference(r.record, ev, world).coins).toBe(0);
  });
  it('a challenge alone (won and stars already held) raises the record by the flag', () => {
    const held = { ...none, missions: { [PILOT]: { won: true, stars: 3 } } };
    const r = earnDifference(held, { missions: { [PILOT]: { won: true, stars: 3, challenge: true as const } }, campaignDone: false }, world);
    expect(r.coins).toBe(10);
    expect(r.raised.missions).toEqual({ [PILOT]: { won: true, stars: 3, challenge: true } });
  });
  it('evidence for a mission without a challenge pays no challenge coin', () => {
    const r = earnDifference(none, { missions: { [PLAIN]: { won: true, stars: 0, challenge: true as const } }, campaignDone: false }, world);
    expect(r.coins).toBe(EARN.firstWin);
    expect(r.record.missions[PLAIN]).toEqual({ won: true, stars: 0 });
  });
  it('maxRecord and raiseBy OR the flag: the later side without it never clears it', () => {
    const a = { ...none, missions: { [PILOT]: { won: true, stars: 1, challenge: true as const } } };
    const b = { ...none, missions: { [PILOT]: { won: true, stars: 3 } } };
    expect(maxRecord(a, b).missions[PILOT]).toEqual({ won: true, stars: 3, challenge: true });
    expect(maxRecord(b, a).missions[PILOT]).toEqual({ won: true, stars: 3, challenge: true });
    expect(raiseBy(a, { missions: b.missions, welcomed: false, campaignDone: false }).missions[PILOT]).toEqual({ won: true, stars: 3, challenge: true });
    expect(maxRecord(b, b).missions[PILOT]).toEqual({ won: true, stars: 3 });
  });
  it('a guest wallet claimed twice (two devices) pays the challenge once', () => {
    const device: RoarWallet = { ...emptyRoar(), earn: { ...none, missions: { [PILOT]: { won: true, stars: 2, challenge: true } } } };
    const ev = claimEvidence({ wallet: device, ledgers: [], world });
    expect(ev.missions[PILOT]).toEqual({ won: true, stars: 2, challenge: true });
    const once = earnDifference(none, ev, world);
    const lifetime = maxRecord(once.record, none);
    const twice = earnDifference(lifetime, claimEvidence({ wallet: device, ledgers: [], world }), world);
    expect(once.coins).toBe(EARN.firstWin + 2 * EARN.star + 10);
    expect(twice.coins).toBe(0);
  });
});

describe('the ledger mark (C9): evidence, shape, and New campaign', () => {
  const ledger: LedgerData = {
    'campaign.completed_missions': [PILOT, PLAIN],
    'campaign.mission_results': { [PILOT]: { stars: 2, roe: 90, ticks: 8000, lost: 0 }, [PLAIN]: { stars: 1, roe: 70, ticks: 9000, lost: 1 } },
    [CHALLENGE_LEDGER_KEY]: { [PILOT]: mark, [PLAIN]: { ...mark, id: 'none' } },
  };
  it('a mark is evidence for a mission in the index only', () => {
    const ev = evidenceFromLedger(ledger, world);
    expect(ev.missions[PILOT]).toEqual({ won: true, stars: 2, challenge: true });
    expect(ev.missions[PLAIN]).toEqual({ won: true, stars: 1 });
  });
  it('the back-payment pays a marked ledger its 10, once', () => {
    const paid = roarBackfill(emptyRoar(), ledger, world, 1);
    const unmarked = roarBackfill(emptyRoar(), { ...ledger, [CHALLENGE_LEDGER_KEY]: {} }, world, 1);
    expect(coins(paid) - coins(unmarked)).toBe(10);
  });
  it('sanitiseLedger keeps a well-formed key by identity and drops a wrong row', () => {
    expect(sanitiseLedger(ledger)).toBe(ledger);
    const bad = { ...ledger, [CHALLENGE_LEDGER_KEY]: { [PILOT]: mark, broken: { id: 3, roe: 1, ticks: 1, lost: 0 } } };
    expect(sanitiseLedger(bad)[CHALLENGE_LEDGER_KEY]).toEqual({ [PILOT]: mark });
    expect(sanitiseLedger({ ...ledger, [CHALLENGE_LEDGER_KEY]: [1, 2] })[CHALLENGE_LEDGER_KEY]).toBeUndefined();
  });
  it('an unmarked ledger, as "New campaign" leaves it, is no evidence', () => {
    expect(evidenceFromLedger({ 'campaign.completed_missions': [PILOT] }, world).missions[PILOT]).toEqual({ won: true, stars: 0 });
  });
});
