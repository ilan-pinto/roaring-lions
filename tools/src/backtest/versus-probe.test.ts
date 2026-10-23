// The versus probe's own checks (#561). The probe is report-only -- no verdict it
// prints fails anything -- so what must NOT be allowed to pass quietly is the
// probe itself: a table from an instrument that cannot tell west from east.
// Each test below is seen red under a one-line mutation of versus-probe.ts (the
// header there lists them; the commit message says which was run).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { doctrines, versusRules, type MapId } from '@lions/data';
import { VERSUS_FAIR_MAPS } from '@lions/net';
import { fx } from '@lions/sim';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import {
  CAP_TICKS_DEFAULT, DECIDE_EVERY_TICKS, FAIR_MAX_PERCENT, ORDER_EVERY_TICKS, SEEDS_DEFAULT,
  candidateMaps, cellName, centroid, economySelfCheck, forceMixOf, humanHeldOf, layoutOf, main, parseArrangements, parsePair, planRound, play,
  reading, roomConfig, seedOf, selfCheck, tally, withOverrides, world, type Played, type PlayFn,
  TUNNEL_CELLS, playTunnelCells, tunnelSelfCheck, withoutVersusRoutes,
} from './versus-probe';

// Every test that plays FULL games carries this instead of vitest's 5 s
// default: the M1, M3 and uncut mutants and `main`'s two runs (four or more
// tel_marum games each), the cut-side control (eight, on four maps), and
// "one seed as one game" (two, but the file's first, so it also pays the
// sim's first-game warm-up).
// They are CPU-bound sim runs with no I/O, and each game is the claim, so
// they are not cut. Measured single-file, Apple M3 Pro, 2026-10-15, six
// runs with the load average at 38-106 on 12 cores throughout (no idle run
// was to be had): the fastest two read M3 0.42-0.51 s, uncut 0.65-0.68 s,
// main 0.73-0.84 s; the other four up to 2.9 / 3.3 / 3.1 s; and under a full
// parallel `pnpm test` on a loaded machine they crossed 5 s more than once.
// Re-measured 2026-10-15 for the four added since, three runs each at a load
// average of 12-20 then three at 31-78: one seed 0.34-0.35 / 0.62-3.30 s, the
// cut side 0.16-0.18 / 0.30-1.04 s, M1 0.26-0.28 / 0.35-2.07 s, main's exit 2
// 0.26 / 0.33-2.09 s. "One seed" crossing 5 s was reported from agents' full
// parallel runs, not reproduced single-file (3.30 s at most).
// The margin is for contention only: needing it on a quiet machine would be
// a regression. (`selfCheck` on every open map, below, keeps its own 60 s.)
const FULL_GAMES_TIMEOUT_MS = 30_000;

const game = (winner: 0 | 1 | null, by: Played['by'] = 'annihilation', ticks = 1200): Played => ({ winner, by, ticks });

describe('the probe parameters the lead set (#561, #589)', () => {
  it('re-orders every 20 s, decides on surviving value at a 10-minute cap, and the bar is 60/40 at 48 seeds', () => {
    expect(ORDER_EVERY_TICKS).toBe(20 * 20);
    expect(CAP_TICKS_DEFAULT).toBe(10 * 60 * 20);
    expect(DECIDE_EVERY_TICKS).toBe(20);
    expect(FAIR_MAX_PERCENT).toBe(60);
    expect(SEEDS_DEFAULT).toBe(48);
    expect(seedOf(0)).toBe(1000);
    expect(seedOf(2)).toBe(1000 + 2 * 7919);
  });
});

