import { describe, expect, it } from 'vitest';
import { canonicalCampaign, canonicalSlot, emptyAccount } from '@lions/economy';
import type { ClaimBody, ClaimResult, InventoryItem, SaveSlot } from '@lions/economy';
import { ACCOUNT_KEY, type StorageLike } from '../brigade-account';
import { memoryLedgerStore, removeGuestProgress, writeVictory, type MemoryLedgerStore } from '../ledger-store';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from '../main-keys';
import { SAVES_KEY } from '../profile';
import { ROAR_KEY } from '../roar-wallet';
import { ACCOUNT_BINDING_KEY, CLAIMING_KEY, clearBinding, clearDeviceId, readBinding, writeBinding } from './binding';
import { ACCOUNT_CACHE_KEY, readCache, writeCache } from './cache';
import type { AccountClient, CallResult } from './client';
import {
  CLAIM_BODY_MAX,
  CLAIM_SLOTS_MAX,
  beginClaim,
  buildClaim,
  claimQuietly,
  dropOrphanClaiming,
  finishClaim,
  finishInterruptedClaim,
  runClaim,
} from './claim';
import { cacheOf, confirmedState, memStorage, slotOf, unusedA2Client } from './fixtures';
import { HELD_KEY, readHeld } from './local-held';
import { sha256Hex } from './signed-in';

const GUEST_KEYS = [LEDGER_KEY, ACCOUNT_KEY, TUTORIAL_DONE_KEY, SAVES_KEY, ROAR_KEY];
const CTX = { publicId: 'pub1', at: 9 };

/** A device: one map behind both the guest `LedgerStore` and the raw storage the claim code writes through, with a write log. */
function device(opts: { slots?: Record<string, SaveSlot | string>; refuse?: (key: string) => boolean; campaign?: boolean } = {}) {
  const guest: MemoryLedgerStore = memoryLedgerStore();
  const log: string[] = [];
  const storage: StorageLike & { map: Map<string, string> } = {
    map: guest.map,
    getItem: (k) => guest.map.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.refuse?.(k)) throw new Error('refused ' + k);
      log.push('set:' + k);
      guest.map.set(k, v);
    },
    removeItem: (k) => {
      log.push('rm:' + k);
      guest.map.delete(k);
    },
  };
  if (opts.campaign !== false) {
    guest.map.set(LEDGER_KEY, JSON.stringify({ 'campaign.completed_missions': ['m1'] }));
    guest.map.set(ACCOUNT_KEY, JSON.stringify(emptyAccount()));
    guest.map.set(TUTORIAL_DONE_KEY, '1');
  }
  guest.map.set(ROAR_KEY, JSON.stringify({ note: 'wallet' }));
  if (opts.slots !== undefined) guest.map.set(SAVES_KEY, JSON.stringify(opts.slots));
  guest.map.set(ACCOUNT_BINDING_KEY, JSON.stringify({ version: 1, publicId: 'pub1' })); // bypasses `refuse`: the binding exists
  log.length = 0;
  return { guest, storage, log };
}

const slots = (n: number, build = 'b'): Record<string, SaveSlot> => {
  const out: Record<string, SaveSlot> = {};
  for (let i = 1; i <= n; i++) out[`s${i}`] = { ...slotOf(`s${i}`, `Slot ${i}`, i), build };
  return out;
};

type Tweak = { wrongDigest?: string; omit?: string; reject?: Record<string, 'cap' | 'size' | 'invalid'> };

/** The server's answer to a claim: what the Worker would store and echo (digests over the canonical strings). */
async function answer(body: ClaimBody, tweak: Tweak = {}): Promise<ClaimResult> {
  const campaign: InventoryItem | null =
    body.campaign === null ? null : { deviceId: 'campaign', status: 'stored', serverId: 'c', digest: await sha256Hex(canonicalCampaign(body.campaign)) };
  const items: InventoryItem[] = [];
  for (const s of body.slots) {
    if (s.id === tweak.omit) continue;
    const reason = tweak.reject?.[s.id];
    if (reason !== undefined) items.push({ deviceId: s.id, status: 'rejected', reason });
    else items.push({ deviceId: s.id, status: 'stored', serverId: 'srv-' + s.id, digest: s.id === tweak.wrongDigest ? 'wrong' : await sha256Hex(canonicalSlot(s.slot)) });
  }
  return { coins: 0, earned: 0, coupons: [], carried: [], notCarried: [], campaign, slots: items, state: confirmedState() };
}

