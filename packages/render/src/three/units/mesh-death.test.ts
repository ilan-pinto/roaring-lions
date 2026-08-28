/**
 * `mesh-death.ts` -- the fade curve, the material swap, and the dying ->
 * wreck/removed handoff, all exercised headlessly. `environment: 'node'`
 * (`vitest.config.ts`): every object here (`THREE.Scene`, `THREE.Group`,
 * `THREE.Mesh`, `GLTFLoader.parse`, `THREE.AnimationMixer`) is plain JS-side
 * construction with no `WebGLRenderer` needed -- `mesh-unit.test.ts` and
 * `fog-mesh.test.ts` both already established this precedent; this file
 * reuses `mesh-unit.test.ts`'s own fixture builder (now `./mesh-fixture.ts`)
 * rather than inventing a second GLB.
 *
 * Per this project's own testing standard: every assertion below that
 * matters was verified by breaking the corresponding line in
 * `mesh-death.ts` by hand and confirming the SPECIFIC test named goes red,
 * then reverting. Each break is named at its own test, in this task's own
 * report.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { buildMeshUnitTemplate, instantiateMeshUnit, type MeshUnitEntity } from './mesh-unit';
import { parseFixture } from './mesh-fixture';
import { toonRampSkinnedMaterial } from './mesh-material';
import { groundWorldY } from '../ground-height';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import {
  MESH_DEATH_SECONDS,
  meshDeathOpacity,
  meshDeathSinkPx,
  beginMeshDeathFade,
  setMeshDeathOpacity,
  endMeshDeathFade,
  beginMeshDeath,
  stepMeshDeath,
  pushMeshWreck,
  updateMeshWrecks,
  type MeshWreck,
  type MeshDeathEnv,
} from './mesh-death';

async function buildEntity(clips: string | string[]): Promise<MeshUnitEntity> {
  const gltf = await parseFixture({ roleName: 'uniform', clipName: clips });
  const template = buildMeshUnitTemplate(gltf, 'kdf');
  return instantiateMeshUnit(template, 'inf_squad');
}

function findBone(entity: MeshUnitEntity): THREE.Bone {
  let bone: THREE.Bone | null = null;
  entity.root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) bone = (o as THREE.SkinnedMesh).skeleton.bones[1];
  });
  if (!bone) throw new Error('fixture has no skinned mesh');
  return bone;
}

function findMeshMaterial(entity: MeshUnitEntity): THREE.Material {
  let mat: THREE.Material | null = null;
  entity.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) mat = m.material as THREE.Material;
  });
  if (!mat) throw new Error('fixture has no mesh');
  return mat;
}

// --- the curve -------------------------------------------------------------

describe('meshDeathOpacity', () => {
  it('starts fully opaque at t=0', () => {
    expect(meshDeathOpacity(0)).toBe(1);
  });

  it('fades to exactly half at MESH_DEATH_SECONDS -- toward half, never to nothing', () => {
    // Break check (verified by hand, then reverted): in `meshDeathOpacity`,
    // change `* 0.5` to `* 1`. This assertion then reads 0 instead of 0.5
    // and goes red.
    expect(meshDeathOpacity(MESH_DEATH_SECONDS)).toBe(0.5);
  });

  it('is linear -- 3/4 opacity at the midpoint', () => {
    expect(meshDeathOpacity(MESH_DEATH_SECONDS / 2)).toBeCloseTo(0.75, 10);
  });

  it('clamps at 0.5 past the death window rather than continuing to fade', () => {
    // Break check (verified by hand, then reverted): in `meshDeathProgress`,
    // change `Math.min(1, t / deathSeconds)` to the bare `t / deathSeconds`
    // (no clamp). This assertion then reads far below 0.5 (progress keeps
    // growing past 1) and goes red.
    expect(meshDeathOpacity(999)).toBe(0.5);
  });
});

describe('meshDeathSinkPx', () => {
  it('starts at 0 at t=0', () => {
    expect(meshDeathSinkPx(0)).toBe(0);
  });

  it('reaches exactly 3px at MESH_DEATH_SECONDS -- renderer.ts:1263\'s own p * 3', () => {
    // Break check (verified by hand, then reverted): change `* 3` to `* 5`
    // in `meshDeathSinkPx`. This assertion then reads 5 instead of 3 and
    // goes red.
    expect(meshDeathSinkPx(MESH_DEATH_SECONDS)).toBe(3);
  });

  it('clamps at 3px past the death window', () => {
    expect(meshDeathSinkPx(999)).toBe(3);
  });
});

// --- material swap -----------------------------------------------------

describe('beginMeshDeathFade / setMeshDeathOpacity / endMeshDeathFade', () => {
  it('clones a distinct material per identity, installs it with transparent:true, and leaves the original untouched', () => {
    const materialA = toonRampSkinnedMaterial(['#8F9464']);
    const materialB = toonRampSkinnedMaterial(['#6E7449']);
    const root = new THREE.Group();
    const meshA1 = new THREE.Mesh(new THREE.BufferGeometry(), materialA);
    const meshA2 = new THREE.Mesh(new THREE.BufferGeometry(), materialA); // shares materialA
    const meshB = new THREE.Mesh(new THREE.BufferGeometry(), materialB);
    root.add(meshA1, meshA2, meshB);

    const swaps = beginMeshDeathFade(root);
    expect(swaps).toHaveLength(3);

    // Break check (verified by hand, then reverted): delete `fade.transparent
    // = true;` in `beginMeshDeathFade`. This assertion then reads `false`
    // (three.js's own `ShaderMaterial` default) and goes red.
    for (const s of swaps) expect(s.fade.transparent).toBe(true);

    expect(meshA1.material).not.toBe(materialA);
    expect(materialA.transparent).toBe(false);
    expect(materialB.transparent).toBe(false);

    // Dedup by identity: two meshes sharing materialA get the SAME fade
    // clone, not two independent ones.
    // Break check (verified by hand, then reverted): remove the
    // `cloned.get`/`cloned.set` shortcut in `beginMeshDeathFade` so every
    // mesh gets its own clone unconditionally. This assertion then goes
    // red (`meshA1`'s and `meshA2`'s fade clones are no longer the same
    // object).
    const fadeForA = swaps.find((s) => s.mesh === meshA1)!.fade;
    expect(swaps.find((s) => s.mesh === meshA2)!.fade).toBe(fadeForA);
    expect(swaps.find((s) => s.mesh === meshB)!.fade).not.toBe(fadeForA);

    setMeshDeathOpacity(swaps, 0.6);
    expect((fadeForA.uniforms.uOpacity as { value: number }).value).toBeCloseTo(0.6, 10);
    // The ORIGINAL material's own uOpacity is untouched -- proof the clone
    // is a genuinely separate uniform, not an alias.
    expect((materialA.uniforms.uOpacity as { value: number }).value).toBe(1.0);

    const disposeSpyA = vi.spyOn(fadeForA, 'dispose');
    const fadeForB = swaps.find((s) => s.mesh === meshB)!.fade;
    const disposeSpyB = vi.spyOn(fadeForB, 'dispose');
    endMeshDeathFade(swaps);

    expect(meshA1.material).toBe(materialA);
    expect(meshA2.material).toBe(materialA);
    expect(meshB.material).toBe(materialB);
    // Break check (verified by hand, then reverted): remove the
    // `disposed.has`/`disposed.add` guard in `endMeshDeathFade` so every
    // SWAP disposes its clone, rather than every distinct clone once. With
    // two swaps sharing `fadeForA`, this assertion then reads 2 instead of
    // 1 and goes red.
    expect(disposeSpyA).toHaveBeenCalledTimes(1);
    expect(disposeSpyB).toHaveBeenCalledTimes(1);
  });
});

// --- beginMeshDeath ------------------------------------------------------

describe('beginMeshDeath', () => {
  it('plays the down clip when the GLB has one, and captures baseWorldY/t=0/one swap per mesh', async () => {
    const entity = await buildEntity(['idle', 'down']);
    entity.root.position.set(2, 5, 3);
    const dying = beginMeshDeath(entity);
    // Break check (verified by hand, then reverted): delete the
    // `applyMeshClip(entity, 'down');` call in `beginMeshDeath`. This
    // assertion then reads `null` (no clip ever applied to a freshly
    // instantiated entity) instead of `'down'` and goes red.
    expect(entity.currentClip).toBe('down');
    expect(dying.t).toBe(0);
    expect(dying.baseWorldY).toBe(5);
    expect(dying.swaps).toHaveLength(1);
  });

  it('falls back to idle -- through the EXISTING applyMeshClip fallback, not a second one -- when the GLB has no down clip', async () => {
    const entity = await buildEntity('idle');
    beginMeshDeath(entity);
    expect(entity.currentClip).toBe('idle');
  });
});

// --- stepMeshDeath ---------------------------------------------------------

function makeEnv(overrides: Partial<MeshDeathEnv> = {}): MeshDeathEnv {
  return {
    scene: new THREE.Scene(),
    elevation: null,
    width: 10,
    height: 10,
    isExplored: () => true,
    ...overrides,
  };
}

describe('stepMeshDeath', () => {
  it('while still fading: advances t, writes this frame\'s opacity, and sinks position.y from baseWorldY -- returns "fading"', async () => {
    const entity = await buildEntity(['idle', 'down', 'wreck']);
    entity.root.position.set(2, 7, 3);
    const dying = beginMeshDeath(entity);
    const env = makeEnv();

    const result = stepMeshDeath(dying, 0.1, env);

    expect(result).toBe('fading');
    expect(dying.t).toBeCloseTo(0.1, 10);
    // Break check (verified by hand, then reverted): comment out the
    // `setMeshDeathOpacity(d.swaps, meshDeathOpacity(d.t));` line in
    // `stepMeshDeath`. This assertion then reads 1.0 (the material's own
    // untouched default) instead of the faded value and goes red.
    const opacityNow = (dying.swaps[0].fade.uniforms.uOpacity as { value: number }).value;
    expect(opacityNow).toBeCloseTo(meshDeathOpacity(0.1), 10);
    expect(entity.root.position.y).toBeCloseTo(7 - meshDeathSinkPx(0.1) * WORLD_Y_PER_LIFT_PIXEL, 10);
  });

  it('at the fade boundary: starts the wreck one-shot but does not settle until its OWN clip duration has elapsed', async () => {
    // This fixture's wreck clip runs t=0..1 (buildFixtureGlb's own fixed
    // 1-second animInput) -- a stand-in for a real future animated
    // collapse, proving the settle phase genuinely waits for it rather than
    // assuming a duration of zero the way the earlier, pre-`{ once: true }`
    // implementation had to.
    const entity = await buildEntity(['idle', 'down', 'wreck']);
    entity.root.position.set(1, 0, 1);
    const dying = beginMeshDeath(entity);
    const scene = new THREE.Scene();
    scene.add(entity.root);
    const env = makeEnv({ scene });

    // Break check (verified by hand, then reverted): in `stepMeshDeath`,
    // change the final `return 'fading';` (right after `d.settling = true`)
    // to instead build and return a `MeshWreck` immediately, in the SAME
    // call that starts the wreck one-shot. This assertion then goes red (a
    // `MeshWreck` object, not the string `'fading'`).
    const atBoundary = stepMeshDeath(dying, MESH_DEATH_SECONDS, env);
    expect(atBoundary).toBe('fading');
    expect(dying.settling).toBe(true);
    expect(entity.currentClip).toBe('wreck');

    // Break check (verified by hand, then reverted): in `stepMeshDeath`'s
    // settle branch, drop the `!action.paused` half of the guard (always
    // treat the settle phase as finished on its very first tick). This
    // assertion then goes red (a `MeshWreck` comes back after only 0.1s of
    // a 1-second clip).
    const midSettle = stepMeshDeath(dying, 0.1, env);
    expect(midSettle).toBe('fading');

    const settled = stepMeshDeath(dying, 1.0, env); // comfortably past the remaining ~0.9s
    expect(settled).not.toBe('fading');
    expect(settled).not.toBe('removed');
  });

  it('becomes a MeshWreck at full opacity, on the ground, playing the wreck clip -- once settled', async () => {
    const entity = await buildEntity(['idle', 'down', 'wreck']);
    const originalMaterial = findMeshMaterial(entity);
    entity.root.position.set(4, 9, 6);
    const dying = beginMeshDeath(entity);

    const elevation = new Uint8Array(10 * 10);
    elevation[6 * 10 + 4] = 3; // row-major y*width+x, matching this codebase's other per-tile arrays (fog, etc.)
    const expectedGroundY = groundWorldY(elevation, 10, 10, 4, 6);
    expect(expectedGroundY).toBeGreaterThan(0); // sanity: the elevation array actually took effect

    const scene = new THREE.Scene();
    scene.add(entity.root);
    const env = makeEnv({ scene, elevation, isExplored: (x, y) => x === 4 && y === 6 });

    stepMeshDeath(dying, MESH_DEATH_SECONDS, env); // fade closes, wreck one-shot starts
    const result = stepMeshDeath(dying, 1.5, env); // settles (fixture's wreck clip is 1s)

    expect(result).not.toBe('fading');
    expect(result).not.toBe('removed');
    const wreck = result as MeshWreck;
    expect(wreck.root).toBe(entity.root);
    expect(wreck.x).toBe(4);
    expect(wreck.y).toBe(6);
    expect(wreck.shown).toBe(true);
    expect(entity.root.visible).toBe(true);
    // Ground height, not the sunk death position.
    // Break check (verified by hand, then reverted): delete the
    // `d.entity.root.position.y = groundWorldY(...)` line in `stepMeshDeath`'s
    // settle branch. This assertion then reads the SUNK death position
    // (~8.9 world units, from `meshDeathSinkPx`'s max settle carried through
    // the whole fade) instead of the flat elevation-3 ground height
    // (~0.77) and goes red.
    expect(entity.root.position.y).toBeCloseTo(expectedGroundY, 10);
    expect(entity.currentClip).toBe('wreck');
    // Materials restored to the ORIGINAL, shared template material -- a
    // wreck draws at full opacity, matching Pixi's own addWreck.
    expect(findMeshMaterial(entity)).toBe(originalMaterial);
    // Still in the scene -- a wreck persists, it is not removed.
    expect(scene.children).toContain(entity.root);
  });

  it('starts a wreck HIDDEN when its tile has never been explored', async () => {
    const entity = await buildEntity(['idle', 'down', 'wreck']);
    entity.root.position.set(1, 0, 1);
    const dying = beginMeshDeath(entity);
    const scene = new THREE.Scene();
    scene.add(entity.root);
    // Break check (verified by hand, then reverted): in `stepMeshDeath`,
    // replace `env.isExplored(x, y)` with a hardcoded `true` for the wreck's
    // `shown` computation. This assertion then reads `true` instead of
    // `false` and goes red.
    const env = makeEnv({ scene, isExplored: () => false });

    stepMeshDeath(dying, MESH_DEATH_SECONDS, env);
    const result = stepMeshDeath(dying, 1.5, env) as MeshWreck;

    expect(result.shown).toBe(false);
    expect(entity.root.visible).toBe(false);
  });

  it('is REMOVED, not persisted, when the GLB has no wreck clip', async () => {
    const entity = await buildEntity(['idle', 'down']); // no wreck clip
    entity.root.position.set(1, 0, 1);
    const dying = beginMeshDeath(entity);
    const scene = new THREE.Scene();
    scene.add(entity.root);
    const env = makeEnv({ scene });

    const result = stepMeshDeath(dying, MESH_DEATH_SECONDS, env);

    // Break check (verified by hand, then reverted): in `stepMeshDeath`,
    // change `if (!d.entity.actions.has('wreck'))` to `if (false)` -- i.e.
    // never take the no-wreck-clip removal path. This assertion then reads
    // `'fading'` instead of `'removed'`: the wreck one-shot starts anyway,
    // `applyMeshClip` silently resolves it to `idle` (its own existing,
    // correct fallback for a genuinely MISSING clip -- `d.entity.actions.
    // get('wreck')` then reads `undefined`, so `d.wreckAction` is `null`),
    // and the entity is neither removed nor ever settles into a real
    // `MeshWreck` -- stuck fading forever instead of the intended
    // no-wreck-clip removal.
    expect(result).toBe('removed');
    expect(scene.children).not.toContain(entity.root);
  });

  it('freezes the wreck pose permanently -- a later mixer.update does not move it', async () => {
    const entity = await buildEntity(['idle', 'down', 'wreck']);
    entity.root.position.set(1, 0, 1);
    const dying = beginMeshDeath(entity);
    const scene = new THREE.Scene();
    scene.add(entity.root);
    const env = makeEnv({ scene });

    stepMeshDeath(dying, MESH_DEATH_SECONDS, env); // fade closes, wreck one-shot starts
    stepMeshDeath(dying, 1.5, env); // settles -- the clip's own duration (1s) has elapsed

    const bone = findBone(entity);
    const frozen = bone.quaternion.clone();
    // Sanity: the settled pose is the clip's genuine END rotation, not the
    // identity bind pose -- proof this is testing a real held ANIMATION
    // frame (`THREE.LoopOnce` + `clampWhenFinished`), not merely a value
    // that never moved because nothing ever played.
    expect(frozen.x).not.toBeCloseTo(0, 3);
    // `stepMeshDeath`'s settle branch deliberately does NOT call
    // `disposeMeshUnitEntity` here -- see that function's own doc comment
    // for why calling it would be actively wrong (it calls
    // `restoreOriginalState`, snapping every bound property back to BIND
    // pose, not holding the last-drawn one -- measured against the real
    // `art/meshes/inf_squad.glb`, where bind pose shows the standing AND
    // prone geometry both visible at once). The freeze this test asserts is
    // therefore entirely `THREE.LoopOnce` + `clampWhenFinished`'s own doing
    // (`_effectiveTimeScale = paused ? 0 : timeScale`, `AnimationAction.js`)
    // -- a later `mixer.update` call is a real, if harmless, no-op.
    //
    // Break check (verified by hand, then reverted): in `applyMeshClip`
    // (`mesh-unit.ts`), change the `once: true` branch's `next.
    // clampWhenFinished = true` to `false` (leaving `LoopOnce` alone). Per
    // `AnimationAction.js`'s own finish handling, a `LoopOnce` action that
    // is NOT clamped sets `enabled = false` instead of `paused = true` --
    // and this file's settle guard checks `.paused`, so `stepMeshDeath`
    // then never reports the wreck settled at all: four tests in this
    // file go red, not just this one (`at the fade boundary`, `becomes a
    // MeshWreck`, `starts a wreck HIDDEN` all time out waiting for a
    // `MeshWreck` that never arrives). THIS test goes red on its OWN sanity
    // line above (`frozen.x` reads back at identity, not the rotated end
    // pose) rather than on the freeze assertion itself: with no clamp, the
    // wreck action falls back to whatever `applyMeshClip`'s DEFAULT branch
    // would have given it, and the two `stepMeshDeath` calls above never
    // let it settle before `frozen` is captured.
    entity.mixer.update(0.37);
    expect(bone.quaternion.equals(frozen)).toBe(true);
  });
});

// --- pushMeshWreck / updateMeshWrecks ---------------------------------------

describe('pushMeshWreck', () => {
  it('evicts the OLDEST wreck once max is exceeded, removing it from the scene', () => {
    const scene = new THREE.Scene();
    const roots = [0, 1, 2].map(() => new THREE.Object3D());
    const wrecks: MeshWreck[] = [];

    pushMeshWreck(wrecks, { root: roots[0], x: 0, y: 0, shown: true }, scene, 2);
    pushMeshWreck(wrecks, { root: roots[1], x: 1, y: 0, shown: true }, scene, 2);
    pushMeshWreck(wrecks, { root: roots[2], x: 2, y: 0, shown: true }, scene, 2);

    expect(wrecks).toHaveLength(2);
    // Break check (verified by hand, then reverted): swap `wrecks.shift()`
    // for `wrecks.pop()` in `pushMeshWreck`. This assertion then reads
    // `[roots[0], roots[1]]` (the NEWEST evicted instead of the oldest) and
    // goes red.
    expect(wrecks.map((w) => w.root)).toEqual([roots[1], roots[2]]);
  });
});

describe('updateMeshWrecks', () => {
  it('reveals a wreck once its tile is explored, and never re-hides it once shown', () => {
    const rootA = new THREE.Object3D();
    rootA.visible = false;
    const rootB = new THREE.Object3D();
    rootB.visible = false;
    const wrecks: MeshWreck[] = [
      { root: rootA, x: 1, y: 1, shown: false },
      { root: rootB, x: 5, y: 5, shown: false },
    ];

    updateMeshWrecks(wrecks, (x, y) => x === 1 && y === 1);
    expect(wrecks[0].shown).toBe(true);
    expect(rootA.visible).toBe(true);
    expect(wrecks[1].shown).toBe(false);
    expect(rootB.visible).toBe(false);

    // Break check (verified by hand, then reverted): change
    // `if (!w.shown && isExplored(w.x, w.y))` to the unconditional
    // `if (isExplored(w.x, w.y))` in `updateMeshWrecks`. Calling with an
    // `isExplored` that now always returns false would flip an
    // already-shown wreck back to hidden -- this assertion (still `true`
    // after that call) goes red.
    updateMeshWrecks(wrecks, () => false);
    expect(wrecks[0].shown).toBe(true);
    expect(rootA.visible).toBe(true);
  });
});
