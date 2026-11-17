/**
 * The player's local block list (GH-1417 S3, the lead's D5): MEMBERS only, by public id. A blocked member's chat lines are never drawn
 * again, in this room or any later one, on this browser. A guest cannot be blocked across matches (a guest's seat token changes every
 * match, so there is nothing to recognise): a guest is muted for the rest of the room instead (`chat-inbox.ts`).
 *
 * Local and private by design: the list never leaves this device (no account sync, no request), and the other player is not told.
 * This module is the ONLY reader and writer of `lions.chat.blocked` (`chat-inbox-guard.test.ts` pins that). Storage is reached through
 * `safeStorage`, so with site data blocked the list lives for the session and nothing throws.
 */
import { safeStorage, type StorageLike } from '../telemetry/identity';

export const BLOCK_KEY = 'lions.chat.blocked';
/** Oldest entries fall off past this, so the key can never grow without bound. */
export const BLOCK_MAX = 200;
/** A member's public id: 8 Crockford characters (`SeatMember.publicId`). Anything else in storage is dropped on read. */
export const PUBLIC_ID = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export interface BlockList {
  has(publicId: string): boolean;
  /** Adds the id; false when it is not a public id (nothing is stored). */
  add(publicId: string): boolean;
  remove(publicId: string): void;
  all(): string[];
  /** Calls `fn` when the list changes; returns the unsubscribe. */
  onChange(fn: () => void): () => void;
}

function read(storage: StorageLike | null): string[] {
  if (storage === null) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(BLOCK_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const v of parsed) if (typeof v === 'string' && PUBLIC_ID.test(v) && !out.includes(v)) out.push(v);
  return out.slice(-BLOCK_MAX);
}

export function createBlockList(storage: StorageLike | null): BlockList {
  let ids = read(storage);
  const listeners = new Set<() => void>();
  const commit = (): void => {
    try {
      storage?.setItem(BLOCK_KEY, JSON.stringify(ids));
    } catch {
      /* refused: the list holds for this session */
    }
    for (const fn of [...listeners]) fn();
  };
  return {
    has: (id) => ids.includes(id),
    add: (id) => {
      if (!PUBLIC_ID.test(id)) return false;
      if (ids.includes(id)) return true;
      ids = [...ids, id].slice(-BLOCK_MAX);
      commit();
      return true;
    },
    remove: (id) => {
      if (!ids.includes(id)) return;
      ids = ids.filter((x) => x !== id);
      commit();
    },
    all: () => [...ids],
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

let shared: BlockList | null = null;
/** The browser's one list, shared by the lobby and the match so a block made in one holds in the other. */
export function browserBlockList(): BlockList {
  shared ??= createBlockList(safeStorage(() => window.localStorage));
  return shared;
}
