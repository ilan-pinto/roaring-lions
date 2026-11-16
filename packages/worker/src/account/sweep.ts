/** The daily account cron (GH-1075 A1): expiries, 36-month idle deletion, and tombstone reconciliation. */
import type { D1Like } from '../d1';
import { RATE_DAY_PURGE_SQL, dayOf } from '../rate-day';
import { OP_TTL_MS, PENDING_TTL_MS, TOMB_TTL_S } from './config';
import { DUE_MEMBERS_MAX, deleteDueStatements, type DueMember } from './delete';
import type { KVLike } from './kv';
import { deleteStatements } from './tables';

/**
 * GH-1432: what one run may cost, counted PER STATEMENT. The Free plan allows 50 D1 queries per Worker invocation, and every sweep
 * `scheduled()` runs shares them (the sum is pinned by `cron-budget.test.ts`). Whether a `batch()` is one query or one per statement
 * could not be confirmed from Cloudflare's limits page in the session that wrote this, so each statement is counted: a member's delete
 * is 17 statements, and the cron therefore deletes every member of a run in ONE guarded batch (`deleteDueStatements`), whoever found it.
 *
 * The account share of a run, at worst: the expiry batch, the idle select, `RECONCILE_PAGES` page selects, the one delete batch, and one
 * survivor select when a guard held. What does not fit waits a day, oldest first: nothing is dropped, only deferred.
 */
const EXPIRY_STATEMENTS = 5;
/** A member with no sign-in for this many days is deleted (spec A4-4: "36 months"). */
export const MEMBER_IDLE_DAYS = 1095;
/** Idle members a run deletes at most; the rest of `DUE_MEMBERS_MAX` is the reconciler's. */
export const SWEEP_MEMBERS_PER_RUN = 20;
/** Tombstone listing pages a run reads, ONE D1 select each (a page holds `IN_CHUNK` keys; D1 allows 100 bound variables a statement). */
export const RECONCILE_PAGES = 3;
/** Tombstones acted on (pruned or queued for deletion) per run at most. Pruning costs no D1 query, so this cap bounds it. */
export const RECONCILE_PER_RUN = 40;
export const RECONCILE_CURSOR_KEY = 'reconcile:cursor';
const RECONCILE_CURSOR_TTL_S = 7 * 86_400;
const IN_CHUNK = 90;
/** The account cron's worst case in D1 statements: what `cron-budget.test.ts` adds to the telemetry shares. */
export const ACCOUNT_CRON_STATEMENTS = EXPIRY_STATEMENTS + 1 + RECONCILE_PAGES + deleteStatements().length + 1;

interface Due extends DueMember { idHash: string }

/** The five expiry deletes (ONE batch), then the idle members, oldest first, each tombstoned before it is queued (a restore re-applies
 *  the tombstone). A member whose tombstone could not be written is not queued: it waits for the next run. */
async function expireAndFindIdle(db: D1Like, now: number, kv: KVLike, fail: (err: unknown) => void): Promise<Due[]> {
  const expiry = [
    db.prepare('DELETE FROM session WHERE expires_at <= ?1 OR absolute_at <= ?1').bind(now),
    db.prepare('DELETE FROM auth_challenge WHERE expires_at <= ?1').bind(now),
    db.prepare("DELETE FROM member_identity WHERE state = 'pending' AND created_at < ?1").bind(now - PENDING_TTL_MS),
    db.prepare('DELETE FROM account_op WHERE at < ?1').bind(now - OP_TTL_MS),
    db.prepare(RATE_DAY_PURGE_SQL).bind(dayOf(now) - 1),
  ];
  if (expiry.length !== EXPIRY_STATEMENTS) throw new Error('EXPIRY_STATEMENTS is stale');
  await db.batch(expiry);
  const cutoff = dayOf(now) - MEMBER_IDLE_DAYS - 1;
  const idle = await db
    .prepare('SELECT id, id_hash FROM member WHERE last_seen_day <= ?1 ORDER BY last_seen_day LIMIT ?2')
    .bind(cutoff, SWEEP_MEMBERS_PER_RUN)
    .all<{ id: string; id_hash: string }>();
  const due: Due[] = [];
  for (const m of idle.results) {
    try {
      await kv.put('tomb:' + m.id_hash, JSON.stringify({ deletedAt: now, lastSeenDay: cutoff }), { expirationTtl: TOMB_TTL_S });
      due.push({ id: m.id, idHash: m.id_hash, day: cutoff });
    } catch (err) {
      fail(err); // one member's failure must not keep the next one's deletion
    }
  }
  return due;
}

interface Scan { due: Due[]; save: () => Promise<void> }

/** Reads up to `RECONCILE_PAGES` pages of tombstones from the saved cursor, prunes a tombstone whose deletion a later sign-in cancelled,
 *  and queues each member whose deletion a tombstone records (up to `room`, skipping ids in `known`). Most tombstones are DEAD ones, kept
 *  for `gone` after their member is deleted, so a page can find nothing: the scan is RESUMABLE through `RECONCILE_CURSOR_KEY` (not under
 *  `tomb:`), and a finished listing starts over. When a page is cut short, the cursor stays on it, so its remaining keys are read again. */
