/**
 * `&fitbuildings` -- the MOCK switch for drawing each building mesh at its
 * footprint's size (lead ruling 7 Oct; the rule is `@lions/render`'s
 * `three/units/building-fit.ts`). Bare `&fitbuildings` is `clamped`, the
 * recommended rule; `=uniform` and `=stretch` are the two alternatives it
 * was measured against, so the lead can walk all three from one build.
 *
 * Unlike `&tod`, it applies to a MISSION as well as the sandbox: the point
 * of the mock is to see the campaign's own towns before and after, and it
 * is presentation only -- the sim's footprints and blocked tiles are the
 * same either way, so no score or outcome can depend on it.
 *
 * An unrecognised value draws the shipped size and says why, the same
 * shape `timeOfDayOf` uses.
 */
import type { BuildingFit } from '@lions/render';

export const BUILDING_FITS: readonly BuildingFit[] = ['off', 'uniform', 'clamped', 'stretch'];

export function buildingFitOf(params: URLSearchParams): {
  readonly value: BuildingFit;
  readonly warning: string | null;
} {
  const raw = params.get('fitbuildings');
  if (raw === null) return { value: 'off', warning: null };
  if (raw === '' || raw === '1') return { value: 'clamped', warning: null };
  if ((BUILDING_FITS as readonly string[]).includes(raw)) return { value: raw as BuildingFit, warning: null };
  return { value: 'off', warning: `unknown &fitbuildings value "${raw}" — drawing buildings at their shipped size` };
}
