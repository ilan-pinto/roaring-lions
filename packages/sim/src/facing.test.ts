import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, unitTypeFromJson, type UnitTypeJson } from './sim';
import { AIM_OFF_HEADING_MAX } from './tuning';

// GDD §5.3 facing, and the one place it is mechanical: the armour arc in
// `resolveHit`. These tests pin *when a hull is allowed to turn toward what it
// is shooting at*, which is the difference between a rifleman who aims and a
// tank whose hull points where it drives.
//
// A turret is the thing being modelled by its absence. A vehicle's hull heads
// where it drives and its gun tracks independently, so the hull must NOT swing
// onto the target — its front plate is where its survival lives. Infantry have
// no turret: the body IS the aim, and it costs them nothing, because their
// armour is the same from every angle AND soft enough that `resolveHit` never
// reads facing at all.
//
// The second thing pinned here is HOW FAR a hull that is actually walking may
// turn off its line of march to do it (`AIM_OFF_HEADING_MAX`). Aiming freely
// while moving is right for the gun and wrong for the feet: there is exactly
// one movement clip and it is a forward walk, so a body pointing 90° off its
// direction of travel moonwalks. Stationary hulls keep the free turn.

/** Isotropic and soft: exactly the shape of every infantry type on the roster.
 *  90 deg/s = 4.5 deg/tick, so a quarter turn takes 20 ticks. */
const RIFLES: UnitTypeJson = {
  id: 'f_rifles',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9, turn_rate_deg_s: 90 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
  weapons: [
    {
      id: 'rifle',
      type: 'small_arms',
      range_tiles: 10,
      effective_range_tiles: 8,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      suppression: 50,
      rof_per_min: 300,
    },
  ],
};

/** Anisotropic: a front plate worth pointing at people. Same weapon, same
 *  speed, same turn rate as RIFLES — armour is the ONLY difference, so any
 *  behavioural divergence between the two is attributable to it alone. */
const TANK: UnitTypeJson = {
  ...RIFLES,
  id: 'f_tank',
  role: 'mbt',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
};

/** Isotropic but armoured — a hypothetical, deliberately not on the roster.
 *  The obliquity bonus scales armour *inside* the front arc, so this unit's
 *  facing WOULD change its effective armour even though all three plates are
 *  equal. It must fall on the vehicle side. */
const IRON_BALL: UnitTypeJson = {
  ...RIFLES,
  id: 'f_iron_ball',
  hull: { hp: 3000, armor: { front: 300, side: 300, rear: 300 } },
};

/** Unarmed, deep, and unmissable: something to shoot at that shoots back at
 *  nothing and refuses to die inside the test window. */
const POST: UnitTypeJson = {
  id: 'f_post',
  role: 'infantry',
  hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1.2 },
  weapons: [],
};

const TURN = 65536;

/** Signed distance in Q16.16 turns between two headings, as a fraction. */
function turnsApart(a: number, b: number): number {
  return Math.abs(fx.angleDiff(a, b)) / TURN;
}

/**
 * Walk `shooter` east along y=16 while an enemy stands due north of its start.
 * Returns the shooter's facing, the bearing to the enemy, and its heading of
 * travel, after `ticks`.
 */
function walkAndShoot(shooterJson: UnitTypeJson, ticks: number, moving = true) {
  const sim = new Sim({ seed: 9, width: 48, height: 32, capacity: 16 });
  const st = sim.addUnitType(shooterJson);
  const pt = sim.addUnitType(POST);
  const shooter = sim.spawn(st, 0, fx.fromInt(4), fx.fromInt(16));
  const post = sim.spawn(pt, 1, fx.fromInt(4), fx.fromInt(10));
  if (moving) {
    sim.queueCommand({ kind: 'move', ids: [shooter], x: fx.fromInt(40), y: fx.fromInt(16) });
  }
  let firedWhileMoving = false;
  for (let t = 0; t < ticks; t++) {
    const events = sim.tick();
    if (
      sim.state.moving[shooter] === (moving ? 1 : 0) &&
      events.some((e) => e.kind === 'fire' && e.shooter === shooter)
    ) {
      firedWhileMoving = true;
    }
  }
  const bearing = fx.atan2(
    fx.sub(sim.state.posY[post], sim.state.posY[shooter]),
    fx.sub(sim.state.posX[post], sim.state.posX[shooter])
  );
  return {
    sim,
    shooter,
    facing: sim.state.facing[shooter],
    bearing,
    heading: 0, // due east; the move order is straight along +x
    moving: sim.state.moving[shooter],
    target: sim.state.curTarget[shooter],
    firedWhileMoving,
  };
}

