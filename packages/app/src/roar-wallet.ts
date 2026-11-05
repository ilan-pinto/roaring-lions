/**
 * The Roar coin wallet (GH-317). Every player has one, free: coins are earned in
 * the campaign (`roar-earn.ts`) and a coupon can add some; the Stores spend them
 * on what play and credits already open, in single player. No money moves here.
 * Design: `docs/superpowers/specs/2026-11-04-roar-coin-wallet-design.md`.
 *
 * THE ONE READER AND WRITER of `lions.roar`. Nothing else in the app spells that
 * key (`roar-wallet.test.ts` scans for it), and it is the only place that names
 * the retired `lions.roar.test` key, which `migrateTestWallet` reads once.
 *
 * The balance is split `{ free, paid }` from v1 so real money, when Steam opens
 * it (ST7), needs no migration:
 *
 *  - `free` is earned or granted in play. `paid` is bought with money.
 *  - `PURCHASES_OPEN` is false, and while it is, `migrateRoar` clamps `paid` to 0
 *    and no code in this repository raises it (G-M1). The paid side is display-only.
 *  - A purchase spends free first, then paid, and its receipt records both halves
 *    (G-M2), so a later chargeback can take back only what was paid for.
 *  - An entitlement records which kind bought it, so a later narrowing of what a
 *    paid coin may open (decision D4) needs no migration either.
 *
 * It never touches `lions.brigade.account`'s money fields (`balance`,
 * `earned_total`, `grants`): a coin purchase debits `coins` here and nothing else
 * (spec guard G3, "coins never become credits"). The brigade account keeps meaning
 * "earned credits". Its `unlocks` and `upgrades` are the EARNED half of spec §1.5's
 * split, and this key holds the COIN half. `singlePlayerView` reads `earned OR
 * coins` (a tier is `max(earned, coins)`); `networkView` reads `earned` only, and
 * nothing in a versus room calls the first (`roar-fences.test.ts`).
 *
 * Survives `?fresh` and "New campaign", like the brigade account: the coins are a
 * lifetime record. The brigade screen's reset clears the FREE half (`resetFree`)
 * and never the paid.
 */
import type { BrigadeAccount, StorageLike } from './brigade-account';

export const ROAR_KEY = 'lions.roar';
export const ROAR_VERSION = 1 as const;
/** The retired TEST wallet's key (`?testcoins`, removed with this module). Read
 *  once by `migrateTestWallet` and then deleted. */
export const LEGACY_TEST_KEY = 'lions.roar.test';

/** The most the free balance may hold. */
export const MAX_COINS = 1_000_000;
/** The receipts kept, newest last. Lifetime earning is a few dozen rows. */
export const RECEIPT_CAP = 500;

/** False until the server-held account (ST5-ST7): no REAL money moves, and no
 *  pack can be bought. `migrateRoar` clamps `coins.paid` to 0 while it is false,
 *  and the Stores' packs stay disabled (`buyEnabled`). */
export const PURCHASES_OPEN: boolean = false;

export interface CoinSplit {
  free: number;
  paid: number;
}

/** Which kind of coin bought a unit. */
export type UnitEntitlement = { free: true } | { paid: true };
/** A track on the coin path: the tier reached, and how many of its tiers a paid
 *  coin bought. */
export interface TrackEntitlement {
  tier: number;
  paidTiers: number;
}

export type EarnSource = 'welcome' | 'first_win' | 'star' | 'campaign' | 'backfill';
const EARN_SOURCES: readonly string[] = ['welcome', 'first_win', 'star', 'campaign', 'backfill'];

export type RoarReceipt =
  | { kind: 'earn'; id: string; at: number; coins: CoinSplit; source: EarnSource; missionId?: string }
  | { kind: 'coupon'; id: string; at: number; coins: CoinSplit; couponIds: string[]; source?: 'test' }
  | { kind: 'unit'; id: string; at: number; coins: CoinSplit; unitId: string; credits: number; source?: 'test' }
  | { kind: 'tier'; id: string; at: number; coins: CoinSplit; unitId: string; track: string; tier: number; credits: number; source?: 'test' };

/** What has been paid out, ever. Lifetime only: "New campaign" does not clear it. */
export interface EarnRecord {
  /** The welcome issue has landed (on the first campaign victory). */
  welcomed: boolean;
  /** The campaign-complete bonus has landed. */
  campaignDone: boolean;
  /** Per mission: won at least once, and the best stars ever paid for. */
  missions: Record<string, { won: boolean; stars: number }>;
}

