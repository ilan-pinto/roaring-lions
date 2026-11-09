/**
 * GH-943 WebGPU P3 (T3): the team mark (`team-mask.ts`) as a term of the node unit twin (`unit-material.node.ts`), segment
 * `rl-team-mark-2`. It writes the COLOUR slot, after the map and the tread and before lighting, as the legacy chunk does.
 *
 * What it mirrors:
 *  - the OBJECT-space position and normal, `positionGeometry` and `normalGeometry` as the varyings `vMarkPos` and `vMarkNrm` (the
 *    attributes never see the turret's node transform, so the mark turns with the turret, and never a world matrix);
 *  - the coverage's edge width `fwidth(v) * uMarkEdge`, computed here (a derivative is graph-only) and handed to `teamMarkOps`, the
 *    one body the number tests run;
 *  - the kit exclusion's three taps on `uv()`;
 *  - the panel `min(teamColor * mix(1, luma(diffuse) / uTeamLuma, 0.3), 1)`, mixed into the colour.
 *
 * Every uniform is the legacy hook's own record (`teamHookOf(legacy)`), re-read every render: `uTeamColor` is the slot's SHARED
 * colour (`TeamMaskSlots`, so a colour-vision switch is one write and no rebuild), `uTeamStrength` the module's shared strength (the
 * `team-mask` debug layer writes it). A material with no map draws no mark, as the legacy `#ifdef USE_MAP`.
 *
 * Imports TYPES of the legacy file only: the maths arrives as values (`TeamMarkMaths`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type { teamHookOf, teamMarkOps } from './team-mask';
import type { UnitTerm, UnitTermContext, UN } from './unit-material.node';

/** The team mark's shared maths, injected (`MATERIAL_MATHS.unit.team`). */
export interface TeamMarkMaths {
  readonly teamMarkOps: typeof teamMarkOps;
  readonly teamHookOf: typeof teamHookOf;
}

export const TEAM_MARK_SEGMENT = 'rl-team-mark-2';

export function teamMarkTerms(maths: TeamMarkMaths): readonly UnitTerm[] {
  return [
    {
      segment: TEAM_MARK_SEGMENT,
      apply(ctx: UnitTermContext): void {
        const hook = maths.teamHookOf(ctx.legacy);
        if (hook === undefined) throw new Error(`node unit: a ${TEAM_MARK_SEGMENT} material ("${ctx.legacy.name}") carries no team hook`);
        if (ctx.texel === null) return;
        const { T, o } = ctx;
        const team = ctx.renderUniform(() => hook.color.value, 'uTeamColor');
        const strength = ctx.renderUniform(() => hook.strength.value, 'uTeamStrength');
        const luma = ctx.renderUniform(() => hook.luma.value, 'uTeamLuma');
        const a = ctx.renderUniform(() => hook.a.value, 'uMarkA');
        const b = ctx.renderUniform(() => hook.b.value, 'uMarkB');
        const c = ctx.renderUniform(() => hook.c.value, 'uMarkC');
        // Three named vectors, not a uniform array: a GLSL uniform buffer is named by its node id, so an array would make each
        // slot's variant compile its own program text (three caches GPU programs by text).
        const kit = [0, 1, 2].map((i) => ctx.renderUniform(() => hook.kit.value[i], `uMarkKit${i}`));
        const edge = ctx.renderUniform(() => hook.edgePx.value, 'uMarkEdge');
        const p = T.positionGeometry.toVarying('vMarkPos');
        const n = T.normalGeometry.toVarying('vMarkNrm');
        const uv = T.uv();
        const d = ctx.color;
        const v4 = (u: UN): [UN, UN, UN, UN] => [u.x, u.y, u.z, u.w] as [UN, UN, UN, UN];
        const taps = kit.map((k) => [k.x, k.y] as const);
        const r = maths.teamMarkOps(o, {
          p: [p.x, p.y, p.z],
          n: [n.x, n.y, n.z],
          uv: [uv.x, uv.y],
          rate: [T.fwidth(p.x).mul(edge), T.fwidth(T.abs(p.z)).mul(edge), T.fwidth(p.y).mul(edge)],
          a: v4(a),
          b: v4(b),
          c: v4(c),
          kit: taps,
          strength,
          luma,
          team: [team.x, team.y, team.z],
          diffuse: [d.x, d.y, d.z],
        });
        ctx.color = T.vec4(T.vec3(r.rgb[0], r.rgb[1], r.rgb[2]), d.w).toVar('rlUnitColorTeam');
      },
    },
  ];
}
