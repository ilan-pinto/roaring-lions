/**
 * Shared GLB test fixture for the two RIGID mesh classes (vehicles,
 * buildings) -- the non-skinned counterpart of `mesh-fixture.ts`'s own
 * skinned fixture, and built the identical way for the identical reason
 * (that file's own top comment): a real, minimal binary glTF, parsed with
 * the SAME `GLTFLoader` production code uses, never a synthetic in-memory
 * scene graph or a mock.
 *
 * Simpler than `mesh-fixture.ts` throughout: no skin, no joints/weights, and
 * -- unless `clipNames` asks for them -- no animations either, which is
 * exactly what `mesh-unit-contract.md` v2 pins for buildings ("no armature,
 * no skin, no clips"). It was also what every shipped VEHICLE carried until
 * 2026-09-15; the wreck pass gave all eleven `idle` and `wreck`, so the
 * clipless shape below is now a fixture-only case -- which is the point of
 * keeping it, since `&nomesh` and any un-passed re-export still land on it
 * and no shipped file exercises it any more. `clipNames` was written before
 * any asset shipped a clip, so that the engine half of that path
 * (`mesh-vehicle.ts`) could be exercised first rather than arriving with the
 * art. One shared triangle's `POSITION`/`NORMAL`/
 * indices accessors are reused across every mesh node the caller asks for --
 * legal glTF (multiple meshes may reference the same accessor), and there is
 * nothing about role/pivot resolution that depends on distinct geometry.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'
const BIN_CHUNK_TYPE = 0x004e4942; // 'BIN\0'

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

function pad4(bytes: Uint8Array, pad: number): Uint8Array {
  const rem = bytes.byteLength % 4;
  if (rem === 0) return bytes;
  const out = new Uint8Array(bytes.byteLength + (4 - rem));
  out.set(bytes);
  out.fill(pad, bytes.byteLength);
  return out;
}

function packGlb(json: unknown, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = pad4(bin, 0x00);

  const total = 12 + 8 + jsonBytes.byteLength + 8 + binBytes.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);

  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);

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

export interface RigidFixturePart {
  /** The node/mesh name -- read as `rl_role`'s fallback per the contract. */
  nodeName: string;
  /** `extras.rl_role`, or `null` to omit it entirely (exercising the
   *  name-only fallback), or `undefined` to default to `nodeName`. */
  extrasRole?: string | null;
}

export interface RigidFixtureOpts {
  parts: RigidFixturePart[];
  /** When set, adds a `turret_pivot`-shaped node (named `pivotName`,
   *  carrying `extras.rl_pivot = 'turret'`) whose children are every part
   *  node listed in `pivotChildren` (by index into `parts`) -- everything
   *  else stays a scene-root sibling, exactly like the real vehicle GLBs
   *  this fixture stands in for. */
  pivot?: { pivotName: string; pivotChildren: number[] };
  /**
   * Animation clip names, each becoming its own `animations[]` entry,
   * rotating a part node 90 degrees about X between t=0 and t=1. The
   * animated target is a plain part NODE rather than a bone, because a
   * vehicle GLB carries no skin at all.
   *
   * The Nth clip animates the Nth part node, wrapping when there are fewer
   * parts than clips. That indirection exists so a test can tell WHICH clip
   * is playing by which node moved -- `mesh-fixture.ts`'s own `clipName`
   * option points every clip at one shared sampler ("the point is which
   * NAME is reachable, not distinct motion per clip"), which cannot
   * distinguish `applyMeshClip` selecting `work` from it selecting `idle`,
   * and a test that cannot tell those apart is not testing clip selection.
   * Give it as many parts as clips to get one distinct motion each.
   *
   * OMITTING this is the case NO shipped `art/meshes/vehicles/*.glb` is in
   * any more -- all eleven declare `idle` and `wreck` since the wreck pass
   * (2026-09-15) -- so it is reachable only through `&nomesh` and an
   * un-passed re-export. When it is omitted this fixture emits NO
   * `animations` key and no extra accessors, so the bytes are identical to
   * what it produced before clips existed.
   *
   * With `deathRoot` set, `idle` and `wreck` stop being rotation clips and
   * become the wreck pass's own constant SCALE clips instead (see that
   * option's doc comment); every other name keeps the rotation channel
   * described above.
   */
  clipNames?: readonly string[];
  /**
   * The wreck half of the vehicle asset contract (spec §4.1), as
   * `tools/src/meshes/wreck-pass.ts` actually writes it: one extra top-level
   * node `death_root`, holding one `WRECK_<part>` child per NAMED part that
   * references the SAME `mesh` index its live twin does and carries that
   * twin's extras plus `rl_wreck: true`.
   *
   * Sharing the mesh index rather than emitting a second one is the whole
   * point of the real pass (an eleven-file, 25 MB art tree could not afford
   * duplicated geometry), and it is what makes the runtime's own
   * bookkeeping interesting: `GLTFLoader` hands back two distinct
   * `THREE.Mesh` objects that share one `BufferGeometry`, which is exactly
   * the case `buildVehicleMeshTemplate` has to dedupe.
   *
   * The two clips are emitted only when `clipNames` contains BOTH `idle` and
   * `wreck`, because the contract is the pair: `idle` keys every top-level
   * live node's scale to 1 and `death_root`'s to 0, `wreck` the reverse,
   * both as two-keyframe STEP channels. A `deathRoot` with no such clip
   * names is still legal here and emits the nodes alone -- the shape a GLB
   * would have if the pass ran and the clip half were dropped.
   */
  deathRoot?: { parts: string[] };
}

