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

/** Only the frames that carried commands, plus the last tick: an empty frame is implied by its absence. */
export function compactLog(frames: readonly Frame[]): { last: number; orders: Frame[] } {
  return { last: frames.length === 0 ? -1 : frames[frames.length - 1].tick, orders: frames.filter((f) => f.cmds.length > 0) };
}

const INSERT_SQL = 'INSERT OR IGNORE INTO match_desync (code, tick, hash_a, hash_b, config, frames, frame_count, created_at) VALUES (?,?,?,?,?,?,?,?)';

/** One row. A second write for the same (code, tick) is ignored, not an error. */
export async function writeDesync(db: D1Like, rec: DesyncRecord): Promise<void> {
  await db.prepare(INSERT_SQL).bind(rec.code, rec.tick, rec.hashA, rec.hashB, rec.config, rec.frames, rec.frameCount, rec.createdAt).run();
}
