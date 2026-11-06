import { describe, expect, it } from 'vitest';
import { resolveCensusGpu } from './bloom-census-args';

describe('resolveCensusGpu (GH-943 P1 T5)', () => {
  it('no flag: the legacy arm on the platform default hardware, exactly as before', () => {
    const r = resolveCensusGpu(['--only=x'], 'darwin');
    expect(r.arm).toBe('legacy');
    expect(r.hardware).toBe('metal');
    expect(resolveCensusGpu([], 'linux').hardware).toBe('swiftshader');
  });
  it('a hardware value still means the legacy arm on that hardware', () => {
    const r = resolveCensusGpu(['--gpu=swiftshader'], 'darwin');
    expect(r.arm).toBe('legacy');
    expect(r.hardware).toBe('swiftshader');
  });
  it('an arm value picks the renderer; --hw picks the hardware; the webgpu arm adds Dawn/SwiftShader flags', () => {
    const g = resolveCensusGpu(['--gpu=webgpu', '--hw=swiftshader'], 'darwin');
    expect(g.arm).toBe('webgpu');
    expect(g.hardware).toBe('swiftshader');
    expect(g.launchArgs).toContain('--enable-unsafe-webgpu');
    const w = resolveCensusGpu(['--gpu=webgl2'], 'linux');
    expect(w.arm).toBe('webgl2');
    expect(w.launchArgs).not.toContain('--enable-unsafe-webgpu');
  });
  it('the webgpu arm on Metal carries no SwiftShader flag (T9)', () => {
    const g = resolveCensusGpu(['--gpu=webgpu', '--hw=metal'], 'darwin');
    expect(g.launchArgs).toContain('--enable-unsafe-webgpu');
    expect(g.launchArgs).toContain('--use-angle=metal');
    expect(g.launchArgs.join(' ')).not.toMatch(/swiftshader/);
  });
  it('refuses a value that is neither an arm nor a hardware (never a silent fallback)', () => {
    expect(() => resolveCensusGpu(['--gpu=vulkan'], 'linux')).toThrow(/not a known backend/);
    expect(() => resolveCensusGpu(['--gpu=webgpu', '--hw=vulkan'], 'linux')).toThrow(/not a known backend/);
  });
});
