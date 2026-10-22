// Mobility kills (#706) Task 1: `mobility.gear`, the slowed state, the crew field
// fix and its engineer assist, the workshop clearing slowed, and the hash latch.
// Spec docs/superpowers/specs/2026-10-22-mobility-kills-design.md §3.
//
// Component results are forced by stubbing the shared Rng's `nextU32` for exactly
// one `rollComponent` call (both reached through a test-only cast, the
// `applyDamage` pattern auras.test.ts uses): no seam is added to the sim. With
// overmatch z = ONE there is no shift, so the table is 45/20/15/12/8 = 100 and
// draw = ((u32 >>> 16) * 100) >>> 16. Every expected number is a literal with its
// hand arithmetic beside it.
import { describe, expect, it } from 'vitest';
import { fx, ONE, type Fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import type { StructureTypeJson } from './structures';
import { FIELD_FIX_TICKS, FIELD_FIX_ASSIST_RADIUS, MOB_DAMAGED_PCT } from './tuning';

/** hi = 32768: (32768 * 100) >>> 16 = 50, inside [45, 65): mobility_kill. */
const U_MOBILITY = 0x80000000;
/** hi = 55706: (55706 * 100) >>> 16 = 84, inside [80, 92): combat_ineffective. */
const U_COMBAT_INEFFECTIVE = 0xd99a0000;

const HULL = { hp: 3000, armor: { front: 300, side: 200, rear: 100 } };
const SENSORS = { optics: 1, sight_tiles: 2, signature: 1 };
/** speed 1 tile/s: stepPerTick = fx.mul(65536, 3277) = 3277 raw. */
const WHEELS: UnitTypeJson = {
  id: 'm_wheels', role: 'apc', hull: HULL, mobility: { speed_tiles_s: 1, gear: 'wheels' }, sensors: SENSORS,
};
const TRACKS: UnitTypeJson = {
  id: 'm_tracks', role: 'mbt', hull: HULL, mobility: { speed_tiles_s: 1 }, sensors: SENSORS,
};
/** A hard aircraft that also declares wheels: air ignores gear. */
const HELI: UnitTypeJson = {
  id: 'm_heli', role: 'gunship', hull: HULL, mobility: { speed_tiles_s: 1, domain: 'air', gear: 'wheels' }, sensors: SENSORS,
};
const ENGINEER: UnitTypeJson = {
  id: 'm_engineer', role: 'engineer', hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 }, sensors: SENSORS, abilities: ['repair'],
};
const RIFLES: UnitTypeJson = { ...ENGINEER, id: 'm_rifles', role: 'infantry', abilities: [] };
const WORKSHOP: StructureTypeJson = {
  id: 'm_workshop', hp_per_tile: 300,
  aura: { area: [{ radius: 4, affects: 'vehicle', repair_per_s: 0.01, repair_components_s: 30 }] },
};

interface Internals {
  rollComponent(target: number, shooter: number, z: Fx): void;
  applyDamage(t: number, d: Fx, by: number): void;
}

function world() {
  const sim = new Sim({ seed: 7, width: 48, height: 32, capacity: 32 });
  const u = {
    wheels: sim.addUnitType(WHEELS),
    tracks: sim.addUnitType(TRACKS),
    heli: sim.addUnitType(HELI),
    engineer: sim.addUnitType(ENGINEER),
    rifles: sim.addUnitType(RIFLES),
  };
  return { sim, u };
}

/** Collect every event over `ticks` ticks. */
function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

/** Force one component roll on `target` with the stubbed draw; returns its event. */
function roll(sim: Sim, target: number, u32: number): SimEvent[] {
  const rng = sim.rng as unknown as { nextU32(e: number): number };
  const real = rng.nextU32;
  rng.nextU32 = () => u32;
  try {
    (sim as unknown as Internals).rollComponent(target, target, ONE);
  } finally {
    rng.nextU32 = real;
  }
  // rollComponent pushes onto this tick's pending list; the next tick returns it.
  return sim.tick();
}

function results(events: SimEvent[]): string[] {
  return events.flatMap((e) => (e.kind === 'component' ? [e.result] : []));
}

function damage(sim: Sim, id: number): void {
  (sim as unknown as Internals).applyDamage(id, fx.fromInt(1), -1);
}

