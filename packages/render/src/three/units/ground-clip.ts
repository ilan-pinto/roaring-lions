/**
 * The per-vertex ground-clip depth clamp, shared between `instances.ts`'s
 * `createUnitMaterial` and `structures.ts`'s `createStructureMaterial` --
 * pulled out to its own file rather than copied a second time, on the same
 * `render-order.ts` precedent this codebase already has for "two files
 * owning the same constant independently and colliding" (see that module's
 * own top comment for the incident that made the rule).
 *
 * ## Why structures need this too, not merely "the same bug, probably"
 *
 * `f54be82` fixed this for `unitBillboardGeometry`/`createUnitMaterial` and
 * left `structures.ts` an open question, not a second fix: "Confirmed by
 * reading, not measured." The premise the fix depends on --this camera is
 * orthographic and fixed-pitch, so clip-space depth is affine in local "up"
 * at fixed local "right"-- was proved there against the real
 * `dimetricCamera`, not merely assumed, and every step of that proof reads
 * off the SAME two inputs `structureBillboardGeometry`'s quad also uses:
 * `screenOffsetToWorld` for the right axis and `WORLD_Y_PER_LIFT_PIXEL` for
 * local "up" (`structures.ts`'s own `corner()`, byte-identical in shape to
 * `unitBillboardGeometry`'s). `createStructureMaterial`'s vertex shader
 * computes `modelViewMatrix * instanceMatrix * vec4(position, 1.0)` before
 * projecting -- the same `InstancedMesh` chain `createUnitMaterial` uses --
 * so the reference point this clamp needs (the same instance's own clip-
 * space depth at local up = 0) is the identical computation for either
 * material. Nothing about the proof leans on a unit-specific number
 * (`half`, `scale`, sheet size); it leans only on the camera and the
 * instancing chain, both shared. Measured, not merely reasoned from that
 * shared premise: a live, undamaged `apartment` billboard at
 * `beit_sahwan_outskirts` (36.5, 18.0) showed the identical defect
 * signature `f54be82` found on `mbt_lavi` -- a solid, textured band several
 * pixels wide along the wall's own base, in the SHAPE of the wall's masonry
 * texture on the Pixi reference and flat road ground on three -- not the
 * 1-2px interpolated fringe antialiasing produces. See
 * `.superpowers/d-structure-clip-report.md` for the full capture. `mosque`
 * and `shanty`, also captured, showed no such band -- expected, not a
 * contradiction: `mosque`'s own wall/dome art has little opaque content in
 * the geometrically-sunk lower band at this camera angle, and `shanty`'s
 * `heightPx` (11px, Pixi's `height_px` in `data/structures.json`) is small
 * enough that the sunk sliver is a few screen pixels, the same "vehicle-
 * specific, not uniform" scaling `instances.ts`'s own top comment already
 * documents for infantry vs. tanks. `apartment` (`height_px: 30`, the
 * tallest arted type after `mosque`) is exactly where the effect was
 * expected to be large enough to see, and it was.
 *
 * ## What is NOT shared here, and why
 *
 * `collapseBillboardGeometry`/`createCollapseMaterial` (`structures.ts`,
 * Task B4.4's falling-building animation) are architecturally the same
 * shape -- a one-off `Mesh`, not an `InstancedMesh` -- so this clamp does
 * not apply verbatim: there is no `instanceMatrix` to multiply, and the
 * material is a plain `THREE.MeshBasicMaterial` with no custom vertex stage
 * to inject into at all (`onBeforeCompile` would be a different, larger
 * change). Its own vertex range covers the identical `-halfH..+halfH` world
 * band relative to the footprint's ground height (see that function's own
 * doc comment: translated to `worldY - halfH * WORLD_Y_PER_LIFT_PIXEL`,
 * local up `0..drawHeightPx`), so it is architecturally exposed to the same
 * failure mode -- unconfirmed by measurement here, the same status
 * `structures.ts`'s steady-state billboard carried before this file existed.
 * Left open rather than guessed at, on this task's own instruction not to
 * fix what has not been shown to be visible.
 *
 * ## The snippet itself
 *
 * Insert immediately after the ordinary `gl_Position = projectionMatrix *
 * mvPosition;` line, once `mvPosition` has been assigned from
 * `modelViewMatrix * instanceMatrix * vec4(position, 1.0)`. Recomputes the
 * SAME instance/right-column's clip-space depth at local up = 0
 * (`position.y` zeroed, `x`/`z` left alone -- the instance's own ground-
 * contact point) and clamps to whichever is nearer. A vertex already above
 * ground has a nearer depth than that reference, so `min()` leaves it
 * untouched -- real depth tests against a ridge, another building, or a
 * unit still vary per-vertex exactly as before. A vertex below ground ties
 * with the ground instead of losing to it, resolved by the same opaque-
 * before-transparent + `LessEqualDepth` mechanism `instances.ts`'s own top
 * comment already documents for the unit case. Exact, not approximate, for
 * this orthographic camera: `gl_Position.w` and `groundClip.w` are both 1
 * (neither matrix in the chain carries a perspective row), so comparing
 * `gl_Position.z` and `groundClip.z` directly compares genuine NDC depth
 * with no divide needed. Full derivation: `instances.ts`'s own top comment,
 * "Fixed: a per-vertex depth clamp, not a second quad" -- not restated here,
 * to keep one source of truth for the proof rather than two that can drift.
 */
export const GROUND_CLIP_DEPTH_CLAMP_GLSL = /* glsl */ `
        vec4 groundPosition = modelViewMatrix * instanceMatrix * vec4(position.x, 0.0, position.z, 1.0);
        vec4 groundClip = projectionMatrix * groundPosition;
        gl_Position.z = min(gl_Position.z, groundClip.z);
`;