describe('play', () => {
  it('reads one seed as one game, run to run', () => {
    const a = play('tel_marum', ['kdf', 'kdf'], seedOf(3));
    expect(play('tel_marum', ['kdf', 'kdf'], seedOf(3))).toEqual(a);
    expect(a.ticks).toBeGreaterThan(0);
  }, FULL_GAMES_TIMEOUT_MS);
  it('a game nobody closes in is decided on surviving value at the cap: level forces draw, the larger force wins', () => {
    // 2 s: the forces are 28 tiles apart and no one has fired.
    expect(play('tel_marum', ['kdf', 'kdf'], seedOf(0), { capTicks: 40 })).toEqual({ winner: null, by: 'cap', ticks: 40 });
    // Side 1 cut to one unit: side 0 holds more value at the cap, whichever the ground.
    expect(play('tel_marum', ['kdf', 'kdf'], seedOf(0), { capTicks: 40, cutSide: 1 })).toEqual({ winner: 0, by: 'cap', ticks: 40 });
    expect(play('tel_marum', ['kdf', 'kdf'], seedOf(0), { capTicks: 40, cutSide: 0 })).toEqual({ winner: 1, by: 'cap', ticks: 40 });
  });
  it('a side cut to one unit loses to the other by annihilation, on each spawn: the sides are told apart', () => {
    for (const map of VERSUS_FAIR_MAPS) {
      expect(play(map as MapId, ['kdf', 'kdf'], seedOf(0), { cutSide: 1 })).toMatchObject({ winner: 0, by: 'annihilation' });
      expect(play(map as MapId, ['kdf', 'kdf'], seedOf(0), { cutSide: 0 })).toMatchObject({ winner: 1, by: 'annihilation' });
    }
  }, FULL_GAMES_TIMEOUT_MS);
});

describe('selfCheck', () => {
  // Four games a map, on every map a room is offered on: four maps since the
  // versus maps (2026-10-14), ~2 s alone and ~8 s under a full parallel run.
  it('passes on the probe as shipped, on each map a room is offered on', () => {
    for (const map of VERSUS_FAIR_MAPS) expect(selfCheck(map as MapId), map).toEqual([]);
  }, 60_000);

  // The mutants below stand in for the source mutations in versus-probe.ts's
  // header (M1 swaps the winner, M2 orders nobody, M3 unseeds the sim): each is
  // a `play` that is wrong in one way, and the check has to name it.
  const swapped: PlayFn = (m, a, s, o) => {
    const g = play(m, a, s, o);
    return { ...g, winner: g.winner === null ? null : g.winner === 0 ? 1 : 0 };
  };
  const ordersNobody: PlayFn = (m, a, s, o) => play(m, a, s, { ...o, capTicks: 100 });   // nobody closes before the cap
  const unseeded = (): PlayFn => { let n = 0; return (m, a, s, o) => play(m, a, s + (n++ % 2), o); };
  const uncut: PlayFn = (m, a, s, o) => play(m, a, s, { ...o, cutSide: undefined });

  it('goes red when the sides are swapped (M1)', () => {
    const failed = selfCheck('tel_marum', swapped);
    expect(failed).toHaveLength(2);
    expect(failed[0]).toContain('should win by annihilation');
  }, FULL_GAMES_TIMEOUT_MS);
  it('goes red when the orders never close the distance, so a control runs to the cap (M2)', () => {
    const failed = selfCheck('tel_marum', ordersNobody);
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(failed.join('\n')).toContain('by cap');
  });
  it('goes red when one seed reads two different games (M3)', () => {
    const failed = selfCheck('tel_marum', unseeded());
    expect(failed.some((f) => f.includes('one seed played twice'))).toBe(true);
  }, FULL_GAMES_TIMEOUT_MS);
  it('goes red when the control does not cut the weak side', () => {
    expect(selfCheck('tel_marum', uncut).length).toBeGreaterThanOrEqual(1);
  }, FULL_GAMES_TIMEOUT_MS);
});

describe('centroid (wounds on in versus, 23 Oct 2026)', () => {
  it('marches on the standing force: a man down is left out of his side\'s centroid', () => {
    const { sim, typeOf } = world('tel_marum', 1000);
    const squad = typeOf.get('inf_squad');
    const down = typeOf.get('wounded_kdf');
    expect(squad).toBeDefined();
    expect(down).toBeDefined();
    sim.spawn(squad ?? -1, 0, fx.from(10), fx.from(10));
    const man = sim.spawn(down ?? -1, 0, fx.from(30), fx.from(30));
    expect(sim.isDown(man)).toBe(true);
    expect(centroid(sim, 0)).toEqual([fx.from(10), fx.from(10)]);
  });
});

