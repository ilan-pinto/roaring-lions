import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fx, type Fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import type { StructureTypeJson } from './structures';

// GH-707 Task 4: carrying -- the `can_carry` role filter, the drag/stretcher speed, the
// stabilise aura (already in woundTended: reused, tested here from an ambulance), evacuation
// on an evac point or a medevac's lift, and a carrier's death with a wounded aboard. Every
// type here is test-only; no shipped JSON carries a wound field in P1.

const RIFLES: UnitTypeJson = {
  id: 'rs_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

/** 400 hp / 4 men, chance 1, bleed 2 s = 40 ticks: a 100-hp hit sheds one DOWN wounded. */
const BLEEDER: UnitTypeJson = {
  ...RIFLES,
  id: 'rs_bleeder',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 }, figures: 4, wounds: { wound_chance: 1, bleed_s: 2, type: 'rs_wounded' } },
};

const WOUNDED: UnitTypeJson = {
  id: 'rs_wounded',
  role: 'wounded',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
  mobility: { speed_tiles_s: 0.12 },
  sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
};

/** A wounded body that may NOT embark by the ordinary rule: only `can_carry` seats him. */
const WOUNDED_NO_EMBARK: UnitTypeJson = { ...WOUNDED, id: 'rs_wounded_ne', hull: { ...WOUNDED.hull, can_embark: false } };

/** A one-man civilian that goes down in place, at 1 hp. */
const CIVILIAN: UnitTypeJson = {
  ...RIFLES,
  id: 'rs_civ',
  role: 'civilian',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, wounds: { wound_chance: 1, bleed_s: 60, type: 'rs_wounded', in_place: true } },
};

const RESCUE = { radius_tiles: 8, treat_s: 6, drag_speed_mult: 0.5, carry_speed_mult: 0.75 };

/** One man, one seat: he DRAGS (0.5). 1 tile/s: stepPerTick = fx.mul(65536, DT 3277) = 3277. */
const DRAGGER: UnitTypeJson = {
  ...RIFLES,
  id: 'rs_dragger',
  abilities: ['rescue'],
  hull: { hp: 200, armor: { front: 10, side: 10, rear: 10 }, transport_slots: 1, can_carry: ['wounded'] },
  mobility: { speed_tiles_s: 1 },
  rescue: RESCUE,
};

/** Two men, one seat: a stretcher (0.75). */
const STRETCHER: UnitTypeJson = { ...DRAGGER, id: 'rs_stretcher', hull: { ...DRAGGER.hull, figures: 2 } };

/** The same two men with no `rescue` block: a carrier, not a medic -- no drag. */
const PORTERS: UnitTypeJson = { ...STRETCHER, id: 'rs_porters', abilities: [], rescue: undefined };

const AMBULANCE: UnitTypeJson = {
  id: 'rs_ambulance',
  role: 'apc',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 }, transport_slots: 4, can_carry: ['wounded'], stabilise_radius: 1.5 },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8 },
};

/** Carries infantry and wounded both. */
const MIXED: UnitTypeJson = { ...AMBULANCE, id: 'rs_mixed', hull: { ...AMBULANCE.hull, can_carry: ['infantry', 'wounded'] } };

/** Carries infantry only, by `can_carry`. */
const TROOPS_ONLY: UnitTypeJson = { ...AMBULANCE, id: 'rs_troops', hull: { ...AMBULANCE.hull, can_carry: ['infantry'] } };

/** A plain APC: seats, no `can_carry`. */
const APC: UnitTypeJson = {
  id: 'rs_apc',
  role: 'apc',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 }, transport_slots: 4 },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8 },
};

const MEDEVAC: UnitTypeJson = {
  id: 'rs_medevac',
  role: 'transport',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 4, can_carry: ['wounded'] },
  mobility: { speed_tiles_s: 4, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
};

interface World {
  sim: Sim;
  /** A side-1 shooter far off, for `by`. */
  shooter: number;
  put: (t: UnitTypeJson, side: number, x: number, y: number) => number;
  /** A DOWN wounded shed by a BLEEDER at (x, y). */
  down: (x: number, y: number) => number;
}

function world(width = 20, height = 12): World {
  const sim = new Sim({ seed: 0x7070_0004, width, height, capacity: 48 });
  const types = new Map<string, number>();
  const put = (t: UnitTypeJson, side: number, x: number, y: number): number => {
    let ti = types.get(t.id);
    if (ti === undefined) {
      ti = sim.addUnitType(t);
      types.set(t.id, ti);
    }
    return sim.spawn(ti, side, fx.from(x), fx.from(y));
  };
  put(WOUNDED, 0, 0.5, 0.5); // registers the wounded type (index order is the test's own)
  sim.debugKill(0);
  const shooter = put(RIFLES, 1, 19.5, 11.5);
  const down = (x: number, y: number): number => {
    const squad = put(BLEEDER, 0, x, y);
    const w = sim.entityCount;
    hit(sim, squad, 100, shooter);
    expect(sim.state.woundState[w]).toBe(1);
    return w;
  };
  return { sim, shooter, put, down };
}

function hit(sim: Sim, id: number, hp: number, by: number): void {
  (sim as unknown as { applyDamage(t: number, d: Fx, by: number): void }).applyDamage(id, fx.fromInt(hp), by);
}

function transfer(sim: Sim, from: number, to: number, id: number): boolean {
  return (sim as unknown as { transferSeat(a: number, b: number, c: number): boolean }).transferSeat(from, to, id);
}

const carriedBy = (sim: Sim): Int32Array => (sim as unknown as { carriedBy: Int32Array }).carriedBy;
const passengers = (sim: Sim): Int32Array => (sim as unknown as { passengers: Int32Array }).passengers;

const of = <K extends SimEvent['kind']>(evs: readonly SimEvent[], k: K): Extract<SimEvent, { kind: K }>[] =>
  evs.filter((e): e is Extract<SimEvent, { kind: K }> => e.kind === k);

