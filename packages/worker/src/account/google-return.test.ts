import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, preCookieName } from './config';
import { cacheJwksStore, googleNonce, type CacheLike } from './google';
import { createGoogleVerifier } from './google-oidc';
import { handleAccount } from './routes';
import { createSession } from './session';
import { accountHarness } from './test-kit';

// GH-1075 G4. Google is a stub that implements the parts the Worker relies on: the JWKS, and a token endpoint that
// checks the client secret, the redirect URI and PKCE, mints a single-use code, and signs ID tokens with a key made here.
const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';
const CLIENT = 'test-client.apps.googleusercontent.com';
const SECRET = 'SECRET-SENTINEL-client-secret';
const SUB_A = '110169484474386276334';
const SUB_B = '110169484474386276335';
const ACCESS = 'ACCESS-SENTINEL-token';
const b64u = (buf: Buffer): string => buf.toString('base64url');
const sha = (s: string): Buffer => createHash('sha256').update(s).digest();
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } as const;

let priv: CryptoKey;
let pubJwk: JsonWebKey & { kid: string };
beforeAll(async () => {
  const k = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  priv = k.privateKey;
  pubJwk = { ...(await crypto.subtle.exportKey('jwk', k.publicKey)), kid: 'g1', alg: 'RS256', use: 'sig' };
});
afterEach(() => vi.restoreAllMocks());

async function sign(claims: Record<string, unknown>): Promise<string> {
  const h = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'g1', typ: 'JWT' })));
  const p = b64u(Buffer.from(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(Buffer.from(sig))}`;
}

interface Issued { challenge: string; nonce: string; redirectUri: string; sub: string; used: boolean }
interface Call { url: string; method: string; body: string }

function googleStub(opts: { tokenStatus?: number; tokenBody?: string; throwOnToken?: Error } = {}) {
  const calls: Call[] = [];
  const codes = new Map<string, Issued>();
  const idTokens: string[] = [];
  let n = 0;
  const stub = {
    calls,
    idTokens,
    opts,
    jwks: () => calls.filter((c) => c.url.startsWith('https://www.googleapis.com/')),
    tokens: () => calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token'),
    /** What the browser does at Google: the consent screen answers a code bound to the URL's challenge and nonce. */
    authorize(authUrl: string, sub: string, over: Partial<Issued> = {}): string {
      const q = new URL(authUrl).searchParams;
      const code = `CODE-SENTINEL-${++n}-${'x'.repeat(30)}`;
      codes.set(code, { challenge: q.get('code_challenge') ?? '', nonce: q.get('nonce') ?? '', redirectUri: q.get('redirect_uri') ?? '', sub, used: false, ...over });
      return code;
    },
    fetch: async (url: string, init: RequestInit): Promise<Response> => {
      const body = typeof init.body === 'string' ? init.body : '';
      calls.push({ url, method: init.method ?? 'GET', body });
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
        return new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200, headers: { 'cache-control': 'public, max-age=3600' } });
      }
      if (url !== 'https://oauth2.googleapis.com/token') throw new Error('unexpected host ' + url);
      if (opts.throwOnToken !== undefined) throw opts.throwOnToken;
      if (opts.tokenStatus !== undefined) return new Response(opts.tokenBody ?? '{}', { status: opts.tokenStatus, headers: { location: 'https://consent.example/x' } });
      if (opts.tokenBody !== undefined) return new Response(opts.tokenBody, { status: 200 });
      const f = new URLSearchParams(body);
      const bad = (e: string): Response => new Response(JSON.stringify({ error: e }), { status: 400 });
      if (f.get('grant_type') !== 'authorization_code' || f.get('client_id') !== CLIENT || f.get('client_secret') !== SECRET) return bad('invalid_client');
      const issued = codes.get(f.get('code') ?? '');
      if (issued === undefined || issued.used) return bad('invalid_grant');
      issued.used = true;
      if (f.get('redirect_uri') !== issued.redirectUri) return bad('invalid_grant');
      // PKCE: S256 of the verifier must be the challenge the code was issued against.
      if (b64u(sha(f.get('code_verifier') ?? '')) !== issued.challenge) return bad('invalid_grant');
      const now = Math.floor(Date.now() / 1000);
      const id = await sign({ iss: 'https://accounts.google.com', aud: CLIENT, azp: CLIENT, sub: issued.sub, iat: now - 5, exp: now + 3000, nonce: issued.nonce, email: 'leak@example.com', at_hash: 'x' });
      idTokens.push(id);
      return new Response(JSON.stringify({ access_token: ACCESS, id_token: id, token_type: 'Bearer', expires_in: 3599 }), { status: 200 });
    },
  };
  return stub;
}
type Stub = ReturnType<typeof googleStub>;
type H = ReturnType<typeof accountHarness>;

async function harness(o: { stub?: Stub; open?: boolean; secrets?: boolean; foreignKeys?: boolean; denyLimiter?: ('ACCOUNT_LIMIT' | 'ACCOUNT_OP_LIMIT')[] } = {}) {
  const stub = o.stub ?? googleStub();
  const h = accountHarness({ now: T0, deps: { fetch: stub.fetch }, foreignKeys: o.foreignKeys, denyLimiter: o.denyLimiter });
  if (o.secrets !== false) {
    h.env.GOOGLE_CLIENT_ID = CLIENT;
    h.env.GOOGLE_CLIENT_SECRET = SECRET;
  }
  if (o.open !== false) await h.db.prepare(`INSERT INTO flags VALUES ('accounts','open',0)`).run();
  return { h, stub };
}

const count = async (h: H, table: string, where = '1=1'): Promise<number> =>
  (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())?.n ?? -1;
const dump = async (h: H, sql: string): Promise<unknown[]> => (await h.db.prepare(sql).all<unknown>()).results;

async function seedMember(h: H, id: string, google?: string): Promise<void> {
  await h.db.prepare('INSERT INTO member (id, public_id, id_hash, user_handle, created_at, last_seen_day) VALUES (?1, ?2, ?3, ?4, ?5, 0)')
    .bind(id, 'PUB' + id, 'hash' + id, 'uh' + id, T0).run();
  await h.db.prepare('INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES (?1, ?2, 0, ?3)').bind(id, 'Callsign ' + id, T0).run();
  if (google !== undefined) {
    await h.db.prepare(`INSERT INTO member_identity (id, member_id, provider, subject, state, created_at, last_used_day) VALUES (?1, ?2, 'google', ?3, 'active', ?4, 0)`)
      .bind('i' + id, id, google, T0).run();
  }
}
async function sessionOf(h: H, memberId: string): Promise<string> {
  const s = await createSession(h.db, memberId, T0);
  await h.db.batch(s.statements);
  return `${SESSION_COOKIE}=${s.token}`;
}

interface Started { c: string; pre: string; preCookie: string; url: string }
async function start(h: H, purpose: 'google-login' | 'google-link', cookie?: string): Promise<Started> {
  const res = await h.call('POST', '/api/account/google/start', { body: { purpose }, cookie });
  expect(res.status).toBe(200);
  const url = ((await res.json()) as { url: string }).url;
  const c = new URL(url).searchParams.get('state') ?? '';
  const pair = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { c, pre: pair.slice(preCookieName(c).length + 1), preCookie: pair, url };
}

const back = (res: Response): { status: number; code: string | null; p: string | null; location: string } => {
  const location = res.headers.get('location') ?? '';
  const q = new URL(location, ORIGIN).searchParams;
  return { status: res.status, code: q.get('r'), p: q.get('p'), location };
};
const ret = (h: H, q: Record<string, string>, cookies: string[]): Promise<Response> =>
  h.call('GET', `/api/account/google/return?${new URLSearchParams(q).toString()}`, { cookie: cookies.join('; ') });

/** A whole sign-in: start, Google's consent for `sub`, the return. */
async function flow(h: H, stub: Stub, purpose: 'google-login' | 'google-link', sub: string, cookie?: string, returnCookies: string[] = []) {
  const s = await start(h, purpose, cookie);
  const code = stub.authorize(s.url, sub);
  const res = await ret(h, { state: s.c, code }, [s.preCookie, ...returnCookies]);
  return { s, code, res };
}
const sessionCookieOf = (res: Response): string | undefined => res.headers.getSetCookie().find((c) => c.startsWith(SESSION_COOKIE + '='));
const clearsPre = (res: Response, c: string): boolean => res.headers.getSetCookie().includes(`${preCookieName(c)}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);

