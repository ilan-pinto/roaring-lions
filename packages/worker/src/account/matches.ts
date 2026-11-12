/** GET matches: the signed-in member's versus history (GH-1075 A3 Task 3.6). The member is the cookie's, never a
 *  parameter, so no query can reach another member's seats. */
import { decodeBotModel } from '@lions/net';
import type { MatchOpponent, MatchView, MatchesView } from '@lions/economy';
import { MATCHES_PAGE_DEFAULT, MATCHES_PAGE_MAX } from './config';
import { accountJson } from './http';
import type { AccountCtx } from './routes';
import { memberRecord } from './seat-member';
import { requireSession, sessionJson } from './session';

interface Row {
  code: string;
  started_at: number;
  ended_at: number;
  map: string;
  matchup: string;
  win_mode: string | null;
  kit: string;
  reason: string;
  winner_seat: number | null;
  ticks: number;
  agreed: number;
  seat: number;
  side: string;
  o_kind: string | null;
  o_member: string | null;
  o_label: string | null;
  o_public_id: string | null;
  o_name: string | null;
}

const INT = /^-?\d{1,15}$/;
/** The page cursor: `<started_at>.<code>`, the pair the query orders by, so matches that share a start time are
 *  neither skipped nor repeated across a page edge. */
const CURSOR = /^(\d{1,15})\.(.{1,64})$/s;

function opponentOf(r: Row): MatchOpponent {
  if (r.o_kind === 'member' && r.o_member !== null && r.o_public_id !== null) {
    return { kind: 'member', name: r.o_name ?? '', publicId: r.o_public_id };
  }
  if (r.o_kind === 'guest') return { kind: 'guest' };
  if (r.o_kind === 'bot') return { kind: 'bot', model: decodeBotModel(r.o_label) };
  return { kind: 'deleted' };
}

export async function matches(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const q = new URL(ctx.req.url).searchParams;
  const beforeRaw = q.get('before');
  const limitRaw = q.get('limit');
  const cursor = beforeRaw === null ? null : CURSOR.exec(beforeRaw);
  if (beforeRaw !== null && cursor === null) return sessionJson(400, { error: 'query' }, setCookie);
  if (limitRaw !== null && !INT.test(limitRaw)) return sessionJson(400, { error: 'query' }, setCookie);
  const limit = limitRaw === null ? MATCHES_PAGE_DEFAULT : Number(limitRaw);
  if (limit < 1 || limit > MATCHES_PAGE_MAX) return sessionJson(400, { error: 'query' }, setCookie);
  const beforeAt = cursor === null ? Number.MAX_SAFE_INTEGER : Number(cursor[1]);
  const beforeCode = cursor === null ? '' : (cursor[2] ?? '');
  const rows = await db
    .prepare(
      `SELECT r.code AS code, r.started_at AS started_at, r.ended_at AS ended_at, r.map AS map, r.matchup AS matchup,
         r.win_mode AS win_mode, r.kit AS kit, r.reason AS reason, r.winner_seat AS winner_seat, r.ticks AS ticks,
         r.agreed AS agreed, s.seat AS seat, s.side AS side,
         o.kind AS o_kind, o.member_id AS o_member, o.bot_label AS o_label,
         om.public_id AS o_public_id, op.display_name AS o_name
       FROM match_seat s
       JOIN match_record r ON r.code = s.code AND r.started_at = s.started_at
       LEFT JOIN match_seat o ON o.code = s.code AND o.started_at = s.started_at AND o.seat = 1 - s.seat
       LEFT JOIN member om ON om.id = o.member_id
       LEFT JOIN profile op ON op.member_id = o.member_id
       WHERE s.member_id = ?1 AND (s.started_at < ?2 OR (s.started_at = ?2 AND s.code < ?3))
       ORDER BY s.started_at DESC, s.code DESC
       LIMIT ?4`,
    )
    .bind(session.memberId, beforeAt, beforeCode, limit)
    .all<Row>();
  const list: MatchView[] = rows.results.map((r) => ({
    code: r.code,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    map: r.map,
    matchup: r.matchup,
    winMode: r.win_mode,
    kit: r.kit,
    reason: r.reason,
    winnerSeat: r.winner_seat === 0 ? 0 : r.winner_seat === 1 ? 1 : null,
    ticks: r.ticks,
    agreed: r.agreed === 1,
    seat: r.seat === 1 ? 1 : 0,
    side: r.side,
    opponent: opponentOf(r),
  }));
  const last = list[list.length - 1];
  const body: MatchesView = {
    matches: list,
    next: list.length === limit && last !== undefined ? `${last.startedAt}.${last.code}` : null,
    record: await memberRecord(db, session.memberId),
  };
  return sessionJson(200, body, setCookie);
}
