/**
 * The GLB does not exist on disk when this was written -- the exporter is a
 * parallel stream targeting the same contract (`docs/superpowers/specs/
 * 2026-08-28-mesh-unit-contract.md`). `buildFixtureGlb` below hand-authors a
 * minimal binary glTF (real GLB byte framing -- header, JSON chunk, BIN
 * chunk, per the glTF 2.0 spec) satisfying that contract: one role, one
 * clip, two bones, real skinning. It is parsed by the SAME `GLTFLoader`
 * production code uses (`GLTFLoader.parse`, called on a real `ArrayBuffer`,
 * not a synthetic in-memory scene graph built by hand) -- so these tests
 * exercise the actual parser, not a stand-in for it.
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
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  buildMeshUnitTemplate,
  instantiateMeshUnit,
  applyMeshClip,
  disposeMeshUnitEntity,
  disposeMeshUnitTemplate,
} from './mesh-unit';
import { MESH_SCALE } from './mesh-anim';
import { HULL_RENDER_ORDER, TURRET_RENDER_ORDER } from './render-order';

// --- fixture: a minimal, hand-authored binary glTF (GLB) --------------------

const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'
const BIN_CHUNK_TYPE = 0x004e4942; // 'BIN\0'

/** Concatenates typed-array byte views into one `Uint8Array`, returning both
 *  the bytes and each input's byte offset/length within it -- exactly what a
 *  glTF `bufferViews` array needs, and simple because (per `loadBufferView`
 *  in `GLTFLoader.js`) each bufferView is `ArrayBuffer.slice`d into its own
 *  fresh buffer before any accessor reads it, so nothing here needs 4-byte
 *  alignment between segments -- only the OUTER GLB chunk lengths do. */
function packBufferViews(parts: readonly Uint8Array[]): { bytes: Uint8Array; views: { byteOffset: number; byteLength: number }[] } {
  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  const views: { byteOffset: number; byteLength: number }[] = [];
  let cursor = 0;
  for (const part of parts) {
    bytes.set(part, cursor);
    views.push({ byteOffset: cursor, byteLength: part.byteLength });
    cursor += part.byteLength;
  }
  return { bytes, views };
}

function f32(nums: readonly number[]): Uint8Array {
  return new Uint8Array(Float32Array.from(nums).buffer);
}

function u16(nums: readonly number[]): Uint8Array {
  return new Uint8Array(Uint16Array.from(nums).buffer);
}

/** Pads `bytes` up to a multiple of 4, with `pad` as the fill byte -- the
 *  glTF-Binary spec's own chunk-alignment rule (`BINARY_EXTENSION_HEADER_
 *  LENGTH` + chunk framing in `GLTFLoader.js`'s `GLTFBinaryExtension`). */
function pad4(bytes: Uint8Array, pad: number): Uint8Array {
  const rem = bytes.byteLength % 4;
  if (rem === 0) return bytes;
  const out = new Uint8Array(bytes.byteLength + (4 - rem));
  out.set(bytes);
  out.fill(pad, bytes.byteLength);
  return out;
}

/**
 * Packs a `{ json, bin }` pair into a real binary GLB `ArrayBuffer`, using
 * the exact chunk framing `GLTFLoader.js`'s `GLTFBinaryExtension` parses:
 * 12-byte header (`glTF` magic, version, total length), then a JSON chunk
 * (space-padded to 4 bytes), then a BIN chunk (zero-padded to 4 bytes).
 */
function packGlb(json: unknown, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = pad4(bin, 0x00);

  const total = 12 + 8 + jsonBytes.byteLength + 8 + binBytes.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);

  dv.setUint32(0, 0x46546c67, true); // little-endian so the raw bytes spell 'g','l','T','F'
  dv.setUint32(4, 2, true); // version
  dv.setUint32(8, total, true); // total length

  let o = 12;
  dv.setUint32(o, jsonBytes.byteLength, true);
  dv.setUint32(o + 4, JSON_CHUNK_TYPE, true);
  out.set(jsonBytes, o + 8);
  o += 8 + jsonBytes.byteLength;

  dv.setUint32(o, binBytes.byteLength, true);
  dv.setUint32(o + 4, BIN_CHUNK_TYPE, true);
  out.set(binBytes, o + 8);

  return out.buffer;
}

/**
 * A minimal, valid, skinned, single-triangle glTF: two bones (a root and a
 * child offset +1 on Y), one `SkinnedMesh` node named `roleName` (carrying
 * `extras.rl_role = roleName` too, matching the contract's deliberate
 * redundancy -- `withExtras` lets a test omit one half to prove the other
 * half alone still works), fully weighted to the child bone, and one
 * animation clip named `clipName` rotating that bone 90° about X between
 * t=0 and t=1.
 *
 * Bind math (so the deformation is actually correct, not merely
 * non-throwing): full weight on bone1, whose bind-pose world matrix is
 * `translate(0,1,0)`, so its inverse bind matrix is `translate(0,-1,0)`.
 * Skinned position = `boneWorld * inverseBind * bindPosition`, which is
 * exactly "rotate the local offset from the bone's own pivot, then
 * translate back" -- the pivot rotation this fixture's tests check for.
 */
