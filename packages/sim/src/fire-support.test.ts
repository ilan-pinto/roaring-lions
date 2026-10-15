import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { MissionRuntime, type MissionEvent, type MissionJson } from './mission';
import { Rng } from './rng';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import {
  type FireSupportProfile, FIRE_SUPPORT, FOCUS_LOST_TICKS, FS_AIR_STRIKE, FS_MORTAR_BARRAGE, FS_SMOKE_SCREEN, SMOKE_BLOCKS_AT, SMOKE_MAX, SMOKE_RADIUS,
} from './tuning';

// Fire support, Task 6 of F1 (GH-183): `callStrike.profile` indexes FIRE_SUPPORT
// and a barrage is N queued rounds. Plan: docs/superpowers/plans/2026-10-04-gf1-fire-support-intel.md
//
// Every expected number below is a LITERAL, never read back from FIRE_SUPPORT:
// the air-strike ones were measured on the commit before this task (c2b6dc99),
// where the strike was a single hard-coded round, so they are `main`'s own.

const ARMOUR = { front: 10, side: 10, rear: 10 };
/** Unarmed, so it never draws from its own rng stream except to call fire. */
const CALLER: UnitTypeJson = {
  id: 'fs_caller', role: 'infantry',
  hull: { hp: 400, armor: ARMOUR },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 4, signature: 0.5 },
};
/** Hard to kill, never shoots: the thing a round lands on. */
const TARGET: UnitTypeJson = { ...CALLER, id: 'fs_target', hull: { hp: 30000, armor: ARMOUR } };
const HOLDER: UnitTypeJson = { ...CALLER, id: 'fs_holder', abilities: ['garrison'], hull: { hp: 4000, armor: ARMOUR } };

const CAPACITY = 16;

function rect(sim: Sim, typeIdx: number, x: number, y: number, w: number, h: number): number {
  const tiles: number[] = [];
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) tiles.push(ty * sim.width + tx);
  return sim.addStructure(typeIdx, tiles);
}

type StrikeEvent = Extract<SimEvent, { kind: 'strike' }>;
const strikes = (events: SimEvent[]): StrikeEvent[] =>
  events.filter((e): e is StrikeEvent => e.kind === 'strike');

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

/** A caller on side 0 and two targets on side 1 at (24.5,16.5) and (25.0,16.5). */
function openWorld(seed: number) {
  const sim = new Sim({ seed, width: 48, height: 32, capacity: CAPACITY });
  const caller = sim.spawn(sim.addUnitType(CALLER), 0, fx.from(5.5), fx.from(5.5));
  const tt = sim.addUnitType(TARGET);
  const near = sim.spawn(tt, 1, fx.from(24.5), fx.from(16.5));
  const far = sim.spawn(tt, 1, fx.from(25.0), fx.from(16.5));
  return { sim, caller, near, far };
}
const AIM_X = fx.from(24.5);
const AIM_Y = fx.from(16.5);

describe('an air strike is unchanged', () => {
  // Measured on c2b6dc99 (the commit before FIRE_SUPPORT existed), seed 7: the
  // single round lands at these Q16.16 coordinates, 60 ticks after the call,
  // and takes this much of the two targets' 30000 hp (1966080000 in Q16.16).
  const LANDS = { tick: 60, x: 1602044, y: 1081948 };
  const NEAR_HP = 1927857600; // 583.2 hp lost
  const FAR_HP = 1937666400; // 433.5 hp lost, 0.5 tile further out
  const HASH = 2460528690;

  for (const [label, profile] of [
    ['absent', undefined],
    ['FS_AIR_STRIKE', FS_AIR_STRIKE],
  ] as const) {
    it(`profile ${label}: one round, main's landing point, damage and world hash`, () => {
      const w = openWorld(7);
      w.sim.queueCommand({ kind: 'callStrike', caller: w.caller, x: AIM_X, y: AIM_Y, profile });
      const hits = strikes(run(w.sim, 400));
      expect(hits).toEqual([{ kind: 'strike', tick: LANDS.tick, by: w.caller, x: LANDS.x, y: LANDS.y, profile: 0 }]);
      expect(w.sim.state.hp[w.near]).toBe(NEAR_HP);
      expect(w.sim.state.hp[w.far]).toBe(FAR_HP);
      expect(w.sim.hash()).toBe(HASH);
    });
  }

  it('draws 16 bits of scatter, so it never leaves 0.3 tile', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = openWorld(seed);
      w.sim.queueCommand({ kind: 'callStrike', caller: w.caller, x: AIM_X, y: AIM_Y });
      const [hit] = strikes(run(w.sim, 70));
      expect(hit).toBeDefined();
      const d = Math.hypot(hit.x - AIM_X, hit.y - AIM_Y) / 65536;
      expect(d).toBeLessThanOrEqual(0.3 + 0.001);
    }
  });
});

