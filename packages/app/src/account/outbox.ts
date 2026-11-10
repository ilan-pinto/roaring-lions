/**
 * The outbox (GH-1075 A2, §0.38): the writes a signed-in device has made and the server has not yet confirmed.
 * Each tab writes only `lions.account.outbox.<tabId>`, so browser storage's lack of atomicity across processes
 * cannot lose one tab's op to another's. Every access is guarded: with site data blocked the property access
 * itself throws, and a refused write leaves the caller's memory copy as the truth.
 */
import type { CampaignBody, SaveSlot } from '@lions/economy';
import type { StorageLike } from '../brigade-account';

export const OUTBOX_PREFIX = 'lions.account.outbox.';
export const HEARTBEAT_PREFIX = 'lions.account.tab.';
/** A tab whose heartbeat is older than this is gone; its outbox is adoptable. */
export const ORPHAN_AFTER_MS = 60_000;

export type OutboxOp =
  | { kind: 'campaign'; opId: string; campaign: CampaignBody }
  | { kind: 'victory'; opId: string; missionId: string; stars: number; start: string | null; campaign: CampaignBody | null }
  | { kind: 'slot.put'; opId: string; slotId: string; slot: SaveSlot; origin: 'player' | 'conflict' }
  | { kind: 'slot.delete'; opId: string; slotId: string };

/** Whether an op writes the campaign (a campaign op, or a victory that carries one): such an op pins the tab's send base (R17). */
export const carriesCampaign = (op: OutboxOp): boolean => op.kind === 'campaign' || (op.kind === 'victory' && op.campaign !== null);

export const outboxKey = (tabId: string): string => OUTBOX_PREFIX + tabId;
export const heartbeatKey = (tabId: string): string => HEARTBEAT_PREFIX + tabId;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validOp(v: unknown): v is OutboxOp {
  if (!isRecord(v) || typeof v.opId !== 'string') return false;
  switch (v.kind) {
    case 'campaign':
      return isRecord(v.campaign);
    case 'victory':
      return typeof v.missionId === 'string' && typeof v.stars === 'number' && (v.start === null || typeof v.start === 'string') && (v.campaign === null || isRecord(v.campaign));
    case 'slot.put':
      return typeof v.slotId === 'string' && isRecord(v.slot) && (v.origin === 'player' || v.origin === 'conflict');
    case 'slot.delete':
      return typeof v.slotId === 'string';
    default:
      return false;
  }
}

/**
 * A tab's stored outbox (R13): `{ publicId, ops }`, so a sibling can tell whose work it is before adopting it. The
 * old bare array (written before owners existed) still reads, as UNOWNED: it is never adopted.
 */
interface Stored {
  publicId: string | null;
  ops: OutboxOp[];
  /** The campaign revision the queued campaign ops are sent on (R12): kept WITH the queue, so only this tab's own writes move it. */
  base: number | undefined;
}

function readStored(storage: StorageLike | null, tabId: string): Stored {
  try {
    const text = storage?.getItem(outboxKey(tabId));
    if (typeof text !== 'string') return { publicId: null, ops: [], base: undefined };
    const j: unknown = JSON.parse(text);
    if (Array.isArray(j)) return { publicId: null, ops: j.filter(validOp), base: undefined };
    if (isRecord(j) && Array.isArray(j.ops)) {
      const base = typeof j.base === 'number' && Number.isInteger(j.base) && j.base >= 0 ? j.base : undefined;
      return { publicId: typeof j.publicId === 'string' && j.publicId !== '' ? j.publicId : null, ops: j.ops.filter(validOp), base };
    }
    return { publicId: null, ops: [], base: undefined };
  } catch {
    return { publicId: null, ops: [], base: undefined };
  }
}

/** This tab's queued ops, oldest first. Anything unreadable reads as empty; a malformed op is dropped. */
export const readOutbox = (storage: StorageLike | null, tabId: string): OutboxOp[] => readStored(storage, tabId).ops;

/** This tab's persisted send base (R12), undefined when none is pinned. Only this tab writes it. */
export const readBase = (storage: StorageLike | null, tabId: string): number | undefined => readStored(storage, tabId).base;

/** The member a stored outbox belongs to; null for the old bare-array shape or an unreadable value. */
export const outboxOwner = (storage: StorageLike | null, tabId: string): string | null => readStored(storage, tabId).publicId;

