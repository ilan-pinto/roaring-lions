import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawableNow, probeGpu, probeGpuApi, resetGpuProbeForTest, settledGpu } from './gpu-probe';

const real = { gpu: { requestAdapter: async () => ({ info: { vendor: 'apple' } }) } };
const soft = { gpu: { requestAdapter: async () => ({ info: { vendor: 'google' }, isFallbackAdapter: true }) } };

describe('probeGpuApi', () => {
  it('a real adapter wins over a present WebGL2 (webgpu is primary)', async () => {
    expect(await probeGpuApi({ navigator: real, webgl2: () => true })).toMatchObject({ api: 'webgpu' });
  });
  it('a real adapter is webgpu even with no WebGL2', async () => {
    expect(await probeGpuApi({ navigator: real, webgl2: () => false })).toMatchObject({ api: 'webgpu' });
  });
  it('no navigator.gpu falls to webgl2 with the reason, and to none only when WebGL2 is gone too', async () => {
    expect(await probeGpuApi({ navigator: {}, webgl2: () => true })).toMatchObject({ api: 'webgl2', detail: expect.stringContaining('navigator.gpu') });
    expect(await probeGpuApi({ navigator: {}, webgl2: () => false })).toMatchObject({ api: 'none' });
  });
  it('a software adapter is not preferred over a real WebGL2', async () => {
    expect(await probeGpuApi({ navigator: soft, webgl2: () => true })).toMatchObject({ api: 'webgl2' });
    expect(await probeGpuApi({ navigator: soft, webgl2: () => false })).toMatchObject({ api: 'webgpu' });
  });
});

describe('the memoised probe and the synchronous decision', () => {
  afterEach(() => {
    resetGpuProbeForTest();
    vi.restoreAllMocks();
  });
  it('asks once, and settledGpu is null until it lands', async () => {
    const nav = vi.fn(async () => null);
    vi.stubGlobal('navigator', { gpu: { requestAdapter: nav } });
    expect(settledGpu()).toBeNull();
    const a = probeGpu();
    const b = probeGpu();
    expect(a).toBe(b);
    await a;
    expect(nav).toHaveBeenCalledTimes(1);
    expect(settledGpu()).not.toBeNull();
    vi.unstubAllGlobals();
  });
  it('a pending probe counts as drawable, loudly; only none shows the plate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(drawableNow()).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
