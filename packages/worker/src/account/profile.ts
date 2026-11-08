/** Profile routes (GH-1075 A1): `me` and `PATCH profile`. */
import { cleanCallsign } from '@lions/net';
import { accountJson, readAccountBody } from './http';
import { opBudget } from './limits';
import { OpIdError, validOpId, withOp } from './op';
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

const NAME_MIN = 3;
const NAME_MAX = 20;

export async function patchProfile(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const body = await readAccountBody<{ op_id?: unknown; displayName?: unknown; showRecord?: unknown }>(ctx.req);
  if (body === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (body === null || typeof body !== 'object' || !validOpId(body.op_id)) return sessionJson(400, { error: 'op_id' }, setCookie);
  let name: string | null = null;
  if (body.displayName !== undefined) {
    name = typeof body.displayName === 'string' ? cleanCallsign(body.displayName) : '';
    const n = [...name].length;
    if (n < NAME_MIN || n > NAME_MAX) return sessionJson(400, { error: 'name' }, setCookie);
  }
  if (body.showRecord !== undefined && typeof body.showRecord !== 'boolean') return sessionJson(400, { error: 'body' }, setCookie);
  if (name === null && body.showRecord === undefined) return sessionJson(400, { error: 'body' }, setCookie);
  const show = body.showRecord === undefined ? null : body.showRecord ? 1 : 0;
  if (!(await opBudget(db, session.memberId, ctx.now))) return sessionJson(429, { error: 'limit' }, setCookie);
  try {
    const out = await withOp(db, session.memberId, body.op_id, 'profile.patch', ctx.now, async () => {
      const cur = await db
        .prepare('SELECT display_name, show_record FROM profile WHERE member_id = ?1')
        .bind(session.memberId)
        .first<{ display_name: string; show_record: number }>();
      const displayName = name ?? cur?.display_name ?? '';
      const showRecord = (show ?? cur?.show_record ?? 0) === 1;
      return {
        statements: [
          db
            .prepare('UPDATE profile SET display_name = ?2, show_record = ?3, updated_at = ?4 WHERE member_id = ?1')
            .bind(session.memberId, displayName, showRecord ? 1 : 0, ctx.now),
        ],
        response: { displayName, showRecord },
      };
    });
    return sessionJson(200, out, setCookie);
  } catch (err) {
    if (err instanceof OpIdError) return sessionJson(400, { error: 'op_id' }, setCookie);
    throw err;
  }
}
