import { describe, expect, it } from 'vitest';
import { ACCOUNT_RETURN_PATH, SESSION_COOKIE, STEAM_OP, preCookieName } from './config';
import { memberForIdentity } from './member';
import { createSession } from './session';
import { accountHarness, steamStub } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const S1 = '76561197960287930';
const S2 = '76561197960287931';
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';

type H = ReturnType<typeof accountHarness>;
interface Started { c: string; cookie: string; url: string }

async function start(h: H, purpose: 'steam-login' | 'steam-link', cookie?: string): Promise<Started> {
  const res = await h.call('POST', '/api/account/steam/start', { body: { purpose }, cookie });
  expect(res.status).toBe(200);
  const url = ((await res.json()) as { url: string }).url;
  const returnTo = new URL(url).searchParams.get('openid.return_to') ?? '';
  const c = new URL(returnTo).searchParams.get('c') ?? '';
  const set = res.headers.get('set-cookie') ?? '';
  return { c, cookie: set.split(';')[0] ?? '', url };
}

/** A valid id_res query for challenge `c` and `steamId`, with `overrides` applied (`null` removes a key). */
function returnParams(c: string, steamId: string, overrides: Record<string, string | null> = {}): string {
  const claimed = `https://steamcommunity.com/openid/id/${steamId}`;
  const base: Record<string, string> = {
    c,
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OP,
    'openid.claimed_id': claimed,
    'openid.identity': claimed,
    'openid.return_to': `${ORIGIN}/api/account/steam/return?c=${c}`,
    'openid.response_nonce': '2026-11-08T00:00:00ZabcDEF',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2ln',
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) if (v !== null) q.set(k, v);
  return q.toString();
}

const back = (res: Response): { status: number; code: string | null; location: string } => {
  const location = res.headers.get('location') ?? '';
  return { status: res.status, code: new URL(location, ORIGIN).searchParams.get('r'), location };
};

async function ret(h: H, query: string, cookie?: string): Promise<Response> {
  return h.call('GET', `/api/account/steam/return?${query}`, { cookie });
}

