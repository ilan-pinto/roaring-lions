/**
 * WP-A1.3 Task 6: the hull's weight, composed onto a real mesh vehicle
 * through the REAL frame loop.
 *
 * `units/vehicle-weight.test.ts` pins the pure model (the conform, the ramp,
 * the spring, the lag, the bound) and `units/vehicle-weight-params.test.ts`
 * the authored numbers. What neither can see is the WIRING: which position
 * the model is fed, which axis each angle is taken about, which sign the
 * roll carries once it is a three.js rotation, and whether the renderer's
 * own clock reaches it untouched. Every one of those is a way for correct
 * arithmetic to draw the wrong picture, and each has an assertion here that
 * reads the object `updateVehicleMeshes` actually wrote -- world-space
 * points off `root.matrixWorld`, or `debugVehicleTransform`, which decomposes
 * `root.quaternion` rather than recomputing anything.
 *
 * Harness: a faked `WebGLRenderer` (with `render()`, because these specs call
 * `frame()` -- `ThreeRenderer.blast.test.ts` has the same stand-in), a real
 * `Sim` built from the SHIPPED unit JSON (so cruise speed, turn rate, role
 * and domain are the roster's own, including `rocket_battery`'s absent turn
 * rate), a real `GLTFLoader`-parsed rigid fixture installed straight into the
 * private template map the way `ThreeRenderer.vehicle-mesh-anim.test.ts`
 * does, and a hull footprint written into `vehicleMeshBounds` exactly where
 * `loadVehicleMesh` would have left it.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import { hullCornerOffsets, MAX_DRAWN_OFFSET_TILES, type VehicleWeightArrays } from './units/vehicle-weight';
import { VEHICLE_WEIGHT_IMPORTED_UNIT_IDS, vehicleWeightParamsFor } from './units/vehicle-weight-params';

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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

/** The shipped unit JSON, read from disk -- the same file `@lions/data` hands
 *  the app, so the rates the model is fed are the roster's own. */
