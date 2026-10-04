/**
 * GH-148 -- how long the `fire` clip stays latched, and which asset's
 * duration decides that.
 *
 * The reported symptom was "infantry still goes up and down when shooting".
 * The bob is not in the art: every shipped `fire` clip is vertically flat
 * (`teams.py`'s `_standing_posture` forbids it a height change, and the rigs
 * honour it). It was clip SWITCHING -- `onFire` sized `firingTimer` from the
 * SPRITE SHEET's `fire` clip, which on a billboard is one muzzle-flash frame
 * at 12 fps (0.083 s, and the same 1@12 on every infantry sheet that ships).
 * The MESH `fire` clips are 3-6x longer (0.250 s for `inf_squad`/
 * `militia_cell`, 0.500 s for `meshy_soldier`/`sarim_rifles`), so a rifle at
 * 320 rpm -- a shot every 0.188 s -- latched for 0.083 s, played 17% of its
 * clip, dropped to `idle`, and restarted from frame 0 on the next shot. Five
 * pose snaps a second.
 *
 * Everything below is therefore about ONE number, from two directions: what
 * `onFire` writes into `firingTimer` (the unit tests), and what a figure is
 * actually posed as across a sustained burst (the behavioural test, which is
 * the one that speaks to the complaint).
 *
 * Harness copied from `ThreeRenderer.mesh-death.test.ts` -- read its top
 * comment first; the same `.init()`-free, `WebGLRenderer`-stubbed,
 * template-installed-directly setup applies here for the same reasons. One
 * addition of its own (a second, the REAL `INF_SQUAD` sprite `UnitInstancer`
 * the 0.083 s was read from, went with the billboard path in WP-A3.3 -- the
 * latch is sized from the mesh clip alone now):
 *
 *  - `onEvents` is driven with a hand-built `fire` event rather than a real
 *    `sim.tick()` engagement. This is a RENDERER test: it cares what the
 *    renderer does WITH the event, and a scripted firefight would make the
 *    cadence (the whole point of the behavioural test) a property of combat
 *    tuning rather than of the test.
 *
 * Per this project's standard, every assertion below was watched go red
 * against the pre-fix `firingTimer[e.shooter] = fireClip.frames /
 * fireClip.fps` line; the failing output is in this task's report.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import type { ClipName } from '../sheet';
import { ThreeRenderer } from './ThreeRenderer';
import { buildMeshUnitTemplate, type MeshUnitTemplate, type MeshUnitEntity } from './units/mesh-unit';
import { buildVehicleMeshTemplate, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseFixture } from './units/mesh-fixture';
import { parseRigidFixture } from './units/rigid-mesh-fixture';

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
  haze: '#E0B87A',
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

/** The mesh-drawn rifle squad. `isSoft` follows from `role: infantry`. */
const MESH_INF: UnitTypeJson = {
  id: 'fire_latch_mesh_inf',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};

/** A SECOND type, identical but for its id, which never gets a mesh
 *  template -- the no-mesh control. Since the billboard path was retired
 *  (WP-A3.3) such a type has no clip to size a latch from at all. */
const SPRITE_INF: UnitTypeJson = { ...MESH_INF, id: 'fire_latch_sprite_inf' };

/** `dozer_d9` because `vehicle-mesh-role.ts`'s ramp table is a CLOSED map of
 *  real unit ids -- `buildVehicleMeshTemplate` throws on anything else, so a
 *  synthetic id is not available here (the same constraint
 *  `ThreeRenderer.vehicle-mesh-anim.test.ts` records). */
