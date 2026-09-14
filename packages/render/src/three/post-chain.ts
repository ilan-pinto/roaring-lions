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
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';

/** Retina is worth paying for; a 3x phone panel is not, and this canvas is
 *  full-window. 2 caps the drawing buffer at 4x the pixels of a CSS-sized
 *  one, which is where the composer's three full-screen targets stop being
 *  affordable. */
export const PIXEL_RATIO_CAP = 2;

/**
 * Ambient occlusion's reach, in WORLD units -- which on this map means
 * tiles, because the scene is authored one unit to the tile. 0.6 is a
 * contact shadow: the dark seam where a hull meets the ground and where a
 * wall meets the dirt it stands on, and nothing at the scale of a building
 * darkening the street beside it.
 *
 * It is a world figure rather than a screen one because `screenSpaceRadius`
 * is false below, and that is the deliberate opposite of the occlusion
 * outline (`units/silhouette.ts`), whose width is constant in PIXELS. An
 * outline is a readability device and has to stay legible at zoom 0.35; a
 * contact shadow is a claim about the world, so half a tile has to stay half
 * a tile when the camera pulls back or the shading swims as the player
 * zooms.
 */
export const AO_RADIUS_TILES = 0.6;
/** How hard the occlusion falls, before `blendIntensity` decides how much of
 *  it reaches the picture. Above 1 darkens the contact seam without widening
 *  it, which is what this scene wants -- the radius is already small. */
export const AO_SCALE = 1.2;
/**
 * The fraction of the frame the AO's own targets run at, and the reason this
 * pass ships at all. Measured, not chosen -- `docs/PERFORMANCE.md`, "Lit
 * renderer frame cost (2026-09-14)", on an M3 Pro through ANGLE/Metal at
 * 1440x900 and pixel ratio 2, two samples of each configuration. AO at FULL
 * resolution lands the p95 of the acceptance view (zoom 0.5) at 16.0-16.4 ms
 * against a 16.7 ms frame budget -- a pass with no margin -- and takes the
 * two closer views to 21-22 ms. At half it costs 3.6-4.4 ms and every view
 * stays under 15. What full resolution buys back is sharpness in the
 * occlusion TERM alone, which a Poisson denoise has already blurred and
 * which the blend lays over a full-resolution frame.
 */
export const AO_RESOLUTION_SCALE = 0.5;

/**
 * Whether an object belongs in the AO pass's G-buffer -- that is, whether it
 * is a piece of the opaque world whose shape should occlude light.
 *
 * **This scene cannot hand `GTAOPass` its own scene graph unfiltered, and
 * the failure is spectacular rather than subtle.** GTAO re-renders
 * everything through `scene.overrideMaterial = MeshNormalMaterial`, which
 * knows nothing about alpha, stencils or draw order -- so before this filter
 * existed, every unit, vehicle and building on screen came out SOLID BLACK,
 * over correct ground and correct trees. To see it again, or to check
 * anything else about this pass: set `pass.output = GTAOPass.OUTPUT.Normal`
 * in `createAoPass` and the frame becomes the G-buffer GTAO is working from,
 * where the defect is obvious and this predicate's three clauses were read
 * off rather than guessed.
 *
 * 1. **No `normal` attribute.** `units/silhouette.ts`'s inverted outline
 *    hull carries `position` and `aExpand` and nothing else, because its
 *    shader needs nothing else. `MeshNormalMaterial` normalises the missing
 *    attribute's zero vector, gets NaN, and writes BLACK -- and since that
 *    hull is the unit's own silhouette pushed outward, it covers the unit
 *    in both the normal buffer AND the depth buffer GTAO derives from it.
 *    Every billboard, tracer, trail and particle batch in this renderer is
 *    in the same position: a quad whose shape lives in a shader.
 * 2. **Transparent.** The override material draws a cut-out sprite as the
 *    full RECTANGLE and a unit mid-death-fade as a solid body, so a
 *    transparent mesh occludes a shape it does not have.
 * 3. **`depthWrite: false`.** The frame itself does not let these occlude
 *    anything -- decals, overlays, FX. Something that cannot hide what is
 *    behind it must not darken it either.
 *
 * Non-meshes pass: only meshes are drawn by the override material, and
 * `GTAOPass.overrideVisibility` already hides points and lines itself.
 *
 * Nothing opaque in this scene is caught by any of the three -- terrain,
 * decor, buildings, mesh units and their wrecks all carry normals and draw
 * opaque, which is exactly the set that should cast AO.
 */
export function isAoOccluder(object: THREE.Object3D): boolean {
  if (!(object instanceof THREE.Mesh)) return true;
  if (!object.geometry.getAttribute('normal')) return false;
  const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
  return materials.every((material) => !material.transparent && material.depthWrite);
}

