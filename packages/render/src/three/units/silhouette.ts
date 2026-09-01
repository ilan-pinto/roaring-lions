/**
 * Occlusion silhouettes: a team-coloured OUTLINE of a unit's own shape,
 * visible only through whatever is standing in front of it.
 *
 * ## It was a solid fill first, and that was the wrong picture
 *
 * The first shipped version filled the hidden shape with flat team colour at
 * full alpha. It was legible and it was too loud: against this game's muted
 * desert palette a solid `#2F6FD9` body reads as a paint blob ON the wall
 * rather than as a unit BEHIND it. Dropping the opacity does not fix it and
 * was measured, not guessed -- a merged silhouette mesh has several
 * front-facing layers over one pixel, and with `depthWrite: false` they
 * blend back toward opaque. The project lead chose an outline over both
 * keeping the fill and a depth-equal pre-pass.
 *
 * The outline is an INVERTED HULL, and the interior is punched out by the
 * stencil bit the fill already needed:
 *
 *  - the silhouette geometry is pushed outward along a smoothed per-vertex
 *    normal (`aExpand`, computed once per template below) by a width that
 *    is a constant number of SCREEN pixels at any zoom, so what draws is
 *    the unit's shape grown by a couple of pixels;
 *  - a unit body now stamps the stencil wherever it was RASTERISED at all,
 *    won or lost (`markSilhouetteOccludee`), so the grown shape minus the
 *    real footprint is a ring.
 *
 * That is the whole change, and it costs no extra draw call: the same one
 * mesh per group draws, with a fatter shell and a bigger hole. See "The
 * stencil mask" below for what the bit means now versus what it meant for
 * the fill -- the two readings are mutually exclusive, and the fill's is
 * the one that was replaced.
 *
 * ## The bug
 *
 * `STRUCTURE_RENDER_ORDER === HULL_RENDER_ORDER === 0` (`render-order.ts`)
 * is not a mistake -- buildings and units share one band precisely so the
 * real depth buffer arbitrates between them, exactly as Pixi's `spriteLayer`
 * z-sorts them together. The consequence is correct and unhelpful: a unit
 * that walks behind a building is not dimmed, not outlined, not anywhere. It
 * is gone. In a town fight -- the part of this game that is most worth
 * playing -- the player loses track of their own squads.
 *
 * ## The mechanism, and why it is not `depthTest: false`
 *
 * `units/fx.ts`'s above-units tier draws over everything with `depthTest:
 * false`. That is the wrong instrument here: it would paint the unit's whole
 * shape over the building unconditionally, whether or not anything was
 * hiding it, so a unit standing in the open would read as a flat cut-out.
 *
 * The silhouette instead keeps `depthTest: true` and inverts the comparison:
 * `depthFunc: THREE.GreaterDepth`. A fragment is drawn only where the depth
 * buffer ALREADY holds something nearer -- which is precisely the set of
 * pixels where the unit lost the depth test and vanished. Where the unit
 * won, the silhouette's own fragment ties with the body's own depth, is not
 * *greater* than it, and is discarded. Nothing is drawn for a unit standing
 * in the open, at any cost, at any unit count.
 *
 * `depthWrite: false` for the obvious reason: a silhouette must never
 * occlude the geometry it is painted over, or the next thing drawn behind
 * that building would lose to a unit hiding inside it.
 *
 * ## The stencil mask, and the artefact it exists to kill
 *
 * `GreaterDepth` ALONE is not enough, and this was measured rather than
 * reasoned: the first working build painted blue blobs across every vehicle
 * standing in the open on `beit_sahwan_outskirts`. A unit occludes ITSELF.
 * A tank's near hull sits in front of its own far hull, a turret in front of
 * its own deck, a rifleman's front figure in front of his squadmate -- at
 * those pixels the depth buffer holds something nearer that belongs to the
 * same unit, `GreaterDepth` passes, and flat colour is painted over the
 * model's own back with no building anywhere near it.
 *
 * The fix is a one-bit stencil mask:
 *
 *  - every unit BODY material writes `SILHOUETTE_STENCIL_REF` wherever it
 *    was RASTERISED -- `stencilZPass` AND `stencilZFail` both `Replace`
 *    (`markSilhouetteOccludee`), so the bit means "a unit's own footprint
 *    covers this pixel", whether that fragment won the depth test or lost
 *    it;
 *  - every silhouette material draws only where the stencil is NOT that
 *    value.
 *
 * A unit's whole projected footprint is therefore masked out, and the
 * expanded shell only survives in the ring OUTSIDE it. That kills the
 * blue-blob artefact for the same reason it did before (a unit's own far
 * side is inside its own footprint) and, in the same bit, punches the
 * outline's interior. No CPU occlusion test, no per-unit state, no second
 * pass, one extra bit per pixel.
 *
 * **This is not what the bit meant for the fill.** The fill needed
 * `stencilZFail: Keep` -- a body fragment that LOST had to leave the mask
 * clear, because the fill *was* the lost region. The outline needs the
 * opposite. One bit cannot serve both readings, which is why replacing the
 * fill with an outline is a change to the body materials and not only to
 * the silhouette ones.
 *
 * One consequence worth recording, because it retires a subtlety rather
 * than adding one: the stamp no longer depends on the depth test, so it no
 * longer depends on DRAW ORDER either. `WORLD_RENDER_ORDER` (-1) was added
 * because a unit stamping "I won" before the building in front of it had
 * drawn stamped a lie, and the tank's own silhouette came out as slivers.
 * A footprint stamp is true whenever it happens. The band is kept -- it is
 * still correct, still cheap, and still what a future occluder created
 * after the unit templates should join -- but it is no longer the only
 * thing holding the mask honest.
 *
 * `WebGLRenderer` must therefore be constructed with `stencil: true`
 * (`ThreeRenderer`'s own constructor). Without it there is no stencil
 * attachment, the test silently always passes, and the blue-blob artefact
 * above comes straight back -- so that option is part of this mechanism,
 * not renderer boilerplate.
 *
 * ## The depth bias, and the second artefact
 *
 * The stencil handles pixels a unit's own body covers. The outline lives
 * OUTSIDE that footprint by construction, so it is the one part of this
 * mechanism the mask can never protect: a couple of pixels of ground all
 * round every unit, including the ground in FRONT of its feet, which is
 * nearer than the unit and would satisfy `GreaterDepth` on its own. Without
 * a bias every unit standing in the open wears a ring.
 *
 * (For the fill, the same bias was sized against a different artefact --
 * the ground-clipped lower half of a BILLBOARD quad, which `ground-clip.ts`
 * clamps to the ground's own depth and which, before the footprint stamp
 * above, wrote no mask of its own. That case is now inside the footprint
 * and masked out for free; the ring around the feet replaced it, and wants
 * the same bias for the same reason.)
 *
 * `SILHOUETTE_DEPTH_BIAS_WORLD` pushes the silhouette's own depth toward the
 * camera by a fixed number of world units before the comparison, so only an
 * occluder at least that far in FRONT counts. Applied in view space
 * (`mvPosition.z += bias`, then re-project) rather than through
 * `polygonOffset`, because `polygonOffset` is expressed in
 * hardware-dependent depth-buffer units and this camera's far plane is
 * 20000 world units away -- a value tuned on one driver would mean
 * something else on another. View space is metric: the bias is a distance
 * in tiles, and reads as one.
 *
 * ## What this deliberately does NOT do
 *
 * It does not test what KIND of geometry is in front, beyond "not a unit".
 * A unit behind a rock ridge or a tree silhouettes exactly as one behind a
 * building does -- the player's question is "where is my squad", and the
 * answer is the same whatever is in the way. A unit behind ANOTHER UNIT
 * does not, because that is the same stencil bit that kills self-occlusion
 * and there is no way to have one without the other; a clump of infantry
 * therefore stays a clump rather than becoming a field of flat patches,
 * which is the better of the two outcomes anyway.
 *
 * It is three-only. `?renderer=pixi` has no depth buffer at all -- Pixi's
 * whole occlusion model is `zIndex` painting order, and there is no
 * "already lost the depth test" set for a silhouette to be drawn into. No
 * half-wiring is attempted there; see this task's report.
 *
 * ## Fog: the one rule this must never break
 *
 * A silhouette must never reveal a unit the player cannot already see.
 * Nothing in this module decides that, on purpose. `observed.ts` owns the
 * single fog gate every draw path in this backend shares, and the
 * silhouette is wired so that it is not merely *consistent* with the body's
 * visibility but *structurally incapable* of diverging from it:
 *
 *  - a mesh unit's silhouette is a CHILD of the unit's own `Object3D`
 *    subtree (`attachMeshSilhouette` below), so `WebGLRenderer`'s own
 *    traversal (`projectObject`, which prunes on `Object3D.visible`) cannot
 *    reach the silhouette without reaching the body;
 *  - a billboard unit's silhouette is a second `InstancedMesh` sharing the
 *    hull's own `instanceMatrix` object and `count` (`instances.ts`), so it
 *    draws the same instances or none.
 *
 * Both are asserted directly in `silhouette.test.ts` rather than argued
 * here.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE_W } from '../../project';
import { MESH_UNITS_PER_TILE } from './mesh-anim';
import { SILHOUETTE_RENDER_ORDER } from './render-order';

/**
 * How thick the outline is, in SCREEN pixels, at every zoom.
 *
 * Constant pixels rather than constant world units, and that is not a
 * refinement -- `main.ts` clamps `camera.zoom` to 0.35..2.5, a 7x range. A
 * width tuned in world units to read at zoom 1 would be a sub-pixel hairline
 * at 0.35 and a 6-pixel band at 2.5, which is the paint blob back again at
 * the zoom where the player is looking hardest.
 *
 * 2.5 was chosen against the bar this task was given: at zoom 1.0 an
 * occluded unit is about 30 px, and the outline has to still say "a vehicle
 * of that colour is there" at that size. Two things follow from the number
 * being fixed in pixels while the unit is not: a vehicle at 30 px reads as
 * an outlined shape, and a rifleman's 3-px-wide limbs fill in solid, which
 * is the correct degradation -- small features become marks, large ones
 * become outlines.
 */
