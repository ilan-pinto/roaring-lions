// GH-954 W2: the setup screen's control API, over a real 127.0.0.1 socket (no Vite) with a FAKE run in place of
// `runArena`, so nothing here plays a game, starts a model or reads a key. The token below is a made-up string.
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ArenaDeps } from './arena';
import { createArenaControl, parseStartBody, TOKEN_ENV, type ArenaControl } from './arena-control';
import { parsePresets } from './arena-presets';
import type { GameRecord } from './arena-score';
import { RUN_FIELDS } from './score-fixture';
import { startArenaServe, type ArenaServe } from './arena-serve';

const RUN_TOKEN = 'a-long-random-run-token';
/** A made-up API token: the shape of a key, the value of nothing. */
const API_TOKEN = 'sk-test-0123456789abcdefXYZ';
const TEMPLATE = 'cmd:/abs/secret-model-binary --mcp-config {mcp} < {prompt}';
const JUDGE_TEMPLATE = 'cmd:/abs/secret-judge-binary --stats {stats} < {prompt}';
const presets = parsePresets(JSON.stringify({ players: {
  'opus-5.5': { label: 'Claude Opus 5.5', template: TEMPLATE, judgeTemplate: JUDGE_TEMPLATE },
  'player-only': { label: 'Player only', template: TEMPLATE },
  'judge-only': { label: 'Judge only', judgeTemplate: JUDGE_TEMPLATE },
} }), 'test.json');
const GOOD = { a: 'rush', b: 'opus-5.5', map: 'tel_marum', matchup: 'mirror', seeds: 1, pace: 40, roundWallMs: 5000, capTicks: 400 };

