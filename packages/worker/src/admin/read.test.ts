/** GH-695 S3: the read API (find, the card, the journal) and its access log. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOW, adminKit, addMember, gameCookie } from './kit';

const DAY = 86_400_000;
const LEAD = { id: 'adm', publicId: 'ADMQ0001', name: 'The Lead' };

async function seeded() {
  const k = adminKit();
  await addMember(k.db, LEAD);
  await addMember(k.db, {
    id: 'm1', publicId: 'K7Q2ABCD', name: 'Sandstorm', free: 120, walletRevision: 4, campaignRevision: 9,
    brigade: { version: 1, balance: 70, earned_total: 100, grants: [{ source: 'earned', missionId: 'a', amount: 100, at: 1 }, { source: 'granted', amount: 30, at: 2 }] },
    identities: [['google', 'google-sub-1234567'], ['steam', '76561197960287930'], ['passkey', 'cred-secret-abc'], ['recovery', 'code-hash-xyz']],
  });
  await k.db.prepare("INSERT INTO admin_member VALUES ('adm', 1)").run();
  const admin = await gameCookie(k.db, 'adm');
  const m1 = await gameCookie(k.db, 'm1');
  const get = async (path: string, game?: string) => k.call('GET', path, { game });
  return { ...k, admin, m1, get };
}

const views = async (db: { prepare(sql: string): { all<T>(): Promise<{ results: T[] }> } }) =>
  (await db.prepare("SELECT admin_id, member_id, action FROM admin_action WHERE action = 'view' ORDER BY id").all<{ admin_id: string | null; member_id: string; action: string }>()).results;

describe('find (S3, D5)', () => {
  it('finds by exact Player ID, in any case, with both balances and the kinds as words', async () => {
    const k = await seeded();
    for (const q of ['K7Q2ABCD', 'k7q2abcd', '  K7Q2abcd ']) {
      const body = (await (await k.get(`/stats/api/members/find?q=${encodeURIComponent(q)}`)).json()) as { members: Record<string, unknown>[] };
      expect(body.members, q).toEqual([
        { publicId: 'K7Q2ABCD', displayName: 'Sandstorm', created: new Date(NOW - 5 * DAY).toISOString().slice(0, 10), lastSeen: new Date(Math.floor(NOW / DAY) * DAY).toISOString().slice(0, 10), kinds: ['Google', 'Passkey', 'Recovery code', 'Steam'], coins: 120, credits: 70 },
      ]);
    }
    expect(((await (await k.get('/stats/api/members/find?q=ZZZZ9999')).json()) as { members: unknown[] }).members).toEqual([]);
  });

  it('finds by display-name prefix: case-insensitive, 3 characters at least, % and _ are not wildcards, newest sign-in first, 20 at most', async () => {
    const k = await seeded();
    const names = (b: unknown) => (b as { members: { displayName: string }[] }).members.map((m) => m.displayName);
    expect(names(await (await k.get('/stats/api/members/find?q=SANDS')).json())).toEqual(['Sandstorm']);
    expect(names(await (await k.get('/stats/api/members/find?q=sandst')).json())).toEqual(['Sandstorm']);
    expect((await k.get('/stats/api/members/find?q=Sa')).status).toBe(400); // under 3
    expect((await k.get('/stats/api/members/find?q=')).status).toBe(400);
    expect(names(await (await k.get('/stats/api/members/find?q=%25%25%25')).json())).toEqual([]); // "%%%" matches nothing
    expect(names(await (await k.get('/stats/api/members/find?q=S_n')).json())).toEqual([]); // "_" is not "any one character"
    expect(names(await (await k.get('/stats/api/members/find?q=Sandstormxxxxxxxxxxxxxxxxxx')).json())).toEqual([]); // longer than any name
    for (let i = 0; i < 25; i++) {
      await addMember(k.db, { id: `x${i}`, publicId: `QQQ${String(i).padStart(5, '0')}`, name: `Raven ${i}`, lastSeenDay: 20_000 + i, createdAt: 1000 + i });
    }
    const raven = names(await (await k.get('/stats/api/members/find?q=raven')).json());
    expect(raven).toHaveLength(20);
    expect(raven[0]).toBe('Raven 24'); // newest first
    expect(raven[19]).toBe('Raven 5');
  });

  it('"me" is the member behind this browser\'s game session, and needs one', async () => {
    const k = await seeded();
    const mine = (await (await k.get('/stats/api/members/find?q=me', k.m1)).json()) as { members: { publicId: string }[] };
    expect(mine.members.map((m) => m.publicId)).toEqual(['K7Q2ABCD']);
    expect((await k.get('/stats/api/members/find?q=ME')).status).toBe(401);
    expect((await k.get('/stats/api/members/find?q=me', 'garbage')).status).toBe(401);
  });

  it('needs the password session, GET only', async () => {
    const k = await seeded();
    expect((await k.call('GET', '/stats/api/members/find?q=K7Q2ABCD', { stats: false })).status).toBe(401);
    expect((await k.call('POST', '/stats/api/members/find?q=K7Q2ABCD', { body: {} })).status).toBe(405);
  });
});

describe('what a lookup never shows (S3, D5)', () => {
  it('no Google or Steam id, passkey, code hash, internal id, handle or hash appears in any answer', async () => {
    const k = await seeded();
    const texts = [
      await (await k.get('/stats/api/members/find?q=K7Q2ABCD')).text(),
      await (await k.get('/stats/api/members/find?q=sandstorm')).text(),
      await (await k.get('/stats/api/members/find?q=me', k.m1)).text(),
      await (await k.get('/stats/api/members/K7Q2ABCD')).text(),
      await (await k.get('/stats/api/members/K7Q2ABCD/journal')).text(),
    ];
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(20);
      for (const secret of ['google-sub-1234567', '76561197960287930', 'cred-secret-abc', 'code-hash-xyz', 'uh-m1', 'hash-m1', '"m1"', '"id"', 'subject', 'user_handle']) {
        expect(t, secret).not.toContain(secret);
      }
    }
  });
});

describe('the member card (S3, D6) and its access log (D14)', () => {
  it('shows both balances with their revisions, the granted total, and the last change', async () => {
    const k = await seeded();
    const res = await k.get('/stats/api/members/k7q2abcd');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      member: { publicId: 'K7Q2ABCD', displayName: 'Sandstorm', created: new Date(NOW - 5 * DAY).toISOString().slice(0, 10), lastSeen: new Date(Math.floor(NOW / DAY) * DAY).toISOString().slice(0, 10), kinds: ['Google', 'Passkey', 'Recovery code', 'Steam'] },
      coins: { free: 120, paid: 0, revision: 4, updatedAt: NOW - 1000, lastChange: { at: NOW - 1000, kind: 'claim', delta: 120 } },
      credits: { balance: 70, earnedTotal: 100, grantedTotal: 30, revision: 9, syncedAt: NOW - 60_000 },
    });
  });

  it('reads the credit balance as migrateAccount does: a balance the grants log cannot explain is cut', async () => {
    const k = await seeded();
    await addMember(k.db, { id: 'cut', publicId: 'CQT00001', name: 'Cutdown', brigade: { version: 1, balance: 9999, earned_total: 100, grants: [{ source: 'earned', missionId: 'a', amount: 100, at: 1 }] } });
    const card = (await (await k.get('/stats/api/members/CQT00001')).json()) as { credits: { balance: number } };
    expect(card.credits.balance).toBe(100);
  });

  it('a member with no campaign has credits null; an unknown or malformed id is 404 / 400', async () => {
    const k = await seeded();
    const card = (await (await k.get('/stats/api/members/ADMQ0001')).json()) as { credits: unknown; coins: { free: number; lastChange: unknown } };
    expect(card.credits).toBeNull();
    expect(card.coins).toMatchObject({ free: 0, lastChange: null });
    expect((await k.get('/stats/api/members/ZZZZ9999')).status).toBe(404);
    expect((await k.get('/stats/api/members/short')).status).toBe(400);
    expect((await k.get('/stats/api/members/ILOU1234')).status).toBe(400); // not Crockford
  });

  it('every card opened is logged with the viewer; a lookup that lists is not', async () => {
    const k = await seeded();
    await k.get('/stats/api/members/find?q=sandstorm');
    expect(await views(k.db)).toEqual([]);
    await k.get('/stats/api/members/K7Q2ABCD', k.admin); // the lead, signed in to the game
    await k.get('/stats/api/members/K7Q2ABCD'); // the password alone
    await k.get('/stats/api/members/K7Q2ABCD', k.m1); // a member who is not an admin: not recorded as one
    expect(await views(k.db)).toEqual([
      { admin_id: 'adm', member_id: 'm1', action: 'view' },
      { admin_id: null, member_id: 'm1', action: 'view' },
      { admin_id: null, member_id: 'm1', action: 'view' },
    ]);
    await k.get('/stats/api/members/ZZZZ9999'); // a card that does not exist logs nothing
    expect(await views(k.db)).toHaveLength(3);
  });
});

describe('the merged journal (S3, D6)', () => {
  async function withHistory() {
    const k = await seeded();
    const run = (sql: string, ...v: unknown[]) => k.db.prepare(sql).bind(...v).run();
    // Coin side: two player rows, and the coin_journal half of an admin grant.
    await run("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'earn', 10, '{\"secret\":\"detail-body\"}', 'op-earn')", NOW - 5000);
    await run("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'admin', 500, '{}', 'op-adm-1')", NOW - 3000);
    // Admin side: that grant's audit row, a credits change, an access-log row, and a row about somebody else.
    await run("INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id) VALUES (?1, 'adm', 'm1', 'coins', 'grant', 500, 120, 620, 'tournament prize', 'op-adm-1')", NOW - 3000);
    await run("INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id) VALUES (?1, 'adm', 'm1', 'credits', 'deduct', -20, 90, 70, 'duplicate grant', 'op-adm-2')", NOW - 2000);
    await run("INSERT INTO admin_action (at, admin_id, member_id, action) VALUES (?1, 'adm', 'm1', 'view')", NOW - 1000);
    await run("INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id) VALUES (?1, 'adm', 'adm', 'coins', 'grant', 7, 0, 7, 'someone else', 'op-other')", NOW - 2500);
    await run("INSERT INTO admin_action (at, admin_id, member_id, action, reason) VALUES (?1, 'adm', NULL, 'switch', 'closed')", NOW - 2600);
    return k;
  }
  type Row = { at: number; currency: string; kind: string; mode: string | null; delta: number; before: number | null; after: number | null; reason: string | null; by: string; opId: string | null };
  const rows = async (k: Awaited<ReturnType<typeof seeded>>, q = '') => (await (await k.get(`/stats/api/members/K7Q2ABCD/journal${q}`)).json()) as { rows: Row[]; next: string | null };

  it('lists the player\'s own rows beside the admin\'s, newest first, once each', async () => {
    const k = await withHistory();
    const { rows: r, next } = await rows(k);
    expect(next).toBeNull();
    expect(r.map((x) => [x.currency, x.kind, x.mode, x.delta, x.before, x.after, x.reason, x.by])).toEqual([
      ['coins', 'claim', null, 120, null, null, null, 'player'],
      ['credits', 'admin', 'deduct', -20, 90, 70, 'duplicate grant', 'ADMQ0001'],
      ['coins', 'admin', 'grant', 500, 120, 620, 'tournament prize', 'ADMQ0001'], // the audit row, not the coin_journal twin
      ['coins', 'earn', null, 10, null, null, null, 'player'],
    ]);
    expect(JSON.stringify(r)).not.toContain('detail-body'); // the raw detail never leaves
    expect(JSON.stringify(r)).not.toContain('someone else');
  });

  it('filters by currency and refuses a bad one', async () => {
    const k = await withHistory();
    expect((await rows(k, '?currency=credits')).rows.map((x) => x.reason)).toEqual(['duplicate grant']);
    expect((await rows(k, '?currency=coins')).rows).toHaveLength(3);
    expect((await k.get('/stats/api/members/K7Q2ABCD/journal?currency=gold')).status).toBe(400);
    expect((await k.get('/stats/api/members/K7Q2ABCD/journal?before=junk')).status).toBe(400);
    expect((await k.get('/stats/api/members/ZZZZ9999/journal')).status).toBe(404);
  });

  it('pages 50 at a time with a stable cursor, including rows that share a timestamp', async () => {
    const k = await seeded();
    for (let i = 0; i < 130; i++) {
      // Three rows to every timestamp, coin and admin side mixed.
      const at = NOW - 10_000 - Math.floor(i / 3);
      await k.db.prepare("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'earn', 1, '{}', ?2)").bind(at, `c${i}`).run();
      if (i % 2 === 0) await k.db.prepare("INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id) VALUES (?1, 'adm', 'm1', 'coins', 'grant', 1, 0, 1, 'page test', ?2)").bind(at, `a${i}`).run();
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { rows: Row[]; next: string | null } = await rows(k, cursor === null ? '' : `?before=${cursor}`);
      expect(page.rows.length).toBeLessThanOrEqual(50);
      for (const r of page.rows) seen.push(`${r.opId}`);
      cursor = page.next;
      pages++;
    } while (cursor !== null && pages < 10);
    // 130 earn rows + 65 admin rows + the seeded claim row (the seed member's 'claim'), each exactly once.
    expect(seen).toHaveLength(130 + 65 + 1);
    expect(new Set(seen).size).toBe(seen.length);
    expect(pages).toBe(4);
  });
});

describe('the read day cap (S3, D10)', () => {
  it('500 counted reads a day, then 429, and a refused card logs no view', async () => {
    const k = await seeded();
    await k.db.prepare("INSERT INTO rate_day VALUES ('admin-reads', '', ?1, 500)").bind(Math.floor(NOW / DAY)).run();
    expect((await k.get('/stats/api/members/find?q=sandstorm')).status).toBe(429);
    expect((await k.get('/stats/api/members/K7Q2ABCD')).status).toBe(429);
    expect((await k.get('/stats/api/members/K7Q2ABCD/journal')).status).toBe(429);
    expect(await views(k.db)).toEqual([]);
    expect((await k.get('/stats/api/members/whoami')).status).toBe(200); // whoami does not count
  });

  it('each find, card and journal spends one', async () => {
    const k = await seeded();
    await k.get('/stats/api/members/find?q=sandstorm');
    await k.get('/stats/api/members/K7Q2ABCD');
    await k.get('/stats/api/members/K7Q2ABCD/journal');
    await k.get('/stats/api/members/find?q=ab'); // refused before it counts (400)
    expect((await k.db.prepare("SELECT n FROM rate_day WHERE scope = 'admin-reads'").first<{ n: number }>())?.n).toBe(3);
  });

  it('reads stay available while the writes are closed', async () => {
    const k = await seeded();
    await k.db.prepare("DELETE FROM flags WHERE name = 'admin'").run();
    expect((await k.get('/stats/api/members/K7Q2ABCD')).status).toBe(200);
  });
});

describe('the lookups never read env.DB (S3, D4)', () => {
  it('every read route succeeds with DB undefined', async () => {
    const k = adminKit({ noDb: true });
    await addMember(k.db, { id: 'm1', publicId: 'K7Q2ABCD', name: 'Sandstorm', free: 1, brigade: { version: 1, balance: 1, grants: [] } });
    const game = await gameCookie(k.db, 'm1');
    for (const p of ['/stats/api/members/whoami', '/stats/api/members/find?q=K7Q2ABCD', '/stats/api/members/find?q=me', '/stats/api/members/K7Q2ABCD', '/stats/api/members/K7Q2ABCD/journal']) {
      expect((await k.call('GET', p, { game })).status, p).toBe(200);
    }
  });
});

describe('the audit table is append-only (S3, D9.5)', () => {
  const SRC = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = dir + '/' + n;
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') && !/(^|\/)(test-kit|kit|test-d1)\.ts$/.test(p) ? [p] : [];
    });

  it('only admin-write.ts inserts, and nothing updates or deletes a row but the member tables list', () => {
    for (const f of files(SRC)) {
      const text = readFileSync(f, 'utf8');
      const rel = f.slice(SRC.length + 1);
      if (rel !== 'admin/admin-write.ts') expect(text, rel).not.toMatch(/INSERT\s+(OR\s+\w+\s+)?INTO\s+admin_action/i);
      expect(text, rel).not.toMatch(/UPDATE\s+admin_action/i);
      if (rel !== 'account/tables.ts') expect(text, rel).not.toMatch(/DELETE\s+FROM\s+admin_action/i);
    }
    // The scan can see the writer: a vacuous pass would read zero files.
    expect(readFileSync(SRC + '/admin/admin-write.ts', 'utf8')).toMatch(/INSERT INTO admin_action/);
    expect(files(SRC).length).toBeGreaterThan(40);
  });

  it('no admin file writes to the telemetry or member data: no UPDATE or DELETE of anything but the flag', () => {
    const code = (f: string) => readFileSync(SRC + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const text = code('/admin/api.ts') + code('/admin/gate.ts');
    expect(text.replace(/DO UPDATE SET/g, '')).not.toMatch(/\b(UPDATE|DELETE)\b/); // the one upsert is the flag's
    expect(text).not.toMatch(/env\.DB\b/);
  });
});
