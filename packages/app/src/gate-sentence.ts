import { conductAtLeast, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';

/**
 * One human sentence per closed gate, app-side.
 *
 * `@lions/sim`'s own `unlockReason` speaks the mission it wants cleared as its bare
 * catalogue id, verbatim, and a Conduct or star shortfall as a floor plus a parenthetical
 * the player has to translate into an instruction on their own. Both are correct for the
 * sim, which knows no names and owns no DOM, and both are wrong to show a player. This is
 * the shell's own rendering of the same three checks: the sim's string is left untouched
 * for the sim's own callers, and these three screens (the campaign cards, the brigade
 * roster, and anything else this module reaches) never render it again after this task.
 *
 * Branch order matches `unlockReason` exactly (Conduct, then stars, then a named
 * mission) so the two never disagree about WHICH gate is the binding one, and the
 * `afterMission` branch reads the same ledger key `unlockReason` does
 * (`campaign.completed_missions`) rather than inventing a second shape for "cleared" --
 * a gate this function called open that `unlockReason` still calls locked would leave a
 * unit selectable in the brigade and rejected by the mission it unlocks.
 */
export function gateSentence(
  gate: UnlockGate | undefined,
  ledger: LedgerData | undefined,
  missionName: (id: string) => string | undefined
): string | null {
  if (!gate) return null;
  if (gate.roeMin !== undefined && !conductAtLeast(ledger, gate.roeMin)) {
    return `Needs a campaign Conduct of ${gate.roeMin} or better`;
  }
  if (gate.starsMin !== undefined) {
    const have = starsEarned(ledger);
    if (have < gate.starsMin) return `Needs ${gate.starsMin} star${gate.starsMin === 1 ? '' : 's'} (you have ${have})`;
  }
  if (gate.afterMission !== undefined) {
    const done = ledger?.['campaign.completed_missions'];
    if (!Array.isArray(done) || !done.includes(gate.afterMission)) {
      const name = missionName(gate.afterMission);
      return name ? `Clear ${name} first` : 'Clear an earlier mission first';
    }
  }
  return null;
}
