import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import { AIR_AIRBORNE, AIR_LANDED, AIR_LANDING, AIR_LIFTING, AIR_WANT_LOAD, AIR_WANT_NONE } from './tuning';

// GH-698 (PR 1275 review, finding 2): a carrier arriving to land re-checks its footprint physically
// (a carrier of EITHER side LANDING/LANDED/LIFTING within Chebyshev 2), re-snaps by the R2 search, or
// hovers with a `landRefused`. Fixtures as air-unload-at-point.test.ts's.

const RIFLES: UnitTypeJson = {
  id: 'ar_inf', name: 'Rifle Squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
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
  for (let i = 0; i < n; i++) {
    out.push(...sim.tick());
    noTwoOnOneFootprint(sim);
  }
  return out;
}

/** The invariant itself, every tick: no two carriers are both on the ground (LANDING, LANDED, LIFTING) within Chebyshev 2. */
function noTwoOnOneFootprint(sim: Sim): void {
  const g: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) {
    const st = sim.state.airState[i];
    if (sim.state.alive[i] === 1 && (st === AIR_LANDING || st === AIR_LANDED || st === AIR_LIFTING)) g.push(i);
  }
  for (let x = 0; x < g.length; x++) {
    for (let y = x + 1; y < g.length; y++) {
      const dx = Math.abs(fx.toInt(sim.state.posX[g[x]]) - fx.toInt(sim.state.posX[g[y]]));
      const dy = Math.abs(fx.toInt(sim.state.posY[g[x]]) - fx.toInt(sim.state.posY[g[y]]));
      if (Math.max(dx, dy) <= 2) throw new Error(`carriers ${g[x]} and ${g[y]} share a footprint at tick ${sim.tickCount}`);
    }
  }
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

  it('geometry swapped: the lower id still keeps the point when it comes from the far side', () => {
    const w = pair([22.5, 22.5], [18.5, 18.5], 1); // same distance, a (id lower) now from the other corner
    run(w.sim, 500);
    expect(tileOf(w.sim, w.a)).toEqual([20, 20]);
    expect(w.sim.state.airState[w.b]).toBe(AIR_LANDED);
    expect(apart(w)).toBeGreaterThanOrEqual(3);
  });

  it('the re-snapped flight follows the new LZ field: b is at a literal place at tick 130', () => {
    const w = pair([18.5, 18.5], [34.5, 34.5], 1);
    run(w.sim, 130);
    expect([w.sim.state.posX[w.b], w.sim.state.posY[w.b]]).toEqual(PIN_130);
  });

  // LOAD. a (side 1) lands on (21,22) first; b (side 0) is sent to load a squad standing there.
  // `walled`: everything is blocked but a pocket P (x 19..23, y 20..24, a's pad), a west field W
  // (x 12..16, y 18..26) and a one-tile corridor (x 14..18, y 22) between them, so b's re-snapped pad
  // (15,19) is out of the squad's sight line and only a routed walk reaches it.
  function loadWorld(walled: boolean): { sim: Sim; a: number; b: number; sq: number } {
    const sim = new Sim({ seed: 0x6980_0699, width: 40, height: 40, capacity: 64 });
    const inf = sim.addUnitType(RIFLES);
    const heli = sim.addUnitType(HELI);
    const a = sim.spawn(heli, 1, at(18.5), at(18.5));
    sim.embarkAtSpawn(a, sim.spawn(inf, 1, at(18.5), at(18.5)));
    const b = sim.spawn(heli, 0, at(34.5), at(34.5));
    const sq = sim.spawn(inf, 0, at(21.5), at(22.5));
    if (walled) {
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 40; x++) {
          const inP = x >= 19 && x <= 23 && y >= 20 && y <= 24;
          const inW = x >= 12 && x <= 16 && y >= 18 && y <= 26;
          const inC = x >= 14 && x <= 18 && y === 22;
          if (!inP && !inW && !inC) sim.setBlocked(x, y, true);
        }
      }
    }
    sim.queueCommand({ kind: 'unload', ids: [a], x: at(21.5), y: at(22.5) });
    sim.queueCommand({ kind: 'load', ids: [sq], carrier: b });
    return { sim, a, b, sq };
  }

  it('LOAD re-snap: b takes the next pad across a one-tile corridor and the squad is routed there and boards', () => {
    const w = loadWorld(true);
    run(w.sim, 1200);
    expect(tileOf(w.sim, w.a)).toEqual([21, 22]);
    expect(w.sim.state.airState[w.b]).toBe(AIR_LANDED);
    expect(tileOf(w.sim, w.b)).toEqual([15, 19]);
    expect(w.sim.state.carriedBy[w.sq]).toBe(w.b);
  });

  it('LOAD refusal: no second footprint, b hovers with landRefused and the squad is released on the ground', () => {
    const w = loadWorld(true);
    for (let y = 12; y <= 28; y++) for (let x = 10; x <= 17; x++) w.sim.setBlocked(x, y, true); // no second pad within reach
    const ev = run(w.sim, 800);
    expect(ev.filter((e) => e.kind === 'landRefused' && e.carrier === w.b)).toHaveLength(1);
    expect(w.sim.state.airWant[w.b]).not.toBe(AIR_WANT_LOAD);
    expect(w.sim.state.airState[w.b]).toBe(AIR_AIRBORNE);
    expect(w.sim.state.carriedBy[w.sq]).toBe(-1);
    expect(w.sim.state.moving[w.sq]).toBe(0);
  });

  it('load then garrison: the garrison order wins, the re-snap does not pull the rider off its walk to the house', () => {
    const w = loadWorld(false);
    const house = w.sim.addStructureType({ id: 'ar_house', name: 'House', hp_per_tile: 300, garrison_slots: 2, rubble_cover: 1 });
    const hs = w.sim.addStructure(house, [30 * 40 + 21, 30 * 40 + 22]);
    run(w.sim, 1);
    w.sim.queueCommand({ kind: 'garrison', ids: [w.sq], structure: hs });
    run(w.sim, 500);
    expect(w.sim.state.airState[w.b]).toBe(AIR_LANDED); // b did arrive, and re-snapped off a's pad
    expect(w.sim.state.garrisonedIn[w.sq]).toBe(hs);
    expect(w.sim.state.carriedBy[w.sq]).toBe(-1);
  });

  it('two carriers with riders walking to them: only the one that re-snaps re-points its own riders', () => {
    const w = loadWorld(false);
    const inf2 = w.sim.addUnitType({ ...RIFLES, id: 'ar_inf2' });
    const c = w.sim.spawn(w.sim.addUnitType({ ...HELI, id: 'ar_heli2' }), 0, at(38.5), at(5.5));
    const sq2 = w.sim.spawn(inf2, 0, at(5.5), at(5.5));
    w.sim.queueCommand({ kind: 'load', ids: [sq2], carrier: c });
    run(w.sim, 1200);
    expect(w.sim.state.carriedBy[w.sq]).toBe(w.b); // b re-snapped
    expect(w.sim.state.carriedBy[sq2]).toBe(c); // c did not, and its rider kept its own pad
  });

  it('a lone carrier lands at a literal tick with a literal hash', () => {
    const sim = new Sim({ seed: 0x6980_0699, width: 40, height: 40, capacity: 64 });
    const inf = sim.addUnitType(RIFLES);
    const h = sim.spawn(sim.addUnitType(HELI), 0, at(18.5), at(18.5));
    sim.embarkAtSpawn(h, sim.spawn(inf, 0, at(18.5), at(18.5)));
    sim.queueCommand({ kind: 'unload', ids: [h], x: at(20.5), y: at(20.5) });
    run(sim, 300);
    expect(sim.hash()).toBe(LONE_HASH);
  });
});

const PIN_130: number[] = [1298998, 1298998];
const LONE_HASH = 2148117001;
