/**
 * GH-1395 slice 1: whether a won campaign run beat its mission's challenge, and the campaign-ledger mark it leaves
 * (design 2026-11-15-challenge-star-design.md §5; the lead's rulings D1-D13 on PR 1459, 16 Nov 2026). One module so
 * the victory handler and the playtest harness cannot disagree, as `campaign-pay.ts` and `posture.ts` are.
 *
 * A challenge is beaten on a VICTORY in which every amendment the challenge names was on (extras allowed, D7), the run
 * was not on Easier (GH-1394 D9), the mission was OPEN in the campaign the run booted in (the guard `payScope` uses:
 * "New campaign" plus `/mission/<id>` must not farm a mark), and the predicate held on the run's own row. Then:
 *   - the campaign ledger gets a mark under `campaign.challenge_results` (best-of, this campaign; New campaign clears it);
 *   - the victory reports `challenge: true`, and `settleVictory` (victory-settle.ts) pays 10 Roar coins ONCE PER ACCOUNT
 *     on the wallet's lifetime record (`payChallenge`; the Worker's `victory` holds the same rule against `earn_lifetime`).
 * Everything here is loaded LAZILY: main.ts reaches it only through `./posture`'s re-export, so the entry chunk (at the
 * `webgpu:bundle` ceiling) carries none of it.
 * It pays no credits (D3): `creditsFor` is called exactly as for any win, on the mission as played. It counts toward no
 * unit unlock (D2): `starsEarned` reads `campaign.mission_results` only. The sim never learns an amendment exists.
 */
import {
  amendmentOps,
  applyOverlays,
  betterMark,
  challengeArmed,
  challengeMet,
  challengeOf,
  postureOf,
  postures,
  CHALLENGE_LEDGER_KEY,
  type ChallengeMark,
  type ChallengeRun,
  type OverlayMission,
} from '@lions/data';
import type { LedgerData, MissionRuntime } from '@lions/sim';
import { world } from '@lions/data';
import { missionOpen, parseWorld, type ParsedWorld } from './campaign';

export { CHALLENGE_LEDGER_KEY };
export type { ChallengeMark, ChallengeRun };

/**
 * `mission` as the campaign plays it: the ledger's posture first, then the amendments the player put on (D7, §3.3).
 * No amendments is exactly `campaignMission` (posture.ts), the mission itself at Standard. Throws on an amendment the
 * mission does not offer (a caller fault: the deploy screen offers only the mission's own three).
 */
export function amendedMission<T extends OverlayMission & { id: string }>(
  mission: T,
  ledger: Readonly<Record<string, unknown>> | null | undefined,
  amendments: readonly string[],
  label?: (key: string) => string
): T {
  return applyOverlays(mission, { posture: postureOf(ledger), amendments: amendmentOps(amendments, mission.id) }, postures, label === undefined ? {} : { label });
}

export interface ChallengeRunInput {
  missionId: string;
  result: 'ongoing' | 'victory' | 'defeat';
  /** The amendment ids the run was played with. */
  amendments: readonly string[];
  /** The campaign ledger as the run BOOTED (before this victory wrote to it): it says the posture and what was open. */
  ledgerAtBoot: LedgerData | undefined;
  world: ParsedWorld;
  /** The authored mission's `target_minutes` (no overlay moves it). */
  targetMinutes: number;
  run: ChallengeRun;
}

/** The run's own row off a finished runtime, as the victory handler and the playtest harness both read it: `lost` is
 *  every player unit lost (`lostByType` summed, the ledger's `lost`), `carriesAll` every carrying secondary complete. */
export function runRowOf(rt: Pick<MissionRuntime, 'lostByType' | 'objectiveList'>, roe: number, ticks: number): ChallengeRun {
  return {
    roe,
    ticks,
    lost: Object.values(rt.lostByType()).reduce((n, k) => n + k, 0),
    carriesAll: rt.objectiveList.every((o) => o.primary || o.carries !== true || o.status === 'complete'),
  };
}

