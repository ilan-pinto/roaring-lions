/** The daily account cron (GH-1075 A1): expiries, 36-month idle deletion, and tombstone reconciliation. */
import type { D1Like } from '../d1';
import { RATE_DAY_PURGE_SQL, dayOf } from '../rate-day';
import { OP_TTL_MS, PENDING_TTL_MS, TOMB_TTL_S } from './config';
import { DUE_MEMBERS_MAX, deleteDueStatements, type DueMember } from './delete';
import type { KVLike } from './kv';
import { deleteStatements } from './tables';

/**
 * GH-1432: what one run may cost, counted PER STATEMENT. The Free plan allows 50 D1 queries per Worker invocation, and every sweep
 * `scheduled()` runs shares them (the sum is pinned by `cron-budget.test.ts`). The platform counts a `db.batch()` call as ONE query (D1's
 * limits page, the PM's reading, PR 1518); this code meters every statement of a batch on purpose, as a stricter budget than the
 * platform's, so a run that fits it fits the real limit with room to spare. Under that meter a member's delete is 17 statements, and the
 * cron therefore deletes every member of a run in ONE guarded batch (`deleteDueStatements`), whoever found it.
 *
 * The account share of a run, at worst: the expiry batch, the idle select, `RECONCILE_PAGES` page selects, the one delete batch, and one
 * survivor select when a guard held. What does not fit waits a day, oldest first: nothing is dropped, only deferred.
 *
 * GH-1530: the one batch is one transaction, so a member whose rows make it fail would hold every other member of it, run after run.
 * After `BATCH_FAIL_THRESHOLD` consecutive failed runs (`BATCH_FAIL_KEY`), a run deletes ONE member alone, the oldest. That costs the
 * same 17 statements as the shared batch, so it is all the delete share holds under this meter: one member a degraded run. A member
 * whose own delete fails is recorded (`FAILING_KEY`) and left out of the shared batch, so the next run deletes everyone else. The
 * fallback adds KV reads and writes only, no D1 statement, so `ACCOUNT_CRON_STATEMENTS` is unchanged.
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
/** GH-1530: consecutive runs whose shared delete batch failed, as a decimal string. Not under `tomb:`, so the scan never lists it. */
export const BATCH_FAIL_KEY = 'reconcile:batchfail';
const BATCH_FAIL_TTL_S = 7 * 86_400;
/** GH-1530: after this many consecutive failed runs, the next run deletes one member alone. Two, not three: the first failure is retried
 *  as it was (a transient D1 error, the realistic cause, clears by the next run), and a member whose rows really do fail then holds the
 *  others for two runs, not three. Entering the fallback by mistake costs little: that run deletes one member, and the next tries the
 *  shared batch again. */
export const BATCH_FAIL_THRESHOLD = 2;
/** GH-1530: members whose own delete failed, `{ [idHash]: day recorded }`. Not under `tomb:`. */
export const FAILING_KEY = 'reconcile:failing';
/** A failing member is left out of every batch for this many days, then retried ALONE (one run's batch); it never rejoins the shared one. */
export const FAILING_HOLD_DAYS = 7;
const FAILING_KEEP_DAYS = 30;
const FAILING_TTL_S = FAILING_KEEP_DAYS * 86_400;
const IN_CHUNK = 90;
/** The account cron's worst case in D1 statements: what `cron-budget.test.ts` adds to the telemetry shares. */
export const ACCOUNT_CRON_STATEMENTS = EXPIRY_STATEMENTS + 1 + RECONCILE_PAGES + deleteStatements().length + 1;

interface Due extends DueMember { idHash: string }

/** What a run tallies for its log line: tombstones that do not parse to a numeric day (GH-1530: the scan and the survivor step skip them
 *  alike). */
interface Tally { unreadable: number }

/** A tombstone's `lastSeenDay`, or undefined when the value does not parse or the day is not a number. */
function tombDay(raw: string): number | undefined {
  try {
    const day = (JSON.parse(raw) as { lastSeenDay?: unknown } | null)?.lastSeenDay;
    return typeof day === 'number' ? day : undefined;
  } catch {
    return undefined;
  }
}

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

/** `save(settled)` moves the cursor past each page read, in order, whose queued members are all in `settled`, and stops at the first one
 *  that is not. */
interface Scan { due: Due[]; save: (settled: ReadonlySet<string>) => Promise<void> }

const FINISHED = Symbol('finished');

