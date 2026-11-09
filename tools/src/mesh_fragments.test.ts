/**
 * G2 -- no floating claw pieces (GH-746 follow-up, the 1 Nov infantry audit). A hand-coloured patch bound to a bone that is
 * not a hand is a third "hand": on the Combat Engineer, 91 cm2 of orange claw polygons ride the thighs, and when the arm
 * moves they stay at the hip. To every per-bone check that geometry is "body", so no grip gate could see it; the demo
 * review found it with a colour census, which is the right instrument and had never been a gate.
 *
 * The reading is `strayClawReport` (mesh_figures.ts): the figure's OWN claw tone (the median Lab of its claw triangles) and
 * the legacy literals (CIE Lab: the KDF orange (54, 16, 40) and (42, 18, 33), the crews' pink (55, 28, 26)) matched near its
 * hand, or, for a modelled hand, the glove's own texel anywhere off a hand bone.
 *
 * WHAT G2 CANNOT SEE, stated plainly. A tone test means something only where the claw is not the colour of the body. The dark
 * claws (black, dark olive, grey: chroma under 25, 11 teams) match the black trousers, belts and pouches beside them (a first
 * version that used their own tone flagged a belt and a sleeve as claws), so on those builds G2 reads NOTHING and a black claw
 * fragment on a hip passes. They are listed below as `G2_BLIND`, asserted to stay blind (it empties as the hands pass models
 * them, and the glove-texel mode takes over), and are the G2 backlog. Builds with no hand geometry at all (fused arms) are
 * on the same list: there is no hand to measure a fragment from.
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
import { deltaE, infantryTeams, rebindVertices, strayClawPieces, strayClawReport } from './mesh_figures';
import { handsSource } from './mesh_hand_gates';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** Teams carrying claw polygons off the hand. Measured on the bytes: demo_a and demo_b 358 cm2 each in 3 pieces on the thighs and pelvis. */
const STRAY_CLAW_EXEMPT: Readonly<Record<string, string>> = {
  demo_squad: 'orange claw polygons bound to the thighs and pelvis of both men: the third hand at the hip',
  officer_engineer: 'the Combat Engineer body (sap): the same orange claw polygons on the thighs and pelvis',
};

/**
 * Builds on which the tone test is blind, by team: dark claws, or no separable hand. Literal, asserted both ways: a build
 * that becomes readable (its hands modelled, or a chromatic repaint) must leave this list.
 */
const G2_BLIND: Readonly<Record<string, readonly string[]>> = {
  atgm_cell: ['atgm_crew0', 'atgm_crew1'],
  breach_team: ['brc_cover', 'brc_point'],
  charge_squad: ['chg0', 'chg1'],
  digger_crew: ['dig'],
  manpad_team: ['mpd_fire', 'mpd_spot'],
  militia_cell: ['mil0', 'mil1'],
  mortar_crew: ['emtr_crew0', 'emtr_crew1'],
  officer_fires: ['sagi'],
  recoilless_team: ['rcl_fire', 'rcl_load'],
  recon_zikit: ['zk_radio', 'zk_rifle', 'zk_spot'],
  rpg_team: ['rpg_fire', 'rpg_load'],
  sarim_rifles: ['sar0', 'sar1', 'sar2'],
  sniper_team: ['snp_a', 'snp_b'],
  yahalom_squad: ['yah_a', 'yah_ak', 'yah_b'],
};

const teams = infantryTeams(MESHES, (d) => readdirSync(d));

