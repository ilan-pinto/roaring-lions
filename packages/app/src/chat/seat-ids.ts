/**
 * Who sat where, kept across a reload in the middle of a match (GH-1417 S3, review item 3). The lobby hands the match its seat labels
 * (`net/handoff.ts`), and those are IN MEMORY: after a reload the match reconnects from its stored ticket with no labels, so every seat's
 * member public id read as null and a block stopped holding (the Block button vanished and the blocked member's lines were drawn again).
 *
 * So the ids are written the first time the match has labels and read back when it has none. They live in `sessionStorage`, per tab, keyed
 * by the room code, and only the LAST room is kept: a reload is the same tab and the same room, and nothing here outlives the tab.
 * A member's public id is already shown on the seat card to the other player; a guest has none, and none is stored for them.
 * This module is the only reader and writer of `lions.chat.seatids`.
 */
import { safeStorage, type StorageLike } from '../telemetry/identity';
import { PUBLIC_ID } from './block-list';

export const SEAT_IDS_KEY = 'lions.chat.seatids';
export type SeatIds = [string | null, string | null];

const clean = (v: unknown): string | null => (typeof v === 'string' && PUBLIC_ID.test(v) ? v : null);

/**
 * The public id of each seat for room `code`. With `labels` (the lobby's, present on a fresh start) they are the answer and are stored;
 * without them (a reload) the stored ids for the SAME room code are the answer, and another room's are ignored.
 */
export function seatIdsFor(
  storage: StorageLike | null,
  code: string,
  labels: readonly ({ publicId: string | null } | null)[] | undefined,
): SeatIds {
  if (labels !== undefined) {
    const ids: SeatIds = [clean(labels[0]?.publicId), clean(labels[1]?.publicId)];
    try {
      storage?.setItem(SEAT_IDS_KEY, JSON.stringify({ code, ids }));
    } catch {
      /* refused: the ids live for this page load */
    }
    return ids;
  }
  if (storage === null) return [null, null];
  try {
    const raw = storage.getItem(SEAT_IDS_KEY);
    if (raw === null) return [null, null];
    const v = JSON.parse(raw) as { code?: unknown; ids?: unknown };
    if (v.code !== code || !Array.isArray(v.ids)) return [null, null];
    return [clean(v.ids[0]), clean(v.ids[1])];
  } catch {
    return [null, null];
  }
}

/** The tab's own store: `sessionStorage` through the same guard as every other store. */
export const browserSeatIds = (code: string, labels: Parameters<typeof seatIdsFor>[2]): SeatIds =>
  seatIdsFor(safeStorage(() => window.sessionStorage), code, labels);
