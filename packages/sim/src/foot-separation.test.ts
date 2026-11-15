// Foot separation groundwork (GH-1360 S5a-1, spec docs/superpowers/specs/2026-11-15-unit-spacing-design.md §3.3
// items 1 and 3, §4): the circle fast path, the foot grid and the pair exemptions. No shipped type is a circle yet
// (S5c turns foot on), so every footprint here is a TEST-ONLY literal, and every expected number is a literal with
// its arithmetic beside it. Raw Q16.16 throughout: 65536 is one tile, 3277 is 0.05 tile.
import { describe, expect, it } from 'vitest';
import { fx, type Fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { SEP_VALVE_TICKS } from './tuning';
import { forkWitnessSeries } from './snapshot-witness';

const SENSORS = { optics: 1, sight_tiles: 2, signature: 1 };
const SOFT = { hp: 400, armor: { front: 10, side: 10, rear: 10 } };
const HULL = { hp: 3000, armor: { front: 300, side: 200, rear: 100 } };
/** A foot team as a circle of radius r: 1 tile/s is 3277 raw a tick (fx.mul(65536, DT 3277)). */
const team = (id: string, r: number, extra: Partial<UnitTypeJson> = {}): UnitTypeJson => ({
  id,
  role: 'infantry',
  hull: SOFT,
  mobility: { speed_tiles_s: 1, footprint: { half_length_tiles: r, half_width_tiles: r } },
  sensors: SENSORS,
  ...extra,
});
/** A 2 x 1 tile hull (half length 1.0, half width 0.5, centred), 3 tiles/s, 90 degrees/s, with four seats. */
const CARRIER: UnitTypeJson = {
  id: 'fs5_carrier',
  role: 'apc',
  hull: { ...HULL, transport_slots: 4 },
  mobility: { speed_tiles_s: 3, turn_rate_deg_s: 90, footprint: { half_length_tiles: 1.0, half_width_tiles: 0.5 } },
  sensors: SENSORS,
};

const EAST = 0;
interface Internals {
  sepWait: Uint8Array;
  sepLast: Uint8Array;
  sepOff: Uint8Array;
  sepFootN: number;
  sepHitStationary: boolean;
  buildSepGrid(): void;
  sepBlockedBy(i: number, px: Fx, py: Fx, nx: Fx, ny: Fx): number;
  seat(car: number, id: number): void;
}
const raw = (sim: Sim): Internals => sim as unknown as Internals;
const carriedBy = (sim: Sim): Int32Array => (sim as unknown as { carriedBy: Int32Array }).carriedBy;
const f = fx.from;
function go(sim: Sim, id: number, x: number, y: number): void {
  sim.queueCommand({ kind: 'move', ids: [id], x: f(x), y: f(y), exact: true });
}
/** Centre distance, raw: the test's own measure (fx.sqrt of the squared raw distance). */
function dist(sim: Sim, a: number, b: number): Fx {
  const dx = sim.state.posX[a] - sim.state.posX[b];
  const dy = sim.state.posY[a] - sim.state.posY[b];
  return fx.sqrt(fx.mul(dx, dx) + fx.mul(dy, dy));
}

/**
 * Runs `ticks` ticks and checks GH-421's rule on every one: while the mover's valve is shut (its count below
 * SEP_VALVE_TICKS before the tick), a tick that ends inside contact (`contact` tiles) never ends nearer than it began.
 * The distance is the test's own, in floating point (Math as the oracle): centre to centre, or, with `segment`, the
 * mover's hull segment (half length 1.0 less half width 0.5 along its facing) to the other's centre. The other body
 * has no order, and every tick it must stand exactly where it began (no push). Returns how many ticks the mover spent
 * inside 0.05 tile of contact with its valve shut, so a caller can see the rule was met.
 */
function noDeeperWhileShut(sim: Sim, mover: number, other: number, contact: number, ticks: number, segment = false): number {
  const gap = (): number => {
    const ox = sim.state.posX[other] / 65536;
    const oy = sim.state.posY[other] / 65536;
    const mx = sim.state.posX[mover] / 65536;
    const my = sim.state.posY[mover] / 65536;
    if (!segment) return Math.hypot(mx - ox, my - oy);
    const a = (sim.state.facing[mover] / 65536) * 2 * Math.PI;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const t = Math.max(-0.5, Math.min(0.5, (ox - mx) * ux + (oy - my) * uy));
    return Math.hypot(mx + ux * t - ox, my + uy * t - oy);
  };
  const x0 = sim.state.posX[other];
  const y0 = sim.state.posY[other];
  let held = 0;
  for (let tick = 1; tick <= ticks; tick++) {
    const shut = raw(sim).sepWait[mover] < SEP_VALVE_TICKS;
    const before = gap();
    sim.tick();
    const after = gap();
    expect(sim.state.posX[other], `tick ${tick}`).toBe(x0);
    expect(sim.state.posY[other], `tick ${tick}`).toBe(y0);
    if (!shut) continue;
    if (after < contact - 1e-4) expect(after, `tick ${tick}`).toBeGreaterThanOrEqual(before - 1e-4);
    if (after < contact + 0.05) held++;
  }
  return held;
}

describe('the circle fast path, two circles (GH-1360 §3.3 item 1)', () => {
  // Two circles of r 0.5: contact at 1.0 tile, 65536 raw, so (r_i + r_j)^2 is exactly 65536 too.
  function pair(): { sim: Sim; a: number; b: number } {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const t = sim.addUnitType(team('fs5_r50', 0.5));
    const a = sim.spawn(t, 0, f(10), f(10), EAST);
    const b = sim.spawn(t, 0, f(12), f(10), EAST);
    raw(sim).buildSepGrid();
    return { sim, a, b };
  }

  it('a step that ends exactly touching is apart; a step one raw unit closer is blocked by the stationary circle', () => {
    const { sim, a, b } = pair();
    // b from 12.0 to 11.0: the centres end 1.0 apart, newSq 65536, not below 65536.
    expect(raw(sim).sepBlockedBy(b, f(12), f(10), f(11), f(10))).toBe(-1);
    // to 11.0 less one raw unit: newSq = fx.mul(65535, 65535) = 65534 < 65536, and nearer than 65536 * 4 before.
    expect(raw(sim).sepBlockedBy(b, f(12), f(10), f(11) - 1, f(10))).toBe(a);
    expect(raw(sim).sepHitStationary).toBe(true);
  });

  it('inside contact, a step that keeps the distance is not blocked (no deeper); one that closes it is', () => {
    const { sim, a, b } = pair();
    // b at (10.5, 10) to (10, 10.5): 0.5 tile from a before and after, newSq = oldSq = 16384. Equal is not deeper.
    expect(raw(sim).sepBlockedBy(b, f(10.5), f(10), f(10), f(10.5))).toBe(-1);
    // to (10.25, 10): 0.25 from a, 4096 < 16384.
    expect(raw(sim).sepBlockedBy(b, f(10.5), f(10), f(10.25), f(10))).toBe(a);
  });

  it('two circles spawned inside each other: one ordered away leaves at once, and its valve never moves', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const t = sim.addUnitType(team('fs5_r45', 0.45));
    const stay = sim.spawn(t, 0, f(10.5), f(10.5), EAST);
    const leave = sim.spawn(t, 0, f(10.5), f(10.5), EAST);
    go(sim, leave, 20.5, 10.5);
    const x0 = sim.state.posX[stay];
    let clearAt = -1;
    for (let tick = 1; tick <= 60; tick++) {
      sim.tick();
      expect(sim.state.posX[stay]).toBe(x0);
      expect(raw(sim).sepWait[leave], `tick ${tick}`).toBe(0);
      if (clearAt < 0 && dist(sim, stay, leave) >= f(0.9)) clearAt = tick;
    }
    // 0.9 tile at 3277 raw a tick: 58982 / 3277 = 17.99, so clear on tick 18. Blocked, it would stand 20 ticks to the
    // valve first.
    expect(clearAt).toBe(18);
  });

  it('a team walking into a parked team: the parked one never moves, and no tick with the valve shut takes it deeper inside contact', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const t = sim.addUnitType(team('fs5_r45', 0.45));
    const parked = sim.spawn(t, 0, f(15.5), f(10.5), EAST);
    const walker = sim.spawn(t, 0, f(8.5), f(10.5), EAST);
    go(sim, walker, 22.5, 10.5);
    const refused = noDeeperWhileShut(sim, walker, parked, 0.9, 400);
    // It did meet contact and was held there (the spec is not vacuous), and it got to its goal in the end.
    expect(refused).toBeGreaterThan(0);
    expect(sim.state.moving[walker]).toBe(0);
    expect(fx.toNumber(sim.state.posX[walker])).toBeCloseTo(22.5, 3);
  });
});

