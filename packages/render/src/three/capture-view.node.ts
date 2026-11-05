/**
 * GH-943 WebGPU P1 (T8): the NODE twin of `capture-view.ts`, plus the node ground photograph. Both are ASYNC, because a WebGPU
 * readback is (`readRenderTargetPixelsAsync`), and both read a RENDER TARGET, never the canvas (`preserveDrawingBuffer` stays off).
 *
 *  - `photographNodeGround`: ONE direct `renderer.render(scene, camera)` into its own HalfFloat target (never through the
 *    pipeline: the pipeline's scene pass redraws once per frameId and carries the fog, AO and vignette a minimap must not have),
 *    then a `renderOutput` QuadMesh (ACES 1.0, sRGB: the same transform the chain ends in) into RGBA8, then the readback.
 *  - `captureNodeView`: the player's view. The pipeline's final node (`RenderPipeline.outputNode`, already display-referred after
 *    SMAA) is drawn by a QuadMesh into an RGBA8 target at the drawing-buffer size, and bilinear-downscaled into one at most
 *    `maxWidth` wide when that is smaller. The downscale is a SECOND pass on purpose: the SMAA node samples at its own texel size,
 *    so the full graph must run at the size it was built for.
 *
 * Rows come back tight and BOTTOM-UP on every backend (`readback.ts`), as the legacy captures' do; the app flips them.
 *
 * ADDON-FREE. `three/webgpu` and `three/tsl` arrive through `NodeCaptureDeps` (the backend's own dynamic imports); only TYPES are
 * imported here. Presentation only.
 */
import * as THREE from 'three';
import type { Node as TslNode, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { READBACK_LAYOUT, normaliseReadback } from './readback';

export interface NodeCaptureDeps {
  readonly W: typeof import('three/webgpu');
  readonly TSL: typeof import('three/tsl');
  readonly renderer: WebGPURenderer;
  readonly kind: 'node-webgpu' | 'node-webgl2';
}

/** Tight RGBA8, rows bottom-up. */
export interface RawPixels {
  readonly data: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

/** The capture's size: the source's aspect, at most `maxWidth` wide, never upscaled (`capture-view.ts`'s rule, restated: that module is legacy). */
export function nodeCaptureSize(srcW: number, srcH: number, maxWidth: number): { width: number; height: number } {
  const width = Math.max(1, Math.min(Math.round(srcW), Math.round(maxWidth)));
  const height = Math.max(1, Math.round((srcH * width) / Math.max(1, srcW)));
  return { width, height };
}

function stencilDepth(): THREE.DepthTexture {
  // Same depth the scene pass has (depth24plus-stencil8): a scene with stencil ops must not meet a target without a stencil plane.
  const t = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type);
  t.format = THREE.DepthStencilFormat;
  return t;
}

function bytesTarget(w: number, h: number): THREE.RenderTarget {
  return new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
}

async function read(d: NodeCaptureDeps, target: THREE.RenderTarget, width: number, height: number): Promise<RawPixels> {
  const raw = (await d.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as unknown as ArrayLike<number>;
  return { data: normaliseReadback(raw, width, height, READBACK_LAYOUT[d.kind]), width, height };
}

/** Draws `node` over the whole of `into` with a QuadMesh; restores nothing (the caller owns the render-target restore). */
function drawNode(d: NodeCaptureDeps, node: TslNode, into: THREE.RenderTarget): void {
  const material = new d.W.NodeMaterial();
  material.fragmentNode = node;
  material.depthTest = false;
  material.depthWrite = false;
  const quad = new d.W.QuadMesh(material);
  try {
    d.renderer.setRenderTarget(into);
    quad.render(d.renderer);
  } finally {
    material.dispose();
  }
}

/** One top-down render of `scene` from `camera` (the caller builds the ortho camera and has already hidden what must not be seen). */
export async function photographNodeGround(d: NodeCaptureDeps, scene: THREE.Scene, camera: THREE.Camera, size: number): Promise<RawPixels> {
  const depthTexture = stencilDepth();
  const linear = new THREE.RenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, depthTexture });
  const encoded = bytesTarget(size, size);
  const was = d.renderer.getRenderTarget();
  try {
    d.renderer.setRenderTarget(linear);
    d.renderer.clear();
    d.renderer.render(scene, camera);
    drawNode(d, d.TSL.renderOutput(d.TSL.texture(linear.texture), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace), encoded);
    d.renderer.setRenderTarget(was);
    return await read(d, encoded, size, size);
  } finally {
    d.renderer.setRenderTarget(was);
    encoded.dispose();
    linear.dispose();
    depthTexture.dispose();
  }
}

/** The player's view through the whole pipeline, at most `maxWidth` wide. */
export async function captureNodeView(d: NodeCaptureDeps, pipeline: RenderPipeline, maxWidth: number): Promise<RawPixels> {
  const drawing = d.renderer.getDrawingBufferSize(new THREE.Vector2());
  const srcW = Math.max(1, Math.round(drawing.x));
  const srcH = Math.max(1, Math.round(drawing.y));
  const { width, height } = nodeCaptureSize(srcW, srcH, maxWidth);
  const full = bytesTarget(srcW, srcH);
  const small = width === srcW && height === srcH ? null : bytesTarget(width, height);
  const was = d.renderer.getRenderTarget();
  try {
    drawNode(d, pipeline.outputNode, full);
    if (small !== null) drawNode(d, d.TSL.texture(full.texture), small);
    d.renderer.setRenderTarget(was);
    return await read(d, small ?? full, width, height);
  } finally {
    d.renderer.setRenderTarget(was);
    small?.dispose();
    full.dispose();
  }
}