/** A fake server: a claim is applied once per device_id and its result stored; a repeat answers the stored result. */
function server(tweak: () => Tweak = () => ({})) {
  const stored = new Map<string, ClaimResult>();
  const s = { deviceIds: [] as string[], claims: 0, bodies: [] as ClaimBody[], loseNext: false, tweak };
  const client = {
    ...unusedA2Client,
    claim: async (body: ClaimBody): Promise<CallResult<ClaimResult>> => {
      s.claims++;
      s.bodies.push(body);
      if (!stored.has(body.device_id)) {
        s.deviceIds.push(body.device_id);
        stored.set(body.device_id, await answer(body, tweak()));
      }
      if (s.loseNext) {
        s.loseNext = false;
        return { ok: false, status: 0, body: { error: 'network' } };
      }
      return { ok: true, status: 200, body: stored.get(body.device_id) as ClaimResult };
    },
    state: async () => ({ ok: true, status: 200, body: confirmedState() }) as CallResult<ReturnType<typeof confirmedState>>,
  } as unknown as AccountClient;
  return Object.assign(s, { client });
}

const keysPresent = (st: StorageLike): string[] => GUEST_KEYS.filter((k) => st.getItem(k) !== null);

async function finish(d: ReturnType<typeof device>, tweak: Tweak) {
  const built = buildClaim(d.guest, 'dev-1', CTX);
  const result = await answer(built.body, tweak);
  const snapshot = { campaign: d.guest.snapshotCampaign(), slots: d.guest.readSlotsRaw() };
  const out = await finishClaim({ result, sent: built.sent, damaged: built.damaged, storage: d.storage, snapshot, now: () => 77 });
  return { out, built };
}

