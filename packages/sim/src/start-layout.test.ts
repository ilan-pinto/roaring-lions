// GH-1360 S3a: `startLayout`, the starting layout (design 2026-11-15-unit-spacing-design.md, section 3.2).
// Every expected tile below is a LITERAL derived by hand from data/layouts/assembly.json's three ranks and written beside
// its arithmetic; nothing is imported from the code under test but the function itself and the Sim it calls for the free spot.
// Frame: the click is the FRONT rank (forward 0), later ranks are behind it. Front E has forward (+1,0) and lateral (0,+1);
// S has forward (0,+1) and lateral (-1,0); W has forward (-1,0) and lateral (0,-1); N has forward (0,-1) and lateral (+1,0).
// A slot is the tile (anchor + f*forward + l*lateral). Facings are sim angle units: 0 = +x, a quarter turn is 16384, so
// E 0, S 16384, W 32768, N 49152.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fx, type Fx } from './fixed';
import { compileFormation, type FormationJson } from './formation-template';
import { Sim, type UnitTypeJson } from './sim';
import { frontToward, startLayout, type StartBody, type StartFront, type StartPlacement } from './start-layout';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ASSEMBLY = compileFormation(JSON.parse(readFileSync(join(ROOT, 'data', 'layouts', 'assembly.json'), 'utf8')) as FormationJson);

// class codes, as literals
const ARMOUR = 0;
const LIGHT = 1;
const RECON = 2;
const INFANTRY = 3;
const SUPPORT = 4;
const MEDIC = 5;
const AIRCRAFT = 6;

const W = 64;
const H = 64;
const open = (): Uint8Array => new Uint8Array(W * H);
const body = (id: number, cls: number, x: number, y: number): StartBody => ({
  id,
  domain: cls <= RECON ? 1 : 0,
  cls,
  vehicle: cls <= RECON,
  air: cls === AIRCRAFT,
  x: fx.from(x),
  y: fx.from(y),
});
function lay(bodies: readonly StartBody[], front: StartFront, w = W, h = H, masks: [Uint8Array, Uint8Array] = [new Uint8Array(w * h), new Uint8Array(w * h)], freeSpot?: Parameters<typeof startLayout>[0]['freeSpot']): StartPlacement[] {
  return startLayout({ width: w, height: h, masks, cover: new Uint8Array(w * h), front, bodies, freeSpot }, ASSEMBLY);
}
/** Tile centres, as the tiles a placement stands on. */
const tiles = (ps: readonly StartPlacement[]): [number, number, number][] => ps.map((p) => [p.id, fx.toInt(p.x), fx.toInt(p.y)]);
const E = 0;
const S = 16384;
const Wf = 32768;
const N = 49152;