describe('tally', () => {
  it('counts wins by side, draws, how the games ended and their length', () => {
    const t = tally([game(0), game(0, 'cap', 12000), game(1, 'stalemate', 600), game(null, 'mutual', 400), game(null, 'cap', 12000)]);
    expect(t).toEqual({ seeds: 5, wins: [2, 1], draws: 2, by: { annihilation: 1, mutual: 1, stalemate: 1, cap: 2 }, ticks: 1200 + 12000 + 600 + 400 + 12000 });
  });
  it('an empty cell is zero everywhere', () => {
    expect(tally([])).toEqual({ seeds: 0, wins: [0, 0], draws: 0, by: { annihilation: 0, mutual: 0, stalemate: 0, cap: 0 }, ticks: 0 });
  });
});

describe('reading (the 60/40 bar)', () => {
  const cell = (w0: number, w1: number, seeds = 48) => tally([...Array(w0).fill(game(0)), ...Array(w1).fill(game(1)), ...Array(seeds - w0 - w1).fill(game(null, 'cap'))]);

  it('a mirror cell is read by side: west against east', () => {
    expect(reading(['kdf', 'kdf'], cell(20, 28))).toMatchObject({ labels: ['west', 'east'], wins: [20, 28], leader: 'east', leaderPercent: 58.3, within: true });
  });
  it('28 of 48 is within 60/40 and 29 of 48 is not, from either side', () => {
    expect(reading(['kdf', 'kdf'], cell(20, 28)).within).toBe(true);
    expect(reading(['kdf', 'kdf'], cell(19, 29)).within).toBe(false);
    expect(reading(['kdf', 'kdf'], cell(29, 19)).within).toBe(false);
    expect(reading(['kdf', 'kdf'], cell(28, 20)).within).toBe(true);
  });
  it('the bar is inclusive: exactly 60% is within, one more is not', () => {
    expect(reading(['kdf', 'kdf'], cell(6, 4, 10)).within).toBe(true);
    expect(reading(['kdf', 'kdf'], cell(3, 7, 10)).within).toBe(false);
  });
  it('level is no leader', () => {
    expect(reading(['kdf', 'kdf'], cell(24, 24))).toMatchObject({ leader: null, leaderPercent: 50, within: true });
  });
  it('a draw is nobody\'s: the share is of all the seeds', () => {
    expect(reading(['kdf', 'kdf'], cell(29, 0, 48))).toMatchObject({ leaderPercent: 60.4, within: false });
    expect(reading(['kdf', 'kdf'], cell(28, 0, 48))).toMatchObject({ leaderPercent: 58.3, within: true });
  });
  it('a KDF-against-Sarim cell is read by faction, whichever spawn each stands on', () => {
    // KDF west: the west wins are the KDF's.
    expect(reading(['kdf', 'sarim'], cell(19, 29))).toMatchObject({ labels: ['KDF', 'Sarim'], wins: [19, 29], leader: 'Sarim' });
    // Sarim west: the east wins are the KDF's.
    expect(reading(['sarim', 'kdf'], cell(19, 29))).toMatchObject({ labels: ['KDF', 'Sarim'], wins: [29, 19], leader: 'KDF' });
  });
});

describe('cells by END (LD1, N3 Task 2)', () => {
  it('lays a cell out as a room seats it: the KDF on side 0 at whichever end it stands', () => {
    expect(layoutOf(['kdf', 'kdf'])).toEqual({ sideOfEnd: [0, 1], factions: ['kdf', 'kdf'], ends: ['friendly', 'hostile'] });
    expect(layoutOf(['kdf', 'sarim'])).toEqual({ sideOfEnd: [0, 1], factions: ['kdf', 'sarim'], ends: ['friendly', 'hostile'] });
    // Sarim friendly: Sarim is side 1 on the friendly end, the KDF side 0 on the hostile end.
    expect(layoutOf(['sarim', 'kdf'])).toEqual({ sideOfEnd: [1, 0], factions: ['kdf', 'sarim'], ends: ['hostile', 'friendly'] });
  });
  it('names a faction cell by the faction at the friendly end', () => {
    expect(cellName(['kdf', 'kdf'])).toBe('kdf/kdf');
    expect(cellName(['kdf', 'sarim'])).toBe('KDF friendly');
    expect(cellName(['sarim', 'kdf'])).toBe('Sarim friendly');
  });
  it('a Sarim-friendly cell reports its winner by END: the hostile KDF cut to one unit loses', () => {
    // capTicks 40: the larger force holds more value at the cap, so the friendly end (Sarim, side 1) wins.
    expect(play('tel_marum', ['sarim', 'kdf'], seedOf(0), { capTicks: 40, cutSide: 1 })).toEqual({ winner: 0, by: 'cap', ticks: 40 });
    expect(play('tel_marum', ['sarim', 'kdf'], seedOf(0), { capTicks: 40, cutSide: 0 })).toEqual({ winner: 1, by: 'cap', ticks: 40 });
  });
});

