/**
 * The fog-of-war post pass (spec §5-6). Reads the RenderPass's depth,
 * reconstructs each pixel's world XZ through the orthographic camera, samples
 * the shroud texture there, and pulls the colour toward a desaturated tint:
 * 85% for never-seen ground, 40% for explored, 0 in sight, blended across the
 * texture's own feather. A pixel with no depth (the clear colour beyond the
 * map) is left alone, and ground OUTSIDE the map's own tile bounds fades to
 * never-seen over one tile -- see `FOG_OFFMAP_FADE_TILES`, which exists
 * because `terrain/skirt.ts` put geometry out there for the first time.
 *
 * `uRevealAll` (C2, shell-upgrade Phase 0 final fix wave): a debug-only
 * uniform that forces every ON-map sample to read as fully seen while
 * leaving the pass itself enabled, so the off-map fade above still runs.
 * The Phase 0 key-art plate capture (retired by the scene-host plan's Task 7)
 * used to reach for `setDebugLayerVisible('fog', false)`, which skipped this
 * whole pass --
 * and with it, `FOG_OFFMAP_FADE_TILES`, the very fade this comment
 * describes -- so the skirt read back as an unshrouded, ClampToEdge-flooded
 * wedge instead of fading to never-seen. `uRevealAll` lets the debug layer
 * remove the FOG-OF-WAR boundary without removing the OFF-MAP one.
 *
 * Sits directly after RenderPass in `post-chain.ts`, so `readBuffer` is the
 * target the scene was just drawn into and `readBuffer.depthTexture` is that
 * scene's depth. That only works because each composer target carries its
 * OWN depth-stencil texture -- see `post-chain.ts`'s own header for the
 * `Texture.copy` chain that made the naive clone share one GL texture
 * between the two buffers, and the explicit second allocation that fixes it.
 *
 * Why this replaces `FogMesh` rather than sitting beside it: a fog QUAD lies
 * flat on its own tile's ground and therefore has to choose between
 * `depthTest: true` (a hostile's raised body pokes straight through the fog
 * hiding it) and `depthTest: false` (a building in an explored tile wears an
 * opaque black slab across its roof, because the quad paints over geometry
 * that is nowhere near the ground plane). The old mesh chose the second, and
 * every fog edge was additionally a tile staircase. Dimming by the world
 * position the DEPTH buffer reports has neither problem: a roof pixel is
 * dimmed by the shroud value at the roof's own footprint, by the same
 * fraction as the ground beside it, so an explored building reads as a
 * darker building rather than a black rectangle.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { WORLD_PER_LEVEL } from './terrain/shared';
import { HAZE_FORWARD, HAZE_LOW_LEVELS, HAZE_RAMP_TILES } from './haze';
import {
  FOG_OFFMAP_FADE_TILES,
  createFogUniformTable,
  hazeLowOf,
  writeCamera,
  writeFocus,
  writeHaze,
  writeShimmer,
  type FogPassLike,
  type FogPassOptions,
  type FogUniformTable,
  type HazeSettings,
} from './fog-spec';
import {
  SHIMMER_K1,
  SHIMMER_K2,
  SHIMMER_KX,
  SHIMMER_MAX_OFFSET_PX,
  SHIMMER_MAX_SITES,
  SHIMMER_NORM,
  SHIMMER_VERTICAL,
  SHIMMER_W1,
  SHIMMER_W2,
  type ShimmerSite,
} from './shimmer';

export { FOG_NEVER_SEEN, FOG_EXPLORED, FOG_TINT_HEX, FOG_TINT_GAIN, FOG_OFFMAP_FADE_TILES } from './fog-spec';
export type { HazeSettings, FogPassOptions } from './fog-spec';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * `uInvProjection * clip` needs no perspective divide because this camera is
 * an `OrthographicCamera` (`ThreeRenderer.viewCamera`), whose inverse
 * projection leaves `w` at exactly 1. If this backend ever grows a
 * perspective view camera, a `view /= view.w` belongs between those two
 * lines.
 *
 * `depth >= 1.0` is the far plane -- nothing was drawn at that pixel, so it
 * is the clear colour outside the map and must be returned untouched. Dimming
 * it would paint a rectangle of fog over the letterboxing around a small map.
 */
