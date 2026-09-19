/**
 * Task 7 of the blast package: the WIRING, pinned where it is wired.
 *
 * Tasks 2-6 each proved their own piece pure and in isolation
 * (`blast-spec.test.ts`, `scorch-decals.test.ts`, `blast-shake.test.ts`,
 * `units/smoke-plume.test.ts`, `units/mesh-vehicle.test.ts`). None of them
 * could answer the only question that makes a blast appear on screen: does
 * `ThreeRenderer` actually CALL them, at the right event, with the right
 * power, and on the right clock. That is what this file asks, at the three
 * regions Task 7 touches -- the `destroyed` branch, `spawnShellImpactFx`, and
 * `frame()`/`threeCamera()`.
 *
 * Harness and `vi.mock` stand-in copied verbatim from
 * `ThreeRenderer.collapse.test.ts` (its `FakeWebGLRenderer`, its `TONES` and
 * its `makeOpts`) rather than invented a second time -- read that file's own
 * top comment for why `new THREE.WebGLRenderer(...)` cannot construct under
 * this suite's headless `environment: 'node'`, and for what the stand-in does
 * and does not prove.
 *
 * TWO DELIBERATE DEPARTURES FROM THE TASK BRIEF'S SKETCH, both in the
 * direction of testing more rather than less:
 *
 * 1. The brief mocked `emitterLibrary.byName` to hand back
 *    `catastrophic_kill.json`. This file calls the renderer's real
 *    `useEmitters` with the two shipped JSON files instead, so the chain
 *    under test starts at the authored data rather than at a stub -- which
 *    also means `BLAST_EMITTER_ID`/`SHELL_IMPACT_EMITTER_ID` pointing at an
 *    id no shipped emitter carries is a RED test here, where a mock would
 *    have passed.
 * 2. The brief's R-K test stepped two frames and required the view camera to
 *    have moved between them. It cannot: the hit-stop withholds presentation
 *    time from the shake as well (the whole point of R-J -- "stops every
 *    presentation clock for the window"), and `shakeOffsetPx` is exactly 0 at
 *    age 0 because its oscillation is a sine. So this file drains the freeze
 *    first and then measures, and additionally compares against the UNSHAKEN
 *    view-camera position captured before the kill, which is the assertion
 *    that actually proves the offset reached the camera at all.
 *
 * Per this project's own testing standard, every assertion below was
 * verified by breaking the corresponding line in `ThreeRenderer.ts` by hand
 * and confirming the SPECIFIC test named goes red, then reverting -- the
 * mutations are listed in this task's report.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { SCORCH_CAPACITY } from './scorch-decals';
import { buildVehicleMeshTemplate, vehicleShroudBounds, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import catastrophic from '../../../../data/vfx/catastrophic_kill.json';
import shellImpact from '../../../../data/vfx/shell_impact.json';
import { shakeOffsetPx, initShakeState, type ShakeState } from './blast-shake';
import type { EmitterSpec } from '../vfx/emitters';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

/**
 * `loadVehicleMesh` is the ONE place `vehicleMeshBounds` is filled in
 * shipping code, and it reaches the network (`gltfLoader().loadAsync`), which
 * this headless suite has no `fetch` for. Everything else about that method
 * -- the real `vehicleShroudBounds` call, the real map write, the real
 * reload path -- is exactly what wants pinning, so only the FETCH is
 * replaced: `importOriginal` keeps every other export, including the
 * `vehicleShroudBounds` under test, as the shipped one.
 *
 * Without this the bounds fill would be the one line of Task 7 no test could
 * reach, and deleting it would leave every shroud test above still green
 * (they arm the map by hand).
 */