describe('a barrage', () => {
  const callBarrage = (w: ReturnType<typeof openWorld>) =>
    w.sim.queueCommand({ kind: 'callStrike', caller: w.caller, x: AIM_X, y: AIM_Y, profile: FS_MORTAR_BARRAGE });

  it('lands 6 rounds, 36 ticks apart, the first 120 ticks after the call', () => {
    const w = openWorld(7);
    callBarrage(w);
    const hits = strikes(run(w.sim, 400));
    expect(hits.map((e) => e.tick)).toEqual([120, 156, 192, 228, 264, 300]);
    expect(hits.every((e) => e.profile === 1 && e.by === w.caller)).toBe(true);
    // Each round has its own scatter pair: no two land on the same point.
    expect(new Set(hits.map((e) => `${e.x},${e.y}`)).size).toBe(6);
  });

  it('takes its scatter from the caller\'s stream: two draws a round, nobody else\'s moves', () => {
    // The caller is entity 2 here, not 0: a draw taken from `rng.nextU32(0)`
    // by mistake must not be able to pass for the caller's own stream.
    const sim = new Sim({ seed: 7, width: 48, height: 32, capacity: CAPACITY });
    const tt = sim.addUnitType(TARGET);
    const bystanders = [sim.spawn(tt, 1, fx.from(24.5), fx.from(16.5)), sim.spawn(tt, 1, fx.from(25), fx.from(16.5))];
    const caller = sim.spawn(sim.addUnitType(CALLER), 0, fx.from(5.5), fx.from(5.5));
    expect(caller).toBe(2);
    sim.queueCommand({ kind: 'callStrike', caller, x: AIM_X, y: AIM_Y, profile: FS_MORTAR_BARRAGE });
    run(sim, 400);
    const fresh = new Rng(7, CAPACITY);
    const expected = new Rng(7, CAPACITY);
    for (let i = 0; i < 12; i++) expected.nextU32(caller); // 6 rounds x 2
    expect(sim.rng.state[caller]).toBe(expected.state[caller]);
    expect(sim.rng.state[caller]).not.toBe(fresh.state[caller]);
    for (const b of bystanders) expect(sim.rng.state[b]).toBe(fresh.state[b]);
  });

  it('can land beyond a tile from the aim (a 16-bit draw tops out at exactly 1.0)', () => {
    // 1.5 tiles of scatter needs the full 32-bit draw: `>>> 16` caps at 65535.
    let farthest = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const w = openWorld(seed);
      callBarrage(w);
      for (const e of strikes(run(w.sim, 320))) {
        farthest = Math.max(farthest, Math.hypot(e.x - AIM_X, e.y - AIM_Y) / 65536);
      }
    }
    expect(farthest).toBeGreaterThan(1.0 + 0.1);
    expect(farthest).toBeLessThanOrEqual(1.5 + 0.001);
  });

  it('a dead caller\'s barrage still lands every round already queued, and a dead caller queues nothing new', () => {
    // Rounds are queued at call time, so the answer to "does the artillery stop
    // when the spotter dies" is: no. A decision, stated here so it is not an accident.
    const w = openWorld(7);
    callBarrage(w);
    w.sim.tick();
    w.sim.debugKill(w.caller);
    expect(strikes(run(w.sim, 400)).map((e) => e.tick)).toEqual([120, 156, 192, 228, 264, 300]);

    const before = w.sim.rng.state[w.caller];
    callBarrage(w);
    expect(strikes(run(w.sim, 400))).toEqual([]);
    expect(w.sim.rng.state[w.caller]).toBe(before);
  });

  it('damages less per round than an air strike, to a literal amount', () => {
    // Seed 7, first round only (tick 120): it lands at (1558297, 1089314), 0.73
    // tile from the target at (24.5,16.5), so 120 hp x (1 - 0.73/1.0) = 32.1 hp
    // = 2104000 Q16.16, and the engine's own rounding reads 2127000. An air
    // strike's single round takes 583.2 hp off the same man.
    const w = openWorld(7);
    callBarrage(w);
    run(w.sim, 121);
    expect(w.sim.state.hp[w.near]).toBe(1966080000 - 2127000);
  });
});

