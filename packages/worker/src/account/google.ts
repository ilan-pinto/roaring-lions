/** Google sign-in, the start route (GH-1075 G3). OpenID Connect code flow with PKCE; the browser only ever sees Google's consent page. */
import { CHALLENGE_MS, accountOrigins, preCookieName } from './config';
import { randomB64url, sha256B64url, sha256Hex } from './crypto';
import { accountJson, readAccountBody } from './http';
import { perMinute, startBudget } from './limits';
import type { AccountCtx } from './routes';
import { requireSession } from './session';

/** The only place that names Google's hosts (a source test pins it). */
export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

export type GooglePurpose = 'google-login' | 'google-link';

const preAttrs = 'Secure; HttpOnly; SameSite=Lax; Path=/';

/** The nonce is a second hash of the pre cookie, so the return recomputes it and nothing is stored (spec P2). */
export const googleNonce = (pre: string): Promise<string> => sha256B64url('rl-nonce:' + pre);

/** POST google/start: `{purpose}` in, `{url}` out, and a pre cookie whose value is the PKCE verifier. */
export async function googleStart(ctx: AccountCtx): Promise<Response> {
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const origin = new URL(ctx.req.url).origin;
  if (!accountOrigins(ctx.env).includes(origin)) return accountJson(403, { error: 'forbidden' });
  // Fail closed, before any limiter, session read, row or fetch: a missing secret writes nothing (§5.9).
  const clientId = ctx.env.GOOGLE_CLIENT_ID ?? '';
  if (clientId === '' || (ctx.env.GOOGLE_CLIENT_SECRET ?? '') === '') return accountJson(503, { error: 'provider_off' });
  if (await perMinute(ctx.req, ctx.env.ACCOUNT_LIMIT)) return accountJson(429, { error: 'limit' });
  const body = await readAccountBody<{ purpose?: unknown }>(ctx.req);
  const purpose = body !== null && body !== 'too_large' ? body.purpose : undefined;
  if (purpose !== 'google-login' && purpose !== 'google-link') return accountJson(400, { error: 'bad_request' });
  let memberId: string | null = null;
  let slide: string | null = null;
  if (purpose === 'google-link') {
    const got = await requireSession(ctx, { fresh: true });
    if (got instanceof Response) return got;
    memberId = got.session.memberId;
    slide = got.setCookie;
  }
  if (!(await startBudget(db, ctx.env, ctx.req, ctx.now))) return accountJson(429, { error: 'limit' });
  const c = randomB64url(32);
  const pre = randomB64url(32); // 43 characters: a valid PKCE verifier (RFC 7636)
  await db
    .prepare('INSERT INTO auth_challenge (challenge_hash, purpose, member_id, pre_hash, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(await sha256Hex(c), purpose, memberId, await sha256Hex(pre), ctx.now + CHALLENGE_MS)
    .run();
  // No query on redirect_uri (Google matches it exactly); never access_type, login_hint, include_granted_scopes or a scope beyond openid.
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid',
    redirect_uri: `${origin}/api/account/google/return`,
    state: c,
    code_challenge: await sha256B64url(pre),
    code_challenge_method: 'S256',
    nonce: await googleNonce(pre),
    prompt: 'select_account',
  });
  const headers = new Headers();
  headers.append('set-cookie', `${preCookieName(c)}=${pre}; ${preAttrs}; Max-Age=300`);
  if (slide !== null) headers.append('set-cookie', slide);
  return accountJson(200, { url: `${GOOGLE_AUTH}?${q.toString()}` }, headers);
}
