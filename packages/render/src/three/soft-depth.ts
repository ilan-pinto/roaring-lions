/**
 * GH-1227 slice 1: soft particles, the depth source. Design:
 * `docs/superpowers/specs/2026-11-11-soft-particles-design.md`.
 *
 * A soft particle fades its alpha by how far in front of the opaque world it is, so a smoke billow
 * meets the ground or a wall in a soft band rather than a hard line. That needs the scene's depth
 * WHILE the billow draws, and the only depth there is the attachment of the very target the billow
 * draws into: sampling it is a WebGL2 feedback loop (INVALID_OPERATION, the draw is dropped; the
 * same trap `post-chain.ts`'s header describes for the composer's two targets).
 *
 * So the depth is COPIED once per frame, at the boundary between three's opaque and transparent
 * lists, by a sentinel: a transparent mesh at `SOFT_DEPTH_SNAPSHOT_RENDER_ORDER` (the first
 * transparent draw) that draws zero vertices and writes nothing, whose `onBeforeRender` blits the
 * current target's depth into this module's own texture (`copyTextureToTexture`, a
 * `blitFramebuffer` of the depth bit in three r186) and rebinds the target. Nothing new is
 * rendered: no pre-pass, no second scene walk, no draw-order change. The cost is one depth blit
 * and the render-pass break it forces on a tiler (the design's cost section).
 *
 * The sentinel copies only from a target it was GIVEN (the composer's two buffers), so a nested
 * render into any other target (`photographGround`, a capture view, GTAO's G-buffer, which hides
 * it anyway: no `normal` attribute) never resizes or overwrites the snapshot. It is visible only
 * while a consumer is (`sync`), so an idle frame pays nothing.
 *
 * WebGL2 only. The node backend never builds one (the twin is the design's WebGPU section).
 * Presentation only. Nothing here is read by the sim.
 */
import * as THREE from 'three';
import type { Ops } from './fog-ops';
import { SOFT_DEPTH_SNAPSHOT_RENDER_ORDER } from './units/render-order';

/** The fade band, per unit of the billow's drawn size: a billow is fully opaque this far (times its size) in front of the scene. */
export const SOFT_PARTICLE_RANGE_PER_SIZE = 0.35;
/** The narrowest fade band, in world units, so a tiny puff still fades rather than cutting. */
export const SOFT_PARTICLE_MIN_RANGE = 0.05;

/**
 * The soft fade, written once against `Ops<T>` (the GLSL below and the future node twin share it). `sceneDepth` and `fragDepth` are
 * window depths (0..1) of the opaque scene and of the billow's fragment; `depthSpan` is the camera's `far - near`, which turns an
 * orthographic depth difference into world units; `size` is the billow's drawn size. 0 at contact or behind, 1 at the band's far edge.
 */
export function softParticleFadeOps<T>(o: Ops<T>, sceneDepth: T, fragDepth: T, depthSpan: T, size: T): T {
  const gap = o.mul(o.sub(sceneDepth, fragDepth), depthSpan);
  const range = o.max(o.lit(SOFT_PARTICLE_MIN_RANGE), o.mul(size, o.lit(SOFT_PARTICLE_RANGE_PER_SIZE)));
  return o.smoothstep(o.lit(0), range, gap);
}

/** The same maths in GLSL, for the legacy flipbook's fragment shader (`flipbook-fx.ts`'s `softFlipbookShaders`). */
export const SOFT_PARTICLE_GLSL = /* glsl */ `
  uniform highp sampler2D uSoftDepth;
  uniform vec2 uSoftInvSize;
  uniform float uSoftSpan;
  float rlSoftFade(float sceneDepth, float fragDepth, float span, float size) {
    float gap = (sceneDepth - fragDepth) * span;
    float range = max(${SOFT_PARTICLE_MIN_RANGE.toFixed(3)}, size * ${SOFT_PARTICLE_RANGE_PER_SIZE.toFixed(3)});
    return smoothstep(0.0, range, gap);
  }
`;

