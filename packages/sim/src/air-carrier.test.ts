import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { AIR_AIRBORNE, AIR_LANDING, AIR_LANDED, AIR_LAND_TICKS, AIR_LIFT_TICKS, AIR_LIFTING } from './tuning';

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

  it('LANDING holds the hull against stepFocus; an attack order during LANDING is ignored', () => {
    // An enemy 9 tiles east, revealed: outside the HELI's door gun (8), so a
    // focus would close on it (stepFocus runs before stepAirCarriers).
    const { sim, heli } = loadedHeli(20.5, 20.5, 2);
    const foe = sim.spawn(0, 1, at(29.5), at(20.5));
    run(sim, 20);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 2);
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    const x = sim.state.posX[heli];
    sim.queueCommand({ kind: 'reveal', side: 0, x: at(29.5), y: at(20.5) });
    sim.tick(); // identified now (reveal), so an attack would be accepted
    sim.queueCommand({ kind: 'attack', ids: [heli], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[heli]).toBe(-1); // ignored while LANDING
    // A focus however it got there (written straight into the column): the
    // chase must still not move a landing hull.
    sim.state.focusTarget[heli] = foe;
    run(sim, 37);
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    expect(sim.state.posX[heli]).toBe(x);
    run(sim, 1);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(aboard(sim, heli)).toBe(0);
  });

  it('an attack while flying to load cancels the plan and releases the riders', () => {
    // Load sends the HELI to the LZ (30,20) at the squad; an attack on a
    // revealed foe north of it, while airborne, replaces the plan: the chase
    // goal (the foe's last-seen tile, never checked as an LZ) is never landed
    // on, and the squad is released rather than left waiting.
    const { sim, heli, inf } = heliWorld(20.5, 20.5);
    const sq = sim.spawn(inf, 0, at(30.5), at(20.5));
    const foe = sim.spawn(0, 1, at(20.5), at(8.5));
    sim.setBoulder(20, 8, true);
    sim.queueCommand({ kind: 'load', ids: [sq], carrier: heli });
    sim.queueCommand({ kind: 'reveal', side: 0, x: at(20.5), y: at(8.5) });
    run(sim, 3);
    expect(sim.state.airWant[heli]).toBe(1); // AIR_WANT_LOAD
    sim.queueCommand({ kind: 'attack', ids: [heli], target: foe });
    sim.tick();
    expect(sim.state.focusTarget[heli]).toBe(foe);
    expect(sim.state.airWant[heli]).toBe(0);
    for (let k = 0; k < 300; k++) {
      sim.tick();
      expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
    }
    expect(sim.state.carriedBy[sq]).toBe(-1);
    expect(sim.state.moving[sq]).toBe(0);
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

// GH-698 Task 4 (R6, item 9): landed means ground. The five TARGETING readers
// ask `isAirborne`, not the type's `isAir`: a LANDING or LANDED carrier is a
// ground target (Q-C), so a ground-only weapon can engage it and an air-only
// one cannot. Movement, formation and the rest keep the type test.

const WEAPON = {
  range_tiles: 8,
  effective_range_tiles: 6,
  accuracy: 0.9,
  penetration: 8,
  damage: 50,
  suppression: 0,
  rof_per_min: 120,
};

/** A transport heli built to be hurt by an RPG (pen 60) and not by a rifle (pen 8): armour 32 all round. */
const ARMOURED_HELO: UnitTypeJson = {
  ...HELO,
  id: 'ac_t4_helo',
  hull: { hp: 900, armor: { front: 32, side: 32, rear: 32 }, transport_slots: 6 },
};

const shooter = (id: string, weapon: Record<string, unknown>, extra: Partial<UnitTypeJson> = {}): UnitTypeJson => ({
  id,
  role: 'infantry',
  hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
  weapons: [{ id: `${id}_w`, type: 'small_arms', ...WEAPON, ...weapon }],
  ...extra,
});

const MANPAD = shooter('t4_manpad', { type: 'hmg', can_target: ['air'], penetration: 60 });
const RPG = shooter('t4_rpg', { type: 'rpg', can_target: ['ground'], penetration: 60, damage: 100 });
const ZU = shooter('t4_zu', { type: 'autocannon', can_target: ['ground', 'air'], penetration: 60 });
const RIFLE = shooter('t4_rifle', { can_target: ['ground'] });

const MUNITION: UnitTypeJson = {
  id: 't4_munition',
  role: 'drone',
  hull: { hp: 90, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 2.8, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 13, signature: 0.3 },
  abilities: ['kamikaze'],
  weapons: [
    {
      id: 'warhead',
      type: 'heat',
      range_tiles: 1.2,
      effective_range_tiles: 1.2,
      accuracy: 0.9,
      penetration: 480,
      damage: 520,
      splash_tiles: 1.2,
      suppression: 70,
      rof_per_min: 6,
      can_target: ['ground', 'structure'],
    },
  ],
};

/** Side 1's heli at (20.5, 10.5) in the given air state, identified to side 0. */
function t4World(state: number): { sim: Sim; helo: number } {
  const sim = new Sim({ seed: 0x6980_0004, width: 40, height: 20, capacity: 16 });
  const helo = sim.spawn(sim.addUnitType(ARMOURED_HELO), 1, fx.from(20.5), fx.from(10.5));
  sim.state.airState[helo] = state;
  sim.identifyTo(0, helo);
  return { sim, helo };
}

function put(sim: Sim, json: UnitTypeJson, x: number, y: number): number {
  return sim.spawn(sim.addUnitType(json), 0, fx.from(x), fx.from(y));
}

describe('landed means ground (GH-698 Task 4)', () => {
  it('Q-C: AIR_LANDING and AIR_LIFTING and AIRBORNE: LANDING is ground, the others are air', () => {
    // The question the plan's literal R6 and the lead's Q-C answer differently.
    for (const [s, want] of [[AIR_AIRBORNE, true], [AIR_LIFTING, true], [AIR_LANDING, false], [AIR_LANDED, false]] as const) {
      const { sim, helo } = t4World(s);
      expect(sim.isAirborne(helo)).toBe(want);
    }
  });

  it('a MANPAD cannot hurt a landed or landing heli, and can an airborne one', () => {
    for (const [s, want] of [[AIR_AIRBORNE, true], [AIR_LIFTING, true], [AIR_LANDING, false], [AIR_LANDED, false]] as const) {
      const { sim, helo } = t4World(s);
      const m = put(sim, MANPAD, 16.5, 10.5);
      expect(sim.focusHurts(m, helo)).toBe(want);
    }
  });

  it('an RPG hurts a landed or landing heli, and not an airborne one', () => {
    for (const [s, want] of [[AIR_AIRBORNE, false], [AIR_LIFTING, false], [AIR_LANDING, true], [AIR_LANDED, true]] as const) {
      const { sim, helo } = t4World(s);
      const r = put(sim, RPG, 16.5, 10.5);
      expect(sim.focusHurts(r, helo)).toBe(want);
    }
  });

  it('a ground-and-air gun hurts it in every state', () => {
    for (const s of [AIR_AIRBORNE, AIR_LIFTING, AIR_LANDING, AIR_LANDED]) {
      const { sim, helo } = t4World(s);
      expect(sim.focusHurts(put(sim, ZU, 16.5, 10.5), helo)).toBe(true);
    }
  });

  it('rifles do not hurt it (spec section 3 armour: pen 8 against 32)', () => {
    const { sim, helo } = t4World(AIR_LANDED);
    expect(sim.focusHurts(put(sim, RIFLE, 16.5, 10.5), helo)).toBe(false);
  });

  it('engageable: an RPG in range wears a landed heli down; the same RPG at an airborne one does nothing', () => {
    const landed = t4World(AIR_LANDED);
    put(landed.sim, RPG, 16.5, 10.5);
    const aloft = t4World(AIR_AIRBORNE);
    put(aloft.sim, RPG, 16.5, 10.5);
    for (let i = 0; i < 200; i++) {
      landed.sim.tick();
      aloft.sim.tick();
    }
    expect(landed.sim.state.hp[landed.helo]).toBeLessThan(fx.fromInt(900));
    expect(aloft.sim.state.hp[aloft.helo]).toBe(fx.fromInt(900));
  });

  it('couldEngage: an attack-moving MANPAD does not chase a landed heli, an RPG does', () => {
    const run = (json: UnitTypeJson): number => {
      const { sim, helo } = t4World(AIR_LANDED);
      const id = put(sim, json, 5.5, 10.5);
      sim.queueCommand({ kind: 'attackMove', ids: [id], x: fx.from(5.5), y: fx.from(10.5), sweep: true });
      for (let i = 0; i < 100; i++) {
        sim.tick();
        sim.identifyTo(0, helo);
      }
      return fx.toInt(sim.state.posX[id]);
    };
    expect(run(MANPAD)).toBe(5);
    expect(run(RPG)).toBeGreaterThan(5);
  });

  it('focusInReach: an RPG ordered onto a landed heli closes to its range and holds', () => {
    const { sim, helo } = t4World(AIR_LANDED);
    const r = put(sim, RPG, 5.5, 10.5);
    sim.queueCommand({ kind: 'attack', ids: [r], target: helo });
    for (let i = 0; i < 400; i++) sim.tick();
    // Effective range 6: it stops 6 tiles (plus the half-tile slack) short of x=20.5, never on top of it.
    expect(sim.state.moving[r]).toBe(0);
    expect(fx.toNumber(sim.state.posX[r])).toBeGreaterThan(12);
    expect(fx.toNumber(sim.state.posX[r])).toBeLessThan(15.6);
  });

  it('stepKamikaze: a loitering munition dives at a landed heli and spares an airborne one', () => {
    const strike = (state: number): number => {
      const { sim, helo } = t4World(state);
      put(sim, MUNITION, 10.5, 10.5);
      for (let i = 0; i < 300; i++) sim.tick();
      return sim.state.hp[helo];
    };
    expect(strike(AIR_LANDED)).toBeLessThan(fx.fromInt(900));
    expect(strike(AIR_AIRBORNE)).toBe(fx.fromInt(900));
  });

  it('a non-air unit is unaffected by every airState value', () => {
    for (const s of [0, 1, 2, 3]) {
      const sim = new Sim({ seed: 3, width: 20, height: 20, capacity: 8 });
      const foe = sim.spawn(sim.addUnitType(RIFLES), 1, fx.from(10.5), fx.from(10.5));
      sim.state.airState[foe] = s;
      const rpg = put(sim, RPG, 6.5, 10.5);
      const aa = put(sim, MANPAD, 6.5, 11.5);
      expect(sim.focusHurts(rpg, foe)).toBe(true);
      expect(sim.focusHurts(aa, foe)).toBe(false);
    }
  });
});

// ------------------------------------------------------------------ Task 5
// GH-698 Task 5 (R5, item 8): an air carrier shot down while AIRBORNE or
// LIFTING takes everyone aboard with it, each death credited to the killer
// through the ordinary destroy path. LANDING and LANDED (Q-C: a ground target)
// and every ground carrier bail out as before: 0.4 of max hp lost, shaken.

/** Every living id riding `car`, and every id whose carriedBy names `car` at all. */
function ridersOf(sim: Sim, car: number): number {
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.carriedBy[i] === car) n++;
  return n;
}

// RIFLES hp 400 = raw 26214400. Bail-out damage fx.mul(26214400, 26214) =
// 26214400 * 26214 >> 16 = 10485600; 26214400 - 10485600 = 15728800 (0.6 of
// max hp, plus 0.4's own rounding: 240 * 65536 = 15728640, 160 raw short).
const BAILED_HP = 15728800;

describe('shot down in the air takes everyone (GH-698 Task 5)', () => {
  it('airborne kill takes all six: seven dead, no seat counted, no carriedBy left set', () => {
    const { sim, heli, squads } = loadedHeli(20.5, 20.5, 6);
    expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
    sim.debugKill(heli);
    let dead = 0;
    for (const id of [heli, ...squads]) if (sim.state.alive[id] === 0) dead++;
    expect(dead).toBe(7);
    expect(sim.passengerCount(heli)).toBe(0);
    expect(ridersOf(sim, heli)).toBe(0);
    for (const s of squads) expect(sim.state.hp[s]).toBe(0);
  });

  it('kill credit: a gun that downs an airborne heli is credited with the heli plus six', () => {
    // Side 1 heli, six side 1 squads aboard; a side 0 ground-and-air gun 4 tiles off.
    const sim = new Sim({ seed: 0x6980_0005, width: 40, height: 20, capacity: 16 });
    const inf = sim.addUnitType(RIFLES);
    const heli = sim.spawn(sim.addUnitType(HELI), 1, at(20.5), at(10.5));
    for (let k = 0; k < 6; k++) expect(sim.embarkAtSpawn(heli, sim.spawn(inf, 1, at(20.5), at(10.5)))).toBe(true);
    const zu = put(sim, ZU, 16.5, 10.5);
    let credited = 0;
    for (let t = 0; t < 2000 && sim.state.alive[heli] === 1; t++) {
      sim.identifyTo(0, heli);
      for (const e of sim.tick()) if (e.kind === 'destroyed' && e.by === zu) credited++;
    }
    expect(sim.state.alive[heli]).toBe(0);
    expect(credited).toBe(7); // 1 heli + 6 squads
  });

  it('landed kill bails out: six alive at 0.6 hp on foot-open tiles, nobody aboard', () => {
    const { sim, heli, squads } = loadedHeli(20.5, 20.5, 6);
    // Bail-out spot is hull + half a tile = (21.0, 21.0), tile (21,21): make it a wall.
    sim.setBlocked(21, 21, true);
    sim.state.airState[heli] = AIR_LANDED;
    sim.debugKill(heli);
    expect(sim.state.alive[heli]).toBe(0);
    expect(sim.passengerCount(heli)).toBe(0);
    for (const s of squads) {
      expect(sim.state.alive[s]).toBe(1);
      expect(sim.state.carriedBy[s]).toBe(-1);
      expect(sim.state.hp[s]).toBe(BAILED_HP);
      const [tx, ty] = tileOf(sim, s);
      expect(sim.blocked[ty * 40 + tx]).toBe(0);
    }
  });

  it('LANDING bails out (R5, Q-C); LIFTING kills', () => {
    const landing = loadedHeli(20.5, 20.5, 6);
    landing.sim.state.airState[landing.heli] = AIR_LANDING;
    landing.sim.debugKill(landing.heli);
    expect(landing.squads.map((s) => landing.sim.state.alive[s])).toEqual([1, 1, 1, 1, 1, 1]);
    expect(landing.squads.map((s) => landing.sim.state.hp[s])).toEqual(Array(6).fill(BAILED_HP));

    const lifting = loadedHeli(20.5, 20.5, 6);
    lifting.sim.state.airState[lifting.heli] = AIR_LIFTING;
    lifting.sim.debugKill(lifting.heli);
    expect(lifting.squads.map((s) => lifting.sim.state.alive[s])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(ridersOf(lifting.sim, lifting.heli)).toBe(0);
  });

  it('a ground carrier bails out in every airState value', () => {
    for (const st of [AIR_AIRBORNE, AIR_LANDING, AIR_LANDED, AIR_LIFTING]) {
      const sim = new Sim({ seed: 0x6980_0006, width: 40, height: 40, capacity: 8 });
      sim.addUnitType(HELI); // the fold and the air path are live in this world
      const inf = sim.addUnitType(RIFLES);
      const jeep = sim.spawn(sim.addUnitType(JEEP), 0, at(10.5), at(10.5));
      const a = sim.spawn(inf, 0, at(10.5), at(10.5));
      const b = sim.spawn(inf, 0, at(10.5), at(10.5));
      expect(sim.embarkAtSpawn(jeep, a)).toBe(true);
      expect(sim.embarkAtSpawn(jeep, b)).toBe(true);
      sim.state.airState[jeep] = st;
      sim.debugKill(jeep);
      for (const s of [a, b]) {
        expect(sim.state.alive[s]).toBe(1);
        expect(sim.state.carriedBy[s]).toBe(-1);
        expect(sim.state.hp[s]).toBe(BAILED_HP);
      }
    }
  });

  it('Review Focus 5: a rider still walking to the carrier lives, and drops its boardGoal', () => {
    // Load from 10 tiles: the heli flies at 0.16 tile/tick to the squad's tile
    // (63 ticks, see the literal timeline); at tick 10 it is AIRBORNE and the
    // squad is walking to the LZ, not seated.
    const { sim, heli, inf } = heliWorld(10.5, 10.5);
    const sq = sim.spawn(inf, 0, at(20.5), at(10.5));
    const aboardOne = sim.spawn(inf, 0, at(10.5), at(10.5));
    expect(sim.embarkAtSpawn(heli, aboardOne)).toBe(true);
    sim.queueCommand({ kind: 'load', ids: [sq], carrier: heli });
    run(sim, 10);
    expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
    expect(sim.boardGoalOf(sq)).toBe(heli);
    expect(sim.state.carriedBy[sq]).toBe(-1);
    sim.debugKill(heli);
    expect(sim.state.alive[aboardOne]).toBe(0);
    expect(sim.state.alive[sq]).toBe(1);
    expect(sim.state.hp[sq]).toBe(fx.fromInt(400));
    sim.tick();
    expect(sim.boardGoalOf(sq)).toBe(-1);
    expect(sim.state.alive[sq]).toBe(1);
  });

  it('Review Focus 4: removeFromPlay of a loaded heli takes the riders out with it (GH-815)', () => {
    // removeFromPlay is not combat: it calls no destroy. It used to leave the riders for
    // stepTransport's dead-carrier branch to put down shaken a tick later; now the carrier is
    // driven off the board and the riders go with it, landed or airborne alike -- each removed
    // in the same call, never hurt, so no rider is left standing where the aircraft vanished.
    for (const st of [AIR_LANDED, AIR_AIRBORNE]) {
      const { sim, heli, squads } = loadedHeli(20.5, 20.5, 6);
      sim.state.airState[heli] = st;
      const hpBefore = squads.map((s) => sim.state.hp[s]);
      sim.removeFromPlay(heli);
      expect(sim.state.alive[heli]).toBe(0);
      expect(ridersOf(sim, heli)).toBe(0); // the same call: nothing left aboard
      expect(sim.passengerCount(heli)).toBe(0);
      sim.tick();
      squads.forEach((s, k) => {
        expect([sim.state.alive[s], sim.state.removed[s]]).toEqual([0, 1]);
        expect(sim.state.hp[s]).toBe(hpBefore[k]); // never bailed out: nothing was shot down
      });
    }
  });

  it('Review Focus 4: a ground carrier entering a tunnel still unloads everyone (unloadAll)', () => {
    const sim = new Sim({ seed: 0x6980_0007, width: 16, height: 16, capacity: 8 });
    sim.addUnitType(HELI);
    const route = sim.addTunnel({ id: 'tn_t5', points: [[2, 2], [8, 2]], dig_tiles_per_s: 1 });
    const inf = sim.addUnitType(RIFLES);
    const jeep = sim.spawn(sim.addUnitType(JEEP), 0, at(5.5), at(5.5));
    const a = sim.spawn(inf, 0, at(5.5), at(5.5));
    expect(sim.embarkAtSpawn(jeep, a)).toBe(true);
    sim.putInTunnel(jeep, route);
    expect(sim.state.carriedBy[a]).toBe(-1);
    expect(sim.passengerCount(jeep)).toBe(0);
    expect(sim.state.alive[a]).toBe(1);
    expect(sim.state.hp[a]).toBe(fx.fromInt(400)); // unloaded, not bailed out
  });
});

// ------------------------------------------------------------------ Task 6
// GH-698 Task 6 (R8): the mission's authored-aboard path onto an airborne air
// carrier. embarkAtSpawn is the one caller allowed to seat a passenger while the
// carrier is in the air.

const TANK6: UnitTypeJson = {
  id: 'ac_t6_tank',
  name: 'Tank',
  role: 'mbt',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1, sight_tiles: 12, signature: 1 },
  weapons: [],
};

describe('embarkAtSpawn onto an air carrier (GH-698 Task 6, R8)', () => {
  it('seats onto an AIRBORNE carrier and rides with the hull', () => {
    const { sim, heli, inf } = heliWorld(10.5, 10.5);
    expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
    const sq = sim.spawn(inf, 0, at(3.5), at(3.5));
    expect(sim.embarkAtSpawn(heli, sq)).toBe(true);
    expect(sim.state.carriedBy[sq]).toBe(heli);
    expect(sim.passengerCount(heli)).toBe(1);
    expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE); // seating did not land it
    // Snapped onto the hull at once ...
    expect(sim.state.posX[sq]).toBe(at(10.5));
    expect(sim.state.posY[sq]).toBe(at(10.5));
    // ... and carried with it when it flies (10.5 -> 30.5: 20 tiles at 0.16/tick).
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(30.5), y: at(10.5) });
    run(sim, 40);
    expect(sim.state.posX[heli]).toBeGreaterThan(at(14));
    expect(sim.state.posX[sq]).toBe(sim.state.posX[heli]);
    expect(sim.state.posY[sq]).toBe(sim.state.posY[heli]);
    expect(sim.state.carriedBy[sq]).toBe(heli);
    expect(sim.state.airState[heli]).toBe(AIR_AIRBORNE);
  });

  it('refused past six seats: the seventh is false and stays on the ground', () => {
    const { sim, heli, inf } = heliWorld(10.5, 10.5);
    const results: boolean[] = [];
    const ids: number[] = [];
    for (let k = 0; k < 7; k++) {
      const s = sim.spawn(inf, 0, at(5.5), at(5.5));
      ids.push(s);
      results.push(sim.embarkAtSpawn(heli, s));
    }
    expect(results).toEqual([true, true, true, true, true, true, false]);
    expect(sim.passengerCount(heli)).toBe(6);
    expect(sim.state.carriedBy[ids[6]]).toBe(-1);
    expect(sim.state.posX[ids[6]]).toBe(at(5.5));
  });

  it('still refuses a tank, airborne or not', () => {
    const { sim, heli } = heliWorld(10.5, 10.5);
    const tank = sim.spawn(sim.addUnitType(TANK6), 0, at(10.5), at(10.5));
    expect(sim.embarkAtSpawn(heli, tank)).toBe(false);
    expect(sim.passengerCount(heli)).toBe(0);
    expect(sim.state.carriedBy[tank]).toBe(-1);
  });
});