describe('parseStartBody (pure)', () => {
  const ok = (body: unknown) => parseStartBody(body, presets);
  it('turns a good body into the argv the command line would take: presets as preset:<id>, always --watch', () => {
    const r = ok({ ...GOOD, judge: 'opus-5.5', token: API_TOKEN });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.argv).toEqual(['--a', 'rush', '--b', 'preset:opus-5.5', '--map', 'tel_marum', '--matchup', 'mirror', '--seeds', '1', '--pace', '40', '--round-wall-ms', '5000', '--cap-ticks', '400', '--judge', 'preset:opus-5.5', '--watch']);
    // The token is a result field of its own and in no argv, no summary.
    expect(r.token).toBe(API_TOKEN);
    expect(JSON.stringify(r.argv)).not.toContain(API_TOKEN);
    expect(JSON.stringify(r.run)).not.toContain(API_TOKEN);
    expect(r.run).toMatchObject({ a: 'rush', b: 'opus-5.5', judge: 'opus-5.5', withToken: true });
  });
  it('REFUSES any field it does not know -- a template above all -- and a body that is not an object', () => {
    for (const extra of [{ template: 'cmd:evil' }, { out: '/tmp/x' }, { tickMs: 1 }, { 'players-file': '/x' }, { env: { A: 'b' } }, { __proto__: { x: 1 }, serve: true }]) {
      expect(ok({ ...GOOD, ...extra }), JSON.stringify(extra)).toEqual({ ok: false, error: 'unknown_field' });
    }
    for (const b of [null, 1, 'x', [], undefined]) expect(ok(b)).toEqual({ ok: false, error: 'body' });
  });
  it('REFUSES an unknown preset, a cmd: or preset: spelling, a judge without a judge template and a player without a player template', () => {
    for (const a of ['nope', 'cmd:node x', 'preset:opus-5.5', 'judge-only', 'constructor', '__proto__', '', 5, null]) expect(ok({ ...GOOD, a }), String(a)).toEqual({ ok: false, error: 'bad_player' });
    for (const judge of ['nope', 'player-only', 'rush', 'cmd:node x', 5]) expect(ok({ ...GOOD, judge }), String(judge)).toEqual({ ok: false, error: 'bad_judge' });
    expect(ok({ ...GOOD, judge: null }).ok).toBe(true);
    expect(ok({ ...GOOD, judge: 'judge-only' }).ok).toBe(true);
  });
  it('lets the arena\'s own parser refuse numbers, the map and the matchup, naming no value', () => {
    expect(ok({ ...GOOD, seeds: '1' })).toEqual({ ok: false, error: 'bad_number' });
    expect(ok({ ...GOOD, seeds: 1.5 })).toEqual({ ok: false, error: 'bad_number' });
    expect(ok({ ...GOOD, seeds: 0 })).toMatchObject({ ok: false, error: 'bad_args' });
    expect(ok({ ...GOOD, pace: 19 })).toMatchObject({ ok: false, error: 'bad_args' });
    expect(ok({ ...GOOD, capTicks: 10_000_000 })).toMatchObject({ ok: false, error: 'bad_args' });
    expect(ok({ ...GOOD, map: 'tutorial_ground' })).toEqual({ ok: false, error: 'map_refused' });
    expect(ok({ ...GOOD, map: '../etc' })).toEqual({ ok: false, error: 'bad_map' });
    expect(ok({ ...GOOD, matchup: 'both' })).toEqual({ ok: false, error: 'bad_matchup' });
  });
  it('GH-976 P3: mode is annihilation (an argv with no --mode) or a mode the lobby offers on this map and matchup; anything else is bad_mode', () => {
    const base = { ...GOOD, map: 'wadi_tarfan' };
    // the default names nothing: argv-identical to a body with no mode at all
    const plain = ok(base);
    const named = ok({ ...base, mode: 'annihilation' });
    expect(plain.ok && named.ok && named.argv).toEqual(plain.ok && plain.argv);
    expect(plain.ok && plain.run.mode).toBe('annihilation');
    expect(ok({ ...base, mode: null }).ok).toBe(true);
    // an offered mode goes to the arena's own --mode, after the matchup, and the summary names it
    for (const mode of ['points']) {
      const r = ok({ ...base, mode });
      expect(r.ok, mode).toBe(true);
      if (!r.ok) continue;
      expect(r.argv.slice(r.argv.indexOf('--matchup'), r.argv.indexOf('--matchup') + 4), mode).toEqual(['--matchup', 'mirror', '--mode', mode]);
      expect(r.run.mode).toBe(mode);
    }
    // GH-976 P4: the five other open maps offer both modes in the mirror: each goes to the arena's own --mode with its matchup in front of it.
    for (const [map, matchup, mode] of [['tel_marum', 'mirror', 'points'], ['milh_flats_l', 'mirror', 'points'], ] as const) {
      const r = ok({ ...base, map, matchup, mode });
      expect(r.ok, `${map} ${matchup} ${mode}`).toBe(true);
      if (!r.ok) continue;
      expect(r.argv.slice(r.argv.indexOf('--matchup'), r.argv.indexOf('--matchup') + 4), `${map} ${matchup} ${mode}`).toEqual(['--matchup', matchup, '--mode', mode]);
    }
    // GH-976, 12 Nov: points is delisted on rujm_sawda and beit_sahwan_outskirts (drifted past 60/40)
    for (const map of ['rujm_sawda', 'beit_sahwan_outskirts']) expect(ok({ ...base, map, matchup: 'mirror', mode: 'points' }), map).toEqual({ ok: false, error: 'bad_mode' });
    // camp is read fair nowhere, a faction pairing nobody read fair is offered none (the flag on Wadi Tarfan (large), anything on
    // Wadi Tarfan or Tel Marum), a mirror-only map refuses the pairing itself, and a stranger is not a mode
    for (const [over, why] of [[{ mode: 'camp', map: 'tel_marum' }, 'camp unoffered on tel_marum'], [{ mode: 'flag', map: 'wadi_tarfan_l', matchup: 'kdf' }, 'flag kdf v sarim'], [{ mode: 'points', map: 'wadi_tarfan_l', matchup: 'sarim' }, 'wadi_tarfan_l sarim host'], [{ mode: 'points', matchup: 'sarim' }, 'wadi_tarfan sarim host'], [{ mode: 'points', map: 'tel_marum', matchup: 'kdf' }, 'tel_marum kdf host'], [{ mode: 'flag' }, 'flag out of the lobby (GH-1139)'], [{ mode: 'flag', map: 'tel_marum' }, 'flag out on tel_marum (GH-1139)'], [{ mode: 'rally' }, 'unknown'], [{ mode: 5 }, 'number'], [{ mode: '' }, 'empty']] as const) {
      expect(ok({ ...base, ...over }), why).toEqual({ ok: false, error: 'bad_mode' });
    }
  });

  it('accepts only a printable token of a sane length', () => {
    for (const token of ['short', 'has space in it', 'tab\there-token', 'nul\u0000-token-xx', 'x'.repeat(513), 5, {}, 'quote"-token-xxxxx', 'back\\slash-token-x']) expect(ok({ ...GOOD, token }), String(token)).toEqual({ ok: false, error: 'bad_token' });
    expect(ok({ ...GOOD, token: 'x'.repeat(512) }).ok).toBe(true);
    expect(ok({ ...GOOD, token: null }).ok).toBe(true);
    const none = ok(GOOD);
    expect(none.ok && none.token).toBeNull();
  });
});

