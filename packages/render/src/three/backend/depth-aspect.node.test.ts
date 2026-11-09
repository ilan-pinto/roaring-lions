/**
 * GH-943 WebGPU P1: the depth-ASPECT pin. The node chain's scene pass renders into a `depth24plus-stencil8` target (T2, kept for the
 * P2 decals and the P3 outline), and the fog stage (and only it) SAMPLES that texture's depth (`scenePass.getTextureNode('depth')`).
 * WebGPU forbids binding a view of a depth-stencil texture with `aspect: 'all'` to a `texture_depth_2d` slot ("Multiple aspects
 * (Depth|Stencil) selected"), and three 0.186.1's `WebGPUBindingUtils.createBindGroup` made EVERY sampled view `aspect: 'all'`. The
 * bind group was invalid, every command buffer after it was invalid, and G drew a pure black frame on Metal (T9, PR 1082).
 *
 * three fixed it upstream in r187 (`binding.texture.isDepthTexture ? GPUTextureAspect.DepthOnly : GPUTextureAspect.All`). We stay on
 * 0.186.1 (an upgrade would move the shipping legacy renderer under the golden baselines) and carry that exact line as a pnpm patch,
 * `patches/three@0.186.1.patch` (`patchedDependencies` in `pnpm-workspace.yaml`; pnpm refuses an unused patch, so a three upgrade has
 * to drop it). These tests drive the REAL bundled `WebGPUBindingUtils` (the one `three/webgpu` ships, which is what the app loads)
 * with a fake device, and read the view descriptor it asks for.
 *
 * Falsification: revert the patch (`pnpm install` without `patchedDependencies`) and the first test reads `'all'`; drop only the
 * build's `DepthOnly: 'depth-only'` constant (the r186 bundle tree-shook it away) and it reads `undefined`, which WebGPU defaults
 * to `'all'`: the same black frame. Both were run by hand; see the commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

interface ViewDescriptor {
  aspect?: string;
  dimension?: string;
}

/** Drives `createBindGroup` for one sampled-texture binding and returns the view descriptor three asked the GPU texture for. */
async function viewFor(texture: THREE.Texture): Promise<ViewDescriptor> {
  const W = await import('three/webgpu');
  const backend = new W.WebGPUBackend() as unknown as {
    device: unknown;
    get(o: object): unknown;
    bindingUtils: { createBindGroup(bindGroup: unknown, layout: unknown): unknown };
  };
  const views: ViewDescriptor[] = [];
  const gpuTexture = {
    width: 4,
    height: 4,
    depthOrArrayLayers: 1,
    mipLevelCount: 1,
    // three resets its shared descriptor right after this call, so copy it.
    createView: (d: ViewDescriptor) => {
      views.push({ aspect: d.aspect, dimension: d.dimension });
      return { view: true };
    },
  };
  const data = new Map<object, unknown>([[texture, { texture: gpuTexture }]]);
  backend.get = (o: object) => data.get(o) ?? {};
  backend.device = { createBindGroup: (d: unknown) => d };
  const binding = { isSampledTexture: true, texture, store: false };
  backend.bindingUtils.createBindGroup({ name: 'object', bindings: [binding] }, {});
  expect(views).toHaveLength(1);
  return views[0] as ViewDescriptor;
}

describe('three/webgpu samples a depth texture through a DEPTH-ONLY view (the r187 fix, patched onto 0.186.1)', () => {
  it("the scene pass's depth24plus-stencil8 texture (DepthStencilFormat / UnsignedInt248Type) gets aspect 'depth-only'", async () => {
    const t = new THREE.DepthTexture(4, 4, THREE.UnsignedInt248Type);
    t.format = THREE.DepthStencilFormat;
    expect((await viewFor(t)).aspect).toBe('depth-only');
  });
  it("a depth-only texture (the AO pre-pass's default depth24plus) also gets 'depth-only', which equals 'all' for it", async () => {
    expect((await viewFor(new THREE.DepthTexture(4, 4))).aspect).toBe('depth-only');
  });
  it("a colour texture keeps aspect 'all'", async () => {
    expect((await viewFor(new THREE.Texture())).aspect).toBe('all');
  });
});
