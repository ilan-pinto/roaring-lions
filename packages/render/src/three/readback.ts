/**
 * GH-943 WebGPU P1 (T8): what comes back from a render-target readback, normalised to ONE layout on every backend, and the
 * generation-guarded memo the async ground photograph lives in. ADDON-FREE and three-free: the node twins import it, and the
 * unit tests run it on literals.
 *
 * **The three layouts a readback can have** (measured in three 0.186.1, not assumed):
 *  - WebGPU (`WebGPUTextureUtils.copyTextureToBuffer`): rows PADDED to a multiple of 256 bytes, the last row unpadded, and
 *    TOP-DOWN (texture row 0 is the top of the image).
 *  - three's own WebGL2 backend (`WebGLTextureUtils.copyTextureToBuffer`): tight, and BOTTOM-UP (`readPixels`).
 *  - the legacy `WebGLRenderer.readRenderTargetPixels`: tight and bottom-up.
 * The app flips `captureGroundAlbedo` / `captureView` rows with `flipRows` because the seam promises rows BOTTOM-UP (`api.ts`), so
 * every backend must hand back the same thing: tight RGBA8, rows bottom-up. That is what `normaliseReadback` does.
 *
 * Presentation only. Nothing here is read by the sim.
 */

export interface ReadbackLayout {
  /** Rows are padded to a multiple of 256 bytes (WebGPU's `bytesPerRow` rule). */
  readonly padded: boolean;
  /** Row 0 is the TOP of the image. */
  readonly topDown: boolean;
}

/** The layout each node backend's `readRenderTargetPixelsAsync` returns. */
export const READBACK_LAYOUT: Readonly<Record<'node-webgpu' | 'node-webgl2', ReadbackLayout>> = Object.freeze({
  'node-webgpu': Object.freeze({ padded: true, topDown: true }),
  'node-webgl2': Object.freeze({ padded: false, topDown: false }),
});

export const BYTES_PER_TEXEL = 4;
export const ROW_ALIGNMENT = 256;

/** WebGPU's `bytesPerRow` for an RGBA8 row `width` texels wide. */
export function paddedRowBytes(width: number): number {
  return Math.ceil((width * BYTES_PER_TEXEL) / ROW_ALIGNMENT) * ROW_ALIGNMENT;
}

/** What WebGPU's copy allocates: every row padded except that the LAST is not. */
export function paddedBufferBytes(width: number, height: number): number {
  return (height - 1) * paddedRowBytes(width) + width * BYTES_PER_TEXEL;
}

/**
 * Tight RGBA8, rows BOTTOM-UP, whatever the backend handed back. Throws on a buffer too short for the layout it is said to have
 * (a silent short read would be a quietly wrong picture).
 */
export function normaliseReadback(raw: ArrayLike<number>, width: number, height: number, layout: ReadbackLayout): Uint8Array<ArrayBuffer> {
  const rowBytes = width * BYTES_PER_TEXEL;
  const stride = layout.padded ? paddedRowBytes(width) : rowBytes;
  const need = layout.padded ? paddedBufferBytes(width, height) : rowBytes * height;
  if (raw.length < need) throw new Error(`readback: ${raw.length} bytes for ${width}x${height} (${need} needed)`);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const src = (layout.topDown ? height - 1 - y : y) * stride;
    const dst = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) out[dst + i] = raw[src + i] ?? 0;
  }
  return out;
}

/**
 * The async ground photograph's memo. A photograph is requested, takes several frames to land, and the ground can change under
 * it (a terrain rebuild, a ground texture arriving). `invalidate()` bumps a GENERATION; a photograph that lands under a newer
 * generation than it started under is DISCARDED, because it describes ground that has since changed. `get` is IDENTITY-STABLE
 * (the same object until the next invalidate), which is the minimap's freshness signal (`captureGroundAlbedo`).
 */
export class AsyncPhotoMemo<T> {
  private gen = 0;
  private photo: T | null = null;
  private photoPx = 0;
  private inflight: { readonly gen: number; readonly px: number; readonly done: Promise<void> } | null = null;

  get generation(): number {
    return this.gen;
  }

  invalidate(): void {
    this.gen++;
    this.photo = null;
    this.photoPx = 0;
  }

  /** The settled photograph at exactly `px`, or null (none yet, a different size, or invalidated). */
  get(px: number): T | null {
    return this.photo !== null && this.photoPx === px ? this.photo : null;
  }

  /** Whether a request for `px` under the current generation is already flying. */
  pending(px: number): boolean {
    return this.inflight !== null && this.inflight.gen === this.gen && this.inflight.px === px;
  }

  /**
   * Start `take` for `px` unless one is flying for this generation and size, and resolve with the photograph that is current
   * afterwards. `take` runs under the generation read NOW; if `invalidate()` ran before it finishes, the result is dropped.
   */
  request(px: number, take: () => Promise<T | null>): Promise<T | null> {
    const have = this.get(px);
    if (have !== null) return Promise.resolve(have);
    if (!this.pending(px)) {
      const gen = this.gen;
      const done = take().then(
        (shot) => {
          if (gen === this.gen && shot !== null) {
            this.photo = shot;
            this.photoPx = px;
          }
        },
        () => undefined
      );
      const entry = { gen, px, done };
      this.inflight = entry;
      void done.then(() => {
        if (this.inflight === entry) this.inflight = null;
      });
    }
    const flying = this.inflight;
    return (flying?.done ?? Promise.resolve()).then(() => this.get(px));
  }

  /** Resolves when nothing is flying. A request started while waiting is waited for too. */
  async settled(): Promise<void> {
    while (this.inflight !== null) await this.inflight.done;
  }
}