describe('G2: no claw-coloured geometry off the hand', () => {
  it('reads the whole population (23 teams)', () => {
    expect(teams.length).toBe(23);
  });
  it.each(teams)('%s: the builds G2 cannot see are exactly the listed ones', (team, glb) => {
    expect(strayClawReport(glb).blind.sort(), `${team}: a build became readable (or unreadable): update G2_BLIND`).toEqual([...(G2_BLIND[team] ?? [])].sort());
  });
  it('the blind list names real teams', () => {
    for (const k of Object.keys(G2_BLIND)) expect(teams.map(([t]) => t), k).toContain(k);
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

describe('R7 (the coordinator, 9 Nov): the legacy claw tones read CLAW builds only', () => {
  // The change stands only if (a) a claw piece on a claw-hand figure still turns G2 red, and (b) what the legacy tones
  // flagged on the Meshy Rifle Squad (a non-claw figure with a glove texel) was not a claw.
  it('(a) a claw-hand figure: mortar_team\'s pink claw (a LEGACY tone, 55 28 26) bound to the pelvis still reads red', () => {
    const mt = teams.find(([t]) => t === 'mortar_team')![1];
    const v = strayClawPieces(rebindVertices(mt, 'mtr_crew0_forearm_L', 'mtr_crew0_pelvis', 60));
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((p) => p.how === 'tone')).toBe(true);
  });
  it('(b) the Meshy Rifle Squad: every piece the legacy tones would flag is its coyote carrier, on the trunk, not a hand', () => {
    const squad = readGlb(`${MESHES}inf_squad.glb`);
    const forced = strayClawReport(squad, { legacyTones: 'always' }).pieces.filter((p) => p.how === 'tone');
    for (const p of forced) {
      expect(p.bones.every((b) => /_(spine|pelvis)$/.test(b)), JSON.stringify(p)).toBe(true);
      // the carrier coyote #806032 is Lab (43, 7, 31): a piece within 8 dE of it is the vest the lead had retinted
      expect(deltaE(p.lab!, [43, 7, 31]), JSON.stringify(p)).toBeLessThan(8);
    }
    // ...and the scoped reading reads none of them
    expect(strayClawReport(squad).pieces.filter((p) => p.how === 'tone')).toEqual([]);
  });
});

describe('G2 can fail (constructed inputs)', () => {
  const squad = readGlb(`${MESHES}inf_squad.glb`);
  it('the shipped Rifle Squad is clean', () => {
    expect(strayClawPieces(squad)).toEqual([]);
  });
  it('a few hand vertices re-bound to the spine read as a piece off the hand (a modelled glove\'s own texel)', () => {
    if (handsSource(squad) === 'meshy') {
      // A sculpted, BAKED glove (the Meshy pilot, 1 Nov) has no single glove texel and, retinted dark brown (C* under
      // 25), no tone a claw test can tell from the trousers: G2 has NO instrument for a piece of it bound elsewhere.
      // Asserted here as the gate's known blind spot, not passed quietly; the census (G1) and the holds (G3) are what
      // read a sculpted hand today.
      expect(strayClawPieces(rebindVertices(squad, 'f1_hand_L', 'f1_spine', 40))).toEqual([]);
      return;
    }
    const v = strayClawPieces(rebindVertices(squad, 'f1_hand_L', 'f1_spine', 6));
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].how).toBe('glove');
    expect(v[0].bones).toEqual(['f1_spine']);
  });
  it('a chromatic (tan) claw that is not one of the three literals is read by its own tone: at_team\'s claw bound to the thigh', () => {
    const at = teams.find(([t]) => t === 'at_team')![1];
    expect(strayClawPieces(at)).toEqual([]);
    const v = strayClawPieces(rebindVertices(at, 'at_fire_forearm_L', 'at_fire_thigh_L', 60));
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]).toMatchObject({ build: 'at_fire', how: 'tone', bones: ['at_fire_thigh_L'] });
  });
  it('the same for the crews\' pink claw (mortar_team) bound to the pelvis', () => {
    const mt = teams.find(([t]) => t === 'mortar_team')![1];
    expect(strayClawPieces(mt)).toEqual([]);
    expect(strayClawPieces(rebindVertices(mt, 'mtr_crew0_forearm_L', 'mtr_crew0_pelvis', 60)).length).toBeGreaterThan(0);
  });
  it('a dark claw gives G2 nothing to read: atgm_cell stays clean with its forearm moved to the pelvis, and is listed blind', () => {
    // The limit, run: this would be a stray piece on a pink claw (above); on a black one the gate cannot tell it from trousers.
    const atgm = teams.find(([t]) => t === 'atgm_cell')![1];
    const moved = rebindVertices(atgm, 'atgm_crew0_forearm_L', 'atgm_crew0_pelvis', 60);
    expect(strayClawPieces(moved)).toEqual([]);
    expect(strayClawReport(moved).blind).toContain('atgm_crew0');
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
