// @vitest-environment jsdom
// The picture (GH-464, spec §4.2, D5, §12.1): the renderer's RENDER-TARGET
// capture of the world alone -- never a readback of the game canvas (black
// with `preserveDrawingBuffer` off), never a DOM rasteriser (it would carry
// the HUD) -- encoded as WebP and FITTED under the Worker's 64 KB.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeToFit, PICTURE_QUALITIES, PICTURE_WIDTH, SHOT_MAX_BYTES, takePicture, type Encoder } from './picture';

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

/**
 * A synthetic frame, 1280 x 720, whose "busyness" is the share of pixels that
 * differ from their left neighbour: flat ground near 0, a firefight near 1.
 */
function frame(busy: number, seed = 7): ImageData {
  const w = 1280;
  const h = 720;
  const d = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  for (let i = 0; i < w * h; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = (s / 0x7fffffff) < busy ? (s >> 16) & 255 : i > 0 ? d[(i - 1) * 4] : 128;
    d.set([v, v, v, 255], i * 4);
  }
  return new ImageData(d, w, h);
}
const busyness = (img: ImageData): number => {
  let n = 0;
  for (let i = 1; i < img.width * img.height; i++) if (img.data[i * 4] !== img.data[(i - 1) * 4]) n++;
  return n / (img.width * img.height);
};
/**
 * A WebP size model fitted to the spec's measurements (§4.2: 45 KiB for an
 * idle frame and 67 KiB for heavy combat at 1280 px q0.75): size scales with
 * the frame's busyness, with the pixel count, and down with quality.
 */
const QUALITY_GAIN: Record<number, number> = { 0.75: 1, 0.6: 0.82, 0.45: 0.68 };
const modelEncoder = (kibAtBusy1: number): Encoder =>
  vi.fn<Encoder>(async (img, q, width) => {
    const kib = (40 + (kibAtBusy1 - 40) * busyness(img)) * (width / 1280) ** 2 * (QUALITY_GAIN[q] ?? 1);
    return blob('image/webp', Math.round(kib * 1024));
  });

describe('takePicture', () => {
  it('asks the renderer for its view at 1280 px and encodes it as WebP q0.75, the right way up', async () => {
    const captureView = vi.fn(() => glPixels());
    const encode = vi.fn<Encoder>(async () => blob('image/webp'));
    const p = await takePicture({ captureView }, encode);
    expect(captureView).toHaveBeenCalledWith(PICTURE_WIDTH);
    expect(PICTURE_WIDTH).toBe(1280);
    const [img, q] = encode.mock.calls[0];
    expect(q).toBe(0.75);
    // Top row first after the flip: blue.
    expect([...img.data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    expect(p?.blob.type).toBe('image/webp');
  });

  it('never reads the game canvas: no capture from the renderer is no picture at all', async () => {
    const game = document.createElement('canvas');
    document.body.appendChild(game);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL');
    const encode = vi.fn<Encoder>(async () => blob('image/webp'));
    expect(await takePicture({}, encode)).toBeNull();
    expect(await takePicture({ captureView: () => null }, encode)).toBeNull();
    expect(encode).not.toHaveBeenCalled();
    expect(toBlob).not.toHaveBeenCalled();
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('is WebP or nothing: a browser that cannot encode WebP gives no picture, never a JPEG', async () => {
    const pngOnly = vi.fn<Encoder>(async () => blob('image/png'));
    expect(await takePicture({ captureView: glPixels }, pngOnly)).toBeNull();
    expect(pngOnly).toHaveBeenCalledTimes(1);
  });
});

describe('encodeToFit (64 KB, spec §12.1)', () => {
  it('keeps an idle frame at 1280 px q0.75, encoded once', async () => {
    const enc = modelEncoder(67);
    const p = await encodeToFit(frame(0), enc);
    expect([p?.width, p?.height, p?.quality]).toEqual([1280, 720, 0.75]);
    expect(enc).toHaveBeenCalledTimes(1);
  });

  it('fits a synthetic busy frame (67 KiB at q0.75) by stepping the QUALITY down first', async () => {
    const busy = frame(1);
    expect(busyness(busy)).toBeGreaterThan(0.95);
    const enc = modelEncoder(67);
    const p = await encodeToFit(busy, enc);
    expect(p?.blob.size).toBeLessThanOrEqual(SHOT_MAX_BYTES);
    expect([p?.width, p?.quality]).toEqual([1280, 0.6]);
  });

  it('steps the WIDTH down from 1280 only once every quality at 1280 was over', async () => {
    const enc = modelEncoder(134);
    const p = await encodeToFit(frame(1), enc);
    expect(p?.blob.size).toBeLessThanOrEqual(SHOT_MAX_BYTES);
    expect([p?.width, p?.height, p?.quality]).toEqual([1024, 576, 0.45]);
    const tried = (enc as ReturnType<typeof vi.fn<Encoder>>).mock.calls.map(([, q, w]) => `${w}@${q}`);
    expect(tried).toEqual([...PICTURE_QUALITIES.map((q) => `1280@${q}`), ...PICTURE_QUALITIES.map((q) => `1024@${q}`)]);
  });

  it('gives up rather than send a picture the Worker would drop', async () => {
    const p = await encodeToFit(frame(1), modelEncoder(2000));
    expect(p).toBeNull();
  });
});
