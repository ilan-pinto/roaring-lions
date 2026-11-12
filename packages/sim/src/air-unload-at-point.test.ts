import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import {
  AIR_AIRBORNE,
  AIR_LANDED,
  AIR_LANDING,
  AIR_LIFT_TICKS,
  AIR_LIFTING,
  AIR_WANT_NONE,
  AIR_WANT_UNLOAD,
  AIR_WANT_UNLOAD_AT,
} from './tuning';

// GH-698, unload-at-point: `unload` with an `x`/`y` sends a loaded air carrier
// to land at the footprint nearest that point (lzFor, the R2 rules), unload
// there and stay landed. Fixtures as air-carrier.test.ts's.

const RIFLES: UnitTypeJson = {
  id: 'up_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

const HELI: UnitTypeJson = {
  id: 'up_heli',
  name: 'Yanshuf',
  role: 'apc',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
  weapons: [],
};

const JEEP: UnitTypeJson = {
  id: 'up_jeep',
  name: 'Jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};

const at = (n: number): number => fx.from(n);

interface World {
  sim: Sim;
  heli: number;
  inf: number;
  squads: number[];
}

/** A HELI at (hx, hy) with `n` squads authored aboard (embarkAtSpawn: R8), on a 40x40 map. */
function loaded(hx: number, hy: number, n: number): World {
  const sim = new Sim({ seed: 0x6980_0698, width: 40, height: 40, capacity: 64 });
  const inf = sim.addUnitType(RIFLES);
  const heli = sim.spawn(sim.addUnitType(HELI), 0, at(hx), at(hy));
  const squads: number[] = [];
  for (let k = 0; k < n; k++) {
    const s = sim.spawn(inf, 0, at(hx), at(hy));
    expect(sim.embarkAtSpawn(heli, s)).toBe(true);
    squads.push(s);
  }
  return { sim, heli, inf, squads };
}

function run(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

function aboard(sim: Sim, car: number): number {
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1 && sim.state.carriedBy[i] === car) n++;
  return n;
}

const tileOf = (sim: Sim, id: number): [number, number] => [fx.toInt(sim.state.posX[id]), fx.toInt(sim.state.posY[id])];

/** Riders out, each on a foot-open tile, all on distinct tiles within the LZ's 3x3. */
function expectSpread(w: World, lz: [number, number]): void {
  const tiles = new Set<number>();
  for (const s of w.squads) {
    expect(w.sim.state.carriedBy[s]).toBe(-1);
    const [tx, ty] = tileOf(w.sim, s);
    expect(w.sim.blocked[ty * 40 + tx]).toBe(0);
    expect(Math.abs(tx - lz[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(ty - lz[1])).toBeLessThanOrEqual(1);
    tiles.add(ty * 40 + tx);
  }
  expect(tiles.size).toBe(w.squads.length);
}

/** Land `w.heli` where it hovers (a plain unload of nobody would be a no-op, so a load): LANDED, riders aboard. */
function landHere(w: World): void {
  const extra = w.sim.spawn(w.inf, 0, w.sim.state.posX[w.heli], w.sim.state.posY[w.heli]);
  w.sim.queueCommand({ kind: 'load', ids: [extra], carrier: w.heli });
  run(w.sim, 42); // arrives tick 1, LANDING tick 2, LANDED tick 42
  expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
  w.squads.push(extra);
  expect(aboard(w.sim, w.heli)).toBe(w.squads.length);
}

describe('unload at a chosen point (GH-698)', () => {
  it('airborne: flies to the point, lands on its tile, unloads around it, and stays landed', () => {
    const w = loaded(10.5, 10.5, 6);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(30.5), y: at(28.5) });
    let landedAt = -1;
    for (let t = 1; t <= 300; t++) {
      w.sim.tick();
      const st = w.sim.state.airState[w.heli];
      if (st !== AIR_LANDED) expect(aboard(w.sim, w.heli)).toBe(6); // nobody out in the air or landing
      else if (landedAt < 0) landedAt = t;
    }
    // ~28 tiles at 3.2 t/s is ~180 ticks, then 40 of landing.
    expect(landedAt).toBeGreaterThan(200);
    expect(tileOf(w.sim, w.heli)).toEqual([30, 28]);
    expectSpread(w, [30, 28]);
    // Stays landed until ordered off.
    const x = w.sim.state.posX[w.heli];
    run(w.sim, 200);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(w.sim.state.posX[w.heli]).toBe(x);
  });

  it('a point over a building lands on the nearest vehicle-open footprint (R2), riders on foot-open tiles', () => {
    const w = loaded(10.5, 10.5, 6);
    for (let y = 28; y <= 32; y++) for (let x = 28; x <= 32; x++) w.sim.setBlocked(x, y, true);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(30.5), y: at(30.5) });
    run(w.sim, 320);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    // Ring search from (30,30): a 3x3 clear of the 5x5 block (28..32) needs its centre at 26 or 34; ring 4, first row-major.
    expect(tileOf(w.sim, w.heli)).toEqual([26, 26]);
    const [hx, hy] = tileOf(w.sim, w.heli);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(w.sim.blockedVehicle[(hy + dy) * 40 + hx + dx]).toBe(0);
    expectSpread(w, [26, 26]);
  });

  it('a point with no clear footprint within reach is refused: a landRefused event and nothing changed', () => {
    const order = (send: boolean): { hash: number; events: SimEvent[]; w: World } => {
      const w = loaded(5.5, 5.5, 3);
      for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) w.sim.setBlocked(x, y, true);
      if (send) w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(35.5), y: at(35.5) });
      const events = run(w.sim, 1);
      return { hash: w.sim.hash(), events, w };
    };
    const sent = order(true);
    expect(sent.events.filter((e) => e.kind === 'landRefused')).toMatchObject([{ kind: 'landRefused', carrier: sent.w.heli, reason: 'no_clear_ground' }]);
    expect(sent.hash).toBe(order(false).hash);
    expect(sent.w.sim.state.airWant[sent.w.heli]).toBe(AIR_WANT_NONE);
    expect(aboard(sent.w.sim, sent.w.heli)).toBe(3);
  });

  it('refused while LANDED too: it stays landed with its riders aboard', () => {
    const w = loaded(5.5, 5.5, 2);
    landHere(w);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) w.sim.setBlocked(x, y, true);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(35.5), y: at(35.5) });
    const events = run(w.sim, 60);
    expect(events.some((e) => e.kind === 'landRefused')).toBe(true);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(aboard(w.sim, w.heli)).toBe(3);
  });

  it('no passengers: a no-op, the carrier does not fly there', () => {
    const order = (send: boolean): number => {
      const w = loaded(10.5, 10.5, 0);
      if (send) w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(30.5), y: at(30.5) });
      run(w.sim, 50);
      return w.sim.hash();
    };
    expect(order(true)).toBe(order(false));
  });

  it('a ground carrier ignores the point: everyone out beside the hull, as the plain unload', () => {
    const order = (point: boolean): number => {
      const sim = new Sim({ seed: 0x6980_0698, width: 40, height: 40, capacity: 16 });
      const inf = sim.addUnitType(RIFLES);
      const jeep = sim.spawn(sim.addUnitType(JEEP), 0, at(10.5), at(10.5));
      for (let k = 0; k < 2; k++) expect(sim.embarkAtSpawn(jeep, sim.spawn(inf, 0, at(10.5), at(10.5)))).toBe(true);
      sim.queueCommand(point ? { kind: 'unload', ids: [jeep], x: at(30.5), y: at(30.5) } : { kind: 'unload', ids: [jeep] });
      run(sim, 20);
      expect(aboard(sim, jeep)).toBe(0);
      return sim.hash();
    };
    expect(order(true)).toBe(order(false));
  });

  it('shot down en route: all aboard die (the R5 airborne rule)', () => {
    const w = loaded(10.5, 10.5, 6);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(30.5), y: at(30.5) });
    run(w.sim, 60);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_AIRBORNE);
    expect(w.sim.state.airWant[w.heli]).toBe(AIR_WANT_UNLOAD);
    w.sim.debugKill(w.heli);
    for (const id of [w.heli, ...w.squads]) expect(w.sim.state.alive[id]).toBe(0);
  });

  it('ordered again mid-flight: the second point replaces the first', () => {
    const w = loaded(10.5, 10.5, 4);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(30.5), y: at(30.5) });
    run(w.sim, 40);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_AIRBORNE);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(8.5), y: at(30.5) });
    for (let t = 0; t < 400; t++) {
      w.sim.tick();
      // It never sets down at the first point.
      if (w.sim.state.airState[w.heli] !== AIR_AIRBORNE) expect(tileOf(w.sim, w.heli)).toEqual([8, 30]);
    }
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expectSpread(w, [8, 30]);
  });

  it('LANDED elsewhere: lifts for AIR_LIFT_TICKS, flies, lands at the point; nobody out at the first LZ', () => {
    const w = loaded(10.5, 10.5, 2);
    landHere(w);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(25.5), y: at(10.5) });
    const x0 = w.sim.state.posX[w.heli];
    run(w.sim, 1);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LIFTING);
    expect(w.sim.state.airWant[w.heli]).toBe(AIR_WANT_UNLOAD_AT);
    for (let t = 1; t < AIR_LIFT_TICKS; t++) {
      expect(w.sim.state.posX[w.heli]).toBe(x0);
      expect(aboard(w.sim, w.heli)).toBe(3);
      w.sim.tick();
    }
    expect(w.sim.state.airState[w.heli]).toBe(AIR_AIRBORNE);
    run(w.sim, 200);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(tileOf(w.sim, w.heli)).toEqual([25, 10]);
    expectSpread(w, [25, 10]);
  });

  it('LANDED with the point inside its own footprint: unloads where it is, at once, and stays', () => {
    const w = loaded(10.5, 10.5, 2);
    landHere(w);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(11.5), y: at(9.5) });
    run(w.sim, 1);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(tileOf(w.sim, w.heli)).toEqual([10, 10]);
    expectSpread(w, [10, 10]);
  });

  it('LANDING elsewhere waves off: LIFTING, then lands at the point', () => {
    const w = loaded(10.5, 10.5, 3);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli] });
    run(w.sim, 2);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDING);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(25.5), y: at(25.5) });
    run(w.sim, 1);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LIFTING);
    expect(aboard(w.sim, w.heli)).toBe(3);
    run(w.sim, 300);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(tileOf(w.sim, w.heli)).toEqual([25, 25]);
    expectSpread(w, [25, 25]);
  });

  it('LANDING with the point inside its footprint: the landing stands and unloads on touchdown', () => {
    const w = loaded(10.5, 10.5, 3);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli] });
    run(w.sim, 2);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDING);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(11.5), y: at(10.5) });
    for (let t = 0; t < 39; t++) {
      w.sim.tick();
      expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDING);
      expect(aboard(w.sim, w.heli)).toBe(3);
    }
    run(w.sim, 1);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(tileOf(w.sim, w.heli)).toEqual([10, 10]);
    expectSpread(w, [10, 10]);
  });

  it('a carrier lifting for a chosen point holds that LZ: a later order to the same point lands clear of it', () => {
    const w = loaded(10.5, 10.5, 2);
    landHere(w);
    const b = w.sim.spawn(w.sim.state.typeIdx[w.heli], 0, at(30.5), at(30.5));
    expect(w.sim.embarkAtSpawn(b, w.sim.spawn(w.inf, 0, at(30.5), at(30.5)))).toBe(true);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(25.5), y: at(25.5) });
    run(w.sim, 2);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LIFTING);
    w.sim.queueCommand({ kind: 'unload', ids: [b], x: at(25.5), y: at(25.5) });
    run(w.sim, 320);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(w.sim.state.airState[b]).toBe(AIR_LANDED);
    expect(tileOf(w.sim, w.heli)).toEqual([25, 25]); // the first order keeps its LZ
    const [bx, by] = tileOf(w.sim, b);
    expect(Math.max(Math.abs(bx - 25), Math.abs(by - 25))).toBeGreaterThan(2);
  });

  it('LIFTING: the point is taken up at the end of the lift', () => {
    const w = loaded(10.5, 10.5, 2);
    landHere(w);
    w.sim.queueCommand({ kind: 'move', ids: [w.heli], x: at(30.5), y: at(10.5) });
    run(w.sim, 5);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LIFTING);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(10.5), y: at(25.5) });
    run(w.sim, 300);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(tileOf(w.sim, w.heli)).toEqual([10, 25]);
    expectSpread(w, [10, 25]);
  });

  it('a move after the order cancels it, even mid-lift: nobody leaves', () => {
    const w = loaded(10.5, 10.5, 2);
    landHere(w);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(25.5), y: at(10.5) });
    run(w.sim, 3);
    expect(w.sim.state.airWant[w.heli]).toBe(AIR_WANT_UNLOAD_AT);
    w.sim.queueCommand({ kind: 'move', ids: [w.heli], x: at(10.5), y: at(30.5) });
    run(w.sim, 300);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_AIRBORNE);
    expect(tileOf(w.sim, w.heli)).toEqual([10, 30]);
    expect(aboard(w.sim, w.heli)).toBe(3);
  });

  it('the point inside the fog: an unseen enemy at the point changes nothing about where it lands', () => {
    // The LZ rule reads the ground (known to both sides), never units: an enemy
    // standing unseen at the point (20 tiles past the heli's 10-tile sight at
    // order time) leaks nothing through the choice, and the order is accepted.
    const landing = (enemy: boolean): [number, number] => {
      const w = loaded(5.5, 5.5, 3);
      if (enemy) w.sim.spawn(w.inf, 1, at(30.5), at(30.5));
      w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(30.5), y: at(30.5) });
      run(w.sim, 1);
      expect(w.sim.state.airWant[w.heli]).toBe(AIR_WANT_UNLOAD);
      run(w.sim, 320);
      expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
      expect(aboard(w.sim, w.heli)).toBe(0);
      return tileOf(w.sim, w.heli);
    };
    expect(landing(true)).toEqual([30, 30]);
    expect(landing(false)).toEqual([30, 30]);
  });

  it('a second carrier ordered to the same point lands clear of the first (R2 lzTaken)', () => {
    const w = loaded(10.5, 10.5, 2);
    const b = w.sim.spawn(w.sim.state.typeIdx[w.heli], 0, at(12.5), at(10.5));
    expect(w.sim.embarkAtSpawn(b, w.sim.spawn(w.inf, 0, at(12.5), at(10.5)))).toBe(true);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli, b], x: at(25.5), y: at(25.5) });
    run(w.sim, 320);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(w.sim.state.airState[b]).toBe(AIR_LANDED);
    const [ax, ay] = tileOf(w.sim, w.heli);
    const [bx, by] = tileOf(w.sim, b);
    expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBeGreaterThan(2);
  });

  // GH-698 (PR 1252 review): the footprint check is by side. Ground an enemy carrier sits on is
  // occupied; ground it merely plans to land on is not (and must not leak that plan).
  it('an ENEMY carrier\'s reservation does not deny my landing (it flies to the point, I land first)', () => {
    const w = loaded(22.5, 22.5, 2);
    const e = w.sim.spawn(w.sim.state.typeIdx[w.heli], 1, at(38.5), at(38.5));
    expect(w.sim.embarkAtSpawn(e, w.sim.spawn(w.inf, 1, at(38.5), at(38.5)))).toBe(true);
    w.sim.queueCommand({ kind: 'unload', ids: [e], x: at(25.5), y: at(25.5) });
    run(w.sim, 1);
    expect(w.sim.state.airWant[e]).toBe(AIR_WANT_UNLOAD); // the enemy holds a reservation on (25,25)
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(25.5), y: at(25.5) });
    run(w.sim, 100);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    expect(w.sim.state.airState[e]).toBe(AIR_AIRBORNE); // still en route: only a plan, not ground
    expect(tileOf(w.sim, w.heli)).toEqual([25, 25]);
  });

  it('an ENEMY carrier sitting on the footprint DOES occupy it: I land clear of it', () => {
    const w = loaded(10.5, 10.5, 2);
    const e = w.sim.spawn(w.sim.state.typeIdx[w.heli], 1, at(25.5), at(25.5));
    expect(w.sim.settleOnGround(e)).toBe(true);
    expect(w.sim.state.airState[e]).toBe(AIR_LANDED);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(25.5), y: at(25.5) });
    run(w.sim, 320);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    const [ax, ay] = tileOf(w.sim, w.heli);
    expect(Math.max(Math.abs(ax - 25), Math.abs(ay - 25))).toBeGreaterThan(2);
    expect(tileOf(w.sim, e)).toEqual([25, 25]); // and the enemy was not moved
  });

  it('a FRIENDLY reservation still denies (same side keeps the old rule)', () => {
    const w = loaded(22.5, 22.5, 2);
    const f = w.sim.spawn(w.sim.state.typeIdx[w.heli], 0, at(38.5), at(38.5));
    expect(w.sim.embarkAtSpawn(f, w.sim.spawn(w.inf, 0, at(38.5), at(38.5)))).toBe(true);
    w.sim.queueCommand({ kind: 'unload', ids: [f], x: at(25.5), y: at(25.5) });
    run(w.sim, 1);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli], x: at(25.5), y: at(25.5) });
    run(w.sim, 320);
    expect(w.sim.state.airState[w.heli]).toBe(AIR_LANDED);
    const [ax, ay] = tileOf(w.sim, w.heli);
    expect(Math.max(Math.abs(ax - 25), Math.abs(ay - 25))).toBeGreaterThan(2);
  });

  it('an attack order mid-flight cancels the pending unload: no landing, no stale reservation', () => {
    const sim = new Sim({ seed: 0x6980_0699, width: 40, height: 40, capacity: 64 });
    const inf = sim.addUnitType(RIFLES);
    const armed = sim.addUnitType({
      ...HELI,
      id: 'up_heli_gun',
      weapons: [{
        id: 'up_door_gun', type: 'hmg', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.4,
        penetration: 20, damage: 30, suppression: 40, rof_per_min: 120, can_target: ['ground'],
      }],
    });
    const heli = sim.spawn(armed, 0, at(10.5), at(10.5));
    const rider = sim.spawn(inf, 0, at(10.5), at(10.5));
    expect(sim.embarkAtSpawn(heli, rider)).toBe(true);
    const foe = sim.spawn(inf, 1, at(10.5), at(14.5));
    const other = sim.spawn(armed, 0, at(10.5), at(30.5));
    expect(sim.embarkAtSpawn(other, sim.spawn(inf, 0, at(10.5), at(30.5)))).toBe(true);
    sim.queueCommand({ kind: 'unload', ids: [heli], x: at(30.5), y: at(30.5) });
    sim.queueCommand({ kind: 'reveal', side: 0, x: at(10.5), y: at(14.5) });
    run(sim, 3);
    expect(sim.state.airWant[heli]).toBe(AIR_WANT_UNLOAD);
    sim.queueCommand({ kind: 'attack', ids: [heli], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[heli]).toBe(foe);
    expect(sim.state.airWant[heli]).toBe(AIR_WANT_NONE);
    // A second carrier sent to the same point takes it: nothing of the cancelled order is held.
    sim.queueCommand({ kind: 'unload', ids: [other], x: at(30.5), y: at(30.5) });
    run(sim, 1);
    for (let k = 0; k < 200; k++) {
      sim.tick();
      expect(sim.state.airState[heli]).not.toBe(AIR_LANDED);
      expect(sim.state.airState[heli]).not.toBe(AIR_LANDING);
    }
    expect(sim.state.airState[other]).toBe(AIR_LANDED);
    expect(tileOf(sim, other)).toEqual([30, 30]);
    expect(sim.state.carriedBy[rider]).toBe(heli); // the rider is still aboard
  });
});