describe('mobility kills (#706): the roll by running gear', () => {
  it('constants are the spec\'s numbers (90 s at the sim\'s own tick rate)', () => {
    expect(FIELD_FIX_TICKS).toBe(90 * TICKS_PER_SECOND); // 1800
    expect(MOB_DAMAGED_PCT).toBe(50);
    expect(FIELD_FIX_ASSIST_RADIUS).toBe(2);
  });

  it('wheels: the first mobility hit slows, the second sticks', () => {
    const { sim, u } = world();
    const id = sim.spawn(u.wheels, 0, fx.from(10.5), fx.from(10.5));
    expect(results(roll(sim, id, U_MOBILITY))).toEqual(['mobility_damaged']);
    expect(sim.state.mobilityDamaged[id]).toBe(1);
    expect(sim.state.mobilityKilled[id]).toBe(0);
    expect(results(roll(sim, id, U_MOBILITY))).toEqual(['mobility_kill']);
    expect(sim.state.mobilityKilled[id]).toBe(1);
  });

  it('tracks: one mobility hit sticks', () => {
    const { sim, u } = world();
    const id = sim.spawn(u.tracks, 0, fx.from(10.5), fx.from(10.5));
    expect(results(roll(sim, id, U_MOBILITY))).toEqual(['mobility_kill']);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    expect(sim.state.mobilityDamaged[id]).toBe(0);
  });

  it('combat_ineffective sticks a sound wheeled hull at once', () => {
    const { sim, u } = world();
    const id = sim.spawn(u.wheels, 0, fx.from(10.5), fx.from(10.5));
    expect(results(roll(sim, id, U_COMBAT_INEFFECTIVE))).toEqual(['combat_ineffective']);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    expect(sim.state.mobilityDamaged[id]).toBe(0);
  });

  it('an aircraft is never slowed and never field-fixed', () => {
    const { sim, u } = world();
    const id = sim.spawn(u.heli, 0, fx.from(10.5), fx.from(10.5));
    expect(results(roll(sim, id, U_MOBILITY))).toEqual(['mobility_kill']);
    expect(sim.state.mobilityDamaged[id]).toBe(0);
    const ev = run(sim, FIELD_FIX_TICKS + 10);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    expect(sim.state.fieldFixTicks[id]).toBe(0);
    expect(ev.some((e) => e.kind === 'fieldFixed')).toBe(false);
  });
});

describe('mobility kills (#706): slowed moves at half step', () => {
  // A move due east along open ground: 40 ticks after the first. Sound: 3277 a
  // tick; slowed: (3277 * 50 - (3277 * 50) % 100) / 100 = 1638 a tick.
  function travelled(slow: boolean): number {
    const { sim, u } = world();
    const id = sim.spawn(u.wheels, 0, fx.from(5.5), fx.from(10.5), 0);
    if (slow) roll(sim, id, U_MOBILITY);
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(40.5), y: fx.from(10.5) });
    run(sim, 10);
    const x0 = sim.state.posX[id];
    run(sim, 40);
    return sim.state.posX[id] - x0;
  }
  it('sound 40 x 3277, slowed 40 x 1638', () => {
    expect(travelled(false)).toBe(40 * 3277); // 131080
    expect(travelled(true)).toBe(40 * 1638); // 65520
  });
});