export const SILHOUETTE_OUTLINE_PX = 2.5;

/**
 * Screen pixels per world unit at `camera.zoom === 1`, for this game's
 * dimetric camera.
 *
 * Derived, not measured: `camera.ts`'s `dimetricCamera` frames a half-width
 * of `vp.width / (TILE_W * zoom * SQRT2)` view-space units across `vp.width`
 * pixels, so pixels-per-view-unit is `TILE_W * zoom * SQRT2 / 2` -- and that
 * file's own "square pixels" derivation is what makes the same figure hold
 * on the vertical axis too. The camera is orthographic, so this is a
 * constant across the frame rather than a function of depth.
 */
export const SILHOUETTE_PX_PER_WORLD_UNIT = (TILE_W * Math.SQRT2) / 2;

/** The outline's width in WORLD units (one unit is one tile) at `zoom`. */
export function silhouetteOutlineWorldWidth(zoom: number): number {
  return SILHOUETTE_OUTLINE_PX / (SILHOUETTE_PX_PER_WORLD_UNIT * Math.max(zoom, 1e-3));
}

/**
 * The same width in the OBJECT space a mesh unit's silhouette geometry
 * actually lives in.
 *
 * The expansion is applied to `transformed` in the vertex shader -- before
 * skinning, so a bone carries the offset with it rather than the outline
 * standing in bind pose while the body walks. That puts it in the GLB's own
 * space, and every mesh unit and mesh vehicle root is scaled by
 * `MESH_SCALE` (= 1 / `MESH_UNITS_PER_TILE`, `mesh-anim.ts`) because Blender
 * builds at real metres and this renderer draws one world unit per tile. So
 * an offset authored in world units has to be multiplied BACK UP by the
 * same factor, or the outline comes out a third as thick as asked for --
 * which is exactly the class of silent, plausible-looking wrongness this
 * backend has paid for before.
 */
