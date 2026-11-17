/**
 * GH-1391 slice 1: the commander. Fixture views for each task (defend, zones, production, the guard, the march) and the seat's use of it. The scenarios
 * that play a real room (each behaviour removed changes the result) are in `tools/src/backtest/commander-scenarios.test.ts`. Every check here was
 * seen red under the one-line mutations listed in the commit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Command } from '@lions/sim';
import { DEFEND_TILES, counterPool, createCommander as createSlice2, type CommanderContext, type CommanderOptions, type ZoneFact } from './commander';
import { ComputerSeat, sweepStragglers } from './computer-seat';
import { DESK_MAX_QUEUE } from './order-desk';
import { RUSH_HOME_TILES } from './policy';
import { SOFT_PENETRATION_CEILING, classOf } from './composition';
import { zoneFacts } from './zones';
import type { EconomyView, MenuLine } from './economy-view';
import type { SideView, UnitLine, ContactLine } from './view';

/** The slice 1 tests ask for the slice 1 commander: the slice 2 tasks are off unless a test turns them on. */
const createCommander = (o: CommanderOptions = {}) => createSlice2({ scout: false, counter: false, ...o });

const CAMP: [number, number] = [10, 40];
const ENEMY_CAMP: [number, number] = [40, 8];

const unit = (id: number, tile: [number, number], o: { flags?: string[]; type?: string; hp?: number } = {}): UnitLine => ({ id, type: o.type ?? 'inf_squad', tile, hp: o.hp ?? 100, flags: o.flags ?? ['idle'], stance: 'free' });
const contact = (id: number, tile: [number, number], type = 'rifle', hp = 100): ContactLine => ({ id, type, tile, hp, inSight: true, seenTick: 0 });
const menu = (unit: string, cost: number, blocked?: string): MenuLine => ({ unit, cost, population: 1, buildSeconds: 30, ...(blocked !== undefined ? { blocked } : {}) });
const eco = (o: Partial<EconomyView> = {}): EconomyView => ({
  purse: 1000, perMin: 0, population: null,
  lines: [{ line: 0, alive: true, tile: [10, 40], building: null, progress: 0, secondsLeft: 0, contested: false, queued: [], rally: null }],
  menu: [menu('inf_squad', 100), menu('at_team', 150)], ...o,
});
const view = (o: Partial<SideView> = {}): SideView => ({
  tick: 100, clock: '0:05', side: 0, faction: 'kdf', map: 'tel_marum', size: [48, 48], camp: CAMP, enemyCamp: ENEMY_CAMP,
  units: [], contacts: [], casualties: { mine: [], theirs: [] }, held: [], stances: [], score: { mine: {}, theirs: {} } as never,
  mode: 'annihilation', win: '', result: null, by: null, ...o,
} as SideView);
const zone = (name: string, at: [number, number, number, number], holder: ZoneFact['holder']): ZoneFact => ({ zone: name, at, holder, perMin: 40 });
const ctx = (zones: ZoneFact[] = []): CommanderContext => ({ zones });
const ids = (c: Command): number[] => ('ids' in c ? [...c.ids] : []);
const marches = (cs: readonly Command[]) => cs.filter((c): c is Extract<Command, { kind: 'attackMove' }> => c.kind === 'attackMove');
const tileOf = (c: Extract<Command, { kind: 'attackMove' }>): [number, number] => [Math.floor(c.x / 65536), Math.floor(c.y / 65536)];

describe('defend: a contact near the camp is met at the camp', () => {
  const home = [unit(1, [10, 41]), unit(2, [11, 40]), unit(3, [9, 39])];

  it('every idle unit at home attack-moves on the contact nearest the camp, with the sweep, instead of marching out', () => {
    const out = createCommander({ zones: false, produce: false })(view({ units: home, contacts: [contact(90, [16, 40]), contact(91, [12, 38])] }), ctx());
    const m = marches(out.commands);
    expect(m).toHaveLength(1);
    expect(tileOf(m[0])).toEqual([12, 38]); // the nearer of the two
    expect([...m[0].ids].sort()).toEqual([1, 2, 3]);
    expect(m[0].sweep).toBe(true);
  });

  it('a contact beyond DEFEND_TILES is not a threat: the march goes on the contacts as rush sends it', () => {
    const far: [number, number] = [CAMP[0] + DEFEND_TILES + 3, CAMP[1]];
    const out = createCommander({ zones: false, produce: false })(view({ units: home, contacts: [contact(90, far)] }), ctx());
    const m = marches(out.commands);
    expect(m).toHaveLength(1);
    expect(tileOf(m[0])).toEqual(far);
  });

  it('a lone contact just beyond the radius is marched on as the centroid of ALL contacts, which a defend march on it would not be', () => {
    const justOut: [number, number] = [CAMP[0] + DEFEND_TILES + 3, CAMP[1]];
    const out = createCommander({ zones: false, produce: false })(view({ units: home, contacts: [contact(90, justOut), contact(91, [40, 8])] }), ctx());
    expect(marches(out.commands).map(tileOf)).toEqual([[Math.floor((justOut[0] + 40) / 2), Math.floor((justOut[1] + 8) / 2)]]);
  });

  it('DEFEND_TILES is the script\'s own home radius, not a new number', () => {
    expect(DEFEND_TILES).toBe(RUSH_HOME_TILES);
  });

  it('a unit that is out in the field is not recalled, and a unit that cannot act is never ordered', () => {
    const units = [unit(1, [10, 41]), unit(2, [30, 20]), unit(3, [11, 40], { flags: ['idle', 'disarmed'] })];
    const out = createCommander({ zones: false, produce: false })(view({ units, contacts: [contact(90, [12, 38])] }), ctx());
    // The defend march names the one able unit at home; unit 3 (disarmed) is not in it, and unit 2 (in the field) is not recalled.
    expect(ids(marches(out.commands)[0])).toEqual([1]);
  });

  it('with defend off the same view marches on the contact centroid as rush does', () => {
    const out = createCommander({ defend: false, zones: false, produce: false })(view({ units: home, contacts: [contact(90, [16, 40]), contact(91, [12, 38])] }), ctx());
    expect(tileOf(marches(out.commands)[0])).toEqual([14, 39]);
  });
});