describe('the command line', () => {
  it('reads arrangements as <faction>/<faction>', () => {
    expect(parseArrangements('kdf/kdf,kdf/sarim,sarim/kdf')).toEqual([['kdf', 'kdf'], ['kdf', 'sarim'], ['sarim', 'kdf']]);
    for (const bad of ['kdf', 'kdf/rif', 'kdf/sarim/kdf', '', 'kdf/kdf,']) expect(() => parseArrangements(bad), bad).toThrow(/--arr/);
  });
  it('--maps=all is every shipped map but the tile studies and the tutorial, the open ones among them', () => {
    const all = candidateMaps();
    for (const map of VERSUS_FAIR_MAPS) expect(all).toContain(map);
    expect(all.filter((m) => m.startsWith('tile_') || m === 'tutorial_ground')).toEqual([]);
    expect(all.length).toBeGreaterThan(VERSUS_FAIR_MAPS.length);
  });
});

describe('main', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const run = (playFn?: PlayFn) => {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.join(' ')); });
    const code = main(['--maps=tel_marum', '--seeds=2', '--arr=kdf/kdf'], playFn);
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('prints the table and exits 0 -- report-only -- whatever the reading says', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain('self-check: 1 map(s)');
    expect(r.out).toMatch(/tel_marum\s+kdf\/kdf\s+\d+\s+\d+/);
    // Two seeds are not the bar, and it says so.
    expect(r.out).toContain('only 2 seeds: the bar is 48');
  }, FULL_GAMES_TIMEOUT_MS);
  it('a failed self-check exits 2 and prints no table: a probe that cannot tell its sides apart reports nothing', () => {
    const swapped: PlayFn = (m, a, s, o) => {
      const g = play(m, a, s, o);
      return { ...g, winner: g.winner === null ? null : g.winner === 0 ? 1 : 0 };
    };
    const r = run(swapped);
    expect(r.code).toBe(2);
    expect(r.err).toContain('SELF-CHECK FAILED');
    expect(r.out).not.toMatch(/tel_marum\s+kdf\/kdf/);
  }, FULL_GAMES_TIMEOUT_MS);
  it('refuses a map the build does not ship', () => {
    expect(() => main(['--maps=atlantis'])).toThrow(/not a shipped map/);
  });
  it('reads on the room\'s seat table by default, and labels the single-player table a control', () => {
    expect(run().out).toContain('seat table: room (humanHeld [true, true]');
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
    expect(main(['--maps=tel_marum', '--seeds=1', '--arr=kdf/kdf', '--rules=default'])).toBe(0);
    expect(out.join('\n')).toContain('control: single-player seat table');
    expect(() => main(['--rules=solo'])).toThrow(/--rules/);
  }, FULL_GAMES_TIMEOUT_MS);
  it('the economy arm refuses what it cannot play: a mirror cell, the control seat table, a map with no rules file, a sweep without --economy', () => {
    expect(() => main(['--economy', '--arr=kdf/kdf'])).toThrow(/KDF-against-Sarim/);
    expect(() => main(['--economy', '--rules=default'])).toThrow(/--rules=default/);
    expect(() => main(['--economy', '--maps=milh_flats'])).toThrow(/no versus rules file/);
    expect(() => main(['--start=3000/4800'])).toThrow(/need --economy/);
    expect(() => parsePair('start', '3000')).toThrow(/--start/);
    expect(parsePair('pop-cap', '40/56')).toEqual([40, 56]);
  });
  it('--economy prints what the economy did: units built and the final purse, by faction', () => {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
    expect(main(['--economy', '--maps=tel_marum', '--seeds=1', '--arr=kdf/sarim'])).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('economy: buildMatchWorld + matchTick; start kdf 1500 / sarim 2400; pop cap kdf 40 / sarim 56; income as shipped');
    expect(text).toContain('built K/S');
    expect(text).toMatch(/tel_marum\s+KDF friendly\s+\d+\s+\d+\s+\d+\s+\S+\s+[\d.]+\s+[\d.]+\/[\d.]+\s+\d+\/\d+/);
  }, FULL_GAMES_TIMEOUT_MS);
});

