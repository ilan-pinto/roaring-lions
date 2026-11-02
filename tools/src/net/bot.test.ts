// GH-954: `pnpm bot`. No test here runs a model or the real `claude`: the
// client is an injected SpawnFn returning a fake child, and the two
// real-process checks use `--bogus` and a command that does not exist. The
// temp root is this file's own (`LIONS_ARENA_TMPDIR`), so a directory the bot
// leaves behind is seen by the test that made it.
import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BOT_ADDENDUM, botMcpConfig, botPrompt, classify, fileStem, reportMarkdown, clientArgs, ENTRYPOINT_WARNING, failureMessage, LIVE_SERVER, parseBotArgs, resolveModel, runBot, USAGE,
  type SignalSource,
} from './bot';
import { HARNESS_AGENT, HARNESS_TSX, standingPrompt, type SpawnFn } from './external-player';

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
function fakeSpawn(calls: Call[], script: (child: FakeChild, call: Call) => void, startError?: Error): SpawnFn {
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
    queueMicrotask(() => { if (startError !== undefined) { child.emit('error', startError); return; } child.emit('spawn'); script(child, call); });
    return child as unknown as ChildProcess;
  };
}
class FakeSignals implements SignalSource {
  private h = new Map<string, Set<() => void>>();
  /** A signal that is already there when the first handler is installed. */
  fireOnInstall: 'SIGINT' | 'SIGTERM' | null = null;
  on(s: 'SIGINT' | 'SIGTERM', h: () => void): this {
    if (this.fireOnInstall === s) { h(); }
    (this.h.get(s) ?? this.h.set(s, new Set()).get(s)!).add(h); return this; }
  off(s: 'SIGINT' | 'SIGTERM', h: () => void): this { this.h.get(s)?.delete(h); return this; }
  fire(s: 'SIGINT' | 'SIGTERM'): void { for (const h of [...(this.h.get(s) ?? [])]) h(); }
  count(): number { return [...this.h.values()].reduce((n, s) => n + s.size, 0); }
}
const resultLine = (o: Record<string, unknown>): string => `${JSON.stringify({ type: 'result', is_error: false, ...o })}\n`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function harness(script: (child: FakeChild, call: Call) => void, extra: { env?: NodeJS.ProcessEnv; killMs?: number; startError?: Error } = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const printed: string[] = [];
  const signals = new FakeSignals();
  const exits: number[] = [];
  const opts = {
    spawn: fakeSpawn(calls, script, extra.startError),
    env: extra.env ?? { PATH: '/usr/bin' },
    signals,
    exit: (c: number) => { exits.push(c); },
    log: (l: string) => { logs.push(l); },
    print: (l: string) => { printed.push(l); },
    killMs: extra.killMs ?? 20,
    cwd,
    now: () => NOW,
    build: '0.1.0+abcdef1',
  };
  return { calls, logs, printed, signals, exits, opts };
}

