// The Stores' pure half (GH-317): prices, item states and the honest line,
// derived from the unit JSON and the account at LOAD time. Nothing here is a
// hand-keyed price: every coin figure is `coinPrice(credits)` of a credit
// price the unit's own JSON authors, so a retuned unit re-prices itself.
//
// Without `?testcoins` this is a PREVIEW (spec 2026-10-01 decision 10, as
// amended by the lead on 2 Oct): the balance reads 0 and no Buy and no pack
// is ever enabled. With it (the lead's go-ahead, 2 Oct), a local TEST wallet
// (`roar-test.ts`) buys what credits buy at 1 coin = 10 credits. Real-money
// packs stay disabled either way: `PURCHASES_OPEN` is false. `buyEnabled` is
// the one predicate every Buy control asks.
import { conductAtLeast, isBoughtOnly, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';
import type { UpgradeTracks } from '@lions/data';
import { buyTierWithCoins, buyUnitWithCoins, type RoarTestAccount } from '../roar-test';

/** Spec §1.3, decision 1 (the lead's ruling): 1 Roar coin = 10 credits. */
export const CREDITS_PER_COIN = 10;
/** Coin prices are multiples of this (spec §1.4 / §5.2: "no orphans"). */
export const COIN_STEP = 5;

/** A credit price in Roar coins: `credits / 10`, rounded UP to a multiple of
 *  5. Integer arithmetic only, so 850 credits is exactly 85 coins and 851 is
 *  90 -- never 85.1 rounded to taste. */
export function coinPrice(credits: number): number {
  if (!Number.isInteger(credits) || credits <= 0) return 0;
  const unit = CREDITS_PER_COIN * COIN_STEP;
  return Math.ceil(credits / unit) * COIN_STEP;
}

/** Spec §1.4, decision 2. Money, not a credit price, so it is a table; the
 *  bonus is DERIVED from the coins against the Patrol pack's own rate rather
 *  than typed beside them, so the two cannot disagree. */
export interface CoinPack {
  readonly id: 'patrol' | 'company' | 'brigade' | 'division';
  readonly coins: number;
  /** US cents. Valve sets the regional prices (ST7). */
  readonly usdCents: number;
}
export const COIN_PACKS: readonly CoinPack[] = [
  { id: 'patrol', coins: 500, usdCents: 499 },
  { id: 'company', coins: 1100, usdCents: 999 },
  { id: 'brigade', coins: 2400, usdCents: 1999 },
  { id: 'division', coins: 6500, usdCents: 4999 },
];

/** A pack's bonus over the Patrol pack's coins-per-dollar, in whole percent
 *  (1,100 coins for twice the Patrol's price is +10%). */
export function packBonusPercent(pack: CoinPack, base: CoinPack = COIN_PACKS[0]): number {
  const dollarsRatio = Math.round(pack.usdCents / base.usdCents);
  if (dollarsRatio <= 0) return 0;
  return Math.round((pack.coins / (base.coins * dollarsRatio) - 1) * 100);
}

/** What one campaign pays at most, measured: `pnpm playtest`'s optimal-play
 *  ladder pin (`LADDER_CREDITS` in tools/src/backtest/playtest.ts, 5,736 over
 *  the 26 missions in `world.json`), and pinned to it as text by
 *  `tools/src/campaign_credits.test.ts`, so a ladder re-pin that forgets this
 *  copy goes red. Since GH-330 a new campaign pays again, so this is a PER
 *  CAMPAIGN figure, not a lifetime: every credit price is reachable by play in
 *  a finite number of campaigns, and guard G1 (spec §1.7) keeps no credit item
 *  off sale. (It was `LIFETIME_CREDITS = 5849`, stale since GH-345 moved the
 *  ladder, with nothing pinning it.) */
export const CAMPAIGN_CREDITS = 5701;
/** The same ladder's mission count, for a mean pay a fresh account can quote
 *  before it has been paid for anything. */
export const LADDER_MISSIONS = 26;

/** What the screen and the derivation both read. Every field is the account
 *  or the ledger as it stands; nothing is a fixture. */
export interface StoreInput {
  readonly units: readonly StoreUnit[];
  readonly ledger: LedgerData;
  /** The brigade's earned credits on hand; `undefined` with no account. */
  readonly credits: number | undefined;
  /** Unit id -> track -> tier owned (earned). */
  readonly owned: Readonly<Record<string, Readonly<Record<string, number>>>> | undefined;
  /** What the account has been paid so far, for the player's own mean pay.
   *  Absent: the ladder mean. */
  readonly paid?: Readonly<Record<string, number>>;
  /** The coin half (`roar-test.ts`). Absent: nothing was bought with coins,
   *  and `owned` and every `unlock.bought` are the earned half alone. When
   *  present, `owned` and `unlock.bought` are the SINGLE-PLAYER view (earned
   *  OR coins), and these say which part of it came from coins. */
  readonly coin?: CoinHalf;
}

export interface CoinHalf {
  /** Units the brigade account bought with credits (earned). */
  readonly earnedUnits: ReadonlySet<string>;
  /** Units bought with coins. */
  readonly coinUnits: ReadonlySet<string>;
  /** Tiers reached on each path. */
  readonly earnedTiers: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly coinTiers: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface StoreUnit {
  readonly id: string;
  readonly name: string;
  /** The unit's gate as the garage resolves it (`bought` from the account). */
  readonly unlock?: UnlockGate;
  readonly upgrades?: UpgradeTracks;
}

/** An item's state, in the brief's own three words plus the guard's fourth:
 *  `earned` (play or credits opened it), `affordable` (the earned credits on
 *  hand cover it), `locked` (they do not, or the unit must open first), and
 *  `offSale` (G1: play cannot reach it, so coins may not sell it). */
export type StoreState = 'earned' | 'coins' | 'affordable' | 'locked' | 'offSale';

/** The honest line (spec §2.4, guard G7): computed from the account, never
 *  copy. A discriminated value the screen turns into a `t()` sentence. */
export type Honest =
  | { kind: 'earnedGate' }
  | { kind: 'earnedCredits' }
  | { kind: 'earnedStart' }
  | { kind: 'coins' }
  | { kind: 'owned' }
  | { kind: 'conduct'; floor: number }
  | { kind: 'stars'; missions: number; have: number; need: number }
  | { kind: 'mission'; missionId: string }
  | { kind: 'pay'; missions: number }
  | { kind: 'payNow' }
  | { kind: 'unlockFirst' }
  | { kind: 'unreachable'; lifetime: number };

export interface UnitItem {
  readonly kind: 'unit';
  readonly id: string;
  readonly name: string;
  readonly state: StoreState;
  /** `undefined` for a unit with no price at all (the starting roster). */
  readonly credits: number | undefined;
  readonly coins: number | undefined;
  readonly honest: Honest;
  readonly specialForces: boolean;
}

export interface TierItem {
  readonly kind: 'tier';
  readonly unitId: string;
  readonly unitName: string;
  readonly track: string;
  /** Tiers owned, and the track's length. */
  readonly owned: number;
  readonly length: number;
  /** Of `owned`, the tiers reached on the earned path (the rest are coins). */
  readonly earned: number;
  /** The next rung, or `null` when the track is maxed. */
  readonly next: { tier: number; credits: number; coins: number } | null;
  readonly state: StoreState;
  readonly honest: Honest;
}

/** Credits a mission pays on average: the account's own record when it has
 *  one, otherwise the measured ladder's mean. */
export function meanPay(paid: Readonly<Record<string, number>> | undefined): number {
  const values = Object.values(paid ?? {}).filter((v) => Number.isInteger(v) && v > 0);
  if (values.length > 0) return Math.max(1, Math.round(values.reduce((a, b) => a + b, 0) / values.length));
  return Math.round(CAMPAIGN_CREDITS / LADDER_MISSIONS);
}

/** Stars a mission earns on average for THIS player (their stars over the
 *  missions they have graded), or 3 -- the most a mission grades to -- before
 *  any is. Never below 1, so an estimate always ends. */
function starsPerMission(ledger: LedgerData): number {
  const results = ledger['campaign.mission_results'];
  const graded = results !== null && typeof results === 'object' ? Object.keys(results).length : 0;
  if (graded === 0) return 3;
  return Math.max(1, starsEarned(ledger) / graded);
}

function payLine(price: number, credits: number | undefined, mean: number): Honest {
  const short = price - (credits ?? 0);
  if (short <= 0) return { kind: 'payNow' };
  return { kind: 'pay', missions: Math.ceil(short / mean) };
}

/** The gate's own honest line for a still-closed unit, in `unlockReason`'s
 *  order (Conduct, stars, mission), else the credit path. */
function gateLine(gate: UnlockGate, input: StoreInput, mean: number): Honest {
  const { ledger } = input;
  if (gate.roeMin !== undefined && !conductAtLeast(ledger, gate.roeMin)) return { kind: 'conduct', floor: gate.roeMin };
  if (gate.starsMin !== undefined) {
    const have = starsEarned(ledger);
    if (have < gate.starsMin) {
      return { kind: 'stars', missions: Math.ceil((gate.starsMin - have) / starsPerMission(ledger)), have, need: gate.starsMin };
    }
  }
  if (gate.afterMission !== undefined) {
    const done = ledger['campaign.completed_missions'];
    if (!Array.isArray(done) || !done.includes(gate.afterMission)) return { kind: 'mission', missionId: gate.afterMission };
  }
  return payLine(gate.price ?? 0, input.credits, mean);
}

/** Whether a gate is open by PLAY alone (no purchase). */
function earnedOpen(gate: UnlockGate, ledger: LedgerData): boolean {
  if (isBoughtOnly(gate)) return false;
  if (gate.roeMin !== undefined && !conductAtLeast(ledger, gate.roeMin)) return false;
  if (gate.starsMin !== undefined && starsEarned(ledger) < gate.starsMin) return false;
  if (gate.afterMission !== undefined) {
    const done = ledger['campaign.completed_missions'];
    if (!Array.isArray(done) || !done.includes(gate.afterMission)) return false;
  }
  return true;
}

/** One unit's card. A unit with no gate at all is in the brigade from the
 *  start -- earned, unpriced. */
export function unitItem(u: StoreUnit, input: StoreInput): UnitItem {
  const mean = meanPay(input.paid);
  const gate = u.unlock;
  const price = gate?.price;
  const base = {
    kind: 'unit' as const,
    id: u.id,
    name: u.name,
    credits: price,
    coins: price === undefined ? undefined : coinPrice(price),
    specialForces: gate !== undefined && isBoughtOnly(gate),
  };
  if (gate === undefined) return { ...base, state: 'earned', honest: { kind: 'earnedStart' } };
  // Play opening the gate makes it earned even if coins bought it first
  // (spec §1.6): it counts online from then on, and no coins come back.
  if (earnedOpen(gate, input.ledger)) return { ...base, state: 'earned', honest: { kind: 'earnedGate' } };
  const coin = input.coin;
  if (gate.bought === true && (coin === undefined || coin.earnedUnits.has(u.id) || !coin.coinUnits.has(u.id))) {
    return { ...base, state: 'earned', honest: { kind: 'earnedCredits' } };
  }
  if (coin?.coinUnits.has(u.id) === true) return { ...base, state: 'coins', honest: { kind: 'coins' } };
  // G1: only an item play cannot reach goes off sale. Since GH-330 a new
  // campaign pays again, so every credit price is reachable and no credit item
  // is off sale; a bought-only unit above one campaign's pay reads the same
  // "about N missions of pay" line as any other.
  const affordable = price !== undefined && input.credits !== undefined && input.credits >= price;
  return { ...base, state: affordable ? 'affordable' : 'locked', honest: gateLine(gate, input, mean) };
}

/** One track's next rung. A locked unit's tiers are `locked` with "unlock
 *  the unit first" -- the garage's own rule (`garage.locked.unlockFirst`). */
export function tierItem(u: StoreUnit, track: string, input: StoreInput, unitOpen: boolean): TierItem {
  const tiers = u.upgrades?.[track]?.tiers ?? [];
  const owned = Math.min(input.owned?.[u.id]?.[track] ?? 0, tiers.length);
  const rung = owned < tiers.length ? tiers[owned] : undefined;
  const next = rung === undefined ? null : { tier: owned + 1, credits: rung.price, coins: coinPrice(rung.price) };
  const earned = Math.min(input.coin?.earnedTiers[u.id]?.[track] ?? owned, owned);
  const base = { kind: 'tier' as const, unitId: u.id, unitName: u.name, track, owned, earned, length: tiers.length, next };
  if (next === null) {
    return earned === tiers.length ? { ...base, state: 'earned', honest: { kind: 'owned' } } : { ...base, state: 'coins', honest: { kind: 'coins' } };
  }
  if (!unitOpen) return { ...base, state: 'locked', honest: { kind: 'unlockFirst' } };
  const affordable = input.credits !== undefined && input.credits >= next.credits;
  return { ...base, state: affordable ? 'affordable' : 'locked', honest: payLine(next.credits, input.credits, meanPay(input.paid)) };
}

/** Every item on the Early access shelf: the priced units (unlocks and the
 *  bought-only special forces), then each unit's tracks. Starting-roster
 *  units carry no unit card -- there is nothing to sell -- but their tracks
 *  do. */
export function storeItems(input: StoreInput): { units: UnitItem[]; tiers: TierItem[] } {
  const units: UnitItem[] = [];
  const tiers: TierItem[] = [];
  for (const u of input.units) {
    const item = unitItem(u, input);
    if (item.credits !== undefined) units.push(item);
    const open = item.state === 'earned' || item.state === 'coins';
    for (const track of Object.keys(u.upgrades ?? {})) tiers.push(tierItem(u, track, input, open));
  }
  return { units, tiers };
}

/** The coin wallet as the preview holds it: always 0, never written. */
export const PREVIEW_BALANCE = 0;

/** The coin wallet a Buy is asked against. `test: false` is the preview. */
export interface CoinWallet {
  readonly test: boolean;
  readonly coins: number;
}
export const PREVIEW_WALLET: CoinWallet = { test: false, coins: PREVIEW_BALANCE };

/** False until the server-held account (ST5-ST7): no REAL money moves, and no
 *  pack can be bought, TEST wallet or not. `stores.test.ts` fails if any pack
 *  enables. */
export const PURCHASES_OPEN: boolean = false;

/** The coin price of what a Buy would buy, or `null` when nothing is for sale. */
export function coinCost(item: UnitItem | TierItem): number | null {
  if (item.state !== 'affordable' && item.state !== 'locked') return null;
  if (item.kind === 'unit') return item.coins ?? null;
  // A tier of a unit that is not open yet ("Unlock the unit first").
  if (item.honest.kind === 'unlockFirst') return null;
  return item.next?.coins ?? null;
}

/**
 * Whether a Buy (or a pack) may be pressed, against `wallet`. Every Buy and
 * pack control on the screen asks this and nothing else, which makes the
 * guards in `stores.test.ts` tests of the screen.
 *
 * - A pack is real money: enabled only once `PURCHASES_OPEN`, never by a
 *   TEST wallet.
 * - An item needs a TEST wallet (`?testcoins`), an item for sale (G1 keeps
 *   `offSale` off; earned and coin-bought items have nothing left to buy),
 *   and coins enough to cover it. Without `?testcoins` this is `false` for
 *   every item: the preview.
 */
export function buyEnabled(item: UnitItem | TierItem | CoinPack, wallet: CoinWallet = PREVIEW_WALLET): boolean {
  if ('usdCents' in item) return PURCHASES_OPEN;
  if (!wallet.test) return false;
  const cost = coinCost(item);
  return cost !== null && cost > 0 && wallet.coins >= cost;
}


/** What a TEST-coin Buy asks for. */
export type CoinAsk =
  | { kind: 'unit'; unitId: string }
  | { kind: 'tier'; unitId: string; track: string; tier: number };

/**
 * A TEST-coin purchase, decided by the SAME derivation the screen draws from:
 * the item is found in `storeItems(input)`, and `buyEnabled` against the TEST
 * wallet must say yes. So the screen and the purchase cannot disagree --
 * nothing earned, coin-bought, off sale (G1), unopened ("unlock the unit
 * first") or unaffordable is ever bought, and a stale ask (two tabs) is
 * refused. The coin price is the item's own `coinPrice` of its JSON price;
 * the ask carries no price at all. Writes only the TEST wallet: credits, and
 * the brigade account, are untouched.
 */
export function buyWithTestCoins(
  input: StoreInput,
  roar: RoarTestAccount,
  ask: CoinAsk,
  at: number
): { account: RoarTestAccount; ok: boolean } {
  const refuse = { account: roar, ok: false };
  const wallet: CoinWallet = { test: true, coins: roar.coins };
  const items = storeItems(input);
  if (ask.kind === 'unit') {
    const item = items.units.find((u) => u.id === ask.unitId);
    if (item === undefined || !buyEnabled(item, wallet) || item.coins === undefined || item.credits === undefined) return refuse;
    return buyUnitWithCoins(roar, item.id, item.coins, item.credits, at);
  }
  const item = items.tiers.find((x) => x.unitId === ask.unitId && x.track === ask.track);
  if (item === undefined || item.next === null || item.next.tier !== ask.tier || !buyEnabled(item, wallet)) return refuse;
  return buyTierWithCoins(roar, item.unitId, item.track, item.next.tier, item.owned, item.next.coins, item.next.credits, at);
}
