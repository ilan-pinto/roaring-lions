/**
 * The occlusion silhouette, and above all the ONE thing it must never do:
 * reveal a unit fog is hiding.
 *
 * Every assertion below was verified by hand by breaking the code it guards
 * and confirming the SPECIFIC test named goes red, then reverting -- this
 * project's own standard after twenty-three tests were found that passed
 * while checking nothing. The break used for each is named in that test's
 * own comment.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import paletteJson from '../../../../../data/palette.json';
import { unitIsObserved } from './observed';
import {
  SILHOUETTE_COLOR_KEY_BY_SIDE,
  SILHOUETTE_FALLBACK_HEX_BY_SIDE,
  SILHOUETTE_EXPAND_ATTRIBUTE,
  SILHOUETTE_MATERIAL_FLAGS,
  SILHOUETTE_OUTLINE_PX,
  SILHOUETTE_OUTLINE_UNIFORM_KEY,
  SILHOUETTE_PX_PER_WORLD_UNIT,
  silhouetteColorKey,
  silhouetteFallbackHex,
  silhouetteOutlineObjectWidth,
  silhouetteOutlineWorldWidth,
  smoothedOutwardNormals,
  createMeshSilhouetteMaterial,
  attachMeshSilhouette,
  detachMeshSilhouette,
  isSilhouette,
  markSilhouetteOccludee,
  setSilhouetteOutlineZoom,
  SILHOUETTE_STENCIL_REF,
} from './silhouette';
import { MESH_SCALE } from './mesh-anim';
import { SILHOUETTE_RENDER_ORDER } from './render-order';

/** One triangle, enough shape for `smoothedOutwardNormals` to have something
 *  to average and for the shared-attribute assertions to be about a real
 *  buffer rather than an empty one. */
function triangleGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
  );
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  return g;
}

/** A two-mesh rig standing in for a loaded GLB unit: one plain `Mesh` and
 *  one `SkinnedMesh`, both under a root the renderer toggles. */
function meshUnitRig(): { root: THREE.Object3D; body: THREE.Mesh; skinned: THREE.SkinnedMesh } {
  const root = new THREE.Object3D();
  const body = new THREE.Mesh(triangleGeometry(), new THREE.MeshBasicMaterial());
  body.name = 'body';
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  const skinnedGeometry = triangleGeometry();
  skinnedGeometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(12), 4));
  skinnedGeometry.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(12), 4));
  const skinned = new THREE.SkinnedMesh(skinnedGeometry, new THREE.MeshBasicMaterial());
  skinned.name = 'figure';
  skinned.add(bone);
  skinned.bind(skeleton);
  root.add(body);
  root.add(skinned);
  return { root, body, skinned };
}

/** Everything three.js's own render traversal would reach this frame --
 *  `WebGLRenderer.projectObject` walks exactly this, skipping any subtree
 *  whose root has `visible === false`. */
function drawnObjects(scene: THREE.Object3D): THREE.Object3D[] {
  const seen: THREE.Object3D[] = [];
  scene.traverseVisible((o) => seen.push(o));
  return seen;
}

describe('the fog gate', () => {
  it('observes the player’s own units unconditionally and everyone else only through fog', () => {
    // Break to confirm red: change `side === 0 ||` to `true ||` in
    // observed.ts -- the second expectation below fails.
    expect(unitIsObserved(0, 4, 4, () => false)).toBe(true);
    expect(unitIsObserved(1, 4, 4, () => false)).toBe(false);
    expect(unitIsObserved(1, 4, 4, () => true)).toBe(true);
  });

  it('a fogged hostile gets NO silhouette -- the silhouette rides the body’s own visibility, it does not re-derive it', () => {
    // THE trap test. Break to confirm red, two independent ways:
    //   1. `attachMeshSilhouette` adding its meshes to `scene` (or to any
    //      object other than the body mesh's own parent) instead of to the
    //      unit's own subtree -- the silhouette survives root.visible = false.
    //   2. `unitIsObserved` returning true for a fogged hostile.
    const scene = new THREE.Scene();
    const { root } = meshUnitRig();
    scene.add(root);
    const silhouettes = attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    expect(silhouettes.length).toBe(2);

    // The hostile is inside a building's footprint, unobserved: fog says no.
    root.visible = unitIsObserved(1, 12, 9, () => false);
    const hidden = drawnObjects(scene);
    for (const s of silhouettes) expect(hidden).not.toContain(s);
    expect(hidden).not.toContain(root);

    // Same unit, same call site, once the player observes that tile.
    root.visible = unitIsObserved(1, 12, 9, () => true);
    const shown = drawnObjects(scene);
    for (const s of silhouettes) expect(shown).toContain(s);
  });
});

