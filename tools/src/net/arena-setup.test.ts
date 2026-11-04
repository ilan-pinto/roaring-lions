// GH-954 W2: `pnpm arena --serve` (the setup screen's server) end to end on the local relay, and the private token's
// whole life. NO model runs and NO real key is read or set: the "models" are a node script that prints whether the
// variable is PRESENT (never its value), the token is a made-up string, and ANTHROPIC_API_KEY is deleted from this
// worker's own environment before each test so "absent" means absent.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { judgeLabel, parseArgs, parseServeOnly, nameOf, rearm, resolvePlayer, runArena, stopRun, type ArenaRun } from './arena';
import type { AgentClient } from './agent-client';
import { TOKEN_ENV } from './arena-control';
import { loadPresets, parsePresets } from './arena-presets';
import { startArenaServe, type ArenaServe } from './arena-serve';
import { inProcess, passive, rush, type ArenaPlayer } from './players';
import type { JudgeJob } from './judge';

const RUN_TOKEN = 'a-long-random-run-token';
const API_TOKEN = 'sk-test-0123456789abcdefXYZ';

const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];
let savedTmp: string | undefined;
beforeEach(() => {
  delete process.env[TOKEN_ENV];
  savedTmp = process.env.LIONS_ARENA_TMPDIR;
});
afterEach(async () => {
  while (closers.length > 0) { try { await closers.pop()?.(); } catch { /* next */ } }
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
  if (savedTmp === undefined) delete process.env.LIONS_ARENA_TMPDIR; else process.env.LIONS_ARENA_TMPDIR = savedTmp;
});
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };

/** The fake model: prints whether the variable is present (a boolean, never the value), optionally LEAKS the value
 *  in two writes (to test the log redaction across a chunk boundary), and ends with a Claude-shaped usage line. */
const here = dirname(fileURLToPath(import.meta.url));
const TSX = join(here, '../../node_modules/.bin/tsx');
const CLIENT = join(here, 'test-mcp-client.ts');
const PROBE = `
import { spawn } from 'node:child_process';
const key = process.env.${TOKEN_ENV};
console.log(JSON.stringify({ has_key: key !== undefined }));
const USAGE = JSON.stringify({ usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 3000, cache_read_input_tokens: 45000 }, total_cost_usd: 0.25 });
const mcp = process.argv.find((a) => a.endsWith('mcp.json'));
const play = () => {
  // The stand-in model plays rush through MCP, so the room starts and the game is real; its stdout is dropped.
  if (mcp === undefined) { console.log(USAGE); return; }
  const child = spawn(${JSON.stringify(TSX)}, [${JSON.stringify(CLIENT)}, mcp], { stdio: ['ignore', 'ignore', 'inherit'] });
  const end = () => { console.log(USAGE); process.exit(0); };
  child.on('exit', end);
  process.on('SIGTERM', () => { child.kill('SIGTERM'); });
};
if (process.argv.includes('--leak') && key !== undefined) {
  const h = Math.floor(key.length / 2);
  const later = (ms, f) => new Promise((res) => setTimeout(() => { f(); res(); }, ms));
  // The token goes out in two writes, 40 ms apart, on stdout and then on stderr: a chunk boundary inside it.
  process.stdout.write('LEAK-OUT ' + key.slice(0, h));
  await later(40, () => process.stdout.write(key.slice(h) + ' end\\n'));
  process.stderr.write('LEAK-ERR ' + key.slice(0, h));
  await later(40, () => process.stderr.write(key.slice(h) + ' end\\n'));
  play();
} else {
  play();
}
`;

