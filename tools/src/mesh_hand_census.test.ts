/**
 * G1 -- the hand census (GH-746 follow-up, the 1 Nov infantry audit). Every figure build of every infantry GLB has EXACTLY
 * TWO hands, each a modelled assembly on its own `{prefix}_hand_{L|R}` bone with the generator's piece count.
 *
 * Why it exists. Every earlier hand check (`measureGrip`, `mesh_grip.test.ts`, `measureHand`, the contact floor) iterated
 * over the hand bones a file HAS and asked how far each was from its station. A hand that was missing, fused into the torso
 * or not on a hand bone was not in the population, so nothing counted: the lead saw open claws, a one-handed squad and a
 * three-handed engineer on a store that every gate called green. This counts the hands first.
 *
 * Literals, from the Rifle Squad's bytes (the only team the hands pass has been through, PR 924): a living hand is 397
 * triangles in 7 connected pieces (welded at 0.5 mm; the audit said 8 -- palm, cuff, thumb, four fingers, pad -- and two of
 * them touch). Nothing is imported from the generator.
 *
 * Every other team is a NAMED exemption. Each exemption is asserted to still fail (the demotion assertion): the day a team's
 * hands land, its entry goes red and must be deleted, which is what keeps the list honest as the art backlog.
 *
 * Falsified (run, watched red, put back): see the constructed inputs at the bottom, and the exemption-removal check in the
 * PR body (`inf_squad` with its hand bone emptied; `mortar_team` with its exemption deleted).
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readGlb } from './mesh_gait';
import { figureBuilds, infantryTeams, rebindVertices } from './mesh_figures';
import { censusViolations } from './mesh_hand_gates';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/**
 * Teams with no modelled hands yet, and what each has instead. READ, not asserted of the audit: every one of these has no
 * `_hand_` bone in the bytes. The gloss is the audit's (`inf-audit/audit.md` section 2). Adding a name here is a design call;
 * removing one is the point.
 */
const HAND_CENSUS_EXEMPT: Readonly<Record<string, string>> = {
  at_nlos_team: 'open Meshy claws cut onto the forearm; nl_load is unarmed, nl_gun\'s launcher stands apart in the store',
  at_team: 'open claws, half size (0.086 m); at_spot holds only a box of binoculars',
  atgm_cell: 'one claw per man on the audit\'s reading: the left hand is a 1.4 cm sliver',
  breach_team: 'one separable claw; the firing arm is fused into the torso',
  charge_squad: 'open claws, wide; chg0 holds nothing',
  demo_squad: 'open orange claws, plus claw-tone polygons on both thighs (the "three hands", see mesh_fragments.test.ts)',
  digger_crew: 'arm fused into the torso: no separable hand',
  inf_grenadier: 'open tan claws on the launchers',
  inf_medic_squad: 'open claws, the firing hand a block 0.12 m thick',
  manpad_team: 'open claws; mpd_spot holds only a spotting scope',
  militia_cell: 'open claws, the firing hand flat and short',
  mortar_crew: 'open claws; the loader holds no round',
  mortar_team: 'open pink claws; the two crewmen hold nothing anywhere',
  officer_engineer: 'the Combat Engineer body: open orange claws and the thigh fragments',
  officer_fires: 'sagi: arm fused into the torso; rto: open claws',
  officer_infantry: 'open claws on both officers; maya carries no weapon',
  recoilless_team: 'open claws, the largest shipped (0.22 m)',
  recon_zikit: 'black claws on a black vest; two of three men hold nothing',
  rpg_team: 'open claws; rpg_load carries no rocket',
  sarim_rifles: 'open claws on all three riflemen',
  sniper_team: 'arms welded to the torso: no separable hand',
  yahalom_squad: 'open black claws; yah_a holds only a detector pole',
};

const teams = infantryTeams(MESHES, (d) => readdirSync(d));

describe('G1: every figure has exactly two modelled hands', () => {
  it('reads the population it says it reads (a census of nothing passes everything)', () => {
    expect(teams.length).toBe(23);
    expect(teams.map(([t]) => t)).toContain('inf_squad');
    expect(teams.map(([t]) => t)).toContain('mortar_team');
    expect(teams.reduce((n, [, g]) => n + figureBuilds(g).length, 0)).toBeGreaterThanOrEqual(60);
  });

  it('the exemptions name real teams, and every team is either gated or exempt', () => {
    const names = teams.map(([t]) => t);
    for (const k of Object.keys(HAND_CENSUS_EXEMPT)) expect(names, `${k}: an exemption for a team that is not an infantry GLB`).toContain(k);
    expect(names.filter((t) => !(t in HAND_CENSUS_EXEMPT))).toEqual(['inf_squad']);
  });

  it.each(teams.filter(([t]) => !(t in HAND_CENSUS_EXEMPT)))('%s: every figure has two hands', (_t, glb) => {
    expect(censusViolations(glb)).toEqual([]);
  });

  it.each(teams.filter(([t]) => t in HAND_CENSUS_EXEMPT))(
    '%s: still fails the census (else delete it from HAND_CENSUS_EXEMPT)',
    (team, glb) => {
      const v = censusViolations(glb);
      expect(v.length, `${team} now has two hands on every figure: its exemption has expired. Delete it.`).toBeGreaterThan(0);
      expect(HAND_CENSUS_EXEMPT[team].length, 'a reason, not a name').toBeGreaterThan(20);
    }
  );
});

describe('G1 can fail (constructed inputs)', () => {
  const squad = readGlb(`${MESHES}inf_squad.glb`);
  it('the shipped Rifle Squad is clean, so the reds below are the mutation and nothing else', () => {
    expect(censusViolations(squad)).toEqual([]);
  });
  it('a hand bone with its geometry moved off it reads as one hand', () => {
    const v = censusViolations(rebindVertices(squad, 'f1_hand_R', 'f1_forearm_R'));
    expect(v.join(' | ')).toMatch(/f1: 1 hands, not 2/);
  });
  it('a hand missing a piece reads the wrong piece count', () => {
    // moving a thumb-sized corner of vertices away leaves 6 or fewer connected pieces, or breaks the triangle band
    const v = censusViolations(rebindVertices(squad, 'f2_hand_L', 'f2_forearm_L', 20));
    expect(v.length).toBeGreaterThan(0);
  });
  it('a Meshy claw (no hand bone at all) reads zero hands', () => {
    const mortar = teams.find(([t]) => t === 'mortar_team')![1];
    expect(censusViolations(mortar).join(' | ')).toMatch(/mtr_crew0: 0 hands, not 2/);
  });
});
