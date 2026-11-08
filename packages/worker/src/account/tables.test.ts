import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MEMBER_TABLES, MATCH_ORPHAN_SWEEP_SQL, deleteStatements } from './tables';
import { ACCOUNTS_MIGRATIONS, accountHarness } from './test-kit';
import { memoryKV } from './kv';

const MIGRATION = readFileSync(ACCOUNTS_MIGRATIONS + '0001_members.sql', 'utf8');

/** Every table whose CREATE body declares a member_id column, plus `member` itself. */
function collectMemberTables(sql: string): Set<string> {
  const out = new Set<string>(['member']);
  // A statement runs to its semicolon; comments are stripped first so a `;` in prose cannot cut one short.
  const bare = sql.replace(/--.*$/gm, '');
  for (const m of bare.matchAll(/CREATE TABLE (\w+)\s*\(([^;]*);/g)) {
    if (/(^|[(,])\s*member_id\s+\w/.test(m[2] ?? '')) out.add(m[1] ?? '');
  }
  return out;
}

describe('the accounts table map', () => {
  it('every member table is mapped (A1-8)', () => {
    const found = collectMemberTables(MIGRATION);
    // Excluded by name, none of them has a member_id column:
    //  - rate_day: per-day counters keyed by scope/IP hash, no member (plan 0.8);
    //  - flags: the lead's switches, no member;
    //  - match_record: a match, not a person; swept by MATCH_ORPHAN_SWEEP_SQL when no member seat is left.
    for (const n of ['rate_day', 'flags', 'match_record']) expect(found.has(n)).toBe(false);
    expect(found.size).toBeGreaterThanOrEqual(13);
    expect(found).toEqual(new Set(MEMBER_TABLES.map((t) => t.table)));
  });

  it('deletes child-first with member last and sweeps match records after the seats', () => {
    expect(MEMBER_TABLES[MEMBER_TABLES.length - 1]?.table).toBe('member');
    const sql = deleteStatements().map((s) => s.sql);
    const seat = sql.findIndex((s) => s.startsWith('UPDATE match_seat'));
    expect(sql[seat + 1]).toBe(MATCH_ORPHAN_SWEEP_SQL);
    expect(sql[sql.length - 1]).toBe('DELETE FROM member WHERE id = ?1');
  });

  it('every statement in the map runs against the migration', async () => {
    const h = accountHarness({ foreignKeys: true });
    await h.db.prepare("INSERT INTO member VALUES ('m1','PUB12345','h1','u1',1,1)").run();
    for (const t of MEMBER_TABLES) {
      if (t.exportSql !== null) await h.db.prepare(t.exportSql).bind('m1').all();
    }
    for (const s of deleteStatements()) await (s.bindsMember ? h.db.prepare(s.sql).bind('m1') : h.db.prepare(s.sql)).run();
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM member').first<{ n: number }>()).toEqual({ n: 0 });
  });
});

describe('the schema fences', () => {
  const seed = async () => {
    const h = accountHarness({ foreignKeys: true });
    await h.db.prepare("INSERT INTO member VALUES ('m1','PUB12345','h1','u1',1,1)").run();
    await h.db.prepare("INSERT INTO member VALUES ('m2','PUB22222','h2','u2',1,1)").run();
    await h.db.prepare("INSERT INTO wallet (member_id, earn, earn_lifetime, entitlements, updated_at) VALUES ('m1','{}','{}','{}',1)").run();
    return h;
  };

  it("paid is fenced by the schema (A2-5's schema half)", async () => {
    const h = await seed();
    await expect(h.db.prepare("UPDATE wallet SET paid = 1 WHERE member_id = 'm1'").run()).rejects.toThrow();
    await expect(
      h.db.prepare("INSERT INTO coin_journal (member_id, at, kind, free_delta, paid_delta, detail, op_id) VALUES ('m1',1,'earn',5,1,'{}','o1')").run(),
    ).rejects.toThrow();
    // the same insert with paid_delta 0 is fine, so the throw above is the fence and not a typo
    await h.db.prepare("INSERT INTO coin_journal (member_id, at, kind, free_delta, paid_delta, detail, op_id) VALUES ('m1',1,'earn',5,0,'{}','o1')").run();
  });

  it('one steam per member, one member per steam', async () => {
    const h = await seed();
    const ins = (id: string, m: string, subject: string) =>
      h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES (?1,?2,'steam',?3,1)").bind(id, m, subject).run();
    await ins('i1', 'm1', '76561198000000001');
    await expect(ins('i2', 'm1', '76561198000000002')).rejects.toThrow();
    await expect(ins('i3', 'm2', '76561198000000001')).rejects.toThrow();
    await ins('i4', 'm2', '76561198000000002');
  });

  it('a pending identity must be a recovery code', async () => {
    const h = await seed();
    await expect(
      h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES ('i1','m1','steam','7656','pending',1)").run(),
    ).rejects.toThrow();
    await h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES ('i2','m1','recovery','hash','pending',1)").run();
  });
});

describe('memoryKV', () => {
  it('stores, lists by prefix and remembers the ttl', async () => {
    const kv = memoryKV();
    await kv.put('tomb:a', '{}', { expirationTtl: 7776000 });
    await kv.put('other', '1');
    expect(await kv.get('tomb:a')).toBe('{}');
    expect(await kv.get('nope')).toBeNull();
    expect((await kv.list({ prefix: 'tomb:' })).keys).toEqual([{ name: 'tomb:a' }]);
    expect(kv.ttl('tomb:a')).toBe(7776000);
    expect(kv.ttl('other')).toBeUndefined();
    await expect(memoryKV({ failPut: true }).put('k', 'v')).rejects.toThrow();
  });
});