export function silhouetteOutlineObjectWidth(zoom: number): number {
  return silhouetteOutlineWorldWidth(zoom) * MESH_UNITS_PER_TILE;
}

/** Vertex attribute carrying the smoothed outward direction each silhouette
 *  vertex is pushed along. Named here because the geometry builder writes it
 *  and the material's own shader patch declares it. */
export const SILHOUETTE_EXPAND_ATTRIBUTE = 'aExpand';

/** `Material.userData` key holding a silhouette material's live outline-width
 *  uniform object, so `setSilhouetteOutlineZoom` can retune it per frame --
 *  a `MeshBasicMaterial` has no `.uniforms` of its own to reach through. */
export const SILHOUETTE_OUTLINE_UNIFORM_KEY = 'rl_silhouette_outline_width';

/**
 * How far toward the camera, in world units (one unit is one tile), a
 * silhouette's own depth is pushed before the `GreaterDepth` comparison --
 * see this file's top comment, "The depth bias, and the second artefact".
 *
 * Sized from the one thing the stencil cannot cover: the ground-clipped
 * lower half of a BILLBOARD unit's quad. `ground-clip.ts` clamps a sunk
 * vertex to the depth of the instance's own ground-contact point, and the
 * terrain drawn in FRONT of that point is nearer still, by at most the
 * quad's own half-height projected along `VIEW_DIRECTION` -- for the
 * tallest shipped sheet (TNK_HULL, `half` ~ 63 screen px, about a third of
 * a tile) that is well under one world unit. 0.75 clears it with margin
 * while staying small enough that a unit standing directly behind a
 * building's near wall still silhouettes.
 *
 * The cost, stated plainly rather than hidden: a unit whose occluder is
 * less than this far in front of it gets no silhouette. That is also the
 * case where almost none of it is hidden, so the cue it loses is the one
 * the player needs least.
 */
export const SILHOUETTE_DEPTH_BIAS_WORLD = 0.75;

/**
 * The stencil value a unit body writes where it WINS the depth test, and
 * that a silhouette refuses to draw over -- see this file's top comment,
 * "The stencil mask". 1 rather than 0 because the stencil buffer clears to
 * 0 every frame, so 0 has to keep meaning "nothing drew here".
 */
export const SILHOUETTE_STENCIL_REF = 1;

/**
 * Team-colour palette keys, indexed by `silhouetteSideIndex` -- NOT by raw
 * `side`. The silhouette's job is "whose unit is that", so it borrows the
 * three colours that already answer exactly that question everywhere else
 * in this game (`data/palette.json`'s `reserved.team.colors`).
 */
export const SILHOUETTE_COLOR_KEY_BY_SIDE = ['team.kedem', 'team.hostile', 'team.neutral'] as const;

/**
 * The literal each key above resolves to in `data/palette.json`, for the
 * `RendererOptions.resolveColor`-is-optional path every colour call site in
 * this backend already carries (`ThreeRenderer.overlayColor`). A fallback
 * that is not its own key's palette entry is an invented colour wearing a
 * palette key's name; `silhouette.test.ts` reads `data/palette.json` and
 * asserts these three against it rather than trusting this comment.
 */
export const SILHOUETTE_FALLBACK_HEX_BY_SIDE = ['#2F6FD9', '#D93A2B', '#E8C33A'] as const;

/**
 * `side` -> colour slot. The ONE place the sim's side numbering is mapped
 * onto the three team colours: 0 is the player's own (`entityFrame`'s own
 * `contactLevel` short-circuit uses the same test), 2 is civilians
 * (`mission.ts`'s own civilian side), and everything else -- including any
 * side the sim grows later -- is hostile. Shared by the palette-key lookup
 * below and by `instances.ts`'s per-instance `aSide` attribute, so the
 * billboard shader is a colour LOOKUP with no policy of its own.
 */
export function silhouetteSideIndex(side: number): number {
  if (side === 0) return 0;
  if (side === 2) return 2;
  return 1;
}

/** Palette key for `side`'s silhouette. */
export function silhouetteColorKey(side: number): string {
  return SILHOUETTE_COLOR_KEY_BY_SIDE[silhouetteSideIndex(side)];
}

/** The `data/palette.json` literal `silhouetteColorKey(side)` names, for the
 *  no-`resolveColor` fallback path. */
export function silhouetteFallbackHex(side: number): string {
  return SILHOUETTE_FALLBACK_HEX_BY_SIDE[silhouetteSideIndex(side)];
}

