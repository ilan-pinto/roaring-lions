// GH-1395 slice 2: the rules behind the challenge UI. The panel's gates, the run's ids (the start input a save, a replay
// and Restart carry, D10/C15), the after-action rung (not a star, D2), and the coin end to end through the UI's own gate
// (once per account, never on Easier). The DOM halves are in `ui/amendments-ui.test.ts`; main.ts's wiring in
// `posture-wiring.test.ts`. Every check was seen red under a one-line mutation of the implementation (the commit lists them).
import { describe, expect, it } from 'vitest';
import { challengeOf, DIFFICULTY_LEDGER_KEY, missions } from '@lions/data';
import type { LedgerData, MissionJson } from '@lions/sim';
import { starsEarned } from '@lions/sim';
import worldJson from '../../../data/campaign/world.json';
import { parseWorld, townStars } from './campaign';
import { amendedMission, amendmentOffer, amendmentsForRun, challengeMarkFor, challengeRung, offeredAmendments, withChallengeMark } from './challenge';
import { memoryLedgerStore, type CampaignLedger } from './ledger-store';
import { parseStartInputs, startInputsJson } from './mission-resume';
import { ReplayRecorder } from './feedback/replay';
import { campaignMission } from './posture';
import { afterAction, type AfterActionInputs } from './ui/after-action';
import { newMissionLog } from './mission-log';
import { townChallenges } from './ui/challenge-board';
import { settleVictory } from './victory-settle';

const world = parseWorld(worldJson);
const BS2 = 'beit_sahwan_2_foothold';
const raw = (id: string): MissionJson => (missions as unknown as Record<string, MissionJson>)[id];
const foothold = raw(BS2);
/** Beit Sahwan II is next once First Light and Recon are won: open at boot. */
const opened: LedgerData = {
  'campaign.completed_missions': ['beit_sahwan_breach', 'beit_sahwan_1_recon'],
  'campaign.mission_results': {
    beit_sahwan_breach: { stars: 2, roe: 90, ticks: 6000, lost: 1 },
    beit_sahwan_1_recon: { stars: 2, roe: 90, ticks: 8000, lost: 0 },
  },
};
const easier: LedgerData = { ...opened, [DIFFICULTY_LEDGER_KEY]: 'easier' };
const harder: LedgerData = { ...opened, [DIFFICULTY_LEDGER_KEY]: 'harder' };
const QUIET_SOUK = ['no_medic', 'light_order'];

describe('the panel gate (amendmentOffer): a pilot mission, never Easier, never the tutorial, open at boot', () => {
  it('Beit Sahwan II, open, on Standard and on Harder: the panel offers its three, in its own order', () => {
    expect(amendmentOffer(foothold, opened, world)?.offers).toEqual(['no_medic', 'thin_purse', 'light_order']);
    expect(amendmentOffer(foothold, harder, world)).not.toBeNull();
  });
  it('never on Easier (GH-1394 D9)', () => {
    expect(amendmentOffer(foothold, easier, world)).toBeNull();
  });
  it('never the tutorial, which produces nothing (keyed on the ledger contract, not its name)', () => {
    const tut = raw('beit_sahwan_0_tutorial');
    expect(tut.ledger.produces).toEqual([]);
    expect(amendmentOffer(tut, opened, world)).toBeNull();
    // Even a tutorial that somehow had a challenge file is refused: the contract decides, not the index.
    expect(amendmentOffer({ ...foothold, ledger: { ...foothold.ledger, produces: [] } }, opened, world)).toBeNull();
  });
  it('never a mission with no challenge (not in the pilot)', () => {
    const other = Object.keys(missions).find((id) => challengeOf(id) === undefined && raw(id).ledger.produces.length > 0) ?? '';
    expect(other).not.toBe('');
    expect(amendmentOffer(raw(other), { 'campaign.completed_missions': Object.keys(missions) }, world)).toBeNull();
  });
  it('never a mission played by address that is not open at boot (it could earn no mark)', () => {
    expect(amendmentOffer(foothold, {}, world)).toBeNull();
  });
  it('no mission, no panel', () => expect(amendmentOffer(undefined, opened, world)).toBeNull());
});

