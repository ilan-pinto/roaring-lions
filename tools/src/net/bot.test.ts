// GH-954: `pnpm bot`. No test here runs a model or the real `claude`: the
// client is an injected SpawnFn returning a fake child, and the two
// real-process checks use `--bogus` and a command that does not exist. The
// temp root is this file's own (`LIONS_ARENA_TMPDIR`), so a directory the bot
// leaves behind is seen by the test that made it.
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  scoreNames, scoresSection, BOT_ADDENDUM, botMcpConfig, buildMessage, harnessRoomBuild, shortBuild, botPrompt, classify, fileStem, harnessLines, harnessRefusedBuild, joinRefusedMessage, reportMarkdown, clientArgs, ENTRYPOINT_WARNING, failureMessage, LIVE_SERVER, declaredModel, parseBotArgs, resolveModel, runBot, USAGE,
  type SignalSource, type StopSignal,
} from './bot';
import { HARNESS_AGENT, HARNESS_TSX, standingPrompt, type SpawnFn } from './external-player';
import { RefereeTally, writeScoreFile, type RefereeStats, type ScoreSet } from './match-score';
import { loose, playerScore, setPath } from './score-fixture';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import { versusConfig } from './test-config';
import { ORDER_VERBS } from './mcp-tools';

const here = dirname(fileURLToPath(import.meta.url));
const TSX = join(resolve(here, '../..'), 'node_modules/.bin/tsx');
const BOT = join(here, 'bot.ts');

let root = '';
/** The invoking directory: `bot-results/` is made in it, apart from the temp root the leftovers are read from. */
let cwd = '';
const savedTmp = process.env.LIONS_ARENA_TMPDIR;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bot-test-'));
  cwd = mkdtempSync(join(tmpdir(), 'bot-cwd-'));
  process.env.LIONS_ARENA_TMPDIR = root;
});
afterEach(() => {
  if (savedTmp === undefined) delete process.env.LIONS_ARENA_TMPDIR; else process.env.LIONS_ARENA_TMPDIR = savedTmp;
  rmSync(root, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});
const NOW = new Date('2026-11-03T10:15:30.000Z');
const STEM = '20261103-101530-ABC234-claude-sonnet-5-5';
const resultsOf = (): string[] => (existsSync(join(cwd, 'bot-results')) ? readdirSync(join(cwd, 'bot-results')).sort() : []);
const readResult = (name: string): string => readFileSync(join(cwd, 'bot-results', name), 'utf8');
const leftovers = (): string[] => readdirSync(root);
const mode = (p: string): number => statSync(p).mode & 0o777;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kills: (NodeJS.Signals | number | undefined)[] = [];
  /** Whether SIGTERM ends it (a stubborn client ignores it). */
  obeysTerm = true;
  gone = false;
  kill(sig?: NodeJS.Signals | number): boolean {
    this.kills.push(sig);
    if ((sig === 'SIGTERM' && this.obeysTerm) || sig === 'SIGKILL') this.end(null, (sig as NodeJS.Signals));
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

interface Call { command: string; args: readonly string[]; options: SpawnOptions; child: FakeChild; dirEntries: string[]; config: string; prompt: string }
/** A SpawnFn that records the call (and the files as they stood), then lets `script` drive the child. */
/** What a harness that came up writes to the log file it was given, as the real one does. */
const READY = 'agent: command on seat 1 of ABC234 (tel_marum, paced)';
function fakeSpawn(calls: Call[], script: (child: FakeChild, call: Call) => void, startError?: Error, harnessOut: readonly string[] = [READY]): SpawnFn {
  return (command, args, options) => {
    const child = new FakeChild();
    const dir = options.cwd as string;
    const call: Call = {
      command, args, options, child,
      dirEntries: existsSync(dir) ? readdirSync(dir).sort() : [],
      config: existsSync(join(dir, 'mcp.json')) ? readFileSync(join(dir, 'mcp.json'), 'utf8') : '',
      prompt: existsSync(join(dir, 'prompt.md')) ? readFileSync(join(dir, 'prompt.md'), 'utf8') : '',
    };
    calls.push(call);
    // A client that cannot start emits `error` and never `spawn`, as a missing binary does.
    queueMicrotask(() => {
      if (startError !== undefined) { child.emit('error', startError); return; }
      // The harness is the client's child: its lines reach us only through the `--log-file` it was handed.
      const cfg = JSON.parse(call.config) as { mcpServers: { lions: { args: string[] } } };
      const a = cfg.mcpServers.lions.args;
      const file = a[a.indexOf('--log-file') + 1];
      for (const l of harnessOut) appendFileSync(file, `${NOW.toISOString()} har ${l}\n`);
      child.emit('spawn');
      script(child, call);
    });
    return child as unknown as ChildProcess;
  };
}
class FakeSignals implements SignalSource {
  private h = new Map<string, Set<() => void>>();
  /** A signal that is already there when the first handler is installed. */
  fireOnInstall: StopSignal | null = null;
  on(s: StopSignal, h: () => void): this {
    if (this.fireOnInstall === s) { h(); }
    (this.h.get(s) ?? this.h.set(s, new Set()).get(s)!).add(h); return this; }
  off(s: StopSignal, h: () => void): this { this.h.get(s)?.delete(h); return this; }
  fire(s: StopSignal): void { for (const h of [...(this.h.get(s) ?? [])]) h(); }
  count(): number { return [...this.h.values()].reduce((n, s) => n + s.size, 0); }
}
const resultLine = (o: Record<string, unknown>): string => `${JSON.stringify({ type: 'result', is_error: false, ...o })}\n`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TICKET = 'tkt-PAYLOAD.sig-SECRET';
interface JoinCall { url: string; body: Record<string, unknown>; headers: Record<string, string> }
function harness(script: (child: FakeChild, call: Call) => void, extra: { env?: NodeJS.ProcessEnv; killMs?: number; startError?: Error; harnessOut?: readonly string[]; join?: number | Error | Promise<number>; roomBuild?: string } = {}) {
  const joins: JoinCall[] = [];
  const fake: typeof fetch = async (input, init) => {
    joins.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: init?.headers as Record<string, string> });
    const j = extra.join ?? 200;
    if (j instanceof Error) throw j;
    const status = await j;
    if (status === 412) return Response.json({ error: 'build_mismatch', build: extra.roomBuild }, { status: 412 });
    return status === 200 ? Response.json({ code: 'ABC234', seat: 1, ticket: TICKET }) : new Response('', { status });
  };
  const calls: Call[] = [];
  const logs: string[] = [];
  const printed: string[] = [];
  const signals = new FakeSignals();
  const exits: number[] = [];
  const opts = {
    spawn: fakeSpawn(calls, script, extra.startError, extra.harnessOut),
    fetch: fake,
    env: extra.env ?? { PATH: '/usr/bin' },
    signals,
    exit: (c: number) => { exits.push(c); },
    log: (l: string) => { logs.push(l); },
    print: (l: string) => { printed.push(l); },
    killMs: extra.killMs ?? 20,
    cwd,
    now: () => NOW,
    build: '0.1.0+abcdef1',
    pollMs: 10,
  };
  return { calls, logs, printed, signals, exits, opts, joins };
}

