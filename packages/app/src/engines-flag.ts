/**
 * Which engine-loop candidate a battle plays (GH-35): the sandbox's
 * `&engines=a|b`, so the lead can judge candidate A against B in the game
 * itself rather than on a listening page. A mission never reads the flag --
 * it plays every loop's `pick` in `data/audio.json`, and the lead's choice is
 * a one-line change there -- the same rule `&tod=` follows (`time-of-day.ts`).
 *
 * `null` means "the data's own pick". An unrecognised value falls back to it
 * and returns a warning naming the value, the shape `timeOfDayOf` uses.
 */
import { isEngineVariant, type EngineVariantId } from '@lions/render';

export function enginesOf(
  mission: object | null | undefined,
  params: URLSearchParams
): { readonly value: EngineVariantId | null; readonly warning: string | null } {
  if (mission) return { value: null, warning: null };
  const raw = params.get('engines');
  if (raw === null) return { value: null, warning: null };
  if (isEngineVariant(raw)) return { value: raw, warning: null };
  return { value: null, warning: `unknown &engines value "${raw}" — using each loop's data pick (a or b)` };
}
