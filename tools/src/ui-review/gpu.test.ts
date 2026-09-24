// `resolveGpuBackend`'s precedence (flag, then platform default) and its
// refusals, plus `gpuLaunchArgs`' two argument sets. `shoot.ts` runs at
// import and starts a browser, so everything it decides about which GPU
// backend to launch is decided here, where a test can reach it without a
// real Chromium -- the same reason `./port.ts` has `port.test.ts` rather than
// `shoot.ts` being tested end to end for this.
import { describe, expect, it } from 'vitest';
import { gpuLaunchArgs, resolveGpuBackend } from './gpu';

describe('resolveGpuBackend precedence', () => {
  it('defaults to metal on darwin when no flag is given', () => {
    expect(resolveGpuBackend([], 'darwin')).toBe('metal');
  });

  it('defaults to swiftshader on a non-darwin platform when no flag is given', () => {
    expect(resolveGpuBackend([], 'linux')).toBe('swiftshader');
    expect(resolveGpuBackend([], 'win32')).toBe('swiftshader');
  });

  it('an explicit --gpu=swiftshader overrides the darwin default', () => {
    expect(resolveGpuBackend(['--gpu=swiftshader'], 'darwin')).toBe('swiftshader');
  });

  it('an explicit --gpu=metal overrides a non-darwin default', () => {
    // Recorded red: swapping the platform check in `resolveGpuBackend`
    // (`platform === 'darwin' ? 'metal' : 'swiftshader'` -> the other way
    // round) makes THIS test and "defaults to metal on darwin" fail while
    // leaving every refusal test green -- the precedence tests are what
    // catch a flipped default, not the refusal tests.
    expect(resolveGpuBackend(['--gpu=metal'], 'linux')).toBe('metal');
  });

  it('prefers the flag to the platform default on any platform', () => {
    expect(resolveGpuBackend(['--res=1400x900', '--gpu=swiftshader'], 'darwin')).toEqual('swiftshader');
  });

  it('takes the last --gpu= when one is given twice, as a later flag overrides an earlier one', () => {
    expect(resolveGpuBackend(['--gpu=metal', '--gpu=swiftshader'], 'darwin')).toBe('swiftshader');
  });

  it('does not read a longer flag that merely starts with "--gpu"', () => {
    expect(resolveGpuBackend(['--gpuother=metal'], 'linux')).toBe('swiftshader');
  });
});

describe('resolveGpuBackend refusals', () => {
  it.each(['METAL', 'gpu', 'hardware', '', 'metal ', ' swiftshader'])(
    'refuses --gpu=%j instead of silently falling back to a platform default',
    (raw) => {
      expect(() => resolveGpuBackend([`--gpu=${raw}`], 'darwin')).toThrow(/--gpu=".*" is not a known backend/);
    }
  );

  it('refuses a bare --gpu, which would otherwise serve the platform default while the caller believes otherwise', () => {
    expect(() => resolveGpuBackend(['--gpu', 'metal'], 'darwin')).toThrow('--gpu needs a value');
  });
});

describe('gpuLaunchArgs', () => {
  it('metal args match backend-curve-gate.ts/render-frame-cost.ts exactly', () => {
    expect(gpuLaunchArgs('metal')).toEqual([
      '--use-angle=metal',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--enable-gpu-rasterization',
      '--disable-gpu-sandbox',
    ]);
  });

  it('swiftshader args match the pre-existing default, unchanged', () => {
    expect(gpuLaunchArgs('swiftshader')).toEqual(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
  });
});
