// Mobility kills (#706) Task 2, spec §3.4 item 4 and §3.5: a forced landing for
// EVERY aircraft. #721 landed a mobility-killed air CARRIER; the air machine
// (`stepAirCarriers`) now runs for every air type, so a gunship that loses its
// mobility in the air comes down too -- where it is on a foot-open tile, else
// on the nearest one -- and stays LANDED, a ground target with no field fix.
// A healthy non-carrier aircraft is untouched, and so is the air latch in a
// world that never mobility-kills one.
//
// Component results are forced through the real `rollComponent` with the
// shared Rng's `nextU32` stubbed for exactly one call (mobility.test.ts's own
// pattern), so the latch it sets is exercised rather than bypassed by writing
// `mobilityKilled` straight into the column.
import { describe, expect, it } from 'vitest';
import { fx, ONE, type Fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import { AIR_AIRBORNE, AIR_LANDED, AIR_LANDING, AIR_LAND_TICKS, AIR_LIFTING, AIR_LIFT_TICKS, FIELD_FIX_TICKS } from './tuning';

/** hi = 32768: (32768 * 100) >>> 16 = 50, inside [45, 65): mobility_kill. */
const U_MOBILITY = 0x80000000;
/** hi = 55706: (55706 * 100) >>> 16 = 84, inside [80, 92): combat_ineffective. */
const U_COMBAT_INEFFECTIVE = 0xd99a0000;

const SENSORS = { optics: 1, sight_tiles: 10, signature: 1 };
/** A hard, armed, seatless aircraft: not a carrier (isAirCarrier false). */
const GUNSHIP: UnitTypeJson = {
  id: 'fl_gunship',
  role: 'gunship',
  hull: { hp: 3000, armor: { front: 300, side: 200, rear: 100 } },
  mobility: { speed_tiles_s: 1, domain: 'air' },
  sensors: SENSORS,
  weapons: [
    {
      id: 'fl_gun', type: 'hmg', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.4,
      penetration: 20, damage: 30, suppression: 40, rof_per_min: 120, can_target: ['ground'],
    },
  ],
};
const TANK: UnitTypeJson = {
  id: 'fl_tank', role: 'mbt', hull: { hp: 3000, armor: { front: 300, side: 200, rear: 100 } },
  mobility: { speed_tiles_s: 1 }, sensors: SENSORS,
};

interface Internals {
  rollComponent(target: number, shooter: number, z: Fx): void;
  /** Private; read to see whether a move order wrote anything. */
  readonly goalX: Int32Array;
  readonly goalY: Int32Array;
}

const W = 40;

function world() {
  const sim = new Sim({ seed: 0x706_0002, width: W, height: W, capacity: 16 });
  const gunship = sim.addUnitType(GUNSHIP);
  const tank = sim.addUnitType(TANK);
  return { sim, gunship, tank };
}

const at = (v: number): Fx => fx.from(v);

function run(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

/** One forced component roll on `target`, then the tick that returns its event. */
function roll(sim: Sim, target: number, u32: number): void {
  const rng = sim.rng as unknown as { nextU32(e: number): number };
  const real = rng.nextU32;
  rng.nextU32 = () => u32;
  try {
    (sim as unknown as Internals).rollComponent(target, target, ONE);
  } finally {
    rng.nextU32 = real;
  }
  sim.tick();
}

function tileOf(sim: Sim, id: number): [number, number] {
  return [fx.toInt(sim.state.posX[id]), fx.toInt(sim.state.posY[id])];
}

describe('forced landing for every aircraft (#706 §3.5)', () => {
  it('a healthy gunship is untouched: AIRBORNE, flies, latch off', () => {
    const { sim, gunship } = world();
    const id = sim.spawn(gunship, 0, at(10.5), at(10.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: at(30.5), y: at(10.5) });
    for (let t = 0; t < 60; t++) {
      sim.tick();
      expect(sim.state.airState[id]).toBe(AIR_AIRBORNE);
      expect(sim.state.airTimer[id]).toBe(0);
      expect(sim.state.airWant[id]).toBe(0);
    }
    expect(sim.isAirborne(id)).toBe(true);
    expect(sim.state.posX[id]).toBeGreaterThan(at(12.5)); // 60 ticks at 1 tile/s: 3 tiles
    expect(sim.airCarrierLive).toBe(false);
  });

  it('mobility_kill in the air: LANDING at once where it is, LANDED after AIR_LAND_TICKS', () => {
    const { sim, gunship } = world();
    const id = sim.spawn(gunship, 0, at(10.5), at(10.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: at(30.5), y: at(10.5) });
    run(sim, 20);
    const x = sim.state.posX[id];
    const y = sim.state.posY[id];
    roll(sim, id, U_MOBILITY);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    expect(sim.airCarrierLive).toBe(true); // the latch: an aircraft was brought down
    expect(sim.state.airState[id]).toBe(AIR_LANDING);
    expect(sim.state.posX[id]).toBe(x); // open ground: no snap
    expect(sim.state.posY[id]).toBe(y);
    expect(sim.isAirborne(id)).toBe(false); // LANDING is a ground target (Q-C)
    run(sim, AIR_LAND_TICKS - 1);
    expect(sim.state.airState[id]).toBe(AIR_LANDING);
    run(sim, 1);
    expect(sim.state.airState[id]).toBe(AIR_LANDED);
    expect(sim.isAirborne(id)).toBe(false);
  });

  it('combat_ineffective in the air brings it down too', () => {
    const { sim, gunship } = world();
    const id = sim.spawn(gunship, 0, at(10.5), at(10.5));
    run(sim, 2);
    roll(sim, id, U_COMBAT_INEFFECTIVE);
    expect(sim.state.airState[id]).toBe(AIR_LANDING);
    run(sim, AIR_LAND_TICKS);
    expect(sim.state.airState[id]).toBe(AIR_LANDED);
  });

  it('over a building it comes down on the nearest foot-open tile', () => {
    const { sim, gunship } = world();
    const id = sim.spawn(gunship, 0, at(10.5), at(10.5));
    for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) sim.setBlocked(x, y, true);
    run(sim, 2);
    roll(sim, id, U_MOBILITY);
    expect(sim.state.airState[id]).toBe(AIR_LANDING);
    const [tx, ty] = tileOf(sim, id);
    expect(sim.blocked[ty * W + tx]).toBe(0);
    expect(Math.max(Math.abs(tx - 10), Math.abs(ty - 10))).toBe(2); // the 3x3 block's rim
    run(sim, AIR_LAND_TICKS);
    expect(sim.state.airState[id]).toBe(AIR_LANDED);
  });

  it('stays LANDED: a move during LANDING writes nothing, a move once LANDED does not lift it', () => {
    const { sim, gunship } = world();
    const id = sim.spawn(gunship, 0, at(10.5), at(10.5));
    run(sim, 2);
    roll(sim, id, U_MOBILITY);
    const goalX = (sim as unknown as Internals).goalX;
    const gx = goalX[id];
    sim.queueCommand({ kind: 'move', ids: [id], x: at(30.5), y: at(20.5) });
    sim.tick();
    expect(sim.state.airState[id]).toBe(AIR_LANDING);
    expect(goalX[id]).toBe(gx); // ignored before any write
    run(sim, AIR_LAND_TICKS);
    expect(sim.state.airState[id]).toBe(AIR_LANDED);
    const x = sim.state.posX[id];
    sim.queueCommand({ kind: 'move', ids: [id], x: at(30.5), y: at(20.5) });
    run(sim, AIR_LIFT_TICKS + 40);
    expect(sim.state.airState[id]).toBe(AIR_LANDED);
    expect(sim.state.posX[id]).toBe(x);
  });

  it('LANDING ignores an exact move, and a formation move it shares with a tank', () => {
    const { sim, gunship, tank } = world();
    const id = sim.spawn(gunship, 0, at(10.5), at(10.5));
    const tk = sim.spawn(tank, 0, at(10.5), at(14.5));
    run(sim, 2);
    roll(sim, id, U_MOBILITY);
    const goalX = (sim as unknown as Internals).goalX;
    const gx = goalX[id];
    sim.queueCommand({ kind: 'move', ids: [id], x: at(30.5), y: at(20.5), exact: true });
    sim.tick();
    expect(goalX[id]).toBe(gx);
    // The gunship claims no formation slot: the tank alone is the formation,
    // so it is sent to the order point itself.
    sim.queueCommand({ kind: 'move', ids: [id, tk], x: at(30.5), y: at(20.5) });
    sim.tick();
    expect(sim.state.airState[id]).toBe(AIR_LANDING);
    expect(goalX[id]).toBe(gx);
    expect(goalX[tk]).toBe(at(30.5));
    expect((sim as unknown as Internals).goalY[tk]).toBe(at(20.5)); // a 2-unit formation would rank it off the point
  });

  it('LANDING ignores an attack order', () => {
    const { sim, gunship, tank } = world();
    const id = sim.spawn(gunship, 0, at(20.5), at(20.5));
    const foe = sim.spawn(tank, 1, at(25.5), at(20.5));
    run(sim, 2);
    roll(sim, id, U_MOBILITY);
    sim.queueCommand({ kind: 'reveal', side: 0, x: at(25.5), y: at(20.5) });
    sim.tick();
    expect(sim.canFocus(id, foe)).toBe(true); // an attack would be accepted
    expect(sim.state.airState[id]).toBe(AIR_LANDING);
    sim.queueCommand({ kind: 'attack', ids: [id], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[id]).toBe(-1);
  });

  it('no field fix and never slowed: fieldFixTicks stays 0 through 90 s on the ground', () => {
    const { sim, gunship } = world();
    const id = sim.spawn(gunship, 0, at(10.5), at(10.5));
    run(sim, 2);
    roll(sim, id, U_MOBILITY);
    let sawFix = false;
    let maxTicks = 0;
    for (let t = 0; t < AIR_LAND_TICKS + FIELD_FIX_TICKS + 10; t++) {
      for (const e of sim.tick()) if (e.kind === 'fieldFixed') sawFix = true;
      if (sim.state.fieldFixTicks[id] > maxTicks) maxTicks = sim.state.fieldFixTicks[id];
    }
    expect(sim.state.airState[id]).toBe(AIR_LANDED);
    expect(maxTicks).toBe(0);
    expect(sawFix).toBe(false);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    expect(sim.state.mobilityDamaged[id]).toBe(0);
  });

  it('the latch: a ground mobility kill leaves the air block off', () => {
    const { sim, tank } = world();
    const id = sim.spawn(tank, 0, at(10.5), at(10.5));
    run(sim, 2);
    roll(sim, id, U_MOBILITY);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    expect(sim.airCarrierLive).toBe(false);
  });

  it('a halt while lifting (after the kill is cleared) hovers it where it lifted', () => {
    // No workshop reaches an aircraft today, so the clearing is written into
    // the column; what is under test is the lift and the halt that follows.
    const { sim, gunship } = world();
    const id = sim.spawn(gunship, 0, at(10.5), at(10.5));
    run(sim, 2);
    roll(sim, id, U_MOBILITY);
    run(sim, AIR_LAND_TICKS);
    expect(sim.state.airState[id]).toBe(AIR_LANDED);
    sim.state.mobilityKilled[id] = 0;
    sim.queueCommand({ kind: 'move', ids: [id], x: at(30.5), y: at(10.5) });
    run(sim, 2);
    expect(sim.state.airState[id]).toBe(AIR_LIFTING);
    const x = sim.state.posX[id];
    sim.queueCommand({ kind: 'halt', ids: [id] });
    run(sim, AIR_LIFT_TICKS + 40);
    expect(sim.state.airState[id]).toBe(AIR_AIRBORNE);
    expect(sim.state.posX[id]).toBe(x); // hovered, did not fly on to x 30.5
  });
});