describe("the run's ids (amendmentsForRun): what the save, the replay and Restart carry (D10)", () => {
  const run = (o: Partial<Parameters<typeof amendmentsForRun>[0]>) => amendmentsForRun({ mission: foothold, ledger: opened, saved: null, world, ...o });
  it('a new run plays the carried choice, in the mission’s own order, once each, unknown ids dropped', () => {
    expect(run({ requested: ['light_order', 'no_medic', 'light_order', 'tight_clock'] })).toEqual({ ids: QUIET_SOUK, offer: challengeOf(BS2) });
    expect(run({ requested: undefined })).toEqual({ ids: [], offer: challengeOf(BS2) });
  });
  it('one choice is one id list, whatever order it was pressed in', () => {
    expect(run({ requested: ['light_order', 'no_medic'] })).toEqual(run({ requested: ['no_medic', 'light_order'] }));
  });
  it('on Easier, the tutorial, or a mission not open: no ids and no panel, whatever a restart carried', () => {
    expect(run({ ledger: easier, requested: QUIET_SOUK })).toEqual({ ids: [], offer: null });
    expect(run({ ledger: {}, requested: QUIET_SOUK })).toEqual({ ids: [], offer: null });
    expect(run({ mission: raw('beit_sahwan_0_tutorial'), requested: QUIET_SOUK })).toEqual({ ids: [], offer: null });
  });
  it('a resumed run plays the SAVE’s ids, with no panel, even where a new run would get none', () => {
    expect(run({ saved: QUIET_SOUK, requested: [] })).toEqual({ ids: QUIET_SOUK, offer: null });
    expect(run({ saved: ['light_order', 'no_medic'], ledger: {} })).toEqual({ ids: QUIET_SOUK, offer: null });
    expect(run({ saved: [], requested: QUIET_SOUK })).toEqual({ ids: [], offer: null });
  });
  it('a save whose ids this mission does not offer is refused, never rebuilt as another mission', () => {
    expect(run({ saved: ['tight_clock'] })).toEqual({ refused: true });
    expect(run({ saved: ['light_order', 'breach_no_jeep'] })).toEqual({ refused: true });
    expect(run({ mission: raw('beit_sahwan_0_tutorial'), saved: ['light_order'] })).toEqual({ refused: true });
  });
  it('the amended mission is a different mission (fewer bodies), and the plain one is the mission itself', () => {
    const plain = campaignMission(foothold, opened);
    const amended = amendedMission(foothold, opened, run({ requested: QUIET_SOUK }).ids as string[]);
    expect(amendedMission(foothold, opened, [])).toBe(plain);
    const count = (m: MissionJson) => (m.starting_force ?? []).reduce((n, p) => n + (p.count ?? 1), 0);
    expect(count(amended)).toBe(count(plain) - 2);
  });
  it('D13: no amendment the panel can put on moves the clock, at Standard or Harder', () => {
    for (const ledger of [opened, harder]) {
      const offer = amendmentOffer(foothold, ledger, world);
      for (const id of offer?.offers ?? []) {
        expect(amendedMission(foothold, ledger, [id]).time_limit_s, id).toBe(campaignMission(foothold, ledger).time_limit_s);
      }
    }
  });
});

