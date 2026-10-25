import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson, type WeaponJson } from './sim';

// E6 (GH-274) N2: `swarm.hit_mult`, the target-side `sizeMod` in the hit chance.
// Spec: docs/superpowers/specs/2026-09-29-e6-charge-swarm-laser-design.md §3.3 (P 0.08, Q1).
// The rule: every aimed shot AT a swarm has its hit chance multiplied by hit_mult; nothing else moves.

const HIT_MULT = 0.08;
const DIVE: WeaponJson = {
  id: 'bomblet_dive', type: 'atgm', range_tiles: 1.5, effective_range_tiles: 1.5, accuracy: 1,
  penetration: 160, damage: 90, splash_tiles: 0.5, suppression: 60, rof_per_min: 12,
  can_target: ['ground'], collateral_risk: 0.3,
};
const SWARM: UnitTypeJson = {
  id: 'drone_swarm', role: 'drone',
  hull: { hp: 180, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 0.01, domain: 'air' },
  sensors: { optics: 1.2, sight_tiles: 10, signature: 0.6 },
  weapons: [DIVE],
  swarm: { count: 12, member_hp: 15, spread_tiles: 3, hit_mult: HIT_MULT },
};
const SWARM_PLAIN: UnitTypeJson = { ...SWARM, id: 'swarm_plain', swarm: { count: 12, member_hp: 15, spread_tiles: 3 } };
/** The same body with no swarm block at all: an ordinary soft drone. */
const DRONE: UnitTypeJson = { ...SWARM, id: 'plain_drone', swarm: undefined, weapons: [] };
const MAN: UnitTypeJson = {
  id: 'man', role: 'infantry',
  hull: { hp: 30000, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 0.01 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};
/** A rifle-like gun: 1 damage so a long burst never kills the swarm, 100 shots a second-ish. */
const RIFLE: WeaponJson = {
  id: 'rifle', type: 'small_arms', range_tiles: 8, effective_range_tiles: 8, accuracy: 1,
  penetration: 5, damage: 1, rof_per_min: 600, can_target: ['air'], collateral_risk: 0,
};
const GUNNER: UnitTypeJson = {
  id: 'gunner', role: 'infantry',
  hull: { hp: 30000, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 0.01 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.1 },
  weapons: [RIFLE],
};

function world(seed = 7) {
  const sim = new Sim({ seed, width: 32, height: 16, capacity: 8 });
  return {
    sim,
    swarm: sim.addUnitType(SWARM),
    plainSwarm: sim.addUnitType(SWARM_PLAIN),
    drone: sim.addUnitType(DRONE),
    man: sim.addUnitType(MAN),
    gunner: sim.addUnitType(GUNNER),
  };
}
const X = (n: number) => fx.from(n);

describe('E6 N2: swarm.hit_mult scales the hit chance of a shot at the swarm', () => {
  it('projectHit: pHit is the unscaled chance times hit_mult, and sizeMod names it', () => {
    const { sim, swarm, plainSwarm, gunner } = world();
    const g = sim.spawn(gunner, 0, X(5.5), X(8.5));
    const a = sim.spawn(swarm, 1, X(10.5), X(8.5));
    const b = sim.spawn(plainSwarm, 1, X(10.5), X(8.5));
    sim.identifyTo(0, a);
    sim.identifyTo(0, b);
    const scaled = sim.projectHit(g, a);
    const plain = sim.projectHit(g, b);
    if (scaled.kind !== 'shot' || plain.kind !== 'shot') throw new Error('both should be shots');
    expect(plain.factors.sizeMod).toBe(fx.from(1));
    expect(scaled.factors.sizeMod).toBe(fx.from(HIT_MULT));
    expect(scaled.pHit).toBe(fx.mul(plain.pHit, fx.from(HIT_MULT)));
    expect(scaled.pHit).toBeLessThan(plain.pHit);
  });

  it('a swarm that authors no hit_mult is as easy to hit as an ordinary soft drone, bit for bit', () => {
    const { sim, plainSwarm, drone, gunner } = world();
    const g = sim.spawn(gunner, 0, X(5.5), X(8.5));
    const s = sim.spawn(plainSwarm, 1, X(10.5), X(8.5));
    const d = sim.spawn(drone, 1, X(10.5), X(8.5));
    sim.identifyTo(0, s);
    sim.identifyTo(0, d);
    const ps = sim.projectHit(g, s);
    const pd = sim.projectHit(g, d);
    if (ps.kind !== 'shot' || pd.kind !== 'shot') throw new Error('both should be shots');
    expect(ps.pHit).toBe(pd.pHit);
    expect(ps.factors.sizeMod).toBe(fx.from(1));
  });

  it('the roll path uses it: the fire event carries sizeMod, and far fewer shots land', () => {
    function burst(typeOf: (w: ReturnType<typeof world>) => number) {
      const w = world();
      const g = w.sim.spawn(w.gunner, 0, X(5.5), X(8.5));
      const s = w.sim.spawn(typeOf(w), 1, X(10.5), X(8.5));
      const fires: Extract<SimEvent, { kind: 'fire' }>[] = [];
      for (let k = 0; k < 600; k++) {
        w.sim.identifyTo(0, s);
        for (const e of w.sim.tick()) if (e.kind === 'fire' && e.shooter === g) fires.push(e);
      }
      return fires;
    }
    const scaled = burst((w) => w.swarm);
    const plain = burst((w) => w.plainSwarm);
    expect(scaled.length).toBeGreaterThan(80);
    expect(plain.length).toBeGreaterThan(80);
    const hits = (f: typeof scaled) => f.filter((e) => e.willHit).length;
    // ~0.9 of ~100 shots against ~0.07 of ~100: nowhere near each other.
    expect(hits(plain) / plain.length).toBeGreaterThan(0.5);
    expect(hits(scaled) / scaled.length).toBeLessThan(0.2);
    for (const e of scaled) expect(e.breakdown.sizeMod).toBe(fx.from(HIT_MULT));
    // the factor is only ever named on a shot that carries it
    for (const e of plain) expect('sizeMod' in e.breakdown).toBe(false);
  });

  it('is target-side only: the swarm\'s own dive is not made less likely to hit by its hit_mult', () => {
    function diveP(type: (w: ReturnType<typeof world>) => number) {
      const w = world();
      w.sim.spawn(type(w), 1, X(5.5), X(8.5));
      const m = w.sim.spawn(w.man, 0, X(6.5), X(8.5));
      for (let k = 0; k < 400; k++) {
        w.sim.identifyTo(1, m);
        for (const e of w.sim.tick()) if (e.kind === 'fire') return { p: e.pHit, e };
      }
      throw new Error('the swarm never dived');
    }
    const a = diveP((w) => w.swarm);
    const b = diveP((w) => w.plainSwarm);
    expect(a.p).toBe(b.p);
    expect('sizeMod' in a.e.breakdown).toBe(false);
  });

  it('does not touch splash: a blast still thins the cloud by ceil(live x splash / spread)', () => {
    const { sim, swarm } = world();
    const s = sim.spawn(swarm, 1, X(10.5), X(8.5));
    sim.debugSplash(X(10.5), X(8.5), X(1.5), X(50), 0, -1, -1);
    expect(sim.swarmMembers(s)).toBe(6); // radius 1.5 over spread 3 = half, hit_mult or not
  });
});

describe('E6 N2: registration', () => {
  it('refuses a hit_mult outside (0, 1]; accepts 1 and anything inside', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 2 });
    const with_ = (hit_mult: number): UnitTypeJson => ({ ...SWARM, swarm: { count: 12, member_hp: 15, spread_tiles: 3, hit_mult } });
    for (const bad of [0, -0.1, 1.01, Number.NaN]) expect(() => sim.addUnitType(with_(bad))).toThrow(/hit_mult/);
    expect(() => sim.addUnitType({ ...with_(1), id: 'one' })).not.toThrow();
    expect(() => sim.addUnitType({ ...with_(0.5), id: 'half' })).not.toThrow();
  });
});
