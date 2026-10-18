import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { MissionRuntime, type MissionJson } from './mission';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import { COVER_HIT } from './tuning';

// Buildings as first-class sim objects: they have HP, they block until they
// fall, infantry fight from inside them, and engineers bring them down.

const HOUSE = { id: 'house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 };
const TOWER = { id: 'tower', name: 'Apartment', hp_per_tile: 520, garrison_slots: 4, rubble_cover: 2 };

const RIFLES: UnitTypeJson = {
  id: 's_inf',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 },
  ],
};

const GUNS: UnitTypeJson = {
  id: 's_tank',
  role: 'mbt',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1.2, sight_tiles: 14, signature: 1 },
  weapons: [
    { id: 'he', type: 'he', range_tiles: 12, effective_range_tiles: 10, accuracy: 0.8, penetration: 60, damage: 300, splash_tiles: 1.5, suppression: 60, rof_per_min: 12, can_target: ['ground', 'structure'] },
  ],
};

const SAPPERS: UnitTypeJson = {
  id: 's_demo',
  role: 'engineer',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.4 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  abilities: ['demolish'],
  weapons: [
    { id: 'carbines', type: 'small_arms', range_tiles: 6, effective_range_tiles: 5, accuracy: 0.5, penetration: 8, damage: 10, suppression: 30, rof_per_min: 240 },
  ],
};

/** A rectangular building at (x,y) of size w×h. */
function rect(sim: Sim, typeIdx: number, x: number, y: number, w: number, h: number): number {
  const tiles: number[] = [];
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) tiles.push(ty * sim.width + tx);
  return sim.addStructure(typeIdx, tiles);
}

function world(): { sim: Sim; house: number; tower: number } {
  const sim = new Sim({ seed: 5, width: 32, height: 16, capacity: 32 });
  const houseType = sim.addStructureType(HOUSE);
  const towerType = sim.addStructureType(TOWER);
  const house = rect(sim, houseType, 14, 6, 2, 2);
  const tower = rect(sim, towerType, 22, 6, 2, 2);
  return { sim, house, tower };
}

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

describe('a low wall is cover, not a screen', () => {
  // The two types differ in exactly one field, which is what makes this a proof
  // rather than a coincidence.
  const FENCE = {
    id: 'fence',
    name: 'Fence',
    hp_per_tile: 200,
    garrison_slots: 0,
    rubble_cover: 1,
    low_profile: true,
    standing_cover: 2,
  };
  const SOLID = { id: 'solid', name: 'Solid', hp_per_tile: 200, garrison_slots: 0, rubble_cover: 1 };

  /** A north-south wall at x=12, edge to edge so there is no way round it, with
   *  a rifleman either side. */
  function facing(spec: typeof FENCE | typeof SOLID, targetX: number) {
    const sim = new Sim({ seed: 4, width: 32, height: 16, capacity: 16 });
    const wallType = sim.addStructureType(spec);
    for (let y = 0; y < sim.height; y++) sim.addStructure(wallType, [y * sim.width + 12]);
    const inf = sim.addUnitType(RIFLES);
    const a = sim.spawn(inf, 0, fx.from(9.5), fx.from(8.5));
    const b = sim.spawn(inf, 1, fx.from(targetX), fx.from(8.5));
    return { sim, a, b };
  }

  it('lets a defender shoot over it', () => {
    const { sim, a, b } = facing(FENCE, 15.5);
    const events = run(sim, 40 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'fire' && e.shooter === a && e.target === b)).toBe(true);
  });

  it('but a solid wall of the same height still stops the sight line dead', () => {
    const { sim } = facing(SOLID, 15.5);
    const events = run(sim, 40 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'fire')).toBe(false);
    expect(events.some((e) => e.kind === 'contact')).toBe(false);
  });

  it('still blocks movement — you shoot over it, you do not walk through it', () => {
    const { sim, a } = facing(FENCE, 15.5);
    const W = sim.width;
    sim.queueCommand({ kind: 'move', ids: [a], x: fx.from(15.5), y: fx.from(8.5) });
    for (let t = 0; t < 40 * TICKS_PER_SECOND; t++) {
      sim.tick();
      const tx = sim.state.posX[a] >> 16;
      const ty = sim.state.posY[a] >> 16;
      expect(sim.blocked[ty * W + tx]).toBe(0);
    }
    expect(sim.blocked[8 * W + 12]).toBe(1);
    expect(fx.toNumber(sim.state.posX[a])).toBeLessThan(12);
  });

  it('shields the man hugging it, and nobody standing clear of it', () => {
    const coverModOf = (targetX: number): number => {
      const events = run(facing(FENCE, targetX).sim, 40 * TICKS_PER_SECOND);
      const shot = events.find((e) => e.kind === 'fire' && e.shooter === 0);
      if (shot === undefined || shot.kind !== 'fire') throw new Error('nobody fired');
      return shot.breakdown.coverMod;
    };
    // Adjacent to the wall on the shooter's side: fighting from behind it.
    expect(coverModOf(13.5)).toBe(COVER_HIT[2]);
    // Three tiles clear of it: the same wall protects him not at all. Without
    // this half, "cover" could just be a constant applied to every shot.
    expect(coverModOf(16.5)).toBe(COVER_HIT[0]);
  });
});

