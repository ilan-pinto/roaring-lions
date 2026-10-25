import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson, type WeaponJson } from './sim';

// E6 (GH-274) spec 3.2: a swarm does not pin and does not rout, and its dive is not
// held back by fire. (`suppression_resistance` 1.0 only halves the suppression taken, so
// before this a swarm under rifle fire pinned, routed away and stopped diving.)

const DIVE: WeaponJson = {
  id: 'bomblet_dive', type: 'atgm', range_tiles: 1.5, effective_range_tiles: 1.5, accuracy: 1,
  penetration: 160, damage: 90, splash_tiles: 0.5, suppression: 60, rof_per_min: 12,
  can_target: ['ground'], collateral_risk: 0.3,
};
const SWARM: UnitTypeJson = {
  id: 'drone_swarm', role: 'drone',
  hull: { hp: 180, armor: { front: 5, side: 5, rear: 5 }, crew: 0, suppression_resistance: 1 },
  mobility: { speed_tiles_s: 2.6, domain: 'air' },
  sensors: { optics: 1.2, sight_tiles: 10, signature: 0.6 },
  weapons: [DIVE],
  swarm: { count: 12, member_hp: 15, spread_tiles: 3 },
};
/** The same body with no swarm block: the control that DOES pin. */
const DRONE: UnitTypeJson = { ...SWARM, id: 'plain_drone', swarm: undefined, hull: { ...SWARM.hull, hp: 30000 } };
const MAN: UnitTypeJson = {
  id: 'man', role: 'infantry',
  hull: { hp: 30000, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 0.01 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};
/** Fire that misses a great deal and suppresses a great deal: 1 damage, poor accuracy, high suppression. */
const SUPPRESSOR: WeaponJson = {
  id: 'lmg', type: 'small_arms', range_tiles: 9, effective_range_tiles: 9, accuracy: 0.1,
  penetration: 5, damage: 1, suppression: 400, rof_per_min: 600, can_target: ['air'], collateral_risk: 0,
};
const GUNNER: UnitTypeJson = {
  id: 'gunner', role: 'infantry',
  hull: { hp: 30000, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 0.01 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.1 },
  weapons: [SUPPRESSOR],
};

const X = (n: number) => fx.from(n);
function world(victim: UnitTypeJson) {
  const sim = new Sim({ seed: 11, width: 32, height: 16, capacity: 8 });
  const v = sim.addUnitType(victim);
  const g = sim.addUnitType(GUNNER);
  const man = sim.addUnitType(MAN);
  return { sim, v, g, man };
}

describe('E6 swarm: no pin, no rout (spec 3.2)', () => {
  it('a plain drone of the same body is pinned and routed by this fire: the control is not vacuous', () => {
    const { sim, v, g } = world(DRONE);
    const d = sim.spawn(v, 1, X(12.5), X(8.5));
    sim.spawn(g, 0, X(6.5), X(8.5));
    let pinned = false;
    let routed = false;
    for (let t = 0; t < 400; t++) {
      sim.identifyTo(0, d);
      sim.tick();
      pinned ||= sim.state.pinned[d] === 1;
      routed ||= sim.state.routed[d] === 1;
    }
    expect(pinned).toBe(true);
    expect(routed).toBe(true);
  });

  it('a swarm under the same fire takes no suppression, never pins and never routs', () => {
    const { sim, v, g } = world(SWARM);
    const s = sim.spawn(v, 1, X(12.5), X(8.5));
    sim.spawn(g, 0, X(6.5), X(8.5));
    let shots = 0;
    for (let t = 0; t < 400 && sim.state.alive[s] === 1; t++) {
      sim.identifyTo(0, s);
      for (const e of sim.tick()) if (e.kind === 'fire' && e.target === s) shots++;
      expect(sim.state.suppression[s]).toBe(0);
      expect(sim.state.pinned[s]).toBe(0);
      expect(sim.state.routed[s]).toBe(0);
    }
    expect(shots).toBeGreaterThan(50); // it was shot at, a lot
  });

  it('the dive is not held back by fire: a swarm under the same fire still dives', () => {
    const { sim, v, g, man } = world(SWARM);
    const s = sim.spawn(v, 1, X(5.5), X(8.5));
    sim.spawn(g, 0, X(9.5), X(8.5));
    const m = sim.spawn(man, 0, X(6.5), X(8.5));
    let dives = 0;
    for (let t = 0; t < 600 && sim.state.alive[s] === 1; t++) {
      sim.identifyTo(1, m);
      sim.identifyTo(0, s);
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === s) dives++;
    }
    expect(dives).toBeGreaterThan(1);
  });
});
