/**
 * GH-943 P1 (T8): the debrief's ground photograph, which the node backends can only answer ASYNC (a WebGPU readback is).
 *
 * `withGroundPhoto` hands `then` the photograph (rows already flipped top-down) or null. **Legacy stays synchronous**: `then` runs
 * before this returns, exactly as the inline code it replaced did. Only a node backend awaits, and a screen that was disposed
 * meanwhile (`isDisposed`) gets nothing written. A failure is a warning and a null: the painted ground stays.
 */
import { flipRows } from './minimap';

export interface GroundPhotoSource {
  backendInfo?(): { kind: string };
  captureGroundAlbedo?(sizePx: number): ImageData | null;
  captureGroundAlbedoAsync?(sizePx: number): Promise<ImageData | null>;
}

const topDown = (shot: ImageData | null): ImageData | null =>
  shot === null ? null : new ImageData(flipRows(shot.data, shot.width, shot.height), shot.width, shot.height);

export function withGroundPhoto(r: GroundPhotoSource, px: number, isDisposed: () => boolean, then: (photo: ImageData | null) => void): void {
  const failed = (err: unknown): null => {
    console.warn('debrief: the ground photograph failed; the painted ground stays', err);
    return null;
  };
  if (r.backendInfo?.().kind === 'legacy-gl' || r.captureGroundAlbedoAsync === undefined) {
    let photo: ImageData | null;
    try {
      photo = topDown(r.captureGroundAlbedo?.(px) ?? null);
    } catch (err) {
      photo = failed(err);
    }
    then(photo);
    return;
  }
  void r.captureGroundAlbedoAsync(px).then(topDown, failed).then((photo) => {
    if (isDisposed()) return;
    then(photo);
  });
}
