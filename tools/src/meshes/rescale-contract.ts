/**
 * The rescale contract: which vehicle GLBs are scaled AFTER their Blender
 * export, and by how much. Dependency-free (bar a type import) for the reason `kit-contract.ts`
 * gives: `rescale-pass.ts`, the kit pass and the running-gear and damage
 * recipes all read it, and none of them should import a CLI entry point.
 *
 * WHY A PASS. The Lavi (`mbt_lavi`) was cut by `export_meshy_tank.py` to the
 * 6.32 m extent of the retired WW2 Tiger sprite's `TNK_HULL` manifest, while
 * the fleet's hulls are ~7.1-7.3 m (D2 asset-seam audit, finding 1). The lead
 * ruled a x1.18 rescale on 2026-10-15, paint untouched. Every literal that
 * places something on the Lavi -- the kit builders (`kit_vehicles.py`), the
 * command Lavi's cupola and mast (`export_officer_armour.py`), the running-gear
 * and damage recipes -- was measured in the 6.32 m frame, so the Blender
 * exporters keep working in THAT frame (`tools/vehicles/rescale.py` divides an
 * imported, already-rescaled GLB back down) and the scale lives here, once.
 *
 * The pipeline for a vehicle in `RESCALE_FACTORS`, order load-bearing:
 * Blender export -> `pnpm rescale:meshes` (the vehicle, and its kit source with
 * `--kit=`) -> `running-gear:meshes` -> `kit:meshes` -> `wreck:meshes` ->
 * `damage:meshes` -> `encode:meshes`. The pass marks the file
 * (`extras.rl_rescale`) and refuses a marked one, so it cannot apply twice;
 * the kit pass refuses a source whose mark differs from its vehicle's.
 */
import type { Document } from '@gltf-transform/core';

/** The scene-level extras key the pass writes: `{ factor }`. */
export const RESCALE_EXTRAS_KEY = 'rl_rescale';

/** The lead's ruling, 2026-10-15: the Lavi x1.18 (6.32 m -> 7.46 m overall). */
export const LAVI_RESCALE = 1.18;

/** Every vehicle scaled after export. `officer_armour` is a re-export of the
 *  shipped Lavi (GH-298), so it carries the Lavi's factor. */
export const RESCALE_FACTORS: Readonly<Record<string, number>> = {
  mbt_lavi: LAVI_RESCALE,
  officer_armour: LAVI_RESCALE,
};

/** The factor a vehicle's recipes are authored to be multiplied by: 1 for a
 *  vehicle that is not rescaled. */
export const rescaleOf = (id: string): number => RESCALE_FACTORS[id] ?? 1;

/** The factor a file is marked with (`extras.rl_rescale.factor`): 1 when
 *  unmarked. */
export function rescaleMark(doc: Document): number {
  const scene = doc.getRoot().listScenes()[0];
  const mark = (scene?.getExtras() as Record<string, unknown> | undefined)?.[RESCALE_EXTRAS_KEY] as
    | { factor?: unknown }
    | undefined;
  if (mark === undefined) return 1;
  if (typeof mark.factor !== 'number') throw new Error(`extras.${RESCALE_EXTRAS_KEY} has no numeric factor`);
  return mark.factor;
}
