import { describe, expect, it } from 'vitest';
import { emptyAccount } from '@lions/economy';
import type { SaveSlot, ServerState, SlotMetaView } from '@lions/economy';
import { memoryLedgerStore } from '../ledger-store';
import type { AccountCache } from './cache';
import { accountLedgerStore, isAccountStore } from './account-store';
import { cacheOf, confirmedState, memStorage, opIds, slotOf, world } from './fixtures';

// GH-1385 F8, batch 4: the account store's bookkeeping, one input per rule. The queue is read back through `sync.ops()`
// and the outbox storage, and every expected value is a literal.

const meta = (s: SaveSlot): SlotMetaView => ({ id: s.id, name: s.name, savedAt: s.savedAt, build: s.build, origin: 'player', bytes: 100 });

function make(opts: { cache?: AccountCache; storage?: ReturnType<typeof memStorage>; tabId?: string } = {}) {
  const storage = opts.storage ?? memStorage();
  const cache = opts.cache ?? cacheOf();
  const writes: string[] = [];
  const raw = storage.setItem;
  storage.setItem = (k, v) => {
    writes.push(k);
    raw(k, v);
  };
  const store = accountLedgerStore({ storage, cache, world, onChange: () => undefined, newOpId: opIds(), tabId: opts.tabId ?? 'T1' });
  return { store, storage, cache, writes };
}

const withSlots = (slots: SaveSlot[], over: Partial<ServerState> = {}): AccountCache =>
  cacheOf(confirmedState({ slots: slots.map(meta), ...over }), Object.fromEntries(slots.map((s) => [s.id, s])));

describe('the outbox belongs to one member', () => {
  it('another member\'s queue on this tab is not adopted, nor shown, and stays on disk for them', () => {
    const storage = memStorage();
    const theirs = make({ storage, cache: { ...cacheOf(), publicId: 'other' } });
    theirs.store.writeLedger({ 'campaign.completed_missions': ['m1'] });
    expect(theirs.store.outboxSize()).toBe(1);
    const mine = make({ storage });
    expect(mine.store.outboxSize()).toBe(0);
    expect(mine.store.sync.base()).toBeUndefined();
    // The same member coming back reads their queue again.
    expect(make({ storage, cache: { ...cacheOf(), publicId: 'other' } }).store.outboxSize()).toBe(1);
  });
});

describe('the send base is the revision the campaign snapshot was built on', () => {
  it('a campaign write pins it at queue time; a slot write does not', () => {
    const slotOnly = make();
    slotOnly.store.writeSlotsRaw(JSON.stringify({ s1: slotOf('s1', 'One', 5) }));
    expect(slotOnly.store.outboxSize()).toBe(1);
    expect(slotOnly.store.sync.base()).toBeUndefined();
    slotOnly.store.writeLedger({});
    expect(slotOnly.store.sync.base()).toBe(3); // confirmedState's campaign revision

    const campaign = make();
    campaign.store.writeLedger({});
    expect(campaign.store.sync.base()).toBe(3);
  });

  it('setBase writes the outbox once per change and not again for the same number', () => {
    const { store, writes } = make();
    store.writeLedger({}); // the outbox has something to write, and the base is 3
    const before = writes.length;
    store.sync.setBase(7);
    expect(store.sync.base()).toBe(7);
    const after = writes.length;
    expect(after).toBeGreaterThan(before);
    store.sync.setBase(7);
    expect(writes).toHaveLength(after);
    store.sync.setBase(8);
    expect(store.sync.base()).toBe(8);
    expect(writes.length).toBeGreaterThan(after);
  });
});

