// GH-1112: the bell-tick re-snap. During the set-up an order whose goal lies across the line is held at the line with `moving` 1;
// the other side may fortify on that goal tile; after the bell the unit used to park against the piece for good. The bell tick
// now moves a blocked goal or queued waypoint to the nearest open tile (`applyMove`'s own rule) and writes nothing else.
// Regions are built here by integer maths (the sim package imports nothing). Every number is a literal.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { RIFLES } from './golden-worlds.test-helper';
import { Sim, type UnitTypeJson } from './sim';

const W = 32;
const UNTIL = 200;
const pos = (n: number): number => fx.from(n);
/** Side 0 owns x <= 15, the band is x 16..19, side 1 owns x >= 20. */
function vert(): Int8Array {
  const r = new Int8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) r[y * W + x] = x <= 15 ? 0 : x <= 19 ? -1 : 1;
  return r;
}
const HESCO = { id: 'k_hesco', name: 'HESCO', hp_per_tile: 600, garrison_slots: 0, rubble_cover: 2, low_profile: true, standing_cover: 3 };
const HELO: UnitTypeJson = {
  id: 'k_helo', role: 'apc',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' }, sensors: { optics: 1, sight_tiles: 10, signature: 1 }, weapons: [],
};

interface World { readonly sim: Sim; readonly rifles: number; readonly helo: number }
/** A set-up world with a hesco kit (6 pieces a side). */
function build(): World {
  const sim = new Sim({ seed: 1112, width: W, height: W, capacity: 64 });
  sim.beginSetup({ untilTick: UNTIL, region: vert() });
  const rifles = sim.addUnitType(RIFLES);
  const helo = sim.addUnitType(HELO);
  const hesco = sim.addStructureType(HESCO);
  sim.setSetupKit([{ structType: hesco, allowance: 6 }], []);
  return { sim, rifles, helo };
}
function run(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}
/** Read a unit's private arrays (a test may). */
interface Priv { moving: Uint8Array; goalX: Int32Array; goalY: Int32Array; wpX: Int32Array; wpY: Int32Array; wpCount: Uint8Array; posX: Int32Array; posY: Int32Array; blocked: Uint8Array }
const priv = (sim: Sim): Priv => sim as unknown as Priv;
const goalTile = (sim: Sim, id: number): [number, number] => [priv(sim).goalX[id] >> 16, priv(sim).goalY[id] >> 16];
const MAXWP = 8; // MAX_WAYPOINTS, read back below so a change of it fails loudly
const wpTile = (sim: Sim, id: number, k: number): [number, number] => [priv(sim).wpX[id * MAXWP + k] >> 16, priv(sim).wpY[id * MAXWP + k] >> 16];
const isBlocked = (sim: Sim, x: number, y: number): boolean => priv(sim).blocked[y * W + x] !== 0;

describe('MAX_WAYPOINTS as this file assumes it', () => {
  it('the waypoint array is MAXWP wide per unit', () => {
    const { sim, rifles } = build();
    const id = sim.spawn(rifles, 0, pos(4.5), pos(10.5));
    expect(priv(sim).wpX.length / 64).toBe(MAXWP);
    expect(id).toBe(0);
  });
});

