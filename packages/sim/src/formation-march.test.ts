// GH-859 P1b Task 3: the MARCH. A formation order walks a route field from the group's centroid to the
// click, cuts it into checkpoints, gives every member its slot at each one, holds a member that arrives
// early until the group is dressed (or three seconds have passed), caps the whole group at its slowest
// ground member's pace, reserves the final slots against later orders, and turns a hull to its rest
// facing only on the last leg. Every world is hand-built and every expectation is a literal
// (casebook: "the oracle imported its arguments"); a table of cases asserts its own length.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import type { FormationJson } from './formation-template';
import { RIFLES, SHED, TANK } from './golden-worlds.test-helper';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const loadFormation = (id: string): FormationJson => JSON.parse(readFileSync(join(ROOT, 'data', 'formations', `${id}.json`), 'utf8')) as FormationJson;

// ---- unit types (all test-local) ----------------------------------------------------------
const MBT: UnitTypeJson = { ...TANK, id: 'fm3_mbt', role: 'mbt', mobility: { speed_tiles_s: 1.1, turn_rate_deg_s: 60 } };
/** A slow foot team: 0.5 tiles a second against the rifles' 0.9 and the tank's 1.1. */
const SLOW: UnitTypeJson = { ...RIFLES, id: 'fm3_slow', mobility: { speed_tiles_s: 0.5 } };
const MORTAR: UnitTypeJson = { ...RIFLES, id: 'fm3_mortar', role: 'artillery', mobility: { speed_tiles_s: 0.5 } };
const AIR: UnitTypeJson = {
  id: 'fm3_air',
  hull: { hp: 100, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { domain: 'air', speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  weapons: [],
};
const JEEP: UnitTypeJson = {
  id: 'fm3_jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};
/** An unarmed enemy: it is something to attack and shoots at nobody. */
const DUMMY: UnitTypeJson = { ...RIFLES, id: 'fm3_dummy', weapons: [], abilities: [], hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } } };

// ---- test-local formation files -----------------------------------------------------------
const column = loadFormation('column');
/** The shipped Column with no checkpoints: pace applies and nothing dresses. */
const COLUMN_NOLEGS: FormationJson = { ...column, id: 'column_nolegs', march: { legs: false, leg_tiles: 8, pace: 'slowest_ground', dress_s: 3 } };
/** The shipped Column with the longest dress the schema allows: ten seconds, so a test has time to act on a waiting member. */
const COLUMN_DRESS10: FormationJson = { ...column, id: 'column_dress10', march: { legs: true, leg_tiles: 8, pace: 'slowest_ground', dress_s: 10 } };
/** The shipped Column that never paces. */
const COLUMN_NOPACE: FormationJson = { ...column, id: 'column_nopace', march: { legs: true, leg_tiles: 8, pace: 'none', dress_s: 3 } };
/** The shipped Column resting facing OUTWARD from its anchor, with a ten-second dress: a rear rank rests facing south
 *  while it marches north. */
const COLUMN_OUTWARD: FormationJson = { ...column, id: 'column_outward', arrival: { face: 'outward', stance: 'none' }, march: { legs: true, leg_tiles: 8, pace: 'slowest_ground', dress_s: 10 } };

interface World {
  sim: Sim;
  mbt: number;
  inf: number;
  slow: number;
  mor: number;
  air: number;
  jeep: number;
  dummy: number;
  events: SimEvent[];
}
function world(opts: { w?: number; h?: number; register?: boolean; cap?: number } = {}): World {
  const sim = new Sim({ seed: 0x8593, width: opts.w ?? 48, height: opts.h ?? 48, capacity: opts.cap ?? 128 });
  const w: World = {
    sim,
    mbt: sim.addUnitType(MBT),
    inf: sim.addUnitType(RIFLES),
    slow: sim.addUnitType(SLOW),
    mor: sim.addUnitType(MORTAR),
    air: sim.addUnitType(AIR),
    jeep: sim.addUnitType(JEEP),
    dummy: sim.addUnitType(DUMMY),
    events: [],
  };
  if (opts.register !== false) {
    for (const id of ['column', 'attack', 'ambush']) sim.addFormationType(loadFormation(id));
    for (const f of [COLUMN_NOLEGS, COLUMN_DRESS10, COLUMN_NOPACE, COLUMN_OUTWARD]) sim.addFormationType(f);
  }
  return w;
}
const at = (n: number): number => fx.from(n + 0.5);
function spawnAt(w: World, type: number, side: number, x: number, y: number): number {
  return w.sim.spawn(type, side, at(x), at(y), 0);
}
function tick(w: World, n = 1): void {
  for (let i = 0; i < n; i++) for (const e of w.sim.tick()) w.events.push(e);
}
const kinds = (w: World, kind: string): SimEvent[] => w.events.filter((e) => e.kind === kind);

interface Priv {
  goalX: Int32Array;
  goalY: Int32Array;
  posX: Int32Array;
  posY: Int32Array;
  wpX: Int32Array;
  wpY: Int32Array;
  wpCount: Uint8Array;
  moving: Uint8Array;
  sweepOrder: Uint8Array;
  attackMove: Uint8Array;
  facing: Uint16Array;
  restFacing: Uint16Array;
  fmLive: boolean;
  fmLeg: Uint8Array;
  fmDuty: Uint8Array;
  fmHomeX: Int32Array;
  fmHomeY: Int32Array;
  fgLegs: Uint8Array;
  fgRelease: Uint8Array;
  fgDress: Uint16Array;
  fgQuiet: Uint16Array;
  fgAtCp: Uint16Array;
  fgAway: Uint16Array;
  fgCalled: Uint8Array;
  fgPace: Int32Array;
  fgCallX: Int32Array;
  fgCallY: Int32Array;
  sepWait: Uint8Array;
  fgState: Uint8Array;
  fgLive: Uint8Array;
  lastSeenValid: Uint8Array;
  lastSeenX: Int32Array;
  lastSeenY: Int32Array;
}
const priv = (sim: Sim): Priv => sim as unknown as Priv;
const tileOf = (v: number): number => v >> 16;
const goalTile = (sim: Sim, id: number): [number, number] => [tileOf(priv(sim).goalX[id]), tileOf(priv(sim).goalY[id])];
/** The queued checkpoints (waypoints 2..n) of a unit, as tiles. */
const queueTiles = (sim: Sim, id: number): [number, number][] => {
  const p = priv(sim);
  const out: [number, number][] = [];
  for (let k = 0; k < p.wpCount[id]; k++) out.push([tileOf(p.wpX[id * 8 + k]), tileOf(p.wpY[id * 8 + k])]);
  return out;
};
/** The tile a unit finally comes to rest on: its last queued tile, else its goal. */
const finalTile = (sim: Sim, id: number): [number, number] => {
  const q = queueTiles(sim, id);
  return q.length > 0 ? q[q.length - 1] : goalTile(sim, id);
};
const order = (w: World, ids: number[], formation: string | undefined, to: [number, number], kind: 'move' | 'attackMove' = 'move', over: Record<string, unknown> = {}): void => {
  w.sim.queueCommand({ kind, ids, x: at(to[0]), y: at(to[1]), ...(formation === undefined ? {} : { formation }), ...over } as never);
};
/** Wall the whole map except the listed tiles. */
function wallExcept(w: World, open: (x: number, y: number) => boolean): void {
  for (let y = 0; y < w.sim.height; y++) for (let x = 0; x < w.sim.width; x++) if (!open(x, y)) w.sim.setBlocked(x, y, true);
}

// ---------------------------------------------------------------------------------------------
describe('byte identity: with no formation ordered, nothing about the march exists', () => {
  /** A scripted skirmish with plain orders (queued waypoints included), hashed every 50 ticks. */
  function run(register: boolean): { hashes: number[]; live: boolean } {
    const w = world({ register });
    const west = [0, 1, 2, 3].map((k) => spawnAt(w, w.inf, 0, 6, 10 + 3 * k));
    const tanks = [spawnAt(w, w.mbt, 0, 4, 20), spawnAt(w, w.mbt, 0, 4, 26)];
    const east = [0, 1, 2].map((k) => spawnAt(w, w.inf, 1, 40, 12 + 4 * k));
    const out: number[] = [];
    for (let t = 0; t < 500; t++) {
      if (t === 5) order(w, west, undefined, [20, 18]);
      if (t === 6) order(w, west, undefined, [24, 30], 'move', { append: true });
      if (t === 10) order(w, [...tanks, ...west], undefined, [30, 22], 'attackMove');
      if (t === 60) order(w, east, undefined, [12, 20], 'attackMove');
      tick(w);
      if (t % 50 === 49) out.push(w.sim.hash());
    }
    return { hashes: out, live: priv(w.sim).fmLive };
  }
  it('registering the shipped and test files changes no hash over 500 ticks of plain orders', () => {
    const plain = run(false);
    const reg = run(true);
    expect(plain.hashes).toHaveLength(10);
    expect(reg.hashes).toEqual(plain.hashes);
    expect(reg.live).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('route and checkpoints', () => {
  /** Three tanks and three riflemen stacked at (24, 44), ordered up the open map to (24, 14): 30 route steps. */
  function thirty(): { w: World; ids: number[] } {
    const w = world();
    const ids = [w.mbt, w.mbt, w.mbt, w.inf, w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 44));
    order(w, ids, 'column', [24, 14]);
    tick(w);
    return { w, ids };
  }
  it('a 30-tile Column order has 4 checkpoints, at route steps 7, 15, 23 and 29: y = 36, 28, 20, 14', () => {
    const { w, ids } = thirty();
    expect(w.sim.formationGroupOf(ids[0])).toBe(0);
    expect(w.sim.formationLegsOfGroup(0)).toBe(4);
    expect(w.sim.formationLegOfGroup(0)).toBe(1);
    // Checkpoint k puts the Column's own literal slots about its tile: armour (y, y+1, y+3), then the rifles from row 5
    // behind. Forward is north every leg.
    const slot = (y: number): [number, number][] => [[24, y], [26, y + 1], [24, y + 3], [24, y + 5], [26, y + 5], [24, y + 6]];
    expect(ids.map((id) => goalTile(w.sim, id))).toEqual(slot(36));
    for (let m = 0; m < 6; m++) {
      expect(queueTiles(w.sim, ids[m]), `id ${ids[m]}`).toEqual([slot(28)[m], slot(20)[m], slot(14)[m]]);
      expect(priv(w.sim).wpCount[ids[m]]).toBe(3);
      expect(priv(w.sim).fmLeg[ids[m]]).toBe(1);
    }
    expect(finalTile(w.sim, ids[3])).toEqual([24, 19]);
    // the rest facing is the last leg's direction: north
    expect(ids.map((id) => priv(w.sim).restFacing[id])).toEqual([49152, 49152, 49152, 49152, 49152, 49152]);
    // the group walks at the riflemen's step: 0.9 tiles a second is 2949 raw a tick
    expect(w.sim.formationPaceOfGroup(0)).toBe(2949);
  });
  it('every written waypoint carries the order\'s attack-move and sweep flags', () => {
    const w = world();
    const ids = [w.inf, w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 44));
    order(w, ids, 'attack', [24, 14], 'attackMove', { sweep: true });
    tick(w);
    expect(w.sim.formationLegsOfGroup(0)).toBe(4);
    const p = priv(w.sim);
    for (const id of ids) {
      expect(p.attackMove[id]).toBe(1);
      expect(p.sweepOrder[id]).toBe(1);
      expect(p.wpCount[id]).toBe(3);
    }
    // the queue arrays of the first unit: three flags each
    expect(Array.from(p.wpX.slice(0, 3)).every((v) => v !== 0)).toBe(true);
  });
  it('a route no longer than one leg is one checkpoint: P1a\'s whole answer', () => {
    const w = world();
    const ids = [w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 30));
    order(w, ids, 'column', [24, 24]); // 6 steps
    tick(w);
    expect(w.sim.formationLegsOfGroup(0)).toBe(1);
    expect(ids.map((id) => priv(w.sim).wpCount[id])).toEqual([0, 0]);
    expect(ids.map((id) => goalTile(w.sim, id))).toEqual([[24, 24], [26, 24]]);
  });
  it('the street: a one-tile corridor gives one file at every checkpoint', () => {
    const w = world();
    wallExcept(w, (x, y) => x === 24 && y >= 10 && y <= 46);
    const ids = [w.mbt, w.mbt, w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 46));
    order(w, ids, 'column', [24, 16]); // 30 steps north up the lane
    tick(w);
    expect(w.sim.formationLegsOfGroup(0)).toBe(4);
    // every tile of every checkpoint is on the lane, one member to a tile
    const tiles = (k: number): [number, number][] => ids.map((id) => (k === 0 ? goalTile(w.sim, id) : queueTiles(w.sim, id)[k - 1]));
    for (let k = 0; k < 4; k++) {
      const t = tiles(k);
      expect(t.every(([x]) => x === 24), `checkpoint ${k + 1} on the lane`).toBe(true);
      expect(new Set(t.map(([, y]) => y)).size, `checkpoint ${k + 1}: one member to a tile`).toBe(4);
    }
    // The lead hull stands on checkpoint 1 itself (route step 7 from (24,46): y = 38). The Column's offsets, with the
    // lateral file lost to the walls: the second tank on row 3 behind, the rifles on rows 5 and 6.
    expect(tiles(0)).toEqual([[24, 38], [24, 41], [24, 43], [24, 44]]);
    expect(tiles(3)).toEqual([[24, 16], [24, 19], [24, 21], [24, 22]]);
  });
  it('no route: a click with no path from the centroid is one checkpoint and P1a\'s slots', () => {
    const w = world();
    // a walled room (interior x 6..14, y 4..14) around the click (10, 6); the group stands outside it
    wallExcept(w, (x, y) => x >= 6 && x <= 14 && y >= 4 && y <= 14 ? true : !(x >= 5 && x <= 15 && y >= 3 && y <= 15));
    const ids = [w.mbt, w.mbt, w.mbt, w.inf, w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 44));
    order(w, ids, 'column', [10, 6]);
    tick(w);
    expect(w.sim.formationGroupOf(ids[0])).toBe(0);
    expect(w.sim.formationLegsOfGroup(0)).toBe(1);
    expect(ids.map((id) => priv(w.sim).wpCount[id])).toEqual([0, 0, 0, 0, 0, 0]);
    // P1a's slots about (10, 6), forward north: armour (0,0) (-1,+2) (-3,0), rifles from row -5
    expect(ids.map((id) => goalTile(w.sim, id))).toEqual([[10, 6], [12, 7], [10, 9], [10, 11], [12, 11], [10, 12]]);
  });
  it('budget: a 100-step route gets 9 checkpoints and 8 queued waypoints (MAX_WAYPOINTS)', () => {
    const w = world({ w: 64, h: 64 });
    // a lane along y = 2 from x = 2 to x = 62 (60 steps), then down x = 62 to y = 42 (40 steps)
    wallExcept(w, (x, y) => (y === 2 && x >= 2 && x <= 62) || (x === 62 && y >= 2 && y <= 42));
    const ids = [w.inf, w.inf].map((t) => spawnAt(w, t, 0, 2, 2));
    order(w, ids, 'column', [62, 42]);
    tick(w);
    expect(w.sim.formationLegsOfGroup(0)).toBe(9);
    expect(ids.map((id) => priv(w.sim).wpCount[id])).toEqual([8, 8]);
    // the spacing is ceil(100 / 9) = 12: checkpoint 1 is step 12 from (2, 2), the tile (14, 2), and the lead rifleman stands on it
    expect(goalTile(w.sim, ids[0])).toEqual([14, 2]);
    expect(finalTile(w.sim, ids[0])[0]).toBe(62);
  });
  it('append: a shift-appended formation order adds one waypoint per member and is one checkpoint', () => {
    const w = world();
    const ids = [w.inf, w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 44));
    order(w, ids, undefined, [24, 30]);
    tick(w);
    expect(ids.map((id) => priv(w.sim).wpCount[id])).toEqual([0, 0, 0]);
    order(w, ids, 'column', [24, 14], 'move', { append: true });
    tick(w);
    expect(ids.map((id) => priv(w.sim).wpCount[id])).toEqual([1, 1, 1]);
    expect(w.sim.formationLegsOfGroup(w.sim.formationGroupOf(ids[0]))).toBe(1);
    // each is queued on the Column's own slot about (24, 14): the rifles lead the file from row 0
    expect(ids.map((id) => queueTiles(w.sim, id)[0])).toEqual([[24, 14], [26, 14], [24, 15]]);
    expect(ids.map((id) => priv(w.sim).fmLeg[id])).toEqual([1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('pace: the whole group walks at its slowest ground member\'s step', () => {
  /** A tank, a slow team and an aircraft ordered 30 tiles up an open map by `formation`. */
  function pair(formation: string | undefined, extra = false): { w: World; mbt: number; slow: number; air: number } {
    const w = world();
    const mbt = spawnAt(w, w.mbt, 0, 24, 44);
    const slow = spawnAt(w, w.slow, 0, 24, 44);
    const air = extra ? spawnAt(w, w.air, 0, 24, 44) : -1;
    order(w, extra ? [mbt, slow, air] : [mbt, slow], formation, [24, 14]);
    return { w, mbt, slow, air };
  }
  const travelled = (w: World, id: number): number => (at(44) - w.sim.state.posY[id]) | 0;
  it('after 100 ticks the tank has gone exactly as far as the slow team, 100 steps of the slow team\'s 1638', () => {
    const { w, mbt, slow } = pair('column_nolegs');
    tick(w, 100);
    expect(travelled(w, slow)).toBe(163800);
    expect(travelled(w, mbt)).toBe(163800);
    expect(w.sim.formationPaceOfGroup(0)).toBe(1638);
  });
  it('the same pair in a plain move: the tank is far ahead, 100 steps of its own 3604', () => {
    const { w, mbt, slow } = pair(undefined);
    tick(w, 100);
    expect(travelled(w, slow)).toBe(163800);
    expect(travelled(w, mbt)).toBe(360400);
  });
  it('formationPaceSetterOf names the slow team, the lowest id among equals', () => {
    const { w, mbt, slow } = pair('column_nolegs');
    tick(w);
    expect(w.sim.formationPaceSetterOf(0)).toBe(slow);
    expect(w.sim.formationPaceSetterOf(0)).not.toBe(mbt);
    // a second team of the same step, spawned later, does not take the title
    const w2 = world();
    const t1 = spawnAt(w2, w2.slow, 0, 24, 44);
    const t2 = spawnAt(w2, w2.slow, 0, 24, 44);
    order(w2, [t2, t1], 'column_nolegs', [24, 14]);
    tick(w2);
    expect(w2.sim.formationPaceSetterOf(0)).toBe(t1);
    expect(w2.sim.formationPaceSetterOf(5)).toBe(-1); // a free row has no setter
    expect(w2.sim.formationPaceOfGroup(5)).toBe(0);
  });
  it('an aircraft is not capped: it flies its own 6554 a tick', () => {
    const { w, air } = pair('column_nolegs', true);
    tick(w, 100);
    expect(travelled(w, air)).toBe(655400);
    expect(w.sim.formationPaceOfGroup(0)).toBe(1638); // the aircraft set no pace either
  });
  it('a formation with pace none sets no cap', () => {
    const { w, mbt } = pair('column_nopace');
    tick(w, 100);
    expect(w.sim.formationPaceOfGroup(0)).toBe(0);
    expect(w.sim.formationPaceSetterOf(0)).toBe(-1);
    expect(travelled(w, mbt)).toBe(360400);
  });
  it('the pace is read again at a release: when the slow team dies, the group speeds up to the next slowest', () => {
    const w = world();
    const slow = spawnAt(w, w.slow, 0, 24, 44);
    const rifles = [spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44)];
    order(w, [slow, ...rifles], 'column', [24, 14]);
    tick(w);
    expect(w.sim.formationPaceOfGroup(0)).toBe(1638);
    w.sim.debugKill(slow);
    expect(w.sim.formationPaceOfGroup(0)).toBe(1638); // a cap is only re-read at a release
    for (let t = 0; t < 700 && w.sim.formationLegOfGroup(0) < 2; t++) tick(w);
    expect(kinds(w, 'formationReleased').length).toBeGreaterThan(0);
    expect(w.sim.formationPaceOfGroup(0)).toBe(2949);
    expect(w.sim.formationPaceSetterOf(0)).toBe(rifles[0]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('dress: an early arrival waits, with its leg live, until the group is dressed', () => {
  /** Four riflemen, three at (24, 44) and a straggler three tiles behind, up the open map to (24, 14). */
  function straggler(): { w: World; ids: number[] } {
    const w = world();
    const ids = [spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 47)];
    order(w, ids, 'column', [24, 14]);
    return { w, ids };
  }
  it('the three arrivals read WAIT and keep moving; release comes dress_s (60 ticks) after the first arrival', () => {
    const { w, ids } = straggler();
    const p = priv(w.sim);
    let firstArrival = -1;
    let threeWaiting = -1;
    for (let t = 0; t < 400 && kinds(w, 'formationReleased').length === 0; t++) {
      tick(w);
      if (firstArrival < 0 && p.fgAtCp[0] > 0) firstArrival = w.sim.tickCount - 1;
      if (threeWaiting < 0 && p.fgAtCp[0] === 3) {
        threeWaiting = w.sim.tickCount - 1;
        // the state at that tick: three WAIT (duty 1), leg live (moving 1, goal untouched, standing on it), the straggler not
        expect(ids.map((id) => p.fmDuty[id])).toEqual([1, 1, 1, 0]);
        expect(ids.map((id) => p.moving[id])).toEqual([1, 1, 1, 1]);
        expect(ids.map((id) => p.fmLeg[id])).toEqual([1, 1, 1, 1]);
        for (const id of ids.slice(0, 3)) {
          expect(p.posX[id], `id ${id} x`).toBe(p.goalX[id]);
          expect(p.posY[id], `id ${id} y`).toBe(p.goalY[id]);
        }
        expect(p.wpCount[ids[0]]).toBe(3);
      }
    }
    expect(firstArrival).toBe(133);
    expect(threeWaiting).toBe(173);
    const released = kinds(w, 'formationReleased');
    expect(released).toHaveLength(1);
    expect(released[0]).toEqual({ kind: 'formationReleased', tick: 193, side: 0, group: 0, leg: 1, legs: 4 });
    expect((released[0] as { tick: number }).tick - firstArrival).toBe(60);
    // the release sent the three on: leg 2, no longer waiting, the straggler still on leg 1
    expect(ids.map((id) => p.fmLeg[id])).toEqual([2, 2, 2, 1]);
    expect(ids.map((id) => p.fmDuty[id])).toEqual([0, 0, 0, 0]);
    expect(p.fgAtCp[0]).toBe(0);
    expect(p.fgDress[0]).toBe(0);
    expect(w.sim.formationLegOfGroup(0)).toBe(2);
  });
  it('a straggler that arrives after the release passes straight through: fmLeg moves on in the same tick', () => {
    const { w, ids } = straggler();
    const p = priv(w.sim);
    let passed = -1;
    let waitedTicks = 0;
    for (let t = 0; t < 300 && passed < 0; t++) {
      tick(w);
      if (p.fmDuty[ids[3]] === 1) waitedTicks++;
      if (p.fmLeg[ids[3]] === 2) passed = w.sim.tickCount - 1;
    }
    expect(passed).toBe(218);
    expect(waitedTicks, 'the straggler never waited').toBe(0);
    expect(p.fmDuty[ids[3]]).toBe(0);
    expect(p.fgAtCp[0], 'and was never counted at the checkpoint').toBeLessThan(4);
    expect(kinds(w, 'formationReleased')).toHaveLength(1);
  });
  it('with nothing in the way the release is the tick after the last arrival', () => {
    const { w, ids } = straggler();
    const p = priv(w.sim);
    // run on to the SECOND checkpoint, where all four are together
    let lastArrival = -1;
    for (let t = 0; t < 500 && kinds(w, 'formationReleased').length < 2; t++) {
      tick(w);
      if (kinds(w, 'formationReleased').length === 1 && p.fgAtCp[0] === 4 && lastArrival < 0) lastArrival = w.sim.tickCount - 1;
    }
    expect(lastArrival).toBe(396);
    const released = kinds(w, 'formationReleased');
    expect(released[1]).toEqual({ kind: 'formationReleased', tick: 397, side: 0, group: 0, leg: 2, legs: 4 });
    expect(ids.map((id) => p.fmLeg[id])).toEqual([3, 3, 3, 3]);
  });
  it('the last checkpoint is not dressed: members that arrive stop (moving 0) with the group released three times', () => {
    const { w, ids } = straggler();
    const p = priv(w.sim);
    tick(w, 900);
    expect(kinds(w, 'formationReleased').map((e) => (e as { leg: number }).leg)).toEqual([1, 2, 3]);
    expect(ids.map((id) => p.moving[id])).toEqual([0, 0, 0, 0]);
    expect(ids.map((id) => p.fmDuty[id])).toEqual([0, 0, 0, 0]);
    expect(w.sim.formationLegOfGroup(0)).toBe(4); // capped at fgLegs
    expect(ids.map((id) => goalTile(w.sim, id))).toEqual([[24, 14], [26, 14], [24, 15], [26, 15]]);
  });
  it('when the last waiting member leaves, the dress clock starts again from the next arrival', () => {
    const { w, ids } = straggler();
    const p = priv(w.sim);
    // the first arrival waits from tick 133; after 153 ticks the dress has run 19 and that member is ordered away
    let firstWaiter = -1;
    for (let t = 0; t < 153; t++) {
      tick(w);
      if (firstWaiter < 0 && p.fgAtCp[0] === 1) firstWaiter = ids.find((id) => p.fmDuty[id] === 1) ?? -1;
    }
    expect(firstWaiter).toBe(ids[2]);
    expect([p.fgAtCp[0], p.fgDress[0]]).toEqual([1, 19]);
    w.sim.queueCommand({ kind: 'halt', ids: [firstWaiter] });
    tick(w);
    expect([p.fgAtCp[0], p.fgDress[0]], 'nobody waits and the clock is back at zero').toEqual([0, 0]);
    // the next arrival (tick 155) starts a fresh clock: the release is dress_s after IT, not after the first
    let nextArrival = -1;
    while (kinds(w, 'formationReleased').length === 0 && w.sim.tickCount < 500) {
      tick(w);
      if (nextArrival < 0 && p.fgAtCp[0] > 0) nextArrival = w.sim.tickCount - 1;
    }
    expect(nextArrival).toBe(155);
    expect(kinds(w, 'formationReleased')[0]).toEqual({ kind: 'formationReleased', tick: 215, side: 0, group: 0, leg: 1, legs: 4 });
  });
  it('a hull whose slot lies beyond a waiting hull is steered round it, ghosts through on the valve and is dressed in time', () => {
    // Ruling 6 keeps a waiting hull `moving` 1, so the separation pass reads it as a mover. Three tanks with a hull
    // footprint (half length 1.0, half width 0.5): the Column's checkpoint 1 is (24, 32) / (26, 33) / (24, 35), and
    // the third tank, spawned ahead at (24, 30), is there at tick 90 and waits. The first tank must cross (24, 35)
    // to reach (24, 32), so it comes up BEHIND the waiting hull. The ten-second dress keeps the wait alive.
    const w = world();
    const foot = w.sim.addUnitType({ ...MBT, id: 'fm3_foot', mobility: { ...MBT.mobility, footprint: { half_length_tiles: 1.0, half_width_tiles: 0.5 } } } as UnitTypeJson);
    const ids = [spawnAt(w, foot, 0, 24, 44), spawnAt(w, foot, 0, 26, 45), spawnAt(w, foot, 0, 24, 30)];
    order(w, ids, 'column_dress10', [24, 14]);
    tick(w);
    const p = priv(w.sim);
    expect(ids.map((id) => goalTile(w.sim, id))).toEqual([[24, 32], [26, 33], [24, 35]]);
    let waiterFrom = -1;
    let peakWait = 0;
    let peakAt = -1;
    let arrived = -1;
    let sidestep = false;
    for (let t = 0; t < 400 && kinds(w, 'formationReleased').length === 0; t++) {
      tick(w);
      const now = w.sim.tickCount - 1;
      if (waiterFrom < 0 && p.fmDuty[ids[2]] === 1) waiterFrom = now;
      if (p.sepWait[ids[0]] > peakWait) {
        peakWait = p.sepWait[ids[0]];
        peakAt = now;
      }
      if (tileOf(p.posX[ids[0]]) === 23) sidestep = true; // it went round the waiting hull, to its west
      // the waiting hull never moves while it is waited on
      if (p.fmDuty[ids[2]] === 1) expect([tileOf(p.posX[ids[2]]), tileOf(p.posY[ids[2]])], `waiting hull at ${now}`).toEqual([24, 35]);
      if (arrived < 0 && p.posX[ids[0]] === p.goalX[ids[0]] && p.posY[ids[0]] === p.goalY[ids[0]] && p.fmLeg[ids[0]] === 1) arrived = now;
    }
    expect(waiterFrom).toBe(90);
    expect(sidestep).toBe(true);
    // not a deadlock: the count peaks at the valve (SEP_VALVE_TICKS 40), the hull ghosts through, and is on its slot
    expect([peakWait, peakAt]).toEqual([40, 167]);
    expect(arrived).toBe(252);
    // all present: the release is the tick after the last arrival, well inside the 200-tick clock (90 + 200 = 290)
    expect(kinds(w, 'formationReleased')[0]).toEqual({ kind: 'formationReleased', tick: 253, side: 0, group: 0, leg: 1, legs: 4 });
    tick(w, 700);
    expect(kinds(w, 'formationReleased').map((e) => (e as { leg: number }).leg)).toEqual([1, 2, 3]);
    expect(ids.map((id) => p.moving[id])).toEqual([0, 0, 0]);
    expect(ids.map((id) => goalTile(w.sim, id))).toEqual([[24, 14], [26, 15], [24, 17]]);
    expect(ids.map((id) => [tileOf(p.posX[id]), tileOf(p.posY[id])])).toEqual([[24, 14], [26, 15], [24, 17]]);
  });
  it('a waiting attack-mover with a remembered contact stays put through the hold (it is not an idle sweeper)', () => {
    const w = world();
    const ids = [spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 47)];
    // an enemy nobody can see, remembered at (6, 6): a sweeping unit that were idle would walk to it
    const foe = spawnAt(w, w.dummy, 1, 44, 4);
    const p = priv(w.sim);
    const k = 0 * w.sim.capacity + foe;
    p.lastSeenValid[k] = 1;
    p.lastSeenX[k] = at(6);
    p.lastSeenY[k] = at(6);
    order(w, ids, 'attack', [24, 14], 'attackMove', { sweep: true });
    let held = 0;
    let goalAtFirst: [number, number] | null = null;
    for (let t = 0; t < 215; t++) {
      tick(w);
      if (p.fmDuty[ids[0]] === 1) {
        held++;
        if (goalAtFirst === null) goalAtFirst = goalTile(w.sim, ids[0]);
        expect(goalTile(w.sim, ids[0]), `tick ${w.sim.tickCount}`).toEqual(goalAtFirst);
        expect(p.moving[ids[0]], `tick ${w.sim.tickCount}`).toBe(1);
        expect(p.posX[ids[0]]).toBe(p.goalX[ids[0]]);
      }
    }
    expect(held).toBeGreaterThan(30);
    expect(goalAtFirst).toEqual([24, 37]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('facing: a hull keeps its marching facing until the last leg', () => {
  /** Four riflemen (three together, a straggler three tiles behind) in the outward Column: the third rests facing
   *  south while it marches north. Returns the world at the tick the third is waiting at checkpoint 1. */
  function waiting(): { w: World; ids: number[] } {
    const w = world();
    const ids = [spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 47)];
    order(w, ids, 'column_outward', [24, 14]);
    for (let t = 0; t < 400 && priv(w.sim).fgAtCp[0] < 3; t++) tick(w);
    expect(priv(w.sim).fgAtCp[0]).toBe(3);
    return { w, ids };
  }
  it('has the rest facings the outward Column gives: forward, east, south, south-east', () => {
    const { w, ids } = waiting();
    expect(ids.map((id) => priv(w.sim).restFacing[id])).toEqual([49152, 0, 16384, 8192]);
  });
  it('a hull stopped at an intermediate checkpoint does not turn to its rest facing; on the final leg it does', () => {
    const { w, ids } = waiting();
    const p = priv(w.sim);
    // The waiting hull keeps moving 1 and so is not "stopped"; stop it by hand, as any other halt of an intermediate leg
    // would. A defence in depth: the gate, not the WAIT, keeps it facing the way it marched.
    p.moving[ids[2]] = 0;
    tick(w, 90); // a half turn is far less
    expect(p.facing[ids[2]], 'still facing the way it marched').toBe(49152);
    p.moving[ids[2]] = 1;
    // all the way to the final checkpoint: now it turns to its rest facing
    for (let t = 0; t < 900 && ids.some((id) => p.moving[id] === 1); t++) tick(w);
    tick(w, 90);
    expect(ids.map((id) => p.moving[id])).toEqual([0, 0, 0, 0]);
    expect(ids.map((id) => p.facing[id])).toEqual([49152, 0, 16384, 8192]);
  });
  it('a group in contact (state 3) turns to its rest facing at any leg', () => {
    const { w, ids } = waiting();
    const p = priv(w.sim);
    p.moving[ids[2]] = 0;
    tick(w, 90);
    expect(p.facing[ids[2]]).toBe(49152);
    p.fgState[0] = 3;
    tick(w, 90);
    expect(p.facing[ids[2]]).toBe(16384);
  });
  it('an appended formation order still rest-faces: fmLeg passes fgLegs on the old route\'s last waypoint', () => {
    const w = world();
    const ids = [spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44)];
    order(w, ids, undefined, [24, 30]);
    tick(w);
    // appended while they walk: one checkpoint, so fgLegs is 1 while the members' fmLeg moves to 2 at the old goal
    order(w, ids, 'column_outward', [24, 14], 'move', { append: true });
    tick(w);
    const p = priv(w.sim);
    expect(w.sim.formationLegsOfGroup(0)).toBe(1);
    expect(ids.map((id) => p.restFacing[id])).toEqual([49152, 0, 16384]);
    for (let t = 0; t < 1500 && ids.some((id) => p.moving[id] === 1); t++) tick(w);
    tick(w, 90);
    expect(ids.map((id) => p.moving[id])).toEqual([0, 0, 0]);
    expect(ids.map((id) => p.fmLeg[id])).toEqual([2, 2, 2]); // past fgLegs 1
    expect(ids.map((id) => p.facing[id])).toEqual([49152, 0, 16384]);
  });
  it('travel: a Column arriving on the diagonal faces the eighth-turn of its last leg, 8192, not the axis', () => {
    const w = world();
    const ids = [w.inf, w.inf].map((t) => spawnAt(w, t, 0, 10, 10));
    order(w, ids, 'column', [30, 30]); // 20 steps south-east: checkpoints at steps 7, 15 and 19
    tick(w);
    expect(w.sim.formationLegsOfGroup(0)).toBe(3);
    expect(ids.map((id) => priv(w.sim).restFacing[id])).toEqual([8192, 8192]);
    // and the slots are still on the axis frame (the tie goes to x): the second file is the lateral one
    expect(finalTile(w.sim, ids[0])).toEqual([30, 30]);
  });
  it('travel on an axis approach is the axis: north is 49152, east is 0, west is 32768', () => {
    const cases: { from: [number, number]; to: [number, number]; face: number }[] = [
      { from: [24, 40], to: [24, 24], face: 49152 },
      { from: [10, 24], to: [24, 24], face: 0 },
      { from: [40, 24], to: [24, 24], face: 32768 },
      { from: [24, 10], to: [24, 24], face: 16384 },
    ];
    expect(cases).toHaveLength(4);
    for (const c of cases) {
      const w = world();
      const ids = [w.inf, w.inf].map((t) => spawnAt(w, t, 0, c.from[0], c.from[1]));
      order(w, ids, 'column', c.to);
      tick(w);
      expect(ids.map((id) => priv(w.sim).restFacing[id]), `${c.from} to ${c.to}`).toEqual([c.face, c.face]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('final reservation: a later order cannot put a slot on a marching member\'s last tile', () => {
  it('three riflemen ordered plainly to the Column\'s click take none of the four final tiles', () => {
    const w = world();
    const col = [0, 1, 2, 3].map(() => spawnAt(w, w.inf, 0, 24, 44));
    order(w, col, 'column', [24, 14]);
    tick(w, 10);
    expect(col.map((id) => finalTile(w.sim, id))).toEqual([[24, 14], [26, 14], [24, 15], [26, 15]]);
    const late = [0, 1, 2].map(() => spawnAt(w, w.inf, 0, 10, 44));
    order(w, late, undefined, [24, 14]);
    tick(w);
    const finals = new Set(col.map((id) => finalTile(w.sim, id).join(',')));
    expect(finals.size).toBe(4);
    const lateGoals = late.map((id) => goalTile(w.sim, id));
    for (const g of lateGoals) expect(finals.has(g.join(',')), `late goal ${g}`).toBe(false);
    expect(lateGoals).toEqual([[25, 14], [23, 14], [22, 14]]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('exits: a member that leaves a dress is no longer waited for', () => {
  /** Four riflemen in a ten-second-dress Column: three arrive together and wait, the straggler is far behind. */
  function waiting(): { w: World; ids: number[]; foe: number } {
    const w = world();
    const ids = [spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 44), spawnAt(w, w.inf, 0, 24, 47)];
    const foe = spawnAt(w, w.dummy, 1, 24, 30);
    order(w, ids, 'column_dress10', [24, 14]);
    for (let t = 0; t < 400 && priv(w.sim).fgAtCp[0] < 3; t++) tick(w);
    expect(priv(w.sim).fgAtCp[0], 'three are waiting').toBe(3);
    return { w, ids, foe };
  }
  const cases: { name: string; leave: (w: World, id: number, foe: number) => void }[] = [
    { name: 'a move order', leave: (w, id) => { w.sim.queueCommand({ kind: 'move', ids: [id], x: at(10), y: at(40) }); tick(w); } },
    { name: 'a halt', leave: (w, id) => { w.sim.queueCommand({ kind: 'halt', ids: [id] }); tick(w); } },
    { name: 'a load order', leave: (w, id) => {
      const jeep = spawnAt(w, w.jeep, 0, 24, 44);
      w.sim.queueCommand({ kind: 'load', ids: [id], carrier: jeep });
      tick(w);
    } },
    { name: 'a garrison order', leave: (w, id) => {
      const shed = w.sim.addStructure(w.sim.addStructureType(SHED), [3 * w.sim.width + 3, 3 * w.sim.width + 4, 4 * w.sim.width + 3, 4 * w.sim.width + 4]);
      w.sim.queueCommand({ kind: 'garrison', ids: [id], structure: shed });
      tick(w);
    } },
    { name: 'an accepted attack order', leave: (w, id, foe) => {
      w.sim.queueCommand({ kind: 'reveal', side: 0, x: w.sim.state.posX[foe], y: w.sim.state.posY[foe] });
      tick(w);
      w.sim.queueCommand({ kind: 'attack', ids: [id], target: foe });
      tick(w);
    } },
    { name: 'death', leave: (w, id) => w.sim.debugKill(id) },
    { name: 'removal from play', leave: (w, id) => w.sim.removeFromPlay(id) },
    { name: 'a rout', leave: (w, id) => {
      priv(w.sim).moving[3] = 0; // the straggler is held where it stands, so the other three are never the whole group
      let ticks = 0;
      while (w.sim.state.routed[id] === 0 && ticks < 400) {
        w.sim.debugSuppress(id, fx.from(5));
        // a rout takes about ten seconds of pinning, as long as a dress: hold the dress open by hand
        priv(w.sim).fgDress[0] = 0;
        tick(w);
        ticks++;
      }
      expect(ticks, 'routed after about ten seconds of suppression').toBe(200);
      expect(w.sim.state.routed[id], 'sustained suppression routs a rifleman').toBe(1);
    } },
    { name: 'going below ground', leave: (w, id) => {
      const route = w.sim.addTunnel({ id: 'fm3_t', points: [[4, 6], [14, 6]], dig_tiles_per_s: 1, pre_dug: true, side: 0, capacity: 4 });
      w.sim.putInTunnel(id, route);
    } },
  ];
  it('has the nine exits', () => expect(cases).toHaveLength(9));
  for (const c of cases) {
    it(`${c.name} takes a WAIT member out of the count, and the others stay`, () => {
      const { w, ids, foe } = waiting();
      const p = priv(w.sim);
      expect(p.fgAtCp[0]).toBe(3);
      expect(w.sim.formationMembersOfGroup(0)).toBe(4);
      expect(p.fmDuty[ids[0]]).toBe(1);
      c.leave(w, ids[0], foe);
      expect(w.sim.formationGroupOf(ids[0])).toBe(-1);
      expect(p.fgAtCp[0], 'one fewer waiting').toBe(2);
      expect(w.sim.formationMembersOfGroup(0)).toBe(3);
      expect(p.fmDuty[ids[0]]).toBe(0);
      expect(p.fmLeg[ids[0]]).toBe(0);
      expect(p.fmDuty[ids[1]]).toBe(1);
      expect(p.fmLeg[ids[1]]).toBe(1);
    });
  }
  it('a row whose members all leave zeroes every P1b column, row and unit', () => {
    const { w, ids } = waiting();
    const p = priv(w.sim);
    // a row that has been dressed once, called and paced: every column a poke can reach, then freed
    p.fgDress[0] = 7;
    p.fgQuiet[0] = 8;
    p.fgAway[0] = 0;
    p.fgCalled[0] = 1;
    p.fgCallX[0] = at(3);
    p.fgCallY[0] = at(4);
    for (const id of ids) {
      p.fmHomeX[id] = at(5);
      p.fmHomeY[id] = at(6);
    }
    for (const id of ids) w.sim.debugKill(id);
    expect(w.sim.formationMembersOfGroup(0)).toBe(0);
    const row = [p.fgLegs, p.fgRelease, p.fgDress, p.fgQuiet, p.fgAtCp, p.fgAway, p.fgCalled, p.fgPace, p.fgCallX, p.fgCallY];
    expect(row.map((col) => col[0])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const id of ids) expect([p.fmLeg[id], p.fmDuty[id], p.fmHomeX[id], p.fmHomeY[id]]).toEqual([0, 0, 0, 0]);
  });
  it('a member on a sortie or a rescue (duty OUT or RETURN) leaving decrements fgAway, not fgAtCp', () => {
    const { w, ids } = waiting();
    const p = priv(w.sim);
    // two waiting members are made over to a call by hand (T5 writes these), and stopped so they do not re-arrive
    p.fmDuty[ids[1]] = 2; // OUT
    p.fmDuty[ids[2]] = 3; // RETURN
    p.moving[ids[1]] = 0;
    p.moving[ids[2]] = 0;
    p.fgAtCp[0] = 1;
    p.fgAway[0] = 2;
    w.sim.queueCommand({ kind: 'halt', ids: [ids[1]] });
    tick(w);
    expect([p.fgAtCp[0], p.fgAway[0]]).toEqual([1, 1]);
    w.sim.queueCommand({ kind: 'halt', ids: [ids[2]] });
    tick(w);
    expect([p.fgAtCp[0], p.fgAway[0]]).toEqual([1, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('M6: counted members are distinct ids', () => {
  it('[a, a] does not meet min_members 2: a plain order', () => {
    const w = world();
    const a = spawnAt(w, w.inf, 0, 24, 40);
    order(w, [a, a], 'column', [24, 24]);
    tick(w);
    expect(w.sim.formationGroupOf(a)).toBe(-1);
    expect(priv(w.sim).fmLive).toBe(false);
    expect(priv(w.sim).wpCount[a]).toBe(0);
    // and it is the very order the same ids get with no formation named
    const twin = world();
    const t = spawnAt(twin, twin.inf, 0, 24, 40);
    order(twin, [t, t], undefined, [24, 24]);
    tick(twin);
    expect(goalTile(w.sim, a)).toEqual(goalTile(twin.sim, t));
  });
  it('[a, a, b] is two members: the group forms and the duplicate takes no second slot', () => {
    const w = world();
    const a = spawnAt(w, w.inf, 0, 24, 40);
    const b = spawnAt(w, w.inf, 0, 24, 40);
    order(w, [a, a, b], 'column', [24, 24]);
    tick(w);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
    expect(finalTile(w.sim, a)).toEqual([24, 24]);
    expect(finalTile(w.sim, b)).toEqual([26, 24]);
  });
});
