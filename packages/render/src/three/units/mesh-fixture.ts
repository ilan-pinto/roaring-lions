/**
 * Shared GLB test fixture, extracted from `mesh-unit.test.ts` (its own
 * original top comment explains the WHY in full: no `art/meshes/*.glb`
 * existed on disk when this was written, so these tests hand-author a real,
 * minimal binary glTF and parse it with the SAME `GLTFLoader` production
 * code uses, rather than a synthetic in-memory scene graph or a mock).
 * Pulled out into its own, non-`.test.ts` module so `mesh-death.test.ts` can
 * build entities from the identical fixture shape without importing a
 * `.test.ts` file into another `.test.ts` file -- vitest would collect and
 * run `mesh-unit.test.ts`'s own `describe`/`it` blocks a second time as a
 * side effect of that import, silently duplicating the whole suite.
 *
 * Byte-identical to what `mesh-unit.test.ts` used to define inline; nothing
 * here changed in the extraction beyond becoming importable.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
 * half alone still works), fully weighted to the child bone, and one or
 * more animation clips (named by `clipName`) rotating that bone 90° about X
 * between t=0 and t=1.
 *
 * Bind math (so the deformation is actually correct, not merely
 * non-throwing): full weight on bone1, whose bind-pose world matrix is
 * `translate(0,1,0)`, so its inverse bind matrix is `translate(0,-1,0)`.
 * Skinned position = `boneWorld * inverseBind * bindPosition`, which is
 * exactly "rotate the local offset from the bone's own pivot, then
 * translate back" -- the pivot rotation this fixture's tests check for.
 */
