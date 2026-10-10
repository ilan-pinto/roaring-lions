// A held launcher must not pass through the man holding it.
//
// PR #325 found at_team's Spike running through its kneeling gunner's head,
// neck and chest; the same defect sat on rpg_team, manpad_team and
// recoilless_team (`import_meshy_crew_team.py`), 520-1140 weapon samples
// inside the holder in every clip -- and every gate in the tree was green,
// because none of them asks the weapon and the body the same question. This
// one does, on the exported bytes, through every clip's own skinning
// (`measureHeldWeaponInBody`). Both exporters now seat the tube on the
// shoulder beside the head (`_shoulder_launcher`, `_seat_launcher`); the
// count is 0 in every clip on all four, and this is what keeps it there.
//
// Falsified (2026-10-01) by pointing `MESHES` at the four pre-fix GLBs: 11
// of 11 drawn-clip tests red -- samples inside (idle / fire / move) at_team
// 260 / 266 / 260, rpg_team 457 / 470 / 551, manpad_team 233 / 241 / 267,
// recoilless_team 342 / 342 (its `move` scales the kneeling gunner and the
// tube out). Lower than the Blender census's 520-1140 because this samples
// edges at 2 cm, not 1, over 9 instants. ~2.5 s for all fifteen.
//
// Speed (GH-344): the winding-number test was O(samples x body triangles),
// 26.5 s CPU for this file locally. It is a Barnes-Hut tree now
// (`windingInside`, `mesh_gait.ts`): far triangle groups contribute a
// far-field term with a conservative error bound, and a sample whose
// estimate lies within that bound of the 0.5 threshold is redone exactly, so
// the VERDICT is the exact one. Re-proved on the same pre-fix GLBs: identical
// counts (260/266/260, 457/470/551, 233/241/267, 342/342, yah 86/86/89/88/79)
// and zero verdict mismatches against the exact sum on every sample.
//
// CI (GH-344, 2026-10-04): the gates job read this file at 12.2 s and
// `launcher_arms` at 2.5 s (run 37152144304; ~3.1 s / ~1.0 s locally). The
// traversal is closure- and allocation-free now, `measureArmInBody` uses the
// same tree, and `readGlb`/`readAccessor` are memoised per path. ~2.0 s here
// (was ~3.1); verdicts re-proved on the same pre-fix GLBs, counts identical.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureHeldWeaponInBody, measureMountedPartInBody, readGlb } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** file -> the figure holding the launcher, and the clips it is drawn in. */
const HOLDERS: readonly (readonly [string, string, readonly string[]])[] = [
  // `moveFire` (2026-10-05): the walker's legs under `fire`'s arms.
  ['at_team.glb', 'at_fire', ['idle', 'fire', 'move', 'moveFire']],
  ['rpg_team.glb', 'rpg_fire', ['idle', 'fire', 'move', 'moveFire']],
  ['manpad_team.glb', 'mpd_fire', ['idle', 'fire', 'move', 'moveFire']],
  // The kneeling gunner walks on a D6 walker that carries nothing; the
  // kneeler and his tube are scaled out of `move`.
  ['recoilless_team.glb', 'rcl_fire', ['idle', 'fire']],
];

describe('a held launcher stays out of its holder', () => {
  for (const [file, figure, clips] of HOLDERS) {
    for (const clip of clips) {
      it(`${file} ${clip}: no ${figure} launcher sample inside his head, neck or torso`, () => {
        const path = `${MESHES}${file}`;
        expect(existsSync(path), path).toBe(true);
        const r = measureHeldWeaponInBody(path, clip, figure);
        // Not a vacuous pass: the weapon was drawn, and sampled densely.
        expect(r.instants, `${file} ${clip}: instants with the weapon drawn`).toBeGreaterThan(0);
        expect(r.samples, `${file} ${clip}: weapon samples`).toBeGreaterThan(500);
        expect(r.worstInside, `${file} ${clip}: samples inside ${figure}`).toBe(0);
      });
    }
    it(`${file}: the launcher is scaled out with its holder in down/wreck`, () => {
      for (const clip of ['down', 'wreck']) {
        expect(measureHeldWeaponInBody(`${MESHES}${file}`, clip, figure).instants, `${file} ${clip}`).toBe(0);
      }
    });
  }
});

