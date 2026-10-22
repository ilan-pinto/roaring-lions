// The breach probe's own checks (N2 prerequisites, P6). The probe is report-only;
// what must not pass quietly is the counter and the swap it reads through. Each
// test below is seen red under a one-line mutation of versus-breach.ts (B1-B3 in
// its header; the commit message says which was run).
import { describe, expect, it } from 'vitest';
import type { MapId } from '@lions/data';
import { VERSUS_FAIR_MAPS } from '@lions/net';
import {
  effectOf, emptyActivity, garrisonControl, pairingsOn, pinWindow, playCamps, signTestP, spawnCamps, sameGame, type CampGame,
} from './versus-breach';
import { play, seedOf, world } from './versus-probe';
import { versusAnchors } from '../../../packages/app/src/net/versus-seats';
import { versusSpawns } from '../../../packages/app/src/net/versus-force';

// CPU-bound sim runs, several full games a test; see versus-probe.test.ts.
const FULL_GAMES_TIMEOUT_MS = 30_000;

describe('the normal arm is the room', () => {
  it("reproduces the mirror pins' worlds (seed 20260727, 200 idle ticks), with no breach in them", () => {
    // LITERALS, from versus-force.test.ts and match-world.test.ts: the helper world
    // (no tunnels) and the room's world (buildMatchWorld) for each pin map.
    expect(pinWindow('beit_sahwan_outskirts', 'helper').hash).toBe(3296182002);
    expect(pinWindow('beit_sahwan_outskirts', 'room').hash).toBe(1108074073);
    // tel_marum re-pinned 2026-10-22 for its versus seat 0 at (24,46). Was 1260439781.
    expect(pinWindow('tel_marum', 'helper').hash).toBe(1524988923);
    expect(pinWindow('tel_marum', 'room').hash).toBe(1524988923);
    for (const map of ['beit_sahwan_outskirts', 'tel_marum'] as const) {
      for (const how of ['helper', 'room'] as const) expect(pinWindow(map, how).activity.ticks).toEqual([0, 0]);
    }
  });
  it('plays the versus probe\'s own game, camp A as side 0', { timeout: FULL_GAMES_TIMEOUT_MS }, () => {
    for (const n of [0, 2]) {
      const p = play('milh_flats', ['kdf', 'kdf'], seedOf(n));
      const c = playCamps('milh_flats', ['kdf', 'kdf'], seedOf(n), 'normal');
      expect({ winner: c.winnerCamp, by: c.by, ticks: c.ticks }).toEqual(p);
    }
  });
});

describe('the counter', () => {
  it('side 0 shelling a held building is not a breach; side 1 cutting walls on its way is (B1, B2)', { timeout: FULL_GAMES_TIMEOUT_MS }, () => {
    const g = garrisonControl();
    expect(g.ticks[0]).toBe(0); // B1: counting garrisonable structures too reads > 0 here
    expect(g.structureFire[0]).toBeGreaterThan(0); // the control engaged at all
    expect(g.ticks[1]).toBeGreaterThan(0); // B2: a counter that sees no breach reads 0 here
    expect(g.breachHp[1]).toBeGreaterThan(0);
  });
  it('in a game, side 0 reads 0 in both arms; side 1 breaches on milh_flats', { timeout: FULL_GAMES_TIMEOUT_MS }, () => {
    const games: CampGame[] = [];
    for (const n of [0, 2]) for (const arm of ['normal', 'swapped'] as const) games.push(playCamps('milh_flats', ['kdf', 'kdf'], seedOf(n), arm));
    for (const g of games) expect(g.activity.ticks[0]).toBe(0);
    expect(games.some((g) => g.activity.ticks[1] > 0)).toBe(true);
  });
});

describe('the room table', () => {
  it("N2: under the room's table ([true, true]) neither side breaches on milh_flats, in either arm", { timeout: FULL_GAMES_TIMEOUT_MS }, () => {
    for (const n of [0, 2]) for (const arm of ['normal', 'swapped'] as const) {
      const g = playCamps('milh_flats', ['kdf', 'kdf'], seedOf(n), arm, { humanHeld: [true, true] });
      expect(g.activity.ticks).toEqual([0, 0]);
    }
  });
});