/**
 * The dust haze (ground plan 2, Task 9; R-14) runs HERE, inside this pass,
 * for two reasons. This pass already has each pixel's world position, which
 * is the only input the haze needs; and running it BEFORE the fog-of-war mix
 * means the shroud dims hazed ground exactly as it dims any other ground --
 * the haze composes with the fog and never lifts what the fog hides. It sits
 * AFTER the `depth >= 1.0` early-out, so the clear colour around a small map
 * stays the clear colour rather than turning dust-coloured.
 *
 * `hazeAmount` (`haze.ts`) is the same expression; every constant below is
 * interpolated from that file and `terrain/shared.ts`, and `fog-pass.test.ts`
 * pins that the source carries them. `uHazeAmp` is the `haze` debug layer's
 * switch (1 shipped, 0 hidden). An unconfigured pass hazes nothing:
 * `uHazeFar` defaults to 0 and `uHazeRef` to far below any authored level,
 * so no ground counts as low.
 */
function fragmentSource(hazeLow: number): string {
  return /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D uShroud;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform vec2 uMapSize;
uniform vec3 uTint;
uniform float uNeverSeen;
uniform float uExplored;
uniform float uTintGain;
uniform float uRevealAll;
uniform float uOffMapSeen;
uniform vec2 uFocus;
uniform vec3 uHazeTint;
uniform float uHazeFar;
uniform float uHazeRef;
uniform float uHazeAmp;
uniform vec4 uShimmer[${SHIMMER_MAX_SITES}];
uniform int uShimmerCount;
uniform float uShimmerAmp;
uniform float uShimmerAspect;
uniform float uShimmerTime;
uniform vec2 uShimmerPx;
varying vec2 vUv;
void main() {
  // The beam's heat shimmer (E6 chunk C, spec 6.3): the scene-colour SAMPLE is offset inside each
  // site's disc, BEFORE the haze and the shroud below touch it, so the shroud dims a shimmered
  // pixel exactly as it dims any other. uShimmerCount is 0 in every frame without a beam, and the
  // whole block is skipped: vUv is read unchanged and the frame is bit-identical to one from before
  // the shimmer existed. \`shimmerOffsetPx\` (shimmer.ts) is this loop body in TypeScript.
  vec2 rlUv = vUv;
  if (uShimmerCount > 0) {
    for (int rlI = 0; rlI < ${SHIMMER_MAX_SITES}; rlI++) {
      if (rlI >= uShimmerCount) break;
      vec4 rlS = uShimmer[rlI];
      vec2 rlD = vec2((vUv.x - rlS.x) * uShimmerAspect, vUv.y - rlS.y) / rlS.z;
      float rlF = 1.0 - clamp(length(rlD), 0.0, 1.0);
      rlF = rlF * rlF * (3.0 - 2.0 * rlF);
      float rlW1 = sin(rlD.y * ${SHIMMER_K1.toFixed(4)} + uShimmerTime * ${SHIMMER_W1.toFixed(4)});
      float rlW2 = sin(rlD.y * ${SHIMMER_K2.toFixed(4)} - uShimmerTime * ${SHIMMER_W2.toFixed(4)} + rlD.x * ${SHIMMER_KX.toFixed(4)});
      float rlA = uShimmerAmp * rlS.w * rlF * ${SHIMMER_MAX_OFFSET_PX.toFixed(4)} / ${SHIMMER_NORM.toFixed(8)};
      rlUv += vec2((rlW1 + 0.5 * rlW2) / 1.5 * rlA, ${SHIMMER_VERTICAL.toFixed(4)} * rlW2 * rlA) * uShimmerPx;
    }
  }
  vec4 color = texture2D(tDiffuse, rlUv);
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 1.0) { gl_FragColor = color; return; }
  vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProjection * clip;
  vec4 world = uCameraWorld * view;
  float rlAhead = dot(world.xz - uFocus, vec2(${HAZE_FORWARD[0].toFixed(8)}, ${HAZE_FORWARD[1].toFixed(8)}));
  float rlBelow = uHazeRef - world.y / ${WORLD_PER_LEVEL.toFixed(8)};
  float rlHaze = uHazeAmp * (uHazeFar * clamp(rlAhead / ${HAZE_RAMP_TILES.toFixed(4)}, 0.0, 1.0)
                           + ${hazeLow.toFixed(4)} * clamp(rlBelow / ${HAZE_LOW_LEVELS.toFixed(4)}, 0.0, 1.0));
  color.rgb = mix(color.rgb, uHazeTint, rlHaze);
  vec2 tex = vec2(world.x / uMapSize.x, world.z / uMapSize.y);
  float v = texture2D(uShroud, tex).r;
  // uRevealAll is 0 in every shipped frame -- mix(v, 1.0, 0.0) is exactly
  // v, so this is a no-op on the on-map maths unless the debug layer sets
  // it. When it is 1 (the plate capture's fog layer hidden), every ON-map
  // sample reads as fully seen -- but this runs BEFORE the off-map fade
  // below, so ground past the map edge still fades from that reveal toward
  // never-seen over FOG_OFFMAP_FADE_TILES, exactly as it does when the pass
  // is left alone.
  v = mix(v, 1.0, uRevealAll);
  vec2 outUv = max(vec2(0.0), max(-tex, tex - vec2(1.0)));
  v *= 1.0 - clamp(length(outUv * uMapSize) / ${FOG_OFFMAP_FADE_TILES.toFixed(1)}, 0.0, 1.0);
  // A valley backdrop (terrain/backdrop.ts) fades off-map ground to
  // uOffMapSeen instead of never-seen: v(1-r) above plus seen*r here is
  // v(1-r) + seen*r. uOffMapSeen is 0 on every other map, where the added
  // term is an exact +0.0 and the frame is bit-identical to before.
  v += uOffMapSeen * clamp(length(outUv * uMapSize) / ${FOG_OFFMAP_FADE_TILES.toFixed(1)}, 0.0, 1.0);
  float dim = v < 0.5 ? mix(uNeverSeen, uExplored, v * 2.0) : mix(uExplored, 0.0, (v - 0.5) * 2.0);
  float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 shrouded = lum * uTint * uTintGain;
  gl_FragColor = vec4(mix(color.rgb, shrouded, dim), color.a);
}
`;
}
export class FogOfWarPass extends Pass implements FogPassLike {
  readonly uniforms: FogUniformTable;
  readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  /** The low-lying haze's strength, as compiled into this pass's source. */
  readonly hazeLow: number;

  /**
   * `options.hazeLow` is a compile-time constant of the program, not a
   * uniform (the `rlHaze` line interpolates it): absent, it is `HAZE_LOW` and
   * the source is the one every shipped map has always compiled. Only a
   * raining map passes it (GH-871 P4 T2, R-3).
   */
  constructor(shroud: THREE.Texture, mapWidth: number, mapHeight: number, options?: FogPassOptions) {
    super();
    this.hazeLow = hazeLowOf(options);
    this.uniforms = createFogUniformTable(shroud, mapWidth, mapHeight);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: fragmentSource(this.hazeLow),
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.needsSwap = true;
  }

  /**
   * Refreshed every frame, before the composer runs. The camera this reads
   * is `ThreeRenderer.viewCamera`, the same object `RenderPass` holds, and
   * `threeCamera()` reconfigures it in place -- so these two matrices have
   * to be re-copied per frame or the reconstruction would unproject this
   * frame's depth through last frame's camera, which reads on screen as fog
   * sliding a frame behind the terrain whenever the view pans.
   */
  updateCamera(camera: THREE.Camera): void {
    writeCamera(this.uniforms, camera);
  }

  /** The haze's tone, amount and reference level. Set once the preset and
   *  the terrain are known, and again whenever the terrain rebuilds. */
  setHaze(h: HazeSettings): void {
    writeHaze(this.uniforms, h);
  }

  /**
   * The beam's heat shimmer sites for this frame (E6 chunk C, spec 6.3): at most
   * `SHIMMER_MAX_SITES`, written every frame - an empty list is `uShimmerCount = 0`, which skips
   * the whole block. `widthPx`/`heightPx` are the viewport in CSS pixels (the offset's unit);
   * `timeSec` is the SIM clock. NOT written: `uShimmerAmp`, the `beam-shimmer` debug layer's
   * switch, which nothing per-frame re-asserts.
   */
  setShimmer(sites: readonly ShimmerSite[], widthPx: number, heightPx: number, timeSec: number): void {
    writeShimmer(this.uniforms, sites, widthPx, heightPx, timeSec);
  }

  /** The focus plane's anchor: the camera's look-at point, in world units
   *  (world x = tile x, world z = tile y). Written every frame beside
   *  `updateCamera`, since the camera pans. */
  setFocus(x: number, z: number): void {
    writeFocus(this.uniforms, x, z);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  override setSize(): void {
    // Screen-space; nothing to resize.
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