// ---------------------------------------------------------------------------
// THREE.* below this line. Everything above is plain arithmetic and policy,
// testable under `environment: 'node'` with no GPU -- the same split
// `instances.ts`, `structures.ts` and the `terrain/` builders already draw.
// ---------------------------------------------------------------------------

/**
 * The view-space depth push, as a GLSL fragment to be appended immediately
 * after a vertex shader has assigned `gl_Position = projectionMatrix *
 * mvPosition;` while `mvPosition` is still in scope. Shared verbatim between
 * the mesh path's `onBeforeCompile` patch and the billboard path's own
 * hand-written vertex shader (`instances.ts`), so the two cannot drift --
 * the same reason `ground-clip.ts` exists.
 *
 * `+=` moves toward the camera: this renderer's view space looks down -Z, so
 * a larger `z` is nearer.
 */
export const SILHOUETTE_DEPTH_BIAS_GLSL = /* glsl */ `
        mvPosition.z += ${SILHOUETTE_DEPTH_BIAS_WORLD.toFixed(4)};
        gl_Position = projectionMatrix * mvPosition;
`;

/**
 * The inverted-hull expansion, as a GLSL fragment appended immediately after
 * `#include <begin_vertex>` -- while `transformed` holds the un-skinned
 * object-space position and BEFORE `<skinning_vertex>` rewrites it.
 *
 * Before skinning on purpose: an offset added here is carried by whichever
 * bone owns the vertex, so a running rifleman's outline runs with him. An
 * offset applied after projection would have to re-derive the posed normal,
 * which `MeshBasicMaterial` does not compute at all.
 *
 * `aExpand` is a SMOOTHED normal (`smoothedOutwardNormals` below), never the
 * geometry's own: a hard-edged export splits every crease into vertices
 * carrying face normals, and pushing those apart tears the shell open at
 * exactly the silhouette edges the outline is made of.
 */
export const SILHOUETTE_OUTLINE_EXPAND_GLSL = /* glsl */ `
        transformed += aExpand * uOutlineWidth;
`;

/** The flags that ARE the mechanism -- see this file's top comment. Shared
 *  verbatim by both silhouette materials (the mesh path's below, and
 *  `instances.ts`'s billboard one) so neither can be built with half of it:
 *  the inverted depth comparison WITHOUT the stencil test is the
 *  blue-blob build that shipped for ten minutes and was measured. */
export const SILHOUETTE_MATERIAL_FLAGS = {
  transparent: true,
  depthTest: true,
  depthWrite: false,
  depthFunc: THREE.GreaterDepth,
  // The BILLBOARD path's facing. A billboard is one camera-facing quad, wound
  // to face this camera (`instances.ts`'s own winding proof), so `BackSide`
  // there draws nothing at all. The MESH path overrides this -- see
  // `SILHOUETTE_MESH_SIDE`, which is not a preference but the difference
  // between an outline and a handful of fragments.
  side: THREE.FrontSide,
  // `stencilWrite` is three.js's switch for `gl.enable(STENCIL_TEST)`, not
  // merely for writing -- every op below is `Keep`, so this material reads
  // the mask and never touches it.
  stencilWrite: true,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilRef: SILHOUETTE_STENCIL_REF,
  stencilFuncMask: 0xff,
  stencilFail: THREE.KeepStencilOp,
  stencilZFail: THREE.KeepStencilOp,
  stencilZPass: THREE.KeepStencilOp,
} as const;

/**
 * Marks a unit BODY material as one that masks out its own silhouette:
 * wherever this material is RASTERISED -- won the depth test or lost it --
 * it stamps `SILHOUETTE_STENCIL_REF`, and no silhouette draws there.
 *
 * Called from the two places that CREATE a silhouette -- `attachMeshSilhouette`
 * below, and `UnitInstancer`'s constructor -- rather than from the material
 * factories themselves. That keeps the pairing local: a body gets the mask
 * exactly when something is going to read it, and a material this module
 * never gave a silhouette to is left with the stencil test disabled
 * entirely (three.js's own default), costing nothing.
 *
 * Idempotent, and safe on a material shared by every unit of a type -- it
 * sets the same six values every time.
 */
export function markSilhouetteOccludee(material: THREE.Material | THREE.Material[]): void {
  const all = Array.isArray(material) ? material : [material];
  for (const m of all) {
    m.stencilWrite = true;
    m.stencilFunc = THREE.AlwaysStencilFunc;
    m.stencilRef = SILHOUETTE_STENCIL_REF;
    m.stencilWriteMask = 0xff;
    m.stencilFail = THREE.KeepStencilOp;
    // Won or lost, the mask is stamped: the bit means "this unit's own
    // footprint covers this pixel", and the outline lives strictly OUTSIDE
    // that footprint. `stencilZFail: Keep` is the FILL's setting -- see this
    // file's top comment for why the two readings cannot coexist, and why a
    // footprint stamp is also what makes the mask independent of draw
    // order. (`stencilFail` above never fires: `stencilFunc` is `Always`.)
    m.stencilZFail = THREE.ReplaceStencilOp;
    m.stencilZPass = THREE.ReplaceStencilOp;
    m.needsUpdate = true;
  }
}

