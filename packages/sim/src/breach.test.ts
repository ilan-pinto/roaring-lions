import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

// An attacker stopped dead against a wall on its way somewhere cuts through it.
// A defender standing in his own compound does not. The gap between those two
// sentences is the whole of this feature, and most of it is in the conditions
// rather than in the firing.

const FENCE = {
  id: 'wall',
  name: 'Compound Wall',
  hp_per_tile: 200,
  garrison_slots: 0,
  rubble_cover: 1,
  low_profile: true,
  standing_cover: 2,
};
/** Same numbers, but garrisonable — a building, which is never breach fodder. */
const HOUSE = { id: 'house', name: 'House', hp_per_tile: 200, garrison_slots: 2, rubble_cover: 2 };
/** Same numbers, but a protected site. */
const SHRINE = {
  id: 'shrine',
  name: 'Shrine',
  hp_per_tile: 200,
  garrison_slots: 0,
  rubble_cover: 1,
  low_profile: true,
  roe_penalty: 30,
};

const RPG: UnitTypeJson = {
  id: 'b_rpg',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.4 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.7 },
  weapons: [
    { id: 'rpg7', type: 'rpg', range_tiles: 5, effective_range_tiles: 4, accuracy: 0.5, penetration: 500, damage: 300, suppression: 40, rof_per_min: 4, can_target: ['ground', 'structure'] },
  ],
};

const RIFLES: UnitTypeJson = {
  id: 'b_inf',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 },
  ],
};

const MORTAR: UnitTypeJson = {
  id: 'b_mortar',
  role: 'artillery',
  hull: { hp: 300, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [
    { id: 'mortar_82', type: 'mortar', range_tiles: 30, min_range_tiles: 4, effective_range_tiles: 24, accuracy: 0.4, penetration: 20, damage: 200, splash_tiles: 2, suppression: 70, rof_per_min: 3, can_target: ['ground', 'structure'] },
  ],
};

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

/** A wall right across the map at x=16, with no way round it at all. */
function sealed(spec: typeof FENCE | typeof HOUSE | typeof SHRINE = FENCE) {
  const sim = new Sim({ seed: 3, width: 32, height: 16, capacity: 32 });
  const type = sim.addStructureType(spec);
  const walls: number[] = [];
  for (let y = 0; y < sim.height; y++) walls.push(sim.addStructure(type, [y * sim.width + 16]));
  return { sim, walls };
}

describe('an attacker breaches the wall in its way', () => {
  it('cuts a one-tile hole and walks through it', () => {
    const { sim, walls } = sealed();
    const rpg = sim.addUnitType(RPG);
    const u = sim.spawn(rpg, 1, fx.from(13.5), fx.from(8.5));
    sim.queueCommand({ kind: 'attackMove', ids: [u], x: fx.from(28.5), y: fx.from(8.5) });

    const events = run(sim, 90 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'structureHit')).toBe(true);
    const down = events.filter((e) => e.kind === 'structureDestroyed');
    expect(down.length).toBeGreaterThan(0);

    // A hole, not a demolished run: the neighbours are still standing.
    const holes = walls.filter((w) => sim.structures.alive[w] === 0);
    expect(holes.length).toBeLessThan(walls.length);
    expect(sim.structures.alive[walls[0]]).toBe(1);

    run(sim, 60 * TICKS_PER_SECOND);
    expect(fx.toNumber(sim.state.posX[u])).toBeGreaterThan(16);
  });

  it('leaves a garrisonable building alone — that is what killing the men inside is for', () => {
    const { sim } = sealed(HOUSE);
    const rpg = sim.addUnitType(RPG);
    const u = sim.spawn(rpg, 1, fx.from(13.5), fx.from(8.5));
    sim.queueCommand({ kind: 'attackMove', ids: [u], x: fx.from(28.5), y: fx.from(8.5) });
    const events = run(sim, 90 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'structureHit')).toBe(false);
  });

  it('leaves a protected site alone', () => {
    const { sim } = sealed(SHRINE);
    const rpg = sim.addUnitType(RPG);
    const u = sim.spawn(rpg, 1, fx.from(13.5), fx.from(8.5));
    sim.queueCommand({ kind: 'attackMove', ids: [u], x: fx.from(28.5), y: fx.from(8.5) });
    const events = run(sim, 90 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'structureHit')).toBe(false);
  });

  it('never lets a mortar self-initiate: it cannot shoot what it is standing on', () => {
    // min_range 4 against a breach radius of 2.5. Worth pinning, because a
    // mission author reaching for mortars to open a wall will be surprised.
    const { sim } = sealed();
    const mortar = sim.addUnitType(MORTAR);
    const u = sim.spawn(mortar, 1, fx.from(13.5), fx.from(8.5));
    sim.queueCommand({ kind: 'attackMove', ids: [u], x: fx.from(28.5), y: fx.from(8.5) });
    const events = run(sim, 90 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'structureHit')).toBe(false);
  });
});

