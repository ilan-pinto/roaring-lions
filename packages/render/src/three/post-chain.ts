/**
 * The frame's post chain (spec §5): RenderPass -> [FogOfWarPass] -> [GTAOPass]
 * -> OutputPass -> [VignettePass] -> [SMAAPass].
 *
 * `GTAOPass` and `SMAAPass` are the two passes the quality preset
 * (`../quality.ts`) can remove. `high` -- `QUALITY_PRESETS.high`, the
 * default every caller got before the preset existed -- builds both, so the
 * bracketed chain above is exactly what it always was. `low` builds
 * neither: `RenderPass -> [FogOfWarPass] -> OutputPass -> [VignettePass]`,
 * with fog and the vignette unaffected -- they are not part of the
 * `quality` contract at all, and stay whatever the caller slots through
 * `setFogPass`/`setVignettePass`. `medium` keeps SMAA and drops only AO.
 * SMAA's construction lives in THIS file (`new SMAAPass` below), gated
 * directly on `quality.smaa`; the AO pass is built and owned by the
 * caller (`ThreeRenderer.init`, via `createAoPass`), which is why gating it
 * is a decision NOT to call `createAoPass`/`setAoPass` at all rather than
 * anything this file does -- `setAoPass(null)` and "never called
 * `setAoPass`" look identical from here, and both leave `GTAOPass` out of
 * `passNames`.
 *
 * The vignette is the one pass on the display-referred side of the output
 * transform, and `PostChain.setVignettePass` says why it has to be.
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
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';

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
 * 1440x900 and pixel ratio 2, two samples of each shipped configuration. AO
 * at FULL resolution lands the p95 of the acceptance view (zoom 0.5) at
 * 15.40 ms against a 16.7 ms frame budget -- and takes the two closer views
 * to 20.3-21.7 ms, 3.6-5.0 ms over. At half it costs 2.8-3.7 ms of median
 * across all three and every p95 stays under 13.2. What full resolution buys
 * back is sharpness in the occlusion TERM alone, which a Poisson denoise has
 * already blurred and which the blend lays over a full-resolution frame.
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
 * `GTAOPass` taught the four things this scene needs: that only the opaque
 * world belongs in its G-buffer (`isAoOccluder` above -- without it the
 * picture is unusable, not merely imperfect), that its own targets may run
 * at a fraction of the frame, that its G-buffer render must not drag the
 * sun's shadow map along with it, and that a throw inside that render must
 * not leave half the renderer invisible.
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
/**
 * The seed for the AO pass's Poisson-denoise noise texture, and the reason
 * this renderer builds that texture itself.
 *
 * `GTAOPass`'s own `generateNoise` does `new SimplexNoise()`, and three's
 * `SimplexNoise` defaults its random source to `Math` -- so the 64x64 RGBA
 * texture the denoise samples is a fresh draw from `Math.random()` in every
 * process. Within one process the frame is bit-identical (the visual gate's
 * zero-time repaint control reads 0 px / 0.0000), which is exactly why this
 * hid until the gate compared two SEPARATE captures: with AO in the chain,
 * `quiet` moved 20 px / 0.1021, `relief` 2 px / 0.1418 and `vehicle` 57 px /
 * 0.1051 against a freshly-blessed baseline of the same commit, where the
 * pre-AO renderer read 0-1 px / 0.0000-0.0001 over 73 runs. Almost every
 * pixel shifting by a fraction of a level is the signature: a different
 * denoise kernel offset, not a different scene.
 *
 * A gate whose primary metric is `meanAbsChannelDelta` cannot live with
 * that, and `baseline.ts` is explicit that the fix is to find the drift
 * rather than widen the ceiling. So the noise is seeded instead: the same
 * texture in every process, on every machine, for ever.
 */
const AO_NOISE_SEED = 0x5ea50f21;

/** mulberry32 -- three lines, no dependency, and the only property asked of
 *  it is that it give the same stream from the same seed in every engine.
 *  Shaped as `{ random() }` because that is the interface
 *  `SimplexNoise(r)` wants. */