async function scanTombstones(db: D1Like, kv: KVLike, room: number, known: ReadonlySet<string>, fail: (err: unknown) => void): Promise<Scan> {
  const due: Due[] = [];
  let acted = 0;
  const saved = await kv.get(RECONCILE_CURSOR_KEY);
  let cursor: string | undefined = saved ?? undefined;
  let finished = false;
  for (let pages = 0; pages < RECONCILE_PAGES && acted < RECONCILE_PER_RUN && due.length < room; pages++) {
    const page = await kv.list({ prefix: 'tomb:', cursor, limit: IN_CHUNK });
    const hashes = page.keys.map((k) => k.name.slice('tomb:'.length));
    let complete = true;
    if (hashes.length > 0) {
      const found = await db
        .prepare(`SELECT id, id_hash, last_seen_day FROM member WHERE id_hash IN (${hashes.map((_, j) => `?${j + 1}`).join(',')}) ORDER BY id_hash`)
        .bind(...hashes)
        .all<{ id: string; id_hash: string; last_seen_day: number }>();
      for (const m of found.results) {
        if (known.has(m.id)) continue;
        if (acted >= RECONCILE_PER_RUN || due.length >= room) {
          complete = false;
          break;
        }
        acted++;
        try {
          const raw = await kv.get('tomb:' + m.id_hash);
          if (raw === null) continue;
          const day = (JSON.parse(raw) as { lastSeenDay?: unknown }).lastSeenDay;
          if (typeof day !== 'number') continue;
          if (m.last_seen_day > day) await kv.delete('tomb:' + m.id_hash);
          else due.push({ id: m.id, idHash: m.id_hash, day });
        } catch (err) {
          fail(err);
        }
      }
    }
    if (!complete) break; // the cursor stays on this page
    if (page.list_complete || page.cursor === undefined) {
      finished = true;
      break;
    }
    cursor = page.cursor;
  }
  const save = async (): Promise<void> => {
    if (finished) await kv.delete(RECONCILE_CURSOR_KEY);
    else if (cursor !== saved && cursor !== undefined) await kv.put(RECONCILE_CURSOR_KEY, cursor, { expirationTtl: RECONCILE_CURSOR_TTL_S });
  };
  return { due, save };
}

/** Deletes every queued member in ONE guarded batch, then, only when a guard held someone back, ONE select for the survivors, whose
 *  tombstone is pruned when a sign-in came after it (so `gone` never calls a live account deleted). Returns the members deleted. */
async function deleteDue(db: D1Like, kv: KVLike, due: readonly Due[]): Promise<number> {
  if (due.length === 0) return 0;
  const out = await db.batch(deleteDueStatements(db, due));
  // `member` is the last statement: its change count is the members deleted. D1's batch result carries `meta.changes`; the node:sqlite
  // test double's `run()` result carries `changes`.
  const last = out[out.length - 1] as { meta?: { changes?: number }; changes?: number | bigint } | undefined;
  if (Number(last?.meta?.changes ?? last?.changes ?? 0) === due.length) return due.length;
  const left = await db
    .prepare(`SELECT id, last_seen_day FROM member WHERE id IN (${due.map((_, j) => `?${j + 1}`).join(',')})`)
    .bind(...due.map((d) => d.id))
    .all<{ id: string; last_seen_day: number }>();
  for (const m of left.results) {
    const d = due.find((x) => x.id === m.id);
    if (d !== undefined && m.last_seen_day > d.day) await kv.delete('tomb:' + d.idHash);
  }
  return due.length - left.results.length;
}

/** The whole account cron, as `scheduled()` runs it: expiries and idle members, then the tombstone scan (which runs even if the first
 *  part failed), then ONE delete batch for everyone either found. The scan's cursor moves on only once that batch has committed, so a
 *  failed batch is retried from the same page tomorrow. The first failure is rethrown at the end. Returns the members deleted. */
export async function accountCron(db: D1Like, now: number, kv: KVLike): Promise<number> {
  let failure: unknown;
  const fail = (err: unknown): void => { failure ??= err; };
  let due: Due[] = [];
  try {
    due = await expireAndFindIdle(db, now, kv, fail);
  } catch (err) {
    fail(err);
  }
  let scan: Scan | undefined;
  try {
    scan = await scanTombstones(db, kv, DUE_MEMBERS_MAX - due.length, new Set(due.map((d) => d.id)), fail);
    due = due.concat(scan.due);
  } catch (err) {
    fail(err);
  }
  let done = 0;
  try {
    done = await deleteDue(db, kv, due);
    await scan?.save().catch(fail); // a lost cursor only restarts the scan from the top tomorrow
  } catch (err) {
    fail(err);
  }
  if (failure !== undefined) throw failure;
  return done;
}

/** Expiries and idle members only (one delete batch). */
export async function sweepAccounts(db: D1Like, now: number, kv: KVLike): Promise<void> {
  let failure: unknown;
  const due = await expireAndFindIdle(db, now, kv, (err) => { failure ??= err; });
  await deleteDue(db, kv, due);
  if (failure !== undefined) throw failure;
}

/** Finishes every deletion a tombstone records, and prunes a tombstone whose deletion a later sign-in cancelled. Only a key whose member
 *  still exists is acted on. Returns how many members it deleted; a failure on one key does not stop the others and is rethrown. */
export async function reconcileTombstones(db: D1Like, kv: KVLike): Promise<number> {
  let failure: unknown;
  const scan = await scanTombstones(db, kv, DUE_MEMBERS_MAX, new Set(), (err) => { failure ??= err; });
  const done = await deleteDue(db, kv, scan.due);
  await scan.save().catch((err: unknown) => { failure ??= err; });
  if (failure !== undefined) throw failure;
  return done;
}
