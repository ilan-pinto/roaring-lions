import { ECO_CAMP } from './golden-worlds.test-helper';
import { MissionRuntime, type MissionJson } from './mission';
import type { Checkpoint } from './runtime-sink-world.test-helper';
import { Sim, type UnitTypeJson } from './sim';

// The forward-camp world (GH-277 follow-on): a small mission in which the player raises a production work, the
// engineer completes it, and its line takes builds. It is the snapshot witness's world for an APPENDED production
// line: the rows `appendedAnchors`, the tail of `lines[0]`, the works rows and the structure columns of a raised
// work all hold a value other than their build value in it. The file name is not matched by vitest's `*.test.ts`
// glob on purpose, as `golden-worlds.test-helper.ts`.
//
// The work here is a TEST type, not the shipped `kdf_forward_camp` (which sets neither `roles` nor
// `build_time_mult`): it carries both, so the menu filter and the build-time multiplier are exercised by the
// witness and the tests as well.

export const FWD_SQUAD: UnitTypeJson = {
  id: 'fwd_squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 25, suppression: 40, rof_per_min: 300, collateral_risk: 0.6 },
  ],
};
export const FWD_TANK: UnitTypeJson = {
  id: 'fwd_tank',
  role: 'mbt',
  hull: { hp: 900, armor: { front: 40, side: 25, rear: 15 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.8 },
  weapons: [],
};
/** A squad priced to a build time (0.85 s = 17 ticks) whose 1.5x is a fraction (25.5): the ceil is observable. */
export const FWD_SCOUT: UnitTypeJson = { ...FWD_SQUAD, id: 'fwd_scout' };
export const FWD_ENGINEER: UnitTypeJson = {
  id: 'fwd_engineer',
  role: 'engineer',
  abilities: ['construct'],
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 6, signature: 0.6 },
  weapons: [],
};

/** A production work: 200 logistics, 5 s, a 2x2 pad; infantry only, items at 1.5x their time; and a heal/repair aura. */
export const FWD_CAMP_WORK = {
  id: 'fwd_camp',
  name: 'Forward Camp',
  hp_per_tile: 300,
  owner: 0,
  buildable: { cost: { logistics: 200 }, build_time_s: 5, footprint: [2, 2] },
  production: { roles: ['infantry'], build_time_mult: 1.5 },
  aura: {
    area: [
      { radius: 4, affects: 'foot', heal_per_s: 0.01, heal_cap: 1.0 },
      { radius: 4, affects: 'vehicle', repair_per_s: 0.01, repair_components_s: 30 },
    ],
  },
};

/** What the world's catalogue answers: a squad (100, 2 s) and a tank (150, 4 s), for side 0. */
export const fwdUnitInfo = (u: string): ReturnType<NonNullable<ConstructorParameters<typeof MissionRuntime>[2]['unitInfo']>> => {
  if (u === 'fwd_squad') return { logistics: 100, buildTimeS: 2, population: 1, role: 'infantry' };
  if (u === 'fwd_tank') return { logistics: 150, buildTimeS: 4, population: 1, role: 'mbt' };
  if (u === 'fwd_scout') return { logistics: 50, buildTimeS: 0.85, population: 1, role: 'infantry' };
  return null;
};

export interface ForwardWorldOptions {
  /** Replace the work type's JSON (the tests vary it). */
  work?: typeof FWD_CAMP_WORK | Record<string, unknown>;
  /** The mission's `field_works` count for the work. Default 1. */
  count?: number;
  /** Side 0's start purse. Default 1500. */
  logistics?: number;
  /** The authored camps (top-left tiles). Default one, at (2, 2). */
  camps?: readonly (readonly [number, number])[];
  /** The sim's entity capacity. Default 64. */
  capacity?: number;
}

