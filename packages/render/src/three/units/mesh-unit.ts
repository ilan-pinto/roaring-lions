/**
 * Mesh units: the `SkinnedMesh` path `ThreeRenderer` draws beside billboard
 * units, additive and behind a flag -- nothing calls `loadMeshUnit` yet, so
 * until something does, every existing billboard type keeps drawing exactly
 * as before. Built against `docs/superpowers/specs/2026-08-28-mesh-unit-
 * contract.md`, the pinned contract the (parallel) export side targets, not
 * against any file on disk -- no `art/meshes/*.glb` exists at the time this
 * was written. See this task's own report for what stands in for one in
 * tests.
 *
 * Split like `units/structures.ts` and `units/instances.ts`: pure decision
 * logic (`mesh-role.ts`, `mesh-anim.ts`) above the `THREE.*` line, the
 * GPU-facing construction below it. Unlike `instances.ts`'s billboards,
 * `THREE.SkinnedMesh`/`THREE.AnimationMixer`/`GLTFLoader.parse` build real JS
 * objects that need no live `WebGLRenderer` -- `fog-mesh.ts`'s own top
 * comment established the precedent this module and its tests follow.
 *
 * ## One clone, one mixer, per living entity -- not instanced
 *
 * `docs/superpowers/specs/2026-08-26-three-renderer-design.md`'s "Technical
 * decisions" names a bone-matrix texture plus one `InstancedMesh` per unit
 * type as Phase F's EVENTUAL shape, for the reason its own spike measured:
 * a naive `SkinnedMesh`-plus-`AnimationMixer` per unit "only exceeds budget
 * past ~1200" units, and this task's own brief asks for none of that
 * optimisation -- only "load a GLB", "one material per role", "clip
 * selection", "AnimationMixer", "scale", "render order", "dispose". This
 * module is that naive, correct, first cut: one `SkeletonUtils.clone` and
 * one `AnimationMixer` per living entity of a mesh-enabled type, pooled by
 * entity id and torn down when the entity dies. Revisiting this for the
 * bone-texture/instancing shape is a later task's job, not a silent scope
 * expansion of this one.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ClipName } from '../../sheet';
import { toonRampSkinnedMaterial } from './mesh-material';
import { isMeshRole, rampForRole, type MeshFaction } from './mesh-role';
import { isMeshClipName, meshClipOrFallback, MESH_SCALE } from './mesh-anim';
import { HULL_RENDER_ORDER } from './render-order';

/**
 * One loaded `art/meshes/<team_id>.glb`, kept as a clone source -- `root` is
 * never added to a scene directly, only ever passed to `SkeletonUtils.clone`
 * (`instantiateMeshUnit` below). `materials`/`geometries` are the template's
 * OWN resources, shared by reference across every clone
 * (`THREE.Object3D.clone`'s own contract: transforms and children are
 * copied, `.geometry`/`.material` are not) -- so they are disposed exactly
 * once, here, never per-clone. Disposing a clone's own `.geometry`/
 * `.material` would be disposing a resource every OTHER live clone of the
 * same type still points at.
 */
export interface MeshUnitTemplate {
  readonly root: THREE.Object3D;
  readonly clips: ReadonlyMap<ClipName, THREE.AnimationClip>;
  readonly materials: readonly THREE.Material[];
  readonly geometries: readonly THREE.BufferGeometry[];
}

/**
 * Assembles a `MeshUnitTemplate` from an already-parsed `GLTF` result --
 * decoupled from `GLTFLoader` itself (`loadMeshUnitTemplate` below owns the
 * fetch) so this half, the actual contract-reading logic, is exercised
 * directly against a hand-authored fixture in tests with no network and no
 * `WebGLRenderer`. Typed against the two fields it reads rather than the
 * full `GLTF` interface, so a test fixture needs to supply only `scene` and
 * `animations`.
 *
 * Walks every mesh in the loaded scene, resolving its role from
 * `extras.rl_role`, falling back to the node/mesh name -- the contract's own
 * "either alone has failed once already in this project" line, and the
 * reason both are read here rather than just one. An unmapped role is
 * collected and reported ONCE, listing every offender, rather than thrown on
 * the first -- matching the spike's own `rig-scene.ts` precedent -- and an
 * unrecognised animation clip name fails the same way `mesh-unit-
 * contract.md` demands: "a clip present under any other name is a failure."
 *
 * `root.scale` is set to `MESH_SCALE` here, once, on the template -- not
 * per-clone -- because `SkeletonUtils.clone` copies whatever `.scale` the
 * source object already has, so every future clone inherits it for free.
 */
