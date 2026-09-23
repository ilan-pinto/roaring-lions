// packages/app/src/ui/deploy-select.ts
/**
 * The choice, and the permutation it becomes (spec Decision 4, plan R-3/R-4,
 * shell-upgrade Phase 3 app, Task 2).
 *
 * The player's choice on the deploy screen is "which of my three `inf_squad`
 * go, given the mission fields two". `MissionRuntime.spawnPlacement`'s draw
 * (`drawFromPool`, `./deploy-roster.ts`, mirroring `mission.ts:1256-1263`) is
 * "the first two `inf_squad` in pool order". So the choice IS an ordering:
 * this module's whole job is to turn a set of picks into a PERMUTATION of the
 * pool that contains every original entry exactly once, and hand that
 * permuted pool to the unchanged draw rule -- never a filter over the pool,
 * which would be a second, divergent draw.
 *
 * Why a permutation and not a smaller list: `checkEnd` (`mission.ts:1887`)
 * writes whatever is left of the runtime's own pool copy straight back into
 * the campaign ledger --
 *
 *   for (const left of this.rosterPool) roster.push({ ...left });
 *
 * -- so an entry this module drops, duplicates or invents on the way in is a
 * veteran gained or deleted from the player's brigade forever, not a UI
 * glitch. `permutePool`'s tests check that property directly (every entry
 * survives, exactly once) rather than trusting the row-by-row reordering.
 */
import type { LedgerRosterEntry } from '@lions/sim';
import { drawFromPool, type DeployEntry, type DeployRosterView } from './deploy-roster';

/** The player's picks, as pool indices -- the same handle `DeployEntry.poolIndex`
 *  and `drawFromPool`'s own return use, because an index survives a
 *  permutation of the pool and a copied entry does not. */
export interface DeploySelection {
  readonly chosen: ReadonlySet<number>;
}

/** `sel.chosen` is an open `ReadonlySet<number>`, not a value this module
 *  minted -- a stale selection carried over from a longer pool (a previous
 *  mission's roster, before losses shrank it) or a UI bug can hand either
 *  function here an index that is negative, fractional, or past the end of
 *  `pool`. Both `permutePool` and `toggleEntry` filter through this before
 *  touching `pool` by index: an out-of-range value is dropped, never
 *  thrown on, and dropping it changes nothing else -- the entry it would
 *  have named simply keeps its default (unchosen) treatment. (Code review,
 *  fix round 1: `permutePool(pool, { chosen: new Set([99]) })` used to throw
 *  reading `pool[99].type`.) */
function sanitizeChosen(chosen: ReadonlySet<number>, length: number): Set<number> {
  const valid = new Set<number>();
  for (const idx of chosen) {
    if (Number.isInteger(idx) && idx >= 0 && idx < length) valid.add(idx);
  }
  return valid;
}

/** Every pool entry the view classified, restored to pool order. `eligible`
 *  and `undrawable` between them cover the whole original pool exactly once
 *  (`deployRosterView`'s single `pool.forEach`), so sorting the two lists
 *  back together by `poolIndex` reconstructs it -- position `i` of the
 *  result is the original pool's entry `i`. */
function wholePool(view: DeployRosterView): readonly DeployEntry[] {
  return [...view.eligible, ...view.undrawable].sort((a, b) => a.poolIndex - b.poolIndex);
}

/**
 * Opening the deploy screen and touching nothing must field exactly what the
 * mission would field with no screen at all -- anything else is a silent
 * balance change. This calls `drawFromPool` itself rather than re-deriving
 * the rule: a `LedgerRosterEntry[]` stand-in for the pool (`drawFromPool`
 * reads only `.type`, rebuilt from `wholePool`) and one synthetic
 * `from_ledger` placement per demanded type, its count the SUM `view.demand`
 * already carries. That sum is the total `drawFromPool` would draw of that
 * type regardless of how the mission's own placements interleaved it with
 * other types: removing an entry of one type from the pool never moves
 * another type's entries relative to each other, so "how many of type T get
 * drawn in total" depends only on the summed count, never on placement
 * order -- one placement per type is exactly as faithful as the real list.
 */