/**
 * The material a mesh unit's (or mesh vehicle's) silhouette draws through:
 * one flat colour, no lighting, no vertex colours, no texture.
 *
 * A plain `MeshBasicMaterial` rather than a hand-written `ShaderMaterial`
 * for one reason that matters: three.js injects its own skinning chunks into
 * any built-in material used by a `SkinnedMesh`, so an infantry silhouette
 * deforms with the pose for free. A custom `ShaderMaterial` would have to
 * reimplement skinning, and a silhouette frozen in bind pose while its own
 * body walks is worse than no silhouette.
 *
 * ONE material per team colour, shared across every unit of that side --
 * three materials for the whole scene. `mesh-death.ts`'s fade would
 * otherwise clone one per dying unit and index `uniforms.uOpacity` on it,
 * which a `MeshBasicMaterial` does not have; `ThreeRenderer` detaches
 * silhouettes before handing an entity to the death sequence for exactly
 * that reason.
 */
/**
 * The mesh path's facing, and it is measured rather than chosen.
 *
 * `FrontSide` -- the obvious, more depth-conservative option, and what this
 * shipped with for one browser round -- produces an outline in FRAGMENTS.
 * The reason is that the ring lies just outside the body's own silhouette,
 * and a front face only moves outward IN SCREEN SPACE by the amount its
 * normal is perpendicular to the view. The triangles that satisfy that are
 * exactly the grazing ones at the silhouette edge -- and half of those face
 * away and are culled. The ring is therefore covered patchily, and on a
 * kit-built vehicle (many separate boxes) what survives is a scatter of
 * short strokes that reads as noise. Photographed side by side at one
 * camera on `beit_sahwan_outskirts`: `FrontSide` gave broken squiggles,
 * `BackSide` a single continuous contour of the whole tank.
 *
 * `BackSide` is the standard inverted-hull answer for that reason: the far
 * shell covers the ring completely. The depth it brings with it is not the
 * model's deep far side, which would over-trigger: just outside the original
 * silhouette the near and far surfaces MEET, so a ring fragment carries
 * roughly the silhouette-edge depth. The genuinely deep interior is inside
 * the footprint, where the stencil discards it before depth matters.
 */
export const SILHOUETTE_MESH_SIDE = THREE.BackSide;

export function createMeshSilhouetteMaterial(color: string): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    ...SILHOUETTE_MATERIAL_FLAGS,
    side: SILHOUETTE_MESH_SIDE,
  });
  // ONE uniform object, held here and handed to every program compiled from
  // this material, so `setSilhouetteOutlineZoom` can retune the width by
  // writing `.value` once. `MeshBasicMaterial` has no `.uniforms` field of
  // its own -- three.js keeps the compiled `shader.uniforms` internally --
  // so the shared object has to be captured before `onBeforeCompile` runs
  // and parked somewhere reachable, which is what `userData` is for.
  const outlineWidth = { value: silhouetteOutlineObjectWidth(1) };
  (material.userData as Record<string, unknown>)[SILHOUETTE_OUTLINE_UNIFORM_KEY] = outlineWidth;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineWidth = outlineWidth;
    // three.js's own generated prefix defines `attribute` as `in` under
    // GLSL ES 3.00, so this one declaration is correct on both targets --
    // the same reason `instances.ts` declares `aLayer`/`aAlpha`/`aSide`
    // plainly in its hand-written `ShaderMaterial`.
    shader.vertexShader =
      `attribute vec3 ${SILHOUETTE_EXPAND_ATTRIBUTE};\nuniform float uOutlineWidth;\n` +
      shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>${SILHOUETTE_OUTLINE_EXPAND_GLSL}`
        )
        .replace('#include <project_vertex>', `#include <project_vertex>${SILHOUETTE_DEPTH_BIAS_GLSL}`);
  };
  // Two materials with identical source but different `onBeforeCompile`
  // patches share a program cache entry unless their cache keys differ.
  // These three all patch identically, so one key is correct -- but it must
  // differ from an UNPATCHED MeshBasicMaterial's, or three.js would hand a
  // silhouette the unbiased program compiled for some other basic material.
  material.customProgramCacheKey = () => `rl-silhouette-outline-${SILHOUETTE_DEPTH_BIAS_WORLD}`;
  return material;
}

/**
 * Retunes every mesh silhouette material's outline width for the camera's
 * current zoom -- one `.value` write per material, three materials for the
 * whole scene, called once per frame from `ThreeRenderer.frame`.
 *
 * Deliberately a write on the SHARED uniform object rather than anything
 * per-unit: the outline's thickness is a property of the camera, not of the
 * unit, and a silhouette still costs zero per-frame CPU per entity.
 */
export function setSilhouetteOutlineZoom(
  materials: readonly THREE.Material[],
  zoom: number
): void {
  const width = silhouetteOutlineObjectWidth(zoom);
  for (const material of materials) {
    const uniform = (material.userData as Record<string, unknown>)[
      SILHOUETTE_OUTLINE_UNIFORM_KEY
    ] as { value: number } | undefined;
    if (uniform) uniform.value = width;
  }
}

/**
 * The merged silhouette geometry for one group of body meshes, cached by the
 * group's FIRST geometry -- which is a template-owned object shared by every
 * clone of that unit type (`mesh-unit.ts`'s own `MeshUnitTemplate.geometries`
 * doc comment), so the merge runs once per type and not once per unit.
 *
 * Why merge at all, measured rather than assumed: a shipped infantry GLB is
 * five meshes (boot, face, keffiyeh, uniform, webbing -- one per material
 * role) and a vehicle is four (two hull, two turret). A silhouette per body
 * mesh is five extra draw calls per rifleman, which on `marj_perimeter` with
 * 16 units on screen measured +83 draw calls against a unit cost of ~80 --
 * a doubling of exactly the submission cost this project has measured as
 * its bottleneck. A silhouette has ONE flat colour, so the per-role split
 * buys it nothing: merging takes that to one draw per group.
 *
 * A `WeakMap`, so a template that is disposed and dropped takes its merged
 * geometry with it -- nothing here holds a template alive.
 */