describe('a smoke-screen round', () => {
  it('spends 3 rounds from the caller\'s stream, emits no strike and does no damage', () => {
    // `ThreeRenderer.onStrike` draws an air-strike burst for every `strike`
    // event and overlay.ts logs "PRECISION STRIKE": a smoke round must emit none.
    const w = openWorld(7);
    const fresh = new Rng(7, CAPACITY);
    w.sim.queueCommand({ kind: 'callStrike', caller: w.caller, x: AIM_X, y: AIM_Y, profile: FS_SMOKE_SCREEN });
    const events = run(w.sim, 300);
    expect(strikes(events)).toEqual([]);
    expect(events.some((e) => e.kind === 'structureHit')).toBe(false);
    expect(w.sim.state.hp[w.near]).toBe(1966080000);
    expect(w.sim.state.hp[w.far]).toBe(1966080000);
    expect(w.sim.state.suppression[w.near]).toBe(0);
    // Three rounds, two draws each.
    const ref = new Rng(7, CAPACITY);
    for (let i = 0; i < 6; i++) ref.nextU32(w.caller);
    expect(w.sim.rng.state[w.caller]).toBe(ref.state[w.caller]);
    expect(w.sim.rng.state[w.caller]).not.toBe(fresh.state[w.caller]);
  });
});

describe('the strike profile is hashed', () => {
  it('two sims identical but for one pending entry\'s profile hash differently', () => {
    type Pending = { x: number; y: number; by: number; readyTick: number; profile: number };
    const make = (profile: number): number => {
      const w = openWorld(7);
      (w.sim as unknown as { pendingStrikes: Pending[] }).pendingStrikes.push({
        x: AIM_X, y: AIM_Y, by: w.caller, readyTick: 500, profile,
      });
      return w.sim.hash();
    };
    expect(make(0)).toBe(make(0));
    expect(make(0)).not.toBe(make(1));
  });
});

describe('a barrage on a garrisoned building (F-Q13)', () => {
  // A 2x2 house with one rifleman inside. The aim is the house's centroid. The
  // rounds are read at the tick the FIRST one lands, seed 4, where that round is
  // inside the 1.0-tile splash for the barrage as well as the strike.
  const HOUSE = { id: 'fs_house', name: 'House', hp_per_tile: 5000, garrison_slots: 2, rubble_cover: 2 };

  function garrisonUnderFire(profile: number, garrisonCover?: number) {
    const sim = new Sim({ seed: 4, width: 48, height: 32, capacity: CAPACITY });
    const type = sim.addStructureType(garrisonCover === undefined ? HOUSE : { ...HOUSE, garrison_cover: garrisonCover });
    const house = rect(sim, type, 20, 14, 2, 2);
    const caller = sim.spawn(sim.addUnitType(CALLER), 0, fx.from(5.5), fx.from(5.5));
    const holder = sim.spawn(sim.addUnitType(HOLDER), 1, fx.from(19.5), fx.from(14.5));
    sim.queueCommand({ kind: 'garrison', ids: [holder], structure: house });
    for (let i = 0; i < 400 && sim.state.garrisonedIn[holder] !== house; i++) sim.tick();
    expect(sim.state.garrisonedIn[holder]).toBe(house);
    const hp0 = sim.state.hp[holder];
    const house0 = sim.structures.hp[house];
    sim.queueCommand({ kind: 'callStrike', caller, x: fx.from(21), y: fx.from(15), profile });
    for (let i = 0; i < 400; i++) {
      if (strikes(sim.tick()).length > 0) {
        return {
          menLost: hp0 - sim.state.hp[holder],
          houseLost: house0 - sim.structures.hp[house],
          suppression: sim.state.suppression[holder],
        };
      }
    }
    throw new Error('no round landed');
  }

  it('the barrage hits the building, not the men, and garrison_cover muffles the suppression', () => {
    expect(garrisonUnderFire(FS_MORTAR_BARRAGE)).toEqual({ menLost: 0, houseLost: 15728640, suppression: 2429 });
    // The control arm: a building that gives no cover pins the same man 11x harder.
    expect(garrisonUnderFire(FS_MORTAR_BARRAGE, 0).suppression).toBe(27006);
  });

  it('the air strike on the same house suppresses at full value, whatever garrison_cover says', () => {
    expect(garrisonUnderFire(FS_AIR_STRIKE)).toEqual({ menLost: 0, houseLost: 78643200, suppression: 51426 });
    expect(garrisonUnderFire(FS_AIR_STRIKE, 0).suppression).toBe(51426);
  });
});

