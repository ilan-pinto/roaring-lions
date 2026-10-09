// Save/load reliability (polish/keyboard-and-saves, the audit's "not
// assessed" row): the save slots (`profile.ts`) and the three campaign keys
// they snapshot, driven through the app's own door (`ledger-store.ts`) over a
// Map, so every byte asserted here is a byte the browser path would write.
// `profile.test.ts` holds each function alone; these hold the SEQUENCES a
// player actually walks -- save, win, load, continue; a refusal mid-load; a
// damaged slot beside good ones; an old slot; `?fresh` beside the account.
import { describe, expect, it, vi } from 'vitest';
import worldJson from '../../../data/campaign/world.json';
import { ACCOUNT_KEY, emptyAccount, type BrigadeAccount } from './brigade-account';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from './main-keys';
import { memoryLedgerStore, newCampaign, writeVictory, type CampaignLedger, type LedgerStore, type MemoryLedgerStore } from './ledger-store';
import { SAVES_KEY, SAVE_ERROR_LOAD_MIXED, listDamaged, listSlots, loadSlot, readActive, saveSlot, writeActive } from './profile';
import { continueTarget, nextOperation, parseWorld } from './campaign';
import { payVictory } from './campaign-pay';

const world = parseWorld(worldJson);
const first = nextOperation(world, {});
if (first === null) throw new Error('the world has no first mission');

/** What `main.ts`'s victory handler writes, through the same two calls in
 *  the same order: the ledger with the mission completed, then the account
 *  paid by `payVictory` against the ledger the run booted with. */
function winMission(store: LedgerStore, missionId: string, value: number, at: number): void {
  const before = store.readLedger();
  const accountBefore = store.readAccount();
  const done = [...(before['campaign.completed_missions'] ?? []), missionId];
  store.writeLedger({ ...before, 'campaign.completed_missions': done });
  store.writeAccount(payVictory(accountBefore, world, missionId, before, value, at).account);
}

/** The three campaign keys, as bytes. */
const bytes = (s: MemoryLedgerStore): [string | null, string | null, string | null] => [s.raw(LEDGER_KEY), s.raw(ACCOUNT_KEY), s.raw(TUTORIAL_DONE_KEY)];

/** A store that accepts writes and refuses the named one, the way a browser
 *  at its quota does (`QuotaExceededError`). Everything else -- including the
 *  door's own snapshot and restore -- is the real implementation. */
function refusing(base: MemoryLedgerStore, which: 'writeLedger' | 'writeAccount' | 'setTutorialDone'): LedgerStore {
  return {
    ...base,
    [which]: () => {
      throw new Error('QuotaExceededError: the quota has been exceeded.');
    },
  };
}

