/**
 * The one hand-off an OFFLINE match needs (GH-1388): the lobby arms a computer-seat match here, the battlefield's `connectMatch` takes it.
 * Module state in one JS realm, like `handoff.ts`; a reload loses it, and `connectMatch` then says the match is gone
 * (`OfflineMatchGone`) instead of asking a server for a room that never existed.
 *
 * Small on purpose: this file is in the main chunk (`connect.ts` and `main.ts` import it), while the computer seat itself (the view, the
 * fog, the desk, the script) is loaded only when the player asks for it (`offline-match.ts`, a dynamic import from `main.ts`).
 */
import type { MatchTransport } from '@lions/net';
import type { Connected } from './connect';
import type { MatchWorld } from './match-world';

/**
 * The `?net=` value of an offline match. A real room code is exactly six characters from an alphabet with no `-`
 * (`filterCode`, `mintCode`), so this value can never be one.
 */
export const OFFLINE_CODE = 'OFFLINE';

export const isOfflineCode = (net: string): boolean => net.toUpperCase() === OFFLINE_CODE;

/** An offline match's URL was opened with nothing armed for it: a reload, a bookmark, a second tab. */
export class OfflineMatchGone extends Error {
  constructor() {
    super('an offline match cannot be reopened; start a new one');
    this.name = 'OfflineMatchGone';
  }
}

/** What the battlefield asks of an offline transport once its world exists. */
export interface OfflineHandle {
  readonly offline: true;
  /** Gives the computer seat the world it will read, through the public view only. Called once, before the first tick. */
  attach(world: MatchWorld): void;
}

export function isOfflineTransport(t: MatchTransport): t is MatchTransport & OfflineHandle {
  return (t as Partial<OfflineHandle>).offline === true;
}

let armed: Connected | null = null;

/** Arms an offline match for the next `connectMatch`. A second arm replaces the first, which is closed. */
export function armOffline(c: Connected): void {
  armed?.transport.close();
  armed = c;
}

/** One take; leaves nothing behind. */
export function takeOffline(): Connected | null {
  const c = armed;
  armed = null;
  return c;
}

/** Closes and forgets an armed match nobody took (the lobby was left first). */
export function dropOffline(): void {
  armed?.transport.close();
  armed = null;
}