describe('the seat table (N3 Task 7: a room\'s, by default)', () => {
  it('a room holds both sides; the control holds side 0 alone (the Sim\'s default)', () => {
    expect(humanHeldOf('room', 'tel_marum', ['kdf', 'sarim'], 1000)).toEqual([true, true]);
    expect(humanHeldOf('default', 'tel_marum', ['kdf', 'sarim'], 1000)).toBeUndefined();
  });
  it('play is on the room\'s table unless told otherwise: a wadi_tarfan game the two tables decide differently', () => {
    // LITERALS, read at 0cb0ced2 (games-room.jsonl, and the default-rules run of N3 Task 2):
    // Sarim friendly, seed 246489, KDF wins by annihilation at 4160 ticks under the room's
    // table and at 3760 under the single-player one, whose side 1 auto-breaches walls.
    // Re-read when wounds opened to versus (the lead, 23 Oct 2026: the wounded types join the
    // roster and the wound block is in the hash). Was 4580 / 5160; still two different games.
    // Re-read for GH-769 (Wadi Tarfan seats (11,11)/(36,36), tunnel capacity 3): seed 246489 (index 31)
    // played the same game under both tables (Sarim wins at 3620), so the index moved to 28 (222732),
    // the first of 40 where they differ. Was seedOf(31) = 246489, KDF wins at 4160 / 3760.
    const seed = seedOf(28);
    expect(seed).toBe(222732);
    expect(play('wadi_tarfan', ['sarim', 'kdf'], seed)).toEqual({ winner: 0, by: 'annihilation', ticks: 2480 });
    expect(play('wadi_tarfan', ['sarim', 'kdf'], seed, { rules: 'default' })).toEqual({ winner: 0, by: 'annihilation', ticks: 3420 });
  }, FULL_GAMES_TIMEOUT_MS);
});

