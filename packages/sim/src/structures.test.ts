import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

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
    const hpAfter = (attacker: UnitTypeJson, seconds: number): number => {
      const { sim, house } = world();
      const t = sim.addUnitType(attacker);
      const inf = sim.addUnitType(RIFLES);
      sim.spawn(t, 0, fx.from(8.5), fx.from(6.5));
      // A defender inside makes the building a legitimate target.
      const g = sim.spawn(inf, 1, fx.from(14.5), fx.from(6.5));
      sim.queueCommand({ kind: 'garrison', ids: [g], structure: house });
      run(sim, seconds * TICKS_PER_SECOND);
      return fx.toNumber(sim.structures.hp[house]) / fx.toNumber(sim.structures.maxHp[house]);
    };
    expect(hpAfter(GUNS, 60)).toBeLessThan(0.2);
    expect(hpAfter(RIFLES, 60)).toBeGreaterThan(0.9);
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
    const inf = sim.addUnitType(RIFLES);
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
