import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAccount } from '@lions/economy';
import type { CampaignBody, ServerState } from '@lions/economy';
import { accountLedgerStore } from './account-store';
import { ACCOUNT_BINDING_KEY, readBinding, writeBinding } from './binding';
import { ACCOUNT_CACHE_KEY, readCache, writeCache } from './cache';
import type { MeResult } from './client';
import { cacheOf, confirmedState, memStorage, opIds, slotOf, world } from './fixtures';
import { HELD_KEY, readHeld } from './local-held';
import { heartbeatKey, outboxKey, readOutbox, writeOutbox, type OutboxOp } from './outbox';
import { signOut, startSync, FLUSH_DEBOUNCE_MS, HEARTBEAT_MS, type SyncHandle } from './sync';
import { selectLedgerStore } from './select-store';
import { TAB_ID_KEY } from './tab-id';
import { clearTab } from './outbox';
import { wipeMember } from './sync';
import { clientFor, FakeServer, makeScheduler, sharedLocks, slotFrom, tick, type Sched } from './sync-kit';

const MARK = 'campaign.slots_issued'; // a ledger key that survives canonicalisation, so a digest-checked slot still shows which write it holds
const led = (n: number): Record<string, number> => ({ [MARK]: n });
const body = (n: number): CampaignBody => ({ ledger: led(n), brigade: emptyAccount(), tutorialDone: false });
const camp = (id: string, n: number): OutboxOp => ({ kind: 'campaign', opId: id, campaign: body(n) });
const markOf = (c: { ledger: unknown } | null | undefined): number | undefined => (c?.ledger as Record<string, number> | undefined)?.[MARK];

interface Rig {
  server: FakeServer;
  storage: ReturnType<typeof memStorage>;
  sched: Sched;
  cache: ReturnType<typeof cacheOf>;
  store: ReturnType<typeof accountLedgerStore>;
  sync: SyncHandle;
  foreign: ReturnType<typeof vi.fn>;
}
function rig(o: Partial<{ server: FakeServer; tabId: string; storage: ReturnType<typeof memStorage>; locks: LockManager; sched: Sched; me: () => MeResult; online: () => boolean; cacheFrom: ServerState; cache: ReturnType<typeof cacheOf> }> = {}): Rig {
  const server = o.server ?? new FakeServer();
  const storage = o.storage ?? memStorage();
  const sched = o.sched ?? makeScheduler();
  const cache = o.cache ?? cacheOf(o.cacheFrom ?? server.snapshot());
  const foreign = vi.fn();
  // eslint-disable-next-line prefer-const -- the store's onChange closes over the sync that is built after it
  let sync: SyncHandle | undefined;
  const store = accountLedgerStore({ storage, cache, world, onChange: () => sync?.kick(), newOpId: opIds(), tabId: o.tabId ?? 'T1' });
  sync = startSync({
    store,
    client: clientFor(server, { me: o.me }),
    storage,
    locks: o.locks,
    now: sched.now,
    schedule: sched.schedule,
    onForeignMember: foreign,
    online: o.online,
  });
  return { server, storage, sched, cache, store, sync, foreign };
}
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
};

describe('A2-17 an_op_appended_in_flight_survives', () => {
  it('A is answered by a response that knows nothing of B; B stays queued and is sent on the revision A returned', async () => {
    const r = rig();
    const h1 = deferred();
    const h2 = deferred();
    r.server.holds.push(h1.promise, h2.promise);
    r.store.writeLedger(led(1)); // A, a brigade purchase
    const flushing = r.sync.flush();
    await tick();
    expect(r.server.calls.map((c) => [c.name, c.base])).toEqual([['PUT campaign', 3]]);
    r.store.writeLedger(led(2)); // B, appended while A is in the air
    h1.release();
    await tick();
    // A's answer is in. B is still queued and the view still shows it; B was sent on the revision A returned.
    expect(r.server.calls.map((c) => [c.name, c.base])).toEqual([['PUT campaign', 3], ['PUT campaign', 4]]);
    expect(r.store.outboxSize()).toBe(1);
    expect(markOf(r.store.view().campaign)).toBe(2);
    expect(r.cache.confirmed.campaign?.revision).toBe(4);
    h2.release();
    await flushing;
    expect(r.server.calls.filter((c) => c.name === 'PUT campaign')).toHaveLength(2);
    expect(r.server.slots.size).toBe(0); // the fake server answered B 200, not 409
    expect(markOf(r.server.campaign)).toBe(2);
    expect(r.store.outboxSize()).toBe(0);
    expect(readOutbox(r.storage, 'T1')).toEqual([]);
  });
});

describe('A2-18 held_before_adopt', () => {
  it('a 409 held: the device campaign is in lions.account.local before the cache changes; it uploads when a slot frees, and leaves only on its own digest', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7', ledger: led(9) };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const r = rig({ server, cacheFrom: confirmedState() });
    const writes: string[] = [];
    const set = r.storage.setItem;
    r.storage.setItem = (k, v) => (writes.push(k), set(k, v));
    r.store.writeLedger(led(2));
    const v = r.store.view().campaign as NonNullable<ServerState['campaign']>;
    const mine = JSON.stringify({ ledger: v.ledger, brigade: v.brigade, tutorialDone: v.tutorialDone });
    await r.sync.flush();
    const held = readHeld(r.storage);
    expect(held).toHaveLength(1);
    expect(held[0]?.text).toBe(mine);
    expect(held[0]?.reason).toBe('held');
    expect(held[0]?.kind).toBe('campaign');
    // held first, the server's campaign second
    expect(writes.indexOf(HELD_KEY)).toBeGreaterThanOrEqual(0);
    expect(writes.indexOf(HELD_KEY)).toBeLessThan(writes.indexOf(ACCOUNT_CACHE_KEY));
    expect(r.cache.confirmed.campaign?.revision).toBe(7);
    // No slot is free yet: a refresh uploads nothing.
    await r.sync.refresh();
    await r.sync.flush();
    expect(r.server.count('PUT slot')).toHaveLength(0);
    // One frees (3 system slots): the held campaign goes up as a conflict slot...
    const first = [...r.server.slots.keys()][0] as string;
    r.server.slots.delete(first);
    await r.sync.refresh();
    expect(r.server.count('PUT slot')).toHaveLength(0); // queued, not yet sent
    expect(readHeld(r.storage)).toHaveLength(1);
    await r.sync.flush();
    expect(r.server.count('PUT slot')).toHaveLength(1);
    const stored = r.server.slots.get(held[0]?.id as string);
    expect(stored?.meta.origin).toBe('conflict');
    expect(markOf(stored?.body)).toBe(2);
    // ...and leaves the list only because the answer's digest was its own.
    expect(readHeld(r.storage)).toEqual([]);
  });

  it('release() names the held ids it queued: [] while every system slot is full, the id once one frees (and again while it waits)', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7', ledger: led(9) };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const r = rig({ server, cacheFrom: confirmedState() });
    r.store.writeLedger(led(2));
    await r.sync.flush();
    const item = readHeld(r.storage)[0] as NonNullable<ReturnType<typeof readHeld>[number]>;
    expect(r.sync.canRelease(item)).toBe(true);
    expect(r.sync.canRelease({ ...item, digest: undefined })).toBe(false);
    expect(r.sync.canRelease({ ...item, publicId: 'someone-else' })).toBe(false);
    expect(await r.sync.release()).toEqual({ ok: true, queued: [] });
    r.server.slots.delete([...r.server.slots.keys()][0] as string);
    expect(await r.sync.release()).toEqual({ ok: true, queued: [item.id] });
    expect(readHeld(r.storage)).toHaveLength(1); // still listed: the ack removes it, not the call
    expect(await r.sync.release()).toEqual({ ok: true, queued: [item.id] }); // queued already, still reported
    await r.sync.flush();
    expect(readHeld(r.storage)).toEqual([]);
  });

  it('a release put that wedges re-files the ORIGINAL held item as refused: one entry, same id, nothing waiting', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7', ledger: led(9) };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const r = rig({ server, cacheFrom: confirmedState() });
    r.store.writeLedger(led(2));
    await r.sync.flush();
    const item = readHeld(r.storage)[0] as NonNullable<ReturnType<typeof readHeld>[number]>;
    r.server.slots.delete([...r.server.slots.keys()][0] as string);
    await r.sync.release();
    const put = r.store.sync.ops().find((x) => x.kind === 'slot.put') as NonNullable<ReturnType<typeof r.store.sync.ops>[number]>;
    expect(r.sync.queuedHeldIds()).toEqual([item.id]);
    r.server.failWith.set(put.opId, 500);
    await r.sync.flush();
    for (let i = 0; i < 5; i++) {
      await r.sched.advance(60_000);
      await r.sync.idle();
    }
    expect(readHeld(r.storage).map((h) => [h.id, h.reason, h.text])).toEqual([[item.id, 'refused', item.text]]);
    expect(r.sync.queuedHeldIds()).toEqual([]);
  });

  it('a release put that loses the race for the slot (409 cap) leaves the item held and no longer waiting', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7', ledger: led(9) };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const r = rig({ server, cacheFrom: confirmedState() });
    r.store.writeLedger(led(2));
    await r.sync.flush();
    const item = readHeld(r.storage)[0] as NonNullable<ReturnType<typeof readHeld>[number]>;
    r.server.slots.delete([...r.server.slots.keys()][0] as string);
    await r.sync.release();
    expect(r.sync.queuedHeldIds()).toEqual([item.id]);
    r.server.addSystemSlot(); // another device took the slot first
    await r.sync.flush();
    expect(readHeld(r.storage).map((h) => [h.id, h.reason])).toEqual([[item.id, 'held']]);
    expect(r.sync.queuedHeldIds()).toEqual([]);
  });

  it('release() says ok: false when the refresh did not complete (offline status 0, a 500, a 401, a rejection), never an empty queue', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7', ledger: led(9) };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const r = rig({ server, cacheFrom: confirmedState() });
    r.store.writeLedger(led(2));
    await r.sync.flush();
    const real = server.state.bind(server);
    for (const status of [0, 500, 401]) {
      server.state = (async () => ({ ok: false, status, body: null })) as never;
      expect(await r.sync.release()).toEqual({ ok: false });
    }
    server.state = (() => Promise.reject(new Error('network'))) as never;
    expect(await r.sync.release()).toEqual({ ok: false });
    server.state = real;
    expect(await r.sync.release()).toEqual({ ok: true, queued: [] }); // reachable and genuinely full
  });

  it('a digest that is not its own leaves the item in the list (as refused: never uploaded twice)', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7' };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const r = rig({ server, cacheFrom: confirmedState() });
    r.store.writeLedger(led(2));
    await r.sync.flush();
    r.server.slots.delete([...r.server.slots.keys()][0] as string);
    r.server.corruptDigest = true;
    await r.sync.refresh();
    await r.sync.flush();
    expect(r.server.count('PUT slot')).toHaveLength(1);
    const held = readHeld(r.storage);
    expect(held).toHaveLength(1);
    expect(held[0]?.reason).toBe('refused');
    // a later refresh does not upload it again
    await r.sync.refresh();
    await r.sync.flush();
    expect(r.server.count('PUT slot')).toHaveLength(1);
  });

  it('when the local write is refused the server campaign is NOT adopted and the op stays queued', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7' };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const r = rig({ server, cacheFrom: confirmedState() });
    const set = r.storage.setItem;
    r.storage.setItem = (k, v) => {
      if (k === HELD_KEY) throw new Error('quota');
      set(k, v);
    };
    r.store.writeLedger(led(2));
    await r.sync.flush();
    expect(r.cache.confirmed.campaign?.revision).toBe(3);
    expect(r.store.outboxSize()).toBe(1);
    expect(markOf(r.store.view().campaign)).toBe(2);
  });
});

