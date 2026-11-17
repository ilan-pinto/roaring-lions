/**
 * The audit table's one writer (GH-695 D9.5). Only this file contains `INSERT INTO admin_action`; test
 * `admin-append-only` fails if any other file does, or if any file updates or deletes a row (a member's deletion
 * takes theirs through `MEMBER_TABLES`, which is the one place that may). It returns the statement and never runs
 * it: a change goes into the SAME batch as the balance it records (D9.1).
 */
import type { D1Like, D1Stmt } from '../d1';

export interface AdminActionRow {
  at: number;
  /** The acting admin's internal member id; null for a view by the stats password alone. */
  adminId: string | null;
  /** The member acted on; null for the switch. */
  memberId: string | null;
  action: 'coins' | 'credits' | 'switch' | 'view';
  mode?: 'grant' | 'deduct' | 'set' | null;
  delta?: number | null;
  before?: number | null;
  after?: number | null;
  reason?: string | null;
  opId?: string | null;
}

export function adminActionInsert(db: D1Like, r: AdminActionRow): D1Stmt {
  return db
    .prepare(
      `INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(r.at, r.adminId, r.memberId, r.action, r.mode ?? null, r.delta ?? null, r.before ?? null, r.after ?? null, r.reason ?? null, r.opId ?? null);
}
