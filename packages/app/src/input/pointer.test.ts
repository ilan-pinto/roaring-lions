/**
 * The pointer read from a fixed SCREEN pixel, through the real dimetric
 * camera, on the tutorial's own ground (WP-P4). No browser: the projection
 * is `three-camera`'s, the world is a real `Sim` with the map's buildings
 * stood the way `bootBattlefield` stands them, and the read is the one
 * `main.ts`'s hover and click both call (`pointerPoint` + `cursorAt`).
 *
 * PA-08 / GH-420: over an enemy the cursor said `attack` when the click was
 * an attack-move to the tile. It said `advance` until the targeted order
 * (`attack` intent): now an identified enemy someone selected can hurt reads
 * `attack` and the click fires on THAT unit, while a suspected contact still
 * reads `advance` and still attack-moves.
 *
 * PA-14: a right-click on the house's upper wall read `move` and sent the
 * squad to the ground hidden behind the house (audit play-40, tutorial
 * beat 7, which took two clicks). It resolves to the house.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx, type Command } from '@lions/sim';
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
// The renderer's own pure body pick, not a stand-in: its radius is the thing
// R-23 pins, and a stand-in with its own geometry is how I-1 and I-2 hid.
import { pickUnitAtScreen } from '../../../render/src/three/units/pick';
import { standMapStructures } from '../map-sim';
import { ORDER_PICK_RADIUS_TILES, cursorAt, pointerPoint, simIntentWorld, type PointerView } from './pointer';
import { callRally } from './rally-call';

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

/** Every unit's drawn position, as the renderer holds it (`curX`/`curY`). */
function drawnAt(sim: Sim): { curX: Float64Array; curY: Float64Array } {
  const curX = new Float64Array(sim.entityCount);
  const curY = new Float64Array(sim.entityCount);
  for (let i = 0; i < sim.entityCount; i++) {
    curX[i] = fx.toNumber(sim.state.posX[i]);
    curY[i] = fx.toNumber(sim.state.posY[i]);
  }
  return { curX, curY };
}

/** `Renderer.unitAtScreen` on flat ground: the shipped pure pick, every unit
 *  pickable (single player). `radiusTiles` absent is the left-click's own. */
function pickAt(sim: Sim, cam: Camera, px: number, py: number, radiusTiles?: number): number {
  const { curX, curY } = drawnAt(sim);
  const { alive, tunnelIn } = sim.state;
  return pickUnitAtScreen(px, py, curX, curY, alive, tunnelIn, sim.entityCount, null, sim.width, sim.height, cam, VP, () => true, radiusTiles);
}

/** The renderer's questions, answered by the real projection and the real pick. */
function viewOf(sim: Sim, cam: Camera, viewer = 0, visible: (x: number, y: number) => boolean = () => true): PointerView {
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
    isVisible: visible,
    // The renderer's body pick (#534), ANY side, at the radius `pointerPoint`
    // asks for. The enemy filter under test is `pointerPoint`'s, not this.
    unitAtScreen: (px, py, radiusTiles) => pickAt(sim, cam, px, py, radiusTiles),
    viewer,
  };
}

const read = (sim: Sim, cam: Camera, ids: number[], px: number, py: number) => {
  const view = viewOf(sim, cam);
  const p = pointerPoint(view, sim, px, py);
  const c = cursorAt(sim, simIntentWorld(sim, () => false), p, { ids, armed: null, confirm: false, armedSmoke: false });
  return { p, ...c };
};