describe('arguments and aliases', () => {
  it('defaults to sonnet, the live server and a callsign from the alias', () => {
    expect(parseBotArgs(['--room', 'abc234'])).toEqual({
      room: 'ABC234', model: 'claude-sonnet-5-5', server: LIVE_SERVER, callsign: 'Sonnet Bot', botModel: { id: 'claude-sonnet-5-5' }, client: ['claude'],
    });
  });
  it('resolves the three aliases and passes any other id through', () => {
    expect(resolveModel('sonnet')).toEqual({ id: 'claude-sonnet-5-5', alias: 'sonnet' });
    expect(resolveModel('opus')).toEqual({ id: 'claude-opus-5-5', alias: 'opus' });
    expect(resolveModel('haiku')).toEqual({ id: 'claude-haiku-5-5', alias: 'haiku' });
    expect(resolveModel('OPUS').id).toBe('claude-opus-5-5');
    expect(resolveModel('claude-sonnet-4-6')).toEqual({ id: 'claude-sonnet-4-6', alias: null });
    expect(resolveModel('toString').id).toBe('toString');   // an inherited property is not an alias
    const a = parseBotArgs(['--room', 'ABC234', '--model', 'opus']);
    expect('error' in a ? '' : [a.model, a.callsign].join('|')).toBe('claude-opus-5-5|Opus Bot');
    const b = parseBotArgs(['--room', 'ABC234', '--model', 'my-model-id']);
    expect('error' in b ? '' : [b.model, b.callsign].join('|')).toBe('my-model-id|Claude Bot');
  });
  it('the_model_is_declared', () => {
    const of = (...argv: string[]): unknown => { const a = parseBotArgs(['--room', 'ABC234', ...argv]); return 'error' in a ? a : a.botModel; };
    expect(of('--model', 'opus')).toEqual({ id: 'claude-opus-5-5' });
    expect(of('--model', 'claude-fable-5-2')).toEqual({ id: 'claude-fable-5-2' });
    expect(of('--model', 'my-local-7b')).toEqual({ id: 'other', name: 'my-local-7b' });
    expect(of('--model', 'my-local-7b', '--model-name', 'Home Net')).toEqual({ id: 'other', name: 'Home Net' });
    expect(declaredModel('claude-opus-5-5', 'opus')).toEqual({ id: 'claude-opus-5-5' });
    expect(of()).toEqual({ id: 'claude-sonnet-5-5' });
  });
  it('a_long_model_name_is_refused', () => {
    const err = (...argv: string[]): string => { const a = parseBotArgs(['--room', 'ABC234', ...argv]); return 'error' in a ? a.error : 'accepted'; };
    expect(err('--model-name', 'x'.repeat(25))).toContain('24-character limit');
    expect(err('--model', 'm'.repeat(30))).toContain('24-character limit');
    expect(err('--model', 'm'.repeat(30), '--model-name', 'Short')).toBe('accepted');
    expect(err('--model-name', 'x'.repeat(24))).toBe('accepted');
    expect(err('--model-name', '\u200b')).toContain('--model-name');
    expect(err('--model-name', '\u200b')).not.toBe('accepted');
  });
  it('the report header names the declared model', () => {
    const base = { room: 'ABC234', model: 'my-local-7b', server: 's', build: 'b', outcome: 'completed', tokens: null, logName: 'l', message: 'm', why: null };
    expect(reportMarkdown({ ...base, botModel: { id: 'other', name: 'Home Net' } })).toContain('- Declared model: Home Net');
    expect(reportMarkdown({ ...base, botModel: { id: 'claude-opus-5-5' } })).toContain('- Declared model: claude-opus-5-5');
    expect(reportMarkdown(base)).not.toContain('Declared model');
  });
  it('takes every flag, in `--flag value` and `--flag=value` form, and skips the pnpm separator', () => {
    expect(parseBotArgs(['--', '--room=ABC234', '--server', 'http://127.0.0.1:8787', '--callsign=Rex', '--client', 'my-claude --fast "a b"'])).toEqual({
      room: 'ABC234', model: 'claude-sonnet-5-5', server: 'http://127.0.0.1:8787', callsign: 'Rex', botModel: { id: 'claude-sonnet-5-5' }, client: ['my-claude', '--fast', 'a b'],
    });
  });
  it('caps the callsign at the room\'s 24 characters and refuses longer', () => {
    expect('error' in parseBotArgs(['--room', 'ABC234', '--callsign', 'x'.repeat(24)])).toBe(false);
    expect('error' in parseBotArgs(['--room', 'ABC234', '--callsign', 'x'.repeat(25)])).toBe(true);
    expect('error' in parseBotArgs(['--room', 'ABC234', '--callsign', '\u{1F981}'.repeat(24)])).toBe(false);   // code points, as the room counts
    expect('error' in parseBotArgs(['--room', 'ABC234', '--callsign', '\u{1F981}'.repeat(25)])).toBe(true);
  });
  it('refuses anything unknown or malformed, with the usage line', () => {
    for (const bad of [
      [], ['--room'], ['--room', '--model', 'opus'], ['--room', 'ABC234', '--bogus'], ['--room', 'ABC234', 'stray'],
      ['--room', 'AB;rm -rf'], ['--room', 'ABC234', '--server', 'ftp://x'], ['--room', 'ABC234', '--server', 'nope'],
      ['--room', 'ABC234', '--client', '"unclosed'], ['--room', 'ABC234', '--client', 'claude < /etc/passwd'], ['--room', 'ABC234', '--ticket-file', 'x'],
    ]) {
      const r = parseBotArgs(bad);
      expect('error' in r, JSON.stringify(bad)).toBe(true);
      if ('error' in r) expect(r.error).toContain(USAGE);
    }
  });
});