describe('zones: take what is not held, hold what is', () => {
  const idleHome = [1, 2, 3, 4, 5, 6].map((i) => unit(i, [10 + (i % 3), 40]));
  const near = zone('near', [14, 30, 4, 4], 'none');
  const far = zone('far', [30, 10, 4, 4], 'theirs');
  const mine = zone('mine', [20, 20, 4, 4], 'mine');

  it('shares the idle home units out, one share per zone not held (nearest first) and one for the march, attack-moving to each zone\'s centre', () => {
    const out = createCommander({ defend: false, produce: false })(view({ units: idleHome }), ctx([far, near, mine]));
    const m = marches(out.commands);
    // 6 units, 2 zones wanted: share = floor(6 / 3) = 2.
    expect(m.map((c) => [tileOf(c), [...c.ids]])).toEqual([[[16, 32], [1, 2]], [[32, 12], [3, 4]], [[40, 8], [5, 6]]]);
    expect(m[0].sweep).toBeUndefined(); // a zone-taker arrives and stands
  });

  it('a held zone is not marched on, and a view with no zone board plays as the bare march', () => {
    const out = createCommander({ defend: false, produce: false })(view({ units: idleHome }), ctx([mine]));
    expect(marches(out.commands).map(tileOf)).toEqual([ENEMY_CAMP]);
    const bare = createCommander({ defend: false, produce: false })(view({ units: idleHome }), ctx());
    expect(marches(bare.commands).map(tileOf)).toEqual([ENEMY_CAMP]);
  });

  it('keeps ONE idle unit inside a zone it holds or contests (the first by id), and the rest are free to march', () => {
    const inZone = [unit(7, [21, 21]), unit(8, [22, 21]), unit(9, [30, 30])];
    const out = createCommander({ defend: false, produce: false })(view({ units: inZone }), ctx([mine, zone('c', [28, 28, 4, 4], 'contested')]));
    expect([...out.keep].sort()).toEqual([7, 9]);
    // unit 8 is not kept: rush (which only commits what is idle at HOME) leaves it to the straggler sweep.
    const sweep = sweepStragglers(view({ units: inZone }), out.commands, out.keep);
    expect(sweep.flatMap(ids)).toEqual([8]);
  });

  it('the straggler sweep without a keep set orders the holder away (the reason `keep` exists)', () => {
    const v = view({ units: [unit(7, [21, 21])] });
    expect(sweepStragglers(v, []).flatMap(ids)).toEqual([7]);
    expect(sweepStragglers(v, [], new Set([7]))).toEqual([]);
  });

  it('zones off: the same view plays as the bare march and keeps nobody', () => {
    const out = createCommander({ zones: false, defend: false, produce: false })(view({ units: [...idleHome, unit(7, [21, 21])] }), ctx([near, mine]));
    expect(marches(out.commands).map(tileOf)).toEqual([ENEMY_CAMP]);
    expect(out.keep.size).toBe(0);
  });
});

describe('production: queue from the camp\'s line, through ordinary Commands', () => {
  const army = (n: number, type: string, from = 1): UnitLine[] => Array.from({ length: n }, (_, i) => unit(from + i, [30, 30], { type, flags: ['moving'] }));

  it('buys, on each living line with nothing waiting, the armed menu unit the seat is furthest below its starting mix on', () => {
    // Started with 2 inf_squad and 2 at_team; has lost both at_teams: at_team is at 0 of 2, inf_squad at 2 of 2.
    const c = createCommander({ zones: false, defend: false });
    c(view({ units: [...army(2, 'inf_squad'), ...army(2, 'at_team', 3)], economy: eco() }), ctx());
    const out = c(view({ units: army(2, 'inf_squad'), economy: eco() }), ctx());
    expect(out.commands.filter((x) => x.kind === 'build')).toEqual([{ kind: 'build', side: 0, unit: 'at_team', line: 0 }]);
  });

  it('passes over a unit the room would refuse now and one that carries no weapon', () => {
    const c = createCommander({ zones: false, defend: false });
    const e = eco({ purse: 1000, menu: [menu('inf_medic_squad', 50), menu('mbt_lavi', 100, 'population cap'), menu('inf_squad', 100)] });
    const out = c(view({ units: army(1, 'inf_squad'), economy: e }), ctx());
    expect(out.commands.filter((x) => x.kind === 'build')).toEqual([{ kind: 'build', side: 0, unit: 'inf_squad', line: 0 }]);
  });

  it('passes over the unit it is furthest below its mix on when it cannot afford it, and buys the next', () => {
    const c = createCommander({ zones: false, defend: false });
    c(view({ units: [...army(1, 'inf_squad'), ...army(1, 'at_team', 2)], economy: eco() }), ctx()); // started with one of each
    const out = c(view({ units: army(1, 'inf_squad'), economy: eco({ purse: 120 }) }), ctx()); // at_team lost (0 of 1) but costs 150 > 120
    expect(out.commands.filter((x) => x.kind === 'build')).toEqual([{ kind: 'build', side: 0, unit: 'inf_squad', line: 0 }]);
    const rich = c(view({ units: army(1, 'inf_squad'), economy: eco({ purse: 1000 }) }), ctx());
    expect(rich.commands.filter((x) => x.kind === 'build')).toEqual([{ kind: 'build', side: 0, unit: 'at_team', line: 0 }]);
  });

  it('one decision on the biggest shipped board (5 zones, 4 lines) fits the order desk\'s queue of 12, so nothing is dropped from the end', () => {
    const lineOf = (n: number) => ({ line: n, alive: true, tile: [10, 40] as [number, number], building: null, progress: 0, secondsLeft: 0, contested: false, queued: [] as string[], rally: null });
    const zones = [1, 2, 3, 4, 5].map((n) => zone(`z${n}`, [10 + n * 4, 20, 3, 3], 'none'));
    const starters = Array.from({ length: 12 }, (_, i) => unit(i + 1, [10 + (i % 4), 40]));
    const out = createCommander()(view({ units: starters, economy: eco({ purse: 5000, lines: [0, 1, 2, 3].map(lineOf) }) }), ctx(zones));
    expect(out.commands.length).toBeGreaterThan(8);
    expect(out.commands.length).toBeLessThanOrEqual(DESK_MAX_QUEUE);
  });

  it('does not stack: a line with something waiting gets nothing, a dead camp gets nothing, and the purse is spent down across lines', () => {
    const lineOf = (n: number, o: Partial<EconomyView['lines'][number]> = {}) => ({ line: n, alive: true, tile: [10, 40] as [number, number], building: null, progress: 0, secondsLeft: 0, contested: false, queued: [] as string[], rally: null, ...o });
    const c = createCommander({ zones: false, defend: false });
    const e = eco({ purse: 160, lines: [lineOf(0, { queued: ['inf_squad'] }), lineOf(1, { alive: false }), lineOf(2), lineOf(3)] });
    const out = c(view({ units: army(1, 'inf_squad'), economy: e }), ctx());
    // The seat has one inf_squad and one waiting, so at_team is furthest below its mix: 160 buys it (150) for line 2 and leaves 10, which buys nothing for line 3.
    expect(out.commands.filter((x) => x.kind === 'build')).toEqual([{ kind: 'build', side: 0, unit: 'at_team', line: 2 }]);
  });

  it('buys nothing in a room with no economy, and nothing with production off', () => {
    const c = createCommander({ zones: false, defend: false });
    expect(c(view({ units: army(1, 'inf_squad') }), ctx()).commands.some((x) => x.kind === 'build')).toBe(false);
    const off = createCommander({ zones: false, defend: false, produce: false });
    expect(off(view({ units: army(1, 'inf_squad'), economy: eco() }), ctx()).commands.some((x) => x.kind === 'build')).toBe(false);
  });
});

