// N4a task 4: the headless client. An `AgentClient` joins a versus room the
// way the browser does -- a `WsTransport`, the world from `buildMatchWorld`,
// and the battlefield's own `runFrames` -- against the REAL `MatchRoom` over
// the fake Durable Object runtime, with the "browser" seat driven by those
// same app modules. No real socket: `Loop.open` (`test-room.ts`) bridges a
// `FakeSocket` to a `SocketLike`, as `rejoin-catchup.test.ts` does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { WsTransport, type Frame, type ServerMsg, type SocketLike } from '@lions/net';
import type { Command } from '@lions/sim';
import { buildMatchWorld, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { runFrames, seatWorldFor } from '../../../packages/app/src/net/frame-step';
import { decideOnHashTick, type LocalDecision } from '../../../packages/app/src/net/outcome';
import { AgentClient, matchSocketTarget } from './agent-client';
import { endOf, exitCodeFor } from './agent';
import { FogTracker } from './fog-tracker';
import { sideView } from './view';
import { versusConfig } from './test-config';
import { buildId } from './build-id';
import { Loop, ROOM_BUILD, ROOM_CODE, ROOM_MAP, ROOM_NOW, newRoom, play } from './test-room';

const NOW = ROOM_NOW;
const CODE = ROOM_CODE;
const BUILD = ROOM_BUILD;
const MAP = ROOM_MAP;
const TILE = 65536;

/** The browser's versus seat, cut to the sim: `bootBattlefield`'s world, `main.ts`'s frame step. */
class Browser {
  readonly t: WsTransport;
  w: MatchWorld | null = null;
  decided: LocalDecision | null = null;
  readonly frames: Frame[] = [];
  ran = 0;
  /** Side 0's fog over THIS sim, stepped as the renderer steps it: the reference for the agent's view. */
  fog0: FogTracker | null = null;
  constructor(loop: Loop, ticket: string) {
    this.t = new WsTransport(loop.open, ticket, BUILD, {
      onStart: (c) => { this.w = buildMatchWorld(c); this.fog0 = new FogTracker(this.w.sim, 0); },
    });
  }
  pump(max: number): number {
    const w = this.w;
    const config = this.t.config;
    if (w === null || config === null || this.decided !== null) return 0;
    const sim = w.sim;
    const ran = runFrames({
      transport: this.t, sim, seatWorld: seatWorldFor(config, sim), runTick: () => { sim.tick(); this.fog0?.step(); }, config,
      beforeFrame: (f) => { this.frames.push(f); },
      stopAfter: (tick) => { this.decided = decideOnHashTick(this.decided, tick, config, sim); return this.decided !== null; },
    }, max).ran;
    this.ran += ran;
    return ran;
  }
}

function agent(loop: Loop, ticket: string, seat: 0 | 1, build = BUILD): AgentClient {
  return new AgentClient({ server: 'https://room.test', code: CODE, ticket, build, role: 'seat', seat, open: loop.open, log: () => {} });
}

const sideIds = (w: MatchWorld, side: 0 | 1): number[] => {
  const st = w.sim.state;
  const out: number[] = [];
  for (let i = 0; i < w.sim.entityCount; i++) if (st.alive[i] === 1 && st.side[i] === side) out.push(i);
  return out;
};

beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AgentClient against the real room', () => {
  it('plays the same world as the browser seat: hashes agree for 200 ticks, and the view is this seat\'s', async () => {
    const { loop, ticket } = await newRoom();
    const a = agent(loop, await ticket(0), 0);
    const b = new Browser(loop, await ticket(1));
    await loop.flush();
    b.t.ready();
    await loop.flush();
    const config = await a.ready;
    expect(config.mode).toBe('versus');
    expect(a.world()).not.toBeNull();
    // Both forces march on each other's camp, so each side makes contact inside the 200 ticks.
    const aw = a.world() as MatchWorld;
    const view0 = a.view();
    expect(view0.side).toBe(0);
    a.desk.submit({ kind: 'attackMove', ids: sideIds(aw, 0), x: view0.enemyCamp[0] * TILE, y: view0.enemyCamp[1] * TILE }, a.tick());
    let ordered = false;
    await play(loop, 200, [a, {
      pump: (n) => {
        const r = b.pump(n);
        const bw = b.w;
        if (!ordered && bw !== null) {
          ordered = true;
          const camp = a.view().camp;
          b.t.queueCommand({ kind: 'attackMove', ids: sideIds(bw, 1), x: camp[0] * TILE, y: camp[1] * TILE });
        }
        return r;
      },
    }], () => a.tick() >= 200 && b.ran >= 200);
    expect(a.tick()).toBeGreaterThanOrEqual(200);
    expect(b.ran).toBeGreaterThanOrEqual(200);
    // The room compared both seats' hashes on every hash tick and found them equal.
    expect(a.transport.stats().hashOk.count).toBeGreaterThanOrEqual(9);
    expect(a.transport.stats().desyncTick).toBeNull();
    expect(b.t.stats().desyncTick).toBeNull();
    for (const msgs of loop.received.values()) expect(msgs.some((m) => m.t === 'desync')).toBe(false);
    const bw = b.w as MatchWorld;
    expect(a.tick()).toBe(b.ran);
    expect(aw.sim.hash()).toBe(bw.sim.hash());
    // The view: every own unit, and contacts only of the other side.
    const v = a.view();
    expect(v.units.map((u) => u.id).sort((x, y) => x - y)).toEqual(sideIds(aw, 0));
    expect(v.contacts.length).toBeGreaterThan(0);
    for (const c of v.contacts) expect(aw.sim.state.side[c.id]).toBe(1);
    // ...exactly the contacts side 0's fog shows over the browser's own sim.
    expect(v.contacts).toEqual(sideView(bw, 0, b.fog0 as FogTracker, null).contacts);
    expect(a.desk.records(5)[0].status).toBe('applied');
    expect(a.result()).toBeNull();
  });

  it('the desk feeds the room: 30 orders in one tick reach it 4 a frame, 20 ticks apart; 12 applied, 18 refused', async () => {
    const { loop, ticket } = await newRoom();
    const a = agent(loop, await ticket(0), 0);
    const b = new Browser(loop, await ticket(1));
    await loop.flush();
    b.t.ready();
    await loop.flush();
    await a.ready;
    await play(loop, 5, [a, b], () => a.tick() >= 5);
    const own = sideIds(a.world() as MatchWorld, 0);
    const results = Array.from({ length: 30 }, (_, i) => a.desk.submit(
      { kind: 'move', ids: [own[i % own.length]], x: (5 + (i % 20)) * TILE, y: (5 + Math.floor(i / 20)) * TILE } as Command,
      a.tick(),
    ));
    expect(results.filter((r) => 'error' in r && r.error === 'queue_full').length).toBe(18);
    await play(loop, 100, [a, b], () => a.tick() >= 100 && b.ran >= 100);
    const fromAgent = b.frames.map((f) => ({ tick: f.tick, n: f.cmds.filter((s) => s.seat === 0).length })).filter((f) => f.n > 0);
    expect(fromAgent.reduce((n, f) => n + f.n, 0)).toBe(12);
    for (const f of fromAgent) expect(f.n).toBeLessThanOrEqual(4);
    for (let i = 1; i < fromAgent.length; i++) expect(fromAgent[i].tick - fromAgent[i - 1].tick).toBeGreaterThanOrEqual(20);
    const ledger = a.desk.records(64);
    expect(ledger.length).toBe(12);
    expect(ledger.every((r) => r.status === 'applied')).toBe(true);
  });

  it('an enemy id is dropped on both machines: the ledger says so and the two sims still agree', async () => {
    const { loop, ticket } = await newRoom();
    const a = agent(loop, await ticket(0), 0);
    const c = agent(loop, await ticket(1), 1);
    await loop.flush();
    await Promise.all([a.ready, c.ready]);
    const aw = a.world() as MatchWorld;
    const theirs = sideIds(aw, 1);
    const mine = sideIds(aw, 0);
    const r0 = a.desk.submit({ kind: 'halt', ids: [theirs[0]] }, a.tick()) as { ref: number };
    const r1 = c.desk.submit({ kind: 'halt', ids: [mine[0]] }, c.tick()) as { ref: number };
    const r2 = c.desk.submit({ kind: 'move', ids: [theirs[0]], x: 20 * TILE, y: 20 * TILE }, c.tick()) as { ref: number };
    await play(loop, 80, [a, c], () => a.tick() >= 80 && c.tick() >= 80);
    const status = (cl: AgentClient, ref: number): string | undefined => cl.desk.records(64).find((r) => r.ref === ref)?.status;
    expect(status(a, r0.ref)).toBe('dropped');
    expect(status(c, r1.ref)).toBe('dropped');
    expect(status(c, r2.ref)).toBe('applied');
    expect(a.tick()).toBe(c.tick());
    expect(aw.sim.hash()).toBe((c.world() as MatchWorld).sim.hash());
    expect(a.transport.stats().desyncTick).toBeNull();
    expect(a.transport.stats().hashOk.count).toBeGreaterThanOrEqual(3);
  });

  it('N2-P2: the harness folds its runtime digest; one seat\'s alone is a desync the room names at tick 19', async () => {
    const { loop, ticket } = await newRoom();
    const a = new AgentClient({ server: 'https://room.test', code: CODE, ticket: await ticket(0), build: BUILD, role: 'seat', seat: 0, open: loop.open, log: () => {}, runtimeDigest: () => 7 });
    const c = agent(loop, await ticket(1), 1);
    await loop.flush();
    await Promise.all([a.ready, c.ready]);
    await play(loop, 40, [a, c], () => (a.tick() >= 40 && c.tick() >= 40) || a.transport.stats().desyncTick !== null);
    // The two sims agree; only the runtime digest differs.
    expect((a.world() as MatchWorld).sim.hash()).toBe((c.world() as MatchWorld).sim.hash());
    expect(a.transport.stats().desyncTick).toBe(19);
  });

  it('a seat\'s close() is a leave: the room ends the match, and the other client\'s result reads it once its frames are run', async () => {
    const { loop, ticket } = await newRoom();
    const a = agent(loop, await ticket(0), 0);
    const c = agent(loop, await ticket(1), 1);
    await loop.flush();
    await Promise.all([a.ready, c.ready]);
    await play(loop, 30, [a, c], () => a.tick() >= 30 && c.tick() >= 30);
    expect(c.result()).toBeNull();
    a.close();
    await loop.flush();
    expect([...loop.received.values()][1]).toContainEqual({ t: 'ended', reason: 'left', seat: 0 });
    for (let i = 0; i < 5; i++) c.pump(10);
    expect(c.result()).toEqual({ kind: 'won', side: 1, by: 'left' });
    expect(c.view().result).toBe('won (left)');
  });

  it('a seat that has its result leaves WITHOUT a bye: the room ends on the sims\' result, never on a leave', async () => {
    const { loop, ticket } = await newRoom();
    const a = agent(loop, await ticket(0), 0);
    const c = agent(loop, await ticket(1), 1);
    await loop.flush();
    await Promise.all([a.ready, c.ready]);
    await play(loop, 5, [a, c], () => a.tick() >= 5 && c.tick() >= 5);
    // Side 1 falls in both sims at the same point, by the sim's own hook.
    const aw = a.world() as MatchWorld;
    const cw = c.world() as MatchWorld;
    expect(a.tick()).toBe(c.tick());
    for (const id of sideIds(aw, 1)) { aw.sim.debugKill(id); cw.sim.debugKill(id); }
    await play(loop, 40, [a], () => a.result() !== null);
    expect(a.result()).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    // The quitting harness closes right after its `over`, before the other seat has told the room its own.
    a.close();
    await loop.flush();
    const [aSock] = [...loop.sent.keys()];
    expect((loop.sent.get(aSock) ?? []).map((m) => m.t)).toContain('over');
    expect((loop.sent.get(aSock) ?? []).map((m) => m.t)).not.toContain('bye');
    for (const heard of loop.received.values()) expect(heard).not.toContainEqual(expect.objectContaining({ t: 'ended', reason: 'left' }));
    await play(loop, 40, [c], () => c.result() !== null);
    expect(c.result()).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
  });

  it('after the room has ended the match, close() sends no bye either', async () => {
    const { loop, ticket } = await newRoom();
    const a = agent(loop, await ticket(0), 0);
    const c = agent(loop, await ticket(1), 1);
    await loop.flush();
    await Promise.all([a.ready, c.ready]);
    await play(loop, 30, [a, c], () => a.tick() >= 30 && c.tick() >= 30);
    a.close();   // a mid-match quit: a `bye`, which is a leave
    await loop.flush();
    for (let i = 0; i < 5; i++) c.pump(10);
    expect(c.result()).toEqual({ kind: 'won', side: 1, by: 'left' });
    c.close();
    await loop.flush();
    const [aSock, cSock] = [...loop.sent.keys()];
    expect((loop.sent.get(aSock) ?? []).map((m) => m.t)).toContain('bye');
    expect((loop.sent.get(cSock) ?? []).map((m) => m.t)).not.toContain('bye');
  });

  it('a build the room does not run: build_mismatch, `ready` rejects naming our build, and the client closes', async () => {
    const closed = vi.spyOn(AgentClient.prototype, 'close');
    const { loop, ticket } = await newRoom();
    const a = agent(loop, await ticket(0), 0, 'other');
    const refused = expect(a.ready).rejects.toThrow(
      'the room refused build "other"; it runs a different build. Check out that build\'s commit, or pass --build',
    );
    await loop.flush();
    await refused;
    const heard = [...loop.received.values()][0];
    expect(heard).toContainEqual({ t: 'error', code: 'build_mismatch' });
    expect(closed).toHaveBeenCalled();
    expect(a.world()).toBeNull();
  });
});