describe('the circle fast path, a circle against a hull (GH-1360 §3.3 item 1)', () => {
  // The hull at (10, 10) facing east: segment x 9.5..10.5 on y = 10 (half length 1.0 less half width 0.5), radius
  // 0.5. A circle of r 0.5 is in contact with it at 1.0 tile from the segment.
  function pair(): { sim: Sim; hull: number; c: number } {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const ht = sim.addUnitType(CARRIER);
    const ct = sim.addUnitType(team('fs5_r50', 0.5));
    const hull = sim.spawn(ht, 0, f(10), f(10), EAST);
    const c = sim.spawn(ct, 0, f(10), f(12), EAST);
    raw(sim).buildSepGrid();
    return { sim, hull, c };
  }

  it('a circle stepping onto the flank: exactly touching is apart, one raw unit closer is blocked', () => {
    const { sim, hull, c } = pair();
    // The closest point is (10, 10) on the segment: 1.0 tile, 65536, not below (0.5 + 0.5)^2 = 65536.
    expect(raw(sim).sepBlockedBy(c, f(10), f(12), f(10), f(11))).toBe(-1);
    expect(raw(sim).sepBlockedBy(c, f(10), f(12), f(10), f(11) - 1)).toBe(hull);
  });

  it('beyond the nose the closest point is the segment end, not the centre', () => {
    const { sim, hull, c } = pair();
    // (11.4, 10): 0.9 tile from the nose end (10.5, 10) -> blocked from 2 tiles out. From the CENTRE it is 1.4,
    // which a centre-only test would call apart.
    expect(raw(sim).sepBlockedBy(c, f(12.5), f(10), f(11.4), f(10))).toBe(hull);
    // (11.6, 10): 1.1 tile from the nose end, apart.
    expect(raw(sim).sepBlockedBy(c, f(12.5), f(10), f(11.6), f(10))).toBe(-1);
  });

  it('a circle spawned inside a parked hull walks straight out, and its valve never moves', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const ht = sim.addUnitType(CARRIER);
    const ct = sim.addUnitType(team('fs5_r45', 0.45));
    const hull = sim.spawn(ht, 0, f(10.5), f(10.5), EAST);
    const c = sim.spawn(ct, 0, f(10.5), f(10.5), EAST);
    go(sim, c, 10.5, 20.5);
    const x0 = sim.state.posX[hull];
    for (let tick = 1; tick <= 40; tick++) {
      sim.tick();
      expect(sim.state.posX[hull]).toBe(x0);
      expect(raw(sim).sepWait[c], `tick ${tick}`).toBe(0);
    }
    // 40 unblocked steps south: 10.5 + 40 x 0.05 = 12.5 (40 x 3277 = 131080 raw from 688128).
    expect(sim.state.posY[c]).toBe(f(10.5) + 40 * 3277);
  });

  it('a hull walking into a parked team: the team never moves, and no tick with the valve shut takes it deeper inside contact', () => {
    const sim = new Sim({ seed: 3, width: 40, height: 32, capacity: 8 });
    const ht = sim.addUnitType(CARRIER);
    const ct = sim.addUnitType(team('fs5_r45', 0.45));
    const parked = sim.spawn(ct, 0, f(20.5), f(10.5), EAST);
    const hull = sim.spawn(ht, 0, f(8.5), f(10.5), EAST);
    go(sim, hull, 32.5, 10.5);
    // The hull's own body against the team's: the oracle is the segment, measured here in floating point.
    const refused = noDeeperWhileShut(sim, hull, parked, 0.95, 300, true);
    expect(refused).toBeGreaterThan(0);
    expect(sim.state.moving[hull]).toBe(0);
    expect(fx.toNumber(sim.state.posX[hull])).toBeCloseTo(32.5, 3);
  });
});

