/**
 * `mesh-vehicle-death.ts` plus the charring half of `mesh-vehicle.ts`, all
 * exercised headlessly against `rigid-mesh-fixture.ts`'s real, `GLTFLoader`-
 * parsed GLB -- the same `environment: 'node'` precedent `mesh-death.test.ts`
 * established for the skinned path, with no `WebGLRenderer` anywhere in the
 * call graph.
 *
 * The fixture carries the asset contract's own shape: a `death_root` whose
 * `WRECK_<part>` children reference the SAME glTF mesh their live twins do,
 * and the two constant STEP scale clips. That sharing is what makes several
 * of the assertions below non-obvious -- two `THREE.Mesh` objects over one
 * `BufferGeometry`, which must be disposed once and materialised twice.
 *
 * Per this project's own testing standard: every assertion below that matters
 * was verified by breaking the corresponding line by hand and confirming the
 * SPECIFIC test named goes red, then reverting. Each break is named at its own
 * test, and again in this task's report.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildVehicleMeshTemplate,
  instantiateVehicleMesh,
  disposeVehicleMeshTemplate,
  VEHICLE_DEATH_ROOT_NAME,
  type VehicleMeshEntity,
  type VehicleMeshTemplate,
} from './mesh-vehicle';
import { applyMeshClip } from './mesh-clip';
import { CHARRED_RAMP } from './vehicle-mesh-role';
import { CHARRED_TINT_HEX, liftTone, rampMaterial } from '../world-materials';
import {
  MAX_MESH_WRECKS,
  MESH_DEATH_SECONDS,
  pushMeshWreck,
  updateMeshWrecks,
  type MeshDeathEnv,
  type MeshWreck,
} from './mesh-death';
import { beginVehicleDeath, stepVehicleDeath, type DyingVehicle } from './mesh-vehicle-death';

/** `beginVehicleDeath`, insisting it actually started one. It returns `null`
 *  (after a `console.warn`) for an entity whose template disagrees with its own
 *  actions -- a case with its own test below; everywhere else a `null` here is
 *  the test's own setup being wrong, and should read as such rather than as a
 *  type error at every call site. */
function mustBegin(entity: VehicleMeshEntity, entityId: number, template: VehicleMeshTemplate): DyingVehicle {
  const d = beginVehicleDeath(entity, entityId, template);
  if (!d) throw new Error('beginVehicleDeath returned null -- the fixture and the template disagree');
  return d;
}

const WRECK_CLIPS = ['idle', 'wreck'] as const;

/** The two-part palette vehicle every test below starts from: a hull and a
 *  turret part, both with `WRECK_` twins, and the contract's two clips. */
async function buildTemplate(vehicleId = 'mbt_lavi'): Promise<VehicleMeshTemplate> {
  const gltf = await parseRigidFixture({
    parts: [
      { nodeName: 'hull_hull', extrasRole: 'hull' },
      { nodeName: 'turret_metal', extrasRole: 'metal' },
    ],
    clipNames: WRECK_CLIPS,
    deathRoot: { parts: ['hull_hull', 'turret_metal'] },
  });
  return buildVehicleMeshTemplate(gltf, vehicleId);
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) out.push(m);
  });
  return out;
}

const byName = (root: THREE.Object3D, name: string): THREE.Mesh => {
  const found = meshesOf(root).find((m) => m.name === name);
  if (!found) throw new Error(`no mesh named ${name}`);
  return found;
};

/**
 * The meshes `WebGLRenderer` would actually submit for `root` -- i.e. one
 * `renderer.info.render.calls` each, which cannot be read directly here (a
 * real `WebGLRenderer` needs a GL context, and this suite is
 * `environment: 'node'`).
 *
 * The rule is three.js's own `projectObject`: it returns the instant
 * `object.visible === false` and never reaches a child, so an invisible
 * subtree costs nothing; a SCALE-0 mesh, by contrast, is still projected,
 * and its bounding sphere collapses to a point at the object's own position,
 * which for a vehicle standing in front of the camera is in frustum. That
 * asymmetry is the entire reason `death_root.visible` exists.
 */
function submittedMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) out.push(m);
    for (const child of o.children) walk(child);
  };
  walk(root);
  return out;
}

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