function seededRandomSource(seed: number): { random(): number } {
  let state = seed >>> 0;
  return {
    random(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

class WorldGTAOPass extends GTAOPass {
  private readonly resolutionScale: number;
  /**
   * Whether `overrideVisibility` has run without its matching restore.
   *
   * A flag rather than an unconditional restore in the `finally` below, and
   * the reason is a trap in r170: `restoreVisibility` is **not idempotent**.
   * It traverses the scene writing `object.visible = cache.get(object)` and
   * then clears the cache -- so a second call reads `undefined` out of the
   * empty cache and assigns it to EVERY object in the scene. `undefined` is
   * falsy, so calling it twice does not "restore twice", it blanks the
   * frame. Verified in `GTAOPass.js`, not assumed.
   */
  private visibilityOverridden = false;

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
   * r170's own noise loop with a SEEDED simplex -- see `AO_NOISE_SEED` for
   * the measurement that made it necessary.
   *
   * The loop is copied rather than delegated because `generateNoise` builds
   * its `SimplexNoise` inline, so there is no seam to inject through short
   * of swapping the global `Math.random` around a `super` call. The output
   * contract is the part that matters and it is narrow: a 64x64 RGBA
   * `DataTexture`, repeat-wrapped, sampled by the Poisson denoise for a
   * per-pixel kernel rotation. Any noise field satisfies it; only
   * REPEATABILITY is at stake here.
   *
   * Called from the BASE constructor (`this.pdNoiseTexture =
   * this.generateNoise()`), which is before this subclass's own field
   * initialisers run -- so it must touch no instance state, and does not.
   */
  override generateNoise(size = 64): THREE.DataTexture {
    const simplex = new SimplexNoise(seededRandomSource(AO_NOISE_SEED));
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const at = (i * size + j) * 4;
        data[at] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
        data[at + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
        data[at + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
        data[at + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
      }
    }
    const noiseTexture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    noiseTexture.wrapS = THREE.RepeatWrapping;
    noiseTexture.wrapT = THREE.RepeatWrapping;
    noiseTexture.needsUpdate = true;
    return noiseTexture;
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
    this.visibilityOverridden = true;
  }

  override restoreVisibility(): void {
    super.restoreVisibility();
    this.visibilityOverridden = false;
  }

  /**
   * Two things wrapped around the base render, both of which cost nothing
   * and one of which was costing a whole shadow pass a frame.
   *
   * **The G-buffer pre-pass must not re-render the sun's shadow map.**
   * `renderOverride` is a full `renderer.render(scene, camera)`, and
   * `WebGLShadowMap.render` runs on every one of those unless it is told
   * otherwise (`autoUpdate === false && needsUpdate === false` is its only
   * early return besides `enabled === false`). So a second 4096 map was
   * being drawn for the whole scene each frame and thrown away: the pre-pass
   * draws through `MeshNormalMaterial`, which consumes no shadows at all.
   * Measured at **0.7-0.9 ms a frame** across the three views of
   * `docs/PERFORMANCE.md`'s own table -- a tenth of the lit renderer's whole
   * frame, bought back for four lines.
   *
   * **This is not the frame-level `shadowMap.autoUpdate = false` that would
   * freeze shadows on moving units** -- that was considered for this branch
   * and ruled out, correctly. The flag is saved, cleared and restored around
   * this ONE nested render; the composer's `RenderPass` has already drawn
   * this frame's shadows by the time the AO pass runs, with `autoUpdate`
   * untouched, and finds it untouched again next frame.
   *
   * **And the `finally` is not defensive decoration.** Between
   * `overrideVisibility` and `restoreVisibility` the base pass has every
   * billboard, tracer, decal, overlay and outline hull in this scene set
   * invisible (this subclass widened that set from three's own points and
   * lines). A throw in there -- a shader compile failure, a lost context, a
   * bad uniform -- would leave them that way for the rest of the session,
   * turning a transient GL error into a permanently half-drawn game.
   */
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean
  ): void {
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      // Only if the base pass did not get as far as its own restore -- see
      // `visibilityOverridden` for why calling it a second time would blank
      // the scene rather than do nothing.
      if (this.visibilityOverridden) this.restoreVisibility();
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
  /**
   * The corner vignette (`./vignette-pass.ts`), slotted AFTER `OutputPass`
   * and BEFORE `SMAAPass` -- the only pass in this chain that runs on
   * display-referred colour, which is why it cannot join fog and AO in the
   * scene-referred stretch before the output transform. See that module's
   * own header for why linear-light darkening is a different operation, and
   * why SMAA still has to be last.
   *
   * Ownership as for `setFogPass` above: the caller disposes what it built.
   */
  setVignettePass(pass: Pass | null): void;
  /** Releases the composer's targets and the four passes this module owns
   *  (RenderPass, OutputPass, SMAAPass, and the composer's own copy pass) --
   *  never a fog, AO or vignette pass handed in from outside. */
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
  // `quality.smaa` gates construction, not merely whether it is slotted --
  // building an SMAAPass nobody adds would still fetch its two lookup
  // textures (`new Image()`, a base64 `src`) for a pass `low` never runs.
  const smaa = quality.smaa ? new SMAAPass(w, h) : null;
  let fogPass: Pass | null = null;
  let aoPass: Pass | null = null;
  let vignettePass: Pass | null = null;

  const rebuild = (): void => {
    composer.passes.length = 0;
    composer.addPass(renderPass);
    if (fogPass) composer.addPass(fogPass);
    if (aoPass) composer.addPass(aoPass);
    composer.addPass(outputPass);
    // Between the output transform and SMAA, and it is the only slot that
    // works: the vignette scales DISPLAY-referred colour (before ACES it
    // would ride the tone curve's shoulder rather than the display ramp),
    // and SMAA edge-detects on the final image, so it stays last.
    if (vignettePass) composer.addPass(vignettePass);
    if (smaa) composer.addPass(smaa);
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
    setVignettePass(pass) {
      vignettePass = pass;
      rebuild();
    },
    dispose() {
      composer.dispose();
      renderPass.dispose();
      outputPass.dispose();
      smaa?.dispose();
    },
  };
}