describe('the can_carry role filter (GH-707 Task 4)', () => {
  it('an ambulance (can_carry [wounded]) refuses a rifle squad and seats a wounded', () => {
    const { sim, put, down } = world();
    const amb = put(AMBULANCE, 0, 5.5, 5.5);
    const rifle = put(RIFLES, 0, 5.5, 6.5);
    const w = down(6.5, 5.5);
    expect(sim.embarkAtSpawn(amb, rifle)).toBe(false);
    expect(sim.embarkAtSpawn(amb, w)).toBe(true);
    expect(carriedBy(sim)[w]).toBe(amb);
  });

  it('a wounded is seated by a carrier listing `wounded` whatever his can_embark; a bare wounded-role body too', () => {
    const { sim, put } = world();
    const amb = put(AMBULANCE, 0, 5.5, 5.5);
    expect(sim.embarkAtSpawn(amb, put(WOUNDED_NO_EMBARK, 0, 6.5, 5.5))).toBe(true); // isWounded, can_embark false
    expect(sim.embarkAtSpawn(amb, put(WOUNDED, 0, 6.5, 5.5))).toBe(true); // spawned directly, role wounded
  });

  it('a downed-in-place civilian is a wounded rider: the ambulance takes him, an APC does not', () => {
    const { sim, put, shooter } = world();
    const civ = put(CIVILIAN, 2, 6.5, 5.5);
    hit(sim, civ, 30, shooter);
    expect([sim.state.alive[civ], sim.state.woundState[civ]]).toEqual([1, 1]);
    expect(sim.embarkAtSpawn(put(APC, 2, 5.5, 5.5), civ)).toBe(false);
    expect(sim.embarkAtSpawn(put(AMBULANCE, 2, 5.5, 5.5), civ)).toBe(true);
  });

  it('a carrier without can_carry (an APC) refuses every wounded and still seats a rifle squad', () => {
    const { sim, put, down } = world();
    const apc = put(APC, 0, 5.5, 5.5);
    expect(sim.embarkAtSpawn(apc, down(6.5, 5.5))).toBe(false); // DOWN, shed by a squad
    expect(sim.embarkAtSpawn(apc, put(WOUNDED, 0, 6.5, 5.5))).toBe(false); // bare body, can_embark true
    expect(sim.embarkAtSpawn(apc, put(RIFLES, 0, 5.5, 6.5))).toBe(true);
  });

  it('a can_carry list seats only its roles: [infantry] refuses a wounded, [infantry, wounded] seats both', () => {
    const { sim, put, down } = world();
    const troops = put(TROOPS_ONLY, 0, 5.5, 5.5);
    expect(sim.embarkAtSpawn(troops, down(6.5, 5.5))).toBe(false);
    expect(sim.embarkAtSpawn(troops, put(RIFLES, 0, 5.5, 6.5))).toBe(true);
    const mixed = put(MIXED, 0, 8.5, 5.5);
    expect(sim.embarkAtSpawn(mixed, down(9.5, 5.5))).toBe(true);
    expect(sim.embarkAtSpawn(mixed, put(RIFLES, 0, 8.5, 6.5))).toBe(true);
    expect(sim.embarkAtSpawn(mixed, put(APC, 0, 8.5, 7.5))).toBe(false); // an APC role is not listed
  });
});

describe('transferSeat (GH-707 Task 4)', () => {
  it('hands a wounded from a medic to an ambulance: one unload, one load, on the ambulance hull at once', () => {
    const { sim, put, down } = world();
    const medic = put(STRETCHER, 0, 5.5, 5.5);
    const amb = put(AMBULANCE, 0, 6.5, 5.5);
    const w = down(5.5, 6.5);
    expect(sim.embarkAtSpawn(medic, w)).toBe(true);
    sim.queueCommand({ kind: 'halt', ids: [medic] }); // parked: he would hand over by himself (Task 5)
    sim.tick();
    expect(sim.state.speedMul[medic]).toBe(49152); // 0.75 while he carries
    expect(transfer(sim, medic, amb, w)).toBe(true);
    expect([carriedBy(sim)[w], passengers(sim)[medic], passengers(sim)[amb]]).toEqual([amb, 0, 1]);
    expect([sim.state.posX[w], sim.state.posY[w]]).toEqual([sim.state.posX[amb], sim.state.posY[amb]]);
    expect(sim.state.speedMul[medic]).toBe(65536); // empty: ONE again
    const tr = of(sim.tick(), 'transport').filter((e) => e.entity === w);
    expect(tr.map((e) => [e.carrier, e.loaded])).toEqual([
      [medic, false],
      [amb, true],
    ]);
  });

  it('refuses, writing nothing, into a carrier that cannot take him or from one he is not aboard', () => {
    const { sim, put, down } = world();
    const medic = put(STRETCHER, 0, 5.5, 5.5);
    const apc = put(APC, 0, 6.5, 5.5);
    const amb = put(AMBULANCE, 0, 7.5, 5.5);
    const heli = put(MEDEVAC, 0, 8.5, 5.5); // AIRBORNE: seats nobody
    const w = down(5.5, 6.5);
    expect(sim.embarkAtSpawn(medic, w)).toBe(true);
    sim.queueCommand({ kind: 'halt', ids: [medic] }); // parked (Task 5): no walk to the ambulance
    sim.tick();
    expect(transfer(sim, medic, apc, w)).toBe(false);
    expect(transfer(sim, medic, heli, w)).toBe(false);
    expect(transfer(sim, amb, apc, w)).toBe(false); // not aboard amb
    expect(transfer(sim, medic, medic, w)).toBe(false);
    expect([carriedBy(sim)[w], passengers(sim)[medic], passengers(sim)[apc]]).toEqual([medic, 1, 0]);
    expect(of(sim.tick(), 'transport')).toEqual([]);
  });
});

describe('drag and stretcher speed (GH-707 Task 4)', () => {
  /** A medic of `t` at (2.5, 5.5), carrying a bare wounded when `load`, ordered east; his x after
   *  tick 5 and after tick 25. */
  function run(t: UnitTypeJson, load: boolean): { d: number; mul: number } {
    const { sim, put } = world();
    const m = put(t, 0, 2.5, 5.5);
    if (load) expect(sim.embarkAtSpawn(m, put(WOUNDED, 0, 2.5, 5.5))).toBe(true);
    sim.queueCommand({ kind: 'move', ids: [m], x: fx.from(17.5), y: fx.from(5.5) });
    for (let t = 0; t < 5; t++) sim.tick();
    const x0 = sim.state.posX[m];
    for (let t = 0; t < 20; t++) sim.tick();
    return { d: sim.state.posX[m] - x0, mul: sim.state.speedMul[m] };
  }

  it('an empty medic walks his full step: 20 x 3277', () => {
    expect(run(DRAGGER, false)).toEqual({ d: 65540, mul: 65536 });
  });

  it('a one-man medic dragging moves at exactly half: fx.mul(3277, 0.5 = 32768) = 1638 a tick', () => {
    // (3277 x 32768) >>> 16 = 1638.5 -> 1638; x 20 = 32760.
    expect(run(DRAGGER, true)).toEqual({ d: 32760, mul: 32768 });
  });

  it('a two-man team carries on a stretcher at 0.75: fx.mul(3277, 49152) = 2457 a tick', () => {
    // (3277 x 49152) >>> 16 = 2457.75 -> 2457; x 20 = 49140.
    expect(run(STRETCHER, true)).toEqual({ d: 49140, mul: 49152 });
  });

  it('a carrier with no rescue block is not slowed by what it carries', () => {
    expect(run(PORTERS, true)).toEqual({ d: 65540, mul: 65536 });
  });

  it('speedMul ONE is the identity on every shipped type step: fx.mul(s, 65536) === s', () => {
    const steps = new Set<number>();
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    for (const u of shippedUnits()) steps.add(sim.unitTypes[sim.addUnitType(u)].stepPerTick);
    expect(steps.size).toBeGreaterThan(5);
    // Plus the shifted (routed/pinned) values and a few hand-picked edges, negatives included.
    for (const s of [...steps]) for (const k of [0, 1, 2, 3]) steps.add(s >> k);
    for (const s of [0, 1, -1, 65535, 65536, -65536, 2147483647, -2147483648]) steps.add(s);
    for (const s of steps) expect(fx.mul(s, 65536)).toBe(s);
  });
});

