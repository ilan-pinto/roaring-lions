// GH-976 (WP2): the set-up phase in the sim. A clock with an early bell, Ready, the region clamp at every position write
// that can cross the line, weapons tight, and the refused command kinds. Every oracle is a literal with its arithmetic
// beside it; the regions are built here by integer maths (the sim package imports nothing, so not `@lions/data`'s helper).
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { FM_DRONE, RIFLES, SAPPER, SETUP_ANCHORS, SETUP_BAND_TILES, setupRegionOf, TANK } from './golden-worlds.test-helper';
import { internals } from './snapshot';
import { Sim, SETUP_REFUSED_KINDS, type Command, type SimEvent, type UnitTypeJson } from './sim';
import { AIR_AIRBORNE, AIR_LANDED, SETUP_BELL_DELAY_TICKS } from './tuning';

const W = 32;
const UNTIL = 200;
const pos = (n: number): number => fx.from(n);

/** The helper's diagonal region (seats (6,6) / (25,25), band 4): region 0 is every tile with x + y <= 27 (derived beside it). */
const diag = (): Int8Array => setupRegionOf(W, SETUP_ANCHORS[0], SETUP_ANCHORS[1], SETUP_BAND_TILES);
/** A vertical split: x <= lastOwn is side 0's, the next `band` columns are the band, the rest side 1's. */
function vert(lastOwn: number, band: number): Int8Array {
  const r = new Int8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) r[y * W + x] = x <= lastOwn ? 0 : x <= lastOwn + band ? -1 : 1;
  return r;
}
/** The mirror of `vert`: x >= firstOwn is side 0's, the band is to its left. */
function vertMirror(firstOwn: number, band: number): Int8Array {
  const r = new Int8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) r[y * W + x] = x >= firstOwn ? 0 : x >= firstOwn - band ? -1 : 1;
  return r;
}

const HELO: UnitTypeJson = {
  id: 'su_helo',
  role: 'apc',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
  weapons: [],
};
const JEEP: UnitTypeJson = {
  id: 'su_jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 4 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};
const KAMI: UnitTypeJson = {
  id: 'su_kami',
  role: 'drone',
  hull: { hp: 90, armor: { front: 0, side: 0, rear: 0 }, suppression_resistance: 1 },
  mobility: { speed_tiles_s: 3.0, turn_rate_deg_s: 240 },
  sensors: { optics: 1.4, sight_tiles: 14, signature: 0.3 },
  abilities: ['kamikaze'],
  weapons: [{ id: 'warhead', type: 'heat', range_tiles: 1.2, effective_range_tiles: 1.2, accuracy: 0.9, penetration: 500, damage: 600, splash_tiles: 1.2, suppression: 70, rof_per_min: 60 }],
};
const SMOKER: UnitTypeJson = { ...RIFLES, id: 'su_smoker', abilities: ['garrison', 'smoke'] };
const CHARGER: UnitTypeJson = { ...RIFLES, id: 'su_charger', abilities: ['garrison', 'tunnel_charge'], weapons: [] };
/** A 2 x 1 hull on tracks for the separation test. */
const SEP_TANK: UnitTypeJson = {
  id: 'su_sep_tank',
  role: 'mbt',
  hull: { hp: 3000, armor: { front: 300, side: 200, rear: 100 } },
  mobility: { speed_tiles_s: 3, turn_rate_deg_s: 90, footprint: { half_length_tiles: 1.0, half_width_tiles: 0.5 } },
  sensors: { optics: 1, sight_tiles: 2, signature: 1 },
};
const HOUSE = { id: 'su_house', name: 'House', hp_per_tile: 400, garrison_slots: 4, rubble_cover: 1 };
const WALL = { id: 'su_wall', name: 'Wall', hp_per_tile: 300, garrison_slots: 0, rubble_cover: 1 };
const BUILDABLE = { id: 'su_works', name: 'Works', hp_per_tile: 200, garrison_slots: 0, rubble_cover: 1, buildable: { cost: { logistics: 1 }, build_time_s: 1, footprint: [1, 1] } };

interface World {
  readonly sim: Sim;
  readonly t: { rifles: number; tank: number; helo: number; jeep: number; sapper: number; kami: number; smoker: number; charger: number; sepTank: number; drone: number };
}

function build(region: Int8Array | null, until = UNTIL, humanHeld: readonly [boolean, boolean] = [true, true]): World {
  const sim = new Sim({ seed: 976, width: W, height: W, capacity: 64, humanHeld });
  if (region !== null) sim.beginSetup({ untilTick: until, region });
  const t = {
    rifles: sim.addUnitType(RIFLES),
    tank: sim.addUnitType(TANK),
    helo: sim.addUnitType(HELO),
    jeep: sim.addUnitType(JEEP),
    sapper: sim.addUnitType({ ...SAPPER, demolition_time_s: 1.0 }),
    kami: sim.addUnitType(KAMI),
    smoker: sim.addUnitType(SMOKER),
    charger: sim.addUnitType(CHARGER),
    sepTank: sim.addUnitType(SEP_TANK),
    drone: sim.addUnitType(FM_DRONE),
  };
  return { sim, t };
}

function run(sim: Sim, n: number, sink: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < n; i++) sink.push(...sim.tick());
  return sink;
}
const tileOf = (sim: Sim, id: number): [number, number] => [sim.state.posX[id] >> 16, sim.state.posY[id] >> 16];
const regionOf = (sim: Sim, id: number): number => sim.setupRegionAt(...tileOf(sim, id));
const FIGHT_KINDS = new Set(['fire', 'impact', 'beam', 'component', 'structureHit', 'structureDestroyed', 'destroyed', 'aps', 'nearMiss', 'submunition', 'chargeDetonated']);

