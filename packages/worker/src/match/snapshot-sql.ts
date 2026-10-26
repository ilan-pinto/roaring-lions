/** The SQL the room's snapshot row speaks, spelled once: `MatchRoom` runs these
 *  strings and `fake-do.ts` recognises exactly these strings, so a drift in
 *  either is an "unsupported SQL" failure in a test rather than a silent
 *  difference. One row per room (`id = 0`), replaced on each accepted snapshot
 *  and deleted with the rest of the object. */
export const SNAP_CREATE_SQL = 'CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 0), frame_tick INTEGER NOT NULL, sha TEXT NOT NULL, digest INTEGER NOT NULL, bytes BLOB NOT NULL)';
export const SNAP_PUT_SQL = 'INSERT OR REPLACE INTO snapshot (id, frame_tick, sha, digest, bytes) VALUES (0, ?, ?, ?, ?)';
export const SNAP_TICK_SQL = 'SELECT frame_tick FROM snapshot WHERE id = 0';
export const SNAP_GET_SQL = 'SELECT frame_tick, sha, digest, bytes FROM snapshot WHERE id = 0';
/** The log from a tick: only the batches that start after the binding (the
 *  caller binds `from - BATCH_TICKS`, since a batch holds at most that many
 *  frames). */
export const LOG_FROM_SQL = 'SELECT first_tick, frames FROM batch WHERE first_tick > ? ORDER BY first_tick';
