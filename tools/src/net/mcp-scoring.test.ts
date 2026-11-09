// GH-973: the two scoring tools a `pnpm bot` seat is given, `match_stats` and
// `submit_score`. A stand-in client (no room, no model): what matters here is
// WHEN they answer (never before a result: the referee's numbers cover both
// sides), what they refuse, and what reaches the score file.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TransportStatus } from '@lions/net';
import type { AgentClient } from './agent-client';
import { RefereeTally, validateScores, type RefereeStats } from './match-score';
import { delPath, loose, setPath, validScores } from './score-fixture';
import { createContext, toolsFor, TOOLS, type ToolContext, type ToolResult } from './mcp-tools';
import { versusConfig } from './test-config';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true }); });

const stats = (): RefereeStats => new RefereeTally().stats(buildMatchWorld(versusConfig('tel_marum')).sim, { map: 'tel_marum', sides: [0, 1], factions: ['kdf', 'kdf'], result: 'seat 1 won (annihilation)' });

interface Fake { over: boolean; status: TransportStatus; started: boolean }
function ctxOf(f: Fake, withFile = true): { ctx: ToolContext; file: string } {
  const d = mkdtempSync(join(tmpdir(), 'mcp-scoring-'));
  dirs.push(d);
  const file = join(d, 'scores.json');
  const client = {
    seat: 1,
    config: () => (f.started ? versusConfig('tel_marum') : null),
    result: () => (f.over ? { kind: 'won', side: 1, by: 'annihilation' } : null),
    tick: () => 812,
    transport: { status: () => f.status, behind: () => 0 },
    joinedUnderway: () => false,
    refereeStats: () => (f.started ? stats() : null),
    view: () => ({ clock: '00:40', result: f.over ? 'won (annihilation)' : null }),
  } as unknown as AgentClient;
  const ctx = createContext(Object.assign(client, { transport: Object.assign(client.transport, { setHooks: () => {} }) }) as AgentClient, 'command');
  if (withFile) ctx.scoreFile = file;
  return { ctx, file };
}
const open = { kind: 'open' } as unknown as TransportStatus;
const run = async (ctx: ToolContext, name: string, args: unknown = {}): Promise<ToolResult> => {
  const t = TOOLS.find((x) => x.name === name);
  if (t === undefined) throw new Error(`no tool ${name}`);
  return t.run(ctx, args);
};
type Body = { error?: string; accepted?: boolean; problems?: string[]; format?: string; seat?: number; glossary?: string; stats: { seats: { seat: number }[]; result: string } };
const body = (r: ToolResult): Body => JSON.parse(r.text) as Body;

const good = () => loose(validScores(7, 5));

describe('which seats are given the scoring tools', () => {
  it('only a scoring seat (the harness started with --score-file); the arena\'s players are judged by a third model', () => {
    const names = (scoring: boolean): string[] => toolsFor('command', { scoring }).map((t) => t.name).sort();
    expect(names(false)).toEqual(['end_round', 'inbox', 'observe', 'order', 'say', 'status', 'wait']);
    expect(names(true)).toEqual(['end_round', 'inbox', 'match_stats', 'observe', 'order', 'say', 'status', 'submit_score', 'wait']);
    expect(toolsFor('command').map((t) => t.name)).not.toContain('submit_score');
    expect(toolsFor('assist', { scoring: true }).map((t) => t.name)).not.toContain('match_stats');
    expect(toolsFor('advise', { scoring: true }).map((t) => t.name)).not.toContain('submit_score');
  });
  it('a harness without --score-file refuses them even if a server registered them', async () => {
    const { ctx } = ctxOf({ over: true, status: open, started: true }, false);
    expect((await run(ctx, 'match_stats')).ok).toBe(false);
    expect(body(await run(ctx, 'match_stats')).error).toBe('not in this scope');
    expect(body(await run(ctx, 'submit_score', good())).error).toBe('not in this scope');
  });
});

