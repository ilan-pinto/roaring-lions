// The versus probe's win-mode arm (GH-976 P1): the instrument has to tell its sides apart, play both ends the same
// way, and read its own bars the way the header says. Each test is seen red under a one-line mutation of
// versus-modes.ts; the commit message lists them.
import { describe, expect, it, vi } from 'vitest';
import type { MapId } from '@lions/data';
import { buildMatchWorld, matchTick } from '../../../packages/app/src/net/match-world';
import {
  GOAL_SHARE_MIN_PERCENT, POINTS_SPLIT, parseZones, withPointsOverride, campOrder, describeTally, fairWithin, goalShareOk, modeConfig, modeMain, modeSelfCheck, passiveLost, playMode, pointsOrder, tallyModes,
  type ModePlayFn, type ModePlayed,
} from './versus-modes';
import { main as probeMain, seedOf } from './versus-probe';
import { versusModes } from '@lions/data';

const FULL_GAMES_TIMEOUT_MS = 90_000;
const game = (winner: 0 | 1 | null, by: ModePlayed['by'] = 'objective', ticks = 1200): ModePlayed => ({ winner, by, ticks });
const games = (west: number, east: number, by: ModePlayed['by'] = 'objective'): ModePlayed[] => [
  ...Array.from({ length: west }, () => game(0, by)),
  ...Array.from({ length: east }, () => game(1, by)),
];

describe('the readings', () => {
  it('fair is the leader\'s share of ALL the seeds against 60/40, in integers: 57 of 96 within, 58 of 96 over', () => {
    expect(fairWithin(tallyModes(games(57, 39)))).toBe(true);
    expect(fairWithin(tallyModes(games(58, 38)))).toBe(false);
    // The bar itself is in: 60 of 100 is 60%, within; 61 of 100 is over.
    expect(fairWithin(tallyModes(games(60, 40)))).toBe(true);
    expect(fairWithin(tallyModes(games(61, 39)))).toBe(false);
    expect(fairWithin(tallyModes(games(38, 58)))).toBe(false);
    // A draw is nobody's: 57 + 0 + 39 draws is still 57 of 96.
    expect(fairWithin(tallyModes([...games(57, 0), ...Array.from({ length: 39 }, () => game(null, 'cap'))]))).toBe(true);
  });

  it('the goal share is games decided by the goal against 70%: 68 of 96 (70.8%) ok, 67 of 96 (69.8%) low', () => {
    expect(GOAL_SHARE_MIN_PERCENT).toBe(70);
    const t = (goal: number): ModePlayed[] => [...games(goal, 0, 'objective'), ...games(0, 96 - goal, 'annihilation')];
    // The bar itself is in: 70 of 100 is 70%, ok; 69 of 100 is low.
    const of100 = (goal: number): ModePlayed[] => [...games(goal, 0, 'objective'), ...games(0, 100 - goal, 'annihilation')];
    expect(goalShareOk(tallyModes(of100(70)))).toBe(true);
    expect(goalShareOk(tallyModes(of100(69)))).toBe(false);
    expect(goalShareOk(tallyModes(t(68)))).toBe(true);
    expect(goalShareOk(tallyModes(t(67)))).toBe(false);
    expect(tallyModes(t(67)).goal).toBe(67);
  });

  it('the passive seat lost only when the other end won EVERY game: one passive win, one cap and one draw each fail it', () => {
    expect(passiveLost(tallyModes(games(0, 96)), 0)).toBe(true);
    expect(passiveLost(tallyModes(games(96, 0)), 1)).toBe(true);
    expect(passiveLost(tallyModes(games(1, 95)), 0)).toBe(false);
    expect(passiveLost(tallyModes([...games(0, 95), game(null, 'cap')]), 0)).toBe(false);
    expect(passiveLost(tallyModes([...games(0, 95), game(1, 'cap')]), 0)).toBe(true); // lost ON the cap's forces is still lost; the cap is in the by-counts
    expect(passiveLost(tallyModes(games(0, 96)), 1)).toBe(false); // the wrong end: east passive, west won none
  });

  it('describes every way a game ended', () => {
    expect(describeTally(tallyModes([game(0, 'objective', 2000), game(1, 'annihilation', 4000), game(null, 'cap', 6000), game(0, 'stalemate', 0), game(null, 'mutual', 0)])))
      .toBe('west 2 / east 1 / draw 2  by goal 1, wipe 1, mutual 1, stalemate 1, cap 1  mean 120 s');
  });
});

