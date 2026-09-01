// Slope, from an authored `elevation` grid to a unit taking the long way.
//
// `flowfield.test.ts` proves the cost term. This proves it MATTERS from the
// inputs the game actually has: a map JSON with an elevation grid, through
// `parseMap` and `applyTerrain`, into a real `move` order and a real walk. An
// elevation array hand-built in a test is not evidence that anything the
// authoring format can emit ever reaches the field.
//
// Every sloped case is paired with the identical map minus the elevation grid.
// "Went around" is also what a stuck unit, a mis-set goal or geometry that
// forced a detour anyway would produce; the flat control is what makes the
// assertion mean something. Same discipline as boulders.test.ts.
//
// What this file does NOT prove is the SIGN of the climb: both cases below pass
// unchanged with `elevation[tile] - elevation[n]` inverted, because an inverted
// sign shifts every cost by a term that depends only on the tile and the goal
// and so cannot reorder routes. The sign is pinned by the mirrored cost pair in
// packages/sim/src/flowfield.test.ts; the note at the top of that file has the
// measurement. Do not read a green run here as covering it.
//
// packages/sim imports nothing and packages/data is a leaf, so tools/ is the
// only place that may hold both ends of this.
import { describe, expect, it } from 'vitest';
import { applyTerrain, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, type UnitTypeJson } from '../../packages/sim/src/sim';

const RIFLES: UnitTypeJson = {
  id: 's_rifles',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
};

const W = 15;
const H = 9;

/**
 * Fifteen by nine of open ground. The relief, when present:
 *
 *   - a hilltop two levels up, columns 11-14, with the goal standing on it;
 *   - a spur FIVE levels up down column 7, rows 1-6 — higher than the hilltop
 *     itself, so crossing it is five levels bought and immediately thrown away;
 *   - the valley floor running past the spur's south end, rows 7-8.
 *
 * Nothing is blocked. Every route is walkable; they differ only in price. The
 * spur is deliberately asymmetric — one open row north of it, two south — so
 * the cheapest way round is a single unambiguous route (south, by 8 cost units)
 * rather than a tie the heap settles by tile index.
 */
function ridge(relief: boolean): MapJson {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) rows.push('.'.repeat(W));
  const map: MapJson = { id: relief ? 'spur' : 'spur_flat', name: 'Spur', width: W, height: H, rows };
  if (!relief) return map;
  const elevation: string[] = [];
  for (let y = 0; y < H; y++) {
    const spur = y >= 1 && y <= 6 ? '5' : '0';
    elevation.push(`0000000${spur}0002222`);
  }
  return { ...map, elevation };
}

/**
 * The spur's INTERIOR — rows 1-5. Standing on one of these is the only thing
 * that means "crossed the spur".
 *
 * Row 6, the southernmost tile, is deliberately not here, and the reason is
 * worth stating rather than quietly excluding: the route crosses at row 7 and
 * then turns north-east, and a diagonal step crosses one tile boundary a tick
 * before the other, so the unit's position clips (7,6) in passing. Slope is a
 * COST, not a wall — nothing clamps a unit off high ground the way the boulder
 * mask clamps a vehicle, and nothing should. A unit may stand on a hill; it
 * simply will not route over one to save distance.
 */
const SPUR_INTERIOR = [1, 2, 3, 4, 5].map((y) => y * W + 7);

interface Walk {
  tiles: Set<number>;
  rows: number[];
  end: [number, number];
}

/** One rifleman on the valley floor, ordered to the far hilltop. */
function walk(relief: boolean): Walk {
  const map = parseMap(ridge(relief));
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 4 });
  applyTerrain(map, sim);
  const id = sim.spawn(sim.addUnitType(RIFLES), 0, fx.from(1.5), fx.from(4.5));
  sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(12.5), y: fx.from(4.5) });
  const tiles = new Set<number>();
  const rows: number[] = [];
  for (let t = 0; t < 600; t++) {
    sim.tick();
    const x = sim.state.posX[id] >> 16;
    const y = sim.state.posY[id] >> 16;
    tiles.add(y * W + x);
    rows.push(y);
  }
  return { tiles, rows, end: [sim.state.posX[id] >> 16, sim.state.posY[id] >> 16] };
}

describe('an authored elevation grid reaches the flow field', () => {
  it('sends the approach around the spur rather than over it', () => {
    const w = walk(true);
    expect(SPUR_INTERIOR.filter((t) => w.tiles.has(t))).toEqual([]);
    // He went round the SOUTH end — the cheap side, and the one the asymmetry
    // was authored to make cheapest. Asserting WHICH way separates "priced the
    // terrain" from "avoided a tile".
    expect(Math.max(...w.rows)).toBeGreaterThanOrEqual(7);
    expect(Math.min(...w.rows)).toBe(4); // never north of where he started
    // And he arrived. Without this, "never crossed the spur" is satisfied by a
    // rifleman who never left his spawn.
    expect(w.end).toEqual([12, 4]);
  });

  it('and the identical ground with no elevation grid walks straight over it — the control', () => {
    // If THIS fails the test above proves nothing: the map's own geometry would
    // have sent him round column 7 whatever the elevation said.
    const w = walk(false);
    expect(w.tiles.has(4 * W + 7)).toBe(true);
    // Straight down row 4 and never off it — the flat route has no reason to
    // deviate, and this is the shape the sloped run must NOT have.
    expect(Math.max(...w.rows)).toBe(4);
    expect(Math.min(...w.rows)).toBe(4);
    expect(w.end).toEqual([12, 4]);
  });
});