/**
 * A world that never sends a point: load, plain unloads in every air state (the plain unload while
 * LIFTING is the branch this change sits beside), moves and a halt, with every tick's hash folded in.
 * The literal was read on main (e8da5117c) before the unload-at-point change: it must not move.
 */
describe('no point, no change (GH-698 unload-at-point)', () => {
  it('a plain-order air carrier replay hashes byte-identical to main', () => {
    const w = loaded(10.5, 10.5, 2);
    const extra = w.sim.spawn(w.inf, 0, at(10.5), at(10.5));
    let acc = 0;
    const step = (n: number): void => {
      for (let i = 0; i < n; i++) {
        w.sim.tick();
        acc = (Math.imul(acc, 31) + w.sim.hash()) >>> 0;
      }
    };
    w.sim.queueCommand({ kind: 'load', ids: [extra], carrier: w.heli });
    step(50);
    w.sim.queueCommand({ kind: 'move', ids: [w.heli], x: at(30.5), y: at(10.5) });
    step(5);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli] }); // while LIFTING
    step(80);
    w.sim.queueCommand({ kind: 'move', ids: [w.heli], x: at(20.5), y: at(30.5) });
    step(30);
    w.sim.queueCommand({ kind: 'unload', ids: [w.heli] }); // airborne, nobody aboard: a no-op
    step(10);
    w.sim.queueCommand({ kind: 'halt', ids: [w.heli] });
    step(100);
    expect(acc).toBe(PLAIN_REPLAY_HASH);
  });
});

/** Read on main e8da5117c, 11 Nov 2026, GH-698 (see the describe above). */
const PLAIN_REPLAY_HASH = 568441889;
