// GH-943 P0: `&gpu=auto|webgpu|webgl2` in the URL turns the load-time bitmap release OFF at module load, because the app
// starts loading GLBs before `ThreeRenderer.init` and WebGPU uploads a texture more than once (a closed bitmap draws black).
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

async function armedOnLoad(search: string, pathname = '/'): Promise<boolean> {
  vi.resetModules();
  vi.stubGlobal('location', { search, pathname });
  const m = await import('./gltf-loader');
  const tex = new THREE.Texture({ width: 4, height: 4, close(): void {} } as unknown as HTMLImageElement);
  m.releaseImageAfterUpload(tex);
  return tex.onUpdate !== null;
}

describe('gltf-loader image release and the WebGPU flag', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is armed on a normal URL', async () => {
    expect(await armedOnLoad('?sandbox=wadi_halam_4')).toBe(true);
  });
  it.each(['webgpu', 'webgl2', 'auto'])('is not armed with &gpu=%s', async (v) => {
    expect(await armedOnLoad(`?sandbox=wadi_halam_4&gpu=${v}`)).toBe(false);
  });
  it('is not armed on the /free-play/<map> path form either', async () => {
    expect(await armedOnLoad('?gpu=webgpu', '/free-play/wadi_halam_4')).toBe(false);
  });
  it.each(['/mission/beit_sahwan_1', '/', '/free-play', '/campaign'])('stays armed outside a sandbox: %s?gpu=webgpu (GH-943 T1)', async (p) => {
    expect(await armedOnLoad('?gpu=webgpu', p)).toBe(true);
  });
  it('stays armed for &gpu=legacy, so the shipping path is untouched', async () => {
    expect(await armedOnLoad('?sandbox=wadi_halam_4&gpu=legacy')).toBe(true);
  });
});