describe('startLayout: a golden table of slots for three literal forces on open ground (GH-1360 S3a)', () => {
  it('force A, front E: a Lavi and a jeep, three rifle teams, a medic', () => {
    // ids 0 Lavi, 1 jeep, 2-4 infantry, 5 medic. x sum 118.0 / 6 = 19.67 -> 19; y sum 184.0 / 6 = 30.67 -> 30.
    // Depth 4 (infantry at forward -2, the rear rank at -4), half 2, so the click is (19 + 2, 30) = (21, 30).
    // Front rank (spacing 3): Lavi lateral 0 -> (21,30), jeep lateral +3 -> (21,33).
    // Infantry (forward -2, spacing 2): lateral 0, +2, -2 -> (19,30), (19,32), (19,28).
    // Medic (forward -4) -> (17,30).
    const force = [
      body(0, ARMOUR, 20.5, 30.5), body(1, LIGHT, 21.5, 31.5), body(2, INFANTRY, 19.5, 29.5),
      body(3, INFANTRY, 19.5, 30.5), body(4, INFANTRY, 18.5, 31.5), body(5, MEDIC, 18.5, 30.5),
    ];
    const out = lay(force, 'E');
    expect(tiles(out)).toEqual([[0, 21, 30], [1, 21, 33], [2, 19, 30], [3, 19, 32], [4, 19, 28], [5, 17, 30]]);
    expect(out.map((p) => p.face)).toEqual([E, E, E, E, E, E]);
    expect(out.map((p) => p.how)).toEqual(['slot', 'slot', 'slot', 'slot', 'slot', 'slot']);
    // a body stands on a tile centre
    expect(out[0].x).toBe(fx.from(21.5));
    expect(out[0].y).toBe(fx.from(30.5));
  });

  it('force B, front S: two tanks and a recon car, two rifle teams, a support weapon, a drone', () => {
    // x sum 213.5 / 7 = 30.5 -> 30; y sum 147.5 / 7 = 21.07 -> 21; depth 4, half 2; forward is +y so the click is (30, 23).
    // Lateral is -x. Front rank: tank 0 -> (30,23), tank 1 lateral +3 -> (27,23), recon (id 2) lateral -3 -> (33,23).
    // Infantry at forward -2 -> y 21: lateral 0, +2 -> (30,21), (28,21).
    // Rear rank at forward -4 -> y 19: support (id 5) lateral 0 -> (30,19), drone (id 6) lateral +2 -> (28,19).
    const force = [
      body(0, ARMOUR, 29.5, 19.5), body(1, ARMOUR, 30.5, 19.5), body(2, RECON, 31.5, 20.5), body(3, INFANTRY, 29.5, 21.5),
      body(4, INFANTRY, 30.5, 21.5), body(5, SUPPORT, 30.5, 22.5), body(6, AIRCRAFT, 31.5, 22.5),
    ];
    const out = lay(force, 'S');
    expect(tiles(out)).toEqual([[0, 30, 23], [1, 27, 23], [2, 33, 23], [3, 30, 21], [4, 28, 21], [5, 30, 19], [6, 28, 19]]);
    // every body faces the front, the drone included (it has no facing of its own in the template)
    expect(out.map((p) => p.face)).toEqual([S, S, S, S, S, S, S]);
  });

  it('force C, front W: five vehicles in the front rank, four rifle teams behind', () => {
    // ids 0,1,3 are armour, 2 light, 4 recon, 5-8 infantry. x sum 358.5 / 9 = 39.83 -> 39; y sum 94.5 / 9 = 10.5 -> 10.
    // Depth 2, half 1, forward is -x: the click is (39 - 1, 10) = (38, 10). Lateral is -y.
    // Front rank, fill order = (armour ids 0,1,3), light 2, recon 4, lateral 0, +3, -3, +6, -6 -> y = 10, 7, 13, 4, 16:
    // id 0 (38,10), id 1 (38,7), id 3 (38,13), id 2 (38,4), id 4 (38,16).
    // Infantry at forward -2 -> x 38 + 2 = 40, lateral 0, +2, -2, +4 -> y 10, 8, 12, 6.
    const force = [
      body(0, ARMOUR, 41.5, 10.5), body(1, ARMOUR, 41.5, 9.5), body(2, LIGHT, 40.5, 11.5), body(3, ARMOUR, 40.5, 8.5),
      body(4, RECON, 39.5, 12.5), body(5, INFANTRY, 39.5, 10.5), body(6, INFANTRY, 38.5, 9.5), body(7, INFANTRY, 38.5, 11.5),
      body(8, INFANTRY, 38.5, 10.5),
    ];
    const out = lay(force, 'W');
    expect(tiles(out)).toEqual([[0, 38, 10], [1, 38, 7], [2, 38, 4], [3, 38, 13], [4, 38, 16], [5, 40, 10], [6, 40, 8], [7, 40, 12], [8, 40, 6]]);
    expect(out.map((p) => p.face)).toEqual(Array(9).fill(Wf));
  });
});

