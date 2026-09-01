// Boulders, from authored JSON to two units taking two different routes.
//
// map.test.ts proves `b` parses. This proves it MATTERS, and it is one test on
// purpose: infantry and a vehicle, on the SAME map, ordered to the SAME goal,
// so the two routes are the assertion. Split into two tests it would still pass
// with a single shared flow field, because each half would only ever see one
// domain's answer -- and a shared field is exactly the bug worth catching, the
// cache being keyed by goal tile alone before this change.
//
// Every boulder case is paired with the identical map using '.' instead of 'b'.
// A test that only asserts "the vehicle went round" passes when the vehicle is
// stuck, when the map geometry forces a detour anyway, or when the order never
// arrived. The control is what makes the assertion mean anything -- the same
// discipline as rock_terrain.test.ts.
//
// packages/sim imports nothing and packages/data is a leaf, so tools/ is the
// only place that may hold both ends of this.
import { describe, expect, it } from 'vitest';
import { applyTerrain, parseMap, units, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, unitTypeFromJson, type UnitTypeJson } from '../../packages/sim/src/sim';

const RIFLES: UnitTypeJson = {
  id: 't_rifles',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
};

const TANK: UnitTypeJson = {
  id: 't_tank',
  role: 'armor',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 2.0, turn_rate_deg_s: 720 },
  sensors: { optics: 1, sight_tiles: 8, signature: 1 },
};

const W = 15;
const H = 9;

/**
 * A 15x9 field with a five-tile wall of `fill` down column 7, rows 2-6.
 *
 * Rows 0-1 and 7-8 are open at that column, so the wall is a detour rather
 * than a partition: a vehicle that cannot cross it still has a way round, and
 * "went round" is distinguishable from "got stuck".
 */
function field(fill: 'b' | '.'): MapJson {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    rows.push(y >= 2 && y <= 6 ? `.......${fill}.......` : '...............');
  }
  return { id: `field_${fill === 'b' ? 'boulder' : 'open'}`, name: 'Field', width: W, height: H, rows };
}

interface Walk {
  sim: Sim;
  /** Tile indices the unit stood on, in order of first arrival. */
  footTiles: Set<number>;
  vehTiles: Set<number>;
  footEnd: [number, number];
  vehEnd: [number, number];
}

/** Spawn one of each west of the wall, order both to the same tile east of it. */
function walk(fill: 'b' | '.'): Walk {
  const map = parseMap(field(fill));
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const rifles = sim.addUnitType(RIFLES);
  const tank = sim.addUnitType(TANK);
  // Two rows apart so neither shoves the other off its own route, and both
  // west of the wall so both must cross column 7 to arrive.
  const foot = sim.spawn(rifles, 0, fx.from(1.5), fx.from(3.5));
  const veh = sim.spawn(tank, 0, fx.from(1.5), fx.from(5.5));
  sim.queueCommand({ kind: 'move', ids: [foot, veh], x: fx.from(13.5), y: fx.from(4.5) });

  const footTiles = new Set<number>();
  const vehTiles = new Set<number>();
  for (let t = 0; t < 600; t++) {
    sim.tick();
    footTiles.add((sim.state.posY[foot] >> 16) * W + (sim.state.posX[foot] >> 16));
    vehTiles.add((sim.state.posY[veh] >> 16) * W + (sim.state.posX[veh] >> 16));
  }
  return {
    sim,
    footTiles,
    vehTiles,
    footEnd: [sim.state.posX[foot] >> 16, sim.state.posY[foot] >> 16],
    vehEnd: [sim.state.posX[veh] >> 16, sim.state.posY[veh] >> 16],
  };
}

/** The five wall tiles, as tile indices. */
const WALL = [2, 3, 4, 5, 6].map((y) => y * W + 7);

