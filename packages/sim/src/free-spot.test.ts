// GH-1360 S2: `freeSpotNear`, the deterministic free spot (design 2026-11-15-unit-spacing-design.md, section 3.4).
// Every world and every expected point below is a LITERAL with its arithmetic beside it; nothing is imported from the
// code under test but the Sim itself. Positions are tile units (fx.from(10.5) is the centre of tile 10), the lattice
// step is 0.5 tile, and ring k is the Chebyshev ring of 8k lattice points round the request, walked clockwise from north.
// Bodies: foot are circles (half length == half width), the tank is a 2 x 1 capsule (segment 1.0 long, radius 0.5, facing 0).
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';

const W = 32;
const H = 32;
const SENSORS = { optics: 1, sight_tiles: 2, signature: 1 };
const HULL = { hp: 100, armor: { front: 1, side: 1, rear: 1 } };
const foot = (id: string, r: number): UnitTypeJson => ({
  id,
  role: 'infantry',
  hull: HULL,
  mobility: { speed_tiles_s: 1, footprint: { half_length_tiles: r, half_width_tiles: r } },
  sensors: SENSORS,
});
/** r 0.45: two of them clear at 0.90. */
const RIFLE = foot('fs_rifle', 0.45);
/** r 0.25: against a rifle the pair distance is 0.70. */
const CIVIL = foot('fs_civil', 0.25);
/** Wheeled by role (mbt); capsule: segment from -0.5 to +0.5 along its facing, radius 0.5. */
const TANK: UnitTypeJson = {
  id: 'fs_tank',
  role: 'mbt',
  hull: HULL,
  mobility: { speed_tiles_s: 1, footprint: { half_length_tiles: 1.0, half_width_tiles: 0.5 } },
  sensors: SENSORS,
};
const HELO: UnitTypeJson = { id: 'fs_helo', role: 'apc', hull: HULL, mobility: { speed_tiles_s: 3, domain: 'air', footprint: { half_length_tiles: 1, half_width_tiles: 1 } }, sensors: SENSORS };

interface World {
  readonly sim: Sim;
  readonly rifle: number;
  readonly civil: number;
  readonly tank: number;
  readonly helo: number;
}
function world(): World {
  const sim = new Sim({ seed: 1360, width: W, height: H, capacity: 32 });
  return { sim, rifle: sim.addUnitType(RIFLE), civil: sim.addUnitType(CIVIL), tank: sim.addUnitType(TANK), helo: sim.addUnitType(HELO) };
}
const P = (x: number, y: number): [number, number] => [fx.from(x), fx.from(y)];
/** Rows `from..to` inclusive walled over the whole width. */
function wallRows(sim: Sim, rows: readonly number[]): void {
  for (const y of rows) for (let x = 0; x < W; x++) sim.setBlocked(x, y, true);
}

describe('freeSpotNear: candidate order (GH-1360 S2)', () => {
  it('an empty world returns the requested point itself', () => {
    const { sim, rifle } = world();
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 10.5));
  });

  it('a body on the request: rings 1 fail (<= 0.707 < 0.90), ring 2 starts due north at 1.0 and wins', () => {
    const { sim, rifle } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    // ring 1 points are 0.5 (N) or 0.707 (corner) from the body; ring 2 north is (10.5, 9.5) at 1.0 >= 0.90.
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 9.5));
  });

  it('clockwise from north: with due north walled, the next point is north-east, not north-west', () => {
    const { sim, rifle } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    sim.setBlocked(10, 9, true); // tile of (10.5, 9.5) and of (10.0, 9.5)
    // ring 2 in order: N (10.5,9.5) wall; NNE (11.0,9.5) tile 11 open, 1.118 from the body >= 0.90 -> taken.
    // Counter-clockwise it would be (10.0,9.5) (tile 10, wall) then (9.5,9.5).
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(11, 9.5));
  });

  it('after the top edge comes the east edge: with the whole top edge and north-east corner walled, the first east point wins', () => {
    const { sim, rifle } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    wallRows(sim, [9]); // y = 9.5 is the top edge of ring 2, y = 9.0 of ring 3
    // ring 2 order: top edge walled (y 9.5); right edge x = 11.5: (11.5,10.0) is 1.118 away -> the first open point after the corner.
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(11.5, 10));
  });

  it('reach is in tiles and bounds the rings: reach 0 is the request only, reach 1 reaches ring 2', () => {
    const { sim, rifle } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 0)).toEqual(P(10.5, 10.5)); // nothing tried but the request
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 1)).toEqual(P(10.5, 9.5)); // 2 x 1 = rings up to 2
  });
});