const MESH_VEHICLE: UnitTypeJson = {
  id: 'dozer_d9',
  role: 'engineer',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

/** Reaches the private state this file drives and reads. No public accessor
 *  exists for any of it, and adding one purely for a test would widen
 *  `Renderer`'s surface for no runtime reason -- `ThreeRenderer.mesh-death.
 *  test.ts` gives the same reasoning for its own reach. */
interface ThreeRendererPrivates {
  firingTimer: Float64Array;
  // A LIST per type since GH-149 -- `civilians` ships four figures for one
  // unit type (`units/mesh-variant.ts`). This file loads one; the shape is
  // the field's, not this test's choice.
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  drainTimers(dtSeconds: number): void;
  updateMeshUnits(alpha: number, dtMs: number): void;
}

/** A `fire` event exactly as `Sim` emits one, minus the rolls this path
 *  never reads. `weaponId` matches no weapon on these types on purpose:
 *  `onFire` then resolves `cls` to `small_arms`, which is what a rifle
 *  squad fires anyway, and the test does not have to guess at a weapon
 *  schema it is not testing. */
function fireEvent(shooter: number, target: number): SimEvent {
  return {
    kind: 'fire',
    tick: 0,
    shooter,
    target,
    weaponId: 'rifle',
    pHit: fx.from(0.5),
    roll: fx.from(0.4),
    willHit: true,
    breakdown: {
      accuracy: fx.from(0.5),
      rangeFalloff: fx.from(1),
      coverMod: fx.from(1),
      motionMod: fx.from(1),
      stanceMod: fx.from(1),
      suppressionMod: fx.from(1),
    },
  };
}

interface SetUpOpts {
  /** Duration of every clip in the infantry mesh fixture, in seconds. */
  meshClipSeconds?: number;
  /** Clip names the infantry mesh fixture authors. Omit `fire` to exercise
   *  a GLB that never authored one. */
  meshClips?: string[];
  /** Install a vehicle mesh template for `dozer_d9` too, and spawn one. */
  withVehicle?: boolean;
}

async function setUp(opts: SetUpOpts = {}) {
  const sim = new Sim({ seed: 1, width: 16, height: 16, capacity: 8 });
  const meshIdx = sim.addUnitType(MESH_INF);
  const spriteIdx = sim.addUnitType(SPRITE_INF);
  const meshId = sim.spawn(meshIdx, 0, fx.from(4.5), fx.from(6.5));
  const spriteId = sim.spawn(spriteIdx, 0, fx.from(5.5), fx.from(6.5));
  // Side 1, so `onFire`'s `this.curX[e.target]` reads a real entity rather
  // than the building branch.
  const targetId = sim.spawn(meshIdx, 1, fx.from(11.5), fx.from(6.5));

  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ThreeRendererPrivates;

  const gltf = await parseFixture({
    roleName: 'uniform',
    clipName: opts.meshClips ?? ['idle', 'fire'],
    ...(opts.meshClipSeconds !== undefined ? { clipSeconds: opts.meshClipSeconds } : {}),
  });
  priv.meshUnitTemplates.set(MESH_INF.id, [buildMeshUnitTemplate(gltf, 'kdf')]);

  let vehicleId = -1;
  if (opts.withVehicle) {
    const vehicleIdx = sim.addUnitType(MESH_VEHICLE);
    vehicleId = sim.spawn(vehicleIdx, 0, fx.from(8.5), fx.from(9.5));
    const rigid = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['idle', 'fire'],
    });
    priv.vehicleMeshTemplates.set(MESH_VEHICLE.id, buildVehicleMeshTemplate(rigid, MESH_VEHICLE.id));
  }

  renderer.snapshot();
  renderer.snapshot();

  return { sim, renderer, priv, meshId, spriteId, targetId, vehicleId };
}

describe('onFire latch length', () => {
  it('sizes the latch from the MESH `fire` clip when a mesh draws the unit', async () => {
    // 0.500 s: `meshy_soldier.glb`/`sarim_rifles.glb`'s real `fire` length.
    const { renderer, priv, meshId, targetId } = await setUp({ meshClipSeconds: 0.5 });
    renderer.onEvents([fireEvent(meshId, targetId)]);
    expect(priv.firingTimer[meshId]).toBeCloseTo(0.5, 6);
  });

  it('reads that clip`s OWN length, not a constant', async () => {
    // 0.250 s: `inf_squad.glb`/`militia_cell.glb`'s real `fire` length. Same
    // code path, different asset, different answer -- without this the test
    // above passes for any hard-coded number that happens to be 0.5.
    const { renderer, priv, meshId, targetId } = await setUp({ meshClipSeconds: 0.25 });
    renderer.onEvents([fireEvent(meshId, targetId)]);
    expect(priv.firingTimer[meshId]).toBeCloseTo(0.25, 6);
  });

  it('gives a type with no mesh template no latch at all, in the same renderer', async () => {
    // It used to fall back to its sprite sheet's 1-frame `fire` clip; that
    // sheet is retired (WP-A3.3). A type with no template draws a proxy box
    // (or nothing yet), neither of which has a pose to hold.
    const { renderer, priv, meshId, spriteId, targetId } = await setUp({ meshClipSeconds: 0.5 });
    renderer.onEvents([fireEvent(meshId, targetId), fireEvent(spriteId, targetId)]);
    expect(priv.firingTimer[spriteId]).toBe(0);
    // ...and the two do not contaminate each other.
    expect(priv.firingTimer[meshId]).toBeCloseTo(0.5, 6);
  });

  it('latches nothing for a mesh that never authored `fire`', async () => {
    // `at_team`, `atgm_cell`, `digger_crew` and `mortar_crew` ship exactly
    // like this. `applyMeshClip` resolves their `fire` to `idle` anyway, so
    // the latch is unobservable for them; it used to borrow the sprite's
    // 0.083 s and is a clean 0 now -- still a number the drain reads.
    const { renderer, priv, meshId, targetId } = await setUp({ meshClips: ['idle'] });
    renderer.onEvents([fireEvent(meshId, targetId)]);
    expect(priv.firingTimer[meshId]).toBe(0);
  });

  it('sizes a MESH VEHICLE`s latch from its own clip too', async () => {
    // `updateVehicleMeshes` reads the SAME `firingTimer`, so an animated
    // vehicle GLB would have inherited the identical bug. This is the
    // fixture's own 1 s clip.
    const { renderer, priv, targetId, vehicleId } = await setUp({ withVehicle: true });
    renderer.onEvents([fireEvent(vehicleId, targetId)]);
    expect(priv.firingTimer[vehicleId]).toBeCloseTo(1, 6);
  });
});

