/**
 * A radial darkening of the frame's corners, applied AFTER tone-mapping.
 *
 * It does one job: the world stops ending in a hard black diagonal, because
 * the frame's edge is already dark before the map's is. At minimum zoom on a
 * 1920-wide frame more than half the picture is off-map void, and the eye
 * reads the boundary between lit ground and `scene.background` as a drawn
 * line. Two things close it together and neither is sufficient alone -- this
 * pass, and `terrain/skirt.ts`'s desaturated ground beyond the map edge. The
 * skirt moves the boundary outward; this makes wherever the boundary ends up
 * sit in already-dark pixels.
 *
 * **Display-referred on purpose.** It is inserted between `OutputPass` and
 * `SMAAPass` (`post-chain.ts`'s `rebuild`), so the colour it scales has
 * already been through ACES and the sRGB encode. A vignette applied in
 * LINEAR light before the tone curve is not the same operation: scaling a
 * scene-referred value by 0.5 moves it down the ACES shoulder rather than
 * down the display ramp, so the corners lose contrast and shift hue instead
 * of simply going dark. And it sits BEFORE SMAA because SMAA edge-detects on
 * the final image -- putting it after would antialias the picture and then
 * modulate it, leaving the vignette's own (very low frequency) gradient
 * unfiltered, which costs nothing, but also leaving SMAA judging edges by
 * contrast this pass is about to change.
 *
 * `needsSwap = true`: it writes a full frame into `writeBuffer`, so the
 * composer must hand that buffer to the next pass.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * How much of the colour is taken away where the vignette is at FULL
 * strength -- `rgb * (1 - uStrength)`.
 *
 * 0.55 rather than a token 0.2: the background beyond the skirt is
 * `shadow.1` (`#14150F`, the darkest thing in the palette), and the purpose
 * is for the lit ground to have ALREADY arrived near that value by the time
 * it meets it. A weak vignette leaves the step visible and merely tints it.
 */
export const VIGNETTE_STRENGTH = 0.55;

/**
 * Where the darkening starts, as a fraction of the half-DIAGONAL: 0 at the
 * frame's centre, 1 at a corner.
 *
 * 0.62 keeps the whole of the playable centre untouched -- the shader's
 * `smoothstep` is exactly 0 below this, not merely small, so a mid-map
 * pixel is bit-identical with the pass on and off. That is the property
 * this task was asked to preserve and it is structural rather than
 * measured.
 */
export const VIGNETTE_RADIUS = 0.62;

/**
 * How far past `uRadius` the ramp takes to reach full strength.
 *
 * 0.45 puts the top of the ramp at d = 1.07, PAST the corner -- so a corner
 * pixel sits at `smoothstep(0.62, 1.07, 1.0)` = 0.9348 of full strength and
 * the gradient is still moving when it runs out of frame. Landing the ramp
 * exactly on the corner instead would flatten the outer eighth of the
 * picture into a constant, which reads as a dark ring rather than as a
 * falloff.
 */
export const VIGNETTE_SOFTNESS = 0.45;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * `length(vUv - 0.5) / 0.7071` is 0 at the centre and exactly 1 at each
 * corner, whatever the aspect ratio -- which makes the iso-lines ELLIPSES in
 * screen space, following the frame, rather than a circle that would leave
 * the short axis untouched on a 21:9 monitor and crush it on a phone.
 *
 * Alpha is passed through untouched. The composer's targets are opaque, but
 * writing `c.a` rather than 1.0 keeps this pass a pure multiply on colour,
 * so it cannot change how a later pass composites.
 */
const FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uStrength;
uniform float uRadius;
uniform float uSoftness;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float d = length(vUv - 0.5) / 0.7071;
  float v = smoothstep(uRadius, uRadius + uSoftness, d);
  gl_FragColor = vec4(c.rgb * (1.0 - uStrength * v), c.a);
}
`;

export class VignettePass extends Pass {
  readonly uniforms: {
    tDiffuse: THREE.IUniform<THREE.Texture | null>;
    uStrength: THREE.IUniform<number>;
    uRadius: THREE.IUniform<number>;
    uSoftness: THREE.IUniform<number>;
  };
  readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      uStrength: { value: VIGNETTE_STRENGTH },
      uRadius: { value: VIGNETTE_RADIUS },
      uSoftness: { value: VIGNETTE_SOFTNESS },
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

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
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
