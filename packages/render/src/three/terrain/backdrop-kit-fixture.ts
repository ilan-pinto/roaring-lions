/**
 * Test support: the shipped backdrop kit read straight out of
 * `art/meshes/backdrop/<kit>.glb`'s bytes, with no loader, no WebGL and no
 * image decode (the atlas never matters to geometry). Nothing in the game
 * imports this.
 *
 * It parses the uncompressed source of record, so positions are the artist's
 * exact numbers, not Draco-quantised ones. The output is the `KitSource` the
 * loader (`backdrop-load.ts`) builds from the same file, in tiles.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MESH_SCALE } from '../units/mesh-anim';
import type { KitGeometry, KitPieceSource, KitSource } from './backdrop-kit';

interface Accessor {
  bufferView: number;
  count: number;
  componentType: number;
  type: string;
}
interface GltfJson {
  nodes: { name?: string; mesh?: number; extras?: Record<string, unknown> }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: Accessor[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  materials?: unknown[];
  images?: unknown[];
  textures?: unknown[];
}

export const KIT_GLB = 'art/meshes/backdrop/wadi_halam_kit.glb';

export function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url));
}

export function readGlb(rel: string): { json: GltfJson; bin: Buffer } {
  const buf = readFileSync(repoPath(rel));
  const total = buf.readUInt32LE(8);
  let at = 12;
  let json: GltfJson | null = null;
  let bin = Buffer.alloc(0);
  while (at < total) {
    const len = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8')) as GltfJson;
    else if (type === 0x004e4942) bin = Buffer.from(body);
    at += 8 + len;
  }
  if (json === null) throw new Error(`${rel}: no JSON chunk`);
  return { json, bin };
}

function accessorArray(json: GltfJson, bin: Buffer, index: number): Float32Array | Uint16Array | Uint32Array {
  const a = json.accessors[index];
  const v = json.bufferViews[a.bufferView];
  const off = (v.byteOffset ?? 0) + bin.byteOffset;
  const n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3 } as Record<string, number>)[a.type];
  const ab = bin.buffer.slice(off, off + v.byteLength) as ArrayBuffer;
  if (a.componentType === 5126) return new Float32Array(ab, 0, n);
  if (a.componentType === 5123) return new Uint16Array(ab, 0, n);
  if (a.componentType === 5125) return new Uint32Array(ab, 0, n);
  throw new Error(`unsupported accessor component type ${a.componentType}`);
}

export function readKitFixture(rel = KIT_GLB): KitSource & { json: GltfJson } {
  const { json, bin } = readGlb(rel);
  const pieces = new Map<string, KitPieceSource>();
  const lod1 = new Map<string, KitGeometry>();
  const sc = (p: readonly number[]): [number, number, number] => [p[0] * MESH_SCALE, p[1] * MESH_SCALE, p[2] * MESH_SCALE];
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.extras?.rl_piece as string;
    const prim = json.meshes[node.mesh].primitives[0];
    const geometry: KitGeometry = {
      positions: Float32Array.from(accessorArray(json, bin, prim.attributes.POSITION) as Float32Array, (x) => x * MESH_SCALE),
      normals: accessorArray(json, bin, prim.attributes.NORMAL) as Float32Array,
      uvs: accessorArray(json, bin, prim.attributes.TEXCOORD_0) as Float32Array,
      index: accessorArray(json, bin, prim.indices as number) as Uint16Array | Uint32Array,
    };
    if (node.extras?.rl_lod === 1) {
      lod1.set(name, geometry);
      continue;
    }
    const anchors = typeof node.extras?.rl_anchors === 'string' ? (JSON.parse(node.extras.rl_anchors) as { name: string; p: number[] }[]) : [];
    const olives = typeof node.extras?.rl_olives === 'string' ? (JSON.parse(node.extras.rl_olives) as number[][]) : [];
    pieces.set(name, { name, ...geometry, anchors: anchors.map((a) => ({ name: a.name, p: sc(a.p) })), olives: olives.map(sc) });
  }
  for (const [name, twin] of lod1) pieces.set(name, { ...(pieces.get(name) as KitPieceSource), lod1: twin });
  return { pieces, json };
}
