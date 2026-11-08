import type { LedgerData, UnlockGate } from '@lions/sim';
import { t } from './i18n/t';

import { gateRequirement } from '@lions/economy';

export { gateRequirement };
export type { GateRequirement } from '@lions/economy';

/**
 * One human sentence per closed gate, app-side.
 *
 * `@lions/sim`'s own `unlockReason` speaks the mission it wants cleared as its bare
 * catalogue id, verbatim, and a Conduct or star shortfall as a floor plus a parenthetical
 * the player has to translate into an instruction on their own. Both are correct for the
 * sim, which knows no names and owns no DOM, and both are wrong to show a player. This is
 * the shell's own rendering of the same checks: the sim's string is left untouched
 * for the sim's own callers, and these screens (the campaign cards, the garage's bay,
 * and anything else this module reaches) never render it again after this task.
 */
export function gateSentence(
  gate: UnlockGate | undefined,
  ledger: LedgerData | undefined,
  missionName: (id: string) => string | undefined
): string | null {
  const need = gateRequirement(gate, ledger);
  if (need === null) return null;
  switch (need.kind) {
    case 'conduct':
      return t('gate.conduct', { n: need.floor });
    case 'stars':
      return t('gate.stars', { n: need.need, have: need.have });
    case 'mission': {
      const name = missionName(need.id);
      return name ? t('gate.clearMission', { name }) : t('gate.clearUnknown');
    }
    case 'price':
      return t('gate.buy', { n: need.price });
  }
}

/**
 * The same gate as a REQUIREMENT rather than an instruction: `Conduct 75`,
 * `12★`, the mission's own name, `Buy 240`.
 *
 * For the garage's roster chips, which are one clipped line wide. The first cut
 * put `gateSentence`'s full sentence there and let CSS ellipsise it, which is
 * how every locked unit on the rail came to read `Locked · Needs a campaign
 * Conduc…` -- the same eleven characters for a Conduct floor of 35 and one of
 * 75, so the chip distinguished nothing at all. A number is shorter than the
 * sentence that asks for it AND says more. The full sentence is still on the
 * card's `title` and in the bay.
 *
 * `missionName` is taken for the same reason `gateSentence` takes it: a
 * mission-gated unit names the mission, never its catalogue id.
 */
export function gateShort(
  gate: UnlockGate | undefined,
  ledger: LedgerData | undefined,
  missionName: (id: string) => string | undefined
): string | null {
  const need = gateRequirement(gate, ledger);
  if (need === null) return null;
  switch (need.kind) {
    case 'conduct':
      return t('gate.short.conduct', { n: need.floor });
    case 'stars':
      return t('gate.short.stars', { n: need.need });
    case 'mission':
      return missionName(need.id) ?? t('gate.short.missionUnknown');
    case 'price':
      return t('gate.short.buy', { n: need.price });
  }
}
