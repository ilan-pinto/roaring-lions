/** Profile routes (GH-1075 A1). `me` only so far. */
import { accountJson } from './http';
import type { AccountCtx } from './routes';
import { isFresh, requireSession, sessionJson } from './session';

interface IdentityRow {
  id: string;
  provider: string;
  label: string | null;
  created_at: number;
  last_used_day: number | null;
  subject: string;
}

export async function me(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const who = await db
    .prepare(
      `SELECT m.public_id AS public_id, p.display_name AS display_name, p.show_record AS show_record
       FROM member m LEFT JOIN profile p ON p.member_id = m.id WHERE m.id = ?1`,
    )
    .bind(session.memberId)
    .first<{ public_id: string; display_name: string | null; show_record: number | null }>();
  if (who === null) return accountJson(401, { error: 'signed_out' });
  const ids = await db
    .prepare(
      `SELECT id, provider, label, created_at, last_used_day, subject FROM member_identity
       WHERE member_id = ?1 AND state = 'active' ORDER BY created_at, id`,
    )
    .bind(session.memberId)
    .all<IdentityRow>();
  const identities = ids.results.map((r) => ({
    id: r.id,
    provider: r.provider,
    label: r.label,
    createdAt: r.created_at,
    lastUsedDay: r.last_used_day,
    ...(r.provider === 'steam' ? { steamId: r.subject } : {}),
  }));
  return sessionJson(
    200,
    {
      publicId: who.public_id,
      displayName: who.display_name ?? '',
      showRecord: who.show_record === 1,
      fresh: isFresh(session, ctx.now),
      identities,
    },
    setCookie,
  );
}
