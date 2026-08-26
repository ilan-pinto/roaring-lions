/**
 * The colour pipeline that keeps the three.js backend inside `data/palette.json`.
 *
 * Phase 0 (`docs/superpowers/specs/2026-08-26-phase-0-verdict.md`) measured the
 * obvious setup -- `Color.convertSRGBToLinear()` plus three.js's default
 * `outputColorSpace` -- at ZERO of 65 colours in palette. The linear/sRGB round
 * trip moves every value off its palette entry, and it fails silently: the
 * render looks fine, it is merely not the palette. Getting to zero-off-palette
 * needs three settings, all here:
 *
 *   1. LUT colours built with `setStyle(hex, LinearSRGBColorSpace)` -- no
 *      conversion (`paletteColorNoConvert`).
 *   2. `renderer.outputColorSpace = LinearSRGBColorSpace` -- pass-through, no
 *      output transform.
 *   3. The clear colour given the same treatment, or the background alone
 *      lands off-palette -- it read `#93744C` instead of `#C8B494` until
 *      fixed.
 *
 * Settings 2 and 3 are one function, `applyPalettePipeline`, not two: three.js
 * reads `renderer.outputColorSpace` SYNCHRONOUSLY, at the moment
 * `setClearColor()` is called (`WebGLBackground.setClear` ->
 * `color.getRGB(_rgb, getUnlitUniformColorSpace(renderer))`), so a caller that
 * sets the clear colour before setting `outputColorSpace` bakes in a
 * conversion against three.js's default instead of this pipeline's
 * pass-through -- silently, since nothing about that ordering fails to
 * compile or fails a headless test. Two separate exported functions leave
 * that ordering to every call site to get right by memory; one function that
 * does both, in the correct order, internally, makes the wrong order
 * unrepresentable rather than merely documented.
 *
 * Antialiasing is the fourth requirement and lives at the `WebGLRenderer`
 * call site in `ThreeRenderer`, not here: a blended edge pixel is by
 * definition not a palette colour, and the sprite pipeline quantizes rather
 * than blends.
 */
import * as THREE from 'three';

/** The longest ramp in `data/palette.json` (limestone, 9 steps) and the
 *  shader's `uRamp` array length. Every shorter ramp is padded up to this so
 *  three.js always uploads a fixed-size `vec3[RAMP_MAX]` uniform. */
export const RAMP_MAX = 9;

/**
 * A palette colour whose bytes survive to the framebuffer.
 *
 * `new THREE.Color(hex)` (or `.set(hex)`) treats the string as sRGB and
 * converts it to three.js's working linear space -- correct for lit,
 * continuously-shaded geometry, wrong for a colour meant to come back out
 * byte-identical. `setStyle(hex, LinearSRGBColorSpace)` tells three.js the
 * string is *already* in the working space, so no conversion happens in
 * either direction at write time.
 *
 * Reading it back is a separate operation with its own default: `Color#getHex`/
 * `getHexString` default their `colorSpace` argument to `SRGBColorSpace`
 * regardless of how the value was written, so a bare `c.getHexString()` on a
 * colour built here re-encodes it and will NOT reproduce the original hex --
 * pass `THREE.LinearSRGBColorSpace` explicitly to read the exact bytes back
 * (`palette-material.test.ts` does this). `ColorManagement` stays enabled
 * (its default): disabling it globally would make this function's output
 * indistinguishable from the naive `new THREE.Color(hex)` path it exists to
 * replace, erasing the exact bug class this module guards against.
 */
export function paletteColorNoConvert(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);
}

/**
 * The renderer-mutating half of the pipeline, typed as the narrow structural
 * shape it actually touches rather than `THREE.WebGLRenderer` itself.
 *
 * `THREE.WebGLRenderer` cannot be constructed in the headless `node` test
 * environment this package runs its tests under (no WebGL, no DOM) -- see
 * `palette-material.test.ts`. `outputColorSpace` is a plain data property and
 * `setClearColor` a real method, so a structural type lets a plain object
 * stand in for the renderer in tests while a real `THREE.WebGLRenderer`
 * still satisfies it at the `ThreeRenderer` call site unchanged.
 *
 * `outputColorSpace` is typed as `string` rather than `THREE.ColorSpace`: the
 * installed `@types/three` (0.170) types `WebGLRenderer#outputColorSpace` as
 * `string`, not the narrower `ColorSpace` union, and a mutable property must
 * match exactly for a real renderer to satisfy this structurally --
 * `ColorSpace` here would make `THREE.WebGLRenderer` itself fail to
 * typecheck against this interface, defeating the point.
 */
export interface PaletteTarget {
  outputColorSpace: string;
  setClearColor(color: THREE.Color): void;
}

/**
 * Sets the renderer's output colour space to pass-through, then sets the
 * clear colour from `background` through `paletteColorNoConvert` -- in that
 * order, always, as one call. See the module doc comment for why the order
 * is load-bearing rather than cosmetic, and why this is one function instead
 * of two a call site could sequence wrong.
 */
export function applyPalettePipeline(renderer: PaletteTarget, background: string): void {
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(paletteColorNoConvert(background));
}

/**
 * A toon-shaded material that quantizes `N·L` into `uSteps` bands and reads
 * the fragment colour out of `uRamp` -- never computed. A shaded fragment
 * cannot emit an off-palette colour because the only values it can write are
 * the ones read out of the ramp (Phase 0's "stronger guarantee than
 * `validate:assets`" finding).
 *
 * Index 0 of every ramp in `data/palette.json` is the LIGHTEST step, so
 * brighter light means a LOWER index -- the shader below quantizes
 * `max(N·L, 0)` from 1 down to 0 across `uSteps` bands for exactly that
 * reason. Getting this backwards inverts every unit's shading, which reads
 * as "the art looks wrong" rather than as a bug.
 */
export function toonRampMaterial(rampHexes: readonly string[]): THREE.ShaderMaterial {
  if (rampHexes.length === 0) {
    throw new Error('toonRampMaterial: ramp must have at least one colour');
  }
  if (rampHexes.length > RAMP_MAX) {
    throw new Error(
      `toonRampMaterial: ramp has ${rampHexes.length} colours, longer than RAMP_MAX (${RAMP_MAX})`
    );
  }

  const padded: THREE.Color[] = rampHexes.map((hex) => paletteColorNoConvert(hex));
  // Pad to RAMP_MAX with the ramp's own darkest (last) entry so three.js can
  // upload a fixed-size vec3[RAMP_MAX] uniform regardless of the ramp's true
  // length -- reading past the true length in the shader (guarded by
  // uSteps) never reaches the padding, but the array must still be full
  // length or three.js errors uploading it.
  const last = padded[padded.length - 1];
  while (padded.length < RAMP_MAX) {
    padded.push(last.clone());
  }

  return new THREE.ShaderMaterial({
    uniforms: {
      uRamp: { value: padded },
      uSteps: { value: rampHexes.length },
      uLightDir: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uRamp[${RAMP_MAX}];
      uniform int uSteps;
      uniform vec3 uLightDir;
      varying vec3 vNormal;

      void main() {
        float nl = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
        // Quantize into uSteps bands, brightest band -> index 0.
        int band = int(floor((1.0 - nl) * float(uSteps)));
        band = min(band, uSteps - 1);
        vec3 outColor = uRamp[0];
        for (int i = 0; i < ${RAMP_MAX}; i++) {
          if (i == band) {
            outColor = uRamp[i];
          }
        }
        gl_FragColor = vec4(outColor, 1.0);
      }
    `,
  });
}
