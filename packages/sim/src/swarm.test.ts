import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson, type WeaponJson } from './sim';

// E6 (GH-274 item 2): the swarm model. Spec: docs/superpowers/specs/2026-09-29-e5-special-forces-design.md §8.1.
// The numbers are the approved ones: 12 members of 15 hp, spread 3 tiles, a 12 rof_per_min dive.

const DIVE: WeaponJson = {
  id: 'bomblet_dive', type: 'atgm', range_tiles: 1.5, effective_range_tiles: 1.5, accuracy: 1,
  penetration: 160, damage: 90, splash_tiles: 0.5, suppression: 60, rof_per_min: 12,
  can_target: ['ground'], collateral_risk: 0.3,
};
const SWARM: UnitTypeJson = {
  id: 'drone_swarm', role: 'drone',
  hull: { hp: 180, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 2.6, domain: 'air' },
  sensors: { optics: 1.2, sight_tiles: 10, signature: 0.6 },
  weapons: [DIVE],
  swarm: { count: 12, member_hp: 15, spread_tiles: 3 },
};
/** Soft, tough, harmless: the dive's victim. */
const MAN: UnitTypeJson = {
  id: 'man', role: 'infantry',
  hull: { hp: 30000, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 0.01 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};
/** One heavy direct-fire shot at air, 100% accurate: a hit worth many members of damage. */
const FLAK: WeaponJson = {
  id: 'flak', type: 'autocannon', range_tiles: 8, effective_range_tiles: 8, accuracy: 1,
  penetration: 50, damage: 500, rof_per_min: 6, can_target: ['air'], collateral_risk: 0,
};
const GUNNER: UnitTypeJson = {
  id: 'gunner', role: 'aa',
  hull: { hp: 30000, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 0.01 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.1 },
  weapons: [FLAK],
};

function world() {
  const sim = new Sim({ seed: 7, width: 32, height: 16, capacity: 8 });
  const swarm = sim.addUnitType(SWARM);
  const man = sim.addUnitType(MAN);
  const gunner = sim.addUnitType(GUNNER);
  return { sim, swarm, man, gunner };
}
/** Tick `n`, keeping `ids` identified to side `side`. */
function run(sim: Sim, n: number, side: number, ids: number[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let k = 0; k < n; k++) {
    for (const t of ids) if (sim.state.alive[t] === 1) sim.identifyTo(side, t);
    out.push(...sim.tick());
  }
  return out;
}

describe('E6 swarm: registration', () => {
  it('derives live members as ceil(hp / member_hp): 12 at full strength', () => {
    const { sim, swarm, man } = world();
    const s = sim.spawn(swarm, 1, fx.from(5.5), fx.from(8.5));
    expect(sim.swarmMembers(s)).toBe(12);
    expect(sim.swarmMembers(sim.spawn(man, 0, fx.from(9.5), fx.from(8.5)))).toBe(-1);
  });

  it('refuses a swarm whose hull.hp is not count x member_hp', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 2 });
    expect(() => sim.addUnitType({ ...SWARM, hull: { ...SWARM.hull, hp: 181 } })).toThrow(/count x member_hp/);
    expect(() => sim.addUnitType({ ...SWARM, swarm: { count: 12, member_hp: 15, spread_tiles: 0 } })).toThrow(/spread/);
    expect(() => sim.addUnitType({ ...SWARM, swarm: { count: 0.5, member_hp: 15, spread_tiles: 3 } })).toThrow(/count/);
  });
});

describe('E6 swarm: the dive', () => {
  function diver() {
    const w = world();
    const s = w.sim.spawn(w.swarm, 1, fx.from(5.5), fx.from(8.5));
    const m = w.sim.spawn(w.man, 0, fx.from(6.5), fx.from(8.5));
    return { ...w, s, m };
  }
  it('each dive spends exactly one member', () => {
    const { sim, s, m } = diver();
    const ev = run(sim, 400, 1, [m]);
    const dives = ev.filter((e) => e.kind === 'fire' && e.shooter === s).length;
    expect(dives).toBeGreaterThan(1);
    expect(sim.swarmMembers(s)).toBe(12 - dives);
  });

  it('the rate of fire scales with live members: the gap after a dive is ceil(tbs x count / left)', () => {
    const { sim, s, m } = diver();
    const ticks: number[] = [];
    for (let k = 0; k < 900; k++) {
      sim.identifyTo(1, m);
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === s) ticks.push(e.tick);
    }
    const tbs = 100; // 12 shots a minute = 5 s = 100 ticks
    expect(ticks.length).toBeGreaterThan(3);
    for (let k = 1; k < 4; k++) {
      const left = 12 - k; // members after the k-th dive
      expect(ticks[k] - ticks[k - 1]).toBe(Math.ceil((tbs * 12) / left));
    }
  });

  it('the last member\'s dive ends the swarm, credited to nobody', () => {
    const { sim, s, m } = diver();
    const ev = run(sim, 6000, 1, [m]);
    expect(sim.state.alive[s]).toBe(0);
    const d = ev.find((e) => e.kind === 'destroyed' && e.entity === s);
    expect(d && d.kind === 'destroyed' ? d.by : 0).toBe(-1);
    expect(ev.filter((e) => e.kind === 'fire' && e.shooter === s)).toHaveLength(12);
  });
});