const mergedGeometryCache = new WeakMap<
  THREE.BufferGeometry,
  { sources: readonly THREE.BufferGeometry[]; merged: THREE.BufferGeometry }
>();

/**
 * Quantised position key, for welding vertices that a hard-edged export
 * split apart. 1e-4 of a GLB metre is 0.1 mm -- far below anything these
 * models resolve, far above float noise. `Math.round(-0.00004 * 1e4)` is
 * `-0`, and `String(-0)` is `"0"`, so a coordinate either side of zero
 * cannot land in two buckets.
 */
function weldKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
}

/**
 * The direction each vertex is pushed along to build the inverted hull: the
 * area-weighted average of the face normals of every triangle touching that
 * POSITION, not that vertex index.
 *
 * Welding by position is the whole point. A GLB from `kit.py` is hard-edged:
 * a hull corner is three vertices at one point carrying three different face
 * normals. Expanding each along its own normal pulls the three faces apart
 * and opens a wedge at every crease -- and the creases are exactly where a
 * boxy vehicle's outline is. Averaging over the welded point moves the
 * corner outward as one corner.
 *
 * Computed from positions and winding alone, never from the source `normal`
 * attribute: the merge below drops `normal` (a silhouette samples no texture
 * and is unlit, and a shipped infantry GLB's `webbing` role has no `uv` at
 * all, so trimming the attribute set is what makes the merge legal in the
 * first place). Recomputing costs one pass per TEMPLATE and removes a
 * dependency on whether every role in every GLB happens to carry normals.
 *
 * Cross product of `(b - a) x (c - a)`: for three.js's front-facing
 * counter-clockwise winding that points OUT of the surface, and its length
 * is twice the triangle's area, which is the weighting we want anyway.
 */
export function smoothedOutwardNormals(geometry: THREE.BufferGeometry): Float32Array {
  const position = geometry.getAttribute('position');
  const count = position ? position.count : 0;
  const out = new Float32Array(count * 3);
  if (!position || count === 0) return out;

  const slotOf = new Int32Array(count);
  const slots = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = weldKey(position.getX(i), position.getY(i), position.getZ(i));
    let slot = slots.get(key);
    if (slot === undefined) {
      slot = slots.size;
      slots.set(key, slot);
    }
    slotOf[i] = slot;
  }
  const acc = new Float32Array(slots.size * 3);

  const index = geometry.index;
  const triangles = index ? index.count : count;
  for (let t = 0; t + 2 < triangles; t += 3) {
    const i0 = index ? index.getX(t) : t;
    const i1 = index ? index.getX(t + 1) : t + 1;
    const i2 = index ? index.getX(t + 2) : t + 2;
    const ax = position.getX(i0);
    const ay = position.getY(i0);
    const az = position.getZ(i0);
    const ux = position.getX(i1) - ax;
    const uy = position.getY(i1) - ay;
    const uz = position.getZ(i1) - az;
    const vx = position.getX(i2) - ax;
    const vy = position.getY(i2) - ay;
    const vz = position.getZ(i2) - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [i0, i1, i2]) {
      const s = slotOf[i] * 3;
      acc[s] += nx;
      acc[s + 1] += ny;
      acc[s + 2] += nz;
    }
  }

  for (let i = 0; i < count; i++) {
    const s = slotOf[i] * 3;
    const nx = acc[s];
    const ny = acc[s + 1];
    const nz = acc[s + 2];
    const len = Math.hypot(nx, ny, nz);
    // A vertex touching no triangle, or one whose faces cancel exactly,
    // simply does not move. Better a locally un-expanded vertex than a
    // NaN, which would take the whole draw call's geometry with it.
    if (len === 0) continue;
    out[i * 3] = nx / len;
    out[i * 3 + 1] = ny / len;
    out[i * 3 + 2] = nz / len;
  }
  return out;
}

/** The attributes a silhouette actually reads. It samples no texture and is
 *  unlit, so `uv` and `normal` are dropped -- which is also what makes the
 *  merge possible at all: on a shipped infantry GLB, `webbing` carries no
 *  `uv` while its four siblings do, and `mergeGeometries` refuses a set that
 *  does not match. */
function silhouetteAttributes(mesh: THREE.Mesh): string[] {
  return (mesh as THREE.SkinnedMesh).isSkinnedMesh
    ? ['position', 'skinIndex', 'skinWeight']
    : ['position'];
}

/**
 * One group of body meshes that can share a single silhouette: same parent
 * (so one world transform), same rigid/skinned kind, and -- for skinned --
 * the same `Skeleton` bone ORDER and bind matrix, since `skinIndex` is an
 * index into that array and merging two meshes whose bone orders differ
 * would deform one of them by the other's skeleton.
 *
 * Checked rather than assumed: a shipped `SkeletonUtils.clone` gives each
 * `SkinnedMesh` its own `Skeleton` OBJECT, so object identity is the wrong
 * test; the five infantry meshes hold five distinct `Skeleton`s over the
 * same 72 bones in the same order, which is what makes them mergeable.
 * Anything that fails these tests falls back to its own silhouette -- a
 * correct picture at a higher draw cost, never a wrong one.
 */