describe('a wall breaks tile by tile', () => {
  // What the map loader now produces for a `per_tile` type: one structure per
  // tile, each with its own HP. The bug this pins is the opposite -- a perimeter
  // flood-filled into a single object, where killing it unblocked the whole ring
  // at once and "breaching" one panel deleted the compound.
  const WALL = { id: 'wall', name: 'Wall', hp_per_tile: 90, garrison_slots: 0, rubble_cover: 1 };

  function walled(): { sim: Sim; walls: number[] } {
    const sim = new Sim({ seed: 9, width: 32, height: 16, capacity: 32 });
    const wallType = sim.addStructureType(WALL);
    const walls: number[] = [];
    for (let x = 10; x <= 14; x++) walls.push(sim.addStructure(wallType, [8 * sim.width + x]));
    return { sim, walls };
  }

  it('gives every tile its own hp, rather than the run its length in hp', () => {
    const { sim, walls } = walled();
    for (const w of walls) {
      expect(sim.structures.maxHp[w]).toBe(fx.from(90));
      expect(sim.structures.hp[w]).toBe(fx.from(90));
    }
  });

  it('leaves a one-tile hole and standing neighbours', () => {
    const { sim, walls } = walled();
    const W = sim.width;
    sim.debugDestroyStructure(walls[2]); // the panel at x=12

    expect(sim.blocked[8 * W + 12]).toBe(0); // the hole
    expect(sim.blocked[8 * W + 11]).toBe(1); // and only the hole
    expect(sim.blocked[8 * W + 13]).toBe(1);
    expect(sim.cover[8 * W + 12]).toBe(WALL.rubble_cover);
    expect(sim.structures.alive[walls[1]]).toBe(1);
    expect(sim.structures.alive[walls[3]]).toBe(1);
  });

  it('makes the hole walkable and the rest of the wall not', () => {
    const { sim, walls } = walled();
    const W = sim.width;
    sim.debugDestroyStructure(walls[2]);
    const inf = sim.addUnitType(RIFLES);
    const u = sim.spawn(inf, 0, fx.from(6.5), fx.from(8.5));
    sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(20.5), y: fx.from(8.5) });
    for (let t = 0; t < 60 * TICKS_PER_SECOND; t++) {
      sim.tick();
      const tx = sim.state.posX[u] >> 16;
      const ty = sim.state.posY[u] >> 16;
      expect(sim.blocked[ty * W + tx]).toBe(0); // never ends a tick inside masonry
    }
    expect(fx.toNumber(sim.state.posX[u])).toBeGreaterThan(14);
  });
});

