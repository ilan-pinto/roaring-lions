/**
 * The legacy owner's one-time choice (GH-1384 §4.2, §4.3; the lead's Q8, Q11 and R12), for a
 * GUEST, whose account and wallet live on one device. A store that held a branched tier before
 * branching holds pick 1 and a legacy marker (`settleAccountPicks`, `settleEntitlement`). While a
 * marker stands the player may take ONE of two actions, once, since either clears it:
 *
 *   - **Switch, free**: move to the other branch. It acts on EVERY store that holds the branched
 *     tier, in one write, and is offered only when every such store holds a marker: on a mix of
 *     legacy and fresh it is withheld (Q11), since it would split the picks.
 *   - **Return**: every store holding a LEGACY marker drops the track to the tier below and is
 *     refunded in full in its own currency, all at once. A store holding a FRESH branch buy is never
 *     refunded and keeps its tier and its pick (R12): a fresh buy is final (Q2), so a refund and a
 *     rebuy can never be a respec.
 *
 * Refunds are priced from DATA when taken, never from the store (the marker holds no number):
 * credits get the branched tier's `price` from the unit's JSON (the full tier-3 price the player
 * paid: the lead kept it, Q1); coins get the newest `tier` receipt's exact `CoinSplit` for that
 * (unit, track, tier), or `coinPrice(price)` as free coins when the receipt was pruned. A credit
 * refund adds back only what was spent, so the balance stays inside `migrateAccount`'s grants
 * bound; `earned_total` and `grants` do not move (G3: a refund is a spend reversed).
 *
 * A MEMBER's coin Return is a server route journalled as a `tier` row with `detail.refund: true`
 * (the lead, Q4). That route is not built here: `returnLegacy` is the guest's, and nothing in the
 * app calls either function until the Garage's fork ships.
 */
import type { BrigadeAccount } from './brigade';
import { shippedBranched, type BranchedTable, type BranchPick } from './branches';
import { coinPrice } from './stores';
import { MAX_COINS, RECEIPT_CAP, type CoinSplit, type RoarReceipt, type RoarWallet, type TrackEntitlement } from './wallet';

/** What a (unit, track) offers its legacy owner. */
export interface LegacyOffer {
  /** Which stores hold the branched tier. */
  readonly holds: { readonly account: boolean; readonly coins: boolean };
  /** Which of those hold a legacy marker. */
  readonly legacy: { readonly account: boolean; readonly coins: boolean };
  readonly canSwitch: boolean;
  readonly canReturn: boolean;
}

const NONE: LegacyOffer = { holds: { account: false, coins: false }, legacy: { account: false, coins: false }, canSwitch: false, canReturn: false };

export function legacyOffer(
  account: BrigadeAccount,
  roar: RoarWallet,
  unitId: string,
  track: string,
  branched: BranchedTable = shippedBranched()
): LegacyOffer {
  const fork = branched[unitId]?.[track];
  if (fork === undefined) return NONE;
  const coin = roar.entitlements.upgrades[unitId]?.[track];
  const holds = { account: (account.upgrades[unitId]?.[track] ?? 0) >= fork.tier, coins: (coin?.tier ?? 0) >= fork.tier };
  const legacy = {
    account: holds.account && account.legacy[unitId]?.[track] === true,
    coins: holds.coins && coin?.legacy === true,
  };
  const anyHeld = holds.account || holds.coins;
  const canSwitch = anyHeld && (!holds.account || legacy.account) && (!holds.coins || legacy.coins);
  return { holds, legacy, canSwitch, canReturn: legacy.account || legacy.coins };
}

type Pair = { account: BrigadeAccount; roar: RoarWallet; ok: boolean };

function withoutTrack<V>(m: Readonly<Record<string, Readonly<Record<string, V>>>>, unitId: string, track: string): Record<string, Record<string, V>> {
  const out: Record<string, Record<string, V>> = { ...(m as Record<string, Record<string, V>>) };
  const row = { ...(out[unitId] ?? {}) };
  delete row[track];
  if (Object.keys(row).length === 0) delete out[unitId];
  else out[unitId] = row;
  return out;
}

/**
 * Switch, free: every store holding the branched tier moves to the other branch and loses its
 * marker, in ONE returned pair (the caller writes both, all or none). Refused -- both back by
 * identity -- unless `legacyOffer(...).canSwitch`. The branch moved FROM is the view's (earned wins).
 */