interface Rig {
  out: string;
  tmpRoot: string;
  file: string;
  serving: ArenaServe;
  logs: string[];
  judged: JudgeJob[];
  post(path: string, body: unknown): Promise<{ status: number; text: string }>;
  get(path: string): Promise<{ status: number; text: string }>;
}
function raw(s: ArenaServe, o: { method: string; path: string; body?: string }): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: s.port, method: o.method, path: o.path, headers: { host: `127.0.0.1:${s.port}`, 'x-arena-token': RUN_TOKEN, ...(o.method === 'POST' ? { origin: s.origin, 'content-type': 'application/json' } : {}) } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8') }); });
    });
    req.on('error', reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

async function rig(): Promise<Rig> {
  const base = tmp('arena-setup-');
  const out = join(base, 'out');
  const tmpRoot = join(base, 'tmp');
  mkdirSync(out);
  mkdirSync(tmpRoot, { mode: 0o700 });
  process.env.LIONS_ARENA_TMPDIR = tmpRoot;
  const probe = join(base, 'probe.mjs');
  writeFileSync(probe, PROBE);
  const file = join(base, 'arena-players.json');
  writeFileSync(file, JSON.stringify({ players: {
    probe: { label: 'Probe', template: `cmd:${process.execPath} ${probe} {mcp}`, judgeTemplate: `cmd:${process.execPath} ${probe} --stats {stats}`, usage: 'claude-json' },
    leaky: { label: 'Leaky', template: `cmd:${process.execPath} ${probe} --leak {mcp}`, usage: 'claude-json' },
  } }), { mode: 0o600 });
  chmodSync(file, 0o600);
  const logs: string[] = [];
  const judged: JudgeJob[] = [];
  const run = await runArena(['--serve', '--out', out, '--players-file', file], {
    log: (l) => { logs.push(l); }, print: (l) => { logs.push(l); },
    startServe: (o) => startArenaServe({ ...o, app: false, token: RUN_TOKEN, finishedGraceMs: 0 }),
    runJudge: async (job) => { judged.push({ ...job, env: { ...job.env } }); return { status: 'failed', reason: 'stub judge', tokens: null }; },
  });
  expect(run.code).toBe(0);
  const serving = run.serving as ArenaServe;
  closers.push(() => serving.close({ now: true }));
  return { out, tmpRoot, file, serving, logs, judged, get: (path) => raw(serving, { method: 'GET', path }), post: (path, body) => raw(serving, { method: 'POST', path, body: JSON.stringify(body) }) };
}

/** Every regular file under `dir`, recursively, as [path, text]. */
function filesUnder(dir: string): [string, string][] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).flatMap((rel) => {
    const p = join(dir, rel);
    try { return statSync(p).isFile() ? [[p, readFileSync(p, 'utf8')] as [string, string]] : []; } catch { return []; }
  });
}

/** Polls the status until the run ends, sweeping the temp root for `needle` the whole time. */
async function waitDone(t: Rig, needle: string | null, ms = 150_000): Promise<Record<string, unknown>> {
  const end = Date.now() + ms;
  for (;;) {
    if (needle !== null) for (const [p, text] of filesUnder(t.tmpRoot)) expect(text.includes(needle), `the token is in ${p} while the run is going`).toBe(false);
    const s = JSON.parse((await t.get('/arena/api/status')).text) as Record<string, unknown>;
    if (s.state !== 'running' && s.state !== 'stopping') return s;
    if (Date.now() > end) throw new Error(`the run did not end: ${JSON.stringify(s)}`);
    await new Promise((res) => setTimeout(res, 100));
  }
}

const BODY = { a: 'probe', b: 'leaky', map: 'tel_marum', matchup: 'mirror', seeds: 1, pace: 20, roundWallMs: 1000, capTicks: 40 };