export function buildFixtureGlb(opts: {
  roleName: string;
  /** One or more animation names -- each gets its own `animations[]` entry,
   *  all sharing the same sampler/accessor data (fine for exercising clip
   *  wiring; the point is which NAME is reachable, not distinct motion per
   *  clip). A single string is shorthand for `[clipName]`. */
  clipName: string | string[];
  extrasRole?: string | null;
  nameRole?: string | null;
  /**
   * Length of every clip in the fixture, in seconds -- the second (and
   * last) keyframe's time. Defaults to 1, which is what this fixture always
   * produced before the parameter existed, so every caller that omits it is
   * byte-identical to before.
   *
   * Added for `ThreeRenderer.fire-latch.test.ts` (GH-148), which pins a
   * latch length against a clip's OWN duration: proving "the clip's
   * duration" rather than "some constant" needs two fixtures whose clips
   * differ in length, and 1 s was the only length expressible.
   */
  clipSeconds?: number;
  /**
   * SCENE-level glTF `extras`, which `GLTFLoader` surfaces as
   * `gltf.scene.userData` -- the channel `pnpm gait:meshes` writes `rl_gait`
   * down (design sec 3.4). Omitted by default, so every caller that does not
   * pass it produces byte-identical output to before this existed.
   *
   * Deliberately typed as an arbitrary object rather than as
   * `{ rl_gait?: ... }`: the tests this exists for include the MALFORMED
   * cases, and a fixture that could only express a well-formed declaration
   * could not exercise the validation that is the point of reading it.
   */
  sceneExtras?: Record<string, unknown>;
  /**
   * Per clip, a constant scale to key on the root joint and on a third,
   * PARENTLESS `death_root` joint -- the bone-scale swap every kit rig,
   * the sniper, the Meshy mortar team and every vehicle use to switch
   * geometry sets. Any clip named here gets two STEP scale channels; the
   * `death_root` node and its third inverse-bind matrix exist only when
   * this is non-empty, so every caller that omits it is byte-identical to
   * before. Added for `mesh-clip.test.ts` (D2) and the topple tests.
   */
  scaleClips?: Record<string, { root: number; deathRoot: number }>;
  /**
   * Where the root joint (and `death_root`) stand, in metres -- default the
   * origin. A topple pivots each figure about ITS OWN feet, and a fixture
   * whose only figure stands on the entity origin cannot tell that apart
   * from pivoting on the entity root. The inverse-bind matrices follow it.
   */
  rootOffset?: [number, number, number];
}): ArrayBuffer {
  const extrasRole = opts.extrasRole === undefined ? opts.roleName : opts.extrasRole;
  const nameRole = opts.nameRole === undefined ? opts.roleName : opts.nameRole;
  const clipNames = Array.isArray(opts.clipName) ? opts.clipName : [opts.clipName];
  const clipSeconds = opts.clipSeconds ?? 1;

  const position = f32([-0.1, 1, 0, 0.1, 1, 0, 0, 1, 0.2]);
  const normal = f32([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const joints = u16([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const weights = f32([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const indices = u16([0, 1, 2]);
  const off = opts.rootOffset ?? [0, 0, 0];
  const scaleClips = opts.scaleClips ?? {};
  const hasDeathRoot = Object.keys(scaleClips).length > 0;
  // Column-major translate(x, y, z).
  const tr = (x: number, y: number, z: number): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  // bone0 (root) at `off`; bone1 at `off + (0,1,0)`; death_root at `off`.
  const inverseBind = f32([
    ...tr(-off[0], -off[1], -off[2]),
    ...tr(-off[0], -off[1] - 1, -off[2]),
    ...(hasDeathRoot ? tr(-off[0], -off[1], -off[2]) : []),
  ]);
  const animInput = f32([0, clipSeconds]);
  // Quaternion (x,y,z,w): identity, then 90 deg about X.
  const HALF = Math.SQRT1_2;
  const animOutput = f32([0, 0, 0, 1, HALF, 0, 0, HALF]);
  // One VEC3 pair (same value at both keys) per (clip, joint) scale channel.
  const scaleParts: Uint8Array[] = [];
  const scaleAccessorOf = new Map<string, number>();
  for (const [clip, s] of Object.entries(scaleClips)) {
    for (const [which, v] of [
      ['root', s.root],
      ['deathRoot', s.deathRoot],
    ] as const) {
      scaleAccessorOf.set(`${clip}:${which}`, 8 + scaleParts.length);
      scaleParts.push(f32([v, v, v, v, v, v]));
    }
  }

  const { bytes, views } = packBufferViews([
    position,
    normal,
    joints,
    weights,
    indices,
    inverseBind,
    animInput,
    animOutput,
    ...scaleParts,
  ]);

  const bufferViews = views.map((v) => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength }));

  const accessors = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.1, 1, 0], max: [0.1, 1, 0.2] }, // 0 POSITION
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }, // 1 NORMAL
    { bufferView: 2, componentType: 5123, count: 3, type: 'VEC4' }, // 2 JOINTS_0
    { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' }, // 3 WEIGHTS_0
    { bufferView: 4, componentType: 5123, count: 3, type: 'SCALAR' }, // 4 indices
    { bufferView: 5, componentType: 5126, count: hasDeathRoot ? 3 : 2, type: 'MAT4' }, // 5 inverseBindMatrices
    { bufferView: 6, componentType: 5126, count: 2, type: 'SCALAR' }, // 6 anim input
    { bufferView: 7, componentType: 5126, count: 2, type: 'VEC4' }, // 7 anim output
    ...scaleParts.map((_, i) => ({ bufferView: 8 + i, componentType: 5126, count: 2, type: 'VEC3' })),
  ];

  const nodeExtras: Record<string, unknown> = {};
  if (extrasRole !== null) nodeExtras.rl_role = extrasRole;
  const rootNode: Record<string, unknown> = { name: 'root_joint', children: [1] };
  if (opts.rootOffset) rootNode.translation = off;

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
    skins: [{ joints: hasDeathRoot ? [0, 1, 3] : [0, 1], inverseBindMatrices: 5 }],
    nodes: [
      rootNode,
      { name: 'bone1', translation: [0, 1, 0] },
      {
        name: nameRole ?? '',
        mesh: 0,
        skin: 0,
        ...(Object.keys(nodeExtras).length > 0 ? { extras: nodeExtras } : {}),
      },
      ...(hasDeathRoot ? [{ name: 'death_root', translation: off }] : []),
    ],
    scenes: [
      {
        nodes: hasDeathRoot ? [0, 2, 3] : [0, 2],
        ...(opts.sceneExtras !== undefined ? { extras: opts.sceneExtras } : {}),
      },
    ],
    scene: 0,
    animations: clipNames.map((name) => {
      const s = scaleClips[name];
      const channels: { sampler: number; target: { node: number; path: string } }[] = [
        { sampler: 0, target: { node: 1, path: 'rotation' } },
      ];
      const samplers: { input: number; output: number; interpolation: string }[] = [
        { input: 6, output: 7, interpolation: 'LINEAR' },
      ];
      if (s) {
        samplers.push({ input: 6, output: scaleAccessorOf.get(`${name}:root`) as number, interpolation: 'STEP' });
        channels.push({ sampler: 1, target: { node: 0, path: 'scale' } });
        samplers.push({ input: 6, output: scaleAccessorOf.get(`${name}:deathRoot`) as number, interpolation: 'STEP' });
        channels.push({ sampler: 2, target: { node: 3, path: 'scale' } });
      }
      return { name, channels, samplers };
    }),
  };

  return packGlb(json, bytes);
}

export async function parseFixture(opts: Parameters<typeof buildFixtureGlb>[0]) {
  const glb = buildFixtureGlb(opts);
  return new GLTFLoader().parseAsync(glb, '');
}
