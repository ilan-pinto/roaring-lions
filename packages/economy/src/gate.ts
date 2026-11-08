import { conductAtLeast, isBoughtOnly, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';

/**
 * WHICH check is holding a unit back, and the number that check reads by --
 * decided once, rendered two ways.
 *
 * `gateSentence` below writes it as a sentence for a screen with room for one;
 * `gateShort` writes it as a requirement for a chip that has room for four
 * words. Both consume THIS, so the two can never disagree about which gate is
 * binding: there is one branch order in this file, not two kept in step by
 * hand. (`brigade.ts`'s own `bindingGate` is a third reader of the same
 * precedence, for SORTING rather than text, and keeps its own tests.)
 *
 * Branch order matches `@lions/sim`'s `unlockReason` exactly: `bought`
 * short-circuits first (spec 2026-09-15 §4.4 -- a purchased unit is open
 * regardless of what price or any earned field still says), then Conduct, then
 * stars, then a named mission, then a price. The `afterMission` branch reads the
 * same ledger key `unlockReason` does (`campaign.completed_missions`) rather
 * than inventing a second shape for "cleared" -- a gate this called open that
 * `unlockReason` still calls locked would leave a unit selectable in the garage
 * and rejected by the mission it unlocks.
 *
 * The price rank borrows `isBoughtOnly` rather than re-deriving its predicate: a
 * gate that declares NO earned field at all (D1, the special forces shape) is
 * closed until bought and gets its own rendering; a gate that ALSO declares
 * Conduct, stars or a mission keeps the EARNED one even when a price is set too
 * (a priced Buy control renders in the bay regardless -- see `brigade.ts` -- so
 * the price is never lost, only not repeated).
 */
export type GateRequirement =
  | { kind: 'conduct'; floor: number }
  | { kind: 'stars'; need: number; have: number }
  | { kind: 'mission'; id: string }
  | { kind: 'price'; price: number };

/** The binding requirement, or null when nothing is holding the unit back. */
export function gateRequirement(gate: UnlockGate | undefined, ledger: LedgerData | undefined): GateRequirement | null {
  if (!gate) return null;
  if (gate.bought === true) return null;
  if (gate.roeMin !== undefined && !conductAtLeast(ledger, gate.roeMin)) {
    return { kind: 'conduct', floor: gate.roeMin };
  }
  if (gate.starsMin !== undefined) {
    const have = starsEarned(ledger);
    if (have < gate.starsMin) return { kind: 'stars', need: gate.starsMin, have };
  }
  if (gate.afterMission !== undefined) {
    const done = ledger?.['campaign.completed_missions'];
    if (!Array.isArray(done) || !done.includes(gate.afterMission)) {
      return { kind: 'mission', id: gate.afterMission };
    }
  }
  if (isBoughtOnly(gate) && gate.price !== undefined) return { kind: 'price', price: gate.price };
  return null;
}
