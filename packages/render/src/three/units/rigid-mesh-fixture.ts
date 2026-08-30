/**
 * Shared GLB test fixture for the two RIGID mesh classes (vehicles,
 * buildings) -- the non-skinned counterpart of `mesh-fixture.ts`'s own
 * skinned fixture, and built the identical way for the identical reason
 * (that file's own top comment): a real, minimal binary glTF, parsed with
 * the SAME `GLTFLoader` production code uses, never a synthetic in-memory
 * scene graph or a mock.
 *
 * Simpler than `mesh-fixture.ts` throughout: no skin, no joints/weights, no
 * animations -- exactly what `mesh-unit-contract.md` v2 pins for both
 * classes ("no armature, no skin, no clips" for buildings; vehicles carry no
 * clip at all in any shipped GLB). One shared triangle's `POSITION`/`NORMAL`/
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
}

export function buildRigidFixtureGlb(opts: RigidFixtureOpts): ArrayBuffer {
  const position = f32([-0.1, 0, 0, 0.1, 0, 0, 0, 0, 0.2]);
  const normal = f32([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const indices = u16([0, 1, 2]);
  const { bytes, views } = packBufferViews([position, normal, indices]);
  const bufferViews = views.map((v) => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength }));
  const accessors = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.1, 0, 0], max: [0.1, 0, 0.2] },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
  ];

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
  const sceneRoots = partNodes.map((_, i) => i);

  if (opts.pivot) {
    const pivotIdx = nodes.length;
    nodes.push({
      name: opts.pivot.pivotName,
      children: opts.pivot.pivotChildren,
      extras: { rl_pivot: 'turret' },
    });
    // Pivot children are no longer scene roots -- they hang off the pivot.
    const childSet = new Set(opts.pivot.pivotChildren);
    const roots = sceneRoots.filter((i) => !childSet.has(i));
    roots.push(pivotIdx);
    const json = {
      asset: { version: '2.0' },
      buffers: [{ byteLength: bytes.byteLength }],
      bufferViews,
      accessors,
      meshes,
      nodes,
      scenes: [{ nodes: roots }],
      scene: 0,
    };
    return packGlb(json, bytes);
  }

  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.byteLength }],
    bufferViews,
    accessors,
    meshes,
    nodes,
    scenes: [{ nodes: sceneRoots }],
    scene: 0,
  };
  return packGlb(json, bytes);
}

export async function parseRigidFixture(opts: RigidFixtureOpts) {
  const glb = buildRigidFixtureGlb(opts);
  return new GLTFLoader().parseAsync(glb, '');
}
