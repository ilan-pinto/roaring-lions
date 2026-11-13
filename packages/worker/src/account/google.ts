/** Google sign-in, the start route (GH-1075 G3). OpenID Connect code flow with PKCE; the browser only ever sees Google's consent page. */
import { readCookie } from '../auth';
import type { D1Like } from '../d1';
import { dayOf } from '../rate-day';
import { ACCOUNT_RETURN_PATH, CHALLENGE_MS, SESSION_COOKIE, accountOrigins, preCookieName } from './config';
import { randomB64url, sha256B64url, sha256Hex } from './crypto';
import { createGoogleVerifier, readCappedText, type GoogleVerifier, type JwksStore } from './google-oidc';
import { accountJson, readAccountBody } from './http';
import { newAccountBudget, perMinute, startBudget } from './limits';
import { accountsOpen, createMember, memberForIdentity } from './member';
import type { AccountCtx, AccountDeps } from './routes';
import { createSession, requireSession } from './session';
import type { ReturnCode } from './steam';

/** The only file that names Google's OAuth endpoints (a source test pins it). */
export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

/** The token endpoint (a POST); named here and nowhere else. */
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const JWKS_CACHE_KEY = 'https://www.googleapis.com/oauth2/v3/certs';
const TOKEN_CAP = 16 * 1024;
const C_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const CODE_SHAPE = /^[\x21-\x7e]{1,2048}$/;

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
  const clientId = (ctx.env.GOOGLE_CLIENT_ID ?? '').trim();
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
  headers.append('set-cookie', `${preCookieName(c)}=${pre}; ${preAttrs}; Max-Age=${CHALLENGE_MS / 1000}`);
  if (slide !== null) headers.append('set-cookie', slide);
  return accountJson(200, { url: `${GOOGLE_AUTH}?${q.toString()}` }, headers);
}


// ---------------------------------------------------------------------------------------------------------------------
// GET google/return (GH-1075 G4)

/** The slice of the Workers Cache API the JWKS store uses; structural, because this package carries no workers-types. */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

/** The JWKS in the Cache API: shared by every isolate in the colo, so a cold isolate does not refetch Google's keys.
 *  The entry carries its own expiry, because `match` does not report how much life a cached response has left. */
export function cacheJwksStore(cache: CacheLike, clock: () => number = Date.now): JwksStore {
  return {
    async get() {
      const hit = await cache.match(JWKS_CACHE_KEY);
      if (hit === undefined) return null;
      const until = Number(hit.headers.get('x-rl-expires'));
      const ttlMs = until - clock();
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) return null;
      const text = await readCappedText(hit, 64 * 1024);
      return text === null ? null : { text, ttlMs };
    },
    async put(text, ttlMs) {
      const headers = { 'content-type': 'application/json', 'cache-control': `max-age=${Math.floor(ttlMs / 1000)}`, 'x-rl-expires': String(clock() + ttlMs) };
      await cache.put(JWKS_CACHE_KEY, new Response(text, { headers }));
    },
  };
}

let verifierFor: { clientId: string; fetch: AccountDeps['fetch']; verifier: GoogleVerifier } | null = null;

/** ONE verifier per isolate (its JWKS cache and refetch throttle live inside it). Rebuilt only when the client id or
 *  the fetch seam changes, which in production is never: `handleAccount`'s default deps is a module constant. */
