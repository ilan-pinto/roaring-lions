// How Roar coins are earned (GH-317): the lead's table (4 Nov 2026) as tests.
// Each `G-` tag is a gate in the design
// (`docs/superpowers/specs/2026-11-04-roar-coin-wallet-design.md` §8); the commit
// that added it names the one-line mutation that turns it red.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { units } from '@lions/data';
import type { LedgerData } from '@lions/sim';
import worldJson from '../../../data/campaign/world.json';
import { ACCOUNT_KEY, emptyAccount, payMission, type BrigadeAccount } from './brigade-account';
import { parseWorld } from './campaign';
import { memoryLedgerStore, type CampaignLedger, type LedgerStore } from './ledger-store';
import { saveSlot, writeActive, readActive, loadSlot } from './profile';
import { EARN, MAX_STARS, roarEarn, settleVictory, worldMissionIds, type VictoryWin } from './roar-earn';
import { ROAR_KEY, emptyRoar, spendable, type RoarWallet } from './roar-wallet';
import { LADDER_MISSIONS, coinPrice } from './ui/stores-model';

const world = parseWorld(worldJson);
const ids = worldMissionIds(world);

/** A ledger with `done` completed, the way a win leaves it. */
const ledgerOf = (done: readonly string[], stars: Record<string, number> = {}): LedgerData => ({
  'campaign.completed_missions': [...done],
  'campaign.mission_results': Object.fromEntries(Object.entries(stars).map(([id, s]) => [id, { stars: s, roe: 100, ticks: 1, lost: 0 }])) as LedgerData['campaign.mission_results'],
});
const win = (i: number, stars: number, done: readonly string[] = ids.slice(0, i + 1)): VictoryWin => ({ missionId: ids[i], stars, ledger: ledgerOf(done) });
const total = (w: RoarWallet): number => spendable(w);

describe('the earn table', () => {
  it('constants are the lead\'s numbers', () => {
    expect(EARN).toEqual({ welcome: 100, firstWin: 10, star: 5, campaign: 100 });
    expect(MAX_STARS).toBe(3);
  });

  it('the first campaign victory pays the welcome issue, the first win and its stars', () => {
    const r = roarEarn(emptyRoar(), win(0, 2), world, 1);
    expect(r.awards).toEqual([
      { source: 'welcome', coins: 100 },
      { source: 'first_win', coins: 10, missionId: ids[0] },
      { source: 'star', coins: 10, missionId: ids[0], stars: 2 },
    ]);
    expect(r.total).toBe(120);
    expect(r.wallet.coins).toEqual({ free: 120, paid: 0 });
    expect(r.wallet.earn).toEqual({ welcomed: true, campaignDone: false, missions: { [ids[0]]: { won: true, stars: 2 } } });
    expect(r.wallet.receipts.map((x) => x.kind === 'earn' && x.source)).toEqual(['welcome', 'first_win', 'star']);
  });

  it('the welcome issue lands once, on whichever mission is won first', () => {
    const first = roarEarn(emptyRoar(), win(3, 0, [ids[3]]), world, 1);
    expect(first.awards.map((a) => a.source)).toEqual(['welcome', 'first_win']);
    const second = roarEarn(first.wallet, win(4, 0, [ids[3], ids[4]]), world, 2);
    expect(second.awards.map((a) => a.source)).toEqual(['first_win']);
    expect(total(second.wallet)).toBe(120);
  });

  it('the tutorial, and any mission off the map, pays nothing', () => {
    const w = emptyRoar();
    const r = roarEarn(w, { missionId: 'beit_sahwan_0_tutorial', stars: 3, ledger: ledgerOf(['beit_sahwan_0_tutorial']) }, world, 1);
    expect(r.wallet).toBe(w);
    expect(r.awards).toEqual([]);
    expect(ids).not.toContain('beit_sahwan_0_tutorial');
  });

  it('versus pays 0: a room is not a campaign mission', () => {
    // A room's ids (its map, its match code) are never in world.json; the victory handler
    // also hands no win to settleVictory when there is no mission id.
    for (const id of ['tel_marum', 'ABCDEF', '']) {
      const w = emptyRoar();
      expect(roarEarn(w, { missionId: id, stars: 3, ledger: ledgerOf(ids) }, world, 1).wallet).toBe(w);
    }
  });

  it('a victory with no stars still pays the welcome and the first win', () => {
    expect(roarEarn(emptyRoar(), win(0, 0), world, 1).total).toBe(110);
  });

  it('stars are clamped to the grade a mission can reach', () => {
    expect(roarEarn(emptyRoar(), win(0, 99), world, 1).awards.find((a) => a.source === 'star')?.stars).toBe(3);
    expect(roarEarn(emptyRoar(), win(0, -4), world, 1).awards.some((a) => a.source === 'star')).toBe(false);
    expect(roarEarn(emptyRoar(), win(0, Number.NaN), world, 1).total).toBe(110);
  });
});