describe('a barrage and the mission\'s Conduct (ROE)', () => {
  const DEPOT = { id: 'fs_depot', name: 'Depot', hp_per_tile: 50, garrison_slots: 0, rubble_cover: 1, roe_penalty: 5 };
  const SHED = { id: 'fs_shed', name: 'Shed', hp_per_tile: 50, garrison_slots: 0, rubble_cover: 1, roe_penalty: 6 };

  /** A 2x2 depot (the `raze` target) with a 2x2 shed beside it, aim on the seam. */
  function world(withRaze: boolean) {
    const sim = new Sim({ seed: 7, width: 48, height: 32, capacity: CAPACITY });
    const ids = new Map<string, number>([['fs_caller', sim.addUnitType(CALLER)]]);
    const depot = rect(sim, sim.addStructureType(DEPOT), 20, 16, 2, 2);
    const shed = rect(sim, sim.addStructureType(SHED), 22, 16, 2, 2);
    const mission: MissionJson = {
      id: 'fs_roe',
      map: { file: 'none' },
      ledger: { requires: [], produces: [] },
      starting_force: [{ unit: 'fs_caller', count: 1, at: [3, 3] }],
      // The clock keeps the mission open after the depot falls, so the shed's
      // collapse is still judged by a running runtime.
      objectives: [
        ...(withRaze ? [{ id: 'level', type: 'raze' as const, primary: true, target: 'depot' }] : []),
        { id: 'clock', type: 'survive_until' as const, primary: true, seconds: 900 },
      ],
      roe: { enabled: true },
    };
    const runtime = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => {
        const t = ids.get(u);
        if (t === undefined) throw new Error(`unknown unit ${u}`);
        return t;
      },
      markers: {},
      zones: { depot: [20, 16, 2, 2] },
    });
    runtime.start();
    const roe: MissionEvent[] = [];
    const step = (ticks: number): void => {
      for (let i = 0; i < ticks; i++) {
        for (const e of runtime.step(sim.tick())) if (e.kind === 'roe') roe.push(e);
      }
    };
    return { sim, runtime, depot, shed, roe, step };
  }

  it('charges ROE through `by`: the shed costs Conduct when no raze objective names it', () => {
    const w = world(false);
    w.sim.queueCommand({ kind: 'callStrike', caller: 0, x: fx.from(22), y: fx.from(17), profile: FS_MORTAR_BARRAGE });
    w.step(320);
    expect(w.sim.structures.alive[w.depot]).toBe(0);
    expect(w.sim.structures.alive[w.shed]).toBe(0);
    expect(w.roe.length).toBe(2);
    expect(w.runtime.roeScore).toBe(100 - 5 - 6);
  });

  it('a round that levels a structure the raze objective names costs nothing; one that levels any other still does', () => {
    // #431: `razeExempt` is the union of the raze objectives' structure sets.
    const w = world(true);
    w.sim.queueCommand({ kind: 'callStrike', caller: 0, x: fx.from(22), y: fx.from(17), profile: FS_MORTAR_BARRAGE });
    w.step(320);
    expect(w.sim.structures.alive[w.depot]).toBe(0);
    expect(w.sim.structures.alive[w.shed]).toBe(0);
    expect(w.roe.length).toBe(1);
    expect(w.roe[0].kind === 'roe' && w.roe[0].reason).toContain('Fs_shed');
    expect(w.runtime.roeScore).toBe(100 - 6);
  });
});

describe('the table', () => {
  it('has the three profiles at the indices the constants name', () => {
    expect(FIRE_SUPPORT.length).toBe(3);
    expect([FS_AIR_STRIKE, FS_MORTAR_BARRAGE, FS_SMOKE_SCREEN]).toEqual([0, 1, 2]);
    expect(FIRE_SUPPORT.map((p) => p.payload)).toEqual(['he', 'he', 'smoke']);
    expect(FIRE_SUPPORT.map((p) => p.rounds)).toEqual([1, 6, 3]);
  });
});

