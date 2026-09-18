import { conductAtLeast, isBoughtOnly, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';
import { t } from './i18n/t';

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