/** The mark this run earned, or null when it beat no challenge. Pure. */
export function challengeMarkFor(a: ChallengeRunInput): ChallengeMark | null {
  if (a.result !== 'victory') return null;
  const c = challengeOf(a.missionId);
  if (c === undefined) return null;
  if (postureOf(a.ledgerAtBoot) === 'easier') return null;
  if (!missionOpen(a.world, a.missionId, a.ledgerAtBoot)) return null;
  if (!challengeArmed(c, a.amendments)) return null;
  if (!challengeMet(c.challenge.win, a.run, a.targetMinutes)) return null;
  return { id: c.challenge.id, roe: a.run.roe, ticks: a.run.ticks, lost: a.run.lost };
}

/** `ledger` with `mark` recorded for `missionId`, best-of (faster, then higher Conduct); the same ledger back when
 *  there is no mark or the stored one is better. Keys rebuilt in sorted order, like the runtime's own result keys. */
export function withChallengeMark<L extends LedgerData>(ledger: L, missionId: string, mark: ChallengeMark | null | false | undefined): L {
  if (!mark) return ledger;
  const prior = challengeMarksOf(ledger);
  const held = Object.hasOwn(prior, missionId) ? prior[missionId] : undefined;
  if (held !== undefined && !betterMark(mark, held)) return ledger;
  const merged: Record<string, ChallengeMark> = { ...prior, [missionId]: mark };
  const out: Record<string, ChallengeMark> = {};
  for (const k of Object.keys(merged).sort()) out[k] = merged[k];
  return { ...ledger, [CHALLENGE_LEDGER_KEY]: out };
}

/**
 * C9: this campaign's marks, well-shaped rows only. The ledger sanitiser (`@lions/economy` ledger-shape, on the entry
 * chunk) has no rule for the key, on purpose: the key's only readers are here, loaded lazily, and they read through
 * this, so a hand-edited or wrong-shaped row is dropped where it is read and never reaches a coin (the coin's record is
 * the wallet's, never the ledger's).
 */
export function challengeMarksOf(ledger: LedgerData | undefined): Record<string, ChallengeMark> {
  const raw = ledger?.[CHALLENGE_LEDGER_KEY];
  const out: Record<string, ChallengeMark> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const m = v as Partial<ChallengeMark> | null;
    if (k === '__proto__' || typeof m !== 'object' || m === null) continue;
    if (typeof m.id === 'string' && num(m.roe) && num(m.ticks) && num(m.lost)) out[k] = { id: m.id, roe: m.roe, ticks: m.ticks, lost: m.lost };
  }
  return out;
}

/** The amendments on top of a mission the posture has already been applied to (`campaignMission`): applyOverlays'
 *  own order, posture first and amendments last, in two calls. None: `mission` itself. */
export function amended<T extends OverlayMission & { id: string }>(mission: T, ids: readonly string[]): T {
  return applyOverlays(mission, { amendments: amendmentOps(ids, mission.id) });
}

/**
 * The victory handler's one call (main.ts, through the lazy `./posture`): the mark this run earned, or null. Reads the
 * run's own row off the runtime, the mission's own target, and the ledger the run BOOTED with.
 */
export function victoryMark(
  mission: { id: string },
  ledgerAtBoot: LedgerData | undefined,
  amendments: readonly string[] | undefined,
  rt: Pick<MissionRuntime, 'lostByType' | 'objectiveList'>,
  end: { result: 'ongoing' | 'victory' | 'defeat'; roeRating: number; tick: number }
): ChallengeMark | null {
  return challengeMarkFor({
    missionId: mission.id,
    result: end.result,
    amendments: amendments ?? [],
    ledgerAtBoot,
    world: parseWorld(world),
    targetMinutes: (mission as { target_minutes?: number }).target_minutes ?? 0,
    run: runRowOf(rt, end.roeRating, end.tick),
  });
}

export { settleVictory, type VictorySettle } from './victory-settle';