describe('705 held_after_409_never_rebased', () => {
  it('A in flight, B and C queued: A answers 409 with a conflict slot; B and C are dropped, one slot.put carries C, and no PUT campaign carries B or C', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7', ledger: led(9) };
    const r = rig({ server, cacheFrom: confirmedState() });
    r.store.sync.setOps([camp('A', 1), camp('B', 2), camp('C', 3)]);
    await r.sync.flush();
    const puts = r.server.count('PUT campaign');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.opId).toBe('A');
    const slotPuts = r.server.count('PUT slot');
    expect(slotPuts).toHaveLength(1);
    const target = [...r.server.slots.values()].find((s) => s.meta.id === slotPuts[0]?.id);
    expect(target?.meta.origin).toBe('conflict');
    expect(markOf(target?.body)).toBe(3);
    expect(r.store.outboxSize()).toBe(0);
    expect(markOf(r.server.campaign)).toBe(9); // the server's own campaign was not overwritten
    expect(r.cache.confirmed.campaign?.revision).toBe(7);
  });

  it('a queued victory behind the 409 is sent coins-only, and its campaign is what the conflict slot keeps', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7' };
    const r = rig({ server, cacheFrom: confirmedState() });
    const win: OutboxOp = { kind: 'victory', opId: 'V', missionId: 'm', stars: 2, start: 'n', campaign: body(5) };
    r.store.sync.setOps([camp('A', 1), win]);
    await r.sync.flush();
    const v = r.server.count('POST victory');
    expect(v).toHaveLength(1);
    expect(v[0]?.campaign).toBeNull();
    const slotPut = r.server.count('PUT slot')[0];
    expect(markOf(r.server.slots.get(slotPut?.id as string)?.body)).toBe(5);
    expect(r.cache.confirmed.wallet.free).toBe(10);
  });

  it('every system slot full (held): the newest queued campaign replaces the held entry', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7' };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const r = rig({ server, cacheFrom: confirmedState() });
    r.store.sync.setOps([camp('A', 1), camp('B', 2), camp('C', 3)]);
    await r.sync.flush();
    const held = readHeld(r.storage);
    expect(held).toHaveLength(1);
    expect(markOf(JSON.parse(held[0]?.text ?? '{}') as CampaignBody)).toBe(3);
    expect(r.server.count('PUT campaign')).toHaveLength(1);
  });
});