describe('playMode: a room\'s own world', () => {
  it('a cut end loses to the other by annihilation or the goal on each map, each mode and each end: the sides are told apart', () => {
    for (const map of ['wadi_tarfan', 'milh_flats'] as MapId[]) {
      for (const mode of ['camp', 'points'] as const) {
        expect(playMode(map, mode, seedOf(0), { cutEnd: 1 }), `${map} ${mode} east cut`).toMatchObject({ winner: 0 });
        expect(playMode(map, mode, seedOf(0), { cutEnd: 0 }), `${map} ${mode} west cut`).toMatchObject({ winner: 1 });
      }
    }
  }, FULL_GAMES_TIMEOUT_MS);

  it('a passive end that stays home loses a points race by the goal, each end, and the loser scored its few points', () => {
    const east = playMode('milh_flats', 'points', seedOf(0), { passive: 1 });
    expect(east).toMatchObject({ winner: 0, by: 'objective' });
    expect(east.points![0]).toBe(600);
    expect(east.points![1]).toBeLessThan(600);
    expect(playMode('milh_flats', 'points', seedOf(0), { passive: 0 })).toMatchObject({ winner: 1, by: 'objective' });
  }, FULL_GAMES_TIMEOUT_MS);

  it('a camp raze decides by the goal when the other end stays home and wipes nobody', () => {
    expect(playMode('wadi_tarfan', 'camp', seedOf(0), { passive: 0 })).toMatchObject({ winner: 1, by: 'objective' });
  }, FULL_GAMES_TIMEOUT_MS);

  it('--wipe=off is an experiment: with an end cut to one unit the game does NOT end on the wipe, only on the goal', () => {
    const g = playMode('wadi_tarfan', 'camp', seedOf(0), { cutEnd: 1, wipeEnds: false });
    expect(g).toMatchObject({ winner: 0, by: 'objective' });
  }, FULL_GAMES_TIMEOUT_MS);

  it('one seed is one game, run to run', () => {
    const a = playMode('wadi_tarfan', 'points', seedOf(3));
    expect(playMode('wadi_tarfan', 'points', seedOf(3))).toEqual(a);
  }, FULL_GAMES_TIMEOUT_MS);

  it('the room config carries the mode and nothing else changes', () => {
    const c = modeConfig('wadi_tarfan' as MapId, 'camp', seedOf(0));
    expect(c.winMode).toBe('camp');
    expect(c.seats.map((s) => s.faction)).toEqual(['kdf', 'kdf']);
  });
});

