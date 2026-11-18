// GH-1395 slice 1: whether a won run beat its challenge, the campaign mark, and the coins end to end through the
// guest store and the signed-in outbox (checks C8, C11, C13, C14 of the design).
import { describe, expect, it } from 'vitest';
import { CHALLENGE_LEDGER_KEY, DIFFICULTY_LEDGER_KEY, challengeOf } from '@lions/data';
import { missions } from '@lions/data/content';
import type { LedgerData, MissionJson } from '@lions/sim';
import { starsEarned } from '@lions/sim';
import worldJson from '../../../data/campaign/world.json';
import { viewOf } from './account/replay';
import type { OutboxOp } from './account/outbox';
import { parseWorld } from './campaign';
import { amended, amendedMission, challengeMarkFor, challengeMarksOf, runRowOf, victoryMark, withChallengeMark, type ChallengeRunInput } from './challenge';
import { memoryLedgerStore, newCampaign, type CampaignLedger } from './ledger-store';
import { campaignMission } from './posture';
import { settleVictory } from './victory-settle';
import { emptyRoar } from './roar-wallet';

const world = parseWorld(worldJson);
const BS2 = 'beit_sahwan_2_foothold';
const foothold = missions.beit_sahwan_2_foothold as unknown as MissionJson;
/** Beit Sahwan II is next once First Light and Recon are won: open at boot. */
const opened: LedgerData = {
  'campaign.completed_missions': ['beit_sahwan_breach', 'beit_sahwan_1_recon'],
  'campaign.mission_results': {
    beit_sahwan_breach: { stars: 2, roe: 90, ticks: 6000, lost: 1 },
    beit_sahwan_1_recon: { stars: 2, roe: 90, ticks: 8000, lost: 0 },
  },
};
const beaten = { roe: 95, ticks: 8000, lost: 0, carriesAll: true };
const input = (o: Partial<ChallengeRunInput> = {}): ChallengeRunInput => ({
  missionId: BS2,
  result: 'victory',
  amendments: ['light_order', 'no_medic'],
  ledgerAtBoot: opened,
  world,
  targetMinutes: 7,
  run: beaten,
  ...o,
});

describe('challengeMarkFor', () => {
  it('Quiet Souk, beaten: the mark is the challenge id and the run’s own row', () => {
    expect(challengeOf(BS2)?.challenge.id).toBe('quiet_souk');
    expect(challengeMarkFor(input())).toEqual({ id: 'quiet_souk', roe: 95, ticks: 8000, lost: 0 });
  });
  it('extra amendments on top are allowed (D7); a missing one is not', () => {
    expect(challengeMarkFor(input({ amendments: ['light_order', 'no_medic', 'thin_purse'] }))).not.toBeNull();
    expect(challengeMarkFor(input({ amendments: ['no_medic'] }))).toBeNull();
    expect(challengeMarkFor(input({ amendments: [] }))).toBeNull();
  });
  it('not on Easier (GH-1394 D9); Harder and Standard record it', () => {
    expect(challengeMarkFor(input({ ledgerAtBoot: { ...opened, [DIFFICULTY_LEDGER_KEY]: 'easier' } }))).toBeNull();
    expect(challengeMarkFor(input({ ledgerAtBoot: { ...opened, [DIFFICULTY_LEDGER_KEY]: 'harder' } }))).not.toBeNull();
    expect(challengeMarkFor(input({ ledgerAtBoot: { ...opened, [DIFFICULTY_LEDGER_KEY]: 'standard' } }))).not.toBeNull();
  });
  it('no farm (C11): a mission not open at boot records nothing', () => {
    expect(challengeMarkFor(input({ ledgerAtBoot: {} }))).toBeNull();
  });
  it('the predicate must hold, and only a victory counts', () => {
    expect(challengeMarkFor(input({ run: { ...beaten, lost: 1 } }))).toBeNull();
    expect(challengeMarkFor(input({ run: { ...beaten, ticks: 8401 } }))).toBeNull();
    expect(challengeMarkFor(input({ result: 'defeat' }))).toBeNull();
  });
  it('a mission without a challenge never has one', () => {
    expect(challengeMarkFor(input({ missionId: 'khan_rafid_1_recon', amendments: [] }))).toBeNull();
  });
});