function unitJson(id: string): UnitTypeJson {
  for (const dir of ['kdf', 'enemy']) {
    const p = path.join(REPO, 'data/units', dir, `${id}.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as UnitTypeJson;
  }
  throw new Error(`no data/units/*/${id}.json`);
}

function isAirJson(json: UnitTypeJson): boolean {
  return (json.mobility as { domain?: string }).domain === 'air';
}

/** The private surface these specs drive and read. No public seam exists for
 *  any of it, and adding one would widen `Renderer` (`../api.ts`) for a test
 *  -- the same reach the other `ThreeRenderer.*.test.ts` files make. */
interface Priv {
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshBounds: Map<string, THREE.Vector3>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  vehicleWeight: VehicleWeightArrays;
  prevX: Float64Array;
  prevY: Float64Array;
  curX: Float64Array;
  curY: Float64Array;
  recoilT: Float64Array;
  recoilPower: Float64Array;
  recoilDir: Float64Array;
  hitStop: { remainingMs: number };
  cssWidth: number;
  cssHeight: number;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
}

/** A hull two tiles long and 1.2 wide -- `vehicleMeshBounds`' own shape
 *  (`x` along the forward axis, `z` across it, world tiles). */
const HULL = new THREE.Vector3(2, 0.8, 1.2);
const FRAME_MS = 1000 / 60;
const MAP = 24;

interface World {
  sim: Sim;
  renderer: ThreeRenderer;
  priv: Priv;
  id: number;
}

async function world(
  opts: { unitId?: string; x?: number; y?: number; facing?: number; elevation?: Uint8Array } = {}
): Promise<World> {
  const unitId = opts.unitId ?? 'mbt_lavi';
  const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
  const typeIdx = sim.addUnitType(unitJson(unitId));
  const id = sim.spawn(typeIdx, 0, fx.from(opts.x ?? 6.5), fx.from(opts.y ?? 6.5), fx.from(opts.facing ?? 0));
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Priv;
  // A viewport, as `init()` would have measured one -- see
  // `ThreeRenderer.blast.test.ts`'s own comment on why 0x0 is not harmless.
  priv.cssWidth = 1400;
  priv.cssHeight = 900;
  if (opts.elevation) renderer.setElevation(opts.elevation);
  const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
  priv.vehicleMeshTemplates.set(unitId, buildVehicleMeshTemplate(gltf, unitId));
  priv.vehicleMeshBounds.set(unitId, HULL.clone());
  // Twice: the first call only seeds `prevX`/`curX` from zero-filled slots.
  renderer.snapshot();
  renderer.snapshot();
  // One frame at rest, the way a spawned vehicle is first drawn in the game:
  // the weight model SEEDS from the speed it first sees (R-N), so a vehicle
  // first drawn already at cruise would never show its launch.
  renderer.frame(1, FRAME_MS);
  return { sim, renderer, priv, id };
}

function entityOf(priv: Priv, id: number): VehicleMeshEntity {
  const e = priv.vehicleMeshEntities.get(id);
  if (e === undefined) throw new Error(`no live vehicle mesh entity for ${id}`);
  return e;
}

/** One sim tick and the three 60 fps frames the app draws across it, alpha
 *  walking the tick. */
function tickAndDraw(w: World): void {
  w.sim.tick();
  w.renderer.snapshot();
  for (let f = 1; f <= 3; f++) w.renderer.frame(f / 3, FRAME_MS);
}

function moveTo(w: World, x: number, y: number): void {
  w.sim.queueCommand({ kind: 'move', ids: [w.id], x: fx.from(x), y: fx.from(y) });
}

/** An elevation grid, one digit per tile, from a function of the tile. */
function grid(level: (tx: number, ty: number) => number): Uint8Array {
  const g = new Uint8Array(MAP * MAP);
  for (let ty = 0; ty < MAP; ty++) {
    for (let tx = 0; tx < MAP; tx++) g[ty * MAP + tx] = Math.max(0, Math.min(9, level(tx, ty)));
  }
  return g;
}

/** A two-level step across x = 12: level 0 west of it, 2 from it east. */
const STEP_EAST = (): Uint8Array => grid((tx) => (tx >= 12 ? 2 : 0));

/** World-space points on the hull's own two FLANKS, at mid-length and hull
 *  height 0: hull-local `(0, 0, -hw)` and `(0, 0, +hw)` in tiles, divided by
 *  the root's own (uniform) `MESH_SCALE` to get root-local units. Local -Z
 *  is the corner `hullCornerOffsets` calls `right` -- the hull's PHYSICAL
 *  left under the mesh contract (+X forward, +Y up: forward x up = +Z is the
 *  physical right). */
function flanks(e: VehicleMeshEntity): { minusZ: THREE.Vector3; plusZ: THREE.Vector3 } {
  e.root.updateMatrixWorld(true);
  const s = e.root.scale.z;
  expect(e.root.scale.x).toBe(s);
  const hw = HULL.z / 2 / s;
  return {
    minusZ: new THREE.Vector3(0, 0, -hw).applyMatrix4(e.root.matrixWorld),
    plusZ: new THREE.Vector3(0, 0, hw).applyMatrix4(e.root.matrixWorld),
  };
}

describe('a parked vehicle on flat ground draws exactly where it stands (R-G)', () => {
  // The golden `vehicle` scenario in a unit test: beit_sahwan_outskirts
  // declares no elevation grid, the sandbox force is parked, and the baseline
  // must not move. Asserted here because it is cheap here and expensive in
  // Playwright.
  it('holds the identity transform over a hundred frames, parked from spawn', async () => {
    const w = await world({ facing: 0.3 });
    for (let f = 0; f < 100; f++) {
      if (f % 3 === 0) {
        w.sim.tick();
        w.renderer.snapshot();
      }
      w.renderer.frame(((f % 3) + 1) / 3, FRAME_MS);
    }
    const e = entityOf(w.priv, w.id);
    // EXACT, not close: a stationary unit's interpolation is its sim position
    // for every alpha, and the model's lag is forced to zero.
    expect(e.root.position.x).toBe(fx.toNumber(w.sim.state.posX[w.id]));
    expect(e.root.position.z).toBe(fx.toNumber(w.sim.state.posY[w.id]));
    expect(e.root.position.y).toBe(0);
    // Yaw alone -- the literal `-2 pi facing`, not the helper under test.
    const facing = fx.toNumber(w.sim.state.facing[w.id]);
    const yawOnly = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -2 * Math.PI * facing);
    expect(e.root.quaternion.angleTo(yawOnly)).toBeLessThan(1e-9);
    const t = w.renderer.debugVehicleTransform(w.id);
    expect(t?.pitchDeg).toBe(0);
    expect(t?.rollDeg).toBe(0);
  });

  // The case the spawn-parked one cannot see: every piece of state was
  // exercised, and all of it has to come back to EXACTLY nothing. A lag that
  // decays exponentially instead of snapping to zero on the sim's own
  // "stationary" leaves the hull a few ten-thousandths of a tile off the sim
  // for ever -- R-G's "leaked state".
  it('comes back to exactly the identity after driving, stopping and standing', async () => {
    const w = await world({ x: 4.5, y: 6.5 });
    moveTo(w, 9.5, 6.5);
    let maxPitchDeg = 0;
    let stillTicks = 0;
    for (let t = 0; t < 400 && stillTicks < 70; t++) {
      tickAndDraw(w);
      const d = w.renderer.debugVehicleTransform(w.id);
      if (d) maxPitchDeg = Math.max(maxPitchDeg, Math.abs(d.pitchDeg));
      stillTicks = d !== null && d.simSpeed === 0 ? stillTicks + 1 : 0;
    }
    expect(stillTicks).toBe(70); // it really did stop, 3.5 s ago
    expect(fx.toNumber(w.sim.state.posX[w.id])).toBeCloseTo(9.5, 3); // ...after really driving
    expect(maxPitchDeg).toBeGreaterThan(0.5); // ...and the model really did pitch meanwhile

    const e = entityOf(w.priv, w.id);
    expect(e.root.position.x).toBe(fx.toNumber(w.sim.state.posX[w.id]));
    expect(e.root.position.z).toBe(fx.toNumber(w.sim.state.posY[w.id]));
    const t = w.renderer.debugVehicleTransform(w.id);
    expect(t?.pitchDeg).toBe(0);
    expect(t?.rollDeg).toBe(0);
  });
});

describe("the tilt is in the HULL's frame at every heading (R-K)", () => {
  // The measurement R-K came from, as an assertion. With the shipped
  // `rotation.x = pitch` + `rotation.y = yaw` composition the nose lift is
  // 0 at facings 0 and 0.5, NEGATIVE at 0.25 and positive at 0.75 -- a tilt
  // about the WORLD X axis, while `MESH_HULL_PITCH_RAD`'s comment claimed a
  // local one. Driven through the recoil's own pitch term because that is
  // the one pitch this renderer shipped before the weight model, and it now
  // joins the same sum.
  it('lifts the nose by the same amount whichever way the hull faces', async () => {
    const lifts: number[] = [];
    for (const facingIn of [0, 0.25, 0.5, 0.6, 0.75]) {
      const w = await world({ facing: facingIn });
      w.priv.updateVehicleMeshes(1, FRAME_MS); // the seed frame
      const facing = fx.toNumber(w.sim.state.facing[w.id]);
      // A full-power main-gun shot at t = 0, latched the way `onFire` does,
      // and read before `drainTimers` could age it: recoil pitch is exactly
      // `MESH_HULL_PITCH_RAD` (0.06 rad).
      w.priv.recoilT[w.id] = 1;
      w.priv.recoilPower[w.id] = 1;
      w.priv.recoilDir[w.id] = facing;
      w.priv.updateVehicleMeshes(1, FRAME_MS);
      const e = entityOf(w.priv, w.id);
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(e.root.quaternion);
      lifts.push(fwd.y);
      // ...and the hull still points where the sim says it points: game
      // (cos, sin) of the facing, which is world (X, Z).
      const a = 2 * Math.PI * facing;
      expect(new THREE.Vector3(fwd.x, 0, fwd.z).normalize().dot(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)))).toBeGreaterThan(
        0.99999
      );
    }
    for (const lift of lifts) expect(lift).toBeCloseTo(Math.sin(0.06), 9);
  });
});