describe('a defender does not cut his own wire', () => {
  it('holding position beside the wall, with an enemy on the far side', () => {
    const { sim, walls } = sealed();
    const rpg = sim.addUnitType(RPG);
    const rifles = sim.addUnitType(RIFLES);
    const defender = sim.spawn(rifles, 0, fx.from(14.5), fx.from(8.5)); // no order at all
    sim.spawn(rpg, 1, fx.from(19.5), fx.from(8.5));

    run(sim, 120 * TICKS_PER_SECOND);
    for (const w of walls) expect(sim.structures.hp[w]).toBe(sim.structures.maxHp[w]);
    expect(sim.state.curStructure[defender]).toBe(-1);
  });

  it('repositioning inside its own compound, with the gate elsewhere', () => {
    // The case that kills the obvious rule. "The wall tile is closer to my goal
    // than I am" is true of the panel beside an open gate, so a unit walking
    // four tiles across its own yard would open fire on its own perimeter.
    const sim = new Sim({ seed: 3, width: 32, height: 24, capacity: 32 });
    const wallType = sim.addStructureType(FENCE);
    const walls: number[] = [];
    // A wall along y=12 with a gate at x=10, and the unit moving across it.
    for (let x = 4; x <= 20; x++) {
      if (x === 10) continue;
      walls.push(sim.addStructure(wallType, [12 * sim.width + x]));
    }
    const rifles = sim.addUnitType(RIFLES);
    const u = sim.spawn(rifles, 0, fx.from(14.5), fx.from(10.5));
    sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(14.5), y: fx.from(15.5) });

    run(sim, 90 * TICKS_PER_SECOND);
    for (const w of walls) expect(sim.structures.hp[w]).toBe(sim.structures.maxHp[w]);
    // and it got there, the long way round through the gate
    expect(fx.toNumber(sim.state.posY[u])).toBeGreaterThan(14);
  });
});

describe('gates stay the main event', () => {
  it('an attacker with an open gate walks through it rather than cutting', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 16, capacity: 32 });
    const wallType = sim.addStructureType(FENCE);
    const walls: number[] = [];
    for (let y = 0; y < sim.height; y++) {
      if (y === 8 || y === 9) continue; // the gate, dead ahead
      walls.push(sim.addStructure(wallType, [y * sim.width + 16]));
    }
    const rpg = sim.addUnitType(RPG);
    const u = sim.spawn(rpg, 1, fx.from(13.5), fx.from(8.5));
    sim.queueCommand({ kind: 'attackMove', ids: [u], x: fx.from(28.5), y: fx.from(8.5) });

    run(sim, 90 * TICKS_PER_SECOND);
    for (const w of walls) expect(sim.structures.hp[w]).toBe(sim.structures.maxHp[w]);
    expect(fx.toNumber(sim.state.posX[u])).toBeGreaterThan(16);
  });
});
