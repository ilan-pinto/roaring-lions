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
 * a long match's order log would pass that (a frame can hold dozens of
 * commands; an hour at ~2 orders a second is megabytes), so the evidence
 * would be lost exactly when a long match desyncs. 1.5 MB of JSON text leaves
 * the config, the other columns and any multi-byte slack well inside the limit
 * (commands are numbers and ASCII keys, so characters are bytes in practice).
 */
export const MAX_FRAMES_JSON_CHARS = 1_500_000;

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

/** One row. A second write for the same (code, tick) is ignored, not an error. */
export async function writeDesync(db: D1Like, rec: DesyncRecord): Promise<void> {
  await db.prepare(INSERT_SQL).bind(rec.code, rec.tick, rec.hashA, rec.hashB, rec.config, rec.frames, rec.frameCount, rec.createdAt).run();
}