/**
 * fix/air-pathing, part 2 (lead ruling, 21 Oct 2026): an air carrier
 * mobility-killed in the air (`mobilityKilled` -- the component roll's
 * `mobility_kill` or `combat_ineffective`) used to hover for good. stepMovement
 * skips a mobility-killed hull, so it never reached any LZ, never landed, and
 * its riders could never get out (4 of 160 probe runs). It now makes a forced
 * landing: where it is when that tile is foot-open, else on the nearest
 * foot-open tile, then lands as usual, and stays down while the kill stands.
 */
describe('a mobility-killed air carrier makes a forced landing (fix/air-pathing)', () => {
  it('lands where it is and its riders can unload', () => {
    const { sim, heli, squads } = loadedHeli(10.5, 10.5, 3);
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(30.5), y: at(10.5) });
    run(sim, 20);
    const x = sim.state.posX[heli];
    sim.state.mobilityKilled[heli] = 1;
    run(sim, 1);
    expect(sim.state.airState[heli]).toBe(AIR_LANDING);
    expect(sim.state.posX[heli]).toBe(x); // where it is: no snap on open ground
    run(sim, AIR_LAND_TICKS);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(aboard(sim, heli)).toBe(3);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 1);
    expect(aboard(sim, heli)).toBe(0);
    for (const s of squads) expect(sim.state.alive[s]).toBe(1);
  });

  it('an unload already queued completes on the forced landing', () => {
    // The probe's stranded case: `unload` is queued, the hull is killed before it lands.
    const { sim, heli } = loadedHeli(10.5, 10.5, 2);
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(30.5), y: at(10.5) });
    run(sim, 20);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    sim.state.mobilityKilled[heli] = 1;
    run(sim, AIR_LAND_TICKS + 2);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(aboard(sim, heli)).toBe(0);
  });

  it('over a building it comes down on the nearest foot-open tile', () => {
    const { sim, heli } = loadedHeli(10.5, 10.5, 1);
    for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) sim.setBlocked(x, y, true);
    sim.state.mobilityKilled[heli] = 1;
    run(sim, AIR_LAND_TICKS + 1);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    const [tx, ty] = tileOf(sim, heli);
    expect(sim.blocked[ty * 40 + tx]).toBe(0);
    expect(Math.max(Math.abs(tx - 10), Math.abs(ty - 10))).toBe(2);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 1);
    expect(aboard(sim, heli)).toBe(0);
  });

  it('a boulder field is foot-open: it comes down on it, not off it', () => {
    // The lead's rule is foot-open, not the vehicle LZ rule (lzFor): a rotor
    // that is falling does not get to choose.
    const { sim, heli } = loadedHeli(10.5, 10.5, 1);
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) sim.setBoulder(x, y, true);
    sim.state.mobilityKilled[heli] = 1;
    run(sim, AIR_LAND_TICKS + 1);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    expect(tileOf(sim, heli)).toEqual([10, 10]);
  });

  it('stays down while the kill stands: a move does not lift it', () => {
    const { sim, heli } = loadedHeli(10.5, 10.5, 1);
    sim.state.mobilityKilled[heli] = 1;
    run(sim, AIR_LAND_TICKS + 1);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
    sim.queueCommand({ kind: 'move', ids: [heli], x: at(30.5), y: at(10.5) });
    run(sim, AIR_LIFT_TICKS + 5);
    expect(sim.state.airState[heli]).toBe(AIR_LANDED);
  });
});

describe('a LANDING patroller (N3 Task 9 review)', () => {
  it('holds its patrol index through the descent rather than churning a refused leg every tick', () => {
    const { sim, helo } = world(true);
    sim.queueCommand({
      kind: 'setStance', ids: [helo], stance: 'patrol',
      waypoints: [[fx.from(15.5), fx.from(9.5)], [fx.from(15.5), fx.from(15.5)]],
    });
    sim.tick();
    expect(sim.isPatrolling(helo)).toBe(true);
    sim.state.airState[helo] = AIR_LANDING;
    sim.state.airTimer[helo] = AIR_LAND_TICKS;
    const at = sim.patrolIndexOf(helo);
    const idx = new Set<number>();
    for (let i = 0; i < 10 && sim.state.airState[helo] === AIR_LANDING; i++) {
      sim.tick();
      if (sim.state.airState[helo] === AIR_LANDING) idx.add(sim.patrolIndexOf(helo));
    }
    expect(idx.size).toBeGreaterThan(0);
    expect([...idx]).toEqual([at]);
  });
});