describe('the roll sign, pinned in WORLD space', () => {
  // Task 2's `hullCornerOffsets(...).left` is the hull's PHYSICAL RIGHT (world
  // +Z at facing 0), and Tasks 2 and 3 agree that positive roll lowers the
  // corner they call `right`. The trap is the three.js composition: a
  // positive rotation about local +X lowers local +Z, so a natural "+roll
  // about the forward axis" tips the hull INTO the hillside. Neither
  // `|pitch| + |roll| > 1` nor `debugVehicleTransform.rollDeg` can see that,
  // because both read the angle back through the same convention that wrote
  // it. World-space heights of the two flanks cannot be fooled.
  for (const facingIn of [0, 0.25, 0.6]) {
    it(`drops the flank over ground that falls away, at facing ${facingIn}`, async () => {
      const facing0 = fx.toNumber(fx.from(facingIn));
      const a = 2 * Math.PI * facing0;
      // Ground rising toward `left` and FALLING toward `right`, one level a
      // tile, centred on the hull.
      const lx = -Math.sin(a);
      const ly = Math.cos(a);
      const elevation = grid((tx, ty) => Math.round(4.5 + ((tx + 0.5 - 12.5) * lx + (ty + 0.5 - 12.5) * ly)));
      const w = await world({ facing: facingIn, x: 12.5, y: 12.5, elevation });
      w.renderer.frame(1, FRAME_MS);
      const e = entityOf(w.priv, w.id);
      const facing = fx.toNumber(w.sim.state.facing[w.id]);
      const c = hullCornerOffsets(facing, HULL.x / 2, HULL.z / 2);

      // Precondition, from the grid itself: the ground a tile and a half out
      // on the `right` side really is lower than on the `left` side (the
      // corners themselves can share a rounded tile level).
      const px = e.root.position.x;
      const pz = e.root.position.z;
      const levelAt = (x: number, y: number): number => elevation[Math.floor(y) * MAP + Math.floor(x)];
      const k = 1.5 / (HULL.z / 2);
      expect(levelAt(px + c.rightX * k, pz + c.rightY * k)).toBeLessThan(levelAt(px + c.leftX * k, pz + c.leftY * k));

      const { minusZ, plusZ } = flanks(e);
      // The hull-local -Z flank is the one that lands over `right` in XZ...
      expect(Math.hypot(minusZ.x - (px + c.rightX), minusZ.z - (pz + c.rightY))).toBeLessThan(0.05);
      expect(Math.hypot(plusZ.x - (px + c.leftX), plusZ.z - (pz + c.leftY))).toBeLessThan(0.05);
      // ...and it is the LOWER one: the hull lies on the slope, not into it.
      expect(minusZ.y).toBeLessThan(plusZ.y - 0.05);
    });
  }

  // The flat-ground twin (R-L, amended at Task 3's review): body roll to the
  // OUTSIDE of a turn. An INCREASING heading swings the nose from game +x
  // toward game +y -- toward `hullCornerOffsets(...).left`, since that is
  // d(forward)/d(heading) -- which is world +Z at facing 0, the physical
  // RIGHT: a right-hand turn. Its outside is the physical left, the corner
  // `hullCornerOffsets` names `right`, hull-local -Z, and that is the flank
  // that must drop, the way sprung mass swings out on its suspension.
  it('drops the OUTSIDE flank in an increasing-heading turn at speed, on flat ground', async () => {
    const w = await world({ x: 6.5, y: 4.5, facing: 0 });
    moveTo(w, 6.5, 18.5); // due game +y: the hull turns 0 -> 0.25 while driving
    let last = fx.toNumber(w.sim.state.facing[w.id]);
    let increasing = true;
    for (let t = 0; t < 60; t++) {
      tickAndDraw(w);
      const f = fx.toNumber(w.sim.state.facing[w.id]);
      if (f < last) increasing = false;
      last = f;
      if (f >= 0.15) break;
    }
    expect(increasing).toBe(true);
    expect(last).toBeGreaterThanOrEqual(0.15); // mid-turn, not finished
    expect(last).toBeLessThan(0.25);
    const d = w.renderer.debugVehicleTransform(w.id);
    expect(d?.simSpeed).toBeGreaterThan(1); // at speed (a Lavi cruises at 1.1)

    const e = entityOf(w.priv, w.id);
    const { minusZ, plusZ } = flanks(e);
    expect(minusZ.y).toBeLessThan(plusZ.y - 0.002);
  });
});

