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
 * **WebP only, at most 64 KB** (spec §12.1, the lead's ruling that pictures
 * live in D1): the Worker refuses any other type and drops a WebP over 64 KB.
 * Measured frames ran 45-67 KiB at 1280 px q0.75, so the picture is ENCODED
 * TO FIT: the quality steps down first, and only if the lowest quality is
 * still over does the width step down from 1280. A browser that cannot
 * encode WebP at all (`toBlob` silently hands back PNG) gives no picture --
 * a JPEG would only be refused.
 */
import { flipRows } from '../ui/minimap';

export const PICTURE_WIDTH = 1280;
export const SHOT_MAX_BYTES = 64 * 1024;
/** Tried in order, at each width. 0.75 is the spec's own setting. */
export const PICTURE_QUALITIES: readonly number[] = [0.75, 0.6, 0.45];
/** Tried in order once every quality at the width before was over. */
export const PICTURE_WIDTHS: readonly number[] = [1280, 1024, 800, 640];

export interface PictureSource {
  captureView?(maxWidth: number): ImageData | null;
}

export interface Picture {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
}

/** Top-down pixels to a WebP blob `width` px wide (the aspect kept), or null. */
export type Encoder = (img: ImageData, quality: number, width: number) => Promise<Blob | null>;

export const canvasEncoder: Encoder = (img, quality, width) =>
  new Promise((resolve) => {
    try {
      const src = document.createElement('canvas');
      src.width = img.width;
      src.height = img.height;
      src.getContext('2d')?.putImageData(img, 0, 0);
      const out = document.createElement('canvas');
      out.width = Math.min(width, img.width);
      out.height = Math.max(1, Math.round((img.height * out.width) / img.width));
      const g = out.getContext('2d');
      if (!g) return resolve(null);
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, out.width, out.height);
      out.toBlob((b) => resolve(b), 'image/webp', quality);
    } catch {
      resolve(null);
    }
  });

/** Encode `img` to the first WebP on the ladder that fits under the cap:
 *  every quality at 1280 px first, then the next width down. */
export async function encodeToFit(img: ImageData, encode: Encoder = canvasEncoder): Promise<Picture | null> {
  const widths = [...new Set(PICTURE_WIDTHS.map((w) => Math.min(w, img.width)))];
  for (const width of widths) {
    const height = Math.max(1, Math.round((img.height * width) / img.width));
    for (const quality of PICTURE_QUALITIES) {
      const blob = await encode(img, quality, width);
      // No WebP encoder here: no smaller setting will produce one either.
      if (blob === null || blob.type !== 'image/webp') return null;
      if (blob.size <= SHOT_MAX_BYTES) return { blob, width, height, quality };
    }
  }
  return null;
}

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
  return encodeToFit(img, encode);
}