export interface RoarWallet {
  version: typeof ROAR_VERSION;
  coins: CoinSplit;
  entitlements: {
    units: Record<string, UnitEntitlement>;
    upgrades: Record<string, Record<string, TrackEntitlement>>;
  };
  earn: EarnRecord;
  /** Oldest first on disk. The Receipts shelf shows them newest first. */
  receipts: RoarReceipt[];
}

export function emptyRoar(): RoarWallet {
  return {
    version: ROAR_VERSION,
    coins: { free: 0, paid: 0 },
    entitlements: { units: {}, upgrades: {} },
    earn: { welcomed: false, campaignDone: false, missions: {} },
    receipts: [],
  };
}

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function migrateSplit(raw: unknown): CoinSplit {
  const s = isObj(raw) ? raw : {};
  const free = isNonNegInt(s.free) ? Math.min(s.free, MAX_COINS) : 0;
  // G-M1: the paid side is display-only until money exists. Whatever a file says,
  // it reads 0 while purchases are closed.
  const paid = PURCHASES_OPEN && isNonNegInt(s.paid) ? Math.min(s.paid, MAX_COINS) : 0;
  return { free, paid };
}

function migrateReceipt(raw: unknown): RoarReceipt | null {
  if (!isObj(raw)) return null;
  const { kind, id, at } = raw;
  if (typeof id !== 'string' || !isNonNegInt(at) || !isObj(raw.coins)) return null;
  const coins = migrateSplit(raw.coins);
  const source = raw.source === 'test' ? ({ source: 'test' } as const) : {};
  if (kind === 'earn') {
    if (typeof raw.source !== 'string' || !EARN_SOURCES.includes(raw.source)) return null;
    const r: RoarReceipt = { kind, id, at, coins, source: raw.source as EarnSource };
    if (typeof raw.missionId === 'string') r.missionId = raw.missionId;
    return r;
  }
  if (kind === 'coupon') {
    const couponIds = Array.isArray(raw.couponIds) ? raw.couponIds.filter((c): c is string => typeof c === 'string') : [];
    return { kind, id, at, coins, couponIds, ...source };
  }
  if (typeof raw.unitId !== 'string' || !isNonNegInt(raw.credits)) return null;
  if (kind === 'unit') return { kind, id, at, coins, unitId: raw.unitId, credits: raw.credits, ...source };
  if (kind === 'tier' && typeof raw.track === 'string' && isNonNegInt(raw.tier)) {
    return { kind, id, at, coins, unitId: raw.unitId, credits: raw.credits, track: raw.track, tier: raw.tier, ...source };
  }
  return null;
}

/** Any raw value -> a valid wallet. Malformed parts drop to empty, and `paid`
 *  reads 0 whatever the file says while `PURCHASES_OPEN` is false (G-M1). */
export function migrateRoar(raw: unknown): RoarWallet {
  if (!isObj(raw)) return emptyRoar();
  const out = emptyRoar();
  out.coins = migrateSplit(raw.coins);
  const ent = isObj(raw.entitlements) ? raw.entitlements : {};
  if (isObj(ent.units)) {
    for (const [id, v] of Object.entries(ent.units)) {
      if (!isObj(v)) continue;
      if (PURCHASES_OPEN && v.paid === true) out.entitlements.units[id] = { paid: true };
      else if (v.free === true || v.paid === true) out.entitlements.units[id] = { free: true };
    }
  }
  if (isObj(ent.upgrades)) {
    for (const [unit, tracks] of Object.entries(ent.upgrades)) {
      if (!isObj(tracks)) continue;
      const kept: Record<string, TrackEntitlement> = {};
      for (const [track, v] of Object.entries(tracks)) {
        if (!isObj(v) || !isNonNegInt(v.tier)) continue;
        const paidTiers = PURCHASES_OPEN && isNonNegInt(v.paidTiers) ? Math.min(v.paidTiers, v.tier) : 0;
        kept[track] = { tier: v.tier, paidTiers };
      }
      out.entitlements.upgrades[unit] = kept;
    }
  }
  const earn = isObj(raw.earn) ? raw.earn : {};
  out.earn.welcomed = earn.welcomed === true;
  out.earn.campaignDone = earn.campaignDone === true;
  if (isObj(earn.missions)) {
    for (const [id, v] of Object.entries(earn.missions)) {
      if (!isObj(v)) continue;
      out.earn.missions[id] = { won: v.won === true, stars: isNonNegInt(v.stars) ? Math.min(v.stars, 3) : 0 };
    }
  }
  if (Array.isArray(raw.receipts)) {
    for (const r of raw.receipts) {
      const m = migrateReceipt(r);
      if (m !== null) out.receipts.push(m);
    }
  }
  return out;
}

