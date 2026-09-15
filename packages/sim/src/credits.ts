/**
 * What a won mission pays into the brigade account (spec 2026-09-15 §4.2).
 *
 * Reads exactly what the grade and the debrief already read -- the win, the carrying
 * secondaries, the units brought home, Conduct over the two-star floor -- and adds them
 * with the weights below. Integer addition only, no division, no RNG, so it lives beside
 * `grade.ts` and is the one answer the app and the playtest harness share. Nothing in the
 * sim calls it: the sim never learns credits exist.
 *
 * The weights are provisional and belong to the balance analyst (spec §4.2's campaign
 * target). Change them here and nowhere else.
 */
import { starRoeFloor } from './grade';
import type { MissionRuntime } from './mission';

export const CREDIT_WEIGHTS = {
  win: 100,
  carryingSecondary: 40,
  unitHome: 10,
  conductPoint: 1,
} as const;

export interface CreditInput {
  result: 'ongoing' | 'victory' | 'defeat';
  /** Secondaries flagged `carries: true` whose status is 'complete'. */
  carryingComplete: number;
  /** Player units that ever took the field (`MissionRuntime.fieldedCount`). */
  fielded: number;
  /** Player units that died (sum of `lostByType()`). */
  lost: number;
  roe: number;
  /** The mission's `roe.fail_below`, undefined when it declares none. */
  failBelow: number | undefined;
}

export function creditsFor(input: CreditInput): number {
  if (input.result !== 'victory') return 0;
  const home = input.fielded - input.lost;
  const homePaid = home > 0 ? home * CREDIT_WEIGHTS.unitHome : 0;
  const over = input.roe - starRoeFloor(input.failBelow);
  const conductPaid = over > 0 ? over * CREDIT_WEIGHTS.conductPoint : 0;
  return (
    CREDIT_WEIGHTS.win +
    input.carryingComplete * CREDIT_WEIGHTS.carryingSecondary +
    homePaid +
    conductPaid
  );
}

/** The credit input read straight off a finished runtime -- the same counters the
 *  debrief prints. `roe` is passed in because the app reads it off the `missionEnd`
 *  event while the harness reads `rt.roeScore`; they are equal at mission end. */
export function creditInputFrom(
  rt: Pick<MissionRuntime, 'result' | 'objectiveList' | 'fieldedCount' | 'lostByType'>,
  roe: number,
  failBelow: number | undefined,
): CreditInput {
  let lost = 0;
  for (const n of Object.values(rt.lostByType())) lost += n;
  let carryingComplete = 0;
  for (const o of rt.objectiveList) if (!o.primary && o.carries && o.status === 'complete') carryingComplete += 1;
  return { result: rt.result, carryingComplete, fielded: rt.fieldedCount, lost, roe, failBelow };
}
