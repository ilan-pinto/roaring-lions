import { describe, expect, it } from 'vitest';
import { fx, ONE, type Fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import type { StructureTypeJson } from './structures';
import { overmatchShift, penetrationHpCost } from './vehicle-health';

// GH-560. Every expectation below is a literal, worked by hand from
//   cost = max(damage, floor(maxHp * 22282 / 65536) * (60 + shift) / 60)
// on raw Q16.16 values (hp 3000 = 196608000, damage 520 = 34078720). None is
// imported from the code under test.

const Q = 65536;

describe('penetrationHpCost (GH-560, design 5.2)', () => {
  // [case, hp, shift, damage, cost raw, hits to kill]
  const rows: ReadonlyArray<readonly [string, number, number, number, number, number]> = [
    ['120 mm v Lavi front', 3000, 28, 520, 98040800, 3],
    ['120 mm v Namer front', 2200, 30, 520, 73530600, 2],
    ['120 mm v Eitan front', 1600, 30, 520, 53476800, 2],
    ['Kornet v Lavi front', 3000, 8, 400, 75758800, 3],
    ['Kornet v Lavi side', 3000, 30, 400, 100269000, 2],
    ['RPG-7 v Lavi side', 3000, 27, 300, 96926700, 3],
    ['RPG-7 v Eitan front', 1600, 30, 300, 53476800, 2],
    ['ZU-23 v Peten front', 640, 0, 85, 14260480, 3],
    ['the weapon dominates (cost is the damage)', 640, 0, 300, 19660800, 3],
  ];

  for (const [name, hp, shift, damage, cost, hits] of rows) {
    it(`${name}: ${cost} raw, ${hits} hits`, () => {
      expect(penetrationHpCost(hp * Q, damage * Q, shift)).toBe(cost);
      expect(Math.ceil((hp * Q) / cost)).toBe(hits);
    });
  }

  it('no single hit kills a sound hull, even at the heaviest overmatch', () => {
    const cost = penetrationHpCost(196608000, 34078720, 30);
    expect(cost).toBe(100269000);
    expect(cost).toBeLessThan(196608000);
  });

  it('the product stays an int32 for the largest Fx hull (32767 hp) at shift 30', () => {
    // 32767 hp = 2147418112 raw. floor = 730114294; x 90 / 60 = 1095171441, below 2^31.
    // Moving the `| 0` before the division wraps the 6.5e10 product and reads a different number.
    expect(penetrationHpCost(2147418112, 0, 30)).toBe(1095171441);
  });
});

describe('overmatchShift (GH-560)', () => {
  // z in Q16.16 turned into raw by hand: 1.5 = 98304, 3.5 = 229376, 4 = 262144, 9 = 589824.
  const cases: ReadonlyArray<readonly [string, number, number]> = [
    ['z = 0.5 (under 1: no shift)', 32768, 0],
    ['z = 1.0', 65536, 0],
    ['z = 1.5', 98304, 5],
    ['z = 1.95 (floors, not rounds)', 127795, 9],
    ['z = 3.5', 229376, 25],
    ['z = 4 (the cap)', 262144, 30],
    ['z = 9 (clamped)', 589824, 30],
  ];
  for (const [name, z, shift] of cases) {
    it(`${name} -> ${shift}`, () => {
      expect(overmatchShift(z)).toBe(shift);
    });
  }
});

// --------------------------------------------------------------------------------------------------
// Behaviour (GH-560, plan Task 2): HP alone ends a vehicle; a threatening bounce restarts the regen.
// Role-less fixtures and literal expectations.

const SENSORS = { optics: 1, sight_tiles: 12, signature: 1 };

function gun(id: string, penetration: number, damage: number, rof: number): UnitTypeJson['weapons'] {
  return [
    { id, type: 'apfsds', range_tiles: 12, effective_range_tiles: 12, accuracy: 1, penetration, damage, suppression: 10, rof_per_min: rof },
  ];
}

/** A hard hull: 3000 hp, 300 mm on every face, never moves. `mbt` role = tracked. */
const HULL: UnitTypeJson = {
  id: 'vh_hull', role: 'mbt', hull: { hp: 3000, armor: { front: 300, side: 300, rear: 300 } },
  mobility: { speed_tiles_s: 1 }, sensors: SENSORS,
};
/** A wheeled hull, a vehicle for the workshop aura. */
const WHEELED: UnitTypeJson = { ...HULL, id: 'vh_wheeled', role: 'apc', mobility: { speed_tiles_s: 1, gear: 'wheels' } };
/** Front plate so thick that a 300 mm round has P(pen) 0 (z = -47), side plate it could beat. */
const THICK_FRONT: UnitTypeJson = {
  ...HULL, id: 'vh_thick', hull: { hp: 3000, armor: { front: 2000, side: 300, rear: 300 } },
};
/** 1000 mm at 300 mm plate: z = 5.8, P(pen) = 1, shift 30. Damage 1: the floor dominates. */
const HEAVY_GUN: UnitTypeJson = {
  id: 'vh_heavy_gun', hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 }, sensors: SENSORS, weapons: gun('heavy', 1000, 1, 600),
};
/** Pen 300 against 300 side armour: it `threatens` (pen >= armorSide) but cannot beat 2000 on the front. */
const THREAT_GUN: UnitTypeJson = { ...HEAVY_GUN, id: 'vh_threat_gun', weapons: gun('threat', 300, 1, 600) };
/** Pen 8: noise on any hull. */
const RIFLE: UnitTypeJson = { ...HEAVY_GUN, id: 'vh_rifle', weapons: gun('rifle', 8, 1, 600) };

