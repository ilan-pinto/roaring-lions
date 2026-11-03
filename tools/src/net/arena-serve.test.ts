// GH-954 W1: the arena's local server. Real sockets on 127.0.0.1 (the OS's port), no Vite (`app: false`) except
// where a test says so; `node:http` is used because `fetch` will not let a test set `Host`.
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startArenaServe, requestRefusal, tokenMatches, ownOrigins, type ArenaServe, type GameStart } from './arena-serve';
import { startLocalRelay, type LocalRelay } from './local-relay';
import type { GameRecord } from './arena-score';

const TOKEN = 'a-long-random-run-token';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    try { await cleanups.pop()?.(); } catch { /* the next still runs */ }
  }
});
async function serveOf(o: Parameters<typeof startArenaServe>[0] = {}): Promise<ArenaServe> {
  const s = await startArenaServe({ app: false, token: TOKEN, log: () => {}, finishedGraceMs: 0, ...o });
  cleanups.push(() => s.close({ now: true }));
  return s;
}

interface Raw { status: number; headers: Record<string, string | string[] | undefined>; text: string }
function raw(s: ArenaServe, o: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: s.port, method: o.method ?? 'GET', path: o.path, headers: { host: `127.0.0.1:${s.port}`, ...o.headers } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }); });
    });
    req.on('error', reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}
const api = (s: ArenaServe, path: string, headers: Record<string, string> = {}): Promise<Raw> => raw(s, { path, headers: { 'x-arena-token': TOKEN, ...headers } });

describe('arena-serve: the guards (pure)', () => {
  const o = { port: 5555, token: TOKEN };
  it('requestRefusal: host, origin and token, in that order, and only the API wants a token', () => {
    const ok = { host: '127.0.0.1:5555' };
    expect(requestRefusal(ok, { ...o, tokenHeader: TOKEN }, true, 'GET')).toBeNull();
    expect(requestRefusal({ host: 'localhost:5555' }, { ...o, tokenHeader: TOKEN }, true, 'GET')).toBeNull();
    expect(requestRefusal({ host: 'evil.example' }, { ...o, tokenHeader: TOKEN }, true, 'GET')).toEqual({ status: 421, why: 'host' });
    expect(requestRefusal({ host: '127.0.0.1' }, { ...o, tokenHeader: TOKEN }, true, 'GET')).toEqual({ status: 421, why: 'host' });
    expect(requestRefusal({ host: '127.0.0.1:5556' }, { ...o, tokenHeader: TOKEN }, true, 'GET')).toEqual({ status: 421, why: 'host' });
    expect(requestRefusal({ host: undefined }, { ...o, tokenHeader: TOKEN }, true, 'GET')).toEqual({ status: 421, why: 'host' });
    expect(requestRefusal({ ...ok, origin: 'https://evil.example' }, { ...o, tokenHeader: TOKEN }, true, 'GET')).toEqual({ status: 403, why: 'origin' });
    expect(requestRefusal({ ...ok, origin: 'http://127.0.0.1:5555' }, { ...o, tokenHeader: TOKEN }, true, 'POST')).toBeNull();
    expect(requestRefusal(ok, { ...o, tokenHeader: TOKEN }, true, 'POST')).toEqual({ status: 403, why: 'origin' });
    expect(requestRefusal(ok, o, true, 'GET')).toEqual({ status: 403, why: 'token' });
    expect(requestRefusal(ok, { ...o, tokenHeader: 'nope' }, true, 'GET')).toEqual({ status: 403, why: 'token' });
    // A page needs no token (it cannot carry one in a request line); its host and origin are still judged.
    expect(requestRefusal(ok, o, false, 'GET')).toBeNull();
  });
  it('tokenMatches takes only the exact string', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    for (const bad of ['abd', 'ab', 'abcd', '', undefined, ['abc']]) expect(tokenMatches('abc', bad as string)).toBe(false);
    expect(ownOrigins(1)).toEqual(['http://127.0.0.1:1', 'http://localhost:1']);
  });
});

