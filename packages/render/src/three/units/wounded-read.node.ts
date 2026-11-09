/**
 * GH-943 WebGPU P3 (T4): the wounded figure's albedo floor (`wounded-read.ts`'s `liftWoundedTemplate`) as a term of the node unit
 * twin (`unit-material.node.ts`), segment `rl-wounded-floor`. It writes the OUTPUT slot: the floor reads the LIT output (the
 * node `output`, the radiance after lighting and the emissive, three's own `outgoingLight`), never the colour node, because it
 * measures how much light the body already gets (`lit = luma(out) / max(luma(diffuse), 0.02)`). `diffuse` is the colour the earlier
 * terms left (after the rain rim's exposure on a KDF figure), as the legacy `diffuseColor` is when the floor runs.
 *
 * The three uniforms are `woundedUniforms()`'s own objects re-read every render (`uWoundedFloor`, `uWoundedGateLo`,
 * `uWoundedGateHi`), so the `wounded-read` debug layer's one write moves every lifted figure.
 *
 * Imports TYPES of the legacy file only: the maths arrives as values (`FloorMaths`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { floorOps, woundedUniforms } from './wounded-read';
import type { UnitTerm, UnitTermContext } from './unit-material.node';

/** The floor's shared maths, injected (`MATERIAL_MATHS.unit.floor`). */
export interface FloorMaths {
  readonly floorOps: typeof floorOps;
  readonly woundedUniforms: typeof woundedUniforms;
}

export const WOUNDED_FLOOR_SEGMENT = 'rl-wounded-floor';

export function floorTerms(maths: FloorMaths): readonly UnitTerm[] {
  return [
    {
      segment: WOUNDED_FLOOR_SEGMENT,
      apply(ctx: UnitTermContext): void {
        const { T, o } = ctx;
        const u = maths.woundedUniforms();
        const floor = ctx.renderUniform(() => u.floor.value, 'uWoundedFloor');
        const lo = ctx.renderUniform(() => u.lo.value, 'uWoundedGateLo');
        const hi = ctx.renderUniform(() => u.hi.value, 'uWoundedGateHi');
        const lit = T.output;
        const d = ctx.color;
        const r = maths.floorOps(o, { diffuse: [d.x, d.y, d.z], out: [lit.x, lit.y, lit.z], floor, lo, hi });
        ctx.output = T.vec4(T.vec3(r[0], r[1], r[2]), lit.w);
      },
    },
  ];
}