describe('the foot grid (GH-1360 §4)', () => {
  // A 3.5 x 1 hull (half length 1.75, the longest the hull grid takes: 2 x 1.75 + 0.5 = 4) and a circle of r 0.75
  // (the widest the foot grid takes: 2 x 0.75 + 0.5 = 2). They overlap at up to 1.25 + 0.5 + 0.75 = 2.5 tiles
  // between centres along the axis, beyond the 2 tiles a 3 x 3 visit of 2-tile cells is sure to reach.
  const LONG: UnitTypeJson = { ...CARRIER, id: 'fs5_long', mobility: { ...CARRIER.mobility, footprint: { half_length_tiles: 1.75, half_width_tiles: 0.5 } } };
  it('a hull mover sees a circle 2.4 tiles ahead across two cell edges: the 5 x 5 visit', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const ht = sim.addUnitType(LONG);
    const ct = sim.addUnitType(team('fs5_r75', 0.75));
    const hull = sim.spawn(ht, 0, f(13.85), f(10.5), EAST);
    const c = sim.spawn(ct, 0, f(16.3), f(10.5), EAST);
    raw(sim).buildSepGrid();
    expect(raw(sim).sepFootN).toBe(1);
    // n = 13.9 is in foot cell 6 (12..14); the circle at 16.3 is in cell 8, two cells over. Nose end after the step
    // 13.9 + 1.25 = 15.15: gap 1.15 < 1.25 (0.5 + 0.75), and nearer than 1.2 before -> blocked.
    expect(raw(sim).sepBlockedBy(hull, f(13.85), f(10.5), f(13.9), f(10.5))).toBe(c);
  });

  it('a circle wider than the foot grid takes is refused at registration; the widest it takes is not', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 4 });
    expect(() => sim.addUnitType(team('fs5_r80', 0.8))).toThrow(/foot separation grid/);
    expect(() => sim.addUnitType(team('fs5_r75', 0.75))).not.toThrow();
  });

  it('a world of hulls alone leaves the foot grid empty', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const ht = sim.addUnitType(CARRIER);
    const a = sim.spawn(ht, 0, f(8.5), f(10.5), EAST);
    sim.spawn(ht, 0, f(20.5), f(10.5), EAST);
    go(sim, a, 28.5, 10.5);
    for (let tick = 0; tick < 50; tick++) {
      sim.tick();
      expect(raw(sim).sepFootN).toBe(0);
    }
  });
});

