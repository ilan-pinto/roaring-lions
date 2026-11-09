/**
 * `accountLedgerStore` (GH-1075 A2): the app's synchronous `LedgerStore` over the device's copy of the server's
 * answer. Reads come from `viewOf(confirmed, outbox)`, so a write is visible at once; a write appends to this tab's
 * outbox and tells the sync loop (`onChange`). Coins are the server's (§0.9): the wallet is read here and never
 * written. It is chosen only for a claimed, signed-in binding behind `?accounts` (`select-store.ts`); a guest never
 * reaches it.
 */
import { canonicalSlot, emptyAccount, parseSlot } from '@lions/economy';
import type { BrigadeAccount, CampaignBody, ParsedWorld, RoarWallet, SaveSlot, ServerState } from '@lions/economy';
import { startCampaign as clearCampaignPay, type StorageLike } from '../brigade-account';
import type { CampaignLedger, CampaignSnapshot, LedgerStore, VictoryRecord, VictoryWrite } from '../ledger-store';
import type { AccountCache } from './cache';
import { carriesCampaign, coalesce, readBase, readOutbox, writeOutbox, type OutboxOp } from './outbox';
import { viewOf, walletOf } from './replay';

/** Thrown by every coin write while signed in: a path left on `writeRoar` goes red here, not silently local. */
export class ServerCoinsError extends Error {
  constructor(what: string) {
    super(`${what}: coins are the server's while signed in`);
    this.name = 'ServerCoinsError';
  }
}

export interface AccountStoreOptions {
  storage: StorageLike | null;
  cache: AccountCache;
  world: ParsedWorld;
  onChange: () => void;
  newOpId: () => string;
  /** This tab's id (§0.38), required: the outbox key is `lions.account.outbox.<tabId>`. `tabIdOf` (tab-id.ts) mints it. */
  tabId: string;
}

/**
 * What the sync loop (`sync.ts`) may do to the store's own state. The store is the only writer of this tab's outbox
 * key, so the loop goes through it and the in-memory queue and the stored one never part. `cache.confirmed` is
 * REPLACED with a new object, never mutated (the view memo keys on its identity).
 */
export interface StoreSyncApi {
  readonly cache: AccountCache;
  readonly tabId: string;
  ops(): readonly OutboxOp[];
  /** Replace the whole queue (an ack, a drop, an adoption). Writes this tab's key and drops the view memo; no `onChange`. False when storage refused (the memory copy is then the truth). */
  setOps(next: readonly OutboxOp[]): boolean;
  /** The campaign revision the queued campaign ops are sent on (R12); undefined when none is pinned. Persisted in this tab's own outbox value. */
  base(): number | undefined;
  setBase(n: number | undefined): void;
  /** The op was handed to the network: a later append may no longer coalesce into it. */
  markSent(opId: string): void;
  markPending(key: string): void;
  clearPending(key: string): void;
}

