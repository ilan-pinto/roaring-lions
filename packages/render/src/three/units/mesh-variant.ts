/**
 * Which of a unit type's several meshes one entity draws with.
 *
 * Almost every mesh-enabled type has exactly one GLB and this is a one-element
 * lookup. `civilians` is the first that does not (GH-149): `data/units/
 * civilians.json` is ONE type, and four figures were supplied for it -- a
 * woman with a headscarf, an office worker with a messenger bag, a farm worker
 * with a straw hat and a hoe, and a child. A mission fields eleven of them
 * (`beit_sahwan_breach`), and eleven copies of one figure reads as a
 * repeating texture rather than as a village.
 *
 * ## Why a rotation and not a hash
 *
 * `entityId % variants.length`. The obvious alternative -- hash the entity id
 * and index by the hash -- looks more "random" and is worse here, for a
 * reason specific to what this draws: civilians spawn as `civilians.groups`
 * placements, so one group's entities take a CONTIGUOUS block of ids and
 * stand in a cluster on the map. A rotation over a contiguous block is the
 * only assignment that guarantees no two neighbours in that cluster are the
 * same figure and that all four appear before any repeats. A hash gives no
 * such guarantee and will, at eleven draws from four variants, sometimes put
 * three identical figures side by side -- the exact artifact this exists to
 * remove.
 *
 * Regularity is not visible in the result. The four figures differ in
 * silhouette, height (1.20 m to 1.75 m) and accessory, and they are scattered
 * over tiles rather than lined up, so "every fourth one repeats" is not a
 * pattern anybody can see; "three of these are the same person" is.
 *
 * ## Why the entity id, and not something drawn per instantiation
 *
 * It must be STABLE for the whole life of the entity and it must not consult
 * anything that changes. `updateMeshUnits` instantiates a clone the first
 * frame an entity is seen and pools it by id, but a mesh unit is torn down
 * and rebuilt in more cases than that -- `loadMeshUnit` called twice for a
 * type disposes every live clone of it -- and a civilian that changed which
 * person it was mid-mission would be worse than a repeated one. The entity id
 * is the only identifier that survives all of it.
 *
 * Renderer-only, and reads sim state without writing it (invariant 4): the
 * entity id is an index, not a decision the sim is being asked to make. This
 * deliberately does NOT go through the seeded per-entity PRNG (invariant 3),
 * which is sim machinery for sim outcomes; which figure a civilian draws as
 * changes nothing the sim can observe, and pulling from an entity's RNG
 * stream from the renderer would be exactly the coupling invariant 4 forbids.
 */

/**
 * The variant `entityId` draws with. `variants` must be non-empty -- a type
 * with no loaded template is not drawn through this path at all
 * (`updateMeshUnits` skips a type absent from `meshUnitTemplates`), so an
 * empty list here means a template list was built and left empty, which is a
 * bug rather than a state to paper over with a default.
 */
export function pickMeshVariant<T>(variants: readonly T[], entityId: number): T {
  if (variants.length === 0) {
    throw new Error('mesh-variant: no variants loaded for this unit type');
  }
  return variants[entityId % variants.length];
}