describe('the claim on the device', () => {
  it('A2-12 keys_go_only_after_digests_match: a wrong digest, or an omitted slot, removes nothing', async () => {
    for (const tweak of [{ wrongDigest: 's2' }, { omit: 's3' }] as Tweak[]) {
      const d = device({ slots: slots(3) });
      const { out } = await finish(d, tweak);
      expect(out, JSON.stringify(tweak)).toBe('retry');
      expect(keysPresent(d.storage), JSON.stringify(tweak)).toEqual(GUEST_KEYS);
      expect(d.storage.getItem(HELD_KEY)).toBeNull();
      expect(d.storage.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
      expect(readBinding(d.storage)?.claimedAt).toBeUndefined();
    }
  });

  it('A2-19 rejected_slots_are_kept_first: byte-identical in lions.account.local before lions.saves goes', async () => {
    const all = slots(14);
    const d = device({ slots: all });
    const { out } = await finish(d, { reject: { s4: 'cap', s9: 'cap' } });
    expect(out).toBe('moved');
    const held = readHeld(d.storage);
    expect(held.map((h) => h.id).sort()).toEqual(['claim:slot:s4', 'claim:slot:s9']);
    expect(held.map((h) => h.reason)).toEqual(['cap', 'cap']);
    for (const h of held) expect(h.text).toBe(JSON.stringify(all[h.id.replace('claim:slot:', '')]));
    const heldAt = d.log.lastIndexOf('set:' + HELD_KEY);
    const savesAt = d.log.indexOf('rm:' + SAVES_KEY);
    expect(heldAt).toBeGreaterThanOrEqual(0);
    expect(savesAt).toBeGreaterThan(heldAt);
    expect(keysPresent(d.storage)).toEqual([]);
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
  });

  it('A2-19 with addHeld refused: every guest key stays', async () => {
    const d = device({ slots: slots(14), refuse: (k) => k === HELD_KEY });
    const { out } = await finish(d, { reject: { s4: 'cap' } });
    expect(out).toBe('kept');
    expect(keysPresent(d.storage)).toEqual(GUEST_KEYS);
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
  });

  it('damaged_entries_are_kept_invalid: byte-identical in local, and never sent', async () => {
    const entry = { weird: [1, 2, 3] };
    const d = device({ slots: { ok1: slotOf('ok1', 'Fine', 5), bad: entry as unknown as SaveSlot } });
    const { out, built } = await finish(d, {});
    expect(built.body.slots.map((s) => s.id)).toEqual(['ok1']);
    expect(out).toBe('moved');
    const held = readHeld(d.storage);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ id: 'claim:slot:bad', reason: 'invalid', kind: 'slot', publicId: 'pub1' });
    expect(held[0].text).toBe(JSON.stringify(entry));
  });

  it('a damaged whole blob is kept verbatim as invalid', () => {
    const d = device();
    d.guest.map.set(SAVES_KEY, '{not json');
    const built = buildClaim(d.guest, 'dev-1', CTX);
    expect(built.body.slots).toEqual([]);
    expect(built.damaged).toHaveLength(1);
    expect(built.damaged[0]).toMatchObject({ reason: 'invalid', text: '{not json' });
  });

  it('A2-30 signout_mints_a_new_device_id: claim, sign out, play as a guest, sign in: a different device_id', async () => {
    const d = device({ slots: slots(1) });
    const srv = server();
    expect(await runClaim({ client: srv.client, guest: d.guest, storage: d.storage })).toBe('moved');
    expect(readBinding(d.storage)?.claimedAt).toBeDefined();
    clearDeviceId(d.storage); // what `signOut` does last (sync.ts); the cache goes with it
    d.storage.removeItem(ACCOUNT_CACHE_KEY);
    expect(readBinding(d.storage)?.claimedAt).toBeUndefined();
    d.guest.writeSlotsRaw(JSON.stringify(slots(2))); // play as a guest
    d.guest.writeLedger({ 'campaign.completed_missions': ['m1', 'm2'] });
    expect(await runClaim({ client: srv.client, guest: d.guest, storage: d.storage })).toBe('moved');
    expect(srv.deviceIds).toHaveLength(2);
    expect(srv.deviceIds[1]).not.toBe(srv.deviceIds[0]);
    expect(srv.bodies[1].slots.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('an_empty_device_claims_quietly (§0.41): no claim request, claimedAt set, twenty times', async () => {
    const srv = server();
    const st = memStorage();
    for (let i = 0; i < 20; i++) {
      writeBinding(st, { version: 1, publicId: 'pub1' });
      expect(await claimQuietly(srv.client, st, () => 5)).toBe(true);
      expect(readBinding(st)?.claimedAt).toBe(5);
      expect(readCache(st)?.publicId).toBe('pub1');
    }
    expect(srv.claims).toBe(0);
  });

  it('a_lost_answer_then_more_play: the guest store refuses writes during the claim; the retry finishes; a hand-cleared marker then new play is stale', async () => {
    const d = device({ slots: slots(2) });
    const srv = server();
    srv.loseNext = true;
    expect(await runClaim({ client: srv.client, guest: d.guest, storage: d.storage })).toBe('retry');
    expect(d.storage.getItem(CLAIMING_KEY)).not.toBeNull();
    expect(() => d.guest.writeLedger({ 'campaign.completed_missions': ['m9'] })).toThrow();
    expect(() => d.guest.writeSlotsRaw('{}')).toThrow();
    expect(await runClaim({ client: srv.client, guest: d.guest, storage: d.storage })).toBe('moved');
    expect(srv.deviceIds).toHaveLength(1); // the retry reused the device id
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();

    // Second run: one slot, answer lost, marker cleared by hand, the slot saved again, the retry's stored result is stale.
    const e = device({ slots: slots(1), campaign: false });
    const srv2 = server();
    srv2.loseNext = true;
    expect(await runClaim({ client: srv2.client, guest: e.guest, storage: e.storage })).toBe('retry');
    e.storage.removeItem(CLAIMING_KEY);
    e.guest.writeSlotsRaw(JSON.stringify({ s1: { ...slotOf('s1', 'Slot 1', 50), build: 'changed' } }));
    expect(await runClaim({ client: srv2.client, guest: e.guest, storage: e.storage })).toBe('moved');
    expect(srv2.deviceIds).toHaveLength(2);
    expect(srv2.deviceIds[1]).not.toBe(srv2.deviceIds[0]);
    expect(srv2.bodies[2].slots[0].slot.build).toBe('changed');
  });

  it('a stale answer is reported as stale by finishClaim and removes nothing', async () => {
    const d = device({ slots: slots(1), campaign: false });
    const old = buildClaim(d.guest, 'dev-1', CTX);
    d.guest.writeSlotsRaw(JSON.stringify({ s1: { ...slotOf('s1', 'Slot 1', 50), build: 'changed' } }));
    const built = buildClaim(d.guest, 'dev-1', CTX);
    const result = await answer(old.body);
    const out = await finishClaim({ result, sent: built.sent, damaged: [], storage: d.storage, snapshot: { campaign: d.guest.snapshotCampaign(), slots: d.guest.readSlotsRaw() } });
    expect(out).toBe('stale');
    expect(keysPresent(d.storage)).toEqual([SAVES_KEY, ROAR_KEY]);
  });

  it('a_refused_binding_write_removes_nothing (§0.40)', async () => {
    const d = device({ slots: slots(2), refuse: (k) => k === ACCOUNT_BINDING_KEY });
    expect(readBinding(d.storage)?.publicId, 'the binding exists, so only the write is refused').toBe('pub1');
    const { out } = await finish(d, {});
    expect(out).toBe('kept');
    expect(keysPresent(d.storage)).toEqual(GUEST_KEYS);
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
  });

  it('the_body_fits: 40 slots of 60 KiB stay under CLAIM_BODY_MAX and 32 slots; the rest are held as size, byte-identical', () => {
    const big = 'x'.repeat(60 * 1024);
    const all = slots(40, big);
    const d = device({ slots: all });
    const built = buildClaim(d.guest, 'dev-1', CTX);
    expect(built.body.slots.length).toBeLessThanOrEqual(CLAIM_SLOTS_MAX);
    expect(new TextEncoder().encode(JSON.stringify(built.body)).length).toBeLessThan(CLAIM_BODY_MAX);
    expect(built.body.slots.length + built.damaged.length).toBe(40);
    expect(built.damaged.length).toBeGreaterThan(0);
    const sentIds = new Set(built.body.slots.map((s) => s.id));
    for (const h of built.damaged) {
      expect(h.reason).toBe('size');
      const id = h.id.replace('claim:slot:', '');
      expect(sentIds.has(id)).toBe(false);
      expect(h.text).toBe(JSON.stringify(all[id]));
    }
    // The oldest are the ones moved out.
    const heldSavedAt = built.damaged.map((h) => all[h.id.replace('claim:slot:', '')].savedAt);
    const sentSavedAt = built.body.slots.map((s) => s.slot.savedAt);
    expect(Math.max(...heldSavedAt)).toBeLessThan(Math.min(...sentSavedAt));
  });

  it('32 small slots all go; the 33rd is held as size', () => {
    const d = device({ slots: slots(33) });
    const built = buildClaim(d.guest, 'dev-1', CTX);
    expect(built.body.slots).toHaveLength(32);
    expect(built.damaged.map((h) => h.id)).toEqual(['claim:slot:s1']);
  });

  it('beginClaim refuses when the marker cannot be written: the claim is not sent', async () => {
    const d = device({ slots: slots(1), refuse: (k) => k === CLAIMING_KEY });
    const srv = server();
    expect(await runClaim({ client: srv.client, guest: d.guest, storage: d.storage })).toBe('blocked');
    expect(srv.claims).toBe(0);
    const built = buildClaim(d.guest, 'dev-1', CTX);
    expect(await beginClaim(d.storage, built)).toBe(false);
  });

  it('a tab that died before the last two writes: a claimed binding with a cache removes the leftover guest keys at boot', () => {
    const d = device({ slots: slots(1) });
    expect(finishInterruptedClaim(d.storage)).toBe(false); // not claimed yet: nothing is touched
    expect(keysPresent(d.storage)).toEqual(GUEST_KEYS);
    writeBinding(d.storage, { version: 1, publicId: 'pub1', claimedAt: 5 });
    expect(finishInterruptedClaim(d.storage)).toBe(false); // no cache: nothing is touched
    expect(keysPresent(d.storage)).toEqual(GUEST_KEYS);
    const DEV = '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc';
    writeBinding(d.storage, { version: 1, publicId: 'pub1', claimedAt: 5, deviceId: DEV });
    writeCache(d.storage, cacheOf());
    d.storage.setItem(CLAIMING_KEY, `{"deviceId":"${DEV}","digests":{"campaign":null,"slots":{}},"at":1}`);
    expect(finishInterruptedClaim(d.storage)).toBe(true);
    expect(keysPresent(d.storage)).toEqual([]);
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
  });

  it('I2: with no claiming marker (or one for another device) a claimed binding + cache + guest keys leaves the guest keys alone', () => {
    const DEV = '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc';
    const d = device({ slots: slots(1) });
    writeBinding(d.storage, { version: 1, publicId: 'pub1', claimedAt: 5, deviceId: DEV });
    writeCache(d.storage, cacheOf());
    expect(finishInterruptedClaim(d.storage)).toBe(false); // no marker: guest play outside ?accounts, or under ?fresh
    expect(keysPresent(d.storage)).toEqual(GUEST_KEYS);
    d.storage.setItem(CLAIMING_KEY, '{"deviceId":"11111111-1c2a-4f7b-9d8e-123456789abc","digests":{"campaign":null,"slots":{}},"at":1}');
    expect(finishInterruptedClaim(d.storage)).toBe(false); // a marker for another device id is not this device's claim
    expect(keysPresent(d.storage)).toEqual(GUEST_KEYS);
  });
});

describe('the guest store while a claim is moving (§0.40)', () => {
  it('refuses every write with the marker present, answers "refused" to a victory, and is byte-identical without it', () => {
    const s = memoryLedgerStore({ [LEDGER_KEY]: '{"campaign.completed_missions":["a"]}' });
    s.writeLedger({ 'campaign.completed_missions': ['a', 'b'] });
    expect(s.raw(LEDGER_KEY)).toBe('{"campaign.completed_missions":["a","b"]}');
    s.map.set(CLAIMING_KEY, '{}');
    expect(() => s.writeLedger({})).toThrow();
    expect(() => s.writeAccount(emptyAccount())).toThrow();
    expect(() => s.setTutorialDone(true)).toThrow();
    expect(() => s.clearLedger()).toThrow();
    expect(writeVictory(s, { 'campaign.completed_missions': ['z'] }, null)).toBe('refused');
    expect(s.raw(LEDGER_KEY)).toBe('{"campaign.completed_missions":["a","b"]}');
    expect(s.readLedger()['campaign.completed_missions']).toEqual(['a', 'b']); // reads are untouched
    s.map.delete(CLAIMING_KEY);
    expect(writeVictory(s, { 'campaign.completed_missions': ['z'] }, null)).toBe('saved');
  });

  it('removeGuestProgress on the raw storage is not gated (the claim itself removes the keys)', () => {
    const d = device({ slots: slots(1) });
    d.storage.setItem(CLAIMING_KEY, '{}');
    removeGuestProgress(d.storage);
    expect(keysPresent(d.storage)).toEqual([]);
  });
});

describe('fix round 1 (review of 2.11)', () => {
  const MARKER = '{"deviceId":"0b5f6d3e-1c2a-4f7b-9d8e-123456789abc","digests":{"campaign":null,"slots":{}},"at":1}';

  it('sign-out and deletion take the pending marker with them: the guest store writes again', () => {
    for (const clear of [clearDeviceId, clearBinding]) {
      const d = device({ slots: slots(1) });
      writeBinding(d.storage, { version: 1, publicId: 'pub1', deviceId: '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc' });
      d.storage.setItem(CLAIMING_KEY, MARKER);
      expect(() => d.guest.writeLedger({})).toThrow();
      clear(d.storage);
      expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
      expect(() => d.guest.writeLedger({ 'campaign.completed_missions': ['m2'] })).not.toThrow();
    }
  });

  it('at boot a marker with no binding, or a binding with another device id, is dropped; a matching one stays', () => {
    const d = device({ slots: slots(1) });
    d.storage.removeItem(ACCOUNT_BINDING_KEY);
    d.storage.setItem(CLAIMING_KEY, MARKER);
    expect(dropOrphanClaiming(d.storage)).toBe(true);
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
    writeBinding(d.storage, { version: 1, publicId: 'pub1', deviceId: '11111111-1c2a-4f7b-9d8e-123456789abc' });
    d.storage.setItem(CLAIMING_KEY, MARKER);
    expect(dropOrphanClaiming(d.storage)).toBe(true);
    writeBinding(d.storage, { version: 1, publicId: 'pub1', deviceId: '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc' });
    d.storage.setItem(CLAIMING_KEY, MARKER);
    expect(dropOrphanClaiming(d.storage)).toBe(false);
    expect(d.storage.getItem(CLAIMING_KEY)).toBe(MARKER);
  });

  it('a third-time stale answer: runClaim re-mints once, answers failed, and leaves no marker', async () => {
    const d = device({ slots: slots(1), campaign: false });
    const old = buildClaim(d.guest, 'dev-old', CTX);
    d.guest.writeSlotsRaw(JSON.stringify({ s1: { ...slotOf('s1', 'Slot 1', 50), build: 'changed' } }));
    const stale = await answer(old.body); // matches nothing the device now holds
    let claims = 0;
    const client = { ...unusedA2Client, claim: async () => ((claims++, { ok: true, status: 200, body: stale })) } as unknown as AccountClient;
    expect(await runClaim({ client, guest: d.guest, storage: d.storage })).toBe('failed');
    expect(claims).toBe(2); // the first send and one re-mint, no more
    expect(d.storage.getItem(CLAIMING_KEY)).toBeNull();
    expect(() => d.guest.writeSlotsRaw('{}')).not.toThrow();
  });

  it('a rejected campaign is held verbatim from the snapshot, kept before any guest key goes (cap and size)', async () => {
    for (const reason of ['cap', 'size'] as const) {
      const d = device({ slots: slots(1) });
      const built = buildClaim(d.guest, 'dev-1', CTX);
      const result = { ...(await answer(built.body)), campaign: { deviceId: 'campaign', status: 'rejected', reason } as InventoryItem };
      const snapshot = { campaign: d.guest.snapshotCampaign(), slots: d.guest.readSlotsRaw() };
      d.log.length = 0;
      const out = await finishClaim({ result, sent: built.sent, damaged: built.damaged, storage: d.storage, snapshot, now: () => 77 });
      expect(out).toBe('moved');
      const held = readHeld(d.storage);
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({ id: 'claim:campaign', kind: 'campaign', reason });
      expect(held[0].text).toBe(
        JSON.stringify({ ledger: JSON.parse(snapshot.campaign.ledger as string), brigade: JSON.parse(snapshot.campaign.account as string), tutorialDone: true }),
      );
      expect(d.log.indexOf('set:' + HELD_KEY)).toBeGreaterThanOrEqual(0);
      expect(d.log.indexOf('set:' + HELD_KEY)).toBeLessThan(d.log.indexOf('rm:' + LEDGER_KEY));
    }
  });

  it('a guest slot whose id is literally "campaign" is not mistaken for the campaign', async () => {
    const all = { campaign: { ...slotOf('campaign', 'Odd', 3), build: 'b' } };
    const d = device({ slots: all });
    const built = buildClaim(d.guest, 'dev-1', CTX);
    const result = await answer(built.body, { reject: { campaign: 'cap' } });
    const snapshot = { campaign: d.guest.snapshotCampaign(), slots: d.guest.readSlotsRaw() };
    expect(await finishClaim({ result, sent: built.sent, damaged: built.damaged, storage: d.storage, snapshot })).toBe('moved');
    const held = readHeld(d.storage);
    expect(held.map((h) => [h.id, h.kind, h.reason])).toEqual([['claim:slot:campaign', 'slot', 'cap']]);
    expect(held[0].text).toBe(JSON.stringify(all.campaign));
  });

  it('CLAIM_BODY_MAX equals the Worker\'s (packages/worker/src/account/config.ts), which app code cannot import', () => {
    expect(CLAIM_BODY_MAX).toBe(1048576);
  });
});
