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
 * - `ground-albedo` the six ground texture slots, driven to strength 0 --
 *                 which is not a visibility flag but the material's OWN
 *                 documented fail-soft path (`GROUND_SLOTS`; every strength
 *                 starts at 0 and a 404 leaves it there). Hiding it therefore
 *                 reproduces exactly "the texture never arrived", and the
 *                 delta is the whole contribution of the shipped tiles.
 * - `buildings`   structure boxes, mesh building clones (idle and wreck) and
 *                 the billboard structure instancers.
 *
 * THERE IS A `units` LAYER SINCE 2026-09-10, and the paragraph that used to
 * stand here explaining why there could not be one is worth keeping, because
 * it is still true about the OBVIOUS implementation.
 *
 * One was written, gated and thrown away first: `updateMeshUnits` and
 * `updateVehicleMeshes` assign `entity.root.visible` from fog visibility on
 * EVERY frame (`ThreeRenderer.ts`, the two `unitIsObserved` writes), so the
 * repaint that is supposed to photograph the units missing is the same call
 * that puts them back. On the `vehicle` scenario -- a frame whose subject IS
 * mesh vehicles, 94 objects toggled -- hiding "units" that way moved 76 px /
 * 0.0100, against 6922 px / 0.5014 for hiding scatter in the same frame. It
 * was not measuring the units; it was measuring the few billboard instancers
 * and silhouettes that happen not to be re-asserted.
 *
 * The conclusion drawn then was that a real toggle "means a flag the
 * per-frame path consults, which is shipping-code surface this instrument has
 * not earned". The project lead's call on 2026-09-09 was to earn it, and the
 * reason is that `vehicle` is the ONLY gated scenario whose subject is mesh
 * vehicles: with no reference-free check it was captured and never judged on
 * a runner with no baseline, so a mesh-vehicle regression on a fresh
 * environment passed silently. That is `ThreeRenderer`'s `unitsDebugHidden`
 * -- one boolean, read on a path that already reads fog for the same entity.
 *
 * So the lesson survives the change: **a toggle that only holds until the
 * next frame is not a measurement**, and any future layer whose objects are
 * re-asserted per frame needs the same treatment rather than a bare
 * `setObjectsVisible`.
 *
 * TWO MORE SINCE THE SHELL UPGRADE'S PHASE 0, and they are the two halves of
 * "the world no longer ends in a hard black diagonal":
 *
 * - `vignette`  the corner darkening (`../vignette-pass.ts`), toggled by the
 *               pass's own `enabled`. The first entry here that is not a
 *               scene object at all -- it is a post pass, so there is
 *               nothing to hide, only a pass to skip. It survives the
 *               repaint for the reason the paragraph above demands be
 *               checked rather than assumed: the chain is rebuilt only from
 *               `init()` and `dispose()`, so no per-frame path re-asserts
 *               `enabled`.
 * - `skirt`     the ground beyond the map (`terrain/skirt.ts`), an ordinary
 *               `visible` on one quad added once in the constructor. Only a
 *               scenario whose viewport actually reaches past the map edge
 *               can see it, which is why it does not get a check on every
 *               gated scenario.
 *
 * `overlays`, ADDED FOR TASK 10'S KEY-ART PLATE (not the visual gate --
 * `tools/src/perf/plate-capture.ts` is its only caller today; a `layerChecks`
 * entry can still be added later if a scenario ever wants to gate it). HP
 * bars, suppression bars, selection/threat rings, control-group badges and
 * their numerals, the veterancy chevron, order/objective markers -- every
 * unit AND structure overlay this backend draws, because all of it funnels
 * through the same three meshes (`units/overlays.ts`'s `OverlayBatch`,
 * `NumeralBatch`, `ChevronBatch`; one shared name rather than three, since a
 * key-art plate wants none of them and a caller that hid only one would still
 * show a bare badge ring with no numeral in it). Unlike `units`, this one IS
 * a plain `setObjectsVisible`, not a flag the update path has to consult:
 * each batch's `endFrame()` (`overlays.ts`) only calls `setDrawRange` and
 * flags the buffer attributes dirty -- checked directly, nothing in the
 * per-frame rebuild path ever touches `.visible` -- so a mesh hidden once
 * stays hidden across every later beginFrame/push/endFrame cycle.
 *
 * IT ALSO HIDES THE OCCLUSION SILHOUETTE (`units/silhouette.ts`, band 6),
 * which is a SEPARATE subsystem from the three batches above, not a fourth
 * member of the same tier -- see that file's own top comment for why it
 * exists (a unit walking behind a building must not simply vanish) and
 * `debug-layers.ts`'s task-10-follow-up history for how this was found: a
 * plate captured near a civic structure showed a thin red outline poking
 * through its wall -- not a HUD element at all, but a HOSTILE unit's
 * occlusion outline (`SILHOUETTE_COLOR_KEY_BY_SIDE`, team-coloured),
 * standing behind the building and revealed by the sandbox force's own
 * recon drone. One mesh's ghost-through-walls hint is exactly as unwelcome
 * in key art as a health bar, so it is folded into the same name rather than
 * given its own -- a caller asking a key-art tool to hide "the overlays"
 * should not need to know this is architecturally a different system. Only
 * the MESH-unit path is covered (`ThreeRenderer.silhouetteMeshMaterials`,
 * three shared `MeshBasicMaterial`s, one per side, toggled by `.visible`
 * rather than by object -- every mesh unit's silhouette parts share one of
 * the three regardless of which entity they belong to, so three writes
 * reach all of them with no traversal). The BILLBOARD path
 * (`&nomesh`/`?renderer=pixi`) is NOT covered: it colours per-instance
 * through a shader uniform (`silhouetteTeamColors`, plain `THREE.Color`
 * values with no material of their own to hide), and this layer's only
 * caller always runs on the mesh path, so that gap is recorded rather than
 * closed.
 *
 * `fog`, ADDED FOR THE SAME KEY-ART PLATE, ONE STEP LATER (task-10
 * follow-up 2): the large dark diagonal a first attempt at the plate read as
 * a shadow was the fog-of-war boundary -- `FogOfWarPass` (`../fog-pass.ts`)
 * pulling never-seen ground toward 85% shroud and explored ground toward
 * 40%, which a camera parked near the edge of what the sandbox force can
 * see paints as a hard line.
 *
 * C2 (shell-upgrade Phase 0 final fix wave) CHANGED WHAT THIS DOES. It used
 * to be a `Pass.enabled` flip, exactly `vignette`'s shape -- but that
 * skipped the WHOLE pass, including `FOG_OFFMAP_FADE_TILES`, the off-map
 * fade the same pass carries so ground beyond the map edge reads as
 * never-seen distance rather than a raw, `ClampToEdgeWrapping`-flooded
 * wedge. Disabling the pass to remove the fog-of-war boundary reinstated
 * exactly that wedge in the shipped key art. Hiding this layer now sets
 * `uRevealAll` on the pass's OWN uniforms (`fog-pass.ts`) instead, which
 * forces every ON-map sample to read as fully seen while the off-map fade's
 * maths runs unchanged -- so the fog-of-war boundary disappears and the
 * off-map skirt still darkens toward never-seen. The pass itself is never
 * disabled by this layer any more. Confirmed by reading rather than
 * assumed: `ThreeRenderer.fogPass` is a `Pass | null` set once in `init()`
 * (`this.fogPass = new FogOfWarPass(...)`) and handed to the chain through
 * `PostChain.setFogPass`, which only stores it (`post-chain.ts`) --
 * grepping the whole file for `fogPass.uniforms.uRevealAll` finds no writer
 * outside this one case, so nothing per-frame re-asserts it and a plain
 * uniform write holds across the repaint the way `vignette`'s `enabled`
 * flip does and `units`' plain `visible` write could not.
 */
export const DEBUG_LAYERS = [
  'scatter',
  'decor',
  'ground-albedo',
  'buildings',
  'units',
  'vignette',
  'skirt',
  'overlays',
  'fog',
] as const;

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