const loaded = vi.hoisted(() => ({ template: null as unknown }));
vi.mock('./units/mesh-vehicle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./units/mesh-vehicle')>();
  return { ...actual, loadVehicleMeshTemplate: async () => loaded.template };
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
 * `data/units/mbt_lavi.json` in the fields these paths read, with ONE
 * deliberate change: `hp` is 3000, not the roster's 1800.
 *
 * 3000 is `explosionBurstPowerFromMaxHp`'s own `referenceHp`, so
 * `killPower` is exactly 1 and every scaled number below is the emitter's
 * OWN authored value rather than a product this test would have to restate.
 * `hit_stop_ms: 70` in `catastrophic_kill.json` is therefore the 70 asserted
 * here: if the scaling were dropped entirely the assertion would still pass,
 * which is why the mortar half below (power 0.3) is what pins the scaling,
 * and this half pins the dispatch.
 *
 * `isSoft` falls out of the armour (`SOFT_ARMOR_LIMIT`, 30 mm), which is
 * what routes this type down `onEvents`' vehicle-kill branch.
 */
const HARD: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false },
  sensors: { optics: 3, sight_tiles: 14, signature: 1 },
};

/** A rifle squad in the fields these paths read. Soft by armour AND absent
 *  from `trackKindFor`'s closed vehicle table -- both halves of
 *  `isVehicleKill` have to say no, which is the point of the soft-target
 *  test. */
const SOFT: UnitTypeJson = {
  id: 'inf_squad',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 0.9, wheeled: false },
  sensors: { optics: 2, sight_tiles: 9, signature: 1 },
};

/** The private surface this suite drives. No public seam exists for any of
 *  it, and adding one would widen `Renderer` (`../api.ts`) for a test --
 *  the same reach `ThreeRenderer.collapse.test.ts` and
 *  `debug-layers.test.ts` already make. */
interface BlastPrivate {
  flashLights: { liveCount: number; lights: readonly THREE.PointLight[] };
  flashLightsDebugHidden: boolean;
  scorchDecals: { liveCount: number };
  collapseShrouds: { liveCount: number };
  vehicleMeshBounds: Map<string, THREE.Vector3>;
  hitStop: { remainingMs: number };
  shakeState: ShakeState;
  cameraShiftedByPx(dx: number, dy: number): { x: number; y: number; zoom: number };
  cssWidth: number;
  cssHeight: number;
  smokeClockMs: number;
  lastAlpha: number;
  updateOverlays(alpha: number): void;
  spawnShellImpactFx(s: { kind: string; tx: number; ty: number }): void;
  threeCamera(): THREE.OrthographicCamera;
}

/**
 * A 32x32 world with one hard target and one soft one, both spawned close to
 * the renderer's own default camera (24, 24).
 *
 * The distance matters and is not decoration: `catastrophic_kill.json`
 * declares `falloff_tiles: 14`, and `shakeOffsetPx` returns a flat 0 beyond
 * it -- a tank parked at the origin of a fresh `Float64Array` would push a
 * shake the camera is 34 tiles away from and could never feel, and the R-K
 * test would then pass for the wrong reason. `snapshot()` twice is what puts
 * the real spawn tiles into `curX`/`curY` (the first call only seeds).
 */
