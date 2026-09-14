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
 * Fog sits BEFORE ambient occlusion so it reads the RenderPass's own buffer
 * (a pass that swaps leaves the scene depth in the OTHER target); AO is
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
  setFogPass(pass: Pass | null): void;
  setAoPass(pass: Pass | null): void;
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
  // the read buffer without depth, so every other frame the fog pass would
  // sample nothing.
  target.depthTexture = depthStencilTexture(w, h);
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(cssWidth, cssHeight);

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
      composer.setPixelRatio(pr);
      composer.setSize(cw, ch);
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