describe('the economy arm (N3 Task 7)', () => {
  // The plan rebuilds toward the doctrine's own force mix (`planRound`). LITERALS
  // throughout: the mixes and costs are read off data/ by hand, not from the code.
  // KDF placed force: Lavi 2, Namer 2, Eitan 1, squad 3, AT team 2, mortar 1, jeep 1,
  // Peten 1 (drone and D9 unarmed); Yahalom is on the menu and not in the force.
  // Sarim: rifles 2, Kornet 14, ZU truck 6, MANPADS 2, Grad 2; recoilless not in the force.
  const freshPlan = (arr: ['kdf', 'sarim'] | ['sarim', 'kdf'], map = 'tel_marum' as MapId) => {
    // The literal sequences below were read off a 3000 / 4800 start (the doctrines' value until the
    // lead's 1500 / 2400 of 22 Oct), so the world is built under that override: a purse change must
    // not silently rewrite the rule's witness.
    const w = withOverrides({ start: [3000, 4800] }, () => buildMatchWorld(roomConfig(map, arr, 1000)));
    const rt = w.runtime;
    if (rt === null) throw new Error('no runtime');
    return { w, rt, plan: (side: 0 | 1) => planRound(rt, w.sim, doctrines[w.factions[side]].menu, forceMixOf(w.factions[side]), side) };
  };
  it('the plan rebuilds the force mix: a fresh purse buys the missing type, then one of each in menu order', () => {
    const { rt, plan } = freshPlan(['kdf', 'sarim']);
    // KDF 3000: every fielded type stands at ratio 1 and Yahalom at 0, so Yahalom (260) first,
    // then the ties in menu order -- Lavi 906, Namer 630, Eitan 520, squad 292, AT team 236 --
    // and the 156 left covers nothing (mortar 209). The drone (210) and D9 are unarmed: never bought.
    expect(plan(0)).toEqual(['yahalom_squad', 'mbt_lavi', 'ifv_namer', 'apc_eitan', 'inf_squad', 'at_team']);
    expect(rt.logisticsOf(0)).toBe(156);
    expect(rt.productionOf(0).map((p) => p.unit)).toEqual(['yahalom_squad', 'mbt_lavi', 'ifv_namer', 'apc_eitan', 'inf_squad', 'at_team']);
    // Sarim 4800: recoilless (0/1), then one of each at ratio 1 in menu order, recoilless again
    // (1/1 is the lowest), then the Kornet wall and the ZU screen climb by ratio
    // (15/14 < 7/6 < 16/14 ...), rifles at the 3/2 tie, and the line's queue bound
    // (one in progress + 16) ends the round with the purse unspent.
    expect(plan(1)).toEqual([
      'recoilless_team', 'sarim_rifles', 'atgm_cell', 'gun_truck', 'manpad_team', 'rocket_battery', 'recoilless_team',
      'atgm_cell', 'atgm_cell', 'gun_truck', 'atgm_cell', 'atgm_cell', 'gun_truck', 'atgm_cell', 'atgm_cell', 'sarim_rifles', 'atgm_cell',
    ]);
    expect(rt.logisticsOf(1)).toBe(447);
    // What is queued and in progress counts. Cancel the queued AT team (refund 236, purse 392):
    // the line holds Yahalom in progress and Lavi, Namer, Eitan, squad queued, so the AT team
    // (2 living / 2) ties at 1 with the mortar, jeep, Peten and Yahalom and is first by menu.
    // Uncounted, the queued types would read 1 and the squad (292) would be bought instead;
    // the in-progress Yahalom uncounted would read 0 and be bought first.
    expect(rt.cancelBuild(0, 4, 0)).toBe(true);
    expect(rt.logisticsOf(0)).toBe(392);
    expect(plan(0)).toEqual(['at_team']);
    expect(rt.logisticsOf(0)).toBe(156);
    // A second round with the queue full and the purse short buys nothing.
    expect(plan(0)).toEqual([]);
    expect(plan(1)).toEqual([]);
  });
  it('the plan buys what a side has lost, by ratio to the mix, and falls through a refusal to the next', () => {
    const { w, rt, plan } = freshPlan(['kdf', 'sarim']);
    const ofType = (side: 0 | 1, t: string) => w.bySide[side].filter((i) => w.sim.unitTypes[w.sim.state.typeIdx[i]]?.id === t);
    for (const id of ofType(0, 'inf_squad')) w.sim.debugKill(id);
    // The drone and the D9 lost too: both read 0/1, and neither is armed, so neither is bought.
    for (const id of [...ofType(0, 'recon_drone'), ...ofType(0, 'dozer_d9')]) w.sim.debugKill(id);
    for (const id of ofType(1, 'atgm_cell').slice(0, 7)) w.sim.debugKill(id);
    // KDF, squads 0/3 and Yahalom 0/1 tie at 0 (squad first by menu), then squad 1/3, 2/3;
    // at the ratio-1 tie Lavi (906) and Namer (630) leave 328, the Eitan (520) is REFUSED,
    // and the plan falls through to the squad (292): 36 left.
    expect(plan(0)).toEqual(['inf_squad', 'yahalom_squad', 'inf_squad', 'inf_squad', 'mbt_lavi', 'ifv_namer', 'inf_squad']);
    expect(rt.logisticsOf(0)).toBe(36);
    // Sarim, 7 of 14 Kornet teams lost: recoilless (0), then seven Kornets back up to 14/14,
    // then the ratio-1 ties in menu order.
    expect(plan(1).slice(0, 14)).toEqual([
      'recoilless_team', 'atgm_cell', 'atgm_cell', 'atgm_cell', 'atgm_cell', 'atgm_cell', 'atgm_cell', 'atgm_cell',
      'sarim_rifles', 'atgm_cell', 'gun_truck', 'manpad_team', 'rocket_battery', 'recoilless_team',
    ]);
  });
  it('the plan is the same for a faction on either end: swapping the ends changes nothing either buys', () => {
    for (const map of Object.keys(versusRules) as MapId[]) {
      const a = freshPlan(['kdf', 'sarim'], map);
      const b = freshPlan(['sarim', 'kdf'], map);
      // KDF is side 0 and Sarim side 1 in both rooms (`sidesOfFactions`); only the ends differ.
      expect(a.w.endOfSide).not.toEqual(b.w.endOfSide);
      expect(b.plan(0), `${map} KDF`).toEqual(a.plan(0));
      expect(b.plan(1), `${map} Sarim`).toEqual(a.plan(1));
    }
  });
  it('the economy self-check passes on each map with a rules file', () => {
    for (const map of Object.keys(versusRules)) expect(economySelfCheck(map as MapId), map).toEqual([]);
  }, 60_000);
  it('goes red when the plan never queues: no side fields a built unit (the no-queue mutation)', () => {
    const noQueue: PlayFn = (m, a, s, o) => play(m, a, s, { ...o, plan: false });
    const failed = economySelfCheck('tel_marum', noQueue);
    expect(failed.join('\n')).toContain('at least one built unit');
  }, FULL_GAMES_TIMEOUT_MS);
  it('goes red when the sides are swapped', () => {
    const swapped: PlayFn = (m, a, s, o) => {
      const g = play(m, a, s, o);
      return { ...g, winner: g.winner === null ? null : g.winner === 0 ? 1 : 0 };
    };
    expect(economySelfCheck('tel_marum', swapped).filter((f) => f.includes('should win by annihilation'))).toHaveLength(2);
  }, FULL_GAMES_TIMEOUT_MS);
  it('goes red when the outcome rule forgets production: a side with a camp and a purse is called beaten at once', () => {
    const noProduction: PlayFn = (m, a, s, o) => {
      const g = play(m, a, s, o);
      // What the units-only rule reads on a wiped end: beaten on the first decision tick.
      return o?.wipeSide !== undefined ? { winner: o.wipeSide === 0 ? 1 : 0, by: 'annihilation', ticks: DECIDE_EVERY_TICKS } : g;
    };
    expect(economySelfCheck('tel_marum', noProduction).filter((f) => f.includes('should not be beaten'))).toHaveLength(2);
  }, FULL_GAMES_TIMEOUT_MS);
  it('goes red when the control keeps the weak end\'s camp: it buys its way back', () => {
    // The control destroys the cut end's camp as well; without that the weak end's purse
    // fields a force and the strong end no longer wins by annihilation.
    const campKept: PlayFn = (m, a, s, o) => (o?.economy === true && o.cutSide !== undefined ? play(m, a, s, { ...o, cutSide: undefined }) : play(m, a, s, o));
    expect(economySelfCheck('tel_marum', campKept).length).toBeGreaterThanOrEqual(1);
  }, FULL_GAMES_TIMEOUT_MS);
});

