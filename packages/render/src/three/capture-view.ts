/**
 * `ThreeRenderer.captureView`'s GL half (GH-464): the player's own view, through
 * the whole post chain, read back from a RENDER TARGET -- the picture a
 * feedback note attaches.
 *
 * It is `photographGround`'s pattern with the opposite camera and layer set.
 * That method renders the map top-down with units and overlays hidden and no
 * fog: a minimap photo. This one renders exactly what is on screen -- the
 * live dimetric camera, fog of war, GTAO, the tone map, the vignette, SMAA,
 * every unit and world overlay -- and none of the DOM HUD, which is not in
 * the scene at all. The HUD's facts travel in the note's context instead.
 *
 * **Never the canvas.** `preserveDrawingBuffer` stays off (CLAUDE.md), so the
 * drawing buffer reads back black. The composer is asked to stop short of
 * the screen for one render (`renderToScreen = false`): its last pass then
 * writes into the composer's own target, which `readBuffer` names once the
 * last pass has swapped. That target is HalfFloat (the decals need it), and a
 * half-float target cannot be read back as bytes, so one copy pass resolves
 * it into an 8-bit target at the capture size, which is what is read. The
 * copy is also the downscale: bilinear from the drawing-buffer size to at
 * most `maxWidth`.
 *
 * Rows come back BOTTOM-UP (GL's origin), as `captureGroundAlbedo`'s do; the
 * app flips them with `minimap.ts`'s `flipRows`, which is pure and tested.
 */
import type * as THREE from 'three';

/** The capture's size: the composer target's aspect, at most `maxWidth`
 *  wide, never upscaled. */
export function captureSize(srcW: number, srcH: number, maxWidth: number): { width: number; height: number } {
  const width = Math.max(1, Math.min(Math.round(srcW), Math.round(maxWidth)));
  const height = Math.max(1, Math.round((srcH * width) / Math.max(1, srcW)));
  return { width, height };
}

/** The slice of `EffectComposer` this reads and drives. */
export interface CaptureComposer {
  renderToScreen: boolean;
  readonly readBuffer: { readonly width: number; readonly height: number; readonly texture: THREE.Texture };
  render(deltaTime?: number): void;
}

/** The slice of `WebGLRenderer` this calls. */
export interface CaptureGl {
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  clear(): void;
  readRenderTargetPixels(target: THREE.WebGLRenderTarget, x: number, y: number, w: number, h: number, buffer: Uint8Array): void;
}

export interface CaptureViewDeps {
  gl: CaptureGl;
  composer: CaptureComposer;
  /** An 8-bit RGBA target at the capture size. */
  makeTarget(width: number, height: number): THREE.WebGLRenderTarget;
  /** Draw `from` into `into` (a full-screen copy). */
  copy(into: THREE.WebGLRenderTarget, from: THREE.Texture): void;
}

export interface ViewPixels {
  /** RGBA, rows bottom-up. */
  data: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

export function captureComposerView(d: CaptureViewDeps, maxWidth: number): ViewPixels | null {
  const wasToScreen = d.composer.renderToScreen;
  const wasTarget = d.gl.getRenderTarget();
  let target: THREE.WebGLRenderTarget | null = null;
  try {
    d.composer.renderToScreen = false;
    // Zero elapsed time: a capture is a repaint of the frame the player
    // paused on, never a step of any clock a pass keeps.
    d.composer.render(0);
    const src = d.composer.readBuffer;
    const { width, height } = captureSize(src.width, src.height, maxWidth);
    target = d.makeTarget(width, height);
    d.gl.setRenderTarget(target);
    d.gl.clear();
    d.copy(target, src.texture);
    const data = new Uint8Array(width * height * 4);
    d.gl.readRenderTargetPixels(target, 0, 0, width, height, data);
    return { data, width, height };
  } catch (err) {
    console.warn('[lions] view capture failed; the note goes without a picture:', err);
    return null;
  } finally {
    // Restored whatever happened above: a composer left short of the screen
    // would draw every later frame into a buffer nobody shows.
    d.composer.renderToScreen = wasToScreen;
    d.gl.setRenderTarget(wasTarget);
    target?.dispose();
  }
}
