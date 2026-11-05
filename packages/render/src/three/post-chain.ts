/**
 * The frame's post chain (spec §5): RenderPass -> [FogOfWarPass] -> [GTAOPass]
 * -> [Bloom] -> OutputPass (vignette inside) -> [SMAAPass].
 *
 * **Bloom (Defilade Task 4, `./bloom.ts`) sits after AO and before
 * OutputPass, and both neighbours are load-bearing** (gap audit §2). AFTER
 * fog (and the haze inside it): fog is a post pass reading the ground depth
 * behind an FX quad, so extracting bright pixels after it keeps a blast over
 * unseen ground dark -- it cannot glow through the shroud and leak what the
 * player has not seen -- and a far, hazed fireball blooms less, which is
 * right. After AO, the textbook order for a contact-seam multiply on the
 * opaque world. BEFORE `OutputPass`: the threshold is a scene-referred
 * luminance (1.0), so the pass must read the linear HalfFloat buffer; after
 * the output transform the values are display-referred and capped at 1, and
 * no threshold could separate a flash from white sand. ACES then compresses
 * the glow with everything else. Like AO it is built by the caller
 * (`ThreeRenderer.init`, gated on `quality.bloom`), so `low` never builds it.
 *
 * `GTAOPass`, the bloom and `SMAAPass` are the three passes the quality
 * preset (`../quality.ts`) can remove. `high` -- `QUALITY_PRESETS.high`, the
 * default every caller got before the preset existed -- builds all three
 * (the bloom since Defilade Task 4, which moves no quiet frame: see
 * `./bloom.ts`). `low` builds none of them:
 * `RenderPass -> [FogOfWarPass] -> OutputPass`, with fog and the vignette
 * unaffected -- they are not part of the `quality` contract at all, and stay
 * whatever the caller slots through `setFogPass` / `vignette.enabled`. `medium` keeps SMAA and drops AO and
 * the bloom (lead, 22 Oct 2026, pending a GPU-timer read of its cost).
 * SMAA's construction lives in THIS file (`new SMAAPass` below), gated
 * directly on `quality.smaa`; the AO pass is built and owned by the
 * caller (`ThreeRenderer.init`, via `createAoPass`), which is why gating it
 * is a decision NOT to call `createAoPass`/`setAoPass` at all rather than
 * anything this file does -- `setAoPass(null)` and "never called
 * `setAoPass`" look identical from here, and both leave `GTAOPass` out of
 * `passNames`.
 *
 * The vignette is the one effect on the display-referred side of the output
 * transform, so it lives at the end of `OutputPass`'s own shader
 * (`PostChain.vignette`) rather than in the scene-referred stretch before it.
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
 * The ground decals depend on it too (`decal-pool.ts`): they are MULTIPLIED
 * onto the lit ground as albedo ratios, and a pale mark (crater lip, rubble,
 * tyre) is a ratio above 1 that an 8-bit target would clamp.
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
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import { OutputVignette } from './vignette-pass';
import { OutputGrade } from './output-grade';
import { AO_RADIUS_TILES, AO_RESOLUTION_SCALE, AO_SCALE, isAoOccluder, seededAoNoiseTexture } from './ao-occluder';
import type { PostChainLike } from './post-chain-shared';

// GH-943 P1 (T2): these moved to `./ao-occluder` (addon-free, shared with the node twin) and are re-exported so no importer moves.
export { AO_RADIUS_TILES, AO_RESOLUTION_SCALE, AO_SCALE, isAoOccluder, seededAoNoiseTexture };
export { POST_CHAIN_ORDER, type PostChainLike, type PostQuality, type PostStageName } from './post-chain-shared';

/** Retina is worth paying for; a 3x phone panel is not, and this canvas is
 *  full-window. 2 caps the drawing buffer at 4x the pixels of a CSS-sized
 *  one, which is where the composer's three full-screen targets stop being
 *  affordable. */
export const PIXEL_RATIO_CAP = 2;