describe('G-E1: a replay pays only a star improvement', () => {
  const once = roarEarn(emptyRoar(), win(0, 2), world, 1).wallet;

  it('a replay at the same grade, or a lower one, pays 0 and changes nothing', () => {
    for (const stars of [0, 1, 2]) {
      const r = roarEarn(once, win(0, stars), world, 2);
      expect(r.total, `stars ${stars}`).toBe(0);
      expect(r.awards).toEqual([]);
      expect(r.wallet).toBe(once);
    }
  });

  it('a better grade pays 5 a star for the rise only, and the best moves up', () => {
    const r = roarEarn(once, win(0, 3), world, 2);
    expect(r.awards).toEqual([{ source: 'star', coins: 5, missionId: ids[0], stars: 1 }]);
    expect(r.wallet.earn.missions[ids[0]]).toEqual({ won: true, stars: 3 });
    // ...and after that, 3 stars again is a replay.
    expect(roarEarn(r.wallet, win(0, 3), world, 3).total).toBe(0);
  });

  it('a worse grade first does not lower the best, so the climb back pays nothing', () => {
    const down = roarEarn(once, win(0, 1), world, 2).wallet;
    expect(down.earn.missions[ids[0]].stars).toBe(2);
    expect(roarEarn(down, win(0, 2), world, 3).total).toBe(0);
  });
});

