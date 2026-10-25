import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ECO_CAMP,
  ECO_CAMP_S1,
  ECONOMY_SEED,
  ECONOMY_TICKS,
  RELIEF_ECO_B_ORDER_TICK,
  RELIEF_ECO_SEED,
  RELIEF_ECO_TICKS,
  economyAdvance,
  economyDrive,
  economySetup,
  reliefEconomySetup,
} from './golden-worlds.test-helper';
import { fx } from './fixed';
import { MissionRuntime, type MissionJson } from './mission';
import {
  RUNTIME_REF_RULES,
  RUNTIME_ROW_SETS,
  RUNTIME_SNAPSHOT_SCHEMA,
  runtimeRowsOf,
  type RefRule,
  type RowSetName,
  type RuntimeKind,
  type RuntimeRow,
} from './runtime-snapshot-schema';
import {
  censusAt,
  checkRows,
  checkRuntime,
  collectAliases,
  explainAliases,
  jsonComplaints,
  newCensus,
  probeClosures,
  props,
  ruleKey,
  schemaPaths,
  unusedRules,
  type Env,
  type Props,
} from './runtime-snapshot-schema.test-helper';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import type { TunnelRouteJson } from './tunnels';

// The completeness gate for the runtime snapshot schema (net sim snapshot S2, Task 1). It reflects
// over live `MissionRuntime`s (`runtime-snapshot-schema.test-helper.ts`) and fails, naming the
// property, on an own property with no row and on a row naming a property no runtime has; and it
// checks every row's kind against the live value (recursively, through every owned record), so a
// table that lists the right names with the wrong shape is red too. The same two-way check on the
// runtime of a versus economy room lives in tools/src/net/snapshot-witness.test.ts:
// `buildMatchWorld` is in packages/app, which the sim may not import.

// --- the worlds ----------------------------------------------------------------------------------

interface Checkpoint {
  readonly label: string;
  readonly rt: MissionRuntime;
  readonly sim: Sim;
}

/** Walk a world and call `at` at each listed tick (before that tick's drive), once more at the end. */
function walkEconomy(ticks: readonly number[], at: (c: Checkpoint) => void): void {
  const w = economySetup(ECONOMY_SEED);
  let next = 0;
  for (let t = 0; t <= ECONOMY_TICKS; t++) {
    if (next < ticks.length && ticks[next] === t) {
      void w.rt.incomePerMin;
      at({ label: `economy@${t}`, rt: w.rt, sim: w.sim });
      next++;
    }
    if (t === ECONOMY_TICKS) break;
    economyDrive(w, t);
    economyAdvance(w, t);
  }
}

function walkRelief(ticks: readonly number[], at: (c: Checkpoint) => void): void {
  const { sim, rt } = reliefEconomySetup(RELIEF_ECO_SEED);
  let next = 0;
  for (let t = 0; t <= RELIEF_ECO_TICKS; t++) {
    if (next < ticks.length && ticks[next] === t) {
      void rt.incomePerMin;
      at({ label: `relief@${t}`, rt, sim });
      next++;
    }
    if (t === RELIEF_ECO_TICKS) break;
    // The relief replay's own orders (determinism.test.ts `reliefEconomyReplay`): A onto the bench at 5,
    // a refused build at 100 (the cap is full), B up to the pass late.
    if (t === 5) sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(24.5), y: fx.from(25.5) });
    if (t === 100) rt.requestBuild('inf_squad');
    if (t === RELIEF_ECO_B_ORDER_TICK) sim.queueCommand({ kind: 'move', ids: [1], x: fx.from(24.5), y: fx.from(15.5) });
    const events = sim.tick();
    rt.step(events);
  }
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

