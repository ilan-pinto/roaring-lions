import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';

// GH-1438 E6: the fires-on-civilians world. One world, three readers: `civ-fire.test.ts` (the rules and the fork
// witness), `determinism.test.ts` (`CIV_FIRE_WORLD_PIN`, the one replay that sees the `civFire` block of hash()) and the
// snapshot census in `tools/src/net/snapshot-witness.ts` (the one world in which `civFire` and `civFireLive` move). The
// file name is not matched by vitest's `*.test.ts` glob on purpose, as `gate-world.test-helper.ts`: it holds no spec.
//
// The shape: a 32 x 12 field, no walls. Two enemy rifle cells (side 1) stand at (16.5, 4.5) and (16.5, 8.5); three
// civilians (side 2), who go down in place when hit, stand around them, the nearest to cell A. At tick 40 cell A's
// placement is flagged `fires_on_civilians` (what `spawnPlacement` does for a wave that arrives mid-mission), and from
// then on it shoots the crowd, nearest first; cell B is never flagged and holds its fire. At tick 300 a KDF squad
// (side 0) walks from the far west corner into both cells' reach, and both turn on it: the fighting sides first.

export const CIV_FIRE_WORLD_SEED = 0x14386;
export const CIV_FIRE_WORLD_TICKS = 600;
/** The tick the drive flags cell A. */
export const CIV_FIRE_FLAG_TICK = 40;
/** The tick the KDF squad is ordered into reach. */
export const CIV_FIRE_KDF_TICK = 300;

const RIFLES = {
  id: 'rifles',
  type: 'small_arms',
  range_tiles: 7,
  effective_range_tiles: 5.5,
  accuracy: 0.6,
  penetration: 8,
  damage: 25,
  suppression: 40,
  rof_per_min: 300,
};

export const CF_CELL: UnitTypeJson = {
  id: 'cf_cell',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  weapons: [RIFLES],
};
export const CF_KDF: UnitTypeJson = { ...CF_CELL, id: 'cf_kdf', mobility: { speed_tiles_s: 1.6 } };
export const CF_WOUNDED: UnitTypeJson = {
  id: 'cf_wounded',
  role: 'wounded',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
  mobility: { speed_tiles_s: 0.12 },
  sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
};
/** One adult who goes down in place when hit (the shipped `down` pose), and bleeds 60 s: the lead's rescue clock. */
export const CF_CIV: UnitTypeJson = {
  id: 'cf_civ',
  role: 'civilian',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, wounds: { wound_chance: 1, bleed_s: 60, type: 'cf_wounded', in_place: true } },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7 },
};

export interface CivFireWorld {
  readonly sim: Sim;
  readonly cellA: number;
  readonly cellB: number;
  readonly kdf: number;
  /** Nearest to cell A first. */
  readonly civilians: readonly number[];
  readonly drive: (t: number) => void;
}

/** The world at tick 0. `flag` false is the control: the same world with cell A never flagged. */
export function civFireWorld(flag = true): CivFireWorld {
  const sim = new Sim({ seed: CIV_FIRE_WORLD_SEED, width: 32, height: 12, capacity: 24 });
  sim.addUnitType(CF_WOUNDED);
  const cell = sim.addUnitType(CF_CELL);
  const kdfType = sim.addUnitType(CF_KDF);
  const civ = sim.addUnitType(CF_CIV);
  const cellA = sim.spawn(cell, 1, fx.from(16.5), fx.from(4.5));
  const cellB = sim.spawn(cell, 1, fx.from(16.5), fx.from(8.5));
  const kdf = sim.spawn(kdfType, 0, fx.from(1.5), fx.from(10.5));
  const civilians = [
    sim.spawn(civ, 2, fx.from(19.5), fx.from(3.5)), // 3.2 tiles from A
    sim.spawn(civ, 2, fx.from(12.5), fx.from(3.5)), // 4.1 from A
    sim.spawn(civ, 2, fx.from(21.5), fx.from(6.5)), // 5.4 from A
  ];
  const drive = (t: number): void => {
    if (flag && t === CIV_FIRE_FLAG_TICK) sim.setCivFire(cellA);
    if (t === CIV_FIRE_KDF_TICK) sim.queueCommand({ kind: 'move', ids: [kdf], x: fx.from(12.5), y: fx.from(8.5) });
  };
  return { sim, cellA, cellB, kdf, civilians, drive };
}

/** Runs the world for `ticks`, calling `onTick` with the tick's events after every tick. */
export function runCivFireWorld(
  w: CivFireWorld,
  ticks: number,
  onTick?: (t: number, events: ReturnType<Sim['tick']>) => void,
): void {
  for (let t = 0; t < ticks; t++) {
    w.drive(t);
    const evs = w.sim.tick();
    onTick?.(t, evs);
  }
}
