import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE, preCookieName } from './config';
import { createSession } from './session';
import { handleAccount } from './routes';
import { accountHarness } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';
const b64u = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s: string): Buffer => createHash('sha256').update(s).digest();

type H = ReturnType<typeof accountHarness>;
const count = async (h: H, table: string): Promise<number> =>
  (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? -1;

function harness(secrets = true) {
  const fetched: string[] = [];
  const h = accountHarness({ now: T0, deps: { fetch: async (url) => { fetched.push(url); return new Response('no', { status: 500 }); } } });
  if (secrets) {
    h.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    h.env.GOOGLE_CLIENT_SECRET = 'test-secret-sentinel';
  }
  return { h, fetched };
}
const startLogin = (h: H, extra: Record<string, unknown> = {}, origin?: string | null) =>
  h.call('POST', '/api/account/google/start', { body: { purpose: 'google-login', ...extra }, origin });

async function freshCookie(h: H, id: string): Promise<string> {
  await h.db.prepare('INSERT INTO member (id, public_id, id_hash, user_handle, created_at, last_seen_day) VALUES (?1, ?2, ?3, ?4, ?5, 0)')
    .bind(id, 'PUB' + id, 'hash' + id, 'uh' + id, T0).run();
  const s = await createSession(h.db, id, T0);
  await h.db.batch(s.statements);
  return `${SESSION_COOKIE}=${s.token}`;
}

describe('google/start (G3)', () => {
  it('answers exactly the nine authorization parameters, as literals and derived values', async () => {
    const { h } = harness();
    const res = await startLogin(h);
    expect(res.status).toBe(200);
    const url = new URL(((await res.json()) as { url: string }).url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = Object.fromEntries(url.searchParams);
    const set = res.headers.get('set-cookie') ?? '';
    const c = p.state ?? '';
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const pre = set.split(';')[0]?.slice(preCookieName(c).length + 1) ?? '';
    expect(set.startsWith(preCookieName(c) + '=')).toBe(true);
    expect(pre).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p).toEqual({
      client_id: 'test-client.apps.googleusercontent.com',
      response_type: 'code',
      scope: 'openid',
      redirect_uri: `${ORIGIN}/api/account/google/return`,
      state: c,
      code_challenge: b64u(sha(pre)),
      code_challenge_method: 'S256',
      nonce: b64u(sha('rl-nonce:' + pre)),
      prompt: 'select_account',
    });
    expect(p.scope).toBe('openid');
    expect(p.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/); // b64url, not 64 hex characters
    for (const k of ['access_type', 'login_hint', 'include_granted_scopes']) expect(url.searchParams.has(k)).toBe(false);
    expect(new URL(p.redirect_uri ?? '').search).toBe('');
    expect(set.split('; ').slice(1)).toEqual(['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=300']);
    expect(JSON.stringify([...res.headers])).not.toContain('test-secret-sentinel');
    expect(url.toString()).not.toContain('test-secret-sentinel');
  });

  it('writes one challenge row keyed by the hash of state, with the pre hash and a 5 minute expiry', async () => {
    const { h } = harness();
    const res = await startLogin(h);
    const url = new URL(((await res.json()) as { url: string }).url);
    const c = url.searchParams.get('state') ?? '';
    const pre = (res.headers.get('set-cookie') ?? '').split(';')[0]?.slice(preCookieName(c).length + 1) ?? '';
    const row = await h.db.prepare('SELECT * FROM auth_challenge').first<Record<string, unknown>>();
    expect(row).toEqual({ challenge_hash: sha(c).toString('hex'), purpose: 'google-login', member_id: null, pre_hash: sha(pre).toString('hex'), expires_at: T0 + 300_000 });
  });

  it('with no secrets: 503 provider_off, zero rows, zero fetches, no cookie', async () => {
    for (const set of [{}, { GOOGLE_CLIENT_ID: 'id' }, { GOOGLE_CLIENT_SECRET: 's' }, { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }]) {
      const { h, fetched } = harness(false);
      Object.assign(h.env, set);
      const res = await startLogin(h);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'provider_off' });
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await count(h, 'auth_challenge')).toBe(0);
      expect(await count(h, 'rate_day')).toBe(0);
      expect(fetched).toEqual([]);
    }
  });

  it('google-link from a stale or missing session is refused and writes no challenge', async () => {
    const { h } = harness();
    expect((await h.call('POST', '/api/account/google/start', { body: { purpose: 'google-link' } })).status).toBe(401);
    const cookie = await freshCookie(h, 'm1');
    await h.db.prepare('UPDATE session SET fresh_until = 0').run();
    const res = await h.call('POST', '/api/account/google/start', { body: { purpose: 'google-link' }, cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'reauth' });
    expect(await count(h, 'auth_challenge')).toBe(0);
  });

  it('google-link with a fresh session binds the challenge to the member', async () => {
    const { h } = harness();
    const cookie = await freshCookie(h, 'm1');
    const res = await h.call('POST', '/api/account/google/start', { body: { purpose: 'google-link' }, cookie });
    expect(res.status).toBe(200);
    const row = await h.db.prepare('SELECT purpose, member_id FROM auth_challenge').first<{ purpose: string; member_id: string }>();
    expect(row).toEqual({ purpose: 'google-link', member_id: 'm1' });
  });

  it('an origin outside accountOrigins answers 403, writes nothing, and a Steam purpose is a 400', async () => {
    const { h } = harness();
    expect((await startLogin(h, {}, 'https://evil.example')).status).toBe(403);
    expect((await startLogin(h, {}, null)).status).toBe(403);
    expect(await count(h, 'auth_challenge')).toBe(0);
    expect((await startLogin(h, { purpose: 'steam-login' })).status).toBe(400);
    expect((await startLogin(h, { purpose: 'nope' })).status).toBe(400);
  });

  it('a same-origin request on a host outside accountOrigins passes the guard but is 403 and builds no URL', async () => {
    const { h } = harness();
    const host = 'https://preview.example.workers.dev';
    const req = new Request(host + '/api/account/google/start', {
      method: 'POST',
      headers: { 'x-rl-account': '1', 'content-type': 'application/json', origin: host },
      body: JSON.stringify({ purpose: 'google-login' }),
    });
    const res = await handleAccount(req, h.env, T0);
    expect(res.status).toBe(403);
    expect(await count(h, 'auth_challenge')).toBe(0);
    h.env.ACCOUNT_ORIGINS = host; // and listed, the same request is accepted, with that origin in redirect_uri
    const ok = await handleAccount(req.clone(), h.env, T0);
    expect(ok.status).toBe(200);
    expect(new URL(((await ok.json()) as { url: string }).url).searchParams.get('redirect_uri')).toBe(host + '/api/account/google/return');
  });

  it('shares the start day budget with Steam: the 51st from one address is 429', async () => {
    const { h } = harness();
    h.env.TICKET_SECRET = 'secret';
    const from = () => h.call('POST', '/api/account/google/start', { body: { purpose: 'google-login' }, headers: { 'cf-connecting-ip': '198.51.100.7' } });
    for (let i = 0; i < 50; i++) expect((await from()).status).toBe(200);
    expect((await from()).status).toBe(429);
    expect(await count(h, 'auth_challenge')).toBe(50);
  });

  it('google.ts is the only source file that names Google hosts', () => {
    const dir = fileURLToPath(new URL('../', import.meta.url));
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(d + e.name + '/');
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) files.push(d + e.name);
      }
    };
    walk(dir);
    const naming = files.filter((f) => /accounts\.google\.com|oauth2\.googleapis\.com/.test(readFileSync(f, 'utf8')));
    expect(naming.map((f) => f.slice(dir.length))).toEqual(['account/google.ts']);
  });
});