/**
 * B7 review (2026-10-01): the same defect class on parts that are not held.
 * yahalom_squad's square packs (`webbing` on each man's `spine`) sat at
 * `teams._yah_pack`'s kit position, 0.18 m behind a kit figure's axis, which
 * on a Meshy torso (back at x -0.25) ran each box through the chest -- in
 * every clip, `work` included. And mortar_team's tube and bipod (`prop`,
 * shared) must stay out of all three crewmen. Falsified by pointing `MESHES`
 * at the pre-fix GLBs (the first B7 commits): yah_a 86 / 86 / 89 samples
 * inside on idle / fire / move, yah_b 86 / 88 / 89, the work kneeler yah_ak
 * 79 -- all red; the mortar read 0 on both GLBs (its placement was never
 * the defect there; the shards were the cut, see `_bisect_source`).
 */
const MOUNTED: readonly (readonly [string, string, readonly string[], readonly string[], string, RegExp])[] = [
  // file, label, clips, roles, mount joint, body joints
  ['yahalom_squad.glb', 'yah_a pack', ['idle', 'fire', 'move', 'moveFire'], ['webbing'], 'yah_a_spine', /^yah_a_(head|neck|spine|pelvis)$/],
  ['yahalom_squad.glb', 'yah_b pack', ['idle', 'fire', 'move', 'moveFire'], ['webbing'], 'yah_b_spine', /^yah_b_(head|neck|spine|pelvis)$/],
  ['yahalom_squad.glb', 'yah_ak pack (work)', ['work'], ['webbing'], 'yah_ak_spine', /^yah_ak_(head|neck|spine|pelvis)$/],
  ['mortar_team.glb', 'the mortar vs its crew', ['idle', 'fire'], ['weapon', 'metal'], 'prop', /^mtr_(crew0|crew1|no3)_/],
  // A3.1 stage 2 (2026-10-05): the Meshy ATGM post's four splayed legs reach
  // further than kit's three; at kit's own anchor 8 samples sat inside a
  // kneeling crewman, so the importer slides the mount forward until clear.
  // atgm_cell has no `fire` clip.
  ['atgm_cell.glb', 'the ATGM post vs its crew', ['idle'], ['weapon'], 'prop', /^atgm_crew(0|1)_/],
];

describe('a mounted kit part stays out of the body it rides', () => {
  for (const [file, label, clips, roles, joint, body] of MOUNTED) {
    for (const clip of clips) {
      it(`${file} ${clip}: ${label} -- no sample inside`, () => {
        const r = measureMountedPartInBody(`${MESHES}${file}`, clip, {
          roles,
          joint,
          bodyJoint: (name) => body.test(name),
        });
        expect(r.instants, `${file} ${clip}: instants with the part drawn`).toBeGreaterThan(0);
        expect(r.samples, `${file} ${clip}: part samples`).toBeGreaterThan(100);
        expect(r.worstInside, `${file} ${clip}: samples inside`).toBe(0);
      }, 30_000); // the mortar's 2,432 samples against three whole crewmen read ~10 s
    }
  }
});

/**
 * breach_team's breaching pole is GONE (the lead, 7 Oct: "the gray tube is
 * misplaced ... maybe you can completely remove it"). `kit.breach_pole` was
 * written for a kit figure, "slung across the back"; on the Meshy cover man
 * (`import_meshy_crew_team.py`, B5) it stood on his centre line instead, a
 * 1.2 m `charge` rod with its block tip at his face, read in the game as a
 * grey slab from his helmet to his groin. Measured through
 * `measureMountedPartInBody` on the last file that carried it (79e528c4):
 * 929-953 of 1,748-1,756 pole samples inside brc_cover's head, neck, spine
 * or pelvis in idle, fire, move and moveFire -- more than half the rod ran
 * through him. No MOUNTED row can hold it, since the part no longer exists;
 * what the file carries is pinned instead, by role, so the rod (the team's
 * only `charge`) cannot come back through a re-export unnoticed.
 */
describe('breach_team carries no breaching pole', () => {
  it('ships exactly the shield, the carbines and the two men -- no `charge` role', () => {
    const glb = readGlb(`${MESHES}breach_team.glb`);
    const meshes = glb.json.meshes ?? [];
    const roles = (glb.json.nodes ?? [])
      .filter((n) => n.mesh !== undefined)
      .map((n) => n.name ?? meshes[n.mesh as number]?.name ?? '');
    expect(roles.sort()).toEqual(['boot', 'face', 'metal', 'uniform', 'weapon']);
  });
});