const count = async (h: H, table: string): Promise<number> =>
  (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? -1;

function harness(opts: { valid?: boolean; down?: boolean; open?: boolean } = {}) {
  const stub = steamStub({ valid: opts.valid, down: opts.down });
  const h = accountHarness({ now: T0, deps: stub });
  return { h, stub, ready: opts.open === false ? Promise.resolve() : h.db.prepare(`INSERT INTO flags VALUES ('accounts','open',0)`).run().then(() => undefined) };
}

async function seedMember(h: H, id: string, steam?: string): Promise<void> {
  await h.db.prepare('INSERT INTO member (id, public_id, id_hash, user_handle, created_at, last_seen_day) VALUES (?1, ?2, ?3, ?4, ?5, 0)')
    .bind(id, 'PUB' + id, 'hash' + id, 'uh' + id, T0).run();
  await h.db.prepare('INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES (?1, ?2, 0, ?3)').bind(id, 'Callsign ' + id, T0).run();
  if (steam !== undefined) {
    await h.db.prepare(`INSERT INTO member_identity (id, member_id, provider, subject, state, created_at, last_used_day) VALUES (?1, ?2, 'steam', ?3, 'active', ?4, 0)`)
      .bind('i' + id, id, steam, T0).run();
  }
}

async function freshCookie(h: H, memberId: string): Promise<string> {
  const s = await createSession(h.db, memberId, T0);
  await h.db.batch(s.statements);
  return `${SESSION_COOKIE}=${s.token}`;
}

describe('Steam sign-in', () => {
  it('a correct return signs in', async () => {
    const { h, ready } = harness();
    await ready;
    const s = await start(h, 'steam-login');
    expect(s.url.startsWith(STEAM_OP + '?')).toBe(true);
    const res = await ret(h, returnParams(s.c, S1), s.cookie);
    expect(back(res)).toMatchObject({ status: 303, code: 'ok' });
    expect(back(res).location.startsWith(ACCOUNT_RETURN_PATH + '&r=')).toBe(true);
    expect(await count(h, 'member')).toBe(1);
    const ident = await h.db.prepare(`SELECT subject, member_id FROM member_identity WHERE provider = 'steam'`).first<{ subject: string; member_id: string }>();
    expect(ident?.subject).toBe(S1);
    const m = await h.db.prepare('SELECT public_id FROM member').first<{ public_id: string }>();
    const p = await h.db.prepare('SELECT display_name FROM profile').first<{ display_name: string }>();
    expect(p?.display_name).toBe(m?.public_id);
    const w = await h.db.prepare('SELECT paid FROM wallet WHERE member_id = ?1').bind(ident?.member_id ?? '').first<{ paid: number }>();
    expect(w?.paid).toBe(0);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(SESSION_COOKIE + '='))).toBe(true);
    expect(cookies.some((c) => c.startsWith(preCookieName(s.c) + '=;') && c.includes('Max-Age=0'))).toBe(true);
    expect(await count(h, 'session')).toBe(1);
  });

  const forgeries: [string, (c: string) => string, string][] = [
    ['a wrong op_endpoint', (c) => returnParams(c, S1, { 'openid.op_endpoint': 'https://evil.example/openid/login' }), 'invalid'],
    ['claimed_id off the pattern', (c) => returnParams(c, S1, { 'openid.claimed_id': 'https://steamcommunity.com/openid/id/123', 'openid.identity': 'https://steamcommunity.com/openid/id/123' }), 'invalid'],
    ['a different return_to', (c) => returnParams(c, S1, { 'openid.return_to': `${ORIGIN}/api/account/steam/return?c=other` }), 'invalid'],
    ['identity !== claimed_id', (c) => returnParams(c, S1, { 'openid.identity': `https://steamcommunity.com/openid/id/${S2}` }), 'invalid'],
    ['signed without claimed_id', (c) => returnParams(c, S1, { 'openid.signed': 'signed,op_endpoint,identity,return_to,response_nonce,assoc_handle' }), 'invalid'],
    ['mode not id_res', (c) => returnParams(c, S1, { 'openid.mode': 'setup_needed' }), 'invalid'],
  ];
  for (const [name, build, code] of forgeries) {
    it(`refuses ${name} (A1-19)`, async () => {
      const { h, stub, ready } = harness();
      await ready;
      const s = await start(h, 'steam-login');
      const res = await ret(h, build(s.c), s.cookie);
      expect(back(res).code).toBe(code);
      expect(await count(h, 'session')).toBe(0);
      expect(await count(h, 'member')).toBe(0);
      expect(res.headers.getSetCookie().some((c) => c.startsWith(SESSION_COOKIE))).toBe(false);
      expect(stub.calls.length).toBe(0);
    });
  }

  it('refuses is_valid:false (A1-19)', async () => {
    const { h, stub, ready } = harness({ valid: false });
    await ready;
    const s = await start(h, 'steam-login');
    const res = await ret(h, returnParams(s.c, S1), s.cookie);
    expect(back(res).code).toBe('invalid');
    expect(await count(h, 'session')).toBe(0);
    expect(stub.calls.length).toBe(1);
  });

  it('a Steam outage is r=steam, and the check call is a check_authentication POST', async () => {
    const { h, stub, ready } = harness({ down: true });
    await ready;
    const s = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(s.c, S1), s.cookie)).code).toBe('steam');
    expect(new URLSearchParams(stub.calls[0]?.body).get('openid.mode')).toBe('check_authentication');
    expect(await count(h, 'session')).toBe(0);
  });

  it('refuses a consumed challenge, an expired one, and a missing or wrong pre cookie (A1-19)', async () => {
    const { h, ready } = harness();
    await ready;
    // consumed
    const a = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(a.c, S1), a.cookie)).code).toBe('ok');
    expect(back(await ret(h, returnParams(a.c, S1), a.cookie)).code).toBe('expired');
    // expired
    const b = await start(h, 'steam-login');
    await h.db.prepare('UPDATE auth_challenge SET expires_at = 0').run();
    expect(back(await ret(h, returnParams(b.c, S2), b.cookie)).code).toBe('expired');
    // missing cookie
    const c = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(c.c, S2))).code).toBe('nocookie');
    // wrong cookie
    const d = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(d.c, S2), `${preCookieName(d.c)}=${'A'.repeat(43)}`)).code).toBe('invalid');
    expect(await count(h, 'session')).toBe(1);
    expect(await count(h, 'member')).toBe(1);
  });

  it('two tabs: each challenge has its own pre cookie', async () => {
    const { h, ready } = harness();
    await ready;
    const a = await start(h, 'steam-login');
    const b = await start(h, 'steam-login');
    expect(a.cookie.split('=')[0]).not.toBe(b.cookie.split('=')[0]);
    const jar = `${a.cookie}; ${b.cookie}`;
    expect(back(await ret(h, returnParams(a.c, S1), jar)).code).toBe('ok');
    expect(back(await ret(h, returnParams(b.c, S2), jar)).code).toBe('ok');
  });

  it('refuses a repeated openid.* key: victim first, the signed value last (C1)', async () => {
    const { h, ready } = harness();
    await ready;
    await seedMember(h, 'victim', S2);
    const s = await start(h, 'steam-login');
    const victim = `https://steamcommunity.com/openid/id/${S2}`;
    const q = `openid.claimed_id=${encodeURIComponent(victim)}&openid.identity=${encodeURIComponent(victim)}&${returnParams(s.c, S1)}`;
    const res = await ret(h, q, s.cookie);
    expect(back(res).code).toBe('invalid');
    expect(await count(h, 'session')).toBe(0);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(SESSION_COOKIE))).toBe(false);
  });

  it('start answers exactly the six OpenID parameters, and a Lax 300 s pre cookie', async () => {
    const { h, ready } = harness();
    await ready;
    const res = await h.call('POST', '/api/account/steam/start', { body: { purpose: 'steam-login' } });
    const url = new URL(((await res.json()) as { url: string }).url);
    expect(url.origin + url.pathname).toBe(STEAM_OP);
    const c = new URL(url.searchParams.get('openid.return_to') ?? '').searchParams.get('c') ?? '';
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': `${ORIGIN}/api/account/steam/return?c=${c}`,
      'openid.realm': ORIGIN,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie.startsWith(preCookieName(c) + '=')).toBe(true);
    expect(cookie.split('; ').slice(1)).toEqual(['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=300']);
  });

  it('steam-link from a stale session answers 403 reauth', async () => {
    const { h, ready } = harness();
    await ready;
    await seedMember(h, 'm1');
    const cookie = await freshCookie(h, 'm1');
    await h.db.prepare('UPDATE session SET fresh_until = 0').run();
    const res = await h.call('POST', '/api/account/steam/start', { body: { purpose: 'steam-link' }, cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'reauth' });
    expect(await count(h, 'auth_challenge')).toBe(0);
  });

  it('a Steam check answering 503 is r=steam', async () => {
    const stub = steamStub({ status: 503 });
    const h = accountHarness({ now: T0, deps: stub });
    await h.db.prepare(`INSERT INTO flags VALUES ('accounts','open',0)`).run();
    const s = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(s.c, S1), s.cookie)).code).toBe('steam');
    expect(await count(h, 'session')).toBe(0);
  });

  it('a database failure after the consume is still a 303 (I1)', async () => {
    const { h, ready } = harness();
    await ready;
    const s = await start(h, 'steam-login');
    const real = h.db.batch.bind(h.db);
    h.db.batch = async () => { throw new Error('d1 down'); };
    const res = await ret(h, returnParams(s.c, S1), s.cookie);
    h.db.batch = real;
    expect(back(res)).toMatchObject({ status: 303, code: 'steam' });
    expect(res.headers.getSetCookie().some((c) => c.startsWith(SESSION_COOKIE))).toBe(false);
  });

  it('refuses smuggled openid keys: NUL suffix, other case, unknown name, foreign signed field (C1)', async () => {
    const { h, stub, ready } = harness();
    await ready;
    const a = `https://steamcommunity.com/openid/id/${S1}`;
    const cases = [
      (c: string) => `openid.claimed_id%00x=${encodeURIComponent(a)}&openid.identity%00x=${encodeURIComponent(a)}&${returnParams(c, S2)}`,
      (c: string) => `openid.CLAIMED_ID=${encodeURIComponent(a)}&${returnParams(c, S2)}`,
      (c: string) => `${returnParams(c, S2)}&openid.extra=1`,
      (c: string) => `OPENID.claimed_id=${encodeURIComponent(a)}&${returnParams(c, S2)}`,
      (c: string) => `openid_claimed_id=1&${returnParams(c, S2)}`,
      (c: string) => returnParams(c, S2, { 'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle,foo' }),
    ];
    for (const build of cases) {
      const s = await start(h, 'steam-login');
      expect(back(await ret(h, build(s.c), s.cookie)).code).toBe('invalid');
    }
    expect(await count(h, 'session')).toBe(0);
    expect(stub.calls.length).toBe(0);
  });

  it('the check body carries exactly the allowlisted keys with the values the checks read', async () => {
    const { h, stub, ready } = harness();
    await ready;
    const s = await start(h, 'steam-login');
    await ret(h, returnParams(s.c, S1), s.cookie);
    const sent = Object.fromEntries(new URLSearchParams(stub.calls[0]?.body));
    expect(Object.keys(sent).sort()).toEqual(['openid.assoc_handle', 'openid.claimed_id', 'openid.identity', 'openid.mode', 'openid.ns', 'openid.op_endpoint', 'openid.response_nonce', 'openid.return_to', 'openid.sig', 'openid.signed']);
    expect(sent['openid.mode']).toBe('check_authentication');
    expect(sent['openid.claimed_id']).toBe(`https://steamcommunity.com/openid/id/${S1}`);
  });

  it('a throwing rate limiter is still a 303 (m1)', async () => {
    const { h, ready } = harness();
    await ready;
    const s = await start(h, 'steam-login');
    h.env.ACCOUNT_LIMIT = { limit: async () => { throw new Error('binding down'); } };
    expect(back(await ret(h, returnParams(s.c, S1), s.cookie))).toMatchObject({ status: 303, code: 'steam' });
  });

  it('steam-link start passes on the slide cookie (m2)', async () => {
    const { h, ready } = harness();
    await ready;
    await seedMember(h, 'm1');
    const cookie = await freshCookie(h, 'm1');
    await h.db.prepare('UPDATE session SET last_seen_day = 1').run();
    const res = await h.call('POST', '/api/account/steam/start', { body: { purpose: 'steam-link' }, cookie });
    const sets = res.headers.getSetCookie();
    expect(sets.length).toBe(2);
    expect(sets.some((c) => c.startsWith(SESSION_COOKIE + '='))).toBe(true);
  });

  it('a link whose member vanished is not "taken" (M7)', async () => {
    const stub = steamStub();
    const h = accountHarness({ now: T0, deps: stub, foreignKeys: true });
    await seedMember(h, 'm1');
    const s = await start(h, 'steam-link', await freshCookie(h, 'm1'));
    await h.db.prepare('DELETE FROM member WHERE id = ?1').bind('m1').run();
    expect(back(await ret(h, returnParams(s.c, S1), s.cookie)).code).toBe('steam');
  });

  it('cancel_returns_cancelled', async () => {
    const { h, ready } = harness();
    await ready;
    const s = await start(h, 'steam-login');
    const res = await ret(h, `c=${s.c}&openid.mode=cancel`, s.cookie);
    expect(back(res).code).toBe('cancelled');
    expect(await count(h, 'auth_challenge')).toBe(0);
  });

  it('replayed_return_is_expired', async () => {
    const { h, ready } = harness();
    await ready;
    const s = await start(h, 'steam-login');
    const q = returnParams(s.c, S1);
    expect(back(await ret(h, q, s.cookie)).code).toBe('ok');
    expect(back(await ret(h, q, s.cookie)).code).toBe('expired');
    expect(await count(h, 'session')).toBe(1);
  });

  it('concurrent_first_signins_make_one_member', async () => {
    const { h, ready } = harness();
    await ready;
    const a = await start(h, 'steam-login');
    const b = await start(h, 'steam-login');
    const [ra, rb] = await Promise.all([ret(h, returnParams(a.c, S1), a.cookie), ret(h, returnParams(b.c, S1), b.cookie)]);
    expect([back(ra).code, back(rb).code]).toEqual(['ok', 'ok']);
    expect(await count(h, 'member')).toBe(1);
    expect(await count(h, 'session')).toBe(2);
    for (const r of [ra, rb]) expect(r.headers.getSetCookie().some((c) => c.startsWith(SESSION_COOKIE + '='))).toBe(true);
  });

  it("closed makes no member (A1-13's second half)", async () => {
    const { h } = harness({ open: false });
    const a = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(a.c, S1), a.cookie)).code).toBe('closed');
    expect(await count(h, 'member')).toBe(0);
    expect(await count(h, 'session')).toBe(0);
    await seedMember(h, 'm1', S1);
    const b = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(b.c, S1), b.cookie)).code).toBe('ok');
    expect(await count(h, 'session')).toBe(1);
  });

  it('a spent new-account budget answers r=limit and makes no member', async () => {
    const { h, ready } = harness();
    await ready;
    await h.db.prepare(`INSERT INTO rate_day (scope, key, day, n) VALUES ('acct-new-all', '', ?1, 500)`).bind(Math.floor(T0 / DAY)).run();
    const s = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(s.c, S1), s.cookie)).code).toBe('limit');
    expect(await count(h, 'member')).toBe(0);
  });

  it("a link cannot take another member's steam (A1-18's first half)", async () => {
    const { h, ready } = harness();
    await ready;
    await seedMember(h, 'm1', S1);
    await seedMember(h, 'm2');
    const s = await start(h, 'steam-link', await freshCookie(h, 'm2'));
    const dump = async (): Promise<string> =>
      JSON.stringify(await Promise.all(['member', 'member_identity', 'profile', 'wallet'].map((t) => h.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())));
    const before = await dump();
    expect(back(await ret(h, returnParams(s.c, S1), s.cookie)).code).toBe('taken');
    expect(await dump()).toBe(before);
  });

  it('linking: own steam is linked, a new one inserts, a second different one is taken', async () => {
    const { h, ready } = harness();
    await ready;
    await seedMember(h, 'm1');
    const cookie = await freshCookie(h, 'm1');
    const a = await start(h, 'steam-link', cookie);
    expect(back(await ret(h, returnParams(a.c, S1), a.cookie)).code).toBe('linked');
    expect(await memberForIdentity(h.db, 'steam', S1)).toBe('m1');
    const b = await start(h, 'steam-link', cookie);
    expect(back(await ret(h, returnParams(b.c, S1), b.cookie)).code).toBe('linked');
    const c = await start(h, 'steam-link', cookie);
    expect(back(await ret(h, returnParams(c.c, S2), c.cookie)).code).toBe('taken');
    expect(await memberForIdentity(h.db, 'steam', S2)).toBeNull();
  });

  it('steam-link needs a fresh session, and start needs an allowed origin', async () => {
    const { h, ready } = harness();
    await ready;
    expect((await h.call('POST', '/api/account/steam/start', { body: { purpose: 'steam-link' } })).status).toBe(401);
    expect((await h.call('POST', '/api/account/steam/start', { body: { purpose: 'nope' } })).status).toBe(400);
    expect((await h.call('POST', '/api/account/steam/start', { body: { purpose: 'steam-login' }, origin: 'https://evil.example' })).status).toBe(403);
  });

  it("the same member through either provider (A1-18's second half)", async () => {
    const { h, ready } = harness();
    await ready;
    await seedMember(h, 'm1', S1);
    await h.db.prepare(`INSERT INTO member_identity (id, member_id, provider, subject, state, created_at, last_used_day) VALUES ('ip', 'm1', 'passkey', 'cred1', 'active', ?1, 0)`).bind(T0).run();
    expect(await memberForIdentity(h.db, 'passkey', 'cred1')).toBe('m1');
    expect(await memberForIdentity(h.db, 'steam', S1)).toBe('m1');
  });

  it('only steam is ever called', async () => {
    const { h, stub, ready } = harness();
    await ready;
    const s = await start(h, 'steam-login');
    await ret(h, returnParams(s.c, S1), s.cookie);
    expect(stub.calls.length).toBeGreaterThan(0);
    for (const call of stub.calls) {
      expect(call.url).toBe(STEAM_OP);
      expect(call.url).not.toContain('GetPlayerSummaries');
    }
  });
});

