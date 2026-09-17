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
//
// **Everything above "Task 7 -- the SWEEP" measures a file somebody named, and
// that is the whole reason fourteen sliding rigs shipped green.** GH-145 was
// raised against `mortar_team`, so this gate measured `mortar_team`. The
// sections below that line iterate `RIGGED_UNIT_MESHES` and name nothing but
// an exemption; the named tests above them are kept because each is a control,
// a characterisation, or a pin on a number the design argues from, and a sweep
// cannot say which file it was built to catch.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_TRAVEL_FRACTION,
  circularMeanDeg,
  countTracePeaks,
  groundPerCycleM,
  measureFacing,
  measureMarkerFacing,
  measureRoleFootprint,
  measureRoleTravel,
  measureRoleTravelByFigure,
  measureWeaponAxis,
  MESH_UNITS_PER_TILE,
  readGlb,
  swingLiftFraction,
} from './mesh_gait';
import { MIN_GAIT_TRAVEL_M } from './meshes/gait-pass';
import { RIGGED_UNIT_MESHES } from '../../packages/app/src/mesh-catalogue';
// Task 7, and the brief spells this out: `@lions/tools` deliberately does not
// depend on `@lions/render`, but `mesh-anim.ts` imports only a TYPE from
// `../../sheet` and pulls in no three.js, so a relative import is safe here --
// and it is the whole point. The alternative is a second copy of the
// rate-match formula living in the gate, which is exactly the duplication
// that makes a gate blind to the clamp it is supposed to be watching. This
// file already reaches across a package boundary for `mesh-catalogue.ts`.
import {
  clipGroundSpeedTiles,
  GAIT_TIME_SCALE_MAX,
  GAIT_TIME_SCALE_MIN,
  gaitTimeScale,
  parseGaitExtras,
  type GaitMetrics,
  type LocomotionClip,
} from '../../packages/render/src/three/units/mesh-anim';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const MESHES = `${REPO}art/meshes/`;

