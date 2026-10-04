/**
 * What a won mission pays into the brigade account, and against which record (GH-330).
 *
 * `creditsFor` (`@lions/sim`) says what a run is WORTH; `payMission`
 * (`brigade-account.ts`) pays the improvement on a record. This module picks the
 * record, which is the whole of "a new campaign pays again":
 *
 * - a mission OPEN in the campaign the run started in (`missionOpen`, read off the
 *   ledger as it stood at BOOT, before this victory wrote to it) is measured against
 *   this campaign's best, `campaign_paid`, which "New campaign" clears;
 * - any other mission -- a locked one played by address -- is measured against the
 *   lifetime best, `paid`, which is the rule as it stood before GH-330. Without this
 *   guard, "New campaign" plus `/mission/<id>` repeats the best-paying mission forever
 *   (`khan_rafid_1_recon`, 310 credits for a 0.5-minute plan: 3.5x a campaign's rate,
 *   measured in the plan `docs/superpowers/plans/2026-10-04-credits-reachability.md`).
 *
 * Replay inside one campaign still pays improvement only, because the campaign record
 * moves up like the lifetime one does. Pure; the wall clock is the caller's.
 */
import type { LedgerData } from '@lions/sim';
import { payMission, type BrigadeAccount, type PayScope } from './brigade-account';
import { missionOpen, type ParsedWorld } from './campaign';

export function payScope(world: ParsedWorld, missionId: string, ledgerAtBoot: LedgerData | undefined): PayScope {
  return missionOpen(world, missionId, ledgerAtBoot) ? 'campaign' : 'lifetime';
}

export function payVictory(
  account: BrigadeAccount,
  world: ParsedWorld,
  missionId: string,
  ledgerAtBoot: LedgerData | undefined,
  value: number,
  at: number
): { account: BrigadeAccount; paid: number; scope: PayScope } {
  const scope = payScope(world, missionId, ledgerAtBoot);
  return { ...payMission(account, missionId, value, at, scope), scope };
}