describe('a boulder field authored as `b`', () => {
  it('is crossed by infantry and routed around by a vehicle, same map, same goal', () => {
    const w = walk('b');
    // The rifles walk straight over it -- a boulder is open ground on foot.
    expect(WALL.some((t) => w.footTiles.has(t))).toBe(true);
    // The tank never touches one, on the field or by the wall-slide fallback.
    expect(WALL.filter((t) => w.vehTiles.has(t))).toEqual([]);
    // And it went round rather than grinding to a halt against the wall: both
    // are east of column 7 at the end. Without this the assertion above is
    // satisfied by a vehicle that never moved.
    expect(w.footEnd[0]).toBeGreaterThan(7);
    expect(w.vehEnd[0]).toBeGreaterThan(7);
  });

  it('and the same ground without it routes both straight through — the control', () => {
    // If THIS fails, the test above proves nothing: the geometry alone would
    // have sent the vehicle round column 7 whatever the symbol said.
    const w = walk('.');
    expect(WALL.some((t) => w.footTiles.has(t))).toBe(true);
    expect(WALL.some((t) => w.vehTiles.has(t))).toBe(true);
  });

  it('gives the two domains separate flow fields', () => {
    // The cache used to key on the goal tile alone. Two units, one goal, one
    // field -- and the vehicle would have inherited the infantry's route
    // straight over the boulders.
    expect(walk('b').sim.flowFieldCount).toBe(2);
  });

  it('allocates no second field on a map with no boulders', () => {
    // The two masks are identical there, so a vehicle field would be a
    // duplicate. Decided once, at map load.
    expect(walk('.').sim.flowFieldCount).toBe(1);
  });

  it('stops a vehicle whose field has nothing to say, on the straight-line leg', () => {
    // The flow field is not the only thing that moves a unit. When its own
    // tile reads DIR_NONE the unit beelines at the goal, and that leg has to
    // respect the same mask the field did -- otherwise the route goes round
    // the boulders and the last few metres drive over one.
    //
    // A ring of boulders round the goal is how that state is reached from an
    // ordinary move order: the goal tile is open to both domains, but no
    // vehicle-passable tile outside the ring ever reaches it, so every tile
    // in the vehicle's field stays DIR_NONE and the whole approach is the
    // fallback. Infantry, whose mask has no ring in it at all, walks in.
    const rows: string[] = [];
    for (let y = 0; y < H; y++) {
      if (y === 2 || y === 6) rows.push('....bbbbb......');
      else if (y >= 3 && y <= 5) rows.push('....b...b......');
      else rows.push('...............');
    }
    const map = parseMap({ id: 'ring', name: 'Ring', width: W, height: H, rows });
    const sim = new Sim({ seed: 11, width: W, height: H, capacity: 8 });
    applyTerrain(map, sim);
    const foot = sim.spawn(sim.addUnitType(RIFLES), 0, fx.from(1.5), fx.from(3.5));
    const veh = sim.spawn(sim.addUnitType(TANK), 0, fx.from(1.5), fx.from(4.5));
    sim.queueCommand({ kind: 'move', ids: [foot, veh], x: fx.from(6.5), y: fx.from(4.5) });

    const ring: number[] = [];
    for (let t = 0; t < W * H; t++) if (map.boulder[t] !== 0) ring.push(t);
    expect(ring.length).toBe(16);

    const vehTiles = new Set<number>();
    const footTiles = new Set<number>();
    for (let t = 0; t < 400; t++) {
      sim.tick();
      vehTiles.add((sim.state.posY[veh] >> 16) * W + (sim.state.posX[veh] >> 16));
      footTiles.add((sim.state.posY[foot] >> 16) * W + (sim.state.posX[foot] >> 16));
    }
    // The tank is held outside the ring by the boulders themselves.
    expect(ring.filter((t) => vehTiles.has(t))).toEqual([]);
    expect(sim.state.posX[veh] >> 16).toBeLessThan(4);
    // The rifles crossed the ring and stand on the goal -- the control that
    // says the ring is passable at all and the order was a real one.
    expect(ring.some((t) => footTiles.has(t))).toBe(true);
    expect([sim.state.posX[foot] >> 16, sim.state.posY[foot] >> 16]).toEqual([6, 4]);
  });

  it('leaves the boulder tiles open in the sim mask that infantry path on', () => {
    const map = parseMap(field('b'));
    const sim = new Sim({ seed: 11, width: W, height: H, capacity: 4 });
    applyTerrain(map, sim);
    for (const t of WALL) {
      expect(sim.blocked[t]).toBe(0);
      expect(sim.blockedVehicle[t]).toBe(1);
    }
  });
});

// The trap in the obvious answer. FOOT_ROLES already splits foot from vehicle
// for `canEmbark`, and it contains `artillery` -- but `rocket_battery` is a
// Grad on a 6x6 truck and declares role "artillery" too. Reusing FOOT_ROLES
// would drive a rocket truck through a boulder field that stops a jeep. These
// two are the two sides of that conflation, pinned against the shipped JSON.
describe('what counts as a vehicle', () => {
  it('calls the rocket battery wheeled despite its artillery role', () => {
    expect(units.rocket_battery.role).toBe('artillery');
    expect(unitTypeFromJson(units.rocket_battery as UnitTypeJson).wheeled).toBe(true);
  });

  it('and the mortar team, the same role, not', () => {
    expect(units.mortar_team.role).toBe('artillery');
    expect(unitTypeFromJson(units.mortar_team as UnitTypeJson).wheeled).toBe(false);
  });

  it('leaves air out of it entirely — a helicopter paths on the foot mask', () => {
    // Air ignores terrain blocking altogether, so giving it the vehicle mask
    // would be a second field computed for nothing.
    const heli = unitTypeFromJson(units.heli_peten as UnitTypeJson);
    expect(heli.isAir).toBe(true);
    expect(heli.moveDomain).toBe(0);
  });
});
