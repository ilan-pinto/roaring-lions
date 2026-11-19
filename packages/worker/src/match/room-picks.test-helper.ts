/**
 * GH-1384: the drivers the two branch-pick room specs share (`room-picks.test.ts`, the switch closed as shipped, and
 * `room-picks-open.test.ts`, the switch flipped by `vi.mock`). A room is created, joined, said hello to and readied as
 * `match-room.test.ts` does it, and the Worker's routes are driven against a recording room stub as `body-cap.test.ts`
 * does, so each spec can read what a room STORED, what it MINTED and what the routes FORWARDED. Not a spec itself.
 */
import { setImmediate as realImmediate } from 'node:timers/promises';
import type { MatchConfig, ServerMsg, Seat } from '@lions/net';
import type { Env, RateLimiter } from '../d1';
import { FakeState, openSocket, type FakeSocket } from './fake-do';
import { MatchRoom } from './match-room';
import { handleMatch } from './routes';
import { signTicket } from './ticket';

export const NOW = 1_790_000_000_000;
const SECRET = 'room-picks-secret';
const CODE = 'ABCDEF';
const BUILD = 'b1';
const YIELD = { inflateYield: (): Promise<void> => realImmediate() };
const env = { DB: {}, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: SECRET } as unknown as Env;

export interface RoomOpts { mode?: string; kit?: string; matchup?: string; tiers?: unknown; picks?: unknown; joinTiers?: unknown; joinPicks?: unknown; joinKind?: string }

/** The `/create` body the Worker forwards, then the `/join` one, exactly as `match-room.test.ts` sends them. */
export async function createdRoom(opts: RoomOpts, state = new FakeState()): Promise<{ state: FakeState; room: MatchRoom }> {
  const room = new MatchRoom(state, env, YIELD);
  const create = await room.fetch(new Request('https://room/create', {
    method: 'POST',
    body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD, player: 'p-host', callsign: 'Host', ...(opts.mode ? { mode: opts.mode } : {}), ...(opts.matchup ? { matchup: opts.matchup } : {}), ...(opts.kit !== undefined ? { kit: opts.kit } : {}), ...(opts.tiers !== undefined ? { tiers: opts.tiers } : {}), ...(opts.picks !== undefined ? { picks: opts.picks } : {}) }),
  }));
  if (create.status !== 200) throw new Error(`create ${create.status}`);
  const join = await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'p-guest', callsign: 'Guest', ...(opts.joinKind ? { kind: opts.joinKind } : {}), ...(opts.joinTiers !== undefined ? { tiers: opts.joinTiers } : {}), ...(opts.joinPicks !== undefined ? { picks: opts.joinPicks } : {}) }) }));
  if (join.status !== 200) throw new Error(`join ${join.status}`);
  return { state, room };
}

/** The room's stored meta, as persisted (structured-cloned by the fake storage). */
export async function storedMeta(state: FakeState): Promise<Record<string, unknown>> {
  const meta = await state.storage.get<Record<string, unknown>>('meta');
  if (!meta) throw new Error('no meta');
  return meta;
}

const ticket = (seat: Seat): Promise<string> => signTicket(SECRET, { matchId: CODE, seat, player: seat === 0 ? 'p-host' : 'p-guest', exp: NOW + 3600 * 1000 });
async function say(room: MatchRoom, ws: FakeSocket, msg: unknown): Promise<void> {
  await room.webSocketMessage(ws.asSocket(), JSON.stringify(msg));
}
/** Both seats say hello and ready on `room` (a fresh instance over the same state revives it), and seat 0's `start` config is returned. */
export async function startedConfig(room: MatchRoom): Promise<MatchConfig> {
  const ws0 = openSocket(room);
  await say(room, ws0, { t: 'hello', ticket: await ticket(0), build: BUILD });
  const ws1 = openSocket(room);
  await say(room, ws1, { t: 'hello', ticket: await ticket(1), build: BUILD });
  await say(room, ws0, { t: 'ready' });
  await say(room, ws1, { t: 'ready' });
  const start = (ws0.messages() as ServerMsg[]).find((m): m is Extract<ServerMsg, { t: 'start' }> => m.t === 'start');
  if (!start) throw new Error('no start');
  return start.config;
}
/** A revived room over `state`: a new instance, as after an eviction. */
export const revived = (state: FakeState): MatchRoom => new MatchRoom(state, env, YIELD);

const ORIGIN = 'https://roaring-lions.pint12.workers.dev';
/** The Worker's `/api/match` create and join routes against a recording room stub: the bodies each forwarded to the room. */
export async function forwardedBodies(create: Record<string, unknown>, join: Record<string, unknown>): Promise<{ create: Record<string, unknown>; join: Record<string, unknown> }> {
  const bodies: Record<string, Record<string, unknown>> = {};
  const stub = {
    fetch: async (req: Request): Promise<Response> => {
      const path = new URL(req.url).pathname;
      bodies[path] = (await req.json()) as Record<string, unknown>;
      return path === '/join' ? Response.json({ seat: 1 }) : Response.json({ ok: true });
    },
  };
  const limiter: RateLimiter = { limit: async () => ({ success: true }) };
  const routeEnv = { DB: {}, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: SECRET, ROOM_LIMIT: limiter, ROOMS: { idFromName: (n: string) => n, get: () => stub } } as unknown as Env;
  const post = (url: string, body: unknown): Request => new Request(url, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify(body) });
  const c = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p', build: 'b1', map: 'tel_marum', ...create }), routeEnv, NOW);
  if (c.status !== 201) throw new Error(`route create ${c.status}`);
  const j = await handleMatch(post(`${ORIGIN}/api/match/${CODE}/join`, { player: 'p2', ...join }), routeEnv, NOW);
  if (j.status !== 200) throw new Error(`route join ${j.status}`);
  return { create: bodies['/create'], join: bodies['/join'] };
}