describe('structures exist, block, and fall', () => {
  it('occupies its tiles and blocks movement while it stands', () => {
    const { sim, house } = world();
    expect(sim.structures.alive[house]).toBe(1);
    expect(sim.structureAt(14, 6)).toBe(house);
    expect(sim.structureAt(2, 2)).toBe(-1);
    expect(sim.blocked[6 * sim.width + 14]).toBe(1);
    // HP scales with footprint: 2x2 house = 4 tiles.
    expect(sim.structures.hp[house]).toBe(fx.from(260 * 4));
  });

  it('rubble is passable and gives cover once the building is down', () => {
    const { sim, house } = world();
    sim.debugDestroyStructure(house);
    expect(sim.structures.alive[house]).toBe(0);
    expect(sim.blocked[6 * sim.width + 14]).toBe(0);
    expect(sim.cover[6 * sim.width + 14]).toBe(2);
  });

  it('high-explosive brings a house down; rifles barely scratch it', () => {
    const hpAfter = (attacker: UnitTypeJson, x: number, seconds: number): { hp: number; hits: number } => {
      const { sim, house } = world();
      const t = sim.addUnitType(attacker);
      const inf = sim.addUnitType(RIFLES);
      sim.spawn(t, 0, fx.from(x), fx.from(6.5));
      // A defender inside makes the building a legitimate target.
      const g = sim.spawn(inf, 1, fx.from(14.5), fx.from(6.5));
      sim.queueCommand({ kind: 'garrison', ids: [g], structure: house });
      const hits = run(sim, seconds * TICKS_PER_SECOND).filter((e) => e.kind === 'structureHit').length;
      return { hp: fx.toNumber(sim.structures.hp[house]) / fx.toNumber(sim.structures.maxHp[house]), hits };
    };
    // The guns stand ten tiles off: their 12 reaches the house, the garrison's
    // 8-tile rifles do not reach them. Since a round that bounces off armour
    // suppresses (BOUNCE_SUPP_MULT, 2026-10-13) a rifleman in the window pins
    // a tank at six tiles, and this test is about what each weapon does to
    // masonry, not about who wins that exchange.
    expect(hpAfter(GUNS, 4.5, 60).hp).toBeLessThan(0.2);
    // The rifles stand where they can reach the wall, and do hit it: a green
    // "barely scratched" from rifles that never fired would prove nothing.
    const rifles = hpAfter(RIFLES, 8.5, 60);
    expect(rifles.hits).toBeGreaterThan(0);
    expect(rifles.hp).toBeGreaterThan(0.9);
  });
});

describe('garrisoned infantry', () => {
  it('enters an adjacent building, and cannot be shot while inside', () => {
    const { sim, house } = world();
    const inf = sim.addUnitType(RIFLES);
    const shooterType = sim.addUnitType(RIFLES);
    const holder = sim.spawn(inf, 1, fx.from(13.0), fx.from(6.5));
    sim.spawn(shooterType, 0, fx.from(8.5), fx.from(6.5));
    sim.queueCommand({ kind: 'garrison', ids: [holder], structure: house });

    const events = run(sim, 20 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'garrison' && e.entity === holder && e.entered)).toBe(true);
    expect(sim.state.garrisonedIn[holder]).toBe(house);
    expect(sim.structures.occupants[house]).toBe(1);
    // Nobody may aim at a man inside a building.
    expect(events.some((e) => e.kind === 'fire' && e.target === holder)).toBe(false);
    expect(sim.state.hp[holder]).toBe(fx.from(400));
    // But he still fights back out of the windows.
    expect(events.some((e) => e.kind === 'fire' && e.shooter === holder)).toBe(true);
  });

  it('dies with the building when it comes down', () => {
    const { sim, house } = world();
    const inf = sim.addUnitType(RIFLES);
    const holder = sim.spawn(inf, 1, fx.from(13.0), fx.from(6.5));
    sim.queueCommand({ kind: 'garrison', ids: [holder], structure: house });
    run(sim, 10 * TICKS_PER_SECOND);
    expect(sim.state.garrisonedIn[holder]).toBe(house);

    sim.debugDestroyStructure(house);
    expect(sim.state.alive[holder]).toBe(0);
    expect(sim.structures.occupants[house]).toBe(0);
  });

  it('leaves the building when ordered to move', () => {
    const { sim, house } = world();
    const inf = sim.addUnitType(RIFLES);
    const holder = sim.spawn(inf, 1, fx.from(13.0), fx.from(6.5));
    sim.queueCommand({ kind: 'garrison', ids: [holder], structure: house });
    run(sim, 10 * TICKS_PER_SECOND);
    expect(sim.state.garrisonedIn[holder]).toBe(house);

    sim.queueCommand({ kind: 'move', ids: [holder], x: fx.from(4.5), y: fx.from(12.5) });
    const events = run(sim, 5 * TICKS_PER_SECOND);
    expect(sim.state.garrisonedIn[holder]).toBe(-1);
    expect(events.some((e) => e.kind === 'garrison' && !e.entered)).toBe(true);
  });

  it('refuses to overfill: a house holds only its garrison slots', () => {
    const { sim, house } = world();
    const inf = sim.addUnitType(RIFLES);
    const ids: number[] = [];
    for (let k = 0; k < 4; k++) ids.push(sim.spawn(inf, 1, fx.from(13.0), fx.from(5.5 + k * 0.4)));
    sim.queueCommand({ kind: 'garrison', ids, structure: house });
    run(sim, 25 * TICKS_PER_SECOND);
    expect(sim.structures.occupants[house]).toBe(HOUSE.garrison_slots);
  });
});

