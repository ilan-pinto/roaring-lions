/**
 * The named exemption that lets ONE decor family ship its own baked texture
 * instead of being repainted from the palette.
 *
 * ## Why an exemption exists at all
 *
 * Every other decor mesh draws through `rampMaterial`, which takes one flat
 * tone out of a `data/palette.json` ramp (`decor-role.ts`) and lets the scene
 * sun do the shading. That is right for a rock, a bush or a boulder: objects
 * that sit ON the ground, whose colour genuinely belongs to the palette, and
 * whose rounded forms give the light something to model.
 *
 * The anti-tank ditch is not that kind of object. Its job is to REPLACE a
 * patch of ground -- the terrain is an extruded heightfield and there is no
 * way to cut a hole in it, so an asset that brings its own ground is the only
 * shape that can express a trench at all. And the ground it brings is a flat
 * apron: one tone over a near-constant normal, so the light has nothing to
 * model and every texel of it comes out the same colour, by construction
 * rather than by bad luck. Dropped onto terrain that carries its own grain and
 * scatter, a uniformly-coloured slab does not read as ground with a ditch in
 * it. It reads as a plaque with a ditch printed on it.
 *
 * So the palette path does not merely look worse here; it cannot express the
 * asset. The project lead's standing instruction for supplied Meshy sources
 * ("used as is unless ill provide other instruction") points the same way,
 * and the same override already exists one directory over for three
 * buildings -- but the argument above is the one that decides it.
 *
 * ## The exemption is a LIST, on purpose -- the same shape as the buildings'
 *
 * `TEXTURED_DECOR_FAMILIES` below is the whole opt-out, and it must stay in
 * step with `TEXTURED_DECOR_EXEMPT` in `tools/validate_mesh_assets.py`.
 * `textured-decor.test.ts` parses the Python set and fails if the two drift.
 *
 * Two locks, deliberately, mirroring `TEXTURED_BUILDING_TYPES`:
 *
 *  1. The GLB says what it is. A textured decor mesh carries
 *     `extras.rl_textured = true` instead of an `rl_role` -- it has no
 *     palette ramp to name -- so the runtime reads the fact rather than
 *     inferring it.
 *  2. The list says who is ALLOWED to. A decor GLB outside this list that
 *     ships a texture (or sets that flag) fails `pnpm validate:meshes`
 *     rather than being silently upgraded. The gate is not weakened for
 *     everything in order to admit one asset.
 *
 * ## Why not just add a fifth decor ROLE
 *
 * Because a role IS a palette ramp -- `rampForDecorRole` maps one to the
 * other and throws on anything else. A textured mesh has no ramp, so a
 * `ditch` role would be a role that means "not a role", and every reader of
 * `DECOR_MESH_ROLES` would have to learn the exception anyway. Keying on the
 * family (which the loader already has, as the `<family>_<variant>` GLB key)
 * leaves the closed role vocabulary genuinely closed.
 *
 * ## Where the material itself lives
 *
 * Not here. `decor-textured-mesh.ts` builds the `InstancedMesh` with
 * `world-materials.ts`'s `texturedMapMaterial`, the same call the textured
 * buildings take -- one lit `MeshStandardMaterial` around the bake, with the
 * colour-space handling (`prepareTexturedMap`, sRGB) in the one place both
 * asset classes share.
 *
 * This file used to own a hand-written `ShaderMaterial` of its own, and the
 * reason is worth keeping even though the material is gone: it could NOT
 * simply delegate to the buildings' one, because decor draws instanced and
 * buildings do not. three.js declares `instanceMatrix` for an instanced draw
 * but does not rewrite a hand-written `ShaderMaterial` to apply it, so
 * delegating drew all 44 segments of a 44-tile ditch stacked at the map's
 * north-west corner while the CPU-side instance matrices -- all any unit test
 * could read back -- stayed perfectly correct. A `MeshStandardMaterial` has no
 * such trap: three's own chunks handle instancing, batching and skinning, and
 * that is a large part of what this whole change buys.
 */

/**
 * The decor families whose GLBs may ship their own baked material. Every
 * other family takes `rampForDecorRole` exactly as before.
 *
 * Must stay in step with `TEXTURED_DECOR_EXEMPT` in
 * `tools/validate_mesh_assets.py`.
 */
export const TEXTURED_DECOR_FAMILIES: ReadonlySet<string> = new Set(['ditch']);

/**
 * The `<family>` half of a `<family>_<variant>` decor GLB key.
 *
 * `ditch_0` -> `ditch`. Splits on the LAST underscore, so a future
 * two-word family name survives.
 */
export function decorFamilyOf(key: string): string {
  const cut = key.lastIndexOf('_');
  return cut === -1 ? key : key.slice(0, cut);
}

/** Whether this `<family>_<variant>` key is allowed to ship a texture. */
export function isTexturedDecorKey(key: string): boolean {
  return TEXTURED_DECOR_FAMILIES.has(decorFamilyOf(key));
}
