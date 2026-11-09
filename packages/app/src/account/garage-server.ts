/**
 * Which kind of Garage a device has, and the server-backed handlers for it (GH-1075 A2, Task 2.12 fix round 2). The mode comes
 * from the STORE, never from whether a spend flow happens to exist:
 *  - `guest`: a local store; the synchronous path, unchanged;
 *  - `flow`: an account store with a spend flow; coin Buys, coupons and the reset are server calls;
 *  - `offline`: an account store with NO flow (a signed-in device whose client module would not load, running from its cache).
 *    The server controls are drawn disabled with `stores.offlineNow` (R22) and NO handler may touch the wallet: `writeRoar`
 *    and `resetAccount` throw `ServerCoinsError` on an account store. Credit Buys are campaign ops that queue, so they work.
 */
import type { CoinAsk } from '@lions/economy';
import type { LedgerStore } from '../ledger-store';
import type { RedeemAnswer } from '../ui/brigade';
import type { SpendGate } from '../ui/spend-gate';
import { isAccountStore } from './account-store';
import type { SpendFlow } from './spend-flow';

export type GarageServerMode = { mode: 'guest' } | { mode: 'flow'; flow: SpendFlow } | { mode: 'offline' };

export function garageServerMode(store: LedgerStore, flow: SpendFlow | null): GarageServerMode {
  if (flow !== null) return { mode: 'flow', flow };
  return isAccountStore(store) ? { mode: 'offline' } : { mode: 'guest' };
}

/** A gate whose connection is permanently down: every server control reads `stores.offlineNow`; credit Buys are not blocked. */
export const offlineGate: SpendGate = {
  pendingTracks: () => new Set<string>(),
  campaignFrozen: () => false,
  net: () => 'offline',
};

type Maybe<T> = T | Promise<T>;
/** The three server-backed Garage handlers, over the garage state `S`. */
export interface ServerHandlers<S> {
  buy: (ask: CoinAsk) => Maybe<S>;
  reset: () => Maybe<S>;
  redeem: (code: string) => Maybe<RedeemAnswer>;
}

export interface ServerControls<S> {
  handlers: ServerHandlers<S>;
  /** Passed to the Garage and the Stores; absent for a guest, whose controls never wait on a server. */
  gate?: SpendGate;
}

/**
 * Picks the handlers for the device. `guest` and `flow` are built by the caller (they own the local buy and the flow calls);
 * `offline` is built here and touches nothing: it answers the account as it stands.
 */
export function serverControls<S extends RedeemAnswer['state']>(
  m: GarageServerMode,
  now: () => S,
  make: { guest: () => ServerHandlers<S>; flow: (flow: SpendFlow) => ServerHandlers<S> }
): ServerControls<S> {
  if (m.mode === 'guest') return { handlers: make.guest() };
  if (m.mode === 'flow') return { handlers: make.flow(m.flow), gate: m.flow.gate };
  return {
    handlers: { buy: () => now(), reset: () => now(), redeem: () => ({ state: now(), result: 'failed', credits: 0, coins: 0 }) },
    gate: offlineGate,
  };
}