// ---------------------------------------------------------------------------
// Task 7: the smoke-screen round lays the grid a carrier's `smoke` command lays.

type SmokeEvent = Extract<SimEvent, { kind: 'smokeLaid' }>;
const smokes = (events: SimEvent[]): SmokeEvent[] =>
  events.filter((e): e is SmokeEvent => e.kind === 'smokeLaid');

/** A carrier with the `smoke` ability: what a screen needs only when it is NOT a support round. */
const SAPPER: UnitTypeJson = { ...CALLER, id: 'fs_sapper', abilities: ['smoke'] };
const RIFLEMAN: UnitTypeJson = {
  ...CALLER,
  id: 'fs_rifleman',
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [
    { id: 'rifle', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.6, penetration: 8, damage: 1, suppression: 0, rof_per_min: 300 },
  ],
};

function snapshot(sim: Sim): number[] {
  const out: number[] = [];
  for (let y = 0; y < sim.height; y++) for (let x = 0; x < sim.width; x++) out.push(sim.smokeAt(x, y));
  return out;
}

/** A private sight-line method, called as the sim's own code does. */
function call(sim: Sim, name: string, ...args: number[]): number {
  const f: unknown = Reflect.get(sim, name);
  if (typeof f !== 'function') throw new Error(`no method ${name}`);
  const v: unknown = f.apply(sim, args);
  if (typeof v !== 'number') throw new Error(`${name} returned ${typeof v}`);
  return v;
}