describe('freeSpotNear: the unit\'s own mask (GH-1360 S2)', () => {
  it('a boulder tile is a free spot for a rifle team and not for a tank', () => {
    const { sim, rifle, tank } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    sim.setBoulder(10, 9, true); // the tile of (10.5, 9.5)
    // Foot: boulders are open ground -> ring 2 north (10.5, 9.5), 1.0 >= 0.90.
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 9.5));
    // Tank facing 0 at (10.5, 9.5): segment x 10..11, y 9.5; the body is 1.0 from it >= 0.5 + 0.45 = 0.95, so it would
    // fit there, but the tile is a wall to it. Ring 2 NNE (11.0, 9.5), tile 11: segment x 10.5..11.5, 1.0 from the body -> taken.
    expect(sim.freeSpotNear(...P(10.5, 10.5), tank, 0, 6)).toEqual(P(11, 9.5));
  });

  it('a wall is a wall for both, and a request inside a wall still finds the first open tile', () => {
    const { sim, rifle } = world();
    sim.setBlocked(10, 10, true);
    // Nothing lives here. Request (10.5,10.5) is a wall: ring 1 north (10.5,10.0) is tile (10,10) too; NE (11.0,10.0) is tile (11,10), open.
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(11, 10));
  });

  it('a set-up keeps the spot inside the side\'s own region', () => {
    const sim = new Sim({ seed: 1360, width: W, height: H, capacity: 8 });
    const rifle = sim.addUnitType(RIFLE);
    const region = new Int8Array(W * H);
    // x <= 10 is side 0's, 11..12 the band, the rest side 1's.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) region[y * W + x] = x <= 10 ? 0 : x <= 12 ? -1 : 1;
    sim.beginSetup({ untilTick: 200, region });
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    sim.setBlocked(10, 9, true);
    // Without the region the answer is (11.0, 9.5) (tile 11, band). Side 0 may not stand there: NNE, the whole east edge
    // (x 11.5) and the south-east corner are band tiles, so the first own tile clockwise is south (10.5, 11.5), 1.0 away.
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 11.5));
  });
});

describe('freeSpotNear: reachability (GH-1360 S2)', () => {
  it('a pocket walled off from the request is never a free spot', () => {
    const { sim, rifle } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    // The request stands in tile (10,10), shut in by walls on its four sides and the corners (the 3 x 3 block's ring).
    for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) if (x !== 10 || y !== 10) sim.setBlocked(x, y, true);
    // Every open point within 6 tiles lies outside the block and is not connected to the request's tile, and the tile's own
    // lattice points (10.0 / 10.5) are within 0.71 of the body: nothing qualifies -> the request comes back.
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 10.5));
  });

  it('a diagonal gap is not a way out: the fill does not cut corners', () => {
    const { sim, rifle } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    // Tile (10,10) is open; (11,10) and (10,11) are walls; (11,11) is open. The only link is the diagonal, which a unit
    // may not take between two closed companions. Every other neighbour is walled, so (11,11) and beyond are unreachable.
    for (let y = 9; y <= 12; y++) for (let x = 9; x <= 12; x++) if ((x === 10 && y === 10) || (x === 11 && y === 11)) continue;
    else sim.setBlocked(x, y, true);
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 10.5));
  });

  it('the same pocket with a door is reachable: the spot is outside through the door', () => {
    const { sim, rifle } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) if ((x !== 10 || y !== 10) && !(x === 10 && y === 11)) sim.setBlocked(x, y, true);
    // Door at (10,11): the south tile is open. Ring 2 order: N,... all walls (y 9.5 is tile 9); east x=11.5 tile 11 walls;
    // south edge y = 11.5 is tile 11: (10.5, 11.5) is the door tile, 1.0 from the body -> taken.
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 11.5));
  });
});