describe('PA-08 / GH-420: the cursor over an enemy says what the click does', () => {
  /** A rifle squad and a militia cell, the camera on the militia so it is the
   *  screen's centre pixel. `identified` reveals the militia to side 0 through
   *  the sim's own path; otherwise it is only a suspected contact. */
  function setup(identified: boolean) {
    const { sim, spawn } = world();
    const squad = spawn('inf_squad', 0, 11.5, 24.5);
    const militia = spawn('militia_cell', 1, 26.5, 24.5); // `contact_open`
    if (identified) sim.identifyTo(0, militia);
    const cam: Camera = { x: fx.toNumber(sim.state.posX[militia]), y: fx.toNumber(sim.state.posY[militia]), zoom: 1 };
    return { sim, squad, militia, cam, spawn };
  }

  it('an identified enemy a selected unit can hurt reads attack-soft, and the click is one attack naming it', () => {
    const { sim, squad, militia, cam } = setup(true);
    const r = read(sim, cam, [squad], CENTRE.x, CENTRE.y);

    expect(r.p.hostile).toBe(militia);
    expect(r.key).toBe('attack-soft');
    // What the click will issue, from the same resolution: ONE targeted order
    // naming the militia, and no attack-move beside it (the squad can hurt it).
    expect(r.res.intents).toEqual([{ kind: 'attack', ids: [squad], target: militia }]);
  });

  it('a suspected contact keeps advance-soft and the attack-move to its tile', () => {
    const { sim, squad, militia, cam } = setup(false);
    const r = read(sim, cam, [squad], CENTRE.x, CENTRE.y);

    expect(r.p.hostile).toBe(militia);
    expect(r.key).toBe('advance-soft');
    expect(r.res.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [squad], x: r.p.x, y: r.p.y, append: false },
    ]);
    // The order goes to the picked body's own position, not the ground behind it.
    expect(r.p.x).toBeCloseTo(26.5, 5);
    expect(r.p.y).toBeCloseTo(24.5, 5);
  });

  it('an identified enemy nobody selected can aim at falls back to the attack-move', () => {
    const { sim, spawn, cam, militia } = setup(true);
    const manpad = spawn('manpad_team', 0, 11.5, 24.4); // anti-air only, no ground weapon
    const r = read(sim, cam, [manpad], CENTRE.x, CENTRE.y);
    expect(sim.canFocus(manpad, militia)).toBe(false);
    expect(r.name).toBe('advance');
    expect(r.res.intents.map((i) => i.kind)).toEqual(['order']);
  });

  it('an identified armoured target nothing selected can penetrate is refused, with a reason', () => {
    const { sim, spawn } = setup(true);
    const squad = spawn('inf_squad', 0, 11.5, 24.6);
    const tank = spawn('mbt_lavi', 1, 20.5, 18.5);
    sim.identifyTo(0, tank);
    const camOnTank: Camera = { x: 20.5, y: 18.5, zoom: 1 };
    expect(sim.canFocus(squad, tank)).toBe(true);
    expect(sim.focusHurts(squad, tank)).toBe(false);
    const view = viewOf(sim, camOnTank);
    const p = pointerPoint(view, sim, CENTRE.x, CENTRE.y);
    expect(p.hostile).toBe(tank);
    const c = cursorAt(sim, simIntentWorld(sim, () => false), p, { ids: [squad], armed: null, confirm: false, armedSmoke: false });
    expect(c.res.cantPenetrate).toBe(true);
    expect(c.res.intents).toEqual([]);
    expect(c.res.note?.text).toBe("Can't penetrate: nothing selected can hurt that armour");
    // R-17: the dim X (K-08's look), not `protected` ("hold Alt").
    expect(c.name).toBe('blocked');
  });

  it('R-20: simIntentWorld reads a unit inside a building as garrisoned (the test H uses)', () => {
    const { sim, squad } = setup(true);
    const w = simIntentWorld(sim, () => false);
    expect(w.garrisoned(squad)).toBe(false);
    sim.state.garrisonedIn[squad] = 0;
    expect(w.garrisoned(squad)).toBe(true);
  });

  it('I1: a wholly pinned squad over a focusable enemy reads pinned, with the hint set', () => {
    const { sim, squad, cam } = setup(true);
    sim.state.pinned[squad] = 1;
    const r = read(sim, cam, [squad], CENTRE.x, CENTRE.y);
    expect(r.res.intents.map((i) => i.kind)).toEqual(['attack']);
    expect(r.hints.pinned).toBe(true);
    expect(r.name).toBe('pinned');
    sim.state.pinned[squad] = 0;
    expect(read(sim, cam, [squad], CENTRE.x, CENTRE.y).name).toBe('attack');
  });

  it('R-18: the picked enemy\'s tile reaches the resolver; the click\'s point stays the ground point', () => {
    const { sim, spawn, squad, militia, cam } = setup(true);
    const manpad = spawn('manpad_team', 0, 11.5, 24.4); // cannot aim at ground: the remainder
    const view = viewOf(sim, cam);
    const px = CENTRE.x + 8;
    const py = CENTRE.y + 8;
    const p = pointerPoint(view, sim, px, py);
    expect(p.hostile).toBe(militia);
    expect(p.hostileAt?.x).toBeCloseTo(26.5, 5);
    expect(p.hostileAt?.y).toBeCloseTo(24.5, 5);
    // x/y is where the pixel meets the ground, NOT the enemy.
    expect(p.x).toBeCloseTo(p.ground.x, 9);
    expect(Math.hypot(p.x - 26.5, p.y - 24.5)).toBeGreaterThan(0.05);
    const c = cursorAt(sim, simIntentWorld(sim, () => false), p, { ids: [squad, manpad], armed: null, confirm: false, armedSmoke: false });
    expect(c.res.intents).toEqual([
      { kind: 'attack', ids: [squad], target: militia },
      { kind: 'order', verb: 'attackMove', ids: [manpad], x: p.hostileAt?.x, y: p.hostileAt?.y, append: false },
    ]);
  });
});

