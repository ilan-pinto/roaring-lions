/** A D1Like over node:sqlite, for tests only. D1 is SQLite, so the real
 *  migrations and the real queries run here unchanged. */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Like, D1Stmt } from './d1';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

export function openTestD1(): D1Like & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(MIGRATIONS + f, 'utf8'));
  }
  const stmt = (sql: string, args: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    run: async () => db.prepare(sql).run(...(args as SQLInputValue[])),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as SQLInputValue[])) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...(args as SQLInputValue[])) as T | undefined) ?? null,
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (ss) => {
      db.exec('BEGIN');
      try {
        const out: unknown[] = [];
        for (const s of ss) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
