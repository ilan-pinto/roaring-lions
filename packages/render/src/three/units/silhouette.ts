/**
 * Occlusion silhouettes: a flat, team-coloured redraw of a unit's own shape,
 * visible only through whatever is standing in front of it.
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
 * The fix is a one-bit stencil mask, and it is the only mechanism here that
 * can tell "hidden by something else" from "hidden by my own far side":
 *
 *  - every unit BODY material writes `SILHOUETTE_STENCIL_REF` wherever its
 *    fragment actually WINS the depth test (`markSilhouetteOccludee`,
 *    `stencilZPass: Replace`, everything else `Keep` -- a fragment that lost
 *    writes nothing);
 *  - every silhouette material draws only where the stencil is NOT that
 *    value.
 *
 * So a pixel where any unit is the visible surface is masked out, which is
 * exactly the set of pixels a unit's own back occupies. A pixel where a
 * BUILDING is the visible surface was never written, so the silhouette
 * draws there. No CPU occlusion test, no per-unit state, one extra bit per
 * pixel.
 *
 * `WebGLRenderer` must therefore be constructed with `stencil: true`
 * (`ThreeRenderer`'s own constructor). Without it there is no stencil
 * attachment, the test silently always passes, and the blue-blob artefact
 * above comes straight back -- so that option is part of this mechanism,
 * not renderer boilerplate.
 *
 * ## The depth bias, and the second artefact
 *
 * The stencil handles geometry a unit actually drew. It does NOT handle
 * ground clipping on the billboard path: a centred billboard quad straddles
 * true ground by half its height (`instances.ts`'s own "Anchored at the
 * centre" section), and `ground-clip.ts` clamps that sunk lower half to the
 * ground's own depth so terrain hides it. Terrain writes no stencil, and a
 * clamped-but-still-losing fragment writes none either -- so without a
 * bias the silhouette would paint a flat smear at every billboard unit's
 * feet.
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
import { SILHOUETTE_RENDER_ORDER } from './render-order';

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
 * wherever this material's fragment wins the depth test, it stamps
 * `SILHOUETTE_STENCIL_REF`, and no silhouette draws there.
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
    // Only a fragment that actually WON writes the mask. A unit's own
    // hidden far side loses, writes nothing, and so does not mask itself
    // out -- which is what makes the silhouette appear on it.
    m.stencilZFail = THREE.KeepStencilOp;
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
export function createMeshSilhouetteMaterial(color: string): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    ...SILHOUETTE_MATERIAL_FLAGS,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>${SILHOUETTE_DEPTH_BIAS_GLSL}`
    );
  };
  // Two materials with identical source but different `onBeforeCompile`
  // patches share a program cache entry unless their cache keys differ.
  // These three all patch identically, so one key is correct -- but it must
  // differ from an UNPATCHED MeshBasicMaterial's, or three.js would hand a
  // silhouette the unbiased program compiled for some other basic material.
  material.customProgramCacheKey = () => `rl-silhouette-${SILHOUETTE_DEPTH_BIAS_WORLD}`;
  return material;
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
 * Geometry is SHARED, never cloned: one extra draw call per mesh, and zero
 * extra vertex memory or CPU per frame.
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

  const created: THREE.Mesh[] = [];
  for (const mesh of sources) {
    const skinnedSource = mesh as THREE.SkinnedMesh;
    let clone: THREE.Mesh;
    if (skinnedSource.isSkinnedMesh) {
      const skinnedClone = new THREE.SkinnedMesh(mesh.geometry, material);
      // Same skeleton object, same bind matrix: the clone deforms with the
      // body's own pose rather than standing in bind pose, and no second
      // `AnimationMixer` or bone hierarchy is created.
      skinnedClone.bindMode = skinnedSource.bindMode;
      skinnedClone.bind(skinnedSource.skeleton, skinnedSource.bindMatrix);
      clone = skinnedClone;
    } else {
      clone = new THREE.Mesh(mesh.geometry, material);
    }
    // The body has to stamp the mask this silhouette reads -- see
    // `markSilhouetteOccludee`. Done here, at the one place that pairs the
    // two, rather than in the material factories.
    markSilhouetteOccludee(mesh.material);
    clone.name = `${mesh.name}__silhouette`;
    clone.position.copy(mesh.position);
    clone.quaternion.copy(mesh.quaternion);
    clone.scale.copy(mesh.scale);
    clone.matrixAutoUpdate = mesh.matrixAutoUpdate;
    clone.frustumCulled = mesh.frustumCulled;
    clone.renderOrder = SILHOUETTE_RENDER_ORDER;
    const data = clone.userData as SilhouetteUserData;
    data.rl_silhouette = true;
    data.rl_silhouette_of = mesh.name;
    (mesh.userData as SilhouetteUserData).rl_has_silhouette = true;
    mesh.parent?.add(clone);
    created.push(clone);
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
