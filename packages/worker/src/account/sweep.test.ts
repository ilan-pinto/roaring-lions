import { describe, expect, it } from 'vitest';
import type { D1Like, D1Stmt } from '../d1';
import { dayOf } from '../rate-day';
import { OP_TTL_MS, PENDING_TTL_MS, SESSION_COOKIE, STEAM_OP, preCookieName } from './config';
import { MEMBER_IDLE_DAYS, reconcileTombstones, sweepAccounts } from './sweep';
import { accountHarness, steamStub } from './test-kit';

const DAY = 86_400_000;
const NOW = 20_000 * DAY + 3_600_000;
const CUTOFF = dayOf(NOW) - MEMBER_IDLE_DAYS - 1;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';
const STEAM = '76561197960287930';

type H = ReturnType<typeof accountHarness>;
const n = async (db: D1Like, sql: string): Promise<number> =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).first<{ n: number }>())?.n ?? -1;

async function member(h: H, id: string, lastSeen: number, steam?: string): Promise<void> {
  await h.db.prepare('INSERT INTO member VALUES (?1, ?2, ?3, ?4, 1, ?5)').bind(id, 'PUB' + id, 'hash' + id, 'uh' + id, lastSeen).run();
  await h.db.prepare("INSERT INTO profile VALUES (?1, 'Name', 0, 1)").bind(id).run();
  if (steam !== undefined) {
    await h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, created_at, last_used_day) VALUES (?1, ?2, 'steam', ?3, 1, 0)").bind('i' + id, id, steam).run();
  }
}