describe('match_stats', () => {
  it('answers `match not over` while the match runs: the referee\'s numbers would see through the fog', async () => {
    const { ctx } = ctxOf({ over: false, status: open, started: true });
    const r = await run(ctx, 'match_stats');
    expect(r.ok).toBe(false);
    expect(body(r).error).toBe('match not over');
    expect(r.text).not.toContain('seats');
  });
  it('before the match has started it is `match not started`', async () => {
    const { ctx } = ctxOf({ over: false, status: open, started: false });
    expect(body(await run(ctx, 'match_stats')).error).toBe('match not started');
  });
  it('once there is a result it gives both seats\' numbers and what they mean', async () => {
    const { ctx } = ctxOf({ over: true, status: open, started: true });
    const r = await run(ctx, 'match_stats');
    expect(r.ok).toBe(true);
    const b = body(r);
    expect(b.stats.seats).toHaveLength(2);
    expect(b.stats.seats[0].seat).toBe(0);
    expect(b.stats.result).toBe('seat 1 won (annihilation)');
    expect(b.glossary).toContain('woundedRescued');
    expect(b.seat).toBe(1);
  });
});

describe('submit_score', () => {
  it('refuses before the result and writes nothing', async () => {
    const { ctx, file } = ctxOf({ over: false, status: open, started: true });
    const r = await run(ctx, 'submit_score', good());
    expect(body(r).error).toBe('match not over');
    expect(existsSync(file)).toBe(false);
  });
  it('accepts a valid score and leaves the stats and the scores in the 0600 score file', async () => {
    const { ctx, file } = ctxOf({ over: true, status: open, started: true });
    const r = await run(ctx, 'submit_score', good());
    expect(r.ok).toBe(true);
    expect(body(r).accepted).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const f = JSON.parse(readFileSync(file, 'utf8')) as { seat: number; submittedTick: number; referee: { seats: unknown[] }; scores: unknown };
    expect(f.seat).toBe(1);
    expect(f.submittedTick).toBe(812);
    expect(f.referee.seats).toHaveLength(2);
    expect(validateScores(f.scores).ok).toBe(true);
  });
  it('refuses an invalid score with EVERY problem, the rubric and the format, and writes nothing', async () => {
    const { ctx, file } = ctxOf({ over: true, status: open, started: true });
    const bad = delPath(setPath(setPath(good(), 'seat0.criteria.adaptation.score', 11), 'seat1.overall.reason', 'two\nlines'), 'seat1.criteria.fewer_deaths');
    const r = await run(ctx, 'submit_score', bad);
    expect(r.ok).toBe(false);
    const b = body(r);
    expect(b.error).toBe('invalid');
    expect(b.problems).toHaveLength(3);
    expect(b.problems).toContain('seat0.criteria.adaptation.score is 11, outside 1-10');
    expect(b.format).toContain('"seat0"');
    expect(existsSync(file)).toBe(false);
  });
  it('a later valid submission replaces an earlier one, and an invalid one after it leaves it alone', async () => {
    const { ctx, file } = ctxOf({ over: true, status: open, started: true });
    await run(ctx, 'submit_score', good());
    const saved = (): number => (JSON.parse(readFileSync(file, 'utf8')) as { scores: { seat0: { overall: { score: number } } } }).scores.seat0.overall.score;
    await run(ctx, 'submit_score', setPath(good(), 'seat0.overall.score', 9));
    expect(saved()).toBe(9);
    expect((await run(ctx, 'submit_score', setPath(good(), 'seat0.overall.score', 0))).ok).toBe(false);
    expect(saved()).toBe(9);
  });
  it('says so when the file cannot be written, and does not claim it was accepted', async () => {
    const { ctx } = ctxOf({ over: true, status: open, started: true });
    ctx.scoreFile = join(tmpdir(), 'no-such-dir-for-scores', 'x', 'scores.json');
    const r = await run(ctx, 'submit_score', good());
    expect(r.ok).toBe(false);
    expect(body(r).error).toBe('not saved');
  });
  it('a closed room is over too: scoring still works after the room has ended', async () => {
    const { ctx } = ctxOf({ over: false, status: { kind: 'closed', reason: 'over' } as TransportStatus, started: true });
    expect((await run(ctx, 'match_stats')).ok).toBe(true);
  });
});
