/**
 * The team-mark contract (L3, GH-943): what `mark-pass.ts` writes into a vehicle GLB and what the runtime,
 * the gates and the tests read back. Dependency-free for the reason `kit-contract.ts` gives.
 *
 * The mark is NOT a texture. It is a pair of boxes in the vehicle's own mesh-local frame (a roof recognition
 * panel and a band on each flank of the turret), tested in the fragment shader against the fragment's OBJECT
 * space position and normal (`packages/render/src/three/units/team-mask.ts`). Its edges are straight lines in
 * that frame and cannot follow a UV seam; it costs no texture memory; and because the test is on the mesh-local
 * position it turns with the turret (the turret meshes hang off `turret_pivot`).
 *
 * Pipeline position: export -> rescale -> running-gear -> MARK -> kit -> wreck -> damage -> encode. It writes
 * material and scene extras only, so the order is not load-bearing for geometry; it sits before the kit so the
 * measurement (`tools/vehicles/lavi_mark.py`) reads the host meshes alone.
 */

/** The MATERIAL extras key the shader reads (`GLTFLoader` hands extras over as `userData`). */
export const MARK_EXTRAS_KEY = 'rl_team_mark';

/** The SCENE extras key marking a file as already run through the pass (the pass refuses a marked file). */
export const MARK_SCENE_KEY = 'rl_team_mark_pass';

export const MARK_VERSION = 1;

/**
 * Which vehicles have a mark recipe, and so MUST carry one (`validate:meshes` refuses a roster id without it).
 * All three are one hull and one bake (`tools/vehicles/lavi_mark.py`, `MARKS`), each with its own boxes. `kit` is the
 * kit source whose pinned UVs the shader excludes; the two variants have no kit and exclude nothing.
 */
export const MARK_RECIPES: Readonly<Record<string, { readonly script: string; readonly kit: string | null }>> = {
  mbt_lavi: { script: 'tools/vehicles/lavi_mark.py', kit: 'art/parts/kit/mbt_lavi.glb' },
  mbt_lavi_camo: { script: 'tools/vehicles/lavi_mark.py', kit: null },
  officer_armour: { script: 'tools/vehicles/lavi_mark.py', kit: null },
};

/** The mark's share of the covered surface the lead approved (about 2%), and the band a shipped number must sit in. */
export const TEAM_FRACTION_BAND: readonly [number, number] = [0.015, 0.025];

/** What `material.extras.rl_team_mark` holds. */
export interface TeamMark {
  readonly version: number;
  readonly roof: { readonly x: readonly [number, number]; readonly z_half: number; readonly y: readonly [number, number]; readonly min_ny: number };
  readonly band: { readonly x: readonly [number, number]; readonly y: readonly [number, number]; readonly min_nz: number };
  readonly exclude_uv: readonly (readonly [number, number])[];
  readonly exclude_radius: number;
  /** Mean linear luma of the base colour under the mark. */
  readonly luma: number;
  readonly team_fraction: number;
  /** What `team_fraction` counts: `texel` (the Lavi, as shipped) or `triangle` (a variant, whose added parts have no texel area). */
  readonly team_fraction_basis?: 'texel' | 'triangle';
}
