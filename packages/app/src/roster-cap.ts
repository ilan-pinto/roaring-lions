// packages/app/src/roster-cap.ts
/**
 * The roster and reserve cap (WP-G-E2, gate G0 #12: "measure first; cap
 * above a ★★★ campaign; reserve list").
 *
 * `roster.surviving_units` only ever appends (CLAUDE.md, "known scaling
 * debts" -- it is CUMULATIVE, never rebuilt), so a campaign's roster grows
 * without bound across a chain of missions unless something caps it. Task 2
 * measured the ladder before naming a number: `pnpm playtest` prints one
 * `roster total: <town> max N over M missions` line per town chain (the same
 * region -> town walk `missionOrder` performs), then one
 * `roster maximum: N at <missionId>` line over all of them -- the largest
 * `roster out` any winning plan produces, since a defeat writes nothing to a
 * real ledger and a control or probe is excluded by the same `label === id`
 * guard `missionStars` uses.
 *
 * Measured 2026-09-20 at a567b892: **30**, at `umm_zeitoun_4_clearance`. Per
 * chain: Beit Sahwan 25 / Wadi Halam 14 / Khan Rafid 11 / Deir Amun 12 /
 * Tel Marum 10 / Qarn Hadid 24 / Umm Zeitoun 30. `tools/src/backtest/
 * playtest.ts` pins this as `ROSTER_MAX` beside `LADDER_CREDITS` and goes red
 * if the measured maximum ever moves without this file being told.
 *
 * `ROSTER_CAP` is set above that measurement with two margins, not one:
 *
 * - **5.0x the measured maximum** (30).
 * - **1.19x a deliberately loose sum-of-chains ceiling.** Summing every
 *   chain's own maximum as though a real campaign drew nothing forward
 *   between towns gives 25 + 14 + 11 + 12 + 10 + 24 + 30 = **126**. That sum
 *   over-estimates by construction: in a continuous campaign a later town's
 *   `from_ledger` placements draw veterans out of the pool instead of
 *   spawning fresh remnants, so each town adds *fewer* new bodies than it
 *   does measured in isolation, never more.
 *
 * It is meant not to bind in normal play -- a rail against unbounded growth
 * from replays and long play, not a design constraint on one playthrough. A
 * cap a campaign actually reaches would be a different feature and a
 * different gate. `roster-cap.test.ts` pins the decision itself, so a silent
 * edit to this constant is a red test rather than a shipped design change.
 *
 * Task 4 adds `splitRoster` (the eviction order) to this same file.
 */
import type { RosterEntry } from './ledger-store';

export const ROSTER_CAP = 150;

/**
 * R-4's total order, exported for its own spec: **veterancy descending, then
 * `missions` descending, then `kills` descending, then `slot` ascending.**
 * Veterans stay; among equals, newest-in falls first -- and `slot` is what
 * makes "newest" exact rather than a sentiment, because array order is not a
 * chronology (`checkEnd` writes fielded survivors first and the unfielded
 * pool after, `mission.ts:1874-1887`).
 *
 * `veterancy ?? 0`, `missions ?? 0`, `kills ?? 0` on every read: `missions`
 * and `kills` are optional on `LedgerRosterEntry` and a pre-change entry can
 * be missing either, or in a save written before this package existed, both.
 *
 * `slot` is the one field this comparator cannot default (GH-174): by
 * `main.ts`'s R-13 pipeline, every entry that reaches `splitRoster` has
 * already passed through `reattachSlots`/`issueSlots` (steps 3 and 6), so a
 * missing `slot` here is not a save-compatibility case to shrug at -- it is a
 * defect upstream. Removing `slot` from this comparator (falsified below)
 * does not throw; it makes the order depend on `Array.prototype.sort`'s
 * stability over whatever order the entries arrived in, which is exactly the
 * silent nondeterminism a total order exists to rule out.
 */
export function rosterOrder(a: RosterEntry, b: RosterEntry): number {
  return (
    (b.veterancy ?? 0) - (a.veterancy ?? 0) ||
    (b.missions ?? 0) - (a.missions ?? 0) ||
    (b.kills ?? 0) - (a.kills ?? 0) ||
    (a.slot ?? 0) - (b.slot ?? 0)
  );
}

/**
 * The cap, the reserve and the one-time backfill (WP-G-E2, GH-174). Takes the
 * WHOLE brigade -- `active` plus whatever is already `reserve` -- sorts it by
 * `rosterOrder` (never in place: both input arrays are the ledger's own, and
 * `main.ts` still holds them after this call returns), and slices at `cap`.
 *
 * **Recomputed from the whole population on every write.** That is what lets
 * a reserve entry come back once losses drop the active list below the cap
 * (R-4) -- the same function, one input, no separate "recall" path -- and
 * what makes the migration for a pre-change save (R-7) an ordinary write
 * rather than a special one: an absent `roster.reserve` reads as `[]` at the
 * call site and the first `missionEnd` write is what splits an oversized
 * roster, never a load.
 *
 * Length-preserving over its two inputs, always (GH-174: overflow is never
 * deleted) -- `active.length + reserve.length` in equals
 * `got.active.length + got.reserve.length` out, for any split.
 */
export function splitRoster(
  active: readonly RosterEntry[],
  reserve: readonly RosterEntry[],
  cap: number = ROSTER_CAP,
): { active: RosterEntry[]; reserve: RosterEntry[] } {
  const sorted = [...active, ...reserve].sort(rosterOrder);
  return { active: sorted.slice(0, cap), reserve: sorted.slice(cap) };
}