function worldWithTank(): { sim: Sim; renderer: ThreeRenderer; tankId: number; riflemanId: number } {
  const sim = new Sim({ seed: 1, width: 32, height: 32, capacity: 8 });
  const hardIdx = sim.addUnitType(HARD);
  const softIdx = sim.addUnitType(SOFT);
  const tankId = sim.spawn(hardIdx, 0, fx.from(24.5), fx.from(24.5));
  const riflemanId = sim.spawn(softIdx, 0, fx.from(26.5), fx.from(24.5));

  const renderer = new ThreeRenderer(sim, makeOpts());
  // The real library, not a stub -- see this file's top comment, departure 1.
  // The resolver mirrors the app's own contract closely enough for the two
  // palette keys these emitters name (`useEmitters` wraps it so a `#hex`
  // passes through); every colour here is cosmetic to these assertions.
  renderer.useEmitters(
    [catastrophic as unknown as EmitterSpec, shellImpact as unknown as EmitterSpec],
    (key) => (key.startsWith('#') ? key : '#FFB43C')
  );
  // A VIEWPORT. `init()` is what normally fills `cssWidth`/`cssHeight` (from
  // a real host element, which this headless suite has none of), and they
  // start at 0 -- which makes `dimetricCamera`'s frustum half-extents 0, the
  // projection matrix degenerate and EVERY `worldToScreen` answer `NaN`. That
  // is not a loud failure: `expect(a).toEqual(b)` treats `NaN` as equal to
  // `NaN`, so an assertion that "the projection did not move" passes on a
  // projection that never worked. 1400x900 is the visual gate's own capture
  // size (`tools/src/golden-diff/baseline.ts`).
  const priv = renderer as unknown as BlastPrivate;
  priv.cssWidth = 1400;
  priv.cssHeight = 900;
  renderer.snapshot();
  renderer.snapshot();
  return { sim, renderer, tankId, riflemanId };
}

/** The synthetic `destroyed` event `onEvents` would receive from the sim,
 *  with `alive` cleared first exactly as the sim leaves it. `by: -1` is the
 *  `debugKill`/tunnel-collapse shape -- no killer, so `killerX`/`killerY`
 *  go NaN and nothing downstream reads a phantom shooter. */
function kill(sim: Sim, renderer: ThreeRenderer, entity: number): void {
  sim.state.alive[entity] = 0;
  renderer.onEvents([{ kind: 'destroyed', tick: 1, entity, by: -1 } as unknown as SimEvent]);
}

describe('a vehicle kill runs the whole sequence', () => {
  it('spawns a flash, a shroud and a scorch where the vehicle died', () => {
    const { sim, renderer, tankId } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    // What `loadVehicleMesh` would have left behind -- `beginVehicleCollapseShroud`
    // reads only the measured size, never the template it came from.
    priv.vehicleMeshBounds.set('mbt_lavi', new THREE.Vector3(2, 1.4, 4));

    kill(sim, renderer, tankId);

    expect(priv.flashLights.liveCount).toBe(1);
    expect(priv.collapseShrouds.liveCount).toBe(1);
    expect(priv.scorchDecals.liveCount).toBe(1);
    expect(priv.hitStop.remainingMs).toBe(70);
    renderer.dispose();
  });

  // The gate is `isVehicleKill` and it must not have widened. Infantry dying
  // with a scorch under every body is the failure mode this asserts against.
  it('does none of it for a soft target', () => {
    const { sim, renderer, riflemanId } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    priv.vehicleMeshBounds.set('inf_squad', new THREE.Vector3(2, 1.4, 4));

    kill(sim, renderer, riflemanId);

    expect(priv.flashLights.liveCount).toBe(0);
    expect(priv.scorchDecals.liveCount).toBe(0);
    expect(priv.collapseShrouds.liveCount).toBe(0);
    expect(priv.hitStop.remainingMs).toBe(0);
    renderer.dispose();
  });

  // R-O/R-S: the shroud is sized from the vehicle's own measured body, so a
  // type with no loaded mesh has nothing to cover and gets no shroud -- the
  // `&nomesh` path, and every type before its GLB resolves.
  it('spawns no shroud for a vehicle whose mesh has not loaded, and still does everything else', () => {
    const { sim, renderer, tankId } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;

    kill(sim, renderer, tankId);

    expect(priv.collapseShrouds.liveCount).toBe(0);
    expect(priv.flashLights.liveCount).toBe(1);
    expect(priv.scorchDecals.liveCount).toBe(1);
    renderer.dispose();
  });

  it('never stamps more scorch than the pool holds', () => {
    const { renderer } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    for (let i = 0; i < SCORCH_CAPACITY + 8; i++) {
      priv.spawnShellImpactFx({ kind: 'mortar', tx: i % 30, ty: 3 });
    }
    expect(priv.scorchDecals.liveCount).toBe(SCORCH_CAPACITY);
    renderer.dispose();
  });
});