describe('A1-21 a_returning_device_after_gone_404', () => {
  it('401 + gone 404: nothing is uploaded, the state reads signedOut, the outbox flushes only after a sign-in to the same publicId', async () => {
    const server = new FakeServer();
    server.signedIn = false;
    let me: MeResult = { kind: 'signedOut' };
    const r = rig({ server, me: () => me });
    writeBinding(r.storage, { version: 1, publicId: 'pub1', deviceId: '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc', claimedAt: 5 });
    writeCache(r.storage, r.cache);
    r.store.writeLedger(led(4));
    await r.sync.flush();
    expect(r.sync.status()).toBe('signedOut');
    expect(r.server.campaign?.revision).toBe(3);
    expect(r.store.outboxSize()).toBe(1);
    expect(readCache(r.storage)).not.toBeNull();
    // still signed out: another flush attempts nothing
    const before = r.server.calls.length;
    await r.sync.flush();
    expect(r.server.calls.length).toBe(before);
    // sign in to the same member
    server.signedIn = true;
    me = { kind: 'signedIn', publicId: 'pub1', displayName: 'D', showRecord: false, avatar: { kind: 'preset', id: 'crest-chevrons', chosen: false }, createdDay: 0, fresh: false, identities: [] };
    await r.sync.flush();
    expect(r.sync.status()).toBe('active');
    expect(markOf(r.server.campaign)).toBe(4);
    expect(r.store.outboxSize()).toBe(0);
    expect(r.foreign).not.toHaveBeenCalled();
  });

  it('a sign-in to a different member offers keep-or-remove and sends no op', async () => {
    const server = new FakeServer();
    server.signedIn = false;
    let me: MeResult = { kind: 'signedOut' };
    const r = rig({ server, me: () => me });
    writeBinding(r.storage, { version: 1, publicId: 'pub1', deviceId: '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc', claimedAt: 5 });
    r.store.writeLedger(led(4));
    await r.sync.flush();
    server.signedIn = true;
    me = { kind: 'signedIn', publicId: 'someone-else', displayName: 'D', showRecord: false, avatar: { kind: 'preset', id: 'crest-chevrons', chosen: false }, createdDay: 0, fresh: false, identities: [] };
    const before = r.server.calls.length;
    await r.sync.flush();
    expect(r.foreign).toHaveBeenCalledTimes(1);
    expect(r.sync.status()).toBe('foreign');
    expect(r.server.calls.length).toBe(before);
    expect(r.server.campaign?.revision).toBe(3);
    expect(r.store.outboxSize()).toBe(1);
    // the old member's binding survives until the player chooses
    expect(readBinding(r.storage)?.publicId).toBe('pub1');
    expect(readBinding(r.storage)?.claimedAt).toBe(5);
  });

  it('deleted elsewhere: the cache and the outbox are cleared', async () => {
    const server = new FakeServer();
    server.signedIn = false;
    const r = rig({ server, me: () => ({ kind: 'signedOut' }) });
    writeBinding(r.storage, { version: 1, publicId: 'pub1' });
    writeCache(r.storage, r.cache);
    r.store.writeLedger(led(4));
    const c = clientFor(server, { me: () => ({ kind: 'signedOut' }), gone: 'deleted' });
    const sync = startSync({ store: r.store, client: c, storage: r.storage, now: r.sched.now, schedule: r.sched.schedule });
    await sync.flush();
    expect(sync.status()).toBe('deleted');
    expect(r.storage.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
    expect(r.storage.getItem(outboxKey('T1'))).toBeNull();
    expect(r.store.outboxSize()).toBe(0);
  });
});

describe('A2-31 two_tabs_lose_nothing', () => {
  const twoTabs = () => {
    const server = new FakeServer();
    const storage = memStorage();
    const locks = sharedLocks();
    const sched = makeScheduler();
    const t1 = rig({ server, storage, locks, sched, tabId: 'T1' });
    const t2 = rig({ server, storage, locks, sched, tabId: 'T2' });
    return { server, storage, t1, t2 };
  };
  const everything = (s: FakeServer): (number | undefined)[] =>
    [markOf(s.campaign), ...[...s.slots.values()].map((x) => markOf(x.body))].sort();

  it('tab 1 appends A, tab 2 appends B, both flush: one at a time, and the server plus its conflict slots hold both', async () => {
    const { server, t1, t2 } = twoTabs();
    t1.store.writeLedger(led(1));
    t2.store.writeLedger(led(2));
    await Promise.all([t1.sync.flush(), t2.sync.flush()]);
    expect(server.maxInFlight).toBe(1);
    expect(everything(server)).toEqual([1, 2]);
    expect(t1.store.outboxSize() + t2.store.outboxSize()).toBe(0);
  });

  it('tab 1\'s ack (removing A) interleaved with tab 2\'s append of C at the storage-call level: C survives', async () => {
    const { server, storage, t1, t2 } = twoTabs();
    t1.store.writeLedger(led(1));
    const remove = storage.removeItem;
    let done = false;
    storage.removeItem = (k) => {
      if (k === outboxKey('T1') && !done) {
        done = true;
        t2.store.writeLedger(led(3)); // lands in the middle of tab 1's ack
      }
      remove(k);
    };
    await t1.sync.flush();
    expect(done).toBe(true);
    expect(readOutbox(storage, 'T1')).toEqual([]);
    const c = readOutbox(storage, 'T2');
    expect(c).toHaveLength(1);
    expect(c[0]?.kind === 'campaign' && c[0].campaign.ledger[MARK]).toBe(3);
    await t2.sync.flush();
    expect(everything(server)).toEqual([1, 3]);
  });

  it('tab 2 stops its heartbeat with B queued: after 60 s tab 1 adopts B and sends it', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    const sched = makeScheduler();
    const t0 = sched.now();
    writeOutbox(storage, 'DEAD', [camp('B', 2)], 'pub1');
    storage.setItem(heartbeatKey('DEAD'), String(t0));
    const t1 = rig({ server, storage, sched, tabId: 'T1' });
    sched.setNow(t0 + 30_000);
    await t1.sync.flush();
    expect(server.count('PUT campaign')).toHaveLength(0); // still alive as far as anyone knows
    expect(readOutbox(storage, 'DEAD')).toHaveLength(1);
    sched.setNow(t0 + 61_000);
    await t1.sync.flush();
    expect(storage.getItem(heartbeatKey('T1'))).toBe(String(t0 + 61_000)); // written before the orphan scan
    // R12: an adopted campaign was built on a revision this tab never saw, so it is never PUT: it goes to a conflict slot.
    expect(server.count('PUT campaign')).toHaveLength(0);
    const slotPut = server.count('PUT slot');
    expect(slotPut).toHaveLength(1);
    expect(server.slots.get(slotPut[0]?.id as string)?.meta.origin).toBe('conflict');
    expect(markOf(server.slots.get(slotPut[0]?.id as string)?.body)).toBe(2);
    expect(readOutbox(storage, 'DEAD')).toEqual([]);
    expect(storage.getItem(outboxKey('DEAD'))).toBeNull();
  });

  it('a live sibling (queued ops, fresh heartbeat) is not adopted, and an adopted tab whose heartbeat is stale is', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    const sched = makeScheduler();
    const t1 = rig({ server, storage, sched, tabId: 'T1' });
    const t2 = rig({ server, storage, sched, tabId: 'T2' });
    t2.store.writeLedger(led(2)); // T2's op is queued (its own debounce timer is never advanced)
    expect(storage.getItem(heartbeatKey('T2'))).toBe(String(sched.now()));
    sched.setNow(sched.now() + 30_000);
    await t1.sync.flush();
    expect(readOutbox(storage, 'T2')).toHaveLength(1);
    expect(t2.store.outboxSize()).toBe(1);
    expect(server.calls.filter((c) => c.name !== 'GET state')).toHaveLength(0);
    // 61 s of silence from T2: now it is adoptable
    sched.setNow(sched.now() + 31_000);
    await t1.sync.flush();
    expect(readOutbox(storage, 'T2')).toEqual([]);
    expect(server.count('PUT slot')).toHaveLength(1);
  });

  it('this tab is never its own orphan: a heartbeat that cannot be written leaves its own queue sent once, not doubled', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    const set = storage.setItem;
    storage.setItem = (k, v) => {
      if (k === heartbeatKey('T1')) throw new Error('quota');
      set(k, v);
    };
    const t1 = rig({ server, storage, tabId: 'T1' });
    t1.store.writeLedger(led(1));
    expect(storage.getItem(heartbeatKey('T1'))).toBeNull(); // so the orphan scan lists this very tab
    await t1.sync.flush();
    expect(server.count('PUT campaign')).toHaveLength(1);
    expect(server.count('PUT slot')).toHaveLength(0);
    expect(readHeld(storage)).toEqual([]);
    expect(markOf(server.campaign)).toBe(1);
  });
});

