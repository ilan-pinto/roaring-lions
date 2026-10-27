// N4b task 11: the local relay -- the real Worker routes and the real
// `MatchRoom` on 127.0.0.1, with real sockets, real timers and real child
// processes. Every relay, client and child a test starts is closed by its own
// handle in `afterEach`; nothing here kills by name, and every port is the
// OS's (`listen(0)`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connect } from 'node:net';
import { format } from 'node:util';
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AgentClient } from './agent-client';
import { MAX_BODY_BYTES, serveLocalRelay, startLocalRelay, type LocalRelay } from './local-relay';
import { MatchRoom } from '../../../packages/worker/src/match/match-room';
import { snapshotBytes } from '../../../packages/worker/src/match/snapshot-fixture';
import { SNAPSHOT_MAX_COMPRESSED_BYTES, sha256Hex } from '@lions/net';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const BUILD = 'b-relay';
const MAP = 'tel_marum';

const cleanups: (() => Promise<void> | void)[] = [];
/** Registers a teardown; they run newest first, each awaited, whatever the test did. */
function own<T>(thing: T, close: (t: T) => Promise<void> | void): T {
  cleanups.push(() => close(thing));
  return thing;
}
afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    try { await c?.(); } catch { /* the next one still runs */ }
  }
  vi.restoreAllMocks();
});

async function relayOf(o: Parameters<typeof startLocalRelay>[0] = {}): Promise<LocalRelay> {
  return own(await startLocalRelay({ log: () => {}, ...o }), (r) => r.close());
}
const post = (relay: LocalRelay, path: string, body: unknown, origin = relay.origin): Promise<Response> =>
  fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** A versus room through the relay's own HTTP route: the host's code and ticket, then the guest's. */
async function versusRoom(relay: LocalRelay, guest = true): Promise<{ code: string; tickets: string[] }> {
  const created = await post(relay, '/api/match', { player: 'host-id', callsign: 'Host', build: BUILD, map: MAP, mode: 'versus' });
  expect(created.status).toBe(201);
  const { code, ticket } = (await created.json()) as { code: string; ticket: string };
  if (!guest) return { code, tickets: [ticket] };
  const joined = await post(relay, `/api/match/${code}/join`, { player: 'guest-id', callsign: 'Guest' });
  expect(joined.status).toBe(200);
  const j = (await joined.json()) as { seat: number; ticket: string };
  expect(j.seat).toBe(1);
  return { code, tickets: [ticket, j.ticket] };
}
function seatClient(relay: LocalRelay, code: string, ticket: string, seat: 0 | 1, log: (s: string) => void = () => {}): AgentClient {
  return own(new AgentClient({ server: relay.url, code, ticket, build: BUILD, role: 'seat', seat, log }), (c) => { c.close(); });
}
/** Pumps every client every millisecond until `until` holds, or fails after `ms`. */
async function pumpUntil(clients: AgentClient[], until: () => boolean, ms: number): Promise<void> {
  await new Promise<void>((res, rej) => {
    const deadline = Date.now() + ms;
    const timer = setInterval(() => {
      for (const c of clients) c.pump(50);
      if (until()) { clearInterval(timer); res(); } else if (Date.now() > deadline) { clearInterval(timer); rej(new Error(`not reached in ${ms} ms: ticks ${clients.map((c) => c.tick()).join(', ')}`)); }
    }, 1);
  });
}