describe('parsing: preset specs and --serve alone', () => {
  it('--a/--b take preset:<id> (shape only; the file decides whether it exists), --judge too, and nothing malformed', () => {
    expect(parseArgs(['--a', 'preset:opus-5.5', '--b', 'rush', '--judge', 'preset:j1'])).toMatchObject({ a: 'preset:opus-5.5', judge: 'preset:j1' });
    expect(parseArgs(['--a', 'preset:../x', '--b', 'rush'])).toMatchObject({ error: expect.stringContaining('unknown player') });
    expect(parseArgs(['--a', 'constructor', '--b', 'rush'])).toMatchObject({ error: expect.stringContaining('unknown player') });
    expect(parseArgs(['--a', 'rush', '--b', 'rush', '--judge', 'preset:j', '--players-file', '/x/y.json'])).toMatchObject({ playersFile: '/x/y.json' });
    expect(parseArgs(['--a', 'rush', '--b', 'rush', '--judge', 'cmd:x {mcp}'])).toMatchObject({ error: expect.stringContaining('--judge') });
    expect(nameOf('preset:opus-5.5')).toBe('opus-5.5');
    expect(nameOf('cmd:node x')).toBe('cmd:node x');
    // A preset reaches the judge as Player A/B, never by its model's name.
    expect(judgeLabel('preset:opus-5.5', 'A')).toBe('Player A');
    expect(judgeLabel('rush', 'B')).toBe('rush');
  });
  it('--serve alone is the server only: neither --a nor --b nor --watch, and only its three options', () => {
    expect(parseServeOnly(['--serve'])).toEqual({ port: 0, playersFile: null, out: null });
    expect(parseServeOnly(['--', '--serve', '--serve-port', '5187', '--out', 'x', '--players-file=f'])).toEqual({ port: 5187, playersFile: 'f', out: 'x' });
    expect(parseServeOnly(['--serve', '--a', 'rush', '--b', 'passive'])).toBeNull();
    expect(parseServeOnly(['--watch', '--a', 'rush'])).toBeNull();
    expect(parseServeOnly(['--a', 'rush', '--b', 'passive'])).toBeNull();
    expect(parseServeOnly(['--serve', '--seeds', '3'])).toMatchObject({ error: expect.stringContaining('--serve alone') });
    expect(parseServeOnly(['--serve', 'stray'])).toMatchObject({ error: expect.stringContaining('unexpected') });
  });
  it('resolvePlayer builds a preset by its id (the template stays inside) and refuses a judge-only or unknown one', () => {
    const presets = parsePresets(JSON.stringify({ players: { p: { label: 'P', template: 'cmd:/abs/m {mcp}' }, j: { label: 'J', judgeTemplate: 'cmd:/abs/j {stats}' } } }), 'f');
    const player = resolvePlayer('preset:p', () => {}, { presets });
    expect(player.name).toBe('p');
    expect(() => resolvePlayer('preset:j', () => {}, { presets })).toThrow(/judge, not a player/);
    expect(() => resolvePlayer('preset:zz', () => {}, { presets })).toThrow(/no preset/);
    expect(() => resolvePlayer('preset:p', () => {})).toThrow(/no preset/);
  });
});

describe('the presets file gates the server', () => {
  const write = (mode: number): string => {
    const f = join(tmp('arena-modes-'), 'arena-players.json');
    writeFileSync(f, JSON.stringify({ players: { p: { label: 'P', template: 'cmd:/abs/m {mcp}' } } }));
    chmodSync(f, mode);
    return f;
  };
  it('REFUSES to start the server when the file is readable by group or world: exit 1, the reason, no server', async () => {
    for (const mode of [0o640, 0o644, 0o604, 0o666]) {
      let started = 0;
      const lines: string[] = [];
      const r = await runArena(['--serve', '--players-file', write(mode)], { log: (l) => { lines.push(l); }, print: () => {}, startServe: async (o) => { started++; return startArenaServe({ ...o, app: false }); } });
      expect(r.code, mode.toString(8)).toBe(1);
      expect(r.serving).toBeUndefined();
      expect(started, 'a server was started').toBe(0);
      expect(lines.join('\n')).toContain('chmod 600');
    }
  });
  it('starts on a 0600 file and prints the setup URL with the run token in the fragment', async () => {
    const lines: string[] = [];
    const r = await runArena(['--serve', '--players-file', write(0o600)], { log: () => {}, print: (l) => { lines.push(l); }, startServe: (o) => startArenaServe({ ...o, app: false, token: RUN_TOKEN, finishedGraceMs: 0 }) });
    closers.push(() => (r.serving as ArenaServe).close({ now: true }));
    expect(r.code).toBe(0);
    expect(lines.some((l) => l.includes(`/arena#k=${RUN_TOKEN}`))).toBe(true);
    // The presets are listed by id, never by template.
    expect(lines.join('\n')).not.toContain('/abs/m');
  });
  it('a run that names a preset (--a preset:p) is refused the same way, before any relay', async () => {
    let relays = 0;
    const lines: string[] = [];
    const r = await runArena(['--a', 'preset:p', '--b', 'rush', '--players-file', write(0o644)], { log: (l) => { lines.push(l); }, print: () => {}, startRelay: async () => { relays++; throw new Error('no'); } });
    expect(r.code).toBe(1);
    expect(relays).toBe(0);
    expect(lines.join('\n')).toContain('chmod 600');
    expect(loadPresets(write(0o600)).byId.has('p')).toBe(true);
  });
});

