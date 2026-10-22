// N4b task 14: external players -- `cmd:<template>`, a process the arena
// spawns per game, which drives the harness over MCP. Every child a test
// starts is stopped by its own handle (`stop()`, or the arena's own finally);
// every relay is the test's or the arena's, on 127.0.0.1 with `listen(0)`.
// No test here reads, sets or needs a key: the stand-in model
// (`test-mcp-client.ts`) plays the shipped `rush` through MCP tools alone.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runArena } from './arena';
import type { GameRecord } from './arena-score';
import { externalPlayer, parseTemplate, renderTemplate, tempRoot, tokensOf, type SpawnFn } from './external-player';
import { startLocalRelay, type LocalRelay } from './local-relay';
import { inProcess, passive, type ArenaPlayer, type RunningPlayer } from './players';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const TSX = join(root, 'tools/node_modules/.bin/tsx');
const CLIENT = join(here, 'test-mcp-client.ts');
const BUILD = 'b-external';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    try { await c?.(); } catch { /* the next one still runs */ }
  }
});
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => { rmSync(d, { recursive: true, force: true }); });
  return d;
}
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
async function gone(pid: number, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (alive(pid) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 50));
  return !alive(pid);
}
const quiet = { log: () => {}, print: () => {} };

interface Spawned { command: string; args: readonly string[]; options: SpawnOptions; child: ChildProcess; config: string | null }
/** The real `spawn`, recording what it was asked and the MCP config as it stood at that moment. */
function recordingSpawn(into: Spawned[]): SpawnFn {
  return (command, args, options) => {
    const mcp = args.find((a) => a.endsWith('mcp.json'));
    const config = mcp !== undefined && existsSync(mcp) ? readFileSync(mcp, 'utf8') : null;
    const child = spawn(command, args, options);
    into.push({ command, args, options, child, config });
    cleanups.push(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    return child;
  };
}

async function relayOf(): Promise<LocalRelay> {
  const relay = await startLocalRelay({ log: () => {}, tickMs: 5, seedFor: () => 1000 });
  cleanups.push(() => relay.close());
  return relay;
}
/** A paced versus room, both seats bots; its tickets. */
async function room(relay: LocalRelay): Promise<{ code: string; tickets: [string, string] }> {
  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const created = await post('/api/match', { player: 'bot-a', callsign: 'A', build: BUILD, map: 'tel_marum', mode: 'versus', kind: 'bot', pace: { kind: 'paced', roundTicks: 40, roundWallMs: 2000 } });
  const { code, ticket } = (await created.json()) as { code: string; ticket: string };
  const joined = await post(`/api/match/${code}/join`, { player: 'bot-b', callsign: 'B', kind: 'bot' });
  const j = (await joined.json()) as { ticket: string };
  return { code, tickets: [ticket, j.ticket] };
}
async function started(p: ArenaPlayer, relay: LocalRelay, code: string, ticket: string, logFile?: string): Promise<RunningPlayer> {
  const r = await p.start({ server: relay.url, origin: relay.origin, code, seat: 0, ticket, build: BUILD, ...(logFile === undefined ? {} : { logFile }) });
  cleanups.push(() => r.stop());
  return r;
}
const mode = (p: string): number => statSync(p).mode & 0o777;

describe('the template parser', () => {
  it('splits on whitespace and groups "double" and \'single\' quotes; nothing else is syntax', () => {
    expect(parseTemplate('node -e "console.log(1 + 2)" \'a b\'')).toEqual({ argv: ['node', '-e', 'console.log(1 + 2)', 'a b'], stdinFrom: null });
    // Shell syntax is literal arguments: no expansion, no chaining, no redirection but `<`.
    expect(parseTemplate('echo $(rm -rf ~) ; ls | cat > out * `id` && $HOME').argv)
      .toEqual(['echo', '$(rm', '-rf', '~)', ';', 'ls', '|', 'cat', '>', 'out', '*', '`id`', '&&', '$HOME']);
    // A standalone `<` and a path: that file is the child's stdin, and neither is an argument.
    expect(parseTemplate('claude -p --mcp-config {mcp} < {prompt}')).toEqual({ argv: ['claude', '-p', '--mcp-config', '{mcp}'], stdinFrom: '{prompt}' });
    // Quoted, or glued to a word, `<` is just a character.
    expect(parseTemplate('echo "<" a<b').argv).toEqual(['echo', '<', 'a<b']);
    expect(parseTemplate('cmd:node x').argv).toEqual(['node', 'x']);
  });
  it('refuses what it cannot read: an open quote, a `<` with no path, two of them, nothing at all', () => {
    expect(() => parseTemplate('node "x')).toThrow(/quote/);
    expect(() => parseTemplate('node <')).toThrow(/</);
    expect(() => parseTemplate('node < a < b')).toThrow(/</);
    expect(() => parseTemplate('   ')).toThrow(/empty/);
  });
  it('renders the four placeholders inside each argument, and refuses any other (a ticket is never one)', () => {
    const v = { mcp: '/t/mcp.json', prompt: '/t/prompt.md', seat: '1', code: 'ABC123' };
    expect(renderTemplate('x --c={code} {mcp} "{seat} {seat}" < {prompt}', v)).toEqual({ argv: ['x', '--c=ABC123', '/t/mcp.json', '1 1'], stdinFrom: '/t/prompt.md' });
    expect(() => parseTemplate('claude {ticket}')).toThrow(/\{ticket\}/);
    // `{MCP}` is not `{mcp}`: a name in another case is refused, never passed through as literal text.
    expect(() => parseTemplate('claude {MCP}')).toThrow(/\{MCP\}/);
    expect(() => parseTemplate('claude < {Prompt}')).toThrow(/\{Prompt\}/);
    // A literal JSON argument is not a placeholder.
    expect(renderTemplate('x \'{"a":1}\'', v).argv).toEqual(['x', '{"a":1}']);
  });
  it('reads tokens only from a last stdout line with usage.input_tokens and usage.output_tokens', () => {
    expect(tokensOf('{"type":"result","usage":{"input_tokens":1200,"output_tokens":34}}')).toBe(1234);
    expect(tokensOf('{"usage":{"input_tokens":5}}')).toBeNull();
    expect(tokensOf('{"usage":{"input_tokens":"5","output_tokens":1}}')).toBeNull();
    expect(tokensOf('done')).toBeNull();
    expect(tokensOf('')).toBeNull();
  });
});

describe('an external player\'s process (stand-in children)', () => {
  it('case 2: the 0700 directory and its 0600 files exist while the child runs, and are gone after it stops', async () => {
    const relay = await relayOf();
    const { code, tickets } = await room(relay);
    const spawned: Spawned[] = [];
    const p = externalPlayer('sleeper', 'cmd:node -e "setTimeout(() => {}, 60000)" {mcp}', { spawn: recordingSpawn(spawned), graceMs: 100 });
    const r = await started(p, relay, code, tickets[0]);
    expect(spawned).toHaveLength(1);
    const mcp = spawned[0].args[spawned[0].args.length - 1];
    const dir = dirname(mcp);
    expect(mode(dir)).toBe(0o700);
    const files = readdirSync(dir).sort();
    expect(files).toEqual(['mcp.json', 'prompt.md', 'ticket']);
    for (const f of files) expect(mode(join(dir, f)), f).toBe(0o600);
    expect(readFileSync(join(dir, 'ticket'), 'utf8')).toBe(tickets[0]);
    await r.stop();
    expect(existsSync(dir)).toBe(false);
    expect(await gone(spawned[0].child.pid ?? -1)).toBe(true);
  }, 30_000);

  it('case 2: a throw while the game is being set up still removes the directory', async () => {
    const relay = await relayOf();
    const { code, tickets } = await room(relay);
    let dir: string | null = null;
    const p = externalPlayer('thrower', 'cmd:node {mcp}', {
      spawn: (_c, args) => { dir = dirname(args[args.length - 1]); throw new Error('spawn failed on purpose'); },
    });
    await expect(p.start({ server: relay.url, origin: relay.origin, code, seat: 0, ticket: tickets[0], build: BUILD })).rejects.toThrow(/on purpose/);
    expect(dir).not.toBeNull();
    expect(existsSync(dir ?? '')).toBe(false);
  });

  it('case 2: a game the arena cannot finish (the other seat throws mid-game) removes the directory and the child', async () => {
    const spawned: Spawned[] = [];
    const sleeper = externalPlayer('sleeper', 'cmd:node -e "setTimeout(() => {}, 60000)" {mcp}', { spawn: recordingSpawn(spawned), graceMs: 100 });
    const broken: ArenaPlayer = { name: 'broken', start: () => Promise.reject(new Error('the second seat would not start')) };
    const out = tempDir('ext-arena-');
    const r = await runArena(['--a', 'cmd:sleeper', '--b', 'cmd:broken', '--seeds', '1', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '400', '--out', out], {
      ...quiet, resolvePlayer: (spec) => (spec === 'cmd:broken' ? broken : sleeper),
    });
    expect(r.code).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(existsSync(dirname(spawned[0].args[spawned[0].args.length - 1]))).toBe(false);
    expect(await gone(spawned[0].child.pid ?? -1)).toBe(true);
  }, 30_000);

  it('case 3: the ticket is in no argv -- not the child\'s, not the harness command the MCP config names', async () => {
    const relay = await relayOf();
    const { code, tickets } = await room(relay);
    const spawned: Spawned[] = [];
    const p = externalPlayer('sleeper', 'cmd:node -e "setTimeout(() => {}, 60000)" {mcp} {code} {seat}', { spawn: recordingSpawn(spawned), graceMs: 100 });
    const r = await started(p, relay, code, tickets[0]);
    const s = spawned[0];
    expect([s.command, ...s.args].some((a) => a.includes(tickets[0]))).toBe(false);
    const config = JSON.parse(s.config ?? '{}') as { mcpServers: { lions: { command: string; args: string[] } } };
    const lions = config.mcpServers.lions;
    expect([lions.command, ...lions.args].some((a) => a.includes(tickets[0]))).toBe(false);
    // The harness reads it from the 0600 file instead, at the path the config names.
    const at = lions.args.indexOf('--ticket-file');
    expect(at).toBeGreaterThan(0);
    expect(readFileSync(lions.args[at + 1], 'utf8')).toBe(tickets[0]);
    expect(lions.args).toEqual(expect.arrayContaining(['--server', relay.url, '--code', code, '--scope', 'command', '--build', BUILD]));
    // ... and the config file itself holds no ticket.
    expect(s.config).not.toContain(tickets[0]);
    await r.stop();
  }, 30_000);

  it('case 4: shell syntax in a template reaches the child as literal arguments and runs nothing; `< {prompt}` is its stdin', async () => {
    const relay = await relayOf();
    const { code, tickets } = await room(relay);
    const scratch = tempDir('ext-shell-');
    const marks = ['a', 'b', 'c'].map((m) => join(scratch, m));
    const logs = tempDir('ext-logs-');
    const argvLog = join(logs, 'argv.log');
    // Were a shell to read this line, each `touch` would leave a mark behind.
    const p = externalPlayer('echo', `cmd:node -e "console.log(JSON.stringify(process.argv.slice(1)))" $(touch ${marks[0]}) ; touch ${marks[1]} | cat > ${marks[2]} *`, {});
    const r = await started(p, relay, code, tickets[0], argvLog);
    await r.done;
    await r.stop();
    const printed = JSON.parse(readFileSync(argvLog, 'utf8').trim().split('\n')[0]) as string[];
    expect(printed).toEqual([`$(touch`, `${marks[0]})`, ';', 'touch', marks[1], '|', 'cat', '>', marks[2], '*']);
    for (const m of marks) expect(existsSync(m), m).toBe(false);

    const promptLog = join(logs, 'prompt.log');
    const cat = externalPlayer('cat', 'cmd:node -e "process.stdin.pipe(process.stdout)" < {prompt}', {});
    const r2 = await started(cat, relay, code, tickets[0], promptLog);
    await r2.done;
    await r2.stop();
    const prompt = readFileSync(promptLog, 'utf8');
    expect(prompt).toContain('You are seat 0');
    expect(prompt).not.toContain('{side}');
    expect(prompt).toContain('end_round');
    expect(prompt).not.toContain(tickets[0]);
  }, 30_000);

  it('a relative `< path` is read from the directory pnpm was run from (INIT_CWD), the same one the child starts in', async () => {
    const relay = await relayOf();
    const { code, tickets } = await room(relay);
    const base = tempDir('ext-initcwd-');
    writeFileSync(join(base, 'in.txt'), 'standing orders from a relative path\n');
    const logs = tempDir('ext-logs-');
    const out = join(logs, 'child.log');
    const saved = process.env.INIT_CWD;
    process.env.INIT_CWD = base;
    cleanups.push(() => { if (saved === undefined) delete process.env.INIT_CWD; else process.env.INIT_CWD = saved; });
    const cat = externalPlayer('cat', 'cmd:node -e "process.stdin.pipe(process.stdout)" < in.txt', {});
    const r = await started(cat, relay, code, tickets[0], out);
    await r.done;
    await r.stop();
    expect(readFileSync(out, 'utf8')).toContain('standing orders from a relative path');
  }, 30_000);

  it('case 5: the child gets process.env as it is -- the arena adds no KEY, TOKEN or SECRET', async () => {
    const relay = await relayOf();
    const { code, tickets } = await room(relay);
    const spawned: Spawned[] = [];
    const logs = tempDir('ext-env-');
    const envLog = join(logs, 'env.log');
    const p = externalPlayer('env', 'cmd:node -e "console.log(JSON.stringify(Object.keys(process.env)))"', { spawn: recordingSpawn(spawned) });
    const r = await started(p, relay, code, tickets[0], envLog);
    const report = await r.done;
    await r.stop();
    expect(spawned[0].options.env).toBe(process.env);
    const secretish = (k: string): boolean => /KEY|TOKEN|SECRET/i.test(k);
    const childKeys = JSON.parse(readFileSync(envLog, 'utf8').trim().split('\n')[0]) as string[];
    expect(childKeys.filter(secretish).sort()).toEqual(Object.keys(process.env).filter(secretish).sort());
    expect(childKeys.sort()).toEqual(Object.keys(process.env).sort());
    // A clean exit with no usage line: no tokens, no error.
    expect(report).toEqual({ tokens: null, timeouts: 0, errors: [] });
  }, 30_000);
});

describe('a model over MCP, end to end (the stand-in client, no model, no key)', () => {
  it('case 1: cmd:<test-mcp-client> playing rush through observe/order/end_round beats passive from both seats', async () => {
    const out = tempDir('ext-e2e-');
    const fake = `cmd:${TSX} ${CLIENT} {mcp}`;
    const r = await runArena(['--a', fake, '--b', 'passive', '--seeds', '1', '--first-seed', '5', '--map', 'tel_marum', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '6000', '--out', out], quiet);
    expect(r.code).toBe(0);
    const g: GameRecord[] = r.games;
    expect(g).toHaveLength(2);
    // Game 1: the fake on seat 0; game 2: on seat 1. It wins both on seed 40595
    // (`--first-seed 5`; was seed 1000 until tel_marum's versus seat 0 moved to
    // (24,46), 2026-10-22 -- see arena.test.ts's header).
    expect(g.map((x) => x.outcome)).toEqual(['seat0', 'seat1']);
    // Its last stdout line said usage 0 + 0: read, not defaulted to null.
    expect(g[0].reports[0].tokens).toBe(0);
    expect(g[1].reports[1].tokens).toBe(0);
    expect(g[0].reports[0].errors).toEqual([]);
    expect(r.tally?.get(fake)?.score).toBe(1);
    // One log per game and seat, under --out; and the harness each client ran is gone.
    const logs = readdirSync(out).filter((f) => f.endsWith('.log')).sort();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/-game1-seat0\.log$/);
    expect(logs[1]).toMatch(/-game2-seat1\.log$/);
    for (const f of logs) {
      const text = readFileSync(join(out, f), 'utf8');
      const pid = Number(/harness pid (\d+)/.exec(text)?.[1] ?? NaN);
      expect(Number.isInteger(pid), f).toBe(true);
      expect(await gone(pid), `harness ${pid}`).toBe(true);
    }
  }, 180_000);

  it('cmd vs cmd: with neither seat in this process, an advisor-ticket observer reads the cap and the scoreboard', async () => {
    const out = tempDir('ext-cmdcmd-');
    const make = (spec: string): ArenaPlayer => (spec.startsWith('cmd:') ? externalPlayer(spec, spec, { graceMs: 200 }) : inProcess(spec, passive));
    const fake = `cmd:${TSX} ${CLIENT} {mcp}`;
    const r = await runArena(['--a', fake, '--b', fake, '--seeds', '1', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '610', '--out', out], {
      ...quiet, resolvePlayer: (spec) => make(spec),
    });
    expect(r.code).toBe(0);
    expect(r.games).toHaveLength(2);
    for (const game of r.games) {
      expect(game.outcome).not.toBe('void');
      expect(game.by).toBe('cap');
      // 610 is no round boundary (pace 40): the observer stops on the cap tick itself, not at a round's end (640).
      expect(game.ticks).toBe(610);
      expect(game.score).toBeDefined();
    }
  }, 180_000);
});

describe('LIONS_ARENA_TMPDIR (test-only)', () => {
  it('an absolute path is used; anything else is ignored for os.tmpdir(), with one warning', () => {
    const before = process.env.LIONS_ARENA_TMPDIR;
    cleanups.push(() => { if (before === undefined) delete process.env.LIONS_ARENA_TMPDIR; else process.env.LIONS_ARENA_TMPDIR = before; });
    const warned: string[] = [];
    const warn = (l: string): void => { warned.push(l); };
    delete process.env.LIONS_ARENA_TMPDIR;
    expect(tempRoot(warn)).toBe(tmpdir());
    process.env.LIONS_ARENA_TMPDIR = '/abs/arena-root';
    expect(tempRoot(warn)).toBe('/abs/arena-root');
    expect(warned).toEqual([]);
    process.env.LIONS_ARENA_TMPDIR = 'relative/arena-root';
    expect(tempRoot(warn)).toBe(tmpdir());
    expect(tempRoot(warn)).toBe(tmpdir());
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/must be an absolute path; ignoring "relative\/arena-root"/);
  });
});