describe('the MCP config, the prompt and the client command', () => {
  it('names this checkout\'s harness on the ticket FILE and the bot log, never --join and never a ticket value', () => {
    const cfg = botMcpConfig({ server: 'https://g.example', room: 'ABC234' }, '/t/ticket', '/r/bot.log', '1.0.0+abc1234');
    expect(cfg).toEqual({
      mcpServers: { lions: { command: HARNESS_TSX, args: [HARNESS_AGENT, '--server', 'https://g.example', '--code', 'ABC234', '--scope', 'command', '--ticket-file', '/t/ticket', '--log-file', '/r/bot.log', '--build', '1.0.0+abc1234'] } },
    });
    expect(JSON.stringify(cfg)).not.toContain('--join');
  });
  it('builds the client argv: print mode, the model, the config, json output and only the harness\'s tools', () => {
    expect(clientArgs({ model: 'claude-sonnet-5-5', client: ['claude'] }, '/t/mcp.json')).toEqual([
      '-p', '--model', 'claude-sonnet-5-5', '--mcp-config', '/t/mcp.json', '--output-format', 'json', '--allowedTools', 'mcp__lions__*',
    ]);
    expect(clientArgs({ model: 'm', client: ['wrapper', '--x'] }, '/t/mcp.json').slice(0, 2)).toEqual(['--x', '-p']);
  });
  it('spawns the client without a shell, in a 0700 directory of 0600 files, with the prompt as stdin and the environment untouched', async () => {
    const h = harness((c, call) => {
      expect(mode(call.options.cwd as string)).toBe(0o700);
      expect(mode(join(call.options.cwd as string, 'mcp.json'))).toBe(0o600);
      expect(mode(join(call.options.cwd as string, 'prompt.md'))).toBe(0o600);
      expect(mode(join(call.options.cwd as string, 'ticket'))).toBe(0o600);
      expect(readFileSync(join(call.options.cwd as string, 'ticket'), 'utf8')).toBe(TICKET);   // the one place it lives
      c.stdout.write(resultLine({ result: 'done', usage: { input_tokens: 10, output_tokens: 5 } }));
      c.end(0);
    });
    const env = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-test-not-a-real-key' };
    const code = await runBot(['--room', 'ABC234', '--model', 'haiku'], { ...h.opts, env });
    expect(code).toBe(0);
    const [call] = h.calls;
    expect(h.calls).toHaveLength(1);
    expect(call.command).toBe('claude');
    expect(call.args[0]).toBe('-p');
    expect(call.args.slice(1, 3)).toEqual(['--model', 'claude-haiku-5-5']);
    expect(call.args).toContain('--output-format');
    expect(call.args[call.args.length - 2]).toBe('--allowedTools');
    expect(call.args[call.args.length - 1]).toBe('mcp__lions__*');
    expect(call.options.shell).toBe(false);
    expect(call.options.env).toBe(env);
    expect((call.options.stdio as unknown[])[1]).toBe('pipe');
    expect(typeof (call.options.stdio as unknown[])[0]).toBe('number');   // the prompt file, opened for reading
    expect(call.dirEntries).toEqual(['mcp.json', 'prompt.md', 'ticket']);
    expect(call.args.join(' ')).not.toContain(TICKET);
    expect(JSON.stringify(call.options.env)).not.toContain(TICKET);
    const dir = call.options.cwd as string;
    expect(JSON.parse(call.config)).toEqual(botMcpConfig({ server: LIVE_SERVER, room: 'ABC234' }, join(dir, 'ticket'), join(cwd, 'bot-results', `${STEM.replace('claude-sonnet-5-5', 'claude-haiku-5-5')}.log`), '0.1.0+abcdef1', join(cwd, 'bot-results', `${STEM.replace('claude-sonnet-5-5', 'claude-haiku-5-5')}-scores.json`)));
    expect(h.joins[0].body.build).toBe('0.1.0+abcdef1');   // the join names the build the harness will
    expect(call.config).not.toContain(TICKET);
    expect(call.prompt).not.toContain(TICKET);
    expect(h.joins).toHaveLength(1);
    expect(h.joins[0].url).toBe(`${LIVE_SERVER}/api/match/ABC234/join`);
    expect(h.joins[0].body).toMatchObject({ kind: 'bot', callsign: 'Haiku Bot' });
    expect(h.joins[0].headers.origin).toBe(LIVE_SERVER);
    // The ticket reaches no log, no report, no message.
    for (const f of resultsOf()) expect(readResult(f), f).not.toContain(TICKET);
    expect([...h.logs, ...h.printed].join('\n')).not.toContain(TICKET);
    expect(call.prompt).toContain('You are seat 1 in match ABC234');
    expect(call.prompt).not.toMatch(/\{seat\}|\{code\}/);
    // The environment (a key among it) is never read back into a message.
    expect([...h.logs, ...h.printed].join('\n')).not.toContain('sk-test-not-a-real-key');
  });
  it('lets no shell metacharacter reach a shell: they stay literal text in a file or an argument', async () => {
    const nasty = 'x; $(id) `id` | cat&&$H';   // within the 24-character callsign limit
    const h = harness((c) => { c.end(0); });
    await runBot(['--room', 'ABC234', '--callsign', nasty, '--client', 'claude;touch /tmp/pwned2 --flag', '--model', 'm$(id)'], h.opts);
    const [call] = h.calls;
    expect(call.command).toBe('claude;touch');                    // split on the space, never interpreted
    expect(call.args[0]).toBe('/tmp/pwned2');
    expect(call.args).toContain('m$(id)');
    expect(call.options.shell).toBe(false);
    expect(call.args.some((a) => a.includes(nasty))).toBe(false);  // the callsign rides in the join's JSON body only
    expect(h.joins[0].body.callsign).toBe(nasty);
    expect(call.config).not.toContain(nasty);
  });
});

describe('the temp directory is removed on every way out', () => {
  it('after a normal exit, printing the result and the token use', async () => {
    const h = harness((c) => {
      c.stderr.write('progress: planning\n');
      c.stdout.write(resultLine({ result: 'The bot lost.', usage: { input_tokens: 1200, output_tokens: 34 } }));
      c.end(0);
    });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(0);
    expect(leftovers()).toEqual([]);
    expect(h.printed).toEqual(['The bot lost.']);
    expect(h.logs).toContain('progress: planning');
    expect(h.logs.some((l) => l.includes('tokens: 1234'))).toBe(true);
    expect(h.signals.count()).toBe(0);   // the handlers are taken down too
  });
  it('after a failure, a spawn that throws and a client that will not start', async () => {
    const failing = harness((c) => { c.end(3); });
    expect(await runBot(['--room', 'ABC234'], failing.opts)).toBe(1);
    expect(leftovers()).toEqual([]);

    const throwing = harness(() => {});
    expect(await runBot(['--room', 'ABC234'], { ...throwing.opts, spawn: () => { throw new Error('boom'); } }).catch((e: unknown) => String(e))).toContain('boom');
    expect(leftovers()).toEqual([]);

    const missing = harness(() => {}, { startError: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) });
    expect(await runBot(['--room', 'ABC234'], missing.opts)).toBe(1);
    expect(leftovers()).toEqual([]);
    expect(missing.logs.join('\n')).toContain('could not start the client "claude"');
    expect(missing.logs.join('\n')).toContain('--client');
  });
  it('on SIGINT: the directory goes first, the client gets SIGTERM, the exit is 130; no second signal exits', async () => {
    const h = harness(() => {});   // a client that plays until it is stopped
    const run = runBot(['--room', 'ABC234'], h.opts);
    await sleep(30);
    expect(leftovers()).toHaveLength(1);
    h.signals.fire('SIGINT');
    expect(leftovers()).toEqual([]);                        // removed before the client has even gone
    expect(h.calls[0].child.kills).toEqual(['SIGTERM']);
    expect(await run).toBe(130);
    expect(h.exits).toEqual([]);
    expect(leftovers()).toEqual([]);
    expect(h.signals.count()).toBe(0);
  });
  it('on SIGTERM: exit 143; a client that ignores SIGTERM gets SIGKILL', async () => {
    const h = harness((c) => { c.obeysTerm = false; });
    const run = runBot(['--room', 'ABC234'], h.opts);
    await sleep(30);
    h.signals.fire('SIGTERM');
    expect(await run).toBe(143);
    expect(h.calls[0].child.kills).toEqual(['SIGTERM', 'SIGKILL']);
    expect(leftovers()).toEqual([]);
  });
  it('a second signal exits at once, with the directory already gone', async () => {
    const h = harness((c) => { c.obeysTerm = false; }, { killMs: 5000 });
    const run = runBot(['--room', 'ABC234'], h.opts);
    await sleep(30);
    h.signals.fire('SIGINT');
    expect(h.exits).toEqual([]);
    h.signals.fire('SIGINT');
    expect(h.exits).toEqual([130]);
    expect(leftovers()).toEqual([]);
    h.calls[0].child.end(null, 'SIGKILL');   // let the run finish
    expect(await run).toBe(130);
  });
});