describe('the mortar half shares at its own power (G0 #14)', () => {
  it('a mortar bomb asks for less light and less hit-stop than a kill', () => {
    const { renderer } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;

    priv.spawnShellImpactFx({ kind: 'mortar', tx: 24.5, ty: 24.5 });

    // `shell_impact.json`'s own 40 ms at `SHELL_PROFILES.mortar.impactPower`
    // 0.3. Asserted as a BAND rather than as 12 so this reads as "quieter
    // than a kill", which is the design claim, rather than as a restatement
    // of two constants; the exact product is `blast-spec.test.ts`'s job.
    const mortarStop = priv.hitStop.remainingMs;
    expect(mortarStop).toBeGreaterThan(0);
    expect(mortarStop).toBeLessThan(70);
    expect(priv.flashLights.liveCount).toBe(1);
    expect(priv.scorchDecals.liveCount).toBe(1);
    renderer.dispose();
  });

  // A mortar bomb is not a vehicle: there is no mesh swap to hide at an
  // impact, and a dust cloud with nothing under it is decoration.
  it('leaves no shroud behind', () => {
    const { renderer } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    priv.spawnShellImpactFx({ kind: 'rocket', tx: 24.5, ty: 24.5 });
    expect(priv.collapseShrouds.liveCount).toBe(0);
    renderer.dispose();
  });

  // impactPower 0: direct fire never explodes on landing, and bolts never
  // reach this function at all (`shellHasLanded` runs over `this.shells`).
  it('a bolt detonates nothing', () => {
    const { renderer } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    priv.spawnShellImpactFx({ kind: 'bolt', tx: 5, ty: 5 });
    expect(priv.scorchDecals.liveCount).toBe(0);
    expect(priv.flashLights.liveCount).toBe(0);
    expect(priv.hitStop.remainingMs).toBe(0);
    renderer.dispose();
  });
});

describe('the shake is applied to the view camera and nowhere else (R-K)', () => {
  it('moves the three.js camera and leaves Renderer.camera and worldToScreen alone', () => {
    const { sim, renderer, tankId } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    const before = { ...renderer.camera };
    const screenBefore = renderer.worldToScreen(10, 10);
    // A real number, not `NaN` -- see `worldWithTank`'s viewport comment for
    // what this guards, and why `toEqual` alone could not.
    expect(Number.isFinite(screenBefore.x)).toBe(true);
    const unshaken = priv.threeCamera().position.clone();

    kill(sim, renderer, tankId);
    // Five 16 ms frames drain the 70 ms freeze -- see this file's top
    // comment, departure 2: the shake does not age while presentation time
    // is being withheld, and its own oscillation is 0 at age 0 anyway.
    for (let i = 0; i < 5; i++) renderer.frame(1, 16);

    // The seam itself: `packages/app`'s camera object is untouched, so a
    // click during a shake still lands on the tile the player aimed at.
    expect(renderer.camera).toEqual(before);
    expect(renderer.worldToScreen(10, 10)).toEqual(screenBefore);

    // ...and the view camera really did move, or this test passes for the
    // wrong reason. Two ways, because either alone is weak: displaced from
    // where it sat before the kill, and still moving frame to frame.
    const shaken = priv.threeCamera().position.clone();
    expect(shaken.equals(unshaken)).toBe(false);
    renderer.frame(1, 16);
    expect(priv.threeCamera().position.equals(shaken)).toBe(false);
    renderer.dispose();
  });

  it('puts the view camera back exactly where it started once the shake retires', () => {
    // A shake that leaks a permanent offset into the view is a camera that
    // has silently panned -- invisible on one blast, cumulative over a
    // battle. 420 ms of duration plus the 70 ms freeze, stepped well past.
    const { sim, renderer, tankId } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    const unshaken = priv.threeCamera().position.clone();

    kill(sim, renderer, tankId);
    for (let i = 0; i < 40; i++) renderer.frame(1, 16);

    expect(priv.threeCamera().position.equals(unshaken)).toBe(true);
    renderer.dispose();
  });
});

