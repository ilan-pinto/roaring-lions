// @vitest-environment jsdom
/**
 * GH-1388: the computer seat. A match against it runs to a RESULT, headlessly, down the battlefield's own path (`runFrames`,
 * `applyFrame`, the hash-tick outcome), with zero network calls; the script is the arena's `rush` untouched; the seat issues ordinary
 * Commands and touches no sim state. Every check here was seen red under the one-line mutations listed in the commit that landed it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchCapTicksOf, type Frame, type MatchTransport } from '@lions/net';
import { runFrames, seatWorldFor } from '../frame-step';
import { buildMatchWorld, matchTick } from '../match-world';
import { decideOnHashTick, goalsOf, productionOf, type LocalDecision } from '../outcome';
import { connectMatch } from '../connect';
import { OFFLINE_CODE, OfflineMatchGone, armOffline, dropOffline, isOfflineTransport, takeOffline } from '../offline-slot';
import { HUMAN_SEAT, OfflineMatchTransport, offlineConfig, offlineMatch, type OfflineRequest } from '../offline-match';
import { ComputerSeat } from './computer-seat';
import { REALTIME_EVERY_TICKS, passive, rush } from './policy';
import { DESK_FLUSH_TICKS } from './order-desk';
import en from '../../i18n/en.json';

const REQ: OfflineRequest = { map: 'tel_marum', matchup: 'mirror', callsign: 'Ari', computerName: 'Basic computer', build: 'test+0', seed: 1234 };

/** Every way the page could reach a network: all of them count, none answers. */
function networkSpies() {
  const fetchSpy = vi.fn(async () => { throw new Error('network is off'); });
  const wsSpy = vi.fn(function WebSocketSpy() { throw new Error('network is off'); });
  const beacon = vi.fn(() => false);
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('WebSocket', wsSpy);
  vi.stubGlobal('XMLHttpRequest', wsSpy);
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
  return { calls: () => fetchSpy.mock.calls.length + wsSpy.mock.calls.length + beacon.mock.calls.length };
}

afterEach(() => {
  vi.unstubAllGlobals();
  dropOffline();
});

interface Run { result: LocalDecision['result'] | null; ticks: number; computerOrders: number; humanOrders: number; world: ReturnType<typeof buildMatchWorld> }

/** The battlefield's own loop, minus the DOM: frames from the transport, run by `runFrames`, the match decided on hash ticks. */
function play(req: OfflineRequest, o: { maxTicks: number; human?: (tick: number) => import('@lions/sim').Command[] } = { maxTicks: 6000 }): Run {
  const { transport, config } = offlineMatch(req);
  const world = buildMatchWorld(config);
  transport.attach(world);
  let decided: LocalDecision | null = null;
  let computerOrders = 0;
  let humanOrders = 0;
  const seen = transport as MatchTransport;
  const original = seen.take.bind(seen);
  seen.take = (max: number): Frame[] => {
    const frames = original(max);
    for (const f of frames) for (const s of f.cmds) { if (s.seat === HUMAN_SEAT) humanOrders++; else computerOrders++; }
    return frames;
  };
  const step = {
    transport, sim: world.sim, seatWorld: seatWorldFor(config, world.sim), config,
    runTick: () => { matchTick(world); },
    runtimeDigest: () => world.runtime?.digest() ?? 0,
    stopAfter: (tick: number): boolean => {
      decided = decideOnHashTick(decided, tick, config, world.sim, productionOf(world), goalsOf(world));
      return decided !== null;
    },
  };
  while (world.sim.tickCount < o.maxTicks && decided === null) {
    for (const c of o.human?.(world.sim.tickCount) ?? []) transport.queueCommand(c);
    if (runFrames(step, 4).ran === 0) break;
  }
  return { result: (decided as LocalDecision | null)?.result ?? null, ticks: world.sim.tickCount, computerOrders, humanOrders, world };
}