/** Drives a `DyingVehicle` the way the real frame loop does, at a fixed
 *  60 Hz-ish step, until it stops reporting `'fading'` or `maxFrames` runs
 *  out (which is itself a failure worth seeing as a timeout rather than a
 *  wrong assertion). */
function runToCompletion(
  d: DyingVehicle,
  env: MeshDeathEnv,
  maxFrames = 200
): 'fading' | 'removed' | MeshWreck {
  let result: 'fading' | 'removed' | MeshWreck = 'fading';
  for (let i = 0; i < maxFrames; i++) {
    result = stepVehicleDeath(d, 1 / 60, env);
    if (result !== 'fading') return result;
  }
  return result;
}

// --- (a) the template: charring, and the bookkeeping the sharing forces ----

describe('buildVehicleMeshTemplate, with a death root', () => {
  it('marks hasWreck from the `wreck` clip, and not from the death root alone', async () => {
    expect((await buildTemplate()).hasWreck).toBe(true);

    // Break check: `hasWreck: clips.has('wreck')` -> `deathRootNode !== null`.
    // This case then reads `true` and goes red. The two are NOT the same
    // question: the pass writes nodes and clips together, but a GLB carrying
    // the nodes and no clips has nothing for the death path to play.
    const noClips = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      deathRoot: { parts: ['hull_hull'] },
    });
    expect(buildVehicleMeshTemplate(noClips, 'mbt_lavi').hasWreck).toBe(false);
  });

  it('is false for a clipless GLB -- the state every shipped vehicle was in before the wreck pass', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
    expect(buildVehicleMeshTemplate(gltf, 'mbt_lavi').hasWreck).toBe(false);
  });

  it('gives a palette wreck mesh CHARRED_RAMP\'s lit tone, and its live twin its own role ramp', async () => {
    const template = await buildTemplate();
    const charred = byName(template.root, 'WRECK_hull_hull').material as THREE.MeshStandardMaterial;
    const live = byName(template.root, 'hull_hull').material as THREE.MeshStandardMaterial;

    // Break check: drop the `isWreck ?` on the `rampMaterial` call. The wreck
    // then reads its own role ramp, both assertions below go red at once.
    expect(charred.color.getHex()).toBe(new THREE.Color(liftTone(CHARRED_RAMP)).getHex());
    expect(live.color.getHex()).not.toBe(charred.color.getHex());
    expect(charred).not.toBe(live);
  });

  it('chars every wreck part to the same tone whatever its role -- charring is the fire, not the paint', async () => {
    const template = await buildTemplate();
    const hull = byName(template.root, 'WRECK_hull_hull').material as THREE.MeshStandardMaterial;
    const turret = byName(template.root, 'WRECK_turret_metal').material as THREE.MeshStandardMaterial;
    expect(turret.color.getHex()).toBe(hull.color.getHex());
    // ... while their LIVE twins genuinely differ, so this is not passing
    // because the fixture's two roles happen to share a ramp.
    const liveHull = byName(template.root, 'hull_hull').material as THREE.MeshStandardMaterial;
    const liveTurret = byName(template.root, 'turret_metal').material as THREE.MeshStandardMaterial;
    expect(liveTurret.color.getHex()).not.toBe(liveHull.color.getHex());
  });

  it('tints a TEXTURED wreck\'s own clone of the bake, keeping the map and dropping the gloss', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: WRECK_CLIPS,
      deathRoot: { parts: ['hull_hull'] },
    });
    // The fixture authors no materials (a vehicle GLB carries none), so the
    // bake is installed here -- the same thing `GLTFLoader` would hand back
    // for a Meshy export, on BOTH nodes, because they share one glTF mesh.
    const map = new THREE.Texture();
    const bake = new THREE.MeshStandardMaterial({ map, roughness: 0.2, metalness: 1 });
    for (const mesh of meshesOf(gltf.scene)) mesh.material = bake;

    const template = buildVehicleMeshTemplate(gltf, 'mbt_lavi', true);
    const charred = byName(template.root, 'WRECK_hull_hull').material as THREE.MeshStandardMaterial;
    const live = byName(template.root, 'hull_hull').material as THREE.MeshStandardMaterial;

    expect(charred).not.toBe(live);
    expect(charred).not.toBe(bake);
    expect(charred.color.getHex()).toBe(CHARRED_TINT_HEX);
    expect(charred.roughness).toBe(1);
    expect(charred.metalness).toBe(0);
    // The photograph survives the char -- one upload, two draws.
    expect(charred.map).toBe(map);
    // And the live twin is untouched by it: a clone, never a mutation.
    expect(live.color.getHex()).toBe(0xffffff);
  });

  it('puts every charred material in `materials` and every SHARED geometry in `geometries` exactly once', async () => {
    const template = await buildTemplate();
    const meshes = meshesOf(template.root);
    expect(meshes).toHaveLength(4); // two live, two wreck

    // Four DISTINCT materials here because the palette path mints a fresh
    // `rampMaterial` per mesh -- not because the list refuses to dedupe. The
    // invariant is one entry per distinct object, which the textured case
    // below exercises properly; what this pins is that a wreck never shares
    // its twin's material, which would char the living vehicle.
    expect(new Set(template.materials).size).toBe(template.materials.length);
    expect(template.materials).toHaveLength(4);
    for (const mesh of meshes) expect(template.materials).toContain(mesh.material as THREE.Material);
    expect(byName(template.root, 'WRECK_hull_hull').material).not.toBe(byName(template.root, 'hull_hull').material);

    // Break check: `addGeometry` -> `geometries.push`. This reads 4 and goes
    // red. `GLTFLoader` gives two nodes over one glTF mesh two `THREE.Mesh`
    // objects sharing ONE `BufferGeometry`, so the un-deduped list disposes
    // the same object twice. (This fixture reuses one accessor set across
    // every part, which `GLTFLoader` also caches, so all FOUR meshes here
    // land on a single geometry -- a stronger version of the same sharing,
    // not a weaker one.)
    expect(template.geometries).toHaveLength(1);
    expect(new Set(template.geometries).size).toBe(template.geometries.length);
    for (const mesh of meshes) expect(template.geometries).toContain(mesh.geometry);
    expect(byName(template.root, 'WRECK_hull_hull').geometry).toBe(byName(template.root, 'hull_hull').geometry);
  });

  it('holds ONE entry per distinct material when four meshes share one bake, and disposes each exactly once', async () => {
    // The shipped shape this exists for: `mbt_lavi.glb`'s four live meshes
    // all reference glTF material 0, so `GLTFLoader` builds ONE
    // `THREE.Material` for the lot and `texturedMaterial` hands that same
    // object back. Before the dedup, `materials` held it four times and
    // `disposeVehicleMeshTemplate` disposed it four times -- the exact defect
    // `addGeometry` was added to prevent, on the other axis. The palette
    // fixtures above cannot see it, because `rampMaterial` allocates.
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'hull_hull', extrasRole: 'hull' },
        { nodeName: 'turret_metal', extrasRole: 'metal' },
      ],
      clipNames: WRECK_CLIPS,
      deathRoot: { parts: ['hull_hull', 'turret_metal'] },
    });
    const bake = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    for (const mesh of meshesOf(gltf.scene)) mesh.material = bake; // all four, one object

    const template = buildVehicleMeshTemplate(gltf, 'mbt_lavi', true);
    expect(meshesOf(template.root)).toHaveLength(4);

    // Break check: `addMaterial` -> `materials.push`. This reads 4 and goes
    // red, and so does the disposal count below.
    expect(template.materials).toHaveLength(2);
    expect(new Set(template.materials).size).toBe(2);

    const live = byName(template.root, 'hull_hull').material as THREE.Material;
    const charred = byName(template.root, 'WRECK_hull_hull').material as THREE.Material;
    expect(live).toBe(bake); // `texturedMaterial` normalises in place
    expect(charred).not.toBe(bake);
    // Break check: drop the `charredFor` memo and call
    // `charredTexturedMaterial` directly. Both wreck meshes then get their
    // own byte-identical clone, `materials` reads 3, and this goes red.
    expect(byName(template.root, 'WRECK_turret_metal').material).toBe(charred);
    expect(byName(template.root, 'turret_metal').material).toBe(bake);
    expect(new Set(template.materials)).toEqual(new Set([live, charred]));

    const liveSpy = vi.spyOn(live, 'dispose');
    const charredSpy = vi.spyOn(charred, 'dispose');
    disposeVehicleMeshTemplate(template);
    expect(liveSpy).toHaveBeenCalledTimes(1);
    expect(charredSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps a wreck part in its twin\'s render-order band, shadows and all', async () => {
    const template = await buildTemplate();
    // Break check: drop the `WRECK_` strip in `renderOrderForPart`. The
    // wreck turret then falls through to the hull band and this goes red.
    expect(byName(template.root, 'WRECK_turret_metal').renderOrder).toBe(
      byName(template.root, 'turret_metal').renderOrder
    );
    expect(byName(template.root, 'WRECK_hull_hull').renderOrder).toBe(byName(template.root, 'hull_hull').renderOrder);
    expect(byName(template.root, 'WRECK_turret_metal').renderOrder).not.toBe(
      byName(template.root, 'WRECK_hull_hull').renderOrder
    );
    for (const name of ['WRECK_hull_hull', 'WRECK_turret_metal']) {
      expect(byName(template.root, name).castShadow).toBe(true);
      expect(byName(template.root, name).receiveShadow).toBe(true);
    }
  });

  it('hides the death root on the TEMPLATE, so every clone inherits it -- a scale-0 mesh is still submitted', async () => {
    const template = await buildTemplate();
    const deathRoot = template.root.getObjectByName(VEHICLE_DEATH_ROOT_NAME);
    // Break check: delete `o.visible = false` in the death-root branch.
    // Both of these read `true` and go red -- and the cost is real: three.js
    // culls on a bounding sphere that collapses to a point at the vehicle's
    // own position, which is in frustum, so the wreck meshes would be
    // submitted every frame of a living vehicle's life.
    expect(deathRoot?.visible).toBe(false);
    const entity = instantiateVehicleMesh(template, 'mbt_lavi');
    expect(entity.deathRoot?.visible).toBe(false);
  });
});