describe('the ground is sampled at four corners, not one', () => {
  it('tilts a hull standing across a slope', async () => {
    // Ground two levels higher from x = 12 east: the hull's nose over it,
    // its tail not.
    const w = await world({ x: 11.9, y: 12.5, facing: 0, elevation: STEP_EAST() });
    w.renderer.frame(1, FRAME_MS);
    const t = w.renderer.debugVehicleTransform(w.id);
    expect(t).not.toBeNull();
    expect(Math.abs(t?.pitchDeg ?? 0) + Math.abs(t?.rollDeg ?? 0)).toBeGreaterThan(1);
    // And in the right direction: ground rising ahead lifts the nose.
    expect(t?.pitchDeg ?? 0).toBeGreaterThan(1);
  });

  it('leaves it flat on a map with no elevation grid', async () => {
    const w = await world({ facing: 0.4 });
    w.renderer.frame(1, FRAME_MS);
    const t = w.renderer.debugVehicleTransform(w.id);
    expect(t?.pitchDeg).toBe(0);
    expect(t?.rollDeg).toBe(0);
  });

  it('leaves it flat on a grid that is level everywhere, even above zero', async () => {
    const w = await world({ facing: 0.4, elevation: grid(() => 3) });
    w.renderer.frame(1, FRAME_MS);
    const t = w.renderer.debugVehicleTransform(w.id);
    expect(t?.pitchDeg).toBe(0);
    expect(t?.rollDeg).toBe(0);
  });

  it('skips the terrain half, rather than guessing, for a type with no measured footprint', async () => {
    const w = await world({ x: 11.9, y: 12.5, facing: 0, elevation: STEP_EAST() });
    w.priv.vehicleMeshBounds.delete('mbt_lavi');
    w.renderer.frame(1, FRAME_MS);
    const t = w.renderer.debugVehicleTransform(w.id);
    expect(t?.pitchDeg).toBe(0);
    expect(t?.rollDeg).toBe(0);
  });
});