describe('G-E2: one campaign\'s coins buy the dearest unit in the Stores', () => {
  const pinned = (name: string): number => {
    const text = readFileSync(resolve(__dirname, '../../../tools/src/backtest/playtest.ts'), 'utf8');
    const m = new RegExp(`^(?:export )?const ${name} = (\\d+);`, 'm').exec(text);
    if (m === null) throw new Error(`playtest.ts: no "const ${name} = <integer>;" line`);
    return Number(m[1]);
  };
  const dearest = Math.max(...Object.values(units).map((u) => ('unlock' in u && typeof (u.unlock as { price?: number }).price === 'number' ? (u.unlock as { price: number }).price : 0)));

  /** Walk the ladder: every mission in `world.json`, once, in order, with the stars the
   *  playtest ladder reaches (68 over 29 missions: the first ten at 3, the rest at 2). */
  function walk(): { wallet: RoarWallet; stars: number } {
    const ladderStars = pinned('LADDER_STARS');
    const per = ids.map((_, i) => (i < ladderStars - 2 * ids.length ? 3 : 2));
    expect(per.reduce((a, b) => a + b, 0)).toBe(ladderStars);
    let wallet = emptyRoar();
    ids.forEach((_, i) => {
      wallet = roarEarn(wallet, win(i, per[i]), world, i + 1).wallet;
    });
    return { wallet, stars: ladderStars };
  }

  it('the ladder is the shipped campaign: 29 missions, 68 stars', () => {
    expect(ids).toHaveLength(LADDER_MISSIONS);
    expect(pinned('LADDER_STARS')).toBe(68);
  });

  it('a lifetime pays 100 + 10 a mission + 5 a star + 100 = 830, and the campaign bonus lands on the last win', () => {
    const { wallet, stars } = walk();
    expect(total(wallet)).toBe(EARN.welcome + EARN.firstWin * ids.length + EARN.star * stars + EARN.campaign);
    expect(total(wallet)).toBe(830);
    expect(wallet.earn.campaignDone).toBe(true);
    const last = wallet.receipts.filter((r) => r.kind === 'earn' && r.source === 'campaign');
    expect(last).toHaveLength(1);
  });

  it('that is at least the coin price of the dearest unit (the gunship, 8,000 credits = 800 coins)', () => {
    expect(dearest).toBeGreaterThan(5000); // a max over nothing passes forever
    expect(coinPrice(dearest)).toBe(800);
    expect(total(walk().wallet)).toBeGreaterThanOrEqual(coinPrice(dearest));
  });

  it('the campaign bonus needs the whole campaign, not the last mission alone', () => {
    const lastOnly = roarEarn(emptyRoar(), { missionId: ids[ids.length - 1], stars: 3, ledger: ledgerOf([ids[ids.length - 1]]) }, world, 1);
    expect(lastOnly.awards.some((a) => a.source === 'campaign')).toBe(false);
  });

  it('a second campaign (the ledger starts over) pays no second bonus', () => {
    const { wallet } = walk();
    const again = roarEarn(wallet, { missionId: ids[ids.length - 1], stars: 2, ledger: ledgerOf(ids) }, world, 99);
    expect(again.total).toBe(0);
    expect(again.wallet).toBe(wallet);
  });
});

describe('G-E3: a save slot earns nothing, and a win pays by its own run', () => {
  const allThree = (): { ledger: CampaignLedger; account: BrigadeAccount } => ({
    ledger: { ...ledgerOf(ids, Object.fromEntries(ids.map((id) => [id, 3]))) } as CampaignLedger,
    account: emptyAccount(),
  });

  it('importing and loading an all-3-star slot leaves the wallet untouched', () => {
    const s = memoryLedgerStore();
    s.writeRoar({ ...emptyRoar(), coins: { free: 7, paid: 0 } });
    const before = s.raw(ROAR_KEY);
    const { ledger, account } = allThree();
    saveSlot(s, 'full', 'All stars', { ledger, account, tutorialDone: true }, 'test', 1);
    const slot = loadSlot(s, 'full');
    if (!slot) throw new Error('slot missing');
    writeActive(s, slot);
    expect(s.readLedger()['campaign.completed_missions']).toHaveLength(ids.length);
    expect(s.raw(ROAR_KEY)).toBe(before);
    // ...and on a store with no wallet at all, no wallet appears.
    const fresh = memoryLedgerStore();
    saveSlot(fresh, 'full', 'All stars', { ledger, account, tutorialDone: true }, 'test', 1);
    writeActive(fresh, readActive(fresh));
    expect(fresh.raw(ROAR_KEY)).toBeNull();
  });

  it('the first win after an import pays the run\'s stars, not the ledger\'s best', () => {
    const s = memoryLedgerStore();
    const { ledger: full, account } = allThree();
    // Every mission but the last: a replay of the first cannot finish the campaign.
    const ledger = { ...full, 'campaign.completed_missions': ids.slice(0, -1) } as CampaignLedger;
    writeActive(s, { ledger, account, tutorialDone: true });
    // The ledger now says 3 stars on every mission; this RUN earns 1.
    const settle = settleVictory(s, { ledger: s.readLedger() as CampaignLedger, account: null, win: { missionId: ids[0], stars: 1, ledger: s.readLedger() }, world, at: 1 });
    expect(settle.write).toBe('saved');
    expect(settle.total).toBe(100 + 10 + 5);
    expect(s.readRoar().earn.missions[ids[0]]).toEqual({ won: true, stars: 1 });
  });
});