describe('E6 swarm: being hit', () => {
  it('a single-target hit removes at most one member, however hard', () => {
    const { sim, swarm, gunner } = world();
    const s = sim.spawn(swarm, 1, fx.from(10.5), fx.from(8.5));
    const g = sim.spawn(gunner, 0, fx.from(5.5), fx.from(8.5));
    let hits = 0;
    let members = 12;
    for (let k = 0; k < 400 && hits < 3 && sim.state.alive[s] === 1; k++) {
      sim.identifyTo(0, s);
      const ev = sim.tick();
      if (ev.some((e) => e.kind === 'fire' && e.shooter === g)) {
        const after = sim.swarmMembers(s);
        // a 500-damage round into a 15 hp member
        if (after < members) {
          expect(members - after).toBe(1);
          members = after;
          hits++;
        }
      }
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('a hit smaller than a member wears it down without removing one (live = ceil, not floor)', () => {
    const w = world();
    const weak = w.sim.addUnitType({ ...GUNNER, id: 'weak', weapons: [{ ...FLAK, id: 'weak_flak', damage: 5 }] });
    const s = w.sim.spawn(w.swarm, 1, fx.from(10.5), fx.from(8.5));
    const g = w.sim.spawn(weak, 0, fx.from(5.5), fx.from(8.5));
    let fired = false;
    for (let k = 0; k < 200 && !fired; k++) {
      w.sim.identifyTo(0, s);
      fired = w.sim.tick().some((e) => e.kind === 'fire' && e.shooter === g);
    }
    expect(fired).toBe(true);
    // 5 of 15 hp off the top member: 175 hp is still 12 members.
    expect(w.sim.state.hp[s]).toBe(fx.from(175));
    expect(w.sim.swarmMembers(s)).toBe(12);
  });

  it('a splash removes ceil(live x min(1, splash / spread)) members', () => {
    // radius 1.5 over spread 3 = half the cloud: ceil(12 x 0.5) = 6, then ceil(6 x 0.5) = 3.
    const { sim, swarm } = world();
    const s = sim.spawn(swarm, 1, fx.from(10.5), fx.from(8.5));
    sim.debugSplash(fx.from(10.5), fx.from(8.5), fx.from(1.5), fx.from(50), 0, -1, -1);
    expect(sim.swarmMembers(s)).toBe(6);
    sim.debugSplash(fx.from(10.5), fx.from(8.5), fx.from(1.5), fx.from(50), 0, -1, -1);
    expect(sim.swarmMembers(s)).toBe(3);
    // an odd count rounds UP: 3 x 0.5 = 1.5 -> 2 gone, 1 left
    sim.debugSplash(fx.from(10.5), fx.from(8.5), fx.from(1.5), fx.from(50), 0, -1, -1);
    expect(sim.swarmMembers(s)).toBe(1);
  });

  it('a splash at or beyond the spread takes the whole swarm; a zero-damage blast takes none', () => {
    const { sim, swarm } = world();
    const a = sim.spawn(swarm, 1, fx.from(4.5), fx.from(4.5));
    const b = sim.spawn(swarm, 1, fx.from(20.5), fx.from(12.5));
    sim.debugSplash(fx.from(20.5), fx.from(12.5), fx.from(0.1), 0, 60, -1, -1);
    expect(sim.swarmMembers(b)).toBe(12);
    sim.debugSplash(fx.from(4.5), fx.from(4.5), fx.from(3), fx.from(1), 0, -1, -1);
    expect(sim.state.alive[a]).toBe(0);
  });
});

describe('E6 swarm: the hash', () => {
  it('a swarm type registered but never spawned moves nothing', () => {
    const a = new Sim({ seed: 3, width: 16, height: 16, capacity: 4 });
    const b = new Sim({ seed: 3, width: 16, height: 16, capacity: 4 });
    const m = a.addUnitType(MAN);
    b.addUnitType(MAN);
    b.addUnitType(SWARM);
    a.spawn(m, 0, fx.from(3.5), fx.from(3.5));
    b.spawn(m, 0, fx.from(3.5), fx.from(3.5));
    for (let k = 0; k < 50; k++) {
      a.tick();
      b.tick();
    }
    expect(b.hash()).toBe(a.hash());
  });
});
