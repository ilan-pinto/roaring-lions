// The breach probe's own checks (N2 prerequisites, P6). The probe is report-only;
// what must not pass quietly is the counter and the swap it reads through. Each
// test below is seen red under a one-line mutation of versus-breach.ts (B1-B3 in
// its header; the commit message says which was run).
import { describe, expect, it } from 'vitest';
import { garrisonControl, pinWindow, playCamps, signTestP, spawnCamps, sameGame, type CampGame } from './versus-breach';
import { play, seedOf, world } from './versus-probe';
import { sandboxAnchors } from '../../../packages/app/src/sandbox-anchors';

// CPU-bound sim runs, several full games a test; see versus-probe.test.ts.
const FULL_GAMES_TIMEOUT_MS = 30_000;

describe('the normal arm is the room', () => {
  it("reproduces the mirror pins' worlds (seed 20260727, 200 idle ticks), with no breach in them", () => {
    // LITERALS, from versus-force.test.ts and match-world.test.ts: the helper world
    // (no tunnels) and the room's world (buildMatchWorld) for each pin map.
    expect(pinWindow('beit_sahwan_outskirts', 'helper').hash).toBe(580559085);
    expect(pinWindow('beit_sahwan_outskirts', 'room').hash).toBe(3043363756);
    expect(pinWindow('tel_marum', 'helper').hash).toBe(1260439781);
    expect(pinWindow('tel_marum', 'room').hash).toBe(1260439781);
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

describe('the swap', () => {
  it('moves only the side labels: same tiles, same ids, camp A first', () => {
    const tiles = (arm: 'normal' | 'swapped') => {
      const { sim, typeOf, map } = world('milh_flats', seedOf(0));
      const camps = spawnCamps(sim, typeOf, sandboxAnchors(map), ['kdf', 'sarim'], arm);
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
});