describe('the swap', () => {
  it("normal arm IS the shipped versusSpawns, for every pairing the probe plays on every fair map", () => {
    let pairings = 0;
    for (const map of VERSUS_FAIR_MAPS as readonly MapId[]) {
      for (const fac of pairingsOn(map)) {
        pairings++;
        const shipped = world(map, seedOf(0));
        const bySide = versusSpawns(shipped.sim, shipped.typeOf, versusAnchors(shipped.map), fac).bySide;
        const mine = world(map, seedOf(0));
        const camps = spawnCamps(mine.sim, mine.typeOf, versusAnchors(mine.map), fac, 'normal');
        expect(camps).toEqual(bySide);
        expect(mine.sim.entityCount).toBe(shipped.sim.entityCount);
        const read = (sim: typeof mine.sim) => Array.from({ length: sim.entityCount }, (_, i) => [
          sim.unitTypes[sim.state.typeIdx[i]].id, sim.state.side[i], sim.state.posX[i], sim.state.posY[i], sim.state.facing[i],
        ]);
        expect(read(mine.sim)).toEqual(read(shipped.sim));
      }
    }
    expect(pairings).toBe(8); // 4 mirrors + 2 faction maps x 2 orders: the loop ran
  });
  it('moves only the side labels: same tiles, same ids, camp A first', () => {
    const tiles = (arm: 'normal' | 'swapped') => {
      const { sim, typeOf, map } = world('milh_flats', seedOf(0));
      const camps = spawnCamps(sim, typeOf, versusAnchors(map), ['kdf', 'sarim'], arm);
      return { camps, at: camps.flat().map((i) => [sim.state.posX[i], sim.state.posY[i], sim.state.facing[i]]), side: camps.map((c) => c.map((i) => sim.state.side[i])) };
    };
    const a = tiles('normal');
    const b = tiles('swapped');
    expect(b.camps).toEqual(a.camps);
    expect(b.at).toEqual(a.at);
    expect(a.side[0].every((s) => s === 0) && a.side[1].every((s) => s === 1)).toBe(true);
    expect(b.side[0].every((s) => s === 1) && b.side[1].every((s) => s === 0)).toBe(true);
  });
  it('a map with no wall reads the same game in both arms, camp for camp (B3)', { timeout: FULL_GAMES_TIMEOUT_MS }, () => {
    for (const n of [0, 1, 3]) {
      const nrm = playCamps('tel_marum', ['kdf', 'kdf'], seedOf(n), 'normal');
      const swp = playCamps('tel_marum', ['kdf', 'kdf'], seedOf(n), 'swapped');
      expect(sameGame(nrm, swp)).toBe(true);
    }
  });
});

describe('the sign test', () => {
  it('is the exact two-sided binomial at 1/2', () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(5, 10)).toBe(1);
    expect(signTestP(0, 5)).toBeCloseTo(2 / 32, 12);
    expect(signTestP(1, 10)).toBeCloseTo((2 * 11) / 1024, 12);
    expect(signTestP(9, 10)).toBeCloseTo((2 * 11) / 1024, 12);
    expect(signTestP(2, 20)).toBeCloseTo((2 * (1 + 20 + 190)) / 2 ** 20, 12);
  });

  it('stays a probability past n = 1023, where 2 ** n overflows a double', () => {
    for (const n of [1023, 1024, 1030, 3000]) {
      expect(signTestP(Math.floor(n / 2), n)).toBe(1);
      const lopsided = signTestP(Math.floor(n / 2) - 200, n);
      expect(Number.isFinite(lopsided)).toBe(true);
      expect(lopsided).toBeGreaterThanOrEqual(0);
      expect(lopsided).toBeLessThan(1e-6);
    }
    expect(signTestP(0, 1100)).toBe(0); // 2 * 2^-1100 underflows to 0, not NaN
  });
});

describe('effectOf', () => {
  // Hand-built pairs, literal expectations: the verdict's direction and the swap control.
  const cg = (winnerCamp: 0 | 1 | null, value: [number, number], ticks = 100, breach: [number, number] = [0, 0]): CampGame => {
    const activity = emptyActivity();
    activity.ticks = breach;
    return { winnerCamp, by: 'annihilation', ticks, value, activity };
  };
  it('counts better/worse, margin up/down, identical and unexplained', () => {
    const e = effectOf([
      // B wins carrying the rule, loses without it: better; margin 200 vs -200: up.
      [cg(1, [100, 300], 100, [0, 5]), cg(0, [300, 100])],
      // B loses carrying it, wins without: worse; margin -200 vs 200: down.
      [cg(0, [300, 100]), cg(1, [100, 300], 100, [0, 3])],
      // A draw carrying it against a loss without: better; margins level: neither.
      [cg(null, [200, 200], 100, [0, 1]), cg(0, [200, 200])],
      // The same game in both arms, nobody breached: identical, not unexplained.
      [cg(1, [100, 150]), cg(1, [100, 150])],
      // Different games, nobody breached in either arm: unexplained; margin 50 vs 20: up.
      [cg(1, [100, 150], 100), cg(1, [100, 120], 140)],
    ]);
    expect(e.n).toBe(5);
    expect(e.better).toBe(2);
    expect(e.worse).toBe(1);
    expect(e.marginUp).toBe(2);
    expect(e.marginDown).toBe(1);
    expect(e.identical).toBe(1);
    expect(e.unexplained).toBe(1);
    expect(e.bWinsNormal).toBe(3);
    expect(e.drawsNormal).toBe(1);
    expect(e.bWinsSwapped).toBe(3);
    expect(e.p).toBeCloseTo(1, 12); // 2 of 3
    expect(e.meanMarginNormal).toBeCloseTo((200 - 200 + 0 + 50 + 50) / 5, 9);
    expect(e.meanMarginSwapped).toBeCloseTo((-200 + 200 + 0 + 50 + 20) / 5, 9);
  });
});
