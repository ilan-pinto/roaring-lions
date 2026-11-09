/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T5) gates for `silhouette.node.ts`, the occlusion and smoke outline's node twin. The skinning wiring is run on NUMBERS
 * (a numeric stand-in for the slice of TSL `outlineSkinOf` reads, over a real `SkinnedMesh`); the graph is compiled to GLSL by three's
 * own `GLSLNodeBuilder` (no GPU); the pipeline state is read from three's own WebGPU pipeline utilities with a recording device. Each
 * spec names its one-line falsification, run by hand and listed in the commit message.
 *
 *  - G1 the skinned expansion equals legacy's (numbers, 1e-6). Falsify: `outlineExpandOps` adds `aExpand` unskinned.
 *  - G2 `uOutlineWidth` and `uSilhouetteDepthBias` are bound by reference. Falsify: bind by value (drop the `onRenderUpdate`).
 *  - G3 the bias is in view space. Falsify: add it to the clip z.
 *  - G4 the node pipeline carries the mechanism. Falsify: drop `stencilZFail` from `RENDER_STATE_KEYS`.
 *  - R12 the remaining inputs: `aExpand`, the colour object, the bone texture past the buffer limit.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
// @ts-expect-error -- three ships no declarations for its WebGPU backend's src/ utilities; the one method used is typed below.
import WebGPUPipelineUtilsUntyped from 'three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js';
import { NUMBER_OPS } from '../fog-ops';
import { MATERIAL_MATHS } from '../material-maths';
import { adoptMaterials, createTwinCache, legacyTwinSlot, NULL_P3_SLOTS } from '../node-material-adoption';
import { censusUnported, HIDE_WITHOUT_HOOK, PORTED_MATERIAL_KEYS } from '../backend/unported';
import type { MaterialKit } from '../backend/backend';
import { markTwin } from '../twin-identity';
import {
  createMeshSilhouetteMaterial,
  markSilhouetteOccludee,
  outlineExpandOps,
  setSilhouetteOutlineZoom,
  silhouetteMeshDepthBiasWorld,
  type OutlineSkin,
  silhouetteOutlineObjectWidth,
  SILHOUETTE_DEPTH_BIAS_UNIFORM_KEY,
  SILHOUETTE_OUTLINE_UNIFORM_KEY,
} from './silhouette';
import {
  createNodeOutlineMaterial,
  NODE_OUTLINE_MATERIAL_NAME,
  OUTLINE_BOUND_KEY,
  outlineSkinOf,
  type OutlineBuilder,
  type OutlineTsl,
  type OutlineTwinBound,
} from './silhouette.node';
import type { N } from '../fog-pass.node';

const NODE_MATERIAL_MARKER = 'rl-node-material-';

async function twinOf(legacy: THREE.MeshBasicMaterial): Promise<THREE.Material> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  return createNodeOutlineMaterial({ W, TSL: TSL as never, maths: MATERIAL_MATHS.outline }, legacy);
}
const boundOf = (m: THREE.Material): OutlineTwinBound => m.userData[OUTLINE_BOUND_KEY] as OutlineTwinBound;
type Updatable = { update(): void; value: unknown };

// ---------------------------------------------------------------------------------------------------------------------------------
// G1, on numbers.

/** Y rotation by `deg`, as a literal: [cos 0 -sin; 0 1 0; sin 0 cos] acting on column vectors (three's `makeRotationY`). */
function rotY(deg: number, v: readonly [number, number, number]): [number, number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}
const add3 = (a: readonly number[], b: readonly number[]): [number, number, number] => [(a[0] ?? 0) + (b[0] ?? 0), (a[1] ?? 0) + (b[1] ?? 0), (a[2] ?? 0) + (b[2] ?? 0)];
const scale3 = (a: readonly number[], k: number): [number, number, number] => [(a[0] ?? 0) * k, (a[1] ?? 0) * k, (a[2] ?? 0) * k];