function verifierOf(clientId: string, fetch: AccountDeps['fetch']): GoogleVerifier {
  if (verifierFor !== null && verifierFor.clientId === clientId && verifierFor.fetch === fetch) return verifierFor.verifier;
  const cache = (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
  const verifier = createGoogleVerifier({ clientId, fetch, ...(cache === undefined ? {} : { store: cacheJwksStore(cache) }) });
  verifierFor = { clientId, fetch, verifier };
  return verifier;
}

/** One diagnostic line per refusal: a status, a Location HOST, an error NAME and a duration. Never a param, code,
 *  token, `sub`, cookie or IP, and never a response body. */
function warnGoogle(f: { status?: number; location?: string; error?: string; ms: number }): void {
  console.warn('account: google exchange failed', f);
}

function hostOf(location: string | null): string | undefined {
  if (location === null) return undefined;
  try {
    return new URL(location, GOOGLE_TOKEN).host;
  } catch {
    return undefined;
  }
}

const preCleared = (c: string): string => `${preCookieName(c)}=; ${preAttrs}; Max-Age=0`;

/** Google's own `error` word, mapped (spec §3.4). */
const errorCode = (error: string): ReturnCode =>
  error === 'access_denied' ? 'cancelled' : error === 'temporarily_unavailable' || error === 'server_error' ? 'google' : 'invalid';

function back(code: ReturnCode, cookies: string[]): Response {
  const h = new Headers({ location: `${ACCOUNT_RETURN_PATH}&r=${code}&p=google`, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 303, headers: h });
}

interface Challenge {
  purpose: GooglePurpose;
  member_id: string | null;
  pre_hash: string | null;
}

/** GET google/return: the second account GET that writes. Every outcome is a 303 with no body that clears THIS
 *  challenge's pre cookie. Purpose and member come from the consumed challenge row, never from the query or a session. */
export async function googleReturn(ctx: AccountCtx): Promise<Response> {
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const url = new URL(ctx.req.url);
  const c = url.searchParams.get('state') ?? '';
  const shaped = C_SHAPE.test(c); // checked before the cookie name is derived from it
  const clears = shaped ? [preCleared(c)] : [];
  const done = (code: ReturnCode, extra: string[] = []): Response => back(code, [...clears, ...extra]);
  if (!shaped) return done('expired');
  try {
    if (await perMinute(ctx.req, ctx.env.ACCOUNT_LIMIT)) return done('limit');
    const ch = await db
      .prepare(
        `DELETE FROM auth_challenge WHERE challenge_hash = ?1 AND expires_at > ?2 AND purpose IN ('google-login','google-link')
         RETURNING purpose, member_id, pre_hash`,
      )
      .bind(await sha256Hex(c), ctx.now)
      .first<Challenge>();
    if (ch === null) return done('expired');
    return await finishReturn(ctx, db, url, c, ch, done);
  } catch (err) {
    // Ruling 12: a top-level navigation never gets a bare error page. Only the error NAME is logged.
    console.warn('account: google return failed', { error: err instanceof Error ? err.name : typeof err });
    return done('google');
  }
}

async function finishReturn(
  ctx: AccountCtx,
  db: D1Like,
  url: URL,
  c: string,
  ch: Challenge,
  done: (code: ReturnCode, extra?: string[]) => Response,
): Promise<Response> {
  // The browser binding first: a return that is not the browser that started it is refused before Google is asked anything.
  const pre = readCookie(ctx.req, preCookieName(c));
  if (pre === null || pre === '') return done('nocookie');
  if ((await sha256Hex(pre)) !== ch.pre_hash) return done('invalid');
  const error = url.searchParams.get('error');
  if (error !== null) return done(errorCode(error));
  const code = url.searchParams.get('code') ?? '';
  if (!CODE_SHAPE.test(code)) return done('invalid');
  // redirect_uri is rebuilt from this URL's own origin, and only an allowed origin may be sent to Google.
  if (!accountOrigins(ctx.env).includes(url.origin)) return done('invalid');
  const clientId = (ctx.env.GOOGLE_CLIENT_ID ?? '').trim();
  const secret = ctx.env.GOOGLE_CLIENT_SECRET ?? '';
  if (clientId === '' || secret === '') return done('google'); // an old tab after the secrets went: no fetch
  const idToken = await exchange(ctx.deps.fetch, { clientId, secret, code, verifier: pre, redirectUri: `${url.origin}/api/account/google/return` });
  if (idToken === null) return done('google');
  const verdict = await verifierOf(clientId, ctx.deps.fetch).verify(idToken, { nonce: await googleNonce(pre) });
  if ('refused' in verdict) return done(verdict.refused);
  const sub = verdict.sub;
  const existing = await memberForIdentity(db, 'google', sub, ctx.now, ch.purpose === 'google-login');
  // The device's previous session, if the browser sent one (it is SameSite=Strict, so usually not): dropped when it
  // belongs to a DIFFERENT member (decision S1). Never read for a link: the link rests on the row's member_id.
  const previous = readCookie(ctx.req, SESSION_COOKIE);

  if (ch.purpose === 'google-login') {
    if (existing !== null) return done('ok', [await newSession(db, existing, ctx.now, previous)]);
    if (!(await accountsOpen(db))) return done('closed');
    if (!(await newAccountBudget(db, ctx.env, ctx.req, ctx.now))) return done('limit');
    const made = await createMember(db, ctx.now, { provider: 'google', subject: sub });
    await dropPrevious(db, previous, made.memberId);
    return done('ok', [made.setCookie]);
  }

  const memberId = ch.member_id;
  if (memberId === null) return done('invalid');
  const exists = await db.prepare('SELECT 1 AS one FROM member WHERE id = ?1').bind(memberId).first<{ one: number }>();
  if (exists === null) return done('invalid'); // the member went mid-flow: no orphan identity
  if (existing !== null) return done(existing === memberId ? 'linked' : 'taken');
  const other = await db.prepare(`SELECT id FROM member_identity WHERE member_id = ?1 AND provider = 'google'`).bind(memberId).first<{ id: string }>();
  if (other !== null) return done('already');
  try {
    await db
      .prepare(`INSERT INTO member_identity (id, member_id, provider, subject, state, created_at, last_used_day) VALUES (?1, ?2, 'google', ?3, 'active', ?4, ?5)`)
      .bind(randomB64url(16), memberId, sub, ctx.now, dayOf(ctx.now))
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(err instanceof Error ? err.message : String(err))) {
      // A race lost: either another member took the sub, or this member just got a Google identity.
      const winner = await memberForIdentity(db, 'google', sub, ctx.now, false);
      return done(winner === null ? 'already' : winner === memberId ? 'linked' : 'taken');
    }
    throw err;
  }
  return done('linked');
}