describe('the hit-stop freezes presentation and nothing else (R-J, R-D)', () => {
  it('holds interpolation for its window while the sim is untouched', () => {
    const { sim, renderer, tankId } = worldWithTank();
    const tickBefore = sim.tickCount;

    kill(sim, renderer, tankId);
    const priv = renderer as unknown as BlastPrivate;
    renderer.frame(1, 16);

    expect(priv.hitStop.remainingMs).toBeLessThan(70);
    expect(sim.tickCount).toBe(tickBefore); // the renderer never ticks the sim
    for (let i = 0; i < 6; i++) renderer.frame(1, 16);
    expect(priv.hitStop.remainingMs).toBe(0);
    renderer.dispose();
  });

  // The freeze is the reason `frame()` keeps a `lastAlpha`: handing the
  // incoming alpha through would make the world creep forward during the
  // window, which is the exact thing the freeze exists to stop.
  it('withholds every presentation clock for the window, and re-hands the last alpha', () => {
    const { sim, renderer, tankId } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    // One ordinary frame first, so `lastAlpha` holds a value that is NOT the
    // one the frozen frame is about to be handed -- otherwise the assertion
    // below could not tell "held the last alpha" from "passed this one
    // through", which is the whole distinction.
    renderer.frame(0.25, 16);
    const clockBefore = priv.smokeClockMs;

    kill(sim, renderer, tankId);
    const overlays = vi.spyOn(priv, 'updateOverlays');
    renderer.frame(0.9, 16);

    // The interpolation fraction: held, not advanced.
    expect(overlays).toHaveBeenCalledWith(0.25);
    expect(priv.lastAlpha).toBe(0.25);
    // A presentation clock, picked because it is one of the few that reads
    // RAW `dtMs` rather than going through `frameDtMs` -- so it is the
    // cheapest proof that the zeroing happens at the boundary rather than
    // inside one subsystem.
    expect(priv.smokeClockMs).toBe(clockBefore);
    // ...and the shake's own age, which is the clock the freeze is most
    // easily got wrong on: it must not burn a sixth of its life during the
    // frames it is not being drawn on.
    expect(priv.shakeState.live[0].ageMs).toBe(0);
    // The freeze itself still drains on REAL time, or it would never release.
    expect(priv.hitStop.remainingMs).toBe(70 - 16);
    overlays.mockRestore();
    renderer.dispose();
  });
});

describe('a vehicle mesh measures its own shroud bounds when it loads (R-O)', () => {
  /** A one-part vehicle GLB with a `death_root` -- the shape every shipped
   *  `art/meshes/vehicles/*.glb` has been in since the 2026-09-15 wreck
   *  pass, and the shape that makes `vehicleShroudBounds`' own exclusion
   *  mean something. */
  async function fixtureTemplate(): Promise<VehicleMeshTemplate> {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['idle', 'wreck'],
      deathRoot: { parts: ['hull_hull'] },
    });
    return buildVehicleMeshTemplate(gltf, 'mbt_lavi');
  }

  it('fills vehicleMeshBounds beside vehicleMeshTemplates, with the function the design names', async () => {
    const { renderer } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    const template = await fixtureTemplate();
    loaded.template = template;

    await renderer.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');

    const bounds = priv.vehicleMeshBounds.get('mbt_lavi');
    expect(bounds).toBeDefined();
    // Not a restatement of the fixture's own numbers -- the same function
    // the design names, run over the same root. What this pins is that
    // `loadVehicleMesh` calls IT, and calls it on the template it just
    // stored, which is the wiring no other test in the tree can see.
    expect(bounds).toEqual(vehicleShroudBounds(template.root));
    // ...and that it measured something. A zero vector is what an empty box
    // returns, and it would make every later shroud a silent no-op.
    expect(bounds?.length()).toBeGreaterThan(0);
    renderer.dispose();
  });

  it('re-measures on a reload rather than keeping the first size', async () => {
    // A re-export that changed the body's size must not leave the shroud
    // sized for the old one -- the reason this is recomputed here rather
    // than carried on the template, exactly as `loadBuildingMesh` does it.
    const { renderer } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    loaded.template = await fixtureTemplate();
    await renderer.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');

    const bigger = await fixtureTemplate();
    bigger.root.scale.multiplyScalar(3);
    loaded.template = bigger;
    await renderer.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');

    expect(priv.vehicleMeshBounds.get('mbt_lavi')).toEqual(vehicleShroudBounds(bigger.root));
    renderer.dispose();
  });
});

