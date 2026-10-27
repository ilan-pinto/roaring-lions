/**
 * The in-process room the harness specs drive (N4a tasks 4 and 8): the REAL
 * `MatchRoom` over the fake Durable Object runtime, and an in-memory socket
 * pair per client. Not a spec itself, so several specs share one copy; only
 * specs import it (it drives vitest's fake timers).
 *
 * `received` holds what the room sent each client socket, `sent` what each
 * client socket sent the room, so a spec can say what reached the room.
 */
import { expect, vi } from 'vitest';
import { setImmediate as realImmediate } from 'node:timers/promises';
import type { ClientMsg, Pace, ServerMsg, SocketLike } from '@lions/net';
import type { AdvisorScope } from '@lions/net';
import type { Env } from '../../../packages/worker/src/d1';
import { FakeState, deliverAlarm, deliverClose, openSocket, type FakeSocket } from '../../../packages/worker/src/match/fake-do';
import { MatchRoom, TICK_MS, type MatchRoomOptions } from '../../../packages/worker/src/match/match-room';
import { signTicket } from '../../../packages/worker/src/match/ticket';

export const ROOM_NOW = 1_790_000_000_000;
export const ROOM_SECRET = 'agent-client-secret';
export const ROOM_CODE = 'AGENTS';
export const ROOM_BUILD = 'b-agent';
export const ROOM_MAP = 'tel_marum';
const env = { DB: {}, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: ROOM_SECRET } as unknown as Env;

/** The in-memory socket pair `rejoin-catchup.test.ts` uses. */
export class Loop {
  private readonly pending = new Set<Promise<unknown>>();
  /** What the room sent each client socket, in order. */
  readonly received = new Map<SocketLike, ServerMsg[]>();
  /** What each client socket sent the room, in order. */
  readonly sent = new Map<SocketLike, ClientMsg[]>();
  constructor(readonly room: MatchRoom, readonly state: FakeState) {}
  private track(p: Promise<unknown>): void {
    this.pending.add(p);
    const done = (): void => { this.pending.delete(p); };
    p.then(done, done);
  }
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
  readonly open = (): SocketLike => {
    const server: FakeSocket = openSocket(this.room);
    let live = true;
    const heard: ServerMsg[] = [];
    const said: ClientMsg[] = [];
    // One socket's messages, and then its close, reach the room in the order
    // they were sent, as a real socket's do: a `bye` and the close behind it
    // must not race (`WsTransport.close` sends one and then the other).
    let last: Promise<unknown> = Promise.resolve();
    const inOrder = (f: () => Promise<unknown>): void => {
      const next = last.then(f);
      last = next.catch(() => {});
      this.track(next);
    };
    const client: SocketLike = {
      onopen: null, onmessage: null, onclose: null,
      send: (data) => {
        if (!live) throw new Error('send on a closed socket');
        said.push(JSON.parse(data) as ClientMsg);
        inOrder(() => this.room.webSocketMessage(server.asSocket(), data));
      },
      close: () => {
        if (!live) return;
        live = false;
        inOrder(() => deliverClose(this.room, server, 1000, 'closed'));
        this.track(Promise.resolve().then(() => client.onclose?.({ code: 1000 })));
      },
    };
    server.onSend((text) => {
      if (!live) return;
      heard.push(JSON.parse(text) as ServerMsg);
      client.onmessage?.({ data: text });
    });
    this.received.set(client, heard);
    this.sent.set(client, said);
    this.track(Promise.resolve().then(() => client.onopen?.({})));
    return client;
  };
  /** One room tick, then the watchdog alarm if it is due. */
  async tick(): Promise<void> {
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const storage = this.state.storage;
    if (storage.alarmAt !== null && storage.alarmAt <= Date.now()) await deliverAlarm(this.room, storage);
    await this.flush();
  }
  /** Every message every client socket sent the room. */
  allSent(): ClientMsg[] {
    return [...this.sent.values()].flat();
  }
}

export interface Room {
  loop: Loop;
  /** A seat ticket: seat 0 is the host (`Host`), seat 1 the guest (`Guest`). */
  ticket(seat: 0 | 1): Promise<string>;
  /** That seat's advisor ticket, as `/api/match/:code/advisor` mints it. */
  advisorTicket(seat: 0 | 1, scope: AdvisorScope): Promise<string>;
}

/** A created versus room with both seats joined. `pace` and `guest: 'bot'`
 *  make it a paced room (decision D5: only a bot seat makes it pace).
 *  `host`/`guest` are the seats' kinds in the start config (default human). */
export async function newRoom(o: { pace?: Pace; host?: 'human' | 'bot'; guest?: 'human' | 'bot'; room?: MatchRoomOptions; map?: string; matchup?: 'kdf' | 'sarim' } = {}): Promise<Room> {
  const state = new FakeState();
  // The tests run on fake timers, which never fire an upload's inflate turn (a zero-delay timer): a real event-loop turn stands in.
  const room = new MatchRoom(state, env, { inflateYield: (): Promise<void> => realImmediate(), ...o.room });
  const created = await room.fetch(new Request('https://room/create', {
    method: 'POST',
    body: JSON.stringify({ code: ROOM_CODE, matchId: ROOM_CODE, map: o.map ?? ROOM_MAP, mode: 'versus', build: ROOM_BUILD, player: 'Host', callsign: 'Host', ...(o.matchup ? { matchup: o.matchup } : {}), ...(o.pace ? { pace: o.pace } : {}), ...(o.host ? { kind: o.host } : {}) }),
  }));
  expect(created.status).toBe(200);
  const joined = await room.fetch(new Request('https://room/join', {
    method: 'POST', body: JSON.stringify({ player: 'Guest', callsign: 'Guest', ...(o.guest ? { kind: o.guest } : {}) }),
  }));
  expect(joined.status).toBe(200);
  const exp = ROOM_NOW + 3600 * 1000;
  return {
    loop: new Loop(room, state),
    ticket: (seat) => signTicket(ROOM_SECRET, { matchId: ROOM_CODE, seat, player: seat === 0 ? 'Host' : 'Guest', exp }),
    advisorTicket: (seat, scope) => signTicket(ROOM_SECRET, { matchId: ROOM_CODE, seat, player: 'advisor', exp, role: 'advisor', scope }),
  };
}

/** Room ticks until `until` holds (bounded by `ticks * 2`), pumping each runner after every tick. */
export async function play(loop: Loop, ticks: number, runners: { pump(n: number): number }[], until: () => boolean): Promise<void> {
  for (let i = 0; i < ticks * 2 && !until(); i++) {
    await loop.tick();
    for (const r of runners) r.pump(10);
    await loop.flush();
  }
}