interface Internals {
  rollComponent(target: number, shooter: number, z: Fx): void;
  applyDamage(t: number, d: Fx, by: number): void;
}

function impactsOn(evs: SimEvent[], target: number): Extract<SimEvent, { kind: 'impact' }>[] {
  return evs.filter((e): e is Extract<SimEvent, { kind: 'impact' }> => e.kind === 'impact' && e.target === target);
}

describe('HP alone ends a hull (GH-560, lead ruling 1)', () => {
  it('two penetrations at shift 30 destroy a 3000 hp hull: alive after one, destroyed by the shooter after two', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 16, capacity: 8 });
    const tank = sim.spawn(sim.addUnitType(HULL), 1, fx.from(10.5), fx.from(8.5), 32768);
    const shooter = sim.spawn(sim.addUnitType(HEAVY_GUN), 0, fx.from(4.5), fx.from(8.5));
    sim.identifyTo(0, tank);
    let pens = 0;
    let destroyedAt = -1;
    for (let t = 0; t < 400 && destroyedAt < 0; t++) {
      const evs = sim.tick();
      const penetrated = impactsOn(evs, tank).filter((e) => e.penetrated).length;
      pens += penetrated;
      if (penetrated > 0 && pens === 1) {
        expect(sim.state.alive[tank]).toBe(1);
        expect(sim.state.hp[tank]).toBe(96339000); // 196608000 - 100269000
      }
      const dead = evs.find((e) => e.kind === 'destroyed' && e.entity === tank);
      if (dead !== undefined && dead.kind === 'destroyed') {
        destroyedAt = t;
        expect(dead.by).toBe(shooter);
        expect(pens).toBe(2);
        expect(sim.state.hp[tank]).toBeLessThanOrEqual(0);
      }
    }
    expect(destroyedAt).toBeGreaterThan(0);
  });

  it('no hull dies from a bar above one hit: 30 seeds of an AT team on a tank (the old catastrophic roll is gone)', () => {
    const AT: UnitTypeJson = {
      id: 'vh_at', hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } }, mobility: { speed_tiles_s: 0.7 },
      sensors: SENSORS,
      weapons: [{ id: 'atgm', type: 'atgm', range_tiles: 9, effective_range_tiles: 7.2, accuracy: 0.78, penetration: 900, damage: 400, suppression: 10, rof_per_min: 3 }],
    };
    const MBT: UnitTypeJson = { ...HULL, id: 'vh_mbt', hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } } };
    let deaths = 0;
    for (let seed = 0; seed < 30; seed++) {
      const sim = new Sim({ seed: 1000 + seed, width: 32, height: 16, capacity: 8 });
      sim.spawn(sim.addUnitType(AT), 0, fx.from(2.5), fx.from(8.5));
      const tank = sim.spawn(sim.addUnitType(MBT), 1, fx.from(7.5), fx.from(8.5), 32768);
      for (let t = 0; t < 300 * 20; t++) {
        // destroy() zeroes hp, so "hp <= 0 after" cannot tell a luck death from an HP one. The bar BEFORE the
        // fatal tick can: no single hit costs more than 0.51 of 3000 hp (100269000 raw), so a hull that dies
        // from a higher bar was killed by something other than its hit points.
        const before = sim.state.hp[tank];
        const evs = sim.tick();
        if (evs.some((e) => e.kind === 'destroyed' && e.entity === tank)) {
          deaths++;
          expect(before, `seed ${1000 + seed}, bar before the fatal hit`).toBeLessThanOrEqual(100269000);
          break;
        }
      }
    }
    // Vacuity guard: a scene that kills nothing proves nothing.
    expect(deaths).toBeGreaterThanOrEqual(5);
  });
});