describe('save and load across a campaign', () => {
  it('a slot saved before a win puts the campaign back to before it, byte for byte', () => {
    const s = memoryLedgerStore();
    s.setTutorialDone(true);
    winMission(s, first, 200, 1);
    const atSave = bytes(s);
    saveSlot(s, 'a', 'Before the second', readActive(s), 'test', 2);
    const second = nextOperation(world, s.readLedger());
    if (second === null) throw new Error('no second mission');
    winMission(s, second, 300, 3);
    expect(bytes(s)).not.toEqual(atSave);
    const slot = loadSlot(s, 'a');
    if (!slot) throw new Error('slot missing');
    writeActive(s, slot);
    expect(bytes(s)).toEqual(atSave);
  });

  it('a loaded slot is the campaign the next screens read: the board and the menu point at its next mission, and a win from there pays', () => {
    const s = memoryLedgerStore();
    s.setTutorialDone(true);
    winMission(s, first, 200, 1);
    saveSlot(s, 'a', 'After the first', readActive(s), 'test', 2);
    const second = nextOperation(world, s.readLedger());
    if (second === null) throw new Error('no second mission');
    newCampaign(s);
    expect(nextOperation(world, s.readLedger())).toBe(first);
    writeActive(s, loadSlot(s, 'a') as NonNullable<ReturnType<typeof loadSlot>>);
    expect(nextOperation(world, s.readLedger())).toBe(second);
    expect(continueTarget(world, s.readLedger(), { id: 'tut', done: s.tutorialDone() })).toEqual({ missionId: second, kind: 'next' });
    const balance = s.readAccount().balance;
    winMission(s, second, 300, 3);
    expect(s.readLedger()['campaign.completed_missions']).toEqual([first, second]);
    expect(s.readAccount().balance).toBe(balance + 300);
  });

  it('`?fresh` clears the campaign and keeps the brigade account and every save slot', () => {
    const s = memoryLedgerStore();
    s.setTutorialDone(true);
    winMission(s, first, 200, 1);
    saveSlot(s, 'a', 'Keep me', readActive(s), 'test', 2);
    const slotsBefore = s.raw(SAVES_KEY);
    newCampaign(s);
    expect(s.raw(LEDGER_KEY)).toBeNull();
    expect(s.tutorialDone()).toBe(false);
    expect(s.readAccount().balance).toBe(200);
    // GH-330: the per-campaign record is cleared, so the first mission pays again.
    expect(s.readAccount().campaign_paid).toEqual({});
    expect(s.raw(SAVES_KEY)).toBe(slotsBefore);
    // and the slot still carries the campaign it was saved with
    expect(loadSlot(s, 'a')?.ledger['campaign.completed_missions']).toEqual([first]);
  });
});

describe('a load the browser refuses part-way', () => {
  for (const which of ['writeAccount', 'setTutorialDone'] as const) {
    it(`puts the active campaign back exactly as it was when ${which} is refused`, () => {
      const base = memoryLedgerStore();
      winMission(base, first, 200, 1);
      const before = bytes(base);
      const slot = saveSlot(base, 'a', 'Elsewhere', { ledger: { 'campaign.completed_missions': ['x', 'y'] }, account: { ...emptyAccount(), unlocks: ['z'] }, tutorialDone: true }, 'test', 2);
      const store = refusing(base, which);
      expect(() => writeActive(store, slot)).toThrow(/QuotaExceededError/);
      expect(bytes(base)).toEqual(before);
    });
  }

  it('a refused first write changes nothing at all', () => {
    const base = memoryLedgerStore();
    winMission(base, first, 200, 1);
    const before = bytes(base);
    const slot = saveSlot(base, 'a', 'Elsewhere', { ledger: {}, account: emptyAccount(), tutorialDone: true }, 'test', 2);
    expect(() => writeActive(refusing(base, 'writeLedger'), slot)).toThrow(/QuotaExceededError/);
    expect(bytes(base)).toEqual(before);
  });

  it('says so in its own words when even the restore is refused', () => {
    const base = memoryLedgerStore();
    winMission(base, first, 200, 1);
    const slot = saveSlot(base, 'a', 'Elsewhere', { ledger: {}, account: emptyAccount(), tutorialDone: true }, 'test', 2);
    const store: LedgerStore = {
      ...refusing(base, 'writeAccount'),
      restoreCampaign: () => {
        throw new Error('QuotaExceededError: the quota has been exceeded.');
      },
    };
    expect(() => writeActive(store, slot)).toThrow(SAVE_ERROR_LOAD_MIXED);
  });

  it('a blocked store (no storage at all) neither throws nor pretends to restore', () => {
    const s = memoryLedgerStore.blocked();
    expect(() => writeActive(s, { ledger: { 'campaign.completed_missions': ['x'] }, account: emptyAccount(), tutorialDone: true })).not.toThrow();
    expect(s.readLedger()).toEqual({});
  });
});

