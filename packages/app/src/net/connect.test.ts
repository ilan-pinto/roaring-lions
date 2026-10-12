import { describe, it, expect, afterEach, vi } from 'vitest';
import { WsTransport, type MatchConfig } from '@lions/net';
import { connectMatch, openRoom, RELOAD_REFUSED, RoomRefused, RoomStarted, type OpenDeps } from './connect';
import { handOver, dropHanded, takeHanded } from './handoff';
import { loadSeat, saveSeat } from './ticket-store';
import type { StorageLike } from '../telemetry/identity';

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
    const r = await connectMatch(new URLSearchParams(''), 'm', 'b', { fetch: noSocket as never, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {}, store: null });
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
    const store = { getItem: (k: string) => (k === 'lions.versus.player' ? 'pid-1' : null), setItem: () => {} };
    const p = connectMatch(new URLSearchParams('net=new&callsign=Ari'), 'tel_marum', 'b', {
      fetch: fetchFake, origin: 'http://x', openSocket: (u) => { opened.push(u); return sock; }, replaceUrl: (c, s) => { replaced = [c, s]; }, note: () => {}, store,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['POST http://x/api/match']);
    expect(bodies).toEqual([{ player: 'pid-1', callsign: 'Ari', map: 'tel_marum', build: 'b', mode: 'sandbox' }]);
    expect(replaced).toEqual(['ABCDEF', 0]);
    expect(opened).toEqual(['ws://x/api/match/ABCDEF/ws']);
    sock.onopen?.({});
    expect(JSON.parse(sock.sent[0])).toEqual({ t: 'hello', ticket: 'tk', build: 'b' });
    sock.onmessage?.({ data: JSON.stringify({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'a', connected: true, ready: false }, { seat: 1, callsign: 'b', connected: true, ready: false }], you: 0, map: 'tel_marum' }) });
    expect(JSON.parse(sock.sent[1])).toEqual({ t: 'ready' });
    sock.onmessage?.({ data: JSON.stringify({ t: 'start', config: CONFIG(5) }) });
    const r = await p;
    expect(r.seat).toBe(0);
    expect(r.config?.seed).toBe(5);
    expect(r.transport.local).toBe(false);
  });
  it('?net=new&mode=versus posts mode: versus and the player id; a join posts the player id and no mode', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFake = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 });
    }) as unknown as typeof fetch;
    const store = { getItem: () => 'pid-v', setItem: () => {} };
    const deps = { fetch: fetchFake, origin: 'http://x', openSocket: () => fakeSocket(), replaceUrl: () => {}, note: () => {}, store };
    void connectMatch(new URLSearchParams('net=new&mode=versus'), 'tel_marum', 'b', deps);
    void connectMatch(new URLSearchParams('net=ABCDEF&mode=versus'), 'tel_marum', 'b', deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies[0]).toMatchObject({ mode: 'versus', player: 'pid-v' });
    expect(bodies[1]).toMatchObject({ player: 'pid-v' });
    expect(bodies[1]).not.toHaveProperty('mode');
  });
  it('does not say ready while the other seat is absent', async () => {
    const fetchFake = (async () => Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 })) as unknown as typeof fetch;
    const sock = fakeSocket();
    void connectMatch(new URLSearchParams('net=new'), 'tel_marum', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'a', connected: true, ready: false }], you: 0, map: 'tel_marum' }) });
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['hello']);
  });
  it('?net=<code> joins as the seat the Worker gives, and never rewrites the URL', async () => {
    const calls: string[] = [];
    const fetchFake = (async (url: string) => { calls.push(url); return Response.json({ code: 'ABCDEF', seat: 1, ticket: 'tk' }); }) as unknown as typeof fetch;
    const sock = fakeSocket();
    let replaced = false;
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => { replaced = true; }, note: () => {}, store: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['http://x/api/match/ABCDEF/join']);
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'start', config: CONFIG(1) }) });
    expect((await p).seat).toBe(1);
    expect(replaced).toBe(false);
  });
  it('a refused create rejects with the HTTP status', async () => {
    const fetchFake = (async () => new Response('build required', { status: 400 })) as unknown as typeof fetch;
    await expect(connectMatch(new URLSearchParams('net=new'), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {}, store: null }))
      .rejects.toThrow('match create failed: HTTP 400');
  });
  it('a build mismatch rejects and closes the socket', async () => {
    const fetchFake = (async () => Response.json({ code: 'ABCDEF', seat: 1, ticket: 'tk' })) as unknown as typeof fetch;
    const sock = fakeSocket();
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'build_mismatch' }) });
    await expect(p).rejects.toThrow('room refused: build_mismatch');
    expect(sock.closed).toBeGreaterThan(0);
  });
  it('a room that ends before its start rejects and closes the socket', async () => {
    const fetchFake = (async () => Response.json({ code: 'ABCDEF', seat: 1, ticket: 'tk' })) as unknown as typeof fetch;
    const sock = fakeSocket();
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'ended', reason: 'expired' }) });
    await expect(p).rejects.toThrow('room ended before the start: expired');
    expect(sock.closed).toBeGreaterThan(0);
  });
  it('an abort that lands during the create opens no socket and rewrites no URL', async () => {
    const ac = new AbortController();
    // A fetch that ignores its signal and answers anyway: the check after it is what must hold.
    const fetchFake = (async () => { ac.abort(); return Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 }); }) as unknown as typeof fetch;
    let replaced = false;
    const p = connectMatch(new URLSearchParams('net=new'), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: noSocket, replaceUrl: () => { replaced = true; }, note: () => {}, store: null, signal: ac.signal });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(replaced).toBe(false);
  });
  it('an abort while waiting for the other seat rejects as an AbortError and closes the transport', async () => {
    const fetchFake = (async () => Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 })) as unknown as typeof fetch;
    const sock = fakeSocket();
    const ac = new AbortController();
    const p = connectMatch(new URLSearchParams('net=new'), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['hello', 'bye']);
    expect(sock.closed).toBeGreaterThan(0);
  });
  it('a URL that already carries seat (a reload after ?net=new) is refused before any request (M1)', async () => {
    for (const q of ['net=ABCDEF&seat=0', 'net=new&seat=0', 'net=ABCDEF&seat=1&callsign=A']) {
      const calls: string[] = [];
      const fetchFake = (async (url: string) => { calls.push(url); return Response.json({ code: 'ABCDEF', seat: 1, ticket: 'tk' }); }) as unknown as typeof fetch;
      await expect(connectMatch(new URLSearchParams(q), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {}, store: null }))
        .rejects.toThrow(RELOAD_REFUSED);
      expect(calls).toEqual([]);
    }
  });
  it('a lower-case code joins the upper-case room (M8)', async () => {
    const calls: string[] = [];
    const fetchFake = (async (url: string) => { calls.push(url); return Response.json({ code: 'ABCDEF', seat: 1, ticket: 'tk' }); }) as unknown as typeof fetch;
    const opened: string[] = [];
    void connectMatch(new URLSearchParams('net=abcdef'), 'm', 'b', { fetch: fetchFake, origin: 'http://x', openSocket: (u) => { opened.push(u); return fakeSocket(); }, replaceUrl: () => {}, note: () => {}, store: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['http://x/api/match/ABCDEF/join']);
    expect(opened).toEqual(['ws://x/api/match/ABCDEF/ws']);
  });
});

