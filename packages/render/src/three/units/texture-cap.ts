// GH-469 saving 3: decode a GLB's textures no larger than a cap, for a view
// that never comes close enough to need them -- the menu's backdrop, where the
// nearest building is a few hundred pixels tall and every bake ships at
// 2048x2048 (21.3 MiB each on the GPU with mips, `pnpm perf:memory`).
//
// The bitmap GLTFLoader decoded is resampled ONCE, by the browser
// (`createImageBitmap`'s `resizeQuality: 'high'`), with the same
// `premultiplyAlpha`/`colorSpaceConversion` three's own `ImageBitmapLoader`
// decodes with, and the full-size one is closed. Aspect ratio is kept; a
// texture already at or under the cap is left alone.
import * as THREE from 'three';

interface Bitmapish {
  readonly width: number;
  readonly height: number;
  close(): void;
}

function isBitmap(v: unknown): v is Bitmapish {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { close?: unknown }).close === 'function' &&
    typeof (v as { width?: unknown }).width === 'number'
  );
}

/** The size a `w` x `h` image is resampled to under `max` per edge. */
export function cappedSize(w: number, h: number, max: number): { width: number; height: number } | null {
  const edge = Math.max(w, h);
  if (edge <= max || edge === 0) return null;
  const s = max / edge;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export type Resampler = (img: Bitmapish, w: number, h: number) => Promise<unknown>;

const resampleLikeThree: Resampler = (img, w, h) =>
  createImageBitmap(img as unknown as ImageBitmap, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: 'high',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });

/** Resample every texture under `root` larger than `max` per edge, once per
 *  source, and mark the textures over it for upload. */
export async function capTextureSize(root: THREE.Object3D, max: number, resample: Resampler = resampleLikeThree): Promise<void> {
  const bySource = new Map<THREE.Source, THREE.Texture[]>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      for (const v of Object.values(mat)) {
        if (v instanceof THREE.Texture) bySource.set(v.source, [...(bySource.get(v.source) ?? []), v]);
      }
    }
  });
  await Promise.all(
    [...bySource].map(async ([source, textures]) => {
      const img: unknown = source.data;
      if (!isBitmap(img)) return;
      const size = cappedSize(img.width, img.height, max);
      if (!size) return;
      const smaller = await resample(img, size.width, size.height);
      source.data = smaller;
      img.close();
      for (const t of textures) t.needsUpdate = true;
    })
  );
}