/**
 * The retired TEST wallet (`lions.roar.test`, v1) -> a v1 wallet, once.
 *
 * What carries over: every coin-bought unit and tier (as FREE entitlements with
 * their receipts, marked `source: 'test'`), and the coins a COUPON put in the
 * wallet (the sum of its coupon receipts, never more than the balance it still
 * holds). What does not: a `?testcoins` seed or Grant, which were never earned
 * (G-S5).
 */
export function migrateTestWallet(raw: unknown): RoarWallet {
  const out = emptyRoar();
  if (!isObj(raw)) return out;
  const balance = isNonNegInt(raw.coins) ? raw.coins : 0;
  const ent = isObj(raw.entitlements) ? raw.entitlements : {};
  if (isObj(ent.units)) {
    for (const [id, v] of Object.entries(ent.units)) if (isObj(v) && v.coins === true) out.entitlements.units[id] = { free: true };
  }
  if (isObj(ent.upgrades)) {
    for (const [unit, tracks] of Object.entries(ent.upgrades)) {
      if (!isObj(tracks)) continue;
      const kept: Record<string, TrackEntitlement> = {};
      for (const [track, v] of Object.entries(tracks)) if (isObj(v) && isNonNegInt(v.coins) && v.coins > 0) kept[track] = { tier: v.coins, paidTiers: 0 };
      if (Object.keys(kept).length > 0) out.entitlements.upgrades[unit] = kept;
    }
  }
  let coupon = 0;
  const receipts = Array.isArray(raw.receipts) ? raw.receipts : [];
  for (const r of receipts) {
    if (!isObj(r) || typeof r.id !== 'string' || !isNonNegInt(r.at) || !isNonNegInt(r.coins)) continue;
    const split: CoinSplit = { free: r.coins, paid: 0 };
    if (r.kind === 'coupon') {
      coupon += r.coins;
      const couponIds = Array.isArray(r.couponIds) ? r.couponIds.filter((c): c is string => typeof c === 'string') : [];
      out.receipts.push({ kind: 'coupon', id: r.id, at: r.at, coins: split, couponIds, source: 'test' });
    } else if (r.kind === 'unit' && typeof r.unitId === 'string' && isNonNegInt(r.credits)) {
      out.receipts.push({ kind: 'unit', id: r.id, at: r.at, coins: split, unitId: r.unitId, credits: r.credits, source: 'test' });
    } else if (r.kind === 'tier' && typeof r.unitId === 'string' && typeof r.track === 'string' && isNonNegInt(r.tier) && isNonNegInt(r.credits)) {
      out.receipts.push({ kind: 'tier', id: r.id, at: r.at, coins: split, unitId: r.unitId, track: r.track, tier: r.tier, credits: r.credits, source: 'test' });
    }
  }
  out.coins.free = Math.min(coupon, balance, MAX_COINS);
  return out;
}

/**
 * Runs once, on a wallet being CREATED (the key absent), and never on a wallet
 * that already exists: the caller reads the campaign ledger and returns the
 * wallet with the back-payment in it (`roarBackfill`, roar-earn.ts). The result
 * is written at once, so the key then exists and this cannot run again; a slot
 * load or import finds the key and earns nothing (G-E3).
 */
export type RoarSeed = (w: RoarWallet) => RoarWallet;

export function loadRoar(store: StorageLike, seed?: RoarSeed): RoarWallet {
  try {
    const text = store.getItem(ROAR_KEY);
    if (text !== null) return migrateRoar(JSON.parse(text));
    const legacy = store.getItem(LEGACY_TEST_KEY);
    const base = legacy === null ? emptyRoar() : migrateTestWallet(JSON.parse(legacy));
    if (legacy === null && seed === undefined) return base;
    const made = seed !== undefined ? seed(base) : base;
    // Once: write the new key, then delete the old. A refusal leaves the old key
    // in place and the next read migrates again, to the same result.
    try {
      store.setItem(ROAR_KEY, JSON.stringify(made));
      if (legacy !== null) store.removeItem(LEGACY_TEST_KEY);
    } catch {
      /* the wallet still reads correctly from memory */
    }
    return made;
  } catch {
    return emptyRoar();
  }
}

export function saveRoar(store: StorageLike, w: RoarWallet): void {
  store.setItem(ROAR_KEY, JSON.stringify(w));
}

/** The raw text under the key, for a both-or-neither write to put back. */
export function snapshotRoarText(store: StorageLike): string | null {
  return store.getItem(ROAR_KEY);
}
export function restoreRoarText(store: StorageLike, text: string | null): void {
  if (text === null) store.removeItem(ROAR_KEY);
  else store.setItem(ROAR_KEY, text);
}

