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
export const ROSTER_CAP = 150;
