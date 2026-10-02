/**
 * The Roar coin TEST wallet (GH-317). The lead approved it in chat on 2 Oct
 * ("Yes, build it"): TEST coins, granted by `?testcoins=<n>`, that buy what
 * credits buy so the Stores can be tried before the server-held account exists.
 * No money moves, nothing leaves this browser, and a test coin is never a
 * credit.
 *
 * THIS IS A TEST TOOL. Anyone with the link can unlock things for free on the
 * live site. It must be removed or gated before release.
 *
 * It lives under its OWN key, `lions.roar.test`, and never touches
 * `lions.brigade.account`'s money fields (`balance`, `earned_total`,
 * `grants`): a coin purchase debits `coins` here and nothing else (spec guard
 * G3, "coins never become credits"). The brigade account keeps meaning
 * "earned". Its `unlocks` and `upgrades` are the EARNED half of spec §1.5's
 * split, and this key holds the COIN half:
 *
 *   entitlements.units[id].coins                 -- bought with coins
 *   entitlements.upgrades[unit][track].coins     -- the tier reached on the coin path
 *
 * `entitlementsOf` joins the two into §1.5's `{ earned, coins }` shape.
 * `singlePlayerView` reads `earned OR coins` (a tier is `max(earned, coins)`),
 * and `networkView` reads `earned` only. Nothing calls `networkView` yet,
 * because there is no network play, but the data it reads is right from the
 * first purchase.
 */
import type { BrigadeAccount, StorageLike } from './brigade-account';

export const ROAR_TEST_KEY = 'lions.roar.test';
export const ROAR_TEST_VERSION = 1 as const;

/** What `?testcoins` grants when it names no usable amount (`?testcoins`, `?testcoins=x`). */
export const DEFAULT_TEST_GRANT = 5000;
/** The most one grant may add, and the most the wallet may hold. */
export const MAX_TEST_COINS = 1_000_000;

export type RoarReceipt =
  | { kind: 'grant'; id: string; at: number; coins: number }
  | { kind: 'unit'; id: string; at: number; unitId: string; coins: number; credits: number }
  | { kind: 'tier'; id: string; at: number; unitId: string; track: string; tier: number; coins: number; credits: number };

export interface RoarTestAccount {
  version: typeof ROAR_TEST_VERSION;
  /** TEST coins on hand. Never a credit, never converted into one. */
  coins: number;
  /** Whether `?testcoins`' first visit has already seeded the wallet. A seeded
   *  wallet is never re-seeded by a reload; only the Grant button adds more. */
  seeded: boolean;
  entitlements: {
    units: Record<string, { coins: true }>;
    upgrades: Record<string, Record<string, { coins: number }>>;
  };
  /** Oldest first on disk. The Receipts shelf shows them newest first. */
  receipts: RoarReceipt[];
}

export function emptyRoarTest(): RoarTestAccount {
  return { version: ROAR_TEST_VERSION, coins: 0, seeded: false, entitlements: { units: {}, upgrades: {} }, receipts: [] };
}

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function migrateReceipt(raw: unknown): RoarReceipt | null {
  if (!isObj(raw)) return null;
  const { kind, id, at, coins } = raw;
  if (typeof id !== 'string' || !isNonNegInt(at) || !isNonNegInt(coins)) return null;
  if (kind === 'grant') return { kind, id, at, coins };
  if (typeof raw.unitId !== 'string' || !isNonNegInt(raw.credits)) return null;
  if (kind === 'unit') return { kind, id, at, coins, unitId: raw.unitId, credits: raw.credits };
  if (kind === 'tier' && typeof raw.track === 'string' && isNonNegInt(raw.tier)) {
    return { kind, id, at, coins, unitId: raw.unitId, credits: raw.credits, track: raw.track, tier: raw.tier };
  }
  return null;
}