/** The wreck pass's own node name and child prefix, restated here rather
 *  than imported from `tools/` (a `packages/render` test may not reach into
 *  the tools tree). `mesh-vehicle.test.ts` pins them against
 *  `VEHICLE_DEATH_ROOT_NAME`, the runtime's own copy. */
const FIXTURE_DEATH_ROOT = 'death_root';
const FIXTURE_WRECK_PREFIX = 'WRECK_';
/** The wreck clips' second keyframe time -- `wreck-pass.ts`'s own
 *  `CLIP_SECONDS`. Short enough that nothing reads a held pose as an
 *  animated collapse. */
const FIXTURE_CLIP_SECONDS = 0.1;

export function buildRigidFixtureGlb(opts: RigidFixtureOpts): ArrayBuffer {
  const position = f32([-0.1, 0, 0, 0.1, 0, 0, 0, 0, 0.2]);
  const normal = f32([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const indices = u16([0, 1, 2]);
  const clipNames = opts.clipNames ?? [];
  // The wreck pass writes the two clips as a PAIR or not at all, so the
  // fixture emits them the same way -- a lone `wreck` with no `idle` is not
  // a shape any asset can be in.
  const wreckClips =
    opts.deathRoot !== undefined && clipNames.includes('idle') && clipNames.includes('wreck');
  // Quaternion (x,y,z,w) keys: identity at t=0, 90 deg about X at t=1 --
  // the same two-key rotation track `mesh-fixture.ts` uses for the skinned
  // case, retargeted from a bone to a part node.
  const HALF = Math.SQRT1_2;
  const animParts: Uint8Array[] =
    clipNames.length > 0 ? [f32([0, 1]), f32([0, 0, 0, 1, HALF, 0, 0, HALF])] : [];
  if (wreckClips) {
    // A second time input (the pass's own 0.1 s hold) and the two constant
    // VEC3 scale outputs every channel of both clips shares.
    animParts.push(f32([0, FIXTURE_CLIP_SECONDS]), f32([1, 1, 1, 1, 1, 1]), f32([0, 0, 0, 0, 0, 0]));
  }
  const { bytes, views } = packBufferViews([position, normal, indices, ...animParts]);
  const bufferViews = views.map((v) => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength }));
  const accessors: unknown[] = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.1, 0, 0], max: [0.1, 0, 0.2] },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
  ];
  if (clipNames.length > 0) {
    accessors.push(
      { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' }, // 3 anim input (seconds)
      { bufferView: 4, componentType: 5126, count: 2, type: 'VEC4' } // 4 anim output (quaternions)
    );
  }
  const SCALE_TIME = 5;
  const SCALE_SHOWN = 6;
  const SCALE_HIDDEN = 7;
  if (wreckClips) {
    accessors.push(
      { bufferView: 5, componentType: 5126, count: 2, type: 'SCALAR' }, // 5 scale-clip input
      { bufferView: 6, componentType: 5126, count: 2, type: 'VEC3' }, // 6 scale 1,1,1
      { bufferView: 7, componentType: 5126, count: 2, type: 'VEC3' } // 7 scale 0,0,0
    );
  }

  const meshes = opts.parts.map((p) => ({
    name: p.nodeName,
    primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }],
  }));

  const partNodes = opts.parts.map((p, i) => {
    const role = p.extrasRole === undefined ? p.nodeName : p.extrasRole;
    const extras: Record<string, unknown> = {};
    if (role !== null) extras.rl_role = role;
    return {
      name: p.nodeName,
      mesh: i,
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
    };
  });

  const nodes: unknown[] = [...partNodes];
  let roots = partNodes.map((_, i) => i);

  if (opts.pivot) {
    const pivotIdx = nodes.length;
    nodes.push({
      name: opts.pivot.pivotName,
      children: opts.pivot.pivotChildren,
      extras: { rl_pivot: 'turret' },
    });
    // Pivot children are no longer scene roots -- they hang off the pivot.
    const childSet = new Set(opts.pivot.pivotChildren);
    roots = roots.filter((i) => !childSet.has(i));
    roots.push(pivotIdx);
  }

  // Every scene root that is NOT the death root -- the set both clips key to
  // 1 (`idle`) and to 0 (`wreck`), and the set `mesh-vehicle.ts` records as
  // an entity's `liveTop`.
  const liveTopIndices = [...roots];
  let deathRootIdx = -1;
  if (opts.deathRoot) {
    const byName = new Map(opts.parts.map((p, i) => [p.nodeName, i]));
    const wreckChildIndices: number[] = [];
    for (const partName of opts.deathRoot.parts) {
      const partIdx = byName.get(partName);
      if (partIdx === undefined) {
        throw new Error(`rigid-mesh-fixture: deathRoot names "${partName}", which is not one of the parts`);
      }
      const twin = partNodes[partIdx] as { extras?: Record<string, unknown> };
      wreckChildIndices.push(nodes.length);
      nodes.push({
        name: `${FIXTURE_WRECK_PREFIX}${partName}`,
        // The SAME mesh index its live twin uses -- no second geometry.
        mesh: partIdx,
        extras: { ...(twin.extras ?? {}), rl_wreck: true },
        // A token displacement, so a wreck copy is not merely its twin at
        // the identity: the real pass bakes `D x W` into this matrix.
        translation: [0, -0.05, 0],
      });
    }
    deathRootIdx = nodes.length;
    nodes.push({ name: FIXTURE_DEATH_ROOT, children: wreckChildIndices });
    roots.push(deathRootIdx);
  }

  const rotationClip = (name: string, i: number) => ({
    name,
    channels: [{ sampler: 0, target: { node: i % opts.parts.length, path: 'rotation' } }],
    samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }],
  });

  /** The pass's own shape: one sampler per output, shared by every channel
   *  that wants it, so the pair costs three accessors between them. */
  const scaleClip = (name: string, liveOut: number, deadOut: number) => ({
    name,
    channels: [
      ...liveTopIndices.map((node) => ({ sampler: 0, target: { node, path: 'scale' } })),
      { sampler: 1, target: { node: deathRootIdx, path: 'scale' } },
    ],
    samplers: [
      { input: SCALE_TIME, output: liveOut, interpolation: 'STEP' },
      { input: SCALE_TIME, output: deadOut, interpolation: 'STEP' },
    ],
  });

  const animations =
    clipNames.length > 0
      ? {
          animations: clipNames.map((name, i) => {
            if (!wreckClips) return rotationClip(name, i);
            if (name === 'idle') return scaleClip(name, SCALE_SHOWN, SCALE_HIDDEN);
            if (name === 'wreck') return scaleClip(name, SCALE_HIDDEN, SCALE_SHOWN);
            return rotationClip(name, i);
          }),
        }
      : {};

  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.byteLength }],
    bufferViews,
    accessors,
    meshes,
    nodes,
    scenes: [{ nodes: roots }],
    scene: 0,
    ...animations,
  };
  return packGlb(json, bytes);
}

export async function parseRigidFixture(opts: RigidFixtureOpts) {
  const glb = buildRigidFixtureGlb(opts);
  return new GLTFLoader().parseAsync(glb, '');
}
