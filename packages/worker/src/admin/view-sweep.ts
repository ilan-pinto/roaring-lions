/**
 * The 180-day sweep of `view` rows (GH-695 D14.2). A card opened is logged as an `admin_action` row of action 'view';
 * the daily cron deletes those older than the feedback retention. A change row (coins, credits, switch) is NEVER
 * touched here: it stays while the member does. This is the one file besides `account/tables.ts` that may contain
 * `DELETE FROM admin_action`, and the append-only source test requires the statement to name `action = 'view'`.
 */
import type { D1Like } from '../d1';

export const VIEW_RETENTION_MS = 180 * 86_400_000;

/** Deletes view rows with `at` strictly before `now - 180 days`; the cron ignores the count. */
export async function sweepAdminViews(db: D1Like, now: number): Promise<void> {
  await db.prepare("DELETE FROM admin_action WHERE action = 'view' AND at < ?1").bind(now - VIEW_RETENTION_MS).run();
}