describe('demolition squad', () => {
  it('brings a building down after holding position beside it', () => {
    const { sim, house } = world();
    const demo = sim.addUnitType(SAPPERS);
    const sapper = sim.spawn(demo, 0, fx.from(13.2), fx.from(6.5));
    const events = run(sim, 8 * TICKS_PER_SECOND);
    const down = events.find((e) => e.kind === 'structureDestroyed' && e.structure === house);
    expect(down).toBeDefined();
    if (down?.kind === 'structureDestroyed') expect(down.by).toBe(sapper);
    expect(sim.structures.alive[house]).toBe(0);
  });

  it('takes about five seconds, and moving away resets the charge', () => {
    const { sim, house } = world();
    const demo = sim.addUnitType(SAPPERS);
    const sapper = sim.spawn(demo, 0, fx.from(13.2), fx.from(6.5));
    run(sim, 4 * TICKS_PER_SECOND);
    expect(sim.structures.alive[house]).toBe(1); // not yet
    expect(sim.demolitionProgress(sapper)).toBeGreaterThan(0.5);

    // Ordered away before the charge is set: progress is lost.
    sim.queueCommand({ kind: 'move', ids: [sapper], x: fx.from(4.5), y: fx.from(13.5) });
    run(sim, 2 * TICKS_PER_SECOND);
    expect(sim.demolitionProgress(sapper)).toBe(0);
    run(sim, 10 * TICKS_PER_SECOND);
    expect(sim.structures.alive[house]).toBe(1);
  });

  it('kills the garrison inside when it blows the building', () => {
    const { sim, house } = world();
    // Unarmed: a rifleman in the window pins the sappers on their way to the
    // wall now that a hit suppresses (BOUNCE_SUPP_MULT, 2026-10-13), and a
    // pinned sapper sets no charge. This test is about who dies in the
    // collapse, not about reaching the wall under fire.
    const inf = sim.addUnitType({ ...RIFLES, id: 's_inf_unarmed', weapons: [] });
    const demo = sim.addUnitType(SAPPERS);
    const holder = sim.spawn(inf, 1, fx.from(13.0), fx.from(6.5));
    sim.queueCommand({ kind: 'garrison', ids: [holder], structure: house });
    run(sim, 8 * TICKS_PER_SECOND);
    expect(sim.state.garrisonedIn[holder]).toBe(house);

    sim.spawn(demo, 0, fx.from(16.4), fx.from(6.5));
    const events = run(sim, 10 * TICKS_PER_SECOND);
    expect(sim.structures.alive[house]).toBe(0);
    expect(sim.state.alive[holder]).toBe(0);
    expect(events.some((e) => e.kind === 'destroyed' && e.entity === holder)).toBe(true);
  });
});

describe('determinism with structures', () => {
  it('identical runs hash identically; structure state is part of the hash', () => {
    const build = (): Sim => {
      const { sim, house } = world();
      const inf = sim.addUnitType(RIFLES);
      const tank = sim.addUnitType(GUNS);
      const demo = sim.addUnitType(SAPPERS);
      const g = sim.spawn(inf, 1, fx.from(13.0), fx.from(6.5));
      sim.queueCommand({ kind: 'garrison', ids: [g], structure: house });
      sim.spawn(tank, 0, fx.from(6.5), fx.from(6.5));
      sim.spawn(demo, 0, fx.from(4.5), fx.from(9.5));
      run(sim, 400);
      return sim;
    };
    expect(build().hash()).toBe(build().hash());

    const a = world();
    const b = world();
    a.sim.debugDestroyStructure(a.house);
    expect(a.sim.hash()).not.toBe(b.sim.hash());
  });
});