export function switchLegacy(
  account: BrigadeAccount,
  roar: RoarWallet,
  unitId: string,
  track: string,
  branched: BranchedTable = shippedBranched()
): Pair {
  const offer = legacyOffer(account, roar, unitId, track, branched);
  if (!offer.canSwitch) return { account, roar, ok: false };
  const coin = roar.entitlements.upgrades[unitId]?.[track];
  const from: BranchPick = (offer.holds.account ? account.picks[unitId]?.[track] : coin?.branch) ?? 1;
  const to: BranchPick = from === 1 ? 2 : 1;
  let a = account;
  let w = roar;
  if (offer.holds.account) {
    a = {
      ...account,
      picks: { ...account.picks, [unitId]: { ...(account.picks[unitId] ?? {}), [track]: to } },
      legacy: withoutTrack(account.legacy, unitId, track),
    };
  }
  if (offer.holds.coins && coin !== undefined) {
    const { legacy: _gone, ...rest } = coin;
    void _gone;
    const e: TrackEntitlement = { ...rest, branch: to };
    w = { ...roar, entitlements: { ...roar.entitlements, upgrades: { ...roar.entitlements.upgrades, [unitId]: { ...roar.entitlements.upgrades[unitId], [track]: e } } } };
  }
  return { account: a, roar: w, ok: true };
}

/** The newest `tier` purchase receipt (not a refund) for (unit, track, tier). */
function purchaseReceipt(roar: RoarWallet, unitId: string, track: string, tier: number): Extract<RoarReceipt, { kind: 'tier' }> | undefined {
  for (let i = roar.receipts.length - 1; i >= 0; i--) {
    const r = roar.receipts[i];
    if (r.kind === 'tier' && r.refund !== true && r.unitId === unitId && r.track === track && r.tier === tier) return r;
  }
  return undefined;
}

/**
 * Return: every store holding a LEGACY marker on (unit, track) drops to the tier below the branched
 * one and is refunded in full, in its own currency, in ONE returned pair; a store holding a fresh
 * branch buy is left exactly as it was (R12). Refused -- both back by identity -- unless
 * `legacyOffer(...).canReturn`. `refund` reports what was paid back, for the caller's notice.
 */
export function returnLegacy(
  account: BrigadeAccount,
  roar: RoarWallet,
  unitId: string,
  track: string,
  at: number,
  branched: BranchedTable = shippedBranched()
): Pair & { refund: { credits: number; coins: CoinSplit } } {
  const offer = legacyOffer(account, roar, unitId, track, branched);
  const fork = branched[unitId]?.[track];
  if (!offer.canReturn || fork === undefined) return { account, roar, ok: false, refund: { credits: 0, coins: { free: 0, paid: 0 } } };
  const below = fork.tier - 1;
  let a = account;
  let w = roar;
  let credits = 0;
  let coins: CoinSplit = { free: 0, paid: 0 };
  if (offer.legacy.account) {
    credits = fork.price;
    a = {
      ...account,
      balance: account.balance + credits,
      upgrades: { ...account.upgrades, [unitId]: { ...(account.upgrades[unitId] ?? {}), [track]: below } },
      picks: withoutTrack(account.picks, unitId, track),
      legacy: withoutTrack(account.legacy, unitId, track),
    };
  }
  const coin = roar.entitlements.upgrades[unitId]?.[track];
  if (offer.legacy.coins && coin !== undefined) {
    const receipt = purchaseReceipt(roar, unitId, track, fork.tier);
    const split: CoinSplit = receipt !== undefined ? { ...receipt.coins } : { free: coinPrice(fork.price), paid: 0 };
    const free = Math.min(roar.coins.free + split.free, MAX_COINS);
    const paid = Math.min(roar.coins.paid + split.paid, MAX_COINS);
    coins = { free: free - roar.coins.free, paid: paid - roar.coins.paid };
    const paidTiers = Math.max(0, Math.min(coin.paidTiers - (split.paid > 0 ? 1 : 0), below));
    const e: TrackEntitlement = { tier: below, paidTiers };
    const refundReceipt: RoarReceipt = {
      kind: 'tier',
      id: `${at}-${roar.receipts.length + 1}`,
      at,
      coins,
      unitId,
      track,
      tier: fork.tier,
      credits: fork.price,
      refund: true,
    };
    const all = [...roar.receipts, refundReceipt];
    w = {
      ...roar,
      coins: { free, paid },
      entitlements: { ...roar.entitlements, upgrades: { ...roar.entitlements.upgrades, [unitId]: { ...roar.entitlements.upgrades[unitId], [track]: e } } },
      receipts: all.length > RECEIPT_CAP ? all.slice(all.length - RECEIPT_CAP) : all,
    };
  }
  return { account: a, roar: w, ok: true, refund: { credits, coins } };
}
