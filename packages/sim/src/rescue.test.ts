import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fx, type Fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';

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

function world(): World {
  const sim = new Sim({ seed: 0x7070_0004, width: 20, height: 12, capacity: 48 });
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
    expect(sim.embarkAtSpawn(amb, put(WOUNDED, 0, 6.5, 5.5))).toBe(true); // woundState NONE, role wounded
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
