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

/**
 * A move order aimed at a tile no unit can stand on.
 *
 * `FlowField.compute` bails to an all-`DIR_NONE` field the instant its goal
 * tile is blocked, and `stepMovement` reads a silent field as "just walk
 * straight there". The straight line is fine right up until it meets the
 * wall, at which point the wall-slide clamp parks the unit flush against the
 * first face on that line — and `move` is the one order whose completion is a
 * position test (`nx === goalX && ny === goalY`), so it never fires. The unit
 * sits there with `moving === 1` for the rest of the mission.
 *
 * It survived four maps because it needs a blocked tile to aim at: every map
 * before `tel_marum` is under 0.6% blocked and all of that is buildings, which
 * the cursor resolves to demolish/garrison rather than a plain move.
 * `tel_marum` is 32.7% blocked rock, so a misjudged long-range click lands on
 * it about one time in three.
 */
describe('a goal on blocked ground', () => {
  /**
   * A 32x24 field with a wall at x=12 gated at y=18..19, and a free-standing
   * rock block at x=20..23, y=8..11. The gate matters: seal the far side off
   * completely and the goal is unreachable rather than merely unstandable,
   * which is a different bug and not this one.
   */
  function walled(): { sim: Sim; inf: number } {
    const { sim, inf } = world(32, 24);
    for (let y = 0; y < 24; y++) {
      if (y === 18 || y === 19) continue;
      sim.setBlocked(12, y, true);
    }
    for (let y = 8; y < 12; y++) for (let x = 20; x < 24; x++) sim.setBlocked(x, y, true);
    return { sim, inf };
  }

  it('completes rather than pinning the unit against the wall forever', () => {
    const { sim, inf } = walled();
    const id = sim.spawn(inf, 0, fx.from(4.5), fx.from(2.5));
    // Dead centre of the rock block: reachable by no one.
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(21.5), y: fx.from(9.5) });
    run(sim, 90 * TICKS_PER_SECOND);
    const x = fx.toNumber(sim.state.posX[id]);
    const y = fx.toNumber(sim.state.posY[id]);
    expect(sim.state.moving[id], `stopped at (${x},${y})`).toBe(0);
    // Standing on ground, and on the near side of the block rather than
    // wherever the beeline happened to graze it.
    expect(sim.blocked[fx.toInt(sim.state.posY[id]) * 32 + fx.toInt(sim.state.posX[id])]).toBe(0);
    expect(Math.hypot(x - 21.5, y - 9.5)).toBeLessThan(3.5);
  });

  it('does not swallow the rest of the queued path', () => {
    const { sim, inf } = walled();
    const id = sim.spawn(inf, 0, fx.from(4.5), fx.from(2.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(21.5), y: fx.from(9.5) });
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(28.5), y: fx.from(20.5), append: true });
    run(sim, 120 * TICKS_PER_SECOND);
    expect(sim.waypointCount(id)).toBe(0);
    expect(fx.toNumber(sim.state.posX[id])).toBeCloseTo(28.5, 1);
    expect(fx.toNumber(sim.state.posY[id])).toBeCloseTo(20.5, 1);
  });

  it('holds even when the unit starts flush against the face it is sent into', () => {
    const { sim, inf } = walled();
    // Hard up against the west side of the x=12 wall, ordered into it.
    const id = sim.spawn(inf, 0, fx.from(11.9), fx.from(6.5));
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(12.5), y: fx.from(6.5) });
    run(sim, 60 * TICKS_PER_SECOND);
    expect(sim.state.moving[id]).toBe(0);
  });

  it('leaves an open goal exactly where it was clicked', () => {
    // The guard against over-reaching: only a blocked goal is rewritten, so a
    // fractional point on open ground is still walked to precisely.
    const { sim, inf } = walled();
    const id = sim.spawn(inf, 0, fx.from(4.5), fx.from(2.5));
    const gx = fx.from(8.125);
    const gy = fx.from(18.875);
    sim.queueCommand({ kind: 'move', ids: [id], x: gx, y: gy });
    run(sim, 60 * TICKS_PER_SECOND);
    expect(sim.state.moving[id]).toBe(0);
    expect(sim.state.posX[id]).toBe(gx);
    expect(sim.state.posY[id]).toBe(gy);
  });
});