describe('C15: the ids are a start input, so a save and a replay carry them', () => {
  const base = { ledger: opened as CampaignLedger, tiers: {}, unlocks: [], deploy: null };
  it('an amended run’s start inputs hold the ids, and parse back to them', () => {
    const j = JSON.parse(JSON.stringify(startInputsJson({ ...base, amendments: QUIET_SOUK })));
    expect(j.amendments).toEqual(QUIET_SOUK);
    const back = parseStartInputs(j);
    expect(back?.amendments).toEqual(QUIET_SOUK);
    // ...and a resume of it rebuilds the AMENDED mission.
    const r = amendmentsForRun({ mission: foothold, ledger: opened, saved: back?.amendments ?? [], world });
    expect(r).toEqual({ ids: QUIET_SOUK, offer: null });
  });
  it('an unamended run writes no field: its start inputs are byte for byte the pre-amendment shape, and resume plain', () => {
    const none = JSON.stringify(startInputsJson({ ...base, amendments: [] }));
    expect(none).toBe(JSON.stringify(startInputsJson(base)));
    expect(none).not.toContain('amendments');
    expect(parseStartInputs(JSON.parse(none))?.amendments).toBeUndefined();
  });
  it('a malformed id list is not the shape: the save is refused', () => {
    const j = JSON.parse(JSON.stringify(startInputsJson({ ...base, amendments: QUIET_SOUK })));
    for (const bad of [[], ['Light Order'], ['light_order', 'light_order'], 'light_order', [1]]) {
      expect(parseStartInputs({ ...j, amendments: bad }), JSON.stringify(bad)).toBeNull();
    }
  });
  it('a replay of an amended run says which amendments it was played under', () => {
    const r = new ReplayRecorder();
    r.begin({ mission: BS2, build: 'b', seed: 1, ledger: {}, tiers: {}, unlocks: [], deploy: null, amendments: QUIET_SOUK });
    expect(JSON.parse(r.log(0, 0) ?? 'null').start.amendments).toEqual(QUIET_SOUK);
  });
});

describe('the after-action rung: the challenge, beside the stars and never one of them (D2)', () => {
  const won = { roe: 95, ticks: 8000, lost: 0, carriesAll: true };
  const mark = challengeMarkFor({ missionId: BS2, result: 'victory', amendments: QUIET_SOUK, ledgerAtBoot: opened, world, targetMinutes: 7, run: won });
  it('none on: no rung at all, so an unamended debrief is unchanged', () => {
    expect(challengeRung(BS2, [], null, won, 7)).toBeNull();
  });
  it('armed and beaten: met, named, with its terms; armed and missed: not met', () => {
    expect(mark).not.toBeNull();
    const met = challengeRung(BS2, QUIET_SOUK, mark, won, 7);
    expect(met?.met).toBe(true);
    expect(met?.text).toContain('Quiet Souk');
    expect(met?.text).toContain('6:40');
    expect(challengeRung(BS2, QUIET_SOUK, null, { ...won, lost: 1 }, 7)?.met).toBe(false);
  });
  it('amended but not armed: not attempted, naming what it needs', () => {
    const r = challengeRung(BS2, ['thin_purse'], null, won, 7);
    expect(r?.met).toBe(false);
    expect(r?.text).toContain('Light order');
    expect(r?.text).toContain('Medics stay back');
  });
  const inputs = (o: Partial<AfterActionInputs>): AfterActionInputs => ({
    result: 'victory', stars: 2, roe: 95, roeFloor: 70, ticks: 8000, objectives: [], log: newMissionLog(), invoice: [], promotions: [],
    replacements: [], unlocks: [], typeName: (x) => x, ...o,
  });
  it('the ladder keeps exactly its three star rungs; the challenge is its own field, on a win only', () => {
    const rung = { met: true, text: 'Quiet Souk: beaten' };
    const plain = afterAction(inputs({}));
    const withRung = afterAction(inputs({ challenge: rung }));
    expect(withRung.ladder).toEqual(plain.ladder);
    expect(withRung.ladder.map((r) => r.stars)).toEqual([1, 2, 3]);
    expect(withRung.challenge).toEqual(rung);
    expect(plain.challenge).toBeUndefined();
    expect(afterAction(inputs({ result: 'defeat', challenge: rung })).challenge).toBeUndefined();
  });
});