describe('freeSpotNear: clearance by pair distance (GH-1360 S2)', () => {
  it('a stack of three on the request: the spot is 0.90 away from all of them, not 0.45', () => {
    const { sim, rifle } = world();
    for (let k = 0; k < 3; k++) sim.spawn(rifle, 0, ...P(10.5, 10.5));
    // r + r = 0.90. Ring 1 north is 0.5 away: a test against ONE radius (0.45) would take it. Ring 2 north is 1.0.
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 9.5));
  });

  it('touching exactly is clear: two r 0.5 bodies stand 1.0 apart, and ring 2 north is exactly 1.0 away', () => {
    const sim = new Sim({ seed: 1360, width: W, height: H, capacity: 8 });
    const wide = sim.addUnitType(foot('fs_wide', 0.5)); // 0.5 is 32768 raw, exact: 0.5 + 0.5 = 1.0 = 65536 raw
    sim.spawn(wide, 0, ...P(10.5, 10.5));
    expect(sim.freeSpotNear(...P(10.5, 10.5), wide, 0, 6)).toEqual(P(10.5, 9.5));
  });

  it('mixed radii: a civilian beside a rifle team needs 0.25 + 0.45 = 0.70, which ring 1 NE (0.707) just meets', () => {
    const { sim, rifle, civil } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    // N is 0.5 (< 0.70); NE (11.0, 10.0) is sqrt(0.25 + 0.25) = 0.7071 >= 0.70.
    expect(sim.freeSpotNear(...P(10.5, 10.5), civil, 0, 6)).toEqual(P(11, 10));
    // The other way round: the mover is the rifle team, the body the civilian. Same pair, same answer.
    const w = world();
    w.sim.spawn(w.civil, 0, ...P(10.5, 10.5));
    expect(w.sim.freeSpotNear(...P(10.5, 10.5), w.rifle, 0, 6)).toEqual(P(11, 10));
  });

  it('a hull is a capsule, not a circle at its centre: along its axis a team must clear the segment END', () => {
    const { sim, rifle, tank } = world();
    // A one-row corridor (y = 10 only): lattice y is 10.0 or 10.5.
    wallRows(sim, [...Array(H).keys()].filter((y) => y !== 10));
    sim.spawn(tank, 0, ...P(10.5, 10.5)); // facing 0: segment (10.0..11.0, 10.5), radius 0.5; a team needs 0.95 from it.
    // Request on the tank. (11.5,10.0): 0.707 from the segment end (11.0,10.5) -> too close, though 1.118 from the CENTRE
    // (a circle at the centre with the same 0.95 would accept it). (11.5,10.5) is 0.5 from the end. (12.0,10.0) is
    // sqrt(1 + 0.25) = 1.118 from the end: the first lattice point in order that clears. West side is mirrored and later.
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(12, 10));
  });

  it('a hull candidate is placed at the given facing', () => {
    const { sim, rifle, tank } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    // Facing 0, tank at (10.5, 9.5) fits (1.0 from the body vs 0.95), so facing 0 gives the default ring-2 north point.
    expect(sim.freeSpotNear(...P(10.5, 10.5), tank, 0, 6, 0)).toEqual(P(10.5, 9.5));
    // Quarter turn (0x4000 = 90 degrees): the segment runs north-south, (10.5, 9.0..10.0) at (10.5, 9.5); its south end
    // (10.5,10.0) is 0.5 from the body -> too close. The next ring-2 points (11.0,9.5) etc. have it 0.707 off... walk: the
    // first that clears 0.95 is ring 2 (1,-2)? segment (11.0, 9.0..10.0): nearest (11.0,10.0) to (10.5,10.5) is 0.707 -> no.
    // (2,-2) (11.5,9.5): nearest (11.5,10.0): sqrt(1 + 0.25) = 1.118 -> yes.
    expect(sim.freeSpotNear(...P(10.5, 10.5), tank, 0, 6, 0x4000)).toEqual(P(11.5, 9.5));
  });

  it('the dead are not bodies', () => {
    const { sim, rifle } = world();
    const a = sim.spawn(rifle, 0, ...P(10.5, 10.5));
    sim.debugKill(a);
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 10.5));
  });

  it('an aircraft with a footprint (r 1.0) on the request is not a body to a rifle team', () => {
    const { sim, rifle, helo } = world();
    sim.spawn(helo, 0, ...P(10.5, 10.5)); // were it a body, a team would need 1.45 from it, not the request
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 10.5));
  });

  // The three "off the surface" states are read straight from the state arrays the filter reads: a unit aboard a
  // carrier, inside a building, inside a tunnel route stands where it was last seen but occupies no ground.
  it('a unit aboard a carrier is not a body', () => {
    const { sim, rifle } = world();
    const a = sim.spawn(rifle, 0, ...P(10.5, 10.5));
    const jeepLike = sim.spawn(rifle, 0, ...P(20.5, 20.5)); // any other unit's id will do for the seat
    sim.state.carriedBy[a] = jeepLike;
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 10.5));
  });

  it('a unit garrisoned in a building is not a body', () => {
    const { sim, rifle } = world();
    const a = sim.spawn(rifle, 0, ...P(10.5, 10.5));
    sim.state.garrisonedIn[a] = 0; // structure index 0
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 10.5));
  });

  it('a unit inside a tunnel route is not a body', () => {
    const { sim, rifle } = world();
    const a = sim.spawn(rifle, 0, ...P(10.5, 10.5));
    sim.state.tunnelIn[a] = 0; // route index 0
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 6)).toEqual(P(10.5, 10.5));
  });

  it('an aircraft gets the requested point, even on top of a body', () => {
    const { sim, rifle, helo } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    expect(sim.freeSpotNear(...P(10.5, 10.5), helo, 0, 6)).toEqual(P(10.5, 10.5));
  });
});

