import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { MissionRuntime, type MissionEvent, type MissionJson } from './mission';
import { Rng } from './rng';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import { FIRE_SUPPORT, FS_AIR_STRIKE, FS_MORTAR_BARRAGE, FS_SMOKE_SCREEN } from './tuning';

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