describe('a smoke-screen round lays a screen', () => {
  const callScreen = (sim: Sim, caller: number, x = AIM_X, y = AIM_Y) =>
    sim.queueCommand({ kind: 'callStrike', caller, x, y, profile: FS_SMOKE_SCREEN });

  it('lays the same grid a laid screen does: whole grid, three rounds, tick for tick', () => {
    // World A: one caller with no ability, a screen called onto the aim.
    // World B: the same units plus three sappers, and each round's own
    // (tick, point) replayed as a `smoke` command from a sapper in range.
    // Both paths end in one method, so every tile of the grid must agree.
    const build = () => {
      const sim = new Sim({ seed: 7, width: 48, height: 32, capacity: CAPACITY });
      const caller = sim.spawn(sim.addUnitType(CALLER), 0, fx.from(5.5), fx.from(5.5));
      const st = sim.addUnitType(SAPPER);
      const sappers = [0, 1, 2].map((i) => sim.spawn(st, 0, fx.from(22 + i), fx.from(16.5)));
      return { sim, caller, sappers };
    };
    const a = build();
    callScreen(a.sim, a.caller);
    const laid = smokes(run(a.sim, 200));
    expect(laid.map((e) => e.tick)).toEqual([80, 120, 160]);
    expect(laid.every((e) => e.by === a.caller)).toBe(true);
    const gridA = snapshot(a.sim);

    const b = build();
    let next = 0;
    const out: SmokeEvent[] = [];
    for (let i = 0; i < 200; i++) {
      // A command queued before a tick is processed at its start, in the same
      // tick (the same `tickCount`) the round's own stamp lands in.
      while (next < laid.length && b.sim.tickCount === laid[next].tick) {
        b.sim.queueCommand({ kind: 'smoke', ids: [b.sappers[next]], x: laid[next].x, y: laid[next].y });
        next++;
      }
      out.push(...smokes(b.sim.tick()));
    }
    expect(next).toBe(3);
    expect(out.map((e) => [e.x, e.y])).toEqual(laid.map((e) => [e.x, e.y]));
    expect(snapshot(b.sim)).toEqual(gridA);
    // And it is a real grid: the last round's centre is at full density, 3 rounds are on the map.
    expect(Math.max(...gridA)).toBeGreaterThan(0);
  });

  it('stamps a SMOKE_RADIUS disc at SMOKE_MAX around the landing tile', () => {
    const w = openWorld(7);
    callScreen(w.sim, w.caller);
    const [first] = smokes(run(w.sim, 81));
    const cx = first.x >> 16;
    const cy = first.y >> 16;
    for (let y = 0; y < w.sim.height; y++) {
      for (let x = 0; x < w.sim.width; x++) {
        const inside = (x - cx) ** 2 + (y - cy) ** 2 <= SMOKE_RADIUS ** 2;
        // Landed this very tick: the stamp has not decayed yet, or by one step.
        if (inside) expect(w.sim.smokeAt(x, y)).toBeGreaterThanOrEqual(SMOKE_MAX - 1);
        else expect(w.sim.smokeAt(x, y)).toBe(0);
      }
    }
  });

  it('needs no carrier: the caller has no smoke ability and the command from it lays nothing', () => {
    const w = openWorld(7);
    w.sim.queueCommand({ kind: 'smoke', ids: [w.caller], x: AIM_X, y: AIM_Y });
    expect(smokes(run(w.sim, 5))).toEqual([]);
    callScreen(w.sim, w.caller);
    expect(smokes(run(w.sim, 200)).length).toBe(3);
  });

  it('emits smokeLaid, by the caller at the landing point, and no strike', () => {
    const w = openWorld(7);
    callScreen(w.sim, w.caller);
    const events = run(w.sim, 200);
    expect(strikes(events)).toEqual([]);
    const laid = smokes(events);
    expect(laid.length).toBe(3);
    for (const e of laid) {
      expect(e.by).toBe(w.caller);
      // Scattered from the aim by at most the profile's 1.5 tiles.
      expect(Math.hypot(e.x - AIM_X, e.y - AIM_Y) / 65536).toBeLessThanOrEqual(1.5 + 0.001);
    }
  });

  it('does no damage and no suppression, to anyone, however close', () => {
    // The shipped smoke row is all zeros, so a round that FELL THROUGH to the
    // HE path would read zeros and pass this test whether or not the
    // `payload === 'smoke'` branch exists. So the row is made hostile for the
    // duration: a big, heavy, suppressive "smoke" row. Only the branch keeps a
    // unit standing inside it unhurt. Restored in `finally`, so no other test
    // sees it.
    const table = FIRE_SUPPORT as FireSupportProfile[];
    const shipped = table[FS_SMOKE_SCREEN];
    table[FS_SMOKE_SCREEN] = { ...shipped, damage: 7864320, splash: 8 * 65536, suppression: 65536 };
    try {
      const w = openWorld(7);
      callScreen(w.sim, w.caller);
      const [first] = smokes(run(w.sim, 81));
      // Off-centre (a quarter tile from the first landing, inside every
      // round's splash): an HE fall-through would hurt it by distance falloff.
      w.sim.teleport(w.near, first.x + 16384, first.y);
      const events = run(w.sim, 150);
      expect(w.sim.state.hp[w.near]).toBe(1966080000);
      expect(w.sim.state.suppression[w.near]).toBe(0);
      expect(w.sim.state.hp[w.far]).toBe(1966080000);
      expect(w.sim.state.suppression[w.far]).toBe(0);
      expect(w.sim.state.hp[w.caller]).toBe(400 * 65536);
      expect(strikes(events)).toEqual([]);
    } finally {
      table[FS_SMOKE_SCREEN] = shipped;
    }
  });

  it('breaks a sight line, which is why it exists', () => {
    // The line from (10,16) to (16,16) crosses the aim at (13,16). Clear until
    // the first round lands, then thick enough to stop it (`losRay` -1).
    const w = openWorld(7);
    const los = () => call(w.sim, 'losRay', 10, 16, 16, 16);
    expect(los()).toBeGreaterThanOrEqual(0);
    callScreen(w.sim, w.caller, fx.from(13.5), fx.from(16.5));
    run(w.sim, 80);
    expect(los()).toBeGreaterThanOrEqual(0); // nothing has landed yet
    run(w.sim, 1);
    expect(call(w.sim, 'raySmoke', 10, 16, 16, 16)).toBeGreaterThanOrEqual(SMOKE_BLOCKS_AT);
    expect(los()).toBe(-1);
  });
});

