// packages/app/src/ui/objective-reward.ts
/**
 * What a secondary is actually worth (GDD §6, shell-upgrade Phase 2 task 5).
 *
 * A primary is the mission -- it is not "rewarded" for completing, it is the
 * thing the player was sent to do. A secondary is optional, and the objective
 * panel names what completing one is worth so "optional" does not read as
 * "pointless": a carrying secondary (`carries: true`, schema-enforced never
 * on a primary) feeds `roster.surviving_units`/the third star and pays
 * `CREDIT_WEIGHTS.carryingSecondary` into the brigade account on victory
 * (`credits.ts`'s `creditInputFrom`, which counts exactly the secondaries
 * this function calls out). A non-carrying secondary pays nothing and says
 * so, rather than leaving the player to guess whether silence means "no
 * reward" or "the panel forgot".
 *
 * `paysCredits` is the one thing this module cannot derive on its own: a
 * mission that produces no ledger keys (the tutorial) never reaches
 * `payMission` at all (`main.ts` gates that call on
 * `mission.ledger.produces.length > 0`), so promising credits there would be
 * the panel telling the player something the code will not do. The caller
 * passes that gate in as a plain boolean rather than this module reaching
 * into a `MissionJson` itself -- `rewardFor` stays a pure function over three
 * booleans and nothing else.
 *
 * The credit figure is READ off `@lions/sim`'s `CREDIT_WEIGHTS`, never
 * copied as a literal: the number shown here is the one the sim will
 * actually pay, so a balance change to that constant updates this text for
 * free instead of drifting out of sync with it.
 */
import { CREDIT_WEIGHTS } from '@lions/sim';

export interface RewardInput {
  primary: boolean;
  carries: boolean;
  paysCredits: boolean;
}

export interface Reward {
  key: string;
  params: Readonly<Record<string, string | number>>;
}

/**
 * `null` for a primary -- there is nothing to name. Otherwise one of three
 * catalogue keys: a carrying secondary on a mission that pays credits names
 * the figure and the star; the same secondary on a mission that pays nothing
 * (the tutorial) names the star only; a non-carrying secondary says plainly
 * that it carries nothing forward.
 */
export function rewardFor(o: RewardInput): Reward | null {
  if (o.primary) return null;
  if (!o.carries) return { key: 'objective.reward.none', params: {} };
  return o.paysCredits
    ? { key: 'objective.reward.carries', params: { credits: CREDIT_WEIGHTS.carryingSecondary } }
    : { key: 'objective.reward.carriesNoCredits', params: {} };
}