const memory = (): StorageLike & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
/** A fetch that records every call and answers as the Worker would. */
const recordingFetch = (seat: 0 | 1, ticket = 'tk-fresh') => {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return Response.json({ code: 'ABCDEF', seat, ticket }, { status: 201 });
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe('connectMatch: rejoin and handoff (N1b task 5)', () => {
  afterEach(() => dropHanded('ABCDEF'));

  it('(a) a handed transport is returned at once, without any fetch or socket', async () => {
    const sock = fakeSocket();
    const transport = new WsTransport(() => sock, 'tk-lobby', 'b', { onStart: () => {} });
    const config = CONFIG(9) as unknown as MatchConfig;
    handOver('ABCDEF', { transport, seat: 1, config });
    const { f, calls } = recordingFetch(1);
    const r = await connectMatch(new URLSearchParams('net=abcdef'), 'tel_marum', 'b', { fetch: f, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {}, store: null, session: memory() });
    expect(calls).toEqual([]);
    expect(r).toEqual({ transport, seat: 1, config });
  });

  it('(a) taking a handed transport installs the battlefield hooks ONCE; the lobby\'s are gone and desync and ended are noted', async () => {
    const sock = fakeSocket();
    const lobbyCalls: string[] = [];
    const transport = new WsTransport(() => sock, 'tk-lobby', 'b', {
      onLobby: () => lobbyCalls.push('lobby'),
      onChat: () => lobbyCalls.push('chat'),
      onEnded: () => lobbyCalls.push('ended'),
      onStart: () => {},
    });
    const spy = vi.spyOn(transport, 'setHooks');
    handOver('ABCDEF', { transport, seat: 0, config: CONFIG(9) as unknown as MatchConfig });
    const notes: string[] = [];
    const { f, calls } = recordingFetch(0);
    await connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: f, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: (n) => notes.push(n), store: null, session: memory() });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'lobby', config: null, seats: [], you: 0, map: 'tel_marum' }) });
    sock.onmessage?.({ data: JSON.stringify({ t: 'chat', seat: 1, text: 'hi' }) });
    sock.onmessage?.({ data: JSON.stringify({ t: 'desync', tick: 40, hashes: [1, 2] }) });
    expect(lobbyCalls).toEqual([]);
    expect(notes).toEqual(['DESYNC at tick 40']);
    const sock2 = fakeSocket();
    const t2 = new WsTransport(() => sock2, 'tk', 'b', { onStart: () => {} });
    handOver('ABCDEF', { transport: t2, seat: 0, config: CONFIG(9) as unknown as MatchConfig });
    notes.length = 0;
    await connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: f, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: (n) => notes.push(n), store: null, session: memory() });
    sock2.onopen?.({});
    sock2.onmessage?.({ data: JSON.stringify({ t: 'ended', reason: 'left', seat: 1 }) });
    expect(notes).toEqual(['match ended: left']);
  });

  // N1b final fix wave (M-2): an `ended` or a `paused` that lands between the
  // lobby's handOver and the battlefield's take reached only the lobby's hooks,
  // which ignore it once started: no result panel, and a reset pause count.
  it('(M-2) an ended between handOver and take still reaches the hooks installed after it: connectMatch\'s note, then the battlefield\'s onEnded with the seat', async () => {
    const sock = fakeSocket();
    const transport = new WsTransport(() => sock, 'tk-lobby', 'b', { onStart: () => {}, onEnded: () => {} });
    handOver('ABCDEF', { transport, seat: 0, config: CONFIG(9) as unknown as MatchConfig });
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'start', config: CONFIG(9) }) });
    sock.onmessage?.({ data: JSON.stringify({ t: 'ended', reason: 'surrender', seat: 1 }) });
    const notes: string[] = [];
    const r = await connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: recordingFetch(0).f, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: (n) => notes.push(n), store: null, session: memory() });
    expect(notes).toEqual(['match ended: surrender']);
    // What main.ts does next, synchronously after the await.
    const ended: unknown[] = [];
    (r.transport as WsTransport).setHooks({ onEnded: (reason, seat) => { ended.push([reason, seat]); } });
    expect(ended).toEqual([['surrender', 1]]);
  });

  it('(M-2) a pause in force at the take reaches the battlefield\'s onPaused, with the pauses left', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      const sock = fakeSocket();
      const transport = new WsTransport(() => sock, 'tk-lobby', 'b', { onStart: () => {} });
      handOver('ABCDEF', { transport, seat: 1, config: CONFIG(9) as unknown as MatchConfig });
      sock.onopen?.({});
      sock.onmessage?.({ data: JSON.stringify({ t: 'start', config: CONFIG(9) }) });
      sock.onmessage?.({ data: JSON.stringify({ t: 'paused', seat: 0, remainingMs: 90000, pausesLeft: [2, 3] }) });
      vi.advanceTimersByTime(4000);
      const r = await connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: recordingFetch(0).f, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {}, store: null, session: memory() });
      const paused: unknown[] = [];
      (r.transport as WsTransport).setHooks({ onPaused: (seat, ms, left) => { paused.push([seat, ms, left]); } });
      expect(paused).toEqual([[0, 86000, [2, 3]]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(a) a handed match is returned even when the URL\'s map differs from the config\'s: the battlefield reports the mismatch', async () => {
    const transport = new WsTransport(() => fakeSocket(), 'tk-lobby', 'b', { onStart: () => {} });
    const config = CONFIG(9) as unknown as MatchConfig;
    handOver('ABCDEF', { transport, seat: 0, config });
    const { f, calls } = recordingFetch(0);
    const r = await connectMatch(new URLSearchParams('net=ABCDEF'), 'qarn_hadid', 'b', { fetch: f, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {}, store: null, session: memory() });
    expect(r.config).toBe(config);
    expect(r.config?.map).toBe('tel_marum');
    expect(calls).toEqual([]);
  });

  it('(R-B19) a stored ticket the room refuses (bad_ticket) is forgotten, so the next reload falls to a fresh join', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-old', seat: 1 });
    const sock = fakeSocket();
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: recordingFetch(0).f, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null, session });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'bad_ticket' }) });
    await expect(p).rejects.toThrow('room refused: bad_ticket');
    expect(loadSeat(session, 'ABCDEF')).toBeNull();
  });

  it('(R-B19) a stored ticket whose room has ended is forgotten', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-old', seat: 1 });
    const sock = fakeSocket();
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: recordingFetch(0).f, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null, session });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'ended', reason: 'expired' }) });
    await expect(p).rejects.toThrow('room ended before the start: expired');
    expect(loadSeat(session, 'ABCDEF')).toBeNull();
  });

  it('(R-B19) a build mismatch keeps the ticket: the room is alive and the seat is still this tab\'s', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-keep', seat: 1 });
    const sock = fakeSocket();
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: recordingFetch(0).f, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null, session });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'build_mismatch' }) });
    await expect(p).rejects.toThrow('room refused: build_mismatch');
    expect(loadSeat(session, 'ABCDEF')).toEqual({ ticket: 'tk-keep', seat: 1 });
  });

  // M-5: the player left this screen, so the handed match is left -- a `bye`,
  // as the battlefield's own disposer sends -- not detached, which left the
  // other seat in an endless 'gone' stall.
  it('(a) an already-aborted signal leaves a handed transport (bye, as the battlefield\'s disposer does) and throws AbortError, before any fetch', async () => {
    const sock = fakeSocket();
    const transport = new WsTransport(() => sock, 'tk-lobby', 'b', { onStart: () => {} });
    const spy = vi.spyOn(transport, 'setHooks');
    handOver('ABCDEF', { transport, seat: 0, config: CONFIG(9) as unknown as MatchConfig });
    sock.onopen?.({});
    const ac = new AbortController();
    ac.abort();
    const { f, calls } = recordingFetch(0);
    await expect(connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: f, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {}, store: null, session: memory(), signal: ac.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(takeHanded('ABCDEF')).toBeNull();
    expect(sock.closed).toBeGreaterThan(0);
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['hello', 'bye']);
    expect(transport.status()).toEqual({ kind: 'closed', reason: 'left' });
  });

  it('(a) an already-aborted signal on a rejoin throws AbortError before any socket is opened or ticket forgotten', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-stored', seat: 1 });
    const ac = new AbortController();
    ac.abort();
    const { f, calls } = recordingFetch(0);
    await expect(connectMatch(new URLSearchParams('net=ABCDEF&seat=1'), 'tel_marum', 'b', { fetch: f, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {}, store: null, session, signal: ac.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual([]);
    expect(loadSeat(session, 'ABCDEF')).toEqual({ ticket: 'tk-stored', seat: 1 });
  });

  for (const q of ['net=ABCDEF&seat=1', 'net=ABCDEF']) {
    it(`(b) ${q} with a stored ticket sends hello with THAT ticket, posts nothing, and resolves on the room's log`, async () => {
      const session = memory();
      saveSeat(session, 'ABCDEF', { ticket: 'tk-stored', seat: 1 });
      const { f, calls } = recordingFetch(0);
      const sock = fakeSocket();
      const opened: string[] = [];
      let replaced = false;
      const p = connectMatch(new URLSearchParams(q), 'tel_marum', 'b', {
        fetch: f, origin: 'http://x', openSocket: (u) => { opened.push(u); return sock; }, replaceUrl: () => { replaced = true; }, note: () => {}, store: null, session,
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(calls).toEqual([]);
      expect(opened).toEqual(['ws://x/api/match/ABCDEF/ws']);
      sock.onopen?.({});
      expect(sock.sent.map((s) => JSON.parse(s) as unknown)).toEqual([{ t: 'hello', ticket: 'tk-stored', build: 'b' }]);
      sock.onmessage?.({ data: JSON.stringify({ t: 'log', config: CONFIG(3), frames: [{ tick: 0, cmds: [] }, { tick: 1, cmds: [] }] }) });
      const r = await p;
      expect(r.seat).toBe(1);
      expect(r.config?.seed).toBe(3);
      expect(r.transport.local).toBe(false);
      expect(r.transport.status()).toEqual({ kind: 'live', behind: 2 });
      expect(replaced).toBe(false);
    });
  }

  it('(b) a rejoin that lands back in the lobby (a reload before the start) readies and waits for the start', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-stored', seat: 0 });
    const sock = fakeSocket();
    const p = connectMatch(new URLSearchParams('net=ABCDEF&seat=0'), 'tel_marum', 'b', { fetch: recordingFetch(0).f, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null, session });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'a', connected: true, ready: false }, { seat: 1, callsign: 'b', connected: true, ready: true }], you: 0, map: 'tel_marum' }) });
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['hello', 'ready']);
    sock.onmessage?.({ data: JSON.stringify({ t: 'start', config: CONFIG(4) }) });
    expect((await p).seat).toBe(0);
  });

  it('(b) a stored ticket the room refuses rejects and closes the socket', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-old', seat: 1 });
    const sock = fakeSocket();
    const p = connectMatch(new URLSearchParams('net=ABCDEF'), 'tel_marum', 'b', { fetch: recordingFetch(0).f, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null, session });
    await new Promise((r) => setTimeout(r, 0));
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'bad_ticket' }) });
    await expect(p).rejects.toThrow('room refused: bad_ticket');
    expect(sock.closed).toBeGreaterThan(0);
  });

  it('(b) ?net=new never rejoins, even with a ticket stored for some code', async () => {
    const session = memory();
    saveSeat(session, 'NEW', { ticket: 'tk-x', seat: 1 });
    const { f, calls } = recordingFetch(0);
    void connectMatch(new URLSearchParams('net=new'), 'tel_marum', 'b', { fetch: f, origin: 'http://x', openSocket: () => fakeSocket(), replaceUrl: () => {}, note: () => {}, store: null, session });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['POST http://x/api/match']);
  });

  it('(c) ?seat with no stored ticket still throws RELOAD_REFUSED, before any request', async () => {
    const session = memory();
    saveSeat(session, 'GHIJKL', { ticket: 'tk-other', seat: 0 });
    for (const q of ['net=ABCDEF&seat=1', 'net=new&seat=0']) {
      const { f, calls } = recordingFetch(1);
      await expect(connectMatch(new URLSearchParams(q), 'm', 'b', { fetch: f, origin: 'http://x', openSocket: noSocket, replaceUrl: () => {}, note: () => {}, store: null, session }))
        .rejects.toThrow(RELOAD_REFUSED);
      expect(calls).toEqual([]);
    }
  });

  it('(d) a fresh join stores its ticket under the room code', async () => {
    const session = memory();
    const { f } = recordingFetch(1, 'tk-joined');
    void connectMatch(new URLSearchParams('net=abcdef'), 'tel_marum', 'b', { fetch: f, origin: 'http://x', openSocket: () => fakeSocket(), replaceUrl: () => {}, note: () => {}, store: null, session });
    await new Promise((r) => setTimeout(r, 0));
    expect(loadSeat(session, 'ABCDEF')).toEqual({ ticket: 'tk-joined', seat: 1 });
  });

  it('(d) a create stores its ticket under the code the Worker gave, and a reload of the rewritten URL rejoins with it', async () => {
    const session = memory();
    let url = 'net=new';
    const { f, calls } = recordingFetch(0, 'tk-host');
    void connectMatch(new URLSearchParams(url), 'tel_marum', 'b', {
      fetch: f, origin: 'http://x', openSocket: () => fakeSocket(), note: () => {}, store: null, session,
      replaceUrl: (code, seat) => { url = `net=${code}&seat=${seat}`; },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(loadSeat(session, 'ABCDEF')).toEqual({ ticket: 'tk-host', seat: 0 });
    // The reload: the rewritten URL, the same tab's session.
    const sock = fakeSocket();
    void connectMatch(new URLSearchParams(url), 'tel_marum', 'b', { fetch: f, origin: 'http://x', openSocket: () => sock, replaceUrl: () => {}, note: () => {}, store: null, session });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['POST http://x/api/match']);
    sock.onopen?.({});
    expect(JSON.parse(sock.sent[0])).toEqual({ t: 'hello', ticket: 'tk-host', build: 'b' });
  });
});

