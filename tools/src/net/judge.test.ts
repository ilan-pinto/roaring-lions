// GH-973: the arena's judge. No test here runs a model or the real `claude`: the
// judge is an injected SpawnFn returning a fake child, or a tiny node script
// (the "real process" case) that reads the prompt and answers a literal.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SpawnFn } from './external-player';
import { JUDGE_PLACEHOLDERS, runJudge, type JudgeJob } from './judge';
import { RefereeTally, type RefereeStats } from './match-score';
import { delPath, setPath, validScores, loose } from './score-fixture';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import { versusConfig } from './test-config';

let root = '';
const saved = process.env.LIONS_ARENA_TMPDIR;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'judge-test-')); process.env.LIONS_ARENA_TMPDIR = root; });
afterEach(() => {
  if (saved === undefined) delete process.env.LIONS_ARENA_TMPDIR; else process.env.LIONS_ARENA_TMPDIR = saved;
  rmSync(root, { recursive: true, force: true });
});
const leftovers = (): string[] => readdirSync(root);

const stats = (): RefereeStats => new RefereeTally().stats(buildMatchWorld(versusConfig('tel_marum')).sim, { map: 'tel_marum', sides: [0, 1], factions: ['kdf', 'kdf'], result: 'seat 0 (rush) won (cap)' });

const verdict = (a = 7, b = 3): string => JSON.stringify(validScores(a, b));
const resultLine = (text: string, extra: Record<string, unknown> = {}): string => `${JSON.stringify({ type: 'result', is_error: false, result: text, usage: { input_tokens: 120, output_tokens: 30 }, ...extra })}\n`;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kills: (NodeJS.Signals | number | undefined)[] = [];
  gone = false;
  obeysTerm = true;
  kill(sig?: NodeJS.Signals | number): boolean {
    this.kills.push(sig);
    if ((sig === 'SIGTERM' && this.obeysTerm) || sig === 'SIGKILL') this.end(null, sig as NodeJS.Signals);
    return true;
  }
  end(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.gone) return;
    this.gone = true;
    this.emit('exit', code, signal);
    this.stdout.end();
    this.stderr.end();
    this.emit('close', code, signal);
  }
}
interface Call { command: string; args: readonly string[]; options: SpawnOptions; child: FakeChild; dirEntries: string[]; prompt: string; stats: string }
function fakeSpawn(calls: Call[], script: (c: FakeChild, call: Call) => void, startError?: Error): SpawnFn {
  return (command, args, options) => {
    const child = new FakeChild();
    const dir = options.cwd as string;
    const call: Call = {
      command, args, options, child,
      dirEntries: readdirSync(dir).sort(),
      prompt: existsSync(join(dir, 'prompt.md')) ? readFileSync(join(dir, 'prompt.md'), 'utf8') : '',
      stats: existsSync(join(dir, 'stats.json')) ? readFileSync(join(dir, 'stats.json'), 'utf8') : '',
    };
    calls.push(call);
    queueMicrotask(() => {
      if (startError !== undefined) { child.emit('error', startError); return; }
      child.emit('spawn');
      script(child, call);
    });
    return child as unknown as ChildProcess;
  };
}
const job = (spawn: SpawnFn, o: Partial<JudgeJob> = {}): JudgeJob => ({
  template: 'cmd:judge-cli -p --output-format json < {prompt}', stats: stats(), players: ['rush', 'passive'], outcome: 'seat 0 (rush) won (cap)', timeoutMs: 5000, killMs: 20, spawn, ...o,
});