describe('G-E4: coins never move credits', () => {
  // The real credit pay, so the account is one the door reads back (its balance bound).
  const before = (): BrigadeAccount => payMission(emptyAccount(), 'earlier_mission', 200, 1).account;
  const after = (): BrigadeAccount => payMission(before(), ids[0], 180, 2, 'campaign').account;

  it('a win that pays 180 credits and 120 coins moves the balance and earned_total by the credits alone', () => {
    const s = memoryLedgerStore();
    s.writeAccount(before());
    expect(s.readAccount().balance).toBe(200); // the fixture is one the door keeps
    const settle = settleVictory(s, { ledger: ledgerOf([ids[0]]) as CampaignLedger, account: after(), win: win(0, 2), world, at: 1 });
    expect(settle.total).toBe(120);
    expect(s.readAccount().balance).toBe(380);
    expect(s.readAccount().earned_total).toBe(380);
    expect(s.raw(ACCOUNT_KEY)).toBe(JSON.stringify(after()));
    expect(s.readRoar().coins.free).toBe(120);
  });

  it('a win that pays coins and no credits leaves the account bytes as they were', () => {
    const s = memoryLedgerStore();
    s.writeAccount(before());
    const bytes = s.raw(ACCOUNT_KEY);
    const settle = settleVictory(s, { ledger: ledgerOf([ids[0]]) as CampaignLedger, account: null, win: win(0, 3), world, at: 1 });
    expect(settle.total).toBe(125);
    expect(s.raw(ACCOUNT_KEY)).toBe(bytes);
  });
});

describe('settling a victory', () => {
  const tutorial = { missionId: 'beit_sahwan_0_tutorial', stars: 3, ledger: ledgerOf([]) };

  it('a mission that pays no coins writes no wallet', () => {
    const s = memoryLedgerStore();
    const settle = settleVictory(s, { ledger: ledgerOf([]) as CampaignLedger, account: null, win: tutorial, world, at: 1 });
    expect(settle).toEqual({ write: 'saved', awards: [], total: 0, balance: 0 });
    expect(s.raw(ROAR_KEY)).toBeNull();
    expect(settleVictory(s, { ledger: ledgerOf([]) as CampaignLedger, account: null, win: null, world, at: 2 }).awards).toEqual([]);
  });

  it('a refused write earns nothing and reads the balance as it was', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const base = memoryLedgerStore();
    base.writeRoar({ ...emptyRoar(), coins: { free: 40, paid: 0 } });
    const before = base.raw(ROAR_KEY);
    const refusing: LedgerStore = {
      ...base,
      writeRoar: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const settle = settleVictory(refusing, { ledger: ledgerOf([ids[0]]) as CampaignLedger, account: null, win: win(0, 3), world, at: 1 });
    expect(settle).toEqual({ write: 'refused', awards: [], total: 0, balance: 40 });
    expect(base.raw(ROAR_KEY)).toBe(before);
    error.mockRestore();
  });

  it('a blocked store is its own answer and pays nothing', () => {
    const settle = settleVictory(memoryLedgerStore.blocked(), { ledger: ledgerOf([ids[0]]) as CampaignLedger, account: null, win: win(0, 3), world, at: 1 });
    expect(settle).toEqual({ write: 'unavailable', awards: [], total: 0, balance: 0 });
  });

  it('two wins in a row accumulate in the stored wallet, through the door', () => {
    const s = memoryLedgerStore();
    settleVictory(s, { ledger: ledgerOf([ids[0]]) as CampaignLedger, account: null, win: win(0, 2), world, at: 1 });
    const second = settleVictory(s, { ledger: ledgerOf([ids[0], ids[1]]) as CampaignLedger, account: null, win: win(1, 3), world, at: 2 });
    expect(second.balance).toBe(120 + 10 + 15);
    expect(s.readRoar().coins.free).toBe(145);
  });
});