/** Reads up to `RECONCILE_PAGES` pages of tombstones from the saved cursor, prunes a tombstone whose deletion a later sign-in cancelled,
 *  and queues each member whose deletion a tombstone records (up to `room`, skipping ids in `known`). Most tombstones are DEAD ones, kept
 *  for `gone` after their member is deleted, so a page can find nothing: the scan is RESUMABLE through `RECONCILE_CURSOR_KEY` (not under
 *  `tomb:`), and a finished listing starts over. When a page is cut short, the cursor stays on it, so its remaining keys are read again.
 *  A tombstone that does not parse to a numeric day is skipped and tallied, as the survivor step does (GH-1530), and FAILS the run: it
 *  is a live member's unfinished deletion. The rest of its page is still acted on, and the page is not pinned by it. */
async function scanTombstones(db: D1Like, kv: KVLike, room: number, known: ReadonlySet<string>, fail: (err: unknown) => void, tally: Tally): Promise<Scan> {
  const due: Due[] = [];
  // Each page read to its end: the cursor after it, and every member queued from it (or found on it already queued, in `known`).
  const pages: { next: string | typeof FINISHED; ids: string[] }[] = [];
  let acted = 0;
  // Workers KV is eventually consistent: a write can take up to about 60 s to be seen from another location. Runs are a day apart, so
  // this read sees yesterday's `save()`; an invocation within a minute of the last (a retry, a manual trigger) may read the cursor before
  // it, or the key it deleted. That only re-reads pages already read: their deletions are guarded and idempotent, and nothing is skipped.
  const saved = await kv.get(RECONCILE_CURSOR_KEY);
  let cursor: string | undefined = saved ?? undefined;
  for (let read = 0; read < RECONCILE_PAGES && acted < RECONCILE_PER_RUN && due.length < room; read++) {
    const page = await kv.list({ prefix: 'tomb:', cursor, limit: IN_CHUNK });
    const hashes = page.keys.map((k) => k.name.slice('tomb:'.length));
    const ids: string[] = [];
    let complete = true;
    if (hashes.length > 0) {
      const found = await db
        .prepare(`SELECT id, id_hash, last_seen_day FROM member WHERE id_hash IN (${hashes.map((_, j) => `?${j + 1}`).join(',')}) ORDER BY id_hash`)
        .bind(...hashes)
        .all<{ id: string; id_hash: string; last_seen_day: number }>();
      for (const m of found.results) {
        if (known.has(m.id)) {
          ids.push(m.id);
          continue;
        }
        if (acted >= RECONCILE_PER_RUN || due.length >= room) {
          complete = false;
          break;
        }
        acted++;
        try {
          // An eventually consistent read (see the survivor step in `deleteDue`): a delete request written elsewhere in the last ~60 s
          // may not be seen yet, so this prune can drop a tombstone that has just been rewritten.
          const raw = await kv.get('tomb:' + m.id_hash);
          if (raw === null) continue;
          const day = tombDay(raw);
          if (day === undefined) {
            // Skipped, so the page is not pinned, but RED: the page select joins `member`, so this is a live member's deletion that
            // nothing will finish (spec 6.4 step 3). The survivor step's skip stays quiet: there the guard has just spared the member.
            tally.unreadable++;
            fail(new Error('account cron: a live member\'s tombstone does not parse to a day (GH-1530)'));
            continue;
          }
          if (m.last_seen_day > day) await kv.delete('tomb:' + m.id_hash);
          else {
            due.push({ id: m.id, idHash: m.id_hash, day });
            ids.push(m.id);
          }
        } catch (err) {
          fail(err);
        }
      }
    }
    if (!complete) break; // the cursor stays on this page
    const last = page.list_complete || page.cursor === undefined;
    pages.push({ next: last || page.cursor === undefined ? FINISHED : page.cursor, ids });
    if (last) break;
    cursor = page.cursor;
  }
  // Written after the delete batch (`accountCron`), and only past pages whose every queued member is SETTLED: in a batch that committed
  // (deleted, or spared by its guard), or recorded as failing (GH-1530). A member the fallback held back keeps its page. The write is
  // eventually consistent like the read above; a stale view of it costs a re-read of pages, never a skipped one.
  const save = async (settled: ReadonlySet<string>): Promise<void> => {
    let target: string | typeof FINISHED | undefined;
    for (const p of pages) {
      if (!p.ids.every((id) => settled.has(id))) break;
      target = p.next;
    }
    if (target === FINISHED) await kv.delete(RECONCILE_CURSOR_KEY);
    else if (target !== undefined && target !== saved) await kv.put(RECONCILE_CURSOR_KEY, target, { expirationTtl: RECONCILE_CURSOR_TTL_S });
  };
  return { due, save };
}