describe('which vehicles get the weight model', () => {
  // Read off the params module's OWN list, which its own test pins to
  // `art/meshes/vehicles/*.glb` in both directions -- i.e. exactly the types
  // `loadVehicleMesh` can ever build a template for.
  it('is every shipped vehicle GLB bar the two that fly', () => {
    const air = VEHICLE_WEIGHT_IMPORTED_UNIT_IDS.filter((id) => isAirJson(unitJson(id))).sort();
    expect(air).toEqual(['heli_peten', 'paramotor']);
    // `moto_rpg` ships as an INFANTRY GLB, loaded through `loadMeshUnit`, so
    // it never reaches `updateVehicleMeshes` at all.
    expect(VEHICLE_WEIGHT_IMPORTED_UNIT_IDS).not.toContain('moto_rpg');
    expect(existsSync(path.join(REPO, 'art/meshes/moto_rpg.glb'))).toBe(true);
    expect(existsSync(path.join(REPO, 'art/meshes/vehicles/moto_rpg.glb'))).toBe(false);
  });

  for (const unitId of VEHICLE_WEIGHT_IMPORTED_UNIT_IDS) {
    it(`${unitId}: ${isAirJson(unitJson(unitId)) ? 'flies level over a slope' : 'stands on a slope'}`, async () => {
      const w = await world({ unitId, x: 11.9, y: 12.5, facing: 0, elevation: STEP_EAST() });
      w.renderer.frame(1, FRAME_MS);
      const t = w.renderer.debugVehicleTransform(w.id);
      expect(t).not.toBeNull();
      if (isAirJson(unitJson(unitId))) {
        // A helicopter conforming to the ground under it would be a bug with
        // a straight face.
        expect(t?.pitchDeg).toBe(0);
        expect(t?.rollDeg).toBe(0);
      } else {
        expect(t?.pitchDeg ?? 0).toBeGreaterThan(1);
      }
    });
  }

  // Rates come from the sim's own `UnitType` (`turnPerTick * SIM_HZ`), never
  // the JSON: `rocket_battery` authors no `turn_rate_deg_s` and the sim
  // defaults it, so a JSON read would hand the model `undefined` and the lean
  // would silently vanish. Swept over every ground vehicle, each turning at
  // its own authored (or defaulted) rate.
  for (const unitId of VEHICLE_WEIGHT_IMPORTED_UNIT_IDS.filter((id) => !isAirJson(unitJson(id)))) {
    it(`${unitId}: leans to the outside of its own turn, inside its own maximum`, async () => {
      const w = await world({ unitId, x: 6.5, y: 4.5, facing: 0 });
      moveTo(w, 6.5, 18.5);
      let peak = 0;
      let trough = 0;
      for (let t = 0; t < 60; t++) {
        tickAndDraw(w);
        const d = w.renderer.debugVehicleTransform(w.id);
        if (d) {
          peak = Math.max(peak, d.rollDeg);
          trough = Math.min(trough, d.rollDeg);
        }
        if (fx.toNumber(w.sim.state.facing[w.id]) >= 0.25) break;
      }
      const json = unitJson(unitId);
      const maxRollDeg = (vehicleWeightParamsFor(unitId, json.role ?? '').maxRollRad * 180) / Math.PI;
      expect(peak).toBeGreaterThan(0.05 * maxRollDeg);
      // STRICTLY under: the model's `yawRate / turnRate` clamp is a backstop,
      // and the smoothed yaw rate only approaches the unit's own turn rate.
      // Measured peaks run 0.449 (`rocket_battery`, whose 90-degree turn is
      // over in five ticks) to 0.994 (`dozer_d9`) of the maximum. A lean that
      // reaches its maximum EXACTLY is a rate in the wrong units -- the turn
      // rate per tick instead of per second saturates eight of these nine at
      // 1.0000.
      expect(peak).toBeLessThan(maxRollDeg);
      expect(trough).toBeGreaterThanOrEqual(0); // never into the turn
    });
  }
});