describe('openRoom: the lobby\'s create and join (N1b task 6, R-B8)', () => {
  const LOBBY_TWO = { t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'Ari', connected: true, ready: false }, { seat: 1, callsign: 'Bo', connected: true, ready: false }], you: 0, map: 'qarn_hadid' };
  const deps = (over: Partial<OpenDeps> = {}): OpenDeps => ({
    fetch: noSocket as never, origin: 'http://x', openSocket: noSocket, store: { getItem: () => 'pid-o', setItem: () => {} }, session: memory(), ...over,
  });
  const answering = (status: number, body: unknown = { code: 'ABCDEF', seat: 0, ticket: 'tk-o' }) => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return status < 300 ? Response.json(body, { status }) : new Response('', { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('a create posts mode versus with the chosen map, and resolves at the first lobby WITHOUT saying ready', async () => {
    const { f, calls } = answering(201);
    const sock = fakeSocket();
    const session = memory();
    const p = openRoom({ kind: 'create', map: 'qarn_hadid', callsign: 'Ari' }, 'b', deps({ fetch: f, openSocket: () => sock, session }));
    await tick();
    expect(calls).toEqual([{ url: 'http://x/api/match', body: { player: 'pid-o', callsign: 'Ari', map: 'qarn_hadid', build: 'b', mode: 'versus' } }]);
    expect(loadSeat(session, 'ABCDEF')).toEqual({ ticket: 'tk-o', seat: 0 });
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify(LOBBY_TWO) });
    const r = await p;
    expect(r.code).toBe('ABCDEF');
    expect(r.seat).toBe(0);
    expect(r.lobby).toEqual({ seats: LOBBY_TWO.seats, map: 'qarn_hadid' });
    expect(r.transport).toBeInstanceOf(WsTransport);
    // Both seats connected, and still only the hello: the lobby's Ready is the player's.
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['hello']);
  });

  it('a join posts to the code\'s join route with the callsign and no mode', async () => {
    const { f, calls } = answering(200, { code: 'ABCDEF', seat: 1, ticket: 'tk-j' });
    const sock = fakeSocket();
    const p = openRoom({ kind: 'join', code: 'abcdef', callsign: 'Bo' }, 'b', deps({ fetch: f, openSocket: () => sock }));
    await tick();
    expect(calls).toEqual([{ url: 'http://x/api/match/ABCDEF/join', body: { player: 'pid-o', callsign: 'Bo', build: 'b' } }]);
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ ...LOBBY_TWO, you: 1 }) });
    expect((await p).seat).toBe(1);
  });

  for (const [status, reason] of [[404, 'not_found'], [400, 'not_found'], [409, 'full'], [503, 'failed']] as const) {
    it(`a join answered ${status} rejects as ${reason}, and opens no socket`, async () => {
      const { f } = answering(status);
      const err = await openRoom({ kind: 'join', code: 'ABCDEF', callsign: 'Bo' }, 'b', deps({ fetch: f })).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RoomRefused);
      expect((err as RoomRefused).reason).toBe(reason);
    });
  }

  it('a fetch that throws (offline) rejects as failed', async () => {
    const f = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    const err = await openRoom({ kind: 'create', map: 'tel_marum', callsign: 'A' }, 'b', deps({ fetch: f })).catch((e: unknown) => e);
    expect((err as RoomRefused).reason).toBe('failed');
  });

  it('a build mismatch before the lobby rejects as build and closes the socket', async () => {
    const { f } = answering(200, { code: 'ABCDEF', seat: 1, ticket: 'tk-j' });
    const sock = fakeSocket();
    const p = openRoom({ kind: 'join', code: 'ABCDEF', callsign: 'Bo' }, 'b', deps({ fetch: f, openSocket: () => sock }));
    await tick();
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'build_mismatch' }) });
    const err = await p.catch((e: unknown) => e);
    expect((err as RoomRefused).reason).toBe('build');
    expect(sock.closed).toBeGreaterThan(0);
  });

  it('a join for a code this tab holds a seat in rejoins with the stored ticket and posts nothing', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-held', seat: 0 });
    const { f, calls } = answering(200);
    const sock = fakeSocket();
    const p = openRoom({ kind: 'join', code: 'ABCDEF', callsign: 'Ari' }, 'b', deps({ fetch: f, openSocket: () => sock, session }));
    await tick();
    expect(calls).toEqual([]);
    sock.onopen?.({});
    expect(JSON.parse(sock.sent[0])).toEqual({ t: 'hello', ticket: 'tk-held', build: 'b' });
    sock.onmessage?.({ data: JSON.stringify(LOBBY_TWO) });
    expect((await p).seat).toBe(0);
  });

  it('a stored ticket the room has ended is forgotten, and the join falls through to a fresh request', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-old', seat: 0 });
    const { f, calls } = answering(404);
    const sock = fakeSocket();
    const p = openRoom({ kind: 'join', code: 'ABCDEF', callsign: 'Ari' }, 'b', deps({ fetch: f, openSocket: () => sock, session }));
    await tick();
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'ended', reason: 'left' }) });
    const err = await p.catch((e: unknown) => e);
    expect(calls.map((c) => c.url)).toEqual(['http://x/api/match/ABCDEF/join']);
    expect((err as RoomRefused).reason).toBe('not_found');
    expect(loadSeat(session, 'ABCDEF')).toBeNull();
  });

  it('(c) a stored-ticket rejoin into a room that has already started detaches WITHOUT a bye, rejects as RoomStarted (the started map), and keeps the ticket', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-held', seat: 0 });
    const { f, calls } = answering(200);
    const sock = fakeSocket();
    const p = openRoom({ kind: 'join', code: 'ABCDEF', callsign: 'Ari' }, 'b', deps({ fetch: f, openSocket: () => sock, session }));
    await tick();
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'log', config: { ...CONFIG(1), map: 'qarn_hadid' }, frames: [] }) });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomRefused);
    expect((err as RoomRefused).reason).toBe('failed');
    // Task 7 review (g): the lobby goes to the match on THIS map rather than saying "failed".
    expect(err).toBeInstanceOf(RoomStarted);
    expect((err as RoomStarted).map).toBe('qarn_hadid');
    expect((err as RoomStarted).code).toBe('ABCDEF');
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['hello']);
    expect(sock.closed).toBeGreaterThan(0);
    // The battlefield's own rejoin still needs it, and nothing is asked of the room again.
    expect(loadSeat(session, 'ABCDEF')).toEqual({ ticket: 'tk-held', seat: 0 });
    expect(calls).toEqual([]);
  });

  it('(d) a stored ticket the room refuses for a BUILD mismatch rethrows as build, keeps the ticket and posts nothing', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-held', seat: 0 });
    const { f, calls } = answering(200);
    const sock = fakeSocket();
    const p = openRoom({ kind: 'join', code: 'ABCDEF', callsign: 'Ari' }, 'b', deps({ fetch: f, openSocket: () => sock, session }));
    await tick();
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'build_mismatch' }) });
    const err = await p.catch((e: unknown) => e);
    expect((err as RoomRefused).reason).toBe('build');
    expect(calls).toEqual([]);
    expect(loadSeat(session, 'ABCDEF')).toEqual({ ticket: 'tk-held', seat: 0 });
  });

  it('(d) a stored ticket the room calls bad_ticket is forgotten and the join goes on as a fresh request', async () => {
    const session = memory();
    saveSeat(session, 'ABCDEF', { ticket: 'tk-old', seat: 0 });
    const { f, calls } = answering(200, { code: 'ABCDEF', seat: 1, ticket: 'tk-new' });
    const socks = [fakeSocket(), fakeSocket()];
    let n = 0;
    const p = openRoom({ kind: 'join', code: 'ABCDEF', callsign: 'Ari' }, 'b', deps({ fetch: f, openSocket: () => socks[n++], session }));
    await tick();
    socks[0].onopen?.({});
    socks[0].onmessage?.({ data: JSON.stringify({ t: 'error', code: 'bad_ticket' }) });
    await tick();
    expect(calls.map((c) => c.url)).toEqual(['http://x/api/match/ABCDEF/join']);
    socks[1].onopen?.({});
    socks[1].onmessage?.({ data: JSON.stringify({ ...LOBBY_TWO, you: 1 }) });
    expect((await p).seat).toBe(1);
    expect(loadSeat(session, 'ABCDEF')).toEqual({ ticket: 'tk-new', seat: 1 });
  });

  it('an abort while waiting for the lobby rejects and closes the transport', async () => {
    const { f } = answering(201);
    const sock = fakeSocket();
    const ac = new AbortController();
    const p = openRoom({ kind: 'create', map: 'tel_marum', callsign: 'A' }, 'b', deps({ fetch: f, openSocket: () => sock, signal: ac.signal }));
    await tick();
    sock.onopen?.({});
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toContain('bye');
  });
});