describe('google/return (G4)', () => {
  it('signs in a new Google user: one member, one session, the exact token request, only Google hosts, pre cookie cleared', async () => {
    const { h, stub } = await harness();
    const { s, code, res } = await flow(h, stub, 'google-login', SUB_A);
    expect(back(res)).toMatchObject({ status: 303, code: 'ok', p: 'google', location: '/profile?accounts&r=ok&p=google' });
    expect(await res.text()).toBe('');
    expect(await count(h, 'member')).toBe(1);
    expect(await dump(h, `SELECT provider, subject, state FROM member_identity`)).toEqual([{ provider: 'google', subject: SUB_A, state: 'active' }]);
    expect(await count(h, 'session')).toBe(1);
    expect(await count(h, 'auth_challenge')).toBe(0);
    expect(sessionCookieOf(res)).toMatch(/^__Host-rl_session=[A-Za-z0-9_-]{43}; Secure; HttpOnly; SameSite=Strict/);
    expect(clearsPre(res, s.c)).toBe(true);
    // The exact token request, and PKCE: the verifier IS the cookie value, and its S256 is the challenge in the URL.
    const t = stub.tokens();
    expect(t).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(t[0]?.body))).toEqual({
      grant_type: 'authorization_code', code, client_id: CLIENT, client_secret: SECRET, redirect_uri: `${ORIGIN}/api/account/google/return`, code_verifier: s.pre,
    });
    expect(b64u(sha(s.pre))).toBe(new URL(s.url).searchParams.get('code_challenge'));
    expect(stub.calls.map((c) => new URL(c.url).host).sort()).toEqual(['oauth2.googleapis.com', 'www.googleapis.com']);
  });

  it('a known Google user gets a NEW session each time, never the one presented, and stays one member', async () => {
    const { h, stub } = await harness();
    const first = await flow(h, stub, 'google-login', SUB_A);
    const old = (sessionCookieOf(first.res) ?? '').split(';')[0] ?? '';
    const second = await flow(h, stub, 'google-login', SUB_A, undefined, [old]);
    expect(back(second.res).code).toBe('ok');
    const fresh = (sessionCookieOf(second.res) ?? '').split(';')[0] ?? '';
    expect(fresh).not.toBe(old);
    expect(await count(h, 'member')).toBe(1);
    expect(await count(h, 'session')).toBe(2); // the same member's earlier session is kept
  });

  it('decision S1: a different member signing in drops the device\'s previous session row; the same member does not', async () => {
    const { h, stub } = await harness();
    await seedMember(h, 'mA', SUB_A);
    await seedMember(h, 'mB', SUB_B);
    const aCookie = await sessionOf(h, 'mA');
    await flow(h, stub, 'google-login', SUB_B, undefined, [aCookie]); // B signs in on A's device
    expect(await count(h, 'session', `member_id = 'mA'`)).toBe(0);
    expect(await count(h, 'session', `member_id = 'mB'`)).toBe(1);
    const bCookie = await sessionOf(h, 'mB');
    await flow(h, stub, 'google-login', SUB_B, undefined, [bCookie]); // B again: the old row stays
    expect(await count(h, 'session', `member_id = 'mB'`)).toBe(3);
  });

  it('a first sign-in on a device with another member\'s session drops that session too', async () => {
    const { h, stub } = await harness();
    await seedMember(h, 'mA', SUB_A);
    const aCookie = await sessionOf(h, 'mA');
    const { res } = await flow(h, stub, 'google-login', SUB_B, undefined, [aCookie]);
    expect(back(res).code).toBe('ok');
    expect(await count(h, 'session', `member_id = 'mA'`)).toBe(0);
    expect(await count(h, 'member')).toBe(2);
  });

  it('closed makes no member; a spent new-account budget answers limit', async () => {
    const closed = await harness({ open: false });
    const a = await flow(closed.h, closed.stub, 'google-login', SUB_A);
    expect(back(a.res).code).toBe('closed');
    expect(await count(closed.h, 'member')).toBe(0);
    expect(await count(closed.h, 'session')).toBe(0);
    const { h, stub } = await harness();
    await h.db.prepare(`INSERT INTO rate_day (scope, key, day, n) VALUES ('acct-new-all', '', ?1, 500)`).bind(Math.floor(T0 / DAY)).run();
    const b = await flow(h, stub, 'google-login', SUB_A);
    expect(back(b.res).code).toBe('limit');
    expect(await count(h, 'member')).toBe(0);
  });

  it('a consumed challenge is expired, and Google is not asked a second time', async () => {
    const { h, stub } = await harness();
    const { s, code } = await flow(h, stub, 'google-login', SUB_A);
    const again = await ret(h, { state: s.c, code }, [s.preCookie]);
    expect(back(again).code).toBe('expired');
    expect(stub.tokens()).toHaveLength(1);
    expect(await count(h, 'member')).toBe(1);
    expect(clearsPre(again, s.c)).toBe(true);
  });

  it('an expired challenge is expired, with zero fetches', async () => {
    const { h, stub } = await harness();
    const s = await start(h, 'google-login');
    await h.db.prepare('UPDATE auth_challenge SET expires_at = ?1').bind(T0 - 1).run();
    const res = await ret(h, { state: s.c, code: stub.authorize(s.url, SUB_A) }, [s.preCookie]);
    expect(back(res).code).toBe('expired');
    expect(stub.calls).toHaveLength(0);
  });

  it('a Steam challenge presented as state misses, and is not consumed', async () => {
    const { h, stub } = await harness();
    const c = 'S'.repeat(43);
    const pre = 'p'.repeat(43);
    const hash = createHash('sha256').update(c).digest('hex');
    await h.db.prepare(`INSERT INTO auth_challenge (challenge_hash, purpose, member_id, pre_hash, expires_at) VALUES (?1, 'steam-login', NULL, ?2, ?3)`)
      .bind(hash, createHash('sha256').update(pre).digest('hex'), T0 + 60_000).run();
    const res = await ret(h, { state: c, code: 'abc' }, [`${preCookieName(c)}=${pre}`]);
    expect(back(res).code).toBe('expired');
    expect(await count(h, 'auth_challenge')).toBe(1);
    expect(stub.calls).toHaveLength(0);
    expect(await count(h, 'member')).toBe(0);
  });

  it('a state without the challenge shape is expired and names no cookie to clear', async () => {
    const { h, stub } = await harness();
    for (const state of ['', 'short', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)};`, `${'x'.repeat(41)}%0d%0a`]) {
      const res = await ret(h, { state, code: 'c' }, []);
      expect(back(res)).toMatchObject({ status: 303, code: 'expired' });
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(stub.calls).toHaveLength(0);
  });

  it('trusts the row, not the query: purpose, member_id and p in the URL change nothing', async () => {
    const { h, stub } = await harness();
    await seedMember(h, 'mV');
    const s = await start(h, 'google-login');
    const code = stub.authorize(s.url, SUB_A);
    const res = await ret(h, { state: s.c, code, purpose: 'google-link', member_id: 'mV', member: 'mV' }, [s.preCookie]);
    expect(back(res).code).toBe('ok');
    expect(await count(h, 'member_identity', `member_id = 'mV'`)).toBe(0);
    expect(await count(h, 'member')).toBe(2);
  });

  it('the pre cookie: missing is nocookie, another challenge\'s is nocookie, a wrong value is invalid; all before any fetch', async () => {
    const { h, stub } = await harness();
    const a = await start(h, 'google-login');
    const b = await start(h, 'google-login');
    const code = stub.authorize(a.url, SUB_A);
    expect(back(await ret(h, { state: a.c, code }, [])).code).toBe('nocookie');
    const s2 = await start(h, 'google-login');
    expect(back(await ret(h, { state: s2.c, code }, [b.preCookie])).code).toBe('nocookie'); // B's cookie under A's name does not exist
    const s3 = await start(h, 'google-login');
    expect(back(await ret(h, { state: s3.c, code }, [`${preCookieName(s3.c)}=${b.pre}`])).code).toBe('invalid'); // right name, wrong value
    const s4 = await start(h, 'google-login');
    const res = await ret(h, { state: s4.c, code }, [`${preCookieName(s4.c)}=`]);
    expect(back(res).code).toBe('nocookie');
    expect(clearsPre(res, s4.c)).toBe(true);
    expect(stub.calls).toHaveLength(0);
    expect(await count(h, 'member')).toBe(0);
  });

  it('error=access_denied is cancelled, other errors map, and none of them reaches Google', async () => {
    const { h, stub } = await harness();
    const want: Record<string, string> = { access_denied: 'cancelled', temporarily_unavailable: 'google', server_error: 'google', invalid_scope: 'invalid', '': 'invalid' };
    for (const [error, code] of Object.entries(want)) {
      const s = await start(h, 'google-login');
      const res = await ret(h, { state: s.c, error, code: stub.authorize(s.url, SUB_A) }, [s.preCookie]);
      expect(back(res).code, error).toBe(code);
      expect(clearsPre(res, s.c)).toBe(true);
    }
    expect(stub.calls).toHaveLength(0);
    expect(await count(h, 'member')).toBe(0);
  });

  it('no code, or a malformed one, is invalid with zero fetches', async () => {
    const { h, stub } = await harness();
    for (const code of [undefined, '', 'has space', 'x'.repeat(2049)]) {
      const s = await start(h, 'google-login');
      const res = await ret(h, code === undefined ? { state: s.c } : { state: s.c, code }, [s.preCookie]);
      expect(back(res).code).toBe('invalid');
    }
    expect(stub.calls).toHaveLength(0);
  });

  it('a token endpoint that answers 403 is google, with one diagnostic line and no member', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { h, stub } = await harness({ stub: googleStub({ tokenStatus: 403, tokenBody: '<html>blocked</html>' }) });
    const { res } = await flow(h, stub, 'google-login', SUB_A);
    expect(back(res).code).toBe('google');
    expect(await count(h, 'member')).toBe(0);
    expect(warn).toHaveBeenCalledWith('account: google exchange failed', { status: 403, location: 'consent.example', ms: expect.any(Number) });
  });

  it('a 3xx, a thrown fetch, a non-JSON 200, a 200 with no id_token, and a body over 16 KiB are all google', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cases: Stub[] = [
      googleStub({ tokenStatus: 302 }),
      googleStub({ throwOnToken: new Error('boom') }),
      googleStub({ tokenBody: 'not json' }),
      googleStub({ tokenBody: JSON.stringify({ access_token: 'a' }) }),
      googleStub({ tokenBody: JSON.stringify({ id_token: 'x'.repeat(17 * 1024) }) }),
    ];
    for (const stub of cases) {
      const { h } = await harness({ stub });
      const { res } = await flow(h, stub, 'google-login', SUB_A);
      expect(back(res).code).toBe('google');
      expect(await count(h, 'member')).toBe(0);
    }
  });

  it('a code from another browser\'s challenge fails PKCE at Google: google, no member, no session', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { h, stub } = await harness();
    const attacker = await start(h, 'google-login');
    const attackerCode = stub.authorize(attacker.url, SUB_A); // bound to the attacker's challenge
    const victim = await start(h, 'google-login');
    const res = await ret(h, { state: victim.c, code: attackerCode }, [victim.preCookie]);
    expect(back(res).code).toBe('google');
    expect(Object.fromEntries(new URLSearchParams(stub.tokens()[0]?.body)).code_verifier).toBe(victim.pre);
    expect(await count(h, 'member')).toBe(0);
    expect(await count(h, 'session')).toBe(0);
  });

  it('an attacker\'s finished return replayed in the victim\'s browser has no pre cookie: nocookie, no fetch', async () => {
    const { h, stub } = await harness();
    const attacker = await start(h, 'google-login');
    const code = stub.authorize(attacker.url, SUB_A);
    const res = await ret(h, { state: attacker.c, code }, []); // the victim's browser holds none of the attacker's cookies
    expect(back(res).code).toBe('nocookie');
    expect(stub.calls).toHaveLength(0);
  });

  it('the nonce is recomputed from the cookie: a token minted for another flow\'s nonce is invalid', async () => {
    const { h, stub } = await harness();
    const s = await start(h, 'google-login');
    const other = await start(h, 'google-login');
    const code = stub.authorize(s.url, SUB_A, { nonce: await googleNonce(other.pre) });
    const res = await ret(h, { state: s.c, code }, [s.preCookie]);
    expect(back(res).code).toBe('invalid');
    expect(await count(h, 'member')).toBe(0);
  });

  it('with the secrets gone (an old tab) the return is google with zero fetches, and the cookie is still cleared', async () => {
    const { h, stub } = await harness();
    const s = await start(h, 'google-login');
    const code = stub.authorize(s.url, SUB_A);
    delete h.env.GOOGLE_CLIENT_SECRET;
    const res = await ret(h, { state: s.c, code }, [s.preCookie]);
    expect(back(res).code).toBe('google');
    expect(clearsPre(res, s.c)).toBe(true);
    expect(stub.calls).toHaveLength(0);
  });

  it('redirect_uri comes from the return URL\'s own origin, and an origin outside accountOrigins never reaches Google', async () => {
    const { h, stub } = await harness();
    const s = await start(h, 'google-login');
    const code = stub.authorize(s.url, SUB_A);
    const q = new URLSearchParams({ state: s.c, code }).toString();
    const evil = new Request(`https://evil.example/api/account/google/return?${q}`, { headers: { cookie: s.preCookie } });
    const res = await handleAccount(evil, h.env, T0, { fetch: stub.fetch });
    expect(back(res).code).toBe('invalid');
    expect(clearsPre(res, s.c)).toBe(true);
    expect(stub.calls).toHaveLength(0);
    // An extra allowed origin is rebuilt as that origin, not the pinned one.
    h.env.ACCOUNT_ORIGINS = 'http://127.0.0.1:8787';
    const s2 = await start(h, 'google-login');
    const local = new Request(`http://127.0.0.1:8787/api/account/google/return?${new URLSearchParams({ state: s2.c, code: stub.authorize(s2.url, SUB_A, { redirectUri: 'http://127.0.0.1:8787/api/account/google/return' }) })}`, { headers: { cookie: s2.preCookie } });
    await handleAccount(local, h.env, T0, { fetch: stub.fetch });
    expect(new URLSearchParams(stub.tokens()[0]?.body).get('redirect_uri')).toBe('http://127.0.0.1:8787/api/account/google/return');
  });

  it('the guard exempts exactly this GET: no x-rl-account header passes here, and still 403s elsewhere', async () => {
    const { h, stub } = await harness();
    const s = await start(h, 'google-login');
    const q = new URLSearchParams({ state: s.c, code: stub.authorize(s.url, SUB_A) }).toString();
    const bare = new Request(`${ORIGIN}/api/account/google/return?${q}`, { headers: { cookie: s.preCookie } });
    expect(back(await handleAccount(bare, h.env, T0, { fetch: stub.fetch })).code).toBe('ok');
    for (const path of ['me', 'google/start', 'google/return/x', 'google/returnx']) {
      const res = await handleAccount(new Request(`${ORIGIN}/api/account/${path}`), h.env, T0, { fetch: stub.fetch });
      expect(res.status, path).toBe(403);
    }
    // A POST to the return path is not exempt.
    const post = await handleAccount(new Request(`${ORIGIN}/api/account/google/return?${q}`, { method: 'POST' }), h.env, T0, { fetch: stub.fetch });
    expect(post.status).toBe(403);
  });

  it('takes ACCOUNT_LIMIT and only that: a denied signed-in limiter changes nothing, a denied sign-in limiter is r=limit', async () => {
    const op = await harness({ denyLimiter: ['ACCOUNT_OP_LIMIT'] });
    expect(back((await flow(op.h, op.stub, 'google-login', SUB_A)).res).code).toBe('ok');
    const lim = await harness({ denyLimiter: ['ACCOUNT_LIMIT'] });
    const s = await start(lim.h, 'google-login').catch(() => null); // start takes ACCOUNT_LIMIT too, so make the challenge first
    expect(s).toBeNull();
    const ok = await harness();
    const made = await start(ok.h, 'google-login');
    const denied = accountHarness({ now: T0, deps: { fetch: ok.stub.fetch }, denyLimiter: ['ACCOUNT_LIMIT'] });
    const res = await ret(denied, { state: made.c, code: 'c' }, [made.preCookie]);
    expect(back(res).code).toBe('limit');
    expect(ok.stub.calls).toHaveLength(0);
  });

  it('a database failure is still a 303 (google), with no session cookie', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { h, stub } = await harness();
    const s = await start(h, 'google-login');
    const code = stub.authorize(s.url, SUB_A);
    const real = h.db.batch.bind(h.db);
    h.db.batch = async () => { throw new Error('d1 down'); };
    const res = await ret(h, { state: s.c, code }, [s.preCookie]);
    h.db.batch = real;
    expect(back(res)).toMatchObject({ status: 303, code: 'google' });
    expect(sessionCookieOf(res)).toBeUndefined();
    expect(clearsPre(res, s.c)).toBe(true);
  });
});

