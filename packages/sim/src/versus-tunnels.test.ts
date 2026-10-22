/**
 * GH-681: the Sarim seat's tunnel orders (spec 2026-10-22-versus-tunnels-design.md
 * §2-§3), through the real tick: `enterTunnel` walks to the nearer route end and
 * goes below, a mouth entry crawls to the vent at `TUNNEL_TILES_PER_S`, nothing
 * on a human-held side surfaces by itself, and `vent` brings arrived units up
 * as a `raid` or for good (`exit`).
 */
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { SURFACE_SECONDS, TUNNEL_CAPACITY_DEFAULT } from './tunnels';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

const RIFLE: UnitTypeJson = {
  id: 'vt_rifle',
  // A foot role: with none, `wheeled` defaults to true (`!FOOT_ROLES.has(role)`).
  role: 'infantry',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'vt_rifle_w',
      type: 'small_arms',
      range_tiles: 8,
      effective_range_tiles: 6.4,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      rof_per_min: 300,
    },
  ],
};
const TRUCK: UnitTypeJson = { ...RIFLE, id: 'vt_truck', mobility: { speed_tiles_s: 0.9, wheeled: true } };

/** Mouth (4,6), vent (14,6): 10 tiles, 400 ticks at 0.5 tiles/s. */
const POINTS = [[4, 6], [14, 6]] as const;
const TRAVEL = 400;

interface Opts {
  side?: number;
  capacity?: number;
  humanHeld?: readonly [boolean, boolean];
  target?: boolean;
  sarim?: number;
}

function world(o: Opts = {}) {
  const sim = new Sim({ seed: 5, width: 30, height: 12, capacity: 16, humanHeld: o.humanHeld ?? [true, true] });
  const route = sim.addTunnel({
    id: 'vt',
    points: POINTS,
    dig_tiles_per_s: 1,
    pre_dug: true,
    ...(o.side === undefined ? { side: 1 } : o.side < 0 ? {} : { side: o.side }),
    ...(o.capacity === undefined ? {} : { capacity: o.capacity }),
  });
  const rifle = sim.addUnitType(RIFLE);
  const truck = sim.addUnitType(TRUCK);
  const sarim: number[] = [];
  for (let k = 0; k < (o.sarim ?? 1); k++) sarim.push(sim.spawn(rifle, 1, fx.from(2.5), fx.from(5.5 + k)));
  // A KDF rifleman six tiles past the vent: in range and in sight of it.
  const kdf = o.target === false ? -1 : sim.spawn(rifle, 0, fx.from(20.5), fx.from(6.5));
  const events: SimEvent[] = [];
  const run = (n: number): void => {
    for (let t = 0; t < n; t++) events.push(...sim.tick());
  };
  return { sim, route, rifle, truck, sarim, kdf, events, run };
}

/** Order the units in, then tick until all are below (bounded). */
function goBelow(w: ReturnType<typeof world>, ids: number[]): void {
  w.sim.queueCommand({ kind: 'enterTunnel', ids, tunnel: w.route });
  for (let t = 0; t < 200 && ids.some((id) => w.sim.state.tunnelIn[id] < 0); t++) w.run(1);
}