// --- the API over a socket -------------------------------------------------------------------------------------

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    try { await cleanups.pop()?.(); } catch { /* the next still runs */ }
  }
});

interface Raw { status: number; text: string }
function raw(s: ArenaServe, o: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: s.port, method: o.method ?? 'GET', path: o.path, headers: { host: `127.0.0.1:${s.port}`, ...o.headers } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8') }); });
    });
    req.on('error', reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

interface Rig {
  serve: ArenaServe;
  control: ArenaControl;
  /** Every response body this rig has seen, for the no-leak sweep. */
  seen: string[];
  get(path: string): Promise<Raw>;
  post(path: string, body: unknown): Promise<Raw>;
  runs: { argv: string[]; deps: ArenaDeps; env: Record<string, string> | undefined; hadKey: boolean }[];
  /** Lets the fake run in progress finish. */
  finish(): void;
  stops: number;
  rearms: number;
  /** How the fake run ends once let go: `ok` (code 0), `code1` (a run that failed), `throw` (a run that rejects, naming the token). */
  mode: 'ok' | 'code1' | 'throw';
  /** Whether Stop lets the fake run go (a run that ignores it stays until `finish()`). */
  stopReleases: boolean;
}
const record = (): GameRecord => ({
  ...RUN_FIELDS, seed: 1000, map: 'tel_marum', matchup: 'mirror', players: ['rush', 'opus-5.5'], factions: ['kdf', 'kdf'], outcome: 'seat0', by: 'cap', ticks: 400,
  score: [{ lost: 0, lostValue: 0, destroyed: 0, destroyedValue: 0, remaining: 1 }, { lost: 0, lostValue: 0, destroyed: 0, destroyedValue: 0, remaining: 1 }],
  reports: [{ tokens: null, timeouts: 0, errors: [] }, { tokens: 120, usage: { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 30, cacheReadInputTokens: 40, costUsd: 0.5 }, timeouts: 0, errors: [] }],
});

async function rig(o: { stopWaitMs?: number } = {}): Promise<Rig> {
  const r = { runs: [], seen: [], stops: 0, rearms: 0, mode: 'ok', stopReleases: true } as unknown as Rig;
  let release: () => void = () => {};
  let gate = new Promise<void>((res) => { release = res; });
  const control = createArenaControl({
    presets,
    log: () => {},
    run: async (argv, deps) => {
      const env = deps.env === undefined ? undefined : deps.env as Record<string, string>;
      r.runs.push({ argv, deps, env, hadKey: env !== undefined && env[TOKEN_ENV] !== undefined });
      deps.onGameEnd?.({ n: 1, of: 2, record: record(), referee: { tick: 400, hash: 1 } });
      await gate;
      if (r.mode === 'throw') throw new Error(`the client crashed with ${env?.[TOKEN_ENV] ?? 'nothing'}`);
      return { code: r.mode === 'code1' ? 1 : 0, games: [record()], tally: null, files: null, gate: null, ...(r.mode === 'code1' ? { error: 'a game could not be played' } : {}) };
    },
    ...(o.stopWaitMs === undefined ? {} : { stopWaitMs: o.stopWaitMs }),
    stop: async () => { r.stops++; if (r.stopReleases) release(); },
    rearm: () => { r.rearms++; },
  });
  const serve = await startArenaServe({ app: false, token: RUN_TOKEN, log: () => {}, finishedGraceMs: 0, routes: control.routes });
  control.attach(serve);
  cleanups.push(() => serve.close({ now: true }));
  const auth = { 'x-arena-token': RUN_TOKEN };
  const remember = async (p: Promise<Raw>): Promise<Raw> => { const x = await p; r.seen.push(x.text); return x; };
  Object.assign(r, {
    serve, control,
    get: (path: string) => remember(raw(serve, { path, headers: auth })),
    post: (path: string, body: unknown) => remember(raw(serve, { method: 'POST', path, headers: { ...auth, origin: serve.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })),
    finish: () => { release(); gate = new Promise<void>((res) => { release = res; }); },
  });
  return r;
}
const json = (x: Raw): Record<string, unknown> => JSON.parse(x.text) as Record<string, unknown>;
async function until(f: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!f() && Date.now() < end) await new Promise((res) => setTimeout(res, 10));
  expect(f()).toBe(true);
}

describe('GET /arena/api/players', () => {
  it('lists id, label and kind and nothing else; no template, command or path is in the body', async () => {
    const t = await rig();
    const r = await t.get('/arena/api/players');
    expect(r.status).toBe(200);
    const body = json(r) as { players: { id: string; label: string; kind: string }[] };
    expect(body.players.map((p) => p.id)).toEqual(['passive', 'rush', 'opus-5.5', 'player-only', 'judge-only']);
    for (const p of body.players) expect(Object.keys(p).sort()).toEqual(['id', 'kind', 'label']);
    expect(r.text).not.toMatch(/cmd:|secret-model-binary|secret-judge-binary|\{mcp\}|\{prompt\}|\/abs\//);
  });
  it('every action is a POST: a GET for start or stop is 405 and runs nothing', async () => {
    const t = await rig();
    expect((await t.get('/arena/api/start')).status).toBe(405);
    expect((await t.get('/arena/api/stop')).status).toBe(405);
    expect((await raw(t.serve, { method: 'POST', path: '/arena/api/status', headers: { 'x-arena-token': RUN_TOKEN, origin: t.serve.origin }, body: '{}' })).status).toBe(405);
    expect((await raw(t.serve, { method: 'POST', path: '/arena/api/players', headers: { 'x-arena-token': RUN_TOKEN, origin: t.serve.origin }, body: '{}' })).status).toBe(405);
    expect(t.runs).toHaveLength(0);
  });
});

describe('POST /arena/api/start', () => {
  it('an unknown field, an unknown preset, a template and a bad token are each a 400 that starts nothing and names no value', async () => {
    const t = await rig();
    const cases: [unknown, string][] = [
      [{ ...GOOD, template: TEMPLATE }, 'unknown_field'],
      [{ ...GOOD, token: API_TOKEN, extra: 1 }, 'unknown_field'],
      [{ ...GOOD, b: 'no-such-preset' }, 'bad_player'],
      [{ ...GOOD, b: 'cmd:node -e 1' }, 'bad_player'],
      [{ ...GOOD, judge: 'player-only' }, 'bad_judge'],
      [{ ...GOOD, token: 'two words here' }, 'bad_token'],
    ];
    for (const [body, error] of cases) {
      const r = await t.post('/arena/api/start', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(json(r).error).toBe(error);
    }
    expect((await t.post('/arena/api/start', 'not an object')).status).toBe(400);
    expect(t.runs).toHaveLength(0);
    expect(json(await t.get('/arena/api/status')).state).toBe('idle');
    expect(t.seen.join('\n')).not.toContain(API_TOKEN);
    expect(t.seen.join('\n')).not.toContain('no-such-preset');
  });

  it('starts a run (202) and a SECOND start while it is going is 409 and starts nothing', async () => {
    const t = await rig();
    const first = await t.post('/arena/api/start', GOOD);
    expect(first.status).toBe(202);
    await until(() => t.runs.length === 1);
    const second = await t.post('/arena/api/start', GOOD);
    expect(second.status).toBe(409);
    expect(json(second)).toEqual({ error: 'busy' });
    expect(t.runs).toHaveLength(1);
    // Busy outranks nothing else: a malformed body is still a 400, not a 409.
    expect((await t.post('/arena/api/start', { ...GOOD, template: 'x' })).status).toBe(400);
    // GH-976 P3: the status names the mode the run plays.
    expect((json(await t.get('/arena/api/status')) as { run: { mode: string } }).run.mode).toBe('annihilation');
    const s = json(await t.get('/arena/api/status')) as { state: string; game: { n: number; of: number }; games: { n: number; outcome: string; usage: unknown[] }[] };
    expect(s.state).toBe('running');
    expect(s.game).toEqual({ n: 2, of: 2 });
    expect(s.games[0]).toMatchObject({ n: 1, outcome: 'seat0' });
    t.finish();
    await t.control.idle();
    const done = json(await t.get('/arena/api/status')) as { state: string; totals: { all: { costUsd: number } } };
    expect(done.state).toBe('done');
    expect(done.totals.all.costUsd).toBe(0.5);
    // A finished run frees the slot.
    expect((await t.post('/arena/api/start', GOOD)).status).toBe(202);
    t.finish();
    await t.control.idle();
  });

  it('the status reports each finished game\'s usage and the run\'s totals, never scored', async () => {
    const t = await rig();
    await t.post('/arena/api/start', GOOD);
    await until(() => t.runs.length === 1);
    const s = json(await t.get('/arena/api/status')) as { games: { usage: ({ cacheReadInputTokens: number } | null)[] }[]; totals: { players: { player: string; usage: { inputTokens: number; cacheCreationInputTokens: number } }[]; all: { inputTokens: number } } };
    expect(s.games[0].usage).toEqual([null, { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 30, cacheReadInputTokens: 40, costUsd: 0.5 }]);
    expect(s.totals.players).toHaveLength(1);
    expect(s.totals.players[0]).toMatchObject({ player: 'opus-5.5', usage: { inputTokens: 100, cacheCreationInputTokens: 30 } });
    expect(s.totals.all.inputTokens).toBe(100);
    t.finish();
    await t.control.idle();
  });
});

describe('POST /arena/api/stop', () => {
  it('runs the stop, waits for the run to end, re-arms the latch, and the state is stopped; a stop with nothing running is a no-op', async () => {
    const t = await rig();
    expect(json(await t.post('/arena/api/stop', {}))).toEqual({ state: 'idle' });
    expect(t.stops).toBe(0);
    await t.post('/arena/api/start', GOOD);
    await until(() => t.runs.length === 1);
    const r = await t.post('/arena/api/stop', {});
    expect(r.status).toBe(200);
    expect(t.stops).toBe(1);
    expect(t.rearms).toBe(1);
    expect(json(r)).toEqual({ state: 'stopped' });
    expect(json(await t.get('/arena/api/status')).state).toBe('stopped');
    // The slot is free again.
    expect((await t.post('/arena/api/start', GOOD)).status).toBe(202);
    t.finish();
    await t.control.idle();
    expect((await t.post('/arena/api/stop', { template: 'x' })).status).toBe(400);
  });
});

describe('the private token (D-W6 as amended)', () => {
  it('goes to the run as one environment entry, is held by the control while it runs, and is deleted when it ends', async () => {
    const t = await rig();
    await t.post('/arena/api/start', { ...GOOD, token: API_TOKEN });
    await until(() => t.runs.length === 1);
    expect(t.runs[0].hadKey).toBe(true);
    expect(t.runs[0].env).toEqual({ [TOKEN_ENV]: API_TOKEN });
    expect(t.runs[0].argv.join(' ')).not.toContain(API_TOKEN);
    expect(t.control.holdsToken()).toBe(true);
    t.finish();
    await t.control.idle();
    expect(t.control.holdsToken()).toBe(false);
    // The very object the run was handed is empty: nothing keeps the value alive through it.
    expect(t.runs[0].env).toEqual({});
  });
  it('a run started without one is handed none -- the previous run\'s token does not carry over', async () => {
    const t = await rig();
    await t.post('/arena/api/start', { ...GOOD, token: API_TOKEN });
    await until(() => t.runs.length === 1);
    t.finish();
    await t.control.idle();
    await t.post('/arena/api/start', GOOD);
    await until(() => t.runs.length === 2);
    expect(t.runs[1].hadKey).toBe(false);
    expect(t.runs[1].env).toBeUndefined();
    expect(t.control.holdsToken()).toBe(false);
    t.finish();
    await t.control.idle();
  });
  it('is deleted when the run is stopped', async () => {
    const t = await rig();
    await t.post('/arena/api/start', { ...GOOD, token: API_TOKEN });
    await until(() => t.runs.length === 1);
    await t.post('/arena/api/stop', {});
    await t.control.idle();
    expect(t.control.holdsToken()).toBe(false);
    expect(t.runs[0].env).toEqual({});
  });
  it('is deleted when the run REJECTS, and the error it carries is redacted with that run\'s token', async () => {
    const t = await rig();
    t.mode = 'throw';
    await t.post('/arena/api/start', { ...GOOD, token: API_TOKEN });
    await until(() => t.runs.length === 1);
    expect(t.control.holdsToken()).toBe(true);
    t.finish();
    await t.control.idle();
    expect(t.control.holdsToken()).toBe(false);
    expect(t.runs[0].env).toEqual({});
    const s = json(await t.get('/arena/api/status')) as { state: string; error: string };
    expect(s.state).toBe('failed');
    expect(s.error).toBe('the client crashed with [redacted]');
    expect(t.seen.join('\n')).not.toContain(API_TOKEN);
  });
  it('is deleted when the run ends with a non-zero code (a failed run)', async () => {
    const t = await rig();
    t.mode = 'code1';
    await t.post('/arena/api/start', { ...GOOD, token: API_TOKEN });
    await until(() => t.runs.length === 1);
    t.finish();
    await t.control.idle();
    expect(t.control.holdsToken()).toBe(false);
    expect(t.runs[0].env).toEqual({});
    expect(json(await t.get('/arena/api/status'))).toMatchObject({ state: 'failed', error: 'a game could not be played' });
  });
  it('a token with a quote, a backslash or any other character JSON would escape is refused', async () => {
    const t = await rig();
    for (const token of ['sk-fake-"quote-0123456789', 'sk-fake-back\\slash-0123456789', "sk-fake-'single-0123456789", 'sk-fake-<tag>-0123456789', 'sk-fake-$HOME-0123456789']) {
      expect((await t.post('/arena/api/start', { ...GOOD, token })).status, token).toBe(400);
    }
    expect(t.runs).toHaveLength(0);
  });
  it('Stop does not lift the latch while the run it stopped is still alive; the run\'s own end does', async () => {
    const t = await rig({ stopWaitMs: 50 });
    t.stopReleases = false;
    await t.post('/arena/api/start', { ...GOOD, token: API_TOKEN });
    await until(() => t.runs.length === 1);
    const r = await t.post('/arena/api/stop', {});
    expect(json(r)).toEqual({ state: 'stopping' });
    expect(t.stops).toBe(1);
    expect(t.rearms).toBe(0);
    expect((await t.post('/arena/api/start', GOOD)).status).toBe(409);
    t.finish();
    await t.control.idle();
    expect(t.rearms).toBe(1);
    expect(json(await t.get('/arena/api/status')).state).toBe('stopped');
    expect(t.control.holdsToken()).toBe(false);
  });
  it('is in NO response body or header the API ever sent: not on start, status, players, stop, any 400 or 409, and no template either', async () => {
    const t = await rig();
    const heads: string[] = [];
    const sniff = async (p: Promise<Raw>): Promise<void> => { heads.push((await p).text); };
    await sniff(t.post('/arena/api/start', { ...GOOD, token: API_TOKEN }));
    await until(() => t.runs.length === 1);
    await sniff(t.post('/arena/api/start', { ...GOOD, token: API_TOKEN }));           // 409
    await sniff(t.post('/arena/api/start', { ...GOOD, token: API_TOKEN, template: TEMPLATE }));   // 400
    await sniff(t.post('/arena/api/start', { ...GOOD, token: `${API_TOKEN} x` }));    // bad token
    await sniff(t.get('/arena/api/status'));
    await sniff(t.get('/arena/api/players'));
    await sniff(t.post('/arena/api/stop', {}));
    await sniff(t.get('/arena/api/status'));
    for (const text of [...t.seen, ...heads]) {
      expect(text).not.toContain(API_TOKEN);
      expect(text).not.toContain('secret-model-binary');
      expect(text).not.toContain('secret-judge-binary');
      expect(text).not.toMatch(/cmd:/);
    }
    expect(t.seen.length).toBeGreaterThan(6);
  });
});
