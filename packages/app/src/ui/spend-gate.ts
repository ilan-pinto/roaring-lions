// What a signed-in player's server-backed controls look at before they draw (GH-1075 A2, §0.18, §0.39, GH-1142).
//
// Coin Buys, coupons and the brigade reset are server calls that wait for the sync loop's barrier (an empty outbox and a
// connection). The screens only READ this gate when they draw; they own no state about the server. A guest's screens
// never get one, so a guest's controls draw and answer exactly as before.
import { t } from '../i18n/t';

/** `ok`: the barrier would open. `offline`: no connection. `syncing`: the outbox still holds an op. */
export type NetState = 'ok' | 'offline' | 'syncing';

/**
 * Why a credit Buy cannot be pressed although the player could afford it:
 *  - `pendingCoin`: a coin Buy of the same track (or, for a unit unlock, the same unit) is in flight (GH-1142). The
 *    credit Buy would be priced against a tier the server may be about to move;
 *  - `pending`: a coupon or a reset is in flight. Both write the campaign, and a credit Buy now would be overwritten by
 *    (or overwrite) the server's answer (§0.39).
 */
export type CreditBlock = 'pendingCoin' | 'pending';

export interface SpendGate {
  /** Keys `unitId.track` and `unit:<id>` of coin Buys in flight. */
  pendingTracks: () => ReadonlySet<string>;
  /** A campaign-writing barrier (coupon, reset-free) is in flight. */
  campaignFrozen: () => boolean;
  net: () => NetState;
  /** Told when any of the above may have changed; returns the unsubscribe. */
  subscribe?: (cb: () => void) => () => void;
}

/** The pending-key a credit Buy of `track` (or of the unit, when `track` is null) must wait for, or null. */
export function creditBlock(
  unitId: string,
  track: string | null,
  pending: ReadonlySet<string> | undefined,
  frozen: boolean
): CreditBlock | null {
  if (frozen) return 'pending';
  if (pending === undefined) return null;
  if (track !== null ? pending.has(`${unitId}.${track}`) : pending.has(`unit:${unitId}`)) return 'pendingCoin';
  return null;
}

/** The player-facing reason for a block. */
export function blockText(b: CreditBlock): string {
  return t(b === 'pendingCoin' ? 'stores.pendingCoin' : 'stores.pending');
}

/** The reason a server control is off for the connection or the outbox, or null when it is not. */
export function netText(n: NetState): string | null {
  return n === 'offline' ? t('stores.offlineNow') : n === 'syncing' ? t('stores.syncing') : null;
}
