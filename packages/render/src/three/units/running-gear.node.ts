/**
 * GH-943 WebGPU P3 (T3): the running gear (`running-gear-material.ts`) as terms of the node unit twin (`unit-material.node.ts`),
 * segment `rl-running-gear-1`. Two terms, one slot each:
 *  - POSITION and NORMAL: a vertex tagged `_rl_wheel = k` turns about wheel `k`'s axle, in the exact `p + (R d - d)` form
 *    (`rgVertexOps`, so the rest rotation returns `p` bit for bit), and its local normal turns with it (`rgNormalOps`), written
 *    into three's own `normalLocal` in the vertex stage (the legacy splice turns `objectNormal`), so the view normal, a normal map
 *    and the lighting follow three's own path from it;
 *  - COLOUR: the tread bars right after the map (`rgPhaseOps`, then `rgBarOps` with the phase's `fwidth` computed here).
 *
 * **One twin for every vehicle of a template.** Legacy cuts a clone per vehicle because a standard material's hook uniforms are only
 * re-uploaded on a program change. On node, `uRgRot`, `uRgAxle`, `uRgTrack` and `uRgPitchInv` are OBJECT-scoped uniforms
 * (`onObjectUpdate`): each draw reads the uniform objects of ITS OWN legacy clone (`runningGearUniformsOf(legacyMaterialOf(mesh))`),
 * the very objects `writeRunningGearUniforms` writes every frame, so no call site changes and no program is cut per vehicle.
 *
 * The shadow and an override pass keep the rest pose: the composer owns that (`castShadowPositionNode`, the builder guard).
 *
 * Imports TYPES of the legacy files only: the maths arrives as values (`RunningGearMaths`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { rgBarOps, rgNormalOps, rgPhaseOps, rgVertexOps } from './running-gear';
import type { runningGearUniformsOf, RunningGearUniforms } from './running-gear-material';
import type { UnitTerm, UnitTermContext } from './unit-material.node';
import type { Material } from 'three';

/** The running gear's shared maths, injected (`MATERIAL_MATHS.unit.rg`). */
export interface RunningGearMaths {
  readonly rgVertexOps: typeof rgVertexOps;
  readonly rgNormalOps: typeof rgNormalOps;
  readonly rgPhaseOps: typeof rgPhaseOps;
  readonly rgBarOps: typeof rgBarOps;
  readonly uniformsOf: typeof runningGearUniformsOf;
  /** `RG_MAX_WHEELS`: the uniform arrays' length. */
  readonly maxWheels: number;
  /** `RG_WHEEL_GEOMETRY_ATTR`, `RG_TRACK_GEOMETRY_ATTR`. */
  readonly wheelAttribute: string;
  readonly trackAttribute: string;
}

export const RUNNING_GEAR_SEGMENT = 'rl-running-gear-1';

export function runningGearTerms(maths: RunningGearMaths): readonly UnitTerm[] {
  const of = (l: Material): RunningGearUniforms | undefined => maths.uniformsOf(l);
  return [
    {
      segment: RUNNING_GEAR_SEGMENT,
      // Position and normal.
      apply(ctx: UnitTermContext): void {
        const { T, o, W } = ctx;
        const rest = Array.from({ length: maths.maxWheels }, () => new W.Vector4(1, 0, 1, 0));
        const zero = Array.from({ length: maths.maxWheels }, () => new W.Vector4(0, 0, 0, 0));
        const rot = ctx.objectArray((l) => of(l)?.uRgRot.value, rest, 'vec4', 'uRgRot');
        const axle = ctx.objectArray((l) => of(l)?.uRgAxle.value, zero, 'vec4', 'uRgAxle');
        const wheel = T.attribute(maths.wheelAttribute, 'float');
        // `int(_rl_wheel + 0.5) - 1`, clamped to a valid index (a vertex off every wheel reads wheel 0 and is not moved).
        const k = T.max(T.int(wheel.add(0.5)).sub(1), T.int(0)).toVar('rlRgWheel');
        const R = rot.element(k).toVar('rlRgRot');
        const A = axle.element(k).toVar('rlRgAxle');
        const r4 = [R.x, R.y, R.z, R.w] as const;
        const p = ctx.position;
        const n = ctx.normal;
        const moved = maths.rgVertexOps(o, [p.x, p.y, p.z], [A.x, A.y, A.z], r4, wheel);
        const turned = maths.rgNormalOps(o, [n.x, n.y, n.z], r4, wheel);
        ctx.position = T.vec3(moved[0], moved[1], moved[2]);
        ctx.normal = T.vec3(turned[0], turned[1], turned[2]);
      },
    },
    {
      segment: RUNNING_GEAR_SEGMENT,
      // The tread, on the colour after the map.
      apply(ctx: UnitTermContext): void {
        const { T, o, W } = ctx;
        const track = ctx.objectUniform((l) => of(l)?.uRgTrack.value, new W.Vector4(0, 0, 0, 0), 'uRgTrack');
        const pitchInv = ctx.objectUniform((l) => of(l)?.uRgPitchInv.value, new W.Vector2(0, 0), 'uRgPitchInv');
        const loop = T.attribute(maths.trackAttribute, 'float');
        const side = T.positionGeometry.z;
        const phase = T.float(maths.rgPhaseOps(o, loop, side, [pitchInv.x, pitchInv.y], [track.x, track.y])).toVar('rlRgPhase');
        const factor = maths.rgBarOps(o, phase, T.fwidth(phase), loop, track.z);
        const c = ctx.color;
        ctx.color = T.vec4(c.xyz.mul(factor), c.w).toVar('rlUnitColorTread');
      },
    },
  ];
}
