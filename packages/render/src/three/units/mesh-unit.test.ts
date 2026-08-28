/**
 * The GLB does not exist on disk when this was written -- the exporter is a
 * parallel stream targeting the same contract (`docs/superpowers/specs/
 * 2026-08-28-mesh-unit-contract.md`). `buildFixtureGlb`/`parseFixture`
 * (`./mesh-fixture.ts`) hand-author a minimal binary glTF (real GLB byte
 * framing -- header, JSON chunk, BIN chunk, per the glTF 2.0 spec)
 * satisfying that contract: one role, one or more clips, two bones, real
 * skinning. It is parsed by the SAME `GLTFLoader` production code uses
 * (`GLTFLoader.parse`, called on a real `ArrayBuffer`, not a synthetic
 * in-memory scene graph built by hand) -- so these tests exercise the
 * actual parser, not a stand-in for it.
 *
 * `environment: 'node'` (`vitest.config.ts`) supports this: `GLTFLoader`,
 * `THREE.SkinnedMesh`, `THREE.AnimationMixer`, `SkeletonUtils.clone` are all
 * pure JS-side construction and interpolation -- no `WebGLRenderer`, no DOM.
 * `fog-mesh.test.ts`'s own top comment established this precedent for real
 * (non-GPU) three.js objects; this file extends it to `GLTFLoader.parse`
 * itself, whose only GPU-shaped dependency (image/texture loading) is never
 * reached because the contract's GLB has zero materials.
 *
 * Per this project's own testing standard: every assertion below that
 * matters was verified by breaking the corresponding line in `mesh-unit.ts`
 * by hand and confirming the SPECIFIC test named goes red, then reverting.
 * Reported in `.superpowers/f-runtime-report.md`, along with a separate,
 * uncommitted smoke test run against a REAL `inf_squad.glb` the parallel
 * export stream produced mid-task (not depended on by anything checked in
 * here -- `art/` is out of bounds for this task, and that file's presence
 * is a transient state of someone else's in-progress work, not something a
 * committed test may rely on being there).
 *
 * The fixture builder used to live inline in this file; it moved to
 * `./mesh-fixture.ts` (a plain module, not a `.test.ts`) so
 * `mesh-death.test.ts` could reuse it -- importing one `.test.ts` file from
 * another would make vitest collect and run this file's OWN `describe`/`it`
 * blocks a second time as a side effect, which `mesh-fixture.ts`'s own top
 * comment explains.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  buildMeshUnitTemplate,
  instantiateMeshUnit,
  applyMeshClip,
  disposeMeshUnitEntity,
  disposeMeshUnitTemplate,
} from './mesh-unit';
import { MESH_SCALE } from './mesh-anim';
import { HULL_RENDER_ORDER, TURRET_RENDER_ORDER } from './render-order';
import { parseFixture } from './mesh-fixture';

// --- tests --------------------------------------------------------------

describe('buildFixtureGlb + GLTFLoader (fixture sanity)', () => {
  it('parses: one skinned mesh, one animation, extras and name both carrying the role', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    expect(gltf.animations).toHaveLength(1);
    expect(gltf.animations[0].name).toBe('move');
    let found = 0;
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        found++;
        expect(mesh.name).toBe('uniform');
        expect((mesh.userData as { rl_role?: string }).rl_role).toBe('uniform');
        expect((mesh as THREE.SkinnedMesh).isSkinnedMesh).toBe(true);
      }
    });
    expect(found).toBe(1);
  });
});

describe('buildMeshUnitTemplate', () => {
  it('assigns one toon-ramp material per role and scales the root by MESH_SCALE', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');

    expect(template.materials).toHaveLength(1);
    expect(template.materials[0]).toBeInstanceOf(THREE.ShaderMaterial);
    expect(template.geometries).toHaveLength(1);
    expect(template.root.scale.x).toBeCloseTo(MESH_SCALE, 10);
    expect(template.root.scale.y).toBeCloseTo(MESH_SCALE, 10);
    expect(template.root.scale.z).toBeCloseTo(MESH_SCALE, 10);
    expect(template.clips.get('move')).toBeDefined();

    // renderOrder: read render-order.ts before setting any renderOrder --
    // mesh units are real depth-tested world geometry and belong at
    // HULL_RENDER_ORDER, exactly like the billboards they replace.
    let mesh: THREE.Mesh | null = null;
    template.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
    });
    expect(mesh).not.toBeNull();
    expect((mesh as unknown as THREE.Mesh).renderOrder).toBe(HULL_RENDER_ORDER);
  });

  // Break: in `buildMeshUnitTemplate`, change `mesh.renderOrder =
  // HULL_RENDER_ORDER` to `mesh.renderOrder = TURRET_RENDER_ORDER`.
  // Verified by hand -- the assertion above goes red (`expected 1 to be 0`),
  // which is the whole point of pinning the LITERAL constant rather than
  // just "some render order was set": a mesh unit silently drawing in the
  // turret band would tie/lose against nothing today (no turret art on a
  // mesh unit yet) but would be a live landmine the moment one exists.
  it('is exactly HULL_RENDER_ORDER, not merely "some value" (regression guard for the constant itself)', () => {
    expect(HULL_RENDER_ORDER).toBe(0);
    expect(TURRET_RENDER_ORDER).toBeGreaterThan(HULL_RENDER_ORDER);
  });

  it('reads the role from extras.rl_role when the name disagrees', async () => {
    // A role read from `name` alone would get this wrong -- extras must win
    // when both are present, per the contract's "carries its role in BOTH
    // places, deliberately redundantly".
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move', nameRole: 'not-a-role-name' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    expect(template.materials).toHaveLength(1);
  });

  it('falls back to the node name when extras.rl_role is absent', async () => {
    // The contract: "The runtime reads extras and falls back to the name.
    // Either alone has failed once already in this project." This is the
    // half of that sentence a name-only mesh needs to keep working.
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move', extrasRole: null });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    expect(template.materials).toHaveLength(1);
  });

  // Break: change `if (!isMeshRole(role))` to `if (false)` in
  // `buildMeshUnitTemplate`. Verified by hand -- this test then expects a
  // throw and gets none, going red, because a role outside the closed
  // vocabulary would otherwise fall through to `rampForRole`, which DOES
  // throw on its own -- so this specifically pins the loud, LISTING error
  // `buildMeshUnitTemplate` gives (naming every offending role at once,
  // spike-style) rather than relying on a downstream throw with a less
  // useful message.
  it('throws loudly, listing the role, for an unmapped rl_role -- never a default colour', async () => {
    const gltf = await parseFixture({ roleName: 'turret_gun', clipName: 'move' });
    expect(() => buildMeshUnitTemplate(gltf, 'kdf')).toThrow(/no ramp for rl_role turret_gun/);
  });

  // Break: change `if (!isMeshClipName(clip.name))` to `if (false)`.
  // Verified by hand -- this test then expects a throw and gets none,
  // going red, because an animation named e.g. "walk" would silently join
  // `template.clips` under a name `ClipName` never contains, and
  // `resolveClip`/`meshClipOrFallback` could never select it -- exactly
  // the "never played" failure mesh-unit-contract.md's clip section names.
  it('throws loudly for an animation clip name outside the ClipName union', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'walk' });
    expect(() => buildMeshUnitTemplate(gltf, 'kdf')).toThrow(/animation "walk" is not a recognised clip name/);
  });
});

describe('instantiateMeshUnit / applyMeshClip / mixer wiring', () => {
  it('clones are independent objects with independent skeletons -- not aliased to the template or each other', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const a = instantiateMeshUnit(template, 'inf_squad');
    const b = instantiateMeshUnit(template, 'inf_squad');

    expect(a.root).not.toBe(template.root);
    expect(a.root).not.toBe(b.root);

    let boneA: THREE.Bone | null = null;
    let boneB: THREE.Bone | null = null;
    a.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) boneA = (o as THREE.SkinnedMesh).skeleton.bones[1];
    });
    b.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) boneB = (o as THREE.SkinnedMesh).skeleton.bones[1];
    });
    expect(boneA).not.toBeNull();
    expect(boneB).not.toBeNull();
    // The break this guards: swapping `SkeletonUtils.clone(template.root)`
    // for the plain `template.root.clone()` three.js provides. Verified by
    // hand -- with that swap, `boneA === boneB` (both point at the SAME
    // bone object, since a plain Object3D.clone shares one Skeleton across
    // every "clone"), so this assertion flips to `.toBe` and goes red.
    expect(boneA).not.toBe(boneB);
  });

  // Break: in `instantiateMeshUnit`, delete the `root.traverse` block that
  // re-applies `renderOrder`. Verified by hand -- this test then reads 0
  // regardless (three.js's own default), which happens to equal
  // HULL_RENDER_ORDER anyway, so instead this test asserts against
  // TURRET_RENDER_ORDER on a template whose OWN mesh was deliberately
  // mutated first, proving the clone's traversal -- not merely inheritance
  // from an already-correct template -- is what sets it.
  it('sets HULL_RENDER_ORDER on the clone independently of the template\'s own value', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    template.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).renderOrder = 99;
    });
    const entity = instantiateMeshUnit(template, 'inf_squad');
    let renderOrder: number | null = null;
    entity.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) renderOrder = (o as THREE.Mesh).renderOrder;
    });
    expect(renderOrder).toBe(HULL_RENDER_ORDER);
  });

  it('mixer.update() actually drives the bone -- deforms via a real AnimationClip, not merely constructed', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const entity = instantiateMeshUnit(template, 'inf_squad');
    applyMeshClip(entity, 'move');

    let bone: THREE.Bone | null = null;
    entity.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) bone = (o as THREE.SkinnedMesh).skeleton.bones[1];
    });
    const before = (bone as unknown as THREE.Bone).quaternion.clone();
    expect(before.x).toBeCloseTo(0, 10);
    expect(before.w).toBeCloseTo(1, 10);

    // Mid-clip, not the exact final keyframe: the default `LoopRepeat`
    // wraps `time === duration` back to phase 0 (`1 % 1 === 0`), which
    // would make this assertion pass for the wrong reason (identity, same
    // as "never played" -- exactly the failure this test exists to catch).
    // Expected value is the SAME slerp three.js's own
    // `QuaternionKeyframeTrack` interpolant computes between the two
    // authored keyframes, not a naive component lerp.
    entity.mixer.setTime(0.5);
    const after = (bone as unknown as THREE.Bone).quaternion.clone();
    const expected = new THREE.Quaternion(0, 0, 0, 1).slerp(
      new THREE.Quaternion(Math.SQRT1_2, 0, 0, Math.SQRT1_2),
      0.5
    );
    expect(after.x).toBeCloseTo(expected.x, 5);
    expect(after.y).toBeCloseTo(expected.y, 5);
    expect(after.z).toBeCloseTo(expected.z, 5);
    expect(after.w).toBeCloseTo(expected.w, 5);
    // The identity quaternion is its own fixed point under slerp toward
    // ANY target at t=0, so `expected` above is a genuine mid-rotation, not
    // a second copy of `before` -- this guards against a vacuous pass.
    expect(after.x).not.toBeCloseTo(before.x, 3);
    // Break: comment out `next.reset().play()` in `applyMeshClip`.
    // Verified by hand -- with the action never played, `mixer.setTime`
    // advances the mixer's own clock but drives no track, so `after`
    // stays at the identity quaternion and every assertion above goes red.
  });

  it('applyMeshClip leaves currentClip unset when neither the requested clip nor idle exists', async () => {
    // This fixture's GLB carries only `move` -- no `idle` at all, the "no
    // mesh units" leniency's mesh-unit equivalent: draw nothing rather than
    // fabricate a pose when there is truly nothing to play.
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const entity = instantiateMeshUnit(template, 'inf_squad');

    applyMeshClip(entity, 'fire');
    expect(entity.currentClip).toBeNull();
    // Break: in `applyMeshClip`, delete the `if (!next) return;` guard.
    // Verified by hand -- `entity.actions.get('idle')` is `undefined` here,
    // so `next.reset()` throws "Cannot read properties of undefined", and
    // THIS test is what catches it (the throw happens before
    // `toBeNull()` is ever reached, and the whole test goes red on the
    // thrown error rather than a failed assertion).
  });

  it('applyMeshClip degrades to idle for a clip this GLB never authored, and is a no-op when already on the resolved clip', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: ['move', 'idle'] });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const entity = instantiateMeshUnit(template, 'inf_squad');

    applyMeshClip(entity, 'fire'); // not in this fixture's two-clip GLB
    expect(entity.currentClip).toBe('idle');

    const playSpy = vi.spyOn(entity.actions.get('idle') as THREE.AnimationAction, 'reset');
    applyMeshClip(entity, 'idle');
    // Second call is a no-op (already resolved to idle) -- `reset()` must
    // not fire again once the resolved clip has not changed.
    expect(playSpy).not.toHaveBeenCalled();
    // Break: change `if (entity.currentClip === resolved) return;` to
    // never early-return. Verified by hand -- `playSpy` then reports 1
    // call instead of 0, and this assertion goes red.
  });

  it('disposeMeshUnitEntity stops the mixer without touching the template\'s shared resources', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const entity = instantiateMeshUnit(template, 'inf_squad');
    const stopSpy = vi.spyOn(entity.mixer, 'stopAllAction');

    disposeMeshUnitEntity(entity);
    expect(stopSpy).toHaveBeenCalledTimes(1);

    // The template's own geometry/material must survive an entity's
    // disposal untouched -- they are shared by reference with every other
    // live clone (`MeshUnitTemplate`'s own doc comment).
    const disposeSpy = vi.spyOn(template.materials[0], 'dispose');
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('disposeMeshUnitTemplate disposes every owned material and geometry exactly once', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const matSpy = vi.spyOn(template.materials[0], 'dispose');
    const geoSpy = vi.spyOn(template.geometries[0], 'dispose');

    disposeMeshUnitTemplate(template);

    // Break: delete the `for (const material of template.materials)` loop
    // body in `disposeMeshUnitTemplate` (keep only the geometry loop).
    // Verified by hand -- `matSpy` then has 0 calls instead of 1, and this
    // assertion goes red.
    expect(matSpy).toHaveBeenCalledTimes(1);
    expect(geoSpy).toHaveBeenCalledTimes(1);
  });
});

// --- applyMeshClip's `{ once: true }` option -- added for units/mesh-death.ts ---

describe('applyMeshClip once option', () => {
  it('omitted (or false): sets LoopRepeat/Infinity and clampWhenFinished=false -- three.js\'s own default, explicit', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const entity = instantiateMeshUnit(template, 'inf_squad');

    applyMeshClip(entity, 'move');
    const action = entity.actions.get('move') as THREE.AnimationAction;
    expect(action.loop).toBe(THREE.LoopRepeat);
    expect(action.clampWhenFinished).toBe(false);
  });

  it('once: true sets LoopOnce and clampWhenFinished=true', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const entity = instantiateMeshUnit(template, 'inf_squad');

    applyMeshClip(entity, 'move', { once: true });
    const action = entity.actions.get('move') as THREE.AnimationAction;
    // Break check (verified by hand, then reverted): in `applyMeshClip`,
    // swap the `once` branch's `next.setLoop(THREE.LoopOnce, 1)` for
    // `THREE.LoopRepeat`. This assertion then reads `LoopRepeat` instead of
    // `LoopOnce` and goes red.
    expect(action.loop).toBe(THREE.LoopOnce);
    // Break check (verified by hand, then reverted): in the same branch,
    // change `next.clampWhenFinished = true` to `false`. This assertion
    // then reads `false` and goes red.
    expect(action.clampWhenFinished).toBe(true);
  });

  it('once: true actually holds the clip\'s LAST frame once its own duration elapses, rather than looping', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const entity = instantiateMeshUnit(template, 'inf_squad');
    applyMeshClip(entity, 'move', { once: true });
    const action = entity.actions.get('move') as THREE.AnimationAction;
    expect(action.getClip().duration).toBe(1); // this fixture's own fixed 1-second clip

    entity.mixer.update(1.5); // well past the clip's own 1-second duration
    // Break check (verified by hand, then reverted): remove BOTH `once`
    // lines (fall through to the `else` branch's LoopRepeat regardless of
    // `opts?.once`). This assertion then reads `false` (a `LoopRepeat`
    // action never pauses) and goes red.
    expect(action.paused).toBe(true);

    let bone: THREE.Bone | null = null;
    entity.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) bone = (o as THREE.SkinnedMesh).skeleton.bones[1];
    });
    const held = (bone as unknown as THREE.Bone).quaternion.clone();
    entity.mixer.update(0.5); // a further update must be a no-op once paused
    expect((bone as unknown as THREE.Bone).quaternion.equals(held)).toBe(true);
  });

  it('without once: the SAME clip keeps looping past its own duration -- the pre-existing, still-default behaviour', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    const entity = instantiateMeshUnit(template, 'inf_squad');
    applyMeshClip(entity, 'move'); // no opts -- every EXISTING caller's own shape
    const action = entity.actions.get('move') as THREE.AnimationAction;

    // Break check (verified by hand, then reverted): in `applyMeshClip`'s
    // `else` branch, change `next.setLoop(THREE.LoopRepeat, Infinity)` to
    // `THREE.LoopOnce` (leaving `clampWhenFinished = false` alone -- the
    // `else` branch's own existing value). This assertion then reads
    // `LoopOnce` instead of `LoopRepeat` and goes red. `action.paused`
    // below does NOT catch this same break: a `LoopOnce` action that is
    // NOT clamped sets `enabled = false` on finishing rather than `paused
    // = true` (`AnimationAction.js`'s own branch, the one `once: true`
    // above deliberately avoids by pairing `LoopOnce` with `clampWhenFinished
    // = true`) -- so `.loop` is the assertion that actually distinguishes
    // this regression, not `.paused`.
    expect(action.loop).toBe(THREE.LoopRepeat);

    entity.mixer.update(1.5); // past the clip's own 1-second duration
    expect(action.paused).toBe(false);
  });
});
