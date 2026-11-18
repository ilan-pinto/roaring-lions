// GH-1395 slice 1: the REPORT-ONLY challenge reading of `pnpm playtest` (design §8, "the playtest witness").
//
// One more seed child per `POSTURE_SEEDS` seed runs the whole ladder at Standard with every pilot mission's CHALLENGE
// amendments on (`PT_CHALLENGE=1`, `playtest-run.ts`), and the parent prints, per winning plan on a pilot mission: how
// often the EXISTING plan still wins amended, how often that win also beat the challenge's predicate, and the slowest
// win against the amended limit. It gates nothing: the plans were written for the plain missions, and the design's
// gated witness (a challenge plan per mission that wins the challenge on 30 seeds, the passive plan losing it) is
// slice 2's. This module holds only the pure judgement, so it can be falsified on literals.

import { amendmentOps, applyOverlays, challengeOf, type ChallengeTerm, type ChallengeWin, type OverlayMission } from '@lions/data';
import { missions } from '@lions/data/content';

/** One run as the reading needs it: `RunRecord`'s fields. */
export interface ChallengeRunRecord {
  result: string;
  minutes: number;
  /** `terms`: each term the challenge names and whether it held on this run (`challengeTerms`, @lions/data). */
  challenge?: { met: boolean; terms?: readonly { term: ChallengeTerm; held: boolean }[] };
}

export interface ChallengeTally {
  /** Seeds with a run for the label. */
  ran: number;
  wins: number;
  /** Wins that beat the challenge too. */
  met: number;
  /** Slowest win, minutes; 0 with none. */
  slowestMin: number;
  /** Per term, the WINS on which it held (a term that failed on every win reads 0; a term no run reported is absent). */
  held: Partial<Record<ChallengeTerm, number>>;
}

/** Tallies one label's runs over the challenge seeds; `undefined` is a seed with no run (a child that died). */
export function tallyChallenge(runs: readonly (ChallengeRunRecord | undefined)[]): ChallengeTally {
  const t: ChallengeTally = { ran: 0, wins: 0, met: 0, slowestMin: 0, held: {} };
  for (const r of runs) {
    if (r === undefined) continue;
    t.ran++;
    if (r.result !== 'victory') continue;
    t.wins++;
    if (r.challenge?.met === true) t.met++;
    for (const x of r.challenge?.terms ?? []) t.held[x.term] = (t.held[x.term] ?? 0) + (x.held ? 1 : 0);
    t.slowestMin = Math.max(t.slowestMin, r.minutes);
  }
  return t;
}

/** The limit the challenge run plays `id` on: Standard, with the challenge's named amendments. No amendment moves the
 *  clock (the lead dropped Tight clock, PR 1524), so this reads the authored limit; it is computed, not assumed, so a
 *  clock that did move would show in the line. */
export function challengeLimit(id: string): number | undefined {
  const m = (missions as unknown as Record<string, (OverlayMission & { time_limit_s?: number }) | undefined>)[id];
  const c = challengeOf(id);
  if (m === undefined || c === undefined) return undefined;
  return applyOverlays(m, { amendments: amendmentOps(c.challenge.amendments, id) }).time_limit_s;
}

/** A challenge's terms as the line prints them, in the closed set's order: `objective_done hvt_seen`, `lost_at_most 0`,
 *  `carries_all`. */
export function winTerms(win: ChallengeWin): string[] {
  const out: string[] = [];
  if (win.conduct_at_least !== undefined) out.push(`conduct_at_least ${win.conduct_at_least}`);
  if (win.lost_at_most !== undefined) out.push(`lost_at_most ${win.lost_at_most}`);
  if (win.ticks_at_most_target === true) out.push('ticks_at_most_target');
  if (win.carries_all === true) out.push('carries_all');
  if (win.objective_done !== undefined) out.push(`objective_done ${win.objective_done}`);
  return out;
}

/** The printed line. Always says "report only": nothing reads it as a gate. */
export function challengeLine(label: string, id: string, t: ChallengeTally, seeds: number): string {
  const c = challengeOf(id);
  const limit = challengeLimit(id);
  const name = c === undefined ? '?' : `${c.challenge.id} [${c.challenge.amendments.join(', ')}] {${winTerms(c.challenge.win).join(', ')}}`;
  const slow = t.wins === 0 ? '-' : `${t.slowestMin.toFixed(1)} min`;
  const held = Object.entries(t.held).map(([k, n]) => `${k} ${n}/${t.wins}`);
  return (
    `challenge ${label} ${name}: the plain plan wins ${t.wins}/${seeds} amended, beats the challenge on ${t.met}/${seeds}` +
    (held.length > 0 ? ` (held on wins: ${held.join(', ')})` : '') +
    `, slowest win ${slow} of ${limit === undefined ? '?' : `${limit} s`}` +
    (t.ran < seeds ? `, ${seeds - t.ran} seed(s) with no run` : '') +
    ' (report only)'
  );
}