describe('sweepAccounts', () => {
  it('deletes the expired and keeps the live', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', dayOf(NOW));
    const run = (sql: string, ...v: unknown[]) => h.db.prepare(sql).bind(...v).run();
    const sess = (hash: string, expires: number, absolute: number) =>
      run("INSERT INTO session VALUES (?1, 'a', 1, ?2, ?3, 0, 0)", hash, expires, absolute);
    await sess('dead-idle', NOW - 1, NOW + DAY);
    await sess('dead-abs', NOW + DAY, NOW - 1);
    await sess('live', NOW + DAY, NOW + DAY);
    await run("INSERT INTO auth_challenge VALUES ('c-old', 'steam-login', NULL, NULL, ?1)", NOW - 1);
    await run("INSERT INTO auth_challenge VALUES ('c-live', 'steam-login', NULL, NULL, ?1)", NOW + 1000);
    const rec = (id: string, state: string, age: number) =>
      run("INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES (?1,'a','recovery',?1,?2,?3)", id, state, NOW - age);
    await rec('p-old', 'pending', PENDING_TTL_MS + DAY);
    await run("INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES ('p-live','a','passkey','p-live','active',?1)", NOW - PENDING_TTL_MS - DAY);
    await run("INSERT INTO account_op VALUES ('a','op-old','k',?1,'{}')", NOW - OP_TTL_MS - DAY);
    await run("INSERT INTO account_op VALUES ('a','op-live','k',?1,'{}')", NOW - DAY);
    await run('INSERT INTO rate_day VALUES (?1, ?2, ?3, 1)', 'old', 'k', dayOf(NOW) - 5);
    await sweepAccounts(h.db, NOW, h.kv);
    const left = async (sql: string): Promise<string[]> => (await h.db.prepare(sql).all<{ x: string }>()).results.map((r) => r.x).sort();
    expect(await left('SELECT token_hash AS x FROM session')).toEqual(['live']);
    expect(await left('SELECT challenge_hash AS x FROM auth_challenge')).toEqual(['c-live']);
    expect(await left('SELECT id AS x FROM member_identity')).toEqual(['p-live']);
    expect(await left('SELECT op_id AS x FROM account_op')).toEqual(['op-live']);
    expect(await n(h.db, "SELECT 1 FROM rate_day WHERE scope = 'old'")).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'a'")).toBe(1);
  });

  it('keeps a pending code a day short of its TTL, drops one a day past', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', dayOf(NOW));
    const ins = (id: string, age: number) =>
      h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES (?1,'a','recovery',?1,'pending',?2)").bind(id, NOW - age).run();
    await ins('p-8d', PENDING_TTL_MS + DAY);
    await sweepAccounts(h.db, NOW, h.kv);
    expect(await n(h.db, 'SELECT 1 FROM member_identity')).toBe(0);
    await ins('p-6d', PENDING_TTL_MS - DAY);
    await sweepAccounts(h.db, NOW, h.kv);
    expect(await n(h.db, 'SELECT 1 FROM member_identity')).toBe(1);
  });

  it('deletes a member idle 1095 days and one day, keeps one idle exactly 1095 days', async () => {
    const h = accountHarness({ now: NOW, foreignKeys: true });
    await member(h, 'old', CUTOFF);
    await member(h, 'edge', CUTOFF + 1);
    await member(h, 'new', dayOf(NOW));
    expect(dayOf(NOW) - CUTOFF).toBe(1096);
    await sweepAccounts(h.db, NOW, h.kv);
    expect((await h.db.prepare('SELECT id AS x FROM member ORDER BY id').all<{ x: string }>()).results.map((r) => r.x)).toEqual(['edge', 'new']);
    expect(await n(h.db, "SELECT 1 FROM profile WHERE member_id = 'old'")).toBe(0);
    expect((await h.kv.list({ prefix: 'tomb:' })).keys.map((k) => k.name)).toEqual(['tomb:hashold']);
    expect(JSON.parse((await h.kv.get('tomb:hashold')) ?? '{}')).toEqual({ deletedAt: NOW, lastSeenDay: CUTOFF });
  });

  it('writes the tombstone before deleting: a failed put deletes nobody', async () => {
    const h = accountHarness({ now: NOW, failPut: true });
    await member(h, 'old', CUTOFF);
    await expect(sweepAccounts(h.db, NOW, h.kv)).rejects.toThrow('kv put failed');
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'old'")).toBe(1);
  });

  it('a sign-in after the sweep selected the member wins', async () => {
    const stub = steamStub();
    const h = accountHarness({ now: NOW, deps: stub });
    await member(h, 'm1', CUTOFF, STEAM);
    const start = await h.call('POST', '/api/account/steam/start', { body: { purpose: 'steam-login' } });
    expect(start.status).toBe(200);
    const url = ((await start.json()) as { url: string }).url;
    const c = new URL(new URL(url).searchParams.get('openid.return_to') ?? '').searchParams.get('c') ?? '';
    const pre = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(url.startsWith(STEAM_OP)).toBe(true);
    expect(pre.startsWith(preCookieName(c))).toBe(true);
    const claimed = `https://steamcommunity.com/openid/id/${STEAM}`;
    const q = new URLSearchParams({
      c, 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': STEAM_OP,
      'openid.claimed_id': claimed, 'openid.identity': claimed, 'openid.return_to': `${ORIGIN}/api/account/steam/return?c=${c}`,
      'openid.response_nonce': '2026-11-08T00:00:00ZabcDEF', 'openid.assoc_handle': '1234567890',
      'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'c2ln',
    });
    let cookie = '';
    let first = true;
    const racing: D1Like = {
      ...h.db,
      batch: async (ss: D1Stmt[]) => {
        if (first) {
          first = false;
          const res = await h.call('GET', `/api/account/steam/return?${q.toString()}`, { cookie: pre });
          expect(new URL(res.headers.get('location') ?? '', ORIGIN).searchParams.get('r')).toBe('ok');
          cookie = res.headers.getSetCookie().map((s) => s.split(';')[0] ?? '').find((s) => s.startsWith(SESSION_COOKIE + '=')) ?? '';
        }
        return h.db.batch(ss);
      },
    };
    await sweepAccounts(racing, NOW, h.kv);
    expect(first).toBe(false);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM member_identity WHERE member_id = 'm1'")).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM session WHERE member_id = 'm1'")).toBe(1);
    expect((await h.call('GET', '/api/account/me', { cookie })).status).toBe(200);
    // the cancelled deletion's tombstone is pruned, so `gone` does not call a live account deleted
    expect(await h.kv.get('tomb:hashm1')).toBeNull();
    expect(await reconcileTombstones(h.db, h.kv)).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(1);
  });
});

describe('the cron wiring', () => {
  it('scheduled sweeps and reconciles when both bindings exist, and skips them when one is missing', async () => {
    const { default: worker } = await import('../index');
    const h = accountHarness({ now: NOW });
    await member(h, 'old', CUTOFF);
    await member(h, 'gone', dayOf(NOW));
    await h.kv.put('tomb:hashgone', JSON.stringify({ deletedAt: 1, lastSeenDay: dayOf(NOW) }));
    const { ACCOUNT_TOMBSTONES: _kv, ...unbound } = h.env;
    void _kv;
    await worker.scheduled(undefined, unbound);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(2);
    await worker.scheduled(undefined, h.env);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(0);
  });
});
