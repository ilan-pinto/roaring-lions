/**
 * GH-943 WebGPU P3 (T3): the soot recolour of a textured wreck (`world-materials.ts`'s `charredTexturedMaterial`) as a term of the
 * node unit twin (`units/unit-material.node.ts`), segment `rl-soot`. It writes the COLOUR slot and REPLACES the map stage, as the
 * legacy chunk replaces the map chunk: `min(color * luma(texel), 1)`, alpha the texel's (`sootOps`, the one body the number tests
 * run). `color` is the object's own legacy colour (object-scoped, ruling P3-R3): the per-vehicle soot gain rides in it, and a scar
 * written on a clone reaches the twin with no rebuild.
 *
 * Imports TYPES of the legacy file only: the maths arrives as values (`SootMaths`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { sootOps } from './world-materials';
import type { UnitTerm, UnitTermContext } from './units/unit-material.node';

/** The soot's shared maths, injected (`MATERIAL_MATHS.unit.soot`). */
export interface SootMaths {
  readonly sootOps: typeof sootOps;
}

export const SOOT_SEGMENT = 'rl-soot';

export function sootTerms(maths: SootMaths): readonly UnitTerm[] {
  return [
    {
      segment: SOOT_SEGMENT,
      apply(ctx: UnitTermContext): void {
        const texel = ctx.texel;
        if (texel === null) throw new Error(`node unit: a ${SOOT_SEGMENT} material ("${ctx.legacy.name}") has no map (charredTexturedMaterial requires one)`);
        const { T, o } = ctx;
        const c = ctx.materialColor;
        const s = maths.sootOps(o, [c.x, c.y, c.z], [texel.x, texel.y, texel.z, texel.w]);
        ctx.color = T.vec4(s[0], s[1], s[2], s[3]).toVar('rlUnitColorSoot');
      },
    },
  ];
}
