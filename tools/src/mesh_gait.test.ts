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
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_TRAVEL_FRACTION,
  circularMeanDeg,
  groundPerCycleM,
  measureFacing,
  measureRoleFootprint,
  measureRoleTravel,
} from './mesh_gait';
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

describe('mesh unit facing', () => {
  it('reads the kit rigs at their authored contrapposto, not a defect', () => {
    // kit.py's figure() yaws the head off the body axis by 0.18 rad (10.3 deg)
    // deliberately -- "a head square to the shoulders is a machine stance".
    // Measured on the running game: every kit team sits at +3..+11.
    const figs = measureFacing(`${MESHES}militia_cell.glb`, 'move');
    expect(figs.length).toBeGreaterThan(0);
    for (const f of figs) expect(Math.abs(f.meanDeg)).toBeLessThan(20);
  });

  // The KDF rifleman used to fire, stand and go to ground facing BACKWARD,
  // and it was one mechanism producing all three: `import_meshy_soldier.py`
  // bound the whole of `Gun_Hold_Left_Turn` to `idle` -- a clip that turns
  // roughly 180 degrees -- and `build_fire_src`/`build_down_src` both took
  // their base pose from that clip's LAST frame. Measured on the shipped
  // bytes before the fix: `fire` -156, `down` -163, `idle` sweeping +23 to
  // -159, against `move`'s correct -5.
  //
  // This test was the pre-fix characterisation (it asserted |meanDeg| > 120,
  // pinning that the instrument could SEE the bug, which is what makes the
  // gate in Task 7 trustworthy). Task 2 fixed the asset: the script now
  // measures where the turn begins, binds only the pre-turn hold, yaws that
  // hold to face +X, and takes fire's and down's base pose from inside the
  // window. So the expectation is flipped to the in-band one.
  //
  // The ceilings are NOT restated here. `import_meshy_soldier.py`'s own
  // `CLIP_SEMANTICS` gates the same six clips at build time, and two numbers
  // both claiming to be "the ceiling for moveFire" is how they drift apart --
  // so this reads them out of that file, the way
  // `textured-building.test.ts` reads `TEXTURED_BUILDING_EXEMPT`. One source,
  // derived twice.
  //
  // The two instruments are not identical and the shared ceiling is
  // deliberately the conservative side of that. The Python gate measures the
  // rig's own `Head`->`headfront` marker pair; `measureFacing` here centroids
  // the `face` mesh's own vertices against the head JOINT. Measured offset
  // between them on this asset: 1-3 degrees on a square head, up to ~7 on a
  // bladed one (`moveFire` reads +10.8 there and +17.6 here). Every clip
  // still clears its ceiling with real margin on BOTH.
  function headingCeilings(): Record<string, number> {
    const py = readFileSync(fileURLToPath(new URL('../import_meshy_soldier.py', import.meta.url)), 'utf8');
    const table = /\nCLIP_SEMANTICS = \{\n([\s\S]*?)\n\}\n/.exec(py);
    expect(table, 'CLIP_SEMANTICS not found in tools/import_meshy_soldier.py').not.toBeNull();
    const out: Record<string, number> = {};
    for (const entry of (table as RegExpExecArray)[1].split(/\n {4}(?=")/)) {
      // The FIRST chunk still carries its own indent; the split consumed it
      // for every later one.
      const name = /^\s*"(\w+)":/.exec(entry);
      const heading = /"heading":\s*(?:None|\{"mean_deg":\s*([\d.]+))/.exec(entry);
      expect(name, `a CLIP_SEMANTICS entry has no parseable clip name: ${entry.slice(0, 60)}`).not.toBeNull();
      expect(heading, `CLIP_SEMANTICS['${name?.[1]}'] has no parseable "heading"`).not.toBeNull();
      if ((heading as RegExpExecArray)[1] !== undefined) {
        out[(name as RegExpExecArray)[1]] = Number((heading as RegExpExecArray)[1]);
      }
    }
    // `wreck` is the one exemption, so five of the six carry a number. A
    // parse that silently found none would otherwise make every assertion
    // below vacuous.
    expect(Object.keys(out).sort()).toEqual(['down', 'fire', 'idle', 'move', 'moveFire']);
    return out;
  }

  it.each(['idle', 'fire', 'down'])(
    'the KDF rifleman faces what he is shooting in %s (was -156/-163/sweeping)',
    (clip) => {
      const figs = measureFacing(`${MESHES}meshy_soldier.glb`, clip);
      expect(figs.length).toBe(3);
      for (const f of figs) expect(Math.abs(f.meanDeg)).toBeLessThan(headingCeilings()[clip]);
    }
  );

  it('reads the same rifleman walking CORRECTLY, so the reading is of the clip', () => {
    const figs = measureFacing(`${MESHES}meshy_soldier.glb`, 'move');
    // The count assertion is not decoration: `for (const f of [])` passes in
    // 0 ms, which is exactly how this instrument stayed blind to all four
    // civilian rigs through two tasks and a review.
    expect(figs.length).toBe(3);
    for (const f of figs) expect(Math.abs(f.meanDeg)).toBeLessThan(headingCeilings().move);
  });

  it('binds moveFire, and reads it as bladed rather than broken', () => {
    // `Run_and_Shoot_withSkin.glb` was on disk and bound to nothing. It is a
    // genuine walk-and-shoot mocap: the body blades to the target and the
    // eyes square to the sights, so the head sits left of the line of
    // travel -- and the WEAPON sits on the axis of travel, measured at +0.31
    // deg by the Python gate, which is why that clip is the control the
    // weapon check is calibrated against. The sibling Sarim rig's own
    // `moveFire` measures +42 and the design doc records it as "bladed but
    // not broken"; this one is milder, hence its own wider ceiling.
    const figs = measureFacing(`${MESHES}meshy_soldier.glb`, 'moveFire');
    expect(figs.length).toBe(3);
    for (const f of figs) expect(Math.abs(f.meanDeg)).toBeLessThan(headingCeilings().moveFire);
  });

  it('leaves wreck facing backward, which is a corpse and not a defect', () => {
    // Deliberately NOT in the band. `wreck` is the last frame of
    // `Shot_and_Blown_Back` -- a body thrown round by the round that killed
    // it lies where the blast put it. The design doc records the -166 so the
    // next reader does not "fix" it, and `CLIP_SEMANTICS['wreck']['heading']`
    // is `None` in the import script for the same reason. Pinned here so a
    // future facing sweep that quietly squares every clip shows up as a red
    // test rather than as a corpse politely facing the enemy.
    const figs = measureFacing(`${MESHES}meshy_soldier.glb`, 'wreck');
    expect(figs.length).toBe(3);
    for (const f of figs) expect(Math.abs(f.meanDeg)).toBeGreaterThan(120);
  });

  // Task 3. `HEAD_JOINT_RE` was `/_(head|Head)$/`, which needs a FIGURE PREFIX
  // to match -- `f0_Head` on a three-man team file. A single-figure GLB names
  // the bone plainly `Head`, so all four civilians matched nothing,
  // `measureFacing` returned `[]`, and every caller in this tree spells its
  // check as a `for` loop over the result. The whole family read as "measured,
  // and fine". This is the guard on that: assert the COUNT, not just the
  // angles, because an empty result passes any angle assertion ever written.
  it.each(['civilian_woman', 'office_worker', 'farm_worker', 'civilian_child'])(
    'measures %s at all -- one figure, not silently zero',
    (figure) => {
      const figs = measureFacing(`${MESHES}civilians/${figure}.glb`, 'move');
      expect(figs.length).toBe(1);
      expect(figs[0].joint).toBe('Head');
    }
  );

  it.each(['office_worker', 'farm_worker', 'civilian_child'])(
    '%s runs facing forward',
    (figure) => {
      // Measured after Task 3 bound `Running` to `move`: office_worker +14.1,
      // farm_worker +2.3, civilian_child +0.4. The band is 30 rather than the
      // 20 used for the soldiers because this instrument is noisier on these
      // rigs -- see the `civilian_woman` exclusion below for how much.
      const figs = measureFacing(`${MESHES}civilians/${figure}.glb`, 'move');
      for (const f of figs) expect(Math.abs(f.meanDeg)).toBeLessThan(30);
    }
  );

  it('reads civilian_woman through a 16 mm lever, so her angle is NOT asserted', () => {
    // A NAMED exclusion with its measurement, not an oversight. `measureFacing`
    // takes its bearing from the head joint to the centroid of that joint's own
    // `face` vertices, so the lever arm it measures over is a property of the
    // asset. In bind pose, ground-plane: sarim_rifles 0.0813 m, office_worker
    // 0.0692, farm_worker 0.0639, meshy_soldier 0.0582, civilian_child 0.0505
    // -- and civilian_woman **0.0160**, three to five times shorter, because
    // her head-weighted `face` vertices sit almost symmetrically around the
    // joint. The bearing is then made mostly of skinning wobble: she reads a
    // spread of 78.7 deg on a STANDING `idle` and +26.0 mean on `move`, where
    // the rig's own `Head`->`headfront` marker (the build-time instrument in
    // `import_meshy_civilians.py`) reads that same idle at -3.86 with a spread
    // of 5.83 and that same move at -0.08.
    //
    // So this pins the DEFECT, not the facing: if a later change shortens or
    // lengthens that lever the count and the clip still have to work, and
    // anyone tempted to add her to the band test above finds this first.
    // Task 7 must not gate civilian facing on `measureFacing` until the lever
    // is fixed -- taking the bearing from the rig's `headfront` marker, which
    // every one of these rigs carries, would fix it for all of them.
    const figs = measureFacing(`${MESHES}civilians/civilian_woman.glb`, 'move');
    expect(figs.length).toBe(1);
    expect(figs[0].maxDeg - figs[0].minDeg).toBeGreaterThan(30);
  });

  it('leaves the Sarim militia facing where it already faced', () => {
    // The design's section 2.1 measured this asset at +10..+11 across every
    // standing clip and called that the authored contrapposto rather than a
    // defect. Task 3 changed only which file feeds `move`, so these three must
    // not have moved at all: measured +11.1 / +10.9 / +9.7, identical before
    // and after to the tenth of a degree.
    for (const clip of ['idle', 'fire', 'down']) {
      const figs = measureFacing(`${MESHES}sarim_rifles.glb`, clip);
      expect(figs.length).toBe(3);
      for (const f of figs) expect(Math.abs(f.meanDeg)).toBeLessThan(15);
    }
  });

  it('reads the Sarim run as forward, at the looser bound its own face mesh needs', () => {
    // +14.8, up from the walk's +10.0 -- and the RIG's own marker says the run
    // is the SQUARER of the two (-0.10 against the walk's -2.72). Both are
    // right: this asset's `face` role is the small visible-skin sliver at the
    // keffiyeh's eye gap (221 of 16 557 vertices), so the centroid sits off the
    // skull's axis and the two instruments differ by 8-17 deg depending on how
    // the head is pitched. Recorded in `_face_bearing_deg` in the import
    // script, which is why THAT file's ceilings are not shared with this one.
    const figs = measureFacing(`${MESHES}sarim_rifles.glb`, 'move');
    expect(figs.length).toBe(3);
    for (const f of figs) expect(Math.abs(f.meanDeg)).toBeLessThan(20);
  });
});

// Task 3: the Sarim militia and the four civilians move at 2.4-2.7 m/s and
// used to play a stroll over it. `move` now binds each source's own `Running`.
// The floor is `WALK_FLOOR`, shared with the tests above rather than restated,
// and no CEILING is asserted: two of the civilians measure slightly over 1.0,
// which is a run (a sprinting foot swings further back than the body advances)
// and not an error, and the design's D4 rate-match is about to move all of
// these anyway.
describe('mesh unit gait -- the run clips', () => {
  const RAN: [string, string, number, number][] = [
    ['sarim_rifles', 'sarim_rifles.glb', 0.9, 0.332],
    ['civilians/civilian_woman', 'civilians/civilian_woman.glb', 0.8, 0.382],
    ['civilians/office_worker', 'civilians/office_worker.glb', 0.8, 0.445],
    ['civilians/farm_worker', 'civilians/farm_worker.glb', 0.8, 0.428],
    ['civilians/civilian_child', 'civilians/civilian_child.glb', 0.8, 0.295],
  ];

  it.each(RAN)('%s runs rather than strolls', (_label, file, speed, before) => {
    const m = measureRoleTravel(`${MESHES}${file}`, 'boot', 'move');
    const ground = groundPerCycleM(speed, m.clipSeconds);
    const ratio = m.maxTravelM / ground;
    expect(ratio).toBeGreaterThan(WALK_FLOOR);
    // And it really is an improvement on what shipped, not merely above a
    // floor a walk could also clear on a slower unit.
    expect(ratio).toBeGreaterThan(before);
  });
});

// Fix round 1: meanDeg was an arithmetic mean of degrees, which is wrong at
// exactly the place this instrument most needs to be right -- two bearings
// two degrees apart across the +/-180 wrap (e.g. +179, -179) arithmetic-
// average to 0, "facing forward", for what is actually a figure facing
// backward. A pure unit test of the averaging, no GLB involved: construct
// bearings straddling the wrap point directly.
describe('circularMeanDeg', () => {
  it('averages bearings across the +/-180 wrap instead of collapsing to 0', () => {
    // An arithmetic mean of [179, -179] is 0. The circular mean is +/-180 --
    // the two samples are 2 degrees apart on the circle, not 358.
    const { meanDeg, minDeg, maxDeg } = circularMeanDeg([179, -179]);
    expect(Math.abs(meanDeg)).toBeCloseTo(180, 5);
    expect(maxDeg - minDeg).toBeCloseTo(2, 5);
  });

  it('agrees with the arithmetic mean when nothing wraps', () => {
    // Nowhere near the discontinuity: circular and arithmetic must agree,
    // which is what the Step 5 report re-verified for every shipped file.
    const { meanDeg, minDeg, maxDeg } = circularMeanDeg([-5, -4, -6]);
    expect(meanDeg).toBeCloseTo(-5, 1);
    expect(minDeg).toBeCloseTo(-6, 1);
    expect(maxDeg).toBeCloseTo(-4, 1);
  });
});

// Task 4 -- `tools/units/rig.py`'s hand-authored gait, sized per team from
// that team's own `mobility.speed_tiles_s`.
//
// Before this pass one gait served all fourteen kit teams, so `sniper_team` at
// 0.45 tiles/s and `charge_squad` at 1.90 played the same 16-frame stride and
// the ratios ran 0.32 to 0.89. `before` below is the shipped value, measured on
// the bytes at `9c3e9ed`, and every row must beat it -- a floor alone would
// pass a slow unit that never changed.
//
// `charge_squad` is the row that must NOT be read as a failure. 1.9 tiles/s is
// 3.80 m of ground per 0.667 s cycle and no stride on a 1.67 m figure reaches
// it: the cap is what a fully split leg can do, and design D4's runtime
// rate-match is what closes the rest. Its own `before` is the assertion that
// matters there.
describe('mesh unit gait -- the kit teams take their stride from their speed', () => {
  const KIT: [string, number, number][] = [
    ['at_team', 0.7, 0.824],
    ['demo_squad', 0.85, 0.679],
    ['rpg_team', 0.9, 0.641],
    ['militia_cell', 0.95, 0.607],
    ['breach_team', 0.95, 0.607],
    ['charge_squad', 1.9, 0.321],
    // Superseded by a Meshy asset and still built by `rig.py` -- see
    // `RETIRED_MESH_FILES`. Measured for the same reason the retired files are
    // kept: so the swap back stays one line.
    ['inf_squad', 0.9, 0.644],
    ['mortar_team', 0.65, 0.887],
    ['yahalom_squad', 0.85, 0.679],
  ];

  it.each(KIT)('%s strides for its own speed', (team, speed, before) => {
    const m = measureRoleTravel(`${MESHES}${team}.glb`, 'boot', 'move');
    const ground = groundPerCycleM(speed, m.clipSeconds);
    expect(m.maxTravelM / ground).toBeGreaterThan(before);
  });

  // The four the pass must NOT have touched. Three carry `animates: False` on
  // every figure (`teams.py`: "crew-served weapons stay deployed through
  // move") and ship a degenerate 0.04 s `move` with no leg keys at all; the
  // fourth is a motorcycle whose riders' boots do not move. All four are built
  // by the same `build_clips` this pass rewired, so "unchanged" is a real
  // claim about the scaling being scoped to walkers and not a tautology.
  const STILL: [string, number][] = [
    ['atgm_cell', 0.0417],
    ['mortar_crew', 0.0417],
    ['digger_crew', 0.0417],
    ['moto_rpg', 0.6667],
  ];

  it.each(STILL)('%s is deliberately not a walker and did not move', (team, cycleS) => {
    const m = measureRoleTravel(`${MESHES}${team}.glb`, 'boot', 'move');
    expect(m.clipSeconds).toBeCloseTo(cycleS, 3);
    // A motorcycle's riders bob with the machine; the crew-served teams key
    // nothing at all. Both are far under any gait.
    expect(m.maxTravelM).toBeLessThan(0.1);
  });

  it('sizes every stride from data, so a team with no unit JSON cannot ship', () => {
    // `rig.py`'s `unit_speed_tiles_s` raises rather than defaulting, and the
    // reason is that a wrong stride looks like art. The Python guard cannot be
    // run from here, so this asserts the input it depends on: every team the
    // rig builds has exactly one unit JSON with a positive speed.
    const teams: [string, number][] = [...KIT.map(([t, s]) => [t, s] as [string, number]),
      ...STILL.map(([t]) => [t, 0] as [string, number])];
    for (const [team, speed] of teams) {
      const hits = ['kdf', 'enemy']
        .map((side) => `${REPO}data/units/${side}/${team}.json`)
        .filter((p) => existsSync(p));
      expect(hits, `${team}: unit JSON`).toHaveLength(1);
      const doc = JSON.parse(readFileSync(hits[0], 'utf8')) as {
        mobility?: { speed_tiles_s?: number };
      };
      expect(doc.mobility?.speed_tiles_s, `${team}: mobility.speed_tiles_s`).toBeGreaterThan(0);
      if (speed > 0) expect(doc.mobility?.speed_tiles_s).toBe(speed);
    }
  });
});

// The design (§2.1, §3.6) records `mortar_team`'s `move` as "+84 degrees,
// identically, on all three figures". Measured on the bytes it is +87.7 /
// -139.5 / -101.2, and NONE of the three is a reading of the marching crew:
// that file's `move` posture is a second, STANDING rig (`f<N>_st_*`) with no
// head bone at all, so `HEAD_JOINT_RE` matches only the kneeling heads, which
// `move` keys to scale 0. A confident number, off geometry the player cannot
// see. `hiddenInClip` exists so the next reader is told rather than having to
// know.
describe('measureFacing and the two-posture rigs', () => {
  it('says so when the joints it read are scaled out of the clip', () => {
    const figs = measureFacing(`${MESHES}meshy_mortar_team.glb`, 'move');
    expect(figs).toHaveLength(3);
    for (const f of figs) expect(f.hiddenInClip, f.joint).toBe(true);
  });

  it('reads the standing rig that IS on screen, and finds it marching forward', () => {
    // Task 4 turned the supplied standing tableau 180 degrees
    // (`import_meshy_mortar_team.py`'s `STAND_YAW_DEG`): it faces Blender +Y,
    // where every standing constant in that file assumed -Y. Before the fix
    // these read +25.4 / +7.2 / -15.9 -- and that was NOT evidence the crew
    // marched forward, because the `face` ROLE is defined as the -Y half of
    // each head and `FORWARD_FIX_DEG` maps -Y to +X, so the measurement and
    // the role assignment shared the same wrong assumption and agreed with
    // each other. The picture is what settled it; this pins the result.
    const figs = measureFacing(`${MESHES}meshy_mortar_team.glb`, 'move', /_st_chest$/);
    expect(figs).toHaveLength(3);
    for (const f of figs) {
      expect(f.hiddenInClip, f.joint).toBe(false);
      expect(Math.abs(f.meanDeg), f.joint).toBeLessThan(20);
    }
  });

  it('leaves the deployed crew splayed around their own tube, which is correct', () => {
    // `idle` is the KNEELING tableau and was measured when that source landed.
    // A crew spread around a mortar is not a facing defect, and this pass did
    // not touch it -- these three numbers are unchanged to the tenth of a
    // degree across the rebuild.
    const figs = measureFacing(`${MESHES}meshy_mortar_team.glb`, 'idle');
    expect(figs.map((f) => Math.round(f.meanDeg * 10) / 10)).toEqual([-7.5, 83.9, -67.3]);
    for (const f of figs) expect(f.hiddenInClip, f.joint).toBe(false);
  });

  it('reads a single-posture rig as visible, so the flag is not always true', () => {
    const figs = measureFacing(`${MESHES}meshy_soldier.glb`, 'move');
    expect(figs).toHaveLength(3);
    for (const f of figs) expect(f.hiddenInClip, f.joint).toBe(false);
  });
});

// `measureRoleFootprint` -- where a gait's travel goes, and whether it leaves
// the ground. Both were needed to derive `rig.py`'s `THIGH_CAP`: peak-to-peak
// travel alone cannot tell a long step from a high heel kick, and a longer
// swing lifts a straight-legged figure off the floor.
describe('measureRoleFootprint', () => {
  it('splits a kit gait into its step and its lift', () => {
    const f = measureRoleFootprint(`${MESHES}militia_cell.glb`, 'boot', 'move');
    const [x, y, z] = f.axisTravelM;
    // Forward is +X in the mesh contract, and a gait is overwhelmingly along
    // it: the lift is under half the step and the lateral component is noise.
    expect(x).toBeGreaterThan(1.0);
    expect(y).toBeLessThan(x * 0.5);
    expect(z).toBeLessThan(x * 0.2);
  });

  it('keeps a boot on the ground -- the bound rig.py sizes its stride against', () => {
    // `floatM` is the highest the lowest moving boot vertex ever gets. The
    // stride grew ~35% in this pass and this did NOT, because `_stance_drop`
    // sinks the root by exactly the reach a swung leg loses. Shipped before:
    // 0.0922 m on a one-walker team.
    for (const team of ['militia_cell', 'charge_squad', 'demo_squad', 'at_team']) {
      const f = measureRoleFootprint(`${MESHES}${team}.glb`, 'boot', 'move');
      expect(f.floatM, `${team} float`).toBeLessThan(0.0922);
      expect(f.activeVertexCount, `${team} active`).toBeGreaterThan(100);
    }
  });

  it('ignores the collapsed prone geometry every kit rig hides inside boot', () => {
    // Without `ACTIVE_TRAVEL_FRACTION` this reads the `death_root` corpse's
    // boots, which sit at a literal z=0 on every rig.py build and at -0.3875
    // on the Meshy mortar team -- so `floatM` was 0.0000 for nine teams and
    // measured nothing. The filter is what makes the number mean anything.
    const withFilter = measureRoleFootprint(`${MESHES}at_team.glb`, 'boot', 'move');
    expect(withFilter.floatM).toBeGreaterThan(0.01);
    expect(withFilter.activeVertexCount).toBeLessThan(
      measureRoleTravel(`${MESHES}at_team.glb`, 'boot', 'move').vertexCount
    );
    expect(ACTIVE_TRAVEL_FRACTION).toBeGreaterThan(0);
  });
});