/** The house's camera-facing wall (+z, the camera sits towards +x,+z), at
 *  `frac` of its height, mid-span -- as a pixel. */
function wallPixel(sim: Sim, house: number, cam: Camera, frac: number) {
  const st = sim.structures;
  const cx = (st.minX[house] + st.maxX[house] + 1) / 2;
  const cz = (st.minY[house] + st.maxY[house] + 1) / 2;
  const nearZ = cz + Math.max(HOUSE_MESH.depth, st.maxY[house] - st.minY[house] + 1) / 2;
  return worldToScreenThree(cx, nearZ, cam, VP, (frac * HOUSE_MESH.height) / WORLD_Y_PER_LIFT_PIXEL);
}

describe('PA-14: a click on the house wall is a click on the house', () => {
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

  // R-24: an enemy the pixel reaches no longer switches the wall off. It
  // travels as `hostile`, and the hostile rung (before the structure rung)
  // decides: an enemy someone can focus wins, one nobody can leaves the click
  // the building's. Before R-24 any pick kept the ground point, which here is
  // the hidden ground behind the house.
  it('an enemy the pixel reaches behind the wall that someone can focus still wins over it', () => {
    const { sim, spawn, house } = world();
    const squad = spawn('inf_squad', 0, 25.5, 21.5);
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const px = wallPixel(sim, house, cam, 0.8);
    const g = screenToWorldThree(px.x, px.y, cam, VP);
    const hidden = spawn('militia_cell', 1, g.x, g.y);
    sim.identifyTo(0, hidden);
    const r = read(sim, cam, [squad], px.x, px.y);
    expect(r.p.hostile).toBe(hidden);
    expect(r.p.facade).toBe(house);
    expect(r.name).toBe('attack');
    expect(r.res.intents).toEqual([{ kind: 'attack', ids: [squad], target: hidden }]);
  });

  it('R-24: one nobody can focus (a suspected contact) leaves the click the house\'s', () => {
    const { sim, spawn, house } = world();
    const squad = spawn('inf_squad', 0, 25.5, 21.5);
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const px = wallPixel(sim, house, cam, 0.8);
    const g = screenToWorldThree(px.x, px.y, cam, VP);
    const hidden = spawn('militia_cell', 1, g.x, g.y);
    const r = read(sim, cam, [squad], px.x, px.y);
    expect(r.p.hostile).toBe(hidden);
    expect(r.p.facade).toBe(house);
    expect(r.key).toBe('garrison-soft');
    expect(r.res.intents).toEqual([{ kind: 'garrison', ids: [squad], structure: house }]);
  });
});

