/** The idempotency log (GH-1075 A1): a write carries an `op_id`, and a retry gets the first answer back. */
import type { D1Like, D1Stmt } from '../d1';

const OP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validOpId(v: unknown): v is string {
  return typeof v === 'string' && OP_ID.test(v);
}

/** Thrown by `withOp` for a malformed op id (the route answers 400). */
export class OpIdError extends Error {}

/** Thrown from a `build` callback to refuse with a status and body. Nothing is written and nothing is logged. */
export class OpReject extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`rejected ${status}`);
  }
}

async function stored(db: D1Like, memberId: string, opId: string): Promise<{ response: string } | null> {
  return db
    .prepare('SELECT response FROM account_op WHERE member_id = ?1 AND op_id = ?2')
    .bind(memberId, opId)
    .first<{ response: string }>();
}

/**
 * Runs a write once per `(memberId, opId)`. A stored response is returned as it is. Otherwise `build` makes the
 * statements, which run with the `account_op` insert in ONE batch.
 *
 * Two requests with one op id can both miss the lookup. The second batch fails on `account_op`'s primary key and D1
 * rolls it back whole, so `withOp` re-reads the committed response and returns that. Any other error, or a re-read
 * that finds nothing, is rethrown. Never use this on a route whose response carries a secret or a `Set-Cookie` (§0.23):
 * the response is stored.
 */
export async function withOp(
  db: D1Like,
  memberId: string,
  opId: string,
  kind: string,
  now: number,
  build: () => Promise<{ statements: D1Stmt[]; response: unknown }>,
): Promise<unknown> {
  if (!validOpId(opId)) throw new OpIdError('bad op id');
  const hit = await stored(db, memberId, opId);
  if (hit !== null) return JSON.parse(hit.response) as unknown;
  const { statements, response } = await build();
  const insert = db
    .prepare('INSERT INTO account_op (member_id, op_id, kind, at, response) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(memberId, opId, kind, now, JSON.stringify(response));
  try {
    await db.batch([...statements, insert]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/constraint|unique|primary key/i.test(msg)) throw err;
    const won = await stored(db, memberId, opId);
    if (won === null) throw err;
    return JSON.parse(won.response) as unknown;
  }
  return response;
}