describe('the sweep overrides (in memory only)', () => {
  it('lays start purses, population caps and an income scale over the data for one run, and puts the data back', () => {
    const kdf = doctrines.kdf;
    const rules = versusRules.tel_marum;
    const seen = withOverrides({ start: [1000, 1600], popCap: [30, 42], rateScalePercent: 50 }, () => {
      const w = buildMatchWorld(roomConfig('tel_marum', ['kdf', 'sarim'], 1000));
      return {
        purse: [w.runtime?.logisticsOf(0), w.runtime?.logisticsOf(1)],
        cap: [w.runtime?.populationView(0)?.cap, w.runtime?.populationView(1)?.cap],
        rates: versusRules.tel_marum.income_zones.map((z) => z.rate_per_min),
      };
    });
    expect(seen).toEqual({ purse: [1000, 1600], cap: [30, 42], rates: [20, 20, 10, 10, 10] });
    expect(doctrines.kdf).toBe(kdf);
    expect(versusRules.tel_marum).toBe(rules);
    expect(doctrines.kdf.budget.logistics_start).toBe(1500);
    expect(() => withOverrides({ start: [1, 1] }, () => { throw new Error('boom'); })).toThrow('boom');
    expect(doctrines.sarim.budget.logistics_start).toBe(2400);
  });
});

