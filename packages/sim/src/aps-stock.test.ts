// GH-884: the APS interceptor stock. `hull.aps.reserve` rounds sit behind the ready magazine, a reload
// draws from them, `rearm_s` of quiet returns one, and an owned repair aura refills the lot. A type with
// no `reserve` keeps today's unlimited reload, byte for byte.
//
// Every expected number is a literal with its arithmetic beside it. Each gate was falsified by a one-line
// mutation of sim.ts (listed in the commit message), not by a synthetic fixture.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import type { StructureTypeJson } from './structures';

const AT_TEAM: UnitTypeJson = {
  id: 's_at',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.7 },
  sensors: { optics: 1.0, sight_tiles: 9, signature: 0.5 },
  weapons: [
    {
      id: 'atgm', type: 'atgm', range_tiles: 9, effective_range_tiles: 7.2, accuracy: 0.78,
      penetration: 900, damage: 400, suppression: 10, rof_per_min: 3,
    },
  ],
};

type ApsJson = NonNullable<UnitTypeJson['hull']['aps']>;

/** A gunless hull no ATGM can hurt (armour 5000 against pen 900), so a stream never ends it. */
function tankJson(id: string, aps: ApsJson): UnitTypeJson {
  return {
    id,
    hull: { hp: 30000, armor: { front: 5000, side: 5000, rear: 5000 }, aps },
    mobility: { speed_tiles_s: 1.1 },
    sensors: { optics: 1.0, sight_tiles: 12, signature: 1.0 },
    weapons: [],
  };
}

const APS_BASE: ApsJson = { base_pk: 0.75, magazine: 3, reload_s: 8, ineffective_vs: ['apfsds', 'kinetic'] };

/** 14 ATGM teams around one stationary APS hull (14 > 3 + 9, so a 13th engagement is on offer). */
function streamWorld(aps: ApsJson, seed = 884) {
  const sim = new Sim({ seed, width: 32, height: 32, capacity: 32 });
  const at = sim.addUnitType(AT_TEAM);
  const m = sim.addUnitType(tankJson('s_tank', aps));
  for (let i = 0; i < 14; i++) sim.spawn(at, 0, fx.from(3.5), fx.from(9.5 + i));
  const tank = sim.spawn(m, 1, fx.from(9.5), fx.from(16.5));
  return { sim, tank };
}

function apsEvents(sim: Sim, tank: number, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) {
    for (const e of sim.tick()) if (e.kind === 'aps' && e.target === tank) out.push(e);
  }
  return out;
}

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

describe('APS stock (GH-884): the reserve is finite', () => {
  it('a stream of 14 ATGMs gets 12 APS engagements (3 magazine + 9 reserve) and never a 13th', () => {
    const { sim, tank } = streamWorld({ ...APS_BASE, reserve: 9 });
    const evs = apsEvents(sim, tank, 200);
    expect(evs.length).toBe(12);
    // The reloads took from the reserve (if they never did, the reserve would still read 9 and a 13th would show).
    expect(sim.state.apsAmmo[tank]).toBe(0);
    expect(sim.state.apsReserveLeft[tank]).toBe(0);
  });

  it('absent reserve keeps the unlimited stock: the same stream gets more than 12 and the reserve column stays 0', () => {
    const { sim, tank } = streamWorld(APS_BASE);
    const evs = apsEvents(sim, tank, 200);
    expect(evs.length).toBeGreaterThan(12);
    expect(sim.state.apsReserveLeft[tank]).toBe(0);
  });
});

describe('APS stock (GH-884): the hash flag keys on the reserve, never on hasAps', () => {
  it('poking the reserve columns moves the hash of a reserve world and leaves an APS-without-reserve world alone', () => {
    const plain = streamWorld(APS_BASE);
    const before = plain.sim.hash();
    plain.sim.state.apsReserveLeft[plain.tank] = 5;
    expect(plain.sim.hash()).toBe(before); // hasAps alone folds nothing: the golden d_tank pin stays flat

    const stocked = streamWorld({ ...APS_BASE, reserve: 9 });
    const b2 = stocked.sim.hash();
    stocked.sim.state.apsReserveLeft[stocked.tank] = 5;
    expect(stocked.sim.hash()).not.toBe(b2);
  });
});