describe('a smoke-screen round and the focus (#591)', () => {
  /** `me` focused on a post six tiles east; a caller far off. */
  function focused(seed: number, speed = 1) {
    const sim = new Sim({ seed, width: 64, height: 32, capacity: CAPACITY });
    const type = { ...RIFLEMAN, mobility: { speed_tiles_s: speed } };
    const me = sim.spawn(sim.addUnitType(type), 0, fx.from(10.5), fx.from(16.5));
    const foe = sim.spawn(sim.addUnitType(TARGET), 1, fx.from(16.5), fx.from(16.5));
    const caller = sim.spawn(sim.addUnitType(CALLER), 0, fx.from(5.5), fx.from(5.5));
    sim.identifyTo(0, foe);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(foe);
    return { sim, me, foe, caller };
  }

  /** Lay a screen across the pair and watch the focus until it ends or `ticks` run out. */
  function underScreen(speed: number, ticks: number) {
    const { sim, me, foe, caller } = focused(7, speed);
    sim.queueCommand({ kind: 'callStrike', caller, x: fx.from(13.5), y: fx.from(16.5), profile: FS_SMOKE_SCREEN });
    let landed = -1;
    let standingAtLanding = false;
    let firstLost = -1;
    let ended = -1;
    for (let t = 1; t <= ticks && ended < 0; t++) {
      const laid = smokes(sim.tick());
      if (laid.length > 0 && landed < 0) {
        landed = t;
        standingAtLanding = sim.state.focusTarget[me] === foe;
      }
      if (firstLost < 0 && sim.state.focusLost[me] > 0) firstLost = t;
      if (sim.state.focusTarget[me] === -1) ended = t;
    }
    return { sim, me, foe, landed, standingAtLanding, firstLost, ended };
  }

  it('releases no focus: the round names no unit, the caller included', () => {
    // Aimed far from the pair, so nothing here can lose the contact; the
    // caller is the focused unit itself, the one id a support command carries.
    const { sim, me, foe } = focused(7);
    sim.queueCommand({ kind: 'callStrike', caller: me, x: fx.from(50.5), y: fx.from(4.5), profile: FS_SMOKE_SCREEN });
    let landed = 0;
    for (let i = 0; i < 300; i++) {
      landed += smokes(sim.tick()).length;
      expect(sim.state.focusTarget[me]).toBe(foe);
    }
    expect(landed).toBe(3);
    expect(sim.state.focusLost[me]).toBe(0);
  });

  it('a screen between a focused unit and its target: it walks toward the last-seen tile for up to FOCUS_LOST_TICKS, then the focus ends (T-D3, measured)', () => {
    // A slow unit (0.3 tile/s), so it cannot reach the last-seen tile in time.
    // Measured, seed 7: the round lands, the contact decays over ~70 ticks of
    // blocked sight, `focusLost` then counts 100 and the order ends 2.5 tiles
    // short of the target. Not designed here; pinned so a change is seen.
    const r = underScreen(0.3, 400);
    expect(r.standingAtLanding).toBe(true); // the landing itself releases nothing
    expect(r.firstLost).toBeGreaterThan(r.landed);
    expect(r.ended - r.firstLost + 1).toBe(FOCUS_LOST_TICKS);
    const x = r.sim.state.posX[r.me] / 65536;
    expect(x).toBeGreaterThan(10.5 + 1);
    expect(x).toBeLessThan(16.5 - 1); // never reached the tile it was walking to
  });

  it('measured: a unit that reaches the last-seen tile in time re-sights the target through its own thinning screen, and keeps the focus', () => {
    // A 1 tile/s unit arrives (tile 16) with ~40 of its 100 lost ticks spent.
    // Standing on the target's tile the sight line is one tile, and one tile
    // of thinning smoke (under SMOKE_BLOCKS_AT) no longer stops it.
    const r = underScreen(1, 400);
    expect(r.standingAtLanding).toBe(true);
    expect(r.firstLost).toBeGreaterThan(r.landed);
    expect(r.ended).toBe(-1);
    expect(r.sim.state.focusTarget[r.me]).toBe(r.foe);
    expect(r.sim.state.posX[r.me] >> 16).toBe(16);
    expect(r.sim.state.focusLost[r.me]).toBe(0);
  });
});