describe('the tunnel arm (GH-681, T5)', () => {
  const tun = { entered: 0, stalled: 0, surfaced: 0, raids: 0, exits: 0, identified: 0, charges: 0, collapsed: 0, collapseKills: 0 };
  const g = (over: Partial<Played> = {}): Played => ({ winner: 0, by: 'annihilation', ticks: 1200, econ: { built: [1, 1], purse: [0, 0] }, tun, ...over });
  const games = (cell2Surfaced: number, offTicks = 1200) => ({
    cells: { off: [g({ ticks: offTicks })], noAnswer: [g({ tun: { ...tun, surfaced: cell2Surfaced } })], answer: [g()], turtle: [g()] },
    routeless: [g()],
  });

  it('the self-check passes a run whose cell 2 came up and whose cell 1 is the routeless game', () => {
    expect(tunnelSelfCheck('tel_marum', ['kdf', 'sarim'], games(3))).toEqual([]);
  });
  it('goes red when cell 2 never surfaced: the Sarim plan did not run (the enterTunnel no-op)', () => {
    expect(tunnelSelfCheck('tel_marum', ['kdf', 'sarim'], games(0))).toHaveLength(1);
  });
  it('goes red when cell 1 is not the routeless game: an unordered route moved a game', () => {
    expect(tunnelSelfCheck('tel_marum', ['kdf', 'sarim'], games(3, 1220))).toHaveLength(1);
  });

  it('the routeless world registers no versus route, and puts the rules back', () => {
    const rules = versusRules.tel_marum;
    expect(buildMatchWorld(roomConfig('tel_marum', ['kdf', 'sarim'], 1000)).sim.tunnelCount).toBe(2);
    expect(withoutVersusRoutes(() => buildMatchWorld(roomConfig('tel_marum', ['kdf', 'sarim'], 1000)).sim.tunnelCount)).toBe(0);
    expect(versusRules.tel_marum).toBe(rules);
  });

  it('one seed through the four cells: cell 1 is the routeless game, cell 2 goes below and comes up, the turtle never vents', () => {
    const r = playTunnelCells('tel_marum', ['kdf', 'sarim'], 1, CAP_TICKS_DEFAULT);
    expect(TUNNEL_CELLS.map((c) => r.cells[c].length)).toEqual([1, 1, 1, 1]);
    const { tun: offTun, ...off } = r.cells.off[0];
    expect(off).toEqual(r.routeless[0]);
    expect(offTun).toMatchObject({ entered: 0, surfaced: 0, raids: 0, exits: 0, charges: 0 });
    expect(r.cells.noAnswer[0].tun?.entered).toBeGreaterThan(0);
    expect(r.cells.noAnswer[0].tun?.surfaced).toBeGreaterThan(0);
    expect(r.cells.noAnswer[0].tun?.charges).toBe(0);
    expect(r.cells.turtle[0].tun).toMatchObject({ surfaced: 0, raids: 0, exits: 0 });
    expect(r.cells.turtle[0].tun?.entered).toBeGreaterThan(0);
  }, FULL_GAMES_TIMEOUT_MS);

  it('main exits 2 when the tunnel orders never reach the sim, and prints no table', () => {
    // Stands in for the sim mutation (enterTunnel a no-op): the tunnel cells play the plain economy game.
    const noTunnels: PlayFn = (m, a, s, o) => play(m, a, s, { ...o, tunnels: o?.tunnels === undefined ? undefined : 'off' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(main(['--tunnels', '--seeds=1', '--maps=tel_marum', '--arr=kdf/sarim'], noTunnels)).toBe(2);
      expect(log.mock.calls.flat().join('\n')).not.toContain('the bar (lead');
      expect(err.mock.calls.flat().join('\n')).toContain("no 'surfaced' event");
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  }, FULL_GAMES_TIMEOUT_MS);
});
