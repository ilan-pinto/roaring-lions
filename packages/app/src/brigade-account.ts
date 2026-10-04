/**
 * The brigade account (spec 2026-09-15 §4.1): what the player has earned and bought,
 * kept BESIDE the campaign ledger under its own key so a fresh campaign leaves it alone.
 * This module is the only reader and writer of that key.
 *
 * `payMission` is the only CONSTRUCTOR of a grant, and it only ever writes
 * `source: 'earned'`. The paid path (spec §4.6) writes `source: 'granted'` -- from a
 * server or a store entitlement, never from here -- and this module does not destroy
 * one it finds: §4.6 promises the shape of `grants` does not change the day the paid
 * path arrives, so `migrateAccount` keeps a well-formed entry of EITHER source and
 * counts both toward the balance/earned_total bound below (ruling R6).
 *
 * `payMission` is the improvement rule: a mission pays the difference between this run's
 * value and what it has paid before, never less than zero, and the record moves up.
 * Since GH-330 there are TWO records. `paid` is the lifetime best and survives a new
 * campaign, as the account does (spec 2026-09-15 §4.1). `campaign_paid` is the best in
 * THIS campaign, and `startCampaign` clears it, so a new campaign pays again while a
 * replay inside one campaign still pays improvement only. Which record a payout is
 * measured against is the caller's `scope` (`campaign-pay.ts` decides it: a mission
 * that is not open in the campaign is measured against the lifetime record, so a
 * locked mission played by address cannot repeat a payout).
 */
export const ACCOUNT_KEY = 'lions.brigade.account';
/** 2 since GH-330 (`campaign_paid`). A version-1 save migrates on read. */
export const ACCOUNT_VERSION = 2 as const;

/** Which improvement record a payout is measured against. */
export type PayScope = 'campaign' | 'lifetime';

/** A granted entry (the future paid path, spec §4.6) carries no `missionId` -- it was
 *  not earned by playing any one mission. An earned entry always does. */
export type Grant =
  | { source: 'earned'; amount: number; missionId: string; at: number }
  | { source: 'granted'; amount: number; missionId?: string; at: number };

export interface BrigadeAccount {
  version: typeof ACCOUNT_VERSION;
  /** Integer credits on hand. */
  balance: number;
  /** Every earned credit ever; never decremented. */
  earned_total: number;
  /** The best each mission has ever paid -- the lifetime record. Survives
   *  `startCampaign`. */
  paid: Record<string, number>;
  /** The best each mission has paid in THIS campaign (GH-330). Cleared by
   *  `startCampaign`; never above `paid` for the same mission. */
  campaign_paid: Record<string, number>;
  /** Unit ids opened by purchase (step 2 "Buy"). Empty in step 1. */
  unlocks: string[];
  /** Per unit type, the tier reached on each track (step 3 "Upgrade"). Empty in step 1. */
  upgrades: Record<string, Record<string, number>>;
  grants: Grant[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function emptyAccount(): BrigadeAccount {
  return {
    version: ACCOUNT_VERSION,
    balance: 0,
    earned_total: 0,
    paid: {},
    campaign_paid: {},
    unlocks: [],
    upgrades: {},
    grants: [],
  };
}

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

// `at` is wall-clock milliseconds, taken by the caller (the sim never reads a clock).
function migrateGrants(raw: unknown): Grant[] {
  if (!Array.isArray(raw)) return [];
  const out: Grant[] = [];
  for (const g of raw) {
    if (g === null || typeof g !== 'object') continue;
    const r = g as Record<string, unknown>;
    if (!isNonNegInt(r.amount) || !isNonNegInt(r.at)) continue;
    if (r.source === 'earned' && typeof r.missionId === 'string') {
      out.push({ source: 'earned', amount: r.amount, missionId: r.missionId, at: r.at });
    } else if (r.source === 'granted') {
      // No client path writes one of these (see the module comment); a local save can
      // still carry one once the paid path exists, and this module keeps it rather
      // than treating it as hand-editing. `missionId` is not part of its shape, but a
      // well-formed one is tolerated rather than stripped.
      out.push(
        typeof r.missionId === 'string'
          ? { source: 'granted', amount: r.amount, missionId: r.missionId, at: r.at }
          : { source: 'granted', amount: r.amount, at: r.at }
      );
    }
  }
  return out;
}

function migratePaid(raw: unknown): Record<string, number> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isNonNegInt(v)) out[k] = v;
  return out;
}

