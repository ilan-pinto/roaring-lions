import { ECO_CAMP, ECO_CAMP_S1 } from './golden-worlds.test-helper';
import { fx } from './fixed';
import { MissionRuntime, type MissionJson } from './mission';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import type { TunnelRouteJson } from './tunnels';

// The sink world (net sim snapshot S2, Task 1; moved out of runtime-snapshot-schema.test.ts in Task 3 so the
// codec tests walk the same world): not a replay, a small mission that fills every container the two economy
// replays leave empty. The file name is not matched by vitest's `*.test.ts` glob on purpose, as
// `golden-worlds.test-helper.ts`.

export interface Checkpoint {
  readonly label: string;
  readonly rt: MissionRuntime;
  readonly sim: Sim;
}

// --- the sink world: every container the two economy replays leave empty ---------------------------
// A small mission that carries what the replays do not: tags, a patrol, civilians and an evacuation,
// a razed house, a tunnel to collapse, a ledger roster and marked tags, a loaned placement, field
// works, side 1 with a camp and a buying menu, a road mask, triggers and waves, and a wounded man.
// The container rows these fill would otherwise be checked only against an empty Map or a null.
// Synthetic sim events are fed to `rt.step` for the parts a fight would take minutes to produce.

const SINK_SQUAD: UnitTypeJson = {
  id: 'sink_squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 25, suppression: 40, rof_per_min: 300, collateral_risk: 0.6 },
  ],
};
const SINK_CIV: UnitTypeJson = {
  id: 'sink_civ',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7 },
};
const SINK_ENGINEER: UnitTypeJson = {
  id: 'sink_engineer',
  role: 'engineer',
  abilities: ['construct'],
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 6, signature: 0.6 },
  weapons: [],
};
const SINK_WOUNDED: UnitTypeJson = {
  id: 'sink_wounded',
  role: 'wounded',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
  mobility: { speed_tiles_s: 0.12 },
  sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
};
const SINK_HOUSE = { id: 'sink_house', name: 'House', hp_per_tile: 200, garrison_slots: 2, rubble_cover: 2, roe_penalty: 6 };
const SINK_OUTPOST = {
  id: 'sink_outpost', name: 'Outpost', hp_per_tile: 200, owner: 0,
  buildable: { cost: { logistics: 100, intel: 10 }, build_time_s: 20, footprint: [2, 2] },
};
const SINK_ROUTE: TunnelRouteJson = { id: 'tn_sink', points: [[3, 18], [9, 18]], dig_tiles_per_s: 1, pre_dug: true };

const SINK_MISSION: MissionJson = {
  id: 'sink',
  map: { file: 'none', player_start: [3, 12] },
  ledger: { requires: [], produces: ['roster.surviving_units', 'intel.marked_positions'] },
  structures: [
    { type: 'camp', at: [2, 2], size: [2, 2] },
    { type: 'camp_s1', at: [44, 2], size: [2, 2] },
  ],
  resources: {
    logistics_start: 600,
    logistics_rate_per_min: 60,
    intel_start: 300,
    income_zones: [{ zone: 'z1', rate_per_min: 30 }],
    supply_corridor: true,
    supply_entry: 'convoy_entry',
  },
  field_works: { sink_outpost: 2 },
  roe: { enabled: true, flagged_zones: ['clinic'] },
  civilians: { groups: [{ unit: 'sink_civ', count: 2, at: [10, 5] }], refuge: 'refuge' },
  objectives: [
    { id: 'hold', type: 'survive_until', primary: true, seconds: 600 },
    { id: 'find', type: 'locate', primary: false, target: 'hvt' },
    { id: 'evac', type: 'evacuate_before', primary: false, target: 'refuge_zone', count: 1, seconds: 900 },
    { id: 'level', type: 'raze', primary: false, target: 'depot', seconds: 900 },
    { id: 'seal', type: 'collapse', primary: false, target: 'district', seconds: 900 },
  ],
  starting_force: [
    { unit: 'sink_squad', count: 2, at: [38, 24], tag: 'alpha', group: 'alpha' },
    { unit: 'sink_squad', count: 1, at: [10, 7], from_ledger: true },
    { unit: 'sink_squad', count: 1, at: [10, 16], stance: { kind: 'patrol', waypoints: [[10, 16], [14, 16]] } },
    { unit: 'sink_engineer', count: 1, at: [12, 10] },
  ],
  enemy: {
    garrison: [
      { unit: 'sink_squad', count: 2, at: [40, 6], tag: 'hvt', group: 'foes', stance: { kind: 'hold_position' } },
      // A picket beside the way home from `z1`, out of reach of every holder: it interdicts the zone's line.
      { unit: 'sink_squad', count: 1, at: [20, 13], group: 'picket', stance: { kind: 'hold_position' } },
      { unit: 'sink_wounded', count: 1, at: [30, 20] },
    ],
    waves: [{ at_seconds: 9999, units: [{ unit: 'sink_squad', count: 1, from: 'wave_from' }] }],
    production: { menu: ['sink_squad'], rally: 'wave_from' },
  },
  triggers: [{ id: 't1', on: { kind: 'timer_s', value: 9999 }, do: { kind: 'commit', group: 'foes', to: 'wave_from' }, label: 'Never' }],
};

