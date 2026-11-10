/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T14, GH-1152) G2: a skinned mesh's node program skins from the skeleton's bone texture, not a per-object uniform buffer.
 *
 * Read on the generated program text (three's own `GLSLNodeBuilder`, no GPU), through the hook exactly as `NodeManager._createNodeBuilder`
 * calls it (`renderer.debug.onNodeBuilderCreated(builder, renderObject)` before `build`). The drift guard pins that call in the bundle.
 *
 * Falsification (run by hand, in the commit message): in `installBoneTextureSkinning`, drop the override line (the hook only chains):
 * the skinned program reads the bones from a uniform buffer again, and the second spec goes red (1 red, run).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { installBoneTextureSkinning, type BuilderHookHostLike, type SkinBuilderLike } from './bone-texture';

/** What the stub backend reports: the WebGPU default, so every rig here fits a uniform buffer unless the hook says otherwise. */
const DEVICE_LIMIT = 65536;

interface Built {
  readonly vertex: string;
  readonly limit: number;
}

async function build(mesh: THREE.Mesh, hooked: boolean): Promise<Built> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  // No GL context in vitest: the skinning node asks the backend for the uniform-buffer limit.
  (r as unknown as { backend: { capabilities: unknown } }).backend.capabilities = { getUniformBufferLimit: () => DEVICE_LIMIT };
  const host = r as unknown as BuilderHookHostLike;
  if (hooked) installBoneTextureSkinning(host);
  const builder = new W.GLSLNodeBuilder(mesh as never, r) as unknown as SkinBuilderLike & {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    vertexShader: string;
  };
  // As `NodeManager._createNodeBuilder` does, before the build.
  host.debug.onNodeBuilderCreated?.(builder, { object: mesh });
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  return { vertex: builder.vertexShader, limit: builder.getUniformBufferLimit() };
}

async function skinnedMesh(): Promise<THREE.SkinnedMesh> {
  const W = await import('three/webgpu');
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(12), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(12), 4));
  const m = new THREE.SkinnedMesh(g, new W.MeshStandardNodeMaterial() as unknown as THREE.Material);
  m.bind(new THREE.Skeleton([new THREE.Bone(), new THREE.Bone(), new THREE.Bone()]));
  return m;
}

/** The bone texture path: `textureSize` of a sampler and four `texelFetch`es per bone (three's `getBoneTextureMatrices`). */
const readsBoneTexture = (vertex: string): boolean => /textureSize\(/.test(vertex) && (vertex.match(/texelFetch\(/g) ?? []).length >= 16;

describe('installBoneTextureSkinning (P3 T14 G2)', () => {
  it('the premise: unhooked, a skinned program reads its bones from a uniform buffer (no bone texture)', async () => {
    const b = await build(await skinnedMesh(), false);
    expect(readsBoneTexture(b.vertex)).toBe(false);
    expect(b.limit).toBe(DEVICE_LIMIT);
  });

  it('hooked, the skinned program reads its bones from the bone texture, and the skeleton has one', async () => {
    const mesh = await skinnedMesh();
    const b = await build(mesh, true);
    expect(readsBoneTexture(b.vertex)).toBe(true);
    expect(b.limit).toBe(0);
    expect(mesh.skeleton.boneTexture).not.toBeNull();
  });

  it('a mesh that is not skinned keeps the device limit (its builder is untouched)', async () => {
    const W = await import('three/webgpu');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const b = await build(new THREE.Mesh(g, new W.MeshBasicNodeMaterial() as unknown as THREE.Material), true);
    expect(b.limit).toBe(DEVICE_LIMIT);
  });

  it('chains a hook already set, and dispose puts it back', () => {
    const seen: unknown[] = [];
    const prev = (_b: SkinBuilderLike, t: unknown): void => {
      seen.push(t);
    };
    const host: BuilderHookHostLike = { debug: { onNodeBuilderCreated: prev } };
    const h = installBoneTextureSkinning(host);
    host.debug.onNodeBuilderCreated?.({ object: null, getUniformBufferLimit: () => DEVICE_LIMIT }, 'ro');
    expect(seen).toEqual(['ro']);
    h.dispose();
    expect(host.debug.onNodeBuilderCreated).toBe(prev);
  });

  it('drift guard: three still calls the hook on every render-object builder before it builds', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('three/webgpu'), 'utf8');
    expect(bundle).toContain('if ( onNodeBuilderCreated !== null ) onNodeBuilderCreated( nodeBuilder, renderObject );');
    expect(bundle).toContain('if ( uniformBufferSize <= builder.getUniformBufferLimit() ) {\n\n\t\tnode = referenceBuffer( \'skeleton.boneMatrices\'');
  });
});