describe('startLocalRelay', () => {
  it('binds 127.0.0.1 only, on a port the OS chose', async () => {
    const relay = await relayOf();
    const addr = relay.server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.port).toBeGreaterThan(0);
    expect(addr.port).not.toBe(5177);
    expect(relay.url).toBe(`http://127.0.0.1:${addr.port}`);
    expect(relay.origin).toBe(relay.url);
  });

  it('two AgentClients: a versus room made and joined through the HTTP routes, 100 ticks, every hash agreed, no desync', async () => {
    const relay = await relayOf({ tickMs: 5 });
    const { code, tickets } = await versusRoom(relay);
    const a = seatClient(relay, code, tickets[0], 0);
    const b = seatClient(relay, code, tickets[1], 1);
    const [ca, cb] = await Promise.all([a.ready, b.ready]);
    expect(ca.mode).toBe('versus');
    expect(ca.seed).toBe(cb.seed);
    await pumpUntil([a, b], () => a.tick() >= 100 && b.tick() >= 100 && a.transport.stats().hashOk.count >= 4 && b.transport.stats().hashOk.count >= 4, 20_000);
    expect(a.transport.stats().desyncTick).toBeNull();
    expect(b.transport.stats().desyncTick).toBeNull();
    expect(a.world()?.sim.hash()).toBeDefined();
    expect(a.result()).toBeNull();
  }, 30_000);

  it('tickMs: 2 runs 100 ticks in under 2 s of wall time', async () => {
    const relay = await relayOf({ tickMs: 2 });
    const { code, tickets } = await versusRoom(relay);
    const a = seatClient(relay, code, tickets[0], 0);
    const b = seatClient(relay, code, tickets[1], 1);
    await Promise.all([a.ready, b.ready]);
    const t0 = Date.now();
    await pumpUntil([a, b], () => a.tick() >= 100 && b.tick() >= 100, 10_000);
    expect(Date.now() - t0).toBeLessThan(2000);
  }, 30_000);

  it('seedFor fixes a versus room\'s seed, and is handed the room\'s code', async () => {
    const seen: string[] = [];
    const relay = await relayOf({ seedFor: (c) => { seen.push(c); return 7; } });
    const { code, tickets } = await versusRoom(relay);
    const a = seatClient(relay, code, tickets[0], 0);
    const b = seatClient(relay, code, tickets[1], 1);
    const [ca, cb] = await Promise.all([a.ready, b.ready]);
    expect(ca.seed).toBe(7);
    expect(cb.seed).toBe(7);
    expect(seen).toEqual([code]);
  }, 30_000);

  it('the Worker\'s own Origin rule: a foreign Origin is refused 403 on create and on the socket upgrade', async () => {
    const relay = await relayOf();
    expect((await post(relay, '/api/match', { player: 'p', build: BUILD, map: MAP, mode: 'versus' }, 'http://evil.example')).status).toBe(403);
    const { code } = await versusRoom(relay, false);
    const status = await new Promise<number>((res) => {
      const ws = new WebSocket(`${relay.url.replace(/^http/, 'ws')}/api/match/${code}/ws`, { origin: 'http://evil.example' });
      ws.on('unexpected-response', (_req, r) => { res(r.statusCode ?? 0); ws.terminate(); });
      ws.on('open', () => { res(101); ws.close(); });
      ws.on('error', () => {});
    });
    expect(status).toBe(403);
    // The same upgrade from the relay's own origin is accepted.
    const ok = await new Promise<number>((res) => {
      const ws = new WebSocket(`${relay.url.replace(/^http/, 'ws')}/api/match/${code}/ws`, { origin: relay.origin });
      ws.on('unexpected-response', (_req, r) => { res(r.statusCode ?? 0); ws.terminate(); });
      ws.on('open', () => { res(101); ws.close(); });
      ws.on('error', () => {});
    });
    expect(ok).toBe(101);
  });

  it('extraOrigins: a browser seat served from another port is accepted beside the relay\'s own origin, and an unlisted one is still 403 (snapshot S4 T1B)', async () => {
    const dev = 'http://127.0.0.1:5999';
    const relay = await relayOf({ extraOrigins: [dev] });
    const body = { player: 'p', build: BUILD, map: MAP, mode: 'versus' };
    expect((await post(relay, '/api/match', body, dev)).status).toBe(201);
    expect((await post(relay, '/api/match', body, 'http://127.0.0.1:5998')).status).toBe(403);
    // The relay's own origin keeps working with the extra one listed.
    expect((await post(relay, '/api/match', body)).status).toBe(201);
    // And with no option, the extra origin is not accepted.
    const plain = await relayOf();
    expect((await post(plain, '/api/match', body, dev)).status).toBe(403);
  });

  it('snapshotEveryTicks is minted into a versus room\'s config: 0 turns snapshots off, 40 is kept, and unset is the room\'s default 1,200 (snapshot S4 T1B)', async () => {
    const cadenceOf = async (o: Parameters<typeof startLocalRelay>[0]): Promise<number> => {
      const relay = await relayOf({ tickMs: 5, ...o });
      const { code, tickets } = await versusRoom(relay);
      const a = seatClient(relay, code, tickets[0], 0);
      const b = seatClient(relay, code, tickets[1], 1);
      const [ca] = await Promise.all([a.ready, b.ready]);
      return ca.snapshotEveryTicks ?? -1;   // -1: the config carried no cadence at all
    };
    expect(await cadenceOf({ snapshotEveryTicks: 0 })).toBe(0);
    expect(await cadenceOf({ snapshotEveryTicks: 40 })).toBe(40);
    expect(await cadenceOf({})).toBe(1200);
  }, 30_000);

  it('each start mints its own ticket secret: a seat ticket from one relay is refused by another', async () => {
    const a = await relayOf();
    const b = await relayOf();
    const { code, tickets } = await versusRoom(a, false);
    expect((await post(a, `/api/match/${code}/advisor`, { ticket: tickets[0], scope: 'advise' })).status).toBe(200);
    expect((await post(b, `/api/match/${code}/advisor`, { ticket: tickets[0], scope: 'advise' })).status).toBe(403);
  });

  it('close() frees the port and leaves no handle: a running match is torn down, the old port refuses, a second relay gets a port', async () => {
    const kinds = (): Map<string, number> => {
      const m = new Map<string, number>();
      for (const k of process.getActiveResourcesInfo()) m.set(k, (m.get(k) ?? 0) + 1);
      return m;
    };
    // Handles a previous spec closed can take a turn of the loop to leave the list.
    await new Promise((r) => setTimeout(r, 50));
    const before = kinds();
    // Every interval made while the relay lives (its alarm poll, each room's clock, the clients'
    // own) must be cleared by the end: counted by identity, not by Node's handle census.
    const made = new Set<unknown>();
    const cleared = new Set<unknown>();
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => { const t = realSet(fn, ms); made.add(t); return t; }) as typeof setInterval);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(((t?: Parameters<typeof clearInterval>[0]) => { cleared.add(t); realClear(t); }) as typeof clearInterval);
    const relay = await startLocalRelay({ log: () => {}, tickMs: 5 });
    const port = (relay.server.address() as AddressInfo).port;
    const { code, tickets } = await versusRoom(relay);
    const a = new AgentClient({ server: relay.url, code, ticket: tickets[0], build: BUILD, role: 'seat', seat: 0, log: () => {} });
    const b = new AgentClient({ server: relay.url, code, ticket: tickets[1], build: BUILD, role: 'seat', seat: 1, log: () => {} });
    await Promise.all([a.ready, b.ready]);
    await pumpUntil([a, b], () => a.tick() >= 20 && b.tick() >= 20, 20_000);
    // The relay closes under a running match: its sockets, its rooms' clocks and alarms, its server.
    await relay.close();
    expect(relay.server.listening).toBe(false);
    a.close();
    b.close();
    await new Promise((r) => setTimeout(r, 50));
    const after = kinds();
    for (const k of ['TCPServerWrap', 'TCPSocketWrap']) expect(after.get(k) ?? 0, k).toBe(before.get(k) ?? 0);
    // The relay's alarm poll, the room's clock, the pump's: all made, all cleared.
    expect(made.size).toBeGreaterThanOrEqual(3);
    expect([...made].filter((t) => !cleared.has(t))).toEqual([]);
    const refused = await new Promise<string>((res) => {
      const s = connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res('connected'); });
      s.on('error', (e: NodeJS.ErrnoException) => { res(e.code ?? 'error'); });
    });
    expect(refused).toBe('ECONNREFUSED');
    const second = await relayOf();
    expect((second.server.address() as AddressInfo).port).toBeGreaterThan(0);
    expect((await post(second, '/api/match', { player: 'p', build: BUILD, map: MAP, mode: 'versus' })).status).toBe(201);
    // close() twice is harmless.
    await relay.close();
  }, 30_000);

  it('a room handles its events one at a time, in arrival order, whichever socket they came from (a DO input gate)', async () => {
    const relay = await relayOf();
    const { code } = await versusRoom(relay);
    // Every message handler, and the close handler, awaits: per-socket chains would let them interleave.
    const seen: string[] = [];
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    vi.spyOn(MatchRoom.prototype, 'webSocketMessage').mockImplementation(async (_ws, msg) => {
      seen.push(`in:${String(msg)}`);
      await sleep(40);
      seen.push(`out:${String(msg)}`);
    });
    const realClose = MatchRoom.prototype.webSocketClose;
    vi.spyOn(MatchRoom.prototype, 'webSocketClose').mockImplementation(async function (this: MatchRoom, ws) {
      seen.push('in:close');
      await sleep(40);
      await realClose.call(this, ws);
      seen.push('out:close');
    });
    const open = (): Promise<WebSocket> => new Promise((res, rej) => {
      const ws = new WebSocket(`${relay.url.replace(/^http/, 'ws')}/api/match/${code}/ws`, { origin: relay.origin });
      own(ws, (w) => { w.terminate(); });
      ws.on('open', () => { res(ws); });
      ws.on('error', rej);
    });
    const a = await open();
    const b = await open();
    a.send('A1');
    await sleep(5);
    b.send('B1');
    await sleep(5);
    a.send('A2');
    await sleep(5);
    b.send('B2');
    await sleep(5);
    b.close();
    const deadline = Date.now() + 5000;
    while (!seen.includes('out:close') && Date.now() < deadline) await sleep(10);
    expect(seen).toEqual(['in:A1', 'out:A1', 'in:B1', 'out:B1', 'in:A2', 'out:A2', 'in:B2', 'out:B2', 'in:close', 'out:close']);
  }, 30_000);

  /** One raw socket on a fresh room, with `webSocketMessage` replaced by `handle` and `alarm` recording itself. */
  async function gatedRoom(handle: (room: MatchRoom, msg: string, seen: string[]) => Promise<void>): Promise<{ ws: WebSocket; seen: string[] }> {
    const relay = await relayOf();
    const { code } = await versusRoom(relay);
    const seen: string[] = [];
    vi.spyOn(MatchRoom.prototype, 'webSocketMessage').mockImplementation(async function (this: MatchRoom, _ws, msg) { await handle(this, String(msg), seen); });
    vi.spyOn(MatchRoom.prototype, 'alarm').mockImplementation(async () => { seen.push('alarm'); });
    const ws = await new Promise<WebSocket>((res, rej) => {
      const w = new WebSocket(`${relay.url.replace(/^http/, 'ws')}/api/match/${code}/ws`, { origin: relay.origin });
      own(w, (x) => { x.terminate(); });
      w.on('open', () => { res(w); });
      w.on('error', rej);
    });
    return { ws, seen };
  }
  /** The room's own storage, which the alarm poll reads (`FakeState.storage`). */
  const storageOf = (room: MatchRoom): { alarmAt: number | null } => (room as unknown as { ctx: { storage: { alarmAt: number | null } } }).ctx.storage;
  const nap = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('an alarm that falls due during a message handler waits for it: message in, message out, then the alarm', async () => {
    const { ws, seen } = await gatedRoom(async (room, msg, log) => {
      log.push(`in:${msg}`);
      storageOf(room).alarmAt = Date.now();
      // Longer than two alarm polls (250 ms): the poll sees it due while the handler runs.
      await nap(700);
      log.push(`out:${msg}`);
    });
    ws.send('M');
    const deadline = Date.now() + 5000;
    while (!seen.includes('alarm') && Date.now() < deadline) await nap(10);
    expect(seen).toEqual(['in:M', 'out:M', 'alarm']);
  }, 30_000);

  it('an alarm an earlier event cleared does not fire: its due time is read when its turn comes, not when it was queued', async () => {
    const { ws, seen } = await gatedRoom(async (room, msg, log) => {
      log.push(`in:${msg}`);
      storageOf(room).alarmAt = Date.now();
      await nap(700);
      // The handler changes its mind, as `setAlarm`/`deleteAlarm` may.
      storageOf(room).alarmAt = null;
      log.push(`out:${msg}`);
    });
    ws.send('M');
    await nap(1400);
    expect(seen).toEqual(['in:M', 'out:M']);
  }, 30_000);

  it('a handler that throws does not jam the gate: the next message is still handled', async () => {
    const { ws, seen } = await gatedRoom(async (_room, msg, log) => {
      log.push(`in:${msg}`);
      await nap(20);
      if (msg === 'X') throw new Error('handler threw');
      log.push(`out:${msg}`);
    });
    ws.send('X');
    await nap(5);
    ws.send('Y');
    const deadline = Date.now() + 5000;
    while (!seen.includes('out:Y') && Date.now() < deadline) await nap(10);
    expect(seen).toEqual(['in:X', 'in:Y', 'out:Y']);
  }, 30_000);

  it('the secret pin: nothing the relay (or a client of it) writes, to any stream, ever carries the ticket secret', async () => {
    const SECRET = 'pin-secret-0d9f3a7c-relay-test-only';
    const said: string[] = [];
    for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const orig = console[k];
      console[k] = (...args: unknown[]) => { said.push(format(...args)); orig.apply(console, args); };
      own(k, () => { console[k] = orig; });
    }
    for (const stream of [process.stdout, process.stderr]) {
      const orig = stream.write.bind(stream) as (...a: unknown[]) => boolean;
      vi.spyOn(stream, 'write').mockImplementation(((...a: unknown[]) => { said.push(String(a[0])); return orig(...a); }) as typeof stream.write);
    }
    const relay = own(await serveLocalRelay({ ticketSecret: SECRET, tickMs: 5, log: (s) => { said.push(s); } }), (r) => r.close());
    const { code, tickets } = await versusRoom(relay);
    const a = seatClient(relay, code, tickets[0], 0, (s) => { said.push(s); });
    const b = seatClient(relay, code, tickets[1], 1, (s) => { said.push(s); });
    await Promise.all([a.ready, b.ready]);
    await pumpUntil([a, b], () => a.tick() >= 40 && b.tick() >= 40, 20_000);
    await post(relay, '/api/match', { player: 'p', build: BUILD, map: MAP }, 'http://evil.example');
    await post(relay, `/api/match/${code}/advisor`, { ticket: 'not.a-ticket', scope: 'advise' });
    a.close();
    await relay.close();
    // The relay did speak (the pin is not vacuous) ...
    expect(said.some((s) => s.includes(relay.url))).toBe(true);
    // ... and the secret it signed every ticket with never reached a stream.
    for (const s of said) expect(s).not.toContain(SECRET);
  }, 30_000);
});

