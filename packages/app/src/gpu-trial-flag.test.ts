import { describe, expect, it } from 'vitest';
import { gpuTrialOf } from './gpu-trial-flag';
import { KNOWN_PARAMS, SANDBOX_FLAGS, unknownParams } from './sandbox-help';

const of = (q: string, sandbox = true) => gpuTrialOf(new URLSearchParams(q), sandbox);

describe('gpuTrialOf (GH-943 L5 trial)', () => {
  it('is OFF when the flag is absent: the default path is untouched', () => {
    expect(of('').value).toBeUndefined();
    expect(of('sandbox=wadi_halam_4&tod=dusk').value).toBeUndefined();
    expect(of('').warning).toBeUndefined();
  });
  it('turns on for exactly gpu=webgpu in the sandbox', () => {
    expect(of('gpu=webgpu').value).toBe('webgpu');
  });
  it('refuses a mission: never on, and says so', () => {
    const r = of('gpu=webgpu', false);
    expect(r.value).toBeUndefined();
    expect(r.warning).toMatch(/sandbox-only/);
  });
  it('reports a typo instead of pretending a trial runs', () => {
    for (const v of ['webgp', '1', '', 'webgl2', 'WEBGPU']) {
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