/**
 * **This subclass overrides NO base-class helper, and that is the r186
 * lesson.** Until three r186 it overrode `generateNoise`,
 * `overrideVisibility` and `restoreVisibility`. r186 renamed all three (and
 * `renderOverride`/`renderPass`) to `_`-prefixed internals, while
 * `@types/three` 0.186 still declares the old public names -- so every
 * override still type-checked, `override` keyword and all, and the base
 * class simply stopped calling any of them. Measured on dependabot's #569:
 * the denoise noise went back to `Math.random()` (the cross-process drift
 * `AO_NOISE_SEED` exists to stop) and every outline hull, decal pool,
 * overlay and transparent FX quad went back into the AO G-buffer -- the
 * decal showcase alone moved 367,201 px / 23.34 on `aftermath`.
 *
 * So both jobs are done from the two seams a rename cannot move: the
 * CONSTRUCTOR (the noise texture is swapped onto `pdMaterial` after
 * `super()` returns) and `render()` (the pass's own public entry, which
 * `EffectComposer` calls by name). Hiding non-occluders across the whole of
 * `render` rather than only the G-buffer pre-pass is equivalent: every other
 * draw in it is a full-screen quad in the pass's own private scene.
 */
class WorldGTAOPass extends GTAOPass {
  private readonly resolutionScale: number;

  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number, resolutionScale: number) {
    super(scene, camera, Math.max(1, Math.round(width * resolutionScale)), Math.max(1, Math.round(height * resolutionScale)));
    this.resolutionScale = resolutionScale;
    // The base constructor has already built a `Math.random()` texture and
    // bound it; it was never uploaded, so disposing it frees nothing on the
    // GPU and only keeps the bookkeeping honest.
    this.pdNoiseTexture.dispose();
    this.pdNoiseTexture = seededAoNoiseTexture();
    this.pdMaterial.uniforms.tNoise.value = this.pdNoiseTexture;
  }

  override setSize(width: number, height: number): void {
    super.setSize(
      Math.max(1, Math.round(width * this.resolutionScale)),
      Math.max(1, Math.round(height * this.resolutionScale))
    );
  }

  /**
   * Three things wrapped around the base render.
   *
   * **Only the opaque world reaches the G-buffer** (`isAoOccluder`). Every
   * mesh that fails it is hidden for the duration of the base render and put
   * back in `finally` -- only the ones THIS call hid, so a mesh that was
   * already invisible stays that way, and a second restore cannot happen
   * because the list is local. The base pass still hides points and lines
   * itself; `isAoOccluder` passes every non-mesh, so the two sets are
   * disjoint and neither restore can undo the other.
   *
   * **The G-buffer pre-pass must not re-render the sun's shadow map.** The
   * pre-pass is a full `renderer.render(scene, camera)`, and
   * `WebGLShadowMap.render` runs on every one of those unless it is told
   * otherwise (`autoUpdate === false && needsUpdate === false` is its only
   * early return besides `enabled === false`). So a second 4096 map was
   * being drawn for the whole scene each frame and thrown away: the pre-pass
   * draws through `MeshNormalMaterial`, which consumes no shadows at all.
   * Measured at **0.7-0.9 ms a frame** across the three views of
   * `docs/PERFORMANCE.md`'s own table. The flag is saved, cleared and
   * restored around this ONE nested render; the composer's `RenderPass` has
   * already drawn this frame's shadows by the time the AO pass runs, with
   * `autoUpdate` untouched, and finds it untouched again next frame -- this
   * is not the frame-level freeze that would pin shadows under moving units.
   *
   * **And the `finally` is not defensive decoration.** A throw in the base
   * render -- a shader compile failure, a lost context, a bad uniform --
   * would otherwise leave every billboard, decal, overlay and outline hull
   * invisible for the rest of the session, and (since the base pass sets
   * `scene.overrideMaterial` with no `finally` of its own) the whole scene
   * drawing through `MeshNormalMaterial`.
   */
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean
  ): void {
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const overrideMaterial = this.scene.overrideMaterial;
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((object) => {
      if (object.visible && !isAoOccluder(object)) {
        object.visible = false;
        hidden.push(object);
      }
    });
    renderer.shadowMap.autoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      this.scene.overrideMaterial = overrideMaterial;
      for (const object of hidden) object.visible = true;
    }
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
 * copy+blend). That nested render used to drag a second 4096 shadow pass
 * behind it, for a pre-pass that consumes no shadows -- worth 0.7-0.9 ms a
 * frame, and now suppressed in `WorldGTAOPass.render`.
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