describe('the component draw: one per penetration, over 92 - shift (GH-560)', () => {
  function rolled(z: Fx, u32: number): { results: string[]; destroyed: boolean } {
    const sim = new Sim({ seed: 7, width: 24, height: 16, capacity: 8 });
    const id = sim.spawn(sim.addUnitType(HULL), 0, fx.from(10.5), fx.from(10.5));
    const rng = sim.rng as unknown as { nextU32(e: number): number };
    let calls = 0;
    rng.nextU32 = () => {
      calls++;
      return u32;
    };
    (sim as unknown as Internals).rollComponent(id, id, z);
    expect(calls).toBe(1);
    const evs = sim.tick();
    return {
      results: evs.flatMap((e) => (e.kind === 'component' ? [e.result] : [])),
      destroyed: evs.some((e) => e.kind === 'destroyed'),
    };
  }

  // Draw = (hi16 * total) >>> 16. At z = 1 (shift 0) total is 92: crew 0-44, mobility 45-64, firepower 65-79,
  // combat_ineffective 80-91.
  it('z = 1: 0x8000 -> 46 mobility_kill; 0xF000 -> 86 and 0xFFFF -> 91 combat_ineffective, never destroyed', () => {
    expect(rolled(ONE, 0x80000000).results).toEqual(['mobility_kill']);
    expect(rolled(ONE, 0xf0000000).results).toEqual(['combat_ineffective']);
    const top = rolled(ONE, 0xffff0000);
    expect(top.results).toEqual(['combat_ineffective']);
    expect(top.destroyed).toBe(false);
  });

  // z = 4 (shift 30): total 62, crew 0-14, mobility 15-34, firepower 35-49, combat_ineffective 50-61.
  it('z = 4: 0x3000 -> 11 crew_shaken; 0x4000 -> 15 mobility_kill; 0xFFFF -> 61 combat_ineffective', () => {
    expect(rolled(4 * ONE, 0x30000000).results).toEqual(['crew_shaken']);
    expect(rolled(4 * ONE, 0x40000000).results).toEqual(['mobility_kill']);
    const top = rolled(4 * ONE, 0xffff0000);
    expect(top.results).toEqual(['combat_ineffective']);
    expect(top.destroyed).toBe(false);
  });
});

