/**
 * The named draw layers the visual gate can switch off, and the reason that
 * switch exists at all.
 *
 * `tools/src/ci/three-baseline-gate.ts` is a golden-image gate: it compares a
 * capture against a PNG somebody blessed. On a runner with no blessed baseline
 * -- a fresh OS, a new GL backend, the first CI run on a new platform -- there
 * is nothing to compare against, and until this file existed the whole verdict
 * in that state was ONE structural question about ONE 450x400 ground crop
 * (`groundTextureCheck`: "is this crop mostly a single flat colour"). Erasing
 * every decor object on every map walked straight past it, measured
 * (`tools/src/golden-diff/baseline.ts`'s header).
 *
 * The project's own standard of proof for "this art actually draws" is the
 * visible-toggle A/B: hide the layer, capture, show it, capture, and require
 * the two frames to DIFFER. It is texture-proof by construction -- it does not
 * care what the layer looks like or what is underneath it, only whether the
 * layer contributes pixels -- and it needs no stored reference, so it votes in
 * exactly the state a golden-image gate cannot. This module is the seam that
 * lets the harness perform it against the real renderer instead of a stand-in.
 *
 * WHY A NAMED LIST RATHER THAN A SCENE WALK. A gate that hid "everything whose
 * `renderOrder` is in band N" would be one refactor away from silently hiding
 * nothing, and hiding nothing reads as a layer that draws nothing -- the same
 * false green the toggle exists to remove, arrived at from the other side. A
 * name that no longer resolves THROWS (`ThreeRenderer.setDebugLayerVisible`),
 * and a layer that resolves to zero objects produces a zero pixel delta, which
 * is a FAILING toggle check. Both directions of breakage are loud.
 *
 * This is a debug surface and deliberately NOT on `Renderer` (`../api.ts`):
 * `packages/app` must not grow a dependency on a backend-only instrument, and
 * the compiler is what keeps it off one. The gate reaches it from an injected
 * page script, which is three-only by construction (it drives `?renderer=three`).
 */

/**
 * Every layer the gate can toggle. Each entry is a real, separable
 * contribution to the frame -- not a scene-graph convenience.
 *
 * - `scatter`     the stone-grain/sward/rubble mark mesh (`terrain/scatter.ts`).
 *                 The defect class this whole gate was built for: marks that
 *                 composite into their own ground tone and vanish.
 * - `decor`       both decor batches, palette-shaded and textured
 *                 (`terrain/decor-mesh.ts`, `terrain/decor-textured-mesh.ts`).
 *                 One name, because one authoring fault (`decor-place.ts`'s
 *                 `familyFor`) empties both.
 * - `ground-albedo` the five ground texture slots, driven to strength 0 --
 *                 which is not a visibility flag but the material's OWN
 *                 documented fail-soft path (`GROUND_SLOTS`; every strength
 *                 starts at 0 and a 404 leaves it there). Hiding it therefore
 *                 reproduces exactly "the texture never arrived", and the
 *                 delta is the whole contribution of the shipped tiles.
 * - `buildings`   structure boxes, mesh building clones (idle and wreck) and
 *                 the billboard structure instancers.
 *
 * THERE IS NO `units` LAYER, and the reason is measured rather than an
 * oversight. One was written, gated and thrown away: `updateMeshUnits` and
 * `updateVehicleMeshes` assign `entity.root.visible` from fog visibility on
 * EVERY frame (`ThreeRenderer.ts`, the two `unitIsObserved` writes), so the
 * repaint that is supposed to photograph the units missing is the same call
 * that puts them back. On the `vehicle` scenario -- a frame whose subject IS
 * mesh vehicles, 94 objects toggled -- hiding "units" moved 76 px / 0.0100,
 * against 6922 px / 0.5014 for hiding scatter in the same frame. It was not
 * measuring the units; it was measuring the few billboard instancers and
 * silhouettes that happen not to be re-asserted. A layer this seam can only
 * hide for less than one frame is a layer it cannot measure, and shipping it
 * would have meant a check that fails on a healthy tree for a reason nobody
 * could read. Giving units a real toggle means a flag the per-frame path
 * consults, which is shipping-code surface this instrument has not earned.
 */
export const DEBUG_LAYERS = ['scatter', 'decor', 'ground-albedo', 'buildings'] as const;

export type DebugLayer = (typeof DEBUG_LAYERS)[number];

export function isDebugLayer(name: string): name is DebugLayer {
  return (DEBUG_LAYERS as readonly string[]).includes(name);
}

/** The message a bad layer name throws with. Names the known set, because the
 *  caller is a string in a harness script and a typo there would otherwise be
 *  indistinguishable from a layer that draws nothing. */
export function unknownDebugLayerMessage(name: string): string {
  return (
    `ThreeRenderer.setDebugLayerVisible: unknown layer "${name}". ` +
    `Known layers: ${DEBUG_LAYERS.join(', ')}.`
  );
}