function buildFixtureGlb(opts: {
  roleName: string;
  /** One or more animation names -- each gets its own `animations[]` entry,
   *  all sharing the same sampler/accessor data (fine for exercising clip
   *  wiring; the point is which NAME is reachable, not distinct motion per
   *  clip). A single string is shorthand for `[clipName]`. */
  clipName: string | string[];
  extrasRole?: string | null;
  nameRole?: string | null;
}): ArrayBuffer {
  const extrasRole = opts.extrasRole === undefined ? opts.roleName : opts.extrasRole;
  const nameRole = opts.nameRole === undefined ? opts.roleName : opts.nameRole;
  const clipNames = Array.isArray(opts.clipName) ? opts.clipName : [opts.clipName];

  const position = f32([-0.1, 1, 0, 0.1, 1, 0, 0, 1, 0.2]);
  const normal = f32([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const joints = u16([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const weights = f32([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const indices = u16([0, 1, 2]);
  // Column-major mat4 x2: bone0 (root) identity, bone1 translate(0,-1,0).
  const inverseBind = f32([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1,
  ]);
  const animInput = f32([0, 1]);
  // Quaternion (x,y,z,w): identity, then 90 deg about X.
  const HALF = Math.SQRT1_2;
  const animOutput = f32([0, 0, 0, 1, HALF, 0, 0, HALF]);

  const { bytes, views } = packBufferViews([
    position,
    normal,
    joints,
    weights,
    indices,
    inverseBind,
    animInput,
    animOutput,
  ]);

  const bufferViews = views.map((v) => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength }));

  const accessors = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.1, 1, 0], max: [0.1, 1, 0.2] }, // 0 POSITION
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }, // 1 NORMAL
    { bufferView: 2, componentType: 5123, count: 3, type: 'VEC4' }, // 2 JOINTS_0
    { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' }, // 3 WEIGHTS_0
    { bufferView: 4, componentType: 5123, count: 3, type: 'SCALAR' }, // 4 indices
    { bufferView: 5, componentType: 5126, count: 2, type: 'MAT4' }, // 5 inverseBindMatrices
    { bufferView: 6, componentType: 5126, count: 2, type: 'SCALAR' }, // 6 anim input
    { bufferView: 7, componentType: 5126, count: 2, type: 'VEC4' }, // 7 anim output
  ];

  const nodeExtras: Record<string, unknown> = {};
  if (extrasRole !== null) nodeExtras.rl_role = extrasRole;

  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.byteLength }],
    bufferViews,
    accessors,
    meshes: [
      {
        name: 'fixture-mesh',
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, JOINTS_0: 2, WEIGHTS_0: 3 },
            indices: 4,
          },
        ],
      },
    ],
    skins: [{ joints: [0, 1], inverseBindMatrices: 5 }],
    nodes: [
      { name: 'root_joint', children: [1] },
      { name: 'bone1', translation: [0, 1, 0] },
      {
        name: nameRole ?? '',
        mesh: 0,
        skin: 0,
        ...(Object.keys(nodeExtras).length > 0 ? { extras: nodeExtras } : {}),
      },
    ],
    scenes: [{ nodes: [0, 2] }],
    scene: 0,
    animations: clipNames.map((name) => ({
      name,
      channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }],
      samplers: [{ input: 6, output: 7, interpolation: 'LINEAR' }],
    })),
  };

  return packGlb(json, bytes);
}

async function parseFixture(opts: Parameters<typeof buildFixtureGlb>[0]) {
  const glb = buildFixtureGlb(opts);
  return new GLTFLoader().parseAsync(glb, '');
}

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
    const template = buildMeshUnitTemplate(gltf);

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
    const template = buildMeshUnitTemplate(gltf);
    expect(template.materials).toHaveLength(1);
  });

  it('falls back to the node name when extras.rl_role is absent', async () => {
    // The contract: "The runtime reads extras and falls back to the name.
    // Either alone has failed once already in this project." This is the
    // half of that sentence a name-only mesh needs to keep working.
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move', extrasRole: null });
    const template = buildMeshUnitTemplate(gltf);
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
    expect(() => buildMeshUnitTemplate(gltf)).toThrow(/no ramp for rl_role turret_gun/);
  });

  // Break: change `if (!isMeshClipName(clip.name))` to `if (false)`.
  // Verified by hand -- this test then expects a throw and gets none,
  // going red, because an animation named e.g. "walk" would silently join
  // `template.clips` under a name `ClipName` never contains, and
  // `resolveClip`/`meshClipOrFallback` could never select it -- exactly
  // the "never played" failure mesh-unit-contract.md's clip section names.
  it('throws loudly for an animation clip name outside the ClipName union', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'walk' });
    expect(() => buildMeshUnitTemplate(gltf)).toThrow(/animation "walk" is not a recognised clip name/);
  });
});

describe('instantiateMeshUnit / applyMeshClip / mixer wiring', () => {
  it('clones are independent objects with independent skeletons -- not aliased to the template or each other', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf);
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
    const template = buildMeshUnitTemplate(gltf);
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
    const template = buildMeshUnitTemplate(gltf);
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
    const template = buildMeshUnitTemplate(gltf);
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
    const template = buildMeshUnitTemplate(gltf);
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
    const template = buildMeshUnitTemplate(gltf);
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
    const template = buildMeshUnitTemplate(gltf);
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