/** Deletes every queued member in ONE guarded batch, then, only when a guard held someone back, ONE select for the survivors, whose
 *  tombstone is pruned when a sign-in came after it (so `gone` never calls a live account deleted). Returns the members deleted.
 *  `commit.committed` is set the moment the batch resolves, before the survivor tidy-up, so a caller can tell a batch that failed from
 *  one that committed and whose tidy-up then threw (GH-1530: only the first is a failed delete). */
async function deleteDue(db: D1Like, kv: KVLike, due: readonly Due[], tally: Tally, commit: { committed: boolean } = { committed: false }): Promise<number> {
  if (due.length === 0) return 0;
  const out = await db.batch(deleteDueStatements(db, due));
  commit.committed = true;
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
    if (d === undefined) continue;
    // Judge the tombstone as it is STORED now, not by the day this run queued: a delete request made since (`deleteAccount`) rewrites it
    // with a newer `lastSeenDay` (today, the member's own last sign-in), and that one must survive here whether its own batch failed or
    // committed meanwhile. A missing or unparsable tombstone is left alone. Two windows remain, as at the scan's prune: KV has no
    // conditional delete, so there is a gap between this get and the delete below; and KV is EVENTUALLY CONSISTENT, so a tombstone the
    // route wrote from another location in the last ~60 s may not be visible to this get yet, which can then still read this run's
    // older tombstone and delete it. That is seconds, not microseconds: it needs a delete request within a minute of the cron's batch
    // for a member the cron had already queued. Closing it fully is the route's job (rewrite the tombstone after its batch commits).
    const raw = await kv.get('tomb:' + d.idHash);
    if (raw === null) continue;
    const stored = tombDay(raw);
    if (stored === undefined) {
      tally.unreadable++; // skipped and tallied, as the scan does (GH-1530)
      continue;
    }
    if (stored < m.last_seen_day) await kv.delete('tomb:' + d.idHash);
  }
  return due.length - left.results.length;
}

/** GH-1530: the fallback's state, read once a run. The two keys are read and parsed apart: a KV failure or a corrupt value on one reads
 *  as no state for THAT key only (a zero counter, an empty record), and is reported. A corrupt record must not also zero the counter,
 *  or the fallback would stay off while the record waits out its TTL. */
async function readFallback(kv: KVLike, fail: (err: unknown) => void): Promise<{ fails: number; failing: Record<string, number> }> {
  let fails = 0;
  try {
    const n = Number.parseInt((await kv.get(BATCH_FAIL_KEY)) ?? '0', 10);
    if (Number.isFinite(n) && n > 0) fails = n;
  } catch (err) {
    fail(err);
  }
  const failing: Record<string, number> = {};
  try {
    const raw = await kv.get(FAILING_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      for (const [h, day] of Object.entries(parsed)) if (typeof day === 'number') failing[h] = day;
    }
  } catch (err) {
    fail(err);
  }
  return { fails, failing };
}

/** Writes the failing record: entries under `FAILING_KEEP_DAYS` old, at most `DUE_MEMBERS_MAX` of them, newest first. */
async function writeFailing(kv: KVLike, failing: Record<string, number>, today: number): Promise<void> {
  const keep = Object.entries(failing).filter(([, day]) => today - day < FAILING_KEEP_DAYS).sort((a, b) => b[1] - a[1]).slice(0, DUE_MEMBERS_MAX);
  if (keep.length === 0) await kv.delete(FAILING_KEY);
  else await kv.put(FAILING_KEY, JSON.stringify(Object.fromEntries(keep)), { expirationTtl: FAILING_TTL_S });
}

/** The whole account cron, as `scheduled()` runs it: expiries and idle members, then the tombstone scan (which runs even if the first
 *  part failed), then ONE delete batch for everyone either found. The scan's cursor moves past a page only once every member queued
 *  from it is settled, so a failed batch is retried from the same page tomorrow. The first failure is rethrown at the end. Returns the
 *  members deleted.
 *
 *  GH-1530, the fallback. A member recorded as failing is left out of every batch for `FAILING_HOLD_DAYS`, then retried ALONE.
 *  Otherwise, after `BATCH_FAIL_THRESHOLD` consecutive failed shared batches, the run deletes the oldest queued member alone. If that
 *  delete fails, the member is recorded and the counter clears, so the next run's shared batch carries everyone else. If it commits,
 *  the counter drops to one under the threshold: the next run tries the shared batch again, and one more failure brings the next member
 *  alone. A run that finds a recorded member and leaves it out still fails (rethrows), so a deletion stuck in the fallback stays seen. */