/** What a consumer binds: the snapshot's depth texture and one over its size (a vector shared by reference, written at capture). */
export interface SoftDepthSource {
  readonly depthTexture: THREE.DepthTexture;
  readonly invSize: THREE.Vector2;
}

/** The slice of `WebGLRenderer` a capture uses; a test hands in a recorder. */
export interface SoftDepthRenderer {
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  initRenderTarget(target: THREE.WebGLRenderTarget): void;
  copyTextureToTexture(src: THREE.Texture, dst: THREE.Texture): void;
}

function depthStencilTexture(w: number, h: number): THREE.DepthTexture {
  // The composer's depth is `DepthStencilFormat` / `UnsignedInt248Type` (`post-chain.ts`); a depth blit needs the SAME format.
  const t = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type);
  t.format = THREE.DepthStencilFormat;
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/**
 * Whether a consumer will draw this frame. A mesh is on when it is visible; an `InstancedMesh` is also off while its `count` is 0
 * (`ParticleInstancer` keeps its mesh visible and drops the count when it has nothing to draw), or an idle particle tier would take
 * a snapshot every frame.
 */
function consumerDraws(c: THREE.Object3D): boolean {
  if (!c.visible) return false;
  const im = c as THREE.InstancedMesh;
  return im.isInstancedMesh !== true || im.count > 0;
}

export class SoftDepthSnapshot implements SoftDepthSource {
  /** The sentinel: add it to the scene. */
  readonly sentinel: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly invSize = new THREE.Vector2(1, 1);
  /** Snapshots taken (tests and debugging). */
  captures = 0;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly sources: ReadonlySet<THREE.WebGLRenderTarget>;

  /** `sources`: the targets a snapshot may be copied FROM (the composer's two buffers). Anything else is ignored. */
  constructor(sources: readonly THREE.WebGLRenderTarget[]) {
    this.sources = new Set(sources);
    // A colour attachment is only there to make the framebuffer complete: one byte a pixel, never written.
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: true,
      samples: 0,
    });
    this.target.depthTexture = depthStencilTexture(1, 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({
      name: 'rl-soft-depth-sentinel',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      colorWrite: false,
    });
    this.sentinel = new THREE.Mesh(geometry, material);
    this.sentinel.name = 'soft-depth-sentinel';
    this.sentinel.renderOrder = SOFT_DEPTH_SNAPSHOT_RENDER_ORDER;
    this.sentinel.frustumCulled = false;
    this.sentinel.castShadow = false;
    this.sentinel.receiveShadow = false;
    this.sentinel.visible = false;
    this.sentinel.onBeforeRender = (renderer) => {
      this.capture(renderer as unknown as SoftDepthRenderer);
    };
  }

  get depthTexture(): THREE.DepthTexture {
    return this.target.depthTexture as THREE.DepthTexture;
  }

  /** The sentinel draws only while a consumer does: an idle frame takes no snapshot. Call once a frame, before the render. */
  sync(consumers: readonly THREE.Object3D[]): void {
    this.sentinel.visible = consumers.some(consumerDraws);
  }

  /**
   * Copies the current target's depth, if the current target is one of `sources`, and rebinds that target (the copy leaves no
   * framebuffer bound). Returns whether it copied.
   */
  capture(renderer: SoftDepthRenderer): boolean {
    const src = renderer.getRenderTarget();
    if (src === null || !this.sources.has(src) || !src.depthTexture) return false;
    if (this.target.width !== src.width || this.target.height !== src.height) {
      this.target.setSize(src.width, src.height);
      this.invSize.set(1 / src.width, 1 / src.height);
    }
    renderer.initRenderTarget(this.target);
    renderer.copyTextureToTexture(src.depthTexture, this.depthTexture);
    renderer.setRenderTarget(src);
    this.captures++;
    return true;
  }

  dispose(): void {
    this.sentinel.removeFromParent();
    this.sentinel.geometry.dispose();
    this.sentinel.material.dispose();
    this.target.depthTexture?.dispose();
    this.target.dispose();
  }
}
