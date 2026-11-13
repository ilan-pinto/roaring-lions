/**
 * GH-1152 (12 Nov): how a fixed-capacity per-frame batch hands its attributes to the renderer.
 *
 * The overlay batch (`overlays.ts`) and the tracer, shell and bolt batches (`fx.ts`) are sized for the worst frame and rewritten from
 * vertex 0 every frame, with the draw range trimmed to what was written. Marking the whole attribute `needsUpdate` uploads the whole
 * capacity: on the node WebGPU backend at n600 on `wadi_halam_4` that is 23 `writeBuffer` calls and 5.4-6.4 MiB a frame (the overlay
 * batch alone 3.7 MiB for 2,880 drawn vertices, the tracers about 0.9 MiB at a draw range of 0), and its `writeBuffer` was 1.7 ms of
 * the frame's CPU render in the 12 Nov Metal profile.
 *
 *  - `'capacity'`: `needsUpdate` on every attribute, every frame. Exactly the code this replaced; the legacy renderer always gets it.
 *  - `'drawn'`: an update range over the drawn prefix only (`[0, vertices * itemSize)`), replacing any range left from an earlier
 *    frame, and NO upload at all when nothing was drawn (a draw range of 0 reads no vertex, and an attribute with no range would
 *    upload in full). The vertices past the prefix keep stale GPU data that no draw reads.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { BatchUploadsMode } from '../backend/node-draw-options';

export type { BatchUploadsMode };

/** The members of a three `BufferAttribute` this writes. */
export interface FrameUploadAttribute {
  readonly itemSize: number;
  readonly array: { readonly BYTES_PER_ELEMENT: number };
  readonly updateRanges: readonly { start: number; count: number }[];
  set needsUpdate(value: boolean);
  clearUpdateRanges(): void;
  addUpdateRange(start: number, count: number): void;
}

/** Marks `attrs` for upload after a frame that wrote `vertices` vertices from vertex 0 (see the file comment for the two modes). */
export function markFrameUpload(attrs: readonly FrameUploadAttribute[], vertices: number, mode: BatchUploadsMode): void {
  if (mode === 'capacity') {
    for (const a of attrs) a.needsUpdate = true;
    return;
  }
  if (!(vertices > 0)) return;
  for (const a of attrs) {
    const count = vertices * a.itemSize;
    a.clearUpdateRanges();
    // WebGPU's `writeBuffer` takes a size that is a multiple of 4 bytes; every batch here is float32, so this never falls back.
    if ((count * a.array.BYTES_PER_ELEMENT) % 4 === 0) a.addUpdateRange(0, count);
    a.needsUpdate = true;
  }
}
