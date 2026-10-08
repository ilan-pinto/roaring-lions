// @vitest-environment jsdom
// The picture (GH-464, spec §4.2, D5): the renderer's RENDER-TARGET capture of
// the world alone, never a readback of the game canvas (black by design with
// `preserveDrawingBuffer` off) and never a DOM rasteriser (which would carry
// the HUD).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PICTURE_QUALITY, PICTURE_WIDTH, SHOT_MAX_BYTES, takePicture, type Encoder } from './picture';

beforeAll(() => {
  // jsdom ships no ImageData (minimap.test.ts shims it the same way).
  if (typeof globalThis.ImageData === 'undefined') {
    class ImageDataShim {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    }
    (globalThis as { ImageData?: unknown }).ImageData = ImageDataShim;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** 1 x 2, bottom row red, top row blue, as GL hands it back (bottom-up). */
const glPixels = (): ImageData => new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), 1, 2);
const blob = (type: string, size = 10): Blob => new Blob([new Uint8Array(size)], { type });

describe('takePicture', () => {
  it('asks the renderer for its view at 1280 px and encodes it as WebP q0.75, the right way up', async () => {
    const captureView = vi.fn(() => glPixels());
    const encode = vi.fn<Encoder>(async (_img, type) => blob(type));
    const p = await takePicture({ captureView }, encode);
    expect(captureView).toHaveBeenCalledWith(PICTURE_WIDTH);
    expect(PICTURE_WIDTH).toBe(1280);
    expect(encode).toHaveBeenCalledTimes(1);
    const [img, type, q] = encode.mock.calls[0];
    expect([type, q]).toEqual(['image/webp', PICTURE_QUALITY]);
    // Top row first after the flip: blue.
    expect([...img.data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    expect(p?.blob.type).toBe('image/webp');
  });

  it('never reads the game canvas: no capture from the renderer is no picture at all', async () => {
    const game = document.createElement('canvas');
    document.body.appendChild(game);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL');
    const encode = vi.fn<Encoder>(async (_img, type) => blob(type));
    expect(await takePicture({}, encode)).toBeNull();
    expect(await takePicture({ captureView: () => null }, encode)).toBeNull();
    expect(encode).not.toHaveBeenCalled();
    expect(toBlob).not.toHaveBeenCalled();
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('falls back to JPEG where WebP cannot be encoded, and drops a picture over 300 KB', async () => {
    const pngOnly = vi.fn<Encoder>(async (_img, type) => blob(type === 'image/webp' ? 'image/png' : type));
    expect((await takePicture({ captureView: glPixels }, pngOnly))?.blob.type).toBe('image/jpeg');
    const huge = vi.fn<Encoder>(async (_img, type) => blob(type, SHOT_MAX_BYTES + 1));
    expect(await takePicture({ captureView: glPixels }, huge)).toBeNull();
  });
});