describe('the stabilise aura, from an ambulance (GH-707 Task 4)', () => {
  it('a DOWN wounded 1 tile from an ambulance does not bleed; it drives off and he does', () => {
    const { sim, put, down } = world();
    const w = down(5.5, 5.5);
    const amb = put(AMBULANCE, 0, 6.5, 5.5); // 1 tile^2 <= 1.5^2 = 2.25
    for (let t = 0; t < 100; t++) sim.tick();
    expect([sim.state.alive[w], sim.state.bleedTicks[w]]).toEqual([1, 40]);
    sim.queueCommand({ kind: 'move', ids: [amb], x: fx.from(15.5), y: fx.from(5.5) });
    let n = 0;
    while (sim.state.alive[w] === 1 && n < 200) {
      sim.tick();
      n++;
    }
    expect(sim.state.alive[w]).toBe(0);
  });
});

describe('evacuation (GH-707 Task 4)', () => {
  /** An ambulance at (3.5, 5.5) with a DOWN wounded aboard and the side's evac point at
   *  (12.5, 5.5); the ambulance is driven to (gx, 5.5). Events of the whole run. */
  function drive(gx: number, evacSide = 0): { sim: Sim; w: number; amb: number; evs: SimEvent[] } {
    const { sim, put, down } = world();
    const w = down(3.5, 6.5);
    const amb = put(AMBULANCE, 0, 3.5, 5.5);
    expect(sim.embarkAtSpawn(amb, w)).toBe(true);
    sim.addEvacPoint(evacSide, fx.from(12.5), fx.from(5.5));
    sim.queueCommand({ kind: 'move', ids: [amb], x: fx.from(gx), y: fx.from(5.5) });
    const evs: SimEvent[] = [];
    for (let t = 0; t < 300; t++) evs.push(...sim.tick());
    return { sim, w, amb, evs };
  }

  it('an ambulance reaching its evac point evacuates the wounded: alive 0, no destroyed, GONE, counted once', () => {
    const { sim, w, amb, evs } = drive(12.5);
    expect(of(evs, 'woundEvacuated').map((e) => [e.entity, e.carrier, e.side])).toEqual([[w, amb, 0]]);
    expect(of(evs, 'destroyed').filter((e) => e.entity === w)).toEqual([]);
    expect([sim.state.alive[w], sim.state.woundState[w], sim.state.woundedAlive[0]]).toEqual([0, 4, 0]);
    expect([carriedBy(sim)[w], passengers(sim)[amb]]).toEqual([-1, 0]);
  });

  it('within 1 tile counts (1 tile^2), 2 tiles short does not, and another side`s point never does', () => {
    expect(of(drive(11.5).evs, 'woundEvacuated')).toHaveLength(1); // 1 tile off: 1 <= 1
    const short = drive(10.5); // 2 tiles off: 4 > 1
    expect(of(short.evs, 'woundEvacuated')).toEqual([]);
    expect([short.sim.state.alive[short.w], passengers(short.sim)[short.amb]]).toEqual([1, 1]);
    expect(of(drive(12.5, 1).evs, 'woundEvacuated')).toEqual([]);
  });

  it('only the wounded leave: a rifle squad riding with him stays aboard', () => {
    const { sim, put, down } = world();
    const w = down(3.5, 6.5);
    const mixed = put(MIXED, 0, 3.5, 5.5);
    const rifle = put(RIFLES, 0, 3.5, 4.5);
    expect(sim.embarkAtSpawn(mixed, w)).toBe(true);
    expect(sim.embarkAtSpawn(mixed, rifle)).toBe(true);
    sim.addEvacPoint(0, fx.from(3.5), fx.from(5.5)); // he is already on it
    const evs = sim.tick();
    expect(of(evs, 'woundEvacuated').map((e) => e.entity)).toEqual([w]);
    expect([sim.state.alive[rifle], carriedBy(sim)[rifle], passengers(sim)[mixed]]).toEqual([1, mixed, 1]);
  });

  it('a medevac lifting off with a wounded aboard evacuates him, no evac point needed', () => {
    const { sim, put, down } = world();
    const w = down(5.5, 6.5);
    const heli = put(MEDEVAC, 0, 5.5, 5.5);
    sim.state.airState[heli] = 2; // AIR_LANDED
    expect(sim.embarkAtSpawn(heli, w)).toBe(true);
    sim.tick();
    expect(sim.state.alive[w]).toBe(1);
    sim.queueCommand({ kind: 'move', ids: [heli], x: fx.from(15.5), y: fx.from(5.5) });
    const evs = sim.tick();
    expect(sim.state.airState[heli]).toBe(3); // AIR_LIFTING, this tick
    expect(of(evs, 'woundEvacuated').map((e) => [e.entity, e.carrier, e.side])).toEqual([[w, heli, 0]]);
    expect(of(evs, 'destroyed')).toEqual([]);
    expect([sim.state.alive[w], sim.state.woundState[w], sim.state.woundedAlive[0], passengers(sim)[heli]]).toEqual([0, 4, 0, 0]);
  });

  it('addEvacPoint takes eight points, throws on a ninth and on a bad side', () => {
    const { sim } = world();
    for (let k = 0; k < 8; k++) sim.addEvacPoint(k % 3, fx.fromInt(k), fx.fromInt(1));
    expect(() => sim.addEvacPoint(0, 0, 0)).toThrow(/at most 8/);
    expect(() => world().sim.addEvacPoint(3, 0, 0)).toThrow(/side must be/);
  });
});

describe('a carrier dies with a wounded aboard (GH-707 Task 4)', () => {
  it('a ground carrier: he is put down alive, unhurt, in the state he was carried in', () => {
    // Decision: the bail-out's 40% hurt is waived for a wounded rider. 0.4 x 30 hp = 12 would
    // leave a shed man at 18 hp, and would kill a man downed in place outright (he lies at 1 hp).
    const { sim, put, down, shooter } = world();
    const amb = put(AMBULANCE, 0, 5.5, 5.5);
    const w = down(5.5, 6.5);
    const civ = put(CIVILIAN, 0, 4.5, 5.5);
    hit(sim, civ, 30, shooter);
    expect(sim.embarkAtSpawn(amb, w)).toBe(true);
    expect(sim.embarkAtSpawn(amb, civ)).toBe(true);
    sim.state.woundState[w] = 2; // STABILISED aboard: he must land STABILISED
    sim.tick();
    sim.debugKill(amb);
    expect([sim.state.alive[w], sim.state.hp[w], sim.state.woundState[w], carriedBy(sim)[w]]).toEqual([1, 30 * 65536, 2, -1]);
    expect([sim.state.alive[civ], sim.state.hp[civ], sim.state.woundState[civ]]).toEqual([1, 65536, 1]);
    expect(sim.state.woundedAlive[0]).toBe(2);
    const evs = sim.tick();
    expect(of(evs, 'transport').filter((e) => !e.loaded).map((e) => e.entity).sort()).toEqual([w, civ].sort());
    expect(of(evs, 'destroyed').map((e) => e.entity)).toEqual([amb]);
  });

  it('an airborne medevac takes him with it: destroyed, and his side`s count drops once', () => {
    const { sim, put, down } = world();
    const heli = put(MEDEVAC, 0, 5.5, 5.5); // spawns AIRBORNE
    const w = down(5.5, 6.5);
    expect(sim.embarkAtSpawn(heli, w)).toBe(true); // an authored rider: R8's exception
    sim.tick();
    sim.debugKill(heli);
    expect([sim.state.alive[w], sim.state.woundedAlive[0]]).toEqual([0, 0]);
    expect(of(sim.tick(), 'destroyed').map((e) => e.entity)).toEqual([w, heli]);
  });
});