describe('the guard: what was built stays at home and meets a threat', () => {
  it('a unit that was not in the starting force and stands idle at home is kept from the march and the sweep; one that started is marched', () => {
    const c = createCommander({ zones: false, produce: false });
    const starters = [unit(1, [10, 41]), unit(2, [11, 40])];
    c(view({ units: starters, economy: eco() }), ctx());
    const built = unit(50, [10, 42]);
    const out = c(view({ units: [...starters, built], economy: eco() }), ctx());
    expect(out.keep.has(50)).toBe(true);
    expect(marches(out.commands).flatMap(ids).sort()).toEqual([1, 2]);
  });

  it('a threat sends the guard out with everything else idle at home, and it is no longer kept', () => {
    const c = createCommander({ zones: false, produce: false });
    const starters = [unit(1, [10, 41])];
    c(view({ units: starters, economy: eco() }), ctx());
    const out = c(view({ units: [...starters, unit(50, [10, 42])], contacts: [contact(90, [13, 40])], economy: eco() }), ctx());
    expect(marches(out.commands)[0].ids.slice().sort()).toEqual([1, 50]);
    expect(out.keep.has(50)).toBe(false);
  });

  it('guard off: a built unit marches like any other', () => {
    const c = createCommander({ zones: false, produce: false, guard: false });
    c(view({ units: [unit(1, [10, 41])], economy: eco() }), ctx());
    const out = c(view({ units: [unit(1, [10, 41]), unit(50, [10, 42])], economy: eco() }), ctx());
    expect(marches(out.commands).flatMap(ids).sort()).toEqual([1, 50]);
  });

  it('a room with no economy has no guard', () => {
    const c = createCommander({ zones: false, produce: false });
    c(view({ units: [unit(1, [10, 41])] }), ctx());
    expect(c(view({ units: [unit(1, [10, 41]), unit(50, [10, 42])] }), ctx()).keep.size).toBe(0);
  });
});

describe('the seat', () => {
  it('plays rush exactly as before when it is not given a commander (the shipped seat is unchanged)', () => {
    const seat = new ComputerSeat({ seat: 1, side: 1 });
    expect(seat.decidesAt(100)).toBe(true);
    expect(seat.commandsFor(0)).toEqual([]);
  });

  it('a policy and a commander together are refused: one of them would be silently ignored', () => {
    expect(() => new ComputerSeat({ seat: 1, side: 1, policy: () => [], commander: createCommander() })).toThrow(/not both/);
    expect(() => new ComputerSeat({ seat: 1, side: 1, commander: createCommander() })).not.toThrow();
  });

  it('a commander first called on an empty view takes its starting force from the first view that has units, so that force is not "built" (no guard)', () => {
    const c = createCommander({ zones: false, produce: false });
    c(view({ units: [], economy: eco() }), ctx());
    expect(c(view({ units: [unit(1, [10, 41])], economy: eco() }), ctx()).keep.size).toBe(0);
  });

  it('the zone board is public data from the runtime: holder by this side\'s chair, contested apart, never a unit', () => {
    const runtime = { incomeZones: [
      { zone: 'a', rect: [1, 2, 3, 4], state: 0, holder: 0, ratePerMin: 40 },
      { zone: 'b', rect: [5, 6, 7, 8], state: 1, holder: 1, ratePerMin: 20 },
      { zone: 'c', rect: [9, 10, 11, 12], state: -2, holder: -1, ratePerMin: 20 },
      { zone: 'd', rect: [13, 14, 15, 16], state: -1, holder: -1, ratePerMin: 20 },
    ] } as never;
    // A points race shows both holders to both seats (points-view.ts), so `theirs` is public there.
    expect(zoneFacts({ runtime, winMode: 'points' }, 0).map((z) => z.holder)).toEqual(['mine', 'theirs', 'contested', 'none']);
    expect(zoneFacts({ runtime, winMode: 'points' }, 1).map((z) => z.holder)).toEqual(['theirs', 'mine', 'contested', 'none']);
    expect(zoneFacts({ runtime: null, winMode: null }, 0)).toEqual([]);
  });
});

describe('fog: an economy room\'s HUD does not tell an enemy-held zone from an empty one, so neither does the board', () => {
  const runtime = { incomeZones: [
    { zone: 'theirs', rect: [1, 2, 3, 4], state: 1, holder: 1, ratePerMin: 40 },
    { zone: 'empty', rect: [5, 6, 7, 8], state: -1, holder: -1, ratePerMin: 40 },
    { zone: 'mine', rect: [9, 10, 11, 12], state: 0, holder: 0, ratePerMin: 40 },
  ] } as never;
  it('an enemy unit standing in a fogged zone reads `none` in an economy room (winMode null) and in a camp or flag room', () => {
    for (const winMode of [null, 'camp', 'flag'] as const) {
      expect(zoneFacts({ runtime, winMode }, 0).map((z) => z.holder), String(winMode)).toEqual(['none', 'none', 'mine']);
    }
  });
  it('and `theirs` only in a points race, whose board is public to both seats', () => {
    expect(zoneFacts({ runtime, winMode: 'points' }, 0).map((z) => z.holder)).toEqual(['theirs', 'none', 'mine']);
  });
});

