import { describe, expect, it } from 'vitest';
import { bootAccount, bootAccountLazy, FIRST_STATE_MS } from './boot';
import { readBinding, writeBinding } from './binding';
import { readCache } from './cache';
import { memStorage, opIds, world, cacheOf } from './fixtures';
import { writeCache } from './cache';
import { selectLedgerStore, type SelectedStore } from './select-store';
import type { SyncHandle } from './sync';
import { clientFor, FakeServer, makeScheduler, tick } from './sync-kit';
import { isAccountStore } from './account-store';

const backfill = (w: Parameters<NonNullable<Parameters<typeof selectLedgerStore>[2]>>[0]) => w;
const select = (s: ReturnType<typeof memStorage>, query: string, onChange?: () => void): SelectedStore =>
  selectLedgerStore(new URLSearchParams(query), s, backfill, { world, onChange, tabId: 'T1', newOpId: opIds() });
const claimedNoCache = () => {
  const s = memStorage();
  writeBinding(s, { version: 1, publicId: 'pub1', claimedAt: 5 });
  return s;
};

describe('bootAccount (§0.11, Task 2.12)', () => {
  it('a claimed device with no cache awaits GET state, writes the cache, swaps in the account store and refreshes', async () => {
    const s = claimedNoCache();
    const server = new FakeServer();
    const sched = makeScheduler();
    let kicked: SyncHandle | null = null;
    const first = select(s, 'accounts', () => kicked?.kick());
    expect(first).toMatchObject({ signedIn: true, needsState: true });
    expect(isAccountStore(first.store)).toBe(false);
    const booted = await bootAccount({ selected: first, reselect: () => select(s, 'accounts', () => kicked?.kick()), client: clientFor(server), storage: s, now: sched.now, schedule: sched.schedule });
    kicked = booted.sync;
    expect(booted.unreachable).toBe(false);
    expect(readCache(s)?.publicId).toBe('pub1');
    expect(isAccountStore(booted.selected.store)).toBe(true);
    expect(booted.sync).not.toBeNull();
    expect(booted.flow).not.toBeNull();
    await tick();
    await tick();
    // One GET state to build the cache, one for the loop's boot refresh.
    expect(server.count('GET state').length).toBeGreaterThanOrEqual(2);
    // The store's onChange reaches the loop: a queued op is sent after the debounce.
    if (!isAccountStore(booted.selected.store)) throw new Error('premise');
    booted.selected.store.writeLedger({ 'campaign.slots_issued': 1 });
    await sched.advance(2000);
    await booted.sync?.idle();
    expect(server.count('PUT campaign')).toHaveLength(1);
    booted.sync?.stop();
  });

  it('a state that does not arrive in 5 s is unreachable: no store, no loop', async () => {
    const s = claimedNoCache();
    const server = new FakeServer();
    const sched = makeScheduler();
    server.holds.push(new Promise<void>(() => {})); // the first request never answers
    const first = select(s, 'accounts');
    const pending = bootAccount({ selected: first, reselect: () => select(s, 'accounts'), client: clientFor(server), storage: s, now: sched.now, schedule: sched.schedule });
    await tick();
    await sched.advance(FIRST_STATE_MS);
    const booted = await pending;
    expect(booted).toMatchObject({ unreachable: true, sync: null, flow: null });
    expect(isAccountStore(booted.selected.store)).toBe(false);
    expect(readCache(s)).toBeNull();
  });

  it('a 401 with a claimed binding and no cache falls back to the guest store, the claim marks cleared (§0.46)', async () => {
    const s = claimedNoCache();
    const server = new FakeServer();
    server.signedIn = false;
    const sched = makeScheduler();
    const booted = await bootAccount({ selected: select(s, 'accounts'), reselect: () => select(s, 'accounts'), client: clientFor(server), storage: s, now: sched.now, schedule: sched.schedule });
    expect(booted).toMatchObject({ unreachable: false, sync: null, flow: null });
    expect(booted.selected).toMatchObject({ signedIn: false, needsState: false });
    expect(readBinding(s)).toEqual({ version: 1, publicId: 'pub1' }); // claimedAt and deviceId gone, as sign-out leaves it
    expect(readCache(s)).toBeNull();
  });

  it('a 401 with a cache is the loop\'s read-only signed-out state: nothing uploaded, the cache kept', async () => {
    const s = claimedNoCache();
    writeCache(s, cacheOf());
    const server = new FakeServer();
    server.signedIn = false;
    const sched = makeScheduler();
    const booted = await bootAccount({ selected: select(s, 'accounts'), reselect: () => select(s, 'accounts'), client: clientFor(server, { me: () => ({ kind: 'signedOut' }) }), storage: s, now: sched.now, schedule: sched.schedule });
    expect(booted.selected.signedIn).toBe(true);
    expect(booted.sync).not.toBeNull();
    if (!isAccountStore(booted.selected.store)) throw new Error('premise');
    booted.selected.store.writeLedger({ 'campaign.slots_issued': 1 });
    await booted.sync?.flush();
    expect(booted.sync?.status()).toBe('signedOut');
    expect(booted.selected.store.sync.ops()).toHaveLength(1); // kept queued, not sent
    expect(readCache(s)?.publicId).toBe('pub1');
    expect(readBinding(s)?.claimedAt).toBe(5);
    expect(server.campaign?.revision).toBe(3); // the 401'd send changed nothing on the server
    booted.sync?.stop();
  });

  it('a client module that will not load: a device with no cache is unreachable', async () => {
    const s = claimedNoCache();
    const sched = makeScheduler();
    const booted = await bootAccountLazy({ selected: select(s, 'accounts'), reselect: () => select(s, 'accounts'), loadClient: () => Promise.reject(new Error('chunk')), storage: s, now: sched.now, schedule: sched.schedule });
    expect(booted).toMatchObject({ unreachable: true, sync: null, flow: null });
  });

  it('a client module that will not load on a device WITH its cache runs offline from it: not unreachable', async () => {
    const s = claimedNoCache();
    writeCache(s, cacheOf());
    const sched = makeScheduler();
    const booted = await bootAccountLazy({ selected: select(s, 'accounts'), reselect: () => select(s, 'accounts'), loadClient: () => Promise.reject(new Error('chunk')), storage: s, now: sched.now, schedule: sched.schedule });
    expect(booted).toMatchObject({ unreachable: false, sync: null, flow: null });
    expect(isAccountStore(booted.selected.store)).toBe(true);
  });

  it('a device with its cache starts the loop without awaiting state first', async () => {
    const s = claimedNoCache();
    writeCache(s, cacheOf());
    const server = new FakeServer();
    const sched = makeScheduler();
    const first = select(s, 'accounts');
    expect(first.needsState).toBe(false);
    const booted = await bootAccount({ selected: first, reselect: () => select(s, 'accounts'), client: clientFor(server), storage: s, now: sched.now, schedule: sched.schedule });
    expect(booted.sync).not.toBeNull();
    booted.sync?.stop();
  });

  it('a guest, and ?fresh on a claimed device, touch the network never', async () => {
    const server = new FakeServer();
    const sched = makeScheduler();
    for (const [storage, query] of [[memStorage(), ''], [memStorage(), 'accounts'], [claimedNoCache(), 'accounts&fresh'], [claimedNoCache(), '']] as const) {
      const booted = await bootAccount({ selected: select(storage, query), reselect: () => select(storage, query), client: clientFor(server), storage, now: sched.now, schedule: sched.schedule });
      expect(booted).toMatchObject({ sync: null, flow: null, unreachable: false });
    }
    expect(server.calls).toEqual([]);
  });
});
