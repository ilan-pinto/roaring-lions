/**
 * The WIRING half of the gait work (design sec 3.4, Task 6).
 *
 * `units/mesh-anim.test.ts` pins the arithmetic: given a stride, a cycle and
 * a ground speed, what playback rate falls out. It cannot see whether the
 * draw loop ever asks. That gap is exactly the shape this project has been
 * bitten by twice -- "a cursor whose logic is right and whose wiring is not"
 * (`__lions.cursorKey`'s own doc comment), and three complete sprite sheets
 * that drew nothing because no `SPRITE_MAP` entry queued them. So every
 * assertion below runs a REAL `Sim`, orders a REAL move, and reads
 * `AnimationAction.timeScale` off the action the renderer is actually
 * playing.
 *
 * Harness copied from `ThreeRenderer.fire-latch.test.ts` -- read its top
 * comment first; the same `.init()`-free, `WebGLRenderer`-stubbed,
 * template-installed-directly setup applies here for the same reasons.
 *
 * **The fixture's gait is chosen so the expected numbers are round and
 * INDEPENDENT of the code under test.** `strideM: 1.5` over `cycleS: 0.5`
 * is 1.5 m of leg per half second; one tile is 3 m; so the clip's own legs
 * describe exactly 1.0 tiles/s. A unit whose `speed_tiles_s` is 1.0 must
 * therefore play at 1x and one at 2.0 must play at 2x -- neither number is
 * computed here by the same expression the renderer uses.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildMeshUnitTemplate, type MeshUnitTemplate, type MeshUnitEntity } from './units/mesh-unit';
import { parseFixture } from './units/mesh-fixture';
import { ROUT_CADENCE, type UnitAnimInput } from '../clip';
import type { ClipName } from '../sheet';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

/**
 * The fixture's declared gait. 1.5 m of forward boot travel over a 0.5 s
 * cycle; `MESH_UNITS_PER_TILE` is 3, so the legs describe 1.0 tiles/s.
 * Deliberately round: every expectation in this file is a small integer or a
 * simple fraction of a unit's own `speed_tiles_s`, readable without running
 * the formula.
 */
const FIXTURE_GAIT = { move: { strideM: 1.5, cycleS: 0.5 } };
/** What `FIXTURE_GAIT` works out to, stated once, in tiles/s. */
const FIXTURE_CLIP_GROUND = 1.0;

/** Moves at exactly the speed its own legs describe: expect 1x. */
const NOMINAL_INF: UnitTypeJson = {
  id: 'gait_nominal_inf',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: FIXTURE_CLIP_GROUND },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};

/** Twice its own legs' speed -- the sliding case the milestone exists for.
 *  Same fixture, same gait, different answer. */
const FAST_INF: UnitTypeJson = {
  ...NOMINAL_INF,
  id: 'gait_fast_inf',
  mobility: { speed_tiles_s: 2 * FIXTURE_CLIP_GROUND },
};

interface ThreeRendererPrivates {
  entitySpeed: Float64Array;
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  updateMeshUnits(alpha: number, dtMs: number): void;
  applyGaitRate(
    entity: MeshUnitEntity,
    template: MeshUnitTemplate,
    entitySpeedTiles: number,
    anim: UnitAnimInput
  ): void;
}

const FRAME_MS = 1000 / 60;

interface SetUpOpts {
  /** Omit to build a GLB that declares no `rl_gait` -- the four crew-served
   *  rigs, and any re-export `pnpm gait:meshes` has not been run on. */
  gait?: Record<string, { strideM: number; cycleS: number }>;
  /** Clip names the fixture authors. */
  clips?: ClipName[];
}

async function setUp(opts: SetUpOpts = {}) {
  const sim = new Sim({ seed: 1, width: 32, height: 32, capacity: 8 });
  const nominalIdx = sim.addUnitType(NOMINAL_INF);
  const fastIdx = sim.addUnitType(FAST_INF);
  const nominalId = sim.spawn(nominalIdx, 0, fx.from(4.5), fx.from(6.5));
  const fastId = sim.spawn(fastIdx, 0, fx.from(4.5), fx.from(9.5));

  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ThreeRendererPrivates;

  const gltf = await parseFixture({
    roleName: 'uniform',
    clipName: opts.clips ?? ['idle', 'move'],
    ...(opts.gait !== undefined ? { sceneExtras: { rl_gait: opts.gait } } : {}),
  });
  // One parsed GLB, two templates: `buildMeshUnitTemplate` mutates and keeps
  // the scene it is handed, so the two types cannot share one.
  priv.meshUnitTemplates.set(NOMINAL_INF.id, [buildMeshUnitTemplate(gltf, 'kdf', 'fixture.glb')]);
  const gltf2 = await parseFixture({
    roleName: 'uniform',
    clipName: opts.clips ?? ['idle', 'move'],
    ...(opts.gait !== undefined ? { sceneExtras: { rl_gait: opts.gait } } : {}),
  });
  priv.meshUnitTemplates.set(FAST_INF.id, [buildMeshUnitTemplate(gltf2, 'kdf', 'fixture.glb')]);

  renderer.snapshot();
  renderer.snapshot();

  return { sim, renderer, priv, nominalId, fastId };
}