// ---------------------------------------------------------------------------------------------
// GH-707 Task 5: the medic. Every wounded below bleeds 60 s (1200 ticks) unless said otherwise,
// so nobody dies of the walk.

/** A BLEEDER that bleeds 60 s: a 100-hp hit sheds one DOWN wounded with 1200 bleed ticks. */
const SLOW_BLEEDER: UnitTypeJson = {
  ...BLEEDER,
  id: 'rs_slow_bleeder',
  hull: { ...BLEEDER.hull, wounds: { wound_chance: 1, bleed_s: 60, type: 'rs_wounded' } },
};

/** One-man medic, no seat: he treats and nothing else. */
const TREATER: UnitTypeJson = { ...DRAGGER, id: 'rs_treater', hull: { ...DRAGGER.hull, transport_slots: 0 } };

/** A DOWN wounded of `side` at (x, y), shed by a SLOW_BLEEDER the far shooter of the other
 *  side hits for 100. */
function downOf(w: World, side: number, x: number, y: number): number {
  const by = side === 0 ? w.shooter : w.put(RIFLES, 0, 0.5, 11.5);
  const squad = w.put(SLOW_BLEEDER, side, x, y);
  const id = w.sim.entityCount;
  hit(w.sim, squad, 100, by);
  expect([w.sim.state.woundState[id], w.sim.state.side[id], w.sim.state.bleedTicks[id]]).toEqual([1, side, 1200]);
  return id;
}

const col = (sim: Sim, name: 'goalY' | 'boardGoal'): Int32Array => (sim as unknown as Record<string, Int32Array>)[name];
const contact = (sim: Sim): Int32Array => (sim as unknown as { contact: Int32Array }).contact;
const CAP = 48; // world()'s capacity: contact is side * capacity + target

describe('rescuePriority is wired into the pick (GH-707 Task 5, D2)', () => {
  it('an idle medic leaves an enemy wounded alone, however near', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 5.5, 5.5);
    const e = downOf(wd, 1, 6.5, 5.5);
    wd.sim.queueCommand({ kind: 'reveal', side: 0, x: fx.from(6.5), y: fx.from(5.5) }); // identified: not the reason
    for (let t = 0; t < 100; t++) wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTarget[medic], wd.sim.state.woundState[e]]).toEqual([0, -1, 1]);
  });

  it('a civilian wounded is picked when he is alone, and loses to a friendly at equal distance', () => {
    const civAlone = (withFriend: boolean): { medic: number; civ: number; friend: number; target: number } => {
      const wd = world();
      const medic = wd.put(DRAGGER, 0, 8.5, 5.5);
      // The civilian first, so he holds the LOWER id: a tie broken by id alone would pick him.
      const civ = wd.put(CIVILIAN, 2, 11.5, 5.5); // 3 tiles east: 9 tile^2
      hit(wd.sim, civ, 30, wd.shooter);
      const friend = withFriend ? downOf(wd, 0, 5.5, 5.5) : -1; // 3 tiles west: 9 tile^2
      contact(wd.sim)[0 * CAP + civ] = 65536; // side 0 knows him: the priority is what is tested
      wd.sim.tick();
      return { medic, civ, friend, target: wd.sim.state.medTarget[medic] };
    };
    const a = civAlone(false);
    expect(a.target).toBe(a.civ);
    const b = civAlone(true);
    expect(b.target).toBe(b.friend);
  });

  it('an unidentified civilian is not picked; the same man identified is', () => {
    // A medic who sees 2 tiles, the only side-0 eye on the map, 5 tiles from the civilian: side 0
    // never identifies him by itself.
    const SHORT_SIGHTED: UnitTypeJson = { ...DRAGGER, id: 'rs_short', sensors: { optics: 1, sight_tiles: 2, signature: 0.6 } };
    const wd = world();
    const medic = wd.put(SHORT_SIGHTED, 0, 6.5, 5.5);
    const civ = wd.put(CIVILIAN, 2, 11.5, 5.5);
    hit(wd.sim, civ, 30, wd.shooter);
    for (let t = 0; t < 50; t++) wd.sim.tick();
    expect(contact(wd.sim)[0 * CAP + civ]).toBeLessThan(39322); // IDENTIFIED_AT 0.6
    expect([wd.sim.state.medState[medic], wd.sim.state.medTarget[medic]]).toEqual([0, -1]);
    contact(wd.sim)[0 * CAP + civ] = 65536;
    wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTarget[medic]]).toEqual([1, civ]);
  });
});

