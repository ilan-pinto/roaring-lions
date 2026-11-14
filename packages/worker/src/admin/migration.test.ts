/** GH-695 S1: migration 0004_admin.sql. The coin_journal rebuild keeps every row byte for byte, and the new tables hold. */
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { exportMember } from '../account/export';
import { MEMBER_TABLES } from '../account/tables';
import { ACCOUNTS_MIGRATIONS, accountHarness, seedFullMember } from '../account/test-kit';

const migrations = readdirSync(ACCOUNTS_MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
const apply = (db: DatabaseSync, file: string): void => db.exec(readFileSync(ACCOUNTS_MIGRATIONS + file, 'utf8'));

describe('0004_admin: the coin_journal rebuild (S1)', () => {
  it('copies every row byte for byte, keeps the journal sum, and adds only the admin kind', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON'); // as D1: the rebuild must pass with foreign keys enforced
    expect(migrations.slice(0, 4)).toEqual(['0001_members.sql', '0002_google.sql', '0003_avatars.sql', '0004_admin.sql']);
    for (const f of migrations.slice(0, 3)) apply(db, f);
    db.exec("INSERT INTO member VALUES ('m1','PUB12345','h1','u1',1,1), ('m2','PUB22222','h2','u2',1,1)");
    db.exec(`INSERT INTO wallet (member_id, free, earn, earn_lifetime, entitlements, updated_at) VALUES ('m1', 0, '{}', '{}', '{}', 1), ('m2', 0, '{}', '{}', '{}', 1)`);
    const kinds = ['earn', 'backfill', 'claim', 'coupon', 'unit', 'tier', 'reset'];
    // A journal with gaps in its ids, a negative delta, an emoji and an escaped quote in `detail`: nothing may be normalised.
    kinds.forEach((kind, i) => {
      const delta = kind === 'unit' || kind === 'tier' || kind === 'reset' ? -(i + 1) : (i + 1) * 100;
      db.prepare('INSERT INTO coin_journal (id, member_id, at, kind, free_delta, paid_delta, detail, op_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
        .run(10 + i * 7, i % 2 === 0 ? 'm1' : 'm2', 1_700_000_000_000 + i, kind, delta, JSON.stringify({ k: kind, note: 'q"\u{1F981}' }), `op-${i}`);
    });
    const before = db.prepare('SELECT * FROM coin_journal ORDER BY id').all();
    const sumBefore = db.prepare('SELECT member_id, SUM(free_delta) AS s FROM coin_journal GROUP BY member_id ORDER BY member_id').all();
    expect(before).toHaveLength(7);

    apply(db, '0004_admin.sql');

    expect(db.prepare('SELECT * FROM coin_journal ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT member_id, SUM(free_delta) AS s FROM coin_journal GROUP BY member_id ORDER BY member_id').all()).toEqual(sumBefore);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'coin_journal'").all().map((r) => r.name);
    expect(idx).toContain('coin_journal_member');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'coin_journal_new'").all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const insert = (kind: string, paid = 0) =>
      db.prepare('INSERT INTO coin_journal (member_id, at, kind, free_delta, paid_delta, detail, op_id) VALUES (?, 1, ?, 1, ?, ?, ?)').run('m1', kind, paid, '{}', 'x');
    expect(() => insert('admin')).not.toThrow(); // the new kind
    expect(() => insert('bogus')).toThrow(); // the CHECK still bites
    expect(() => insert('earn', 1)).toThrow(); // paid_delta = 0 survived the rebuild
    // The id sequence continues after the largest copied id, so a new row never collides with an old receipt order.
    expect(db.prepare("SELECT id FROM coin_journal WHERE kind = 'admin'").get()?.id).toBe(10 + 6 * 7 + 1);
  });
});

describe('0004_admin: admin_member and admin_action (S1)', () => {
  const seed = async () => {
    const h = accountHarness({ foreignKeys: true });
    const run = (sql: string, ...v: unknown[]) => h.db.prepare(sql).bind(...v).run();
    await run("INSERT INTO member VALUES ('adm','ADMIN111','ha','ua',1,1)");
    await run("INSERT INTO member VALUES ('m1','PUB12345','h1','u1',1,1)");
    return { h, run };
  };

  it('admin_member is one row per member and goes with the member', async () => {
    const { h, run } = await seed();
    await run("INSERT INTO admin_member VALUES ('adm', 5)");
    await expect(run("INSERT INTO admin_member VALUES ('adm', 6)")).rejects.toThrow();
    await expect(run("INSERT INTO admin_member VALUES ('nobody', 6)")).rejects.toThrow(); // the foreign key bites
    await run("DELETE FROM member WHERE id = 'adm'");
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM admin_member').first<{ n: number }>())?.n).toBe(0);
  });

  it('admin_action checks its action and mode, cascades on the member and nulls the admin', async () => {
    const { h, run } = await seed();
    const ins = (action: string, mode: string | null = null) =>
      run("INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id) VALUES (1, 'adm', 'm1', ?1, ?2, 5, 0, 5, 'a reason', 'op')", action, mode);
    for (const a of ['coins', 'credits', 'switch', 'view']) await ins(a);
    for (const m of ['grant', 'deduct', 'set']) await ins('coins', m);
    await expect(ins('delete')).rejects.toThrow();
    await expect(ins('coins', 'steal')).rejects.toThrow();
    // A switch row is about no member.
    await run("INSERT INTO admin_action (at, admin_id, member_id, action) VALUES (2, 'adm', NULL, 'switch')");
    // Deleting the admin keeps what they did, with the admin id nulled (D9.6: it goes only with the MEMBER acted on).
    await run("DELETE FROM member WHERE id = 'adm'");
    const left = (await h.db.prepare('SELECT COUNT(*) AS n, COUNT(admin_id) AS withAdmin FROM admin_action').first<{ n: number; withAdmin: number }>());
    expect(left).toEqual({ n: 8, withAdmin: 0 });
    await run("DELETE FROM member WHERE id = 'm1'");
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM admin_action').first<{ n: number }>())?.n).toBe(1); // only the switch row
  });
});

describe('the member export of admin changes (S1, D9.6, D14.4)', () => {
  it('carries the change and the reason, says "admin" and never the admin id, and leaves the access log out', async () => {
    const h = accountHarness({ foreignKeys: true });
    await seedFullMember(h.db, 1_000);
    const run = (sql: string, ...v: unknown[]) => h.db.prepare(sql).bind(...v).run();
    await run("UPDATE member SET public_id = 'ADMINPUB' WHERE id = 'n1'"); // n1 (seeded) is the acting admin
    await run("INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id) VALUES (3, 'n1', 'm1', 'view', NULL, NULL, NULL, NULL, NULL, NULL)");
    await run("INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id) VALUES (4, 'n1', 'm1', 'credits', 'deduct', -3, 9, 6, 'refund of a duplicate', 'o3')");
    const out = await exportMember(h.db, 'm1');
    const rows = out.tables.admin_action ?? [];
    expect(rows.map((r) => r.action)).toEqual(['coins', 'credits']); // no 'view'
    expect(rows[1]).toMatchObject({ mode: 'deduct', delta: -3, before: 9, after: 6, reason: 'refund of a duplicate', by: 'admin' });
    const text = JSON.stringify(out);
    expect(text).not.toContain('n1');
    expect(text).not.toContain('ADMINPUB');
    expect(out.tables.admin_member).toBeUndefined(); // never exported
    expect(MEMBER_TABLES.find((t) => t.table === 'admin_member')?.exportSql).toBeNull();
  });
});
