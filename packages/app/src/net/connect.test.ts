import { describe, it, expect } from 'vitest';
import { connectMatch } from './connect';

const noSocket = () => { throw new Error('no socket expected'); };

const CONFIG = (seed: number) => ({ matchId: 'ABCDEF', code: 'ABCDEF', seed, map: 'tel_marum', mode: 'sandbox', seats: [
  { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'a', kind: 'human' },
  { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'b', kind: 'human' } ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });

const fakeSocket = () => ({
  sent: [] as string[],
  closed: 0,
  send(d: string) { this.sent.push(d); },
  close() { this.closed++; },
  onopen: null as null | ((e: unknown) => void),
  onmessage: null as null | ((e: { data: unknown }) => void),
  onclose: null,
});

describe('connectMatch', () => {
  it('returns a LocalTransport with no ?net', async () => {
    const r = await connectMatch(new URLSearchParams(''), 'm', 'b', { fetch: noSocket as never, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {} });
    expect(r.transport.local).toBe(true);
    expect(r.seat).toBeNull();
    expect(r.config).toBeNull();
  });
  it('?net=new creates a room, rewrites the URL to the code and seat 0, and waits for start', async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    let replaced: [string, number] | null = null;
    const fetchFake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 });
    }) as unknown as typeof fetch;
    const sock = fakeSocket();
    const opened: string[] = [];
    const p = connectMatch(new URLSearchParams('net=new&callsign=Ari'), 'tel_marum', 'b', {
      fetch: fetchFake, origin: 'http://x', openSocket: (u) => { opened.push(u); return sock; }, replaceUrl: (c, s) => { replaced = [c, s]; }, note: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['POST http://x/api/match']);
    expect(bodies).toEqual([{ callsign: 'Ari', map: 'tel_marum', build: 'b' }]);
    expect(replaced).toEqual(['ABCDEF', 0]);
    expect(opened).toEqual(['ws://x/api/match/ABCDEF/ws']);
    sock.onopen?.({});
    expect(JSON.parse(sock.sent[0])).toEqual({ t: 'hello', ticket: 'tk', build: 'b' });
    sock.onmessage?.({ data: JSON.stringify({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'a', connected: true, ready: false }, { seat: 1, callsign: 'b', connected: true, ready: false }], you: 0 }) });
    expect(JSON.parse(sock.sent[1])).toEqual({ t: 'ready' });
    sock.onmessage?.({ data: JSON.stringify({ t: 'start', config: CONFIG(5) }) });
    const r = await p;
    expect(r.seat).toBe(0);
    expect(r.config?.seed).toBe(5);
    expect(r.transport.local).toBe(false);
  });
  it('does not say ready while the other seat is absent', async () => {
    const fetchFake = (async () => Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 })) as unknown as typeof fetch;
    const sock = fakeSocket();
    void connectMatch(new URLSearchParams('net=new'), 'tel_marum', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {} });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'a', connected: true, ready: false }], you: 0 }) });
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['hello']);
  });
  it('?net=<code> joins as the seat the Worker gives, and never rewrites the URL', async () => {
    const calls: string[] = [];
    const fetchFake = (async (url: string) => { calls.push(url); return Response.json({ code: 'ABCDEF', seat: 1, ticket: 'tk' }); }) as unknown as typeof fetch;
    const sock = fakeSocket();
    let replaced = false;
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => { replaced = true; }, note: () => {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['http://x/api/match/ABCDEF/join']);
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'start', config: CONFIG(1) }) });
    expect((await p).seat).toBe(1);
    expect(replaced).toBe(false);
  });
  it('a refused create rejects with the HTTP status', async () => {
    const fetchFake = (async () => new Response('build required', { status: 400 })) as unknown as typeof fetch;
    await expect(connectMatch(new URLSearchParams('net=new'), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {} }))
      .rejects.toThrow('match create failed: HTTP 400');
  });
  it('a build mismatch rejects and closes the socket', async () => {
    const fetchFake = (async () => Response.json({ code: 'ABCDEF', seat: 1, ticket: 'tk' })) as unknown as typeof fetch;
    const sock = fakeSocket();
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {} });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'build_mismatch' }) });
    await expect(p).rejects.toThrow('room refused: build_mismatch');
    expect(sock.closed).toBeGreaterThan(0);
  });
  it('an abort while waiting for the other seat rejects as an AbortError and closes the transport', async () => {
    const fetchFake = (async () => Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 })) as unknown as typeof fetch;
    const sock = fakeSocket();
    const ac = new AbortController();
    const p = connectMatch(new URLSearchParams('net=new'), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['hello', 'bye']);
    expect(sock.closed).toBeGreaterThan(0);
  });
});