export function defaultSelection(view: DeployRosterView): DeploySelection {
  const pool: LedgerRosterEntry[] = wholePool(view).map((e) => ({ type: e.type, veterancy: e.veterancy }));
  const starting_force = [...view.demand].map(([unit, count]) => ({ unit, count, from_ledger: true as const }));
  return { chosen: new Set(drawFromPool(pool, starting_force)) };
}

/** How many more of `type` the mission still wants, given what is chosen so
 *  far. Never negative in practice -- `toggleEntry` never lets `chosen` grow
 *  past a type's demand -- but a type outside `view.demand` also reads 0
 *  here (nothing to fill, and nothing of it is ever chosen), so callers
 *  should treat `<= 0` as "full", not `=== 0` alone. */
export function slotsLeft(view: DeployRosterView, sel: DeploySelection, type: string): number {
  const demand = view.demand.get(type) ?? 0;
  let chosenOfType = 0;
  for (const e of view.eligible) {
    if (e.type === type && sel.chosen.has(e.poolIndex)) chosenOfType++;
  }
  return demand - chosenOfType;
}

/**
 * Toggle one pool entry on or off. Benching a chosen entry always succeeds --
 * it only ever frees a slot. Fielding an unchosen one succeeds only while its
 * type still has a slot open (`slotsLeft(view, sel, entry.type) > 0`): the
 * mission's own `starting_force` counts are the only source of how many
 * bodies of a type are wanted (spec §8), so a screen that let the player
 * exceed them would be authoring `starting_force` from the UI. An index no
 * placement can draw at all -- absent from `view.eligible` -- is refused the
 * same way. Both refusals return the SAME `sel` reference, not an equal
 * copy, so a caller can tell "nothing changed" without a deep comparison.
 *
 * `sel.chosen` is sanitized (see `sanitizeChosen`) before it is read for
 * anything but the refusal checks above, so a stale or out-of-range index
 * riding along in `sel` never survives into the returned selection, and
 * every acceptance builds a fresh `Set` rather than mutating `sel.chosen`.
 */
export function toggleEntry(view: DeployRosterView, sel: DeploySelection, poolIndex: number): DeploySelection {
  const entry = view.eligible.find((e) => e.poolIndex === poolIndex);
  if (entry === undefined) return sel;

  const chosen = sanitizeChosen(sel.chosen, view.eligible.length + view.undrawable.length);

  if (chosen.has(poolIndex)) {
    chosen.delete(poolIndex);
    return { chosen };
  }

  if (slotsLeft(view, { chosen }, entry.type) <= 0) return sel;
  chosen.add(poolIndex);
  return { chosen };
}

/**
 * The screen may not deploy short: true only once every demanded type is
 * either fully chosen (`slotsLeft <= 0`) or has no more ELIGIBLE bodies left
 * to give it at all. The second clause is the sparse-roster case
 * `spawnPlacement` already handles by substituting one fresh remnant
 * (`mission.ts:1264`) -- the screen must not block on a pool that simply
 * cannot fill a slot.
 */
export function isComplete(view: DeployRosterView, sel: DeploySelection): boolean {
  for (const type of view.demand.keys()) {
    if (slotsLeft(view, sel, type) <= 0) continue;
    let totalOfType = 0;
    let chosenOfType = 0;
    for (const e of view.eligible) {
      if (e.type !== type) continue;
      totalOfType++;
      if (sel.chosen.has(e.poolIndex)) chosenOfType++;
    }
    if (chosenOfType < totalOfType) return false;
  }
  return true;
}

