/** Member helpers (GH-1075 A1). Only the switch lives here so far. */
import type { D1Like } from '../d1';

/** True only for `flags.accounts` = 'open'. A missing row, or any other value, is CLOSED. */
export async function accountsOpen(db: D1Like): Promise<boolean> {
  const row = await db.prepare(`SELECT value FROM flags WHERE name = 'accounts'`).first<{ value: string }>();
  return row !== null && row.value === 'open';
}