describe('a match against the computer seat runs to a result with no network at all', () => {
  it('KDF against the basic computer on Tel Marum: decided on a hash tick, zero fetch, WebSocket, XHR or beacon calls', () => {
    const net = networkSpies();
    const run = play(REQ, { maxTicks: matchCapTicksOf(offlineConfig(REQ)) });
    expect(run.result, `no result after ${run.ticks} ticks`).not.toBeNull();
    expect(run.ticks).toBeGreaterThan(200);
    expect(net.calls()).toBe(0);
    // The computer really played: it issued orders (ordinary commands, in its seat's frames), and the human, who issued none, was fought.
    expect(run.computerOrders).toBeGreaterThan(0);
    expect(run.humanOrders).toBe(0);
  }, 300_000);

  it('an economy pairing is refused: the computer builds nothing, so kdf and sarim could never end (GH-1388)', () => {
    for (const matchup of ['kdf', 'sarim'] as const) {
      expect(() => offlineConfig({ ...REQ, matchup }), matchup).toThrow(/mirror/);
      expect(() => offlineMatch({ ...REQ, matchup }), matchup).toThrow(/mirror/);
    }
    expect(() => offlineConfig(REQ)).not.toThrow();
  });

  it('a passive human on milh_flats (the worst cell) is found: the match reaches a result inside 20 sim-minutes, seeds 1001-1003', () => {
    for (const seed of [1001, 1002, 1003]) {
      const run = play({ ...REQ, map: 'milh_flats', seed }, { maxTicks: 24_000 });
      expect(run.result, `seed ${seed}: no result after ${run.ticks} ticks`).not.toBeNull();
    }
  }, 600_000);

  it('the opening: no order before the first decision at tick 100, then the script commits what is idle at home', () => {
    const run = play(REQ, { maxTicks: REALTIME_EVERY_TICKS + 30 });
    expect(run.computerOrders).toBeGreaterThan(0);
    const early = play(REQ, { maxTicks: REALTIME_EVERY_TICKS });
    expect(early.computerOrders).toBe(0);
  }, 120_000);

  it('connectMatch hands the armed match over without touching the page\'s network deps', async () => {
    const net = networkSpies();
    const m = offlineMatch(REQ);
    armOffline({ transport: m.transport, seat: HUMAN_SEAT, config: m.config });
    const deps = { fetch: fetch as typeof globalThis.fetch, origin: 'https://game.test', openSocket: () => { throw new Error('socket'); }, replaceUrl: vi.fn(), note: vi.fn(), store: null };
    const got = await connectMatch(new URLSearchParams(`net=${OFFLINE_CODE}`), 'tel_marum', 'test+0', deps);
    expect(got.transport).toBe(m.transport);
    expect(got.seat).toBe(HUMAN_SEAT);
    expect(got.config?.seats[1]?.kind).toBe('bot');
    expect(net.calls()).toBe(0);
    expect(deps.replaceUrl).not.toHaveBeenCalled();
  });

  it('a reload or a stray link finds nothing armed: OfflineMatchGone, and still no request', async () => {
    const net = networkSpies();
    const deps = { fetch: fetch as typeof globalThis.fetch, origin: 'https://game.test', openSocket: () => { throw new Error('socket'); }, replaceUrl: vi.fn(), note: vi.fn(), store: null };
    await expect(connectMatch(new URLSearchParams('net=offline'), 'tel_marum', 'test+0', deps)).rejects.toBeInstanceOf(OfflineMatchGone);
    expect(net.calls()).toBe(0);
  });

  it('a screen already left when connect runs takes nothing: the armed match is closed, not played', async () => {
    const m = offlineMatch(REQ);
    const close = vi.spyOn(m.transport, 'close');
    armOffline({ transport: m.transport, seat: HUMAN_SEAT, config: m.config });
    const ac = new AbortController();
    ac.abort();
    const deps = { fetch: fetch as typeof globalThis.fetch, origin: 'x', openSocket: () => { throw new Error('socket'); }, replaceUrl: vi.fn(), note: vi.fn(), store: null, signal: ac.signal };
    await expect(connectMatch(new URLSearchParams(`net=${OFFLINE_CODE}`), 'tel_marum', 'test+0', deps)).rejects.toThrow();
    expect(close).toHaveBeenCalled();
    expect(takeOffline()).toBeNull();
  });
});