describe('instantiateVehicleMesh, with a death root', () => {
  it('splits the clone\'s scene roots into liveTop and deathRoot', async () => {
    const entity = instantiateVehicleMesh(await buildTemplate(), 'mbt_lavi');
    expect(entity.deathRoot?.name).toBe(VEHICLE_DEATH_ROOT_NAME);
    expect(entity.liveTop).toHaveLength(2); // hull + turret_pivot-less turret part
    expect(entity.liveTop).not.toContain(entity.deathRoot);
    // The clone's OWN nodes, never the template's -- the same rule
    // `turretPivot` follows.
    const template = await buildTemplate();
    const other = instantiateVehicleMesh(template, 'mbt_lavi');
    expect(other.deathRoot).not.toBe(entity.deathRoot);
  });

  it('leaves both null/empty-of-a-death-root for a GLB the wreck pass never ran on', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
    const entity = instantiateVehicleMesh(buildVehicleMeshTemplate(gltf, 'mbt_lavi'), 'mbt_lavi');
    expect(entity.deathRoot).toBeNull();
    expect(entity.liveTop).toHaveLength(1);
  });
});

// --- (b) the sequence ------------------------------------------------------

describe('beginVehicleDeath', () => {
  it('WARNS and returns null for an entity cloned from a different template -- never throws, this runs inside frame()', async () => {
    const withWreck = await buildTemplate();
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
    const clipless = buildVehicleMeshTemplate(gltf, 'mbt_lavi');
    const entity = instantiateVehicleMesh(clipless, 'mbt_lavi');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Break check: put the `throw new Error(...)` back. `toBeNull` goes red,
    // and so does the renderer wiring test that drives the same path through
    // `updateVehicleMeshes` -- which is the point: an exception raised there
    // does not report a bad template, it stops the frame loop and the screen
    // with it.
    expect(beginVehicleDeath(entity, 1, withWreck)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/cloned from a different template/);
    // And nothing was started: no fade clone was installed on the entity.
    expect((byName(entity.root, 'hull_hull').material as THREE.Material).transparent).toBe(false);
    warn.mockRestore();
  });

  it('swaps in transparent fade clones without touching the shared template materials', async () => {
    const template = await buildTemplate();
    const entity = instantiateVehicleMesh(template, 'mbt_lavi');
    const shared = byName(entity.root, 'hull_hull').material as THREE.Material;
    const d = mustBegin(entity, 1, template);
    const installed = byName(entity.root, 'hull_hull').material as THREE.Material;
    expect(installed).not.toBe(shared);
    expect(installed.transparent).toBe(true);
    expect(shared.transparent).toBe(false);
    expect(d.swaps.length).toBe(meshesOf(entity.root).length);
  });
});

