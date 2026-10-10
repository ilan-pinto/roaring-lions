/**
 * Making a defeat impossible to miss (PR 361, the lead's ruling on 3 Oct
 * 2026). On Umm Zeitoun II the lead watched a hold clock read "0:52 NOBODY
 * HOLDING" and stop, and took it for a stuck game. What actually happened was
 * that the 300 s `raze` primary ran out, which LOSES the mission, and every
 * clock froze where it stood. Three surfaces, all app-side and all read-only
 * over what the runtime already reports:
 *
 *  1. `failureReason`: the moment a mission is lost, say WHICH primary failed
 *     and when ("Objective failed: Level the post … · 5:00"), in the feed and on the
 *     outcome card. The cause is `MissionRuntime.defeatCause`, the read
 *     telemetry already uses, never re-derived here.
 *  2. `FAILED_CLOCK` (`hud-model.ts`): once the mission is lost, every running
 *     clock reads "MISSION FAILED" instead of a frozen count.
 *  3. `deadlineWarnings`: one feed line a minute before a deadline that loses
 *     the mission runs out.
 */
import { TICKS_PER_SECOND, type DefeatCause } from '@lions/sim';
import { t } from '../i18n/t';
import { DEADLINE_TYPES, clockText } from './hud-model';

/** The failure sentence for the mission just lost, or null when the runtime
 *  gave no cause (a mission that is not lost). `tick` is the tick it ended on. */
export function failureReason(
  cause: DefeatCause | undefined,
  objectives: readonly { id: string; text: string }[],
  tick: number
): string | null {
  if (cause === undefined) return null;
  const at = clockText(tick);
  if (cause === 'force_destroyed') return t('outcome.failed.force', { at });
  if (cause === 'roe_collapse') return t('outcome.failed.conduct', { at });
  const text = objectives.find((o) => o.id === cause.objective)?.text ?? cause.objective;
  return t('outcome.failed.objective', { text, at });
}

/** How long before a deadline runs out the feed warns, in ticks. */
export const DEADLINE_WARN_TICKS = 60 * TICKS_PER_SECOND;

interface DeadlineRow {
  id: string;
  type?: string;
  text: string;
  status: string;
  ticksLeft?: number;
}

/**
 * The deadlines that have just come within a minute of losing the mission:
 * active `raze`/`collapse`/`evacuate_before` objectives with a visible clock
 * at or under `DEADLINE_WARN_TICKS` (and not yet expired), not already in
 * `warned`. Returns the rows to warn about and the updated warned set; the
 * caller keeps the set, so each deadline warns exactly once per mission.
 */
export function deadlineWarnings<R extends DeadlineRow>(
  rows: readonly R[],
  warned: ReadonlySet<string>
): { warn: R[]; warned: ReadonlySet<string> } {
  const warn = rows.filter(
    (o) =>
      o.status === 'active' &&
      o.type !== undefined &&
      DEADLINE_TYPES.has(o.type) &&
      o.ticksLeft !== undefined &&
      o.ticksLeft > 0 &&
      o.ticksLeft <= DEADLINE_WARN_TICKS &&
      !warned.has(o.id)
  );
  if (warn.length === 0) return { warn, warned };
  return { warn, warned: new Set([...warned, ...warn.map((o) => o.id)]) };
}

/** The feed line for one deadline warning. */
export function deadlineWarningLine(row: { text: string; ticksLeft?: number }): string {
  return t('hud.deadline.warn', { text: row.text, left: clockText(row.ticksLeft ?? 0) });
}
