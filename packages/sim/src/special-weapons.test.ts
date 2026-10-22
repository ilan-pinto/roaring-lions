import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson, type WeaponJson } from './sim';

// E2 (the `indirect` weapon flag) and E3 (submunitions), GH-709.
// Spec: docs/superpowers/specs/2026-10-22-special-units-design.md §2.

/** The staged `at_nlos_team`'s `zaron_missile`, without (E2's control) or with the flag. */
const NLOS: WeaponJson = {
  id: 'nlos', type: 'atgm', range_tiles: 24, effective_range_tiles: 18, accuracy: 0.8,
  penetration: 1000, damage: 450, suppression: 20, rof_per_min: 2, min_range_tiles: 4,
  can_target: ['ground', 'structure'], collateral_risk: 0.2,
};
/** The staged `spg_cluster`'s `dpicm_155` with its bomblets. Accuracy 1 so every
 *  round is a hit and bursts on the target; the miss case is tested separately. */
const BOMBLETS = { count: 12, scatter_tiles: 2.5, damage: 90, splash_tiles: 0.8, suppression: 60 };
const DPICM: WeaponJson = {
  id: 'dpicm', type: 'mortar', range_tiles: 24, effective_range_tiles: 24, accuracy: 1,
  penetration: 20, damage: 120, splash_tiles: 1.2, suppression: 160, rof_per_min: 2,
  min_range_tiles: 6, collateral_risk: 0.95, submunitions: BOMBLETS,
};

