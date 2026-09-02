/**
 * The named exemption that lets a campaign world GLB ship its own baked
 * texture, and the closed vocabulary its nodes are named in.
 *
 * ## Why a third exemption exists
 *
 * `TEXTURED_BUILDING_TYPES` covers three buildings; `TEXTURED_DECOR_FAMILIES`
 * covers one decor family. A campaign world is neither, so neither list can
 * be stretched over it without making both lists mean something vaguer than
 * they say. This is the campaign counterpart, with the same two locks and
 * the same Python twin.
 *
 * Unlike the other two, this one is not a close call. Every other mesh in
 * this tree draws through `toonRampMaterial`, which indexes a palette ramp
 * by `N·L` -- colour as a function of SLOPE. A campaign world's entire
 * subject is BIOME: forest, desert, snow, water, cultivation, all of it
 * colour at a constant normal. A normal-indexed ramp cannot express any of
 * it. Painted from the palette this asset would come out one flat colour per
 * slope angle, and the three regions a player has to tell apart would be
 * identical wherever the ground is flat -- which is most of it. The palette
 * path does not merely look worse here; there is nothing for it to say.
 *
 * ## Two locks, the same pair the buildings and the ditch carry
 *
 *  1. The GLB says what it is. Every mesh node carries
 *     `extras.rl_textured = true` instead of an `rl_role` -- it draws its own
 *     bake, so there is no palette ramp for a role to name.
 *  2. The list says who is ALLOWED to. A campaign GLB outside
 *     `TEXTURED_CAMPAIGN_MAPS` that ships a texture fails
 *     `pnpm validate:meshes` rather than being silently upgraded, and a
 *     listed world that quietly lost its texture fails too.
 *
 * `TEXTURED_CAMPAIGN_EXEMPT` and `CAMPAIGN_MAP_ROLES` in
 * `tools/validate_mesh_assets.py` are the other half of both;
 * `textured-world.test.ts` parses that Python and fails if they drift.
 *
 * ## Colour space, which is where this fails silently if it fails at all
 *
 * Identical to the buildings' and the ditch's problem, and solved by the
 * same call: `GLTFLoader` stamps `SRGBColorSpace` on a baseColorTexture,
 * this renderer's output is pass-through, so an sRGB internal format decodes
 * on every sample with nothing to re-encode it. Whatever draws this asset
 * must run its map through `prepareTexturedMap`
 * (`../units/textured-building.ts`), which forces `NoColorSpace`. Measured
 * elsewhere in this tree, getting it wrong drops a lit wall from rgb 67 to
 * 51 and the result still looks like a building -- which is exactly why it
 * is called out here rather than left to be rediscovered.
 */

/**
 * The campaign worlds whose GLBs may ship their own baked material.
 *
 * The id is the GLB's basename and joins with `data/campaign/world.json`'s
 * own `id`. Must stay in step with `TEXTURED_CAMPAIGN_EXEMPT` in
 * `tools/validate_mesh_assets.py`.
 */
export const TEXTURED_CAMPAIGN_MAPS: ReadonlySet<string> = new Set(['sahar_basin']);

/**
 * What a mesh node in a campaign world GLB is, read from
 * `extras.rl_map_role`.
 *
 * `region` is ground a campaign region is played over: a node the screen may
 * highlight, veil or fly a flag over, and whose `extras.rl_region` names
 * which region in `world.json` it is.
 *
 * `scenery` is everything the diorama needs in order to look like a world
 * and that no region owns -- on `sahar_basin`, the snow range along the
 * north edge and the eastern plateau. The distinction is load-bearing rather
 * than tidy: the eastern node also carries the diorama's entire underside
 * and rim, so tinting it as if it were a region would light up the bottom of
 * the world.
 *
 * Mirrors `CAMPAIGN_MAP_ROLES` in `tools/validate_mesh_assets.py`.
 */
export const CAMPAIGN_MAP_ROLES = ['region', 'scenery'] as const;

export type CampaignMapRole = (typeof CAMPAIGN_MAP_ROLES)[number];

/** Whether a GLB basename is allowed to ship its own baked material. */
export function isTexturedCampaignMap(worldId: string): boolean {
  return TEXTURED_CAMPAIGN_MAPS.has(worldId);
}

/**
 * The town id a marker node names, or `null` if the node is not one.
 *
 * Markers are empty nodes named `<town_id>_town`. The suffix is a naming
 * convention and the `extras.rl_town` value is the truth -- this helper
 * exists for callers walking a glTF scene graph where extras are already in
 * hand, so it takes the extras rather than parsing the name.
 */
export function townOfNode(extras: Readonly<Record<string, unknown>> | undefined): string | null {
  const town = extras?.['rl_town'];
  return typeof town === 'string' && town.length > 0 ? town : null;
}
