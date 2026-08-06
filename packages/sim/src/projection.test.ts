import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

const RIFLES: UnitTypeJson = {
  id: 'p_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.6, penetration: 8, damage: 15, suppression: 40, rof_per_min: 300 },
  ],
};

function world(): { sim: Sim; inf: number } {
  const sim = new Sim({ seed: 7, width: 48, height: 48, capacity: 16 });
  const inf = sim.addUnitType(RIFLES);
  return { sim, inf };
}

/** Run n ticks, returning every event produced. */
function run(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

const MG_JEEP: UnitTypeJson = {
  id: 'p_mg',
  name: 'MG Jeep',
  role: 'technical',
  hull: { hp: 300, armor: { front: 14, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.8 },
  weapons: [
    { id: 'dshk', type: 'hmg', range_tiles: 9, effective_range_tiles: 7, accuracy: 0.5, penetration: 25, damage: 40, suppression: 55, rof_per_min: 500 },
  ],
};

const TANK: UnitTypeJson = {
  id: 'p_tank',
  name: 'Tank',
  role: 'mbt',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1, sight_tiles: 14, signature: 1 },
  weapons: [
    { id: 'main', type: 'apfsds', range_tiles: 20, effective_range_tiles: 16, accuracy: 0.8, penetration: 900, damage: 500, rof_per_min: 8 },
    { id: 'coax', type: 'hmg', range_tiles: 9, effective_range_tiles: 7, accuracy: 0.5, penetration: 20, damage: 35, suppression: 60, rof_per_min: 500 },
  ],
};

// Fixture note: the tank's main gun does 500 damage — one shot kills a
// RIFLES squad (400 hp) outright. Because stepDetection runs before
// stepCombat in the same tick(), identification and the shooter's first
// shot land on the same tick for units already stationary in range, so
// there is no ticks-elapsed window in which to catch the target identified
// but not yet fired upon. tankWorld's infantry only exists to be *shot at*
// in these tests (the weaponId/hurts assertions do not depend on hp), so it
// gets enough hp to survive the exchange instead.
const TOUGH_RIFLES: UnitTypeJson = {
  ...RIFLES,
  id: 'p_inf_tough',
  hull: { ...RIFLES.hull, hp: 5000 },
};

function tankWorld(): { sim: Sim; inf: number; tank: number; jeep: number } {
  const sim = new Sim({ seed: 11, width: 64, height: 64, capacity: 16 });
  const inf = sim.addUnitType(TOUGH_RIFLES);
  const tank = sim.addUnitType(TANK);
  const jeep = sim.addUnitType(MG_JEEP);
  return { sim, inf, tank, jeep };
}

describe('hitFactors extraction', () => {
  it('leaves the factors on the fire event unchanged', () => {
    // A pure extraction must not move a single number. Two stationary squads
    // in the open: the first fire event's factors are fully determined.
    const { sim, inf } = world();
    sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    const events = run(sim, 20 * TICKS_PER_SECOND);
    const fire = events.find((e) => e.kind === 'fire');
    expect(fire).toBeDefined();
    if (fire?.kind !== 'fire') throw new Error('no fire event');

    // accuracy 0.6, no veterancy, so accuracy is exactly 0.6.
    expect(fx.toNumber(fire.breakdown.accuracy)).toBeCloseTo(0.6, 3);
    // Neither unit moves and neither is suppressed at first contact.
    expect(fx.toNumber(fire.breakdown.motionMod)).toBe(1);
    expect(fx.toNumber(fire.breakdown.stanceMod)).toBe(1);
    // pHit is the product of all six factors.
    const b = fire.breakdown;
    const product =
      fx.toNumber(b.accuracy) *
      fx.toNumber(b.rangeFalloff) *
      fx.toNumber(b.coverMod) *
      fx.toNumber(b.motionMod) *
      fx.toNumber(b.stanceMod) *
      fx.toNumber(b.suppressionMod);
    expect(fx.toNumber(fire.pHit)).toBeCloseTo(product, 2);
  });
});

describe('projectHit', () => {
  it('agrees exactly with the shot the sim actually takes', () => {
    // The whole point of the feature: the projection is the sim's own number,
    // not a second implementation that can drift.
    //
    // Fixture note: two units already stationary within weapon range only
    // have one changing condition — contact confidence — and stepDetection
    // runs before stepCombat inside the same tick(), so the tick where
    // confidence crosses IDENTIFIED_AT is also the tick combat fires on. A
    // projectHit taken *before* tick() always reads the pre-update (stale)
    // confidence on exactly that tick and reports 'unidentified' while the
    // sim fires — a mismatch that has nothing to do with projectHit being
    // wrong. So the shooter starts out of weapon range (distance 10, inside
    // the 12-tile sight so it still gets identified), waits out
    // identification while range keeps it from firing, then closes in:
    // identification is already settled by the time range is the last
    // condition to fall, matching what stepCombat itself observes.
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(4.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    run(sim, 260);
    sim.queueCommand({ kind: 'move', ids: [shooter], x: fx.from(10.5), y: fx.from(10.5) });

    let projectedAtFire: number | null = null;
    let firedPHit: number | null = null;
    for (let i = 0; i < 20 * TICKS_PER_SECOND && firedPHit === null; i++) {
      const before = sim.projectHit(shooter, target);
      const events = sim.tick();
      const fire = events.find((e) => e.kind === 'fire' && e.shooter === shooter);
      if (fire?.kind === 'fire') {
        if (before.kind !== 'shot') throw new Error(`projected ${before.kind} but the sim fired`);
        projectedAtFire = before.pHit;
        firedPHit = fire.pHit;
      }
    }
    expect(firedPHit).not.toBeNull();
    expect(projectedAtFire).toBe(firedPHit);
  });

  it('does not advance the RNG', () => {
    // A hover must not change the game. If projectHit rolls, the state hash
    // becomes a function of mouse position and every replay desyncs.
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    run(sim, 5 * TICKS_PER_SECOND);
    const before = sim.hash();
    for (let i = 0; i < 1000; i++) sim.projectHit(shooter, target);
    expect(sim.hash()).toBe(before);
  });

  it('reports no solution beyond weapon range', () => {
    // Fixture note: the original spacing (distance ~38) put the target
    // outside the 12-tile sight range too, so it was never identified and
    // projectHit reported 'unidentified' forever — it never got to exercise
    // the range check this test is named for. 8.5 tiles is inside sight (12)
    // so identification still completes, but outside the 8-tile weapon range
    // so the range check is what actually produces 'noSolution'. Run long
    // enough (identification lands ~tick 146 at this spacing) to guarantee
    // identification has completed.
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(2.5), fx.from(2.5));
    const target = sim.spawn(inf, 1, fx.from(11.0), fx.from(2.5));
    run(sim, 8 * TICKS_PER_SECOND);
    expect(sim.projectHit(shooter, target).kind).toBe('noSolution');
  });

  it('reports unidentified before the target is identified', () => {
    // Tick zero: nothing has been detected yet.
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    expect(sim.projectHit(shooter, target).kind).toBe('unidentified');
  });

  it('picks the weapon with the better chance, not the first one', () => {
    // At 5 tiles both the tank's weapons reach. The main gun is accuracy 0.8
    // against the coax's 0.5, so the projection must report the main gun.
    const { sim, inf, tank } = tankWorld();
    const shooter = sim.spawn(tank, 0, fx.from(10.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(15.5), fx.from(10.5));
    run(sim, 8 * TICKS_PER_SECOND);
    const p = sim.projectHit(shooter, target);
    expect(p.kind).toBe('shot');
    if (p.kind !== 'shot') throw new Error('expected a shot');
    expect(p.weaponId).toBe('main');
  });

  it('flags a machine gun as unable to hurt a tank, but fine against infantry', () => {
    // The jeep carries ONLY an hmg, penetration 25. Against the tank's
    // armorSide 300 the heuristic threshold is 300 >> 2 = 75, so it cannot
    // hurt it. A shooter with a main gun would mask this, because projectHit
    // would report the main gun instead.
    const { sim, inf, tank, jeep } = tankWorld();
    const gunner = sim.spawn(jeep, 0, fx.from(10.5), fx.from(10.5));
    const armour = sim.spawn(tank, 1, fx.from(14.5), fx.from(10.5));
    // Fixture note: the tank's main gun one-shots the jeep (300 hp) the
    // moment the tank identifies it — same same-tick identification/combat
    // coincidence as above. This test is about the jeep's own hurts
    // heuristic, not mutual combat survival, so the tank's return fire is
    // disabled the same way the firepower-killed test disables a shooter.
    sim.state.firepowerKilled[armour] = 1;
    run(sim, 8 * TICKS_PER_SECOND);

    const vsArmour = sim.projectHit(gunner, armour);
    expect(vsArmour.kind).toBe('shot');
    if (vsArmour.kind !== 'shot') throw new Error('expected a shot');
    expect(vsArmour.weaponId).toBe('dshk');
    expect(vsArmour.hurts).toBe(false);

    // Same gun, soft target: infantry always qualify.
    const gunner2 = sim.spawn(jeep, 0, fx.from(30.5), fx.from(30.5));
    const soft = sim.spawn(inf, 1, fx.from(33.5), fx.from(30.5));
    run(sim, 8 * TICKS_PER_SECOND);
    const vsSoft = sim.projectHit(gunner2, soft);
    expect(vsSoft.kind).toBe('shot');
    if (vsSoft.kind !== 'shot') throw new Error('expected a shot');
    expect(vsSoft.hurts).toBe(true);
  });

  it('reports no solution for a firepower-killed shooter', () => {
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    run(sim, 8 * TICKS_PER_SECOND);
    expect(sim.projectHit(shooter, target).kind).toBe('shot');
    sim.state.firepowerKilled[shooter] = 1;
    expect(sim.projectHit(shooter, target).kind).toBe('noSolution');
  });
});
