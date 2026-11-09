/**
 * The sync loop (GH-1075 A2): the background flusher that sends this tab's outbox to the Worker one op at a time,
 * oldest first, and keeps what the server said in the cache. A mistake here loses a player's campaign or counts
 * coins twice, so its rules are few and each is tested:
 *
 *  - one op in the air, and the queue is read again before each send (an op appended in flight is sent next, on the
 *    revision the previous answer returned: `base` is filled at SEND time, never at queue time);
 *  - a 200 removes exactly the op it answers, by id, and replaces `confirmed` with a NEW object (the view memo keys
 *    on its identity); an answer that is reduced (a replay) or older than `confirmed` never replaces it, and a
 *    `GET state` follows instead (§0.33);
 *  - a 409 `stale` never re-bases what is queued behind it (§0.25, 705): the device's campaign is first kept (a
 *    `held` entry in `lions.account.local`, written BEFORE the server's campaign is adopted, or the conflict slot the
 *    server made), the queued campaign ops are dropped, and the newest snapshot replaces that body;
 *  - 429, 5xx, `busy` and network failures back off (2 s doubling to 60 s) and keep the order; an op that fails 5
 *    times with a 5xx or `busy` is filed as `refused` and dropped, so one bad op cannot wedge the queue (§0.35);
 *  - one flusher at a time across tabs, under `lions.account.flush`; this tab's heartbeat is written before any
 *    orphaned outbox is looked for (§0.38).
 */
import { canonicalCampaign, canonicalSlot, SAVE_VERSION } from '@lions/economy';
import type { CampaignBody, CampaignView, CoinAskWire, ConflictAnswer, SaveSlot, ServerState, SlotMetaView, WalletView } from '@lions/economy';
import type { StorageLike } from '../brigade-account';
import type { AccountLedgerStore } from './account-store';
import { clearBinding, clearDeviceId, readBinding, writeBinding } from './binding';
import { ACCOUNT_CACHE_KEY, writeCache } from './cache';
import type { AccountClient, CallResult, CampaignOp, CouponAnswer, ResetFreeAnswer, SlotPutOp, VictoryAnswer, VictoryOp } from './client';
import { addHeld, readHeld, removeHeld, type HeldItem } from './local-held';
import { heartbeatKey, orphanedOutboxes, readOutbox, writeOutbox, type OutboxOp } from './outbox';
import { resolveSignedIn, sha256Hex } from './signed-in';

/** Campaign and slot ops wait this long to coalesce; a victory goes at once. */
export const FLUSH_DEBOUNCE_MS = 2000;
export const BACKOFF_START_MS = 2000;
export const BACKOFF_MAX_MS = 60_000;
export const HEARTBEAT_MS = 10_000;
/** Consecutive 5xx or `busy` answers to one op before it is filed as `refused` and dropped. */
export const WEDGE_AFTER = 5;
export const SIGN_OUT_LIMIT_MS = 5000;
export const FLUSH_LOCK = 'lions.account.flush';
/** The server's cap on `claim` and `conflict` slots together (the Worker's `SYSTEM_SLOTS`). */
const SYSTEM_SLOTS = 4;

export type SyncMode = 'active' | 'signedOut' | 'foreign' | 'deleted' | 'stopped';

export type BarrierOutcome<T> =
  | { kind: 'ok'; body: T }
  | { kind: 'refused'; reason: string }
  | { kind: 'offline' }
  | { kind: 'syncing' }
  | { kind: 'error'; status: number };

export interface SyncOptions {
  store: AccountLedgerStore;
  client: AccountClient;
  storage: StorageLike | null;
  locks?: LockManager;
  now: () => number;
  /** Run `fn` after `ms`; the returned function cancels it. */
  schedule: (ms: number, fn: () => void) => () => void;
  /** A signed-in member other than the cache's: keep-or-remove is offered, no op is sent (A1-21). */
  onForeignMember?: () => void;
  /** The view changed (a response landed): the screens re-read. Not the store's `onChange`, which means "an op was queued". */
  onChange?: () => void;
  /** Connection state; defaults to `navigator.onLine`. */
  online?: () => boolean;
  newId?: () => string;
}