describe('withChallengeMark: best-of, this campaign only', () => {
  const m = { id: 'quiet_souk', roe: 80, ticks: 8000, lost: 0 };
  it('writes the first mark, keeps the better one, and leaves the ledger alone for none', () => {
    const one = withChallengeMark(opened, BS2, m);
    expect(one[CHALLENGE_LEDGER_KEY]).toEqual({ [BS2]: m });
    expect(withChallengeMark(one, BS2, { ...m, ticks: 9000 })).toBe(one);
    expect(withChallengeMark(one, BS2, { ...m, ticks: 7000 })[CHALLENGE_LEDGER_KEY]).toEqual({ [BS2]: { ...m, ticks: 7000 } });
    expect(withChallengeMark(opened, BS2, null)).toBe(opened);
  });
  it('the mark is not a star (D2): starsEarned reads the same with and without it', () => {
    const marked = withChallengeMark(opened, BS2, m);
    expect(starsEarned(opened)).toBe(4);
    expect(starsEarned(marked)).toBe(4);
  });
});

describe('amendedMission: the posture first, the amendments last, the sim none the wiser', () => {
  it('no amendments is exactly campaignMission (the mission itself at Standard)', () => {
    expect(amendedMission(foothold, {}, [])).toBe(foothold);
    expect(amendedMission(foothold, { [DIFFICULTY_LEDGER_KEY]: 'easier' }, [])).toStrictEqual(campaignMission(foothold, { [DIFFICULTY_LEDGER_KEY]: 'easier' }));
  });
  it('Easier x5/4 then Light order: the clock is the posture\'s alone (840 to 1050), and one rifle squad fewer (2 to 1)', () => {
    const squads = (m: typeof foothold) => (m.starting_force ?? []).filter((p) => p.unit === 'inf_squad').reduce((n, p) => n + p.count, 0);
    const easier = amendedMission(foothold, { [DIFFICULTY_LEDGER_KEY]: 'easier' }, ['light_order']);
    expect([foothold.time_limit_s, easier.time_limit_s]).toEqual([840, 1050]);
    expect([squads(foothold), squads(easier)]).toEqual([2, 1]);
    // No amendment moves the clock (the lead dropped Tight clock, PR 1524).
    expect(amendedMission(foothold, {}, ['light_order', 'no_medic', 'thin_purse']).time_limit_s).toBe(840);
  });
  it('refuses an amendment the mission does not offer', () => {
    expect(() => amendedMission(foothold, {}, ['no_eyes'])).toThrow(/does not offer/);
  });
});

describe('the coins, end to end on the guest store: exactly 10 once', () => {
  const settle = (store: ReturnType<typeof memoryLedgerStore>, ledgerAtBoot: LedgerData, at: number) => {
    const mark = challengeMarkFor(input({ ledgerAtBoot }));
    const ledger = withChallengeMark({ ...ledgerAtBoot, 'campaign.completed_missions': [...((ledgerAtBoot['campaign.completed_missions'] as string[] | undefined) ?? []), BS2] }, BS2, mark) as CampaignLedger;
    return settleVictory(store, { ledger, account: null, win: { missionId: BS2, stars: 2, ledger, ...(mark !== null ? { challenge: true } : {}) }, world, at, start: null });
  };
  const challengeCoins = (s: ReturnType<typeof settle>) => s.awards.filter((a) => a.source === 'challenge').reduce((n, a) => n + a.coins, 0);

  it('the first beaten challenge pays 10; a second win pays 0', () => {
    const store = memoryLedgerStore();
    store.writeLedger(opened as CampaignLedger);
    const first = settle(store, opened, 1);
    expect(challengeCoins(first)).toBe(10);
    expect(store.readRoar().earn.missions[BS2]).toEqual({ won: true, stars: 2, challenge: true });
    expect(challengeCoins(settle(store, store.readLedger(), 2))).toBe(0);
  });
  it('after New campaign the mark is gone and the coin does not pay again', () => {
    const store = memoryLedgerStore();
    store.writeLedger(opened as CampaignLedger);
    settle(store, opened, 1);
    expect(store.readLedger()[CHALLENGE_LEDGER_KEY]).toBeDefined();
    newCampaign(store);
    expect(store.readLedger()[CHALLENGE_LEDGER_KEY]).toBeUndefined();
    store.writeLedger(opened as CampaignLedger);
    const again = settle(store, opened, 2);
    expect(challengeCoins(again)).toBe(0);
    // ...though the new campaign records its own mark again (the replay value, §5.2).
    expect(store.readLedger()[CHALLENGE_LEDGER_KEY]).toEqual({ [BS2]: { id: 'quiet_souk', roe: 95, ticks: 8000, lost: 0 } });
  });
  it('on Easier: no mark and 0 coins', () => {
    const store = memoryLedgerStore();
    const easier = { ...opened, [DIFFICULTY_LEDGER_KEY]: 'easier' } as LedgerData;
    store.writeLedger(easier as CampaignLedger);
    const s = settle(store, easier, 1);
    expect(challengeCoins(s)).toBe(0);
    expect(store.readLedger()[CHALLENGE_LEDGER_KEY]).toBeUndefined();
    expect(store.readRoar().earn.missions[BS2]).toEqual({ won: true, stars: 2 });
  });
});

