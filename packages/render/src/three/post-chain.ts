/**
 * The frame's post chain (spec §5): RenderPass -> [FogOfWarPass] -> [GTAOPass]
 * -> OutputPass -> SMAAPass.
 *
 * Why SMAA on a single-sampled target rather than hardware MSAA: the fog
 * pass reads the RenderPass's depth texture, and a multisampled depth
 * attachment has to be resolved before it can be sampled -- support for that
 * in three r170 is the one thing in this chain nobody here has measured, and
 * the pass that needs it is the higher-value one. SMAA after the output
 * transform is the textbook order (it edge-detects on display-referred
 * colour).
 *
 * Why the target is HalfFloat: the scene renders linear, tone mapping and
 * the sRGB encode happen in OutputPass, so the intermediate must not clip.
 * Why it carries a stencil: `units/silhouette.ts` masks the occlusion
 * outline with a one-bit stencil; on a target with no stencil attachment the
 * test silently always passes and every vehicle grows flat blue patches --
 * measured on the raw renderer, and the same failure on a render target.
 * With a stencil, the depth texture must be `DepthStencilFormat` /
 * `UnsignedInt248Type`.
 *
 * **Each of the composer's two targets carries its OWN depth-stencil
 * texture, and that is what makes the chain work at all**: a pass reads the
 * depth of the buffer it is NOT writing into (Task 10's fog pass does
 * `tDepth = readBuffer.depthTexture` while rendering into `writeBuffer`),
 * which is only sound if those are two different GL textures. Getting there
 * takes an explicit second allocation below, because `EffectComposer` builds
 * `renderTarget2` as `renderTarget1.clone()` and that clone does NOT produce
 * an independent depth texture: `RenderTarget.copy` re-sources the COLOUR
 * texture alone (`this.texture.source = new Source(image)`) and merely
 * `clone()`s the depth one, while `Texture.copy` does `this.source =
 * source.source` -- so the two depth textures share a `Source`, and
 * `WebGLTextures` caches the GL texture per `Source` under a
 * parameters-only key, handing both targets the same `__webglTexture`.
 * Sampling it while it is the depth/stencil attachment of the framebuffer
 * being drawn into is a WebGL2 feedback loop: INVALID_OPERATION, and the
 * draw is dropped.
 *
 * Fog sits BEFORE ambient occlusion so it reads the RenderPass's own buffer
 * (the pass swaps, leaving the scene depth in the other target); AO is
 * self-contained and re-renders normals itself.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';

/** Retina is worth paying for; a 3x phone panel is not, and this canvas is
 *  full-window. 2 caps the drawing buffer at 4x the pixels of a CSS-sized
 *  one, which is where the composer's three full-screen targets stop being
 *  affordable. */
export const PIXEL_RATIO_CAP = 2;

export interface PostChain {
  readonly composer: EffectComposer;
  readonly passNames: readonly string[];
  setSize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  render(): void;
  /**
   * Slot a pass in, or `null` to take it out again.
   *
   * **The chain does not own these two.** `dispose()` below releases only the
   * four passes this module constructed; whoever built the fog pass (Task 10)
   * or the AO pass (Task 13) disposes it, and must do so after taking it out
   * of the chain rather than instead of. Any other split would mean a caller
   * cannot move one pass between chains, or hold one across a
   * `setFogPass(null)` -- and a chain that disposed a pass it was merely
   * handed would make `setFogPass(null); setFogPass(same)` a use-after-free.
   */
  setFogPass(pass: Pass | null): void;
  /** Ownership as for `setFogPass` above: the caller disposes what it built. */
  setAoPass(pass: Pass | null): void;
  /** Releases the composer's targets and the four passes this module owns
   *  (RenderPass, OutputPass, SMAAPass, and the composer's own copy pass) --
   *  never a fog or AO pass handed in from outside. */
  dispose(): void;
}

function depthStencilTexture(w: number, h: number): THREE.DepthTexture {
  const t = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type);
  t.format = THREE.DepthStencilFormat;
  return t;
}

