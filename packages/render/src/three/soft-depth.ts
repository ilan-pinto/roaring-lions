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
 * `SoftDepthSnapshot` is WebGL2 only. Its node twin is `NodeSoftDepthCopy` below (GH-1227 slice 3, the design's section 5, W1):
 * the same sentinel at the same band, whose `onBeforeRender` asks the node renderer to copy the scene pass's depth
 * (`copyFramebufferToTexture`: three's WebGPU backend ends the render pass, copies on the same encoder and resumes it with `load`).
 * That copy needs a copyable depth aspect, so the node scene pass renders `depth32float-stencil8` while (and only while) the copy
 * exists (`post-chain.node.ts`'s `nodeSoftDepthOn`).
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
  getScissorTest(): boolean;
  setScissorTest(on: boolean): void;
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

/**
 * The sentinel both backends use: a transparent mesh at `SOFT_DEPTH_SNAPSHOT_RENDER_ORDER` (the first transparent draw, so the
 * depth at its turn is exactly the opaque world's) that draws ZERO vertices and writes no colour, depth or stencil, has no `normal`
 * attribute (so the AO pre-pass, `isAoOccluder`, never draws it) and casts no shadow. Hidden until a consumer is (`sync`).
 */
function softDepthSentinel(onBeforeRender: (renderer: unknown) => void): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
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
  const sentinel = new THREE.Mesh(geometry, material);
  sentinel.name = 'soft-depth-sentinel';
  sentinel.renderOrder = SOFT_DEPTH_SNAPSHOT_RENDER_ORDER;
  sentinel.frustumCulled = false;
  sentinel.castShadow = false;
  sentinel.receiveShadow = false;
  sentinel.visible = false;
  sentinel.onBeforeRender = (renderer) => onBeforeRender(renderer);
  return sentinel;
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
    this.sentinel = softDepthSentinel((renderer) => {
      this.capture(renderer as unknown as SoftDepthRenderer);
    });
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
    // `blitFramebuffer` honours the scissor test, so a scissored frame would copy only its rectangle: off for the copy, then restored.
    const scissor = renderer.getScissorTest();
    if (scissor) renderer.setScissorTest(false);
    renderer.initRenderTarget(this.target);
    renderer.copyTextureToTexture(src.depthTexture, this.depthTexture);
    renderer.setRenderTarget(src);
    if (scissor) renderer.setScissorTest(true);
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

// ---------------------------------------------------------------------------------------------------------------------------------
// GH-1227 slice 3: the node (WebGPU) backend's copy. The design's section 5, option W1.
// ---------------------------------------------------------------------------------------------------------------------------------

/** The slice of the node renderer (`WebGPURenderer`) a node copy uses; a test hands in a recorder. */
export interface NodeSoftDepthRenderer {
  getRenderTarget(): THREE.RenderTarget | null;
  copyFramebufferToTexture(texture: THREE.Texture): void;
}

/**
 * The node backend's twin of `SoftDepthSnapshot`. Same sentinel, same band, same `sync`; what differs is the copy. Mid-pass, the
 * node renderer's `copyFramebufferToTexture` ends the scene pass's render pass, copies the depth attachment into this texture on
 * the SAME command encoder (so the copy sees every opaque draw before it) and begins the pass again with `load`, which is exactly
 * what three's own `viewportDepthTexture()` does. The flipbook twin samples `depthTexture` (`flipbook-fx.node.ts`, a depth-only
 * view, so `texture_depth_2d`).
 *
 * A texture-to-texture copy needs the two formats EQUAL, and WebGPU does not copy the depth aspect of `depth24plus-stencil8` (the
 * scene pass's format when soft particles are off). So this texture is `depth32float-stencil8` (`DepthStencilFormat` +
 * `FloatType`), and the scene pass switches to the same format only while a copy exists (`post-chain.node.ts`, `nodeSoftDepthOn`):
 * with the flag off neither is built and the pass is today's.
 *
 * It copies only while the bound target IS the current scene pass's (`sceneTarget`, re-read every time: the chain is rebuilt on a
 * preset change), so the AO pre-pass, the sun's shadow map, `photographGround` and a capture view never resize or overwrite it,
 * and only when that target's depth is the copyable type (a mismatch is a backend error, never a silent wrong copy).
 */
export class NodeSoftDepthCopy implements SoftDepthSource {
  readonly sentinel: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Unread on the node path (the twin samples at `screenUV`); kept so this is a `SoftDepthSource` like the legacy snapshot. */
  readonly invSize = new THREE.Vector2(1, 1);
  readonly depthTexture: THREE.DepthTexture;
  /** Copies taken (tests and debugging). */
  captures = 0;

  /** `sceneTarget`: the node chain's CURRENT scene pass target (`NodePostChain.scenePass.renderTarget`), or null before one exists. */
  constructor(private readonly sceneTarget: () => THREE.RenderTarget | null) {
    const t = new THREE.DepthTexture(1, 1, THREE.FloatType);
    t.format = THREE.DepthStencilFormat;
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    this.depthTexture = t;
    this.sentinel = softDepthSentinel((renderer) => {
      this.capture(renderer as NodeSoftDepthRenderer);
    });
  }

  /** As `SoftDepthSnapshot.sync`: the sentinel draws only while a consumer does, so an idle frame copies nothing. */
  sync(consumers: readonly THREE.Object3D[]): void {
    this.sentinel.visible = consumers.some((c) => c.visible);
  }

  /** Copies the scene pass's depth if the bound target is the scene pass's own. Returns whether it copied. */
  capture(renderer: NodeSoftDepthRenderer): boolean {
    const src = renderer.getRenderTarget();
    if (src === null || src !== this.sceneTarget()) return false;
    const depth = src.depthTexture;
    if (!depth || depth.type !== this.depthTexture.type || depth.format !== this.depthTexture.format) return false;
    const image = this.depthTexture.image as { width: number; height: number };
    if (image.width !== src.width || image.height !== src.height) {
      image.width = src.width;
      image.height = src.height;
      this.invSize.set(1 / src.width, 1 / src.height);
      // A new size is a new GPU texture: the node renderer recreates a depth texture whose version moved.
      this.depthTexture.needsUpdate = true;
    }
    renderer.copyFramebufferToTexture(this.depthTexture);
    this.captures++;
    return true;
  }

  dispose(): void {
    this.sentinel.removeFromParent();
    this.sentinel.geometry.dispose();
    this.sentinel.material.dispose();
    this.depthTexture.dispose();
  }
}
