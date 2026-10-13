import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { BRACE_NONE, Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';

// Where a routed unit runs (GDD 5.5a, "away from fire"), GH-291.
//
// startRout picks a direction in this order: away from the nearest enemy its
// side knows about; for a civilian, away from the nearest combatant on the
// ground; otherwise away from where the last HOSTILE suppression came from;
// and with none of those, it holds where it is. Before GH-291 the last two
// were one constant, -x, and every backtest puts side 1 in the east -- so a
// unit pinned by fire it could not see ran west, into the shooter's sight.
//
// Both fixtures carry `role: 'infantry'`. Without it a type derives as wheeled
// and never braces (#402), and the shipped case this pins, a `militia_cell`
// outranged by an `inf_squad`, does: the target kneels while idle and gets up
// (KNEEL_RISE_TICKS) before it flees, and the shooter fires only from a knee.

/** Sight 8, range 8: sees and reaches the target, eight tiles off. */
const SHOOTER: UnitTypeJson = {
  id: 'r_shooter',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'rifle',
      type: 'small_arms',
      range_tiles: 8,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      suppression: 50,
      rof_per_min: 300,
    },
  ],
};

/** Sight 7: cannot see the shooter. Soft, and tough enough to live to rout. */
const TARGET: UnitTypeJson = {
  id: 'r_target',
  role: 'infantry',
  hull: { hp: 6000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 7, signature: 0.6 },
  weapons: [
    {
      id: 'rifle',
      type: 'small_arms',
      range_tiles: 7,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      suppression: 50,
      rof_per_min: 300,
    },
  ],
};

/** Unarmed and soft: a body to stand somewhere, and a civilian. */
const BODY: UnitTypeJson = {
  id: 'r_body',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 7, signature: 0.6 },
  weapons: [],
};

const SIXTY_S = 60 * TICKS_PER_SECOND;
const FOUR_S = 4 * TICKS_PER_SECOND;

interface Duel {
  routTick: number;
  xAtRout: number;
  xAfter: number;
  /** Side `targetSide` held a contact on the shooter before the rout. */
  sawBeforeRout: boolean;
  /** Side `targetSide` identified the shooter at any point in 60 s. */
  identified: boolean;
  braceAfter: number;
}

/** The E5 probe's layout: an outranged, blind target eight tiles from a rifle. */
function duel(shooterSide: number, shooterX: number, targetX: number): Duel {
  const sim = new Sim({ seed: 0x291, width: 32, height: 16, capacity: 8 });
  const shooterType = sim.addUnitType(SHOOTER);
  const targetType = sim.addUnitType(TARGET);
  const targetSide = 1 - shooterSide;
  const shooter = sim.spawn(shooterType, shooterSide, fx.from(shooterX), fx.from(8.5));
  const target = sim.spawn(targetType, targetSide, fx.from(targetX), fx.from(8.5));

  let routTick = -1;
  let sawBeforeRout = false;
  let identified = false;
  let xAtRout = 0;
  let xAfter = 0;
  let braceAfter = -1;
  for (let t = 0; t < SIXTY_S; t++) {
    for (const e of sim.tick()) {
      if (e.kind === 'contact' && e.side === targetSide && e.target === shooter) {
        if (routTick < 0 && e.level !== 'lost') sawBeforeRout = true;
        if (e.level === 'identified') identified = true;
      }
      if (e.kind === 'routed' && e.entity === target && routTick < 0) {
        routTick = t;
        xAtRout = fx.toNumber(sim.state.posX[target]);
      }
    }
    if (routTick >= 0 && t === routTick + FOUR_S) {
      xAfter = fx.toNumber(sim.state.posX[target]);
      braceAfter = sim.state.brace[target];
    }
  }
  return { routTick, xAtRout, xAfter, sawBeforeRout, identified, braceAfter };
}

/** Run `ticks`, calling `pin` before each one. Returns the routed tick, or -1. */
function pinUntilRout(sim: Sim, id: number, pin: () => void, ticks: number): number {
  for (let t = 0; t < ticks; t++) {
    pin();
    for (const e of sim.tick()) if (e.kind === 'routed' && e.entity === id) return t;
  }
  return -1;
}