describe('R12 the send base (C1)', () => {
  it('a replayed answer plus a second device: the next queued op is sent on the revision this queue last got, so it answers 409 and is kept as a conflict', async () => {
    const r = rig();
    r.server.loseResponse.add('A'); // A is applied (rev 4) but the answer is lost
    r.store.sync.setOps([camp('A', 1), camp('B', 2)]);
    await r.sync.flush();
    r.server.campaign = { ...(r.server.campaign as NonNullable<typeof r.server.campaign>), revision: 5, digest: 'd5', ledger: led(7) }; // another device
    await r.sched.advance(2000);
    await r.sync.idle();
    expect(r.server.count('PUT campaign').map((c) => [c.opId, c.base])).toEqual([['A', 3], ['A', 3], ['B', 4]]);
    expect(markOf(r.server.campaign)).toBe(7); // the other device's write was not overwritten
    expect([...r.server.slots.values()].filter((x) => x.meta.origin === 'conflict').map((x) => markOf(x.body))).toEqual([2]); // the 409 made B a conflict slot
    expect(r.store.outboxSize()).toBe(0);
  });

  it('an adopted orphan campaign is never PUT: it becomes a conflict slot, and an adopted victory is sent coins-only', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    const win: OutboxOp = { kind: 'victory', opId: 'V', missionId: 'm', stars: 1, start: null, campaign: body(8) };
    writeOutbox(storage, 'DEAD', [camp('B', 4), win], 'pub1');
    const r = rig({ server, storage, tabId: 'T1' });
    r.store.writeLedger(led(1)); // X, this tab's own
    await r.sync.flush();
    expect(r.server.count('PUT campaign').map((c) => c.base)).toEqual([3]); // X only; B (adopted) is never PUT
    expect(r.server.count('POST victory').map((c) => c.campaign)).toEqual([null]);
    expect(markOf(r.server.campaign)).toBe(1);
    const marks = [...r.server.slots.values()].filter((s) => s.meta.origin === 'conflict').map((s) => markOf(s.body));
    expect(marks).toEqual([8]); // the newest adopted campaign
  });

  it('an adopted campaign with every system slot full goes to the held list', async () => {
    const server = new FakeServer();
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const storage = memStorage();
    writeOutbox(storage, 'DEAD', [camp('B', 4)], 'pub1');
    const r = rig({ server, storage, tabId: 'T1' });
    await r.sync.flush();
    expect(r.server.count('PUT campaign')).toHaveLength(0);
    const held = readHeld(storage);
    expect(held.map((h) => [h.reason, markOf(JSON.parse(h.text) as CampaignBody)])).toEqual([['held', 4]]);
  });

  it('a refused setOps after keepAdopted, then a retry, leaves ONE held entry', async () => {
    const server = new FakeServer();
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const storage = memStorage();
    writeOutbox(storage, 'DEAD', [camp('B', 4), { kind: 'slot.put', opId: 'S', slotId: 's1', slot: slotOf('s1'), origin: 'player' }], 'pub1');
    const r = rig({ server, storage, tabId: 'T1' });
    const set = storage.setItem;
    let refused = 0;
    storage.setItem = (k, v) => {
      if (k === outboxKey('T1') && refused === 0) {
        refused++;
        throw new Error('quota');
      }
      set(k, v);
    };
    await r.sync.flush(); // the held write landed, adopting the orphan's slot op was refused: the orphan stays
    expect(refused).toBe(1);
    expect(readHeld(storage)).toHaveLength(1);
    expect(readOutbox(storage, 'DEAD')).toHaveLength(2);
    await r.sync.flush(); // the retry
    expect(readHeld(storage).map((h) => [h.reason, markOf(JSON.parse(h.text) as CampaignBody)])).toEqual([['held', 4]]);
    expect(readOutbox(storage, 'DEAD')).toEqual([]);
  });

  it('boot with a persisted outbox: the refresh moves confirmed but the queued op is still sent on the revision it was built on', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 4, digest: 'd4', ledger: led(9) }; // another device wrote
    const storage = memStorage();
    writeOutbox(storage, 'T1', [camp('A', 1)], 'pub1');
    const r = rig({ server, storage, cacheFrom: confirmedState() }); // the device last saw revision 3
    await r.sync.refresh();
    expect(r.cache.confirmed.campaign?.revision).toBe(4);
    await r.sync.flush();
    expect(r.server.calls.map((c) => [c.name, c.base])).toEqual([['GET state', undefined], ['PUT campaign', 3]]);
    expect(markOf(r.server.campaign)).toBe(9);
    expect(markOf(r.server.slots.values().next().value?.body)).toBe(1);
  });

  it('the send base survives a reload (it lives in the tab outbox value)', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 4, digest: 'd4', ledger: led(9) };
    const storage = memStorage();
    writeOutbox(storage, 'T1', [camp('A', 1)], 'pub1');
    const first = rig({ server, storage, cacheFrom: confirmedState() });
    await first.sync.refresh();
    first.sync.stop();
    const reloaded = readCache(storage) as NonNullable<ReturnType<typeof readCache>>;
    expect(reloaded.confirmed.campaign?.revision).toBe(4);
    const r = rig({ server, storage, cache: reloaded });
    await r.sync.flush();
    expect(r.server.count('PUT campaign').map((c) => c.base)).toEqual([3]);
    expect(markOf(r.server.campaign)).toBe(9);
  });

  it('C1: a second tab opening does not wipe tab 1\'s base; tab 1 reloads and the other device\'s write survives (409 -> conflict slot)', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    const sched = makeScheduler();
    const t1 = rig({ server, storage, sched, tabId: 'T1' });
    t1.store.writeLedger(led(1)); // queued on revision 3; the debounce never fires
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 4, digest: 'd4', ledger: led(9) }; // another device
    await t1.sync.refresh();
    expect(readCache(storage)?.confirmed.campaign?.revision).toBe(4);
    // tab 2 opens with nothing queued; it runs its boot (settle) against the shared storage
    const t2 = rig({ server, storage, sched, cache: readCache(storage) as NonNullable<ReturnType<typeof readCache>>, tabId: 'T2' });
    expect(t1.store.sync.base()).toBe(3);
    // tab 1 reloads (its tab id survives)
    t1.sync.stop();
    const t1b = rig({ server, storage, sched, cache: readCache(storage) as NonNullable<ReturnType<typeof readCache>>, tabId: 'T1' });
    expect(t1b.store.sync.base()).toBe(3); // the base came back with the queue
    await t1b.sync.flush();
    expect(server.count('PUT campaign').map((c) => c.base)).toEqual([3]);
    expect(markOf(server.campaign)).toBe(9); // the other device's write was not overwritten
    expect([...server.slots.values()].filter((x) => x.meta.origin === 'conflict').map((x) => markOf(x.body))).toEqual([1]);
    t2.sync.stop();
  });

  it('C1 reverse: a tab booting beside another tab\'s higher base does not inherit it', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    const sched = makeScheduler();
    const t1 = rig({ server, storage, sched, tabId: 'T1' });
    t1.store.writeLedger(led(1));
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 6, digest: 'd6', ledger: led(9) };
    await t1.sync.refresh(); // T1 pins base 3
    const t2 = rig({ server, storage, sched, cache: readCache(storage) as NonNullable<ReturnType<typeof readCache>>, tabId: 'T2' });
    t2.store.writeLedger(led(2)); // T2 has its own op, built on revision 6
    await t2.sync.flush();
    expect(server.count('PUT campaign').map((c) => c.base)).toEqual([6]);
    expect(markOf(server.campaign)).toBe(2);
    t1.sync.stop();
  });

  it('P3 (R17): tab 2 acks while tab 1 has an unsent op; tab 1 reloads and does not overwrite tab 2', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    const sched = makeScheduler();
    const t1 = rig({ server, storage, sched, tabId: 'T1' });
    t1.store.writeLedger(led(1)); // queued on revision 3, not flushed (debounce not advanced)
    const t2 = rig({ server, storage, sched, cache: readCache(storage) as NonNullable<ReturnType<typeof readCache>>, tabId: 'T2' });
    t2.store.writeLedger(led(2));
    await t2.sync.flush(); // server revision 4, mark 2; the shared cache is now revision 4
    expect(readCache(storage)?.confirmed.campaign?.revision).toBe(4);
    t1.sync.stop();
    const t1b = rig({ server, storage, sched, cache: readCache(storage) as NonNullable<ReturnType<typeof readCache>>, tabId: 'T1' });
    await t1b.sync.flush();
    expect(server.count('PUT campaign').map((c) => c.base)).toEqual([3, 3]); // tab 1 sent on the revision it was built on
    expect(markOf(server.campaign)).toBe(2); // tab 2's write was not overwritten
    expect([...server.slots.values()].filter((x) => x.meta.origin === 'conflict').map((x) => markOf(x.body))).toEqual([1]);
    t2.sync.stop();
  });

  it('P3 (R17), victory variant: a queued, unsent campaign-carrying victory pins its base; another tab writes; after a reload the other write survives', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    const sched = makeScheduler();
    // Tab 1's victory never reaches the server (the request fails in the air, once), so it stays queued and unsent.
    const cache1 = cacheOf(server.snapshot());
    // eslint-disable-next-line prefer-const -- the store's onChange closes over the sync that is built after it
    let sync1: SyncHandle | undefined;
    const store1 = accountLedgerStore({ storage, cache: cache1, world, onChange: () => sync1?.kick(), newOpId: opIds(), tabId: 'T1' });
    sync1 = startSync({
      store: store1,
      client: { ...clientFor(server), victory: () => Promise.resolve({ ok: false as const, status: 0, body: { error: 'network' } }) },
      storage,
      now: sched.now,
      schedule: sched.schedule,
    });
    const t1 = { store: store1, sync: sync1 };
    t1.store.recordVictory({ ledger: led(1), account: null, roar: null, win: { missionId: 'm', stars: 1 } as never, start: 'n' }); // queued on revision 3, unsent
    expect(t1.store.sync.ops().map((o) => o.kind)).toEqual(['victory']);
    const t2 = rig({ server, storage, sched, cache: readCache(storage) as NonNullable<ReturnType<typeof readCache>>, tabId: 'T2' });
    t2.store.writeLedger(led(2));
    await t2.sync.flush(); // server revision 4, mark 2; the shared cache is now revision 4
    expect(readCache(storage)?.confirmed.campaign?.revision).toBe(4);
    t1.sync.stop();
    const t1b = rig({ server, storage, sched, cache: readCache(storage) as NonNullable<ReturnType<typeof readCache>>, tabId: 'T1' });
    await t1b.sync.flush();
    expect(server.count('POST victory').map((c) => c.base)).toEqual([3]); // sent on the revision it was built on
    expect(markOf(server.campaign)).toBe(2); // tab 2's write was not overwritten
    expect([...server.slots.values()].filter((x) => x.meta.origin === 'conflict').map((x) => markOf(x.body))).toEqual([1]);
    t2.sync.stop();
  });

  it('R16: a 409 cap on a campaign op is transient: retried, never a strike', async () => {
    const r = rig();
    r.store.sync.setOps([camp('X', 1)]);
    const real = clientFor(r.server);
    let puts = 0;
    const client = { ...real, putCampaign: () => (puts++, Promise.resolve({ ok: false as const, status: 409, body: { error: 'cap' } })) };
    const sync = startSync({ store: r.store, client, storage: r.storage, now: r.sched.now, schedule: r.sched.schedule });
    await sync.flush();
    for (let i = 0; i < 8; i++) {
      await r.sched.advance(60_000);
      await sync.idle();
    }
    expect(puts).toBeGreaterThan(5);
    expect(readHeld(r.storage)).toEqual([]);
    expect(r.store.outboxSize()).toBe(1);
    sync.stop();
  });

  it('resolveConflict held retry leaves ONE held entry', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7', ledger: led(9) };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const storage = memStorage();
    const sched = makeScheduler();
    const t = rig({ server, storage, sched, cache: cacheOf(confirmedState()), tabId: 'T1' });
    t.store.writeLedger(led(2));
    const set = storage.setItem.bind(storage);
    let n = 0;
    storage.setItem = (k: string, v: string) => {
      if (k === HELD_KEY) {
        n++;
        if (n === 1) { t.store.writeLedger(led(42)); set(k, v); return; } // lap 0 lands, a newer op arrives
        if (n === 2) throw new Error('quota'); // lap 1 refused: 'wait'
      }
      set(k, v);
    };
    await t.sync.flush();
    await sched.advance(60_000); await t.sync.idle();
    await sched.advance(60_000); await t.sync.idle();
    expect(readHeld(storage)).toHaveLength(1);
    expect(markOf(JSON.parse(readHeld(storage)[0]!.text))).toBe(42);
    t.sync.stop();
  });

  it('with no campaign op queued the send base follows confirmed: a refresh to a newer revision is not a conflict', async () => {
    const r = rig();
    r.server.campaign = { ...(r.server.campaign as NonNullable<typeof r.server.campaign>), revision: 6, digest: 'd6' };
    await r.sync.refresh();
    r.store.writeLedger(led(3));
    await r.sync.flush();
    expect(r.server.count('PUT campaign').map((c) => c.base)).toEqual([6]);
    expect(r.server.slots.size).toBe(0);
    expect(markOf(r.server.campaign)).toBe(3);
  });
});

