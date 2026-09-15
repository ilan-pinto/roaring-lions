import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { MAX_LATERAL } from './formation';
import { MAX_FLOW_FIELDS, Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

// Minimal schema-shaped types for exercising the core. Combat stats are
// present but only movement/detection-agnostic behaviour is tested here.
const RIFLES: UnitTypeJson = {
  id: 'test_rifles',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2.0 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

const TANK: UnitTypeJson = {
  id: 'test_tank',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1.0, sight_tiles: 12, signature: 1.0 },
  weapons: [],
};

const DRONE: UnitTypeJson = {
  id: 'test_drone',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 3.0, domain: 'air' },
  sensors: { optics: 1.4, sight_tiles: 12, signature: 0.3 },
  weapons: [],
};

// RIFLES above declares no `role`, which defaults `wheeled` to true
// (DOMAIN_VEHICLE) -- harmless for the tests that use it alone, since on a
// boulder-free map fieldFor's vehicle-branch call collapses to the exact
// same cache key as the ground call and never allocates a second field. The
// mixed-order test below needs a unit that takes the plain default branch in
// the move handler (neither the air special-case nor the vehicle one), which
// that extra same-key call would otherwise mask, so this fixture pins
// DOMAIN_FOOT explicitly via `role`.
const INFANTRY: UnitTypeJson = {
  id: 'test_infantry_foot',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2.0 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

function makeSim(seed = 42, capacity = 64): Sim {
  return new Sim({ seed, width: 32, height: 32, capacity });
}

describe('sim construction and spawning', () => {
  it('spawns entities with stats converted to fixed point', () => {
    const sim = makeSim();
    const t = sim.addUnitType(TANK);
    const id = sim.spawn(t, 0, fx.fromInt(4), fx.fromInt(5));
    expect(id).toBe(0);
    expect(sim.state.alive[id]).toBe(1);
    expect(sim.state.posX[id]).toBe(fx.fromInt(4));
    expect(sim.state.posY[id]).toBe(fx.fromInt(5));
    expect(sim.state.hp[id]).toBe(fx.fromInt(3000));
    expect(sim.state.side[id]).toBe(0);
  });

  it('emits a spawn event', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    sim.spawn(t, 1, fx.fromInt(1), fx.fromInt(1));
    const events = sim.tick();
    expect(events.some((e) => e.kind === 'spawn' && e.entity === 0)).toBe(true);
  });

  it('advances the tick counter at a fixed rate, never wall time', () => {
    const sim = makeSim();
    expect(TICKS_PER_SECOND).toBe(20);
    expect(sim.tickCount).toBe(0);
    sim.tick();
    sim.tick();
    expect(sim.tickCount).toBe(2);
  });
});

describe('movement over flow fields', () => {
  it('moves a unit toward a move order at its speed', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    const id = sim.spawn(t, 0, fx.fromInt(2), fx.fromInt(2));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(20), y: fx.fromInt(2) });

    for (let i = 0; i < TICKS_PER_SECOND; i++) sim.tick(); // one second
    // 2 tiles/s straight east: expect roughly x=4 after 1s
    const x = fx.toNumber(sim.state.posX[id]);
    expect(x).toBeGreaterThan(3.5);
    expect(x).toBeLessThan(4.5);
    expect(fx.toNumber(sim.state.posY[id])).toBeCloseTo(2, 1);
  });

  it('arrives and stops at the destination', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    const id = sim.spawn(t, 0, fx.fromInt(2), fx.fromInt(2));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(6), y: fx.fromInt(2) });
    for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) sim.tick();
    expect(fx.toNumber(sim.state.posX[id])).toBeCloseTo(6, 0);
    const xBefore = sim.state.posX[id];
    sim.tick();
    expect(sim.state.posX[id]).toBe(xBefore); // parked
  });

  it('routes around blocked terrain instead of through it', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    // Wall across x=8 for y=0..27 — the only gap is the south end.
    for (let y = 0; y < 28; y++) sim.setBlocked(8, y, true);
    const id = sim.spawn(t, 0, fx.fromInt(4), fx.fromInt(4));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(14), y: fx.fromInt(4) });

    let crossedThroughWall = false;
    for (let i = 0; i < 40 * TICKS_PER_SECOND; i++) {
      sim.tick();
      const tx = fx.toInt(sim.state.posX[id]);
      const ty = fx.toInt(sim.state.posY[id]);
      if (tx === 8 && ty < 28) crossedThroughWall = true;
    }
    expect(crossedThroughWall).toBe(false);
    expect(fx.toNumber(sim.state.posX[id])).toBeCloseTo(14, 0);
    expect(fx.toNumber(sim.state.posY[id])).toBeCloseTo(4, 0);
  });

  it('faces the direction of travel', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    const id = sim.spawn(t, 0, fx.fromInt(2), fx.fromInt(2));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(2), y: fx.fromInt(20) });
    for (let i = 0; i < 5; i++) sim.tick();
    // Moving +y: facing should be a quarter turn.
    expect(Math.abs(fx.angleDiff(sim.state.facing[id], 16384))).toBeLessThan(2048);
  });
});