/** A NEW session for the member (never an extension of an old one), and the previous device session of another member gone, in one batch. */
async function newSession(db: D1Like, memberId: string, now: number, previous: string | null): Promise<string> {
  const s = await createSession(db, memberId, now);
  const drop = previous === null || previous === '' ? [] : [await dropStatement(db, previous, memberId)];
  await db.batch([...s.statements, ...drop]);
  return s.setCookie;
}

async function dropStatement(db: D1Like, previous: string, memberId: string) {
  return db.prepare('DELETE FROM session WHERE token_hash = ?1 AND member_id <> ?2').bind(await sha256Hex(previous), memberId);
}

async function dropPrevious(db: D1Like, previous: string | null, memberId: string): Promise<void> {
  if (previous === null || previous === '') return;
  await (await dropStatement(db, previous, memberId)).run();
}

/** The code for an ID token: `client_secret_post`, 8 s, no redirects, only a 200, body capped. null on any failure. */
async function exchange(
  fetch: AccountDeps['fetch'],
  p: { clientId: string; secret: string; code: string; verifier: string; redirectUri: string },
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    client_id: p.clientId,
    client_secret: p.secret,
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
  });
  const t0 = Date.now();
  try {
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'roaring-lions-worker', accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
    });
    if (res.status !== 200) {
      warnGoogle({ status: res.status, location: hostOf(res.headers.get('location')), ms: Date.now() - t0 });
      return null;
    }
    const text = await readCappedText(res, TOKEN_CAP);
    if (text === null) {
      warnGoogle({ error: 'too_large', ms: Date.now() - t0 });
      return null;
    }
    const json: unknown = JSON.parse(text);
    const token = (json as { id_token?: unknown } | null)?.id_token;
    if (typeof token !== 'string' || token === '') {
      warnGoogle({ error: 'no_id_token', ms: Date.now() - t0 });
      return null;
    }
    return token;
  } catch (err) {
    warnGoogle({ error: err instanceof Error ? err.name : typeof err, ms: Date.now() - t0 });
    return null;
  }
}
