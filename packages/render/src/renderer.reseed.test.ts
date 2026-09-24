/**
 * `PixiRenderer.reseed()` -- `Renderer.reseed` (`./api.ts`) on the Pixi
 * backend, reached through the `Renderer` type the app holds.
 *
 * `renderer.ts` is frozen, and this is the one method the freeze was lifted
 * for: `class PixiRenderer implements Renderer` stops compiling the moment
 * the interface requires `reseed()`, and no subclass in `pixi.ts` can clear
 * an error raised on the frozen class's own `implements` clause.
 *
 * The constructor runs headless; `init()` does not (`Application.init` wants
 * a WebGL context). So the test stands in for exactly the sim-derived half
 * of `init()` -- the fog grid it allocates and the two `snapshot()` calls it
 * ends with -- then replays the mission order: spawn after init, reseed, and
 * read what the first frame would. Every test past the premise was watched
 * going red with the `reseed()` call removed (recorded in the commit body).
 */
import { describe, it, expect } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { Renderer, RendererOptions, TerrainTones } from './api';
import { PixiRenderer } from './renderer';

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

const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 6, signature: 1 },
};

const W = 24;
const H = 24;
const SPAWN_X = 15.5;
const SPAWN_Y = 17.5;
/** A quarter turn: non-zero, so a turret left at its zero-fill is caught. */
const FACING = 0.25;

/** The private state the assertions read; `isVisible` is public. */
interface Private {
  fog: Uint8Array;
  prevX: Float64Array;
  prevY: Float64Array;
  curX: Float64Array;
  curY: Float64Array;
  entitySpeed: Float64Array;
  turretFacing: Float64Array;
  terrainDirty: boolean;
}

function missionPathBeforeReseed(): { renderer: Renderer; priv: Private; unit: number } {
  const sim = new Sim({ seed: 1, width: W, height: H, capacity: 8 });
  const tank = sim.addUnitType(TANK);
  const pixi = new PixiRenderer(sim, makeOpts());
  // The app holds a `Renderer`, never the backend -- so does this test.
  const renderer: Renderer = pixi;
  const priv = pixi as unknown as Private;
  // `init()`'s sim-derived half, on a sim with no units in it yet: the fog
  // grid it allocates, then "this.snapshot(); this.snapshot(); // prev ==
  // cur on the first frame".
  priv.fog = new Uint8Array(W * H);
  renderer.snapshot();
  renderer.snapshot();
  // `runtime.start()`.
  const unit = sim.spawn(tank, 0, fx.from(SPAWN_X), fx.from(SPAWN_Y), fx.from(FACING));
  return { renderer, priv, unit };
}

describe('PixiRenderer.reseed, through the Renderer type', () => {
  it('premise: without a reseed the first frame reads the empty sim init() saw', () => {
    const { renderer, priv, unit } = missionPathBeforeReseed();
    expect([priv.prevX[unit], priv.prevY[unit]]).toEqual([0, 0]);
    expect(renderer.isVisible(SPAWN_X, SPAWN_Y)).toBe(false);
    expect(priv.turretFacing[unit]).toBe(0);
  });

  it('draws the force where it spawned, still, turret seeded to the hull', () => {
    const { renderer, priv, unit } = missionPathBeforeReseed();
    renderer.reseed();
    expect([priv.prevX[unit], priv.prevY[unit]]).toEqual([SPAWN_X, SPAWN_Y]);
    expect([priv.curX[unit], priv.curY[unit]]).toEqual([SPAWN_X, SPAWN_Y]);
    expect(priv.entitySpeed[unit]).toBe(0);
    expect(priv.turretFacing[unit]).toBe(FACING);
  });

  it('computes the fog from the force now, not on the next 5 Hz refresh', () => {
    const { renderer } = missionPathBeforeReseed();
    renderer.reseed();
    expect(renderer.isVisible(SPAWN_X, SPAWN_Y)).toBe(true);
  });

  it('redraws the terrain, and the structures drawn in it, on the next frame', () => {
    // `init()` draws the terrain directly; a mission's own structures arrive
    // after it. Stand in for that draw having consumed the flag.
    const { renderer, priv } = missionPathBeforeReseed();
    priv.terrainDirty = false;
    renderer.reseed();
    expect(priv.terrainDirty).toBe(true);
  });
});
