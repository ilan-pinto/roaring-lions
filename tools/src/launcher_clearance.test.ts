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
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureHeldWeaponInBody } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** file -> the figure holding the launcher, and the clips it is drawn in. */
const HOLDERS: readonly (readonly [string, string, readonly string[]])[] = [
  ['at_team.glb', 'at_fire', ['idle', 'fire', 'move']],
  ['rpg_team.glb', 'rpg_fire', ['idle', 'fire', 'move']],
  ['manpad_team.glb', 'mpd_fire', ['idle', 'fire', 'move']],
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
