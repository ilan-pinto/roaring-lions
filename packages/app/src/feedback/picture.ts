/**
 * The picture a pause-form note attaches (GH-464, spec §4.2, decision D5): the
 * world as the player sees it, through the whole post chain, with no HUD --
 * taken when the Feedback tab opens, so it is the frame the player paused on.
 *
 * It comes from `Renderer.captureView`, a RENDER-TARGET readback, and from
 * nowhere else. The game canvas is never read: with `preserveDrawingBuffer`
 * off its drawing buffer is black, and a DOM rasteriser would photograph the
 * HUD the context already describes in words. A backend with no
 * `captureView` gives no picture, and the checkbox says so.
 *
 * Encoded as WebP, 1280 px wide, q 0.75 (measured 45-90 KiB). A browser that
 * cannot encode WebP (`toBlob` silently hands back PNG) gets JPEG instead,
 * the other type the Worker accepts; anything over 300 KB is not attached.
 */
import { flipRows } from '../ui/minimap';

export const PICTURE_WIDTH = 1280;
export const PICTURE_QUALITY = 0.75;
export const SHOT_MAX_BYTES = 300 * 1024;

export interface PictureSource {
  captureView?(maxWidth: number): ImageData | null;
}

export interface Picture {
  blob: Blob;
  width: number;
  height: number;
}

/** Top-down pixels to a blob of `type`, or null. */
export type Encoder = (img: ImageData, type: 'image/webp' | 'image/jpeg', quality: number) => Promise<Blob | null>;

export const canvasEncoder: Encoder = (img, type, quality) =>
  new Promise((resolve) => {
    try {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      if (!g) return resolve(null);
      g.putImageData(img, 0, 0);
      c.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });

export async function takePicture(r: PictureSource, encode: Encoder = canvasEncoder): Promise<Picture | null> {
  let raw: ImageData | null = null;
  try {
    raw = r.captureView?.(PICTURE_WIDTH) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null) return null;
  // GL rows are bottom-up; a picture is read top-down.
  const img = new ImageData(flipRows(raw.data, raw.width, raw.height), raw.width, raw.height);
  let blob = await encode(img, 'image/webp', PICTURE_QUALITY);
  if (blob === null || blob.type !== 'image/webp') blob = await encode(img, 'image/jpeg', PICTURE_QUALITY);
  if (blob === null || (blob.type !== 'image/webp' && blob.type !== 'image/jpeg') || blob.size > SHOT_MAX_BYTES) return null;
  return { blob, width: img.width, height: img.height };
}
