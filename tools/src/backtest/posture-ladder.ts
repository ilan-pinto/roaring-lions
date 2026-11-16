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

import { applyOverlays, missions, POSTURE_IDS, type OverlayMission, type PostureId } from '@lions/data';
import { timeLimitFailures } from '../../validate_time_limit.mjs';

/** The two postures the ladder adds; Standard is the existing ladder. */
export const LADDER_POSTURES: readonly PostureId[] = ['easier', 'harder'];

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
