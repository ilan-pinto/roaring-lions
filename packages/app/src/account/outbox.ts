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

/** This tab's queued ops, oldest first. Anything unreadable reads as empty; a malformed op is dropped. */
export function readOutbox(storage: StorageLike | null, tabId: string): OutboxOp[] {
  try {
    const text = storage?.getItem(outboxKey(tabId));
    if (typeof text !== 'string') return [];
    const j: unknown = JSON.parse(text);
    return Array.isArray(j) ? j.filter(validOp) : [];
  } catch {
    return [];
  }
}

/** Write this tab's outbox. False when storage refused (the caller keeps its memory copy). */
export function writeOutbox(storage: StorageLike | null, tabId: string, ops: readonly OutboxOp[]): boolean {
  try {
    if (!storage) return false;
    if (ops.length === 0) storage.removeItem(outboxKey(tabId));
    else storage.setItem(outboxKey(tabId), JSON.stringify(ops));
    return true;
  } catch {
    return false;
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
export function appendOp(storage: StorageLike | null, tabId: string, op: OutboxOp, sent: ReadonlySet<string> = new Set()): OutboxOp[] {
  const next = coalesce(readOutbox(storage, tabId), op, sent);
  writeOutbox(storage, tabId, next);
  return next;
}

/** Tab ids with a non-empty outbox whose heartbeat is over 60 s old (or missing). The caller skips its own tab. */
export function orphanedOutboxes(storage: StorageLike | null, now: number): string[] {
  try {
    const s = storage as (StorageLike & { length?: unknown; key?: unknown }) | null;
    if (!s || typeof s.length !== 'number' || typeof s.key !== 'function') return [];
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = (s.key as (n: number) => string | null)(i);
      if (k !== null && k.startsWith(OUTBOX_PREFIX)) keys.push(k);
    }
    const out: string[] = [];
    for (const k of keys) {
      const tabId = k.slice(OUTBOX_PREFIX.length);
      if (readOutbox(storage, tabId).length === 0) continue;
      const beat = Number(s.getItem(heartbeatKey(tabId)));
      if (!Number.isFinite(beat) || s.getItem(heartbeatKey(tabId)) === null || now - beat > ORPHAN_AFTER_MS) out.push(tabId);
    }
    return out;
  } catch {
    return [];
  }
}
