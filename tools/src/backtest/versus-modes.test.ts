// The versus probe's win-mode arm (GH-976 P1): the instrument has to tell its sides apart, play both ends the same
// way, and read its own bars the way the header says. Each test is seen red under a one-line mutation of
// versus-modes.ts; the commit message lists them.
import { describe, expect, it, vi } from 'vitest';
import type { MapId } from '@lions/data';
import { buildMatchWorld, matchTick } from '../../../packages/app/src/net/match-world';
import { economyRoom } from '@lions/net';
import {
  GOAL_SHARE_MIN_PERCENT, POINTS_SPLIT, RAID_SQUADS, RAZE_MEAN_MAX_S_48, RAZE_MEAN_MAX_S_96, contestedShare, holdsBalanced, razeLimitS, razeOk, razeVerdict, withCampOverride, flagOrder, idleSidesFor, parseFlags, parseZones, raidParty, withFlagOverride, withPointsOverride, campOrder, describeTally, describeTiming, fairWithin, fairWithinDecisive, goalShareOk, modeConfig, modeMain, modeSelfCheck, passiveLost, playMode, pointsOrder, tallyModes,
  type ModePlayFn, type ModePlayed,
} from './versus-modes';
import { main as probeMain, seedOf } from './versus-probe';
import { versusModes, versusRules } from '@lions/data';

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

  it('GH-976 P4: fair over the DECISIVE games is the leader\'s share of the games somebody won: draws cannot hide a lopsided read', () => {
    // 58 v 35 and 40 draws: 58 of 133 is 43.6% of all the games, but 58 of 93 is 62.4% of those somebody won.
    const hidden = tallyModes([...games(58, 35), ...Array.from({ length: 40 }, () => game(null, 'mutual'))]);
    expect(fairWithin(hidden)).toBe(true);
    expect(fairWithinDecisive(hidden)).toBe(false);
    // The bar itself is in: 60 of 100 decisive is 60%, within; 61 of 100 is over; and draws on top change neither.
    expect(fairWithinDecisive(tallyModes(games(60, 40)))).toBe(true);
    expect(fairWithinDecisive(tallyModes(games(61, 39)))).toBe(false);
    expect(fairWithinDecisive(tallyModes(games(39, 61)))).toBe(false);
    expect(fairWithinDecisive(tallyModes([...games(60, 40), ...Array.from({ length: 50 }, () => game(null, 'mutual'))]))).toBe(true);
    // A cell nobody won is empty, not fair: it must not pass on zero over zero.
    expect(fairWithinDecisive(tallyModes(Array.from({ length: 96 }, () => game(null, 'mutual'))))).toBe(false);
    expect(fairWithinDecisive(tallyModes([]))).toBe(false);
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
    // GH-976 after_camp: a win on the cap's surviving value, or on a stalemate, is not a LOSS by the goal or a wipe (the docstring always said so)
    expect(passiveLost(tallyModes([...games(0, 95), game(1, 'cap')]), 0)).toBe(false);
    expect(passiveLost(tallyModes([...games(0, 95), game(1, 'stalemate')]), 0)).toBe(false);
    expect(passiveLost(tallyModes([...games(0, 95), game(1, 'annihilation')]), 0)).toBe(true); // a wipe is a loss
    expect(passiveLost(tallyModes(games(0, 96)), 1)).toBe(false); // the wrong end: east passive, west won none
  });

  it('G1b: the contested share counts the games where the goal fell while the loser still had an armed unit, and only those', () => {
    const c = (contested: boolean, by: ModePlayed['by'] = 'objective'): ModePlayed => ({ ...game(0, by), contested });
    expect(contestedShare(tallyModes([c(true), c(true), c(false), c(false)]))).toBe('50.0');
    expect(contestedShare(tallyModes([c(false), c(false)]))).toBe('0.0');
    expect(contestedShare(tallyModes([game(0), game(1)]))).toBe('0.0'); // a game with no flag is not contested
    expect(tallyModes([c(true), c(false)]).contested).toBe(1);
  });

  it('G5: no wipe was left unrazed (a cap, a stalemate or a match the wipe ended) and the mean raze is within the limit; no wipe at all reads null, not ok', () => {
    const wiped = (wipeTick: number, ticks: number, by: ModePlayed['by'] = 'objective'): ModePlayed => ({ ...game(0, by, ticks), wipeTick });
    const secs = (n: number): number => n * 20;
    expect(razeOk(tallyModes([wiped(0, secs(120))]), 120)).toBe(true);        // exactly the limit
    expect(razeOk(tallyModes([wiped(0, secs(121))]), 120)).toBe(false);       // a second over
    expect(razeOk(tallyModes([wiped(0, secs(100)), wiped(0, secs(140))]), 120)).toBe(true); // a MEAN
    expect(razeOk(tallyModes([wiped(0, secs(120)), wiped(secs(10), secs(10), 'cap')]), 120)).toBe(false);      // one capped game fails it
    expect(razeOk(tallyModes([wiped(0, secs(10)), wiped(0, secs(10), 'stalemate')]), 120)).toBe(false);
    expect(razeOk(tallyModes([wiped(0, secs(10)), wiped(0, secs(10), 'annihilation')]), 120)).toBe(false); // the wipe ended the match: not after_camp
    expect(razeOk(tallyModes([wiped(0, secs(10)), wiped(0, secs(10), 'mutual')]), 120)).toBe(true);        // a mutual wipe is a draw, not a raze
    expect(razeOk(tallyModes(games(3, 3)), 120)).toBeNull();                  // nothing wiped: nothing read
    expect(razeOk(tallyModes([]), 120)).toBeNull();
    // the raze runs from the WIPE, not the start of the game
    expect(razeOk(tallyModes([wiped(secs(500), secs(600))]), 120)).toBe(true);
    expect(razeOk(tallyModes([wiped(secs(500), secs(700))]), 120)).toBe(false);
    expect(razeLimitS(48)).toBe(RAZE_MEAN_MAX_S_48);
    expect(razeLimitS(96)).toBe(RAZE_MEAN_MAX_S_96);
    expect([RAZE_MEAN_MAX_S_48, RAZE_MEAN_MAX_S_96]).toEqual([120, 240]);
    expect(razeVerdict('active', tallyModes([wiped(0, secs(10))]), 120)).toContain('ok');
    expect(razeVerdict('active', tallyModes([wiped(0, secs(10), 'cap')]), 120)).toContain('FAIL');
    expect(razeVerdict('active', tallyModes([wiped(0, secs(10), 'annihilation')]), 120, false)).toBe('G5 active n/a (wipe ends)');
  });

  it('G4: the defender holds of the two ends are within 14 of 96, scaled to the games played', () => {
    expect(holdsBalanced(60, 46, 96)).toBe(true);
    expect(holdsBalanced(60, 45, 96)).toBe(false);
    expect(holdsBalanced(46, 60, 96)).toBe(true);
    expect(holdsBalanced(45, 60, 96)).toBe(false);
    expect(holdsBalanced(120, 90, 192)).toBe(false); // 30 of 192 is 15 of 96
    expect(holdsBalanced(120, 92, 192)).toBe(true);
  });

  it('GH-976 P4: a faction cell names the faction at each end, the mirror reads as it always did', () => {
    const t = tallyModes(games(3, 2));
    expect(describeTally(t)).toBe('west 3 / east 2 / draw 0  by goal 5, wipe 0, mutual 0, stalemate 0, cap 0  mean 60 s');
    expect(describeTally(t, ['kdf', 'kdf'])).toBe(describeTally(t));
    expect(describeTally(t, ['kdf', 'sarim'])).toBe('west (kdf) 3 / east (sarim) 2 / draw 0  by goal 5, wipe 0, mutual 0, stalemate 0, cap 0  mean 60 s');
    expect(describeTally(t, ['sarim', 'kdf'])).toContain('west (sarim) 3 / east (kdf) 2');
  });

  it('describes every way a game ended', () => {
    expect(describeTally(tallyModes([game(0, 'objective', 2000), game(1, 'annihilation', 4000), game(null, 'cap', 6000), game(0, 'stalemate', 0), game(null, 'mutual', 0)])))
      .toBe('west 2 / east 1 / draw 2  by goal 1, wipe 1, mutual 1, stalemate 1, cap 1  mean 120 s');
  });
});