describe('the seat is a player like any other', () => {
  it('the script is the arena\'s rush, untouched: the one both import', async () => {
    const players = await import('../../../../../tools/src/net/players');
    expect(players.rush).toBe(rush);
    expect(players.passive).toBe(passive);
    expect(players.REALTIME_EVERY_TICKS).toBe(REALTIME_EVERY_TICKS);
    expect(readFileSync(join(__dirname, 'computer-seat.ts'), 'utf8')).toMatch(/\(rush as SyncPolicy\)/);
  });

  it('what it issues are ordinary attackMove Commands, stamped with its seat and ids of its own side only', () => {
    const { transport, config } = offlineMatch(REQ);
    const world = buildMatchWorld(config);
    transport.attach(world);
    const mine = new Set(world.bySide[config.seats[1].side]);
    // Run to the decision tick, then read the frame the transport builds for it.
    const step = { transport, sim: world.sim, seatWorld: seatWorldFor(config, world.sim), config: null, runTick: () => { matchTick(world); } };
    expect(runFrames(step, REALTIME_EVERY_TICKS).ran).toBe(REALTIME_EVERY_TICKS);
    const frame = transport.take(1)[0];
    expect(frame?.tick).toBe(REALTIME_EVERY_TICKS);
    const cmds = frame?.cmds ?? [];
    expect(cmds.length).toBeGreaterThan(0);
    for (const s of cmds) {
      expect(s.seat).toBe(1);
      expect(s.cmd.kind).toBe('attackMove');
      if (s.cmd.kind === 'attackMove') for (const id of s.cmd.ids) expect(mine.has(id), `unit ${id} is not the computer's`).toBe(true);
    }
  }, 60_000);

  it('the desk paces it as the room does: never more than 4 commands in a frame, and not twice inside a flush window', () => {
    const { transport, config } = offlineMatch(REQ);
    const world = buildMatchWorld(config);
    transport.attach(world);
    const step = { transport, sim: world.sim, seatWorld: seatWorldFor(config, world.sim), config: null, runTick: () => { matchTick(world); } };
    const flushes: number[] = [];
    for (let t = 0; t < 600; t++) {
      const f = transport.take(1)[0];
      if (f === undefined) break;
      expect(f.cmds.length).toBeLessThanOrEqual(4);
      if (f.cmds.length > 0) flushes.push(f.tick);
      // run the one frame
      const feed: MatchTransport = { ...transport, local: true, queueCommand: () => {}, take: () => [f], reportTick: () => {}, status: () => ({ kind: 'local' }), close: () => {} };
      runFrames({ ...step, transport: feed }, 1);
    }
    for (let i = 1; i < flushes.length; i++) expect(flushes[i]! - flushes[i - 1]!, `flushes at ${flushes.join(',')}`).toBeGreaterThanOrEqual(DESK_FLUSH_TICKS);
  }, 120_000);

  it('a batch never crosses a decision tick, so the seat decides from a world that has run every tick before it', () => {
    const { transport } = offlineMatch(REQ);
    const a = transport.take(REALTIME_EVERY_TICKS + 50);
    expect(a.length).toBe(REALTIME_EVERY_TICKS);
    expect(a.at(-1)?.tick).toBe(REALTIME_EVERY_TICKS - 1);
    const b = transport.take(10);
    expect(b[0]?.tick).toBe(REALTIME_EVERY_TICKS);
  });

  it('is torn down by the transport\'s close: nothing more is produced, and queued human orders are dropped', () => {
    const { transport } = offlineMatch(REQ);
    transport.queueCommand({ kind: 'halt', ids: [1] });
    transport.close();
    expect(transport.take(5)).toEqual([]);
    transport.queueCommand({ kind: 'halt', ids: [1] });
    expect(transport.take(5)).toEqual([]);
    expect(isOfflineTransport(transport)).toBe(true);
    expect(isOfflineTransport(transport as unknown as MatchTransport & { offline?: boolean })).toBe(true);
  });

  it('a seat with no world attached orders nothing', () => {
    const seat = new ComputerSeat({ seat: 1, side: 1 });
    expect(seat.commandsFor(REALTIME_EVERY_TICKS)).toEqual([]);
    expect(seat.decisions).toBe(0);
  });
});

