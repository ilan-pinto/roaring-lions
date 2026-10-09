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
import type { LightOverride, TimeOfDay } from '@lions/render';

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

/**
 * PA-24: a mission's optional `map.light` (fill and/or sun shadow strength
 * over its `time_of_day` preset), or nothing. Missions only: the sandbox has
 * no flag for it. Schema-validated (`validate:data`), so trusted here like
 * `time_of_day`; only the two named numbers are carried through.
 */
export function lightOverrideOf(mission: { readonly map: object } | null): LightOverride | undefined {
  if (mission === null) return undefined;
  const raw = (mission.map as { light?: { fill?: unknown; shadow?: unknown } }).light;
  if (raw === undefined) return undefined;
  return {
    ...(typeof raw.fill === 'number' ? { fill: raw.fill } : {}),
    ...(typeof raw.shadow === 'number' ? { shadow: raw.shadow } : {}),
  };
}
