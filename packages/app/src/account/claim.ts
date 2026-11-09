/**
 * The claim on the device (GH-1075 A2, §0.13, §0.15, §0.16, §0.40 to §0.43): what a guest device sends to the server
 * the first time it signs in, and how it lets go of its own keys afterwards, so that nothing is ever lost: every
 * item the server did not take is kept verbatim in `lions.account.local` BEFORE a single guest key is removed.
 * Digests are Web Crypto SHA-256 over the UTF-8 of the canonical strings (`sha256Hex` in `signed-in.ts`).
 */
import { canonicalCampaign, canonicalSlot, emptyRoar, parseSlot } from '@lions/economy';
import type { ClaimBody, ClaimResult, InventoryItem, SaveSlot } from '@lions/economy';
import { ACCOUNT_KEY, type StorageLike } from '../brigade-account';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from '../main-keys';
import { removeGuestProgress, type CampaignSnapshot, type LedgerStore } from '../ledger-store';
import { DAMAGED_BLOB_ID, SAVES_KEY } from '../profile';
import { ROAR_KEY } from '../roar-wallet';
import { CLAIMING_KEY, clearDeviceId, ensureDeviceId, readBinding, setClaimedAt } from './binding';
import { readCache, writeCache } from './cache';
import type { AccountClient } from './client';
import { addHeld, type HeldItem } from './local-held';
import { sha256Hex } from './signed-in';

/** The Worker's `CLAIM_BODY_MAX` (`packages/worker/src/account/config.ts`): a claim body is kept under it. */
export const CLAIM_BODY_MAX = 1_048_576;
/** The Worker's cap on slots and on coupon ids in one claim. */
export const CLAIM_SLOTS_MAX = 32;
export const CLAIM_COUPONS_MAX = 16;

export interface Sent {
  campaign: string | null;
  slots: Record<string, string>;
}

