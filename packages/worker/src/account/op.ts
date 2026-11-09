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

/** What `account_op.response` holds: `{"s": status, "b": body}` (§0.33). An A1 row has no `s` and reads as 200. */
export interface OpAnswer {
  status: number;
  body: unknown;
}

function answerOf(text: string): OpAnswer {
  const v = JSON.parse(text) as unknown;
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const { s, b } = v as { s?: unknown; b?: unknown };
    if (typeof s === 'number' && 'b' in v) return { status: s, body: b };
  }
  return { status: 200, body: v };
}

/** The stored answer of `(memberId, opId)`, or null. Ignores `kind`, so a replay of a mission start still answers. */
export async function storedAnswer(db: D1Like, memberId: string, opId: string): Promise<OpAnswer | null> {
  const row = await db
    .prepare('SELECT response FROM account_op WHERE member_id = ?1 AND op_id = ?2')
    .bind(memberId, opId)
    .first<{ response: string }>();
  return row === null ? null : answerOf(row.response);
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stored body never holds a whole campaign (§0.33): any `CampaignView` in it becomes `{ revision, digest }`. */
export function reduceCampaigns(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reduceCampaigns);
  if (!isRec(v)) return v;
  if (typeof v.revision === 'number' && typeof v.digest === 'string' && 'ledger' in v && 'brigade' in v) {
    return { revision: v.revision, digest: v.digest };
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = reduceCampaigns(x);
  return out;
}

/**
 * Runs a write once per `(memberId, opId)`. A stored answer is returned as it is. Otherwise `build` makes the
 * statements, which run with the `account_op` insert in ONE batch; the insert stores `{"s": status, "b": body}`
 * with campaigns reduced. A `build` that returns a non-200 status with no statements still logs it, so a retry of a
 * stale write answers the same 409.
 *
 * Two requests with one op id can both miss the lookup. The second batch fails on `account_op`'s primary key and D1
 * rolls it back whole, so `withOp` re-reads the committed answer and returns that. Any other error (a CHECK that a
 * compare-and-swap guard tripped included), or a re-read that finds nothing, is rethrown for `budgetedOp` to judge.
 * Never use this on a route whose response carries a secret or a `Set-Cookie` (§0.23): the response is stored.
 */
export async function withOp(
  db: D1Like,
  memberId: string,
  opId: string,
  kind: string,
  now: number,
  build: () => Promise<{ statements: D1Stmt[]; status: number; response: unknown }>,
): Promise<OpAnswer> {
  if (!validOpId(opId)) throw new OpIdError('bad op id');
  const hit = await storedAnswer(db, memberId, opId);
  if (hit !== null) return hit;
  const { statements, status, response } = await build();
  const insert = db
    .prepare('INSERT INTO account_op (member_id, op_id, kind, at, response) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(memberId, opId, kind, now, JSON.stringify({ s: status, b: reduceCampaigns(response) }));
  try {
    await db.batch([...statements, insert]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/constraint|unique|primary key/i.test(msg)) throw err;
    const won = await storedAnswer(db, memberId, opId);
    if (won === null) throw err;
    return won;
  }
  return { status, body: response };
}
