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

export async function parseFixture(opts: Parameters<typeof buildFixtureGlb>[0]) {
  const glb = buildFixtureGlb(opts);
  return new GLTFLoader().parseAsync(glb, '');
}