describe('invariant 4: the commander reads the public view and writes nothing', () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('commander.ts and zones.ts name no sim column, no snapshot internals and no way to queue a command on the sim', () => {
    expect(strip(readFileSync(join(__dirname, 'commander.ts'), 'utf8'))).not.toMatch(/\.sim\b|\.state\b|internals|queueCommand|\.entityCount|\.unitTypes|requestBuild/);
    // zones.ts reads the runtime's public zone board, whose entries have a `.state` of their own; it names no sim and no way to write one.
    expect(strip(readFileSync(join(__dirname, 'zones.ts'), 'utf8'))).not.toMatch(/\.sim\b|internals|queueCommand|\.entityCount|\.unitTypes|requestBuild|\.state\[/);
  });
});

// ---- slice 2 ------------------------------------------------------------------------------------------------------------------------

/** The slice 2 tasks are opt-in; these tests ask for them. */
const slice2 = (o: CommanderOptions = {}) => createSlice2({ scout: true, counter: true, ...o });

const buildsOf = (cs: readonly Command[]): string[] => cs.filter((c): c is Extract<Command, { kind: 'build' }> => c.kind === 'build').map((c) => c.unit);
const moves = (cs: readonly Command[]) => cs.filter((c): c is Extract<Command, { kind: 'move' }> => c.kind === 'move');
const mkMove = (c: Extract<Command, { kind: 'move' }>): [number, number] => [Math.floor(c.x / 65536), Math.floor(c.y / 65536)];

describe('composition: the classes are read off the unit data', () => {
  it('armour is a hull only an anti-armour weapon can hurt; the ceiling is derived from the data, not written', () => {
    expect(SOFT_PENETRATION_CEILING).toBe(120); // the Namer's autocannon: the best non-anti-armour, non-demolition round
    expect(classOf('mbt_lavi')).toBe('armour');
    expect(classOf('ifv_namer')).toBe('armour');
    expect(classOf('apc_eitan')).toBe('armour');
    expect(classOf('inf_squad')).toBe('soft');
    expect(classOf('jeep_shoded')).toBe('soft'); // a light hull any autocannon hurts
    expect(classOf('heli_peten')).toBe('air');
    expect(classOf('recon_drone')).toBe('none'); // carries no weapon
    expect(classOf('no_such_unit')).toBe('none');
  });
});

describe('slice 2 is opt-in: the default commander is the slice 1 commander', () => {
  it('with no options it neither scouts nor counters: the same view gives the same orders as with both explicitly off', () => {
    const force = [unit(1, [10, 41], { type: 'at_team' }), unit(2, [11, 40], { type: 'inf_squad' }), unit(3, [9, 39], { type: 'mortar_team' })];
    const v = (): SideView => view({ units: force, contacts: [contact(90, [30, 20], 'mbt_lavi')], economy: eco() });
    expect(createSlice2()(v(), ctx()).commands).toEqual(createSlice2({ scout: false, counter: false })(v(), ctx()).commands);
    expect(moves(createSlice2()(v(), ctx()).commands)).toHaveLength(0);
  });
});

describe('scout: the cheapest unit looks at the enemy camp', () => {
  const force = [unit(1, [10, 41], { type: 'at_team' }), unit(2, [11, 40], { type: 'inf_squad' }), unit(3, [9, 39], { type: 'mortar_team' })];
  const only = (o: CommanderOptions) => slice2({ defend: false, zones: false, produce: false, counter: false, ...o });

  it('sends the fastest of the cheaper half (costs 209 / 236 / 292, median 236: the at_team at 0.7 t/s, not the slower mortar crew that is the cheapest) with a move to RUSH_HOME_TILES short of the enemy camp, and leaves it out of the march', () => {
    const out = only({})(view({ units: force }), ctx());
    const m = moves(out.commands);
    expect(m).toHaveLength(1);
    expect(m[0].ids).toEqual([1]);
    const [x, y] = mkMove(m[0]);
    expect(Math.round(Math.hypot(x - ENEMY_CAMP[0], y - ENEMY_CAMP[1]))).toBe(RUSH_HOME_TILES);
    expect(Math.hypot(x - CAMP[0], y - CAMP[1])).toBeLessThan(Math.hypot(ENEMY_CAMP[0] - CAMP[0], ENEMY_CAMP[1] - CAMP[1]));
    expect(out.keep.has(1)).toBe(true);
    expect(marches(out.commands).flatMap(ids)).not.toContain(1);
    expect(marches(out.commands).flatMap(ids).sort()).toEqual([2, 3]);
  });

  it('with it off the same view sends nobody ahead and the march takes all three', () => {
    const out = only({ scout: false })(view({ units: force }), ctx());
    expect(moves(out.commands)).toHaveLength(0);
    expect(marches(out.commands).flatMap(ids).sort()).toEqual([1, 2, 3]);
  });

  it('never sends its only unit', () => {
    const out = only({})(view({ units: [unit(1, [10, 41])] }), ctx());
    expect(moves(out.commands)).toHaveLength(0);
  });

  it('a scout under way is left alone; one that stopped short is sent again; one that arrived is not; it is kept in all three', () => {
    const c = only({});
    c(view({ units: force }), ctx()); // chooses unit 1
    const moving = c(view({ units: [unit(1, [20, 30], { type: 'at_team', flags: ['moving'] }), force[1], force[2]] }), ctx());
    expect(moves(moving.commands)).toHaveLength(0);
    expect(moving.keep.has(1)).toBe(true);
    const stopped = c(view({ units: [unit(1, [20, 30], { type: 'at_team', flags: ['idle'] }), force[1], force[2]] }), ctx());
    expect(moves(stopped.commands)).toHaveLength(1);
    const to = mkMove(moves(stopped.commands)[0]);
    const arrived = c(view({ units: [unit(1, to, { type: 'at_team', flags: ['idle'] }), force[1], force[2]] }), ctx());
    expect(moves(arrived.commands)).toHaveLength(0);
    expect(arrived.keep.has(1)).toBe(true);
    expect(marches(arrived.commands).flatMap(ids)).not.toContain(1);
  });

  it('is chosen once: when the scout dies nobody is sent in its place', () => {
    const c = only({});
    c(view({ units: force }), ctx());
    const after = c(view({ units: [force[1], force[2]] }), ctx());
    expect(moves(after.commands)).toHaveLength(0);
  });

  it('is decided at one decision only: a unit that arrives later is never picked, even if nobody could go at the start', () => {
    const c = only({});
    c(view({ units: [unit(1, [10, 41], { flags: ['moving'] }), unit(2, [11, 40], { flags: ['moving'] })] }), ctx()); // nobody idle at home
    expect(moves(c(view({ units: force }), ctx()).commands)).toHaveLength(0);
  });

  it('a scout that cannot move (it is idle on the tile it was last sent from) is not sent again; one that moved and stopped is', () => {
    const c = only({});
    c(view({ units: force }), ctx());
    const stuckAt = unit(1, [10, 41], { type: 'at_team' });
    expect(moves(c(view({ units: [stuckAt, force[1], force[2]] }), ctx()).commands)).toHaveLength(0);
  });

  it('nobody is sent when the camps are no further apart than the standoff', () => {
    const out = only({})(view({ units: force, enemyCamp: [CAMP[0] + 4, CAMP[1]] }), ctx());
    expect(moves(out.commands)).toHaveLength(0);
    expect(out.keep.size).toBe(0);
  });

  it('the scout is not a zone\'s holder: another idle unit standing in a held zone is kept for it', () => {
    const zoneAt = zone('held', [8, 36, 6, 8], 'mine');
    const out = only({ zones: true })(view({ units: force }), ctx([zoneAt]));
    expect(out.keep.has(1)).toBe(true); // the scout
    expect([...out.keep].filter((id) => id !== 1)).toHaveLength(1); // plus one real holder
  });

  it('is not recalled to defend: the defend march names the others', () => {
    const out = slice2({ zones: false, produce: false, counter: false })(view({ units: force, contacts: [contact(90, [12, 38])] }), ctx());
    expect(marches(out.commands).flatMap(ids).sort()).toEqual([2, 3]);
    expect(moves(out.commands)).toHaveLength(1);
  });

  it('reads nothing but the view: the order depends on the two camps and the units, never on a contact', () => {
    const a = only({})(view({ units: force }), ctx());
    const b = only({})(view({ units: force, contacts: [contact(90, [30, 30])] }), ctx());
    expect(moves(a.commands)).toEqual(moves(b.commands));
  });
});

