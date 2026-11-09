import { describe, expect, it, vi } from 'vitest';
import { emptyAccount, emptyRoar, worldMissionIds } from '@lions/economy';
import { accountLedgerStore, ServerCoinsError } from './account-store';
import { readOutbox } from './outbox';
import { deleteSlot, listSlots, loadSlot, saveSlot } from '../profile';
import { settleVictory } from '../roar-earn';
import { cacheOf, confirmedState, memStorage, opIds, slotOf, world } from './fixtures';

function make(over: { confirmed?: ReturnType<typeof confirmedState>; bodies?: Record<string, ReturnType<typeof slotOf>> } = {}) {
  const storage = memStorage();
  const onChange = vi.fn();
  const store = accountLedgerStore({ storage, cache: cacheOf(over.confirmed, over.bodies), world, onChange, newOpId: opIds(), tabId: 'T' });
  return { storage, onChange, store };
}
const active = { ledger: {}, account: emptyAccount(), tutorialDone: false };

describe('accountLedgerStore', () => {
  it('server_coins_only: every coin write throws ServerCoinsError (§0.9)', () => {
    const { store } = make();
    expect(() => store.writeRoar(emptyRoar())).toThrow(ServerCoinsError);
    expect(() => store.restoreRoar(null)).toThrow(ServerCoinsError);
    expect(() => store.resetAccount()).toThrow(ServerCoinsError);
    expect(store.pendingSpends.size).toBe(0);
  });

  it('reads the view\'s wallet', () => {
    const { store } = make({ confirmed: confirmedState({ wallet: { ...confirmedState().wallet, free: 42 } }) });
    expect(store.readRoar().coins).toEqual({ free: 42, paid: 0 });
    expect((JSON.parse(store.snapshotRoar() ?? 'null') as { coins: unknown }).coins).toEqual({ free: 42, paid: 0 });
  });

  it('slots_round_trip: saveSlot queues one slot.put and listSlots shows it', () => {
    const { store, storage } = make();
    saveSlot(store, 's1', 'First', active, 'b1', 5);
    const q = readOutbox(storage, 'T');
    expect(q.map((o) => o.kind)).toEqual(['slot.put']);
    expect(listSlots(store).map((s) => s.id)).toEqual(['s1']);
    expect(loadSlot(store, 's1')?.name).toBe('First');
    // Saving it again coalesces; an unchanged write queues nothing more.
    saveSlot(store, 's1', 'First', active, 'b1', 5);
    expect(readOutbox(storage, 'T')).toHaveLength(1);
    deleteSlot(store, 's1');
    expect(readOutbox(storage, 'T').map((o) => o.kind)).toEqual(['slot.put', 'slot.delete']);
    expect(listSlots(store)).toEqual([]);
  });

  it('a slot with no downloaded body is never deleted by someone else\'s save', () => {
    const meta = { id: 'far', name: 'Far', savedAt: 1, build: 'b', origin: 'player' as const, bytes: 9 };
    const { store, storage } = make({ confirmed: confirmedState({ slots: [meta] }) });
    expect(store.readSlotsRaw()).toBeNull();
    saveSlot(store, 'near', 'Near', active, 'b', 2);
    expect(readOutbox(storage, 'T').map((o) => o.kind)).toEqual(['slot.put']);
  });

  it('a damaged entry in the slot blob is not sent', () => {
    const { store, storage } = make();
    store.writeSlotsRaw(JSON.stringify({ bad: { nope: 1 } }));
    expect(readOutbox(storage, 'T')).toEqual([]);
  });

  it('campaign writes append one whole-campaign op each and tell the loop', () => {
    const { store, storage, onChange } = make();
    store.writeLedger({ 'campaign.slots_issued': 4 });
    store.setTutorialDone(true);
    store.writeAccount({ ...emptyAccount(), balance: 9 });
    const q = readOutbox(storage, 'T');
    expect(q).toHaveLength(1); // adjacent campaign ops coalesce
    expect(q[0]).toMatchObject({ kind: 'campaign', campaign: { ledger: { 'campaign.slots_issued': 4 }, tutorialDone: true, brigade: { balance: 9 } } });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(store.readAccount().balance).toBe(9);
    expect(store.tutorialDone()).toBe(true);
    store.clearLedger();
    expect(store.readLedger()).toEqual({});
  });

  it('startCampaign clears the per-campaign record and leaves the account', () => {
    const acct = { ...emptyAccount(), balance: 5, campaign_paid: { m: { stars: 1, credits: 2 } } as never };
    const confirmed = confirmedState();
    confirmed.campaign = { ledger: {}, brigade: acct, tutorialDone: false, revision: 1, digest: 'd' };
    const { store } = make({ confirmed });
    store.startCampaign();
    expect(store.readAccount().balance).toBe(5);
    expect(store.readAccount().campaign_paid).toEqual({});
  });

  it('snapshotCampaign / restoreCampaign round trip through one campaign op (profile.writeActive\'s undo)', () => {
    const { store, storage } = make();
    store.writeAccount({ ...emptyAccount(), balance: 1 });
    const snap = store.snapshotCampaign();
    store.writeAccount({ ...emptyAccount(), balance: 99 });
    store.restoreCampaign(snap);
    expect(store.readAccount().balance).toBe(1);
    expect(readOutbox(storage, 'T')).toHaveLength(1);
  });

  it('recordVictory queues one victory op; settleVictory over it shows the provisional award and writes no coin', () => {
    const { store, storage } = make();
    const id = worldMissionIds(world)[0] ?? '';
    const ledger = { 'campaign.completed_missions': [id] };
    const r = settleVictory(store, { ledger, account: null, win: { missionId: id, stars: 2, ledger }, world, at: 1, start: 'nonce' });
    expect(r.write).toBe('saved');
    expect(r.total).toBe(120);
    const q = readOutbox(storage, 'T');
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'victory', missionId: id, stars: 2, start: 'nonce' });
    expect(store.readRoar().coins.free).toBe(120); // the view, not a stored wallet
    expect(store.readLedger()).toEqual(ledger);
  });

  it('a tutorial victory (no win) is only a campaign write', () => {
    const { store, storage } = make();
    store.recordVictory({ ledger: { 'campaign.slots_issued': 1 }, account: null, roar: null, win: null, start: null });
    expect(readOutbox(storage, 'T').map((o) => o.kind)).toEqual(['campaign']);
  });

  it('a refused outbox write keeps the memory copy', () => {
    const boom = (): never => {
      throw new Error('quota');
    };
    const store = accountLedgerStore({ storage: { getItem: () => null, setItem: boom, removeItem: boom }, cache: cacheOf(), world, onChange: () => {}, newOpId: opIds() });
    store.writeAccount({ ...emptyAccount(), balance: 3 });
    expect(store.readAccount().balance).toBe(3);
    expect(store.outboxSize()).toBe(1);
  });

  it('picks up an outbox already on disk', () => {
    const a = make();
    a.store.writeAccount({ ...emptyAccount(), balance: 8 });
    const b = accountLedgerStore({ storage: a.storage, cache: cacheOf(), world, onChange: () => {}, newOpId: opIds(), tabId: 'T' });
    expect(b.readAccount().balance).toBe(8);
  });

  it('reads are copies: mutating one does not reach the queue', () => {
    const { store } = make();
    store.writeAccount({ ...emptyAccount(), balance: 2 });
    store.readAccount().balance = 500;
    expect(store.readAccount().balance).toBe(2);
  });
});