describe('the human seat', () => {
  it('its orders ride the same queue a single-player game\'s do, stamped seat 0, and the sim moves its units', () => {
    const { transport, config } = offlineMatch(REQ);
    const world = buildMatchWorld(config);
    transport.attach(world);
    const ids = world.bySide[config.seats[0].side].slice(0, 2);
    const before = ids.map((i) => world.sim.state.posX[i] + world.sim.state.posY[i]);
    transport.queueCommand({ kind: 'move', ids, x: world.sim.state.posX[ids[0]!] + 5 * 65536, y: world.sim.state.posY[ids[0]!] });
    const step = { transport, sim: world.sim, seatWorld: seatWorldFor(config, world.sim), config: null, runTick: () => { matchTick(world); } };
    const r = runFrames(step, 40);
    expect(r.ran).toBe(40);
    expect(r.dropped).toBe(0);
    expect(ids.map((i) => world.sim.state.posX[i] + world.sim.state.posY[i])).not.toEqual(before);
  }, 60_000);

  it('an order naming the computer\'s units is dropped by the ownership check, as it would be in a room', () => {
    const { transport, config } = offlineMatch(REQ);
    const world = buildMatchWorld(config);
    transport.attach(world);
    transport.queueCommand({ kind: 'halt', ids: world.bySide[config.seats[1].side].slice(0, 1) });
    const step = { transport, sim: world.sim, seatWorld: seatWorldFor(config, world.sim), config: null, runTick: () => { matchTick(world); } };
    expect(runFrames(step, 1).dropped).toBe(1);
  }, 60_000);
});

describe('the battlefield is wired to it', () => {
  it('main.ts attaches the world to an offline transport, ends an offline versus match on the sim\'s own result, and sends a stray offline link back to the lobby', () => {
    const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    expect(main).toMatch(/if \(versusWorld !== null && isOfflineTransport\(transport\)\) transport\.attach\(versusWorld\);/);
    expect(main).toMatch(/if \(transport\.local\) \{[\s\S]{0,400}if \(versusRoom\) \{[\s\S]{0,200}matchResult\(matchDecided\?\.result \?\? null, null, false\)[\s\S]{0,120}showMatchEnd\(result\)/);
    expect(main).toMatch(/err instanceof OfflineMatchGone\) \{\s*req\.navigate\(routes\.versus\(\), \{ replace: true \}\);/);
    expect(main).toMatch(/playComputer: async \(req\) => \{[\s\S]{0,200}import\('\.\/net\/offline-match'\)/);
  });
});

describe('invariant 4: the seat reads the public view and writes nothing', () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const read = (f: string): string => strip(readFileSync(join(__dirname, f), 'utf8'));

  it('computer-seat.ts and policy.ts name no sim column, no snapshot internals and no way to queue a command on the sim', () => {
    for (const f of ['computer-seat.ts', 'policy.ts']) {
      // The one handle on the sim the seat is given is the world it builds its fog tracker from.
      const src = read(f).replace('new FogTracker(world.sim, this.o.side)', '');
      expect(src, f).not.toMatch(/\.sim\b|\.state\b|internals|queueCommand|\.entityCount|\.unitTypes/);
    }
  });

  it('the offline transport reaches the sim only through attach, and its human orders ride the same queue a LocalTransport\'s do', () => {
    const src = strip(readFileSync(join(__dirname, '..', 'offline-match.ts'), 'utf8'));
    expect(src).not.toMatch(/\.state\b|internals/);
    expect(new OfflineMatchTransport(new ComputerSeat({ seat: 1, side: 1 })).local).toBe(true);
  });
});

describe('the label', () => {
  it('the computer is named by the catalogue everywhere a seat is named, and the lobby copy claims no more than the script does', () => {
    const c = offlineConfig({ ...REQ, computerName: en['versus.cpu.callsign'] });
    expect(c.seats[1].callsign).toBe('Basic computer');
    expect(c.seats[1].kind).toBe('bot');
    expect(c.seats[0].kind).toBe('human');
    for (const k of ['versus.cpu.callsign', 'versus.cpu.failed', 'versus.cpu.lead', 'versus.cpu.note', 'versus.cpu.start'] as const) {
      expect(typeof en[k], k).toBe('string');
    }
    // It says "basic" in both the button and the seat's name, and describes only what rush does: attack with what it starts with, build nothing.
    expect(en['versus.cpu.start']).toMatch(/basic/i);
    expect(en['versus.cpu.callsign']).toMatch(/basic/i);
    expect(en['versus.cpu.note']).toMatch(/builds nothing/);
    expect(en['versus.cpu.note']).not.toMatch(/smart|strong|expert|clever|learns|adapts|hard|challeng/i);
  });

  it('the config both sides run is annihilation, matched kits and real time, with the human at the host end', () => {
    const c = offlineConfig(REQ);
    expect([c.mode, c.pace.kind, c.winMode, c.seats[0].kit, c.seats[1].kit, c.seats[0].seat]).toEqual(['versus', 'realtime', undefined, 'matched', 'matched', 0]);
    expect(c.seats.map((s) => s.faction)).toEqual(['kdf', 'kdf']);
  });
});