describe('counter: build against what has been seen', () => {
  const start = [unit(1, [10, 41], { type: 'inf_squad' }), unit(2, [11, 40], { type: 'inf_squad' }), unit(3, [9, 39], { type: 'inf_squad' }), unit(4, [12, 41], { type: 'at_team' })];
  const o = { defend: false, zones: false, scout: false } as const;
  const sees = (types: string[]): ContactLine[] => types.map((t, i) => contact(100 + i, [30, 20 + i], t));
  const play = (c: ReturnType<typeof createSlice2>, contacts: ContactLine[], units = start): string[] => buildsOf(c(view({ units, contacts, economy: eco() }), ctx()).commands);

  it('slice 1 builds the type furthest below its start mix (the at_team, 1 of 1 over 3 of 3, is tied: menu order, so the squad); against seen armour it builds anti-armour', () => {
    expect(play(slice2({ ...o, counter: false }), sees(['mbt_lavi', 'mbt_lavi']))).toEqual(['inf_squad']);
    expect(play(slice2({ ...o }), sees(['mbt_lavi', 'mbt_lavi']))).toEqual(['at_team']);
  });

  it('against more soft than armour it builds an infantry-role unit, even when another type is further below its mix', () => {
    // Started with 1 squad and 3 AT teams; two AT teams are lost. Slice 1 rebuilds the AT team (1 of 3 over 1 of 1); three soft contacts seen, the counter builds the squad.
    const started = [unit(1, [10, 41], { type: 'inf_squad' }), unit(2, [10, 42], { type: 'at_team' }), unit(3, [11, 42], { type: 'at_team' }), unit(4, [12, 41], { type: 'at_team' })];
    const later = [started[0], started[1]];
    const soft = sees(['inf_squad', 'inf_squad', 'inf_squad']);
    const economy = eco({ menu: [menu('at_team', 100), menu('inf_squad', 150)] });
    for (const [counter, want] of [[false, 'at_team'], [true, 'inf_squad']] as const) {
      const c = slice2({ ...o, counter });
      c(view({ units: started, economy: eco({ lines: [] }) }), ctx());
      expect(buildsOf(c(view({ units: later, contacts: soft, economy }), ctx()).commands), `counter ${counter}`).toEqual([want]);
    }
  });

  it('nothing seen, or as much armour as soft: the slice 1 rule', () => {
    const eq = slice2({ ...o })(view({ units: start, contacts: sees(['mbt_lavi', 'inf_squad']), economy: eco({ menu: [menu('at_team', 100), menu('inf_squad', 150)] }) }), ctx());
    const none = slice2({ ...o })(view({ units: start, economy: eco({ menu: [menu('at_team', 100), menu('inf_squad', 150)] }) }), ctx());
    const slice1 = slice2({ ...o, counter: false })(view({ units: start, economy: eco({ menu: [menu('at_team', 100), menu('inf_squad', 150)] }) }), ctx());
    expect(buildsOf(eq.commands)).toEqual(buildsOf(slice1.commands));
    expect(buildsOf(none.commands)).toEqual(buildsOf(slice1.commands));
  });

  it('as much armour as soft: the armour is not countered either (a strict majority, not a tie)', () => {
    // Started with 3 squads and 1 AT team; two squads are lost. Slice 1 rebuilds a squad (1 of 3 over 1 of 1). Two hulls and two soft units seen: a tie.
    const started = [unit(1, [10, 41], { type: 'inf_squad' }), unit(2, [10, 42], { type: 'inf_squad' }), unit(3, [11, 42], { type: 'inf_squad' }), unit(4, [12, 41], { type: 'at_team' })];
    const later = [started[0], started[3]];
    const economy = eco({ menu: [menu('at_team', 100), menu('inf_squad', 150)] });
    const c = slice2({ ...o });
    c(view({ units: started, economy: eco({ lines: [] }) }), ctx());
    const tie = c(view({ units: later, contacts: sees(['mbt_lavi', 'mbt_lavi', 'inf_squad', 'inf_squad']), economy }), ctx());
    expect(buildsOf(tie.commands)).toEqual(['inf_squad']);
  });

  it('soft parity: once the seat has as many infantry as soft units seen at once, the slice 1 rule is back', () => {
    const started = [unit(1, [10, 41], { type: 'inf_squad' }), unit(2, [10, 42], { type: 'at_team' }), unit(3, [11, 42], { type: 'at_team' }), unit(4, [12, 41], { type: 'at_team' })];
    const later = [started[0], started[1]];
    const economy = eco({ menu: [menu('at_team', 100), menu('inf_squad', 150)] });
    const c = slice2({ ...o });
    c(view({ units: started, economy: eco({ lines: [] }) }), ctx());
    expect(buildsOf(c(view({ units: later, contacts: sees(['inf_squad']), economy }), ctx()).commands)).toEqual(['at_team']); // 1 squad held, 1 soft seen: parity
    expect(buildsOf(c(view({ units: later, contacts: sees(['inf_squad', 'inf_squad']), economy }), ctx()).commands)).toEqual(['inf_squad']); // 2 soft seen: one short
  });

  it('remembers the most seen at once: the armour is still countered after it leaves sight', () => {
    const c = slice2({ ...o });
    c(view({ units: start, contacts: sees(['mbt_lavi', 'mbt_lavi']), economy: eco({ lines: [{ line: 0, alive: true, tile: [10, 40], building: null, progress: 0, secondsLeft: 0, contested: false, queued: ['inf_squad'], rally: null }] }) }), ctx());
    expect(play(c, [])).toEqual(['at_team']);
  });

  it('parity: one anti-armour unit for every armoured hull seen at once, counting what is queued; then back to the mix', () => {
    const c = slice2({ ...o });
    const queued = (q: string[]) => eco({ lines: [{ line: 0, alive: true, tile: [10, 40], building: null, progress: 0, secondsLeft: 0, contested: false, queued: q, rally: null }] });
    // seen 2 hulls; the force holds 1 at_team: one more is wanted.
    expect(buildsOf(c(view({ units: start, contacts: sees(['mbt_lavi', 'mbt_lavi']), economy: eco() }), ctx()).commands)).toEqual(['at_team']);
    // the line has an at_team queued: parity (2 of 2) is met, no build while the line is not empty (slice 1's one-waiting rule)
    expect(buildsOf(c(view({ units: start, economy: queued(['at_team']) }), ctx()).commands)).toEqual([]);
    // an empty line at parity: the slice 1 rule again, not another at_team
    const atTwo = [...start, unit(5, [12, 42], { type: 'at_team' })];
    expect(buildsOf(c(view({ units: atTwo, economy: eco() }), ctx()).commands)).toEqual(['inf_squad']);
  });

  it('picks the anti-armour round that beats the strongest plate seen (700 front: the 900 ATGM, not the 650 recoilless)', () => {
    const menuAt = eco({ menu: [menu('recoilless_team', 100), menu('atgm_cell', 150), menu('sarim_rifles', 90)] });
    const sarim = [unit(1, [10, 41], { type: 'sarim_rifles' }), unit(2, [11, 40], { type: 'sarim_rifles' })];
    expect(buildsOf(slice2({ ...o })(view({ units: sarim, contacts: sees(['mbt_lavi']), economy: menuAt }), ctx()).commands)).toEqual(['atgm_cell']);
    // against an APC (220 front) the cheaper 650 round beats it and is a candidate too: the furthest-below rule picks between them (menu order on a tie)
    expect(buildsOf(slice2({ ...o })(view({ units: sarim, contacts: sees(['apc_eitan']), economy: menuAt }), ctx()).commands)).toEqual(['recoilless_team']);
  });

  it('the round that beats the plate is unaffordable: the seat does what the slice 1 commander does with this purse, not buy the round that cannot penetrate', () => {
    const menuAt = (purse: number) => eco({ purse, menu: [menu('recoilless_team', 100), menu('atgm_cell', 150), menu('sarim_rifles', 90)] });
    // Started with 2 rifles and 1 recoilless; one rifle lost. Slice 1 rebuilds the rifles (1 of 2 over 1 of 1). Two hulls seen with a 700 front plate.
    const started = [unit(1, [10, 41], { type: 'sarim_rifles' }), unit(2, [11, 40], { type: 'sarim_rifles' }), unit(3, [12, 40], { type: 'recoilless_team' })];
    const later = [started[0], started[2]];
    const run = (counter: boolean, purse: number): string[] => {
      const c = slice2({ ...o, counter });
      c(view({ units: started, economy: eco({ lines: [] }) }), ctx());
      return buildsOf(c(view({ units: later, contacts: sees(['mbt_lavi', 'mbt_lavi']), economy: menuAt(purse) }), ctx()).commands);
    };
    expect(run(true, 1000)).toEqual(['atgm_cell']);
    expect(run(true, 120)).toEqual(['sarim_rifles']);
    expect(run(true, 120)).toEqual(run(false, 120));
  });

  it('counterPool: a held round that cannot beat the plate does not count toward parity; one that can does', () => {
    const peak = new Map([['mbt_lavi', 1]]);
    const menuAll = ['recoilless_team', 'atgm_cell', 'sarim_rifles'];
    const all = new Set(menuAll);
    expect([...(counterPool(menuAll, all, peak, new Map([['recoilless_team', 1]])) ?? [])]).toEqual(['atgm_cell']);
    expect(counterPool(menuAll, all, peak, new Map([['atgm_cell', 1]]))).toBeNull();
  });

  it('counterPool: when no round in the menu beats the plate, the strongest the menu has is the pool (a weaker hit is still a hit)', () => {
    const peak = new Map([['mbt_lavi', 1]]);
    const menuAll = ['recoilless_team', 'rpg_team', 'sarim_rifles']; // 650 and 550 against 700
    expect([...(counterPool(menuAll, new Set(menuAll), peak, new Map()) ?? [])]).toEqual(['recoilless_team']);
  });

  it('a menu with no anti-armour unit falls through to the slice 1 rule, and so does a menu with no infantry against soft', () => {
    const noAt = eco({ menu: [menu('inf_squad', 100), menu('mortar_team', 100)] });
    expect(buildsOf(slice2({ ...o })(view({ units: start, contacts: sees(['mbt_lavi']), economy: noAt }), ctx()).commands)).toEqual(buildsOf(slice2({ ...o, counter: false })(view({ units: start, economy: noAt }), ctx()).commands));
    const noInf = eco({ menu: [menu('at_team', 100), menu('mortar_team', 100)] });
    const lost = [unit(4, [12, 41], { type: 'at_team' })];
    expect(buildsOf(slice2({ ...o })(view({ units: lost, contacts: sees(['inf_squad', 'inf_squad']), economy: noInf }), ctx()).commands)).toEqual(buildsOf(slice2({ ...o, counter: false })(view({ units: lost, economy: noInf }), ctx()).commands));
  });

  it('an unarmed contact and an aircraft count toward neither side', () => {
    const c = slice2({ ...o });
    const menuTwo = eco({ menu: [menu('at_team', 100), menu('inf_squad', 150)] });
    const slice1 = slice2({ ...o, counter: false })(view({ units: start, economy: menuTwo }), ctx());
    const out = c(view({ units: start, contacts: sees(['recon_drone', 'recon_drone', 'heli_peten']), economy: menuTwo }), ctx());
    expect(buildsOf(out.commands)).toEqual(buildsOf(slice1.commands));
  });
});

