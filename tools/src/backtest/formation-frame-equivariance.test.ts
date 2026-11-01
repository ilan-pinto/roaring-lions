// GH-859 P1c: the first Attack order is rotation-equivariant on a point-symmetric map. A versus room puts the two
// ends at (x, y) and (W - x, H - y), so the east end's path for each placement row must be the west end's path
// turned through (x, y) -> (W - x, H - y). It was not: the template centroid was the mean of FLOORED tiles, which
// rounds both ends toward low x and y, so the end marching toward the origin started a tile further forward and
// every checkpoint was a tile nearer the enemy (diagnosis section 3.1: 15 of 15 members differed on wadi_tarfan and
// milh_flats at every seed read). The oracles are literals (15 members a side, 48-tile maps, three seeds); the
// only thing imported from the code under test is the world it builds. Falsified by restoring `fx.toInt` inside the
// template sum in sim.ts (the commit message quotes the counts).
import { describe, expect, it } from 'vitest';
import { humanHeldOf, layoutOf, order, seedOf, world } from './versus-probe';
import { versusAnchors } from '../../../packages/app/src/net/versus-seats';
import { versusSpawns } from '../../../packages/app/src/net/versus-force';

const ONE = 65536;
const MAPS = ['wadi_tarfan', 'milh_flats'] as const;
// seedOf(0), seedOf(1), seedOf(2): the seeds the diagnosis read.
const SEEDS = [1000, 8919, 16838] as const;

interface Twin { members: number; positionMismatches: number; pathMismatches: number; maxLegs: number; width: number; height: number }

/** Order both ends once (the probe's own `order()`, the Attack formation on both), tick once, and compare every
 *  east path with its west twin rotated through the map's centre. Values are raw Q16.16, compared exactly. */
function readTwins(mapId: (typeof MAPS)[number], seed: number): Twin {
  const arr = ['kdf', 'kdf'] as const;
  const { sim, typeOf, map } = world(mapId, seed, humanHeldOf('room', mapId, arr, seed));
  const { sideOfEnd, factions, ends } = layoutOf(arr);
  const force = versusSpawns(sim, typeOf, versusAnchors(map), factions, ends);
  const west = force.bySide[0];
  const east = force.bySide[1];
  // The starting tiles, read before the order is processed (a tick moves the units).
  let positionMismatches = 0;
  const W0 = map.width * ONE;
  const H0 = map.height * ONE;
  for (let k = 0; k < west.length; k++) {
    if (sim.state.posX[west[k]] !== W0 - sim.state.posX[east[k]] || sim.state.posY[west[k]] !== H0 - sim.state.posY[east[k]]) positionMismatches++;
  }
  order(sim, (s) => force.bySide[s], sideOfEnd, { id: 'attack', ends: [true, true] });
  sim.tick();
  const W = map.width * ONE;
  const H = map.height * ONE;
  const pathOf = (id: number): [number, number][] => {
    const out: [number, number][] = [sim.goalOf(id)];
    for (let k = 0; k < sim.waypointCount(id); k++) out.push(sim.waypointAt(id, k));
    return out;
  };
  let pathMismatches = 0;
  let maxLegs = 0;
  for (let k = 0; k < west.length; k++) {
    const i = west[k];
    const j = east[k];
    const pi = pathOf(i);
    const pj = pathOf(j).map(([x, y]) => [W - x, H - y]);
    maxLegs = Math.max(maxLegs, pi.length, pj.length);
    if (pi.length !== pj.length || pi.some((p, q) => p[0] !== pj[q][0] || p[1] !== pj[q][1])) pathMismatches++;
  }
  return { members: west.length === east.length ? west.length : -1, positionMismatches, pathMismatches, maxLegs, width: map.width, height: map.height };
}

describe('the first Attack order is rotation-equivariant on a point-symmetric map', () => {
  for (const mapId of MAPS) {
    for (const seed of SEEDS) {
      it(`${mapId}, seed ${seed}: all 15 members of the east end walk their west twin's path, turned through the centre`, () => {
        const r = readTwins(mapId, seed);
        // Non-vacuity: the world is the 15-a-side force on a 48-tile map, the two ends start as exact point
        // reflections (so a broken world cannot mask the paths), and the checkpoint code ran (a goal plus waypoints).
        expect(r.width).toBe(48);
        expect(r.height).toBe(48);
        expect(r.members).toBe(15);
        expect(r.positionMismatches).toBe(0);
        expect(r.maxLegs).toBeGreaterThan(1);
        expect(r.pathMismatches).toBe(0);
      });
    }
  }

  it('the seeds above are the probe\'s first three (the diagnosis read these)', () => {
    expect([seedOf(0), seedOf(1), seedOf(2)]).toEqual([...SEEDS]);
  });
});
