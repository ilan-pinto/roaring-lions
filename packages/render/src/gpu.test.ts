import { describe, expect, it } from 'vitest';
import { backendKeyTerm, backendLogLine, planBackend, probeWebGpu, wantsNodeBackend, type WebGpuProbe } from './gpu';

const OK: WebGpuProbe = { ok: true, adapter: 'apple / metal-3', fallbackAdapter: false };
const SOFT: WebGpuProbe = { ok: true, adapter: 'google / swiftshader', fallbackAdapter: true };
const NONE: WebGpuProbe = { ok: false, reason: 'navigator.gpu is absent' };

describe('probeWebGpu', () => {
  it('reports an absent navigator.gpu, a null adapter and a throwing request, each with a reason', async () => {
    expect(await probeWebGpu(undefined)).toMatchObject({ ok: false });
    expect(await probeWebGpu({})).toMatchObject({ ok: false });
    expect(await probeWebGpu({ gpu: { requestAdapter: async () => null } })).toMatchObject({ ok: false, reason: expect.stringContaining('no adapter') });
    const threw = await probeWebGpu({ gpu: { requestAdapter: async () => { throw new Error('boom'); } } });
    expect(threw).toMatchObject({ ok: false, reason: expect.stringContaining('boom') });
  });
  it('names the adapter and carries the fallback flag', async () => {
    const p = await probeWebGpu({ gpu: { requestAdapter: async () => ({ info: { vendor: 'apple', device: 'm3' }, isFallbackAdapter: true }) } });
    expect(p).toEqual({ ok: true, adapter: 'apple / m3', fallbackAdapter: true });
  });
});

describe('planBackend', () => {
  it('legacy and webgl2 ignore the probe', () => {
    expect(planBackend('legacy', OK)).toEqual({ kind: 'legacy-gl' });
    expect(planBackend('webgl2', OK)).toEqual({ kind: 'node-webgl2', reason: '' });
  });
  it('auto takes WebGPU only on a real adapter', () => {
    expect(planBackend('auto', OK)).toEqual({ kind: 'node-webgpu', adapter: 'apple / metal-3' });
    expect(planBackend('auto', SOFT)).toMatchObject({ kind: 'node-webgl2', reason: expect.stringContaining('software') });
    expect(planBackend('auto', NONE)).toMatchObject({ kind: 'node-webgl2', reason: 'navigator.gpu is absent' });
  });
  it('an explicit webgpu accepts a software adapter (CI) but still falls back, with a reason, when there is none', () => {
    expect(planBackend('webgpu', SOFT)).toEqual({ kind: 'node-webgpu', adapter: 'google / swiftshader' });
    expect(planBackend('webgpu', NONE)).toMatchObject({ kind: 'node-webgl2' });
  });
});

describe('keys, log line and the node switch', () => {
  it('legacy has no key term, so its baseline keys cannot move', () => {
    expect(backendKeyTerm('legacy-gl')).toBe('');
    expect(backendKeyTerm('node-webgl2')).toBe('wgl2');
    expect(backendKeyTerm('node-webgpu')).toBe('wgpu');
  });
  it('the log line says webgpu or fallback with the reason, never silent', () => {
    expect(backendLogLine({ kind: 'node-webgpu', adapter: 'a', requested: 'auto' })).toBe('[lions] renderer: webgpu (a)');
    expect(backendLogLine({ kind: 'node-webgl2', adapter: 'webgl2', reason: 'no adapter', requested: 'auto' })).toBe('[lions] renderer: webgl2 fallback: no adapter');
  });
  it('only a node request loads the second chunk', () => {
    expect(wantsNodeBackend(undefined)).toBe(false);
    expect(wantsNodeBackend('legacy')).toBe(false);
    expect(wantsNodeBackend('auto')).toBe(true);
  });
});