/**
 * The behavioural half -- what a figure is actually posed as, frame by
 * frame, across a burst. The unit tests above pin a number; this pins the
 * thing the complaint was about.
 *
 * Driven the way `frame()` drives it: `drainTimers` first, then
 * `updateMeshUnits`, at a real 60 fps frame delta, with shots injected on
 * the weapon's own cadence. `frame()` itself is not called because it
 * renders (and `init()` is unavailable under `environment: 'node'`) -- these
 * two calls in this order are the part of it that decides the pose.
 */
describe('sustained fire, frame by frame', () => {
  const FRAME_MS = 1000 / 60;
  const FRAME_S = FRAME_MS / 1000;
  /** A rifle at 320 rpm: 60 / 320 = 0.1875 s between shots. */
  const RIFLE_SHOT_INTERVAL_S = 60 / 320;

  /** Runs `seconds` of frames, firing every `shotIntervalS`, and returns the
   *  clip the mesh figure held on each frame. */
  async function poseTimeline(args: {
    meshClipSeconds: number;
    shotIntervalS: number;
    seconds: number;
  }): Promise<ClipName[]> {
    const { renderer, priv, meshId, targetId } = await setUp({ meshClipSeconds: args.meshClipSeconds });
    const poses: ClipName[] = [];
    let sinceShot = Infinity;
    for (let t = 0; t < args.seconds; t += FRAME_S) {
      if (sinceShot >= args.shotIntervalS) {
        renderer.onEvents([fireEvent(meshId, targetId)]);
        sinceShot = 0;
      }
      priv.drainTimers(FRAME_S);
      priv.updateMeshUnits(1, FRAME_MS);
      const clip = priv.meshUnitEntities.get(meshId)?.currentClip;
      if (clip === null || clip === undefined) throw new Error('mesh entity never got a clip');
      poses.push(clip);
      sinceShot += FRAME_S;
    }
    return poses;
  }

  it('holds `fire` for a whole second of rifle fire, never dropping to idle', async () => {
    const poses = await poseTimeline({
      meshClipSeconds: 0.5, // meshy_soldier
      shotIntervalS: RIFLE_SHOT_INTERVAL_S,
      seconds: 1,
    });
    expect(poses.length).toBeGreaterThan(50);
    // The reported symptom, stated exactly: not one frame of anything else.
    expect(new Set(poses)).toEqual(new Set<ClipName>(['fire']));
  });

  it('still holds through the SHORTEST shipped rifle clip (0.250 s > 0.188 s cadence)', async () => {
    // `inf_squad`/`militia_cell`. The margin is thin -- 0.25 against a 0.188
    // cadence -- which is precisely why it is worth pinning rather than
    // assuming the 0.5 s case covers it.
    const poses = await poseTimeline({
      meshClipSeconds: 0.25,
      shotIntervalS: RIFLE_SHOT_INTERVAL_S,
      seconds: 1,
    });
    expect(new Set(poses)).toEqual(new Set<ClipName>(['fire']));
  });

  it('settles back to idle between shots for a slow weapon', async () => {
    // A 3 rpm ATGM: one shot every 20 s. The figure must NOT stand there in
    // a firing pose for twenty seconds -- sizing the latch from the clip
    // rather than from the cadence is what gets this right, and it is the
    // failure mode a naive "hold until the next shot" fix would introduce.
    const poses = await poseTimeline({ meshClipSeconds: 0.5, shotIntervalS: 20, seconds: 2 });
    expect(poses[0]).toBe('fire');
    // 0.5 s of clip at 60 fps, then idle for the remaining 1.5 s.
    expect(poses.at(-1)).toBe('idle');
    const lastFire = poses.lastIndexOf('fire');
    expect((lastFire + 1) * FRAME_S).toBeCloseTo(0.5, 1);
  });
});