// ---- slice 3: retreat ---------------------------------------------------------------------------------------------------------------

describe('retreat: a losing group walks home, regroups, and is let go again', () => {
  const retreat = (o: CommanderOptions = {}) => createSlice2({ scout: false, counter: false, retreat: true, zones: false, produce: false, ...o });
  const away = (id: number, o: { hp?: number; flags?: string[]; type?: string } = {}) => unit(id, [20, 30], { flags: ['moving'], ...o });
  /** Squads far from the fight, on the move: they are what the group would be joined by, and nothing is ordered of them. */
  const reserve = (n: number): UnitLine[] => Array.from({ length: n }, (_, i) => unit(60 + i, [40 + i, 40], { flags: ['moving'] }));
  const tanks = (n: number, hp = 100): ContactLine[] => Array.from({ length: n }, (_, i) => contact(90 + i, [22, 30 + (i % 3)], 'mbt_lavi', hp));

  it('an engaged group worth less than the foe in its face is sent home with a move (not an attack-move), and kept out of the march and the sweep', () => {
    const squad = [away(1), away(2)];
    const out = retreat()(view({ units: [...squad, ...reserve(5)], contacts: tanks(2) }), ctx());
    const m = moves(out.commands);
    expect(m).toHaveLength(1);
    expect([...m[0].ids].sort()).toEqual([1, 2]);
    expect(mkMove(m[0])).toEqual(CAMP);
    expect(marches(out.commands)).toHaveLength(0);
    expect([...out.keep].sort()).toEqual([1, 2]);
  });

  it('a group with nothing to join fights on: walking home to the same strength only gives up its shots', () => {
    const out = retreat()(view({ units: [away(1), away(2)], contacts: tanks(2) }), ctx());
    expect(moves(out.commands)).toHaveLength(0);
  });

  it('units standing at home are what a retreating group joins: the same group retreats with squads waiting at the camp', () => {
    const waiting = [unit(70, [10, 41], { flags: ['idle'] }), unit(71, [11, 40], { flags: ['idle'] }), unit(72, [9, 39], { flags: ['idle'] })];
    const out = retreat({ defend: false })(view({ units: [away(1), away(2), ...waiting], contacts: tanks(1) }), ctx());
    expect(moves(out.commands).flatMap(ids).sort()).toEqual([1, 2]);
  });

  it('what the camps are building counts as joining: the same group retreats when a unit is queued and enough is in the line, not when it is not enough', () => {
    const line = (queued: string[], building: string | null = null) => eco({ lines: [{ line: 0, alive: true, tile: [10, 40], building, progress: 0, secondsLeft: 10, contested: false, queued, rally: null }] });
    const squad = [away(1), away(2)];
    // foe: 1 tank = 906 x 100; own = 2 squads = 584 x 100; a queued mbt_lavi (906) joins, a queued squad (292) does not tip it
    expect(moves(retreat()(view({ units: squad, contacts: tanks(1), economy: line(['inf_squad']) }), ctx()).commands)).toHaveLength(0);
    expect(moves(retreat()(view({ units: squad, contacts: tanks(1), economy: line(['inf_squad'], 'inf_squad') }), ctx()).commands)).toHaveLength(1);
  });

  it('a group worth at least the foe fights on: nothing is sent home (a tie is not a loss)', () => {
    const squad = [away(1), away(2), away(3)];
    const out = retreat()(view({ units: [...squad, ...reserve(2)], contacts: [contact(90, [22, 30], 'inf_squad'), contact(91, [22, 31], 'inf_squad'), contact(92, [22, 32], 'inf_squad')] }), ctx());
    expect(moves(out.commands)).toHaveLength(0);
  });

  it('is weighed by hp on both sides: the same two squads at 20% lose to two squads at 100%, and win against two at 10%', () => {
    const hurt = [away(1, { hp: 20 }), away(2, { hp: 20 })];
    const two = (hp: number) => [contact(90, [22, 30], 'inf_squad', hp), contact(91, [22, 31], 'inf_squad', hp)];
    expect(moves(retreat()(view({ units: [...hurt, ...reserve(5)], contacts: two(100) }), ctx()).commands)).toHaveLength(1);
    expect(moves(retreat()(view({ units: hurt, contacts: two(10) }), ctx()).commands)).toHaveLength(0);
  });

  it('only units away from home that have a contact near them are engaged: a unit at home, and one with no contact within the radius, are not sent', () => {
    const units = [away(1), unit(2, [11, 40], { flags: ['idle'] }), unit(3, [40, 40], { flags: ['moving'] })];
    const out = retreat()(view({ units: [...units, ...reserve(5)], contacts: tanks(2) }), ctx());
    expect(moves(out.commands).flatMap(ids)).toEqual([1]);
  });

  it('a fight at the camp is not retreated from: units at home are never engaged, whatever stands before them', () => {
    const atCamp = [unit(1, [11, 40], { flags: ['moving'] }), unit(2, [12, 41], { flags: ['moving'] })];
    const out = retreat()(view({ units: [...atCamp, ...reserve(9)], contacts: [contact(90, [15, 40], 'mbt_lavi'), contact(91, [15, 41], 'mbt_lavi'), contact(92, [15, 42], 'mbt_lavi')] }), ctx());
    expect(moves(out.commands)).toHaveLength(0);
  });

  it('only the foe in the face of the group counts: tanks seen far away do not make a winning fight a losing one', () => {
    const squad = [away(1), away(2), away(3)];
    const near = [contact(90, [22, 30], 'inf_squad'), contact(91, [22, 31], 'inf_squad')];
    const far = [contact(95, [45, 5], 'mbt_lavi'), contact(96, [45, 6], 'mbt_lavi'), contact(97, [45, 7], 'mbt_lavi')];
    expect(moves(retreat()(view({ units: [...squad, ...reserve(9)], contacts: [...near, ...far] }), ctx()).commands)).toHaveLength(0);
  });

  it('a contact beyond the radius of every unit is no fight', () => {
    const out = retreat()(view({ units: [away(1), away(2)], contacts: [contact(90, [20 + RUSH_HOME_TILES + 3, 30], 'mbt_lavi')] }), ctx());
    expect(moves(out.commands)).toHaveLength(0);
  });

  it('the scout is never pulled back by it', () => {
    const scouting = createSlice2({ scout: true, counter: false, retreat: true, zones: false, produce: false, defend: false });
    const home3 = [unit(1, [10, 41], { type: 'at_team' }), unit(2, [11, 40]), unit(3, [9, 39], { type: 'mortar_team' })];
    scouting(view({ units: home3 }), ctx()); // chooses unit 1
    const out = scouting(view({ units: [away(1, { type: 'at_team' }), away(2), ...reserve(5)], contacts: tanks(2) }), ctx());
    expect(moves(out.commands).flatMap(ids)).toEqual([2]);
  });

  it('retreating units are held out of the march while on their way and at home, and released when what stands at home is worth the foe that beat them', () => {
    const c = retreat();
    const squad = [away(1), away(2), unit(3, [40, 40], { flags: ['moving'] }), unit(4, [41, 40], { flags: ['moving'] })]; // 3 and 4 are far from the fight
    c(view({ units: squad, contacts: tanks(1) }), ctx()); // beaten by one tank (906 x 100 > 2 x 292 x 100)
    // on their way: kept
    const way = c(view({ units: [away(1), away(2), squad[2], squad[3]] }), ctx());
    expect([...way.keep].sort()).toEqual([1, 2]);
    // home, with too little standing there and a purse coming (queue pending): held
    const economy = eco({ lines: [{ line: 0, alive: true, tile: [10, 40], building: 'inf_squad', progress: 0, secondsLeft: 10, contested: false, queued: [], rally: null }] });
    const homeTwo = [unit(1, [10, 41], { flags: ['idle'] }), unit(2, [11, 40], { flags: ['idle'] })];
    const held = c(view({ units: homeTwo, economy }), ctx());
    expect([...held.keep].sort()).toEqual([1, 2]);
    expect(marches(held.commands)).toHaveLength(0);
    // a third and a fourth arrive (4 x 292 > 906): released, and the march takes them all
    const homeFour = [...homeTwo, unit(3, [9, 40], { flags: ['idle'] }), unit(4, [10, 42], { flags: ['idle'] })];
    const freed = c(view({ units: homeFour, economy }), ctx());
    expect(freed.keep.size).toBe(0);
    expect(marches(freed.commands).flatMap(ids).sort()).toEqual([1, 2, 3, 4]);
  });

  it('a retreating unit still moving inside the home radius has not arrived: it stays held', () => {
    const c = retreat();
    c(view({ units: [away(1), away(2), ...reserve(5)], contacts: tanks(1) }), ctx());
    const out = c(view({ units: [unit(1, [12, 38], { flags: ['moving'] }), unit(2, [13, 38], { flags: ['moving'] })] }), ctx());
    expect([...out.keep].sort()).toEqual([1, 2]);
  });

  it('a contact within DEFEND_TILES of the camp releases them to defend it', () => {
    const c = retreat();
    c(view({ units: [away(1), away(2), ...reserve(5)], contacts: tanks(1) }), ctx());
    const economy = eco({ lines: [{ line: 0, alive: true, tile: [10, 40], building: 'inf_squad', progress: 0, secondsLeft: 10, contested: false, queued: [], rally: null }] });
    const homeTwo = [unit(1, [10, 41], { flags: ['idle'] }), unit(2, [11, 40], { flags: ['idle'] })];
    const out = c(view({ units: homeTwo, contacts: [contact(90, [14, 40], 'mbt_lavi')], economy }), ctx());
    expect(out.keep.size).toBe(0);
    expect(marches(out.commands).flatMap(ids).sort()).toEqual([1, 2]);
  });

  it('with nothing queued or building that could add to them (a room with no economy) they are released the moment they are home', () => {
    const c = retreat();
    c(view({ units: [away(1), away(2), ...reserve(5)], contacts: tanks(1) }), ctx());
    const homeTwo = [unit(1, [10, 41], { flags: ['idle'] }), unit(2, [11, 40], { flags: ['idle'] })];
    const out = c(view({ units: homeTwo }), ctx());
    expect(out.keep.size).toBe(0);
  });

  it('one that stopped short of home is given back to the march, not held for ever', () => {
    const c = retreat();
    c(view({ units: [away(1), away(2), ...reserve(5)], contacts: tanks(1) }), ctx());
    const out = c(view({ units: [unit(1, [18, 33], { flags: ['idle'] }), away(2)] }), ctx());
    expect(out.keep.has(1)).toBe(false);
    expect(out.keep.has(2)).toBe(true);
  });

  it('is off by default: the same view sends nobody home', () => {
    const out = createSlice2({ scout: false, counter: false, zones: false, produce: false })(view({ units: [away(1), away(2), ...reserve(5)], contacts: tanks(2) }), ctx());
    expect(moves(out.commands)).toHaveLength(0);
  });

  it('a unit that dies while retreating is forgotten', () => {
    const c = retreat();
    c(view({ units: [away(1), away(2), ...reserve(5)], contacts: tanks(1) }), ctx());
    const out = c(view({ units: [away(2)] }), ctx());
    expect([...out.keep]).toEqual([2]);
  });
});