describe('the board mark never feeds stars or unlocks (D2)', () => {
  const marked = withChallengeMark(opened, BS2, { id: 'quiet_souk', roe: 95, ticks: 8000, lost: 0 });
  it('the mark is on the ledger and the board counts it for the town', () => {
    expect(marked).not.toBe(opened);
    expect(townChallenges(world, marked).get('beit_sahwan')).toEqual({ done: 1, of: 5 });
    expect(townChallenges(world, opened).get('beit_sahwan')).toEqual({ done: 0, of: 5 });
  });
  it('stars earned and a town’s stars are the same with and without it (possibleStars reads no ledger at all)', () => {
    expect(starsEarned(marked)).toBe(starsEarned(opened));
    expect(starsEarned(marked)).toBe(4);
    const town = world.regions.flatMap((r) => r.towns).find((x) => x.id === 'beit_sahwan');
    if (town === undefined) throw new Error('beit_sahwan is in world.json');
    expect(townStars(town, marked)).toEqual(townStars(town, opened));
  });
  it('a mark whose id is not the mission’s challenge, or a wrong-shaped row, is not counted', () => {
    expect(townChallenges(world, withChallengeMark(opened, BS2, { id: 'old_name', roe: 95, ticks: 8000, lost: 0 })).get('beit_sahwan')?.done).toBe(0);
    expect(townChallenges(world, { ...opened, 'campaign.challenge_results': { [BS2]: { id: 'quiet_souk' } } }).get('beit_sahwan')?.done).toBe(0);
  });
});

describe('the coin through the UI’s own gate: 10 once per account, never on Easier', () => {
  const win = { roe: 95, ticks: 8000, lost: 0, carriesAll: true };
  /** One won run as main.ts plays it: the panel's ids for the ledger at boot, the mark, the all-or-none write. */
  const play = (store: ReturnType<typeof memoryLedgerStore>, ledgerAtBoot: LedgerData, requested: readonly string[], at: number) => {
    const r = amendmentsForRun({ mission: foothold, ledger: ledgerAtBoot, requested, saved: null, world });
    if ('refused' in r) throw new Error('a new run is never refused');
    const mark = challengeMarkFor({ missionId: BS2, result: 'victory', amendments: r.ids, ledgerAtBoot, world, targetMinutes: 7, run: win });
    const ledger = withChallengeMark({ ...ledgerAtBoot, 'campaign.completed_missions': [...((ledgerAtBoot['campaign.completed_missions'] as string[] | undefined) ?? []), BS2] } as CampaignLedger, BS2, mark);
    return settleVictory(store, { ledger, account: null, win: { missionId: BS2, stars: 2, ledger, ...(mark && { challenge: true }) }, world, at, start: null });
  };
  const fresh = (l: LedgerData) => {
    const store = memoryLedgerStore();
    store.writeLedger(l as CampaignLedger);
    return store;
  };
  const challengeCoins = (s: ReturnType<typeof settleVictory>) => s.awards.filter((a) => a.source === 'challenge').reduce((n, a) => n + a.coins, 0);
  it('the first beaten run pays exactly 10; the second pays 0', () => {
    const store = fresh(opened);
    expect(challengeCoins(play(store, opened, QUIET_SOUK, 1))).toBe(10);
    expect(challengeCoins(play(store, store.readLedger(), QUIET_SOUK, 2))).toBe(0);
  });
  it('on Easier the panel’s ids are dropped, so no mark and no coin, whatever a restart carried', () => {
    const store = fresh(easier);
    const s = play(store, easier, QUIET_SOUK, 1);
    expect(challengeCoins(s)).toBe(0);
    expect(store.readLedger()['campaign.challenge_results']).toBeUndefined();
  });
  it('unamended: no coin', () => {
    const store = fresh(opened);
    expect(challengeCoins(play(store, opened, [], 1))).toBe(0);
  });
});

describe('the data text the panel shows', () => {
  it('every pilot mission offers three, each with its label and blurb, and the challenge names only offered ones', () => {
    for (const id of ['beit_sahwan_breach', 'beit_sahwan_1_recon', BS2, 'beit_sahwan_3_clearance', 'beit_sahwan_4_subterranean', 'umm_zeitoun_2_buildup']) {
      const c = challengeOf(id);
      if (c === undefined) throw new Error(`${id} is in the pilot`);
      const list = offeredAmendments(c);
      expect(list.map((a) => a.id)).toEqual(c.offers);
      expect(list.every((a) => a.label.length > 0 && a.blurb.length > 0)).toBe(true);
      expect(c.challenge.amendments.every((x) => c.offers.includes(x))).toBe(true);
    }
  });
});