describe('R-24: a suspected enemy at the foot of the wall does not move the click behind the house', () => {
  /** The final review's I-1 probe at the order radius: the militia stands at
   *  the house's camera-facing wall, mid-span, and the click is on the wall a
   *  quarter of a tile above its head (20% of the wall's height; the body is
   *  0.6 tile). Its drawn body is within half a tile of that pixel, so the
   *  order pick names it. */
  function atTheWall(identified: boolean) {
    const { sim, spawn, house } = world();
    const squad = spawn('inf_squad', 0, 25.5, 21.5);
    const militia = spawn('militia_cell', 1, 25, 17.9);
    if (identified) sim.identifyTo(0, militia);
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const px = wallPixel(sim, house, cam, 0.2);
    // The defect's ground: off the footprint, behind the wall.
    const g = screenToWorldThree(px.x, px.y, cam, VP);
    expect(sim.structureAt(Math.floor(g.x), Math.floor(g.y))).toBe(-1);
    return { sim, squad, militia, house, cam, px, r: read(sim, cam, [squad], px.x, px.y) };
  }

  it('suspected: the pick names it and the click still garrisons the house', () => {
    const { militia, house, squad, r } = atTheWall(false);
    expect(r.p.hostile).toBe(militia);
    // What the click does first: before R-24 this was an attack-move to the
    // hidden ground behind the house.
    expect(r.res.intents).toEqual([{ kind: 'garrison', ids: [squad], structure: house }]);
    expect(r.key).toBe('garrison-soft');
    expect(r.p.facade).toBe(house);
  });

  it('with no enemy there the same pixel reads the same (the pick changes nothing)', () => {
    const { sim, militia, squad, cam, px, r } = atTheWall(false);
    sim.debugKill(militia);
    const without = read(sim, cam, [squad], px.x, px.y);
    expect(without.p.hostile).toBe(-1);
    expect(without.res).toEqual(r.res);
  });

  it('identified: the squad fires on it (the hostile rung precedes the structure rung)', () => {
    const { militia, house, squad, r } = atTheWall(true);
    expect(r.p.facade).toBe(house);
    expect(r.name).toBe('attack');
    expect(r.res.intents).toEqual([{ kind: 'attack', ids: [squad], target: militia }]);
  });
});

describe('R-23: an order picks an enemy within half a tile of its drawn body', () => {
  /** The final review's I-2 probe: an identified militia in the open, a rifle
   *  squad selected, the camera on the militia. */
  function open() {
    const { sim, spawn } = world();
    const squad = spawn('inf_squad', 0, 11.5, 24.5);
    const militia = spawn('militia_cell', 1, 20.5, 24.5);
    sim.identifyTo(0, militia);
    const cam: Camera = { x: 20.5, y: 24.5, zoom: 1 };
    return { sim, squad, militia, cam };
  }
  /** Ground offsets, in tiles, that the 1.2-tile body pick turned into `attack`
   *  (the review measured every one of them `attack-soft`). */
  const NEAR: [number, number][] = [
    [0.6, 0],
    [0.9, 0],
    [1.1, 0],
    [0, 0.9],
    [0, 1.1],
    [-0.9, 0],
    [0.8, 0.8],
    [-1.5, -1.5],
  ];

  it('the order radius is half a tile, the old hover generosity', () => {
    expect(ORDER_PICK_RADIUS_TILES).toBe(0.5);
  });

  it('ground 0.6-2 tiles from the militia is an attack-move to that ground, as on main', () => {
    const { sim, squad, militia, cam } = open();
    for (const [dx, dy] of NEAR) {
      const s = worldToScreenThree(20.5 + dx, 24.5 + dy, cam, VP);
      const r = read(sim, cam, [squad], s.x, s.y);
      const at = `offset (${dx}, ${dy})`;
      expect(r.p.hostile, at).toBe(-1);
      expect(r.name, at).toBe('move');
      expect(r.res.intents, at).toEqual([{ kind: 'order', verb: 'attackMove', ids: [squad], x: r.p.x, y: r.p.y, append: false }]);
      // The left-click still selects it from every one of those pixels: the
      // selection keeps the pick's own 1.2 tiles.
      expect(pickAt(sim, cam, s.x, s.y), at).toBe(militia);
    }
  });

  it('a click on its body is the targeted order: the feet, and 8 and 16 px up the figure', () => {
    const { sim, squad, militia, cam } = open();
    const feet = worldToScreenThree(20.5, 24.5, cam, VP);
    for (const up of [0, 8, 16]) {
      const r = read(sim, cam, [squad], feet.x, feet.y - up);
      expect(r.p.hostile, `${up} px up`).toBe(militia);
      expect(r.key, `${up} px up`).toBe('attack-soft');
      expect(r.res.intents, `${up} px up`).toEqual([{ kind: 'attack', ids: [squad], target: militia }]);
    }
  });
});

