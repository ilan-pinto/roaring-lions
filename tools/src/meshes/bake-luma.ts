/**
 * `extras.rl_bake_luma` on every textured vehicle material: the MEAN LINEAR
 * LUMINANCE of its base-colour bake, which is what the runtime soot recolour
 * (`charredTexturedMaterial`, `packages/render/src/three/world-materials.ts`)
 * normalises by and caps against.
 *
 * Written by the wreck pass (`applyWreckPass`), because every vehicle goes
 * through it and the char is the wreck's: export -> running-gear -> kit ->
 * WRECK (stamps this) -> damage -> encode. No new pass, no new step in the
 * order. The damage pass never touches a material, and `pnpm encode:meshes`
 * carries the JSON chunk unchanged (only accessor payloads are Draco'd), so
 * the shipped file declares the same number as the source.
 *
 * Measured, not authored, and measured at EXPORT rather than in the browser:
 * by the time a `MeshStandardMaterial` exists its `ImageBitmap` has been
 * uploaded and detached (Chrome refuses `drawImage` on it -- found the hard
 * way by the mock), and reading the bake back off the GPU per vehicle at boot
 * would be a frame-time cost paid to learn a constant.
 *
 * What "mean luminance" means here, exactly:
 *  - every texel of the decoded image, unweighted (the UV-covered texels were
 *    measured on the four mocked vehicles and agree within 13 %, and under
 *    the cap -- see `charredTexturedMaterial` -- the value only matters for a
 *    bake brighter than the char key, where the agreement is closer still);
 *  - sRGB-decoded per channel with the standard EOTF, the same decode the GPU
 *    applies to an `SRGBColorSpace` texture;
 *  - Rec. 709 weights, the same as `THREE.Color.getLuminance`-style maths and
 *    the runtime shader's `dot(rgb, vec3(0.2126, 0.7152, 0.0722))`;
 *  - times the material's own `baseColorFactor` luminance (1 on every shipped
 *    vehicle), because the GPU multiplies it in too.
 *
 * Rounded to 1e-5 so the JSON chunk is stable across runs.
 */
import type { Document, Material, Texture } from '@gltf-transform/core';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/** The extras key, on the MATERIAL (GLTFLoader hands it over as `userData`). */
export const BAKE_LUMA_KEY = 'rl_bake_luma';

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** sRGB EOTF per 8-bit value, tabulated once. */
const SRGB_TO_LINEAR: Float64Array = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/** Decoded RGBA8 pixels of a JPEG or PNG. Anything else is refused by name. */
export function decodeImage(bytes: Uint8Array, mimeType: string): { width: number; height: number; data: Uint8Array } {
  if (mimeType === 'image/jpeg') {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { width: img.width, height: img.height, data: img.data };
  }
  if (mimeType === 'image/png') {
    const img = PNG.sync.read(Buffer.from(bytes));
    return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
  }
  throw new Error(`bake-luma: cannot decode a ${mimeType || 'typeless'} image -- only image/jpeg and image/png`);
}

/** Mean linear Rec. 709 luminance of RGBA8 pixels (alpha ignored). */
export function meanLinearLuma(data: Uint8Array): number {
  let sum = 0;
  const n = data.length >> 2;
  for (let i = 0; i < data.length; i += 4) {
    sum += LUMA_R * SRGB_TO_LINEAR[data[i]!]! + LUMA_G * SRGB_TO_LINEAR[data[i + 1]!]! + LUMA_B * SRGB_TO_LINEAR[data[i + 2]!]!;
  }
  return n > 0 ? sum / n : 0;
}

/** The value `rl_bake_luma` declares for one material, or null when it has no base-colour bake. */
export function measureBakeLuma(material: Material): number | null {
  const tex: Texture | null = material.getBaseColorTexture();
  if (!tex) return null;
  const image = tex.getImage();
  if (!image) throw new Error(`bake-luma: material "${material.getName()}" names a base-colour texture with no image`);
  const { data } = decodeImage(image, tex.getMimeType());
  const [fr, fg, fb] = material.getBaseColorFactor();
  const factor = LUMA_R * fr + LUMA_G * fg + LUMA_B * fb;
  const luma = meanLinearLuma(data) * factor;
  if (!(luma > 0)) throw new Error(`bake-luma: material "${material.getName()}" measured a mean luminance of ${luma}`);
  return Math.round(luma * 1e5) / 1e5;
}

/**
 * Stamp `rl_bake_luma` on every textured material in `doc`, and remove it
 * from any material that no longer carries a bake (so a re-export that drops
 * the texture cannot keep a stale number). Idempotent: the same image writes
 * the same value.
 */
export function stampBakeLuma(doc: Document): Record<string, number> {
  const out: Record<string, number> = {};
  for (const material of doc.getRoot().listMaterials()) {
    const extras = { ...(material.getExtras() as Record<string, unknown>) };
    const luma = measureBakeLuma(material);
    if (luma === null) {
      delete extras[BAKE_LUMA_KEY];
    } else {
      extras[BAKE_LUMA_KEY] = luma;
      out[material.getName()] = luma;
    }
    material.setExtras(extras);
  }
  return out;
}
