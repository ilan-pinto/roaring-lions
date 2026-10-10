/**
 * `&fitbuildings=<rule>` -- the comparison switch for how building meshes
 * are fitted to their footprints (lead ruling 7 Oct; the rule is
 * `@lions/render`'s `three/units/building-fit.ts`). Absent, the renderer
 * draws its own default (`stretch`) and this returns `undefined`, so the
 * default lives in ONE place. `=off` draws the shipped size; bare is
 * `stretch`; `=uniform` and `=clamped` are the rules it was chosen over.
 *
 * Unlike `&tod`, it applies to a MISSION as well as the sandbox: it exists
 * to compare the campaign's own towns, and it is presentation only -- the
 * sim's footprints and blocked tiles are the same either way, so no score or
 * outcome can depend on it.
 *
 * An unrecognised value draws the shipped size and says why, the same
 * shape `timeOfDayOf` uses.
 */
import type { BuildingFit } from '@lions/render';

export const BUILDING_FITS: readonly BuildingFit[] = ['off', 'uniform', 'clamped', 'stretch'];

export function buildingFitOf(params: URLSearchParams): {
  readonly value: BuildingFit | undefined;
  readonly warning: string | null;
} {
  const raw = params.get('fitbuildings');
  if (raw === null) return { value: undefined, warning: null };
  if (raw === '' || raw === '1') return { value: 'stretch', warning: null };
  if ((BUILDING_FITS as readonly string[]).includes(raw)) return { value: raw as BuildingFit, warning: null };
  return { value: undefined, warning: `unknown &fitbuildings value "${raw}" — drawing the default fit` };
}
