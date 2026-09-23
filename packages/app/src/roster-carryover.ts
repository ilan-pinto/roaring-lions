// packages/app/src/roster-carryover.ts
/**
 * The victory write's roster half, as one pure function (final review,
 * Important 3).
 *
 * `main.ts`'s `missionEnd` seam used to run this chain inline: R-13's pipeline
 * over the roster `checkEnd` handed back, then the debrief's two memorial rows
 * read off the same intermediate arrays. Every step had a spec of its own and
 * the CHAIN had none -- which arrays feed which, which ledger `before` is read
 * off, whether the cap sees the reserve -- so a swap of two positional
 * `readonly RosterEntry[]` arguments type-checked and passed every pure spec.
 * Lifted out here, it is driven through two consecutive missions by
 * `roster-carryover.test.ts`, which is the only thing that can tell "a slot
 * was reattached" from "a slot was issued fresh and happened to match".
 *
 * **What it takes.** `before` is the ledger the mission was sent IN with --
 * the one `main.ts` read at boot, never anything written since. `produced` is
 * what `checkEnd` handed back on the `missionEnd` event (`me.ledger`), merged
 * over `before` here exactly as `main.ts` merged it (`{ ...before,
 * ...produced }`). `lostThisMission` is the memorial records `lostRecordFor`
 * captured one `unitLost` event at a time.
 *
 * **What it returns.** The next ledger, whole, for the caller to write through
 * its `LedgerStore`; and the debrief's `lostNamed` / `replacements` rows. It
 * writes nothing and reads no storage -- victory-only is the CALLER's rule,
 * because a defeat writes nothing at all (M4, no ironman) and the caller is
 * what knows which branch it is on.
 *
 * **The order, R-13's, fixed:**
 *
 * 1. the roster sent IN (`before`) and the roster `checkEnd` produced;
 * 2. `appendLost` -- this mission's memorial records, BEFORE vacancies are
 *    filled, so a slot vacated this mission can be filled this mission;
 * 3. `reattachSlots` -- a fielded survivor gets its slot back by name;
 * 4. `fillVacancies` -- a slotless body takes a vacant slot of its type;
 * 5. `issueSlots` -- anything still slotless gets a fresh id;
 * 6. `assignNames` -- `slot` first and `name` after, because identity is what
 *    a unit IS and the callsign is what it is CALLED;
 * 7. `splitRoster` -- the cap, over active plus reserve.
 *
 * A produced ledger with no roster array at all (a mission whose contract does
 * not produce `roster.surviving_units`, on a campaign that has none yet) runs
 * none of it: the merged ledger goes back untouched, with no rows.
 */
import type { CampaignLedger, LostRecord, RosterEntry } from './ledger-store';
import { assignNames, type NameKind, type NamesJson } from './names';
import { ROSTER_CAP, splitRoster } from './roster-cap';
import { appendLost, fillVacancies, predecessorOf } from './roster-lost';
import { SLOTS_ISSUED_KEY, issueSlots, reattachSlots } from './roster-slots';

export interface RosterCarryoverDeps {
  /** Which callsign table a unit type draws from (`names.ts`'s `nameKind`,
   *  closed over the unit catalogue by the caller). */
  kindOf: (typeId: string) => NameKind;
  /** The screened callsign tables `assignNames` issues from. */
  names: NamesJson;
  /** A sim type id to the name a player reads -- `units[type]?.name ?? type`
   *  in `main.ts`, the lookup `alertWorld.unitName` and the HUD card use. The
   *  debrief rows go through it; they never carry a raw type id. */
  displayName: (typeId: string) => string;
  /** The roster cap. Defaults to `ROSTER_CAP`; the spec passes a small one
   *  to make the split bind. */
  cap?: number;
}

/** One named loss for the debrief. `name` is absent for a record whose unit
 *  was never named, which a slotted entry cannot be once the pair is issued
 *  together (R-2) -- kept optional because `LostRecord` is. */
export interface LostNamedRow {
  name?: string;
  type: string;
}

/** "`name` took `predecessor`'s place", for the debrief. */
export interface ReplacementRow {
  name: string;
  predecessor: string;
}

export interface RosterCarryover {
  ledger: CampaignLedger;
  lostNamed: LostNamedRow[];
  replacements: ReplacementRow[];
}