describe('mobility kills (#706): the crew field fix', () => {
  function stuck() {
    const { sim, u } = world();
    const id = sim.spawn(u.tracks, 0, fx.from(10.5), fx.from(10.5));
    roll(sim, id, U_MOBILITY); // the roll's own tick: the hit stamps no damage here, so it counts 1
    return { sim, u, id };
  }

  it('frees a stuck hull to slowed after exactly 1800 quiet ticks', () => {
    const { sim, id } = stuck();
    // roll() ran one tick (count 1). 1798 more: 1799.
    run(sim, 1798);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    expect(sim.state.fieldFixTicks[id]).toBe(1799);
    const ev = run(sim, 1);
    expect(sim.state.mobilityKilled[id]).toBe(0);
    expect(sim.state.mobilityDamaged[id]).toBe(1);
    expect(sim.state.fieldFixTicks[id]).toBe(0);
    expect(ev.filter((e) => e.kind === 'fieldFixed')).toEqual([{ kind: 'fieldFixed', tick: 1799, entity: id }]);
  });

  it('a hit restarts the clock, and the lost gun stays lost', () => {
    const { sim, id } = stuck();
    sim.debugDisableFirepower(id);
    run(sim, 999); // count 1000
    damage(sim, id);
    run(sim, 1); // the damage tick: 0
    expect(sim.state.fieldFixTicks[id]).toBe(0);
    run(sim, 1799);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    run(sim, 1);
    expect(sim.state.mobilityKilled[id]).toBe(0);
    expect(sim.state.firepowerKilled[id]).toBe(1);
  });

  it('a still engineer within 2 tiles halves it (900); two do not make it faster', () => {
    for (const engineers of [1, 2]) {
      const { sim, u, id } = stuck(); // count 1 (no engineer yet)
      // 1.5 tiles east and 1.5 west: 2.25 tile^2 <= 4.
      sim.spawn(u.engineer, 0, fx.from(12), fx.from(10.5));
      if (engineers === 2) sim.spawn(u.engineer, 0, fx.from(9), fx.from(10.5));
      // 1 + 2k >= 1800 first at k = 900.
      run(sim, 899);
      expect(sim.state.fieldFixTicks[id]).toBe(1 + 2 * 899); // 1799
      run(sim, 1);
      expect(sim.state.mobilityKilled[id]).toBe(0);
    }
  });

  it('an engineer out of radius, on the other side, moving, or without `repair` does not assist', () => {
    const cases: ((sim: Sim, u: ReturnType<typeof world>['u']) => void)[] = [
      (sim, u) => sim.spawn(u.engineer, 0, fx.from(13), fx.from(10.5)), // 2.5 tiles: 6.25 > 4
      (sim, u) => sim.spawn(u.engineer, 1, fx.from(12), fx.from(10.5)), // the enemy's engineer
      (sim, u) => sim.spawn(u.rifles, 0, fx.from(12), fx.from(10.5)), // no `repair`
      (sim, u) => {
        const e = sim.spawn(u.engineer, 0, fx.from(12), fx.from(10.5));
        sim.queueCommand({ kind: 'move', ids: [e], x: fx.from(12), y: fx.from(30.5) });
      },
    ];
    for (const add of cases) {
      const { sim, u, id } = stuck();
      add(sim, u);
      run(sim, 20);
      expect(sim.state.fieldFixTicks[id]).toBe(21); // 1 + 20, never 2 a tick
    }
  });

  it('the workshop aura clears slowed too', () => {
    const { sim, u } = world();
    const ws = sim.addStructureType(WORKSHOP);
    const tiles: number[] = [];
    for (let ty = 14; ty < 16; ty++) for (let tx = 20; tx < 22; tx++) tiles.push(ty * sim.width + tx);
    sim.addStructure(ws, tiles, { owner: 0 });
    // Centroid (21, 15); (23.5, 15.5) is 6.5 tile^2 from it, inside radius 4.
    const id = sim.spawn(u.wheels, 0, fx.from(23.5), fx.from(15.5));
    roll(sim, id, U_MOBILITY);
    expect(sim.state.mobilityDamaged[id]).toBe(1);
    run(sim, 700); // repair_components_s 30 = 600 ticks
    expect(sim.state.mobilityDamaged[id]).toBe(0);
  });
});

describe('mobility kills (#706): the hash latch', () => {
  function twins() {
    const a = world();
    const b = world();
    const ia = a.sim.spawn(a.u.wheels, 0, fx.from(10.5), fx.from(10.5));
    const ib = b.sim.spawn(b.u.wheels, 0, fx.from(10.5), fx.from(10.5));
    run(a.sim, 5);
    run(b.sim, 5);
    return { a: a.sim, b: b.sim, ia, ib };
  }
  it('before any mobility result the two columns are not folded', () => {
    const { a, b, ib } = twins();
    // Writes no rule makes, so only the fold can see them.
    b.state.mobilityDamaged[ib] = 1;
    b.state.fieldFixTicks[ib] = 7;
    expect(b.hash()).toBe(a.hash());
  });
  it('after one, they are', () => {
    const { a, b, ia, ib } = twins();
    roll(a, ia, U_MOBILITY);
    roll(b, ib, U_MOBILITY);
    expect(b.hash()).toBe(a.hash());
    b.state.fieldFixTicks[ib] = 7;
    expect(b.hash()).not.toBe(a.hash());
  });
});
