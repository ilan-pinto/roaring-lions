import { describe, it, expect, vi } from 'vitest';
import { handleMatch } from './routes';
import { signTicket, verifyTicket } from './ticket';
import type { D1Like, Env, RateLimiter } from '../d1';
import { openTestD1 } from '../test-d1';
import { ACCOUNTS_MIGRATIONS, seedWalletMember } from '../account/test-kit';

const NOW = 1_790_000_000_000;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';

/** A namespace whose every stub answers from one in-memory table of rooms.
 *  `/join` reserves the seat at once, as the real room does (R5). */
interface SnapSeen { room: string; url: string; method: string; authorization: string | null; tick: string | null; body: Uint8Array }
function fakeRooms(): { env: Env; created: string[]; createBodies: Record<string, unknown>[]; joinBodies: Record<string, unknown>[]; wsSeen: Request[]; limited: string[]; calls: string[]; snapSeen: SnapSeen[]; snapKeys: string[] } {
  const rooms = new Map<string, { seats: number; kinds: [string, string] }>();
  /** Every path any room stub was asked for, in order. */
  const calls: string[] = [];
  const created: string[] = [];
  const createBodies: Record<string, unknown>[] = [];
  const joinBodies: Record<string, unknown>[] = [];
  const wsSeen: Request[] = [];
  const limited: string[] = [];
  /** What each room stub was sent at /snapshot, and the keys SNAP_LIMIT was asked for. */
  const snapSeen: SnapSeen[] = [];
  const snapKeys: string[] = [];
  const stub = (name: string) => ({
    fetch: async (req: Request): Promise<Response> => {
      const path = new URL(req.url).pathname;
      calls.push(path);
      const room = rooms.get(name);
      if (path === '/create') { const cb = await req.json() as Record<string, unknown>; createBodies.push(cb); rooms.set(name, { seats: 1, kinds: [typeof cb.kind === 'string' ? cb.kind : 'human', 'human'] }); created.push(name); return Response.json({ ok: true }); }
      if (path === '/kinds') return room ? Response.json({ kinds: room.kinds }) : new Response('', { status: 404 });
      if (path === '/state') return room ? Response.json({ status: 'lobby', seats: room.seats }) : new Response('', { status: 404 });
      if (path === '/join') { const jb = await req.json() as Record<string, unknown>; joinBodies.push(jb); if (!room) return new Response('', { status: 404 }); if (jb.build === 'other-build') return Response.json({ error: 'build_mismatch', build: 'b1' }, { status: 412 }); if (room.seats >= 2) return new Response('', { status: 409 }); room.seats++; room.kinds[1] = typeof jb.kind === 'string' ? jb.kind : 'human'; return Response.json({ seat: 1 }); }
      if (path === '/ws') { wsSeen.push(req); return new Response('upgraded', { status: room ? 200 : 404 }); }
      if (path === '/snapshot') {
        snapSeen.push({ room: name, url: req.url, method: req.method, authorization: req.headers.get('authorization'), tick: req.headers.get('x-snapshot-tick'), body: new Uint8Array(await req.arrayBuffer()) });
        return req.method === 'POST' ? new Response('stored', { status: 201 }) : new Response(new Uint8Array([7, 8, 9]), { status: 200, headers: { 'x-snapshot-tick': '1200' } });
      }
      return new Response('', { status: 404 });
    },
  });
  const limiter: RateLimiter = { limit: async ({ key }) => { limited.push(key); return { success: true }; } };
  const snapLimiter: RateLimiter = { limit: async ({ key }) => { snapKeys.push(key); return { success: true }; } };
  const env = {
    DB: {} as Env['DB'], ASSETS: { fetch: async () => new Response('') },
    TICKET_SECRET: 'secret', ROOM_LIMIT: limiter, SNAP_LIMIT: snapLimiter,
    ROOMS: { idFromName: (n: string) => n, get: (id: unknown) => stub(id as string) },
  } as unknown as Env;
  return { env, created, createBodies, joinBodies, wsSeen, limited, calls, snapSeen, snapKeys };
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
    expect(joinBodies[0]).toEqual({ player: 'id-2', callsign: 'Bo', kind: 'human', member: null, tiers: {}, specials: [] });
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
  it('GH-976 P2, P4: a win mode reaches the room only when it was read fair on the map in that pairing; anything else is a 400 before a room is made', async () => {
    const { env, createBodies } = fakeRooms();
    const body = (over: Record<string, unknown>) => ({ player: 'id-1', build: 'b1', mode: 'versus', map: 'wadi_tarfan', ...over });
    // The oracle is a literal (GH-976 P4): the seven open maps, each read fair for the points race in the mirror (the flag too on five of them since the 12 Nov relist).
    const SEVEN = ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];
    const POINTS_SIX = SEVEN.filter((m) => m !== 'milh_flats');   // milh_flats points delisted 13 Nov (GH-976): 400, no room
    for (const map of SEVEN) {
      expect((await handleMatch(post(`${ORIGIN}/api/match`, body({ map, winMode: 'points' })), env, NOW)).status, map).toBe(POINTS_SIX.includes(map) ? 201 : 400);
    }
    expect(createBodies.map((b) => b.winMode)).toEqual(POINTS_SIX.map(() => 'points'));
    // GH-976 relist (12 Nov): the flag is a 201 on the three offered maps (mirror) and a 400 on the other four, milh_flats and milh_flats_l included (12 and 13 Nov delists), and no room is made for those.
    const FLAG_THREE = ['wadi_tarfan', 'rujm_sawda', 'wadi_tarfan_l'];   // milh_flats (12 Nov) and milh_flats_l (13 Nov) delisted (GH-976): 400 for flag
    for (const map of SEVEN) {
      const res = await handleMatch(post(`${ORIGIN}/api/match`, body({ map, winMode: 'flag' })), env, NOW);
      if (FLAG_THREE.includes(map)) { expect(res.status, map).toBe(201); continue; }
      expect(res.status, map).toBe(400);
      expect(await res.text(), map).toBe('win mode not offered on this map');
    }
    expect(createBodies.slice(POINTS_SIX.length).map((b) => b.map)).toEqual(FLAG_THREE);
    expect(createBodies.length).toBe(POINTS_SIX.length + FLAG_THREE.length);
    createBodies.splice(0, createBodies.length);
    // GH-976 P4 review: no KDF-v-Sarim cell passed, so every faction pairing is a 400 below, whoever hosts.
    // Annihilation by any of its spellings is no mode: the room is told nothing, as every room before.
    for (const winMode of [undefined, null, 'annihilation']) {
      expect((await handleMatch(post(`${ORIGIN}/api/match`, body({ winMode })), env, NOW)).status).toBe(201);
    }
    expect(createBodies.every((b) => !('winMode' in b))).toBe(true);
    const made = createBodies.length;
    const refuse = async (over: Record<string, unknown>, text: string): Promise<void> => {
      const res = await handleMatch(post(`${ORIGIN}/api/match`, body(over)), env, NOW);
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(await res.text()).toBe(text);
    };
    await refuse({ winMode: 'rally' }, 'unknown win mode');            // not a mode at all
    await refuse({ winMode: 7 }, 'unknown win mode');
    await refuse({ winMode: 'camp', map: 'rujm_sawda' }, 'win mode not offered on this map');   // screened and not fair (GH-976); camp is offered on wadi_tarfan, milh_flats, wadi_tarfan_l only
    await refuse({ winMode: 'camp', map: 'tel_marum' }, 'win mode not offered on this map');
    await refuse({ winMode: 'points', map: 'qarn_hadid' }, 'map not offered for versus');   // not an open map at all: refused before the mode is asked
    await refuse({ winMode: 'points', mode: 'sandbox' }, 'win mode is for versus rooms');
    // GH-976 P4: every KDF-v-Sarim cell the probe read and found unfair is a 400 in both seat orders, before a room is made.
    const unfair = 'win mode not offered on this map for this matchup';
    for (const matchup of ['kdf', 'sarim']) {
      await refuse({ winMode: 'points', matchup }, unfair);                                  // wadi_tarfan: the forces annihilate each other first
      await refuse({ winMode: 'flag', matchup }, unfair);                                    // wadi_tarfan: Sarim wins every raid
      await refuse({ winMode: 'points', map: 'tel_marum', matchup }, unfair);                // fair on the lead, 26-29% decided by the goal
      await refuse({ winMode: 'flag', map: 'tel_marum', matchup }, unfair);
      await refuse({ winMode: 'flag', map: 'wadi_tarfan_l', matchup }, unfair);              // the KDF wins every raid
      await refuse({ winMode: 'camp', map: 'wadi_tarfan_l', matchup }, unfair);
      await refuse({ winMode: 'points', map: 'wadi_tarfan_l', matchup }, unfair);            // the one cell that passed at weight 10 was a kill race and is gone
    }
    // And a mirror-only map refuses the pairing itself before the mode is asked (the lead, 2026-10-14).
    for (const map of ['beit_sahwan_outskirts', 'milh_flats', 'milh_flats_l', 'rujm_sawda']) {
      for (const matchup of ['kdf', 'sarim']) {
        const res = await handleMatch(post(`${ORIGIN}/api/match`, body({ map, matchup, winMode: 'points' })), env, NOW);
        expect(res.status, `${map} ${matchup}`).toBe(400);
      }
    }
    expect(createBodies).toHaveLength(made);   // not one of them reached a room
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
    expect(joinBodies[0]).toEqual({ player: 'id-2', callsign: 'Lion', kind: 'human', member: null, tiers: {}, specials: [] });
    const again = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'id-4', callsign: 'Bo\tX\u2028Y' }), env, NOW);
    expect(again.status).toBeLessThan(500);
    expect(joinBodies[1]).toEqual({ player: 'id-4', callsign: 'Bo X Y', kind: 'human', member: null, tiers: {}, specials: [] });
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
  it('passes a joiner\'s build to the room, and relays its 412 (the room\'s own build) without a ticket (GH-954)', async () => {
    const { env, joinBodies } = fakeRooms();
    const { code } = await (await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-host', callsign: 'Host', build: 'b1' }), env, NOW)).json() as { code: string };
    const bad = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p-bot', callsign: 'Bot', kind: 'bot', build: 'other-build' }), env, NOW);
    expect(bad.status).toBe(412);
    expect(await bad.json()).toEqual({ error: 'build_mismatch', build: 'b1' });
    expect(joinBodies.at(-1)).toMatchObject({ build: 'other-build' });
    const ok = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p-bot', callsign: 'Bot', kind: 'bot', build: 'b1' }), env, NOW);
    expect(ok.status).toBe(200);
    expect(joinBodies.at(-1)).toMatchObject({ build: 'b1' });
    const browser = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p-x', callsign: 'X' }), env, NOW);
    expect(browser.status).toBe(409);   // the seat is taken now; the point is the body it sent
    expect(joinBodies.at(-1)).not.toHaveProperty('build');   // a browser names none: the room is not asked to compare
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
    it("GH-1102: create and join carry each seat's Store specials, cleaned against the shipped table; a forged id never reaches the room", async () => {
      const { env, createBodies, joinBodies } = fakeRooms();
      const res = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p1', build: 'b1', mode: 'versus', map: 'tel_marum', kit: 'brigade', specials: ['mbt_lavi_camo', 'mbt_lavi_camo_mk9', '__proto__', 'mbt_lavi', 3] }), env, NOW);
      const { code } = (await res.json()) as { code: string };
      expect(createBodies[0].specials).toEqual(['mbt_lavi_camo']);
      await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p2', specials: ['forged_super_tank', 'demo_tzav'] }), env, NOW);
      expect(joinBodies[0].specials).toEqual(['demo_tzav']);
      // Not an array: the empty claim.
      await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p1', build: 'b1', mode: 'versus', map: 'tel_marum', kit: 'brigade', specials: { 0: 'demo_tzav' } }), env, NOW);
      expect(createBodies[1].specials).toEqual([]);
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

  describe('snapshot S3: POST and GET /api/match/:code/snapshot', () => {
    const SNAP = `${ORIGIN}/api/match/ABCDEF/snapshot`;
    const seatTicket = (code: string, o: { role?: 'advisor'; exp?: number } = {}): Promise<string> =>
      signTicket('secret', { matchId: code, seat: 0, player: 'p-host', exp: o.exp ?? NOW + 60_000, ...(o.role === 'advisor' ? { role: 'advisor', scope: 'assist' } : {}) });
    const BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3, 250, 251, 0, 17]);
    const snapReq = (url: string, method: string, auth: string | null, o: { origin?: string | null; tick?: string; body?: Uint8Array<ArrayBuffer> } = {}): Request => {
      const h: Record<string, string> = { 'cf-connecting-ip': '198.51.100.7' };
      if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
      if (auth !== null) h.authorization = auth;
      if (o.tick !== undefined) h['x-snapshot-tick'] = o.tick;
      return new Request(url, { method, headers: h, ...(o.body ? { body: o.body } : {}) });
    };

    it('a POST and a GET reach https://room/snapshot with the method, the Authorization, X-Snapshot-Tick and the bytes intact, and return the room\'s answer', async () => {
      const { env, snapSeen, snapKeys } = fakeRooms();
      const auth = `Bearer ${await seatTicket('ABCDEF')}`;
      const put = await handleMatch(snapReq(SNAP, 'POST', auth, { tick: '1200', body: BYTES }), env, NOW);
      expect(put.status).toBe(201);
      expect(await put.text()).toBe('stored');
      const got = await handleMatch(snapReq(SNAP, 'GET', auth), env, NOW);
      expect(got.status).toBe(200);
      expect(got.headers.get('x-snapshot-tick')).toBe('1200');
      expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([7, 8, 9]);
      expect(snapSeen).toHaveLength(2);
      expect(snapSeen[0]).toEqual({ room: 'ABCDEF', url: 'https://room/snapshot', method: 'POST', authorization: auth, tick: '1200', body: BYTES });
      expect(snapSeen[1]).toEqual({ room: 'ABCDEF', url: 'https://room/snapshot', method: 'GET', authorization: auth, tick: null, body: new Uint8Array(0) });
      expect(snapKeys).toEqual(['198.51.100.7', '198.51.100.7']);   // SNAP_LIMIT counted both, by IP
    });

    it('a missing or foreign Origin is 403 and no stub is called', async () => {
      const { env, calls } = fakeRooms();
      const auth = `Bearer ${await seatTicket('ABCDEF')}`;
      for (const method of ['POST', 'GET']) {
        expect((await handleMatch(snapReq(SNAP, method, auth, { origin: null, tick: '1200', ...(method === 'POST' ? { body: BYTES } : {}) }), env, NOW)).status).toBe(403);
        expect((await handleMatch(snapReq(SNAP, method, auth, { origin: 'https://evil.example', tick: '1200', ...(method === 'POST' ? { body: BYTES } : {}) }), env, NOW)).status).toBe(403);
      }
      expect(calls).toEqual([]);
    });

    describe('snapshot S4 T6: a same-origin GET carries no Origin', () => {
      /** The request a browser's same-origin `fetch` GET makes: no Origin, `Sec-Fetch-Site: same-origin`, the ticket. */
      const bare = (url: string, method: string, auth: string | null, site: string | null, extra: Record<string, string> = {}, body?: Uint8Array<ArrayBuffer>): Request => {
        const h: Record<string, string> = { 'cf-connecting-ip': '198.51.100.7', ...extra };
        if (site !== null) h['sec-fetch-site'] = site;
        if (auth !== null) h.authorization = auth;
        return new Request(url, { method, headers: h, ...(body ? { body } : {}) });
      };

      it('a GET with no Origin and Sec-Fetch-Site: same-origin reaches the room with the seat ticket, and is rate-limited by IP like any other', async () => {
        const { env, snapSeen, snapKeys } = fakeRooms();
        const auth = `Bearer ${await seatTicket('ABCDEF')}`;
        const res = await handleMatch(bare(SNAP, 'GET', auth, 'same-origin'), env, NOW);
        expect(res.status).toBe(200);
        expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([7, 8, 9]);
        expect(snapSeen).toEqual([{ room: 'ABCDEF', url: 'https://room/snapshot', method: 'GET', authorization: auth, tick: null, body: new Uint8Array(0) }]);
        expect(snapKeys).toEqual(['198.51.100.7']);
        const refusing = { ...env, SNAP_LIMIT: { limit: async () => ({ success: false }) } } as Env;
        expect((await handleMatch(bare(SNAP, 'GET', auth, 'same-origin'), refusing, NOW)).status).toBe(429);
      });

      it('the ticket is still required: none is 401, an advisor, another code\'s or a junk ticket is 403, and no stub is called', async () => {
        const { env, calls } = fakeRooms();
        expect((await handleMatch(bare(SNAP, 'GET', null, 'same-origin'), env, NOW)).status).toBe(401);
        for (const t of [await seatTicket('ABCDEF', { role: 'advisor' }), await seatTicket('ZZZZZZ'), 'not.a.ticket']) {
          expect((await handleMatch(bare(SNAP, 'GET', `Bearer ${t}`, 'same-origin'), env, NOW)).status).toBe(403);
        }
        expect(calls).toEqual([]);
      });

      it('Sec-Fetch-Site same-site, cross-site, none, blank, or absent is still 403 with no stub', async () => {
        const { env, calls } = fakeRooms();
        const auth = `Bearer ${await seatTicket('ABCDEF')}`;
        for (const site of ['same-site', 'cross-site', 'none', '', null]) {
          expect((await handleMatch(bare(SNAP, 'GET', auth, site), env, NOW)).status, String(site)).toBe(403);
        }
        expect(calls).toEqual([]);
      });

      it('only a GET gets the exemption: a POST (with or without a tick and a body), a HEAD, a PUT with no Origin are 403 even with same-origin', async () => {
        const { env, calls } = fakeRooms();
        const auth = `Bearer ${await seatTicket('ABCDEF')}`;
        const body = new Uint8Array([1, 2, 3]);
        expect((await handleMatch(bare(SNAP, 'POST', auth, 'same-origin', { 'x-snapshot-tick': '1200' }, body), env, NOW)).status).toBe(403);
        expect((await handleMatch(bare(SNAP, 'POST', auth, 'same-origin'), env, NOW)).status).toBe(403);
        expect((await handleMatch(bare(SNAP, 'HEAD', auth, 'same-origin'), env, NOW)).status).toBe(403);
        expect((await handleMatch(bare(SNAP, 'PUT', auth, 'same-origin'), env, NOW)).status).toBe(403);
        expect(calls).toEqual([]);
      });

      it('only the snapshot route gets it: /join, /ws, /advisor, create and a longer path are 403 with no Origin', async () => {
        const { env, calls } = fakeRooms();
        const auth = `Bearer ${await seatTicket('ABCDEF')}`;
        for (const path of ['/api/match/ABCDEF/join', '/api/match/ABCDEF/ws', '/api/match/ABCDEF/advisor', '/api/match', '/api/match/ABCDEF/snapshot/x', '/api/match/ABCDEF']) {
          expect((await handleMatch(bare(`${ORIGIN}${path}`, 'GET', auth, 'same-origin', { upgrade: 'websocket' }), env, NOW)).status, path).toBe(403);
        }
        expect(calls).toEqual([]);
      });

      it('path tricks with no Origin: a trailing slash, a wrong case and an encoded letter are 403 with no stub; a query string IS the snapshot route and reaches it', async () => {
        const { env, calls } = fakeRooms();
        const auth = `Bearer ${await seatTicket('ABCDEF')}`;
        for (const path of ['/api/match/ABCDEF/snapshot/', '/api/match/ABCDEF/Snapshot', '/api/match/ABCDEF/SNAPSHOT', '/api/match/ABCDEF/%73napshot', '/api/match/ABCDEF/snapshot%2F', '/API/match/ABCDEF/snapshot']) {
          expect((await handleMatch(bare(`${ORIGIN}${path}`, 'GET', auth, 'same-origin'), env, NOW)).status, path).toBe(403);
        }
        expect(calls).toEqual([]);
        // the query string is not part of the pathname the exemption and the router both read
        expect((await handleMatch(bare(`${SNAP}?x=/join`, 'GET', auth, 'same-origin'), env, NOW)).status).toBe(200);
        expect(calls).toEqual(['/snapshot']);
      });

      it('a PRESENT Origin is judged as before even beside same-origin: a foreign one, and the literal "null", are 403', async () => {
        const { env, calls } = fakeRooms();
        const auth = `Bearer ${await seatTicket('ABCDEF')}`;
        for (const origin of ['https://evil.example', 'null']) {
          expect((await handleMatch(bare(SNAP, 'GET', auth, 'same-origin', { origin }), env, NOW)).status, origin).toBe(403);
        }
        // and the listed Origin is still accepted with or without the header
        expect((await handleMatch(bare(SNAP, 'GET', auth, 'cross-site', { origin: ORIGIN }), env, NOW)).status).toBe(200);
        expect(calls).toEqual(['/snapshot']);
      });
    });

    it('a limited IP is 429 and no stub is called; ROOM_LIMIT is not the limiter that counts', async () => {
      const { env, calls } = fakeRooms();
      const auth = `Bearer ${await seatTicket('ABCDEF')}`;
      const refusing = { ...env, SNAP_LIMIT: { limit: async () => ({ success: false }) } } as Env;
      expect((await handleMatch(snapReq(SNAP, 'POST', auth, { tick: '1200', body: BYTES }), refusing, NOW)).status).toBe(429);
      expect((await handleMatch(snapReq(SNAP, 'GET', auth), refusing, NOW)).status).toBe(429);
      // the limiter runs before the ticket: a limited IP with no or junk credentials is 429, not 401/403
      expect((await handleMatch(snapReq(SNAP, 'GET', null), refusing, NOW)).status).toBe(429);
      expect((await handleMatch(snapReq(SNAP, 'GET', 'Bearer junk'), refusing, NOW)).status).toBe(429);
      const roomRefusing = { ...env, ROOM_LIMIT: { limit: async () => ({ success: false }) } } as Env;
      expect((await handleMatch(snapReq(SNAP, 'GET', auth), roomRefusing, NOW)).status).toBe(200);
      expect(calls).toEqual(['/snapshot']);   // only the ROOM_LIMIT-refusing GET got through
    });

    it('a ticket in the query string only is 401, and no stub is called', async () => {
      const { env, calls } = fakeRooms();
      const ticket = await seatTicket('ABCDEF');
      for (const method of ['POST', 'GET']) {
        const res = await handleMatch(snapReq(`${SNAP}?ticket=${ticket}`, method, null, { tick: '1200', ...(method === 'POST' ? { body: BYTES } : {}) }), env, NOW);
        expect(res.status).toBe(401);
      }
      expect((await handleMatch(snapReq(SNAP, 'GET', ticket), env, NOW)).status).toBe(401);   // not Bearer-prefixed
      expect(calls).toEqual([]);
    });

    it('the scheme is `Bearer` and one space, exactly: a valid seat ticket under `bearer` or `BEARER` is 401 and under two spaces is 403, and no stub is called', async () => {
      const { env, calls } = fakeRooms();
      const t = await seatTicket('ABCDEF');
      for (const method of ['POST', 'GET']) {
        const extra = { tick: '1200', ...(method === 'POST' ? { body: BYTES } : {}) };
        for (const scheme of ['bearer', 'BEARER']) expect((await handleMatch(snapReq(SNAP, method, `${scheme} ${t}`, extra), env, NOW)).status, `${method} ${scheme}`).toBe(401);
        expect((await handleMatch(snapReq(SNAP, method, `Bearer  ${t}`, extra), env, NOW)).status, `${method} two spaces`).toBe(403);
      }
      expect(calls).toEqual([]);
    });

    it('an advisor ticket, another code\'s ticket, an expired one and junk are 403, and no stub is called', async () => {
      const { env, calls } = fakeRooms();
      const bad = [
        `Bearer ${await seatTicket('ABCDEF', { role: 'advisor' })}`,
        `Bearer ${await seatTicket('ZZZZZZ')}`,
        `Bearer ${await seatTicket('ABCDEF', { exp: NOW })}`,
        'Bearer not.a.ticket',
      ];
      for (const auth of bad) {
        for (const method of ['POST', 'GET']) {
          expect((await handleMatch(snapReq(SNAP, method, auth, { tick: '1200', ...(method === 'POST' ? { body: BYTES } : {}) }), env, NOW)).status, `${method} ${auth.slice(0, 16)}`).toBe(403);
        }
      }
      expect(calls).toEqual([]);
    });

    it('a lower-case code reaches the same room, and the room is asked for the upper-case name', async () => {
      const { env, snapSeen } = fakeRooms();
      const auth = `Bearer ${await seatTicket('ABCDEF')}`;
      const res = await handleMatch(snapReq(`${ORIGIN}/api/match/abcdef/snapshot`, 'GET', auth), env, NOW);
      expect(res.status).toBe(200);
      expect(snapSeen.map((x) => x.room)).toEqual(['ABCDEF']);
    });

    it('PUT, DELETE and HEAD are 405, and no stub is called', async () => {
      const { env, calls } = fakeRooms();
      const auth = `Bearer ${await seatTicket('ABCDEF')}`;
      for (const method of ['PUT', 'DELETE', 'HEAD']) expect((await handleMatch(snapReq(SNAP, method, auth), env, NOW)).status, method).toBe(405);
      expect(calls).toEqual([]);
    });

    it('a malformed code is 400 before a room is touched', async () => {
      const { env, calls } = fakeRooms();
      expect((await handleMatch(snapReq(`${ORIGIN}/api/match/abc/snapshot`, 'GET', `Bearer ${await seatTicket('abc')}`), env, NOW)).status).toBe(400);
      expect(calls).toEqual([]);
    });
  });
});

/** GH-954 W1: the spectator's ticket exists only where the local relay put ARENA_WATCH, and only for bot matches. */
describe('POST /api/match/:code/watch (GH-954 W1)', () => {
  const botRoom = async (env: Env, joinKind = 'bot'): Promise<{ code: string; seat0: string; seat1: string }> => {
    const created = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-a', callsign: 'A', build: 'b1', mode: 'versus', map: 'tel_marum', kind: 'bot' }), env, NOW);
    const { code, ticket: seat0 } = (await created.json()) as { code: string; ticket: string };
    const joined = await handleMatch(post(`${ORIGIN}/api/match/${code}/join`, { player: 'p-b', callsign: 'B', kind: joinKind }), env, NOW);
    const { ticket: seat1 } = (await joined.json()) as { ticket: string };
    return { code, seat0, seat1 };
  };
  const watchEnv = (): ReturnType<typeof fakeRooms> => {
    const f = fakeRooms();
    f.env.ARENA_WATCH = '1';
    return f;
  };

  it('mints a watch ticket from a seat ticket of a bot match: seat 0, player watch, the seat ticket\'s expiry, role watch', async () => {
    const { env } = watchEnv();
    const { code, seat1 } = await botRoom(env);
    const res = await handleMatch(post(`${ORIGIN}/api/match/${code}/watch`, { ticket: seat1 }), env, NOW);
    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as { ticket: string };
    expect(await verifyTicket('secret', ticket, NOW)).toEqual({ matchId: code, seat: 0, player: 'watch', exp: NOW + 6 * 3600 * 1000, role: 'watch' });
  });

  it('is 404 without ARENA_WATCH, whatever is sent, and never reaches a room', async () => {
    const { env, calls } = fakeRooms();
    const { code, seat0 } = await botRoom(env);
    const before = calls.length;
    expect(env.ARENA_WATCH).toBeUndefined();
    for (const flag of [undefined, '', '0', 'true', 'yes']) {
      env.ARENA_WATCH = flag;
      const res = await handleMatch(post(`${ORIGIN}/api/match/${code}/watch`, { ticket: seat0 }), env, NOW);
      expect(res.status, String(flag)).toBe(404);
    }
    expect((await handleMatch(new Request(`${ORIGIN}/api/match/${code}/watch`, { method: 'GET', headers: { origin: ORIGIN } }), env, NOW)).status).toBe(404);
    expect(calls.length).toBe(before);
  });

  it('is 403 when either seat is a human: a lobby with one seat, a human host, a human guest', async () => {
    const { env } = watchEnv();
    const humanGuest = await botRoom(env, 'human');
    expect((await handleMatch(post(`${ORIGIN}/api/match/${humanGuest.code}/watch`, { ticket: humanGuest.seat0 }), env, NOW)).status).toBe(403);
    const created = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-a', callsign: 'A', build: 'b1', mode: 'versus', map: 'tel_marum', kind: 'bot' }), env, NOW);
    const lone = (await created.json()) as { code: string; ticket: string };
    expect((await handleMatch(post(`${ORIGIN}/api/match/${lone.code}/watch`, { ticket: lone.ticket }), env, NOW)).status).toBe(403);
    const humanHost = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p-a', callsign: 'A', build: 'b1', mode: 'versus', map: 'tel_marum' }), env, NOW);
    const h = (await humanHost.json()) as { code: string; ticket: string };
    await handleMatch(post(`${ORIGIN}/api/match/${h.code}/join`, { player: 'p-b', callsign: 'B', kind: 'bot' }), env, NOW);
    expect((await handleMatch(post(`${ORIGIN}/api/match/${h.code}/watch`, { ticket: h.ticket }), env, NOW)).status).toBe(403);
  });

  it('wants a seat ticket for this code: a watch or advisor ticket, another code\'s, an expired one and junk are 403', async () => {
    const { env } = watchEnv();
    const { code, seat0 } = await botRoom(env);
    const other = await botRoom(env);
    const mint = (o: object) => signTicket('secret', { matchId: code, seat: 0, player: 'x', exp: NOW + 60_000, ...o });
    const bad = [await mint({ role: 'watch' }), await mint({ role: 'advisor', scope: 'assist' }), await mint({ exp: NOW - 1 }), other.seat0, 'not.a.ticket', ''];
    for (const t of bad) expect((await handleMatch(post(`${ORIGIN}/api/match/${code}/watch`, { ticket: t }), env, NOW)).status).toBe(403);
    expect((await handleMatch(post(`${ORIGIN}/api/match/${code}/watch`, {}), env, NOW)).status).toBe(403);
    expect((await handleMatch(post(`${ORIGIN}/api/match/${code}/watch`, { ticket: seat0 }), env, NOW)).status).toBe(200);
  });

  it('keeps the Origin rule and the method rule, and a code with no room is 404', async () => {
    const { env } = watchEnv();
    const { code, seat0 } = await botRoom(env);
    expect((await handleMatch(post(`${ORIGIN}/api/match/${code}/watch`, { ticket: seat0 }, 'https://evil.example'), env, NOW)).status).toBe(403);
    expect((await handleMatch(new Request(`${ORIGIN}/api/match/${code}/watch`, { method: 'GET', headers: { origin: ORIGIN } }), env, NOW)).status).toBe(405);
    const gone = await signTicket('secret', { matchId: 'ZZZZZZ', seat: 0, player: 'x', exp: NOW + 60_000 });
    expect((await handleMatch(post(`${ORIGIN}/api/match/ZZZZZZ/watch`, { ticket: gone }), env, NOW)).status).toBe(404);
  });
});

describe('a seat\'s member comes from the cookie (GH-1075 A3 Task 3.3)', () => {
  const MS_DAY = 86_400_000;
  /** A members database with A and B (B's session is never sent), and the rooms env bound to it. */
  async function world(opts: { bind?: boolean; aAt?: number } = {}) {
    const db: D1Like = openTestD1({ dir: ACCOUNTS_MIGRATIONS });
    const a = await seedWalletMember(db, 'idA', opts.aAt ?? NOW);
    const b = await seedWalletMember(db, 'idB', NOW);
    const rooms = fakeRooms();
    const env = (opts.bind === false ? rooms.env : { ...rooms.env, ACCOUNTS: db }) as Env;
    return { ...rooms, env, a, b };
  }
  const withCookie = (url: string, body: unknown, cookie?: string) =>
    new Request(url, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...(cookie === undefined ? {} : { cookie }) }, body: JSON.stringify(body) });
  /** The forged body: names B three ways. */
  const forged = (b: { memberId: string }, extra: Record<string, unknown> = {}) => ({ player: 'PUB-idB', callsign: 'X', build: 'b1', member: 'PUB-idB', memberId: b.memberId, ...extra });
  type Seen = { member: { publicId: string } | null; [k: string]: unknown };
  /** What the room request holds besides the anonymous `player` id, which legitimately echoes the body. */
  const outsidePlayer = (o: Record<string, unknown>): string => JSON.stringify({ ...o, player: undefined });

  it('the_member_is_the_cookie', async () => {
    const w = await world();
    // 1. no cookie, a body naming B: a guest
    expect((await handleMatch(withCookie(`${ORIGIN}/api/match`, forged(w.b)), w.env, NOW)).status).toBe(201);
    expect((w.createBodies[0] as Seen).member).toBeNull();
    // 2. A's cookie: A, and B appears nowhere beside `player`
    expect((await handleMatch(withCookie(`${ORIGIN}/api/match`, forged(w.b), w.a.cookie), w.env, NOW)).status).toBe(201);
    const c = w.createBodies[1] as Seen;
    expect(c.member?.publicId).toBe('PUB-idA');
    expect(outsidePlayer(c)).not.toContain('idB');
    expect(outsidePlayer(c)).not.toContain('PUB-idB');
    // 3. the same two cases for a join
    const code = w.created[0];
    expect((await handleMatch(withCookie(`${ORIGIN}/api/match/${code}/join`, forged(w.b)), w.env, NOW)).status).toBe(200);
    expect((w.joinBodies[0] as Seen).member).toBeNull();
    const code2 = w.created[1];
    expect((await handleMatch(withCookie(`${ORIGIN}/api/match/${code2}/join`, forged(w.b), w.a.cookie), w.env, NOW)).status).toBe(200);
    const j = w.joinBodies[1] as Seen;
    expect(j.member?.publicId).toBe('PUB-idA');
    expect(outsidePlayer(j)).not.toContain('idB');
    expect(outsidePlayer(j)).not.toContain('PUB-idB');
  });

  it('unbound_accounts_seat_guests', async () => {
    const w = await world({ bind: false });
    const res = await handleMatch(withCookie(`${ORIGIN}/api/match`, forged(w.b), w.a.cookie), w.env, NOW);
    expect(res.status).toBe(201);
    expect((w.createBodies[0] as Seen).member).toBeNull();
  });

  it('an_expired_session_is_a_guest', async () => {
    // 181 days back: past the 180-day absolute cap
    const w = await world({ aAt: NOW - 181 * MS_DAY });
    const res = await handleMatch(withCookie(`${ORIGIN}/api/match`, forged(w.b), w.a.cookie), w.env, NOW);
    expect(res.status).toBe(201);
    expect((w.createBodies[0] as Seen).member).toBeNull();
    // 31 days back: inside the absolute cap, past the 30-day IDLE expiry: a guest, through `expires_at` alone
    const idle = await world({ aAt: NOW - 31 * MS_DAY });
    expect((await handleMatch(withCookie(`${ORIGIN}/api/match`, forged(idle.b), idle.a.cookie), idle.env, NOW)).status).toBe(201);
    expect((idle.createBodies[0] as Seen).member).toBeNull();
    // 29 days back: still a member (the control: the same world, two days younger)
    const live = await world({ aAt: NOW - 29 * MS_DAY });
    expect((await handleMatch(withCookie(`${ORIGIN}/api/match`, forged(live.b), live.a.cookie), live.env, NOW)).status).toBe(201);
    expect((live.createBodies[0] as Seen).member?.publicId).toBe('PUB-idA');
  });

  it('a_failing_accounts_database_seats_a_guest', async () => {
    const w = await world();
    const broken = { prepare: () => { throw new Error('D1 down'); }, batch: () => Promise.reject(new Error('D1 down')) } as unknown as D1Like;
    const env = { ...w.env, ACCOUNTS: broken } as Env;
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const created = await handleMatch(withCookie(`${ORIGIN}/api/match`, forged(w.b), w.a.cookie), env, NOW);
      expect(created.status).toBe(201);
      expect((w.createBodies[0] as Seen).member).toBeNull();
      const joined = await handleMatch(withCookie(`${ORIGIN}/api/match/${w.created[0]}/join`, forged(w.b), w.a.cookie), env, NOW);
      expect(joined.status).toBe(200);
      expect((w.joinBodies[0] as Seen).member).toBeNull();
      expect(err).toHaveBeenCalledTimes(2);
    } finally {
      err.mockRestore();
    }
  });

  it('the_answer_names_no_member', async () => {
    const w = await world();
    const res = await handleMatch(withCookie(`${ORIGIN}/api/match`, { player: 'p-host', callsign: 'A', build: 'b1' }, w.a.cookie), w.env, NOW);
    const text = await res.text();
    const { ticket } = JSON.parse(text) as { ticket: string };
    const payload = Buffer.from(ticket.split('.')[0], 'base64url').toString();
    for (const hay of [text, payload]) {
      expect(hay).not.toContain('PUB-idA');
      expect(hay).not.toContain('idA');
    }
    expect((w.createBodies[0] as Seen).member?.publicId).toBe('PUB-idA');
  });

  it('the_bot_model_reaches_the_room_for_a_bot_only', async () => {
    const w = await world();
    const model = { id: 'other', name: 'MyNet v3' };
    await handleMatch(withCookie(`${ORIGIN}/api/match`, { player: 'h', build: 'b1' }), w.env, NOW);
    const room = (n: number) => w.created[n];
    const join = (n: number, body: Record<string, unknown>, cookie?: string) =>
      handleMatch(withCookie(`${ORIGIN}/api/match/${room(n)}/join`, { player: 'bot1', build: 'b1', botModel: model, ...body }, cookie), w.env, NOW);
    expect((await join(0, { kind: 'bot' })).status).toBe(200);
    expect(w.joinBodies[0].botModel).toEqual(model);
    // a human seat drops it
    await handleMatch(withCookie(`${ORIGIN}/api/match`, { player: 'h', build: 'b1' }), w.env, NOW);
    expect((await join(1, {})).status).toBe(200);
    expect('botModel' in w.joinBodies[1]).toBe(false);
    // a member seat (the cookie) drops it, whatever kind it claims
    await handleMatch(withCookie(`${ORIGIN}/api/match`, { player: 'h', build: 'b1' }), w.env, NOW);
    expect((await join(2, { kind: 'bot' }, w.a.cookie)).status).toBe(200);
    expect('botModel' in w.joinBodies[2]).toBe(false);
    // the same on create: a bot host keeps it, a human host and a member host drop it
    const mk = (body: Record<string, unknown>, cookie?: string) => handleMatch(withCookie(`${ORIGIN}/api/match`, { player: 'h', build: 'b1', botModel: model, ...body }, cookie), w.env, NOW);
    await mk({ kind: 'bot' });
    await mk({});
    await mk({ kind: 'bot' }, w.a.cookie);
    const cb = w.createBodies.slice(-3);
    expect(cb[0].botModel).toEqual(model);
    expect('botModel' in cb[1]).toBe(false);
    expect('botModel' in cb[2]).toBe(false);
    // `other` with no name is refused before any room is reached
    const before = w.calls.length;
    const bad = await handleMatch(withCookie(`${ORIGIN}/api/match`, { player: 'b', build: 'b1', kind: 'bot', botModel: { id: 'other' } }), w.env, NOW);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe('botModel');
    expect(w.calls.length).toBe(before);
  });
});
