import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import type { StructureTypeJson } from './structures';

// GH-1438 E1: the compound-gate world. One world, three readers: `gate.test.ts` (the fork witness mid-swing),
// `determinism.test.ts` (`GATE_WORLD_PIN`, the one replay that sees the gate block of hash()) and the snapshot
// census in `tools/src/net/snapshot-witness.ts` (the one world in which the gate columns move). The file name is
// not matched by vitest's `*.test.ts` glob on purpose, as `golden-worlds.test-helper.ts`: it holds no spec.
//
// The shape: a 40 x 18 field split by a wall at x = 18 with a 1 x 2 gate at (18, 8)-(18, 9), centroid
// (18.5, 9.0). Two civilians (side 2) on the west are sent to the far east at tick 2 and press the wall while the
// gate is shut; a KDF rifle squad (side 0) walks from the east to within the radius at tick 10, the gate swings
// open, the civilians walk through, the squad walks off at tick 260 and the gate shuts behind them. At tick 420 a
// third civilian is sent east and presses the shut gate; at tick 800 the squad comes back and lets it through, and
// at tick 1100 it walks off again.
// Nothing carries a weapon: the world exercises the gate and nothing else.

export const GATE_WORLD_SEED = 0x1438;
export const GATE_WORLD_TICKS = 1400;
export const GATE_W = 40;
export const GATE_H = 18;
export const GATE_X = 18;
/** The gate's two tiles, top first. */
export const GATE_TILES: readonly number[] = [8 * GATE_W + GATE_X, 9 * GATE_W + GATE_X];

/** The test gate type: the design's `compound_gate` row (section 2.2), with a test id and a shipped palette key. */
export function gateTypeJson(over: Partial<NonNullable<StructureTypeJson['gate']>> = {}, extra: Partial<StructureTypeJson> = {}): StructureTypeJson {
  return {
    id: 'test_gate',
    name: 'Compound Gate',
    hp_per_tile: 600,
    garrison_slots: 0,
    rubble_cover: 1,
    height_px: 14,
    color: 'gunmetal.1',
    roe_penalty: 0,
    per_tile: false,
    low_profile: true,
    standing_cover: 2,
    gate: { open_radius_tiles: 4, hold_open_s: 3, swing_s: 2, ...over },
    ...extra,
  };
}

export const GATE_WALL: StructureTypeJson = {
  id: 'test_wall',
  name: 'Compound Wall',
  hp_per_tile: 200,
  garrison_slots: 0,
  rubble_cover: 1,
  height_px: 7,
  roe_penalty: 0,
  per_tile: true,
  low_profile: true,
  standing_cover: 2,
};

/** A KDF rifle squad with no weapon. */
export const GATE_RIFLES: UnitTypeJson = {
  id: 'gate_rifles',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  weapons: [],
};

/** A civilian family: slower, unarmed. */
export const GATE_CIVILIANS: UnitTypeJson = {
  id: 'gate_civilians',
  role: 'infantry',
  hull: { hp: 100, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 1, sight_tiles: 6, signature: 0.6 },
  weapons: [],
};

export interface GateWorld {
  readonly sim: Sim;
  readonly gate: number;
  readonly rifles: number;
  readonly civilians: readonly number[];
  readonly drive: (t: number) => void;
}

/** The world at tick 0. `swingS` is the fixture's `swing_s` (the determinism pin's falsification turns it). */
export function gateWorld(swingS = 2): GateWorld {
  const sim = new Sim({ seed: GATE_WORLD_SEED, width: GATE_W, height: GATE_H, capacity: 16 });
  const wallType = sim.addStructureType(GATE_WALL);
  const gateType = sim.addStructureType(gateTypeJson({ swing_s: swingS }));
  for (let y = 0; y < GATE_H; y++) {
    if (y === 8 || y === 9) continue;
    sim.addStructure(wallType, [y * GATE_W + GATE_X]);
  }
  const gate = sim.addStructure(gateType, [...GATE_TILES]);
  const rifleType = sim.addUnitType(GATE_RIFLES);
  const civType = sim.addUnitType(GATE_CIVILIANS);
  const rifles = sim.spawn(rifleType, 0, fx.from(34.5), fx.from(9.5));
  const civilians = [
    sim.spawn(civType, 2, fx.from(6.5), fx.from(4.5)),
    sim.spawn(civType, 2, fx.from(7.5), fx.from(13.5)),
    sim.spawn(civType, 2, fx.from(3.5), fx.from(9.5)),
  ];
  const move = (ids: number[], x: number, y: number): void => {
    sim.queueCommand({ kind: 'move', ids, x: fx.from(x), y: fx.from(y) });
  };
  const drive = (t: number): void => {
    if (t === 2) move([civilians[0], civilians[1]], 36.5, 4.5);
    if (t === 10) move([rifles], 21.5, 9.5);
    if (t === 260) move([rifles], 36.5, 15.5);
    if (t === 420) move([civilians[2]], 30.5, 9.5);
    if (t === 800) move([rifles], 21.5, 6.5);
    if (t === 1100) move([rifles], 37.5, 1.5);
  };
  return { sim, gate, rifles, civilians, drive };
}

/** Runs the world for `ticks`, calling `onTick` after every tick. */
export function runGateWorld(w: GateWorld, ticks: number, onTick?: (t: number) => void): void {
  for (let t = 0; t < ticks; t++) {
    w.drive(t);
    w.sim.tick();
    onTick?.(t);
  }
}
