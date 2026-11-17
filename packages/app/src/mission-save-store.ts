/**
 * The one reader and writer of the suspended mission's storage key (GH-1393 slice 2; design section 5). Nothing else in the app names
 * `lions.mission.suspend`: `mission-save-store.test.ts` scans the source tree for it, so a second reader or writer is a red test.
 * `lions.saves` (the campaign slots, synced to the account) is not touched: a mission snapshot is build-bound, large and device-local.
 *
 * Every access is guarded, because with site data blocked the PROPERTY read (the browser's storage accessor) is what throws. A write is
 * never swallowed: it is read back and compared before it is called saved, and a failure puts the previous record back, so a refusal
 * (quota, a private window) cannot cost the player the save they already had. The caller shows the refusal and does not quit.
 *
 * Pure of the DOM: the storage is a parameter (`openSuspendStore` takes the accessor; the shell passes the browser's local storage).
 */
import { parseSuspended, serializeSuspended, type ParseOptions, type ResumeRefusal, type SuspendedMission } from './mission-save';

export const SUSPEND_KEY = 'lions.mission.suspend';

/** The slice of Web Storage this module uses. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The storage, or null when the browser will not give it (the access itself throws, or it is not a storage). */
export function openSuspendStore(get: () => unknown): KeyStore | null {
  let s: unknown;
  try {
    s = get();
  } catch {
    return null;
  }
  const k = s as Partial<KeyStore> | null;
  if (k === null || typeof k !== 'object' || typeof k.getItem !== 'function' || typeof k.setItem !== 'function' || typeof k.removeItem !== 'function') return null;
  return k as KeyStore;
}

export type WriteResult =
  | { ok: true; bytes: number }
  /** No storage at all (site data blocked). */
  | { ok: false; reason: 'no_storage' }
  /** The browser threw on the write (quota, a private window). */
  | { ok: false; reason: 'refused' }
  /** The write returned but reading it back gave something else. */
  | { ok: false; reason: 'unverified' };

/** Puts the previous record (or none) back after a failed write. Best effort: the failure being reported is the first one. */
function restore(store: KeyStore, previous: string | null): void {
  try {
    if (previous === null) store.removeItem(SUSPEND_KEY);
    else store.setItem(SUSPEND_KEY, previous);
  } catch {
    /* the original failure is what the caller reports */
  }
}

/**
 * Writes `record`, reads it back and compares. Returns `ok` only when storage hands back exactly what was written; otherwise the previous
 * record is restored and the reason says which way it failed.
 */
export function writeSuspended(store: KeyStore | null, record: SuspendedMission): WriteResult {
  if (store === null) return { ok: false, reason: 'no_storage' };
  const text = serializeSuspended(record);
  let previous: string | null;
  try {
    previous = store.getItem(SUSPEND_KEY);
  } catch {
    previous = null;
  }
  try {
    store.setItem(SUSPEND_KEY, text);
  } catch {
    restore(store, previous);
    return { ok: false, reason: 'refused' };
  }
  let back: string | null;
  try {
    back = store.getItem(SUSPEND_KEY);
  } catch {
    back = null;
  }
  if (back !== text) {
    restore(store, previous);
    return { ok: false, reason: 'unverified' };
  }
  return { ok: true, bytes: text.length };
}

export type ReadResult =
  | { state: 'none' }
  /** The browser would not give the key at all; no card is drawn and nothing is claimed. */
  | { state: 'unavailable' }
  | { state: 'ready'; record: SuspendedMission }
  /** A record is there and will not be loaded. It is kept: the player decides to discard it. */
  | { state: 'refused'; reason: ResumeRefusal };

/** What is stored, checked as far as it can be without a world (`parseSuspended`). Never deletes. */
export function readSuspended(store: KeyStore | null, o: ParseOptions = {}): ReadResult {
  if (store === null) return { state: 'unavailable' };
  let text: string | null;
  try {
    text = store.getItem(SUSPEND_KEY);
  } catch {
    return { state: 'unavailable' };
  }
  if (text === null) return { state: 'none' };
  const p = parseSuspended(text, o);
  return p.ok ? { state: 'ready', record: p.record } : { state: 'refused', reason: p.reason };
}

/**
 * The mission whose save is stored now, when it is NOT `missionId` (GH-1393 follow-up): the one save slot would be replaced by a Save for
 * `missionId`, and the pause menu asks first. Null when the slot is empty, unreadable, unavailable, refused (a save that cannot load is
 * not worth a warning: Discard on the card is its own door) or this mission's own (a re-save is an ordinary checkpoint).
 */
export function savedMissionOtherThan(store: KeyStore | null, missionId: string, o: ParseOptions = {}): string | null {
  const r = readSuspended(store, o);
  return r.state === 'ready' && r.record.missionId !== missionId ? r.record.missionId : null;
}

/** Removes the record. False when the browser refused, so the caller can say so instead of showing a card that is still there. */
/**
 * The mission whose save is stored now, when it is NOT `missionId` (GH-1393 follow-up): the one save slot would be replaced by a Save for
 * `missionId`, and the pause menu asks first. Null when the slot is empty, unreadable, unavailable, refused (a save that cannot load is
 * not worth a warning: Discard on the card is its own door) or this mission's own (a re-save is an ordinary checkpoint).
 */
export function savedMissionOtherThan(store: KeyStore | null, missionId: string, o: ParseOptions = {}): string | null {
  const r = readSuspended(store, o);
  return r.state === 'ready' && r.record.missionId !== missionId ? r.record.missionId : null;
}

export function discardSuspended(store: KeyStore | null): boolean {
  if (store === null) return false;
  try {
    store.removeItem(SUSPEND_KEY);
    return store.getItem(SUSPEND_KEY) === null;
  } catch {
    return false;
  }
}