describe('beginSetup', () => {
  it('throws after one tick, on a second call, on a region of the wrong length, and on a clock that is not positive', () => {
    const late = build(null).sim;
    late.tick();
    expect(() => late.beginSetup({ untilTick: UNTIL, region: diag() })).toThrow(/before the first tick/);
    const twice = build(diag()).sim;
    expect(() => twice.beginSetup({ untilTick: UNTIL, region: diag() })).toThrow(/twice/);
    expect(() => build(null).sim.beginSetup({ untilTick: UNTIL, region: new Int8Array(W * W - 1) })).toThrow(/cells/);
    expect(() => build(null).sim.beginSetup({ untilTick: 0, region: diag() })).toThrow(/untilTick/);
    expect(() => build(null).sim.beginSetup({ untilTick: -5, region: diag() })).toThrow(/untilTick/);
    const bad = diag();
    bad[0] = 2;
    expect(() => build(null).sim.beginSetup({ untilTick: UNTIL, region: bad })).toThrow(/region cell/);
  });

  it('copies the region: a later write to the caller\'s array moves nothing', () => {
    const r = diag();
    const { sim } = build(r);
    const before = sim.hash();
    r[0] = 1;
    expect(sim.hash()).toBe(before);
    expect(sim.setupRegionAt(0, 0)).toBe(0);
  });
});

describe('a world with no set-up', () => {
  it('reads region -2 and bell -1, is never active, and hashes as it did before the set-up code existed', () => {
    const sim = new Sim({ seed: 976, width: W, height: W, capacity: 64, humanHeld: [true, true] });
    const rifles = sim.addUnitType(RIFLES);
    const tank = sim.addUnitType(TANK);
    expect(sim.setupRegionAt(3, 3)).toBe(-2);
    expect(sim.setupBellTick).toBe(-1);
    expect(sim.setupActive).toBe(false);
    expect(sim.setupReady(0)).toBe(false);
    // The oracle: a 50-tick run of three squads and a tank, read on origin/main 720db3e47 BEFORE this change (no set-up code).
    for (let k = 0; k < 3; k++) sim.spawn(rifles, 0, pos(5.5 + k), pos(5.5));
    sim.spawn(tank, 1, pos(12.5), pos(5.5));
    sim.queueCommand({ kind: 'attackMove', ids: [0, 1, 2], x: pos(12.5), y: pos(5.5) });
    run(sim, 50);
    expect(sim.hash()).toBe(NO_SETUP_HASH);
  });
});
const NO_SETUP_HASH = 560867298;

describe('the region is hashed (R0.21)', () => {
  it('two worlds identical except for one region cell differ at tick 0', () => {
    const a = diag();
    const b = diag();
    b[20 * W + 20] = b[20 * W + 20] === 1 ? 0 : 1;
    expect(build(a).sim.hash()).not.toBe(build(b).sim.hash());
    expect(build(diag()).sim.hash()).toBe(build(diag()).sim.hash());
  });

  it('and so do two clocks, and Ready', () => {
    expect(build(diag(), 200).sim.hash()).not.toBe(build(diag(), 201).sim.hash());
    const a = build(diag()).sim;
    const b = build(diag()).sim;
    a.queueCommand({ kind: 'setupReady', side: 0 });
    a.tick();
    b.tick();
    expect(a.hash()).not.toBe(b.hash());
  });
});

