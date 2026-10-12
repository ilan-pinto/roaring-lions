/**
 * A seat's ticket, kept for the tab that holds the seat (N1b, R-B6), so a
 * reload of the battlefield rejoins its own seat instead of asking the room
 * for a new one -- which a full room answers 409. The caller passes
 * `sessionStorage`: a ticket is a seat in ONE tab's match, and a second tab
 * opening the same link must join as the other seat, not take this one.
 * (A DUPLICATED tab copies sessionStorage, so it does take this seat; the
 * room replaces the first socket, which is its existing path for two
 * sockets on one ticket.)
 *
 * `StorageLike` has no `removeItem`, so forgetting writes ''.
 */
import type { Seat } from '@lions/net';
import type { StorageLike } from '../telemetry/identity';

export interface StoredSeat { ticket: string; seat: Seat }

/** Room codes are upper case; a code typed in lower case is the same room. */
const keyFor = (code: string): string => `lions.versus.seat.${code.toUpperCase()}`;

export function saveSeat(store: StorageLike | null, code: string, s: StoredSeat): void {
  store?.setItem(keyFor(code), JSON.stringify({ ticket: s.ticket, seat: s.seat }));
}

/** The stored seat for `code`, or null: none stored, forgotten, or a value
 *  that is not one this module wrote. */
export function loadSeat(store: StorageLike | null, code: string): StoredSeat | null {
  const raw = store?.getItem(keyFor(code));
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (typeof v !== 'object' || v === null) return null;
  const { ticket, seat } = v as { ticket?: unknown; seat?: unknown };
  if (typeof ticket !== 'string' || ticket === '' || (seat !== 0 && seat !== 1)) return null;
  return { ticket, seat };
}

export function forgetSeat(store: StorageLike | null, code: string): void {
  store?.setItem(keyFor(code), '');
}