describe('startLayout: the front (GH-1360 S3a)', () => {
  const force = [body(0, ARMOUR, 30.5, 30.5), body(1, INFANTRY, 29.5, 30.5), body(2, AIRCRAFT, 30.5, 31.5)];
  it('each front is its own axis and its own facing, aircraft included', () => {
    for (const [front, face] of [['E', E], ['S', S], ['W', Wf], ['N', N]] as const) {
      expect(lay(force, front).map((p) => p.face)).toEqual([face, face, face]);
    }
  });

  it('the front rank is the one nearest the front and the force extends back from it', () => {
    // vehicle at the click, infantry two tiles behind it along the front axis (depth 2 here: no rear rank), drone behind
    const e = tiles(lay(force, 'E'));
    const n = tiles(lay(force, 'N'));
    // three bodies: tank forward 0, infantry forward -2, drone (rear rank) forward -4. Depth 4, half 2. Centroid
    // x 90.5/3 = 30.17 -> 30, y 92.5/3 = 30.83 -> 30.
    expect(e).toEqual([[0, 32, 30], [1, 30, 30], [2, 28, 30]]);
    // N: forward (0,-1): the click is (30, 30 - 2) = (30, 28); infantry at (30, 30), drone at (30, 32).
    expect(n).toEqual([[0, 30, 28], [1, 30, 30], [2, 30, 32]]);
  });

  it('frontToward quantises like assignTemplate: an axis, ties to x', () => {
    expect(frontToward(10, 10, 20, 12)).toBe('E');
    expect(frontToward(10, 10, 0, 12)).toBe('W');
    expect(frontToward(10, 10, 12, 20)).toBe('S');
    expect(frontToward(10, 10, 12, 0)).toBe('N');
    expect(frontToward(10, 10, 20, 20)).toBe('E');
    expect(frontToward(10, 10, 10, 10)).toBe('E');
  });
});

describe('startLayout: the anchor is one floor of the Fx centroid (GH-1360 S3a)', () => {
  // x = 10.5, 11.5, 11.5: the centroid is 11.17, tile 11. Flooring each body first (10, 11, 11) gives 10.67, tile 10.
  const forceAt = (xs: number[], ys: number[]): StartBody[] => xs.map((x, i) => body(i, INFANTRY, x, ys[i]));
  it('a force and the same force turned 180 degrees about the map give turned slots', () => {
    const a = lay(forceAt([10.5, 11.5, 11.5], [10.5, 11.5, 12.5]), 'E');
    // the turned force: x -> 64 - x, y -> 64 - y, front E -> W
    const b = lay(forceAt([53.5, 52.5, 52.5], [53.5, 52.5, 51.5]), 'W');
    expect(tiles(a)).toEqual([[0, 11, 11], [1, 11, 13], [2, 11, 9]]);
    expect(tiles(b)).toEqual(tiles(a).map(([i, x, y]) => [i, 63 - x, 63 - y]));
  });
});

describe('startLayout: the edge pull-back keeps the rear rank on the map (GH-1360 S3a)', () => {
  it('west edge, front E: the rear rank would be at x 0 and is slid in to x 1', () => {
    // vehicles + infantry + support: depth 4. Bodies centred on x = 2: the click would be 2 + 2 = 4 and the rear rank x 0.
    // The pull-back makes the click 1 + 4 = 5: the rear rank is at x 1.
    const force = [body(0, ARMOUR, 2.5, 20.5), body(1, ARMOUR, 3.5, 21.5), body(2, INFANTRY, 2.5, 19.5), body(3, INFANTRY, 1.5, 20.5), body(4, SUPPORT, 1.5, 21.5)];
    // x sum 11.5... = 2.5+3.5+2.5+1.5+1.5 = 11.5 / 5 = 2.3 -> 2; y sum 103.0... = 20.5+21.5+19.5+20.5+21.5 = 103.5 / 5 = 20.7 -> 20
    const out = tiles(lay(force, 'E'));
    // tanks lateral 0, +3: (5,20), (5,23); infantry forward -2 -> x 3: (3,20), (3,22); support forward -4 -> x 1: (1,20)
    expect(out).toEqual([[0, 5, 20], [1, 5, 23], [2, 3, 20], [3, 3, 22], [4, 1, 20]]);
    expect(Math.min(...out.map(([, x]) => x))).toBeGreaterThanOrEqual(1);
  });

  it('north edge, front S (forward +y): the rear rank is slid in the same way', () => {
    const force = [body(0, ARMOUR, 30.5, 2.5), body(1, ARMOUR, 31.5, 3.5), body(2, INFANTRY, 30.5, 1.5), body(3, INFANTRY, 31.5, 2.5), body(4, SUPPORT, 30.5, 1.5)];
    // x sum 154.5.. = 30.5+31.5+30.5+31.5+30.5 = 154.5 / 5 = 30.9 -> 30; y sum 11.5 / 5 = 2.3 -> 2. Click y 4 pulled to 5.
    // Lateral is -x. Tanks: (30,5), (27,5); infantry y 3: (30,3), (28,3); support y 1: (30,1).
    const out = tiles(lay(force, 'S'));
    expect(out).toEqual([[0, 30, 5], [1, 27, 5], [2, 30, 3], [3, 28, 3], [4, 30, 1]]);
    expect(Math.min(...out.map(([, , y]) => y))).toBeGreaterThanOrEqual(1);
  });

  it('east edge, front W: pulled in from the other side', () => {
    const force = [body(0, ARMOUR, 61.5, 20.5), body(1, ARMOUR, 60.5, 21.5), body(2, INFANTRY, 61.5, 19.5), body(3, INFANTRY, 62.5, 20.5), body(4, SUPPORT, 62.5, 21.5)];
    // x sum 308.5 / 5 = 61.7 -> 61; y 20 (as above). Click = 61 - 2 = 59; the rear rank x 63 is the last column: pulled to 62 - 4 = 58 so it is 62.
    // Lateral is -y: tanks (58,20), (58,17); infantry x 60: (60,20), (60,18); support x 62: (62,20).
    const out = tiles(lay(force, 'W'));
    expect(out).toEqual([[0, 58, 20], [1, 58, 17], [2, 60, 20], [3, 60, 18], [4, 62, 20]]);
    expect(Math.max(...out.map(([, x]) => x))).toBeLessThanOrEqual(62);
  });
});