describe('I2 a write that lands while the held branch awaits', () => {
  it('an op appended while the held write is in progress is not lost: it replaces the held entry', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 7, digest: 'd7', ledger: led(9) };
    for (let i = 0; i < 4; i++) server.addSystemSlot();
    const storage = memStorage();
    const r = rig({ server, storage, cacheFrom: confirmedState() });
    r.store.writeLedger(led(2));
    const set = storage.setItem;
    let fired = false;
    storage.setItem = (k, v) => {
      if (k === HELD_KEY && !fired) {
        fired = true;
        r.store.writeLedger(led(42));
      }
      set(k, v);
    };
    await r.sync.flush();
    expect(fired).toBe(true);
    const held = readHeld(storage);
    expect(held).toHaveLength(1);
    expect(markOf(JSON.parse(held[0]?.text ?? '{}') as CampaignBody)).toBe(42);
    expect(r.store.outboxSize()).toBe(0); // the late op is itself behind the 409: dropped, never sent
    expect(r.server.count('PUT campaign')).toHaveLength(1);
    expect(markOf(r.server.campaign)).toBe(9);
  });
});

describe('R13 an outbox belongs to a member (I3)', () => {
  it('an orphan owned by another member, or by nobody (the old bare-array shape), is never adopted', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    writeOutbox(storage, 'OTHER', [camp('B', 2)], 'someone-else');
    storage.setItem(outboxKey('OLD'), JSON.stringify([camp('C', 3)]));
    const r = rig({ server, storage, tabId: 'T1' });
    await r.sync.flush();
    expect(server.calls.filter((c) => c.name !== 'GET state')).toHaveLength(0);
    expect(readOutbox(storage, 'OTHER')).toHaveLength(1);
    expect(readOutbox(storage, 'OLD').map((o) => o.opId)).toEqual(['C']); // the old shape still reads
    expect(r.store.outboxSize()).toBe(0);
  });

  it('sign-out files a sibling tab\'s queue for this member, then clears its keys; another member\'s keys stay', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    writeOutbox(storage, 'SIB', [camp('S', 5)], 'pub1');
    storage.setItem(heartbeatKey('SIB'), String(1_000_000));
    writeOutbox(storage, 'OTHER', [camp('B', 2)], 'someone-else');
    storage.setItem(heartbeatKey('OTHER'), String(1_000_000));
    const r = rig({ server, storage, tabId: 'T1' });
    server.failWith.set('A', 0);
    r.store.sync.setOps([camp('A', 1)]);
    await signOut({ sync: r.sync, store: r.store, client: clientFor(server), storage, schedule: r.sched.schedule, now: r.sched.now });
    expect(readHeld(storage).map((h) => [h.id, h.reason]).sort()).toEqual([['A', 'refused'], ['S', 'refused']]);
    expect([...storage.map.keys()].filter((k) => k.includes('SIB') || k.includes('T1'))).toEqual([]);
    expect(storage.getItem(outboxKey('OTHER'))).not.toBeNull();
    expect(storage.getItem(heartbeatKey('OTHER'))).not.toBeNull();
  });

  it('the deleted wipe files this member\'s queues (own and siblings\') and clears their keys', async () => {
    const server = new FakeServer();
    server.signedIn = false;
    const storage = memStorage();
    writeOutbox(storage, 'SIB', [camp('S', 5)], 'pub1');
    storage.setItem(heartbeatKey('SIB'), String(1_000_000));
    const r = rig({ server, storage, tabId: 'T1', me: () => ({ kind: 'signedOut' }) });
    writeBinding(storage, { version: 1, publicId: 'pub1' });
    r.store.writeLedger(led(4));
    const c = clientFor(server, { me: () => ({ kind: 'signedOut' }), gone: 'deleted' });
    const sync = startSync({ store: r.store, client: c, storage, now: r.sched.now, schedule: r.sched.schedule });
    await sync.flush();
    expect(sync.status()).toBe('deleted');
    expect(readHeld(storage).map((h) => h.reason)).toEqual(['refused', 'refused']);
    expect([...storage.map.keys()].filter((k) => k.includes('SIB') || k.includes('T1'))).toEqual([]);
  });
});

