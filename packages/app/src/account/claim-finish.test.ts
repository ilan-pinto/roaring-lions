import { describe, expect, it } from 'vitest';
import { emptyAccount } from '@lions/economy';
import type { ClaimResult, InventoryItem } from '@lions/economy';
import type { StorageLike } from '../brigade-account';
import { ACCOUNT_KEY } from '../brigade-account';
import { memoryLedgerStore } from '../ledger-store';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from '../main-keys';
import { ACCOUNT_BINDING_KEY, CLAIMING_KEY } from './binding';
import { ACCOUNT_CACHE_KEY, readCache } from './cache';
import type { AccountClient } from './client';
import { beginClaim, buildClaim, claimQuietly, finishClaim, finishInterruptedClaim } from './claim';
import { confirmedState, memStorage, unusedA2Client } from './fixtures';
import { sha256Hex } from './signed-in';

// GH-1385 F8, batch 4: the order of `finishClaim`'s writes and what `beginClaim` and `claimQuietly` leave behind. Every
// expected value is a literal; the digests are the only computed ones, taken from the text the claim sent.

const CTX = { publicId: 'pub1', at: 9 };
const DEV = 'dddddddd-0001-4ddd-8ddd-dddddddddddd';
const BINDING = JSON.stringify({ version: 1, publicId: 'pub1', deviceId: DEV });

const guestWithCampaign = () =>
  memoryLedgerStore({
    [LEDGER_KEY]: JSON.stringify({ 'campaign.completed_missions': ['m1'] }),
    [ACCOUNT_KEY]: JSON.stringify(emptyAccount()),
    [TUTORIAL_DONE_KEY]: '1',
  });

/** A device whose storage and guest store share one map, with an optional refusal on one key. */
function device(opts: { refuse?: string; binding?: boolean } = {}) {
  const guest = guestWithCampaign();
  const storage: StorageLike & { map: Map<string, string> } = {
    map: guest.map,
    getItem: (k) => guest.map.get(k) ?? null,
    setItem: (k, v) => {
      if (k === opts.refuse) throw new Error('refused ' + k);
      guest.map.set(k, v);
    },
    removeItem: (k) => void guest.map.delete(k),
  };
  if (opts.binding !== false) guest.map.set(ACCOUNT_BINDING_KEY, BINDING);
  return { guest, storage };
}

async function finishWith(d: ReturnType<typeof device>) {
  const built = buildClaim(d.guest, DEV, CTX);
  const campaign: InventoryItem = { deviceId: 'campaign', status: 'stored', serverId: 'c', digest: await sha256Hex(built.sent.campaign ?? '') };
  const result: ClaimResult = { coins: 0, earned: 0, coupons: [], carried: [], notCarried: [], campaign, slots: [], state: confirmedState() };
  const snapshot = { campaign: d.guest.snapshotCampaign(), slots: d.guest.readSlotsRaw() };
  return finishClaim({ result, sent: built.sent, damaged: built.damaged, storage: d.storage, snapshot, now: () => 77 });
}

describe('beginClaim: the marker says what is being sent, by digest', () => {
  it('a campaign and a slot are digested; no campaign is a null digest', async () => {
    const withCampaign = buildClaim(guestWithCampaign(), DEV, CTX);
    const s1 = memStorage();
    expect(await beginClaim(s1, withCampaign, () => 5)).toBe(true);
    const m1 = JSON.parse(s1.map.get(CLAIMING_KEY) ?? 'null') as { deviceId: string; at: number; digests: { campaign: string | null } };
    expect(m1.deviceId).toBe(DEV);
    expect(m1.at).toBe(5);
    expect(m1.digests.campaign).toBe(await sha256Hex(withCampaign.sent.campaign ?? ''));

    const bare = buildClaim(memoryLedgerStore(), DEV, CTX);
    const s2 = memStorage();
    expect(await beginClaim(s2, bare, () => 5)).toBe(true);
    expect((JSON.parse(s2.map.get(CLAIMING_KEY) ?? 'null') as { digests: { campaign: null } }).digests.campaign).toBeNull();
  });

  it('with no storage, or a storage that refuses the marker, the claim must not be sent', async () => {
    const built = buildClaim(guestWithCampaign(), DEV, CTX);
    expect(await beginClaim(null, built)).toBe(false);
    const refusing = memStorage();
    refusing.setItem = () => {
      throw new Error('refused');
    };
    expect(await beginClaim(refusing, built)).toBe(false);
  });
});

describe('finishClaim: what it writes, and what stops it', () => {
  it('moves: the cache is written from the server state, the guest keys go, the marker goes', async () => {
    const d = device();
    d.storage.setItem(CLAIMING_KEY, '{}');
    expect(await finishWith(d)).toBe('moved');
    expect(readCache(d.storage)).toEqual({ version: 1, publicId: 'pub1', confirmed: confirmedState(), bodies: {} });
    expect(d.storage.getItem(LEDGER_KEY)).toBeNull();
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
  });

  it('with no binding it keeps everything, writes no cache and clears the marker', async () => {
    const d = device({ binding: false });
    d.storage.setItem(CLAIMING_KEY, '{}');
    expect(await finishWith(d)).toBe('kept');
    expect(d.storage.getItem(LEDGER_KEY)).not.toBeNull();
    expect(d.storage.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
  });

  it('a refused cache write keeps the guest keys and clears the marker', async () => {
    const d = device({ refuse: ACCOUNT_CACHE_KEY });
    d.storage.setItem(CLAIMING_KEY, '{}');
    expect(await finishWith(d)).toBe('kept');
    expect(d.storage.getItem(LEDGER_KEY)).not.toBeNull();
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
  });
});

describe('the boot rules and the quiet claim, each with the input only it refuses', () => {
  it('an interrupted claim with no storage is false', () => {
    expect(finishInterruptedClaim(null)).toBe(false);
  });

  const client = (ok: boolean): AccountClient =>
    ({ ...unusedA2Client, state: async () => (ok ? { ok: true, status: 200, body: confirmedState() } : { ok: false, status: 500, body: { error: 'x' } }) }) as unknown as AccountClient;

  it('a quiet claim caches the server state when it answers, and writes no cache when it does not', async () => {
    const good = memStorage();
    good.map.set(ACCOUNT_BINDING_KEY, BINDING);
    expect(await claimQuietly(client(true), good, () => 4)).toBe(true);
    expect(readCache(good)).toEqual({ version: 1, publicId: 'pub1', confirmed: confirmedState(), bodies: {} });

    const bad = memStorage();
    bad.map.set(ACCOUNT_BINDING_KEY, BINDING);
    expect(await claimQuietly(client(false), bad, () => 4)).toBe(true);
    expect(bad.map.has(ACCOUNT_CACHE_KEY)).toBe(false);
  });
});