describe('stepVehicleDeath', () => {
  it('reports "fading" through the whole window, then settles into a MeshWreck whose root is the entity root', async () => {
    const template = await buildTemplate();
    const entity = instantiateVehicleMesh(template, 'mbt_lavi');
    entity.root.position.set(4, 7, 6);
    const env = makeEnv();
    env.scene.add(entity.root);
    const d = mustBegin(entity, 3, template);

    // Every frame inside the fade window is still `'fading'`, and the body
    // sinks rather than jumping.
    expect(stepVehicleDeath(d, MESH_DEATH_SECONDS / 2, env)).toBe('fading');
    expect(d.settling).toBe(false);
    expect(entity.root.position.y).toBeLessThan(7);

    const result = runToCompletion(d, env);
    expect(result).not.toBe('removed');
    expect(result).not.toBe('fading');
    const wreck = result as MeshWreck;
    expect(wreck.root).toBe(entity.root);
    expect(wreck.x).toBe(4);
    expect(wreck.y).toBe(6);
    expect(wreck.shown).toBe(true);
    // Still in the scene -- a wreck persists; and back at ground level
    // rather than at the sunk death position, matching `addWreck`.
    expect(env.scene.children).toContain(entity.root);
    expect(entity.root.position.y).toBe(0);
  });

  it('after the clip: the live nodes are at scale 0 AND hidden, the death root is at scale 1 and visible', async () => {
    const template = await buildTemplate();
    const entity = instantiateVehicleMesh(template, 'mbt_lavi');
    const env = makeEnv();
    env.scene.add(entity.root);
    applyMeshClip(entity, 'idle');

    const d = mustBegin(entity, 3, template);
    runToCompletion(d, env);

    for (const node of entity.liveTop) {
      expect(node.scale.x).toBe(0);
      // Break check: delete the `node.visible = false` loop in the settle
      // branch. This reads `true` and goes red -- and a scale-0 mesh is
      // still submitted, which is the whole reason the line exists.
      expect(node.visible).toBe(false);
    }
    expect(entity.deathRoot?.scale.x).toBe(1);
    // Break check: delete `deathRoot.visible = true`. This reads `false`,
    // and the wreck is invisible forever.
    expect(entity.deathRoot?.visible).toBe(true);
  });

  it('submits the LIVE meshes while alive and the WRECK meshes after -- never both, never four', async () => {
    const template = await buildTemplate();
    const entity = instantiateVehicleMesh(template, 'mbt_lavi');
    const env = makeEnv();
    env.scene.add(entity.root);
    applyMeshClip(entity, 'idle');
    entity.mixer?.update(1 / 60);

    // Alive: two draw calls, both live. Break check: delete
    // `o.visible = false` in `mesh-vehicle.ts`'s death-root branch and this
    // reads FOUR -- two of them scale-0 meshes that rasterise nothing, per
    // vehicle, every frame.
    const alive = submittedMeshes(entity.root);
    expect(alive.map((m) => m.name).sort()).toEqual(['hull_hull', 'turret_metal']);

    runToCompletion(mustBegin(entity, 3, template), env);

    // Dead: two draw calls again, both wreck. Break check: delete the
    // `node.visible = false` loop in `stepVehicleDeath`'s settle branch and
    // this reads four, because the live nodes are only scale-0.
    const dead = submittedMeshes(entity.root);
    expect(dead.map((m) => m.name).sort()).toEqual(['WRECK_hull_hull', 'WRECK_turret_metal']);
  });

  it('restores the shared materials before the wreck is shown -- a wreck draws at full opacity', async () => {
    const template = await buildTemplate();
    const entity = instantiateVehicleMesh(template, 'mbt_lavi');
    const env = makeEnv();
    env.scene.add(entity.root);
    const shared = byName(entity.root, 'WRECK_hull_hull').material as THREE.Material;
    const d = mustBegin(entity, 3, template);
    runToCompletion(d, env);
    expect(byName(entity.root, 'WRECK_hull_hull').material).toBe(shared);
    expect(template.materials).toContain(byName(entity.root, 'WRECK_hull_hull').material as THREE.Material);
  });

  it('does NOT uncache the mixer -- restoring original state would put the intact vehicle back on top of its own wreck', async () => {
    const template = await buildTemplate();
    const entity = instantiateVehicleMesh(template, 'mbt_lavi');
    const env = makeEnv();
    env.scene.add(entity.root);
    const d = mustBegin(entity, 3, template);
    runToCompletion(d, env);

    expect(entity.liveTop[0].scale.x).toBe(0);
    // The hazard, demonstrated rather than asserted about: doing what the
    // skinned path measured as wrong (`mesh-death.ts:334-359`) snaps every
    // bound `.scale` back to the value captured at `clipAction` time -- 1 on
    // the live nodes AND 1 on the death root, i.e. the whole intact vehicle
    // standing inside its own wreck. `visible = false` is what would still
    // save the picture here, but the mixer is left alone regardless.
    entity.mixer?.stopAllAction();
    entity.mixer?.uncacheRoot(entity.root);
    expect(entity.liveTop[0].scale.x).toBe(1);
    expect(entity.liveTop[0].visible).toBe(false);
  });

  it('removes and disposes a vehicle with no wreck clip once the fade closes -- today\'s behaviour, minus the abruptness', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['idle'],
    });
    const template = buildVehicleMeshTemplate(gltf, 'mbt_lavi');
    const entity = instantiateVehicleMesh(template, 'mbt_lavi');
    const env = makeEnv();
    env.scene.add(entity.root);

    const d = mustBegin(entity, 3, template);
    expect(runToCompletion(d, env)).toBe('removed');
    expect(env.scene.children).not.toContain(entity.root);
    expect(entity.actions.get('idle')?.isRunning()).toBe(false);
  });

  it('gates the finished wreck on fog, and the reveal latches one way', async () => {
    const template = await buildTemplate();
    const entity = instantiateVehicleMesh(template, 'mbt_lavi');
    entity.root.position.set(2, 0, 3);
    let explored = false;
    const env = makeEnv({ isExplored: () => explored });
    env.scene.add(entity.root);

    const wreck = runToCompletion(mustBegin(entity, 3, template), env) as MeshWreck;
    expect(wreck.shown).toBe(false);
    expect(entity.root.visible).toBe(false);

    explored = true;
    updateMeshWrecks([wreck], () => explored);
    expect(wreck.shown).toBe(true);
    expect(entity.root.visible).toBe(true);

    explored = false;
    updateMeshWrecks([wreck], () => explored);
    expect(wreck.shown).toBe(true); // never goes back to false
  });
});