describe('pair exemption: a boarder and its carrier (GH-1360 §3.3 item 3)', () => {
  // A Namer's footprint (half length 1.22, half width 0.69): from the tail a team of r 0.45 meets it at
  // 0.53 (half the segment) + 0.69 + 0.45 = 1.67 tiles from its centre, OUTSIDE LOAD_RANGE (1.5).
  const NAMER: UnitTypeJson = { ...CARRIER, id: 'fs5_namer', mobility: { ...CARRIER.mobility, footprint: { half_length_tiles: 1.22, half_width_tiles: 0.69 } } };
  it('a team boarding a parked hull from behind walks straight in: never blocked, never steered', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const ht = sim.addUnitType(NAMER);
    const ct = sim.addUnitType(team('fs5_r45', 0.45));
    const car = sim.spawn(ht, 0, f(12.5), f(10.5), EAST);
    const rider = sim.spawn(ct, 0, f(6.5), f(10.5), EAST);
    sim.queueCommand({ kind: 'load', ids: [rider], carrier: car });
    let aboard = -1;
    for (let tick = 1; tick <= 200 && aboard < 0; tick++) {
      sim.tick();
      if (carriedBy(sim)[rider] === car) aboard = tick;
      else {
        expect(raw(sim).sepLast[rider], `tick ${tick}`).toBe(0);
        expect(sim.state.posY[rider], `tick ${tick}`).toBe(f(10.5)); // straight along the axis, no steer
      }
    }
    // 6 - 1.5 = 4.5 tiles at 0.05 a tick: within 1.5 of the centre on tick 90, seated by stepTransport that tick.
    expect(aboard).toBe(90);
    // Aboard he is no participant: the next build finds no circle, and the foot grid is not walked.
    sim.tick();
    expect(raw(sim).sepFootN).toBe(0);
  });
});

