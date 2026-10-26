/**
 * A snapshot mismatch's evidence (snapshot S3, design §5.2). When the two seats
 * upload a snapshot for one tick and the bytes differ, or the bytes agree but
 * their header digest is not the one the seats agreed, the room refuses the
 * upload and reports it here. It never voids the match (D3): the lockstep hash
 * pair, not this, decides that. A row is a bug report about an encoder or a
 * caller, so it holds hashes and a tick, never the bytes.
 *
 * Rows are bounded twice: `SNAP_MISMATCH_PER_ROOM` per room instance (enforced by
 * the Durable Object) and `SNAP_MISMATCH_BUDGET` a day in all (enforced here), and
 * deleted after `RETENTION_MS` by the daily cron (`index.ts`'s `scheduled`).
 */
import type { D1Like } from '../d1';
import { RETENTION_MS } from '../feedback-triage';

export interface SnapMismatchRecord {
  code: string;
  /** The snapshot's frame tick. */
  tick: number;
  /** `sha`: the seats' inflated bytes differ. `digest`: same bytes, header digest differs from the agreed one. */
  kind: 'sha' | 'digest';
  shaA: string;
  shaB: string;
  /** The header's match digest (u32). */
  digest: number;
  createdAt: number;
}

/** How many mismatch rows one room instance may write. The Durable Object enforces it. */
export const SNAP_MISMATCH_PER_ROOM = 3;
/** What these rows may add to D1 in a day, whatever the number of rooms. Past it the row is not written. */
export const SNAP_MISMATCH_BUDGET = { rowsPerDay: 100 } as const;
const DAY_MS = 86_400_000;

const INSERT_SQL = 'INSERT OR IGNORE INTO match_snap_mismatch (code, tick, kind, sha_a, sha_b, digest, created_at) VALUES (?,?,?,?,?,?,?)';

/** One row, if the day's `SNAP_MISMATCH_BUDGET` has room for it; false when it does not.
 *  A second write for the same (code, tick) is ignored, not an error. The day is the
 *  24 hours before `createdAt`: a scan of a table that holds at most 100 rows a day
 *  for 180 days, read once per mismatch. */
export async function writeSnapMismatch(db: D1Like, rec: SnapMismatchRecord): Promise<boolean> {
  const day = await db
    .prepare('SELECT COUNT(*) AS n FROM match_snap_mismatch WHERE created_at > ?')
    .bind(rec.createdAt - DAY_MS)
    .first<{ n: number }>();
  if ((day?.n ?? 0) >= SNAP_MISMATCH_BUDGET.rowsPerDay) return false;
  await db.prepare(INSERT_SQL).bind(rec.code, rec.tick, rec.kind, rec.shaA, rec.shaB, rec.digest, rec.createdAt).run();
  return true;
}

/** Retention: a row is deleted `RETENTION_MS` (180 days) after it was written, on the
 *  daily Cron Trigger beside `purgeDesyncs`. Returns the rows deleted. */
export async function purgeSnapMismatches(db: D1Like, now: number): Promise<number> {
  const gone = await db.prepare('DELETE FROM match_snap_mismatch WHERE created_at < ? RETURNING code').bind(now - RETENTION_MS).all<{ code: string }>();
  return gone.results.length;
}