function canShareSilhouette(a: THREE.Mesh, b: THREE.Mesh): boolean {
  if (a.parent !== b.parent) return false;
  const sa = a as THREE.SkinnedMesh;
  const sb = b as THREE.SkinnedMesh;
  if (Boolean(sa.isSkinnedMesh) !== Boolean(sb.isSkinnedMesh)) return false;
  if (sa.isSkinnedMesh) {
    // A skinned geometry is authored in bind space; baking a local matrix
    // into it (which the rigid path below does) would be wrong, so a
    // non-identity local transform disqualifies the merge instead.
    if (!isIdentityTransform(a) || !isIdentityTransform(b)) return false;
    if (!sa.bindMatrix.equals(sb.bindMatrix)) return false;
    const ba = sa.skeleton.bones;
    const bb = sb.skeleton.bones;
    if (ba.length !== bb.length) return false;
    for (let i = 0; i < ba.length; i++) if (ba[i] !== bb[i]) return false;
  }
  const attrA = silhouetteAttributes(a);
  const attrB = silhouetteAttributes(b);
  if (attrA.length !== attrB.length) return false;
  for (const name of attrA) {
    if (!a.geometry.getAttribute(name) || !b.geometry.getAttribute(name)) return false;
  }
  return Boolean(a.geometry.index) === Boolean(b.geometry.index);
}

function isIdentityTransform(o: THREE.Object3D): boolean {
  return (
    o.position.lengthSq() === 0 &&
    Math.abs(o.quaternion.w - 1) < 1e-9 &&
    o.scale.x === 1 &&
    o.scale.y === 1 &&
    o.scale.z === 1
  );
}

/**
 * The geometry one group's silhouette draws: the group's shape, trimmed to
 * the attributes an outline reads, plus the `aExpand` direction that turns
 * it into an inverted hull.
 *
 * A single-mesh group still SHARES the body's own attribute OBJECTS -- the
 * wrapper `BufferGeometry` around them costs no vertex memory beyond
 * `aExpand` itself, and no copy of the positions. It cannot simply BE the
 * body's geometry any more, because `aExpand` would then be uploaded for
 * every body draw too, and the body's own material would be carrying an
 * attribute it never reads. A group of two or more is merged, exactly as
 * before.
 *
 * Rigid sources have their own local matrix baked in, so the merged mesh can
 * sit at identity under the shared parent -- that is what lets a turret's two
 * meshes become one silhouette while still rotating with `turretPivot`.
 * Skinned sources are already required to be at identity (`canShareSilhouette`).
 * `aExpand` is computed AFTER that bake, from final positions, so the
 * expansion directions are already in the space the shell is drawn in.
 *
 * Cached on the group's FIRST source geometry -- a template-owned object
 * every clone of that unit type shares -- so a type pays this once, not once
 * per spawned unit. Returns `null` if a merge fails, and the caller falls
 * back to one silhouette per mesh.
 */