describe('pair exemption: a medic and his casualty (GH-1360 §3.3 item 3)', () => {
  const WOUNDED: UnitTypeJson = {
    id: 'fs5_wounded',
    role: 'wounded',
    hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
    mobility: { speed_tiles_s: 0.12, footprint: { half_length_tiles: 0.75, half_width_tiles: 0.75 } },
    sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
  };
  /** 400 hp / 4 men, chance 1, bleed 60 s: a 100-hp hit sheds one DOWN wounded where the squad stands. No footprint. */
  const BLEEDER: UnitTypeJson = {
    id: 'fs5_bleeder',
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 }, figures: 4, wounds: { wound_chance: 1, bleed_s: 60, type: 'fs5_wounded' } },
    mobility: { speed_tiles_s: 0.9 },
    sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  };
  const SHOOTER: UnitTypeJson = { id: 'fs5_shooter', role: 'infantry', hull: SOFT, mobility: { speed_tiles_s: 0.9 }, sensors: SENSORS };
  /** A medic whose body is a 3.5-tile hull (test-only): his nose meets an r 0.75 casualty 1.25 + 0.5 + 0.75 = 2.5 tiles
   *  from his centre, outside the 2 tiles at which he stops to treat (MEDIC_TREAT_REACH_SQ). One seat, treats in 6 s. */
  const MEDIC: UnitTypeJson = {
    id: 'fs5_medic',
    role: 'infantry',
    abilities: ['rescue'],
    hull: { hp: 200, armor: { front: 10, side: 10, rear: 10 }, transport_slots: 1, can_carry: ['wounded'] },
    mobility: { speed_tiles_s: 1, turn_rate_deg_s: 90, footprint: { half_length_tiles: 1.75, half_width_tiles: 0.5 } },
    sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
    rescue: { radius_tiles: 12, treat_s: 6, drag_speed_mult: 0.5, carry_speed_mult: 0.75 },
  };
  it('a medic walking up to a casualty nose first reaches him and treats him; it never stops at contact short of him', () => {
    const sim = new Sim({ seed: 0x7070_0004, width: 32, height: 20, capacity: 16 });
    const wt = sim.addUnitType(WOUNDED);
    const bt = sim.addUnitType(BLEEDER);
    const st = sim.addUnitType(SHOOTER);
    const mt = sim.addUnitType(MEDIC);
    const shooter = sim.spawn(st, 1, f(30.5), f(18.5), EAST);
    const squad = sim.spawn(bt, 0, f(16.5), f(10.5), EAST);
    const w = sim.entityCount;
    (sim as unknown as { applyDamage(t: number, d: Fx, by: number): void }).applyDamage(squad, fx.fromInt(100), shooter);
    expect([sim.state.woundState[w], sim.state.typeIdx[w]]).toEqual([1, wt]);
    const medic = sim.spawn(mt, 0, f(8.5), f(10.5), EAST);
    let treated = -1;
    for (let tick = 1; tick <= 400 && treated < 0; tick++) {
      sim.tick();
      if (sim.state.woundState[w] === 2) treated = tick;
    }
    // 8 tiles to the casualty, stopping at 2: 6 tiles at 0.05 a tick is 120 ticks, then 6 s (120 ticks) of treatment.
    // Without the exemption his nose meets the casualty at 2.5 tiles: B+ ends the leg there (the casualty's body covers
    // the goal), the next tick sends him again, and he is never treated.
    expect(treated).toBe(240);
    expect(dist(sim, medic, w)).toBeLessThanOrEqual(f(2));
  });
});