describe('the automatic rescue, end to end (GH-707 Task 5)', () => {
  /** Medic of `t` at (2.5, 5.5), a friendly DOWN wounded at (8.5, 5.5) -- 6 tiles, inside the
   *  8-tile radius -- and the side's evac point at (16.5, 5.5). Tick by tick, up to `max`. */
  function rescue(t: UnitTypeJson, max: number) {
    const wd = world();
    const medic = wd.put(t, 0, 2.5, 5.5);
    const w = downOf(wd, 0, 8.5, 5.5);
    wd.sim.addEvacPoint(0, fx.from(16.5), fx.from(5.5));
    const states: number[] = [];
    const bleed: number[] = [];
    const evs: SimEvent[] = [];
    for (let k = 0; k < max; k++) {
      evs.push(...wd.sim.tick());
      states.push(wd.sim.state.medState[medic]);
      bleed.push(wd.sim.state.bleedTicks[w]);
    }
    return { sim: wd.sim, medic, w, states, bleed, evs };
  }

  it('walks to him, treats exactly treat_s x 20 = 120 ticks, drags him to the evac point, and he leaves alive', () => {
    const r = rescue(DRAGGER, 1200);
    const firstTreat = r.states.indexOf(2); // tick index (0-based) of the first tick ending TREATING
    expect(r.states.slice(0, firstTreat).every((s) => s === 1)).toBe(true); // TO_WOUNDED all the way
    const stab = of(r.evs, 'woundStabilised');
    expect(stab.map((e) => [e.entity, e.medic])).toEqual([[r.w, r.medic]]);
    // TREATING set on tick T with timer 120, decremented that same tick: 119 ... 0 on T + 119,
    // the 120th tick of treatment. Event ticks are 0-based like the index.
    expect(stab[0].tick - firstTreat).toBe(119);
    expect(r.states.slice(firstTreat, firstTreat + 119).every((s) => s === 2)).toBe(true);
    // He bled while the medic walked (more than 2 tiles off), and not from the tick he was in reach.
    expect(r.bleed[firstTreat - 1]).toBeLessThan(1200);
    expect(r.bleed[firstTreat + 119]).toBe(r.bleed[firstTreat - 1]);
    // Picked up the tick he was stabilised (CARRYING, 3), delivering (4) from the next.
    expect([r.states[firstTreat + 119], r.states[firstTreat + 120]]).toEqual([3, 4]);
    const ev = of(r.evs, 'woundEvacuated');
    expect(ev.map((e) => [e.entity, e.carrier, e.side])).toEqual([[r.w, r.medic, 0]]);
    expect(of(r.evs, 'destroyed').filter((e) => e.entity === r.w)).toEqual([]);
    // Carry-over (b): out of play alive -- `removed`, the flag casualties_pct reads, not a death.
    expect([r.sim.state.alive[r.w], r.sim.state.removed[r.w], r.sim.state.woundState[r.w]]).toEqual([0, 1, 4]);
    // His job over, the medic is idle again and empty-handed, back at full speed.
    expect([r.sim.state.medState[r.medic], passengers(r.sim)[r.medic], r.sim.state.speedMul[r.medic]]).toEqual([0, 0, 65536]);
  });

  it('a medic with no seat treats and stops: STABILISED, left lying, not picked again', () => {
    const r = rescue(TREATER, 400);
    expect(of(r.evs, 'woundStabilised')).toHaveLength(1);
    expect([r.sim.state.woundState[r.w], carriedBy(r.sim)[r.w], r.sim.state.alive[r.w]]).toEqual([2, -1, 1]);
    expect(r.states.at(-1)).toBe(0);
    expect(r.sim.state.medTarget[r.medic]).toBe(-1);
  });

  it('beyond rescue.radius (8 tiles) nobody comes', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 2.5, 5.5);
    downOf(wd, 0, 11.5, 5.5); // 9 tiles: 81 > 64
    for (let k = 0; k < 50; k++) wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.moving[medic]]).toEqual([0, 0]);
  });

  it('a medic killed while dragging drops him where he stood, still STABILISED, unhurt', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 7.5, 5.5);
    const w = downOf(wd, 0, 8.5, 5.5);
    wd.sim.addEvacPoint(0, fx.from(16.5), fx.from(5.5));
    let k = 0;
    while (passengers(wd.sim)[medic] === 0 && k < 400) {
      wd.sim.tick();
      k++;
    }
    for (let j = 0; j < 20; j++) wd.sim.tick();
    expect([carriedBy(wd.sim)[w], wd.sim.state.medState[medic]]).toEqual([medic, 4]);
    wd.sim.debugKill(medic);
    expect([wd.sim.state.alive[w], carriedBy(wd.sim)[w], wd.sim.state.woundState[w], wd.sim.state.hp[w]]).toEqual([1, -1, 2, 30 * 65536]);
    const bleedAt = wd.sim.state.bleedTicks[w];
    for (let j = 0; j < 40; j++) wd.sim.tick();
    expect([wd.sim.state.alive[w], wd.sim.state.bleedTicks[w]]).toEqual([1, bleedAt]); // STABILISED: no bleed
  });
});

describe('the medic hands over (GH-707 Task 5)', () => {
  it('to a friendly ambulance nearer than the evac point: walks into LOAD_RANGE and transfers the seat', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 5.5, 5.5);
    const w = downOf(wd, 0, 5.5, 6.5);
    const amb = wd.put(AMBULANCE, 0, 10.5, 5.5); // 5 tiles: 25 tile^2
    wd.sim.addEvacPoint(0, fx.from(16.5), fx.from(5.5)); // 11 tiles: 121
    expect(wd.sim.embarkAtSpawn(medic, w)).toBe(true);
    const evs: SimEvent[] = [];
    for (let k = 0; k < 400 && carriedBy(wd.sim)[w] !== amb; k++) evs.push(...wd.sim.tick());
    expect([carriedBy(wd.sim)[w], passengers(wd.sim)[amb], passengers(wd.sim)[medic], wd.sim.state.medState[medic]]).toEqual([amb, 1, 0, 0]);
    // He handed over from within 1.5 tiles (LOAD_RANGE_SQ 2.25 tile^2 = 147456).
    // Measured as the sim measures it (distSqFx: each delta >> 8, then squared), not in floats.
    const dx = (wd.sim.state.posX[amb] - wd.sim.state.posX[medic]) >> 8;
    const dy = (wd.sim.state.posY[amb] - wd.sim.state.posY[medic]) >> 8;
    expect(dx * dx + dy * dy).toBeLessThanOrEqual(147456);
    expect(of(evs, 'woundEvacuated')).toEqual([]);
  });

  it('to a LANDED medevac, never to an airborne one', () => {
    const go = (landed: boolean): number => {
      const wd = world();
      const medic = wd.put(DRAGGER, 0, 5.5, 5.5);
      const w = downOf(wd, 0, 5.5, 6.5);
      const heli = wd.put(MEDEVAC, 0, 8.5, 5.5);
      if (landed) wd.sim.state.airState[heli] = 2; // AIR_LANDED
      expect(wd.sim.embarkAtSpawn(medic, w)).toBe(true);
      for (let k = 0; k < 300; k++) wd.sim.tick();
      return carriedBy(wd.sim)[w] === heli ? 1 : wd.sim.state.medState[medic];
    };
    expect(go(true)).toBe(1);
    expect(go(false)).toBe(3); // nowhere to go: CARRYING, holding
  });

  it('nowhere to deliver: he holds where he is, carrying', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 5.5, 5.5);
    const w = downOf(wd, 0, 5.5, 6.5);
    expect(wd.sim.embarkAtSpawn(medic, w)).toBe(true);
    const x0 = wd.sim.state.posX[medic];
    for (let k = 0; k < 60; k++) wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.moving[medic], wd.sim.state.posX[medic], carriedBy(wd.sim)[w]]).toEqual([3, 0, x0, medic]);
  });
});