describe('attachMeshSilhouette', () => {
  it('shares each mesh’s vertex buffers rather than copying them, and rides its parent’s transform', () => {
    // A silhouette needs its OWN BufferGeometry now -- it carries `aExpand`,
    // which the body's material never reads and should not be made to
    // upload. What must not be copied is the vertex data itself: the
    // position (and skin) attribute OBJECTS are the body's own, so this is
    // still one buffer on the GPU read by two draw calls.
    // Break to confirm red: `attr.clone()` instead of `attr` in
    // silhouetteGeometryFor's single-mesh branch -- this test fails with
    // `expected BufferAttribute to be BufferAttribute`.
    const { root, body, skinned } = meshUnitRig();
    const silhouettes = attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    const byName = new Map(silhouettes.map((s) => [s.userData.rl_silhouette_of, s]));
    for (const [name, source] of [
      ['body', body],
      ['figure', skinned],
    ] as const) {
      const shell = byName.get(name);
      expect(shell?.geometry).not.toBe(source.geometry);
      expect(shell?.geometry.getAttribute('position')).toBe(source.geometry.getAttribute('position'));
      expect(shell?.geometry.index).toBe(source.geometry.index);
    }
    expect(byName.get('figure')?.geometry.getAttribute('skinIndex')).toBe(
      skinned.geometry.getAttribute('skinIndex')
    );
    expect(byName.get('body')?.parent).toBe(body.parent);
    expect(byName.get('figure')?.parent).toBe(skinned.parent);
  });

  it('gives every silhouette an expansion direction -- an un-expanded shell is the solid FILL again', () => {
    // The outline is an inverted hull: no `aExpand` means no expansion, and
    // a silhouette that covers exactly the body's own footprint is masked
    // out by the stencil down to nothing -- or, before the footprint stamp,
    // was the paint blob this replaced. The body geometry must NOT gain the
    // attribute: it would be uploaded for every body draw and read by
    // nothing.
    // Break to confirm red: drop the setAttribute call at the end of
    // silhouetteGeometryFor -- `expected undefined to be defined`.
    const { root, body } = meshUnitRig();
    const silhouettes = attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    for (const s of silhouettes) {
      const expand = s.geometry.getAttribute(SILHOUETTE_EXPAND_ATTRIBUTE);
      expect(expand).toBeDefined();
      expect(expand.count).toBe(s.geometry.getAttribute('position').count);
      // Unit length, or the outline would be thicker in some places than
      // the pixel width asked for.
      for (let i = 0; i < expand.count; i++) {
        expect(Math.hypot(expand.getX(i), expand.getY(i), expand.getZ(i))).toBeCloseTo(1, 6);
      }
    }
    expect(body.geometry.getAttribute(SILHOUETTE_EXPAND_ATTRIBUTE)).toBeUndefined();
  });

  it('binds a skinned silhouette to the ORIGINAL skeleton, so it deforms with the pose instead of standing in bind pose', () => {
    // Break to confirm red: drop the `.bind(mesh.skeleton, mesh.bindMatrix)`
    // call, or pass `new THREE.Skeleton([])`.
    const { root, skinned } = meshUnitRig();
    const silhouettes = attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    const clone = silhouettes.find((s) => s.userData.rl_silhouette_of === 'figure');
    expect(clone).toBeInstanceOf(THREE.SkinnedMesh);
    expect((clone as THREE.SkinnedMesh).skeleton).toBe(skinned.skeleton);
  });

  it('never silhouettes a silhouette -- a second attach on the same root is a no-op', () => {
    // Break to confirm red: drop the `isSilhouette` skip in the collect pass.
    const { root } = meshUnitRig();
    attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    const second = attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    expect(second).toEqual([]);
    let count = 0;
    root.traverse((o) => {
      if (isSilhouette(o)) count++;
    });
    expect(count).toBe(2);
  });

  it('detach removes every silhouette and leaves the body meshes alone', () => {
    // Break to confirm red: have detachMeshSilhouette remove nothing, or
    // remove the body meshes too.
    const { root, body, skinned } = meshUnitRig();
    attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    detachMeshSilhouette(root);
    const remaining: THREE.Object3D[] = [];
    root.traverse((o) => remaining.push(o));
    expect(remaining.filter(isSilhouette)).toEqual([]);
    expect(remaining).toContain(body);
    expect(remaining).toContain(skinned);
  });
});

