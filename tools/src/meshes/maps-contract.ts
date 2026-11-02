/**
 * The L3 maps contract (GH-943): what `maps-pass.ts` writes into a vehicle GLB and what
 * the runtime, the gates and the budget check read back. Dependency-free for the reason
 * `kit-contract.ts` and `running-gear-contract.ts` give: the pass, the tests and the
 * validators all need it, and none of them should import a CLI entry point.
 *
 * The pass sits in the vehicle pipeline at ONE place, and the order is load-bearing:
 * export -> rescale -> running-gear -> **maps** -> kit -> wreck -> damage -> encode.
 * After running-gear because the maps are computed on the shipped geometry (the pass adds
 * vertices); before kit because the kit's UVs collapse onto three bake texels the maps
 * must keep flat; the wreck and damage passes then share the one material.
 */

/** The scene-level extras key: `{ version, size, generator_sha256, team_fraction, swatches, ... }`. */
export const MAPS_EXTRAS_KEY = 'rl_maps';

/** Material extras: true when the normal and ORM maps are AUTHORED (the runtime keeps both
 *  maps, drives roughness at 1 and takes the metal cap for metalness). */
export const ORM_EXTRAS_KEY = 'rl_orm';

/** Material extras: the mean LINEAR luminance of the base colour over the team-mask texels,
 *  which the runtime's team hook divides by (so the panel keeps the bake's grime). */
export const TEAM_LUMA_KEY = 'rl_team_luma';

export const MAPS_VERSION = 1;

/** The edge of both maps, texels. The lead's ruling, 2 Nov 2026 (GH-943). */
export const MAPS_SIZE = 2048;

/** Which vehicles have a map generator, and where it lives (repo-relative). */
export const MAPS_RECIPES: Readonly<Record<string, { readonly script: string; readonly kit: string }>> = {
  mbt_lavi: { script: 'tools/vehicles/lavi_maps.py', kit: 'art/parts/kit/mbt_lavi.glb' },
};

/** The team mask's share of the surface the lead approved (about 2%), and the band the
 *  shipped number must sit in. */
export const TEAM_FRACTION_TARGET = 0.02;
export const TEAM_FRACTION_BAND: readonly [number, number] = [0.015, 0.025];