/**
 * The choice, made real: a permutation of `pool` -- every entry exactly
 * once, nothing invented, nothing dropped -- ordered so `drawFromPool`'s
 * existing per-type "first in pool order" rule draws exactly the chosen
 * bodies.
 *
 * **The method (fix round 1 rewrite).** Every pool position belongs to
 * exactly one type, so group the positions themselves by type first --
 * `positionsOf(type)`, ascending, the SAME slots that type already owns in
 * `pool`. A type nobody chose any of keeps its positions untouched (its
 * entries are copied straight from `pool`, in place). A type `sel.chosen`
 * touches gets its own entries reordered -- chosen ones (pool order) before
 * unchosen ones (pool order) -- and that reordered list is written back
 * into that SAME set of positions, in order. Because a type's entries only
 * ever move among that type's own positions, this is a permutation by
 * construction: it can no more duplicate or lose an entry than a bag of
 * marbles sorted by colour can, and no `view` parameter is needed (pre-flight
 * scan P1) -- "the view has demand for a type" and "`sel.chosen` holds at
 * least one of that type's indices" are the same set, because `sel.chosen`
 * only ever admits indices through `view.eligible`.
 *
 * **Why this reorders correctly and not merely plausibly.** For the DEFAULT
 * selection, `defaultSelection` always chooses exactly the earliest
 * `demand(type)` entries of a type in pool order (or all of them, if the
 * pool has fewer) -- so "chosen before unchosen, in pool order" reproduces
 * that type's original order exactly, and since every other type's
 * positions are untouched, the WHOLE array comes back byte-identical to
 * `pool`, even when types are interleaved rather than grouped. (The
 * earlier append-by-type-group implementation did not have this property:
 * for `pool = [A0, B0, A1, B1]` with both types demanded one each, it
 * returned `[A0, A1, B0, B1]` for the default selection -- a valid
 * permutation, but not the identity, because it moved every A ahead of
 * every B. The property test below is what caught this.) For any OTHER
 * selection, the same argument shows `drawFromPool` -- which always takes a
 * type's entries in ascending array-position order -- draws that type's
 * chosen entries before any unchosen ones, because chosen entries occupy
 * that type's earliest positions by construction.
 *
 * **Bounds.** `sel.chosen` is sanitized first (see `sanitizeChosen`): an
 * index outside `[0, pool.length)` is dropped rather than read, so a stale
 * selection built against a longer pool degrades to the default order for
 * the entries it can no longer address, instead of throwing.
 *
 * Returns a fresh, MUTABLE array (pre-flight scan P5/E11): a `readonly T[]`
 * does not assign into `LedgerData['roster.surviving_units']`
 * (`LedgerRosterEntry[]`) or its app-side widening `RosterEntry[]`, so the
 * return type is generic and mutable rather than `readonly LedgerRosterEntry[]`
 * as the brief first wrote it -- the generic also keeps a `RosterEntry`'s
 * `slot` typed through rather than erasing it to the base interface. Entries
 * are copied by REFERENCE, never cloned: they are treated as immutable
 * everywhere already, and `mission.ts:1887` spreads them into the next
 * ledger regardless of which array object they arrived in.
 */
export function permutePool<T extends LedgerRosterEntry>(pool: readonly T[], sel: DeploySelection): T[] {
  const chosen = sanitizeChosen(sel.chosen, pool.length);

  const positionsByType = new Map<string, number[]>();
  pool.forEach((entry, i) => {
    const positions = positionsByType.get(entry.type);
    if (positions) positions.push(i);
    else positionsByType.set(entry.type, [i]);
  });

  const out: T[] = pool.slice();
  for (const positions of positionsByType.values()) {
    if (!positions.some((i) => chosen.has(i))) continue; // untouched type -- its positions keep `pool`'s own entries

    const chosenEntries: T[] = [];
    const unchosenEntries: T[] = [];
    for (const i of positions) (chosen.has(i) ? chosenEntries : unchosenEntries).push(pool[i]);
    const reordered = [...chosenEntries, ...unchosenEntries];
    positions.forEach((pos, k) => {
      out[pos] = reordered[k];
    });
  }
  return out;
}
