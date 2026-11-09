/**
 * GH-943 P3 (T8): shared test support for the batch twins (overlay, zone band, supply route, trail): the generated program text of a
 * node material, read off three's own `GLSLNodeBuilder` (no GPU) on the REAL batch's mesh. Not shipped: only specs import it.
 */
import * as THREE from 'three';
import type { BatchTwinDeps } from './units/overlays.node';

export interface Compiled {
  readonly glsl: string;
  readonly vertex: string;
  /** The uniform NODES the fragment stage reads. */
  readonly used: ReadonlySet<unknown>;
  /** The GLSL name each fragment uniform node was given (`nodeUniform3`). */
  readonly names: ReadonlyMap<unknown, string>;
}

export async function compileMesh(mesh: THREE.Mesh): Promise<Compiled> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  // An uninitialised renderer has no GL context: an `InstancedMesh` asks its backend for the uniform-buffer limit (the trail), and a
  // batched draw for its extension list. Stand-ins for both; no pixel depends on them.
  const backend = (r as unknown as { backend: { capabilities?: { getUniformBufferLimit(): number }; extensions?: { has(): boolean } } }).backend;
  backend.capabilities = { getUniformBufferLimit: () => 65536 };
  backend.extensions = { has: () => false };
  const builder = new W.GLSLNodeBuilder(mesh as never, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    uniforms: { fragment: Array<{ node: unknown; name: string }> };
    fragmentShader: string;
    vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  return { glsl: builder.fragmentShader, vertex: builder.vertexShader, used: new Set<unknown>(builder.uniforms.fragment.map((u) => u.node)),
    names: new Map<unknown, string>(builder.uniforms.fragment.map((u) => [u.node, u.name])),
  };
}

export async function batchDeps(): Promise<BatchTwinDeps> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  return { W, TSL: TSL as never };
}