describe('buildId', () => {
  const version = (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  it('is the app\'s `${version}+${commit}`, by vite.config.ts appCommit()\'s rule', () => {
    expect(buildId({ GITHUB_SHA: 'ABCDEF1234567' })).toBe(`${version}+abcdef1234567`);
    // Not hex: the commit part is empty, and git is not asked.
    expect(buildId({ GITHUB_SHA: 'nothex' })).toBe(`${version}+`);
    // Workers Builds' variable wins over GitHub's.
    expect(buildId({ WORKERS_CI_COMMIT_SHA: '1111111', GITHUB_SHA: '2222222' })).toBe(`${version}+1111111`);
    // Neither set: the checkout's own HEAD.
    const head = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    expect(buildId({})).toBe(`${version}+${head}`);
  });
});

describe('matchSocketTarget', () => {
  it('is the browser\'s socket URL, and the server\'s own origin', () => {
    expect(matchSocketTarget('https://game.test', 'ABC123')).toEqual({ url: 'wss://game.test/api/match/ABC123/ws', origin: 'https://game.test' });
    expect(matchSocketTarget('http://127.0.0.1:8787/', 'A B')).toEqual({ url: 'ws://127.0.0.1:8787/api/match/A%20B/ws', origin: 'http://127.0.0.1:8787' });
  });
});

/** A bare in-memory socket (no room): the transport-level wiring tests drive an `AgentClient` with it. */
function bareSocket(): SocketLike & { sent: { t: string }[]; recv(msg: unknown): void } {
  const s: SocketLike & { sent: { t: string }[]; recv(msg: unknown): void } = {
    sent: [], onopen: null, onmessage: null, onclose: null,
    send: (d) => { s.sent.push(JSON.parse(d) as { t: string }); },
    close: () => {},
    recv: (msg) => { s.onmessage?.({ data: JSON.stringify(msg) }); },
  };
  return s;
}
const lobbyFor = (you: 0 | 1, ready = false): ServerMsg => ({
  t: 'lobby', config: null, you, map: MAP,
  seats: [{ seat: 0, callsign: 'c0', connected: true, ready: false }, { seat: 1, callsign: 'c1', connected: true, ready }],
});

describe('AgentClient roles and seats (transport level: the room admits advisor tickets in task 7)', () => {
  /** Joins, starts, and runs 25 frames: ticks 9 and 19 are an ack and a hash for a seat. */
  async function runFor(role: 'seat' | 'advisor'): Promise<{ sent: string[]; sock: ReturnType<typeof bareSocket> }> {
    const sock = bareSocket();
    const a = new AgentClient({ server: 'https://room.test', code: CODE, ticket: 'tkt', build: BUILD, role, seat: 0, open: () => sock, log: () => {} });
    sock.onopen?.({});
    sock.recv(lobbyFor(0));
    sock.recv({ t: 'start', config: versusConfig(MAP) });
    await a.ready;
    for (let tick = 0; tick < 27; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    expect(a.pump(40)).toBeGreaterThanOrEqual(20);
    a.close();
    return { sent: sock.sent.map((m) => m.t), sock };
  }
  it('an advisor client sends a hello and nothing else: no ready, ack, hash, over or bye', async () => {
    const { sent } = await runFor('advisor');
    expect(sent).toEqual(['hello']);
  });
  it('control: a seat client sends ready, ack, hash and bye', async () => {
    const { sent } = await runFor('seat');
    expect(sent).toEqual(expect.arrayContaining(['hello', 'ready', 'ack', 'hash', 'bye']));
  });
  it('an advisor\'s desk refuses orders: nothing queued, sent, or aged into a phantom loss', async () => {
    const sock = bareSocket();
    const a = new AgentClient({ server: 'https://room.test', code: CODE, ticket: 'tkt', build: BUILD, role: 'advisor', seat: 0, open: () => sock, log: () => {} });
    expect(a.desk.submit({ kind: 'halt', ids: [1] }, 0)).toEqual({ error: 'not in this scope' });
    expect(a.desk.records(10)).toEqual([]);
  });
  it('a lobby that names another seat for this socket rejects `ready`, sends no ready and no bye, and closes', async () => {
    const sock = bareSocket();
    const log: string[] = [];
    const a = new AgentClient({ server: 'https://room.test', code: CODE, ticket: 'tkt', build: BUILD, role: 'seat', seat: 0, open: () => sock, log: (l) => { log.push(l); } });
    const refused = expect(a.ready).rejects.toThrow('the room seated this socket as seat 1, but the client was asked to play seat 0');
    sock.onopen?.({});
    sock.recv(lobbyFor(1));
    await refused;
    expect(sock.sent.map((m) => m.t)).toEqual(['hello']);   // a `bye` from the seat it really holds would read as that seat leaving
    expect(a.transport.status()).toEqual({ kind: 'closed', reason: 'detached' });
    expect(log.join('\n')).toContain('seat 1');
  });
  it('a world this checkout cannot build is refused with no bye, and the agent ends `failed` with a non-zero exit', async () => {
    const sock = bareSocket();
    const log: string[] = [];
    const a = new AgentClient({ server: 'https://room.test', code: CODE, ticket: 'tkt', build: BUILD, role: 'seat', seat: 0, open: () => sock, log: (l) => { log.push(l); } });
    const refused = expect(a.ready).rejects.toThrow('map "no_such_map" is not shipped');
    sock.onopen?.({});
    sock.recv(lobbyFor(0));
    sock.recv({ t: 'start', config: versusConfig('no_such_map') });
    await refused;
    expect(sock.sent.map((m) => m.t)).toEqual(['hello', 'ready']);   // a `bye` would surrender a match this client never played
    const end = endOf(a, true);
    expect(end).toEqual({ kind: 'failed' });
    expect(exitCodeFor(end ?? { kind: 'ended' })).not.toBe(0);
    expect(log).toEqual([expect.stringContaining('is not shipped')]);
  });
  it('a lobby that agrees with the seat does not trip it', async () => {
    const sock = bareSocket();
    const a = new AgentClient({ server: 'https://room.test', code: CODE, ticket: 'tkt', build: BUILD, role: 'seat', seat: 1, open: () => sock, log: () => {} });
    sock.onopen?.({});
    sock.recv(lobbyFor(1));
    expect(sock.sent.map((m) => m.t)).toEqual(['hello', 'ready']);
    expect(a.transport.status()).toEqual({ kind: 'waiting' });
  });
});
