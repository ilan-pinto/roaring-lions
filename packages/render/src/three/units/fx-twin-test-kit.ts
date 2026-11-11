/**
 * GH-943 P3 (T11): the shared harness of the FX twins' specs. Compiles a node material to GLSL through three's own `GLSLNodeBuilder`
 * (no GPU) on a REAL mesh, so a spec reads the generated shader text, the attribute set and the uniform nodes. Tests only.
 */
import * as THREE from 'three';
import { MATERIAL_MATHS } from '../material-maths';
import { adoptMaterials, createTwinCache, NULL_P3_SLOTS, type TwinCache } from '../node-material-adoption';
import type { MaterialKit } from '../backend/backend';
import { fxTwinFactories } from './fx-twins.node';
import type { FxTsl } from './fx.node';

export interface FxCompiled {
  readonly fragment: string;
  readonly vertex: string;
  /** Every uniform node the program reads, both stages. */
  readonly uniforms: ReadonlySet<unknown>;
  /** The frame-clock builtins (`time`, `deltaTime`, `frameId`) the program reads: a twin that animates on its legacy record's own
   *  clock (a batch attribute, a re-read record number) reads none. */
  readonly frameClocked: readonly unknown[];
}

interface BuilderLike {
  scene: THREE.Scene;
  camera: THREE.Camera;
  material: unknown;
  build(): void;
  uniforms: { fragment: Array<{ node: { nodeType?: string }; type: string }>; vertex: Array<{ node: { nodeType?: string }; type: string }> };
  fragmentShader: string;
  vertexShader: string;
}

export async function webgpuModules(): Promise<{ W: typeof import('three/webgpu'); TSL: FxTsl }> {
  const W = await import('three/webgpu');
  const TSL = (await import('three/tsl')) as unknown as FxTsl;
  return { W, TSL };
}

export const maths = MATERIAL_MATHS;

export async function compileFx(mesh: THREE.Mesh | THREE.InstancedMesh): Promise<FxCompiled> {
  const W = await import('three/webgpu');
  const TSL = (await import('three/tsl')) as unknown as { time: unknown; deltaTime: unknown; frameId: unknown };
  const r = new W.WebGPURenderer({ forceWebGL: true });
  // An uninitialised renderer has no GL context: the instanced path asks the backend for its uniform-buffer limit, the extension list.
  const backend = (r as unknown as { backend: { extensions: { has(): boolean }; capabilities: { getUniformBufferLimit(): number } } }).backend;
  backend.extensions = { has: () => false };
  backend.capabilities = { getUniformBufferLimit: () => 65536 };
  const builder = new W.GLSLNodeBuilder(mesh as never, r) as unknown as BuilderLike;
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  const all = [...builder.uniforms.vertex, ...builder.uniforms.fragment];
  return {
    fragment: builder.fragmentShader,
    vertex: builder.vertexShader,
    uniforms: new Set<unknown>(all.map((u) => u.node)),
    frameClocked: [TSL.time, TSL.deltaTime, TSL.frameId].filter((n) => all.some((u) => u.node === n)),
  };
}

/** `update()` on a bound uniform node (the per-render re-read), as the renderer would. */
export type Updatable = { update(): void; value: unknown };

/** The kit the node backend builds for the FX slots (the SAME factories, `fxTwinFactories`), every other slot null. */
export async function fxKit(): Promise<MaterialKit> {
  const { W, TSL } = await webgpuModules();
  return { ...NULL_P3_SLOTS, ground: null, foliage: null, ring: null, ...fxTwinFactories({ W, TSL, maths }) };
}

/** Adopts `mesh`'s legacy material through the real adoption path (a twin with the legacy pipeline state). Returns the twin. */
export async function adoptFx(mesh: THREE.Mesh | THREE.InstancedMesh, cache: TwinCache = createTwinCache()): Promise<THREE.Material> {
  const root = new THREE.Group();
  root.add(mesh);
  const swapped = adoptMaterials(root, await fxKit(), cache);
  if (swapped !== 1) throw new Error(`fx spec: adoption swapped ${swapped} objects, expected 1`);
  return mesh.material as THREE.Material;
}

/** GH-943 P3 (T12): the builder after a GLSL build, for a spec that must reach its update nodes (an `OnBeforeObjectUpdate`). */
export async function buildGlsl(mesh: THREE.Mesh | THREE.InstancedMesh): Promise<{ fragment: string; vertex: string; updateBeforeNodes: Array<{ updateBefore(frame: unknown): void }> }> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  const backend = (r as unknown as { backend: { extensions: { has(): boolean }; capabilities: { getUniformBufferLimit(): number } } }).backend;
  backend.extensions = { has: () => false };
  backend.capabilities = { getUniformBufferLimit: () => 65536 };
  const builder = new W.GLSLNodeBuilder(mesh as never, r) as unknown as BuilderLike & { updateBeforeNodes: Array<{ updateBefore(frame: unknown): void }> };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  return { fragment: builder.fragmentShader, vertex: builder.vertexShader, updateBeforeNodes: builder.updateBeforeNodes };
}

/** GH-943 P3 (T12): the WGSL a node material compiles to on `mesh` (three's own `WGSLNodeBuilder`, a stubbed device: no GPU). */
export async function compileWgsl(mesh: THREE.Mesh | THREE.InstancedMesh): Promise<{ fragment: string; vertex: string }> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: false });
  const stubbed = r as unknown as { hasFeature(): boolean; backend: Record<string, unknown> };
  stubbed.hasFeature = () => false;
  stubbed.backend.utils = { getTextureSampleData: () => ({ primarySamples: 1 }), getTextureFormatGPU: () => 'rgba8unorm' };
  stubbed.backend.device = { features: new Set<string>(), limits: { maxUniformBufferBindingSize: 65536 } };
  stubbed.backend.capabilities = { getUniformBufferLimit: () => 65536 };
  const Builder = (W as unknown as { WGSLNodeBuilder: new (m: THREE.Mesh, r: unknown) => unknown }).WGSLNodeBuilder;
  const builder = new Builder(mesh as never, r) as BuilderLike;
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  return { fragment: builder.fragmentShader, vertex: builder.vertexShader };
}
