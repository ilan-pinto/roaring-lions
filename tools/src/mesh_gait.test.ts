// Issue #145 -- the mortar team slid across the ground, and nothing caught it.
//
// `validate:meshes` renders each GLB and checks palette, alpha, framing and
// silhouette IoU. `mesh-unit.test.ts` checks the LOADER against a hand-authored
// fixture. Neither looks at what a clip does, so a rig with no leg bones passed
// every gate in the tree while the unit it drew skated. This file is the gate
// that would have caught it: skin the `boot` mesh with its own animated joints
// and compare one `move` cycle's travel against the ground the sim actually
// moves the unit over in that time.
//
// Every number is read, never assumed: the speed from the unit's own JSON, the
// clip length from the GLB's own sampler times, `MESH_UNITS_PER_TILE` from
// `mesh-anim.ts`'s own constant restated in `mesh_gait.ts`.
//
// `mortar_team.glb` (the `tools/units/kit.py` build) is here as a CONTROL. A
// threshold test with no known-good file is a test of its own threshold: if the
// skinning maths in `mesh_gait.ts` were wrong it would report a slide for
// everything, and the assertion below would pass for the wrong reason.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { groundPerCycleM, measureRoleTravel } from './mesh_gait';
import { RIGGED_UNIT_MESHES } from '../../packages/app/src/mesh-catalogue';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const MESHES = `${REPO}art/meshes/`;

/** `data/units/kdf/mortar_team.json`'s own `mobility.speed_tiles_s`. */
function mortarSpeedTilesPerSecond(): number {
  const json = JSON.parse(readFileSync(`${REPO}data/units/kdf/mortar_team.json`, 'utf8')) as {
    mobility: { speed_tiles_s: number };
  };
  return json.mobility.speed_tiles_s;
}

/**
 * Fraction of the ground covered in one `move` cycle that the boots must
 * actually travel. The two known-good walks in this tree both land near 0.89
 * (`mortar_team.glb` 0.887, `inf_squad.glb` 0.891) and the legless rig this
 * gate exists for landed at 0.032, so anything in between separates them.
 * Set at 0.60 rather than 0.85 so a deliberately different gait -- a shorter
 * shuffle, a crew that jogs rather than strides -- is not failed for being
 * different, only for not walking at all.
 */
const WALK_FLOOR = 0.6;

/**
 * Which GLB the app actually loads for `mortar_team`.
 *
 * This used to be a REGEX over `packages/app/src/main.ts`, with the comments
 * stripped first because that file's prose named both candidate basenames and
 * a raw-source match would have hit the wrong one. It is an import now: the
 * wiring moved to `packages/app/src/mesh-catalogue.ts` when mesh loading
 * became roster-driven, and that table is plain data with no `import.meta.url`
 * in it precisely so a node-side reader can ask it directly. Same question,
 * asked of the thing itself rather than of its source text.
 *
 * A `mortar_team` drawing several variants would make "the GLB" ambiguous;
 * only `civilians` does that today, so this asserts the single-file shape
 * rather than silently measuring the first of a list.
 */
function wiredMortarGlb(): string {
  const entry = RIGGED_UNIT_MESHES.mortar_team;
  if (!entry) throw new Error('mesh-catalogue loads no mesh for mortar_team');
  if (entry.files.length !== 1) {
    throw new Error(
      `mortar_team now has ${entry.files.length} mesh variants — this gate measures one`
    );
  }
  return entry.files[0];
}

describe('mesh unit gait', () => {
  it('the kit.py mortar_team walks -- the control for the instrument itself', () => {
    const m = measureRoleTravel(`${MESHES}mortar_team.glb`, 'boot', 'move');
    const ground = groundPerCycleM(mortarSpeedTilesPerSecond(), m.clipSeconds);
    expect(ground).toBeCloseTo(1.3, 2);
    expect(m.maxTravelM / ground).toBeGreaterThan(0.85);
  });

  it('the Meshy mortar_team walks rather than slides (#145)', () => {
    const m = measureRoleTravel(`${MESHES}meshy_mortar_team.glb`, 'boot', 'move');
    const ground = groundPerCycleM(mortarSpeedTilesPerSecond(), m.clipSeconds);
    expect(m.maxTravelM / ground).toBeGreaterThan(WALK_FLOOR);
  });

  it('whichever GLB the mesh catalogue wires to mortar_team is the one that walks', () => {
    const m = measureRoleTravel(`${MESHES}${wiredMortarGlb()}`, 'boot', 'move');
    const ground = groundPerCycleM(mortarSpeedTilesPerSecond(), m.clipSeconds);
    expect(m.maxTravelM / ground).toBeGreaterThan(WALK_FLOOR);
  });
});
