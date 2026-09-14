/**
 * The fog-of-war post pass (spec §5-6). Reads the RenderPass's depth,
 * reconstructs each pixel's world XZ through the orthographic camera, samples
 * the shroud texture there, and pulls the colour toward a desaturated tint:
 * 85% for never-seen ground, 40% for explored, 0 in sight, blended across the
 * texture's own feather. A pixel with no depth (the clear colour beyond the
 * map) is left alone.
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
import { hexToLinear } from './terrain/shared';

export const FOG_NEVER_SEEN = 0.85;
export const FOG_EXPLORED = 0.4;
/** `shadow.1` -- the same key the app hands `RendererOptions.background`. */
export const FOG_TINT_HEX = '#14150F';
/**
 * The shader's `uTint * <this>` -- how far above `FOG_TINT_HEX` the shrouded
 * colour is allowed to sit before the per-pixel luminance scales it down.
 * The one knob this pass leaves open, and it is a WEAK one; the numbers
 * below are measured on `beit_sahwan_outskirts` at zoom 0.5, frame loop
 * frozen and every capture a zero-elapsed-time repaint, so the repaint
 * control moved 0.000 sRGB levels and every delta is real.
 *
 * Mean sRGB at one open, shadow-free tile per fog level, sweeping the gain:
 *
 * | gain | in sight (dim 0) | explored (0.40) | never seen (0.85) |
 * |------|------------------|-----------------|-------------------|
 * | 0    | 177.3/161.6/128.2 | 122.6/106.6/77.1 | 58.0/48.4/31.5 |
 * | 2    | 177.4/161.8/128.3 | 123.8/108.2/78.4 | 61.1/52.1/34.3 |
 * | 10   | 177.8/162.4/129.0 | 128.4/114.0/83.7 | 72.9/65.4/44.9 |
 * | 28   | 178.7/163.6/130.4 | 138.1/125.8/94.7 | 95.6/90.9/65.8 |
 *
 * Three things follow, and the first two correct the reasoning this
 * constant shipped with. **The tint is not what keeps explored ground
 * readable** -- the 60% of the terrain's own colour that survives a 0.40 mix
 * is; at 2.0 the tint adds 1.2 sRGB levels out of 123, about 1%. And **it
 * cannot be turned up into a real look change**: gain 0 and gain 10 are
 * near-indistinguishable by eye, and the tint only begins to dominate the
 * hue around 28.
 *
 * The third is why it stays low. The tint term is weighted by `dim`, so
 * raising it lifts never-seen ground 2.1x as much as explored ground and
 * COMPRESSES the very separation fog exists to communicate: the never-seen /
 * explored luma ratio goes from 0.48 at gain 2 to 0.71 at gain 28. So 2.0
 * sits where it should -- enough to desaturate, not enough to flatten the
 * tiers -- and 0 would remove the only term that desaturates at all.
 */
export const FOG_TINT_GAIN = 2.0;

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
const FRAGMENT = /* glsl */ `
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
varying vec2 vUv;
void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 1.0) { gl_FragColor = color; return; }
  vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProjection * clip;
  vec4 world = uCameraWorld * view;
  vec2 tex = vec2(world.x / uMapSize.x, world.z / uMapSize.y);
  float v = texture2D(uShroud, tex).r;
  float dim = v < 0.5 ? mix(uNeverSeen, uExplored, v * 2.0) : mix(uExplored, 0.0, (v - 0.5) * 2.0);
  float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 shrouded = lum * uTint * uTintGain;
  gl_FragColor = vec4(mix(color.rgb, shrouded, dim), color.a);
}
`;

export class FogOfWarPass extends Pass {
  readonly uniforms: {
    tDiffuse: THREE.IUniform<THREE.Texture | null>;
    tDepth: THREE.IUniform<THREE.Texture | null>;
    uShroud: THREE.IUniform<THREE.Texture>;
    uInvProjection: THREE.IUniform<THREE.Matrix4>;
    uCameraWorld: THREE.IUniform<THREE.Matrix4>;
    uMapSize: THREE.IUniform<THREE.Vector2>;
    uTint: THREE.IUniform<THREE.Vector3>;
    uNeverSeen: THREE.IUniform<number>;
    uExplored: THREE.IUniform<number>;
    uTintGain: THREE.IUniform<number>;
  };
  readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(shroud: THREE.Texture, mapWidth: number, mapHeight: number) {
    super();
    // LINEAR, not sRGB-unit: this pass runs before `OutputPass`, on the
    // composer's HalfFloat scene-referred target, so the tint has to be in
    // the same space as the colour it is mixed with. `hexToUnit` here would
    // give a tint far too bright, and only after tone mapping.
    const [r, g, b] = hexToLinear(FOG_TINT_HEX);
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: null },
      uShroud: { value: shroud },
      uInvProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uMapSize: { value: new THREE.Vector2(mapWidth, mapHeight) },
      uTint: { value: new THREE.Vector3(r, g, b) },
      uNeverSeen: { value: FOG_NEVER_SEEN },
      uExplored: { value: FOG_EXPLORED },
      uTintGain: { value: FOG_TINT_GAIN },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
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
    this.uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
    this.uniforms.uCameraWorld.value.copy(camera.matrixWorld);
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