export function buildMeshUnitTemplate(
  gltf: Pick<GLTF, 'scene' | 'animations'>,
  faction: MeshFaction
): MeshUnitTemplate {
  const root = gltf.scene;
  root.scale.setScalar(MESH_SCALE);

  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const unmapped = new Set<string>();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const extrasRole = (mesh.userData as { rl_role?: unknown }).rl_role;
    const role = typeof extrasRole === 'string' && extrasRole.length > 0 ? extrasRole : mesh.name;
    if (!isMeshRole(role)) {
      unmapped.add(role || '(unnamed mesh)');
      return;
    }
    const mat = toonRampSkinnedMaterial(rampForRole(role, faction));
    mesh.material = mat;
    mesh.renderOrder = HULL_RENDER_ORDER;
    materials.push(mat);
    geometries.push(mesh.geometry);
  });

  if (unmapped.size > 0) {
    throw new Error(`mesh-unit: no ramp for rl_role ${[...unmapped].join(', ')}`);
  }

  const clips = new Map<ClipName, THREE.AnimationClip>();
  for (const clip of gltf.animations) {
    if (!isMeshClipName(clip.name)) {
      throw new Error(
        `mesh-unit: animation "${clip.name}" is not a recognised clip name (mesh-unit-contract.md)`
      );
    }
    clips.set(clip.name, clip);
  }

  return { root, clips, materials, geometries };
}

/**
 * Fetches and parses `glbUrl`, then builds a `MeshUnitTemplate` from it --
 * the network half `buildMeshUnitTemplate` deliberately does not own. Mirrors
 * the spike's own `new GLTFLoader().loadAsync(glbUrl)` call
 * (`spike/rig-scene.ts`).
 */
export async function loadMeshUnitTemplate(
  glbUrl: string,
  faction: MeshFaction
): Promise<MeshUnitTemplate> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  return buildMeshUnitTemplate(gltf, faction);
}

/** One living entity's mesh instance: an independent clone (own skeleton,
 *  own bones -- `SkeletonUtils.clone`'s whole point) driven by its own
 *  `AnimationMixer` on real frame time, never sim time (invariant 1). */
export interface MeshUnitEntity {
  readonly typeId: string;
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: ReadonlyMap<ClipName, THREE.AnimationAction>;
  currentClip: ClipName | null;
}

/**
 * Clones `template.root` (`SkeletonUtils.clone`, NOT `Object3D.clone` --
 * three.js's plain clone shares one `Skeleton`/one set of `Bone`s across
 * every clone, so two entities animating at different clip phases would
 * fight over the same bones; `SkeletonUtils.clone` gives each clone its own
 * skeleton, cloned from the template's, with bones remapped 1:1 --
 * `mesh-unit.test.ts` asserts this directly rather than trusting the three.js
 * changelog), builds one `AnimationMixer` bound to the clone, and one
 * `AnimationAction` per clip the template's GLB declared.
 *
 * `renderOrder` is set again here (`buildMeshUnitTemplate` already set it on
 * the TEMPLATE's own meshes) because `SkeletonUtils.clone` clones each mesh's
 * OWN properties, `renderOrder` included -- so this second pass is belt and
 * braces, not strictly needed, but the cost of asserting it directly on the
 * object this module actually adds to a scene is one `traverse` call, and
 * "read `render-order.ts` before setting any `renderOrder`" is cheaper to
 * honour twice than to get wrong once.
 */
