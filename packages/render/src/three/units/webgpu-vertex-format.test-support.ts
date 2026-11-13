/**
 * GH-1319: test support. The `format` three's REAL WebGPU backend (the bundled `three/webgpu` the app loads) writes into each
 * attribute's pipeline vertex layout: `createAttribute`, then `createShaderVertexBuffers` (what `createRenderPipeline` is given), on a
 * stub device. An oracle from three itself, never a copy of its table. NOTE: `createAttribute` widens a plain 8/16-bit array IN
 * PLACE, as the real backend does, so call this last on a geometry a test still inspects.
 */
import type * as THREE from 'three';

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** The `format` three's WebGPU backend writes into each attribute's pipeline vertex layout. */
export async function webGpuFormats(attrs: readonly AnyAttribute[]): Promise<(string | undefined)[]> {
  const W = await import('three/webgpu');
  const backend = new W.WebGPUBackend() as unknown as {
    device: unknown;
    attributeUtils: {
      createAttribute(a: AnyAttribute, usage: number): void;
      createShaderVertexBuffers(ro: { getAttributes(): readonly AnyAttribute[] }): { attributes: { format?: string }[] }[];
    };
  };
  // three resets its shared descriptor right after `createBuffer`, so the size is read there, not in `getMappedRange`.
  backend.device = {
    createBuffer: (d: { size: number }) => {
      const bytes = new ArrayBuffer(d.size);
      return { getMappedRange: () => bytes, unmap(): void {} };
    },
  };
  const g = globalThis as { GPUBufferUsage?: unknown };
  const had = g.GPUBufferUsage;
  g.GPUBufferUsage ??= { INDEX: 0x10, VERTEX: 0x20 };
  try {
    for (const a of attrs) backend.attributeUtils.createAttribute(a, 0x20);
    return backend.attributeUtils.createShaderVertexBuffers({ getAttributes: () => attrs }).flatMap((l) => l.attributes.map((x) => x.format));
  } finally {
    g.GPUBufferUsage = had;
  }
}