/** Orders `ids` due east and runs `ticks` sim ticks, snapshotting each one
 *  exactly as `main.ts`'s fixed-tick loop does, then draws one frame. */
function marchEast(
  sim: Sim,
  renderer: ThreeRenderer,
  priv: ThreeRendererPrivates,
  ids: number[],
  goalX: number,
  ticks: number
): void {
  for (const id of ids) {
    sim.queueCommand({
      kind: 'move',
      ids: [id],
      x: fx.from(goalX),
      y: sim.state.posY[id],
    });
  }
  for (let t = 0; t < ticks; t++) {
    sim.tick();
    renderer.snapshot();
  }
  priv.updateMeshUnits(1, FRAME_MS);
}

/** The `timeScale` of whatever action the renderer is actually playing for
 *  `id` -- read off the live `AnimationAction`, not recomputed. */
function playingRate(priv: ThreeRendererPrivates, id: number): { clip: ClipName; timeScale: number } {
  const entity = priv.meshUnitEntities.get(id);
  if (!entity) throw new Error(`no mesh entity for ${id} -- the harness never instantiated one`);
  const clip = entity.currentClip;
  if (clip === null) throw new Error(`entity ${id} is playing no clip`);
  const action = entity.actions.get(clip);
  if (!action) throw new Error(`entity ${id} has no action for ${clip}`);
  return { clip, timeScale: action.timeScale };
}