export async function accountCron(db: D1Like, now: number, kv: KVLike): Promise<number> {
  let failure: unknown;
  const fail = (err: unknown): void => { failure ??= err; };
  const tally: Tally = { unreadable: 0 };
  const today = dayOf(now);
  const state = await readFallback(kv, fail);
  let due: Due[] = [];
  try {
    due = await expireAndFindIdle(db, now, kv, fail);
  } catch (err) {
    fail(err);
  }
  let scan: Scan | undefined;
  try {
    scan = await scanTombstones(db, kv, DUE_MEMBERS_MAX - due.length, new Set(due.map((d) => d.id)), fail, tally);
    due = due.concat(scan.due);
  } catch (err) {
    fail(err);
  }
  const recorded = (d: Due): number | undefined => state.failing[d.idHash];
  const isHeld = (d: Due): boolean => { const day = recorded(d); return day !== undefined && today - day < FAILING_HOLD_DAYS; };
  const held = due.filter(isHeld);
  const queue = due.filter((d) => !isHeld(d));
  const settled = new Set(held.map((d) => d.id)); // recorded as failing: their pages may be passed
  // Oldest first: the smallest guard day, the first queued on a tie (idle members come in `last_seen_day` order, then the scan's).
  const oldest = queue.reduce<Due | undefined>((a, d) => (a === undefined || d.day < a.day ? d : a), undefined);
  const alone = queue.find((d) => recorded(d) !== undefined) ?? (state.fails >= BATCH_FAIL_THRESHOLD ? oldest : undefined);
  const batch = alone !== undefined ? [alone] : queue;
  let done = 0;
  // Set when `db.batch` resolves, not when `deleteDue` returns: a throw in its survivor tidy-up comes after the deletes committed, and
  // must neither raise the counter nor record a member that is already gone.
  const commit = { committed: false };
  try {
    done = await deleteDue(db, kv, batch, tally, commit);
  } catch (err) {
    fail(err);
  }
  const committed = commit.committed;
  try {
    if (batch.length === 0) {
      // no batch ran: the counter neither rises nor clears
    } else if (committed) {
      for (const d of batch) settled.add(d.id);
      if (alone === undefined) {
        if (state.fails > 0) await kv.delete(BATCH_FAIL_KEY);
      } else {
        if (recorded(alone) !== undefined) {
          delete state.failing[alone.idHash];
          await writeFailing(kv, state.failing, today);
        }
        if (state.fails >= BATCH_FAIL_THRESHOLD) await kv.put(BATCH_FAIL_KEY, String(BATCH_FAIL_THRESHOLD - 1), { expirationTtl: BATCH_FAIL_TTL_S });
      }
    } else if (alone === undefined) {
      await kv.put(BATCH_FAIL_KEY, String(state.fails + 1), { expirationTtl: BATCH_FAIL_TTL_S });
    } else {
      state.failing[alone.idHash] = today;
      await writeFailing(kv, state.failing, today);
      settled.add(alone.id); // recorded as failing only once the record is written
      if (state.fails > 0) await kv.delete(BATCH_FAIL_KEY);
    }
  } catch (err) {
    fail(err);
  }
  await scan?.save(settled).catch(fail); // a lost cursor only restarts the scan from the top tomorrow
  if (tally.unreadable > 0) console.warn('account cron: skipped tombstones that do not parse to a day', { count: tally.unreadable });
  if (held.length > 0) fail(new Error(`account cron: ${held.length} member deletion(s) held back after failing alone (GH-1530)`));
  if (failure !== undefined) throw failure;
  return done;
}

/** Expiries and idle members only (one delete batch). No production caller since `accountCron` (GH-1432); kept for the unit tests. */
export async function sweepAccounts(db: D1Like, now: number, kv: KVLike): Promise<void> {
  let failure: unknown;
  const due = await expireAndFindIdle(db, now, kv, (err) => { failure ??= err; });
  await deleteDue(db, kv, due, { unreadable: 0 });
  if (failure !== undefined) throw failure;
}

/** Finishes every deletion a tombstone records, and prunes a tombstone whose deletion a later sign-in cancelled. Only a key whose member
 *  still exists is acted on. Returns how many members it deleted; a failure on one key does not stop the others and is rethrown.
 *  No production caller since `accountCron` (GH-1432); kept for the unit tests. It has no fallback: GH-1530's is `accountCron`'s. */
export async function reconcileTombstones(db: D1Like, kv: KVLike): Promise<number> {
  let failure: unknown;
  const scan = await scanTombstones(db, kv, DUE_MEMBERS_MAX, new Set(), (err) => { failure ??= err; }, { unreadable: 0 });
  const done = await deleteDue(db, kv, scan.due, { unreadable: 0 });
  await scan.save(new Set(scan.due.map((d) => d.id))).catch((err: unknown) => { failure ??= err; });
  if (failure !== undefined) throw failure;
  return done;
}