export type AccountLedgerStore = LedgerStore & {
  /** Keys of coin Buys in flight (`<unitId>.<track>`, `unit:<id>`); the sync loop fills it through `sync`. */
  pendingSpends: ReadonlySet<string>;
  outboxSize(): number;
  view(): ServerState;
  sync: StoreSyncApi;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function accountLedgerStore(o: AccountStoreOptions): AccountLedgerStore {
  const tabId = o.tabId;
  const pendingSpends = new Set<string>();
  const sent = new Set<string>();
  let ops: OutboxOp[] = readOutbox(o.storage, tabId);
  // The send base (R12) lives with THIS tab's queue, never in the shared cache: another tab cannot move it.
  let base: number | undefined = readBase(o.storage, tabId);
  // The view is memoised on the identity of the confirmed state AND the ops. The sync loop (Task 2.10) refreshes by
  // REPLACING `cache.confirmed` with a new object (never mutating it in place); no explicit refresh call is needed.
  let cached: ServerState | null = null;
  let cachedFor: ServerState | null = null;

  const view = (): ServerState => {
    if (cached === null || cachedFor !== o.cache.confirmed) {
      cached = viewOf(o.cache.confirmed, ops, o.world);
      cachedFor = o.cache.confirmed;
    }
    return cached;
  };
  const push = (op: OutboxOp): void => {
    ops = coalesce(ops, op, sent);
    // R17: a campaign-carrying op pins this tab's send base at QUEUE time (the revision its snapshot was built on), so another
    // tab's ack, which advances the shared cache, cannot re-base it later. This queue's own acks still advance it.
    if (base === undefined && carriesCampaign(op)) base = o.cache.confirmed.campaign?.revision ?? 0;
    writeOutbox(o.storage, tabId, ops, o.cache.publicId, base); // a refused write keeps the memory copy
    cached = null;
    o.onChange();
  };
  const body = (): CampaignBody => {
    const c = view().campaign;
    return { ledger: c?.ledger ?? {}, brigade: c?.brigade ?? emptyAccount(), tutorialDone: c?.tutorialDone ?? false };
  };
  const putCampaign = (patch: Partial<CampaignBody>): void => push({ kind: 'campaign', opId: o.newOpId(), campaign: { ...body(), ...patch } });
  /** A slot's body: the newest queued put, else the cache; undefined while it has not been downloaded. */
  const bodyFor = (id: string): SaveSlot | undefined => {
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      if (op !== undefined && op.kind === 'slot.put' && op.slotId === id) return op.slot;
      if (op !== undefined && op.kind === 'slot.delete' && op.slotId === id) return undefined;
    }
    return o.cache.bodies[id];
  };
  const sameSlot = (a: SaveSlot, b: SaveSlot): boolean => {
    try {
      return a.name === b.name && canonicalSlot(a) === canonicalSlot(b);
    } catch {
      return false;
    }
  };
  const roar = (): RoarWallet => walletOf(view().wallet);
  const refuse = (what: string) => (): never => {
    throw new ServerCoinsError(what);
  };

  const sync: StoreSyncApi = {
    cache: o.cache,
    tabId,
    ops: () => ops,
    setOps: (next) => {
      ops = [...next];
      cached = null;
      return writeOutbox(o.storage, tabId, ops, o.cache.publicId, base);
    },
    base: () => base,
    setBase: (n) => {
      if (base === n) return;
      base = n;
      writeOutbox(o.storage, tabId, ops, o.cache.publicId, base);
    },
    markSent: (opId) => void sent.add(opId),
    markPending: (key) => void pendingSpends.add(key),
    clearPending: (key) => void pendingSpends.delete(key),
  };

  return {
    available: true,
    pendingSpends,
    sync,
    outboxSize: () => ops.length,
    view,
    readLedger: (): CampaignLedger => structuredClone(body().ledger) as CampaignLedger,
    writeLedger: (l: CampaignLedger): void => putCampaign({ ledger: l }),
    clearLedger: (): void => putCampaign({ ledger: {} }),
    readAccount: (): BrigadeAccount => structuredClone(body().brigade),
    writeAccount: (a: BrigadeAccount): void => putCampaign({ brigade: a }),
    startCampaign: (): void => {
      const c = view().campaign;
      if (c === null) return; // nothing stored, nothing to clear
      putCampaign({ brigade: clearCampaignPay(c.brigade) });
    },
    tutorialDone: (): boolean => body().tutorialDone,
    setTutorialDone: (done: boolean): void => putCampaign({ tutorialDone: done }),
    resetAccount: refuse('resetAccount'),

    readSlotsRaw: (): string | null => {
      const out: Record<string, SaveSlot> = {};
      for (const m of view().slots) {
        const b = bodyFor(m.id);
        if (b !== undefined) out[m.id] = b;
      }
      return Object.keys(out).length === 0 ? null : JSON.stringify(out);
    },
    writeSlotsRaw: (json: string): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;
      for (const [id, raw] of Object.entries(parsed)) {
        let next: SaveSlot;
        try {
          next = parseSlot(JSON.stringify(raw));
        } catch {
          continue; // a damaged entry is never sent (§0.15)
        }
        const prior = bodyFor(id);
        if (prior === undefined || !sameSlot(prior, next)) push({ kind: 'slot.put', opId: o.newOpId(), slotId: id, slot: next, origin: 'player' });
      }
      // A slot whose body this device has not downloaded was never offered to the caller, so its absence is not a delete.
      for (const m of view().slots) {
        if (!(m.id in parsed) && bodyFor(m.id) !== undefined) push({ kind: 'slot.delete', opId: o.newOpId(), slotId: m.id });
      }
    },

    readRoar: roar,
    writeRoar: refuse('writeRoar'),
    snapshotRoar: (): string => JSON.stringify(roar()),
    restoreRoar: refuse('restoreRoar'),

    snapshotCampaign: (): CampaignSnapshot => {
      const c = view().campaign;
      if (c === null) return { ledger: null, account: null, tutorial: null };
      return { ledger: JSON.stringify(c.ledger), account: JSON.stringify(c.brigade), tutorial: c.tutorialDone ? '1' : null };
    },
    restoreCampaign: (snap: CampaignSnapshot): void => {
      if (snap.ledger === null && snap.account === null && snap.tutorial === null && view().campaign === null) return;
      let ledger: CampaignLedger = {};
      let brigade = emptyAccount();
      try {
        if (snap.ledger !== null) ledger = JSON.parse(snap.ledger) as CampaignLedger;
        if (snap.account !== null) brigade = JSON.parse(snap.account) as BrigadeAccount; // this store's own snapshot, so no migration
      } catch {
        /* an unreadable snapshot restores what parsed */
      }
      putCampaign({ ledger, brigade, tutorialDone: snap.tutorial === '1' });
    },

    recordVictory: (v: VictoryRecord): VictoryWrite => {
      const campaign: CampaignBody = { ledger: v.ledger, brigade: v.account ?? body().brigade, tutorialDone: body().tutorialDone };
      // A mission that pays nothing (the tutorial) is only a campaign write; the coins are the server's either way.
      if (v.win === null) push({ kind: 'campaign', opId: o.newOpId(), campaign });
      else push({ kind: 'victory', opId: o.newOpId(), missionId: v.win.missionId, stars: v.win.stars, start: v.start, campaign });
      return 'saved';
    },
  };
}

/** True for the server-backed store (the only `LedgerStore` with a sync handle); a guest's or a blocked store is never one. */
export const isAccountStore = (s: LedgerStore): s is AccountLedgerStore => 'pendingSpends' in s && 'sync' in s;