export function applyRosterCarryover(
  before: CampaignLedger,
  produced: CampaignLedger,
  lostThisMission: readonly LostRecord[],
  deps: RosterCarryoverDeps,
): RosterCarryover {
  const merged: CampaignLedger = { ...before, ...produced };
  const rosterIn = merged['roster.surviving_units'];
  if (!Array.isArray(rosterIn)) return { ledger: merged, lostNamed: [], replacements: [] };

  // Defaults first, then whatever the save already carried: a save written
  // before one of the three kinds existed still starts that kind at zero.
  const issuedIn: Record<NameKind, number> = {
    squad: 0,
    vehicle: 0,
    task: 0,
    ...merged['campaign.names_issued'],
  };
  // The roster this mission was sent IN. Read off `before` and never off
  // `merged`, which already holds what `checkEnd` produced -- the whole point is
  // to compare the two. It is also the callsign set the PREVIOUS save wrote,
  // which is the set `reattachSlots` matches against.
  const rosterBefore: readonly RosterEntry[] = before['roster.surviving_units'] ?? [];
  const reserveIn: readonly RosterEntry[] = merged['roster.reserve'] ?? [];

  const lost = appendLost(merged['roster.lost'] ?? [], lostThisMission);
  const reattached = reattachSlots(rosterIn, rosterBefore);
  const filled = fillVacancies(reattached, lost, reserveIn);
  // A replacement is an entry `fillVacancies` just handed a vacant slot --
  // slotless in `reattached`, slotted in `filled`. Nothing new is flagged
  // (R-6): this is the same derivation `fillVacancies` itself makes, read back
  // by comparing its own input and output at the same index. Index
  // correspondence survives `issueSlots`/`assignNames` below (both `.map`,
  // same order, same length), so the indices found here are read again once
  // `assignNames` has named the (possibly brand-new) body.
  const replacedSlots: { i: number; slot: number }[] = [];
  for (let i = 0; i < filled.length; i++) {
    const gained = filled[i].slot;
    if (reattached[i].slot === undefined && gained !== undefined) replacedSlots.push({ i, slot: gained });
  }
  const carried = issueSlots(filled, merged[SLOTS_ISSUED_KEY] ?? 0);
  const named = assignNames(carried.roster, issuedIn, deps.kindOf, deps.names);

  // `lostThisMission`'s own `type` is the sim's raw type id (`unitLost`'s
  // `unit` field), never a display name.
  const lostNamed: LostNamedRow[] = lostThisMission.map((r) => ({
    ...(r.name !== undefined ? { name: r.name } : {}),
    type: deps.displayName(r.type),
  }));
  // `named.roster[i]` is `filled[i]`'s own entry, carried through `issueSlots`
  // (slot already set, untouched) and `assignNames` (which has just given a
  // nameless replacement its callsign) -- same index, same body.
  // `predecessorOf` reads the just-appended `lost`, and every slot in
  // `replacedSlots` was handed out by `fillVacancies` FROM that list, so a
  // record is always found; `flatMap` states that without a non-null assertion
  // and without a fallback string no path can reach. A predecessor with no
  // callsign (R-2's named hole) reads as its unit's display name, the same
  // lookup the `lostNamed` rows use.
  const replacements: ReplacementRow[] = replacedSlots.flatMap(({ i, slot }) => {
    const predecessor = predecessorOf(lost, slot);
    if (predecessor === undefined) return [];
    const body = named.roster[i];
    return [{ name: body.name ?? body.type, predecessor: predecessor.name ?? deps.displayName(predecessor.type) }];
  });

  // The cap (WP-G-E2). Computed over the WHOLE brigade -- active plus whatever
  // is already stood down -- on every write, which is what lets a stood-down
  // unit come back when losses make room, and what makes the migration for an
  // existing save a normal write rather than a special path. Nothing is
  // deleted: the two arrays' lengths always sum to what went in.
  const split = splitRoster(named.roster, reserveIn, deps.cap ?? ROSTER_CAP);

  // Key order matters to the bytes on disk: the keys are assigned in the order
  // `main.ts` assigned them when this chain lived inline, so an existing save's
  // JSON comes out byte-identical to what that build wrote.
  return {
    ledger: {
      ...merged,
      'roster.lost': lost,
      [SLOTS_ISSUED_KEY]: carried.issued,
      'roster.surviving_units': split.active,
      'roster.reserve': split.reserve,
      'campaign.names_issued': named.issued,
    },
    lostNamed,
    replacements,
  };
}
