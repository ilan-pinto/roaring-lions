/**
 * GH-943 WebGPU P3 (T4): the KDF figure's rain rim, exposure and contrast (`rain-rim.ts`) as a term of the node unit twin
 * (`unit-material.node.ts`), segment `rl-unit-rain-rim`. It writes the COLOUR slot (the exposure, then the contrast, on the colour
 * the earlier terms left, before lighting) and the EMISSIVE slot (the rim), as the legacy chunks do after `emissivemap_fragment`.
 *
 * What it mirrors:
 *  - the maths, `rimOps` (one body the number tests run), over the twin's colour taps;
 *  - the view vector `v` of the rim, a GRAPH choice on the camera type: `(0, 0, 1)` under an orthographic camera (the game's, the
 *    legacy `isOrthographic` branch), the position's view direction under a perspective one;
 *  - the five shared uniforms, `rimUniforms()`'s own objects re-read every render (`uRimColor`, `uRimGain`, `uRimPower`,
 *    `uRainExposure`, `uRainContrast`), so the `unit-surface` debug layer and `debugSetRainRead` move every figure with one write.
 *
 * Imports TYPES of the legacy file only: the maths arrives as values (`RimMaths`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { rimOps, rimUniforms } from './rain-rim';
import type { UN, UnitTerm, UnitTermContext } from './unit-material.node';

/** The rim's shared maths, injected (`MATERIAL_MATHS.unit.rim`). */
export interface RimMaths {
  readonly rimOps: typeof rimOps;
  readonly rimUniforms: typeof rimUniforms;
}

export const RAIN_RIM_SEGMENT = 'rl-unit-rain-rim';

export function rimTerms(maths: RimMaths): readonly UnitTerm[] {
  return [
    {
      segment: RAIN_RIM_SEGMENT,
      apply(ctx: UnitTermContext): void {
        const { T, o } = ctx;
        const u = maths.rimUniforms();
        const colour = ctx.renderUniform(() => u.colour.value, 'uRimColor');
        const gain = ctx.renderUniform(() => u.gain.value, 'uRimGain');
        const power = ctx.renderUniform(() => u.power.value, 'uRimPower');
        const exposure = ctx.renderUniform(() => u.exposure.value, 'uRainExposure');
        const contrast = ctx.renderUniform(() => u.contrast.value, 'uRainContrast');
        // The legacy `isOrthographic ? vec3( 0, 0, 1 ) : normalize( vViewPosition )`: chosen when the graph is built, by the camera.
        const view = T.Fn((builder) => (builder.camera?.isOrthographicCamera === true ? T.vec3(0, 0, 1) : T.positionViewDirection))();
        const nDotV = T.dot(T.normalize(T.normalView), view);
        const d = ctx.color;
        const r = maths.rimOps(o, {
          diffuse: [d.x, d.y, d.z],
          exposure,
          contrast,
          rimColor: [colour.x, colour.y, colour.z],
          gain,
          power,
          nDotV,
        });
        ctx.color = T.vec4(T.vec3(r.rgb[0], r.rgb[1], r.rgb[2]), d.w).toVar('rlUnitColorRain');
        const rim = T.vec3(r.emissive[0], r.emissive[1], r.emissive[2]);
        ctx.emissive = ctx.emissive === null ? rim : (ctx.emissive.add(rim) as UN);
      },
    },
  ];
}