export interface BuiltClaim {
  body: ClaimBody;
  /** The canonical text of each sent item, for the digest check. */
  sent: Sent;
  /** Items that were not sent and must be kept: damaged slot entries (`invalid`) and slots moved out for size (`size`). */
  damaged: HeldItem[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

/** True when the device holds anything a claim would move: a campaign key or the save slots. */
export function hasGuestProgress(store: LedgerStore): boolean {
  const s = store.snapshotCampaign();
  return s.ledger !== null || s.account !== null || s.tutorial !== null || store.readSlotsRaw() !== null;
}

/**
 * The claim body from the device's guest progress. `ctx` stamps the held items it may produce (the signed-in member
 * and the time). Valid slots go in the body newest first until 32 or `CLAIM_BODY_MAX`; the rest, and every damaged
 * entry, come back as held items.
 */
export function buildClaim(store: LedgerStore, deviceId: string, ctx: { publicId: string; at: number }): BuiltClaim {
  const snap = store.snapshotCampaign();
  const hasCampaign = snap.ledger !== null || snap.account !== null || snap.tutorial !== null;
  const campaign = hasCampaign ? { ledger: store.readLedger(), brigade: store.readAccount(), tutorialDone: store.tutorialDone() } : null;
  const roarText = store.snapshotRoar();
  let wallet: unknown = emptyRoar();
  try {
    if (roarText !== null) wallet = JSON.parse(roarText);
  } catch {
    /* an unreadable wallet is sent as empty; the server migrates what it gets */
  }
  const coupons = new Set<string>(campaign?.brigade.coupons ?? []);
  const receipts = isRecord(wallet) && Array.isArray(wallet.receipts) ? wallet.receipts : [];
  for (const r of receipts) {
    if (isRecord(r) && r.kind === 'coupon' && Array.isArray(r.couponIds)) for (const c of r.couponIds) if (typeof c === 'string') coupons.add(c);
  }
  const body: ClaimBody = {
    op_id: crypto.randomUUID(),
    device_id: deviceId,
    campaign,
    slots: [],
    wallet,
    coupons: [...coupons].slice(0, CLAIM_COUPONS_MAX),
  };
  const sent: Sent = { campaign: campaign === null ? null : canonicalCampaign(campaign), slots: {} };
  const damaged: HeldItem[] = [];
  const hold = (id: string, reason: HeldItem['reason'], text: string): void => {
    damaged.push({ id: `claim:slot:${id}`, kind: 'slot', reason, text, at: ctx.at, publicId: ctx.publicId });
  };

  const valid: { id: string; slot: SaveSlot; text: string }[] = [];
  const raw = store.readSlotsRaw();
  if (raw !== null) {
    let blob: unknown;
    try {
      blob = JSON.parse(raw);
    } catch {
      blob = undefined;
    }
    if (!isRecord(blob)) hold(DAMAGED_BLOB_ID, 'invalid', raw);
    else {
      for (const [id, entry] of Object.entries(blob)) {
        const text = JSON.stringify(entry) ?? '';
        try {
          valid.push({ id, slot: parseSlot(text), text });
        } catch {
          hold(id, 'invalid', typeof entry === 'string' ? entry : text);
        }
      }
    }
  }
  valid.sort((a, b) => b.slot.savedAt - a.slot.savedAt);
  let size = bytesOf(JSON.stringify(body));
  for (const v of valid) {
    const cost = bytesOf(JSON.stringify({ id: v.id, slot: v.slot })) + 1;
    if (body.slots.length >= CLAIM_SLOTS_MAX || size + cost > CLAIM_BODY_MAX) {
      hold(v.id, 'size', v.text);
      continue;
    }
    body.slots.push({ id: v.id, slot: v.slot });
    sent.slots[v.id] = canonicalSlot(v.slot);
    size += cost;
  }
  return { body, sent, damaged };
}

/** The marker's content: what is being sent, by digest. */
export interface ClaimingMarker {
  deviceId: string;
  digests: { campaign: string | null; slots: Record<string, string> };
  at: number;
}

export function readClaiming(storage: StorageLike | null): ClaimingMarker | null {
  try {
    const text = storage?.getItem(CLAIMING_KEY);
    if (typeof text !== 'string') return null;
    const j: unknown = JSON.parse(text);
    return isRecord(j) && typeof j.deviceId === 'string' ? (j as unknown as ClaimingMarker) : null;
  } catch {
    return null;
  }
}

export function clearClaiming(storage: StorageLike | null): void {
  try {
    storage?.removeItem(CLAIMING_KEY);
  } catch {
    /* a marker that cannot be removed is retried by the next resolve */
  }
}

/**
 * Write `lions.account.claiming` before the send; the guest store refuses writes from this moment (§0.40).
 * False when the write is refused: the claim must not be sent. (Async: the digests are Web Crypto.)
 */
export async function beginClaim(storage: StorageLike | null, built: BuiltClaim, now: () => number = Date.now): Promise<boolean> {
  const slots: Record<string, string> = {};
  for (const [id, text] of Object.entries(built.sent.slots)) slots[id] = await sha256Hex(text);
  const marker: ClaimingMarker = {
    deviceId: built.body.device_id,
    digests: { campaign: built.sent.campaign === null ? null : await sha256Hex(built.sent.campaign), slots },
    at: now(),
  };
  try {
    if (!storage) return false;
    storage.setItem(CLAIMING_KEY, JSON.stringify(marker));
    return storage.getItem(CLAIMING_KEY) !== null;
  } catch {
    return false;
  }
}

export interface FinishOptions {
  result: ClaimResult;
  sent: Sent;
  damaged: HeldItem[];
  storage: StorageLike;
  /** The guest bytes AS THEY STOOD when the claim was built; rejected items are kept from these, verbatim. */
  snapshot: { campaign: CampaignSnapshot; slots: string | null };
  now?: () => number;
}

export type FinishResult = 'moved' | 'kept' | 'retry' | 'stale';

const parseOr = (text: string | null): unknown => {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The campaign half of a snapshot as one JSON text, from the stored bytes (not re-canonicalised). */
function campaignText(snap: CampaignSnapshot): string {
  return JSON.stringify({ ledger: parseOr(snap.ledger) ?? {}, brigade: parseOr(snap.account) ?? null, tutorialDone: snap.tutorial !== null });
}

/**
 * Finish a claim whose answer arrived. Order is the whole point (§0.40): check, KEEP what the server did not take,
 * the cache, the binding's `claimedAt`, then the guest keys, then the marker. Any refused write before the keys are
 * removed answers `kept` and removes nothing.
 *
 * The check: every sent item must be in the inventory, and every `stored` digest must equal the digest of what was
 * sent, else `retry`. When NOTHING sent is accounted for (no stored match, no rejection) the result is from an older
 * claim and the answer is `stale`.
 */
export async function finishClaim(o: FinishOptions): Promise<FinishResult> {
  const { result, sent, storage } = o;
  const byId = new Map<string, InventoryItem>();
  for (const it of result.slots) byId.set(it.deviceId, it);
  const wanted: { item: InventoryItem | null; text: string }[] = [];
  if (sent.campaign !== null) wanted.push({ item: result.campaign, text: sent.campaign });
  for (const [id, text] of Object.entries(sent.slots)) wanted.push({ item: byId.get(id) ?? null, text });

  let accounted = 0;
  let broken = 0;
  const rejected: { kind: 'campaign' | 'slot'; id: string; reason: 'cap' | 'size' | 'invalid' }[] = [];
  for (const w of wanted) {
    const it = w.item;
    if (it === null) broken++;
    else if (it.status === 'rejected') {
      accounted++;
      rejected.push({ kind: it.deviceId === 'campaign' ? 'campaign' : 'slot', id: it.deviceId, reason: it.reason });
    } else if (it.digest === (await sha256Hex(w.text))) accounted++;
    else broken++;
  }
  if (broken > 0) return accounted === 0 ? 'stale' : 'retry';

  // Keep first: every rejected item and every damaged one, verbatim from the snapshot.
  const publicId = readBinding(storage)?.publicId ?? '';
  const at = (o.now ?? Date.now)();
  let blob: Record<string, unknown> | null;
  try {
    const j = o.snapshot.slots === null ? null : (JSON.parse(o.snapshot.slots) as unknown);
    blob = isRecord(j) ? j : null;
  } catch {
    blob = null;
  }
  const keep: HeldItem[] = [...o.damaged];
  for (const r of rejected) {
    if (r.kind === 'campaign') {
      keep.push({ id: 'claim:campaign', kind: 'campaign', reason: r.reason, text: campaignText(o.snapshot.campaign), at, publicId });
    } else {
      const entry = blob === null ? undefined : blob[r.id];
      keep.push({ id: `claim:slot:${r.id}`, kind: 'slot', reason: r.reason, text: typeof entry === 'string' ? entry : (JSON.stringify(entry) ?? ''), at, publicId });
    }
  }
  const stop = (): FinishResult => {
    clearClaiming(storage);
    return 'kept';
  };
  for (const h of keep) if (!addHeld(storage, h)) return stop();

  const binding = readBinding(storage);
  if (binding === null) return stop();
  if (!writeCache(storage, { version: 1, publicId: binding.publicId, confirmed: result.state, bodies: {} })) return stop();
  if (!setClaimedAt(storage, at)) return stop();
  try {
    removeGuestProgress(storage);
  } catch {
    return stop();
  }
  clearClaiming(storage);
  return 'moved';
}

/**
 * At boot: a claimed binding with a cache and guest keys still present is a tab that died between the last two
 * writes of `finishClaim`. The guest keys go (the server has them) and so does the marker. True when it removed any.
 */
export function finishInterruptedClaim(storage: StorageLike | null): boolean {
  if (!storage) return false;
  const b = readBinding(storage);
  if (b === null || b.claimedAt === undefined) return false;
  const cache = readCache(storage);
  if (cache === null || cache.publicId !== b.publicId) return false;
  try {
    const present = [LEDGER_KEY, ACCOUNT_KEY, TUTORIAL_DONE_KEY, SAVES_KEY, ROAR_KEY].some((k) => storage.getItem(k) !== null);
    if (!present && storage.getItem(CLAIMING_KEY) === null) return false;
    removeGuestProgress(storage);
    storage.removeItem(CLAIMING_KEY);
    return true;
  } catch {
    return false;
  }
}

/** A device with no guest progress claims quietly (§0.41): `claimedAt` locally, no claim request, then the server's state. */
export async function claimQuietly(client: AccountClient, storage: StorageLike | null, now: () => number = Date.now): Promise<boolean> {
  if (!setClaimedAt(storage, now())) return false;
  const b = readBinding(storage);
  const r = await client.state();
  if (r.ok && b !== null) writeCache(storage, { version: 1, publicId: b.publicId, confirmed: r.body, bodies: {} });
  return true;
}

export type ClaimOutcome = 'moved' | 'kept' | 'retry' | 'blocked' | 'failed';

export interface RunClaimOptions {
  client: AccountClient;
  guest: LedgerStore;
  storage: StorageLike;
  now?: () => number;
}

/**
 * One whole attempt: the device id, the body, the marker, the send, the finish. A stored result that matches nothing
 * the device holds (`stale`) mints a new device id and rebuilds, at most twice. `retry` and a network failure leave the
 * marker in place so the retry sends the same device id; a refusal the server will repeat (cap, size, bad body) answers
 * `kept`, with the marker removed so the player is not locked out of their own game.
 */
export async function runClaim(o: RunClaimOptions): Promise<ClaimOutcome> {
  const now = o.now ?? Date.now;
  for (let attempt = 0; attempt < 3; attempt++) {
    const binding = readBinding(o.storage);
    if (binding === null) return 'failed';
    const deviceId = ensureDeviceId(o.storage);
    const built = buildClaim(o.guest, deviceId, { publicId: binding.publicId, at: now() });
    const snapshot = { campaign: o.guest.snapshotCampaign(), slots: o.guest.readSlotsRaw() };
    if (!(await beginClaim(o.storage, built, now))) return 'blocked';
    const r = await o.client.claim(built.body);
    if (!r.ok) {
      if (r.status === 0 || r.status === 429 || r.status >= 500) return 'retry';
      clearClaiming(o.storage);
      return 'kept';
    }
    const fin = await finishClaim({ result: r.body, sent: built.sent, damaged: built.damaged, storage: o.storage, snapshot, now });
    if (fin !== 'stale') return fin;
    // A new id for the same device; the marker is rewritten by the next beginClaim.
    clearDeviceId(o.storage);
  }
  return 'failed';
}