describe('the environment warning', () => {
  it('warns before the client starts when CLAUDE_CODE_ENTRYPOINT is set, and not otherwise; never the value', async () => {
    const order: string[] = [];
    const set = harness(() => {}, { env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-secret-value' } });
    const spawnInner = set.opts.spawn;
    set.opts.spawn = (...a) => { order.push('spawn'); return spawnInner(...a); };
    set.opts.log = (l: string) => { order.push(l === ENTRYPOINT_WARNING ? 'warn' : 'log'); set.logs.push(l); };
    const run = runBot(['--room', 'ABC234'], set.opts);
    await sleep(30);
    set.calls[0].child.end(0);
    await run;
    expect(order.indexOf('warn')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('warn')).toBeLessThan(order.indexOf('spawn'));
    expect(set.logs.join('\n')).not.toContain('claude-desktop-secret-value');
    expect(set.calls[0].options.env).toEqual({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-secret-value' });   // passed on unchanged

    const plain = harness((c) => { c.end(0); });
    await runBot(['--room', 'ABC234'], plain.opts);
    expect(plain.logs).not.toContain(ENTRYPOINT_WARNING);
  });
});

describe('failure messages', () => {
  const run = async (stderr: string, stdout: string, code: number): Promise<{ code: number; text: string }> => {
    const h = harness((c) => { if (stderr) c.stderr.write(stderr); if (stdout) c.stdout.write(stdout); c.end(code); });
    const r = await runBot(['--room', 'ABC234'], h.opts);
    expect(leftovers()).toEqual([]);
    return { code: r, text: h.logs.join('\n') };
  };
  it('classifies the known causes', () => {
    expect(classify('agent: the room refused this client (build_mismatch)')).toBe('build');
    expect(classify('MCP server "lions" exited with code 2')).toBe('build');
    expect(classify('MCP server "lions" failed to connect')).toBe('mcp');
    expect(classify('Failed to start MCP server lions')).toBe('mcp');
    expect(classify('the room refused the join: HTTP 409')).toBeNull();   // the join is bot.ts's now
    expect(classify('Failed to authenticate. API Error: 401')).toBe('auth');
    expect(classify('OAuth session expired')).toBe('auth');
    expect(classify('something else entirely')).toBeNull();
    expect(classify('exited with code 20')).toBeNull();
  });
  it('a refused build says the live site runs another build, and how to get the right checkout (exit 2)', async () => {
    const r = await run('agent: the room refused this client (build_mismatch)\n', '', 1);
    expect(r.code).toBe(2);
    expect(r.text).toContain('runs a different build than this checkout');
    expect(r.text).not.toContain('Settings footer');
    expect(r.text).toContain('Open a new room');
    expect(r.text).toContain('checkout --detach origin/main');   // the room did not say its build
    const viaExit = await run('MCP server "lions" exited with code 2\n', '', 1);
    expect(viaExit.code).toBe(2);
  });
  it('the client\'s own MCP failure says the harness stopped and where to look', async () => {
    const r = await run('MCP server "lions" failed to connect\n', '', 1);
    expect(r.code).toBe(1);
    expect(r.text).toContain('the game connection (harness) stopped');
    expect(r.text).toContain(join(cwd, 'bot-results', `${STEM}.log`));
  });
  it('an authentication failure says /login, Terminal, and why not the desktop app', async () => {
    for (const out of ['Failed to authenticate', 'OAuth session expired']) {
      const r = await run('', resultLine({ is_error: true, result: out }), 1);
      expect(r.code).toBe(1);
      expect(r.text).toContain('/login');
      expect(r.text).toContain('Terminal');
      expect(r.text).toContain('ANTHROPIC_BASE_URL');
    }
  });
  it('an unknown failure still says the exit code and what the client printed', async () => {
    const r = await run('kaboom\n', '', 7);
    expect(r.code).toBe(1);
    expect(r.text).toContain('exited with code 7');
    expect(r.text).toContain('kaboom');
  });
  it('the four messages are distinct', () => {
    const m = (['auth', 'build', 'room', 'mcp'] as const).map((f) => failureMessage(f, { server: LIVE_SERVER }));
    expect(new Set(m).size).toBe(4);
  });
});

describe('a clean exit is never reclassified, and the model\'s own words are not a refusal', () => {
  it('prints the result and exits 0 although the output mentions the refusal phrases', async () => {
    const h = harness((c) => {
      c.stderr.write('lions server exited with code 2 earlier; the room refused the join: HTTP 409; build_mismatch\n');
      c.stdout.write(resultLine({ result: 'I read "exited with code 2" and "HTTP 400" in the log.', usage: { input_tokens: 1, output_tokens: 1 } }));
      c.end(0);
    });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(0);
    expect(h.logs.join('\n')).not.toContain('different build');
    expect(h.printed[0]).toContain('HTTP 400');
  });
  it('a failed run whose only mention is in the model\'s result is not a build or room failure', async () => {
    const h = harness((c) => { c.stdout.write(resultLine({ is_error: true, result: 'I quote: lions exited with code 2; the room refused the join: HTTP 409; build_mismatch' })); c.end(1); });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(1);
    expect(h.logs.join('\n')).toContain('exited with code 1');
    expect(h.logs.join('\n')).not.toContain('different build');
  });
  it('classify reads the harness text for refusals and the model text for sign-in only', () => {
    expect(classify('', 'HTTP 409 build_mismatch exited with code 2')).toBeNull();
    expect(classify('', 'Failed to authenticate')).toBe('auth');
    expect(classify('room full, HTTP 400')).toBeNull();
    expect(classify('exited with code 2')).toBeNull();
  });
});

describe('a signal before the files exist', () => {
  it('returns 130 with no spawn and no directory, not an ENOENT', async () => {
    const h = harness(() => {});
    h.signals.fireOnInstall = 'SIGINT';
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(130);
    expect(h.calls).toHaveLength(0);
    expect(leftovers()).toEqual([]);
  });
});

describe('the log', () => {
  it('writes every client line, timestamped, to bot-results/<date>-<room>-<model>.log, and prints the paths at the start and the end', async () => {
    const order: string[] = [];
    const h = harness((c) => {
      c.stderr.write('harness: seat 1 of ABC234\n');
      c.stdout.write('a plain progress line\n');
      c.stdout.write(resultLine({ result: 'GG', usage: { input_tokens: 2, output_tokens: 3 } }));
      c.end(0);
    }, { env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-test-not-a-real-key' } });
    const inner = h.opts.spawn;
    h.opts.spawn = (...args) => { order.push('spawn'); return inner(...args); };
    h.opts.log = (l: string) => { order.push(l); h.logs.push(l); };
    // A folder left looser than 0700 by an earlier run is tightened, not trusted.
    mkdirSync(join(cwd, 'bot-results'), { recursive: true });
    chmodSync(join(cwd, 'bot-results'), 0o755);
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(0);
    expect(resultsOf()).toEqual([`${STEM}-report.md`, `${STEM}-scores.json`, `${STEM}.log`]);
    const logPath = join(cwd, 'bot-results', `${STEM}.log`);
    expect(mode(logPath)).toBe(0o600);
    expect(mode(join(cwd, 'bot-results'))).toBe(0o700);
    const text = readResult(`${STEM}.log`);
    for (const l of text.trimEnd().split('\n')) expect(l, l).toMatch(/^2026-11-03T10:15:30\.000Z (bot|out|err|har) /);
    expect(text).toContain('err harness: seat 1 of ABC234');
    expect(text).toContain('out a plain progress line');
    expect(text).toContain('"result":"GG"');
    expect(text).toContain('bot bot: finished. tokens: 5');
    // Never the environment, never a ticket.
    expect(text).not.toContain('sk-test-not-a-real-key');
    expect(text.toLowerCase()).not.toContain('ticket');
    // The paths: before the client starts, and again at the end.
    const at = (needle: string): number[] => order.flatMap((l, i) => (l === needle ? [i] : []));
    const logLine = `bot: log: ${logPath}`;
    expect(at(logLine)).toHaveLength(2);
    expect(at(logLine)[0]).toBeLessThan(order.indexOf('spawn'));
    expect(at(logLine)[1]).toBeGreaterThan(order.indexOf('spawn'));
    expect(at(`bot: report: ${join(cwd, 'bot-results', `${STEM}-report.md`)}`)).toHaveLength(2);
  });
  it('stays under the invoking directory whatever the model flag says', async () => {
    expect(fileStem(NOW, 'ABC234', '../../etc/x')).toBe('20261103-101530-ABC234-__.._etc_x');
    const h = harness((c) => { c.end(0); });
    await runBot(['--room', 'ABC234', '--model', '../../../evil/m'], h.opts);
    expect(readdirSync(cwd)).toEqual(['bot-results']);
    expect(resultsOf()).toHaveLength(3);
    for (const f of resultsOf()) expect(f).not.toMatch(/[\\/]/);
  });
  it('uses INIT_CWD when no directory is injected', async () => {
    const saved = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      const h = harness((c) => { c.end(0); });
      const { cwd: _unused, ...rest } = h.opts;
      void _unused;
      await runBot(['--room', 'ABC234'], rest);
    } finally {
      if (saved === undefined) delete process.env.INIT_CWD; else process.env.INIT_CWD = saved;
    }
    expect(resultsOf()).toHaveLength(3);
  });
  it('refuses at once when the folder cannot be made, and starts nothing', async () => {
    writeFileSync(join(cwd, 'bot-results'), 'a file where the folder should go');
    const h = harness((c) => { c.end(0); });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(1);
    expect(h.calls).toHaveLength(0);
    expect(h.logs.join('\n')).toContain('cannot write');
    expect(leftovers()).toEqual([]);
  });
});

describe('the match report', () => {
  it('adds a bot-only addendum to the prompt and leaves the arena\'s prompt alone', async () => {
    const h = harness((c) => { c.end(0); });
    await runBot(['--room', 'ABC234'], h.opts);
    const prompt = h.calls[0].prompt;
    expect(prompt).toBe(botPrompt({ room: 'ABC234' }));
    expect(prompt).toContain(BOT_ADDENDUM);
    for (const w of ['## Conclusion', '## Bugs noticed', '"none"', 'keep short notes', 'FINAL message', 'take a while to press Ready', 'keep calling `wait`']) expect(prompt, w).toContain(w);
    expect(readFileSync(join(here, 'arena-prompt.md'), 'utf8')).not.toMatch(/Bugs noticed|FINAL message/);
    expect(standingPrompt({ seat: 1, code: 'ABC234' })).not.toContain('Bugs noticed');
  });
  it('saves the final message under a header: room, model, server, build, result, tokens', async () => {
    const message = '## Conclusion\nWon by flanking.\n\n## Bugs noticed\nnone';
    const h = harness((c) => { c.stdout.write(resultLine({ result: message, usage: { input_tokens: 700, output_tokens: 34 } })); c.end(0); });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(0);
    const report = readResult(`${STEM}-report.md`);
    expect(mode(join(cwd, 'bot-results', `${STEM}-report.md`))).toBe(0o600);
    expect(report).toContain('- Room: ABC234');
    expect(report).toContain('- Model: claude-sonnet-5-5');
    expect(report).toContain(`- Server: ${LIVE_SERVER}`);
    expect(report).toContain('- Build: 0.1.0+abcdef1');
    expect(report).toContain('- Result: completed');
    expect(report).toContain('- Tokens: 734');
    // The model's message comes first and whole; the scores section follows it (GH-973).
    expect(report).toContain(`\n${message}\n\n## Scores\n`);
    expect(report).not.toContain('No report was produced');
  });
  it('is written even when the client dies first, and says why', async () => {
    const cases: { name: string; h: ReturnType<typeof harness>; code: number; why: RegExp; outcome: string }[] = [
      { name: 'exit code', h: harness((c) => { c.stderr.write('kaboom\n'); c.end(7); }), code: 1, why: /No report was produced: the client exited with code 7/, outcome: 'failed' },
      { name: 'killed', h: harness((c) => { c.end(null, 'SIGKILL'); }), code: 1, why: /No report was produced: the client was killed by SIGKILL/, outcome: 'failed' },
      { name: 'build refused', h: harness((c) => { c.stderr.write('agent: the room refused this client (build_mismatch)\n'); c.end(1); }), code: 2, why: /No report was produced: the room refused this checkout's build/, outcome: 'failed' },
      { name: 'cannot start', h: harness(() => {}, { startError: new Error('spawn claude ENOENT') }), code: 1, why: /No report was produced: the client "claude" could not start \(spawn claude ENOENT\)/, outcome: 'failed' },
      { name: 'clean but silent', h: harness((c) => { c.end(0); }), code: 0, why: /No report was produced: the client exited cleanly but printed no final message/, outcome: 'completed' },
    ];
    for (const k of cases) {
      rmSync(join(cwd, 'bot-results'), { recursive: true, force: true });
      expect(await runBot(['--room', 'ABC234'], k.h.opts), k.name).toBe(k.code);
      const report = readResult(`${STEM}-report.md`);
      expect(report, k.name).toMatch(k.why);
      expect(report, k.name).toContain(`- Result: ${k.outcome}`);
      expect(report, k.name).toContain('- Room: ABC234');
    }
  });
  it('is written when a signal stops the bot, and quotes a last message from a failed client', async () => {
    const h = harness(() => {});
    const run = runBot(['--room', 'ABC234'], h.opts);
    await sleep(30);
    h.signals.fire('SIGTERM');
    expect(await run).toBe(143);
    const report = readResult(`${STEM}-report.md`);
    expect(report).toContain('No report was produced: stopped by SIGTERM');
    expect(report).toContain('- Result: stopped');

    rmSync(join(cwd, 'bot-results'), { recursive: true, force: true });
    const failing = harness((c) => { c.stdout.write(resultLine({ is_error: true, result: 'Failed to authenticate' })); c.end(1); });
    await runBot(['--room', 'ABC234'], failing.opts);
    expect(readResult(`${STEM}-report.md`)).toContain('> Failed to authenticate');
  });
  it('reportMarkdown shows unknown tokens, and a message only when nothing failed', () => {
    const base = { room: 'R', model: 'm', server: 's', build: 'b', outcome: 'completed', tokens: null, logName: 'x.log' };
    expect(reportMarkdown({ ...base, message: 'hi', why: null })).toContain('- Tokens: unknown');
    expect(reportMarkdown({ ...base, message: 'hi', why: null })).not.toContain('No report');
    expect(reportMarkdown({ ...base, message: 'hi', why: 'died' })).toContain('No report was produced: died.');
  });
});

describe('the join happens in bot.ts, before any model starts', () => {
  const noModel = (h: ReturnType<typeof harness>): void => {
    expect(h.calls).toHaveLength(0);          // no client, so no tokens
    expect(leftovers()).toEqual([]);          // no temp directory, no ticket
  };
  it('a 404 says the code was not found; 409 that the seat is taken; 410 that it ended; 429 slow down; others the status', async () => {
    const want: [number, RegExp][] = [[404, /not found.*check the code/], [409, /second seat.*open a new room/], [410, /has ended.*open a new room/], [400, /not found/], [429, /slow down/], [503, /HTTP 503/]];
    for (const [status, re] of want) {
      const h = harness((c) => { c.end(0); }, { join: status });
      rmSync(join(cwd, 'bot-results'), { recursive: true, force: true });
      expect(await runBot(['--room', 'ABC234'], h.opts), String(status)).toBe(1);
      noModel(h);
      expect(h.logs.join('\n'), String(status)).toMatch(re);
      expect(readResult(`${STEM}-report.md`)).toContain(`No report was produced: the room refused the join (HTTP ${status})`);
    }
  });
  it('an unreachable server is said, with no model started', async () => {
    const h = harness((c) => { c.end(0); }, { join: new Error('fetch failed') });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(1);
    noModel(h);
    expect(h.logs.join('\n')).toContain('could not join room ABC234');
    expect(h.logs.join('\n')).toContain('fetch failed');
  });
  it('uses the seat the room answered for the prompt', async () => {
    const h = harness((c) => { c.end(0); });
    h.opts.fetch = async () => Response.json({ code: 'ABC234', seat: 0, ticket: TICKET });
    await runBot(['--room', 'ABC234'], h.opts);
    expect(h.calls[0].prompt).toContain('You are seat 0 in match ABC234');
  });
  it('a signal during the join returns 130 with no client, no ticket file and no directory', async () => {
    let release: (n: number) => void = () => {};
    const gate = new Promise<number>((res) => { release = res; });
    const h = harness((c) => { c.end(0); }, { join: gate });
    const run = runBot(['--room', 'ABC234'], h.opts);
    await sleep(30);
    h.signals.fire('SIGINT');
    release(200);
    expect(await run).toBe(130);
    noModel(h);
  });
  it('joinRefusedMessage names the room and the status', () => {
    expect(joinRefusedMessage(404, { room: 'ABC234', server: 's' })).toContain('ABC234');
    expect(new Set([404, 409, 410, 429, 500].map((n) => joinRefusedMessage(n, { room: 'R', server: 's' }))).size).toBe(5);
  });
});

describe('the harness\'s own refusal reaches us through the log it was given', () => {
  it('parses only `har` lines, and only the exact build refusal counts', () => {
    const text = '2026-11-03T10:15:30.000Z bot hello\n2026-11-03T10:15:30.000Z har agent: the room refused this client (build_mismatch)\n2026-11-03T10:15:31.000Z err agent: the room refused this client (build_mismatch)\n';
    expect(harnessLines(text)).toEqual(['agent: the room refused this client (build_mismatch)']);
    expect(harnessRefusedBuild(harnessLines(text))).toBe(true);
    expect(harnessRefusedBuild(harnessLines('2026-11-03T10:15:31.000Z err agent: the room refused this client (build_mismatch)\n'))).toBe(false);
    expect(harnessRefusedBuild(['agent: the room refused this client (bad_ticket)'])).toBe(false);
  });
  it('a build refusal in the harness log is the build message and exit 2, even when the client then exits cleanly (the model "could not reach the MCP")', async () => {
    const h = harness((c) => {
      c.stdout.write(resultLine({ result: 'I was not able to reach the MCP server, so I could not join a game.', usage: { input_tokens: 4, output_tokens: 4 } }));
      c.end(0);
    }, { harnessOut: ['agent: the room refused this client (build_mismatch)', 'agent: ended'] });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(2);
    const text = h.logs.join('\n');
    expect(text).toContain('runs a different build than this checkout');
    expect(text).not.toContain('Settings footer');
    expect(h.printed).toEqual([]);
    expect(readResult(`${STEM}-report.md`)).toContain('the room refused this checkout');
  });
  it('a harness that wrote nothing never came up: a clean exit is the game-connection message, exit 1', async () => {
    const h = harness((c) => {
      c.stdout.write(resultLine({ result: 'I was not able to reach the MCP.', usage: { input_tokens: 1, output_tokens: 1 } }));
      c.end(0);
    }, { harnessOut: [] });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(1);
    expect(h.logs.join('\n')).toContain(`the game connection (harness) stopped: see ${join(cwd, 'bot-results', `${STEM}.log`)}`);
    expect(readResult(`${STEM}-report.md`)).toContain('No report was produced: the game connection (harness) stopped');
  });
  it('a failed run takes the build refusal from the harness log too', async () => {
    const h = harness((c) => { c.end(1); }, { harnessOut: ['agent: the room refused this client (build_mismatch)'] });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(2);
  });
  it('the harness is started on the ticket file and the bot log', async () => {
    const h = harness((c) => { c.end(0); });
    await runBot(['--room', 'ABC234'], h.opts);
    const a = (JSON.parse(h.calls[0].config) as { mcpServers: { lions: { args: string[] } } }).mcpServers.lions.args;
    expect(a).toContain('--ticket-file');
    expect(a).not.toContain('--join');
    expect(a[a.indexOf('--log-file') + 1]).toBe(join(cwd, 'bot-results', `${STEM}.log`));
  });
});

const ROOM_BUILD = '0.129.24+abc1234def5678abc1234def5678abc1234def56';
describe('message 1: which build the room runs', () => {
  it('names the room\'s version and sha and the exact commands, and never the Settings footer', () => {
    const m = buildMessage({ server: LIVE_SERVER, roomBuild: ROOM_BUILD, ourBuild: '0.129.25+1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', root: '/Users/x/dev/roaring-lions-bot' });
    expect(m).toContain('this room runs 0.129.24+abc1234, this checkout is 0.129.25+1111111');
    expect(m).toContain('git -C /Users/x/dev/roaring-lions-bot fetch origin && git -C /Users/x/dev/roaring-lions-bot checkout --detach abc1234def5678abc1234def5678abc1234def56 && pnpm --dir /Users/x/dev/roaring-lions-bot install');
    expect(m).not.toContain('Settings');
    expect(buildMessage({ server: LIVE_SERVER, roomBuild: null, root: '/r' })).toContain('It did not say which');
    expect(buildMessage({ server: LIVE_SERVER, roomBuild: '0.1.0+', root: '/r' })).toContain('It did not say which');   // no commit in it: never guessed
  });
  it('quotes a checkout path that needs it', () => {
    expect(buildMessage({ server: 's', roomBuild: ROOM_BUILD, root: "/a b/it's" })).toContain(`git -C '/a b/it'\\''s' fetch`);
  });
  it('shortBuild and harnessRoomBuild read only what they are given', () => {
    expect(shortBuild(ROOM_BUILD)).toBe('0.129.24+abc1234');
    expect(shortBuild('weird')).toBe('weird');
    expect(harnessRoomBuild(['x', `agent: the room runs build ${ROOM_BUILD}`])).toBe(ROOM_BUILD);
    expect(harnessRoomBuild(['agent: the room runs build'])).toBeNull();
  });
  it('a join the room refuses with 412 names its build, takes no seat, starts no model and exits 2', async () => {
    const h = harness((c) => { c.end(0); }, { join: 412, roomBuild: ROOM_BUILD });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(2);
    expect(h.calls).toHaveLength(0);
    expect(leftovers()).toEqual([]);
    const text = h.logs.join('\n');
    expect(text).toContain('this room runs 0.129.24+abc1234, this checkout is 0.1.0+abcdef1');
    expect(text).toContain('checkout --detach abc1234def5678abc1234def5678abc1234def56');
    expect(text).not.toContain('Settings');
    expect(readResult(`${STEM}-report.md`)).toContain('the room runs 0.129.24+abc1234, this checkout 0.1.0+abcdef1');
  });
  it('a refusal at the harness\'s hello names the room\'s build from its log lines', async () => {
    const h = harness((c) => { c.end(0); }, { harnessOut: ['agent: the room refused this client (build_mismatch)', `agent: the room runs build ${ROOM_BUILD}`] });
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(2);
    expect(h.logs.join('\n')).toContain('this room runs 0.129.24+abc1234');
  });
});

describe('the first build refusal stops the client at once', () => {
  it('kills the client as soon as the harness log shows the refusal, however long it would have run', async () => {
    // A client that would run for minutes (tokens spent) unless it is stopped.
    const h = harness((_c, call) => {
      setTimeout(() => {
        const cfg = JSON.parse(call.config) as { mcpServers: { lions: { args: string[] } } };
        const a = cfg.mcpServers.lions.args;
        appendFileSync(a[a.indexOf('--log-file') + 1], `${NOW.toISOString()} har agent: the room refused this client (build_mismatch)\n${NOW.toISOString()} har agent: the room runs build ${ROOM_BUILD}\n`);
      }, 40);
    });
    const t0 = Date.now();
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(2);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(h.calls[0].child.kills).toEqual(['SIGTERM']);
    const text = h.logs.join('\n');
    expect(text).toContain('stopping the client now');
    expect(text.match(/this room runs/g)).toHaveLength(1);   // message 1, once
    expect(leftovers()).toEqual([]);
  });
  it('leaves a healthy client alone', async () => {
    const h = harness(() => {});
    const run = runBot(['--room', 'ABC234'], h.opts);
    await sleep(120);
    expect(h.calls[0].child.kills).toEqual([]);
    h.calls[0].child.end(0);
    await run;
  });
});

describe('a closed terminal and a killed bot still leave a report (GH-973: the lead\'s first full match left none)', () => {
  it('SIGHUP (the terminal closing) stops the client like SIGTERM, logs it, and writes the no-report file', async () => {
    const h = harness(() => {});
    const run = runBot(['--room', 'ABC234'], h.opts);
    await sleep(40);
    h.signals.fire('SIGHUP');
    expect(h.calls[0].child.kills).toEqual(['SIGTERM']);
    expect(await run).toBe(129);
    expect(leftovers()).toEqual([]);
    expect(h.logs.join('\n')).toContain('SIGHUP: stopping the client');
    expect(readResult(`${STEM}.log`)).toContain('SIGHUP: stopping the client');
    expect(readResult(`${STEM}-report.md`)).toContain('No report was produced: stopped by SIGHUP');
    expect(h.signals.count()).toBe(0);   // the SIGHUP handler is taken down too
  });
  it('a terminal that is gone (every write to stderr/stdout throws) does not stop the cleanup or the report', async () => {
    const h = harness(() => {});
    const dead = (): void => { throw new Error('EIO: the terminal is gone'); };
    h.opts.log = dead;
    h.opts.print = dead;
    const run = runBot(['--room', 'ABC234'], h.opts);
    await sleep(40);
    h.signals.fire('SIGHUP');   // the handler logs first: it must still go on to stop the client
    expect(h.calls[0].child.kills).toEqual(['SIGTERM']);
    expect(await run).toBe(129);
    expect(leftovers()).toEqual([]);
    expect(readResult(`${STEM}-report.md`)).toContain('No report was produced: stopped by SIGHUP');
    expect(readResult(`${STEM}.log`)).toContain('SIGHUP: stopping the client');   // the log file has what the terminal could not show
  });
  it('the report file exists from the start, saying the run may have been killed, and is replaced when the run ends', async () => {
    const h = harness(() => {});
    const run = runBot(['--room', 'ABC234'], h.opts);
    await sleep(60);
    // A bot killed outright (SIGKILL, a crash) runs no cleanup: this is all that is left.
    const early = readResult(`${STEM}-report.md`);
    expect(early).toContain('- Result: unfinished');
    expect(early).toContain('killed before it could finish (SIGKILL, a crash)');
    h.calls[0].child.stdout.write(resultLine({ result: '## Conclusion\nwon', usage: { input_tokens: 1, output_tokens: 1 } }));
    h.calls[0].child.end(0);
    expect(await run).toBe(0);
    const done = readResult(`${STEM}-report.md`);
    expect(done).toContain('- Result: completed');
    expect(done).not.toContain('unfinished');
  });
});

describe('the standing prompt says what `rescue` takes (GH-707, 3 Nov 2026; every verb is held to the prompt by order-verbs.test.ts)', () => {
  it('the `order` bullet names `rescue` with its own-side target, and a wounded-men section says what a medic team does', () => {
    const text = readFileSync(join(here, 'arena-prompt.md'), 'utf8');
    expect(ORDER_VERBS).toContain('rescue');
    const orderBullet = text.split('\n').find((l) => l.startsWith('- `order`')) ?? '';
    expect(orderBullet).toContain('`rescue`');
    expect(orderBullet).toContain('`casualties.mine`');
    for (const w of ['`casualties`', '`inf_medic_squad`', 'your own side\'s wounded only']) expect(text, w).toContain(w);
    // The same text reaches the bot seat, which adds its report instructions after it.
    expect(botPrompt({ room: 'ABC234' })).toContain('`casualties.mine`');
  });
});

describe('the addendum (GH-973)', () => {
  it('says the room is realtime (never end_round), what a dozer is for, where wounded men are, and what dropped means', () => {
    for (const w of ['REALTIME', 'Never call `end_round`', 'not a paced room', '`observe`, `order`, `wait`', 'dozer_d9', 'unarmed', '`demolish`', '`casualties`', 'not orderable units', '`dropped`', '`reason`']) {
      expect(BOT_ADDENDUM, w).toContain(w);
    }
  });
});

describe('startup', () => {
  it('says to run pnpm install when the harness runner is missing, before any seat is taken or model started', async () => {
    const h = harness((c) => { c.end(0); });
    expect(await runBot(['--room', 'ABC234'], { ...h.opts, exists: (p) => p !== HARNESS_TSX })).toBe(1);
    expect(h.logs.join('\n')).toContain('run pnpm install in this checkout');
    expect(h.joins).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
    expect(leftovers()).toEqual([]);
    expect(readResult(`${STEM}-report.md`)).toContain('pnpm install has not been run');
  });
});

describe('the real entry point', () => {
  it('refuses a bad command line with the usage line and exit 1', () => {
    const r = spawnSync(TSX, [BOT, '--bogus'], { encoding: 'utf8', env: { ...process.env, LIONS_ARENA_TMPDIR: root, INIT_CWD: cwd } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(USAGE);
    expect(leftovers()).toEqual([]);
  }, 30_000);
  it('joins a loopback room over real HTTP, then reports a client that does not exist, leaving no directory', async () => {
    // A server of this test's own on 127.0.0.1: the bot never reaches the live game from a spec.
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method ?? ''} ${req.url ?? ''}`);
      req.resume();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ code: 'ABC234', seat: 1, ticket: TICKET }));
    });
    await new Promise<void>((res) => { server.listen(0, '127.0.0.1', res); });
    try {
      const port = (server.address() as AddressInfo).port;
      const child = spawn(TSX, [BOT, '--room', 'ABC234', '--server', `http://127.0.0.1:${port}`, '--client', join(root, 'no-such-client')], { env: { ...process.env, LIONS_ARENA_TMPDIR: root, INIT_CWD: cwd } });
      let stderr = '';
      child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
      const status = await new Promise<number | null>((res) => { child.on('exit', (code) => { res(code); }); });
      expect(status).toBe(1);
      expect(stderr).toContain('could not start the client');
      expect(stderr).not.toContain(TICKET);
      expect(seen).toEqual(['POST /api/match/ABC234/join']);
      expect(leftovers()).toEqual([]);
    } finally {
      server.close();
    }
  }, 30_000);
});

// GH-973 (the lead's ruling of 3 Nov): the bot scores BOTH players. The harness is the client's child, so it
// leaves the referee's stats and the accepted scores in the file named by `--score-file`; these cases play the
// harness by writing that file from the fake client, and watch what the bot makes of it.
describe('match scoring (GH-973)', () => {
  const referee = (): RefereeStats => new RefereeTally().stats(buildMatchWorld(versusConfig('tel_marum')).sim, { map: 'tel_marum', sides: [0, 1], factions: ['kdf', 'kdf'], result: 'seat 1 won (annihilation)' });
  const scores = (a = 3, b = 8): ScoreSet => ({ seat0: playerScore(a), seat1: playerScore(b) });
  const scoreFileOf = (call: Call): string => {
    const a = (JSON.parse(call.config) as { mcpServers: { lions: { args: string[] } } }).mcpServers.lions.args;
    return a[a.indexOf('--score-file') + 1];
  };
  /** A fake client that finishes the match, scores it through the harness's file, and prints a final message. */
  const scorer = (write: (file: string) => void) => (c: FakeChild, call: Call): void => {
    write(scoreFileOf(call));
    c.stdout.write(resultLine({ result: '## Conclusion\nLost on the flank.\n\n## Bugs noticed\nnone', usage: { input_tokens: 5, output_tokens: 6 } }));
    c.end(0);
  };
  const json = (): { status: string; problems?: string[]; scores?: unknown; referee: { seats: unknown[] } | null; submittedTick?: number; [k: string]: unknown } => JSON.parse(readResult(`${STEM}-scores.json`)) as ReturnType<typeof json>;

  it('starts the harness with --score-file in bot-results, beside the report, and the addendum names the tools and the rubric', async () => {
    const h = harness((c) => { c.end(0); });
    await runBot(['--room', 'ABC234'], h.opts);
    expect(scoreFileOf(h.calls[0])).toBe(join(cwd, 'bot-results', `${STEM}-scores.json`));
    for (const w of ['match_stats', 'submit_score', 'BOTH players', 'fewer_deaths', 'wounded_care', 'force_preservation', 'tempo_initiative', 'adaptation', 'do not repeat them']) expect(BOT_ADDENDUM, w).toContain(w);
    // The scoring step comes BEFORE the final report.
    expect(BOT_ADDENDUM.indexOf('submit_score')).toBeLessThan(BOT_ADDENDUM.indexOf('Then make your FINAL message'));
  });

  it('puts both players\' scores and the referee\'s numbers in the report, and the JSON record beside it; the bot is named as "you"', async () => {
    const h = harness(scorer((f) => { writeScoreFile(f, { version: 1, seat: 1, referee: referee(), scores: scores(3, 8), submittedTick: 812 }); }));
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(0);
    const report = readResult(`${STEM}-report.md`);
    expect(report).toContain('\n## Scores\n');
    expect(report).toContain('Scored by the bot itself');
    // Seat 1 is the bot: it is named "you", and seat 0 is the opponent.
    expect(report).toContain('| 0 | opponent | 3 | 3 | 3 | 3 | 3 | 3 |');
    expect(report).toContain('| 1 | Sonnet Bot (you) | 8 | 8 | 8 | 8 | 8 | 8 |');
    expect(report).toContain('- Fewer deaths: 3. fewer_deaths: 3 lost against 5');
    expect(report).toContain("### Referee's stats");
    const rec = json();
    expect(rec).toMatchObject({ version: 1, room: 'ABC234', model: 'claude-sonnet-5-5', seat: 1, status: 'scored', submittedTick: 812 });
    expect(rec.scores).toEqual(scores(3, 8));
    expect(rec.referee?.seats).toHaveLength(2);
    expect(mode(join(cwd, 'bot-results', `${STEM}-scores.json`))).toBe(0o600);
    // The model's own message is still first and whole.
    expect(report).toContain('## Conclusion\nLost on the flank.');
  });

  it('an out-of-range score in the file is INVALID: recorded as such, never shown as a score, and the exit code is the run\'s', async () => {
    const bad = setPath(loose(scores()), 'seat1.criteria.adaptation.score', 11);
    const h = harness(scorer((f) => { writeFileSync(f, JSON.stringify({ version: 1, seat: 1, referee: referee(), scores: bad, submittedTick: 9 })); }));
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(0);
    const report = readResult(`${STEM}-report.md`);
    expect(report).toContain('Not scored: the scores in the score file failed validation and are not shown');
    expect(report).toContain('- seat1.criteria.adaptation.score is 11, outside 1-10');
    expect(report).not.toContain('Sonnet Bot (you) | 8');
    expect(report).not.toContain('Scored by the bot itself');
    const rec = json();
    expect(rec.status).toBe('invalid');
    expect(rec.problems).toEqual(['seat1.criteria.adaptation.score is 11, outside 1-10']);
    expect(rec).not.toHaveProperty('scores');
    // The referee's numbers are still shown: they are the harness's, not the model's.
    expect(report).toContain("### Referee's stats");
  });

  it('a model that never scored is MISSING, with the stats if the match left them, and nothing invented', async () => {
    const h = harness(scorer((f) => { writeScoreFile(f, { version: 1, seat: 1, referee: referee(), scores: null, submittedTick: null }); }));
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(0);
    const report = readResult(`${STEM}-report.md`);
    expect(report).toContain('Not scored: the model did not submit scores');
    expect(report).toContain("### Referee's stats");
    expect(json()).toMatchObject({ status: 'missing' });
    expect(json()).not.toHaveProperty('scores');

    // ...and with no file at all.
    const h2 = harness((c) => { c.stdout.write(resultLine({ result: 'done' })); c.end(0); });
    await runBot(['--room', 'ABC234'], h2.opts);
    expect(readResult(`${STEM}-report.md`)).toContain('Not scored: no scores were submitted and the match left no stats');
    expect(json()).toMatchObject({ status: 'missing', referee: null });
  });

  it('a score file of an earlier run with the same name is not this run\'s', async () => {
    mkdirSync(join(cwd, 'bot-results'), { recursive: true });
    writeScoreFile(join(cwd, 'bot-results', `${STEM}-scores.json`), { version: 1, seat: 1, referee: referee(), scores: scores(), submittedTick: 1 });
    const h = harness((c) => { c.stdout.write(resultLine({ result: 'done' })); c.end(0); });
    await runBot(['--room', 'ABC234'], h.opts);
    expect(json().status).toBe('missing');
  });

  it('a score file the model could have tampered with cannot break the report: a bad referee block is dropped, a non-JSON file is invalid', async () => {
    const h = harness(scorer((f) => {
      const r = loose(referee());
      (r.seats as Record<string, unknown>[])[0].deaths = 'many';
      writeFileSync(f, JSON.stringify({ version: 1, seat: 1, referee: r, scores: scores(), submittedTick: 1 }));
    }));
    expect(await runBot(['--room', 'ABC234'], h.opts)).toBe(0);
    expect(readResult(`${STEM}-report.md`)).toContain('Scored by the bot itself');
    expect(readResult(`${STEM}-report.md`)).not.toContain("### Referee's stats");
    const h2 = harness(scorer((f) => { writeFileSync(f, '{ not json'); }));
    expect(await runBot(['--room', 'ABC234'], h2.opts)).toBe(0);
    expect(json().status).toBe('invalid');
  });

  it('a client that dies still gets a scores section (not scored), and a run that never took a seat has no scores file', async () => {
    const dies = harness((c) => { c.stderr.write('kaboom\n'); c.end(7); });
    expect(await runBot(['--room', 'ABC234'], dies.opts)).toBe(1);
    expect(readResult(`${STEM}-report.md`)).toContain('## Scores');
    expect(json().status).toBe('missing');
    rmSync(join(cwd, 'bot-results'), { recursive: true, force: true });
    const refused = harness(() => {}, { join: 404 });
    expect(await runBot(['--room', 'ABC234'], refused.opts)).toBe(1);
    expect(resultsOf()).toEqual([`${STEM}-report.md`, `${STEM}.log`]);
    expect(readResult(`${STEM}-report.md`)).toContain('Not scored: no scores were submitted');
  });

  it('names the two players by seat: the bot as "you", the other as the opponent', () => {
    expect(scoreNames(1, 'Opus Bot')).toEqual(['opponent', 'Opus Bot (you)']);
    expect(scoreNames(0, 'Opus Bot')).toEqual(['Opus Bot (you)', 'opponent']);
    expect(scoreNames(null, undefined)).toEqual(['seat 0', 'seat 1']);
    expect(scoresSection({ status: 'missing', reason: 'x', referee: null }, ['a', 'b']).join('\n')).toContain('Not scored: x.');
  });
});