describe('failures', () => {
  it('a_wedged_op_is_filed: five 500s file it as refused, with the backoff 2 s doubling, and the next op is sent', async () => {
    const r = rig();
    r.server.failWith.set('X', 500);
    r.store.sync.setOps([camp('X', 1), { kind: 'slot.put', opId: 'Y', slotId: 's1', slot: slotOf('s1'), origin: 'player' }]);
    await r.sync.flush();
    for (let i = 0; i < 4; i++) {
      await r.sched.advance(60_000);
      await r.sync.idle();
    }
    expect(r.sched.delays.filter((d) => d !== 10_000)).toEqual([2000, 4000, 8000, 16000]);
    expect(r.server.count('PUT campaign')).toHaveLength(5);
    const held = readHeld(r.storage);
    expect(held.map((h) => [h.id, h.reason, h.kind])).toEqual([['X', 'refused', 'campaign']]);
    expect(r.server.count('PUT slot').map((c) => c.opId)).toEqual(['Y']);
    expect(r.store.outboxSize()).toBe(0);
  });

  it('the backoff caps at 60 s and network failures never file', async () => {
    const r = rig();
    r.server.failWith.set('X', 0);
    r.store.sync.setOps([camp('X', 1)]);
    await r.sync.flush();
    for (let i = 0; i < 9; i++) {
      await r.sched.advance(60_000);
      await r.sync.idle();
    }
    expect(r.sched.delays.filter((d) => d !== 10_000)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000, 60000]);
    expect(readHeld(r.storage)).toEqual([]);
    expect(r.store.outboxSize()).toBe(1);
  });

  it('R14: 502, 503 and 504 back off like a network failure and never file', async () => {
    for (const status of [502, 503, 504]) {
      const r = rig();
      r.server.failWith.set('X', status);
      r.store.sync.setOps([camp('X', 1)]);
      await r.sync.flush();
      for (let i = 0; i < 8; i++) {
        await r.sched.advance(60_000);
        await r.sync.idle();
      }
      expect(r.server.count('PUT campaign').length).toBeGreaterThanOrEqual(8);
      expect(readHeld(r.storage)).toEqual([]);
      expect(r.store.outboxSize()).toBe(1);
    }
  });

  it('R16: a 403 five times files the op as refused and the next op is sent', async () => {
    const r = rig();
    r.server.failWith.set('X', 403);
    r.store.sync.setOps([camp('X', 1), { kind: 'slot.put', opId: 'Y', slotId: 's1', slot: slotOf('s1'), origin: 'player' }]);
    await r.sync.flush();
    for (let i = 0; i < 4; i++) {
      await r.sched.advance(60_000);
      await r.sync.idle();
    }
    expect(r.server.count('PUT campaign')).toHaveLength(5);
    expect(readHeld(r.storage).map((h) => [h.id, h.reason])).toEqual([['X', 'refused']]);
    expect(r.server.count('PUT slot').map((c) => c.opId)).toEqual(['Y']);
    expect(r.store.outboxSize()).toBe(0);
  });

  it('R16: an unknown 409 and a 418 count toward the wedge too', async () => {
    for (const [status, error] of [[409, 'mystery'], [418, 'teapot']] as const) {
      const r = rig();
      r.store.sync.setOps([camp('X', 1)]);
      const real = clientFor(r.server);
      let puts = 0;
      const client = { ...real, putCampaign: () => (puts++, Promise.resolve({ ok: false as const, status, body: { error } })) };
      const sync = startSync({ store: r.store, client, storage: r.storage, now: r.sched.now, schedule: r.sched.schedule });
      await sync.flush();
      for (let i = 0; i < 4; i++) {
        await r.sched.advance(60_000);
        await sync.idle();
      }
      expect(puts).toBe(5);
      expect(readHeld(r.storage).map((h) => h.id)).toEqual(['X']);
      expect(r.store.outboxSize()).toBe(0);
      sync.stop();
    }
  });

  it('R16: a 404 on slot.delete is success at once: the op is removed and nothing is filed', async () => {
    const r = rig();
    r.server.failWith.set('D', 404);
    r.store.sync.setOps([{ kind: 'slot.delete', opId: 'D', slotId: 'gone' }, camp('X', 1)]);
    await r.sync.flush();
    expect(r.server.count('DELETE slot')).toHaveLength(1); // not retried
    expect(r.server.count('PUT campaign')).toHaveLength(1); // the op behind it was sent in the same flush
    expect(readHeld(r.storage)).toEqual([]);
    expect(r.store.outboxSize()).toBe(0);
  });

  it('R14: a 200 whose body is malformed counts toward the wedge, and the filed victory keeps the WHOLE op', async () => {
    const r = rig();
    const win: OutboxOp = { kind: 'victory', opId: 'V', missionId: 'm', stars: 2, start: 'n', campaign: body(5) };
    r.store.sync.setOps([win, camp('Z', 2)]);
    const real = clientFor(r.server);
    let victories = 0;
    const client = { ...real, victory: () => (victories++, Promise.resolve({ ok: true as const, status: 200 as const, body: {} as never })) };
    const sync = startSync({ store: r.store, client, storage: r.storage, now: r.sched.now, schedule: r.sched.schedule });
    await sync.flush();
    for (let i = 0; i < 5; i++) {
      await r.sched.advance(60_000);
      await sync.idle();
    }
    expect(victories).toBe(5);
    const held = readHeld(r.storage);
    expect(held.map((h) => [h.id, h.reason])).toEqual([['V', 'refused']]);
    expect(JSON.parse(held[0]?.text ?? 'null')).toEqual(win);
    expect(r.server.count('PUT campaign').map((c) => c.opId)).toEqual(['Z']); // the next op was sent
  });

  it('R14: a 409 busy five times files; the filed campaign op keeps the whole op too', async () => {
    const r = rig();
    r.server.failWith.set('X', 409);
    r.store.sync.setOps([camp('X', 1)]);
    await r.sync.flush();
    for (let i = 0; i < 5; i++) {
      await r.sched.advance(60_000);
      await r.sync.idle();
    }
    const held = readHeld(r.storage);
    expect(held.map((h) => h.id)).toEqual(['X']);
    expect(JSON.parse(held[0]?.text ?? 'null')).toEqual(camp('X', 1));
  });

  it('a 401 where me says the same member is still signed in backs off instead of retrying at once', async () => {
    const server = new FakeServer();
    server.signedIn = false;
    const r = rig({ server }); // clientFor's default me: signed in as pub1
    r.store.recordVictory({ ledger: {}, account: null, roar: null, win: { missionId: 'm', stars: 1 } as never, start: 'n' });
    await r.sync.idle();
    for (let i = 0; i < 5; i++) await tick();
    expect(r.server.count('POST victory')).toHaveLength(1);
    expect(r.sched.delays.filter((d) => d !== 10_000)).toEqual([2000]);
    expect(r.sync.status()).toBe('active');
  });

  it('a 400 drops the op and files it as refused', async () => {
    const r = rig();
    r.server.failWith.set('X', 400);
    r.store.sync.setOps([camp('X', 1), camp('Z', 2)]);
    await r.sync.flush();
    expect(readHeld(r.storage).map((h) => [h.id, h.reason])).toEqual([['X', 'refused']]);
    expect(r.server.count('PUT campaign').map((c) => c.opId)).toEqual(['X', 'Z']);
  });

  it('a_replayed_answer_never_rewinds: a campaign older than confirmed keeps confirmed and triggers one GET state', async () => {
    const server = new FakeServer();
    server.campaign = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 5, digest: 'd5' };
    const r = rig({ server });
    expect(r.cache.confirmed.campaign?.revision).toBe(5);
    const real = clientFor(server);
    const older = { ...(server.campaign as NonNullable<typeof server.campaign>), revision: 3, digest: 'd3' };
    const client = { ...real, putCampaign: () => Promise.resolve({ ok: true as const, status: 200 as const, body: { campaign: older } }) };
    const sync = startSync({ store: r.store, client, storage: r.storage, now: r.sched.now, schedule: r.sched.schedule });
    r.store.writeLedger(led(1));
    await sync.flush();
    expect(r.cache.confirmed.campaign?.revision).toBe(5);
    expect(server.count('GET state')).toHaveLength(1);
    expect(r.store.outboxSize()).toBe(0);
  });

  it('a reduced campaign (a replay) never replaces confirmed either', async () => {
    const r = rig();
    const real = clientFor(r.server);
    const client = { ...real, putCampaign: () => Promise.resolve({ ok: true as const, status: 200 as const, body: { campaign: { revision: 4, digest: 'd4' } } }) };
    const sync = startSync({ store: r.store, client, storage: r.storage, now: r.sched.now, schedule: r.sched.schedule });
    r.store.writeLedger(led(1));
    await sync.flush();
    expect(r.cache.confirmed.campaign?.ledger).toBeDefined();
    expect(r.server.count('GET state')).toHaveLength(1);
  });

  it('retried_victory_counts_once: the first answer is lost; the retry has the same op id and the balance rises once', async () => {
    const r = rig();
    r.store.sync.setOps([{ kind: 'victory', opId: 'V1', missionId: 'm', stars: 2, start: 'n', campaign: body(1) }]);
    r.server.loseResponse.add('V1');
    await r.sync.flush();
    expect(r.cache.confirmed.wallet.free).toBe(0); // nothing applied from a lost answer
    expect(r.store.outboxSize()).toBe(1);
    await r.sched.advance(2000);
    await r.sync.idle();
    expect(r.server.count('POST victory').map((c) => c.opId)).toEqual(['V1', 'V1']);
    expect(r.cache.confirmed.wallet.free).toBe(10);
    expect(r.server.wallet.free).toBe(10);
    expect(r.store.readRoar().coins.free).toBe(10);
    expect(r.store.outboxSize()).toBe(0);
    expect(r.cache.confirmed.campaign?.revision).toBe(4); // the reduced replay was refreshed by one GET state
    expect(r.server.count('GET state')).toHaveLength(1);
  });
});

