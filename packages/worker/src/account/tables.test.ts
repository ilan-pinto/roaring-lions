import { describe, expect, it } from 'vitest';
import { MEMBER_TABLES, MATCH_ORPHAN_SWEEP_SQL, deleteStatements } from './tables';
import { accountHarness, memberTablesInMigration, seedFullMember } from './test-kit';
import { memoryKV } from './kv';

describe('the accounts table map', () => {
  it('every member table is mapped (A1-8)', () => {
    const found = memberTablesInMigration();
    // Excluded by name, none of them has a member_id column:
    //  - rate_day: per-day counters keyed by scope/IP hash, no member_id column (plan 0.8); the one scope keyed by the member id
    //    ('acct-ops', 'acct-claim') are deleted by RATE_DAY_SQL in the delete batch, and delete.test.ts asserts it is gone;
    //  - flags: the lead's switches, no member;
    //  - match_record: a match, not a person; swept by MATCH_ORPHAN_SWEEP_SQL when no member seat is left.
    for (const n of ['rate_day', 'flags', 'match_record']) expect(found.has(n)).toBe(false);
    expect(found.size).toBeGreaterThanOrEqual(13);
    expect(found).toEqual(new Set(MEMBER_TABLES.map((t) => t.table)));
  });

  // A1-8 sees a missing TABLE, not a missing COLUMN (the design review). A column added to profile that the export does not
  // select goes red here; member_id is the key and is excluded by name.
  it('the profile export selects every profile column the migrations create (column-level A1-8)', async () => {
    const h = accountHarness();
    const cols = (await h.db.prepare("SELECT name FROM pragma_table_info('profile')").all<{ name: string }>()).results.map((r) => r.name);
    expect(cols).toContain('avatar');
    expect(cols).toContain('avatar_rev');
    await h.db.prepare("INSERT INTO member VALUES ('m1','PUB12345','h1','u1',1,1)").run();
    await h.db.prepare("INSERT INTO profile (member_id, display_name, updated_at) VALUES ('m1','x',1)").run();
    const sql = MEMBER_TABLES.find((t) => t.table === 'profile')?.exportSql ?? '';
    const row = (await h.db.prepare(sql).bind('m1').first<Record<string, unknown>>()) ?? {};
    expect(Object.keys(row).sort()).toEqual(cols.filter((c) => c !== 'member_id').sort());
  });

  it('deletes child-first with member last and sweeps match records after the seats', () => {
    expect(MEMBER_TABLES[MEMBER_TABLES.length - 1]?.table).toBe('member');
    const sql = deleteStatements().map((s) => s.sql);
    const seat = sql.findIndex((s) => s.startsWith('UPDATE match_seat'));
    expect(sql[seat + 1]).toBe(MATCH_ORPHAN_SWEEP_SQL);
    expect(sql[sql.length - 1]).toBe('DELETE FROM member WHERE id = ?1');
  });

  // A1-9: a row in EVERY table, foreign keys on and off. With them off a forgotten table leaves rows; with them on it
  // makes the `member` delete throw. Either way a table missing from MEMBER_TABLES goes red here.
  it.each([false, true])('every statement in the map runs against the migration and leaves no row (A1-9, foreignKeys %s)', async (foreignKeys) => {
    const h = accountHarness({ foreignKeys });
    const now = 1_000_000;
    await seedFullMember(h.db, now);
    const count = async (t: string, col: string): Promise<number> =>
      (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = 'm1'`).first<{ n: number }>())?.n ?? -1;
    const tables = [...memberTablesInMigration()];
    for (const t of tables) expect(await count(t, t === 'member' ? 'id' : 'member_id'), `${t} is seeded`).toBeGreaterThan(0);
    for (const t of MEMBER_TABLES) {
      if (t.exportSql !== null) expect((await h.db.prepare(t.exportSql).bind('m1').all()).results.length, `${t.table} exports`).toBeGreaterThan(0);
    }
    for (const s of deleteStatements()) await (s.bindsMember ? h.db.prepare(s.sql).bind('m1') : h.db.prepare(s.sql)).run();
    for (const t of tables) expect(await count(t, t === 'member' ? 'id' : 'member_id'), `${t} is empty`).toBe(0);
  });
});

describe('the harness (A1-9)', () => {
  it('foreignKeys false really is off, and true really is on', async () => {
    const orphan = (fk: boolean) =>
      accountHarness({ foreignKeys: fk }).db.prepare("INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES ('nobody','x',0,1)").run();
    await orphan(false);
    await expect(orphan(true)).rejects.toThrow();
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