describe('who is allowed to aim with the whole body', () => {
  // All four quadrants of (soft|hard) x (isotropic|anisotropic). The licence is
  // derived from the armour numbers so that a unit added years from now lands
  // on the correct side without anyone remembering this rule exists.
  const armour = (front: number, side: number, rear: number): UnitTypeJson => ({
    ...RIFLES,
    id: `q_${front}_${side}_${rear}`,
    hull: { hp: 400, armor: { front, side, rear } },
  });

  it('is granted only to soft, isotropic hulls', () => {
    // Soft + isotropic: every infantry type on the roster.
    expect(unitTypeFromJson(armour(10, 10, 10)).bodyAimed).toBe(true);
    expect(unitTypeFromJson(armour(0, 0, 0)).bodyAimed).toBe(true);
  });

  it('is refused to anything with a front worth pointing at', () => {
    // Hard + anisotropic: every tank, IFV and APC.
    expect(unitTypeFromJson(armour(700, 300, 150)).bodyAimed).toBe(false);
    // Soft + anisotropic: technicals and jeeps. `resolveHit` returns before the
    // arc for these, so their facing is mechanically inert too -- but they are
    // vehicles, the hull drives where it points and the gun traverses, and the
    // asymmetric plate is the data saying so. Refused on that reading.
    expect(unitTypeFromJson(armour(15, 10, 10)).bodyAimed).toBe(false);
    // Hard + isotropic: nothing on the roster, and the case that makes the
    // `isSoft` half of the rule load-bearing rather than decorative. Equal
    // plates, but the obliquity bonus inside the front arc still prices the
    // angle, so facing would change what a round has to defeat.
    expect(unitTypeFromJson(armour(300, 300, 300)).bodyAimed).toBe(false);
  });

  it('tracks the soft threshold rather than a hand-picked number', () => {
    // SOFT_ARMOR_LIMIT is 30 mm. Either side of it, isotropy held constant.
    expect(unitTypeFromJson(armour(29, 29, 29)).bodyAimed).toBe(true);
    expect(unitTypeFromJson(armour(30, 30, 30)).bodyAimed).toBe(false);
  });
});

describe('a moving unit that is firing (GDD §5.3)', () => {
  it('turns a body-aimed hull toward the target, as far as the walk allows', () => {
    const r = walkAndShoot(RIFLES, 90);
    // The scenario is the point: it must really be moving and really firing.
    expect(r.moving).toBe(1);
    expect(r.target).toBeGreaterThanOrEqual(0);
    expect(r.firedWhileMoving).toBe(true);
    // The enemy starts abeam and ends up behind — always further off the line
    // of march than a walking hull may point. So the hull turns the whole
    // allowance and stops there: onto the enemy's side of the road, not onto
    // the enemy. Aiming the rest of the way is what slid the feet.
    const off = fx.angleDiff(r.facing, r.heading);
    expect(Math.abs(off)).toBe(AIM_OFF_HEADING_MAX);
    expect(Math.sign(off)).toBe(Math.sign(fx.angleDiff(r.bearing, r.heading)));
    // Closer to the enemy than the road is, so it is aiming and not merely
    // walking — and not ON the enemy, which is the bound doing its job.
    expect(turnsApart(r.facing, r.bearing)).toBeLessThan(turnsApart(r.heading, r.bearing));
    expect(turnsApart(r.facing, r.bearing)).toBeGreaterThan(0.02);
  });

  it('leaves a turreted hull pointing where it drives — the armour arc is not the gun', () => {
    const r = walkAndShoot(TANK, 90);
    expect(r.moving).toBe(1);
    expect(r.target).toBeGreaterThanOrEqual(0);
    expect(r.firedWhileMoving).toBe(true);
    // Hull on the line of march. The turret tracks the target; facing does not.
    expect(turnsApart(r.facing, r.heading)).toBeLessThan(0.02);
    expect(turnsApart(r.facing, r.bearing)).toBeGreaterThan(0.1);
  });

  it('keeps an isotropic-but-armoured hull on the line of march too', () => {
    // Equal plates all round, but hard enough that `resolveHit` reads facing
    // and the obliquity bonus makes the angle worth something. Isotropy alone
    // is not the licence; not reading facing at all is.
    const r = walkAndShoot(IRON_BALL, 90);
    expect(r.moving).toBe(1);
    expect(r.firedWhileMoving).toBe(true);
    expect(turnsApart(r.facing, r.heading)).toBeLessThan(0.02);
  });
});

