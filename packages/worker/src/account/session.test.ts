import { describe, expect, it } from 'vitest';
import { accountHarness } from './test-kit';
import { SESSION_ABS_MS, SESSION_COOKIE, SESSION_IDLE_MS, MAX_SESSIONS } from './config';
import { createSession, resolveSession, sessionCookie, clearedSessionCookie, isFresh } from './session';
import { dayOf } from '../rate-day';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000; // an hour into day 20,000

async function seedMember(db: ReturnType<typeof accountHarness>['db'], id = 'm1', now = T0): Promise<void> {
  await db.prepare('INSERT INTO member (id, public_id, id_hash, user_handle, created_at, last_seen_day) VALUES (?1, ?2, ?3, ?4, ?5, 0)')
    .bind(id, 'PUB' + id, 'hash' + id, 'uh' + id, now).run();
  await db.prepare('INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES (?1, ?2, 0, ?3)')
    .bind(id, 'Callsign ' + id, now).run();
}

async function mint(h: ReturnType<typeof accountHarness>, memberId: string, now: number): Promise<string> {
  const s = await createSession(h.db, memberId, now);
  await h.db.batch(s.statements);
  return s.token;
}

const cookieOf = (token: string): string => `${SESSION_COOKIE}=${token}`;

describe('account sessions', () => {
  it('cookie flags (A1-1)', () => {
    const c = sessionCookie('t', 2592000);
    expect(c).toMatch(/^__Host-rl_session=t; Secure; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
    expect(c).not.toMatch(/Domain/i);
    expect(clearedSessionCookie()).toMatch(/^__Host-rl_session=; Secure; HttpOnly; SameSite=Strict; Path=\/; Max-Age=0$/);
  });

  it('revocation: logout-all with A leaves B signed out (A1-6)', async () => {
    const h = accountHarness({ now: T0 });
    await seedMember(h.db);
    const a = await mint(h, 'm1', T0);
    const b = await mint(h, 'm1', T0);
    expect((await h.call('GET', '/api/account/me', { cookie: cookieOf(b) })).status).toBe(200);
    expect((await h.call('POST', '/api/account/logout-all', { cookie: cookieOf(a), body: {} })).status).toBe(200);
    expect((await h.call('GET', '/api/account/me', { cookie: cookieOf(b) })).status).toBe(401);
  });

  it('a forged token with no row is signed out (A1-6)', async () => {
    const h = accountHarness({ now: T0 });
    await seedMember(h.db);
    const res = await h.call('GET', '/api/account/me', { cookie: cookieOf('A'.repeat(43)) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'signed_out' });
  });

  it('logout deletes this session only and clears the cookie', async () => {
    const h = accountHarness({ now: T0 });
    await seedMember(h.db);
    const a = await mint(h, 'm1', T0);
    const b = await mint(h, 'm1', T0);
    const res = await h.call('POST', '/api/account/logout', { cookie: cookieOf(a), body: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBe(clearedSessionCookie());
    expect((await h.call('GET', '/api/account/me', { cookie: cookieOf(a) })).status).toBe(401);
    expect((await h.call('GET', '/api/account/me', { cookie: cookieOf(b) })).status).toBe(200);
  });

  it('slide re-sends the cookie once a day (A1-15)', async () => {
    const h = accountHarness({ now: T0 });
    await seedMember(h.db);
    const token = await mint(h, 'm1', T0);
    const req = (): Request => new Request('https://x.test/', { headers: { cookie: cookieOf(token) } });
    const same = await resolveSession(req(), h.db, T0 + 1000);
    expect(same?.setCookie).toBeNull();
    const before = await h.db.prepare('SELECT expires_at FROM session').first<{ expires_at: number }>();
    const next = await resolveSession(req(), h.db, T0 + DAY);
    expect(next?.setCookie).toBe(sessionCookie(token, 2592000));
    const after = await h.db.prepare('SELECT expires_at, last_seen_day FROM session').first<{ expires_at: number; last_seen_day: number }>();
    expect(after?.expires_at).toBe(T0 + DAY + SESSION_IDLE_MS);
    expect(after?.expires_at).toBeGreaterThan(before?.expires_at ?? Infinity);
    expect(after?.last_seen_day).toBe(dayOf(T0 + DAY));
    const m = await h.db.prepare('SELECT last_seen_day FROM member').first<{ last_seen_day: number }>();
    expect(m?.last_seen_day).toBe(dayOf(T0 + DAY));
    // and the same day again does not re-send
    expect((await resolveSession(req(), h.db, T0 + DAY + 5))?.setCookie).toBeNull();
  });

  it('slide_stops_at_absolute', async () => {
    const opts = { now: T0 };
    const h = accountHarness(opts);
    await seedMember(h.db);
    const token = await mint(h, 'm1', T0);
    const abs = T0 + SESSION_ABS_MS;
    const now = T0 + 179.5 * DAY;
    // keep the idle window alive by sliding along the way
    let t = T0;
    while (t + 25 * DAY < now) {
      t += 25 * DAY;
      await resolveSession(new Request('https://x.test/', { headers: { cookie: cookieOf(token) } }), h.db, t);
    }
    const r = await resolveSession(new Request('https://x.test/', { headers: { cookie: cookieOf(token) } }), h.db, now);
    expect(r).not.toBeNull();
    const row = await h.db.prepare('SELECT expires_at, absolute_at FROM session').first<{ expires_at: number; absolute_at: number }>();
    expect(row?.absolute_at).toBe(abs);
    expect(row?.expires_at).toBe(abs);
    expect(r?.setCookie).toBe(sessionCookie(token, Math.max(0, Math.floor((abs - now) / 1000))));
    // at the absolute instant the session is dead
    expect(await resolveSession(new Request('https://x.test/', { headers: { cookie: cookieOf(token) } }), h.db, abs)).toBeNull();
    opts.now = abs;
    expect((await h.call('GET', '/api/account/me', { cookie: cookieOf(token) })).status).toBe(401);
  });

  it('an idle session expires', async () => {
    const h = accountHarness({ now: T0 });
    await seedMember(h.db);
    const token = await mint(h, 'm1', T0);
    const req = new Request('https://x.test/', { headers: { cookie: cookieOf(token) } });
    expect(await resolveSession(req, h.db, T0 + SESSION_IDLE_MS)).toBeNull();
  });

  it('eleven sessions keep ten', async () => {
    const h = accountHarness({ now: T0 });
    await seedMember(h.db);
    await seedMember(h.db, 'm2');
    const other = await mint(h, 'm2', T0 - 5);
    const tokens: string[] = [];
    for (let i = 0; i < MAX_SESSIONS + 1; i++) tokens.push(await mint(h, 'm1', T0 + i));
    const n = await h.db.prepare("SELECT COUNT(*) AS n FROM session WHERE member_id = 'm1'").first<{ n: number }>();
    expect(n?.n).toBe(MAX_SESSIONS);
    const res = (t: string) => resolveSession(new Request('https://x.test/', { headers: { cookie: cookieOf(t) } }), h.db, T0 + 50);
    expect(await res(tokens[0] ?? '')).toBeNull();
    expect(await res(tokens[10] ?? '')).not.toBeNull();
    expect(await res(other)).not.toBeNull();
  });

  it('createSession moves member.last_seen_day and sets freshness', async () => {
    const h = accountHarness({ now: T0 });
    await seedMember(h.db);
    const token = await mint(h, 'm1', T0);
    const m = await h.db.prepare('SELECT last_seen_day FROM member').first<{ last_seen_day: number }>();
    expect(m?.last_seen_day).toBe(dayOf(T0));
    const r = await resolveSession(new Request('https://x.test/', { headers: { cookie: cookieOf(token) } }), h.db, T0 + 1);
    expect(r && isFresh(r.session, T0 + 299_000)).toBe(true);
    expect(r && isFresh(r.session, T0 + 300_000)).toBe(false);
  });

  it('the token is never stored', async () => {
    const h = accountHarness({ now: T0 });
    await seedMember(h.db);
    const token = await mint(h, 'm1', T0);
    const rows = await h.db.prepare('SELECT * FROM session').all<Record<string, unknown>>();
    expect(rows.results.length).toBe(1);
    for (const row of rows.results) {
      for (const v of Object.values(row)) if (typeof v === 'string') expect(v).not.toContain(token);
    }
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('me answers the profile and identities; steamId only for steam', async () => {
    const h = accountHarness({ now: T0 });
    await seedMember(h.db);
    await h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, label, created_at, last_used_day) VALUES ('i1','m1','steam','76561198000000000','Steam',?1,5)").bind(T0).run();
    await h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, label, created_at) VALUES ('i2','m1','passkey','credabc','Laptop',?1)").bind(T0).run();
    const token = await mint(h, 'm1', T0);
    const body = await (await h.call('GET', '/api/account/me', { cookie: cookieOf(token) })).json() as Record<string, unknown>;
    expect(body.publicId).toBe('PUBm1');
    expect(body.displayName).toBe('Callsign m1');
    expect(body.showRecord).toBe(false);
    expect(body.fresh).toBe(true);
    const ids = body.identities as Record<string, unknown>[];
    const steam = ids.find((i) => i.provider === 'steam');
    const pk = ids.find((i) => i.provider === 'passkey');
    expect(steam?.steamId).toBe('76561198000000000');
    expect(pk && 'steamId' in pk).toBe(false);
    expect(JSON.stringify(body)).not.toContain('credabc');
  });
});