describe('the token, end to end on the local relay (a made-up token, a probe in place of a model)', () => {
  it('reaches the children as an environment variable ONLY, and is in no file, log, result, response or temp directory', async () => {
    const t = await rig();
    const bodies: string[] = [];
    const sniff = async (p: Promise<{ status: number; text: string }>): Promise<{ status: number; text: string }> => { const x = await p; bodies.push(x.text); return x; };
    const started = await sniff(t.post('/arena/api/start', { ...BODY, judge: 'probe', token: API_TOKEN }));
    expect(started.status).toBe(202);
    // A start while it is going is a 409 (and its token is not echoed either).
    expect((await sniff(t.post('/arena/api/start', { ...BODY, token: API_TOKEN }))).status).toBe(409);
    const done = await waitDone(t, API_TOKEN);
    expect(done.state, `${String(done.error)}\n${t.logs.slice(-12).join('\n')}`).toBe('done');
    await sniff(t.get('/arena/api/status'));
    await sniff(t.get('/arena/api/players'));

    // 1. The children HAD it: each seat's log says so, and says only a boolean.
    const logs = filesUnder(t.out).filter(([p]) => p.endsWith('.log'));
    const seatLogs = logs.filter(([p]) => /-seat[01]\.log$/.test(p));
    expect(seatLogs).toHaveLength(4);   // two games, two seats, both external
    for (const [p, text] of seatLogs) expect(text, p).toContain('{"has_key":true}');
    // 2. The log opens with what was spawned: the argv and the NAME of the variable, never its value.
    for (const [p, text] of seatLogs) expect(text.split('\n')[0], p).toMatch(/^# .*probe\.mjs.* \[env ANTHROPIC_API_KEY=\[redacted\]\]$/);
    // 3. A child that PRINTS the token (split across two writes, on stdout and stderr) wrote [redacted].
    const leaky = seatLogs.filter(([, text]) => text.includes('LEAK-OUT'));
    expect(leaky.length).toBeGreaterThan(0);
    for (const [p, text] of leaky) {
      expect(text, p).toContain('LEAK-OUT [redacted] end');
      expect(text, p).toContain('LEAK-ERR [redacted] end');
    }
    // 4. The judge was handed it too (a stub here), and its stats carry no token.
    expect(t.judged).toHaveLength(2);
    for (const j of t.judged) expect(j.env).toEqual({ [TOKEN_ENV]: API_TOKEN });

    // 5. Nowhere else: not one file under the output directory (logs, .jsonl, .md), not one captured log or print
    //    line, not a response body, and nothing left in the temp root.
    const everything = filesUnder(t.out);
    expect(everything.length).toBeGreaterThanOrEqual(6);   // four seat logs, the .jsonl and the .md
    for (const [p, text] of everything) expect(text.includes(API_TOKEN), `the token is in ${p}`).toBe(false);
    expect(t.logs.join('\n')).not.toContain(API_TOKEN);
    expect(t.logs.length).toBeGreaterThan(3);
    for (const b of bodies) expect(b).not.toContain(API_TOKEN);
    expect(filesUnder(t.tmpRoot)).toEqual([]);

    // 6. The results carry the usage the probe printed: input, output, cache, cost -- reported, in the .md and the .jsonl.
    const jsonl = everything.find(([p]) => p.endsWith('.jsonl'))?.[1] ?? '';
    expect(jsonl).toContain('"cacheReadInputTokens":45000');
    expect(jsonl).toContain('"costUsd":0.25');
    const md = everything.find(([p]) => p.endsWith('.md'))?.[1] ?? '';
    expect(md).toContain('## Usage');
    expect(md).toMatch(/\| all \| 400 \| 80 \| 12000 \| 180000 \| \$1\.0000 \|/);
    const totals = (done as { totals: { all: { costUsd: number; cacheReadInputTokens: number } } }).totals;
    expect(totals.all).toMatchObject({ costUsd: 1, cacheReadInputTokens: 180000 });
  }, 240_000);

  it('the NEXT run, started without a token, has none: the child says has_key false', async () => {
    const t = await rig();
    expect((await t.post('/arena/api/start', { ...BODY, b: 'probe', token: API_TOKEN })).status).toBe(202);
    expect((await waitDone(t, API_TOKEN)).state).toBe('done');
    expect((await t.post('/arena/api/start', { ...BODY, b: 'probe' })).status).toBe(202);
    expect((await waitDone(t, null)).state).toBe('done');
    const second = filesUnder(t.out).filter(([p]) => /-2\b.*-seat[01]\.log$/.test(p) || /-vs-probe-2.*seat/.test(p));
    expect(second.length).toBeGreaterThan(0);
    for (const [p, text] of second) {
      expect(text, p).toContain('{"has_key":false}');
      expect(text, p).not.toContain('[env');
    }
    for (const [p, text] of filesUnder(t.out)) expect(text.includes(API_TOKEN), p).toBe(false);
  }, 240_000);

  it('a run stopped from the screen ends as stopped, leaves no temp directory, and the next run can start', async () => {
    const t = await rig();
    expect((await t.post('/arena/api/start', { ...BODY, token: API_TOKEN })).status).toBe(202);
    const end = Date.now() + 60_000;
    while (filesUnder(t.tmpRoot).length === 0 && Date.now() < end) await new Promise((res) => setTimeout(res, 50));
    expect(filesUnder(t.tmpRoot).length).toBeGreaterThan(0);   // a seat is up, with its ticket
    const stopped = await t.post('/arena/api/stop', {});
    expect(stopped.status).toBe(200);
    expect(JSON.parse(stopped.text)).toEqual({ state: 'stopped' });
    expect(filesUnder(t.tmpRoot)).toEqual([]);
    expect(JSON.parse((await t.get('/arena/api/status')).text).state).toBe('stopped');
    for (const [p, text] of filesUnder(t.out)) expect(text.includes(API_TOKEN), p).toBe(false);
    // The latch is lifted: a second run starts and finishes.
    expect((await t.post('/arena/api/start', { ...BODY, b: 'probe' })).status).toBe(202);
    expect((await waitDone(t, null)).state).toBe('done');
  }, 240_000);
});

describe('what a run logs and writes goes through the redactor', () => {
  it('a token in an error message is [redacted] in the log, in the returned error and in the exit', async () => {
    const lines: string[] = [];
    const r: ArenaRun = await runArena(['--a', 'rush', '--b', 'passive', '--out', tmp('arena-redact-')], {
      log: (l) => { lines.push(l); }, print: (l) => { lines.push(l); },
      env: { [TOKEN_ENV]: API_TOKEN },
      resolvePlayer: () => { throw new Error(`the client said ${API_TOKEN}`); },
    });
    expect(r.code).toBe(1);
    expect(lines.join('\n')).toContain('the client said [redacted]');
    expect(lines.join('\n')).not.toContain(API_TOKEN);
    expect(r.error).toBe('the client said [redacted]');
  });
});

describe('the results files are redacted too', () => {
  it('a player report that carries the token (an error it printed) reaches the .jsonl and the .md as [redacted]', async () => {
    const out = tmp('arena-results-redact-');
    const wrap = (p: ArenaPlayer): ArenaPlayer => ({ name: p.name, start: async (s) => { const r = await p.start(s); return { ...r, done: r.done.then((rep) => ({ ...rep, errors: [`the client printed ${API_TOKEN}`] })) }; } });
    const r = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--first-seed', '0', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '200', '--out', out], {
      log: () => {}, print: () => {},
      env: { [TOKEN_ENV]: API_TOKEN },
      resolvePlayer: (spec) => wrap(spec === 'rush' ? inProcess('rush', rush) : inProcess('passive', passive)),
    });
    expect(r.code).toBe(0);
    // Not vacuous: the record the run holds in memory DID carry it; the files must not.
    expect(JSON.stringify(r.games)).toContain(API_TOKEN);
    const files = filesUnder(out);
    expect(files.map(([p]) => p.split('.').pop()).sort()).toEqual(['jsonl', 'md']);
    for (const [p, text] of files) {
      expect(text.includes(API_TOKEN), p).toBe(false);
      expect(text, p).toContain('[redacted]');
    }
  }, 60_000);
});