describe('a smoke-screen round and a garrison with floors (#606)', () => {
  // MEASURED, not designed: `raySmoke` counts a tile only where the plume's top
  // (ground + SMOKE_RISE 2) is above the sight line, and the line runs from the
  // eye (ground + EYE_HEIGHT 1 + eyeLift) down to the target's head. From the
  // top window of a 3-floor apartment (eyeLift 2) the eye is at 3, above the
  // plume, so smoke only counts on the TARGET's half of the line (the plume top
  // 2 is above the line once it has descended below 2). A 2-floor garrison
  // (eyeLift 1) has its eye exactly at the plume's top: every tile but its own
  // window tile (k = 0, where the line is level with the top) still counts, so
  // it is blinded. Neither answer was fitted: the screen is the same
  // SMOKE_RADIUS 3 disc as ever.
  const APARTMENT = { id: 'fs_apartment', name: 'Apartment', hp_per_tile: 100000, garrison_slots: 2, rubble_cover: 2, floors: 3 };
  const TWO_STOREY = { ...APARTMENT, id: 'fs_two_storey', floors: 2 };

  /** A garrison on side 0 in a 2x2 building at (10..11, 15..16), a ground
   *  target 10 tiles east on the same row, a screen called onto `aimX`. */
  function world(structure: typeof APARTMENT, aimX: number) {
    const sim = new Sim({ seed: 7, width: 48, height: 32, capacity: CAPACITY });
    const caller = sim.spawn(sim.addUnitType(CALLER), 0, fx.from(5.5), fx.from(5.5));
    const house = rect(sim, sim.addStructureType(structure), 10, 15, 2, 2);
    const holder = sim.spawn(sim.addUnitType(HOLDER), 0, fx.from(9.5), fx.from(15.5));
    sim.queueCommand({ kind: 'garrison', ids: [holder], structure: house });
    for (let i = 0; i < 400 && sim.state.garrisonedIn[holder] !== house; i++) sim.tick();
    expect(sim.state.garrisonedIn[holder]).toBe(house);
    const tgt = sim.spawn(sim.addUnitType(TARGET), 1, fx.from(21.5), fx.from(16.5));
    const hx = sim.state.posX[holder] >> 16;
    const hy = sim.state.posY[holder] >> 16;
    sim.queueCommand({ kind: 'callStrike', caller, x: fx.from(aimX + 0.5), y: fx.from(hy + 0.5), profile: FS_SMOKE_SCREEN });
    run(sim, 81); // the first round
    const lift = call(sim, 'eyeLift', holder);
    const tx = sim.state.posX[tgt] >> 16;
    const ty = sim.state.posY[tgt] >> 16;
    return { sim, hx, hy, tx, ty, lift };
  }

  it('the top floor of a 3-floor apartment looks over a screen laid on its own side, and through one laid on the target', () => {
    const near = world(APARTMENT, 12); // the screen is at the garrison's end
    expect(near.lift).toBe(2);
    const seen = (w: typeof near, lift: number) => call(w.sim, 'raySmoke', w.hx, w.hy, w.tx, w.ty, lift, 0);
    expect(seen(near, 0)).toBeGreaterThanOrEqual(SMOKE_BLOCKS_AT); // a man on the ground there is blind
    expect(seen(near, near.lift)).toBe(0); // the top floor is not

    const far = world(APARTMENT, 20); // the screen is at the target's end
    expect(seen(far, far.lift)).toBeGreaterThanOrEqual(SMOKE_BLOCKS_AT);
    expect(call(far.sim, 'losRay', far.hx, far.hy, far.tx, far.ty, far.lift, 0)).toBe(-1);
  });

  it('a screen across the middle of the line blinds the top floor too, by the target-side half of it', () => {
    const mid = world(APARTMENT, 16);
    expect(call(mid.sim, 'raySmoke', mid.hx, mid.hy, mid.tx, mid.ty, mid.lift, 0)).toBeGreaterThanOrEqual(SMOKE_BLOCKS_AT);
    expect(call(mid.sim, 'losRay', mid.hx, mid.hy, mid.tx, mid.ty, mid.lift, 0)).toBe(-1);
  });

  it('a 2-floor garrison, whose eye sits at the plume top, is blinded; it differs from the ground only by its own window tile', () => {
    const w = world(TWO_STOREY, 12);
    expect(w.lift).toBe(1);
    const ground = call(w.sim, 'raySmoke', w.hx, w.hy, w.tx, w.ty, 0, 0);
    const aloft = call(w.sim, 'raySmoke', w.hx, w.hy, w.tx, w.ty, w.lift, 0);
    expect(aloft).toBe(ground - w.sim.smokeAt(w.hx, w.hy));
    expect(aloft).toBeGreaterThanOrEqual(SMOKE_BLOCKS_AT);
  });
});