describe('startLayout: the pull-back runs after the snap (GH-1360 S3a review)', () => {
  it('west edge with a blocked tile at the click: the snap moves the click back to x 4, and it is pulled in again', () => {
    // The edge force: click (5,20) after the first pull-back, rear rank x 1. Tile (5,20) is a wall for foot and wheels, so
    // the snap takes the first open tile of ring 1, row-major: (4,19). The rear rank would be x 0; the second pull-back makes
    // the click x 5 again, so (5,19). Tanks (5,19), (5,22); infantry (3,19), (3,21); support (1,19).
    const wall = open();
    wall[20 * W + 5] = 1;
    const force = [body(0, ARMOUR, 2.5, 20.5), body(1, ARMOUR, 3.5, 21.5), body(2, INFANTRY, 2.5, 19.5), body(3, INFANTRY, 1.5, 20.5), body(4, SUPPORT, 1.5, 21.5)];
    const out = tiles(lay(force, 'E', W, H, [wall, wall]));
    expect(out).toEqual([[0, 5, 19], [1, 5, 22], [2, 3, 19], [3, 3, 21], [4, 1, 19]]);
    expect(Math.min(...out.map(([, x]) => x))).toBeGreaterThanOrEqual(1);
  });
});

describe('startLayout: overflow goes to the free spot, then to the authored position (GH-1360 S3a)', () => {
  const HULL = { hp: 100, armor: { front: 1, side: 1, rear: 1 } };
  const SENSORS = { optics: 1, sight_tiles: 2, signature: 1 };
  const TANK: UnitTypeJson = { id: 'sl_tank', role: 'mbt', hull: HULL, mobility: { speed_tiles_s: 1, footprint: { half_length_tiles: 1.0, half_width_tiles: 0.5 } }, sensors: SENSORS };
  const RW = 40;
  const RH = 24;
  /** Only row 10, x 19 to 21, is open: a three-tile pocket. (A longer corridor takes a spilled rank behind the front one.) */
  function pocket(): { sim: Sim; tank: number; masks: [Uint8Array, Uint8Array] } {
    const sim = new Sim({ seed: 1360, width: RW, height: RH, capacity: 16 });
    const tank = sim.addUnitType(TANK);
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) if (y !== 10 || x < 19 || x > 21) sim.setBlocked(x, y, true);
    return { sim, tank, masks: [sim.blocked, sim.blockedVehicle] };
  }
  const tanks = (): StartBody[] => [body(0, ARMOUR, 19.5, 10.5), body(1, ARMOUR, 22.5, 10.5)];

  it('a pocket seats the first tank and sends the second to the free spot, 2.0 along its facing', () => {
    const { sim, tank, masks } = pocket();
    // The sim does not hold the force yet; the caller's callback puts the bodies laid out so far into it, as S3b will.
    const spawned = new Set<number>();
    const asked: [number, Fx, Fx][] = [];
    const freeSpot = (id: number, x: Fx, y: Fx, others: readonly StartPlacement[]): [Fx, Fx] => {
      asked.push([id, x, y]);
      for (const o of others) {
        if (spawned.has(o.id)) continue;
        spawned.add(o.id);
        sim.spawn(tank, 0, o.x, o.y);
      }
      return sim.freeSpotNear(x, y, tank, 0, 12);
    };
    const out = lay(tanks(), 'E', RW, RH, masks, freeSpot);
    // x sum 42.0 / 2 = 21 -> tile 21, y 10 (tank 1 was authored at 22.5, a wall: not the click). Depth 0 (a front rank only), so the click is (21, 10). Tank 0 takes it. Tank 1's
    // slot is the spilled rank, 3 behind: x 18, a wall. So it overflows and asks at the click centre (21.5, 10.5).
    expect(out.map((p) => p.how)).toEqual(['slot', 'free']);
    expect(asked).toEqual([[1, fx.from(21.5), fx.from(10.5)]]); // the click centre, not tank 1's authored 22.5
    expect(tiles(out)[0]).toEqual([0, 21, 10]);
    // Tank 0 is on the request; rings up to 3.5 fail on clearance (the capsules need 2.0 along the corridor), ring 4 (2.0)
    // east is a wall and ring 4 west, (19.5, 10.5), is the first clear open point: tank 0 spans 21.0-22.0, tank 1 19.0-20.0.
    expect(out[1].x).toBe(fx.from(19.5));
    expect(out[1].y).toBe(fx.from(10.5));
    expect(out[1].face).toBe(E);
  });

  it('the real freeSpotNear through a bare wrapper: its echo of the request is "no spot"', () => {
    const { sim, tank, masks } = pocket();
    const spawned = new Set<number>();
    const bare = (_id: number, x: Fx, y: Fx, others: readonly StartPlacement[]): [Fx, Fx] => {
      for (const o of others) {
        if (spawned.has(o.id)) continue;
        spawned.add(o.id);
        sim.spawn(tank, 0, o.x, o.y);
      }
      return sim.freeSpotNear(x, y, tank, 0, 12);
    };
    // three tanks, the pocket holds two: tank 0 the click, tank 1 the free spot 19.5, tank 2 finds nothing and freeSpotNear
    // hands the request (21.5, 10.5) back, on top of tank 0. That is not a spot: tank 2 keeps its authored 22.5.
    const force = [body(0, ARMOUR, 19.5, 10.5), body(1, ARMOUR, 21.5, 10.5), body(2, ARMOUR, 22.5, 10.5)];
    const out = lay(force, 'E', RW, RH, masks, bare);
    expect(out.map((p) => p.how)).toEqual(['slot', 'free', 'authored']);
    expect(out[1].x).toBe(fx.from(19.5));
    expect(out[2].x).toBe(fx.from(22.5));
  });

  it('no free spot keeps the authored position and says so', () => {
    const { masks } = pocket();
    const out = lay(tanks(), 'E', RW, RH, masks, () => null);
    expect(out.map((p) => p.how)).toEqual(['slot', 'authored']);
    expect(out[1].x).toBe(fx.from(22.5));
    expect(out[1].face).toBe(E);
  });

  it('with no callback, overflow keeps the authored position', () => {
    const { masks } = pocket();
    expect(lay(tanks(), 'E', RW, RH, masks).map((p) => p.how)).toEqual(['slot', 'authored']);
  });
});

