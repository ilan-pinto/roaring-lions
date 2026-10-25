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
  RUNTIME_ROW_SETS,
  RUNTIME_SNAPSHOT_SCHEMA,
  runtimeRowsOf,
  type RowSetName,
  type RuntimeKind,
  type RuntimeRow,
} from './runtime-snapshot-schema';
import { checkRows, checkRuntime, props, type Env, type Props } from './runtime-snapshot-schema.test-helper';
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
    expect(complaints).toContain('rt.roeScoreValue: expected an integer or boolean, found string a hundred');
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
    expect(kinds).toContain('rt.purse: expected an integer or boolean, found Int32Array[2]');
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
