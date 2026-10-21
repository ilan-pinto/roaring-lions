/** `/api/match*` (spec §3.2.1): create, join, the advisor ticket, and the socket upgrade. Origin
 *  is REQUIRED (the `/api/feedback` rule, `../origin.ts`), on the upgrade too.
 *  ROOM_LIMIT counts create, join and the advisor ticket only: a client reconnecting once a
 *  second would trip a six-a-minute limit on the upgrade (R20). The upgrade
 *  has its own, WS_LIMIT, at 60 a minute (#559 M-1). */
import type { Env, RateLimiter } from '../d1';
import { originAllowed } from '../origin';
import { readCapped } from '../read-capped';
import { signTicket, verifyTicket } from './ticket';
import { mintCode, isCode } from './code';
import { ADVISOR_SCOPES, matchupAllowed, matchupField, versusMapAllowed, type AdvisorScope } from '@lions/net';
import { callsignField, kitField, mapField, paceField, seatKindField, seatTiersField, textField } from './room-fields';

/** A size bound on the request bodies of create, join and the advisor ticket (hardening). */
// largest legitimate body measured 1698 bytes (full brigade claim, 21 Oct: + heli_yanshuf, GH-698); cap ≈ 2×
export const MATCH_BODY_MAX_BYTES = 3584;
const TICKET_MS = 6 * 3600 * 1000;
const CODE_ATTEMPTS = 5;

interface CreateBody { player?: unknown; callsign?: unknown; map?: unknown; build?: unknown; mode?: unknown; matchup?: unknown; kind?: unknown; pace?: unknown; kit?: unknown; tiers?: unknown; ticket?: unknown; scope?: unknown }

/** The JSON body, `{}` when it is unreadable, or null when it is over `MATCH_BODY_MAX_BYTES`
 *  (the caller answers 413). An oversize body is refused before it is read or parsed: a
 *  declared length over the cap at once, and an undeclared or understated one after at
 *  most cap + 1 bytes (`readCapped`). */
async function readBody(req: Request): Promise<CreateBody | null> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > MATCH_BODY_MAX_BYTES) return null;
  const raw = await readCapped(req, MATCH_BODY_MAX_BYTES);
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(raw));
    return typeof v === 'object' && v !== null ? (v as CreateBody) : {};
  } catch {
    return {};
  }
}
const tooLarge = (): Response => new Response('too large', { status: 413 });
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
  const m = new URL(req.url).pathname.match(/^\/api\/match(?:\/([^/]+)\/(join|ws|advisor))?$/);
  if (!m) return new Response('not found', { status: 404 });
  const [, rawCode, action] = m;
  // Codes are minted upper case; a lower-case one typed into a URL is the same room.
  const code = rawCode?.toUpperCase();

  if (code === undefined) {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    if (await limited(req, env.ROOM_LIMIT)) return new Response('slow down', { status: 429 });
    const body = await readBody(req);
    if (body === null) return tooLarge();
    // The room checks every hello's build against this one; empty would switch that check off.
    const build = textField(body.build, '');
    if (build === '') return new Response('build required', { status: 400 });
    const map = mapField(body.map);
    if (map === null) return new Response('unknown map', { status: 400 });
    const player = playerOf(body);
    if (player === '') return new Response('player required', { status: 400 });
    const mode = body.mode === 'versus' ? 'versus' : 'sandbox';
    // A versus room is offered only on the maps measured fair (#561, the lead, 2026-10-14);
    // the room checks it again. A sandbox room is no contest and is not limited.
    if (mode === 'versus' && !versusMapAllowed(map)) return new Response('map not offered for versus', { status: 400 });
    // KDF vs Sarim plays only on FACTION_MATCHUP_MAPS (the lead, 2026-10-14); a sandbox room ignores the matchup.
    const matchup = matchupField(body.matchup);
    if (mode === 'versus' && !matchupAllowed(matchup, map)) return new Response('matchup not offered on this map', { status: 400 });
    const callsign = callsignField(body.callsign);
    // N4a: the host's seat kind and the pace, cleaned and clamped (D5) here and again by the room.
    const kind = seatKindField(body.kind);
    const pace = paceField(body.pace);
    // Per-seat kit: the room's kit rule (a sandbox room is always matched) and the host's
    // claim, cleaned against the shipped tracks here and again by the room (decision 22).
    const kit = mode === 'versus' ? kitField(body.kit) : 'matched';
    const tiers = seatTiersField(body.tiers);
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const c = mintCode();
      const res = await rooms.get(rooms.idFromName(c)).fetch(new Request('https://room/create', {
        method: 'POST', body: JSON.stringify({ code: c, matchId: c, map, build, mode, player, callsign, matchup, kind, pace, kit, tiers }),
      }));
      if (res.status === 409) continue;   // that code is taken
      if (!res.ok) return new Response('room', { status: 502 });
      const ticket = await signTicket(secret, { matchId: c, seat: 0, player, exp: now + TICKET_MS });
      return Response.json({ code: c, seat: 0, ticket }, { status: 201 });
    }
    return new Response('no free code', { status: 503 });
  }

  if (!isCode(code)) return new Response('bad code', { status: 400 });
  if (action === 'advisor') return advisorTicket(req, env, secret, code, now);
  const stub = rooms.get(rooms.idFromName(code));
  if (action === 'join') {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    if (await limited(req, env.ROOM_LIMIT)) return new Response('slow down', { status: 429 });
    const body = await readBody(req);
    if (body === null) return tooLarge();
    const player = playerOf(body);
    if (player === '') return new Response('player required', { status: 400 });
    const res = await stub.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player, callsign: callsignField(body.callsign), kind: seatKindField(body.kind), tiers: seatTiersField(body.tiers) }) }));
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

/**
 * `POST /api/match/:code/advisor` (N4a, decision D1): a seat invites its OWN
 * advisor by trading its seat ticket for an advisor ticket on the same seat,
 * expiring when the seat ticket does. Only a seat ticket for this code is
 * accepted, so an advisor ticket can never mint another. The room is not
 * asked and nothing is written: the ticket is the whole grant, and the room
 * checks it at the advisor's hello like any other.
 */
async function advisorTicket(req: Request, env: Env, secret: string, code: string, now: number): Promise<Response> {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  if (await limited(req, env.ROOM_LIMIT)) return new Response('slow down', { status: 429 });
  const body = await readBody(req);
  if (body === null) return tooLarge();
  if (!(ADVISOR_SCOPES as readonly unknown[]).includes(body.scope)) return new Response('bad scope', { status: 400 });
  const scope = body.scope as AdvisorScope;
  const seat = typeof body.ticket === 'string' ? await verifyTicket(secret, body.ticket, now) : null;
  if (seat === null || seat.role !== 'seat' || seat.matchId !== code) return new Response('bad ticket', { status: 403 });
  const ticket = await signTicket(secret, { matchId: code, seat: seat.seat, player: 'advisor', exp: seat.exp, role: 'advisor', scope });
  return Response.json({ ticket });
}