describe('one silhouette per shareable group, not per body mesh', () => {
  /** Two skinned meshes over ONE skeleton's bones, the shape a shipped
   *  infantry GLB has (five material roles, five `SkinnedMesh`es, five
   *  distinct `Skeleton` OBJECTS over the same bone array). */
  function twoRoleFigure(opts: { sameBoneOrder?: boolean } = {}): {
    root: THREE.Object3D;
    a: THREE.SkinnedMesh;
    b: THREE.SkinnedMesh;
  } {
    const root = new THREE.Object3D();
    const bones = [new THREE.Bone(), new THREE.Bone()];
    function skinned(name: string, boneOrder: THREE.Bone[]): THREE.SkinnedMesh {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(12), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(12), 4));
      g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
      const m = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
      m.name = name;
      // A DISTINCT Skeleton object per mesh, exactly like SkeletonUtils.clone
      // produces -- so object identity is the wrong test and bone ORDER is
      // the right one.
      m.bind(new THREE.Skeleton(boneOrder));
      root.add(m);
      return m;
    }
    const a = skinned('uniform', bones);
    const b = skinned('webbing', opts.sameBoneOrder === false ? [bones[1], bones[0]] : bones);
    return { root, a, b };
  }

  it('collapses a multi-role figure to ONE silhouette mesh', () => {
    // The draw-call claim, as a test. Five roles per shipped rifleman means
    // five extra draws per unit if this does not hold -- measured at +83
    // draws for 16 units before the merge landed.
    // Break to confirm red: return `null` from `silhouetteGeometryFor`, or
    // make `canShareSilhouette` always false.
    const { root, a, b } = twoRoleFigure();
    const created = attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    expect(created.length).toBe(1);
    expect(created[0].geometry).not.toBe(a.geometry);
    expect(created[0].geometry).not.toBe(b.geometry);
    // ...and the merged geometry really is both of them, not one of them.
    expect(created[0].geometry.getAttribute('position').count).toBe(
      a.geometry.getAttribute('position').count + b.geometry.getAttribute('position').count
    );
    // Every body mesh in the group stamps the mask the shared silhouette reads.
    for (const mesh of [a, b]) {
      expect((mesh.material as THREE.Material).stencilZPass).toBe(THREE.ReplaceStencilOp);
    }
  });

  it('refuses to merge meshes whose skeletons order their bones differently', () => {
    // `skinIndex` is an index INTO the bone array, so merging across two
    // different orders would deform one mesh by the other's skeleton. The
    // fallback is one silhouette each: more draw calls, never a wrong shape.
    // Break to confirm red: drop the bone-order loop in canShareSilhouette.
    const { root } = twoRoleFigure({ sameBoneOrder: false });
    const created = attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    expect(created.length).toBe(2);
  });

  it('merges the same template only once, however many units are built from it', () => {
    // Geometries are template-owned and shared by every clone
    // (`mesh-unit.ts`), so the merge is cached on them -- otherwise every
    // spawned rifleman would pay a merge and carry its own vertex copy.
    // Break to confirm red: delete the mergedGeometryCache lookup.
    const first = twoRoleFigure();
    const second = twoRoleFigure();
    // A second "clone": same geometry objects, its own skeletons.
    second.a.geometry = first.a.geometry;
    second.b.geometry = first.b.geometry;
    const one = attachMeshSilhouette(first.root, createMeshSilhouetteMaterial('#2F6FD9'));
    const two = attachMeshSilhouette(second.root, createMeshSilhouetteMaterial('#2F6FD9'));
    expect(one.length).toBe(1);
    expect(two.length).toBe(1);
    expect(two[0].geometry).toBe(one[0].geometry);
  });
});