describe('pair exemption: a rider for the tick it unloads (GH-1360 §3.3 item 3)', () => {
  // The hull at (10.5, 10.5) facing east; its rider, an r 0.45 circle, is put down at +HALF on both axes,
  // (11, 11), 0.5 tile from the segment's nose end (11, 10.5): 0.45 inside contact. The hull is ordered
  // south-east, toward him, on the very tick he comes out.
  function unloadAndDrive(rider: boolean): { sim: Sim; car: number; man: number; after1: [Fx, Fx]; after2: [Fx, Fx] } {
    const sim = new Sim({ seed: 3, width: 32, height: 32, capacity: 8 });
    const ht = sim.addUnitType(CARRIER);
    const ct = sim.addUnitType(team('fs5_r45', 0.45));
    const car = sim.spawn(ht, 0, f(10.5), f(10.5), EAST);
    const man = sim.spawn(ct, 0, f(10.5), f(10.5), EAST);
    raw(sim).seat(car, man);
    if (rider) sim.queueCommand({ kind: 'unload', ids: [car] });
    else (sim as unknown as { debugKill(id: number): void }).debugKill(man);
    go(sim, car, 20.5, 20.5);
    sim.tick();
    const after1: [Fx, Fx] = [sim.state.posX[car], sim.state.posY[car]];
    expect(raw(sim).sepOff[man]).toBe(rider ? 1 : 0); // marked on the tick he came out
    sim.tick();
    const after2: [Fx, Fx] = [sim.state.posX[car], sim.state.posY[car]];
    return { sim, car, man, after1, after2 };
  }

  it('on the unload tick the hull drives on exactly as if he were not there; on the next it is held off him', () => {
    const control = unloadAndDrive(false);
    const live = unloadAndDrive(true);
    expect(carriedBy(live.sim)[live.man]).toBe(-1);
    expect([live.sim.state.posX[live.man], live.sim.state.posY[live.man]]).toEqual([f(11), f(11)]);
    // Tick 1: the full step, the same bytes as a world with no rider at all.
    expect(live.after1).toEqual(control.after1);
    // Tick 2: the mark was zeroed at the top of the tick, and the step toward him is refused or turned aside.
    expect(live.after2).not.toEqual(control.after2);
  });
});

describe('the new scratch is written before it is read (GH-1360 S5a-1, the snapshot contract)', () => {
  // A circle crowd: six teams converging on one point, a hull driving through them, and a carrier that puts its
  // circle rider down at tick 30 and drives off while he walks away. B is restored at each cut, every scratch row
  // (the foot grid, its count and the rider marks included) is then filled with garbage, and both run on in lockstep.
  interface Crowd {
    sim: Sim;
  }
  const TEAMS = 6;
  const HULL_ID = TEAMS;
  const CAR_ID = TEAMS + 1;
  const MAN_ID = TEAMS + 2;
  function build(): Crowd {
    const sim = new Sim({ seed: 5, width: 32, height: 32, capacity: 16 });
    const ct = sim.addUnitType(team('fs5_r45', 0.45));
    const ht = sim.addUnitType(CARRIER);
    for (let k = 0; k < TEAMS; k++) sim.spawn(ct, 0, f(6.5 + (k % 3)), f(8.5 + 2 * ((k / 3) | 0)), EAST);
    sim.spawn(ht, 0, f(16.5), f(4.5), EAST);
    const car = sim.spawn(ht, 0, f(18.5), f(12.5), EAST);
    const man = sim.spawn(ct, 0, f(18.5), f(12.5), EAST);
    raw(sim).seat(car, man);
    return { sim };
  }
  function drive(w: Crowd, t: number): void {
    if (t === 0) {
      for (let k = 0; k < TEAMS; k++) go(w.sim, k, 18.5, 10.5);
      go(w.sim, HULL_ID, 16.5, 20.5);
    }
    if (t === 30) {
      w.sim.queueCommand({ kind: 'unload', ids: [CAR_ID] });
      go(w.sim, CAR_ID, 24.5, 16.5);
    }
    if (t === 31) go(w.sim, MAN_ID, 12.5, 14.5);
  }
  it('cut before, on and after the unload tick, poisoned: hashes and encodings equal through every horizon', () => {
    const verdicts = forkWitnessSeries({ build, drive, hashEvery: 1, poison: true, Ts: [10, 29, 30, 31, 60], horizon: 80, endTick: 140 });
    expect(verdicts).toHaveLength(5);
    for (const v of verdicts) {
      const label = `T=${v.T}`;
      expect(v.roundTripEqualAtT, label).toBe(true);
      expect(v.hashDivergedAt, label).toBeNull();
      expect(v.encodingEqualAtEnd, `${label} (${v.firstDifference ?? ''})`).toBe(true);
    }
  });
  it('the crowd really is in contact: circles meet circles and the hull', () => {
    const w = build();
    let held = 0;
    for (let t = 0; t < 140; t++) {
      drive(w, t);
      w.sim.tick();
      for (let k = 0; k <= MAN_ID; k++) if (raw(w.sim).sepLast[k] === 1) held++;
    }
    expect(held).toBeGreaterThan(0);
  });
});