/** Any raw value -> a valid test wallet. Malformed parts drop to empty. */
export function migrateRoarTest(raw: unknown): RoarTestAccount {
  if (!isObj(raw)) return emptyRoarTest();
  const out = emptyRoarTest();
  out.coins = isNonNegInt(raw.coins) ? Math.min(raw.coins, MAX_TEST_COINS) : 0;
  out.seeded = raw.seeded === true;
  const ent = isObj(raw.entitlements) ? raw.entitlements : {};
  if (isObj(ent.units)) {
    for (const [id, v] of Object.entries(ent.units)) if (isObj(v) && v.coins === true) out.entitlements.units[id] = { coins: true };
  }
  if (isObj(ent.upgrades)) {
    for (const [unit, tracks] of Object.entries(ent.upgrades)) {
      if (!isObj(tracks)) continue;
      const kept: Record<string, { coins: number }> = {};
      for (const [track, v] of Object.entries(tracks)) if (isObj(v) && isNonNegInt(v.coins)) kept[track] = { coins: v.coins };
      out.entitlements.upgrades[unit] = kept;
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

export function loadRoarTest(store: StorageLike): RoarTestAccount {
  try {
    const text = store.getItem(ROAR_TEST_KEY);
    return text === null ? emptyRoarTest() : migrateRoarTest(JSON.parse(text));
  } catch {
    return emptyRoarTest();
  }
}

export function saveRoarTest(store: StorageLike, a: RoarTestAccount): void {
  store.setItem(ROAR_TEST_KEY, JSON.stringify(a));
}

/**
 * `?testcoins=<n>` -> the grant amount. `null` when the parameter is absent,
 * which means no test mode at all: the Stores stays the disabled preview. A
 * present parameter with no usable positive integer grants
 * `DEFAULT_TEST_GRANT`, and a huge one is capped.
 */
export function testCoinsParam(query: URLSearchParams): number | null {
  if (!query.has('testcoins')) return null;
  const raw = query.get('testcoins') ?? '';
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 1) return DEFAULT_TEST_GRANT;
  return Math.min(n, MAX_TEST_COINS);
}

const receiptId = (a: RoarTestAccount, at: number): string => `${at}-${a.receipts.length + 1}`;

/** Adds `n` TEST coins (the wallet is capped at `MAX_TEST_COINS`) and writes a grant receipt. */
export function grantTestCoins(a: RoarTestAccount, n: number, at: number): RoarTestAccount {
  if (!isNonNegInt(n) || n < 1) return a;
  const coins = Math.min(a.coins + n, MAX_TEST_COINS);
  const added = coins - a.coins;
  if (added === 0) return { ...a, seeded: true };
  return { ...a, coins, seeded: true, receipts: [...a.receipts, { kind: 'grant', id: receiptId(a, at), at, coins: added }] };
}

/** `?testcoins`' first visit: seeds the wallet once, never again on a reload. */
export function seedTestCoins(a: RoarTestAccount, n: number, at: number): RoarTestAccount {
  return a.seeded ? a : grantTestCoins(a, n, at);
}

/** Buys a unit with coins. It refuses (`ok: false`, the same object back) when
 *  the price is not positive, the unit is already coin-bought, or the wallet
 *  is short. Whether the unit is FOR SALE at all is the caller's question,
 *  answered by the Stores' own `storeItems`, so the screen and the purchase
 *  cannot disagree. */
export function buyUnitWithCoins(
  a: RoarTestAccount,
  unitId: string,
  coins: number,
  credits: number,
  at: number
): { account: RoarTestAccount; ok: boolean } {
  if (!isNonNegInt(coins) || coins < 1) return { account: a, ok: false };
  if (a.entitlements.units[unitId] !== undefined) return { account: a, ok: false };
  if (a.coins < coins) return { account: a, ok: false };
  return {
    account: {
      ...a,
      coins: a.coins - coins,
      entitlements: { ...a.entitlements, units: { ...a.entitlements.units, [unitId]: { coins: true } } },
      receipts: [...a.receipts, { kind: 'unit', id: receiptId(a, at), at, unitId, coins, credits }],
    },
    ok: true,
  };
}

/** Buys exactly the next tier of a track with coins. `tier` must be
 *  `current + 1`, where `current` is the SINGLE-PLAYER tier,
 *  `max(earned, coins)`. It refuses the same way `buyUnitWithCoins` does. */
export function buyTierWithCoins(
  a: RoarTestAccount,
  unitId: string,
  track: string,
  tier: number,
  current: number,
  coins: number,
  credits: number,
  at: number
): { account: RoarTestAccount; ok: boolean } {
  if (!isNonNegInt(coins) || coins < 1) return { account: a, ok: false };
  if (tier !== current + 1) return { account: a, ok: false };
  if (a.coins < coins) return { account: a, ok: false };
  const tracks = a.entitlements.upgrades[unitId] ?? {};
  return {
    account: {
      ...a,
      coins: a.coins - coins,
      entitlements: {
        ...a.entitlements,
        upgrades: { ...a.entitlements.upgrades, [unitId]: { ...tracks, [track]: { coins: tier } } },
      },
      receipts: [...a.receipts, { kind: 'tier', id: receiptId(a, at), at, unitId, track, tier, coins, credits }],
    },
    ok: true,
  };
}

type Tiers = Record<string, Record<string, number>>;
type EarnedHalf = Pick<BrigadeAccount, 'unlocks' | 'upgrades'>;

/** The coin path's tiers as a plain tier map. */
export function coinTiers(a: RoarTestAccount): Tiers {
  const out: Tiers = {};
  for (const [unit, tracks] of Object.entries(a.entitlements.upgrades)) {
    out[unit] = {};
    for (const [track, v] of Object.entries(tracks)) out[unit][track] = v.coins;
  }
  return out;
}

/** Spec §1.5's shape: every entitlement with its source. For a unit, `earned`
 *  means the brigade account's credit purchase (`unlocks`). A gate that play
 *  opened is not an entitlement anyone holds; it is read from the ledger,
 *  where the gate is. */
export function entitlementsOf(
  account: EarnedHalf,
  roar: RoarTestAccount
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
  for (const [u, tracks] of Object.entries(roar.entitlements.upgrades)) for (const [t, v] of Object.entries(tracks)) touch(u, t).coins = v.coins;
  return { units, upgrades };
}

function view(account: EarnedHalf, roar: RoarTestAccount, coinsCount: boolean): { boughtUnits: Set<string>; ownedTiers: Tiers } {
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
export function singlePlayerView(account: EarnedHalf, roar: RoarTestAccount): { boughtUnits: Set<string>; ownedTiers: Tiers } {
  return view(account, roar, true);
}

/** Network play (co-op, skirmish, 1v1): `earned` only (spec §1.5, 1 Oct ruling 3). */
export function networkView(account: EarnedHalf, roar: RoarTestAccount): { boughtUnits: Set<string>; ownedTiers: Tiers } {
  return view(account, roar, false);
}