describe('a goal under an enemy kit piece (GH-1112)', () => {
  it('the unit is held at the line, the other side fortifies its goal tile, and after the bell it arrives', () => {
    const { sim, rifles } = build();
    const u = sim.spawn(rifles, 0, pos(4.5), pos(10.5));
    sim.queueCommand({ kind: 'move', ids: [u], x: pos(24.5), y: pos(10.5) });
    run(sim, 100);
    expect(priv(sim).moving[u]).toBe(1); // held at the line: still walking
    expect(priv(sim).posX[u] >> 16).toBeLessThanOrEqual(15); // and not past it
    sim.queueCommand({ kind: 'fortify', side: 1, kit: 0, x: 24, y: 10 }); // the other side builds on the goal tile
    run(sim, 1);
    expect(isBlocked(sim, 24, 10)).toBe(true);
    expect(goalTile(sim, u)).toEqual([24, 10]); // the order still points at the piece before the bell
    run(sim, UNTIL - sim.tickCount); // to the tick before the bell (tickCount === UNTIL rings it)
    expect(sim.tickCount).toBe(UNTIL);
    run(sim, 1); // the bell tick
    const [gx, gy] = goalTile(sim, u);
    expect(isBlocked(sim, gx, gy)).toBe(false); // the goal now lies on open ground
    expect(Math.max(Math.abs(gx - 24), Math.abs(gy - 10))).toBe(1); // the nearest ring around the piece
    run(sim, 400);
    expect(priv(sim).moving[u]).toBe(0); // it arrived: it is not parked against the piece
    const px = priv(sim).posX[u] / 65536;
    const py = priv(sim).posY[u] / 65536;
    expect(Math.hypot(px - (gx + 0.5), py - (gy + 0.5))).toBeLessThan(0.75);
  });

  it('a queued waypoint under an enemy piece is re-snapped too, and the unit walks the whole route', () => {
    const { sim, rifles } = build();
    const u = sim.spawn(rifles, 0, pos(4.5), pos(10.5));
    sim.queueCommand({ kind: 'move', ids: [u], x: pos(22.5), y: pos(8.5) });
    run(sim, 2);
    sim.queueCommand({ kind: 'move', ids: [u], x: pos(26.5), y: pos(12.5), append: true });
    run(sim, 98);
    expect(priv(sim).wpCount[u]).toBe(1);
    expect(wpTile(sim, u, 0)).toEqual([26, 12]);
    sim.queueCommand({ kind: 'fortify', side: 1, kit: 0, x: 26, y: 12 });
    run(sim, UNTIL - sim.tickCount);
    expect(isBlocked(sim, 26, 12)).toBe(true);
    expect(wpTile(sim, u, 0)).toEqual([26, 12]); // before the bell: untouched
    run(sim, 1);
    const [wx, wy] = wpTile(sim, u, 0);
    expect(isBlocked(sim, wx, wy)).toBe(false);
    expect(Math.max(Math.abs(wx - 26), Math.abs(wy - 12))).toBe(1);
    const [gx, gy] = goalTile(sim, u);
    expect([gx, gy]).toEqual([22, 8]); // the first goal was open and is untouched
    run(sim, 600);
    expect(priv(sim).moving[u]).toBe(0); // goal and waypoint both reached
    expect(Math.hypot(priv(sim).posX[u] / 65536 - (wx + 0.5), priv(sim).posY[u] / 65536 - (wy + 0.5))).toBeLessThan(0.75);
  });

  it('an aircraft is left alone: it flies over the piece, so its goal is not moved', () => {
    const { sim, helo } = build();
    const a = sim.spawn(helo, 0, pos(4.5), pos(10.5));
    sim.queueCommand({ kind: 'move', ids: [a], x: pos(24.5), y: pos(10.5) });
    run(sim, 100);
    sim.queueCommand({ kind: 'fortify', side: 1, kit: 0, x: 24, y: 10 });
    run(sim, UNTIL - sim.tickCount);
    const before = [priv(sim).goalX[a], priv(sim).goalY[a]];
    run(sim, 1); // the bell tick
    expect([priv(sim).goalX[a], priv(sim).goalY[a]]).toEqual(before);
    expect(goalTile(sim, a)).toEqual([24, 10]);
  });
});

describe('a world with nothing blocked keeps its hash (GH-1112)', () => {
  /** The same world twice; in one the pass is stubbed to nothing. Hash at every tick across the bell. */
  function pair(fortify: boolean): [Sim, Sim] {
    const sims: Sim[] = [];
    for (let i = 0; i < 2; i++) {
      const { sim, rifles } = build();
      const u = sim.spawn(rifles, 0, pos(4.5), pos(10.5));
      const v = sim.spawn(rifles, 1, pos(28.5), pos(20.5));
      // fractional goals: a pass that rewrote an open goal to its tile centre would show in the hash
      sim.queueCommand({ kind: 'move', ids: [u], x: pos(24.3), y: pos(10.7) });
      sim.queueCommand({ kind: 'move', ids: [v], x: pos(5.2), y: pos(20.8) });
      sims.push(sim);
      if (fortify) sim.queueCommand({ kind: 'fortify', side: 1, kit: 0, x: 30, y: 30 }); // a piece nobody is going to
    }
    (sims[1] as unknown as { resnapBlockedGoals: () => void }).resnapBlockedGoals = (): void => {};
    return [sims[0], sims[1]];
  }
  for (const fortify of [false, true]) {
    it(`the hash equals the world without the pass at every tick (a piece placed: ${fortify})`, () => {
      const [a, b] = pair(fortify);
      for (let t = 0; t < UNTIL + 60; t++) {
        a.tick();
        b.tick();
        expect(a.hash(), `tick ${t + 1}`).toBe(b.hash());
      }
      expect(a.tickCount).toBe(UNTIL + 60);
      // and the pass was reachable: the bell did ring in these worlds
      expect(a.setupBellTick).toBe(UNTIL);
    });
  }
});