describe('the debounce and the barrier', () => {
  it('burst_of_purchases_sends_few: 30 appends in 1 s, then the debounce: one PUT campaign', async () => {
    const r = rig();
    for (let i = 1; i <= 30; i++) {
      r.store.writeLedger(led(i));
      await r.sched.advance(30);
    }
    expect(r.server.calls).toHaveLength(0);
    expect(r.sched.delays.filter((d) => d !== 10_000)).toEqual([FLUSH_DEBOUNCE_MS]);
    await r.sched.advance(FLUSH_DEBOUNCE_MS);
    await r.sync.idle();
    expect(r.server.count('PUT campaign')).toHaveLength(1);
    expect(markOf(r.server.campaign)).toBe(30);
  });

  it('a victory is sent at once', async () => {
    const r = rig();
    r.store.recordVictory({ ledger: {}, account: null, roar: null, win: { missionId: 'm', stars: 1 } as never, start: 'n' });
    await r.sync.idle();
    expect(r.server.count('POST victory')).toHaveLength(1);
  });

  it('barrier_waits: syncing with an op queued, offline when offline, runs when the outbox is empty', async () => {
    let online = true;
    const r = rig({ online: () => online });
    const fn = vi.fn(() => Promise.resolve('ran'));
    r.store.sync.setOps([camp('A', 1)]);
    expect(await r.sync.barrier(fn)).toBe('syncing');
    online = false;
    expect(await r.sync.barrier(fn)).toBe('offline');
    expect(fn).not.toHaveBeenCalled();
    online = true;
    r.store.sync.setOps([]);
    expect(await r.sync.barrier(fn)).toBe('ran');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a spend marks its key in pendingSpends while in flight, for a tier and for a unit', async () => {
    const r = rig();
    const gate = deferred();
    r.server.spendHold = gate.promise;
    const p = r.sync.spend({ item: 'tier', unitId: 'u1', track: 'armor', tier: 1 });
    await tick();
    expect([...r.store.pendingSpends]).toEqual(['u1.armor']);
    gate.release();
    const out = await p;
    expect(out.kind).toBe('ok');
    expect(r.store.pendingSpends.size).toBe(0);
    expect(r.cache.confirmed.wallet.free).toBe(-5);
    r.server.spendHold = null;
    const g2 = deferred();
    r.server.spendHold = g2.promise;
    const q = r.sync.spend({ item: 'unit', unitId: 'u2' });
    await tick();
    expect([...r.store.pendingSpends]).toEqual(['unit:u2']);
    g2.release();
    await q;
    expect(r.store.pendingSpends.size).toBe(0);
  });
});

describe('bodies', () => {
  it('a slot whose change token differs from the cache is fetched with client.slot after GET state', async () => {
    const server = new FakeServer();
    const r = rig({ server });
    const body9 = slotFrom(body(0), 's9', 'Nine', 5);
    server.slots.set('s9', { meta: { id: 's9', name: 'Nine', savedAt: 5, build: 'b', origin: 'player', bytes: 100 }, body: body9 });
    expect(r.store.readSlotsRaw()).toBeNull(); // hidden: no body yet
    await r.sync.refresh();
    expect(server.count('GET slot').map((c) => c.id)).toEqual(['s9']);
    expect(r.cache.bodies.s9?.name).toBe('Nine');
    expect(Object.keys(JSON.parse(r.store.readSlotsRaw() ?? '{}') as object)).toEqual(['s9']);
    // the same token: no second fetch
    await r.sync.refresh();
    expect(server.count('GET slot')).toHaveLength(1);
    // another device changed it
    const next = { ...body9, name: 'Nine!' };
    server.slots.set('s9', { meta: { id: 's9', name: 'Nine!', savedAt: 6, build: 'b', origin: 'player', bytes: 101 }, body: next });
    await r.sync.refresh();
    expect(server.count('GET slot')).toHaveLength(2);
    expect(r.cache.bodies.s9?.name).toBe('Nine!');
  });

  it('the confirmed object is replaced, never mutated', async () => {
    const r = rig();
    const before = r.cache.confirmed;
    r.store.writeLedger(led(1));
    await r.sync.flush();
    expect(r.cache.confirmed).not.toBe(before);
    expect(before.campaign?.revision).toBe(3);
  });
});