describe('the region clamp: the wall-clip slide', () => {
  it('holds a squad ordered across the line on region 0, order standing, until the bell; then it crosses', () => {
    const { sim, t } = build(diag());
    const sq = sim.spawn(t.rifles, 0, pos(11.5), pos(11.5));
    sim.queueCommand({ kind: 'move', ids: [sq], x: pos(28.5), y: pos(28.5) });
    let heldAt150 = false;
    for (let k = 0; k < UNTIL; k++) {
      sim.tick();
      expect(regionOf(sim, sq), `tick ${sim.tickCount}`).toBe(0);
      if (k === 150) {
        expect(sim.state.moving[sq]).toBe(1);
        heldAt150 = sim.setupHeldAtLine(sq);
      }
    }
    // 11.5 -> the last region-0 diagonal tile x + y = 27 is 3.5 tiles along the diagonal... it was walking, so it has arrived.
    expect(sim.state.moving[sq]).toBe(1);
    expect(tileOf(sim, sq)[0] + tileOf(sim, sq)[1]).toBeGreaterThanOrEqual(26);
    expect(heldAt150).toBe(true);
    expect(sim.setupHeldAtLine(sq)).toBe(false); // the bell has rung (tickCount 200 is not < 200)
    run(sim, 300);
    expect(regionOf(sim, sq)).not.toBe(0);
  });

  it('slides along the line: a unit ordered off-axis keeps walking down the last own column (the slide, not a stop)', () => {
    const { sim, t } = build(vert(11, 4));
    const sq = sim.spawn(t.rifles, 0, pos(11.5), pos(6.5));
    sim.queueCommand({ kind: 'move', ids: [sq], x: pos(28.5), y: pos(26.5) });
    run(sim, 150);
    // The goal lies at (17, 20) tiles from the start, so the y share of a 0.045-tile step is 20/26.2 = 0.76 and 150 ticks
    // walk 150 x 0.045 x 0.76 = 5.1 tiles south (read: 4.77, the first ticks turn it). The x step is refused every tick and
    // the y step is kept, so it is still on x = 11. A stop would leave it at 6.5.
    expect(regionOf(sim, sq)).toBe(0);
    expect(tileOf(sim, sq)[0]).toBe(11);
    expect(sim.state.posY[sq]).toBeGreaterThan(pos(6.5 + 4));
    expect(sim.state.moving[sq]).toBe(1);
  });

  it('holds an aircraft too (the clip sits outside the !isAir guard)', () => {
    const { sim, t } = build(diag());
    const d = sim.spawn(t.drone, 0, pos(11.5), pos(11.5));
    sim.queueCommand({ kind: 'move', ids: [d], x: pos(28.5), y: pos(28.5) });
    for (let k = 0; k < UNTIL; k++) {
      sim.tick();
      expect(regionOf(sim, d), `tick ${sim.tickCount}`).toBe(0);
    }
    expect(sim.state.moving[d]).toBe(1);
    run(sim, 200);
    expect(regionOf(sim, d)).not.toBe(0);
  });

  it('a unit above side 1 (a civilian) walks across the band before the bell: no clamp', () => {
    const { sim, t } = build(vert(11, 4));
    const civ = sim.spawn(t.rifles, 2, pos(11.5), pos(20.5));
    sim.queueCommand({ kind: 'move', ids: [civ], x: pos(24.5), y: pos(20.5) });
    let crossed = false;
    for (let k = 0; k < 190; k++) {
      sim.tick();
      if (regionOf(sim, civ) !== 0) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(sim.state.posX[civ]).toBeGreaterThan(pos(17));
  });

  it('a unit that is clamped stands on region 0 on the mirrored layout too (the other side of the line)', () => {
    const { sim, t } = build(vertMirror(20, 4));
    const sq = sim.spawn(t.rifles, 0, pos(21.5), pos(20.5));
    sim.queueCommand({ kind: 'move', ids: [sq], x: pos(2.5), y: pos(20.5) });
    for (let k = 0; k < UNTIL; k++) {
      sim.tick();
      expect(regionOf(sim, sq), `tick ${sim.tickCount}`).toBe(0);
    }
    expect(sim.state.moving[sq]).toBe(1);
  });
});

describe('the region clamp: the post-separation revert (head-on at the line)', () => {
  for (const [name, region, x0] of [
    ['own region on the left', vert(11, 4), 11.9],
    ['own region on the right', vertMirror(20, 4), 20.1],
  ] as const) {
    it(`two tanks of one side meet head-on on the last own-region column (${name}): neither stands outside region 0`, () => {
      const { sim, t } = build(region);
      const a = sim.spawn(t.sepTank, 0, pos(x0), pos(8.5));
      const b = sim.spawn(t.sepTank, 0, pos(x0), pos(14.5));
      sim.queueCommand({ kind: 'move', ids: [a], x: pos(x0), y: pos(22.5) });
      sim.queueCommand({ kind: 'move', ids: [b], x: pos(x0), y: pos(0.5) });
      let steered = false;
      for (let k = 0; k < UNTIL; k++) {
        sim.tick();
        expect(regionOf(sim, a), `a at tick ${sim.tickCount}`).toBe(0);
        expect(regionOf(sim, b), `b at tick ${sim.tickCount}`).toBe(0);
        if (sim.state.sepWait[a] > 0 || sim.state.sepWait[b] > 0) steered = true;
      }
      // Non-vacuous: the two hulls really met and the separation block really ran (its valve counts a blocked tick).
      expect(steered).toBe(true);
    });
  }
});

describe('weapons tight', () => {
  /** Two forces in sight across the band from tick 0: three squads and a tank a side, attack-moving on each other. */
  function fightWorld(): { sim: Sim; units: number[] } {
    const { sim, t } = build(vert(11, 4));
    const units: number[] = [];
    for (let k = 0; k < 3; k++) units.push(sim.spawn(t.rifles, 0, pos(11.5), pos(18.5 + k)));
    units.push(sim.spawn(t.tank, 0, pos(10.5), pos(20.5)));
    for (let k = 0; k < 3; k++) units.push(sim.spawn(t.rifles, 1, pos(16.5), pos(18.5 + k)));
    units.push(sim.spawn(t.tank, 1, pos(17.5), pos(20.5)));
    sim.queueCommand({ kind: 'attackMove', ids: units.slice(0, 4), x: pos(24.5), y: pos(20.5) });
    sim.queueCommand({ kind: 'attackMove', ids: units.slice(4), x: pos(2.5), y: pos(20.5) });
    return { sim, units };
  }

  it('no fire, impact, beam or damage event and no hp change until the bell; a fire event by 260', () => {
    const { sim, units } = fightWorld();
    const hp0 = units.map((u) => sim.state.hp[u]);
    const events: SimEvent[] = [];
    for (let k = 0; k < UNTIL; k++) {
      run(sim, 1, events);
      if (k === UNTIL - 2) {
        // the tick whose count is 199: still tight
        expect(events.filter((e) => FIGHT_KINDS.has(e.kind))).toEqual([]);
      }
    }
    const before = events.filter((e) => e.tick < UNTIL && FIGHT_KINDS.has(e.kind));
    expect(before).toEqual([]);
    expect(units.map((u) => sim.state.hp[u])).toEqual(hp0);
    // Detection ran: the two forces know each other (set-up holds fire, not eyes).
    expect(sim.contactLevel(0, units[4])).toBeGreaterThanOrEqual(2);
    run(sim, 60, events);
    expect(events.some((e) => e.kind === 'fire' && e.tick >= UNTIL && e.tick <= 260)).toBe(true);
  });
});

describe('weapons tight: the dozer and the kamikaze', () => {
  it('a dozer parked against a neutral structure through set-up does not damage it', () => {
    const { sim, t } = build(vert(11, 4));
    const st = sim.addStructureType(WALL);
    const tile = 20 * W + 12; // in the band, beside the dozer
    sim.addStructure(st, [tile]);
    sim.spawn(t.sapper, 0, pos(11.5), pos(20.5));
    const hp0 = sim.structures.hp[0];
    run(sim, UNTIL - 1);
    expect(sim.structures.alive[0]).toBe(1);
    expect(sim.structures.hp[0]).toBe(hp0);
    expect((internals(sim).demoTicks as Int32Array)[0]).toBe(0);
    // Non-vacuous: after the bell it lays its charge and the wall comes down.
    run(sim, 400);
    expect(sim.structures.hp[0]).toBeLessThan(hp0);
  });

  it('a kamikaze with an identified target makes no dive before the bell', () => {
    // No band: the munition at the line, an enemy tank one tile past it, identified. The dive would be a tick away.
    const { sim, t } = build(vert(11, 0));
    const bird = sim.spawn(t.kami, 0, pos(11.5), pos(20.5));
    const victim = sim.spawn(t.tank, 1, pos(12.5), pos(20.5));
    const hp0 = sim.state.hp[victim];
    sim.identifyTo(0, victim);
    const events = run(sim, UNTIL - 1);
    expect(sim.state.alive[bird]).toBe(1);
    expect(sim.state.hp[victim]).toBe(hp0);
    expect(events.filter((e) => e.kind === 'fire' || e.kind === 'destroyed')).toEqual([]);
    run(sim, 20);
    expect(sim.state.alive[bird]).toBe(0); // and after the bell it is spent
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('the refused command kinds (R0.5)', () => {
  interface Rig {
    readonly sim: Sim;
    readonly events: SimEvent[];
    readonly ids: { sq: number; smk: number; sap: number; chg: number; far: number; tu: number; buried: number; foe: number; hidden: number; bld: number };
    readonly wall: number;
    readonly route: number;
    readonly works: number;
  }
  /** Own units at x <= 11, the foe at 16.5 in view, one hidden enemy far away, a neutral wall, a route owned by side 0. */
  function rig(setup: boolean): Rig {
    const { sim, t } = build(setup ? vert(11, 4) : null);
    const wallType = sim.addStructureType(WALL);
    const works = sim.addStructureType(BUILDABLE);
    const wall = sim.addStructure(wallType, [24 * W + 8]);
    const route = sim.addTunnel({ id: 'su_route', points: [[2, 5], [8, 5]], dig_tiles_per_s: 1, pre_dug: true, side: 0 });
    const ids = {
      sq: sim.spawn(t.rifles, 0, pos(10.5), pos(20.5)),
      smk: sim.spawn(t.smoker, 0, pos(10.5), pos(21.5)),
      sap: sim.spawn(t.sapper, 0, pos(10.5), pos(23.5)),
      chg: sim.spawn(t.charger, 0, pos(6.5), pos(8.5)),
      far: sim.spawn(t.rifles, 0, pos(5.5), pos(15.5)),
      tu: sim.spawn(t.rifles, 0, pos(2.5), pos(6.5)),
      buried: sim.spawn(t.rifles, 0, pos(7.5), pos(5.5)),
      foe: sim.spawn(t.rifles, 1, pos(16.5), pos(20.5)),
      hidden: sim.spawn(t.rifles, 1, pos(28.5), pos(4.5)),
      bld: sim.spawn(t.rifles, 0, pos(4.5), pos(26.5)),
    };
    // The buried unit sits at the vent, eta 0: a `vent` order would bring it up.
    (internals(sim).putInTunnel as (i: number, r: number) => void).call(sim, ids.buried, route);
    sim.state.tunnelEta[ids.buried] = 0;
    sim.identifyTo(0, ids.foe);
    return { sim, events: [], ids, wall, route, works };
  }

  interface Row {
    /** The command, built against the rig. */
    readonly cmd: (r: Rig) => Command;
    /** Whether its effect is present. Always false in set-up; must be true with no set-up (the oracle can fail). */
    readonly effect: (r: Rig) => boolean;
    /** Pre-arrangement of the rig (a site row, say). */
    readonly prep?: (r: Rig) => void;
    /** The sim has no branch that acts on this kind (`support` is a runtime kind), so there is no effect to read. */
    readonly noEffect?: boolean;
  }
  const ROWS: Record<string, Row> = {
    smoke: { cmd: (r) => ({ kind: 'smoke', ids: [r.ids.smk], x: pos(10.5), y: pos(21.5) }), effect: (r) => r.sim.smokeAt(10, 21) > 0 },
    demolish: {
      cmd: (r) => ({ kind: 'demolish', ids: [r.ids.sap], structure: r.wall }),
      effect: (r) => (internals(r.sim).demolishOrder as Int32Array)[r.ids.sap] === r.wall,
    },
    chargeTunnel: {
      cmd: (r) => ({ kind: 'chargeTunnel', ids: [r.ids.chg], tunnel: r.route }),
      effect: (r) => (internals(r.sim).chargeOrder as Int32Array)[r.ids.chg] === r.route,
    },
    attack: { cmd: (r) => ({ kind: 'attack', ids: [r.ids.sq], target: r.ids.foe }), effect: (r) => r.sim.state.focusTarget[r.ids.sq] === r.ids.foe },
    enterTunnel: {
      cmd: (r) => ({ kind: 'enterTunnel', ids: [r.ids.tu], tunnel: r.route }),
      effect: (r) => (internals(r.sim).tunnelGoal as Int32Array)[r.ids.tu] !== -1 || r.sim.state.tunnelIn[r.ids.tu] >= 0,
    },
    vent: { cmd: (r) => ({ kind: 'vent', ids: [r.ids.buried], mode: 'exit' }), effect: (r) => r.sim.state.tunnelIn[r.ids.buried] === -1 },
    reveal: {
      cmd: () => ({ kind: 'reveal', side: 0, x: pos(28.5), y: pos(4.5) }),
      effect: (r) => r.sim.contactLevel(0, r.ids.hidden) >= 2,
    },
    callStrike: {
      cmd: (r) => ({ kind: 'callStrike', caller: r.ids.sq, x: pos(24.5), y: pos(20.5) }),
      effect: (r) => (internals(r.sim).pendingStrikes as unknown[]).length > 0 || r.events.some((e) => e.kind === 'strike'),
    },
    support: { cmd: () => ({ kind: 'support', side: 0, support: 'drone_sweep', x: pos(10.5), y: pos(10.5) }), effect: () => false, noEffect: true },
    construct: {
      cmd: (r) => ({ kind: 'construct', ids: [r.ids.sq], structType: r.works, x: 9, y: 9 }),
      effect: (r) => r.events.some((e) => e.kind === 'constructQueued' || e.kind === 'constructRefused'),
    },
    cancelConstruct: {
      prep: (r) => {
        const it = internals(r.sim);
        (it.siteAlive as Uint8Array)[0] = 1;
        (it.siteStructure as Int32Array)[0] = -1;
      },
      cmd: () => ({ kind: 'cancelConstruct', site: 0 }),
      effect: (r) => (internals(r.sim).siteAlive as Uint8Array)[0] === 0,
    },
  };

  it('has one row per exported entry, and no row for a kind the sim does not refuse', () => {
    expect(Object.keys(ROWS).sort()).toEqual([...SETUP_REFUSED_KINDS].sort());
    expect(SETUP_REFUSED_KINDS.size).toBe(11);
  });

  for (const kind of Object.keys(ROWS)) {
    it(`${kind}: its effect is absent at tick 10 in a set-up, and present with no set-up`, () => {
      const row = ROWS[kind];
      const live = rig(true);
      row.prep?.(live);
      const control = rig(false);
      row.prep?.(control);
      if (kind === 'support') {
        // `queueCommand` sets a runtime kind aside, so the only way into the sim's queue is the queue itself.
        (internals(live.sim).commandQueue as Command[]).push(row.cmd(live));
      } else {
        live.sim.queueCommand(row.cmd(live));
        control.sim.queueCommand(row.cmd(control));
      }
      run(live.sim, 10, live.events);
      run(control.sim, 10, control.events);
      expect(live.sim.setupActive).toBe(true);
      expect(row.effect(live), `${kind} must have no effect in set-up`).toBe(false);
      if (row.noEffect !== true) expect(row.effect(control), `${kind} must act when there is no set-up (else this row proves nothing)`).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('Ready and the early bell', () => {
  /** Drive: before tick t, queue each (t, side) pair. Returns the events and the tick each setupBell came on. */
  function play(readies: readonly (readonly [number, 0 | 1])[], ticks: number, until = UNTIL): { events: SimEvent[]; sim: Sim } {
    const { sim } = build(diag(), until);
    const events: SimEvent[] = [];
    for (let t = 0; t < ticks; t++) {
      for (const [at, side] of readies) if (at === t) sim.queueCommand({ kind: 'setupReady', side });
      run(sim, 1, events);
    }
    return { events, sim };
  }
  const bells = (e: SimEvent[]): number[] => e.filter((x) => x.kind === 'setupBell').map((x) => x.tick);
  const readies = (e: SimEvent[]): string[] => e.flatMap((x) => (x.kind === 'setupReady' ? [`${x.tick}:${x.side}`] : []));

  it('side 0 ready at 20 and side 1 at 40: the bell on tick 140, setupBellTick 140, active until then', () => {
    // 40 + SETUP_BELL_DELAY_TICKS (100) = 140. The command queued before tick 40 is applied by the tick whose count is 40.
    expect(SETUP_BELL_DELAY_TICKS).toBe(100);
    const { events, sim } = play([[20, 0], [40, 1]], 300);
    expect(readies(events)).toEqual(['20:0', '40:1']);
    expect(bells(events)).toEqual([140]);
    expect(sim.setupBellTick).toBe(140);
    expect(sim.setupReady(0)).toBe(true);
    expect(sim.setupReady(1)).toBe(true);
    const probe = play([[20, 0], [40, 1]], 139).sim;
    expect(probe.setupActive).toBe(true); // tickCount 139 < 140
    expect(play([[20, 0], [40, 1]], 140).sim.setupActive).toBe(false);
  });

  it('side 0 alone: nothing changes, the bell on tick 200', () => {
    const { events, sim } = play([[20, 0]], 300);
    expect(readies(events)).toEqual(['20:0']);
    expect(bells(events)).toEqual([200]);
    expect(sim.setupBellTick).toBe(200);
    expect(sim.setupReady(1)).toBe(false);
  });

  it('a double Ready is idempotent: one event a side, the same bell', () => {
    const { events, sim } = play([[20, 0], [30, 0], [40, 1], [60, 1]], 300);
    expect(readies(events)).toEqual(['20:0', '40:1']);
    expect(bells(events)).toEqual([140]);
    expect(sim.setupBellTick).toBe(140);
  });

  it('both ready at 195: the bell at 200, not 295', () => {
    const { events, sim } = play([[195, 0], [195, 1]], 320);
    expect(bells(events)).toEqual([200]);
    expect(sim.setupBellTick).toBe(200);
  });

  it('a Ready after the bell is refused silently, and so are a bad side and a world with no set-up', () => {
    const { sim } = build(diag());
    const events: SimEvent[] = [];
    run(sim, 205, events);
    sim.queueCommand({ kind: 'setupReady', side: 0 });
    sim.queueCommand({ kind: 'setupReady', side: 2 });
    sim.queueCommand({ kind: 'setupReady', side: -1 });
    run(sim, 5, events);
    expect(events.filter((e) => e.kind === 'setupReady')).toEqual([]);
    const none = build(null).sim;
    none.queueCommand({ kind: 'setupReady', side: 0 });
    expect(run(none, 3).filter((e) => e.kind === 'setupReady')).toEqual([]);
    const early = build(diag()).sim;
    early.queueCommand({ kind: 'setupReady', side: 2 });
    expect(run(early, 3).filter((e) => e.kind === 'setupReady')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('unload at the line (Review Focus 1)', () => {
  it('a ground carrier on the last own-region column: every passenger lands in region 0, or stays aboard', () => {
    const { sim, t } = build(vert(11, 4));
    const jeep = sim.spawn(t.jeep, 0, pos(11.5), pos(20.5));
    const riders = [0, 1, 2].map(() => sim.spawn(t.rifles, 0, pos(11.5), pos(20.5)));
    for (const r of riders) expect(sim.embarkAtSpawn(jeep, r)).toBe(true);
    sim.queueCommand({ kind: 'unload', ids: [jeep] });
    run(sim, 10);
    for (const r of riders) {
      const aboard = sim.state.carriedBy[r] === jeep;
      expect(aboard || regionOf(sim, r) === 0, `rider ${r} at ${tileOf(sim, r).join(',')}`).toBe(true);
    }
    // Not vacuous: they did get out (the hull's own spot is own-region), and the +HALF spot would have been the band.
    expect(riders.every((r) => sim.state.carriedBy[r] === -1)).toBe(true);
    expect(vert(11, 4)[(Math.floor(20.5 + 0.5)) * W + Math.floor(11.5 + 0.5)]).toBe(-1);
  });

  it('refuses the unload (they stay aboard) when even the hull\'s own tile is outside the region', () => {
    const { sim, t } = build(vert(11, 4));
    const jeep = sim.spawn(t.jeep, 0, pos(12.5), pos(20.5)); // in the band: the clamp never put it there, a spawn did
    const rider = sim.spawn(t.rifles, 0, pos(12.5), pos(20.5));
    expect(sim.embarkAtSpawn(jeep, rider)).toBe(true);
    sim.queueCommand({ kind: 'unload', ids: [jeep] });
    run(sim, 10);
    expect(sim.state.carriedBy[rider]).toBe(jeep);
  });

  it('an air carrier landed on the last own-region column: the spread keeps to region 0', () => {
    const { sim, t } = build(vert(11, 4));
    const helo = sim.spawn(t.helo, 0, pos(11.5), pos(20.5));
    const riders = [0, 1, 2, 3, 4, 5].map(() => sim.spawn(t.rifles, 0, pos(11.5), pos(20.5)));
    for (const r of riders) expect(sim.embarkAtSpawn(helo, r)).toBe(true);
    sim.queueCommand({ kind: 'unload', ids: [helo] });
    run(sim, 150);
    expect(sim.state.airState[helo]).toBe(AIR_LANDED);
    for (const r of riders) {
      expect(sim.state.carriedBy[r], `rider ${r}`).toBe(-1);
      expect(regionOf(sim, r), `rider ${r} at ${tileOf(sim, r).join(',')}`).toBe(0);
    }
  });
});

describe('air LZ past the line (R0.4: the landing snap)', () => {
  it('an LZ the footprint search puts in the band is never set down on: no landing, no unload, nobody past the line', () => {
    const { sim, t } = build(vert(11, 4));
    // Block the own side of the hull's footprint so the nearest clear LZ footprint is the band tile (12,19).
    for (const y of [19, 20, 21]) sim.setBlocked(10, y, true);
    const helo = sim.spawn(t.helo, 0, pos(11.5), pos(20.5));
    const riders = [0, 1].map(() => sim.spawn(t.rifles, 0, pos(11.5), pos(20.5)));
    for (const r of riders) sim.embarkAtSpawn(helo, r);
    sim.queueCommand({ kind: 'unload', ids: [helo] });
    const events: SimEvent[] = [];
    for (let k = 0; k < UNTIL - 1; k++) {
      run(sim, 1, events);
      expect(sim.state.airState[helo], `tick ${sim.tickCount}`).toBe(AIR_AIRBORNE);
      expect(regionOf(sim, helo)).toBe(0);
    }
    expect(riders.every((r) => sim.state.carriedBy[r] === helo)).toBe(true);
    expect(events.filter((e) => e.kind === 'transport' && !e.loaded)).toEqual([]);
    // The LZ really is in the band (else this proves nothing): after the bell it flies there and lands.
    run(sim, 200, events);
    expect(sim.state.airState[helo]).toBe(AIR_LANDED);
    expect(tileOf(sim, helo)).toEqual([12, 19]);
  });

  it('a carrier already ON a band tile (a spawn put it there) stops short of the snap and holds its hover', () => {
    const { sim, t } = build(vert(11, 4));
    const helo = sim.spawn(t.helo, 0, pos(12.5), pos(20.5));
    const rider = sim.spawn(t.rifles, 0, pos(12.5), pos(20.5));
    sim.embarkAtSpawn(helo, rider);
    sim.queueCommand({ kind: 'unload', ids: [helo] });
    for (let k = 0; k < UNTIL - 1; k++) {
      run(sim, 1);
      expect(sim.state.airState[helo], `tick ${sim.tickCount}`).toBe(AIR_AIRBORNE);
    }
    expect(sim.state.carriedBy[rider]).toBe(helo);
  });
});

describe('garrison past the line (Review Focus 2)', () => {
  it('refuses a building whose centroid tile is in the band (its exit tile, (11,19), is own-region: only the centroid refuses it)', () => {
    const { sim, t } = build(vert(11, 4));
    const house = sim.addStructureType(HOUSE);
    const s = sim.addStructure(house, [20 * W + 12]);
    const sq = sim.spawn(t.rifles, 0, pos(10.5), pos(20.5));
    sim.queueCommand({ kind: 'garrison', ids: [sq], structure: s });
    run(sim, 10);
    expect(sim.state.garrisonGoal[sq]).toBe(-1);
    expect(sim.state.moving[sq]).toBe(0);
  });

  it('refuses a building whose centroid is own-region but whose exit tile is in the band', () => {
    const { sim, t } = build(vert(11, 4));
    const house = sim.addStructureType(HOUSE);
    const s = sim.addStructure(house, [20 * W + 11]);
    // The exit scan is row-major from the NW corner: shut (10,19) (11,19) (12,19) and (10,20), and the first open tile is (12,20).
    for (const [x, y] of [[10, 19], [11, 19], [12, 19], [10, 20]] as const) sim.setBlocked(x, y, true);
    const sq = sim.spawn(t.rifles, 0, pos(9.5), pos(22.5));
    sim.queueCommand({ kind: 'garrison', ids: [sq], structure: s });
    run(sim, 10);
    expect(sim.state.garrisonGoal[sq]).toBe(-1);
    expect(sim.state.moving[sq]).toBe(0);
  });

  it('accepts a building wholly inside the region (the refusal is not blanket), and a plain order after the bell', () => {
    const { sim, t } = build(vert(11, 4));
    const house = sim.addStructureType(HOUSE);
    const own = sim.addStructure(house, [20 * W + 6]);
    const band = sim.addStructure(house, [24 * W + 13]);
    const sq = sim.spawn(t.rifles, 0, pos(9.5), pos(20.5));
    const sq2 = sim.spawn(t.rifles, 0, pos(9.5), pos(24.5));
    sim.queueCommand({ kind: 'garrison', ids: [sq], structure: own });
    sim.queueCommand({ kind: 'garrison', ids: [sq2], structure: band });
    run(sim, 10);
    expect(sim.state.garrisonGoal[sq]).toBe(own);
    expect(sim.state.garrisonGoal[sq2]).toBe(-1);
    run(sim, 200);
    sim.queueCommand({ kind: 'garrison', ids: [sq2], structure: band });
    run(sim, 2);
    expect(sim.state.garrisonGoal[sq2]).toBe(band);
  });
});
