/** Steam OpenID 2.0 sign-in and linking (GH-1075 A1). Only the OpenID endpoint is ever called: no profile API. */
import { readCookie } from '../auth';
import type { D1Like } from '../d1';
import { ACCOUNT_RETURN_PATH, CHALLENGE_MS, STEAM_OP, accountOrigins, preCookieName } from './config';
import { randomB64url, sha256Hex } from './crypto';
import { accountJson, readAccountBody } from './http';
import { newAccountBudget, perMinute } from './limits';
import { accountsOpen, createMember, memberForIdentity, sessionFor } from './member';
import type { AccountCtx, AccountDeps } from './routes';
import { dayOf } from '../rate-day';
import { requireSession } from './session';

export type SteamPurpose = 'steam-login' | 'steam-link';
export type ReturnCode = 'ok' | 'linked' | 'cancelled' | 'expired' | 'nocookie' | 'invalid' | 'steam' | 'closed' | 'limit' | 'taken';

const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const SIGNED_REQUIRED = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'];
const OPENID_KEYS = [
  'openid.ns', 'openid.mode', 'openid.op_endpoint', 'openid.claimed_id', 'openid.identity',
  'openid.return_to', 'openid.response_nonce', 'openid.assoc_handle', 'openid.signed', 'openid.sig',
];
const SIGNED_ALLOWED = ['signed', 'ns', 'mode', ...SIGNED_REQUIRED];
const C_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const preAttrs = 'Secure; HttpOnly; SameSite=Lax; Path=/';
const preCookie = (c: string, value: string, maxAge: number): string => `${preCookieName(c)}=${value}; ${preAttrs}; Max-Age=${maxAge}`;

/** Steam's own word for the response is checked, never trusted: five-and-more checks, then the server round trip. */
export async function verifyOpenId(
  params: URLSearchParams,
  expect: { returnTo: string },
  fetch: AccountDeps['fetch'],
): Promise<{ steamId: string } | { refused: 'invalid' | 'steam' }> {
  const invalid = { refused: 'invalid' } as const;
  // Only these openid.* keys exist, each once, exactly spelled: a smuggled key (NUL suffix, other case,
  // a repeat) could make Steam's parser read a value the checks below never saw.
  const seen = new Set<string>();
  for (const k of params.keys()) {
    if (!k.toLowerCase().startsWith('openid')) continue;
    if (!OPENID_KEYS.includes(k) || seen.has(k)) return invalid;
    seen.add(k);
  }
  if (params.get('openid.mode') !== 'id_res') return invalid;
  if (params.get('openid.op_endpoint') !== STEAM_OP) return invalid;
  if (params.get('openid.return_to') !== expect.returnTo) return invalid;
  const claimed = params.get('openid.claimed_id') ?? '';
  const match = CLAIMED.exec(claimed);
  if (match === null) return invalid;
  if (params.get('openid.identity') !== claimed) return invalid;
  const signed = (params.get('openid.signed') ?? '').split(',');
  if (!SIGNED_REQUIRED.every((f) => signed.includes(f))) return invalid;
  if (!signed.every((f) => SIGNED_ALLOWED.includes(f))) return invalid;
  // The check body is built from the very values read above, never forwarded wholesale.
  const body = new URLSearchParams();
  for (const k of OPENID_KEYS) {
    const v = params.get(k);
    if (v !== null && k !== 'openid.mode') body.set(k, v);
  }
  body.set('openid.mode', 'check_authentication');
  let text: string;
  try {
    const res = await fetch(STEAM_OP, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 200) return { refused: 'steam' };
    text = await res.text();
  } catch {
    return { refused: 'steam' };
  }
  if (!text.split('\n').some((line) => line.trim() === 'is_valid:true')) return invalid;
  return { steamId: match[1] ?? '' };
}

