import { describe, expect, it } from 'vitest';
import { FakeState } from '../../../packages/worker/src/match/fake-do';
import { countRows, heavyPolicy, judge, logStats, parseArgs, realTimeRows, rowBounds, watchdogRowsReal, type Measured } from './budget-measure';

// GH-913 L8: the parts of `pnpm net:budget` that need no match. The numbers are LITERALS from design section 4
// (`_coord/net-large-map/design.md`): 72 rows a minute idle, 132 busy, +1 for the snapshot; a 2,000,000-character
// command log at 25 minutes, 2,800,000 at 35.

const base = (over: Partial<Measured> = {}): Measured => ({
  map: 'rujm_sawda', capTicks: 42_000, ticks: 42_000,
  rows: { total: 3000, batch: 2800, snapshot: 35, alarm: 100, state: 65 },
  wallSeconds: 120, cmdChars: 1_000_000, commands: 8000, storedChars: 3_000_000,
  snapshot: { tick: 40_800, bytes: 12_000 }, snapshotSizes: [11_000, 12_000],
  endSnapshot: { raw: 380_000, gzip: 12_000 }, result: 'draw (time)', policy: { calls: 1, orders: 1, units: 1 }, playerErrors: [],
  ...over,
});

describe('rowBounds: design section 4, the 35-minute column', () => {
  it('is 2,555 idle and 4,655 busy at 35 minutes, 1,825 and 3,325 at 25', () => {
    expect(rowBounds(35)).toEqual({ idle: 2555, busy: 4655 });
    expect(rowBounds(25)).toEqual({ idle: 1825, busy: 3325 });
  });
});

describe('the real-time watchdog figure', () => {
  it('swaps the wall-clock alarm rows for one every 5 s of GAME time', () => {
    expect(watchdogRowsReal(2100)).toBe(420);
    expect(realTimeRows(base())).toBe(3000 - 100 + 420);
  });
});

describe('judge', () => {
  it('passes a heavy 35-minute match inside every bound', () => {
    const v = judge(base(), { heavy: true });
    expect(v.failures).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it('the command-log cap is the MAP\'s: 2.1 MB is over the 25-minute figure and inside the 35-minute one', () => {
    expect(judge(base({ cmdChars: 2_100_000 }), { heavy: true }).failures).toEqual([]);
    // the same load on a 25-minute map breaches it
    const short = judge(base({ map: 'wadi_tarfan', capTicks: 30_000, ticks: 30_000, cmdChars: 2_100_000 }), { heavy: true });
    expect(short.failures.join('|')).toMatch(/exceed the cap 2000000/);
  });
  it('fails a log within 10% of the cap, rows over the busy bound, an oversize snapshot and a heavy play with no commands', () => {
    expect(judge(base({ cmdChars: 2_600_000 }), { heavy: true }).failures.join('|')).toMatch(/over 90%/);
    expect(judge(base({ rows: { total: 6000, batch: 5800, snapshot: 35, alarm: 0, state: 65 } }), { heavy: true }).failures.join('|')).toMatch(/exceed the busy bound 4655/);
    expect(judge(base({ snapshotSizes: [70_000] }), { heavy: true }).failures.join('|')).toMatch(/compressed cap/);
    expect(judge(base({ endSnapshot: { raw: 2_000_000, gzip: 1000 } }), { heavy: true }).failures.join('|')).toMatch(/raw/);
    expect(judge(base({ commands: 0, cmdChars: 0 }), { heavy: true }).failures.join('|')).toMatch(/sent no commands/);
  });
  it('a run to the map\'s cap must stop on the cap tick and decide on time', () => {
    expect(judge(base({ ticks: 30_000 }), { heavy: true }).failures.join('|')).toMatch(/ran to tick 30000, not its cap 42000/);
    expect(judge(base({ result: 'side 0 won (annihilation)' }), { heavy: true }).failures.join('|')).toMatch(/not a decision on time/);
    // a real battle may end early (the `rush` play); the rest of its numbers are still judged
    expect(judge(base({ ticks: 3000, result: 'side 1 won (annihilation)' }), { heavy: false, mayEndEarly: true }).failures).toEqual([]);
    expect(judge(base({ ticks: 3000, result: 'side 1 won (annihilation)', cmdChars: 2_700_000 }), { heavy: false, mayEndEarly: true }).failures.join('|')).toMatch(/over 90%/);
    // a shorter run (a cap override) is not held to the cap
    expect(judge(base({ capTicks: 2400, ticks: 2400 }), { heavy: true }).failures).toEqual([]);
  });
});

describe('logStats', () => {
  it('counts every command and its JSON characters across batches', () => {
    const cmd = { kind: 'halt', ids: [1, 2] };
    const frames = JSON.stringify([{ tick: 0, cmds: [{ seat: 0, seq: 0, cmd }] }, { tick: 1, cmds: [] }]);
    const s = logStats(new Map([[0, frames], [20, JSON.stringify([{ tick: 20, cmds: [{ seat: 1, seq: 0, cmd }, { seat: 0, seq: 1, cmd }] }])]]));
    expect(s.commands).toBe(3);
    expect(s.cmdChars).toBe(3 * JSON.stringify(cmd).length);
    expect(s.storedChars).toBeGreaterThan(s.cmdChars);
  });
});

describe('countRows', () => {
  it('files each write path under its kind and agrees with the storage meter', async () => {
    const state = new FakeState();
    const c = countRows(state);
    await state.storage.put('k', 1);
    await state.storage.setAlarm(5);
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS batch (first_tick INTEGER PRIMARY KEY, frames TEXT NOT NULL)');
    state.storage.sql.exec('INSERT OR REPLACE INTO batch (first_tick, frames) VALUES (?, ?)', 0, '[]');
    state.storage.sql.exec('INSERT OR REPLACE INTO batch (first_tick, frames) VALUES (?, ?)', 20, '[]');
    expect(c.read()).toEqual({ total: 4, batch: 2, snapshot: 0, alarm: 1, state: 1 });
    expect(c.read().total).toBe(state.storage.rowsWritten);
  });
});

describe('heavyPolicy', () => {
  const view = (n: number): never => ({ camp: [8, 8], units: Array.from({ length: n }, (_, i) => ({ id: i + 10 })) }) as never;
  it('returns perRound moves of at most `ids` of the seat\'s own units, each different', async () => {
    const p = heavyPolicy(30, 4);
    const out = await p(view(50));
    expect(out).toHaveLength(4);
    for (const c of out) expect(c.kind === 'move' && c.ids.length).toBe(30);
    expect(new Set(out.map((c) => JSON.stringify(c))).size).toBe(4);
    const small = await heavyPolicy(30, 1)(view(12));
    expect(small[0].kind === 'move' && small[0].ids.length).toBe(12);
    expect(await p(view(0))).toEqual([]);
  });
});

describe('parseArgs', () => {
  it('defaults to the map\'s own cap: 42,000 ticks on rujm_sawda, 30,000 elsewhere', () => {
    expect(parseArgs([])).toMatchObject({ map: 'rujm_sawda', capTicks: 42_000, play: 'heavy' });
    expect(parseArgs(['--map=tel_marum'])).toMatchObject({ capTicks: 30_000 });
    expect(parseArgs(['--play=boom'])).toHaveProperty('error');
    expect(parseArgs(['--pace=5'])).toHaveProperty('error');
  });
});