describe('signOut', () => {
  it('sign_out_files_what_it_cannot_send: offline with two queued ops: both filed as refused, then the cache, outbox, claimedAt and deviceId are cleared', async () => {
    const server = new FakeServer();
    server.failWith.set('A', 0);
    server.failWith.set('P', 0);
    const r = rig({ server });
    writeBinding(r.storage, { version: 1, publicId: 'pub1', deviceId: '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc', claimedAt: 5 });
    writeCache(r.storage, r.cache);
    r.storage.setItem('lions.account.claiming', '{"deviceId":"0b5f6d3e-1c2a-4f7b-9d8e-123456789abc","digests":{"campaign":null,"slots":{}},"at":1}');
    r.store.sync.setOps([camp('A', 1), { kind: 'slot.put', opId: 'P', slotId: 's1', slot: slotOf('s1'), origin: 'player' }]);
    await signOut({ sync: r.sync, store: r.store, client: clientFor(server), storage: r.storage, schedule: r.sched.schedule, now: r.sched.now });
    expect(readHeld(r.storage).map((h) => [h.id, h.reason])).toEqual([['A', 'refused'], ['P', 'refused']]);
    expect(server.calls[server.calls.length - 1]?.name).toBe('logout');
    expect(r.storage.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
    expect(r.storage.getItem(outboxKey('T1'))).toBeNull();
    const b = readBinding(r.storage);
    expect(b?.deviceId).toBeUndefined();
    expect(b?.claimedAt).toBeUndefined();
    expect(r.storage.getItem(ACCOUNT_BINDING_KEY)).not.toContain('claimedAt');
    expect(r.storage.getItem('lions.account.claiming'), 'a pending claim marker must not survive sign-out').toBeNull();
  });

  it('a queue that sends cleanly files nothing', async () => {
    const r = rig();
    r.store.writeLedger(led(1));
    await signOut({ sync: r.sync, store: r.store, client: clientFor(r.server), storage: r.storage, schedule: r.sched.schedule, now: r.sched.now });
    expect(readHeld(r.storage)).toEqual([]);
    expect(markOf(r.server.campaign)).toBe(1);
  });

  it('when the held write is refused, nothing is logged out or cleared', async () => {
    const server = new FakeServer();
    server.failWith.set('A', 0);
    const r = rig({ server });
    writeCache(r.storage, r.cache);
    r.store.sync.setOps([camp('A', 1)]);
    const set = r.storage.setItem;
    r.storage.setItem = (k, v) => {
      if (k === HELD_KEY) throw new Error('quota');
      set(k, v);
    };
    await expect(signOut({ sync: r.sync, store: r.store, client: clientFor(server), storage: r.storage, schedule: r.sched.schedule, now: r.sched.now })).rejects.toThrow();
    expect(server.count('logout')).toHaveLength(0);
    expect(r.storage.getItem(ACCOUNT_CACHE_KEY)).not.toBeNull();
    expect(r.store.outboxSize()).toBe(1);
  });
});


describe('I1 the loop starts unverified', () => {
  const other: MeResult = { kind: 'signedIn', publicId: 'someone-else', displayName: 'B', showRecord: false, avatar: { kind: 'preset', id: 'crest-chevrons', chosen: false }, createdDay: 0, fresh: false, identities: [] };
  it('a fresh startSync whose me() names another member applies no GET state, sends no op and calls onForeignMember', async () => {
    const server = new FakeServer();
    const storage = memStorage();
    writeBinding(storage, { version: 1, publicId: 'pub1', deviceId: '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc', claimedAt: 5 });
    const staleState = confirmedState({ campaign: { ledger: led(1), brigade: emptyAccount(), tutorialDone: false, revision: 2, digest: 'old' } });
    const r = rig({ server, storage, me: () => other, cacheFrom: staleState });
    writeOutbox(storage, 'T1', [camp('A', 7)], 'pub1'); // A's queue sits on the device
    r.store.sync.setOps([camp('A', 7)]);
    const before = r.cache.confirmed;
    await r.sync.refresh(); // boot's refresh
    await r.sync.flush(); // the next drain
    expect(r.sync.status()).toBe('foreign');
    expect(r.foreign).toHaveBeenCalledTimes(1);
    expect(r.server.calls.map((c) => c.name)).not.toContain('GET state');
    expect(r.server.calls.filter((c) => c.name.startsWith('PUT') || c.name.startsWith('POST'))).toEqual([]);
    expect(r.cache.confirmed).toBe(before);
    expect(r.store.outboxSize()).toBe(1);
  });

  it('the same member verifies once, then refreshes and sends', async () => {
    const r = rig();
    r.store.writeLedger(led(5));
    await r.sync.refresh();
    expect(r.sync.status()).toBe('active');
    await r.sync.flush();
    expect(markOf(r.server.campaign)).toBe(5);
  });

  it('an outbox key stamped with another member is not adopted by this member\'s store and stays on disk', () => {
    const storage = memStorage();
    writeOutbox(storage, 'T1', [camp('A', 7)], 'pub-A');
    const mine = accountLedgerStore({ storage, cache: cacheOf(), world, onChange: () => {}, newOpId: opIds(), tabId: 'T1' });
    expect(mine.outboxSize()).toBe(0);
    expect(readOutbox(storage, 'T1')).toHaveLength(1); // untouched until the right member comes back
    const owner = accountLedgerStore({ storage, cache: { ...cacheOf(), publicId: 'pub-A' }, world, onChange: () => {}, newOpId: opIds(), tabId: 'T1' });
    expect(owner.outboxSize()).toBe(1);
  });
});

describe('NB1 an unanswered GET me backs off', () => {
  const off: MeResult = { kind: 'off' };
  const win: OutboxOp = { kind: 'victory', opId: 'V', missionId: 'm', stars: 2, start: 'n', campaign: body(5) };
  /** The fake `me` answers through a resolved promise (as a real fetch does); after 200 asks it gives in and names the member, which only ends a runaway loop so the count assertions below can fail instead of hanging. */
  const slowOff = (asks: { n: number }) => (): MeResult => {
    asks.n++;
    return asks.n > 200 ? { kind: 'signedIn', publicId: 'pub1', displayName: 'D', showRecord: false, avatar: { kind: 'preset', id: 'crest-chevrons', chosen: false }, createdDay: 0, fresh: false, identities: [] } : off;
  };
  const retries = (r: Rig): number[] => r.sched.delays.filter((d) => d !== HEARTBEAT_MS);
  const bound = (asks: { n: number }): Rig => {
    const storage = memStorage();
    writeBinding(storage, { version: 1, publicId: 'pub1', deviceId: '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc', claimedAt: 5 });
    return rig({ storage, me: slowOff(asks) });
  };

  it('a queued victory with me -> off asks once, then on the 2 s -> 4 s -> 8 s backoff, never in a loop', async () => {
    const asks = { n: 0 };
    const r = bound(asks);
    r.store.sync.setOps([win]);
    r.sync.kick();
    for (let i = 0; i < 20; i++) await tick();
    expect(asks.n).toBe(1);
    expect(retries(r)).toEqual([2000]);
    await r.sched.advance(2000);
    for (let i = 0; i < 20; i++) await tick();
    expect(asks.n).toBe(2);
    await r.sched.advance(4000);
    for (let i = 0; i < 20; i++) await tick();
    expect(asks.n).toBe(3);
    expect(retries(r)).toEqual([2000, 4000, 8000]);
    expect(r.sync.status()).toBe('unverified');
    expect(r.server.calls.filter((c) => c.name !== 'GET me')).toEqual([]);
    r.sync.stop();
  });

  it('refresh with me -> off schedules the backoff', async () => {
    const r = bound({ n: 0 });
    await r.sync.refresh();
    expect(retries(r)).toEqual([2000]);
    r.sync.stop();
  });

  it('a barrier op with me -> off answers error 0 and schedules the backoff', async () => {
    const r = bound({ n: 0 });
    expect(await r.sync.spend({ item: 'unit', unitId: 'u' } as never)).toEqual({ kind: 'error', status: 0 });
    expect(retries(r)).toEqual([2000]);
    r.sync.stop();
  });
});

describe('NB3 a rejected sign-out', () => {
  const failLogout = (server: FakeServer) => ({ ...clientFor(server), logout: async () => ({ error: 'error', status: 500 }) as const });

  it('takes back the refused copies it filed and resumes the loop, so the queued work keeps syncing', async () => {
    const server = new FakeServer();
    server.failWith.set('A', 0);
    const r = rig({ server });
    writeCache(r.storage, r.cache);
    r.store.sync.setOps([camp('A', 1)]);
    const prior = { id: 'old', kind: 'campaign' as const, reason: 'held' as const, text: '{}', at: 1, publicId: 'pub1', digest: 'd' };
    r.storage.setItem(HELD_KEY, JSON.stringify([prior]));
    await expect(signOut({ sync: r.sync, store: r.store, client: failLogout(server), storage: r.storage, schedule: r.sched.schedule, now: r.sched.now })).rejects.toThrow();
    expect(readHeld(r.storage).map((h) => h.id)).toEqual(['old']);
    expect(r.sync.status()).not.toBe('stopped');
    expect(r.storage.getItem(ACCOUNT_CACHE_KEY)).not.toBeNull();
    expect(r.store.outboxSize()).toBe(1);
    server.failWith.delete('A');
    await r.sync.flush();
    await r.sched.advance(60_000);
    await r.sync.flush();
    expect(r.store.outboxSize()).toBe(0);
    expect(markOf(r.server.campaign)).toBe(1);
  });

  it('a barrier op on a stopped loop answers offline and sends nothing', async () => {
    const r = rig();
    r.sync.stop();
    const before = r.server.calls.length;
    expect(await r.sync.spend({ item: 'unit', unitId: 'u' } as never)).toEqual({ kind: 'offline' });
    expect(r.server.calls.length).toBe(before);
  });
});

describe('R27 a foreign-owned tab key is re-keyed, not written', () => {
  // Node 22 defines no global Web Storage and Node 25 does: install the tab's own sessionStorage so neither matters.
  let tabSession: ReturnType<typeof memStorage>;
  beforeEach(() => {
    tabSession = memStorage();
    vi.stubGlobal('sessionStorage', tabSession);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('B boots in the tab whose key holds A\'s ops: B writes under a new key, A\'s key is byte-identical, and A\'s own loop adopts it later', async () => {
    const storage = memStorage();
    writeOutbox(storage, 'T', [camp('A1', 7)], 'pub-A');
    const bytes = storage.getItem(outboxKey('T'));
    const b = selectLedgerStore(new URLSearchParams('accounts'), (() => {
      writeBinding(storage, { version: 1, publicId: 'pub1', claimedAt: 5 });
      writeCache(storage, cacheOf());
      return storage;
    })(), (w) => w, { world, tabId: 'T', newOpId: opIds() });
    const store = b.store as ReturnType<typeof accountLedgerStore>;
    expect(store.sync.tabId).not.toBe('T');
    expect(tabSession.getItem(TAB_ID_KEY)).toBe(store.sync.tabId);
    store.writeLedger(led(3)); // B's write
    store.sync.setBase(4);
    store.sync.setOps([]); // B's sign-out
    clearTab(storage, store.sync.tabId);
    wipeMember({ store, storage, now: () => 1 }); // and a 401 wipe
    expect(storage.getItem(outboxKey('T'))).toBe(bytes);
    // A comes back: no heartbeat for T, so it is an orphan to A's own loop.
    const server = new FakeServer();
    const sched = makeScheduler();
    const cacheA = { ...cacheOf(server.snapshot()), publicId: 'pub-A' };
    const storeA = accountLedgerStore({ storage, cache: cacheA, world, onChange: () => {}, newOpId: opIds(), tabId: 'TA' });
    const syncA = startSync({ store: storeA, client: clientFor(server, { me: () => ({ kind: 'signedIn', publicId: 'pub-A', displayName: 'A', showRecord: false, avatar: { kind: 'preset', id: 'crest-chevrons', chosen: false }, createdDay: 0, fresh: false, identities: [] }) }), storage, now: sched.now, schedule: sched.schedule });
    storeA.sync.setOps([camp('A0', 1)]);
    await syncA.flush();
    expect(storage.getItem(outboxKey('T'))).toBeNull();
    expect(markOf(server.campaign)).toBeDefined();
    syncA.stop();
  });
});