/** A two-bone skinned mesh: bone 0 rotated 30 degrees about Y and moved, bone 1 rotated -10 and moved; vertex 0 weighted 0.7 / 0.3. */
function twoBoneMesh(bind?: THREE.Matrix4): THREE.SkinnedMesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0.3, 1.2, -0.4]), 3));
  g.setAttribute('aExpand', new THREE.BufferAttribute(new Float32Array([0.6, 0, 0.8]), 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([0, 1, 0, 0]), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([0.7, 0.3, 0, 0]), 4));
  const b0 = new THREE.Bone();
  b0.rotation.y = (30 * Math.PI) / 180;
  b0.position.set(1, 0, 2);
  const b1 = new THREE.Bone();
  b1.rotation.y = (-10 * Math.PI) / 180;
  b1.position.set(-0.5, 0.25, 0);
  const root = new THREE.Group();
  root.add(b0, b1);
  root.updateMatrixWorld(true);
  // Bone inverses identity: boneMatrices[i] is each bone's own world matrix, so the literal below can be written by hand.
  const skeleton = new THREE.Skeleton([b0, b1], [new THREE.Matrix4(), new THREE.Matrix4()]);
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  mesh.bind(skeleton, bind ?? new THREE.Matrix4());
  skeleton.update();
  return mesh;
}

/**
 * The slice of TSL `outlineSkinOf` reads, on NUMBERS, for one vertex of `mesh`: an attribute is that vertex's components, a reference
 * is the named property path of the object, a mat4 node is its column-major elements. Never the code under test.
 */
function numberTsl(mesh: THREE.SkinnedMesh, vertex: number): OutlineTsl {
  const vec = (a: readonly number[]): N => ({ x: a[0], y: a[1], z: a[2], w: a[3] }) as unknown as N;
  const mat = (e: ArrayLike<number>, at = 0): N =>
    ({ element: (c: number) => vec([e[at + c * 4] ?? NaN, e[at + c * 4 + 1] ?? NaN, e[at + c * 4 + 2] ?? NaN, e[at + c * 4 + 3] ?? NaN]) }) as unknown as N;
  const path = (name: string): unknown => name.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], mesh);
  return {
    attribute: (name: string) => {
      const a = mesh.geometry.getAttribute(name);
      const out: number[] = [];
      for (let k = 0; k < a.itemSize; k++) out.push(a.array[vertex * a.itemSize + k] as number);
      return vec(out);
    },
    reference: (name: string) => mat((path(name) as THREE.Matrix4).elements),
    referenceBuffer: (name: string, _type: string, count: number) => {
      const arr = path(name) as Float32Array;
      expect(arr.length).toBe(count * 16);
      return { element: (i: number) => mat(arr, i * 16) } as unknown as N;
    },
  } as unknown as OutlineTsl;
}

