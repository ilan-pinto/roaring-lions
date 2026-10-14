import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';
import { IDENTIFIED_AT, LOST_AT } from './tuning';

// Targeted fire (GH-420), Task 1: the `attack` command and the two columns it
// writes, `focusTarget` and `focusLost`. Nothing READS the focus yet; these
// tests pin that it is set, refused, released and hashed. Every fixture is
// inline, with `role: 'infantry'` where a unit should brace (a type with no
// role derives as wheeled), and contact is seeded through `identifyTo`, the
// sim's own reveal path, never by writing `contact`.

const GUN = {
  type: 'small_arms',
  range_tiles: 8,
  effective_range_tiles: 6,
  accuracy: 0.6,
  penetration: 8,
  damage: 1,
  suppression: 0,
  rof_per_min: 300,
};

const RIFLES: UnitTypeJson = {
  id: 'f_rifles',
  role: 'infantry',
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [{ id: 'rifle', ...GUN }],
};

/** Two slots: an air-only gun first, a ground gun second. */
const TWO_SLOT: UnitTypeJson = {
  id: 'f_two_slot',
  role: 'mbt',
  hull: { hp: 100000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 1 },
  weapons: [
    { id: 'aa', ...GUN, can_target: ['air'] },
    { id: 'gun', ...GUN },
  ],
};

/** Only ever aimed at the sky. */
const AA_ONLY: UnitTypeJson = {
  ...TWO_SLOT,
  id: 'f_aa_only',
  weapons: [{ id: 'aa', ...GUN, can_target: ['air'] }],
};

