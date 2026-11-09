/** A D1Like over node:sqlite, for tests only. D1 is SQLite, so the real
 *  migrations and the real queries run here unchanged. */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Like, D1Stmt } from './d1';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

/** `dir` defaults to the telemetry migrations; the accounts database passes its own. `foreignKeys: true`
 *  runs `PRAGMA foreign_keys = ON` first, as D1 does in production. `foreignKeys: false` runs `PRAGMA foreign_keys = OFF`:
 *  node:sqlite enforces foreign keys by default, so without it an "off" run would still cascade and could not catch a
 *  table a delete forgot. Left out, the driver's default stands, so the existing tests are unchanged. */
export function openTestD1(opts: { dir?: string; foreignKeys?: boolean } = {}): D1Like & { raw: DatabaseSync } {
  const dir = opts.dir ?? MIGRATIONS;
  const db = new DatabaseSync(':memory:');
  if (opts.foreignKeys !== undefined) db.exec(`PRAGMA foreign_keys = ${opts.foreignKeys ? 'ON' : 'OFF'}`);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(dir + f, 'utf8'));
  }
  const stmt = (sql: string, args: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    run: async () => db.prepare(sql).run(...(args as SQLInputValue[])),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as SQLInputValue[])) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...(args as SQLInputValue[])) as T | undefined) ?? null,
  });
  const runBatch = async (ss: D1Stmt[]): Promise<unknown[]> => {
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
  };
  // One connection, and `run()` yields between BEGIN and COMMIT: two concurrent batches would interleave (the second
  // BEGIN throws and its ROLLBACK aborts the first). D1 serialises a database's batches, so the harness does too.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: (ss) => {
      const run = tail.then(() => runBatch(ss));
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