describe('enterTunnel (GH-681)', () => {
  it('walks to the mouth, goes below, and crawls to the vent at the route speed', () => {
    const w = world();
    const [u] = w.sarim;
    goBelow(w, [u]);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
    expect(w.sim.tunnelTravelTicks(w.route)).toBe(TRAVEL);
    expect(w.sim.state.tunnelEta[u]).toBe(TRAVEL);
    w.run(TRAVEL - 1);
    expect(w.sim.state.tunnelEta[u]).toBe(1);
    w.run(1);
    expect(w.sim.state.tunnelEta[u]).toBe(0);
  });

  it('a human-held side never surfaces by itself, target or not', () => {
    const w = world();
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL + 400);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
    expect(w.events.some((e) => e.kind === 'surfaced')).toBe(false);
  });

  it('control: the same unit on a side nobody holds surfaces on its own once at the vent', () => {
    const w = world({ humanHeld: [true, false] });
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL + 40);
    expect(w.events.some((e) => e.kind === 'surfaced' && e.entity === u)).toBe(true);
  });

  it('refuses a wheeled unit, the other side, an unowned route, and a route at capacity', () => {
    // Wheeled.
    {
      const w = world();
      const t = w.sim.spawn(w.truck, 1, fx.from(2.5), fx.from(8.5));
      w.sim.queueCommand({ kind: 'enterTunnel', ids: [t], tunnel: w.route });
      w.run(200);
      expect(w.sim.state.tunnelIn[t]).toBe(-1);
    }
    // The other side's unit.
    {
      const w = world();
      const k = w.sim.spawn(w.rifle, 0, fx.from(2.5), fx.from(8.5));
      w.sim.queueCommand({ kind: 'enterTunnel', ids: [k], tunnel: w.route });
      w.run(200);
      expect(w.sim.state.tunnelIn[k]).toBe(-1);
    }
    // A map-file route: no owner, nobody enters by order.
    {
      const w = world({ side: -1 });
      w.sim.queueCommand({ kind: 'enterTunnel', ids: w.sarim, tunnel: w.route });
      w.run(200);
      expect(w.sim.state.tunnelIn[w.sarim[0]]).toBe(-1);
    }
    // Capacity 1: the second stops at the mouth, on the surface.
    {
      const w = world({ capacity: 1, sarim: 2 });
      w.sim.queueCommand({ kind: 'enterTunnel', ids: w.sarim, tunnel: w.route });
      w.run(200);
      const below = w.sarim.filter((id) => w.sim.state.tunnelIn[id] >= 0);
      expect(below).toHaveLength(1);
      expect(w.sim.state.moving[w.sarim.find((id) => !below.includes(id)) ?? -1]).toBe(0);
    }
  });

  it('defaults capacity to TUNNEL_CAPACITY_DEFAULT', () => {
    const w = world();
    expect(w.sim.tunnelCapacity(w.route)).toBe(TUNNEL_CAPACITY_DEFAULT);
    expect(w.sim.tunnelOwner(w.route)).toBe(1);
    expect(world({ side: -1 }).sim.tunnelOwner(0)).toBe(-1);
  });

  it('a later order cancels the walk', () => {
    const w = world();
    const [u] = w.sarim;
    w.sim.queueCommand({ kind: 'enterTunnel', ids: [u], tunnel: w.route });
    w.run(5);
    w.sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(2.5), y: fx.from(10.5) });
    w.run(200);
    expect(w.sim.state.tunnelIn[u]).toBe(-1);
  });

  it('a malformed owner or capacity is refused at load', () => {
    const sim = new Sim({ seed: 1, width: 20, height: 12, capacity: 4 });
    expect(() => sim.addTunnel({ id: 'a', points: POINTS, dig_tiles_per_s: 1, side: 2 })).toThrow(/side/);
    expect(() => sim.addTunnel({ id: 'b', points: POINTS, dig_tiles_per_s: 1, capacity: 0 })).toThrow(/capacity/);
  });
});

