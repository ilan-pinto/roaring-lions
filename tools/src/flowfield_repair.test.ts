// WP-L2 (GH-913): `FlowField.repair` brings a field up to date after tiles flip, and must leave EXACTLY the
// bytes a full `compute` would -- `dirs` and every cost -- or a unit follows a route no fresh field would
// give it, and a replay diverges. Held to the frozen heap implementation (`flowfield_oracle.ts`), which
// shares no code with the repair.
//
// Two layers:
//  1. the field alone: sequences of closings and openings (rectangles of 1..4 tiles, goal tiles included)
//     on every shipped map, on foot and on wheels, on 80x80 stretches, and on seeded random walls and relief;
//  2. the sim: real structures stood, collapsed (`debugDestroyStructure`), cancelled (`removeStructure`) and
//     raised (`addStructure`) over fields that living units follow, on every shipped map and an 80x80,
//     comparing every cached field with the oracle after EVERY op.
//
// FALSIFIED when written (and again in the commit message): the sim skipping one flipped tile in the list it
// hands the repair turns layer 2 red; `repair` skipping one changed tile turns layer 1 red. The per-test
// assertions that the repair really ran (not just fell back to `compute`) are what keep a "fallback always"
// implementation, which is trivially exact, from passing.
import { describe, expect, it, vi } from 'vitest';
import { applyTerrain, parseMap, maps, structures as structureCatalogue, units, type MapJson } from '@lions/data';
import { DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, unitTypeFromJson, type UnitTypeJson } from '../../packages/sim/src/sim';
import { fx } from '../../packages/sim/src/fixed';
import { OracleFlowField } from './flowfield_oracle';
import { goalsOn, prng, randomTerrain, shippedTerrains, stretched, type Terrain } from './flowfield_terrain';