export interface PostChain extends PostChainLike {
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
  /**
   * The selective HDR bloom (`./bloom.ts`), slotted AFTER the AO pass and
   * BEFORE `OutputPass` -- see this file's header for why both neighbours
   * matter. Ownership as for `setFogPass` above: the caller disposes what it
   * built.
   */
  setBloomPass(pass: Pass | null): void;
  /**
   * DEBUG ONLY (the bloom census, `tools/src/perf/bloom-census.ts`): render
   * the chain up to the bloom slot -- RenderPass, fog, AO, and nothing after
   * -- short of the screen, and hand `read` the composer buffer that holds
   * it: the scene-referred HalfFloat picture the bloom's high-pass would
   * threshold. Every later pass's `enabled` and the composer's
   * `renderToScreen` are restored whatever `read` does. Costs nothing per
   * frame: nothing calls it but a harness.
   */
  withPreBloomBuffer<T>(read: (target: THREE.WebGLRenderTarget) => T): T;
  /**
   * The corner vignette (`./vignette-pass.ts`), FOLDED INTO `OutputPass`'s
   * fragment shader (GH-829): it still runs on display-referred colour after
   * the tone map and the sRGB encode and before SMAA, which is the only place
   * it can sit (see that module's header), but it no longer costs a
   * full-screen pass of its own. Starts disabled; `enabled = true` turns it
   * on, and nothing else in the chain moves. It has no pass to own and
   * nothing to dispose: `dispose()` below releases the output pass it lives in.
   */
  readonly vignette: OutputVignette;
  /**
   * The colour grade (look uplift L2, GH-943, `./output-grade.ts`): a 32^3 LUT lookup folded into
   * `OutputPass` BETWEEN the sRGB encode and the vignette. Starts as no grade at all, which is the
   * stock shader byte for byte; `grade.apply(resolved)` compiles the lookup in. An identity grade
   * (day, or no grade) builds nothing.
   */
  readonly grade: OutputGrade;
  /** Releases the composer's targets and the four passes this module owns
   *  (RenderPass, OutputPass, SMAAPass, and the composer's own copy pass) --
   *  never a fog, AO or bloom pass handed in from outside. */
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
  pixelRatio: number,
  quality: RenderQuality = QUALITY_PRESETS.high
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
  const vignette = new OutputVignette(outputPass);
  const grade = new OutputGrade(outputPass);
  // `quality.smaa` gates construction, not merely whether it is slotted --
  // building an SMAAPass nobody adds would still fetch its two lookup
  // textures (`new Image()`, a base64 `src`) for a pass `low` never runs.
  const smaa = quality.smaa ? new SMAAPass() : null;
  let fogPass: Pass | null = null;
  let aoPass: Pass | null = null;
  let bloomPass: Pass | null = null;

  const rebuild = (): void => {
    composer.passes.length = 0;
    composer.addPass(renderPass);
    if (fogPass) composer.addPass(fogPass);
    if (aoPass) composer.addPass(aoPass);
    // After fog and AO, before the output transform: see the header. It
    // blends into the read buffer (`needsSwap` false) and never swaps.
    if (bloomPass) composer.addPass(bloomPass);
    composer.addPass(outputPass);
    // The vignette is inside this pass (`vignette` below), at the end of its shader.
    if (smaa) composer.addPass(smaa);
  };
  rebuild();

  return {
    composer,
    vignette,
    grade,
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
    setBloomPass(pass) {
      bloomPass = pass;
      rebuild();
    },
    withPreBloomBuffer(read) {
      const later = [bloomPass, outputPass, smaa].filter((p): p is Pass => p !== null);
      const wasEnabled = later.map((p) => p.enabled);
      const wasToScreen = composer.renderToScreen;
      try {
        for (const p of later) p.enabled = false;
        composer.renderToScreen = false;
        // Zero elapsed time: a repaint of the frame on screen, never a step
        // of any clock a pass keeps.
        composer.render(0);
        return read(composer.readBuffer);
      } finally {
        later.forEach((p, i) => (p.enabled = wasEnabled[i]));
        composer.renderToScreen = wasToScreen;
      }
    },
    dispose() {
      composer.dispose();
      renderPass.dispose();
      grade.dispose();
      outputPass.dispose();
      smaa?.dispose();
    },
  };
}
