/**
 * A three.js scene graph rebuilt from a shipped GLB's own glTF JSON chunk,
 * for tests that must not hand-write the thing they are checking.
 *
 * ## Why this exists rather than a literal fixture
 *
 * `world-scene.ts` reads node extras. A hand-written fixture would be a
 * second author's idea of what the exporter emits, and would keep passing
 * after the exporter stopped emitting it -- the exact failure mode of a test
 * whose fixture the real producer could never generate. Everything below is
 * read out of `art/meshes/campaign/*.glb`: the node names, the `extras`, the
 * parent/child structure, the marker translations, and each mesh's bounding
 * box (glTF requires `min`/`max` on a POSITION accessor, so the box is exact
 * without decoding a single vertex).
 *
 * The VERTICES are the real ones, decoded straight out of the BIN chunk --
 * not a box standing in for them. That matters for `world-camera.test.ts`,
 * which checks the frustum fit against every one of the board's 33,678
 * positions rather than against eight corners, and it costs about a
 * millisecond.
 *
 * ## What is NOT the real thing, stated plainly
 *
 * One stand-in, named here so nobody reads more into a green test than it
 * earns: the MATERIAL is a `MeshBasicMaterial` carrying a bare
 * `THREE.Texture`, in place of the JPEG `GLTFLoader` would decode. The check
 * it feeds is "does this mesh have a map at all", which is what
 * `world-scene.ts` actually asks. Triangles are not rebuilt either (no index
 * buffer is read) -- nothing here raycasts, and everything here that reads
 * geometry reads positions.
 *
 * The one behaviour genuinely assumed rather than reproduced is that
 * `GLTFLoader` copies a node's `extras` into `userData`. That is three.js's
 * `assignExtrasToUserData`, it is the same door `units/mesh-building.ts`
 * reads `rl_role` through on every shipped building, and the shipped bytes'
 * own extras are separately pinned by `textured-world.test.ts`.
 *
 * Not a `.test.ts` file: `world-scene.test.ts` and `world-camera.test.ts`
 * both build from it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  count?: number;
  type?: string;
  min?: number[];
  max?: number[];
}
interface GltfBufferView {
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
}
interface GltfPrimitive {
  attributes: Record<string, number>;
}
interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}
interface GltfNode {
  name?: string;
  mesh?: number;
  translation?: number[];
  children?: number[];
  extras?: Record<string, unknown>;
}
interface GltfJson {
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
}

/** Both chunks of a .glb: a 12-byte header, then length-prefixed chunks --
 *  JSON first, then the binary buffer. */
function glbChunks(repoRelative: string): { json: GltfJson; bin: Buffer } {
  const buf = readFileSync(
    fileURLToPath(new URL(`../../../../../${repoRelative}`, import.meta.url))
  );
  const total = buf.readUInt32LE(8);
  let at = 12;
  let json: GltfJson | null = null;
  let bin: Buffer | null = null;
  while (at < total) {
    const len = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    if (type === 0x4e4f534a) json = JSON.parse(buf.toString('utf8', at + 8, at + 8 + len)) as GltfJson;
    if (type === 0x004e4942) bin = buf.subarray(at + 8, at + 8 + len);
    at += 8 + len;
  }
  if (!json) throw new Error(`${repoRelative}: no JSON chunk`);
  if (!bin) throw new Error(`${repoRelative}: no BIN chunk`);
  return { json, bin };
}

/** The glTF JSON chunk alone. */
export function glbJson(repoRelative: string): GltfJson {
  return glbChunks(repoRelative).json;
}

export interface GlbFixture {
  root: THREE.Object3D;
  /** The one texture every mesh's stand-in material carries. */
  map: THREE.Texture;
  /** Mesh node name -> its exact bounding box from the POSITION accessor. */
  boxes: Map<string, THREE.Box3>;
}

/** Options a test uses to prove a property rather than to describe the
 *  asset: shuffling node order and blanking names both check that
 *  `readWorldScene` reads extras and nothing else. */
export interface GlbFixtureOptions {
  /** Reverse the scene's node order. */
  shuffle?: boolean;
  /** Replace every node name with `node_<i>`. */
  anonymise?: boolean;
}

/**
 * Rebuild `repoRelative`'s scene graph as three.js objects.
 *
 * Node hierarchy is honoured (`children`), so a fixture is not silently flat
 * where the file is not.
 */
export function glbFixture(repoRelative: string, opts: GlbFixtureOptions = {}): GlbFixture {
  const { json: gltf, bin } = glbChunks(repoRelative);
  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const accessors = gltf.accessors ?? [];
  const map = new THREE.Texture();
  const boxes = new Map<string, THREE.Box3>();

  const bufferViews = gltf.bufferViews ?? [];

  /** The real POSITION values of one accessor, honouring its byteStride. */
  const positionsOf = (accessorIndex: number): Float32Array => {
    const acc = accessors[accessorIndex];
    if (!acc || acc.componentType !== 5126 || acc.type !== 'VEC3') {
      throw new Error(`${repoRelative}: POSITION accessor ${accessorIndex} is not a float VEC3`);
    }
    const bv = bufferViews[acc.bufferView ?? -1];
    if (!bv) throw new Error(`${repoRelative}: POSITION accessor ${accessorIndex} has no bufferView`);
    const stride = bv.byteStride ?? 12;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const count = acc.count ?? 0;
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const o = base + i * stride;
      out[i * 3] = bin.readFloatLE(o);
      out[i * 3 + 1] = bin.readFloatLE(o + 4);
      out[i * 3 + 2] = bin.readFloatLE(o + 8);
    }
    return out;
  };

  const geometryOf = (meshIndex: number): { geom: THREE.BufferGeometry; box: THREE.Box3 } => {
    const parts: Float32Array[] = [];
    const box = new THREE.Box3();
    for (const prim of meshes[meshIndex]?.primitives ?? []) {
      const idx = prim.attributes.POSITION ?? -1;
      const acc = accessors[idx];
      if (!acc?.min || !acc.max) throw new Error(`${repoRelative}: POSITION accessor has no min/max`);
      // From the accessor's own declared bounds, so the box is what the file
      // SAYS it is rather than what a decode happened to produce.
      box.expandByPoint(new THREE.Vector3(acc.min[0], acc.min[1], acc.min[2]));
      box.expandByPoint(new THREE.Vector3(acc.max[0], acc.max[1], acc.max[2]));
      parts.push(positionsOf(idx));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const all = new Float32Array(total);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(all, 3));
    return { geom, box };
  };

  const build = (index: number): THREE.Object3D => {
    const n = nodes[index];
    if (!n) throw new Error(`${repoRelative}: node ${index} missing`);
    const name = opts.anonymise ? `node_${index}` : (n.name ?? '');
    let obj: THREE.Object3D;
    if (n.mesh !== undefined) {
      const { geom, box } = geometryOf(n.mesh);
      obj = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map }));
      boxes.set(name, box);
    } else {
      obj = new THREE.Object3D();
    }
    obj.name = name;
    if (n.translation) obj.position.fromArray(n.translation);
    // `assignExtrasToUserData`, reproduced: three.js copies a node's extras
    // onto its userData verbatim.
    if (n.extras) Object.assign(obj.userData, n.extras);
    for (const c of n.children ?? []) obj.add(build(c));
    return obj;
  };

  const sceneNodes = [...(gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [])];
  if (opts.shuffle) sceneNodes.reverse();
  const root = new THREE.Group();
  root.name = 'Scene';
  for (const i of sceneNodes) root.add(build(i));
  return { root, map, boxes };
}
