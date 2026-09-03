/**
 * The queued-route overlay: the path the player drew with Shift, drawn.
 *
 * GH-154. Shift+right-click has queued waypoints in the sim since `98f435e`
 * on both backends -- `main.ts` passes `append: ev.shiftKey`, the sim's
 * `move` branch pushes onto `wpX/wpY` while the unit is under way, and the
 * unit card reads "moving · 1 waypoint" -- but only `PixiRenderer` ever DREW
 * the route (`renderer.ts:2533`, "Queued route for the selection: the path
 * you drew, in order"). When `orderMarkers` graduated into this backend in
 * Phase C, the route block beside it did not, so on the default renderer a
 * Shift-queued path was real and invisible: reproduced on
 * `?sandbox=beit_sahwan_outskirts` by driving the pointer, `moving: 1`,
 * `waypointCount: 1`, nothing on screen between the unit and either point.
 *
 * Pinned through the REAL `updateOverlays`, not a pure helper alone: the
 * defect was precisely that the sim had the answer and the overlay pass
 * never asked for it. `lineWorld` is the primitive a route leg needs (two
 * independent world points, the engagement duel line's own case), and in a
 * scene with no enemy nothing else calls it, so its call list IS the route.
 *
 * Harness copied from `ThreeRenderer.vehicle-mesh-anim.test.ts`: a faked
 * `WebGLRenderer`, and `renderer.snapshot()` driving the interpolation
 * buffers the way `frame()` reads them.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { OverlayBatch } from './units/overlays';

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
  crownRatio: 0.52, scatter: 'stone',
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

/** A vehicle, because a vehicle is what the lead was steering when the route
 *  vanished, and because `dozer_d9` is a real key in every closed table this
 *  backend consults (`vehicle-mesh-role.ts`). Nothing here demolishes. */
const DOZER: UnitTypeJson = {
  id: 'dozer_d9',
  role: 'engineer',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

interface ThreeRendererPrivates {
  overlayBatch: OverlayBatch;
  updateOverlays(alpha: number): void;
}

const GOAL: [number, number] = [18.5, 11.5];
const WAYPOINT: [number, number] = [18.5, 19.5];

/** One unit at (9.5, 11.5), ordered to GOAL, then -- once rolling, which is
 *  the sim's own precondition for `append` to QUEUE rather than replace --
 *  Shift-ordered to WAYPOINT. Asserted, not assumed: the route exists in the
 *  sim before the renderer is asked to draw it. */
function setUp() {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const typeIdx = sim.addUnitType(DOZER);
  const id = sim.spawn(typeIdx, 0, fx.from(9.5), fx.from(11.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ThreeRendererPrivates;

  sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(GOAL[0]), y: fx.from(GOAL[1]) });
  for (let t = 0; t < 3; t++) sim.tick();
  expect(sim.state.moving[id]).toBe(1);
  sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(WAYPOINT[0]), y: fx.from(WAYPOINT[1]), append: true });
  sim.tick();
  expect(sim.waypointCount(id)).toBe(1);

  renderer.snapshot();
  renderer.snapshot();
  const lineWorld = vi.spyOn(priv.overlayBatch, 'lineWorld');
  return { sim, renderer, priv, id, lineWorld };
}

/** The (x, z) of a `lineWorld` endpoint -- world X is tile x, world Z is
 *  tile y; the middle component is that point's own ground height. */
const xz = (p: readonly [number, number, number]): [number, number] => [p[0], p[2]];

describe('queued route overlay (GH-154)', () => {
  it('draws one leg per segment of the selected unit\'s route: position -> goal -> each queued waypoint, in order', () => {
    const { renderer, priv, id, lineWorld } = setUp();
    renderer.selection = [id];
    priv.updateOverlays(1);

    expect(lineWorld).toHaveBeenCalledTimes(2);
    const [leg0, leg1] = lineWorld.mock.calls;
    // Leg 0 starts where the unit IS this frame (somewhere between its
    // spawn and the goal, on the goal's own row) and ends at the goal.
    const [sx, sy] = xz(leg0[0]);
    expect(sx).toBeGreaterThan(9.5);
    expect(sx).toBeLessThan(GOAL[0]);
    expect(sy).toBeCloseTo(11.5, 3);
    expect(xz(leg0[1])).toEqual(GOAL);
    // Leg 1 is goal -> the Shift-queued point.
    expect(xz(leg1[0])).toEqual(GOAL);
    expect(xz(leg1[1])).toEqual(WAYPOINT);
  });

  it('draws nothing for a unit that is not selected -- the route is a selection readout, like Pixi\'s', () => {
    const { renderer, priv, lineWorld } = setUp();
    renderer.selection = [];
    priv.updateOverlays(1);
    expect(lineWorld).not.toHaveBeenCalled();
  });

  it('draws nothing once the unit has halted, whatever its queue says -- Pixi\'s own `moving === 0` skip', () => {
    const { sim, renderer, priv, id, lineWorld } = setUp();
    sim.queueCommand({ kind: 'halt', ids: [id] });
    sim.tick();
    expect(sim.state.moving[id]).toBe(0);
    renderer.snapshot();
    renderer.selection = [id];
    priv.updateOverlays(1);
    expect(lineWorld).not.toHaveBeenCalled();
  });
});
