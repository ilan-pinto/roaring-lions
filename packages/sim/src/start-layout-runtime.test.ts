// GH-1360 S3b: `MissionRuntime.start()` lays the starting force out (design 2026-11-15-unit-spacing-design.md, section
// 3.2). These are the runtime's own wiring rules, each on a literal world: the field absent is today's spread to the
// byte, the template must be supplied, the free spot's echo is "no spot", a body not laid out yet blocks nobody, and the
// placement writes positions and facings only (ids, types and spawn order unchanged). The shipped missions are walked
// by tools/src/start_layout.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { compileFormation, type FormationJson } from './formation-template';
import { MissionRuntime, type MissionJson, type PlacementJson } from './mission';
import { Sim, type UnitTypeJson } from './sim';
import type { StartPlacement } from './start-layout';

const ROOT = join(__dirname, '..', '..', '..');
const ASSEMBLY = compileFormation(JSON.parse(readFileSync(join(ROOT, 'data', 'layouts', 'assembly.json'), 'utf8')) as FormationJson);

const HULL = { hp: 100, armor: { front: 1, side: 1, rear: 1 } };
const SENSORS = { optics: 1, sight_tiles: 2, signature: 1 };
/** A capsule: segment 1.0 long along its facing, radius 0.5 (2 x 1 tiles). Wheeled by role. */
const TANK: UnitTypeJson = { id: 'slr_tank', role: 'mbt', hull: HULL, mobility: { speed_tiles_s: 1, footprint: { half_length_tiles: 1.0, half_width_tiles: 0.5 } }, sensors: SENSORS };
/** No footprint: a point to the free spot, as every shipped foot type is until S5c. */
const RIFLE: UnitTypeJson = { id: 'slr_rifle', role: 'infantry', hull: HULL, mobility: { speed_tiles_s: 1 }, sensors: SENSORS };

/** North is -y: `startFaceOf('N')` is three quarters of a turn. East is 0. */
const NORTH = 49152;

function world(w = 32, h = 32): { sim: Sim; tank: number; rifle: number } {
  const sim = new Sim({ seed: 1360, width: w, height: h, capacity: 32 });
  return { sim, tank: sim.addUnitType(TANK), rifle: sim.addUnitType(RIFLE) };
}

function mission(force: PlacementJson[], extra: Partial<MissionJson> = {}): MissionJson {
  return {
    id: 'slr_test',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'clock', type: 'survive_until', primary: true, seconds: 600 }],
    starting_force: force,
    ...extra,
  };
}

function start(sim: Sim, tank: number, rifle: number, m: MissionJson, withTemplate = true): StartPlacement[] {
  let got: StartPlacement[] = [];
  const rt = new MissionRuntime(sim, m, {
    typeIdOf: (u) => (u === TANK.id ? tank : u === RIFLE.id ? rifle : -1),
    markers: {},
    zones: {},
    ...(withTemplate ? { startLayout: ASSEMBLY } : {}),
  });
  rt.start((p) => {
    got = [...p];
  });
  return got;
}

const at = (sim: Sim, id: number): [number, number] => [fx.toNumber(sim.state.posX[id]), fx.toNumber(sim.state.posY[id])];

