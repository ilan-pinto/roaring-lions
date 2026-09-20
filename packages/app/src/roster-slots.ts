// packages/app/src/roster-slots.ts
/**
 * A slot is a place in the brigade, not a body (WP-G-E4, GH-176).
 *
 * Every roster entry carries a durable `slot`: a number issued ONCE, from the
 * monotone `campaign.slots_issued` counter on the ledger, exactly the way
 * `campaign.names_issued` already issues callsigns. It outlives the unit that
 * holds it -- that is the whole of "a replacement remembers whose place it
 * took" -- and it is the chronology E2's eviction order sorts by, which is why
 * the cap and the identity are one plan and not two.
 *
 * ## The problem this module solves is entirely the sim's rebuild
 *
 * `slot` is an app-side field. `@lions/sim` has never heard of it and this
 * plan does not open that package (R-2), so the field has to survive a round
 * trip through a runtime that does not know it exists. It survives two of the
 * three paths by itself and needs a rule for the third:
 *
 * - **Into a live mission: survives.** `entityRoster.set(id, origin)`
 *   (`mission.ts:1304`) stores the APP'S OWN object and `rosterEntryOf` hands
 *   it back, so the HUD card can read a field the sim has never heard of.
 * - **Left in the pool: survives.** `checkEnd` pushes an unfielded entry with
 *   `{ ...left }` (`mission.ts:1887`), a full spread.
 * - **Fielded and came home: DROPPED.** `checkEnd` rebuilds a fielded
 *   survivor's entry FIELD BY FIELD (`mission.ts:1874-1883`) -- `type`,
 *   `veterancy`, `missions`, `kills`, and then `name` and nothing else. Every
 *   other field on the entry the app sent in is gone.
 *
 * Both halves of that asymmetry are measured rather than argued, against a
 * real `Sim`, in `tools/src/roster-carry.test.ts`.
 *
 * ## R-2's rule, which is what `reattachSlots` is
 *
 * > **`slot` and `name` are issued together, to the same entry, in the same
 * > pass, and only there.** An OUT entry carrying a `slot` is an unfielded
 * > pass-through and keeps it. An OUT entry carrying a `name` but no `slot` is
 * > the fielded survivor of the IN entry with that name -- it takes that
 * > entry's slot. An OUT entry carrying neither is new this mission.
 *
 * Three facts make that total rather than heuristic, and all three are
 * properties of code outside this file:
 *
 * 1. **Names are unique for the life of a save.** `nthName` (`names.ts:32-50`)
 *    is injective on a per-kind counter that is never decremented, so a name
 *    identifies at most one entry and "the IN entry with that name" is never
 *    ambiguous. A `before` array with a duplicate name is therefore
 *    unreachable, and this module does not defend against one: the last such
 *    entry would win, arbitrarily, and an untested guard against a state that
 *    cannot arise is worse than the sentence you are reading.
 * 2. **The fielded and unfielded sets are disjoint.** `spawnPlacement`
 *    (`mission.ts:1254-1267`) SPLICES a drawn entry out of `rosterPool`, so no
 *    entry can come back down both paths and no name can appear twice in OUT.
 * 3. **`assignNames` runs over the whole roster on every victory**, with a
 *    full spread on both branches (`names.ts:52-67`), so after the first write
 *    there is no persisted entry without a name -- and a `slot` already on an
 *    entry passes through it untouched.
 *
 * **The one hole is named rather than papered over.** An entry with a slot and
 * no name cannot be reattached and is treated as new. That state is
 * unreachable once the pair is issued together (fact 3), and
 * `roster-slots.test.ts` constructs it deliberately to prove the fallback
 * neither throws nor hands out somebody else's number.
 *
 * ## The refused alternative, named so the next reader does not re-derive it
 *
 * **One line in `checkEnd` -- `entry.slot = origin?.slot`, beside the `name`
 * copy at `mission.ts:1883` -- deletes this entire module.** It was weighed
 * and it lost. It is a diff under `packages/sim/`, where this plan's Global
 * Constraint is byte-for-byte and the golden determinism hash lives, and a
 * slot id is the fourth item on the gamification page's own standing rule:
 * *do not let a tier, a credit or a name reach the sim*. If a later session
 * takes that exception deliberately and with review, the follow-up is exact:
 * delete `reattachSlots` and its six specs, keep `issueSlots`, and drop step 3
 * from `main.ts`'s pipeline. `tools/src/roster-carry.test.ts` is what turns
 * this from dead code into deletable code -- it pins the drop, so a sim change
 * that spreads `origin` instead goes red there and says so.
 */
import type { RosterEntry } from './ledger-store';

/** The ledger key the slot counter lives on. The mirror of
 *  `campaign.names_issued`: monotone, app-only, never in a mission's
 *  `ledger.requires`/`produces` contract and never on
 *  `mission.schema.json`'s enum of legal keys. */
export const SLOTS_ISSUED_KEY = 'campaign.slots_issued';

/**
 * R-2's rule, and nothing else. Pure, length-preserving, and it never reads or
 * writes a counter -- `issueSlots` is what numbers whatever is still slotless
 * afterwards.
 *
 * `out` is the roster `checkEnd` just produced; `before` is the roster the app
 * sent IN. Every returned entry is a fresh object, and the only field this
 * function can add is `slot`: the sim's own `veterancy`, `missions` and
 * `kills` win, because they are this mission's numbers and `before`'s are last
 * mission's.
 */
export function reattachSlots(out: readonly RosterEntry[], before: readonly RosterEntry[]): RosterEntry[] {
  const slotByName = new Map<string, number>();
  for (const entry of before) {
    // Both halves required: a nameless predecessor is unmatchable (the named
    // hole above), and a predecessor with no slot has nothing to give.
    if (entry.name !== undefined && entry.slot !== undefined) slotByName.set(entry.name, entry.slot);
  }
  return out.map((entry) => {
    // An unfielded pass-through already carries its own slot. Trust it over
    // any match: it IS the entry, not a rebuild of one.
    if (entry.slot !== undefined) return { ...entry };
    if (entry.name === undefined) return { ...entry };
    const slot = slotByName.get(entry.name);
    return slot === undefined ? { ...entry } : { ...entry, slot };
  });
}

/**
 * Issue a durable slot to every entry that has none, from a monotone counter.
 * Deliberately the same shape as `assignNames` -- roster in and counter in,
 * roster out and counter out -- because it is the same mechanism for the same
 * reason, and the two run back to back at one seam.
 *
 * **The counter is never decremented and an id is never reused.** A slot id is
 * the chronology E2's eviction order sorts by ("newest falls first"), so a
 * reused id would make two identical saves answer differently about which
 * unit stands down. It is also what a memorial record and its replacement
 * share, so reuse would hand a dead unit's history to an unrelated body.
 *
 * Note the test on `undefined` rather than on truthiness: **slot 0 is a real
 * slot**, the first one this counter ever issues.
 */
export function issueSlots(roster: readonly RosterEntry[], issued: number): { roster: RosterEntry[]; issued: number } {
  let next = issued;
  const out = roster.map((entry) => {
    if (entry.slot !== undefined) return { ...entry };
    const slot = next;
    next += 1;
    return { ...entry, slot };
  });
  return { roster: out, issued: next };
}