describe('the results files are redacted in their JSON-escaped form too', () => {
  it('a token with a quote and a backslash (which JSON escapes) never reaches the .jsonl, in either spelling', async () => {
    const TRICKY = 'sk-fake-"quote\\back-0123456789';
    const escaped = JSON.stringify(TRICKY).slice(1, -1);
    expect(escaped).not.toBe(TRICKY);   // not vacuous: the two spellings differ
    const out = tmp('arena-results-escape-');
    const wrap = (p: ArenaPlayer): ArenaPlayer => ({ name: p.name, start: async (s) => { const r = await p.start(s); return { ...r, done: r.done.then((rep) => ({ ...rep, errors: [`the client printed ${TRICKY}`] })) }; } });
    const lines: string[] = [];
    const r = await runArena(['--a', 'rush', '--b', 'passive', '--seeds', '1', '--first-seed', '0', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '200', '--out', out], {
      log: (l) => { lines.push(l); }, print: () => {},
      env: { [TOKEN_ENV]: TRICKY },
      resolvePlayer: (spec) => wrap(spec === 'rush' ? inProcess('rush', rush) : inProcess('passive', passive)),
    });
    expect(r.code).toBe(0);
    for (const [p, text] of filesUnder(out)) {
      expect(text.includes(TRICKY), `${p} has the token`).toBe(false);
      expect(text.includes(escaped), `${p} has the escaped token`).toBe(false);
      expect(text, p).toContain('[redacted]');
    }
  }, 60_000);
});

