import { describe, expect, it } from 'vitest';
import { parseRendererFlag } from './renderer-flag';

describe('load-profile --renderer=', () => {
  it('accepts the three renderers and absence, and refuses a typo', () => {
    expect(parseRendererFlag(undefined)).toBeNull();
    expect(parseRendererFlag('webgpu')).toBe('webgpu');
    expect(parseRendererFlag('webgl2')).toBe('webgl2');
    expect(parseRendererFlag('legacy')).toBe('legacy');
    expect(() => parseRendererFlag('webgp')).toThrow(/must be one of/);
    expect(() => parseRendererFlag('')).toThrow();
  });
});