// M-7: the comment above justifies reaching into `mesh-anim.ts` by relative
// path on the claim that the module "pulls in no three.js". Pinned on the
// file's own bytes rather than trusted, so the day someone adds a
// `from 'three'` import there, this is what says so before this node-only
// tools gate starts loading three.js by accident.
describe('the reach into mesh-anim.ts stays safe for node', () => {
  it('mesh-anim.ts has no `from \'three\'` import', () => {
    const src = readFileSync(`${REPO}packages/render/src/three/units/mesh-anim.ts`, 'utf8');
    expect(src).not.toMatch(/from ['"]three['"]/);
  });
});

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

  // Fix round 1. Binding `move` to `Running` above left `sarim_rifles`'s
  // `moveFire` bound to `Walk_Forward_While_Shooting`, which was consistent
  // while `move` was a walk and stopped being so the moment it was not. That
  // clip is ONE gait cycle of a 0.2 m/s creeping advance -- 0.6614 m of stride
  // over 3.25 s -- on a unit the sim moves at 2.7 m/s, so the D4 rate-match
  // would have had to play it at 13.27x and finish it in 245 ms. Nothing in
  // the tree could see that: `move` was fine, the facing gates were fine, and
  // `moveFire` has no `WALK_FLOOR` test of its own because its ratio is
  // measured against a different clip length.
  //
  // This is the guard, and it is expressed as the MULTIPLIER rather than as a
  // ratio because that is the quantity that actually breaks: a clip whose
  // implied ground speed is far from the unit's own cannot be rate-matched
  // without either a flicker or a clamp wide enough to disable rate-matching
  // for everything else. 2.6 is the worst multiplier anything else in the tree
  // needs; measured here, `meshy_soldier` 1.125 and `sarim_rifles` 1.244.
  const MAX_RATE_MATCH = 2.6;

  it.each([
    ['inf_squad', 'meshy_soldier.glb', 0.9],
    ['sarim_rifles', 'sarim_rifles.glb', 0.9],
  ])('%s fires on the move at a speed its own legs could reach', (_label, file, speed) => {
    const m = measureRoleTravel(`${MESHES}${file}`, 'boot', 'moveFire');
    const implied = m.maxTravelM / m.clipSeconds;
    const wanted = speed * MESH_UNITS_PER_TILE;
    expect(wanted / implied).toBeLessThan(MAX_RATE_MATCH);
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

// gait-pass's Fix round 1: `cycleS` names a cycle and measures a clip, and
// peak-to-peak travel cannot tell one gait cycle baked into a clip from two.
// `countTracePeaks` is the periodicity instrument gait-pass.ts warns from.
// Calibrated here against every clip the pass currently declares a gait
// for -- the seventeen declarations across fifteen files, read off the
// FORWARD axis of `bestVertexTrace`.
describe('countTracePeaks', () => {
  const SEVENTEEN: readonly [string, string][] = [
    ['demo_squad.glb', 'move'],
    ['at_team.glb', 'move'],
    ['sniper_team.glb', 'move'],
    ['militia_cell.glb', 'move'],
    ['rpg_team.glb', 'move'],
    ['charge_squad.glb', 'move'],
    ['meshy_soldier.glb', 'move'],
    ['meshy_soldier.glb', 'moveFire'],
    ['sarim_rifles.glb', 'move'],
    ['sarim_rifles.glb', 'moveFire'],
    ['meshy_mortar_team.glb', 'move'],
    ['yahalom_engineer.glb', 'move'],
    ['breach_team.glb', 'move'],
    ['civilians/civilian_woman.glb', 'move'],
    ['civilians/office_worker.glb', 'move'],
    ['civilians/farm_worker.glb', 'move'],
    ['civilians/civilian_child.glb', 'move'],
  ];

  it.each(SEVENTEEN)('%s %s reads as exactly one cycle on the forward axis', (file, clip) => {
    const fp = measureRoleFootprint(`${MESHES}${file}`, 'boot', clip);
    expect(countTracePeaks(fp.bestVertexTrace.forwardM)).toBe(1);
  });

  // The positive control: proves this counts periods rather than returning 1
  // by construction. A real one-cycle trace, mechanically concatenated with
  // itself, must read as two full cycles, and three copies as three.
  it('reads a synthetically doubled/tripled trace as 2/3 cycles', () => {
    const fp = measureRoleFootprint(`${MESHES}demo_squad.glb`, 'boot', 'move');
    const once = fp.bestVertexTrace.forwardM;
    expect(countTracePeaks(once)).toBe(1);
    expect(countTracePeaks([...once, ...once])).toBe(2);
    expect(countTracePeaks([...once, ...once, ...once])).toBe(3);
  });

  // Why the forward axis and not height, pinned rather than merely claimed
  // in the doc comment: the height trace double-counts a genuine single
  // cycle on two of the seventeen from a secondary bounce the forward sweep
  // does not have.
  it.each(['at_team.glb', 'meshy_mortar_team.glb'])(
    '%s: the height axis over-counts a real single cycle -- this is why forward is used',
    (file) => {
      const fp = measureRoleFootprint(`${MESHES}${file}`, 'boot', 'move');
      expect(countTracePeaks(fp.bestVertexTrace.forwardM)).toBe(1);
      expect(countTracePeaks(fp.bestVertexTrace.heightM)).toBe(2);
    }
  );

  it('returns 0 for a flat (no-travel) trace rather than dividing by a zero span', () => {
    expect(countTracePeaks([0.5, 0.5, 0.5, 0.5])).toBe(0);
    expect(countTracePeaks([])).toBe(0);
  });
});

// ===========================================================================
// Task 7 -- the SWEEP.
//
// Everything above this line measures a file somebody named. That is how
// fourteen sliding rigs shipped green: GH-145 was raised against
// `mortar_team`, so the gate measured `mortar_team`. Below this line nothing
// is named except an exemption, and every exemption carries the measurement
// that earned it.
//
// Four rules this section is built on, each of which was paid for on this
// branch:
//
//  1. **An empty result is a silent pass.** Every sweep asserts its own
//     population size before it iterates. `for (const f of [])` passes any
//     assertion ever written, in 0 ms.
//  1a. **What each sweep is per.** Facing and the weapon axis are per FIGURE,
//     because their instruments read a named joint per figure. Gait's
//     headline numbers -- `rl_gait`, the multiplier, the cadence -- are per
//     FILE, because `rl_gait` is one declaration per file and that is what
//     the renderer rate-matches against. A per-file gait number alone is
//     blind to one figure of a team going still, which is GH-145's own
//     defect: measured, stripping one of `militia_cell`'s two riflemen of
//     its leg channels leaves the pooled stride IDENTICAL at 1.4673.
//     `measureRoleTravelByFigure` is what closes that, and it is a separate
//     sweep below rather than a change to the declared numbers.
//  2. **Route a computed quantity through the production code that computes
//     it.** The playback multiplier goes through `gaitTimeScale`; the
//     declaration goes through `parseGaitExtras`. A gate with its own copy of
//     the formula cannot see a clamp, and a clamp that quietly starts binding
//     on a shipped mesh is exactly the regression that would put the slide
//     back with every test still green.
//  3. **Bands come from a fresh measurement of the shipped bytes**, recorded
//     beside the constant with the date, and are placed in the GAP between
//     what the art achieves and what the defect reads -- never fitted to the
//     worst file.
//  4. **An instrument states when it cannot read a file** rather than
//     returning a confident number off geometry the player never sees.
//     `hiddenInClip` and `FigureFacing.leverM` are both that.
// ===========================================================================

/** One rigged GLB, with everything the sweeps need read off disk once. */
interface RiggedFile {
  readonly typeId: string;
  /** Path relative to `art/meshes/`, exactly as the catalogue spells it. */
  readonly file: string;
  readonly path: string;
  /** The unit type's own `mobility.speed_tiles_s`. */
  readonly speedTilesPerSecond: number;
  readonly clips: readonly string[];
  /** The file's own `rl_gait`, read through the RENDERER's parser -- so a
   *  declaration the renderer would drop reads as absent here too. */
  readonly declared: ReadonlyMap<LocomotionClip, GaitMetrics> | undefined;
}

/**
 * Types whose `move` is deliberately not a gait, with the reason beside each.
 *
 * One table, exported, printed on the passing path -- rather than a `continue`
 * scattered through six assertions, which is how an exemption outlives the
 * reason for it. Membership is ASSERTED against the shipped bytes below
 * (`the gait exemptions are exactly the files that declare no gait`), so a
 * type added here without the art to justify it fails, and so does a rig that
 * silently stops declaring a gait.
 */
export const GAIT_EXEMPT: Readonly<Record<string, string>> = {
  atgm_cell:
    'crew-served: teams.py gives every figure `animates: False` ("crew-served weapons stay ' +
    'deployed through move") and the rig ships a degenerate 0.0417 s `move` with no leg keys',
  mortar_crew: 'crew-served, as atgm_cell',
  digger_crew: 'crew-served, as atgm_cell',
  moto_rpg: 'a motorcycle -- its wheels turn, its riders’ boots do not',
};

/** Clips that are corpses. A body thrown round by the round that killed it
 *  lies where the blast put it; `meshy_soldier`’s −166° is recorded in the
 *  design as deliberate and pinned above. */
const CORPSE_CLIPS: ReadonlySet<string> = new Set(['wreck', 'wreckAlt']);

/**
 * Every rigged mesh the app loads, with its own speed and its own
 * declaration. The catalogue is plain data with no `import.meta.url` in it
 * precisely so a node-side reader can ask it directly.
 *
 * The two count assertions are the guard rule 1 above is about: if
 * `RIGGED_UNIT_MESHES` were ever emptied, renamed or narrowed, every sweep
 * below would iterate nothing and pass.
 */
function riggedFiles(): RiggedFile[] {
  const out: RiggedFile[] = [];
  for (const [typeId, entry] of Object.entries(RIGGED_UNIT_MESHES)) {
    const hits = ['kdf/', 'enemy/', '']
      .map((dir) => `${REPO}data/units/${dir}${typeId}.json`)
      .filter((p) => existsSync(p));
    expect(hits, `${typeId}: exactly one unit JSON`).toHaveLength(1);
    const doc = JSON.parse(readFileSync(hits[0], 'utf8')) as {
      mobility?: { speed_tiles_s?: number };
    };
    // Type FIRST. `expect(undefined).toBeGreaterThan(0)` throws out of
    // vitest's own matcher before the label is attached, so a unit JSON with
    // the key deleted used to fail naming a line number and not the unit.
    const declaredSpeed = doc.mobility?.speed_tiles_s;
    expect(typeof declaredSpeed, `${typeId}: ${hits[0]} has no numeric mobility.speed_tiles_s`).toBe(
      'number'
    );
    const speed = typeof declaredSpeed === 'number' ? declaredSpeed : NaN;
    expect(speed, `${typeId}: mobility.speed_tiles_s`).toBeGreaterThan(0);
    for (const file of entry.files) {
      const path = `${MESHES}${file}`;
      const glb = readGlb(path);
      const scene = glb.json.scenes?.[glb.json.scene ?? 0];
      out.push({
        typeId,
        file,
        path,
        speedTilesPerSecond: speed,
        clips: (glb.json.animations ?? []).map((a) => a.name ?? ''),
        declared: parseGaitExtras(scene?.extras?.rl_gait, file),
      });
    }
  }
  // 16 unit types, 19 files -- `civilians` is four variants of one type.
  // Numbers, not `> 0`: a catalogue that lost half its entries would still
  // clear a positive count.
  expect(Object.keys(RIGGED_UNIT_MESHES)).toHaveLength(16);
  expect(out).toHaveLength(19);
  return out;
}

const RIGS = riggedFiles();

// ---------------------------------------------------------------------------
// Step 1 -- the playback multiplier, across every rigged type.
// ---------------------------------------------------------------------------

/**
 * How hard the rate-match has to work, per locomotion clip: the unit's own
 * `speed_tiles_s` divided by the ground speed the clip's own legs describe.
 *
 * **Computed THROUGH `gaitTimeScale`, never beside it**, at `cadence = 1`
 * (`cadenceScale` is 1 for anything but a routed unit, and rout is a sim
 * state rather than an art property). The brief for this task originally
 * asked for the residual AFTER the rate match, and that is a gate that
 * cannot fail: the residual is `entitySpeed / clipGroundSpeed / timeScale`,
 * which is 1.0 by construction for any stride whatsoever, including none.
 * This quantity is the one nothing downstream normalises.
 */
function multiplierFor(gait: GaitMetrics, speedTilesPerSecond: number): number {
  // No `expect(gait).toBeDefined()` here, and its absence is deliberate:
  // every caller takes `gait` from the same map's own `entries()`, so it is
  // defined by construction and the guard could never fire. That is the exact
  // class of assertion section 4.3 of this task's report says it removed, and
  // it survived one round.
  return gaitTimeScale(gait, speedTilesPerSecond, 1);
}

/** Every `(type, file, clip, gait)` a locomotion clip is declared for -- one
 *  narrowed list, so no sweep below needs a `toBeDefined()` to type itself. */
function declaredLocomotion(): (readonly [string, string, LocomotionClip, RiggedFile, GaitMetrics])[] {
  return RIGS.filter((r) => !(r.typeId in GAIT_EXEMPT)).flatMap((r) =>
    [...(r.declared?.entries() ?? [])].map(
      ([clip, gait]) => [r.typeId, r.file, clip, r, gait] as const
    )
  );
}

/**
 * Nothing shipped may need more than this. Measured 2026-09-16 off
 * `art/meshes/**`'s own `rl_gait`: the worst is `yahalom_squad` at 2.6454,
 * then `charge_squad` 2.4842. (`sniper_team` was the third at 2.0999 and is
 * not any more -- see `GAIT_MULTIPLIER_OUTLIERS`.) The defect class this
 * refuses is the pre-Task-4 tree, where the legs described a third of the
 * ground (design §2.2's ratio table bottoms out at 0.295, a multiplier of
 * 3.39 on the same metric, and `sarim_rifles`'s `moveFire` was 13.3).
 *
 * So 2.8 sits in the gap between 2.6454 and 3.39 -- it is not fitted to the
 * worst file, and it is not derived from `GAIT_TIME_SCALE_MAX` either, which
 * would make the whole check circular.
 */
const GAIT_MULTIPLIER_CEILING = 2.8;

/**
 * And this is the band the roster actually lives in once the two named
 * outliers are set aside: the worst of the other fifteen declarations is
 * `civilian_child` at 1.6123 and the lowest outlier is `charge_squad` at
 * 2.4842, so 1.7 sits in a 0.87-wide gap with nothing in it. (It used to be
 * a 0.49-wide gap, bounded below by `sniper_team`'s 2.0999, which this pass
 * took to 0.9144 and out of the table.)
 *
 * Without this, `GAIT_MULTIPLIER_CEILING` alone would let `mortar_team`
 * regress from 1.02 to 2.7 unseen -- a ceiling set by the worst file is a
 * gate for the worst file.
 */
const GAIT_MULTIPLIER_TYPICAL = 1.7;

/**
 * A multiplier under 1 means legs that cover MORE ground than the unit does,
 * which the renderer takes up by playing the clip SLOWER than authored.
 *
 * **One file is under 1.0 and it is not a defect**: `sniper_team` at
 * **0.9144**. `rig.py` sizes a stride through `BASE_BOOT_TRAVEL_M = 1.154 m`,
 * a measurement of the KIT rig's own boot travel at scale 1.0, and these
 * sculpted legs deliver about 9% more at the same joint angles because the
 * foot mass sits further forward of the ankle. The resulting slowdown is an
 * improvement rather than something to correct: effective cycle 0.729 s,
 * **2.74 steps/s**, **0.492 m** step at 1.35 m/s, where re-calibrating the
 * constant per rig to force a nominal 1.000 would give 3.0 steps/s and a
 * 0.450 m step -- further from a human walk, not closer. The next lowest is
 * `mortar_team` at 1.0187, and 0.9144 is pinned both ways by
 * `GAIT_MULTIPLIER_UNDER_ONE`.
 *
 * **Why the floor is NOT what stands between this rig and a human walk, which
 * is worth setting out because it looks as though it is.** A human at
 * 1.35 m/s takes about 1.9 steps/s with a 0.71 m step, which needs a
 * multiplier of 0.633 -- under this floor. But cadence and step length are
 * locked inverses at a unit's own ground speed (`cadence * step =
 * mult * strideM / cycleS = speed * MESH_UNITS_PER_TILE`, by construction of
 * the rate match), so 1.9 steps/s is reachable ONLY with a 0.71 m step, which
 * means an authored `strideM` of 1.42 m -- and at that stride the multiplier
 * comes back to **1.0**, comfortably above this floor. Lowering the floor
 * buys nothing; it would only permit an UNDER-strided clip to be slowed
 * further, which is the defect the floor exists for.
 *
 * What actually pins cadence is `rig.MOVE_FRAMES`: a fixed 16-frame cycle at
 * 24 fps means **every** kit team lands at `3.0 * mult` steps/s, so a team
 * whose feet keep up (mult 1) takes 3.0 steps/s whatever its speed --
 * `militia_cell` 3.88, `demo_squad` 3.48, `at_team` 3.22, `mortar_team` 3.06.
 * `yahalom_engineer`'s 1.0417 s cycle reads `1.92 * mult` and lands at 5.08
 * on a far larger multiplier, which is the same fact from the other side. The
 * lever is a PER-TEAM cycle length in `rig.py` -- the identical follow-up
 * `CADENCE_STEPS_PER_S_CEILING` already recommends for `charge_squad` at the
 * fast end. That is a design call, not a gate parameter.
 *
 * 0.8 sits between 0.9144 and the 0.579 a shortened-cycle re-export reads
 * (the F4 falsification), and nowhere near `GAIT_TIME_SCALE_MIN`.
 *
 * **Which "moonwalk" this refuses, since there are two and it only sees
 * one.** This one is a figure whose legs OVERRUN the ground -- correct
 * direction, wrong rate, feet scrubbing forward under a body that is not
 * keeping up. It is not the other moonwalk, a clip exported BACKWARDS, which
 * every number in this band is blind to by construction: `hi - lo` per axis
 * is invariant under time reversal. `SWING_LIFT_FLOOR` is the check for that
 * one.
 */
const GAIT_MULTIPLIER_FLOOR = 0.8;

/**
 * The two rigs outside `GAIT_MULTIPLIER_TYPICAL`, each pinned to its own
 * measured value so it can improve but not drift. `toBeLessThan(recorded +
 * slack)` rather than an equality: a re-export that fixes one of these must
 * not have to come back here to be allowed to pass.
 *
 * `yahalom_squad` 2.6454 -- a Meshy biped Task 4's stride work never touched
 *   (that pass rewrote `rig.py`, and this file is not built by it).
 * `charge_squad` 2.4842 -- the geometric ceiling. 1.9 tiles/s is 3.80 m of
 *   ground per 0.6667 s cycle and a 1.67 m figure cannot stride it: pushing
 *   `rig.py`'s thigh cap to 1.00 reaches only 0.465 of it and buys a visible
 *   crouch. A documented limit, not a threshold to widen for -- and see
 *   `CADENCE_STEPS_PER_S_CEILING`, which is where its real cost shows.
 *
 * **`sniper_team` WAS the third at 2.0999 and has been demoted**, which is
 * what the `toBeGreaterThan(GAIT_MULTIPLIER_TYPICAL)` assertion below exists
 * to force: `tools/export_meshy_sniper.py` was a third exporter carrying its
 * own `MOVE_FRAMES = 24` (a 1.0 s cycle against `rig.py`'s 16 frames at
 * 0.6667 s) and a hardcoded `swing = 0.40 * sin(a)` that never read
 * `speed_tiles_s`. It now drives `rig.gait_pose` off `rig.gait_for_team`, and
 * reads **0.9144** -- inside the typical band, on the other side of 1.0. Its
 * `SWING_LIFT_OUTLIERS` entry survives and its diagnosis there is different;
 * a stale entry here would have been exactly the exemption the demotion
 * assertions were added to catch.
 */
const GAIT_MULTIPLIER_OUTLIERS: Readonly<Record<string, number>> = {
  yahalom_squad: 2.6454,
  charge_squad: 2.4842,
};

/**
 * The one rig BELOW 1.0, pinned on BOTH sides.
 *
 * `GAIT_MULTIPLIER_OUTLIERS` is a one-sided mechanism ("named, and must stay
 * above TYPICAL"), which is right for a file whose multiplier is too large
 * and wrong for one whose multiplier is small. `sniper_team` at 0.9144 is the
 * only file on that side of the pack and `> 0.8` / `< 1.7` would let a
 * re-export drift it to 0.82 or 1.6 with nothing going red -- exactly the
 * hole the outlier table exists to close, left open by removing its old
 * entry without adding this one.
 *
 * 0.9144, measured 2026-09-16 after the figure was re-anchored to the
 * roster's own 1.670 m. It reads under 1.0 because `rig.py` sizes a stride
 * through `BASE_BOOT_TRAVEL_M`, a measurement of the KIT rig, and these
 * sculpted legs deliver slightly more travel at the same joint angles. See
 * `GAIT_MULTIPLIER_FLOOR`.
 */
const GAIT_MULTIPLIER_UNDER_ONE: Readonly<Record<string, number>> = { sniper_team: 0.9144 };

/** Slack on an outlier's own recorded number -- enough that float noise and a
 *  cosmetic re-export do not red the gate, far too little to hide a drift. */
const OUTLIER_SLACK = 0.05;

/**
 * Steps per second the legs are asked to take once the rate match is applied:
 * `2 * timeScale / cycleS`, two footfalls per gait cycle.
 *
 * **This is the quantity the eye reads, and it is NOT the multiplier.**
 * `yahalom_squad` has the largest multiplier in the tree (2.6454) and a
 * perfectly human 5.08 steps/s, because its authored cycle is 1.0417 s;
 * `charge_squad`'s smaller 2.4842 lands at **7.45**, because its cycle is
 * 0.6667 s. A multiplier band alone cannot tell those apart. Equivalently
 * this is a STEP LENGTH check -- after the rate match a figure covers exactly
 * `strideM` per cycle by construction, so cadence and step length are the
 * same fact stated twice.
 *
 * Measured 2026-09-16, steps/s: `civilian_child` 5.09, `yahalom_squad` 5.08,
 * `inf_squad` 4.93, `sarim_rifles` 4.76, `civilian_woman` 4.15,
 * `militia_cell`/`breach_team` 3.88, `farm_worker` 3.75, `rpg_team` 3.68,
 * `office_worker` 3.53, `demo_squad` 3.48, `at_team` 3.22, `mortar_team`
 * 3.06, **`sniper_team` 2.74** -- and `charge_squad` **7.45**, alone above
 * 5.1. A sprinting human tops out near 5 steps/s, so everything but that last
 * row is physically reachable.
 *
 * `sniper_team` is now the SLOWEST cadence in the tree and it was 4.20 before
 * this pass, on the slowest unit in the game -- the clearest single number
 * for what reconciling its exporter with `rig.py` bought. There is no floor
 * on this quantity and it does not need one: a cadence too low for a unit's
 * speed is a stride too long for it, which `GAIT_MULTIPLIER_FLOOR` already
 * bounds from the other side.
 */
const CADENCE_STEPS_PER_S_CEILING = 6.0;

/** `charge_squad`'s own measured cadence, named rather than admitted by a
 *  wider ceiling -- see `GAIT_MULTIPLIER_OUTLIERS` for why its stride cannot
 *  grow. */
const CADENCE_OUTLIERS: Readonly<Record<string, number>> = { charge_squad: 7.46 };

describe('mesh unit gait -- the sweep over every rigged type', () => {
  const gaited = RIGS.filter((r) => !(r.typeId in GAIT_EXEMPT));

  it('every rigged type is either gaited or exempt with a stated reason', () => {
    // The exemption table, proved against the bytes rather than trusted.
    // Both directions: a type listed here must really declare no gait, and a
    // type that declares none must really be listed.
    const declaring = RIGS.filter((r) => r.declared !== undefined).map((r) => r.typeId);
    const silent = RIGS.filter((r) => r.declared === undefined).map((r) => r.typeId);
    expect([...new Set(silent)].sort()).toEqual(Object.keys(GAIT_EXEMPT).sort());
    expect(new Set(declaring).size).toBe(12);
    for (const [type, why] of Object.entries(GAIT_EXEMPT)) {
      expect(why.length, `${type}: a reason, not a name`).toBeGreaterThan(20);
    }
    // Printed on the PASSING path, the way `validate:meshes` prints its
    // `NOT palette-checked` line.
    console.log(
      `mesh gait: ${gaited.length} of ${RIGS.length} rigged GLBs gated; exempt --\n` +
        Object.entries(GAIT_EXEMPT)
          .map(([t, why]) => `  ${t}: ${why}`)
          .join('\n')
    );
  });

  it('every gaited file declares a `move` gait, so none can be skipped by absence', () => {
    expect(gaited).toHaveLength(15);
    for (const rig of gaited) {
      expect(rig.declared?.has('move'), `${rig.file}: rl_gait.move`).toBe(true);
    }
  });

  it.each(declaredLocomotion())(
    '%s %s %s needs a playback multiplier inside the measured band',
    (typeId, file, clip, rig, gait) => {
      const mult = multiplierFor(gait, rig.speedTilesPerSecond);
      expect(mult, `${file} ${clip}`).toBeGreaterThan(GAIT_MULTIPLIER_FLOOR);
      expect(mult, `${file} ${clip}`).toBeLessThan(GAIT_MULTIPLIER_CEILING);
      const under = GAIT_MULTIPLIER_UNDER_ONE[typeId];
      if (under !== undefined) {
        // TWO-SIDED, unlike the high outliers: this file is the only one on
        // its side of the pack, so `> FLOOR` and `< TYPICAL` leave it free to
        // drift anywhere in 0.8..1.7 with nothing red. The band is what the
        // outlier table is for and it was missing here.
        expect(mult, `${file} ${clip} under-one pin (low)`).toBeGreaterThan(under - OUTLIER_SLACK);
        expect(mult, `${file} ${clip} under-one pin (high)`).toBeLessThan(under + OUTLIER_SLACK);
        // And DEMOTION, the same shape as the high outliers': the recommended
        // follow-up is a longer authored cycle for this team, after which it
        // comes back over 1.0 and this entry must go rather than sit here
        // pinning a number that no longer describes anything.
        expect(
          mult,
          `${file} ${clip}: no longer under 1.0 -- delete the GAIT_MULTIPLIER_UNDER_ONE entry`
        ).toBeLessThan(1.0);
      }
      const outlier = GAIT_MULTIPLIER_OUTLIERS[typeId];
      if (outlier === undefined) {
        expect(mult, `${file} ${clip} is not a named outlier`).toBeLessThan(GAIT_MULTIPLIER_TYPICAL);
      } else {
        expect(mult, `${file} ${clip} outlier`).toBeLessThan(outlier + OUTLIER_SLACK);
        // And DEMOTION. Without this an outlier that gets fixed stays exempt
        // for ever: the recommended follow-up for `charge_squad` is a longer
        // authored cycle, and once that lands this file would sit quietly
        // inside the general band with its own exemption still standing and
        // a later regression back to 2.48 invisible. `GAIT_EXEMPT` is
        // asserted in both directions; so is this now.
        expect(
          mult,
          `${file} ${clip}: named outlier no longer needs its exemption -- delete the entry`
        ).toBeGreaterThan(GAIT_MULTIPLIER_TYPICAL);
      }
    }
  );

  it('exactly the rigs named in GAIT_MULTIPLIER_UNDER_ONE read a multiplier below 1.0', () => {
    // M-2: `GAIT_MULTIPLIER_UNDER_ONE` had a demotion (line ~1012, above) but
    // no MEMBERSHIP half -- every other table here is asserted in both
    // directions. Without this, deleting the `sniper_team` entry left every
    // assertion above green (0.9144 clears `> FLOOR` and `< TYPICAL`), and a
    // second rig drifting under 1.0 would sit ungated and unnamed.
    const underOne = [
      ...new Set(
        declaredLocomotion()
          .filter(([, , , rig, gait]) => multiplierFor(gait, rig.speedTilesPerSecond) < 1.0)
          .map(([typeId]) => typeId)
      ),
    ];
    expect(underOne.sort()).toEqual(Object.keys(GAIT_MULTIPLIER_UNDER_ONE).sort());
  });

  it.each(declaredLocomotion())(
    '%s %s %s asks for a cadence a body could take',
    (typeId, file, clip, rig, gait) => {
      const steps = (2 * multiplierFor(gait, rig.speedTilesPerSecond)) / gait.cycleS;
      const outlier = CADENCE_OUTLIERS[typeId];
      expect(steps, `${file} ${clip}: steps/s`).toBeLessThan(
        outlier ?? CADENCE_STEPS_PER_S_CEILING
      );
      if (outlier !== undefined) {
        expect(
          steps,
          `${file} ${clip}: named cadence outlier no longer needs its exemption -- delete the entry`
        ).toBeGreaterThan(CADENCE_STEPS_PER_S_CEILING);
      }
    }
  );

  /**
   * The factor the clamp probe below doubles-and-checks at.
   *
   * **Measured, not chosen as a round number.** The true minimum headroom in
   * the tree is `GAIT_TIME_SCALE_MAX / 2.6454 = 1.512` on `yahalom_squad`, so
   * 1.4 sits just inside it. A probe at 2x was written first and is FALSE:
   * `yahalom_squad` at twice its own speed computes 5.291 and clamps, and
   * `charge_squad` 4.968. (The example this comment carried was
   * `sniper_team` at 4.1998, which was 2 x its own then-2.0999 multiplier;
   * that file reads 0.9144 now and no longer clamps at 2x. The conclusion is
   * unchanged and its evidence had to be.) A carried unit is excluded from
   * the rate match entirely (`applyGaitRate`), so twice a unit's own speed is
   * a probe and not a scenario.
   *
   * **This check cannot be fired by any change to the ART, only by lowering
   * a production constant, and that is exactly its purpose.** For a data
   * change the ceiling always fires first: the probe needs `mult > 4/1.4 =
   * 2.857` and the ceiling fires at 2.8. Its genuinely independent window is
   * over `GAIT_TIME_SCALE_MAX` itself -- for any value in **(2.8, 3.70)**
   * this fires while the coupling assertion above does not, since the
   * coupling fires at 2.8 and the worst shipped multiplier reaches the clamp
   * at `1.4 x 2.6454 = 3.70`.
   */
  const CLAMP_HEADROOM_PROBE = 1.4;

  it('this gate’s own band sits strictly inside the runtime clamp', () => {
    // A coupling, stated where both numbers are visible. If
    // `GAIT_TIME_SCALE_MAX` were ever lowered below `GAIT_MULTIPLIER_CEILING`
    // the band above would stop being able to see anything in between: every
    // such value arrives here already clamped to the constant and therefore
    // already inside the band. The probe below would still catch it -- this
    // fails earlier and says why.
    expect(GAIT_MULTIPLIER_CEILING).toBeLessThan(GAIT_TIME_SCALE_MAX);
    expect(GAIT_MULTIPLIER_FLOOR).toBeGreaterThan(GAIT_TIME_SCALE_MIN);
  });

  it('the rate-match clamp is a backstop, not a participant, on every shipped rig', () => {
    // The point of routing through `gaitTimeScale` rather than recomputing
    // the ratio. A ceiling alone cannot see a clamp: if `GAIT_TIME_SCALE_MAX`
    // were lowered to 2.5, `yahalom_squad` would clamp to 2.5 and sail
    // through a band of 2.8 while the renderer quietly put its slide back.
    //
    // `gaitTimeScale` is linear in `entitySpeedTiles` between its two clamps,
    // so scaling the input scales the output -- and does NOT, the moment
    // either end binds. Asserting that identity is a clamp probe that
    // restates none of the formula, and it fails for a value that is clamped
    // at the shipped speed OR within `CLAMP_HEADROOM_PROBE` of it.
    let checked = 0;
    for (const rig of RIGS) {
      for (const [clip, gait] of rig.declared?.entries() ?? []) {
        const one = gaitTimeScale(gait, rig.speedTilesPerSecond, 1);
        const probed = gaitTimeScale(
          gait,
          rig.speedTilesPerSecond * CLAMP_HEADROOM_PROBE,
          1
        );
        expect(probed, `${rig.file} ${clip}: clamp binds within ${CLAMP_HEADROOM_PROBE}x`).toBeCloseTo(
          one * CLAMP_HEADROOM_PROBE,
          6
        );
        // There is deliberately NO `expect(one).toBeLessThan(
        // GAIT_TIME_SCALE_MAX)` here, and its absence is the point. It
        // cannot fail: if `one` were clamped at either bound the identity
        // above would already have failed, because a clamped value does not
        // move when its input does. Two assertions where one can only fire
        // after the other is one assertion and a decoration, and this branch
        // has shipped seven of those.
        checked++;
      }
    }
    // Twelve types over fifteen files, two of which declare `moveFire` too.
    expect(checked).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// Step 1b -- PER FIGURE, because a team file pools two or three into one
// `boot` mesh and the declared stride is the pooled maximum.
// ---------------------------------------------------------------------------

/**
 * How far behind its file's best-travelling figure any other figure may be.
 *
 * `rl_gait`'s `strideM` is `axisTravelM[0]` -- the single worst vertex of the
 * POOLED `boot` role -- so a file where one of two riflemen stops moving his
 * legs declares exactly the same stride as one where nobody does. Measured:
 * stripping `mil1`'s hip, thigh, shin and pelvis channels out of
 * `militia_cell.glb`'s `move` leaves `axisTravelM[0]` identical at **1.4673**
 * and the whole gate green. That is GH-145's own defect, scoped to one figure
 * of a team, and thirteen of the fifteen gaited files carry more than one
 * figure.
 *
 * Measured 2026-09-16 across every file whose figures all walk, the worst
 * figure's forward travel as a fraction of the best figure's is **0.889**
 * (`sniper_team`, whose two sculpted men are genuinely different sizes --
 * 1.478 and 1.416 source units -- and whose phase offsets moved from half a
 * cycle to `rig.gait_phase`'s third when its gait was reconciled; it read
 * 0.957 before that) and every other file is 0.987-1.000. A figure that has
 * stopped reads 0.0; one animating at half amplitude reads about 0.5. 0.75
 * sits between those with margin on both sides.
 */
const FIGURE_STRIDE_RATIO_FLOOR = 0.75;

/**
 * Figures that are deliberately motionless inside a team that DOES walk,
 * with the authority for each.
 *
 * These are `rig.py`'s `animates=False` figures, and `build_move_clip`'s own
 * docstring is explicit that this means the whole figure: *"a crew-served
 * figure gets NO keys here at all and so stays at `move`'s own frame-0
 * identity pose for the whole clip -- correctly: 'crew-served weapons stay
 * deployed through move' means the whole figure stays put, not just its
 * weapon."*
 *
 * Three whole TEAMS carry that flag on every figure and are in `GAIT_EXEMPT`
 * instead. These three are the mixed case -- one still figure beside one
 * walker -- and it is worth being clear-eyed about what it looks like: on
 * these files one man is carried across the ground with his boots frozen
 * while the man beside him walks. That is the GH-145 complaint applied to
 * half a team, and it is AUTHORED (`rig.py` lines 847/851/855). Recorded
 * here, not fixed here; a gate does not change art.
 *
 * Asserted in BOTH directions below, like `GAIT_EXEMPT`: each of these must
 * really measure still, so a figure that starts walking reds this line.
 */
export const STILL_FIGURES: Readonly<Record<string, string>> = {
  'demo_squad.glb move demo_a_root':
    'rig.py: _f("demo_a", posture="kneeling", animates=False) -- the charge layer, deployed',
  'at_team.glb move at_fire_root':
    'rig.py: _f("at_fire", posture="kneeling", animates=False) -- the launcher gunner, deployed',
  'rpg_team.glb move rpg_fire_root':
    'rig.py: _f("rpg_fire", animates=False) -- the only STANDING animates=False figure in ' +
    'the tree, and teams.py pins its stride to 0.0 even in `move`',
};

/** A figure in `STILL_FIGURES` must measure this still, in metres of forward
 *  travel. The three read a literal 0.0000; a walker reads 0.66-1.55. */
const STILL_FIGURE_TRAVEL_M = 0.01;

/**
 * The number of `boot` vertices that actually take part in the gait, per
 * file. Pinned because it is the number that WOULD have caught the defect
 * above and did not have to: `measureRoleFootprint` already returns it, and
 * the `militia_cell` mutation halves it 1152 -> 576.
 *
 * It is not redundant with `FIGURE_STRIDE_RATIO_FLOOR` -- that one pins
 * MOTION, this one pins the boot mesh's own weighting and topology, and a
 * re-export can move either without the other.
 */
const ACTIVE_BOOT_VERTICES: Readonly<Record<string, number>> = {
  'demo_squad.glb move': 576,
  'at_team.glb move': 576,
  'sniper_team.glb move': 176,
  'militia_cell.glb move': 1152,
  'rpg_team.glb move': 576,
  'charge_squad.glb move': 1152,
  'meshy_soldier.glb move': 989,
  'meshy_soldier.glb moveFire': 989,
  'sarim_rifles.glb move': 4101,
  'sarim_rifles.glb moveFire': 4101,
  'meshy_mortar_team.glb move': 3268,
  'yahalom_engineer.glb move': 1632,
  'breach_team.glb move': 1152,
  'civilians/civilian_woman.glb move': 328,
  'civilians/office_worker.glb move': 346,
  'civilians/farm_worker.glb move': 279,
  'civilians/civilian_child.glb move': 284,
};

/**
 * Minimum swing-lift chirality -- see `swingLiftFraction`, which is the only
 * quantity in this file that is not invariant under time reversal.
 *
 * Measured 2026-09-16: +0.113 (`meshy_mortar_team`) to +0.470
 * (`civilian_woman`) across sixteen of the seventeen locomotion clips, and
 * exactly negated when the trace is reversed. 0.05 sits between the smallest
 * shipped positive and zero, and a reversed clip lands at -0.113 or lower.
 */
const SWING_LIFT_FLOOR = 0.05;

/**
 * `sniper_team` is the one file whose boot is HIGHER while it travels
 * backward than while it travels forward: **-0.065**, where every other rig
 * in the tree -- both hand-authored families and every Meshy import -- is
 * positive.
 *
 * **It was -0.180 and its diagnosis has changed, which matters more than the
 * number.** The old entry blamed `tools/export_meshy_sniper.py`'s hardcoded
 * `swing = 0.40 * sin(a)`. That gait is gone -- the file drives
 * `rig.gait_pose` now, the same function every kit team's `move` is keyed
 * from, at the same amplitudes and the same phases -- and the reading is
 * still negative. So the swing was only 2.8x of it.
 *
 * **The leading hypothesis for the rest, stated as a hypothesis.**
 * `swingLiftFraction` plausibly carries a GEOMETRIC term as well as a
 * chirality one. The tracked vertex is the boot's furthest-travelling one --
 * a toe -- and it rotates about the KNEE, because neither rig family has a
 * foot bone and the boot is bound rigidly to the shin. That part is
 * confirmed: there is no foot bone in either rig. A toe `d` metres forward of
 * the bone's tail would then gain height on the FORWARD swing in proportion
 * to `d`, competing with the heel lift the knee bend gives at the BACK. A 2-D
 * model of both rigs' leg proportions over toe offset and stride scale:
 *
 *            toe 0.00   toe 0.10   toe 0.20   toe 0.25
 *   scale 0.78  +0.06      +0.03      -0.00      -0.01
 *   scale 1.00  +0.10      +0.07      +0.03      +0.01
 *   scale 1.29  +0.21      +0.14      +0.09      +0.07
 *
 * **What that model does and does not establish**, because it was written up
 * once as confirmation and is not:
 *
 *  - The sign and direction of both effects are right, and `sniper_team` is
 *    the only rig in the tree at a stride scale under 1.0 (0.78, from
 *    `speed_tiles_s` 0.45 -- the slowest unit in the game) with
 *    photogrammetry boots rather than `kit.py` blocks. Both push the same
 *    way.
 *  - But four of the seven shipped rigs sit AT `rig.THIGH_CAP`, so their
 *    scales carry no information about this at all, leaving one uncapped
 *    comparison point. The measured kit values line up with the model's
 *    `toe = 0.00` column, which is not what a `kit.py` block foot should
 *    read. And reaching -0.065 by extrapolation wants a toe lever near
 *    0.45 m, which is longer than these boots plausibly are.
 *  - Unexamined: this rig's own lateral pelvic roll (the one term
 *    deliberately NOT shared with `rig.py` -- see `export_meshy_sniper.py`)
 *    is a second-harmonic VERTICAL term of a size comparable to the boot's
 *    whole height span, and it has not been isolated.
 *
 * So: the reading is not a reversed clip, the mechanism is real, and the
 * quantitative account is incomplete. Treat the number as pinned, not as
 * explained.
 *
 * **Left as a named outlier rather than absorbed**, because a floor low
 * enough to admit -0.065 is uncomfortably close to nothing, and a genuinely
 * reversed clip reads the negation of a positive rig (-0.11 to -0.47). The
 * fix that would clear it is an ANKLE bone on this rig so the boot pivots at
 * the foot instead of the knee -- real new rig authoring on a supplied asset,
 * plus an ankle term `rig.gait_pose` does not have and no other rig could
 * consume. Recorded as the follow-up; at gameplay zoom the visible difference
 * is a boot's height profile over 0.67 s at 25 px.
 */
const SWING_LIFT_OUTLIERS: Readonly<Record<string, number>> = { 'sniper_team.glb move': -0.065 };

describe('mesh unit gait -- per figure, not per file', () => {
  const rows = declaredLocomotion().map(([, file, clip, rig]) => {
    const figures = measureRoleTravelByFigure(rig.path, 'boot', clip);
    return { file, clip, rig, figures, live: figures.filter((f) => !f.hiddenInClip) };
  });

  it('reads a known number of figures, and every still one is named', () => {
    expect(rows).toHaveLength(17);
    const live = rows.flatMap((r) => r.live.map((f) => `${r.file} ${r.clip} ${f.root}`));
    // 35 visible figures over 17 clips: two each on the six `kit.py` teams
    // and `yahalom_engineer`, three each on `meshy_soldier` (x2 clips),
    // `sarim_rifles` (x2) and `meshy_mortar_team`, and one per civilian.
    // The hidden `death_root` twins and `meshy_mortar_team`'s three kneeling
    // roots are not in it.
    expect(live).toHaveLength(35);
    // Both directions, the way GAIT_EXEMPT is: every named still figure must
    // be a figure that really exists and really is still, and every figure
    // that is still must be named.
    const measuredStill = rows.flatMap((r) =>
      r.live
        .filter((f) => f.forwardTravelM < STILL_FIGURE_TRAVEL_M)
        .map((f) => `${r.file} ${r.clip} ${f.root}`)
    );
    expect(measuredStill.sort()).toEqual(Object.keys(STILL_FIGURES).sort());
    console.log(
      `mesh gait per figure: ${live.length} visible figures across ${rows.length} clips.\n` +
        `deliberately still --\n` +
        Object.entries(STILL_FIGURES)
          .map(([k, why]) => `  ${k}: ${why}`)
          .join('\n')
    );
  });

  it.each(rows.map((r) => [`${r.file} ${r.clip}`, r] as const))(
    '%s: every walking figure covers the ground the declared stride claims',
    (label, row) => {
      expect(row.live.length, `${label}: visible figures`).toBeGreaterThan(0);
      const best = Math.max(...row.live.map((f) => f.forwardTravelM));
      expect(best, `${label}: best figure`).toBeGreaterThan(0.1);
      for (const f of row.live) {
        const key = `${row.file} ${row.clip} ${f.root}`;
        if (key in STILL_FIGURES) {
          expect(f.forwardTravelM, `${key}: named still, but it moved`).toBeLessThan(
            STILL_FIGURE_TRAVEL_M
          );
          continue;
        }
        expect(
          f.forwardTravelM / best,
          `${key}: ${f.forwardTravelM.toFixed(4)} m against the file's best ${best.toFixed(4)} m ` +
            `(joints ${f.joints.join(', ')})`
        ).toBeGreaterThan(FIGURE_STRIDE_RATIO_FLOOR);
      }
    }
  );

  it.each(rows.map((r) => [`${r.file} ${r.clip}`, r] as const))(
    '%s: the boot vertices taking part in the gait are the ones that always have',
    (label, row) => {
      const fp = measureRoleFootprint(row.rig.path, 'boot', row.clip);
      expect(fp.activeVertexCount, `${label}: active boot vertices`).toBe(
        ACTIVE_BOOT_VERTICES[label]
      );
    }
  );

  it.each(rows.map((r) => [`${r.file} ${r.clip}`, r] as const))(
    '%s: walks forwards, and would read as reversed if it did not',
    (label, row) => {
      // The ONE check here that a time-reversed export cannot pass. Every
      // other number in this file -- stride, cycle, multiplier, cadence,
      // peak count, every bearing -- is invariant under reversal.
      const fp = measureRoleFootprint(row.rig.path, 'boot', row.clip);
      const lift = swingLiftFraction(fp.bestVertexTrace.forwardM, fp.bestVertexTrace.heightM);
      const outlier = SWING_LIFT_OUTLIERS[label];
      if (outlier === undefined) {
        expect(lift, `${label}: swing lift`).toBeGreaterThan(SWING_LIFT_FLOOR);
      } else {
        // Named, pinned, and demoted the moment it is fixed. TWO-SIDED, the
        // same shape `GAIT_MULTIPLIER_UNDER_ONE`'s own below-the-pack pin
        // uses (`(low)`/`(high)`, 1006-1007 above): `< outlier + 0.05` alone
        // is a one-way gate that a MORE reversed reading also clears, and a
        // genuinely time-reversed export reads -0.11..-0.47 by this file's
        // own numbers -- well past this bound, and the one this file names as
        // the check "a time-reversed export cannot pass". Falsified
        // 2026-09-16 by negating the sniper trace's forward component; see
        // the commit message for the reading that produced.
        expect(lift, `${label}: named swing-lift outlier (low)`).toBeGreaterThan(outlier - 0.05);
        expect(lift, `${label}: named swing-lift outlier (high)`).toBeLessThan(outlier + 0.05);
        expect(
          lift,
          `${label}: no longer inverted -- delete the SWING_LIFT_OUTLIERS entry`
        ).toBeLessThan(SWING_LIFT_FLOOR);
      }
    }
  );
});

// ---------------------------------------------------------------------------
// Step 2 -- the declaration against the bytes it claims to describe.
// ---------------------------------------------------------------------------

describe('mesh unit gait -- declared rl_gait against a fresh measurement', () => {
  it.each(
    RIGS.filter((r) => r.declared !== undefined).flatMap((r) =>
      [...(r.declared?.entries() ?? [])].map(([clip, gait]) => [r.file, clip, gait, r] as const)
    )
  )('%s %s declares the stride its own bytes measure', (file, clip, gait, rig) => {
    // What this catches is a re-export that skipped `pnpm gait:meshes`: the
    // GLB's legs change, the declaration does not, and the renderer
    // rate-matches to a stale stride with nothing anywhere going red.
    //
    // Measured exactly the way `gait-pass.ts` measures it -- the FORWARD
    // component of the boot's peak-to-peak travel, not the 3-D hypotenuse,
    // which folds in lift and lateral swing and overstates the ground by
    // 1.47–17.70% depending on the rig.
    const fp = measureRoleFootprint(rig.path, 'boot', clip);
    expect(fp.axisTravelM[0], `${file} ${clip}: strideM`).toBeCloseTo(gait.strideM, 6);
    expect(fp.clipSeconds, `${file} ${clip}: cycleS`).toBeCloseTo(gait.cycleS, 6);
  });

  it('and a file that declares nothing really has no measurable gait', () => {
    // The other half. Without this the exemption list could hide a rig whose
    // `move` genuinely walks and whose declaration was simply never written.
    const exempt = RIGS.filter((r) => r.declared === undefined);
    expect(exempt).toHaveLength(4);
    for (const rig of exempt) {
      const fp = measureRoleFootprint(rig.path, 'boot', 'move');
      expect(fp.axisTravelM[0], `${rig.file}: forward stride`).toBeLessThan(MIN_GAIT_TRAVEL_M);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 3c -- a file's locomotion clips against EACH OTHER.
// ---------------------------------------------------------------------------

/**
 * `move` and `moveFire` are the same legs on the same unit, so the ground
 * speeds they describe may differ by style but not by order of magnitude.
 *
 * Every other check in this tree judges one clip against its unit's speed,
 * which is why `sarim_rifles` could ship a `move` that ran and a `moveFire`
 * that crept: 0.6056 tiles/s against 0.0678, a factor of **8.9**, invisible
 * to everything because each was individually inside its own band.
 *
 * Measured 2026-09-16 on the two files that carry both clips: `inf_squad`
 * 1.330 and `sarim_rifles` 1.000. 2.0 sits between that and the 8.9.
 */
const LOCOMOTION_SPEED_SPREAD_MAX = 2.0;

describe('mesh unit gait -- one file’s locomotion clips against each other', () => {
  // Narrowed by construction rather than by a pair of `toBeDefined()` guards
  // that could never fire on a list already filtered for both keys.
  const both = RIGS.flatMap((r) => {
    const move = r.declared?.get('move');
    const moveFire = r.declared?.get('moveFire');
    return move && moveFire ? [[r.file, move, moveFire] as const] : [];
  });

  it('two files carry both locomotion clips', () => {
    expect(both.map(([file]) => file)).toEqual(['meshy_soldier.glb', 'sarim_rifles.glb']);
  });

  it.each(both)('%s walks and walks-firing at speeds within a small factor', (file, move, moveFire) => {
    const a = clipGroundSpeedTiles(move);
    const b = clipGroundSpeedTiles(moveFire);
    expect(Math.max(a, b) / Math.min(a, b), `${file}: move vs moveFire`).toBeLessThan(
      LOCOMOTION_SPEED_SPREAD_MAX
    );
  });
});

// ---------------------------------------------------------------------------
// Step 3 -- facing, across every rigged type and every clip.
// ---------------------------------------------------------------------------

/**
 * Standing and walking clips: how far a figure's head may be off the
 * contract's `+X`.
 *
 * **Not the `+3..+11` contrapposto band the design §2.1 quotes** -- that
 * number was taken before Task 4 and setting a gate from it would red the
 * shipped tree. Re-measured 2026-09-16 on the bytes, the widest reading in
 * the gated set is `sarim_rifles`'s `move` at **+14.9** (its `idle`/`fire`
 * sit at +11), then `office_worker`'s `move` at +14.1 and the kit teams'
 * +8.6. 25 is 1.7x the worst of those and nowhere near the two defects this
 * exists to catch: the KDF rifleman's −156° fire and the mortar crew's 180°
 * backward march.
 */
const FACE_MEAN_DEG = 25;

/**
 * `moveFire` gets its own, wider bound because a walk-and-shoot is BLADED by
 * design -- the body angles to the target while the legs run up the axis of
 * travel. Measured: `inf_squad` +17.9, `sarim_rifles` +15.6; the design's
 * §4a records this asset's own `moveFire` at +42 historically and calls it
 * "bladed but not broken". 30 admits the blade and still refuses a reversal.
 */
const FACE_MEAN_MOVEFIRE_DEG = 30;

/**
 * `down` is the loosest, and the reason is measured rather than conceded. A
 * figure going to ground curls, and the ground-plane projection of a pitched
 * head swings hard: the four civilians read −30.5, −56.4, −59.3 and
 * −63.7, and their rigs' own `headfront` markers AGREE (−81.6 to −98.0),
 * so this is the pose and not the instrument. The soldiers land at −8.6 and
 * +9.7. The defect class here is a body going to ground facing BACKWARD --
 * −163° on the pre-fix `meshy_soldier` -- and 90 separates −63.7 from that
 * with 26° below it and 73° above.
 */
const FACE_MEAN_DOWN_DEG = 90;

/**
 * And the SPREAD, which is a separate defect and needs its own bound.
 * `meanDeg` is a circular mean, so a clip whose bearing sweeps most of a
 * circle averages to something numerically unstable and nearly meaningless --
 * `meshy_soldier`'s broken `idle` swept +23 to −159, a spread of ~182, and
 * its mean moved 7.8° purely from switching to the circular mean while every
 * non-sweeping clip moved under 0.002°. A mean-only gate can pass a figure
 * spinning on the spot. Widest shipped reading in the gated set:
 * `farm_worker`'s `idle` at 14.5, then `inf_squad`'s `move` at 10.0.
 */
const FACE_SPREAD_DEG = 25;

/**
 * Below this lever the bearing is noise and is not asserted -- see
 * `FigureFacing.leverM`.
 *
 * This excludes exactly one figure in the tree and it excludes her BY NUMBER:
 * `civilian_woman` reads 0.0089 m on `idle` and 0.0073 on `move`, where the
 * next shortest gated reading is `civilian_child`'s 0.0461 and the rest of
 * the roster sits at 0.05-0.58. At 16 mm in bind pose her face vertices sit
 * almost symmetrically around her own head joint, and she measures a **78.7°
 * spread on a STANDING idle** against the child's 10.8 on the same instrument
 * and the same kind of clip -- while her rig's own marker reads that idle at
 * −3.8 with a spread of 5.8.
 *
 * The alternative -- widening `FACE_SPREAD_DEG` to 80 so she fits -- would
 * take the band past every defect it exists to catch. The other alternative,
 * switching this whole gate to the `headfront` marker, silently drops all
 * fifteen `kit.py` files, which carry no such marker and whose head bone is a
 * VERTICAL segment with no ground bearing at all.
 *
 * 0.03 sits in the 0.0089-to-0.0461 gap: 3.4x above her worst and 1.5x below
 * everything else.
 */
const FACE_LEVER_FLOOR_M = 0.03;

/**
 * Files and clips where the head is not meant to be on the axis at all, with
 * the measurement behind each. Same rule as `GAIT_EXEMPT`: named, reasoned,
 * printed, and asserted against the bytes rather than trusted.
 */
export const FACING_EXEMPT: Readonly<Record<string, string>> = {
  'sniper_team.glb':
    'no `face` mesh and no head, neck or arm bone of any kind -- 14 joints, all root, ' +
    'pelvis and legs. There is no facing to read on this rig by any instrument.',
  'moto_rpg.glb':
    'a pillion rig: its `face` role binds entirely to `rid_seat`, `pas_seat` and two death ' +
    'roots, so it carries no head joint. Correct as built; `measureFacing` raises on it.',
  'yahalom_engineer.glb':
    'no `face` mesh -- gated through its `headfront` MARKER instead, below, so this is a ' +
    'change of instrument rather than a hole.',
  'meshy_mortar_team.glb idle':
    'the kneeling tableau: a crew spread around its own tube is not a facing defect ' +
    '(−7.5 / +83.9 / −67.3, pinned exactly above).',
  'meshy_mortar_team.glb fire':
    'the same deployed crew, serving the tube (−10.8 / +45.8 / −73.3).',
  'meshy_mortar_team.glb move':
    'every head joint in this clip is keyed to zero scale -- the standing posture is a ' +
    'SECOND rig with no head bone. Read through `/_st_chest$/` above; `hiddenInClip` ' +
    'catches it here.',
};

interface FacingRow {
  readonly file: string;
  readonly clip: string;
  readonly joint: string;
  readonly meanDeg: number;
  readonly spreadDeg: number;
  readonly leverM: number;
}

/**
 * Every figure of every non-corpse clip that is actually readable, plus the
 * three reasons a figure-clip is not. Built once.
 *
 * The three skip lists are kept APART rather than pooled, and that is not
 * tidiness. **`hiddenInClip` and the lever floor overlap completely on
 * today's art**: a joint keyed to zero scale skins its own vertices onto a
 * point, so its lever is a literal 0.0000 and the floor would catch every
 * hidden figure even if the flag did not exist -- measured, by deleting the
 * flag's own branch and re-running, which changed nothing at all. Two checks
 * that agree by arithmetic are one check, and the way to keep the second one
 * load-bearing is to PIN what it classifies rather than to trust that it
 * classifies anything. `hidden` and `shortLever` are therefore asserted
 * member by member below.
 */
function facingSweep(): {
  rows: FacingRow[];
  exempted: string[];
  hidden: string[];
  shortLever: string[];
} {
  const rows: FacingRow[] = [];
  const exempted: string[] = [];
  const hidden: string[] = [];
  const shortLever: string[] = [];
  for (const rig of RIGS) {
    for (const clip of rig.clips) {
      // Corpses go through `exempted` rather than a bare `continue`, so that
      // the one exemption class the passing path never printed now prints
      // like every other one. A reader of the log should not have to know
      // that `wreck` was skipped somewhere above the table.
      if (CORPSE_CLIPS.has(clip)) {
        exempted.push(`${rig.file} ${clip} (corpse)`);
        continue;
      }
      if (FACING_EXEMPT[rig.file] || FACING_EXEMPT[`${rig.file} ${clip}`]) {
        exempted.push(`${rig.file} ${clip}`);
        continue;
      }
      const figs = measureFacing(rig.path, clip);
      expect(figs.length, `${rig.file} ${clip}: figures`).toBeGreaterThan(0);
      for (const f of figs) {
        if (f.hiddenInClip) {
          hidden.push(`${rig.file} ${clip} ${f.joint}`);
          continue;
        }
        if (f.leverM < FACE_LEVER_FLOOR_M) {
          shortLever.push(`${rig.file} ${clip} ${f.joint} ${f.leverM.toFixed(4)}`);
          continue;
        }
        rows.push({
          file: rig.file,
          clip,
          joint: f.joint,
          meanDeg: f.meanDeg,
          spreadDeg: f.maxDeg - f.minDeg,
          leverM: f.leverM,
        });
      }
    }
  }
  return { rows, exempted, hidden, shortLever };
}

describe('mesh unit facing -- the sweep over every rigged type and clip', () => {
  const { rows, exempted, hidden, shortLever } = facingSweep();

  it('reads a known population, and says what it did not read', () => {
    // 89 readable figure-clips, counted 2026-09-16: six each from
    // `demo_squad`, `militia_cell`, `rpg_team`, `charge_squad`, `breach_team`
    // and now `at_team` (which gained a `fire` clip this pass -- it had four
    // rows and has six), four each from `atgm_cell` and `mortar_crew`, two
    // from `digger_crew`, fifteen each from `meshy_soldier` and
    // `sarim_rifles`, three from `meshy_mortar_team`'s `down`, and ten across
    // the civilians. A literal, because "more than zero" is what let
    // `measureFacing` return `[]` for all four civilians through two tasks
    // and a review while every caller's `for` loop passed in 0 ms.
    expect(rows).toHaveLength(89);
    // WHICH files, by name -- not `not.toContain('sniper_team.glb')`, which
    // could never fail: an un-exempted `sniper_team` makes `measureFacing`
    // THROW rather than produce a row, so the absence it asserts is
    // guaranteed by something other than the thing being tested.
    const files = new Set(rows.map((r) => r.file));
    expect([...files].sort()).toEqual([
      'at_team.glb',
      'atgm_cell.glb',
      'breach_team.glb',
      'charge_squad.glb',
      'civilians/civilian_child.glb',
      'civilians/civilian_woman.glb',
      'civilians/farm_worker.glb',
      'civilians/office_worker.glb',
      'demo_squad.glb',
      'digger_crew.glb',
      'meshy_mortar_team.glb',
      'meshy_soldier.glb',
      'militia_cell.glb',
      'mortar_crew.glb',
      'rpg_team.glb',
      'sarim_rifles.glb',
    ]);
    console.log(
      `mesh facing: ${rows.length} figure-clips gated across ${files.size} GLBs.\n` +
        `not read -- named exemption (${exempted.length}): ${exempted.join(', ')}\n` +
        `not read -- scaled out of the clip (${hidden.length}): ${hidden.join(', ')}\n` +
        `not read -- lever under ${FACE_LEVER_FLOOR_M} m (${shortLever.length}): ` +
        `${shortLever.join(', ')}\n` +
        `named exemptions --\n` +
        Object.entries(FACING_EXEMPT)
          .map(([k, why]) => `  ${k}: ${why}`)
          .join('\n')
    );
  });

  it('the figures scaled out of their clip are exactly the ones that should be', () => {
    // `hiddenInClip` is a CLASSIFICATION, and this is what keeps it
    // load-bearing -- see `facingSweep`'s own note on why deleting the flag
    // changes nothing on today's art. Every `rig.py` team hides its living
    // root during `down` (the prone `death_root` takes over), and
    // `meshy_mortar_team` hides its whole kneeling tableau during `move`.
    // A figure that STOPS being hidden, or starts, is a change to how a rig
    // switches posture and must be looked at rather than absorbed.
    expect(hidden.map((h) => h.replace(/ \w+$/, '')).sort()).toEqual([
      'at_team.glb down',
      'at_team.glb down',
      'atgm_cell.glb down',
      'atgm_cell.glb down',
      'breach_team.glb down',
      'breach_team.glb down',
      'charge_squad.glb down',
      'charge_squad.glb down',
      'demo_squad.glb down',
      'demo_squad.glb down',
      'digger_crew.glb down',
      'militia_cell.glb down',
      'militia_cell.glb down',
      'mortar_crew.glb down',
      'mortar_crew.glb down',
      'rpg_team.glb down',
      'rpg_team.glb down',
    ]);
  });

  it('the readings thrown away for a short lever are exactly civilian_woman’s two', () => {
    // The `civilian_woman` exclusion, asserted rather than commented. If any
    // other figure ever falls under the floor the gate says so by name; if
    // HER lever is ever fixed (the marker-bone route, or a `face` role that
    // is not symmetric about the joint) these two rows come back and this
    // line goes red, which is the reminder to gate her.
    expect(shortLever).toEqual([
      'civilians/civilian_woman.glb idle Head 0.0089',
      'civilians/civilian_woman.glb move Head 0.0073',
    ]);
  });

  it.each(rows.map((r) => [`${r.file} ${r.clip} ${r.joint}`, r] as const))(
    '%s faces the way it travels',
    (_label, row) => {
      const ceiling =
        row.clip === 'down'
          ? FACE_MEAN_DOWN_DEG
          : row.clip === 'moveFire'
            ? FACE_MEAN_MOVEFIRE_DEG
            : FACE_MEAN_DEG;
      expect(Math.abs(row.meanDeg), `${_label}: mean`).toBeLessThan(ceiling);
      expect(row.spreadDeg, `${_label}: spread`).toBeLessThan(FACE_SPREAD_DEG);
    }
  );

  it('gates yahalom_engineer through its marker, since it ships no face mesh', () => {
    // The one file `measureFacing` cannot read that another instrument can.
    // Without this, `yahalom_squad` -- a shipped KDF unit with four clips --
    // has no facing coverage of any kind.
    for (const clip of ['idle', 'move', 'down', 'work']) {
      const figs = measureMarkerFacing(`${MESHES}yahalom_engineer.glb`, clip);
      expect(figs, `yahalom ${clip}`).toHaveLength(2);
      for (const f of figs) {
        expect(f.hiddenInClip, `${clip} ${f.marker}`).toBe(false);
        expect(Math.abs(f.meanDeg), `${clip} ${f.marker}`).toBeLessThan(FACE_MEAN_DEG);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Step 3b -- the WEAPON axis, from geometry, and the two facing instruments
// against each other.
// ---------------------------------------------------------------------------

/**
 * Where each rig family's weapon geometry lives, and which joint carries it.
 *
 * Both halves have to be per-family and neither is a mistake in the art. On a
 * `kit.py` team the rifle is its own `weapon` role and the rig has no hand
 * bone at all, so the cloud hangs off `*_forearm_R`. On the Meshy bipeds the
 * rifle is MODELLED but has no `weapon` role -- `classify_vertex_roles` splits
 * by base-colour texture and the rifle is the same olive as the uniform -- so
 * the cloud is `uniform` vertices on `*_RightHand`.
 *
 * `figures` is asserted, not discovered: `at_team` has one armed figure and a
 * spotter, `demo_squad` one rifleman and one charge-carrier.
 */
const WEAPON_RIGS: readonly {
  readonly file: string;
  readonly role: string;
  readonly joint: RegExp;
  readonly figures: number;
  readonly clips: readonly string[];
}[] = [
  { file: 'demo_squad.glb', role: 'weapon', joint: /_forearm_R$/, figures: 1, clips: ['fire'] },
  { file: 'militia_cell.glb', role: 'weapon', joint: /_forearm_R$/, figures: 2, clips: ['fire'] },
  { file: 'rpg_team.glb', role: 'weapon', joint: /_forearm_R$/, figures: 2, clips: ['fire'] },
  { file: 'breach_team.glb', role: 'weapon', joint: /_forearm_R$/, figures: 2, clips: ['fire'] },
  // One armed figure: `at_fire` holds the Spike, `at_spot` holds binoculars
  // bound to his HEAD, so only one `_forearm_R` owns any `weapon` vertex.
  // This file was in `WEAPON_EXEMPT` until it gained a `fire` clip.
  { file: 'at_team.glb', role: 'weapon', joint: /_forearm_R$/, figures: 1, clips: ['fire'] },
  {
    file: 'meshy_soldier.glb',
    role: 'uniform',
    joint: /_RightHand$/,
    figures: 3,
    clips: ['fire', 'moveFire'],
  },
  {
    file: 'sarim_rifles.glb',
    role: 'uniform',
    joint: /_RightHand$/,
    figures: 3,
    clips: ['fire', 'moveFire'],
  },
];

/**
 * Rigs with no gateable weapon axis, each with the measurement that says so.
 *
 * **`at_team` used to be the interesting entry here and is now gated.** It
 * read: *"it HAS a weapon cloud and a good one (96 vertices, 1.357 m), but no
 * `fire` clip at all, so there is no clip on which an aim is claimed."* That
 * was true and it was a defect rather than a property -- the team stood
 * motionless while a Spike launched, because `rig.py`'s `build_fire_clip`
 * only recognised a rifle. It has a `fire` clip now and is in `WEAPON_RIGS`.
 */
export const WEAPON_EXEMPT: Readonly<Record<string, string>> = {
  'atgm_cell.glb': 'its launcher is `prop`, weighted to no arm bone; and no `fire` clip',
  'mortar_crew.glb': 'as atgm_cell -- the tube is `prop`',
  'charge_squad.glb': 'carries a `charge`, not a weapon; no `weapon` role on the rig at all',
  'digger_crew.glb': 'a digger: `wood`, no `weapon` role, no `fire` clip',
  'sniper_team.glb': 'no arm bones -- 14 joints, all root, pelvis and legs',
  'moto_rpg.glb': 'no arm bones; the launcher rides `m_launcher` off the machine',
  'meshy_mortar_team.glb': 'no arm bones on either posture -- root/abdomen/chest/head only',
  'yahalom_engineer.glb':
    'its `weapon` role puts EIGHT vertices spanning 0.076 m on `RightHand` -- a fitting, ' +
    'not a barrel, and far under WEAPON_MIN_EXTENT_M. Recorded as a gap, not gated.',
  'civilians/civilian_woman.glb': 'a civilian: `FORBIDDEN_ROLES` bans `weapon` outright',
  'civilians/office_worker.glb': 'a civilian',
  'civilians/farm_worker.glb': 'a civilian',
  'civilians/civilian_child.glb': 'a civilian',
};

/**
 * The "is this actually a weapon?" floors, and they are ASSERTED on the gated
 * set rather than used to filter it -- a cloud that silently stops being a
 * rifle must red the gate, not drop out of it.
 *
 * Measured 2026-09-16. Gated clouds: `kit.py` `weapon` roles 96-204 vertices
 * spanning 0.932-1.407 m; Meshy `uniform`-on-`RightHand` 1223-3248 vertices
 * spanning 0.625-0.913 m. Rejected by these floors: the same rigs' own
 * `uniform` forearms (54 vertices, 0.227 m) and `yahalom_engineer`'s 8-vertex
 * 0.076 m fitting. 0.5 m sits in the 0.227-to-0.625 gap.
 */
const WEAPON_MIN_VERTICES = 50;
const WEAPON_MIN_EXTENT_M = 0.5;

/**
 * How far a weapon's own long axis may sit off the contract's `+X` on a clip
 * that AIMS, and how much it may wander over that clip.
 *
 * **Measured from geometry, never from a bone.** Task 2 gated this with the
 * firing hand's own bone direction as a proxy for the barrel, which was the
 * best thing available then and is systematically off: measured against the
 * first principal component of the real rifle cloud, 4.1° on `idle`, 4.2° on
 * `moveFire` and **7.6° on `fire`** -- so the shipped barrel sits at +8.7
 * where the proxy reports +1.14. A proxy wrong by a rig-dependent amount
 * cannot be shared across rigs, and it cannot catch a weapon bound to the
 * WRONG BONE, because it never looks at the weapon.
 *
 * These bounds are LITERAL and deliberately not derived from
 * `import_meshy_soldier.py`'s `CLIP_SEMANTICS`, which the tests above do read
 * out of that file. Those ceilings are for the PROXY and are numerically
 * different quantities; sharing them would be wrong in both directions.
 *
 * Measured on `fire`: the four kit teams −0.0° (mean spread 0.0-0.1),
 * `inf_squad` +8.7 / 4.8, `sarim_rifles` +13.0 / 7.8. On `moveFire`:
 * `inf_squad` +4.5 / 1.7, `sarim_rifles` +1.1 / 0.2. 20/15 is real margin
 * over +13.0 and squarely inside the defect class Task 2 falsified against --
 * an aim removed reads −36.65 and a clip bound backwards reads +143.
 */
const WEAPON_MEAN_DEG = 20;
const WEAPON_SPREAD_DEG = 15;

/**
 * How far a firing clip may lever its weapon off the ELEVATION the same
 * file's `idle` holds it at, degrees, across every sampled instant.
 *
 * ## The eighth time a defect lived in the dimension no gate was looking at
 *
 * `WEAPON_MEAN_DEG`/`WEAPON_SPREAD_DEG` are the ground-plane BEARING, and a
 * ground-plane projection is blind to elevation by construction. Every
 * `kit.py` rifleman's `fire` clip levered its rifle out of `kit.py`'s own
 * level carry to a mean of **+17.0 deg** with a peak of **+25.6**, held
 * there by a static `FIRE_SHOULDER + FIRE_ELBOW` for the whole clip -- and
 * read a bearing of **-0.0 with a spread of 0.0**, passing all 291
 * assertions this file then had. It was found by rendering `idle` and `fire`
 * side by side and looking at them.
 *
 * ## Why a DELTA against `idle` and not an absolute band
 *
 * Because one shipped weapon is supposed to point up. `rpg_team`'s launcher
 * is built at a 38 deg pitch (`rig._rpg_extras`) and reads +34.0 in every
 * clip, so any absolute band admitting it would admit a rifle at +25.6 as
 * well. The delta expresses the real rule -- *a firing clip must not move
 * the weapon off the aim the rest pose establishes* -- with no exception for
 * the RPG at all, and it cancels whatever systematic offset a given cloud's
 * principal axis carries.
 *
 * Measured 2026-09-16 after this pass, worst excursion from the same
 * figure's own `idle` mean:
 *
 *   militia_cell / demo_squad / breach_team / rpg_team's loader   3.37
 *   at_team's Spike                                               6.47
 *   rpg_team's RPG (idle +34.04, fire +37.33 [+34.06, +40.53])    6.49
 *
 * and the defect it refuses reads **23.17** (`militia_cell` at `FIRE_ELBOW =
 * 0.35`). 12 sits between 6.49 and 23.17 -- 1.85x the worst shipped, 0.52x
 * the defect, and close to the geometric midpoint of the gap (12.3).
 *
 * The two launchers are the widest because a launcher's brace is authored as
 * an impulse on three joints that compound (`rig.LAUNCH_SPINE`'s comment),
 * where a rifle's recoil is authored to nearly cancel at the barrel.
 */
const WEAPON_ELEVATION_DRIFT_DEG = 12;

/**
 * Files whose weapon cloud's ELEVATION is not the weapon's, with the
 * measurement that says so. The bearing half stays gated on both.
 *
 * Both are the Meshy bipeds, where the "weapon cloud" is `uniform` vertices
 * on `*_RightHand` rather than a `weapon` ROLE -- `classify_vertex_roles`
 * splits by base-colour texture and the rifle is the same olive as the
 * sleeve, so the cloud is hand-plus-forearm-plus-rifle. Its principal axis
 * is close enough to the barrel IN THE GROUND PLANE to gate (Task 7
 * reproduced three independently measured bearing offsets to a tenth of a
 * degree) and is not close at all in elevation:
 *
 *   `sarim_rifles` reads **-50.29 deg on a standing `idle`** -- a rifle
 *   carried across the chest is not pointing 50 degrees at the floor, and
 *   that pose is shipped, photographed and accepted.
 *   `meshy_soldier` reads +14.47 on `idle` and +14.65 on `moveFire`, the
 *   supplier's own authored run-and-shoot -- a carry and an aimed clip
 *   cannot share a barrel elevation, but a sleeve can.
 *
 * Closing this needs a `weapon` role on those two assets, which means
 * re-classifying a supplied Meshy bake by something other than base colour.
 * Recorded as a gap, not gated on a proxy that would be measuring a forearm.
 */
/**
 * What each gated figure's weapon sits at in `idle`, in degrees of elevation,
 * pinned per figure.
 *
 * **`WEAPON_ELEVATION_DRIFT_DEG` is a DELTA and therefore cannot see a rest
 * pose that is itself off-level.** Falsified rather than reasoned: pre-rotate
 * `militia_cell`'s spine by the same 25 deg in BOTH `idle` and `fire` and the
 * drift reads 3.364 and passes, on a rig carrying its rifle 22.5 deg at the
 * ground in every clip it has. The delta is still the right PRIMARY check --
 * needing no exception for `rpg_team`'s deliberately 38-deg launcher is the
 * tell -- and it needs this second, absolute half beside it.
 *
 * Per FIGURE rather than per file, because `rpg_team` carries one of each and
 * a file-level number could only be a range wide enough to admit both.
 * Measured 2026-09-16 on the shipped bytes; the `[min, max]` beside each is
 * the same figure's own breathing sweep, which is what sets the tolerance.
 */
const WEAPON_IDLE_ELEVATION_DEG: Readonly<Record<string, number>> = {
  'demo_squad.glb demo_b_forearm_R': 2.47, //    [0.47, 4.46]  the level carry
  'militia_cell.glb mil0_forearm_R': 2.47, //    [0.46, 4.47]
  'militia_cell.glb mil1_forearm_R': 2.47, //    [0.47, 4.46]
  'breach_team.glb brc_cover_forearm_R': 2.47, // [0.47, 4.46]
  'breach_team.glb brc_point_forearm_R': 2.47, // [0.46, 4.47]
  'rpg_team.glb rpg_load_forearm_R': 2.47, //    [0.47, 4.46]  the loader's rifle
  'rpg_team.glb rpg_fire_forearm_R': 34.04, //  [32.05, 36.06] the RPG, at rig._rpg_extras' 38 deg
  'at_team.glb at_fire_forearm_R': 0.0, //      [-2.00, 2.00]  the Spike, at pitch 0
};

/**
 * Tolerance on the pin above. 3 degrees is wider than any figure's own idle
 * sweep (the widest is 4.01 peak-to-peak, so +/-2.0 about its mean) and far
 * narrower than the 22.5 deg the falsification injects. Not a band the art
 * may wander in: every entry is the number its own bytes read today, so any
 * movement at all is a re-export to look at.
 */
const WEAPON_IDLE_ELEVATION_TOL_DEG = 3;

export const WEAPON_ELEVATION_EXEMPT: Readonly<Record<string, string>> = {
  'meshy_soldier.glb':
    'the cloud is `uniform`-on-`RightHand`, not a `weapon` role: sleeve and hand dominate its ' +
    'principal axis in elevation (+14.47 on `idle`, +14.65 on the supplier`s own aimed `moveFire`)',
  'sarim_rifles.glb':
    'as meshy_soldier, and more starkly -- **-50.29 deg on a standing `idle`**, which is a ' +
    'forearm pointing down and not a rifle pointing down',
};

describe('mesh unit weapons -- the axis measured from the weapon, not from a bone', () => {
  it('every rigged GLB either has a gated weapon axis or a stated reason', () => {
    const gated = new Set(WEAPON_RIGS.map((w) => w.file));
    const files = RIGS.map((r) => r.file);
    for (const f of files) {
      expect(
        gated.has(f) || f in WEAPON_EXEMPT,
        `${f}: gated for a weapon axis, or exempt with a reason`
      ).toBe(true);
    }
    expect(gated.size + Object.keys(WEAPON_EXEMPT).length).toBe(files.length);
    console.log(
      `mesh weapon: ${gated.size} of ${files.length} rigged GLBs gated; exempt --\n` +
        Object.entries(WEAPON_EXEMPT)
          .map(([k, why]) => `  ${k}: ${why}`)
          .join('\n')
    );
  });

  it.each(WEAPON_RIGS.flatMap((w) => w.clips.map((clip) => [w.file, clip, w] as const)))(
    '%s %s points its weapon where the unit is facing',
    (file, clip, spec) => {
      const axes = measureWeaponAxis(`${MESHES}${file}`, spec.role, clip, spec.joint);
      expect(axes, `${file} ${clip}: figures`).toHaveLength(spec.figures);
      for (const a of axes) {
        expect(a.hiddenInClip, `${file} ${clip} ${a.joint}`).toBe(false);
        // Asserted, not used as a filter: a cloud that stops being a rifle
        // must go red rather than quietly leave the gated set.
        expect(a.vertexCount, `${file} ${clip} ${a.joint}: cloud size`).toBeGreaterThan(
          WEAPON_MIN_VERTICES
        );
        expect(a.extentM, `${file} ${clip} ${a.joint}: cloud length`).toBeGreaterThan(
          WEAPON_MIN_EXTENT_M
        );
        expect(Math.abs(a.meanDeg), `${file} ${clip} ${a.joint}: mean`).toBeLessThan(
          WEAPON_MEAN_DEG
        );
        expect(a.maxDeg - a.minDeg, `${file} ${clip} ${a.joint}: spread`).toBeLessThan(
          WEAPON_SPREAD_DEG
        );
      }
    }
  );

  it('gates the elevation of every weapon cloud that IS a weapon, and names the rest', () => {
    const gated = WEAPON_RIGS.filter((w) => !(w.file in WEAPON_ELEVATION_EXEMPT));
    // Both directions, as `GAIT_EXEMPT` is: every exempted file must really
    // be one this sweep would otherwise read, and the two sets must partition
    // `WEAPON_RIGS`. Without this an exemption for a file that left
    // `WEAPON_RIGS` would sit here forever, unread and unfalsifiable.
    for (const file of Object.keys(WEAPON_ELEVATION_EXEMPT)) {
      expect(
        WEAPON_RIGS.map((w) => w.file),
        `${file}: exempt from the elevation half, so it must be gated on the bearing half`
      ).toContain(file);
      // DEMOTION, the same guard `GAIT_EXEMPT` and `GAIT_MULTIPLIER_OUTLIERS`
      // carry -- and it is not a formality: this branch's own sniper
      // demotion went red from the parent commit's version of this idea
      // before anyone touched the table. The exemption's stated reason is
      // that these two assets have no `weapon` ROLE, so the cloud being
      // measured is a sleeve. The named follow-up is to give them one, after
      // which this entry would sit here for ever and two of the three
      // most-seen rigs in the game would stay ungated in the dimension the
      // whole instrument was built for. So: the reason must still be true.
      const spec = WEAPON_RIGS.find((w) => w.file === file);
      expect(
        spec?.role,
        `${file}: exempt because its cloud is not a \`weapon\` role -- it now IS one, so the ` +
          `reason has expired. Delete the WEAPON_ELEVATION_EXEMPT entry and pin its idle ` +
          `elevation instead of widening anything.`
      ).not.toBe('weapon');
      expect(
        WEAPON_ELEVATION_EXEMPT[file].length,
        `${file}: a reason, not a name`
      ).toBeGreaterThan(20);
    }
    expect(gated.map((w) => w.file).sort()).toEqual([
      'at_team.glb',
      'breach_team.glb',
      'demo_squad.glb',
      'militia_cell.glb',
      'rpg_team.glb',
    ]);
    console.log(
      `mesh weapon elevation: ${gated.length} of ${WEAPON_RIGS.length} weapon rigs gated ` +
        `at ${WEAPON_ELEVATION_DRIFT_DEG} deg of drift from their own idle; exempt --\n` +
        Object.entries(WEAPON_ELEVATION_EXEMPT)
          .map(([k, why]) => `  ${k}: ${why}`)
          .join('\n')
    );
  });

  it.each(
    WEAPON_RIGS.filter((w) => !(w.file in WEAPON_ELEVATION_EXEMPT)).flatMap((w) =>
      w.clips.map((clip) => [w.file, clip, w] as const)
    )
  )(
    '%s %s holds the elevation its own idle holds, rather than levering the weapon off it',
    (file, clip, spec) => {
      const firing = measureWeaponAxis(`${MESHES}${file}`, spec.role, clip, spec.joint);
      const carried = measureWeaponAxis(`${MESHES}${file}`, spec.role, 'idle', spec.joint);
      expect(firing, `${file} ${clip}: figures`).toHaveLength(spec.figures);
      expect(carried, `${file} idle: figures`).toHaveLength(spec.figures);
      // Paired by joint name for `measureFacing`'s own reason: the two calls
      // build their lists from the same skin, so they agree today, and a
      // mispairing would be invisible in the result on a file whose figures
      // read alike.
      const byJoint = new Map(carried.map((c) => [c.joint, c]));
      expect(byJoint.size, `${file}: idle joints are distinct`).toBe(carried.length);
      for (const a of firing) {
        const rest = byJoint.get(a.joint);
        expect(rest, `${file} ${clip} ${a.joint}: no idle reading`).toBeDefined();
        if (!rest) continue;
        // The ABSOLUTE half. Without it a rig whose carry is itself off-level
        // passes the delta trivially, in every clip it has -- falsified, see
        // `WEAPON_IDLE_ELEVATION_DEG`. Every gated figure must be pinned, so
        // a new one cannot join the sweep without a number.
        const pinned = WEAPON_IDLE_ELEVATION_DEG[`${file} ${a.joint}`];
        expect(
          pinned,
          `${file} ${a.joint}: no WEAPON_IDLE_ELEVATION_DEG entry -- the delta check ` +
            `alone cannot tell a level carry from a rest pose aimed at the sky`
        ).toBeDefined();
        expect(
          Math.abs(rest.elevationDeg - (pinned ?? NaN)),
          `${file} idle ${a.joint}: carry elevation ${rest.elevationDeg.toFixed(2)} against its ` +
            `own pinned ${pinned}`
        ).toBeLessThan(WEAPON_IDLE_ELEVATION_TOL_DEG);
        // The whole sampled RANGE against idle's mean, not mean against mean:
        // the defect was a static offset, but a recoil that peaked 20 deg up
        // and averaged back to level would be just as wrong on screen and a
        // mean-to-mean check would wave it through.
        const drift = Math.max(
          Math.abs(a.elevationMaxDeg - rest.elevationDeg),
          Math.abs(a.elevationMinDeg - rest.elevationDeg)
        );
        expect(
          drift,
          `${file} ${clip} ${a.joint}: elevation [${a.elevationMinDeg.toFixed(2)}, ` +
            `${a.elevationMaxDeg.toFixed(2)}] against idle's ${rest.elevationDeg.toFixed(2)}`
        ).toBeLessThan(WEAPON_ELEVATION_DRIFT_DEG);
      }
    }
  );

  it('does NOT gate `move`, because a one-handed run carry really does swing', () => {
    // Recorded so nobody tightens it later. On the Meshy rigs `Running`
    // carries the rifle one-handed at the side, so the barrel's bearing
    // sweeps: measured 101-109 deg of spread on `meshy_soldier` and 192 on
    // `sarim_rifles`. There is no single heading here for a ceiling to mean
    // anything against, and a tight bound would fail correct art.
    const axes = measureWeaponAxis(`${MESHES}meshy_soldier.glb`, 'uniform', 'move', /_RightHand$/);
    expect(axes).toHaveLength(3);
    for (const a of axes) expect(a.maxDeg - a.minDeg).toBeGreaterThan(60);
  });
});

/**
 * The offset between the two facing instruments, per file, measured on the
 * standing clips.
 *
 * **This is a pin on the offset, not a claim that it is zero**, and that is
 * the whole design. Task 2 built a pose that passed every build-time check
 * and was still wrong: an aim distributed through `Spine02` solved cleanly
 * and put the weapon on the axis, while the exported face read +15.2 against
 * the arms-only +0.3. A spine roll tilts the head rather than yawing it, and
 * the head-forward vector carries a vertical component (0.0859 forward,
 * 0.0311 up), so the roll swings the MESH bearing while the MARKER, which
 * lies along the head's own forward axis, barely moves. Nothing automated
 * caught it -- this file gated `fire`'s face at 20 and that build read 15.2.
 * What caught it was a by-hand comparison of two instruments that normally
 * agree to 1-3 degrees.
 *
 * Measured 2026-09-16, `face` minus `marker` on `idle` (and `fire` where the
 * file has one, which agrees to 0.2 deg everywhere it exists):
 *
 *   meshy_soldier  -0.66 / -0.48   civilian_child  -0.04
 *   farm_worker    +1.33           office_worker   +13.30
 *   sarim_rifles   +12.24 / +12.27
 *
 * Note the SIGN on `meshy_soldier`: this pinned -0.6 and not +0.6. The wrong
 * sign opened no hole -- a Task-2-style spine roll still reds -- but it cost
 * that file 1.26 deg of a 5 deg budget by centring its window at the wrong
 * place, and a pin whose own number is wrong is the one thing a pin must not
 * be.
 *
 * The two large ones are properties of the ASSET and both are recorded rather
 * than averaged away: `sarim_rifles`'s `face` role is the 221-of-16557-vertex
 * skin sliver visible at a keffiyeh's eye gap, so its centroid sits off the
 * skull's axis; `office_worker`'s is the same shape, milder. If either
 * changes by more than the tolerance below, something moved the head that did
 * not mean to.
 */
const FACE_MARKER_OFFSET_DEG: Readonly<Record<string, number>> = {
  'meshy_soldier.glb': -0.6,
  'sarim_rifles.glb': 12.3,
  'civilians/office_worker.glb': 13.3,
  'civilians/farm_worker.glb': 1.3,
  'civilians/civilian_child.glb': 0.0,
};

/** "Normally agree to 1-3 degrees", so 5 is the tolerance on a recorded
 *  offset -- tight enough that the 15-degree swing Task 2 shipped by hand
 *  would have gone red here, loose enough that no shipped file is near it. */
const FACE_MARKER_TOLERANCE_DEG = 5;

describe('mesh unit facing -- two instruments, gated against each other', () => {
  const pairs = RIGS.filter((r) => r.file in FACE_MARKER_OFFSET_DEG).flatMap((r) =>
    r.clips
      .filter((c) => c === 'idle' || c === 'fire')
      .map((clip) => [`${r.file} ${clip}`, r, clip] as const)
  )
    // Sorted so the pin below is on MEMBERSHIP -- which files carry both
    // instruments, on which standing clips -- rather than on the order a
    // GLB happens to list its animations in.
    .sort((a, b) => a[0].localeCompare(b[0]));

  it('covers every file that carries both instruments', () => {
    // `civilian_woman` is the sixth file with both and is deliberately absent
    // from the offset table: her 8.9 mm lever makes the MESH instrument noise
    // (a 78.7 deg spread on a standing idle), so an offset against it would
    // be pinning the noise. Everything else with a `headfront` marker AND a
    // `face` role is here.
    expect(pairs.map(([label]) => label)).toEqual([
      'civilians/civilian_child.glb idle',
      'civilians/farm_worker.glb idle',
      'civilians/office_worker.glb idle',
      'meshy_soldier.glb fire',
      'meshy_soldier.glb idle',
      'sarim_rifles.glb fire',
      'sarim_rifles.glb idle',
    ]);
  });

  it.each(pairs)('%s: the mesh and the rig still tell the same story', (label, rig, clip) => {
    const face = measureFacing(rig.path, clip);
    const marker = measureMarkerFacing(rig.path, clip);
    expect(face.length, `${label}: face figures`).toBe(marker.length);
    expect(face.length).toBeGreaterThan(0);

    // Paired by JOINT NAME, not by array index. The two instruments build
    // their lists differently -- `measureFacing` walks the skin's own joint
    // order, `measureMarkerFacing` walks node order -- and they agree today
    // only because those orders happen to coincide. Every figure on these
    // files reads within 0.1 deg of every other, so a mispairing would be
    // undetectable by its result, which is precisely why it has to be
    // excluded by construction in a check whose entire value is a 5 deg
    // tolerance. `MarkerFacing.joint` is the marker's PARENT, which is the
    // same bone `FigureFacing.joint` names.
    const byJoint = new Map(marker.map((m) => [m.joint, m]));
    expect(
      [...byJoint.keys()].sort(),
      `${label}: the two instruments must name the same figures`
    ).toEqual(face.map((f) => f.joint).sort());
    expect(byJoint.size, `${label}: marker joints are distinct`).toBe(marker.length);

    const expected = FACE_MARKER_OFFSET_DEG[rig.file];
    for (const f of face) {
      const m = byJoint.get(f.joint);
      expect(m, `${label}: no marker for ${f.joint}`).toBeDefined();
      if (!m) continue;
      // Wrapped: both readings are bearings, so their difference has to be
      // taken on the circle. Unwrapped it can only ever over-report (never
      // hide a failure), but it prints nonsense -- a face at -166 against a
      // marker at +154 is 40 degrees apart, not 320.
      const raw = f.meanDeg - m.meanDeg;
      const delta = ((((raw % 360) + 540) % 360) - 180);
      expect(
        Math.abs(delta - expected),
        `${label} ${f.joint}: face-minus-marker ${delta.toFixed(2)} against ${expected}`
      ).toBeLessThan(FACE_MARKER_TOLERANCE_DEG);
    }
  });
});

// ---------------------------------------------------------------------------
// M-3 -- table hygiene: every exemption/outlier key names something real.
// ---------------------------------------------------------------------------
//
// Every table above is read with a plain `T[key]` or `key in T`, which
// answers "what does this rig read" and never "does this key mean anything at
// all". A mistyped or stale entry -- a renamed file, a typo'd typeId, a key
// left behind after the rig it named dropped out of the roster -- sits there
// dead and silent, because nothing anywhere iterates `Object.keys(T)` for its
// own sake. `GAIT_EXEMPT`, `STILL_FIGURES`, `WEAPON_EXEMPT` and
// `WEAPON_ELEVATION_EXEMPT` are already asserted both ways for exactly this
// reason (each has its `Object.keys(...).sort()).toEqual(...)` or its
// per-key `.toContain` above); these five tables were not.
describe('mesh gait tables -- every key names something real', () => {
  it('GAIT_MULTIPLIER_OUTLIERS and CADENCE_OUTLIERS key on a real, gaited rig type', () => {
    const known = new Set(RIGS.filter((r) => !(r.typeId in GAIT_EXEMPT)).map((r) => r.typeId));
    for (const k of Object.keys(GAIT_MULTIPLIER_OUTLIERS)) {
      expect(known.has(k), `GAIT_MULTIPLIER_OUTLIERS key "${k}": not a gaited rig type`).toBe(true);
    }
    for (const k of Object.keys(CADENCE_OUTLIERS)) {
      expect(known.has(k), `CADENCE_OUTLIERS key "${k}": not a gaited rig type`).toBe(true);
    }
  });

  it('SWING_LIFT_OUTLIERS keys on a real "file clip" this sweep actually rows', () => {
    const known = new Set(declaredLocomotion().map(([, file, clip]) => `${file} ${clip}`));
    for (const k of Object.keys(SWING_LIFT_OUTLIERS)) {
      expect(known.has(k), `SWING_LIFT_OUTLIERS key "${k}": not a declared-locomotion row`).toBe(true);
    }
  });

  it('FACING_EXEMPT keys on a real file, or a real non-corpse file/clip pair', () => {
    const knownFiles = new Set(RIGS.map((r) => r.file));
    const knownFileClips = new Set(
      RIGS.flatMap((r) => r.clips.filter((c) => !CORPSE_CLIPS.has(c)).map((c) => `${r.file} ${c}`))
    );
    for (const k of Object.keys(FACING_EXEMPT)) {
      expect(
        knownFiles.has(k) || knownFileClips.has(k),
        `FACING_EXEMPT key "${k}": names no real file, and no real non-corpse file/clip pair`
      ).toBe(true);
    }
  });

  it("WEAPON_IDLE_ELEVATION_DEG keys on a real gated figure's joint", () => {
    const known = new Set(
      WEAPON_RIGS.filter((w) => !(w.file in WEAPON_ELEVATION_EXEMPT)).flatMap((w) =>
        measureWeaponAxis(`${MESHES}${w.file}`, w.role, 'idle', w.joint).map(
          (a) => `${w.file} ${a.joint}`
        )
      )
    );
    for (const k of Object.keys(WEAPON_IDLE_ELEVATION_DEG)) {
      expect(known.has(k), `WEAPON_IDLE_ELEVATION_DEG key "${k}": not a real gated figure`).toBe(true);
    }
  });
});
