import { describe, expect, it } from 'vitest';
import type { MatchConfig } from '@lions/net';
import { WatchRefused, connectWatch, fetchLive, isRunning, keyFromHash, parseLive, type RunningLive } from './watch-connect';

const CONFIG: MatchConfig = { matchId: 'm', code: 'ABCDEF', seed: 1, map: 'tel_marum', mode: 'versus', seats: [
  { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'A', kind: 'bot' },
  { seat: 1, side: 1, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'B', kind: 'bot' } ],
  pace: { kind: 'paced', roundTicks: 40, roundWallMs: 120000 }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 };

const RUNNING: RunningLive = {
  state: 'running', game: { n: 2, of: 4, seed: 1000, map: 'tel_marum', matchup: 'mirror' }, wsUrl: 'ws://127.0.0.1:9/api/match/ABCDEF/ws',
  code: 'ABCDEF', ticket: 'the-spectator-ticket', build: 'build-x', labels: ['rush', 'passive'], capTicks: 400, roundTicks: 40, run: 'rush vs passive', last: null,
};

const sock = () => ({
  sent: [] as string[], closed: 0,
  send(d: string) { this.sent.push(d); },
  close() { this.closed++; },
  onopen: null as null | ((e: unknown) => void),
  onmessage: null as null | ((e: { data: unknown }) => void),
  onclose: null as null | ((e: { code?: number }) => void),
});

describe('keyFromHash', () => {
  it('reads the key from the fragment only', () => {
    expect(keyFromHash('#k=abcDEF123_-xyz')).toBe('abcDEF123_-xyz');
    expect(keyFromHash('k=abcDEF123_-xyz')).toBe('abcDEF123_-xyz');
    expect(keyFromHash('#a=1&k=abcDEF123_-xyz&b=2')).toBe('abcDEF123_-xyz');
    for (const bad of ['', '#', '#k=', '#k=short', '#key=abcdefghijk', '#k=has space here!', '#k=' + 'x'.repeat(200)]) expect(keyFromHash(bad), bad).toBeNull();
  });
});

describe('parseLive', () => {
  it('accepts the server\'s shapes and refuses a malformed game, last or state', () => {
    expect(parseLive({ state: 'waiting', game: null, last: null })).toMatchObject({ state: 'waiting', game: null, ticket: null });
    expect(parseLive(JSON.parse(JSON.stringify(RUNNING)))).toEqual(RUNNING);
    expect(isRunning(parseLive(RUNNING) as never)).toBe(true);
    const between = parseLive({ state: 'between', game: null, last: { n: 1, outcome: 'seat0', by: 'cap', ticks: 400, players: ['a', 'b'] } });
    expect(between?.last).toEqual({ n: 1, outcome: 'seat0', by: 'cap', ticks: 400, players: ['a', 'b'] });
    expect(isRunning(between as never)).toBe(false);
    for (const bad of [null, 'x', {}, { state: 'nope' }, { state: 'running', game: { n: 'x' } }, { state: 'between', game: null, last: { n: 1 } }]) expect(parseLive(bad), JSON.stringify(bad)).toBeNull();
    // A running response missing the ticket is not connectable.
    expect(isRunning({ ...(parseLive(RUNNING) as RunningLive), ticket: null } as never)).toBe(false);
  });
});

describe('fetchLive', () => {
  it('sends the key as a header on a same-origin GET and nowhere else', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => { seen.push({ url, init }); return Response.json(RUNNING); }) as unknown as typeof fetch;
    const live = await fetchLive({ fetch: f, key: 'the-run-key-1234' });
    expect(live.state).toBe('running');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/arena/api/live');
    expect(seen[0].url).not.toContain('the-run-key');
    expect(seen[0].init?.method).toBe('GET');
    expect(seen[0].init?.headers).toEqual({ 'x-arena-token': 'the-run-key-1234' });
    expect(seen[0].init?.body).toBeUndefined();
  });
  it('throws WatchRefused with the status, 0 for no answer or a body that is not a live response', async () => {
    const cases: [typeof fetch, number][] = [
      [(async () => new Response('no', { status: 403 })) as unknown as typeof fetch, 403],
      [(async () => new Response('', { status: 421 })) as unknown as typeof fetch, 421],
      [(async () => { throw new TypeError('network'); }) as unknown as typeof fetch, 0],
      [(async () => Response.json({ hello: 1 })) as unknown as typeof fetch, 0],
      [(async () => new Response('not json', { status: 200 })) as unknown as typeof fetch, 0],
    ];
    for (const [f, status] of cases) {
      const err = await fetchLive({ fetch: f, key: 'k'.repeat(10) }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WatchRefused);
      expect((err as WatchRefused).status).toBe(status);
    }
  });
});

describe('connectWatch', () => {
  it('opens the live wsUrl, says hello with the live build and ticket and nothing else, and resolves at start as seat 0', async () => {
    const s = sock();
    const opened: string[] = [];
    const p = connectWatch(RUNNING, { openSocket: (u) => { opened.push(u); return s; }, note: () => {} });
    s.onopen?.({});
    expect(opened).toEqual([RUNNING.wsUrl]);
    expect(s.sent.map((m) => JSON.parse(m))).toEqual([{ t: 'hello', ticket: 'the-spectator-ticket', build: 'build-x' }]);
    s.onmessage?.({ data: JSON.stringify({ t: 'log', config: CONFIG, frames: [] }) });
    const c = await p;
    expect(c.seat).toBe(0);
    expect(c.config).toEqual(CONFIG);
    expect(c.snapshots).toBeUndefined();
    // The transport it hands over cannot speak: every verb is dropped at the socket.
    c.transport.queueCommand({ kind: 'halt', ids: [1] });
    c.transport.close();
    expect(s.sent).toHaveLength(1);
  });
  it('the ticket is in the first message only: not in the socket URL', async () => {
    const s = sock();
    const opened: string[] = [];
    void connectWatch(RUNNING, { openSocket: (u) => { opened.push(u); return s; }, note: () => {} });
    expect(opened[0]).not.toContain('the-spectator-ticket');
  });
  it('rejects on a refusal, an end before the start, and an abort; closes the socket in each', async () => {
    for (const how of ['bad_ticket', 'full', 'build_mismatch'] as const) {
      const s = sock();
      const p = connectWatch(RUNNING, { openSocket: () => s, note: () => {} });
      s.onopen?.({});
      s.onmessage?.({ data: JSON.stringify({ t: 'error', code: how }) });
      await expect(p).rejects.toThrow(how);
      expect(s.closed).toBeGreaterThan(0);
    }
    const s2 = sock();
    const p2 = connectWatch(RUNNING, { openSocket: () => s2, note: () => {} });
    s2.onopen?.({});
    s2.onmessage?.({ data: JSON.stringify({ t: 'ended', reason: 'over' }) });
    await expect(p2).rejects.toThrow('ended');
    const ac = new AbortController();
    const s3 = sock();
    const p3 = connectWatch(RUNNING, { openSocket: () => s3, note: () => {}, signal: ac.signal });
    ac.abort();
    await expect(p3).rejects.toMatchObject({ name: 'AbortError' });
    expect(s3.closed).toBeGreaterThan(0);
    await expect(connectWatch(RUNNING, { openSocket: () => { throw new Error('no socket'); }, note: () => {}, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
