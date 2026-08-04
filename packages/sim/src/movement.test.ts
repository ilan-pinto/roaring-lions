import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';

const RIFLES: UnitTypeJson = {
  id: 'v_inf',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
};

function world(w = 24, h = 16): { sim: Sim; inf: number } {
  const sim = new Sim({ seed: 2, width: w, height: h, capacity: 16 });
  return { sim, inf: sim.addUnitType(RIFLES) };
}

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

describe('units stay on the map', () => {
  it('an order off the west or north edge does not walk them off it', () => {
    const { sim, inf } = world();
    const id = sim.spawn(inf, 0, fx.from(4.5), fx.from(4.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(-40), y: fx.from(-40) });
    run(sim, 40 * TICKS_PER_SECOND);
    expect(fx.toNumber(sim.state.posX[id])).toBeGreaterThanOrEqual(0);
    expect(fx.toNumber(sim.state.posY[id])).toBeGreaterThanOrEqual(0);
  });

  it('an order off the east or south edge does not walk them off it', () => {
    const { sim, inf } = world();
    const id = sim.spawn(inf, 0, fx.from(20.5), fx.from(12.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(500), y: fx.from(500) });
    run(sim, 60 * TICKS_PER_SECOND);
    expect(fx.toNumber(sim.state.posX[id])).toBeLessThanOrEqual(24);
    expect(fx.toNumber(sim.state.posY[id])).toBeLessThanOrEqual(16);
  });

  it('never ends a tick inside a wall', () => {
    const { sim, inf } = world(24, 16);
    for (let y = 0; y < 16; y++) sim.setBlocked(12, y, true);
    const id = sim.spawn(inf, 0, fx.from(4.5), fx.from(8.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(20.5), y: fx.from(8.5) });
    for (let t = 0; t < 60 * TICKS_PER_SECOND; t++) {
      sim.tick();
      const tx = fx.toInt(sim.state.posX[id]);
      const ty = fx.toInt(sim.state.posY[id]);
      expect(sim.blocked[ty * 24 + tx], `tick ${t} at (${tx},${ty})`).toBe(0);
    }
  });
});

describe('waypoints', () => {
  it('walks a queued path in order rather than straight to the last point', () => {
    const { sim, inf } = world(32, 24);
    const id = sim.spawn(inf, 0, fx.from(2.5), fx.from(2.5));
    // A dog-leg: south first, then east. A unit going straight to the final
    // point would never visit the corner.
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(2.5), y: fx.from(20.5) });
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(28.5), y: fx.from(20.5), append: true });

    let sawCorner = false;
    for (let t = 0; t < 90 * TICKS_PER_SECOND; t++) {
      sim.tick();
      const x = fx.toNumber(sim.state.posX[id]);
      const y = fx.toNumber(sim.state.posY[id]);
      if (Math.abs(x - 2.5) < 1.5 && Math.abs(y - 20.5) < 1.5) sawCorner = true;
      if (Math.abs(x - 28.5) < 1 && Math.abs(y - 20.5) < 1) break;
    }
    expect(sawCorner).toBe(true);
    expect(fx.toNumber(sim.state.posX[id])).toBeGreaterThan(27);
    expect(sim.waypointCount(id)).toBe(0);
  });

  it('a fresh order without append replaces the whole path', () => {
    const { sim, inf } = world(32, 24);
    const id = sim.spawn(inf, 0, fx.from(2.5), fx.from(2.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(2.5), y: fx.from(20.5) });
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(28.5), y: fx.from(20.5), append: true });
    run(sim, 10);
    expect(sim.waypointCount(id)).toBe(1);

    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(10.5), y: fx.from(2.5) });
    run(sim, 2);
    expect(sim.waypointCount(id)).toBe(0);
    run(sim, 40 * TICKS_PER_SECOND);
    expect(fx.toNumber(sim.state.posY[id])).toBeLessThan(5); // went north, not south
  });

  it('halting drops the rest of the path', () => {
    const { sim, inf } = world(32, 24);
    const id = sim.spawn(inf, 0, fx.from(2.5), fx.from(2.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(2.5), y: fx.from(20.5) });
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(28.5), y: fx.from(20.5), append: true });
    run(sim, 10);
    sim.queueCommand({ kind: 'halt', ids: [id] });
    run(sim, 5);
    expect(sim.waypointCount(id)).toBe(0);
    expect(sim.state.moving[id]).toBe(0);
  });

  it('exposes the queued path so the renderer can draw it', () => {
    const { sim, inf } = world(32, 24);
    const id = sim.spawn(inf, 0, fx.from(2.5), fx.from(2.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(2.5), y: fx.from(20.5) });
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(28.5), y: fx.from(20.5), append: true });
    run(sim, 5);
    expect(sim.waypointCount(id)).toBe(1);
    const [wx, wy] = sim.waypointAt(id, 0);
    expect(fx.toNumber(wx)).toBeCloseTo(28.5, 1);
    expect(fx.toNumber(wy)).toBeCloseTo(20.5, 1);
  });

  it('stays deterministic with paths queued', () => {
    const build = (): number => {
      const { sim, inf } = world(32, 24);
      const a = sim.spawn(inf, 0, fx.from(2.5), fx.from(2.5));
      const b = sim.spawn(inf, 0, fx.from(3.5), fx.from(2.5));
      sim.queueCommand({ kind: 'move', ids: [a, b], x: fx.from(2.5), y: fx.from(18.5) });
      sim.queueCommand({ kind: 'move', ids: [a, b], x: fx.from(26.5), y: fx.from(18.5), append: true });
      sim.queueCommand({ kind: 'move', ids: [a, b], x: fx.from(26.5), y: fx.from(4.5), append: true });
      run(sim, 900);
      return sim.hash();
    };
    expect(build()).toBe(build());
  });
});