describe('rout direction (GH-291)', () => {
  it('outranged and blind, it flees away from the fire', () => {
    const d = duel(0, 4.5, 12.5);
    expect(d.routTick).toBeGreaterThan(0);
    expect(d.routTick).toBeLessThan(SIXTY_S - FOUR_S);
    expect(d.sawBeforeRout).toBe(false);
    expect(d.xAfter).toBeGreaterThan(d.xAtRout + 1);
    expect(d.braceAfter).toBe(BRACE_NONE);
    // The E5 symptom: running west put the shooter inside its own sight 7.
    expect(d.identified).toBe(false);
  });

  it('its mirror flees -x: the direction comes from the source, not a constant', () => {
    const d = duel(0, 27.5, 19.5);
    expect(d.routTick).toBeGreaterThan(0);
    expect(d.routTick).toBeLessThan(SIXTY_S - FOUR_S);
    expect(d.sawBeforeRout).toBe(false);
    expect(d.xAfter).toBeLessThan(d.xAtRout - 1);
    expect(d.braceAfter).toBe(BRACE_NONE);
    expect(d.identified).toBe(false);
  });

  it('the side mirror: a side-0 target shot at from the west by side 1 flees +x', () => {
    const d = duel(1, 4.5, 12.5);
    expect(d.routTick).toBeGreaterThan(0);
    expect(d.routTick).toBeLessThan(SIXTY_S - FOUR_S);
    expect(d.sawBeforeRout).toBe(false);
    expect(d.xAfter).toBeGreaterThan(d.xAtRout + 1);
    expect(d.braceAfter).toBe(BRACE_NONE);
    expect(d.identified).toBe(false);
  });

  it('no source, no threat: it holds', () => {
    const sim = new Sim({ seed: 0x291, width: 32, height: 16, capacity: 8 });
    const u = sim.spawn(sim.addUnitType(TARGET), 1, fx.from(12.5), fx.from(8.5));
    const routTick = pinUntilRout(sim, u, () => sim.debugSuppress(u, fx.from(2)), SIXTY_S);
    expect(routTick).toBeGreaterThan(0);
    expect(sim.state.routed[u]).toBe(1);
    expect(sim.state.suppFromSet[u]).toBe(0);
    const x = sim.state.posX[u];
    const y = sim.state.posY[u];
    for (let t = 0; t < FOUR_S; t++) sim.tick();
    expect(sim.state.posX[u]).toBe(x);
    expect(sim.state.posY[u]).toBe(y);
    expect(sim.state.moving[u]).toBe(0);
    // Holding upright: the routed rule outranks "a man who has stopped takes
    // a knee" (ruled 6 Oct, Stage 4 "For the lead" item 2).
    expect(sim.state.brace[u]).toBe(BRACE_NONE);
  });

  it('a same-side blast does not steer it', () => {
    const sim = new Sim({ seed: 0x291, width: 32, height: 16, capacity: 8 });
    const tt = sim.addUnitType(TARGET);
    const u = sim.spawn(tt, 1, fx.from(12.5), fx.from(8.5));
    const friend = sim.spawn(sim.addUnitType(BODY), 1, fx.from(16.5), fx.from(8.5));
    // A bare splash on the target, credited to a friend four tiles east. The
    // amount is applied every tick, so the test does not lean on how hard a
    // single splash suppresses.
    const blast = (): void =>
      sim.debugSplash(sim.state.posX[u], sim.state.posY[u], fx.from(1), 0, fx.fromInt(1000), friend, -1);
    const routTick = pinUntilRout(sim, u, blast, SIXTY_S);
    expect(routTick).toBeGreaterThan(0);
    expect(sim.state.suppFromSet[u]).toBe(0);
    const x = sim.state.posX[u];
    const y = sim.state.posY[u];
    for (let t = 0; t < FOUR_S; t++) sim.tick();
    expect(sim.state.posX[u]).toBe(x);
    expect(sim.state.posY[u]).toBe(y);
    expect(sim.state.moving[u]).toBe(0);
  });

  it('a hostile blast does steer it -- the control for the test above', () => {
    // Same layout, the blast credited to a side-0 body instead. Without this,
    // the hold above would pass on a build that never records a source at all.
    const sim = new Sim({ seed: 0x291, width: 32, height: 16, capacity: 8 });
    const tt = sim.addUnitType(TARGET);
    const u = sim.spawn(tt, 1, fx.from(12.5), fx.from(8.5));
    const foe = sim.spawn(sim.addUnitType(BODY), 0, fx.from(16.5), fx.from(8.5));
    const blast = (): void =>
      sim.debugSplash(sim.state.posX[u], sim.state.posY[u], fx.from(1), 0, fx.fromInt(1000), foe, -1);
    const routTick = pinUntilRout(sim, u, blast, SIXTY_S);
    expect(routTick).toBeGreaterThan(0);
    expect(sim.state.suppFromSet[u]).toBe(1);
    const x = fx.toNumber(sim.state.posX[u]);
    for (let t = 0; t < FOUR_S; t++) sim.tick();
    expect(fx.toNumber(sim.state.posX[u])).toBeLessThan(x - 1);
  });

  it('a civilian flees the nearest combatant', () => {
    const sim = new Sim({ seed: 0x291, width: 32, height: 16, capacity: 8 });
    const body = sim.addUnitType(BODY);
    const civ = sim.spawn(body, 2, fx.from(12.5), fx.from(8.5));
    sim.spawn(body, 0, fx.from(15.5), fx.from(8.5));
    const routTick = pinUntilRout(sim, civ, () => sim.debugSuppress(civ, fx.from(2)), SIXTY_S);
    expect(routTick).toBeGreaterThan(0);
    const x = fx.toNumber(sim.state.posX[civ]);
    for (let t = 0; t < FOUR_S; t++) sim.tick();
    expect(fx.toNumber(sim.state.posX[civ])).toBeLessThan(x - 1);
  });
});