describe('the aim survives the rest of the tick', () => {
  it('holds the target across many moving ticks — stepMovement does not steer it back', () => {
    // The gate in stepCombat is only half the fix, and on its own it is worth
    // exactly nothing: stepMovement runs later in the same tick and turns every
    // mover toward its heading at the same capped rate, so it cancels the aim
    // to the bit. Changing only the three combat gates leaves this scenario
    // byte-identical to no change at all. This test is what stops that half
    // from being mistaken for the whole.
    const sim = new Sim({ seed: 9, width: 48, height: 32, capacity: 16 });
    const st = sim.addUnitType(RIFLES);
    const pt = sim.addUnitType(POST);
    const shooter = sim.spawn(st, 0, fx.fromInt(4), fx.fromInt(16));
    const post = sim.spawn(pt, 1, fx.fromInt(4), fx.fromInt(10));
    sim.queueCommand({ kind: 'move', ids: [shooter], x: fx.fromInt(40), y: fx.fromInt(16) });
    let nearest = 1;
    let sampled = 0;
    for (let t = 0; t < 160; t++) {
      sim.tick();
      if (t < 90) continue; // let detection land and the hull come round
      expect(sim.state.moving[shooter]).toBe(1);
      const bearing = fx.atan2(
        fx.sub(sim.state.posY[post], sim.state.posY[shooter]),
        fx.sub(sim.state.posX[post], sim.state.posX[shooter])
      );
      // Held at the full allowance, toward the enemy, on every sampled tick.
      // Steered back would read 0 here; oscillating would read anything else.
      const off = fx.angleDiff(sim.state.facing[shooter], 0);
      expect(off).toBe(-AIM_OFF_HEADING_MAX); // the enemy is off to the left
      expect(Math.sign(fx.angleDiff(bearing, 0))).toBe(-1);
      nearest = Math.min(nearest, turnsApart(sim.state.facing[shooter], 0));
      sampled++;
    }
    expect(sampled).toBe(70);
    // Never once collapses back onto the line of march.
    expect(nearest).toBeGreaterThan(0.1);
  });
});

