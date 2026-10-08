// The garage's decisions, as pure functions (garage uplift §3.5, §4). The DOM
// layer (`brigade.ts`) asks these and paints the answer.

/** The unit that stays in the bay across a re-render: the same one while it
 *  is still on the roster (F3: a buy used to land the bay on the first card). */
export function retainSelection(prev: string, ids: readonly string[]): string {
  return ids.includes(prev) ? prev : (ids[0] ?? '');
}

/** The rail card's status chip (R-11): Locked outranks everything a locked
 *  unit might also read as (a bought-then-relocked D1 unit, say), and among
 *  the available three, Maxed outranks Bought outranks Earned -- a unit
 *  bought AND fully kitted reads as Maxed, not Bought. */
export type CardStatus = 'locked' | 'maxed' | 'bought' | 'earned';

export function cardStatus(s: { locked: boolean; bought: boolean; maxed: boolean }): CardStatus {
  if (s.locked) return 'locked';
  if (s.maxed) return 'maxed';
  if (s.bought) return 'bought';
  return 'earned';
}

/** Where focus goes after a re-render the control with key `asked` caused
 *  (R-4). A Buy's key names its TRACK, so the same key is the next tier's
 *  Buy; when that track is maxed, the track itself; when a unit Buy has done
 *  its job, the first tier Buy the unit now shows; failing all of those, the
 *  unit's own card. */
export function restoreFocus(asked: string | null, present: readonly string[], selectedId: string): string | null {
  if (asked === null) return null;
  const has = (k: string): boolean => present.includes(k);
  if (has(asked)) return asked;
  if (asked.startsWith('buy:')) {
    const track = `track:${asked.slice(4)}`;
    if (has(track)) return track;
  }
  if (asked === 'unit-buy') {
    const firstBuy = present.find((k) => k.startsWith('buy:'));
    if (firstBuy !== undefined) return firstBuy;
  }
  const card = `card:${selectedId}`;
  return has(card) ? card : null;
}

/** A roving tab stop's next position (WP-S3g T9, F8): the arrows move and
 *  wrap, `Home`/`End` jump to an end, and everything else is not this
 *  control's key. `at` of `-1` (nothing in this list is focused yet) starts
 *  at the end the direction of travel would reach first, and an empty list
 *  has no position to move to at all. Shared by the rail's tabs (Left/Right
 *  only, from `brigade.ts`'s own key filter) and its cards (all four). */
export function rovingStep(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowDown' || key === 'ArrowRight') return at < 0 ? 0 : (at + 1) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return at < 0 ? count - 1 : (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** The rail sorted by kit level (GH-243, spec §4 "Comparison": "the rail can
 *  sort by kit level beside role"): most kitted first, and equals keep the
 *  order they were handed in -- the rail's own order (available first, locked
 *  by the gate that opens soonest) is the tiebreak, so the sort never
 *  invents a second answer to "which of these two comes first". A copy;
 *  the input is never reordered in place. */
export function sortByKit<T>(items: readonly T[], level: (item: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i, l: level(item) }))
    .sort((a, b) => b.l - a.l || a.i - b.i)
    .map((e) => e.item);
}

/** A digit key onto the board's own tracks, in the order the board actually
 *  drew them (F8): `'2'` is the SECOND track this unit's board has, never a
 *  fixed armour/sensors/firepower slot -- a unit missing a track shifts every
 *  digit after it. `null` for anything that is not a bare digit 1-9, or for a
 *  digit past however many tracks this board drew. */
export function trackForDigit(key: string, tracks: readonly string[]): string | null {
  if (!/^[1-9]$/.test(key)) return null;
  return tracks[Number(key) - 1] ?? null;
}

/** What a Buy asked the store for (§3.5): a unit's own unlock, or one tier of
 *  one of its tracks. `answer()` in `brigade.ts` holds it across the redraw
 *  so `celebrate` knows what to stamp -- WHETHER to is the caller's own word,
 *  `GarageState.landed` (final review M1), never read back off the account. */
export type PurchaseAsk =
  | { readonly kind: 'unit'; readonly unitId: string }
  | { readonly kind: 'upgrade'; readonly unitId: string; readonly track: string; readonly tier: number };

/** The sounds a purchase makes (§3.5), one per kind of thing bought: a unit, a
 *  tier, and (GH-238 K10) a tier that bolts a part onto a vehicle. */
export type PurchaseCue = 'purchase' | 'upgrade' | 'kit';

/** Each cue's manifest set, by name -- what Task 11 hands `playUi`. Three sets,
 *  never one: a unit, a tier and a part fitted are different news. */
export const CUE_SET: Readonly<Record<PurchaseCue, string>> = {
  purchase: 'ui_purchase',
  upgrade: 'ui_upgrade',
  kit: 'ui_kit_fitted',
};

/** The eight vehicles whose every tier of every track adds a part to the model
 *  (GH-238 plan 3, spec §8): buying a tier on one of these is the "kit fitted"
 *  cue. A type outside the set (infantry, the drones) gets a plain upgrade.
 *  Hand-kept on purpose and pinned to the plan's list by `garage-model.test.ts`. */
export const KIT_VEHICLE_TYPES: ReadonlySet<string> = new Set([
  'mbt_lavi',
  'ifv_namer',
  'apc_eitan',
  'apc_kipod',
  'jeep_shoded',
  'scout_shachaf',
  'dozer_d9',
  'heli_peten',
]);

/** Spec §6's numbers. The stamp sits inside the wallet's 600 ms spend beat,
 *  and the count (400) lands after the bars (300). */
export const STAMP_MS = 240;
export const BAR_GROW_MS = 300;
export const WALLET_COUNT_MS = 400;

export function cueFor(ask: PurchaseAsk): PurchaseCue {
  if (ask.kind === 'unit') return 'purchase';
  return KIT_VEHICLE_TYPES.has(ask.unitId) ? 'kit' : 'upgrade';
}

/** The wallet's figure `elapsedMs` into a `durMs` count from `from` to `to`:
 *  an ease-out cubic (fast off the mark, settling onto the balance), in whole
 *  credits, clamped to `from` before the window and to `to` after it. Because
 *  it reads elapsed time rather than counting frames, a dropped frame costs a
 *  step, never the landing -- the last frame always reads `to`. */
export function countAt(from: number, to: number, elapsedMs: number, durMs: number): number {
  if (durMs <= 0 || elapsedMs >= durMs) return to;
  if (elapsedMs <= 0) return from;
  const p = elapsedMs / durMs;
  const eased = 1 - (1 - p) ** 3;
  return Math.round(from + (to - from) * eased);
}
