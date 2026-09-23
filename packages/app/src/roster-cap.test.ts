// packages/app/src/roster-cap.test.ts
import { describe, expect, it } from 'vitest';
import { ROSTER_CAP, rosterOrder, splitRoster } from './roster-cap';
import type { RosterEntry } from './ledger-store';

describe('ROSTER_CAP', () => {
  // The page's rule: "the cap should sit above what a ★★★ campaign accumulates,
  // not below it." The largest roster any threaded chain in `pnpm playtest`
  // produces is 30 (umm_zeitoun_4_clearance, 2026-09-20); the loose
  // sum-of-chain-maxima ceiling, which assumes zero cross-chain draw-down and is
  // therefore an over-estimate, is 126. The harness re-checks the first of those
  // on every push; this pins the DECISION so a silent edit to the constant is a
  // red test rather than a shipped design change.
  it('is 150 -- above the measured 30 and above the loose 126 ceiling', () => {
    expect(ROSTER_CAP).toBe(150);
    expect(ROSTER_CAP).toBeGreaterThan(126);
  });
});

const e = (slot: number, o: Partial<RosterEntry> = {}): RosterEntry =>
  ({ type: 'inf_squad', veterancy: 0, missions: 1, kills: 0, slot, ...o });
const many = (n: number, from = 0): RosterEntry[] => Array.from({ length: n }, (_, i) => e(from + i));

describe('rosterOrder — veterans stay, newest-in falls first (R-4)', () => {
  it('sorts by veterancy, then missions, then kills, then slot ascending', () => {
    const rookie = e(9);
    const vet = e(1, { veterancy: 2 });
    const served = e(2, { missions: 6 });
    const killer = e(3, { kills: 40 });
    expect([rookie, vet, served, killer].sort(rosterOrder).map((r) => r.slot)).toEqual([1, 2, 3, 9]);
  });

  // The tiebreak is what makes "newest falls first" EXACT rather than a
  // sentiment: two identical rookies differ only by when they joined, and the
  // slot counter is the only chronology the roster carries (array order is not
  // -- checkEnd writes survivors first and the unfielded pool after).
  it('breaks a total tie by slot, oldest first', () => {
    expect([e(12), e(3), e(7)].sort(rosterOrder).map((r) => r.slot)).toEqual([3, 7, 12]);
  });

  it('is a total order: no two distinct entries compare equal', () => {
    const all = [e(1), e(2, { veterancy: 1 }), e(3, { missions: 4 }), e(4, { kills: 2 })];
    for (const a of all) for (const b of all) if (a.slot !== b.slot) expect(rosterOrder(a, b)).not.toBe(0);
  });
});

describe('splitRoster', () => {
  // Final review, Important 2. ORDER is gameplay: `spawnPlacement` draws the FIRST
  // entry of a type in pool order (`mission.ts:1262`), so a split that re-sorted
  // the active list would field a campaign's most veteran unit of each type first
  // on every victory -- a design change nobody declared, and one `pnpm playtest`
  // cannot see because the harness never runs this seam. The input is deliberately
  // NOT in `rosterOrder`, or a sort would hand it back unchanged and pass.
  it('leaves a roster under the cap alone -- same entries, same order -- and reports an empty reserve', () => {
    const input = [e(5), e(2, { veterancy: 2 }), e(9), e(1, { kills: 4 })];
    const got = splitRoster(input, [], ROSTER_CAP);
    expect(got.active).toEqual(input);
    expect(got.reserve).toHaveLength(0);
  });

  // The off-by-one, both sides of it. `cap` entries is AT the cap and nothing
  // falls; `cap + 1` puts exactly one down.
  it('keeps exactly cap and stands down exactly the rest', () => {
    expect(splitRoster(many(5), [], 5).reserve).toHaveLength(0);
    expect(splitRoster(many(6), [], 5).active).toHaveLength(5);
    expect(splitRoster(many(6), [], 5).reserve).toHaveLength(1);
    expect(splitRoster(many(11), [], 5).reserve).toHaveLength(6);
  });

  // `rosterOrder` decides WHO stays; the kept entries keep their input order.
  it('stands down the newest and keeps the veterans, in the order they came in', () => {
    const got = splitRoster([e(1), e(2), e(3, { veterancy: 3 })], [], 2);
    expect(got.active.map((r) => r.slot)).toEqual([1, 3]);
    expect(got.reserve.map((r) => r.slot)).toEqual([2]);
  });

  // #174's rule, as arithmetic rather than intent: nothing is ever deleted.
  it('is length-preserving over the whole population, always', () => {
    for (const [a, r, cap] of [[30, 0, 150], [200, 0, 150], [100, 100, 150], [0, 9, 150]] as const) {
      const got = splitRoster(many(a), many(r, 1000), cap);
      expect(got.active.length + got.reserve.length).toBe(a + r);
    }
  });

  // R-4: the split reads the WHOLE brigade, so "never deleted" also means "never
  // permanently benched". A veteran standing down while the active list is full
  // comes back the moment losses make room -- at the END of the active list, so
  // the entries that never left keep the places in the draw order they had.
  it('recalls from reserve when the active list has fallen below the cap, appended last', () => {
    const got = splitRoster([e(1), e(2)], [e(3, { veterancy: 2 })], 3);
    expect(got.active.map((r) => r.slot)).toEqual([1, 2, 3]);
    expect(got.reserve).toHaveLength(0);
  });

  // ...and cannot churn: nothing about a stood-down entry changes while it is
  // stood down, so it can only ever move UP, and only when something above it dies.
  it('is idempotent — splitting its own output changes nothing', () => {
    const once = splitRoster(many(8), [], 5);
    const twice = splitRoster(once.active, once.reserve, 5);
    expect(twice).toEqual(once);
  });

  it('defaults to ROSTER_CAP when no cap is given', () => {
    expect(splitRoster(many(ROSTER_CAP + 3), []).reserve).toHaveLength(3);
  });

  // R-7. The bytes a pre-change build wrote, with slots already issued by Task 3
  // and no `roster.reserve` key at all: an absent reserve reads as empty and the
  // first WRITE is what splits, not the load.
  it('treats an absent reserve as empty and backfills on the first write', () => {
    const ledger: { 'roster.reserve'?: RosterEntry[] } = {};
    const got = splitRoster(many(7), ledger['roster.reserve'] ?? [], 5);
    expect(got.active).toHaveLength(5);
    expect(got.reserve.map((r) => r.slot)).toEqual([5, 6]);
  });
});
