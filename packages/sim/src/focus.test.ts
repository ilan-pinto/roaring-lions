import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { BRACE_KNEELING, BRACE_NONE, Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import { FOCUS_LOST_TICKS, IDENTIFIED_AT, KNEEL_DROP_TICKS, LOST_AT } from './tuning';

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
  hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [{ id: 'rifle', ...GUN }],
};

/** Two slots: an air-only gun first, a ground gun second. */
const TWO_SLOT: UnitTypeJson = {
  id: 'f_two_slot',
  role: 'mbt',
  hull: { hp: 30000, armor: { front: 700, side: 300, rear: 150 } },
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
  hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
  abilities: ['garrison'],
};

const CARRIER: UnitTypeJson = {
  id: 'f_carrier',
  role: 'apc',
  hull: { hp: 30000, armor: { front: 20, side: 15, rear: 10 }, transport_slots: 2 },
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
    // Not a halt in disguise (the focus is set), but the old leg is dropped;
    // the focus is six tiles off, inside the rifle's effective range, so
    // stepFocus (Task 2) leaves it standing.
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

// ---------------------------------------------------------------------------
// Task 2: the behaviour. selectTarget prefers the focus (R-2), stepFocus walks
// the unit into reach (R-3), loses it (R-4) and hands it back (T-D3, T-D4).

/** Read a private Int32Array column (lastSeenX/Y, fieldRef). */
function int32(sim: Sim, name: string): Int32Array {
  const v: unknown = Reflect.get(sim, name);
  if (!(v instanceof Int32Array)) throw new Error(`no column ${name}`);
  return v;
}

function runCollect(sim: Sim, ticks: number, each?: () => void): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    each?.();
    for (const e of sim.tick()) out.push(e);
  }
  return out;
}

function firesBy(events: SimEvent[], shooter: number): Extract<SimEvent, { kind: 'fire' }>[] {
  const out: Extract<SimEvent, { kind: 'fire' }>[] = [];
  for (const e of events) if (e.kind === 'fire' && e.shooter === shooter) out.push(e);
  return out;
}

