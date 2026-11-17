/** Profile routes (GH-1075 A1): `me` and `PATCH profile`. */
import { isAvatarPreset, resolveAvatar, type AvatarView } from '@lions/data/avatar';
import { cleanCallsign } from '@lions/net';
import { accountJson, readAccountBody } from './http';
import { budgetedOp } from './budget';
import { validOpId } from './op';
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

const DAY_MS = 86_400_000;

/** The stored column ('p:<id>' preset, 'u' upload, NULL none) as the view `me` and PATCH answer with. Never null. */
function viewOf(publicId: string, stored: string | null, rev: number | null): AvatarView {
  return resolveAvatar({
    publicId,
    preset: stored !== null && stored.startsWith('p:') ? stored.slice(2) : null,
    uploadRev: stored === 'u' ? (rev ?? 0) : null,
  });
}

export async function me(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const who = await db
    .prepare(
      `SELECT m.public_id AS public_id, m.created_at AS created_at, p.display_name AS display_name, p.show_record AS show_record,
              p.avatar AS avatar, p.avatar_rev AS avatar_rev
       FROM member m LEFT JOIN profile p ON p.member_id = m.id WHERE m.id = ?1`,
    )
    .bind(session.memberId)
    .first<{ public_id: string; created_at: number; display_name: string | null; show_record: number | null; avatar: string | null; avatar_rev: number | null }>();
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
      avatar: viewOf(who.public_id, who.avatar, who.avatar_rev),
      createdDay: Math.floor(who.created_at / DAY_MS),
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
  const body = await readAccountBody<{ op_id?: unknown; displayName?: unknown; showRecord?: unknown; avatar?: unknown }>(ctx.req);
  if (body === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (body === null || typeof body !== 'object' || !validOpId(body.op_id)) return sessionJson(400, { error: 'op_id' }, setCookie);
  let name: string | null = null;
  if (body.displayName !== undefined) {
    name = typeof body.displayName === 'string' ? cleanCallsign(body.displayName) : '';
    const n = [...name].length;
    if (n < NAME_MIN || n > NAME_MAX) return sessionJson(400, { error: 'name' }, setCookie);
  }
  if (body.showRecord !== undefined && typeof body.showRecord !== 'boolean') return sessionJson(400, { error: 'body' }, setCookie);
  // A preset id from the catalogue sets it; null resets to the default; anything else (an unknown id, a number, 'u') is 400.
  if (body.avatar !== undefined && body.avatar !== null && !isAvatarPreset(body.avatar)) return sessionJson(400, { error: 'avatar' }, setCookie);
  if (name === null && body.showRecord === undefined && body.avatar === undefined) return sessionJson(400, { error: 'body' }, setCookie);
  const avatarWanted = body.avatar === undefined ? undefined : body.avatar === null ? null : `p:${body.avatar}`;
  const show = body.showRecord === undefined ? null : body.showRecord ? 1 : 0;
  const out = await budgetedOp(ctx, { memberId: session.memberId, opId: body.op_id, kind: 'profile.patch' }, async () => {
    const cur = await db
      .prepare('SELECT p.display_name AS display_name, p.show_record AS show_record, p.avatar AS avatar, p.avatar_rev AS avatar_rev, m.public_id AS public_id FROM profile p JOIN member m ON m.id = p.member_id WHERE p.member_id = ?1')
      .bind(session.memberId)
      .first<{ display_name: string; show_record: number; avatar: string | null; avatar_rev: number; public_id: string }>();
    const avatar = avatarWanted === undefined ? (cur?.avatar ?? null) : avatarWanted;
    const displayName = name ?? cur?.display_name ?? '';
    const showRecord = (show ?? cur?.show_record ?? 0) === 1;
    return {
      statements: [
        db
          .prepare('UPDATE profile SET display_name = ?2, show_record = ?3, updated_at = ?4, avatar = ?5 WHERE member_id = ?1')
          .bind(session.memberId, displayName, showRecord ? 1 : 0, ctx.now, avatar),
      ],
      status: 200,
      response: { displayName, showRecord, avatar: viewOf(cur?.public_id ?? '', avatar, cur?.avatar_rev ?? 0) },
    };
  });
  return sessionJson(out.status, out.body, setCookie);
}
