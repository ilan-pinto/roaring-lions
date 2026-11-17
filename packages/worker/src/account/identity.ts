/** Identity routes (GH-1075 A1). */
import { accountJson, readAccountBody } from './http';
import { budgetedOp } from './budget';
import { OpReject, validOpId } from './op';
import type { AccountCtx } from './routes';
import { requireSession, sessionJson } from './session';
import type { D1Like } from '../d1';

/** The providers that count as a way in (a recovery code counts only while ACTIVE). Both SQL strings below interpolate it. */
export const SIGN_IN_PROVIDERS = ['passkey', 'steam', 'google'] as const;
const SIGN_IN_LIST = SIGN_IN_PROVIDERS.map((p) => `'${p}'`).join(', ');

/** Ways a member can still sign in: a passkey, a SteamID, a Google account, or an ACTIVE recovery code. A pending code does not count. */
export async function canSignInCount(db: D1Like, memberId: string, excludingId?: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM member_identity
       WHERE member_id = ?1 AND (?2 IS NULL OR id <> ?2)
         AND (provider IN (${SIGN_IN_LIST}) OR (provider = 'recovery' AND state = 'active'))`,
    )
    .bind(memberId, excludingId ?? null)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function deleteIdentity(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx, { fresh: true });
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const body = await readAccountBody<{ op_id?: unknown }>(ctx.req);
  if (body === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (body === null || !validOpId(body.op_id)) return sessionJson(400, { error: 'op_id' }, setCookie);
  const id = ctx.params.id ?? '';
  const out = await budgetedOp(ctx, { memberId: session.memberId, opId: body.op_id, kind: 'identity.delete' }, async () => {
    const own = await db
      .prepare('SELECT id FROM member_identity WHERE id = ?1 AND member_id = ?2')
      .bind(id, session.memberId)
      .first<{ id: string }>();
    if (own === null) throw new OpReject(404, { error: 'not_found' });
    if ((await canSignInCount(db, session.memberId, id)) === 0) throw new OpReject(409, { error: 'last_identity' });
    return {
      // The guard is in the statement too, so two deletes racing for the last two ways in cannot both land.
      statements: [
        db
          .prepare(
            `DELETE FROM member_identity WHERE id = ?1 AND member_id = ?2 AND (
               SELECT COUNT(*) FROM member_identity WHERE member_id = ?2 AND id <> ?1
                 AND (provider IN (${SIGN_IN_LIST}) OR (provider = 'recovery' AND state = 'active'))) > 0`,
          )
          .bind(id, session.memberId),
      ],
      status: 200,
      response: { ok: true },
    };
  });
  return sessionJson(out.status, out.body, setCookie);
}