describe('player orders and the medic (GH-707 Task 5)', () => {
  it('a `rescue` order sends him to an IDENTIFIED enemy wounded; he treats him (his bleed paused) and carries him', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 5.5, 5.5);
    const e = downOf(wd, 1, 9.5, 5.5);
    wd.sim.queueCommand({ kind: 'reveal', side: 0, x: fx.from(9.5), y: fx.from(5.5) });
    wd.sim.tick();
    wd.sim.queueCommand({ kind: 'rescue', ids: [medic], target: e });
    const evs: SimEvent[] = [];
    let treatBleed = -1;
    for (let k = 0; k < 400 && carriedBy(wd.sim)[e] !== medic; k++) {
      evs.push(...wd.sim.tick());
      if (wd.sim.state.medState[medic] === 2) {
        if (treatBleed < 0) treatBleed = wd.sim.state.bleedTicks[e];
        else expect(wd.sim.state.bleedTicks[e]).toBe(treatBleed); // an enemy medic, but treating him
      }
    }
    expect(of(evs, 'woundStabilised').map((x) => [x.entity, x.medic])).toEqual([[e, medic]]);
    expect([carriedBy(wd.sim)[e], wd.sim.state.woundState[e]]).toEqual([medic, 2]);
  });

  it('refuses an unidentified enemy wounded: the medic keeps the order he had, nothing written', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 2.5, 5.5);
    const e = downOf(wd, 1, 17.5, 5.5); // 15 tiles: beyond sight 8
    wd.sim.queueCommand({ kind: 'move', ids: [medic], x: fx.from(2.5), y: fx.from(10.5) });
    wd.sim.tick();
    expect(contact(wd.sim)[0 * CAP + e]).toBeLessThan(39322);
    const gy = col(wd.sim, 'goalY')[medic];
    wd.sim.queueCommand({ kind: 'rescue', ids: [medic], target: e });
    wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTarget[medic], wd.sim.state.moving[medic], col(wd.sim, 'goalY')[medic]]).toEqual([0, -1, 1, gy]);
    // Control: the same order once side 0 knows him is taken.
    contact(wd.sim)[0 * CAP + e] = 65536;
    wd.sim.queueCommand({ kind: 'rescue', ids: [medic], target: e });
    wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTarget[medic]]).toEqual([1, e]);
  });

  it('refuses a non-medic, a target that is not down, and a target already carried', () => {
    const wd = world();
    const rifle = wd.put(RIFLES, 0, 5.5, 5.5);
    const medic = wd.put(DRAGGER, 0, 5.5, 6.5);
    const w = downOf(wd, 0, 6.5, 5.5);
    const amb = wd.put(AMBULANCE, 0, 7.5, 5.5);
    wd.sim.queueCommand({ kind: 'halt', ids: [medic] }); // parked
    wd.sim.queueCommand({ kind: 'rescue', ids: [rifle], target: w });
    wd.sim.queueCommand({ kind: 'rescue', ids: [medic], target: rifle });
    wd.sim.tick();
    expect([wd.sim.state.medState[rifle], wd.sim.state.medState[medic], wd.sim.state.medTimer[medic]]).toEqual([0, 0, -1]);
    expect(wd.sim.embarkAtSpawn(amb, w)).toBe(true);
    wd.sim.queueCommand({ kind: 'rescue', ids: [medic], target: w });
    wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTimer[medic]]).toEqual([0, -1]);
  });

  it('a move mid-carry: back to IDLE, the passenger kept; stopped again, he carries on delivering', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 5.5, 5.5);
    const w = downOf(wd, 0, 5.5, 6.5);
    expect(wd.sim.embarkAtSpawn(medic, w)).toBe(true);
    wd.sim.tick();
    expect(wd.sim.state.medState[medic]).toBe(3);
    wd.sim.queueCommand({ kind: 'move', ids: [medic], x: fx.from(7.5), y: fx.from(5.5) });
    wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.moving[medic], carriedBy(wd.sim)[w]]).toEqual([0, 1, medic]);
    wd.sim.addEvacPoint(0, fx.from(14.5), fx.from(5.5));
    const evs: SimEvent[] = [];
    for (let k = 0; k < 900; k++) evs.push(...wd.sim.tick());
    expect(of(evs, 'woundEvacuated').map((e) => e.entity)).toEqual([w]);
  });

  it('`unload` puts him down beside the medic and parks the medic: he is not picked straight back up', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 5.5, 5.5);
    const w = downOf(wd, 0, 5.5, 6.5);
    expect(wd.sim.embarkAtSpawn(medic, w)).toBe(true);
    wd.sim.tick();
    wd.sim.queueCommand({ kind: 'unload', ids: [medic] });
    wd.sim.tick();
    expect([carriedBy(wd.sim)[w], wd.sim.state.posX[w], wd.sim.state.posY[w]]).toEqual([-1, fx.from(6), fx.from(6)]);
    for (let k = 0; k < 100; k++) wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTimer[medic], carriedBy(wd.sim)[w], wd.sim.state.alive[w]]).toEqual([0, -1, -1, 1]);
  });

  it('D3: a carrying medic is refused as a rider; empty, he boards', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 5.5, 5.5);
    const apc = wd.put(APC, 0, 6.5, 5.5);
    const w = downOf(wd, 0, 5.5, 6.5);
    expect(wd.sim.embarkAtSpawn(medic, w)).toBe(true);
    expect(wd.sim.embarkAtSpawn(apc, medic)).toBe(false);
    wd.sim.queueCommand({ kind: 'load', ids: [medic], carrier: apc });
    wd.sim.tick();
    expect(col(wd.sim, 'boardGoal')[medic]).toBe(-1); // not walked to a hull that will not take him
    wd.sim.queueCommand({ kind: 'unload', ids: [medic] });
    wd.sim.tick();
    expect(wd.sim.embarkAtSpawn(apc, medic)).toBe(true);
  });
});

describe('carry-overs into Task 5', () => {
  it('(a) a civilian`s bleed pauses for ANY side`s medic within reach (parked here)', () => {
    const bleedAfter = (medicSide: number | null): number => {
      const wd = world();
      const civ = wd.put(CIVILIAN, 2, 5.5, 5.5);
      hit(wd.sim, civ, 30, wd.shooter);
      if (medicSide !== null) wd.sim.queueCommand({ kind: 'halt', ids: [wd.put(DRAGGER, medicSide, 6.5, 5.5)] });
      for (let k = 0; k < 50; k++) wd.sim.tick();
      return wd.sim.state.bleedTicks[civ];
    };
    expect(bleedAfter(null)).toBe(1150); // 60 s = 1200, less 50
    expect(bleedAfter(0)).toBe(1200);
    expect(bleedAfter(1)).toBe(1200);
  });

  it('(a) an enemy medic standing (parked) beside a soldier does not pause his bleed', () => {
    const wd = world();
    const w = downOf(wd, 0, 5.5, 5.5);
    wd.sim.queueCommand({ kind: 'halt', ids: [wd.put(DRAGGER, 1, 6.5, 5.5)] });
    for (let k = 0; k < 50; k++) wd.sim.tick();
    expect(wd.sim.state.bleedTicks[w]).toBe(1150);
  });

  it('(c) a wounded-role body spawned directly is DOWN, bleeds WOUND_DEFAULT_BLEED_TICKS (60 s), and counts', () => {
    const wd = world();
    expect(wd.sim.state.woundedAlive[1]).toBe(0);
    const b = wd.put(WOUNDED, 1, 5.5, 5.5);
    expect([wd.sim.state.woundState[b], wd.sim.state.bleedTicks[b], wd.sim.state.woundedAlive[1]]).toEqual([1, 1200, 1]);
    for (let k = 0; k < 10; k++) wd.sim.tick();
    expect(wd.sim.state.bleedTicks[b]).toBe(1190);
    wd.sim.debugKill(b);
    expect(wd.sim.state.woundedAlive[1]).toBe(0);
  });

  it('(c) a fall still counts its man once (spawn counts him; fallMan no longer does)', () => {
    const wd = world();
    downOf(wd, 0, 5.5, 5.5);
    expect(wd.sim.state.woundedAlive[0]).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// GH-707 Task 5 review fixes.

describe('the medic, Task 5 review fixes', () => {
  it('a medic on an enemy wounded stops tracking him the tick his side loses him', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 2.5, 5.5);
    const e = downOf(wd, 1, 17.5, 5.5); // 15 tiles: beyond every side-0 eye
    contact(wd.sim)[0 * CAP + e] = 65536;
    wd.sim.queueCommand({ kind: 'rescue', ids: [medic], target: e });
    wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTarget[medic], wd.sim.state.moving[medic]]).toEqual([1, e, 1]);
    contact(wd.sim)[0 * CAP + e] = 0;
    wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTarget[medic], wd.sim.state.moving[medic]]).toEqual([0, -1, 0]);
  });

  it('two medics, one wounded: only one takes the job', () => {
    const wd = world();
    const a = wd.put(DRAGGER, 0, 2.5, 5.5);
    const b = wd.put(DRAGGER, 0, 2.5, 6.5);
    const w = downOf(wd, 0, 6.5, 5.5);
    wd.sim.tick();
    expect([wd.sim.state.medTarget[a], wd.sim.state.medTarget[b], wd.sim.state.medState[a], wd.sim.state.medState[b]]).toEqual([w, -1, 1, 0]);
  });

  it('a refused `attack` changes nothing: the medic keeps treating, his clock running', () => {
    const wd = world();
    const medic = wd.put(DRAGGER, 0, 5.5, 5.5); // no weapon: canFocus refuses every attack
    downOf(wd, 0, 6.5, 5.5);
    for (let k = 0; k < 10; k++) wd.sim.tick();
    const t0 = wd.sim.state.medTimer[medic];
    expect(wd.sim.state.medState[medic]).toBe(2);
    contact(wd.sim)[0 * CAP + wd.shooter] = 65536;
    wd.sim.queueCommand({ kind: 'attack', ids: [medic], target: wd.shooter });
    wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTimer[medic]]).toEqual([2, t0 - 1]);
  });

  it('an accepted `attack` takes an armed medic off his job', () => {
    const ARMED: UnitTypeJson = {
      ...DRAGGER,
      id: 'rs_armed_medic',
      weapons: [{ id: 'rs_rifle', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 }],
    };
    const wd = world();
    const medic = wd.put(ARMED, 0, 5.5, 5.5);
    const w = downOf(wd, 0, 6.5, 5.5);
    for (let k = 0; k < 10; k++) wd.sim.tick();
    expect([wd.sim.state.medState[medic], wd.sim.state.medTarget[medic]]).toEqual([2, w]);
    contact(wd.sim)[0 * CAP + wd.shooter] = 65536;
    wd.sim.queueCommand({ kind: 'attack', ids: [medic], target: wd.shooter });
    wd.sim.tick();
    expect([wd.sim.state.focusTarget[medic], wd.sim.state.medState[medic], wd.sim.state.medTarget[medic]]).toEqual([wd.shooter, 0, -1]);
  });
});