function firstDifference(want: OracleFlowField, got: FlowField, cells: number): string | null {
  if (want.goalX !== got.goalX || want.goalY !== got.goalY) return `goal (${want.goalX},${want.goalY}) vs (${got.goalX},${got.goalY})`;
  for (let t = 0; t < cells; t++) {
    if (want.dirs[t] !== got.dirs[t]) return `tile ${t}: dirs ${want.dirs[t]} vs ${got.dirs[t]} (cost ${want.costAt(t)} vs ${got.costAt(t)})`;
    if (want.costAt(t) !== got.costAt(t)) return `tile ${t}: cost ${want.costAt(t)} vs ${got.costAt(t)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Layer 1: the field alone.

interface Stats {
  ops: number;
  repaired: number; // ops the repair handled itself
  fellBack: number; // ops that returned -1
  touched: number; // cost re-derivations across all repaired ops
  nonTrivial: number; // repaired ops that changed at least one cost
}

/**
 * `scatter` flips a random walk of 1..12 tiles from the seed tile (L-shapes, diagonal chains, gaps, a tile
 * stepped onto twice) instead of a rectangle: real structures are any tile list. The rectangle path draws
 * exactly the numbers it did before, so only the scattered cases are new.
 */
function sequence(label: string, t: Terrain, mask0: Uint8Array, goalCount: number, opCount: number, seed: number, stats: Stats, scatter = false): void {
  const { w, h, elevation } = t;
  const r = prng(seed);
  const goals = goalsOn(mask0, goalCount);
  for (const g of goals) {
    const mask = new Uint8Array(mask0);
    const field = new FlowField(w, h);
    const oracle = new OracleFlowField(w, h);
    field.compute(mask, elevation, g % w, Math.floor(g / w));
    const changed = new Int32Array(64);
    for (let op = 0; op < opCount; op++) {
      const opening = r() < 0.45;
      // A rectangle of 1..4 x 1..4 tiles, centred near a random tile of the wanted kind.
      let seedTile = -1;
      for (let tries = 0; tries < 40 && seedTile < 0; tries++) {
        const c = Math.floor(r() * w * h);
        if ((mask[c] !== 0) === opening) seedTile = c;
      }
      if (seedTile < 0) continue;
      // Half the time aim at the goal's neighbourhood, where a repair has the most to lose.
      if (r() < 0.25) {
        const gxx = g % w;
        const gyy = Math.floor(g / w);
        const nx = Math.min(w - 1, Math.max(0, gxx + Math.floor(r() * 7) - 3));
        const ny = Math.min(h - 1, Math.max(0, gyy + Math.floor(r() * 7) - 3));
        if ((mask[ny * w + nx] !== 0) === opening) seedTile = ny * w + nx;
      }
      let n = 0;
      if (scatter) {
        let cx = seedTile % w;
        let cy = Math.floor(seedTile / w);
        const steps = 1 + Math.floor(r() * 12);
        for (let k = 0; k < steps; k++) {
          const tile = cy * w + cx;
          if ((mask[tile] !== 0) === opening) {
            mask[tile] = opening ? 0 : 1;
            changed[n++] = tile;
          }
          // Step to any of the 8 neighbours, or jump two tiles, staying on the map.
          const reach = r() < 0.2 ? 2 : 1;
          cx = Math.min(w - 1, Math.max(0, cx + (Math.floor(r() * 3) - 1) * reach));
          cy = Math.min(h - 1, Math.max(0, cy + (Math.floor(r() * 3) - 1) * reach));
        }
      } else {
        const rw = 1 + Math.floor(r() * 4);
        const rh = 1 + Math.floor(r() * 4);
        const x0 = Math.min(w - rw, seedTile % w);
        const y0 = Math.min(h - rh, Math.floor(seedTile / w));
        for (let y = y0; y < y0 + rh; y++) {
          for (let x = x0; x < x0 + rw; x++) {
            const tile = y * w + x;
            if ((mask[tile] !== 0) === opening) {
              mask[tile] = opening ? 0 : 1;
              changed[n++] = tile;
            }
          }
        }
      }
      if (n === 0) continue;
      const before = field.costAt(0);
      void before;
      const result = field.repair(mask, elevation, changed, n, opening);
      oracle.compute(mask, elevation, g % w, Math.floor(g / w));
      const diff = firstDifference(oracle, field, w * h);
      if (diff !== null) throw new Error(`${label}: goal ${g}, op ${op} (${opening ? 'open' : 'close'} ${n} tiles): ${diff}`);
      stats.ops++;
      if (result < 0) stats.fellBack++;
      else {
        stats.repaired++;
        stats.touched += result;
        if (result > 0) stats.nonTrivial++;
      }
    }
  }
}

function fresh(): Stats {
  return { ops: 0, repaired: 0, fellBack: 0, touched: 0, nonTrivial: 0 };
}

function expectRealRepairs(s: Stats): void {
  expect(s.ops).toBeGreaterThan(50);
  // A repair that always fell back to `compute` is exact and worthless; most ops must be the repair itself.
  expect(s.repaired).toBeGreaterThan(s.ops * 0.6);
  expect(s.nonTrivial).toBeGreaterThan(s.ops * 0.1);
}

const shipped = shippedTerrains();

describe('FlowField.repair equals a full recompute', { timeout: 240_000 }, () => {
  for (const t of shipped) {
    it(`${t.id} (${t.w}x${t.h}): closings and openings, foot and wheels`, () => {
      const stats = fresh();
      sequence(`${t.id} foot`, t, t.foot, 12, 14, 101, stats);
      sequence(`${t.id} wheels`, t, t.wheels, 8, 14, 202, stats);
      expectRealRepairs(stats);
    });
  }

  for (const id of ['wadi_tarfan', 'milh_flats', 'tel_marum', 'qarn_hadid']) {
    it(`${id} stretched to 80x80`, () => {
      const src = shipped.find((s) => s.id === id);
      if (src === undefined) throw new Error(`no shipped map ${id}`);
      const t = stretched(src, 80);
      const stats = fresh();
      sequence(`${t.id} foot`, t, t.foot, 14, 18, 303, stats);
      sequence(`${t.id} wheels`, t, t.wheels, 10, 18, 404, stats);
      expectRealRepairs(stats);
    });
  }

  it('seeded random walls, boulders and relief, including relief that uses the whole byte', () => {
    const stats = fresh();
    for (let seed = 1; seed <= 10; seed++) {
      const size = seed % 2 === 0 ? 40 : 27;
      const t = randomTerrain(`rnd${seed}`, size, size + (seed % 3), seed * 31, 4 + seed * 3, seed % 3 === 0 ? 5 : 0, seed % 4 === 0 ? 255 : 9);
      sequence(`rnd${seed}`, t, t.foot, 10, 20, seed * 977, stats);
      sequence(`rnd${seed} wheels`, t, t.wheels, 6, 20, seed * 1013, stats);
    }
    expectRealRepairs(stats);
  });

  it('scattered, non-rectangular flips (random walks of 1..12 tiles) on shipped and random terrain', () => {
    const stats = fresh();
    for (const t of shipped) {
      sequence(`${t.id} foot scatter`, t, t.foot, 10, 20, 515, stats, true);
      sequence(`${t.id} wheels scatter`, t, t.wheels, 6, 20, 626, stats, true);
    }
    for (let seed = 1; seed <= 8; seed++) {
      const size = seed % 2 === 0 ? 36 : 25;
      const t = randomTerrain(`scat${seed}`, size, size + (seed % 3), seed * 53, 4 + seed * 3, seed % 3 === 0 ? 5 : 0, seed % 4 === 0 ? 255 : 9);
      sequence(`scat${seed}`, t, t.foot, 10, 25, seed * 1409, stats, true);
    }
    expectRealRepairs(stats);
  });

  it('the goal itself: closed, reopened, walled in, and a field that never had one', () => {
    const t = randomTerrain('g', 24, 24, 5, 10, 0, 4);
    const w = t.w;
    const goal = goalsOn(t.foot, 1)[0];
    const mask = new Uint8Array(t.foot);
    const field = new FlowField(t.w, t.h);
    const oracle = new OracleFlowField(t.w, t.h);
    field.compute(mask, t.elevation, goal % w, Math.floor(goal / w));
    const check = (): void => {
      oracle.compute(mask, t.elevation, goal % w, Math.floor(goal / w));
      expect(firstDifference(oracle, field, t.w * t.h)).toBeNull();
    };
    mask[goal] = 1; // the goal tile closes: the field becomes all-unreachable
    field.repair(mask, t.elevation, [goal], 1, false);
    check();
    expect(field.dirs.every((d) => d === DIR_NONE)).toBe(true);
    mask[goal] = 0; // and reopens
    field.repair(mask, t.elevation, [goal], 1, true);
    check();
    // wall the goal in on all sides (one op), then break one wall out again
    const ring: number[] = [];
    const gx = goal % w;
    const gy = Math.floor(goal / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = gx + dx;
        const y = gy + dy;
        if ((dx !== 0 || dy !== 0) && x >= 0 && y >= 0 && x < w && y < t.h && mask[y * w + x] === 0) {
          mask[y * w + x] = 1;
          ring.push(y * w + x);
        }
      }
    }
    field.repair(mask, t.elevation, ring, ring.length, false);
    check();
    mask[ring[0]] = 0;
    field.repair(mask, t.elevation, [ring[0]], 1, true);
    check();
    // A field computed toward a blocked goal has no goal to repair around: repairing it is a recompute.
    const dead = new FlowField(t.w, t.h);
    const blockedTile = mask.findIndex((v) => v !== 0);
    dead.compute(mask, t.elevation, blockedTile % w, Math.floor(blockedTile / w));
    mask[blockedTile] = 0;
    dead.repair(mask, t.elevation, [blockedTile], 1, true);
    oracle.compute(mask, t.elevation, blockedTile % w, Math.floor(blockedTile / w));
    expect(firstDifference(oracle, dead, t.w * t.h)).toBeNull();
  });

  it('a change large enough to give up still ends exact (the quarter-map fallback)', () => {
    const t = randomTerrain('open', 30, 30, 1, 0, 0, 0);
    const mask = new Uint8Array(t.foot);
    const field = new FlowField(30, 30);
    const oracle = new OracleFlowField(30, 30);
    field.compute(mask, t.elevation, 2, 2);
    // Wall off most of the map but a gap, so far more than a quarter of the tiles lose their route.
    const changed: number[] = [];
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        if (x === 8 && y !== 15) {
          mask[y * 30 + x] = 1;
          changed.push(y * 30 + x);
        }
      }
    }
    const result = field.repair(mask, t.elevation, changed, changed.length, false);
    expect(result).toBe(-1);
    oracle.compute(mask, t.elevation, 2, 2);
    expect(firstDifference(oracle, field, 900)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Layer 2: the sim. Real structures, real collapses, fields that living units follow.

const RIFLES = Object.values(units).find((u) => u.role === 'infantry') as unknown as UnitTypeJson;

function wheeledType(): UnitTypeJson {
  for (const u of Object.values(units)) {
    const j = u as UnitTypeJson;
    const ty = unitTypeFromJson(j);
    if (ty.wheeled && ty.pathDomain === 1) return j;
  }
  throw new Error('no wheeled unit in @lions/data');
}

interface World {
  sim: Sim;
  w: number;
  h: number;
  typeIdx: Map<string, number>;
  footIds: number[];
  vehIds: number[];
}

function privates(sim: Sim): { fields: FlowField[]; fieldByGoal: Map<number, number>[] } {
  const p = sim as unknown as { fields: FlowField[]; fieldByGoal: Map<number, number>[] };
  return { fields: p.fields, fieldByGoal: p.fieldByGoal };
}

/** Every cached field against a fresh oracle computed on the sim's own masks. Returns how many it checked. */
function verify(label: string, world: World): number {
  const { sim, w, h } = world;
  const { fields, fieldByGoal } = privates(sim);
  const oracle = new OracleFlowField(w, h);
  let checked = 0;
  for (let d = 0; d < 2; d++) {
    const mask = d === 1 ? sim.blockedVehicle : sim.blocked;
    for (const [goal, idx] of fieldByGoal[d]) {
      oracle.compute(mask, sim.elevation, goal % w, Math.floor(goal / w));
      const diff = firstDifference(oracle, fields[idx], w * h);
      if (diff !== null) throw new Error(`${label}: domain ${d} goal ${goal}: ${diff}`);
      checked++;
    }
  }
  return checked;
}

function registerAll(sim: Sim): Map<string, number> {
  const typeIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) typeIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  return typeIdx;
}

/** Spawn `n` units of each kind at an open tile and order each to its own goal, so every goal's field is followed. */
function issueOrders(world: World, nFoot: number, nVeh: number): void {
  const { sim, w } = world;
  const rifle = sim.addUnitType(RIFLES);
  const wheeled = sim.addUnitType(wheeledType());
  const home = sim.blocked.findIndex((v, i) => v === 0 && sim.blockedVehicle[i] === 0);
  const spawnAt = (tile: number, type: number): number => sim.spawn(type, 0, fx.from(tile % w) + fx.from(0.5), fx.from(Math.floor(tile / w)) + fx.from(0.5));
  const order = (id: number, tile: number): void =>
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(tile % w) + fx.from(0.5), y: fx.from(Math.floor(tile / w)) + fx.from(0.5), exact: true });
  for (const g of goalsOn(sim.blocked, nFoot)) {
    const id = spawnAt(home, rifle);
    world.footIds.push(id);
    order(id, g);
  }
  for (const g of goalsOn(sim.blockedVehicle, nVeh)) {
    const id = spawnAt(home, wheeled);
    world.vehIds.push(id);
    order(id, g);
  }
  sim.tick();
}

function shippedWorld(id: string): World {
  const map = parseMap((maps as Record<string, MapJson>)[id]);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const typeIdx = registerAll(sim);
  for (const b of map.structures) sim.addStructure(typeIdx.get(b.type) as number, b.tiles);
  const world: World = { sim, w: map.width, h: map.height, typeIdx, footIds: [], vehIds: [] };
  issueOrders(world, 30, 12);
  return world;
}

function stretchedWorld(srcId: string, size: number): World {
  const src = shipped.find((s) => s.id === srcId) as Terrain;
  const t = stretched(src, size);
  const sim = new Sim({ seed: 12, width: size, height: size, capacity: 256 });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (t.foot[i] !== 0) sim.setBlocked(x, y, true);
      else if (t.wheels[i] !== 0) sim.setBoulder(x, y, true);
      if (t.elevation[i] !== 0) sim.setElevation(x, y, t.elevation[i]);
    }
  }
  const typeIdx = registerAll(sim);
  // Buildings: 2x2 and 1x3 footprints on open ground, spread over the map.
  const r = prng(77);
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 24; tries++) {
    const x = 1 + Math.floor(r() * (size - 4));
    const y = 1 + Math.floor(r() * (size - 4));
    const tiles = r() < 0.5 ? [y * size + x, y * size + x + 1, (y + 1) * size + x, (y + 1) * size + x + 1] : [y * size + x, y * size + x + 1, y * size + x + 2];
    if (tiles.every((tl) => sim.blocked[tl] === 0)) {
      sim.addStructure(typeIdx.get('house') as number, tiles);
      placed++;
    }
  }
  const world: World = { sim, w: size, h: size, typeIdx, footIds: [], vehIds: [] };
  issueOrders(world, 40, 16);
  return world;
}

/** Collapse every structure in turn, raise each back, cancel half, raise new ones on open ground; verify after each op. */
function churn(label: string, world: World, repairs: { calls: number; fellBack: number }): number {
  const { sim, w, h } = world;
  let checked = verify(`${label} initial`, world);
  const count = sim.structureCount;
  const inner = sim as unknown as { stTiles: number[][]; stTypeIdx: Uint8Array | number[] };
  const tilesOf: number[][] = [];
  const typeOf: number[] = [];
  for (let s = 0; s < count; s++) {
    tilesOf.push([...inner.stTiles[s]]);
    typeOf.push(inner.stTypeIdx[s]);
  }
  const limit = Math.min(count, 10);
  for (let s = 0; s < limit; s++) {
    if (tilesOf[s].length === 0) continue;
    sim.debugDestroyStructure(s); // a real collapse
    checked += verify(`${label} collapse ${s}`, world);
  }
  for (let s = 0; s < limit; s++) {
    if (tilesOf[s].length === 0) continue;
    if (tilesOf[s].some((t) => sim.blocked[t] !== 0)) continue;
    const id = sim.addStructure(typeOf[s], tilesOf[s]); // raised again, over fields that learned the gap
    checked += verify(`${label} raise ${s}`, world);
    if (s % 2 === 0) {
      sim.removeStructure(id); // and half cancelled
      checked += verify(`${label} cancel ${s}`, world);
    }
  }
  // New structures on open ground, near goals and away from them.
  const r = prng(555);
  for (let k = 0; k < 10; k++) {
    const x = 1 + Math.floor(r() * (w - 3));
    const y = 1 + Math.floor(r() * (h - 3));
    const tiles = [y * w + x, y * w + x + 1, (y + 1) * w + x, (y + 1) * w + x + 1];
    if (!tiles.every((tl) => sim.blocked[tl] === 0)) continue;
    sim.addStructure(world.typeIdx.get('wall') as number, tiles);
    checked += verify(`${label} stake ${k}`, world);
  }
  void repairs;
  return checked;
}

describe('the sim repairs followed fields exactly across real collapses', { timeout: 240_000 }, () => {
  const ids = Object.keys(maps).sort();
  it('has the maps it claims to', () => {
    expect(ids.length).toBeGreaterThanOrEqual(30);
  });

  for (const id of ids) {
    it(`${id}: collapse, raise, cancel and stake over followed fields`, () => {
      const spy = vi.spyOn(FlowField.prototype, 'repair');
      try {
        const world = shippedWorld(id);
        const followed = privates(world.sim).fieldByGoal.reduce((n, m) => n + m.size, 0);
        expect(followed).toBeGreaterThan(8);
        const checked = churn(id, world, { calls: 0, fellBack: 0 });
        expect(checked).toBeGreaterThan(followed);
        // The repair really ran (a sim that always recomputed in full is exact and proves nothing).
        expect(spy.mock.calls.length).toBeGreaterThan(followed);
        const fell = spy.mock.results.filter((r) => r.type === 'return' && r.value === -1).length;
        expect(fell).toBeLessThan(spy.mock.calls.length * 0.5);
      } finally {
        spy.mockRestore();
      }
    });
  }

  it('a structure op begun inside another recomputes in full instead of trusting either list', () => {
    // Nothing in the sim nests two structure ops today, so the guard is reached here by opening an op by hand.
    // Without it the inner op would see an empty flip list, repair nothing, and leave every field stale.
    const world = stretchedWorld('wadi_tarfan', 80);
    const { sim, w } = world;
    const inner = sim as unknown as { beginFlips(n: number): void; recomputeFields(change: 'all' | 'closed' | 'opened'): void };
    inner.beginFlips(4);
    let spot = -1;
    for (let t = 2 * w + 2; t < 78 * w && spot < 0; t++) {
      if ([t, t + 1, t + w, t + w + 1].every((tl) => sim.blocked[tl] === 0 && sim.blockedVehicle[tl] === 0)) spot = t;
    }
    sim.addStructure(world.typeIdx.get('wall') as number, [spot, spot + 1, spot + w, spot + w + 1]);
    expect(verify('nested op', world)).toBeGreaterThan(20);
    inner.recomputeFields('closed'); // end the op opened by hand: the flip bookkeeping is shared by every Sim in the process
    expect(verify('after the outer op ends', world)).toBeGreaterThan(20);
  });

  for (const id of ['wadi_tarfan', 'tel_marum', 'qarn_hadid', 'milh_flats']) {
    it(`${id} stretched to 80x80, 40 foot and 16 wheeled fields`, () => {
      const spy = vi.spyOn(FlowField.prototype, 'repair');
      try {
        const world = stretchedWorld(id, 80);
        const checked = churn(`${id}@80`, world, { calls: 0, fellBack: 0 });
        expect(checked).toBeGreaterThan(500);
        expect(spy.mock.calls.length).toBeGreaterThan(300);
        const fell = spy.mock.results.filter((r) => r.type === 'return' && r.value === -1).length;
        expect(fell).toBeLessThan(spy.mock.calls.length * 0.5);
      } finally {
        spy.mockRestore();
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// A throw inside a structure op's flip window. `flipDepth` is MODULE state shared by every Sim in the process,
// so a throw between `beginFlips` and `recomputeFields` that left it raised would make every later structure op
// in the process look nested and recompute in full for good: still exact, so nothing but the repair counters
// below can see it. The `try/finally` in the three ops unwinds it; each case arms ONE op to throw after its
// first tile, then runs an ordinary op and requires that it REPAIRED (the repair ran, and nothing but the
// repair's own give-up fallback called `compute`).
describe('a throw inside a structure op does not leak the flip window', { timeout: 240_000 }, () => {
  /** A copy of `tiles` that throws when iterated past its first element. */
  function armed(tiles: readonly number[]): number[] {
    const a = [...tiles];
    Object.defineProperty(a, 1, {
      get(): number {
        throw new Error('boom inside the flip window');
      },
    });
    return a;
  }

  function openSpot(world: World, from: number): number {
    const { sim, w } = world;
    for (let t = from; t < 78 * w; t++) {
      if ([t, t + 1, t + w, t + w + 1].every((tl) => sim.blocked[tl] === 0 && sim.blockedVehicle[tl] === 0)) return t;
    }
    throw new Error('no open 2x2 on the map');
  }

  for (const op of ['addStructure', 'removeStructure', 'debugDestroyStructure'] as const) {
    it(`${op} throwing leaves later ops repairing, and the fields exact`, () => {
      const world = stretchedWorld('wadi_tarfan', 80);
      const { sim, w } = world;
      const wall = world.typeIdx.get('wall') as number;
      const quad = (t: number): number[] => [t, t + 1, t + w, t + w + 1];
      const first = openSpot(world, 2 * w + 2);
      const inner = sim as unknown as { stTiles: number[][] };
      let ownId = -1;
      if (op === 'addStructure') {
        expect(() => sim.addStructure(wall, armed(quad(first)))).toThrow('boom inside the flip window');
      } else {
        ownId = sim.addStructure(wall, quad(first));
        inner.stTiles[ownId] = armed(quad(first));
        expect(() => (op === 'removeStructure' ? sim.removeStructure(ownId) : sim.debugDestroyStructure(ownId))).toThrow('boom inside the flip window');
      }
      // The throw left some tiles written; the abort path must have brought every followed field up to date.
      expect(verify(`after ${op} threw`, world)).toBeGreaterThan(20);

      const repair = vi.spyOn(FlowField.prototype, 'repair');
      const compute = vi.spyOn(FlowField.prototype, 'compute');
      try {
        // An ordinary op, well away from the first.
        const second = openSpot(world, first + 8 * w);
        sim.addStructure(wall, quad(second));
        const gaveUp = repair.mock.results.filter((r) => r.type === 'return' && r.value === -1).length;
        // The repair ran for the followed fields, and every `compute` was a repair giving up: none was the sim recomputing.
        expect(repair.mock.calls.length).toBeGreaterThan(20);
        expect(compute.mock.calls.length).toBe(gaveUp);
        expect(verify(`after the op following ${op} threw`, world)).toBeGreaterThan(20);
      } finally {
        repair.mockRestore();
        compute.mockRestore();
      }
    });
  }
});
