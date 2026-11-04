// GH-1007 P1: a production-built air carrier stands on the pad (LANDED) and lifts on its rally;
// a landing zone is a 3x3 footprint that two carriers never share. Literals, from this file's own types.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { MissionRuntime, type MissionEvent, type MissionJson } from './mission';
import { AIR_AIRBORNE, AIR_LANDED, AIR_LIFTING, AIR_LIFT_TICKS } from './tuning';

const SQUAD: UnitTypeJson = {
  id: 'gt_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
const HELO: UnitTypeJson = {
  id: 'gt_helo', name: 'Yanshuf', role: 'transport',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 4, domain: 'air' }, sensors: { optics: 1, sight_tiles: 10, signature: 1 },
  weapons: [],
};
const CAMP = { id: 'camp', name: 'Field Camp', hp_per_tile: 300, garrison_slots: 3, rubble_cover: 2, produces_for: 0 };

/** A 40 x 20 map, one camp at (10,3), a helo that costs 300 and builds in 2 s. */
function world(prep?: (sim: Sim) => void) {
  const sim = new Sim({ seed: 21, width: 40, height: 20, capacity: 32 });
  const squad = sim.addUnitType(SQUAD);
  const helo = sim.addUnitType(HELO);
  sim.addStructureType(CAMP);
  prep?.(sim);
  const mission: MissionJson = {
    id: 'gt', map: { file: 'none', player_start: [3, 5] }, ledger: { requires: [], produces: [] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    starting_force: [{ unit: 'gt_squad', count: 1, at: [3, 8] }],
    structures: [{ type: 'camp', at: [10, 3], size: [2, 2] }],
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => (u === 'gt_helo' ? helo : squad), markers: {}, zones: {},
    economy: { logisticsStart: [2000, 2000], logisticsRatePerMin: [0, 0] },
    unitInfo: (u) => (u === 'gt_helo' || u === 'gt_squad' ? { logistics: 300, buildTimeS: 2, population: 1 } : null),
  });
  rt.start();
  const events: MissionEvent[] = [];
  const step = (n: number): void => { for (let i = 0; i < n; i++) events.push(...rt.step(sim.tick())); };
  return { sim, rt, step, events, helo };
}

describe('GH-1007 R1: a production-built carrier takes off from the ground', () => {
  it('is LANDED on its deploy tick and LIFTING for exactly AIR_LIFT_TICKS after the rally', () => {
    const w = world();
    w.step(10);
    expect(w.rt.setRally(0, fx.fromInt(30), fx.fromInt(10))).toBe(true);
    expect(w.rt.requestBuild('gt_helo')).toBe(true);
    const air = w.sim.state.airState;
    let built = -1;
    let id = -1;
    while (built < 0) {
      w.step(1);
      const b = w.events.find((e) => e.kind === 'built');
      if (b !== undefined) { built = b.tick; id = w.sim.entityCount - 1; }
    }
    expect(built).toBe(50);
    expect(air[id]).toBe(AIR_LANDED); // on the pad the tick it is delivered
    const px = w.sim.state.posX[id];
    w.step(1); // the rally command is applied
    expect(air[id]).toBe(AIR_LIFTING);
    let lifting = 0;
    while (air[id] === AIR_LIFTING) { lifting++; w.step(1); }
    expect(lifting).toBe(AIR_LIFT_TICKS);
    expect(air[id]).toBe(AIR_AIRBORNE);
    w.step(20);
    expect(w.sim.state.posX[id]).not.toBe(px); // and it flies the rally
  });

  it('with no rally it waits on the pad', () => {
    const w = world();
    w.step(10);
    w.rt.requestBuild('gt_helo');
    w.step(80);
    expect(w.sim.state.airState[w.sim.entityCount - 1]).toBe(AIR_LANDED);
  });

  it('an unclear pad leaves it airborne as before', () => {
    // A lattice with no 3x3 hole anywhere: no clear footprint within reach of the pad.
    const w = world((sim) => { for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) if ((x % 3 === 0 || y % 3 === 0) && !(x >= 10 && x <= 11 && y >= 3 && y <= 4) && !(x === 3 && y === 8)) sim.setBlocked(x, y, true); });
    w.step(10);
    w.rt.requestBuild('gt_helo');
    w.step(80);
    expect(w.sim.state.airState[w.sim.entityCount - 1]).toBe(AIR_AIRBORNE);
  });
});