describe('an attack-mover closes on a garrisoned building', () => {
  // Issue #86. sim.ts states the rule this must follow: `engaging` — which halts
  // an attack-mover — "only latches once the primary target is inside EFFECTIVE
  // range, [so] advancing units keep closing under marching fire instead of
  // stalling at maximum range to plink." The unit-vs-unit path checks
  // `dSq <= w.effectiveRangeSq` before latching. The structure path latched on
  // target *selection*, and selectStructureTarget selects out to MAXIMUM range.
  //
  // Reproducing it needs the garrison identified while the attacker is still in
  // the band between effective and maximum range. That is the normal case in a
  // real mission -- `contact[]` is per-SIDE, so a drone, a forward squad, or a
  // tag carried in `intel.marked_positions` identifies the defender long before
  // the armour arrives -- but a lone tank closing at 1.1 tiles/s crosses the
  // 12-to-10 band in under two seconds and never shows the defect. Hence the
  // spotter.
  //
  // GUNS: range 12, effective 10. structDistSq measures to the nearest footprint
  // tile centre, (14.5, 6.5) for a tank approaching along y=6.5.
  const DIST_TO_HOUSE = 14.5;

  function approach(): { sim: Sim; tank: number; house: number } {
    const { sim, house } = world();
    const inf = sim.addUnitType(RIFLES);
    const gunType = sim.addUnitType(GUNS);
    const held = sim.spawn(inf, 1, fx.from(13.0), fx.from(6.5));
    sim.queueCommand({ kind: 'garrison', ids: [held], structure: house });
    // The spotter. Close enough to identify the man inside; far enough south
    // that it is not the thing doing the shooting.
    sim.spawn(inf, 0, fx.from(11.5), fx.from(10.5));
    const tank = sim.spawn(gunType, 0, fx.from(1.5), fx.from(6.5));
    // Let contact build before the tank is given its order.
    run(sim, 12 * TICKS_PER_SECOND);
    sim.queueCommand({ kind: 'attackMove', ids: [tank], x: fx.from(12.5), y: fx.from(6.5) });
    return { sim, tank, house };
  }

  /** Closest the tank got to the house while the house was its target. */
  function closestWhileEngaging(sim: Sim, tank: number, seconds: number): number {
    let closest = Infinity;
    for (let s = 0; s < seconds * TICKS_PER_SECOND; s++) {
      sim.tick();
      if (sim.state.curStructure[tank] < 0) continue;
      const d = DIST_TO_HOUSE - fx.toNumber(sim.state.posX[tank]);
      if (d < closest) closest = d;
    }
    return closest;
  }

  it('closes to effective range instead of shelling from maximum range', () => {
    const { sim, tank } = approach();
    // Effective range is 10. Stalling on selection freezes it just inside
    // maximum range, at about 11.96 tiles, and it never gets closer.
    expect(closestWhileEngaging(sim, tank, 30)).toBeLessThan(10.5);
  });

  it('and holds there rather than driving on to its ordered destination', () => {
    const { sim, tank } = approach();
    run(sim, 12 * TICKS_PER_SECOND);
    // Still fighting the building, and stopped: an attack-mover halts to fight,
    // so its position must not change while it holds a structure target.
    expect(sim.state.curStructure[tank]).toBeGreaterThanOrEqual(0);
    const before = fx.toNumber(sim.state.posX[tank]);
    run(sim, 3 * TICKS_PER_SECOND);
    expect(fx.toNumber(sim.state.posX[tank])).toBeCloseTo(before, 2);
    // And it stopped short of the destination it was ordered to.
    expect(fx.toNumber(sim.state.posX[tank])).toBeLessThan(12.0);
  });
});