describe('google/return linking (G4)', () => {
  it('a Google-less member links an account: linked; again with the same account is linked and adds no row', async () => {
    const { h, stub } = await harness();
    await seedMember(h, 'm1');
    const cookie = await sessionOf(h, 'm1');
    const a = await flow(h, stub, 'google-link', SUB_A, cookie);
    expect(back(a.res)).toMatchObject({ code: 'linked', p: 'google' });
    expect(sessionCookieOf(a.res)).toBeUndefined(); // a link mints no session
    expect(await dump(h, `SELECT member_id, provider, subject FROM member_identity`)).toEqual([{ member_id: 'm1', provider: 'google', subject: SUB_A }]);
    const b = await flow(h, stub, 'google-link', SUB_A, cookie);
    expect(back(b.res).code).toBe('linked');
    expect(await count(h, 'member_identity')).toBe(1);
  });

  it('taken: another member\'s Google account is not merged, moved or signed into; both members\' rows and the device are unchanged', async () => {
    const { h, stub } = await harness();
    await seedMember(h, 'mA');
    await seedMember(h, 'mB', SUB_B);
    const aCookie = await sessionOf(h, 'mA');
    const before = [await dump(h, 'SELECT * FROM member_identity ORDER BY id'), await dump(h, 'SELECT * FROM session ORDER BY token_hash'), await dump(h, 'SELECT * FROM member ORDER BY id'), await dump(h, 'SELECT * FROM wallet ORDER BY member_id')];
    const { s, res } = await flow(h, stub, 'google-link', SUB_B, aCookie);
    expect(back(res)).toMatchObject({ status: 303, code: 'taken', p: 'google' });
    // The device is still A's: the only cookie is the pre cookie's clearing, and no session row appeared.
    expect(res.headers.getSetCookie()).toEqual([`${preCookieName(s.c)}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`]);
    expect(await count(h, 'session')).toBe(1);
    const after = [await dump(h, 'SELECT * FROM member_identity ORDER BY id'), await dump(h, 'SELECT * FROM session ORDER BY token_hash'), await dump(h, 'SELECT * FROM member ORDER BY id'), await dump(h, 'SELECT * FROM wallet ORDER BY member_id')];
    // last_used_day of B's identity must not be stamped by a link attempt either.
    expect(after).toEqual(before);
  });

  it('already: a member with a different Google account is told so, and nothing changes', async () => {
    const { h, stub } = await harness();
    await seedMember(h, 'm1', SUB_A);
    const cookie = await sessionOf(h, 'm1');
    const before = await dump(h, 'SELECT * FROM member_identity');
    const { res } = await flow(h, stub, 'google-link', SUB_B, cookie);
    expect(back(res).code).toBe('already');
    expect(await dump(h, 'SELECT * FROM member_identity')).toEqual(before);
  });

  it('a link rests on the row\'s member, not on a session at the return: a stranger\'s session cookie changes nothing', async () => {
    const { h, stub } = await harness();
    await seedMember(h, 'mA');
    await seedMember(h, 'mB');
    const aCookie = await sessionOf(h, 'mA');
    const bCookie = await sessionOf(h, 'mB');
    const { res } = await flow(h, stub, 'google-link', SUB_A, aCookie, [bCookie]); // B's session rides the return
    expect(back(res).code).toBe('linked');
    expect(await dump(h, 'SELECT member_id FROM member_identity')).toEqual([{ member_id: 'mA' }]);
    expect(await count(h, 'session')).toBe(2); // and B's session was not touched (S1 is for logins)
    // And with no session cookie at all the link still lands.
    const { res: res2 } = await flow(h, stub, 'google-link', SUB_A, aCookie, []);
    expect(back(res2).code).toBe('linked');
  });

  it('a google-link row with NULL member_id is invalid and links nothing', async () => {
    const { h, stub } = await harness();
    const c = 'L'.repeat(43);
    const pre = 'q'.repeat(43);
    await h.db.prepare(`INSERT INTO auth_challenge (challenge_hash, purpose, member_id, pre_hash, expires_at) VALUES (?1, 'google-link', NULL, ?2, ?3)`)
      .bind(createHash('sha256').update(c).digest('hex'), createHash('sha256').update(pre).digest('hex'), T0 + 60_000).run();
    const res = await ret(h, { state: c, code: stub.authorize(`https://x/?code_challenge=${b64u(sha(pre))}&nonce=${b64u(sha('rl-nonce:' + pre))}&redirect_uri=${ORIGIN}/api/account/google/return`, SUB_A) }, [`${preCookieName(c)}=${pre}`]);
    expect(stub.tokens()).toHaveLength(1); // it got as far as Google, so only the row's NULL member can have refused it
    expect(back(res).code).toBe('invalid');
    expect(await count(h, 'member_identity')).toBe(0);
    expect(await count(h, 'member')).toBe(0);
  });

  it('a member deleted mid-flow is invalid (the challenge has no foreign key and outlives it), with foreign keys on or off, and never leaves an orphan identity', async () => {
    for (const foreignKeys of [true, false]) {
      const { h, stub } = await harness({ foreignKeys });
      await seedMember(h, 'm1');
      const s = await start(h, 'google-link', await sessionOf(h, 'm1'));
      const code = stub.authorize(s.url, SUB_A);
      await h.db.prepare(`DELETE FROM member WHERE id = 'm1'`).run();
      expect(await count(h, 'auth_challenge')).toBe(1);
      expect(back(await ret(h, { state: s.c, code }, [s.preCookie])).code).toBe('invalid');
      expect(await count(h, 'member_identity')).toBe(0);
    }
    // Account deletion clears the member's challenge rows (tables.ts), so that path lands on expired.
    const { h, stub } = await harness();
    await seedMember(h, 'm2');
    const s = await start(h, 'google-link', await sessionOf(h, 'm2'));
    const code = stub.authorize(s.url, SUB_A);
    await h.db.prepare(`DELETE FROM auth_challenge WHERE member_id = 'm2'`).run();
    await h.db.prepare(`DELETE FROM member WHERE id = 'm2'`).run();
    expect(back(await ret(h, { state: s.c, code }, [s.preCookie])).code).toBe('expired');
    expect(await count(h, 'member_identity')).toBe(0);
  });

  it('a lost UNIQUE race: another member took the account between the check and the insert (taken); the member took one itself (linked/already)', async () => {
    const { h, stub } = await harness();
    await seedMember(h, 'mA');
    await seedMember(h, 'mB');
    const cookie = await sessionOf(h, 'mA');
    const realPrepare = h.db.prepare.bind(h.db);
    let armed: (() => Promise<void>) | null = null;
    h.db.prepare = (sql: string) => {
      const stmt = realPrepare(sql);
      if (!/^INSERT INTO member_identity/.test(sql) || armed === null) return stmt;
      const hook = armed;
      armed = null;
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...v: unknown[]) => {
        const bound = bind(...v);
        const run = bound.run.bind(bound);
        bound.run = async () => { await hook(); return run(); };
        return bound;
      };
      return stmt;
    };
    armed = async () => { await realPrepare(`INSERT INTO member_identity (id, member_id, provider, subject, state, created_at, last_used_day) VALUES ('race1', 'mB', 'google', ?1, 'active', 0, 0)`).bind(SUB_A).run(); };
    expect(back((await flow(h, stub, 'google-link', SUB_A, cookie)).res).code).toBe('taken');
    expect(await dump(h, `SELECT member_id FROM member_identity`)).toEqual([{ member_id: 'mB' }]);
    // The same member gets a different Google account in the gap: the one-per-member index refuses, and it is already.
    await h.db.prepare(`DELETE FROM member_identity`).run();
    armed = async () => { await realPrepare(`INSERT INTO member_identity (id, member_id, provider, subject, state, created_at, last_used_day) VALUES ('race2', 'mA', 'google', ?1, 'active', 0, 0)`).bind(SUB_B).run(); };
    expect(back((await flow(h, stub, 'google-link', SUB_A, cookie)).res).code).toBe('already');
    expect(await dump(h, `SELECT subject FROM member_identity`)).toEqual([{ subject: SUB_B }]);
  });
});