describe('a threatening bounce restarts the regen delay; a harmless one does not (GH-560, lead ruling 3)', () => {
  /** Half-bar hull damaged at tick 0; at tick 100 a shooter appears and fires until one round bounces. */
  function scene(shooterType: UnitTypeJson, hullType: UnitTypeJson = THICK_FRONT, setup?: (sim: Sim, id: number) => void) {
    const sim = new Sim({ seed: 5, width: 40, height: 24, capacity: 8 });
    const id = sim.spawn(sim.addUnitType(hullType), 1, fx.from(10.5), fx.from(8.5), 32768);
    setup?.(sim, id);
    (sim as unknown as Internals).applyDamage(id, 98304000, -1); // half of 196608000, at tick 0
    for (let t = 0; t < 100; t++) sim.tick();
    const shooter = sim.spawn(sim.addUnitType(shooterType), 0, fx.from(4.5), fx.from(8.5));
    sim.identifyTo(0, id);
    return { sim, id, shooter };
  }

  /** Tick until the first non-penetrating impact on `id`; returns its tick (and kills the shooter so it is the only one). */
  function untilBounce(sim: Sim, id: number, shooter: number, each?: () => void): number {
    for (let t = 0; t < 200; t++) {
      const evs = sim.tick();
      each?.();
      const hit = impactsOn(evs, id).find((e) => !e.penetrated);
      if (hit !== undefined) {
        sim.debugKill(shooter);
        return hit.tick;
      }
    }
    throw new Error('no bounce in 200 ticks');
  }

  /** hp after each tick from the bounce tick T through T + 200. */
  function hpFrom(sim: Sim, id: number): number[] {
    const hp: number[] = [sim.state.hp[id]];
    for (let k = 1; k <= 200; k++) {
      sim.tick();
      hp.push(sim.state.hp[id]);
    }
    return hp;
  }

  it('threatening (pen 300 >= side 300, P(pen) 0 on the front): hp flat through T + 199, +48000 exactly at T + 200', () => {
    const { sim, id, shooter } = scene(THREAT_GUN);
    expect(sim.state.hp[id]).toBe(98304000);
    untilBounce(sim, id, shooter);
    const hp = hpFrom(sim, id);
    expect(hp[0]).toBe(98304000);
    for (let k = 0; k <= 199; k++) expect(hp[k], `T + ${k}`).toBe(98304000);
    expect(hp[200]).toBe(98304000 + 48000); // fx.mul(196608000, 16) = 3000 x 16
  });

  it('harmless (pen 8 < side 300): the delay runs from the tick-0 damage, so hp has already risen by T + 100', () => {
    const { sim, id, shooter } = scene(RIFLE);
    const T = untilBounce(sim, id, shooter);
    // Damaged at tick 0: regen begins at tick 200 and adds 48000 a tick from there. T is tick ~100.
    const hp = hpFrom(sim, id);
    expect(T).toBeLessThan(110);
    expect(hp[0]).toBe(98304000);
    expect(hp[199 - T]).toBe(98304000); // tick 199: still waiting
    expect(hp[200 - T]).toBe(98304000 + 48000); // tick 200: the first gain, as before GH-560
  });

  it('a stuck hull\'s crew fix restarts on a threatening bounce and runs on through a harmless one', () => {
    const run = (type: UnitTypeJson): { onBounce: number; ticks: number } => {
      const { sim, id, shooter } = scene(type, THICK_FRONT);
      // Stuck from the start; the fix counts one a tick (rate 1: no repair unit near). Hold at 0 until the shooter appears.
      let ticks = 0;
      sim.state.mobilityKilled[id] = 1;
      untilBounce(sim, id, shooter, () => {
        ticks++;
      });
      return { onBounce: sim.state.fieldFixTicks[id], ticks };
    };
    const harmless = run(RIFLE);
    // The fix counted every tick since the shooter appeared (the hull was already stuck): never reset.
    expect(harmless.onBounce).toBe(harmless.ticks);
    expect(harmless.ticks).toBeGreaterThan(0);
    const threat = run(THREAT_GUN);
    expect(threat.onBounce).toBe(0);
    expect(threat.ticks).toBeGreaterThan(0);
  });

  it('a hull in a workshop aura loses its repair progress to a threatening bounce, not to a harmless one', () => {
    const WORKSHOP: StructureTypeJson = {
      id: 'vh_workshop', hp_per_tile: 300,
      aura: { area: [{ radius: 6, affects: 'vehicle', repair_per_s: 0.01, repair_components_s: 30 }] },
    };
    const THICK_WHEELED: UnitTypeJson = { ...WHEELED, id: 'vh_thick_wheeled', hull: THICK_FRONT.hull };
    const run = (type: UnitTypeJson): { onBounce: number; ticks: number } => {
      const { sim, id, shooter } = scene(type, THICK_WHEELED, (s) => {
        const ws = s.addStructureType(WORKSHOP);
        const tiles: number[] = [];
        for (let ty = 10; ty < 12; ty++) for (let tx = 10; tx < 12; tx++) tiles.push(ty * s.width + tx);
        s.addStructure(ws, tiles, { owner: 1 });
      });
      let ticks = 0;
      untilBounce(sim, id, shooter, () => {
        ticks++;
      });
      return { onBounce: sim.state.auraRepairTicks[id], ticks };
    };
    const harmless = run(RIFLE);
    expect(harmless.onBounce).toBeGreaterThan(50); // 100 ticks of the pre-fight, still counting
    const threat = run(THREAT_GUN);
    expect(threat.onBounce).toBe(0);
  });
});
