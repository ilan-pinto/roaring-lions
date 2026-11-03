// GH-954 W2: the setup screen's requests and the shapes it accepts. Pure parsing and a recording fetch.
import { describe, expect, it } from 'vitest';
import { SetupRefused, fetchPlayers, fetchStatus, parsePlayers, parseStatus, startRun, stopRun } from './arena-setup-api';

const U = { inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 3, cacheReadInputTokens: null, costUsd: 0.5 };
const REQ = { a: 'rush', b: 'passive', map: 'tel_marum', matchup: 'mirror', seeds: 1, pace: 60, roundWallMs: 1000, capTicks: 100 } as const;
const TOKEN = 'sk-test-0123456789abcdefXYZ';

describe('parsePlayers', () => {
  it('accepts id, label and kind and drops anything else; refuses a row that is not one', () => {
    expect(parsePlayers({ players: [{ id: 'rush', label: 'rush', kind: 'scripted', template: 'cmd:x' }] })).toEqual([{ id: 'rush', label: 'rush', kind: 'scripted' }]);
    for (const bad of [null, {}, { players: 'x' }, { players: [{ id: '', label: 'x', kind: 'model' }] }, { players: [{ id: 'a', label: 'x', kind: 'weird' }] }, { players: [{ id: 'a', kind: 'model' }] }]) expect(parsePlayers(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('parseStatus', () => {
  it('reads a run, its games and totals; unknown fields are dropped', () => {
    const s = parseStatus({ state: 'running', extra: 1, run: { a: 'a', b: 'b', map: 'm', matchup: 'mirror', seeds: 2, judge: null, withToken: true, secret: 'x' }, game: { n: 1, of: 4 },
      games: [{ n: 1, outcome: 'seat0', by: 'cap', ticks: 9, players: ['a', 'b'], usage: [U, null] }], totals: { players: [{ player: 'a', usage: U }], judge: null, all: U }, error: null });
    expect(s).toEqual({ state: 'running', run: { a: 'a', b: 'b', map: 'm', matchup: 'mirror', seeds: 2, judge: null, withToken: true }, game: { n: 1, of: 4 },
      games: [{ n: 1, outcome: 'seat0', by: 'cap', ticks: 9, players: ['a', 'b'], usage: [U, null] }], totals: { players: [{ player: 'a', usage: U }], judge: null, all: U }, error: null });
    expect(parseStatus({ state: 'idle' })).toMatchObject({ state: 'idle', run: null, game: null, games: [], totals: null });
    for (const bad of [null, 'x', { state: 'weird' }, { state: 'idle', games: [{ n: 1 }] }, { state: 'idle', run: { a: 1 } }]) expect(parseStatus(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('the requests', () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const answer = (status: number, body: unknown): typeof fetch => (async (url: string, init?: RequestInit) => { seen.push({ url, init: init ?? {} }); return Response.json(body, { status }); }) as unknown as typeof fetch;
  it('every call carries the key as a header; only start carries a body, and the token only inside it', async () => {
    seen.length = 0;
    const d = (status: number, body: unknown) => ({ fetch: answer(status, body), key: 'the-run-key' });
    await fetchPlayers(d(200, { players: [] }));
    await fetchStatus(d(200, { state: 'idle' }));
    await startRun(d(202, { state: 'running' }), { ...REQ, token: TOKEN });
    expect(await stopRun(d(200, { state: 'stopped' }))).toBe('stopped');
    expect(seen.map((s) => [s.init.method, s.url])).toEqual([['GET', '/arena/api/players'], ['GET', '/arena/api/status'], ['POST', '/arena/api/start'], ['POST', '/arena/api/stop']]);
    for (const s of seen) expect((s.init.headers as Record<string, string>)['x-arena-token']).toBe('the-run-key');
    expect(seen.filter((s) => JSON.stringify(s).includes(TOKEN)).map((s) => s.url)).toEqual(['/arena/api/start']);
    expect(String(seen[2].init.body)).toContain(TOKEN);
    expect(seen[2].url).not.toContain(TOKEN);
    expect(JSON.stringify(seen[2].init.headers)).not.toContain(TOKEN);
  });
  it('a refusal is its status and CODE; a dead server is status 0; an answer in the wrong shape is a refusal', async () => {
    await expect(startRun({ fetch: answer(409, { error: 'busy' }), key: 'k' }, REQ)).rejects.toMatchObject({ status: 409, code: 'busy' });
    await expect(startRun({ fetch: answer(400, { error: 'unknown_field' }), key: 'k' }, REQ)).rejects.toMatchObject({ status: 400, code: 'unknown_field' });
    await expect(startRun({ fetch: answer(200, {}), key: 'k' }, REQ)).rejects.toBeInstanceOf(SetupRefused);   // not the 202 it waits for
    await expect(fetchStatus({ fetch: (async () => { throw new TypeError('down'); }) as unknown as typeof fetch, key: 'k' })).rejects.toMatchObject({ status: 0 });
    await expect(fetchStatus({ fetch: answer(200, { state: 'weird' }), key: 'k' })).rejects.toMatchObject({ status: 0 });
    await expect(fetchPlayers({ fetch: answer(403, 'no'), key: 'k' })).rejects.toMatchObject({ status: 403, code: null });
    await expect(stopRun({ fetch: answer(200, { state: 'weird' }), key: 'k' })).rejects.toBeInstanceOf(SetupRefused);
  });
});
