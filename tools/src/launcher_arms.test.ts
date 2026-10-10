// A launcher gunner's arms must not sink back into his own chest.
//
// #327 seated the rpg/manpad/recoilless tubes on the shoulder
// (`launcher_clearance.test.ts` keeps the TUBE out of the body) and re-seated
// both gunner arms with PR #325's two-bone IK -- which sank the arms deeper
// into the torso, and nothing measured it: arm vertices inside head/neck/
// spine went rpg 223 -> 391, manpad 29 -> 274, recoilless 152 -> 225 (#327's
// own census). `import_meshy_crew_team.py` now measures the re-seat (grip
// slide, support seat, elbow swivel, shoulder protraction); this is the gate
// on the exported bytes, through each clip's own skinning
// (`mesh_gait.measureArmInBody`).
//
// Ceilings are the pre-#327 level per clip, measured with this same
// instrument on the GLBs at 318bcea6 (rpg 223 / 223 / 281, recoilless 144 /
// 152, at_team 148 / 150 / 148 -- at_team's own arms were never re-seated by
// #327). manpad_team is the exception: its pre-#327 29 was the B2 figure,
// and the team has been on the Sarim body since the lead's 2026-10-02 ruling,
// so its ceiling is that body's own militia rifleman (militia_cell mil0,
// 196 / 196 / 207), whose arms carry nothing across his chest.
//
// Falsified (2026-10-02) by pointing `MESHES` at the GLBs on main before this
// change (2b539784): rpg 391 / 391 / 391, manpad 424 / 427 / 427, recoilless
// 181 / 181 -- 8 of 8 red, at_team green (its file is unchanged). And by a
// one-line mutation of `measureArmInBody`'s inside test (winding > 0.5 ->
// > 5.5, so nothing reads inside): 11 of 11 red on the floor assertion.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureArmInBody } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** file -> the gunner, and each drawn clip's ceiling (arm vertices inside). */
const GUNNERS: readonly (readonly [string, string, Readonly<Record<string, number>>])[] = [
  // `moveFire` (2026-10-05) takes its `move` ceiling: the same walking torso,
  // with `fire`'s arms held against its lean. Read on the new bytes: at_team
  // 148, rpg 229, manpad 200.
  ['at_team.glb', 'at_fire', { idle: 148, fire: 150, move: 148, moveFire: 148 }],
  ['rpg_team.glb', 'rpg_fire', { idle: 223, fire: 223, move: 281, moveFire: 281 }],
  ['manpad_team.glb', 'mpd_fire', { idle: 196, fire: 196, move: 207, moveFire: 207 }],
  // The kneeling gunner and his tube are scaled out of `move` (D6 walker).
  ['recoilless_team.glb', 'rcl_fire', { idle: 144, fire: 152 }],
];

describe("a launcher gunner's arms stay out of his own chest", () => {
  for (const [file, figure, ceilings] of GUNNERS) {
    for (const [clip, ceiling] of Object.entries(ceilings)) {
      it(`${file} ${clip}: ${figure}'s arm vertices inside his head, neck or torso <= ${ceiling}`, () => {
        const path = `${MESHES}${file}`;
        expect(existsSync(path), path).toBe(true);
        const r = measureArmInBody(path, clip, figure);
        // Not a vacuous pass: the figure was drawn, and both arms were read.
        expect(r.instants, `${file} ${clip}: instants drawn`).toBeGreaterThan(0);
        expect(r.samples, `${file} ${clip}: arm vertices`).toBeGreaterThan(400);
        // ...and the instrument can see inside at all: every upper arm's root
        // sits in its spine-bound deltoid blob by construction (the blob hides
        // the cut), so a reading of 0 is a broken measurement, not a clean arm.
        expect(r.worstInside, `${file} ${clip}: arm vertices inside ${figure}`).toBeGreaterThan(0);
        expect(r.worstInside, `${file} ${clip}: arm vertices inside ${figure}`).toBeLessThanOrEqual(ceiling);
      }, 30_000);
    }
  }
});