describe('steam/start day budget (M1)', () => {
  const startFrom = (h: H, ip: string, purpose = 'steam-login') =>
    h.call('POST', '/api/account/steam/start', { body: { purpose }, headers: { 'cf-connecting-ip': ip } });

  it('the 51st start from one address is 429 and writes no challenge; another address still works', async () => {
    const { h } = harness();
    h.env.TICKET_SECRET = 'secret';
    for (let i = 0; i < 50; i++) expect((await startFrom(h, '198.51.100.7')).status).toBe(200);
    expect(await count(h, 'auth_challenge')).toBe(50);
    const over = await startFrom(h, '198.51.100.7');
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: 'limit' });
    expect(await count(h, 'auth_challenge')).toBe(50);
    expect((await startFrom(h, '198.51.100.8')).status).toBe(200);
    // an over-ip request did not burn the overall count
    const all = await h.db.prepare(`SELECT n FROM rate_day WHERE scope = 'acct-start-all'`).first<{ n: number }>();
    expect(all?.n).toBe(51);
    const keys = (h.db.raw.prepare('SELECT key FROM rate_day').all() as { key: string }[]).map((r) => r.key);
    expect(keys.some((k) => k.includes('198.51.100'))).toBe(false);
  });

  it('the 5001st start overall is 429 and writes no challenge', async () => {
    const { h } = harness();
    h.env.TICKET_SECRET = 'secret';
    await h.db.prepare(`INSERT INTO rate_day VALUES ('acct-start-all', '', ?1, 4999)`).bind(Math.floor(T0 / DAY)).run();
    expect((await startFrom(h, '203.0.113.1')).status).toBe(200);
    const before = await count(h, 'auth_challenge');
    expect((await startFrom(h, '203.0.113.2')).status).toBe(429);
    expect(await count(h, 'auth_challenge')).toBe(before);
  });

  it('without a secret the per-ip count is skipped but the overall one applies', async () => {
    const { h } = harness();
    for (let i = 0; i < 51; i++) expect((await startFrom(h, '198.51.100.9')).status).toBe(200);
    await h.db.prepare(`UPDATE rate_day SET n = 5000 WHERE scope = 'acct-start-all'`).run();
    expect((await startFrom(h, '198.51.100.9')).status).toBe(429);
  });

  it('a steam-link start from a stale session does not count against the budget', async () => {
    const { h } = harness();
    h.env.TICKET_SECRET = 'secret';
    const res = await h.call('POST', '/api/account/steam/start', { body: { purpose: 'steam-link' } });
    expect(res.status).toBe(401);
    expect(await count(h, 'rate_day')).toBe(0);
  });
});