// Field works (#277), Task 2: structure owners, the per-side identification
// latch, and owned structures as targets. Geometry by hand: a 32x16 map, the
// owned building a 2x2 at x20-21, y6-7, so its nearest tile centre from a
// unit on row 6 at x+0.5 is (20.5, 6.5).
describe('field works: owned structures are seen once and then shot', () => {
  const OP = { id: 'fw_op', name: 'Outpost', hp_per_tile: 300, owner: 1 };
  const SHRINE = { id: 'fw_shrine', name: 'Shrine', hp_per_tile: 300, owner: 1, roe_penalty: 20 };
  const RIDGE = { id: 'fw_ridge', name: 'Ridge wall', hp_per_tile: 5000 };

  /** Unarmed eyes: sight 10, so it sees the building from x <= 10.5 tiles off. */
  const SPOTTER: UnitTypeJson = {
    id: 'fw_spotter', role: 'recon',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1 },
    sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
    weapons: [],
  };
  /** A gun that out-ranges its own eyes: HE to 12 tiles, sight 3. Whatever it
   *  shoots at 11 tiles, it did not see for itself. */
  const BLIND_GUN: UnitTypeJson = {
    id: 'fw_gun', role: 'mbt',
    hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
    mobility: { speed_tiles_s: 1 },
    sensors: { optics: 1, sight_tiles: 3, signature: 1 },
    weapons: [
      { id: 'he', type: 'he', range_tiles: 12, effective_range_tiles: 10, accuracy: 0.8, penetration: 60, damage: 300, splash_tiles: 1.5, suppression: 60, rof_per_min: 12, can_target: ['ground', 'structure'] },
    ],
  };

  function fw(kind: 'op' | 'shrine' | 'house'): { sim: Sim; s: number; spot: number; gun: number } {
    const sim = new Sim({ seed: 0x277, width: 32, height: 16, capacity: 16 });
    const types = [sim.addStructureType(OP), sim.addStructureType(SHRINE), sim.addStructureType(HOUSE)];
    const ti = types[kind === 'op' ? 0 : kind === 'shrine' ? 1 : 2];
    const s = rect(sim, ti, 20, 6, 2, 2);
    // A neutral house is not FW state; give that world an owned building far
    // out of everyone's reach so the latch pass and the FW branch are live.
    if (kind === 'house') rect(sim, types[0], 29, 13, 2, 2);
    const spot = sim.spawn(sim.addUnitType(SPOTTER), 0, fx.from(2.5), fx.from(6.5));
    // (9.5, 6.5) to (20.5, 6.5): 11 tiles, inside 12 of range, outside 3 of sight.
    const gun = sim.spawn(sim.addUnitType(BLIND_GUN), 0, fx.from(9.5), fx.from(6.5));
    return { sim, s, spot, gun };
  }

  it('a side-1 building is unknown to side 0 until a side-0 eye has it inside sight, then stays known', () => {
    const { sim, s, spot } = fw('op');
    expect(sim.structures.owner[s]).toBe(1);
    run(sim, 5); // spotter 18 tiles off, gun 11 off with sight 3
    expect(sim.structureKnownTo(0, s)).toBe(false);
    sim.teleport(spot, fx.from(11.5), fx.from(6.5)); // 9 tiles: inside sight 10
    run(sim, 1);
    expect(sim.structureKnownTo(0, s)).toBe(true);
    sim.teleport(spot, fx.from(2.5), fx.from(6.5)); // back out of sight
    run(sim, 40);
    expect(sim.structureKnownTo(0, s)).toBe(true); // a latch, not a ladder
    // Its own side never "finds" it.
    expect(sim.structureKnownTo(1, s)).toBe(false);
  });

  it('inside sight is not enough: a wall across the sight line keeps it unknown', () => {
    const { sim, s, spot } = fw('op');
    const ridge = sim.addStructureType(RIDGE);
    rect(sim, ridge, 15, 0, 2, 16); // x15-16, the whole height of the map
    sim.teleport(spot, fx.from(11.5), fx.from(6.5));
    run(sim, 10);
    expect(sim.structureKnownTo(0, s)).toBe(false);
  });

  it('a neutral building never latches, for either side', () => {
    const { sim, s, spot } = fw('house');
    expect(sim.fieldWorksLive).toBe(true);
    sim.teleport(spot, fx.from(18.5), fx.from(6.5)); // two tiles off
    run(sim, 10);
    expect(sim.structures.known[s]).toBe(0);
    expect(sim.structures.known[256 + s]).toBe(0);
  });

  it('takes a seen side-1 building in the fallback slot, empty as it is', () => {
    const { sim, s, spot, gun } = fw('op');
    sim.teleport(spot, fx.from(11.5), fx.from(6.5)); // the spotter finds it for the gun
    const ev = run(sim, 200); // HE fires every 5 s; 10 s holds two
    expect(sim.structureKnownTo(0, s)).toBe(true);
    expect(sim.state.curStructure[gun]).toBe(s);
    // At 11 tiles the round mostly misses (pHit ~0.28), so the witness is the
    // shot at the building, not a hit on it.
    expect(ev.some((e) => e.kind === 'fire' && e.shooter === gun && e.structure === s)).toBe(true);
  });

  it('does not take it without the latch', () => {
    const { sim, s, gun } = fw('op'); // spotter stays 18 tiles off
    const ev = run(sim, 200);
    expect(sim.structureKnownTo(0, s)).toBe(false);
    expect(sim.state.curStructure[gun]).toBe(-1);
    expect(ev.some((e) => e.kind === 'fire')).toBe(false);
  });

  it('a unit target outranks the building: the building is the fallback slot only', () => {
    const { sim, s, spot, gun } = fw('op');
    sim.teleport(spot, fx.from(11.5), fx.from(6.5));
    // An enemy at (12.5, 10.5): 5 tiles from the spotter (identified), 5 from the gun.
    const foe = sim.spawn(sim.addUnitType(SPOTTER), 1, fx.from(12.5), fx.from(10.5));
    let checked = 0;
    for (let i = 0; i < 100; i++) {
      sim.tick();
      if (sim.state.alive[foe] === 1 && sim.state.curTarget[gun] === foe) {
        expect(sim.state.curStructure[gun]).toBe(-1);
        checked++;
      }
    }
    expect(sim.structureKnownTo(0, s)).toBe(true);
    expect(checked).toBeGreaterThan(0);
  });

  it('does not take a PROTECTED_ROE side-1 building, seen or not', () => {
    const { sim, s, spot, gun } = fw('shrine');
    sim.teleport(spot, fx.from(11.5), fx.from(6.5));
    const ev = run(sim, 200);
    expect(sim.structureKnownTo(0, s)).toBe(true);
    expect(sim.state.curStructure[gun]).toBe(-1);
    expect(ev.some((e) => e.kind === 'fire')).toBe(false);
  });

  it("never takes a building its own side owns, even with that side's latch byte forced", () => {
    // The latch only ever sets for the OTHER side, so this byte is unreachable
    // in play; forcing it through the view is the one input that can tell
    // whether selectStructureTarget checks the owner against the shooter.
    const { sim, s, gun } = fw('op');
    sim.setStructureOwner(s, 0);
    sim.structures.known[s] = 1; // side 0's byte for structure s
    const ev = run(sim, 200);
    expect(sim.state.curStructure[gun]).toBe(-1);
    expect(ev.some((e) => e.kind === 'fire')).toBe(false);
  });

  it('still never shoots an empty neutral house', () => {
    const { sim, s, spot, gun } = fw('house');
    expect(sim.structures.owner[s]).toBe(-1);
    sim.teleport(spot, fx.from(11.5), fx.from(6.5));
    const ev = run(sim, 200);
    expect(sim.state.curStructure[gun]).toBe(-1);
    expect(ev.some((e) => e.kind === 'fire')).toBe(false);
  });
});