describe('playMode: a room\'s own world', () => {
  it('a cut end loses to the other by annihilation or the goal on each map, each mode and each end: the sides are told apart', () => {
    for (const map of ['wadi_tarfan', 'milh_flats'] as MapId[]) {
      for (const mode of ['camp', 'points', 'flag'] as const) {
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

  it('GH-976 P3: a passive end that stays home loses a flag raid by the flag, each end, on each map, and the raid takes about a minute', () => {
    for (const map of ['wadi_tarfan', 'milh_flats'] as MapId[]) {
      const east = playMode(map, 'flag', seedOf(0), { passive: 1 });
      expect(east, `${map} east passive`).toMatchObject({ winner: 0, by: 'objective' });
      expect(playMode(map, 'flag', seedOf(0), { passive: 0 }), `${map} west passive`).toMatchObject({ winner: 1, by: 'objective' });
      // 30 s of hold plus the walk: well past the hold, well short of the 25-minute cap.
      expect(east.ticks).toBeGreaterThan(30 * 20);
      expect(east.ticks).toBeLessThan(120 * 20);
      expect(east.points).toBeUndefined();
    }
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

  it('GH-976 after_camp: a wiped side does not end the match (milh_flats ships it); under wipe=ends the same game ends on the wipe', () => {
    const after = playMode('milh_flats', 'camp', seedOf(0), { cutEnd: 1 });
    expect(after).toMatchObject({ winner: 0, by: 'objective', contested: false });
    expect(after.wipeTick).toBeDefined();
    expect(after.ticks).toBeGreaterThan(after.wipeTick!); // a raze followed the wipe
    // the other end wiped: the wipe is read for EITHER side
    const west = playMode('milh_flats', 'camp', seedOf(0), { cutEnd: 0 });
    expect(west).toMatchObject({ winner: 1, by: 'objective', contested: false });
    expect(west.wipeTick).toBeDefined();
    const ends = withCampOverride('milh_flats', { wipe: 'ends' }, () => playMode('milh_flats', 'camp', seedOf(0), { cutEnd: 1 }));
    expect(ends).toMatchObject({ winner: 0, by: 'annihilation' });
    expect(ends.wipeTick).toBe(ends.ticks);
  }, FULL_GAMES_TIMEOUT_MS);

  it('withCampOverride sets the rule and the rules-file camps in memory and puts both back, also on a throw', () => {
    const wasMilh = JSON.stringify(versusModes.milh_flats);
    withCampOverride('milh_flats', { wipe: 'ends' }, () => expect(versusModes.milh_flats.modes.camp).toEqual({ wipe: 'ends' }));
    expect(JSON.stringify(versusModes.milh_flats)).toBe(wasMilh);
    expect(versusModes.milh_flats_l.camps).toBeUndefined();
    withCampOverride('milh_flats_l', { fromRules: true, wipe: 'after_camp' }, () => {
      const f = versusModes.milh_flats_l;
      expect(f.modes.camp).toEqual({ wipe: 'after_camp' });
      expect(f.camps!.friendly).toEqual({ at: versusRules.milh_flats_l.ends.friendly.camp.at, size: versusRules.milh_flats_l.ends.friendly.camp.size, exit: versusRules.milh_flats_l.ends.friendly.camp.exit });
    });
    expect(versusModes.milh_flats_l.camps).toBeUndefined();
    expect(versusModes.milh_flats_l.modes.camp).toBeUndefined();
    expect(() => withCampOverride('milh_flats_l', { wipe: 'ends' }, () => 0)).toThrow(/no camp block/);
    expect(() => withCampOverride('milh_flats', { wipe: 'ends' }, () => { throw new Error('boom'); })).toThrow('boom');
    expect(JSON.stringify(versusModes.milh_flats)).toBe(wasMilh);
  });

  it('the G4 defender stands on its own exit while the enemy has an armed unit, and goes to raze when it has none', () => {
    const w = buildMatchWorld(modeConfig('milh_flats' as MapId, 'camp', seedOf(0)));
    const spy = vi.spyOn(w.sim, 'queueCommand');
    campOrder(w, 'milh_flats', -1, 0); // side 0 (west) defends
    const target = (side: number): [number, number] => {
      const call = spy.mock.calls.map(([c]) => c).find((c) => c.kind === 'attackMove' && w.sim.state.side[c.ids[0]] === side);
      if (call === undefined || call.kind !== 'attackMove') throw new Error('no order');
      return [call.x / 65536, call.y / 65536];
    };
    // West defends its own exit (12,36); east attacks it too -- the same point, and not east's own (35,11).
    expect(target(0)).toEqual([12.5, 36.5]); // the exit tile's centre
    expect(target(1)).toEqual([12.5, 36.5]);
    // Once the enemy has no armed unit the defender marches on the enemy camp instead.
    for (const id of w.bySide[1]) w.sim.debugKill(id);
    spy.mockClear();
    campOrder(w, 'milh_flats', -1, 0);
    expect(target(0)).toEqual([35.5, 11.5]);
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

describe('the raid of the flag play (GH-976 P3)', () => {
  const worldOf = (map: MapId) => buildMatchWorld(modeConfig(map, 'flag', seedOf(0)));
  const typeOf = (w: ReturnType<typeof worldOf>, id: number): string => w.sim.unitTypes[w.sim.state.typeIdx[id]].id;

  it('a raid is two infantry squads: the first two in placement order, for each side, and nothing else', () => {
    expect(RAID_SQUADS).toBe(2);
    for (const map of ['wadi_tarfan', 'milh_flats'] as MapId[]) {
      const w = worldOf(map);
      for (const side of [0, 1] as const) {
        const party = raidParty(w, side);
        expect(party, `${map} side ${side}`).toHaveLength(2);
        expect(party.map((id) => typeOf(w, id))).toEqual(['inf_squad', 'inf_squad']);
        expect(party.every((id) => w.sim.state.side[id] === side)).toBe(true);
        expect(party).toEqual(w.bySide[side].filter((id) => typeOf(w, id) === 'inf_squad').slice(0, 2));
      }
    }
  });

  it('the party moves on the ENEMY end\'s flag, an image of the other side\'s, and the rest of the force marches on the enemy centroid', () => {
    for (const map of ['wadi_tarfan', 'milh_flats'] as MapId[]) {
      const w = worldOf(map);
      const spy = vi.spyOn(w.sim, 'queueCommand');
      const parties = new Map<number, readonly number[]>([[0, raidParty(w, 0)], [1, raidParty(w, 1)]]);
      flagOrder(w, map, parties, new Set(), [w.endOfSide[0] === 'friendly' ? 0 : 1, w.endOfSide[0] === 'friendly' ? 1 : 0]);
      const raids = spy.mock.calls.map(([c]) => c).filter((c) => c.kind === 'attackMove' && c.ids.length === 2);
      const blobs = spy.mock.calls.map(([c]) => c).filter((c) => c.kind === 'attackMove' && c.ids.length > 2);
      expect(raids, map).toHaveLength(2);
      expect(blobs, map).toHaveLength(2);
      const flags = versusModes[map].flags!;
      const centre = (f: { readonly at: readonly number[]; readonly size: readonly number[] }): [number, number] => [(f.at[0] + f.size[0] / 2) * 65536, (f.at[1] + f.size[1] / 2) * 65536];
      for (const c of raids) {
        if (c.kind !== 'attackMove') continue;
        const side = w.sim.state.side[c.ids[0]];
        const target = centre(flags[w.endOfSide[side === 0 ? 1 : 0]]);
        expect([c.x, c.y], `${map} side ${side} raids the flag at the other end`).toEqual(target);
      }
      // The party is not in the blob's order.
      const raiding = new Set([...parties.values()].flat());
      for (const c of blobs) if (c.kind === 'attackMove') expect(c.ids.some((id) => raiding.has(id))).toBe(false);
    }
  });

  it('the passive side, and in the flag control the cut side too, take no order: a one-man race against a raid is no control', () => {
    expect([...idleSidesFor('flag', 1, -1)]).toEqual([1]);
    expect([...idleSidesFor('flag', -1, 0)].sort()).toEqual([-1, 0]);
    expect([...idleSidesFor('flag', 0, 1)].sort()).toEqual([0, 1]);
    // the other modes keep their cut side ordered: the lone survivor still marches, as the P1 control has always had it
    expect([...idleSidesFor('camp', -1, 0)]).toEqual([-1]);
    expect([...idleSidesFor('points', -1, 0)]).toEqual([-1]);
  });

  it('a side that issues no order sends no raid and no blob; the other side still does', () => {
    const w = worldOf('wadi_tarfan');
    const spy = vi.spyOn(w.sim, 'queueCommand');
    const parties = new Map<number, readonly number[]>([[0, raidParty(w, 0)], [1, raidParty(w, 1)]]);
    flagOrder(w, 'wadi_tarfan', parties, new Set([1]), [0, 1]);
    const sides = new Set(spy.mock.calls.map(([c]) => (c.kind === 'attackMove' ? w.sim.state.side[c.ids[0]] : -1)));
    expect([...sides]).toEqual([0]);
  });

  it('a dead raider is not replaced from the blob: the party is latched', () => {
    const w = worldOf('wadi_tarfan');
    const party = raidParty(w, 0);
    const parties = new Map<number, readonly number[]>([[0, party], [1, raidParty(w, 1)]]);
    w.sim.debugKill(party[0]);
    const spy = vi.spyOn(w.sim, 'queueCommand');
    flagOrder(w, 'wadi_tarfan', parties, new Set([1]), [0, 1]);
    const raid = spy.mock.calls.map(([c]) => c).find((c) => c.kind === 'attackMove' && c.ids.length === 1);
    expect(raid && raid.kind === 'attackMove' ? raid.ids : null).toEqual([party[1]]);
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
    for (const map of ['wadi_tarfan', 'milh_flats'] as MapId[]) for (const mode of ['camp', 'points', 'flag'] as const) expect(modeSelfCheck(map, mode), `${map} ${mode}`).toEqual([]);
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
    expect(() => modeMain(['--mode=camp', '--maps=qarn_hadid'], fake)).toThrow(/has no win-mode file/);
    expect(() => modeMain(['--mode=rally'], fake)).toThrow(/--mode/);
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
    expect(r.out).toContain('=> milh_flats camp: fair OUTSIDE (100.0%); decisive OUTSIDE (100.0% of 10); goal share 100.0% ok; G1b contested 0.0% (report only); G5 active n/a (no wipe)');
    expect(r.out).toContain('passive west loses (goal share 100.0%)');
    expect(r.out).toContain('passive east loses (goal share 100.0%)');
  });

  it('GH-976: the camp cell prints G1b, G5 per arm and the G4 defender holds; a wipe that is never razed FAILS G5, and wipe=ends reads n/a', () => {
    // A fake whose games are all wiped at tick 100: razed 60 s later when the active ends play, never razed (the cap) when a defender plays.
    const wiper: ModePlayFn = (_m, _mode, _s, o) => (o?.defend !== undefined
      ? { winner: 0, by: 'cap', ticks: 30000, wipeTick: 100 } // west wins both defender arms: holds 96 west, 0 east
      : { winner: 0, by: 'objective', ticks: 100 + 60 * 20, wipeTick: 100, contested: false });
    const r = quiet(() => modeMain(['--mode=camp', '--maps=milh_flats', '--seeds=96', '--no-self-check', '--passive=off'], wiper));
    expect(r.out).toContain('G1b contested 0.0% (report only)');
    expect(r.out).toContain('G5 active ok (96 wipes, 96 razed, mean 60 s of 120, 0 never razed)');
    expect(r.out).toContain('G5 defend west FAIL (96 wipes, 0 razed, mean 0 s of 120, 96 never razed)');
    expect(r.out).toContain('G4 holds west 96 / east 0 of 96 UNBALANCED');
    // The 96x96 limit: 150 s is over 120 on milh_flats (48) and under 240 on milh_flats_l (96).
    const slow: ModePlayFn = () => ({ winner: 0, by: 'objective', ticks: 100 + 150 * 20, wipeTick: 100, contested: false });
    expect(quiet(() => modeMain(['--mode=camp', '--maps=milh_flats', '--seeds=2', '--no-self-check', '--passive=off', '--defend=off'], slow)).out).toContain('G5 active FAIL');
    expect(quiet(() => modeMain(['--mode=camp', '--maps=milh_flats_l', '--camps=rules', '--camp-wipe=after_camp', '--seeds=2', '--no-self-check', '--passive=off', '--defend=off'], slow)).out).toContain('G5 active ok (2 wipes, 2 razed, mean 150 s of 240');
    const ends = quiet(() => modeMain(['--mode=camp', '--maps=milh_flats', '--camp-wipe=ends', '--seeds=2', '--no-self-check', '--passive=off', '--defend=off'], wiper));
    expect(ends.out).toContain('G5 active n/a (wipe ends)');
    expect(() => modeMain(['--mode=camp', '--camp-wipe=maybe'], fake)).toThrow(/--camp-wipe/);
    expect(() => modeMain(['--mode=camp', '--camps=elsewhere'], fake)).toThrow(/--camps/);
    expect(() => modeMain(['--mode=points', '--camp-wipe=ends'], fake)).toThrow(/need --mode=camp/);
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
    expect(() => withPointsOverride('qarn_hadid', { target: 5 }, () => 0)).toThrow(/no points block/);
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

describe('GH-976 P4: a KDF-v-Sarim cell is a mode room too (the two placed forces, a goals-only runtime, no economy)', () => {
  it('modeConfig carries the arrangement by END: the host stands friendly, the KDF is side 0 wherever it stands, and the room is no economy room', () => {
    const kdfHost = modeConfig('wadi_tarfan' as MapId, 'flag', seedOf(0), ['kdf', 'sarim']);
    expect(kdfHost.seats.map((s) => [s.seat, s.side, s.faction])).toEqual([[0, 0, 'kdf'], [1, 1, 'sarim']]);
    const sarimHost = modeConfig('wadi_tarfan' as MapId, 'flag', seedOf(0), ['sarim', 'kdf']);
    expect(sarimHost.seats.map((s) => [s.seat, s.side, s.faction])).toEqual([[0, 1, 'sarim'], [1, 0, 'kdf']]);
    for (const c of [kdfHost, sarimHost]) {
      expect(c.winMode).toBe('flag');
      expect(economyRoom(c)).toBe(false);
    }
    // The default is the mirror, as every reading before P4.
    expect(modeConfig('wadi_tarfan' as MapId, 'flag', seedOf(0)).seats.map((s) => s.faction)).toEqual(['kdf', 'kdf']);
  });

  it('a faction mode room stands the two placed forces and a goals-only runtime: Sarim on side 1 at the friendly end when it hosts', () => {
    const w = buildMatchWorld(modeConfig('wadi_tarfan' as MapId, 'points', seedOf(0), ['sarim', 'kdf']));
    expect(w.factions).toEqual(['kdf', 'sarim']);
    expect(w.endOfSide).toEqual(['hostile', 'friendly']);
    expect(w.runtime).not.toBeNull();
    expect(w.bySide[0].length).toBeGreaterThan(0);
    expect(w.bySide[1].length).toBeGreaterThan(w.bySide[0].length); // Sarim fields the larger count of smaller units
    expect(w.sim.unitTypes[w.sim.state.typeIdx[w.bySide[1][0]]].id).toBe('sarim_rifles');
  });

  it('a cut end loses in a faction cell, each end and each order: the arm reads the END, and the arrangement reaches the game', () => {
    for (const arr of [['kdf', 'sarim'], ['sarim', 'kdf']] as const) {
      expect(playMode('wadi_tarfan' as MapId, 'flag', seedOf(0), { arr, cutEnd: 1 }), `${arr.join('/')} east cut`).toMatchObject({ winner: 0 });
      expect(playMode('wadi_tarfan' as MapId, 'flag', seedOf(0), { arr, cutEnd: 0 }), `${arr.join('/')} west cut`).toMatchObject({ winner: 1 });
    }
  }, FULL_GAMES_TIMEOUT_MS);

  it('the same seed under the two orders is two games, and one order twice is one game', () => {
    const a = playMode('wadi_tarfan' as MapId, 'flag', seedOf(1), { arr: ['kdf', 'sarim'] });
    expect(playMode('wadi_tarfan' as MapId, 'flag', seedOf(1), { arr: ['kdf', 'sarim'] })).toEqual(a);
    const mirror = playMode('wadi_tarfan' as MapId, 'flag', seedOf(1));
    expect(mirror).not.toEqual(a);
  }, FULL_GAMES_TIMEOUT_MS);

  it('the self-check hands the arrangement to every game it plays, and names a faction cell in what it says', () => {
    const seen: string[] = [];
    const spyFn: ModePlayFn = (_m, _mode, _s, o) => { seen.push((o?.arr ?? ['kdf', 'kdf']).join('/')); return { winner: 0, by: 'objective', ticks: 1 }; };
    const failed = modeSelfCheck('wadi_tarfan' as MapId, 'flag', spyFn, ['sarim', 'kdf']);
    expect(seen).toEqual(['sarim/kdf', 'sarim/kdf', 'sarim/kdf', 'sarim/kdf']);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((f) => f.startsWith('wadi_tarfan flag sarim/kdf:'))).toBe(true);
    // A mirror says what it always said.
    expect(modeSelfCheck('wadi_tarfan' as MapId, 'flag', spyFn)[0]).toMatch(/^wadi_tarfan flag: /);
  });

  it('--arr plays each arrangement as its own block of lines, and the default is the mirror alone', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    const seenArr: string[] = [];
    const fake: ModePlayFn = (_m, _mode, _s, o) => { seenArr.push((o?.arr ?? ['kdf', 'kdf']).join('/')); return { winner: o?.passive === undefined ? 0 : o.passive === 0 ? 1 : 0, by: 'objective', ticks: 2400 }; };
    try {
      modeMain(['--mode=flag', '--maps=wadi_tarfan', '--seeds=2', '--no-self-check', '--arr=kdf/sarim,sarim/kdf'], fake);
      expect([...new Set(seenArr)]).toEqual(['kdf/sarim', 'sarim/kdf']);
      expect(lines.join('\n')).toContain('wadi_tarfan flag kdf/sarim active:   west (kdf) 2 / east (sarim) 0');
      expect(lines.join('\n')).toContain('=> wadi_tarfan flag sarim/kdf: fair OUTSIDE');
      expect(lines.join('\n')).toContain('decisive OUTSIDE (100.0% of 2)');
      seenArr.length = 0;
      lines.length = 0;
      modeMain(['--mode=flag', '--maps=wadi_tarfan', '--seeds=2', '--no-self-check'], fake);
      expect([...new Set(seenArr)]).toEqual(['kdf/kdf']);
      expect(lines.join('\n')).toContain('wadi_tarfan flag active:   west 2 / east 0');
    } finally { spy.mockRestore(); }
    expect(() => modeMain(['--mode=flag', '--arr=kdf/ashwar'], fake)).toThrow(/--arr/);
  });
});

describe('GH-976 P4: the flag sweep knob and a ground the mode declares (in memory only)', () => {
  it('parses --flags as the friendly and the hostile rectangle, and refuses anything else', () => {
    expect(parseFlags('6,30,5,5/37,13,5,5')).toEqual([[6, 30, 5, 5], [37, 13, 5, 5]]);
    for (const bad of ['6,30,5,5', '6,30,5/37,13,5,5', '6,30,5,5/37,13,5,x', '6,30,0,5/37,13,5,5', '-1,30,5,5/37,13,5,5', '1,2,3,4/5,6,7,8/9,10,11,12']) expect(() => parseFlags(bad), bad).toThrow(/--flags/);
  });

  it('withFlagOverride moves the flag a room reads for the length of the call and puts it back, also on a throw', () => {
    const before = JSON.stringify(versusModes.wadi_tarfan);
    const seen = withFlagOverride('wadi_tarfan', { flags: [[10, 40, 4, 4], [33, 3, 4, 4]], holdS: 45 }, () => {
      const w = buildMatchWorld(modeConfig('wadi_tarfan' as MapId, 'flag', seedOf(0)));
      return { zones: [w.map.zones.flag_friendly, w.runtime!.incomeZones.length, versusModes.wadi_tarfan.modes.flag!.hold_s], rects: w.runtime!.objectiveList.length };
    });
    expect(seen.rects).toBe(2);
    expect(JSON.stringify(versusModes.wadi_tarfan)).toBe(before);
    expect(() => withFlagOverride('wadi_tarfan', { holdS: 5 }, () => { throw new Error('boom'); })).toThrow('boom');
    expect(JSON.stringify(versusModes.wadi_tarfan)).toBe(before);
    expect(() => withFlagOverride('qarn_hadid', { holdS: 5 }, () => 0)).toThrow(/no flag block/);
  });

  it('the override reaches the game: a raid sent to a nearer flag ends the game sooner', () => {
    const normal = playMode('wadi_tarfan' as MapId, 'flag', seedOf(0), { passive: 1 });
    // The east end sits still; the west raids the hostile flag. Moving that flag from (37,13) to (22,16) shortens the walk.
    const near = withFlagOverride('wadi_tarfan', { flags: [[6, 30, 5, 5], [22, 16, 5, 5]] }, () => playMode('wadi_tarfan' as MapId, 'flag', seedOf(0), { passive: 1 }));
    expect(near.winner).toBe(0);
    expect(near.ticks).toBeLessThan(normal.ticks);
    const longer = withFlagOverride('wadi_tarfan', { holdS: 60 }, () => playMode('wadi_tarfan' as MapId, 'flag', seedOf(0), { passive: 1 }));
    expect(longer.ticks).toBeGreaterThan(normal.ticks + 20 * 20);
  }, FULL_GAMES_TIMEOUT_MS);

  it('--zones takes a ground to declare, rate then @x.y.w.h, and refuses a malformed one', () => {
    expect(parseZones('hold_a:20@10.12.6.6,pass:40')).toEqual([{ zone: 'hold_a', per_min: 20, at: [10, 12], size: [6, 6] }, { zone: 'pass', per_min: 40 }]);
    for (const bad of ['hold_a:20@10.12.6', 'hold_a:20@10.12.0.6', 'hold_a:20@a.b.c.d', 'hold_a:20@1.2.3.4@5']) expect(() => parseZones(bad), bad).toThrow(/--zones/);
  });

  it('a points race scores a ground the mode declares, and the probe\'s play walks to it', () => {
    const declared = [{ zone: 'hold_a', per_min: 60, at: [20, 20], size: [8, 8] }, { zone: 'hold_b', per_min: 60, at: [26, 26], size: [8, 8] }];
    const g = withPointsOverride('wadi_tarfan', { zones: declared as never, target: 300 }, () => {
      const w = buildMatchWorld(modeConfig('wadi_tarfan' as MapId, 'points', seedOf(0)));
      expect(w.map.zones.hold_a).toBeUndefined(); // the map does not have it...
      expect(w.runtime!.incomeZones.map((z) => z.zone).sort()).toEqual(['hold_a', 'hold_b']); // ...the runtime does
      return playMode('wadi_tarfan' as MapId, 'points', seedOf(0), { passive: 1 });
    });
    expect(g).toMatchObject({ winner: 0, by: 'objective' });
    expect(g.points![0]).toBeGreaterThanOrEqual(300);
  }, FULL_GAMES_TIMEOUT_MS);

  it('describeTiming: the median seconds over goal-decided games only, and the games that ended before the rush line', () => {
    const g = (by: 'objective' | 'annihilation', ticks: number) => ({ winner: 0 as const, by, ticks });
    // 20 Hz: 1000 ticks = 50 s, 2000 = 100 s, 4000 = 200 s; the wipe (9000 ticks) is no goal game and moves nothing.
    expect(describeTiming([g('objective', 1000), g('objective', 2000), g('objective', 4000), g('annihilation', 9000)]))
      .toBe('median 100 s to win over 3 goal games, rush wins (before 120 s) 2');
    expect(describeTiming([g('annihilation', 100)])).toBe('no game decided by the goal');
  });
});

describe('GH-976 v2: FLAG_V1_GAME_PIN (R0.19): a v1 flag game stays byte for byte until the per-map relist', () => {
  // Read on the WP1 base (720db3e47), seed 35000, before any other edit: only `probeAt` was added to `playMode`. The raid is a
  // minute long here, so the state is read at tick 1,000, inside the game, not at the plan's tick 2,400 (no game reaches it).
  // The flag block these games read is `flagBlockOf(file, false)`; if that ever returns the staged flag_setup, both go red.
  const FLAG_V1_GAME_PIN = {
    wadi_tarfan: { probe: { hash: 140936277, digest: 1985883999 }, result: { winner: 1, by: 'objective', ticks: 1240 } },
    rujm_sawda: { probe: { hash: 2495921269, digest: 896909483 }, result: { winner: 0, by: 'objective', ticks: 1360 } },
  } as const;
  it.each(['wadi_tarfan', 'rujm_sawda'] as const)('%s: the hash and runtime digest at tick 1000, and the full game\'s winner, finish and length', (map) => {
    const g = playMode(map, 'flag', seedOf(35000), { probeAt: 1000 });
    expect(g.probe).toEqual(FLAG_V1_GAME_PIN[map].probe);
    expect({ winner: g.winner, by: g.by, ticks: g.ticks }).toEqual(FLAG_V1_GAME_PIN[map].result);
  }, FULL_GAMES_TIMEOUT_MS);
  it('probeAt changes nothing else: the same game without it ends the same way', () => {
    const g = playMode('wadi_tarfan', 'flag', seedOf(35000));
    expect(g.probe).toBeUndefined();
    expect({ winner: g.winner, by: g.by, ticks: g.ticks }).toEqual(FLAG_V1_GAME_PIN.wadi_tarfan.result);
  }, FULL_GAMES_TIMEOUT_MS);
});
