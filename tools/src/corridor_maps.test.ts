// F2 Task 5 (C-R6): the convoy route on a SHIPPED map. packages/sim reads no shipped JSON,
// so the one assertion that needs tel_marum lives here, beside the other map tests.
//
// tel_marum has no road tile and 16 boulders, so a route over it is the wheeled flow field's:
// the road branch never runs and the boulder corridor at x=10-11 is a wall to the convoy.
import { describe, expect, it } from 'vitest';
import { applyTerrain, DECOR, maps, parseMap, type MapJson } from '@lions/data';
import { DIR_DX, DIR_DY, FlowField } from '../../packages/sim/src/flowfield';
import { corridorRoute, makeRouteSource } from '../../packages/sim/src/corridor';
import { Sim } from '../../packages/sim/src/sim';

const raw = (maps as Record<string, MapJson>).tel_marum;
const map = parseMap(raw);
const sim = new Sim({ seed: 1, width: map.width, height: map.height, capacity: 4 });
applyTerrain(map, sim);
const W = map.width;

// The map's decor, read the way Task 7 will read it: 1 where it is a road.
const roadMask = new Uint8Array(map.decor.length);
for (let t = 0; t < roadMask.length; t++) roadMask[t] = map.decor[t] === DECOR.road ? 1 : 0;

/** The pure wheeled walk, written out here and not taken from the module under test. */
function flowWalk(fromTile: number, toTile: number): number[] | null {
  const f = new FlowField(W, map.height);
  f.compute(sim.blockedVehicle, sim.elevation, toTile % W, (toTile - (toTile % W)) / W);
  const out = [fromTile];
  for (let t = fromTile; t !== toTile; ) {
    const d = f.dirs[t];
    if (d === 255 || out.length > W * map.height) return null;
    t += DIR_DY[d] * W + DIR_DX[d];
    out.push(t);
  }
  return out;
}

const at = (name: string): { x: number; y: number } => {
  const m = map.markers[name];
  return { x: m[0], y: m[1] };
};
const tile = (p: { x: number; y: number }): number => p.y * W + p.x;

describe('corridorRoute on tel_marum (no road, 16 boulders)', () => {
  const src = makeRouteSource(W, map.height, sim.blockedVehicle, sim.elevation, roadMask);

  it('the map has no road tile and does carry the boulders the route must respect', () => {
    expect(roadMask.reduce((a, b) => a + b, 0)).toBe(0);
    expect(map.boulderCount).toBe(16);
    expect(sim.blockedVehicle).not.toBe(sim.blocked); // a second mask exists
  });

  for (const [from, to] of [
    ['start_line', 'battery_position'],
    ['start_line', 'sarim_west'],
    ['hollow', 'town_edge'],
  ] as const) {
    it(`${from} -> ${to} is exactly the wheeled flow walk, and never over a boulder`, () => {
      const r = corridorRoute(src, at(from), at(to));
      const expected = flowWalk(tile(at(from)), tile(at(to)));
      expect(expected).not.toBeNull();
      expect(r).not.toBeNull();
      expect(Array.from(r ?? [])).toEqual(expected);
      for (const t of r ?? []) {
        expect(map.boulder[t]).toBe(0);
        expect(map.blocked[t]).toBe(0);
      }
    });
  }

  it('a destination inside the boulder corridor has no wheeled route (D4 a)', () => {
    // (10,14) is `b`: open on foot, a wall to anything on wheels.
    expect(map.boulder[14 * W + 10]).toBe(1);
    expect(corridorRoute(src, at('start_line'), { x: 10, y: 14 })).toBeNull();
  });
});
