/**
 * `lions.account.local` (GH-1075 A2): work this device holds that the server did not take, kept verbatim so nothing
 * is ever lost silently (a conflict with every system slot full, a refused or wedged op, a sign-out that could not
 * send). Every access is guarded: with site data blocked the property access itself throws.
 */
import type { StorageLike } from '../brigade-account';

export const HELD_KEY = 'lions.account.local';

export interface HeldItem {
  id: string;
  kind: 'campaign' | 'slot';
  reason: 'cap' | 'size' | 'invalid' | 'held' | 'refused';
  /** The held content, verbatim: for `held` a campaign body's JSON; for `refused`/`cap` the WHOLE op's JSON, so nothing about it is lost. */
  text: string;
  at: number;
  publicId: string;
  /** The digest the server must answer for this item to be uploaded as a `conflict` slot (see `sync.ts`). Set by the sync loop. */
  digest?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const REASONS: readonly string[] = ['cap', 'size', 'invalid', 'held', 'refused'];

function valid(v: unknown): v is HeldItem {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    (v.kind === 'campaign' || v.kind === 'slot') &&
    typeof v.reason === 'string' &&
    REASONS.includes(v.reason) &&
    typeof v.text === 'string' &&
    typeof v.at === 'number' &&
    typeof v.publicId === 'string' &&
    (v.digest === undefined || typeof v.digest === 'string')
  );
}

/** Oldest first. Anything unreadable reads as empty; a malformed entry is skipped. */
export function readHeld(storage: StorageLike | null): HeldItem[] {
  try {
    const text = storage?.getItem(HELD_KEY);
    if (typeof text !== 'string') return [];
    const j: unknown = JSON.parse(text);
    return Array.isArray(j) ? j.filter(valid) : [];
  } catch {
    return [];
  }
}

function write(storage: StorageLike | null, items: readonly HeldItem[]): boolean {
  try {
    if (!storage) return false;
    if (items.length === 0) storage.removeItem(HELD_KEY);
    else storage.setItem(HELD_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

/** Add (or, for an id already held, replace) an item. False when storage refused: the caller must then keep what it holds. */
export function addHeld(storage: StorageLike | null, item: HeldItem): boolean {
  const items = readHeld(storage);
  const at = items.findIndex((h) => h.id === item.id);
  if (at >= 0) items[at] = item;
  else items.push(item);
  return write(storage, items);
}

/**
 * Remove an item, but only when `digest` is the one it was stored with: an upload whose answer does not match
 * its own digest leaves the item where it is. True when removed.
 */
export function removeHeld(storage: StorageLike | null, id: string, digest: string): boolean {
  const items = readHeld(storage);
  const item = items.find((h) => h.id === id);
  if (item === undefined || item.digest === undefined || item.digest !== digest) return false;
  return write(
    storage,
    items.filter((h) => h.id !== id),
  );
}