function migrateUpgrades(raw: unknown): Record<string, Record<string, number>> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [unit, tracks] of Object.entries(raw as Record<string, unknown>)) {
    if (tracks === null || typeof tracks !== 'object') continue;
    const t: Record<string, number> = {};
    for (const [track, tier] of Object.entries(tracks as Record<string, unknown>)) if (isNonNegInt(tier)) t[track] = tier;
    out[unit] = t;
  }
  return out;
}

/** The per-campaign record, read or derived (GH-330, D4 of the plan).
 *  A save that carries `campaign_paid` keeps it, clamped to `paid` per mission (a
 *  campaign's best can never exceed the lifetime best). A save from before it (version
 *  1) has none: the record starts as `paid` restricted to the missions DONE in the
 *  current campaign (`doneInCampaign`), so a mission already won in this campaign pays
 *  nothing new and a mission not yet won in it pays in full when it is. With no ledger
 *  to ask (`doneInCampaign` undefined) it starts as all of `paid`: conservative, it pays
 *  nothing a version-1 save would not have paid. No back-pay for abandoned campaigns. */
function migrateCampaignPaid(
  raw: unknown,
  hadField: boolean,
  paid: Record<string, number>,
  doneInCampaign: ReadonlySet<string> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (hadField) {
    for (const [k, v] of Object.entries(migratePaid(raw))) {
      const cap = paid[k] ?? 0;
      if (cap > 0) out[k] = v > cap ? cap : v;
    }
    return out;
  }
  for (const [k, v] of Object.entries(paid)) if (doneInCampaign === undefined || doneInCampaign.has(k)) out[k] = v;
  return out;
}

/** Any raw value -> a valid account. Unknown fields are dropped; a balance the grants
 *  log cannot account for is reduced to what it can. This is a tidiness check against
 *  a lazy hand-edit (a `balance` bumped without a matching grant), not an integrity
 *  guarantee -- §4.6 says the account is editable by design. `doneInCampaign` is the
 *  current campaign's completed missions, read only to migrate a version-1 save's
 *  per-campaign record (see `migrateCampaignPaid`). */
export function migrateAccount(raw: unknown, doneInCampaign?: ReadonlySet<string>): BrigadeAccount {
  if (raw === null || typeof raw !== 'object') return emptyAccount();
  const r = raw as Record<string, unknown>;
  const grants = migrateGrants(r.grants);
  let earnedFromGrants = 0;
  for (const g of grants) earnedFromGrants += g.amount;
  // Present but not an array (e.g. hand-edited to a string or an object) still counts
  // as "this save carries a grants log" -- `migrateGrants` reads it as empty, so the
  // bound below reduces the balance to 0 rather than trusting a number the log cannot
  // explain at all.
  const hadGrantsField = 'grants' in r;
  // A save with no grants field at all is an older or partial write: trust its balance.
  // A save WITH one is bounded by it: a balance the log cannot explain is reduced to
  // what it can, never raised.
  const balanceRaw = isNonNegInt(r.balance) ? r.balance : 0;
  const balance = hadGrantsField ? (balanceRaw > earnedFromGrants ? earnedFromGrants : balanceRaw) : balanceRaw;
  const earnedTotalRaw = isNonNegInt(r.earned_total) ? r.earned_total : 0;
  const paid = migratePaid(r.paid);
  return {
    version: ACCOUNT_VERSION,
    balance,
    earned_total: hadGrantsField ? (earnedTotalRaw > earnedFromGrants ? earnedFromGrants : earnedTotalRaw) : earnedTotalRaw,
    paid,
    campaign_paid: migrateCampaignPaid(r.campaign_paid, 'campaign_paid' in r, paid, doneInCampaign),
    unlocks: Array.isArray(r.unlocks) ? r.unlocks.filter((u): u is string => typeof u === 'string') : [],
    upgrades: migrateUpgrades(r.upgrades),
    grants,
  };
}

export function loadAccount(store: StorageLike, doneInCampaign?: ReadonlySet<string>): BrigadeAccount {
  try {
    const text = store.getItem(ACCOUNT_KEY);
    return text === null ? emptyAccount() : migrateAccount(JSON.parse(text), doneInCampaign);
  } catch {
    return emptyAccount();
  }
}

