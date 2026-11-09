/** The device's copy of the server's answer (GH-1075 A2): `confirmed` is what the server last said, `bodies` the slot bodies fetched so far. */
import type { SaveSlot, ServerState } from '@lions/economy';
import type { StorageLike } from '../brigade-account';

export const ACCOUNT_CACHE_KEY = 'lions.account.cache';

export interface AccountCache {
  version: 1;
  publicId: string;
  confirmed: ServerState;
  bodies: Record<string, SaveSlot>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Guarded; anything malformed reads as null. */
export function readCache(storage: StorageLike | null): AccountCache | null {
  try {
    const text = storage?.getItem(ACCOUNT_CACHE_KEY);
    if (typeof text !== 'string') return null;
    const j: unknown = JSON.parse(text);
    if (!isRecord(j) || j.version !== 1 || typeof j.publicId !== 'string' || j.publicId === '' || !isRecord(j.confirmed) || !isRecord(j.bodies)) return null;
    const c = j.confirmed;
    if (!isRecord(c.wallet) || !Array.isArray(c.slots) || !(c.campaign === null || isRecord(c.campaign))) return null;
    return j as unknown as AccountCache;
  } catch {
    return null;
  }
}

/** Guarded. False when storage refused: the caller keeps its memory copy. */
export function writeCache(storage: StorageLike | null, cache: AccountCache): boolean {
  try {
    if (!storage) return false;
    storage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}