describe('the judge process', () => {
  it('runs the template without a shell, in its own 0700 directory of 0600 files, prompt as stdin, environment untouched, and removes it', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(calls, (c, call) => {
      expect(statSync(call.options.cwd as string).mode & 0o777).toBe(0o700);
      expect(statSync(join(call.options.cwd as string, 'prompt.md')).mode & 0o777).toBe(0o600);
      expect(statSync(join(call.options.cwd as string, 'stats.json')).mode & 0o777).toBe(0o600);
      c.stdout.write(resultLine(verdict()));
      c.end(0);
    });
    const r = await runJudge(job(spawn));
    expect(r.status).toBe('scored');
    if (r.status === 'scored') {
      expect(r.scores.seat0.overall.score).toBe(7);
      expect(r.scores.seat1.overall.score).toBe(3);
      expect(r.tokens).toBe(150);
    }
    const [call] = calls;
    expect(call.command).toBe('judge-cli');
    expect(call.args).toEqual(['-p', '--output-format', 'json']);
    expect(call.options.shell).toBe(false);
    expect(call.options.env).toBe(process.env);
    expect(typeof (call.options.stdio as unknown[])[0]).toBe('number');
    expect(call.dirEntries).toEqual(['prompt.md', 'stats.json']);
    // The prompt carries the stats and the rubric; the stats file is the same stats alone.
    expect(call.prompt).toContain(JSON.stringify(stats(), null, 2));
    expect(call.prompt).toContain('- seat 0: rush');
    expect(JSON.parse(call.stats)).toEqual(stats());
    expect(leftovers()).toEqual([]);
  });

  it('fills {prompt} and {stats} inside an argument and refuses any other placeholder', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(calls, (c) => { c.stdout.write(verdict()); c.end(0); });
    await runJudge(job(spawn, { template: 'cmd:j --in={stats} --prompt {prompt}' }));
    expect(calls[0].args[0]).toMatch(/^--in=.*stats\.json$/);
    expect(calls[0].args[2]).toMatch(/prompt\.md$/);
    expect(JUDGE_PLACEHOLDERS).toEqual(['prompt', 'stats']);
    const bad = await runJudge(job(spawn, { template: 'cmd:j {mcp}' }));
    expect(bad.status).toBe('failed');
    expect(leftovers()).toEqual([]);
  });

  it('a plain client that prints the object itself (or one fenced block) is a reply too', async () => {
    for (const out of [verdict(), `\`\`\`json\n${verdict()}\n\`\`\`\n`]) {
      const spawn = fakeSpawn([], (c) => { c.stdout.write(out); c.end(0); });
      expect((await runJudge(job(spawn))).status).toBe('scored');
    }
  });

  it('an out-of-range score is `invalid` with the problem, and no score is kept', async () => {
    const v = setPath(loose(validScores()), 'seat0.criteria.adaptation.score', 11);
    const spawn = fakeSpawn([], (c) => { c.stdout.write(resultLine(JSON.stringify(v))); c.end(0); });
    const r = await runJudge(job(spawn));
    expect(r.status).toBe('invalid');
    expect(r).not.toHaveProperty('scores');
    if (r.status === 'invalid') expect(r.problems).toContain('seat0.criteria.adaptation.score is 11, outside 1-10');
  });

  it('a missing criterion, prose and an empty reply are `invalid`', async () => {
    const v = delPath(loose(validScores()), 'seat1.criteria.tempo_initiative');
    for (const out of [resultLine(JSON.stringify(v)), resultLine('I would give them both a seven.'), '', resultLine('')]) {
      const spawn = fakeSpawn([], (c) => { c.stdout.write(out); c.end(0); });
      const r = await runJudge(job(spawn));
      expect(r.status, out).toBe('invalid');
    }
  });

  it('a judge that fails is `failed` with why, never a score: exit code, signal, client error, no start, too much output', async () => {
    const cases: [string, (c: FakeChild) => void, RegExp, Error?][] = [
      ['exit code', (c) => { c.stdout.write(verdict()); c.end(3); }, /exited with code 3/],
      ['signal', (c) => { c.end(null, 'SIGSEGV'); }, /killed by SIGSEGV/],
      ['client error', (c) => { c.stdout.write(resultLine('Credit balance is too low', { is_error: true })); c.end(0); }, /client reported an error: Credit balance is too low/],
      ['no start', () => {}, /did not start \(judge-cli\): spawn judge-cli ENOENT/, new Error('spawn judge-cli ENOENT')],
      ['too much output', (c) => { c.stdout.write('x'.repeat(1024 * 1024 + 10)); c.end(0); }, /printed more than/],
    ];
    for (const [name, script, why, err] of cases) {
      const r = await runJudge(job(fakeSpawn([], script, err)));
      expect(r.status, name).toBe('failed');
      if (r.status === 'failed') expect(r.reason, name).toMatch(why);
      expect(r, name).not.toHaveProperty('scores');
    }
    expect(leftovers()).toEqual([]);
  });

  it('a judge that never answers is stopped at the timeout: SIGTERM, then SIGKILL for one that ignores it', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(calls, (c) => { c.obeysTerm = false; });
    const r = await runJudge(job(spawn, { timeoutMs: 40, killMs: 20 }));
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.reason).toMatch(/did not finish in 0 s|did not finish/);
    expect(calls[0].child.kills).toEqual(['SIGTERM', 'SIGKILL']);
    expect(leftovers()).toEqual([]);
  });

  it('writes the judge\'s stdout and stderr to the game\'s judge log, 0600, and never the environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
    try {
      const log = join(root, 'game1-judge.log');
      const spawn = fakeSpawn([], (c) => { c.stderr.write('judge note\n'); c.stdout.write(resultLine(verdict())); c.end(0); });
      await runJudge(job(spawn, { logFile: log }));
      const text = readFileSync(log, 'utf8');
      expect(text).toContain('judge note');
      expect(text).toContain('"type":"result"');
      expect(statSync(log).mode & 0o777).toBe(0o600);
      expect(text).not.toContain('sk-test-not-a-real-key');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('a real process (a node script, no model)', () => {
  const script = [
    "let s = ''; process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (d) => { s += d; });",
    "process.stdin.on('end', () => {",
    "  const m = /```json\\n(\\{\\n  \"version\"[\\s\\S]*?\\n\\})\\n```/.exec(s);",
    "  const stats = JSON.parse(m[1]);",
    "  const p = (n) => ({ criteria: Object.fromEntries(['fewer_deaths','wounded_care','force_preservation','tempo_initiative','adaptation'].map((k) => [k, { score: n, reason: k + ': ' + stats.seats[0].deaths + ' vs ' + stats.seats[1].deaths + ' deaths' }])), overall: { score: n, reason: require('path').basename(process.cwd()).startsWith('lions-judge-') ? 'ran in the judge dir' : 'ran in the wrong dir' } });",
    "  process.stdout.write(JSON.stringify({ seat0: p(8), seat1: p(2) }) + '\\n');",
    "});",
  ].join('\n');
  it('gets the prompt on stdin, runs in its own directory, and its reply is parsed', async () => {
    const f = join(root, 'stub-judge.cjs');
    writeFileSync(f, script);
    const r = await runJudge({
      template: `cmd:${process.execPath} ${f} < {prompt}`, stats: stats(), players: ['a', 'b'], outcome: 'x', timeoutMs: 20_000,
      spawn: (c, a, o) => nodeSpawn(c, a, o),
    });
    expect(r.status).toBe('scored');
    if (r.status === 'scored') {
      expect(r.scores.seat0.criteria.fewer_deaths.reason).toBe('fewer_deaths: 0 vs 0 deaths');
      expect(r.scores.seat1.overall.score).toBe(2);
      expect(r.scores.seat0.overall.reason).toBe('ran in the judge dir');
    }
    expect(readdirSync(root).filter((e) => e.startsWith('lions-judge-'))).toEqual([]);
  });
});