export function saveAccount(store: StorageLike, account: BrigadeAccount): void {
  store.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

/** The improvement rule (spec §4.2 D2). Pure: returns the account unchanged, by
 *  identity, when nothing is paid. `scope` names the record the run is measured
 *  against (GH-330): `'lifetime'` is the rule as it stood before, `'campaign'` measures
 *  against this campaign's best. Either way both records move up to the run's value
 *  where it beats them, so the lifetime best stays the best ever paid. */
export function payMission(
  account: BrigadeAccount,
  missionId: string,
  value: number,
  at: number,
  scope: PayScope = 'lifetime'
): { account: BrigadeAccount; paid: number } {
  const record = scope === 'campaign' ? account.campaign_paid : account.paid;
  const before = record[missionId] ?? 0;
  const paid = value > before ? value - before : 0;
  if (paid === 0) return { account, paid: 0 };
  const lifetime = account.paid[missionId] ?? 0;
  const inCampaign = account.campaign_paid[missionId] ?? 0;
  return {
    account: {
      ...account,
      balance: account.balance + paid,
      earned_total: account.earned_total + paid,
      paid: value > lifetime ? { ...account.paid, [missionId]: value } : account.paid,
      campaign_paid: value > inCampaign ? { ...account.campaign_paid, [missionId]: value } : account.campaign_paid,
      grants: [...account.grants, { source: 'earned', amount: paid, missionId, at }],
    },
    paid,
  };
}

/** Buying an unlock (spec §4.4): one step, no refunds. Refuses — returning the same account
 *  by identity — when the price is not a positive integer (the schema's own minimum is 1;
 *  `unlock.price` authors nothing at 0), the balance is short, or the unit is already
 *  bought. Spending writes no grant: `grants` is the earned history, and `earned_total`
 *  never moves on a purchase. */
export function buyUnlock(
  account: BrigadeAccount,
  unitId: string,
  price: number
): { account: BrigadeAccount; ok: boolean } {
  if (!isNonNegInt(price) || price < 1) return { account, ok: false };
  if (account.unlocks.includes(unitId)) return { account, ok: false };
  if (account.balance < price) return { account, ok: false };
  return {
    account: { ...account, balance: account.balance - price, unlocks: [...account.unlocks, unitId] },
    ok: true,
  };
}

/** Buying an upgrade tier (spec §4.3): buys exactly the NEXT tier of a track, no refunds.
 *  Refuses — returning the same account by identity — when `tier` is not exactly
 *  `(account.upgrades[unitId]?.[track] ?? 0) + 1`, when the price is not a positive integer,
 *  or when the balance is short. Spending writes no grant: `grants` is the earned history,
 *  and `earned_total` never moves on a purchase. */
export function buyUpgrade(
  account: BrigadeAccount,
  unitId: string,
  track: string,
  tier: number,
  price: number
): { account: BrigadeAccount; ok: boolean } {
  const currentTier = account.upgrades[unitId]?.[track] ?? 0;
  if (tier !== currentTier + 1) return { account, ok: false };
  if (!isNonNegInt(price) || price < 1) return { account, ok: false };
  if (account.balance < price) return { account, ok: false };
  return {
    account: {
      ...account,
      balance: account.balance - price,
      upgrades: {
        ...account.upgrades,
        [unitId]: { ...(account.upgrades[unitId] ?? {}), [track]: tier },
      },
    },
    ok: true,
  };
}

/** "New campaign" (GH-330): the per-campaign record starts empty, so every mission
 *  pays in full again the first time it is won in the new campaign. Nothing else moves:
 *  balance, `earned_total`, the lifetime `paid`, unlocks, upgrades and grants are the
 *  brigade's, and survive a new campaign (spec §4.1). Pure; returns the account by
 *  identity when the record is already empty. */
export function startCampaign(account: BrigadeAccount): BrigadeAccount {
  if (Object.keys(account.campaign_paid).length === 0) return account;
  return { ...account, campaign_paid: {} };
}

export function resetAccount(store: StorageLike): BrigadeAccount {
  store.removeItem(ACCOUNT_KEY);
  return emptyAccount();
}