describe('arena-serve: over a socket', () => {
  it('binds 127.0.0.1 only and prints the token in the URL fragment, never the path', async () => {
    const s = await serveOf();
    expect(s.address).toBe('127.0.0.1');
    expect(s.origin).toBe(`http://127.0.0.1:${s.port}`);
    expect(s.url('/arena/watch')).toBe(`http://127.0.0.1:${s.port}/arena/watch#k=${TOKEN}`);
    expect(new URL(s.url('/arena/watch')).search).toBe('');
    expect(new URL(s.url('/arena/watch')).pathname).toBe('/arena/watch');
  });

  it('serves /arena/api/live with the right host, token and no origin (a same-origin GET); waiting before any game', async () => {
    const s = await serveOf();
    const r = await api(s, '/arena/api/live');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(r.text)).toMatchObject({ state: 'waiting', game: null, ticket: null, wsUrl: null, last: null });
    // localhost is the same server.
    expect((await raw(s, { path: '/arena/api/live', headers: { host: `localhost:${s.port}`, 'x-arena-token': TOKEN } })).status).toBe(200);
  });

  it('refuses a wrong Host (421), a wrong Origin (403) and a wrong or missing token (403), and runs no handler for them', async () => {
    let ran = 0;
    const s = await serveOf({ routes: { act: { method: 'POST', handle: () => { ran++; return { status: 200, body: { ok: true } }; } } } });
    expect((await raw(s, { path: '/arena/api/live', headers: { host: 'evil.example', 'x-arena-token': TOKEN } })).status).toBe(421);
    expect((await raw(s, { path: '/arena/api/live', headers: { host: `127.0.0.1:${s.port + 1}`, 'x-arena-token': TOKEN } })).status).toBe(421);
    expect((await api(s, '/arena/api/live', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await api(s, '/arena/api/live', { origin: 'http://127.0.0.1:1' })).status).toBe(403);
    expect((await raw(s, { path: '/arena/api/live' })).status).toBe(403);
    expect((await raw(s, { path: '/arena/api/live', headers: { 'x-arena-token': 'wrong' } })).status).toBe(403);
    // A page request gets the host and origin rules too.
    expect((await raw(s, { path: '/arena/watch', headers: { host: 'evil.example' } })).status).toBe(421);
    expect((await raw(s, { path: '/arena/watch', headers: { origin: 'https://evil.example' } })).status).toBe(403);
    for (const h of [{ host: 'evil.example' }, { origin: 'https://evil.example' }, {}] as Record<string, string>[]) {
      await raw(s, { method: 'POST', path: '/arena/api/act', headers: { origin: s.origin, ...h, ...(h.host === undefined ? { 'x-arena-token': 'wrong' } : { 'x-arena-token': TOKEN }) }, body: '{}' });
    }
    expect(ran).toBe(0);
  });

  it('a GET for an action (a POST route) is 405 and the action is not run; a POST wants Origin and the token', async () => {
    let ran = 0;
    const s = await serveOf({ routes: { act: { method: 'POST', handle: () => { ran++; return { status: 200, body: { ok: true } }; } } } });
    const get = await api(s, '/arena/api/act');
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe('POST');
    expect(ran).toBe(0);
    expect((await raw(s, { method: 'POST', path: '/arena/api/act', headers: { 'x-arena-token': TOKEN }, body: '{}' })).status).toBe(403);   // no Origin
    expect((await raw(s, { method: 'POST', path: '/arena/api/act', headers: { origin: s.origin }, body: '{}' })).status).toBe(403);           // no token
    expect(ran).toBe(0);
    const post = await raw(s, { method: 'POST', path: '/arena/api/act', headers: { origin: s.origin, 'x-arena-token': TOKEN, 'content-type': 'application/json' }, body: '{}' });
    expect(post.status).toBe(200);
    expect(ran).toBe(1);
    // A POST to the GET route is refused too.
    expect((await raw(s, { method: 'POST', path: '/arena/api/live', headers: { origin: s.origin, 'x-arena-token': TOKEN }, body: '{}' })).status).toBe(405);
  });

  it('an unknown API path is 404 (inherited names too), a bad or oversize body is 400, and a page is 404 with no app', async () => {
    const s = await serveOf({ routes: { act: { method: 'POST', handle: () => ({ status: 200, body: {} }) } } });
    for (const p of ['/arena/api/nope', '/arena/api/constructor', '/arena/api/__proto__', '/arena/api/', '/arena/api']) expect((await api(s, p)).status, p).toBe(404);
    const h = { origin: s.origin, 'x-arena-token': TOKEN };
    expect((await raw(s, { method: 'POST', path: '/arena/api/act', headers: h, body: '{not json' })).status).toBe(400);
    expect((await raw(s, { method: 'POST', path: '/arena/api/act', headers: h, body: JSON.stringify({ pad: 'x'.repeat(9000) }) })).status).toBe(400);
    expect((await raw(s, { path: '/arena/watch' })).status).toBe(404);
  });

  it('close() is idempotent and frees the port', async () => {
    const s = await serveOf();
    await Promise.all([s.close({ now: true }), s.close({ now: true })]);
    await expect(raw(s, { path: '/arena/api/live', headers: { 'x-arena-token': TOKEN } })).rejects.toThrow();
  });
});