/** `StdioClientTransport` over the spawned agent, keeping every raw stdout chunk:
 *  the transport parses what it can, and this sees what it was given. */
class TeeTransport extends StdioClientTransport {
  readonly raw: Buffer[] = [];
  readonly errors: Error[] = [];
  child: ChildProcess | null = null;
  override async start(): Promise<void> {
    const started = super.start();
    // `start` spawns synchronously inside its promise; the child exists now.
    this.child = (this as unknown as { _process?: ChildProcess })._process ?? null;
    this.child?.stdout?.on('data', (chunk: Buffer) => { this.raw.push(chunk); });
    return started;
  }
}
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

describe('the snapshot route through the relay (snapshot S4 T10)', () => {
  /** 0xdeadbeef: above 2^31, so the signed hash the seats send and the u32 header word are different numbers. */
  const DIGEST = 3735928559;
  const HASH = -559038737;
  const TICK = 39;

  /** A headless seat: hello, ready, then an ack every ten ticks and a hash of HASH every twenty -- all a room needs to run and agree. */
  function headlessSeat(relay: LocalRelay, code: string, ticket: string): { agreed(tick: number): boolean; tick(): number } {
    const ws = own(new WebSocket(`${relay.url.replace(/^http/, 'ws')}/api/match/${code}/ws`, { origin: relay.origin }), (w) => { w.terminate(); });
    const ok = new Set<number>();
    let last = -1;
    ws.on('error', () => {});
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', ticket, build: BUILD })); });
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as { t: string; tick?: number };
      if (m.t === 'lobby') ws.send(JSON.stringify({ t: 'ready' }));
      else if (m.t === 'hashOk' && m.tick !== undefined) ok.add(m.tick);
      else if (m.t === 'frame' && m.tick !== undefined) {
        last = m.tick;
        if (m.tick % 10 === 9) ws.send(JSON.stringify({ t: 'ack', tick: m.tick }));
        if (m.tick % 20 === 19) ws.send(JSON.stringify({ t: 'hash', tick: m.tick, h: HASH }));
      }
    });
    return { agreed: (t) => ok.has(t), tick: () => last };
  }
  async function until(f: () => boolean, ms = 10_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!f()) {
      if (Date.now() > deadline) throw new Error(`not reached in ${ms} ms`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  /** A running versus room at cadence 40 whose seats agreed tick 39 on HASH and have moved past it. */
  async function agreedRoom(): Promise<{ relay: LocalRelay; code: string; tickets: string[] }> {
    const relay = await relayOf({ tickMs: 20, snapshotEveryTicks: 40 });
    const { code, tickets } = await versusRoom(relay);
    const a = headlessSeat(relay, code, tickets[0]);
    const b = headlessSeat(relay, code, tickets[1]);
    await until(() => a.agreed(TICK) && b.agreed(TICK) && a.tick() > TICK && b.tick() > TICK);
    return { relay, code, tickets };
  }
  /** The inflated snapshot: real header words, then filler ending in bytes that are not UTF-8 (0xff 0xfe 0x00). */
  function inflated(): Uint8Array {
    const raw = snapshotBytes({ frameTick: TICK, matchDigest: DIGEST, fill: 0x5a, length: 200 });
    raw.set([0xff, 0xfe, 0x00], raw.length - 3);
    return raw;
  }
  /** Stored (level 0) gzip, so the invalid bytes sit in the body VERBATIM: a UTF-8 decode of it cannot round-trip. */
  const gzipOf = (raw: Uint8Array): Uint8Array => new Uint8Array(gzipSync(raw, { level: 0 }));
  /** Same inflated bytes, different gzip wrapper (the mtime word): seat 1's body differs from seat 0's. */
  const rewrapped = (gz: Uint8Array): Uint8Array => { const c = gz.slice(); c[4] = 1; return c; };
  const upload = (relay: LocalRelay, code: string, ticket: string | null, body: Uint8Array, over: Record<string, string | null> = {}): Promise<Response> => {
    const headers: Record<string, string | null> = { origin: relay.origin, 'content-type': 'application/octet-stream', 'x-snapshot-tick': String(TICK), ...(ticket === null ? {} : { authorization: `Bearer ${ticket}` }), ...over };
    // A null removes the header, so "no Origin" is a request that carries none.
    const sent = Object.fromEntries(Object.entries(headers).filter((e): e is [string, string] => e[1] !== null));
    return fetch(`${relay.url}/api/match/${code}/snapshot`, { method: 'POST', headers: sent, body: body as BufferSource });
  };
  const get = (relay: LocalRelay, code: string, ticket: string, headers: Record<string, string>): Promise<Response> =>
    fetch(`${relay.url}/api/match/${code}/snapshot`, { headers: { authorization: `Bearer ${ticket}`, ...headers } });
  const utf8Fails = (b: Uint8Array): boolean => { try { new TextDecoder('utf-8', { fatal: true }).decode(b); return false; } catch { return true; } };

  it('the relay\'s body cap is the snapshot cap, as a literal 65,536 on both sides', () => {
    expect(SNAPSHOT_MAX_COMPRESSED_BYTES).toBe(65_536);
    expect(MAX_BODY_BYTES).toBe(65_536);
  });

  it('both seats POST the same snapshot through HTTP (202 then 201); a GET returns seat 0\'s bytes exactly, with the SHA, tick, digest and cache headers', async () => {
    const { relay, code, tickets } = await agreedRoom();
    const raw = inflated();
    const gz0 = gzipOf(raw);
    const gz1 = rewrapped(gz0);
    expect(utf8Fails(gz0)).toBe(true);                    // the premise: these bytes cannot survive a UTF-8 round trip
    expect(Buffer.from(gz0).includes(Buffer.from([0xff, 0xfe, 0x00]))).toBe(true);
    expect(Buffer.compare(gz0, gz1)).not.toBe(0);

    const first = await upload(relay, code, tickets[0], gz0);
    expect([first.status, await first.text()]).toEqual([202, 'held']);
    const second = await upload(relay, code, tickets[1], gz1);
    expect([second.status, await second.text()]).toEqual([201, 'stored']);

    const res = await get(relay, code, tickets[1], { origin: relay.origin });
    expect(res.status).toBe(200);
    const got = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.compare(got, gz0)).toBe(0);              // byte-exact, seat 0's upload (not seat 1's, not a mangled copy)
    expect(res.headers.get('x-snapshot-tick')).toBe(String(TICK));
    expect(res.headers.get('x-snapshot-sha')).toBe(await sha256Hex(raw));
    expect(res.headers.get('x-snapshot-digest')).toBe(String(DIGEST));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  }, 30_000);

  it('the Worker\'s refusals still apply: no ticket is 401, another seat code\'s ticket is 403, and a body over 64 KiB is 413 while exactly 64 KiB is not', async () => {
    const { relay, code, tickets } = await agreedRoom();
    const gz = gzipOf(inflated());
    expect((await upload(relay, code, null, gz)).status).toBe(401);
    expect((await get(relay, code, 'not-a-ticket', { origin: relay.origin })).status).toBe(403);
    // At exactly the cap the relay reads it and the room answers (an unminted tick is stale); one byte more is the relay's 413.
    const atCap = await upload(relay, code, tickets[0], new Uint8Array(65_536).fill(0xff), { 'x-snapshot-tick': '1199' });
    expect([atCap.status, await atCap.text()]).toEqual([409, 'stale']);
    const over = await upload(relay, code, tickets[0], new Uint8Array(65_537).fill(0xff), { 'x-snapshot-tick': '1199' });
    expect(over.status).toBe(413);
  }, 30_000);

  it('a GET with no Origin and Sec-Fetch-Site: same-origin reaches the room; with neither header (or another site) the Worker answers 403', async () => {
    const { relay, code, tickets } = await agreedRoom();
    const raw = inflated();
    const gz = gzipOf(raw);
    expect((await upload(relay, code, tickets[0], gz)).status).toBe(202);
    expect((await upload(relay, code, tickets[1], rewrapped(gz))).status).toBe(201);

    const same = await get(relay, code, tickets[0], { 'sec-fetch-site': 'same-origin' });
    expect(same.status).toBe(200);
    expect(Buffer.compare(new Uint8Array(await same.arrayBuffer()), gz)).toBe(0);
    expect(same.headers.get('x-snapshot-sha')).toBe(await sha256Hex(raw));

    expect((await get(relay, code, tickets[0], {})).status).toBe(403);
    expect((await get(relay, code, tickets[0], { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await get(relay, code, tickets[0], { 'sec-fetch-site': 'none' })).status).toBe(403);
    // The exemption is for a GET: a POST with the same header and no Origin is still refused.
    expect((await upload(relay, code, tickets[0], gz, { origin: null, 'sec-fetch-site': 'same-origin' })).status).toBe(403);
  }, 30_000);
});

describe('pnpm agent over stdio against the relay (deferred from N4a task 8)', () => {
  it('tools/list and observe answer, and every line the child wrote to stdout is a JSON-RPC 2.0 frame', async () => {
    const relay = await relayOf({ tickMs: 10 });
    const { code, tickets } = await versusRoom(relay, false);
    const host = seatClient(relay, code, tickets[0], 0);
    const hostPump = setInterval(() => { host.pump(20); }, 5);
    own(hostPump, (t) => { clearInterval(t); });
    const transport = new TeeTransport({
      command: join(root, 'tools/node_modules/.bin/tsx'),
      args: [join(here, 'agent.ts'), '--server', relay.url, '--code', code, '--scope', 'command', '--join', '--build', BUILD, '--callsign', 'Bot'],
      cwd: join(root, 'tools'),
      stderr: 'pipe',
    });
    const stderr: string[] = [];
    transport.stderr?.on('data', (c: Buffer) => { stderr.push(c.toString('utf8')); });
    const client = new Client({ name: 'local-relay-test', version: '0' });
    own(client, (c) => c.close());
    await client.connect(transport);
    transport.onerror = (e) => { transport.errors.push(e); };
    const pid = transport.pid;
    expect(pid).not.toBeNull();
    own(pid as number, async (p) => {
      // Belt and braces: the transport's close ends stdin, then signals by handle.
      if (alive(p)) transport.child?.kill('SIGTERM');
    });
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['observe', 'status', 'order']));
    let observed: { side?: number; units?: unknown[] } | null = null;
    const deadline = Date.now() + 40_000;
    while (observed === null && Date.now() < deadline) {
      const r = await client.callTool({ name: 'observe', arguments: {} });
      const text = (r.content as { type: string; text: string }[])[0]?.text ?? '';
      if (r.isError !== true) observed = JSON.parse(text) as { side?: number; units?: unknown[] };
      else await new Promise((res) => setTimeout(res, 200));
    }
    expect(observed).not.toBeNull();
    expect(observed?.side).toBe(1);
    expect((observed?.units ?? []).length).toBeGreaterThan(0);
    await client.close();
    // The child exits once its stdin closes.
    const exitDeadline = Date.now() + 10_000;
    while (alive(pid as number) && Date.now() < exitDeadline) await new Promise((res) => setTimeout(res, 50));
    expect(alive(pid as number)).toBe(false);
    const out = Buffer.concat(transport.raw).toString('utf8');
    const lines = out.split('\n');
    expect(lines.pop()).toBe('');   // every frame ends its line
    expect(lines.length).toBeGreaterThanOrEqual(3);   // initialize, tools/list, observe
    for (const line of lines) {
      let msg: unknown;
      try { msg = JSON.parse(line); } catch { throw new Error(`a stdout line that is not JSON: ${JSON.stringify(line.slice(0, 80))}`); }
      expect((msg as { jsonrpc?: unknown }).jsonrpc, line.slice(0, 80)).toBe('2.0');
    }
    expect(transport.errors).toEqual([]);
    // The child logged on stderr, where logs belong.
    expect(stderr.join('')).toMatch(/agent: command on seat 1/);
  }, 90_000);
});