describe('verifyOpenId hardening (I3)', () => {
  const run = async (overrides: Record<string, string | null>) => {
    const { h, stub, ready } = harness();
    await ready;
    const s = await start(h, 'steam-login');
    const res = await ret(h, returnParams(s.c, S1, overrides), s.cookie);
    return { code: back(res).code, calls: stub.calls.length };
  };
  for (const [name, o] of [
    ['a wrong ns', { 'openid.ns': 'http://specs.openid.net/auth/1.1' }],
    ['a missing ns', { 'openid.ns': null }],
    ['a missing sig', { 'openid.sig': null }],
    ['an empty sig', { 'openid.sig': '' }],
  ] as [string, Record<string, string | null>][]) {
    it(`refuses ${name} as invalid, with no check call`, async () => {
      expect(await run(o)).toEqual({ code: 'invalid', calls: 0 });
    });
  }

  it('the check_authentication fetch does not follow redirects', async () => {
    const inits: RequestInit[] = [];
    const deps = { fetch: async (_u: string, init: RequestInit) => (inits.push(init), new Response('is_valid:true\n', { status: 200 })) };
    const h = accountHarness({ now: T0, deps });
    await h.db.prepare(`INSERT INTO flags VALUES ('accounts','open',0)`).run();
    const s = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(s.c, S1), s.cookie)).code).toBe('ok');
    expect(inits.length).toBe(1);
    expect(inits[0]?.redirect).toBe('manual');
  });

  it('a 302 from the check endpoint is r=steam, never a sign-in', async () => {
    const deps = { fetch: async () => new Response('is_valid:true\n', { status: 302, headers: { location: 'https://evil.example/' } }) };
    const h = accountHarness({ now: T0, deps });
    await h.db.prepare(`INSERT INTO flags VALUES ('accounts','open',0)`).run();
    const s = await start(h, 'steam-login');
    expect(back(await ret(h, returnParams(s.c, S1), s.cookie)).code).toBe('steam');
    expect(await count(h, 'member')).toBe(0);
  });
});