describe('G1: the skinned expansion equals legacy\'s expand-then-skin', () => {
  const p: [number, number, number] = [0.3, 1.2, -0.4];
  const e: [number, number, number] = [0.6, 0, 0.8];
  const width = 0.05;

  it('two influences (0.7 and 0.3), bones rotated 30 and -10 degrees: the literal, to 1e-6', () => {
    const mesh = twoBoneMesh();
    const builder: OutlineBuilder = { object: mesh, getUniformBufferLimit: () => 65536 };
    const skin = outlineSkinOf(numberTsl(mesh, 0), builder);
    expect(skin).not.toBeNull();
    // Legacy (expand, then skin), as a literal: q = p + w e; skin(q) = 0.7 (R30 q + t0) + 0.3 (R-10 q + t1).
    const q = add3(p, scale3(e, width));
    const legacy = add3(scale3(add3(rotY(30, q), [1, 0, 2]), 0.7), scale3(add3(rotY(-10, q), [-0.5, 0.25, 0]), 0.3));
    // The twin (skin, then add the skinned offset). Its skinned base position is three's own skinning of p.
    const skinnedP = mesh.applyBoneTransform(0, new THREE.Vector3(...p));
    const off = outlineExpandOps(NUMBER_OPS, e, width, skin as unknown as OutlineSkin<number> | null);
    const twin = add3([skinnedP.x, skinnedP.y, skinnedP.z], off);
    for (let k = 0; k < 3; k++) expect(twin[k]).toBeCloseTo(legacy[k] as number, 6);
    // The offset really is skinned: an unskinned one is off by a literal amount (the falsification's reading).
    const unskinned = add3([skinnedP.x, skinnedP.y, skinnedP.z], scale3(e, width));
    expect(Math.hypot(unskinned[0] - legacy[0], unskinned[1] - legacy[1], unskinned[2] - legacy[2])).toBeGreaterThan(1e-3);
  });

  it('with a non-identity bind matrix (rotated and moved): equals three\'s own skinning of the expanded vertex', () => {
    const bind = new THREE.Matrix4().makeRotationX(0.4).setPosition(0.2, -0.3, 0.5);
    const mesh = twoBoneMesh(bind);
    const builder: OutlineBuilder = { object: mesh, getUniformBufferLimit: () => 65536 };
    const legacy = mesh.applyBoneTransform(0, new THREE.Vector3(...add3(p, scale3(e, width))));
    const skinnedP = mesh.applyBoneTransform(0, new THREE.Vector3(...p));
    const off = outlineExpandOps(NUMBER_OPS, e, width, outlineSkinOf(numberTsl(mesh, 0), builder) as unknown as OutlineSkin<number> | null);
    expect(skinnedP.x + off[0]).toBeCloseTo(legacy.x, 6);
    expect(skinnedP.y + off[1]).toBeCloseTo(legacy.y, 6);
    expect(skinnedP.z + off[2]).toBeCloseTo(legacy.z, 6);
  });

  it('a rigid mesh takes the plain offset, aExpand * width', () => {
    const rigid = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    expect(outlineSkinOf({} as OutlineTsl, { object: rigid, getUniformBufferLimit: () => 65536 })).toBeNull();
    expect(outlineExpandOps(NUMBER_OPS, e, width, null)).toEqual([0.6 * 0.05, 0, 0.8 * 0.05]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

interface Compiled {
  readonly vertex: string;
  readonly fragment: string;
  /** The generated name of each uniform node in the vertex stage. */
  readonly names: Map<unknown, string>;
}

async function compile(mesh: THREE.Mesh, uniformLimit = 16384): Promise<Compiled> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  // No GL context in vitest: the skinning node asks the backend for the uniform-buffer limit.
  (r as unknown as { backend: { capabilities: unknown } }).backend.capabilities = { getUniformBufferLimit: () => uniformLimit };
  const builder = new W.GLSLNodeBuilder(mesh as never, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    uniforms: { vertex: Array<{ node: unknown; name: string }> };
    vertexShader: string;
    fragmentShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader, names: new Map(builder.uniforms.vertex.map((u) => [u.node, u.name])) };
}

function outlineGeometry(skinned: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('aExpand', new THREE.BufferAttribute(new Float32Array(9), 3));
  if (skinned) {
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(12), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(12), 4));
  }
  return g;
}

async function compiledOutline(skinned: boolean, uniformLimit?: number): Promise<{ c: Compiled; twin: THREE.Material; legacy: THREE.MeshBasicMaterial }> {
  const legacy = createMeshSilhouetteMaterial('#2F6FD9');
  const twin = await twinOf(legacy);
  let mesh: THREE.Mesh;
  if (skinned) {
    const sm = new THREE.SkinnedMesh(outlineGeometry(true), twin);
    sm.bind(new THREE.Skeleton([new THREE.Bone(), new THREE.Bone()]));
    mesh = sm;
  } else {
    mesh = new THREE.Mesh(outlineGeometry(false), twin);
  }
  return { c: await compile(mesh, uniformLimit), twin, legacy };
}

/** The vertex program's statements from the end of the skinning to the model-view product: the outline's expansion. */
function expansionOf(vertex: string): string {
  const start = vertex.lastIndexOf('positionLocal = position;');
  const end = vertex.indexOf('modelViewMatrix =');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return vertex.slice(start, end);
}

describe('the twin graph', () => {
  it('is an unlit, fog-blind, depth-write-off, GreaterDepth, BackSide outline with the legacy stencil test and the census name', async () => {
    const legacy = createMeshSilhouetteMaterial('#2F6FD9');
    const m = (await twinOf(legacy)) as THREE.MeshBasicMaterial & { fog: boolean };
    expect(m.name.startsWith(NODE_MATERIAL_MARKER)).toBe(true);
    expect(m.name).toBe(NODE_OUTLINE_MATERIAL_NAME);
    // Literals: the mechanism (`SILHOUETTE_MATERIAL_FLAGS`, `SILHOUETTE_MESH_SIDE`), not a re-read of the code under test.
    expect([m.transparent, m.depthTest, m.depthWrite, m.depthFunc, m.side]).toEqual([true, true, false, THREE.GreaterDepth, THREE.BackSide]);
    expect([m.stencilWrite, m.stencilFunc, m.stencilRef, m.stencilFuncMask]).toEqual([true, THREE.NotEqualStencilFunc, 1, 0xff]);
    expect([m.stencilFail, m.stencilZFail, m.stencilZPass]).toEqual([THREE.KeepStencilOp, THREE.KeepStencilOp, THREE.KeepStencilOp]);
    expect(m.fog).toBe(false);
    expect(m.toneMapped).toBe(false);
  });

  it('R12 colour: the twin draws the legacy material\'s own Color object, so an in-place recolour reaches it', async () => {
    const legacy = createMeshSilhouetteMaterial('#2F6FD9');
    const m = (await twinOf(legacy)) as THREE.MeshBasicMaterial;
    expect(m.color).toBe(legacy.color);
    legacy.color.set('#C83C32');
    expect(m.color.getHexString()).toBe('c83c32');
  });

  it('R12 aExpand x uOutlineWidth: the rigid expansion adds the attribute times the width uniform to the local position', async () => {
    const { c, twin } = await compiledOutline(false);
    const w = c.names.get(boundOf(twin).uOutlineWidth);
    expect(w).toBeDefined();
    const exp = expansionOf(c.vertex);
    for (const k of ['x', 'y', 'z']) expect(exp).toContain(`aExpand.${k} * ${w as string}`);
    expect(exp).toMatch(/positionLocal = \( positionLocal \+ vec3\(/);
  });

  it('G1 on the program: the skinned twin reads the skin weights and the bone matrices a SECOND time, for the expansion', async () => {
    // The reference: the same skinned mesh drawn by a stock node material whose expansion is the UNSKINNED offset. Its program holds
    // only three's own skinning; the twin's must add the four weights and its own read of the bone matrices.
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const plain = new W.MeshBasicNodeMaterial();
    plain.positionNode = TSL.positionLocal.add(TSL.attribute('aExpand', 'vec3').mul(TSL.uniform(0.1))) as never;
    const sm = new THREE.SkinnedMesh(outlineGeometry(true), plain);
    sm.bind(new THREE.Skeleton([new THREE.Bone(), new THREE.Bone()]));
    const ref = (await compile(sm)).vertex;
    const twin = (await compiledOutline(true)).c.vertex;
    const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;
    expect(count(twin, /skinWeight\.[xyzw]/g)).toBeGreaterThanOrEqual(count(ref, /skinWeight\.[xyzw]/g) + 4);
    expect(count(twin, /uniform NodeBuffer_\d+/g)).toBe(count(ref, /uniform NodeBuffer_\d+/g) + 1);
    expect(expansionOf(twin)).toContain('aExpand.x');
    // The rigid twin reads neither.
    expect((await compiledOutline(false)).c.vertex).not.toMatch(/skinWeight|skinIndex|NodeBuffer/);
  });

  it('G1 on the program: the bone matrix is read column-major (column k always scales the k-th expanded component; never a transposed read)', async () => {
    // The numeric stand-in above fixes `.element(c).x` to a column-major array by hand, so it cannot see how the REAL nodes index a bone.
    // Here the compiled program is the witness: every read of the skinned bone buffer is `bone[k].c * v_k`. A mat4's column k holds the
    // image of basis vector k, so the expanded vector's k-th component must multiply column k, for every output row c = x, y, z.
    // Falsify: write `linear` row-major (`[c0.x, c1.x, c2.x, c0.y, ...]`); the same column then multiplies a different component.
    const { c } = await compiledOutline(true);
    const reads = [...expansionOf(c.vertex).matchAll(/buffer\d+\[ uvec4\( skinIndex \)\.[xyzw] \]\[ (\d)u \]\.([xyz]) \* nodeVar(\d+)/g)];
    // 3 output components x 3 columns x 4 influences.
    expect(reads.length).toBe(36);
    const varOfColumn = new Map<string, Set<string>>();
    for (const [, col, comp, v] of reads) {
      void comp;
      const set = varOfColumn.get(col as string) ?? new Set<string>();
      set.add(v as string);
      varOfColumn.set(col as string, set);
    }
    expect([...varOfColumn.keys()].sort()).toEqual(['0', '1', '2']);
    // One variable per column, whatever the output component...
    for (const set of varOfColumn.values()) expect(set.size).toBe(1);
    // ... and the columns take the expanded x, y, z in order (consecutive, ascending node variables).
    const vars = ['0', '1', '2'].map((k) => Number([...(varOfColumn.get(k) as Set<string>)][0]));
    expect(vars[1]).toBe((vars[0] as number) + 1);
    expect(vars[2]).toBe((vars[0] as number) + 2);
    // Every (column, component) pair is read: no row is dropped.
    expect(new Set(reads.map((r) => `${r[1]}${r[2]}`)).size).toBe(9);
  });

  it('R12 the bone texture: past the uniform-buffer limit the expansion reads the skeleton\'s bone texture, as the skinning node does', async () => {
    const { c } = await compiledOutline(true, 64);
    // three's skinning and the twin each fetch the four bones' four columns from the texture: 32 fetches, and no bone buffer.
    expect((c.vertex.match(/texelFetch\(/g) ?? []).length).toBe(32);
    expect(c.vertex).not.toMatch(/uniform NodeBuffer_\d+/);
  });

  it('G3: the depth bias is added to the VIEW-space z, inside the projection, never to the clip-space position', async () => {
    const { c, twin } = await compiledOutline(false);
    const bias = c.names.get(boundOf(twin).uSilhouetteDepthBias);
    expect(bias).toBeDefined();
    const b = bias as string;
    const proj = new RegExp(`cameraProjectionMatrix \\* vec4\\( v_positionView\\.x, v_positionView\\.y, \\( v_positionView\\.z \\+ ${b} \\), 1\\.0 \\)`);
    expect(c.vertex).toMatch(proj);
    // The bias appears exactly once, and only there.
    expect(c.vertex.split(b).length - 1).toBe(2 /* declaration + use */);
  });
});

describe('G2: the width and the bias are bound by reference to the legacy uniform records', () => {
  it('after setSilhouetteOutlineZoom(mats, 2) and one render update, the twin\'s nodes read the new values', async () => {
    const legacy = createMeshSilhouetteMaterial('#2F6FD9');
    const twin = await twinOf(legacy);
    const b = boundOf(twin);
    // Literal starting values: zoom 1 (the constructor's).
    expect(b.uOutlineWidth.value).toBeCloseTo(silhouetteOutlineObjectWidth(1), 12);
    expect(b.uSilhouetteDepthBias.value).toBeCloseTo(silhouetteMeshDepthBiasWorld(1), 12);
    setSilhouetteOutlineZoom([legacy], 2);
    const rec = legacy.userData as Record<string, { value: number }>;
    const wantW = (rec[SILHOUETTE_OUTLINE_UNIFORM_KEY] as { value: number }).value;
    const wantB = (rec[SILHOUETTE_DEPTH_BIAS_UNIFORM_KEY] as { value: number }).value;
    // The record really moved (zoom 2 halves the object width).
    expect(wantW).toBeCloseTo(silhouetteOutlineObjectWidth(1) / 2, 12);
    (b.uOutlineWidth as unknown as Updatable).update();
    (b.uSilhouetteDepthBias as unknown as Updatable).update();
    expect(b.uOutlineWidth.value).toBe(wantW);
    expect(b.uSilhouetteDepthBias.value).toBe(wantB);
  });

  it('refuses a legacy material with no uniform record (a stock MeshBasicMaterial is not an outline)', async () => {
    await expect(twinOf(new THREE.MeshBasicMaterial())).rejects.toThrow(/uniform record/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// G4: the WebGPU pipeline descriptor, built by three's own `WebGPUPipelineUtils` against a recording device.

interface DepthStencil {
  depthCompare?: string;
  depthWriteEnabled?: boolean;
  stencilFront?: { compare?: string; failOp?: string; depthFailOp?: string; passOp?: string };
  stencilReadMask?: number;
  stencilWriteMask?: number;
}

function pipelineOf(material: THREE.Material): { depthStencil: DepthStencil; cullMode: string; frontFace: string } {
  let captured: { depthStencil: DepthStencil; cullMode: string; frontFace: string } | null = null;
  const backend = {
    device: {
      createPipelineLayout: () => ({}),
      pushErrorScope: () => {},
      popErrorScope: () => Promise.resolve(null),
      createRenderPipeline: (d: { depthStencil: DepthStencil; primitive: { cullMode: string; frontFace: string } }) => {
        captured = { depthStencil: structuredClone(d.depthStencil), cullMode: d.primitive.cullMode, frontFace: d.primitive.frontFace };
        return {};
      },
    },
    get: () => ({ module: {} }),
    utils: {
      getSampleCountRenderContext: () => 1,
      getCurrentColorFormat: () => 'rgba16float',
      getCurrentDepthStencilFormat: () => 'depth24plus-stencil8',
      getPrimitiveTopology: () => 'triangle-list',
    },
    attributeUtils: { createShaderVertexBuffers: () => [] },
    parameters: { reversedDepthBuffer: false },
    compatibilityMode: false,
  };
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  const renderObject = {
    object: mesh,
    material,
    geometry: mesh.geometry,
    pipeline: { vertexProgram: {}, fragmentProgram: {} },
    getBindings: () => [],
    // The node scene pass: depth and stencil (`post-chain.node.ts`, depth24plus-stencil8).
    context: { textures: null, depth: true, stencil: true, mrt: null },
  };
  const Utils = WebGPUPipelineUtilsUntyped as new (backend: unknown) => { createRenderPipeline(ro: unknown, promises: null): void };
  new Utils(backend).createRenderPipeline(renderObject, null);
  if (captured === null) throw new Error('no pipeline was created');
  return captured;
}

/** A unit body material carrying a unit hook (the team mark), so adoption files it under `unit`. */
function hookedBody(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  const base = m.customProgramCacheKey();
  m.onBeforeCompile = () => {};
  m.customProgramCacheKey = () => `${base}|rl-team-mark-2`;
  return m;
}

describe('G4: the node pipeline carries the mechanism', () => {
  it('outline: greater depth, no depth write, back faces; stencil not-equal with every op keep. Body: always, replace on pass AND depth-fail', async () => {
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const outlineLegacy = createMeshSilhouetteMaterial('#2F6FD9');
    const body = hookedBody();
    markSilhouetteOccludee(body);
    expect(legacyTwinSlot(body)).toBe('unit');
    // The REAL outline factory; a stock node material for the body twin, so its state can only come from adoption's copy.
    const kit: MaterialKit = {
      ...NULL_P3_SLOTS,
      ground: null,
      foliage: null,
      ring: null,
      unit: (legacy) => {
        const t = new MeshStandardNodeMaterial();
        markTwin(t, legacy);
        return t;
      },
      outline: (legacy) => createNodeOutlineMaterial({ W, TSL: TSL as never, maths: MATERIAL_MATHS.outline }, legacy),
    };
    const root = new THREE.Group();
    const outlineMesh = new THREE.Mesh(outlineGeometry(false), outlineLegacy);
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(), body);
    root.add(outlineMesh, bodyMesh);
    expect(adoptMaterials(root, kit, createTwinCache())).toBe(2);
    expect((outlineMesh.material as THREE.Material).name).toBe(NODE_OUTLINE_MATERIAL_NAME);

    const o = pipelineOf(outlineMesh.material as THREE.Material);
    expect(o.depthStencil.depthCompare).toBe('greater');
    expect(o.depthStencil.depthWriteEnabled).toBe(false);
    expect(o.cullMode).toBe('back');
    expect(o.frontFace).toBe('cw'); // BackSide flips the winding
    expect(o.depthStencil.stencilFront).toEqual({ compare: 'not-equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' });
    expect(o.depthStencil.stencilReadMask).toBe(0xff);

    const b = pipelineOf(bodyMesh.material as THREE.Material);
    expect(b.depthStencil.stencilFront).toEqual({ compare: 'always', failOp: 'keep', depthFailOp: 'replace', passOp: 'replace' });
    expect(b.depthStencil.stencilWriteMask).toBe(0xff);
  });

  it('the smoke outline keeps its no-depth-test through adoption: the pipeline compares always', async () => {
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const smoke = createMeshSilhouetteMaterial('#2F6FD9');
    smoke.depthTest = false;
    const kit: MaterialKit = {
      ...NULL_P3_SLOTS,
      ground: null,
      foliage: null,
      ring: null,
      outline: (legacy) => createNodeOutlineMaterial({ W, TSL: TSL as never, maths: MATERIAL_MATHS.outline }, legacy),
    };
    const mesh = new THREE.Mesh(outlineGeometry(false), smoke);
    adoptMaterials(mesh, kit, createTwinCache());
    const p = pipelineOf(mesh.material as THREE.Material);
    expect(p.depthStencil.depthCompare).toBe('always');
    expect(p.depthStencil.stencilFront?.compare).toBe('not-equal');
  });
});

describe('the census', () => {
  it('rl-silhouette-outline is ported and no longer hidden without its hook; the L-matched census leaves the legacy outline drawn', () => {
    expect(PORTED_MATERIAL_KEYS.has('rl-silhouette-outline')).toBe(true);
    expect(HIDE_WITHOUT_HOOK.has('rl-silhouette-outline')).toBe(false);
    const mesh = new THREE.Mesh(outlineGeometry(false), createMeshSilhouetteMaterial('#2F6FD9'));
    const root = new THREE.Group();
    root.add(mesh);
    expect(censusUnported(root, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    expect(mesh.visible).toBe(true);
  });
});