export function sinkWorld(): { sim: Sim; rt: MissionRuntime } {
  const sim = new Sim({ seed: 0x51c, width: 48, height: 32, capacity: 64 });
  const types = new Map<string, number>();
  for (const t of [SINK_SQUAD, SINK_CIV, SINK_ENGINEER, SINK_WOUNDED]) types.set(t.id, sim.addUnitType(t));
  for (const st of [ECO_CAMP, ECO_CAMP_S1, SINK_HOUSE, SINK_OUTPOST]) sim.addStructureType(st);
  const houseType = sim.structureTypes.findIndex((t) => t.id === 'sink_house');
  sim.addStructure(houseType, [6 * 48 + 16, 6 * 48 + 17, 7 * 48 + 16, 7 * 48 + 17]);
  sim.addTunnel(SINK_ROUTE);
  const roadMask = new Uint8Array(48 * 32);
  for (let x = 4; x < 29; x++) roadMask[12 * 48 + x] = 1;
  const rt = new MissionRuntime(sim, SINK_MISSION, {
    typeIdOf: (u) => {
      const t = types.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: { refuge: [2, 10], wave_from: [44, 28], convoy_entry: [28, 12] },
    zones: {
      refuge_zone: [0, 8, 6, 4],
      depot: [16, 6, 2, 2],
      district: [2, 17, 4, 3],
      clinic: [20, 18, 4, 4],
      z1: [36, 22, 8, 6],
    },
    tunnels: [SINK_ROUTE],
    ledger: {
      // One entry is drawn at `start()` (the `from_ledger` placement); the other stays in the pool.
      'roster.surviving_units': [
        { type: 'sink_squad', veterancy: 1, name: 'Barkai', missions: 2, kills: 3, wounded_in_action: 1, slot: 0, enlisted: 'm1' } as never,
        { type: 'sink_other', veterancy: 2, missions: 1, kills: 0 },
      ],
      'intel.marked_positions': ['hvt'],
    },
    loaned: [0],
    roadMask,
    unitInfo: (u) => (u === 'sink_squad' ? { logistics: 100, buildTimeS: 5, population: 1 } : null),
    popCaps: [20, 20],
    economy: { logisticsStart: [600, 400], logisticsRatePerMin: [60, 60] },
  });
  rt.start();
  return { sim, rt };
}

/** The ids the sink mission places, in placement order: 0-1 alpha, 2 the ledger draw, 3 the patroller,
 *  4 the engineer, 5-6 the hvt garrison, 7 the picket, 8 the wounded man, 9-10 the civilians. */
export const SINK_EVENTS = (tick: number): SimEvent[] => [
  { kind: 'contact', tick, side: 0, target: 5, level: 'identified', confidence: 65536, observer: 0 },
  { kind: 'destroyed', tick, entity: 6, by: 0 },
  { kind: 'woundedDown', tick, entity: 6, parent: 0, by: 6 },
  { kind: 'woundRejoined', tick, entity: 6, squad: 0 },
  { kind: 'woundAdmitted', tick, entity: 6, structure: -1, side: 0 },
  { kind: 'tunnelContact', tick, side: 0, tunnel: 0, level: 'identified', observer: 1 },
  { kind: 'nearMiss', tick, shooter: 0, weaponId: 'rifles', x: fx.from(21.5), y: fx.from(19.5) },
  // A player round aimed at an enemy who is already down (the wounded man, id 8).
  {
    kind: 'fire', tick, shooter: 0, target: 8, weaponId: 'rifles', pHit: 0, roll: 0, willHit: false,
    breakdown: { accuracy: 0, rangeFalloff: 0, coverMod: 0, motionMod: 0, stanceMod: 0, suppressionMod: 0 },
  } as SimEvent,
];

/** The walk's own preconditions: a plain Error (the helper must load outside the runner), which fails the spec that called it. */
function must(ok: boolean, what: string): void {
  if (!ok) throw new Error(`sink world: ${what} refused`);
}

/**
 * The sink world as a fork-witness world (net sim snapshot S2, Task 4): what `walkSink` does, as a driver and a step
 * of its own, so the witness can cut it anywhere. `i` is the tick count BEFORE the tick (`walkSink`'s `t - 1`). A
 * works site is staked at `i = 1` and three builds are queued at `i = 2`; with `cancelAt`, every staked site is
 * cancelled at that `i` (a site staked and cancelled inside one 20-tick recheck window moves the sim's vehicle mask
 * and moves it back, so `terrainVersion` never bumps and the runtime's mask copies stay the old ones).
 */
export function sinkDrive(rt: MissionRuntime, i: number, cancelAt: number | null = null): void {
  if (i === 1) must(rt.requestConstruct('sink_outpost', 13, 10), 'the sink world accepts its works request');
  if (i === 2) for (let k = 0; k < 3; k++) must(rt.requestBuild('sink_squad', 0), 'line 0 takes three builds');
  if (cancelAt !== null && i === cancelAt) {
    for (const site of [...(rt as unknown as { worksSites: Map<number, unknown> }).worksSites.keys()]) must(rt.requestCancelWorks(site), 'the sink world cancels its site');
  }
}

/** One tick of the sink world: the sim, then the runtime with the synthetic events at tick 10, and the forced completion at tick 40. */
export function sinkAdvance(w: { readonly sim: Sim; readonly rt: MissionRuntime }): void {
  const events = w.sim.tick();
  if (w.sim.tickCount === 10) w.rt.step([...events, ...SINK_EVENTS(w.sim.tickCount)]);
  else w.rt.step(events);
  if (w.sim.tickCount === 40) must(w.rt.completeObjective('level'), 'the sink world completes its raze objective');
}

/** Walk the sink world 400 ticks, checking every 20, plus the moments a pending list is non-empty. */
export function walkSink(at: (c: Checkpoint) => void): void {
  const { sim, rt } = sinkWorld();
  const look = (label: string): void => {
    void rt.incomePerMin;
    at({ label, rt, sim });
  };
  look('sink@0');
  for (let t = 1; t <= 400; t++) {
    if (t === 2) {
      must(rt.requestConstruct('sink_outpost', 13, 10), 'the sink world accepts its works request');
      look('sink@2 (a works charge pending)');
    }
    if (t === 3) for (let k = 0; k < 3; k++) must(rt.requestBuild('sink_squad', 0), 'line 0 takes three builds');
    const events = sim.tick();
    if (t === 10) rt.step([...events, ...SINK_EVENTS(sim.tickCount)]);
    else rt.step(events);
    if (t === 40) {
      must(rt.completeObjective('level'), 'the sink world completes its raze objective');
      look('sink@40 (a forced completion owed)');
    }
    if (t % 20 === 0) look(`sink@${t}`);
  }
}