describe("the blast-light toggle is a flag `frame()` consults, not a one-shot write (R-M)", () => {
  it('holds the pool at zero across the repaint the visual gate photographs on', () => {
    // The whole reason this test lives HERE and not in `debug-layers.test.ts`
    // beside its `scorch` sibling: with an empty light pool
    // `FlashLightManager.step` writes 0 to every slot anyway, so the toggle
    // passes whether or not `frame()` consults the flag. Measured -- an
    // earlier version of this test on a quiet scene stayed GREEN with the
    // consult deleted, which is the identical false green `units` once
    // produced and the exact defect `debug-layers.ts`'s own header warns
    // about. A LIVE flash is the input that makes the check able to fail.
    const { sim, renderer, tankId } = worldWithTank();
    const priv = renderer as unknown as BlastPrivate;
    kill(sim, renderer, tankId);
    // Six frames, not one: the 70 ms freeze withholds presentation time from
    // `flashLights.step` too, and the decay curve is `sin(progress * PI)` --
    // which is exactly 0 at age 0. The light is only actually BRIGHT once
    // the freeze has released and it has aged a frame.
    for (let i = 0; i < 6; i++) renderer.frame(1, 16);
    // The precondition: something is actually lit, so `step` has a non-zero
    // intensity to write back on the next frame.
    expect(priv.flashLights.liveCount).toBe(1);
    expect(priv.flashLights.lights.some((l) => l.intensity > 0)).toBe(true);

    expect(renderer.setDebugLayerVisible('blast-light', false)).toBe(priv.flashLights.lights.length);
    expect(priv.flashLightsDebugHidden).toBe(true);
    for (const light of priv.flashLights.lights) expect(light.intensity).toBe(0);

    // The gate's second photograph: a repaint at ZERO elapsed presentation
    // time. `flashLights.step(0)` runs and rewrites every slot -- if the
    // flag were a one-shot write, the light would be back by now.
    renderer.frame(1, 0);
    for (const light of priv.flashLights.lights) expect(light.intensity).toBe(0);

    expect(renderer.setDebugLayerVisible('blast-light', true)).toBe(priv.flashLights.lights.length);
    expect(priv.flashLightsDebugHidden).toBe(false);
    renderer.frame(1, 0);
    expect(priv.flashLights.lights.some((l) => l.intensity > 0)).toBe(true);
    renderer.dispose();
  });
});

