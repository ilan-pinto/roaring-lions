import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

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

function makeSim(seed = 42): Sim {
  return new Sim({ seed, width: 32, height: 32, capacity: 64 });
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
