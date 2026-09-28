/**
 * Which light draws the map: a mission's authored `time_of_day`, or the
 * sandbox's own `&tod=` flag (R-12, N-23). A mission always wins over the
 * flag -- a real battle's look is authored, not a dev knob -- and an
 * unrecognised value falls back to `day` and says why, the same shape
 * `unknownParams` uses for a typo'd flag name rather than a typo'd value.
 *
 * `mission` is typed structurally, not as `@lions/sim`'s `MissionJson`,
 * because that type does not model `map.time_of_day` -- the sim never reads
 * it, the same reason `town`/`phase` are read off the raw JSON in `main.ts`
 * rather than widening that type for a lookup only `app` makes.
 */
import type { TimeOfDay } from '@lions/render';

export const TIMES_OF_DAY: readonly TimeOfDay[] = ['dawn', 'day', 'dusk', 'night'];

export function isTimeOfDay(v: unknown): v is TimeOfDay {
  return typeof v === 'string' && (TIMES_OF_DAY as readonly string[]).includes(v);
}

/** A mission's authored value wins; the sandbox reads `&tod=`; anything else
 *  is day. An unrecognised value falls back to day and returns a warning
 *  naming it. */
export function timeOfDayOf(
  mission: { readonly map: object } | null,
  params: URLSearchParams
): { readonly value: TimeOfDay; readonly warning: string | null } {
  if (mission !== null) {
    // A real mission never reads `&tod=`, authored or not (N-23): a battle's
    // look is the mission's own, and a dev flag must not change it just
    // because the author left the field at its schema default.
    const authored = (mission.map as { time_of_day?: unknown }).time_of_day;
    // Schema-validated (`validate:data`) before this ever runs, so an
    // authored value is trusted rather than re-checked against
    // `isTimeOfDay` -- the same trust every other mission field gets here.
    return { value: authored !== undefined ? (authored as TimeOfDay) : 'day', warning: null };
  }
  const raw = params.get('tod');
  if (raw === null) {
    return { value: 'day', warning: null };
  }
  if (isTimeOfDay(raw)) {
    return { value: raw, warning: null };
  }
  return { value: 'day', warning: `unknown &tod value "${raw}" — using day` };
}
