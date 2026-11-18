/**
 * Branched upgrade tiers in the two stores (GH-1384 slice 1; design
 * `docs/superpowers/specs/2026-11-17-branched-upgrade-tiers-design.md` §4). A track's last tier may
 * carry two branches sharing its price, and a store that holds that tier holds exactly ONE of them:
 * the account's `picks[unit][track]`, the wallet entitlement's `branch`. Everything is keyed by
 * (unit, track), never by unit or by track alone, so a unit with two branched tracks (the lead, Q3)
 * needs no new field.
 *
 * The migration (`settleAccountPicks`, `settleWalletPicks`, run inside `migrateAccount` and
 * `migrateRoar` on every read, and after every buy) is the only writer of a LEGACY marker:
 *
 *   - a store that holds a branched tier with NO pick (an account or a wallet from before branching,
 *     whose old linear tier 3 was the envelope of the two branches, so it owned BOTH) gets pick 1
 *     (the lead, Q8) and a `legacy` marker that carries no number (§4.2: the refund is priced from
 *     data when it is taken, never from the store);
 *   - a store below the branched tier holds no pick and no marker (a pick leaves with its tier);
 *   - a pick or marker for a track that is not branched is dropped.
 *
 * Pure: no storage, no clock. The table is a parameter defaulting to the shipped roster's, so a test
 * runs the same functions on inline fixtures the shipped table cannot see.
 */
import { branchedTable, units, type BranchedTable, type BranchPick } from '@lions/data';

export type { BranchedTable, BranchPick };

/** Unit -> track -> branch. A store's or a view's picks. */
export type PicksMap = Record<string, Record<string, BranchPick>>;
/** Unit -> track -> `true`: the store's tier on that branched track predates branching (§4.2). */
export type LegacyMap = Record<string, Record<string, true>>;

let shipped: BranchedTable | undefined;
/** The shipped roster's branched tracks (built once, on first use). */
export function shippedBranched(): BranchedTable {
  shipped ??= branchedTable(Object.values(units) as Parameters<typeof branchedTable>[0]);
  return shipped;
}

export const isPick = (v: unknown): v is BranchPick => v === 1 || v === 2;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A raw `picks` value -> unit -> track -> 1|2, anything else dropped. */
export function migratePicks(raw: unknown): PicksMap {
  const out: PicksMap = {};
  if (!isObj(raw)) return out;
  for (const [unit, tracks] of Object.entries(raw)) {
    if (!isObj(tracks)) continue;
    for (const [track, p] of Object.entries(tracks)) if (isPick(p)) (out[unit] ??= {})[track] = p;
  }
  return out;
}

/** A raw `legacy` value -> unit -> track -> true, anything else dropped. */
export function migrateLegacy(raw: unknown): LegacyMap {
  const out: LegacyMap = {};
  if (!isObj(raw)) return out;
  for (const [unit, tracks] of Object.entries(raw)) {
    if (!isObj(tracks)) continue;
    for (const [track, v] of Object.entries(tracks)) if (v === true) (out[unit] ??= {})[track] = true;
  }
  return out;
}

/**
 * The account's picks and markers, settled against its tiers: for each branched (unit, track), a
 * tier at or above the branched one keeps a valid pick (and its marker, if it had one) or, with no
 * pick, takes pick 1 AND a legacy marker; a tier below it holds neither. Nothing else is kept.
 */
export function settleAccountPicks(
  upgrades: Readonly<Record<string, Readonly<Record<string, number>>>>,
  picks: PicksMap,
  legacy: LegacyMap,
  branched: BranchedTable
): { picks: PicksMap; legacy: LegacyMap } {
  const outPicks: PicksMap = {};
  const outLegacy: LegacyMap = {};
  for (const [unit, tracks] of Object.entries(branched)) {
    for (const [track, { tier }] of Object.entries(tracks)) {
      if ((upgrades[unit]?.[track] ?? 0) < tier) continue;
      const pick = picks[unit]?.[track];
      if (isPick(pick)) {
        (outPicks[unit] ??= {})[track] = pick;
        if (legacy[unit]?.[track] === true) (outLegacy[unit] ??= {})[track] = true;
      } else {
        (outPicks[unit] ??= {})[track] = 1;
        (outLegacy[unit] ??= {})[track] = true;
      }
    }
  }
  return { picks: outPicks, legacy: outLegacy };
}

/** One wallet entitlement, settled the same way: `branch` and `legacy` are kept only at or above
 *  the branched tier, and a branched tier with no `branch` takes branch 1 and the marker. */
export function settleEntitlement<E extends { tier: number; paidTiers: number; branch?: BranchPick; legacy?: true }>(
  e: E,
  branchedTier: number | undefined
): E {
  const { branch, legacy, ...rest } = e;
  if (branchedTier === undefined || e.tier < branchedTier) return rest as E;
  if (isPick(branch)) return { ...rest, branch, ...(legacy === true ? { legacy: true as const } : {}) } as E;
  return { ...rest, branch: 1, legacy: true } as E;
}

/** The pick a store holds on (unit, track), or `undefined` below the branched tier. */
export function accountPick(account: { upgrades: Record<string, Record<string, number>>; picks: PicksMap }, unit: string, track: string, tier: number): BranchPick | undefined {
  return (account.upgrades[unit]?.[track] ?? 0) >= tier ? account.picks[unit]?.[track] : undefined;
}