/** Write this tab's outbox, stamped with its member and carrying its send base. False when storage refused (the caller keeps its memory copy). */
export function writeOutbox(storage: StorageLike | null, tabId: string, ops: readonly OutboxOp[], publicId: string, base?: number): boolean {
  try {
    if (!storage) return false;
    if (ops.length === 0) storage.removeItem(outboxKey(tabId));
    else storage.setItem(outboxKey(tabId), JSON.stringify(base === undefined ? { publicId, ops } : { publicId, ops, base }));
    return true;
  } catch {
    return false;
  }
}

/** Every tab id with an outbox key of any content (owned by `publicId` when given). */
export function outboxTabs(storage: StorageLike | null, publicId?: string): string[] {
  try {
    const s = storage as (StorageLike & { length?: unknown; key?: unknown }) | null;
    if (!s || typeof s.length !== 'number' || typeof s.key !== 'function') return [];
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = (s.key as (n: number) => string | null)(i);
      if (k === null || !k.startsWith(OUTBOX_PREFIX)) continue;
      const tabId = k.slice(OUTBOX_PREFIX.length);
      if (publicId === undefined || outboxOwner(storage, tabId) === publicId) out.push(tabId);
    }
    return out;
  } catch {
    return [];
  }
}

/** Remove a tab's outbox and heartbeat keys. Guarded. */
export function clearTab(storage: StorageLike | null, tabId: string): void {
  for (const k of [outboxKey(tabId), heartbeatKey(tabId)]) {
    try {
      storage?.removeItem(k);
    } catch {
      /* a refusing storage: nothing more to do */
    }
  }
}

const slotIdOf = (op: OutboxOp): string | null => (op.kind === 'slot.put' || op.kind === 'slot.delete' ? op.slotId : null);

/**
 * Queue `op` after `ops`, coalescing. A `campaign` op replaces the queued `campaign` op DIRECTLY before it when
 * that one has not been sent (`sent` is the sync loop's in-memory set of sent opIds, never stored), keeping the
 * newer opId; a victory between two campaign ops stops it. A `slot.put` replaces the latest queued op on the same
 * slot when that is an unsent `slot.put` (a delete in between would be reordered by anything else).
 */
export function coalesce(ops: readonly OutboxOp[], op: OutboxOp, sent: ReadonlySet<string> = new Set()): OutboxOp[] {
  const last = ops[ops.length - 1];
  if (op.kind === 'campaign' && last !== undefined && last.kind === 'campaign' && !sent.has(last.opId)) {
    return [...ops.slice(0, -1), op];
  }
  if (op.kind === 'slot.put') {
    for (let i = ops.length - 1; i >= 0; i--) {
      const prior = ops[i];
      if (prior === undefined || slotIdOf(prior) !== op.slotId) continue;
      if (prior.kind === 'slot.put' && !sent.has(prior.opId)) return [...ops.slice(0, i), op, ...ops.slice(i + 1)];
      break;
    }
  }
  return [...ops, op];
}

/** Append to THIS tab's key only (§0.38), coalescing. Returns the new queue even when the write was refused. */
export function appendOp(storage: StorageLike | null, tabId: string, op: OutboxOp, publicId: string, sent: ReadonlySet<string> = new Set()): OutboxOp[] {
  const next = coalesce(readOutbox(storage, tabId), op, sent);
  writeOutbox(storage, tabId, next, publicId, readBase(storage, tabId)); // the pinned send base travels with the queue
  return next;
}

/** Tab ids with a non-empty outbox whose heartbeat is over 60 s old (or missing). The caller skips its own tab. */
export function orphanedOutboxes(storage: StorageLike | null, now: number): string[] {
  try {
    const s = storage;
    if (!s) return [];
    const out: string[] = [];
    for (const tabId of outboxTabs(storage)) {
      if (readOutbox(storage, tabId).length === 0) continue;
      const beat = Number(s.getItem(heartbeatKey(tabId)));
      if (!Number.isFinite(beat) || s.getItem(heartbeatKey(tabId)) === null || now - beat > ORPHAN_AFTER_MS) out.push(tabId);
    }
    return out;
  } catch {
    return [];
  }
}
