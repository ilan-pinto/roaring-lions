// GH-1394 slice 1: the playtest ladder at the three difficulty postures (design §8; lead ruling D13).
//
// `pnpm playtest` already runs every winning plan on 30 seeds and every no-orders control on 30 (`plan-sweep.ts`,
// `passive-sweep.ts`). This adds the same two readings at Easier and Harder, each on `POSTURE_SEEDS` (8 in CI,
// `PT_POSTURE_SEEDS=30` in the nightly), and judges four things per posture:
//
//   1. winnable: every winning plan wins on every posture seed, with the 120 s / 20% margin to the OVERLAID limit;
//   2. passive loses: every no-orders control loses (any defeat: Easier's longer limit can turn a `withdrawn` into
//      a lost primary, and both are a loss);
//   3. monotone: per plan, the win rate at Easier >= at Standard >= at Harder;
//   4. the clock validator: every (mission, posture) passes `timeLimitFailures` under the overlaid rule (D6/D13).
//
// The runs themselves are the existing children and workers with `PT_POSTURE` set: `run()` applies the posture
// with `applyOverlays` where it resolves upgrades, so the world a posture run builds is the one the app builds.
// This module holds only the pure judgements, so each can be falsified on literals.

import { applyOverlays, POSTURE_IDS, type OverlayMission, type PostureId } from '@lions/data';
import { missions } from '@lions/data/content';
import { timeLimitFailures } from '../../validate_time_limit.mjs';

/** The two postures the ladder adds; Standard is the existing ladder. */
export const LADDER_POSTURES: readonly PostureId[] = ['easier', 'harder'];

/** One reading of the plan sweep at a posture. `relief`: the winning plans use the Easier relief when it arrives
 *  (`PT_RELIEF_JOIN`, `playtest-run.ts`); without it the scripted plans leave it standing, so both are read. */
export interface Variant {
  key: string;
  posture: PostureId;
  relief: boolean;
}
export const LADDER_VARIANTS: readonly Variant[] = [
  { key: 'easier', posture: 'easier', relief: false },
  { key: 'easier+relief', posture: 'easier', relief: true },
  { key: 'harder', posture: 'harder', relief: false },
];

/** One mission's plan at a posture, against Standard on the SAME seeds. */
export interface PlanReading {
  wins: number;
  seeds: number;
  /** Median winning time, minutes; NaN with no win. */
  medianMin: number;
  /** Starting-force bodies lost, mean over the seeds that ran. */
  meanLost: number;
}

export function readingOf(runs: readonly { result: string; minutes: number; lost: number }[], seeds: number): PlanReading {
  const winMin = runs.filter((r) => r.result === 'victory').map((r) => r.minutes).sort((a, b) => a - b);
  const mid = winMin.length === 0 ? NaN : winMin.length % 2 === 1 ? winMin[(winMin.length - 1) / 2] : (winMin[winMin.length / 2 - 1] + winMin[winMin.length / 2]) / 2;
  const meanLost = runs.length === 0 ? NaN : runs.reduce((n, r) => n + r.lost, 0) / runs.length;
  return { wins: winMin.length, seeds, medianMin: mid, meanLost };
}

/**
 * REPORT-ONLY (PM, 16 Nov): does a posture point the wrong way for this mission ITSELF? An Easier reading is flagged when,
 * against Standard on the same seeds, it wins less often, wins more than 5% slower, or loses more than half a body a run
 * more of the starting force
 * (Tel Marum III: Easier's +30 s wave lands on the defile foot as they arrive). A Harder reading is flagged the other
 * way round. Chained ledgers differ between postures, so a mission that reads another's roster also carries its
 * predecessors' effects; the line says so by naming both numbers, not by judging.
 */
/** Mean starting-force bodies a run by which a posture must differ from Standard before `wrongWay` names it. */
export const LOSS_NOISE = 0.5;