describe('the silhouette material', () => {
  it('draws ONLY where something already won the depth test in front of it', () => {
    // This is the whole occlusion mechanism: GreaterDepth means the fragment
    // is drawn only where the depth buffer already holds something NEARER --
    // i.e. exactly where the unit lost. depthWrite must stay off or the
    // silhouette would occlude the very geometry it is drawn over.
    // Break to confirm red: THREE.LessEqualDepth, or depthWrite: true.
    const mat = createMeshSilhouetteMaterial('#2F6FD9');
    expect(mat.depthFunc).toBe(THREE.GreaterDepth);
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
  });

  it('refuses to draw where a unit body already won -- the mask that kills self-occlusion', () => {
    // Measured, not feared: `GreaterDepth` alone painted flat blue over
    // every vehicle's own far hull on beit_sahwan_outskirts, in the open.
    // The silhouette must READ the mask (NotEqual, test enabled) and never
    // WRITE it. Break to confirm red: AlwaysStencilFunc, EqualStencilFunc,
    // or stencilWrite: false.
    const mat = createMeshSilhouetteMaterial('#2F6FD9');
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilFunc).toBe(THREE.NotEqualStencilFunc);
    expect(mat.stencilRef).toBe(SILHOUETTE_STENCIL_REF);
    expect(mat.stencilZPass).toBe(THREE.KeepStencilOp);
    expect(mat.stencilFail).toBe(THREE.KeepStencilOp);
    expect(mat.stencilZFail).toBe(THREE.KeepStencilOp);
  });

  it('has every body mesh stamp that mask across its whole FOOTPRINT -- won or lost', () => {
    // The one line that turns the fill into an outline. `stencilZPass:
    // Replace` alone means "my front is here", which is what the FILL
    // needed: a body fragment that lost had to leave the mask clear so the
    // fill could appear on it. An outline lives outside the footprint
    // entirely, so it needs the opposite -- `stencilZFail: Replace` too --
    // and the two readings of one bit cannot coexist. Without it the
    // expanded hull is not punched and draws a fatter solid fill.
    // Break to confirm red: stencilZFail: KeepStencilOp -- fails with
    // `expected 7680 to be 7681`.
    const { root, body, skinned } = meshUnitRig();
    attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    for (const mesh of [body, skinned]) {
      const mat = mesh.material as THREE.Material;
      expect(mat.stencilWrite).toBe(true);
      expect(mat.stencilFunc).toBe(THREE.AlwaysStencilFunc);
      expect(mat.stencilRef).toBe(SILHOUETTE_STENCIL_REF);
      expect(mat.stencilZPass).toBe(THREE.ReplaceStencilOp);
      expect(mat.stencilZFail).toBe(THREE.ReplaceStencilOp);
      expect(mat.stencilFail).toBe(THREE.KeepStencilOp);
    }
  });

  it('marks every material of a multi-material mesh, not just the first', () => {
    // Break to confirm red: drop the array branch in markSilhouetteOccludee.
    const a = new THREE.MeshBasicMaterial();
    const b = new THREE.MeshBasicMaterial();
    markSilhouetteOccludee([a, b]);
    expect(a.stencilZPass).toBe(THREE.ReplaceStencilOp);
    expect(b.stencilZPass).toBe(THREE.ReplaceStencilOp);
  });

  it('pushes its own depth toward the camera, clearing a billboard’s ground-clipped lower half', () => {
    // The one artefact the stencil cannot reach: terrain writes no mask, and
    // a ground-clipped billboard fragment that loses to it writes none
    // either, so without the bias every billboard unit grows a flat smear at
    // its feet. Break to confirm red: delete the onBeforeCompile injection.
    const mat = createMeshSilhouetteMaterial('#2F6FD9');
    const shader = { vertexShader: '#include <project_vertex>\n', fragmentShader: '', uniforms: {} };
    mat.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain('mvPosition.z +=');
    expect(shader.vertexShader).toContain('gl_Position = projectionMatrix * mvPosition;');
  });
});