describe('gait rate-matching, driven through updateMeshUnits', () => {
  it('a unit crossing exactly the ground its own legs describe plays at 1x', async () => {
    // **This one cannot fail on WIRING and says so rather than pretending
    // otherwise**: an untouched `AnimationAction` already has `timeScale` 1,
    // so deleting the `applyGaitRate` call in `updateMeshUnits` leaves it
    // green (verified by hand -- 4 of the 9 cases in this file go red, and
    // this is not one of them). It is here as the arithmetic anchor: the
    // measured speed and the declared gait really do meet at 1x, which is
    // what makes the 2x case below a comparison rather than a bare number.
    const { sim, renderer, priv, nominalId } = await setUp({ gait: FIXTURE_GAIT });
    marchEast(sim, renderer, priv, [nominalId], 20.5, 6);

    // The measured speed really is the nominal one -- without this the
    // assertion below could pass on a unit that never moved.
    expect(priv.entitySpeed[nominalId]).toBeCloseTo(FIXTURE_CLIP_GROUND, 2);
    const { clip, timeScale } = playingRate(priv, nominalId);
    expect(clip).toBe('move');
    expect(timeScale).toBeCloseTo(1, 2);
  });

  it('a unit outrunning its own legs plays FASTER, in the same frame as one that is not', async () => {
    // The discriminating case: same GLB, same gait, two speeds. A wiring
    // that set a constant -- or that read the unit type's nominal speed
    // rather than `entitySpeed` -- passes the test above and fails this one.
    const { sim, renderer, priv, nominalId, fastId } = await setUp({ gait: FIXTURE_GAIT });
    marchEast(sim, renderer, priv, [nominalId, fastId], 20.5, 6);

    expect(priv.entitySpeed[fastId]).toBeCloseTo(2 * FIXTURE_CLIP_GROUND, 2);
    expect(playingRate(priv, nominalId).timeScale).toBeCloseTo(1, 2);
    expect(playingRate(priv, fastId).timeScale).toBeCloseTo(2, 2);
  });

  it('a unit SLOWED by the ground slows its legs instead of marching on the spot', async () => {
    // The complaint this milestone exists for, from the other side. The
    // slowdown is produced by the sim rather than injected: the last step
    // onto a goal is `min(step, distance)`, so the arrival tick moves the
    // unit less far than a full step and `entitySpeed` drops below nominal
    // while the unit is still moving.
    const { sim, renderer, priv, nominalId } = await setUp({ gait: FIXTURE_GAIT });
    // A goal 1.12 tiles away: at 0.05 tiles/tick that is 22 full steps and
    // one short one.
    const goalX = fx.toNumber(sim.state.posX[nominalId]) + 1.12;
    sim.queueCommand({
      kind: 'move',
      ids: [nominalId],
      x: fx.from(goalX),
      y: sim.state.posY[nominalId],
    });

    let slowFrame: { speed: number; timeScale: number } | null = null;
    for (let t = 0; t < 40; t++) {
      sim.tick();
      renderer.snapshot();
      priv.updateMeshUnits(1, FRAME_MS);
      const speed = priv.entitySpeed[nominalId];
      const { clip, timeScale } = playingRate(priv, nominalId);
      if (clip === 'move' && speed > 0 && speed < 0.9 * FIXTURE_CLIP_GROUND) {
        slowFrame = { speed, timeScale };
        break;
      }
    }

    if (!slowFrame) throw new Error('the unit never had a slowed MOVING frame -- fixture assumption broken');
    // The legs followed the ground, not the order.
    expect(slowFrame.timeScale).toBeLessThan(0.9);
    expect(slowFrame.timeScale).toBeCloseTo(slowFrame.speed / FIXTURE_CLIP_GROUND, 3);
  });

  it('a stopped unit is on `idle` at 1x -- the rate it had while moving does not leak', async () => {
    // What this DOES catch (verified by hand): deleting the `applyGaitRate`
    // call goes red here, because without it the unit never reaches 2x in the
    // first place and the first assertion fails.
    //
    // What it does NOT catch, stated rather than implied: `idle` reading 1
    // is true by construction -- `template.gait` cannot hold a
    // non-locomotion key, so the lookup misses and `gaitTimeScale` answers 1
    // whether or not the call site narrows first. The falsifiable guard on
    // that rule is `parseGaitExtras`'s own key check, in
    // `units/mesh-anim.test.ts`.
    const { sim, renderer, priv, fastId } = await setUp({ gait: FIXTURE_GAIT });
    marchEast(sim, renderer, priv, [fastId], 6.5, 4);
    expect(playingRate(priv, fastId).timeScale).toBeCloseTo(2, 2);

    for (let t = 0; t < 80; t++) {
      sim.tick();
      renderer.snapshot();
    }
    priv.updateMeshUnits(1, FRAME_MS);
    expect(sim.state.moving[fastId]).toBe(0);
    const { clip, timeScale } = playingRate(priv, fastId);
    expect(clip).toBe('idle');
    expect(timeScale).toBe(1);
  });

  it('a GLB with no rl_gait keeps 1x while moving -- exactly the behaviour before this change', async () => {
    const { sim, renderer, priv, fastId } = await setUp();
    marchEast(sim, renderer, priv, [fastId], 20.5, 6);

    expect(priv.entitySpeed[fastId]).toBeCloseTo(2 * FIXTURE_CLIP_GROUND, 2);
    const { clip, timeScale } = playingRate(priv, fastId);
    expect(clip).toBe('move');
    expect(timeScale).toBe(1);
  });

  it('rate-matches `moveFire` too, and leaves `fire` alone', async () => {
    const { sim, renderer, priv, fastId } = await setUp({
      gait: { move: FIXTURE_GAIT.move, moveFire: { strideM: 1.5, cycleS: 0.5 } },
      clips: ['idle', 'move', 'fire', 'moveFire'],
    });
    marchEast(sim, renderer, priv, [fastId], 20.5, 6);
    const entity = priv.meshUnitEntities.get(fastId);
    if (!entity) throw new Error('no mesh entity');

    // `resolveMeshMotionClip` only reaches `moveFire` through `fire`, which
    // needs the fire latch; drive the decision directly rather than staging
    // a firefight, which would make this a test of combat tuning.
    const moving: UnitAnimInput = {
      alive: 1, routed: 0, pinned: 0,
      speed: priv.entitySpeed[fastId], firing: true, working: false,
    };
    entity.currentClip = 'moveFire';
    priv.applyGaitRate(entity, priv.meshUnitTemplates.get(FAST_INF.id)![0], priv.entitySpeed[fastId], moving);
    expect(entity.actions.get('moveFire')?.timeScale).toBeCloseTo(2, 2);

    // `fire` is the by-construction half (see the `idle` case above for the
    // full account); it is here so the pair reads together, not as a guard.
    entity.currentClip = 'fire';
    priv.applyGaitRate(entity, priv.meshUnitTemplates.get(FAST_INF.id)![0], priv.entitySpeed[fastId], moving);
    expect(entity.actions.get('fire')?.timeScale).toBe(1);
  });
});