describe('the boundary pin (decision D2)', () => {
  /** Every module specifier in a source file: static and dynamic imports, re-exports, require. */
  const specifiers = (src: string): string[] =>
    [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  it('the pattern sees every import form', () => {
    expect(specifiers("import { a } from '../../worker/src/x';\nexport * from \"@lions/worker\";\nconst m = await import('../packages/worker/src/y');\nimport '@lions/worker/z';\nrequire('packages/worker')"))
      .toEqual(['../../worker/src/x', '@lions/worker', '../packages/worker/src/y', '@lions/worker/z', 'packages/worker']);
  });
  it('nothing under packages/{app,render,net,sim}/src imports packages/worker or @lions/worker', () => {
    const offenders: string[] = [];
    let files = 0;
    for (const pkg of ['app', 'render', 'net', 'sim']) {
      const dir = join(root, 'packages', pkg, 'src');
      for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
        if (!rel.endsWith('.ts')) continue;
        files++;
        const file = join(dir, rel);
        for (const spec of specifiers(readFileSync(file, 'utf8'))) {
          const resolved = spec.startsWith('.') ? resolve(dirname(file), spec) : spec;
          if (spec.includes('@lions/worker') || spec.includes('packages/worker') || resolved.startsWith(join(root, 'packages', 'worker'))) {
            offenders.push(`${file.slice(root.length + 1)}: ${spec}`);
          }
        }
      }
    }
    expect(files).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