/** Something to shoot at: unarmed, near-indestructible, can hide in a house. */
const POST: UnitTypeJson = {
  id: 'f_post',
  role: 'infantry',
  hull: { hp: 1000000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
  abilities: ['garrison'],
};

const CARRIER: UnitTypeJson = {
  id: 'f_carrier',
  role: 'apc',
  hull: { hp: 1000000, armor: { front: 20, side: 15, rear: 10 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};

const HOUSE = { id: 'f_house', name: 'House', hp_per_tile: 100000, garrison_slots: 2, rubble_cover: 2 };

interface World {
  sim: Sim;
  rifles: number;
  post: number;
  /** Own rifleman, west. */
  me: number;
  /** Enemy post, six tiles east, identified to side 0. */
  foe: number;
}

function world(): World {
  const sim = new Sim({ seed: 0x420, width: 64, height: 32, capacity: 32 });
  const rifles = sim.addUnitType(RIFLES);
  const post = sim.addUnitType(POST);
  const me = sim.spawn(rifles, 0, fx.from(10.5), fx.from(16.5));
  const foe = sim.spawn(post, 1, fx.from(16.5), fx.from(16.5));
  sim.identifyTo(0, foe);
  return { sim, rifles, post, me, foe };
}

/** Read a private column; the tests need two the state view does not expose. */
function column(sim: Sim, name: string): Uint8Array {
  const v: unknown = Reflect.get(sim, name);
  if (!(v instanceof Uint8Array)) throw new Error(`no column ${name}`);
  return v;
}

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

describe('attack: the focus is set', () => {
  it('attack sets the focus and clears attackMove and sweepOrder', () => {
    const { sim, me, foe } = world();
    sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(30.5), y: fx.from(16.5), sweep: true });
    sim.tick();
    expect(column(sim, 'attackMove')[me]).toBe(1);
    expect(column(sim, 'sweepOrder')[me]).toBe(1);
    expect(sim.state.moving[me]).toBe(1);

    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(foe);
    expect(sim.state.focusLost[me]).toBe(0);
    expect(column(sim, 'attackMove')[me]).toBe(0);
    expect(column(sim, 'sweepOrder')[me]).toBe(0);
    // Not a halt in disguise (the focus is set), but the old leg is dropped:
    // nothing yet walks the unit to its focus.
    expect(sim.state.moving[me]).toBe(0);
  });

  it('the columns start at -1 and 0', () => {
    const { sim, me, foe } = world();
    expect(sim.state.focusTarget[me]).toBe(-1);
    expect(sim.state.focusTarget[foe]).toBe(-1);
    expect(sim.state.focusLost[me]).toBe(0);
  });

  it('attack resets the lost counter', () => {
    const { sim, me, foe } = world();
    sim.state.focusLost[me] = 40;
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusLost[me]).toBe(0);
  });

  it('a vehicle with an air-only first slot may still focus a ground target', () => {
    const { sim, foe } = world();
    const tank = sim.spawn(sim.addUnitType(TWO_SLOT), 0, fx.from(10.5), fx.from(18.5));
    expect(sim.canFocus(tank, foe)).toBe(true);
    sim.queueCommand({ kind: 'attack', ids: [tank], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[tank]).toBe(foe);
  });

  it('a garrisoned shooter keeps its building when ordered to attack', () => {
    const { sim, me, foe } = world();
    const w = sim.width;
    const house = sim.addStructure(sim.addStructureType(HOUSE), [16 * w + 11, 16 * w + 12, 17 * w + 11, 17 * w + 12]);
    sim.queueCommand({ kind: 'garrison', ids: [me], structure: house });
    run(sim, 10 * TICKS_PER_SECOND);
    expect(sim.state.garrisonedIn[me]).toBe(house);

    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(foe);
    expect(sim.state.garrisonedIn[me]).toBe(house);
  });
});

describe('attack: refusals (T-D2)', () => {
  it('attack on a suspected enemy is refused', () => {
    const { sim, me, foe } = world();
    // Out of everyone's sight, so the contact only decays.
    sim.teleport(foe, fx.from(55.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    let ticks = 0;
    while (sim.contactConfidence(0, foe) >= IDENTIFIED_AT && ticks++ < 2000) sim.tick();
    expect(sim.contactConfidence(0, foe)).toBeLessThan(IDENTIFIED_AT);
    // The band that matters: the latched STATE still says identified while the
    // confidence selectTarget tests has already dropped.
    expect(sim.contactLevel(0, foe)).toBe(2);
    expect(sim.contactConfidence(0, foe)).toBeGreaterThanOrEqual(LOST_AT);

    expect(sim.canFocus(me, foe)).toBe(false);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(-1);
  });

  it('attack on an enemy never seen is refused', () => {
    const { sim, me, post } = world();
    const stranger = sim.spawn(post, 1, fx.from(20.5), fx.from(16.5));
    expect(sim.canFocus(me, stranger)).toBe(false);
    sim.queueCommand({ kind: 'attack', ids: [me], target: stranger });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(-1);
  });

  it("a refused attack leaves the unit's order untouched", () => {
    const { sim, me, post } = world();
    const stranger = sim.spawn(post, 1, fx.from(20.5), fx.from(16.5));
    sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(40.5), y: fx.from(16.5) });
    sim.tick();
    expect(column(sim, 'attackMove')[me]).toBe(1);
    expect(sim.state.moving[me]).toBe(1);
    sim.state.focusLost[me] = 7;

    sim.queueCommand({ kind: 'attack', ids: [me], target: stranger });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(-1);
    expect(column(sim, 'attackMove')[me]).toBe(1);
    expect(sim.state.moving[me]).toBe(1);
    expect(sim.state.focusLost[me]).toBe(7);
  });

  it('attack on a civilian, a friendly, a garrisoned or a carried unit is refused', () => {
    const { sim, me, rifles, post, foe } = world();
    const civ = sim.spawn(post, 2, fx.from(14.5), fx.from(14.5));
    const friend = sim.spawn(rifles, 0, fx.from(10.5), fx.from(14.5));
    const w = sim.width;
    const house = sim.addStructure(sim.addStructureType(HOUSE), [20 * w + 20, 20 * w + 21, 21 * w + 20, 21 * w + 21]);
    const inside = sim.spawn(post, 1, fx.from(19.5), fx.from(20.5));
    const car = sim.spawn(sim.addUnitType(CARRIER), 1, fx.from(30.5), fx.from(8.5));
    const rider = sim.spawn(post, 1, fx.from(29.5), fx.from(8.5));
    sim.queueCommand({ kind: 'garrison', ids: [inside], structure: house });
    sim.queueCommand({ kind: 'load', ids: [rider], carrier: car });
    run(sim, 20 * TICKS_PER_SECOND);
    expect(sim.state.garrisonedIn[inside]).toBe(house);
    expect(sim.state.carriedBy[rider]).toBe(car);
    // Every one of them is identified, so only the rule can be what refuses.
    for (const t of [civ, friend, inside, rider, foe]) sim.identifyTo(0, t);

    // The positive control: the same shooter, a plain identified enemy.
    expect(sim.canFocus(me, foe)).toBe(true);
    for (const target of [civ, friend, inside, rider]) {
      expect(sim.canFocus(me, target)).toBe(false);
      sim.queueCommand({ kind: 'attack', ids: [me], target });
      sim.tick();
      expect(sim.state.focusTarget[me]).toBe(-1);
    }
  });

  it('attack on a dead enemy is refused', () => {
    const { sim, me, foe } = world();
    sim.debugKill(foe);
    expect(sim.canFocus(me, foe)).toBe(false);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(-1);
  });

  it('a shooter that could never aim at the target is refused', () => {
    const { sim, foe } = world();
    const aa = sim.spawn(sim.addUnitType(AA_ONLY), 0, fx.from(10.5), fx.from(18.5));
    expect(sim.canFocus(aa, foe)).toBe(false);
    sim.queueCommand({ kind: 'attack', ids: [aa], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[aa]).toBe(-1);
  });

  it('an unarmed, dead, carried or routed shooter is refused', () => {
    const { sim, rifles, post, foe } = world();
    const unarmed = sim.spawn(post, 0, fx.from(10.5), fx.from(12.5));
    expect(sim.canFocus(unarmed, foe)).toBe(false);

    const dead = sim.spawn(rifles, 0, fx.from(10.5), fx.from(13.5));
    sim.debugKill(dead);
    expect(sim.canFocus(dead, foe)).toBe(false);

    const car = sim.spawn(sim.addUnitType(CARRIER), 0, fx.from(12.5), fx.from(24.5));
    const rider = sim.spawn(rifles, 0, fx.from(11.5), fx.from(24.5));
    sim.queueCommand({ kind: 'load', ids: [rider], carrier: car });
    run(sim, 20 * TICKS_PER_SECOND);
    expect(sim.state.carriedBy[rider]).toBe(car);
    sim.identifyTo(0, foe);
    expect(sim.canFocus(rider, foe)).toBe(false);

    const shaky = sim.spawn(rifles, 0, fx.from(10.5), fx.from(28.5));
    let routed = false;
    for (let t = 0; t < 400 && !routed; t++) {
      sim.debugSuppress(shaky, fx.from(2));
      for (const e of sim.tick()) if (e.kind === 'routed' && e.entity === shaky) routed = true;
    }
    expect(routed).toBe(true);
    sim.identifyTo(0, foe);
    expect(sim.canFocus(shaky, foe)).toBe(false);
  });

  it('a mixed order focuses the units that may and skips the one that may not', () => {
    const { sim, me, foe, post } = world();
    const unarmed = sim.spawn(post, 0, fx.from(10.5), fx.from(12.5));
    sim.queueCommand({ kind: 'attack', ids: [unarmed, me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(foe);
    expect(sim.state.focusTarget[unarmed]).toBe(-1);
  });
});

describe('the focus is released', () => {
  const orders: [string, (w: World) => Parameters<Sim['queueCommand']>[0]][] = [
    ['move', (w) => ({ kind: 'move', ids: [w.me], x: fx.from(4.5), y: fx.from(16.5) })],
    ['appended move', (w) => ({ kind: 'move', ids: [w.me], x: fx.from(4.5), y: fx.from(16.5), append: true })],
    ['attackMove', (w) => ({ kind: 'attackMove', ids: [w.me], x: fx.from(4.5), y: fx.from(16.5) })],
    ['halt', (w) => ({ kind: 'halt', ids: [w.me] })],
  ];
  for (const [name, make] of orders) {
    it(`any other order releases the focus: ${name}`, () => {
      const w = world();
      w.sim.queueCommand({ kind: 'attack', ids: [w.me], target: w.foe });
      w.sim.tick();
      expect(w.sim.state.focusTarget[w.me]).toBe(w.foe);
      w.sim.state.focusLost[w.me] = 12;

      w.sim.queueCommand(make(w));
      w.sim.tick();
      expect(w.sim.state.focusTarget[w.me]).toBe(-1);
      expect(w.sim.state.focusLost[w.me]).toBe(0);
    });
  }

  it('an order for someone else leaves the focus alone', () => {
    const w = world();
    const other = w.sim.spawn(w.rifles, 0, fx.from(10.5), fx.from(14.5));
    w.sim.queueCommand({ kind: 'attack', ids: [w.me], target: w.foe });
    w.sim.tick();
    w.sim.queueCommand({ kind: 'halt', ids: [other] });
    w.sim.tick();
    expect(w.sim.state.focusTarget[w.me]).toBe(w.foe);
  });

  it('a second attack replaces the first', () => {
    const w = world();
    const foe2 = w.sim.spawn(w.post, 1, fx.from(16.5), fx.from(18.5));
    w.sim.identifyTo(0, foe2);
    w.sim.queueCommand({ kind: 'attack', ids: [w.me], target: w.foe });
    w.sim.tick();
    w.sim.queueCommand({ kind: 'attack', ids: [w.me], target: foe2 });
    w.sim.tick();
    expect(w.sim.state.focusTarget[w.me]).toBe(foe2);
  });

  it('a rout releases the focus', () => {
    const { sim, me, foe } = world();
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(foe);
    sim.state.focusLost[me] = 9;
    let routed = false;
    for (let t = 0; t < 400 && !routed; t++) {
      sim.debugSuppress(me, fx.from(2));
      for (const e of sim.tick()) if (e.kind === 'routed' && e.entity === me) routed = true;
    }
    expect(routed).toBe(true);
    expect(sim.state.focusTarget[me]).toBe(-1);
    expect(sim.state.focusLost[me]).toBe(0);
  });
});
