/**
 * GH-1096 S1: the Roaring Lion insignia (`insignia.ts`) as the second term of the node unit twin's `rl-unit-mark-3` segment
 * (`unit-material.node.ts`), after the team mark (`team-mask.node.ts`), on the COLOUR slot, as the legacy chunk splices it after the
 * mark inside the same `#ifdef USE_MAP`.
 *
 * What it mirrors:
 *  - the OBJECT-space position and normal, the varyings `vMarkPos` and `vMarkNrm` (the attributes never see the turret's node
 *    transform, and never a world matrix), shared with the team term;
 *  - the emblem coordinate and its texture coordinate, `insigniaCoordOps`, the one body the legacy chunk and the number tests run;
 *  - the distance-field sample at that coordinate and the four screen-space rates (`fwidth` of the coordinate and of the sample,
 *    and of `|p.z|`), computed HERE, outside any branch (a derivative and a fetch are graph-only), and handed to `insigniaOps`.
 *
 * Every value is the legacy hook's own record (`insigniaHookOf(legacy)`), re-read every render: the texture is the OWNER's shared
 * uniform (a late load swaps the image with no rebuild, `renderTexture`), the colour and the pixel ratio are the owner's, the
 * strength and the bands the module's (the `insignia` debug layer writes the strength). A material with no map draws none, as the
 * legacy `#ifdef USE_MAP`.
 *
 * Imports TYPES of the legacy files only: the maths arrives as values (`InsigniaMaths`, through `MATERIAL_MATHS.unit.insignia`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { insigniaCoordOps, insigniaOps } from './insignia';
import type { insigniaHookOf } from './team-mask';
import type { UnitTerm, UnitTermContext, UN } from './unit-material.node';

/** The insignia's shared maths, injected (`MATERIAL_MATHS.unit.insignia`). */
export interface InsigniaMaths {
  readonly insigniaOps: typeof insigniaOps;
  readonly insigniaCoordOps: typeof insigniaCoordOps;
  readonly insigniaHookOf: typeof insigniaHookOf;
}

/** The segment the term belongs to: the one unit-mark hook's (`team-mask.ts`'s `UNIT_MARK_PROGRAM_KEY`). */
export const INSIGNIA_SEGMENT = 'rl-unit-mark-3';

export function insigniaTerms(maths: InsigniaMaths): readonly UnitTerm[] {
  return [
    {
      segment: INSIGNIA_SEGMENT,
      apply(ctx: UnitTermContext): void {
        const hook = maths.insigniaHookOf(ctx.legacy);
        // A team-only material: the segment's first term drew, this one does not.
        if (hook === undefined || ctx.texel === null) return;
        const { T, o } = ctx;
        const frame = ctx.renderUniform(() => hook.frame.value, 'uInsFrame');
        const slab = ctx.renderUniform(() => hook.slab.value, 'uInsSlab');
        const bands = ctx.renderUniform(() => hook.bands.value, 'uInsBands');
        const color = ctx.renderUniform(() => hook.color.value, 'uInsColor');
        const strength = ctx.renderUniform(() => hook.strength.value, 'uInsStrength');
        const luma = ctx.renderUniform(() => hook.luma.value, 'uInsLuma');
        const ratio = ctx.renderUniform(() => hook.pixelRatio.value, 'uInsPixelRatio');
        const { p, n } = ctx.markVaryings();
        const f4: [UN, UN, UN, UN] = [frame.x, frame.y, frame.z, frame.w] as [UN, UN, UN, UN];
        const { e, st } = maths.insigniaCoordOps(o, [p.x, p.y, p.z], f4);
        const sample = ctx.renderTexture(() => hook.sdf.value, T.vec2(st[0], st[1]), 'uInsSdf');
        const d = ctx.color;
        const r = maths.insigniaOps(o, {
          p: [p.x, p.y, p.z],
          n: [n.x, n.y, n.z],
          e,
          rateE: [T.fwidth(e[0]), T.fwidth(e[1])],
          rateZ: T.fwidth(T.abs(p.z)),
          sample: [sample.x, sample.y],
          rateS: [T.fwidth(sample.x), T.fwidth(sample.y)],
          frame: f4,
          slab: [slab.x, slab.y],
          bands: [bands.x, bands.y, bands.z, bands.w],
          pixelRatio: ratio,
          strength,
          luma,
          color: [color.x, color.y, color.z],
          diffuse: [d.x, d.y, d.z],
        });
        ctx.color = T.vec4(T.vec3(r.rgb[0], r.rgb[1], r.rgb[2]), d.w).toVar('rlUnitColorIns');
      },
    },
  ];
}