describe('damaged and old slots', () => {
  it('a damaged slot beside good ones: every good one lists and loads, the damaged one is kept and never loads', () => {
    const s = memoryLedgerStore();
    s.setTutorialDone(true);
    winMission(s, first, 200, 1);
    saveSlot(s, 'good1', 'One', readActive(s), 'test', 1);
    saveSlot(s, 'good2', 'Two', { ledger: {}, account: emptyAccount(), tutorialDone: false }, 'test', 2);
    const blob = JSON.parse(s.raw(SAVES_KEY) ?? '{}') as Record<string, unknown>;
    blob.broken = { version: 1, id: 'broken', name: 'Torn', ledger: [], account: null };
    s.map.set(SAVES_KEY, JSON.stringify(blob));
    expect(listSlots(s).map((m) => m.id)).toEqual(['good2', 'good1']);
    expect(listDamaged(s).map((d) => d.id)).toEqual(['broken']);
    expect(loadSlot(s, 'broken')).toBeNull();
    const one = loadSlot(s, 'good1');
    if (!one) throw new Error('good slot missing');
    writeActive(s, one);
    expect(s.readLedger()['campaign.completed_missions']).toEqual([first]);
    expect(listDamaged(s).map((d) => d.id)).toEqual(['broken']);
  });

  it('a slot from an older build loads: a version-1 account, no build or time, no tutorial flag, a roster from before slots and R-2', () => {
    const s = memoryLedgerStore();
    const oldLedger: CampaignLedger = {
      'campaign.completed_missions': [first],
      'roster.surviving_units': [{ type: 'inf_squad', veterancy: 1, missions: 2, kills: 3 }] as CampaignLedger['roster.surviving_units'],
    };
    const old = { version: 1, id: 'old', name: 'From long ago', ledger: oldLedger, account: { version: 1, balance: 0, paid: { [first]: 200 } } };
    s.map.set(SAVES_KEY, JSON.stringify({ old }));
    expect(listDamaged(s)).toEqual([]);
    const meta = listSlots(s);
    expect(meta).toEqual([{ id: 'old', name: 'From long ago', savedAt: 0, build: '', missions: 1, credits: 0 }]);
    const slot = loadSlot(s, 'old');
    if (!slot) throw new Error('old slot missing');
    writeActive(s, slot);
    expect(s.tutorialDone()).toBe(false);
    const account: BrigadeAccount = s.readAccount();
    expect(account.version).toBe(2);
    // GH-330: a version-1 record is split against the slot's OWN campaign.
    expect(account.campaign_paid).toEqual({ [first]: 200 });
    expect(s.readLedger()['roster.surviving_units']).toEqual(oldLedger['roster.surviving_units']);
    expect(nextOperation(world, s.readLedger())).not.toBe(first);
  });
});

describe('the victory write', () => {
  it('writes the ledger and the account together', () => {
    const s = memoryLedgerStore();
    const account = { ...emptyAccount(), balance: 50 };
    expect(writeVictory(s, { 'campaign.completed_missions': [first] }, account)).toBe('saved');
    expect(s.readLedger()['campaign.completed_missions']).toEqual([first]);
    expect(s.raw(ACCOUNT_KEY)).toBe(JSON.stringify(account));
  });

  // The victory handler wrapped only the LEDGER write: a refused ACCOUNT
  // write threw out of the handler after the ledger had already recorded the
  // win -- a won mission with no pay, and the end screen taken down with it.
  it('a refused account write puts the ledger back, throws nothing, and says it was refused', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const base = memoryLedgerStore();
    winMission(base, first, 200, 1);
    const before = bytes(base);
    const result = writeVictory(refusing(base, 'writeAccount'), { 'campaign.completed_missions': [first, 'x'] }, { ...emptyAccount(), balance: 999 });
    expect(result).toBe('refused');
    expect(bytes(base)).toEqual(before);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('no storage at all is its own answer, not a refusal', () => {
    expect(writeVictory(memoryLedgerStore.blocked(), {}, null)).toBe('unavailable');
  });
});