describe('GH-1007 R2: the landing footprint', () => {
  const jam = (sim: Sim, hx: number, hy: number) => {
    const t = sim.addUnitType(HELO);
    return sim.spawn(t, 0, fx.add(fx.fromInt(hx), 32768), fx.add(fx.fromInt(hy), 32768));
  };
  const tile = (sim: Sim, id: number): [number, number] => [fx.toInt(sim.state.posX[id]), fx.toInt(sim.state.posY[id])];
  const obstacles: Array<[string, (sim: Sim, x: number, y: number) => void]> = [
    ['^', (sim, x, y) => sim.setBlocked(x, y, true)],
    ['b', (sim, x, y) => sim.setBoulder(x, y, true)],
    ['#', (sim, x, y) => { const st = sim.addStructureType({ id: `gt_b${x}${y}`, name: 'B', hp_per_tile: 900, garrison_slots: 0, rubble_cover: 1 }); sim.addStructure(st, [y * 40 + x]); }],
  ];
  for (const [sym, put] of obstacles) {
    // The obstacle sits on a CORNER of the footprint around the asked-for tile (20,20).
    it(`never lands with a ${sym} on any tile of its footprint`, () => {
      const sim = new Sim({ seed: 3, width: 40, height: 40, capacity: 16 });
      const car = jam(sim, 20, 20);
      const rider = sim.spawn(sim.addUnitType(SQUAD), 0, fx.add(fx.fromInt(20), 32768), fx.add(fx.fromInt(20), 32768));
      expect(sim.embarkAtSpawn(car, rider)).toBe(true);
      put(sim, 21, 21);
      sim.queueCommand({ kind: 'unload', ids: [car] });
      for (let i = 0; i < 100; i++) sim.tick();
      expect(sim.state.airState[car]).toBe(AIR_LANDED);
      const [cx, cy] = tile(sim, car);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        expect(sim.blockedVehicle[(cy + dy) * 40 + cx + dx]).toBe(0);
        expect([cx + dx, cy + dy]).not.toEqual([21, 21]);
      }
    });
  }

  it('two carriers never share a footprint', () => {
    const sim = new Sim({ seed: 4, width: 40, height: 40, capacity: 16 });
    const a = jam(sim, 20, 20);
    const b = jam(sim, 20, 20);
    const inf = sim.addUnitType(SQUAD);
    for (const car of [a, b]) {
      const s = sim.spawn(inf, 0, fx.add(fx.fromInt(20), 32768), fx.add(fx.fromInt(20), 32768));
      expect(sim.embarkAtSpawn(car, s)).toBe(true);
    }
    sim.queueCommand({ kind: 'unload', ids: [a, b] });
    for (let i = 0; i < 120; i++) sim.tick();
    expect(sim.state.airState[a]).toBe(AIR_LANDED);
    expect(sim.state.airState[b]).toBe(AIR_LANDED);
    const [ax, ay] = tile(sim, a);
    const [bx, by] = tile(sim, b);
    expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBeGreaterThanOrEqual(3);
  });

  it('no clear footprint within reach: refused with no state change and a reason', () => {
    const sim = new Sim({ seed: 5, width: 40, height: 40, capacity: 16 });
    const car = jam(sim, 20, 20);
    const s = sim.spawn(sim.addUnitType(SQUAD), 0, fx.add(fx.fromInt(20), 32768), fx.add(fx.fromInt(20), 32768));
    expect(sim.embarkAtSpawn(car, s)).toBe(true);
    // A lattice with no 3x3 hole: every third row and column blocked, farther than the search reaches.
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (x % 3 === 0 || y % 3 === 0) sim.setBlocked(x, y, true);
    const before = [sim.state.airState[car], sim.state.airWant[car], sim.state.moving[car]];
    sim.queueCommand({ kind: 'unload', ids: [car] });
    const events = sim.tick();
    expect([sim.state.airState[car], sim.state.airWant[car], sim.state.moving[car]]).toEqual(before);
    expect(events.filter((e) => e.kind === 'landRefused')).toMatchObject([{ kind: 'landRefused', carrier: car, reason: 'no_clear_ground' }]);
  });
});