describe('a Stop at any moment ends the run at once (no wait for a match that cannot start)', () => {
  const stubPlayer = (name: string, seatStarts: { n: number }, gate: Promise<void>): ArenaPlayer => ({
    name,
    start: async () => {
      const n = ++seatStarts.n;
      if (n === 2) await gate;   // seat 1 is still starting when the Stop lands
      return { client: null, done: Promise.resolve({ tokens: null, timeouts: 0, errors: [] }), stop: async () => {} };
    },
  });
  const never = new Promise<never>(() => {});
  const endsSoon = async (run: Promise<ArenaRun>): Promise<ArenaRun | 'hung'> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([run, new Promise<'hung'>((res) => { t = setTimeout(() => { res('hung'); }, 10_000); })]);
    clearTimeout(t);
    return r;
  };

  it('between seat 1 starting and the match start: the run ends stopped, with no observer started', async () => {
    const seatStarts = { n: 0 };
    let releaseSeat1: () => void = () => {};
    const gate = new Promise<void>((res) => { releaseSeat1 = res; });
    let observers = 0;
    const out = tmp('arena-stop-race-');
    const run = runArena(['--a', 'cmd:x', '--b', 'cmd:y', '--seeds', '1', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '400', '--out', out], {
      log: () => {}, print: () => {},
      resolvePlayer: (spec) => stubPlayer(spec, seatStarts, gate),
      startObserver: async () => { observers++; return { client: { ready: never } as unknown as AgentClient, done: never, stop: async () => {} }; },
    });
    try {
      const end = Date.now() + 10_000;
      while (seatStarts.n < 2 && Date.now() < end) await new Promise((res) => setTimeout(res, 5));
      expect(seatStarts.n).toBe(2);
      await stopRun({ servers: false });   // wakes nobody: no game has reached its wait yet
      releaseSeat1();
      const r = await endsSoon(run);
      expect(r).not.toBe('hung');
      expect((r as ArenaRun).code).toBe(1);
      expect((r as ArenaRun).error).toContain('stopped');
      expect(observers).toBe(0);
    } finally {
      releaseSeat1();
      rearm();
    }
  }, 40_000);

  it('during the observer\'s start (after the seats): the wait for the match start refuses at once', async () => {
    const seatStarts = { n: 0 };
    const out = tmp('arena-stop-race2-');
    const run = runArena(['--a', 'cmd:x', '--b', 'cmd:y', '--seeds', '1', '--pace', '40', '--tick-ms', '1', '--cap-ticks', '400', '--out', out], {
      log: () => {}, print: () => {},
      resolvePlayer: (spec) => stubPlayer(spec, seatStarts, Promise.resolve()),
      startObserver: async () => {
        await stopRun({ servers: false });   // lands after the seat check, before the game waits for its start
        return { client: { ready: never } as unknown as AgentClient, done: never, stop: async () => {} };
      },
    });
    try {
      const r = await endsSoon(run);
      expect(r).not.toBe('hung');
      expect((r as ArenaRun).code).toBe(1);
      expect((r as ArenaRun).error).toContain('stopped');
    } finally {
      rearm();
    }
  }, 40_000);
});

// Used so a falsification can name the fake child without running a game.
describe('the probe itself', () => {
  it('prints a boolean for the variable, never its value', () => {
    const dir = tmp('arena-probe-');
    const f = join(dir, 'p.mjs');
    writeFileSync(f, PROBE);
    const withKey = spawnSync(process.execPath, [f], { env: { ...process.env, [TOKEN_ENV]: API_TOKEN }, encoding: 'utf8' });
    expect(withKey.stdout).toContain('{"has_key":true}');
    expect(withKey.stdout).not.toContain(API_TOKEN);
    const without = spawnSync(process.execPath, [f], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8' });
    expect(without.stdout).toContain('{"has_key":false}');
  });
});
