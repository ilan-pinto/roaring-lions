// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { withGroundPhoto } from './ground-photo';

beforeAll(() => {
  if (typeof globalThis.ImageData === 'undefined') {
    class ImageDataShim {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    }
    (globalThis as { ImageData?: unknown }).ImageData = ImageDataShim;
  }
});

/** 1 x 2, bottom row red, top row blue (GL order). */
const gl = (): ImageData => new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), 1, 2);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('withGroundPhoto', () => {
  it('legacy is SYNCHRONOUS: then has run before the call returns, rows flipped', () => {
    const then = vi.fn();
    withGroundPhoto({ backendInfo: () => ({ kind: 'legacy-gl' }), captureGroundAlbedo: gl, captureGroundAlbedoAsync: async () => gl() }, 210, () => false, then);
    expect(then).toHaveBeenCalledTimes(1);
    expect((then.mock.calls[0]?.[0] as ImageData).data[0]).toBe(0);
  });
  it('a node backend awaits the async photograph', async () => {
    const then = vi.fn();
    withGroundPhoto({ backendInfo: () => ({ kind: 'node-webgpu' }), captureGroundAlbedo: () => null, captureGroundAlbedoAsync: async () => gl() }, 210, () => false, then);
    expect(then).not.toHaveBeenCalled();
    await tick();
    expect(then).toHaveBeenCalledTimes(1);
    expect((then.mock.calls[0]?.[0] as ImageData).data[0]).toBe(0);
  });
  it('a screen disposed while the photograph flew writes nothing', async () => {
    const then = vi.fn();
    let disposed = false;
    withGroundPhoto({ backendInfo: () => ({ kind: 'node-webgpu' }), captureGroundAlbedoAsync: async () => gl() }, 210, () => disposed, then);
    disposed = true;
    await tick();
    expect(then).not.toHaveBeenCalled();
  });
  it('a failed photograph is a null, not a lost report', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const then = vi.fn();
    withGroundPhoto({ backendInfo: () => ({ kind: 'node-webgpu' }), captureGroundAlbedoAsync: () => Promise.reject(new Error('lost')) }, 210, () => false, then);
    await tick();
    expect(then).toHaveBeenCalledWith(null);
  });
});
