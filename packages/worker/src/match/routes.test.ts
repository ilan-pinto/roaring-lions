import { describe, it, expect } from 'vitest';
import { handleMatch } from './routes';
import { signTicket, verifyTicket } from './ticket';
import type { Env, RateLimiter } from '../d1';

const NOW = 1_790_000_000_000;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';

/** A namespace whose every stub answers from one in-memory table of rooms.
 *  `/join` reserves the seat at once, as the real room does (R5). */
function fakeRooms(): { env: Env; created: string[]; createBodies: Record<string, unknown>[]; joinBodies: Record<string, unknown>[]; wsSeen: Request[]; limited: string[]; calls: string[] } {
  const rooms = new Map<string, { seats: number }>();
  /** Every path any room stub was asked for, in order. */
  const calls: string[] = [];
  const created: string[] = [];
  const createBodies: Record<string, unknown>[] = [];
  const joinBodies: Record<string, unknown>[] = [];
  const wsSeen: Request[] = [];
  const limited: string[] = [];
  const stub = (name: string) => ({
    fetch: async (req: Request): Promise<Response> => {
      const path = new URL(req.url).pathname;
      calls.push(path);
      const room = rooms.get(name);
      if (path === '/create') { createBodies.push(await req.json() as Record<string, unknown>); rooms.set(name, { seats: 1 }); created.push(name); return Response.json({ ok: true }); }
      if (path === '/state') return room ? Response.json({ status: 'lobby', seats: room.seats }) : new Response('', { status: 404 });
      if (path === '/join') { joinBodies.push(await req.json() as Record<string, unknown>); if (!room) return new Response('', { status: 404 }); if (room.seats >= 2) return new Response('', { status: 409 }); room.seats++; return Response.json({ seat: 1 }); }
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
  return { env, created, createBodies, joinBodies, wsSeen, limited, calls };
}

const post = (url: string, body: unknown, origin = ORIGIN) =>
  new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify(body) });

describe('/api/match', () => {
  it('creates a room: a six-char code and a seat-0 ticket for the host', async () => {
    const { env, created } = fakeRooms();
    const res = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', callsign: 'Host', build: 'b1' }), env, NOW);
    expect(res.status).toBe(201);
    const body = await res.json() as { code: string; ticket: string; seat: number };
    expect(body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(body.seat).toBe(0);
    expect(created).toEqual([body.code]);
    const t = await verifyTicket('secret', body.ticket, NOW);
    expect(t?.seat).toBe(0);
    expect(t?.matchId).toBe(body.code);
    expect(t?.player).toBe('p-host');   // the id, not the callsign
  });
  it('the ticket carries the player id, the room gets player and callsign apart, and mode reaches the room', async () => {
    const { env, createBodies, joinBodies } = fakeRooms();
    const res = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', callsign: 'Ari', build: 'b1', mode: 'versus' }), env, NOW);
    const { code, ticket } = (await res.json()) as { code: string; ticket: string };
    expect(await verifyTicket('secret', ticket, NOW)).toMatchObject({ player: 'id-1' });
    expect(createBodies[0]).toMatchObject({ player: 'id-1', callsign: 'Ari', mode: 'versus' });
    const join = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'id-2', callsign: 'Bo' }), env, NOW);
    expect(await verifyTicket('secret', ((await join.json()) as { ticket: string }).ticket, NOW)).toMatchObject({ seat: 1, player: 'id-2' });
    expect(joinBodies[0]).toEqual({ player: 'id-2', callsign: 'Bo', kind: 'human', tiers: {} });
    // Anything but 'versus' is a sandbox; an absent callsign is 'Lion'.
    await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-3', build: 'b1', mode: 'conquest' }), env, NOW);
    expect(createBodies[1]).toMatchObject({ mode: 'sandbox', callsign: 'Lion' });
  });
  it('the host\'s matchup reaches the room, cleaned: anything unknown is the mirror (2026-10-14)', async () => {
    const { env, createBodies } = fakeRooms();
    await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map: 'tel_marum', matchup: 'sarim' }), env, NOW);
    await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map: 'tel_marum', matchup: '<rif>' }), env, NOW);
    await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map: 'tel_marum' }), env, NOW);
    expect(createBodies.map((b) => (b as { matchup?: string }).matchup)).toEqual(['sarim', 'mirror', 'mirror']);
  });
  it('KDF vs Sarim is Tel Marum and Wadi Tarfan only: any other map refuses a non-mirror matchup before a room is made; the mirror plays anywhere (the lead, 2026-10-14)', async () => {
    const { env, createBodies } = fakeRooms();
    for (const map of ['beit_sahwan_outskirts', 'milh_flats']) {
      for (const matchup of ['kdf', 'sarim']) {
        const res = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map, matchup }), env, NOW);
        expect(res.status, `${map} ${matchup}`).toBe(400);
      }
    }
    // No map named is the default map, which is not Tel Marum.
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', matchup: 'kdf' }), env, NOW)).status).toBe(400);
    expect(createBodies).toHaveLength(0);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map: 'beit_sahwan_outskirts', matchup: 'mirror' }), env, NOW)).status).toBe(201);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map: 'tel_marum', matchup: 'kdf' }), env, NOW)).status).toBe(201);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map: 'wadi_tarfan', matchup: 'sarim' }), env, NOW)).status).toBe(201);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map: 'milh_flats', matchup: 'mirror' }), env, NOW)).status).toBe(201);
    // A sandbox room ignores the matchup altogether.
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', map: 'beit_sahwan_outskirts', matchup: 'sarim' }), env, NOW)).status).toBe(201);
  });
  it('a versus room is offered only on the maps measured fair: any other map is a 400 before a room is made; a sandbox room is not limited (#561, the lead, 2026-10-14)', async () => {
    const { env, createBodies, created } = fakeRooms();
    for (const map of ['qarn_hadid', 'wadi_halam_basin', 'deir_amun', 'umm_zeitoun', 'khan_rafid', 'tel_marum_3']) {
      for (const matchup of ['mirror', undefined]) {
        const res = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map, ...(matchup ? { matchup } : {}) }), env, NOW);
        expect(res.status, `${map} ${matchup}`).toBe(400);
        expect(await res.text()).toBe('map not offered for versus');
      }
    }
    expect(createBodies).toEqual([]);
    expect(created).toEqual([]);
    for (const map of ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats']) {
      expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map }), env, NOW)).status, map).toBe(201);
    }
    expect(createBodies).toHaveLength(4);
    // A sandbox room is two humans on one side, not a contest: no fairness to measure, any shipped map.
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', map: 'qarn_hadid' }), env, NOW)).status).toBe(201);
    // An unknown map is still its own refusal.
    const unknown = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', build: 'b1', mode: 'versus', map: 'nope' }), env, NOW);
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toBe('unknown map');
  });
  // N1b follow-up: a callsign is cleaned the way the client cleans it
  // (`cleanCallsign`, @lions/net) before the room ever sees it -- the Worker
  // trusts nothing a client sent.
  it('cleans the callsign on create and on join: control and bidi characters out, NFKC, 24 code points, Lion when nothing is left', async () => {
    const { env, createBodies, joinBodies } = fakeRooms();
    const dirty = 'A\u0000r\u202Ei\u200B  ＢＯ\n' + 'x'.repeat(40);
    const res = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'id-1', callsign: dirty, build: 'b1' }), env, NOW);
    const { code } = (await res.json()) as { code: string };
    expect(createBodies[0]).toMatchObject({ callsign: 'A ri BO ' + 'x'.repeat(16) });
    expect((createBodies[0] as { callsign: string }).callsign).toHaveLength(24);
    await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'id-2', callsign: '\u202E\u0007\u200B' }), env, NOW);
    expect(joinBodies[0]).toEqual({ player: 'id-2', callsign: 'Lion', kind: 'human', tiers: {} });
    const again = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'id-4', callsign: 'Bo\tX\u2028Y' }), env, NOW);
    expect(again.status).toBeLessThan(500);
    expect(joinBodies[1]).toEqual({ player: 'id-4', callsign: 'Bo X Y', kind: 'human', tiers: {} });
  });
  it('a missing or empty player answers 400 on create and join, before any room is touched', async () => {
    const { env, createBodies, joinBodies } = fakeRooms();
    for (const player of [undefined, '', 5]) {
      const body = { build: 'b1', callsign: 'Host', ...(player === undefined ? {} : { player }) };
      expect((await handleMatch(post(`${ORIGIN}/api/match`, body), env, NOW)).status).toBe(400);
    }
    expect(createBodies).toEqual([]);
    const { code } = await (await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1' }), env, NOW)).json() as { code: string };
    for (const player of [undefined, '']) {
      const body = { callsign: 'Guest', ...(player === undefined ? {} : { player }) };
      expect((await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, body), env, NOW)).status).toBe(400);
    }
    expect(joinBodies).toEqual([]);
  });
  it('joins a room as seat 1, then refuses a third', async () => {
    const { env } = fakeRooms();
    const { code } = await (await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', callsign: 'Host', build: 'b1' }), env, NOW)).json() as { code: string };
    const join = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p-guest', callsign: 'Guest' }), env, NOW);
    expect(join.status).toBe(200);
    const joined = (await join.json()) as { seat: number; ticket: string };
    expect(joined.seat).toBe(1);
    expect(await verifyTicket('secret', joined.ticket, NOW)).toMatchObject({ matchId: code, seat: 1, player: 'p-guest' });
    expect((await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p-third', callsign: 'Third' }), env, NOW)).status).toBe(409);
    expect((await handleMatch(post(`${ORIGIN}/api/match/ZZZZZZ/join`, { player: 'p-lost', callsign: 'Lost' }), env, NOW)).status).toBe(404);
  });
  it('refuses a foreign or missing Origin, and fails closed with no TICKET_SECRET', async () => {
    const { env } = fakeRooms();
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1' }, 'https://evil.example'), env, NOW)).status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/api/match`, { method: 'POST', body: '{}' });
    expect((await handleMatch(noOrigin, env, NOW)).status).toBe(403);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1' }), { ...env, TICKET_SECRET: undefined }, NOW)).status).toBe(503);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1' }), { ...env, TICKET_SECRET: '' }, NOW)).status).toBe(503);
  });
  it('accepts an Origin listed in ALLOWED_ORIGINS', async () => {
    const { env } = fakeRooms();
    const withExtra = { ...env, ALLOWED_ORIGINS: 'https://lions.example, https://play.lions.example' };
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1' }, 'https://play.lions.example'), withExtra, NOW)).status).toBe(201);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1' }, 'https://other.example'), withExtra, NOW)).status).toBe(403);
  });
  it('refuses a create with no build (the hello check would be off), and caps the build', async () => {
    const { env, createBodies } = fakeRooms();
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { callsign: 'Host' }), env, NOW)).status).toBe(400);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { callsign: 'Host', build: '' }), env, NOW)).status).toBe(400);
    expect(createBodies).toEqual([]);
    const long = 'x'.repeat(500);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: long, map: 'tel_marum' }), env, NOW)).status).toBe(201);
    expect(createBodies[0]).toMatchObject({ build: 'x'.repeat(64), map: 'tel_marum' });
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1' }), env, NOW)).status).toBe(201);
    expect(createBodies[1]).toMatchObject({ build: 'b1', map: 'beit_sahwan_outskirts' });
  });
  it('a lower-case code is the same room, on join and on the upgrade (M8)', async () => {
    const { env } = fakeRooms();
    const { code } = await (await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', callsign: 'Host', build: 'b1' }), env, NOW)).json() as { code: string };
    const lower = code.toLowerCase();
    expect(lower).not.toBe(code);
    const join = await handleMatch(post(`${ORIGIN}/api/match/${lower}/join`, { player: 'p-guest', callsign: 'Guest' }), env, NOW);
    expect(join.status).toBe(200);
    const joined = (await join.json()) as { code: string; ticket: string };
    expect(joined.code).toBe(code);
    expect(await verifyTicket('secret', joined.ticket, NOW)).toMatchObject({ matchId: code, seat: 1 });
    const upgrade = new Request(`${ORIGIN}/api/match/${lower}/ws`, { headers: { origin: ORIGIN, upgrade: 'websocket' } });
    expect((await handleMatch(upgrade, env, NOW)).status).toBe(200);   // the fake answers 404 for a room it does not hold
  });
  it('rejects a malformed code before touching a room', async () => {
    const { env } = fakeRooms();
    expect((await handleMatch(post(`${ORIGIN}/api/match/abc/join`, { player: 'p-x', callsign: 'x' }), env, NOW)).status).toBe(400);
  });
  it('rate-limits create and join per IP, but never the socket upgrade (a reconnect loop would trip it)', async () => {
    const { env, limited, wsSeen } = fakeRooms();
    const { code } = await (await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', callsign: 'Host', build: 'b1' }), env, NOW)).json() as { code: string };
    await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p-guest', callsign: 'Guest' }), env, NOW);
    expect(limited).toEqual(['203.0.113.9', '203.0.113.9']);
    const upgrade = new Request(`${ORIGIN}/api/match/${code}/ws`, { headers: { origin: ORIGIN, upgrade: 'websocket' } });
    for (let i = 0; i < 10; i++) expect((await handleMatch(upgrade, env, NOW)).status).toBe(200);
    expect(limited).toHaveLength(2);
    expect(wsSeen).toHaveLength(10);
    expect(wsSeen[0].headers.get('upgrade')).toBe('websocket');
    const refusing = { ...env, ROOM_LIMIT: { limit: async () => ({ success: false }) } };
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1' }), refusing, NOW)).status).toBe(429);
    expect((await handleMatch(upgrade, refusing, NOW)).status).toBe(200);
  });
  it('#559 M-1: the upgrade has its own per-IP limit, WS_LIMIT, and a refused one reaches no room', async () => {
    const { env, wsSeen } = fakeRooms();
    const keys: string[] = [];
    let allow = 2;
    const wsEnv = { ...env, WS_LIMIT: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: allow-- > 0 }; } } } as Env;
    const upgrade = new Request(`${ORIGIN}/api/match/ABCDEF/ws`, { headers: { origin: ORIGIN, upgrade: 'websocket', 'cf-connecting-ip': '198.51.100.7' } });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await handleMatch(upgrade, wsEnv, NOW)).status);
    expect(statuses).toEqual([404, 404, 429, 429]);
    expect(keys).toEqual(Array(4).fill('198.51.100.7'));
    expect(wsSeen).toHaveLength(2);
  });
  it('#559 F5: a map the game does not ship -- a prototype key, an unknown name, a non-string -- is refused before any room is made', async () => {
    const { env, createBodies } = fakeRooms();
    for (const map of ['__proto__', 'constructor', 'toString', 'nope', 'x'.repeat(64), 7, {}]) {
      expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1', map }), env, NOW)).status, String(map)).toBe(400);
    }
    expect(createBodies).toEqual([]);
    expect((await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', build: 'b1', map: 'qarn_hadid' }), env, NOW)).status).toBe(201);
  });
  it('the socket upgrade also needs a good Origin', async () => {
    const { env, wsSeen } = fakeRooms();
    const evil = new Request(`${ORIGIN}/api/match/ABCDEF/ws`, { headers: { origin: 'https://evil.example', upgrade: 'websocket' } });
    expect((await handleMatch(evil, env, NOW)).status).toBe(403);
    expect(wsSeen).toHaveLength(0);
  });
  describe('per-seat kit: the kit rule and each seat\'s claim reach the room cleaned', () => {
    it('create carries kit and the host\'s tiers; join carries the guest\'s tiers; both cleaned against the shipped tracks', async () => {
      const { env, createBodies, joinBodies } = fakeRooms();
      const claim = JSON.parse('{"mbt_lavi":{"armour":99,"warp":1},"__proto__":{"armour":1},"sarim_rifles":{"armour":1}}') as unknown;
      const res = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p1', build: 'b1', mode: 'versus', map: 'tel_marum', kit: 'brigade', tiers: claim }), env, NOW);
      const { code } = (await res.json()) as { code: string };
      expect(createBodies[0]).toMatchObject({ kit: 'brigade', tiers: { mbt_lavi: { armour: 3 } } });
      expect(Object.keys(createBodies[0].tiers as object)).toEqual(['mbt_lavi']);
      await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p2', tiers: { inf_squad: { sensors: 2.7 }, constructor: { armour: 1 } } }), env, NOW);
      expect(joinBodies[0]).toMatchObject({ tiers: { inf_squad: { sensors: 2 } } });
      expect(Object.keys(joinBodies[0].tiers as object)).toEqual(['inf_squad']);
    });
    it('anything but exactly brigade is matched, a sandbox room is always matched, and junk tiers are {}', async () => {
      const { env, createBodies } = fakeRooms();
      await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p1', build: 'b1', mode: 'versus', map: 'tel_marum', kit: 'Brigade', tiers: 'x' }), env, NOW);
      await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p1', build: 'b1', kit: 'brigade', tiers: { mbt_lavi: { armour: 1 } } }), env, NOW);
      expect(createBodies.map((b) => b.kit)).toEqual(['matched', 'matched']);
      expect(createBodies[0].tiers).toEqual({});
    });
  });

  describe('N4a task 7: bot seats, the pace and the advisor ticket', () => {
    it('the host\'s seat kind and pace reach the room cleaned and clamped (D5); the guest\'s kind reaches /join', async () => {
      const { env, createBodies, joinBodies } = fakeRooms();
      const res = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p1', build: 'b1', mode: 'versus', map: 'tel_marum', kind: 'bot', pace: { kind: 'paced', roundTicks: 5, roundWallMs: 10_000_000 } }), env, NOW);
      const { code } = (await res.json()) as { code: string };
      expect(createBodies[0]).toMatchObject({ kind: 'bot', pace: { kind: 'paced', roundTicks: 20, roundWallMs: 600_000 } });
      await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p1', build: 'b1', kind: 'BOT', pace: { kind: 'paced', roundTicks: 'x', roundWallMs: 1 } }), env, NOW);
      expect(createBodies[1]).toMatchObject({ kind: 'human', pace: { kind: 'realtime' } });
      await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p1', build: 'b1', pace: { kind: 'paced', roundTicks: 40.7, roundWallMs: 999 } }), env, NOW);
      expect(createBodies[2]).toMatchObject({ kind: 'human', pace: { kind: 'paced', roundTicks: 40, roundWallMs: 1000 } });
      await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p2', kind: 'bot' }), env, NOW);
      expect(joinBodies[0]).toMatchObject({ kind: 'bot' });
    });

    const seatTicket = (code: string, seat: 0 | 1, o: { exp?: number; role?: 'seat' | 'advisor' } = {}): Promise<string> =>
      signTicket('secret', { matchId: code, seat, player: 'p-host', exp: o.exp ?? NOW + 60_000, ...(o.role === 'advisor' ? { role: 'advisor', scope: 'assist' } : o.role === 'seat' ? { role: 'seat' } : {}) });

    it('mints an advisor ticket from the seat\'s own ticket: same seat, the seat ticket\'s expiry, the scope asked for -- and never calls the room', async () => {
      const { env, calls, limited } = fakeRooms();
      for (const [seat, scope] of [[0, 'assist'], [1, 'advise']] as const) {
        const res = await handleMatch(post(`${ORIGIN}/api/match/ABCDEF/advisor`, { ticket: await seatTicket('ABCDEF', seat), scope }), env, NOW);
        expect(res.status).toBe(200);
        const { ticket } = (await res.json()) as { ticket: string };
        expect(await verifyTicket('secret', ticket, NOW)).toEqual({ matchId: 'ABCDEF', seat, player: 'advisor', exp: NOW + 60_000, role: 'advisor', scope });
      }
      // A pre-N4 seat ticket (no role) and an explicit seat ticket both work; a lower-case code is the same room.
      expect((await handleMatch(post(`${ORIGIN}/api/match/abcdef/advisor`, { ticket: await seatTicket('ABCDEF', 0, { role: 'seat' }), scope: 'advise' }), env, NOW)).status).toBe(200);
      expect(calls).toEqual([]);
      expect(limited).toHaveLength(3);   // ROOM_LIMIT applies
    });

    it('refuses an advisor ticket as the input, another code\'s ticket, an expired one and junk (403); a bad scope is 400; nothing reaches a room', async () => {
      const { env, calls } = fakeRooms();
      const url = `${ORIGIN}/api/match/ABCDEF/advisor`;
      const statusOf = async (body: unknown): Promise<number> => (await handleMatch(post(url, body), env, NOW)).status;
      expect(await statusOf({ ticket: await seatTicket('ABCDEF', 0, { role: 'advisor' }), scope: 'assist' })).toBe(403);
      expect(await statusOf({ ticket: await seatTicket('ZZZZZZ', 0), scope: 'assist' })).toBe(403);
      expect(await statusOf({ ticket: await seatTicket('ABCDEF', 0, { exp: NOW }), scope: 'assist' })).toBe(403);
      expect(await statusOf({ ticket: 'not.a.ticket', scope: 'assist' })).toBe(403);
      expect(await statusOf({ ticket: 7, scope: 'assist' })).toBe(403);
      expect(await statusOf({ scope: 'assist' })).toBe(403);
      for (const scope of ['command', 'ASSIST', '', undefined, 1]) expect(await statusOf({ ticket: await seatTicket('ABCDEF', 0), scope }), String(scope)).toBe(400);
      expect(calls).toEqual([]);
      expect((await handleMatch(new Request(url, { headers: { origin: ORIGIN } }), env, NOW)).status).toBe(405);
      const evil = post(url, { ticket: await seatTicket('ABCDEF', 0), scope: 'assist' }, 'https://evil.example');
      expect((await handleMatch(evil, env, NOW)).status).toBe(403);
      const refusing = { ...env, ROOM_LIMIT: { limit: async () => ({ success: false }) } };
      expect((await handleMatch(post(url, { ticket: await seatTicket('ABCDEF', 0), scope: 'assist' }), refusing, NOW)).status).toBe(429);
      expect(calls).toEqual([]);
    });
  });
});