// --- (c) the cap -----------------------------------------------------------

describe('pushMeshWreck, over vehicle wrecks', () => {
  it('evicts the oldest past MAX_MESH_WRECKS, removing it from the scene', () => {
    const scene = new THREE.Scene();
    const wrecks: MeshWreck[] = [];
    const roots: THREE.Object3D[] = [];
    for (let i = 0; i < MAX_MESH_WRECKS + 2; i++) {
      const root = new THREE.Mesh(new THREE.BufferGeometry(), rampMaterial(CHARRED_RAMP));
      roots.push(root);
      scene.add(root);
      pushMeshWreck(wrecks, { root, x: i, y: 0, shown: true }, scene);
    }
    expect(wrecks).toHaveLength(MAX_MESH_WRECKS);
    expect(wrecks[0].x).toBe(2); // the first two fell off the front
    expect(scene.children).not.toContain(roots[0]);
    expect(scene.children).toContain(roots[roots.length - 1]);
  });
});

// --- the entity the whole thing runs on ------------------------------------

describe('a dying vehicle does not disturb a living one of the same type', () => {
  it('fades and chars only its own clone', async () => {
    const template = await buildTemplate();
    const dyingEntity: VehicleMeshEntity = instantiateVehicleMesh(template, 'mbt_lavi');
    const livingEntity: VehicleMeshEntity = instantiateVehicleMesh(template, 'mbt_lavi');
    const env = makeEnv();
    env.scene.add(dyingEntity.root, livingEntity.root);
    applyMeshClip(livingEntity, 'idle');
    livingEntity.mixer?.update(1 / 60);

    runToCompletion(mustBegin(dyingEntity, 3, template), env);

    expect(livingEntity.deathRoot?.visible).toBe(false);
    expect(livingEntity.liveTop[0].visible).toBe(true);
    expect(livingEntity.liveTop[0].scale.x).toBe(1);
    expect((byName(livingEntity.root, 'hull_hull').material as THREE.Material).transparent).toBe(false);
  });
});
