import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from './config';
import { canSignInCount } from './identity';
import { OpIdError, withOp } from './op';
import { matchPath } from './routes';
import { createSession } from './session';
import { accountHarness } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const OP1 = '11111111-1111-4111-8111-111111111111';
const OP2 = '22222222-2222-4222-8222-222222222222';
type H = ReturnType<typeof accountHarness>;

async function seed(h: H, id = 'm1'): Promise<void> {
  await h.db.prepare('INSERT INTO member (id, public_id, id_hash, user_handle, created_at, last_seen_day) VALUES (?1, ?2, ?3, ?4, ?5, 0)')
    .bind(id, 'PUB' + id, 'hash' + id, 'uh' + id, T0).run();
  await h.db.prepare('INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES (?1, ?2, 0, ?3)').bind(id, 'Callsign', T0).run();
}
async function ident(h: H, id: string, provider: string, subject: string, state = 'active', member = 'm1'): Promise<void> {
  await h.db.prepare('INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(id, member, provider, subject, state, T0).run();
}
async function cookie(h: H, member = 'm1', at = T0): Promise<string> {
  const s = await createSession(h.db, member, at);
  await h.db.batch(s.statements);
  return `${SESSION_COOKIE}=${s.token}`;
}
const del = (h: H, id: string, ck: string, op: unknown = OP1) =>
  h.call('DELETE', `/api/account/identity/${id}`, { cookie: ck, body: { op_id: op } });
const count = async (h: H, id: string): Promise<number> =>
  (await h.db.prepare('SELECT COUNT(*) AS n FROM member_identity WHERE id = ?1').bind(id).first<{ n: number }>())?.n ?? -1;

describe('identity routes', () => {
  it('the last way in cannot be removed (A1-18 third half)', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    await ident(h, 'is', 'steam', '76561197960287930');
    const ck = await cookie(h);
    expect((await del(h, 'is', ck)).status).toBe(409);
    expect(await (await del(h, 'is', ck, OP2)).json()).toEqual({ error: 'last_identity' });
    await ident(h, 'ir', 'recovery', 'hash1', 'pending');
    expect((await del(h, 'is', ck)).status).toBe(409);
    expect(await count(h, 'is')).toBe(1);
    await h.db.prepare("UPDATE member_identity SET state = 'active' WHERE id = 'ir'").run();
    expect((await del(h, 'is', ck)).status).toBe(200);
    expect(await count(h, 'is')).toBe(0);
  });

  it('canSignInCount ignores a pending recovery row and honours the exclusion', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    await ident(h, 'ir', 'recovery', 'h', 'pending');
    expect(await canSignInCount(h.db, 'm1')).toBe(0);
    await ident(h, 'is', 'steam', '76561197960287930');
    expect(await canSignInCount(h.db, 'm1')).toBe(1);
    expect(await canSignInCount(h.db, 'm1', 'is')).toBe(0);
  });

  it('a pending recovery row can be deleted while another way in remains', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    await ident(h, 'is', 'steam', '76561197960287930');
    await ident(h, 'ir', 'recovery', 'h', 'pending');
    expect((await del(h, 'ir', await cookie(h))).status).toBe(200);
    expect(await count(h, 'ir')).toBe(0);
  });

  it("another member's id is 404 and nothing is deleted", async () => {
    const h = accountHarness({ now: T0 });
    await seed(h, 'm1');
    await seed(h, 'm2');
    await ident(h, 'i1', 'steam', '76561197960287930');
    await ident(h, 'i2', 'steam', '76561197960287931', 'active', 'm2');
    await ident(h, 'i1b', 'passkey', 'c1');
    expect((await del(h, 'i2', await cookie(h))).status).toBe(404);
    expect((await del(h, 'nope', await cookie(h), OP2)).status).toBe(404);
    expect(await count(h, 'i2')).toBe(1);
  });

  it('needs a fresh session: a stale one answers 403 reauth', async () => {
    const h = accountHarness({ now: T0 + 600_000 });
    await seed(h);
    await ident(h, 'is', 'steam', '76561197960287930');
    await ident(h, 'ip', 'passkey', 'c1');
    const res = await del(h, 'ip', await cookie(h, 'm1', T0));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'reauth' });
    expect(await count(h, 'ip')).toBe(1);
  });

  it('needs a session and a valid op_id', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    await ident(h, 'is', 'steam', '76561197960287930');
    await ident(h, 'ip', 'passkey', 'c1');
    expect((await h.call('DELETE', '/api/account/identity/ip', { body: { op_id: OP1 } })).status).toBe(401);
    const ck = await cookie(h);
    expect((await del(h, 'ip', ck, 'not-a-uuid')).status).toBe(400);
    expect((await h.call('DELETE', '/api/account/identity/ip', { cookie: ck, body: {} })).status).toBe(400);
    expect(await count(h, 'ip')).toBe(1);
  });

  it('a retried delete returns the first answer instead of 404', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    await ident(h, 'is', 'steam', '76561197960287930');
    await ident(h, 'ip', 'passkey', 'c1');
    const ck = await cookie(h);
    expect((await del(h, 'ip', ck)).status).toBe(200);
    const again = await del(h, 'ip', ck);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
  });

  it('the day budget stops the write with 429 limit', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    await ident(h, 'is', 'steam', '76561197960287930');
    await ident(h, 'ip', 'passkey', 'c1');
    await h.db.prepare("INSERT INTO rate_day (scope, key, day, n) VALUES ('acct-ops', 'm1', ?1, 400)").bind(Math.floor(T0 / DAY)).run();
    const res = await del(h, 'ip', await cookie(h));
    expect(res.status).toBe(429);
    expect(await count(h, 'ip')).toBe(1);
  });
});