export interface SyncHandle {
  flush(): Promise<void>;
  /** `GET state`, then the slot bodies whose change token differs from the cache's, then any held campaign that now fits. */
  refresh(): Promise<void>;
  barrier<T>(fn: () => Promise<T>): Promise<T | 'offline' | 'syncing'>;
  spend(ask: CoinAskWire): Promise<BarrierOutcome<{ wallet: WalletView }>>;
  coupon(code: string): Promise<BarrierOutcome<CouponAnswer>>;
  resetFree(): Promise<BarrierOutcome<ResetFreeAnswer>>;
  /** The store's `onChange` calls this: schedule a flush (at once when a victory is queued, else after the debounce). */
  kick(): void;
  /** Resolves when the flush now running (if any) has finished. */
  idle(): Promise<void>;
  status(): SyncMode;
  stop(): void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFullCampaign = (c: unknown): c is CampaignView =>
  isRecord(c) && isRecord(c.ledger) && isRecord(c.brigade) && typeof c.revision === 'number' && typeof c.digest === 'string';
const isWallet = (w: unknown): w is WalletView => isRecord(w) && typeof w.revision === 'number' && typeof w.free === 'number';
const errorOf = (body: unknown): string | null => (isRecord(body) && typeof body.error === 'string' ? body.error : null);
const defaultOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

/** A campaign body as a slot, for the conflict slot's body and for a held campaign's upload. */
export function slotFromCampaign(body: CampaignBody, id: string, name: string, savedAt: number): SaveSlot {
  const canon = JSON.parse(canonicalCampaign(body)) as CampaignBody;
  return { version: SAVE_VERSION, id, name, savedAt, build: 'device', ledger: canon.ledger, account: canon.brigade, tutorialDone: canon.tutorialDone };
}

const campaignOf = (op: OutboxOp): CampaignBody | null => (op.kind === 'campaign' || op.kind === 'victory' ? op.campaign : null);

/** What an op that cannot be sent leaves behind, verbatim. A delete has no content to keep. */
export function heldFromOp(op: OutboxOp, publicId: string, at: number): HeldItem | null {
  switch (op.kind) {
    case 'campaign':
      return { id: op.opId, kind: 'campaign', reason: 'refused', text: JSON.stringify(op.campaign), at, publicId };
    case 'victory':
      return { id: op.opId, kind: 'campaign', reason: 'refused', text: op.campaign === null ? JSON.stringify({ missionId: op.missionId, stars: op.stars }) : JSON.stringify(op.campaign), at, publicId };
    case 'slot.put':
      return { id: op.opId, kind: 'slot', reason: 'refused', text: JSON.stringify(op.slot), at, publicId };
    case 'slot.delete':
      return null;
  }
}

export function startSync(o: SyncOptions): SyncHandle {
  const { store, client, storage } = o;
  const api = store.sync;
  const cache = api.cache;
  const online = o.online ?? defaultOnline;
  const newId = o.newId ?? ((): string => crypto.randomUUID());
  let mode: SyncMode = 'active';
  let stopped = false;
  let running: Promise<void> | null = null;
  let backoff = BACKOFF_START_MS;
  let cancelRetry: (() => void) | null = null;
  let cancelDebounce: (() => void) | null = null;
  let cancelBeat: (() => void) | null = null;
  const failures = new Map<string, number>();

  // ---- the cache -------------------------------------------------------------------------------------------------
  const persist = (): void => void writeCache(storage, cache); // a refused write leaves the memory copy
  const changed = (): void => o.onChange?.();
  /** REPLACE `confirmed` (the view memo keys on its identity), then store it. */
  const commit = (patch: Partial<ServerState>): void => {
    cache.confirmed = { ...cache.confirmed, ...patch };
    persist();
    changed();
  };
  const currentRevision = (): number => cache.confirmed.campaign?.revision ?? 0;
  const removeOp = (opId: string): void => void api.setOps(api.ops().filter((x) => x.opId !== opId));
  /** The campaign an answer carries, when it may replace `confirmed`'s: full, and not older. `refresh` is set when it may not. */
  const campaignPatch = (c: unknown): { campaign?: CampaignView; refresh: boolean } => {
    if (c === null || c === undefined) return { refresh: false };
    if (isFullCampaign(c) && c.revision >= currentRevision()) return { campaign: c, refresh: false };
    return { refresh: true };
  };
  const walletPatch = (w: unknown): { wallet?: WalletView; refresh: boolean } => {
    if (w === null || w === undefined) return { refresh: false };
    if (isWallet(w) && w.revision >= cache.confirmed.wallet.revision) return { wallet: w, refresh: false };
    return { refresh: true };
  };
  const withMeta = (slots: SlotMetaView[], meta: SlotMetaView): SlotMetaView[] => {
    const plain: SlotMetaView = { id: meta.id, name: meta.name, savedAt: meta.savedAt, build: meta.build, origin: meta.origin, bytes: meta.bytes };
    return [...slots.filter((x) => x.id !== meta.id), plain];
  };

  // ---- the heartbeat ---------------------------------------------------------------------------------------------
  const beat = (): void => {
    try {
      storage?.setItem(heartbeatKey(api.tabId), String(o.now()));
    } catch {
      /* a refusing storage: a sibling may then adopt this tab's queue, which is safe (ops are idempotent by id) */
    }
    if (!stopped) cancelBeat = o.schedule(HEARTBEAT_MS, beat);
  };
  beat();

  // ---- 401 -------------------------------------------------------------------------------------------------------
  const wipe = (): void => {
    try {
      storage?.removeItem(ACCOUNT_CACHE_KEY);
    } catch {
      /* as above */
    }
    api.setOps([]);
  };
  /** Ask who is signed in. True when it is this cache's member, so the loop may send. */
  async function recheck(): Promise<boolean> {
    const before = readBinding(storage);
    const res = await resolveSignedIn(client, storage);
    if (stopped) return false;
    if (res.kind === 'deleted') {
      wipe();
      mode = 'deleted';
      return false;
    }
    if (res.kind === 'guest' || res.kind === 'signedOut') {
      mode = 'signedOut';
      return false;
    }
    if (res.me.kind === 'signedIn' && res.me.publicId === cache.publicId) {
      mode = 'active';
      return true;
    }
    // Another member: the old binding stays until the player chooses (keep or remove), and nothing is sent.
    if (before !== null) writeBinding(storage, before);
    else clearBinding(storage);
    if (mode !== 'foreign') {
      mode = 'foreign';
      o.onForeignMember?.();
    }
    return false;
  }

  // ---- filing ----------------------------------------------------------------------------------------------------
  const file = (op: OutboxOp): boolean => {
    const item = heldFromOp(op, cache.publicId, o.now());
    return item === null ? true : addHeld(storage, item);
  };
  const heldItem = (id: string): HeldItem | undefined => readHeld(storage).find((h) => h.id === id);
  const digestOfCampaign = async (c: CampaignBody, id: string, at: number): Promise<string | undefined> => {
    try {
      return await sha256Hex(canonicalSlot(slotFromCampaign(c, id, 'conflict', at)));
    } catch {
      return undefined;
    }
  };

  // ---- refresh ---------------------------------------------------------------------------------------------------
  async function releaseHeld(): Promise<void> {
    const queued = api.ops();
    const queuedPuts = new Set(queued.filter((x): x is SlotPutOp => x.kind === 'slot.put' && x.origin === 'conflict').map((x) => x.slotId));
    let free = SYSTEM_SLOTS - cache.confirmed.slots.filter((s) => s.origin !== 'player').length - queuedPuts.size;
    const add: OutboxOp[] = [];
    for (const item of readHeld(storage)) {
      if (free <= 0) break;
      if (item.kind !== 'campaign' || item.reason !== 'held' || item.publicId !== cache.publicId || item.digest === undefined || queuedPuts.has(item.id)) continue;
      let campaign: CampaignBody;
      try {
        campaign = JSON.parse(item.text) as CampaignBody;
        const slot = slotFromCampaign(campaign, item.id, 'conflict', item.at);
        add.push({ kind: 'slot.put', opId: newId(), slotId: item.id, slot, origin: 'conflict' });
        free--;
      } catch {
        /* an unreadable held entry stays where it is */
      }
    }
    if (add.length > 0) {
      api.setOps([...api.ops(), ...add]);
      kick();
    }
  }

  async function doRefresh(): Promise<void> {
    const r = await client.state();
    if (stopped) return;
    if (r.status === 401) {
      await recheck();
      return;
    }
    if (!r.ok) return; // keep what the device has
    const next = r.body;
    const prev = cache.confirmed;
    // Never move backwards: a state older than the cache's campaign is a slow answer, not the server's present.
    if (next.campaign !== null && prev.campaign !== null && next.campaign.revision < prev.campaign.revision) return;
    cache.confirmed = { campaign: next.campaign, wallet: next.wallet, slots: next.slots };
    persist();
    changed();
    const bodies: Record<string, SaveSlot> = {};
    for (const meta of next.slots) {
      const old = prev.slots.find((s) => s.id === meta.id);
      const have = cache.bodies[meta.id];
      if (have !== undefined && old !== undefined && old.savedAt === meta.savedAt && old.bytes === meta.bytes) {
        bodies[meta.id] = have;
        continue;
      }
      const got = await client.slot(meta.id);
      if (stopped) return;
      if (got.ok) bodies[meta.id] = got.body.body;
      else if (have !== undefined) bodies[meta.id] = have; // keep what we hold when the fetch failed
    }
    cache.bodies = bodies;
    persist();
    changed();
    await releaseHeld();
  }

  // ---- one op ----------------------------------------------------------------------------------------------------
  type Next = 'next' | 'wait' | 'halt';

  /** The 409 stale, or a victory's `conflict`: keep the device's campaign FIRST, then take the server's. */
  async function resolveConflict(op: OutboxOp, mine: CampaignBody | null, conflict: ConflictAnswer, server: unknown, wallet?: unknown): Promise<Next> {
    const cur = api.ops();
    const at = cur.findIndex((x) => x.opId === op.opId);
    const ahead = at >= 0 ? cur.slice(0, at) : [];
    const behind = at >= 0 ? cur.slice(at + 1) : [];
    // The newest snapshot the device holds: the last queued campaign (or victory's campaign), else the op's own.
    let newest: CampaignBody | null = null;
    for (const q of behind) newest = campaignOf(q) ?? newest;
    const latest = newest ?? mine;
    let put: SlotPutOp | null = null;
    if ('held' in conflict) {
      if (latest !== null) {
        const id = newId();
        const when = o.now();
        const item: HeldItem = { id, kind: 'campaign', reason: 'held', text: JSON.stringify(latest), at: when, publicId: cache.publicId, digest: await digestOfCampaign(latest, id, when) };
        if (stopped) return 'halt';
        if (!addHeld(storage, item)) return 'wait'; // not kept: nothing is adopted, nothing is dropped
      }
    } else if (newest !== null) {
      put = { kind: 'slot.put', opId: newId(), slotId: conflict.slot.id, slot: slotFromCampaign(newest, conflict.slot.id, conflict.slot.name, o.now()), origin: 'conflict' };
    }
    if (stopped) return 'halt';
    // Only now is the server's campaign adopted.
    const cp = campaignPatch(server);
    const wp = walletPatch(wallet);
    const patch: Partial<ServerState> = {};
    if (cp.campaign !== undefined) patch.campaign = cp.campaign;
    if (wp.wallet !== undefined) patch.wallet = wp.wallet;
    if ('slot' in conflict) patch.slots = withMeta(cache.confirmed.slots, conflict.slot);
    commit(patch);
    const kept = behind.filter((q) => q.kind !== 'campaign').map((q): OutboxOp => (q.kind === 'victory' && q.campaign !== null ? { ...q, campaign: null } : q));
    api.setOps([...(put === null ? [] : [put]), ...ahead, ...kept]);
    failures.delete(op.opId);
    if (cp.refresh || wp.refresh) await doRefresh();
    return 'next';
  }

  async function onOk(op: OutboxOp, body: unknown): Promise<Next> {
    backoff = BACKOFF_START_MS;
    failures.delete(op.opId);
    switch (op.kind) {
      case 'campaign': {
        const cp = campaignPatch(isRecord(body) ? body.campaign : null);
        removeOp(op.opId);
        if (cp.campaign !== undefined) commit({ campaign: cp.campaign });
        else changed();
        if (cp.refresh || cp.campaign === undefined) await doRefresh();
        return 'next';
      }
      case 'victory': {
        const b = body as VictoryAnswer;
        if (b.conflict !== undefined) {
          const out = await resolveConflict(op, op.campaign, b.conflict, b.campaign, b.wallet);
          if (out === 'next') removeOp(op.opId);
          return out;
        }
        const wp = walletPatch(b.wallet);
        const cp = campaignPatch(b.campaign);
        removeOp(op.opId);
        const patch: Partial<ServerState> = {};
        if (wp.wallet !== undefined) patch.wallet = wp.wallet;
        if (cp.campaign !== undefined) patch.campaign = cp.campaign;
        commit(patch);
        if (wp.refresh || cp.refresh) await doRefresh();
        return 'next';
      }
      case 'slot.put': {
        const meta = isRecord(body) && isRecord(body.slot) ? (body.slot as unknown as SlotMetaView) : null;
        removeOp(op.opId);
        if (meta !== null) {
          const { digest, ...plain } = meta;
          cache.bodies = { ...cache.bodies, [op.slotId]: op.slot };
          commit({ slots: [...cache.confirmed.slots.filter((s) => s.id !== op.slotId), plain] });
          const held = heldItem(op.slotId);
          if (op.origin === 'conflict' && held !== undefined) {
            // The held campaign leaves the list only when the server's digest is the one it was stored with.
            const own = await digestOfCampaign(JSON.parse(held.text) as CampaignBody, held.id, held.at);
            if (own !== undefined && digest === own && removeHeld(storage, held.id, own)) return 'next';
            addHeld(storage, { ...held, reason: 'refused' });
          }
        }
        return 'next';
      }
      case 'slot.delete': {
        removeOp(op.opId);
        const rest = { ...cache.bodies };
        delete rest[op.slotId];
        cache.bodies = rest;
        commit({ slots: cache.confirmed.slots.filter((s) => s.id !== op.slotId) });
        return 'next';
      }
    }
  }

  function failOp(op: OutboxOp, counted: boolean): Next {
    if (!counted) return 'wait';
    const n = (failures.get(op.opId) ?? 0) + 1;
    failures.set(op.opId, n);
    if (n < WEDGE_AFTER) return 'wait';
    if (!file(op)) return 'wait'; // not filed: not dropped
    failures.delete(op.opId);
    removeOp(op.opId);
    return 'next';
  }

  async function onFail(op: OutboxOp, r: Extract<CallResult<unknown>, { ok: false }>): Promise<Next> {
    const err = errorOf(r.body);
    if (r.status === 401) {
      await recheck();
      return 'halt';
    }
    if (r.status === 400 || r.status === 413) {
      const held = op.kind === 'slot.put' && op.origin === 'conflict' ? heldItem(op.slotId) : undefined;
      if (held !== undefined) addHeld(storage, { ...held, reason: 'refused' });
      else if (!file(op)) return 'wait';
      failures.delete(op.opId);
      removeOp(op.opId);
      return 'next';
    }
    if (r.status === 409) {
      if (err === 'stale' && op.kind === 'campaign' && isRecord(r.body) && isRecord(r.body.conflict)) {
        return resolveConflict(op, op.campaign, r.body.conflict as ConflictAnswer, r.body.campaign);
      }
      if (err === 'cap' && op.kind === 'slot.put') {
        // A held campaign's upload that lost the race for the slot stays held and is tried again at the next refresh.
        if (!(op.origin === 'conflict' && heldItem(op.slotId) !== undefined) && !addHeld(storage, { ...(heldFromOp(op, cache.publicId, o.now()) as HeldItem), reason: 'cap' })) return 'wait';
        removeOp(op.opId);
        return 'next';
      }
      return failOp(op, true); // busy, or an answer this build does not know
    }
    if (r.status === 404 && op.kind === 'slot.delete') return onOk(op, { ok: true });
    if (r.status === 0 || r.status === 429) return failOp(op, false);
    return failOp(op, true);
  }

  async function sendOne(op: OutboxOp): Promise<Next> {
    api.markSent(op.opId);
    const base = currentRevision(); // at SEND time
    let r: CallResult<unknown>;
    switch (op.kind) {
      case 'campaign':
        r = await client.putCampaign(op as CampaignOp, base);
        break;
      case 'victory':
        r = await client.victory(op as VictoryOp, base);
        break;
      case 'slot.put':
        r = await client.putSlot(op);
        break;
      case 'slot.delete':
        r = await client.deleteSlot(op);
        break;
    }
    if (stopped) return 'halt'; // a result that lands after sign-out or stop touches nothing
    return r.ok ? onOk(op, r.body) : onFail(op, r);
  }

  // ---- orphans ---------------------------------------------------------------------------------------------------
  function adoptOrphans(): void {
    for (const tab of orphanedOutboxes(storage, o.now())) {
      if (tab === api.tabId) continue;
      const adopted = readOutbox(storage, tab);
      // Append to this tab's key first, then remove the orphan's: a crash between the two duplicates ops, which are idempotent by id.
      if (adopted.length > 0 && !api.setOps([...api.ops(), ...adopted])) continue;
      writeOutbox(storage, tab, []);
      try {
        storage?.removeItem(heartbeatKey(tab));
      } catch {
        /* as above */
      }
    }
  }

  // ---- the loop --------------------------------------------------------------------------------------------------
  function scheduleRetry(): void {
    if (cancelRetry !== null || stopped) return;
    const ms = backoff;
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    cancelRetry = o.schedule(ms, () => {
      cancelRetry = null;
      void flush();
    });
  }

  async function drain(): Promise<void> {
    if (stopped || mode === 'deleted') return;
    if (mode !== 'active' && !(await recheck())) return;
    // This tab's heartbeat is written now, BEFORE the orphan scan: a live sibling with no beat yet would be adopted.
    try {
      storage?.setItem(heartbeatKey(api.tabId), String(o.now()));
    } catch {
      /* as above */
    }
    cancelRetry?.();
    cancelRetry = null;
    adoptOrphans();
    while (!stopped && mode === 'active') {
      const op = api.ops()[0]; // read again before every send
      if (op === undefined) break;
      let out: Next;
      try {
        out = await sendOne(op);
      } catch (e) {
        console.error('account sync', e);
        out = 'wait';
      }
      if (out === 'next') continue;
      if (out === 'wait') scheduleRetry();
      break;
    }
  }

  function flush(): Promise<void> {
    if (running !== null) return running;
    const p = (async (): Promise<void> => {
      if (o.locks) await o.locks.request(FLUSH_LOCK, () => drain());
      else await drain();
    })().finally(() => {
      running = null;
      kick(); // something may have been queued after the last look
    });
    running = p;
    return p;
  }

  function kick(): void {
    if (stopped || mode !== 'active' || cancelRetry !== null) return; // in backoff the retry timer is the only way back
    const queue = api.ops();
    if (queue.length === 0) return;
    if (queue.some((x) => x.kind === 'victory')) {
      void flush();
      return;
    }
    if (cancelDebounce !== null) return;
    cancelDebounce = o.schedule(FLUSH_DEBOUNCE_MS, () => {
      cancelDebounce = null;
      void flush();
    });
  }

  const locked = <T>(fn: () => Promise<T>): Promise<T> => (o.locks ? (o.locks.request(FLUSH_LOCK, fn) as Promise<T>) : fn());

  async function barrier<T>(fn: () => Promise<T>): Promise<T | 'offline' | 'syncing'> {
    if (!online()) return 'offline';
    if (api.ops().length > 0) return 'syncing';
    return locked(async () => (api.ops().length > 0 || (!o.locks && running !== null) ? 'syncing' : fn()));
  }

  /** A barrier op: sent only with the outbox empty and the lock held; its key is in `pendingSpends` while it is in the air. */
  async function viaBarrier<T extends { wallet: WalletView }>(call: () => Promise<CallResult<T>>, key?: string): Promise<BarrierOutcome<T>> {
    const out = await barrier(async (): Promise<BarrierOutcome<T>> => {
      if (key !== undefined) api.markPending(key);
      try {
        const r = await call();
        if (stopped) return { kind: 'error', status: 0 };
        if (r.ok) {
          const patch: Partial<ServerState> = {};
          const wp = walletPatch(r.body.wallet);
          if (wp.wallet !== undefined) patch.wallet = wp.wallet;
          const campaign = (r.body as { campaign?: unknown }).campaign;
          const cp = campaignPatch(campaign);
          if (cp.campaign !== undefined) patch.campaign = cp.campaign;
          commit(patch);
          if (cp.refresh && campaign !== undefined) await doRefresh();
          return { kind: 'ok', body: r.body };
        }
        if (r.status === 401) {
          await recheck();
          return { kind: 'error', status: 401 };
        }
        if (r.status === 409 && errorOf(r.body) === 'refused' && isRecord(r.body)) {
          const wp = walletPatch(r.body.wallet);
          if (wp.wallet !== undefined) commit({ wallet: wp.wallet });
          return { kind: 'refused', reason: typeof r.body.reason === 'string' ? r.body.reason : 'refused' };
        }
        return { kind: 'error', status: r.status };
      } finally {
        if (key !== undefined) api.clearPending(key);
      }
    });
    if (out === 'offline') return { kind: 'offline' };
    if (out === 'syncing') return { kind: 'syncing' };
    return out;
  }

  const spendKey = (ask: CoinAskWire): string => (ask.item === 'unit' ? `unit:${ask.unitId}` : `${ask.unitId}.${ask.track}`);

  return {
    flush,
    refresh: () => locked(doRefresh),
    barrier,
    spend: (ask) => viaBarrier(() => client.spend(ask), spendKey(ask)),
    coupon: (code) => viaBarrier(() => client.coupon(code)),
    resetFree: () => viaBarrier(() => client.resetFree()),
    kick,
    idle: () => running ?? Promise.resolve(),
    status: () => mode,
    stop() {
      stopped = true;
      mode = mode === 'deleted' ? mode : 'stopped';
      for (const c of [cancelRetry, cancelDebounce, cancelBeat]) c?.();
      cancelRetry = cancelDebounce = cancelBeat = null;
    },
  };
}

export interface SignOutOptions {
  sync: Pick<SyncHandle, 'flush' | 'stop'>;
  store: AccountLedgerStore;
  client: AccountClient;
  storage: StorageLike | null;
  now: () => number;
  schedule: (ms: number, fn: () => void) => () => void;
  limitMs?: number;
}

/**
 * Explicit sign-out (§0.46): flush for at most 5 s, file whatever is still queued as `refused`, log out, then clear the
 * cache, this tab's outbox, `claimedAt` and `deviceId`. If the filing is refused by storage nothing is cleared and no
 * logout is sent: the work is still queued, and the promise rejects.
 */
export async function signOut(o: SignOutOptions): Promise<void> {
  let cancel: (() => void) | null = null;
  const limit = new Promise<void>((resolve) => {
    cancel = o.schedule(o.limitMs ?? SIGN_OUT_LIMIT_MS, resolve);
  });
  await Promise.race([o.sync.flush().catch(() => undefined), limit]);
  (cancel as (() => void) | null)?.();
  o.sync.stop();
  const cache = o.store.sync.cache;
  for (const op of o.store.sync.ops()) {
    const item = heldFromOp(op, cache.publicId, o.now());
    if (item !== null && !addHeld(o.storage, item)) throw new Error('sign-out: the unsent work could not be kept on this device');
  }
  await o.client.logout();
  try {
    o.storage?.removeItem(ACCOUNT_CACHE_KEY);
  } catch {
    /* as above */
  }
  o.store.sync.setOps([]);
  clearDeviceId(o.storage);
}
