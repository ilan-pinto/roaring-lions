/**
 * A radial darkening of the frame's corners, applied AFTER tone-mapping and
 * folded into `OutputPass`'s own fragment shader (GH-829 option 2).
 *
 * It does one job: the world stops ending in a hard black diagonal, because
 * the frame's edge is already dark before the map's is. At minimum zoom on a
 * 1920-wide frame more than half the picture is off-map void, and the eye
 * reads the boundary between lit ground and `scene.background` as a drawn
 * line. Two things close it together and neither is sufficient alone -- this
 * darkening, and `terrain/skirt.ts`'s desaturated ground beyond the map edge.
 * The skirt moves the boundary outward; this makes wherever the boundary ends
 * up sit in already-dark pixels.
 *
 * **Display-referred on purpose.** It runs at the END of the output shader
 * (`post-chain.ts`), so the colour it scales has already been through ACES and
 * the sRGB encode. A vignette applied in LINEAR light before the tone curve is
 * not the same operation: scaling a scene-referred value by 0.5 moves it down
 * the ACES shoulder rather than down the display ramp, so the corners lose
 * contrast and shift hue instead of simply going dark. And it stays BEFORE
 * SMAA because SMAA edge-detects on the final image.
 *
 * **Why it is not its own pass any more.** It used to be a `VignettePass`
 * between `OutputPass` and `SMAAPass`: one more full-screen draw and one more
 * HalfFloat read and write of the whole frame, measured at 0.4-0.8 ms of a
 * 14-21 ms `high` frame at DPR 2 (`docs/PERFORMANCE.md`, GH-829). The fold
 * draws the identical image -- see `HALF_GLSL` for the one thing that took.
 */
import * as THREE from 'three';
import type { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
 * pixel is bit-identical with the vignette on and off. That is the property
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

/**
 * `length(vUv - 0.5) / 0.7071` is 0 at the centre and exactly 1 at each
 * corner, whatever the aspect ratio -- which makes the iso-lines ELLIPSES in
 * screen space, following the frame, rather than a circle that would leave
 * the short axis untouched on a 21:9 monitor and crush it on a phone.
 */
const FALLOFF_GLSL = `
  float vigD = length(vUv - 0.5) / 0.7071;
  float vigV = smoothstep(uVigRadius, uVigRadius + uVigSoftness, vigD);
`;

const UNIFORMS_GLSL = `
uniform float uVigStrength;
uniform float uVigRadius;
uniform float uVigSoftness;
`;

/**
 * **What it takes for the fold to be pixel-identical, and why this is here.**
 * The separate pass read `OutputPass`'s result back out of the composer's
 * HalfFloat target, so it scaled the output ROUNDED TO HALF FLOAT. Scaling
 * the unrounded value instead is a different number by up to one half-ulp,
 * which is at most 1/255 at 8 bits and invisible by eye -- but SMAA
 * edge-detects on that value against a threshold, and a handful of pixels
 * per frame flip their edge decision. Measured, without this function:
 * `high`, DPR 2, 2880x1800, max per-channel delta 32 at 250-330 pixels (0.0015%)
 * and 1 on a further 85k-165k. With it: 0, over 36 frames.
 *
 * So the fold rounds through half float itself, in the same place the
 * target used to. `packHalf2x16` is GLSL ES 3.00, which is why `fold` below
 * ports the stock shader from ES 1.00. The composer's targets are HalfFloat
 * (`createPostChain`), and this stays right only while they are.
 */
const HALF_GLSL = `
vec3 roundTripHalf(vec3 v) {
  vec2 a = unpackHalf2x16(packHalf2x16(v.xy));
  float b = unpackHalf2x16(packHalf2x16(vec2(v.z, 0.0))).x;
  return vec3(a, b);
}
`;

/** Where in `OutputShader`'s fragment source the fold hooks in. Both anchors
 *  are asserted to exist: a three upgrade that reworded either would
 *  otherwise leave a vignette that silently never draws. */
const UNIFORM_ANCHOR = 'varying vec2 vUv;';
const APPLY_ANCHOR = /\}\s*$/;

/**
 * Rewrites `outputPass`'s material so its fragment shader ends with the
 * vignette, and returns the handle that switches it. Pure string work on the
 * stock `OutputShader` source, exported separately from the class so a test
 * can read the shader it produces without a GL context.
 */
export function foldVignetteShaders(vertex: string, fragment: string): { vertex: string; fragment: string } {
  if (!fragment.includes(UNIFORM_ANCHOR) || !APPLY_ANCHOR.test(fragment) || !fragment.includes('gl_FragColor')) {
    throw new Error(
      "vignette-pass: OutputShader's fragment source no longer has the anchors the vignette folds into " +
        "('varying vec2 vUv;', gl_FragColor and the closing brace of main) -- three was upgraded; re-anchor the fold."
    );
  }
  const folded = fragment
    .replace(UNIFORM_ANCHOR, `${UNIFORM_ANCHOR}\n${UNIFORMS_GLSL}${HALF_GLSL}`)
    .replace(
      APPLY_ANCHOR,
      `${FALLOFF_GLSL}  gl_FragColor.rgb = roundTripHalf(gl_FragColor.rgb) * (1.0 - uVigStrength * vigV);\n}`
    );
  // GLSL ES 3.00, ported mechanically from the stock ES 1.00 source.
  return {
    vertex: vertex.replace(/\battribute\b/g, 'in').replace(/\bvarying\b/g, 'out'),
    fragment: folded
      .replace(/\bvarying\b/g, 'in')
      .replace(/\btexture2D\b/g, 'texture')
      .replace(/\bgl_FragColor\b/g, 'fragColor')
      .replace('precision highp float;', 'precision highp float;\nout highp vec4 fragColor;'),
  };
}

/**
 * The corner vignette, living inside `OutputPass`.
 *
 * `enabled` is the debug layer's switch (`setDebugLayerVisible('vignette')`).
 * It cannot be `Pass.enabled`, which would drop the whole output transform;
 * it zeroes `uVigStrength` instead, and `1.0 - 0.0 * v` is exactly 1.0, so
 * "off" is the stock output pass bit for bit. It starts OFF: a chain nobody
 * asked to vignette draws as before.
 */
export class OutputVignette {
  readonly uniforms: {
    uVigStrength: THREE.IUniform<number>;
    uVigRadius: THREE.IUniform<number>;
    uVigSoftness: THREE.IUniform<number>;
  };
  private on = false;

  constructor(outputPass: OutputPass) {
    this.uniforms = {
      uVigStrength: { value: 0 },
      uVigRadius: { value: VIGNETTE_RADIUS },
      uVigSoftness: { value: VIGNETTE_SOFTNESS },
    };
    const material = outputPass.material;
    const shaders = foldVignetteShaders(material.vertexShader, material.fragmentShader);
    material.glslVersion = THREE.GLSL3;
    material.vertexShader = shaders.vertex;
    material.fragmentShader = shaders.fragment;
    // `outputPass.uniforms` IS the material's uniform table (three assigns it by reference).
    Object.assign(outputPass.uniforms, this.uniforms);
    material.needsUpdate = true;
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    this.on = value;
    this.uniforms.uVigStrength.value = value ? VIGNETTE_STRENGTH : 0;
  }
}