export function wrongWay(posture: PostureId, p: PlanReading, std: PlanReading): string | undefined {
  const rate = (r: PlanReading) => (r.seeds === 0 ? 0 : r.wins / r.seeds);
  const why: string[] = [];
  const easierWay = posture === 'easier';
  if (easierWay ? rate(p) < rate(std) : rate(p) > rate(std)) why.push(`wins ${p.wins}/${p.seeds} against ${std.wins}/${std.seeds}`);
  if (Number.isFinite(p.medianMin) && Number.isFinite(std.medianMin)) {
    if (easierWay ? p.medianMin > std.medianMin * 1.05 : p.medianMin < std.medianMin * 0.95) why.push(`median win ${p.medianMin.toFixed(2)} min against ${std.medianMin.toFixed(2)}`);
  }
  // Half a body a run is the noise floor: the first full reading flagged 35 of 135 on differences down to 0.1 a run,
  // most of them a chained ledger arriving with a different roster rather than the posture acting on the mission.
  if (easierWay ? p.meanLost > std.meanLost + LOSS_NOISE : p.meanLost < std.meanLost - LOSS_NOISE) why.push(`starting losses ${p.meanLost.toFixed(1)} against ${std.meanLost.toFixed(1)}`);
  return why.length === 0 ? undefined : why.join(', ');
}

/** How many seeds a posture run uses: `PT_POSTURE_SEEDS`, else 8 (D13: 8 in CI, 30 in the nightly). 0 turns the
 *  posture ladder off. Throws on anything that is not a whole number from 0 to `max`. */
export function postureSeedCount(env: string | undefined, max: number): number {
  if (env === undefined || env === '') return Math.min(8, max);
  const n = Number(env);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`PT_POSTURE_SEEDS must be a whole number from 0 to ${max}, got "${env}"`);
  return n;
}

/** `PT_POSTURE` as a posture: unset or empty is Standard; anything else must name one. */
export function parsePosture(env: string | undefined): PostureId {
  if (env === undefined || env === '') return 'standard';
  if (!(POSTURE_IDS as readonly string[]).includes(env)) throw new Error(`PT_POSTURE must be one of ${POSTURE_IDS.join(', ')}, got "${env}"`);
  return env as PostureId;
}

/** A plan's wins over its seeds at one posture. */
export interface Rate {
  wins: number;
  seeds: number;
}

/** Monotone (S9): Easier's win rate is no lower than Standard's, and Standard's no lower than Harder's. Compared
 *  as fractions in integers (a/b >= c/d iff a*d >= c*b). A posture with no seeds is not compared. */
export function monotoneFailure(label: string, r: Readonly<Record<PostureId, Rate>>): string | undefined {
  const ge = (a: Rate, b: Rate): boolean => a.seeds === 0 || b.seeds === 0 || a.wins * b.seeds >= b.wins * a.seeds;
  const pct = (x: Rate): string => `${x.wins}/${x.seeds}`;
  if (!ge(r.easier, r.standard) || !ge(r.standard, r.harder)) {
    return `${label}: FAILED — win rate is not monotone: Easier ${pct(r.easier)}, Standard ${pct(r.standard)}, Harder ${pct(r.harder)}`;
  }
  return undefined;
}

/** What a passive control at a posture must end in: a loss of any kind. */
export function passiveLost(outcome: string | undefined): boolean {
  return outcome === 'defeat' || outcome === 'withdrawn';
}

/** The overlaid time limit a posture plays `id` on. */
export function postureLimit(id: string, posture: PostureId): number | undefined {
  const m = (missions as unknown as Record<string, (OverlayMission & { time_limit_s?: number }) | undefined>)[id];
  if (m === undefined) return undefined;
  return applyOverlays(m, { posture }).time_limit_s;
}

/** The clock validator over every shipped mission at every posture (S8): empty when clean. */
export function postureClockFailures(): string[] {
  const out: string[] = [];
  for (const [id, m] of Object.entries(missions)) {
    for (const posture of POSTURE_IDS) {
      const o = applyOverlays(m as unknown as OverlayMission, { posture });
      // Standard is the authored mission: it is held to the authored 2x floor, which validate:data already checks.
      const fails = timeLimitFailures(o, `${id} at ${posture}`, { overlaid: o !== (m as unknown) });
      out.push(...fails);
    }
  }
  return out;
}
