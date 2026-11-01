/**
 * G2 -- no floating claw pieces (GH-746 follow-up, the 1 Nov infantry audit). A hand-coloured patch bound to a bone that is
 * not a hand is a third "hand": on the Combat Engineer, 91 cm2 of orange claw polygons ride the thighs, and when the arm
 * moves they stay at the hip. To every per-bone check that geometry is "body", so no grip gate could see it; the demo
 * review found it with a colour census, which is the right instrument and had never been a gate.
 *
 * The reading is `strayClawPieces` (mesh_figures.ts): a legacy Meshy claw tone near the figure's own hand, or a modelled
 * glove's own texel anywhere off a hand bone. The tones are LITERALS (CIE Lab): the KDF orange (54, 16, 40) and (42, 18, 33),
 * the crews' pink (55, 28, 26).
 *
 * NOT done: the audit's (b), "no connected piece under 30 cm2 that is ever 10 mm or more from its figure in any sampled
 * frame". (a) is what finds the shipped defect; (b) needs the per-clip skinning of every piece and is the next gate.
 *
 * Every team that fails is a named exemption with its demotion assertion. `officer_engineer` wears the Combat Engineer body,
 * so it fails identically.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readGlb } from './mesh_gait';
import { infantryTeams, rebindVertices, strayClawPieces } from './mesh_figures';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** Teams carrying claw polygons off the hand. Measured on the bytes: demo_a and demo_b 358 cm2 each in 3 pieces on the thighs and pelvis. */
export const STRAY_CLAW_EXEMPT: Readonly<Record<string, string>> = {
  demo_squad: 'orange claw polygons bound to the thighs and pelvis of both men: the third hand at the hip',
  officer_engineer: 'the Combat Engineer body (sap): the same orange claw polygons on the thighs and pelvis',
};

const teams = infantryTeams(MESHES, (d) => readdirSync(d));

describe('G2: no claw-coloured geometry off the hand', () => {
  it('reads the whole population (23 teams)', () => {
    expect(teams.length).toBe(23);
  });
  it('the exemptions name real teams', () => {
    for (const k of Object.keys(STRAY_CLAW_EXEMPT)) expect(teams.map(([t]) => t), k).toContain(k);
  });
  it.each(teams.filter(([t]) => !(t in STRAY_CLAW_EXEMPT)))('%s: no stray claw piece', (_t, glb) => {
    expect(strayClawPieces(glb)).toEqual([]);
  });
  it.each(teams.filter(([t]) => t in STRAY_CLAW_EXEMPT))('%s: still has stray pieces (else delete it from STRAY_CLAW_EXEMPT)', (team, glb) => {
    expect(strayClawPieces(glb).length, `${team} has no stray claw piece now: its exemption has expired. Delete it.`).toBeGreaterThan(0);
    expect(STRAY_CLAW_EXEMPT[team].length, 'a reason, not a name').toBeGreaterThan(20);
  });
});

describe('G2 can fail (constructed inputs)', () => {
  const squad = readGlb(`${MESHES}inf_squad.glb`);
  it('the shipped Rifle Squad is clean', () => {
    expect(strayClawPieces(squad)).toEqual([]);
  });
  it('a few hand vertices re-bound to the spine read as a piece off the hand (a modelled glove\'s own texel)', () => {
    const v = strayClawPieces(rebindVertices(squad, 'f1_hand_L', 'f1_spine', 6));
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].how).toBe('glove');
    expect(v[0].bones).toEqual(['f1_spine']);
  });
  it('the shipped Combat Engineer reads its thigh pieces by tone, about 358 cm2 a man', () => {
    const demo = teams.find(([t]) => t === 'demo_squad')![1];
    const v = strayClawPieces(demo).filter((s) => s.build === 'demo_a');
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v.every((s) => s.how === 'tone')).toBe(true);
    expect(v.reduce((a, s) => a + s.areaCm2, 0)).toBeGreaterThan(300);
    expect(v.some((s) => s.bones.some((b) => /thigh/.test(b)))).toBe(true);
  });
});
