import { describe, it, expect } from 'vitest';
import { handleMatch } from './routes';
import { verifyTicket } from './ticket';
import type { Env, RateLimiter } from '../d1';

const NOW = 1_790_000_000_000;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';

/** A namespace whose every stub answers from one in-memory table of rooms.
 *  `/join` reserves the seat at once, as the real room does (R5). */
function fakeRooms(): { env: Env; created: string[]; wsSeen: Request[]; limited: string[] } {
  const rooms = new Map<string, { seats: number }>();
  const created: string[] = [];
  const wsSeen: Request[] = [];
  const limited: string[] = [];
  const stub = (name: string) => ({
    fetch: async (req: Request): Promise<Response> => {
      const path = new URL(req.url).pathname;
      const room = rooms.get(name);
      if (path === '/create') { rooms.set(name, { seats: 1 }); created.push(name); return Response.json({ ok: true }); }
      if (path === '/state') return room ? Response.json({ status: 'lobby', seats: room.seats }) : new Response('', { status: 404 });
      if (path === '/join') { if (!room) return new Response('', { status: 404 }); if (room.seats >= 2) return new Response('', { status: 409 }); room.seats++; return Response.json({ seat: 1 }); }
      if (path === '/ws') { wsSeen.push(req); return new Response('upgraded', { status: room ? 200 : 404 }); }
      return new Response('', { status: 404 });
    },
  });
  const limiter: RateLimiter = { limit: async ({ key }) => { limited.push(key); return { success: true }; } };
  const env = {
    DB: {} as Env['DB'], ASSETS: { fetch: async () => new Response('') },
    TICKET_SECRET: 'secret', ROOM_LIMIT: limiter,
    ROOMS: { idFromName: (n: string) => n, get: (id: unknown) => stub(id as string) },
  } as unknown as Env;
  return { env, created, wsSeen, limited };
}

const post = (url: string, body: unknown, origin = ORIGIN) =>
  new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify(body) });

describe('/api/match', () => {
  it('creates a room: a six-char code and a seat-0 ticket for the host', async () => {
    const { env, created } = fakeRooms();
    const res = await handleMatch(post(`${ORIGIN}/api/match`, { callsign: 'Host' }), env, NOW);
    expect(res.status).toBe(201);
    const body = await res.json() as { code: string; ticket: string; seat: number };
    expect(body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(body.seat).toBe(0);
    expect(created).toEqual([body.code]);
    const t = await verifyTicket('secret', body.ticket, NOW);
    expect(t?.seat).toBe(0);
    expect(t?.matchId).toBe(body.code);
    expect(t?.player).toBe('Host');
  });
  it('joins a room as seat 1, then refuses a third', async () => {
    const { env } = fakeRooms();
    const { code } = await (await handleMatch(post(`${ORIGIN}/api/match`, { callsign: 'Host' }), env, NOW)).json() as { code: string };
    const join = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { callsign: 'Guest' }), env, NOW);
    expect(join.status).toBe(200);
    const joined = (await join.json()) as { seat: number; ticket: string };
    expect(joined.seat).toBe(1);
    expect(await verifyTicket('secret', joined.ticket, NOW)).toMatchObject({ matchId: code, seat: 1, player: 'Guest' });
    expect((await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { callsign: 'Third' }), env, NOW)).status).toBe(409);
    expect((await handleMatch(post(`${ORIGIN}/api/match/ZZZZZZ/join`, { callsign: 'Lost' }), env, NOW)).status).toBe(404);
  });
  it('refuses a foreign or missing Origin, and fails closed with no TICKET_SECRET', async () => {
    const { env } = fakeRooms();
    expect((await handleMatch(post(`${ORIGIN}/api/match`, {}, 'https://evil.example'), env, NOW)).status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/api/match`, { method: 'POST', body: '{}' });
    expect((await handleMatch(noOrigin, env, NOW)).status).toBe(403);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, {}), { ...env, TICKET_SECRET: undefined }, NOW)).status).toBe(503);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, {}), { ...env, TICKET_SECRET: '' }, NOW)).status).toBe(503);
  });
  it('accepts an Origin listed in ALLOWED_ORIGINS', async () => {
    const { env } = fakeRooms();
    const withExtra = { ...env, ALLOWED_ORIGINS: 'https://lions.example, https://play.lions.example' };
    expect((await handleMatch(post(`${ORIGIN}/api/match`, {}, 'https://play.lions.example'), withExtra, NOW)).status).toBe(201);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, {}, 'https://other.example'), withExtra, NOW)).status).toBe(403);
  });
  it('rejects a malformed code before touching a room', async () => {
    const { env } = fakeRooms();
    expect((await handleMatch(post(`${ORIGIN}/api/match/abc/join`, { callsign: 'x' }), env, NOW)).status).toBe(400);
  });
  it('rate-limits create and join per IP, but never the socket upgrade (a reconnect loop would trip it)', async () => {
    const { env, limited, wsSeen } = fakeRooms();
    const { code } = await (await handleMatch(post(`${ORIGIN}/api/match`, { callsign: 'Host' }), env, NOW)).json() as { code: string };
    await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { callsign: 'Guest' }), env, NOW);
    expect(limited).toEqual(['203.0.113.9', '203.0.113.9']);
    const upgrade = new Request(`${ORIGIN}/api/match/${code}/ws`, { headers: { origin: ORIGIN, upgrade: 'websocket' } });
    for (let i = 0; i < 10; i++) expect((await handleMatch(upgrade, env, NOW)).status).toBe(200);
    expect(limited).toHaveLength(2);
    expect(wsSeen).toHaveLength(10);
    expect(wsSeen[0].headers.get('upgrade')).toBe('websocket');
    const refusing = { ...env, ROOM_LIMIT: { limit: async () => ({ success: false }) } };
    expect((await handleMatch(post(`${ORIGIN}/api/match`, {}), refusing, NOW)).status).toBe(429);
    expect((await handleMatch(upgrade, refusing, NOW)).status).toBe(200);
  });
  it('the socket upgrade also needs a good Origin', async () => {
    const { env, wsSeen } = fakeRooms();
    const evil = new Request(`${ORIGIN}/api/match/ABCDEF/ws`, { headers: { origin: 'https://evil.example', upgrade: 'websocket' } });
    expect((await handleMatch(evil, env, NOW)).status).toBe(403);
    expect(wsSeen).toHaveLength(0);
  });
});
