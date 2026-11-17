/**
 * GH-1391 slice 1: the commander. Fixture views for each task (defend, zones, production, the guard, the march) and the seat's use of it. The scenarios
 * that play a real room (each behaviour removed changes the result) are in `tools/src/backtest/commander-scenarios.test.ts`. Every check here was
 * seen red under the one-line mutations listed in the commit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Command } from '@lions/sim';
import { DEFEND_TILES, createCommander, type CommanderContext, type ZoneFact } from './commander';
import { ComputerSeat, sweepStragglers } from './computer-seat';
import { RUSH_HOME_TILES } from './policy';
import { zoneFacts } from './zones';
import type { EconomyView, MenuLine } from './economy-view';
import type { SideView, UnitLine, ContactLine } from './view';

const CAMP: [number, number] = [10, 40];
const ENEMY_CAMP: [number, number] = [40, 8];

const unit = (id: number, tile: [number, number], o: { flags?: string[]; type?: string } = {}): UnitLine => ({ id, type: o.type ?? 'inf_squad', tile, hp: 100, flags: o.flags ?? ['idle'], stance: 'free' });
const contact = (id: number, tile: [number, number]): ContactLine => ({ id, type: 'rifle', tile, hp: 100, inSight: true, seenTick: 0 });
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

  it('passes over a unit the room would refuse now, one it cannot afford, and one that carries no weapon', () => {
    const c = createCommander({ zones: false, defend: false });
    const e = eco({ purse: 120, menu: [menu('at_team', 150), menu('inf_medic_squad', 50), menu('mbt_lavi', 100, 'population cap'), menu('inf_squad', 100)] });
    const out = c(view({ units: army(1, 'at_team'), economy: e }), ctx());
    expect(out.commands.filter((x) => x.kind === 'build')).toEqual([{ kind: 'build', side: 0, unit: 'inf_squad', line: 0 }]);
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

  it('the zone board is public data from the runtime: holder by this side\'s chair, contested apart, never a unit', () => {
    const runtime = { incomeZones: [
      { zone: 'a', rect: [1, 2, 3, 4], state: 0, holder: 0, ratePerMin: 40 },
      { zone: 'b', rect: [5, 6, 7, 8], state: 1, holder: 1, ratePerMin: 20 },
      { zone: 'c', rect: [9, 10, 11, 12], state: -2, holder: -1, ratePerMin: 20 },
      { zone: 'd', rect: [13, 14, 15, 16], state: -1, holder: -1, ratePerMin: 20 },
    ] } as never;
    expect(zoneFacts({ runtime }, 0).map((z) => z.holder)).toEqual(['mine', 'theirs', 'contested', 'none']);
    expect(zoneFacts({ runtime }, 1).map((z) => z.holder)).toEqual(['theirs', 'mine', 'contested', 'none']);
    expect(zoneFacts({ runtime: null }, 0)).toEqual([]);
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