describe('save slots written through the store', () => {
  const one = slotOf('s1', 'One', 5);

  it('a slot that is already there, unchanged, queues nothing; a new name or new content queues a put', () => {
    const { store } = make({ cache: withSlots([one]) });
    store.writeSlotsRaw(JSON.stringify({ s1: one }));
    expect(store.outboxSize()).toBe(0);
    store.writeSlotsRaw(JSON.stringify({ s1: { ...one, name: 'Renamed' } }));
    expect(store.outboxSize()).toBe(1);
    const sameName = make({ cache: withSlots([one]) });
    sameName.store.writeSlotsRaw(JSON.stringify({ s1: { ...one, tutorialDone: true } }));
    expect(sameName.store.outboxSize()).toBe(1);
    const fresh = make({ cache: withSlots([one]) });
    fresh.store.writeSlotsRaw(JSON.stringify({ s1: one, s2: slotOf('s2', 'Two', 6) }));
    expect(fresh.store.sync.ops().map((o) => o.kind)).toEqual(['slot.put']);
  });

  it('a slot left out of the written blob is deleted, and reads as gone before the server answers', () => {
    const { store } = make({ cache: withSlots([one]) });
    expect(store.readSlotsRaw()).not.toBeNull();
    store.writeSlotsRaw('{}');
    expect(store.sync.ops().map((o) => o.kind)).toEqual(['slot.delete']);
    expect(store.readSlotsRaw()).toBeNull();
  });

  it('text that is not a record of slots changes nothing: not JSON, an array, a number', () => {
    for (const text of ['{broken', '[]', '5', 'null']) {
      const { store } = make({ cache: withSlots([one]) });
      store.writeSlotsRaw(text);
      expect(store.outboxSize(), text).toBe(0);
    }
  });
});

describe('the campaign snapshot and restore', () => {
  it('a store with no campaign snapshots nothing; one with a campaign snapshots its three parts', () => {
    const none = make({ cache: cacheOf(confirmedState({ campaign: null })) });
    expect(none.store.snapshotCampaign()).toEqual({ ledger: null, account: null, tutorial: null });
    const done = make({ cache: cacheOf(confirmedState({ campaign: { ledger: { a: 1 }, brigade: emptyAccount(), tutorialDone: true, revision: 3, digest: 'd' } })) });
    expect(done.store.snapshotCampaign()).toEqual({ ledger: '{"a":1}', account: JSON.stringify(emptyAccount()), tutorial: '1' });
    const notDone = make();
    expect(notDone.store.snapshotCampaign().tutorial).toBeNull();
  });

  it('restoring an empty snapshot onto no campaign queues nothing; a full one queues the campaign it names', () => {
    const empty = make({ cache: cacheOf(confirmedState({ campaign: null })) });
    empty.store.restoreCampaign({ ledger: null, account: null, tutorial: null });
    expect(empty.store.outboxSize()).toBe(0);
    // A ledger alone is enough to restore, even onto no campaign.
    const ledgerOnly = make({ cache: cacheOf(confirmedState({ campaign: null })) });
    ledgerOnly.store.restoreCampaign({ ledger: '{"a":1}', account: null, tutorial: null });
    expect(ledgerOnly.store.outboxSize()).toBe(1);

    const { store } = make();
    store.restoreCampaign({ ledger: '{"a":1}', account: JSON.stringify({ ...emptyAccount(), balance: 7 }), tutorial: '1' });
    const [op] = store.sync.ops();
    expect(op?.kind).toBe('campaign');
    const c = op?.kind === 'campaign' ? op.campaign : null;
    expect(c?.ledger).toEqual({ a: 1 });
    expect(c?.brigade.balance).toBe(7);
    expect(c?.tutorialDone).toBe(true);

    const notDone = make();
    notDone.store.restoreCampaign({ ledger: '{}', account: null, tutorial: '2' });
    const o2 = notDone.store.sync.ops()[0];
    expect(o2?.kind === 'campaign' ? o2.campaign.tutorialDone : null).toBe(false);
  });

  it('starting a new campaign with no campaign stored queues nothing', () => {
    const { store } = make({ cache: cacheOf(confirmedState({ campaign: null })) });
    store.startCampaign();
    expect(store.outboxSize()).toBe(0);
  });
});

describe('what the store says it is', () => {
  it('available, and the only store with both a pending set and a sync handle', () => {
    const { store } = make();
    expect(store.available).toBe(true);
    expect(isAccountStore(store)).toBe(true);
    expect(isAccountStore(memoryLedgerStore())).toBe(false);
    const half = { pendingSpends: new Set<string>() } as unknown as Parameters<typeof isAccountStore>[0];
    expect(isAccountStore(half)).toBe(false);
  });
});