describe('freeSpotNear: the fallback (GH-1360 S2)', () => {
  it('with nothing free within reach the requested point comes back, never a throw', () => {
    const { sim, rifle } = world();
    sim.spawn(rifle, 0, ...P(10.5, 10.5));
    // Reach 1: rings 1 and 2 only. Wall every tile of ring 2's span except the request's own tile.
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) if (x !== 10 || y !== 10) sim.setBlocked(x, y, true);
    expect(sim.freeSpotNear(...P(10.5, 10.5), rifle, 0, 1)).toEqual(P(10.5, 10.5));
  });

  it('a request at the map edge and a negative reach are safe', () => {
    const { sim, rifle } = world();
    sim.spawn(rifle, 0, ...P(0.5, 0.5));
    // (0.5, 0.5): every ring-1 point is within 0.707; ring 2's top edge is y = -0.5, off the map, skipped. The first
    // on-map point in order is the east edge's (1.5, 0.0): sqrt(1 + 0.25) = 1.118 from the body.
    expect(sim.freeSpotNear(...P(0.5, 0.5), rifle, 0, 6)).toEqual(P(1.5, 0));
    expect(sim.freeSpotNear(...P(0.5, 0.5), rifle, 0, -3)).toEqual(P(0.5, 0.5));
  });
});

describe('freeSpotNear: pure and deterministic (GH-1360 S2)', () => {
  function crowded(): World {
    const w = world();
    for (let k = 0; k < 4; k++) w.sim.spawn(w.rifle, 0, ...P(10.5 + 0.25 * k, 10.5));
    w.sim.spawn(w.tank, 1, ...P(12.5, 10.5));
    return w;
  }
  it('two fresh worlds give the same bytes, and a repeat call on one world agrees with itself', () => {
    const a = crowded();
    const b = crowded();
    const ra = a.sim.freeSpotNear(...P(10.5, 10.5), a.rifle, 0, 6);
    const rb = b.sim.freeSpotNear(...P(10.5, 10.5), b.rifle, 0, 6);
    expect(Array.from(new Int32Array(ra))).toEqual(Array.from(new Int32Array(rb)));
    expect(a.sim.freeSpotNear(...P(10.5, 10.5), a.rifle, 0, 6)).toEqual(ra);
  });
  it('writes nothing: the state hash and the RNG are the same before and after, and ticking afterwards matches a world never asked', () => {
    const asked = crowded();
    const never = crowded();
    const before = asked.sim.hash();
    for (let i = 0; i < 5; i++) asked.sim.freeSpotNear(...P(10.5, 10.5), asked.rifle, 0, 6);
    expect(asked.sim.hash()).toBe(before);
    for (let t = 0; t < 20; t++) {
      asked.sim.tick();
      never.sim.tick();
    }
    expect(asked.sim.hash()).toBe(never.sim.hash());
  });
});