describe('the signed-in view is the table alone; the Worker pays the challenge (the entry chunk carries none of it)', () => {
  const op = (n: number, challenge?: boolean): OutboxOp => ({
    kind: 'victory', opId: `op-${n}`, missionId: BS2, stars: 2, start: `start-${n}`, campaign: null, ...(challenge === undefined ? {} : { challenge }),
  });
  const confirmed = { campaign: null, slots: [], wallet: { free: 0, paid: 0 as const, entitlements: emptyRoar().entitlements, earn: emptyRoar().earn, receipts: [], revision: 1 } };
  it('a queued challenge win shows what a plain one shows until the server answers', () => {
    expect(viewOf(confirmed, [op(1, true)], world).wallet.free).toBe(viewOf(confirmed, [op(1)], world).wallet.free);
  });
});

describe('the lazy entry points main.ts calls through ./posture', () => {
  const rt = (lost: Record<string, number>, carries: 'complete' | 'active' = 'complete') => ({
    lostByType: () => lost,
    objectiveList: [{ primary: true, carries: undefined, status: 'complete' }, { primary: false, carries: true, status: carries }] as never,
  });
  const end = { result: 'victory' as const, roeRating: 95, tick: 8000 };
  it('victoryMark reads the run off the runtime: lost is lostByType summed', () => {
    expect(victoryMark(foothold, opened, ['light_order', 'no_medic'], rt({}), end)).toEqual({ id: 'quiet_souk', roe: 95, ticks: 8000, lost: 0 });
    expect(victoryMark(foothold, opened, ['light_order', 'no_medic'], rt({ inf_squad: 1 }), end)).toBeNull();
    expect(victoryMark(foothold, opened, undefined, rt({}), end)).toBeNull();
  });
  it('runRowOf: carriesAll needs every carrying secondary complete', () => {
    expect(runRowOf(rt({ a: 2, b: 1 }), 50, 7).lost).toBe(3);
    expect(runRowOf(rt({}, 'active'), 50, 7).carriesAll).toBe(false);
    expect(runRowOf(rt({}), 50, 7).carriesAll).toBe(true);
  });
  it('amended on top of the posture equals the one call, and none on is the mission itself', () => {
    const easier = { [DIFFICULTY_LEDGER_KEY]: 'easier' };
    expect(amended(campaignMission(foothold, easier), ['light_order'])).toStrictEqual(amendedMission(foothold, easier, ['light_order']));
    expect(amended(campaignMission(foothold, easier), ['light_order'])).not.toStrictEqual(campaignMission(foothold, easier));
    expect(amended(foothold, [])).toBe(foothold);
  });
  it('C9: challengeMarksOf drops a wrong-shaped row, and withChallengeMark writes only well-shaped ones', () => {
    const m = { id: 'quiet_souk', roe: 80, ticks: 8000, lost: 0 };
    const bad = { [CHALLENGE_LEDGER_KEY]: { [BS2]: m, broken: { id: 3, roe: 1, ticks: 1, lost: 0 }, worse: 'x' } } as LedgerData;
    expect(challengeMarksOf(bad)).toEqual({ [BS2]: m });
    expect(challengeMarksOf({ [CHALLENGE_LEDGER_KEY]: [1, 2] } as LedgerData)).toEqual({});
    expect(withChallengeMark(bad, 'beit_sahwan_3_clearance', { ...m, id: 'clean_sweep' })[CHALLENGE_LEDGER_KEY]).toEqual({
      [BS2]: m,
      beit_sahwan_3_clearance: { ...m, id: 'clean_sweep' },
    });
  });
});
