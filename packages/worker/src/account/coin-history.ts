/** GET coins: the signed-in member's own coin history (GH-1370 C1). The member is the cookie's, never a parameter.
 *  The SELECT names an allow-list of fields and never `detail` itself, so no audit text (`reason`, `before`, `by`,
 *  `receipt`, coupon ids) can reach the answer; it never touches `admin_action` or `member`. Writes nothing. */
import type { CoinRowView, CoinWhat, CoinsView } from '@lions/economy';
import { COINS_NOTE_MAX, COINS_PAGE_DEFAULT, COINS_PAGE_MAX } from './config';
import { accountJson } from './http';
import type { AccountCtx } from './routes';
import { requireSession, sessionJson } from './session';

interface Row {
  id: number;
  at: number;
  kind: string;
  free_delta: number;
  source: unknown;
  mission_id: unknown;
  unit_id: unknown;
  track: unknown;
  tier: unknown;
  note: unknown;
  moved: number;
}

const BEFORE = /^\d{1,15}$/;
const LIMIT = /^\d{1,2}$/;
const ID_MAX = 64;
const TRACK_MAX = 32;

/** A string within `max` characters, else undefined (the row then words generically). */
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
/** An admin's note: text within COINS_NOTE_MAX code points. An over-long one is dropped, not cut. */
const note = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && [...v].length <= COINS_NOTE_MAX ? v : undefined);

function whatOf(r: Row): CoinWhat {
  switch (r.kind) {
    case 'earn': {
      const missionId = str(r.mission_id, ID_MAX);
      return { kind: 'earn', source: str(r.source, ID_MAX) ?? '', ...(missionId === undefined ? {} : { missionId }) };
    }
    case 'backfill':
    case 'claim':
      return { kind: 'move' };
    case 'unit':
      return { kind: 'unit', unitId: str(r.unit_id, ID_MAX) ?? '', moved: r.moved === 1 };
    case 'tier': {
      const tier = typeof r.tier === 'number' && Number.isInteger(r.tier) && r.tier >= 0 && r.tier <= 99 ? r.tier : 0;
      return { kind: 'tier', unitId: str(r.unit_id, ID_MAX) ?? '', track: str(r.track, TRACK_MAX) ?? '', tier, moved: r.moved === 1 };
    }
    case 'coupon':
      return { kind: 'coupon' };
    case 'reset':
      return { kind: 'reset' };
    case 'admin': {
      const n = note(r.note);
      return { kind: 'team', ...(n === undefined ? {} : { note: n }) };
    }
    default:
      return { kind: 'other' };
  }
}

export async function coins(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const q = new URL(ctx.req.url).searchParams;
  const beforeRaw = q.get('before');
  const limitRaw = q.get('limit');
  if (beforeRaw !== null && !BEFORE.test(beforeRaw)) return sessionJson(400, { error: 'query' }, setCookie);
  if (limitRaw !== null && !LIMIT.test(limitRaw)) return sessionJson(400, { error: 'query' }, setCookie);
  const limit = limitRaw === null ? COINS_PAGE_DEFAULT : Number(limitRaw);
  if (limit < 1 || limit > COINS_PAGE_MAX) return sessionJson(400, { error: 'query' }, setCookie);
  const before = beforeRaw === null ? Number.MAX_SAFE_INTEGER : Number(beforeRaw);
  const found = await db
    .prepare(
      `SELECT j.id AS id, j.at AS at, j.kind AS kind, j.free_delta AS free_delta,
         CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.source')    END AS source,
         CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.missionId') END AS mission_id,
         CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.unitId')    END AS unit_id,
         CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.track')     END AS track,
         CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.tier')      END AS tier,
         CASE WHEN json_valid(j.detail) AND j.kind = 'admin' THEN json_extract(j.detail, '$.note') END AS note,
         EXISTS (SELECT 1 FROM coin_journal c
                 WHERE c.member_id = j.member_id AND c.op_id = j.op_id AND c.kind IN ('claim', 'backfill')) AS moved
       FROM coin_journal j
       WHERE j.member_id = ?1 AND j.id < ?2
         AND (j.free_delta != 0 OR j.kind IN ('claim', 'backfill'))
       ORDER BY j.id DESC
       LIMIT ?3`,
    )
    .bind(session.memberId, before, limit + 1)
    .all<Row>();
  const page = found.results.slice(0, limit);
  const last = page[page.length - 1];
  const rows: CoinRowView[] = page.map((r) => ({ at: r.at, delta: r.free_delta, what: whatOf(r) }));
  const body: CoinsView = { rows, next: found.results.length > limit && last !== undefined ? String(last.id) : null };
  return sessionJson(200, body, setCookie);
}