function silhouetteGeometryFor(group: readonly THREE.Mesh[]): THREE.BufferGeometry | null {
  const sources = group.map((m) => m.geometry);
  const cached = mergedGeometryCache.get(sources[0]);
  if (cached && cached.sources.length === sources.length && cached.sources.every((g, i) => g === sources[i])) {
    return cached.merged;
  }
  const names = silhouetteAttributes(group[0]);
  let shell: THREE.BufferGeometry | null;
  if (group.length === 1) {
    shell = new THREE.BufferGeometry();
    for (const name of names) {
      const attr = sources[0].getAttribute(name);
      // Shared, not cloned: one buffer on the GPU, read by two draw calls.
      if (attr) shell.setAttribute(name, attr);
    }
    if (sources[0].index) shell.setIndex(sources[0].index);
  } else {
    const cleaned: THREE.BufferGeometry[] = [];
    for (const mesh of group) {
      const g = new THREE.BufferGeometry();
      for (const name of names) {
        const attr = mesh.geometry.getAttribute(name);
        if (!attr) return null;
        g.setAttribute(name, attr.clone());
      }
      const index = mesh.geometry.index;
      if (index) g.setIndex(index.clone());
      if (!(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        mesh.updateMatrix();
        g.applyMatrix4(mesh.matrix);
      }
      cleaned.push(g);
    }
    shell = mergeGeometries(cleaned, false);
    for (const g of cleaned) g.dispose();
  }
  if (!shell) return null;
  shell.setAttribute(
    SILHOUETTE_EXPAND_ATTRIBUTE,
    new THREE.BufferAttribute(smoothedOutwardNormals(shell), 3)
  );
  mergedGeometryCache.set(sources[0], { sources, merged: shell });
  return shell;
}

/** Marker every silhouette object carries, so a second `attachMeshSilhouette`
 *  cannot silhouette a silhouette and `detachMeshSilhouette` knows what it
 *  owns. */
interface SilhouetteUserData {
  /** Set on the silhouette itself. */
  rl_silhouette?: true;
  /** The name of the body mesh a silhouette was made from. */
  rl_silhouette_of?: string;
  /** Set on a BODY mesh that already has one, so a second `attach` on the
   *  same subtree cannot double it up. Cleared by `detach`. */
  rl_has_silhouette?: true;
}

/** True for an object this module created. */
export function isSilhouette(o: THREE.Object3D): boolean {
  return (o.userData as SilhouetteUserData).rl_silhouette === true;
}

/**
 * Adds a flat-coloured twin of every mesh under `root`, as a SIBLING of that
 * mesh (same parent, same local transform), sharing its geometry and -- for
 * a `SkinnedMesh` -- its skeleton and bind matrix.
 *
 * A sibling inside the unit's own subtree, rather than an object added to
 * the scene, is the whole fog guarantee: `WebGLRenderer.projectObject`
 * prunes on `Object3D.visible`, so a silhouette cannot be reached without
 * the body being reached. It also means the silhouette needs no per-frame
 * update at all -- position, yaw, hull pitch, turret yaw and the animated
 * pose all arrive through the ancestors and the shared skeleton that the
 * body path already writes.
 *
 * Vertex data is SHARED wherever it can be (`silhouetteGeometryFor`): one
 * extra draw call per GROUP, no copy of the positions, and zero extra CPU
 * per frame. The one thing a silhouette adds is its own `aExpand`
 * attribute -- three floats per vertex, built once per template.
 *
 * Returns the objects created, in traversal order.
 */
export function attachMeshSilhouette(
  root: THREE.Object3D,
  material: THREE.Material
): THREE.Mesh[] {
  // Collect first, add after: adding a child mid-`traverse` would have the
  // traversal walk into the silhouettes it is still creating.
  const sources: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.parent) return;
    const data = mesh.userData as SilhouetteUserData;
    // Neither a silhouette nor a body that already has one: a second call on
    // the same subtree (a re-attach after a template reload, say) must not
    // double the draw calls, and a silhouette of a silhouette is nonsense.
    if (data.rl_silhouette === true || data.rl_has_silhouette === true) return;
    sources.push(mesh);
  });

  // One silhouette per GROUP of body meshes that can share it, not one per
  // body mesh -- see `mergedGeometryCache`'s own doc comment for the measured
  // draw-call cost that makes this worth doing. Greedy grouping over the
  // traversal order, which is stable for a given template.
  const groups: THREE.Mesh[][] = [];
  for (const mesh of sources) {
    const existing = groups.find((g) => canShareSilhouette(g[0], mesh));
    if (existing) existing.push(mesh);
    else groups.push([mesh]);
  }

  const created: THREE.Mesh[] = [];
  for (const group of groups) {
    const merged = silhouetteGeometryFor(group);
    // A merge that could not be built falls back to one silhouette per mesh:
    // more draw calls, never a wrong shape.
    const subgroups = merged ? [group] : group.map((m) => [m]);
    for (const sub of subgroups) {
      // Never `sub[0].geometry` directly, even in the fallback: a silhouette
      // draws through the OUTLINE material, which reads `aExpand`, and a
      // body geometry does not carry one. An un-expanded shell would draw a
      // solid fill again -- the exact defect this replaced, reappearing only
      // for whichever unit type failed to merge.
      const geometry = (merged && sub === group ? merged : silhouetteGeometryFor(sub)) ?? sub[0].geometry;
      const head = sub[0];
      const skinnedSource = head as THREE.SkinnedMesh;
      let clone: THREE.Mesh;
      if (skinnedSource.isSkinnedMesh) {
        const skinnedClone = new THREE.SkinnedMesh(geometry, material);
        // Same skeleton object, same bind matrix: the clone deforms with the
        // body's own pose rather than standing in bind pose, and no second
        // `AnimationMixer` or bone hierarchy is created.
        skinnedClone.bindMode = skinnedSource.bindMode;
        skinnedClone.bind(skinnedSource.skeleton, skinnedSource.bindMatrix);
        clone = skinnedClone;
      } else {
        clone = new THREE.Mesh(geometry, material);
      }
      clone.name = `${head.name}__silhouette`;
      if (sub.length > 1) {
        // A merged rigid group had each source's local matrix baked into the
        // geometry (`silhouetteGeometryFor`), so the merged mesh sits at
        // identity under the shared parent; a merged skinned group was
        // required to be at identity already.
        clone.matrixAutoUpdate = head.matrixAutoUpdate;
      } else {
        clone.position.copy(head.position);
        clone.quaternion.copy(head.quaternion);
        clone.scale.copy(head.scale);
        clone.matrixAutoUpdate = head.matrixAutoUpdate;
      }
      clone.frustumCulled = head.frustumCulled;
      clone.renderOrder = SILHOUETTE_RENDER_ORDER;
      const data = clone.userData as SilhouetteUserData;
      data.rl_silhouette = true;
      data.rl_silhouette_of = head.name;
      head.parent?.add(clone);
      created.push(clone);
    }
    for (const mesh of group) {
      // Every body mesh in the group has to stamp the mask its shared
      // silhouette reads -- see `markSilhouetteOccludee`. Done here, at the
      // one place that pairs the two, rather than in the material factories.
      markSilhouetteOccludee(mesh.material);
      (mesh.userData as SilhouetteUserData).rl_has_silhouette = true;
    }
  }
  return created;
}

/**
 * Removes every silhouette under `root`. Called before an entity is handed
 * to `mesh-death.ts`: that module clones each mesh's material to fade it and
 * then writes `uniforms.uOpacity` on the clone, which a
 * `MeshBasicMaterial` does not have -- and a wreck has nothing to keep
 * track of anyway.
 *
 * The shared geometry and the shared material are deliberately NOT disposed:
 * both are owned by the template and by `ThreeRenderer` respectively, and
 * are still in use by every other unit.
 */
export function detachMeshSilhouette(root: THREE.Object3D): void {
  const doomed: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (isSilhouette(o)) doomed.push(o);
    else delete (o.userData as SilhouetteUserData).rl_has_silhouette;
  });
  for (const o of doomed) o.parent?.remove(o);
}