export function instantiateMeshUnit(template: MeshUnitTemplate, typeId: string): MeshUnitEntity {
  const root = cloneSkinned(template.root);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.renderOrder = HULL_RENDER_ORDER;
  });

  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<ClipName, THREE.AnimationAction>();
  for (const [name, clip] of template.clips) {
    actions.set(name, mixer.clipAction(clip));
  }

  return { typeId, root, mixer, actions, currentClip: null };
}

/**
 * Switches `entity` to `desired`, falling back to `idle` through
 * `meshClipOrFallback` exactly as `sheet.ts`'s `clipOrFallback` does for
 * sprite sheets. A no-op when the resolved clip is already playing -- so a
 * unit holding `idle` for seconds does not `reset().play()` itself every
 * single frame, which would restart its own loop constantly. Stops every
 * OTHER action rather than crossfading: a simple, deterministic switch,
 * matching the spike's own `applyClip` (`spike/rig-scene.ts`).
 *
 * `opts.once`, added for `units/mesh-death.ts`: `idle`/`move`/`fire`/`work`
 * are never passed it and keep three.js's own default -- `LoopRepeat`,
 * looping forever, exactly as before this option existed. `false`/omitted
 * still sets that default EXPLICITLY (`setLoop(LoopRepeat, Infinity)`,
 * `clampWhenFinished = false`) rather than merely leaving whatever the
 * action already had, so a clip that was ONCE played with `once: true` and
 * is later re-selected without it (not exercised by any caller today, but
 * not ruled out either) cannot inherit a stale one-shot setting.
 *
 * `once: true` is `THREE.LoopOnce` + `clampWhenFinished = true`: the action
 * plays exactly once and then HOLDS its own last frame, driven entirely by
 * three.js's own mixer -- no caller has to guess a duration or freeze
 * anything by hand. This exists because of a real, previously-unfixed
 * limitation the death-fade work surfaced: without it, EVERY clip played
 * through this function loops forever, so an authored one-way transition
 * (stand -> collapse, or a real animated collapse -> wreck pose) would
 * replay from its start every time it reached its end -- a visible
 * flip-flop, not a hold. `art/meshes/*.glb`'s `down`/`wreck` clips ship
 * static today specifically to route around that gap (their own root/
 * death_root bone-scale swap is constant across the clip, so looping it is
 * harmless by accident, not by design) -- `once: true` removes the
 * constraint for good, so a future animated collapse clip is safe to author
 * without this function changing again.
 */
export function applyMeshClip(entity: MeshUnitEntity, desired: ClipName, opts?: { once?: boolean }): void {
  const available = new Set(entity.actions.keys());
  const resolved = meshClipOrFallback(available, desired);
  if (entity.currentClip === resolved) return;
  const next = entity.actions.get(resolved);
  if (!next) return; // No idle clip either -- nothing to play. Matches the
  // "no mesh units" leniency ThreeRenderer already applies to a billboard
  // type with no loaded sheet: draw nothing rather than fabricate a pose.
  for (const [name, action] of entity.actions) {
    if (name !== resolved) action.stop();
  }
  if (opts?.once) {
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
  } else {
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
  }
  next.reset().play();
  entity.currentClip = resolved;
}

/** Releases everything a `MeshUnitEntity` owns for itself -- its mixer's
 *  actions. Its `root`'s meshes share the TEMPLATE's geometries/materials
 *  (see `MeshUnitTemplate`'s own doc comment) and must not be disposed here;
 *  only `disposeMeshUnitTemplate` (below) owns those. */
export function disposeMeshUnitEntity(entity: MeshUnitEntity): void {
  entity.mixer.stopAllAction();
  entity.mixer.uncacheRoot(entity.root);
}

/** Releases a template's own owned resources -- every clone made from it
 *  must already be torn down (`disposeMeshUnitEntity`) and removed from the
 *  scene before this runs, since they share these exact objects by
 *  reference. */
export function disposeMeshUnitTemplate(template: MeshUnitTemplate): void {
  for (const material of template.materials) material.dispose();
  for (const geometry of template.geometries) geometry.dispose();
}