describe('MissionRuntime.start() and the starting layout (GH-1360 S3b)', () => {
  const FORCE: PlacementJson[] = [
    { unit: TANK.id, count: 2, at: [10, 20] },
    { unit: RIFLE.id, count: 3, at: [10, 21] },
  ];

  it('no start_layout: the bodies stand on the SPREAD offsets, 1.25 tiles east then south, facing 0', () => {
    const { sim, tank, rifle } = world();
    const calls = start(sim, tank, rifle, mission(FORCE));
    expect(calls).toEqual([]);
    // tank k at (10 + 1.25 k, 20); rifle k at (10 + 1.25 k, 21)
    expect([0, 1, 2, 3, 4].map((i) => at(sim, i))).toEqual([[10, 20], [11.25, 20], [10, 21], [11.25, 21], [12.5, 21]]);
    expect([0, 1, 2, 3, 4].map((i) => sim.state.facing[i])).toEqual([0, 0, 0, 0, 0]);
  });

  it('assembly: positions and facings move; ids, types and sides do not', () => {
    const { sim, tank, rifle } = world();
    const out = start(sim, tank, rifle, mission(FORCE, { start_layout: 'assembly', start_front: 'N' }));
    expect(out.map((p) => p.id)).toEqual([0, 1, 2, 3, 4]);
    expect(out.map((p) => p.how)).toEqual(['slot', 'slot', 'slot', 'slot', 'slot']);
    expect([0, 1, 2, 3, 4].map((i) => sim.state.typeIdx[i])).toEqual([tank, tank, rifle, rifle, rifle]);
    expect([0, 1, 2, 3, 4].map((i) => sim.state.side[i])).toEqual([0, 0, 0, 0, 0]);
    expect([0, 1, 2, 3, 4].map((i) => sim.state.facing[i])).toEqual([NORTH, NORTH, NORTH, NORTH, NORTH]);
    // What the sim holds is what the layout said.
    for (const p of out) expect([sim.state.posX[p.id], sim.state.posY[p.id]]).toEqual([p.x, p.y]);
    // Centroid x (10 + 11.25 + 10 + 11.25 + 12.5) / 5 = 11, y (20 + 20 + 21 + 21 + 21) / 5 = 20.6: tile (11, 20). Depth 2 (a
    // vehicle rank, then infantry 2 behind), half of it 1 forward: the click is (11, 19). Tanks 3 apart in the front rank,
    // rifles 2 apart, 2 tiles behind (south, for a force facing north).
    expect(out.map((p) => [fx.toNumber(p.x), fx.toNumber(p.y)])).toEqual([[11.5, 19.5], [14.5, 19.5], [11.5, 21.5], [13.5, 21.5], [9.5, 21.5]]);
  });

  it('assembly without the compiled template throws, naming the mission: no harness plays a layout the game does not', () => {
    const { sim, tank, rifle } = world();
    expect(() => start(sim, tank, rifle, mission(FORCE, { start_layout: 'assembly', start_front: 'N' }), false)).toThrow(/slr_test: start_layout "assembly" needs ctx.startLayout/);
  });

  it('an unknown start_layout or start_front is refused', () => {
    expect(() => {
      const { sim, tank, rifle } = world();
      start(sim, tank, rifle, mission(FORCE, { start_layout: 'column' }));
    }).toThrow(/start_layout "column"/);
    expect(() => {
      const { sim, tank, rifle } = world();
      start(sim, tank, rifle, mission(FORCE, { start_layout: 'assembly', start_front: 'NE' }));
    }).toThrow(/start_front "NE"/);
  });

  it('authored: a body that overlaps no earlier body keeps its tile, its own authored body never pushes it', () => {
    const { sim, tank, rifle } = world();
    // Two tanks 4 apart: neither is in the other's way. Each is still in the sim at its authored point when it asks, so a
    // free spot that counted the asker itself would move both.
    const out = start(sim, tank, rifle, mission([{ unit: TANK.id, count: 1, at: [10.5, 10.5] }, { unit: TANK.id, count: 1, at: [14.5, 10.5] }], { start_layout: 'authored' }));
    expect(out.map((p) => p.how)).toEqual(['authored', 'authored']);
    expect([at(sim, 0), at(sim, 1)]).toEqual([[10.5, 10.5], [14.5, 10.5]]);
  });

  it('authored: the later of two stacked tanks moves to the free spot, the earlier stays (a later body blocks nobody)', () => {
    const { sim, tank, rifle } = world();
    const out = start(sim, tank, rifle, mission([{ unit: TANK.id, count: 2, at: [10.5, 10.5] }], { start_layout: 'authored' }));
    // SPREAD puts tank 1 at 11.75, 1.25 east: the capsules (each spanning 1.0 along x at facing 0, radius 0.5) overlap.
    expect(out.map((p) => p.how)).toEqual(['authored', 'free']);
    expect(at(sim, 0)).toEqual([10.5, 10.5]);
    // From (11.75, 10.5): rings of 0.5, clockwise from north. The first clear point is due north at ring 2, (11.75, 9.5):
    // segment to segment 1.0 = the pair distance (touching, not overlapping).
    expect(at(sim, 1)).toEqual([11.75, 9.5]);
  });

  it('the free spot echoing the request is "no spot": the body keeps its authored point', () => {
    // A 1 x 3 pocket at row 10, x 9..11, the only open ground. Three tanks: one in the front-rank slot, then no room for the
    // other two, and the free spot hands the request back (nowhere clears tank 0 by the pair distance).
    const { sim, tank, rifle } = world(24, 24);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (y !== 10 || x < 9 || x > 11) sim.setBlocked(x, y, true);
    const out = start(sim, tank, rifle, mission([{ unit: TANK.id, count: 1, at: [9.5, 10.5] }, { unit: TANK.id, count: 1, at: [10.5, 10.5] }, { unit: TANK.id, count: 1, at: [11.5, 10.5] }], { start_layout: 'assembly', start_front: 'E' }));
    expect(out.map((p) => p.how)).toEqual(['slot', 'authored', 'authored']);
    expect([at(sim, 1), at(sim, 2)]).toEqual([[10.5, 10.5], [11.5, 10.5]]);
  });

  it('placeAtStart writes a position and a facing, and is refused once the sim has ticked', () => {
    const { sim, tank } = world();
    const car = sim.spawn(tank, 0, fx.from(5.5), fx.from(5.5));
    sim.placeAtStart(car, fx.from(8.5), fx.from(6.5), NORTH);
    expect(at(sim, car)).toEqual([8.5, 6.5]);
    expect(sim.state.facing[car]).toBe(NORTH);
    sim.tick();
    expect(() => sim.placeAtStart(car, fx.from(9.5), fx.from(6.5), 0)).toThrow(/before the first tick/);
  });
});
