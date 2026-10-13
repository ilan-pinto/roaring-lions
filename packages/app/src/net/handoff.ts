/**
 * The lobby's live transport, passed to the battlefield across a soft
 * navigation (N1b). The lobby hands it over at the room's `start`; the
 * battlefield's `connectMatch` takes it. In between nobody owns it but this
 * module, so it is held for a bounded time and then let go: a handoff nobody
 * took must not leave a socket open. Letting go is `detach` -- no `bye` --
 * so the room sees a gone seat rather than a player who left, which is the
 * honest account of a boot that never arrived.
 *
 * Module state, not a store on `window`: the lobby and the battlefield run
 * in one JS realm (the router), and a reload loses the transport anyway --
 * that path is the stored ticket's (`ticket-store.ts`).
 */
import type { MatchConfig, Seat, WsTransport } from '@lions/net';

export interface Handed { transport: WsTransport; seat: Seat; config: MatchConfig }

/** How long a handoff waits for the battlefield to take it. */
export const HANDOFF_EXPIRE_MS = 10_000;

interface Held { h: Handed; cancel: () => void }
const held = new Map<string, Held>();
const keyFor = (code: string): string => code.toUpperCase();

/** Held until taken, or until `expireMs` (default 10 s) passes, when it is
 *  dropped: a handoff nobody took must not leave a socket open. */
export function handOver(
  code: string,
  h: Handed,
  opts: { expireMs?: number; schedule?: (fn: () => void, ms: number) => unknown } = {},
): void {
  const key = keyFor(code);
  // A second handoff for one code replaces the first, which is let go rather than leaked.
  dropHanded(key);
  const entry: Held = { h, cancel: () => {} };
  // The expiry drops only the entry it was armed for: after a take, or a
  // newer handoff for the same code, it finds another entry (or none) and
  // does nothing. That holds for any `schedule`; the real timer is also
  // cleared, so a taken handoff leaves no timer behind.
  const expire = (): void => { if (held.get(key) === entry) dropHanded(key); };
  const ms = opts.expireMs ?? HANDOFF_EXPIRE_MS;
  if (opts.schedule) {
    opts.schedule(expire, ms);
  } else {
    const timer = setTimeout(expire, ms);
    entry.cancel = () => clearTimeout(timer);
  }
  held.set(key, entry);
}

/** One take only; cancels the expiry. */
export function takeHanded(code: string): Handed | null {
  const key = keyFor(code);
  const entry = held.get(key);
  if (entry === undefined) return null;
  held.delete(key);
  entry.cancel();
  return entry.h;
}

/** Detach and forget. */
export function dropHanded(code: string): void {
  const h = takeHanded(code);
  h?.transport.detach();
}