describe('APS stock (GH-884): rearm on quiet', () => {
  function lone(aps: ApsJson) {
    const sim = new Sim({ seed: 31, width: 32, height: 16, capacity: 8 });
    const m = sim.addUnitType(tankJson('s_lone', aps));
    const tank = sim.spawn(m, 1, fx.from(8.5), fx.from(8.5));
    return { sim, tank };
  }

  it('one round returns per rearm_s of quiet, and stops at the cap', () => {
    const { sim, tank } = lone({ ...APS_BASE, reserve: 5, rearm_s: 30 });
    sim.state.apsReserveLeft[tank] = 0;
    // Quiet from the start (lastDamagedTick is far in the past). 30 s = 600 ticks per round.
    run(sim, 599);
    expect(sim.state.apsReserveLeft[tank]).toBe(0);
    run(sim, 1);
    expect(sim.state.apsReserveLeft[tank]).toBe(1);
    run(sim, 600);
    expect(sim.state.apsReserveLeft[tank]).toBe(2);
    run(sim, 600 * 10);
    expect(sim.state.apsReserveLeft[tank]).toBe(5); // 5 reserve + 3 magazine is the whole stock
    expect(sim.state.apsAmmo[tank]).toBe(3);
  });

  it('a part-spent magazine is topped up once the reserve is full', () => {
    const { sim, tank } = lone({ ...APS_BASE, reserve: 2, rearm_s: 1 });
    sim.state.apsAmmo[tank] = 1; // reserve already 2 of 2; 20 ticks per round
    run(sim, 20);
    expect(sim.state.apsAmmo[tank]).toBe(2);
    run(sim, 20);
    expect(sim.state.apsAmmo[tank]).toBe(3);
    run(sim, 100);
    expect(sim.state.apsAmmo[tank]).toBe(3);
  });

  it('a threatening hit breaks quiet (lastDamagedTick)', () => {
    const { sim, tank } = lone({ ...APS_BASE, reserve: 5, rearm_s: 1 });
    sim.state.apsReserveLeft[tank] = 0;
    run(sim, 10); // 10 ticks into a clock of 20
    (sim as unknown as { applyDamage(t: number, d: number, by: number): void }).applyDamage(tank, fx.fromInt(10), -1);
    const hitTick = sim.tickCount;
    // Quiet resumes REGEN_DELAY_TICKS (200) after the hit, then 20 ticks to the first round.
    while (sim.tickCount < hitTick + 200 + 19) sim.tick();
    expect(sim.state.apsReserveLeft[tank]).toBe(0);
    run(sim, 4);
    expect(sim.state.apsReserveLeft[tank]).toBe(1);
  });

  it('an APS engagement breaks quiet even though an intercepted round never writes lastDamagedTick', () => {
    const sim = new Sim({ seed: 31, width: 32, height: 16, capacity: 8 });
    const at = sim.addUnitType(AT_TEAM);
    // base_pk 1 with the ATGM velocity factor 1.0: the u16 roll always intercepts, so no hit writes lastDamagedTick.
    const m = sim.addUnitType(tankJson('s_quiet', { ...APS_BASE, base_pk: 1, reserve: 5, rearm_s: 30 }));
    const shooter = sim.spawn(at, 0, fx.from(2.5), fx.from(8.5));
    const tank = sim.spawn(m, 1, fx.from(8.5), fx.from(8.5));
    sim.state.apsReserveLeft[tank] = 0;
    let engaged = -1;
    for (let i = 0; i < 400 && engaged < 0; i++) {
      for (const e of sim.tick()) if (e.kind === 'aps' && e.target === tank && e.intercepted) engaged = sim.tickCount;
    }
    expect(engaged).toBeGreaterThan(0);
    expect(engaged).toBeLessThan(560); // the unbroken clock (600 ticks from tick 0) has not fired yet
    sim.debugKill(shooter);
    expect(sim.state.apsReserveLeft[tank]).toBe(0);
    // Quiet restarts 200 ticks after the engagement, then 600 ticks to the first round (read off a run:
    // engaged 73, round back when tickCount reads 872 = engaged + 799).
    while (sim.tickCount < engaged + 200 + 598) sim.tick();
    expect(sim.state.apsReserveLeft[tank]).toBe(0); // with the engagement ignored, the old clock fires at tick 600
    run(sim, 2);
    expect(sim.state.apsReserveLeft[tank]).toBe(1);
  });
});

describe('APS stock (GH-884): an owned repair aura refills the stock', () => {
  const WORKSHOP: StructureTypeJson = {
    id: 's_workshop', hp_per_tile: 300,
    aura: { area: [{ radius: 4, affects: 'vehicle', repair_per_s: 0.01, repair_components_s: 30 }] },
  };
  function shop(x: number) {
    const sim = new Sim({ seed: 11, width: 48, height: 32, capacity: 8 });
    const ws = sim.addStructureType(WORKSHOP);
    sim.addStructure(ws, [14 * 48 + 20, 14 * 48 + 21, 15 * 48 + 20, 15 * 48 + 21], { owner: 0 });
    const m = sim.addUnitType(tankJson('s_aura', { ...APS_BASE, reserve: 4 })); // no rearm: only the aura can refill
    const tank = sim.spawn(m, 0, fx.from(x), fx.from(15.5));
    sim.state.apsAmmo[tank] = 0;
    sim.state.apsReserveLeft[tank] = 0;
    sim.state.mobilityKilled[tank] = 1;
    return { sim, tank };
  }
  it('inside the aura the magazine and the reserve fill on the tick the components are mended', () => {
    const { sim, tank } = shop(23.5);
    run(sim, 599); // compAt 600: the mend lands on the 600th covered tick
    expect(sim.state.mobilityKilled[tank]).toBe(1);
    expect(sim.state.apsAmmo[tank]).toBe(0);
    expect(sim.state.apsReserveLeft[tank]).toBe(0);
    run(sim, 1);
    expect(sim.state.mobilityKilled[tank]).toBe(0);
    expect(sim.state.apsAmmo[tank]).toBe(3);
    expect(sim.state.apsReserveLeft[tank]).toBe(4);
  });
  it('outside the radius nothing refills', () => {
    const { sim, tank } = shop(26.5);
    run(sim, 700);
    expect(sim.state.apsAmmo[tank]).toBe(0);
    expect(sim.state.apsReserveLeft[tank]).toBe(0);
  });
});
