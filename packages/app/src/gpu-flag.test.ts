import { describe, expect, it } from 'vitest';
import { gpuOf } from './gpu-flag';
import { KNOWN_PARAMS, SANDBOX_FLAGS, unknownParams } from './sandbox-help';

const of = (q: string, sandbox = true) => gpuOf(new URLSearchParams(q), sandbox);

describe('gpuOf (GH-943 P0)', () => {
  it('is absent when the flag is absent: legacy, untouched', () => {
    expect(of('').value).toBeUndefined();
    expect(of('sandbox=wadi_halam_4&tod=dusk').value).toBeUndefined();
    expect(of('').warning).toBeUndefined();
  });
  it.each(['auto', 'webgpu', 'webgl2', 'legacy'])('accepts gpu=%s in the sandbox', (v) => {
    expect(of(`gpu=${v}`).value).toBe(v);
  });
  it('refuses a mission: never on, and says so', () => {
    const r = of('gpu=webgpu', false);
    expect(r.value).toBeUndefined();
    expect(r.warning).toMatch(/sandbox-only/);
  });
  it('reports a typo instead of pretending a backend runs', () => {
    for (const v of ['webgp', '1', '', 'WEBGPU']) {
      const r = of(`gpu=${v}`);
      expect(r.value).toBeUndefined();
      expect(r.warning).toMatch(/not a known value/);
    }
  });
  it('is a known parameter, and NOT a Free play checkbox', () => {
    expect(KNOWN_PARAMS.map((p) => p.name)).toContain('gpu');
    expect(SANDBOX_FLAGS.map((f) => f.name as string)).not.toContain('gpu');
    expect(unknownParams(new URLSearchParams('sandbox=wadi_halam_4&gpu=webgpu'))).toEqual([]);
  });
});