describe('arena-serve: with the app (Vite in middleware mode)', () => {
  it('serves the app\'s index at /arena/watch and a module under it, while /arena/api stays its own and a bad Host never reaches Vite', async () => {
    const s = await serveOf({ app: true });
    const page = await raw(s, { path: '/arena/watch', headers: { accept: 'text/html' } });
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('<div id=');
    // A module of the dev app is served by Vite, as a dev page needs it.
    const mod = await raw(s, { path: '/src/net/watch-connect.ts' });
    expect(mod.status).toBe(200);
    expect(mod.text).toContain('/arena/api/live');
    // The API is ours, before Vite: the key is still required, and an action path is not Vite's SPA fallback.
    expect((await raw(s, { path: '/arena/api/live', headers: { accept: 'text/html' } })).status).toBe(403);
    expect(JSON.parse((await api(s, '/arena/api/live', { accept: 'text/html' })).text)).toMatchObject({ state: 'waiting' });
    expect((await api(s, '/arena/api/stop', { accept: 'text/html' })).status).toBe(404);
    // The wrong Host is refused before Vite sees it.
    expect((await raw(s, { path: '/arena/watch', headers: { host: 'evil.example', accept: 'text/html' } })).status).toBe(421);
  }, 90_000);
});

describe('arena-serve: /arena/api/live against a real relay', () => {
  const start = (relay: LocalRelay, code: string, seatTicket: string, n = 1): GameStart => ({
    n, of: 4, seed: 1000, map: 'tel_marum', matchup: 'mirror', names: ['rush', 'passive'], factions: ['kdf', 'kdf'], code,
    relay: { url: relay.url, origin: relay.origin }, seatTicket, build: 'b-serve', capTicks: 6000, pace: 40, roundWallMs: 120000,
  });
  async function botRoom(relay: LocalRelay): Promise<{ code: string; seat0: string }> {
    const post = (path: string, body: unknown): Promise<Response> => fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const { code, ticket } = (await (await post('/api/match', { player: 'a', callsign: 'A', build: 'b-serve', map: 'tel_marum', mode: 'versus', kind: 'bot' })).json()) as { code: string; ticket: string };
    await post(`/api/match/${code}/join`, { player: 'b', callsign: 'B', kind: 'bot' });
    return { code, seat0: ticket };
  }
  const record = { outcome: 'seat0', by: 'cap', ticks: 6000, players: ['rush', 'passive'] } as unknown as GameRecord;

  it('a running game carries a watch ticket in the BODY, the relay\'s ws URL and labels; between games and when finished it carries none', async () => {
    const relay = await startLocalRelay({ log: () => {}, watch: true });
    cleanups.push(() => relay.close({ now: true }));
    const s = await serveOf({ runLabel: 'rush vs passive' });
    const { code, seat0 } = await botRoom(relay);
    s.gameStarted(start(relay, code, seat0));
    const r = await api(s, '/arena/api/live');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as { state: string; game: { n: number; of: number; map: string }; wsUrl: string; code: string; ticket: string; build: string; labels: string[]; capTicks: number; roundTicks: number; run: string };
    expect(body).toMatchObject({ state: 'running', game: { n: 1, of: 4, map: 'tel_marum' }, code, build: 'b-serve', labels: ['rush', 'passive'], capTicks: 6000, roundTicks: 40, run: 'rush vs passive' });
    expect(body.wsUrl).toBe(`ws://127.0.0.1:${new URL(relay.url).port}/api/match/${code}/ws`);
    // The ticket is a spectator's: seat 0, the room's code, role watch. It is in the body and in no header or URL.
    expect(typeof body.ticket).toBe('string');
    expect(JSON.stringify(r.headers)).not.toContain(body.ticket);
    expect(body.wsUrl).not.toContain(body.ticket);
    s.gameEnded(record);
    const between = JSON.parse((await api(s, '/arena/api/live')).text) as { state: string; game: unknown; ticket: unknown; last: { n: number; outcome: string; by: string } };
    expect(between).toMatchObject({ state: 'between', game: null, ticket: null, last: { n: 1, outcome: 'seat0', by: 'cap' } });
    s.runFinished();
    expect(JSON.parse((await api(s, '/arena/api/live')).text)).toMatchObject({ state: 'finished', ticket: null });
  });

  it('a relay that was not started with watch answers 502 watch_refused, with no ticket and nothing else of the relay\'s', async () => {
    const relay = await startLocalRelay({ log: () => {} });
    cleanups.push(() => relay.close({ now: true }));
    const s = await serveOf();
    const { code, seat0 } = await botRoom(relay);
    s.gameStarted(start(relay, code, seat0));
    const r = await api(s, '/arena/api/live');
    expect(r.status).toBe(502);
    expect(JSON.parse(r.text)).toEqual({ error: 'watch_refused', status: 404 });
    expect(r.text).not.toContain(seat0);
  });

  it('never puts the seat ticket, a template or a path in any response', async () => {
    const relay = await startLocalRelay({ log: () => {}, watch: true });
    cleanups.push(() => relay.close({ now: true }));
    const s = await serveOf();
    const { code, seat0 } = await botRoom(relay);
    s.gameStarted(start(relay, code, seat0));
    const r = await api(s, '/arena/api/live');
    expect(r.text).not.toContain(seat0);
    expect(r.text).not.toMatch(/template|cmd:|\/Users\//);
  });
});