describe('path parameters', () => {
  it('matchPath binds a :name segment and keeps literals exact', () => {
    expect(matchPath('identity/:id', 'identity/abc_-9')).toEqual({ id: 'abc_-9' });
    expect(matchPath('profile', 'profile')).toEqual({});
    expect(matchPath('identity/:id', 'identity')).toBeNull();
    expect(matchPath('identity/:id', 'identity/a/b')).toBeNull();
    expect(matchPath('identity/:id', 'other/abc')).toBeNull();
    expect(matchPath('identity/:id', 'identity/')).toBeNull();
    expect(matchPath('identity/:id', 'identity/a%2Fb')).toBeNull();
    expect(matchPath('identity/:id', 'identity/' + 'a'.repeat(65))).toBeNull();
  });

  it('a malformed id answers 404 not_found, and existing exact routes still work', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    const ck = await cookie(h);
    for (const bad of ['a%2Fb', 'a.b', 'a'.repeat(65), 'x%00y']) {
      const res = await del(h, bad, ck);
      expect(res.status, bad).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect((await h.call('GET', '/api/account/open')).status).toBe(200);
    expect((await h.call('GET', '/api/account/me', { cookie: ck })).status).toBe(200);
    expect((await h.call('GET', '/api/account/identity/abc', { cookie: ck })).status).toBe(404);
  });

  it('the 415 guard stays strict on the param route', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    const res = await h.call('DELETE', '/api/account/identity/abc', { cookie: await cookie(h), headers: { 'content-type': 'text/plain' }, body: { op_id: OP1 } });
    expect(res.status).toBe(415);
  });
});

describe('withOp', () => {
  it('rejects a malformed op id', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    await expect(withOp(h.db, 'm1', 'nope', 'k', T0, async () => ({ statements: [], status: 200, response: 1 }))).rejects.toBeInstanceOf(OpIdError);
  });

  it('rethrows an error that is not the op id collision', async () => {
    const h = accountHarness({ now: T0 });
    await seed(h);
    await expect(
      withOp(h.db, 'm1', OP1, 'k', T0, async () => ({ statements: [h.db.prepare('INSERT INTO nope VALUES (1)')], status: 200, response: 1 })),
    ).rejects.toThrow();
  });

  it('rethrows a constraint error when no committed response is there to re-read', async () => {
    const h = accountHarness({ now: T0, foreignKeys: true });
    // m-ghost has no member row: the account_op insert fails its foreign key, and the re-read finds nothing.
    await expect(withOp(h.db, 'm-ghost', OP1, 'k', T0, async () => ({ statements: [], status: 200, response: 1 }))).rejects.toThrow();
  });
});
