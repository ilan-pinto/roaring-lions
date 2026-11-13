import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canSignInCount, SIGN_IN_PROVIDERS } from './identity';
import { MEMBER_TABLES } from './tables';
import { ACCOUNTS_MIGRATIONS, accountHarness } from './test-kit';

// GH-1075 G1: 0002_google.sql rebuilds member_identity and auth_challenge.
const file = (n: string): string => readFileSync(ACCOUNTS_MIGRATIONS + n, 'utf8');
const COLS = 'id, member_id, provider, subject, state, public_key, sign_count, transports, backed_up, label, created_at, last_used_day';

function seeded(fk: boolean): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ${fk ? 'ON' : 'OFF'}`);
  db.exec(file('0001_members.sql'));
  db.exec("INSERT INTO member VALUES ('m1','PUB1','h1','u1',1,1), ('m2','PUB2','h2','u2',1,1)");
  db.exec(`INSERT INTO member_identity (id, member_id, provider, subject, state, public_key, sign_count, transports, backed_up, label, created_at, last_used_day) VALUES
    ('i1','m1','steam','76561197960287930','active',NULL,0,NULL,0,'Deck',11,12),
    ('i2','m1','passkey','cred-1','active',x'0A0B0C0D',7,'["usb","nfc"]',1,'Laptop',13,14),
    ('i3','m1','recovery','code-hash','pending',NULL,0,NULL,0,NULL,15,NULL),
    ('i4','m2','recovery','code-hash-2','active',NULL,0,NULL,0,NULL,16,17)`);
  return db;
}
const dump = (db: DatabaseSync): unknown[] => db.prepare(`SELECT ${COLS} FROM member_identity ORDER BY id`).all();

describe('0002_google.sql (G1)', () => {
  it.each([false, true])('keeps every member_identity row byte-identical (foreignKeys %s)', (fk) => {
    const db = seeded(fk);
    const before = dump(db);
    expect(before).toHaveLength(4);
    db.exec(file('0002_google.sql'));
    expect(dump(db)).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // the old indexes survive the rebuild, and the new one is there
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'member_identity'").all() as { name: string }[]).map((r) => r.name);
    for (const n of ['member_identity_member', 'member_identity_one_recovery', 'member_identity_one_steam', 'member_identity_one_google']) expect(idx).toContain(n);
  });

  it('a second Google row for one member is refused, one Google account per member', () => {
    const db = seeded(true);
    db.exec(file('0002_google.sql'));
    const ins = (id: string, m: string, sub: string) =>
      db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES (?1,?2,'google',?3,1)").run(id, m, sub);
    ins('g1', 'm1', '1000000000000000001');
    expect(() => ins('g2', 'm1', '1000000000000000002')).toThrow(/UNIQUE/);
    expect(() => ins('g3', 'm2', '1000000000000000001')).toThrow(/UNIQUE/);
    ins('g4', 'm2', '1000000000000000002');
  });

  it('the CHECKs are wider by exactly google, google-login and google-link', () => {
    const db = seeded(true);
    db.exec(file('0002_google.sql'));
    expect(() => db.exec("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES ('x','m1','discord','s',1)")).toThrow(/CHECK/);
    for (const p of ['google-login', 'google-link', 'steam-login']) db.exec(`INSERT INTO auth_challenge VALUES ('c-${p}','${p}',NULL,NULL,1)`);
    expect(() => db.exec("INSERT INTO auth_challenge VALUES ('bad','github-login',NULL,NULL,1)")).toThrow(/CHECK/);
  });

  it('deleting a member still cascades to its identity rows after the rebuild', () => {
    const db = seeded(true);
    db.exec(file('0002_google.sql'));
    db.exec("DELETE FROM member WHERE id = 'm1'");
    expect(db.prepare('SELECT COUNT(*) AS n FROM member_identity').get()).toEqual({ n: 1 });
  });
});

describe('Google in the sign-in list (G1)', () => {
  const T = 1_000;
  async function member(h: ReturnType<typeof accountHarness>): Promise<void> {
    await h.db.prepare("INSERT INTO member VALUES ('m1','PUB1','h1','u1',1,0)").run();
    await h.db.prepare("INSERT INTO profile VALUES ('m1','Callsign',0,1)").run();
  }
  const ident = (h: ReturnType<typeof accountHarness>, id: string, provider: string, subject: string) =>
    h.db.prepare('INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES (?1,\'m1\',?2,?3,?4)').bind(id, provider, subject, T).run();

  it('names google', () => {
    expect([...SIGN_IN_PROVIDERS]).toEqual(['passkey', 'steam', 'google']);
  });

  it('a Google+Steam member counts two ways in', async () => {
    const h = accountHarness({ now: T });
    await member(h);
    await ident(h, 'is', 'steam', '76561197960287930');
    await ident(h, 'ig', 'google', '1000000000000000001');
    expect(await canSignInCount(h.db, 'm1')).toBe(2);
    expect(await canSignInCount(h.db, 'm1', 'is')).toBe(1);
    expect(await canSignInCount(h.db, 'm1', 'ig')).toBe(1);
  });

  it('exports the Google sub as google_sub and nothing else keyed to it', async () => {
    const h = accountHarness({ now: T });
    await member(h);
    await ident(h, 'ig', 'google', 'SUB-SENTINEL-1');
    const t = MEMBER_TABLES.find((x) => x.table === 'member_identity');
    const rows = (await h.db.prepare(t?.exportSql ?? '').bind('m1').all<Record<string, unknown>>()).results;
    expect(rows[0]?.google_sub).toBe('SUB-SENTINEL-1');
    expect(rows[0]?.steam_id).toBeNull();
  });
});
