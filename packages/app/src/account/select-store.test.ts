// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CLAIMING_KEY, ensureDeviceId, writeBinding } from './binding';
import { writeCache } from './cache';
import { selectLedgerStore } from './select-store';
import { cacheOf, memStorage, world } from './fixtures';
import { removeGuestProgress } from '../ledger-store';
import { ACCOUNT_KEY } from '../brigade-account';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from '../main-keys';
import { SAVES_KEY } from '../profile';
import { ROAR_KEY } from '../roar-wallet';

const backfill = (w: Parameters<NonNullable<Parameters<typeof selectLedgerStore>[2]>>[0]) => w;
const q = (s: string) => new URLSearchParams(s);
const claimed = () => {
  const s = memStorage();
  writeBinding(s, { version: 1, publicId: 'pub1', claimedAt: 5 });
  writeCache(s, cacheOf());
  return s;
};

describe('selectLedgerStore', () => {
  it('guests_are_untouched (A2-14): no ?accounts is the guest store, whatever is bound or cached', () => {
    const s = claimed();
    const before = [...s.map.entries()];
    const sel = selectLedgerStore(q(''), s, backfill, { world });
    expect(sel).toMatchObject({ signedIn: false, needsState: false });
    expect('view' in sel.store).toBe(false);
    expect([...s.map.entries()]).toEqual(before);
  });

  it('?fresh with a claimed binding is the guest store and touches no key (G-S3)', () => {
    const s = claimed();
    s.setItem(ROAR_KEY, 'roar-bytes');
    s.setItem(ACCOUNT_KEY, 'acct-bytes');
    const before = [...s.map.entries()];
    const sel = selectLedgerStore(q('accounts&fresh'), s, backfill, { world });
    expect(sel.signedIn).toBe(false);
    expect('view' in sel.store).toBe(false);
    expect([...s.map.entries()]).toEqual(before);
  });

  it('an unclaimed binding is still a guest', () => {
    const s = memStorage();
    writeBinding(s, { version: 1, publicId: 'pub1' });
    expect(selectLedgerStore(q('accounts'), s, backfill, { world }).signedIn).toBe(false);
  });

  it('a claimed binding with its cache is the account store', () => {
    const sel = selectLedgerStore(q('accounts'), claimed(), backfill, { world });
    expect(sel).toMatchObject({ signedIn: true, needsState: false });
    expect('view' in sel.store).toBe(true);
  });

  it('a claimed binding with no cache (or another member\'s) waits for state and reads no guest key', () => {
    const s = memStorage();
    writeBinding(s, { version: 1, publicId: 'pub1', claimedAt: 5 });
    s.setItem(LEDGER_KEY, '{"campaign.completed_missions":["x"]}');
    const sel = selectLedgerStore(q('accounts'), s, backfill, { world });
    expect(sel).toMatchObject({ signedIn: true, needsState: true });
    expect(sel.store.available).toBe(false);
    expect(sel.store.readLedger()).toEqual({});
    writeCache(s, { ...cacheOf(), publicId: 'someone-else' });
    expect(selectLedgerStore(q('accounts'), s, backfill, { world }).needsState).toBe(true);
  });

  it('removeGuestProgress removes the five guest keys and nothing else', () => {
    const s = memStorage();
    for (const k of [LEDGER_KEY, ACCOUNT_KEY, TUTORIAL_DONE_KEY, SAVES_KEY, ROAR_KEY, 'lions.settings']) s.setItem(k, '1');
    removeGuestProgress(s);
    expect([...s.map.keys()]).toEqual(['lions.settings']);
  });
});

// A retry marker left by `runClaim` must not lock guest saves where no claim panel can appear (CodeRabbit, Major).
describe('selectLedgerStore, a retry marker on a device whose accounts are off', () => {
  const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
  afterEach(() => {
    if (own) Object.defineProperty(window, 'localStorage', own);
    else delete (window as { localStorage?: unknown }).localStorage;
  });
  const withMarker = () => {
    const s = memStorage();
    writeBinding(s, { version: 1, publicId: 'pub1' });
    const deviceId = ensureDeviceId(s);
    s.setItem(CLAIMING_KEY, JSON.stringify({ deviceId, digests: { campaign: null, slots: {} }, at: 1 }));
    Object.defineProperty(window, 'localStorage', { value: s, configurable: true });
    return s;
  };

  it.each(['', 'accounts&fresh'])('guest writes work with "%s" (no claim panel can clear the marker)', (qs) => {
    const s = withMarker();
    const sel = selectLedgerStore(q(qs), s, backfill, { world });
    expect(s.getItem(CLAIMING_KEY)).not.toBeNull(); // the marker survived boot: it matches the binding
    expect(() => sel.store.writeLedger({ x: 1 } as never)).not.toThrow();
  });

  it('with ?accounts the guest store still refuses while the marker exists', () => {
    const s = withMarker();
    const sel = selectLedgerStore(q('accounts'), s, backfill, { world });
    expect(() => sel.store.writeLedger({ x: 1 } as never)).toThrow();
  });
});