describe('both ends play the mode the same way (a half turn about the map centre carries one end\'s orders onto the other\'s)', () => {
  const orders = (map: MapId, mode: 'camp' | 'points'): Map<number, [number, number][]> => {
    const w = buildMatchWorld(modeConfig(map, mode, seedOf(0)));
    const spy = vi.spyOn(w.sim, 'queueCommand');
    if (mode === 'camp') campOrder(w, map, -1);
    else pointsOrder(w, versusModes[map].modes.points!.zones.map((z) => z.zone), -1);
    const bySide = new Map<number, [number, number][]>();
    for (const [cmd] of spy.mock.calls) {
      if (cmd.kind !== 'attackMove') continue;
      const side = w.sim.state.side[cmd.ids[0]];
      bySide.set(side, [...(bySide.get(side) ?? []), [cmd.x, cmd.y]]);
    }
    return bySide;
  };

  it.each([['wadi_tarfan', 'points'], ['milh_flats', 'points']] as const)('%s %s: side 0 and side 1 send the same number of groups to image zones', (map, mode) => {
    const o = orders(map, mode);
    const width = 48 * 65536;
    // Three unheld zones at the start: each end splits over three, a literal and not POINTS_SPLIT read back.
    expect(POINTS_SPLIT).toBe(3);
    expect(o.get(0)!.length).toBe(3);
    expect(o.get(1)!.length).toBe(3);
    const image = o.get(0)!.map(([x, y]) => [width - x, width - y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const theirs = [...o.get(1)!].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(theirs).toEqual(image);
  });

  it.each(['wadi_tarfan', 'milh_flats'] as const)('%s camp: each end marches on the other\'s camp exit, an image of its own', (map) => {
    const o = orders(map, 'camp');
    expect(o.get(0)).toHaveLength(1);
    expect(o.get(1)).toHaveLength(1);
    // Camp exits are not exact images (a camp's exit side is the sim's), but each sits near its end's camp and never its own.
    const camps = versusModes[map].camps!;
    const near = (p: [number, number], c: { at: readonly number[] }): boolean => Math.abs(p[0] / 65536 - (c.at[0] + 1)) <= 3 && Math.abs(p[1] / 65536 - (c.at[1] + 1)) <= 3;
    expect(near(o.get(0)![0], camps.hostile)).toBe(true);
    expect(near(o.get(1)![0], camps.friendly)).toBe(true);
  });
});

describe('the holding party of the points play', () => {
  it('units standing in a zone their side holds keep half of themselves there (at least one), and only the rest are ordered on', () => {
    const map = 'milh_flats' as MapId;
    const w = buildMatchWorld(modeConfig(map, 'points', seedOf(0)));
    const zone = w.map.zones.knoll_0;
    const ids = w.bySide[0];
    // Everything side 0 has stands in knoll_0, which it therefore holds after one tick.
    for (const id of ids) w.sim.teleport(id, (zone[0] + 3) * 65536, (zone[1] + 3) * 65536);
    matchTick(w);
    expect(w.runtime!.incomeZones.find((z) => z.zone === 'knoll_0')!.holder).toBe(0);
    const spy = vi.spyOn(w.sim, 'queueCommand');
    pointsOrder(w, versusModes[map].modes.points!.zones.map((z) => z.zone), 1); // end 1 passive: only side 0 orders
    const ordered = spy.mock.calls.flatMap(([c]) => (c.kind === 'attackMove' ? c.ids : []));
    const stay = Math.max(1, ids.length >> 1);
    expect(ids.length).toBeGreaterThan(4);
    expect(ordered).toHaveLength(ids.length - stay);
    // ...and the ones that stayed are the lowest ids, so the party does not change from one order to the next.
    expect(ordered.every((id) => ids.indexOf(id) >= stay)).toBe(true);
    // One unit alone in a held zone stays (the "at least one"): an end with a single unit inside orders nobody out of it.
    const lone = buildMatchWorld(modeConfig(map, 'points', seedOf(0)));
    for (const id of lone.bySide[0]) lone.sim.teleport(id, 1 * 65536, 1 * 65536);
    lone.sim.teleport(lone.bySide[0][0], (zone[0] + 3) * 65536, (zone[1] + 3) * 65536);
    matchTick(lone);
    const spy2 = vi.spyOn(lone.sim, 'queueCommand');
    pointsOrder(lone, versusModes[map].modes.points!.zones.map((z) => z.zone), 1);
    const ordered2 = spy2.mock.calls.flatMap(([c]) => (c.kind === 'attackMove' ? c.ids : []));
    expect(ordered2).not.toContain(lone.bySide[0][0]);
    expect(ordered2).toHaveLength(lone.bySide[0].length - 1);
  });
});

describe('modeSelfCheck', () => {
  it('passes on the arm as shipped, on each map and mode', () => {
    for (const map of ['wadi_tarfan', 'milh_flats'] as MapId[]) for (const mode of ['camp', 'points'] as const) expect(modeSelfCheck(map, mode), `${map} ${mode}`).toEqual([]);
  }, FULL_GAMES_TIMEOUT_MS);

  const swapped: ModePlayFn = (m, mode, s, o) => {
    const g = playMode(m, mode, s, o);
    return { ...g, winner: g.winner === null ? null : g.winner === 0 ? 1 : 0 };
  };
  const uncut: ModePlayFn = (m, mode, s, o) => playMode(m, mode, s, { ...o, cutEnd: undefined });
  const unseeded = (): ModePlayFn => { let n = 0; return (m, mode, s, o) => playMode(m, mode, s + (n++ % 2), o); };

  it('goes red when the sides are swapped (M1)', () => {
    const failed = modeSelfCheck('wadi_tarfan', 'camp', swapped);
    expect(failed).toHaveLength(2);
    expect(failed[0]).toContain('should win');
  }, FULL_GAMES_TIMEOUT_MS);

  it('goes red when the control does not cut the weak end', () => {
    expect(modeSelfCheck('wadi_tarfan', 'points', uncut).length).toBeGreaterThanOrEqual(1);
  }, FULL_GAMES_TIMEOUT_MS);

  it('goes red when the control runs to the cap: a game nobody closes in', () => {
    const stalled: ModePlayFn = (_m, _mode, _s, o) => ({ winner: o?.cutEnd === undefined ? 0 : (o.cutEnd === 0 ? 1 : 0), by: 'cap', ticks: 30000 });
    expect(modeSelfCheck('wadi_tarfan', 'camp', stalled).join('\n')).toContain('ran to the cap');
  });

  it('goes red when one seed reads two games (M3)', () => {
    expect(modeSelfCheck('wadi_tarfan', 'camp', unseeded()).some((f) => f.includes('one seed played twice'))).toBe(true);
  }, FULL_GAMES_TIMEOUT_MS);
});

describe('the command line', () => {
  const quiet = (fn: () => number): { code: number; out: string } => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    try { return { code: fn(), out: lines.join('\n') }; } finally { spy.mockRestore(); }
  };
  const fake: ModePlayFn = (_m, _mode, _s, o) => (o?.passive === undefined ? { winner: 0, by: 'objective', ticks: 2400 } : { winner: o.passive === 0 ? 1 : 0, by: 'objective', ticks: 2400 });

  it('main routes --mode to the arm, prints one line per cell and a verdict, and exits 0', () => {
    const r = quiet(() => probeMain(['--mode=points', '--maps=wadi_tarfan', '--seeds=4', '--no-self-check']));
    expect(r.code).toBe(0);
    expect(r.out).toContain('versus modes probe: 4 seeds from 0');
    expect(r.out).toMatch(/wadi_tarfan points active:/);
    expect(r.out).toMatch(/wadi_tarfan points passive west:/);
    expect(r.out).toMatch(/=> wadi_tarfan points: fair/);
  }, FULL_GAMES_TIMEOUT_MS);

  it('a map with no mode file, a mode that is not one, and a bad count are refused', () => {
    expect(() => modeMain(['--mode=camp', '--maps=tel_marum'], fake)).toThrow(/has no win-mode file/);
    expect(() => modeMain(['--mode=flag'], fake)).toThrow(/--mode/);
    expect(() => modeMain(['--mode=camp', '--seeds=0'], fake)).toThrow(/--seeds/);
    expect(() => modeMain(['--mode=camp', '--wipe=maybe'], fake)).toThrow(/--wipe/);
  });

  it('exits 2 and says which control failed when the self-check does', () => {
    const r = quiet(() => modeMain(['--mode=camp', '--maps=wadi_tarfan', '--seeds=2'], (m, mode, s, o) => ({ ...fake(m, mode, s, o), winner: 0 })));
    expect(r.code).toBe(2);
    expect(r.out).toContain('SELF-CHECK FAILED');
  });

  it('a fake that always lets the active end win reads fair OUTSIDE, goal ok, and both passive ends LOSE', () => {
    const r = quiet(() => modeMain(['--mode=camp', '--maps=milh_flats', '--seeds=10', '--no-self-check'], fake));
    expect(r.out).toContain('=> milh_flats camp: fair OUTSIDE (100.0%); goal share 100.0% ok; passive west loses (goal share 100.0%); passive east loses (goal share 100.0%)');
  });

  it('flags a passive end that did not lose', () => {
    const turtle: ModePlayFn = (_m, _mode, _s, o) => ({ winner: o?.passive ?? 0, by: 'cap', ticks: 30000 });
    const r = quiet(() => modeMain(['--mode=camp', '--maps=milh_flats', '--seeds=4', '--no-self-check'], turtle));
    expect(r.out).toContain('passive west DOES NOT ALWAYS LOSE');
    expect(r.out).toContain('goal share 0.0% LOW');
  });
});

describe('the sweep knobs (in memory only)', () => {
  it('withPointsOverride replaces the numbers a room reads for the length of the call, and puts them back, also on a throw', () => {
    const before = JSON.stringify(versusModes.wadi_tarfan);
    const seen = withPointsOverride('wadi_tarfan', { zones: [{ zone: 'centre_ford', per_min: 7 }], perValueDestroyed: 0, target: 123 }, () => {
      const w = buildMatchWorld(modeConfig('wadi_tarfan' as MapId, 'points', seedOf(0)));
      return w.runtime!.objectiveList.length;
    });
    expect(seen).toBe(2);
    expect(JSON.stringify(versusModes.wadi_tarfan)).toBe(before);
    expect(() => withPointsOverride('wadi_tarfan', { target: 5 }, () => { throw new Error('boom'); })).toThrow('boom');
    expect(JSON.stringify(versusModes.wadi_tarfan)).toBe(before);
    expect(() => withPointsOverride('tel_marum', { target: 5 }, () => 0)).toThrow(/no points block/);
  });

  it('the override really reaches the game: a target of 1 point is won inside a second of a hold, and a rate of 1 point is not a 30', () => {
    const quick = withPointsOverride('milh_flats', { target: 1, zones: [{ zone: 'bir_milh', per_min: 120 }] }, () => playMode('milh_flats' as MapId, 'points', seedOf(0), { passive: 0 }));
    expect(quick.points![1]).toBeGreaterThanOrEqual(1);
    const normal = playMode('milh_flats' as MapId, 'points', seedOf(0), { passive: 0 });
    expect(quick.ticks).toBeLessThan(normal.ticks);
  }, FULL_GAMES_TIMEOUT_MS);

  it('parses --zones, and refuses a rate that is not a whole number of points', () => {
    expect(parseZones('bir_milh:30,tell_nw:20')).toEqual([{ zone: 'bir_milh', per_min: 30 }, { zone: 'tell_nw', per_min: 20 }]);
    for (const bad of ['bir_milh', 'bir_milh:0', 'bir_milh:2.5', ':3', 'a:1:2']) expect(() => parseZones(bad), bad).toThrow(/--zones/);
  });

  it('modeMain refuses a sweep of a mode that has no points race', () => {
    expect(() => modeMain(['--mode=camp', '--target=300'], () => ({ winner: 0, by: 'objective', ticks: 1 }))).toThrow(/need --mode=points/);
    expect(() => modeMain(['--mode=points', '--kill=-1']), '--kill').toThrow(/--kill/);
  });
});
