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
import type { GradeJson, LightOverride, TimeOfDay } from '@lions/render';

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

/**
 * Look uplift L2 (GH-943): while the lead judges the mock sheet, no grade draws unless `&grade` is in the URL. The
 * ship PR flips this one constant; `&grade=0` stays as the A/B switch, `&envlight`'s shape.
 */
export const GRADE_ON_BY_DEFAULT = false;

/** The `&grade=<value>` strengths a flag may ask for: 0 is the identity, 1 the file as authored. */
export const GRADE_STRENGTH_MAX = 2;

export interface GradeChoice {
  /** The grade file to bake, or null for "draw the ungraded frame". */
  readonly grade: GradeJson | null;
  readonly strength: number;
  readonly warning: string | null;
}

/**
 * Which colour grade draws the map (look uplift L2, GH-943), beside `timeOfDayOf` and for the same
 * reason: the APP reads it, never the sim's mission type.
 *
 *  - Off unless `&grade` is present (`GRADE_ON_BY_DEFAULT`), and `&grade=0|off|false` always means off.
 *  - `&grade`, `&grade=auto` or `=1`: the grade shipped for `tod` (`dawn`, `dusk`; `night` is dusk, D10).
 *    **Day is the identity and ships no file**, so `auto` on a day map draws today's frame.
 *  - `&grade=<id>` names a file in `data/grades/`; `&grade=<id>:<strength>` scales it (0..2, 1 = as authored).
 *    An unknown id falls back to no grade and says why.
 *  - A mission's authored `map.grade` WINS over the flag's id (not over an explicit off), the way its
 *    `time_of_day` wins over `&tod=`. No shipped mission authors one.
 */
export function gradeOf(
  mission: { readonly map: object } | null,
  params: URLSearchParams,
  tod: TimeOfDay,
  grades: readonly GradeJson[]
): GradeChoice {
  const none = (warning: string | null = null): GradeChoice => ({ grade: null, strength: 1, warning });
  const raw = params.get('grade');
  if (raw === null && !GRADE_ON_BY_DEFAULT) return none();
  const value = raw ?? '';
  if (value === '0' || value === 'off' || value === 'false') return none();
  const [name, strengthRaw] = value.split(':');
  let strength = 1;
  let warning: string | null = null;
  if (strengthRaw !== undefined) {
    const n = Number(strengthRaw);
    if (strengthRaw === '' || !Number.isFinite(n) || n < 0 || n > GRADE_STRENGTH_MAX) {
      warning = `unknown &grade strength "${strengthRaw}" (0 to ${GRADE_STRENGTH_MAX}) — using 1`;
    } else {
      strength = n;
    }
  }
  const authored = mission === null ? undefined : (mission.map as { grade?: unknown }).grade;
  const auto = name === '' || name === 'auto' || name === '1' || name === 'on';
  const id = typeof authored === 'string' ? authored : auto ? (tod === 'day' ? null : tod === 'night' ? 'dusk' : tod) : name;
  if (id === null) return { grade: null, strength, warning };
  const found = grades.find((g) => g.id === id);
  if (found === undefined) {
    return { grade: null, strength, warning: `unknown &grade "${id}" (have ${grades.map((g) => g.id).join(', ')}) — drawing ungraded` };
  }
  return { grade: found, strength, warning };
}