describe('the inverted hull', () => {
  /** Two triangles meeting at a 90-degree crease, with the crease vertices
   *  DUPLICATED -- the shape a hard-edged `kit.py` export has, and the whole
   *  reason the normals have to be welded by position. */
  function creaseGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          // Face A, normal +Z
          0, 0, 0, 1, 0, 0, 0, 1, 0,
          // Face B, normal +X -- its first two vertices sit exactly on
          // face A's first and third.
          0, 0, 0, 0, 1, 0, 0, 0, 1,
        ]),
        3
      )
    );
    return g;
  }

  it('averages the face normals of every triangle at a POSITION, not at a vertex index', () => {
    // A hull corner in a hard-edged export is several vertices at one point
    // carrying different face normals. Expanding each along its own normal
    // pulls the faces apart and opens a wedge at every crease -- and the
    // creases are where a boxy vehicle's outline is.
    // Break to confirm red: accumulate into `i` instead of `slotOf[i]` (drop
    // the weld) -- the two shared-position expectations fail with
    // `expected 0 to be close to 0.7071067811865476`.
    const n = smoothedOutwardNormals(creaseGeometry());
    const at = (i: number) => [n[i * 3], n[i * 3 + 1], n[i * 3 + 2]];
    const root2 = Math.SQRT1_2;
    // Vertex 0 and vertex 3 are the same point, in both faces: the blend.
    for (const i of [0, 3]) {
      const [x, y, z] = at(i);
      expect(x).toBeCloseTo(root2, 6);
      expect(y).toBeCloseTo(0, 6);
      expect(z).toBeCloseTo(root2, 6);
    }
    // Vertex 1 belongs to face A alone, vertex 5 to face B alone: their own
    // face normals, unblended.
    expect(at(1)).toEqual([0, 0, 1]);
    expect(at(5)).toEqual([1, 0, 0]);
  });

  it('points OUTWARD, following three.js’s own front-face winding', () => {
    // An inward-pointing expansion shrinks the shell inside the body's
    // footprint, where the stencil masks every pixel of it: the outline
    // disappears entirely rather than looking wrong, which is the failure
    // mode that gets shipped.
    // Break to confirm red: swap the cross-product operands (`v x u`) --
    // `expected -1 to be 1`, and the weld test above goes red with it.
    const g = new THREE.BufferGeometry();
    // A single +Z-facing triangle, wound counter-clockwise as seen from +Z.
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
    );
    const n = smoothedOutwardNormals(g);
    expect(n[2]).toBe(1);
  });

  it('leaves a vertex whose faces cancel exactly where it is, rather than emitting NaN', () => {
    // One NaN vertex takes the whole draw call's geometry with it. Break to
    // confirm red: drop the `len === 0` guard -- every component reads NaN.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]), 3));
    const n = smoothedOutwardNormals(g);
    expect(Array.from(n)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('the outline width', () => {
  it('is the same number of SCREEN pixels at every zoom main.ts allows', () => {
    // World units would be a sub-pixel hairline at zoom 0.35 and a 6-pixel
    // band at 2.5 -- the paint blob back again at the zoom the player is
    // looking hardest at. Break to confirm red: drop the `* zoom` from the
    // divisor in silhouetteOutlineWorldWidth -- `expected 0.875 to be close
    // to 2.5`.
    for (const zoom of [0.35, 0.55, 1, 1.6, 2.5]) {
      const px = silhouetteOutlineWorldWidth(zoom) * SILHOUETTE_PX_PER_WORLD_UNIT * zoom;
      expect(px).toBeCloseTo(SILHOUETTE_OUTLINE_PX, 9);
    }
  });

  it('is converted back into the GLB’s own space, because every mesh unit root is scaled by MESH_SCALE', () => {
    // The expansion is applied to `transformed`, in the mesh's OWN object
    // space, under a root scaled by 1/3 (Blender builds at metres, this
    // renderer draws one world unit per tile). An offset authored in world
    // units and handed straight to the shader comes out a third as thick as
    // asked for -- plausible-looking, and wrong.
    // Break to confirm red: return silhouetteOutlineWorldWidth(zoom)
    // unmultiplied from silhouetteOutlineObjectWidth -- `expected
    // 0.036828478186799345 to be close to 0.11048543456039804`.
    for (const zoom of [0.5, 1, 2]) {
      expect(silhouetteOutlineObjectWidth(zoom) * MESH_SCALE).toBeCloseTo(
        silhouetteOutlineWorldWidth(zoom),
        12
      );
    }
  });

  it('reaches the shader as a live uniform the camera can retune every frame', () => {
    // A width constant nothing writes is a width that never changes. The
    // uniform OBJECT has to be the same one the compiled program holds, or
    // `setSilhouetteOutlineZoom` writes into a copy and the outline silently
    // stays at its zoom-1 seed.
    // Break to confirm red: build a fresh `{ value }` object inside
    // onBeforeCompile instead of closing over the shared one -- fails with
    // `expected 0.16572815184059705 to be 0.06629126073623882`.
    const mat = createMeshSilhouetteMaterial('#2F6FD9');
    const shader = {
      vertexShader: '#include <begin_vertex>\n#include <project_vertex>\n',
      fragmentShader: '',
      uniforms: {} as Record<string, { value: number }>,
    };
    mat.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain(`attribute vec3 ${SILHOUETTE_EXPAND_ATTRIBUTE};`);
    expect(shader.vertexShader).toContain(`transformed += ${SILHOUETTE_EXPAND_ATTRIBUTE} * uOutlineWidth;`);
    expect(shader.uniforms.uOutlineWidth.value).toBe(silhouetteOutlineObjectWidth(1));

    setSilhouetteOutlineZoom([mat], 2.5);
    expect(shader.uniforms.uOutlineWidth.value).toBe(silhouetteOutlineObjectWidth(2.5));
    expect(
      (mat.userData as Record<string, { value: number }>)[SILHOUETTE_OUTLINE_UNIFORM_KEY].value
    ).toBe(silhouetteOutlineObjectWidth(2.5));
  });

  it('draws the hull’s FAR shell on the mesh path and the quad’s near face on the billboard path', () => {
    // Not a preference. `FrontSide` on a mesh gives an outline in fragments:
    // a front face only moves outward in SCREEN space by however much its
    // normal is perpendicular to the view, which is true only of the grazing
    // triangles at the silhouette edge -- and half of those face away and are
    // culled. Photographed both ways at one camera: broken squiggles vs one
    // continuous contour. The billboard path must NOT inherit it, because a
    // camera-facing quad drawn BackSide draws nothing at all.
    // Break to confirm red: drop the `side:` override in
    // createMeshSilhouetteMaterial -- `expected 0 to be 1`.
    expect(createMeshSilhouetteMaterial('#2F6FD9').side).toBe(THREE.BackSide);
    expect(SILHOUETTE_MATERIAL_FLAGS.side).toBe(THREE.FrontSide);
  });

  it('expands BEFORE skinning, so a running rifleman’s outline runs with him', () => {
    // `<begin_vertex>` sets `transformed`; `<skinning_vertex>` rewrites it
    // through the bone matrices. Patching after the second one would leave
    // the outline standing in bind pose around a walking body.
    // Break to confirm red: patch `#include <skinning_vertex>` instead. Two
    // tests go red: this one on the ordering, and the live-uniform test above
    // first, with `to contain 'transformed += aExpand * uOutlineWidth;'` --
    // a shader with no <skinning_vertex> then gets no expansion at all.
    const mat = createMeshSilhouetteMaterial('#2F6FD9');
    const shader = {
      vertexShader: '#include <begin_vertex>\n#include <skinning_vertex>\n#include <project_vertex>\n',
      fragmentShader: '',
      uniforms: {} as Record<string, unknown>,
    };
    mat.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader.indexOf('transformed += ')).toBeLessThan(
      shader.vertexShader.indexOf('#include <skinning_vertex>')
    );
  });
});

describe('the silhouette colour', () => {
  it('answers "whose unit is that" -- own, hostile, civilian', () => {
    // Break to confirm red: return the same key for every side.
    expect(silhouetteColorKey(0)).toBe('team.kedem');
    expect(silhouetteColorKey(1)).toBe('team.hostile');
    expect(silhouetteColorKey(2)).toBe('team.neutral');
    // Any side the sim grows later is hostile-coloured, never uncoloured.
    expect(silhouetteColorKey(7)).toBe('team.hostile');
  });

  it('is a data/palette.json colour, never an invented hex', () => {
    // `resolveColor` is optional on RendererOptions, so every call site in
    // this backend carries a literal fallback (ThreeRenderer.overlayColor).
    // That fallback is only legitimate if it IS the palette entry its key
    // names. Break to confirm red: change any fallback by one digit.
    const teamColors = paletteJson.reserved.team.colors as Record<string, string>;
    for (const side of [0, 1, 2, 7]) {
      const key = silhouetteColorKey(side);
      const name = key.slice('team.'.length);
      expect(teamColors[name]).toBeDefined();
      expect(silhouetteFallbackHex(side).toUpperCase()).toBe(teamColors[name].toUpperCase());
    }
    expect(Object.keys(SILHOUETTE_COLOR_KEY_BY_SIDE)).toEqual(Object.keys(SILHOUETTE_FALLBACK_HEX_BY_SIDE));
  });
});

describe('the silhouette band', () => {
  // Where band 6 sits relative to the overlay, smoke and fog tiers is
  // asserted ONCE, in `render-order.test.ts` alongside every other band --
  // this file only checks that the constant reaches the objects that need
  // it, which is the half that module cannot see.
  it('is the band every attached silhouette actually carries', () => {
    // A constant nothing reads is a comment. Break to confirm red: drop the
    // `renderOrder` assignment in attachMeshSilhouette.
    const { root } = meshUnitRig();
    const silhouettes = attachMeshSilhouette(root, createMeshSilhouetteMaterial('#2F6FD9'));
    for (const s of silhouettes) expect(s.renderOrder).toBe(SILHOUETTE_RENDER_ORDER);
  });
});