/** Coins on hand that a Buy may spend. */
export const spendable = (w: RoarWallet): number => w.coins.free + w.coins.paid;

const receiptId = (w: RoarWallet, at: number): string => `${at}-${w.receipts.length + 1}`;
const capReceipts = (r: RoarReceipt[]): RoarReceipt[] => (r.length > RECEIPT_CAP ? r.slice(r.length - RECEIPT_CAP) : r);

/** Spends `price`, free first and then paid (G-M2). `null` when the wallet is short. */
function spend(coins: CoinSplit, price: number): { left: CoinSplit; spent: CoinSplit } | null {
  if (coins.free + coins.paid < price) return null;
  const fromFree = Math.min(coins.free, price);
  const fromPaid = price - fromFree;
  return { left: { free: coins.free - fromFree, paid: coins.paid - fromPaid }, spent: { free: fromFree, paid: fromPaid } };
}

/** Adds FREE coins (capped at `MAX_COINS`) with one receipt. Used by a coupon and
 *  by earning; there is deliberately no function that adds to `paid`. */
export function grantFree(w: RoarWallet, n: number, receipt: (id: string, coins: CoinSplit) => RoarReceipt, at: number): RoarWallet {
  if (!isNonNegInt(n) || n < 1) return w;
  const free = Math.min(w.coins.free + n, MAX_COINS);
  const added = free - w.coins.free;
  if (added === 0) return w;
  return { ...w, coins: { ...w.coins, free }, receipts: capReceipts([...w.receipts, receipt(receiptId(w, at), { free: added, paid: 0 })]) };
}

/** Coins from a redeemed coupon (`redeemCoupon`'s `coins`) into the FREE balance,
 *  capped at `MAX_COINS`, with a `coupon` receipt naming the entries. */
export function grantCouponCoins(w: RoarWallet, n: number, couponIds: readonly string[], at: number): RoarWallet {
  return grantFree(w, n, (id, coins) => ({ kind: 'coupon', id, at, coins, couponIds: [...couponIds] }), at);
}

/** Buys a unit with coins. It refuses (`ok: false`, the same object back) when
 *  the price is not positive, the unit is already coin-bought, or the wallet
 *  is short. Whether the unit is FOR SALE at all is the caller's question,
 *  answered by the Stores' own `storeItems`, so the screen and the purchase
 *  cannot disagree. */
export function buyUnitWithCoins(
  w: RoarWallet,
  unitId: string,
  coins: number,
  credits: number,
  at: number
): { account: RoarWallet; ok: boolean } {
  if (!isNonNegInt(coins) || coins < 1) return { account: w, ok: false };
  if (w.entitlements.units[unitId] !== undefined) return { account: w, ok: false };
  const paid = spend(w.coins, coins);
  if (paid === null) return { account: w, ok: false };
  const entitlement: UnitEntitlement = paid.spent.paid > 0 ? { paid: true } : { free: true };
  return {
    account: {
      ...w,
      coins: paid.left,
      entitlements: { ...w.entitlements, units: { ...w.entitlements.units, [unitId]: entitlement } },
      receipts: capReceipts([...w.receipts, { kind: 'unit', id: receiptId(w, at), at, unitId, coins: paid.spent, credits }]),
    },
    ok: true,
  };
}

/** Buys exactly the next tier of a track with coins. `tier` must be
 *  `current + 1`, where `current` is the SINGLE-PLAYER tier,
 *  `max(earned, coins)`. It refuses the same way `buyUnitWithCoins` does. */
export function buyTierWithCoins(
  w: RoarWallet,
  unitId: string,
  track: string,
  tier: number,
  current: number,
  coins: number,
  credits: number,
  at: number
): { account: RoarWallet; ok: boolean } {
  if (!isNonNegInt(coins) || coins < 1) return { account: w, ok: false };
  if (tier !== current + 1) return { account: w, ok: false };
  const paid = spend(w.coins, coins);
  if (paid === null) return { account: w, ok: false };
  const tracks = w.entitlements.upgrades[unitId] ?? {};
  const before = tracks[track]?.paidTiers ?? 0;
  return {
    account: {
      ...w,
      coins: paid.left,
      entitlements: {
        ...w.entitlements,
        upgrades: { ...w.entitlements.upgrades, [unitId]: { ...tracks, [track]: { tier, paidTiers: before + (paid.spent.paid > 0 ? 1 : 0) } } },
      },
      receipts: capReceipts([...w.receipts, { kind: 'tier', id: receiptId(w, at), at, unitId, track, tier, coins: paid.spent, credits }]),
    },
    ok: true,
  };
}