describe('the hull freezes at death (R-F)', () => {
  it("does not advance a dead vehicle's weight state", async () => {
    const w = await world({ x: 4.5, y: 6.5 });
    moveTo(w, 14.5, 6.5);
    for (let t = 0; t < 4; t++) tickAndDraw(w); // mid-launch: every piece of state is moving
    const before = w.renderer.debugVehicleTransform(w.id);
    expect(before).not.toBeNull();
    const a = w.priv.vehicleWeight;
    const slot = (): number[] => [a.smoothedSpeed, a.smoothedHeading, a.smoothedYawRate, a.lagX, a.lagY, a.settle, a.settleVel].map(
      (arr) => arr[w.id]
    );
    const frozen = slot();
    w.sim.debugKill(w.id);
    for (let t = 0; t < 10; t++) tickAndDraw(w);
    // Off the live loop entirely -- `updateVehicleMeshes` deletes the entity
    // from `vehicleMeshEntities` in the same frame `alive` goes to 0.
    expect(w.renderer.debugVehicleTransform(w.id)).toBeNull();
    expect(slot()).toEqual(frozen);
  });
});

describe('a hit-stop holds the weight exactly (dt = 0 passes straight through)', () => {
  it('advances nothing while the presentation clock is withheld, even as the sim ticks on', async () => {
    const w = await world({ x: 4.5, y: 6.5 });
    moveTo(w, 14.5, 6.5);
    for (let t = 0; t < 3; t++) tickAndDraw(w); // mid-launch: the ramp and the spring are both in flight
    const a = w.priv.vehicleWeight;
    const held = [a.smoothedSpeed[w.id], a.settle[w.id], a.settleVel[w.id]];
    const pitchBefore = w.renderer.debugVehicleTransform(w.id)?.pitchDeg;
    expect(Math.abs(pitchBefore ?? 0)).toBeGreaterThan(0.05); // really in flight
    w.priv.hitStop = { remainingMs: 10_000 };
    for (let t = 0; t < 4; t++) tickAndDraw(w);
    expect([a.smoothedSpeed[w.id], a.settle[w.id], a.settleVel[w.id]]).toEqual(held);
    expect(w.renderer.debugVehicleTransform(w.id)?.pitchDeg).toBe(pitchBefore);
  });
});