describe('google/return logging and lifetime (G4)', () => {
  it('no console line, on any path, holds a code, token, sub, cookie or secret', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const sentinels: string[] = [SECRET, ACCESS, SUB_A, SUB_B, 'CODE-SENTINEL', 'leak@example.com'];
    const bodies = [
      JSON.stringify({ error: 'invalid_grant', error_description: `${SECRET} ${ACCESS} ${SUB_A} CODE-SENTINEL-1 leak@example.com` }),
      JSON.stringify({ access_token: ACCESS, id_token: 'CODE-SENTINEL.not.valid' }),
      JSON.stringify({ access_token: ACCESS }),
    ];
    const runs: Stub[] = [
      googleStub(),
      googleStub({ tokenStatus: 403, tokenBody: bodies[0] }),
      googleStub({ tokenBody: bodies[1] }),
      googleStub({ tokenBody: bodies[2] }),
      googleStub({ throwOnToken: new Error(`${SECRET} ${SUB_A} CODE-SENTINEL ${ACCESS}`) }),
    ];
    const cookies: string[] = [];
    for (const stub of runs) {
      const { h } = await harness({ stub });
      const { s, res } = await flow(h, stub, 'google-login', SUB_A);
      cookies.push(s.pre, s.c, ...(sessionCookieOf(res) ? [(sessionCookieOf(res) ?? '').split(';')[0]?.split('=')[1] ?? ''] : []));
      const bad = await start(h, 'google-login'); // wrong cookie, cancelled, an expired return
      await ret(h, { state: bad.c, code: 'CODE-SENTINEL-z' }, [`${preCookieName(bad.c)}=${s.pre}`]);
      cookies.push(bad.pre);
      const real = h.db.batch.bind(h.db);
      const s3 = await start(h, 'google-login');
      h.db.batch = async () => { throw new Error(`${SUB_A} ${s3.pre} CODE-SENTINEL`); };
      await ret(h, { state: s3.c, code: stub.authorize(s3.url, SUB_A) }, [s3.preCookie]);
      h.db.batch = real;
      cookies.push(s3.pre);
    }
    const logged = JSON.stringify(spies.flatMap((sp) => sp.mock.calls));
    expect(logged).toContain('account: google'); // the capture is live: the diagnostic lines are in it
    for (const needle of [...sentinels, ...cookies]) expect(logged, needle).not.toContain(needle);
  });

  it('one verifier per isolate: two sign-ins fetch the JWKS once', async () => {
    const { h, stub } = await harness();
    await flow(h, stub, 'google-login', SUB_A);
    await flow(h, stub, 'google-login', SUB_B);
    expect(stub.tokens()).toHaveLength(2);
    expect(stub.jwks()).toHaveLength(1);
  });

  it('the JWKS goes to the Cache API when there is one, and a cold isolate reads it from there', async () => {
    const mem = new Map<string, Response>();
    const cache: CacheLike = {
      match: async (k) => mem.get(k)?.clone(),
      put: async (k, r) => { mem.set(k, r.clone()); },
    };
    vi.stubGlobal('caches', { default: cache });
    try {
      const a = await harness();
      await flow(a.h, a.stub, 'google-login', SUB_A);
      expect(a.stub.jwks()).toHaveLength(1);
      expect(mem.size).toBe(1);
      const b = await harness(); // a new stub and fetch: a new verifier, as a new isolate would have
      expect(back((await flow(b.h, b.stub, 'google-login', SUB_B)).res).code).toBe('ok');
      expect(b.stub.jwks()).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the JWKS store (G4)', () => {
  const memCache = (): { cache: CacheLike; mem: Map<string, Response> } => {
    const mem = new Map<string, Response>();
    return { mem, cache: { match: async (k) => mem.get(k)?.clone(), put: async (k, r) => { mem.set(k, r.clone()); } } };
  };
  const verifier = (stub: Stub, store: ReturnType<typeof cacheJwksStore> | undefined, clock: () => number) =>
    createGoogleVerifier({ clientId: CLIENT, fetch: stub.fetch, clock, ...(store === undefined ? {} : { store }) });
  async function token(nonce: string, atMs: number = Date.now()): Promise<string> {
    const now = Math.floor(atMs / 1000);
    return sign({ iss: 'https://accounts.google.com', aud: CLIENT, azp: CLIENT, sub: SUB_A, iat: now, exp: now + 3000, nonce });
  }

  it('a second verifier over the same cache fetches nothing; an expired entry is refetched', async () => {
    const { cache } = memCache();
    let now = Date.now();
    const clock = () => now;
    const s1 = googleStub();
    expect(await verifier(s1, cacheJwksStore(cache, clock), clock).verify(await token('n'), { nonce: 'n' })).toEqual({ sub: SUB_A });
    expect(s1.jwks()).toHaveLength(1);
    const s2 = googleStub();
    expect(await verifier(s2, cacheJwksStore(cache, clock), clock).verify(await token('n'), { nonce: 'n' })).toEqual({ sub: SUB_A });
    expect(s2.jwks()).toHaveLength(0);
    now += 3_601_000; // past the one hour max-age that Google's answer carried
    const s3 = googleStub();
    expect(await verifier(s3, cacheJwksStore(cache, clock), clock).verify(await token('n', now), { nonce: 'n' })).toEqual({ sub: SUB_A });
    expect(s3.jwks()).toHaveLength(1);
  });

  it('a broken or garbage store is a miss, never a failed sign-in; a key-miss refetch never reads the store', async () => {
    const stub = googleStub();
    const broken = { get: async () => { throw new Error('cache down'); }, put: async () => { throw new Error('cache down'); } };
    expect(await createGoogleVerifier({ clientId: CLIENT, fetch: stub.fetch, store: broken }).verify(await token('n'), { nonce: 'n' })).toEqual({ sub: SUB_A });
    const garbage = { get: async () => ({ text: 'not json', ttlMs: 60_000 }), put: async () => undefined };
    const s2 = googleStub();
    expect(await createGoogleVerifier({ clientId: CLIENT, fetch: s2.fetch, store: garbage }).verify(await token('n'), { nonce: 'n' })).toEqual({ sub: SUB_A });
    expect(s2.jwks()).toHaveLength(1);
    // A store that always answers a stale document would pin a rotated-out key set forever if kid misses read it.
    let reads = 0;
    const stale = { get: async () => { reads++; return { text: JSON.stringify({ keys: [] }), ttlMs: 60_000 }; }, put: async () => undefined };
    const s3 = googleStub();
    const v = createGoogleVerifier({ clientId: CLIENT, fetch: s3.fetch, store: stale });
    expect(await v.verify(await token('n'), { nonce: 'n' })).toEqual({ sub: SUB_A }); // empty stale keys -> kid miss -> real fetch
    expect(reads).toBe(1);
  });

  it('the Cache API entry is a JWKS the cache can age out: max-age and its own expiry', async () => {
    const { cache, mem } = memCache();
    const store = cacheJwksStore(cache, () => 1_000_000);
    await store.put('{"keys":[]}', 3_600_000);
    const stored = mem.values().next().value as Response;
    expect(stored.headers.get('cache-control')).toBe('max-age=3600');
    expect(await store.get()).toEqual({ text: '{"keys":[]}', ttlMs: 3_600_000 });
    expect(await cacheJwksStore(cache, () => 1_000_000 + 3_600_001).get()).toBeNull();
  });
});
