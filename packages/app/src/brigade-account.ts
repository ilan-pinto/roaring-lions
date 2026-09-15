/**
 * The brigade account (spec 2026-09-15 §4.1): what the player has earned and bought,
 * kept BESIDE the campaign ledger under its own key so a fresh campaign leaves it alone.
 * This module is the only reader and writer of that key.
 *
 * Every entry the client writes into `grants` has `source: 'earned'`. The paid path
 * (spec §4.6) would write `source: 'granted'` -- from a server or a store entitlement,
 * never from here. `migrateAccount` treats a granted entry in a local save as
 * hand-editing: it is dropped and the balance is rebuilt from the earned grants alone.
 * That rule is what makes "no client code can create a granted entry" true rather than
 * merely intended.
 *
 * `payMission` is the improvement rule: a mission pays the difference between this run's
 * value and what it has paid before, never less than zero, and the record moves up.
 */
export const ACCOUNT_KEY = 'lions.brigade.account';
export const ACCOUNT_VERSION = 1 as const;

export interface Grant {
  source: 'earned';
  amount: number;
  missionId: string;
  /** Wall-clock milliseconds, taken by the caller (the sim never reads a clock). */
  at: number;
}

export interface BrigadeAccount {
  version: typeof ACCOUNT_VERSION;
  /** Integer credits on hand. */
  balance: number;
  /** Every earned credit ever; never decremented. */
  earned_total: number;
  /** What each mission has paid so far -- the improvement rule's memory. */
  paid: Record<string, number>;
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
  return { version: ACCOUNT_VERSION, balance: 0, earned_total: 0, paid: {}, unlocks: [], upgrades: {}, grants: [] };
}

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function migrateGrants(raw: unknown): Grant[] {
  if (!Array.isArray(raw)) return [];
  const out: Grant[] = [];
  for (const g of raw) {
    if (g === null || typeof g !== 'object') continue;
    const r = g as Record<string, unknown>;
    // Only what this module writes survives; a 'granted' entry is dropped (see above).
    if (r.source !== 'earned' || !isNonNegInt(r.amount) || typeof r.missionId !== 'string' || !isNonNegInt(r.at)) continue;
    out.push({ source: 'earned', amount: r.amount, missionId: r.missionId, at: r.at });
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

/** Any raw value -> a valid account. Unknown fields are dropped; a balance that the
 *  earned grants cannot account for is reduced to what they can. */
export function migrateAccount(raw: unknown): BrigadeAccount {
  if (raw === null || typeof raw !== 'object') return emptyAccount();
  const r = raw as Record<string, unknown>;
  const grants = migrateGrants(r.grants);
  let earnedFromGrants = 0;
  for (const g of grants) earnedFromGrants += g.amount;
  const hadGrantsField = Array.isArray(r.grants);
  // A save with no grants log at all is an older or partial write: trust its balance.
  // A save WITH a log is bounded by it: a balance no earned grant explains was edited.
  const balanceRaw = isNonNegInt(r.balance) ? r.balance : 0;
  const balance = hadGrantsField ? (balanceRaw > earnedFromGrants ? earnedFromGrants : balanceRaw) : balanceRaw;
  const earnedTotalRaw = isNonNegInt(r.earned_total) ? r.earned_total : 0;
  return {
    version: ACCOUNT_VERSION,
    balance,
    earned_total: hadGrantsField ? (earnedTotalRaw > earnedFromGrants ? earnedFromGrants : earnedTotalRaw) : earnedTotalRaw,
    paid: migratePaid(r.paid),
    unlocks: Array.isArray(r.unlocks) ? r.unlocks.filter((u): u is string => typeof u === 'string') : [],
    upgrades: migrateUpgrades(r.upgrades),
    grants,
  };
}

export function loadAccount(store: StorageLike): BrigadeAccount {
  try {
    const text = store.getItem(ACCOUNT_KEY);
    return text === null ? emptyAccount() : migrateAccount(JSON.parse(text));
  } catch {
    return emptyAccount();
  }
}

export function saveAccount(store: StorageLike, account: BrigadeAccount): void {
  store.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

/** The improvement rule (spec §4.2 D2). Pure: returns a new account and what was paid. */
export function payMission(
  account: BrigadeAccount,
  missionId: string,
  value: number,
  at: number
): { account: BrigadeAccount; paid: number } {
  const before = account.paid[missionId] ?? 0;
  const paid = value > before ? value - before : 0;
  if (paid === 0) return { account, paid: 0 };
  return {
    account: {
      ...account,
      balance: account.balance + paid,
      earned_total: account.earned_total + paid,
      paid: { ...account.paid, [missionId]: value },
      grants: [...account.grants, { source: 'earned', amount: paid, missionId, at }],
    },
    paid,
  };
}

export function resetAccount(store: StorageLike): BrigadeAccount {
  store.removeItem(ACCOUNT_KEY);
  return emptyAccount();
}