describe('command queue discipline (invariant 4: commands in, events out)', () => {
  it('applies commands at the start of the next tick, deterministically ordered', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    const id = sim.spawn(t, 0, fx.fromInt(2), fx.fromInt(2));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(10), y: fx.fromInt(2) });
    sim.queueCommand({ kind: 'halt', ids: [id] }); // later command wins
    sim.tick();
    const before = sim.state.posX[id];
    sim.tick();
    expect(sim.state.posX[id]).toBe(before);
  });
});

describe('entity-count independence (invariant 3 end to end)', () => {
  it('an extra idle unit elsewhere does not change another unit\'s path', () => {
    const run = (withExtra: boolean) => {
      const sim = makeSim(777);
      const t = sim.addUnitType(RIFLES);
      const id = sim.spawn(t, 0, fx.fromInt(2), fx.fromInt(2));
      if (withExtra) sim.spawn(t, 0, fx.fromInt(28), fx.fromInt(28));
      sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(20), y: fx.fromInt(18) });
      for (let i = 0; i < 100; i++) sim.tick();
      return [sim.state.posX[id], sim.state.posY[id], sim.state.facing[id]];
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe('state hash', () => {
  it('is identical for identical runs and different for different seeds', () => {
    const build = (seed: number) => {
      const sim = makeSim(seed);
      const t = sim.addUnitType(RIFLES);
      const a = sim.spawn(t, 0, fx.fromInt(2), fx.fromInt(2));
      sim.spawn(t, 1, fx.fromInt(30), fx.fromInt(30));
      sim.queueCommand({ kind: 'move', ids: [a], x: fx.fromInt(25), y: fx.fromInt(25) });
      for (let i = 0; i < 200; i++) sim.tick();
      return sim.hash();
    };
    expect(build(1)).toBe(build(1));
    expect(build(1)).not.toBe(build(2));
  });
});

describe('removeFromPlay (the narrative layer: an abduction, not a kill)', () => {
  it('flips alive to 0 and marks removed, without touching hp', () => {
    const sim = makeSim();
    const t = sim.addUnitType(TANK);
    const id = sim.spawn(t, 0, fx.fromInt(4), fx.fromInt(4));
    sim.tick(); // drain the spawn event
    const hpBefore = sim.state.hp[id];
    sim.removeFromPlay(id);
    expect(sim.state.alive[id]).toBe(0);
    expect(sim.state.removed[id]).toBe(1);
    expect(sim.state.hp[id]).toBe(hpBefore);
  });

  it('emits a "removed" event, never "destroyed"', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    const id = sim.spawn(t, 1, fx.fromInt(4), fx.fromInt(4));
    sim.tick();
    sim.removeFromPlay(id);
    const events = sim.tick();
    const removed = events.find((e): e is Extract<SimEvent, { kind: 'removed' }> => e.kind === 'removed');
    expect(removed).toBeDefined();
    expect(removed?.entity).toBe(id);
    expect(removed?.side).toBe(1);
    expect(events.some((e) => e.kind === 'destroyed')).toBe(false);
  });

  it('is a no-op on a unit already removed, or already dead', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    const removedTwice = sim.spawn(t, 0, fx.fromInt(2), fx.fromInt(2));
    const alreadyDead = sim.spawn(t, 0, fx.fromInt(6), fx.fromInt(6));
    sim.tick();
    sim.removeFromPlay(removedTwice);
    sim.debugKill(alreadyDead);
    sim.tick(); // drain the first removal and the kill
    sim.removeFromPlay(removedTwice); // already removed
    sim.removeFromPlay(alreadyDead); // already dead, never removed
    const events = sim.tick();
    expect(events).toEqual([]);
    expect(sim.state.removed[alreadyDead]).toBe(0); // destroy() never sets it
  });
});

describe('detection observer credit', () => {
  // The brief names these fixtures SQUAD/RUNNER; this file's own equivalents
  // are RIFLES and TANK (both weaponless here, so no firing-signature
  // multiplier confounds the timing) — same shape, same role: an armed-ish
  // spotter and a highly visible target.
  it('names the observer that identified a contact', () => {
    const sim = new Sim({ seed: 7, width: 24, height: 8, capacity: 8 });
    const rifles = sim.addUnitType(RIFLES);
    const tank = sim.addUnitType(TANK);
    const eye = sim.spawn(rifles, 0, fx.from(3.5), fx.from(4.5));
    sim.spawn(tank, 1, fx.from(7.5), fx.from(4.5));
    let observer = -2;
    for (let t = 0; t < 10 * TICKS_PER_SECOND && observer === -2; t++) {
      for (const e of sim.tick()) {
        if (e.kind === 'contact' && e.level === 'identified' && e.side === 0) observer = e.observer;
      }
    }
    expect(observer).toBe(eye);
  });
});

describe('flow-field cache', () => {
  it('never holds more than MAX_FLOW_FIELDS fields when goals are one-shot', () => {
    const sim = makeSim();
    const t = sim.addUnitType(RIFLES);
    const id = sim.spawn(t, 0, fx.fromInt(1), fx.fromInt(1));
    // Each order lands on a fresh tile; the unit never arrives, so the
    // previous goal's field is unreferenced the moment the next lands.
    for (let k = 0; k < MAX_FLOW_FIELDS + 40; k++) {
      const gx = 2 + (k % 28);
      const gy = 2 + Math.floor(k / 28);
      sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(gx), y: fx.fromInt(gy) });
      sim.tick();
    }
    expect(sim.flowFieldCount).toBeLessThanOrEqual(MAX_FLOW_FIELDS);
  });

  it('never reuses a field a living unit still follows', () => {
    const sim = makeSim(42, 256);
    const t = sim.addUnitType(RIFLES);
    const ids: number[] = [];
    for (let i = 0; i < MAX_FLOW_FIELDS + 8; i++) ids.push(sim.spawn(t, 0, fx.fromInt(1), fx.fromInt(1 + (i % 30))));
    // Every unit gets its own goal tile, so every field is referenced.
    for (let i = 0; i < ids.length; i++) {
      sim.queueCommand({ kind: 'move', ids: [ids[i]], x: fx.fromInt(2 + (i % 28)), y: fx.fromInt(2 + Math.floor(i / 28)) });
    }
    sim.tick();
    // The pool had to grow past the cap rather than steal a live field.
    expect(sim.flowFieldCount).toBe(ids.length);
    // And every unit actually ARRIVES at its own ordered tile, not merely
    // "is moving" -- this is what catches two fields swapped or one
    // overwritten with another's data, which a bare `moving === 1` check
    // cannot: a unit following the wrong field is still `moving`.
    for (let k = 0; k < 40 * TICKS_PER_SECOND; k++) sim.tick();
    for (let i = 0; i < ids.length; i++) {
      expect(fx.toInt(sim.state.posX[ids[i]])).toBe(2 + (i % 28));
      expect(fx.toInt(sim.state.posY[ids[i]])).toBe(2 + Math.floor(i / 28));
    }
  });

  it('never evicts a field issued earlier in the same tick', () => {
    // Reviewer scenario: in the move/attackMove handler, the ground field
    // (`fieldIdx`) is resolved once before the per-id loop and is only
    // stamped into a unit's `fieldRef` when the loop reaches a plain ground
    // id. If `cmd.ids` puts an air unit before the ground unit, the loop's
    // first iteration calls `fieldFor` again for `airField` -- and at that
    // moment `fieldIdx`'s slot is referenced by nobody yet, so a pool with
    // no other free slot could otherwise evict it out from under the very
    // order that just created it.
    const sim = makeSim(42, MAX_FLOW_FIELDS + 16);
    const ground = sim.addUnitType(INFANTRY);
    const air = sim.addUnitType(DRONE);
    const fillers: number[] = [];
    for (let i = 0; i < MAX_FLOW_FIELDS; i++) {
      fillers.push(sim.spawn(ground, 0, fx.fromInt(1), fx.fromInt(1 + (i % 30))));
    }
    // Every filler gets its own goal tile and never arrives this tick, so
    // every field in the pool is referenced -- nothing is free to evict.
    for (let i = 0; i < fillers.length; i++) {
      sim.queueCommand({
        kind: 'move',
        ids: [fillers[i]],
        x: fx.fromInt(2 + (i % 28)),
        y: fx.fromInt(2 + Math.floor(i / 28)),
      });
    }
    sim.tick();
    expect(sim.flowFieldCount).toBe(MAX_FLOW_FIELDS);

    // A destination genuinely blocked, so the ground snap and the air
    // unit's raw goal are two DIFFERENT tiles -- two distinct cache misses,
    // both resolved inside the SAME move command, at the SAME tick. Neither
    // (20, 20) nor its neighbours were ever a filler goal (filler goals
    // stay at y <= 6), so both are cache misses per fieldFor's existing-hit
    // path (a Map lookup by goal tile).
    sim.setBlocked(20, 20, true);
    const g = sim.spawn(ground, 0, fx.fromInt(1), fx.fromInt(1));
    const a = sim.spawn(air, 0, fx.fromInt(1), fx.fromInt(1));
    sim.queueCommand({ kind: 'move', ids: [a, g], x: fx.fromInt(20), y: fx.fromInt(20) });
    sim.tick();
    // Neither of this order's two new fields could evict the other, or any
    // still-live filler field: the pool had to grow by two.
    expect(sim.flowFieldCount).toBe(MAX_FLOW_FIELDS + 2);
    expect(sim.state.moving[g]).toBe(1);
    expect(sim.state.moving[a]).toBe(1);
  });
});

