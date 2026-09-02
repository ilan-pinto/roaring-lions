// The anti-tank ditch, from authored JSON to two units taking two routes.
//
// The sibling of boulders.test.ts, and deliberately the same shape: infantry
// and a vehicle, on the SAME map, ordered to the SAME goal, so the two routes
// are the assertion. Split in two it would still pass with a single shared
// flow field, because each half would only ever see one domain's answer.
//
// Every ditch case is paired with the identical map using '.' instead of 'd'.
// A test that only asserts "the vehicle went round" passes when the vehicle is
// stuck, when the map geometry forces a detour anyway, or when the order never
// arrived. The control is what makes the assertion mean anything.
//
// There is a second claim here that boulders.test.ts had no reason to make.
// `d` ships with NO sim code at all: it reuses `b`'s vehicle-only mask rather
// than inventing a second one, which is what keeps it off the determinism
// hash and out of packages/sim entirely. That claim is only worth as much as
// a test of it, so the last block below runs the identical map twice, once
// with each symbol, and asserts the sim sees the two as the same thing.
//
// packages/sim imports nothing and packages/data is a leaf, so tools/ is the
// only place that may hold both ends of this.
import { describe, expect, it } from 'vitest';
import { applyTerrain, parseMap, DECOR, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, type UnitTypeJson } from '../../packages/sim/src/sim';

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
 * A 15x9 field with a five-tile ditch down column 7, rows 2-6.
 *
 * Rows 0-1 and 7-8 are open at that column, so the ditch is a detour rather
 * than a partition: a vehicle that cannot cross it still has a way round, and
 * "went round" is distinguishable from "got stuck".
 */
function field(fill: 'd' | 'b' | '.'): MapJson {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    rows.push(y >= 2 && y <= 6 ? `.......${fill}.......` : '...............');
  }
  return { id: `field_${fill}`, name: 'Field', width: W, height: H, rows };
}

interface Walk {
  sim: Sim;
  footTiles: Set<number>;
  vehTiles: Set<number>;
  footEnd: [number, number];
  vehEnd: [number, number];
}

/** Spawn one of each west of the ditch, order both to the same tile east of it. */
function walk(fill: 'd' | 'b' | '.'): Walk {
  const map = parseMap(field(fill));
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const rifles = sim.addUnitType(RIFLES);
  const tank = sim.addUnitType(TANK);
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

/** The five ditch tiles, as tile indices. */
const DITCH = [2, 3, 4, 5, 6].map((y) => y * W + 7);

describe('an anti-tank ditch authored as `d`', () => {
  it('is crossed by infantry and routed around by a vehicle, same map, same goal', () => {
    const w = walk('d');
    // Infantry drop into it and climb out -- a ditch stops armour, not men.
    expect(DITCH.some((t) => w.footTiles.has(t))).toBe(true);
    // The tank never touches one, on the field or by the wall-slide fallback.
    expect(DITCH.filter((t) => w.vehTiles.has(t))).toEqual([]);
    // And it went round rather than grinding to a halt against the ditch:
    // both are east of column 7 at the end. Without this the assertion above
    // is satisfied by a vehicle that never moved.
    expect(w.footEnd[0]).toBeGreaterThan(7);
    expect(w.vehEnd[0]).toBeGreaterThan(7);
  });

  it('and the same ground without it routes both straight through — the control', () => {
    // If THIS fails, the test above proves nothing: the geometry alone would
    // have sent the vehicle round column 7 whatever the symbol said.
    const w = walk('.');
    expect(DITCH.some((t) => w.footTiles.has(t))).toBe(true);
    expect(DITCH.some((t) => w.vehTiles.has(t))).toBe(true);
  });

  it('gives the two domains separate flow fields', () => {
    expect(walk('d').sim.flowFieldCount).toBe(2);
  });

  it('leaves the ditch tiles open in the sim mask that infantry path on', () => {
    const map = parseMap(field('d'));
    const sim = new Sim({ seed: 11, width: W, height: H, capacity: 4 });
    applyTerrain(map, sim);
    for (const t of DITCH) {
      expect(sim.blocked[t]).toBe(0);
      expect(sim.blockedVehicle[t]).toBe(1);
    }
  });
});

// The claim that `d` cost the sim nothing. It is only worth what a test of it
// is worth, and the cheap version -- "the vehicle went round" -- would pass
// just as happily if `d` had grown its own mask, its own field and its own
// branch in packages/sim.
describe('`d` and `b` are the same thing to the sim', () => {
  it('produces byte-identical masks from the identical map', () => {
    const mapD = parseMap(field('d'));
    const mapB = parseMap(field('b'));
    const simD = new Sim({ seed: 11, width: W, height: H, capacity: 4 });
    const simB = new Sim({ seed: 11, width: W, height: H, capacity: 4 });
    applyTerrain(mapD, simD);
    applyTerrain(mapB, simB);
    expect(Array.from(simD.blocked)).toEqual(Array.from(simB.blocked));
    expect(Array.from(simD.blockedVehicle)).toEqual(Array.from(simB.blockedVehicle));
    expect(mapD.boulderCount).toBe(mapB.boulderCount);
  });

  it('walks two units over identical routes on the two maps', () => {
    // The behavioural half of the same claim: same seed, same orders, and
    // every tile either unit ever stood on is the same set.
    const d = walk('d');
    const b = walk('b');
    expect([...d.footTiles].sort((p, q) => p - q)).toEqual([...b.footTiles].sort((p, q) => p - q));
    expect([...d.vehTiles].sort((p, q) => p - q)).toEqual([...b.vehTiles].sort((p, q) => p - q));
    expect(d.footEnd).toEqual(b.footEnd);
    expect(d.vehEnd).toEqual(b.vehEnd);
  });

  it('differs in exactly one array: the decor layer the sim never sees', () => {
    // And this is the other side of it -- if the two were identical HERE too,
    // the renderer could not tell a trench from a rockfall and would draw
    // boulders in the ditch.
    const mapD = parseMap(field('d'));
    const mapB = parseMap(field('b'));
    for (const t of DITCH) {
      expect(mapD.decor[t]).toBe(DECOR.ditch);
      expect(mapB.decor[t]).toBe(DECOR.none);
    }
    // Presentation only: `applyTerrain` never hands decor to a Sim at all, so
    // the difference above cannot reach a simulation outcome.
    expect(Array.from(mapD.boulder)).toEqual(Array.from(mapB.boulder));
  });
});