function tiles(sim: Sim, a: number, b: number): number {
  const dx = fx.toNumber(sim.state.posX[a]) - fx.toNumber(sim.state.posX[b]);
  const dy = fx.toNumber(sim.state.posY[a]) - fx.toNumber(sim.state.posY[b]);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Armoured, unarmed-looking APC plate (apc_eitan's 220/140/90), armed so it
 *  is not "soft" by any rule, and too tough to die in a test. */
const APC: UnitTypeJson = {
  id: 'f_apc',
  role: 'apc',
  hull: { hp: 30000, armor: { front: 220, side: 140, rear: 90 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
  weapons: [{ id: 'apc_mg', ...GUN, can_target: ['air'] }],
};

const TANK_MG = { id: 'tank_mg', type: 'hmg', range_tiles: 8, effective_range_tiles: 7, accuracy: 0.5, penetration: 22, damage: 1, rof_per_min: 120 };

/** A tank: an anti-armour gun in slot 0, a machine gun in slot 1 whose
 *  penetration (22) cannot touch the APC's 90 mm rear, let alone its front. */
const TANK: UnitTypeJson = {
  id: 'f_tank',
  role: 'mbt',
  hull: { hp: 30000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
  weapons: [
    { id: 'tank_gun', type: 'apfsds', range_tiles: 10, effective_range_tiles: 9, accuracy: 0.85, penetration: 1300, damage: 1, rof_per_min: 60 },
    TANK_MG,
  ],
};

/** mbt_lavi's plate, unarmed: what a rifle cannot hurt from the front. */
const HEAVY: UnitTypeJson = {
  id: 'f_heavy',
  role: 'mbt',
  hull: { hp: 30000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};

const MORTAR: UnitTypeJson = {
  id: 'f_mortar',
  role: 'artillery',
  hull: { hp: 30000, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [
    { id: 'mortar_82', type: 'mortar', range_tiles: 30, min_range_tiles: 4, effective_range_tiles: 24, accuracy: 0.4, penetration: 20, damage: 1, splash_tiles: 1, suppression: 0, rof_per_min: 30, can_target: ['ground'] },
  ],
};

/** A short slot 0 and a long slot 1 that hurts: R-3's two-slot case. */
const LONG_ARM: UnitTypeJson = {
  id: 'f_long_arm',
  role: 'mbt',
  hull: { hp: 30000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 14, signature: 1 },
  weapons: [
    { id: 'short', ...GUN, range_tiles: 4, effective_range_tiles: 3 },
    { id: 'long', ...GUN, range_tiles: 12, effective_range_tiles: 10 },
  ],
};

describe('focus: whom the unit shoots (R-2)', () => {
  function layout(order: boolean): { fires: Extract<SimEvent, { kind: 'fire' }>[]; near: number; far: number } {
    const { sim, me, post } = world();
    const near = sim.spawn(post, 1, fx.from(13.5), fx.from(16.5));
    const far = sim.spawn(post, 1, fx.from(15.5), fx.from(16.5));
    sim.identifyTo(0, near);
    sim.identifyTo(0, far);
    if (order) sim.queueCommand({ kind: 'attack', ids: [me], target: far });
    return { fires: firesBy(runCollect(sim, 3 * TICKS_PER_SECOND), me), near, far };
  }

  it('a focused unit shoots its focus, not the nearer enemy', () => {
    const control = layout(false);
    expect(control.fires.length).toBeGreaterThan(0);
    expect(control.fires.every((e) => e.target === control.near)).toBe(true);

    const ordered = layout(true);
    expect(ordered.fires.length).toBeGreaterThan(0);
    expect(ordered.fires.every((e) => e.target === ordered.far)).toBe(true);
  });

  it('slot 1 keeps its own target when it cannot hurt the focus (T-D5)', () => {
    const sim = new Sim({ seed: 0x421, width: 64, height: 32, capacity: 16 });
    const tank = sim.spawn(sim.addUnitType(TANK), 0, fx.from(10.5), fx.from(16.5), 0);
    // The APC turns its front to the tank; the rifle post is nearer.
    const apc = sim.spawn(sim.addUnitType(APC), 1, fx.from(16.5), fx.from(16.5), 32768);
    const inf = sim.spawn(sim.addUnitType(POST), 1, fx.from(14.5), fx.from(16.5));
    sim.identifyTo(0, apc);
    sim.identifyTo(0, inf);
    // The premise, not the result: the machine gun alone genuinely cannot
    // hurt the APC from here, and the gun can.
    const mgOnly = sim.addUnitType({ ...TANK, id: 'f_mg_only', weapons: [TANK_MG] });
    const probe = sim.spawn(mgOnly, 0, fx.from(10.5), fx.from(16.5), 0);
    expect(sim.focusHurts(probe, apc)).toBe(false);
    sim.debugKill(probe);
    sim.queueCommand({ kind: 'attack', ids: [tank], target: apc });
    const fires = firesBy(runCollect(sim, 5 * TICKS_PER_SECOND), tank);
    const gun = fires.filter((e) => e.weaponId === 'tank_gun');
    const mg = fires.filter((e) => e.weaponId === 'tank_mg');
    expect(gun.length).toBeGreaterThan(0);
    expect(mg.length).toBeGreaterThan(0);
    expect(gun.every((e) => e.target === apc)).toBe(true);
    expect(mg.every((e) => e.target === inf)).toBe(true);
    expect(sim.state.focusTarget[tank]).toBe(apc);
  });

  it('a focus the slot cannot hurt is not preferred, and the order survives', () => {
    const { sim, me, foe } = world();
    sim.teleport(foe, fx.from(60.5), fx.from(2.5)); // out of the picture
    // A rifle (pen 8) against a tank's front: not a firing solution. A soft
    // post FURTHER away is what the scan picks, as it would with no order.
    const heavy = sim.spawn(sim.addUnitType(HEAVY), 1, fx.from(15.5), fx.from(16.5), 32768);
    const soft = sim.spawn(sim.addUnitType(POST), 1, fx.from(10.5), fx.from(22.5));
    sim.identifyTo(0, heavy);
    sim.identifyTo(0, soft);
    sim.queueCommand({ kind: 'attack', ids: [me], target: heavy });
    const fires = firesBy(
      runCollect(sim, 3 * TICKS_PER_SECOND, () => sim.identifyTo(0, heavy)),
      me,
    );
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.every((e) => e.target === soft)).toBe(true);
    expect(sim.state.focusTarget[me]).toBe(heavy);
  });

  it('an indirect weapon fires on its focus without a sight line', () => {
    function mortarRun(order: boolean): { fires: Extract<SimEvent, { kind: 'fire' }>[]; open: number; hidden: number } {
      const sim = new Sim({ seed: 0x422, width: 64, height: 32, capacity: 16 });
      const post = sim.addUnitType(POST);
      const mortar = sim.spawn(sim.addUnitType(MORTAR), 0, fx.from(10.5), fx.from(16.5));
      // A wall between the mortar and the focus; a nearer enemy in the open.
      for (let y = 8; y <= 24; y++) sim.setBlocked(14, y, true);
      const hidden = sim.spawn(post, 1, fx.from(20.5), fx.from(16.5));
      const open = sim.spawn(post, 1, fx.from(10.5), fx.from(22.5));
      sim.identifyTo(0, open);
      sim.identifyTo(0, hidden);
      if (order) sim.queueCommand({ kind: 'attack', ids: [mortar], target: hidden });
      // Someone else keeps eyes on the hidden one (a spotter's reveal).
      const events = runCollect(sim, 6 * TICKS_PER_SECOND, () => sim.identifyTo(0, hidden));
      return { fires: firesBy(events, mortar), open, hidden };
    }
    const control = mortarRun(false);
    expect(control.fires.length).toBeGreaterThan(0);
    expect(control.fires.every((e) => e.target === control.open)).toBe(true);

    const ordered = mortarRun(true);
    expect(ordered.fires.length).toBeGreaterThan(0);
    expect(ordered.fires.every((e) => e.target === ordered.hidden)).toBe(true);
  });
});

describe('focus: closing and reach (R-3)', () => {
  it('a focused unit out of range closes, then stops and kneels', () => {
    const { sim, me, post } = world();
    const far = sim.spawn(post, 1, fx.from(24.5), fx.from(16.5));
    sim.queueCommand({ kind: 'attack', ids: [me], target: far });
    let stopped = -1;
    for (let t = 0; t < 30 * TICKS_PER_SECOND && stopped < 0; t++) {
      sim.identifyTo(0, far);
      sim.tick();
      if (t === 0) expect(sim.state.moving[me]).toBe(1);
      if (t > 0 && sim.state.moving[me] === 0) stopped = t;
    }
    expect(stopped).toBeGreaterThan(0);
    // Inside slot 0's EFFECTIVE range (6), not its maximum (8), and it did
    // not walk on to the target's feet.
    const d = tiles(sim, me, far);
    expect(d).toBeLessThanOrEqual(6);
    expect(d).toBeGreaterThan(5.5);
    expect(sim.state.focusTarget[me]).toBe(far);
    expect(sim.state.brace[me]).toBe(BRACE_NONE);
    const events = runCollect(sim, KNEEL_DROP_TICKS, () => sim.identifyTo(0, far));
    expect(sim.state.brace[me]).toBe(BRACE_KNEELING);
    expect(sim.state.moving[me]).toBe(0);
    const more = runCollect(sim, TICKS_PER_SECOND, () => sim.identifyTo(0, far));
    const fires = firesBy([...events, ...more], me);
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.every((e) => e.target === far)).toBe(true);
  });

  it('in reach uses any slot that can hurt: the long slot 1 sets the stop', () => {
    const sim = new Sim({ seed: 0x423, width: 64, height: 32, capacity: 16 });
    const me = sim.spawn(sim.addUnitType(LONG_ARM), 0, fx.from(4.5), fx.from(16.5));
    const foe = sim.spawn(sim.addUnitType(POST), 1, fx.from(24.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    let t = 0;
    sim.tick();
    expect(sim.state.moving[me]).toBe(1);
    while (sim.state.moving[me] === 1 && t++ < 40 * TICKS_PER_SECOND) {
      sim.identifyTo(0, foe);
      sim.tick();
    }
    const d = tiles(sim, me, foe);
    // Slot 1's effective range is 10; slot 0's is 3.
    expect(d).toBeLessThanOrEqual(10);
    expect(d).toBeGreaterThan(9.5);
    runCollect(sim, 2 * TICKS_PER_SECOND, () => sim.identifyTo(0, foe));
    expect(tiles(sim, me, foe)).toBeGreaterThan(9.5);
  });

  it('a chase refreshes the field by tile, not by tick (T-D6)', () => {
    const { sim, me, foe } = world();
    sim.teleport(foe, fx.from(24.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    // The target walks six tiles east, away from the chaser.
    sim.queueCommand({ kind: 'move', ids: [foe], x: fx.from(30.5), y: fx.from(16.5), exact: true });
    sim.tick();
    const base = sim.flowFieldCount;
    let calls = 0;
    const orig: unknown = Reflect.get(sim, 'fieldFor');
    if (typeof orig !== 'function') throw new Error('no fieldFor');
    Reflect.set(sim, 'fieldFor', (...args: unknown[]): unknown => {
      calls++;
      return Reflect.apply(orig, sim, args);
    });
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    let ticks = 0;
    while (sim.state.moving[foe] === 1 && ticks++ < 20 * TICKS_PER_SECOND) {
      sim.identifyTo(0, foe);
      sim.tick();
      expect(sim.state.moving[me]).toBe(1);
    }
    expect(fx.toNumber(sim.state.posX[foe])).toBeCloseTo(30.5, 3);
    expect(ticks).toBeGreaterThan(5 * TICKS_PER_SECOND);
    // One ask when the order starts, one per tile the target entered.
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(7);
    expect(sim.flowFieldCount - base).toBeLessThanOrEqual(7);
  });
});

describe('focus: the order ends (T-D3, T-D4)', () => {
  it('a dead focus hands the unit back as an arrived attack-mover', () => {
    const { sim, me, foe } = world();
    // The world's own post would sit inside effective range and keep the unit
    // `engaging`, which skips the sweep whatever sweepOrder says.
    sim.debugKill(foe);
    const weak = sim.spawn(sim.addUnitType({ ...POST, id: 'f_weak', hull: { hp: 1, armor: { front: 10, side: 10, rear: 10 } } }), 1, fx.from(14.5), fx.from(16.5));
    // A second enemy, identified, far beyond reach: what a sweep would chase.
    const distant = sim.spawn(sim.addUnitType(POST), 1, fx.from(50.5), fx.from(16.5));
    sim.identifyTo(0, weak);
    sim.identifyTo(0, distant);
    sim.queueCommand({ kind: 'attack', ids: [me], target: weak });
    let killed = false;
    for (let t = 0; t < 20 * TICKS_PER_SECOND && !killed; t++) {
      for (const e of sim.tick()) if (e.kind === 'destroyed' && e.entity === weak) killed = true;
    }
    expect(killed).toBe(true);
    expect(sim.state.focusTarget[me]).toBe(-1);
    expect(sim.state.focusLost[me]).toBe(0);
    expect(column(sim, 'attackMove')[me]).toBe(1);
    expect(column(sim, 'sweepOrder')[me]).toBe(0);
    expect(sim.state.moving[me]).toBe(0);
    expect(int32(sim, 'fieldRef')[me]).toBe(-1);
    const x = sim.state.posX[me];
    const y = sim.state.posY[me];
    runCollect(sim, 10 * TICKS_PER_SECOND, () => sim.identifyTo(0, distant));
    expect(sim.state.posX[me]).toBe(x);
    expect(sim.state.posY[me]).toBe(y);
  });

  it('a focus that garrisons ends the order', () => {
    const { sim, me, foe } = world();
    const w = sim.width;
    sim.teleport(foe, fx.from(30.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    const house = sim.addStructure(sim.addStructureType(HOUSE), [16 * w + 32, 16 * w + 33, 17 * w + 32, 17 * w + 33]);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(foe);
    sim.queueCommand({ kind: 'garrison', ids: [foe], structure: house });
    let t = 0;
    while (sim.state.garrisonedIn[foe] < 0 && t++ < 10 * TICKS_PER_SECOND) {
      sim.identifyTo(0, foe);
      sim.tick();
      if (sim.state.garrisonedIn[foe] < 0) expect(sim.state.focusTarget[me]).toBe(foe);
    }
    expect(sim.state.garrisonedIn[foe]).toBe(house);
    // stepGarrison runs after stepFocus: the order ends on the next tick.
    expect(sim.state.focusTarget[me]).toBe(foe);
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(-1);
    expect(column(sim, 'attackMove')[me]).toBe(1);
    expect(sim.state.moving[me]).toBe(0);
  });

  it('a lost focus walks to its last-seen position, then ends', () => {
    const { sim, me, foe } = world();
    // The target starts in sight (8) but out of reach (6), so the unit is
    // walking when it loses it, and its side last saw it here.
    sim.teleport(foe, fx.from(17.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.moving[me]).toBe(1);
    // Gone, far out of anyone's sight: the contact only decays from here.
    sim.teleport(foe, fx.from(60.5), fx.from(2.5));
    let firstLost = -1;
    let ended = -1;
    let reachedLastSeen = false;
    let waited = 0;
    for (let t = 0; t < 30 * TICKS_PER_SECOND && ended < 0; t++) {
      sim.tick();
      if (firstLost < 0 && sim.state.focusLost[me] > 0) firstLost = t;
      if (firstLost >= 0 && sim.state.focusTarget[me] === foe) {
        const k = foe; // side 0's slot
        const lx = int32(sim, 'lastSeenX')[k] >> 16;
        const ly = int32(sim, 'lastSeenY')[k] >> 16;
        const there = sim.state.posX[me] >> 16 === lx && sim.state.posY[me] >> 16 === ly;
        // Once there it WAITS: no leg re-issued tick after tick, which would
        // drop and raise a halt-to-fire man on the spot.
        if (reachedLastSeen && there) {
          expect(sim.state.moving[me]).toBe(0);
          waited++;
        }
        if (there) reachedLastSeen = true;
      }
      if (sim.state.focusTarget[me] === -1) ended = t;
    }
    expect(firstLost).toBeGreaterThan(0);
    expect(reachedLastSeen).toBe(true);
    expect(waited).toBeGreaterThan(10);
    expect(sim.state.brace[me]).toBe(BRACE_KNEELING);
    // The 100th consecutive lost tick ends it, and not a tick before.
    expect(ended - firstLost + 1).toBe(FOCUS_LOST_TICKS);
    expect(column(sim, 'attackMove')[me]).toBe(1);
    expect(sim.state.moving[me]).toBe(0);
  });

  it('a lost focus with nowhere to look ends at once', () => {
    const { sim, me, foe } = world();
    sim.teleport(foe, fx.from(60.5), fx.from(2.5));
    sim.identifyTo(0, foe);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(foe);
    column(sim, 'lastSeenValid')[foe] = 0;
    let t = 0;
    for (;;) {
      sim.tick();
      if (sim.contactConfidence(0, foe) < IDENTIFIED_AT || t++ > 200) break;
      expect(sim.state.focusTarget[me]).toBe(foe);
    }
    // The very tick the confidence dropped, with no position to walk to.
    expect(sim.contactConfidence(0, foe)).toBeLessThan(IDENTIFIED_AT);
    expect(sim.state.focusTarget[me]).toBe(-1);
  });

  it('a re-identified focus keeps the order', () => {
    const { sim, me, foe } = world();
    sim.teleport(foe, fx.from(20.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    sim.teleport(foe, fx.from(60.5), fx.from(2.5));
    let t = 0;
    while (sim.state.focusLost[me] < FOCUS_LOST_TICKS - 20 && t++ < 400) sim.tick();
    expect(sim.state.focusLost[me]).toBe(FOCUS_LOST_TICKS - 20);
    // A spotter finds it again inside the window.
    sim.identifyTo(0, foe);
    sim.tick();
    expect(sim.state.focusLost[me]).toBe(0);
    // Past the point where an uninterrupted count would have ended it.
    runCollect(sim, 40);
    expect(sim.state.focusTarget[me]).toBe(foe);
    expect(sim.state.focusLost[me]).toBe(0);
  });
});

describe('focus: a dead shooter', () => {
  it("a shooter's death clears its own order", () => {
    const { sim, me, foe } = world();
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(foe);
    sim.state.focusLost[me] = 3;
    sim.debugKill(me);
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(-1);
    expect(sim.state.focusLost[me]).toBe(0);
  });
});

describe('focus: units that do not walk (R-5, R-6)', () => {
  it('a garrisoned focused unit stays in its building, and fires from it once in reach', () => {
    const { sim, me, foe } = world();
    const w = sim.width;
    const house = sim.addStructure(sim.addStructureType(HOUSE), [16 * w + 11, 16 * w + 12, 17 * w + 11, 17 * w + 12]);
    sim.queueCommand({ kind: 'garrison', ids: [me], structure: house });
    runCollect(sim, 10 * TICKS_PER_SECOND);
    expect(sim.state.garrisonedIn[me]).toBe(house);
    sim.teleport(foe, fx.from(30.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    const away = runCollect(sim, 10 * TICKS_PER_SECOND, () => sim.identifyTo(0, foe));
    expect(sim.state.garrisonedIn[me]).toBe(house);
    expect(sim.state.moving[me]).toBe(0);
    expect(sim.state.focusTarget[me]).toBe(foe);
    expect(firesBy(away, me).length).toBe(0);

    sim.teleport(foe, fx.from(16.5), fx.from(16.5));
    const near = runCollect(sim, 3 * TICKS_PER_SECOND, () => sim.identifyTo(0, foe));
    expect(sim.state.garrisonedIn[me]).toBe(house);
    const fires = firesBy(near, me);
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.every((e) => e.target === foe)).toBe(true);
  });

  it('a mobility-killed focused unit keeps the order and never walks', () => {
    const { sim, me, foe } = world();
    sim.teleport(foe, fx.from(30.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    column(sim, 'mobilityKilled')[me] = 1;
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    const x = sim.state.posX[me];
    runCollect(sim, 3 * TICKS_PER_SECOND, () => {
      sim.identifyTo(0, foe);
      expect(sim.state.moving[me]).toBe(0);
    });
    expect(sim.state.posX[me]).toBe(x);
    expect(sim.state.focusTarget[me]).toBe(foe);
  });

  it('a firepower-killed focused unit keeps the order harmlessly', () => {
    const { sim, me, foe } = world();
    sim.teleport(foe, fx.from(30.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    sim.debugDisableFirepower(me);
    // It had started walking; it is stopped where its guns went, not
    // carried on to the target's tile.
    expect(sim.state.moving[me]).toBe(1);
    const goal = int32(sim, 'goalX')[me];
    const events = runCollect(sim, 30 * TICKS_PER_SECOND, () => sim.identifyTo(0, foe));
    expect(firesBy(events, me).length).toBe(0);
    expect(sim.state.focusTarget[me]).toBe(foe);
    expect(int32(sim, 'goalX')[me]).toBe(goal);
    expect(sim.state.moving[me]).toBe(0);
    expect(fx.toNumber(sim.state.posX[me])).toBeLessThan(12);
  });
});

describe('focusHurts (R-8)', () => {
  it('true for a soft target, false for a heavy front against a rifle', () => {
    const { sim, me, foe } = world();
    expect(sim.focusHurts(me, foe)).toBe(true);
    const heavy = sim.spawn(sim.addUnitType(HEAVY), 1, fx.from(15.5), fx.from(16.5), 32768);
    expect(sim.focusHurts(me, heavy)).toBe(false);
    // The same plate's rear, to a gun that can: true -- so the false above is
    // the armour, not the query.
    const tank = sim.spawn(sim.addUnitType(TANK), 0, fx.from(10.5), fx.from(18.5), 0);
    expect(sim.focusHurts(tank, heavy)).toBe(true);
  });

  it('only a slot that can aim at the domain counts, and bad ids are false', () => {
    const { sim, foe } = world();
    const aa = sim.spawn(sim.addUnitType(AA_ONLY), 0, fx.from(10.5), fx.from(18.5));
    expect(sim.focusHurts(aa, foe)).toBe(false);
    expect(sim.focusHurts(-1, foe)).toBe(false);
    expect(sim.focusHurts(aa, 999)).toBe(false);
  });

  it('asking between ticks changes nothing the next tick computes', () => {
    const a = world();
    const b = world();
    const heavyA = a.sim.spawn(a.sim.addUnitType(TANK), 1, fx.from(15.5), fx.from(18.5), 16384);
    const heavyB = b.sim.spawn(b.sim.addUnitType(TANK), 1, fx.from(15.5), fx.from(18.5), 16384);
    a.sim.identifyTo(0, heavyA);
    b.sim.identifyTo(0, heavyB);
    a.sim.identifyTo(1, a.me);
    b.sim.identifyTo(1, b.me);
    for (let t = 0; t < 4 * TICKS_PER_SECOND; t++) {
      // Only `a` is asked, from a bearing that resolves a different arc.
      a.sim.focusHurts(heavyA, a.me);
      a.sim.focusHurts(a.me, heavyA);
      a.sim.tick();
      b.sim.tick();
      expect(a.sim.hash()).toBe(b.sim.hash());
    }
  });
});

// ---------------------------------------------------------------------------
// Task 2 fix round 1: I1 (a released focus takes its leg), R-3b (no parking
// on a fixable blocker), R-14 (the chase follows the side's memory, never the
// hidden truth), and the snapped goal.

const SMOKER: UnitTypeJson = { ...RIFLES, id: 'f_smoker', abilities: ['garrison', 'smoke'] };

/** mbt_lavi-like: a ground-only gun in slot 0, a coax that reaches the sky. */
const LAVI_LIKE: UnitTypeJson = {
  id: 'f_lavi_like',
  role: 'mbt',
  hull: { hp: 30000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 12, signature: 1 },
  weapons: [
    { id: 'lavi_gun', type: 'apfsds', range_tiles: 12, effective_range_tiles: 9.6, accuracy: 0.85, penetration: 1300, damage: 1, rof_per_min: 60, can_target: ['ground'] },
    { id: 'lavi_coax', type: 'hmg', range_tiles: 8, accuracy: 0.5, penetration: 22, damage: 1, rof_per_min: 120, can_target: ['ground', 'air'] },
  ],
};

const HOVER: UnitTypeJson = {
  id: 'f_hover',
  role: 'helicopter',
  hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};

/** Wheeled and short-armed: it has to drive right up to what it chases. */
const BUGGY: UnitTypeJson = {
  id: 'f_buggy',
  role: 'technical',
  hull: { hp: 30000, armor: { front: 20, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 1 },
  weapons: [{ id: 'buggy_mg', ...GUN, range_tiles: 2, effective_range_tiles: 1.5 }],
};

describe('focus fix: a released focus takes its chase leg with it (I1)', () => {
  function chasing(type: UnitTypeJson): { sim: Sim; me: number; far: number } {
    const sim = new Sim({ seed: 0x430, width: 64, height: 32, capacity: 16 });
    const me = sim.spawn(sim.addUnitType(type), 0, fx.from(10.5), fx.from(16.5));
    const far = sim.spawn(sim.addUnitType(POST), 1, fx.from(24.5), fx.from(16.5));
    sim.identifyTo(0, far);
    sim.queueCommand({ kind: 'attack', ids: [me], target: far });
    runCollect(sim, 5, () => sim.identifyTo(0, far));
    expect(sim.state.moving[me]).toBe(1);
    return { sim, me, far };
  }

  it('an accepted smoke order stops the chase where it stands', () => {
    const { sim, me, far } = chasing(SMOKER);
    sim.queueCommand({ kind: 'smoke', ids: [me], x: sim.state.posX[me], y: fx.from(18.5) });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(-1);
    expect(sim.state.moving[me]).toBe(0);
    const x = sim.state.posX[me];
    runCollect(sim, 600, () => sim.identifyTo(0, far));
    expect(sim.state.posX[me]).toBe(x);
  });

  it('a refused order stops it too', () => {
    // RIFLES has no smoke: the order is refused, and still releases the focus.
    const { sim, me, far } = chasing(RIFLES);
    sim.queueCommand({ kind: 'smoke', ids: [me], x: sim.state.posX[me], y: fx.from(18.5) });
    sim.tick();
    expect(sim.state.focusTarget[me]).toBe(-1);
    const x = sim.state.posX[me];
    runCollect(sim, 600, () => sim.identifyTo(0, far));
    expect(sim.state.posX[me]).toBe(x);
  });

  it('an appended move starts fresh instead of queueing behind the chase', () => {
    const { sim, me, far } = chasing(RIFLES);
    const x0 = fx.toNumber(sim.state.posX[me]);
    sim.queueCommand({ kind: 'move', ids: [me], x: fx.from(4.5), y: fx.from(16.5), append: true, exact: true });
    let maxX = x0;
    runCollect(sim, 15 * TICKS_PER_SECOND, () => {
      sim.identifyTo(0, far);
      maxX = Math.max(maxX, fx.toNumber(sim.state.posX[me]));
    });
    expect(maxX).toBeLessThanOrEqual(x0 + 0.06);
    expect(fx.toNumber(sim.state.posX[me])).toBeCloseTo(4.5, 3);
  });
});

describe('focus fix: no fixable blocker parks the unit (R-3b)', () => {
  it('a focus only an out-of-range slot can reach is closed on, and the coax fires', () => {
    const sim = new Sim({ seed: 0x431, width: 64, height: 32, capacity: 16 });
    const lavi = sim.spawn(sim.addUnitType(LAVI_LIKE), 0, fx.from(6.5), fx.from(16.5));
    const heli = sim.spawn(sim.addUnitType(HOVER), 1, fx.from(22.5), fx.from(16.5));
    sim.identifyTo(0, heli);
    sim.queueCommand({ kind: 'attack', ids: [lavi], target: heli });
    const fires = firesBy(runCollect(sim, 1200, () => sim.identifyTo(0, heli)), lavi);
    expect(tiles(sim, lavi, heli)).toBeLessThanOrEqual(8);
    const coax = fires.filter((e) => e.weaponId === 'lavi_coax');
    expect(coax.length).toBeGreaterThan(0);
    expect(coax.every((e) => e.target === heli)).toBe(true);
    expect(sim.state.focusTarget[lavi]).toBe(heli);
  });

  it('with no sight line it closes past the wall until it can see, then fires', () => {
    const { sim, me, foe } = world();
    sim.teleport(foe, fx.from(14.5), fx.from(16.5));
    sim.identifyTo(0, foe);
    for (let y = 10; y <= 22; y++) sim.setBlocked(12, y, true);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    const fires = firesBy(runCollect(sim, 40 * TICKS_PER_SECOND, () => sim.identifyTo(0, foe)), me);
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.every((e) => e.target === foe)).toBe(true);
    expect(sim.state.moving[me]).toBe(0);
    expect(fx.toNumber(sim.state.posX[me]) !== 10.5 || fx.toNumber(sim.state.posY[me]) !== 16.5).toBe(true);
  });

  it('a rifle at a tank front, inside effective range with a clear line, still holds', () => {
    const { sim, me, foe } = world();
    sim.debugKill(foe);
    const heavy = sim.spawn(sim.addUnitType(HEAVY), 1, fx.from(15.5), fx.from(16.5), 32768);
    sim.identifyTo(0, heavy);
    sim.queueCommand({ kind: 'attack', ids: [me], target: heavy });
    const x = sim.state.posX[me];
    runCollect(sim, 5 * TICKS_PER_SECOND, () => sim.identifyTo(0, heavy));
    expect(sim.state.posX[me]).toBe(x);
    expect(sim.state.focusTarget[me]).toBe(heavy);
  });
});

describe('focus fix: the chase follows what the side knows (R-14)', () => {
  it('an identified but unseen target moving away does not drag the goal', () => {
    const { sim, me, foe } = world();
    sim.teleport(foe, fx.from(17.5), fx.from(16.5)); // in sight (8), out of reach (6)
    sim.identifyTo(0, foe);
    sim.queueCommand({ kind: 'attack', ids: [me], target: foe });
    sim.tick();
    expect(sim.state.moving[me]).toBe(1);
    expect(int32(sim, 'goalX')[me] >> 16).toBe(17);
    // Out of everyone's sight; still identified for a while.
    sim.teleport(foe, fx.from(40.5), fx.from(16.5));
    let checked = 0;
    for (let t = 0; t < 40; t++) {
      sim.tick();
      if (sim.contactConfidence(0, foe) < IDENTIFIED_AT) break;
      expect(sim.state.focusTarget[me]).toBe(foe);
      expect(int32(sim, 'goalX')[me] >> 16).toBe(17);
      checked++;
    }
    expect(checked).toBe(40);
  });
});

describe('focus fix: the stored goal is the snapped one', () => {
  it('a vehicle chasing a man into a boulder field drives to its edge and waits', () => {
    const sim = new Sim({ seed: 0x432, width: 64, height: 32, capacity: 16 });
    for (let y = 14; y <= 19; y++) for (let x = 20; x <= 23; x++) sim.setBoulder(x, y, true);
    const buggy = sim.spawn(sim.addUnitType(BUGGY), 0, fx.from(10.5), fx.from(16.5));
    const man = sim.spawn(sim.addUnitType(POST), 1, fx.from(21.5), fx.from(16.5));
    sim.identifyTo(0, man);
    sim.queueCommand({ kind: 'attack', ids: [buggy], target: man });
    sim.tick();
    const gx = int32(sim, 'goalX')[buggy];
    const gy = int32(sim, 'goalY')[buggy];
    // A tile the buggy can stand on, at its centre.
    expect(gx >> 16 < 20 || gx >> 16 > 23 || gy >> 16 < 14 || gy >> 16 > 19).toBe(true);
    expect(gx & 0xffff).toBe(0x8000);
    expect(gy & 0xffff).toBe(0x8000);
    runCollect(sim, 30 * TICKS_PER_SECOND, () => sim.identifyTo(0, man));
    // Arrived and waiting, not pressing on a boulder with its leg still live.
    expect(sim.state.moving[buggy]).toBe(0);
    expect(sim.state.posX[buggy] >> 16).toBe(gx >> 16);
    expect(sim.state.posY[buggy] >> 16).toBe(gy >> 16);
    expect(sim.state.focusTarget[buggy]).toBe(man);
  });
});