/**
 * `GTAOPass` taught the two things this scene needs: that only the opaque
 * world belongs in its G-buffer (`isAoOccluder` above -- without it the
 * picture is unusable, not merely imperfect), and that its own targets may
 * run at a fraction of the frame.
 *
 * **Half resolution has to live in `setSize`**, because the constructor's
 * `width`/`height` are overwritten by `EffectComposer.addPass` (see
 * `createAoPass`). It is sound because every one of the pass's own targets
 * is internal -- the normals, the raw AO and the denoised AO -- while the
 * two quads it draws into the CHAIN's buffer (`copyMaterial`, then
 * `blendMaterial`) are sized by that buffer, not by these. So the frame
 * stays full resolution and the occlusion term is sampled up, which is what
 * a half-res AO is.
 *
 * The constructor does not call `setSize`, so the subclass field is safe to
 * read by the time anything calls it -- verified against r170's source
 * rather than assumed, because a constructor that DID call it would read
 * `resolutionScale` as `undefined` and size every target NaN.
 */
class WorldGTAOPass extends GTAOPass {
  private readonly resolutionScale: number;

  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number, resolutionScale: number) {
    super(scene, camera, Math.max(1, Math.round(width * resolutionScale)), Math.max(1, Math.round(height * resolutionScale)));
    this.resolutionScale = resolutionScale;
  }

  override setSize(width: number, height: number): void {
    super.setSize(
      Math.max(1, Math.round(width * this.resolutionScale)),
      Math.max(1, Math.round(height * this.resolutionScale))
    );
  }

  /**
   * A second traversal rather than a re-implementation: the base method
   * caches the visibility of EVERY object (not only the ones it hides), and
   * the inherited `restoreVisibility` puts back whatever that cache holds --
   * so anything hidden after `super` returns is restored for free, while
   * reaching into `_visibilityCache` to save a pass would mean reaching
   * through the type declarations at every three upgrade.
   */
  override overrideVisibility(): void {
    super.overrideVisibility();
    this.scene.traverse((object) => {
      if (!isAoOccluder(object)) object.visible = false;
    });
  }
}

/**
 * Ground-truth ambient occlusion for the lit scene, slotted after fog.
 *
 * Four things about this pass are worth knowing before changing it.
 *
 * **It needs nothing from the chain but a slot.** By the time it runs the
 * composer has swapped at least once (the fog pass swaps), so
 * `readBuffer.depthTexture` is NOT the scene's depth any more and
 * `fog-pass.ts`'s idiom would silently read the wrong buffer. GTAO sidesteps
 * that by re-rendering the scene itself, through its own normal material,
 * into its own target with its own depth -- so `(scene, camera, w, h)` is
 * genuinely all it takes. It is also where the cost is: one extra full scene
 * render per frame plus three full-screen passes (AO, Poisson denoise,
 * copy+blend).
 *
 * **The camera must be the persistent one.** `GTAOPass` reads
 * `camera.isPerspectiveCamera` ONCE, in its constructor, to set a shader
 * define -- so a camera rebuilt per frame would not merely stop panning (the
 * reason `viewCamera` is a field in the first place), it would bake the
 * wrong projection into the AO shader. Near/far, the projection and the
 * world matrix are re-read every frame, so panning and zooming are live.
 *
 * **`width`/`height` here are a starting size and nothing more.**
 * `EffectComposer.addPass` calls `pass.setSize(css x pixelRatio)` on every
 * pass it takes, and `setAoPass` rebuilds the chain through `addPass` -- so
 * whatever is passed here is overwritten before the first frame, and the
 * pass always runs at the composer's own drawing-buffer size. Half-
 * resolution AO is therefore NOT `createAoPass(scene, camera, w / 2, h / 2)`
 * (measured: it comes straight back to full size) -- it is
 * `resolutionScale`, which `WorldGTAOPass` applies inside `setSize` itself,
 * where a resize cannot undo it.
 *
 * **`OUTPUT.Default` is the composite**; the other modes render the AO
 * buffer, the normals or the depth to the screen instead. Those are the
 * debug views, and `OUTPUT.Normal` is the one that found this task's only
 * real bug -- see `isAoOccluder`.
 */
export function createAoPass(
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  resolutionScale = 1
): Pass {
  const pass = new WorldGTAOPass(scene, camera, width, height, resolutionScale);
  pass.updateGtaoMaterial({
    radius: AO_RADIUS_TILES,
    scale: AO_SCALE,
    distanceExponent: 1,
    thickness: 1,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  pass.blendIntensity = 1.0;
  pass.output = GTAOPass.OUTPUT.Default;
  return pass;
}

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
