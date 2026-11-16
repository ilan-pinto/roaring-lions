// GH-1395 slice 1: the REPORT-ONLY challenge reading of `pnpm playtest` (design §8, "the playtest witness").
//
// One more seed child per `POSTURE_SEEDS` seed runs the whole ladder at Standard with every pilot mission's CHALLENGE
// amendments on (`PT_CHALLENGE=1`, `playtest-run.ts`), and the parent prints, per winning plan on a pilot mission: how
// often the EXISTING plan still wins amended, how often that win also beat the challenge's predicate, and the slowest
// win against the amended limit. It gates nothing: the plans were written for the plain missions, and the design's
// gated witness (a challenge plan per mission that wins the challenge on 30 seeds, the passive plan losing it) is
// slice 2's. This module holds only the pure judgement, so it can be falsified on literals.

import { amendmentOps, applyOverlays, challengeOf, missions, type OverlayMission } from '@lions/data';

/** One run as the reading needs it: `RunRecord`'s fields. */
export interface ChallengeRunRecord {
  result: string;
  minutes: number;
  challenge?: { met: boolean };
}

export interface ChallengeTally {
  /** Seeds with a run for the label. */
  ran: number;
  wins: number;
  /** Wins that beat the challenge too. */
  met: number;
  /** Slowest win, minutes; 0 with none. */
  slowestMin: number;
}

/** Tallies one label's runs over the challenge seeds; `undefined` is a seed with no run (a child that died). */
export function tallyChallenge(runs: readonly (ChallengeRunRecord | undefined)[]): ChallengeTally {
  const t: ChallengeTally = { ran: 0, wins: 0, met: 0, slowestMin: 0 };
  for (const r of runs) {
    if (r === undefined) continue;
    t.ran++;
    if (r.result !== 'victory') continue;
    t.wins++;
    if (r.challenge?.met === true) t.met++;
    t.slowestMin = Math.max(t.slowestMin, r.minutes);
  }
  return t;
}

/** The limit the challenge run plays `id` on: Standard, with the challenge's named amendments. */
export function challengeLimit(id: string): number | undefined {
  const m = (missions as unknown as Record<string, (OverlayMission & { time_limit_s?: number }) | undefined>)[id];
  const c = challengeOf(id);
  if (m === undefined || c === undefined) return undefined;
  return applyOverlays(m, { amendments: amendmentOps(c.challenge.amendments, id) }).time_limit_s;
}

/** The printed line. Always says "report only": nothing reads it as a gate. */
export function challengeLine(label: string, id: string, t: ChallengeTally, seeds: number): string {
  const c = challengeOf(id);
  const limit = challengeLimit(id);
  const name = c === undefined ? '?' : `${c.challenge.id} [${c.challenge.amendments.join(', ')}]`;
  const slow = t.wins === 0 ? '-' : `${t.slowestMin.toFixed(1)} min`;
  return (
    `challenge ${label} ${name}: the plain plan wins ${t.wins}/${seeds} amended, beats the challenge on ${t.met}/${seeds}` +
    `, slowest win ${slow} of ${limit === undefined ? '?' : `${limit} s`}` +
    (t.ran < seeds ? `, ${seeds - t.ran} seed(s) with no run` : '') +
    ' (report only)'
  );
}