// RIFLES and TANK above declare no `role`, so both classify as VEHICLES
// (`wheeled` defaults to `!FOOT_ROLES.has(role ?? '')`). Formation splits the
// order by exactly that, so these two pin the split explicitly: `infantry` is
// in FOOT_ROLES and takes the rear ranks, `tank` is not and takes the front.
const F_INF: UnitTypeJson = { ...RIFLES, id: 'f_inf', role: 'infantry' };
const F_TANK: UnitTypeJson = { ...TANK, id: 'f_tank', role: 'tank' };
const tileOf = (sim: Sim, id: number): string =>
  `${fx.toInt(sim.state.posX[id])},${fx.toInt(sim.state.posY[id])}`;
function settle(sim: Sim, seconds: number): void {
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) sim.tick();
}

describe('formation on arrival', () => {
  it('spreads a group over distinct tiles with the vehicles on the clicked row', () => {
    const sim = makeSim(42, 64);
    const inf = sim.addUnitType(F_INF);
    const tank = sim.addUnitType(F_TANK);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push(sim.spawn(tank, 0, fx.fromInt(4 + i), fx.fromInt(28)));
    for (let i = 0; i < 6; i++) ids.push(sim.spawn(inf, 0, fx.fromInt(3 + i), fx.fromInt(29)));
    sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 40);
    const tiles = ids.map((id) => tileOf(sim, id));
    expect(new Set(tiles).size).toBe(ids.length);
    for (const id of ids) expect(sim.state.moving[id]).toBe(0);
    // Approaching from the south: the three tanks stand on row 12, the infantry below it.
    for (let i = 0; i < 3; i++) expect(fx.toInt(sim.state.posY[ids[i]])).toBe(12);
    for (let i = 3; i < 9; i++) expect(fx.toInt(sim.state.posY[ids[i]])).toBeGreaterThan(12);
  });

  it('sends a single unit beside an idle friend instead of onto it', () => {
    const sim = makeSim();
    const inf = sim.addUnitType(F_INF);
    const idle = sim.spawn(
      inf,
      0,
      fx.add(fx.fromInt(12), fx.fromInt(1) >> 1),
      fx.add(fx.fromInt(12), fx.fromInt(1) >> 1)
    );
    const mover = sim.spawn(inf, 0, fx.fromInt(4), fx.fromInt(12));
    sim.queueCommand({ kind: 'move', ids: [mover], x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 20);
    expect(tileOf(sim, idle)).toBe('12,12');
    expect(tileOf(sim, mover)).not.toBe('12,12');
    expect(sim.state.moving[mover]).toBe(0);
  });

  it("frees a dead unit's tile", () => {
    const sim = makeSim();
    const inf = sim.addUnitType(F_INF);
    const dead = sim.spawn(
      inf,
      0,
      fx.add(fx.fromInt(12), fx.fromInt(1) >> 1),
      fx.add(fx.fromInt(12), fx.fromInt(1) >> 1)
    );
    const mover = sim.spawn(inf, 0, fx.fromInt(4), fx.fromInt(12));
    sim.debugKill(dead);
    sim.tick();
    sim.queueCommand({ kind: 'move', ids: [mover], x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 20);
    expect(tileOf(sim, mover)).toBe('12,12');
  });

  it('releases a group\'s own tiles before re-assigning them to it', () => {
    // Spec §5's "re-ordering a group releases its old tiles first".
    // `reservedTilesFor` skips the ids of the order being applied
    // (`inOrder`); without that skip, every unit's current tile reads as
    // reserved AGAINST ITSELF, so a group told to hold the ground it is
    // already standing on is walked backwards a rank at a time — the
    // vehicles off the clicked row onto rank 2, the infantry out behind
    // them. With it, the second assignment is the first one again.
    const sim = makeSim(42, 64);
    const inf = sim.addUnitType(F_INF);
    const tank = sim.addUnitType(F_TANK);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push(sim.spawn(tank, 0, fx.fromInt(4 + i), fx.fromInt(28)));
    for (let i = 0; i < 11; i++) ids.push(sim.spawn(inf, 0, fx.fromInt(3 + i), fx.fromInt(29)));
    sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 40);
    const first = ids.map((id) => tileOf(sim, id));
    expect(new Set(first).size).toBe(ids.length);
    // Fourteen units is three ranks deep, so the settled group's own
    // centroid still quantises to the same approach axis as the spawn line
    // did — the second order re-derives the identical grid, and the only
    // thing that can move a unit off its tile is the reservation scan.
    sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 20);
    expect(ids.map((id) => tileOf(sim, id))).toEqual(first);
    // And every one of them is still inside the grid rather than out on the
    // overflow ring: within MAX_LATERAL of the clicked column, on the clicked
    // row or the two behind it.
    for (const t of first) {
      const [x, y] = t.split(',').map(Number);
      expect(x - 12 <= MAX_LATERAL && 12 - x <= MAX_LATERAL).toBe(true);
      expect(y).toBeGreaterThanOrEqual(12);
      expect(y).toBeLessThanOrEqual(14);
    }
  });

  it('keeps two groups ordered to one click on disjoint tiles', () => {
    const sim = makeSim(42, 64);
    const inf = sim.addUnitType(F_INF);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 5; i++) a.push(sim.spawn(inf, 0, fx.fromInt(2 + i), fx.fromInt(28)));
    for (let i = 0; i < 5; i++) b.push(sim.spawn(inf, 0, fx.fromInt(2 + i), fx.fromInt(2)));
    sim.queueCommand({ kind: 'move', ids: a, x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 2);
    sim.queueCommand({ kind: 'move', ids: b, x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 40);
    const tiles = [...a, ...b].map((id) => tileOf(sim, id));
    expect(new Set(tiles).size).toBe(10);
  });

  it('lets an `exact` order stack on one tile, and still reserves it', () => {
    // The sim's own shepherding orders opt out of being PLACED, not out of
    // being avoided. `CivilianFlight` sends every family to one refuge point
    // a rule already chose, with an evacuation zone drawn around it, so a
    // slot beside that point can sit outside the zone; an exact order keeps
    // the point as given for every unit in it. What it must NOT do is stop
    // reserving — a player order to the same tile still has to go beside it.
    const sim = makeSim();
    const inf = sim.addUnitType(F_INF);
    const a = sim.spawn(inf, 0, fx.fromInt(4), fx.fromInt(12));
    const b = sim.spawn(inf, 0, fx.fromInt(4), fx.fromInt(14));
    const c = sim.spawn(inf, 0, fx.fromInt(4), fx.fromInt(16));
    // A tick apart, so the second order sees the first already moving to the
    // tile it wants — the case an ordinary order is displaced by.
    sim.queueCommand({ kind: 'move', ids: [a], x: fx.fromInt(12), y: fx.fromInt(12), exact: true });
    sim.tick();
    sim.queueCommand({ kind: 'move', ids: [b], x: fx.fromInt(12), y: fx.fromInt(12), exact: true });
    sim.tick();
    sim.queueCommand({ kind: 'move', ids: [c], x: fx.fromInt(12), y: fx.fromInt(12) });
    settle(sim, 30);
    expect(tileOf(sim, a)).toBe('12,12');
    expect(tileOf(sim, b)).toBe('12,12');
    expect(tileOf(sim, c)).not.toBe('12,12');
    for (const id of [a, b, c]) expect(sim.state.moving[id]).toBe(0);
  });

  it('gives a queued waypoint its own slot per unit', () => {
    // Eight infantry, so the queued leg's grid is two ranks deep and the
    // second rank's row is an assertion rather than an inference.
    //
    // The two clicks are chosen so the approach axis FLIPS between them, and
    // that is what pins the `from` the appended leg is measured against.
    // Leg 1 runs east from the start line at x = 1..8 and lands its eight
    // slots on x = 26 (seven of them) and x = 25 (one), centroid (25, 15).
    // Leg 2's click (25, 21) is due SOUTH of that centroid — approach +y, a
    // rank running along x — but it is south-EAST of where the units are
    // still standing when the append is issued, which quantises to +x and a
    // rank running along y. So measuring `from` at the units instead of at
    // the end of the leg before rotates the whole formation a quarter turn
    // and this test goes red.
    const sim = makeSim(42, 64);
    const inf = sim.addUnitType(F_INF);
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) ids.push(sim.spawn(inf, 0, fx.fromInt(1 + i), fx.fromInt(15)));
    sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(26), y: fx.fromInt(15) });
    sim.tick();
    sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(25), y: fx.fromInt(21), append: true });
    settle(sim, 40);
    expect(new Set(ids.map((id) => tileOf(sim, id))).size).toBe(8);
    for (const id of ids) expect(sim.state.moving[id]).toBe(0);
    // Rank 0 is the clicked row, 2·MAX_LATERAL + 1 wide and centred on the
    // clicked column; rank 1 is the single row behind it, one unit at offset 0.
    const rank0 = ids.filter((id) => fx.toInt(sim.state.posY[id]) === 21);
    const rank1 = ids.filter((id) => fx.toInt(sim.state.posY[id]) === 20);
    expect(rank0).toHaveLength(2 * MAX_LATERAL + 1);
    expect(rank1).toHaveLength(1);
    expect(rank0.map((id) => fx.toInt(sim.state.posX[id])).sort((a, b) => a - b)).toEqual([
      22, 23, 24, 25, 26, 27, 28,
    ]);
    expect(fx.toInt(sim.state.posX[rank1[0]])).toBe(25);
  });
});