describe('the shake offset goes through the dimetric inverse (fix round 1)', () => {
  /**
   * The projection mixes both axes -- `worldToScreen` is
   * `x = (wx - wy) * TILE_W / 2`, `y = (wx + wy) * TILE_H / 2` -- so the
   * inverse of a screen offset is NOT `dx / TILE_W`, `dy / TILE_H`. This is
   * the round trip that says so in numbers: displace the camera by what the
   * renderer thinks N screen pixels are worth, project that displacement
   * back through the renderer's OWN `worldToScreen`, and require N back.
   *
   * `worldToScreen` is projected against the UNSHAKEN `this.camera` (the
   * shaken copy never reaches it -- R-K), so the base point is the viewport
   * centre and the difference is the pure screen displacement.
   */
  function screenDisplacement(
    renderer: ThreeRenderer,
    shifted: { x: number; y: number }
  ): { x: number; y: number } {
    const centre = renderer.worldToScreen(renderer.camera.x, renderer.camera.y);
    const moved = renderer.worldToScreen(shifted.x, shifted.y);
    return { x: moved.x - centre.x, y: moved.y - centre.y };
  }

  // Both ends of `main.ts`'s own 0.35-2.5 zoom clamp: the defect was
  // zoom-INVARIANT (0.64x and ~34 degrees off at every zoom), so a test at
  // one zoom would have caught it -- but a future per-axis-in-pixels mistake
  // would not be, and this is the cheap way to keep both closed.
  for (const zoom of [0.35, 2.5]) {
    // A pure screen-x offset and a pure screen-y one. Neither is reachable
    // through the shake MODEL -- `SHAKE_DIR_X`/`SHAKE_DIR_Y` pin every jolt
    // to the screen's 45-degree diagonal, where an axis-swapping error is
    // partly disguised by the symmetry of `dx === dy`. These go straight at
    // the conversion, which is where the defect lived.
    it(`maps a pure screen-x offset back to itself at zoom ${zoom}`, () => {
      const { renderer } = worldWithTank();
      const priv = renderer as unknown as BlastPrivate;
      renderer.camera.zoom = zoom;

      const d = screenDisplacement(renderer, priv.cameraShiftedByPx(9, 0));

      expect(d.x).toBeCloseTo(9, 2);
      expect(d.y).toBeCloseTo(0, 2);
      renderer.dispose();
    });

    it(`maps a pure screen-y offset back to itself at zoom ${zoom}`, () => {
      const { renderer } = worldWithTank();
      const priv = renderer as unknown as BlastPrivate;
      renderer.camera.zoom = zoom;

      const d = screenDisplacement(renderer, priv.cameraShiftedByPx(0, 9));

      expect(d.x).toBeCloseTo(0, 2);
      expect(d.y).toBeCloseTo(9, 2);
      renderer.dispose();
    });

    it(`puts a real shake on screen at its own amplitude at zoom ${zoom}`, () => {
      // The integrated path, through the real `threeCamera()` rather than
      // the conversion alone. `updateDimetricCamera` sets
      // `position = (cam.x, 0, cam.y) + VIEW_DIRECTION * CAMERA_DISTANCE`
      // with both terms constant, so the DIFFERENCE between a shaken and an
      // unshaken view camera's position is exactly the camera copy's own
      // world delta -- readable without a second accessor.
      const { sim, renderer, tankId } = worldWithTank();
      const priv = renderer as unknown as BlastPrivate;
      kill(sim, renderer, tankId);
      // Past the 70 ms freeze, which withholds presentation time from the
      // shake as well -- and the oscillation is a sine, so the offset is
      // exactly 0 until it has aged. Without this the assertion would hold
      // trivially at 0 and could not fail.
      for (let i = 0; i < 6; i++) renderer.frame(1, 16);
      renderer.camera.zoom = zoom;

      const offset = shakeOffsetPx(priv.shakeState, renderer.camera.x, renderer.camera.y);
      expect(Math.abs(offset.dx)).toBeGreaterThan(0.1); // the input that makes this able to fail
      const shakenPos = priv.threeCamera().position.clone();
      const live = priv.shakeState;
      priv.shakeState = initShakeState();
      const restPos = priv.threeCamera().position.clone();
      priv.shakeState = live;

      const d = screenDisplacement(renderer, {
        x: renderer.camera.x + (shakenPos.x - restPos.x),
        y: renderer.camera.y + (shakenPos.z - restPos.z),
      });

      expect(d.x).toBeCloseTo(offset.dx, 2);
      expect(d.y).toBeCloseTo(offset.dy, 2);
      renderer.dispose();
    });
  }
});