function sinkWorld(): { sim: Sim; rt: MissionRuntime } {
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
const SINK_EVENTS = (tick: number): SimEvent[] => [
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

/** Walk the sink world 400 ticks, checking every 20, plus the moments a pending list is non-empty. */
function walkSink(at: (c: Checkpoint) => void): void {
  const { sim, rt } = sinkWorld();
  const look = (label: string): void => {
    void rt.incomePerMin;
    at({ label, rt, sim });
  };
  look('sink@0');
  for (let t = 1; t <= 400; t++) {
    if (t === 2) {
      expect(rt.requestConstruct('sink_outpost', 13, 10)).toBe(true);
      look('sink@2 (a works charge pending)');
    }
    if (t === 3) for (let k = 0; k < 3; k++) expect(rt.requestBuild('sink_squad', 0), 'line 0 takes three builds').toBe(true);
    const events = sim.tick();
    if (t === 10) rt.step([...events, ...SINK_EVENTS(sim.tickCount)]);
    else rt.step(events);
    if (t === 40) {
      expect(rt.completeObjective('level')).toBe(true);
      look('sink@40 (a forced completion owed)');
    }
    if (t % 20 === 0) look(`sink@${t}`);
  }
}

const every = (step: number, end: number, extra: readonly number[]): number[] => {
  const out = new Set<number>(extra);
  for (let t = 0; t <= end; t += step) out.add(t);
  return [...out].sort((a, b) => a - b);
};
// Every 100 ticks, and the ticks the replays do something at (builds, the raider's walk, the cancel).
const ECONOMY_TICKS_CHECKED = every(100, ECONOMY_TICKS, [1, 405, 805, 1505, 1520, 1760, 2305]);
const RELIEF_TICKS_CHECKED = every(100, RELIEF_ECO_TICKS, [1, 105, 1705]);

// The classes, written out independently of the table. `state` is "everything else", so only the
// three smaller classes are listed; reclassifying a property is a deliberate edit to BOTH places.
const EXPECT: Readonly<Record<'MissionRuntime' | RowSetName, { config: string[]; scratch: string[]; derived: string[] }>> = {
  MissionRuntime: {
    config: [
      'sim', 'mission', 'ctx', 'startingIds', 'enemyAtStart', 'civIds', 'razeTargets', 'razeExempt', 'onLoan', 'collapseTargets',
      'convoyEntry', 'zoneTiles', 'zoneRects', 'holdView', 'routeSource', 'enemyMenu', 'enemyMinCost', 'marked', 'riseOf', 'riseCount',
    ],
    scratch: ['ventOut', 'zoneStateOut', 'cutSpan', 'fromTile', 'rearTile', 'incomeRead', 'refusedByPopulation', 'riseHolder'],
    derived: [],
  },
  ObjectiveState: { config: ['def'], scratch: [], derived: [] },
  PatrolState: { config: [], scratch: [], derived: [] },
  CivilianFlight: { config: ['shepherds'], scratch: ['scratch'], derived: [] },
  ZoneIncomeState: { config: ['zone', 'rect', 'ratePerMin'], scratch: [], derived: [] },
  ConvoyRoute: { config: [], scratch: [], derived: [] },
  ConvoyEntry: { config: ['x', 'y'], scratch: [], derived: [] },
  CorridorField: { config: [], scratch: [], derived: ['field'] },
  HoldView: {
    config: ['entityCount', 'alive', 'side', 'posX', 'posY', 'tunnelIn', 'isAir', 'isDown', 'width', 'tunnelCount', 'tnAlive', 'tnVentOpen', 'tnDigger', 'ventAt'],
    scratch: [],
    derived: [],
  },
  RouteSource: { config: ['width', 'height', 'vehicleMask', 'roadMask', 'fieldFor'], scratch: [], derived: [] },
  TileScratch: { config: [], scratch: ['x', 'y'], derived: [] },
  IncomeRead: { config: [], scratch: ['base', 'zones', 'halvedBy'], derived: [] },
  WorksEntry: { config: ['offer', 'structType'], scratch: [], derived: [] },
  WorksOffer: { config: ['typeId', 'name', 'max', 'logistics', 'intel'], scratch: [], derived: [] },
  WorksCharge: { config: [], scratch: [], derived: [] },
  WorksStructure: { config: [], scratch: [], derived: [] },
  ProductionLine: { config: ['side', 'anchor'], scratch: [], derived: [] },
  LineItem: { config: [], scratch: [], derived: [] },
  Rally: { config: [], scratch: [], derived: [] },
};

function tableOf(name: 'MissionRuntime' | RowSetName): readonly RuntimeRow[] {
  return name === 'MissionRuntime' ? RUNTIME_SNAPSHOT_SCHEMA : RUNTIME_ROW_SETS[name];
}

/** Every way a table disagrees with the independent class lists; empty means it agrees. */
function classMismatches(name: 'MissionRuntime' | RowSetName, table: readonly RuntimeRow[]): string[] {
  const out: string[] = [];
  const want = EXPECT[name];
  const names = (c: Parameters<typeof runtimeRowsOf>[0]): string[] => runtimeRowsOf(c, table).map((r) => r.name).sort();
  const same = (cls: string, expected: string[]): void => {
    const e = [...expected].sort().join();
    const f = names(cls as Parameters<typeof runtimeRowsOf>[0]).join();
    if (e !== f) out.push(`${name} ${cls}: expected [${e}], found [${f}]`);
  };
  same('config', want.config);
  same('scratch', want.scratch);
  same('derived', want.derived);
  const listed = new Set([...want.config, ...want.scratch, ...want.derived]);
  same('state', table.filter((r) => !listed.has(r.name)).map((r) => r.name));
  return out;
}

/** Every row of every table, as the census keys them. */
const ALL_KEYS: string[] = (['MissionRuntime', ...(Object.keys(RUNTIME_ROW_SETS) as RowSetName[])] as const).flatMap((n) =>
  tableOf(n).map((r) => `${n}.${r.name}`)
);

/** Rows whose populated form no sim-package world shows (see "the census" below). */
const UNEXERCISED_IN_SIM_WORLDS: readonly string[] = [];

describe('runtime snapshot schema: completeness over the golden economy replay', () => {
  it('every property has a row and every row a property, at every checked tick, kinds and lengths and references included', () => {
    const seen = new Set<string>();
    const labels: string[] = [];
    walkEconomy(ECONOMY_TICKS_CHECKED, (c) => {
      labels.push(c.label);
      expect(checkRuntime(c.label, c.rt, c.sim, seen), c.label).toEqual([]);
    });
    expect(labels).toEqual(ECONOMY_TICKS_CHECKED.map((t) => `economy@${t}`));
  }, 60_000);
});

describe('runtime snapshot schema: completeness over the relief economy replay', () => {
  it('every property has a row and every row a property, at every checked tick, kinds and lengths and references included', () => {
    const seen = new Set<string>();
    const labels: string[] = [];
    walkRelief(RELIEF_TICKS_CHECKED, (c) => {
      labels.push(c.label);
      expect(checkRuntime(c.label, c.rt, c.sim, seen), c.label).toEqual([]);
    });
    expect(labels).toHaveLength(RELIEF_TICKS_CHECKED.length);
  }, 60_000);
});

describe('runtime snapshot schema: completeness over the sink world', () => {
  it('every property has a row and every row a property, with tags, patrols, civilians, works and a ledger in play', () => {
    const seen = new Set<string>();
    const labels: string[] = [];
    walkSink((c) => {
      labels.push(c.label);
      expect(checkRuntime(c.label, c.rt, c.sim, seen), c.label).toEqual([]);
    });
    expect(labels).toContain('sink@40 (a forced completion owed)');
    expect(labels.length).toBeGreaterThan(15);
  }, 60_000);
});

describe('runtime snapshot schema: the table itself', () => {
  it('the 98 rows are in creation order, each name once', () => {
    const { rt } = economySetup(ECONOMY_SEED);
    expect(RUNTIME_SNAPSHOT_SCHEMA.map((r) => r.name)).toEqual(Object.keys(rt));
    expect(RUNTIME_SNAPSHOT_SCHEMA).toHaveLength(98);
    expect(new Set(RUNTIME_SNAPSHOT_SCHEMA.map((r) => r.name)).size).toBe(98);
  });

  it('the classes are exactly the ones the design names; everything else is state', () => {
    for (const name of ['MissionRuntime', ...(Object.keys(RUNTIME_ROW_SETS) as RowSetName[])] as const) {
      expect(classMismatches(name, tableOf(name)), name).toEqual([]);
    }
  });

  it('every cache the controller names is state, and so is everything unhashed that feeds the ledger', () => {
    const cls = new Map(RUNTIME_SNAPSHOT_SCHEMA.map((r) => [r.name, r.cls]));
    for (const n of [
      'seenVehicle', 'seenBlocked', 'seenElevation', 'zoneRoutes', 'zoneRouteKey', 'rearX', 'rearY', 'rearOk', 'rearAnchor', 'rearVersion',
      'terrainVersion', 'convoyRouteCache', 'convoyRouteKey', 'corridorFields', 'corridorsDirty', 'zoneFrom', 'zoneFromVersion', 'ventXY', 'ventsKnown',
      'convoySpanStore', 'worksList', 'worksOfferList', 'enemyLast', 'kills', 'contributed', 'identifiedBy', 'routeFoundBy', 'entityRoster', 'rosterPool',
      'woundedIn', 'rescuedBack', 'woundParentOf', 'zoneDeductedAt', 'roeGainJudged', 'aimedAtWounded', 'firedTriggers', 'spawnedWaves',
      'patrols', 'groups', 'tags', 'playerIds', 'enemyIds', 'objectives', 'lines', 'civFlight', 'pendingIntelEvents', 'externallyCompleted',
    ]) {
      expect(cls.get(n), n).toBe('state');
    }
    // The derived row is the flow field and nothing else: the entry's key and stamp are state.
    expect(RUNTIME_ROW_SETS.CorridorField.map((r) => [r.name, r.cls])).toEqual([['field', 'derived'], ['stamp', 'state']]);
  });

  it('no state row is a display number, and a typed array of unpromised length on a state row is a route cache', () => {
    const offenders: string[] = [];
    const walk = (path: string, k: RuntimeKind, row: string): void => {
      if (k.t === 'number') offenders.push(`${path}: a display number on a state row`);
      if (k.t === 'typed' && k.len === 'any' && !['zoneRoutes', 'convoyRouteCache'].includes(row)) offenders.push(`${path}: a state typed array with no length rule`);
      if (k.t === 'array' || k.t === 'set') walk(`${path}[]`, k.of, row);
      if (k.t === 'map') {
        walk(`${path}.key`, k.key, row);
        walk(`${path}.value`, k.value, row);
      }
    };
    const stateRows = (name: 'MissionRuntime' | RowSetName): void => {
      for (const r of runtimeRowsOf('state', tableOf(name))) walk(`${name}.${r.name}`, r.kind, r.name);
    };
    stateRows('MissionRuntime');
    for (const n of Object.keys(RUNTIME_ROW_SETS) as RowSetName[]) stateRows(n);
    expect(offenders).toEqual([]);
  });

  it('every row set is reachable from the runtime through record kinds, and every record names a real set', () => {
    const reached = new Set<string>();
    const visit = (k: RuntimeKind): void => {
      if (k.t === 'record') {
        expect(RUNTIME_ROW_SETS[k.rows], `row set ${k.rows}`).toBeDefined();
        if (reached.has(k.rows)) return;
        reached.add(k.rows);
        for (const r of RUNTIME_ROW_SETS[k.rows]) visit(r.kind);
      } else if (k.t === 'array' || k.t === 'set') visit(k.of);
      else if (k.t === 'map') {
        visit(k.key);
        visit(k.value);
      }
    };
    for (const r of RUNTIME_SNAPSHOT_SCHEMA) visit(r.kind);
    expect([...reached].sort()).toEqual((Object.keys(RUNTIME_ROW_SETS) as RowSetName[]).sort());
  });

  it('the reference rows are the ones the design lists (adding an alias is a deliberate edit to both)', () => {
    const refs: string[] = [];
    const collect = (name: string, k: RuntimeKind, row: string): void => {
      if (k.t === 'ref') refs.push(`${name}.${row} -> ${k.to}`);
      else if (k.t === 'array' || k.t === 'set') collect(name, k.of, row);
      else if (k.t === 'map') {
        collect(name, k.key, row);
        collect(name, k.value, row);
      }
    };
    for (const r of RUNTIME_SNAPSHOT_SCHEMA) collect('MissionRuntime', r.kind, r.name);
    for (const n of Object.keys(RUNTIME_ROW_SETS) as RowSetName[]) for (const r of RUNTIME_ROW_SETS[n]) collect(n, r.kind, r.name);
    expect(refs.sort()).toEqual(
      [
        'MissionRuntime.sim -> sim',
        'MissionRuntime.mission -> mission',
        'MissionRuntime.ctx -> ctx',
        'ObjectiveState.def -> mission.objective',
        'ZoneIncomeState.route -> zoneRoutes',
        'ZoneIncomeState.cutSpan -> spanStore',
        'ConvoyRoute.route -> convoyRouteCache',
        'ConvoyRoute.cutSpan -> convoySpanStore',
        'HoldView.entityCount -> view',
        'HoldView.alive -> sim.column',
        'HoldView.side -> sim.column',
        'HoldView.posX -> sim.column',
        'HoldView.posY -> sim.column',
        'HoldView.tunnelIn -> sim.column',
        'HoldView.isAir -> view',
        'HoldView.isDown -> view',
        'HoldView.tunnelCount -> view',
        'HoldView.tnAlive -> sim.column',
        'HoldView.tnVentOpen -> sim.column',
        'HoldView.tnDigger -> sim.column',
        'HoldView.ventAt -> view',
        'RouteSource.vehicleMask -> sim.column',
        'RouteSource.roadMask -> ctx.roadMask',
        'RouteSource.fieldFor -> view',
        'WorksEntry.offer -> worksOfferList',
      ].sort()
    );
  });

  it('runtimeRowsOf returns a class in schema order, and the four classes cover the table', () => {
    for (const c of ['state', 'config', 'derived', 'scratch'] as const) {
      expect(runtimeRowsOf(c)).toEqual(RUNTIME_SNAPSHOT_SCHEMA.filter((r) => r.cls === c));
    }
    const sum = (['state', 'config', 'derived', 'scratch'] as const).reduce((n, c) => n + runtimeRowsOf(c).length, 0);
    expect(sum).toBe(RUNTIME_SNAPSHOT_SCHEMA.length);
  });
});

describe('runtime snapshot schema: the check can fail', () => {
  const fresh = () => economySetup(ECONOMY_SEED);
  const env = (w: { rt: MissionRuntime; sim: Sim }): Env => ({ rt: w.rt, sim: w.sim, seen: new Set() });

  it('a throwaway property and a missing one are both named', () => {
    const w = fresh();
    const seen = new Set<string>();
    expect(checkRuntime('rt', w.rt, w.sim, seen)).toEqual([]);
    props(w.rt).zzThrowaway = 1;
    expect(checkRuntime('rt', w.rt, w.sim, seen)).toEqual(['rt: property "zzThrowaway" has no row']);
    delete props(w.rt).zzThrowaway;
    delete props(w.rt).intelValue;
    const complaints = checkRuntime('rt', w.rt, w.sim, seen);
    expect(complaints).toContain('rt: row "intelValue" names no property');
  });

  it('a property of an OWNED object with no row is named, with its path', () => {
    const w = fresh();
    props(props(w.rt).civFlight).zzThrowaway = 1;
    (props(w.rt).incomeZoneList as Props[])[1].zzThrowaway = 1;
    (props(w.rt).lines as Props[][])[0][0].zzThrowaway = 1;
    const complaints = checkRuntime('rt', w.rt, w.sim, new Set());
    expect(complaints).toContain('rt.civFlight: property "zzThrowaway" has no row');
    expect(complaints).toContain('rt.incomeZoneList[1]: property "zzThrowaway" has no row');
    expect(complaints).toContain('rt.lines[0][0]: property "zzThrowaway" has no row');
  });

  it('a wrong kind is named: a scalar that is a string, an array that is a Map, a length that is off', () => {
    const w = fresh();
    props(w.rt).roeScoreValue = 'a hundred';
    props(w.rt).objectives = new Map();
    props(w.rt).purse = new Int32Array(3);
    const complaints = checkRuntime('rt', w.rt, w.sim, new Set());
    expect(complaints).toContain('rt.roeScoreValue: expected an integer, found string a hundred');
    expect(complaints).toContain('rt.objectives: expected an array, found Map[0]');
    expect(complaints).toContain('rt.purse: length 3, rule says 2');
  });

  it('a reference that points at a COPY is named', () => {
    const w = fresh();
    const lines = props(w.rt).lines as Props[][];
    expect(lines[0].length).toBeGreaterThan(0);
    const zone = (props(w.rt).incomeZoneList as Props[])[0];
    zone.cutSpan = [1, 2];
    const objective = (props(w.rt).objectives as Props[])[0];
    objective.def = { ...(objective.def as object) };
    const complaints = checkRuntime('rt', w.rt, w.sim, new Set());
    expect(complaints).toContain('rt.incomeZoneList[0].cutSpan: expected a reference to spanStore, found Array[2]');
    expect(complaints).toContain('rt.objectives[0].def: expected a reference to mission.objective, found Object');
  });

  it('a table with a renamed row, or a row of the wrong kind, is named by the same reflection', () => {
    const w = fresh();
    const rows = (mutate: (r: RuntimeRow) => RuntimeRow): RuntimeRow[] => RUNTIME_SNAPSHOT_SCHEMA.map(mutate);
    const renamed = rows((r) => (r.name === 'purse' ? { ...r, name: 'purseOfSide' } : r));
    const complaints = checkRows('rt', w.rt, renamed, env(w), 'MissionRuntime');
    expect(complaints).toContain('rt: property "purse" has no row');
    expect(complaints).toContain('rt: row "purseOfSide" names no property');
    const reKinded = rows((r) => (r.name === 'purse' ? { ...r, kind: { t: 'scalar' } } : r.name === 'groups' ? { ...r, kind: { t: 'set', of: { t: 'scalar' } } } : r));
    const kinds = checkRows('rt', w.rt, reKinded, env(w), 'MissionRuntime');
    expect(kinds).toContain('rt.purse: expected an integer, found Int32Array[2]');
    expect(kinds).toContain('rt.groups: expected a Set, found Map[3]');
  });

  it('a row re-classed is caught by the independent class lists, not by the reflection', () => {
    // Completeness is blind to a class (the value is the same either way), so the second gate is the
    // class lists above: moving `purse` to scratch must fail them.
    const moved = RUNTIME_SNAPSHOT_SCHEMA.map((r): RuntimeRow => (r.name === 'purse' ? { ...r, cls: 'scratch' } : r));
    const found = classMismatches('MissionRuntime', moved);
    expect(found.map((f) => f.split(':')[0]).sort()).toEqual(['MissionRuntime scratch', 'MissionRuntime state']);
    expect(found.every((f) => f.includes('purse'))).toBe(true);
    expect(classMismatches('MissionRuntime', RUNTIME_SNAPSHOT_SCHEMA)).toEqual([]);
  });
});

describe('runtime snapshot schema: the census', () => {
  it('names every row whose populated form no sim-package world shows; the list may only shrink', () => {
    const seen = new Set<string>();
    walkEconomy(ECONOMY_TICKS_CHECKED, (c) => void checkRuntime(c.label, c.rt, c.sim, seen));
    walkRelief(RELIEF_TICKS_CHECKED, (c) => void checkRuntime(c.label, c.rt, c.sim, seen));
    walkSink((c) => void checkRuntime(c.label, c.rt, c.sim, seen));
    const unexercised = ALL_KEYS.filter((k) => !seen.has(k)).sort();
    // A row that appears here has only ever been checked against an empty container or a null: its
    // kind is the schema's claim from reading `mission.ts`, not something a live value confirmed.
    expect(unexercised).toEqual([...UNEXERCISED_IN_SIM_WORLDS].sort());
  }, 60_000);
});

// --- the aliasing census (Task 2) ---------------------------------------------------------------------
// A runtime is a graph, not a tree: several objects are held by two or more paths. A codec that walks the
// tree and writes each path's value turns one object into two on restore, and the first in-place write
// (a route recomputed into its slot) then reaches only one of them. So every object the runtime graph
// reaches twice must be explained by a reference rule in the schema (`RUNTIME_REF_RULES`), and every rule
// must explain something. The walk covers every row of every class and counts the Sim, the mission and
// the context as paths too, so an alias between a runtime path and a Sim column (the S1 `holdView`
// lesson) is found, and passes only as a `config` rule.

/** The worlds' census, one moment at a time. The closure probe runs once per world, at its first moment. */
function censusOfSimWorlds(): ReturnType<typeof newCensus> {
  const acc = newCensus();
  const first = new Set<string>();
  const at = (c: Checkpoint): void => {
    const world = c.label.split('@')[0];
    censusAt(c.label, c.rt, c.sim, acc, !first.has(world));
    first.add(world);
  };
  walkEconomy(ECONOMY_TICKS_CHECKED, at);
  walkRelief(RELIEF_TICKS_CHECKED, at);
  walkSink(at);
  return acc;
}

describe('runtime snapshot schema: the aliasing census', () => {
  it('every object the runtime graph reaches twice has a rule, and every rule explains one (economy, relief and sink worlds)', () => {
    const acc = censusOfSimWorlds();
    expect(acc.failures).toEqual([]);
    expect(unusedRules(acc.used)).toEqual([]);
    // Every rule used (RUNTIME_REF_RULES has 24, the closure one proved by the probe).
    expect(acc.used.size).toBe(RUNTIME_REF_RULES.length);
  }, 60_000);

  it('the rules are well formed: real paths, owners of the right kind, each ref row ruled, no duplicates', () => {
    const paths = schemaPaths();
    const bad: string[] = [];
    const seenKeys = new Set<string>();
    for (const r of RUNTIME_REF_RULES) {
      const k = ruleKey(r);
      if (seenKeys.has(k)) bad.push(`${k}: listed twice`);
      seenKeys.add(k);
      if (!paths.has(r.path)) bad.push(`${k}: path names nothing in the schema`);
      if (r.note.trim() === '') bad.push(`${k}: no note`);
      if (r.owner === 'config') {
        if (r.key !== 'config') bad.push(`${k}: a config owner needs key "config"`);
        if (r.into === undefined) bad.push(`${k}: a config rule says which side it is on (into)`);
        continue;
      }
      if (r.key === 'config') bad.push(`${k}: key "config" needs the owner "config"`);
      if (r.into !== undefined) bad.push(`${k}: only a config rule has "into"`);
      const owner = paths.get(r.owner);
      if (owner === undefined) {
        bad.push(`${k}: owner names nothing in the schema`);
        continue;
      }
      if (owner.cls === 'config') bad.push(`${k}: a state alias is owned by a config row; make it a config rule`);
      if (r.key === 'index' && owner.kind.t !== 'array') bad.push(`${k}: key "index" needs an array owner, found ${owner.kind.t}`);
      if (r.key === 'closure' && owner.kind.t !== 'map') bad.push(`${k}: the closure rule captures a container`);
      if ((r.key === 'closure') !== (r.identity === 'in-place')) bad.push(`${k}: a captured container is restored in place, and only a captured one`);
    }
    // Every ref row that names an OBJECT (not a getter or closure) has its rule; a rule on anything else is one of
    // the documented non-ref aliases.
    const refRows: string[] = [];
    const collect = (path: string, k: RuntimeKind): void => {
      if (k.t === 'ref' && k.to !== 'view') refRows.push(path);
      else if (k.t === 'array' || k.t === 'set') collect(path, k.of);
      else if (k.t === 'map') collect(path, k.value);
    };
    for (const r of RUNTIME_SNAPSHOT_SCHEMA) collect(`MissionRuntime.${r.name}`, r.kind);
    for (const n of Object.keys(RUNTIME_ROW_SETS) as RowSetName[]) for (const r of RUNTIME_ROW_SETS[n]) collect(`${n}.${r.name}`, r.kind);
    const ruled = new Set(RUNTIME_REF_RULES.map((r) => r.path));
    for (const p of refRows) if (!ruled.has(p)) bad.push(`${p}: a ref row with no rule`);
    const NOT_REF_ROWS = ['MissionRuntime.rosterPool[]', 'MissionRuntime.entityRoster.get()', 'MissionRuntime.zoneRects[]', 'ZoneIncomeState.rect', 'RouteSource.fieldFor'];
    for (const p of ruled) if (!refRows.includes(p) && !NOT_REF_ROWS.includes(p)) bad.push(`${p}: a rule on a path that is neither a ref row nor a documented alias`);
    expect(bad).toEqual([]);
  });

  it('exactly one rule asks for a container to be restored in place, and the constructor captures exactly that container', () => {
    expect(RUNTIME_REF_RULES.filter((r) => r.identity === 'in-place').map(ruleKey)).toEqual(['RouteSource.fieldFor -> MissionRuntime.corridorFields']);
    // Every `const x = this.<property>` in the constructor is a container a closure may keep. The one a
    // closure DOES keep is `fields`; if a second appears, it needs a rule (or a reason it does not).
    const src = readFileSync(new URL('./mission.ts', import.meta.url), 'utf8');
    const start = src.indexOf('  constructor(sim: Sim, mission: MissionJson, ctx: MissionContext) {');
    const end = src.indexOf('  /** Spendable logistics, floored for display. */');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    const captures = [...body.matchAll(/const (\w+) = this\.(\w+);/g)].map((m) => `${m[1]} = this.${m[2]}`);
    expect(captures).toEqual(['fields = this.corridorFields']);
  });
});

describe('runtime snapshot schema: the aliasing census can fail', () => {
  /** Every alias every sim-package world shows, once per distinct shape. */
  const corpus = (() => {
    const out: ReturnType<typeof collectAliases> = [];
    const seen = new Set<string>();
    const at = (c: Checkpoint): void => {
      for (const a of collectAliases(c.rt, c.sim)) {
        const shape = a.reaches.map((r) => `${r.path}:${r.cls}`).sort().join(' == ');
        if (!seen.has(shape)) {
          seen.add(shape);
          out.push(a);
        }
      }
    };
    walkEconomy([1, 800, 1600], at);
    walkRelief([1, 1705], at);
    walkSink(at);
    return out;
  })();

  it('with a rule deleted, the census names the alias that rule explained (every rule but the closure one is load-bearing)', () => {
    expect(explainAliases(corpus).unruled).toEqual([]);
    const silent: string[] = [];
    for (const rule of RUNTIME_REF_RULES) {
      if (rule.key === 'closure') continue;
      const named = explainAliases(corpus, RUNTIME_REF_RULES.filter((r) => r !== rule)).unruled;
      // The complaint names the alias by every path that reaches it, the deleted rule's own path included.
      if (!named.some((n) => n.includes(`(${rule.path})`))) silent.push(ruleKey(rule));
    }
    expect(silent, 'rules whose deletion the census does not notice').toEqual([]);
    // One of them, written out: delete the rule for `ZoneIncomeState.route`.
    const route = RUNTIME_REF_RULES.filter((r) => r.path !== 'ZoneIncomeState.route');
    const named = explainAliases(corpus, route).unruled;
    expect(named.length).toBeGreaterThan(0);
    expect(named[0]).toContain('(ZoneIncomeState.route)');
    expect(named[0]).toContain('(MissionRuntime.zoneRoutes[])');
  });

  it('a rule that explains nothing is named, however plausible it looks', () => {
    const acc = censusOfSimWorlds();
    expect(unusedRules(acc.used)).toEqual([]);
    const bogus: RefRule = { path: 'MissionRuntime.groups', owner: 'MissionRuntime.tags', key: 'self', note: 'a made-up alias' };
    expect(unusedRules(acc.used, [...RUNTIME_REF_RULES, bogus])).toEqual(['unused rule: MissionRuntime.groups -> MissionRuntime.tags']);
    // And the closure rule is only ever proved by the probe: take the probe's word away and it is unused too.
    const withoutProbe = new Set([...acc.used].filter((k) => k !== 'RouteSource.fieldFor -> MissionRuntime.corridorFields'));
    expect(unusedRules(withoutProbe)).toEqual(['unused rule: RouteSource.fieldFor -> MissionRuntime.corridorFields']);
  }, 60_000);

  it('an alias between a state row and a Sim column is named, and a config view of one is not', () => {
    const w = economySetup(ECONOMY_SEED);
    expect(explainAliases(collectAliases(w.rt, w.sim)).unruled).toEqual([]);
    // `seenVehicle` is a state cache of the runtime's own; making it the Sim's own mask is the holdView mistake.
    props(w.rt).seenVehicle = w.sim.blocked;
    const named = explainAliases(collectAliases(w.rt, w.sim)).unruled;
    expect(named.some((n) => n.includes('MissionRuntime.seenVehicle'))).toBe(true);
  });

  it('two state rows sharing one array is named', () => {
    const w = economySetup(ECONOMY_SEED);
    props(w.rt).seenBlocked = props(w.rt).seenVehicle;
    const named = explainAliases(collectAliases(w.rt, w.sim)).unruled;
    expect(named).toHaveLength(1);
    expect(named[0]).toContain('MissionRuntime.seenBlocked');
    expect(named[0]).toContain('MissionRuntime.seenVehicle');
  });

  it('a state element that is a config object is named until a config rule says so', () => {
    // enemyMenu is config and a line's queue is state: a queue item that IS a menu item would be the alias.
    const { rt, sim } = sinkWorld();
    const menu = props(rt).enemyMenu as Props[];
    expect(menu.length).toBeGreaterThan(0);
    const line = (props(rt).lines as Props[][])[1][0];
    (line.queue as Props[]).push(menu[0]);
    const named = explainAliases(collectAliases(rt, sim)).unruled;
    expect(named).toHaveLength(1);
    expect(named[0]).toContain('MissionRuntime.enemyMenu[]');
    expect(named[0]).toContain('ProductionLine.queue[]');
  });

  it('the closure probe fails when corridorFields is replaced by a fresh Map, and leaves a healthy runtime as it found it', () => {
    const w = economySetup(ECONOMY_SEED);
    for (let t = 0; t < 30; t++) {
      economyDrive(w, t);
      economyAdvance(w, t);
    }
    const fields = props(w.rt).corridorFields as Map<number, unknown>;
    const keys = [...fields.keys()];
    expect(probeClosures(w.rt, w.sim)).toEqual({ used: ['RouteSource.fieldFor -> MissionRuntime.corridorFields'], complaints: [] });
    expect(props(w.rt).corridorFields, 'same Map').toBe(fields);
    expect([...fields.keys()], 'same entries, same order').toEqual(keys);
    props(w.rt).corridorFields = new Map(fields);
    const broken = probeClosures(w.rt, w.sim);
    expect(broken.used).toEqual([]);
    expect(broken.complaints).toHaveLength(1);
    expect(broken.complaints[0]).toContain('the closure holds a different Map');
  });
});

describe('runtime snapshot schema: the kind checks added in Task 2 can fail', () => {
  it('json: a float, an undefined, a Map, a class instance and a function inside a roster entry are all named, at any depth', () => {
    expect(jsonComplaints('x', { type: 'a', veterancy: 1, name: 'n', nested: [{ ok: true, none: null }] })).toEqual([]);
    expect(jsonComplaints('x', { v: 1.5 })).toEqual(['x.v: JSON carries only safe integers, found number 1.5']);
    expect(jsonComplaints('x', { v: Number.NaN })).toHaveLength(1);
    expect(jsonComplaints('x', { v: 2 ** 60 })).toHaveLength(1);
    expect(jsonComplaints('x', { a: [{ b: undefined }] })).toEqual(['x.a[0].b: JSON cannot carry undefined']);
    expect(jsonComplaints('x', { m: new Map() })).toEqual(['x.m: JSON carries plain objects, found Map[0]']);
    expect(jsonComplaints('x', { f: () => 1 })).toEqual(['x.f: JSON cannot carry function']);
    expect(jsonComplaints('x', { t: new Int32Array(1) })).toHaveLength(1);
  });

  it('json rows on a live runtime: the roster map and pool, and the aux tail, refuse a bad value', () => {
    const w = economySetup(ECONOMY_SEED);
    props(w.rt).entityRoster = new Map([[1, { type: 'a', veterancy: 1.5 }]]);
    props(w.rt).rosterPool = [{ type: 'a', name: undefined }];
    props(w.rt).pendingIntelEvents = [{ kind: 'intelEarned', value: 0.5 }];
    const c = checkRuntime('rt', w.rt, w.sim, new Set());
    expect(c).toContain('rt.entityRoster.get(1).veterancy: JSON carries only safe integers, found number 1.5');
    expect(c).toContain('rt.rosterPool[0].name: JSON cannot carry undefined');
    expect(c).toContain('rt.pendingIntelEvents[0].value: JSON carries only safe integers, found number 0.5');
  });

  it('scalar: a 1 where a boolean belongs, and a true where an integer belongs, are both named', () => {
    const w = economySetup(ECONOMY_SEED);
    expect(checkRuntime('rt', w.rt, w.sim, new Set())).toEqual([]);
    props(w.rt).roeFailed = 1;
    props(w.rt).ended = 0;
    props(w.rt).roeScoreValue = true;
    (props(w.rt).firedTriggers as unknown[]).push(1);
    const objective = (props(w.rt).objectives as Props[])[0];
    objective.holdTicks = false;
    const c = checkRuntime('rt', w.rt, w.sim, new Set());
    expect(c).toContain('rt.roeFailed: expected a boolean, found number 1');
    expect(c).toContain('rt.ended: expected a boolean, found number 0');
    expect(c).toContain('rt.roeScoreValue: expected an integer, found boolean true');
    expect(c).toContain('rt.firedTriggers[0]: expected a boolean, found number 1');
    expect(c).toContain('rt.objectives[0].holdTicks: expected an integer, found boolean false');
  });

  it('every boolean the runtime holds is a bool row: the booleans of the schema are exactly the ones the types declare', () => {
    const bools: string[] = [];
    const walk = (path: string, k: RuntimeKind): void => {
      if (k.t === 'scalar' && k.bool === true) bools.push(path);
      else if (k.t === 'array' || k.t === 'set') walk(path, k.of);
      else if (k.t === 'map') walk(path, k.value);
    };
    for (const r of RUNTIME_SNAPSHOT_SCHEMA) walk(`MissionRuntime.${r.name}`, r.kind);
    for (const n of Object.keys(RUNTIME_ROW_SETS) as RowSetName[]) for (const r of RUNTIME_ROW_SETS[n]) walk(`${n}.${r.name}`, r.kind);
    expect(bools.sort()).toEqual(
      [
        'CivilianFlight.shepherds',
        'MissionRuntime.corridorsDirty',
        'MissionRuntime.ended',
        'MissionRuntime.firedTriggers',
        'MissionRuntime.firstContact',
        'MissionRuntime.refusedByPopulation',
        'MissionRuntime.roeFailed',
        'MissionRuntime.spawnedWaves',
        'MissionRuntime.withdrawnValue',
        'WorksStructure.done',
      ].sort()
    );
  });

  it('sim.column: every column ref names its column, and a view over the WRONG column or a copy of the right one is named', () => {
    const named: string[] = [];
    for (const n of Object.keys(RUNTIME_ROW_SETS) as RowSetName[]) {
      for (const r of RUNTIME_ROW_SETS[n]) if (r.kind.t === 'ref' && r.kind.to === 'sim.column') named.push(`${n}.${r.name}=${r.kind.column ?? '?'}`);
    }
    expect(named.sort()).toEqual(
      [
        'HoldView.alive=state.alive',
        'HoldView.posX=state.posX',
        'HoldView.posY=state.posY',
        'HoldView.side=state.side',
        'HoldView.tnAlive=tnAlive',
        'HoldView.tnDigger=tnDigger',
        'HoldView.tnVentOpen=tnVentOpen',
        'HoldView.tunnelIn=state.tunnelIn',
        'RouteSource.vehicleMask=blockedVehicle',
      ].sort()
    );
    const w = economySetup(ECONOMY_SEED);
    expect(checkRuntime('rt', w.rt, w.sim, new Set())).toEqual([]);
    const view = props(w.rt).holdView as Props;
    view.alive = w.sim.state.side;
    view.posX = w.sim.state.posX.slice();
    const c = checkRuntime('rt', w.rt, w.sim, new Set());
    expect(c).toContain('rt.holdView.alive: expected a reference to sim.column state.alive, found Uint8Array[32]');
    expect(c).toContain('rt.holdView.posX: expected a reference to sim.column state.posX, found Int32Array[32]');
  });
});

// Task 4's witness needs real FIGHTS for every row it claims to cover. These rows are populated by the
// synthetic SINK world alone (no economy or relief replay fills them): a row on this list has been
// checked against a real value, but no real match has ever produced one. Pinned, so a replay that starts
// filling one turns the spec red and the list shrinks, rather than going stale.
const ROWS_ONLY_THE_SINK_WORLD_FILLS: readonly string[] = [
  'CivilianFlight.evacuatedSet', 'CivilianFlight.fledSet', 'MissionRuntime.aimedAtWounded', 'MissionRuntime.civIds',
  'MissionRuntime.collapseTargets', 'MissionRuntime.enemyLast', 'MissionRuntime.enemyMenu', 'MissionRuntime.entityRoster',
  'MissionRuntime.externallyCompleted', 'MissionRuntime.firedTriggers', 'MissionRuntime.marked', 'MissionRuntime.markedThisMission',
  'MissionRuntime.onLoan', 'MissionRuntime.patrols', 'MissionRuntime.pendingIntelEvents', 'MissionRuntime.razeExempt',
  'MissionRuntime.razeTargets', 'MissionRuntime.rescuedBack', 'MissionRuntime.roeGainJudged', 'MissionRuntime.rosterPool',
  'MissionRuntime.routeFoundBy', 'MissionRuntime.spawnedWaves', 'MissionRuntime.tags', 'MissionRuntime.ventXY',
  'MissionRuntime.worksList', 'MissionRuntime.worksOfferList', 'MissionRuntime.worksPending', 'MissionRuntime.worksSites',
  'MissionRuntime.worksStructures', 'MissionRuntime.woundParentOf', 'MissionRuntime.woundedIn', 'MissionRuntime.zoneDeductedAt',
  'PatrolState.id', 'PatrolState.idx', 'PatrolState.waypoints', 'ProductionLine.queue', 'RouteSource.roadMask',
  'WorksCharge.intel', 'WorksCharge.logistics', 'WorksCharge.structType', 'WorksCharge.typeId', 'WorksCharge.x', 'WorksCharge.y',
  'WorksEntry.offer', 'WorksEntry.structType', 'WorksOffer.intel', 'WorksOffer.left', 'WorksOffer.logistics', 'WorksOffer.max',
  'WorksOffer.name', 'WorksOffer.typeId', 'WorksStructure.done', 'WorksStructure.site', 'WorksStructure.typeId',
  'ZoneIncomeState.cut', 'ZoneIncomeState.cutSpan',
];

describe('runtime snapshot schema: which rows only the sink world fills', () => {
  it('the replays alone leave exactly the pinned rows unfilled', () => {
    const seen = new Set<string>();
    walkEconomy(ECONOMY_TICKS_CHECKED, (c) => void checkRuntime(c.label, c.rt, c.sim, seen));
    walkRelief(RELIEF_TICKS_CHECKED, (c) => void checkRuntime(c.label, c.rt, c.sim, seen));
    expect(ALL_KEYS.filter((k) => !seen.has(k)).sort()).toEqual([...ROWS_ONLY_THE_SINK_WORLD_FILLS].sort());
  }, 60_000);
});