describe('field works: a mission placement owns its structure', () => {
  const OP = { id: 'fw_op', name: 'Outpost', hp_per_tile: 300, owner: 1 };

  function start(structures: MissionJson['structures']): Sim {
    const sim = new Sim({ seed: 3, width: 32, height: 16, capacity: 16 });
    const t = sim.addUnitType(RIFLES);
    sim.addStructureType(HOUSE);
    sim.addStructureType(OP);
    const mission: MissionJson = {
      id: 'fw_owner', map: { file: 'none', player_start: [2, 2] },
      ledger: { requires: [], produces: [] },
      objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
      starting_force: [{ unit: 's_inf', count: 1, at: [2, 12] }],
      ...(structures !== undefined ? { structures } : {}),
    };
    new MissionRuntime(sim, mission, { typeIdOf: () => t, markers: {}, zones: {} }).start();
    return sim;
  }

  it("raises `owner` over the type's default, and takes the default without one", () => {
    const sim = start([
      { type: 'house', at: [4, 4], size: [2, 2], owner: 1 },
      { type: 'house', at: [8, 4], size: [2, 2] },
      { type: 'fw_op', at: [12, 4], size: [2, 2] },
      { type: 'fw_op', at: [16, 4], size: [2, 2], owner: -1 },
      { type: 'fw_op', at: [20, 4], size: [2, 2], owner: 0 },
    ]);
    expect([0, 1, 2, 3, 4].map((s) => sim.structures.owner[s])).toEqual([1, -1, 1, -1, 0]);
    // `side` stays F4's produces_for and is untouched by `owner` (D2).
    expect(sim.structureProducesFor(0)).toBe(-1);
    expect(sim.fieldWorksLive).toBe(true);
  });

  it('a mission with only neutral placements is not FW-live', () => {
    const sim = start([{ type: 'house', at: [4, 4], size: [2, 2] }]);
    expect(sim.fieldWorksLive).toBe(false);
  });

  it('refuses an owner the schema enum would refuse', () => {
    expect(() => start([{ type: 'house', at: [4, 4], size: [2, 2], owner: 2 }])).toThrow(/owner 2, expected -1, 0 or 1/);
  });
});
