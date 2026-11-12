import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import { AIR_AIRBORNE, AIR_LANDED, AIR_LANDING, AIR_LIFTING, AIR_WANT_NONE } from './tuning';

// GH-698 (PR 1275 review, finding 2): a carrier arriving to land re-checks its footprint physically
// (a carrier of EITHER side LANDING/LANDED/LIFTING within Chebyshev 2), re-snaps by the R2 search, or
// hovers with a `landRefused`. Fixtures as air-unload-at-point.test.ts's.

const RIFLES: UnitTypeJson = {
  id: 'ar_inf', name: 'Rifle Squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
const HELI: UnitTypeJson = {
  id: 'ar_heli', name: 'Yanshuf', role: 'apc',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
  weapons: [],
};

const at = (n: number): number => fx.from(n);
const tileOf = (sim: Sim, id: number): [number, number] => [fx.toInt(sim.state.posX[id]), fx.toInt(sim.state.posY[id])];

interface Pair { sim: Sim; a: number; b: number }

/** Two loaded helis (a: side 0, b: side `sideB`) at the given starts; both ordered to unload at (20.5, 20.5). */
function pair(aAt: [number, number], bAt: [number, number], sideB: number): Pair {
  const sim = new Sim({ seed: 0x6980_0699, width: 40, height: 40, capacity: 64 });
  const inf = sim.addUnitType(RIFLES);
  const heli = sim.addUnitType(HELI);
  const mk = (x: number, y: number, side: number): number => {
    const h = sim.spawn(heli, side, at(x), at(y));
    expect(sim.embarkAtSpawn(h, sim.spawn(inf, side, at(x), at(y)))).toBe(true);
    return h;
  };
  const a = mk(aAt[0], aAt[1], 0);
  const b = mk(bAt[0], bAt[1], sideB);
  sim.queueCommand({ kind: 'unload', ids: [a], x: at(20.5), y: at(20.5) });
  sim.queueCommand({ kind: 'unload', ids: [b], x: at(20.5), y: at(20.5) });
  return { sim, a, b };
}

function run(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

function apart(w: Pair): number {
  const [ax, ay] = tileOf(w.sim, w.a);
  const [bx, by] = tileOf(w.sim, w.b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

describe('a landing carrier re-checks its footprint on arrival (GH-698)', () => {
  for (const [name, aAt, bAt, first] of [
    ['a (side 0) arrives first', [18.5, 18.5], [34.5, 34.5], 'a'],
    ['b (side 1) arrives first', [34.5, 34.5], [18.5, 18.5], 'b'],
  ] as const) {
    it(`enemies, same point, ${name}: both end LANDED, footprints apart, the later one re-snapped`, () => {
      const w = pair([...aAt], [...bAt], 1);
      run(w.sim, 500);
      expect(w.sim.state.airState[w.a]).toBe(AIR_LANDED);
      expect(w.sim.state.airState[w.b]).toBe(AIR_LANDED);
      expect(apart(w)).toBeGreaterThanOrEqual(3);
      expect(tileOf(w.sim, first === 'a' ? w.a : w.b)).toEqual([20, 20]); // the earlier arrival keeps the point
    });

    it(`friends, same point, ${name}: order-time reservation already separates them; both land apart`, () => {
      const w = pair([...aAt], [...bAt], 0);
      run(w.sim, 500);
      expect(w.sim.state.airState[w.a]).toBe(AIR_LANDED);
      expect(w.sim.state.airState[w.b]).toBe(AIR_LANDED);
      expect(apart(w)).toBeGreaterThanOrEqual(3);
    });
  }

  it('same-tick arrival: the lower id keeps the point, the higher re-snaps, identically on every run', () => {
    const outcome = (): string => {
      const w = pair([18.5, 18.5], [22.5, 22.5], 1); // mirrored about (20.5, 20.5): the same distance
      run(w.sim, 500);
      expect(w.sim.state.airState[w.a]).toBe(AIR_LANDED);
      expect(w.sim.state.airState[w.b]).toBe(AIR_LANDED);
      expect(apart(w)).toBeGreaterThanOrEqual(3);
      expect(tileOf(w.sim, w.a)).toEqual([20, 20]);
      return `${tileOf(w.sim, w.a)}|${tileOf(w.sim, w.b)}|${w.sim.hash()}`;
    };
    expect(outcome()).toBe(outcome());
  });

  it('re-snap success: the later carrier lands on the nearest clear footprint, no refusal', () => {
    const w = pair([18.5, 18.5], [34.5, 34.5], 1);
    const ev = run(w.sim, 500);
    expect(ev.filter((e) => e.kind === 'landRefused')).toHaveLength(0);
    expect(tileOf(w.sim, w.b)).toEqual([17, 17]);
  });

  it('re-snap failure: nothing else clear within reach, the later carrier hovers, refused, riders kept', () => {
    const w = pair([18.5, 18.5], [34.5, 34.5], 1);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (Math.abs(x - 20) > 1 || Math.abs(y - 20) > 1) w.sim.setBlocked(x, y, true);
    const ev = run(w.sim, 500);
    expect(w.sim.state.airState[w.a]).toBe(AIR_LANDED);
    expect(w.sim.state.airState[w.b]).toBe(AIR_AIRBORNE);
    expect(w.sim.state.airWant[w.b]).toBe(AIR_WANT_NONE);
    expect(ev.filter((e) => e.kind === 'landRefused' && e.carrier === w.b)).toHaveLength(1);
    let aboard = 0;
    for (let i = 0; i < w.sim.entityCount; i++) if (w.sim.state.alive[i] === 1 && w.sim.state.carriedBy[i] === w.b) aboard++;
    expect(aboard).toBe(1);
  });

  it('a lone carrier is untouched: it lands on its point', () => {
    const sim = new Sim({ seed: 0x6980_0699, width: 40, height: 40, capacity: 64 });
    const inf = sim.addUnitType(RIFLES);
    const h = sim.spawn(sim.addUnitType(HELI), 0, at(18.5), at(18.5));
    sim.embarkAtSpawn(h, sim.spawn(inf, 0, at(18.5), at(18.5)));
    sim.queueCommand({ kind: 'unload', ids: [h], x: at(20.5), y: at(20.5) });
    run(sim, 300);
    expect(sim.state.airState[h]).toBe(AIR_LANDED);
    expect(tileOf(sim, h)).toEqual([20, 20]);
  });

  it('a FRIENDLY carrier still lifting off the point (want DEPART, no reservation) holds it physically', () => {
    const sim = new Sim({ seed: 0x6980_0699, width: 40, height: 40, capacity: 64 });
    const inf = sim.addUnitType(RIFLES);
    const heli = sim.addUnitType(HELI);
    const a = sim.spawn(heli, 0, at(20.5), at(20.5));
    sim.embarkAtSpawn(a, sim.spawn(inf, 0, at(20.5), at(20.5)));
    sim.queueCommand({ kind: 'unload', ids: [a], x: at(20.5), y: at(20.5) });
    run(sim, 200);
    expect(sim.state.airState[a]).toBe(AIR_LANDED);
    run(sim, 60); // the ground time owed after the unload runs out
    const b = sim.spawn(heli, 0, at(22.5), at(20.5));
    sim.embarkAtSpawn(b, sim.spawn(inf, 0, at(22.5), at(20.5)));
    sim.queueCommand({ kind: 'move', ids: [a], x: at(5.5), y: at(5.5) });
    run(sim, 1);
    expect(sim.state.airState[a]).toBe(AIR_LIFTING);
    sim.queueCommand({ kind: 'unload', ids: [b], x: at(20.5), y: at(20.5) });
    // b arrives while a still sits on the point (one tile of travel is under a second of lift).
    let bLandedWhileAHeld = false;
    let bSawHeld = false;
    for (let t = 0; t < 100; t++) {
      sim.tick();
      if (sim.state.airState[b] === AIR_LANDING && sim.state.airState[a] === AIR_LIFTING) bLandedWhileAHeld = true;
      if (sim.state.airState[a] === AIR_LIFTING && sim.state.posX[b] < at(20.5)) bSawHeld = true; // b flew on past the point: re-snapped
    }
    expect(bLandedWhileAHeld).toBe(false);
    expect(bSawHeld).toBe(true); // the guard met a live collision course, not an empty window
  });
});