function shooter(id: string, weapon: WeaponJson): UnitTypeJson {
  return {
    id, role: 'at_team',
    hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 0.6 },
    // Sight 2: it cannot see anything these tests put in front of it.
    sensors: { optics: 1, sight_tiles: 2, signature: 0.5 },
    weapons: [weapon],
  };
}
/** Soft, harmless, and tough enough to count bomblet damage on. */
const MAN: UnitTypeJson = {
  id: 'man', role: 'infantry',
  hull: { hp: 30000, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
  abilities: ['garrison'],
};
/** Armoured: not `isSoft`, so splash does not reach it. */
const TANK: UnitTypeJson = {
  id: 'tank', role: 'mbt',
  hull: { hp: 30000, armor: { front: 600, side: 300, rear: 100 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};
const WALL = { id: 'wall', name: 'Wall', hp_per_tile: 90000, garrison_slots: 0, rubble_cover: 1 };
const HOUSE = { id: 'house', name: 'House', hp_per_tile: 900, garrison_slots: 2, rubble_cover: 1 };

function rect(sim: Sim, typeIdx: number, x: number, y: number, w: number, h: number): number {
  const tiles: number[] = [];
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) tiles.push(ty * sim.width + tx);
  return sim.addStructure(typeIdx, tiles);
}

/** Tick `n` times, keeping `target` identified to side 0 throughout: the spotter
 *  the NLOS and the cluster cannon both rely on, without a spotter's own rules. */
function runSpotted(sim: Sim, n: number, targets: number[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let k = 0; k < n; k++) {
    for (const t of targets) if (sim.state.alive[t] === 1) sim.identifyTo(0, t);
    out.push(...sim.tick());
  }
  return out;
}

describe('E2: the indirect weapon flag', () => {
  it('loads isIndirect from the class or the flag, and nothing else', () => {
    const sim = new Sim({ seed: 3, width: 16, height: 16, capacity: 8 });
    const plain = sim.addUnitType(shooter('plain', NLOS));
    const flagged = sim.addUnitType(shooter('flagged', { ...NLOS, indirect: true }));
    const tube = sim.addUnitType(shooter('tube', { ...NLOS, id: 'tube', type: 'mortar' }));
    expect(sim.unitTypes[plain].weapons[0].isIndirect).toBe(false);
    expect(sim.unitTypes[flagged].weapons[0].isIndirect).toBe(true);
    expect(sim.unitTypes[tube].weapons[0].isIndirect).toBe(true);
    // The rest of the class keeps its class: an indirect ATGM is still an ATGM.
    expect(sim.unitTypes[flagged].weapons[0].cls).toBe(sim.unitTypes[plain].weapons[0].cls);
  });

  // A wall between them, 2 tiles thick, and the target 14 tiles off: no sight line,
  // far outside the shooter's own sight 2, inside range 24.
  function scene(weapon: WeaponJson) {
    const sim = new Sim({ seed: 5, width: 32, height: 16, capacity: 8 });
    const wall = sim.addStructureType(WALL);
    const s = sim.addUnitType(shooter('s', weapon));
    const t = sim.addUnitType(TANK);
    rect(sim, wall, 12, 2, 2, 12);
    const me = sim.spawn(s, 0, fx.from(5.5), fx.from(8.5));
    const it = sim.spawn(t, 1, fx.from(19.5), fx.from(8.5));
    return { sim, me, it };
  }
  const firesAt = (ev: SimEvent[], me: number, it: number) =>
    ev.filter((e) => e.kind === 'fire' && e.shooter === me && e.target === it).length;

  it('an indirect ATGM fires on an identified target behind a wall', () => {
    const { sim, me, it } = scene({ ...NLOS, indirect: true });
    expect(firesAt(runSpotted(sim, 400, [it]), me, it)).toBeGreaterThan(0);
  });

  it('control: the same ATGM without the flag never fires through the wall', () => {
    const { sim, me, it } = scene(NLOS);
    expect(firesAt(runSpotted(sim, 400, [it]), me, it)).toBe(0);
  });

  it('control: the indirect ATGM holds fire on a target its side has NOT identified', () => {
    const { sim, me, it } = scene({ ...NLOS, indirect: true });
    expect(firesAt(runSpotted(sim, 400, []), me, it)).toBe(0);
  });
});

describe('E3: submunitions', () => {
  function world(seed = 9) {
    const sim = new Sim({ seed, width: 40, height: 24, capacity: 16 });
    const house = sim.addStructureType(HOUSE);
    const gun = sim.addUnitType(shooter('gun', DPICM));
    const man = sim.addUnitType(MAN);
    const tank = sim.addUnitType(TANK);
    return { sim, t: { house }, u: { gun, man, tank } };
  }
  /** Run until the first submunition burst; return that tick's events. */
  function firstBurst(sim: Sim, spotted: number[], max = 1200): SimEvent[] {
    for (let k = 0; k < max; k++) {
      for (const t of spotted) if (sim.state.alive[t] === 1) sim.identifyTo(0, t);
      const ev = sim.tick();
      if (ev.some((e) => e.kind === 'submunition')) return ev;
    }
    throw new Error('no burst');
  }

  it('one round bursts into `count` bomblets in one tick, index 0..n-1, within scatter of the target', () => {
    const { sim, u } = world();
    sim.spawn(u.gun, 0, fx.from(4.5), fx.from(12.5));
    const target = sim.spawn(u.man, 1, fx.from(24.5), fx.from(12.5));
    const ev = firstBurst(sim, [target]);
    const subs = ev.filter((e) => e.kind === 'submunition');
    expect(subs.map((e) => e.kind === 'submunition' && e.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const e of subs) {
      if (e.kind !== 'submunition') continue;
      expect(e.count).toBe(12);
      expect(e.weaponId).toBe('dpicm');
      const d = Math.hypot(fx.toNumber(e.x) - 24.5, fx.toNumber(e.y) - 12.5);
      expect(d).toBeLessThanOrEqual(2.5 + 1e-3);
    }
    // Twelve distinct points: the scatter is drawn per bomblet.
    expect(new Set(subs.map((e) => (e.kind === 'submunition' ? `${e.x},${e.y}` : ''))).size).toBe(12);
    // The parent round strikes nothing itself: no impact, no near miss.
    expect(ev.some((e) => e.kind === 'impact' || e.kind === 'nearMiss')).toBe(false);
  });

  it('a miss bursts at its scatter point, still in one tick', () => {
    const { sim, u } = world();
    const g = sim.addUnitType(shooter('wild', { ...DPICM, accuracy: 0 }));
    sim.spawn(g, 0, fx.from(4.5), fx.from(12.5));
    const target = sim.spawn(u.man, 1, fx.from(24.5), fx.from(12.5));
    const ev = firstBurst(sim, [target]);
    expect(ev.filter((e) => e.kind === 'submunition')).toHaveLength(12);
    expect(ev.some((e) => e.kind === 'nearMiss')).toBe(false);
  });

  it('hurts soft units in the open, not armour, not a man inside a building, not the building', () => {
    const { sim, t, u } = world();
    sim.spawn(u.gun, 0, fx.from(4.5), fx.from(12.5));
    const target = sim.spawn(u.man, 1, fx.from(24.5), fx.from(12.5));
    const tank = sim.spawn(u.tank, 1, fx.from(25.0), fx.from(12.5));
    const house = rect(sim, t.house, 24, 14, 1, 1);
    const inside = sim.spawn(u.man, 1, fx.from(23.5), fx.from(14.5));
    sim.queueCommand({ kind: 'garrison', ids: [inside], structure: house });
    for (let k = 0; k < 60 && sim.state.garrisonedIn[inside] !== house; k++) sim.tick();
    expect(sim.state.garrisonedIn[inside]).toBe(house);
    const hp0 = { man: sim.state.hp[target], tank: sim.state.hp[tank], inside: sim.state.hp[inside] };
    const st0 = sim.structures.hp[house];
    firstBurst(sim, [target]);
    expect(sim.state.hp[target]).toBeLessThan(hp0.man);
    expect(sim.state.hp[tank]).toBe(hp0.tank);
    expect(sim.state.hp[inside]).toBe(hp0.inside);
    expect(sim.structures.hp[house]).toBe(st0);
  });

  it('is deterministic: the same seed lays the same bomblets', () => {
    const lay = () => {
      const { sim, u } = world(21);
      sim.spawn(u.gun, 0, fx.from(4.5), fx.from(12.5));
      const target = sim.spawn(u.man, 1, fx.from(24.5), fx.from(12.5));
      return firstBurst(sim, [target]).filter((e) => e.kind === 'submunition');
    };
    expect(lay()).toEqual(lay());
  });

  it('refuses a count outside 1..32 at load', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const bad = (count: number) => () =>
      sim.addUnitType(shooter(`b${count}`, { ...DPICM, submunitions: { ...BOMBLETS, count } }));
    expect(bad(0)).toThrow(/submunitions.count/);
    expect(bad(33)).toThrow(/submunitions.count/);
    expect(bad(2.5)).toThrow(/submunitions.count/);
  });
});
