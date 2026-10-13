/** `/api/match*` (spec §3.2.1): create, join, and the socket upgrade. Origin
 *  is REQUIRED (the `/api/feedback` rule, `../origin.ts`), on the upgrade too.
 *  ROOM_LIMIT counts create and join only: a client reconnecting once a
 *  second would trip a six-a-minute limit on the upgrade (R20). The upgrade
 *  has its own, WS_LIMIT, at 60 a minute (#559 M-1). */
import type { Env, RateLimiter } from '../d1';
import { originAllowed } from '../origin';
import { signTicket } from './ticket';
import { mintCode, isCode } from './code';
import { DEFAULT_MAP, callsignField, textField } from './room-fields';

const TICKET_MS = 6 * 3600 * 1000;
const CODE_ATTEMPTS = 5;

interface CreateBody { player?: unknown; callsign?: unknown; map?: unknown; build?: unknown; mode?: unknown }

async function readBody(req: Request): Promise<CreateBody> {
  try {
    const v: unknown = await req.json();
    return typeof v === 'object' && v !== null ? (v as CreateBody) : {};
  } catch {
    return {};
  }
}
/** The anonymous player id the ticket carries (network design §4); the
 *  callsign is a label and travels separately. Empty means no id: refused. */
const playerOf = (b: CreateBody): string => textField(b.player, '');

async function limited(req: Request, limiter: RateLimiter | undefined): Promise<boolean> {
  if (!limiter) return false;
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const { success } = await limiter.limit({ key: ip });
  return !success;
}

export async function handleMatch(req: Request, env: Env, now: number): Promise<Response> {
  if (!originAllowed(req, env)) return new Response('origin', { status: 403 });
  const secret = env.TICKET_SECRET;
  const rooms = env.ROOMS;
  if (!secret || !rooms) return new Response('matches are not configured', { status: 503 });
  const m = new URL(req.url).pathname.match(/^\/api\/match(?:\/([^/]+)\/(join|ws))?$/);
  if (!m) return new Response('not found', { status: 404 });
  const [, rawCode, action] = m;
  // Codes are minted upper case; a lower-case one typed into a URL is the same room.
  const code = rawCode?.toUpperCase();

  if (code === undefined) {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    if (await limited(req, env.ROOM_LIMIT)) return new Response('slow down', { status: 429 });
    const body = await readBody(req);
    // The room checks every hello's build against this one; empty would switch that check off.
    const build = textField(body.build, '');
    if (build === '') return new Response('build required', { status: 400 });
    const map = textField(body.map, DEFAULT_MAP);
    const player = playerOf(body);
    if (player === '') return new Response('player required', { status: 400 });
    const mode = body.mode === 'versus' ? 'versus' : 'sandbox';
    const callsign = callsignField(body.callsign);
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const c = mintCode();
      const res = await rooms.get(rooms.idFromName(c)).fetch(new Request('https://room/create', {
        method: 'POST', body: JSON.stringify({ code: c, matchId: c, map, build, mode, player, callsign }),
      }));
      if (res.status === 409) continue;   // that code is taken
      if (!res.ok) return new Response('room', { status: 502 });
      const ticket = await signTicket(secret, { matchId: c, seat: 0, player, exp: now + TICKET_MS });
      return Response.json({ code: c, seat: 0, ticket }, { status: 201 });
    }
    return new Response('no free code', { status: 503 });
  }

  if (!isCode(code)) return new Response('bad code', { status: 400 });
  const stub = rooms.get(rooms.idFromName(code));
  if (action === 'join') {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    if (await limited(req, env.ROOM_LIMIT)) return new Response('slow down', { status: 429 });
    const body = await readBody(req);
    const player = playerOf(body);
    if (player === '') return new Response('player required', { status: 400 });
    const res = await stub.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player, callsign: callsignField(body.callsign) }) }));
    if (res.status !== 200) return new Response('', { status: res.status });
    const { seat } = (await res.json()) as { seat: 0 | 1 };
    const ticket = await signTicket(secret, { matchId: code, seat, player, exp: now + TICKET_MS });
    return Response.json({ code, seat, ticket });
  }
  // action === 'ws': the room answers the upgrade itself; the ticket rides in the first message.
  if (req.method !== 'GET') return new Response('method', { status: 405 });
  // #559 M-1: its own per-IP limit, before any Durable Object is reached.
  if (await limited(req, env.WS_LIMIT)) return new Response('slow down', { status: 429 });
  return stub.fetch(new Request('https://room/ws', req));
}
