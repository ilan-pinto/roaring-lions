// A crew-served weapon's gunner is ON the gun (unit polish, the lead's ruling
// of 2026-10-14): the ATGM gunner's eye at the sight and both hands on the
// grips, the mortar gunner's inboard hand on the elevating handwheel -- in
// `idle` and in `fire`, read off the exported bytes (`measureCrewOnGun`).
//
// Before this (origin/main 2deafcca) the atgm_cell gunner knelt beside the
// rear of the tube with his hands hanging at his knees, and neither crew had
// a `fire` clip at all, so the crew stood in `idle` while a missile or a bomb
// left. Measured there: eye 0.44 m and hands 0.34 / 0.36 m from the post (red
// here), and mortar_crew's 48-vertex kit tube is refused outright (< 100).
//
// The bounds are LITERALS, not the pass's own targets (`EYE_GAP_M`,
// `CREW_GRIP_GAP_M`): the oracle must not import its arguments from the code
// under test. The eye is a face centroid, which sits inside the head, so
// "about 0.06 m from the sight" reads as up to 0.10 here; a hand is the far
// tenth of the forearm, which sits around the grip, so 0.05.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureCrewOnGun, readGlb } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

const ROWS: readonly {
  file: string;
  gunner: string;
  eye: number | null;
  hands: readonly ('L' | 'R')[];
  roles?: readonly string[];
}[] = [
  { file: 'atgm_cell.glb', gunner: 'atgm_crew0', eye: 0.1, hands: ['L', 'R'] },
  // On the mortar's right: his inboard (left) hand is rig `_R`.
  { file: 'mortar_crew.glb', gunner: 'emtr_crew0', eye: null, hands: ['R'] },
  // GH-709 Phase 7: the Zaron gunner works the fire-control case (`metal` on
  // `prop`), not the launcher: both hands on its grips, and his eye over the
  // case at arm's length from the screen, not on an eyepiece. 0.45 m: a man
  // reading a screen on the ground, against 0.44 m for the pre-polish ATGM
  // gunner who knelt BESIDE his post (the header above).
  { file: 'at_nlos_team.glb', gunner: 'nl_gun', eye: 0.45, hands: ['L', 'R'], roles: ['metal'] },
];
const HAND_MAX_M = 0.05;

describe('a crew-served gunner is on the gun', () => {
  for (const row of ROWS) {
    it(`${row.file} has a fire clip`, () => {
      const path = `${MESHES}${row.file}`;
      expect(existsSync(path), path).toBe(true);
      expect((readGlb(path).json.animations ?? []).map((a) => a.name)).toContain('fire');
    });
    for (const clip of ['idle', 'fire']) {
      it(`${row.file} ${clip}: ${row.gunner}'s ${row.eye !== null ? 'eye at the sight and ' : ''}hands on the weapon`, () => {
        const r = measureCrewOnGun(`${MESHES}${row.file}`, clip, row.gunner, row.roles);
        expect(r.instants, `${row.file} ${clip}: instants`).toBeGreaterThan(2);
        if (row.eye !== null) expect(r.eyeM, `${row.file} ${clip}: eye to the weapon`).toBeLessThan(row.eye);
        for (const side of row.hands) expect(r.handM[side], `${row.file} ${clip}: hand ${side} to the weapon`).toBeLessThan(HAND_MAX_M);
      });
    }
  }
});