describe('startLayout: each body on its own mask, and assemblies do not share a tile (GH-1360 S3a)', () => {
  it('a boulder at the click moves the whole anchor to a tile open to both, so the ranks keep their order', () => {
    // Force A with tile (21,30) a boulder: wheeled-blocked, open to foot. The anchor snaps to the nearest tile open to BOTH
    // by Chebyshev ring, row-major: (20,29). Lavi (20,29), jeep lateral +3 (20,32); infantry two behind at x 18:
    // (18,29), (18,31), (18,27); medic (16,29). (Snapping each domain on its own would leave the infantry at x 21, ahead of the tanks.)
    const veh = open();
    veh[30 * W + 21] = 1;
    const force = [
      body(0, ARMOUR, 20.5, 30.5), body(1, LIGHT, 21.5, 31.5), body(2, INFANTRY, 19.5, 29.5),
      body(3, INFANTRY, 19.5, 30.5), body(4, INFANTRY, 18.5, 31.5), body(5, MEDIC, 18.5, 30.5),
    ];
    const out = tiles(lay(force, 'E', W, H, [open(), veh]));
    expect(out).toEqual([[0, 20, 29], [1, 20, 32], [2, 18, 29], [3, 18, 31], [4, 18, 27], [5, 16, 29]]);
    for (const [id, x, y] of out) if (id <= 1) expect(veh[y * W + x]).toBe(0);
  });

  it('two assemblies whose rows would meet do not put two bodies on one tile', () => {
    // six rifle teams at y 20.5 and six at y 28.5, x 18.5..23.5: 8 tiles apart, so two assemblies. Facing E the rank runs
    // along y with lateral 0, +2, -2, +4, -4, +6: the first group stands on y 20 + {0,2,-2,4,-4,6} and the second on 28 + the same,
    // which both contain y 24 and y 26 on the same column.
    const mk = (id0: number, y: number): StartBody[] => [0, 1, 2, 3, 4, 5].map((i) => body(id0 + i, INFANTRY, 18.5 + i, y));
    const out = lay([...mk(0, 20.5), ...mk(6, 28.5)], 'E');
    const seen = new Set<string>();
    for (const [, x, y] of tiles(out)) {
      const key = `${x},${y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(12);
    // the first assembly is what it would be alone
    expect(tiles(out).slice(0, 6)).toEqual(tiles(lay(mk(0, 20.5), 'E')));
  });
});

describe('startLayout: the authored fallback tile is reserved (GH-1360 S3a review)', () => {
  it('a later assembly does not seat a body on the tile an earlier body kept', () => {
    // A: two tanks, ids 0 and 1, at (21.5,10.5)... y sum 25.0 / 2 -> click (21,12), a one-tile cell: its eight neighbours are
    // walls, so tank 1 has no slot and (no free spot) keeps its authored tile (21,14). B: nine rifle teams at y 22.5, x 17.5..25.5
    // (8 tiles from A, so a separate assembly), click (21,22), depth 0: lateral 0, +2, -2, +4, -4, +6, -6, +8, -8 -> y 22, 24,
    // 20, 26, 18, 28, 16, 30, 14. The last, (21,14), is tank 1's tile.
    const wall = open();
    for (let y = 11; y <= 13; y++) for (let x = 20; x <= 22; x++) if (!(x === 21 && y === 12)) wall[y * W + x] = 1;
    const a = [body(0, ARMOUR, 21.5, 10.5), body(1, ARMOUR, 21.5, 14.5)];
    const b = Array.from({ length: 9 }, (_, i) => body(2 + i, INFANTRY, 17.5 + i, 22.5));
    const out = lay([...a, ...b], 'E', W, H, [wall, wall], () => null);
    expect(out.slice(0, 2).map((p) => p.how)).toEqual(['slot', 'authored']);
    expect(tiles(out)[1]).toEqual([1, 21, 14]);
    const seen = new Set<string>();
    for (const [, x, y] of tiles(out)) {
      expect(seen.has(`${x},${y}`)).toBe(false);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(11);
  });
});

describe('startLayout: lateral overrun at a side edge (GH-1360 S3a review)', () => {
  it('a crowd at the west side edge facing S overflows past the map to the free spot, and stays on the map', () => {
    // 30 rifle teams in a 3 x 10 block at the west edge. Facing S the lateral axis is -x, so a rank has only the slots on the
    // map side of the click: about 5 of the 9 the depth estimate assumed. The ranks run out of map behind the click, and the
    // bodies with no slot ask the free spot at the click.
    const force = Array.from({ length: 30 }, (_, i) => body(i, INFANTRY, 0.5 + (i % 3), 0.5 + ((i - (i % 3)) / 3)));
    const asked: number[] = [];
    const out = lay(force, 'S', W, H, undefined, (id, x, y) => {
      asked.push(id);
      return [fx.add(x, fx.from(1)), y];
    });
    expect(asked.length).toBe(5); // measured: 25 of 30 find a slot
    expect(out.filter((p) => p.how === 'free').length).toBe(asked.length);
    for (const p of out.filter((q) => q.how === 'slot')) {
      expect(fx.toInt(p.x)).toBeGreaterThanOrEqual(0);
      expect(fx.toInt(p.y)).toBeGreaterThanOrEqual(0);
    }
    expect(out.filter((p) => p.how === 'slot').length + asked.length).toBe(30);
  });
});

describe('startLayout: a lone body and assemblies (GH-1360 S3a)', () => {
  it('a body 6+ tiles from the rest is its own assembly: it keeps its position and turns to the front', () => {
    const force = [body(0, ARMOUR, 10.5, 10.5), body(1, INFANTRY, 9.5, 10.5), body(2, INFANTRY, 38.5, 40.5)];
    const out = lay(force, 'N');
    expect(out[2]).toEqual({ id: 2, x: fx.from(38.5), y: fx.from(40.5), face: N, how: 'authored' });
    // the pair is laid out on its own: x 20.0/2 = 10, y 21.0/2 = 10; depth 2 (infantry forward -2), half 1; forward is -y,
    // the click (10, 10 - 1) = (10, 9); tank (10, 9), infantry two behind: (10, 11)
    expect(tiles(out).slice(0, 2)).toEqual([[0, 10, 9], [1, 10, 11]]);
  });

  it('the lone body is offered to the free spot at its authored point', () => {
    const asked: [number, Fx, Fx][] = [];
    const force = [body(0, INFANTRY, 5.5, 5.5), body(1, INFANTRY, 40.5, 40.5)];
    const out = lay(force, 'E', W, H, [open(), open()], (id, x, y) => {
      asked.push([id, x, y]);
      return [fx.add(x, fx.from(1)), y];
    });
    expect(asked).toEqual([[0, fx.from(5.5), fx.from(5.5)], [1, fx.from(40.5), fx.from(40.5)]]);
    expect(out.map((p) => p.how)).toEqual(['free', 'free']);
    expect(out[0].x).toBe(fx.from(6.5));
  });

  it('single-link: a chain of bodies 5 tiles apart is one assembly, 7 apart is two', () => {
    const chain = [body(0, INFANTRY, 10.5, 30.5), body(1, INFANTRY, 15.5, 30.5), body(2, INFANTRY, 20.5, 30.5)];
    expect(lay(chain, 'E').map((p) => p.how)).toEqual(['slot', 'slot', 'slot']);
    const apart = [body(0, INFANTRY, 10.5, 30.5), body(1, INFANTRY, 17.5, 30.5)];
    expect(lay(apart, 'E').map((p) => p.how)).toEqual(['authored', 'authored']);
  });
});

describe('startLayout: ids and order are unchanged (GH-1360 S3a)', () => {
  it('the result is index-aligned with the input, whatever the ids', () => {
    const force = [body(41, INFANTRY, 20.5, 20.5), body(7, ARMOUR, 21.5, 20.5), body(99, MEDIC, 20.5, 21.5), body(3, INFANTRY, 21.5, 21.5)];
    const copy = JSON.stringify(force);
    const out = lay(force, 'E');
    expect(out.map((p) => p.id)).toEqual([41, 7, 99, 3]);
    expect(JSON.stringify(force)).toBe(copy); // the input is not touched
    // ...and the slots follow the sorted fill, not the input order: the tank (id 7) takes the front rank
    const xOf = (id: number): number => fx.toInt(out.filter((p) => p.id === id)[0].x);
    expect(xOf(7)).toBeGreaterThan(xOf(41));
  });

  it('the same input twice gives the same bytes', () => {
    const force = [body(0, ARMOUR, 20.5, 20.5), body(1, INFANTRY, 21.5, 20.5), body(2, AIRCRAFT, 20.5, 21.5)];
    expect(JSON.stringify(lay(force, 'S'))).toBe(JSON.stringify(lay(force, 'S')));
  });
});