export function forwardMission(count: number, logistics: number, camps: readonly (readonly [number, number])[] = [[2, 2]]): MissionJson {
  return {
    id: 'forward',
    map: { file: 'none', player_start: [3, 12] },
    ledger: { requires: [], produces: [] },
    structures: camps.map(([x, y]) => ({ type: 'camp', at: [x, y], size: [2, 2] })),
    resources: { logistics_start: logistics, intel_start: 0 },
    field_works: { fwd_camp: count },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    starting_force: [
      { unit: 'fwd_squad', count: 1, at: [6, 6] },
      { unit: 'fwd_engineer', count: 1, at: [12, 10] },
    ],
  } as MissionJson;
}

export function forwardWorld(o: ForwardWorldOptions = {}): { sim: Sim; rt: MissionRuntime } {
  const sim = new Sim({ seed: 0x277f, width: 48, height: 32, capacity: o.capacity ?? 64 });
  const types = new Map<string, number>();
  for (const t of [FWD_SQUAD, FWD_TANK, FWD_SCOUT, FWD_ENGINEER]) types.set(t.id, sim.addUnitType(t));
  for (const s of [ECO_CAMP, o.work ?? FWD_CAMP_WORK]) sim.addStructureType(s as never);
  const rt = new MissionRuntime(sim, forwardMission(o.count ?? 1, o.logistics ?? 1500, o.camps), {
    typeIdOf: (u) => {
      const t = types.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: {},
    zones: {},
    unitInfo: (u) => fwdUnitInfo(u),
  });
  rt.start();
  return { sim, rt };
}

/** The tile the world raises its work on: two tiles from the engineer. */
export const FWD_PAD: readonly [number, number] = [14, 10];

function must(ok: boolean, what: string): void {
  if (!ok) throw new Error(`forward world: ${what} refused`);
}

/**
 * The world's inputs. `i` is the tick count BEFORE the tick. The work is raised at 1; one squad is queued on the camp's line
 * at 3; once the work stands (the world checks it by 250) the forward line takes a squad (named), refuses the tank (named: it
 * is off that line's menu), the unnamed tank goes to the camp's line, the forward line gets a rally, a second squad and then
 * a cancel of the first queued one.
 */
export function forwardDrive(rt: MissionRuntime, i: number): void {
  if (i === 1) must(rt.requestConstruct('fwd_camp', FWD_PAD[0], FWD_PAD[1]), 'the work request');
  if (i === 3) must(rt.requestBuild('fwd_squad'), 'a squad on the camp line');
  if (i === 250) {
    must(rt.productionLines(0).length === 2, 'the work to have opened its line by tick 250');
    must(rt.requestBuild('fwd_squad', 1), 'a squad on the forward line');
    must(!rt.requestBuild('fwd_tank', 1), 'REFUSING a tank on the forward line (it is off that line\'s menu)');
    must(rt.requestBuild('fwd_tank'), 'a tank, unnamed, on the camp line');
    must(rt.setRally(1, 20 * 65536 + 32768, 14 * 65536 + 32768), 'a rally on the forward line');
  }
  if (i === 260) must(rt.requestBuild('fwd_squad', 1), 'a second squad on the forward line');
  if (i === 270) must(rt.requestBuild('fwd_squad', 1), 'a third squad on the forward line');
  if (i === 280) must(rt.cancelBuild(1, 0), 'a cancel of the first queued squad');
}

export function forwardAdvance(w: { readonly sim: Sim; readonly rt: MissionRuntime }): void {
  w.rt.step(w.sim.tick());
}

/** The world's length, in ticks. */
export const FWD_TICKS = 500;

/** Walk the forward world to its end, checking at the moments that matter and every 20 ticks: the census's walk. */
export function walkForward(at: (c: Checkpoint) => void): void {
  const { sim, rt } = forwardWorld();
  const look = (label: string): void => at({ label, rt, sim });
  look('forward@0');
  for (let t = 1; t <= FWD_TICKS; t++) {
    forwardDrive(rt, t - 1);
    forwardAdvance({ sim, rt });
    if (t === 2) look('forward@2 (a site staked, no line yet)');
    if (t === 136) look('forward@136 (the work complete, its line opened this tick)');
    if (t === 251) look('forward@251 (items on both lines, a rally on the forward line)');
    if (t % 20 === 0) look(`forward@${t}`);
  }
}