/**
 * The brigade screen's reset, for the wallet: the FREE half goes (balance, free
 * entitlements, the earn record) and the paid half stays (G-S3's twin). The earn
 * record goes with the free coins it paid out, so the account starts over as a new
 * one would. A track keeps only the tiers a paid coin bought.
 */
export function resetFree(w: RoarWallet): RoarWallet {
  const units: Record<string, UnitEntitlement> = {};
  for (const [id, e] of Object.entries(w.entitlements.units)) if ('paid' in e) units[id] = e;
  const upgrades: Record<string, Record<string, TrackEntitlement>> = {};
  for (const [unit, tracks] of Object.entries(w.entitlements.upgrades)) {
    const kept: Record<string, TrackEntitlement> = {};
    for (const [track, v] of Object.entries(tracks)) if (v.paidTiers > 0) kept[track] = { tier: v.paidTiers, paidTiers: v.paidTiers };
    if (Object.keys(kept).length > 0) upgrades[unit] = kept;
  }
  return {
    version: ROAR_VERSION,
    coins: { free: 0, paid: w.coins.paid },
    entitlements: { units, upgrades },
    earn: { welcomed: false, campaignDone: false, missions: {} },
    receipts: w.receipts.filter((r) => r.coins.paid > 0),
  };
}

type Tiers = Record<string, Record<string, number>>;
type EarnedHalf = Pick<BrigadeAccount, 'unlocks' | 'upgrades'>;

/** The coin path's tiers as a plain tier map. */
export function coinTiers(w: RoarWallet): Tiers {
  const out: Tiers = {};
  for (const [unit, tracks] of Object.entries(w.entitlements.upgrades)) {
    out[unit] = {};
    for (const [track, v] of Object.entries(tracks)) out[unit][track] = v.tier;
  }
  return out;
}

/** Spec §1.5's shape: every entitlement with its source. For a unit, `earned`
 *  means the brigade account's credit purchase (`unlocks`). A gate that play
 *  opened is not an entitlement anyone holds; it is read from the ledger,
 *  where the gate is. */
export function entitlementsOf(
  account: EarnedHalf,
  roar: RoarWallet
): {
  units: Record<string, { earned: boolean; coins: boolean }>;
  upgrades: Record<string, Record<string, { earned: number; coins: number }>>;
} {
  const units: Record<string, { earned: boolean; coins: boolean }> = {};
  for (const id of account.unlocks) units[id] = { earned: true, coins: false };
  for (const id of Object.keys(roar.entitlements.units)) units[id] = { earned: units[id]?.earned ?? false, coins: true };
  const upgrades: Record<string, Record<string, { earned: number; coins: number }>> = {};
  const touch = (u: string, t: string): { earned: number; coins: number } => {
    upgrades[u] ??= {};
    upgrades[u][t] ??= { earned: 0, coins: 0 };
    return upgrades[u][t];
  };
  for (const [u, tracks] of Object.entries(account.upgrades)) for (const [t, n] of Object.entries(tracks)) touch(u, t).earned = n;
  for (const [u, tracks] of Object.entries(roar.entitlements.upgrades)) for (const [t, v] of Object.entries(tracks)) touch(u, t).coins = v.tier;
  return { units, upgrades };
}

function view(account: EarnedHalf, roar: RoarWallet, coinsCount: boolean): { boughtUnits: Set<string>; ownedTiers: Tiers } {
  const ent = entitlementsOf(account, roar);
  const boughtUnits = new Set<string>();
  for (const [id, e] of Object.entries(ent.units)) if (e.earned || (coinsCount && e.coins)) boughtUnits.add(id);
  const ownedTiers: Tiers = {};
  for (const [u, tracks] of Object.entries(ent.upgrades)) {
    ownedTiers[u] = {};
    for (const [t, e] of Object.entries(tracks)) ownedTiers[u][t] = coinsCount ? Math.max(e.earned, e.coins) : e.earned;
  }
  return { boughtUnits, ownedTiers };
}

/** Single-player (campaign, sandbox): `earned OR coins`, and a tier is `max(earned, coins)`. */
export function singlePlayerView(account: EarnedHalf, roar: RoarWallet): { boughtUnits: Set<string>; ownedTiers: Tiers } {
  return view(account, roar, true);
}

/** Network play (co-op, skirmish, 1v1): `earned` only (spec §1.5, 1 Oct ruling 3). */
export function networkView(account: EarnedHalf, roar: RoarWallet): { boughtUnits: Set<string>; ownedTiers: Tiers } {
  return view(account, roar, false);
}
