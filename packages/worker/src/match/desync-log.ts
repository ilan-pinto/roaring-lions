/**
 * A desync's evidence (N1b, network design §3.4). When the two seats report
 * different hashes for one tick the room voids the match; this is what it
 * leaves behind for a human to replay: the match config and every frame that
 * carried an order, which is all a deterministic replay needs (an empty frame
 * is implied by its absence). One row per desynced match, none in a healthy
 * one, so it costs the Workers Free row budget nothing a running match does.
 */
import type { Frame } from '@lions/net';
import type { D1Like } from '../d1';
import { RETENTION_MS } from '../feedback-triage';

export interface DesyncRecord {
  code: string; tick: number; hashA: number; hashB: number;
  /** `JSON.stringify(MatchConfig)`. */
  config: string;
  /** `JSON.stringify(compactLog(frames))`. */
  frames: string;
  /** How many frames the room had minted, empty ones included. */
  frameCount: number;
  createdAt: number;
}

/**
 * The bound on the `frames` column. D1 rejects a row or string over 2 MB, and
 * a long match's order log would pass that, so the NEWEST orders are kept
 * (`compactLog`). 256,000 characters (#559 M-2, was 1.5 MB) is still ~4,000
 * honest orders before the desync -- far more than a replay needs to find a
 * divergence -- and keeps one row small against the daily `DESYNC_BUDGET`.
 */
export const MAX_FRAMES_JSON_CHARS = 256_000;
/**
 * #559 M-2: what desync rows may add to D1 in a day, whatever their count of
 * rooms. A desync is a bug report, one a match; any visitor can start a match,
 * so without a ceiling a script could fill the database the telemetry shares.
 * Past either bound the row is not written (and the room says so in the log).
 */
export const DESYNC_BUDGET = { rowsPerDay: 50, charsPerDay: 4_000_000 } as const;
const DAY_MS = 86_400_000;

export interface CompactLog {
  last: number;
  orders: Frame[];
  /** Present only when the cap forced the OLDEST order-bearing frames out: how many. */
  dropped?: number;
}

/**
 * Only the frames that carried commands, plus the last tick: an empty frame is
 * implied by its absence. When the JSON would exceed `cap` characters the
 * OLDEST order-bearing frames are dropped (the newest are nearest the desync)
 * and `dropped` says how many, so a truncated record is never mistaken for a
 * complete one; the row's `frame_count` still carries the true frame count.
 * The result's JSON always fits `cap` (a cap below the wrapper's own size
 * keeps no orders).
 */
export function compactLog(frames: readonly Frame[], cap = MAX_FRAMES_JSON_CHARS): CompactLog {
  const last = frames.length === 0 ? -1 : frames[frames.length - 1].tick;
  const orders = frames.filter((f) => f.cmds.length > 0);
  if (JSON.stringify({ last, orders }).length <= cap) return { last, orders };
  // The wrapper with its largest possible `dropped` and no orders: what the frames must leave room for.
  const budget = cap - JSON.stringify({ last, dropped: orders.length, orders: [] }).length;
  let used = 0;
  let keep = orders.length;
  while (keep > 0) {
    const size = JSON.stringify(orders[keep - 1]).length + 1;   // + the comma
    if (used + size > budget) break;
    used += size;
    keep--;
  }
  return { last, dropped: keep, orders: orders.slice(keep) };
}

const INSERT_SQL = 'INSERT OR IGNORE INTO match_desync (code, tick, hash_a, hash_b, config, frames, frame_count, created_at) VALUES (?,?,?,?,?,?,?,?)';

/** One row, if the day's `DESYNC_BUDGET` has room for it; false when it does
 *  not. A second write for the same (code, tick) is ignored, not an error.
 *  The day is the 24 hours before `createdAt`: a scan of a table that holds
 *  at most 50 rows a day for 180 days, read once per desync. */
export async function writeDesync(db: D1Like, rec: DesyncRecord): Promise<boolean> {
  const day = await db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(config) + length(frames)), 0) AS chars FROM match_desync WHERE created_at > ?')
    .bind(rec.createdAt - DAY_MS)
    .first<{ n: number; chars: number }>();
  const n = day?.n ?? 0;
  const chars = day?.chars ?? 0;
  if (n >= DESYNC_BUDGET.rowsPerDay || chars + rec.config.length + rec.frames.length > DESYNC_BUDGET.charsPerDay) return false;
  await db.prepare(INSERT_SQL).bind(rec.code, rec.tick, rec.hashA, rec.hashB, rec.config, rec.frames, rec.frameCount, rec.createdAt).run();
  return true;
}

/**
 * Retention (N1b final fix wave, M-6): a desync row is deleted 180 days after
 * it was written -- the feedback tables' own `RETENTION_MS`, on the same daily
 * Cron Trigger (`index.ts`'s `scheduled`). The row holds player-typed
 * callsigns inside `config`, and evidence that old has long served its
 * replay. Returns the rows deleted. No index on `created_at`: the table holds
 * one row per desynced match, so the scan reads a handful of rows a day.
 */
export async function purgeDesyncs(db: D1Like, now: number): Promise<number> {
  const gone = await db.prepare('DELETE FROM match_desync WHERE created_at < ? RETURNING code').bind(now - RETENTION_MS).all<{ code: string }>();
  return gone.results.length;
}