/** A pass's label for `passNames`. Real passes are classes, so their
 *  constructor names the pass (`RenderPass`, `GTAOPass`, Task 10's own
 *  `FogOfWarPass`); a plain-object stand-in -- which is all a test needs to
 *  prove the ORDER -- has constructor `Object` and carries its label in a
 *  `name` field instead. */
function passName(pass: Pass): string {
  if (pass.constructor.name !== 'Object') return pass.constructor.name;
  return (pass as { name?: string }).name ?? 'Pass';
}

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number
): PostChain {
  const w = Math.max(1, Math.round(cssWidth * pixelRatio));
  const h = Math.max(1, Math.round(cssHeight * pixelRatio));
  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: true,
    samples: 0,
  });
  // Set BEFORE the composer is constructed: it builds `renderTarget2` as a
  // `clone()` of this one, and `RenderTarget.copy` clones a depth texture
  // only if the source already has one. Attaching it afterwards would leave
  // the read buffer without depth at all, so the fog pass would sample
  // nothing every other frame.
  target.depthTexture = depthStencilTexture(w, h);
  const composer = new EffectComposer(renderer, target);
  // ...and then give the read buffer a depth texture that is genuinely its
  // own. The clone above shares a `Source` with target 1's, which means one
  // GL texture for both buffers -- see this file's header for the chain from
  // `Texture.copy` to the feedback loop that causes. Disposing the clone
  // first is bookkeeping (nothing has been uploaded yet, so it early-returns)
  // rather than a real free, and it is refcounted per `Source` regardless, so
  // it cannot take target 1's texture with it.
  composer.renderTarget2.depthTexture?.dispose();
  composer.renderTarget2.depthTexture = depthStencilTexture(w, h);
  // `setSize` BEFORE `setPixelRatio`, and the order is not arbitrary. The
  // r170 constructor seeds `_width`/`_height` from the RENDER TARGET's size
  // (already css x pixelRatio), so `setPixelRatio(pr)` -- which re-runs
  // `setSize(_width, _height)` internally -- would resize both targets to
  // css x pr^2 before the real `setSize` brought them back. This way round,
  // `setSize` first rewrites `_width` to the css figure, so the ratio call
  // that follows re-runs it at css x pr, which is the size the targets were
  // constructed at. `ThreeRenderer` passes `renderer.getPixelRatio()`, the
  // same value the constructor read, so in the game this pair resizes
  // nothing at all; `setPixelRatio` still has to be called because the
  // argument and the renderer's own ratio are free to differ.
  composer.setSize(cssWidth, cssHeight);
  composer.setPixelRatio(pixelRatio);

  const renderPass = new RenderPass(scene, camera);
  const outputPass = new OutputPass();
  const smaa = new SMAAPass(w, h);
  let fogPass: Pass | null = null;
  let aoPass: Pass | null = null;

  const rebuild = (): void => {
    composer.passes.length = 0;
    composer.addPass(renderPass);
    if (fogPass) composer.addPass(fogPass);
    if (aoPass) composer.addPass(aoPass);
    composer.addPass(outputPass);
    composer.addPass(smaa);
  };
  rebuild();

  return {
    composer,
    get passNames() {
      return composer.passes.map(passName);
    },
    setSize(cw, ch, pr) {
      // Same order as the constructor above, for one rule rather than two.
      // Here `_width` is already a css figure, so neither order could reach
      // css x pr^2; this order additionally makes the no-op case free (a
      // window resize at an unchanged pixel ratio resizes the targets once,
      // and the ratio call that follows finds nothing to change).
      composer.setSize(cw, ch);
      composer.setPixelRatio(pr);
    },
    render() {
      composer.render();
    },
    setFogPass(pass) {
      fogPass = pass;
      rebuild();
    },
    setAoPass(pass) {
      aoPass = pass;
      rebuild();
    },
    dispose() {
      composer.dispose();
      renderPass.dispose();
      outputPass.dispose();
      smaa.dispose();
    },
  };
}
