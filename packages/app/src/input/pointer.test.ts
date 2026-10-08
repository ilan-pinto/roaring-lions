/**
 * The pointer read from a fixed SCREEN pixel, through the real dimetric
 * camera, on the tutorial's own ground (WP-P4). No browser: the projection
 * is `three-camera`'s, the world is a real `Sim` with the map's buildings
 * stood the way `bootBattlefield` stands them, and the read is the one
 * `main.ts`'s hover and click both call (`pointerPoint` + `cursorAt`).
 *
 * PA-08: over an enemy the cursor said `attack`, but the click is an
 * attack-move to the tile and the sim picks the target. It says `advance`.
 *
 * PA-14: a right-click on the house's upper wall read `move` and sent the
 * squad to the ground hidden behind the house (audit play-40, tutorial
 * beat 7, which took two clicks). It resolves to the house.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx } from '@lions/sim';
import { applyTerrain, maps, parseMap, units } from '@lions/data';
import {
  WORLD_Y_PER_LIFT_PIXEL,
  screenToWorldThree,
  structureAtScreenThree,
  structureBoxes,
  worldToScreenThree,
  type DrawnSize,
} from '@lions/render/three-camera';
import type { Camera, Viewport } from '@lions/render/project';
import { standMapStructures } from '../map-sim';
import { cursorAt, pointerPoint, simIntentWorld, type PointerView } from './pointer';

const VP: Viewport = { width: 1440, height: 900 };
const CENTRE = { x: VP.width / 2, y: VP.height / 2 };

/** The shipped house mesh's measured size (`units/collapse-shroud.ts`'s table,
 *  read off the loaded template): what the renderer's box is built from. */
const HOUSE_MESH: DrawnSize = { width: 4.264, height: 4.237, depth: 3.712 };

function world() {
  const map = parseMap(maps.tutorial_ground);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 64 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
  const spawn = (id: string, side: number, x: number, y: number): number =>
    sim.spawn(typeOf.get(id) as number, side, fx.from(x), fx.from(y));
  const [hx, hy] = map.markers.the_house;
  const house = sim.structureAt(hx, hy);
  expect(sim.structureTypes[sim.structures.typeIdx[house]].id).toBe('house');
  return { map, sim, spawn, house };
}

/** The renderer's three questions, answered by the real projection. */
function viewOf(sim: Sim, cam: Camera): PointerView {
  const st = sim.structures;
  const drawn = (s: number): DrawnSize =>
    sim.structureTypes[st.typeIdx[s]].id === 'house'
      ? {
          width: Math.max(HOUSE_MESH.width, st.maxX[s] - st.minX[s] + 1),
          height: HOUSE_MESH.height,
          depth: Math.max(HOUSE_MESH.depth, st.maxY[s] - st.minY[s] + 1),
        }
      : {
          width: st.maxX[s] - st.minX[s] + 1,
          height: sim.structureTypes[st.typeIdx[s]].heightPx * WORLD_Y_PER_LIFT_PIXEL,
          depth: st.maxY[s] - st.minY[s] + 1,
        };
  return {
    screenToWorld: (px, py) => screenToWorldThree(px, py, cam, VP),
    structureAtScreen: (px, py) => structureAtScreenThree(px, py, cam, VP, structureBoxes(sim, null, drawn)),
    isVisible: () => true,
  };
}

const read = (sim: Sim, cam: Camera, ids: number[], px: number, py: number) => {
  const view = viewOf(sim, cam);
  const p = pointerPoint(view, sim, px, py);
  const c = cursorAt(sim, simIntentWorld(sim, () => false), p, { ids, armed: null, confirm: false, armedSmoke: false });
  return { p, ...c };
};

describe('PA-08: the cursor over an enemy says what the click does', () => {
  it('reads advance, and the click it predicts is an attack-move to that tile', () => {
    const { sim, spawn } = world();
    const squad = spawn('inf_squad', 0, 11.5, 24.5);
    const militia = spawn('militia_cell', 1, 26.5, 24.5); // `contact_open`
    // The camera on the militia: the enemy sits at the screen's centre pixel.
    const cam: Camera = { x: fx.toNumber(sim.state.posX[militia]), y: fx.toNumber(sim.state.posY[militia]), zoom: 1 };
    const r = read(sim, cam, [squad], CENTRE.x, CENTRE.y);

    expect(r.p.hostile).toBe(militia);
    expect(r.key).toBe('advance-soft');
    expect(r.key.startsWith('attack')).toBe(false);
    // What the click will issue, from the same resolution: one attack-move to
    // the point, no targeted order naming the militia.
    expect(r.res.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [squad], x: r.p.x, y: r.p.y, append: false },
    ]);
  });
});

