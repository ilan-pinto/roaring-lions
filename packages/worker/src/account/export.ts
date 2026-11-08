/** The member's own data as one JSON file (GH-1075 A1, spec §6.2). Driven from MEMBER_TABLES, so a table added there is exported. */
import type { D1Like } from '../d1';
import { accountJson } from './http';
import type { AccountCtx } from './routes';
import { requireSession, sessionJson } from './session';
import { MEMBER_TABLES } from './tables';

export interface AccountExport {
  format: 'roaring-lions-account';
  version: 1;
  /** One entry per exported table: its rows, as the columns `exportSql` selects. Never a key byte or a code hash. */
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportMember(db: D1Like, memberId: string): Promise<AccountExport> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of MEMBER_TABLES) {
    if (t.exportSql === null) continue;
    tables[t.table] = (await db.prepare(t.exportSql).bind(memberId).all<Record<string, unknown>>()).results;
  }
  return { format: 'roaring-lions-account', version: 1, tables };
}

/** GET export: a session, no budget, works while the switch is closed (§0.17). */
export async function exportAccount(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const data = await exportMember(db, got.session.memberId);
  const res = sessionJson(200, data, got.setCookie);
  res.headers.set('content-disposition', 'attachment; filename="roaring-lions-account.json"');
  return res;
}
