import { conductAtLeast, isBoughtOnly, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';
import { t } from './i18n/t';

/**
 * One human sentence per closed gate, app-side.
 *
 * `@lions/sim`'s own `unlockReason` speaks the mission it wants cleared as its bare
 * catalogue id, verbatim, and a Conduct or star shortfall as a floor plus a parenthetical
 * the player has to translate into an instruction on their own. Both are correct for the
 * sim, which knows no names and owns no DOM, and both are wrong to show a player. This is
 * the shell's own rendering of the same checks: the sim's string is left untouched
 * for the sim's own callers, and these three screens (the campaign cards, the brigade
 * roster, and anything else this module reaches) never render it again after this task.
 *
 * Branch order matches `unlockReason` exactly (Conduct, then stars, then a named
 * mission, then price) so the two never disagree about WHICH gate is the binding one,
 * and the `afterMission` branch reads the same ledger key `unlockReason` does
 * (`campaign.completed_missions`) rather than inventing a second shape for "cleared" --
 * a gate this function called open that `unlockReason` still calls locked would leave a
 * unit selectable in the brigade and rejected by the mission it unlocks.
 *
 * `bought` short-circuits first, the same as `unlockReason`'s own first check (spec
 * 2026-09-15 §4.4): a purchased unit reads as open here regardless of what `price` or
 * any earned field still says, because the app resolves `bought` from the brigade
 * account before either function ever sees the gate.
 *
 * The price rank borrows `isBoughtOnly` rather than re-deriving its predicate a third
 * time (`unlockReason` and the brigade's own `bindingGate` are the other two): a gate
 * that declares NO earned field at all (D1, the special forces shape) is closed until
 * bought and gets its own sentence; a gate that also declares Conduct, stars or a
 * mission keeps the EARNED sentence as the one shown here even when a price is set
 * too, exactly as `bindingGate` ranks it (a priced Buy control renders beside the row
 * regardless -- see `brigade.ts` -- so the price is never lost, only not repeated into
 * this sentence when an earned gate is what is actually binding).
 */
export function gateSentence(
  gate: UnlockGate | undefined,
  ledger: LedgerData | undefined,
  missionName: (id: string) => string | undefined
): string | null {
  if (!gate) return null;
  if (gate.bought === true) return null;
  if (gate.roeMin !== undefined && !conductAtLeast(ledger, gate.roeMin)) {
    return t('gate.conduct', { n: gate.roeMin });
  }
  if (gate.starsMin !== undefined) {
    const have = starsEarned(ledger);
    if (have < gate.starsMin) return t('gate.stars', { n: gate.starsMin, have });
  }
  if (gate.afterMission !== undefined) {
    const done = ledger?.['campaign.completed_missions'];
    if (!Array.isArray(done) || !done.includes(gate.afterMission)) {
      const name = missionName(gate.afterMission);
      return name ? t('gate.clearMission', { name }) : t('gate.clearUnknown');
    }
  }
  if (isBoughtOnly(gate) && gate.price !== undefined) return t('gate.buy', { n: gate.price });
  return null;
}