describe('PA-14: a click on the house wall is a click on the house', () => {
  /** The house's camera-facing wall (+z, the camera sits towards +x,+z), at
   *  `frac` of its height, mid-span -- as a pixel. */
  function wallPixel(sim: Sim, house: number, cam: Camera, frac: number) {
    const st = sim.structures;
    const cx = (st.minX[house] + st.maxX[house] + 1) / 2;
    const cz = (st.minY[house] + st.maxY[house] + 1) / 2;
    const nearZ = cz + Math.max(HOUSE_MESH.depth, st.maxY[house] - st.minY[house] + 1) / 2;
    return worldToScreenThree(cx, nearZ, cam, VP, (frac * HOUSE_MESH.height) / WORLD_Y_PER_LIFT_PIXEL);
  }

  it('the defect: the ground under that pixel is behind the house, off its footprint', () => {
    const { sim, house } = world();
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const px = wallPixel(sim, house, cam, 0.8);
    const g = screenToWorldThree(px.x, px.y, cam, VP);
    expect(sim.structureAt(Math.floor(g.x), Math.floor(g.y))).toBe(-1);
    expect(g.x + g.y).toBeLessThan(sim.structures.minX[house] + sim.structures.minY[house]);
  });

  it('infantry selected: the cursor reads garrison and the click garrisons that house', () => {
    const { sim, spawn, house } = world();
    const squad = spawn('inf_squad', 0, 25.5, 21.5);
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const px = wallPixel(sim, house, cam, 0.8);
    const r = read(sim, cam, [squad], px.x, px.y);
    expect(r.p.facade).toBe(house);
    expect(r.key).toBe('garrison-soft');
    expect(r.res.intents).toEqual([{ kind: 'garrison', ids: [squad], structure: house }]);
  });

  it('a vehicle selected: the cursor names the house, not open ground', () => {
    const { sim, spawn, house } = world();
    const jeep = spawn('jeep_shoded', 0, 25.5, 21.5);
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const px = wallPixel(sim, house, cam, 0.8);
    const r = read(sim, cam, [jeep], px.x, px.y);
    expect(r.p.facade).toBe(house);
    // The house carries an ROE penalty, so the cursor says what the click
    // costs -- the same reading the footprint itself gives.
    expect(r.name).toBe('costly');
    const onFootprint = read(sim, cam, [jeep], ...Object.values(worldToScreenThree(24.5, 15.5, cam, VP)) as [number, number]);
    expect(onFootprint.name).toBe(r.name);
  });

  it('leaves the street in front of the house alone', () => {
    const { sim, spawn, house } = world();
    const squad = spawn('inf_squad', 0, 25.5, 21.5);
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const street = worldToScreenThree(25, 20.5, cam, VP);
    const r = read(sim, cam, [squad], street.x, street.y);
    expect(r.p.facade).toBe(-1);
    expect(r.key).toBe('move-soft');
    expect(house).toBeGreaterThanOrEqual(0);
  });

  it('an enemy whose ground point the pixel reaches still wins over the wall', () => {
    const { sim, spawn, house } = world();
    const squad = spawn('inf_squad', 0, 25.5, 21.5);
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const px = wallPixel(sim, house, cam, 0.8);
    const g = screenToWorldThree(px.x, px.y, cam, VP);
    const hidden = spawn('militia_cell', 1, g.x, g.y);
    const r = read(sim, cam, [squad], px.x, px.y);
    expect(r.p.hostile).toBe(hidden);
    expect(r.p.facade).toBe(-1);
    expect(r.name).toBe('advance');
    expect(house).toBeGreaterThanOrEqual(0);
  });
});

describe('K-08: the pointer over ground nobody can enter', () => {
  /** The tutorial ground has no free-standing rock, so make one: a ridge tile
   *  is just a nonzero cell in the sim's own `blocked` mask, which is exactly
   *  what `cursorAt` and `simIntentWorld` read. */
  function rockTile(sim: Sim): { x: number; y: number } {
    const x = 14;
    const y = 24;
    expect(sim.structureAt(x, y)).toBe(-1);
    sim.blocked[y * sim.width + x] = 1;
    return { x, y };
  }

  it('a rock tile: the click is refused and the cursor reads blocked', () => {
    const { sim, spawn } = world();
    const squad = spawn('inf_squad', 0, 11.5, 24.5);
    const r = rockTile(sim);
    const cam: Camera = { x: r.x + 0.5, y: r.y + 0.5, zoom: 1 };
    const out = read(sim, cam, [squad], CENTRE.x, CENTRE.y);
    expect(out.res.intents).toEqual([]);
    expect(out.res.marker).toBe(false);
    expect(out.res.groundRefused).toBe('blocked');
    expect(out.name).toBe('blocked');
  });

  it('past the map edge: refused too, where the cursor used to read move', () => {
    const { sim, spawn } = world();
    const squad = spawn('inf_squad', 0, 11.5, 24.5);
    const cam: Camera = { x: -6, y: -6, zoom: 1 };
    const out = read(sim, cam, [squad], CENTRE.x, CENTRE.y);
    expect(out.res.groundRefused).toBe('offmap');
    expect(out.res.marker).toBe(false);
    expect(out.name).toBe('blocked');
  });

  it('a drone selected: the same rock is a fine place to fly to', () => {
    const { sim, spawn } = world();
    const drone = spawn('recon_drone', 0, 11.5, 24.5);
    const r = rockTile(sim);
    const cam: Camera = { x: r.x + 0.5, y: r.y + 0.5, zoom: 1 };
    const out = read(sim, cam, [drone], CENTRE.x, CENTRE.y);
    expect(out.res.groundRefused).toBeUndefined();
    expect(out.res.marker).toBe(true);
  });
});