describe('R-25: a loitering munition takes the attack-move, not the order', () => {
  it('with a rifle squad: the squad fires on the militia, the munition attack-moves to its tile', () => {
    const { sim, spawn } = world();
    const squad = spawn('inf_squad', 0, 11.5, 24.5);
    const drone = spawn('attack_drone', 0, 11.5, 22.5);
    const militia = spawn('militia_cell', 1, 20.5, 24.5);
    sim.identifyTo(0, militia);
    const cam: Camera = { x: 20.5, y: 24.5, zoom: 1 };
    expect(sim.canFocus(drone, militia)).toBe(false);
    const r = read(sim, cam, [squad, drone], CENTRE.x, CENTRE.y);
    expect(r.res.intents).toEqual([
      { kind: 'attack', ids: [squad], target: militia },
      { kind: 'order', verb: 'attackMove', ids: [drone], x: 20.5, y: 24.5, append: false },
    ]);
    // Alone, it is today's attack-move to the tile.
    const alone = read(sim, cam, [drone], CENTRE.x, CENTRE.y);
    expect(alone.name).toBe('advance');
    expect(alone.res.intents.map((i) => i.kind)).toEqual(['order']);
  });
});

describe('R-18: an enemy that is picked but cannot be focused changes no other rung', () => {
  it('a suspected militia whose body is picked, beside the house: the click is still the house\'s', () => {
    const { sim, spawn, house } = world();
    const squad = spawn('inf_squad', 0, 25.5, 21.5);
    const st = sim.structures;
    // Outside the footprint, well away from the click's ground point.
    const militia = spawn('militia_cell', 1, st.minX[house] - 0.7, (st.minY[house] + st.maxY[house] + 1) / 2);
    expect(sim.structureAt(Math.floor(st.minX[house] - 0.7), st.minY[house])).toBe(-1);
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const onFootprint = worldToScreenThree(24.5, 15.5, cam, VP);
    const picked: PointerView = { ...viewOf(sim, cam), unitAtScreen: () => militia };
    const plain: PointerView = { ...viewOf(sim, cam), unitAtScreen: () => -1 };
    const ctx = { ids: [squad], armed: null, confirm: false, armedSmoke: false };
    const withPick = cursorAt(sim, simIntentWorld(sim, () => false), pointerPoint(picked, sim, onFootprint.x, onFootprint.y), ctx);
    const without = cursorAt(sim, simIntentWorld(sim, () => false), pointerPoint(plain, sim, onFootprint.x, onFootprint.y), ctx);
    expect(withPick.res.intents).toEqual([{ kind: 'garrison', ids: [squad], structure: house }]);
    expect(withPick.res).toEqual(without.res);
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

describe('N1a: the enemy under the pointer is the viewer\'s enemy', () => {
  // In a versus room seat 1 commands sim side 1 (network design §5.1): its
  // enemy is side 0, and its own side-1 units are never "hostile".
  it('viewer 1: finds a side-0 unit under the cursor and ignores a side-1 one', () => {
    const { sim, spawn } = world();
    const theirs = spawn('inf_squad', 0, 11.5, 24.5);
    const ours = spawn('militia_cell', 1, 26.5, 24.5);
    const at = (x: number, y: number, viewer?: number) =>
      pointerPoint(viewOf(sim, { x, y, zoom: 1 }, viewer), sim, CENTRE.x, CENTRE.y).hostile;
    expect(at(11.5, 24.5, 1)).toBe(theirs);
    expect(at(26.5, 24.5, 1)).toBe(-1);
    // Viewer 0 is the single-player rule, unchanged.
    expect(at(11.5, 24.5, 0)).toBe(-1);
    expect(at(26.5, 24.5)).toBe(ours);
  });
  it('a civilian is nobody\'s enemy', () => {
    const { sim, spawn } = world();
    spawn('civilians', 2, 11.5, 24.5);
    for (const viewer of [0, 1]) {
      expect(pointerPoint(viewOf(sim, { x: 11.5, y: 24.5, zoom: 1 }, viewer), sim, CENTRE.x, CENTRE.y).hostile).toBe(-1);
    }
  });
  it('an enemy the fog hides is not under the pointer (no locating a defender by sweeping)', () => {
    const { sim, spawn } = world();
    spawn('inf_squad', 0, 11.5, 24.5);
    const fogged = viewOf(sim, { x: 11.5, y: 24.5, zoom: 1 }, 1, () => false);
    expect(pointerPoint(fogged, sim, CENTRE.x, CENTRE.y).hostile).toBe(-1);
  });
  it('a dead enemy is not under the pointer', () => {
    const { sim, spawn } = world();
    const theirs = spawn('inf_squad', 0, 11.5, 24.5);
    sim.debugKill(theirs);
    expect(pointerPoint(viewOf(sim, { x: 11.5, y: 24.5, zoom: 1 }, 1), sim, CENTRE.x, CENTRE.y).hostile).toBe(-1);
  });
  it('pointerPoint reads the view\'s viewer', () => {
    const { sim, spawn } = world();
    const theirs = spawn('inf_squad', 0, 11.5, 24.5);
    const cam: Camera = { x: 11.5, y: 24.5, zoom: 1 };
    expect(pointerPoint(viewOf(sim, cam, 1), sim, CENTRE.x, CENTRE.y).hostile).toBe(theirs);
    expect(pointerPoint(viewOf(sim, cam, 0), sim, CENTRE.x, CENTRE.y).hostile).toBe(-1);
  });
});

describe('F4: the armed Set rally cursor and click', () => {
  // The runtime's own rule (`canSetRally`): an on-map tile the sim's blocked
  // mask leaves open. A building's tiles are blocked.
  const open = (sim: Sim) => (x: number, y: number): boolean => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return tx >= 0 && ty >= 0 && tx < sim.width && ty < sim.height && sim.blocked[ty * sim.width + tx] === 0;
  };
  const rt = (sim: Sim) => ({ canSetRally: (_l: number, x: number, y: number) => open(sim)(fx.toNumber(x), fx.toNumber(y)) });

  it('open ground reads the move sight with no role badge, a selection or not -- nobody selected is going', () => {
    const { sim, spawn } = world();
    const squad = spawn('inf_squad', 0, 11.5, 24.5);
    const cam: Camera = { x: 14.5, y: 24.5, zoom: 1 };
    const view = viewOf(sim, cam);
    const p = pointerPoint(view, sim, CENTRE.x, CENTRE.y);
    const c = cursorAt(sim, simIntentWorld(sim, () => false), p, { ids: [squad], armed: null, confirm: false, armedSmoke: false, rallyAt: open(sim) });
    expect(c.name).toBe('move');
    expect(c.key).toBe('move');
    // The same point unarmed is the squad's own badged move: the rally is what changed it.
    const plain = cursorAt(sim, simIntentWorld(sim, () => false), p, { ids: [squad], armed: null, confirm: false, armedSmoke: false });
    expect(plain.key).toBe('move-soft');
  });

  it('the house wall reads blocked, and the click there sends nothing; open ground sends one setRally', () => {
    const { sim, house } = world();
    const cam: Camera = { x: 25, y: 16, zoom: 1 };
    const view = viewOf(sim, cam);
    const px = wallPixel(sim, house, cam, 0.8);
    const p = pointerPoint(view, sim, px.x, px.y);
    const c = cursorAt(sim, simIntentWorld(sim, () => false), p, { ids: [], armed: null, confirm: false, armedSmoke: false, rallyAt: open(sim) });
    expect(c.name).toBe('blocked');
    const sent: Command[] = [];
    const sink = { queueCommand: (cmd: Command) => void sent.push(cmd) };
    expect(callRally(rt(sim), sink, 1, view, sim, px.x, px.y).ok).toBe(false);
    expect(sent).toEqual([]);
    const g = callRally(rt(sim), sink, 1, viewOf(sim, { x: 14.5, y: 24.5, zoom: 1 }), sim, CENTRE.x, CENTRE.y);
    expect(g.ok).toBe(true);
    expect(sent).toEqual([{ kind: 'setRally', side: 0, line: 1, x: fx.from(g.x), y: fx.from(g.y) }]);
  });

  it('an armed support call outranks a stale rally hint (only one can own the click)', () => {
    const { sim } = world();
    const view = viewOf(sim, { x: 14.5, y: 24.5, zoom: 1 });
    const p = pointerPoint(view, sim, CENTRE.x, CENTRE.y);
    const c = cursorAt(sim, simIntentWorld(sim, () => false), p, { ids: [], armed: 'air_strike', confirm: false, armedSmoke: false, rallyAt: () => false });
    expect(c.name).toBe('strike');
  });
});