describe('the model is fed the INTERPOLATED position', () => {
  // The lag returns `trueX + lag`. Fed the tick-exact `curX`, every moving
  // hull would advance in 20 Hz steps -- 0.055 tiles on the first frame of
  // each tick and nothing on the other two, for a Lavi -- under a 60 fps
  // camera. Measured here as the spread of per-frame advances at cruise.
  it('advances a cruising hull evenly every frame, not once a tick', async () => {
    const w = await world({ x: 3.5, y: 6.5 });
    moveTo(w, 21.5, 6.5);
    for (let t = 0; t < 30; t++) tickAndDraw(w); // 1.5 s: at cruise, lag settled
    const steps: number[] = [];
    let last = entityOf(w.priv, w.id).root.position.x;
    for (let t = 0; t < 10; t++) {
      w.sim.tick();
      w.renderer.snapshot();
      for (let f = 1; f <= 3; f++) {
        w.renderer.frame(f / 3, FRAME_MS);
        const x = entityOf(w.priv, w.id).root.position.x;
        steps.push(x - last);
        last = x;
      }
    }
    const cruisePerFrame = 1.1 / 60; // tiles per 60 fps frame at the Lavi's cruise
    for (const s of steps) expect(s).toBeCloseTo(cruisePerFrame, 3);
  });
});

describe('the lag and the recoil shove share ONE budget (R-C, R-K)', () => {
  // Both write `root.position` in the same frame, so their SUM is what R-C
  // bounds, clamped once. The shipped tables keep the lag inside
  // `MAX_LAG_TILES` (0.25 minus the recoil's 0.16) and so never reach the
  // clamp; this hands the renderer a table that breaks that budget -- lag
  // 0.2 -- and fires the main gun forward, so the shove lands on the same
  // side as the lag: 0.2 + 0.16 = 0.36 unclamped.
  it('clamps the combined offset to exactly MAX_DRAWN_OFFSET_TILES', async () => {
    const w = await world({ x: 3.5, y: 6.5 });
    const params = vehicleWeightParamsFor('mbt_lavi', 'mbt');
    (w.renderer as unknown as { vehicleWeightParams: Map<string, typeof params> }).vehicleWeightParams.set('mbt_lavi', {
      ...params,
      lagTiles: 0.2,
    });
    moveTo(w, 21.5, 6.5);
    for (let t = 0; t < 40; t++) tickAndDraw(w); // two seconds at cruise: the lag has grown to ~0.2
    const facing = fx.toNumber(w.sim.state.facing[w.id]);
    w.priv.recoilT[w.id] = 1;
    w.priv.recoilPower[w.id] = 1;
    w.priv.recoilDir[w.id] = facing;
    w.priv.updateVehicleMeshes(1, FRAME_MS);
    const drawn = w.renderer.debugVehicleTransform(w.id);
    if (drawn === null) throw new Error('no drawn transform');
    const offset = Math.hypot(drawn.x - w.priv.curX[w.id], drawn.y - w.priv.curY[w.id]);
    expect(offset).toBeCloseTo(MAX_DRAWN_OFFSET_TILES, 9);
  });
});

describe('picking still reads the sim, not the drawing (R-C)', () => {
  it('hits the same entity while the hull is lagged, and the lag stays inside the budget', async () => {
    const w = await world({ x: 4.5, y: 6.5 });
    moveTo(w, 20.5, 6.5);
    for (let t = 0; t < 20; t++) tickAndDraw(w); // a second at cruise
    w.sim.tick();
    w.renderer.snapshot();
    const alpha = 0.5;
    w.renderer.frame(alpha, FRAME_MS);
    const drawn = w.renderer.debugVehicleTransform(w.id);
    if (drawn === null) throw new Error('no drawn transform');

    // R-C's bound is measured against the INTERPOLATED position the model is
    // fed -- interpolation alone already sits up to `speed / SIM_HZ` behind
    // the sim's `posX`, which picking has always read.
    const ix = w.priv.prevX[w.id] + (w.priv.curX[w.id] - w.priv.prevX[w.id]) * alpha;
    const iy = w.priv.prevY[w.id] + (w.priv.curY[w.id] - w.priv.prevY[w.id]) * alpha;
    const offset = Math.hypot(drawn.x - ix, drawn.y - iy);
    expect(offset).toBeGreaterThan(0.02); // the lag is really there...
    expect(offset).toBeLessThanOrEqual(MAX_DRAWN_OFFSET_TILES); // ...and inside R-C
    expect(drawn.x - ix).toBeLessThan(0); // ...and it TRAILS: the hull drives +x

    // A click on what the player sees, and a click on the sim's own truth.
    expect(w.renderer.pickUnit(drawn.x, drawn.y)).toBe(w.id);
    expect(w.renderer.pickUnit(fx.toNumber(w.sim.state.posX[w.id]), fx.toNumber(w.sim.state.posY[w.id]))).toBe(w.id);
  });
});