describe('how far a walking hull may aim off its line of march', () => {
  // The bound exists for the ANIMATION, and it is the whole difference between
  // "advancing while covering that direction" and moonwalking. One movement
  // clip, and it is a forward walk.
  it('never points further off the direction of travel than the cap, and uses all of it', () => {
    // Straight east the whole way, so the heading is exactly 0 every tick and
    // the deviation needs no interpretation. The enemy starts ahead-left,
    // inside the cap, and slides abeam as the shooter walks past it — one run,
    // both regimes, and the test fails if it does not see both.
    const sim = new Sim({ seed: 11, width: 48, height: 32, capacity: 16 });
    const st = sim.addUnitType(RIFLES);
    const pt = sim.addUnitType(POST);
    const shooter = sim.spawn(st, 0, fx.fromInt(4), fx.fromInt(16));
    const post = sim.spawn(pt, 1, fx.fromInt(18), fx.fromInt(12));
    sim.queueCommand({ kind: 'move', ids: [shooter], x: fx.fromInt(40), y: fx.fromInt(16) });
    let inside = 0;
    let outside = 0;
    let worstOff = 0;
    let worstInsideMiss = 0;
    let held = 0; // consecutive ticks on the same contact
    for (let t = 0; t < 300; t++) {
      sim.tick();
      expect(sim.state.moving[shooter]).toBe(1);
      const bearing = fx.atan2(
        fx.sub(sim.state.posY[post], sim.state.posY[shooter]),
        fx.sub(sim.state.posX[post], sim.state.posX[shooter])
      );
      const off = fx.angleDiff(sim.state.facing[shooter], 0);
      // THE guard. Holds on every tick of the run, acquired or not.
      worstOff = Math.max(worstOff, Math.abs(off));
      held = sim.state.curTarget[shooter] < 0 ? 0 : held + 1;
      // 4.5 deg/tick: a hull just handed a contact is still swinging onto it,
      // and that lag is the turn rate, not the bound. Let it arrive first.
      if (held < 20) continue;
      const want = fx.angleDiff(bearing, 0);
      if (Math.abs(want) < AIM_OFF_HEADING_MAX - 1000) {
        // Target inside the cap: aimed at it, exactly as before the bound.
        inside++;
        worstInsideMiss = Math.max(worstInsideMiss, turnsApart(sim.state.facing[shooter], bearing));
      } else if (Math.abs(want) > AIM_OFF_HEADING_MAX + 1000) {
        // Target outside it: pinned at the edge, still turned the right way.
        outside++;
        expect(off).toBe(-AIM_OFF_HEADING_MAX);
      }
    }
    expect(worstOff).toBeLessThanOrEqual(AIM_OFF_HEADING_MAX);
    expect(inside).toBeGreaterThan(20);
    expect(outside).toBeGreaterThan(20);
    expect(worstInsideMiss).toBeLessThan(0.02);
  });

  it('does not bound a hull that has stopped walking to fight', () => {
    // An attack-mover halts on contact (`isEffectivelyMoving`), so `moving` is
    // 1 and the feet are still. Nothing to contradict: it turns the whole way
    // onto the target, past the walking cap.
    const sim = new Sim({ seed: 11, width: 48, height: 32, capacity: 16 });
    const st = sim.addUnitType(RIFLES);
    const pt = sim.addUnitType(POST);
    const shooter = sim.spawn(st, 0, fx.fromInt(4), fx.fromInt(16));
    const post = sim.spawn(pt, 1, fx.fromInt(4), fx.fromInt(10));
    sim.queueCommand({ kind: 'attackMove', ids: [shooter], x: fx.fromInt(40), y: fx.fromInt(16) });
    let haltedAt = -1;
    for (let t = 0; t < 120; t++) {
      sim.tick();
      if (t === 60) haltedAt = sim.state.posX[shooter];
    }
    expect(sim.state.moving[shooter]).toBe(1);
    expect(sim.state.curTarget[shooter]).toBeGreaterThanOrEqual(0);
    expect(sim.state.posX[shooter]).toBe(haltedAt); // stopped, under a move order
    const bearing = fx.atan2(
      fx.sub(sim.state.posY[post], sim.state.posY[shooter]),
      fx.sub(sim.state.posX[post], sim.state.posX[shooter])
    );
    expect(turnsApart(sim.state.facing[shooter], bearing)).toBeLessThan(0.02);
    // Well past what a walking hull is allowed — the enemy is abeam.
    expect(Math.abs(fx.angleDiff(sim.state.facing[shooter], 0))).toBeGreaterThan(AIM_OFF_HEADING_MAX);
  });
});

describe('a stationary unit that is firing', () => {
  it('turns onto the target whatever its armour — unchanged behaviour', () => {
    for (const json of [RIFLES, TANK, IRON_BALL]) {
      const r = walkAndShoot(json, 90, false);
      expect(r.moving).toBe(0);
      expect(r.target).toBeGreaterThanOrEqual(0);
      expect(turnsApart(r.facing, r.bearing)).toBeLessThan(0.02);
    }
  });

  it('turns the whole way round for a target behind it — no cap when halted', () => {
    // Dead astern: half a turn, which is four times what a walking hull may
    // do. A halted unit has no walk cycle to disagree with, and this is the
    // case the original complaint was about.
    const sim = new Sim({ seed: 5, width: 48, height: 32, capacity: 8 });
    const st = sim.addUnitType(RIFLES);
    const pt = sim.addUnitType(POST);
    const shooter = sim.spawn(st, 0, fx.fromInt(20), fx.fromInt(16));
    sim.spawn(pt, 1, fx.fromInt(14), fx.fromInt(16));
    for (let t = 0; t < 90; t++) sim.tick();
    expect(sim.state.moving[shooter]).toBe(0);
    expect(sim.state.curTarget[shooter]).toBeGreaterThanOrEqual(0);
    expect(turnsApart(sim.state.facing[shooter], 32768)).toBeLessThan(0.02);
  });
});

describe('a moving unit with nothing to shoot at', () => {
  it('faces the direction of travel', () => {
    const sim = new Sim({ seed: 3, width: 48, height: 32, capacity: 8 });
    const t = sim.addUnitType(RIFLES);
    const id = sim.spawn(t, 0, fx.fromInt(4), fx.fromInt(16));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(4), y: fx.fromInt(28) });
    for (let i = 0; i < 40; i++) sim.tick();
    // Moving +y with no enemy anywhere: a quarter turn, as always.
    expect(turnsApart(sim.state.facing[id], 16384)).toBeLessThan(0.02);
  });
});