describe('arguments and aliases', () => {
  it('defaults to sonnet, the live server and a callsign from the alias', () => {
    expect(parseBotArgs(['--room', 'abc234'])).toEqual({
      room: 'ABC234', model: 'claude-sonnet-5-5', server: LIVE_SERVER, callsign: 'Sonnet Bot', client: ['claude'],
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
  it('takes every flag, in `--flag value` and `--flag=value` form, and skips the pnpm separator', () => {
    expect(parseBotArgs(['--', '--room=ABC234', '--server', 'http://127.0.0.1:8787', '--callsign=Rex', '--client', 'my-claude --fast "a b"'])).toEqual({
      room: 'ABC234', model: 'claude-sonnet-5-5', server: 'http://127.0.0.1:8787', callsign: 'Rex', client: ['my-claude', '--fast', 'a b'],
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
  it('names this checkout\'s harness, joining as a command-scope bot, with no ticket anywhere', () => {
    const cfg = botMcpConfig({ server: 'https://g.example', room: 'ABC234', callsign: 'Sonnet Bot' });
    expect(cfg).toEqual({
      mcpServers: { lions: { command: HARNESS_TSX, args: [HARNESS_AGENT, '--server', 'https://g.example', '--code', 'ABC234', '--scope', 'command', '--join', '--callsign', 'Sonnet Bot'] } },
    });
    expect(JSON.stringify(cfg).toLowerCase()).not.toContain('ticket');
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
    expect(call.dirEntries).toEqual(['mcp.json', 'prompt.md']);
    expect(call.args.join(' ').toLowerCase()).not.toContain('ticket');
    expect(JSON.parse(call.config)).toEqual(botMcpConfig({ server: LIVE_SERVER, room: 'ABC234', callsign: 'Haiku Bot' }));
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
    expect(call.args.some((a) => a.includes(nasty))).toBe(false);  // the callsign rides in the 0600 config only
    const cfg = JSON.parse(call.config) as { mcpServers: { lions: { args: string[] } } };
    expect(cfg.mcpServers.lions.args).toContain(nasty);
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
    expect(classify('the room refused the join: HTTP 409')).toBe('room');
    expect(classify('the room refused the join: HTTP 404')).toBe('room');
    expect(classify('the room refused the join: HTTP 410')).toBe('room');
    expect(classify('Failed to authenticate. API Error: 401')).toBe('auth');
    expect(classify('OAuth session expired')).toBe('auth');
    expect(classify('something else entirely')).toBeNull();
    expect(classify('exited with code 20')).toBeNull();
  });
  it('a refused build says the live site runs another build, and how to get the right checkout (exit 2)', async () => {
    const r = await run('agent: the room refused this client (build_mismatch)\n', '', 1);
    expect(r.code).toBe(2);
    expect(r.text).toContain('runs a different build than this checkout');
    expect(r.text).toContain('Settings footer');
    expect(r.text).toContain('git worktree add');
    const viaExit = await run('MCP server "lions" exited with code 2\n', '', 1);
    expect(viaExit.code).toBe(2);
  });
  it('a full or missing room says to open a new one', async () => {
    for (const status of [404, 409, 410]) {
      const r = await run(`the room refused the join: HTTP ${status}\n`, '', 1);
      expect(r.code).toBe(1);
      expect(r.text).toContain('Open a new room');
    }
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
  it('the three messages are distinct', () => {
    const m = (['auth', 'build', 'room'] as const).map((f) => failureMessage(f, { server: LIVE_SERVER }));
    expect(new Set(m).size).toBe(3);
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
    expect(classify('the room refused the join: HTTP 409')).toBe('room');
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
    expect(resultsOf()).toEqual([`${STEM}-report.md`, `${STEM}.log`]);
    const logPath = join(cwd, 'bot-results', `${STEM}.log`);
    expect(mode(logPath)).toBe(0o600);
    expect(mode(join(cwd, 'bot-results'))).toBe(0o700);
    const text = readResult(`${STEM}.log`);
    for (const l of text.trimEnd().split('\n')) expect(l, l).toMatch(/^2026-11-03T10:15:30\.000Z (bot|out|err) /);
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
    expect(resultsOf()).toHaveLength(2);
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
    expect(resultsOf()).toHaveLength(2);
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
    for (const w of ['## Conclusion', '## Bugs noticed', '"none"', 'keep short notes', 'FINAL message']) expect(prompt, w).toContain(w);
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
    expect(report.endsWith(`${message}\n`)).toBe(true);
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

describe('the real entry point', () => {
  it('refuses a bad command line with the usage line and exit 1', () => {
    const r = spawnSync(TSX, [BOT, '--bogus'], { encoding: 'utf8', env: { ...process.env, LIONS_ARENA_TMPDIR: root, INIT_CWD: cwd } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(USAGE);
    expect(leftovers()).toEqual([]);
  }, 30_000);
  it('reports a client that does not exist (a real spawn of nothing) and leaves no directory', () => {
    const r = spawnSync(TSX, [BOT, '--room', 'ABC234', '--client', join(root, 'no-such-client')], { encoding: 'utf8', env: { ...process.env, LIONS_ARENA_TMPDIR: root, INIT_CWD: cwd } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('could not start the client');
    expect(leftovers()).toEqual([]);
  }, 30_000);
});