// ---------------------------------------------------------------------------------------------
// GH-707 Task 6: the aid post. Post: tiles (16,5) (17,5) (16,6) (17,6), owner side 0, admit
// 2 tiles, treat 10 s = 200 ticks (100 when the man was STABILISED), dispatch 12 tiles.

const AID_POST: StructureTypeJson = { id: 'rs_aid', hp_per_tile: 200, aid: { admit_radius: 2, treat_s: 10, dispatch_radius: 12 } };

function post(sim: Sim, owner: number, tiles: number[] = [5 * 20 + 16, 5 * 20 + 17, 6 * 20 + 16, 6 * 20 + 17]): number {
  return sim.addStructure(sim.addStructureType(AID_POST), tiles, { owner });
}

describe('the aid post (GH-707 Task 6)', () => {
  it('admits from an ambulance beside it; 200 ticks later his squad is 3 -> 4 men and +100 hp, a second man +80', () => {
    const wd = world();
    const s = post(wd.sim, 0);
    const squad = wd.put(SLOW_BLEEDER, 0, 5.5, 5.5);
    const w1 = wd.sim.entityCount;
    hit(wd.sim, squad, 100, wd.shooter);
    const w2 = wd.sim.entityCount;
    hit(wd.sim, squad, 100, wd.shooter);
    expect([wd.sim.state.figuresUp[squad], wd.sim.state.hp[squad], wd.sim.state.woundedAlive[0]]).toEqual([2, 200 * 65536, 2]);
    const amb = wd.put(AMBULANCE, 0, 15.5, 5.5); // 1 tile from tile (16,5)'s centre: inside 2
    expect(wd.sim.embarkAtSpawn(amb, w1) && wd.sim.embarkAtSpawn(amb, w2)).toBe(true);
    const evs: SimEvent[] = [];
    for (let k = 0; k < 201; k++) evs.push(...wd.sim.tick());
    expect(of(evs, 'woundAdmitted').map((e) => [e.tick, e.entity, e.structure, e.side])).toEqual([[0, w1, s, 0], [0, w2, s, 0]]);
    expect([wd.sim.state.alive[w1], wd.sim.state.removed[w1], passengers(wd.sim)[amb], wd.sim.state.woundedAlive[0]]).toEqual([0, 1, 0, 0]);
    // Admitted on tick 0 with 200 ticks; counted down from tick 1: 0 on tick 200.
    expect(of(evs, 'woundRejoined').map((e) => [e.tick, e.entity, e.squad])).toEqual([[200, w1, squad], [200, w2, squad]]);
    // 200 + 100 (scars 0) + 80 (scars 1: 100 x 52429 raw) = 13107200 + 6553600 + 5242900 raw.
    expect([wd.sim.state.figuresUp[squad], wd.sim.state.hp[squad], wd.sim.state.scars[squad]]).toEqual([4, 24903700, 2]);
    expect([wd.sim.state.woundState[w1], wd.sim.state.admittedAt[w1]]).toEqual([4, -1]);
    expect(of(evs, 'destroyed').filter((e) => e.entity === w1 || e.entity === w2)).toEqual([]);
  });

  it('the rejoin never lifts hp past the standing men`s full shares (defensive: hp poked above them)', () => {
    const wd = world();
    post(wd.sim, 0);
    const squad = wd.put(SLOW_BLEEDER, 0, 5.5, 5.5);
    const w = wd.sim.entityCount;
    hit(wd.sim, squad, 100, wd.shooter);
    wd.sim.state.hp[squad] = 390 * 65536; // 3 men up, 390 hp: no shipped path reaches this
    const amb = wd.put(AMBULANCE, 0, 15.5, 5.5);
    expect(wd.sim.embarkAtSpawn(amb, w)).toBe(true);
    for (let k = 0; k < 201; k++) wd.sim.tick();
    // 390 + 100 capped at 400 x 4 / 4 = 400.
    expect([wd.sim.state.figuresUp[squad], wd.sim.state.hp[squad]]).toEqual([4, 400 * 65536]);
  });

  it('a medic carries a STABILISED man to the post: treated in half the time (100 ticks)', () => {
    const wd = world();
    const s = post(wd.sim, 0);
    const medic = wd.put(DRAGGER, 0, 2.5, 5.5);
    const squad = wd.put(SLOW_BLEEDER, 0, 6.5, 5.5);
    const w = wd.sim.entityCount;
    hit(wd.sim, squad, 100, wd.shooter);
    const evs: SimEvent[] = [];
    for (let k = 0; k < 1500 && of(evs, 'woundRejoined').length === 0; k++) evs.push(...wd.sim.tick());
    const adm = of(evs, 'woundAdmitted');
    expect(adm.map((e) => [e.entity, e.structure, e.side])).toEqual([[w, s, 0]]);
    expect(of(evs, 'woundRejoined').map((e) => [e.tick - adm[0].tick, e.squad])).toEqual([[100, squad]]);
    expect([wd.sim.state.medState[medic], passengers(wd.sim)[medic], wd.sim.state.figuresUp[squad]]).toEqual([0, 0, 4]);
  });

  it('his own squad dead: the nearest same-type squad of his side below full takes him', () => {
    const wd = world();
    post(wd.sim, 0);
    const own = wd.put(SLOW_BLEEDER, 0, 5.5, 5.5);
    const w = wd.sim.entityCount;
    hit(wd.sim, own, 100, wd.shooter);
    const far = wd.put(SLOW_BLEEDER, 0, 2.5, 9.5); // below full, farther
    hit(wd.sim, far, 100, wd.shooter);
    const near = wd.put(SLOW_BLEEDER, 0, 12.5, 9.5); // below full, nearer
    hit(wd.sim, near, 100, wd.shooter);
    wd.put(SLOW_BLEEDER, 0, 14.5, 8.5); // nearest of all, but full
    const other = wd.put(BLEEDER, 0, 15.5, 9.5); // below full and nearer still, another type
    hit(wd.sim, other, 100, wd.shooter);
    wd.put(SLOW_BLEEDER, 1, 15.5, 3.5); // the enemy's, below full
    hit(wd.sim, wd.sim.entityCount - 1, 100, wd.put(RIFLES, 0, 0.5, 11.5));
    wd.sim.debugKill(own);
    const amb = wd.put(AMBULANCE, 0, 15.5, 5.5);
    expect(wd.sim.embarkAtSpawn(amb, w)).toBe(true);
    const evs: SimEvent[] = [];
    for (let k = 0; k < 201; k++) evs.push(...wd.sim.tick());
    expect(of(evs, 'woundRejoined').map((e) => [e.entity, e.squad])).toEqual([[w, near]]);
    expect([wd.sim.state.figuresUp[near], wd.sim.state.figuresUp[far], wd.sim.state.figuresUp[other]]).toEqual([4, 3, 3]);
  });

  it('no squad to take him, an enemy`s man, a last man: each leaves alive, evacuated (carrier -1)', () => {
    const wd = world();
    post(wd.sim, 0);
    // A squad's last man (parent -1): a 400-hp hit, chance 1, sheds 3 + the body.
    const sq = wd.put(SLOW_BLEEDER, 0, 5.5, 5.5);
    const first = wd.sim.entityCount;
    hit(wd.sim, sq, 400, wd.shooter);
    const last = first + 3;
    expect([wd.sim.state.alive[sq], wd.sim.state.woundParent[last]]).toEqual([0, -1]);
    const enemy = downOf(wd, 1, 9.5, 9.5);
    const amb = wd.put(AMBULANCE, 0, 15.5, 5.5);
    const amb2 = wd.put(AMBULANCE, 0, 15.5, 6.5);
    expect(wd.sim.embarkAtSpawn(amb, first) && wd.sim.embarkAtSpawn(amb, last) && wd.sim.embarkAtSpawn(amb2, enemy)).toBe(true);
    const evs: SimEvent[] = [];
    for (let k = 0; k < 201; k++) evs.push(...wd.sim.tick());
    expect(of(evs, 'woundRejoined')).toEqual([]);
    // `first` fell from a squad that is gone, and nobody of its type is left below full.
    expect(of(evs, 'woundEvacuated').map((e) => [e.tick, e.entity, e.carrier, e.side])).toEqual([[200, first, -1, 0], [200, last, -1, 0], [200, enemy, -1, 0]]);
  });

  it('the post falls mid-treatment: the patient is lost', () => {
    const wd = world();
    const s = post(wd.sim, 0);
    const w = wd.down(5.5, 5.5);
    const amb = wd.put(AMBULANCE, 0, 15.5, 5.5);
    expect(wd.sim.embarkAtSpawn(amb, w)).toBe(true);
    const evs: SimEvent[] = [];
    for (let k = 0; k < 50; k++) evs.push(...wd.sim.tick());
    wd.sim.debugDestroyStructure(s);
    for (let k = 0; k < 200; k++) evs.push(...wd.sim.tick());
    expect(of(evs, 'woundLost').map((e) => [e.tick, e.entity, e.structure])).toEqual([[50, w, s]]);
    expect(of(evs, 'woundRejoined')).toEqual([]);
    expect(of(evs, 'woundEvacuated')).toEqual([]);
    expect([wd.sim.state.woundState[w], wd.sim.state.removed[w]]).toEqual([4, 0]);
  });

  it('only its own side`s carriers are admitted: an enemy`s post or a neutral one takes nobody', () => {
    const admitted = (owner: number): number => {
      const wd = world();
      post(wd.sim, owner);
      const w = downOf(wd, 0, 5.5, 5.5);
      const amb = wd.put(AMBULANCE, 0, 15.5, 5.5);
      expect(wd.sim.embarkAtSpawn(amb, w)).toBe(true);
      const evs: SimEvent[] = [];
      for (let k = 0; k < 5; k++) evs.push(...wd.sim.tick());
      return of(evs, 'woundAdmitted').length;
    };
    expect([admitted(0), admitted(1), admitted(-1)]).toEqual([1, 0, 0]);
  });

  it('beyond admit_radius nobody is admitted (2 tiles: 2.5 tiles off, no)', () => {
    const wd = world();
    post(wd.sim, 0);
    const w = downOf(wd, 0, 5.5, 5.5);
    const amb = wd.put(AMBULANCE, 0, 13.5, 5.5); // 3 tiles from (16,5)'s centre
    expect(wd.sim.embarkAtSpawn(amb, w)).toBe(true);
    const evs: SimEvent[] = [];
    for (let k = 0; k < 5; k++) evs.push(...wd.sim.tick());
    expect(of(evs, 'woundAdmitted')).toEqual([]);
  });

  it('dispatch: a medic 10 tiles from the post goes to a wounded 11 tiles from the post, 21 from him', () => {
    const pick = (owner: number | null): [number, number] => {
      const wd = world(40, 12);
      if (owner !== null) post(wd.sim, owner, [5 * 40 + 20]); // one tile, centre (20.5, 5.5)
      const medic = wd.put(DRAGGER, 0, 10.5, 5.5);
      const w = downOf(wd, 0, 31.5, 5.5);
      wd.sim.tick();
      return [wd.sim.state.medTarget[medic], w];
    };
    const [t, w] = pick(0);
    expect(t).toBe(w);
    expect(pick(null)[0]).toBe(-1); // no post: 21 tiles is beyond his own 8
    expect(pick(1)[0]).toBe(-1); // the enemy's post dispatches nobody of ours
  });
});

/** Every shipped unit JSON under data/units, read off the disk. */
function shippedUnits(): UnitTypeJson[] {
  const out: UnitTypeJson[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.json')) out.push(JSON.parse(readFileSync(p, 'utf8')) as UnitTypeJson);
    }
  };
  walk(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'units'));
  return out;
}
