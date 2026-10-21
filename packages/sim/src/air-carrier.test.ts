import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { AIR_AIRBORNE, AIR_LANDING, AIR_LANDED, AIR_LIFTING } from './tuning';

// GH-698 Task 2: the air carrier state block. Three per-unit columns
// (airState, airTimer, airWant), folded into hash() only once an air carrier
// type is registered (Q-A, deferred fold), and `isAirborne` (Q-C: a LANDING
// carrier is a ground target). Nothing in the sim reads the columns yet.

const RIFLES: UnitTypeJson = {
  id: 'ac_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

const JEEP: UnitTypeJson = {
  id: 'ac_jeep',
  name: 'Jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};

const DRONE: UnitTypeJson = {
  id: 'ac_drone',
  role: 'drone',
  hull: { hp: 120, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 2.2, domain: 'air' },
  sensors: { optics: 2, sight_tiles: 16, signature: 0.3 },
};

const HELO: UnitTypeJson = {
  id: 'ac_helo',
  name: 'Yanshuf',
  role: 'transport',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 4, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
  weapons: [],
};

function world(withCarrier: boolean): { sim: Sim; inf: number; jeep: number; drone: number; helo: number } {
  const sim = new Sim({ seed: 0x6980_0002, width: 20, height: 20, capacity: 16 });
  const ti = sim.addUnitType(RIFLES);
  const tj = sim.addUnitType(JEEP);
  const td = sim.addUnitType(DRONE);
  const inf = sim.spawn(ti, 0, fx.fromInt(3), fx.fromInt(3));
  const jeep = sim.spawn(tj, 0, fx.fromInt(5), fx.fromInt(5));
  const drone = sim.spawn(td, 0, fx.fromInt(7), fx.fromInt(7));
  let helo = -1;
  if (withCarrier) helo = sim.spawn(sim.addUnitType(HELO), 0, fx.fromInt(9), fx.fromInt(9));
  for (let i = 0; i < 5; i++) sim.tick();
  return { sim, inf, jeep, drone, helo };
}

describe('air carrier state block (GH-698 Task 2)', () => {
  it('isAirCarrier: an air type with seats only', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const types = [HELO, DRONE, JEEP].map((j) => sim.unitTypes[sim.addUnitType(j)]);
    expect(types.map((t) => t.isAirCarrier)).toEqual([true, false, false]);
  });

  it('a fresh spawn has airState 0, airTimer 0, airWant 0', () => {
    const { sim, helo, inf } = world(true);
    for (const id of [helo, inf]) {
      expect(sim.state.airState[id]).toBe(0);
      expect(sim.state.airTimer[id]).toBe(0);
      expect(sim.state.airWant[id]).toBe(0);
    }
  });

  it('registering an air carrier type turns the fold on; a drone or a jeep does not', () => {
    expect(world(false).sim.airCarrierLive).toBe(false);
    expect(world(true).sim.airCarrierLive).toBe(true);
  });

  const columns = ['airState', 'airTimer', 'airWant'] as const;
  for (const name of columns) {
    it(`hash covers ${name}`, () => {
      const { sim, helo } = world(true);
      const before = sim.hash();
      sim.state[name][helo] += 1;
      expect(sim.hash()).not.toBe(before);
    });
  }

  it('no air carrier registered: airState is not folded', () => {
    // Q-A: a world with a drone (air, no seats) and a jeep (seats, ground) has no
    // air carrier type, so the block folds nothing and no pin can move.
    const { sim, drone } = world(false);
    const before = sim.hash();
    sim.state.airState[drone] = 2;
    sim.state.airTimer[drone] = 7;
    sim.state.airWant[drone] = 1;
    expect(sim.hash()).toBe(before);
  });

  it('isAirborne: AIRBORNE and LIFTING are air', () => {
    const { sim, helo } = world(true);
    sim.state.airState[helo] = AIR_AIRBORNE;
    expect(sim.isAirborne(helo)).toBe(true);
    sim.state.airState[helo] = AIR_LIFTING;
    expect(sim.isAirborne(helo)).toBe(true);
  });

  it('Q-C: a LANDING carrier is a ground target', () => {
    const { sim, helo } = world(true);
    sim.state.airState[helo] = AIR_LANDING;
    expect(sim.isAirborne(helo)).toBe(false);
  });

  it('isAirborne: a LANDED carrier is a ground target', () => {
    const { sim, helo } = world(true);
    sim.state.airState[helo] = AIR_LANDED;
    expect(sim.isAirborne(helo)).toBe(false);
  });

  it('isAirborne: a ground unit is never airborne, in every state', () => {
    const { sim, inf, jeep } = world(true);
    for (const id of [inf, jeep]) {
      for (const s of [0, 1, 2, 3]) {
        sim.state.airState[id] = s;
        expect(sim.isAirborne(id)).toBe(false);
      }
    }
  });
});

// ------------------------------------------------------------------ Task 3
// GH-698 Task 3, R1-R4: land to load, land to unload. Every oracle below is a
// literal with its arithmetic beside it, never a value read off the code.

const HELI: UnitTypeJson = {
  id: 'ac_heli',
  name: 'Yanshuf',
  role: 'apc',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
  weapons: [
    {
      id: 'ac_door_gun', type: 'hmg', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.4,
      penetration: 20, damage: 30, suppression: 40, rof_per_min: 120, can_target: ['ground'],
    },
  ],
};

interface Heli {
  sim: Sim;
  heli: number;
  inf: number;
}

const at = (n: number): number => fx.from(n);

function heliWorld(hx: number, hy: number, size = 40): Heli {
  const sim = new Sim({ seed: 0x6980_0003, width: size, height: size, capacity: 64 });
  const inf = sim.addUnitType(RIFLES);
  const heli = sim.spawn(sim.addUnitType(HELI), 0, at(hx), at(hy));
  return { sim, heli, inf };
}

function run(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

function aboard(sim: Sim, car: number): number {
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1 && sim.state.carriedBy[i] === car) n++;
  return n;
}

function tileOf(sim: Sim, id: number): [number, number] {
  return [fx.toInt(sim.state.posX[id]), fx.toInt(sim.state.posY[id])];
}

/** A HELI at (hx, hy) with `n` squads authored aboard (embarkAtSpawn: R8). */
function loadedHeli(hx: number, hy: number, n: number, size = 40): Heli & { squads: number[] } {
  const w = heliWorld(hx, hy, size);
  const squads: number[] = [];
  for (let k = 0; k < n; k++) {
    const s = w.sim.spawn(w.inf, 0, at(hx), at(hy));
    expect(w.sim.embarkAtSpawn(w.heli, s)).toBe(true);
    squads.push(s);
  }
  return { ...w, squads };
}

describe('air carriers land to load and unload (GH-698 Task 3)', () => {
  it('boarding is refused while airborne; an authored passenger is not (R8)', () => {
    // The squad stands 1 tile from the hull, inside LOAD_RANGE (1.5 tiles), so a
    // ground carrier would seat it on the first tick.
    const { sim, heli, inf } = heliWorld(20.5, 20.5);
    const sq = sim.spawn(inf, 0, at(21.5), at(20.5));
    sim.queueCommand({ kind: 'load', ids: [sq], carrier: heli });
    let boardedAt = -1;
    for (let t = 1; t <= 100; t++) {
      sim.tick();
      if (sim.state.carriedBy[sq] === heli) {
        expect(sim.state.airState[heli]).toBe(AIR_LANDED);
        if (boardedAt < 0) boardedAt = t;
      }
    }
    expect(boardedAt).toBeGreaterThan(40); // at least a whole landing first
    // R8: a mission's authored passenger rides an AIRBORNE carrier.
    const w2 = heliWorld(10.5, 10.5);
    expect(w2.sim.state.airState[w2.heli]).toBe(AIR_AIRBORNE);
    expect(w2.sim.embarkAtSpawn(w2.heli, w2.sim.spawn(w2.inf, 0, at(10.5), at(10.5)))).toBe(true);
  });

  it('literal timeline: LANDING, 40 ticks to LANDED, 20 ticks of LIFTING', () => {
    // HELI at x 10.5, squad at x 20.5 on the same row: the LZ is the squad's own
    // tile (20,10), centre 20.5. Speed 3.2 tiles/s = 0.16 tile/tick (raw 10486):
    // 10 tiles = 655360 raw = 62 whole steps + 5228, so it arrives in tick 63
    // (moving 0), LANDING in tick 64, LANDED in tick 64 + 40 = 104, and the
    // squad -- already on the LZ -- boards that same tick (stepTransport runs
    // after stepAirCarriers).
    const { sim, heli, inf } = heliWorld(10.5, 10.5);
    const sq = sim.spawn(inf, 0, at(20.5), at(10.5));
    sim.queueCommand({ kind: 'load', ids: [sq], carrier: heli });
    run(sim, 63);
    expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
    expect(sim.state.posX[heli]).toBe(at(20.5));
    run(sim, 1); // tick 64
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    run(sim, 39); // tick 103
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    expect(sim.state.carriedBy[sq]).toBe(-1);
    run(sim, 1); // tick 104
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(sim.state.carriedBy[sq]).toBe(heli);
    const x = sim.state.posX[heli];
    const y = sim.state.posY[heli];
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(30.5), y: at(10.5) });
    for (let k = 0; k < 20; k++) {
      sim.tick();
      expect(sim.state.airState[heli]).toBe(AIR_LIFTING);
      expect(sim.state.posX[heli]).toBe(x);
      expect(sim.state.posY[heli]).toBe(y);
    }
    sim.tick();
    expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
    expect(sim.state.posX[heli]).toBeGreaterThan(x); // and flying again, rider aboard
    expect(sim.state.carriedBy[sq]).toBe(heli);
  });

  it('pinned in place through LANDING, LANDED and LIFTING, a move during LANDING ignored', () => {
    const { sim, heli } = loadedHeli(20.5, 20.5, 2);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 2); // on its own tile centre: arrives tick 1, LANDING tick 2
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    const x = sim.state.posX[heli];
    const y = sim.state.posY[heli];
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(30.5), y: at(30.5) });
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) {
      sim.tick();
      seen.add(sim.state.airState[heli]);
      expect([sim.state.posX[heli], sim.state.posY[heli]]).toEqual([x, y]);
    }
    expect(sim.state.airState[heli]).toBe(AIR_LANDED); // the move did not lift it
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(30.5), y: at(30.5) });
    for (let k = 0; k < 20; k++) {
      sim.tick();
      seen.add(sim.state.airState[heli]);
      expect([sim.state.posX[heli], sim.state.posY[heli]]).toEqual([x, y]);
    }
    expect([...seen].sort()).toEqual([AIR_LANDING, AIR_LANDED, AIR_LIFTING]);
  });

  it('six aboard; a seventh stays on the ground', () => {
    const { sim, heli, inf } = heliWorld(20.5, 20.5);
    const squads: number[] = [];
    for (let k = 0; k < 7; k++) squads.push(sim.spawn(inf, 0, at(16.5 + k), at(24.5)));
    sim.queueCommand({ kind: 'load', ids: squads, carrier: heli });
    run(sim, 400);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(aboard(sim, heli)).toBe(6);
    // Boarding goes in id order on equal footing; the last id is left over.
    expect(squads.map((s) => sim.state.carriedBy[s] === heli)).toEqual([true, true, true, true, true, true, false]);
  });

  // The LZ, for a HELI at (20.5,20.5) over a vehicle-blocked tile (20,20): the
  // ring-1 scan runs row-major from (19,19), which is open -> LZ (19,19).
  const obstacles: Array<[string, (sim: Sim) => void]> = [
    [
      '#',
      (sim) => {
        const st = sim.addStructureType({ id: 'ac_block', name: 'Block', hp_per_tile: 900, garrison_slots: 0, rubble_cover: 1 });
        sim.addStructure(st, [20 * 40 + 20]);
      },
    ],
    ['^', (sim) => sim.setBlocked(20, 20, true)],
    ['b', (sim) => sim.setBoulder(20, 20, true)],
  ];
  for (const [sym, put] of obstacles) {
    it(`unload over a ${sym} tile lands on the nearest vehicle-open LZ, six on six tiles`, () => {
      const { sim, heli, squads } = loadedHeli(20.5, 20.5, 6);
      put(sim);
      sim.queueCommand({ kind: 'unload', ids: [heli] });
      run(sim, 100);
      expect(sim.state.airState[heli]).toBe(AIR_LANDED);
      expect(tileOf(sim, heli)).toEqual([19, 19]);
      expect(sim.blockedVehicle[19 * 40 + 19]).toBe(0);
      const tiles = new Set<number>();
      for (const s of squads) {
        expect(sim.state.carriedBy[s]).toBe(-1);
        const [tx, ty] = tileOf(sim, s);
        expect(sim.blocked[ty * 40 + tx]).toBe(0);
        tiles.add(ty * 40 + tx);
      }
      expect(tiles.size).toBe(6);
    });
  }

  it('unload spreads by (distance, tile index): the LZ, its edges, then corners', () => {
    // Open ground, LZ (20,20). Order: (20,20); (20,19) (19,20) (21,20) (20,21);
    // then the corners (19,19) (21,19) -- six passengers, six tiles.
    const { sim, heli, squads } = loadedHeli(20.5, 20.5, 6);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 60);
    expect(squads.map((s) => tileOf(sim, s))).toEqual([
      [20, 20], [20, 19], [19, 20], [21, 20], [20, 21], [19, 19],
    ]);
  });

  it('unload is land-then-unload: nobody out until LANDED, everybody out the tick it is', () => {
    const { sim, heli, squads } = loadedHeli(20.5, 20.5, 6);
    // Block a 5x5 square under it so the LZ is two rings away and there is a flight.
    for (let y = 18; y <= 22; y++) for (let x = 18; x <= 22; x++) sim.setBlocked(x, y, true);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    let landedAt = -1;
    for (let t = 1; t <= 120; t++) {
      sim.tick();
      const out = squads.filter((s) => sim.state.carriedBy[s] === -1).length;
      if (sim.state.airState[heli] !== AIR_LANDED) {
        expect(out).toBe(0);
      } else {
        if (landedAt < 0) landedAt = t;
        expect(out).toBe(6);
      }
    }
    expect(landedAt).toBeGreaterThan(41);
  });

  it('halt while LANDING completes the landing and the unload', () => {
    const { sim, heli } = loadedHeli(20.5, 20.5, 3);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 2);
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    sim.queueCommand({ kind: 'halt', ids: [heli] });
    run(sim, 40); // timer 40 set in tick 2, counted down in ticks 3..42
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(aboard(sim, heli)).toBe(0);
  });

  it('a move while flying to land cancels the plan; nobody leaves', () => {
    const { sim, heli } = loadedHeli(20.5, 20.5, 3);
    for (let y = 18; y <= 22; y++) for (let x = 18; x <= 22; x++) sim.setBlocked(x, y, true);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 3);
    expect(sim.state.airWant[heli]).toBe(2); // AIR_WANT_UNLOAD
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(30.5), y: at(30.5) });
    for (let k = 0; k < 200; k++) {
      sim.tick();
      expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
    }
    expect(aboard(sim, heli)).toBe(3);
    expect(tileOf(sim, heli)).toEqual([30, 30]);
  });

  it('a halt while flying to land cancels the plan and the carrier hovers', () => {
    const { sim, heli } = loadedHeli(20.5, 20.5, 3);
    for (let y = 18; y <= 22; y++) for (let x = 18; x <= 22; x++) sim.setBlocked(x, y, true);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 3);
    sim.queueCommand({ kind: 'halt', ids: [heli] });
    sim.tick();
    const x = sim.state.posX[heli];
    run(sim, 100);
    expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
    expect(sim.state.airWant[heli]).toBe(0);
    expect(sim.state.posX[heli]).toBe(x);
    expect(aboard(sim, heli)).toBe(3);
  });

  it('unload while LIFTING lands again after the lift', () => {
    // Land it to load one more squad standing on its tile, then lift and unload.
    const { sim, heli, inf } = loadedHeli(20.5, 20.5, 2);
    const extra = sim.spawn(inf, 0, at(20.5), at(20.5));
    sim.queueCommand({ kind: 'load', ids: [extra], carrier: heli });
    run(sim, 42); // arrives tick 1, LANDING tick 2, LANDED tick 42
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(aboard(sim, heli)).toBe(3);
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(30.5), y: at(20.5) });
    run(sim, 5);
    expect(sim.state.airState[heli]).toBe(AIR_LIFTING);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    // Lift began tick 43, AIRBORNE tick 63, ordered to land on its own tile
    // (20,20): arrives tick 63's movement, LANDING tick 64, LANDED tick 104.
    run(sim, 15); // tick 62
    expect(sim.state.airState[heli]).toBe(AIR_LIFTING);
    run(sim, 1); // 63
    expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
    run(sim, 1); // 64
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    run(sim, 40); // 104
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(aboard(sim, heli)).toBe(0);
    expect(tileOf(sim, heli)).toEqual([20, 20]);
  });

  it('a cancelled load releases its riders: no stale boardGoal, no uninvited boarding', () => {
    // Load sends the squad to the LZ (30,20); the carrier is moved to (29,21)
    // before it lands, then unloads there (lands on its own tile)
    // -- (29.5,21.5) is sqrt 2 = 1.41 tiles from the squad
    // waiting at (30.5,20.5), inside LOAD_RANGE (1.5 tiles).
    const { sim, heli, inf } = heliWorld(20.5, 20.5);
    const sq = sim.spawn(inf, 0, at(30.5), at(20.5));
    const rider = sim.spawn(inf, 0, at(20.5), at(20.5));
    expect(sim.embarkAtSpawn(heli, rider)).toBe(true);
    sim.queueCommand({ kind: 'load', ids: [sq], carrier: heli });
    run(sim, 5);
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(29.5), y: at(21.5) });
    run(sim, 80);
    expect(tileOf(sim, heli)).toEqual([29, 21]);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 60);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(sim.state.carriedBy[rider]).toBe(-1);
    expect(sim.state.moving[sq]).toBe(0); // released, not walking to a stale LZ
    expect(sim.state.carriedBy[sq]).toBe(-1);
    run(sim, 40);
    expect(sim.state.carriedBy[sq]).toBe(-1);
  });

  it('a carrier landed to load keeps its riders until they board', () => {
    // The squad walks 5 tiles at 0.9 tiles/s (~111 ticks); the carrier lands
    // on its own tile first (LANDED tick 42) and waits with want LOAD.
    const { sim, heli, inf } = heliWorld(20.5, 20.5);
    const sq = sim.spawn(inf, 0, at(25.5), at(20.5));
    sim.queueCommand({ kind: 'load', ids: [sq], carrier: heli });
    run(sim, 300);
    expect(sim.state.carriedBy[sq]).toBe(heli);
  });

  it('a move during LANDING writes nothing: the landing and its unload stand', () => {
    const { sim, heli } = loadedHeli(20.5, 20.5, 2);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 2);
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    const gx = sim.goalOf(heli);
    sim.queueCommand({ kind: 'attackMove', ids: [heli], x: at(30.5), y: at(30.5) });
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(5.5), y: at(5.5), exact: true });
    run(sim, 40);
    expect(sim.goalOf(heli)).toEqual(gx);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(aboard(sim, heli)).toBe(0);
  });

  it('LANDING holds the hull against stepFocus: an attack order chases nothing', () => {
    // An enemy 9 tiles east, revealed: outside the HELI's door gun (8), so a
    // focus would close on it (stepFocus runs before stepAirCarriers). Ordered during LANDING, the hull
    // must not move until the landing is done.
    const { sim, heli } = loadedHeli(20.5, 20.5, 2);
    const foe = sim.spawn(0, 1, at(29.5), at(20.5));
    run(sim, 20);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 2);
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    const x = sim.state.posX[heli];
    sim.queueCommand({ kind: 'reveal', side: 0, x: at(29.5), y: at(20.5) });
    sim.tick(); // identified now (reveal), so the attack below is accepted
    sim.queueCommand({ kind: 'attack', ids: [heli], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[heli]).toBe(foe);
    run(sim, 37);
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    expect(sim.state.posX[heli]).toBe(x);
  });

  it('LANDING snaps the hull onto the LZ tile centre, and unloads about it', () => {
    // Arrives at (20.5,20.5) in tick 1. Pushed to x 21.0 -- exactly HALF off the
    // goal, so still "at the LZ" -- it must land at 20.5, and the first
    // passenger stands on the LZ tile (20,20), not on tile 21.
    const { sim, heli, squads } = loadedHeli(20.5, 20.5, 2);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 1);
    sim.state.posX[heli] = at(21);
    run(sim, 1);
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    expect(sim.state.posX[heli]).toBe(at(20.5));
    run(sim, 40);
    expect(tileOf(sim, squads[0])).toEqual([20, 20]);
  });

  it('Review Focus 1: two carriers unloading at one point put nobody on a blocked tile', () => {
    const a = loadedHeli(20.5, 20.5, 6);
    const { sim } = a;
    const b = sim.spawn(1, 0, at(20.5), at(20.5)); // type 1 is HELI
    const bSquads: number[] = [];
    for (let k = 0; k < 6; k++) {
      const s = sim.spawn(a.inf, 0, at(20.5), at(20.5));
      expect(sim.embarkAtSpawn(b, s)).toBe(true);
      bSquads.push(s);
    }
    // A wall along x = 21 and the tile under them.
    for (let y = 15; y <= 25; y++) sim.setBlocked(21, y, true);
    sim.setBlocked(20, 20, true);
    sim.queueCommand({ kind: 'unload', ids: [a.heli, b] });
    run(sim, 120);
    for (const car of [a.heli, b]) {
      expect(sim.state.airState[car]).toBe(AIR_LANDED);
      const [tx, ty] = tileOf(sim, car);
      expect(sim.blockedVehicle[ty * 40 + tx]).toBe(0);
    }
    expect(tileOf(sim, a.heli)).toEqual(tileOf(sim, b)); // stacked LZ is tolerated
    for (const s of [...a.squads, ...bSquads]) {
      expect(sim.state.carriedBy[s]).toBe(-1);
      const [tx, ty] = tileOf(sim, s);
      expect(sim.blocked[ty * 40 + tx]).toBe(0);
    }
  });

  it('Review Focus 2: no vehicle-open tile anywhere -- load and unload change nothing', () => {
    // Every tile of a 12x12 map is blocked. The oracle is a CONTROL sim built
    // identically and ticked identically with no command: the command tick's
    // own effects (tickCount, detection, fields) are in both, so equal hashes
    // mean the refused command wrote nothing.
    const build = (): Heli & { squads: number[]; sq: number } => {
      const w = loadedHeli(5.5, 5.5, 2, 12);
      const sq = w.sim.spawn(w.inf, 0, at(6.5), at(5.5));
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) w.sim.setBlocked(x, y, true);
      return { ...w, sq };
    };
    const subject = build();
    const control = build();
    run(subject.sim, 3);
    run(control.sim, 3);
    expect(subject.sim.hash()).toBe(control.sim.hash());
    subject.sim.queueCommand({ kind: 'load', ids: [subject.sq], carrier: subject.heli });
    subject.sim.tick();
    control.sim.tick();
    expect(subject.sim.hash()).toBe(control.sim.hash());
    subject.sim.queueCommand({ kind: 'unload', ids: [subject.heli] });
    subject.sim.tick();
    control.sim.tick();
    expect(subject.sim.hash()).toBe(control.sim.hash());
    run(subject.sim, 60);
    expect(subject.sim.state.airState[subject.heli]).toBe(AIR_AIRBORNE);
    expect(aboard(subject.sim, subject.heli)).toBe(2);
  });
});