/** POST steam/start. */
export async function steamStart(ctx: AccountCtx): Promise<Response> {
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const origin = new URL(ctx.req.url).origin;
  if (!accountOrigins(ctx.env).includes(origin)) return accountJson(403, { error: 'forbidden' });
  if (await perMinute(ctx.req, ctx.env.ACCOUNT_LIMIT)) return accountJson(429, { error: 'limit' });
  const body = await readAccountBody<{ purpose?: unknown }>(ctx.req);
  const purpose = body !== null && body !== 'too_large' ? body.purpose : undefined;
  if (purpose !== 'steam-login' && purpose !== 'steam-link') return accountJson(400, { error: 'bad_request' });
  let memberId: string | null = null;
  let slide: string | null = null;
  if (purpose === 'steam-link') {
    const got = await requireSession(ctx, { fresh: true });
    if (got instanceof Response) return got;
    memberId = got.session.memberId;
    slide = got.setCookie;
  }
  const c = randomB64url(32);
  const pre = randomB64url(32);
  await db
    .prepare('INSERT INTO auth_challenge (challenge_hash, purpose, member_id, pre_hash, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(await sha256Hex(c), purpose, memberId, await sha256Hex(pre), ctx.now + CHALLENGE_MS)
    .run();
  const q = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${origin}/api/account/steam/return?c=${c}`,
    'openid.realm': origin,
    'openid.identity': SELECT,
    'openid.claimed_id': SELECT,
  });
  const headers = new Headers();
  headers.append('set-cookie', preCookie(c, pre, 300));
  if (slide !== null) headers.append('set-cookie', slide);
  return accountJson(200, { url: `${STEAM_OP}?${q.toString()}` }, headers);
}

function back(code: ReturnCode, cookies: string[]): Response {
  const h = new Headers({ location: `${ACCOUNT_RETURN_PATH}&r=${code}`, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 303, headers: h });
}

/** GET steam/return: the one account GET that writes. Every outcome is a 303 that clears this challenge's pre cookie. */
export async function steamReturn(ctx: AccountCtx): Promise<Response> {
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const url = new URL(ctx.req.url);
  const c = url.searchParams.get('c') ?? '';
  const clears = C_SHAPE.test(c) ? [preCookie(c, '', 0)] : [];
  const done = (code: ReturnCode, extra: string[] = []): Response => back(code, [...clears, ...extra]);
  if (clears.length === 0) return done('expired');
  try {
    if (await perMinute(ctx.req, ctx.env.ACCOUNT_LIMIT)) return done('limit');
    const ch = await db
      .prepare(
        `DELETE FROM auth_challenge WHERE challenge_hash = ?1 AND expires_at > ?2 AND purpose IN ('steam-login','steam-link')
         RETURNING purpose, member_id, pre_hash`,
      )
      .bind(await sha256Hex(c), ctx.now)
      .first<{ purpose: SteamPurpose; member_id: string | null; pre_hash: string | null }>();
    if (ch === null) return done('expired');
    return await finishReturn(ctx, db, url, c, ch, done);
  } catch {
    // Ruling 12: a top-level navigation never gets a bare error page. No SteamID is logged.
    return done('steam');
  }
}

async function finishReturn(
  ctx: AccountCtx,
  db: D1Like,
  url: URL,
  c: string,
  ch: { purpose: SteamPurpose; member_id: string | null; pre_hash: string | null },
  done: (code: ReturnCode, extra?: string[]) => Response,
): Promise<Response> {
  if (url.searchParams.get('openid.mode') === 'cancel') return done('cancelled');
  const pre = readCookie(ctx.req, preCookieName(c));
  if (pre === null || pre === '') return done('nocookie');
  if ((await sha256Hex(pre)) !== ch.pre_hash) return done('invalid');
  const verdict = await verifyOpenId(url.searchParams, { returnTo: `${url.origin}/api/account/steam/return?c=${c}` }, ctx.deps.fetch);
  if ('refused' in verdict) return done(verdict.refused);
  const steamId = verdict.steamId;
  const existing = await memberForIdentity(db, 'steam', steamId, ctx.now, ch.purpose === 'steam-login');

  if (ch.purpose === 'steam-login') {
    if (existing !== null) return done('ok', [await sessionFor(db, existing, ctx.now)]);
    if (!(await accountsOpen(db))) return done('closed');
    if (!(await newAccountBudget(db, ctx.env, ctx.req, ctx.now))) return done('limit');
    const made = await createMember(db, ctx.now, { provider: 'steam', subject: steamId });
    return done('ok', [made.setCookie]);
  }

  const memberId = ch.member_id;
  if (memberId === null) return done('invalid');
  if (existing !== null) return done(existing === memberId ? 'linked' : 'taken');
  const other = await db
    .prepare(`SELECT subject FROM member_identity WHERE member_id = ?1 AND provider = 'steam'`)
    .bind(memberId)
    .first<{ subject: string }>();
  if (other !== null) return done('taken');
  try {
    await db
      .prepare(`INSERT INTO member_identity (id, member_id, provider, subject, state, created_at, last_used_day) VALUES (?1, ?2, 'steam', ?3, 'active', ?4, ?5)`)
      .bind(randomB64url(16), memberId, steamId, ctx.now, dayOf(ctx.now))
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(err instanceof Error ? err.message : String(err))) return done('taken');
    throw err;
  }
  return done('linked');
}