describe('vent (GH-681)', () => {
  it('is refused while the unit is still crawling', () => {
    const w = world();
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'raid' });
    w.run(1);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
  });

  it('raid with a target: comes up at the vent, fires its volley, and goes back down', () => {
    const w = world();
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'raid' });
    w.run(1);
    expect(w.sim.state.tunnelIn[u]).toBe(-1);
    expect(fx.toNumber(w.sim.state.posX[u])).toBeCloseTo(14.5, 3);
    w.run(SURFACE_SECONDS * TICKS_PER_SECOND + 200);
    expect(w.events.some((e) => e.kind === 'fire' && e.shooter === u)).toBe(true);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
  });

  it('raid with no target: comes up anyway, and goes back down on the tick the window ends', () => {
    const w = world({ target: false });
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'raid' });
    // The vent tick spends the window's first tick (applyCommands, then stepSurfacing).
    w.run(SURFACE_SECONDS * TICKS_PER_SECOND - 1);
    expect(w.sim.state.tunnelIn[u]).toBe(-1);
    w.run(1);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
  });

  it('an unarmed unit raids too, and goes back down with its window', () => {
    const w = world();
    const scout = w.sim.spawn(w.sim.addUnitType({ ...RIFLE, id: 'vt_scout', weapons: [] }), 1, fx.from(2.5), fx.from(8.5));
    goBelow(w, [scout]);
    w.run(TRAVEL);
    w.sim.queueCommand({ kind: 'vent', ids: [scout], mode: 'raid' });
    w.run(1);
    expect(w.sim.state.tunnelIn[scout]).toBe(-1);
    w.run(SURFACE_SECONDS * TICKS_PER_SECOND);
    expect(w.sim.state.tunnelIn[scout]).toBe(w.route);
  });

  it('a raid whose target has gone does not hold the unit up for good', () => {
    const w = world();
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'raid' });
    w.run(1);
    w.sim.debugKill(w.kdf);
    w.run(SURFACE_SECONDS * TICKS_PER_SECOND + 1);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
  });

  it('exit: comes up for good', () => {
    const w = world({ target: false });
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'exit' });
    w.run(400);
    expect(w.sim.state.tunnelIn[u]).toBe(-1);
    expect(w.events.some((e) => e.kind === 'submerged')).toBe(false);
  });

  it('an order to a raiding unit ends the raid where it stands, rather than taking it back below', () => {
    const w = world({ target: false });
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'raid' });
    w.run(1);
    w.sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(14.5), y: fx.from(10.5) });
    w.run(300);
    expect(w.sim.state.tunnelIn[u]).toBe(-1);
    expect(fx.toNumber(w.sim.state.posY[u])).toBeGreaterThan(9);
    expect(w.events.some((e) => e.kind === 'submerged')).toBe(false);
  });

  it('exit sent to a raider already up keeps it up for good', () => {
    const w = world({ target: false });
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'raid' });
    w.run(1);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'exit' });
    w.run(300);
    expect(w.sim.state.tunnelIn[u]).toBe(-1);
    expect(w.events.some((e) => e.kind === 'submerged')).toBe(false);
  });

  it('a wounded man takes no vent order (GH-707: vent skips the containment filter)', () => {
    const w = world({ target: false });
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL);
    (w.sim.state.woundState as Uint8Array)[u] = 1; // WOUND_DOWN, written directly: no wound content here
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'exit' });
    w.run(1);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
  });

  it('a side nobody holds is never vented by order', () => {
    const w = world({ humanHeld: [true, false], target: false });
    const [u] = w.sarim;
    w.sim.putInTunnel(u, w.route);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'exit' });
    w.run(5);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
  });

  it('re-entry at the vent after an exit goes straight to ground, with no crawl', () => {
    const w = world({ target: false });
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL);
    w.sim.queueCommand({ kind: 'vent', ids: [u], mode: 'exit' });
    w.run(1);
    goBelow(w, [u]);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
    expect(w.sim.state.tunnelEta[u]).toBe(0);
  });

  it('every other order still leaves a buried unit where it is (containment)', () => {
    const w = world();
    const [u] = w.sarim;
    goBelow(w, [u]);
    w.run(TRAVEL);
    w.sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(2.5), y: fx.from(2.5) });
    w.sim.queueCommand({ kind: 'halt', ids: [u] });
    w.run(100);
    expect(w.sim.state.tunnelIn[u]).toBe(w.route);
  });
});

describe('the hash (GH-681, Q8)', () => {
  it('does not fold the tunnel order columns until a tunnel order is accepted', () => {
    const a = world();
    const b = world();
    a.run(10);
    b.run(10);
    (b.sim.state.tunnelEta as Int32Array)[b.sarim[0]] = 7;
    expect(b.sim.hash()).toBe(a.sim.hash());
  });

  it('folds them once one has been', () => {
    const a = world();
    const b = world();
    for (const w of [a, b]) w.sim.queueCommand({ kind: 'enterTunnel', ids: w.sarim, tunnel: w.route });
    a.run(10);
    b.run(10);
    expect(b.sim.hash()).toBe(a.sim.hash());
    (b.sim.state.tunnelEta as Int32Array)[b.kdf] = 7;
    expect(b.sim.hash()).not.toBe(a.sim.hash());
  });

  it('two identical tunnel games hash equal at every tick', () => {
    const a = world();
    const b = world();
    for (const w of [a, b]) w.sim.queueCommand({ kind: 'enterTunnel', ids: w.sarim, tunnel: w.route });
    for (let t = 0; t < TRAVEL + 120; t++) {
      if (t === TRAVEL + 60) for (const w of [a, b]) w.sim.queueCommand({ kind: 'vent', ids: w.sarim, mode: 'raid' });
      a.run(1);
      b.run(1);
      expect(b.sim.hash()).toBe(a.sim.hash());
    }
  });
});