describe('rout cadence finally reaches the mesh path', () => {
  /**
   * Driven through `applyGaitRate` rather than by routing a unit in the sim.
   * Rout needs ten seconds of continuous suppression (`ROUT_AFTER_TICKS`), so
   * staging it here would make this a test of combat tuning; what is being
   * pinned is that the draw loop hands `cadenceScale` to the arithmetic at
   * all, which no mesh code has ever done. The sim-driven half was watched on
   * screen -- see this task's report.
   */
  const routed: UnitAnimInput = {
    alive: 1, routed: 1, pinned: 0, speed: 0.5, firing: false, working: false,
  };
  const calm: UnitAnimInput = { ...routed, routed: 0 };

  it('plays a broken unit`s walk at ROUT_CADENCE times the rate-matched one', async () => {
    const { priv, nominalId, sim, renderer } = await setUp({ gait: FIXTURE_GAIT });
    marchEast(sim, renderer, priv, [nominalId], 20.5, 6);
    const entity = priv.meshUnitEntities.get(nominalId);
    if (!entity) throw new Error('no mesh entity');
    const template = priv.meshUnitTemplates.get(NOMINAL_INF.id)![0];
    entity.currentClip = 'move';

    // The sim halves a routed unit's own step (`ROUT_SPEED_SHIFT`), so both
    // calls take the SAME already-halved speed -- what is being measured is
    // the cadence multiplier alone, not the speed change beneath it.
    priv.applyGaitRate(entity, template, 0.5, calm);
    const calmRate = entity.actions.get('move')?.timeScale ?? Number.NaN;
    priv.applyGaitRate(entity, template, 0.5, routed);
    const routedRate = entity.actions.get('move')?.timeScale ?? Number.NaN;

    expect(calmRate).toBeCloseTo(0.5, 6);
    expect(routedRate / calmRate).toBeCloseTo(ROUT_CADENCE, 6);
  });

  it('a routed unit`s legs still over-run its ground, which is what reads as panic', async () => {
    // The whole design tension in one assertion. The sim moves a routed unit
    // at half speed; rate-matching alone would put its feet exactly on the
    // ground and it would read as a calm stroll. At ROUT_CADENCE it covers
    // 1.6 gait cycles per cycle's worth of ground -- shorter, quicker steps
    // against the ground, which is the read `ROUT_CADENCE` was written for.
    const { priv, nominalId, sim, renderer } = await setUp({ gait: FIXTURE_GAIT });
    marchEast(sim, renderer, priv, [nominalId], 20.5, 6);
    const entity = priv.meshUnitEntities.get(nominalId);
    if (!entity) throw new Error('no mesh entity');
    entity.currentClip = 'move';
    priv.applyGaitRate(entity, priv.meshUnitTemplates.get(NOMINAL_INF.id)![0], 0.5, routed);

    const rate = entity.actions.get('move')?.timeScale ?? Number.NaN;
    const legGroundPerSecond = rate * FIXTURE_CLIP_GROUND;
    expect(legGroundPerSecond / 0.5).toBeCloseTo(ROUT_CADENCE, 6);
    // ...and in ABSOLUTE terms it is slower than a calm walk, which is the
    // consequence the spec did not anticipate and this task accepted with
    // its eyes open. Recorded here so nobody "fixes" it by accident.
    expect(rate).toBeLessThan(1);
  });
});

describe('the mixer actually consumes the rate', () => {
  it('a 2x action advances twice as far through its clip per frame as a 1x one', async () => {
    // `timeScale` is only worth setting if the mixer reads it. Two entities,
    // one frame's worth of mixer time each, and the clip time they land on.
    const { sim, renderer, priv, nominalId, fastId } = await setUp({ gait: FIXTURE_GAIT });
    marchEast(sim, renderer, priv, [nominalId, fastId], 20.5, 6);

    const reset = (id: number) => {
      const entity = priv.meshUnitEntities.get(id);
      if (!entity) throw new Error('no mesh entity');
      const action = entity.actions.get('move') as THREE.AnimationAction;
      action.time = 0;
      return { entity, action };
    };
    const slow = reset(nominalId);
    const fast = reset(fastId);
    slow.entity.mixer.update(0.1);
    fast.entity.mixer.update(0.1);

    expect(fast.action.time).toBeCloseTo(2 * slow.action.time, 4);
    expect(slow.action.time).toBeGreaterThan(0);
  });
});
